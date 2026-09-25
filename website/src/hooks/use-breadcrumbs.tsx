'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { patientKeys } from '@/features/patients/api/queries';
import type { PatientByIdResponse } from '@/features/patients/api/types';

type BreadcrumbItem = {
  title: string;
  link: string;
};

// This allows to add custom title as well
const routeMapping: Record<string, BreadcrumbItem[]> = {
  '/patients': [{ title: 'Patients', link: '/patients' }]
  // Add more custom mappings as needed
};

/**
 * The patient's name from the page's cached query. Reads the cache without creating an entry:
 * an observer here would make the page's HydrationBoundary defer hydrating that query to an
 * effect, which never runs during server rendering.
 */
function useCachedPatientName(patientId: string): string | undefined {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient]
  );
  const read = () =>
    patientId
      ? queryClient.getQueryData<PatientByIdResponse>(patientKeys.detail(patientId))?.patient?.displayName
      : undefined;
  return useSyncExternalStore(subscribe, read, () => undefined);
}

export function useBreadcrumbs() {
  const pathname = usePathname();
  const segments = useMemo(() => pathname.split('/').filter(Boolean), [pathname]);
  const patientId = segments[0] === 'patients' && segments[1] ? segments[1] : '';
  const patientName = useCachedPatientName(patientId);

  const breadcrumbs = useMemo(() => {
    // Check if we have a custom mapping for this exact path
    if (routeMapping[pathname]) {
      return routeMapping[pathname];
    }

    // If no exact match, fall back to generating breadcrumbs from the path
    return segments.map((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join('/')}`;
      const title =
        index === 1 && patientId ? (patientName ?? 'Patient') : segment.charAt(0).toUpperCase() + segment.slice(1);
      return { title, link: path };
    });
  }, [pathname, segments, patientId, patientName]);

  return breadcrumbs;
}
