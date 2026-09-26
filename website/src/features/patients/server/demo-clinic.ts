import 'server-only';

import { createHash } from 'node:crypto';
import { format } from 'date-fns';
import { fakePatients } from '@/constants/mock-api-patients';
import type {
  AddClinicRecordInput,
  CheckInInput,
  CheckInResult,
  ClinicRecordType,
  Fact,
  HistoryEntry,
  LabResult,
  PatientCard,
  PatientRecord,
  PossibleDuplicate,
  RegisterPatientInput,
  RegisterPatientResult,
  RetractClinicRecordInput,
  Vitals,
  WriteResult
} from '../api/types';
import {
  DISCLAIMER,
  allergyStatus,
  compareQueue,
  formatDate,
  riskSummary,
  triageSummary
} from '../utils/record';
import { assess, type HistoryItem } from '../utils/risk-engine';
import {
  newId,
  readStore,
  transact,
  type ClinicRecordRow,
  type ClinicStore,
  type PatientRow
} from './clinic-store';

// ============================================================
// Demo mode's clinic: the bundled synthetic patients plus everything the
// desk and doctor added (clinic-store.ts), merged into the dashboard's shapes.
// Follows the backend's rules (backend/rag/reception.py, store.py, risk.py).
// ============================================================

const AT_DESK = 'reported by patient at registration';
const BY = 'dashboard';

/** The clinic's local date */
const today = () => format(new Date(), 'yyyy-MM-dd');

// ---------- Record text <-> facts ----------

/** The desk form -> clinic records, worded exactly as backend/rag/reception.py intake_records() */
function intakeRecords(input: RegisterPatientInput): { type: ClinicRecordType; content: string }[] {
  return [
    ...input.allergies.map((a) => ({
      type: 'allergy' as const,
      content: `Allergy to ${a} (${AT_DESK}).`
    })),
    ...(input.no_known_allergies
      ? [{ type: 'allergy' as const, content: `No known drug allergies (${AT_DESK}).` }]
      : []),
    ...input.conditions.map((c) => ({
      type: 'diagnosis' as const,
      content: `${c}, long-term condition (${AT_DESK}).`
    })),
    ...input.medications.map((m) => ({
      type: 'prescription' as const,
      content: `Currently taking ${m} (${AT_DESK}).`
    }))
  ];
}

/** Desk wording back to a short fact: 'Allergy to penicillin (…).' -> value 'penicillin', note '…' */
function toFactText(
  type: ClinicRecordType,
  content: string
): { value: string; note: string | null } {
  const patterns: Partial<Record<ClinicRecordType, RegExp>> = {
    allergy: /^(?:Allergy to )?(.+?) \((.+)\)\.?$/,
    diagnosis: /^(.+?), long-term condition \((.+)\)\.?$/,
    prescription: /^Currently taking (.+?) \((.+)\)\.?$/
  };
  const m = patterns[type]?.exec(content.trim());
  return m ? { value: m[1], note: m[2] } : { value: content.trim(), note: null };
}

/** 'HbA1c: 8.1 %' -> name 'HbA1c', value '8.1 %' */
function toLab(content: string): { name: string; value: string } {
  const i = content.indexOf(':');
  return i > 0
    ? { name: content.slice(0, i).trim(), value: content.slice(i + 1).trim() }
    : { name: 'Lab result', value: content.trim() };
}

const HISTORY_PREFIX: Record<ClinicRecordType, string> = {
  allergy: 'Allergy',
  diagnosis: 'Diagnosis',
  prescription: 'Prescription',
  lab: 'Lab',
  visit: 'Clinic visit'
};

const REASON_LABEL = { entered_in_error: 'marked entered in error', stopped: 'marked stopped' };

/** The bundled patients' facts have no database rows; a stable id per fact lets the clinic correct them too */
function demoRecordId(patientId: string, kind: string, value: string, date: string | null): string {
  const hash = createHash('sha1').update([patientId, kind, value, date].join('|')).digest('hex');
  return `demo-${hash.slice(0, 24)}`;
}

