"""End-to-end smoke test against a running orchestrator (laptop or Kaggle via ngrok).

    python scripts/smoke_test.py --base-url https://<your-domain>.ngrok-free.app \
        --audio samples/audio/penicillin.m4a --api-key <key> --approve

Checks /ready, uploads the recording, polls every 2 s until the job finishes, prints
timings, checks, privacy, alerts, research, the record update and the predictions, and
optionally confirms the automatically saved note (--approve).
Exit code 0 means the whole flow worked.
"""
import argparse
import sys
import time
from pathlib import Path

import httpx

MIME_FOR_EXT = {".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac", ".webm": "audio/webm",
                ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg",
                ".opus": "audio/opus", ".flac": "audio/flac"}
FINISHED = {"ready_for_review", "saved", "verified", "discarded", "failed"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--audio", required=True, type=Path)
    ap.add_argument("--patient", help="patient_uuid (default: the first patient)")
    ap.add_argument("--api-key")
    ap.add_argument("--language-hint", default="auto", choices=["auto", "kn", "en"])
    ap.add_argument("--approve", action="store_true", help="confirm the saved note at the end")
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--timeout-min", type=float, default=15.0)
    args = ap.parse_args()

    headers = {"ngrok-skip-browser-warning": "1"}
    if args.api_key:
        headers["X-API-Key"] = args.api_key
    http = httpx.Client(base_url=args.base_url.rstrip("/"), headers=headers, timeout=60.0)

    # 1. readiness
    r = http.get("/ready")
    print(f"/ready -> {r.status_code}: {r.text}")
    if r.status_code != 200:
        return 1

    # 2. patient
    patient = args.patient
    if not patient:
        r = http.get("/api/v1/patients")
        if r.status_code != 200 or not r.json():
            print(f"could not list patients -> {r.status_code}: {r.text}")
            return 1
        first = r.json()[0]
        patient = first["patient_uuid"]
        print(f"patient: {first['display_name']} ({patient})")

    # 3. upload
    mime = MIME_FOR_EXT.get(args.audio.suffix.lower(), "application/octet-stream")
    t0 = time.monotonic()
    with args.audio.open("rb") as f:
        r = http.post("/api/v1/consultations", files={"audio_file": (args.audio.name, f, mime)},
                      data={"patient_uuid": patient, "language_hint": args.language_hint})
    if r.status_code != 202:
        print(f"upload failed -> {r.status_code}: {r.text}")
        return 1
    accepted = r.json()
    print(f"upload accepted: job {accepted['job_id']}, queue position {accepted['queue_position']}")

    # 4. poll
    last_label, deadline = None, t0 + args.timeout_min * 60
    while True:
        r = http.get(accepted["status_url"])
        if r.status_code != 200:
            print(f"poll failed -> {r.status_code}: {r.text}")
            return 1
        job = r.json()
        if job["stage_label"] != last_label:
            last_label = job["stage_label"]
            print(f"  [{time.monotonic() - t0:6.1f}s] {last_label}")
        if job["stage"] in FINISHED:
            break
        if time.monotonic() > deadline:
            print("gave up waiting")
            return 1
        time.sleep(args.interval)

    # 5. report
    print(f"timings_ms: {job['timings_ms']}")
    if job["stage"] == "failed":
        print(f"job failed: {job['error']}")
        return 1
    result = job["result"]
    print(f"checks: {result['checks']}")
    print(f"privacy: {result['privacy']}")
    print(f"alerts ({len(result['alerts'])}):")
    for a in result["alerts"]:
        print(f"  [{a['severity']}] {a['category']} ({a['origin']}): {a['message']}")
    print("research:")
    for item in result["research"]:
        print(f"  {item['drug']}: {len(item['hits'])} hit(s)")
    print(f"note status: {result['status']}")
    update = result.get("record_update")
    if update:
        for change in update["added"]:
            print(f"  added to record: {change['category']}: {change['value']}")
        for change in update["already_on_record"]:
            print(f"  already on record (ignored): {change['category']}: {change['value']}")
    report = result.get("predictions")
    if report:
        print(f"predictions ({len(report['predictions'])}, from {report['records_analysed']} records, "
              f"{report['withheld']} withheld, model {report['model']}):")
        for p in report["predictions"]:
            print(f"  [{p['likelihood']}] ({p['origin']}) {p['outcome']}")
    if job["stage"] != "saved":
        print(f"note was not saved automatically (stage {job['stage']})")
        return 1

    # 6. confirm
    if args.approve:
        r = http.post(f"/api/v1/notes/{result['note_id']}/approve")
        print(f"approve -> {r.status_code}: {r.text}")
        if r.status_code != 200:
            return 1
    print("SMOKE TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
