"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  CircleCheckBig,
  CircleDollarSign,
  ListChecks,
  Loader2,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";
import { ReportButtons, type ProfitReport, type ReportJob } from "@/components/admin/profit-report";
import { PrinterSetupButton } from "@/components/admin/printer-setup";
import { searchDeskTickets } from "@/lib/actions/repair-desk";
import { filterTickets } from "@/lib/data/desk-board";
import type { FigureHolderRow } from "@/lib/data/desk-figures";
import { repairMoney, type DeskTotals, type RepairService } from "@/lib/data/repair-desk";
import { formatDayTime } from "@/lib/data/datetime";
import { formatPrice } from "@/lib/format";
import { statMoney } from "@/lib/data/stat-money";
import { cn } from "@/lib/utils";
import type { DeskRow } from "@/lib/queries/repair-desk";
import { FigureGrid, TabHeading, useCompletedSplit, type FigureCard } from "@/components/admin/maintenance/figure-cards";
import type { DeskShared } from "@/components/admin/maintenance/desk-shared";

/**
 * تقارير الأرباح — what the period booked (the shop, 2026-11-24): the tickets
 * that became «مكتمل» in it, as they stood at the end of that day. Nothing
 * else counts here — a ticket on the bench, waiting for its customer or
 * cancelled earns nothing until it is complete.
 *
 * جرد الأرباح prints the same tickets on A4 or A5 by the paper printer, or as
 * a PDF; a report of hand-picked tickets is folded under it.
 */
