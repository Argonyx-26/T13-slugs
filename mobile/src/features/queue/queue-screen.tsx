import { IconArrowLeft, IconRefresh } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { AnimatedBackground } from '@/components/ui/animated-background';
import { InViewItem } from '@/components/ui/in-view-item';
import { toast } from '@/components/ui/toast';
import { useSession } from '@/data/session';
import type { DataSource, QueuePatient } from '@/data/types';
import { useElapsedSeconds, useRecorderState } from '@/features/recorder/recorder-context';
import { useBackHandler } from '@/lib/back-button';
import { formatDuration, formatToday } from '@/lib/format';
import { MORPH, QUEUE_SURFACE, SPRING } from '@/lib/motion';
import { tap } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { QueueRow } from './queue-row';

type Filter = 'all' | 'waiting' | 'seen';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'seen', label: 'Seen' }
];

/** Today's clinic queue. Grows out of the recorder's queue button. */
export function QueueScreen({ onClose }: { onClose: () => void }) {
  const { queue, current, pin, source, queueState, queueError, refetchQueue, isSyncing, syncedAt } =
    useSession();
  const { status } = useRecorderState();
  const busy = status === 'recording' || status === 'paused' || status === 'stopping';
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useBackHandler(onClose);

  const counts: Record<Filter, number> = {
    all: queue.length,
    waiting: queue.filter((p) => p.status === 'waiting').length,
    seen: queue.filter((p) => p.status === 'seen').length
  };
  const rows = queue
    .filter((p) => filter === 'all' || p.status === filter)
    .toSorted((a, b) => a.token - b.token);

  const callIn = (patient: QueuePatient) => {
    tap('medium');
    pin(patient);
    toast(`${patient.name} called in`, 'success');
    onClose();
  };

  return (
    <>
      <motion.div
        layoutId={QUEUE_SURFACE}
        transition={MORPH}
        style={{ borderRadius: 0 }}
        className='absolute inset-0 z-40 bg-ink'
      />
      <motion.section
        aria-label='Live queue'
        className='absolute inset-0 z-40 flex flex-col bg-dot-grid pt-safe'
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.22 } }}
        exit={{ opacity: 0, transition: { duration: 0.1 } }}
      >
        <header className='flex h-[64px] shrink-0 items-center gap-3 px-5'>
          <motion.button
            type='button'
            onClick={onClose}
            whileTap={{ scale: 0.9 }}
            aria-label='Back to the recorder'
            className='grid size-11 place-items-center rounded-full border border-line-strong bg-raised text-fg'
          >
            <IconArrowLeft size={20} />
          </motion.button>
          <div className='min-w-0 flex-1'>
            <h2 className='font-dot text-[length:min(21px,5.2cqw)] leading-none font-extrabold tracking-[0.14em] whitespace-nowrap'>
              LIVE QUEUE
            </h2>
            <p className='mt-1.5 text-[12px] text-muted'>{formatToday()}</p>
          </div>
          <SourceBadge source={source} />
        </header>

        <AnimatePresence initial={false}>
          {busy && <RecordingPill key='pill' patient={current} onOpen={onClose} />}
        </AnimatePresence>

        <div className='shrink-0 px-5 pt-2'>
          <div className='flex rounded-full border border-line bg-surface p-1'>
            <AnimatedBackground
              value={filter}
              onValueChange={(id) => {
                tap();
                setFilter(id as Filter);
              }}
              className='rounded-full bg-fg'
              transition={{ type: 'spring', bounce: 0.18, duration: 0.35 }}
            >
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  data-id={f.id}
                  type='button'
                  className='flex-1 justify-center rounded-full py-2 text-[13px] font-medium text-muted transition-colors duration-200 data-[checked=true]:text-ink'
                >
                  {f.label}
                  <span className='font-dot text-[13px] font-extrabold'>{counts[f.id]}</span>
                </button>
              ))}
            </AnimatedBackground>
          </div>
        </div>

        <div className='relative mt-3 min-h-0 flex-1'>
          <div
            ref={listRef}
            className='h-full overflow-y-auto overscroll-contain px-5 pt-1 pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          >
            {queueState === 'loading' ? (
              <ListSkeleton />
            ) : queueState === 'error' && queue.length === 0 ? (
              <EmptyState
                title='Can’t reach the clinic server'
                body={queueError ?? 'Check the connection and try again.'}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title={filter === 'seen' ? 'No one seen yet' : 'No one waiting'}
                body='New check-ins from the reception desk appear here.'
              />
            ) : (
              <ul className='flex flex-col gap-3'>
                <AnimatePresence initial={false}>
                  {rows.map((p, i) => (
                    <motion.li
                      key={p.visitId}
                      layout
                      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.15 } }}
                      transition={SPRING}
                    >
                      <InViewItem root={listRef} index={i}>
                        <QueueRow
                          patient={p}
                          isCurrent={p.visitId === current?.visitId}
                          busy={busy}
                          expanded={expanded === p.visitId}
                          onToggle={() => {
                            tap();
                            setExpanded((e) => (e === p.visitId ? null : p.visitId));
                          }}
                          onCallIn={() => callIn(p)}
                        />
                      </InViewItem>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
          {/* Soft edges as rows scroll under the header and footer */}
          <div className='pointer-events-none absolute inset-x-0 top-0 h-5 bg-linear-to-b from-ink to-transparent' />
          <div className='pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-ink to-transparent' />
        </div>

        <footer className='shrink-0 border-t border-line px-5 pt-3 pb-[calc(var(--sab)+14px)]'>
          <SyncStatus
            source={source}
            syncedAt={syncedAt}
            syncing={isSyncing}
            failed={queueState === 'error'}
            onRefresh={() => {
              tap();
              refetchQueue();
            }}
          />
        </footer>
      </motion.section>
    </>
  );
}

