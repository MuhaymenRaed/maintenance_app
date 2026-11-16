"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { ClipboardList, Loader2 } from "lucide-react";
import { CompanyLockup } from "@/components/admin/repair-print";
import { repairMoney, type PaymentTerms } from "@/lib/data/repair-desk";
import { baghdadDay } from "@/lib/data/date-window";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * جرد الأرباح — the bench's profit report, on A4, for whatever the filters on
 * the page are showing.
 *
 * ---------------------------------------------------------------------------
 * What it is built from
 * ---------------------------------------------------------------------------
 * The rows the board already holds. The desk page reads every ticket in the
 * chosen window — the period, the technician, cash or deferred, the status,
 * the search — so "the report for what I filtered" is exactly the list on
 * screen. That is also what makes it the same report in the desktop app,
 * which draws its board from this computer's copy of the bench.
 *
 * ---------------------------------------------------------------------------
 * What it prints
 * ---------------------------------------------------------------------------
 * The shop's old program's report, column for column — the employee, the
 * amount, the profit without the warranty, the device, the fault, the date —
 * plus the warranty on each row, and the totals at the foot with the warranty
 * total the shop asked to be added:
 *
 * - **مبلغ الصيانة** is what the customer is charged, the warranty included,
 *   as on every other screen here (`actual_cost`).
 * - **الربح بدون الضمان** is the repair alone less what its part cost — the
 *   warranty is its own account and never profit (`repairMoney`).
 * - ⚠️ A ticket with no cost typed shows a dash and is left out of the net
 *   profit, said in words at the foot, rather than counted as if its part were
 *   free. The board's profit card makes the same call (`missingCost`).
 * - Cancelled tickets are not on it: they carry no money and were not repaired.
 *
 * Printed through the browser's own dialog, not the print station: this is a
 * report for an office printer on ordinary paper, and it runs to as many pages
 * as the filters ask for. The table's header repeats on every page.
 */
export type ReportContext = {
  /** Which bench — the repair desk or the programming desk. */
  desk: string;
  /** The period, in words. */
  period: string;
  /** Any other filter in force, in words — "Technician: Ali". */
  filters: string[];
};

/** What the report needs of a ticket — a structural slice of the board's row. */
export type ReportSourceRow = {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  holderName: string | null;
  deviceModel: string;
  issues: string[];
  customFaults: string[];
  price: number | null;
  warrantyPrice: number | null;
  costPrice: number | null;
  collected: number | null;
  paymentTerms: PaymentTerms;
};

type ReportRow = {
  id: string;
  code: string;
  employee: string;
  amount: number | null;
  warranty: number;
  profit: number | null;
  device: string;
  fault: string;
  day: string;
};

type Totals = {
  count: number;
  amount: number;
  warranty: number;
  profit: number;
  missingCost: number;
  outstanding: number;
};

/** The rows, in the order they came in, and the totals over them. */
export function buildProfitReport(
  rows: readonly ReportSourceRow[],
  unassigned: string,
): { rows: ReportRow[]; totals: Totals } {
  const totals: Totals = { count: 0, amount: 0, warranty: 0, profit: 0, missingCost: 0, outstanding: 0 };
  const out: ReportRow[] = [];
  const kept = rows
    .filter((row) => row.status !== "cancelled" && row.status !== "declined")
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const row of kept) {
    const money = repairMoney({
      price: row.price,
      warranty: row.warrantyPrice,
      cost: row.costPrice,
      collected: row.collected,
      terms: row.paymentTerms,
    });
    const priced = row.price != null;
    const profit = priced && money.cost != null ? money.base - money.cost : null;
    totals.count += 1;
    totals.amount += money.price;
    totals.warranty += money.warranty;
    totals.outstanding += money.remaining;
    if (profit != null) totals.profit += profit;
    else if (priced && money.base > 0) totals.missingCost += 1;

    out.push({
      id: row.id,
      code: row.code,
      employee: row.holderName?.trim() || unassigned,
      amount: priced ? money.price : null,
      warranty: money.warranty,
      profit,
      device: row.deviceModel,
      fault: [...row.issues, ...row.customFaults].filter(Boolean).join("، "),
      day: baghdadDay(Date.parse(row.createdAt)),
    });
  }
  return { rows: out, totals };
}

