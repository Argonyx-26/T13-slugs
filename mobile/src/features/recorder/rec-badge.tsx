import { AnimatePresence, motion } from 'motion/react';
import { SPRING } from '@/lib/motion';
import type { RecorderStatus } from './engine/consultation-recorder';

/** Top right: the wordmark at rest, a live REC light while a consultation is recorded */
export function RecBadge({ status }: { status: RecorderStatus }) {
  const live = status === 'recording' || status === 'paused';
  return (
    <AnimatePresence mode='wait' initial={false}>
      {live ? (
        <motion.span
          key='rec'
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.7 }}
          transition={SPRING}
          className='font-dot flex h-8 items-center gap-2 rounded-full border border-signal/50 bg-signal/10 px-3 text-[13px] font-bold tracking-[0.2em] text-signal'
        >
          <span
            className={
              status === 'recording'
                ? 'size-2 animate-blink rounded-full bg-signal'
                : 'size-2 rounded-full border border-signal'
            }
          />
          REC
        </motion.span>
      ) : (
        <motion.span
          key='mark'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className='font-dot text-[15px] font-bold tracking-[0.3em] text-muted'
        >
          LUMEN
        </motion.span>
      )}
    </AnimatePresence>
  );
}
