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

from ..models.ocr_models import (
    OCRResult, AadhaarData, PANData, PassportData,
    VoterIdData, DrivingLicenseData, BankStatementData, EducationCertificateData,
)
from .validators import run_deep_validators, detect_wrong_upload


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
    """Detect Indian document type from OCR text with fuzzy matching and comprehensive coverage."""
    text_lower = text.lower()

    # ── Identity Documents ───────────────────────────────────────────────────

    # Aadhaar — check keywords and 12-digit number pattern
    aadhaar_keywords = ["aadhaar", "aadhar", "unique identification", "uidai", "enrollment", "enrolment",
                        "unique identity", "आधार", "भारतीय विशिष्ट"]
    if any(kw in text_lower for kw in aadhaar_keywords) or (
        re.search(r"\d{4}\s?\d{4}\s?\d{4}", text) and
        any(kw in text_lower for kw in ["government of india", "भारत सरकार", "enrolment", "dob"])
    ):
        return "AADHAAR"

    # PAN — check keywords and pattern
    pan_keywords = ["income tax", "permanent account", "pan card", "income-tax", "income tax department"]
    if any(kw in text_lower for kw in pan_keywords) or re.search(r"\b[A-Z]{5}\d{4}[A-Z]\b", text):
        return "PAN"
    # Fuzzy PAN pattern (OCR errors: O→0, l→1)
    if re.search(r"[A-Z0-9]{5}\d{4}[A-Z0-9]", text) and ("tax" in text_lower or "permanent" in text_lower):
        return "PAN"

    # Passport
    passport_keywords = ["passport", "republic of india", "nationality", "place of birth", "date of expiry",
                         "ministry of external affairs", "immigration"]
    if any(kw in text_lower for kw in passport_keywords):
        return "PASSPORT"

    # Voter ID
    voter_keywords = ["voter", "election commission", "electoral", "electors", "epic no", "electoral roll"]
    if any(kw in text_lower for kw in voter_keywords):
        return "VOTER_ID"

    # Driving License
    dl_keywords = ["driving licence", "driving license", "transport department", "motor vehicles act",
                   "regional transport", "valid till", "class of vehicle"]
    if any(kw in text_lower for kw in dl_keywords):
        return "DRIVING_LICENSE"

    # ── Education Certificates ───────────────────────────────────────────────

    # 12th certificate (must check before 10th)
    # CBSE uses "SENIOR SCHOOL CERTIFICATE EXAMINATION" (NOT "senior secondary")
    # ICSE uses "INDIAN SCHOOL CERTIFICATE"
    # Maharashtra uses "HIGHER SECONDARY CERTIFICATE"
    # UP Board uses "INTERMEDIATE EDUCATION" / "COUNCIL OF HIGHER SECONDARY EDUCATION"
    # Karnataka uses "PRE-UNIVERSITY COURSE" / "II PUC"
    twelfth_keywords = [
        "senior school certificate", "class xii", "class 12", "12th grade",
        "higher secondary certificate", "aissce", "intermediate examination",
        "senior secondary certificate", "hsc examination", "plus two",
        "council of higher secondary", "class-xii",
        "indian school certificate",                # ICSE 12th
        "isc examination",                          # ICSE 12th
        "ii puc", "second puc", "pre-university course",  # Karnataka PUC
        "intermediate education",                   # UP Board 12th
        "maharashtra hsc",                          # Maharashtra HSC
        "higher secondary examination",
        "board of intermediate",                    # Various state boards
        "all india senior school certificate",      # CBSE alternative name
        "class 12th", "std xii", "std. xii",
    ]
    if any(kw in text_lower for kw in twelfth_keywords):
        return "TWELFTH_CERTIFICATE"
    # CBSE 12th: "Marks Statement" + "Secondary Education" without Class-X indicators
    if ("marks statement" in text_lower or "senior school" in text_lower) and "secondary" in text_lower:
        return "TWELFTH_CERTIFICATE"

    # 10th certificate
    # CBSE: "SECONDARY SCHOOL EXAMINATION" / "CLASS X"
    # ICSE: "INDIAN CERTIFICATE OF SECONDARY EDUCATION"
    # Maharashtra: "SECONDARY SCHOOL CERTIFICATE" (SSC)
    # Tamil Nadu/Kerala/AP: "SSLC"
    # UP Board: "HIGH SCHOOL EXAMINATION"
    tenth_keywords = [
        "secondary examination", "class x", "class-x", "10th grade", "sslc",
        "matriculation", "high school examination", "secondary school examination",
        "examination results",
        "indian certificate of secondary education",  # ICSE 10th
        "icse examination",                           # ICSE 10th
        "secondary school certificate",               # Maharashtra SSC
        "msbshse",                                    # Maharashtra State Board
        "all india secondary school examination",     # CBSE
        "high school certificate",
        "class 10", "class-10", "std x", "std. x",
        "board of secondary education",               # Various state boards
        "board of school education",
    ]
    if any(kw in text_lower for kw in tenth_keywords):
        return "TENTH_CERTIFICATE"

    # Post-graduation / Masters
    # IGNOU: "Indira Gandhi National Open University"
    # Samarth portal certificate
    pg_keywords = [
        "master of arts", "master of science", "master of commerce", "mba", "mca", "m.tech",
        "m.sc", "m.com", "m.a.", "post graduate", "indira gandhi national open university",
        "ignou", "master's degree", "m. tech", "m. sc", "m. com", "m. a.",
        "master of technology", "master of business", "master of computer",
        "samarth portal", "distance education council",
        "post-graduate degree", "pg diploma", "post graduate diploma",
    ]
    if any(kw in text_lower for kw in pg_keywords):
        return "POST_GRADUATION_CERTIFICATE"

    # General education certificates (degree / diploma)
    # Provisional certificate is still a degree cert
    edu_keywords = [
        "university", "board of", "grade sheet", "cgpa", "bachelor of", "b.tech", "b.sc",
        "b.com", "b.a.", "statement of marks", "marks and grades",
        "provisional certificate",                    # Provisional degree
        "convocation ceremony",                       # Convocation cert
        "awarded the degree", "confers the degree",   # Degree language
        "bachelor of engineering", "bachelor of science",
        "b.e.", "b.tech.", "bca", "bba", "llb", "b.arch",
    ]
    if any(kw in text_lower for kw in edu_keywords):
        return "CERTIFICATE"

    # ── Employment Documents ─────────────────────────────────────────────────

    # Offer letter / appointment letter
    offer_keywords = ["offer letter", "appointment letter", "offer of employment",
                      "pleased to inform you that you are selected", "joining date",
                      "please join", "you are required to join"]
    if any(kw in text_lower for kw in offer_keywords):
        return "OFFER_LETTER"

    # Resignation letter / email
    resignation_keywords = [
        "resignation", "last working day", "formally inform you of my resignation",
        "acceptance of resignation", "relieved from", "i hereby resign",
        "notice of resignation", "submitting my resignation", "two weeks notice",
        "one month notice", "relieving you from", "acceptance of your resignation",
    ]
    if any(kw in text_lower for kw in resignation_keywords):
        return "RESIGNATION_LETTER"

    # Experience / relieving letter
    experience_keywords = [
        "experience letter", "relieving letter", "this is to certify that",
        "was employed with us", "relieved from the services", "to whom it may concern",
        "employment certificate", "service certificate", "worked with us",
        "he/she has worked", "she has worked", "he has worked",
        "period of employment",
    ]
    if any(kw in text_lower for kw in experience_keywords):
        return "EXPERIENCE_LETTER"

    # Salary slip / payslip
    # Indian payslips use PAYSLIP, PAY SLIP, SALARY SLIP, WAGE SLIP
    # Key fields: Basic, HRA, DA, PF, ESI, Net Pay, Gross Pay
    salary_keywords = [
        "payslip", "pay slip", "payslip for the month", "net pay for the month",
        "salary slip", "pay stub", "earnings", "deductions", "epf contribution",
        "basic salary", "house rent allowance", "provident fund",
        "esi contribution", "professional tax", "net pay", "gross pay",
        "salary for the month", "wage slip", "pf no.", "uan no.",
        "employee provident fund", "take home", "in-hand salary",
    ]
    if any(kw in text_lower for kw in salary_keywords):
        return "SALARY_SLIP"

    # ── Financial / Residence Documents ─────────────────────────────────────

    # Cancelled cheque — check before bank statement (more specific)
    cheque_keywords = [
        "cancelled", "cancelled cheque", "cancel cheque",
    ]
    if any(kw in text_lower for kw in cheque_keywords) and any(kw in text_lower for kw in ["cheque", "check", "bank", "ifsc", "micr", "account"]):
        return "CANCELLED_CHEQUE"

    # Bank passbook page
    passbook_keywords = ["passbook", "savings passbook", "sb passbook"]
    if any(kw in text_lower for kw in passbook_keywords):
        return "BANK_STATEMENT"

    # Utility bills (electricity, water, gas) — residence proof
    # Includes all major Indian DISCOMs
    utility_keywords = [
        "electricity bill", "electric bill", "water bill", "gas bill",
        "telephone bill", "broadband bill", "internet bill",
        # North India DISCOMs
        "pvvnl", "dvvnl", "mvvnl", "puvvnl",            # UP electricity boards
        "paschimanchal vidyut", "dakshinanchal vidyut",
        "madhyanchal vidyut", "purvanchal vidyut",
        "tpddl", "tata power delhi",                      # Delhi
        "bses rajdhani", "bses yamuna",
        "dhbvnl", "uhbvnl",                              # Haryana
        "pspcl",                                          # Punjab
        "jvvnl", "avvnl",                                # Rajasthan
        # West India DISCOMs
        "msedcl", "mseb", "mahadiscom",                  # Maharashtra
        "bescom", "hescom", "cescom", "gescom", "mescom", "hubli electricity",  # Karnataka
        "pgvcl", "ugvcl", "dgvcl", "mgvcl",              # Gujarat
        # South India DISCOMs
        "tneb", "tangedco",                               # Tamil Nadu
        "apepdcl", "apspdcl",                            # Andhra Pradesh
        "tsspdcl", "tsnpdcl",                            # Telangana
        "kseb",                                           # Kerala
        # East India DISCOMs
        "wesco", "nesco", "southco", "tpwodl",           # Odisha
        "cesc",                                           # West Bengal
        "nbpdcl", "sbpdcl",                              # Bihar
        "apdcl",                                          # Assam
        "torrent power", "adani electricity",
        # Generic utility keywords
        "bill month", "meter no", "meter number",
        "units consumed", "amount payable", "consumer no",
        "consumer number", "ca number", "discoms", "vidyut vitaran",
        "electricity charges", "previous reading", "present reading",
        "bill amount", "due date", "billing period",
    ]
    if any(kw in text_lower for kw in utility_keywords):
        return "UTILITY_BILL"

    # Bank statement / account statement
    # Key indicators: IFSC code format (AAAA0XXXXXX), account number, transactions
    bank_keywords = [
        "bank statement", "account statement", "ifsc", "branch", "account no",
        "account number", "account holder", "passbook", "micr",
        "opening balance", "closing balance", "transaction", "debit", "credit",
        "neft", "rtgs", "imps", "upi", "cheque number",
        "state bank", "hdfc bank", "icici bank", "axis bank", "kotak bank",
        "punjab national bank", "bank of baroda", "canara bank", "union bank",
        "yes bank", "idbi bank", "federal bank", "south indian bank",
    ]
    # IFSC code pattern detection
    if re.search(r'\b[A-Z]{4}0[A-Z0-9]{6}\b', text):
        return "BANK_STATEMENT"
    if any(kw in text_lower for kw in bank_keywords):
        return "BANK_STATEMENT"

    # Rent agreement / lease deed (residence proof)
    rent_keywords = [
        "rent agreement", "lease agreement", "tenancy agreement", "leave and licence",
        "rent deed", "monthly rent", "rental agreement", "licensor", "licensee",
        "landlord", "tenant", "lease deed", "license agreement",
    ]
    if any(kw in text_lower for kw in rent_keywords):
        return "RENT_AGREEMENT"

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

    # Name — usually first prominent text line after government headers
    lines = [l.strip() for l in text.split("\n") if l.strip() and len(l.strip()) > 3]
    AADHAAR_SKIP = {
        "government", "india", "aadhaar", "unique", "dob", "male", "female",
        "uid", "enrollment", "enrolment", "year", "birth", "address", "uidai",
        "help", "www", "http", "your", "republic", "of", "identification",
        "authority", "आधार", "भारत", "सरकार", "आयोग",
    }
    for line in lines[:12]:
        if not re.search(r"\d{3}", line) and not any(kw in line.lower() for kw in AADHAAR_SKIP):
            if re.match(r"^[A-Za-z\s\.]+$", line):
                stripped = line.strip()
                # Require at least 2 words OR a single long word >= 5 chars (some people have single names)
                words = [w for w in stripped.split() if len(w) >= 2]
                if (len(words) >= 2 or (len(words) == 1 and len(stripped) >= 5)) and len(stripped) >= 4:
                    data.name = stripped
                    break

    # Address — lines after "Address" keyword
    addr_match = re.search(r"(?:Address|addr)[:\s]*(.*?)(?:\n\n|\Z)", text, re.IGNORECASE | re.DOTALL)
    if addr_match:
        addr = addr_match.group(1).strip().replace("\n", ", ")[:200]
        data.address = addr

    return data.model_dump(exclude_none=True)


