import { SlidingNumber } from '@/components/ui/sliding-number';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useElapsedSeconds, useRecorderState } from './recorder-context';

/** The big dot-matrix clock. Digits roll on each second; the whole clock blinks when paused. */
export function DotTimer() {
  const seconds = useElapsedSeconds();
  const { status } = useRecorderState();
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const blank = seconds === 0 && status !== 'recording';

  return (
    <div
      role='timer'
      aria-label={`Recorded ${formatDuration(seconds * 1000)}`}
      className={cn(
        'font-dot flex items-center leading-none font-extrabold transition-colors duration-500',
        // Sized to the screen (the app root is a size container), capped at the 412 × 915 design
        hours > 0 ? 'text-[length:min(7.2cqh,16cqw,66px)]' : 'text-[length:min(10cqh,22cqw,92px)]',
        blank ? 'text-faint' : 'text-fg',
        status === 'paused' && 'animate-blink'
      )}
    >
      {hours > 0 && (
        <>
          <SlidingNumber value={hours} />
          <Colon />
        </>
      )}
      <SlidingNumber value={minutes} minDigits={2} />
      <Colon blinking={status === 'recording'} />
      <SlidingNumber value={secs} minDigits={2} />
    </div>
  );
}

function Colon({ blinking = false }: { blinking?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('mx-[0.04em] -translate-y-[0.05em]', blinking && 'animate-blink')}
    >
      :
    </span>
  );
}