export function ProfitReportButton({
  rows,
  context,
  className,
}: {
  rows: readonly ReportSourceRow[];
  context: ReportContext;
  className?: string;
}) {
  const t = useTranslations("Admin");
  /** The moment the press was made — stamped on the paper. Null when idle. */
  const [printedAt, setPrintedAt] = useState<number | null>(null);
  const empty = !rows.some((row) => row.status !== "cancelled" && row.status !== "declined");

  return (
    <>
      <button
        type="button"
        onClick={() => setPrintedAt(Date.now())}
        disabled={printedAt !== null || empty}
        aria-busy={printedAt !== null}
        title={empty ? t("profitReportEmpty") : t("profitReportHint")}
        className={cn(
          "press inline-flex items-center gap-2 rounded-control border border-brand/40 bg-brand/6 px-3.5 py-2 text-[0.8rem] font-extrabold text-brand transition-colors hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        {printedAt !== null ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ClipboardList className="size-4" aria-hidden />
        )}
        {t("profitReport")}
      </button>
      {printedAt !== null && (
        <ProfitReportSheet
          rows={rows}
          context={context}
          printedAt={printedAt}
          onDone={() => setPrintedAt(null)}
        />
      )}
    </>
  );
}

/** Long enough for `window.print()` to have returned before the sheet goes. */
const SETTLE_MS = 400;

