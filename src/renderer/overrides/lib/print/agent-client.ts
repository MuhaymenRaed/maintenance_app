import { logPrint } from "@/lib/print/print-log";
import type { PrinterInfo } from "@/lib/print/printer-match";

/**
 * The print agent, reached through the main process instead of `fetch`.
 *
 * ---------------------------------------------------------------------------
 * Why not the site's own client
 * ---------------------------------------------------------------------------
 * The site's `lib/print/agent-client.ts` calls `http://127.0.0.1:17777` from
 * the page, which works in Chrome only because a loopback address is a
 * "potentially trustworthy" origin and Chrome asks once whether the site may
 * reach apps on this device. Neither half holds in this window: the page is
 * served from `app://desk`, which is not on the agent's origin list, and an
 * Electron window has no permission prompt to ask.
 *
 * The main process makes the request instead (`src/main/print-agent.ts`). A
 * request from a program on the PC carries no `Origin`, which is exactly the
 * case the agent already treats as trusted — anything that can run on this
 * computer could print without the agent anyway. It also lets the app *start*
 * the agent it ships with when none is running, which a page never could.
 *
 * ⚠️ The exported surface is the site's, name for name and type for type:
 * `lib/print/station.ts` and the printer setup are copied unchanged and
 * import every one of these. `AgentError` versus `AgentRefusal` is the
 * distinction they branch on — "the agent did not answer" against "the agent
 * answered no" — so the main process's answer is unpacked back into the same
 * two classes.
 */

export const AGENT_ORIGIN = "http://127.0.0.1:17777";

export type AgentFailure = "not_running" | "blocked" | "timeout" | "unsupported";

/** The agent could not be reached at all. */
export class AgentError extends Error {
  readonly code: AgentFailure;
  constructor(code: AgentFailure, message: string) {
    super(message);
    this.name = "AgentError";
    this.code = code;
  }
}

/** The agent answered, and said no — `printer_missing`, `bad_request`, a spooler refusal. */
export class AgentRefusal extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.name = "AgentRefusal";
    this.status = status;
  }
}

async function call<T>(
  path: string,
  { method = "GET", body, timeoutMs }: { method?: "GET" | "POST"; body?: unknown; timeoutMs: number },
): Promise<T> {
  const answer = await window.desk.agent({ path, method, body, timeoutMs });
  if (!answer.reached) throw new AgentError(answer.code, answer.message);
  const payload = answer.body as ({ ok?: boolean; error?: string } & T) | null;
  if (answer.status < 200 || answer.status >= 300 || !payload?.ok) {
    throw new AgentRefusal(answer.status, payload?.error ?? `http_${answer.status}`);
  }
  return payload;
}

/** Who is answering — proof the agent is running on this PC. */
export async function agentStatus(timeoutMs = 3000) {
  const status = await call<{ version: number; machine: string }>("/v1/status", { timeoutMs });
  return { version: status.version, machine: status.machine };
}

type AgentPrinter = {
  name: string;
  driver: string | null;
  connection: string | null;
  default: boolean;
  statuses: string[];
  connected: boolean | null;
  sizes: { name?: string; mm?: { width: number; height: number } }[];
};

/** Every printer Windows has installed, with its state, read from the spooler. */
export async function listPrinters({ fresh = false } = {}): Promise<PrinterInfo[]> {
  const { printers } = await call<{ printers: AgentPrinter[] }>(`/v1/printers${fresh ? "?fresh=1" : ""}`, {
    timeoutMs: 10_000,
  });
  const list = printers.map((printer) => ({
    name: printer.name,
    driver: printer.driver,
    connection: printer.connection,
    default: printer.default,
    statuses: printer.statuses ?? [],
    connected: printer.connected,
    sizes: printer.sizes ?? [],
  }));
  logPrint({
    level: "info",
    message: `printers: ${list.map((printer) => `${printer.name}${printer.connected === false ? " (unplugged)" : ""}`).join(" | ") || "none"}`,
  });
  return list;
}

export type AgentPayload =
  | { kind: "raw"; data: string }
  | {
      kind: "image";
      data: string;
      widthMm: number;
      heightMm: number;
      landscape: boolean;
      fit: "page" | "actual";
      mono: boolean;
    };

