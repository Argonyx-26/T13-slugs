import secrets

from fastapi import Request, Security
from fastapi.security import APIKeyHeader

from app.errors import ApiError
from app.orchestrator.pipeline import Orchestrator

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def require_api_key(request: Request, key: str | None = Security(_api_key_header)) -> None:
    expected = request.app.state.settings.api_key
    if expected and not (key and secrets.compare_digest(key, expected)):
        raise ApiError(401, "UNAUTHORIZED", "Missing or invalid X-API-Key header.")


def get_orch(request: Request) -> Orchestrator:
    return request.app.state.orch