def extract_pan_fields(text: str) -> dict:
    """
    Extract fields from PAN card text.

    PAN card layout (top → bottom):
      INCOME TAX DEPARTMENT / GOVT. OF INDIA (header)
      [Cardholder Name — prominent, large text]
      [Father's / Mother's Name — smaller]
      [Date of Birth DD/MM/YYYY]
      [PAN number ABCDE1234F]

    Key fix: require name lines to have ≥2 words (single-word OCR artifacts like
    "ARR" or "ST" are filtered out).
    """
    data = PANData()

    # PAN number — most reliable field (strict format ABCDE1234F)
    pan_match = re.search(r"\b([A-Z]{5}\d{4}[A-Z])\b", text)
    if not pan_match:
        # Tolerant OCR: O→0 substitution already baked in source, try anyway
        cleaned = text.replace("O", "0")
        pan_match = re.search(r"\b([A-Z]{5}\d{4}[A-Z])\b", cleaned)
    if pan_match:
        data.pan_number = pan_match.group(1)

    # DOB — DD/MM/YYYY or DD-MM-YYYY
    dob_match = re.search(r"(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})", text)
    if dob_match:
        data.date_of_birth = dob_match.group(1)

    # Name extraction — structural approach for PAN card layout
    # Skip government header keywords
    SKIP_WORDS = {
        "income", "tax", "govt", "government", "india", "permanent",
        "account", "department", "number", "card", "आयकर", "विभाग",
        "भारत", "सरकार", "signature", "हस्ताक्षर", "date", "birth",
        "father", "mother", "sthayi", "lekha", "sankhya", "of",
    }

    lines = [l.strip() for l in text.split("\n") if l.strip()]
    name_candidates = []
    for line in lines:
        # Must consist only of letters, spaces, and dots (no digits, symbols)
        if not re.match(r"^[A-Za-z\s\.]+$", line):
            continue
        stripped = line.strip()
        # CRITICAL FIX: require at least 2 words (filters "ARR", "ST", single-word OCR artifacts)
        words = [w for w in stripped.split() if len(w) >= 2]
        if len(words) < 2:
            continue
        # Min total length — "A B" (3) would slip through word check, so add floor
        if len(stripped) < 6:
            continue
        # Skip if any word matches a header keyword
        if any(kw in stripped.lower() for kw in SKIP_WORDS):
            continue
        name_candidates.append(stripped)

    if len(name_candidates) >= 1:
        data.name = name_candidates[0]
    if len(name_candidates) >= 2:
        data.father_name = name_candidates[1]

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


# ===== ADDITIONAL INDIAN DOCUMENT EXTRACTORS =====

