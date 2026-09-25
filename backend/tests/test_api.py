"""HTTP contract: status codes, the one error format, uploads Flutter actually sends, the queue,
and today's clinic queue (the doctor's phone picks the patient, the recording lands on them)."""
import threading
import uuid

from app.orchestrator.pipeline import REFUSAL
from tests.conftest import ARJUN, AUDIO, LAKSHMI, RAVI, boom, orch, submit, wait


def test_health_ready_and_docs(client):
    health = client.get("/health")
    assert health.status_code == 200 and health.json()["status"] == "ok"
    ready = client.get("/ready")
    assert ready.status_code == 200
    body = ready.json()
    assert body["ready"] is True
    assert body["backends"] == {"stt": "mock", "rag": "mock", "llm": "mock", "privacy": "mock", "research": "mock"}
    assert body["gpu_models_loaded"] == {"stt": True, "llm": True}
    assert body["research_available"] is True and body["pending_jobs"] == 0
    assert client.get("/docs").status_code == 200


def test_patient_list_and_profile(client):
    patients = client.get("/api/v1/patients").json()
    assert [p["display_name"] for p in patients] == ["Ravi K.", "Lakshmi S.", "Arjun M."]
    profile = client.get(f"/api/v1/patients/{RAVI}").json()
    allergies = {(a["value"], a["source"], a["recorded_on"]) for a in profile["allergies"]}
    assert ("Penicillin", "doctor_notes", "2026-09-10") in allergies
    assert ("No known drug allergies", "clinic_db", "2024-03-02") in allergies
    missing = client.get(f"/api/v1/patients/{uuid.uuid4()}")
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "PATIENT_NOT_FOUND"


def _visit(client, patient: str) -> dict:
    return next(e for e in client.get("/api/v1/visits/today").json() if e["patient_uuid"] == patient)


def test_todays_queue(client):
    queue = client.get("/api/v1/visits/today").json()
    assert [(e["token"], e["patient_uuid"], e["display_name"], e["status"]) for e in queue] == [
        (1, RAVI, "Ravi K.", "waiting"), (2, LAKSHMI, "Lakshmi S.", "waiting"), (3, ARJUN, "Arjun M.", "waiting")]
    assert all(e["job_id"] is None and e["job_stage"] is None for e in queue)


def test_recording_lands_on_the_picked_patient(client):
    visit_id = _visit(client, RAVI)["visit_id"]
    accepted = submit(client, RAVI, visit_id=visit_id)
    assert accepted.status_code == 202, accepted.text
    body = accepted.json()
    assert (body["patient_uuid"], body["display_name"], body["visit_id"]) == (RAVI, "Ravi K.", visit_id)
    done = wait(client, body["job_id"])
    assert done["stage"] == "saved" and done["visit_id"] == visit_id

    row = _visit(client, RAVI)
    assert (row["status"], row["job_id"], row["job_stage"]) == ("seen", body["job_id"], "saved")
    assert _visit(client, LAKSHMI)["status"] == "waiting" and _visit(client, LAKSHMI)["job_id"] is None

    notes = client.get(f"/api/v1/patients/{RAVI}/notes").json()
    assert [(n["note_id"], n["visit_id"]) for n in notes] == [(done["result"]["note_id"], visit_id)]
    for other in (LAKSHMI, ARJUN):
        assert client.get(f"/api/v1/patients/{other}/notes").json() == []

    # The website finds the phone's recording by patient
    jobs = client.get("/api/v1/jobs", params={"patient_uuid": RAVI}).json()
    assert [j["job_id"] for j in jobs] == [body["job_id"]]
    assert client.get("/api/v1/jobs", params={"patient_uuid": LAKSHMI}).json() == []


