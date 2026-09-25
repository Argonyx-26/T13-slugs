"""The Ollama adapter's HTTP handling, against a fake Ollama server (httpx.MockTransport)."""
import json

import httpx
import pytest
from pydantic import ValidationError

import uuid

from app.config import Settings
from app.contracts import ClinicalNote, PatientContext, PatientProfile, RecordUpdate, Segment, Transcript
from app.services.real.llm_ollama import OllamaLLM, _Extraction, _Predictions, _Review

TRANSCRIPT = Transcript(segments=[Segment(start=0, end=2, speaker="SPEAKER_00", text="Take Amoxicillin 500 mg.")],
                        duration_s=2.0, engine="test")
EXTRACTION = {"note": {"summary": "Amoxicillin was prescribed.",
                       "prescriptions": [{"drug": "Amoxicillin", "dose": "500 mg"}]},
              "speaker_roles": {"SPEAKER_00": "doctor"}}


def _llm(replies: list[str]) -> tuple[OllamaLLM, list[dict]]:
    """An adapter wired to a fake server that answers /api/chat with the given contents, in order."""
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        content = replies.pop(0) if body.get("messages") else ""
        return httpx.Response(200, json={"message": {"role": "assistant", "content": content}, "done": True})

    settings = Settings(ollama_url="http://ollama.test", ollama_model="test-model")
    return OllamaLLM(settings, transport=httpx.MockTransport(handler)), requests


def test_extract_note_sends_schema_and_temperature_zero():
    llm, requests = _llm([json.dumps(EXTRACTION)])
    out = llm.extract_note(TRANSCRIPT)
    assert out.note.prescriptions[0].drug == "Amoxicillin"
    assert out.speaker_roles == {"SPEAKER_00": "doctor"} and out.model == "test-model"
    body = requests[0]
    assert body["format"] == _Extraction.model_json_schema()
    assert body["options"] == {"temperature": 0} and body["stream"] is False and body["model"] == "test-model"
    assert body["messages"][1]["content"] == "SPEAKER_00: Take Amoxicillin 500 mg."


def test_invalid_json_is_retried_once():
    llm, requests = _llm(["not json at all", json.dumps(EXTRACTION)])
    assert llm.extract_note(TRANSCRIPT).note.summary == "Amoxicillin was prescribed."
    assert len(requests) == 2
    retry = requests[1]["messages"]
    assert retry[-2] == {"role": "assistant", "content": "not json at all"}
    assert "did not match the schema" in retry[-1]["content"]

    llm, requests = _llm(["nope", "still nope"])
    with pytest.raises(ValidationError):
        llm.extract_note(TRANSCRIPT)
    assert len(requests) == 2                            # one retry, never more


def test_review_alerts_are_marked_llm():
    review = {"alerts": [{"category": "drug_interaction", "severity": "warning", "message": "Interaction noted.",
                          "drug": "ibuprofen",
                          "evidence": [{"source": "clinic_db", "snippet": "Warfarin 5 mg"}]}]}
    llm, requests = _llm([json.dumps(review)])
    note = ClinicalNote.model_validate(EXTRACTION["note"])
    alerts = llm.review_safety(note, PatientContext(), [])
    assert [(a.origin, a.category, a.drug) for a in alerts] == [("llm", "drug_interaction", "ibuprofen")]
    assert requests[0]["format"] == _Review.model_json_schema()
    sent = json.loads(requests[0]["messages"][1]["content"])
    assert set(sent) == {"new_note", "patient_records", "web_research"}


def test_record_update_and_predictions_send_schemas():
    update = {"added": [{"category": "medication", "value": "Atorvastatin 10 mg once daily"}],
              "already_on_record": [{"category": "medication", "value": "Metformin 500 mg twice daily"}]}
    predictions = {"predictions": [{"outcome": "HbA1c is likely to rise further.", "likelihood": "moderate",
                                    "reasoning": "HbA1c rose from 7.4 % to 8.1 %.",
                                    "evidence": [{"source": "clinic_db", "snippet": "HbA1c: 8.1 %"}]}]}
    llm, requests = _llm([json.dumps(update), json.dumps(predictions)])
    note = ClinicalNote.model_validate(EXTRACTION["note"])
    profile = PatientProfile(patient_uuid=uuid.uuid4())

    proposal = llm.propose_record_updates(note, profile)
    assert [c.value for c in proposal.added] == ["Atorvastatin 10 mg once daily"]
    assert requests[0]["format"] == RecordUpdate.model_json_schema()
    assert set(json.loads(requests[0]["messages"][1]["content"])) == {"new_note", "current_record"}

    found = llm.predict_outcomes(profile, [], [])
    assert [(p.origin, p.likelihood) for p in found] == [("llm", "moderate")]
    assert requests[1]["format"] == _Predictions.model_json_schema()
    assert set(json.loads(requests[1]["messages"][1]["content"])) == {"record", "history", "already_identified"}


def test_load_and_unload_use_keep_alive():
    llm, requests = _llm([])
    llm.load()
    llm.unload()
    assert [r["keep_alive"] for r in requests] == ["60m", 0]
    assert all(r["messages"] == [] and r["model"] == "test-model" for r in requests)