def extract_voter_id_fields(text: str) -> dict:
    """Extract fields from Voter ID (EPIC) card."""
    data = VoterIdData()

    # EPIC number: typically 3 letters + 7 digits, e.g. ABC1234567
    epic_match = re.search(r"\b([A-Z]{3}\d{7})\b", text)
    if epic_match:
        data.epic_number = epic_match.group(1)

    # DOB or Year of Birth
    dob_match = re.search(r"(?:DOB|Date of Birth|Birth)[:\s]*(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})", text, re.IGNORECASE)
    if not dob_match:
        dob_match = re.search(r"(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})", text)
    if dob_match:
        data.date_of_birth = dob_match.group(1)

    # Gender
    if re.search(r"\b(male|MALE|पुरुष)\b", text, re.IGNORECASE):
        data.gender = "MALE"
    elif re.search(r"\b(female|FEMALE|महिला)\b", text, re.IGNORECASE):
        data.gender = "FEMALE"

    # Name — after "Name:" label
    name_match = re.search(r"(?:Name|नाम)[:\s]+([A-Za-z][A-Za-z\s\.]{4,50})", text, re.IGNORECASE)
    if name_match:
        data.name = name_match.group(1).strip()

    # Father / Husband name
    father_match = re.search(r"(?:Father|Husband|Father's Name|पिता)[:\s/]+([A-Za-z][A-Za-z\s\.]{4,50})", text, re.IGNORECASE)
    if father_match:
        data.father_name = father_match.group(1).strip()

    # Address
    addr_match = re.search(r"(?:Address|पता)[:\s]*(.*?)(?:\n\n|\Z)", text, re.IGNORECASE | re.DOTALL)
    if addr_match:
        data.address = addr_match.group(1).strip().replace("\n", ", ")[:200]

    return data.model_dump(exclude_none=True)


def extract_driving_license_fields(text: str) -> dict:
    """Extract fields from Indian Driving License."""
    data = DrivingLicenseData()

    # DL number — format varies by state, e.g. MH0120201234567 or DL-1420110012345
    dl_match = re.search(r"\b([A-Z]{2}[\-\s]?\d{2}[\-\s]?\d{4}[\-\s]?\d{7})\b", text)
    if not dl_match:
        # Alternate shorter format
        dl_match = re.search(r"\b([A-Z]{2}\d{13})\b", text)
    if dl_match:
        data.dl_number = dl_match.group(1).replace(" ", "").replace("-", "")

    # Dates
    dates = re.findall(r"(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})", text)
    if dates:
        data.date_of_birth = dates[0]
    if len(dates) >= 2:
        data.issue_date = dates[1]
    if len(dates) >= 3:
        data.expiry_date = dates[-1]

    # Name — after "Name:" label
    name_match = re.search(r"(?:Name|नाम)[:\s]+([A-Za-z][A-Za-z\s\.]{4,50})", text, re.IGNORECASE)
    if name_match:
        data.name = name_match.group(1).strip()

    # Class of Vehicle (COV)
    cov_match = re.search(r"(?:COV|Class of Vehicle|Authorisation)[:\s]+([A-Z0-9,\s/]{2,40})", text, re.IGNORECASE)
    if cov_match:
        data.class_of_vehicle = cov_match.group(1).strip()

    # Address
    addr_match = re.search(r"(?:Address|पता)[:\s]*(.*?)(?:\n\n|\Z)", text, re.IGNORECASE | re.DOTALL)
    if addr_match:
        data.address = addr_match.group(1).strip().replace("\n", ", ")[:200]

    return data.model_dump(exclude_none=True)


def extract_bank_statement_fields(text: str) -> dict:
    """Extract fields from bank statement / cancelled cheque."""
    data = BankStatementData()

    # IFSC code — standard format XXXX0XXXXXX (4 letters, 0, 6 alphanumeric)
    ifsc_match = re.search(r"\b([A-Z]{4}0[A-Z0-9]{6})\b", text)
    if ifsc_match:
        data.ifsc_code = ifsc_match.group(1)

    # Account number — 9-18 digit sequence (labeled)
    acc_match = re.search(
        r"(?:Account\s*(?:Number|No\.?)|A/C\s*(?:No\.?)|Acc\.?\s*No\.?)[:\s]*(\d{9,18})",
        text, re.IGNORECASE
    )
    if acc_match:
        data.account_number = acc_match.group(1)

    # Bank name — look for common Indian bank names
    BANKS = [
        "State Bank of India", "SBI", "HDFC Bank", "ICICI Bank", "Axis Bank",
        "Punjab National Bank", "PNB", "Bank of Baroda", "Canara Bank",
        "Union Bank", "Kotak Mahindra", "YES Bank", "IDBI Bank", "Federal Bank",
        "IndusInd Bank", "Bank of India", "UCO Bank", "Central Bank",
        "Indian Bank", "Indian Overseas Bank",
    ]
    text_lower = text.lower()
    for bank in BANKS:
        if bank.lower() in text_lower:
            data.bank_name = bank
            break

    # Account holder name — after "Name:" or "Account Holder" label
    name_match = re.search(
        r"(?:Account\s*Holder|Name|Customer\s*Name)[:\s]+([A-Za-z][A-Za-z\s\.]{4,60})",
        text, re.IGNORECASE
    )
    if name_match:
        candidate = name_match.group(1).strip()
        if len(candidate.split()) >= 1:
            data.account_holder_name = candidate

    # Branch
    branch_match = re.search(r"(?:Branch)[:\s]+([A-Za-z0-9\s,\-\.]{4,60})", text, re.IGNORECASE)
    if branch_match:
        data.branch = branch_match.group(1).strip()

    return data.model_dump(exclude_none=True)


def extract_education_certificate_fields(text: str) -> dict:
    """Extract fields from education certificates (marksheets, degrees)."""
    data = EducationCertificateData()

    # Student name — after "Name:", "Student:", "This is to certify that"
    name_match = re.search(
        r"(?:Name\s*of\s*(?:the\s*)?(?:Student|Candidate)|Name|This is to certify that)[:\s]+([A-Za-z][A-Za-z\s\.]{4,60})",
        text, re.IGNORECASE
    )
    if name_match:
        candidate = name_match.group(1).strip()
        # Trim if it hits a next sentence keyword
        for stopper in ["has", "passed", "appeared", "of", "in", "for", "with", "to"]:
            idx = candidate.lower().find(f" {stopper} ")
            if idx > 0:
                candidate = candidate[:idx]
        data.student_name = candidate.strip()

    # Roll number / Enrollment number
    roll_match = re.search(
        r"(?:Roll\s*(?:Number|No\.?)|Enrollment\s*(?:No\.?|Number)|Registration\s*(?:No\.?|Number))[:\s]+([A-Z0-9\-/]{4,20})",
        text, re.IGNORECASE
    )
    if roll_match:
        data.roll_number = roll_match.group(1).strip()

    # Year of passing
    year_match = re.search(r"\b((?:19|20)\d{2})\b", text)
    if year_match:
        data.year_of_passing = year_match.group(1)

    # Grade / Percentage / CGPA
    grade_match = re.search(
        r"(?:Percentage|%|CGPA|GPA|Grade)[:\s]+([0-9\.]+\s*%?)",
        text, re.IGNORECASE
    )
    if grade_match:
        data.percentage_or_cgpa = grade_match.group(1).strip()

    # Institution name — look for University/Board/School/Institute keywords
    lines = [l.strip() for l in text.split("\n") if l.strip() and len(l.strip()) > 5]
    for line in lines[:8]:
        if any(kw in line.lower() for kw in ["university", "board", "institute", "college", "school", "vidyalaya"]):
            data.institution = line.strip()
            break

    # Board / University (from "Board of" patterns)
    board_match = re.search(r"(?:Board of|University of|Affiliated to)\s+([A-Za-z\s,\.]{5,80})", text, re.IGNORECASE)
    if board_match:
        data.board_or_university = board_match.group(1).strip()

    # Degree / Course name
    degree_match = re.search(
        r"(?:Degree|Course|Programme|This is to certify.*?\s)(Bachelor|Master|B\.?(?:Sc|A|E|Tech|Com)|M\.?(?:Sc|A|E|Tech|Com|BA)|MBA|MCA|BCA|Ph\.?D|Diploma)\b",
        text, re.IGNORECASE
    )
    if degree_match:
        data.degree_or_course = degree_match.group(1).strip()

    return data.model_dump(exclude_none=True)


