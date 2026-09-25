"""The pipeline end to end on mocks: the three demo scenarios, every failure rule in plan
section 3.3, automatic saving, the record update, predictions, the doctor's confirm and
discard actions, privacy guarantees and parallelism."""
import logging
import time

from app.contracts import Evidence, Prediction, Segment, Transcript
from app.orchestrator import intake
from tests.conftest import ARJUN, LAKSHMI, RAVI, boom, eventually, orch, run_job, submit, wait


def _spy_research(client) -> list[str]:
    queries: list[str] = []
    o = orch(client)
    original = o.svc.research.search
    o.svc.research.search = lambda q, **k: queries.append(q) or original(q, **k)
    return queries


def _scratch_files(client) -> list:
    return list(orch(client).scratch.iterdir())


def _notes(client, patient: str) -> list[dict]:
    return client.get(f"/api/v1/patients/{patient}/notes").json()


def _medications(client, patient: str) -> list[dict]:
    return client.get(f"/api/v1/patients/{patient}").json()["active_medications"]


# ---------------------------------------------------------------- the three demo scenarios


def test_ravi_penicillin_saved_automatically(client):
    body = run_job(client, RAVI)
    assert body["stage"] == "saved" and body["error"] is None
    assert body["stage_label"] == "Saved to the patient record (AI scribe, awaiting your review)"
    result = body["result"]
    assert result["status"] == "saved"

    first, second = result["alerts"]
    assert (first["category"], first["severity"], first["origin"], first["drug"]) == \
        ("allergy_conflict", "critical", "rule_engine", "amoxicillin")
    assert first["message"] == ("Amoxicillin (a penicillin-class drug) was prescribed. Patient record lists a "
                                "Penicillin allergy (doctor note, 10 Sep 2026).")
    assert first["evidence"][0]["source"] == "doctor_notes" and first["evidence"][0]["recorded_on"] == "2026-09-10"
    assert (second["category"], second["severity"]) == ("history_contradiction", "info")
    assert "The more recent doctor note takes precedence." in second["message"]

    assert result["checks"] == {"history": "ok", "web_research": "ok", "ai_review": "ok", "rules": "ok",
                                "record_update": "ok", "predictions": "ok", "safety_check": "complete"}
    assert result["privacy"] == {"PERSON": 1}
    assert result["note"]["summary"].startswith("<PERSON> reports")
    assert [r["drug"] for r in result["research"]] == ["amoxicillin", "paracetamol"]
    assert result["research"][0]["query"] == "amoxicillin drug safety warnings interactions"
    assert result["speaker_roles"] == {"SPEAKER_00": "doctor", "SPEAKER_01": "patient"}
    assert result["transcript"]["engine"] == "mock:penicillin" and result["transcript"]["aligned"] is False
    assert result["models"] == {"stt": "mock:penicillin", "llm": "mock-llm"}
    assert "not a diagnosis" in result["disclaimer"]
    assert {"stt", "llm_extract", "scrub", "history", "web_research", "gathering_context", "llm_review",
            "save", "record_update", "predictions"} <= set(body["timings_ms"])
    assert _scratch_files(client) == []                 # the recording is gone

    # Saved to the record without a tap, marked as not yet reviewed, and already scrubbed.
    [saved] = _notes(client, RAVI)
    assert saved["note_id"] == result["note_id"] and saved["source"] == "ai_scribe"
    assert saved["note"]["summary"].startswith("<PERSON> reports")
    # Short courses (Amoxicillin for 5 days, Paracetamol if fever) are not long-term medications.
    assert result["record_update"] == {"added": [], "already_on_record": []}
    reaction = result["predictions"]["predictions"][0]
    assert reaction["likelihood"] == "high" and "penicillin" in reaction["outcome"]


def test_lakshmi_brand_name_interaction(client):
    result = run_job(client, LAKSHMI)["result"]
    interaction = next(a for a in result["alerts"] if a["category"] == "drug_interaction")
    assert (interaction["severity"], interaction["drug"], interaction["origin"]) == \
        ("critical", "ibuprofen", "rule_engine")
    assert "Brufen (ibuprofen)" in interaction["message"] and "Warfarin" in interaction["message"]
    assert {e["source"] for e in interaction["evidence"]} == {"clinic_db", "rule_table"}
    assert result["alerts"][0] == interaction           # critical first
    assert [r["drug"] for r in result["research"]] == ["ibuprofen"]


