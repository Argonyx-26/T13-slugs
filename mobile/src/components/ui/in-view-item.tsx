// React Bits Animated List (reactbits.dev/components/animated-list): each row scales and
// fades in as it scrolls into the list's view, and back out as it leaves. Adapted to wrap
// any row; the first appearance is staggered by index.
import { motion } from 'motion/react';
import { useState, type ReactNode, type RefObject } from 'react';

interface InViewItemProps {
  children: ReactNode;
  /** The scrolling list, so "in view" means visible inside it */
  root: RefObject<HTMLElement | null>;
  index: number;
}

export function InViewItem({ children, root, index }: InViewItemProps) {
  const [entered, setEntered] = useState(false);

  return (
    <motion.div
      initial={{ scale: 0.82, opacity: 0 }}
      whileInView={{ scale: 1, opacity: 1 }}
      viewport={{ root: root as RefObject<Element>, amount: 0.3 }}
      onViewportEnter={() => setEntered(true)}
      transition={{ duration: 0.24, delay: entered ? 0 : Math.min(index, 10) * 0.035 }}
    >
      {children}
    </motion.div>
  );
}