def extract_dynamic_fields(text: str) -> dict:
    """
    Capture any label: value pairs present in the OCR text that are NOT
    covered by the typed extractors. Useful for edge-case fields and
    country-specific document formats.

    Returns up to 20 key-value pairs.
    """
    # Match patterns like "Field Name: Value text" or "Field Name - Value"
    pattern = re.compile(
        r"^([A-Za-z][A-Za-z0-9 /\-\.]{2,35})\s*[:\-]\s*([A-Za-z0-9][^\n]{1,80})",
        re.MULTILINE,
    )
    matches = pattern.findall(text)

    # Filter out noise: skip keys that are too generic or values that look like OCR artifacts
    NOISE_KEYS = {
        "note", "signature", "stamp", "seal", "page", "total", "number", "name",
        "date", "address", "www", "http", "the", "this", "that",
    }
    result = {}
    for key, value in matches:
        key_clean = key.strip().lower()
        if key_clean in NOISE_KEYS:
            continue
        value_clean = value.strip()
        if len(value_clean) < 2 or len(value_clean) > 100:
            continue
        # Skip pure number values that are just noise
        if re.match(r"^\d{1,3}$", value_clean):
            continue
        result[key.strip()] = value_clean
        if len(result) >= 20:
            break

    return result


def generate_validation_reasons(
    doc_type: str,
    fields: dict,
    confidence: float,
    raw_text: str,
    quality_flags: list = None,
) -> list:
    """
    Generate human-readable validation reasons explaining why a document
    passed, has warnings, or is flagged as suspicious. Used by HR to
    understand the OCR result without reading raw text.

    Returns a list of strings prefixed with ✓ (pass), ⚠ (warning), or ✗ (fail).
    """
    reasons = []
    quality_flags = quality_flags or []

    # ---- Confidence ----
    pct = int(confidence * 100)
    if confidence >= 0.80:
        reasons.append(f"✓ OCR confidence is high ({pct}%) — text extracted clearly")
    elif confidence >= 0.60:
        reasons.append(f"⚠ OCR confidence is moderate ({pct}%) — some fields may need manual review")
    else:
        reasons.append(f"✗ OCR confidence is low ({pct}%) — document may be unclear, blurred, or a screenshot")

    # ---- Document-specific validations ----
    if doc_type == "PAN":
        pan_no = fields.get("pan_number", "")
        if pan_no and re.match(r"^[A-Z]{5}\d{4}[A-Z]$", pan_no):
            # Check 4th char of PAN encodes entity type: P=individual, C=company, H=HUF, etc.
            entity_type = {"P": "Individual", "C": "Company", "H": "HUF", "F": "Firm",
                           "A": "AOP", "T": "Trust", "B": "BOI", "L": "Local Authority",
                           "J": "AOP/BOI", "G": "Government"}.get(pan_no[3], "Unknown")
            reasons.append(f"✓ PAN number {pan_no} is valid — format [A-Z]{{5}}[0-9]{{4}}[A-Z] confirmed")
            reasons.append(f"✓ PAN entity type: {entity_type} (4th character '{pan_no[3]}')")
        elif pan_no:
            reasons.append(f"✗ PAN number '{pan_no}' does not match standard format — may be corrupted by OCR")
        else:
            reasons.append("✗ PAN number could not be extracted — document may be low quality or not a PAN card")

        name = fields.get("name", "")
        if name and len(name.split()) >= 2:
            reasons.append(f"✓ Name extracted successfully: '{name}'")
        elif name:
            reasons.append(f"⚠ Only partial name extracted: '{name}' — may be a single-name holder or OCR artifact")
        else:
            reasons.append("✗ Name could not be extracted from PAN card")

        father = fields.get("father_name", "")
        if father and len(father.split()) >= 2:
            reasons.append(f"✓ Father's name extracted: '{father}'")
        elif father:
            reasons.append(f"⚠ Father's name appears partial: '{father}'")
        else:
            reasons.append("⚠ Father's name not found — may be on reverse side or not visible in scan")

        dob = fields.get("date_of_birth", "")
        if dob:
            reasons.append(f"✓ Date of Birth extracted: {dob}")
        else:
            reasons.append("⚠ Date of Birth not found in PAN text")

    elif doc_type == "AADHAAR":
        aadhaar_no = fields.get("aadhaar_number", "")
        if aadhaar_no and len(re.sub(r"\D", "", aadhaar_no)) == 12:
            reasons.append(f"✓ Aadhaar number found with correct 12-digit length")
            # First digit cannot be 0 or 1
            digits = re.sub(r"\D", "", aadhaar_no)
            if digits[0] in "01":
                reasons.append(f"⚠ Aadhaar first digit is {digits[0]} — valid Aadhaar numbers start with 2-9")
            else:
                reasons.append(f"✓ Aadhaar number format appears valid (starts with {digits[0]})")
        elif aadhaar_no:
            reasons.append(f"✗ Aadhaar number '{aadhaar_no}' does not have 12 digits — possible OCR error")
        else:
            reasons.append("✗ Aadhaar 12-digit number not detected in text")

        if fields.get("name"):
            reasons.append(f"✓ Name extracted: '{fields['name']}'")
        else:
            reasons.append("⚠ Name not extracted from Aadhaar")

        if fields.get("date_of_birth"):
            reasons.append(f"✓ Date of Birth: {fields['date_of_birth']}")

        if fields.get("gender"):
            reasons.append(f"✓ Gender detected: {fields['gender']}")

        if fields.get("address"):
            reasons.append("✓ Address field detected on Aadhaar")

    elif doc_type == "PASSPORT":
        pp_no = fields.get("passport_number", "")
        if pp_no and re.match(r"^[A-Z]\d{7}$", pp_no):
            reasons.append(f"✓ Passport number {pp_no} matches Indian passport format")
        elif pp_no:
            reasons.append(f"⚠ Passport number '{pp_no}' — verify manually against document")
        else:
            reasons.append("✗ Passport number could not be extracted")

        if fields.get("expiry_date"):
            reasons.append(f"✓ Expiry date found: {fields['expiry_date']} — verify it has not expired")

    elif doc_type == "VOTER_ID":
        epic = fields.get("epic_number", "")
        if epic and re.match(r"^[A-Z]{3}\d{7}$", epic):
            reasons.append(f"✓ Voter ID (EPIC) number {epic} matches expected format")
        elif epic:
            reasons.append(f"⚠ EPIC number '{epic}' — verify manually")
        else:
            reasons.append("⚠ EPIC number not detected — check if document is a Voter ID card")

    elif doc_type == "DRIVING_LICENSE":
        dl_no = fields.get("dl_number", "")
        if dl_no:
            reasons.append(f"✓ Driving License number extracted: {dl_no}")
        else:
            reasons.append("⚠ DL number not clearly detected — verify manually")
        if fields.get("expiry_date"):
            reasons.append(f"✓ Expiry date: {fields['expiry_date']} — check if license is still valid")

    elif doc_type == "BANK_STATEMENT":
        reasons.append("✓ Bank statement / passbook detected — valid as bank proof and residence proof")
        ifsc = fields.get("ifsc_code", "")
        if ifsc and re.match(r"^[A-Z]{4}0[A-Z0-9]{6}$", ifsc):
            reasons.append(f"✓ IFSC code {ifsc} matches standard format (bank: {ifsc[:4]})")
        elif ifsc:
            reasons.append(f"⚠ IFSC code '{ifsc}' — verify against bank records")
        else:
            # Try to detect IFSC directly from raw text as fallback
            ifsc_match = re.search(r'\b([A-Z]{4}0[A-Z0-9]{6})\b', raw_text)
            if ifsc_match:
                reasons.append(f"✓ IFSC code found in document: {ifsc_match.group(1)} (bank: {ifsc_match.group(1)[:4]})")
            else:
                reasons.append("⚠ IFSC code not found — verify account details manually")

        if fields.get("account_number"):
            reasons.append(f"✓ Account number detected ({len(fields['account_number'])} digits)")
        else:
            acc_match = re.search(r"(?:account\s+no|a/c\s+no|acc\s+no)[:\s.]*([0-9]{9,18})", raw_text, re.IGNORECASE)
            if acc_match:
                reasons.append(f"✓ Account number found in document ({len(acc_match.group(1))} digits)")
            else:
                reasons.append("⚠ Account number not clearly extracted — verify manually")
        if fields.get("account_holder_name"):
            reasons.append(f"✓ Account holder name: '{fields['account_holder_name']}'")
        if fields.get("bank_name"):
            reasons.append(f"✓ Bank identified: {fields['bank_name']}")

    elif doc_type in ("TENTH_CERTIFICATE", "TWELFTH_CERTIFICATE"):
        grade_label = "10th / SSC" if doc_type == "TENTH_CERTIFICATE" else "12th / HSC / Intermediate"
        # Board detection
        text_upper = raw_text.upper()
        boards = {
            "CBSE": "Central Board of Secondary Education (CBSE)",
            "ICSE": "Indian Certificate of Secondary Education (ICSE)",
            "ISC": "Indian School Certificate (ISC)",
            "MSBSHSE": "Maharashtra State Board (MSBSHSE)",
            "SSLC": "State Board — SSLC",
            "UP BOARD": "Uttar Pradesh Board",
            "PSEB": "Punjab School Education Board (PSEB)",
            "RBSE": "Rajasthan Board (RBSE)",
            "HPBOSE": "Himachal Pradesh Board (HPBOSE)",
            "JKBOSE": "Jammu & Kashmir Board",
            "CISCE": "Council for ICSE (CISCE)",
        }
        board_found = None
        for board_key, board_name in boards.items():
            if board_key in text_upper:
                board_found = board_name
                break
        if board_found:
            reasons.append(f"✓ Board identified: {board_found}")
        else:
            reasons.append(f"⚠ Board name not clearly detected for {grade_label} certificate")

        if fields.get("student_name"):
            reasons.append(f"✓ Student name extracted: '{fields['student_name']}'")
        else:
            reasons.append("⚠ Student name not clearly detected in marksheet text")

        if fields.get("year_of_passing"):
            yr = fields["year_of_passing"]
            current_year = 2026
            if yr.isdigit() and int(yr) <= current_year:
                reasons.append(f"✓ Year of passing: {yr}")
            else:
                reasons.append(f"⚠ Year of passing appears unusual: {yr} — verify")
        else:
            reasons.append("⚠ Year of passing not extracted — check document")

        if fields.get("roll_number"):
            reasons.append(f"✓ Roll/registration number found: {fields['roll_number']}")
        if fields.get("percentage_or_cgpa"):
            reasons.append(f"✓ Marks/Grade extracted: {fields['percentage_or_cgpa']}")

        # Compartment / fail detection
        if "compartment" in raw_text.lower() or "failed" in raw_text.lower():
            reasons.append("🚩 Compartment/Fail indicator detected in document — verify pass status")
        elif "pass" in raw_text.lower() or "passed" in raw_text.lower():
            reasons.append("✓ Pass status detected in document")

    elif doc_type in ("DEGREE_CERTIFICATE", "POST_GRADUATION_CERTIFICATE", "CERTIFICATE"):
        degree_label = {
            "DEGREE_CERTIFICATE": "Bachelor's Degree",
            "POST_GRADUATION_CERTIFICATE": "Post-Graduate / Master's Degree",
            "CERTIFICATE": "Educational Certificate",
        }.get(doc_type, "Certificate")
        # University detection
        text_upper = raw_text.upper()
        ignou_detected = "IGNOU" in text_upper or "INDIRA GANDHI NATIONAL OPEN UNIVERSITY" in text_upper
        provisional = "PROVISIONAL" in text_upper
        if ignou_detected:
            reasons.append("✓ IGNOU (Indira Gandhi National Open University) certificate identified")
            reasons.append("✓ IGNOU is UGC-DEB accredited — distance education degree is valid")
        if provisional:
            reasons.append("⚠ Provisional certificate detected — original degree may follow after convocation")
        else:
            reasons.append(f"✓ {degree_label} document detected")
        if fields.get("student_name"):
            reasons.append(f"✓ Student name extracted: '{fields['student_name']}'")
        else:
            reasons.append("⚠ Student name not clearly detected — verify manually")
        if fields.get("institution"):
            reasons.append(f"✓ Institution: '{fields['institution']}'")
        if fields.get("year_of_passing"):
            reasons.append(f"✓ Year: {fields['year_of_passing']}")
        if fields.get("percentage_or_cgpa"):
            reasons.append(f"✓ Grade/CGPA: {fields['percentage_or_cgpa']}")

    elif doc_type in ("EXPERIENCE_LETTER", "RELIEVING_LETTER"):
        reasons.append("✓ Experience/Relieving letter detected")
        if fields.get("organization"):
            reasons.append(f"✓ Organization name detected in letterhead: '{fields['organization']}'")
        else:
            reasons.append("⚠ Organization/company name not clearly extracted — check letterhead")
        if fields.get("name"):
            reasons.append(f"✓ Employee name extracted: '{fields['name']}'")
        # Date range detection
        date_count = len(re.findall(r'\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}', raw_text))
        if date_count >= 2:
            reasons.append("✓ Multiple dates detected — likely joining and relieving dates")
        elif date_count == 1:
            reasons.append("⚠ Only one date detected — relieving/joining date may be missing")
        else:
            reasons.append("⚠ No dates detected — employment period cannot be verified")
        # Signature / letterhead check
        if any(kw in raw_text.lower() for kw in ["hr manager", "human resources", "authorized signatory", "director"]):
            reasons.append("✓ Authorized signatory designation detected")
        else:
            reasons.append("⚠ Authorized signatory not clearly detected — verify signature on document")

    elif doc_type == "RESIGNATION_LETTER":
        reasons.append("✓ Resignation letter or acceptance email detected")
        lwd_match = re.search(r"last working day[:\s]*(\d{1,2}[/\-\. ]\w+[/\-\. ]\d{2,4})", raw_text, re.IGNORECASE)
        if lwd_match:
            reasons.append(f"✓ Last working day mentioned: {lwd_match.group(1).strip()}")
        else:
            reasons.append("⚠ Last working day not clearly found — verify employment end date")

    elif doc_type == "OFFER_LETTER":
        reasons.append("✓ Offer letter or appointment letter detected")
        # Joining date
        join_match = re.search(r"(?:joining date|date of joining|join on|joining on)[:\s]*(\d{1,2}[/\-\. ]\w+[/\-\. ]\d{2,4})", raw_text, re.IGNORECASE)
        if join_match:
            reasons.append(f"✓ Joining date found: {join_match.group(1).strip()}")
        else:
            reasons.append("⚠ Joining date not found — verify with employee")
        if fields.get("organization"):
            reasons.append(f"✓ Company/organization detected: '{fields['organization']}'")
        if fields.get("name"):
            reasons.append(f"✓ Candidate name extracted: '{fields['name']}'")

    elif doc_type == "SALARY_SLIP":
        reasons.append("✓ Salary slip / payslip detected")
        # Month/year detection
        month_match = re.search(r"(?:for the month of|month)[:\s]*(\w+ \d{4}|\d{1,2}[/\-]\d{4})", raw_text, re.IGNORECASE)
        if month_match:
            reasons.append(f"✓ Pay period: {month_match.group(1).strip()}")
        else:
            reasons.append("⚠ Pay period/month not clearly found")
        # PF/ESI indicators
        has_pf = bool(re.search(r"\bepf\b|\bprovident fund\b|\bpf\s+no\b|\buan\b", raw_text, re.IGNORECASE))
        has_esi = bool(re.search(r"\besi\b|\besic\b|\bemployee state insurance\b", raw_text, re.IGNORECASE))
        if has_pf:
            reasons.append("✓ EPF/Provident Fund deduction detected — employer compliance confirmed")
        if has_esi:
            reasons.append("✓ ESI contribution detected")
        net_pay_match = re.search(r"net\s+(?:pay|salary)[:\s]*(?:rs\.?|₹|inr)?\s*([\d,]+)", raw_text, re.IGNORECASE)
        if net_pay_match:
            reasons.append(f"✓ Net pay amount extracted: ₹{net_pay_match.group(1).strip()}")
        else:
            reasons.append("⚠ Net pay amount not clearly extracted — verify total")

    elif doc_type in ("UTILITY_BILL", "ELECTRICITY_BILL"):
        reasons.append("✓ Utility bill detected — valid as residence proof")
        text_upper = raw_text.upper()
        # DISCOM identification
        discom_map = {
            "PVVNL": "Pashchimanchal Vidyut Vitran Nigam (UP)",
            "DVVNL": "Dakshinanchal Vidyut Vitran Nigam (UP)",
            "TPDDL": "Tata Power Delhi Distribution",
            "BSES": "BSES Delhi",
            "MSEDCL": "Maharashtra State Electricity Distribution Co.",
            "BESCOM": "Bangalore Electricity Supply Company (Karnataka)",
            "HESCOM": "Hubli Electricity Supply Company (Karnataka)",
            "TNEB": "Tamil Nadu Electricity Board",
            "TANGEDCO": "Tamil Nadu Generation and Distribution Corporation",
            "PSPCL": "Punjab State Power Corporation",
            "PGVCL": "Paschim Gujarat Vij Company",
        }
        discom_found = None
        for discom_key, discom_name in discom_map.items():
            if discom_key in text_upper:
                discom_found = discom_name
                break
        if discom_found:
            reasons.append(f"✓ Distribution company identified: {discom_found}")
        else:
            reasons.append("⚠ Distribution company not identified from known DISCOMs — may be valid local utility")
        # Consumer/account number
        consumer_match = re.search(r"(?:consumer\s+no|ca\s+no|account\s+no|consumer\s+number)[:\s]*([A-Z0-9/\-]+)", raw_text, re.IGNORECASE)
        if consumer_match:
            reasons.append(f"✓ Consumer/Account number: {consumer_match.group(1).strip()}")
        else:
            reasons.append("⚠ Consumer number not extracted — check for address match")
        # Bill date
        bill_date = re.search(r"(?:bill\s+date|date\s+of\s+bill|billing\s+date)[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})", raw_text, re.IGNORECASE)
        if bill_date:
            reasons.append(f"✓ Bill date: {bill_date.group(1).strip()} — check if within 3 months")
        else:
            reasons.append("⚠ Bill date not found — ensure bill is recent (within 3 months)")

    elif doc_type in ("BANK_STATEMENT", "CANCELLED_CHEQUE"):
        label = "Cancelled cheque" if doc_type == "CANCELLED_CHEQUE" else "Bank statement/passbook"
        reasons.append(f"✓ {label} detected — valid as residence/bank proof")
        # IFSC validation
        ifsc_match = re.search(r'\b([A-Z]{4}0[A-Z0-9]{6})\b', raw_text)
        if ifsc_match:
            ifsc = ifsc_match.group(1)
            reasons.append(f"✓ IFSC code detected: {ifsc} (bank: {ifsc[:4]})")
        else:
            reasons.append("⚠ IFSC code not detected — verify bank details manually")
        # MICR code (9 digits at bottom of cheque)
        micr_match = re.search(r'\b(\d{9})\b', raw_text)
        if micr_match and doc_type == "CANCELLED_CHEQUE":
            reasons.append(f"✓ MICR code detected: {micr_match.group(1)}")
        # Account number
        acc_match = re.search(r"(?:account\s+no|a/c\s+no|acc\s+no)[:\s.]*([0-9]{9,18})", raw_text, re.IGNORECASE)
        if acc_match:
            reasons.append(f"✓ Account number detected ({len(acc_match.group(1))} digits)")
        else:
            reasons.append("⚠ Account number not clearly extracted")

    elif doc_type == "RENT_AGREEMENT":
        reasons.append("✓ Rent/Lease agreement detected — valid as residence proof")
        # Landlord/tenant check
        if re.search(r"\b(landlord|lessor|licensor)\b", raw_text, re.IGNORECASE):
            reasons.append("✓ Landlord/Licensor details detected")
        if re.search(r"\b(tenant|lessee|licensee)\b", raw_text, re.IGNORECASE):
            reasons.append("✓ Tenant/Licensee details detected")
        # Rent amount
        rent_match = re.search(r"(?:monthly\s+rent|rent\s+amount)[:\s]*(?:rs\.?|₹|inr)?\s*([\d,]+)", raw_text, re.IGNORECASE)
        if rent_match:
            reasons.append(f"✓ Monthly rent amount: ₹{rent_match.group(1).strip()}")

    else:
        # Generic / OTHER
        field_count = len([v for v in fields.values() if v])
        if field_count > 0:
            reasons.append(f"✓ {field_count} field(s) extracted from unrecognized document type")
        else:
            reasons.append("⚠ Document type not recognized — HR should manually review")

    # ---- Quality / Authenticity flags ----
    for flag in quality_flags:
        reasons.append(f"⚠ {flag}")

    # ---- Minimum text check ----
    text_len = len(raw_text.strip())
    if text_len < 50:
        reasons.append("✗ Very little text extracted — document may be a photograph of a photograph, or heavily blurred")
    elif text_len < 150:
        reasons.append("⚠ Limited text extracted — document scan quality may be poor")

    return reasons


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
    "TENTH_CERTIFICATE": "TENTH_CERTIFICATE",
    "TWELFTH_CERTIFICATE": "TWELFTH_CERTIFICATE",
    "POST_GRADUATION_CERTIFICATE": "POST_GRADUATION_CERTIFICATE",
    "DEGREE_CERTIFICATE": "DEGREE_CERTIFICATE",
    "CERTIFICATE": "DEGREE_CERTIFICATE",   # generic education cert — HR disambiguates
    "BANK_STATEMENT": "BANK_STATEMENT",
    "CANCELLED_CHEQUE": "CANCELLED_CHEQUE",
    "OFFER_LETTER": "OFFER_LETTER_DOC",
    "RESIGNATION_LETTER": "RESIGNATION_LETTER",
    "EXPERIENCE_LETTER": "EXPERIENCE_LETTER",
    "RELIEVING_LETTER": "EXPERIENCE_LETTER",
    "SALARY_SLIP": "SALARY_SLIP_DOC",
    "UTILITY_BILL": "UTILITY_BILL",
    "RENT_AGREEMENT": "RENT_AGREEMENT",
    "OTHER": "OTHER",
}

