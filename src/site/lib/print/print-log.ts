/**
 * What the print station did, kept in this browser for whoever has to work
 * out why a label did not come out.
 *
 * The counter's machine is the only place the answer exists: the server sees
 * a signature request and nothing else, and the spooler forgets a job the
 * moment it leaves the queue. So every step — connected, which queue, what was
 * sent, what Windows said back — is written here and to the console, and the
 * printer setup shows the last entries with a button to copy them.
 *
 * ⚠️ Never a customer's name, phone or money: a ticket code and a paper are
 * enough to find the job, and this log is pasted into chats.
 */

export type PrintLogEntry = {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
  /** The ticket code, when the entry belongs to a run. */
  ticket?: string;
  printer?: string;
};

const KEY = "al-esnad:print-log";
const LIMIT = 120;

let memory: PrintLogEntry[] | null = null;
const listeners = new Set<() => void>();

function read(): PrintLogEntry[] {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    memory = Array.isArray(parsed) ? (parsed as PrintLogEntry[]).slice(-LIMIT) : [];
  } catch {
    memory = [];
  }
  return memory;
}

export function logPrint(entry: Omit<PrintLogEntry, "at">) {
  const full = { ...entry, at: Date.now() };
  const line = `[print]${full.ticket ? ` ${full.ticket}` : ""}${full.printer ? ` → ${full.printer}` : ""}: ${full.message}`;
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.info(line);

  memory = [...read(), full].slice(-LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Storage full or blocked; the console still has it.
  }
  for (const listener of listeners) listener();
}

export function clearPrintLog() {
  memory = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
  for (const listener of listeners) listener();
}

const EMPTY: PrintLogEntry[] = [];

export const printLog = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: () => (typeof window === "undefined" ? EMPTY : read()),
  server: () => EMPTY,
};

/** The log as plain text, for pasting into a message. */
export function printLogText(entries: readonly PrintLogEntry[]): string {
  return entries
    .map((entry) => {
      const when = new Date(entry.at).toISOString().replace("T", " ").slice(0, 19);
      const where = [entry.ticket, entry.printer].filter(Boolean).join(" → ");
      return `${when} ${entry.level.toUpperCase()}${where ? ` ${where}` : ""}: ${entry.message}`;
    })
    .join("\n");
}
