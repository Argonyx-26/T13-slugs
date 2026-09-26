import { AnimatePresence, motion } from 'motion/react';
import { DecryptedText } from '@/components/ui/decrypted-text';
import type { QueuePatient } from '@/data/types';
import { ageSex } from '@/lib/format';
import { cn } from '@/lib/utils';

interface CurrentPatientProps {
  patient: QueuePatient | null;
  inConsultation: boolean;
  queueState: 'loading' | 'error' | 'ready';
  queueError: string | null;
}

/** Top left, under the queue button: who is about to come in, with their RAG patient code. */
export function CurrentPatient({
  patient,
  inConsultation,
  queueState,
  queueError
}: CurrentPatientProps) {
  return (
    <div className='min-h-[124px]'>
      <AnimatePresence mode='wait' initial={false}>
        {patient ? (
          <motion.div
            key={patient.visitId}
            initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <p className='font-dot text-[12px] font-bold tracking-[0.24em] text-muted'>
              <span className={cn(inConsultation && 'text-signal')}>
                {inConsultation ? 'IN CONSULTATION' : 'UP NEXT'}
              </span>
              {' · TOKEN '}
              {String(patient.token).padStart(2, '0')}
            </p>
            <div className='mt-1.5 flex items-baseline justify-between gap-3'>
              <h1 className='truncate text-[30px] leading-tight font-semibold tracking-[-0.02em]'>
                {patient.name}
              </h1>
              <span className='shrink-0 text-[14px] text-muted'>
                {ageSex(patient.age, patient.sex)}
              </span>
            </div>
            <div className='mt-2.5 flex items-start gap-3'>
              <span
                aria-label='Patient ID'
                className='font-dot shrink-0 rounded-full border border-line-strong bg-raised px-2.5 py-1.5 text-[14px] leading-none font-extrabold tracking-[0.1em] text-fg'
              >
                {patient.displayCode ? <DecryptedText text={patient.displayCode} /> : '—'}
              </span>
              <p className='line-clamp-2 pt-0.5 text-[14px] leading-snug text-muted'>
                {patient.reason ?? 'Reason for the visit was not recorded at the desk.'}
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={queueState}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {queueState === 'loading' ? (
              <div className='space-y-3' aria-label='Loading the queue'>
                <div className='h-3 w-32 animate-pulse rounded-full bg-raised' />
                <div className='h-7 w-48 animate-pulse rounded-full bg-raised' />
                <div className='h-4 w-64 animate-pulse rounded-full bg-raised' />
              </div>
            ) : (
              <>
                <p className='font-dot text-[12px] font-bold tracking-[0.24em] text-muted'>
                  {queueState === 'error' ? 'QUEUE OFFLINE' : 'QUEUE CLEAR'}
                </p>
                <h1 className='mt-1.5 text-[26px] leading-tight font-semibold'>
                  {queueState === 'error' ? 'Can’t load today’s queue' : 'No one is waiting'}
                </h1>
                <p className='mt-2 text-[14px] text-muted'>
                  {queueState === 'error'
                    ? (queueError ?? 'The clinic server could not be reached.')
                    : 'New check-ins from the reception desk appear here.'}
                </p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
