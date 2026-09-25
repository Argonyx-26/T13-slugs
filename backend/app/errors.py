"""One error format for every failure: {"error": {"code", "message", "stage"}}.

ApiError   -> an HTTP error raised by a route or the orchestrator.
StageError -> a pipeline stage failed; the job becomes `failed` (not an HTTP error).
"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.logging_setup import event


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class StageError(Exception):
    def __init__(self, stage: str, code: str, message: str):
        super().__init__(message)
        self.stage = stage
        self.code = code
        self.message = message


def _body(code: str, message: str, **extra) -> dict:
    return {"error": {"code": code, "message": message, "stage": None, **extra}}


def _internal_error(exc: Exception) -> JSONResponse:
    # Only the type: exception messages (e.g. a Pydantic error on LLM output) can contain patient text.
    event("unhandled_error", code=type(exc).__name__)
    return JSONResponse(status_code=500, content=_body("INTERNAL_ERROR", "An unexpected error occurred."))


class _CatchUnhandled:
    """Starlette re-raises an exception after the `Exception` handler has answered, and the
    server then logs the full traceback, message included. Catch it first so only the
    exception type is ever logged."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def _send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception as exc:
            if started:                     # too late for a JSON body; never re-raise the message
                event("unhandled_error", code=type(exc).__name__)
                return
            await _internal_error(exc)(scope, receive, send)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=_body(exc.code, exc.message))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Only where and what; the submitted values (which may be patient data) are never echoed.
        details = [{"loc": list(e.get("loc", ())), "msg": e.get("msg", "")} for e in exc.errors()]
        return JSONResponse(status_code=422, content=_body(
            "VALIDATION_ERROR", "Some fields are missing or invalid.", details=details))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=_body(f"HTTP_{exc.status_code}", str(exc.detail)),
                            headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        return _internal_error(exc)

    app.add_middleware(_CatchUnhandled)