/** 'anita sharma' -> 'Anita S.': the dashboard's pseudonym style; the full name stays in patient_identity */
function shortName(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  const first = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.length > 1 ? `${first} ${words.at(-1)!.charAt(0).toUpperCase()}.` : first;
}

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const lastDigits = (phone: string | null) => (phone ? phone.replace(/\D/g, '').slice(-10) : null);

// ---------- Reading: bundled patients + the store ----------

const BASE = new Map(fakePatients.records.map((r) => [r.id, r]));

function skeleton(p: PatientRow, fullName: string): PatientRecord {
  return {
    id: p.id,
    displayName: shortName(fullName),
    age: p.age,
    sex: p.sex,
    token: null,
    visitStatus: null,
    reasonForVisit: null,
    summary: '',
    conditions: [],
    allergy: allergyStatus([]),
    risk: riskSummary([], false),
    triage: null,
    lastRecordOn: null,
    isNew: true,
    assessment: null,
    overview: [],
    profile: { allergies: [], active_medications: [], conditions: [], labs: [] },
    risks: [],
    history: [],
    documents: [],
    disclaimer: DISCLAIMER
  };
}

function withIds<T extends Fact | LabResult>(patientId: string, kind: string, items: T[]): T[] {
  return items.map((f) => {
    if (f.record_id) return f;
    const value = 'name' in f ? `${f.name}=${f.value}` : f.value;
    const date = 'taken_on' in f ? f.taken_on : f.recorded_on;
    return { ...f, record_id: demoRecordId(patientId, kind, value, date) };
  });
}

const joinValues = (facts: Fact[]) => facts.map((f) => f.value).join(', ');

function newPatientOverview(r: PatientRecord, registeredOn: string): string[] {
  const who = r.sex === 'F' ? 'woman' : r.sex === 'M' ? 'man' : 'patient';
  const intro =
    r.age != null
      ? `${r.displayName} is a ${r.age}-year-old ${who}, registered at the reception desk on ${formatDate(registeredOn)}.`
      : `${r.displayName} was registered at the reception desk on ${formatDate(registeredOn)}.`;
  const reported = [
    r.allergy.state === 'unknown' ? 'allergy status not recorded' : `allergies: ${r.allergy.label}`,
    r.profile.conditions.length
      ? `long-term conditions: ${joinValues(r.profile.conditions)}`
      : 'no long-term conditions',
    r.profile.active_medications.length
      ? `current medicines: ${joinValues(r.profile.active_medications)}`
      : 'no regular medicines'
  ];
  return [
    intro,
    `On record now: ${reported.join('; ')}.`,
    'There are no consultation notes yet. The record builds from the first visit once the doctor approves the note.'
  ];
}

