// ============================================================
// Patients — Type Contract
// ============================================================
// The first block mirrors the orchestrator's own models (backend/app/contracts.py
// on the ShreyasFastAPI branch), so switching from the demo data to the real
// backend never changes a component. The second block is what the dashboard renders.
// ============================================================

import type { UIMessage } from 'ai';

// ---------- Orchestrator contract ----------

/** clinic_db: the clinic's records · doctor_notes: written or confirmed by the doctor ·
 *  ai_scribe: saved from a consultation, not yet reviewed by the doctor */
export type Source = 'clinic_db' | 'doctor_notes' | 'ai_scribe';

export type EvidenceSource = Source | 'transcript' | 'rule_table' | 'web';

export type Likelihood = 'high' | 'moderate' | 'low';

export type Sex = 'M' | 'F' | 'O';

export interface Fact {
  value: string;
  source: Source;
  recorded_on: string | null;
  note?: string | null;
  /** The clinic_records row behind this fact, when known: lets the clinic correct it */
  record_id?: string | null;
}

export interface LabResult {
  name: string;
  value: string;
  taken_on: string;
  source: Source;
  record_id?: string | null;
}

export interface Evidence {
  source: EvidenceSource;
  snippet: string;
  recorded_on?: string | null;
  url?: string | null;
}

/** A possible future development and why, from the stored records. Never advice. */
export interface Prediction {
  outcome: string;
  likelihood: Likelihood;
  timeframe?: string | null;
  reasoning: string;
  evidence: Evidence[];
  origin: 'llm' | 'rule_engine';
}

export interface PatientProfile {
  allergies: Fact[];
  active_medications: Fact[];
  conditions: Fact[];
  labs: LabResult[];
}

export interface HistoryEntry {
  text: string;
  source: Source;
  recorded_on: string | null;
}

export type DocumentKind = 'xray' | 'lab_report' | 'ecg' | 'prescription' | 'scan' | 'photo';

/** A file on the patient's record: a scan, report or photo */
export interface PatientDocument {
  id: string;
  title: string;
  kind: DocumentKind;
  /** Image URL */
  src: string;
  recorded_on: string | null;
  source: Source;
  /** One line on what the file shows */
  description: string;
  /** Added through the dashboard's upload button */
  uploaded?: boolean;
}

/** POST /patients/{id}/ask. Opinion and diagnosis questions come back refused. */
export interface QAAnswer {
  answer: string;
  refused: boolean;
  citations: Evidence[];
}

// ---------- Triage: early health-risk detection (backend/rag/risk.py) ----------
// Mirrors rag/models.py (Vitals, NEWS2, RiskFinding, RiskAssessment). Triage is how urgent
// the patient is *now*, from vital signs, symptoms and the record; it is separate from
// Prediction, which is what may happen later.

export type TriageLevel = 'low' | 'medium' | 'high' | 'critical';

export interface Vitals {
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  resp_rate: number | null;
  temperature_c: number | null;
  spo2: number | null;
  on_oxygen: boolean;
  consciousness: 'alert' | 'new_confusion' | 'voice' | 'pain' | 'unresponsive' | null;
  blood_glucose: number | null;
  weight_kg: number | null;
}

/** National Early Warning Score 2. `missing`: parameters not measured, so the score may be too low. */
export interface News2 {
  score: number;
  band: 'low' | 'low-medium' | 'medium' | 'high';
  points: Record<string, number>;
  missing: string[];
}

export interface TriageFinding {
  level: TriageLevel;
  title: string;
  reasons: string[];
  /** How urgently, and what to check. The doctor decides. */
  action: string;
  evidence: number[];
  source: 'news2' | 'vitals' | 'red_flag' | 'trend';
}

export interface TriageAssessment {
  level: TriageLevel;
  urgency: string;
  news2: News2 | null;
  /** Highest level first */
  findings: TriageFinding[];
  /** What wasn't measured or recorded, so "low" is never over-trusted */
  gaps: string[];
  vitals: Vitals | null;
  disclaimer: string;
  patient_id: string | null;
  visit_id: string | null;
  stage: 'triage' | 'consult' | null;
  assessed_at: string | null;
}

