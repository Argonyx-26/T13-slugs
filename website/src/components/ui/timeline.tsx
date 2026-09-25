'use client';

// Aceternity UI Timeline (ui.aceternity.com/registry/timeline), via 21st.dev.
// Compacted for use inside a page column, themed, and the demo heading removed.
import { motion, useScroll, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

export interface TimelineEntry {
  id: string;
  title: string;
  content: React.ReactNode;
  /** Replaces the default dot on the line */
  marker?: React.ReactNode;
}

/** Vertical timeline with sticky titles; a beam fills the line as the page scrolls past it. */
export function Timeline({ data }: { data: TimelineEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.getBoundingClientRect().height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 40%', 'end 60%'] });
  const beamHeight = useTransform(scrollYProgress, [0, 1], [0, height]);
  const beamOpacity = useTransform(scrollYProgress, [0, 0.1], [0, 1]);

  return (
    <div ref={ref} className='relative'>
      {data.map((item) => (
        <div key={item.id} className='flex justify-start pt-6 first:pt-0 md:gap-6'>
          <div className='sticky top-[calc(var(--header-height)+1rem)] z-10 flex min-h-7 w-7 shrink-0 items-center self-start md:w-40'>
            <div className='bg-background absolute left-0 flex size-7 items-center justify-center rounded-full'>
              {item.marker ?? <div className='bg-muted size-3 rounded-full border' />}
            </div>
            <h3 className='text-muted-foreground hidden pl-10 text-sm font-semibold tracking-tight md:block'>
              {item.title}
            </h3>
          </div>
          <div className='relative w-full min-w-0 pl-3 md:pl-0'>
            <h3 className='text-muted-foreground mb-1 text-sm font-semibold tracking-tight md:hidden'>
              {item.title}
            </h3>
            {item.content}
          </div>
        </div>
      ))}
      <div
        aria-hidden
        style={{ height }}
        className='via-border absolute top-0 left-[13px] w-[2px] overflow-hidden bg-linear-to-b from-transparent to-transparent mask-[linear-gradient(to_bottom,transparent_0%,black_8%,black_92%,transparent_100%)]'
      >
        <motion.div
          style={{ height: beamHeight, opacity: beamOpacity }}
          className='from-primary via-primary/50 absolute inset-x-0 top-0 w-[2px] rounded-full bg-linear-to-t to-transparent'
        />
      </div>
    </div>
  );
}