function buildRecord(id: string, store: ClinicStore, day: string): PatientRecord | null {
  const row = store.patients.find((p) => p.id === id);
  const identity = store.patient_identity.find((i) => i.patient_id === id);
  const base = BASE.get(id) ?? (row && identity ? skeleton(row, identity.full_name) : null);
  if (!base) return null;

  const retracted = new Map(store.clinic_record_retractions.map((x) => [x.record_id, x]));
  const live = <T extends { record_id?: string | null }>(xs: T[]) =>
    xs.filter((x) => !x.record_id || !retracted.has(x.record_id));

  const profile = {
    allergies: withIds(id, 'allergy', base.profile.allergies),
    active_medications: withIds(id, 'prescription', base.profile.active_medications),
    conditions: withIds(id, 'diagnosis', base.profile.conditions),
    labs: withIds(id, 'lab', base.profile.labs)
  };
  // What each base fact said, so a correction can quote it
  const baseText = new Map<string, string>([
    ...[...profile.allergies, ...profile.active_medications, ...profile.conditions].map(
      (f) => [f.record_id!, f.value] as [string, string]
    ),
    ...profile.labs.map((l) => [l.record_id!, `${l.name} ${l.value}`] as [string, string])
  ]);

  const history: HistoryEntry[] = [...base.history];
  const added = store.clinic_records.filter((r) => r.patient_id === id);
  for (const r of added) {
    const recordedOn = r.recorded_at.slice(0, 10);
    history.push({
      text: `${HISTORY_PREFIX[r.record_type]}: ${r.content}`,
      source: 'clinic_db',
      recorded_on: recordedOn
    });
    if (r.record_type === 'lab') {
      profile.labs.push({
        ...toLab(r.content),
        taken_on: recordedOn,
        source: 'clinic_db',
        record_id: r.id
      });
    } else if (r.record_type !== 'visit') {
      const fact: Fact = {
        ...toFactText(r.record_type, r.content),
        source: 'clinic_db',
        recorded_on: recordedOn,
        record_id: r.id
      };
      const list =
        r.record_type === 'allergy'
          ? profile.allergies
          : r.record_type === 'prescription'
            ? profile.active_medications
            : profile.conditions;
      list.push(fact);
    }
  }

  // Corrections stay visible in the history: the record is out of the safety facts, not erased
  const addedById = new Map(added.map((r) => [r.id, r]));
  for (const x of store.clinic_record_retractions) {
    const text = addedById.get(x.record_id)?.content ?? baseText.get(x.record_id);
    if (!text) continue;
    history.push({
      text: `Correction: “${text}” ${REASON_LABEL[x.reason]}${x.note ? `. ${x.note}` : ''}.`,
      source: 'clinic_db',
      recorded_on: x.retracted_at.slice(0, 10)
    });
  }
  history.sort((a, b) => (b.recorded_on ?? '').localeCompare(a.recorded_on ?? ''));

  const record: PatientRecord = {
    ...base,
    profile: {
      allergies: live(profile.allergies),
      active_medications: live(profile.active_medications),
      conditions: live(profile.conditions),
      labs: live(profile.labs)
    },
    history
  };
  record.conditions = record.profile.conditions.map((c) => c.value);
  record.allergy = allergyStatus(record.profile.allergies);
  record.lastRecordOn =
    [...history.map((h) => h.recorded_on), ...record.profile.labs.map((l) => l.taken_on)]
      .filter((d): d is string => Boolean(d))
      .toSorted()
      .at(-1) ?? null;

  if (!BASE.has(id) && row) {
    record.isNew = row.created_at.slice(0, 10) === day || history.length === 0;
    record.overview = newPatientOverview(record, row.created_at);
    record.summary = record.conditions.length
      ? `Registered ${formatDate(row.created_at)}. ${record.conditions.join(', ')}.`
      : `Registered ${formatDate(row.created_at)}. No long-term conditions reported.`;
  }

  // Today's queue and triage
  const visit = store.visits.filter((v) => v.patient_id === id && v.visit_day === day).at(-1);
  if (visit) {
    record.token = visit.token;
    record.visitStatus = visit.status;
  }
  const latest = store.risk_assessments.filter((a) => a.patient_id === id).at(-1);
  if (latest && (!visit || latest.visit_id === visit.id)) {
    record.assessment = latest.assessment;
    record.triage = triageSummary(latest.assessment);
    if (latest.complaint.length) {
      const c = latest.complaint.join(', ');
      record.reasonForVisit = c.charAt(0).toUpperCase() + c.slice(1);
    }
  }
  return record;
}

function toCard(record: PatientRecord): PatientCard {
  const {
    assessment: _assessment,
    overview: _overview,
    profile: _profile,
    risks: _risks,
    history: _history,
    documents: _documents,
    disclaimer: _disclaimer,
    ...card
  } = record;
  return card;
}

function allIds(store: ClinicStore): string[] {
  return [...BASE.keys(), ...store.patients.map((p) => p.id)];
}

// ---------- Writing ----------

