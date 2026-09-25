"""The reception desk: where a patient first enters the database, for clinics with no records system of their own.

The receptionist registers a walk-in (or finds a returning one) and checks them into the day's queue; the doctor's
phone picks the patient from that queue. What the patient reports at the desk (allergies, long-term conditions,
current medicines) is saved as clinic records, so the doctor's safety checks work from the very first consult.

Names and phone numbers live only in patient_identity: never embedded, never in memory_chunks, never sent to the LLM.
"""
from datetime import date

from . import chunks as ch
from .db import service as sb
from .store import index

AT_DESK = "reported by patient at registration"


def intake_records(allergies: list[str] = (), no_known_allergies: bool = False,
                   conditions: list[str] = (), medications: list[str] = ()) -> list[dict]:
    """The desk form -> clinic records. Leaving allergies empty without ticking "No known allergies" saves nothing,
    so the allergy status stays unknown rather than looking like "none"."""
    allergies, conditions, medications = ([s.strip() for s in xs if s.strip()]
                                          for xs in (allergies, conditions, medications))
    if allergies and no_known_allergies:
        raise ValueError("Allergies were listed but 'No known allergies' is also ticked")
    out = [("allergy", f"Allergy to {a} ({AT_DESK}).") for a in allergies]
    if no_known_allergies:
        out.append(("allergy", f"No known drug allergies ({AT_DESK})."))
    out += [("diagnosis", f"{c}, long-term condition ({AT_DESK}).") for c in conditions]
    out += [("prescription", f"Currently taking {m} ({AT_DESK}).") for m in medications]
    return [{"record_type": t, "content": c} for t, c in out]


def register_patient(full_name: str, phone: str | None, age: int | None, sex: str | None,
                     allergies: list[str] = (), no_known_allergies: bool = False,
                     conditions: list[str] = (), medications: list[str] = (),
                     visit_day: date | None = None) -> dict:
    """A new patient: next P-number, identity, desk-reported records, and a check-in when visit_day is given
    (the clinic's local date). Returns {patient, records, visit}."""
    if not full_name.strip():
        raise ValueError("A name is required")
    out = sb.rpc("register_patient", {
        "p_full_name": full_name, "p_phone": phone, "p_age": age, "p_sex": sex,
        "p_intake": intake_records(allergies, no_known_allergies, conditions, medications),
        "p_visit_day": visit_day.isoformat() if visit_day else None,
    }).execute().data
    # Saved in one transaction above; if indexing fails, `python -m rag.sync` picks the records up later
    index([c for r in out["records"] for c in ch.from_clinic_record(r)])
    return out


def search_patients(q: str, k: int = 10) -> list[dict]:
    """The desk's search box: any 4+ digits of a phone number, part of a name, or a P-number."""
    return sb.rpc("search_patients", {"q": q, "match_count": k}).execute().data


def check_in(patient_id: str, visit_day: date) -> dict:
    """A returning patient joins the day's queue. Already waiting that day -> the same token back."""
    return sb.rpc("check_in", {"p_patient_id": patient_id, "p_visit_day": visit_day.isoformat()}).execute().data


def visit_queue(visit_day: date) -> list[dict]:
    """The day's queue in token order (seeded demo patients have no identity row, so full_name is None)."""
    return sb.rpc("visit_queue", {"p_visit_day": visit_day.isoformat()}).execute().data


def mark_visit_seen(visit_id: str) -> bool:
    """False for an unknown visit id."""
    return bool(sb.table("visits").update({"status": "seen"}).eq("id", visit_id).execute().data)


def get_identity(patient_id: str) -> dict | None:
    """For the privacy scrubber: the patient's own name is always redacted from the transcript."""
    rows = sb.table("patient_identity").select("full_name, phone").eq("patient_id", patient_id).execute().data
    return rows[0] if rows else None
