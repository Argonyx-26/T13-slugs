import { describe, expect, it } from 'vitest';
import { firstWaiting, selectCurrentPatient } from './current-patient';
import type { QueuePatient } from './types';

function patient(token: number, status: QueuePatient['status'] = 'waiting'): QueuePatient {
  return {
    visitId: `v${token}`,
    patientId: `p${token}`,
    displayCode: `P-${String(token).padStart(3, '0')}`,
    name: `Patient ${token}`,
    age: 40,
    sex: 'F',
    token,
    status,
    reason: null,
    jobStageLabel: null
  };
}

describe('selectCurrentPatient', () => {
  it('picks the lowest waiting token, whatever the order', () => {
    const queue = [patient(5), patient(1, 'seen'), patient(3), patient(2, 'seen')];
    expect(selectCurrentPatient(queue, null)?.token).toBe(3);
  });

  it('prefers the pinned patient over the queue order', () => {
    const queue = [patient(3), patient(4), patient(5)];
    expect(selectCurrentPatient(queue, patient(5))?.token).toBe(5);
  });

  it('shows the refreshed row for the pinned patient', () => {
    const pinned = patient(3);
    const refreshed = [{ ...patient(3), status: 'seen' as const }, patient(4)];
    expect(selectCurrentPatient(refreshed, pinned)?.status).toBe('seen');
  });

  it('keeps the pinned patient when a refresh no longer lists them', () => {
    const pinned = patient(3);
    expect(selectCurrentPatient([patient(4), patient(5)], pinned)).toEqual(pinned);
  });

  it('is empty when nobody is waiting', () => {
    expect(selectCurrentPatient([], null)).toBeNull();
    expect(selectCurrentPatient([patient(1, 'seen')], null)).toBeNull();
  });
});

describe('firstWaiting', () => {
  it('can skip the current patient to name the next one', () => {
    const queue = [patient(3), patient(4), patient(5)];
    expect(firstWaiting(queue, 'v3')?.token).toBe(4);
    expect(firstWaiting([patient(3)], 'v3')).toBeNull();
  });
});
