"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckCircle2,
  CircleDashed,
  Globe2,
  HandCoins,
  Hourglass,
  PackageOpen,
  PackageCheck,
  TrendingDown,
  TrendingUp,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { MoneyInput } from "@/components/admin/form-kit";
import { formatDayTime } from "@/lib/data/datetime";
import { stageOf, techStepOf, type RepairStage } from "@/lib/data/repair-stage";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The pieces the rebuilt ticket windows are made of (the shop, 2026-11-24) —
 * the add-ticket window, the ticket editor, the board's rows and the short
 * view all draw a stage, a badge and money the same way.
 */

/* ── A card with a numbered or iconed heading ─────────────────────────────── */

export function TicketCard({
  number,
  icon: Icon,
  title,
  hint,
  aside,
  tone = "brand",
  children,
  className,
}: {
  /** The add-ticket window numbers its cards; the editor gives each an icon. */
  number?: number;
  icon?: LucideIcon;
  title: string;
  hint?: string;
  /** Drawn at the end of the heading — a status, a count, a control. */
  aside?: ReactNode;
  tone?: "brand" | "info" | "success" | "warning" | "gold";
  children: ReactNode;
  className?: string;
}) {
  const plate = {
    brand: "bg-brand text-white",
    info: "bg-info text-white",
    success: "bg-success text-white",
    warning: "bg-warning text-white",
    gold: "bg-gold text-on-gold",
  }[tone];
  return (
    <section className={cn("overflow-hidden rounded-panel border border-line bg-surface shadow-card", className)}>
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line/70 bg-subtle/60 px-4 py-2.5">
        {number != null ? (
          <span
            className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-[0.78rem] font-black", plate)}
            data-numeric
          >
            {number}
          </span>
        ) : Icon ? (
          <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-control", plate)}>
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
        <span className="min-w-0">
          <h3 className="text-[0.92rem] font-black leading-tight text-ink">{title}</h3>
          {hint && <p className="text-[0.7rem] font-semibold leading-snug text-muted">{hint}</p>}
        </span>
        {aside && <div className="ms-auto flex flex-wrap items-center gap-1.5">{aside}</div>}
      </header>
      <div className="space-y-3.5 p-4">{children}</div>
    </section>
  );
}

/* ── The stage a manager reads ───────────────────────────────────────────── */

export const STAGE_LOOK: Record<RepairStage, { icon: LucideIcon; pill: string; solid: string; stripe: string }> = {
  request: { icon: Globe2, pill: "bg-gold/18 text-gold-ink", solid: "bg-gold text-on-gold", stripe: "var(--gold)" },
  accepted: { icon: Wrench, pill: "bg-info/12 text-info", solid: "bg-info text-white", stripe: "var(--info)" },
  waiting: { icon: Hourglass, pill: "bg-warning/14 text-warning", solid: "bg-warning text-white", stripe: "var(--warning)" },
  completed: { icon: CheckCircle2, pill: "bg-success/12 text-success", solid: "bg-success text-white", stripe: "var(--success)" },
  cancelled: { icon: XCircle, pill: "bg-brand/10 text-brand", solid: "bg-brand text-white", stripe: "var(--brand)" },
};

export function StagePill({ status, size = "sm" }: { status: string; size?: "sm" | "lg" }) {
  const t = useTranslations("Admin");
  const stage = stageOf(status);
  const look = STAGE_LOOK[stage];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-extrabold",
        size === "lg" ? "px-3 py-1.5 text-[0.82rem]" : "px-2.5 py-1 text-[0.7rem]",
        look.pill,
      )}
    >
      <look.icon className={size === "lg" ? "size-4" : "size-3.5"} aria-hidden />
      {t(`stage_${stage}`)}
    </span>
  );
}

/** The technician's current step, as a quiet tag beside «تم قبول الطلب». */
export function TechStepTag({ status }: { status: string }) {
  const tTrack = useTranslations("Track");
  const t = useTranslations("Admin");
  const step = techStepOf(status);
  if (!step) return null;
  return (
    <span
      title={t("techStepLabel")}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip border border-info/30 bg-surface px-2 py-0.5 text-[0.64rem] font-extrabold text-info"
    >
      <CircleDashed className="size-3" aria-hidden />
      {tTrack(`status_${step}` as "status_received")}
    </span>
  );
}

