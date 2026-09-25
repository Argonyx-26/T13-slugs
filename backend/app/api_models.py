"""Request/response models that only the HTTP API uses."""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, computed_field

from app.contracts import ClinicalNote, DrugResearch, PredictionReport, RecordUpdate, SafetyAlert, Transcript, Visit


class Stage(str, Enum):
    queued = "queued"
    transcribing = "transcribing"
    writing_note = "writing_note"
    scrubbing_pii = "scrubbing_pii"
    gathering_context = "gathering_context"
    checking_safety = "checking_safety"
    saving = "saving"
    updating_record = "updating_record"
    predicting = "predicting"
    ready_for_review = "ready_for_review"   # only when the automatic save failed: a draft waits for a retry
    saved = "saved"                         # saved automatically as an AI scribe note
    verified = "verified"                   # the doctor confirmed (and maybe edited) the note
    discarded = "discarded"
    failed = "failed"


STAGE_LABELS = {
    Stage.queued: "Waiting for the GPU",
    Stage.transcribing: "Transcribing and separating speakers",
    Stage.writing_note: "Translating and writing the clinical note",
    Stage.scrubbing_pii: "Removing personal identifiers",
    Stage.gathering_context: "Checking patient history and latest drug information",
    Stage.checking_safety: "Cross-checking allergies and interactions",
    Stage.saving: "Saving to the patient record",
    Stage.updating_record: "Adding new information to the patient record",
    Stage.predicting: "Analysing patient history for likely outcomes",
    Stage.ready_for_review: "Not saved yet: review the draft and tap Save to retry",
    Stage.saved: "Saved to the patient record (AI scribe, awaiting your review)",
    Stage.verified: "Confirmed by the doctor",
    Stage.discarded: "Discarded",
    Stage.failed: "Processing failed",
}

# The frontend stops polling once a job reaches one of these.
FINISHED = {Stage.ready_for_review, Stage.saved, Stage.verified, Stage.discarded, Stage.failed}

CheckStatus = Literal["ok", "partial", "unavailable", "skipped"]


class Checks(BaseModel):
    history: CheckStatus = "skipped"        # patient profile + past notes loaded?
    web_research: CheckStatus = "skipped"   # Tavily results fetched?
    ai_review: CheckStatus = "skipped"      # LLM safety review ran?
    rules: CheckStatus = "skipped"          # deterministic rule check ran?
    record_update: CheckStatus = "skipped"  # new facts added to the patient record?
    predictions: CheckStatus = "skipped"    # ok = AI + rules, partial = rules only

    @computed_field
    @property
    def safety_check(self) -> Literal["complete", "partial", "unavailable"]:
        if self.history != "ok":
            return "unavailable"
        if self.ai_review == "ok" and self.rules == "ok":
            return "complete"
        return "partial"


class ConsultationResult(BaseModel):
    note_id: str
    status: Literal["draft", "saved", "verified", "discarded"]
    note: ClinicalNote
    alerts: list[SafetyAlert]
    checks: Checks
    research: list[DrugResearch]
    privacy: dict[str, int]                 # redactions per entity type, e.g. {"PERSON": 1}
    transcript: Transcript                  # returned to the doctor only; never stored
    speaker_roles: dict[str, str]
    models: dict[str, str]
    record_update: RecordUpdate | None = None      # what was added to the record, what was redundant
    predictions: PredictionReport | None = None    # likely outcomes from the whole history
    disclaimer: str


class ErrorInfo(BaseModel):
    code: str
    message: str
    stage: str | None = None


class JobStatus(BaseModel):
    job_id: str
    patient_uuid: uuid.UUID
    visit_id: str | None = None
    stage: Stage
    stage_label: str
    progress: float | None = None           # 0..1 while transcribing, when the STT reports it
    queue_position: int | None = None       # jobs ahead of this one
    created_at: datetime
    updated_at: datetime
    timings_ms: dict[str, int]
    result: ConsultationResult | None = None
    error: ErrorInfo | None = None


class ConsultationAccepted(BaseModel):
    job_id: str
    stage: Stage
    queue_position: int
    status_url: str
    # Who the server attached the recording to; the phone shows "Uploaded for <display_name>".
    patient_uuid: uuid.UUID
    display_name: str | None = None         # None only when the patient registry was down
    visit_id: str | None = None


class QueueEntry(Visit):
    """One row of today's queue, with the newest recording made for it (while still in memory)."""
    job_id: str | None = None
    job_stage: Stage | None = None
    job_stage_label: str | None = None


class ApproveRequest(BaseModel):
    note: ClinicalNote | None = None        # the doctor's edited note; omit to confirm as-is
    acknowledged_alert_ids: list[str] = []


class ApproveResponse(BaseModel):
    note_id: str
    status: Literal["verified"]
    verified_at: datetime


class SimilarSearchRequest(BaseModel):
    query: str = Field(min_length=3, max_length=300)
    top_k: int = Field(default=5, ge=1, le=20)


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=500)
