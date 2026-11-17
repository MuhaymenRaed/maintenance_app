import fs from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * The desk's password, as plain functions of the file it is kept in — what
 * `desk-lock.ts` wraps with this computer's own path and log. Kept apart, with
 * nothing but `node:` imports, so `test/desk-lock.test.mts` can run it without
 * Electron.
 *
 * Until somebody sets one, the default below opens it. The shop asked for
 * "something random and easy of 8 digits"; it is changed from the settings.
 */
export const DEFAULT_DESK_PASSWORD = "13572468";

/** Long enough not to be guessed in a few presses, short enough for a counter. */
export const DESK_PASSWORD_MIN = 6;
export const DESK_PASSWORD_MAX = 64;

type Stored = { salt: string; hash: string };

const KEY_LENGTH = 32;

function hash(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH);
}

/**
 * What is kept, or null when nothing usable is — never set, or a file that
 * is not ours. Either way the default opens the desk: this is a lock on the
 * app's own screens, and somebody able to delete a file in this account's
 * AppData can already do far more than read the figures.
 */
function read(file: string): Stored | null {
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Stored>;
    if (typeof stored.salt === "string" && typeof stored.hash === "string") return stored as Stored;
  } catch {
    // Never set.
  }
  return null;
}

/** True when `password` opens the desk. `report` hears a hash that would not compute. */
export function verifyAt(file: string, password: unknown, report?: (error: unknown) => void): boolean {
  if (typeof password !== "string" || !password) return false;
  const stored = read(file);
  if (!stored) return password === DEFAULT_DESK_PASSWORD;
  try {
    const expected = Buffer.from(stored.hash, "hex");
    const actual = hash(password, Buffer.from(stored.salt, "hex"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch (error) {
    report?.(error);
    return false;
  }
}

/**
 * Replaces the password. Asks for the current one even though the settings it
 * lives in are already behind it: a settings page left open is not a reason to
 * let whoever walks up change the lock. Only the salted hash is written.
 */
export function setAt(
  file: string,
  input: { current?: unknown; next?: unknown },
): { ok: true } | { ok: false; error: "wrong_password" | "weak_password" } {
  if (!verifyAt(file, input.current)) return { ok: false, error: "wrong_password" };
  const next = typeof input.next === "string" ? input.next.trim() : "";
  if (next.length < DESK_PASSWORD_MIN || next.length > DESK_PASSWORD_MAX) return { ok: false, error: "weak_password" };
  const salt = randomBytes(16);
  const stored: Stored = { salt: salt.toString("hex"), hash: hash(next, salt).toString("hex") };
  fs.writeFileSync(file, JSON.stringify(stored));
  return { ok: true };
}
