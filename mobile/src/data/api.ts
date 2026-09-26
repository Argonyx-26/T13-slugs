// ============================================================
// Client for the orchestrator (FastAPI, ShreyasFastAPI branch)
// ============================================================
// Every field it reads is typed in backend/app/contracts.py and api_models.py there.
// display_code and reason are not in the orchestrator's Visit contract yet: they are read
// when present, so the phone shows them as soon as the backend starts sending them.
// ============================================================

import type { QueuePatient, Sex, VisitStatus } from './types';

// ---------- Wire types ----------

interface ApiQueueEntry {
  visit_id: string;
  patient_uuid: string;
  display_name: string;
  display_code?: string | null;
  reason?: string | null;
  age: number | null;
  sex: Sex | null;
  token: number;
  status: VisitStatus;
  job_stage_label?: string | null;
}

interface ApiConsultationAccepted {
  job_id: string;
  display_name: string | null;
}

// ---------- Errors ----------

export class LumenApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** What the doctor reads, instead of the orchestrator's developer-facing message */
const FRIENDLY: Record<number, string> = {
  401: 'The clinic server rejected this app’s API key.',
  409: 'This queue entry belongs to a different patient.',
  413: 'The recording is too large to upload (25 MB limit).',
  429: 'The clinic server is busy. Try again in a moment.'
};

// ---------- Client ----------

export interface LumenApiConfig {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export interface ConsultationUpload {
  audio: Blob;
  /** Container type without codec parameters, e.g. "audio/webm" */
  type: string;
  filename: string;
  patientId: string;
  visitId: string;
}

export type LumenApi = ReturnType<typeof createLumenApi>;

export function createLumenApi({ baseUrl, apiKey, fetch: send = fetch }: LumenApiConfig) {
  const root = `${baseUrl.replace(/\/+$/, '')}/api/v1`;

  async function call<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    let res: Response;
    try {
      res = await send(`${root}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          // The orchestrator is often reached through an ngrok tunnel from Kaggle
          'ngrok-skip-browser-warning': '1',
          ...(apiKey ? { 'X-API-Key': apiKey } : {})
        }
      });
    } catch {
      throw new LumenApiError(0, 'UNREACHABLE', 'The clinic server could not be reached.');
    }
    if (!res.ok) {
      // The orchestrator's single error shape: {"error": {"code", "message", "stage"}}
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new LumenApiError(
        res.status,
        body?.error?.code ?? `HTTP_${res.status}`,
        FRIENDLY[res.status] ?? body?.error?.message ?? 'The clinic server returned an error.'
      );
    }
    return (await res.json()) as T;
  }

  return {
    /** Today's clinic queue in token order */
    async todaysQueue(): Promise<QueuePatient[]> {
      const rows = await call<ApiQueueEntry[]>('/visits/today', {}, 15_000);
      return rows.map((r) => ({
        visitId: r.visit_id,
        patientId: r.patient_uuid,
        displayCode: r.display_code ?? null,
        name: r.display_name,
        age: r.age,
        sex: r.sex,
        token: r.token,
        status: r.status,
        reason: r.reason ?? null,
        jobStageLabel: r.job_stage_label ?? null
      }));
    },

    /** Queues the recording for transcription and the note. The orchestrator marks the visit seen. */
    async submitConsultation(upload: ConsultationUpload) {
      const form = new FormData();
      form.append('audio_file', new File([upload.audio], upload.filename, { type: upload.type }));
      form.append('patient_uuid', upload.patientId);
      form.append('visit_id', upload.visitId);
      form.append('language_hint', 'auto');
      const out = await call<ApiConsultationAccepted>(
        '/consultations',
        { method: 'POST', body: form },
        120_000
      );
      return { jobId: out.job_id, displayName: out.display_name };
    }
  };
}
