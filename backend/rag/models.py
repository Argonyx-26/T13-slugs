from pydantic import BaseModel


class Fact(BaseModel):
    """A safety fact (allergy, diagnosis, prescription). Always sent to the LLM, never ranked away."""
    chunk_id: int
    kind: str           # allergy | diagnosis | prescription (doctor-note sections are normalised to these)
    tier: str           # clinic | doctor
    text: str
    recorded_at: str    # YYYY-MM-DD


class Conflict(BaseModel):
    """Two records disagree on a safety fact. Never resolved automatically: shown to the doctor."""
    topic: str
    message: str
    chunk_ids: list[int]


class Match(BaseModel):
    """A past record retrieved because it relates to something in today's consult."""
    chunk_id: int
    tier: str           # clinic | doctor
    section: str        # visit, lab, ... or a doctor-note section
    text: str
    recorded_at: str
    days_ago: int
    matched_query: str  # the consult item that pulled this record in (shown to the LLM and the doctor)
    similarity: float
    score: float
    best_gain: float = 0.0  # how far it stood out above the median result for matched_query


class PatientContext(BaseModel):
    patient_id: str
    display_code: str
    age: int | None
    sex: str | None
    safety_facts: list[Fact]
    conflicts: list[Conflict]
    relevant: list[Match]
