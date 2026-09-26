import { describe, expect, it, vi } from 'vitest';
import { createLumenApi, LumenApiError } from './api';

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('createLumenApi', () => {
  it('reads today’s queue with the ngrok and API key headers', async () => {
    const send = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      respond(200, [
        {
          visit_id: '20260925-01',
          patient_uuid: 'cb2759d8-3d91-4a4d-8bd2-026f68f76426',
          display_name: 'Ravi K.',
          age: 54,
          sex: 'M',
          token: 1,
          status: 'waiting',
          job_id: null,
          job_stage: null,
          job_stage_label: null
        },
        {
          visit_id: '20260925-02',
          patient_uuid: '91786a1e-1ee8-4f60-8191-8a74c0e3edd1',
          display_name: 'Lakshmi S.',
          display_code: 'P-009',
          reason: 'Right knee pain',
          age: 67,
          sex: 'F',
          token: 2,
          status: 'seen',
          job_stage_label: 'Transcribing and separating speakers'
        }
      ])
    );
    const api = createLumenApi({ baseUrl: 'https://clinic.example/', apiKey: 'k', fetch: send });

    const queue = await api.todaysQueue();

    const [url, init] = send.mock.calls[0];
    expect(url).toBe('https://clinic.example/api/v1/visits/today');
    expect(init?.headers).toMatchObject({ 'ngrok-skip-browser-warning': '1', 'X-API-Key': 'k' });
    // Not in the orchestrator's contract yet: read as null until the backend sends them
    expect(queue[0]).toMatchObject({ name: 'Ravi K.', displayCode: null, reason: null });
    expect(queue[1]).toMatchObject({
      displayCode: 'P-009',
      reason: 'Right knee pain',
      status: 'seen',
      jobStageLabel: 'Transcribing and separating speakers'
    });
  });

  it('uploads the recording as the orchestrator’s multipart form', async () => {
    const send = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      respond(202, { job_id: 'job-1', stage: 'queued', display_name: 'Ravi K.' })
    );
    const api = createLumenApi({ baseUrl: 'https://clinic.example', fetch: send });

    const accepted = await api.submitConsultation({
      audio: new Blob(['abc'], { type: 'audio/webm;codecs=opus' }),
      type: 'audio/webm',
      filename: 'consultation-20260925-03.webm',
      patientId: 'cb2759d8-3d91-4a4d-8bd2-026f68f76426',
      visitId: '20260925-03'
    });

    expect(accepted).toEqual({ jobId: 'job-1', displayName: 'Ravi K.' });
    const [url, init] = send.mock.calls[0];
    expect(url).toBe('https://clinic.example/api/v1/consultations');
    expect(init?.method).toBe('POST');
    expect(init?.headers).not.toHaveProperty('X-API-Key');
    const form = init?.body as FormData;
    const file = form.get('audio_file') as File;
    expect(file.name).toBe('consultation-20260925-03.webm');
    expect(file.type).toBe('audio/webm');
    expect(form.get('patient_uuid')).toBe('cb2759d8-3d91-4a4d-8bd2-026f68f76426');
    expect(form.get('visit_id')).toBe('20260925-03');
    expect(form.get('language_hint')).toBe('auto');
  });

  it('turns orchestrator errors into messages for the doctor', async () => {
    const busy = createLumenApi({
      baseUrl: 'https://clinic.example',
      fetch: async () => respond(429, { error: { code: 'BUSY', message: 'Queue full' } })
    });
    await expect(busy.todaysQueue()).rejects.toMatchObject({
      status: 429,
      code: 'BUSY',
      message: 'The clinic server is busy. Try again in a moment.'
    });

    const down = createLumenApi({
      baseUrl: 'https://clinic.example',
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      }
    });
    const error = await down.todaysQueue().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LumenApiError);
    expect(error).toMatchObject({ code: 'UNREACHABLE' });
  });
});
