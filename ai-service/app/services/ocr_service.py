import re
import logging
from typing import Optional, List
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


def convert_pdf_to_images(pdf_bytes: bytes) -> List[Image.Image]:
    """Convert PDF pages to images for OCR."""
    if not HAS_PDF2IMAGE:
        return []
    try:
        images = convert_from_bytes(pdf_bytes, dpi=300, first_page=1, last_page=10)
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
