'use client';

// Aceternity UI Glowing Effect (ui.aceternity.com/registry/glowing-effect), via 21st.dev.
// Recoloured from the original rainbow gradient to one theme colour (`color`).
import { animate } from 'motion/react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface GlowingEffectProps {
  /** Any CSS colour; defaults to the theme's primary */
  color?: string;
  blur?: number;
  /** Fraction of the card's centre where the glow switches off */
  inactiveZone?: number;
  /** How far outside the card, in px, the pointer still lights the edge */
  proximity?: number;
  /** Arc of the lit edge, in degrees either side of the pointer */
  spread?: number;
  className?: string;
  disabled?: boolean;
  movementDuration?: number;
  borderWidth?: number;
}

/** Place inside a `relative` element with a border radius; its edge lights up towards the pointer. */
export const GlowingEffect = memo(function GlowingEffect({
  color = 'var(--primary)',
  blur = 0,
  inactiveZone = 0.7,
  proximity = 0,
  spread = 20,
  className,
  movementDuration = 2,
  borderWidth = 1,
  disabled = false
}: GlowingEffectProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastPosition = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number>(0);

  const handleMove = useCallback(
    (e?: MouseEvent | { x: number; y: number }) => {
      if (!containerRef.current) return;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

      animationFrameRef.current = requestAnimationFrame(() => {
        const element = containerRef.current;
        if (!element) return;

        const { left, top, width, height } = element.getBoundingClientRect();
        const mouseX = e?.x ?? lastPosition.current.x;
        const mouseY = e?.y ?? lastPosition.current.y;
        if (e) lastPosition.current = { x: mouseX, y: mouseY };

        const center = [left + width * 0.5, top + height * 0.5];
        const distanceFromCenter = Math.hypot(mouseX - center[0], mouseY - center[1]);
        const inactiveRadius = 0.5 * Math.min(width, height) * inactiveZone;
        if (distanceFromCenter < inactiveRadius) {
          element.style.setProperty('--active', '0');
          return;
        }

        const isActive =
          mouseX > left - proximity &&
          mouseX < left + width + proximity &&
          mouseY > top - proximity &&
          mouseY < top + height + proximity;
        element.style.setProperty('--active', isActive ? '1' : '0');
        if (!isActive) return;

        const currentAngle = parseFloat(element.style.getPropertyValue('--start')) || 0;
        const targetAngle =
          (180 * Math.atan2(mouseY - center[1], mouseX - center[0])) / Math.PI + 90;
        const angleDiff = ((targetAngle - currentAngle + 180) % 360) - 180;

        animate(currentAngle, currentAngle + angleDiff, {
          duration: movementDuration,
          ease: [0.16, 1, 0.3, 1],
          onUpdate: (value) => element.style.setProperty('--start', String(value))
        });
      });
    },
    [inactiveZone, proximity, movementDuration]
  );

  useEffect(() => {
    if (disabled) return;
    const handleScroll = () => handleMove();
    const handlePointerMove = (e: PointerEvent) => handleMove(e);
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.body.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener('scroll', handleScroll);
      document.body.removeEventListener('pointermove', handlePointerMove);
    };
  }, [handleMove, disabled]);

  if (disabled) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden
      style={
        {
          '--blur': `${blur}px`,
          '--spread': spread,
          '--start': '0',
          '--active': '0',
          '--glowingeffect-border-width': `${borderWidth}px`,
          '--gradient': `radial-gradient(circle, ${color} 10%, transparent 20%),
            repeating-conic-gradient(from 236.84deg at 50% 50%, ${color} 0%, color-mix(in oklch, ${color} 35%, transparent) 10%, ${color} 20%)`
        } as React.CSSProperties
      }
      className={cn(
        'pointer-events-none absolute inset-0 rounded-[inherit]',
        blur > 0 && 'blur-(--blur)',
        className
      )}
    >
      <div
        className={cn(
          'rounded-[inherit]',
          'after:absolute after:inset-[calc(-1*var(--glowingeffect-border-width))] after:rounded-[inherit] after:content-[""]',
          'after:[border:var(--glowingeffect-border-width)_solid_transparent]',
          'after:[background:var(--gradient)] after:[background-attachment:fixed]',
          'after:opacity-(--active) after:transition-opacity after:duration-300',
          'after:[mask-clip:padding-box,border-box]',
          'after:[mask-composite:intersect]',
          'after:[mask-image:linear-gradient(#0000,#0000),conic-gradient(from_calc((var(--start)-var(--spread))*1deg),#00000000_0deg,#fff,#00000000_calc(var(--spread)*2deg))]'
        )}
      />
    </div>
  );
});
