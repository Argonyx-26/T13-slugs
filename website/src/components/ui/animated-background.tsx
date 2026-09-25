'use client';

// motion-primitives Animated Background (motion-primitives.com/c/animated-background), via 21st.dev
// "Animated Tabs". Controlled here (`value`) so the parent owns the selected item.
import { AnimatePresence, motion, type Transition } from 'motion/react';
import { Children, cloneElement, useId, type ReactElement } from 'react';
import { cn } from '@/lib/utils';

type Item = ReactElement<{ 'data-id': string; className?: string; children?: React.ReactNode }>;

export interface AnimatedBackgroundProps {
  children: Item[] | Item;
  value: string | null;
  onValueChange?: (id: string) => void;
  /** Classes for the sliding background */
  className?: string;
  transition?: Transition;
}

/** Slides one shared background between its children; each child needs a `data-id`. */
export function AnimatedBackground({
  children,
  value,
  onValueChange,
  className,
  transition
}: AnimatedBackgroundProps) {
  const uniqueId = useId();

  return Children.map(children, (child: Item) => {
    const id = child.props['data-id'];
    return cloneElement(
      child,
      {
        className: cn('relative inline-flex', child.props.className),
        'data-checked': value === id ? 'true' : 'false',
        onClick: () => onValueChange?.(id)
      } as Partial<Item['props']>,
      <>
        <AnimatePresence initial={false}>
          {value === id && (
            <motion.div
              layoutId={`background-${uniqueId}`}
              className={cn('absolute inset-0', className)}
              transition={transition}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>
        <span className='relative z-10 inline-flex items-center gap-1.5'>
          {child.props.children}
        </span>
      </>
    );
  });
}
