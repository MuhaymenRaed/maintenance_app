"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  Printer,
  RotateCcw,
  Settings2,
  XCircle,
} from "lucide-react";
import { LabelSheet, ReceiptSheet, RepairPrintRun, WarrantySheet } from "@/components/admin/repair-print";
import { PrinterSetupDialog } from "@/components/admin/printer-setup";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAgentPresence } from "@/lib/print/agent-presence";
import { summarise } from "@/lib/print/job-status";
import {
  cancelStuckJob,
  deliverPaper,
  dismissRun,
  openPrinterSetup,
  printStation,
  printWithBrowserDialog,
  retryJobs,
  type JobReason,
  type RasterRequest,
  type StationJob,
  type StationRun,
} from "@/lib/print/station";
import { cn } from "@/lib/utils";

/**
 * Everything the print station draws, mounted once in the admin layout.
 *
 * The run lives in `lib/print/station.ts`; this reads it. Three things here:
 * the panel that says what happened to each paper, the off-screen stage where
 * the papers are drawn so the station can photograph them, and — when the
 * person chooses it — the old browser-dialog run for whatever is left.
 */
export function PrintStationHost() {
  /*
   * The dashboard looks for the print agent itself, and starts it if it is
   * not there — which is what replaced a scheduled task spawning PowerShell
   * every three minutes on the counter PC. See `lib/print/agent-presence.ts`.
   */
  useAgentPresence();

  const { run, raster, dialog, setup } = useSyncExternalStore(
    printStation.subscribe,
    printStation.snapshot,
    printStation.server,
  );

  return (
    <>
      {raster && <RasterStage key={raster.id} request={raster} />}
      {/* ⚠️ Not while the printer setup is open: the panel sits above every
          dialog (z-110) and covered the setup's own controls — the shop's
          report, with a screenshot. The run carries on underneath; the panel
          is back the moment the setup closes. */}
      {run && run.stage !== "dialog" && !setup && <StationPanel run={run} />}
      {dialog && (
        <RepairPrintRun
          key={dialog.key}
          facts={dialog.facts}
          printedAt={dialog.printedAt}
          jobs={dialog.papers}
          onDone={dismissRun}
        />
      )}
      {setup && <PrinterSetupDialog mode={setup} />}
    </>
  );
}

/* ── The stage ────────────────────────────────────────────────────────────── */

/**
 * The papers, rendered off-screen at their real size and handed to the
 * rasterizer one by one.
 *
 * ⚠️ Laid out, not hidden: a `display: none` element has no size and no
 * computed layout to copy, so the stage sits far off the left edge of the
 * page instead. Not `.print-sheet` either — that class is hidden on screen
 * and is the dialog path's.
 *
 * The effect may run twice in development (StrictMode). The first run's
 * results are dropped by `alive`, and the second draws them again — there is
 * deliberately no "already drawn" ref, the pairing that once left the rating
 * dialog on its skeleton for ever.
 */