function possibleDuplicates(
  store: ClinicStore,
  fullName: string,
  phone: string | null
): PossibleDuplicate[] {
  const name = normalise(fullName);
  const short = normalise(shortName(fullName));
  const digits = lastDigits(phone);
  const out: PossibleDuplicate[] = [];
  for (const i of store.patient_identity) {
    const p = store.patients.find((x) => x.id === i.patient_id);
    if (!p) continue;
    const reason =
      digits && lastDigits(i.phone) === digits
        ? 'phone'
        : normalise(i.full_name) === name
          ? 'name'
          : null;
    if (reason) {
      out.push({
        patient_id: p.id,
        display_name: shortName(i.full_name),
        age: p.age,
        sex: p.sex,
        reason
      });
    }
  }
  // The bundled patients only have pseudonyms ('Lakshmi S.'), so compare in that form
  for (const b of BASE.values()) {
    if (normalise(b.displayName) === short) {
      out.push({
        patient_id: b.id,
        display_name: b.displayName,
        age: b.age,
        sex: b.sex,
        reason: 'name'
      });
    }
  }
  return out;
}

/** Next free token today, after the bundled queue's tokens */
function nextToken(store: ClinicStore, day: string): number {
  const tokens = [
    ...[...BASE.values()].map((b) => b.token ?? 0),
    ...store.visits.filter((v) => v.visit_day === day).map((v) => v.token)
  ];
  return Math.max(0, ...tokens) + 1;
}

/** backend: check_in(). Already waiting today -> the same token back. */
function checkIn(store: ClinicStore, patientId: string, day: string) {
  const waiting = store.visits.find(
    (v) => v.patient_id === patientId && v.visit_day === day && v.status === 'waiting'
  );
  if (waiting) return waiting;
  // A bundled patient already waiting in the demo queue keeps their token
  const base = BASE.get(patientId);
  const hasVisitToday = store.visits.some((v) => v.patient_id === patientId && v.visit_day === day);
  const token =
    base?.visitStatus === 'waiting' && base.token && !hasVisitToday
      ? base.token
      : nextToken(store, day);
  const visit = {
    id: newId(),
    patient_id: patientId,
    visit_day: day,
    token,
    status: 'waiting' as const,
    checked_in_at: new Date().toISOString()
  };
  store.visits.push(visit);
  return visit;
}

const hasAnyVital = (v: Vitals) =>
  Object.entries(v).some(([k, x]) => (k === 'on_oxygen' ? x === true : x != null));

