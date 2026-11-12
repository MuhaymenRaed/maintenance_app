/**
 * Dates, in a shop that reads them in two directions.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ Why `format.dateTime` from next-intl was not enough
 * ---------------------------------------------------------------------------
 * `Intl` emits **bidi control characters** inside an Arabic date — U+200F right
 * before each separator — so `{ day: "2-digit", month: "2-digit", year:
 * "2-digit" }` in `ar` is not `"06/09/26"` but `"06‏/09‏/26"`. Those
 * marks are invisible and load-bearing: they exist to keep the parts in
 * calendar order inside right-to-left prose.
 *
 * This codebase then puts dates inside `data-numeric`, which sets
 * `direction: ltr`. An embedded RLM inside an explicitly-LTR box opens a
 * right-to-left run *within* it, so the segments reorder against each other
 * and the reader gets a date with its pieces shuffled and a stray separator on
 * the wrong end. That is the "disfigured" format, it appears only in Arabic,
 * only in the places that pin LTR, and it looks exactly like a data problem.
 *
 * `Intl` in `ar` also defaults to Arabic-Indic digits, which the rest of this
 * site does not use anywhere — prices, phone numbers, order codes and IMEIs
 * are all Western digits in both locales by explicit decision.
 *
 * So every formatter here does three things next-intl's does not:
 *
 * 1. pins `numberingSystem: "latn"` and `calendar: "gregory"`, so a date reads
 *    the same way a price does;
 * 2. **strips the bidi marks**, because the element already declares its
 *    direction and does not need them;
 * 3. uses `en-GB` for the all-numeric form, so English reads `06/09/2026` like
 *    Arabic does rather than `09/06/2026` — day-first is what Iraq writes, and
 *    two locales disagreeing about which number is the month is worse than
 *    either convention on its own.
 *
 * ---------------------------------------------------------------------------
 * Everything is Baghdad
 * ---------------------------------------------------------------------------
 * `i18n/request.ts` pins `Asia/Baghdad` for the same reason, and these repeat
 * it rather than inheriting it: a helper called from a Server Action or a
 * script has no request context to read it from, and a timestamp that means a
 * different hour depending on where it was formatted is not a fact.
 *
 * Iraq has no DST, so the zone is a fixed UTC+3 — which is what
 * `admin-dashboard.ts` already relies on.
 *
 * This file imports nothing, so a Client Component may use it.
 */

export const SHOP_TIME_ZONE = "Asia/Baghdad";

/** LRM, RLM and the Arabic letter mark. Invisible, and the whole problem. */
const BIDI = /[‎‏؜]/g;

export type Loc = string;

/**
 * One `Intl.DateTimeFormat` per (locale, shape), built once.
 *
 * Constructing a formatter is the expensive half of formatting, and the admin
 * boards render hundreds of dates per page.
 */
const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: Loc, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, {
      timeZone: SHOP_TIME_ZONE,
      numberingSystem: "latn",
      calendar: "gregory",
      ...options,
    });
    cache.set(key, found);
  }
  return found;
}

function render(
  locale: Loc,
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  // A malformed timestamp renders as nothing rather than as "Invalid Date",
  // which is a string the reader cannot act on and which sorts oddly beside
  // real ones.
  if (Number.isNaN(date.getTime())) return "";
  return formatter(locale, options).format(date).replace(BIDI, "");
}

