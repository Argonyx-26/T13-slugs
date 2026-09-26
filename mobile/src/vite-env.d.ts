/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Orchestrator (FastAPI) base URL. Unset = bundled demo queue. */
  readonly VITE_LUMEN_API_URL?: string;
  /** Sent as X-API-Key when the orchestrator sets API_KEY. */
  readonly VITE_LUMEN_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
