'use client';

// Segmented level meter after 21st.dev "Energy Meter" (@thegridcn/energy-meter): lit segments
// fill one after another with a soft glow. Rebuilt on the site theme without the HUD frame.
import { motion, useInView } from 'motion/react';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

interface EnergyMeterProps {
  /** Lit segments, from the left */
  value: number;
  segments?: number;
  /** Any CSS colour */
  color: string;
  size?: 'sm' | 'md';
  label: string;
  className?: string;
}

export function EnergyMeter({
  value,
  segments = 10,
  color,
  size = 'md',
  label,
  className
}: EnergyMeterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20px' });

  return (
    <div
      ref={ref}
      role='img'
      aria-label={label}
      className={cn('flex w-full items-center gap-1', className)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn(
            'relative flex-1',
            size === 'sm' ? 'h-1.5 rounded-full' : 'h-2.5 rounded-md'
          )}
          style={{ background: `color-mix(in oklch, ${color} 16%, transparent)` }}
        >
          {i < value && (
            <motion.span
              className='absolute inset-0 origin-left rounded-[inherit]'
              style={{
                background: color,
                boxShadow:
                  size === 'md'
                    ? `0 0 10px color-mix(in oklch, ${color} 45%, transparent)`
                    : undefined
              }}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={inView ? { scaleX: 1, opacity: 1 } : undefined}
              transition={{
                delay: 0.1 + i * 0.14,
                type: 'spring',
                bounce: 0.2,
                visualDuration: 0.35
              }}
            />
          )}
        </span>
      ))}
    </div>
  );
}