def test_arjun_overdue_hba1c(client):
    result = run_job(client, ARJUN)["result"]
    omission = next(a for a in result["alerts"] if a["category"] == "possible_omission")
    assert omission["severity"] == "info" and omission["origin"] == "rule_engine"
    assert omission["message"].startswith("Last HbA1c on record: 8.1 % on 15 Jan 2026 (")
    assert result["checks"]["safety_check"] == "complete"


# ---------------------------------------------------------------- failure rules (plan 3.3)


def test_history_down_is_visible(client):
    orch(client).svc.rag.get_profile = boom
    body = run_job(client)
    assert body["stage"] == "saved"                     # the note itself is still saved
    checks = body["result"]["checks"]
    assert checks["history"] == "unavailable" and checks["rules"] == "unavailable"
    assert checks["safety_check"] == "unavailable"
    assert checks["record_update"] == "unavailable" and checks["predictions"] == "unavailable"
    top = body["result"]["alerts"][0]
    assert (top["category"], top["origin"]) == ("data_gap", "system")
    assert "NOT performed" in top["message"]


def test_research_down_job_continues(client):
    orch(client).svc.research.search = boom
    body = run_job(client)
    assert body["stage"] == "saved"
    checks = body["result"]["checks"]
    assert checks["web_research"] == "unavailable" and checks["safety_check"] == "complete"
    assert body["result"]["research"] == []
    assert body["result"]["alerts"][0]["category"] == "allergy_conflict"


def test_ai_review_down_keeps_rule_alerts(client):
    orch(client).svc.llm.review_safety = boom
    body = run_job(client)
    checks = body["result"]["checks"]
    assert checks["ai_review"] == "unavailable" and checks["safety_check"] == "partial"
    assert any(a["category"] == "allergy_conflict" for a in body["result"]["alerts"])


def test_llm_down_fails_without_research(client):
    queries = _spy_research(client)
    orch(client).svc.llm.extract_note = boom
    body = run_job(client)
    assert body["stage"] == "failed" and body["result"] is None
    assert body["error"]["code"] == "NOTE_GENERATION_FAILED" and body["error"]["stage"] == "writing_note"
    assert queries == [] and _notes(client, RAVI) == []
    assert _scratch_files(client) == []


def test_scrub_down_fails_closed(client):
    queries = _spy_research(client)
    saved = []
    o = orch(client)
    o.svc.rag.save_note = lambda *a, **k: saved.append(a)
    o.svc.privacy.scrub_texts = boom
    body = run_job(client)
    assert body["stage"] == "failed"
    assert body["error"]["code"] == "PRIVACY_SCRUB_FAILED" and body["error"]["stage"] == "scrubbing_pii"
    assert body["result"] is None and queries == [] and saved == [] and o.jobs.drafts == {}
    assert _scratch_files(client) == []


def test_no_speech(client):
    orch(client).svc.stt.transcribe = lambda *a, **k: Transcript(
        segments=[Segment(start=0.0, end=2.0, speaker="SPEAKER_00", text="   ")], duration_s=2.0, engine="mock:silence")
    body = run_job(client)
    assert body["stage"] == "failed"
    assert body["error"]["code"] == "NO_SPEECH" and body["error"]["stage"] == "transcribing"
    assert _scratch_files(client) == []


def test_save_failure_keeps_draft_for_retry(client):
    o = orch(client)
    original = o.svc.rag.save_note
    o.svc.rag.save_note = boom
    body = run_job(client)
    assert body["stage"] == "ready_for_review" and body["result"]["status"] == "draft"
    top = body["result"]["alerts"][0]
    assert (top["category"], top["origin"]) == ("data_gap", "system") and "could not be saved" in top["message"]
    assert body["result"]["record_update"] is None and _notes(client, RAVI) == []

    o.svc.rag.save_note = original                      # the doctor taps Save again
    r = client.post(f"/api/v1/notes/{body['result']['note_id']}/approve")
    assert r.status_code == 200 and r.json()["status"] == "verified"
    [saved] = _notes(client, RAVI)
    assert saved["source"] == "doctor_notes"

    def refreshed():                                    # record update + predictions rerun in the background
        job = client.get(f"/api/v1/jobs/{body['job_id']}").json()
        return job if job["result"]["predictions"] else None

    job = eventually(refreshed)
    assert job["stage"] == "verified" and job["result"]["checks"]["record_update"] == "ok"


def test_record_update_down_note_still_saved(client):
    orch(client).svc.llm.propose_record_updates = boom
    body = run_job(client, ARJUN)
    assert body["stage"] == "saved" and len(_notes(client, ARJUN)) == 1
    assert body["result"]["checks"]["record_update"] == "unavailable" and body["result"]["record_update"] is None
    assert body["result"]["checks"]["predictions"] == "ok"


