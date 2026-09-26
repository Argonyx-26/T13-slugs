import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClinicRecordType, RetractReason, Sex, TriageAssessment, Vitals } from '../api/types';

// ============================================================
// Demo clinic store: what the desk and doctor add, kept on the local disk
// ============================================================
// The same tables and rules as the backend's Supabase schema (backend/sql on sanjana-rag),
// so demo mode behaves like the real thing:
//   - clinic_records is append-only: a wrong record gets a retraction row, never an edit
//   - names and phones live only in patient_identity
//   - a patient's token is their position in that day's queue
// Saved to .data/clinic.json (git-ignored). Delete the file to reset the demo.
// ============================================================

export interface PatientRow {
  id: string;
  display_code: string;
  age: number | null;
  sex: Sex | null;
  created_at: string;
}

export interface IdentityRow {
  patient_id: string;
  full_name: string;
  /** Digits only */
  phone: string | null;
  created_at: string;
}

export interface ClinicRecordRow {
  id: string;
  patient_id: string;
  record_type: ClinicRecordType;
  content: string;
  recorded_at: string;
  recorded_by: string;
}

export interface RetractionRow {
  record_id: string;
  reason: RetractReason;
  note: string | null;
  retracted_by: string;
  retracted_at: string;
}

export interface VisitRow {
  id: string;
  patient_id: string;
  /** The clinic's local date */
  visit_day: string;
  token: number;
  status: 'waiting' | 'seen';
  checked_in_at: string;
}

export interface VitalSignsRow extends Vitals {
  id: string;
  patient_id: string;
  visit_id: string | null;
  recorded_by: string;
  recorded_at: string;
}

export interface RiskAssessmentRow {
  id: string;
  patient_id: string;
  visit_id: string | null;
  complaint: string[];
  assessment: TriageAssessment;
}

export interface ClinicStore {
  patients: PatientRow[];
  patient_identity: IdentityRow[];
  clinic_records: ClinicRecordRow[];
  clinic_record_retractions: RetractionRow[];
  visits: VisitRow[];
  vital_signs: VitalSignsRow[];
  risk_assessments: RiskAssessmentRow[];
}

const FILE = path.join(process.cwd(), '.data', 'clinic.json');

const empty = (): ClinicStore => ({
  patients: [],
  patient_identity: [],
  clinic_records: [],
  clinic_record_retractions: [],
  visits: [],
  vital_signs: [],
  risk_assessments: []
});

export async function readStore(): Promise<ClinicStore> {
  try {
    return { ...empty(), ...(JSON.parse(await readFile(FILE, 'utf8')) as Partial<ClinicStore>) };
  } catch {
    return empty();
  }
}

// One change at a time, so two desks can't take the same token or P-number
let queue: Promise<unknown> = Promise.resolve();

/** Read, change and save the store as one step. `change` mutates the store and returns its result. */
export function transact<T>(change: (store: ClinicStore) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const store = await readStore();
    const result = await change(store);
    await mkdir(path.dirname(FILE), { recursive: true });
    // Write then rename, so a crash mid-write never leaves half a file
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2));
    await rename(tmp, FILE);
    return result;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

export const newId = () => randomUUID();
