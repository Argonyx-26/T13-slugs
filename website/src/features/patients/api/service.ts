'use server';

// ============================================================
// Patients Service — Data Access Layer
// ============================================================
// The ONLY file that decides where patient data comes from.
//
//   LUMEN_API_URL unset → bundled synthetic patients plus what the desk and doctor
//                         added (server/demo-clinic.ts, saved to .data/clinic.json)
//   LUMEN_API_URL set   → the orchestrator (FastAPI), via server/lumen-api.ts
//
// 'use server' keeps both paths on the server, so the orchestrator URL and API
// key never reach the browser even when React Query refetches on the client.
// Every write validates its input here: a server action is a public endpoint.
// ============================================================

import type { z } from 'zod';
import {
  addClinicRecordSchema,
  checkInSchema,
  registerPatientSchema,
  retractClinicRecordSchema
} from '../schemas/clinic';
import { demoClinic } from '../server/demo-clinic';
import { LumenApiError, isLumenApiConfigured, lumenApi } from '../server/lumen-api';
import { listUploads } from '../server/uploads';
import type {
  CheckInResult,
  PatientByIdResponse,
  PatientRecord,
  PatientsResponse,
  RegisterPatientResult,
  WriteResult
} from './types';

export async function getPatients(): Promise<PatientsResponse> {
  if (isLumenApiConfigured()) {
    return { patients: await lumenApi.listPatients(), source: 'fastapi' };
  }
  return { patients: await demoClinic.getPatients(), source: 'demo' };
}

/** Images uploaded from the dashboard come first: they are the newest files */
async function withUploads(patient: PatientRecord | null): Promise<PatientRecord | null> {
  if (!patient) return null;
  const uploads = await listUploads(patient.id);
  return uploads.length ? { ...patient, documents: [...uploads, ...patient.documents] } : patient;
}

export async function getPatientById(id: string): Promise<PatientByIdResponse> {
  if (isLumenApiConfigured()) {
    return { patient: await withUploads(await lumenApi.getPatient(id)), source: 'fastapi' };
  }
  return { patient: await withUploads(await demoClinic.getPatientById(id)), source: 'demo' };
}

// ---------- Clinic tier writes ----------

/** Validates, runs, and turns expected failures into a message the form can show */
async function write<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  run: (data: z.output<S>) => Promise<WriteResult<T>>
): Promise<WriteResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  try {
    return await run(parsed.data);
  } catch (e) {
    if (e instanceof LumenApiError) {
      return {
        ok: false,
        error:
          e.status === 404 || e.status === 405
            ? 'The clinic server does not support this yet. It needs the endpoints in docs/clinic-api.md.'
            : e.message
      };
    }
    throw e;
  }
}

const ok = <T>(data: T): WriteResult<T> => ({ ok: true, data });

/** Reception: a new patient, what they report at the desk, and optionally today's queue */
export async function registerPatient(input: unknown): Promise<WriteResult<RegisterPatientResult>> {
  return write(registerPatientSchema, input, async (data) =>
    ok(
      isLumenApiConfigured()
        ? await lumenApi.registerPatient(data)
        : await demoClinic.registerPatient(data)
    )
  );
}

/** Reception: join today's queue, with vital signs and the complaint; triage runs straight away */
export async function checkInPatient(input: unknown): Promise<WriteResult<CheckInResult>> {
  return write(checkInSchema, input, async (data) =>
    isLumenApiConfigured() ? ok(await lumenApi.checkIn(data)) : demoClinic.checkIn(data)
  );
}

/** Adds an allergy, diagnosis, prescription, lab result or visit. Records are never edited. */
export async function addClinicRecord(input: unknown): Promise<WriteResult<{ record_id: string }>> {
  return write(addClinicRecordSchema, input, async (data) => {
    if (data.recorded_on > new Date().toISOString().slice(0, 10)) {
      return { ok: false, error: 'The date can’t be in the future.' };
    }
    return isLumenApiConfigured() ? ok(await lumenApi.addRecord(data)) : demoClinic.addRecord(data);
  });
}

/** The only correction: 'entered in error', or 'stopped' for a prescription. The record stays for the audit trail. */
export async function retractClinicRecord(input: unknown): Promise<WriteResult> {
  return write(retractClinicRecordSchema, input, async (data) => {
    if (isLumenApiConfigured()) {
      await lumenApi.retractRecord(data);
      return ok(null);
    }
    return demoClinic.retractRecord(data);
  });
}
