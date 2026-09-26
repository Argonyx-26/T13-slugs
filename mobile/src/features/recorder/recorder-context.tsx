import {
  createContext,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react';
import { ConsultationRecorder } from './engine/consultation-recorder';

const RecorderContext = createContext<ConsultationRecorder | null>(null);

/** Lives above both screens, so browsing the queue never interrupts a recording. */
export function RecorderProvider({ children }: { children: ReactNode }) {
  const [recorder] = useState(() => new ConsultationRecorder());

  // A backgrounded app loses the microphone (and a locked phone stops it), so pause
  // cleanly instead of recording silence; the recorder screen says why on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) recorder.pause(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [recorder]);

  return <RecorderContext value={recorder}>{children}</RecorderContext>;
}

export function useRecorder(): ConsultationRecorder {
  const recorder = use(RecorderContext);
  if (!recorder) throw new Error('useRecorder must be used inside <RecorderProvider>');
  return recorder;
}

export function useRecorderState() {
  const recorder = useRecorder();
  return useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);
}

/** Whole seconds recorded; re-renders only when the shown second changes. */
export function useElapsedSeconds(): number {
  const recorder = useRecorder();
  // Every state change (pause, stop, reset to 00:00) re-reads the clock, not just status changes
  const snapshot = useRecorderState();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const read = () => setSeconds(Math.floor(recorder.elapsedMs() / 1000));
    read();
    if (snapshot.status !== 'recording') return;
    let frame = 0;
    const loop = () => {
      read();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [recorder, snapshot]);

  return seconds;
}
