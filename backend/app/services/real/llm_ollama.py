"""Module 4: the LLM, served by Ollama on our own GPU (LLM_BACKEND=real).

Start Ollama pinned to the second GPU so WhisperX keeps GPU 0:
    subprocess.Popen(["ollama", "serve"], env={**os.environ, "CUDA_VISIBLE_DEVICES": "1"})

Structured output: Ollama's `format` gets our Pydantic JSON schema, the answer is
validated, and an invalid answer is retried once. The HTTP handling is tested against
a fake Ollama server (tests/test_llm_ollama.py). The prompts are FIRST DRAFTS: test
candidate models on the three scripted consultations before committing to one.
"""
from __future__ import annotations

import json
from typing import Literal

import httpx
from pydantic import BaseModel, ValidationError

from app.contracts import (ClinicalNote, ContextChunk, DrugResearch, Evidence, NoteExtraction, PatientContext,
                           PatientProfile, Prediction, QAAnswer, RecordUpdate, SafetyAlert, Transcript)

EXTRACT_PROMPT = """You are a clinical scribe. You receive the transcript of one doctor-patient \
consultation. It may be in Kannada, English or a mix of both. Each line starts with a speaker label.

Write a structured clinical note in English:
- Translate everything into clear clinical English.
- Record only what was actually said. Never add facts, findings, advice or drugs that were not spoken.
- Never add a diagnosis. Fill "doctor_assessment" only if the doctor stated an assessment out loud; otherwise null.
- Keep every drug name exactly as spoken (brand or generic, e.g. "Brufen", "Amoxicillin"). Put dose, \
frequency, duration and route in their own fields.
- "allergies_mentioned" lists only allergies stated in this consultation.
- "relevant_history" lists only history mentioned in this consultation.
- "summary" is 2-4 plain English sentences.
- "speaker_roles" maps every speaker label to "doctor", "patient" or "other".
Reply with JSON only, matching the schema."""

REVIEW_PROMPT = """You are an analytical assistant supporting a doctor. You are not a doctor.
You receive a new consultation note ("new_note"), the patient's existing records ("patient_records") \
and recent drug-safety information from trusted sources ("web_research").

Report only safety issues that the evidence supports:
- allergy_conflict: a prescribed drug conflicts with a recorded allergy.
- drug_interaction: a prescribed drug interacts with another prescribed drug or an active medication.
- history_contradiction: the new note contradicts the patient's records.
- possible_omission: something the records show is due (for example an overdue test) is not in the note.
Rules:
- Cite the evidence for every alert: source, a short snippet, the date when known, the URL for web research.
- State facts neutrally. Never recommend, instruct, diagnose or suggest a treatment.
- Records with source "ai_scribe" were saved automatically and are not yet reviewed by the doctor.
- "drug" is the generic name of the drug concerned, or null.
- If nothing is found, return {"alerts": []}.
Reply with JSON only, matching the schema."""

RECORD_PROMPT = """You keep a patient's long-term record up to date. You receive today's consultation \
note ("new_note") and the patient's current record ("current_record": allergies, active medications, \
conditions and labs, each with its source and date).

List every fact from the new note that belongs in the long-term record:
- "allergy": an allergy stated in the note.
- "medication": an ongoing medication with its dose and frequency. Skip short fixed courses \
(for example "for 5 days") and as-needed drugs.
- "condition": a long-term condition stated in the note. Never infer a condition that was not stated.
Put each fact in "added" if it is new, or in "already_on_record" if the current record already \
contains it, even when worded differently (brand or generic name, abbreviation, synonym).
Write each value in plain English. Never add advice, diagnoses or anything not in the note.
Reply with JSON only, matching the schema."""

PREDICT_PROMPT = """You are an analytical assistant supporting a doctor. You are not a doctor.
You receive one patient's stored record ("record": allergies, medications, conditions, labs) and \
history entries ("history", newest first, each with its source and date), plus outcomes that were \
already identified by a rule engine ("already_identified").

Estimate what is likely to happen for this patient, to inform the doctor's own assessment:
- Each prediction gives a possible future development ("outcome"), a likelihood ("low", "moderate" \
or "high"), a timeframe when the records support one, and the reasoning with the dates it relies on.
- Every prediction cites at least one record in "evidence" (source, a short snippet, the date).
- Use only the records provided. Never invent facts.
- Never recommend or suggest tests, drugs, procedures, referrals or treatment, and never give advice. \
Describe what may happen, not what to do.
- Do not state a diagnosis. Describe risks and likely developments instead.
- Records with source "ai_scribe" were saved automatically and not yet reviewed; say so in the \
reasoning when a prediction depends on them.
- Do not repeat anything in "already_identified".
- If the records are not enough, return {"predictions": []}.
Reply with JSON only, matching the schema."""

