"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  CalendarClock,
  CalendarRange,
  Check,
  Filter,
  Loader2,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Select } from "@/components/ui/select";
import { QUEUE_PRESETS, type QueueWindow } from "@/lib/data/queue-window";
import { cn } from "@/lib/utils";
import { DateField, formatFieldValue } from "@/components/ui/date-field";

/**
 * The bar above every work queue: when, and what — and what is in force now.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ Why this stopped being a plain GET form
 * ---------------------------------------------------------------------------
 * It used to be three `<form method="get">`s and a picker that submitted its
 * own form, which was right for a page that is reloaded whole: no JavaScript,
 * and every filtered view a URL. Two faults came out of it:
 *
 * - **On the site** every change was a full document reload of the dashboard
 *   — the layout, the tabs, every query — which is the slowest thing the back
 *   office can ask for, and it read as the filter "loading for ever".
 * - **In the desktop app** it was worse than slow. The picker marked itself
 *   busy and waited for the document to be replaced, which is what clears the
 *   flag on the site; the app's router answers a GET form in place, so the
 *   document was never replaced, and the picker stayed locked behind its
 *   spinner until the app was restarted. That is exactly how it was reported.
 *
 * Now every control navigates through the router inside a transition. The
 * transition's own `pending` is the only busy flag, and it ends when the new
 * board is on screen — on the site and in the desktop app alike, because both
 * routers answer `push`. Nothing is ever disabled while it waits: a second
 * change simply supersedes the first.
 *
 * Every filtered view is still a URL — the filters live in the query string
 * exactly as before — so a filtered queue is still something one member of
 * staff can send another.
 *
 * ---------------------------------------------------------------------------
 * Three rows, three questions
 * ---------------------------------------------------------------------------
 * **When** (the period), **what** (the search and the page's own pickers), and
 * **what is in force** — every active filter as a chip that removes itself,
 * and one press to reset them all. The last row is what makes the board
 * readable at a glance: the reader no longer has to work out from six
 * highlighted controls why the list is short.
 */

/** The filters that say *when*. Only one of them may be in a URL at a time. */
const WINDOW_KEYS = new Set(["when", "from", "to", "days"]);

const field =
  "h-9 rounded-control border border-line bg-canvas px-2.5 text-[0.8rem] font-medium text-ink outline-none transition-[border-color,box-shadow] focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_15%,transparent)]";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A day worth applying by itself. A date field fires `change` for every
 * complete date, and one typed year by year passes through 0002, 0020 and 0202
 * on its way to 2026 — each a "complete" date the range would otherwise go
 * and fetch.
 */
function sane(day: string): boolean {
  return DAY.test(day) && day >= "2000-01-01" && day <= "2100-12-31";
}

export type ToolbarSelect = {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
};

/** A filter the page applies outside this bar — shown, and removable, here. */
export type ToolbarActive = { name: string; label: string };

