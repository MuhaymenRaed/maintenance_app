"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { useLocale, useTranslations } from "next-intl";
import {
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Download,
  Eye,
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
import { emptyTotals, repairMoney, type DeskTotals, type PaymentTerms } from "@/lib/data/repair-desk";
import { computeFigures } from "@/lib/data/desk-figures";
import { describeReturn, returnDirection, type ReturnDescription, type ReturnSummary } from "@/lib/data/desk-figures";
import { baghdadDay } from "@/lib/data/date-window";
import { formatPrice } from "@/lib/format";
import {
  agentEverSeen,
  agentStatus,
  AGENT_START_MS,
  canHostAgent,
  listPrinters,
  lostContact,
  sendJob,
  waitForAgent,
  wakeAgent,
} from "@/lib/print/agent-client";
import { supportsA4, supportsA5, type PrinterInfo } from "@/lib/print/printer-match";
import type { PdfImagePage } from "@/lib/print/pdf";
import { paginateWithTail, REPORT_PAPERS, type ReportPaper } from "@/lib/print/report-pages";
import { connectionProblem, openPrinterSetup, printerState, resolvePrinters } from "@/lib/print/station";
import type { StationSettings } from "@/lib/print/station-settings";
import { stationSettings } from "@/lib/print/station-store";
import { useOwnerDocument } from "@/lib/windows/owner-document";
import { useCompletedSplit } from "@/components/admin/maintenance/figure-cards";
import { cn } from "@/lib/utils";

/**
 * جرد الأرباح — the bench's profit report, printed on A4 or A5 by the
 * counter's paper printer, or saved as a PDF.
 *
 * ---------------------------------------------------------------------------
 * What it is built from
 * ---------------------------------------------------------------------------
 * A job: the tickets, the words for the period and the filters, and — for the
 * figures panel's own report — the panel's figures, so the summary on paper is
 * the cards on screen, money dated by the day it came in
 * (`lib/data/desk-figures.ts`). A hand-picked list of tickets (2026-11-20, "an
 * exact ticket or a group") carries no figures and has them worked out from
 * its own rows, every dinar each has taken. The rows are frozen at the press:
 * a live refresh mid-print must not move a row between pages already measured.
 *
 * ---------------------------------------------------------------------------
 * Three ways out (the shop, 2026-11-20)
 * ---------------------------------------------------------------------------
 * - **A4** and **A5** go through the print agent to the *paper* printer — the
 *   one the receipts go to — never to the label printer, and never through the
 *   browser's dialog, where the default printer on the counter PC is the label
 *   printer. A printer whose driver does not list the paper is refused in
 *   words before anything is sent: "if there is no A4 paper in the printer
 *   then return an error".
 * - **PDF** is the same A4 pages as a file — and the way out on a device that
 *   is not the counter PC, where there is no agent to print through.
 *
 * Ctrl+P opens the same three as a chooser (`ReportPrintDialog`).
 *
 * ---------------------------------------------------------------------------
 * ⚠️ It lays out its own pages — see `lib/print/report-pages.ts`
 * ---------------------------------------------------------------------------
 * Each page is drawn as exactly one sheet and pictured for the agent or the
 * PDF. Pages are measured, not counted: every row's real height is read off an
 * off-screen copy of the table, and `paginateWithTail` fills each page to what
 * it holds and keeps the totals whole after the last row. The columns are fixed
 * widths (`table-fixed`), so a row is the same height on its page as when
 * measured. A5 landscape is the same width as A4 portrait, so the pages are the
 * same design with fewer rows each.
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
  /** When it became «مكتمل» — the day the figures book it on (2026-11-24). */
  completedAt: string | null;
  /**
   * Not paid in full by the period's end (2026-11-24): its amount counts on
   * the day it is, so the row prints «آجل» and no amount, and the report
   * still adds up to the period's totals.
   */
  unbooked?: boolean;
};

/** One report to print. */
export type ReportJob = {
  rows: readonly ReportSourceRow[];
  context: ReportContext;
  /**
   * The figures to close on — the panel's own. Worked out from the rows when
   * absent, every dinar each ticket has taken.
   */
  totals?: DeskTotals;
  /** List cancelled tickets as well — when the reader asked for exactly those. */
  includeCancelled?: boolean;
  /**
   * «راجع» (the shop, 2026-11-21) — tickets whose money changed in the period
   * on a later day than they were opened. A section of their own after the
   * period's tickets, "but not always, only if such a راجع happened".
   */
  returns?: readonly (ReportSourceRow & { returned: ReturnSummary })[];
  /**
   * Which report: جرد الأرباح (the default) or تقرير الخزينة — the safe's
   * movements in the period (the shop, 2026-11-24). The cash report prints
   * `moves` and closes on the safe's own cards.
   */
  kind?: "profit" | "cash";
  moves?: readonly CashMoveLine[];
};

/** One movement of the safe, as تقرير الخزينة prints it. */
export type CashMoveLine = {
  id: string;
  code: string;
  customer: string;
  device: string;
  employee: string;
  kind: "cash" | "settle" | "deposit" | "return";
  /** Signed: a refund is negative. */
  amount: number;
  at: string;
};

/** Nothing to print: no ticket, no «مرتجع» — or, for the safe, no movement. */
export function isEmptyJob(job: ReportJob): boolean {
  if (job.kind === "cash") return !job.moves?.length;
  return job.rows.length === 0 && !job.returns?.length;
}

