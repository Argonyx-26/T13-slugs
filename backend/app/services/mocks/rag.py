"""Mock RAG: the three synthetic demo patients, plus saved notes and the facts they add,
kept in memory.

Ranking is plain keyword overlap, |q ∩ d| / sqrt(|q| * |d|), newest first on ties.
Facts added by a consultation note carry origin_note_id, so confirming, editing or
deleting that note replaces or removes exactly those facts.
Every day's clinic queue is the demo patients with a queue_token, built on first request,
so the demo always has a queue whatever the date."""
from __future__ import annotations

import math
import re
import time
import uuid
from datetime import date

from app.contracts import (ClinicalNote, ContextChunk, Fact, LabResult, NoteFacts, NoteMeta, PatientProfile,
                           PatientSummary, SafetyAlert, SavedNote, SimilarCase, Visit)

_STOPWORDS = {"a", "an", "and", "any", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from",
              "had", "has", "have", "how", "i", "in", "is", "it", "of", "on", "or", "patient", "the",
              "this", "that", "to", "was", "were", "what", "when", "which", "who", "with"}


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOPWORDS}


def _overlap(q: set[str], d: set[str]) -> float:
    if not q or not d:
        return 0.0
    return len(q & d) / math.sqrt(len(q) * len(d))


def _newest_first(d: date | None) -> int:
    return -(d or date.min).toordinal()


def _note_text(note: ClinicalNote) -> str:
    parts = [note.summary]
    if note.symptoms:
        parts.append("Symptoms: " + ", ".join(s.name for s in note.symptoms) + ".")
    if note.prescriptions:
        parts.append("Prescribed: " + ", ".join(p.drug for p in note.prescriptions) + ".")
    return " ".join(parts)


