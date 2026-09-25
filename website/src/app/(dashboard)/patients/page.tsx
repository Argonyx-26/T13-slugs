import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import PageContainer from '@/components/layout/page-container';
import { clinicStatsQueryOptions, patientsQueryOptions } from '@/features/patients/api/queries';
import { DataSourceBadge } from '@/features/patients/components/data-source-badge';
import { PatientBentoGrid, PatientBentoGridSkeleton } from '@/features/patients/components/patient-bento-grid';
import { patientsInfoContent } from '@/features/patients/info-content';
import { getQueryClient } from '@/lib/query-client';

export const metadata: Metadata = {
  title: 'Patients'
};

export default function Page() {
  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(patientsQueryOptions());
  void queryClient.prefetchQuery(clinicStatsQueryOptions());

  return (
    <PageContainer
      pageTitle='Patients'
      pageDescription="Today's list, highest risk first. Open a patient to read the full record and ask the assistant."
      infoContent={patientsInfoContent}
      pageHeaderAction={<DataSourceBadge />}
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<PatientBentoGridSkeleton />}>
          <PatientBentoGrid />
        </Suspense>
      </HydrationBoundary>
    </PageContainer>
  );
}