type ReportRow = {
  /**
   * A ticket of the period; the «راجع» section's heading; the heading of its
   * down (سلبي) or up (إيجابي) half, which carries its count and total; or one
   * of its tickets.
   */
  kind: "ticket" | "returnHead" | "returnGroup" | "return";
  /** On a «راجع» group heading or row: brought down, or brought up. */
  direction?: "down" | "up";
  /** Its number within its section. */
  no: number;
  id: string;
  code: string;
  employee: string;
  /** The repair alone — the warranty is its own column. */
  amount: number | null;
  warranty: number;
  profit: number | null;
  /** Priced, with no purchase price typed: its part counted as zero. */
  noCost: boolean;
  cancelled: boolean;
  /** Not paid in full by the period's end — no amount here. */
  owing?: boolean;
  device: string;
  fault: string;
  day: string;
  /** A «راجع»: what changed, and the day the ticket was opened. */
  change?: ReturnDescription;
  openedDay?: string;
};

type CashLine = CashMoveLine & { no: number; day: string; clock: string };

type BuiltReport = {
  kind: "profit" | "cash";
  rows: ReportRow[];
  moves: CashLine[];
  totals: DeskTotals;
  includeCancelled: boolean;
};

/** The rows, in the order they came in, and the totals they close on. */
export function buildProfitReport(job: ReportJob, unassigned: string): BuiltReport {
  if (job.kind === "cash") {
    const moves = (job.moves ?? [])
      .slice()
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((move, index) => ({
        ...move,
        employee: move.employee.trim() || unassigned,
        no: index + 1,
        day: baghdadDay(Date.parse(move.at)),
        clock: clockOf(Date.parse(move.at)),
      }));
    return { kind: "cash", rows: [], moves, totals: job.totals ?? emptyTotals(), includeCancelled: true };
  }
  const out: ReportRow[] = [];
  const kept = job.rows
    .filter((row) => job.includeCancelled || (row.status !== "cancelled" && row.status !== "declined"))
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const row of kept) {
    const cancelled = row.status === "cancelled" || row.status === "declined";
    const money = repairMoney({
      price: row.price,
      warranty: row.warrantyPrice,
      cost: row.costPrice,
      collected: row.collected,
      terms: row.paymentTerms,
      completed: row.status === "completed",
    });
    const owing = !cancelled && Boolean(row.unbooked);
    const priced = row.price != null && !cancelled && !owing;
    out.push({
      kind: "ticket",
      no: out.length + 1,
      id: row.id,
      code: row.code,
      employee: row.holderName?.trim() || unassigned,
      amount: priced ? money.base : null,
      warranty: cancelled || owing ? 0 : money.warranty,
      // ⚠️ A part with no price typed counts as zero (the shop, 2026-11-20),
      // and the row says so with a mark the summary explains.
      profit: priced ? money.base - (money.cost ?? 0) : null,
      noCost: priced && money.cost == null && money.base > 0,
      cancelled,
      owing,
      device: row.deviceModel,
      fault: [...row.issues, ...row.customFaults].filter(Boolean).join("، "),
      day: baghdadDay(Date.parse(row.createdAt)),
    });
  }

  // «راجع» after the period's own tickets, with a heading row of its own —
  // one more row to the pages, so a long list breaks across them like any other.
  const returns = (job.returns ?? []).slice().sort((a, b) => a.returned.at.localeCompare(b.returned.at));
  if (returns.length) {
    out.push({
      kind: "returnHead",
      no: 0,
      id: "returns-head",
      code: "",
      employee: "",
      amount: null,
      warranty: 0,
      profit: null,
      noCost: false,
      cancelled: false,
      device: "",
      fault: "",
      day: "",
    });
    for (const direction of ["down", "up"] as const) {
      const half = returns.filter((row) => returnDirection(row.returned) === direction);
      if (!half.length) continue;
      out.push({
        kind: "returnGroup",
        direction,
        // The heading carries the half's count and total in these two.
        no: half.length,
        amount: half.reduce((sum, row) => sum + row.returned.price, 0),
        id: `returns-${direction}`,
        code: "",
        employee: "",
        warranty: 0,
        profit: null,
        noCost: false,
        cancelled: false,
        device: "",
        fault: "",
        day: "",
      });
      half.forEach((row, index) => {
        out.push({
          kind: "return",
          direction,
          no: index + 1,
          id: `return-${row.id}`,
          code: row.code,
          employee: row.holderName?.trim() || unassigned,
          // The repair alone, as in the table above — the warranty is its own
          // column, and the two add up to the half's total.
          amount: row.returned.base,
          warranty: row.returned.warranty,
          profit: row.returned.profit,
          noCost: false,
          cancelled: false,
          device: row.deviceModel,
          fault: "",
          day: baghdadDay(Date.parse(row.returned.at)),
          change: describeReturn(row.returned),
          openedDay: baghdadDay(Date.parse(row.createdAt)),
        });
      });
    }
  }

  let totals = job.totals;
  if (!totals) {
    totals = computeFigures({
      rows: job.rows.map((row) => ({ ...row, holderId: null })),
      book: null,
      bounds: { since: null, until: null },
      filters: { status: "all", terms: null, holderId: null },
    }).totals;
  }
  return { kind: "profit", rows: out, moves: [], totals, includeCancelled: Boolean(job.includeCancelled) };
}

/* ── The ways out, and a look first ──────────────────────────────────────── */

/**
 * `preview` draws the same A4 pages a PDF would carry and shows them on the
 * screen, with download and print right there (the shop, 2026-11-21:
 * "sometimes I just need to check a small thing and yet I had to download the
 * full report"). Downloading from the preview reuses its pictures — the pages
 * are not drawn twice.
 */
export type ReportMode = "preview" | "a4" | "a5" | "pdf";

const MODES: { mode: ReportMode; Icon: LucideIcon }[] = [
  { mode: "preview", Icon: Eye },
  { mode: "a4", Icon: Printer },
  { mode: "a5", Icon: FileText },
  { mode: "pdf", Icon: Download },
];

/** What the preview holds: the pages as pictures, and what to name and redo them by. */
type ReportPreview = {
  pages: PdfImagePage[];
  urls: string[];
  printedAt: number;
  job: ReportJob;
};

