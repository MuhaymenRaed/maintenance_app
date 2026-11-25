"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays, CalendarRange, Check, Clock, History, Loader2, Sun } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { DateField } from "@/components/ui/date-field";
import type { QueueWindow } from "@/lib/data/queue-window";
import { cn } from "@/lib/utils";

/**
 * The period every tab of the maintenance section reads — the shop's
 * "easy time filters" (2026-11-24): today, the default; yesterday; one day
 * picked off a calendar; a range; every day there has been.
 *
 * The period is the one thing that asks the server again: the tabs, the lists
 * and the filters are worked out in the browser from what this period read.
 * It navigates inside a transition, so the press shows at once and the old
 * figures stay on screen until the new ones land — on the site and in the
 * desktop app alike, because both routers answer `push`.
 *
 * `keep` is everything else in the address (which tab, which list), built by
 * the shell from its own state rather than read off `location`, because the
 * desktop app's router does not hear `replaceState`.
 */
type Mode = "today" | "yesterday" | "day" | "range" | "all";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const sane = (day: string) => DAY.test(day) && day >= "2000-01-01" && day <= "2100-12-31";
const field = "h-9 w-44 rounded-control border border-line bg-canvas px-2.5 text-[0.8rem] font-bold text-ink outline-none";

export function PeriodBar({
  basePath,
  window: span,
  today,
  keep,
  label,
}: {
  basePath: string;
  window: QueueWindow;
  today: string;
  keep: Record<string, string>;
  /** The period in words, beside the chips. */
  label: string;
}) {
  const t = useTranslations("Admin");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const mode: Mode =
    span.when === "today"
      ? "today"
      : span.when === "yesterday"
        ? "yesterday"
        : span.when === "all" || span.when === "open"
          ? "all"
          : span.from && span.from === span.to
            ? "day"
            : "range";
  /** Which chip the reader is setting up — a day or a range opens its fields. */
  const [picking, setPicking] = useState<"day" | "range" | null>(null);
  const [day, setDay] = useState(mode === "day" ? (span.from ?? today) : today);
  const [range, setRange] = useState({ from: span.from ?? today, to: span.to ?? today });
  // A period that landed ends the picking — during render, never in an effect.
  const landed = JSON.stringify(span.query);
  const [seen, setSeen] = useState(landed);
  if (landed !== seen) {
    setSeen(landed);
    setPicking(null);
    setDay(mode === "day" ? (span.from ?? today) : today);
    setRange({ from: span.from ?? today, to: span.to ?? today });
  }
  const shownMode: Mode = picking ?? mode;

  function go(period: Record<string, string>) {
    const query = new URLSearchParams(
      Object.entries({ ...keep, ...period }).filter(([, value]) => value !== "" && value != null),
    ).toString();
    startTransition(() => {
      router.push(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  }

  function press(next: Mode) {
    if (next === "day" || next === "range") {
      setPicking(next);
      return;
    }
    setPicking(null);
    if (next === "today") go({});
    else go({ when: next });
  }

  function showDay(value = day) {
    if (!sane(value)) return;
    go({ from: value, to: value });
  }

  function showRange(from = range.from, to = range.to) {
    if (!sane(from) || !sane(to)) return;
    go({ from, to });
  }

  const chips: { mode: Mode; label: string; Icon: typeof Sun }[] = [
    { mode: "today", label: t("whenToday"), Icon: Sun },
    { mode: "yesterday", label: t("whenYesterday"), Icon: History },
    { mode: "day", label: t("periodDay"), Icon: CalendarDays },
    { mode: "range", label: t("periodRange"), Icon: CalendarRange },
    { mode: "all", label: t("whenAll"), Icon: Clock },
  ];

  return (
    <section
      aria-label={t("periodTitle")}
      aria-busy={pending}
      className="space-y-2.5 rounded-panel border border-line bg-surface px-3 py-2.5 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 inline-flex items-center gap-1.5 text-[0.76rem] font-extrabold text-ink">
          {pending ? (
            <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
          ) : (
            <CalendarDays className="size-4 text-brand" aria-hidden />
          )}
          {t("periodTitle")}
        </span>
        <div role="group" aria-label={t("periodTitle")} className="flex flex-wrap gap-1.5">
          {chips.map((chip) => {
            const active = shownMode === chip.mode;
            return (
              <button
                key={chip.mode}
                type="button"
                aria-pressed={active}
                onClick={() => press(chip.mode)}
                className={cn(
                  "press inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[0.78rem] font-extrabold transition-colors",
                  active
                    ? "border-brand bg-brand text-white shadow-sm"
                    : "border-line bg-canvas text-ink hover:border-brand/50 hover:text-brand",
                )}
              >
                <chip.Icon className="size-3.5" aria-hidden />
                {chip.label}
              </button>
            );
          })}
        </div>
        <span className="ms-auto rounded-chip bg-subtle px-2.5 py-1 text-[0.72rem] font-extrabold text-ink">{label}</span>
      </div>

      {shownMode === "day" && (picking === "day" || mode === "day") && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[0.7rem] font-bold text-muted">
            {t("periodDay")}
            <DateField
              type="date"
              value={day}
              max={today}
              onChange={(event) => {
                const value = event.target.value;
                setDay(value);
                if (sane(value)) showDay(value);
              }}
              aria-label={t("periodDay")}
              className={field}
            />
          </label>
        </div>
      )}

      {shownMode === "range" && (picking === "range" || mode === "range") && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[0.7rem] font-bold text-muted">
            {t("periodFrom")}
            <DateField
              type="date"
              value={range.from}
              max={today}
              onChange={(event) => {
                const from = event.target.value;
                setRange((current) => ({ ...current, from }));
              }}
              aria-label={t("periodFrom")}
              className={field}
            />
          </label>
          <label className="grid gap-1 text-[0.7rem] font-bold text-muted">
            {t("periodTo")}
            <DateField
              type="date"
              value={range.to}
              max={today}
              onChange={(event) => {
                const to = event.target.value;
                setRange((current) => ({ ...current, to }));
              }}
              aria-label={t("periodTo")}
              className={field}
            />
          </label>
          <button
            type="button"
            onClick={() => showRange()}
            disabled={!sane(range.from) || !sane(range.to)}
            className="press inline-flex h-9 items-center gap-1.5 rounded-control bg-brand px-4 text-[0.78rem] font-extrabold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            <Check className="size-4" aria-hidden />
            {t("periodApply")}
          </button>
        </div>
      )}
    </section>
  );
}
