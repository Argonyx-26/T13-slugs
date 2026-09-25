import { queryOptions } from '@tanstack/react-query';
import { getClinicStats, getPatientById, getPatients } from './service';

export const patientKeys = {
  all: ['patients'] as const,
  list: () => [...patientKeys.all, 'list'] as const,
  detail: (id: string) => [...patientKeys.all, 'detail', id] as const
};

export const clinicKeys = {
  all: ['clinic'] as const,
  stats: () => [...clinicKeys.all, 'stats'] as const
};

export const patientsQueryOptions = () =>
  queryOptions({
    queryKey: patientKeys.list(),
    queryFn: () => getPatients()
  });

export const patientByIdOptions = (id: string) =>
  queryOptions({
    queryKey: patientKeys.detail(id),
    queryFn: () => getPatientById(id)
  });

export const clinicStatsQueryOptions = () =>
  queryOptions({
    queryKey: clinicKeys.stats(),
    queryFn: () => getClinicStats()
  });
