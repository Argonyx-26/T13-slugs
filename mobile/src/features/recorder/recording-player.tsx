import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '@/lib/format';
import type { Recording } from './engine/consultation-recorder';

/**
 * Plays the finished recording back. Progress uses the recorder's own duration: files
 * from MediaRecorder carry no duration header, so the audio element reports Infinity.
 */
export function RecordingPlayer({ recording }: { recording: Recording }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  useEffect(() => {
    const url = URL.createObjectURL(recording.blob);
    const el = new Audio(url);
    el.preload = 'auto';
    const onTime = () => setPositionMs(el.currentTime * 1000);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setPositionMs(0);
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    audio.current = el;
    return () => {
      el.pause();
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      audio.current = null;
      URL.revokeObjectURL(url);
    };
  }, [recording.blob]);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  const progress = Math.min(1, positionMs / Math.max(1, recording.durationMs));

  return (
    <div className='flex items-center gap-3 rounded-2xl border border-line bg-raised p-2.5 pr-4'>
      <motion.button
        type='button'
        onClick={toggle}
        whileTap={{ scale: 0.9 }}
        aria-label={playing ? 'Pause playback' : 'Play the recording'}
        className='grid size-10 shrink-0 place-items-center rounded-full bg-fg text-ink'
      >
        {playing ? <IconPlayerPauseFilled size={18} /> : <IconPlayerPlayFilled size={18} />}
      </motion.button>
      <div className='relative h-1 flex-1 overflow-hidden rounded-full bg-line'>
        <div
          className='absolute inset-y-0 left-0 rounded-full bg-signal'
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className='font-dot shrink-0 text-[13px] font-bold text-muted tabular-nums'>
        {formatDuration(playing || positionMs > 0 ? positionMs : recording.durationMs)}
      </span>
    </div>
  );
}
