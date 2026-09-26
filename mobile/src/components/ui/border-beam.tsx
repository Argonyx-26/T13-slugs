// Magic UI Border Beam (magicui.design/r/border-beam), via 21st.dev
import { motion, useReducedMotion, type MotionStyle, type Transition } from 'motion/react';
import { cn } from '@/lib/utils';

interface BorderBeamProps {
  /** Length of the beam, in px */
  size?: number;
  /** Seconds for one lap */
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  transition?: Transition;
  className?: string;
  style?: React.CSSProperties;
  reverse?: boolean;
  /** Starting position along the border (0-100) */
  initialOffset?: number;
  borderWidth?: number;
}

/** Place inside a `relative` element with a border radius; the beam follows its edge. */
export function BorderBeam({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = 'var(--primary)',
  colorTo = 'var(--primary)',
  transition,
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1
}: BorderBeamProps) {
  // A looping beam is decoration only; drop it for people who ask for less motion
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <div
      aria-hidden
      className='pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]'
      style={{ '--border-beam-width': `${borderWidth}px` } as React.CSSProperties}
    >
      <motion.div
        className={cn(
          'absolute aspect-square',
          'bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent',
          className
        )}
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            '--color-from': colorFrom,
            '--color-to': colorTo,
            ...style
          } as MotionStyle
        }
        initial={{ offsetDistance: `${initialOffset}%` }}
        animate={{
          offsetDistance: reverse
            ? [`${100 - initialOffset}%`, `${-initialOffset}%`]
            : [`${initialOffset}%`, `${100 + initialOffset}%`]
        }}
        transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay, ...transition }}
      />
    </div>
  );
}
