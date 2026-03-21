from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .routers import ocr, scoring

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/ai/docs",
    openapi_url="/ai/openapi.json",
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
    if request.url.path in ["/ai/health", "/ai/docs", "/ai/openapi.json"]:
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