# Aliases: which detected doc types satisfy a required doc type
REQUIRED_DOC_ALIASES: dict = {
    "AADHAAR": ["AADHAAR"],
    "PAN": ["PAN"],
    "PASSPORT": ["PASSPORT"],
    "VOTER_ID": ["VOTER_ID"],
    "DRIVING_LICENSE": ["DRIVING_LICENSE"],
    "TENTH_CERTIFICATE": ["TENTH_CERTIFICATE"],
    "TWELFTH_CERTIFICATE": ["TWELFTH_CERTIFICATE"],
    # Degree: degree OR PG cert OR provisional cert all satisfy
    "DEGREE_CERTIFICATE": ["DEGREE_CERTIFICATE", "CERTIFICATE", "POST_GRADUATION_CERTIFICATE"],
    "POST_GRADUATION_CERTIFICATE": ["POST_GRADUATION_CERTIFICATE", "DEGREE_CERTIFICATE", "CERTIFICATE"],
    # Experience proof: any employment document works
    "EXPERIENCE_LETTER": ["EXPERIENCE_LETTER", "RELIEVING_LETTER", "OFFER_LETTER_DOC", "SALARY_SLIP_DOC", "RESIGNATION_LETTER"],
    "OFFER_LETTER_DOC": ["OFFER_LETTER_DOC", "EXPERIENCE_LETTER", "RELIEVING_LETTER"],
    "SALARY_SLIP_DOC": ["SALARY_SLIP_DOC"],
    # Residence proof: utility bill, bank statement, cancelled cheque, rent agreement, or address-bearing govt ID
    "RESIDENCE_PROOF": ["UTILITY_BILL", "BANK_STATEMENT", "CANCELLED_CHEQUE", "VOTER_ID", "DRIVING_LICENSE", "RENT_AGREEMENT"],
    "BANK_STATEMENT": ["BANK_STATEMENT", "CANCELLED_CHEQUE"],
    "CANCELLED_CHEQUE": ["CANCELLED_CHEQUE", "BANK_STATEMENT"],
    "UTILITY_BILL": ["UTILITY_BILL", "RENT_AGREEMENT"],
    "PHOTO": ["PHOTO"],
}

