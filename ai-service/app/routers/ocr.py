from fastapi import APIRouter, UploadFile, File, HTTPException
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
async def classify_combined_pdf_endpoint(file: UploadFile = File(...)):
    """
    Classify a combined PDF that contains multiple documents.

    Processes the PDF page by page, detects the document type on each page/group,
    and returns a structured analysis:
      - detectedDocs: list of document types found
      - pageGroups: page ranges per detected doc
      - missingFromRequired: which required docs appear absent
      - suspicionFlags: pages that look blank/low-quality/screenshot
      - confidence: per-page confidence scores
    """
    if file.content_type and file.content_type not in ["application/pdf", "application/octet-stream"]:
        raise HTTPException(status_code=400, detail="Only PDF files are accepted for combined classification")

    contents = await file.read()
    if len(contents) > 100 * 1024 * 1024:  # 100MB limit for combined PDFs
        raise HTTPException(status_code=400, detail="File too large (max 100MB)")

    result = await classify_combined_pdf(contents)
    return {
        "success": True,
        "data": result,
    }
