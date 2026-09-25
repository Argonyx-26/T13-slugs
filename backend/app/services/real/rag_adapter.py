"""RAG adapter for Sanjana's module (clinic DB + doctor's DB + vector store). STUB until merge day.

On merge day (plan Step 16.4): copy the module into backend/external/, then replace this
stub with a class that calls it and converts its output into app.contracts models. Seed
the three demo patients from app/fixtures/demo_patients.json inside load(), and put the ones
with a queue_token into today's queue.
Until then load() raises, so RAG_BACKEND=real fails loudly at startup, not mid-demo."""
import uuid
from datetime import date

from app.contracts import (ClinicalNote, ContextChunk, NoteFacts, NoteMeta, PatientProfile, PatientSummary,
                           SafetyAlert, SavedNote, SimilarCase, Visit)

_NOT_YET = "RAG adapter not written yet (merge day). Set RAG_BACKEND=mock."


class RealRAG:
    name = "rag-adapter"

    def __init__(self, settings):
        self._settings = settings

    def load(self) -> None:
        raise NotImplementedError(_NOT_YET)

    def unload(self) -> None:
        pass

    def list_patients(self) -> list[PatientSummary]:
        raise NotImplementedError(_NOT_YET)

    def list_visits(self, day: date) -> list[Visit]:
        raise NotImplementedError(_NOT_YET)

    def mark_visit_seen(self, visit_id: str) -> bool:
        raise NotImplementedError(_NOT_YET)

    def get_profile(self, patient_uuid: uuid.UUID) -> PatientProfile | None:
        raise NotImplementedError(_NOT_YET)

    def retrieve(self, patient_uuid: uuid.UUID, query: str, top_k: int = 8) -> list[ContextChunk]:
        raise NotImplementedError(_NOT_YET)

    def get_history(self, patient_uuid: uuid.UUID) -> list[ContextChunk]:
        raise NotImplementedError(_NOT_YET)

    def save_note(self, patient_uuid: uuid.UUID, note: ClinicalNote,
                  alerts: list[SafetyAlert], meta: NoteMeta) -> str:
        raise NotImplementedError(_NOT_YET)

    def set_note_facts(self, patient_uuid: uuid.UUID, note_id: str, facts: NoteFacts) -> int:
        raise NotImplementedError(_NOT_YET)

    def delete_note(self, patient_uuid: uuid.UUID, note_id: str) -> int:
        raise NotImplementedError(_NOT_YET)

    def list_notes(self, patient_uuid: uuid.UUID) -> list[SavedNote]:
        raise NotImplementedError(_NOT_YET)

    def search_similar(self, query: str, top_k: int = 5) -> list[SimilarCase]:
        raise NotImplementedError(_NOT_YET)

    def delete_patient(self, patient_uuid: uuid.UUID) -> int:
        raise NotImplementedError(_NOT_YET)
