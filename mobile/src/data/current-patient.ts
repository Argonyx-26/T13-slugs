import type { QueuePatient } from './types';

/**
 * Who the doctor is about to see. A pinned visit (called in from the queue, or being
 * recorded) always wins, and survives a queue refresh that no longer lists it, so a
 * refresh can never swap patients mid-consultation. Otherwise: the lowest waiting token.
 */
export function selectCurrentPatient(
  queue: QueuePatient[],
  pinned: QueuePatient | null
): QueuePatient | null {
  if (pinned) return queue.find((p) => p.visitId === pinned.visitId) ?? pinned;
  return firstWaiting(queue);
}

/** The lowest waiting token, optionally skipping one visit */
export function firstWaiting(queue: QueuePatient[], exceptVisitId?: string): QueuePatient | null {
  let first: QueuePatient | null = null;
  for (const p of queue) {
    if (p.status !== 'waiting' || p.visitId === exceptVisitId) continue;
    if (!first || p.token < first.token) first = p;
  }
  return first;
}
