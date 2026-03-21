from fastapi import APIRouter, UploadFile, File, HTTPException
from ..services.ocr_service import process_document

router = APIRouter(prefix="/ocr", tags=["OCR"])


@router.post("/extract")
async def extract_document(file: UploadFile = File(...)):
    """Extract text and fields from an uploaded document image."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image (JPEG, PNG)")

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    result = await process_document(contents)
    return {
        "success": True,
        "data": result.model_dump(),
    }