# Standard required docs for KYC (fresher profile)
STANDARD_REQUIRED_DOCS = [
    "AADHAAR", "PAN", "TENTH_CERTIFICATE", "TWELFTH_CERTIFICATE",
    "DEGREE_CERTIFICATE", "RESIDENCE_PROOF", "BANK_STATEMENT",
    "PHOTO", "EXPERIENCE_LETTER",
]

# Suspicion: if a detected type appears more than this many times, likely duplicated
MAX_REASONABLE_PAGES_PER_TYPE = {
    "AADHAAR": 2,               # front + back
    "PAN": 2,                   # front + back
    "PASSPORT": 6,              # multiple pages
    "VOTER_ID": 2,
    "DRIVING_LICENSE": 2,
    "TENTH_CERTIFICATE": 4,     # result + marksheet possible
    "TWELFTH_CERTIFICATE": 4,
    "CERTIFICATE": 10,          # many certificates are ok
    "POST_GRADUATION_CERTIFICATE": 6,
    "BANK_STATEMENT": 8,        # multi-page statement
    "SALARY_SLIP": 6,           # 3–6 months of payslips is normal
    "OFFER_LETTER": 3,
    "RESIGNATION_LETTER": 3,
    "EXPERIENCE_LETTER": 3,
    "UTILITY_BILL": 3,
    "OTHER": 20,
}


