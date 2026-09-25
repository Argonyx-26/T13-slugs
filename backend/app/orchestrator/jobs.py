"""In-memory jobs and drafts, a one-at-a-time GPU slot, and an expiry sweeper.
In memory on purpose: a restart forgets everything, which is fine for a demo and
means transcripts are never persisted. Run uvicorn with ONE worker."""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Awaitable, Callable, Literal

from app.api_models import FINISHED, STAGE_LABELS, ConsultationResult, ErrorInfo, JobStatus, Stage
from app.contracts import ClinicalNote, SafetyAlert


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Job:
    job_id: str
    patient_uuid: uuid.UUID
    language_hint: str | None
    audio_path: Path | None
    visit_id: str | None = None                            # today's queue entry; None for a walk-in
    name_terms: list[str] = field(default_factory=list)    # patient's names, for the scrubber only
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)
    stage: Stage = Stage.queued
    progress: float | None = None
    timings_ms: dict[str, int] = field(default_factory=dict)
    result: ConsultationResult | None = None
    error: ErrorInfo | None = None

    def set_stage(self, stage: Stage) -> None:
        self.stage, self.progress, self.updated_at = stage, None, utcnow()

    def fail(self, stage: str, code: str, message: str) -> None:
        self.error = ErrorInfo(code=code, message=message, stage=stage)
        self.set_stage(Stage.failed)


@dataclass
class Draft:
    """A consultation note the doctor can still confirm, correct or discard (for JOB_TTL_MINUTES).
    status: draft (automatic save failed) -> saved (AI scribe) -> verified (doctor) | discarded."""
    note_id: str
    job_id: str
    patient_uuid: uuid.UUID
    note: ClinicalNote
    alerts: list[SafetyAlert]
    stt_engine: str
    llm_model: str
    visit_at: datetime
    visit_id: str | None = None
    name_terms: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=utcnow)
    status: Literal["draft", "saved", "verified", "discarded"] = "draft"
    verified_at: datetime | None = None


class JobManager:
    def __init__(self, runner: Callable[[Job], Awaitable[None]], max_concurrent: int, ttl_minutes: int):
        self.jobs: dict[str, Job] = {}
        self.drafts: dict[str, Draft] = {}
        self._runner = runner
        self.gpu_slot = asyncio.Semaphore(max_concurrent)   # one job on the GPU at a time
        self._tasks: set[asyncio.Task] = set()   # strong refs: un-referenced tasks can be garbage-collected mid-run
        self._ttl = timedelta(minutes=ttl_minutes)

    # ---------------------------------------------------------------- queue

    def pending(self) -> list[Job]:
        return [j for j in self.jobs.values() if j.stage not in FINISHED]

    def for_patient(self, patient_uuid: uuid.UUID) -> list[Job]:
        """That patient's jobs still in memory, newest first (the website finds the phone's recordings)."""
        return sorted((j for j in self.jobs.values() if j.patient_uuid == patient_uuid),
                      key=lambda j: j.created_at, reverse=True)

    def latest_for_visits(self) -> dict[str, Job]:
        """visit_id -> the newest job recorded for that queue entry."""
        latest: dict[str, Job] = {}
        for j in self.jobs.values():
            if j.visit_id and (j.visit_id not in latest or j.created_at > latest[j.visit_id].created_at):
                latest[j.visit_id] = j
        return latest

    def queue_position(self, job: Job) -> int:
        if job.stage is not Stage.queued:
            return 0
        return sum(1 for j in self.pending() if j is not job and
                   (j.stage is not Stage.queued or j.created_at < job.created_at))

    def submit(self, job: Job) -> None:
        self.jobs[job.job_id] = job
        task = asyncio.create_task(self._run(job), name=f"job-{job.job_id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, job: Job) -> None:
        async with self.gpu_slot:
            await self._runner(job)

    # ---------------------------------------------------------------- polling

    def status(self, job: Job) -> JobStatus:
        """The polling response. name_terms is deliberately never part of it."""
        return JobStatus(
            job_id=job.job_id,
            patient_uuid=job.patient_uuid,
            visit_id=job.visit_id,
            stage=job.stage,
            stage_label=STAGE_LABELS[job.stage],
            progress=job.progress,
            queue_position=self.queue_position(job) if job.stage is Stage.queued else None,
            created_at=job.created_at,
            updated_at=job.updated_at,
            timings_ms=dict(job.timings_ms),
            result=job.result,
            error=job.error,
        )

    # ---------------------------------------------------------------- expiry

    def sweep(self) -> int:
        """Forget finished jobs and drafts older than JOB_TTL_MINUTES."""
        cutoff = utcnow() - self._ttl
        old_jobs = [k for k, j in self.jobs.items() if j.stage in FINISHED and j.updated_at < cutoff]
        old_drafts = [k for k, d in self.drafts.items() if d.created_at < cutoff]
        for k in old_jobs:
            del self.jobs[k]
        for k in old_drafts:
            del self.drafts[k]
        return len(old_jobs) + len(old_drafts)

    async def sweep_forever(self, every_s: float = 60) -> None:
        while True:
            await asyncio.sleep(every_s)
            self.sweep()

    async def shutdown(self) -> None:
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
