/**
 * A paper's state, from what the Windows spooler says about it — read by the
 * print agent on the counter PC (`tools/print-agent/`) from the queue itself.
 *
 * ---------------------------------------------------------------------------
 * What "printed" can and cannot mean here
 * ---------------------------------------------------------------------------
 * The agent answering a print means the job reached the Windows queue, and
 * nothing more. Past that, the only
 * witness is the spooler, and its best word for a USB printer is that the
 * data was handed to the device. Nothing in this chain can see paper leave
 * the printer, so the strongest state here is `done` with
 * `confirmation: "printed"`, and the panel words it as Windows' report rather
 * than as a fact about the paper.
 *
 * ⚠️ **A job that left the queue without being seen printing is not called
 * printed.** Windows reports DELETED both for a job that printed and for one
 * somebody cancelled, and a fast job's PRINTING notice can be coalesced away.
 * So DELETED straight after spooling is `left_queue` — "check it came out" —
 * and only DELETED after PRINTING, or COMPLETE, is `printed`.
 *
 * ⚠️ **Paper out is `attention`, never `failed`.** A job waiting on an empty
 * label roll is still in the queue and prints the moment the roll is changed.
 * Calling it failed invites a retry, and the shop gets two labels. A job only
 * fails on an error, an abort or a cancel — and a failed job stays failed,
 * whatever the spooler says about it afterwards.
 *
 * Status names are Winspool's own flags by their constant names — JOB_STATUS_*
 * for a job, PRINTER_STATUS_* for a printer — plus NOT_CONNECTED, the agent's
 * word for a USB printer whose device is not plugged in.
 */

export type JobPhase =
  /** Not started. */
  | "waiting"
  /** The paper is being drawn. */
  | "preparing"
  /** Handed to the print agent; no answer yet. */
  | "sending"
  /** Accepted by the Windows print queue. */
  | "queued"
  /** The spooler says it is printing. */
  | "printing"
  /** The spooler has finished with it — see `confirmation`. */
  | "done"
  /** Accepted, and no word from the spooler within the wait. */
  | "unconfirmed"
  /** Stuck in the queue on something a person must fix — paper, a door. */
  | "attention"
  /** Did not print; can be sent again. */
  | "failed"
  /** Contact was lost while sending: it may or may not be in the queue. */
  | "uncertain"
  /** Not sent, because its printer failed earlier in the same run. */
  | "skipped";

export type Confirmation = "printed" | "left_queue";

export type StatusEvent = { statusText: string; severity?: string | null };

export type Transition = { phase: JobPhase; confirmation?: Confirmation; reason?: string };

/** Where each phase may be reached from. Anything else is a step backwards. */
const FROM: Record<"queued" | "printing" | "done" | "attention" | "failed", readonly JobPhase[]> = {
  queued: ["sending", "uncertain"],
  printing: ["sending", "queued", "attention", "unconfirmed", "uncertain"],
  done: ["sending", "queued", "printing", "attention", "unconfirmed", "uncertain"],
  attention: ["sending", "queued", "printing", "attention", "unconfirmed", "uncertain"],
  failed: ["sending", "queued", "printing", "attention", "unconfirmed", "uncertain"],
};

const QUEUED = new Set(["SPOOLING", "SCHEDULED", "RENDERING_LOCALLY", "RESTART"]);
const FINISHED = new Set(["COMPLETE", "PRINTED", "SENT", "RETAINED"]);
const LEFT = new Set(["DELETED", "DELETING"]);
// BLOCKED_DEVQ is the driver refusing the job outright: it will not print.
const FAILED = new Set(["ERROR", "ABORTED", "CANCELED", "CANCELLED", "BLOCKED_DEVQ"]);
const STUCK = new Set(["OFFLINE", "PAPEROUT", "PAPER_OUT", "USER_INTERVENTION", "PAUSED"]);

function target(current: JobPhase, event: StatusEvent): Transition | null {
  const status = event.statusText.toUpperCase();
  if (QUEUED.has(status)) return { phase: "queued" };
  if (status === "PRINTING") return { phase: "printing" };
  if (FINISHED.has(status)) return { phase: "done", confirmation: "printed" };
  if (LEFT.has(status)) {
    return { phase: "done", confirmation: current === "printing" ? "printed" : "left_queue" };
  }
  if (FAILED.has(status)) return { phase: "failed", reason: status };
  if (STUCK.has(status)) return { phase: "attention", reason: status };
  const severity = (event.severity ?? "").toUpperCase();
  if (severity === "ERROR" || severity === "FATAL") return { phase: "failed", reason: status };
  if (severity === "WARN") return { phase: "attention", reason: status };
  return null;
}

/** The next state for a job given a spooler event, or null to leave it be. */
export function jobTransition(current: JobPhase, event: StatusEvent): Transition | null {
  const next = target(current, event);
  if (!next || next.phase === "waiting") return null;
  const allowed = FROM[next.phase as keyof typeof FROM];
  return allowed?.includes(current) ? next : null;
}

/**
 * Printer statuses that mean a job sent now would sit in the queue until a
 * person intervenes. A printer that is out of paper or paused is deliberately
 * not here: the job waits in the queue and prints the moment it is fixed,
 * which is what somebody reloading a label roll expects. Not knowing a
 * printer's state is not a reason to refuse to print either.
 */
const BLOCKING = new Set([
  "NOT_CONNECTED",
  "OFFLINE",
  "DOOR_OPEN",
  "ERROR",
  "NOT_AVAILABLE",
  "PAPER_JAM",
  "NO_TONER",
  "PAGE_PUNT",
  "OUT_OF_MEMORY",
]);

export function blocksPrinting(event: StatusEvent): boolean {
  return BLOCKING.has(event.statusText.toUpperCase());
}

/**
 * Whether a job may be sent again. `confirm` is the one case a person has to
 * answer: contact was lost while it was being sent, so it may already be in
 * the queue, and sending it again blind is how the shop gets two.
 */
export function retryable(phase: JobPhase): "yes" | "confirm" | "no" {
  if (phase === "failed" || phase === "skipped") return "yes";
  if (phase === "uncertain") return "confirm";
  return "no";
}

export type RunSummary = {
  total: number;
  done: number;
  /** Failed and skipped together: both can be sent again as they are. */
  failed: number;
  unconfirmed: number;
  attention: number;
  uncertain: number;
  /** Nothing is waiting, being drawn or being sent. */
  settled: boolean;
  outcome: "all_done" | "sent" | "problems";
};

export function summarise(phases: readonly JobPhase[]): RunSummary {
  const count = (...wanted: JobPhase[]) => phases.filter((phase) => wanted.includes(phase)).length;
  const summary = {
    total: phases.length,
    done: count("done"),
    failed: count("failed", "skipped"),
    unconfirmed: count("unconfirmed"),
    attention: count("attention"),
    uncertain: count("uncertain"),
    settled: count("waiting", "preparing", "sending") === 0,
  };
  const outcome: RunSummary["outcome"] =
    summary.failed + summary.attention + summary.uncertain > 0
      ? "problems"
      : summary.done === summary.total
        ? "all_done"
        : "sent";
  return { ...summary, outcome };
}
