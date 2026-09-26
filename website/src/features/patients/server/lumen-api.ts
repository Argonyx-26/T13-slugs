import 'server-only';

// ============================================================
// Client for the orchestrator (FastAPI, ShreyasFastAPI branch), server side only.
// ============================================================
// Enabled by LUMEN_API_URL. The API key never reaches the browser: pages and the
// chat route call this from the server. Every field it reads is typed in
// backend/app/contracts.py.
// ============================================================

import type {
  AddClinicRecordInput,
  CheckInInput,
  CheckInResult,
  Fact,
  HistoryEntry,
  LabResult,
  PatientCard,
  PatientProfile,
  PatientRecord,
  Prediction,
  PossibleDuplicate,
  QAAnswer,
  RegisterPatientInput,
  RegisterPatientResult,
  RetractClinicRecordInput,
  RiskItem,
  Sex,
  Source,
  TriageAssessment,
  TriageLevel
} from '../api/types';
import {
  DISCLAIMER,
  allergyStatus,
  compareQueue,
  formatDate,
  labelFromOutcome,
  riskSummary,
  sortRisks,
  triageSummary
} from '../utils/record';

const BASE_URL = process.env.LUMEN_API_URL?.replace(/\/+$/, '');
const API_KEY = process.env.LUMEN_API_KEY;

export function isLumenApiConfigured(): boolean {
  return Boolean(BASE_URL);
}

export class LumenApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The error body's extra fields, e.g. `matches` on a 409 POSSIBLE_DUPLICATE */
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

// ---------- Wire types (the subset of contracts.py this app reads) ----------

interface ApiPatientSummary {
  patient_uuid: string;
  display_name: string;
  age: number | null;
  sex: Sex | null;
}

interface ApiQueueEntry extends ApiPatientSummary {
  visit_id: string;
  token: number;
  status: 'waiting' | 'seen';
  // Triage at check-in, from the RAG module's triage_queue() (backend/sql/06_risk.sql).
  // Optional: absent until the orchestrator passes them through; then the card shows no triage.
  risk_level?: TriageLevel | null;
  news2?: number | null;
  top_finding?: string | null;
  urgency?: string | null;
}

interface ApiProfile extends PatientProfile {
  patient_uuid: string;
}

interface ApiSavedNote {
  note_id: string;
  visit_at: string;
  source: Source;
  note: { chief_complaint: string | null; summary: string };
}

interface ApiPredictionReport {
  predictions: Prediction[];
  disclaimer: string;
}

