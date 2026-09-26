import { useQuery, type QueryClient } from '@tanstack/react-query';
import { createContext, use, useMemo, useState, type ReactNode } from 'react';
import { selectCurrentPatient } from './current-patient';
import { demoQueue } from './demo-queue';
import { dataSource, liveApi } from './source';
import type { DataSource, QueuePatient } from './types';

export const QUEUE_KEY = ['queue', 'today'] as const;

const EMPTY: QueuePatient[] = [];

/** Mark a visit seen in the cached queue at once (the orchestrator does the same on upload) */
export function markSeen(client: QueryClient, visitId: string) {
  client.setQueryData<QueuePatient[]>(QUEUE_KEY, (rows) =>
    rows?.map((r) => (r.visitId === visitId ? { ...r, status: 'seen' } : r))
  );
}

interface Session {
  queue: QueuePatient[];
  queueState: 'loading' | 'error' | 'ready';
  queueError: string | null;
  /** When the queue was last fetched (ms since epoch) */
  syncedAt: number;
  isSyncing: boolean;
  refetchQueue: () => void;
  source: DataSource;
  /** The patient about to come in, or being recorded */
  current: QueuePatient | null;
  pin: (patient: QueuePatient) => void;
  unpin: () => void;
  queueOpen: boolean;
  setQueueOpen: (open: boolean) => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: () => (liveApi ? liveApi.todaysQueue() : Promise.resolve(demoQueue())),
    // The demo queue is there from the first frame, with no loading flash
    initialData: liveApi ? undefined : demoQueue,
    // Live: the reception desk keeps changing the queue, so keep polling it
    refetchInterval: liveApi ? 10_000 : false,
    staleTime: liveApi ? 5_000 : Infinity,
    retry: liveApi ? 2 : false
  });
  const [pinned, setPinned] = useState<QueuePatient | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);

  const queue = query.data ?? EMPTY;
  const { refetch } = query;
  const value = useMemo<Session>(
    () => ({
      queue,
      queueState: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
      queueError: query.error?.message ?? null,
      syncedAt: query.dataUpdatedAt,
      isSyncing: query.isFetching,
      refetchQueue: () => void refetch(),
      source: dataSource,
      current: selectCurrentPatient(queue, pinned),
      pin: setPinned,
      unpin: () => setPinned(null),
      queueOpen,
      setQueueOpen
    }),
    [
      queue,
      query.isPending,
      query.isError,
      query.error,
      query.dataUpdatedAt,
      query.isFetching,
      refetch,
      pinned,
      queueOpen
    ]
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}
