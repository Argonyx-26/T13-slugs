// Magic UI Blur Fade (magicui.design/r/blur-fade), via 21st.dev
import { useRef } from 'react';
import {
  motion,
  useInView,
  type MotionProps,
  type UseInViewOptions,
  type Variants
} from 'motion/react';

type MarginType = UseInViewOptions['margin'];

interface BlurFadeProps extends MotionProps {
  children: React.ReactNode;
  className?: string;
  duration?: number;
  delay?: number;
  offset?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Wait until the element scrolls into view before animating */
  inView?: boolean;
  inViewMargin?: MarginType;
  blur?: string;
}

export function BlurFade({
  children,
  className,
  duration = 0.4,
  delay = 0,
  offset = 6,
  direction = 'down',
  inView = false,
  inViewMargin = '-50px',
  blur = '6px',
  ...props
}: BlurFadeProps) {
  const ref = useRef(null);
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin });
  const isInView = !inView || inViewResult;
  const axis = direction === 'left' || direction === 'right' ? 'x' : 'y';
  const variants: Variants = {
    hidden: {
      [axis]: direction === 'right' || direction === 'down' ? -offset : offset,
      opacity: 0,
      filter: `blur(${blur})`
    },
    visible: { [axis]: 0, opacity: 1, filter: 'blur(0px)' }
  };

  return (
    <motion.div
      ref={ref}
      initial='hidden'
      animate={isInView ? 'visible' : 'hidden'}
      variants={variants}
      transition={{ delay: 0.04 + delay, duration, ease: 'easeOut' }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
