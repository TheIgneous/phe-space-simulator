/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute URL of a shared, CI-published snapshot.json to fetch at runtime. Point every app at
   * the same URL to update them all from one place. Defaults to the same-origin `./snapshot.json`.
   */
  readonly VITE_SNAPSHOT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
