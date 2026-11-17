"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Download,
  FileText,
  Loader2,
  Printer,
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  CompanyMark,
  Letterhead,
  PaperEyebrow,
  PaperFrame,
  PaperRule,
  PaperStamps,
  PaperTitle,
} from "@/components/admin/repair-print";
import { repairMoney, type PaymentTerms } from "@/lib/data/repair-desk";
import { baghdadDay } from "@/lib/data/date-window";
import { formatPrice } from "@/lib/format";
import {
  agentEverSeen,
  agentStatus,
  AGENT_START_MS,
  listPrinters,
  lostContact,
  sendJob,
  waitForAgent,
  wakeAgent,
} from "@/lib/print/agent-client";
import type { PrinterInfo } from "@/lib/print/printer-match";
import type { PdfImagePage } from "@/lib/print/pdf";
import { paginate, REPORT_PAPERS, type ReportPaper } from "@/lib/print/report-pages";
import { connectionProblem, openPrinterSetup, printerState, resolvePrinters } from "@/lib/print/station";
import type { StationSettings } from "@/lib/print/station-settings";
import { stationSettings, stationSettingsStore } from "@/lib/print/station-store";
import { cn } from "@/lib/utils";

/**
 * جرد الأرباح — the bench's profit report, for whatever the filters on the
 * page are showing, printed straight to the counter's printer, through the
 * print dialog on A4, or saved as a PDF.
 *
 * ---------------------------------------------------------------------------
 * What it is built from
 * ---------------------------------------------------------------------------
 * The rows the board already holds. The desk page reads every ticket in the
 * chosen window — the period, the technician, cash or deferred, the status,
 * the search — so "the report for what I filtered" is exactly the list on
 * screen. That is also what makes it the same report in the desktop app,
 * which draws its board from this computer's copy of the bench. The rows are
 * frozen at the press: a live refresh mid-print must not move a row between
 * pages that were already measured.
 *
 * ---------------------------------------------------------------------------
 * What it prints
 * ---------------------------------------------------------------------------
 * The shop's old program's report, column for column — the employee, the
 * amount, the profit without the warranty, the device, the fault, the date —
 * plus the warranty on each row, and the totals with the warranty total the
 * shop asked to be added:
 *
 * - **مبلغ الصيانة** is what the customer is charged, the warranty included,
 *   as on every other screen here (`actual_cost`).
 * - **الربح بدون الضمان** is the repair alone less what its part cost — the
 *   warranty is its own account and never profit (`repairMoney`).
 * - ⚠️ A ticket with no cost typed shows a dash and is left out of the net
 *   profit, said in words beside the totals, rather than counted as if its
 *   part were free. The board's profit card makes the same call.
 * - Cancelled tickets are not on it: they carry no money and were not repaired.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ The totals open the report, on the reader's start
 * ---------------------------------------------------------------------------
 * They were a block at the foot of the last page, pushed to the end side —
 * the LEFT of an Arabic page, the last place an Arabic reader looks, and on a
 * long report two pages from the title. The shop asked on 2026-11-17 for them
 * at the start, on the right. They are now a row of five figures under the
 * letterhead of the first page, read from the right like everything else.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ It lays out its own pages — see `lib/print/report-pages.ts`
 * ---------------------------------------------------------------------------
 * One long table with 10 mm page margins left the paging to the browser, and
 * Chrome writes its own date, title and address into a page margin: the
 * report opened under a line of browser furniture, which is the "corrupted"
 * look in the shop's screenshot. Each page is now drawn as exactly one sheet
 * and printed with no page margin at all, so there is nowhere for that line
 * to go — and the same pages can be pictured for the print agent or a PDF.
 *
 * Pages are measured, not counted: every row's real height is read off an
 * off-screen copy of the table (a long fault takes two or three lines), and
 * `paginate` fills each page to what it holds. The columns are fixed widths
 * (`table-fixed`), so a row is the same height on its page as when measured.
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

type BuiltReport = { rows: ReportRow[]; totals: Totals };

/** The rows, in the order they came in, and the totals over them. */
export function buildProfitReport(rows: readonly ReportSourceRow[], unassigned: string): BuiltReport {
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

/* ── The three ways out ───────────────────────────────────────────────────── */

type ReportMode = "direct" | "a4" | "pdf";

const MODES: { mode: ReportMode; Icon: LucideIcon }[] = [
  { mode: "direct", Icon: Printer },
  { mode: "a4", Icon: FileText },
  { mode: "pdf", Icon: Download },
];

type ReportTask = {
  id: string;
  mode: ReportMode;
  paper: ReportPaper;
  printedAt: number;
  rows: readonly ReportSourceRow[];
  context: ReportContext;
  deliver: (pages: HTMLElement[]) => void;
  fail: (error: Error) => void;
};

type ReportStatus =
  | { tone: "busy"; text: string }
  | { tone: "done"; text: string }
  | { tone: "error"; title: string; detail: string | null; setup: boolean; others: boolean };

/** A failure that already knows how to say itself. */
class ReportFailure extends Error {
  constructor(
    readonly title: string,
    readonly detail: string | null = null,
    readonly setup = false,
  ) {
    super(title);
  }
}

/** 300 dpi for the printer, as the receipts go; 220 for a PDF that stays a sensible size. */
const PRINT_PX_PER_MM = 300 / 25.4;
const PDF_PX_PER_MM = 220 / 25.4;
/** Long enough for `window.print()` to have returned before the pages go. */
const SETTLE_MS = 400;

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  return { promise, resolve, reject };
}

