// React Bits Decrypted Text (reactbits.dev/text-animations/decrypted-text), trimmed to one
// behaviour: decrypt left to right once, on mount. Give it a `key` to replay it, e.g. when
// a new patient's code arrives.
import { useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

function scramble(text: string, revealed: number): string {
  return Array.from(text, (char, i) =>
    i < revealed || !/[a-z0-9]/i.test(char)
      ? char
      : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
  ).join('');
}

interface DecryptedTextProps {
  text: string;
  /** ms per scramble frame; each character takes two frames */
  speed?: number;
  className?: string;
}

export function DecryptedText({ text, speed = 55, className }: DecryptedTextProps) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(() => (reduceMotion ? text : scramble(text, 0)));

  useEffect(() => {
    if (reduceMotion) return;
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      const revealed = Math.floor(step / 2);
      setShown(scramble(text, revealed));
      if (revealed >= text.length) window.clearInterval(timer);
    }, speed);
    return () => window.clearInterval(timer);
  }, [text, speed, reduceMotion]);

  return (
    <span className={className}>
      <span className='sr-only'>{text}</span>
      <span aria-hidden>{reduceMotion ? text : shown}</span>
    </span>
  );
}
