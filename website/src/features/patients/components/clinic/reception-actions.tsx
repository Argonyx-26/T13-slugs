'use client';

import { CheckInDialog } from './check-in-dialog';
import { RegisterPatientSheet } from './register-patient-sheet';

/** The reception desk's two jobs, in the patients page header */
export function ReceptionActions() {
  return (
    <div className='flex flex-wrap items-center justify-end gap-2'>
      <CheckInDialog />
      <RegisterPatientSheet />
    </div>
  );
}
