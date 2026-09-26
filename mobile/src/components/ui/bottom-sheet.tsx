// A drag-to-dismiss bottom sheet that grows and shrinks smoothly as its content changes.
// Rendered inside the app rather than a portal, so the preview's phone frame contains it.
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface BottomSheetProps {
  open: boolean;
  label: string;
  /** Omit to make the sheet stay until an action inside it closes it */
  onDismiss?: () => void;
  children: ReactNode;
}

export function BottomSheet({ open, label, onDismiss, children }: BottomSheetProps) {
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 650) onDismiss?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key='backdrop'
          aria-hidden
          onClick={onDismiss}
          className='absolute inset-0 z-40 bg-black/65'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      )}
      {open && (
        <motion.div
          key='sheet'
          role='dialog'
          aria-modal='true'
          aria-label={label}
          className='absolute inset-x-0 bottom-0 z-50 rounded-t-[30px] border-t border-line-strong bg-surface pb-[calc(var(--sab)+18px)]'
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          drag={onDismiss ? 'y' : false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.04, bottom: 0.7 }}
          onDragEnd={onDragEnd}
        >
          <div className='mx-auto mt-3 mb-1 h-1 w-10 rounded-full bg-line-strong' />
          <AutoHeight>{children}</AutoHeight>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AutoHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className='overflow-hidden'
      initial={false}
      animate={{ height }}
      transition={{ type: 'spring', stiffness: 420, damping: 40 }}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}
