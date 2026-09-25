'use server';

// ============================================================
// Patients Service — Data Access Layer
// ============================================================
// The ONLY file that decides where patient data comes from.
//
//   LUMEN_API_URL unset → bundled synthetic patients (src/constants/mock-api-patients.ts)
//   LUMEN_API_URL set   → the orchestrator (FastAPI), via server/lumen-api.ts
//
// 'use server' keeps both paths on the server, so the orchestrator URL and API
// key never reach the browser even when React Query refetches on the client.
// ============================================================

import { fakePatients } from '@/constants/mock-api-patients';
import { isLumenApiConfigured, lumenApi } from '../server/lumen-api';
import type { PatientByIdResponse, PatientsResponse } from './types';

export async function getPatients(): Promise<PatientsResponse> {
  if (isLumenApiConfigured()) {
    return { patients: await lumenApi.listPatients(), source: 'fastapi' };
  }
  return { patients: await fakePatients.getPatients(), source: 'demo' };
}

export async function getPatientById(id: string): Promise<PatientByIdResponse> {
  if (isLumenApiConfigured()) {
    return { patient: await lumenApi.getPatient(id), source: 'fastapi' };
  }
  return { patient: await fakePatients.getPatientById(id), source: 'demo' };
}
