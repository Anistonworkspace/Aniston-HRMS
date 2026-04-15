from pydantic import BaseModel
from typing import Optional, List


class OCRResult(BaseModel):
    raw_text: str
    document_type: Optional[str] = None
    extracted_fields: dict = {}
    confidence: float = 0.0
    extraction_source: Optional[str] = None  # image_ocr, pdf_native, pdf_ocr, failed
    # Enhanced fields
    validation_reasons: List[str] = []       # human-readable pass/fail explanations for HR
    dynamic_fields: dict = {}                # label:value pairs for unknown/extra fields
    authenticity_score: float = 1.0          # 0.0 = highly suspicious, 1.0 = authentic
    is_flagged: bool = False                 # True if confidence < 0.60 or authenticity issues


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


class VoterIdData(BaseModel):
    name: Optional[str] = None
    father_name: Optional[str] = None
    epic_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    part_no: Optional[str] = None
    serial_no: Optional[str] = None


class DrivingLicenseData(BaseModel):
    name: Optional[str] = None
    dl_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    issue_date: Optional[str] = None
    expiry_date: Optional[str] = None
    address: Optional[str] = None
    class_of_vehicle: Optional[str] = None


class BankStatementData(BaseModel):
    account_holder_name: Optional[str] = None
    account_number: Optional[str] = None
    ifsc_code: Optional[str] = None
    bank_name: Optional[str] = None
    branch: Optional[str] = None
    address: Optional[str] = None


class EducationCertificateData(BaseModel):
    student_name: Optional[str] = None
    roll_number: Optional[str] = None
    institution: Optional[str] = None
    degree_or_course: Optional[str] = None
    year_of_passing: Optional[str] = None
    percentage_or_cgpa: Optional[str] = None
    board_or_university: Optional[str] = None
