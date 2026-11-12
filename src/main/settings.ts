import fs from "node:fs";
import { EventEmitter } from "node:events";
import { app, safeStorage } from "electron";
import { DEFAULT_SETTINGS, type AppSettings } from "../shared/contract";
import { DEFAULT_EMAIL, DEFAULT_PASSWORD, DEFAULT_SITE_URL, paths } from "./config";
import { logger } from "./log";

const log = logger("settings");

/**
 * The app's preferences (a JSON file) and the desk account (an encrypted one).
 *
 * The account is kept apart because it is the one secret on this computer.
 * `safeStorage` encrypts it with Windows' own data protection, tied to this
 * user on this machine — a copy of `account.bin` taken to another PC cannot be
 * read. If the OS offers no encryption the file is still written, so the desk
 * keeps working, and the log says so.
 */
export const settingsEvents = new EventEmitter();

let current: AppSettings | null = null;

const clamp = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

function clean(input: Partial<AppSettings>): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, siteUrl: DEFAULT_SITE_URL, ...input };
  return {
    ...merged,
    locale: merged.locale === "en" ? "en" : "ar",
    theme: merged.theme === "dark" || merged.theme === "system" ? merged.theme : "light",
    fontScale: clamp(Number(merged.fontScale), 0.8, 1.35, 1),
    service: merged.service === "software" ? "software" : "hardware",
    syncIntervalSec: Math.round(clamp(Number(merged.syncIntervalSec), 5, 600, 15)),
    backupEveryHours: Math.round(clamp(Number(merged.backupEveryHours), 0, 168, 6)),
    backupKeep: Math.round(clamp(Number(merged.backupKeep), 3, 500, 30)),
    siteUrl: /^https?:\/\/[^\s]+$/.test(String(merged.siteUrl)) ? String(merged.siteUrl).replace(/\/+$/, "") : DEFAULT_SITE_URL,
    backupMirror: merged.backupMirror ? String(merged.backupMirror) : null,
  };
}

export function getSettings(): AppSettings {
  if (current) return current;
  try {
    current = clean(JSON.parse(fs.readFileSync(paths.settings, "utf8")) as Partial<AppSettings>);
  } catch {
    current = clean({});
  }
  return current;
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = clean({ ...getSettings(), ...patch });
  current = next;
  fs.writeFileSync(paths.settings, JSON.stringify(next, null, 2));
  if (patch.startWithWindows !== undefined || patch.startMinimized !== undefined) applyLoginItem(next);
  settingsEvents.emit("change", next);
  return next;
}

export function applyLoginItem(settings = getSettings()) {
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.startWithWindows,
      args: settings.startMinimized ? ["--hidden"] : [],
    });
  } catch (error) {
    log.warn("could not change the login item", error);
  }
}

/* ── The account ──────────────────────────────────────────────────────── */

export type StoredAccount = { email: string; password: string };

function seal(text: string): Buffer {
  if (safeStorage.isEncryptionAvailable()) return Buffer.concat([Buffer.from("E1"), safeStorage.encryptString(text)]);
  log.warn("OS encryption is not available; the account file is stored unencrypted");
  return Buffer.concat([Buffer.from("P1"), Buffer.from(text, "utf8")]);
}

function unseal(buffer: Buffer): string {
  const tag = buffer.subarray(0, 2).toString();
  const body = buffer.subarray(2);
  if (tag === "E1") return safeStorage.decryptString(body);
  if (tag === "P1") return body.toString("utf8");
  throw new Error("unknown account file format");
}

export function readSealed(file: string): string | null {
  try {
    return unseal(fs.readFileSync(file));
  } catch {
    return null;
  }
}

export function writeSealed(file: string, text: string | null) {
  if (text === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.writeFileSync(file, seal(text));
}

/** The account the desk signs in as — the one saved here, else the build's. */
export function getAccount(): StoredAccount {
  const saved = readSealed(paths.account);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as StoredAccount;
      if (parsed.email && parsed.password) return parsed;
    } catch {
      // Fall through to the build's account.
    }
  }
  return { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD };
}

export function saveAccount(account: StoredAccount) {
  writeSealed(paths.account, JSON.stringify(account));
}
