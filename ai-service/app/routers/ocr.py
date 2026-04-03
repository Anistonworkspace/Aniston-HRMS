from fastapi import APIRouter, UploadFile, File, HTTPException
from ..services.ocr_service import process_document

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