function SourceBadge({ source }: { source: DataSource }) {
  const live = source === 'fastapi';
  return (
    <span
      className={cn(
        'font-dot flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] font-extrabold tracking-[0.2em]',
        live ? 'border-signal/50 text-signal' : 'border-line-strong text-muted'
      )}
    >
      <span className='relative flex size-2'>
        <span
          className={cn(
            'absolute inset-0 animate-ping rounded-full opacity-70',
            live ? 'bg-signal' : 'bg-muted'
          )}
        />
        <span className={cn('relative size-2 rounded-full', live ? 'bg-signal' : 'bg-muted')} />
      </span>
      {live ? 'LIVE' : 'DEMO'}
    </span>
  );
}

/** While a consultation is recorded, a way back to it from the queue */
function RecordingPill({ patient, onOpen }: { patient: QueuePatient | null; onOpen: () => void }) {
  const seconds = useElapsedSeconds();
  const { status } = useRecorderState();
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={SPRING}
      className='shrink-0 overflow-hidden px-5'
    >
      <motion.button
        type='button'
        onClick={onOpen}
        whileTap={{ scale: 0.97 }}
        className='mt-1 mb-2 flex h-11 w-full items-center gap-3 rounded-full border border-signal/40 bg-signal/10 px-4 text-left'
      >
        <span
          className={cn(
            'size-2 shrink-0 rounded-full bg-signal',
            status === 'recording' && 'animate-blink'
          )}
        />
        <span className='font-dot text-[14px] font-extrabold tracking-[0.1em] text-signal'>
          {formatDuration(seconds * 1000)}
        </span>
        <span className='min-w-0 flex-1 truncate text-[13px] text-fg'>
          {status === 'paused' ? 'Paused' : 'Recording'} · {patient?.name ?? '—'}
        </span>
        <span className='text-[12px] text-muted'>Return</span>
      </motion.button>
    </motion.div>
  );
}

function SyncStatus({
  source,
  syncedAt,
  syncing,
  failed,
  onRefresh
}: {
  source: DataSource;
  syncedAt: number;
  syncing: boolean;
  failed: boolean;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (source === 'demo') {
    return (
      <p className='text-center text-[12px] text-faint'>
        Demo data · synthetic patients · set VITE_LUMEN_API_URL for the live queue
      </p>
    );
  }
  const ago = syncedAt ? Math.max(0, Math.round((now - syncedAt) / 1000)) : null;
  return (
    <div className='flex items-center justify-between text-[12px] text-muted'>
      <span>
        {failed
          ? 'Clinic server unreachable'
          : ago === null
            ? 'Connecting…'
            : `Synced ${ago < 2 ? 'just now' : `${ago}s ago`}`}
      </span>
      <motion.button
        type='button'
        onClick={onRefresh}
        whileTap={{ scale: 0.9 }}
        aria-label='Refresh the queue'
        className='grid size-8 place-items-center rounded-full border border-line-strong text-fg'
      >
        <IconRefresh size={15} className={cn(syncing && 'animate-spin')} />
      </motion.button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className='flex flex-col gap-3' aria-label='Loading the queue'>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className='h-[104px] animate-pulse rounded-[24px] border border-line bg-surface'
        />
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className='flex flex-col items-center py-16 text-center'>
      <div aria-hidden className='grid grid-cols-5 gap-1.5 opacity-40'>
        {Array.from({ length: 15 }, (_, i) => (
          <span key={i} className='size-1.5 rounded-full bg-fg' />
        ))}
      </div>
      <p className='mt-5 text-[16px] font-medium'>{title}</p>
      <p className='mt-1 max-w-[260px] text-[13px] text-muted'>{body}</p>
    </div>
  );
}
