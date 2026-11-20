import type {
  CreateTicketResult,
  DeskResult,
  DeskTicketInput,
  FaultEditInput,
  FaultsInput,
  FaultsResult,
  FinancePatch,
} from "../../../../shared/contract";
import type { DeskRow } from "../../../../shared/desk-types";

/**
 * `lib/actions/repair-desk.ts` — handing a ticket over, its money, and opening
 * one at the counter.
 *
 * ⚠️ `createDeskTicket` is the one whose answer gained a field. On the site a
 * ticket is created by `book_repair` and comes back with the code the database
 * minted. Here it is written to this computer and sent afterwards, so when
 * there is no line the code is provisional (`OFF-1109-03`) and the reply
 * carries `queued: true`. The dialog says so rather than printing a label with
 * a code the shop cannot look up — see `createDeskTicket` in
 * `src/main/desk/actions.ts` for how long it waits for a real one first.
 *
 * Everything else about the shape is the site's, `financeSaved` and
 * `warrantySaved` included: the dialog draws a warning when the ticket saved
 * and one of its figures did not, and that is as true of a column this
 * deployment lacks as of a refusal at the till.
 */
export type { DeskResult, DeskTicketInput, FaultEditInput };

export function assignRepair(ticketId: string, holderId: string | null): Promise<DeskResult> {
  return window.desk.assignRepair(ticketId, holderId);
}

export function updateRepairFinance(ticketId: string, patch: FinancePatch): Promise<DeskResult> {
  return window.desk.updateRepairFinance(ticketId, patch);
}

export function createDeskTicket(input: DeskTicketInput): Promise<CreateTicketResult> {
  return window.desk.createDeskTicket(input);
}

/** A fault on the bench's list, renamed or taken off — see `editRepairIssue` in `src/main/desk/actions.ts`. */
export function editRepairIssue(input: FaultEditInput): Promise<DeskResult> {
  return window.desk.editRepairIssue(input);
}

/** A ticket's faults after it was opened — see `updateRepairFaults` in `src/main/desk/actions.ts`. */
export function updateRepairFaults(ticketId: string, input: FaultsInput): Promise<FaultsResult> {
  return window.desk.updateRepairFaults(ticketId, input);
}

/**
 * `searchDeskTickets` — the figures panel's hand-picked report finds tickets
 * from any day (2026-11-20). Here every ticket is on this computer, so it is
 * the board itself, read for all time with the words as its search.
 */
export async function searchDeskTickets(
  _service: string,
  query: string,
  locale: string,
): Promise<{ ok: true; rows: DeskRow[] } | { ok: false; error: string }> {
  void _service;
  const page = await window.desk.page({ locale: locale === "en" ? "en" : "ar", q: query, when: "all" });
  if (!page.ready) return { ok: false, error: "forbidden" };
  return { ok: true, rows: page.board.rows.slice(0, 40) };
}
