import { describe, expect, it } from 'vitest';
import { selectCurrentPatient } from './current-patient';
import { demoQueue } from './demo-queue';

describe('demoQueue', () => {
  const queue = demoQueue(new Date(2026, 8, 25));

  it('gives every patient a unique code in the RAG pipeline format', () => {
    const codes = queue.map((p) => p.displayCode);
    for (const code of codes) expect(code).toMatch(/^P-\d{3}$/);
    expect(new Set(codes).size).toBe(queue.length);
  });

  it('has tokens 1..11 and the website demo’s statuses', () => {
    expect(queue.map((p) => p.token)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(queue.filter((p) => p.status === 'seen').map((p) => p.name)).toEqual([
      'Deepak V.',
      'Fatima Z.'
    ]);
  });

  it('has a reason for every visit', () => {
    for (const p of queue) expect(p.reason?.length).toBeGreaterThan(3);
  });

  it('uses the orchestrator mock’s visit id format', () => {
    expect(queue[2].visitId).toBe('20260925-03');
  });

  it('puts Ravi K. up next', () => {
    const current = selectCurrentPatient(queue, null);
    expect(current?.name).toBe('Ravi K.');
    expect(current?.displayCode).toBe('P-008');
  });
});
