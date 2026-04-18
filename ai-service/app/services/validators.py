"""
KYC Document Validators — all self-sufficient, zero external API keys.

Implements:
  1. Aadhaar Verhoeff checksum          (mathematical, no API)
  2. PAN 5th-character name validation   (pure logic)
  3. MRZ passport parsing + ICAO 9303   (pure math)
  4. EXIF metadata tamper detection      (Pillow, already installed)
  5. Face presence detection             (OpenCV Haar cascades, already installed)
  6. GST number format validation        (regex + state code lookup)

For features that require external APIs (NSDL PAN verification, Digilocker,
liveness detection), this module provides the best possible OCR-only equivalent
until API keys are configured.
"""

from __future__ import annotations
import re
import logging
from io import BytesIO
from typing import Optional

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# 1. AADHAAR — VERHOEFF CHECKSUM
# ─────────────────────────────────────────────────────────────────────────────

# Verhoeff multiplication table
_V_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]

# Verhoeff permutation table
_V_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

# Verhoeff inverse table
_V_INV = [0, 4, 3, 2, 1, 9, 8, 7, 6, 5]


def validate_aadhaar_verhoeff(aadhaar_number: str) -> dict:
    """
    Validate a 12-digit Aadhaar number using the Verhoeff checksum algorithm.

    The Government of India uses Verhoeff for Aadhaar checksum validation.
    This is a pure mathematical check — no API key required.

    Returns:
      {
        is_valid: bool,
        reason: str,           # HR-facing explanation
        technical_note: str,   # For audit trail
      }
    """
    digits = re.sub(r"\D", "", aadhaar_number or "")

    if len(digits) != 12:
        return {
            "is_valid": False,
            "reason": f"✗ Aadhaar number has {len(digits)} digits — exactly 12 required",
            "technical_note": "Verhoeff check skipped: digit count mismatch",
        }

    # First digit cannot be 0 or 1 (UIDAI specification)
    if digits[0] in "01":
        return {
            "is_valid": False,
            "reason": f"✗ Aadhaar first digit is '{digits[0]}' — valid Aadhaar numbers must start with 2–9 (UIDAI specification)",
            "technical_note": "Failed pre-check: first digit rule",
        }

    # Run Verhoeff algorithm
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _V_D[c][_V_P[i % 8][int(ch)]]

    if c == 0:
        return {
            "is_valid": True,
            "reason": "✓ Aadhaar Verhoeff checksum passed — mathematically valid 12-digit number",
            "technical_note": f"Verhoeff check passed for {digits[:4]}****{digits[8:]}",
        }
    else:
        return {
            "is_valid": False,
            "reason": "✗ Aadhaar Verhoeff checksum FAILED — this number does not pass the government's mathematical validation. Possible OCR error or fake number.",
            "technical_note": f"Verhoeff check digit mismatch (got c={c}, expected 0)",
        }


# ─────────────────────────────────────────────────────────────────────────────
# 2. PAN — 5TH CHARACTER SURNAME INITIAL VALIDATION
# ─────────────────────────────────────────────────────────────────────────────

# PAN 4th-character entity type map
_PAN_ENTITY_MAP = {
    "P": "Individual (Person)",
    "C": "Company",
    "H": "Hindu Undivided Family (HUF)",
    "F": "Firm / Partnership",
    "A": "Association of Persons (AOP)",
    "T": "Trust",
    "B": "Body of Individuals (BOI)",
    "L": "Local Authority",
    "J": "Artificial Juridical Person",
    "G": "Government Entity",
}


def validate_pan_structure(pan_number: str, name: Optional[str] = None) -> dict:
    """
    Validate PAN card number structure:
      1. Format check — ABCDE1234F (5 alpha, 4 digits, 1 alpha)
      2. 4th char = entity type (P = individual, C = company, etc.)
      3. 5th char = first letter of surname (for individuals only)

    Returns a list of reason strings (HR-facing).
    """
    reasons = []

    if not pan_number:
        return {"reasons": ["✗ PAN number not extracted — cannot validate structure"]}

    pan = pan_number.strip().upper()

    # Full format check
    if not re.match(r"^[A-Z]{5}\d{4}[A-Z]$", pan):
        reasons.append(f"✗ PAN '{pan}' does not match standard format [A-Z]{{5}}[0-9]{{4}}[A-Z] — may be OCR corruption or invalid document")
        return {"reasons": reasons}

    reasons.append(f"✓ PAN number format is valid: {pan}")

    # 4th character = entity type
    entity_char = pan[3]
    entity_type = _PAN_ENTITY_MAP.get(entity_char, "Unknown entity")
    reasons.append(f"✓ PAN entity type: {entity_type} (4th character '{entity_char}')")

    # 5th character = first letter of surname (only meaningful for individuals)
    pan_5th = pan[4]
    if entity_char == "P" and name:
        name_parts = name.strip().split()
        if name_parts:
            # Indian naming: last word is usually the surname (North Indian)
            # First word is surname for some South Indian conventions
            surname_initial = name_parts[-1][0].upper() if name_parts[-1] else ""
            first_initial = name_parts[0][0].upper() if name_parts[0] else ""

            if surname_initial == pan_5th:
                reasons.append(
                    f"✓ PAN 5th character '{pan_5th}' matches surname '{name_parts[-1]}' initial — cross-validation passed"
                )
            elif first_initial == pan_5th:
                reasons.append(
                    f"✓ PAN 5th character '{pan_5th}' matches first name '{name_parts[0]}' initial "
                    f"(South Indian naming convention where given name comes last)"
                )
            else:
                reasons.append(
                    f"⚠ PAN 5th character '{pan_5th}' does not match surname initial '{surname_initial}' "
                    f"or first name initial '{first_initial}' — verify name on card manually. "
                    f"(Could be a maiden name, single-name holder, or OCR error in name extraction)"
                )
        else:
            reasons.append(f"⚠ Could not validate PAN 5th char '{pan_5th}' — name could not be parsed")
    elif entity_char != "P":
        reasons.append(f"ℹ PAN 5th character '{pan_5th}' represents first letter of entity name (not a person)")
    else:
        reasons.append(f"⚠ PAN 5th character '{pan_5th}' could not be cross-validated — name not extracted")

    return {"reasons": reasons}


# ─────────────────────────────────────────────────────────────────────────────
# 3. PASSPORT — MRZ PARSING + ICAO 9303 CHECKSUM VALIDATION
# ─────────────────────────────────────────────────────────────────────────────

