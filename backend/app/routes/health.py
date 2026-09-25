"""Liveness and readiness. Always open: never behind the API key."""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

VERSION = "1.0.0"

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Liveness: the process is up. Instant; never touches models."""
    return {"status": "ok", "service": "clinical-scribe-orchestrator", "version": VERSION}


@router.get("/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness: which backends are live, whether models are loaded, pending jobs, GPU memory."""
    orch = getattr(request.app.state, "orch", None)
    if orch is None:
        return JSONResponse({"ready": False}, status_code=503)
    body = orch.readiness()
    return JSONResponse(body, status_code=200 if body["ready"] else 503)