/** «طلب من الموقع» — booked by the customer on the site. */
export function WebRequestMark() {
  const t = useTranslations("Admin");
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip bg-gold/18 px-2 py-0.5 text-[0.64rem] font-extrabold text-gold-ink">
      <Globe2 className="size-3" aria-hidden />
      {t("webRequestMark")}
    </span>
  );
}

/* ── «تم التسليم للزبون» — a badge, never money ───────────────────────────── */

export function HandedOverMark({ at }: { at: string | null | undefined }) {
  const t = useTranslations("Admin");
  if (!at) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip bg-success/14 px-2 py-0.5 text-[0.64rem] font-extrabold text-success">
      <PackageCheck className="size-3" aria-hidden />
      {t("handedOver")}
    </span>
  );
}

/**
 * The badge as a switch — on the row, the ticket window and the technician's
 * window. A press is the whole act: it moves no money and asks nothing.
 */
export function HandedOverToggle({
  at,
  by,
  disabled,
  busy,
  onToggle,
  compact = false,
}: {
  at: string | null | undefined;
  /** Who set it, by name. */
  by?: string | null;
  disabled?: boolean;
  busy?: boolean;
  onToggle: (handed: boolean) => void;
  compact?: boolean;
}) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const on = Boolean(at);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled || busy}
      onClick={() => onToggle(!on)}
      title={t("handedOverHint")}
      className={cn(
        "press inline-flex items-center gap-2 rounded-control border font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        compact ? "px-2.5 py-1.5 text-[0.72rem]" : "w-full px-3.5 py-2.5 text-[0.82rem]",
        on
          ? "border-success/50 bg-success/10 text-success hover:bg-success/15"
          : "border-dashed border-line-strong bg-surface text-muted hover:border-success hover:text-success",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-success" : "bg-line-strong",
        )}
      >
        <span
          className={cn(
            "absolute size-4 rounded-full bg-white shadow transition-[inset-inline-start] duration-150",
            on ? "start-[1.15rem]" : "start-0.5",
          )}
        />
      </span>
      <span className="flex min-w-0 flex-col text-start">
        <span>{on ? t("handedOver") : t("handedOverNot")}</span>
        {!compact && on && at && (
          <span className="text-[0.68rem] font-semibold text-muted">
            {by ? t("handedOverBy", { name: by, when: formatDayTime(locale, at) }) : formatDayTime(locale, at)}
          </span>
        )}
      </span>
    </button>
  );
}

/* ── The two figures a ticket is priced by, one above the other ──────────── */

/**
 * مبلغ الصيانة then سعر الشراء — two stacked rows with large, coloured names
 * (the shop, 2026-11-24: "more forward, like two rows one above the other with
 * clear large name and coloring"), and the profit worked out under them.
 *
 * The amount is green — money coming in — and the purchase price amber — money
 * the shop spent; the profit is green or red by its sign. The words say which
 * is which, so nothing is carried by colour alone.
 */