async def classify_combined_pdf(pdf_bytes: bytes, required_docs: list = None) -> dict:
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
    suspicion_score = 0  # initialized here — accumulated during page loop below

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
        page_doc_type = type_info["detected_type"]

        # ── Per-page deep validation (field extract + validators + wrong-doc check) ──
        page_validation_reasons: list = []
        page_suspicion_boost = 0.0
        page_wrong_upload: dict = {}

        if not quality_info["is_blank"] and len(raw_text.strip()) > 30:
            try:
                # Extract structured fields for this page's detected type
                page_extractor = _TYPE_EXTRACTORS.get(page_doc_type, extract_generic_fields)
                page_fields = page_extractor(raw_text)

                # Run all deep validators (Verhoeff, PAN 5th-char, MRZ, GST, etc.)
                # Note: EXIF and face detection require raw image bytes — PDFs render as
                # image objects via pdf2image so we can try face detection on the PIL image.
                page_img_bytes: bytes = b""
                try:
                    from io import BytesIO as _BytesIO
                    _buf = _BytesIO()
                    image.save(_buf, format="PNG")
                    page_img_bytes = _buf.getvalue()
                except Exception:
                    pass

                deep = run_deep_validators(
                    doc_type=page_doc_type,
                    extracted_fields=page_fields,
                    raw_text=raw_text,
                    image_bytes=page_img_bytes or None,
                )
                page_validation_reasons.extend(deep["reasons"])
                page_suspicion_boost = deep["suspicion_boost"]

                # OCR-level validation reasons for this page
                page_ocr_reasons = generate_validation_reasons(
                    doc_type=page_doc_type,
                    fields=page_fields,
                    confidence=type_info["confidence"],
                    raw_text=raw_text,
                    quality_flags=[],
                )
                # Prepend OCR reasons, then deep reasons
                page_validation_reasons = page_ocr_reasons + (
                    ["── Deep Validation ──────────────────────────"] + deep["reasons"]
                    if deep["reasons"] else []
                )

                # Wrong document / non-KYC upload detection
                wrong = detect_wrong_upload(raw_text, page_doc_type)
                page_wrong_upload = wrong
                if wrong["is_wrong_upload"]:
                    suspicion_flags.append(
                        f"Page {idx + 1}: WRONG DOCUMENT — {wrong['category']} detected. "
                        + "; ".join(wrong["reasons"][:2])
                    )
                    suspicion_score_from_wrong = 40 if wrong["risk_level"] == "HIGH" else 60
                    page_suspicion_boost += suspicion_score_from_wrong / 100.0

            except Exception as e:
                logger.warning(f"Per-page deep validation failed on page {idx + 1}: {e}")
                page_validation_reasons = [f"⚠ Validation error on this page: {str(e)[:80]}"]

        # Add to results
        page_results.append({
            "page": idx + 1,
            "detected_type": page_doc_type,
            "confidence": type_info["confidence"],
            "text_snippet": raw_text[:300].strip() if raw_text else "",
            "quality": quality_info["quality"],
            "is_blank": quality_info["is_blank"],
            "is_likely_screenshot": quality_info["is_likely_screenshot"],
            "source": source,
            # New: per-page deep validation results
            "validation_reasons": page_validation_reasons,
            "suspicion_boost": round(page_suspicion_boost, 2),
            "wrong_upload": page_wrong_upload,
        })

        # Roll page suspicion boost into the overall suspicion score
        suspicion_score += int(page_suspicion_boost * 20)  # scale 0.0-1.0 boost → 0-20 pts

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

    # Suspicion analysis (suspicion_score already accumulated during page loop above)

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

    # Wrong-upload summary — aggregate across all pages
    wrong_upload_pages = [
        pr for pr in page_results
        if pr.get("wrong_upload", {}).get("is_wrong_upload")
    ]

    # Summary
    if total_pages == 0:
        summary = "No pages found in the PDF."
    else:
        summary = (
            f"Combined PDF contains {total_pages} page(s). "
            f"Detected document types: {', '.join(detected_docs) if detected_docs else 'None clearly identified'}. "
            f"Risk level: {risk_level}."
        )
        if wrong_upload_pages:
            summary += (
                f" ⚠ {len(wrong_upload_pages)} page(s) appear to be WRONG DOCUMENTS "
                f"(not valid KYC content): pages {[p['page'] for p in wrong_upload_pages]}."
            )
        if suspicion_flags:
            summary += f" Issues: {'; '.join(suspicion_flags[:2])}."

    # Collect all HR-facing validation reasons across pages for quick overview
    all_page_validation_summary = [
        {
            "page": pr["page"],
            "detected_type": pr["detected_type"],
            "confidence": pr["confidence"],
            "reasons": pr.get("validation_reasons", []),
            "is_wrong_upload": pr.get("wrong_upload", {}).get("is_wrong_upload", False),
            "wrong_upload_category": pr.get("wrong_upload", {}).get("category"),
        }
        for pr in page_results
        if not pr["is_blank"] and pr.get("validation_reasons")
    ]

    # Compute which required docs are missing (using alias table).
    # Use the employee-specific list passed from Node.js when available;
    # fall back to the conservative hardcoded list only when no context was provided.
    if required_docs and isinstance(required_docs, list) and len(required_docs) > 0:
        effective_required_docs = required_docs
    else:
        effective_required_docs = STANDARD_REQUIRED_DOCS
        logger.warning(
            "classify_combined_pdf: no required_docs provided by caller — "
            "using hardcoded STANDARD_REQUIRED_DOCS fallback. "
            "Pass employee-specific required_docs for accurate missing-doc detection."
        )

    missing_docs = []
    present_docs = []
    for req_doc in effective_required_docs:
        aliases = REQUIRED_DOC_ALIASES.get(req_doc, [req_doc])
        # Check if any alias appears in detected_docs OR page_results detected types
        detected_raw_types = [pr["detected_type"] for pr in page_results if not pr["is_blank"]]
        detected_system_types = [OCR_TYPE_TO_DOC_TYPE.get(t, t) for t in detected_raw_types]
        found = any(alias in detected_system_types or alias in detected_docs for alias in aliases)
        if found:
            present_docs.append(req_doc)
        else:
            missing_docs.append(req_doc)

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
        # Standard field names expected by Node.js backend
        "missing_docs": missing_docs,
        "present_docs": present_docs,
        "missingDocuments": missing_docs,  # alias for backend compatibility
        # Per-page validation results for HR panel display
        "page_validations": all_page_validation_summary,
        "wrong_upload_pages": [p["page"] for p in wrong_upload_pages],
        "wrong_upload_count": len(wrong_upload_pages),
    }


