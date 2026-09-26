import { IconLayoutList } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { SlidingNumber } from '@/components/ui/sliding-number';
import { MORPH, QUEUE_SURFACE } from '@/lib/motion';

interface QueueButtonProps {
  waiting: number;
  onOpen: () => void;
}

/** Top left. Grows into the Live Queue screen (shared layout id) and shrinks back into it. */
export function QueueButton({ waiting, onOpen }: QueueButtonProps) {
  return (
    <motion.button
      type='button'
      layoutId={QUEUE_SURFACE}
      transition={MORPH}
      onClick={onOpen}
      whileTap={{ scale: 0.94 }}
      aria-label={`Open the live queue, ${waiting} waiting`}
      style={{ borderRadius: 22 }}
      className='relative flex h-11 items-center border border-line-strong bg-raised pr-4 pl-3.5 text-fg'
    >
      {/* layout="position" keeps the contents from stretching while the surface morphs */}
      <motion.span layout='position' className='flex items-center gap-2.5'>
        <IconLayoutList size={18} stroke={1.8} />
        <span className='font-dot text-[13px] font-bold tracking-[0.2em]'>QUEUE</span>
        <span className='h-3.5 w-px bg-line-strong' />
        <SlidingNumber value={waiting} className='font-dot text-[15px] font-bold' />
      </motion.span>
    </motion.button>
  );
}