// ---------- Dashboard view models ----------

/** `unknown` = nothing on record to assess yet (e.g. registered at the desk today). */
export type RiskLevel = Likelihood | 'unknown';

/** `unknown` = allergy status never recorded, which is not the same as "no allergies". */
export type AllergyState = 'none' | 'present' | 'conflict' | 'unknown';

export interface RiskItem extends Prediction {
  /** Short phrase for cards and badges */
  label: string;
}

export interface PatientCard {
  id: string;
  displayName: string;
  age: number | null;
  sex: Sex | null;
  /** Position in today's queue */
  token: number | null;
  visitStatus: 'waiting' | 'seen' | null;
  reasonForVisit: string | null;
  summary: string;
  conditions: string[];
  allergy: { state: AllergyState; label: string };
  risk: { level: RiskLevel; label: string; count: number };
  /** Triage at check-in; null until the desk takes vital signs */
  triage: {
    level: TriageLevel;
    /** The top finding, or "Vital signs normal" */
    label: string;
    news2: number | null;
    urgency: string;
  } | null;
  lastRecordOn: string | null;
  isNew: boolean;
}

export interface PatientRecord extends PatientCard {
  /** The full triage behind `triage`: vital signs, NEWS2, findings and gaps */
  assessment: TriageAssessment | null;
  /** Paragraphs */
  overview: string[];
  profile: PatientProfile;
  /** Highest likelihood first */
  risks: RiskItem[];
  /** Newest first */
  history: HistoryEntry[];
  /** Scans, reports and photos, newest first */
  documents: PatientDocument[];
  disclaimer: string;
}

/** Where the data came from: bundled synthetic patients, or the orchestrator API */
export type DataSource = 'demo' | 'fastapi';

export interface PatientsResponse {
  patients: PatientCard[];
  source: DataSource;
}

export interface PatientByIdResponse {
  patient: PatientRecord | null;
  source: DataSource;
}

// ---------- Clinic tier writes: reception desk and record corrections ----------
// Mirrors backend/sql (sanjana-rag): clinic_records is append-only; a wrong record is retracted, never edited.

export type ClinicRecordType = 'allergy' | 'diagnosis' | 'prescription' | 'lab' | 'visit';

/** 'stopped' is for prescriptions only */
export type RetractReason = 'entered_in_error' | 'stopped';

export interface RegisterPatientInput {
  full_name: string;
  phone: string | null;
  age: number | null;
  sex: Sex | null;
  allergies: string[];
  no_known_allergies: boolean;
  conditions: string[];
  medications: string[];
  /** Also put them in today's queue */
  check_in: boolean;
  /** The receptionist confirmed a possible duplicate is a different person */
  allow_duplicate: boolean;
}

export interface PossibleDuplicate {
  patient_id: string;
  display_name: string;
  age: number | null;
  sex: Sex | null;
  reason: 'phone' | 'name';
}

export type RegisterPatientResult =
  | { status: 'registered'; patient_id: string; display_code: string; token: number | null }
  | { status: 'possible_duplicate'; matches: PossibleDuplicate[] };

export interface CheckInInput {
  patient_id: string;
  /** Short English phrases from the desk, e.g. "fever", "chest pain since morning" */
  complaint: string[];
  /** null: check in without vital signs (triage waits for them) */
  vitals: Vitals | null;
}

export interface CheckInResult {
  token: number;
  assessment: TriageAssessment | null;
}

export interface AddClinicRecordInput {
  patient_id: string;
  record_type: ClinicRecordType;
  content: string;
  /** YYYY-MM-DD */
  recorded_on: string;
}

export interface RetractClinicRecordInput {
  patient_id: string;
  record_id: string;
  reason: RetractReason;
  note: string | null;
}

/** Writes answer with this instead of throwing, so the form can show the reason */
export type WriteResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

// ---------- Chat ----------

export interface AnswerMeta {
  refused: boolean;
  source: DataSource;
}

export type ChatDataParts = {
  citations: { items: Evidence[] };
};

export type PatientChatMessage = UIMessage<AnswerMeta, ChatDataParts>;
