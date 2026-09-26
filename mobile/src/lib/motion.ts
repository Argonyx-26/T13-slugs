import type { Transition } from 'motion/react';

/** Buttons, badges, small movements */
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 32 };

/** The queue button growing into the Live Queue screen and back */
export const MORPH: Transition = { type: 'spring', stiffness: 300, damping: 34 };

/** Layout id shared by the queue button and the Live Queue screen's surface */
export const QUEUE_SURFACE = 'queue-surface';
