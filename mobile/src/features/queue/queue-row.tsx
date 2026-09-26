import { IconArrowRight, IconCheck } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { BorderBeam } from '@/components/ui/border-beam';
import type { QueuePatient } from '@/data/types';
import { ageSex } from '@/lib/format';
import { cn } from '@/lib/utils';

interface QueueRowProps {
  patient: QueuePatient;
  /** The recorder's current patient */
  isCurrent: boolean;
  /** A consultation is being recorded */
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onCallIn: () => void;
}

export function QueueRow({
  patient,
  isCurrent,
  busy,
  expanded,
  onToggle,
  onCallIn
}: QueueRowProps) {
  const seen = patient.status === 'seen';
  const inRoom = isCurrent && busy;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[24px] border bg-surface transition-opacity',
        isCurrent ? 'border-signal/35' : 'border-line',
        seen && !isCurrent && 'opacity-55'
      )}
    >
      {isCurrent && (
        <BorderBeam
          size={110}
          duration={5}
          borderWidth={1.5}
          colorFrom='var(--color-signal)'
          colorTo='rgb(215 25 33 / 0)'
        />
      )}
      <button
        type='button'
        onClick={onToggle}
        aria-expanded={expanded}
        className='flex w-full items-start gap-4 px-4 py-4 text-left'
      >
        <span
          className={cn(
            'font-dot w-[52px] shrink-0 text-[40px] leading-[0.9] font-extrabold',
            seen ? 'text-faint' : 'text-fg'
          )}
        >
          {String(patient.token).padStart(2, '0')}
        </span>
        <span className='min-w-0 flex-1'>
          <span className='flex items-center justify-between gap-2'>
            <span className='truncate text-[17px] font-medium text-fg'>{patient.name}</span>
            <StatusBadge seen={seen} isCurrent={isCurrent} inRoom={inRoom} />
          </span>
          <span className='mt-1.5 flex items-center gap-2 text-[12px] text-muted'>
            <span className='font-dot rounded-full border border-line-strong px-2 py-[3px] text-[12px] leading-none font-extrabold tracking-[0.08em] text-fg'>
              {patient.displayCode ?? '—'}
            </span>
            <span>{ageSex(patient.age, patient.sex)}</span>
          </span>
          <span
            className={cn(
              'mt-2 block text-[13.5px] leading-snug text-muted',
              !expanded && 'line-clamp-2'
            )}
          >
            {patient.reason ?? 'Reason for the visit was not recorded.'}
          </span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key='details'
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className='overflow-hidden'
          >
            <div className='border-t border-line px-4 py-3.5'>
              <Details
                patient={patient}
                isCurrent={isCurrent}
                busy={busy}
                inRoom={inRoom}
                onCallIn={onCallIn}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Details({
  patient,
  isCurrent,
  busy,
  inRoom,
  onCallIn
}: Pick<QueueRowProps, 'patient' | 'isCurrent' | 'busy' | 'onCallIn'> & { inRoom: boolean }) {
  if (patient.status === 'seen') {
    return (
      <p className='text-[13px] text-muted'>
        {patient.jobStageLabel ?? 'Consultation recorded today.'}
      </p>
    );
  }
  if (inRoom) return <p className='text-[13px] text-muted'>Recording this consultation now.</p>;
  if (isCurrent) return <p className='text-[13px] text-muted'>Up next on the recorder.</p>;
  if (busy) {
    return (
      <p className='text-[13px] text-muted'>
        Finish the current consultation to call in another patient.
      </p>
    );
  }
  return (
    <motion.button
      type='button'
      onClick={onCallIn}
      whileTap={{ scale: 0.96 }}
      className='flex h-11 w-full items-center justify-center gap-2 rounded-full bg-fg text-[14px] font-semibold text-ink'
    >
      Call in now
      <IconArrowRight size={17} />
    </motion.button>
  );
}

function StatusBadge({
  seen,
  isCurrent,
  inRoom
}: {
  seen: boolean;
  isCurrent: boolean;
  inRoom: boolean;
}) {
  const base =
    'font-dot flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] leading-none font-extrabold tracking-[0.16em]';
  if (inRoom) {
    return (
      <span className={cn(base, 'bg-signal/15 text-signal')}>
        <span className='size-1.5 animate-blink rounded-full bg-signal' />
        IN ROOM
      </span>
    );
  }
  if (isCurrent) return <span className={cn(base, 'bg-fg text-ink')}>UP NEXT</span>;
  if (seen) {
    return (
      <span className={cn(base, 'text-muted')}>
        SEEN
        <IconCheck size={12} stroke={3} />
      </span>
    );
  }
  return <span className={cn(base, 'border border-line-strong text-muted')}>WAITING</span>;
}