ANSWER_PROMPT = """You are an analytical assistant answering a doctor's question about one patient.
Answer only from the patient records provided. If the records do not contain the answer, say so.
Never diagnose, recommend a treatment or give a medical opinion. Keep the answer short and include dates.
Reply with JSON only, matching the schema."""


class _Extraction(BaseModel):
    note: ClinicalNote
    speaker_roles: dict[str, Literal["doctor", "patient", "other"]] = {}


class _Alert(BaseModel):
    category: Literal["allergy_conflict", "drug_interaction", "history_contradiction", "possible_omission"]
    severity: Literal["critical", "warning", "info"]
    message: str
    drug: str | None = None
    evidence: list[Evidence] = []


class _Review(BaseModel):
    alerts: list[_Alert] = []


class _Prediction(BaseModel):
    outcome: str
    likelihood: Literal["low", "moderate", "high"]
    timeframe: str | None = None
    reasoning: str
    evidence: list[Evidence] = []


class _Predictions(BaseModel):
    predictions: list[_Prediction] = []


class _Answer(BaseModel):
    answer: str


class OllamaLLM:
    name = "ollama"
    uses_gpu = True

    def __init__(self, settings, transport: httpx.BaseTransport | None = None):
        self._model = settings.ollama_model
        self._http = httpx.Client(base_url=settings.ollama_url, transport=transport,
                                  timeout=httpx.Timeout(600.0, connect=10.0))

    def load(self) -> None:
        # An empty chat loads the model into VRAM and keeps it there.
        r = self._http.post("/api/chat", json={"model": self._model, "messages": [], "keep_alive": "60m"})
        r.raise_for_status()

    def unload(self) -> None:
        # keep_alive 0 frees the VRAM (GPU_POLICY=swap).
        r = self._http.post("/api/chat", json={"model": self._model, "messages": [], "keep_alive": 0})
        r.raise_for_status()

    def _ask(self, system: str, user: str, out: type[BaseModel]) -> BaseModel:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        for attempt in range(2):
            r = self._http.post("/api/chat", json={
                "model": self._model, "messages": messages, "stream": False, "keep_alive": "60m",
                "format": out.model_json_schema(), "options": {"temperature": 0}})
            r.raise_for_status()
            content = r.json()["message"]["content"]
            try:
                return out.model_validate_json(content)
            except ValidationError:
                if attempt == 1:
                    raise
                messages += [{"role": "assistant", "content": content},
                             {"role": "user", "content": "That did not match the schema. Reply again with valid JSON only."}]

    def extract_note(self, transcript: Transcript) -> NoteExtraction:
        out = self._ask(EXTRACT_PROMPT, transcript.as_dialogue(), _Extraction)
        return NoteExtraction(note=out.note, speaker_roles=out.speaker_roles, model=self._model)

    def review_safety(self, note: ClinicalNote, context: PatientContext,
                      research: list[DrugResearch]) -> list[SafetyAlert]:
        payload = {"new_note": note.model_dump(mode="json"),
                   "patient_records": context.model_dump(mode="json"),
                   "web_research": [r.model_dump(mode="json") for r in research]}
        out = self._ask(REVIEW_PROMPT, json.dumps(payload, ensure_ascii=False), _Review)
        return [SafetyAlert(category=a.category, severity=a.severity, message=a.message, drug=a.drug,
                            evidence=a.evidence, origin="llm")
                for a in out.alerts]

    def propose_record_updates(self, note: ClinicalNote, profile: PatientProfile) -> RecordUpdate:
        payload = {"new_note": note.model_dump(mode="json"), "current_record": profile.model_dump(mode="json")}
        return self._ask(RECORD_PROMPT, json.dumps(payload, ensure_ascii=False), RecordUpdate)

    def predict_outcomes(self, profile: PatientProfile, history: list[ContextChunk],
                         already_identified: list[Prediction]) -> list[Prediction]:
        payload = {"record": profile.model_dump(mode="json"),
                   "history": [c.model_dump(mode="json") for c in history],
                   "already_identified": [p.outcome for p in already_identified]}
        out = self._ask(PREDICT_PROMPT, json.dumps(payload, ensure_ascii=False), _Predictions)
        return [Prediction(**p.model_dump(), origin="llm") for p in out.predictions]

    def answer_question(self, question: str, context: PatientContext) -> QAAnswer:
        payload = {"question": question, "patient_records": context.model_dump(mode="json")}
        out = self._ask(ANSWER_PROMPT, json.dumps(payload, ensure_ascii=False), _Answer)
        citations = [Evidence(source=c.source, snippet=c.text, recorded_on=c.recorded_on) for c in context.chunks[:3]]
        return QAAnswer(answer=out.answer, citations=citations)
