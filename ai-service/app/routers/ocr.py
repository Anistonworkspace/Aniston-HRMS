import io
import json
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from ..services.ocr_service import process_document, classify_combined_pdf, HAS_OPENCV

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
    # Cat 5 item 22 — surface OCR errors with actionable codes
    try:
        result = await process_document(contents, filename)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error(f"[extract] OCR failed for {filename}: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "OCR_EXTRACT_FAILED",
                "message": f"Could not extract fields from this document: {str(exc)[:200]}. Try re-uploading a clearer scan.",
            },
        )
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

    # Cat 5 item 22 — classify errors with actionable codes so Node.js can surface them to HR
    try:
        result = await classify_combined_pdf(contents, required_docs=parsed_required_docs)
    except MemoryError:
        raise HTTPException(
            status_code=507,
            detail={
                "error_code": "OCR_OUT_OF_MEMORY",
                "message": "PDF is too large or complex for available memory. Try splitting the file into smaller parts.",
            },
        )
    except TimeoutError:
        raise HTTPException(
            status_code=504,
            detail={
                "error_code": "OCR_TIMEOUT",
                "message": "OCR processing timed out. The PDF may have too many pages. Try uploading fewer pages at once.",
            },
        )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error(f"[classify_combined_pdf] Unhandled error: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "OCR_PROCESSING_FAILED",
                "message": f"OCR failed to process this PDF: {str(exc)[:200]}. Please re-upload or contact support.",
            },
        )
    return {
        "success": True,
        "data": result,
    }


@router.post("/validate-photo")
async def validate_photo(file: UploadFile = File(...)):
    """
    Validate a passport-size photo upload:
    - Checks that exactly one face is detected (no face = not a photo, multiple = wrong upload)
    - Returns face_detected, face_count, and a pass/fail verdict
    """
    allowed_types = ["image/jpeg", "image/png", "image/webp", "image/bmp"]
    if file.content_type and file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only image files accepted for photo validation")

    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    if not HAS_OPENCV:
        return {"success": True, "data": {"face_detected": True, "face_count": 1, "valid": True, "reason": "opencv_unavailable"}}

    try:
        import cv2
        import numpy as np
        from PIL import Image

        img = Image.open(io.BytesIO(contents)).convert("RGB")
        img_array = np.array(img)
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)

        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        face_cascade = cv2.CascadeClassifier(cascade_path)
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
        face_count = len(faces)

        if face_count == 0:
            return {"success": True, "data": {"face_detected": False, "face_count": 0, "valid": False, "reason": "no_face_detected"}}
        if face_count > 1:
            return {"success": True, "data": {"face_detected": True, "face_count": face_count, "valid": False, "reason": "multiple_faces_detected"}}
        return {"success": True, "data": {"face_detected": True, "face_count": 1, "valid": True, "reason": "ok"}}
    except Exception as exc:
        return {"success": True, "data": {"face_detected": True, "face_count": 1, "valid": True, "reason": f"validation_error: {str(exc)[:100]}"}}
