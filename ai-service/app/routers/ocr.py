import json
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from ..services.ocr_service import process_document, classify_combined_pdf

router = APIRouter(prefix="/ocr", tags=["OCR"])


@router.post("/extract")
async def extract_document(file: UploadFile = File(...)):
    """Extract text and fields from an uploaded document (image or PDF)."""
    allowed_types = [
        "image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff",
        "application/pdf",
        "application/octet-stream",  # fallback for unknown types
    ]
    if file.content_type and file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}. Accepted: images, PDF")

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:  # 20MB limit
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    filename = file.filename or "document.jpg"
    result = await process_document(contents, filename)
    return {
        "success": True,
        "data": result.model_dump(),
    }


@router.post("/classify-combined-pdf")
async def classify_combined_pdf_endpoint(
    file: UploadFile = File(...),
    required_docs: Optional[str] = Form(None),
):
    """
    Classify a combined PDF that contains multiple documents.

    Processes the PDF page by page, detects the document type on each page/group,
    and returns a structured analysis:
      - detectedDocs: list of document types found
      - pageGroups: page ranges per detected doc
      - missingFromRequired: which required docs appear absent
      - suspicionFlags: pages that look blank/low-quality/screenshot
      - confidence: per-page confidence scores

    Optional form field `required_docs`: JSON-encoded list of required doc type strings
    (e.g. '["PAN","TENTH_CERTIFICATE","RESIDENCE_PROOF"]').
    When provided, missing-doc detection uses this employee-specific list instead of
    the hardcoded STANDARD_REQUIRED_DOCS fallback.
    """
    if file.content_type and file.content_type not in ["application/pdf", "application/octet-stream"]:
        raise HTTPException(status_code=400, detail="Only PDF files are accepted for combined classification")

    contents = await file.read()
    if len(contents) > 100 * 1024 * 1024:  # 100MB limit for combined PDFs
        raise HTTPException(status_code=400, detail="File too large (max 100MB)")

    # Parse employee-specific required docs list if provided
    parsed_required_docs: Optional[list] = None
    if required_docs:
        try:
            parsed_required_docs = json.loads(required_docs)
            if not isinstance(parsed_required_docs, list):
                parsed_required_docs = None
        except (json.JSONDecodeError, TypeError):
            parsed_required_docs = None

    result = await classify_combined_pdf(contents, required_docs=parsed_required_docs)
    return {
        "success": True,
        "data": result,
    }
