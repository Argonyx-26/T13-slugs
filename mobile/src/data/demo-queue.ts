// ============================================================
// Demo queue — synthetic personas only, never real patient data.
// ============================================================
// The same people, ids, tokens, statuses and reasons as the website's demo queue
// (website/src/constants/mock-api-patients.ts on final-website-code), so the phone and
// the dashboard tell one story. P-codes follow the RAG pipeline's format
// (register_patient() in backend/sql/04_reception.sql): P-001, P-004 and P-005 are the
// RAG seed personas they match (backend/rag/demo_data.py); the rest continue the sequence
// in registration order, Sunita B. having registered at the desk today.
// ============================================================

import type { QueuePatient } from './types';

type DemoPatient = Omit<QueuePatient, 'visitId' | 'jobStageLabel'>;

const PATIENTS: DemoPatient[] = [
  {
    patientId: '5f8b2a3c-9e1d-4c67-b4a2-0d7e6f3c9b81',
    displayCode: 'P-006',
    name: 'Deepak V.',
    age: 38,
    sex: 'M',
    token: 1,
    status: 'seen',
    reason: 'Repeat prescription'
  },
  {
    patientId: 'a4c7e2f9-3b6d-4e18-8f5a-2b9c0d1e7a52',
    displayCode: 'P-007',
    name: 'Fatima Z.',
    age: 8,
    sex: 'F',
    token: 2,
    status: 'seen',
    reason: 'Fever and left ear pain since yesterday'
  },
  {
    patientId: 'cb2759d8-3d91-4a4d-8bd2-026f68f76426',
    displayCode: 'P-008',
    name: 'Ravi K.',
    age: 54,
    sex: 'M',
    token: 3,
    status: 'waiting',
    reason: 'Sore throat and fever for three days'
  },
  {
    patientId: '91786a1e-1ee8-4f60-8191-8a74c0e3edd1',
    displayCode: 'P-009',
    name: 'Lakshmi S.',
    age: 67,
    sex: 'F',
    token: 4,
    status: 'waiting',
    reason: 'Right knee pain, worse on stairs'
  },
  {
    patientId: '9c7aa0d7-24a7-4a0d-93f0-3695c5d4df45',
    displayCode: 'P-010',
    name: 'Arjun M.',
    age: 45,
    sex: 'M',
    token: 5,
    status: 'waiting',
    reason: 'Diabetes review; more tired than usual'
  },
  {
    patientId: 'b6f1c0e2-4d3a-4f7e-9a51-2c8d7e3f9a14',
    displayCode: 'P-001',
    name: 'Priya N.',
    age: 34,
    sex: 'F',
    token: 6,
    status: 'waiting',
    reason: 'Recurring one-sided headaches with nausea'
  },
  {
    patientId: '4a2e9d71-8c5b-4e03-b7f6-91d2a3c4e5f8',
    displayCode: 'P-004',
    name: 'Meena R.',
    age: 52,
    sex: 'F',
    token: 7,
    status: 'waiting',
    reason: 'Always thirsty; passing urine often at night'
  },
  {
    patientId: 'd81f3b6a-2e7c-4a95-8c14-6b0e9f2d7a33',
    displayCode: 'P-011',
    name: 'Farhan A.',
    age: 61,
    sex: 'M',
    token: 8,
    status: 'waiting',
    reason: 'Lower back pain after lifting'
  },
  {
    patientId: '7c3a5e19-b2d4-4f86-a0e1-3f9b8c6d2e47',
    displayCode: 'P-012',
    name: 'Kavya D.',
    age: 29,
    sex: 'F',
    token: 9,
    status: 'waiting',
    reason: 'Headache for four days; swollen feet (26 weeks pregnant)'
  },
  {
    patientId: '1e9d4c7b-6a3f-4b28-9d05-8e2c1b7a4f66',
    displayCode: 'P-005',
    name: 'Arun P.',
    age: 28,
    sex: 'M',
    token: 10,
    status: 'waiting',
    reason: 'Runny nose and sore throat for two days'
  },
  {
    patientId: '2d6f9a1c-7e4b-4a3d-95c8-6f1e0b2a8d19',
    displayCode: 'P-013',
    name: 'Sunita B.',
    age: 41,
    sex: 'F',
    token: 11,
    status: 'waiting',
    reason: 'Cough for two weeks'
  }
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's demo queue. Visit ids use the orchestrator mock's format: YYYYMMDD-token. */
export function demoQueue(day = new Date()): QueuePatient[] {
  const stamp = `${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}`;
  return PATIENTS.map((p) => ({ ...p, visitId: `${stamp}-${pad(p.token)}`, jobStageLabel: null }));
}
