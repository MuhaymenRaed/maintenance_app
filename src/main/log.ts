import fs from "node:fs";
import path from "node:path";
import { paths } from "./config";

/**
 * One plain-text log, `logs/desk.log`, rotated at 2MB.
 *
 * Sync is the part of this app that fails quietly by nature — a refused write,
 * a dropped connection, a token that expired overnight — and the person who has
 * to answer "why didn't my change reach the dashboard?" is not at the desk when
 * it happened. Every pull, push and refusal is written here with its reason.
 */
const LIMIT = 2 * 1024 * 1024;

let file: string | null = null;

function target() {
  if (!file) file = path.join(paths.logs, "desk.log");
  return file;
}

function rotate(current: string) {
  try {
    if (fs.statSync(current).size < LIMIT) return;
    fs.renameSync(current, `${current}.1`);
  } catch {
    // No file yet, or it could not be moved: write on.
  }
}

function write(level: "info" | "warn" | "error", scope: string, message: string, extra?: unknown) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${
    extra === undefined ? "" : ` ${safe(extra)}`
  }\n`;
  if (level === "error") console.error(line.trimEnd());
  else console.log(line.trimEnd());
  try {
    const current = target();
    rotate(current);
    fs.appendFileSync(current, line);
  } catch {
    // Logging must never be the thing that breaks the app.
  }
}

function safe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function logger(scope: string) {
  return {
    info: (message: string, extra?: unknown) => write("info", scope, message, extra),
    warn: (message: string, extra?: unknown) => write("warn", scope, message, extra),
    error: (message: string, extra?: unknown) => write("error", scope, message, extra),
  };
}

export function logFile() {
  return target();
}
