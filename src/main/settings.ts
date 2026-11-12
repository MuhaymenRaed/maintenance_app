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

/*
 * ⚠️ Decrypted once, at start-up, and served from memory after that.
 *
 * Electron 45 deprecated the synchronous `safeStorage` calls in favour of
 * `encryptStringAsync` / `decryptStringAsync`, and the account and the session
 * are read synchronously in a dozen places — the IPC account answer, the sync
 * engine's status, supabase-js' storage adapter. Rather than turning every one
 * of those async, the two files are decrypted by `loadSecrets()` before the
 * window or the sync engine starts (`main.ts`), reads come from the copy in
 * memory, and every write updates that copy at once and is persisted in order
 * on a chain behind it. Files written by the old synchronous API are read by
 * the new one — Electron documents that — and re-sealed when it says so.
 */
const sealed = new Map<string, string | null>();
let writes: Promise<void> = Promise.resolve();

async function seal(text: string): Promise<Buffer> {
  if (await safeStorage.isAsyncEncryptionAvailable()) {
    return Buffer.concat([Buffer.from("E1"), await safeStorage.encryptStringAsync(text)]);
  }
  log.warn("OS encryption is not available; the account file is stored unencrypted");
  return Buffer.concat([Buffer.from("P1"), Buffer.from(text, "utf8")]);
}

async function unseal(buffer: Buffer): Promise<{ text: string; reseal: boolean }> {
  const tag = buffer.subarray(0, 2).toString();
  const body = buffer.subarray(2);
  if (tag === "E1") {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(body);
    return { text: result, reseal: shouldReEncrypt };
  }
  if (tag === "P1") return { text: body.toString("utf8"), reseal: false };
  throw new Error("unknown account file format");
}

/** Decrypts the sealed files into memory. Awaited once, before anything reads them. */
export async function loadSecrets(files: string[] = [paths.account, paths.session]) {
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) {
        sealed.set(file, null);
        continue;
      }
      const { text, reseal } = await unseal(fs.readFileSync(file));
      sealed.set(file, text);
      if (reseal) writeSealed(file, text);
    } catch (error) {
      // An unreadable file — another user's, another machine's — is treated as
      // absent: the desk falls back to the build's account and signs in again.
      log.warn(`could not read ${file}; starting without it`, error);
      sealed.set(file, null);
    }
  }
}

export function readSealed(file: string): string | null {
  return sealed.get(file) ?? null;
}

/** Updates the copy in memory now; resolves once the file on disk agrees. */
export function writeSealed(file: string, text: string | null): Promise<void> {
  sealed.set(file, text);
  writes = writes
    .then(async () => {
      if (text === null) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, await seal(text));
    })
    .catch((error) => log.error(`could not write ${file}`, error));
  return writes;
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

export function saveAccount(account: StoredAccount): Promise<void> {
  return writeSealed(paths.account, JSON.stringify(account));
}
