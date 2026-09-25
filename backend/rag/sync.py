"""Rebuilds the search index from the stored records: the demo stand-in for a nightly sync job.

    cd backend && python -m rag.sync

Run it after changing EMBED_MODEL. Upserts by (tier, source_id, section), so running it twice changes nothing.
"""
from . import chunks as ch
from .db import service as sb
from .store import active_clinic_records, index


def reindex(patient_ids: list[str] | None = None) -> int:
    notes = sb.table("doctor_notes").select("*").eq("status", "approved")
    if patient_ids is not None:
        notes = notes.in_("patient_id", patient_ids)
    todo = [c for r in active_clinic_records(patient_ids) for c in ch.from_clinic_record(r)]   # retracted ones stay out
    todo += [c for n in notes.execute().data for c in ch.from_doctor_note(n)]
    index(todo)
    return len(todo)


if __name__ == "__main__":
    print(f"indexed {reindex()} chunks")