# ---------------------------------------------------------------- record update: new vs redundant


def test_record_update_adds_new_and_ignores_known(client):
    result = run_job(client, ARJUN)["result"]
    update = result["record_update"]
    assert [(c["category"], c["value"]) for c in update["added"]] == \
        [("medication", "Atorvastatin 10 mg once daily at night")]
    assert [(c["category"], c["value"]) for c in update["already_on_record"]] == \
        [("medication", "Metformin 500 mg twice daily")]

    meds = _medications(client, ARJUN)
    assert [m["value"] for m in meds].count("Metformin 500 mg twice daily") == 1     # not stored twice
    statin = next(m for m in meds if m["value"].startswith("Atorvastatin"))
    assert statin["source"] == "ai_scribe" and statin["origin_note_id"] == result["note_id"]

    # The same consultation again: the statin is now on record too, so nothing new is added.
    again = run_job(client, ARJUN)["result"]["record_update"]
    assert again["added"] == [] and len(again["already_on_record"]) == 2
    assert len(_medications(client, ARJUN)) == 2


# ---------------------------------------------------------------- the doctor's actions


def test_confirm_note_once(client):
    body = run_job(client)
    note_id = body["result"]["note_id"]
    r = client.post(f"/api/v1/notes/{note_id}/approve")
    assert r.status_code == 200 and r.json()["status"] == "verified" and r.json()["note_id"] == note_id
    job = client.get(f"/api/v1/jobs/{body['job_id']}").json()
    assert job["stage"] == "verified" and job["result"]["status"] == "verified"

    again = client.post(f"/api/v1/notes/{note_id}/approve")
    assert again.status_code == 409 and again.json()["error"]["code"] == "NOTE_ALREADY_FINAL"
    [saved] = _notes(client, RAVI)                      # confirmed in place, not saved twice
    assert saved["source"] == "doctor_notes"
    assert client.post("/api/v1/notes/does-not-exist/approve").status_code == 404


def test_confirm_upgrades_facts_to_doctor_notes(client):
    result = run_job(client, ARJUN)["result"]
    assert client.post(f"/api/v1/notes/{result['note_id']}/approve").status_code == 200
    statin = next(m for m in _medications(client, ARJUN) if m["value"].startswith("Atorvastatin"))
    assert statin["source"] == "doctor_notes"


def test_edited_note_is_scrubbed_again(client):
    result = run_job(client)["result"]
    edited = dict(result["note"], summary="Ravi says the headache is better since this morning.")
    r = client.post(f"/api/v1/notes/{result['note_id']}/approve", json={"note": edited})
    assert r.status_code == 200
    [saved] = _notes(client, RAVI)
    assert saved["note"]["summary"] == "<PERSON> says the headache is better since this morning."
    assert saved["source"] == "doctor_notes"


def test_edited_allergy_joins_profile(client):
    result = run_job(client, ARJUN)["result"]
    edited = dict(result["note"], allergies_mentioned=["Sulfa drugs"])
    assert client.post(f"/api/v1/notes/{result['note_id']}/approve", json={"note": edited}).status_code == 200

    def sulfa():
        allergies = client.get(f"/api/v1/patients/{ARJUN}").json()["allergies"]
        return next((a for a in allergies if a["value"] == "Sulfa drugs"), None)

    fact = eventually(sulfa)                            # the record update reruns in the background
    assert fact["source"] == "doctor_notes" and fact["recorded_on"]
    statin = next(m for m in _medications(client, ARJUN) if m["value"].startswith("Atorvastatin"))
    assert statin["source"] == "doctor_notes"


def test_discard_removes_note_and_facts(client):
    body = run_job(client, ARJUN)
    note_id = body["result"]["note_id"]
    assert any(m["value"].startswith("Atorvastatin") for m in _medications(client, ARJUN))

    r = client.post(f"/api/v1/notes/{note_id}/discard")
    assert r.status_code == 200 and r.json() == {"note_id": note_id, "status": "discarded"}
    assert client.get(f"/api/v1/jobs/{body['job_id']}").json()["stage"] == "discarded"
    assert _notes(client, ARJUN) == []
    assert not any(m["value"].startswith("Atorvastatin") for m in _medications(client, ARJUN))
    assert client.post(f"/api/v1/notes/{note_id}/approve").status_code == 409
    assert client.post(f"/api/v1/notes/{note_id}/discard").status_code == 409


# ---------------------------------------------------------------- predictions