# ===== MAIN PIPELINE =====

# Dispatch table — maps detected type to specialized extractor
_TYPE_EXTRACTORS = {
    "AADHAAR":                    extract_aadhaar_fields,
    "PAN":                        extract_pan_fields,
    "PASSPORT":                   extract_passport_fields,
    "VOTER_ID":                   extract_voter_id_fields,
    "DRIVING_LICENSE":            extract_driving_license_fields,
    "BANK_STATEMENT":             extract_bank_statement_fields,
    "CERTIFICATE":                extract_education_certificate_fields,
    "TENTH_CERTIFICATE":          extract_education_certificate_fields,
    "TWELFTH_CERTIFICATE":        extract_education_certificate_fields,
    "POST_GRADUATION_CERTIFICATE": extract_education_certificate_fields,
    # Employment documents — use generic field extraction + dynamic fields
    "OFFER_LETTER":               extract_generic_fields,
    "RESIGNATION_LETTER":         extract_generic_fields,
    "EXPERIENCE_LETTER":          extract_generic_fields,
    "SALARY_SLIP":                extract_bank_statement_fields,  # reuse for bank account extraction
    "UTILITY_BILL":               extract_generic_fields,
    "RENT_AGREEMENT":             extract_generic_fields,
}


async def process_document(file_bytes: bytes, filename: str = "document.jpg") -> OCRResult:
    """
    Main document processing pipeline — handles images and PDFs.

    Runs in two passes:
      Pass 1 — OCR extraction, type detection, field extraction, confidence scoring
      Pass 2 — Deep validators (Verhoeff, PAN structure, MRZ, EXIF, face detect, GST)

    Returns an OCRResult with:
    - extracted_fields  : typed fields for the detected document type
    - dynamic_fields    : any extra label:value pairs found in the text
    - validation_reasons: human-readable HR-facing pass/warn/fail explanations
    - confidence        : 0.0-1.0
    - is_flagged        : True if confidence < 0.60 or deep validator issues
    """

    # ── Pass 1: Text extraction ──────────────────────────────────────────────
    raw_text, source = extract_text_from_document(file_bytes, filename)

    # ── Pass 1: Document type detection ─────────────────────────────────────
    doc_type = detect_document_type(raw_text)

    # ── Pass 1: Structured field extraction ─────────────────────────────────
    extractor = _TYPE_EXTRACTORS.get(doc_type, extract_generic_fields)
    extracted = extractor(raw_text)

    # ── Pass 1: Dynamic field extraction ────────────────────────────────────
    dynamic = extract_dynamic_fields(raw_text)
    existing_values = set(str(v).lower() for v in extracted.values() if v)
    dynamic = {k: v for k, v in dynamic.items() if str(v).lower() not in existing_values}

    # ── Pass 1: Confidence scoring ───────────────────────────────────────────
    text_len = len(raw_text.strip())
    field_count = len([v for v in extracted.values() if v])

    if field_count >= 4:
        confidence = 0.90
    elif field_count >= 3:
        confidence = 0.82
    elif field_count >= 2:
        confidence = 0.70
    elif field_count >= 1:
        confidence = 0.58
    elif text_len > 200:
        confidence = 0.42
    elif text_len > 50:
        confidence = 0.28
    else:
        confidence = 0.10

    if doc_type == "OTHER":
        confidence = min(confidence, 0.45)

    # ── Pass 1: Authenticity score ───────────────────────────────────────────
    authenticity_score = 1.0
    quality_flags: list = []

    if text_len < 30:
        authenticity_score -= 0.4
        quality_flags.append("Extremely little text extracted — document may be blurred or a photo of a printed copy")
    elif text_len < 80:
        authenticity_score -= 0.15
        quality_flags.append("Limited text extracted — scan quality may be low")

    if confidence < 0.40:
        authenticity_score -= 0.3
    elif confidence < 0.60:
        authenticity_score -= 0.1

    # ── Pass 1: Validation reasons (OCR-level) ───────────────────────────────
    validation_reasons = generate_validation_reasons(
        doc_type=doc_type,
        fields=extracted,
        confidence=confidence,
        raw_text=raw_text,
        quality_flags=quality_flags,
    )

    # ── Pass 2: Deep validators ──────────────────────────────────────────────
    # Provide raw image bytes only for image uploads (not PDFs), so EXIF and
    # face detection work correctly. For PDFs the bytes are the PDF itself.
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    image_bytes_for_validators = file_bytes if ext in ("jpg", "jpeg", "png", "webp", "bmp") else None

    try:
        deep = run_deep_validators(
            doc_type=doc_type,
            extracted_fields=extracted,
            raw_text=raw_text,
            image_bytes=image_bytes_for_validators,
        )

        # Append deep validation reasons as a new section
        if deep["reasons"]:
            validation_reasons.append("── Deep Validation ──────────────────────────")
            validation_reasons.extend(deep["reasons"])

        # Apply suspicion penalty from deep validators
        authenticity_score = max(0.0, authenticity_score - deep["suspicion_boost"])

        # Merge any extra fields discovered by deep validators (e.g. MRZ data)
        if deep.get("extra_fields"):
            for k, v in deep["extra_fields"].items():
                if k not in extracted:
                    dynamic[k] = str(v)

    except Exception as e:
        logger.warning(f"Deep validators failed for {doc_type}: {e}")
        validation_reasons.append(f"⚠ Deep validation skipped due to internal error: {str(e)[:80]}")

    authenticity_score = max(0.0, min(1.0, authenticity_score))

    # ── Pass 3: Wrong upload / non-KYC content detection ────────────────────
    try:
        wrong = detect_wrong_upload(raw_text, doc_type)
        if wrong["reasons"]:
            validation_reasons.append("── Upload Integrity Check ────────────────────")
            validation_reasons.extend(wrong["reasons"])
        if wrong["is_wrong_upload"]:
            authenticity_score = max(0.0, authenticity_score - 0.40)
            validation_reasons.insert(
                0,
                f"🚩 WRONG DOCUMENT DETECTED ({wrong['risk_level']} risk): "
                f"{wrong.get('category', 'UNKNOWN')} content identified. "
                f"{wrong['recommendation']}"
            )
    except Exception as e:
        logger.warning(f"Wrong upload detection failed: {e}")

    authenticity_score = max(0.0, min(1.0, authenticity_score))

    # ── Final flag decision ──────────────────────────────────────────────────
    is_flagged = confidence < 0.60 or authenticity_score < 0.50
    if is_flagged and confidence < 0.60:
        validation_reasons.insert(0, f"🚩 FLAGGED: Confidence {int(confidence * 100)}% is below the 60% threshold — HR manual review required")
    if authenticity_score < 0.50 and confidence >= 0.60:
        validation_reasons.insert(0, f"🚩 FLAGGED: Authenticity score {int(authenticity_score * 100)}% — deep validation raised integrity concerns")

    # Map raw OCR type to the shared system DocumentType enum so the stored
    # detectedType is consistent with what Document.type uses everywhere
    system_doc_type = OCR_TYPE_TO_DOC_TYPE.get(doc_type, doc_type)

    return OCRResult(
        raw_text=raw_text,
        document_type=system_doc_type,
        extracted_fields=extracted,
        confidence=confidence,
        extraction_source=source,
        validation_reasons=validation_reasons,
        dynamic_fields=dynamic,
        authenticity_score=authenticity_score,
        is_flagged=is_flagged,
    )
