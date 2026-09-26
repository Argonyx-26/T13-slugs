import '@fontsource-variable/doto/full.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/globals.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { DeviceFrame } from './components/device-frame';
import { SessionProvider } from './data/session';
import { RecorderProvider } from './features/recorder/recorder-context';

const queryClient = new QueryClient();

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Honour the OS "reduce motion" setting across every animation */}
      <MotionConfig reducedMotion='user'>
        <RecorderProvider>
          <SessionProvider>
            <DeviceFrame>
              <App />
            </DeviceFrame>
          </SessionProvider>
        </RecorderProvider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>
);