export function QueueToolbar({
  basePath,
  window: span,
  search,
  params,
  selects = [],
  active = [],
  clearKeys = ["status"],
  labels,
}: {
  /** Kept for the callers; the router supplies the locale. */
  locale?: string;
  /** Without the locale, as `FilterChips` takes it. */
  basePath: string;
  window: QueueWindow;
  search: string;
  /** Every filter currently in the URL — status, q, tech, the window… */
  params: Record<string, string>;
  selects?: ToolbarSelect[];
  /** Filters applied elsewhere on the page (the status chips), for the summary. */
  active?: ToolbarActive[];
  /** What "reset all" clears beyond this bar's own fields. */
  clearKeys?: string[];
  labels: {
    presets: Record<(typeof QUEUE_PRESETS)[number], string>;
    /** Offers the "still open" chip. */
    open?: string;
    /** Offers the "last N days" field: the words either side of the number. */
    lastDays?: { before: string; after: string };
    custom: string;
    from: string;
    to: string;
    apply: string;
    search: string;
    searchPlaceholder: string;
    clear: string;
  };
}) {
  const t = useTranslations("Admin");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  /* ── navigation ───────────────────────────────────────────────────────── */

  function go(next: Record<string, string>) {
    const query = new URLSearchParams(
      Object.entries(next).filter(([, value]) => value !== "" && value != null),
    ).toString();
    startTransition(() => {
      router.push(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  }

  const without = (keys: Iterable<string>) => {
    const drop = new Set(keys);
    return Object.fromEntries(Object.entries(params).filter(([name]) => !drop.has(name)));
  };

  /* ── the search, applied as it is typed ───────────────────────────────── */

  /*
   * ⚠️ The field is never re-keyed on the URL. Remounting it on the query is
   * the fault `StoreSearch` shipped: the URL the box changes is the box's own,
   * so a remount half a second into typing took the focus and put the shorter,
   * already-sent query back over every letter typed since. It follows the URL
   * during render instead, and ignores the echo of a query it sent itself.
   */
  const [draft, setDraft] = useState(search);
  const [sent, setSent] = useState(search);
  const [seen, setSeen] = useState(search);
  if (search !== seen) {
    setSeen(search);
    if (search.trim() !== sent.trim()) {
      setDraft(search);
      setSent(search);
    }
  }
  function sendSearch(value: string) {
    if (value.trim() === sent.trim()) return;
    setSent(value);
    go({ ...without(["q"]), ...(value.trim() ? { q: value.trim() } : {}) });
  }

  /*
   * Applied once typing pauses. The effect owns the timer: every new letter
   * re-renders, which clears the pending send and starts another, and leaving
   * the page clears it for good. Enter sends at once (`sendSearch` below).
   */
  useEffect(() => {
    if (draft.trim() === sent.trim()) return;
    const timer = setTimeout(() => sendSearch(draft), 450);
    return () => clearTimeout(timer);
  });

  /* ── the period ───────────────────────────────────────────────────────── */

  const custom = span.when === "custom";
  const lastDays = span.when === "days";
  const windowKey = JSON.stringify(span.query);
  const [range, setRange] = useState({ from: span.from ?? "", to: span.to ?? "", days: span.days ? String(span.days) : "" });
  const [seenWindow, setSeenWindow] = useState(windowKey);
  if (windowKey !== seenWindow) {
    setSeenWindow(windowKey);
    setRange({ from: span.from ?? "", to: span.to ?? "", days: span.days ? String(span.days) : "" });
  }

  const outsideWindow = without(WINDOW_KEYS);

  function pickPreset(value: string | null) {
    go({ ...outsideWindow, ...(value ? { when: value } : {}) });
  }

  function applyRange(from = range.from, to = range.to) {
    if (!sane(from) || !sane(to)) return;
    const [a, b] = from <= to ? [from, to] : [to, from];
    go({ ...outsideWindow, from: a, to: b });
  }

  function applyDays(raw = range.days) {
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return;
    go({ ...outsideWindow, days: String(days) });
  }

  // Whatever the queue opens on is the chip with no parameter.
  const chips: { value: string | null; label: string }[] = QUEUE_PRESETS.map((preset) => ({
    value: preset === span.fallback ? null : preset,
    label: labels.presets[preset],
  }));
  if (labels.open) {
    const open = { value: span.fallback === "open" ? null : "open", label: labels.open };
    if (span.fallback === "open") chips.unshift(open);
    else chips.push(open);
  }
  const activeChip = custom || lastDays ? "__custom" : span.when === span.fallback ? null : span.when;

  /* ── the page's own pickers ───────────────────────────────────────────── */

  const selectKey = selects.map((select) => `${select.name}=${select.value}`).join("&");
  const [choices, setChoices] = useState(() =>
    Object.fromEntries(selects.map((select) => [select.name, select.value])),
  );
  const [seenSelects, setSeenSelects] = useState(selectKey);
  if (selectKey !== seenSelects) {
    setSeenSelects(selectKey);
    setChoices(Object.fromEntries(selects.map((select) => [select.name, select.value])));
  }

  function choose(name: string, value: string) {
    setChoices((current) => ({ ...current, [name]: value }));
    go({ ...without([name]), ...(value ? { [name]: value } : {}) });
  }

  /* ── what is in force ─────────────────────────────────────────────────── */

  const periodLabel = custom
    ? `${formatFieldValue("date", span.from ?? "")} — ${formatFieldValue("date", span.to ?? "")}`
    : lastDays
      ? `${labels.lastDays?.before ?? ""} ${span.days} ${labels.lastDays?.after ?? ""}`.trim()
      : span.when === "open"
        ? (labels.open ?? span.when)
        : span.when in labels.presets
          ? labels.presets[span.when as keyof typeof labels.presets]
          : span.when;

  const inForce: { key: string; label: string; remove: () => void }[] = [];
  if (span.when !== span.fallback) {
    inForce.push({ key: "when", label: periodLabel, remove: () => pickPreset(null) });
  }
  if (search) {
    inForce.push({
      key: "q",
      label: `${labels.search}: ${search}`,
      remove: () => {
        setDraft("");
        sendSearch("");
      },
    });
  }
  for (const select of selects) {
    if (!select.value) continue;
    const option = select.options.find((candidate) => candidate.value === select.value);
    inForce.push({
      key: select.name,
      label: `${select.label}: ${option?.label ?? select.value}`,
      remove: () => choose(select.name, ""),
    });
  }
  for (const extra of active) {
    inForce.push({ key: extra.name, label: extra.label, remove: () => go(without([extra.name])) });
  }

  function resetAll() {
    setDraft("");
    setSent("");
    go(without([...WINDOW_KEYS, "q", ...selects.map((select) => select.name), ...clearKeys]));
  }

  return (
    <section
      aria-busy={pending}
      className="relative overflow-hidden rounded-panel border border-line bg-surface shadow-card"
    >
      {/* The one busy signal: a hairline that runs while the board is on its
          way, and stops by itself when the transition ends. */}
      {pending && (
        <span className="absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-brand/12" aria-hidden>
          <span className="animate-indeterminate block h-full w-1/3 rounded-full bg-brand" />
        </span>
      )}

      {/* ── When ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/70 px-3.5 py-3">
        <RowLabel icon={CalendarClock} label={t("filterPeriod")} />
        <ul className="scrollbar-none flex max-w-full gap-1.5 overflow-x-auto pb-0.5">
          {chips.map((chip) => {
            const on = chip.value === activeChip;
            return (
              <li key={chip.value ?? "__default"} className="shrink-0">
                <button
                  type="button"
                  onClick={() => pickPreset(chip.value)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-chip border px-3 py-1.5 text-[0.78rem] font-bold transition-colors",
                    on
                      ? "border-brand bg-brand text-white"
                      : "border-line text-muted hover:border-muted hover:text-ink",
                  )}
                >
                  {chip.label}
                </button>
              </li>
            );
          })}
        </ul>

        {labels.lastDays && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              applyDays();
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-chip border px-2.5 py-1 transition-colors",
              lastDays ? "border-brand bg-brand/6" : "border-line",
            )}
          >
            <label className="inline-flex items-center gap-1.5 text-[0.76rem] font-bold text-muted">
              {labels.lastDays.before}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                value={range.days}
                onChange={(event) => setRange((current) => ({ ...current, days: event.target.value }))}
                onBlur={() => range.days && Number(range.days) !== span.days && applyDays()}
                dir="ltr"
                data-numeric
                className={cn(field, "h-8 w-[4.25rem] text-center")}
              />
              {labels.lastDays.after}
            </label>
            <button
              type="submit"
              aria-label={labels.apply}
              title={labels.apply}
              className="press flex size-7 items-center justify-center rounded-control bg-brand text-white transition-colors hover:bg-brand-hover"
            >
              <Check className="size-3.5" aria-hidden />
            </button>
          </form>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            applyRange();
          }}
          aria-label={labels.custom}
          className={cn(
            "flex flex-wrap items-center gap-1.5 rounded-chip border px-2.5 py-1 transition-colors",
            custom ? "border-brand bg-brand/6" : "border-line",
          )}
        >
          <span className={cn("inline-flex items-center gap-1 text-[0.76rem] font-bold", custom ? "text-brand" : "text-muted")}>
            <CalendarRange className="size-3.5" aria-hidden />
            {labels.custom}
          </span>
          <label className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-muted">
            {labels.from}
            <DateField
              type="date"
              value={range.from}
              max={range.to || undefined}
              onChange={(event) => {
                const from = event.target.value;
                setRange((current) => ({ ...current, from }));
                // Both ends present: the range applies itself, the way the
                // presets beside it do.
                if (sane(from) && sane(range.to)) applyRange(from, range.to);
              }}
              className={cn(field, "h-8 w-[9.25rem]")}
            />
          </label>
          <label className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-muted">
            {labels.to}
            <DateField
              type="date"
              value={range.to}
              min={range.from || undefined}
              onChange={(event) => {
                const to = event.target.value;
                setRange((current) => ({ ...current, to }));
                if (sane(range.from) && sane(to)) applyRange(range.from, to);
              }}
              className={cn(field, "h-8 w-[9.25rem]")}
            />
          </label>
        </form>
      </div>

      {/* ── What ── */}
      <div className="flex flex-wrap items-end gap-2 px-3.5 py-3">
        <RowLabel icon={Filter} label={t("filterSearchAndNarrow")} className="w-full" />
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            sendSearch(draft);
          }}
          className="flex min-w-[14rem] flex-1 flex-col gap-1"
        >
          <span className="text-[0.7rem] font-bold text-muted">{labels.search}</span>
          <span className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={labels.searchPlaceholder}
              aria-label={labels.search}
              className={cn(field, "w-full pe-9 ps-8")}
            />
            {draft && (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  sendSearch("");
                }}
                aria-label={labels.clear}
                title={labels.clear}
                className="absolute end-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-ink"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </span>
        </form>
        {selects.map((select) => (
          <label key={select.name} className="flex min-w-[10rem] flex-col gap-1 max-sm:flex-1">
            <span className="text-[0.7rem] font-bold text-muted">{select.label}</span>
            <Select
              value={choices[select.name] ?? ""}
              aria-label={select.label}
              options={select.options}
              onChange={(value) => {
                if (value === (choices[select.name] ?? "")) return;
                choose(select.name, value);
              }}
            />
          </label>
        ))}
      </div>

      {/* ── What is in force ── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line/70 bg-subtle/45 px-3.5 py-2.5">
        <span className="text-[0.72rem] font-extrabold text-muted">{t("filterActive")}</span>
        {inForce.length === 0 ? (
          <span className="text-[0.74rem] font-semibold text-muted">{t("filterNone")}</span>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {inForce.map((item) => (
              <li key={item.key}>
                <span className="inline-flex items-center gap-1 rounded-chip border border-brand/35 bg-brand/8 py-0.5 pe-1 ps-2.5 text-[0.74rem] font-bold text-brand">
                  <span className="max-w-[16rem] truncate">{item.label}</span>
                  <button
                    type="button"
                    onClick={item.remove}
                    aria-label={`${t("filterRemove")} — ${item.label}`}
                    title={t("filterRemove")}
                    className="flex size-5 items-center justify-center rounded-full transition-colors hover:bg-brand hover:text-white"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <span className="ms-auto flex items-center gap-2">
          {pending && (
            <span className="inline-flex items-center gap-1.5 text-[0.72rem] font-bold text-muted" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t("filterUpdating")}
            </span>
          )}
          {inForce.length > 0 && (
            <button
              type="button"
              onClick={resetAll}
              className="press inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-[0.74rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t("filterResetAll")}
            </button>
          )}
        </span>
      </div>
    </section>
  );
}

function RowLabel({
  icon: Icon,
  label,
  className,
}: {
  icon: typeof Search;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[0.74rem] font-extrabold text-ink", className)}>
      <span className="flex size-6 items-center justify-center rounded-control bg-brand/10 text-brand">
        <Icon className="size-3.5" aria-hidden />
      </span>
      {label}
    </span>
  );
}