class MockRAG:
    name = "mock-rag"

    def __init__(self, settings, patients: list[dict]):
        self._scale = settings.mock_latency_scale
        self._patients: dict[uuid.UUID, dict] = {uuid.UUID(p["patient_uuid"]): p for p in patients}
        self._notes: dict[uuid.UUID, dict[str, SavedNote]] = {}
        self._facts: dict[uuid.UUID, dict[str, NoteFacts]] = {}     # patient -> note_id -> facts
        self._visits: dict[date, dict[str, Visit]] = {}              # day -> visit_id -> visit

    def load(self) -> None:
        pass

    def unload(self) -> None:
        pass

    def _documents(self, patient_uuid: uuid.UUID) -> list[ContextChunk]:
        p = self._patients[patient_uuid]
        docs = [ContextChunk(text=h["text"], source=h["source"], recorded_on=h.get("recorded_on"),
                             ref_id=f"{patient_uuid.hex[:8]}-h{i}")
                for i, h in enumerate(p.get("history", []))]
        for saved in self._notes.get(patient_uuid, {}).values():
            docs.append(ContextChunk(text=_note_text(saved.note), source=saved.source,
                                     recorded_on=saved.visit_at.date(), ref_id=saved.note_id))
        return docs

    def list_patients(self) -> list[PatientSummary]:
        time.sleep(0.05 * self._scale)
        return [PatientSummary(patient_uuid=pid, display_name=p["display_name"], age=p.get("age"), sex=p.get("sex"))
                for pid, p in self._patients.items()]

    def _queue(self, day: date) -> dict[str, Visit]:
        if day not in self._visits:
            self._visits[day] = {
                v.visit_id: v for v in (
                    Visit(visit_id=f"{day:%Y%m%d}-{p['queue_token']:02d}", patient_uuid=pid,
                          display_name=p["display_name"], age=p.get("age"), sex=p.get("sex"),
                          token=p["queue_token"])
                    for pid, p in self._patients.items() if p.get("queue_token") is not None)}
        return self._visits[day]

    def list_visits(self, day: date) -> list[Visit]:
        time.sleep(0.05 * self._scale)
        return sorted((v.model_copy() for v in self._queue(day).values()), key=lambda v: v.token)

    def mark_visit_seen(self, visit_id: str) -> bool:
        time.sleep(0.05 * self._scale)
        for queue in self._visits.values():
            if visit_id in queue:
                queue[visit_id].status = "seen"
                return True
        return False

    def get_profile(self, patient_uuid: uuid.UUID) -> PatientProfile | None:
        time.sleep(0.2 * self._scale)
        p = self._patients.get(patient_uuid)
        if p is None:
            return None
        profile = PatientProfile(
            patient_uuid=patient_uuid,
            allergies=[Fact.model_validate(f) for f in p.get("allergies", [])],
            active_medications=[Fact.model_validate(f) for f in p.get("active_medications", [])],
            conditions=[Fact.model_validate(f) for f in p.get("conditions", [])],
            labs=[LabResult.model_validate(lab) for lab in p.get("labs", [])])
        for facts in self._facts.get(patient_uuid, {}).values():
            profile.allergies += facts.allergies
            profile.active_medications += facts.active_medications
            profile.conditions += facts.conditions
        return profile

    def retrieve(self, patient_uuid: uuid.UUID, query: str, top_k: int = 8) -> list[ContextChunk]:
        time.sleep(0.2 * self._scale)
        if patient_uuid not in self._patients:
            return []
        q = _tokens(query)
        ranked = []
        for chunk in self._documents(patient_uuid):
            score = _overlap(q, _tokens(chunk.text))
            if score > 0:
                ranked.append(chunk.model_copy(update={"score": round(score, 3)}))
        ranked.sort(key=lambda c: (-c.score, _newest_first(c.recorded_on)))
        return ranked[:top_k]

    def get_history(self, patient_uuid: uuid.UUID) -> list[ContextChunk]:
        time.sleep(0.2 * self._scale)
        if patient_uuid not in self._patients:
            return []
        return sorted(self._documents(patient_uuid), key=lambda c: _newest_first(c.recorded_on))

    def save_note(self, patient_uuid: uuid.UUID, note: ClinicalNote,
                  alerts: list[SafetyAlert], meta: NoteMeta) -> str:
        time.sleep(0.2 * self._scale)
        if patient_uuid not in self._patients:
            raise KeyError("unknown patient")
        saved = SavedNote(note_id=meta.note_id, patient_uuid=patient_uuid, visit_id=meta.visit_id,
                          visit_at=meta.visit_at, note=note, alerts=alerts, source=meta.source)
        self._notes.setdefault(patient_uuid, {})[saved.note_id] = saved     # upsert
        return saved.note_id

    def set_note_facts(self, patient_uuid: uuid.UUID, note_id: str, facts: NoteFacts) -> int:
        time.sleep(0.1 * self._scale)
        if patient_uuid not in self._patients:
            raise KeyError("unknown patient")
        tagged = NoteFacts(**{field: [f.model_copy(update={"origin_note_id": note_id}) for f in getattr(facts, field)]
                              for field in ("allergies", "active_medications", "conditions")})
        self._facts.setdefault(patient_uuid, {})[note_id] = tagged
        return len(tagged.allergies) + len(tagged.active_medications) + len(tagged.conditions)

    def delete_note(self, patient_uuid: uuid.UUID, note_id: str) -> int:
        time.sleep(0.1 * self._scale)
        removed = 1 if self._notes.get(patient_uuid, {}).pop(note_id, None) else 0
        facts = self._facts.get(patient_uuid, {}).pop(note_id, None)
        if facts:
            removed += len(facts.allergies) + len(facts.active_medications) + len(facts.conditions)
        return removed

    def list_notes(self, patient_uuid: uuid.UUID) -> list[SavedNote]:
        time.sleep(0.05 * self._scale)
        return sorted(self._notes.get(patient_uuid, {}).values(), key=lambda n: n.visit_at, reverse=True)

    def search_similar(self, query: str, top_k: int = 5) -> list[SimilarCase]:
        time.sleep(0.2 * self._scale)
        q = _tokens(query)
        best: dict[uuid.UUID, tuple[float, ContextChunk]] = {}
        for pid in self._patients:
            for chunk in self._documents(pid):
                score = _overlap(q, _tokens(chunk.text))
                if score <= 0:
                    continue
                current = best.get(pid)
                if current is None or (score, chunk.recorded_on or date.min) > \
                        (current[0], current[1].recorded_on or date.min):
                    best[pid] = (score, chunk)
        cases = [SimilarCase(patient_uuid=pid, display_name=self._patients[pid]["display_name"],
                             snippet=chunk.text, recorded_on=chunk.recorded_on, score=round(score, 3))
                 for pid, (score, chunk) in best.items()]
        cases.sort(key=lambda c: (-c.score, _newest_first(c.recorded_on)))
        return cases[:top_k]

    def delete_patient(self, patient_uuid: uuid.UUID) -> int:
        time.sleep(0.1 * self._scale)
        patient = self._patients.pop(patient_uuid, None)
        notes = self._notes.pop(patient_uuid, {})
        facts = self._facts.pop(patient_uuid, {})
        for queue in self._visits.values():
            for visit_id in [k for k, v in queue.items() if v.patient_uuid == patient_uuid]:
                del queue[visit_id]
        removed = len(notes) + sum(len(f.allergies) + len(f.active_medications) + len(f.conditions)
                                   for f in facts.values())
        if patient is not None:
            removed += 1 + len(patient.get("history", []))
        return removed
