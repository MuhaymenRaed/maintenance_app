"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Banknote, CalendarClock, HandCoins, RotateCcw, ShieldCheck, Wallet } from "lucide-react";
import { ReportButtons, type CashMoveLine, type ProfitReport, type ReportJob } from "@/components/admin/profit-report";
import { PrinterSetupButton } from "@/components/admin/printer-setup";
import type { MoneyMove } from "@/lib/data/desk-board";
import type { DeskTotals } from "@/lib/data/repair-desk";
import { formatDayTime } from "@/lib/data/datetime";
import { statMoney } from "@/lib/data/stat-money";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DeskRow } from "@/lib/queries/repair-desk";
import { FigureGrid, signTone, signedMoney, TabHeading, type FigureCard } from "@/components/admin/maintenance/figure-cards";
import type { DeskShared } from "@/components/admin/maintenance/desk-shared";

/**
 * تقارير الخزينة — the safe (the shop, 2026-11-24): what came in during the
 * period and what each dinar was, so the day closes by comparing «واصل
 * بالخزنة» with the drawer.
 *
 * - **واصل نقد** — نقد tickets as they completed, and آجل tickets complete by
 *   the period's end: the repair's part of what came in.
 * - **واصل آجل** — what came in on آجل tickets still owing at the period's end.
 * - **الضمان الواصل** — the warranty's part of what came in.
 * - **مرتجع** — money handed back or taken on a later day than a ticket was
 *   booked: the one change the safe counts.
 * - **الديون** — what the tickets waiting for their customer still owe, now.
 */
const KIND_TONE: Record<MoneyMove["kind"], string> = {
  cash: "bg-success/12 text-success",
  settle: "bg-info/12 text-info",
  deposit: "bg-warning/14 text-warning",
  return: "bg-gold/18 text-gold-ink",
};