/**
 * Hands one paper to one printer. Resolves once the Windows queue holds it —
 * the agent's word that it was accepted, never that it printed.
 */
export async function sendJob(printer: string, jobName: string, token: string, payload: AgentPayload) {
  const { jobId } = await call<{ jobId: number }>("/v1/print", {
    method: "POST",
    body: { printer, jobName, token, ...payload },
    timeoutMs: 60_000,
  });
  return { jobId: jobId || null };
}

export type JobState = {
  jobId: number;
  everSeen: boolean;
  gone: boolean;
  timedOut: boolean;
  /** Every status the queue has shown for the job, in the order first seen. */
  seen: string[];
  /** What it shows now. */
  current: string[];
};

/** What the Windows queue has said about a job the agent sent. */
export function jobState(token: string) {
  return call<JobState>(`/v1/job?token=${encodeURIComponent(token)}`, { timeoutMs: 4000 });
}

/** Removes one job from a printer's queue — for a job stuck on paper out. */
export async function cancelJob(printer: string, jobId: number) {
  await call("/v1/cancel", { method: "POST", body: { printer, jobId }, timeoutMs: 8000 });
}

/** `true` when the agent stopped answering, as opposed to answering no. */
export function lostContact(error: unknown): boolean {
  return error instanceof AgentError;
}

/* ── Starting it, when it is not running ─────────────────────────────────── */

/**
 * The site's half of this hands Windows an `alesnad-print:` URL and hopes a
 * protocol handler is registered — the only way a *web page* can start a
 * program on the PC it is being read on. This window has no such limit: the
 * main process starts the agent the app ships with, hidden, with no browser
 * question to answer and no handler to install. `callAgent` in
 * `src/main/print-agent.ts` already does it on the first request that finds
 * nothing listening, and `warmAgent` does it when the window opens.
 *
 * ⚠️ So this is a **no-op that answers yes**, and the "yes" is not a lie: the
 * ask has been made, by `waitForAgent` below, whose first probe is the request
 * that triggers the start. The names and types are the site's, because
 * `lib/print/station.ts` and `lib/print/agent-presence.ts` are copied from it
 * unchanged and import all three.
 */
export function wakeAgent(_options: { force?: boolean } = {}): boolean {
  return true;
}

/**
 * ⚠️ Longer than the site's fourteen seconds, and it has to be: the main
 * process waits up to thirty for a start that must run two PowerShell
 * processes and, the first time after an update, compile the agent's C#.
 * Measured on this PC at ten. The site can be shorter because a page only
 * ever *asks* Windows to start it and then polls; here the first poll IS the
 * start, so this budget has to cover the start itself.
 */
export const AGENT_START_MS = 32_000;

/**
 * Polls until the agent answers, or `ms` have passed.
 *
 * The first `agentStatus` is what starts the bundled agent, so this returns
 * true on its first pass in the ordinary case rather than after a wait.
 */
export async function waitForAgent(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      await agentStatus(3000);
      logPrint({ level: "info", message: "the print agent answered after being started" });
      return true;
    } catch {
      if (Date.now() >= until) return false;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
}

/**
 * Whether the agent has ever answered — the site's test for "was this PC set
 * up at all", and **always true here**.
 *
 * ⚠️ The question the site asks with this cannot arise in the desk app. There
 * a browser reaches a program somebody had to install on the counter PC, so a
 * silence may mean the installer never ran, and the site tells those two
 * apart to avoid sending a counter to press retry for ever on a machine that
 * was never prepared. This app **ships the agent inside itself**
 * (`resources/print-agent`) and starts it from the main process, so there is
 * no install to have been skipped and no protocol to have gone unregistered.
 *
 * Answering yes is what keeps the shared `station.ts` honest here: a failure
 * in this window is the agent failing to **start**, which is a real fault
 * worth reporting as itself, and dressing it up as "this computer is not set
 * up for printing" would send somebody looking for an installer that is not
 * theirs to run.
 */
export function agentEverSeen(): boolean {
  return true;
}

/**
 * The site asks this before it tries the agent at all, so a phone never asks
 * the browser for a local app (2026-11-20). This window is always the counter
 * PC's own, with the agent shipped beside it.
 */
export function canHostAgent(): boolean {
  return true;
}
