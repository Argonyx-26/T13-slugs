'use client';

// Spring-animated accordion after 21st.dev "Accordion" (@ddoemonn/accordion): single or multiple
// open panels, spring height to the measured content, arrow-key navigation between headers.
import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useId, useState } from 'react';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

const SPRING = { type: 'spring', bounce: 0.12, visualDuration: 0.38 } as const;

interface RootContext {
  isOpen: (value: string) => boolean;
  toggle: (value: string) => void;
}
const AccordionContext = createContext<RootContext | null>(null);

interface ItemContext {
  value: string;
  open: boolean;
  triggerId: string;
  panelId: string;
}
const ItemContext = createContext<ItemContext | null>(null);

/** Arrow keys, Home and End move focus between the headers of the same accordion. */
function focusSiblingTrigger(e: React.KeyboardEvent<HTMLButtonElement>) {
  const root = e.currentTarget.closest('[data-accordion-root]');
  const triggers = [...(root?.querySelectorAll<HTMLButtonElement>('[data-accordion-trigger]') ?? [])];
  const index = triggers.indexOf(e.currentTarget);
  const next = {
    ArrowDown: triggers[(index + 1) % triggers.length],
    ArrowUp: triggers[(index - 1 + triggers.length) % triggers.length],
    Home: triggers[0],
    End: triggers[triggers.length - 1]
  }[e.key];
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

function useRoot() {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error('AccordionSpring parts must be inside <AccordionSpring>');
  return ctx;
}
function useItem() {
  const ctx = useContext(ItemContext);
  if (!ctx) throw new Error('AccordionSpringTrigger/Content must be inside <AccordionSpringItem>');
  return ctx;
}

interface AccordionSpringProps {
  /** `single` closes the open panel when another opens */
  type?: 'single' | 'multiple';
  defaultValue?: string[];
  className?: string;
  children: React.ReactNode;
}

export function AccordionSpring({
  type = 'multiple',
  defaultValue = [],
  className,
  children
}: AccordionSpringProps) {
  const [open, setOpen] = useState<string[]>(defaultValue);

  const isOpen = useCallback((value: string) => open.includes(value), [open]);
  const toggle = useCallback(
    (value: string) =>
      setOpen((prev) =>
        prev.includes(value)
          ? prev.filter((v) => v !== value)
          : type === 'single'
            ? [value]
            : [...prev, value]
      ),
    [type]
  );

  return (
    <AccordionContext.Provider value={{ isOpen, toggle }}>
      <div data-accordion-root className={cn('flex flex-col', className)}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

export function AccordionSpringItem({
  value,
  className,
  style,
  children
}: {
  value: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { isOpen } = useRoot();
  const id = useId();
  const open = isOpen(value);
  return (
    <ItemContext.Provider
      value={{ value, open, triggerId: `${id}-trigger`, panelId: `${id}-panel` }}
    >
      <div data-state={open ? 'open' : 'closed'} className={className} style={style}>
        {children}
      </div>
    </ItemContext.Provider>
  );
}

export function AccordionSpringTrigger({
  className,
  children
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { toggle } = useRoot();
  const { value, open, triggerId, panelId } = useItem();
  return (
    <button
      type='button'
      id={triggerId}
      data-accordion-trigger
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => toggle(value)}
      onKeyDown={focusSiblingTrigger}
      className={cn(
        'focus-visible:ring-ring/50 flex w-full items-center gap-3 rounded-[inherit] text-left outline-none focus-visible:ring-[3px]',
        className
      )}
    >
      <span className='min-w-0 flex-1'>{children}</span>
      <motion.span
        animate={{ rotate: open ? 180 : 0 }}
        transition={SPRING}
        className='text-muted-foreground shrink-0'
      >
        <Icons.chevronDown className='size-4' aria-hidden />
      </motion.span>
    </button>
  );
}

export function AccordionSpringContent({
  className,
  children
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { open, triggerId, panelId } = useItem();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          id={panelId}
          role='region'
          aria-labelledby={triggerId}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ height: SPRING, opacity: { duration: 0.2 } }}
          className='overflow-hidden'
        >
          <div className={className}>{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
