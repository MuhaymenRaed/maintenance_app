import type { RepairPrintFacts } from "@/lib/data/repair-print-facts";

type Refusal = { ok: false; error: "not_signed_in" | "forbidden" | "bad_request" | "not_found" };

/**
 * `lib/actions/print-station.ts` — the ticket as it stands, shaped for paper.
 *
 * Read the moment «طباعة» is pressed, so both receipt copies and the label
 * carry one moment's facts. On the site that is a fresh server read; here the
 * main process answers from this computer's own copy of the ticket, after
 * trying briefly for a fresher one — so the papers are right offline, and
 * right about a change a colleague made a minute ago when the line is up.
 *
 * ⚠️ The refusals are the site's, and `forbidden` means the same thing: the
 * desk account may not run this bench. A paper printed for a ticket this
 * account cannot handle is a paper the shop cannot stand behind.
 */
export function loadRepairPrintFacts(
  ticketId: string,
  locale: string,
): Promise<{ ok: true; facts: RepairPrintFacts } | Refusal> {
  return window.desk.loadRepairPrintFacts(ticketId, locale);
}
