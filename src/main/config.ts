import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

/**
 * Where everything lives, and the values the build baked in.
 *
 * The Supabase URL and key are the dashboard's public ones — the same pair
 * every visitor's browser holds. What makes a write count is the desk account
 * signed in on top of them, so row-level security treats this app exactly as
 * it treats that account in a browser: no service key, no special door.
 */
export const SUPABASE_URL = import.meta.env.MAIN_VITE_SUPABASE_URL ?? "";
export const SUPABASE_KEY = import.meta.env.MAIN_VITE_SUPABASE_KEY ?? "";
export const DEFAULT_EMAIL = import.meta.env.MAIN_VITE_DESK_EMAIL ?? "";
export const DEFAULT_PASSWORD = import.meta.env.MAIN_VITE_DESK_PASSWORD ?? "";
export const DEFAULT_SITE_URL = import.meta.env.MAIN_VITE_SITE_URL ?? "https://alisnad.iq";

export const APP_ID = "iq.alisnad.maintenance";
export const SCHEME = "app";
export const PHOTO_SCHEME = "desk-photo";

function dir(...parts: string[]) {
  const full = path.join(app.getPath("userData"), ...parts);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

export const paths = {
  get data() {
    return dir("data");
  },
  get database() {
    return path.join(dir("data"), "desk.sqlite");
  },
  get backups() {
    return dir("backups");
  },
  get photos() {
    return dir("photos");
  },
  get logs() {
    return dir("logs");
  },
  get settings() {
    return path.join(app.getPath("userData"), "settings.json");
  },
  get account() {
    return path.join(app.getPath("userData"), "account.bin");
  },
  get session() {
    return path.join(app.getPath("userData"), "session.bin");
  },
  /** The print agent shipped with the app — next to the exe once packaged. */
  get printAgent() {
    return app.isPackaged
      ? path.join(process.resourcesPath, "print-agent")
      : path.join(app.getAppPath(), "resources", "print-agent");
  },
  get icon() {
    return app.isPackaged
      ? path.join(process.resourcesPath, "icon.png")
      : path.join(app.getAppPath(), "resources", "icon.png");
  },
};