def test_visit_must_belong_to_the_patient(client):
    lakshmi = _visit(client, LAKSHMI)
    mismatch = submit(client, RAVI, visit_id=lakshmi["visit_id"])
    assert mismatch.status_code == 409 and mismatch.json()["error"]["code"] == "VISIT_PATIENT_MISMATCH"
    unknown = submit(client, RAVI, visit_id="19990101-01")
    assert unknown.status_code == 404 and unknown.json()["error"]["code"] == "VISIT_NOT_FOUND"
    assert orch(client).jobs.jobs == {}                 # no job, no audio kept
    assert _visit(client, LAKSHMI)["status"] == "waiting"


def test_walk_in_and_unreadable_queue_still_record(client):
    walk_in = submit(client, ARJUN)                     # no visit_id: picked through search
    assert walk_in.status_code == 202 and walk_in.json()["visit_id"] is None
    assert wait(client, walk_in.json()["job_id"])["stage"] == "saved"

    visit_id = _visit(client, RAVI)["visit_id"]
    orch(client).svc.rag.list_visits = boom
    r = submit(client, RAVI, visit_id=visit_id)
    assert r.status_code == 202 and r.json()["visit_id"] == visit_id
    assert wait(client, r.json()["job_id"])["stage"] == "saved"
    queue = client.get("/api/v1/visits/today")
    assert queue.status_code == 503 and queue.json()["error"]["code"] == "HISTORY_UNAVAILABLE"


def test_patient_search(client):
    found = client.get("/api/v1/patients", params={"q": "LAK"}).json()
    assert [p["display_name"] for p in found] == ["Lakshmi S."]
    assert client.get("/api/v1/patients", params={"q": "zzz"}).json() == []


def test_api_key_protects_api_but_not_health(make_client):
    c = make_client(api_key="s3cret")
    denied = c.get("/api/v1/patients")
    assert denied.status_code == 401
    assert denied.json() == {"error": {"code": "UNAUTHORIZED", "message": "Missing or invalid X-API-Key header.",
                                       "stage": None}}
    assert c.get("/api/v1/patients", headers={"X-API-Key": "wrong"}).status_code == 401
    assert c.get("/api/v1/patients", headers={"X-API-Key": "s3cret"}).status_code == 200
    assert c.get("/health").status_code == 200
    assert c.get("/ready").status_code == 200


def test_rejects_non_audio_with_415(client):
    r = submit(client, audio=("notes.txt", b"hello", "text/plain"))
    assert r.status_code == 415
    assert r.json() == {"error": {"code": "UNSUPPORTED_MEDIA_TYPE",
                                  "message": "Expected an audio file (m4a, webm, mp3, wav, ogg, flac); "
                                             "got 'text/plain'.",
                                  "stage": None}}


def test_accepts_what_flutter_sends(client):
    data = AUDIO[1]
    # Dart's MultipartFile.fromPath default: octet-stream, recognised by the .m4a extension
    mobile = submit(client, audio=("recording.m4a", data, "application/octet-stream"))
    assert mobile.status_code == 202, mobile.text
    # Flutter Web records WebM/Opus and sends the codecs parameter
    web = submit(client, audio=("recording.webm", data, "audio/webm;codecs=opus"))
    assert web.status_code == 202, web.text
    for r in (mobile, web):
        assert wait(client, r.json()["job_id"])["stage"] == "saved"


def test_empty_and_oversized_audio(make_client):
    c = make_client(max_upload_mb=1)
    empty = submit(c, audio=("visit.m4a", b"", "audio/mp4"))
    assert empty.status_code == 400 and empty.json()["error"]["code"] == "EMPTY_AUDIO"
    big = submit(c, audio=("visit.m4a", b"\x00" * (1024 * 1024 + 1), "audio/mp4"))
    assert big.status_code == 413 and big.json()["error"]["code"] == "AUDIO_TOO_LARGE"
    assert orch(c).jobs.jobs == {}                      # no job was created


