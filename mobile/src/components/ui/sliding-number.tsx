// motion-primitives Sliding Number (motion-primitives.com/docs/sliding-number), via 21st.dev.
// Adapted for a running clock: a digit always rolls forward (9 → 0 rolls on instead of
// back through 8…1), and every column is 1em tall, so nothing needs measuring.
import { motion, useSpring, useTransform, type MotionValue } from 'motion/react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const SPRING = { stiffness: 280, damping: 18, mass: 0.3 };

function Digit({ digit }: { digit: number }) {
  const spring = useSpring(digit, SPRING);
  // Unbounded target: only ever grows, the transform below reads it modulo 10
  const state = useRef({ digit, target: digit });

  useEffect(() => {
    const s = state.current;
    if (digit === s.digit) return;
    s.target += (digit - s.digit + 10) % 10;
    s.digit = digit;
    spring.set(s.target);
  }, [digit, spring]);

  return (
    <span className='relative inline-block h-[1em] w-[1ch] overflow-y-clip leading-none tabular-nums'>
      <span className='invisible'>0</span>
      {Array.from({ length: 10 }, (_, n) => (
        <Numeral key={n} value={spring} n={n} />
      ))}
    </span>
  );
}

function Numeral({ value, n }: { value: MotionValue<number>; n: number }) {
  const y = useTransform(value, (latest) => {
    const offset = (((n - latest) % 10) + 10) % 10;
    return `${(offset > 5 ? offset - 10 : offset) * 100}%`;
  });
  return (
    <motion.span style={{ y }} className='absolute inset-0 flex items-center justify-center'>
      {n}
    </motion.span>
  );
}

interface SlidingNumberProps {
  value: number;
  /** Zero-pad to at least this many digits */
  minDigits?: number;
  className?: string;
}

/** Decorative: give the parent the accessible label. */
export function SlidingNumber({ value, minDigits = 1, className }: SlidingNumberProps) {
  const digits = String(Math.max(0, Math.floor(value)))
    .padStart(minDigits, '0')
    .split('');
  return (
    <span aria-hidden className={cn('inline-flex items-center', className)}>
      {digits.map((d, i) => (
        // Keyed by place value, so 9 → 10 keeps the units column's state
        <Digit key={digits.length - i} digit={Number(d)} />
      ))}
    </span>
  );
}
