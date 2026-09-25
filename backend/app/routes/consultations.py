import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from app.api_models import ConsultationAccepted, JobStatus
from app.deps import get_orch
from app.errors import ApiError
from app.orchestrator.pipeline import Orchestrator

router = APIRouter(tags=["consultations"])


@router.post("/consultations", status_code=202, response_model=ConsultationAccepted)
async def create_consultation(
    audio_file: UploadFile = File(..., description="Whole-consultation recording (m4a, webm, mp3, wav, ogg, flac)"),
    patient_uuid: uuid.UUID = Form(...),
    visit_id: str | None = Form(None, max_length=64,
                                description="Today's queue entry the doctor picked; omit for a walk-in"),
    language_hint: Literal["auto", "kn", "en"] = Form("auto"),
    orch: Orchestrator = Depends(get_orch),
) -> ConsultationAccepted:
    """Queue a consultation. Returns immediately with a job_id; poll GET /jobs/{job_id}.
    With visit_id, the queue entry must belong to patient_uuid (409 otherwise) and is marked seen."""
    return await orch.submit(audio_file, patient_uuid, language_hint, visit_id)


@router.get("/jobs", response_model=list[JobStatus])
async def list_jobs(patient_uuid: uuid.UUID = Query(...), orch: Orchestrator = Depends(get_orch)) -> list[JobStatus]:
    """A patient's recordings still in memory, newest first: the website finds what the phone uploaded."""
    return [orch.jobs.status(job) for job in orch.jobs.for_patient(patient_uuid)]


@router.get("/jobs/{job_id}", response_model=JobStatus)
async def get_job(job_id: str, orch: Orchestrator = Depends(get_orch)) -> JobStatus:
    job = orch.jobs.jobs.get(job_id)
    if job is None:
        raise ApiError(404, "JOB_NOT_FOUND", "Unknown or expired job_id.")
    return orch.jobs.status(job)
