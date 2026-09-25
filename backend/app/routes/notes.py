from fastapi import APIRouter, Depends

from app.api_models import ApproveRequest, ApproveResponse
from app.deps import get_orch
from app.orchestrator.pipeline import Orchestrator

router = APIRouter(tags=["notes"])


@router.post("/notes/{note_id}/approve", response_model=ApproveResponse)
async def approve_note(note_id: str, body: ApproveRequest | None = None,
                       orch: Orchestrator = Depends(get_orch)) -> ApproveResponse:
    """The doctor confirms the automatically saved note (no body = as-is). An edited note is
    scrubbed again, replaces the AI version, and the record update and predictions are redone."""
    return await orch.approve(note_id, body or ApproveRequest())


@router.post("/notes/{note_id}/discard")
async def discard_note(note_id: str, orch: Orchestrator = Depends(get_orch)) -> dict:
    """Discard the note: an automatically saved note is removed from the record with its facts."""
    return await orch.discard_draft(note_id)
