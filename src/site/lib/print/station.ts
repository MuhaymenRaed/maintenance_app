import { loadRepairPrintFacts } from "@/lib/actions/print-station";
import type { RepairPrintFacts } from "@/lib/data/repair-print-facts";
import {
  AgentError,
  agentStatus,
  cancelJob,
  jobState,
  listPrinters,
  lostContact,
  sendJob,
  type AgentPayload,
  type JobState,
} from "@/lib/print/agent-client";
import { blocksPrinting, jobTransition, summarise, type Confirmation, type JobPhase } from "@/lib/print/job-status";
import { logPrint } from "@/lib/print/print-log";
import { suggestRoles, type PrinterInfo, type PrinterRole } from "@/lib/print/printer-match";
import type { StationSettings } from "@/lib/print/station-settings";
import { stationSettings } from "@/lib/print/station-store";

/**
 * The print station: one press of «طباعة», three papers, two printers, no
 * dialog — and an honest account of what happened to each.
 *
 * ---------------------------------------------------------------------------
 * Why a module and not a component
 * ---------------------------------------------------------------------------
 * A run outlives whatever started it: the manager presses print in a ticket's
 * dialog and closes it, or moves to another section, while the label is still
 * going out. So the run lives here, outside React, and the panel that shows it
 * (`components/admin/print-station.tsx`, mounted once in the admin layout) is
 * a reader of this store. Pictures of the papers are the one thing only React
 * can make — the sheets are components — so the store asks for them through
 * `raster` and the panel's stage hands them back.
 *
 * ---------------------------------------------------------------------------
 * The order of a run
 * ---------------------------------------------------------------------------
 * 1. Reach the print agent on this PC and, at the same moment, read the
 *    ticket fresh from the server — both receipts and the label carry one
 *    moment's facts.
 * 2. List the printers and decide which queue gets which paper: the choice
 *    saved on this computer, else a confident guess.
 * 3. ⚠️ **A printer that is not there is skipped, never waited for.** Not
 *    installed, unplugged, offline: its papers are marked "not sent" with the
 *    reason, and every other paper still prints. The shop's words: the Canon
 *    is often not connected, and the label must not wait on it.
 * 4. Draw the papers, once each — two receipt copies are one picture.
 * 5. Send, one job per copy, in order: receipt 1/2, receipt 2/2, label. A copy
 *    is its own job so a failed second copy is retried alone.
 * 6. Follow each job through the Windows queue until it leaves, up to
 *    `confirmSeconds`. The agent watches the queue every 120 ms on its side,
 *    so a label that prints in half a second is still seen printing.
 *
 * ⚠️ **Nothing here writes to the ticket.** Printing reads; a failed print
 * changes no record.
 */

export type StationPaper = "label" | "receipt" | "warranty";

/** One entry is a paper and how many copies of it — `TICKET_RUN`'s shape. */
export type PaperRequest = { paper: StationPaper; copies: number };

export type JobReason =
  | "no_printer"
  | "printer_missing"
  | "not_connected"
  | "printer_status"
  | "render_failed"
  | "rejected"
  | "connection_lost"
  | "skipped_after_failure"
  | "spooler"
  | "cancel_failed";

export type StationJob = {
  id: string;
  paper: StationPaper;
  copy: number;
  copies: number;
  role: PrinterRole;
  printer: string | null;
  phase: JobPhase;
  reason: JobReason | null;
  /** The spooler's or the agent's own words, for the panel's small print and the log. */
  detail: string | null;
  confirmation: Confirmation | null;
  jobName: string;
  /** What the agent tracks the job by; it is also in the job's name on the queue. */
  token: string;
  /** Windows' own number for the job, once the queue has given one. */
  spoolJobId: number | null;
};

export type RunProblem =
  | { code: "not_running" | "blocked" | "timeout" | "unsupported" }
  | { code: "facts_failed"; detail: string }
  | { code: "listing_failed"; detail: string }
  /** The session ended, so the server will not read the ticket. */
  | { code: "signed_out" }
  /** This account may not print from the repair desk. */
  | { code: "forbidden" }
  /** No printer could be chosen for ANY paper — the one case that asks first. */
  | { code: "setup_needed" };

export type PrinterState = { statusText: string; severity: "INFO" | "WARN" | "FATAL" };

