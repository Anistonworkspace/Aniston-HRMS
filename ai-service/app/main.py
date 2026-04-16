import json
import logging
import os
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .routers import ocr, scoring
from .routers import logs as logs_router

# ── Structured JSON file logging ───────────────────────────────────────────────
# Writes JSON lines to /logs/ai-service.log (configurable via AI_LOG_FILE env).
# The Node.js backend proxies /ai/logs so Super Admin can view these in the UI.

_LOG_FILE = Path(os.environ.get("AI_LOG_FILE", "/logs/ai-service.log"))


class _JsonFormatter(logging.Formatter):
    """Emit one JSON object per log record — matches the Node.js winston schema."""

    def format(self, record: logging.LogRecord) -> str:
        from datetime import datetime, timezone
        payload: dict = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "level":     record.levelname.lower(),
            "message":   record.getMessage(),
            "service":   "ai-service",
            "logger":    record.name,
        }
        if record.exc_info:
            payload["stack"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _configure_file_logging() -> None:
    """Attach a rotating JSON file handler to the root logger.

    IMPORTANT: also sets the root-logger level to INFO.
    logging.basicConfig(level=INFO) is a no-op once any handler is attached,
    so we must set the level explicitly here — otherwise the default WARNING
    threshold silently drops all INFO/DEBUG messages and the log file stays empty.
    """
    try:
        _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            _LOG_FILE,
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=4,
            encoding="utf-8",
        )
        handler.setFormatter(_JsonFormatter())
        handler.setLevel(logging.DEBUG)   # handler passes everything ≥ DEBUG
        root = logging.getLogger()
        root.setLevel(logging.INFO)       # root filters to INFO+ (was WARNING by default)
        root.addHandler(handler)
    except Exception as exc:
        # Non-fatal — fall back to console-only logging
        logging.getLogger(__name__).warning(
            "Could not configure AI service file logging: %s", exc
        )


_configure_file_logging()

logger = logging.getLogger(__name__)
# NOTE: basicConfig is intentionally NOT called here — it would be a no-op after
# _configure_file_logging() adds a handler, and the explicit root.setLevel(INFO)
# above already sets the desired threshold.


def _check_ocr_dependencies() -> None:
    """
    Log the version/path of every OCR dependency at startup.
    Emits ERROR-level messages when a required component is missing so the
    issue is immediately visible in container logs without requiring a test upload.
    """
    # ── Tesseract ────────────────────────────────────────────────────────────
    try:
        import pytesseract
        tess_version = pytesseract.get_tesseract_version()
        tess_path = pytesseract.pytesseract.tesseract_cmd
        logger.info(f"[OCR Deps] Tesseract OK — version={tess_version}, path={tess_path}")

        # Check available language packs
        langs = pytesseract.get_languages(config="")
        logger.info(f"[OCR Deps] Tesseract languages available: {langs}")
        if "eng" not in langs:
            logger.error("[OCR Deps] CRITICAL: 'eng' language data not found — English OCR will fail")
        if "hin" not in langs:
            logger.warning(
                "[OCR Deps] 'hin' language data not found — Hindi OCR will be skipped "
                "(eng-only fallback will be used; this is non-fatal)"
            )
    except Exception as e:
        logger.error(f"[OCR Deps] CRITICAL: pytesseract not available — OCR will produce empty text: {e}")

    # ── poppler (pdf2image) ──────────────────────────────────────────────────
    try:
        from pdf2image import convert_from_bytes
        # Run a trivial conversion of a 1-page blank PDF to confirm poppler is installed
        # (minimal PDF bytes that produce 1 blank white page)
        _minimal_pdf = (
            b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj "
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj "
            b"3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\n"
            b"xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n"
            b"0000000058 00000 n\n0000000115 00000 n\n"
            b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
        )
        pages = convert_from_bytes(_minimal_pdf, dpi=72)
        logger.info(f"[OCR Deps] pdf2image + poppler OK — test render produced {len(pages)} page(s)")
    except Exception as e:
        logger.error(
            f"[OCR Deps] CRITICAL: pdf2image/poppler not available — "
            f"combined PDF classification will fail: {e}"
        )

    # ── OpenCV ──────────────────────────────────────────────────────────────
    try:
        import cv2
        logger.info(f"[OCR Deps] OpenCV OK — version={cv2.__version__}")
    except Exception as e:
        logger.warning(f"[OCR Deps] OpenCV not available — preprocessing disabled (non-fatal): {e}")

    # ── numpy ────────────────────────────────────────────────────────────────
    try:
        import numpy as np
        logger.info(f"[OCR Deps] NumPy OK — version={np.__version__}")
    except Exception as e:
        logger.warning(f"[OCR Deps] NumPy not available: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    _check_ocr_dependencies()
    yield
    # Shutdown (nothing to clean up)


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/ai/docs",
    openapi_url="/ai/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def verify_api_key(request: Request, call_next):
    """Simple API key auth for inter-service communication."""
    if request.url.path in ["/ai/health", "/ai/docs", "/ai/openapi.json", "/ai/logs"]:
        return await call_next(request)

    if settings.api_key:
        api_key = request.headers.get("X-API-Key")
        if api_key != settings.api_key:
            raise HTTPException(status_code=401, detail="Invalid API key")

    return await call_next(request)


@app.get("/ai/health")
async def health():
    return {
        "success": True,
        "data": {
            "status": "ok",
            "service": settings.app_name,
            "version": "1.0.0",
        },
    }


app.include_router(ocr.router, prefix="/ai")
app.include_router(scoring.router, prefix="/ai")
app.include_router(logs_router.router)   # /ai/logs — no extra prefix, full path in router
