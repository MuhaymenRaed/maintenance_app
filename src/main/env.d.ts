/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_SUPABASE_URL?: string;
  readonly MAIN_VITE_SUPABASE_KEY?: string;
  readonly MAIN_VITE_DESK_EMAIL?: string;
  readonly MAIN_VITE_DESK_PASSWORD?: string;
  readonly MAIN_VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "electron-squirrel-startup" {
  const started: boolean;
  export default started;
}