export type StationRun = {
  id: string;
  code: string;
  stage: "starting" | "printing" | "confirming" | "settled" | "dialog";
  problem: RunProblem | null;
  jobs: StationJob[];
  printerStatus: Record<string, PrinterState>;
  /** The facts were read from the server at print time, not taken from the screen. */
  fresh: boolean;
  /** A test page from the setup, not a ticket. */
  test: boolean;
};

export type RasterRequest = {
  id: string;
  papers: StationPaper[];
  facts: RepairPrintFacts;
  printedAt: number;
  settings: StationSettings;
};

export type PaperPayload = AgentPayload;

export type PrintRequest = {
  /** Read the ticket fresh before printing. Null prints `facts` as given. */
  ticketId: string | null;
  facts: RepairPrintFacts;
  printedAt: number;
  papers: readonly PaperRequest[];
  locale: string;
  test?: boolean;
};

export type DialogHandoff = {
  key: string;
  facts: RepairPrintFacts;
  printedAt: number;
  papers: PaperRequest[];
};

type Snapshot = {
  run: StationRun | null;
  raster: RasterRequest | null;
  /** Papers handed to the browser's own print dialog instead. */
  dialog: DialogHandoff | null;
  /** The printer setup dialog: closed, open, or open because a run needs it. */
  setup: false | "open" | "confirm";
};

const IDLE: Snapshot = { run: null, raster: null, dialog: null, setup: false };
let state: Snapshot = IDLE;
const listeners = new Set<() => void>();

/** What the current run prints from — outside the snapshot, nothing draws it. */
let context: { request: PrintRequest; facts: RepairPrintFacts; freshLoaded: boolean } | null = null;
const pending = new Map<string, { resolve: (payload: PaperPayload) => void; reject: (error: Error) => void }>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(change: Partial<Snapshot>) {
  state = { ...state, ...change };
  emit();
}

function patchRun(id: string, change: (run: StationRun) => StationRun) {
  if (state.run?.id !== id) return;
  setState({ run: change(state.run) });
}

function patchJob(runId: string, jobId: string, change: (job: StationJob) => StationJob) {
  patchRun(runId, (run) => ({
    ...run,
    jobs: run.jobs.map((job) => (job.id === jobId ? change(job) : job)),
  }));
}

export const printStation = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => state,
  // ⚠️ One object, not a fresh one per call: React compares server snapshots
  // by identity and reads a new object every time as the store changing.
  server: (): Snapshot => IDLE,
};

const token = () => Math.random().toString(36).slice(2, 8);

const ROLE: Record<StationPaper, PrinterRole> = { receipt: "a5", warranty: "a5", label: "label" };

function newJobName(code: string, paper: StationPaper, copy: number, copies: number) {
  // ASCII on purpose: it is what the Windows queue shows, and the token at
  // its end is what the agent finds a picture's job by.
  const mark = token();
  return { jobName: `${code} ${paper} ${copy}/${copies} #${mark}`, token: mark };
}

/** Whether the run for this ticket code is still sending — the button's spinner. */
export function isPrinting(code?: string): boolean {
  const run = state.run;
  if (!run || run.stage === "settled" || run.stage === "dialog") return false;
  return code ? run.code === code : true;
}

/**
 * Starts a run, or refuses if one is still going. A second press while the
 * first is sending is exactly the duplicate this exists to prevent.
 */
export function startPrint(request: PrintRequest): "started" | "busy" {
  if (state.run && state.run.stage !== "settled" && state.run.stage !== "dialog") return "busy";
  const settings = stationSettings();
  const jobs: StationJob[] = request.papers.flatMap(({ paper, copies }) =>
    Array.from({ length: Math.max(1, copies) }, (_, index) => ({
      id: `${paper}-${index + 1}`,
      paper,
      copy: index + 1,
      copies: Math.max(1, copies),
      role: ROLE[paper],
      printer: null,
      phase: "waiting" as JobPhase,
      reason: null,
      detail: null,
      confirmation: null,
      ...newJobName(request.facts.code, paper, index + 1, Math.max(1, copies)),
      spoolJobId: null,
    })),
  );
  const run: StationRun = {
    id: token(),
    code: request.facts.code,
    stage: settings.method === "dialog" ? "dialog" : "starting",
    problem: null,
    jobs,
    printerStatus: {},
    fresh: false,
    test: !!request.test,
  };
  context = { request, facts: request.facts, freshLoaded: false };
  setState({
    run,
    dialog:
      run.stage === "dialog"
        ? { key: run.id, facts: request.facts, printedAt: request.printedAt, papers: dialogPapers(run) }
        : null,
  });
  logPrint({ level: "info", ticket: run.code, message: `run started: ${jobs.map((job) => job.id).join(", ")}` });
  if (run.stage !== "dialog") void execute(run.id);
  return "started";
}