def test_predictions_follow_the_whole_history(client):
    lakshmi = run_job(client, LAKSHMI)["result"]["predictions"]
    knee = next(p for p in lakshmi["predictions"] if p["outcome"] == "Knee pain is likely to recur or persist.")
    assert knee["origin"] == "rule_engine" and knee["likelihood"] == "moderate"
    assert "14 Mar 2026" in knee["reasoning"]           # the older doctor note ...
    assert {e["source"] for e in knee["evidence"]} == {"doctor_notes", "ai_scribe"}   # ... and today's note

    arjun = run_job(client, ARJUN)["result"]["predictions"]
    trend = next(p for p in arjun["predictions"] if p["outcome"].startswith("HbA1c"))
    assert trend["outcome"] == "HbA1c is likely to be higher than 8.1 % at the next test if the recent trend continues."
    assert trend["reasoning"] == "HbA1c went from 7.4 % (10 Jul 2025) to 8.1 % (15 Jan 2026)."
    for report in (lakshmi, arjun):
        assert report["withheld"] == 0 and report["model"] == "mock-llm+rules"
        assert all(p["evidence"] for p in report["predictions"])


def test_ai_predictions_are_screened_for_advice(client):
    evidence = [Evidence(source="clinic_db", snippet="HbA1c: 8.1 %")]
    orch(client).svc.llm.predict_outcomes = lambda *a, **k: [
        Prediction(outcome="Thirst and tiredness are likely to continue while glucose stays high.",
                   likelihood="moderate", reasoning="HbA1c rose to 8.1 % in January 2026.", evidence=evidence,
                   origin="rule_engine"),                                    # origin is forced to llm
        Prediction(outcome="The doctor should start insulin.", likelihood="high",
                   reasoning="HbA1c is high.", evidence=evidence, origin="llm"),
        Prediction(outcome="Kidney function may decline.", likelihood="low",
                   reasoning="Long-standing diabetes.", evidence=[], origin="llm"),
    ]
    report = run_job(client, ARJUN)["result"]["predictions"]
    ai = [p for p in report["predictions"] if p["origin"] == "llm"]
    assert [p["outcome"] for p in ai] == ["Thirst and tiredness are likely to continue while glucose stays high."]
    assert report["withheld"] == 2
    assert not any("insulin" in p["outcome"].lower() for p in report["predictions"])


def test_prediction_ai_down_keeps_rule_predictions(client):
    orch(client).svc.llm.predict_outcomes = boom
    body = run_job(client, ARJUN)
    assert body["result"]["checks"]["predictions"] == "partial"
    report = body["result"]["predictions"]
    assert report["model"] == "rule_engine"
    assert any(p["outcome"].startswith("HbA1c") for p in report["predictions"])


# ---------------------------------------------------------------- privacy


def test_no_phi_in_logs_or_search_queries(client, caplog):
    queries = []
    o = orch(client)
    original = o.svc.research.search
    o.svc.research.search = lambda q, **k: queries.append(q) or original(q, **k)
    with caplog.at_level(logging.DEBUG):
        run_job(client)
    logs = caplog.text.lower()
    for secret in ("ravi", "thale novu", "headache", "penicillin", "amoxicillin"):
        assert secret not in logs, secret
    assert queries and all(q.endswith(" drug safety warnings interactions") for q in queries)
    assert not any("ravi" in q.lower() for q in queries)


def test_large_upload_stays_in_memory(client, monkeypatch):
    seen = {}
    original = intake.save_upload

    async def spy(upload, *args, **kwargs):
        seen["rolled"] = upload.file._rolled          # True would mean Starlette spooled it to disk
        return await original(upload, *args, **kwargs)

    monkeypatch.setattr(intake, "save_upload", spy)
    r = submit(client, audio=("visit.m4a", b"\x00" * (5 * 1024 * 1024), "audio/mp4"))
    assert r.status_code == 202, r.text
    assert seen["rolled"] is False
    assert wait(client, r.json()["job_id"])["stage"] == "saved"


# ---------------------------------------------------------------- parallelism


def test_history_and_research_run_in_parallel(client):
    o = orch(client)

    def slow(fn):
        return lambda *a, **k: (time.sleep(0.4), fn(*a, **k))[1]

    o.svc.rag.retrieve = slow(o.svc.rag.retrieve)
    o.svc.research.search = slow(o.svc.research.search)
    timings = run_job(client)["timings_ms"]
    assert timings["history"] >= 400 and timings["web_research"] >= 400
    assert timings["gathering_context"] < 750
