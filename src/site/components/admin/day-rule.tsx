import { CalendarDays } from "lucide-react";
import { formatDayLong } from "@/lib/data/datetime";

/**
 * The line drawn through a queue where the day changes.
 *
 * Only ever seen when the window spans more than one day — a queue opens on
 * today — and then it is the thing that makes "all time" readable: the
 * weekday and the date in words, and how many came in that day, on a rule
 * that runs the width of the list so it cannot be mistaken for a row.
 *
 * Reads no messages: the caller hands over the finished count label, so the
 * same rule serves a Server Component and the three client boards.
 *
 * The day is formatted at noon Baghdad time, so no time zone between UTC and
 * UTC+3 can push the label onto the day before.
 */
export function DayRule({
  day,
  locale,
  count,
  todayDay,
  todayLabel,
  yesterdayLabel,
}: {
  /** `YYYY-MM-DD`, a Baghdad calendar day. */
  day: string;
  locale: string;
  count: string;
  todayDay?: string;
  todayLabel?: string;
  yesterdayLabel?: string;
}) {
  const noon = Date.parse(`${day}T09:00:00Z`);
  const weekday = new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", {
    weekday: "long",
    timeZone: "Asia/Baghdad",
  }).format(noon);
  const yesterday = todayDay
    ? new Date(Date.parse(`${todayDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    : null;
  const relative =
    day === todayDay ? todayLabel : day === yesterday ? yesterdayLabel : null;

  return (
    <div className="flex items-center gap-3 pb-1 pt-3" role="separator" aria-label={`${weekday} ${formatDayLong(locale as "ar", noon)}`}>
      <span className="h-px flex-1 bg-line" aria-hidden />
      <span className="inline-flex items-center gap-2 rounded-chip border border-line bg-surface px-3 py-1 text-[0.74rem] font-extrabold text-ink shadow-card">
        <CalendarDays className="size-3.5 text-brand" aria-hidden />
        {relative && <span className="text-brand">{relative} ·</span>}
        <span>{weekday}</span>
        {/* No `data-numeric`: in Arabic this is a month *name*, and pinning
            it LTR would reorder the phrase. */}
        <span className="font-bold text-muted">
          {formatDayLong(locale as "ar", noon)}
        </span>
        <span className="rounded-full bg-subtle px-2 py-0.5 text-[0.66rem] font-black text-muted">{count}</span>
      </span>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </div>
  );
}
