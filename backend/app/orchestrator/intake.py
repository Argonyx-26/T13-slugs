"""Audio intake: validate the upload and keep it in RAM (/dev/shm) until STT is done."""
from __future__ import annotations

import asyncio
import shutil
import tempfile
import time
from pathlib import Path

from fastapi import UploadFile
from starlette.formparsers import MultiPartParser

from app.errors import ApiError
from app.logging_setup import event

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".aac", ".webm", ".ogg", ".oga", ".opus", ".flac"}
AUDIO_MIME_TYPES = {
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave",
    "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/x-aac", "audio/webm",
    "video/webm", "video/mp4", "audio/ogg", "audio/opus", "audio/flac", "audio/x-flac",
}
GENERIC_MIME_TYPES = {"", "application/octet-stream", "binary/octet-stream"}
EXT_FOR_MIME = {"audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav",
                "audio/wave": ".wav", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/m4a": ".m4a",
                "audio/aac": ".aac", "audio/webm": ".webm", "video/webm": ".webm", "audio/ogg": ".ogg",
                "audio/opus": ".opus", "audio/flac": ".flac"}


def keep_uploads_in_ram(max_bytes: int) -> None:
    """Starlette spools any upload bigger than 1 MB to a temp file on disk.
    Raise that threshold so the recording never touches the physical disk."""
    MultiPartParser.spool_max_size = max_bytes + 1024 * 1024


def pick_scratch_dir(configured: Path | None) -> Path:
    if configured:
        base = configured
    elif Path("/dev/shm").is_dir():                   # RAM-backed on Linux (Kaggle)
        base = Path("/dev/shm/clinical-scribe")
    else:                                             # Windows/macOS laptops: dev only
        base = Path(tempfile.gettempdir()) / "clinical-scribe"
    base.mkdir(parents=True, exist_ok=True)
    return base


def sweep_scratch(scratch: Path, older_than_s: float = 0) -> int:
    """Delete leftovers from a crash (a hard kill skips `finally` blocks)."""
    removed, now = 0, time.time()
    for f in scratch.glob("*"):
        if f.is_file() and now - f.stat().st_mtime >= older_than_s:
            f.unlink(missing_ok=True)
            removed += 1
    return removed


async def save_upload(upload: UploadFile, job_id: str, scratch: Path, max_bytes: int) -> Path:
    ext = Path(upload.filename or "").suffix.lower()
    mime = (upload.content_type or "").split(";")[0].strip().lower()
    if mime not in AUDIO_MIME_TYPES and not (mime in GENERIC_MIME_TYPES and ext in AUDIO_EXTENSIONS):
        raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE",
                       f"Expected an audio file (m4a, webm, mp3, wav, ogg, flac); got '{mime or 'unknown'}'.")
    if upload.size is not None and upload.size > max_bytes:
        raise ApiError(413, "AUDIO_TOO_LARGE", f"Audio is larger than {max_bytes // (1024 * 1024)} MB.")
    data = await upload.read()
    if not data:
        raise ApiError(400, "EMPTY_AUDIO", "The uploaded audio file is empty.")
    if len(data) > max_bytes:
        raise ApiError(413, "AUDIO_TOO_LARGE", f"Audio is larger than {max_bytes // (1024 * 1024)} MB.")
    if ext not in AUDIO_EXTENSIONS:
        ext = EXT_FOR_MIME.get(mime, ".bin")          # ffmpeg sniffs the real format anyway
    if shutil.disk_usage(scratch).free < 2 * len(data):   # /dev/shm can be small in containers
        scratch = Path(tempfile.gettempdir()) / "clinical-scribe-overflow"
        scratch.mkdir(parents=True, exist_ok=True)
        event("scratch_overflow", job=job_id, path_kind="disk")
    path = scratch / f"{job_id}{ext}"                  # never reuse the client's filename
    await asyncio.to_thread(path.write_bytes, data)
    return path


def discard(path: Path | None) -> None:
    if path is not None:
        path.unlink(missing_ok=True)