export function ProfitTab({
  shared,
  totals,
  byTech,
  report,
  job,
  onCompleted,
}: {
  shared: DeskShared;
  totals: DeskTotals;
  byTech: readonly FigureHolderRow[];
  report: ProfitReport;
  /** جرد الأرباح, as the shell built it — the same job Ctrl+P prints. */
  job: ReportJob;
  /** The completed tickets behind the figures. */
  onCompleted: () => void;
}) {
  const t = useTranslations("Admin");
  const split = useCompletedSplit();
  const { data, money, period, locale } = shared;
  const { desk } = data;
  const finance = desk.available.finance;

  const cards: FigureCard[] = [
    {
      key: "completed",
      Icon: CircleCheckBig,
      label: t("profitCompletedCount"),
      value: formatPrice(totals.completed),
      // A ticket counts on the day it was opened and on the later day it
      // completed (the shop, 2026-11-25); the card says which, because the
      // amounts beside it count each ticket once — on its completion day.
      sub: split(totals) ?? t("profitCompletedSub"),
      tone: "success",
      onPress: totals.completed > 0 ? onCompleted : undefined,
    },
    {
      key: "maintenance",
      Icon: CircleDollarSign,
      label: t("financePriceTotal"),
      value: statMoney(totals.maintenance),
      sub: t("deskMaintenanceSub"),
      tone: "brand",
    },
    ...(finance
      ? [
          {
            key: "cost",
            Icon: Receipt,
            label: t("financeCostTotal"),
            value: statMoney(totals.cost),
            sub: totals.missingCost > 0 ? t("deskMissingCostSub", { count: totals.missingCost }) : t("profitCostSub"),
            tone: totals.missingCost > 0 ? ("warning" as const) : ("muted" as const),
          },
          {
            key: "profit",
            Icon: TrendingUp,
            label: t("financeProfitTotal"),
            value: statMoney(totals.profit),
            sub: totals.missingCost > 0 ? t("deskProfitMissing", { count: totals.missingCost }) : t("deskProfitFormula"),
            tone: totals.profit < 0 ? ("brand" as const) : ("success" as const),
            lead: true,
          },
        ]
      : []),
    ...(desk.available.warranty
      ? [
          {
            key: "warranty",
            Icon: ShieldCheck,
            label: t("warrantyTitle"),
            value: statMoney(totals.warranty),
            sub: t("deskWarrantySub", { count: totals.warrantyTickets }),
            tone: "info" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-3.5">
      <TabHeading
        Icon={TrendingUp}
        title={t("deskTab_profit")}
        hint={t("profitHint", { period })}
        aside={
          <>
            <ReportButtons report={report} job={job} />
            <PrinterSetupButton />
          </>
        }
      />

      <FigureGrid cards={cards} />
      <p className="text-[0.72rem] font-semibold text-muted">
        {t("profitRule")} · {t("printChooserShortcut")}
      </p>

      {byTech.length > 0 && (
        <PersonTable rows={byTech} finance={finance} warranty={desk.available.warranty} />
      )}

      <PickedReport
        service={data.service}
        locale={locale}
        report={report}
        desk={shared.deskName}
        pool={desk.rows}
        money={money}
      />
    </div>
  );
}

/** The period's booked figures, one row per holder, nobody's last. */
function PersonTable({
  rows,
  finance,
  warranty,
}: {
  rows: readonly FigureHolderRow[];
  finance: boolean;
  warranty: boolean;
}) {
  const t = useTranslations("Admin");
  const shown = rows.filter((row) => row.completed > 0 || row.tickets > 0);
  if (!shown.length) return null;
  return (
    <section className="overflow-hidden rounded-panel border border-line bg-surface shadow-card">
      <h3 className="border-b border-line px-4 py-2.5 text-[0.88rem] font-black text-ink">{t("deskByTech")}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] text-[0.8rem]">
          <thead>
            <tr className="text-[0.7rem] font-bold text-muted">
              <th className="px-4 py-2 text-start">{t("deskHolder")}</th>
              <th className="px-3 py-2 text-end">{t("profitCompletedCount")}</th>
              <th className="px-3 py-2 text-end">{t("financePriceTotal")}</th>
              {warranty && <th className="px-3 py-2 text-end">{t("warrantyTitle")}</th>}
              {finance && <th className="px-3 py-2 text-end">{t("financeCostTotal")}</th>}
              {finance && <th className="px-3 py-2 text-end">{t("financeProfitTotal")}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.holderId ?? "none"} className="border-t border-line/70">
                <td className="px-4 py-2 font-extrabold text-ink">{row.holderId ? row.name || t("workColleague") : t("unassigned")}</td>
                <td className="px-3 py-2 text-end font-bold" data-numeric>
                  {formatPrice(row.completed)}
                </td>
                <td className="px-3 py-2 text-end font-bold" data-numeric>
                  {formatPrice(row.maintenance)}
                </td>
                {warranty && (
                  <td className="px-3 py-2 text-end font-bold text-info" data-numeric>
                    {formatPrice(row.warranty)}
                  </td>
                )}
                {finance && (
                  <td className="px-3 py-2 text-end font-bold text-muted" data-numeric>
                    {formatPrice(row.cost)}
                  </td>
                )}
                {finance && (
                  <td className={cn("px-3 py-2 text-end font-black", row.profit < 0 ? "text-brand" : "text-success")} data-numeric>
                    {formatPrice(row.profit)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * «طباعة تقرير لتذاكر محددة» — the shop, 2026-11-20: "an option to print an
 * exact ticket or a group of tickets' statistics, collapsed until it is
 * needed, the tickets added by a smart search by name, phone, device, code".
 * A search looks at the tickets the page holds first, at once, then at every
 * ticket on the bench (`searchDeskTickets`).
 */
function PickedReport({
  service,
  locale,
  report,
  desk,
  pool,
  money,
}: {
  service: RepairService;
  locale: string;
  report: ProfitReport;
  desk: string;
  pool: readonly DeskRow[];
  money: (n: number) => string;
}) {
  const t = useTranslations("Admin");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; rows: DeskRow[] } | null>(null);
  const [picked, setPicked] = useState<DeskRow[]>([]);
  const [searching, startSearch] = useTransition();

  const needle = query.trim();
  const local =
    needle.length >= 2
      ? filterTickets(pool, { terms: null, holder: null, handed: null, edited: false, mine: false, search: needle }, "")
      : [];
  const remote = found && found.query === needle ? found.rows : [];
  const seen = new Set<string>();
  const results = [...local, ...remote].filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true))).slice(0, 30);
  const pickedIds = new Set(picked.map((row) => row.id));

  // Every ticket on the bench, a moment after the typing stops.
  useEffect(() => {
    if (needle.length < 2) return;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const answer = await searchDeskTickets(service, needle, locale);
        if (answer.ok) setFound({ query: needle, rows: answer.rows });
      });
    }, 280);
    return () => clearTimeout(timer);
  }, [needle, service, locale]);

  const job: ReportJob = {
    rows: picked,
    context: { desk, period: t("deskPickPeriod", { count: picked.length }), filters: [] },
    includeCancelled: true,
  };
  const add = (row: DeskRow) => setPicked((current) => (current.some((item) => item.id === row.id) ? current : [...current, row]));

  return (
    <section className="rounded-panel border border-dashed border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-start text-[0.84rem] font-extrabold text-ink"
      >
        <ListChecks className="size-4 shrink-0 text-brand" aria-hidden />
        {t("deskPickTitle")}
        {picked.length > 0 && (
          <span className="rounded-full bg-brand px-2 py-0.5 text-[0.66rem] font-black text-white" data-numeric>
            {picked.length}
          </span>
        )}
        <ChevronDown className={cn("ms-auto size-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-4 pb-4 pt-3">
          <p className="text-[0.74rem] font-medium text-muted">{t("deskPickHint")}</p>
          <label className="relative block">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("deskPickSearch")}
              aria-label={t("deskPickSearch")}
              className="h-10 w-full rounded-control border border-line bg-canvas ps-9 pe-9 text-[0.82rem] font-bold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            {searching && <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
          </label>

          {needle.length >= 2 && (
            <ul className="max-h-64 space-y-1 overflow-y-auto overscroll-contain">
              {results.length === 0 && !searching && (
                <li className="px-1 py-2 text-[0.76rem] font-bold text-muted">{t("deskPickEmpty")}</li>
              )}
              {results.map((row) => {
                const already = pickedIds.has(row.id);
                const total = repairMoney({
                  price: row.price,
                  warranty: row.warrantyPrice,
                  cost: row.costPrice,
                  collected: row.collected,
                  terms: row.paymentTerms,
                  completed: row.status === "completed",
                }).price;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => add(row)}
                      className="press flex w-full flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-control px-2 py-1.5 text-start text-[0.78rem] transition-colors hover:bg-brand/6 disabled:opacity-50"
                    >
                      {already ? (
                        <CircleCheckBig className="size-4 shrink-0 text-success" aria-hidden />
                      ) : (
                        <Plus className="size-4 shrink-0 text-brand" aria-hidden />
                      )}
                      <span className="font-extrabold text-info" data-numeric>
                        {row.code}
                      </span>
                      <span className="font-bold text-ink">{row.customerName}</span>
                      <span className="text-muted">{row.deviceModel}</span>
                      <span className="text-[0.7rem] text-muted">{formatDayTime(locale, row.createdAt)}</span>
                      {total > 0 && (
                        <span className="ms-auto font-black text-brand" data-numeric>
                          {money(total)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {picked.length > 0 && (
            <div className="space-y-2.5">
              <ul className="flex flex-wrap gap-1.5">
                {picked.map((row) => (
                  <li
                    key={row.id}
                    className="inline-flex items-center gap-1.5 rounded-chip border border-brand/30 bg-brand/6 py-0.5 ps-2 pe-1 text-[0.72rem] font-bold text-ink"
                  >
                    <span className="text-info" data-numeric>
                      {row.code}
                    </span>
                    <span className="max-w-32 truncate">{row.customerName}</span>
                    <button
                      type="button"
                      onClick={() => setPicked((current) => current.filter((item) => item.id !== row.id))}
                      aria-label={t("deskPickRemove", { code: row.code })}
                      className="press rounded-full p-0.5 text-muted hover:bg-brand hover:text-white"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <ReportButtons report={report} job={job} />
                <button
                  type="button"
                  onClick={() => setPicked([])}
                  className="rounded-control px-3 py-2 text-[0.76rem] font-bold text-muted hover:bg-subtle hover:text-ink"
                >
                  {t("deskPickClear")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
