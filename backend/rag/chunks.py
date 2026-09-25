"""Turns stored records into search-index rows (memory_chunks).

Each chunk's text is 'YYYY-MM-DD | section | text', so the date and kind of record are part of what gets
embedded and keyword-indexed, and the LLM sees them too.
"""
from .embedder import embed_texts

# The Central Brain's note JSON must use exactly these keys, or approved notes produce no chunks
NOTE_SECTIONS = ("symptoms", "history", "prescriptions", "allergies", "action_items")


def _content(recorded_at: str, section: str, text: str) -> str:
    return f"{recorded_at[:10]} | {section} | {text}"


def from_clinic_record(rec: dict) -> list[dict]:
    """One clinic record -> one chunk."""
    return [{
        "patient_id": rec["patient_id"], "tier": "clinic", "source_id": rec["id"],
        "section": rec["record_type"], "recorded_at": rec["recorded_at"],
        "content": _content(rec["recorded_at"], rec["record_type"], rec["content"]),
    }]


def from_doctor_note(note: dict) -> list[dict]:
    """One approved doctor note -> one chunk per non-empty section."""
    out = []
    for section in NOTE_SECTIONS:
        value = note["note_json"].get(section)
        if not value:
            continue
        text = "; ".join(map(str, value)) if isinstance(value, list) else str(value)
        out.append({
            "patient_id": note["patient_id"], "tier": "doctor", "source_id": note["id"],
            "section": section, "recorded_at": note["created_at"],
            "content": _content(note["created_at"], section, text),
        })
    return out


def with_embeddings(chunks: list[dict]) -> list[dict]:
    for chunk, vector in zip(chunks, embed_texts([c["content"] for c in chunks])):
        chunk["embedding"] = vector
    return chunks
