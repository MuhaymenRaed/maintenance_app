import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import type { AgentAnswer, AgentCall, AgentInfo } from "../shared/contract";
import { paths } from "./config";
import { getSettings } from "./settings";
import { logger } from "./log";

const log = logger("print");

/**
 * The print agent, reached from the main process.
 *
 * The dashboard prints without a dialog through `tools/print-agent/` — a small
 * PowerShell program on the counter PC that reads Windows' printers, sends the
 * label as raw TSPL and the receipts as pictures, and follows each job through
 * the queue. This app uses the very same agent and the very same print
 * station, so a ticket printed here and one printed from the dashboard are the
 * same papers from the same code.
 *
 * Two differences, both in the app's favour:
 *
 * - **The window never talks to the agent.** The renderer's `agent-client`
 *   hands each request to the main process, which calls the agent with no
 *   `Origin` header — the agent's rule for "a program on this PC", which it
 *   trusts. So there is no browser permission prompt and no origin list to
 *   edit.
 * - **If no agent is running, the app starts the copy it ships with**
 *   (`resources/print-agent`), hidden, and waits for it to answer. The counter
 *   PC's own copy from the Startup folder is used when it is already running;
 *   the two never fight over the port because the second finds it taken and
 *   exits.
 */

const HOST = "127.0.0.1";
const PORT = 17777;
const HEADER = "X-Al-Esnad-Print";

let managed = false;
let lastStart = 0;

function request(call: AgentCall): Promise<AgentAnswer> {
  return new Promise((resolve) => {
    const body = call.method === "POST" ? JSON.stringify(call.body ?? {}) : undefined;
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: call.path,
        method: call.method ?? "GET",
        headers: {
          [HEADER]: "1",
          ...(body !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
        },
        timeout: call.timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
          resolve({ reached: true, status: response.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ reached: false, code: "timeout", message: `The print agent did not answer ${call.path} in time` });
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      resolve({ reached: false, code: "not_running", message: error.code ?? error.message });
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function agentScript() {
  return path.join(paths.printAgent, "print-agent.ps1");
}

/** Starts the shipped agent, hidden, and waits until it answers — up to 15 seconds. */
async function startBundled(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const script = agentScript();
  if (!fs.existsSync(script)) {
    log.warn(`no bundled agent at ${script}`);
    return false;
  }
  lastStart = Date.now();
  log.info("starting the bundled print agent");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  for (let waited = 0; waited < 15_000; waited += 500) {
    await sleep(500);
    const answer = await request({ path: "/v1/status", timeoutMs: 800 });
    if (answer.reached) {
      managed = true;
      log.info("bundled print agent is answering");
      return true;
    }
  }
  log.warn("the bundled print agent did not answer");
  return false;
}

/** One call to the agent, starting the shipped copy first if nothing is listening. */
export async function callAgent(call: AgentCall): Promise<AgentAnswer> {
  const first = await request(call);
  if (first.reached || first.code !== "not_running") return first;
  if (!getSettings().agentAutoStart || Date.now() - lastStart < 20_000) return first;
  if (!(await startBundled())) return first;
  return request(call);
}

export async function agentInfo(): Promise<AgentInfo> {
  const answer = await request({ path: "/v1/status", timeoutMs: 1500 });
  const body = answer.reached ? (answer.body as { version?: number; machine?: string } | null) : null;
  return {
    running: answer.reached && answer.status === 200,
    managed,
    bundled: fs.existsSync(agentScript()),
    version: body?.version ?? null,
    machine: body?.machine ?? null,
    logPath: path.join(process.env.LOCALAPPDATA ?? "", "AlEsnadPrint", "agent.log"),
  };
}

/** Stops whichever agent is running and starts the shipped one — after a printer was plugged in or renamed. */
export async function restartAgent(): Promise<AgentInfo> {
  await request({ path: "/v1/quit", method: "POST", body: {}, timeoutMs: 2000 });
  for (let i = 0; i < 10; i += 1) {
    await sleep(300);
    const answer = await request({ path: "/v1/status", timeoutMs: 500 });
    if (!answer.reached) break;
  }
  lastStart = 0;
  await startBundled();
  return agentInfo();
}

/** On a fresh start, so the first press of «طباعة» does not wait for PowerShell to compile the agent. */
export function warmAgent() {
  if (!getSettings().agentAutoStart) return;
  void request({ path: "/v1/status", timeoutMs: 1000 }).then((answer) => {
    if (!answer.reached) void startBundled();
  });
}
