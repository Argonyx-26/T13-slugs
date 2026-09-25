"""STT adapter for Shriya's module (WhisperX + pyannote). STUB until merge day.

On merge day (plan Step 16): copy the module into backend/external/, then replace this
stub with a class that calls it and converts its output into app.contracts.Transcript.
Until then load() raises, so STT_BACKEND=real fails loudly at startup, not mid-demo."""
from pathlib import Path

from app.contracts import ProgressFn, Transcript

_NOT_YET = "STT adapter not written yet (merge day). Set STT_BACKEND=mock."


class RealSTT:
    name = "stt-adapter"
    uses_gpu = True

    def __init__(self, settings):
        self._settings = settings

    def load(self) -> None:
        raise NotImplementedError(_NOT_YET)

    def unload(self) -> None:
        pass

    def transcribe(self, audio_path: Path, *, language_hint: str | None = None,
                   on_progress: ProgressFn | None = None) -> Transcript:
        raise NotImplementedError(_NOT_YET)