function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
/** The press's moment and a job's mark — outside the component, where reading the clock is no render's business. */
const pressedAt = () => Date.now();
const jobMark = () => Math.random().toString(36).slice(2, 8);
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

/** Saves a file the way a download does — the browser's own bar, or a save dialog in the desk app. */
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ProfitReportActions({
  rows,
  context,
  className,
}: {
  rows: readonly ReportSourceRow[];
  context: ReportContext;
  className?: string;
}) {
  const t = useTranslations("Admin");
  const brand = useTranslations("Brand");
  const settings = useSyncExternalStore(
    stationSettingsStore.subscribe,
    stationSettingsStore.snapshot,
    stationSettingsStore.server,
  );
  const [task, setTask] = useState<ReportTask | null>(null);
  const [status, setStatus] = useState<ReportStatus | null>(null);
  /** A double press lands before the first one re-renders the buttons disabled. */
  const running = useRef(false);
  const empty = !rows.some((row) => row.status !== "cancelled" && row.status !== "declined");
  const directPaper: ReportPaper = settings.a5.page === "a5" ? "a5" : "a4";

  // A finished message steps aside on its own; a failure stays until it is read.
  useEffect(() => {
    if (status?.tone !== "done") return;
    const timer = window.setTimeout(() => setStatus((current) => (current === status ? null : current)), 12_000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const busy = (text: string) => setStatus({ tone: "busy", text });
  const agentFailure = (code: string) => {
    const title = `psProblem_${code}_title`;
    const body = `psProblem_${code}`;
    return new ReportFailure(
      t.has(title) ? t(title as "psProblem_timeout_title") : t("profitReportFailed"),
      t.has(body) ? t(body as "psProblem_timeout") : code,
    );
  };

  async function printDialog() {
    await (document.fonts?.ready ?? Promise.resolve());
    await nextFrame();
    window.print();
    await sleep(SETTLE_MS);
  }

  async function printDirect(pages: HTMLElement[], paper: ReportPaper, current: StationSettings) {
    try {
      await agentStatus();
    } catch (error) {
      // A dead agent is started, not reported — the station's own rule. The
      // press that got here is the user activation a protocol launch wants.
      const problem = connectionProblem(error);
      if (problem.code !== "not_running") throw agentFailure(problem.code);
      busy(t("profitReportWaking"));
      wakeAgent({ force: true });
      if (!(await waitForAgent(AGENT_START_MS))) throw agentFailure(agentEverSeen() ? "not_running" : "not_installed");
    }

    let list: PrinterInfo[];
    try {
      list = await listPrinters();
    } catch (error) {
      throw agentFailure(connectionProblem(error).code);
    }
    // The receipts' printer: the one this computer saved, or Windows' obvious one.
    const name = resolvePrinters(list, current).a5;
    if (!name) throw new ReportFailure(t("psReason_no_printer"), null, true);
    const printer = list.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!printer) throw new ReportFailure(t("psReason_printer_missing", { printer: name }), null, true);
    if (printer.connected === false) throw new ReportFailure(t("psReason_not_connected", { printer: printer.name }));
    const reported = printerState(printer);
    if (current.checkStatus && reported.severity === "FATAL") {
      throw new ReportFailure(t("psReason_printer_status", { status: reported.statusText }));
    }

    // Every page is drawn before the first is sent, so a page that cannot be
    // drawn stops the report before any paper comes out rather than halfway.
    const spec = REPORT_PAPERS[paper];
    const { rasterizeElement, canvasToPngBase64, CSS_PX_PER_MM } = await import("@/lib/print/rasterize");
    const pictures: string[] = [];
    for (const [index, page] of pages.entries()) {
      busy(t("profitReportPreparing", { page: String(index + 1), pages: String(pages.length) }));
      const rect = page.getBoundingClientRect();
      const canvas = await rasterizeElement(page, {
        widthMm: spec.widthMm,
        heightMm: spec.heightMm,
        pxPerMm: PRINT_PX_PER_MM,
        offsetMm: {
          x: (spec.widthMm - rect.width / CSS_PX_PER_MM) / 2,
          y: (spec.heightMm - rect.height / CSS_PX_PER_MM) / 2,
        },
      });
      pictures.push(await canvasToPngBase64(canvas));
    }

    // One job per page, in order: the queue prints them in the order it is given them.
    for (const [index, data] of pictures.entries()) {
      busy(
        t("profitReportSending", {
          printer: printer.name,
          page: String(index + 1),
          pages: String(pictures.length),
        }),
      );
      const mark = jobMark();
      try {
        await sendJob(printer.name, `report ${index + 1}/${pictures.length} #${mark}`, mark, {
          kind: "image",
          data,
          widthMm: spec.driverWidthMm,
          heightMm: spec.driverHeightMm,
          landscape: spec.landscape,
          fit: current.a5.fit,
          mono: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ReportFailure(
          lostContact(error) ? t("psReason_connection_lost") : t("psReason_rejected", { detail: message }),
          index > 0 ? t("profitReportPartial", { sent: String(index), pages: String(pictures.length) }) : null,
        );
      }
    }
    setStatus({
      tone: "done",
      text: t("profitReportSent", {
        count: pictures.length,
        n: String(pictures.length),
        printer: printer.name,
        paper: paper.toUpperCase(),
      }),
    });
  }

  async function savePdf(pages: HTMLElement[], printedAt: number, frozen: ReportContext) {
    const spec = REPORT_PAPERS.a4;
    const { rasterizeElement, CSS_PX_PER_MM } = await import("@/lib/print/rasterize");
    const { jpegPagesToPdf, safeFilename } = await import("@/lib/print/pdf");
    const out: PdfImagePage[] = [];
    for (const [index, page] of pages.entries()) {
      busy(t("profitReportPreparing", { page: String(index + 1), pages: String(pages.length) }));
      const rect = page.getBoundingClientRect();
      const canvas = await rasterizeElement(page, {
        widthMm: spec.widthMm,
        heightMm: spec.heightMm,
        pxPerMm: PDF_PX_PER_MM,
        offsetMm: {
          x: (spec.widthMm - rect.width / CSS_PX_PER_MM) / 2,
          y: (spec.heightMm - rect.height / CSS_PX_PER_MM) / 2,
        },
      });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob) throw new Error("the page could not be encoded");
      out.push({
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        widthPx: canvas.width,
        heightPx: canvas.height,
        widthMm: spec.widthMm,
        heightMm: spec.heightMm,
      });
    }
    const name = `${safeFilename(`${t("profitReport")} - ${frozen.desk} - ${baghdadDay(printedAt)}`)}.pdf`;
    const bytes = jpegPagesToPdf(out, { title: `${t("profitReport")} — ${frozen.desk}`, creator: brand("name") });
    download(new Blob([bytes], { type: "application/pdf" }), name);
    setStatus({ tone: "done", text: t("profitReportSaved", { file: name }) });
  }

  async function start(mode: ReportMode) {
    if (running.current || empty) return;
    running.current = true;
    const current = stationSettings();
    const paper: ReportPaper = mode === "direct" && current.a5.page === "a5" ? "a5" : "a4";
    const printedAt = pressedAt();
    const drawn = deferred<HTMLElement[]>();
    setStatus(mode === "a4" ? null : { tone: "busy", text: t("profitReportDrawing") });
    setTask({
      id: `${mode}-${printedAt}`,
      mode,
      paper,
      printedAt,
      rows,
      context,
      deliver: drawn.resolve,
      fail: drawn.reject,
    });
    try {
      const pages = await within(drawn.promise, 30_000, "drawing the report timed out");
      if (mode === "a4") await printDialog();
      else if (mode === "pdf") await savePdf(pages, printedAt, context);
      else await printDirect(pages, paper, current);
    } catch (error) {
      setStatus(
        error instanceof ReportFailure
          ? { tone: "error", title: error.title, detail: error.detail, setup: error.setup, others: mode === "direct" }
          : {
              tone: "error",
              title: t("profitReportFailed"),
              detail: error instanceof Error ? error.message : String(error),
              setup: false,
              others: mode !== "a4",
            },
      );
    } finally {
      setTask(null);
      running.current = false;
    }
  }

  const label: Record<ReportMode, string> = {
    direct: t("profitReportDirect"),
    a4: t("profitReportA4"),
    pdf: t("profitReportPdf"),
  };
  const hint: Record<ReportMode, string> = {
    direct: t("profitReportDirectHint", { paper: directPaper.toUpperCase() }),
    a4: t("profitReportA4Hint"),
    pdf: t("profitReportPdfHint"),
  };

  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-2", className)}>
        <span className="inline-flex items-center gap-1.5 text-[0.8rem] font-extrabold text-ink">
          <ClipboardList className="size-4 text-brand" aria-hidden />
          {t("profitReport")}
        </span>
        <div role="group" aria-label={t("profitReport")} className="flex flex-wrap items-center gap-1.5">
          {MODES.map(({ mode, Icon }) => {
            const mine = task?.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => void start(mode)}
                disabled={task !== null || empty}
                aria-busy={mine}
                title={empty ? t("profitReportEmpty") : hint[mode]}
                className={cn(
                  "press inline-flex items-center gap-1.5 rounded-control border px-3 py-2 text-[0.78rem] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  mode === "direct"
                    ? "border-brand bg-brand text-white hover:bg-brand/90"
                    : "border-brand/40 bg-brand/6 text-brand hover:bg-brand hover:text-white",
                )}
              >
                {mine ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
                {label[mode]}
                {mode === "direct" && (
                  <span className="rounded-full bg-white/20 px-1.5 py-px text-[0.66rem] font-extrabold" aria-hidden>
                    {directPaper.toUpperCase()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {status && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex basis-full items-start gap-2 rounded-control px-3 py-2 text-[0.78rem] font-bold",
            status.tone === "busy" && "bg-subtle text-muted",
            status.tone === "done" && "bg-success/10 text-success",
            status.tone === "error" && "bg-brand/8 text-brand",
          )}
        >
          {status.tone === "busy" ? (
            <Loader2 className="mt-px size-4 shrink-0 animate-spin" aria-hidden />
          ) : status.tone === "done" ? (
            <CircleCheck className="mt-px size-4 shrink-0" aria-hidden />
          ) : (
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p>{status.tone === "error" ? status.title : status.text}</p>
            {status.tone === "error" && status.detail && (
              <p className="mt-0.5 font-semibold text-ink">{status.detail}</p>
            )}
            {status.tone === "error" && status.others && (
              <p className="mt-0.5 font-semibold text-muted">{t("profitReportOtherWays")}</p>
            )}
          </div>
          {status.tone === "error" && status.setup && (
            <button
              type="button"
              onClick={(event) => openPrinterSetup(event.currentTarget.ownerDocument)}
              className="press inline-flex shrink-0 items-center gap-1 rounded-control border border-brand/40 bg-surface px-2 py-1 text-[0.72rem] font-extrabold text-brand hover:bg-brand hover:text-white"
            >
              <Settings2 className="size-3.5" aria-hidden />
              {t("psSetup")}
            </button>
          )}
          {status.tone !== "busy" && (
            <button
              type="button"
              onClick={() => setStatus(null)}
              aria-label={t("profitReportDismiss")}
              className="press shrink-0 rounded-full p-0.5 opacity-70 hover:opacity-100"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      {task && <ReportStage key={task.id} task={task} />}
    </>
  );
}

/* ── The pages ────────────────────────────────────────────────────────────── */

/**
 * Off the left edge of the page, laid out but unseen — the print station's
 * own stage. ⚠️ Not `display: none`: an element with no layout has no size
 * to measure and nothing for the rasteriser to copy.
 */
const OFFSCREEN: CSSProperties = { position: "fixed", top: 0, left: "-100000px", pointerEvents: "none" };

/**
 * The dialog's page rule. ⚠️ `margin: 0` is what keeps the browser's own date,
 * title and address off the paper: Chrome prints its header and footer INSIDE
 * the page margin, and with none there is nowhere for them to go. The sheet's
 * own padding is the margin instead.
 */
const DIALOG_CSS = `@page { size: A4 portrait; margin: 0; }
article[data-report-page] { break-after: page; }
article[data-report-page]:last-of-type { break-after: auto; }`;

/** Kept back from what a page measures as holding, against rounding between measure and print. */
const SAFETY_PX = 3;

/**
 * Measures, paginates, draws the pages, and hands them over.
 *
 * The effects may run twice in development (StrictMode). Measuring twice is
 * harmless, and handing the pages over twice resolves a promise that only
 * resolves once — the action itself runs in the press, never in an effect, so
 * nothing here can print twice.
 */
function ReportStage({ task }: { task: ReportTask }) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const dir = locale === "ar" ? "rtl" : "ltr";
  const [layout, setLayout] = useState<number[][] | null>(null);
  const measured = useRef<HTMLDivElement>(null);
  const drawn = useRef<HTMLDivElement>(null);
  const report = buildProfitReport(task.rows, t("unassigned"));
  const paper = REPORT_PAPERS[task.paper];

  useEffect(() => {
    if (layout) return;
    let alive = true;
    void (async () => {
      await (document.fonts?.ready ?? Promise.resolve());
      await nextFrame();
      const root = measured.current;
      if (!alive || !root) return;
      const room = (which: "first" | "next") => {
        const slot = root.querySelector<HTMLElement>(`[data-measure="${which}"] [data-slot]`);
        const head = slot?.querySelector("thead");
        if (!slot || !head) throw new Error("the report could not be measured");
        return slot.getBoundingClientRect().height - head.getBoundingClientRect().height - SAFETY_PX;
      };
      const heights = [...root.querySelectorAll<HTMLElement>('[data-measure="next"] tbody tr')].map(
        (row) => row.getBoundingClientRect().height,
      );
      setLayout(paginate(heights, room("first"), room("next")));
    })().catch((error: unknown) => {
      if (alive) task.fail(error instanceof Error ? error : new Error(String(error)));
    });
    return () => {
      alive = false;
    };
  }, [layout, task]);

  useEffect(() => {
    if (!layout) return;
    const pages = [...(drawn.current?.querySelectorAll<HTMLElement>("article[data-report-page]") ?? [])];
    if (pages.length === layout.length) task.deliver(pages);
    else task.fail(new Error("the report's pages were not drawn"));
  }, [layout, task]);

  const common = { paper, report, context: task.context, printedAt: task.printedAt };

  if (!layout) {
    return createPortal(
      <div ref={measured} aria-hidden inert dir={dir} lang={locale} style={OFFSCREEN}>
        <ReportPage {...common} measure="first" first lines={[]} startIndex={0} pageNo={1} pageCount={1} />
        <ReportPage {...common} measure="next" first={false} lines={report.rows} startIndex={0} pageNo={1} pageCount={1} />
      </div>,
      document.body,
    );
  }

  const pages = layout.map((indices, index) => (
    <ReportPage
      key={index}
      {...common}
      first={index === 0}
      lines={indices.map((row) => report.rows[row])}
      startIndex={indices[0] ?? 0}
      pageNo={index + 1}
      pageCount={layout.length}
    />
  ));

  return createPortal(
    task.mode === "a4" ? (
      <div ref={drawn} className="print-sheet" dir={dir} lang={locale}>
        <style>{DIALOG_CSS}</style>
        {pages}
      </div>
    ) : (
      <div ref={drawn} aria-hidden inert dir={dir} lang={locale} style={OFFSCREEN}>
        {pages}
      </div>
    ),
    document.body,
  );
}

const money = (value: number) => formatPrice(Math.round(value));

function clockOf(at: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
    .format(at)
    .toUpperCase();
}

/**
 * One sheet of the report.
 *
 * The first carries the letterhead the receipt and the warranty carry, the
 * totals and the filters; every page after it a slim running head, so a page
 * picked up off the printer on its own still says what it is. Every page ends
 * on its number.
 */
function ReportPage({
  paper,
  report,
  context,
  printedAt,
  first,
  lines,
  startIndex,
  pageNo,
  pageCount,
  measure,
}: {
  paper: (typeof REPORT_PAPERS)[ReportPaper];
  report: BuiltReport;
  context: ReportContext;
  printedAt: number;
  first: boolean;
  lines: readonly ReportRow[];
  startIndex: number;
  pageNo: number;
  pageCount: number;
  measure?: "first" | "next";
}) {
  const t = useTranslations("Admin");
  const brand = useTranslations("Brand");
  const day = baghdadDay(printedAt);
  const clock = clockOf(printedAt);

  return (
    <article
      data-report-page={measure ? undefined : ""}
      data-measure={measure}
      style={{ width: `${paper.sheetWidthMm}mm`, height: `${paper.sheetHeightMm}mm` }}
      className="relative mx-auto flex flex-col overflow-hidden bg-white px-[10mm] py-[7mm] text-[#000]"
    >
      <PaperFrame />

      {first ? (
        <div className="flex shrink-0 flex-col gap-[1.8mm]">
          <Letterhead markClass="size-[18mm]">
            <PaperEyebrow Icon={ClipboardList}>{context.desk}</PaperEyebrow>
            <PaperTitle>{t("profitReport")}</PaperTitle>
            <PaperStamps
              stamps={[
                { label: t("profitReportPrinted"), value: day },
                { label: t("profitReportTime"), value: clock },
              ]}
            />
          </Letterhead>
          <PaperRule />
        </div>
      ) : (
        <div className="flex shrink-0 flex-col gap-[1.6mm]">
          <header className="flex items-end justify-between gap-[6mm]">
            <div className="min-w-0">
              <p className="text-[8pt] font-bold leading-[1.2] text-[#a90f1d]">{context.desk}</p>
              <p className="mt-[0.6mm] text-[14pt] font-bold leading-[1.15] text-[#e11d2e]">{t("profitReport")}</p>
            </div>
            <div className="me-[10mm] flex shrink-0 items-center gap-[2mm]">
              <CompanyMark className="size-[9mm]" />
              <p className="whitespace-nowrap text-[10.5pt] font-bold leading-[1.2] text-[#333333]">{brand("name")}</p>
            </div>
          </header>
          <PaperRule />
        </div>
      )}

      {first && <ReportSummary totals={report.totals} />}

      {first && (
        <div className="mt-[2.6mm] flex shrink-0 flex-wrap items-center gap-[1.6mm] text-[7.8pt] font-semibold leading-[1.3]">
          <span className="rounded-full border-[0.25mm] border-[#f2c4ca] px-[2.6mm] py-[0.8mm]">
            <span className="font-bold text-[#a90f1d]">{t("profitReportPeriod")}:</span> {context.period}
          </span>
          {context.filters.map((filter) => (
            <span key={filter} className="rounded-full border-[0.25mm] border-[#f2c4ca] px-[2.6mm] py-[0.8mm]">
              {filter}
            </span>
          ))}
        </div>
      )}

      <div data-slot className="mt-[3mm] min-h-0 flex-1 overflow-hidden">
        <ReportTable lines={lines} startIndex={startIndex} />
      </div>

      <footer className="mt-[2.4mm] flex shrink-0 items-center justify-between gap-[4mm] border-0 border-t-[0.25mm] border-solid border-[#f2c4ca] pt-[1.8mm] text-[7.4pt] font-semibold leading-[1.3]">
        <p className="min-w-0 whitespace-nowrap">
          {t("profitReport")} — {context.desk} · <span data-numeric>{day}  {clock}</span>
        </p>
        <p className="shrink-0 whitespace-nowrap font-bold text-[#a90f1d]">
          {t("profitReportPage", { page: String(pageNo), pages: String(pageCount) })}
        </p>
      </footer>
    </article>
  );
}

/**
 * The five figures, from the reader's start: what was charged, the warranty
 * within it, the profit — the one figure in red, because it is the reason the
 * report is printed — how many devices, and what is still owed.
 *
 * ⚠️ The figure sits in a span inside the cell, never on it: `data-numeric`
 * pins `direction: ltr`, so on the cell it would push the number to the LEFT
 * of an Arabic card while its label sits on the right.
 */
function ReportSummary({ totals }: { totals: Totals }) {
  const t = useTranslations("Admin");
  const cards = [
    { key: "amount", label: t("profitReportTotalAmount"), value: money(totals.amount) },
    { key: "warranty", label: t("profitReportTotalWarranty"), value: money(totals.warranty) },
    { key: "profit", label: t("profitReportTotalProfit"), value: money(totals.profit), strong: true },
    { key: "count", label: t("profitReportTotalCount"), value: String(totals.count) },
    { key: "outstanding", label: t("profitReportOutstanding"), value: money(totals.outstanding) },
  ];
  return (
    <section className="mt-[3.4mm] shrink-0">
      <dl className="grid grid-cols-5 gap-[2mm]">
        {cards.map((card) => (
          <div
            key={card.key}
            className={cn(
              "flex flex-col justify-between gap-[1.6mm] rounded-[2mm] border-[0.25mm] border-solid px-[2.8mm] py-[2.2mm]",
              card.strong ? "border-[#e11d2e] bg-[#e11d2e]" : "border-[#f2c4ca] bg-[#fdeff1]",
            )}
          >
            <dt className={cn("text-[7.4pt] font-bold leading-[1.3]", card.strong ? "text-white" : "text-[#a90f1d]")}>
              {card.label}
            </dt>
            <dd className={cn("text-[13.5pt] font-bold leading-[1.1]", card.strong ? "text-white" : "text-[#000]")}>
              <span data-numeric>{card.value}</span>
            </dd>
          </div>
        ))}
      </dl>
      <ul className="mt-[1.8mm] flex flex-wrap gap-x-[5mm] gap-y-[0.8mm] text-[7.6pt] font-semibold leading-[1.3]">
        {totals.missingCost > 0 && (
          <li className="flex items-center gap-[1.4mm]">
            <span className="size-[1.4mm] shrink-0 rotate-45 bg-[#e11d2e]" aria-hidden />
            {t("profitReportMissingCost", { count: totals.missingCost, n: String(totals.missingCost) })}
          </li>
        )}
        <li className="flex items-center gap-[1.4mm]">
          <span className="size-[1.4mm] shrink-0 rotate-45 bg-[#e11d2e]" aria-hidden />
          {t("profitReportCancelledNote")}
        </li>
      </ul>
    </section>
  );
}

/**
 * ⚠️ `table-fixed` with every column but the fault given its width. That is
 * what makes the measuring pass true: a row's height depends on how wide its
 * cells are, and under automatic layout the widths depend on every row in the
 * table — so a page holding twenty of the rows would lay them out differently
 * from the table of all of them that was measured. Fixed, a row is the same
 * height wherever it is drawn. `break-words` lets a long unbroken model name
 * wrap inside its column rather than widen it.
 */
const COLUMN_WIDTHS = ["8mm", "25mm", "21mm", "18mm", "21mm", "31mm", undefined, "20mm"] as const;

const CELL =
  "border-0 border-b-[0.25mm] border-solid border-[#f2c4ca] px-[1.3mm] py-[1.5mm] align-middle text-[8.2pt] font-semibold leading-[1.3] text-[#000] break-words";

function ReportTable({ lines, startIndex }: { lines: readonly ReportRow[]; startIndex: number }) {
  const t = useTranslations("Admin");
  const heads = [
    "#",
    t("profitReportColEmployee"),
    t("profitReportColAmount"),
    t("profitReportColWarranty"),
    t("profitReportColProfit"),
    t("profitReportColDevice"),
    t("profitReportColFault"),
    t("profitReportColDate"),
  ];
  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {COLUMN_WIDTHS.map((width, index) => (
          <col key={index} style={width ? { width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {heads.map((head, index) => (
            <th
              key={index}
              scope="col"
              className={cn(
                "border-0 bg-[#e11d2e] px-[1.3mm] py-[1.7mm] text-center align-middle text-[7.8pt] font-bold leading-[1.25] text-white",
                index > 0 && "border-s-[0.25mm] border-solid border-[#f3939e]",
              )}
            >
              {head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lines.map((line, offset) => {
          const n = startIndex + offset;
          return (
            <tr key={line.id} className={n % 2 ? "bg-[#fdeff1]" : "bg-white"}>
              <td className={cn(CELL, "text-center font-bold text-[#a90f1d]")} data-numeric>
                {n + 1}
              </td>
              <td className={cn(CELL, "text-start font-bold")}>{line.employee}</td>
              <td className={cn(CELL, "text-center font-bold")} data-numeric>
                {line.amount == null ? "—" : money(line.amount)}
              </td>
              <td className={cn(CELL, "text-center")} data-numeric>
                {line.warranty > 0 ? money(line.warranty) : "—"}
              </td>
              <td
                className={cn(CELL, "text-center font-bold", line.profit != null && line.profit < 0 && "text-[#e11d2e]")}
                data-numeric
              >
                {line.profit == null ? "—" : money(line.profit)}
              </td>
              <td className={cn(CELL, "text-center font-bold")} dir="auto">
                {line.device}
              </td>
              <td className={cn(CELL, "text-start")}>{line.fault || "—"}</td>
              <td className={cn(CELL, "whitespace-nowrap text-center")} data-numeric>
                {line.day}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
