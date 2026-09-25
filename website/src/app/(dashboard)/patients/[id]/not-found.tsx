import Link from 'next/link';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';

export default function PatientNotFound() {
  return (
    <div className='flex flex-1 p-4 md:px-6'>
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.user />
          </EmptyMedia>
          <EmptyTitle>Patient not found</EmptyTitle>
          <EmptyDescription>
            This patient is not in the clinic’s records, or has been removed.
          </EmptyDescription>
        </EmptyHeader>
        <Link href='/patients' className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <Icons.arrowLeft /> All patients
        </Link>
      </Empty>
    </div>
  );
}
