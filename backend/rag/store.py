"""Everything FastAPI needs to read and write patient memory."""
import re
from datetime import datetime, timezone

from . import chunks as ch
from .db import as_user, public, service as sb
from .embedder import embed_query

SAFETY_SECTIONS = ["allergy", "allergies", "diagnosis", "prescription", "prescriptions"]


# ---------- Patients ----------
def list_patients() -> list[dict]:
    """The doctor's patient list (hidden patients left out)."""
    hidden = {r["patient_id"] for r in sb.table("doctor_hidden_patients").select("patient_id").execute().data}
    rows = sb.table("patients").select("*").order("display_code").execute().data
    return [r for r in rows if r["id"] not in hidden]


def get_patient(patient_id: str) -> dict:
    return sb.table("patients").select("*").eq("id", patient_id).single().execute().data


def hide_patient(patient_id: str):
    """The doctor's "delete" button: hides the patient from their list. Clinic data is untouched."""
    sb.table("doctor_hidden_patients").upsert({"patient_id": patient_id}).execute()


def unhide_patient(patient_id: str):
    """The "Undo" button."""
    sb.table("doctor_hidden_patients").delete().eq("patient_id", patient_id).execute()


# ---------- Search index ----------
def index(chunks: list[dict], batch: int = 50):
    """Embed and upsert chunks; re-indexing the same record replaces it rather than duplicating."""
    for i in range(0, len(chunks), batch):
        part = ch.with_embeddings(chunks[i:i + batch])
        sb.table("memory_chunks").upsert(part, on_conflict="tier,source_id,section").execute()


# Words that say how/when rather than what; as keywords they match unrelated records
# ("mild fever" -> "Mild gastritis", "at night" -> "cetirizine at night")
GENERIC_WORDS = {"mild", "severe", "acute", "chronic", "recurrent", "frequent", "possible", "check", "night",
                 "day", "days", "week", "weeks", "month", "months", "one", "two", "three", "ten", "since", "for",
                 "with", "and", "the", "treated", "patient", "history", "times", "always"}


def keyword_query(text: str) -> str:
    """'mild fever and sore throat' -> 'fever or sore or throat' (any remaining word may match)."""
    words = [w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in GENERIC_WORDS]
    return " or ".join(words)


def search(patient_id: str, query: str, k: int = 8) -> list[dict]:
    """Hybrid (meaning + keyword) search over one patient's clinic records and approved doctor notes."""
    return sb.rpc("search_patient_memory", {
        "query_text": keyword_query(query),
        "query_embedding": embed_query(query),
        "p_patient_id": patient_id,
        "match_count": k,
    }).execute().data


def safety_chunks(patient_id: str) -> list[dict]:
    """Allergies, diagnoses and prescriptions from both tiers, newest first. Never left to search ranking."""
    return (sb.table("memory_chunks").select("id, tier, source_id, section, content, recorded_at")
            .eq("patient_id", patient_id).in_("section", SAFETY_SECTIONS)
            .order("recorded_at", desc=True).execute().data)


def latest_visit(patient_id: str) -> dict | None:
    rows = (sb.table("memory_chunks").select("id, tier, source_id, section, content, recorded_at")
            .eq("patient_id", patient_id).eq("section", "visit")
            .order("recorded_at", desc=True).limit(1).execute().data)
    return rows[0] if rows else None


def find_similar_patients(description: str, k: int = 5) -> list[dict]:
    """Clinic-wide: 'who else had something like this?'"""
    return sb.rpc("find_similar_patients", {"query_embedding": embed_query(description),
                                            "match_count": k}).execute().data


# ---------- Tier 1: clinic records (append-only) ----------
def add_clinic_records(records: list[dict]) -> list[dict]:
    """Adds records (existing ids are skipped, never overwritten) and indexes them."""
    if records:
        sb.table("clinic_records").upsert(records, on_conflict="id", ignore_duplicates=True).execute()
    ids = [r["id"] for r in records]
    stored = sb.table("clinic_records").select("*").in_("id", ids).execute().data if ids else []
    index([c for r in stored for c in ch.from_clinic_record(r)])
    return stored


# ---------- Tier 2: doctor notes (AI output is a draft until approved) ----------
def save_draft_note(patient_id: str, note_json: dict) -> dict:
    """After the Central Brain + Presidio. Drafts are not searchable."""
    return sb.table("doctor_notes").insert(
        {"patient_id": patient_id, "note_json": note_json, "status": "draft"}).execute().data[0]


def update_draft_note(note_id: str, note_json: dict) -> dict:
    """The doctor edits the draft before approving."""
    return (sb.table("doctor_notes").update({"note_json": note_json})
            .eq("id", note_id).eq("status", "draft").execute().data[0])


def approve_note(note_id: str) -> dict:
    """The doctor clicked Approve: only now does the note become patient memory."""
    note = (sb.table("doctor_notes")
            .update({"status": "approved", "approved_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", note_id).execute().data[0])
    index(ch.from_doctor_note(note))
    return note


def delete_doctor_note(note_id: str):
    sb.table("memory_chunks").delete().eq("tier", "doctor").eq("source_id", note_id).execute()
    sb.table("doctor_notes").delete().eq("id", note_id).execute()


def clear_doctor_memory(patient_id: str) -> int:
    """Wipes the doctor's notes for one patient; the clinic tier stays. Returns how many notes were removed."""
    return sb.rpc("clear_doctor_memory", {"p_patient_id": patient_id}).execute().data


# ---------- Logins ----------
def login(email: str, password: str) -> dict:
    """Returns the access token and role. Flutter sends the token back on each request."""
    res = public().auth.sign_in_with_password({"email": email, "password": password})
    return {"token": res.session.access_token, "role": (res.user.app_metadata or {}).get("role")}


def receptionist_delete_patient(access_token: str, patient_id: str):
    """Runs as the logged-in person, not the backend key: the database refuses anyone but a receptionist."""
    as_user(access_token).rpc("receptionist_delete_patient", {"p_patient_id": patient_id}).execute()