type ReportTask = {
  id: string;
  mode: ReportMode;
  paper: ReportPaper;
  printedAt: number;
  job: ReportJob;
  deliver: (pages: HTMLElement[]) => void;
  fail: (error: Error) => void;
};

type ReportStatus =
  | { tone: "busy"; text: string }
  | { tone: "done"; text: string }
  | { tone: "error"; title: string; detail: string | null; setup: boolean };

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

export type ProfitReport = {
  /** Prints or saves one report. A second press while one is going does nothing. */
  start: (mode: ReportMode, job: ReportJob) => void;
  /** Which way out is going now, if any. */
  busy: ReportMode | null;
  /** What happened, and the off-screen pages — drawn once, wherever the caller likes. */
  ui: ReactNode;
};

/**
 * The report machinery, held once by the desk page so its buttons, the
 * hand-picked report and the Ctrl+P chooser share one run and one message.
 */
export function useProfitReport(): ProfitReport {
  const t = useTranslations("Admin");
  const brand = useTranslations("Brand");
  const [task, setTask] = useState<ReportTask | null>(null);
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  /** A double press lands before the first one re-renders the buttons disabled. */
  const running = useRef(false);

  function closePreview() {
    setPreview((current) => {
      for (const url of current?.urls ?? []) URL.revokeObjectURL(url);
      return null;
    });
  }

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

  async function printDirect(pages: HTMLElement[], paper: ReportPaper, current: StationSettings) {
    // The agent is a Windows program: anywhere else there is nothing to print
    // through, and asking would only put a browser question on a phone.
    if (!canHostAgent()) throw new ReportFailure(t("profitReportNeedsPc"), t("profitReportUsePdf"));
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
    // ⚠️ The PAPER printer — the receipts' — never the label printer, and
    // never Windows' default, which on the counter PC is the label printer.
    const name = resolvePrinters(list, current).a5;
    if (!name) throw new ReportFailure(t("psReason_no_printer"), null, true);
    const printer = list.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!printer) throw new ReportFailure(t("psReason_printer_missing", { printer: name }), null, true);
    if (printer.connected === false) throw new ReportFailure(t("psReason_not_connected", { printer: printer.name }));
    const reported = printerState(printer);
    if (current.checkStatus && reported.severity === "FATAL") {
      throw new ReportFailure(t("psReason_printer_status", { status: reported.statusText }));
    }
    // "If there is no A4 paper in the printer then return an error" — the
    // driver's own list of papers is what the agent can see. A driver that
    // lists none says nothing either way, and the job goes.
    const fits = paper === "a4" ? supportsA4(printer) : supportsA5(printer);
    if (fits === false) {
      throw new ReportFailure(
        t("profitReportNoPaper", { printer: printer.name, paper: paper.toUpperCase() }),
        t("profitReportNoPaperHint"),
        true,
      );
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

  /** The A4 pages as pictures — what a PDF carries, and what the preview shows. */
  async function pdfPages(pages: HTMLElement[]): Promise<PdfImagePage[]> {
    const spec = REPORT_PAPERS.a4;
    const { rasterizeElement, CSS_PX_PER_MM } = await import("@/lib/print/rasterize");
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
    return out;
  }

  /** The pictures as one PDF file, downloaded. */
  async function downloadPdf(out: PdfImagePage[], printedAt: number, job: ReportJob) {
    const { jpegPagesToPdf, safeFilename } = await import("@/lib/print/pdf");
    const frozen = job.context;
    const title = t(job.kind === "cash" ? "cashReport" : "profitReport");
    const name = `${safeFilename(`${title} - ${frozen.desk} - ${baghdadDay(printedAt)}`)}.pdf`;
    const bytes = jpegPagesToPdf(out, { title: `${title} — ${frozen.desk}`, creator: brand("name") });
    download(new Blob([bytes], { type: "application/pdf" }), name);
    setStatus({ tone: "done", text: t("profitReportSaved", { file: name }) });
  }

  async function savePdf(pages: HTMLElement[], printedAt: number, job: ReportJob) {
    await downloadPdf(await pdfPages(pages), printedAt, job);
  }

  async function showPreview(pages: HTMLElement[], printedAt: number, job: ReportJob) {
    const out = await pdfPages(pages);
    const urls = out.map((page) => URL.createObjectURL(new Blob([page.jpeg as BlobPart], { type: "image/jpeg" })));
    closePreview();
    setPreview({ pages: out, urls, printedAt, job });
    setStatus(null);
  }

  async function run(mode: ReportMode, job: ReportJob) {
    const current = stationSettings();
    // The preview is the PDF's own pages: A4.
    const paper: ReportPaper = mode === "a5" ? "a5" : "a4";
    const printedAt = pressedAt();
    const drawn = deferred<HTMLElement[]>();
    setStatus({ tone: "busy", text: t("profitReportDrawing") });
    setTask({
      id: `${mode}-${printedAt}`,
      mode,
      paper,
      printedAt,
      job,
      deliver: drawn.resolve,
      fail: drawn.reject,
    });
    try {
      const pages = await within(drawn.promise, 30_000, "drawing the report timed out");
      if (mode === "preview") await showPreview(pages, printedAt, job);
      else if (mode === "pdf") await savePdf(pages, printedAt, job);
      else await printDirect(pages, paper, current);
    } catch (error) {
      setStatus(
        error instanceof ReportFailure
          ? { tone: "error", title: error.title, detail: error.detail, setup: error.setup }
          : {
              tone: "error",
              title: t("profitReportFailed"),
              detail: error instanceof Error ? error.message : String(error),
              setup: false,
            },
      );
    } finally {
      setTask(null);
      running.current = false;
    }
  }

  function start(mode: ReportMode, job: ReportJob) {
    if (running.current) return;
    if (isEmptyJob(job)) {
      setStatus({ tone: "error", title: t("profitReportEmpty"), detail: null, setup: false });
      return;
    }
    running.current = true;
    void run(mode, job);
  }

  const ui = (
    <>
      {status && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-start gap-2 rounded-control px-3 py-2 text-[0.78rem] font-bold",
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
            {status.tone === "error" && status.detail && <p className="mt-0.5 font-semibold text-ink">{status.detail}</p>}
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
      {preview && (
        <ReportPreviewDialog
          preview={preview}
          busy={task !== null}
          onClose={closePreview}
          onDownload={() => void downloadPdf(preview.pages, preview.printedAt, preview.job)}
          onPrint={(mode) => {
            const job = preview.job;
            closePreview();
            start(mode, job);
          }}
        />
      )}
    </>
  );

  return { start, busy: task?.mode ?? null, ui };
}

/** What each way out is called, and what it does — for the buttons and the chooser. */
function useModeWords() {
  const t = useTranslations("Admin");
  return {
    label: {
      preview: t("profitReportPreview"),
      a4: t("profitReportA4"),
      a5: t("profitReportA5"),
      pdf: t("profitReportPdf"),
    } satisfies Record<ReportMode, string>,
    hint: {
      preview: t("profitReportPreviewHint"),
      a4: t("profitReportA4Hint"),
      a5: t("profitReportA5Hint"),
      pdf: t("profitReportPdfHint"),
    } satisfies Record<ReportMode, string>,
  };
}

/** The three ways out, as a row of buttons. */
export function ReportButtons({
  report,
  job,
  className,
}: {
  report: ProfitReport;
  job: ReportJob;
  className?: string;
}) {
  const t = useTranslations("Admin");
  const words = useModeWords();
  // A period with only «مرتجع» in it is still a report.
  const empty = isEmptyJob(job);
  return (
    <div role="group" aria-label={t(job.kind === "cash" ? "cashReport" : "profitReport")} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {MODES.map(({ mode, Icon }) => {
        const mine = report.busy === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => report.start(mode, job)}
            disabled={report.busy !== null || empty}
            aria-busy={mine}
            title={empty ? t("profitReportEmpty") : words.hint[mode]}
            className={cn(
              "press inline-flex items-center gap-1.5 rounded-control border px-3 py-2 text-[0.78rem] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              mode === "a4"
                ? "border-brand bg-brand text-white hover:bg-brand/90"
                : "border-brand/40 bg-brand/6 text-brand hover:bg-brand hover:text-white",
            )}
          >
            {mine ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
            {words.label[mode]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The chooser Ctrl+P opens on the repair desk (the shop, 2026-11-20): print
 * the report on A4 or A5, or download it as a PDF. In the desk app the page
 * asks for the desk's password before this opens at all.
 */
export function ReportPrintDialog({
  open,
  onClose,
  report,
  job,
}: {
  open: boolean;
  onClose: () => void;
  report: ProfitReport;
  job: ReportJob;
}) {
  const t = useTranslations("Admin");
  const words = useModeWords();
  const owner = useOwnerDocument();
  // A period with only «مرتجع» in it is still a report.
  const empty = isEmptyJob(job);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal container={owner?.body}>
        <Dialog.Overlay className="fixed inset-0 z-85 bg-scrim/55 data-[state=open]:[animation:dialog-overlay-in_120ms_ease-out]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed start-1/2 top-1/2 z-88 w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-panel border border-line bg-surface p-5 shadow-lift focus:outline-none data-[state=open]:[animation:dialog-content-in_160ms_ease-out] rtl:translate-x-1/2"
          style={{ ["--dialog-content-x" as string]: "-50%" }}
        >
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-card bg-brand/10 text-brand" aria-hidden>
              <ClipboardList className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[1rem] font-black text-ink">{t("printChooserTitle")}</Dialog.Title>
              <p className="mt-0.5 text-[0.78rem] font-medium leading-relaxed text-muted">
                {empty
                  ? t("profitReportEmpty")
                  : job.kind === "cash"
                    ? t("cashChooserBody", { count: job.moves?.length ?? 0, period: job.context.period })
                    : t("printChooserBody", { count: job.rows.length, period: job.context.period })}
              </p>
            </div>
            <Dialog.Close
              aria-label={t("close")}
              className="press -m-1 rounded-full p-1.5 text-muted hover:bg-subtle hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>
          <ul className="mt-4 grid gap-2">
            {MODES.map(({ mode, Icon }) => (
              <li key={mode}>
                <button
                  type="button"
                  disabled={empty || report.busy !== null}
                  onClick={() => {
                    onClose();
                    report.start(mode, job);
                  }}
                  className="press flex w-full items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-3 text-start transition-colors hover:border-brand hover:bg-brand/5 focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-brand/10 text-brand" aria-hidden>
                    <Icon className="size-4.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.86rem] font-black text-ink">{words.label[mode]}</span>
                    <span className="block text-[0.72rem] font-medium text-muted">{words.hint[mode]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The report on the screen, page by page, as it will print — and the three
 * ways out from it, so checking one figure costs no download.
 */
function ReportPreviewDialog({
  preview,
  busy,
  onClose,
  onDownload,
  onPrint,
}: {
  preview: ReportPreview;
  busy: boolean;
  onClose: () => void;
  onDownload: () => void;
  onPrint: (mode: "a4" | "a5") => void;
}) {
  const t = useTranslations("Admin");
  const owner = useOwnerDocument();
  const count = preview.urls.length;
  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal container={owner?.body}>
        <Dialog.Overlay className="fixed inset-0 z-85 bg-scrim/60 data-[state=open]:[animation:dialog-overlay-in_120ms_ease-out]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 top-0 z-88 mx-auto flex w-full max-w-[min(56rem,100vw)] flex-col bg-canvas shadow-lift focus:outline-none sm:inset-y-4 sm:rounded-panel sm:border sm:border-line"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-3 sm:rounded-t-panel">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-card bg-brand/10 text-brand" aria-hidden>
              <Eye className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[0.95rem] font-black text-ink">{t("profitReportPreviewTitle")}</Dialog.Title>
              <p className="text-[0.72rem] font-semibold text-muted">
                {preview.job.context.period} · {t("profitReportPreviewPages", { count, n: String(count) })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onDownload}
                disabled={busy}
                className="press inline-flex items-center gap-1.5 rounded-control border border-brand bg-brand px-3 py-2 text-[0.78rem] font-extrabold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                <Download className="size-4" aria-hidden />
                {t("profitReportPdf")}
              </button>
              {(["a4", "a5"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onPrint(mode)}
                  disabled={busy}
                  className="press inline-flex items-center gap-1.5 rounded-control border border-brand/40 bg-brand/6 px-3 py-2 text-[0.78rem] font-extrabold text-brand hover:bg-brand hover:text-white disabled:opacity-50"
                >
                  {mode === "a4" ? <Printer className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                  {t(mode === "a4" ? "profitReportA4" : "profitReportA5")}
                </button>
              ))}
              <Dialog.Close
                aria-label={t("close")}
                className="press rounded-full p-1.5 text-muted hover:bg-subtle hover:text-ink"
              >
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
            <ol className="mx-auto flex max-w-[48rem] flex-col items-center gap-4">
              {preview.urls.map((url, index) => (
                <li key={url} className="w-full">
                  {/* A picture of the page drawn on this device; nothing for the image optimiser to fetch. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={t("profitReportPage", { page: String(index + 1), pages: String(count) })}
                    className="block w-full rounded-card border border-line bg-white shadow-card"
                  />
                  <p className="mt-1 text-center text-[0.7rem] font-bold text-muted">
                    {t("profitReportPage", { page: String(index + 1), pages: String(count) })}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── The pages ────────────────────────────────────────────────────────────── */

/**
 * Off the left edge of the page, laid out but unseen — the print station's
 * own stage. ⚠️ Not `display: none`: an element with no layout has no size
 * to measure and nothing for the rasteriser to copy.
 */
const OFFSCREEN: CSSProperties = { position: "fixed", top: 0, left: "-100000px", pointerEvents: "none" };

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
  const report = buildProfitReport(task.job, t("unassigned"));
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
      const tail = root.querySelector<HTMLElement>("[data-measure-tail]")?.getBoundingClientRect().height ?? 0;
      setLayout(paginateWithTail(heights, room("first"), room("next"), tail));
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

  const common = { paper, report, context: task.job.context, printedAt: task.printedAt };

  if (!layout) {
    return createPortal(
      <div ref={measured} aria-hidden inert dir={dir} lang={locale} style={OFFSCREEN}>
        <ReportPage {...common} measure="first" first lines={[]} moves={[]} startIndex={0} pageNo={1} pageCount={1} />
        <ReportPage
          {...common}
          measure="next"
          first={false}
          lines={report.rows}
          moves={report.moves}
          startIndex={0}
          pageNo={1}
          pageCount={1}
        />
        <div data-measure-tail style={{ width: `${paper.sheetWidthMm - 20}mm` }}>
          {report.kind === "cash" ? <CashSummary report={report} /> : <ReportSummary report={report} />}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div ref={drawn} aria-hidden inert dir={dir} lang={locale} style={OFFSCREEN}>
      {layout.map((indices, index) => (
        <ReportPage
          key={index}
          {...common}
          first={index === 0}
          last={index === layout.length - 1}
          lines={report.kind === "cash" ? [] : indices.map((row) => report.rows[row])}
          moves={report.kind === "cash" ? indices.map((row) => report.moves[row]) : []}
          startIndex={indices[0] ?? 0}
          pageNo={index + 1}
          pageCount={layout.length}
        />
      ))}
    </div>,
    document.body,
  );
}

const money = (value: number) => formatPrice(Math.round(value));

/**
 * A change, with its sign: "+10,000", "-30,000" — held left-to-right by
 * isolates in the text itself. The picture the paper is drawn from kept the
 * sign of a figure inside a line of Arabic on the wrong side even under
 * `data-numeric`; characters cannot be lost the way a style can.
 */
const signed = (value: number) =>
  `\u2066${value > 0 ? "+" : value < 0 ? "-" : ""}${money(Math.abs(value))}\u2069`;

/** What one «راجع» was, in words, for the report's «راجع» rows. */
function ChangeWords({ change }: { change: ReturnDescription }) {
  const t = useTranslations("Admin");
  if (change.kind !== "edit") return <span className="font-bold">{t(`deskReturnKind_${change.kind}`)}</span>;
  return (
    <span className="font-bold">
      {change.changes.map((item, index) => (
        <span key={item.field}>
          {index > 0 && " · "}
          {t(`deskReturnField_${item.field}`)} <span data-numeric>{money(item.from)}</span> {t("deskReturnArrow")}{" "}
          <span data-numeric>{money(item.to)}</span>
        </span>
      ))}
    </span>
  );
}

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
 * The first carries the letterhead the receipt and the warranty carry and the
 * filters; every page after it a slim running head, so a page picked up off
 * the printer on its own still says what it is. Every page ends on its number;
 * the last one closes on the totals.
 */
function ReportPage({
  paper,
  report,
  context,
  printedAt,
  first,
  last = false,
  lines,
  moves,
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
  /** The page the totals close. */
  last?: boolean;
  lines: readonly ReportRow[];
  /** A cash report's movements on this page. */
  moves: readonly CashLine[];
  startIndex: number;
  pageNo: number;
  pageCount: number;
  measure?: "first" | "next";
}) {
  const t = useTranslations("Admin");
  const brand = useTranslations("Brand");
  const day = baghdadDay(printedAt);
  const clock = clockOf(printedAt);
  const cash = report.kind === "cash";
  const title = t(cash ? "cashReport" : "profitReport");

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
            <PaperTitle>{title}</PaperTitle>
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
              <p className="mt-[0.6mm] text-[14pt] font-bold leading-[1.15] text-[#e11d2e]">{title}</p>
            </div>
            <div className="me-[10mm] flex shrink-0 items-center gap-[2mm]">
              <CompanyMark className="size-[9mm]" />
              <p className="whitespace-nowrap text-[10.5pt] font-bold leading-[1.2] text-[#333333]">{brand("name")}</p>
            </div>
          </header>
          <PaperRule />
        </div>
      )}

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
        {cash
          ? (moves.length > 0 || measure) && <CashTable lines={moves} startIndex={startIndex} />
          : (lines.length > 0 || measure) && <ReportTable lines={lines} startIndex={startIndex} />}
        {last && !measure && (cash ? <CashSummary report={report} /> : <ReportSummary report={report} />)}
      </div>

      <footer className="mt-[2.4mm] flex shrink-0 items-center justify-between gap-[4mm] border-0 border-t-[0.25mm] border-solid border-[#f2c4ca] pt-[1.8mm] text-[7.4pt] font-semibold leading-[1.3]">
        <p className="min-w-0 whitespace-nowrap">
          {title} — {context.desk} · <span data-numeric>{day}  {clock}</span>
        </p>
        <p className="shrink-0 whitespace-nowrap font-bold text-[#a90f1d]">
          {t("profitReportPage", { page: String(pageNo), pages: String(pageCount) })}
        </p>
      </footer>
    </article>
  );
}

/**
 * The figures that close the report, after the last row — the panel's cards,
 * on paper, in the panel's own order (the shop, 2026-11-20).
 * Three rows of three, so a seven-digit figure keeps its size. The profit is
 * the one figure in red, because it is the reason the report is printed.
 *
 * ⚠️ The figure sits in a span inside the cell, never on it: `data-numeric`
 * pins `direction: ltr`, so on the cell it would push the number to the LEFT
 * of an Arabic card while its label sits on the right.
 */
function ReportSummary({ report }: { report: BuiltReport }) {
  const t = useTranslations("Admin");
  const split = useCompletedSplit();
  const { totals } = report;
  const elsewhere = split(totals);
  // The panel's order (the shop, 2026-11-20), three a row.
  const cards: { key: string; label: string; value: string; sub?: string; strong?: boolean }[] = [
    {
      key: "count",
      label: t("profitReportTotalCount"),
      value: String(totals.tickets),
      sub:
        t("deskTicketsSub", { completed: totals.completed, cancelled: totals.cancelled, open: totals.open }) +
        (elsewhere ? ` — ${elsewhere}` : ""),
    },
    { key: "maintenance", label: t("financePriceTotal"), value: money(totals.maintenance) },
    { key: "cost", label: t("financeCostTotal"), value: money(totals.cost) },
    { key: "profit", label: t("financeProfitTotal"), value: money(totals.profit), strong: true },
    { key: "warranty", label: t("warrantyTitle"), value: money(totals.warranty) },
    { key: "cash", label: t("financeCollectedCash"), value: money(totals.collectedCash) },
    { key: "deferred", label: t("financeCollectedDeferred"), value: money(totals.collectedDeferred) },
    {
      key: "till",
      label: t("financeTill"),
      value: money(totals.till),
      sub: totals.returnTill
        ? `${t("financeTillFormulaReturns")} — ${t("deskTillReturns")} ${signed(totals.returnTill)}`
        : t("financeTillFormula"),
    },
    { key: "debts", label: t("financeOutstanding"), value: money(totals.outstanding) },
  ];
  return (
    <section className="shrink-0 pt-[3.4mm]">
      <dl className="grid grid-cols-3 gap-[2mm]">
        {cards.map((card) => (
          <div
            key={card.key}
            className={cn(
              "flex flex-col justify-between gap-[1.2mm] rounded-[2mm] border-[0.25mm] border-solid px-[2.8mm] py-[2mm]",
              card.strong ? "border-[#e11d2e] bg-[#e11d2e]" : "border-[#f2c4ca] bg-[#fdeff1]",
            )}
          >
            <dt className={cn("text-[7.4pt] font-bold leading-[1.3]", card.strong ? "text-white" : "text-[#a90f1d]")}>
              {card.label}
            </dt>
            <dd className={cn("text-[13pt] font-bold leading-[1.1]", card.strong ? "text-white" : "text-[#000]")}>
              <span data-numeric>{card.value}</span>
              {card.sub && (
                <span className={cn("mt-[0.8mm] block text-[6.6pt] font-semibold leading-[1.25]", card.strong ? "text-white" : "text-[#000]")}>
                  {card.sub}
                </span>
              )}
            </dd>
          </div>
        ))}
        {totals.returnTickets > 0 && (
          <div className="col-span-3 flex flex-col gap-[1.4mm] rounded-[2mm] border-[0.25mm] border-solid border-[#333333] bg-white px-[2.8mm] py-[2mm]">
            <dt className="text-[8.4pt] font-bold leading-[1.3] text-[#333333]">
              {t("deskReturnsCard")} · {t("deskReturnsTickets", { count: totals.returnTickets })}
              <span className="ms-[2mm] text-[7pt] font-semibold text-[#000]">{t("deskReturnsApart")}</span>
            </dt>
            <dd className="grid grid-cols-3 gap-[2mm]">
              {totals.returnDownTickets > 0 ? (
                <span className="flex flex-col gap-[0.6mm] rounded-[1.6mm] border-[0.25mm] border-solid border-[#e11d2e] bg-[#fdeff1] px-[2.4mm] py-[1.4mm]">
                  <span className="text-[7.4pt] font-bold text-[#a90f1d]">{t("deskReturnsNegative")}</span>
                  <span className="text-[12pt] font-bold text-[#e11d2e]" data-numeric>
                    {signed(totals.returnDown)}
                  </span>
                  <span className="text-[6.8pt] font-semibold">{t("deskReturnsTickets", { count: totals.returnDownTickets })}</span>
                </span>
              ) : (
                <span />
              )}
              {totals.returnUpTickets > 0 ? (
                <span className="flex flex-col gap-[0.6mm] rounded-[1.6mm] border-[0.25mm] border-solid border-[#1f8a4c] bg-[#eaf6ef] px-[2.4mm] py-[1.4mm]">
                  <span className="text-[7.4pt] font-bold text-[#17683a]">{t("deskReturnsPositive")}</span>
                  <span className="text-[12pt] font-bold text-[#17683a]" data-numeric>
                    {signed(totals.returnUp)}
                  </span>
                  <span className="text-[6.8pt] font-semibold">{t("deskReturnsTickets", { count: totals.returnUpTickets })}</span>
                </span>
              ) : (
                <span />
              )}
              <span className="flex flex-col gap-[0.6mm] rounded-[1.6mm] border-[0.25mm] border-solid border-[#333333] px-[2.4mm] py-[1.4mm]">
                <span className="text-[7.4pt] font-bold text-[#333333]">{t("deskReturnsTill")}</span>
                <span className={cn("text-[12pt] font-bold", totals.returnTill < 0 ? "text-[#e11d2e]" : "text-[#000]")} data-numeric>
                  {signed(totals.returnTill)}
                </span>
                <span className="text-[6.8pt] font-semibold">{t("deskReturnsTillSub")}</span>
              </span>
            </dd>
          </div>
        )}
      </dl>
      <ul className="mt-[1.8mm] flex flex-wrap gap-x-[5mm] gap-y-[0.8mm] text-[7.6pt] font-semibold leading-[1.3]">
        {totals.returnTickets > 0 && (
          <li className="flex items-center gap-[1.4mm]">
            <span className="size-[1.4mm] shrink-0 rotate-45 bg-[#333333]" aria-hidden />
            {t("profitReportReturnsIncluded")}
          </li>
        )}
        {totals.missingCost > 0 && (
          <li className="flex items-center gap-[1.4mm]">
            <span className="size-[1.4mm] shrink-0 rotate-45 bg-[#e11d2e]" aria-hidden />
            {t("profitReportMissingCost", { count: totals.missingCost, n: String(totals.missingCost) })}
          </li>
        )}
        {totals.paidFromEarlier > 0 && (
          <li className="flex items-center gap-[1.4mm]">
            <span className="size-[1.4mm] shrink-0 rotate-45 bg-[#e11d2e]" aria-hidden />
            {t("profitReportPaidEarlier", { count: totals.paidFromEarlier, n: String(totals.paidFromEarlier) })}
          </li>
        )}
        {!report.includeCancelled && (
          <li className="flex items-center gap-[1.4mm]">
            <span className="size-[1.4mm] shrink-0 rotate-45 bg-[#e11d2e]" aria-hidden />
            {t("profitReportCancelledNote")}
          </li>
        )}
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
          if (line.kind === "returnHead") {
            return (
              <tr key={line.id}>
                <td colSpan={heads.length} className="border-0 bg-[#333333] px-[2.4mm] py-[1.8mm] text-start align-middle leading-[1.3] text-white">
                  <span className="text-[9pt] font-bold">{t("profitReportReturnsTitle")}</span>
                  <span className="ms-[2mm] text-[7.2pt] font-semibold">{t("profitReportReturnsNote")}</span>
                </td>
              </tr>
            );
          }
          if (line.kind === "returnGroup") {
            const down = line.direction === "down";
            return (
              <tr key={line.id}>
                <td
                  colSpan={heads.length}
                  className={cn(
                    "border-0 border-b-[0.25mm] border-solid px-[2.4mm] py-[1.5mm] text-start align-middle leading-[1.3]",
                    down ? "border-[#e11d2e] bg-[#fdeff1] text-[#a90f1d]" : "border-[#1f8a4c] bg-[#eaf6ef] text-[#17683a]",
                  )}
                >
                  <span className="text-[8.6pt] font-bold">
                    {t(down ? "profitReportReturnsDown" : "profitReportReturnsUp")}
                  </span>
                  <span className="ms-[2mm] text-[7.4pt] font-semibold">
                    {t("deskReturnsTickets", { count: line.no })} ·{" "}
                    <span className="font-bold" data-numeric>
                      {signed(line.amount ?? 0)}
                    </span>
                  </span>
                </td>
              </tr>
            );
          }
          if (line.kind === "return") {
            return (
              <tr key={line.id} className={line.no % 2 ? "bg-white" : "bg-[#f6f6f6]"}>
                <td className={cn(CELL, "text-center font-bold text-[#333333]")} data-numeric>
                  {line.no}
                </td>
                <td className={cn(CELL, "text-start font-bold")}>{line.employee}</td>
                <td
                  className={cn(CELL, "text-center font-bold", line.direction === "down" ? "text-[#e11d2e]" : "text-[#17683a]")}
                  data-numeric
                >
                  {signed(line.amount ?? 0)}
                </td>
                <td className={cn(CELL, "text-center")} data-numeric>
                  {line.warranty !== 0 ? signed(line.warranty) : "—"}
                </td>
                <td className={cn(CELL, "text-center font-bold", (line.profit ?? 0) < 0 && "text-[#e11d2e]")} data-numeric>
                  {signed(line.profit ?? 0)}
                </td>
                <td className={cn(CELL, "text-center font-bold")} dir="auto">
                  {line.device}
                </td>
                <td className={cn(CELL, "text-start")}>
                  {line.change && <ChangeWords change={line.change} />}
                  <span className="block text-[7pt] font-semibold">
                    <span data-numeric>{line.code}</span> · {t("profitReportReturnOpened", { day: `\u2066${line.openedDay ?? ""}\u2069` })}
                  </span>
                </td>
                <td className={cn(CELL, "whitespace-nowrap text-center")} data-numeric>
                  {line.day}
                </td>
              </tr>
            );
          }
          return (
            <tr key={line.id} className={n % 2 ? "bg-[#fdeff1]" : "bg-white"}>
              <td className={cn(CELL, "text-center font-bold text-[#a90f1d]")} data-numeric>
                {line.no}
              </td>
              <td className={cn(CELL, "text-start font-bold")}>{line.employee}</td>
              <td className={cn(CELL, "text-center font-bold")} data-numeric>
                {line.cancelled
                  ? t("profitReportCancelledShort")
                  : line.owing
                    ? t("profitReportOwingShort")
                    : line.amount == null
                      ? "—"
                      : money(line.amount)}
              </td>
              <td className={cn(CELL, "text-center")} data-numeric>
                {line.warranty > 0 ? money(line.warranty) : "—"}
              </td>
              <td
                className={cn(CELL, "text-center font-bold", line.profit != null && line.profit < 0 && "text-[#e11d2e]")}
                data-numeric
              >
                {line.profit == null ? "—" : `${money(line.profit)}${line.noCost ? " *" : ""}`}
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

/* ── تقرير الخزينة ─────────────────────────────────────────────────────── */

/**
 * The safe's movements, one row each, in the order the money moved — the
 * same fixed-width table as جرد الأرباح, so a row measures what it draws.
 */
const CASH_WIDTHS = ["8mm", "21mm", "30mm", undefined, "26mm", "24mm", "24mm", "25mm"] as const;

function CashTable({ lines, startIndex }: { lines: readonly CashLine[]; startIndex: number }) {
  const t = useTranslations("Admin");
  const heads = [
    "#",
    t("cashReportColCode"),
    t("cashReportColCustomer"),
    t("profitReportColDevice"),
    t("profitReportColEmployee"),
    t("cashReportColKind"),
    t("cashReportColAmount"),
    t("cashReportColTime"),
  ];
  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {CASH_WIDTHS.map((width, index) => (
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
          const refund = line.amount < 0;
          return (
            <tr key={`${line.id}-${line.at}`} className={n % 2 ? "bg-[#fdeff1]" : "bg-white"}>
              <td className={cn(CELL, "text-center font-bold text-[#a90f1d]")} data-numeric>
                {line.no}
              </td>
              <td className={cn(CELL, "text-center font-bold")} data-numeric>
                {line.code}
              </td>
              <td className={cn(CELL, "text-start font-bold")}>{line.customer}</td>
              <td className={cn(CELL, "text-center")} dir="auto">
                {line.device}
              </td>
              <td className={cn(CELL, "text-start")}>{line.employee}</td>
              <td className={cn(CELL, "text-center font-bold", line.kind === "return" && "text-[#333333]")}>
                {t(`cashMove_${line.kind}`)}
              </td>
              <td className={cn(CELL, "text-center font-bold", refund && "text-[#e11d2e]")} data-numeric>
                {signed(line.amount)}
              </td>
              <td className={cn(CELL, "whitespace-nowrap text-center")} data-numeric>
                {line.day} {line.clock}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The safe's figures after the last movement — the cash tab's own cards, on
 * paper. «واصل بالخزنة» is the one in red: it is what the drawer is counted
 * against at closing time.
 */
function CashSummary({ report }: { report: BuiltReport }) {
  const t = useTranslations("Admin");
  const { totals } = report;
  const cards: { key: string; label: string; value: string; sub?: string; strong?: boolean }[] = [
    { key: "cash", label: t("financeCollectedCash"), value: money(totals.collectedCash) },
    { key: "deferred", label: t("financeCollectedDeferred"), value: money(totals.collectedDeferred) },
    { key: "warranty", label: t("cashWarrantyIn"), value: money(totals.tillWarranty) },
    totals.returnTill
      ? { key: "returns", label: t("deskReturnsCard"), value: signed(totals.returnTill), sub: t("deskReturnsTillSub") }
      : { key: "moves", label: t("cashMovesCount"), value: String(report.moves.length) },
    {
      key: "till",
      label: t("financeTill"),
      value: money(totals.till),
      sub: t(totals.returnTill ? "financeTillFormulaReturns" : "financeTillFormula"),
      strong: true,
    },
    { key: "debts", label: t("financeOutstanding"), value: money(totals.outstanding), sub: t("cashDebtsNow") },
  ];
  return (
    <section className="shrink-0 pt-[3.4mm]">
      <dl className="grid grid-cols-3 gap-[2mm]">
        {cards.map((card) => (
          <div
            key={card.key}
            className={cn(
              "flex flex-col justify-between gap-[1.2mm] rounded-[2mm] border-[0.25mm] border-solid px-[2.8mm] py-[2mm]",
              card.strong ? "border-[#e11d2e] bg-[#e11d2e]" : "border-[#f2c4ca] bg-[#fdeff1]",
            )}
          >
            <dt className={cn("text-[7.4pt] font-bold leading-[1.3]", card.strong ? "text-white" : "text-[#a90f1d]")}>
              {card.label}
            </dt>
            <dd className={cn("text-[13pt] font-bold leading-[1.1]", card.strong ? "text-white" : "text-[#000]")}>
              <span data-numeric>{card.value}</span>
              {card.sub && (
                <span className={cn("mt-[0.8mm] block text-[6.6pt] font-semibold leading-[1.25]", card.strong ? "text-white" : "text-[#000]")}>
                  {card.sub}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="mt-[1.8mm] flex flex-wrap gap-x-[5mm] gap-y-[0.8mm] text-[7.6pt] font-semibold leading-[1.3]">
        <li className="flex items-center gap-[1.4mm]">
          <span className="size-[1.4mm] shrink-0 rotate-45 bg-[#e11d2e]" aria-hidden />
          {t("cashReportRule")}
        </li>
      </ul>
    </section>
  );
}
