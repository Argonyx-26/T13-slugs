// A Nothing-style notification pill. Rendered inside the app (not a portal), so in the
// localhost preview it stays inside the phone frame.
import { AnimatePresence, motion } from 'motion/react';
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** At most two at once; repeating a message replaces it. */
export function toast(message: string, tone: Tone = 'info', durationMs = 3200) {
  const id = nextId++;
  items = [...items.filter((t) => t.message !== message).slice(-1), { id, message, tone }];
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, durationMs);
}

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, () => items);
  return (
    <div
      aria-live='polite'
      className='pointer-events-none absolute inset-x-0 top-[calc(var(--sat)+10px)] z-[60] flex flex-col items-center gap-2 px-6'
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            role={t.tone === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: -14, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            className='flex max-w-full items-center gap-2.5 rounded-full border border-line-strong bg-raised px-4 py-2.5 text-[13px] leading-snug text-fg shadow-[0_14px_32px_-12px_rgb(0_0_0/0.9)]'
          >
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                t.tone === 'error' ? 'bg-signal' : t.tone === 'success' ? 'bg-fg' : 'bg-muted'
              )}
            />
            <span>{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
