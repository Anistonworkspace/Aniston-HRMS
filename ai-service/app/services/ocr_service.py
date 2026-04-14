import re
import logging
from typing import List
from PIL import Image
from io import BytesIO

logger = logging.getLogger(__name__)

# Graceful imports
try:
    import pytesseract
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

try:
    from pdf2image import convert_from_bytes
    HAS_PDF2IMAGE = True
except ImportError:
    HAS_PDF2IMAGE = False

try:
    import PyPDF2
    HAS_PYPDF2 = True
except ImportError:
    HAS_PYPDF2 = False

from ..models.ocr_models import OCRResult, AadhaarData, PANData, PassportData


# ===== IMAGE PREPROCESSING =====

def preprocess_image(image: Image.Image) -> Image.Image:
    """Enhance image quality for better OCR using OpenCV."""
    if not HAS_OPENCV:
        return image

    # Convert PIL to OpenCV format
    img_array = np.array(image)
    if len(img_array.shape) == 2:
        gray = img_array
    else:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)

    # 1. Upscale small images (< 1000px width)
    h, w = gray.shape[:2]
    if w < 1000:
        scale = 1500.0 / w
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    # 2. Denoise
    gray = cv2.fastNlMeansDenoising(gray, h=10)

    # 3. Contrast enhancement (CLAHE)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # 4. Adaptive thresholding for binarization
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)

    # 5. Deskew if needed
    coords = np.column_stack(np.where(binary < 128))
    if len(coords) > 100:
        try:
            angle = cv2.minAreaRect(coords)[-1]
            if angle < -45:
                angle = -(90 + angle)
            else:
                angle = -angle
            if abs(angle) > 0.5 and abs(angle) < 15:
                (h2, w2) = binary.shape[:2]
                center = (w2 // 2, h2 // 2)
                M = cv2.getRotationMatrix2D(center, angle, 1.0)
                binary = cv2.warpAffine(binary, M, (w2, h2), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        except Exception:
            pass

    return Image.fromarray(binary)


# ===== PDF HANDLING =====

def extract_text_from_pdf_native(pdf_bytes: bytes) -> str:
    """Extract text directly from PDF (works for digital/text-based PDFs)."""
    if not HAS_PYPDF2:
        return ""
    try:
        reader = PyPDF2.PdfReader(BytesIO(pdf_bytes))
        text_parts = []
        for page in reader.pages[:20]:  # Max 20 pages
            page_text = page.extract_text() or ""
            text_parts.append(page_text)
        return "\n".join(text_parts).strip()
    except Exception as e:
        logger.warning(f"PyPDF2 text extraction failed: {e}")
        return ""


MAX_PDF_PAGES_FOR_OCR = 50  # Reasonable limit — combined KYC PDFs rarely exceed 30 pages

def convert_pdf_to_images(pdf_bytes: bytes, last_page: int = MAX_PDF_PAGES_FOR_OCR) -> List[Image.Image]:
    """Convert PDF pages to images for OCR. Processes up to last_page pages (default 50)."""
    if not HAS_PDF2IMAGE:
        return []
    try:
        images = convert_from_bytes(pdf_bytes, dpi=300, first_page=1, last_page=last_page)
        return images
    except Exception as e:
        logger.warning(f"pdf2image conversion failed: {e}")
        return []


# ===== TEXT EXTRACTION =====

def extract_text_from_image(image_bytes: bytes) -> str:
    """Extract text from image using Tesseract OCR with preprocessing."""
    if not HAS_TESSERACT:
        return "[OCR not available — pytesseract not installed]"

    image = Image.open(BytesIO(image_bytes))

    # Preprocess for better results
    processed = preprocess_image(image)

    # Run Tesseract with both English and Hindi
    langs = "eng"
    try:
        # Try eng+hin if Hindi data available
        text = pytesseract.image_to_string(processed, lang="eng+hin")
    except Exception:
        text = pytesseract.image_to_string(processed, lang=langs)

    return text.strip()


def extract_text_from_document(file_bytes: bytes, filename: str) -> tuple:
    """Extract text from any document type. Returns (raw_text, source)."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    # Handle PDFs
    if ext == "pdf":
        # Try native PDF text extraction first (fast, works for digital PDFs)
        native_text = extract_text_from_pdf_native(file_bytes)
        if native_text and len(native_text) > 50:
            return native_text, "pdf_native"

        # Fall back to PDF → image → OCR (for scanned PDFs)
        images = convert_pdf_to_images(file_bytes)
        if images:
            all_text = []
            for img in images:
                processed = preprocess_image(img)
                if HAS_TESSERACT:
                    try:
                        page_text = pytesseract.image_to_string(processed, lang="eng+hin")
                    except Exception:
                        page_text = pytesseract.image_to_string(processed, lang="eng")
                    all_text.append(page_text.strip())
            combined = "\n\n".join(all_text)
            if combined:
                return combined, "pdf_ocr"

        # Last resort: return whatever native gave us
        if native_text:
            return native_text, "pdf_native_partial"
        return "[PDF text extraction failed — no poppler/pdf2image installed]", "failed"

    # Handle images
    if ext in ("jpg", "jpeg", "png", "webp", "bmp", "tiff"):
        text = extract_text_from_image(file_bytes)
        return text, "image_ocr"

    # Unsupported format
    return f"[Unsupported file format: .{ext}]", "unsupported"


# ===== DOCUMENT TYPE DETECTION =====

def detect_document_type(text: str) -> str:
    """Detect Indian document type from OCR text with fuzzy matching."""
    text_lower = text.lower()

    # Aadhaar — check keywords and 12-digit number pattern
    aadhaar_keywords = ["aadhaar", "aadhar", "unique identification", "uidai", "enrollment", "enrolment"]
    if any(kw in text_lower for kw in aadhaar_keywords) or re.search(r"\d{4}\s?\d{4}\s?\d{4}", text):
        return "AADHAAR"

    # PAN — check keywords and pattern
    pan_keywords = ["income tax", "permanent account", "pan card", "income-tax"]
    if any(kw in text_lower for kw in pan_keywords) or re.search(r"[A-Z]{5}\d{4}[A-Z]", text):
        return "PAN"
    # Fuzzy PAN pattern (OCR errors: O→0, l→1)
    if re.search(r"[A-Z0-9]{5}\d{4}[A-Z0-9]", text) and ("tax" in text_lower or "permanent" in text_lower):
        return "PAN"

    # Passport
    passport_keywords = ["passport", "republic of india", "nationality", "place of birth"]
    if any(kw in text_lower for kw in passport_keywords):
        return "PASSPORT"

    # Voter ID
    voter_keywords = ["voter", "election", "electoral", "electors"]
    if any(kw in text_lower for kw in voter_keywords):
        return "VOTER_ID"

    # Driving License
    dl_keywords = ["driving", "licence", "license", "transport", "motor vehicle"]
    if any(kw in text_lower for kw in dl_keywords):
        return "DRIVING_LICENSE"

    # Education certificates
    edu_keywords = ["marksheet", "certificate", "university", "board of", "examination", "grade sheet", "cgpa", "percentage"]
    if any(kw in text_lower for kw in edu_keywords):
        return "CERTIFICATE"

    # Bank statement
    bank_keywords = ["bank statement", "account statement", "ifsc", "branch"]
    if any(kw in text_lower for kw in bank_keywords):
        return "BANK_STATEMENT"

    return "OTHER"


# ===== FIELD EXTRACTION =====

def extract_aadhaar_fields(text: str) -> dict:
    """Extract fields from Aadhaar card text."""
    data = AadhaarData()

    # Aadhaar number: 4-digit groups (tolerant of OCR errors like O→0)
    cleaned = text.replace("O", "0").replace("o", "0").replace("l", "1").replace("I", "1")
    aadhaar_match = re.search(r"(\d{4}\s?\d{4}\s?\d{4})", cleaned)
    if aadhaar_match:
        data.aadhaar_number = re.sub(r"\s", "", aadhaar_match.group(1))

    # DOB patterns
    dob_match = re.search(r"(?:DOB|Date of Birth|Birth|Year of Birth|YoB)[:\s]*(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})", text, re.IGNORECASE)
    if not dob_match:
        dob_match = re.search(r"(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})", text)
    if dob_match:
        data.date_of_birth = dob_match.group(1)

    # Gender
    if re.search(r"\b(male|पुरुष|MALE)\b", text, re.IGNORECASE):
        data.gender = "MALE"
    elif re.search(r"\b(female|महिला|FEMALE)\b", text, re.IGNORECASE):
        data.gender = "FEMALE"

    # Name — usually first prominent text line
    lines = [l.strip() for l in text.split("\n") if l.strip() and len(l.strip()) > 3]
    skip_words = {"government", "india", "aadhaar", "unique", "dob", "male", "female", "uid", "enrollment",
                  "year", "birth", "address", "uidai", "help", "www", "http", "your", "aadhaar"}
    for line in lines[1:8]:
        if not re.search(r"\d{3}", line) and not any(kw in line.lower() for kw in skip_words):
            if re.match(r"^[A-Za-z\s\.]+$", line) and len(line) > 3:
                data.name = line.strip()
                break

    # Address — lines after "Address" keyword
    addr_match = re.search(r"(?:Address|addr)[:\s]*(.*?)(?:\n\n|\Z)", text, re.IGNORECASE | re.DOTALL)
    if addr_match:
        addr = addr_match.group(1).strip().replace("\n", ", ")[:200]
        data.address = addr

    return data.model_dump(exclude_none=True)


def extract_pan_fields(text: str) -> dict:
    """Extract fields from PAN card text."""
    data = PANData()

    # PAN number (tolerant)
    cleaned = text.replace("O", "0").replace("o", "0")
    pan_match = re.search(r"([A-Z]{5}\d{4}[A-Z])", cleaned)
    if not pan_match:
        pan_match = re.search(r"([A-Z]{3}[A-Z0-9]{2}\d{4}[A-Z0-9])", cleaned)
    if pan_match:
        data.pan_number = pan_match.group(1)

    # DOB
    dob_match = re.search(r"(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})", text)
    if dob_match:
        data.date_of_birth = dob_match.group(1)

    # Name lines — skip header keywords
    lines = [l.strip() for l in text.split("\n") if l.strip() and len(l.strip()) > 2]
    skip_words = {"income", "tax", "govt", "india", "permanent", "account", "department", "number", "card"}
    name_lines = []
    for line in lines:
        if not re.search(r"\d{3}", line) and not any(kw in line.lower() for kw in skip_words):
            if re.match(r"^[A-Za-z\s\.]+$", line):
                name_lines.append(line)
    if len(name_lines) >= 1:
        data.name = name_lines[0]
    if len(name_lines) >= 2:
        data.father_name = name_lines[1]

    return data.model_dump(exclude_none=True)


def extract_passport_fields(text: str) -> dict:
    """Extract fields from passport text."""
    data = PassportData()

    passport_match = re.search(r"([A-Z]\d{7})", text)
    if passport_match:
        data.passport_number = passport_match.group(1)

    dates = re.findall(r"(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})", text)
    if len(dates) >= 1:
        data.date_of_birth = dates[0]
    if len(dates) >= 2:
        data.expiry_date = dates[-1]

    # Name extraction
    lines = [l.strip() for l in text.split("\n") if l.strip() and len(l.strip()) > 3]
    for line in lines:
        if re.match(r"^[A-Z\s]+$", line) and len(line) > 4 and "INDIA" not in line and "REPUBLIC" not in line:
            data.name = line.title()
            break

    data.nationality = "INDIAN"
    return data.model_dump(exclude_none=True)


def extract_generic_fields(text: str) -> dict:
    """Extract whatever fields possible from unrecognized document types."""
    fields = {}

    # Try to find names (lines of only letters, 3+ chars)
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    for line in lines[:10]:
        if re.match(r"^[A-Za-z\s\.]+$", line) and 4 < len(line) < 60:
            fields["name"] = line.strip()
            break

    # Try to find dates
    dates = re.findall(r"(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})", text)
    if dates:
        fields["date_of_birth"] = dates[0]

    # Try to find common Indian ID numbers
    aadhaar = re.search(r"(\d{4}\s?\d{4}\s?\d{4})", text)
    if aadhaar:
        fields["aadhaar_number"] = re.sub(r"\s", "", aadhaar.group(1))

    pan = re.search(r"([A-Z]{5}\d{4}[A-Z])", text)
    if pan:
        fields["pan_number"] = pan.group(1)

    return fields


# ===== QUALITY / SUSPICION HEURISTICS =====

def assess_page_quality(image: "Image.Image", raw_text: str, page_idx: int) -> dict:
    """
    Assess whether a page looks like a legitimate scan vs a low-quality/screenshot/blank page.

    Returns a dict with:
      - quality: HIGH | MEDIUM | LOW
      - flags: list of suspicion signals
      - is_blank: bool
      - is_likely_screenshot: bool
    """
    flags = []
    text_len = len(raw_text.strip())

    # Blank / near-blank page detection
    is_blank = text_len < 15
    if is_blank:
        flags.append(f"Page {page_idx + 1}: Blank or near-blank — no readable text")

    # Very short text but not blank — possibly image-only or heavily corrupted
    if 15 <= text_len < 60:
        flags.append(f"Page {page_idx + 1}: Very little text extracted — may be a photo, graphic-only, or blurred page")

    # Screenshot heuristics — real scanned docs rarely have perfectly even pixel distributions
    is_likely_screenshot = False
    if HAS_OPENCV:
        try:
            import numpy as np
            import cv2
            img_array = np.array(image)
            if len(img_array.shape) == 3:
                gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
            else:
                gray = img_array

            h, w = gray.shape[:2]

            # Very uniform backgrounds (screenshots often have solid background)
            unique_vals = len(set(gray.flatten().tolist()[::100]))  # sample every 100th px
            if unique_vals < 20 and text_len > 50:
                is_likely_screenshot = True
                flags.append(f"Page {page_idx + 1}: Uniform background — possible screenshot")

            # Very low resolution (< 300x300)
            if w < 300 or h < 300:
                flags.append(f"Page {page_idx + 1}: Very low resolution ({w}x{h}px)")

        except Exception:
            pass

    # Determine quality tier
    if is_blank or is_likely_screenshot:
        quality = "LOW"
    elif text_len < 80:
        quality = "LOW"
    elif text_len < 200:
        quality = "MEDIUM"
    else:
        quality = "HIGH"

    return {
        "quality": quality,
        "flags": flags,
        "is_blank": is_blank,
        "is_likely_screenshot": is_likely_screenshot,
        "text_length": text_len,
    }


def detect_page_document_type(text: str, page_idx: int) -> dict:
    """
    Detect the Indian document type from a single page's OCR text.
    Returns detected type + confidence score.
    """
    doc_type = detect_document_type(text)

    # Compute a simple confidence for the detection
    text_len = len(text.strip())

    if text_len < 20:
        confidence = 0.1
    elif doc_type == "OTHER":
        confidence = 0.3
    elif doc_type in ("AADHAAR", "PAN"):
        # These have very distinctive patterns — high confidence if detected
        confidence = 0.9
    elif doc_type in ("PASSPORT", "VOTER_ID", "DRIVING_LICENSE"):
        confidence = 0.8
    elif doc_type == "CERTIFICATE":
        confidence = 0.7
    else:
        confidence = 0.5

    return {
        "page": page_idx + 1,
        "detected_type": doc_type,
        "confidence": confidence,
    }


# ===== COMBINED PDF CLASSIFIER =====

# Document types that map from OCR-detected to our system's DocumentType enum
OCR_TYPE_TO_DOC_TYPE: dict = {
    "AADHAAR": "AADHAAR",
    "PAN": "PAN",
    "PASSPORT": "PASSPORT",
    "VOTER_ID": "VOTER_ID",
    "DRIVING_LICENSE": "DRIVING_LICENSE",
    "CERTIFICATE": "DEGREE_CERTIFICATE",   # generic education cert — HR disambiguates
    "BANK_STATEMENT": "BANK_STATEMENT",
    "OTHER": "OTHER",
}

# Suspicion: if a detected type appears more than this many times, likely duplicated
MAX_REASONABLE_PAGES_PER_TYPE = {
    "AADHAAR": 2,        # front + back
    "PAN": 2,            # front + back
    "PASSPORT": 6,       # multiple pages
    "VOTER_ID": 2,
    "DRIVING_LICENSE": 2,
    "CERTIFICATE": 10,   # many certificates are ok
    "BANK_STATEMENT": 8, # multi-page statement
    "OTHER": 20,
}


async def classify_combined_pdf(pdf_bytes: bytes) -> dict:
    """
    Classify a multi-document combined PDF page by page.

    Returns:
      {
        total_pages: int,
        page_results: [{ page, detected_type, confidence, text_snippet, quality, flags }],
        detected_docs: ["AADHAAR", "PAN", ...],            # unique types found
        page_groups: [{ doc_type, pages: [1,2], confidence }],
        quality_flags: ["Page 3: Blank", ...],
        suspicion_flags: [...],
        suspicion_score: 0-100,
        summary: "..."
      }
    """
    if not HAS_PDF2IMAGE:
        return {
            "error": "pdf2image not available — cannot classify combined PDF",
            "total_pages": 0,
            "page_results": [],
            "detected_docs": [],
            "page_groups": [],
            "quality_flags": ["pdf2image library not installed — OCR-based page classification unavailable"],
            "suspicion_flags": [],
            "suspicion_score": 0,
            "summary": "Combined PDF classification unavailable (pdf2image not installed).",
        }

    try:
        images = convert_pdf_to_images(pdf_bytes)
    except Exception as e:
        return {
            "error": f"Failed to render PDF: {str(e)}",
            "total_pages": 0,
            "page_results": [],
            "detected_docs": [],
            "page_groups": [],
            "quality_flags": [f"PDF rendering failed: {str(e)}"],
            "suspicion_flags": [],
            "suspicion_score": 50,
            "summary": "Could not process the combined PDF. It may be corrupt, password-protected, or in an unsupported format.",
        }

    total_pages = len(images)
    page_results = []
    quality_flags = []
    suspicion_flags = []

    # Also try native text extraction for digital PDFs (faster, more accurate)
    native_text = extract_text_from_pdf_native(pdf_bytes)
    native_pages = [p.strip() for p in native_text.split("\x0c")] if native_text else []

    for idx, image in enumerate(images):
        # Use native text if available, else OCR
        if idx < len(native_pages) and len(native_pages[idx]) > 50:
            raw_text = native_pages[idx]
            source = "pdf_native"
        else:
            # Fall back to image OCR
            processed = preprocess_image(image)
            raw_text = ""
            if HAS_TESSERACT:
                try:
                    import pytesseract
                    raw_text = pytesseract.image_to_string(processed, lang="eng+hin")
                except Exception:
                    try:
                        raw_text = pytesseract.image_to_string(processed, lang="eng")
                    except Exception as e:
                        raw_text = ""
                        quality_flags.append(f"Page {idx + 1}: OCR failed — {str(e)}")
            source = "image_ocr"

        # Quality assessment
        quality_info = assess_page_quality(image, raw_text, idx)
        quality_flags.extend(quality_info["flags"])

        # Document type detection
        type_info = detect_page_document_type(raw_text, idx)

        # Add to results
        page_results.append({
            "page": idx + 1,
            "detected_type": type_info["detected_type"],
            "confidence": type_info["confidence"],
            "text_snippet": raw_text[:300].strip() if raw_text else "",
            "quality": quality_info["quality"],
            "is_blank": quality_info["is_blank"],
            "is_likely_screenshot": quality_info["is_likely_screenshot"],
            "source": source,
        })

    # Group consecutive pages by detected type
    page_groups = []
    if page_results:
        current_type = page_results[0]["detected_type"]
        current_pages = [page_results[0]["page"]]
        current_confidences = [page_results[0]["confidence"]]

        for pr in page_results[1:]:
            if pr["detected_type"] == current_type and pr["detected_type"] != "OTHER":
                current_pages.append(pr["page"])
                current_confidences.append(pr["confidence"])
            else:
                if current_type != "OTHER" or len(current_pages) > 1:
                    page_groups.append({
                        "doc_type": current_type,
                        "system_doc_type": OCR_TYPE_TO_DOC_TYPE.get(current_type, "OTHER"),
                        "pages": current_pages,
                        "avg_confidence": round(sum(current_confidences) / len(current_confidences), 2),
                    })
                current_type = pr["detected_type"]
                current_pages = [pr["page"]]
                current_confidences = [pr["confidence"]]

        # Flush last group
        page_groups.append({
            "doc_type": current_type,
            "system_doc_type": OCR_TYPE_TO_DOC_TYPE.get(current_type, "OTHER"),
            "pages": current_pages,
            "avg_confidence": round(sum(current_confidences) / len(current_confidences), 2),
        })

    # Unique detected doc types (excluding blanks and low confidence)
    detected_docs = list(set(
        OCR_TYPE_TO_DOC_TYPE.get(pr["detected_type"], "OTHER")
        for pr in page_results
        if not pr["is_blank"] and pr["confidence"] >= 0.4
    ))

    # Suspicion analysis
    suspicion_score = 0

    # Count blank pages
    blank_pages = [pr["page"] for pr in page_results if pr["is_blank"]]
    if blank_pages:
        suspicion_flags.append(f"Blank page(s) detected: {blank_pages}")
        suspicion_score += len(blank_pages) * 5

    # Screenshot pages
    screenshot_pages = [pr["page"] for pr in page_results if pr["is_likely_screenshot"]]
    if screenshot_pages:
        suspicion_flags.append(f"Possible screenshot on page(s): {screenshot_pages} — genuine scans are preferred")
        suspicion_score += len(screenshot_pages) * 15

    # Very low quality pages
    low_quality_pages = [pr["page"] for pr in page_results if pr["quality"] == "LOW" and not pr["is_blank"]]
    if low_quality_pages:
        suspicion_flags.append(f"Low quality page(s): {low_quality_pages}")
        suspicion_score += len(low_quality_pages) * 10

    # Duplicate document types (same type detected many times)
    from collections import Counter
    type_counts = Counter(pr["detected_type"] for pr in page_results if not pr["is_blank"])
    for t, count in type_counts.items():
        max_allowed = MAX_REASONABLE_PAGES_PER_TYPE.get(t, 5)
        if count > max_allowed:
            suspicion_flags.append(f"'{t}' appears on {count} pages — possible duplicate submission")
            suspicion_score += 20

    suspicion_score = min(100, suspicion_score)

    # Determine risk tier
    if suspicion_score >= 50:
        risk_level = "HIGH"
    elif suspicion_score >= 20:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    # Summary
    if total_pages == 0:
        summary = "No pages found in the PDF."
    else:
        summary = (
            f"Combined PDF contains {total_pages} page(s). "
            f"Detected document types: {', '.join(detected_docs) if detected_docs else 'None clearly identified'}. "
            f"Risk level: {risk_level}."
        )
        if suspicion_flags:
            summary += f" Issues: {'; '.join(suspicion_flags[:2])}."

    return {
        "total_pages": total_pages,
        "page_results": page_results,
        "detected_docs": detected_docs,
        "page_groups": page_groups,
        "quality_flags": quality_flags,
        "suspicion_flags": suspicion_flags,
        "suspicion_score": suspicion_score,
        "risk_level": risk_level,
        "summary": summary,
    }


# ===== MAIN PIPELINE =====

async def process_document(file_bytes: bytes, filename: str = "document.jpg") -> OCRResult:
    """Main document processing pipeline — handles images and PDFs."""

    # Extract text from any document type
    raw_text, source = extract_text_from_document(file_bytes, filename)

    # Detect document type
    doc_type = detect_document_type(raw_text)

    # Extract structured fields
    extracted = {}
    if doc_type == "AADHAAR":
        extracted = extract_aadhaar_fields(raw_text)
    elif doc_type == "PAN":
        extracted = extract_pan_fields(raw_text)
    elif doc_type == "PASSPORT":
        extracted = extract_passport_fields(raw_text)
    else:
        extracted = extract_generic_fields(raw_text)

    # Calculate confidence
    text_len = len(raw_text)
    field_count = len([v for v in extracted.values() if v])
    if field_count >= 3:
        confidence = 0.85
    elif field_count >= 1:
        confidence = 0.65
    elif text_len > 100:
        confidence = 0.45
    elif text_len > 20:
        confidence = 0.3
    else:
        confidence = 0.1

    return OCRResult(
        raw_text=raw_text,
        document_type=doc_type,
        extracted_fields=extracted,
        confidence=confidence,
        extraction_source=source,
    )
