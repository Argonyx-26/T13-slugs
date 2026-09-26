import { App } from '@capacitor/app';
import { useEffect, useRef } from 'react';
import { isNative } from './platform';

// Android's back button (and Escape in the browser preview) goes to the most recently
// registered handler: an open sheet before the queue screen, the queue before the recorder.

type Handler = () => void;

const stack: { run: Handler }[] = [];

/** Register while `handler` is non-null; pass null to step aside. */
export function useBackHandler(handler: Handler | null) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  const enabled = handler !== null;
  useEffect(() => {
    if (!enabled) return;
    const entry = { run: () => latest.current?.() };
    stack.push(entry);
    return () => {
      stack.splice(stack.indexOf(entry), 1);
    };
  }, [enabled]);
}

function onBack() {
  const top = stack.at(-1);
  if (top) top.run();
  else if (isNative) App.minimizeApp().catch(() => {}); // like Home: the app stays alive
}

let installed = false;

export function installBackButton() {
  if (installed) return;
  installed = true;
  if (isNative) App.addListener('backButton', onBack).catch(() => {});
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onBack();
  });
}