/** `6 Sep 2026` / `6 سبتمبر 2026` — the default for anything a person reads. */
export function formatDay(
  locale: Loc,
  value: string | number | Date | null | undefined,
): string {
  return render(locale, value, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** `6 September 2026` / `6 سبتمبر 2026` — where there is room to spell it. */
export function formatDayLong(
  locale: Loc,
  value: string | number | Date | null | undefined,
): string {
  return render(locale, value, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** `06/09/2026`, day first in both locales. For dense columns and tables. */
export function formatDayNumeric(
  locale: Loc,
  value: string | number | Date | null | undefined,
): string {
  return render(locale === "ar" ? "ar" : "en-GB", value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** `Sep 2026` / `سبتمبر 2026` — "customer since". */
export function formatMonth(
  locale: Loc,
  value: string | number | Date | null | undefined,
): string {
  return render(locale, value, { month: "short", year: "numeric" });
}

/**
 * The months as Iraq names them. `Intl`'s Arabic gives the Egyptian names —
 * سبتمبر, أغسطس — which a reader in Al Kut understands and would not write.
 */
const IRAQI_MONTHS = [
  "كانون الثاني",
  "شباط",
  "آذار",
  "نيسان",
  "أيار",
  "حزيران",
  "تموز",
  "آب",
  "أيلول",
  "تشرين الأول",
  "تشرين الثاني",
  "كانون الأول",
];

/**
 * `أيلول 2010` / `September 2010` — a date on an archive photograph.
 *
 * Takes the calendar date as the camera recorded it and does no time-zone
 * arithmetic: an EXIF stamp is a wall clock with no zone on it, and passing
 * one through `Date` could move a photograph across a month boundary. The
 * month is also as precise as these should claim to be, since a camera's clock
 * was set by hand and nothing here can check it.
 */
export function formatArchiveMonth(locale: Loc, taken: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(taken);
  if (!match) return "";
  const [, year, month] = match;
  if (locale === "ar") return `${IRAQI_MONTHS[Number(month) - 1] ?? ""} ${year}`.trim();
  return `${render(locale, new Date(Date.UTC(Number(year), Number(month) - 1, 15)), { month: "long" })} ${year}`;
}

/** `21:30`. 24-hour in both locales, because a shop's opening times are. */
export function formatTime(
  locale: Loc,
  value: string | number | Date | null | undefined,
): string {
  return render(locale, value, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** `6 Sep 2026 · 21:30`. */
export function formatDayTime(
  locale: Loc,
  value: string | number | Date | null | undefined,
): string {
  const day = formatDay(locale, value);
  if (!day) return "";
  return `${day} · ${formatTime(locale, value)}`;
}

const relative = new Map<string, Intl.RelativeTimeFormat>();

/**
 * "3 days ago" / "قبل 3 أيام".
 *
 * ⚠️ Takes `now` rather than reading the clock, because `react-hooks/purity`
 * makes `Date.now()` during render an error in this codebase and a Server
 * Component that read it would put the two sides of a hydration boundary on
 * two different clocks. Callers pass the same instant they used for the rest
 * of the page — the pattern `getRangeStats` and `getAudienceBreakdown` follow.
 */
export function formatSince(
  locale: Loc,
  value: string | number | Date | null | undefined,
  now: number,
): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  let rtf = relative.get(locale);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relative.set(locale, rtf);
  }

  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  // Largest unit that does not read as an exaggeration. "45 days ago" is
  // harder to hold than "a month ago", and "2,700 minutes" is not a length of
  // time anybody converts back.
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    abs < 60
      ? ["second", 1]
      : abs < 3600
        ? ["minute", 60]
        : abs < 86_400
          ? ["hour", 3600]
          : abs < 2_592_000
            ? ["day", 86_400]
            : abs < 31_536_000
              ? ["month", 2_592_000]
              : ["year", 31_536_000];

  return rtf.format(Math.round(seconds / size), unit).replace(BIDI, "");
}

/* ══════════════════════ `datetime-local` round-tripping ══════════════════ */

/**
 * ⚠️ An ISO instant and a `datetime-local` value are not the same thing, and
 * both offer editors used to treat them as if they were.
 *
 * `<input type="datetime-local">` has no timezone: its value is a wall-clock
 * reading, and the browser hands it back exactly as typed. The coupon editor
 * displayed `iso.slice(0, 16)` — the UTC wall clock — and saved
 * `new Date(value).toISOString()`, which parses that same string as **local**
 * time. So every save of an unchanged form moved the window three hours
 * earlier, and it kept moving on every subsequent save. A campaign edited
 * twice for a typo in its title silently opened six hours before the shop
 * meant it to.
 *
 * The offers editor had the mirror-image fault: it round-tripped UTC
 * consistently, so nothing drifted, and an admin in Al Kut typing "09:00" got
 * an offer that opened at noon. Consistent and wrong is harder to notice than
 * drifting and wrong.
 *
 * These two are inverses **through Baghdad**, so what is typed is what the
 * shop's own clock will read.
 */

/** An ISO instant → the `YYYY-MM-DDTHH:mm` a Baghdad admin should see. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = formatter("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  // `hour12: false` can yield "24" for midnight in some ICU builds; folded
  // back rather than trusted, because "24:00" is not a value the input accepts
  // and the field would silently render empty.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** The `YYYY-MM-DDTHH:mm` an admin typed, read as Baghdad → an ISO instant. */
export function fromLocalInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  // Iraq is a fixed UTC+3 with no daylight saving — the same assumption
  // `lib/queries/admin-dashboard.ts` states and relies on — so the offset can
  // be written rather than searched for.
  return new Date(`${y}-${m}-${d}T${hh}:${mm}:00+03:00`).toISOString();
}
