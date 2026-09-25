"""Loads the five demo patients into Supabase and indexes their records. Safe to re-run.

    cd backend && python -m rag.seed

Clinic rows are append-only, so re-running keeps the original rows and dates; it re-indexes everything,
which is also what you want after changing EMBED_MODEL.
"""
import uuid
from datetime import datetime, timedelta, timezone

from .db import service as sb
from .demo_data import PATIENTS, records_for
from .sync import reindex

NS = uuid.uuid5(uuid.NAMESPACE_URL, "lumen-demo-seed")   # fixed ids, so re-runs find the same rows


def _id(*parts: str) -> str:
    return str(uuid.uuid5(NS, "/".join(parts)))


def _at(days_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


def seed() -> dict[str, str]:
    sb.table("patients").upsert(
        [{"id": _id(p["code"]), "display_code": p["code"], "age": p["age"], "sex": p["sex"]} for p in PATIENTS],
        on_conflict="display_code", ignore_duplicates=True).execute()
    ids = {r["display_code"]: r["id"] for r in sb.table("patients").select("id, display_code")
           .in_("display_code", [p["code"] for p in PATIENTS]).execute().data}

    records, notes = [], []
    for p in PATIENTS:
        pid = ids[p["code"]]
        for i, (days, rtype, content) in enumerate(records_for(p)):
            records.append({"id": _id(p["code"], "clinic", str(i)), "patient_id": pid,
                            "record_type": rtype, "content": content, "recorded_at": _at(days)})
        for i, (days, note_json) in enumerate(p["doctor_notes"]):
            notes.append({"id": _id(p["code"], "note", str(i)), "patient_id": pid, "note_json": note_json,
                          "status": "approved", "created_at": _at(days), "approved_at": _at(days)})
    sb.table("clinic_records").upsert(records, on_conflict="id", ignore_duplicates=True).execute()
    if notes:
        sb.table("doctor_notes").upsert(notes, on_conflict="id", ignore_duplicates=True).execute()

    n_chunks = reindex(list(ids.values()))
    print(f"patients: {len(ids)} | clinic records: {len(records)} | doctor notes: {len(notes)} | "
          f"chunks indexed: {n_chunks}")
    return ids


if __name__ == "__main__":
    seed()
