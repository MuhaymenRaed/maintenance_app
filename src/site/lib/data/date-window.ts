/**
 * A reporting window — a preset ("the last 30 days") or a range the admin
 * picked ("1 Sep → 15 Oct") — resolved to instants on the server.
 *
 * ---------------------------------------------------------------------------
 * Why the browser never computes the instants
 * ---------------------------------------------------------------------------
 * The rule `getRangeStats` already documents: an instant computed in the
 * browser puts a laptop set to UTC in charge of where a Baghdad day begins,
 * and files the first three hours of every day under the one before. So the
 * URL carries *calendar days* (`?from=2026-09-01&to=2026-10-15`) or a preset
 * (`?days=7`), and this turns them into instants against the server's clock.
 * Iraq has no DST, so Baghdad is a fixed UTC+3 and the arithmetic is honest.
 *
 * ---------------------------------------------------------------------------
 * Validated, never trusted
 * ---------------------------------------------------------------------------
 * Every value is checked against a shape and clamped: a malformed date means
 * the default rather than a window that matches nothing, a range ending in the
 * future ends today, a reversed range is turned round, and a span past
 * `maxDays` is cut from the far end — one page load must not become a scan of
 * five years of sessions. The same rule the storefront's filters follow.
 *
 * Pure and import-free, so a Client Component may import it too.
 */

const DAY_MS = 86_400_000;
const BAGHDAD_OFFSET_MS = 3 * 3_600_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The Baghdad calendar day an instant falls on, as `YYYY-MM-DD`. */
export function baghdadDay(ms: number): string {
  return new Date(ms + BAGHDAD_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a Baghdad calendar day begins. */
export function baghdadDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - BAGHDAD_OFFSET_MS;
}

/** `day` shifted by `n` calendar days. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function validDay(value: unknown): string | null {
  if (typeof value !== "string" || !DAY_RE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  // `Date.parse("2026-02-31")` rolls over silently; round-tripping refuses it.
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : value;
}

export type DateWindow = {
  /** Inclusive lower bound, ISO. */
  since: string;
  /** Exclusive upper bound, ISO. */
  until: string;
  /** Calendar days covered, today counted. */
  days: number;
  /** First and last Baghdad day, inclusive. */
  from: string;
  to: string;
  /** The preset it came from, or null for a custom range. */
  preset: number | null;
  /**
   * The query parameters that reproduce this window — what a link that keeps
   * the window (a customer filter, a tab) must carry along. Empty for the
   * default preset, so the default URL stays clean.
   */
  query: Record<string, string>;
};

export function resolveWindow(
  params: { days?: unknown; from?: unknown; to?: unknown },
  nowMs: number,
  {
    presets = [7, 30, 90],
    defaultDays = 30,
    maxDays = 366,
  }: { presets?: readonly number[]; defaultDays?: number; maxDays?: number } = {},
): DateWindow {
  const today = baghdadDay(nowMs);
  let from = validDay(params.from);
  let to = validDay(params.to);

  if (from || to) {
    // One end given alone means "from that day to today" or "the day itself".
    from ??= to!;
    to ??= today;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > today) from = today;
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
    if (span > maxDays) from = addDays(to, -(maxDays - 1));
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
    return {
      since: new Date(baghdadDayStart(from)).toISOString(),
      until: new Date(baghdadDayStart(addDays(to, 1))).toISOString(),
      days,
      from,
      to,
      preset: null,
      query: { from, to },
    };
  }

  const preset = presets.find((option) => String(option) === params.days) ?? defaultDays;
  const first = addDays(today, -(preset - 1));
  return {
    since: new Date(baghdadDayStart(first)).toISOString(),
    until: new Date(baghdadDayStart(addDays(today, 1))).toISOString(),
    days: preset,
    from: first,
    to: today,
    preset,
    query: preset === defaultDays ? {} : { days: String(preset) },
  };
}