function RasterStage({ request }: { request: RasterRequest }) {
  const holder = useRef<HTMLDivElement>(null);
  const label = request.settings.label;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const papers = await import("@/lib/print/papers");
      for (const paper of request.papers) {
        const sheet = holder.current?.querySelector<HTMLElement>(`[data-paper="${paper}"] .print-paper`);
        try {
          if (!sheet) throw new Error(`the ${paper} was not rendered`);
          const payload =
            paper === "label"
              ? await papers.labelPaper(sheet, request.settings)
              : await papers.a5Paper(sheet, request.settings);
          if (alive) deliverPaper(request.id, paper, payload);
        } catch (error) {
          if (alive) deliverPaper(request.id, paper, error instanceof Error ? error : new Error(String(error)));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [request]);

  return createPortal(
    <div
      ref={holder}
      aria-hidden
      inert
      style={{ position: "fixed", top: 0, left: "-100000px", pointerEvents: "none" }}
    >
      {request.papers.map((paper) => (
        <div key={paper} data-paper={paper} className="bg-white">
          {paper === "label" ? (
            <LabelSheet
              facts={request.facts}
              layout={{
                widthMm: label.widthMm - 2,
                heightMm: label.media === "continuous" ? null : label.heightMm - 2,
              }}
            />
          ) : paper === "receipt" ? (
            <ReceiptSheet facts={request.facts} printedAt={request.printedAt} />
          ) : (
            <WarrantySheet facts={request.facts} />
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ── The panel ────────────────────────────────────────────────────────────── */

const DONE_CLOSES_AFTER_MS = 8000;

/** A paper not sent because its printer is not there — a fact about the counter, not a fault. */
const ABSENT = new Set<JobReason | null>(["no_printer", "printer_missing", "not_connected", "printer_status"]);

/**
 * What happened to each paper, in words, with the one action that fixes it.
 *
 * ⚠️ It never says a paper printed: the strongest thing it says is that
 * Windows reported the job sent to the printer, which is the most anything on
 * this side can know. "Unconfirmed" is not dressed up as success, and a
 * failure names the printer it happened on.
 *
 * ⚠️ `pointer-events-auto` and a stopped `pointerdown`: the panel is often
 * drawn over an open ticket dialog, whose Radix modal sets
 * `pointer-events: none` on `<body>` and closes itself on any press outside
 * it. Without both, the panel's buttons would be dead — or would close the
 * ticket the manager was in the middle of.
 */
function StationPanel({ run }: { run: StationRun }) {
  const t = useTranslations("Admin");
  const [confirming, setConfirming] = useState(false);
  const summary = summarise(run.jobs.map((job) => job.phase));
  const settled = run.stage === "settled";
  const failed = run.jobs.filter((job) => job.phase === "failed" || job.phase === "skipped").length;
  const uncertain = run.jobs.some((job) => job.phase === "uncertain");
  const unsent = run.jobs.some((job) => job.phase !== "done");
  const absent = run.jobs.filter((job) => job.phase === "skipped" && ABSENT.has(job.reason));
  // Everything that could print did, and the rest only waited on a printer
  // that is not there: the Canon unplugged, most days. Said calmly, because
  // nothing went wrong — and the browser dialog is still offered beneath.
  const onlyAbsent =
    settled &&
    !run.problem &&
    absent.length > 0 &&
    summary.failed === absent.length &&
    summary.attention === 0 &&
    summary.uncertain === 0;
  const absentPrinters = [...new Set(absent.map((job) => job.printer).filter(Boolean))].join("، ");

  useEffect(() => {
    if (!settled || run.problem || summary.outcome !== "all_done") return;
    const timer = setTimeout(dismissRun, DONE_CLOSES_AFTER_MS);
    return () => clearTimeout(timer);
  }, [settled, run.problem, summary.outcome, run.id]);

  const statusName = (text: string) =>
    t.has(`psStatus_${text}` as "psStatus_OFFLINE") ? t(`psStatus_${text}` as "psStatus_OFFLINE") : text;

  const headline = run.problem
    ? t(`psProblem_${run.problem.code}_title` as "psProblem_not_running_title")
    : !settled
      ? t(`psStage_${run.stage}` as "psStage_starting")
      : summary.outcome === "all_done"
        ? t("psOutcome_all_done")
        : onlyAbsent
          ? absent.length === summary.total
            ? t("psOutcome_none_available")
            : t("psOutcome_skipped", { count: String(absent.length), printers: absentPrinters || t("psPrinterNone") })
          : summary.outcome === "sent"
            ? t("psOutcome_sent", { count: String(summary.total - summary.done) })
            : t("psOutcome_problems", { count: String(summary.failed + summary.attention + summary.uncertain) });

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-110 flex justify-center px-4">
      <section
        role="status"
        aria-live="polite"
        onPointerDown={(event) => event.stopPropagation()}
        className="pointer-events-auto w-full max-w-[28rem] overflow-hidden rounded-panel border border-line bg-surface shadow-[0_18px_48px_-12px_rgb(0_0_0/0.35)]"
      >
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <span
            className={cn(
              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control",
              run.problem || (summary.outcome === "problems" && !onlyAbsent)
                ? "bg-warning/12 text-warning"
                : onlyAbsent
                  ? "bg-info/12 text-info"
                  : settled
                    ? "bg-success/12 text-success"
                  : "bg-brand/10 text-brand",
            )}
          >
            {!settled ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Printer className="size-4" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.82rem] font-extrabold text-ink">
              {run.test ? t("psTitleTest") : t("psTitle", { code: run.code })}
            </p>
            <p className="text-[0.74rem] font-bold leading-relaxed text-muted">{headline}</p>
            {run.problem && (
              <p className="mt-1 text-[0.72rem] font-medium leading-relaxed text-ink">
                {t(`psProblem_${run.problem.code}` as "psProblem_not_running")}
              </p>
            )}
          </div>
        </header>

        <ol className="max-h-[45dvh] space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
          {run.jobs.map((job) => (
            <JobRow key={job.id} job={job} run={run} statusName={statusName} />
          ))}
        </ol>

        {settled && (
          <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            {(run.problem || failed > 0) && run.problem?.code !== "setup_needed" && (
              <button
                type="button"
                onClick={() => retryJobs()}
                className="press inline-flex items-center gap-1.5 rounded-control bg-brand px-3 py-2 text-[0.74rem] font-extrabold text-white hover:bg-brand-hover"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {/*
                  ⚠️ A stopped agent gets its own words. "Try again" on a run
                  that stopped because nothing was listening reads as "ask the
                  same dead port once more"; the press now starts the agent
                  first (`retryJobs` forces the wake), so the label has to say
                  so or it promises less than it does.
                */}
                {run.problem?.code === "not_running"
                  ? t("psRetryStart")
                  : run.problem
                    ? t("psRetry")
                    : t("psRetryFailed", { count: String(failed) })}
              </button>
            )}
            {uncertain && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="press inline-flex items-center gap-1.5 rounded-control border border-warning/50 px-3 py-2 text-[0.74rem] font-extrabold text-warning"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {t("psRetryUncertain")}
              </button>
            )}
            {(run.problem || summary.outcome === "problems") && unsent && !run.test && (
              <button
                type="button"
                onClick={printWithBrowserDialog}
                className="press rounded-control border border-line px-3 py-2 text-[0.74rem] font-extrabold text-ink hover:border-brand hover:text-brand"
              >
                {t("psUseDialog")}
              </button>
            )}
            <button
              type="button"
              onClick={openPrinterSetup}
              className="press inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-[0.74rem] font-extrabold text-ink hover:border-brand hover:text-brand"
            >
              <Settings2 className="size-3.5" aria-hidden />
              {t("psSetup")}
            </button>
            <button
              type="button"
              onClick={dismissRun}
              className="ms-auto rounded-control px-3 py-2 text-[0.74rem] font-bold text-muted hover:text-ink"
            >
              {t("psClose")}
            </button>
          </footer>
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        title={t("psConfirmUncertainTitle")}
        body={t("psConfirmUncertainBody")}
        confirmLabel={t("psConfirmUncertainYes")}
        cancelLabel={t("psCancel")}
        tone="normal"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          retryJobs({ includeUncertain: true });
        }}
      />
    </div>
  );
}

const ICON: Record<StationJob["phase"], React.ComponentType<{ className?: string }>> = {
  waiting: CircleDashed,
  preparing: Loader2,
  sending: Loader2,
  queued: Clock,
  printing: Loader2,
  done: CheckCircle2,
  unconfirmed: Clock,
  attention: AlertTriangle,
  failed: XCircle,
  uncertain: AlertTriangle,
  skipped: XCircle,
};

function JobRow({
  job,
  run,
  statusName,
}: {
  job: StationJob;
  run: StationRun;
  statusName: (text: string) => string;
}) {
  const t = useTranslations("Admin");
  const Icon = ICON[job.phase];
  const spinning = job.phase === "preparing" || job.phase === "sending" || job.phase === "printing";
  const printerState = job.printer
    ? Object.entries(run.printerStatus).find(([name]) => name.toLowerCase() === job.printer!.toLowerCase())?.[1]
    : undefined;
  const phase =
    job.phase === "done"
      ? t(job.confirmation === "printed" ? "psPhase_done_printed" : "psPhase_done_left")
      : t(`psPhase_${job.phase}` as "psPhase_waiting");
  const detail = job.detail ?? "";
  const reason = job.reason
    ? t(`psReason_${job.reason}` as "psReason_spooler", {
        printer: job.printer ?? "",
        status: statusName(detail),
        detail,
      })
    : null;
  const tone =
    job.phase === "done"
      ? "text-success"
      : job.phase === "failed" || job.phase === "skipped"
        ? "text-brand"
        : job.phase === "attention" || job.phase === "uncertain" || job.phase === "unconfirmed"
          ? "text-warning"
          : "text-muted";

  return (
    <li className="flex items-start gap-2.5">
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone, spinning && "animate-spin")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[0.78rem] font-extrabold text-ink">
          {t(`psPaper_${job.paper}` as "psPaper_receipt")}
          {job.copies > 1 && (
            <span className="font-bold text-muted">
              {" · "}
              {t("psCopy", { copy: String(job.copy), copies: String(job.copies) })}
            </span>
          )}
        </p>
        <p className="truncate text-[0.68rem] font-medium text-muted" dir="auto">
          <Printer className="me-1 inline size-3" aria-hidden />
          {job.printer ?? t("psPrinterNone")}
          {printerState && printerState.statusText !== "OK" && printerState.severity !== "INFO" && (
            <span className="ms-1.5 font-bold text-warning">· {statusName(printerState.statusText)}</span>
          )}
        </p>
        <p className={cn("text-[0.72rem] font-bold", tone)}>{phase}</p>
        {reason && <p className="text-[0.68rem] font-medium leading-relaxed text-ink/80">{reason}</p>}
      </div>
      {job.phase === "attention" && job.spoolJobId != null && (
        <button
          type="button"
          onClick={() => void cancelStuckJob(job.id)}
          className="press shrink-0 rounded-control border border-line px-2 py-1 text-[0.66rem] font-extrabold text-ink hover:border-brand hover:text-brand"
        >
          {t("psCancelJob")}
        </button>
      )}
    </li>
  );
}
