/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev`       → http://localhost:5173 (the design-review preview)
// `npm run dev:phone` → https on the LAN, so a phone's Chrome allows the microphone
export default defineConfig(({ mode }) => {
  const phone = mode === 'phone';
  return {
    plugins: [react(), tailwindcss(), ...(phone ? [basicSsl()] : [])],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
    },
    server: { port: 5173, strictPort: true, host: phone ? true : 'localhost' },
    test: { include: ['src/**/*.test.ts'] }
  };
});
