import { paths } from "./config";
import { setAt, verifyAt } from "./desk-lock-core";
import { logger } from "./log";

const log = logger("lock");

/**
 * The desk's password — what the app asks before the ticket editor, the
 * figures and reports, and the settings (the shop's instruction of
 * 2026-11-17; the screens that ask are the site's `components/admin/desk-gate.tsx`).
 *
 * ---------------------------------------------------------------------------
 * What it is, and what it is not
 * ---------------------------------------------------------------------------
 * A lock on this app's own screens, for a counter PC several people use under
 * one account. It is not what decides what an account may read or write: the
 * database does that, whoever is at the keyboard. So it is kept the way a
 * local lock should be — a salted scrypt hash in `desk-lock.json`, never the
 * password itself — and checked here, in the main process, where the window
 * cannot read it. The logic is `desk-lock-core.ts`; this file only names the
 * file and the log.
 */
export { DEFAULT_DESK_PASSWORD } from "./desk-lock-core";

/** True when `password` opens the desk. */
export function verifyDeskPassword(password: unknown): boolean {
  return verifyAt(paths.lock, password, (error) => log.warn("the desk lock could not be checked", error));
}

/** Replaces the password; the current one must be given. */
export function setDeskPassword(input: { current?: unknown; next?: unknown }) {
  const result = setAt(paths.lock, input);
  if (result.ok) log.info("the desk password was changed");
  return result;
}
