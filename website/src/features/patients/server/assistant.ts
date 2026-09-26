import 'server-only';

import type { DataSource, QAAnswer } from '../api/types';
import { answerFromRecord } from '../utils/record-assistant';
import { demoClinic } from './demo-clinic';
import { LumenApiError, isLumenApiConfigured, lumenApi } from './lumen-api';

/** One question about one patient. The orchestrator's local LLM when configured, else the record lookup. */
export async function answerQuestion(
  patientId: string,
  question: string
): Promise<{ answer: QAAnswer; source: DataSource }> {
  if (isLumenApiConfigured()) {
    return { answer: await lumenApi.ask(patientId, question), source: 'fastapi' };
  }
  const patient = await demoClinic.getPatientById(patientId);
  if (!patient) throw new LumenApiError(404, 'PATIENT_NOT_FOUND', 'Unknown patient.');
  return { answer: answerFromRecord(patient, question), source: 'demo' };
}
