import { IconArrowRight } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ComponentProps, ReactNode } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import type { QueuePatient } from '@/data/types';
import { formatBytes, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Recording } from './engine/consultation-recorder';
import { uploadTypeFor } from './engine/audio-format';
import { useElapsedSeconds } from './recorder-context';
import { RecordingPlayer } from './recording-player';

export type EndFlow =
  | { step: 'closed' }
  | { step: 'confirm'; resumeOnCancel: boolean }
  | { step: 'saving' }
  | { step: 'saved'; recording: Recording; uploadedFor: string | null }
  | { step: 'failed'; recording: Recording; message: string };

interface EndSheetProps {
  flow: EndFlow;
  patient: QueuePatient | null;
  next: QueuePatient | null;
  live: boolean;
  onKeepRecording: () => void;
  onConfirm: () => void;
  onFinish: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}

export function EndSheet(props: EndSheetProps) {
  const { flow, onKeepRecording, onFinish } = props;
  const onDismiss =
    flow.step === 'confirm' ? onKeepRecording : flow.step === 'saved' ? onFinish : undefined;

  return (
    <BottomSheet open={flow.step !== 'closed'} label='End consultation' onDismiss={onDismiss}>
      <AnimatePresence mode='popLayout' initial={false}>
        <motion.div
          key={flow.step}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className='px-6 pt-4'
        >
          <Step {...props} />
        </motion.div>
      </AnimatePresence>
    </BottomSheet>
  );
}

function Step({
  flow,
  patient,
  next,
  live,
  onKeepRecording,
  onConfirm,
  onFinish,
  onRetry,
  onDiscard
}: EndSheetProps) {
  switch (flow.step) {
    case 'closed':
      return null;
    case 'confirm':
      return (
        <>
          <Eyebrow>END CONSULTATION?</Eyebrow>
          <PatientLine patient={patient} />
          <ConfirmDuration />
          <p className='mt-1 text-[13px] text-muted'>
            {live
              ? 'The recording is sent to the clinic server to write the note.'
              : 'Demo mode: the recording stays on this phone.'}
          </p>
          <div className='mt-6 grid grid-cols-2 gap-3'>
            <Button variant='outline' onClick={onKeepRecording}>
              Keep recording
            </Button>
            <Button variant='signal' onClick={onConfirm}>
              End &amp; save
            </Button>
          </div>
        </>
      );
    case 'saving':
      return (
        <div className='flex flex-col items-center py-6'>
          <DotLoader />
          <p className='font-dot mt-5 text-[13px] font-bold tracking-[0.28em] text-muted'>
            {live ? 'UPLOADING' : 'SAVING'}
          </p>
          <p className='mt-2 text-[14px] text-muted'>
            {live ? 'Sending the recording to the clinic server…' : 'Finishing the recording…'}
          </p>
        </div>
      );
    case 'saved': {
      const { recording, uploadedFor } = flow;
      return (
        <>
          <div className='flex items-center gap-4'>
            <Check />
            <div>
              <Eyebrow>CONSULTATION SAVED</Eyebrow>
              <p className='mt-1 text-[15px] text-fg'>
                {uploadedFor ? `Uploaded for ${uploadedFor}` : `Saved for ${patient?.name ?? '—'}`}
              </p>
            </div>
          </div>
          <p className='font-dot mt-4 text-[13px] font-bold tracking-[0.14em] text-muted'>
            {formatDuration(recording.durationMs)} · {formatBytes(recording.blob.size)} ·{' '}
            {uploadTypeFor(recording.mimeType).extension.toUpperCase()}
          </p>
          <p className='mt-1 text-[13px] text-muted'>
            {uploadedFor
              ? 'The note is being written; it appears on the dashboard when ready.'
              : 'Kept on this phone for playback (demo mode).'}
          </p>
          <div className='mt-4'>
            <RecordingPlayer recording={recording} />
          </div>
          <div className='mt-5'>
            <Button variant='solid' onClick={onFinish} className='w-full'>
              {next ? (
                <>
                  Next patient · {next.name}
                  <IconArrowRight size={18} />
                </>
              ) : (
                'Done'
              )}
            </Button>
          </div>
        </>
      );
    }
    case 'failed':
      return (
        <>
          <Eyebrow tone='signal'>UPLOAD FAILED</Eyebrow>
          <PatientLine patient={patient} />
          <p className='mt-2 text-[14px] text-muted'>{flow.message}</p>
          <p className='mt-1 text-[13px] text-muted'>
            The recording ({formatDuration(flow.recording.durationMs)}) is still on this phone.
          </p>
          <div className='mt-6 grid grid-cols-2 gap-3'>
            <Button variant='outline' onClick={onDiscard}>
              Discard
            </Button>
            <Button variant='solid' onClick={onRetry}>
              Retry upload
            </Button>
          </div>
        </>
      );
  }
}

function ConfirmDuration() {
  const seconds = useElapsedSeconds();
  return (
    <p className='font-dot mt-4 text-[44px] leading-none font-extrabold'>
      {formatDuration(seconds * 1000)}
      <span className='ml-2 font-sans text-[14px] font-normal text-muted'>recorded</span>
    </p>
  );
}

function PatientLine({ patient }: { patient: QueuePatient | null }) {
  if (!patient) return null;
  return (
    <div className='mt-2 flex items-center gap-2.5'>
      <span className='truncate text-[22px] font-semibold'>{patient.name}</span>
      {patient.displayCode && (
        <span className='font-dot rounded-full border border-line-strong px-2 py-1 text-[12px] leading-none font-extrabold tracking-[0.1em]'>
          {patient.displayCode}
        </span>
      )}
    </div>
  );
}

function Eyebrow({ children, tone }: { children: ReactNode; tone?: 'signal' }) {
  return (
    <p
      className={cn(
        'font-dot text-[13px] font-bold tracking-[0.28em]',
        tone === 'signal' ? 'text-signal' : 'text-muted'
      )}
    >
      {children}
    </p>
  );
}

function Button({
  variant,
  className,
  ...props
}: ComponentProps<typeof motion.button> & { variant: 'solid' | 'outline' | 'signal' }) {
  return (
    <motion.button
      type='button'
      whileTap={{ scale: 0.96 }}
      className={cn(
        'flex h-[52px] items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold',
        variant === 'solid' && 'bg-fg text-ink',
        variant === 'outline' && 'border border-line-strong text-fg',
        variant === 'signal' && 'bg-signal text-white',
        className
      )}
      {...props}
    />
  );
}

/** A white disc with a check that draws itself */
function Check() {
  return (
    <motion.span
      className='grid size-12 shrink-0 place-items-center rounded-full bg-fg text-ink'
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
    >
      <svg viewBox='0 0 24 24' className='size-6' aria-hidden>
        <motion.path
          d='M5 12.5l4.2 4.2L19 7'
          fill='none'
          stroke='currentColor'
          strokeWidth={2.6}
          strokeLinecap='round'
          strokeLinejoin='round'
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.12 }}
        />
      </svg>
    </motion.span>
  );
}

/** A 3×3 dot matrix lighting up in a wave */
function DotLoader() {
  return (
    <div aria-hidden className='grid grid-cols-3 gap-2'>
      {Array.from({ length: 9 }, (_, i) => (
        <motion.span
          key={i}
          className='size-2.5 rounded-full bg-fg'
          animate={{ opacity: [0.15, 1, 0.15] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            delay: ((i % 3) + Math.floor(i / 3)) * 0.12,
            ease: 'easeInOut'
          }}
        />
      ))}
    </div>
  );
}
