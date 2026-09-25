"""Mock LLM. Returns the scripted note for the scenario the mock STT transcribed.

review_safety and predict_outcomes return nothing, so on mocks every alert and every
prediction comes from the real rule engines. propose_record_updates derives its
candidates directly from the note's structured fields; the orchestrator then decides
what is new and what is already on record, exactly as it does for the real model."""
import re
import time

from app.contracts import (ClinicalNote, ContextChunk, DrugResearch, Evidence, NoteExtraction, PatientContext,
                           PatientProfile, Prediction, QAAnswer, RecordChange, RecordUpdate, SafetyAlert,
                           Transcript)

_AS_NEEDED = re.compile(r"\b(if|as needed|sos|prn|when required)\b", re.IGNORECASE)


class MockLLM:
    name = "mock-llm"
    uses_gpu = True

    def __init__(self, settings, scenarios: dict):
        self._scale = settings.mock_latency_scale
        self._scenarios = {k: v for k, v in scenarios.items() if not k.startswith("_")}
        self._default = settings.mock_default_scenario

    def load(self) -> None:
        pass

    def unload(self) -> None:
        pass

    def extract_note(self, transcript: Transcript) -> NoteExtraction:
        time.sleep(3.0 * self._scale)
        scenario = transcript.engine.removeprefix("mock:")
        data = self._scenarios.get(scenario) or self._scenarios[self._default]
        return NoteExtraction(note=ClinicalNote.model_validate(data["note"]),
                              speaker_roles=data["speaker_roles"], model=self.name)

    def review_safety(self, note: ClinicalNote, context: PatientContext,
                      research: list[DrugResearch]) -> list[SafetyAlert]:
        time.sleep(1.0 * self._scale)
        return []

    def propose_record_updates(self, note: ClinicalNote, profile: PatientProfile) -> RecordUpdate:
        """Allergies mentioned, plus ongoing medications (not fixed short courses, not as-needed)."""
        time.sleep(1.0 * self._scale)
        changes = [RecordChange(category="allergy", value=a) for a in note.allergies_mentioned]
        for p in note.prescriptions:
            if p.duration or (p.frequency and _AS_NEEDED.search(p.frequency)):
                continue
            changes.append(RecordChange(category="medication",
                                        value=" ".join(x for x in (p.drug, p.dose, p.frequency) if x)))
        return RecordUpdate(added=changes)

    def predict_outcomes(self, profile: PatientProfile, history: list[ContextChunk],
                         already_identified: list[Prediction]) -> list[Prediction]:
        time.sleep(1.0 * self._scale)
        return []

    def answer_question(self, question: str, context: PatientContext) -> QAAnswer:
        time.sleep(1.0 * self._scale)
        if not context.chunks:
            return QAAnswer(answer="[MOCK] No matching records were found for this patient.")
        top = context.chunks[0]
        return QAAnswer(answer=f"[MOCK] {top.text}",
                        citations=[Evidence(source=top.source, snippet=top.text, recorded_on=top.recorded_on)])
