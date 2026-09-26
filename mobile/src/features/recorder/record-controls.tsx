import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { SPRING } from '@/lib/motion';
import type { RecorderStatus } from './engine/consultation-recorder';

interface RecordControlsProps {
  status: RecorderStatus;
  canRecord: boolean;
  onRecord: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}

/**
 * At rest: one big red record button. Recording: it morphs into End (a red square) and
 * slides right as Pause/Resume appears beside it.
 */
export function RecordControls({
  status,
  canRecord,
  onRecord,
  onPause,
  onResume,
  onEnd
}: RecordControlsProps) {
  const inSession = status === 'recording' || status === 'paused';
  const busy = status === 'requesting' || status === 'stopping';

  return (
    <div className='relative flex items-start justify-center gap-12'>
      <AnimatePresence initial={false} mode='popLayout'>
        {inSession && (
          <motion.div
            key='pause'
            layout
            className='flex flex-col items-center gap-3'
            initial={{ opacity: 0, scale: 0.5, x: 60 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.5, x: 60 }}
            transition={SPRING}
          >
            <motion.button
              type='button'
              onClick={status === 'paused' ? onResume : onPause}
              whileTap={{ scale: 0.88 }}
              aria-label={status === 'paused' ? 'Resume recording' : 'Pause recording'}
              className='grid size-[70px] place-items-center rounded-full border border-line-strong bg-raised text-fg'
            >
              <AnimatePresence mode='wait' initial={false}>
                <motion.span
                  key={status === 'paused' ? 'resume' : 'pause'}
                  initial={{ opacity: 0, scale: 0.4, rotate: -90 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.4, rotate: 90 }}
                  transition={{ duration: 0.16 }}
                >
                  {status === 'paused' ? (
                    <IconPlayerPlayFilled size={26} />
                  ) : (
                    <IconPlayerPauseFilled size={26} />
                  )}
                </motion.span>
              </AnimatePresence>
            </motion.button>
            <Caption>{status === 'paused' ? 'RESUME' : 'PAUSE'}</Caption>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div layout transition={SPRING} className='flex flex-col items-center gap-3'>
        <motion.button
          type='button'
          onClick={inSession ? onEnd : onRecord}
          disabled={busy || (!inSession && !canRecord)}
          whileTap={{ scale: 0.9 }}
          aria-label={inSession ? 'End consultation' : 'Start recording'}
          className='relative grid size-[92px] place-items-center rounded-full border-2 border-white/20 transition-opacity disabled:opacity-35'
        >
          {status === 'recording' && (
            <motion.span
              aria-hidden
              className='absolute -inset-0.5 rounded-full border-2 border-signal'
              initial={{ opacity: 0.55, scale: 1 }}
              animate={{ opacity: 0, scale: 1.32 }}
              transition={{ duration: 1.7, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
          {busy && (
            <span
              aria-hidden
              className='absolute -inset-1 animate-spin rounded-full border-2 border-transparent border-t-fg'
            />
          )}
          <motion.span
            className='block bg-signal'
            initial={false}
            animate={
              inSession
                ? { width: 32, height: 32, borderRadius: 9 }
                : { width: 70, height: 70, borderRadius: 35 }
            }
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
          />
        </motion.button>
        <Caption>{inSession ? 'END' : status === 'stopping' ? 'SAVING' : 'RECORD'}</Caption>
      </motion.div>
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <span className='font-dot text-[12px] font-bold tracking-[0.28em] text-muted'>{children}</span>
  );
}
