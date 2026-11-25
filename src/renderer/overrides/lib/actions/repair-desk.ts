import { filterTickets } from "@/lib/data/desk-board";
import type {
  CreateTicketResult,
  DeskResult,
  DeskTicketInput,
  FaultEditInput,
  FaultsInput,
  FaultsResult,
  FinancePatch,
  RepairDetailsPatch,
} from "../../../../shared/contract";
import type { DeskRow } from "../../../../shared/desk-types";
import type { RepairService } from "@/lib/data/repair-desk";

/**
 * `lib/actions/repair-desk.ts` — handing a ticket over, its money, its details,
 * a website request, and opening one at the counter.
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
export type { DeskResult, DeskTicketInput, FaultEditInput, RepairDetailsPatch };

export function assignRepair(ticketId: string, holderId: string | null): Promise<DeskResult> {
  return window.desk.assignRepair(ticketId, holderId);
}

export function updateRepairFinance(ticketId: string, patch: FinancePatch): Promise<DeskResult> {
  return window.desk.updateRepairFinance(ticketId, patch);
}

/** A website request, accepted or refused — see `decideRepairRequest` in `src/main/desk/actions.ts`. */
export function decideRepairRequest(ticketId: string, accept: boolean): Promise<DeskResult> {
  return window.desk.decideRepairRequest(ticketId, accept);
}

/** «تم التسليم للزبون» — see `setRepairHandedOver` in `src/main/desk/actions.ts`. */
export function setRepairHandedOver(ticketId: string, handed: boolean): Promise<DeskResult> {
  return window.desk.setRepairHandedOver(ticketId, handed);
}

/** The device and the customer, corrected — see `updateRepairDetails` in `src/main/desk/actions.ts`. */
export function updateRepairDetails(ticketId: string, patch: RepairDetailsPatch): Promise<DeskResult> {
  return window.desk.updateRepairDetails(ticketId, patch);
}

export function createDeskTicket(input: DeskTicketInput): Promise<CreateTicketResult> {
  return window.desk.createDeskTicket(input);
}

/** A fault on the bench's list, renamed or taken off — see `editRepairIssue` in `src/main/desk/actions.ts`. */
export function editRepairIssue(input: FaultEditInput): Promise<DeskResult> {
  return window.desk.editRepairIssue(input);
}

/** A fault added to the bench's list from الإعدادات — see `addRepairIssue` in `src/main/desk/actions.ts`. */
export function addRepairIssue(service: RepairService, name: string): Promise<DeskResult> {
  return window.desk.addRepairIssue(service, name);
}

/** Who a new ticket goes to — see `setDeskDefaultHolder` in `src/main/desk/actions.ts`. */
export function setDeskDefaultHolder(service: RepairService, holderId: string | null): Promise<DeskResult> {
  return window.desk.setDeskDefaultHolder(service, holderId);
}

/** A ticket's faults after it was opened — see `updateRepairFaults` in `src/main/desk/actions.ts`. */
export function updateRepairFaults(ticketId: string, input: FaultsInput): Promise<FaultsResult> {
  return window.desk.updateRepairFaults(ticketId, input);
}

/**
 * `searchDeskTickets` — جرد الأرباح's hand-picked report finds tickets from
 * any day. Here every ticket is on this computer, so it is the bench read for
 * all time and narrowed by the site's own search (`filterTickets`), newest
 * first, forty at most, for a reader who sees the money — the site's rules.
 */
export async function searchDeskTickets(
  _service: string,
  query: string,
  locale: string,
): Promise<{ ok: true; rows: DeskRow[] } | { ok: false; error: string }> {
  void _service;
  const search = query.trim();
  if (search.length < 2) return { ok: true, rows: [] };
  const page = await window.desk.page({ locale: locale === "en" ? "en" : "ar", when: "all" });
  if (!page.ready || !page.authority.seesMoney || page.isTech) return { ok: false, error: "forbidden" };
  const rows = filterTickets(
    page.desk.rows,
    { terms: null, holder: null, handed: null, edited: false, mine: false, search },
    page.viewer.id,
  );
  return { ok: true, rows: rows.slice(0, 40) };
}