export function ProfitReportSheet({
  rows,
  context,
  printedAt,
  onDone,
}: {
  rows: readonly ReportSourceRow[];
  context: ReportContext;
  printedAt: number;
  onDone: () => void;
}) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const sheet = useRef<HTMLDivElement>(null);
  const report = useRef<() => void>(undefined);
  useEffect(() => {
    report.current = onDone;
  });

  // The same arrangement the ticket papers use: after the commit, once, and
  // cancellable — StrictMode would otherwise open two print dialogs.
  useEffect(() => {
    let spent = false;
    let stopped = false;
    const timers: number[] = [];
    const end = () => {
      if (spent) return;
      spent = true;
      timers.push(window.setTimeout(() => report.current?.(), SETTLE_MS));
    };
    window.addEventListener("afterprint", end);
    timers.push(
      window.setTimeout(() => {
        void (document.fonts?.ready ?? Promise.resolve()).then(() => {
          if (stopped) return;
          window.print();
          end();
        });
      }, 0),
    );
    return () => {
      stopped = true;
      spent = true;
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("afterprint", end);
    };
  }, []);

  const { rows: lines, totals } = buildProfitReport(rows, t("unassigned"));
  const money = (value: number) => formatPrice(Math.round(value));
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })
    .format(printedAt)
    .toUpperCase();

  const th = "border border-black/70 bg-[#e11d2e] px-[1.6mm] py-[1.4mm] text-[8.6pt] font-bold text-white";
  const td = "border border-black/45 px-[1.6mm] py-[1.2mm] align-middle text-[8.6pt] font-semibold text-black";

  return createPortal(
    <div ref={sheet} className="print-sheet" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
      <style>{`@page { size: A4 portrait; margin: 10mm 9mm 12mm; }
.profit-report thead { display: table-header-group; }
.profit-report tr { break-inside: avoid; }
.profit-report tfoot { display: table-row-group; }`}</style>

      <div className="profit-report text-black">
        <header className="flex items-center justify-between gap-[6mm]">
          <div className="min-w-0">
            <p className="inline-block rounded-[1mm] bg-[#e11d2e] px-[2.4mm] py-[0.8mm] text-[8.4pt] font-bold text-white">
              {context.desk}
            </p>
            <h1 className="mt-[1.6mm] text-[19pt] font-bold leading-none text-black">
              {t("profitReport")}
            </h1>
          </div>

          <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-[2mm] gap-y-[1mm] text-[8.6pt]">
            <dt className="rounded-[1mm] border border-black/60 px-[2mm] py-[0.6mm] font-bold">
              {t("profitReportPrinted")}
            </dt>
            <dd className="self-center whitespace-nowrap font-bold" data-numeric>
              {baghdadDay(printedAt)}
            </dd>
            <dt className="rounded-[1mm] border border-black/60 px-[2mm] py-[0.6mm] font-bold text-[#e11d2e]">
              {t("profitReportTime")}
            </dt>
            <dd className="self-center whitespace-nowrap font-bold" data-numeric>
              {clock}
            </dd>
          </dl>

          <CompanyLockup markClass="size-[15mm]" />
        </header>

        <div className="mt-[3mm] flex h-[0.6mm]" aria-hidden>
          <span className="flex-1 bg-[#e11d2e]" />
          <span className="w-[30mm] bg-[#333333]" />
        </div>

        <p className="mt-[2.4mm] flex flex-wrap gap-x-[4mm] gap-y-[1mm] text-[8.6pt] font-semibold">
          <span>
            <span className="font-bold">{t("profitReportPeriod")}:</span> {context.period}
          </span>
          {context.filters.map((filter) => (
            <span key={filter}>{filter}</span>
          ))}
        </p>

        <table className="mt-[3mm] w-full border-collapse text-start">
          <thead>
            <tr>
              <th className={cn(th, "w-[7mm] text-center")}>#</th>
              <th className={cn(th, "text-start")}>{t("profitReportColEmployee")}</th>
              <th className={cn(th, "text-center")}>{t("profitReportColAmount")}</th>
              <th className={cn(th, "text-center")}>{t("profitReportColWarranty")}</th>
              <th className={cn(th, "text-center")}>{t("profitReportColProfit")}</th>
              <th className={cn(th, "text-center")}>{t("profitReportColDevice")}</th>
              <th className={cn(th, "text-center")}>{t("profitReportColFault")}</th>
              <th className={cn(th, "text-center")}>{t("profitReportColDate")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.id} className={index % 2 ? "bg-[#fdeff1]" : undefined}>
                <td className={cn(td, "text-center")} data-numeric>
                  {index + 1}
                </td>
                <td className={cn(td, "font-bold")}>{line.employee}</td>
                <td className={cn(td, "text-center font-bold")} data-numeric>
                  {line.amount == null ? "—" : money(line.amount)}
                </td>
                <td className={cn(td, "text-center")} data-numeric>
                  {line.warranty > 0 ? money(line.warranty) : "—"}
                </td>
                <td className={cn(td, "text-center font-bold")} data-numeric>
                  {line.profit == null ? "—" : money(line.profit)}
                </td>
                <td className={cn(td, "text-center font-bold")} dir="ltr">
                  {line.device}
                </td>
                <td className={cn(td, "text-center")}>{line.fault || "—"}</td>
                <td className={cn(td, "whitespace-nowrap text-center")} data-numeric>
                  {line.day}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-[5mm] break-inside-avoid border-t-[0.5mm] border-black pt-[3mm]">
          <dl className="ms-auto grid w-[96mm] grid-cols-[1fr_auto] gap-y-[1.4mm] text-[9.4pt]">
            <Total label={t("profitReportTotalAmount")} value={money(totals.amount)} />
            <Total label={t("profitReportTotalWarranty")} value={money(totals.warranty)} />
            <Total label={t("profitReportTotalProfit")} value={money(totals.profit)} strong />
            <Total label={t("profitReportTotalCount")} value={String(totals.count)} />
            {totals.outstanding > 0 && (
              <Total label={t("profitReportOutstanding")} value={money(totals.outstanding)} />
            )}
          </dl>
          {totals.missingCost > 0 && (
            <p className="mt-[2.4mm] text-[8.4pt] font-semibold">
              {t("profitReportMissingCost", { count: totals.missingCost })}
            </p>
          )}
          <p className="mt-[1mm] text-[8.4pt] font-semibold">{t("profitReportCancelledNote")}</p>
        </section>
      </div>
    </div>,
    document.body,
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className="rounded-s-[1mm] border border-black/70 px-[2.4mm] py-[1mm] font-bold">{label}</dt>
      <dd
        className={cn(
          "flex items-center justify-end rounded-e-[1mm] border border-s-0 border-black/70 px-[2.4mm] py-[1mm] font-bold",
          strong && "text-[#e11d2e]",
        )}
        data-numeric
      >
        {value}
      </dd>
    </>
  );
}
