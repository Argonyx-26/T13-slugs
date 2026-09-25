import type { ClinicStats } from '@/features/patients/api/types';

// Clinic-wide figures for the stats row. No orchestrator endpoint serves these yet.
export const clinicStats: ClinicStats = {
  month: 'September 2026',
  previousMonth: 'August',
  patientsThisMonth: 142,
  patientsLastMonth: 127,
  newPatientsThisMonth: 23,
  consultationsToday: 18,
  seenToday: 11,
  notesAwaitingReview: 5
};
