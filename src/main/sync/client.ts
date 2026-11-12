import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, paths } from "../config";
import { getAccount, readSealed, writeSealed } from "../settings";
import { logger } from "../log";

const log = logger("auth");

/**
 * The one Supabase client, in the main process only.
 *
 * It signs in **as the repair desk's own account** with that account's
 * password, so every write this app makes is that account's write: row-level
 * security, the desk guard trigger and the staff trail all see the same
 * account they would see in a browser on the dashboard. The window never holds
 * a token; it cannot reach the database at all except through the main
 * process.
 *
 * The session lives in `session.bin`, encrypted by the OS like the account
 * itself, so a restart does not sign in again and the desk works the moment it
 * opens — online or not.
 */

/** Every request gives up after this long. A dropped line must not hang a sync. */
const REQUEST_TIMEOUT_MS = 25_000;

function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("request timed out")), REQUEST_TIMEOUT_MS);
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const sessionFile = {
  read(): Record<string, string> {
    const text = readSealed(paths.session);
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, string>;
    } catch {
      return {};
    }
  },
  write(map: Record<string, string>) {
    writeSealed(paths.session, Object.keys(map).length ? JSON.stringify(map) : null);
  },
};

const storage = {
  getItem: (key: string) => sessionFile.read()[key] ?? null,
  setItem: (key: string, value: string) => {
    const map = sessionFile.read();
    map[key] = value;
    sessionFile.write(map);
  },
  removeItem: (key: string) => {
    const map = sessionFile.read();
    delete map[key];
    sessionFile.write(map);
  },
};

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) return client;
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("The build has no Supabase URL or key (.env)");
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storage,
      storageKey: "al-esnad-desk",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: { fetch: timedFetch, headers: { "x-client-info": "al-esnad-maintenance-desktop" } },
  });
  return client;
}

/* ── Why something failed ─────────────────────────────────────────────── */

export type FailureKind = "network" | "auth" | "refused" | "server";

export class SyncFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SyncFailure";
  }
}

type PostgrestLike = { error: { code?: string; message?: string; details?: string } | null; status?: number };

/**
 * A PostgREST answer, turned into "fine" or a `SyncFailure` that says what to
 * do about it:
 *
 * - **network** — status 0, a timeout, a 408/429/5xx: try again later, nothing
 *   is wrong with the change itself.
 * - **auth** — 401 or an expired token: sign in again and retry.
 * - **refused** — the database said no (RLS, a check, a function raising a
 *   reason). Retrying would only be refused again, so the change is marked
 *   failed and shown in the sync panel with the reason.
 */
export function check(result: PostgrestLike, what: string): void {
  if (!result.error) return;
  throw failureOf(result, what);
}

export function failureOf(result: PostgrestLike, what: string): SyncFailure {
  const status = result.status ?? 0;
  const code = result.error?.code ?? "";
  const message = result.error?.message ?? "";
  if (status === 0 || /fetch failed|timed out|network|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(message)) {
    return new SyncFailure("network", `${what}: ${message || "no answer"}`, code);
  }
  if (status === 401 || code === "PGRST301" || /jwt/i.test(message)) {
    return new SyncFailure("auth", `${what}: ${message}`, code);
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new SyncFailure("server", `${what}: ${status} ${message}`, code);
  }
  // A machine-readable reason raised by a function (`not_your_ticket`,
  // `customer_blocked`) is the message itself, and the window renders it.
  const reason = /^[a-z_]+$/.test(message) ? message : code || "save_failed";
  return new SyncFailure("refused", reason, code);
}

/** Anything thrown by the network layer itself. */
export function asFailure(error: unknown, what: string): SyncFailure {
  if (error instanceof SyncFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SyncFailure("network", `${what}: ${message}`);
}

/* ── Being signed in ──────────────────────────────────────────────────── */

let signingIn: Promise<string> | null = null;

/**
 * A live session for the desk account, or a `SyncFailure` saying why there is
 * none. Resolves with the account's user id.
 *
 * An expired session is refreshed; a refresh token the server no longer
 * accepts falls back to the password. A wrong password is `auth` and is not
 * retried in a loop — the engine waits for somebody to change it in settings.
 */
export function ensureSession(): Promise<string> {
  signingIn ??= (async () => {
    const auth = supabase().auth;
    const { data, error } = await auth.getSession();
    const session = data.session;
    const fresh = session && (session.expires_at ?? 0) * 1000 > Date.now() + 60_000;
    if (session && fresh) return session.user.id;
    if (session && !error) {
      const refreshed = await auth.refreshSession();
      if (refreshed.data.session) return refreshed.data.session.user.id;
      if (refreshed.error && isNetwork(refreshed.error)) throw new SyncFailure("network", "session refresh: no answer");
    } else if (error && isNetwork(error)) {
      throw new SyncFailure("network", "session: no answer");
    }
    return signIn();
  })().finally(() => {
    signingIn = null;
  });
  return signingIn;
}

async function signIn(): Promise<string> {
  const account = getAccount();
  if (!account.email || !account.password) throw new SyncFailure("auth", "no_account");
  const { data, error } = await supabase().auth.signInWithPassword({ email: account.email, password: account.password });
  if (error || !data.session) {
    if (error && isNetwork(error)) throw new SyncFailure("network", "sign in: no answer");
    log.error(`sign in refused for ${account.email}`, error?.message);
    throw new SyncFailure("auth", error?.message ?? "sign_in_failed");
  }
  log.info(`signed in as ${account.email}`);
  return data.session.user.id;
}

function isNetwork(error: { name?: string; status?: number; message?: string }) {
  return (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    /fetch failed|network|timed out|ECONN|ENOTFOUND/i.test(error.message ?? "")
  );
}

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function sessionEmail(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.user.email ?? null;
}

/** Drops the session — after the account has been changed in settings. */
export async function signOutLocally() {
  try {
    await supabase().auth.signOut({ scope: "local" });
  } catch {
    // Nothing to sign out of.
  }
  writeSealed(paths.session, null);
}

/**
 * Tries a password without keeping the session — what settings uses before it
 * replaces the saved account, so a typo cannot lock the desk out.
 */
export async function testAccount(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const probe = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error || !data.session) return { ok: false, error: error && isNetwork(error) ? "offline" : "invalid_credentials" };
  await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
  return { ok: true };
}
