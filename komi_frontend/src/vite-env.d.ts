/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base del backend, sin barra final (por ejemplo, http://127.0.0.1:8000). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