export const demoClinic = {
  async getPatients(): Promise<PatientCard[]> {
    const store = await readStore();
    const day = today();
    return allIds(store)
      .map((id) => buildRecord(id, store, day))
      .filter((r): r is PatientRecord => r !== null)
      .map(toCard)
      .toSorted(compareQueue);
  },

  async getPatientById(id: string): Promise<PatientRecord | null> {
    return buildRecord(id, await readStore(), today());
  },

  registerPatient(input: RegisterPatientInput): Promise<RegisterPatientResult> {
    return transact((store) => {
      if (!input.allow_duplicate) {
        const matches = possibleDuplicates(store, input.full_name, input.phone);
        if (matches.length) return { status: 'possible_duplicate' as const, matches };
      }
      const now = new Date().toISOString();
      const n = BASE.size + store.patients.length + 1;
      const patient: PatientRow = {
        id: newId(),
        display_code: `P-${String(n).padStart(3, '0')}`,
        age: input.age,
        sex: input.sex,
        created_at: now
      };
      store.patients.push(patient);
      store.patient_identity.push({
        patient_id: patient.id,
        full_name: input.full_name.trim(),
        phone: input.phone ? input.phone.replace(/\D/g, '') || null : null,
        created_at: now
      });
      for (const r of intakeRecords(input)) {
        store.clinic_records.push({
          id: newId(),
          patient_id: patient.id,
          record_type: r.type,
          content: r.content,
          recorded_at: now,
          recorded_by: 'reception'
        });
      }
      const visit = input.check_in ? checkIn(store, patient.id, today()) : null;
      return {
        status: 'registered' as const,
        patient_id: patient.id,
        display_code: patient.display_code,
        token: visit?.token ?? null
      };
    });
  },

  checkIn(input: CheckInInput): Promise<WriteResult<CheckInResult>> {
    return transact((store) => {
      const day = today();
      const record = buildRecord(input.patient_id, store, day);
      if (!record) return { ok: false as const, error: 'Unknown patient.' };
      const visit = checkIn(store, input.patient_id, day);

      const vitals = input.vitals && hasAnyVital(input.vitals) ? input.vitals : null;
      const now = new Date();
      // Earlier readings for trends: the bundled check-in reading, then the desk's
      const readings: [string, Vitals][] = [];
      const baseA = BASE.get(input.patient_id)?.assessment;
      if (baseA?.vitals && baseA.assessed_at) readings.push([baseA.assessed_at, baseA.vitals]);
      for (const v of store.vital_signs.filter((x) => x.patient_id === input.patient_id)) {
        readings.push([v.recorded_at, v]);
      }
      if (vitals) {
        const row = {
          ...vitals,
          id: newId(),
          patient_id: input.patient_id,
          visit_id: visit.id,
          recorded_by: 'reception',
          recorded_at: now.toISOString()
        };
        store.vital_signs.push(row);
        readings.push([row.recorded_at, vitals]);
      }

      if (!vitals && !input.complaint.length) {
        return { ok: true as const, data: { token: visit.token, assessment: null } };
      }
      const history: HistoryItem[] = [
        ...[
          ...record.profile.allergies,
          ...record.profile.conditions,
          ...record.profile.active_medications
        ].map((f) => ({ text: f.value, recorded_at: f.recorded_on ?? '' })),
        ...record.history.map((h) => ({ text: h.text, recorded_at: h.recorded_on ?? '' }))
      ];
      const assessment = {
        ...assess(input.complaint, vitals, history, readings, now),
        patient_id: input.patient_id,
        visit_id: visit.id,
        stage: 'triage' as const,
        assessed_at: now.toISOString()
      };
      store.risk_assessments.push({
        id: newId(),
        patient_id: input.patient_id,
        visit_id: visit.id,
        complaint: input.complaint,
        assessment
      });
      return { ok: true as const, data: { token: visit.token, assessment } };
    });
  },

  addRecord(input: AddClinicRecordInput): Promise<WriteResult<{ record_id: string }>> {
    return transact((store) => {
      if (!buildRecord(input.patient_id, store, today())) {
        return { ok: false as const, error: 'Unknown patient.' };
      }
      const row: ClinicRecordRow = {
        id: newId(),
        patient_id: input.patient_id,
        record_type: input.record_type,
        content: input.content.trim(),
        recorded_at: `${input.recorded_on}T12:00:00.000Z`,
        recorded_by: BY
      };
      store.clinic_records.push(row);
      return { ok: true as const, data: { record_id: row.id } };
    });
  },

  retractRecord(input: RetractClinicRecordInput): Promise<WriteResult> {
    return transact((store) => {
      const record = buildRecord(input.patient_id, store, today());
      if (!record) return { ok: false as const, error: 'Unknown patient.' };
      if (store.clinic_record_retractions.some((x) => x.record_id === input.record_id)) {
        return { ok: false as const, error: 'This record has already been corrected.' };
      }
      const stored = store.clinic_records.find(
        (r) => r.id === input.record_id && r.patient_id === input.patient_id
      );
      const inProfile = (xs: { record_id?: string | null }[]) =>
        xs.some((x) => x.record_id === input.record_id);
      const isPrescription =
        stored?.record_type === 'prescription' || inProfile(record.profile.active_medications);
      const exists =
        stored ||
        inProfile(record.profile.allergies) ||
        inProfile(record.profile.conditions) ||
        inProfile(record.profile.labs) ||
        isPrescription;
      if (!exists) return { ok: false as const, error: 'No such record for this patient.' };
      if (input.reason === 'stopped' && !isPrescription) {
        return { ok: false as const, error: 'Only a prescription can be marked stopped.' };
      }
      store.clinic_record_retractions.push({
        record_id: input.record_id,
        reason: input.reason,
        note: input.note,
        retracted_by: BY,
        retracted_at: new Date().toISOString()
      });
      return { ok: true as const, data: null };
    });
  }
};
