// ElevenLabs UI Live Waveform (ui.elevenlabs.io/docs/components/live-waveform), scrolling
// mode, redrawn in Nothing's dot-matrix style: every bar is a column of dots, the newest
// audio enters at a red centre playhead and scrolls left. It reads the recorder's level
// history instead of opening a second microphone stream.
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { LEVEL_SAMPLE_MS, type RecorderStatus } from './engine/consultation-recorder';
import type { LevelHistory } from './engine/level';

const PITCH = 6; // px between dot centres, across and down
const DOT = 2.6; // dot diameter, px
const EDGE_FADE = 56; // px over which dots fade out at both sides

interface LiveWaveformProps {
  levels: LevelHistory;
  status: RecorderStatus;
  /** Skip drawing while hidden behind another screen */
  visible?: boolean;
  className?: string;
}

export function LiveWaveform({ levels, status, visible = true, className }: LiveWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ status, visible });

  useEffect(() => {
    live.current = { status, visible };
  }, [status, visible]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!container || !canvas || !ctx) return;

    const css = getComputedStyle(container);
    const fg = css.getPropertyValue('--color-fg').trim() || '#f4f4f4';
    const signal = css.getPropertyValue('--color-signal').trim() || '#d71921';

    let width = 0;
    let height = 0;
    let dpr = 1;
    let dot: HTMLCanvasElement | null = null;
    let dotSize = 0;

    // One pre-rendered dot, stamped with drawImage: far cheaper than an arc per dot
    const makeDot = () => {
      const px = Math.ceil(DOT * dpr) + 2;
      const sprite = document.createElement('canvas');
      sprite.width = sprite.height = px;
      const s = sprite.getContext('2d');
      if (s) {
        s.fillStyle = fg;
        s.beginPath();
        s.arc(px / 2, px / 2, (DOT * dpr) / 2, 0, Math.PI * 2);
        s.fill();
      }
      dot = sprite;
      dotSize = px / dpr;
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      // Layout size, not getBoundingClientRect: unaffected by transforms on ancestors
      width = container.clientWidth;
      height = container.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      makeDot();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const stamp = (x: number, y: number, alpha: number) => {
      if (!dot || alpha <= 0.01) return;
      const edge = Math.min(1, Math.min(x, width - x) / EDGE_FADE);
      if (edge <= 0) return;
      ctx.globalAlpha = alpha * edge;
      ctx.drawImage(dot, x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
    };

    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const { status, visible } = live.current;
      if (!visible || width === 0) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cx = Math.round(width / 2);
      const cy = height / 2;
      const maxRows = Math.max(1, Math.floor((height / 2 - DOT) / PITCH));
      const recording = status === 'recording';
      const hasAudio = levels.length > 0;

      if (hasAudio) {
        // Between samples everything glides left, so the scroll is continuous
        const scroll =
          recording && levels.lastPushAt
            ? Math.min(1, (now - levels.lastPushAt) / LEVEL_SAMPLE_MS) * PITCH
            : 0;
        const alpha = recording ? 1 : 0.42;
        for (let i = 0; ; i++) {
          const x = cx - i * PITCH - scroll;
          if (x < 0) break;
          const level = levels.fromNewest(i);
          if (level === undefined) {
            stamp(x, cy, 0.16);
            continue;
          }
          const rows = Math.round(level * maxRows);
          stamp(x, cy, alpha);
          for (let r = 1; r <= rows; r++) {
            const a = alpha * (1 - (r / (maxRows + 1)) * 0.35); // tips slightly softer
            stamp(x, cy - r * PITCH, a);
            stamp(x, cy + r * PITCH, a);
          }
        }
        // Not recorded yet: a faint dotted track to the right of the playhead
        for (let x = cx + PITCH; x < width; x += PITCH) stamp(x, cy, 0.16);
      } else {
        // Waiting to record: a slow breathing wave along the dotted baseline
        const t = now / 1000;
        for (let x = cx % PITCH; x < width; x += PITCH) {
          const k = x / PITCH;
          const swell = Math.max(0, Math.sin(t * 1.4 - k * 0.32)) ** 3;
          const rows = Math.round(swell * 1.6);
          stamp(x, cy, 0.22 + swell * 0.25);
          for (let r = 1; r <= rows; r++) {
            stamp(x, cy - r * PITCH, 0.2);
            stamp(x, cy + r * PITCH, 0.2);
          }
        }
      }

      // Red playhead with a marker dot, like the Nothing recorder
      const reach = maxRows * PITCH + 8;
      ctx.globalAlpha = recording ? 1 : hasAudio ? 0.65 : 0.4;
      ctx.fillStyle = signal;
      ctx.fillRect(cx - 0.75, cy - reach, 1.5, reach * 2);
      ctx.beginPath();
      ctx.arc(cx, cy - reach, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [levels]);

  return (
    <div
      ref={containerRef}
      role='img'
      aria-label={
        status === 'recording'
          ? 'Live audio waveform'
          : status === 'paused'
            ? 'Waveform, recording paused'
            : 'Waveform idle'
      }
      className={cn('relative h-[152px] w-full', className)}
    >
      <canvas ref={canvasRef} aria-hidden className='block h-full w-full' />
    </div>
  );
}
