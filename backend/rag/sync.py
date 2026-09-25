"""Rebuilds the search index from the stored records: the demo stand-in for a nightly sync job.

    cd backend && python -m rag.sync

Run it after changing EMBED_MODEL. Upserts by (tier, source_id, section), so running it twice changes nothing.
"""
from . import chunks as ch
from .db import service as sb
from .store import index


def reindex(patient_ids: list[str] | None = None) -> int:
    records = sb.table("clinic_records").select("*")
    notes = sb.table("doctor_notes").select("*").eq("status", "approved")
    if patient_ids is not None:
        records, notes = records.in_("patient_id", patient_ids), notes.in_("patient_id", patient_ids)
    todo = [c for r in records.execute().data for c in ch.from_clinic_record(r)]
    todo += [c for n in notes.execute().data for c in ch.from_doctor_note(n)]
    index(todo)
    return len(todo)


if __name__ == "__main__":
    print(f"indexed {reindex()} chunks")
