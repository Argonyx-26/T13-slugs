import asyncio
import uuid

from fastapi import APIRouter, Depends, Query

from app.api_models import STAGE_LABELS, AskRequest, QueueEntry, SimilarSearchRequest
from app.contracts import PatientProfile, PatientSummary, PredictionReport, QAAnswer, SavedNote, SimilarCase
from app.deps import get_orch
from app.errors import ApiError
from app.logging_setup import event
from app.orchestrator.pipeline import Orchestrator

router = APIRouter(tags=["patients"])


async def _rag(fn, *args):
    """Run a RAG call in a thread; any failure becomes 503 HISTORY_UNAVAILABLE."""
    try:
        return await asyncio.to_thread(fn, *args)
    except Exception as e:
        event("history_unavailable", code=type(e).__name__)
        raise ApiError(503, "HISTORY_UNAVAILABLE", "Patient records are unavailable right now.") from e


@router.get("/patients", response_model=list[PatientSummary])
async def list_patients(q: str | None = Query(None, min_length=1, max_length=50),
                        orch: Orchestrator = Depends(get_orch)) -> list[PatientSummary]:
    """Every patient; q filters by name (the phone's search, for walk-ins not in today's queue)."""
    patients = await _rag(orch.svc.rag.list_patients)
    if q:
        patients = [p for p in patients if q.strip().casefold() in p.display_name.casefold()]
    return patients


@router.get("/visits/today", response_model=list[QueueEntry])
async def todays_queue(orch: Orchestrator = Depends(get_orch)) -> list[QueueEntry]:
    """Today's clinic queue in token order, each with its newest recording's progress.
    The doctor's phone picks the patient from here before recording."""
    visits = await _rag(orch.svc.rag.list_visits, orch.s.clinic_today())
    latest = orch.jobs.latest_for_visits()
    entries = []
    for v in visits:
        job = latest.get(v.visit_id)
        entries.append(QueueEntry(**v.model_dump(), job_id=job.job_id if job else None,
                                  job_stage=job.stage if job else None,
                                  job_stage_label=STAGE_LABELS[job.stage] if job else None))
    return entries


@router.get("/patients/{patient_uuid}", response_model=PatientProfile)
async def get_patient(patient_uuid: uuid.UUID, orch: Orchestrator = Depends(get_orch)) -> PatientProfile:
    """Allergies, medications, conditions and labs, each with its source and date."""
    profile = await _rag(orch.svc.rag.get_profile, patient_uuid)
    if profile is None:
        raise ApiError(404, "PATIENT_NOT_FOUND", "Unknown patient_uuid.")
    return profile


@router.get("/patients/{patient_uuid}/notes", response_model=list[SavedNote])
async def list_notes(patient_uuid: uuid.UUID, orch: Orchestrator = Depends(get_orch)) -> list[SavedNote]:
    """Saved notes, newest first; source says whether the doctor has confirmed each one."""
    return await _rag(orch.svc.rag.list_notes, patient_uuid)


@router.get("/patients/{patient_uuid}/predictions", response_model=PredictionReport)
async def get_predictions(patient_uuid: uuid.UUID, refresh: bool = False,
                          orch: Orchestrator = Depends(get_orch)) -> PredictionReport:
    """Likely outcomes from the patient's whole history, each with its reasoning and evidence.
    Never advice. Cached until the record changes; refresh=true regenerates."""
    return await orch.get_predictions(patient_uuid, refresh)


@router.post("/patients/{patient_uuid}/ask", response_model=QAAnswer)
async def ask(patient_uuid: uuid.UUID, body: AskRequest, orch: Orchestrator = Depends(get_orch)) -> QAAnswer:
    """Doctor Q&A over the records. Opinion or diagnosis questions are refused without calling the LLM."""
    return await orch.ask(patient_uuid, body.question)


@router.delete("/patients/{patient_uuid}")
async def delete_patient(patient_uuid: uuid.UUID, orch: Orchestrator = Depends(get_orch)) -> dict:
    """Cascading deletion: stored records and in-memory copies."""
    return await orch.delete_patient(patient_uuid)


@router.post("/search/similar", response_model=list[SimilarCase])
async def search_similar(body: SimilarSearchRequest, orch: Orchestrator = Depends(get_orch)) -> list[SimilarCase]:
    """Global similarity search across all patients."""
    return await _rag(orch.svc.rag.search_similar, body.query, body.top_k)
