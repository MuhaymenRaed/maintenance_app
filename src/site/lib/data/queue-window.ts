/**
 * The time window a work queue opens on — orders, repairs, programming and
 * replacements — and the day breaks drawn through the list.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ Why a queue opens on ALL TIME — and why it used to open on today
 * ---------------------------------------------------------------------------
 * The shop reversed this on 2026-11-02: "make the all time orders filter is
 * activated by default and to change the admin must specify, not in replacing
 * only but in all the others".
 *
 * The old rule had an argument and it is worth keeping, because it is the one
 * to weigh if this is ever reversed again. It was (2026-10-30) "by default
 * load each day's orders, the previous days will be hidden by the time filter
 * till the admin changes it" — a queue is worked a day at a time, and a list
 * that opens on four months of history buries the three tickets that came in
 * this morning under rows nobody is going to touch again.
 *
 * What that missed is the shape of *this* shop's queues. A buy-back sits for
 * days waiting on a device being brought in; a repair ticket outlives the day
 * it was booked by definition. Opening on today showed an empty board on a
 * quiet morning, which reads as the section being broken rather than as the
 * day being young — and the work that was actually outstanding was behind a
 * filter nobody had been told about. "Today" is still one press away, and the
 * day rules through the list are what keep a long view legible.
 *
 * The day grouping is therefore on by **default** now rather than only in the
 * wide views: `showDays` is false for the two single-day presets and true
 * everywhere else, which is the same test it always made.
 *
 * It sits beside `date-window.ts` rather than inside it because the reports'
 * window has no "all time" and opens on thirty days — a report and a queue ask
 * different questions of the same calendar. The arithmetic is shared: Baghdad
 * days on the server's clock, never the browser's (see that file).
 *
 * ---------------------------------------------------------------------------
 * …except a queue somebody has to finish
 * ---------------------------------------------------------------------------
 * "My tickets" and "waiting for a technician" open on what is still **open**,
 * from any day (`fallback: "open"`). They are lists of work, not of arrivals: a
 * manager who hands over yesterday's ticket today would otherwise be putting it
 * in a list that hides it, and the technician would find nothing to do.
 *
 * Pure and import-free beyond that module, so a Client Component may use the
 * day grouping too.
 */
// Relative, with its extension, so this file runs under `node --test`.
import { addDays, baghdadDay, baghdadDayStart } from "./date-window.ts";

export const QUEUE_PRESETS = ["today", "yesterday", "7", "30", "all"] as const;
export type QueuePreset = (typeof QUEUE_PRESETS)[number];

export type QueueWindow = {
  /**
   * The preset; `custom` for a from/to range; `days` for "the last N days";
   * `open` for everything unfinished, from any day.
   */
  when: QueuePreset | "custom" | "days" | "open";
  /**
   * What the queue opens on with nothing in the URL.
   *
   * `all` is the default for every arrivals queue. `open` is for a list of
   * work somebody has to finish — "my tickets", "waiting for a technician" —
   * which is already every day by construction (`since`/`until` are null) and
   * differs by being narrowed on *status* rather than on the calendar.
   */
  fallback: "all" | "today" | "open";
  /** The N of "the last N days", when that is what was asked for. */
  days: number | null;
  /** Inclusive lower bound, ISO — null for all time. */
  since: string | null;
  /** Exclusive upper bound, ISO — null for all time. */
  until: string | null;
  /** First and last Baghdad day covered, for the custom-range fields. */
  from: string | null;
  to: string | null;
  /**
   * The query that reproduces the window — what every other filter link on
   * the page must carry. Empty for the default, so the default URL is clean.
   */
  query: Record<string, string>;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: unknown): string | null {
  if (typeof value !== "string" || !DAY_RE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : value;
}

/** A whole number of days somebody might mean; anything else is no filter. */
function validDays(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return null;
  const days = Number(value);
  return days >= 1 && days <= 3650 ? days : null;
}

export function resolveQueueWindow(
  params: { when?: unknown; from?: unknown; to?: unknown; days?: unknown },
  nowMs: number,
  options: {
    /**
     * What the queue opens on: all time, unless it is a list of work to
     * finish.
     */
    fallback?: "all" | "today" | "open";
    /** Honour `when=open` — only a page that can filter on it passes this. */
    open?: boolean;
  } = {},
): QueueWindow {
  const fallback = options.fallback ?? "all";
  const today = baghdadDay(nowMs);
  let from = validDay(params.from);
  let to = validDay(params.to);

  if (from || to) {
    from ??= to!;
    to ??= today;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > today) from = today;
    return {
      when: "custom",
      fallback,
      days: null,
      since: new Date(baghdadDayStart(from)).toISOString(),
      until: new Date(baghdadDayStart(addDays(to, 1))).toISOString(),
      from,
      to,
      query: { from, to },
    };
  }

  const days = validDays(params.days);
  if (days) {
    const first = addDays(today, -(days - 1));
    return {
      when: "days",
      fallback,
      days,
      since: new Date(baghdadDayStart(first)).toISOString(),
      until: new Date(baghdadDayStart(addDays(today, 1))).toISOString(),
      from: first,
      to: today,
      query: { days: String(days) },
    };
  }

  const preset = (QUEUE_PRESETS as readonly string[]).includes(String(params.when))
    ? (params.when as QueuePreset)
    : null;

  const wantsOpen =
    params.when === "open" ? options.open || fallback === "open" : !preset && fallback === "open";
  if (wantsOpen) {
    return {
      when: "open",
      fallback,
      days: null,
      since: null,
      until: null,
      from: null,
      to: null,
      query: fallback === "open" ? {} : { when: "open" },
    };
  }

  // ⚠️ `fallback` rather than a literal: an arrivals queue falls through to
  // all time, and the one page that opens on a day has to be able to say so.
  const when = preset ?? (fallback === "today" ? "today" : "all");

  if (when === "all") {
    // Absent from the query when it *is* the default, so the clean URL and
    // `?when=all` are the same page rather than two — the rule the preset
    // branch below has always followed.
    return {
      when,
      fallback,
      days: null,
      since: null,
      until: null,
      from: null,
      to: null,
      query: fallback === "all" ? {} : { when },
    };
  }

  const first =
    when === "today" ? today
    : when === "yesterday" ? addDays(today, -1)
    : addDays(today, -(Number(when) - 1));
  const last = when === "yesterday" ? first : today;

  return {
    when,
    fallback,
    days: null,
    since: new Date(baghdadDayStart(first)).toISOString(),
    until: new Date(baghdadDayStart(addDays(last, 1))).toISOString(),
    from: first,
    to: last,
    query: when === fallback ? {} : { when },
  };
}

/** The Baghdad calendar day an ISO instant falls on. */
export function dayOf(iso: string): string {
  return baghdadDay(Date.parse(iso));
}

/**
 * The list cut into days, in the order it arrived. A queue is newest first,
 * so this only ever opens a new group when the day changes — it never sorts.
 */
export function groupByDay<T>(rows: readonly T[], at: (row: T) => string): { day: string; rows: T[] }[] {
  const groups: { day: string; rows: T[] }[] = [];
  for (const row of rows) {
    const day = dayOf(at(row));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
}

/**
 * What one search box may search for, made safe to put inside a PostgREST
 * `or=` filter: the characters that delimit that syntax are removed rather
 * than escaped, and the length is capped. A search is a hint, not a query
 * language.
 */
export function cleanSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}
