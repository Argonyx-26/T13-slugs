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
}

export interface LabResult {
  name: string;
  value: string;
  taken_on: string;
  source: Source;
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

/** POST /patients/{id}/ask. Opinion and diagnosis questions come back refused. */
export interface QAAnswer {
  answer: string;
  refused: boolean;
  citations: Evidence[];
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
  lastRecordOn: string | null;
  isNew: boolean;
}

export interface PatientRecord extends PatientCard {
  /** Paragraphs */
  overview: string[];
  profile: PatientProfile;
  /** Highest likelihood first */
  risks: RiskItem[];
  /** Newest first */
  history: HistoryEntry[];
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

/** Clinic-wide figures for the stats row. Demo values only: the orchestrator has no stats endpoint yet. */
export interface ClinicStats {
  month: string;
  previousMonth: string;
  patientsThisMonth: number;
  patientsLastMonth: number;
  newPatientsThisMonth: number;
  consultationsToday: number;
  seenToday: number;
  notesAwaitingReview: number;
}

// ---------- Chat ----------

export interface AnswerMeta {
  refused: boolean;
  source: DataSource;
}

export type ChatDataParts = {
  citations: { items: Evidence[] };
};

export type PatientChatMessage = UIMessage<AnswerMeta, ChatDataParts>;