/* ── The run ──────────────────────────────────────────────────────────────── */

/**
 * Which printer each paper goes to: the one saved on this PC — unless it is
 * no longer installed and Windows has an unmistakable printer for the job, in
 * which case that one. A queue renamed or reinstalled (the LPQ58 went from
 * "PPTII-A" to "HPRT LPQ58" on 2026-11-05) must not leave the label skipped
 * for ever because of a name saved last week.
 */
function resolvePrinters(list: PrinterInfo[], settings: StationSettings) {
  const guess = suggestRoles(list);
  const installed = new Set(list.map((printer) => printer.name.toLowerCase()));
  const pick = (role: PrinterRole): string | null => {
    const saved = settings.printers[role];
    const suggestion = guess[role]?.confident ? guess[role]!.name : null;
    if (saved && installed.has(saved.toLowerCase())) return saved;
    if (saved && suggestion) {
      logPrint({ level: "warn", message: `saved ${role} printer "${saved}" is not installed; using "${suggestion}"` });
      return suggestion;
    }
    return saved ?? suggestion;
  };
  return { a5: pick("a5"), label: pick("label") };
}

/**
 * The state a printer is in, as one word: its own blocking status if it has
 * one, NOT_CONNECTED for a USB printer whose cable is out, OK otherwise.
 */
function printerState(printer: PrinterInfo): PrinterState {
  if (printer.connected === false) return { statusText: "NOT_CONNECTED", severity: "FATAL" };
  const blocking = (printer.statuses ?? []).find((status) => blocksPrinting({ statusText: status }));
  if (blocking) return { statusText: blocking, severity: "FATAL" };
  const warning = (printer.statuses ?? []).find((status) => /PAPER|TONER|DOOR|USER_INTERVENTION|PAUSED/.test(status));
  if (warning) return { statusText: warning, severity: "WARN" };
  return { statusText: "OK", severity: "INFO" };
}

/** A refusal from the server, as a problem the panel can name — or null for any other failure. */
function refusalProblem(error: string): RunProblem | null {
  if (error === "not_signed_in") return { code: "signed_out" };
  if (error === "forbidden") return { code: "forbidden" };
  return null;
}

/** Why reaching the agent or reading the printers failed, as a problem the panel and the setup can name. */
export function connectionProblem(error: unknown): RunProblem {
  if (error instanceof AgentError) return { code: error.code };
  return { code: "listing_failed", detail: error instanceof Error ? error.message : String(error) };
}

