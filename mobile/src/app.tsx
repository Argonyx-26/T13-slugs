import { AnimatePresence } from 'motion/react';
import { useEffect } from 'react';
import { Toaster } from '@/components/ui/toast';
import { useSession } from '@/data/session';
import { QueueScreen } from '@/features/queue/queue-screen';
import { RecorderScreen } from '@/features/recorder/recorder-screen';
import { installBackButton } from '@/lib/back-button';

export function App() {
  const { queueOpen, setQueueOpen } = useSession();

  useEffect(() => {
    installBackButton();
  }, []);

  return (
    // A size container: the recorder scales its clock and waveform to the phone's screen
    <div className='relative h-full w-full overflow-hidden bg-ink text-fg [container-type:size]'>
      {/* Always mounted: the recorder keeps running while the queue is open */}
      <RecorderScreen />
      <AnimatePresence>
        {queueOpen && <QueueScreen key='queue' onClose={() => setQueueOpen(false)} />}
      </AnimatePresence>
      <Toaster />
    </div>
  );
}
