"""All runtime settings. Values come from environment variables or a .env file."""
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

Backend = Literal["mock", "real"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["local", "kaggle", "test"] = "local"
    api_key: str | None = None            # when set, /api/v1/* requires the X-API-Key header
    cors_origins: list[str] = ["*"]

    # Which implementation backs each service. "real" = adapter in app/services/real/
    stt_backend: Backend = "mock"
    rag_backend: Backend = "mock"
    llm_backend: Backend = "mock"
    privacy_backend: Backend = "mock"
    research_backend: Literal["mock", "tavily", "off"] = "mock"

    # GPU
    gpu_policy: Literal["resident", "swap"] = "resident"
    stt_device: str = "cuda:0"
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.1:8b"

    # Limits
    max_upload_mb: int = 25
    max_concurrent_jobs: int = 1          # jobs that may use the GPU at the same time
    max_pending_jobs: int = 4             # queued + running; more than this -> 429
    job_ttl_minutes: int = 60             # jobs and drafts are forgotten after this
    audio_scratch_dir: Path | None = None  # None -> /dev/shm/clinical-scribe, else OS temp dir

    # Behaviour
    prediction_max_records: int = 60      # newest history records the prediction step reads
    clinic_utc_offset_minutes: int = 330  # IST; decides which day "today's queue" is (Kaggle runs on UTC)
    mock_latency_scale: float = 1.0       # 0 in tests; 1 = realistic mock delays
    mock_default_scenario: str = "penicillin"
    samples_dir: Path = Path(__file__).resolve().parent.parent / "samples" / "audio"

    # Web research (Tavily)
    tavily_api_key: str | None = None
    research_timeout_s: float = 8.0
    research_max_drugs: int = 4
    research_results_per_drug: int = 3
    research_cache_hours: int = 24
    research_prefetch: list[str] = []     # generic names to warm the cache with at startup
    research_domains: list[str] = [
        "fda.gov", "nih.gov", "medlineplus.gov", "who.int",
        "cdsco.gov.in", "ema.europa.eu", "nhs.uk",
    ]

    log_level: str = "INFO"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    def clinic_today(self) -> date:
        """The clinic's date. A fixed offset, not zoneinfo: Windows has no tz database without tzdata."""
        return datetime.now(timezone(timedelta(minutes=self.clinic_utc_offset_minutes))).date()


@lru_cache
def get_settings() -> Settings:
    return Settings()