function stop(runId: string, problem: RunProblem) {
  patchRun(runId, (run) => ({ ...run, stage: "settled", problem }));
  logPrint({ level: "error", ticket: state.run?.code, message: `run stopped: ${problem.code}` });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function execute(runId: string) {
  const settings = stationSettings();
  const ctx = context;
  if (!ctx) return;
  patchRun(runId, (run) => ({ ...run, stage: "starting", problem: null }));

  const refresh =
    ctx.request.ticketId && !ctx.freshLoaded
      ? loadRepairPrintFacts(ctx.request.ticketId, ctx.request.locale).catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        }))
      : null;

  try {
    await agentStatus();
  } catch (error) {
    stop(runId, connectionProblem(error));
    return;
  }

  if (refresh) {
    const loaded = await refresh;
    if (!loaded.ok) {
      stop(runId, refusalProblem(String(loaded.error)) ?? { code: "facts_failed", detail: String(loaded.error) });
      return;
    }
    ctx.facts = loaded.facts;
    ctx.freshLoaded = true;
    patchRun(runId, (run) => ({ ...run, fresh: true }));
  }

  let list: PrinterInfo[];
  try {
    list = await listPrinters();
  } catch (error) {
    stop(runId, connectionProblem(error));
    return;
  }

  const run = state.run;
  if (!run || run.id !== runId) return;
  const todo = run.jobs.filter((job) => job.phase === "waiting");
  const assigned = resolvePrinters(list, settings);
  const roles = [...new Set(todo.map((job) => job.role))];
  // Only when NOTHING can be printed is the person asked first; a single
  // missing printer is skipped below and the rest go out.
  if (roles.every((role) => !assigned[role])) {
    stop(runId, { code: "setup_needed" });
    setState({ setup: "confirm" });
    return;
  }

  const byName = new Map(list.map((printer) => [printer.name.toLowerCase(), printer]));
  const states: Record<string, PrinterState> = {};
  for (const printer of list) states[printer.name] = printerState(printer);
  patchRun(runId, (current) => ({ ...current, printerStatus: states }));

  const skip = (jobId: string, reason: JobReason, detail: string | null, printer: string | null) => {
    patchJob(runId, jobId, (current) => ({ ...current, printer, phase: "skipped", reason, detail }));
    logPrint({ level: "warn", ticket: run.code, printer: printer ?? undefined, message: `${jobId}: skipped, ${reason}${detail ? ` (${detail})` : ""}` });
  };

  const sendable: StationJob[] = [];
  for (const job of todo) {
    const name = assigned[job.role];
    const printer = name ? byName.get(name.toLowerCase()) : undefined;
    if (!name) skip(job.id, "no_printer", null, null);
    else if (!printer) skip(job.id, "printer_missing", name, name);
    else if (printer.connected === false) skip(job.id, "not_connected", null, printer.name);
    else if (settings.checkStatus && states[printer.name]?.severity === "FATAL") {
      skip(job.id, "printer_status", states[printer.name].statusText, printer.name);
    } else {
      patchJob(runId, job.id, (current) => ({ ...current, printer: printer.name }));
      sendable.push({ ...job, printer: printer.name });
    }
  }

  if (!sendable.length) {
    patchRun(runId, (current) => ({ ...current, stage: "settled" }));
    logPrint({ level: "warn", ticket: run.code, message: "run settled: nothing could be sent" });
    return;
  }

  patchRun(runId, (current) => ({ ...current, stage: "printing" }));
  for (const job of sendable) patchJob(runId, job.id, (current) => ({ ...current, phase: "preparing" }));
  const payloads = await renderPapers([...new Set(sendable.map((job) => job.paper))], ctx.facts, ctx.request.printedAt, settings);

  const failedPrinters = new Set<string>();
  let connectionLost = false;
  for (const planned of sendable) {
    if (state.run?.id !== runId) return;
    const job = state.run.jobs.find((candidate) => candidate.id === planned.id)!;
    const printer = job.printer!;
    const fail = (phase: JobPhase, reason: JobReason, detail: string | null = null) => {
      patchJob(runId, job.id, (current) => ({ ...current, phase, reason, detail }));
      logPrint({ level: "error", ticket: run.code, printer, message: `${job.id}: ${reason}${detail ? ` (${detail})` : ""}` });
    };
    const payload = payloads.get(job.paper);

    if (connectionLost) fail("skipped", "connection_lost");
    else if (failedPrinters.has(printer)) fail("skipped", "skipped_after_failure");
    else if (!payload || payload instanceof Error) {
      fail("failed", "render_failed", payload instanceof Error ? payload.message : null);
    } else {
      patchJob(runId, job.id, (current) => ({ ...current, phase: "sending" }));
      logPrint({ level: "info", ticket: run.code, printer, message: `${job.id}: sending` });
      try {
        const { jobId } = await sendJob(printer, job.jobName, job.token, payload);
        patchJob(runId, job.id, (current) =>
          current.phase === "sending" ? { ...current, phase: "queued", spoolJobId: jobId ?? current.spoolJobId } : current,
        );
        logPrint({ level: "info", ticket: run.code, printer, message: `${job.id}: accepted by the Windows queue${jobId ? ` as job ${jobId}` : ""}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (lostContact(error)) {
          fail("uncertain", "connection_lost", message);
          connectionLost = true;
        } else if (message === "printer_missing") {
          fail("failed", "printer_missing", printer);
          failedPrinters.add(printer);
        } else {
          fail("failed", "rejected", message);
          failedPrinters.add(printer);
        }
      }
    }
  }

  await confirm(runId, settings.confirmSeconds * 1000);
}

/** Statuses that move a job forward, in the order a job passes through them. */
const PROGRESS = ["SPOOLING", "PRINTING", "PRINTED", "COMPLETE"];

/** The queue's word on one job, turned into phase changes. */
function applyJobState(runId: string, jobId: string, report: JobState, applied: Set<string>, lastCurrent: Map<string, string>) {
  const run = state.run;
  const job = run?.jobs.find((candidate) => candidate.id === jobId);
  if (!run || run.id !== runId || !job) return;

  const events: string[] = [];
  for (const status of PROGRESS) {
    if (report.seen.includes(status) && !applied.has(`${jobId}:${status}`)) {
      applied.add(`${jobId}:${status}`);
      events.push(status);
    }
  }
  // Progress first, problems last: a job PRINTING and PAPEROUT at once is a
  // job waiting on paper, and the last transition applied is the one that shows.
  const rank = (status: string) => (PROGRESS.includes(status) ? PROGRESS.indexOf(status) : PROGRESS.length);
  const current = [...report.current].sort((a, b) => rank(a) - rank(b));
  const key = current.join(",");
  if (key !== (lastCurrent.get(jobId) ?? "")) {
    lastCurrent.set(jobId, key);
    // A problem is announced each time it appears; progress already counted above.
    for (const status of current) if (!PROGRESS.includes(status) || !events.includes(status)) events.push(status);
  }
  if (report.gone) events.push("DELETED");

  let phase = job.phase;
  for (const status of events) {
    const next = jobTransition(phase, { statusText: status });
    logPrint({
      level: next?.phase === "failed" ? "error" : next?.phase === "attention" ? "warn" : "info",
      ticket: run.code,
      printer: job.printer ?? undefined,
      message: `${job.id}: queue ${status}${next ? ` → ${next.phase}` : ""}`,
    });
    if (!next) continue;
    phase = next.phase;
    patchJob(runId, job.id, (currentJob) => ({
      ...currentJob,
      phase: next.phase,
      confirmation: next.confirmation ?? currentJob.confirmation,
      spoolJobId: report.jobId || currentJob.spoolJobId,
      // A queue problem names itself; moving on from one clears it.
      reason: next.reason ? "spooler" : null,
      detail: next.reason ?? null,
    }));
  }
  if (report.jobId && !job.spoolJobId) {
    patchJob(runId, job.id, (currentJob) => ({ ...currentJob, spoolJobId: report.jobId }));
  }
}

/** Follows every sent job through the Windows queue, or until the wait runs out. */
async function confirm(runId: string, ms: number) {
  patchRun(runId, (run) => ({ ...run, stage: "confirming" }));
  const deadline = Date.now() + ms;
  const applied = new Set<string>();
  const lastCurrent = new Map<string, string>();
  const following = () =>
    state.run?.id === runId
      ? state.run.jobs.filter((job) => job.phase === "queued" || job.phase === "printing" || job.phase === "attention")
      : [];

  while (Date.now() < deadline) {
    const jobs = following();
    // A job waiting on paper is still followed — it prints the moment the roll
    // is changed — but it alone does not hold the panel open.
    if (!jobs.some((job) => job.phase !== "attention")) break;
    for (const job of jobs) {
      try {
        applyJobState(runId, job.id, await jobState(job.token), applied, lastCurrent);
      } catch (error) {
        logPrint({ level: "warn", ticket: state.run?.code, message: `${job.id}: no word from the queue (${error instanceof Error ? error.message : String(error)})` });
      }
    }
    await sleep(500);
  }

  patchRun(runId, (run) => ({
    ...run,
    stage: "settled",
    jobs: run.jobs.map((job) =>
      job.phase === "queued" || job.phase === "printing" ? { ...job, phase: "unconfirmed" } : job,
    ),
  }));
  const run = state.run;
  if (run?.id === runId) {
    const summary = summarise(run.jobs.map((job) => job.phase));
    logPrint({
      level: summary.outcome === "problems" ? "warn" : "info",
      ticket: run.code,
      message: `run settled: ${summary.outcome} (done ${summary.done}/${summary.total}, not sent or failed ${summary.failed}, unconfirmed ${summary.unconfirmed}, attention ${summary.attention}, uncertain ${summary.uncertain})`,
    });
  }
}

/* ── Pictures of the papers, from the panel's stage ──────────────────────── */

async function renderPapers(
  papers: StationPaper[],
  facts: RepairPrintFacts,
  printedAt: number,
  settings: StationSettings,
): Promise<Map<StationPaper, PaperPayload | Error>> {
  const id = token();
  const promises = papers.map(
    (paper) =>
      new Promise<PaperPayload>((resolve, reject) => {
        pending.set(`${id}:${paper}`, { resolve, reject });
      }),
  );
  setState({ raster: { id, papers, facts, printedAt, settings } });
  const timer = setTimeout(() => {
    for (const paper of papers) {
      pending.get(`${id}:${paper}`)?.reject(new Error("drawing the paper timed out"));
      pending.delete(`${id}:${paper}`);
    }
  }, 30_000);
  const settled = await Promise.allSettled(promises);
  clearTimeout(timer);
  if (state.raster?.id === id) setState({ raster: null });
  return new Map(
    papers.map((paper, index) => {
      const result = settled[index];
      return [paper, result.status === "fulfilled" ? result.value : (result.reason as Error)];
    }),
  );
}

/** Called by the panel's stage with each drawn paper, or why it could not be drawn. */
export function deliverPaper(rasterId: string, paper: StationPaper, result: PaperPayload | Error) {
  const waiting = pending.get(`${rasterId}:${paper}`);
  if (!waiting) return;
  pending.delete(`${rasterId}:${paper}`);
  if (result instanceof Error) waiting.reject(result);
  else waiting.resolve(result);
}

/* ── What the panel can ask for ──────────────────────────────────────────── */

/**
 * Sends the failed and skipped jobs again. A job that may already be in the
 * queue (`uncertain`) is only included when the person has said so — that
 * confirmation is the whole reason the state exists.
 */
export function retryJobs({ includeUncertain = false }: { includeUncertain?: boolean } = {}) {
  const run = state.run;
  if (!run || run.stage !== "settled" || !context) return;
  const again = (job: StationJob) =>
    job.phase === "failed" || job.phase === "skipped" || (includeUncertain && job.phase === "uncertain");
  if (!run.jobs.some(again) && !run.problem) return;
  // A run stopped before sending anything retries every job it holds.
  const everything = !!run.problem && run.jobs.every((job) => job.phase === "waiting");
  setState({
    run: {
      ...run,
      problem: null,
      jobs: run.jobs.map((job) =>
        everything || again(job)
          ? {
              ...job,
              phase: "waiting",
              printer: null,
              reason: null,
              detail: null,
              confirmation: null,
              spoolJobId: null,
              ...newJobName(run.code, job.paper, job.copy, job.copies),
            }
          : job,
      ),
    },
  });
  logPrint({ level: "info", ticket: run.code, message: `retry${includeUncertain ? " (including uncertain)" : ""}` });
  void execute(run.id);
}

/** Removes a stuck job from the Windows queue, so it can be sent again on purpose. */
export async function cancelStuckJob(jobId: string) {
  const run = state.run;
  const job = run?.jobs.find((candidate) => candidate.id === jobId);
  if (!run || !job || !job.printer || job.spoolJobId == null) return;
  try {
    await cancelJob(job.printer, job.spoolJobId);
    patchJob(run.id, job.id, (current) => ({ ...current, phase: "failed", reason: "spooler", detail: "CANCELED" }));
    logPrint({ level: "info", ticket: run.code, printer: job.printer, message: `${job.id}: removed from the queue` });
  } catch (error) {
    patchJob(run.id, job.id, (current) => ({ ...current, reason: "cancel_failed", detail: error instanceof Error ? error.message : String(error) }));
  }
}

/** Prints what is left through the browser's own dialog instead. */
export function printWithBrowserDialog() {
  const run = state.run;
  if (!run || !context) return;
  setState({
    run: { ...run, stage: "dialog" },
    dialog: { key: token(), facts: context.facts, printedAt: context.request.printedAt, papers: dialogPapers(run) },
  });
  logPrint({ level: "info", ticket: run.code, message: "handed to the browser dialog" });
}

/** The papers the browser dialog should print — everything not already done. */
export function dialogPapers(run: StationRun): PaperRequest[] {
  const left = run.jobs.filter((job) => job.phase !== "done" && job.phase !== "queued" && job.phase !== "printing" && job.phase !== "unconfirmed");
  const papers = [...new Set(left.map((job) => job.paper))];
  return papers.map((paper) => ({ paper, copies: left.filter((job) => job.paper === paper).length }));
}

export function dismissRun() {
  const run = state.run;
  if (!run || (run.stage !== "settled" && run.stage !== "dialog")) return;
  setState({ run: null, dialog: null, setup: state.setup === "confirm" ? false : state.setup });
  context = null;
}

export function openPrinterSetup() {
  setState({ setup: "open" });
}

export function closePrinterSetup() {
  setState({ setup: false });
}

/** After the setup saved a mapping, carries on with the run that needed it. */
export function resumeAfterSetup() {
  const run = state.run;
  setState({ setup: false });
  if (run?.problem?.code === "setup_needed") retryJobs();
}

