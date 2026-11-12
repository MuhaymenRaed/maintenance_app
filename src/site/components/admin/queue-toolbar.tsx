import { CalendarRange, Search } from "lucide-react";
import { FilterChips } from "@/components/admin/filter-chips";
import { FormSelect } from "@/components/admin/form-select";
import { QUEUE_PRESETS, type QueueWindow } from "@/lib/data/queue-window";
import { cn } from "@/lib/utils";

/**
 * The bar above every work queue: when, and what.
 *
 * - **When** — today, yesterday, a week, a month, all time (the default), or a
 *   range of days. See `lib/data/queue-window.ts` for why the default moved.
 *   A page that can, also offers what is still open and "the last N days"
 *   (`labels.open`, `labels.lastDays`).
 *
 *   ⚠️ Which chip carries no parameter is read from `window.fallback`, never
 *   written as a literal — so this bar needs no edit when a page changes what
 *   it opens on, and the clean URL and the explicit one can never become two
 *   different pages.
 * - **What** — one search box over the ticket's code, the customer's name and
 *   numbers, the device and the notes, plus whatever selects the page adds
 *   (a technician, cash or deferred).
 *
 * A plain GET form, the shape `PeriodPicker` already uses: it needs no
 * JavaScript, works before hydration, and every filtered view is a URL one
 * member of staff can send another. Every link and the form carry the other
 * filters along (`keep`), so changing one never silently drops another.
 *
 * ⚠️ Field classes are written out here rather than imported from
 * `form-kit`: that module is `"use client"`, and a Server Component importing
 * a string from a client module receives a reference, not the string.
 */
const field =
  "h-9 rounded-control border border-line bg-canvas px-2.5 text-[0.8rem] font-medium text-ink outline-none transition-[border-color,box-shadow] focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_15%,transparent)]";

/** The filters that say *when*. Only one of them may be in a URL at a time. */
const WINDOW_KEYS = new Set(["when", "from", "to", "days"]);

export type ToolbarSelect = {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
};

export function QueueToolbar({
  locale,
  basePath,
  window,
  search,
  params,
  selects = [],
  labels,
}: {
  locale: string;
  /** Without the locale, as `FilterChips` takes it. */
  basePath: string;
  window: QueueWindow;
  search: string;
  /** Every filter currently in the URL except the window — status, q, tech… */
  params: Record<string, string>;
  selects?: ToolbarSelect[];
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
  const custom = window.when === "custom";
  const lastDays = window.when === "days";
  const formKeep = Object.fromEntries(
    Object.entries(params).filter(([name]) => name !== "q" && !selects.some((s) => s.name === name)),
  );
  const anyFilter = Boolean(search) || selects.some((s) => s.value);

  // ⚠️ Without the window's own keys. A range outranks a preset, so a chip that
  // carried `from` and `to` along would change nothing and look broken.
  const outsideWindow = Object.fromEntries(
    Object.entries(params).filter(([name]) => !WINDOW_KEYS.has(name)),
  );

  // Whatever the queue opens on is the chip with no parameter.
  const chips: { value: string | null; label: string }[] = QUEUE_PRESETS.map((preset) => ({
    value: preset === window.fallback ? null : preset,
    label: labels.presets[preset],
  }));
  if (labels.open) {
    const open = { value: window.fallback === "open" ? null : "open", label: labels.open };
    if (window.fallback === "open") chips.unshift(open);
    else chips.push(open);
  }

  return (
    <div className="space-y-2.5 rounded-panel border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FilterChips
          basePath={basePath}
          param="when"
          active={custom || lastDays ? "__custom" : window.when === window.fallback ? null : window.when}
          keep={outsideWindow}
          options={chips}
        />

        {labels.lastDays && (
          <form
            method="get"
            action={`/${locale}${basePath}`}
            className={cn(
              "flex items-center gap-1.5 rounded-chip border px-2.5 py-1.5 transition-colors",
              lastDays ? "border-brand bg-brand/6" : "border-line",
            )}
          >
            {Object.entries(outsideWindow).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <label className="inline-flex items-center gap-1.5 text-[0.78rem] font-bold text-muted">
              {labels.lastDays.before}
              <input
                type="number"
                name="days"
                min={1}
                max={3650}
                required
                defaultValue={window.days ?? ""}
                dir="ltr"
                data-numeric
                className={cn(field, "h-8 w-[4.5rem] text-center")}
              />
              {labels.lastDays.after}
            </label>
            <button
              type="submit"
              className="press inline-flex h-8 items-center rounded-control bg-brand px-3 text-[0.76rem] font-extrabold text-white transition-colors hover:bg-brand-hover"
            >
              {labels.apply}
            </button>
          </form>
        )}

        <form
          method="get"
          action={`/${locale}${basePath}`}
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-chip border px-2.5 py-1.5 transition-colors",
            custom ? "border-brand bg-brand/6" : "border-line",
          )}
          aria-label={labels.custom}
        >
          {Object.entries(outsideWindow).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <span className={cn("inline-flex items-center gap-1.5 text-[0.78rem] font-bold", custom ? "text-brand" : "text-muted")}>
            <CalendarRange className="size-4" aria-hidden />
            {labels.custom}
          </span>
          <label className="inline-flex items-center gap-1.5 text-[0.72rem] font-bold text-muted">
            {labels.from}
            <input type="date" name="from" defaultValue={window.from ?? ""} required dir="ltr" className={cn(field, "h-8 w-[9.5rem]")} />
          </label>
          <label className="inline-flex items-center gap-1.5 text-[0.72rem] font-bold text-muted">
            {labels.to}
            <input type="date" name="to" defaultValue={window.to ?? ""} required dir="ltr" className={cn(field, "h-8 w-[9.5rem]")} />
          </label>
          <button
            type="submit"
            className="press inline-flex h-8 items-center rounded-control bg-brand px-3 text-[0.76rem] font-extrabold text-white transition-colors hover:bg-brand-hover"
          >
            {labels.apply}
          </button>
        </form>
      </div>

      <form method="get" action={`/${locale}${basePath}`} className="flex flex-wrap items-end gap-2" role="search">
        {Object.entries({ ...formKeep, ...window.query }).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <span className="text-[0.7rem] font-bold text-muted">{labels.search}</span>
          <span className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder={labels.searchPlaceholder}
              className={cn(field, "w-full ps-8")}
            />
          </span>
        </label>
        {selects.map((select) => (
          <label key={select.name} className="flex min-w-[9rem] flex-col gap-1">
            <span className="text-[0.7rem] font-bold text-muted">{select.label}</span>
            <FormSelect name={select.name} defaultValue={select.value} options={select.options} ariaLabel={select.label} />
          </label>
        ))}
        <button
          type="submit"
          className="press inline-flex h-9 items-center gap-1.5 rounded-control bg-ink px-4 text-[0.78rem] font-extrabold text-surface transition-opacity hover:opacity-90"
        >
          <Search className="size-4" aria-hidden />
          {labels.apply}
        </button>
        {anyFilter && (
          <a
            href={`/${locale}${basePath}${toQuery({ ...formKeep, ...window.query })}`}
            className="inline-flex h-9 items-center rounded-control px-3 text-[0.78rem] font-bold text-muted hover:text-brand"
          >
            {labels.clear}
          </a>
        )}
      </form>
    </div>
  );
}

function toQuery(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `?${query}` : "";
}
