from pydantic import BaseModel
from typing import Optional


class OCRResult(BaseModel):
    raw_text: str
    document_type: Optional[str] = None
    extracted_fields: dict = {}
    confidence: float = 0.0
    extraction_source: Optional[str] = None  # image_ocr, pdf_native, pdf_ocr, failed


class AadhaarData(BaseModel):
    name: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    aadhaar_number: Optional[str] = None
    address: Optional[str] = None


class PANData(BaseModel):
    name: Optional[str] = None
    father_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    pan_number: Optional[str] = None


class PassportData(BaseModel):
    name: Optional[str] = None
    passport_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    expiry_date: Optional[str] = None
    place_of_issue: Optional[str] = None
