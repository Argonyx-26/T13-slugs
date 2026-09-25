from typing import Literal

from pydantic import BaseModel, Field, field_validator


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


# ---------- Early health-risk detection (rag/risk.py) ----------
Level = Literal["low", "medium", "high", "critical"]


class Vitals(BaseModel):
    """One set of vital signs, as taken at the desk. Anything not measured stays None, and NEWS2 says so."""
    systolic_bp: int | None = Field(None, ge=40, le=300)        # mmHg
    diastolic_bp: int | None = Field(None, ge=20, le=200)
    heart_rate: int | None = Field(None, ge=20, le=250)         # beats/min
    resp_rate: int | None = Field(None, ge=4, le=70)            # breaths/min
    temperature_c: float | None = Field(None, ge=30, le=45)     # a Fahrenheit reading (e.g. 101.2) is converted
    spo2: int | None = Field(None, ge=50, le=100)               # %
    on_oxygen: bool = False
    consciousness: Literal["alert", "new_confusion", "voice", "pain", "unresponsive"] | None = None   # ACVPU
    blood_glucose: int | None = Field(None, ge=10, le=1000)     # mg/dL, random
    weight_kg: float | None = Field(None, ge=1, le=400)

    @field_validator("temperature_c", mode="before")
    @classmethod
    def _fahrenheit(cls, v):
        """Indian clinics mostly use Fahrenheit: anything above 45 is read as °F."""
        if v is not None and float(v) > 45:
            return round((float(v) - 32) * 5 / 9, 1)
        return v


class NEWS2(BaseModel):
    """National Early Warning Score 2 (Royal College of Physicians, 2017), SpO2 scale 1."""
    score: int
    band: Literal["low", "low-medium", "medium", "high"]
    points: dict[str, int]       # parameter -> points, for the ones measured
    missing: list[str]           # parameters not measured: the score may be too low


class RiskFinding(BaseModel):
    level: Level
    title: str                   # "Possible sepsis"
    reasons: list[str]           # what triggered it, in plain words
    action: str                  # how urgently, and what to check. The doctor decides
    evidence: list[int] = []     # H<chunk_id> of history records it used
    source: Literal["news2", "vitals", "red_flag", "trend"]


class RiskAssessment(BaseModel):
    level: Level                 # the highest finding; "low" when nothing fired
    urgency: str
    news2: NEWS2 | None
    findings: list[RiskFinding]  # highest level first
    gaps: list[str]              # what wasn't measured or recorded, so "low" is never over-trusted
    vitals: Vitals | None
    disclaimer: str
    patient_id: str | None = None
    visit_id: str | None = None
    stage: Literal["triage", "consult"] | None = None
    assessed_at: str | None = None
