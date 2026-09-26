// The ONLY place that decides where the queue comes from (same switch as the website's
// features/patients/api/service.ts):
//   VITE_LUMEN_API_URL unset → bundled synthetic patients (demo-queue.ts)
//   VITE_LUMEN_API_URL set   → the orchestrator, and End uploads the recording

import { createLumenApi } from './api';
import type { DataSource } from './types';

const baseUrl = import.meta.env.VITE_LUMEN_API_URL?.trim();

export const liveApi = baseUrl
  ? createLumenApi({ baseUrl, apiKey: import.meta.env.VITE_LUMEN_API_KEY })
  : null;

export const dataSource: DataSource = liveApi ? 'fastapi' : 'demo';
