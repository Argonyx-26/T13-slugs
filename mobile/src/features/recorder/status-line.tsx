import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { RecorderStatus } from './engine/consultation-recorder';

interface StatusLineProps {
  status: RecorderStatus;
  saving: boolean;
  hasPatient: boolean;
  queueState: 'loading' | 'error' | 'ready';
}

/** One dot-matrix word under the clock saying what the recorder is doing */
export function StatusLine({ status, saving, hasPatient, queueState }: StatusLineProps) {
  const [text, tone] =
    status === 'recording'
      ? ['RECORDING', 'signal']
      : status === 'paused'
        ? ['PAUSED', 'fg']
        : status === 'requesting'
          ? ['ALLOW MICROPHONE', 'muted']
          : status === 'stopping' || saving
            ? ['SAVING', 'muted']
            : status === 'error'
              ? ['MICROPHONE OFF', 'signal']
              : hasPatient
                ? ['READY', 'muted']
                : queueState === 'loading'
                  ? ['CONNECTING', 'muted']
                  : queueState === 'error'
                    ? ['QUEUE OFFLINE', 'muted']
                    : ['QUEUE CLEAR', 'muted'];

  return (
    <div className='mt-3 flex h-5 items-center justify-center'>
      <AnimatePresence mode='wait' initial={false}>
        <motion.p
          key={text}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16 }}
          className={cn(
            'font-dot flex items-center gap-2 text-[14px] font-bold tracking-[0.32em]',
            tone === 'signal' ? 'text-signal' : tone === 'fg' ? 'text-fg' : 'text-muted',
            status === 'paused' && 'animate-blink'
          )}
        >
          {status === 'recording' && (
            <span className='relative flex size-2'>
              <span className='absolute inset-0 animate-ping rounded-full bg-signal opacity-70' />
              <span className='relative size-2 rounded-full bg-signal' />
            </span>
          )}
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
