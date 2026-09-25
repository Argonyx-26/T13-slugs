"""The orchestrator's internal language: data models + service interfaces.

The pipeline only ever handles these types. Teammates' modules are wrapped by
adapters in app/services/real/ that convert *their* outputs into these models,
so a mismatch found on merge day is fixed inside one adapter, never here.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Callable, Literal, Protocol

from pydantic import BaseModel, Field

# clinic_db: the clinic's records. doctor_notes: written or confirmed by the doctor.
# ai_scribe: saved automatically from a consultation and NOT yet reviewed by the doctor.
Source = Literal["clinic_db", "doctor_notes", "ai_scribe"]

# ---------------------------------------------------------------- speech-to-text


class Segment(BaseModel):
    start: float                         # seconds from the start of the recording
    end: float
    speaker: str                         # raw diarization label, e.g. "SPEAKER_00"
    text: str                            # as transcribed (Kannada, English or mixed)


class Transcript(BaseModel):
    segments: list[Segment]
    language: str | None = None          # ISO-639-1 code detected or forced ("kn", "en")
    duration_s: float
    aligned: bool = False                # word-level alignment ran (no model exists for Kannada)
    engine: str                          # "whisperx-large-v3", "mock:penicillin", ...

    def as_dialogue(self) -> str:
        return "\n".join(f"{s.speaker}: {s.text}" for s in self.segments)


# ---------------------------------------------------------------- patient data (RAG)


class Fact(BaseModel):
    value: str                           # "Penicillin", "Warfarin 5 mg once daily"
    source: Source
    recorded_on: date | None = None
    note: str | None = None              # short clinical detail
    origin_note_id: str | None = None    # the consultation note this fact came from, if any


class LabResult(BaseModel):
    name: str                            # "HbA1c"
    value: str                           # "8.1 %"
    taken_on: date
    source: Source = "clinic_db"


class PatientSummary(BaseModel):
    patient_uuid: uuid.UUID
    display_name: str                    # pseudonym shown in the patient picker
    age: int | None = None
    sex: Literal["M", "F", "O"] | None = None


class Visit(BaseModel):
    """One patient in today's clinic queue. The RAG module owns the queue; the doctor's
    phone picks the patient from it before recording."""
    visit_id: str
    patient_uuid: uuid.UUID
    display_name: str
    age: int | None = None
    sex: Literal["M", "F", "O"] | None = None
    token: int                           # position in today's queue, 1 = first
    status: Literal["waiting", "seen"] = "waiting"   # seen once a recording has been accepted


class PatientProfile(BaseModel):
    """Safety-critical facts. Always fetched in full, never via similarity search."""
    patient_uuid: uuid.UUID
    allergies: list[Fact] = []
    active_medications: list[Fact] = []
    conditions: list[Fact] = []
    labs: list[LabResult] = []


class ContextChunk(BaseModel):
    text: str
    source: Source
    recorded_on: date | None = None
    score: float | None = None
    ref_id: str | None = None


class PatientContext(BaseModel):
    profile: PatientProfile | None = None
    chunks: list[ContextChunk] = []


# ---------------------------------------------------------------- clinical note (LLM)


class Symptom(BaseModel):
    name: str
    duration: str | None = None
    severity: str | None = None
    notes: str | None = None


class Prescription(BaseModel):
    drug: str                            # as spoken: generic or brand ("Brufen")
    dose: str | None = None
    frequency: str | None = None
    duration: str | None = None
    route: str | None = None


class ActionItem(BaseModel):
    kind: Literal["test", "referral", "follow_up", "advice", "other"]
    description: str


class ClinicalNote(BaseModel):
    chief_complaint: str | None = None
    symptoms: list[Symptom] = []
    relevant_history: list[str] = []     # history mentioned in THIS consultation
    allergies_mentioned: list[str] = []  # become profile facts through the record update
    prescriptions: list[Prescription] = []
    action_items: list[ActionItem] = []
    doctor_assessment: str | None = None  # only if the doctor said it; the AI never infers one
    summary: str                         # 2-4 sentence English summary


class NoteExtraction(BaseModel):
    note: ClinicalNote
    speaker_roles: dict[str, Literal["doctor", "patient", "other"]] = {}
    model: str


# ---------------------------------------------------------------- safety


class Evidence(BaseModel):
    source: Literal["clinic_db", "doctor_notes", "ai_scribe", "transcript", "rule_table", "web"]
    snippet: str
    recorded_on: date | None = None
    url: str | None = None


class SafetyAlert(BaseModel):
    alert_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    category: Literal["allergy_conflict", "drug_interaction", "history_contradiction",
                      "possible_omission", "data_gap"]
    severity: Literal["critical", "warning", "info"]
    message: str                         # factual and neutral: no advice, no diagnosis
    evidence: list[Evidence] = []
    origin: Literal["llm", "rule_engine", "system"]
    drug: str | None = None              # normalised generic name, used for de-duplication


# ---------------------------------------------------------------- web research


class ResearchHit(BaseModel):
    title: str
    url: str
    domain: str
    snippet: str
    published_date: str | None = None


class DrugResearch(BaseModel):
    drug: str                            # generic name the query was built from
    query: str                           # exactly what left the server
    hits: list[ResearchHit] = []


# ---------------------------------------------------------------- patient record updates


FactCategory = Literal["allergy", "medication", "condition"]


class RecordChange(BaseModel):
    category: FactCategory
    value: str                           # "Atorvastatin 10 mg once daily", "High cholesterol"
    note: str | None = None


class RecordUpdate(BaseModel):
    """What one consultation adds to the long-term record, and what it repeats."""
    added: list[RecordChange] = []
    already_on_record: list[RecordChange] = []   # redundant: ignored, not stored again


class NoteFacts(BaseModel):
    """The facts one consultation note contributes to the patient profile."""
    allergies: list[Fact] = []
    active_medications: list[Fact] = []
    conditions: list[Fact] = []


# ---------------------------------------------------------------- outcome predictions


class Prediction(BaseModel):
    outcome: str                         # a possible future development, never advice
    likelihood: Literal["low", "moderate", "high"]
    timeframe: str | None = None         # "next test", "coming months"
    reasoning: str                       # why, from the stored records
    evidence: list[Evidence] = []        # every prediction cites at least one record
    origin: Literal["llm", "rule_engine"]


class PredictionReport(BaseModel):
    """Likely outcomes for one patient. Kept in memory only: never stored as a record."""
    patient_uuid: uuid.UUID
    generated_at: datetime
    predictions: list[Prediction] = []
    records_analysed: int
    withheld: int = 0                    # AI predictions dropped for giving advice or citing nothing
    model: str
    disclaimer: str


# ---------------------------------------------------------------- storage & search


class NoteMeta(BaseModel):
    note_id: str
    job_id: str
    visit_id: str | None = None          # today's queue entry the recording was made for (None: walk-in)
    visit_at: datetime
    saved_at: datetime
    source: Literal["ai_scribe", "doctor_notes"]   # ai_scribe until the doctor confirms it
    verified_at: datetime | None = None
    edited_by_doctor: bool = False
    acknowledged_alert_ids: list[str] = []
    stt_engine: str
    llm_model: str


class SavedNote(BaseModel):
    note_id: str
    patient_uuid: uuid.UUID
    visit_id: str | None = None
    visit_at: datetime
    note: ClinicalNote
    alerts: list[SafetyAlert] = []
    source: Literal["ai_scribe", "doctor_notes"] = "ai_scribe"


class SimilarCase(BaseModel):
    patient_uuid: uuid.UUID
    display_name: str
    snippet: str
    recorded_on: date | None = None
    score: float


class QAAnswer(BaseModel):
    answer: str
    refused: bool = False
    citations: list[Evidence] = []


# ---------------------------------------------------------------- service interfaces
# Every method is a plain *synchronous* function. The orchestrator runs them in
# worker threads (asyncio.to_thread), so blocking model code is fine.

ProgressFn = Callable[[float], None]


class STTService(Protocol):
    name: str
    uses_gpu: bool
    def load(self) -> None: ...
    def unload(self) -> None: ...
    def transcribe(self, audio_path: Path, *, language_hint: str | None = None,
                   on_progress: ProgressFn | None = None) -> Transcript: ...


class RAGService(Protocol):
    name: str
    def load(self) -> None: ...
    def unload(self) -> None: ...
    def list_patients(self) -> list[PatientSummary]: ...
    def list_visits(self, day: date) -> list[Visit]: ...         # that day's clinic queue, token order
    def mark_visit_seen(self, visit_id: str) -> bool: ...        # False for an unknown visit_id
    def get_profile(self, patient_uuid: uuid.UUID) -> PatientProfile | None: ...
    def retrieve(self, patient_uuid: uuid.UUID, query: str, top_k: int = 8) -> list[ContextChunk]: ...
    def get_history(self, patient_uuid: uuid.UUID) -> list[ContextChunk]: ...   # every record, newest first
    def save_note(self, patient_uuid: uuid.UUID, note: ClinicalNote,
                  alerts: list[SafetyAlert], meta: NoteMeta) -> str: ...
    # save_note is an upsert: saving meta.note_id again replaces that note (doctor confirmation/edits).
    def set_note_facts(self, patient_uuid: uuid.UUID, note_id: str, facts: NoteFacts) -> int: ...
    # Replaces every fact that came from note_id with `facts` (origin_note_id = note_id).
    def delete_note(self, patient_uuid: uuid.UUID, note_id: str) -> int: ...     # the note + its facts
    def list_notes(self, patient_uuid: uuid.UUID) -> list[SavedNote]: ...
    def search_similar(self, query: str, top_k: int = 5) -> list[SimilarCase]: ...
    def delete_patient(self, patient_uuid: uuid.UUID) -> int: ...


class LLMService(Protocol):
    name: str
    uses_gpu: bool
    def load(self) -> None: ...
    def unload(self) -> None: ...
    def extract_note(self, transcript: Transcript) -> NoteExtraction: ...
    def review_safety(self, note: ClinicalNote, context: PatientContext,
                      research: list[DrugResearch]) -> list[SafetyAlert]: ...
    def propose_record_updates(self, note: ClinicalNote, profile: PatientProfile) -> RecordUpdate: ...
    # Facts from the note that belong in the long-term record, split into new / already on record.
    def predict_outcomes(self, profile: PatientProfile, history: list[ContextChunk],
                         already_identified: list[Prediction]) -> list[Prediction]: ...
    def answer_question(self, question: str, context: PatientContext) -> QAAnswer: ...


class PrivacyService(Protocol):
    name: str
    def load(self) -> None: ...
    def unload(self) -> None: ...
    def scrub_texts(self, texts: list[str], *, allow_terms: list[str],
                    deny_terms: list[str]) -> tuple[list[str], dict[str, int]]: ...
    # allow_terms: never redact (drug and symptom names). deny_terms: always redact
    # (the patient's own known names; spaCy's small model misses many Indian first names).


class ResearchService(Protocol):
    name: str
    def load(self) -> None: ...
    def unload(self) -> None: ...
    def search(self, query: str, *, max_results: int = 3) -> list[ResearchHit]: ...
