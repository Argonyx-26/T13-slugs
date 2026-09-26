// ============================================================
// Queue — Type Contract
// ============================================================
// What every screen sees, whether the queue comes from the bundled demo data or the
// orchestrator (GET /api/v1/visits/today on the ShreyasFastAPI branch). api.ts maps the
// wire format into these, so switching sources never changes a component.
// ============================================================

export type Sex = 'M' | 'F' | 'O';

export type VisitStatus = 'waiting' | 'seen';

/** Where the queue came from: bundled synthetic patients, or the orchestrator API */
export type DataSource = 'demo' | 'fastapi';

/** One patient in today's clinic queue */
export interface QueuePatient {
  visitId: string;
  patientId: string;
  /** The RAG pipeline's unique patient code (patients.display_code), e.g. "P-008" */
  displayCode: string | null;
  name: string;
  age: number | null;
  sex: Sex | null;
  /** Position in today's queue, 1 = first */
  token: number;
  status: VisitStatus;
  /** Why the appointment was booked, as told to the reception desk */
  reason: string | null;
  /** Live mode: progress of the newest recording made for this visit */
  jobStageLabel: string | null;
}
