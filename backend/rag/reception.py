"""The reception desk: where a patient first enters the database, for clinics with no records system of their own.

The receptionist registers a walk-in (or finds a returning one) and checks them into the day's queue; the doctor's
phone picks the patient from that queue. What the patient reports at the desk (allergies, long-term conditions,
current medicines) is saved as clinic records, so the doctor's safety checks work from the very first consult.

Names and phone numbers live only in patient_identity: never embedded, never in memory_chunks, never sent to the LLM.
"""
import logging
from datetime import date

from . import chunks as ch, risk
from .db import service as sb
from .models import RiskAssessment, Vitals
from .store import index

log = logging.getLogger(__name__)
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


class PossibleDuplicate(Exception):
    """The patient may already be registered. FastAPI -> 409 with `matches`, so the desk can check them in instead
    (a second P-number would split their history: an allergy on the first is invisible on the second)."""

    def __init__(self, matches: list[dict]):
        super().__init__(f"{len(matches)} existing patient(s) with the same phone or name")
        self.matches = matches


def find_possible_duplicates(full_name: str, phone: str | None) -> list[dict]:
    """Existing patients with the same phone (last 10 digits) or the same name, each with a `reason`."""
    return sb.rpc("find_possible_duplicates", {"p_full_name": full_name, "p_phone": phone}).execute().data


def register_patient(full_name: str, phone: str | None, age: int | None, sex: str | None,
                     allergies: list[str] = (), no_known_allergies: bool = False,
                     conditions: list[str] = (), medications: list[str] = (),
                     visit_day: date | None = None, allow_duplicate: bool = False) -> dict:
    """A new patient: next P-number, identity, desk-reported records, and a check-in when visit_day is given
    (the clinic's local date). Returns {patient, records, visit}.
    Raises PossibleDuplicate when someone with the same phone or name exists; the receptionist confirms it's a
    different person (families share phones) by calling again with allow_duplicate=True."""
    if not full_name.strip():
        raise ValueError("A name is required")
    if not allow_duplicate and (matches := find_possible_duplicates(full_name, phone)):
        raise PossibleDuplicate(matches)
    out = sb.rpc("register_patient", {
        "p_full_name": full_name, "p_phone": phone, "p_age": age, "p_sex": sex,
        "p_intake": intake_records(allergies, no_known_allergies, conditions, medications),
        "p_visit_day": visit_day.isoformat() if visit_day else None,
    }).execute().data
    # The patient is saved at this point. An indexing failure must not reach the desk as an error, or the receptionist
    # registers them again; store.ensure_indexed() indexes these records before the patient's first consult.
    try:
        index([c for r in out["records"] for c in ch.from_clinic_record(r)])
    except Exception as e:
        log.warning("Indexing %s's desk records failed (%s); they will be indexed at the first consult",
                    out["patient"]["display_code"], e)
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


# ---------- Triage: vital signs at check-in -> risk level -> queue order ----------
def record_vitals(visit_id: str, vitals: Vitals | dict, complaint: list[str] = (), by: str = "reception") -> RiskAssessment:
    """The desk (or nurse) enters vital signs and the patient's main complaint for a checked-in visit. They are
    saved, assessed straight away (rag/risk.py), and the queue re-orders: a critical patient goes to the top.
    complaint: short English phrases, e.g. ["fever", "confusion since morning"]."""
    vitals = Vitals.model_validate(vitals)
    visit = sb.table("visits").select("id, patient_id").eq("id", visit_id).single().execute().data
    row = sb.table("vital_signs").insert({
        "patient_id": visit["patient_id"], "visit_id": visit_id, "recorded_by": by,
        **vitals.model_dump(exclude_none=True)}).execute().data[0]
    return risk.assess_patient(visit["patient_id"], list(complaint), stage="triage", visit_id=visit_id,
                               vitals=vitals, vital_signs_id=row["id"])


def triage_queue(visit_day: date) -> list[dict]:
    """The day's queue, riskiest first (critical, high, medium, then token order); seen patients last.
    Each row has risk_level, news2, top_finding and urgency (all None until vitals are taken)."""
    return sb.rpc("triage_queue", {"p_visit_day": visit_day.isoformat()}).execute().data
