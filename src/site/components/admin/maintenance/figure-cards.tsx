"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, RotateCcw, type LucideIcon } from "lucide-react";
import { describeReturn, type ReturnSummary } from "@/lib/data/desk-figures";
import type { DeskTotals } from "@/lib/data/repair-desk";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The cards the two report tabs are made of, and the pieces both share. A
 * card is a figure and the one line that says what it counts; a card that has
 * tickets behind it is a press to them.
 */
export type FigureTone = "info" | "success" | "brand" | "warning" | "muted" | "gold";

const ICON_TONE: Record<FigureTone, string> = {
  info: "bg-info/12 text-info",
  success: "bg-success/12 text-success",
  brand: "bg-brand/10 text-brand",
  warning: "bg-warning/14 text-warning",
  muted: "bg-subtle text-muted",
  gold: "bg-gold/20 text-gold-ink",
};

export type FigureCard = {
  key: string;
  Icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone: FigureTone;
  /** The figure the tab is about — drawn larger, on its own tint. */
  lead?: boolean;
  onPress?: () => void;
  /** What a «مرتجع» moved inside this figure — drawn as a chip. */
  returned?: number;
};

const LG_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-3",
  9: "lg:grid-cols-3",
};

export function FigureGrid({ cards }: { cards: readonly FigureCard[] }) {
  const t = useTranslations("Admin");
  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-2.5 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2",
        // Every row full on a laptop: five across, six as two threes, else fours.
        LG_COLUMNS[cards.length] ?? "lg:grid-cols-4",
      )}
    >
      {cards.map((card) => {
        const body = (
          <>
            <span className="flex items-center gap-2">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-control", ICON_TONE[card.tone])}>
                <card.Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 text-[0.74rem] font-extrabold leading-tight text-ink">{card.label}</span>
              {card.onPress && <ChevronLeft className="ms-auto size-4 shrink-0 text-muted ltr:rotate-180" aria-hidden />}
            </span>
            <span
              className={cn("font-black leading-tight text-ink", card.lead ? "text-[1.6rem]" : "text-[1.3rem]")}
              data-numeric
            >
              {card.value}
            </span>
            {card.sub && (
              <span className={cn("text-[0.68rem] font-semibold leading-snug", card.tone === "warning" ? "text-warning" : "text-muted")}>
                {card.sub}
              </span>
            )}
            {card.returned ? (
              <span className="inline-flex w-fit items-center gap-1 rounded-chip bg-gold/15 px-2 py-0.5 text-[0.68rem] font-extrabold text-gold-ink">
                <RotateCcw className="size-3 shrink-0" aria-hidden />
                {t("deskTillReturns")}{" "}
                <span data-numeric className={signTone(card.returned)}>
                  {signedMoney(card.returned)}
                </span>
              </span>
            ) : null}
          </>
        );
        const frame = cn(
          "flex h-full min-w-0 flex-col gap-1.5 rounded-panel border p-3 text-start shadow-card",
          card.lead ? "border-brand/35 bg-brand/5" : "border-line bg-surface",
        );
        return (
          <li key={card.key} className="min-w-0">
            {card.onPress ? (
              <button
                type="button"
                onClick={card.onPress}
                className={cn(frame, "press w-full transition-colors hover:border-brand/50")}
              >
                {body}
              </button>
            ) : (
              <div className={frame}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The colour of a change: red when it takes money off, green when it adds.
 * Never the only sign of it: the figure carries its own "+" or "-".
 */
export function signTone(n: number): string {
  return n < 0 ? "text-brand" : n > 0 ? "text-success" : "";
}

/** A change, with its sign: "+10,000", "-30,000". */
export function signedMoney(n: number): string {
  const value = formatPrice(Math.abs(Math.round(n)));
  return n > 0 ? `+${value}` : n < 0 ? `-${value}` : value;
}

/**
 * «مرتجع» — a change made on a later day to a ticket already booked: the
 * price moved, it was cancelled, it was reopened. It counts in none of the
 * period's figures but the safe; this card says what changed, brought down
 * (سلبي) apart from brought up (إيجابي).
 */
export function ReturnsCard({
  totals,
  finance,
  warranty,
  onPress,
}: {
  totals: DeskTotals;
  finance: boolean;
  warranty: boolean;
  onPress?: () => void;
}) {
  const t = useTranslations("Admin");
  if (totals.returnTickets <= 0) return null;
  const inner = (
    <>
      <span className="flex min-w-0 flex-wrap items-center gap-2.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold/20">
          <RotateCcw className="size-5 text-gold-ink" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[0.86rem] font-black text-ink">
            {t("deskReturnsCard")} · {t("deskReturnsTickets", { count: totals.returnTickets })}
          </span>
          <span className="block text-[0.7rem] font-semibold text-muted">{t("deskReturnsApart")}</span>
        </span>
        {onPress && <span className="ms-auto shrink-0 text-[0.72rem] font-extrabold text-brand">{t("deskReturnsShow")}</span>}
      </span>
      <span className="flex min-w-0 flex-wrap gap-2">
        {totals.returnDownTickets > 0 && (
          <ReturnTotal
            tone="down"
            label={t("deskReturnsNegative")}
            amount={totals.returnDown}
            sub={t("deskReturnsTickets", { count: totals.returnDownTickets })}
          />
        )}
        {totals.returnUpTickets > 0 && (
          <ReturnTotal
            tone="up"
            label={t("deskReturnsPositive")}
            amount={totals.returnUp}
            sub={t("deskReturnsTickets", { count: totals.returnUpTickets })}
          />
        )}
        {finance && (
          <ReturnTotal tone="till" label={t("deskReturnsTill")} amount={totals.returnTill} sub={t("deskReturnsTillSub")} />
        )}
      </span>
      {(totals.returnCancelled > 0 || (warranty && totals.returnWarranty !== 0)) && (
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] font-bold text-muted">
          {totals.returnCancelled > 0 && <span>{t("deskReturnsCancelled", { count: totals.returnCancelled })}</span>}
          {warranty && totals.returnWarranty !== 0 && (
            <span>
              {t("deskReturnsWarranty")}{" "}
              <span data-numeric className={signTone(totals.returnWarranty)}>
                {signedMoney(totals.returnWarranty)}
              </span>
            </span>
          )}
        </span>
      )}
    </>
  );
  const frame = "flex w-full min-w-0 flex-col gap-2.5 rounded-panel border border-gold-ink/45 bg-gold/8 p-3 text-start shadow-card";
  return onPress ? (
    <button type="button" onClick={onPress} className={cn(frame, "press transition-colors hover:border-gold-ink")}>
      {inner}
    </button>
  ) : (
    <div className={frame}>{inner}</div>
  );
}

function ReturnTotal({
  tone,
  label,
  amount,
  sub,
}: {
  tone: "down" | "up" | "till";
  label: string;
  amount: number;
  sub: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-[10rem] flex-1 flex-col gap-0.5 rounded-card border px-3 py-2",
        tone === "down" ? "border-brand/35 bg-brand/6" : tone === "up" ? "border-success/35 bg-success/6" : "border-line bg-surface",
      )}
    >
      <span className={cn("text-[0.72rem] font-extrabold", tone === "down" ? "text-brand" : tone === "up" ? "text-success" : "text-ink")}>
        {label}
      </span>
      <span className={cn("text-[1.15rem] font-black leading-tight", signTone(amount) || "text-ink")} data-numeric>
        {signedMoney(amount)}
      </span>
      <span className="text-[0.66rem] font-semibold text-muted">{sub}</span>
    </span>
  );
}

/** What one «مرتجع» was, in words: "Price 50,000 → 60,000", "Cancelled after it was completed". */
export function ReturnWords({ summary, money }: { summary: ReturnSummary; money: (n: number) => string }) {
  const t = useTranslations("Admin");
  const described = describeReturn(summary);
  if (described.kind !== "edit") return <>{t(`deskReturnKind_${described.kind}`)}</>;
  return (
    <>
      {described.changes.map((change, index) => (
        <span key={change.field}>
          {index > 0 && " · "}
          {t(`deskReturnField_${change.field}`)}{" "}
          <span data-numeric>{money(change.from)}</span> {t("deskReturnArrow")} <span data-numeric>{money(change.to)}</span>
        </span>
      ))}
    </>
  );
}

/** A tab's heading: what it is, in one line, and what the period is. */
export function TabHeading({
  Icon,
  title,
  hint,
  aside,
}: {
  Icon: LucideIcon;
  title: string;
  hint?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-card bg-brand/10 text-brand">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="text-[1.02rem] font-black text-ink">{title}</h2>
        {hint && <p className="text-[0.76rem] font-medium text-muted">{hint}</p>}
      </div>
      {aside && <div className="ms-auto flex flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}

/**
 * «منها 2 من أيام سابقة · 1 اكتملت لاحقاً» — what a period's completed count
 * holds beyond its own tickets, or null when it holds nothing else. A ticket
 * counts on the day it was opened and on the later day it completed (the
 * shop, 2026-11-25), and its money only on the second — so the count and the
 * amounts beside it differ by exactly what this names.
 */
export function useCompletedSplit(): (totals: Pick<DeskTotals, "completedEarlier" | "completedLater">) => string | null {
  const t = useTranslations("Admin");
  return (totals) => {
    const parts: string[] = [];
    if (totals.completedEarlier > 0) parts.push(t("deskCompletedFromEarlier", { count: String(totals.completedEarlier) }));
    if (totals.completedLater > 0) parts.push(t("deskCompletedLaterCount", { count: String(totals.completedLater) }));
    return parts.length ? parts.join(" · ") : null;
  };
}