# ICAO 9303 character value map
_MRZ_CHAR_MAP: dict = {}
for _i, _c in enumerate("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
    _MRZ_CHAR_MAP[_c] = _i
_MRZ_CHAR_MAP["<"] = 0  # filler


def _mrz_check_digit(value: str) -> int:
    """Calculate ICAO 9303 MRZ check digit for a given string."""
    weights = [7, 3, 1]
    total = 0
    for idx, char in enumerate(value.upper()):
        total += _MRZ_CHAR_MAP.get(char, 0) * weights[idx % 3]
    return total % 10


def _mrz_date_to_human(yymmdd: str) -> str:
    """Convert MRZ date YYMMDD to DD/MM/YYYY string."""
    if len(yymmdd) != 6 or not yymmdd.isdigit():
        return yymmdd
    yy, mm, dd = yymmdd[:2], yymmdd[2:4], yymmdd[4:]
    # Assume 20xx for birth years (adjust if year > current year)
    year = int(yy)
    century = "19" if year > 30 else "20"  # rough heuristic
    return f"{dd}/{mm}/{century}{yy}"


def parse_and_validate_mrz(text: str) -> dict:
    """
    Detect and validate the MRZ (Machine Readable Zone) from passport OCR text.

    Indian passports use TD3 format (2 × 44 characters).
    Validates all 4 check digits per ICAO 9303 Part 3.

    Returns:
      {
        detected: bool,
        is_valid: bool,
        reasons: [str],          # HR-facing explanations
        extracted: dict,         # name, passport_no, dob, expiry from MRZ
        checks_passed: [str],
        checks_failed: [str],
      }
    """
    reasons = []

    # Attempt to find two consecutive 44-char MRZ lines
    # MRZ chars: A-Z, 0-9, < (filler)
    mrz_line_re = re.compile(r"[A-Z0-9<]{30,44}")
    candidates = mrz_line_re.findall(text.replace(" ", ""))

    # Also try from raw text with newlines
    strict_re = re.compile(r"([P][A-Z<][A-Z<]{3}[A-Z<]{39})\s*([A-Z0-9<]{44})")
    strict_match = strict_re.search(text.replace(" ", "").replace("\n", "\n"))

    line1: Optional[str] = None
    line2: Optional[str] = None

    if strict_match:
        line1 = strict_match.group(1)[:44]
        line2 = strict_match.group(2)[:44]
    elif len(candidates) >= 2:
        # Find a pair where first starts with P (passport)
        for idx, c in enumerate(candidates[:-1]):
            if c.startswith("P") and len(c) >= 40:
                line1 = c.ljust(44, "<")[:44]
                line2 = candidates[idx + 1].ljust(44, "<")[:44]
                break

    if not line1 or not line2:
        return {
            "detected": False,
            "is_valid": False,
            "reasons": ["⚠ MRZ (Machine Readable Zone) not detected in OCR text — passport scan may be too low quality or the MRZ area was cropped"],
            "extracted": {},
            "checks_passed": [],
            "checks_failed": [],
        }

    reasons.append("✓ MRZ lines detected in passport scan")

    checks_passed = []
    checks_failed = []
    extracted = {}

    # ── Line 2 field positions (0-indexed) ──────────────────────────────────
    # [0:9]  = passport number    [9]    = check digit for passport no.
    # [10:13]= nationality        [13:19]= DOB (YYMMDD)   [19] = check DOB
    # [20]   = sex                [21:27]= expiry (YYMMDD) [27] = check expiry
    # [28:42]= optional/personal  [42]   = check personal
    # [43]   = overall composite check digit

    if len(line2) < 44:
        reasons.append("⚠ MRZ line 2 is shorter than expected — checksum validation may be incomplete")
        line2 = line2.ljust(44, "<")

    pp_no_raw = line2[0:9]
    pp_check = int(line2[9]) if line2[9].isdigit() else -1
    nationality = line2[10:13].replace("<", "")
    dob_raw = line2[13:19]
    dob_check = int(line2[19]) if line2[19].isdigit() else -1
    sex = line2[20]
    expiry_raw = line2[21:27]
    expiry_check = int(line2[27]) if line2[27].isdigit() else -1
    # positions 28-43: optional personal number + its check digit — validated by composite below
    overall_check = int(line2[43]) if len(line2) > 43 and line2[43].isdigit() else -1

    extracted["passport_number_mrz"] = pp_no_raw.replace("<", "")
    extracted["nationality_mrz"] = nationality
    extracted["dob_mrz"] = _mrz_date_to_human(dob_raw)
    extracted["expiry_mrz"] = _mrz_date_to_human(expiry_raw)
    extracted["sex_mrz"] = sex

    # Passport number check digit
    if _mrz_check_digit(pp_no_raw) == pp_check:
        checks_passed.append("passport number")
        reasons.append(f"✓ MRZ passport number checksum valid — {extracted['passport_number_mrz']}")
    else:
        checks_failed.append("passport number")
        reasons.append(f"✗ MRZ passport number checksum FAILED — possible forgery or OCR error in passport number field")

    # DOB check digit
    if _mrz_check_digit(dob_raw) == dob_check:
        checks_passed.append("date of birth")
        reasons.append(f"✓ MRZ date of birth checksum valid — {extracted['dob_mrz']}")
    else:
        checks_failed.append("date of birth")
        reasons.append(f"✗ MRZ date of birth checksum FAILED — {extracted['dob_mrz']} does not verify")

    # Expiry check digit
    if _mrz_check_digit(expiry_raw) == expiry_check:
        checks_passed.append("expiry date")
        reasons.append(f"✓ MRZ expiry date checksum valid — expires {extracted['expiry_mrz']}")
    else:
        checks_failed.append("expiry date")
        reasons.append(f"✗ MRZ expiry date checksum FAILED — {extracted['expiry_mrz']} does not verify")

    # Overall composite check (most important — covers the whole document)
    composite = line2[0:10] + line2[13:20] + line2[21:43]
    if _mrz_check_digit(composite) == overall_check:
        checks_passed.append("composite overall")
        reasons.append("✓ MRZ composite checksum passed — overall document integrity confirmed by ICAO 9303")
    else:
        checks_failed.append("composite overall")
        reasons.append("✗ MRZ composite checksum FAILED — document integrity check failed. This is a strong indicator of document tampering or a counterfeit passport.")

    # Name from line 1
    if len(line1) > 5:
        # Line 1: P<IND<SURNAME<<GIVEN<NAMES<<...
        name_part = line1[5:].rstrip("<")
        if "<<" in name_part:
            surname_raw, given_raw = name_part.split("<<", 1)
            surname = surname_raw.replace("<", " ").strip().title()
            given = given_raw.replace("<", " ").strip().title()
            extracted["name_mrz"] = f"{given} {surname}".strip()
            reasons.append(f"✓ MRZ name decoded: {extracted['name_mrz']}")
        else:
            extracted["name_mrz"] = name_part.replace("<", " ").strip().title()

    is_valid = len(checks_failed) == 0
    if is_valid:
        reasons.insert(1, "✓ ALL MRZ checksums passed — passport is mathematically valid (ICAO 9303)")
    elif len(checks_failed) >= 2:
        reasons.insert(1, f"✗ {len(checks_failed)} MRZ checksums FAILED — HIGH risk of document tampering. Recommend rejection and further investigation.")
    else:
        reasons.insert(1, f"⚠ {len(checks_failed)} MRZ checksum failed — manual verification required before approval")

    return {
        "detected": True,
        "is_valid": is_valid,
        "reasons": reasons,
        "extracted": extracted,
        "checks_passed": checks_passed,
        "checks_failed": checks_failed,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 4. EXIF METADATA TAMPER DETECTION
# ─────────────────────────────────────────────────────────────────────────────

# Known photo editing software signatures (lowercase)
_EDITING_SIGNATURES = [
    "photoshop", "adobe", "lightroom", "gimp", "paint.net", "paint shop",
    "canva", "snapseed", "facetune", "picsart", "pixlr", "fotor",
    "afterlight", "vsco", "inkscape", "corel", "affinity photo",
    "capture one", "darktable", "rawtherapee",
]

# Scanners — legitimate scanning software (not suspicious)
_SCANNER_SIGNATURES = [
    "scan", "scanner", "epson", "canon scan", "hp scan", "brother",
    "neatworks", "acrobat scan", "twain", "wia", "camscanner", "microsoft office",
    "office lens",
]


def check_exif_tampering(image_bytes: bytes) -> dict:
    """
    Analyse EXIF metadata of an uploaded image for signs of digital tampering.

    Uses Pillow (already installed in the Docker image — no extra deps).

    Signals:
    - Photo editing software detected (Photoshop, GIMP, Canva, etc.)
    - Original timestamp ≠ modification timestamp
    - No camera make/model and no scanner signature (may be a generated image)
    - Unusual color profile or DPI

    Returns:
      {
        is_suspicious: bool,
        risk_level: "LOW" | "MEDIUM" | "HIGH",
        reasons: [str],          # HR-facing
        software: str | None,
        camera: str | None,
        has_exif: bool,
      }
    """
    from PIL import Image
    from PIL.ExifTags import TAGS

    reasons = []
    is_suspicious = False
    software: Optional[str] = None
    camera: Optional[str] = None
    has_exif = False

    try:
        image = Image.open(BytesIO(image_bytes))
    except Exception as e:
        return {
            "is_suspicious": False,
            "risk_level": "LOW",
            "reasons": [f"⚠ Could not open image for EXIF analysis: {str(e)}"],
            "software": None,
            "camera": None,
            "has_exif": False,
        }

    # PIL EXIF
    try:
        exif_raw = image._getexif() if hasattr(image, "_getexif") else None
        exif_data = {TAGS.get(k, str(k)): v for k, v in (exif_raw or {}).items()}
    except Exception:
        exif_data = {}

    has_exif = bool(exif_data)

    if not has_exif:
        # No EXIF metadata at all — scanned documents often have no EXIF (normal for PDFs
        # converted to image). Screenshots may also lack EXIF, which is somewhat suspicious.
        reasons.append("⚠ No EXIF metadata found — if this is a camera photo, absence of EXIF may indicate screenshot or image processing. Scanned documents typically have no EXIF (normal).")
        return {
            "is_suspicious": False,
            "risk_level": "LOW",
            "reasons": reasons,
            "software": None,
            "camera": None,
            "has_exif": False,
        }

    software_raw = str(exif_data.get("Software", "") or "")
    make = str(exif_data.get("Make", "") or "")
    model = str(exif_data.get("Model", "") or "")
    camera = f"{make} {model}".strip() or None
    dt_original = str(exif_data.get("DateTimeOriginal", "") or "")
    dt_modified = str(exif_data.get("DateTime", "") or "")
    software = software_raw or None

    # ── Check 1: Editing software signatures ──────────────────────────────
    software_lower = software_raw.lower()
    editing_detected = any(sig in software_lower for sig in _EDITING_SIGNATURES)
    scanner_detected = any(sig in software_lower for sig in _SCANNER_SIGNATURES)

    if editing_detected:
        reasons.append(
            f"✗ Image metadata shows editing software: '{software_raw}' — "
            f"this document has been digitally altered. High risk of tampering."
        )
        is_suspicious = True
    elif scanner_detected:
        reasons.append(f"✓ Image created by scanning software ('{software_raw}') — legitimate scan")
    elif software_raw:
        reasons.append(f"⚠ Unknown software in metadata: '{software_raw}' — verify if this is legitimate")

    # ── Check 2: Timestamp mismatch ────────────────────────────────────────
    if dt_original and dt_modified and dt_original != dt_modified:
        reasons.append(
            f"⚠ EXIF timestamps differ — original capture: {dt_original}, "
            f"last modified: {dt_modified}. Document may have been edited after capture."
        )
        is_suspicious = True
    elif dt_original:
        reasons.append(f"✓ EXIF capture timestamp present: {dt_original}")

    # ── Check 3: Camera make/model presence ───────────────────────────────
    if camera:
        reasons.append(f"✓ Camera make/model in metadata: {camera} — consistent with a genuine photograph")
    else:
        if not scanner_detected:
            reasons.append(
                "⚠ No camera make/model in EXIF — image may have been taken on a device that strips metadata, "
                "or could be a generated/downloaded image"
            )

    # ── Check 4: DPI sanity (scanned docs usually 200–600 DPI) ───────────
    try:
        dpi = image.info.get("dpi") or image.info.get("jfif_density")
        if dpi:
            dpi_val = dpi[0] if isinstance(dpi, (tuple, list)) else dpi
            if dpi_val < 72:
                reasons.append(f"⚠ Very low DPI ({dpi_val}) — document scan may be too low quality for reliable OCR")
            elif dpi_val >= 200:
                reasons.append(f"✓ DPI: {dpi_val} — good scan resolution for document verification")
    except Exception:
        pass

    # ── Risk level ─────────────────────────────────────────────────────────
    if editing_detected:
        risk_level = "HIGH"
    elif is_suspicious:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    if risk_level == "LOW" and has_exif:
        reasons.insert(0, "✓ EXIF metadata analysis shows no signs of digital tampering")
    elif risk_level == "HIGH":
        reasons.insert(0, "✗ EXIF TAMPERING DETECTED — document integrity is compromised. Do not approve without physical document verification.")

    return {
        "is_suspicious": is_suspicious,
        "risk_level": risk_level,
        "reasons": reasons,
        "software": software,
        "camera": camera,
        "has_exif": has_exif,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 5. FACE PRESENCE DETECTION (OpenCV Haar Cascade — no external API)
# ─────────────────────────────────────────────────────────────────────────────

def detect_face_in_document(image_bytes: bytes) -> dict:
    """
    Detect whether a human face is present in the document image.
    Uses OpenCV Haar cascade (already installed — no extra deps needed).

    This validates that:
    - Photo ID documents (Aadhaar, PAN, Passport, DL, Voter ID) have a face photo
    - The face photo is not blank/absent

    Note: Full face *match* (comparing two photos) requires DeepFace or a face
    recognition API. This function only confirms face *presence*.

    Returns:
      {
        face_detected: bool,
        face_count: int,
        reason: str,
        confidence: "HIGH" | "MEDIUM" | "LOW",
      }
    """
    try:
        import cv2
        import numpy as np
        from PIL import Image as PILImage

        image = PILImage.open(BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(image)
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)

        # Use the frontal face detector (built into OpenCV)
        face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(30, 30),
            flags=cv2.CASCADE_SCALE_IMAGE,
        )

        face_count = len(faces)

        if face_count == 0:
            return {
                "face_detected": False,
                "face_count": 0,
                "reason": "⚠ No face detected in document image — photo ID documents should contain a clear face photograph. Low quality scan or non-photo document.",
                "confidence": "MEDIUM",
            }
        elif face_count == 1:
            return {
                "face_detected": True,
                "face_count": 1,
                "reason": "✓ One face detected in document — consistent with a genuine photo ID",
                "confidence": "HIGH",
            }
        else:
            return {
                "face_detected": True,
                "face_count": face_count,
                "reason": f"⚠ {face_count} faces detected — photo ID should have exactly one face. Verify document is not a composite or montage.",
                "confidence": "LOW",
            }

    except ImportError:
        return {
            "face_detected": None,
            "face_count": 0,
            "reason": "⚠ Face detection unavailable (OpenCV not installed)",
            "confidence": "LOW",
        }
    except Exception as e:
        logger.warning(f"Face detection failed: {e}")
        return {
            "face_detected": None,
            "face_count": 0,
            "reason": f"⚠ Face detection error — {str(e)[:80]}",
            "confidence": "LOW",
        }


# ─────────────────────────────────────────────────────────────────────────────
# 6. GST NUMBER VALIDATION (format + state code)
# ─────────────────────────────────────────────────────────────────────────────

# GST state/UT codes — all 38 codes per GSTIN specification
_GST_STATE_CODES = {
    "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
    "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
    "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
    "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
    "16": "Tripura", "17": "Meghalaya", "18": "Assam",
    "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
    "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra",
    "28": "Andhra Pradesh (old)", "29": "Karnataka", "30": "Goa",
    "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
    "34": "Puducherry", "35": "Andaman & Nicobar Islands",
    "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
    "97": "Other Territory", "99": "Centre Jurisdiction",
}

# GSTIN check digit character set
_GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _gstin_check_digit(gstin_14: str) -> str:
    """Calculate GSTIN check digit for first 14 characters."""
    total = 0
    for i, char in enumerate(gstin_14.upper()):
        val = _GSTIN_CHARS.find(char)
        if val == -1:
            return "?"
        product = val * (2 if i % 2 else 1)
        total += product // 36 + product % 36
    remainder = total % 36
    return _GSTIN_CHARS[remainder] if remainder < len(_GSTIN_CHARS) else "?"


def validate_gstin(gstin: str) -> dict:
    """
    Validate a GSTIN (Goods and Services Tax Identification Number).

    GSTIN format (15 characters):
      NN          — state/UT code (01-38, 97, 99)
      AAAAAANNNNP — 10-char PAN of the registered entity
      Z           — default 'Z' (entity number, usually Z for primary registration)
      C           — check digit (calculated)

    Returns:
      {
        is_valid: bool,
        state: str | None,
        embedded_pan: str | None,
        reasons: [str],
      }
    """
    reasons = []
    gstin = (gstin or "").strip().upper()

    if not gstin:
        return {"is_valid": False, "state": None, "embedded_pan": None,
                "reasons": ["⚠ No GST number provided"]}

    # Basic format check
    if not re.match(r"^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z0-9]$", gstin):
        return {
            "is_valid": False,
            "state": None,
            "embedded_pan": None,
            "reasons": [
                f"✗ GSTIN '{gstin}' does not match standard format (15 chars: "
                f"2-digit state + 10-char PAN + entity + Z + check digit)"
            ],
        }

    reasons.append(f"✓ GSTIN format is valid: {gstin}")

    # State code
    state_code = gstin[:2]
    state_name = _GST_STATE_CODES.get(state_code)
    if state_name:
        reasons.append(f"✓ State code '{state_code}' — registered in {state_name}")
    else:
        reasons.append(f"✗ State code '{state_code}' is not a valid Indian state/UT GST code")
        return {"is_valid": False, "state": None, "embedded_pan": gstin[2:12], "reasons": reasons}

    # Embedded PAN (chars 3-12)
    embedded_pan = gstin[2:12]
    if re.match(r"^[A-Z]{5}\d{4}[A-Z]$", embedded_pan):
        reasons.append(f"✓ Embedded PAN in GSTIN: {embedded_pan} — format valid")
    else:
        reasons.append(f"✗ Embedded PAN '{embedded_pan}' in GSTIN is not valid — possible data entry error")

    # Check digit validation
    expected_check = _gstin_check_digit(gstin[:14])
    actual_check = gstin[14]
    if expected_check == actual_check:
        reasons.append(f"✓ GSTIN check digit '{actual_check}' is mathematically correct")
    else:
        reasons.append(
            f"✗ GSTIN check digit is '{actual_check}' but expected '{expected_check}' — "
            f"possible fake or mistyped GSTIN number"
        )
        return {
            "is_valid": False, "state": state_name,
            "embedded_pan": embedded_pan, "reasons": reasons,
        }

    return {
        "is_valid": True,
        "state": state_name,
        "embedded_pan": embedded_pan,
        "reasons": reasons,
    }


def extract_and_validate_gstin(text: str) -> Optional[dict]:
    """
    Search for a GSTIN in the OCR text and validate it if found.
    Returns None if no GSTIN is found.
    """
    # GSTIN pattern: 2 digits + 10 alpha + 1 digit + Z + 1 alphanumeric
    match = re.search(r"\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z0-9])\b", text)
    if not match:
        # Try looser pattern to catch OCR substitutions (O vs 0)
        loose = text.replace("O", "0").replace("o", "0")
        match = re.search(r"\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z0-9])\b", loose)

    if match:
        return validate_gstin(match.group(1))
    return None


# ─────────────────────────────────────────────────────────────────────────────
# COMBINED VALIDATOR — runs all applicable checks for a document type
# ─────────────────────────────────────────────────────────────────────────────

# Document types that are photo ID — we check for face presence
_PHOTO_ID_TYPES = {"AADHAAR", "PAN", "PASSPORT", "VOTER_ID", "DRIVING_LICENSE"}

# Document types where EXIF check is meaningful (images, not text PDFs)
_IMAGE_BASED_TYPES = {"AADHAAR", "PAN", "PASSPORT", "VOTER_ID", "DRIVING_LICENSE"}


def run_deep_validators(
    doc_type: str,
    extracted_fields: dict,
    raw_text: str,
    image_bytes: Optional[bytes] = None,
) -> dict:
    """
    Run all applicable deep validators for the given document type.
    Returns a dict with all results and a flat list of reasons.

    Called from process_document() in ocr_service.py.
    """
    all_reasons: list[str] = []
    extra_fields: dict = {}
    suspicion_boost = 0  # added to authenticity_score penalty

    # ── Aadhaar Verhoeff ────────────────────────────────────────────────────
    if doc_type == "AADHAAR":
        aadhaar_no = extracted_fields.get("aadhaar_number", "")
        result = validate_aadhaar_verhoeff(aadhaar_no)
        all_reasons.append(result["reason"])
        if not result["is_valid"]:
            suspicion_boost += 0.25

    # ── PAN structure + 5th-char validation ─────────────────────────────────
    if doc_type == "PAN":
        pan_no = extracted_fields.get("pan_number", "")
        name = extracted_fields.get("name", "")
        result = validate_pan_structure(pan_no, name)
        all_reasons.extend(result["reasons"])
        # Count failures
        failures = sum(1 for r in result["reasons"] if r.startswith("✗"))
        suspicion_boost += failures * 0.15

    # ── MRZ for Passport ────────────────────────────────────────────────────
    if doc_type == "PASSPORT":
        mrz_result = parse_and_validate_mrz(raw_text)
        all_reasons.extend(mrz_result["reasons"])
        if mrz_result.get("detected") and not mrz_result.get("is_valid"):
            suspicion_boost += 0.30
        # Merge MRZ-extracted fields (more reliable than OCR for passports)
        if mrz_result.get("extracted"):
            extra_fields.update(mrz_result["extracted"])

    # ── EXIF tampering (image only) ─────────────────────────────────────────
    if image_bytes and doc_type in _IMAGE_BASED_TYPES:
        try:
            exif_result = check_exif_tampering(image_bytes)
            all_reasons.extend(exif_result["reasons"])
            if exif_result.get("is_suspicious"):
                suspicion_boost += 0.20 if exif_result["risk_level"] == "MEDIUM" else 0.40
            if exif_result.get("software"):
                extra_fields["exif_software"] = exif_result["software"]
            if exif_result.get("camera"):
                extra_fields["exif_camera"] = exif_result["camera"]
        except Exception as e:
            all_reasons.append(f"⚠ EXIF analysis skipped: {str(e)[:60]}")

    # ── Face detection (photo IDs) ──────────────────────────────────────────
    if image_bytes and doc_type in _PHOTO_ID_TYPES:
        try:
            face_result = detect_face_in_document(image_bytes)
            if face_result.get("face_detected") is not None:
                all_reasons.append(face_result["reason"])
                if not face_result["face_detected"]:
                    suspicion_boost += 0.10
        except Exception as e:
            logger.warning(f"Face detection error: {e}")

    # ── GST validation (experience letters, bank statements) ─────────────────
    if doc_type in ("BANK_STATEMENT", "CERTIFICATE", "OTHER"):
        gstin_result = extract_and_validate_gstin(raw_text)
        if gstin_result:
            all_reasons.extend(gstin_result["reasons"])
            if gstin_result.get("embedded_pan"):
                extra_fields["gstin_detected"] = True
                extra_fields["gstin_state"] = gstin_result.get("state", "")

    return {
        "reasons": all_reasons,
        "extra_fields": extra_fields,
        "suspicion_boost": suspicion_boost,
    }


# ─────────────────────────────────────────────────────────────────────────────
# WRONG DOCUMENT / NON-KYC CONTENT DETECTION
# ─────────────────────────────────────────────────────────────────────────────

# Patterns that strongly indicate a non-KYC upload
_SOCIAL_MEDIA_PATTERNS = [
    r"\b(whatsapp|telegram|instagram|facebook|twitter|snapchat|youtube)\b",
    r"\b(like[ds]?|comment[s]?|share[ds]?|follower[s]?|following)\b",
    r"(https?://|www\.)\S+",              # URLs
    r"\bLOL\b|\bOMG\b|\bhaha\b|\bxD\b",  # Chat expressions
]

_CHAT_PATTERNS = [
    r"\b(seen|delivered|read receipt)\b",
    r"\d{1,2}:\d{2}\s*(AM|PM|am|pm)",   # Chat timestamps
    r"\b(typing|online|last seen)\b",
    r"^\s*[A-Za-z]+:\s",                 # "Name: message" chat format
]

_PAYMENT_PATTERNS = [
    r"\b(UPI|NEFT|RTGS|IMPS|Paytm|PhonePe|GPay|Google Pay)\b",
    r"Transaction\s*(ID|Ref|Reference|No\.?)",
    r"\b(Debit|Credit)\s*of\s*₹?\d",
    r"₹\s*\d[\d,]+\s*(debited|credited|transferred)",
]

_INVOICE_RECEIPT_PATTERNS = [
    r"\b(Invoice|Receipt|Bill No\.?|Order ID)\b",
    r"\b(Subtotal|Grand Total|CGST|SGST|IGST)\b",
    r"\bGST\s*(Invoice|Bill|Challan)\b",
]

_SELFIE_PHOTO_PATTERNS = [
    # Very little text but is an image — handled by caller via text_len check
]

# Keywords that appear in genuine KYC documents (English + regional languages)
_KYC_ANCHOR_WORDS = {
    # English
    "aadhaar", "aadhar", "pan", "income tax", "passport", "republic of india",
    "voter", "election", "driving", "licence", "license", "bank statement",
    "account", "ifsc", "marksheet", "certificate", "university", "board",
    "uidai", "permanent account", "ministry", "government", "govt",
    "secondary", "higher secondary", "matriculation", "examination", "council",
    # Hindi (Devanagari)
    "विभाग", "भारत", "सरकार", "आधार", "पहचान", "प्रमाण", "परीक्षा",
    "विश्वविद्यालय", "मंडल", "अंकपत्र", "प्रमाणपत्र", "बैंक", "खाता",
    # Tamil
    "ஆதார்", "வாக்காளர்", "வங்கி", "சான்றிதழ்", "பாஸ்போர்ட்",
    # Telugu
    "ఆధార్", "ఓటరు", "బ్యాంకు", "సర్టిఫికేట్", "పాస్పోర్ట్",
    # Kannada
    "ಆಧಾರ್", "ಮತದಾರ", "ಬ್ಯಾಂಕ್", "ಪ್ರಮಾಣಪತ್ರ",
    # Marathi
    "आधार", "मतदार", "बँक", "प्रमाणपत्र", "परीक्षा",
    # Bengali
    "আধার", "ভোটার", "ব্যাংক", "সার্টিফিকেট",
    # Gujarati
    "આધાર", "મતદાર", "બેન્ક", "પ્રમાણપત્ર",
}


def detect_wrong_upload(
    text: str,
    doc_type: str,
    claimed_type: Optional[str] = None,
) -> dict:
    """
    Detect if the uploaded document is clearly NOT a legitimate KYC document.

    Identifies:
    - Social media screenshots (WhatsApp, Instagram)
    - Chat conversation screenshots
    - Payment/UPI transaction receipts
    - GST invoices / purchase bills
    - Random selfie photos (no meaningful text)
    - Documents from the wrong category (e.g., user uploaded a selfie claiming it's PAN)

    Returns:
      {
        is_wrong_upload: bool,
        risk_level: "NONE" | "LOW" | "HIGH" | "DEFINITE",
        category: str | None,       # "SOCIAL_MEDIA" | "CHAT" | "PAYMENT" | "INVOICE" | "UNCLEAR"
        reasons: [str],             # HR-facing flags
        recommendation: str,        # What HR should do
      }
    """
    text_lower = text.lower().strip()
    reasons: list[str] = []
    detections: list[str] = []
    score = 0

    # ── Check 1: Does the text contain any KYC anchor words? ────────────────
    has_kyc_content = any(kw in text_lower for kw in _KYC_ANCHOR_WORDS)
    if has_kyc_content:
        # Has KYC-like words — probably correct, but still check for mixing
        pass  # don't early-return; still run pattern checks below

    # ── Check 2: Very short / empty text ────────────────────────────────────
    text_len = len(text_lower)
    if text_len < 20:
        if claimed_type in ("AADHAAR", "PAN", "PASSPORT", "VOTER_ID", "DRIVING_LICENSE"):
            score += 40
            reasons.append(
                f"🚩 WRONG UPLOAD SUSPECTED: Only {text_len} characters extracted from a claimed "
                f"{claimed_type.replace('_', ' ')} — legitimate photo IDs always contain substantial text. "
                f"This may be a blank image, a selfie, or a non-document photo."
            )
            detections.append("BLANK_OR_PHOTO")
        return _build_wrong_upload_result(score, detections, reasons, text_len)

    # ── Check 3: Social media patterns ──────────────────────────────────────
    social_hits = sum(1 for p in _SOCIAL_MEDIA_PATTERNS if re.search(p, text, re.IGNORECASE))
    if social_hits >= 2:
        score += 70
        detections.append("SOCIAL_MEDIA")
        reasons.append(
            f"🚩 WRONG DOCUMENT: Social media content detected ({social_hits} social media patterns found). "
            f"This appears to be a screenshot of WhatsApp, Instagram, or another social platform — NOT a KYC document."
        )

    # ── Check 4: Chat conversation patterns ─────────────────────────────────
    chat_hits = sum(1 for p in _CHAT_PATTERNS if re.search(p, text, re.IGNORECASE))
    if chat_hits >= 2:
        score += 60
        detections.append("CHAT")
        reasons.append(
            f"🚩 WRONG DOCUMENT: Chat conversation patterns detected — "
            f"this looks like a messaging app screenshot, not an identity document."
        )

    # ── Check 5: Payment receipt / UPI ──────────────────────────────────────
    payment_hits = sum(1 for p in _PAYMENT_PATTERNS if re.search(p, text, re.IGNORECASE))
    if payment_hits >= 2:
        score += 60
        detections.append("PAYMENT")
        reasons.append(
            f"🚩 WRONG DOCUMENT: Payment/UPI transaction receipt detected — "
            f"this is a financial transaction screenshot, not a KYC identity document."
        )

    # ── Check 6: GST invoice / purchase bill ────────────────────────────────
    invoice_hits = sum(1 for p in _INVOICE_RECEIPT_PATTERNS if re.search(p, text, re.IGNORECASE))
    if invoice_hits >= 2 and doc_type not in ("BANK_STATEMENT", "OTHER"):
        score += 50
        detections.append("INVOICE")
        reasons.append(
            f"🚩 WRONG DOCUMENT: This appears to be a GST invoice or purchase receipt, "
            f"not a KYC identity document. Please upload the correct document."
        )

    # ── Check 7: OCR detected OTHER but claimed type is specific ────────────
    if doc_type == "OTHER" and claimed_type and claimed_type not in ("OTHER", "PHOTO", None):
        if not has_kyc_content:
            score += 45
            detections.append("TYPE_MISMATCH")
            reasons.append(
                f"⚠ DOCUMENT TYPE MISMATCH: The AI could not identify this as a {claimed_type.replace('_', ' ')} "
                f"— the content does not match expected KYC patterns. "
                f"The employee may have uploaded the wrong document."
            )
        else:
            reasons.append(
                f"⚠ Detected as UNKNOWN type but expected {claimed_type.replace('_', ' ')} — "
                f"some KYC keywords found; may be a valid document with poor scan quality."
            )

    # ── Check 8: Detected type doesn't match claimed type ───────────────────
    if (claimed_type and doc_type != "OTHER" and claimed_type != "OTHER"
            and doc_type != claimed_type
            and not _types_are_compatible(doc_type, claimed_type)):
        score += 55
        detections.append("TYPE_MISMATCH")
        reasons.append(
            f"🚩 DOCUMENT MISMATCH: Expected {claimed_type.replace('_', ' ')} but OCR detected "
            f"content typical of a {doc_type.replace('_', ' ')}. "
            f"The employee uploaded the wrong document in this field."
        )

    # ── Positive signal: has KYC content and no wrong patterns ──────────────
    if has_kyc_content and score == 0:
        reasons.append("✓ Document contains expected KYC-related content — upload appears correct")

    return _build_wrong_upload_result(score, detections, reasons, text_len)


def _types_are_compatible(detected: str, claimed: str) -> bool:
    """Some document types are semantically compatible (e.g. DL can be in DRIVING_LICENSE slot)."""
    compat_groups = [
        {"AADHAAR"},
        {"PAN"},
        {"PASSPORT"},
        {"VOTER_ID"},
        {"DRIVING_LICENSE"},
        {"CERTIFICATE", "TENTH_CERTIFICATE", "TWELFTH_CERTIFICATE", "DEGREE_CERTIFICATE",
         "POST_GRADUATION_CERTIFICATE", "PHD_CERTIFICATE"},
        {"BANK_STATEMENT", "CANCELLED_CHEQUE"},
        {"EXPERIENCE_LETTER", "EMPLOYMENT_LETTER", "OFFER_LETTER", "CERTIFICATE"},
        {"PHOTO", "PASSPORT_PHOTO"},
    ]
    for group in compat_groups:
        if detected in group and claimed in group:
            return True
    return False


def _build_wrong_upload_result(score: int, detections: list, reasons: list, text_len: int) -> dict:
    """Construct the final wrong_upload result dict."""
    if score >= 60:
        risk_level = "DEFINITE"
        is_wrong = True
        recommendation = (
            "Reject this document immediately and request the employee to re-upload the correct document. "
            "Do NOT approve KYC with this submission."
        )
    elif score >= 40:
        risk_level = "HIGH"
        is_wrong = True
        recommendation = (
            "This document is likely incorrect. Reject and ask the employee to re-upload "
            "the correct document. Manual verification strongly recommended."
        )
    elif score >= 20:
        risk_level = "LOW"
        is_wrong = False
        recommendation = "Some anomalies detected — review document carefully before approving."
    else:
        risk_level = "NONE"
        is_wrong = False
        recommendation = "Document appears to be the correct type."

    category = detections[0] if detections else None

    return {
        "is_wrong_upload": is_wrong,
        "risk_level": risk_level,
        "category": category,
        "reasons": reasons,
        "score": score,
        "text_len": text_len,
        "recommendation": recommendation,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 7. DOCUMENT EXPIRY DETECTION
# ─────────────────────────────────────────────────────────────────────────────

from datetime import datetime, date


def validate_document_expiry(doc_type: str, fields: dict, raw_text: str) -> dict:
    """
    Detect if a document has expired or is close to expiry.
    Supports: PASSPORT, DRIVING_LICENSE, VOTER_ID.

    Returns:
      {
        has_expiry: bool,
        is_expired: bool,
        expiry_date: str | None,
        days_remaining: int | None,
        reasons: [str],
        risk_level: "NONE" | "LOW" | "MEDIUM" | "HIGH",
      }
    """
    reasons = []
    today = date.today()

    # Documents that have expiry dates
    EXPIRY_DOC_TYPES = {"PASSPORT", "DRIVING_LICENSE", "VOTER_ID"}
    if doc_type not in EXPIRY_DOC_TYPES:
        return {
            "has_expiry": False,
            "is_expired": False,
            "expiry_date": None,
            "days_remaining": None,
            "reasons": [],
            "risk_level": "NONE",
        }

    # Extract expiry date from fields or raw text
    expiry_str: Optional[str] = fields.get("expiry_date")

    if not expiry_str:
        # Try to extract from raw text using labeled patterns
        expiry_patterns = [
            r"(?:expiry|expiration|valid\s+till|valid\s+upto|valid\s+up\s+to|expires?)[:\s]+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})",
            r"(?:valid\s+until|validity)[:\s]+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})",
            r"(?:date\s+of\s+expiry|doe)[:\s]+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})",
        ]
        for pattern in expiry_patterns:
            m = re.search(pattern, raw_text, re.IGNORECASE)
            if m:
                expiry_str = m.group(1)
                break

    if not expiry_str:
        # Try to find the last date in the document (passports: issue then expiry)
        all_dates = re.findall(r"(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})", raw_text)
        if len(all_dates) >= 2:
            expiry_str = all_dates[-1]  # last date is often expiry

    if not expiry_str:
        reasons.append(f"⚠ Expiry date not found in {doc_type.replace('_', ' ')} — verify manually that document is still valid")
        return {
            "has_expiry": True,
            "is_expired": False,
            "expiry_date": None,
            "days_remaining": None,
            "reasons": reasons,
            "risk_level": "LOW",
        }

    # Parse the date
    expiry_date: Optional[date] = None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%m/%d/%Y", "%d/%m/%y", "%d-%m-%y"):
        try:
            expiry_date = datetime.strptime(expiry_str.strip(), fmt).date()
            break
        except ValueError:
            continue

    if not expiry_date:
        reasons.append(f"⚠ Could not parse expiry date '{expiry_str}' — verify manually")
        return {
            "has_expiry": True,
            "is_expired": False,
            "expiry_date": expiry_str,
            "days_remaining": None,
            "reasons": reasons,
            "risk_level": "LOW",
        }

    days_remaining = (expiry_date - today).days

    if days_remaining < 0:
        abs_days = abs(days_remaining)
        years_ago = abs_days // 365
        reasons.append(
            f"✗ DOCUMENT EXPIRED: {doc_type.replace('_', ' ')} expired on {expiry_date.strftime('%d %b %Y')} "
            f"({abs_days} days ago{', ' + str(years_ago) + ' year(s)' if years_ago > 0 else ''}). "
            f"Expired documents CANNOT be accepted for KYC — ask employee to provide a valid/renewed document."
        )
        risk_level = "HIGH"
        is_expired = True
    elif days_remaining <= 30:
        reasons.append(
            f"⚠ EXPIRING SOON: {doc_type.replace('_', ' ')} expires on {expiry_date.strftime('%d %b %Y')} "
            f"({days_remaining} days remaining). Consider requesting updated document."
        )
        risk_level = "MEDIUM"
        is_expired = False
    elif days_remaining <= 90:
        reasons.append(
            f"⚠ {doc_type.replace('_', ' ')} expires in {days_remaining} days ({expiry_date.strftime('%d %b %Y')}) — valid now but will expire soon"
        )
        risk_level = "LOW"
        is_expired = False
    else:
        reasons.append(
            f"✓ {doc_type.replace('_', ' ')} is valid — expires {expiry_date.strftime('%d %b %Y')} ({days_remaining} days remaining)"
        )
        risk_level = "NONE"
        is_expired = False

    return {
        "has_expiry": True,
        "is_expired": is_expired,
        "expiry_date": expiry_date.strftime("%d/%m/%Y"),
        "days_remaining": days_remaining,
        "reasons": reasons,
        "risk_level": risk_level,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 8. DUPLICATE DOCUMENT NUMBER DETECTION (in-batch, no DB call)
# ─────────────────────────────────────────────────────────────────────────────

def detect_duplicate_numbers_in_batch(page_results: list) -> dict:
    """
    Within a single combined PDF submission, detect if the same document number
    (Aadhaar, PAN, Passport, DL, EPIC) appears on multiple pages.

    This catches scenarios where an employee accidentally submitted the same
    document twice (e.g., Aadhaar front + the same Aadhaar front again).

    Returns:
      {
        duplicates_found: bool,
        duplicates: [{ number, doc_type, pages: [int], risk_level }],
        reasons: [str],
      }
    """
    # Collect numbers by type across pages
    number_occurrences: dict = {}  # key = (number, type), value = [page_nums]

    EXTRACTORS = {
        "AADHAAR": lambda t: re.sub(r"\D", "", m.group(0)) if (m := re.search(r"\d{4}\s?\d{4}\s?\d{4}", t)) else None,
        "PAN": lambda t: m.group(0) if (m := re.search(r"[A-Z]{5}\d{4}[A-Z]", t)) else None,
        "PASSPORT": lambda t: m.group(0) if (m := re.search(r"[A-Z]\d{7}", t)) else None,
        "DRIVING_LICENSE": lambda t: m.group(0) if (m := re.search(r"[A-Z]{2}[\-\s]?\d{2}[\-\s]?\d{4}[\-\s]?\d{7}", t)) else None,
        "VOTER_ID": lambda t: m.group(0) if (m := re.search(r"[A-Z]{3}\d{7}", t)) else None,
    }

    for pr in page_results:
        doc_type = pr.get("detected_type", "OTHER")
        text = pr.get("text_snippet", "") + " " + pr.get("full_text", "")
        page_num = pr.get("page", 0)

        extractor = EXTRACTORS.get(doc_type)
        if extractor:
            try:
                number = extractor(text)
                if number and len(str(number)) >= 6:
                    key = (str(number), doc_type)
                    if key not in number_occurrences:
                        number_occurrences[key] = []
                    number_occurrences[key].append(page_num)
            except Exception:
                pass

    duplicates = []
    reasons = []

    for (number, doc_type), pages in number_occurrences.items():
        if len(pages) > 1:
            # Check if this is a legitimate multi-page doc (Aadhaar front+back = ok)
            max_allowed = {"AADHAAR": 2, "PASSPORT": 8}.get(doc_type, 1)
            if len(pages) > max_allowed:
                masked = number[:4] + "****" + number[-3:] if len(number) >= 8 else "****"
                duplicates.append({
                    "number": masked,
                    "doc_type": doc_type,
                    "pages": pages,
                    "risk_level": "HIGH",
                })
                reasons.append(
                    f"🚩 DUPLICATE: Same {doc_type.replace('_', ' ')} number ({masked}) found on {len(pages)} pages "
                    f"(pages {pages}) — employee may have submitted the same document multiple times. "
                    f"Verify each page is a different document."
                )

    if not duplicates:
        reasons.append("✓ No duplicate document numbers detected within this submission")

    return {
        "duplicates_found": bool(duplicates),
        "duplicates": duplicates,
        "reasons": reasons,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 9. FONT / TEMPLATE CONSISTENCY CHECK
# ─────────────────────────────────────────────────────────────────────────────

def check_template_consistency(text: str, doc_type: str) -> dict:
    """
    Heuristically check if the OCR text has the structural patterns expected
    for the claimed document type.

    For example:
    - PAN cards MUST have exactly one 10-char PAN number.
    - Aadhaar MUST have a 12-digit number and DOB.
    - Salary slips MUST have both earnings and deductions columns.
    - Certificates MUST have institution name + year.

    Returns:
      {
        consistent: bool,
        score: int,         # 0-100, higher = more consistent
        reasons: [str],
        anomalies: [str],
      }
    """
    reasons = []
    anomalies = []
    score = 100  # start at 100, deduct for missing expected elements

    EXPECTED_PATTERNS: dict = {
        "AADHAAR": {
            "required": [
                (r"\d{4}\s?\d{4}\s?\d{4}", "12-digit Aadhaar number"),
                (r"\d{2}[/\-\.]\d{2}[/\-\.]\d{4}", "Date of Birth"),
            ],
            "optional": [
                (r"(?:male|female|पुरुष|महिला)", "Gender"),
                (r"(?:aadhaar|aadhar|uidai|आधार)", "Aadhaar keyword"),
            ],
        },
        "PAN": {
            "required": [
                (r"[A-Z]{5}\d{4}[A-Z]", "PAN number (ABCDE1234F format)"),
                (r"(?:income tax|permanent account)", "Income Tax / Permanent Account keyword"),
            ],
            "optional": [
                (r"\d{2}[/\-\.]\d{2}[/\-\.]\d{4}", "Date of Birth"),
            ],
        },
        "PASSPORT": {
            "required": [
                (r"[A-Z]\d{7}", "Passport number"),
                (r"(?:republic of india|nationality|passport)", "Passport keyword"),
            ],
            "optional": [
                (r"[A-Z0-9<]{30,44}", "MRZ line"),
                (r"\d{2}[/\-\.]\d{2}[/\-\.]\d{4}", "Date"),
            ],
        },
        "SALARY_SLIP": {
            "required": [
                (r"(?:basic|basic salary|basic pay)", "Basic salary component"),
                (r"(?:net pay|net payable|take home|in.hand)", "Net pay field"),
            ],
            "optional": [
                (r"(?:hra|house rent)", "HRA component"),
                (r"(?:pf|provident fund|epf)", "PF deduction"),
                (r"(?:professional tax|pt)", "Professional Tax"),
            ],
        },
        "BANK_STATEMENT": {
            "required": [
                (r"[A-Z]{4}0[A-Z0-9]{6}", "IFSC code"),
                (r"(?:account|a/c)", "Account keyword"),
            ],
            "optional": [
                (r"\d{9,18}", "Account number"),
                (r"(?:debit|credit|transaction)", "Transaction keyword"),
            ],
        },
        "TENTH_CERTIFICATE": {
            "required": [
                (r"(?:secondary|class\s*[xX]|class\s*10|sslc|matriculation)", "Grade 10 keyword"),
                (r"(?:board|council|cbse|icse|sslc|msbshse)", "Board name"),
            ],
            "optional": [
                (r"(?:roll\s*no|registration\s*no)", "Roll number"),
                (r"(?:19|20)\d{2}", "Year of passing"),
            ],
        },
        "TWELFTH_CERTIFICATE": {
            "required": [
                (r"(?:senior\s*school|class\s*xii|class\s*12|hsc|intermediate|aissce|higher\s*secondary)", "Grade 12 keyword"),
                (r"(?:board|council|cbse|icse|msbshse)", "Board name"),
            ],
            "optional": [
                (r"(?:roll\s*no|registration\s*no)", "Roll number"),
                (r"(?:19|20)\d{2}", "Year of passing"),
            ],
        },
    }

    config = EXPECTED_PATTERNS.get(doc_type)
    if not config:
        return {
            "consistent": True,
            "score": 70,
            "reasons": [f"⚠ No template consistency rules defined for {doc_type} — manual review recommended"],
            "anomalies": [],
        }

    # Check required patterns
    for pattern, description in config.get("required", []):
        if re.search(pattern, text, re.IGNORECASE):
            reasons.append(f"✓ Expected field found: {description}")
        else:
            anomalies.append(f"✗ Missing expected field: {description}")
            score -= 25

    # Check optional patterns
    optional_found = 0
    for pattern, description in config.get("optional", []):
        if re.search(pattern, text, re.IGNORECASE):
            optional_found += 1

    optional_total = len(config.get("optional", []))
    if optional_total > 0:
        optional_ratio = optional_found / optional_total
        if optional_ratio >= 0.5:
            reasons.append(f"✓ {optional_found}/{optional_total} optional fields present — document looks complete")
        elif optional_ratio > 0:
            reasons.append(f"⚠ Only {optional_found}/{optional_total} optional fields detected — may be partial scan")
            score -= 10
        else:
            anomalies.append(f"✗ None of the {optional_total} optional fields detected — document content is unusual")
            score -= 15

    # Check for excessive numeric strings (possible templated/fake document)
    numeric_density = len(re.findall(r"\d", text)) / max(len(text), 1)
    if numeric_density > 0.4:
        anomalies.append(
            f"⚠ Unusually high numeric density ({int(numeric_density * 100)}%) — "
            f"genuine text documents typically have < 40% digits. Possible fake document with random numbers."
        )
        score -= 15

    score = max(0, min(100, score))
    consistent = score >= 50 and len(anomalies) == 0

    if consistent:
        reasons.insert(0, f"✓ Template consistency check PASSED (score: {score}/100) — document structure matches expected {doc_type.replace('_', ' ')} format")
    elif score >= 50:
        reasons.insert(0, f"⚠ Template consistency PARTIAL (score: {score}/100) — some expected fields missing from {doc_type.replace('_', ' ')}")
    else:
        anomalies.insert(0, f"✗ Template consistency check FAILED (score: {score}/100) — document does not match expected {doc_type.replace('_', ' ')} structure")

    return {
        "consistent": consistent,
        "score": score,
        "reasons": reasons,
        "anomalies": anomalies,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 10. ENHANCED SCREENSHOT DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def detect_screenshot_enhanced(image_bytes: Optional[bytes], text: str, doc_type: str) -> dict:
    """
    Multi-signal screenshot detection combining:
    - Pixel analysis (uniform background, no noise typical of camera)
    - Text pattern analysis (UI strings, status bar, timestamps)
    - Resolution analysis
    - Aspect ratio analysis (phone screenshots are tall and narrow)

    Returns:
      {
        is_screenshot: bool,
        confidence: float,  # 0.0-1.0
        signals: [str],
        risk_level: "NONE" | "LOW" | "MEDIUM" | "HIGH",
      }
    """
    signals = []
    screenshot_score = 0.0

    # ── Text-based signals ────────────────────────────────────────────────────
    text_lower = text.lower()
    # Photo IDs (Aadhaar, PAN, Passport) have lower screenshot tolerance than text docs
    screenshot_threshold = 0.3 if doc_type in ("AADHAAR", "PAN", "PASSPORT", "VOTER_ID", "DRIVING_LICENSE") else 0.4

    # UI navigation elements
    ui_patterns = [
        (r"\b(wifi|bluetooth|battery|signal|airplane mode)\b", "Phone status bar UI element"),
        (r"\b(tap to focus|swipe|pinch|zoom|slide)\b", "Touch UI instruction"),
        (r"\b(home|back|menu|settings|notifications?)\b", "Navigation UI element"),
        (r"\b(chrome|safari|firefox)\b.*\b(http|www)\b", "Browser UI"),
        (r"\d{1,2}:\d{2}\s*(am|pm)", "Clock/time display (typical of screenshots)"),
        (r"\b(kb|mb|gb)\s+(?:free|used|remaining|available)\b", "Storage indicator"),
        (r"(swipe up|swipe left|swipe right)", "Gesture instruction"),
    ]
    ui_hits = 0
    for pattern, label in ui_patterns:
        if re.search(pattern, text_lower):
            signals.append(f"⚠ Screenshot signal: {label} found in text")
            ui_hits += 1

    if ui_hits >= 2:
        screenshot_score += 0.4
    elif ui_hits == 1:
        screenshot_score += 0.15

    # ── Image-based signals ───────────────────────────────────────────────────
    if image_bytes:
        try:
            from PIL import Image as PILImage
            import numpy as np_local
            img = PILImage.open(BytesIO(image_bytes)).convert("RGB")
            w, h = img.size
            img_array = np_local.array(img)

            # Aspect ratio: phone screenshots are tall (portrait > 1.5:1)
            aspect = h / w if w > 0 else 1.0
            if aspect > 2.0:
                signals.append(f"⚠ Tall narrow image ({w}x{h}, ratio {aspect:.1f}) — matches phone screenshot dimensions")
                screenshot_score += 0.2
            elif aspect > 1.6:
                signals.append(f"⚠ Portrait image ratio ({w}x{h}) — could be phone screenshot")
                screenshot_score += 0.1

            # Uniform background detection
            # Convert to grayscale
            try:
                import cv2 as cv2_local
                gray = cv2_local.cvtColor(img_array, cv2_local.COLOR_RGB2GRAY)
                pixel_std = float(np_local.std(gray))
                if pixel_std < 12:
                    signals.append(f"⚠ Very uniform background (std={pixel_std:.1f}) — typical of digital screenshots, not scanned documents")
                    screenshot_score += 0.3
                elif pixel_std < 25:
                    signals.append(f"⚠ Low image texture variance (std={pixel_std:.1f}) — may be screenshot")
                    screenshot_score += 0.15

                # Check for grid-like pixel patterns (screen pixels have exact integer spacing)
                # Sample a row and check for repeating pixel patterns
                mid_row = gray[h // 2, :]
                if len(mid_row) > 100:
                    diffs = np_local.abs(np_local.diff(mid_row.astype(int)))
                    zero_diffs = np_local.sum(diffs == 0)
                    zero_ratio = zero_diffs / len(diffs)
                    if zero_ratio > 0.7:
                        signals.append(f"⚠ Highly uniform pixel rows ({int(zero_ratio*100)}% identical neighbors) — consistent with digital screenshot")
                        screenshot_score += 0.2

            except ImportError:
                # cv2 not available, use PIL-only path
                flat = np_local.array(img.convert("L")).flatten()
                pixel_std = float(np_local.std(flat))
                if pixel_std < 15:
                    signals.append("⚠ Low pixel variance — possible screenshot")
                    screenshot_score += 0.2

        except Exception:
            pass

    # ── Resolution check ──────────────────────────────────────────────────────
    if image_bytes:
        try:
            from PIL import Image as PILImage
            img = PILImage.open(BytesIO(image_bytes))
            w, h = img.size
            # Phone screenshots are typically 750-1440px wide
            # Scanned documents at 200 DPI for A4 = ~1654px wide
            if 400 <= w <= 1500 and 800 <= h <= 3000:
                if not any("phone screenshot" in s for s in signals):
                    signals.append(f"⚠ Image dimensions ({w}x{h}) match common phone screenshot sizes")
                    screenshot_score += 0.1
        except Exception:
            pass

    # ── Compute risk level ────────────────────────────────────────────────────
    screenshot_score = min(1.0, screenshot_score)
    is_screenshot = screenshot_score >= screenshot_threshold

    if screenshot_score >= 0.7:
        risk_level = "HIGH"
    elif screenshot_score >= 0.4:
        risk_level = "MEDIUM"
    elif screenshot_score >= 0.2:
        risk_level = "LOW"
    else:
        risk_level = "NONE"
        signals.append("✓ No screenshot signals detected — image appears to be a genuine scan or photo")

    return {
        "is_screenshot": is_screenshot,
        "confidence": round(screenshot_score, 2),
        "signals": signals,
        "risk_level": risk_level,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Updated run_deep_validators — integrates all new validators
# ─────────────────────────────────────────────────────────────────────────────

def run_deep_validators_v2(
    doc_type: str,
    extracted_fields: dict,
    raw_text: str,
    image_bytes: Optional[bytes] = None,
) -> dict:
    """
    Extended version of run_deep_validators with all new checks:
    - Aadhaar Verhoeff ✓
    - PAN structure + 5th char ✓
    - Passport MRZ ✓
    - EXIF tampering ✓
    - Face detection ✓
    - GST validation ✓
    - Document expiry (NEW)
    - Template consistency (NEW)
    - Enhanced screenshot detection (NEW)
    - Duplicate detection is handled at the batch level separately
    """
    all_reasons: list[str] = []
    extra_fields: dict = {}
    suspicion_boost = 0.0

    # ── Aadhaar Verhoeff ────────────────────────────────────────────────────
    if doc_type == "AADHAAR":
        aadhaar_no = extracted_fields.get("aadhaar_number", "")
        result = validate_aadhaar_verhoeff(aadhaar_no)
        all_reasons.append(result["reason"])
        if not result["is_valid"]:
            suspicion_boost += 0.25

    # ── PAN structure + 5th-char validation ─────────────────────────────────
    if doc_type == "PAN":
        pan_no = extracted_fields.get("pan_number", "")
        name = extracted_fields.get("name", "")
        result = validate_pan_structure(pan_no, name)
        all_reasons.extend(result["reasons"])
        failures = sum(1 for r in result["reasons"] if r.startswith("✗"))
        suspicion_boost += failures * 0.15

    # ── MRZ for Passport ────────────────────────────────────────────────────
    if doc_type == "PASSPORT":
        mrz_result = parse_and_validate_mrz(raw_text)
        all_reasons.extend(mrz_result["reasons"])
        if mrz_result.get("detected") and not mrz_result.get("is_valid"):
            suspicion_boost += 0.30
        if mrz_result.get("extracted"):
            extra_fields.update(mrz_result["extracted"])

    # ── Document expiry check (NEW) ──────────────────────────────────────────
    if doc_type in ("PASSPORT", "DRIVING_LICENSE", "VOTER_ID"):
        expiry_result = validate_document_expiry(doc_type, extracted_fields, raw_text)
        all_reasons.extend(expiry_result["reasons"])
        extra_fields["expiry_date"] = expiry_result.get("expiry_date")
        extra_fields["days_to_expiry"] = expiry_result.get("days_remaining")
        extra_fields["is_expired"] = expiry_result.get("is_expired", False)
        if expiry_result.get("is_expired"):
            suspicion_boost += 0.50  # Expired doc is a hard block

    # ── Template consistency check (NEW) ────────────────────────────────────
    if doc_type not in ("OTHER", "CERTIFICATE"):
        consistency = check_template_consistency(raw_text, doc_type)
        all_reasons.extend(consistency["reasons"])
        all_reasons.extend(consistency["anomalies"])
        extra_fields["template_consistency_score"] = consistency["score"]
        if not consistency["consistent"]:
            suspicion_boost += max(0.0, (50 - consistency["score"]) / 100.0)

    # ── EXIF tampering (image only) ─────────────────────────────────────────
    if image_bytes and doc_type in _IMAGE_BASED_TYPES:
        try:
            exif_result = check_exif_tampering(image_bytes)
            all_reasons.extend(exif_result["reasons"])
            if exif_result.get("is_suspicious"):
                suspicion_boost += 0.20 if exif_result["risk_level"] == "MEDIUM" else 0.40
            if exif_result.get("software"):
                extra_fields["exif_software"] = exif_result["software"]
            if exif_result.get("camera"):
                extra_fields["exif_camera"] = exif_result["camera"]
        except Exception as e:
            all_reasons.append(f"⚠ EXIF analysis skipped: {str(e)[:60]}")

    # ── Enhanced screenshot detection (NEW) ─────────────────────────────────
    if image_bytes and doc_type in _IMAGE_BASED_TYPES:
        try:
            screenshot_result = detect_screenshot_enhanced(image_bytes, raw_text, doc_type)
            if screenshot_result["is_screenshot"]:
                all_reasons.extend(screenshot_result["signals"])
                suspicion_boost += screenshot_result["confidence"] * 0.4
                extra_fields["screenshot_confidence"] = screenshot_result["confidence"]
            elif screenshot_result["signals"]:
                # Add low-risk signals but don't penalize
                for sig in screenshot_result["signals"]:
                    if sig.startswith("✓"):
                        all_reasons.append(sig)
        except Exception as e:
            logger.warning(f"Screenshot detection error: {e}")

    # ── Face detection (photo IDs) ──────────────────────────────────────────
    if image_bytes and doc_type in _PHOTO_ID_TYPES:
        try:
            face_result = detect_face_in_document(image_bytes)
            if face_result.get("face_detected") is not None:
                all_reasons.append(face_result["reason"])
                if not face_result["face_detected"]:
                    suspicion_boost += 0.10
                extra_fields["face_count"] = face_result.get("face_count", 0)
        except Exception as e:
            logger.warning(f"Face detection error: {e}")

    # ── GST validation (experience letters, bank statements) ─────────────────
    if doc_type in ("BANK_STATEMENT", "CERTIFICATE", "OTHER", "EXPERIENCE_LETTER", "OFFER_LETTER"):
        gstin_result = extract_and_validate_gstin(raw_text)
        if gstin_result:
            all_reasons.extend(gstin_result["reasons"])
            if gstin_result.get("embedded_pan"):
                extra_fields["gstin_detected"] = True
                extra_fields["gstin_state"] = gstin_result.get("state", "")

    return {
        "reasons": all_reasons,
        "extra_fields": extra_fields,
        "suspicion_boost": suspicion_boost,
    }