def test_validation_errors_do_not_echo_input(client):
    no_file = client.post("/api/v1/consultations", data={"patient_uuid": RAVI})
    assert no_file.status_code == 422
    body = no_file.json()["error"]
    assert body["code"] == "VALIDATION_ERROR" and body["stage"] is None
    assert any("audio_file" in d["loc"] for d in body["details"])

    bad_uuid = client.post("/api/v1/consultations", files={"audio_file": AUDIO},
                           data={"patient_uuid": "Ravi-Kumar-9845012345"})
    assert bad_uuid.status_code == 422
    assert any("patient_uuid" in d["loc"] for d in bad_uuid.json()["error"]["details"])
    assert "9845012345" not in bad_uuid.text and "Ravi" not in bad_uuid.text


def test_unknown_patient_404(client):
    r = submit(client, patient=str(uuid.uuid4()))
    assert r.status_code == 404 and r.json()["error"]["code"] == "PATIENT_NOT_FOUND"


def test_busy_returns_429_and_queue_position(make_client):
    c = make_client(max_pending_jobs=2)
    gate = threading.Event()
    stt = orch(c).svc.stt
    original = stt.transcribe
    stt.transcribe = lambda *a, **k: (gate.wait(5), original(*a, **k))[1]   # hold job 1 on the "GPU"
    first = submit(c).json()
    second = submit(c).json()
    assert first["queue_position"] == 0 and second["queue_position"] == 1
    third = submit(c)
    assert third.status_code == 429 and third.json()["error"]["code"] == "BUSY"
    assert c.get("/health").status_code == 200        # event loop is not blocked by the running job
    gate.set()


def test_ask_refuses_opinions_and_answers_facts(client):
    fact = client.post(f"/api/v1/patients/{LAKSHMI}/ask", json={"question": "When was warfarin started?"})
    assert fact.status_code == 200
    answer = fact.json()
    assert answer["refused"] is False and "warfarin" in answer["answer"].lower() and answer["citations"]

    orch(client).svc.llm.answer_question = boom         # an opinion question must never reach the LLM
    for question in ("What do you think is wrong with this patient?", "Should I prescribe amoxicillin?",
                     "What is the best treatment for her knee?"):
        r = client.post(f"/api/v1/patients/{LAKSHMI}/ask", json={"question": question})
        assert r.status_code == 200
        assert r.json() == {"answer": REFUSAL, "refused": True, "citations": []}


def test_predictions_endpoint(client):
    # No consultation needed: the report is generated on demand from the stored history.
    first = client.get(f"/api/v1/patients/{ARJUN}/predictions")
    assert first.status_code == 200
    report = first.json()
    assert report["patient_uuid"] == ARJUN and report["records_analysed"] > 0
    assert "not a diagnosis" in report["disclaimer"]
    trend = next(p for p in report["predictions"] if p["outcome"].startswith("HbA1c"))
    assert trend["origin"] == "rule_engine" and trend["evidence"]

    cached = client.get(f"/api/v1/patients/{ARJUN}/predictions").json()
    assert cached["generated_at"] == report["generated_at"]
    fresh = client.get(f"/api/v1/patients/{ARJUN}/predictions", params={"refresh": True}).json()
    assert fresh["generated_at"] != report["generated_at"]

    missing = client.get(f"/api/v1/patients/{uuid.uuid4()}/predictions")
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "PATIENT_NOT_FOUND"


def test_similar_search_and_cascading_delete(client):
    found = client.post("/api/v1/search/similar", json={"query": "knee pain"}).json()
    assert found and found[0]["display_name"] == "Lakshmi S."

    deleted = client.delete(f"/api/v1/patients/{LAKSHMI}")
    assert deleted.status_code == 200
    assert deleted.json()["patient_uuid"] == LAKSHMI and deleted.json()["deleted_records"] > 0
    assert client.get(f"/api/v1/patients/{LAKSHMI}").status_code == 404
    assert all(e["patient_uuid"] != LAKSHMI for e in client.get("/api/v1/visits/today").json())
    again = client.post("/api/v1/search/similar", json={"query": "knee pain"}).json()
    assert all(c["patient_uuid"] != LAKSHMI for c in again)