export function CashTab({
  shared,
  totals,
  moves,
  report,
  job,
  onDebts,
  onReturns,
}: {
  shared: DeskShared;
  totals: DeskTotals;
  moves: readonly MoneyMove[];
  report: ProfitReport;
  /** The cash report, as the shell built it — the same job Ctrl+P prints. */
  job: ReportJob;
  /** «الديون» — the tickets waiting for their customer. */
  onDebts: () => void;
  /** The «مرتجع» card — its tickets. */
  onReturns: () => void;
}) {
  const t = useTranslations("Admin");
  const { data, period, locale } = shared;
  const { desk } = data;
  const finance = desk.available.finance;
  const [kind, setKind] = useState<MoneyMove["kind"] | null>(null);

  const byId = useMemo(() => new Map(desk.rows.map((row) => [row.id, row])), [desk.rows]);
  const shown = kind ? moves.filter((move) => move.kind === kind) : moves;
  const counts = useMemo(() => {
    const out: Record<MoneyMove["kind"], { n: number; sum: number }> = {
      cash: { n: 0, sum: 0 },
      settle: { n: 0, sum: 0 },
      deposit: { n: 0, sum: 0 },
      return: { n: 0, sum: 0 },
    };
    for (const move of moves) {
      out[move.kind].n += 1;
      out[move.kind].sum += move.amount;
    }
    return out;
  }, [moves]);

  const cards: FigureCard[] = [
    {
      key: "till",
      Icon: Wallet,
      label: t("financeTill"),
      value: statMoney(totals.till),
      sub: t(totals.returnTill ? "financeTillFormulaReturns" : "financeTillFormula"),
      tone: "success",
      lead: true,
      returned: totals.returnTill,
    },
    { key: "cash", Icon: Banknote, label: t("financeCollectedCash"), value: statMoney(totals.collectedCash), sub: t("cashCashSub"), tone: "success" },
    {
      key: "deferred",
      Icon: CalendarClock,
      label: t("financeCollectedDeferred"),
      value: statMoney(totals.collectedDeferred),
      sub: totals.missingCollected > 0 ? t("deskMissingCollectedSub", { count: totals.missingCollected }) : t("cashDeferredSub"),
      tone: totals.missingCollected > 0 ? "warning" : "info",
    },
    { key: "warranty", Icon: ShieldCheck, label: t("cashWarrantyIn"), value: statMoney(totals.tillWarranty), sub: t("cashWarrantySub"), tone: "info" },
    {
      key: "returns",
      Icon: RotateCcw,
      label: t("deskReturnsCard"),
      value: signedMoney(totals.returnTill),
      sub: t("deskReturnsTillSub"),
      tone: "gold",
      onPress: totals.returnTickets > 0 ? onReturns : undefined,
    },
    {
      key: "debts",
      Icon: HandCoins,
      label: t("financeOutstanding"),
      value: statMoney(totals.outstanding),
      sub: t("deskOwingSub", { count: totals.owing }),
      tone: totals.outstanding > 0 ? "warning" : "success",
      onPress: totals.owing > 0 ? onDebts : undefined,
    },
  ];

  return (
    <div className="space-y-3.5">
      <TabHeading
        Icon={Wallet}
        title={t("deskTab_cash")}
        hint={t("cashHint", { period })}
        aside={
          <>
            <ReportButtons report={report} job={job} />
            <PrinterSetupButton />
          </>
        }
      />

      {!finance ? (
        <p className="rounded-card border border-dashed border-warning/50 bg-warning/6 px-4 py-3 text-[0.8rem] font-bold text-warning">
          {t("financeUnavailable")}
        </p>
      ) : (
        <>
          <FigureGrid cards={cards} />
          {desk.book === null && <p className="text-[0.72rem] font-semibold text-muted">{t("deskLedgerMissing")}</p>}

          {/* Every movement of the period, in the order it happened. */}
          <section className="overflow-hidden rounded-panel border border-line bg-surface shadow-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <h3 className="text-[0.9rem] font-black text-ink">{t("cashMovesTitle")}</h3>
              <span className="text-[0.74rem] font-bold text-muted">{t("cashMovesCountLine", { count: moves.length })}</span>
              <div role="group" aria-label={t("cashMovesTitle")} className="ms-auto flex flex-wrap gap-1.5">
                <KindChip on={kind === null} onPress={() => setKind(null)} label={t("all")} n={moves.length} />
                {(["cash", "settle", "deposit", "return"] as const).map((key) =>
                  counts[key].n > 0 ? (
                    <KindChip
                      key={key}
                      on={kind === key}
                      onPress={() => setKind(kind === key ? null : key)}
                      label={t(`cashMove_${key}`)}
                      n={counts[key].n}
                      tone={KIND_TONE[key]}
                    />
                  ) : null,
                )}
              </div>
            </div>
            {shown.length === 0 ? (
              <p className="px-6 py-12 text-center text-[0.86rem] font-bold text-muted">{t("cashMovesEmpty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {[...shown].reverse().map((move) => {
                  const row = byId.get(move.ticketId);
                  return (
                    <li key={`${move.ticketId}-${move.at}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[0.8rem]">
                      <span className={cn("inline-flex shrink-0 items-center rounded-chip px-2 py-0.5 text-[0.68rem] font-extrabold", KIND_TONE[move.kind])}>
                        {t(`cashMove_${move.kind}`)}
                      </span>
                      <span className="font-extrabold text-info" data-numeric>
                        {row?.code ?? "—"}
                      </span>
                      <span className="font-bold text-ink">{row?.customerName ?? ""}</span>
                      <span className="text-muted">{row?.deviceModel ?? ""}</span>
                      {row?.holderName && <span className="text-[0.72rem] font-semibold text-muted">· {row.holderName}</span>}
                      <span className="text-[0.7rem] text-muted">{formatDayTime(locale, move.at)}</span>
                      <span className={cn("ms-auto font-black", signTone(move.amount) || "text-ink")} data-numeric>
                        {move.amount < 0 ? signedMoney(move.amount) : formatPrice(move.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function KindChip({ on, onPress, label, n, tone }: { on: boolean; onPress: () => void; label: string; n: number; tone?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPress}
      className={cn(
        "press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.74rem] font-extrabold transition-colors",
        on ? "border-brand bg-brand text-white" : "border-line bg-canvas text-ink hover:border-brand/45",
      )}
    >
      {!on && tone && <span className={cn("size-2 rounded-full", tone.split(" ")[0])} aria-hidden />}
      {label}
      <span data-numeric className={cn("font-black", on ? "text-white" : "text-muted")}>
        {n}
      </span>
    </button>
  );
}

/** The safe's movements as the cash report prints them. */
export function cashMoveLines(moves: readonly MoneyMove[], rows: readonly DeskRow[]): CashMoveLine[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return moves.map((move) => {
    const row = byId.get(move.ticketId);
    return {
      id: move.ticketId,
      code: row?.code ?? "",
      customer: row?.customerName ?? "",
      device: row?.deviceModel ?? "",
      employee: row?.holderName ?? "",
      kind: move.kind,
      amount: move.amount,
      at: move.at,
    };
  });
}
