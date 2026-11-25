import { TECH_STATUSES, type PaymentTerms } from "./repair-desk.ts";

/**
 * The five stages a manager reads a ticket by — the shop, 2026-11-24.
 *
 * One `status` column still holds everything (the tracker, the customer's
 * notifications, the history and the desktop app's offline queue all read
 * it), and the manager's interface shows it folded into five:
 *
 * | stage | statuses | |
 * |---|---|---|
 * | طلب من الموقع | `requested` | a website booking nobody has accepted yet |
 * | تم قبول الطلب | `approved` + the technician's steps | on the bench |
 * | بانتظار الزبون | `ready` | **آجل only**: the work is done, money is owed |
 * | مكتمل | `completed` | paid in full — the only stage that counts |
 * | ملغي | `cancelled`, `declined` | |
 *
 * The technician's steps (`TECH_STATUSES`) are his and the online
 * customer's: the tracker shows them, the technician moves them, and a
 * manager reads the current one as a tag on «تم قبول الطلب».
 *
 * ⚠️ Pure and relative-imported: node's test runner and the desktop app's
 * main process both read it.
 */
export type RepairStage = "request" | "accepted" | "waiting" | "completed" | "cancelled";

export const STAGES: readonly RepairStage[] = ["request", "accepted", "waiting", "completed", "cancelled"];

export type TechStep = (typeof TECH_STATUSES)[number];

export function stageOf(status: string): RepairStage {
  switch (status) {
    case "requested":
      return "request";
    case "ready":
      return "waiting";
    case "completed":
      return "completed";
    case "cancelled":
    case "declined":
      return "cancelled";
    default:
      // `approved`, the technician's steps, and the retired `quote_sent`.
      return "accepted";
  }
}

/** The technician's current step on an accepted ticket — a tag for a manager. */
export function techStepOf(status: string): TechStep | null {
  return (TECH_STATUSES as readonly string[]).includes(status) ? (status as TechStep) : null;
}

/**
 * Where «مكتمل» actually lands (the shop, 2026-11-24: "always بانتظار الزبون").
 * An آجل ticket that still owes waits for its customer; it becomes «مكتمل»
 * only when the rest is paid — see `settledStatus`.
 */
export function completionStatus(terms: PaymentTerms, remaining: number): "completed" | "ready" {
  return terms === "deferred" && remaining > 0 ? "ready" : "completed";
}

/**
 * After the money moved: a waiting ticket paid in full — or switched to نقد,
 * which is paid at the counter — is complete. Anything else stays where it
 * is: a ticket paid in full while it is still on the bench is not finished.
 */
export function settledStatus(row: { status: string; terms: PaymentTerms; remaining: number }): "completed" | null {
  if (row.status !== "ready") return null;
  return row.terms === "cash" || row.remaining <= 0 ? "completed" : null;
}
