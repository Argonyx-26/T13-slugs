"""Shared fixtures and helpers. Every test runs on mocks with zero latency (~1 s total)."""
import time

import pytest
from fastapi.testclient import TestClient

from app.api_models import FINISHED
from app.config import Settings
from app.main import create_app

RAVI = "cb2759d8-3d91-4a4d-8bd2-026f68f76426"
LAKSHMI = "91786a1e-1ee8-4f60-8191-8a74c0e3edd1"
ARJUN = "9c7aa0d7-24a7-4a0d-93f0-3695c5d4df45"
SCENARIO_FOR = {RAVI: "penicillin", LAKSHMI: "warfarin", ARJUN: "diabetes"}

AUDIO = ("visit.m4a", b"\x00\x00\x00\x18ftypM4A " + b"\x00" * 4096, "audio/mp4")

_FINISHED = {s.value for s in FINISHED}


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(app_env="test", mock_latency_scale=0.0, audio_scratch_dir=tmp_path / "scratch",
                    samples_dir=tmp_path / "no-samples", research_backend="mock")


@pytest.fixture
def make_client(settings):
    """make_client(**overrides) -> a TestClient whose lifespan (startup/shutdown) has run."""
    clients: list[TestClient] = []

    def _make(**overrides) -> TestClient:
        client = TestClient(create_app(settings.model_copy(update=overrides)))
        client.__enter__()
        clients.append(client)
        return client

    yield _make
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


def orch(client: TestClient):
    return client.app.state.orch


def submit(client: TestClient, patient: str = RAVI, audio=AUDIO, scenario: str | None = None, **form):
    orch(client).svc.stt.default_scenario = scenario or SCENARIO_FOR.get(patient, "penicillin")
    return client.post("/api/v1/consultations", files={"audio_file": audio},
                       data={"patient_uuid": patient, **form})


def wait(client: TestClient, job_id: str, timeout_s: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout_s
    while True:
        body = client.get(f"/api/v1/jobs/{job_id}").json()
        if body["stage"] in _FINISHED:
            return body
        if time.monotonic() > deadline:
            raise AssertionError(f"job still at {body['stage']} after {timeout_s} s")
        time.sleep(0.02)


def run_job(client: TestClient, patient: str = RAVI, **kwargs) -> dict:
    r = submit(client, patient, **kwargs)
    assert r.status_code == 202, r.text
    return wait(client, r.json()["job_id"])


def eventually(check, timeout_s: float = 5.0):
    """Poll check() until it returns something truthy (for background work such as the
    record update that follows an edited confirmation)."""
    deadline = time.monotonic() + timeout_s
    while True:
        result = check()
        if result:
            return result
        if time.monotonic() > deadline:
            raise AssertionError("condition not met in time")
        time.sleep(0.02)


def boom(*args, **kwargs):
    raise RuntimeError("simulated failure")
