import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BrowserWindow, dialog, shell } from "electron";
import type { BackupInfo } from "../shared/contract";
import { store } from "./db/store";
import { paths } from "./config";
import { getSettings } from "./settings";
import { sync } from "./sync/engine";
import { words } from "./i18n";
import { logger } from "./log";

const log = logger("backup");

/**
 * Copies of the desk's database, kept beside it and — when a folder is chosen
 * — a second time somewhere else (a USB stick, a shared drive).
 *
 * `VACUUM INTO` writes a consistent, compacted copy while the app keeps
 * working, so a backup never has to stop the desk. A backup is taken every
 * `backupEveryHours`, when the app quits, and before a restore replaces the
 * file (so a restore can itself be undone).
 *
 * ⚠️ A backup carries the outbox too. Restoring one that holds a ticket
 * "waiting to be created" which has since reached the server does not book it
 * twice: every ticket opened here carries its own mark on the server, and the
 * push adopts a marked ticket instead of booking it again.
 */

const NAME = /^desk-(\d{8}-\d{6})-([a-z]+)\.sqlite$/;

function stamp(date = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function info(file: string): BackupInfo | null {
  const name = path.basename(file);
  const match = NAME.exec(name);
  if (!match) return null;
  const stat = fs.statSync(file);
  return { name, path: file, size: stat.size, at: stat.mtime.toISOString(), reason: match[2] };
}

export function listBackups(): BackupInfo[] {
  return fs
    .readdirSync(paths.backups)
    .map((name) => info(path.join(paths.backups, name)))
    .filter((entry): entry is BackupInfo => entry !== null)
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

export function backupNow(reason: "auto" | "manual" | "quit" | "restore" = "manual"): BackupInfo {
  const file = path.join(paths.backups, `desk-${stamp()}-${reason}.sqlite`);
  store.copyTo(file);
  const mirror = getSettings().backupMirror;
  if (mirror) {
    try {
      fs.mkdirSync(mirror, { recursive: true });
      fs.copyFileSync(file, path.join(mirror, path.basename(file)));
    } catch (error) {
      log.warn(`mirror copy to ${mirror} failed`, error);
    }
  }
  prune();
  store.setMeta("lastBackup", new Date().toISOString());
  log.info(`backup ${path.basename(file)}`);
  return info(file)!;
}

function prune() {
  const keep = getSettings().backupKeep;
  for (const old of listBackups().slice(keep)) {
    fs.rmSync(old.path, { force: true });
  }
}

/** Checks a file really is this app's database before anything replaces the live one. */
function looksLikeDesk(file: string): boolean {
  try {
    const probe = new DatabaseSync(file, { readOnly: true });
    const tables = probe.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[];
    probe.close();
    const names = new Set(tables.map((row) => row.name));
    return ["tickets", "outbox", "meta", "refs"].every((name) => names.has(name));
  } catch {
    return false;
  }
}

async function confirmRestore(): Promise<boolean> {
  const window = BrowserWindow.getAllWindows()[0];
  const w = words();
  const options = {
    type: "warning" as const,
    title: w.restoreTitle,
    message: w.restoreTitle,
    detail: w.restoreBody,
    buttons: [w.restore, w.cancel],
    defaultId: 1,
    cancelId: 1,
  };
  const answer = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  return answer.response === 0;
}

function replaceWith(source: string) {
  backupNow("restore");
  const live = store.path;
  store.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(live + suffix, { force: true });
  fs.copyFileSync(source, live);
  store.reopen(live);
  sync.refreshCounts();
  sync.kick(0);
  log.info(`restored from ${path.basename(source)}`);
}

export async function restoreBackup(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = path.join(paths.backups, path.basename(name));
  if (!fs.existsSync(file) || !looksLikeDesk(file)) return { ok: false, error: "backup_invalid" };
  if (!(await confirmRestore())) return { ok: false, error: "cancelled" };
  replaceWith(file);
  return { ok: true };
}

export async function importBackup(): Promise<{ ok: true } | { ok: false; error: string }> {
  const window = BrowserWindow.getAllWindows()[0];
  const options = {
    properties: ["openFile" as const],
    filters: [{ name: words().importFilter, extensions: ["sqlite", "db"] }],
  };
  const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  const file = picked.filePaths[0];
  if (picked.canceled || !file) return { ok: false, error: "cancelled" };
  if (!looksLikeDesk(file)) return { ok: false, error: "backup_invalid" };
  if (!(await confirmRestore())) return { ok: false, error: "cancelled" };
  replaceWith(file);
  return { ok: true };
}

export async function exportBackup(): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const window = BrowserWindow.getAllWindows()[0];
  const options = {
    defaultPath: `al-esnad-desk-${stamp()}.sqlite`,
    filters: [{ name: words().importFilter, extensions: ["sqlite"] }],
  };
  const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (picked.canceled || !picked.filePath) return { ok: false, error: "cancelled" };
  store.copyTo(picked.filePath);
  return { ok: true, path: picked.filePath };
}

export async function chooseMirrorFolder(): Promise<string | null> {
  const window = BrowserWindow.getAllWindows()[0];
  const options = { properties: ["openDirectory" as const, "createDirectory" as const] };
  const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return picked.canceled ? null : (picked.filePaths[0] ?? null);
}

export function revealBackups() {
  void shell.openPath(paths.backups);
}

let timer: NodeJS.Timeout | null = null;

/** Takes the scheduled backup when it is due; checked every ten minutes. */
export function scheduleBackups() {
  if (timer) clearInterval(timer);
  const check = () => {
    const hours = getSettings().backupEveryHours;
    if (!hours) return;
    const last = store.meta("lastBackup");
    if (!last || Date.now() - Date.parse(last) >= hours * 3_600_000) {
      try {
        backupNow("auto");
      } catch (error) {
        log.error("scheduled backup failed", error);
      }
    }
  };
  check();
  timer = setInterval(check, 10 * 60_000);
}
