"""
/ai/logs — expose recent structured log lines from the AI service.

The backend Node.js server calls this endpoint when the Super Admin opens
the System Logs page and requests AI-service log entries.
"""
import os
import json
import logging
from pathlib import Path
from fastapi import APIRouter, Query

router = APIRouter(tags=["Logs"])

logger = logging.getLogger(__name__)

# Log file written by the JSON file handler configured in main.py
_LOG_FILE = Path(os.environ.get("AI_LOG_FILE", "/logs/ai-service.log"))


def _tail_json_lines(path: Path, n: int) -> list[dict]:
    """Read the last *n* JSON-encoded log lines from *path*.

    Non-JSON lines (e.g. plain-text tracebacks that slipped through) are
    silently dropped so the response is always a clean list of objects.
    """
    if not path.exists():
        return []

    # For files up to ~50 MB read the whole thing; larger files are
    # truncated to the last 2 MB to avoid blowing memory.
    max_bytes = 2 * 1024 * 1024  # 2 MB
    size = path.stat().st_size

    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        if size > max_bytes:
            fh.seek(size - max_bytes)
            fh.readline()  # discard the partial first line
        raw_lines = fh.readlines()

    # Keep last n lines, parse JSON
    entries: list[dict] = []
    for line in raw_lines[-n:]:
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            pass

    return entries


@router.get("/ai/logs")
async def get_ai_logs(
    lines: int = Query(default=200, ge=1, le=1000,
                       description="Number of recent log lines to return"),
):
    """Return the last *lines* structured log entries from the AI service."""
    try:
        data = _tail_json_lines(_LOG_FILE, lines)
        return {"success": True, "data": data, "source": "ai-service", "file": str(_LOG_FILE)}
    except Exception as exc:
        logger.warning("Failed to read AI service log file: %s", exc)
        return {"success": False, "data": [], "error": str(exc), "file": str(_LOG_FILE)}
