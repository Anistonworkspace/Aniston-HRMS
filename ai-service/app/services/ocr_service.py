import re
from typing import Optional
from PIL import Image
from io import BytesIO

# Try to import tesseract — graceful fallback if not installed
try:
    import pytesseract
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False

from ..models.ocr_models import OCRResult, AadhaarData, PANData, PassportData


def extract_text_from_image(image_bytes: bytes) -> str:
    """Extract text from image using Tesseract OCR."""
    if not HAS_TESSERACT:
        return "[OCR not available — pytesseract not installed]"

    image = Image.open(BytesIO(image_bytes))
    text = pytesseract.image_to_string(image, lang="eng")
    return text.strip()


def detect_document_type(text: str) -> str:
    """Detect Indian document type from OCR text."""
    text_lower = text.lower()
    if "aadhaar" in text_lower or "unique identification" in text_lower or re.search(r"\d{4}\s?\d{4}\s?\d{4}", text):
        return "AADHAAR"
    if "income tax" in text_lower or "permanent account" in text_lower or re.search(r"[A-Z]{5}\d{4}[A-Z]", text):
        return "PAN"
    if "passport" in text_lower or "republic of india" in text_lower:
        return "PASSPORT"
    if "voter" in text_lower or "election" in text_lower:
        return "VOTER_ID"
    if "driving" in text_lower or "licence" in text_lower or "license" in text_lower:
        return "DRIVING_LICENSE"
    return "OTHER"


def extract_aadhaar_fields(text: str) -> dict:
    """Extract fields from Aadhaar card text."""
    data = AadhaarData()

    # Aadhaar number: 4-digit groups
    aadhaar_match = re.search(r"(\d{4}\s?\d{4}\s?\d{4})", text)
    if aadhaar_match:
        data.aadhaar_number = aadhaar_match.group(1).replace(" ", "")

    # DOB patterns
    dob_match = re.search(r"(?:DOB|Date of Birth|Birth)[:\s]*(\d{2}[/\-]\d{2}[/\-]\d{4})", text, re.IGNORECASE)
    if dob_match:
        data.date_of_birth = dob_match.group(1)

    # Gender
    if re.search(r"\b(male|पुरुष)\b", text, re.IGNORECASE):
        data.gender = "MALE"
    elif re.search(r"\b(female|महिला)\b", text, re.IGNORECASE):
        data.gender = "FEMALE"

    # Name — usually the first prominent line after header
    lines = [l.strip() for l in text.split("\n") if l.strip() and len(l.strip()) > 3]
    for line in lines[1:5]:
        if not re.search(r"\d", line) and not any(kw in line.lower() for kw in ["government", "india", "aadhaar", "unique", "dob", "male", "female"]):
            data.name = line
            break

    return data.model_dump(exclude_none=True)


def extract_pan_fields(text: str) -> dict:
    """Extract fields from PAN card text."""
    data = PANData()

    # PAN number: ABCDE1234F
    pan_match = re.search(r"([A-Z]{5}\d{4}[A-Z])", text)
    if pan_match:
        data.pan_number = pan_match.group(1)

    # DOB
    dob_match = re.search(r"(\d{2}[/\-]\d{2}[/\-]\d{4})", text)
    if dob_match:
        data.date_of_birth = dob_match.group(1)

    # Name lines
    lines = [l.strip() for l in text.split("\n") if l.strip() and len(l.strip()) > 2]
    name_lines = []
    for line in lines:
        if not re.search(r"\d", line) and not any(kw in line.lower() for kw in ["income", "tax", "govt", "india", "permanent", "account"]):
            name_lines.append(line)
    if len(name_lines) >= 1:
        data.name = name_lines[0]
    if len(name_lines) >= 2:
        data.father_name = name_lines[1]

    return data.model_dump(exclude_none=True)


def extract_passport_fields(text: str) -> dict:
    """Extract fields from passport text."""
    data = PassportData()

    # Passport number
    passport_match = re.search(r"([A-Z]\d{7})", text)
    if passport_match:
        data.passport_number = passport_match.group(1)

    # Dates
    dates = re.findall(r"(\d{2}[/\-]\d{2}[/\-]\d{4})", text)
    if len(dates) >= 1:
        data.date_of_birth = dates[0]
    if len(dates) >= 2:
        data.expiry_date = dates[-1]

    data.nationality = "INDIAN"

    return data.model_dump(exclude_none=True)


async def process_document(image_bytes: bytes) -> OCRResult:
    """Main OCR processing pipeline."""
    raw_text = extract_text_from_image(image_bytes)
    doc_type = detect_document_type(raw_text)

    extracted = {}
    if doc_type == "AADHAAR":
        extracted = extract_aadhaar_fields(raw_text)
    elif doc_type == "PAN":
        extracted = extract_pan_fields(raw_text)
    elif doc_type == "PASSPORT":
        extracted = extract_passport_fields(raw_text)

    return OCRResult(
        raw_text=raw_text,
        document_type=doc_type,
        extracted_fields=extracted,
        confidence=0.75 if extracted else 0.3,
    )
