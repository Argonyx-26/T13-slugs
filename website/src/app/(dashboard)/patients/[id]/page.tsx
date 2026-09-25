import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { patientByIdOptions } from '@/features/patients/api/queries';
import { getPatientById } from '@/features/patients/api/service';
import { PatientDetailView } from '@/features/patients/components/patient-detail-view';
import { getQueryClient } from '@/lib/query-client';

type PageProps = { params: Promise<{ id: string }> };

// One fetch per request, shared by the metadata and the page
const loadPatient = cache((id: string) => getPatientById(id));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const { patient } = await loadPatient(id);
  return { title: patient ? patient.displayName : 'Patient not found' };
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const queryClient = getQueryClient();
  // Awaited, not prefetched: an unknown id must become a real 404
  const data = await queryClient.fetchQuery({
    ...patientByIdOptions(id),
    queryFn: () => loadPatient(id)
  });
  if (!data.patient) notFound();

  return (
    <div className='flex flex-1 flex-col px-4 pt-2 pb-4 md:px-6 md:pt-4'>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <PatientDetailView patientId={id} />
      </HydrationBoundary>
    </div>
  );
}