export function PriceRows({
  base,
  cost,
  onBase,
  onCost,
  onBaseCommit,
  onCostCommit,
  baseDisabled,
  costDisabled,
  showCost = true,
  missing = false,
  warranty = 0,
}: {
  base: number | null;
  cost: number | null;
  onBase: (value: number | null) => void;
  onCost: (value: number | null) => void;
  onBaseCommit?: () => void;
  onCostCommit?: () => void;
  baseDisabled?: boolean;
  costDisabled?: boolean;
  /** A technician is never shown the purchase price. */
  showCost?: boolean;
  /** The fee is required — said under the row when it is missing. */
  missing?: boolean;
  /** The warranty beside the repair, which is never profit. */
  warranty?: number;
}) {
  const t = useTranslations("Admin");
  const profit = base != null && base > 0 ? base - (cost ?? 0) : null;
  return (
    <div className="overflow-hidden rounded-panel border-2 border-line">
      <PriceRow
        tone="success"
        icon={Wrench}
        label={t("priceMaintenance")}
        hint={t("priceMaintenanceHint")}
        required
        value={base}
        onChange={onBase}
        onCommit={onBaseCommit}
        disabled={baseDisabled}
        error={missing ? t("deskPriceRequired") : undefined}
      />
      {showCost && (
        <>
          <PriceRow
            tone="warning"
            icon={PackageOpen}
            label={t("priceCost")}
            hint={t("priceCostHint")}
            value={cost}
            onChange={onCost}
            onCommit={onCostCommit}
            disabled={costDisabled}
          />
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-line px-4 py-3",
              profit == null ? "bg-subtle" : profit < 0 ? "bg-brand/8" : "bg-success/8",
            )}
          >
            {profit != null && profit < 0 ? (
              <TrendingDown className="size-5 shrink-0 text-brand" aria-hidden />
            ) : (
              <TrendingUp className={cn("size-5 shrink-0", profit == null ? "text-muted" : "text-success")} aria-hidden />
            )}
            <span className="text-[0.95rem] font-black text-ink">{t("priceProfit")}</span>
            <span className="text-[0.7rem] font-semibold text-muted">
              {cost == null ? t("priceNoCost") : warranty > 0 ? t("financeProfitHint") : t("priceProfitHint")}
            </span>
            <span
              className={cn(
                "ms-auto text-[1.3rem] font-black",
                profit == null ? "text-muted" : profit < 0 ? "text-brand" : "text-success",
              )}
            >
              <span data-numeric>{profit == null ? "—" : formatPrice(profit)}</span>{" "}
              <span className="text-[0.75rem] font-extrabold">{t("currency")}</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function PriceRow({
  tone,
  icon: Icon,
  label,
  hint,
  required,
  value,
  onChange,
  onCommit,
  disabled,
  error,
}: {
  tone: "success" | "warning";
  icon: LucideIcon;
  label: string;
  hint: string;
  required?: boolean;
  value: number | null;
  onChange: (value: number | null) => void;
  onCommit?: () => void;
  disabled?: boolean;
  error?: string;
}) {
  const t = useTranslations("Admin");
  const look =
    tone === "success"
      ? { ground: "bg-success/6", plate: "bg-success text-white", ink: "text-success", ring: "focus-visible:border-success" }
      : { ground: "bg-warning/6", plate: "bg-warning text-white", ink: "text-warning", ring: "focus-visible:border-warning" };
  return (
    <label className={cn("block border-b-2 border-line px-4 py-3.5 last:border-b-0", look.ground)}>
      <span className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <span className="flex min-w-0 items-center gap-3">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-control", look.plate)}>
            <Icon className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className={cn("block text-[1.08rem] font-black leading-tight", look.ink)}>
              {label}
              {required && <span className="text-brand"> *</span>}
            </span>
            <span className="block text-[0.72rem] font-semibold leading-snug text-muted">{hint}</span>
          </span>
        </span>
        <span className="relative block">
          <MoneyInput
            value={value}
            clearable
            onChange={onChange}
            onCommit={onCommit}
            min={0}
            disabled={disabled}
            className={cn("h-14 bg-surface pr-14 text-[1.45rem] font-black", look.ring)}
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[0.82rem] font-extrabold text-muted">
            {t("currency")}
          </span>
        </span>
      </span>
      {error && (
        <span role="alert" className="mt-1.5 block text-[0.74rem] font-bold text-brand">
          {error}
        </span>
      )}
    </label>
  );
}

/** What an آجل ticket still owes, in one line with its action. */
export function OwedLine({ remaining, children }: { remaining: number; children?: ReactNode }) {
  const t = useTranslations("Admin");
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-card border px-3.5 py-2.5",
        remaining > 0 ? "border-warning/45 bg-warning/8" : "border-success/40 bg-success/8",
      )}
    >
      <HandCoins className={cn("size-5 shrink-0", remaining > 0 ? "text-warning" : "text-success")} aria-hidden />
      <span className="text-[0.86rem] font-black text-ink">{t("financeRemaining")}</span>
      <span className={cn("text-[1.1rem] font-black", remaining > 0 ? "text-warning" : "text-success")}>
        <span data-numeric>{formatPrice(remaining)}</span>{" "}
        <span className="text-[0.72rem] font-extrabold">{t("currency")}</span>
      </span>
      {children && <span className="ms-auto">{children}</span>}
    </div>
  );
}
