'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';

export default function PatientsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className='flex flex-1 p-4 md:px-6'>
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.warning />
          </EmptyMedia>
          <EmptyTitle>Patient records are unavailable right now</EmptyTitle>
          <EmptyDescription>
            The clinic server could not be reached. Check that the orchestrator is running and that
            LUMEN_API_URL points to it, or unset it to use the demo patients.
          </EmptyDescription>
        </EmptyHeader>
        <Button variant='outline' size='sm' onClick={reset}>
          <Icons.refresh /> Try again
        </Button>
      </Empty>
    </div>
  );
}
