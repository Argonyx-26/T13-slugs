"""FastAPI app factory. Run locally with:  uvicorn app.main:app --port 8000
Always ONE worker: jobs, drafts and loaded models live in this process's memory."""
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.deps import require_api_key
from app.errors import install_error_handlers
from app.logging_setup import configure_logging
from app.orchestrator.intake import keep_uploads_in_ram
from app.orchestrator.pipeline import Orchestrator
from app.orchestrator.registry import build_services
from app.routes import consultations, health, notes, patients


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    keep_uploads_in_ram(settings.max_upload_bytes)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        orch = Orchestrator(settings, build_services(settings))
        await orch.startup()                 # loads models once, before the first request
        app.state.orch = orch
        yield
        await orch.shutdown()

    app = FastAPI(title="Clinical Scribe Orchestrator", version=health.VERSION, lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                       allow_methods=["*"], allow_headers=["*"])   # "*" also allows ngrok-skip-browser-warning
    install_error_handlers(app)
    app.include_router(health.router)
    api = APIRouter(prefix="/api/v1", dependencies=[Depends(require_api_key)])
    for module in (patients, consultations, notes):
        api.include_router(module.router)
    app.include_router(api)
    return app


app = create_app()
