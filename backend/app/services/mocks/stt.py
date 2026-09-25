"""Mock STT. Blocking sleeps on purpose: the real WhisperX code blocks too, and the
mock must behave the same way or the async bugs only appear on merge day."""
import hashlib
import time
from pathlib import Path

from app.contracts import ProgressFn, Segment, Transcript


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class MockSTT:
    name = "mock-stt"
    uses_gpu = True

    def __init__(self, settings, scenarios: dict):
        self._scale = settings.mock_latency_scale
        self._scenarios = {k: v for k, v in scenarios.items() if not k.startswith("_")}
        self._samples_dir: Path = settings.samples_dir
        self._by_hash: dict[str, str] = {}
        self.default_scenario = settings.mock_default_scenario

    def load(self) -> None:
        # samples/audio/<scenario>.<ext> selects that scenario when uploaded.
        if self._samples_dir.is_dir():
            for f in self._samples_dir.iterdir():
                if f.is_file() and f.stem in self._scenarios:
                    self._by_hash[_sha256(f)] = f.stem

    def unload(self) -> None:
        pass

    def transcribe(self, audio_path: Path, *, language_hint: str | None = None,
                   on_progress: ProgressFn | None = None) -> Transcript:
        scenario = self._by_hash.get(_sha256(audio_path), self.default_scenario)
        data = self._scenarios[scenario]
        for step in range(1, 5):
            time.sleep(0.5 * self._scale)
            if on_progress:
                on_progress(step / 4)
        segments, t = [], 0.0
        for speaker, text in data["segments"]:
            duration = max(2.0, len(text.split()) * 0.45)
            segments.append(Segment(start=round(t, 2), end=round(t + duration, 2), speaker=speaker, text=text))
            t += duration + 0.3
        return Transcript(segments=segments, language=language_hint or data["language"],
                          duration_s=round(t, 2), aligned=False, engine=f"mock:{scenario}")