// ---------- Transport ----------

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  if (!BASE_URL) throw new LumenApiError(500, 'NOT_CONFIGURED', 'LUMEN_API_URL is not set.');
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/v1${path}`, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        // The orchestrator is often reached through an ngrok tunnel from Kaggle
        'ngrok-skip-browser-warning': '1',
        ...(API_KEY ? { 'X-API-Key': API_KEY } : {})
      }
    });
  } catch {
    throw new LumenApiError(503, 'UNREACHABLE', 'The clinic server could not be reached.');
  }
  if (!res.ok) {
    // The orchestrator's single error shape: {"error": {"code", "message", "stage"}}
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string } & Record<string, unknown>;
    } | null;
    throw new LumenApiError(
      res.status,
      body?.error?.code ?? `HTTP_${res.status}`,
      body?.error?.message ?? 'The clinic server returned an error.',
      body?.error ?? {}
    );
  }
  return (await res.json()) as T;
}

/** Predictions can take a model call on first request; a slow one leaves the risk "unknown", not an error. */
async function predictionsOrNull(id: string): Promise<ApiPredictionReport | null> {
  try {
    return await call<ApiPredictionReport>(`/patients/${id}/predictions`, {}, 12_000);
  } catch {
    return null;
  }
}

/** GET /patients/{id}/risk: the latest RiskAssessment (rag/models.py). Missing endpoint or none yet -> null. */
async function assessmentOrNull(id: string): Promise<TriageAssessment | null> {
  try {
    return await call<TriageAssessment | null>(`/patients/${id}/risk`, {}, 8_000);
  } catch {
    return null;
  }
}

function queueTriage(visit: ApiQueueEntry | undefined): PatientCard['triage'] {
  if (!visit?.risk_level) return null;
  return {
    level: visit.risk_level,
    label: visit.top_finding ?? 'Vital signs normal',
    news2: visit.news2 ?? null,
    urgency: visit.urgency ?? ''
  };
}

async function todaysQueue(): Promise<Map<string, ApiQueueEntry>> {
  try {
    const visits = await call<ApiQueueEntry[]>('/visits/today');
    return new Map(visits.map((v) => [v.patient_uuid, v]));
  } catch {
    return new Map();
  }
}

// ---------- Mapping to the dashboard's view models ----------

function toRisks(report: ApiPredictionReport | null): RiskItem[] {
  return sortRisks(
    (report?.predictions ?? []).map((p) => ({ ...p, label: labelFromOutcome(p.outcome) }))
  );
}

function newestDate(profile: ApiProfile, notes: ApiSavedNote[]): string | null {
  const facts: (Fact | LabResult)[] = [
    ...profile.allergies,
    ...profile.active_medications,
    ...profile.conditions,
    ...profile.labs
  ];
  const dates = [
    ...facts.map((f) => ('taken_on' in f ? f.taken_on : f.recorded_on)),
    ...notes.map((n) => n.visit_at.slice(0, 10))
  ].filter((d): d is string => Boolean(d));
  return dates.toSorted().at(-1) ?? null;
}

function composeSummary(profile: ApiProfile, notes: ApiSavedNote[]): string {
  if (notes[0]?.note.summary) return notes[0].note.summary;
  const parts: string[] = [];
  if (profile.conditions.length) parts.push(profile.conditions.map((c) => c.value).join(', '));
  if (profile.active_medications.length)
    parts.push(`${profile.active_medications.length} regular medicine(s) on record`);
  return parts.length ? `${parts.join('. ')}.` : 'No history on record yet.';
}

function toCard(
  summary: ApiPatientSummary,
  profile: ApiProfile,
  notes: ApiSavedNote[],
  report: ApiPredictionReport | null,
  visit: ApiQueueEntry | undefined
): PatientCard {
  const hasRecords =
    notes.length > 0 ||
    profile.allergies.length + profile.active_medications.length + profile.conditions.length > 0;
  return {
    id: summary.patient_uuid,
    displayName: summary.display_name,
    age: summary.age,
    sex: summary.sex,
    token: visit?.token ?? null,
    visitStatus: visit?.status ?? null,
    reasonForVisit: notes[0]?.note.chief_complaint ?? null,
    summary: composeSummary(profile, notes),
    conditions: profile.conditions.map((c) => c.value),
    allergy: allergyStatus(profile.allergies),
    risk: report
      ? riskSummary(toRisks(report), hasRecords)
      : { level: 'unknown', label: 'Not assessed yet', count: 0 },
    triage: queueTriage(visit),
    lastRecordOn: newestDate(profile, notes),
    isNew: !hasRecords
  };
}

function sentenceList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** The orchestrator has no narrative field, so the overview is written from the structured record. */
function composeOverview(card: PatientCard, profile: ApiProfile, notes: ApiSavedNote[]): string[] {
  const who =
    card.age != null
      ? `${card.displayName} is a ${card.age}-year-old ${card.sex === 'F' ? 'woman' : card.sex === 'M' ? 'man' : 'patient'}.`
      : `${card.displayName}.`;
  const conditions = profile.conditions.length
    ? ` Long-term conditions on record: ${sentenceList(profile.conditions.map((c) => `${c.value.toLowerCase()} (since ${formatDate(c.recorded_on)})`))}.`
    : ' No long-term conditions are on record.';
  const meds = profile.active_medications.length
    ? ` Current medicines: ${sentenceList(profile.active_medications.map((m) => m.value))}.`
    : '';
  const paragraphs = [`${who}${conditions}${meds} ${card.allergy.label}.`];

  if (profile.labs.length) {
    const labs = profile.labs.toSorted((a, b) => b.taken_on.localeCompare(a.taken_on)).slice(0, 4);
    paragraphs.push(
      `Most recent results: ${sentenceList(labs.map((l) => `${l.name} ${l.value} (${formatDate(l.taken_on)})`))}.`
    );
  }
  for (const n of notes.slice(0, 2)) {
    const reviewed =
      n.source === 'doctor_notes' ? 'confirmed by the doctor' : 'AI scribe, not yet reviewed';
    paragraphs.push(
      `Consultation on ${formatDate(n.visit_at.slice(0, 10))} (${reviewed}): ${n.note.summary}`
    );
  }
  if (!profile.allergies.length && !notes.length && !profile.conditions.length) {
    paragraphs.push(
      'There are no previous records for this patient yet. The record builds from the first approved consultation note.'
    );
  }
  return paragraphs;
}

function composeHistory(profile: ApiProfile, notes: ApiSavedNote[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    ...notes.map((n) => ({
      text: n.note.chief_complaint
        ? `${n.note.chief_complaint}. ${n.note.summary}`
        : n.note.summary,
      source: n.source,
      recorded_on: n.visit_at.slice(0, 10)
    })),
    ...profile.conditions.map((c) => ({
      text: `Condition recorded: ${c.value}${c.note ? ` (${c.note})` : ''}`,
      source: c.source,
      recorded_on: c.recorded_on
    })),
    ...profile.active_medications.map((m) => ({
      text: `Medicine recorded: ${m.value}${m.note ? ` (${m.note})` : ''}`,
      source: m.source,
      recorded_on: m.recorded_on
    })),
    ...profile.allergies.map((a) => ({
      text: `Allergy record: ${a.value}${a.note ? ` (${a.note})` : ''}`,
      source: a.source,
      recorded_on: a.recorded_on
    })),
    ...profile.labs.map((l) => ({
      text: `Lab: ${l.name} ${l.value}`,
      source: l.source,
      recorded_on: l.taken_on
    }))
  ];
  return entries.toSorted((a, b) => (b.recorded_on ?? '').localeCompare(a.recorded_on ?? ''));
}

// ---------- Public API ----------

export const lumenApi = {
  async listPatients(): Promise<PatientCard[]> {
    const [summaries, queue] = await Promise.all([
      call<ApiPatientSummary[]>('/patients'),
      todaysQueue()
    ]);
    const cards = await Promise.all(
      summaries.map(async (s) => {
        const [profile, notes, report] = await Promise.all([
          call<ApiProfile>(`/patients/${s.patient_uuid}`),
          call<ApiSavedNote[]>(`/patients/${s.patient_uuid}/notes`),
          predictionsOrNull(s.patient_uuid)
        ]);
        return toCard(s, profile, notes, report, queue.get(s.patient_uuid));
      })
    );
    return cards.toSorted(compareQueue);
  },

  async getPatient(id: string): Promise<PatientRecord | null> {
    const summaries = await call<ApiPatientSummary[]>('/patients');
    const summary = summaries.find((s) => s.patient_uuid === id);
    if (!summary) return null;
    const [profile, notes, report, queue, assessment] = await Promise.all([
      call<ApiProfile>(`/patients/${id}`),
      call<ApiSavedNote[]>(`/patients/${id}/notes`),
      predictionsOrNull(id),
      todaysQueue(),
      assessmentOrNull(id)
    ]);
    const card = toCard(summary, profile, notes, report, queue.get(id));
    return {
      ...card,
      // The full assessment, when the orchestrator serves one, is newer than the queue's summary
      triage: assessment ? triageSummary(assessment) : card.triage,
      assessment,
      overview: composeOverview(card, profile, notes),
      profile: {
        allergies: profile.allergies,
        active_medications: profile.active_medications,
        conditions: profile.conditions,
        labs: profile.labs
      },
      risks: toRisks(report),
      history: composeHistory(profile, notes),
      // The orchestrator doesn't serve files yet
      documents: [],
      disclaimer: report?.disclaimer ?? DISCLAIMER
    };
  },

  ask(id: string, question: string): Promise<QAAnswer> {
    return call<QAAnswer>(
      `/patients/${id}/ask`,
      { method: 'POST', body: JSON.stringify({ question }) },
      90_000
    );
  },

  // ---------- Clinic tier writes (docs/clinic-api.md) ----------

  /** POST /patients. 409 POSSIBLE_DUPLICATE carries `matches` for the desk to check. */
  async registerPatient(input: RegisterPatientInput): Promise<RegisterPatientResult> {
    try {
      const out = await call<{ patient_uuid: string; display_code: string; token: number | null }>(
        '/patients',
        { method: 'POST', body: JSON.stringify(input) }
      );
      return { status: 'registered', patient_id: out.patient_uuid, ...out };
    } catch (e) {
      if (e instanceof LumenApiError && e.code === 'POSSIBLE_DUPLICATE') {
        const matches = (e.details.matches ?? []) as (Omit<PossibleDuplicate, 'patient_id'> & {
          patient_uuid: string;
        })[];
        return {
          status: 'possible_duplicate',
          matches: matches.map(({ patient_uuid, ...m }) => ({ patient_id: patient_uuid, ...m }))
        };
      }
      throw e;
    }
  },

  /** POST /visits, then POST /visits/{visit_id}/vitals when the desk took vital signs or a complaint */
  async checkIn(input: CheckInInput): Promise<CheckInResult> {
    const visit = await call<{ visit_id: string; token: number }>('/visits', {
      method: 'POST',
      body: JSON.stringify({ patient_uuid: input.patient_id })
    });
    if (!input.vitals && !input.complaint.length) return { token: visit.token, assessment: null };
    const assessment = await call<TriageAssessment>(`/visits/${visit.visit_id}/vitals`, {
      method: 'POST',
      body: JSON.stringify({ vitals: input.vitals, complaint: input.complaint })
    });
    return { token: visit.token, assessment };
  },

  /** POST /patients/{id}/records: append-only */
  addRecord(input: AddClinicRecordInput): Promise<{ record_id: string }> {
    const { patient_id, ...body } = input;
    return call(`/patients/${patient_id}/records`, { method: 'POST', body: JSON.stringify(body) });
  },

  /** POST /records/{record_id}/retract */
  async retractRecord(input: RetractClinicRecordInput): Promise<void> {
    await call(`/records/${input.record_id}/retract`, {
      method: 'POST',
      body: JSON.stringify({ reason: input.reason, note: input.note })
    });
  }
};
