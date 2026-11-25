import { emptyTotals, isOpenTicket, repairMoney, type DeskTotals, type PaymentTerms } from "./repair-desk.ts";
import { stageOf } from "./repair-stage.ts";
import { baghdadDay } from "./date-window.ts";

/**
 * ⚠️ **Superseded in part on 2026-11-24 — read this first.** The shop's rule
 * is now one sentence: **only «مكتمل» counts.** A ticket is *booked* once, on
 * the Baghdad day it became «مكتمل» (`completedAt`, kept by a trigger in
 * 20261124_maintenance_stages.sql), as it stood at the end of that day; money
 * is still dated by the day it came in (`repair_ticket_payments`), and a نقد
 * ticket's money comes in when it completes. «راجع» is called «مرتجع» on
 * screen now and is a later-day change to a *booked* ticket. The "two clocks"
 * below survive as the money clock; the "opened" clock is gone from the
 * figures — a ticket's opening day only decides which list it sits in
 * (`lib/data/desk-board.ts`).
 *
 * The repair desk's figures panel — which tickets each card counts, and on
 * which day each dinar came in. Pure and shared: the dashboard runs it over
 * the server's rows (`lib/queries/repair-desk.ts`) and the desktop app over
 * its own copy (`src/main/desk/board.ts`), so a card reads the same on both.
 *
 * ---------------------------------------------------------------------------
 * Two clocks, on purpose (the shop, 2026-11-20)
 * ---------------------------------------------------------------------------
 * - **What a ticket is** — how many, what was charged, the warranty, the
 *   parts, the profit, what is still owed — belongs to the day it was
 *   **opened**. Those cards count the tickets opened in the period.
 * - **Money** — «واصل نقد», «واصل آجل», «واصل بالخزنة» — belongs to the day it
 *   **came in**. A deferred ticket from yesterday settled today puts its
 *   money in today's figures, and today's list shows the ticket with a mark
 *   saying so. The dates come from `repair_ticket_payments`, a ledger the
 *   database keeps by itself (`20261120_repair_payments.sql`); until that
 *   file runs, a deferred ticket paid in full is dated by the last change to
 *   its money row, and everything else by the day it was opened.
 *
 * ---------------------------------------------------------------------------
 * «راجع» — a past day stays as it was (the shop, 2026-11-21)
 * ---------------------------------------------------------------------------
 * A ticket from an earlier day whose price is brought down or up, or which
 * is cancelled, is shown on the day of the change under «راجع». The day a
 * ticket was opened counts it as it was at the end of that day —
 * `bookedState` — so a report printed yesterday reads the same today.
 *
 * ⚠️ On the day of the change a «راجع» moves ONE figure: «واصل بالخزنة», by
 * the money actually handed back or taken (the shop, the same afternoon: "the
 * other statistics must show fully like there is no راجع at all"). مبلغ
 * الصيانة, the parts, the profit, the warranty, «واصل نقد» and «واصل آجل»
 * read as if nothing had changed; the «راجع» card says what did, and the till
 * carries a note. Which payment is a «راجع»'s is told by the moment: the
 * payments ledger and the «راجع» are written by triggers in one transaction,
 * so they share one `now()` (`returnMoneyWithin`).
 *
 * The changes come from `repair_ticket_returns`, which the database keeps by
 * itself (20261121_repair_returns.sql). Until that file runs there is no
 * book, and a ticket counts as it is now on the day it was opened — what the
 * desk always did. The same file makes a cancellation post its refund in the
 * payments ledger on the day it happens, which is what `refunds` turns on.
 */

export type PaymentEntry = { at: string; amount: number };

/** What the figures read of a ticket at one moment. */
export type TicketState = {
  status: string;
  /** The total the customer is charged, the warranty inside it. */
  price: number | null;
  warranty: number | null;
  cost: number | null;
};

/** One change to a ticket's money, made on a later day than it was opened. */
export type ReturnEntry = { at: string; before: TicketState; after: TicketState };

/**
 * Every «راجع» from the start of the period on, by ticket id, oldest first.
 * `null` where the ledger is not on this deployment.
 */
export type ReturnBook = Record<string, readonly ReturnEntry[]> | null;

const isOff = (status: string) => status === "cancelled" || status === "declined";

/**
 * What a state counts for: its money while it is «مكتمل», nothing otherwise
 * (2026-11-24). So a booked ticket cancelled, reopened or completed again on a
 * later day is a «مرتجع» of exactly what it stopped (or started) counting —
 * the same test the database's `repair_record_return_v2` makes.
 */
export function stateValue(state: TicketState): { price: number; warranty: number; base: number; cost: number } {
  if (state.status !== "completed") return { price: 0, warranty: 0, base: 0, cost: 0 };
  const money = repairMoney({ price: state.price, warranty: state.warranty, cost: state.cost, collected: null, terms: "deferred", completed: true });
  return { price: money.price, warranty: money.warranty, base: money.base, cost: money.cost ?? 0 };
}

/** Whether two states count for the same — the database's own test. */
export function sameValue(a: TicketState, b: TicketState): boolean {
  const x = stateValue(a);
  const y = stateValue(b);
  return x.price === y.price && x.warranty === y.warranty && x.cost === y.cost;
}

/**
 * The ticket as its own day counted it: its state before the first «راجع».
 * Null when it has none — the ticket as it is now.
 */
export function bookedState(id: string, returns: ReturnBook): TicketState | null {
  const first = returns?.[id]?.[0];
  return first ? first.before : null;
}

/**
 * The ticket's state at a moment: the first «راجع» from then on says what it
 * was before it; none, and it is as it is now. Needs only the book from that
 * moment on, which is what the site reads.
 */
export function stateAt(row: FigureRow, returns: ReturnBook, at: string | null): TicketState {
  const now = { status: row.status, price: row.price, warranty: row.warrantyPrice, cost: row.costPrice };
  if (at === null || !returns) return now;
  const next = (returns[row.id] ?? []).find((entry) => entry.at >= at);
  return next ? next.before : now;
}

/**
 * The warranty at the start of the period and at its end — what the money
 * that came in within it is split by, the warranty's part taken first. A
 * warranty added today was not in yesterday's takings.
 */
export function warrantySpan(row: FigureRow, returns: ReturnBook, bounds: Bounds): { start: number; end: number } {
  return {
    start: stateValue(stateAt(row, returns, bounds.since)).warranty,
    end: stateValue(stateAt(row, returns, bounds.until)).warranty,
  };
}

/** The ticket as it is now, in the figures' own shape. */
export function currentState(row: FigureRow): TicketState {
  return { status: row.status, price: row.price, warranty: row.warrantyPrice, cost: row.costPrice };
}

/**
 * The ticket's booking, when it falls in the period: the state it ended its
 * completion day in, if that state is «مكتمل». A ticket completed and taken
 * back off the same day has no completion day at all (the trigger clears it).
 */
export function bookedWithin(row: FigureRow, returns: ReturnBook, bounds: Bounds): TicketState | null {
  if (!row.completedAt || !withinBounds(row.completedAt, bounds)) return null;
  const state = bookedState(row.id, returns) ?? currentState(row);
  return state.status === "completed" ? state : null;
}

/** `bookedState` in the shape the filters take. */
export function bookedFields(
  row: FigureRow,
  returns: ReturnBook,
): { status: string; price: number | null; warrantyPrice: number | null; costPrice: number | null } | null {
  const state = bookedState(row.id, returns);
  // The purchase price is never a «راجع»: typed the day after the part
  // arrives, it still belongs to the ticket's own profit.
  return state ? { status: state.status, price: state.price, warrantyPrice: state.warranty, costPrice: row.costPrice } : null;
}

/** A ticket's «راجع» within the period, added up. */
export type ReturnSummary = {
  /** The change in what the customer is charged — the repair and its warranty. */
  price: number;
  warranty: number;
  /** The repair alone. */
  base: number;
  cost: number;
  /** The repair's change less the part's. */
  profit: number;
  /** Its state before the first change in the period, and after the last. */
  before: TicketState;
  after: TicketState;
  /** Called off within the period, or brought back. */
  cancelled: boolean;
  restored: boolean;
  /** Taken back off «مكتمل» to the bench, or completed again. */
  reopened: boolean;
  recompleted: boolean;
  /** When the last change was made. */
  at: string;
  changes: number;
};

export function returnSummary(id: string, returns: ReturnBook, bounds: Bounds): ReturnSummary | null {
  const entries = (returns?.[id] ?? []).filter((entry) => withinBounds(entry.at, bounds));
  if (!entries.length) return null;
  let price = 0;
  let warranty = 0;
  let base = 0;
  let cost = 0;
  for (const entry of entries) {
    const from = stateValue(entry.before);
    const to = stateValue(entry.after);
    price += to.price - from.price;
    warranty += to.warranty - from.warranty;
    base += to.base - from.base;
    cost += to.cost - from.cost;
  }
  const first = entries[0];
  const last = entries[entries.length - 1];
  return {
    price,
    warranty,
    base,
    cost,
    profit: base - cost,
    before: first.before,
    after: last.after,
    cancelled: !isOff(first.before.status) && isOff(last.after.status),
    restored: isOff(first.before.status) && !isOff(last.after.status),
    reopened:
      first.before.status === "completed" && last.after.status !== "completed" && !isOff(last.after.status),
    recompleted:
      first.before.status !== "completed" && !isOff(first.before.status) && last.after.status === "completed",
    at: last.at,
    changes: entries.length,
  };
}

/**
 * What a «راجع» was, for a reader: called off (after delivery or not),
 * brought back, or which of the three figures moved and from what to what.
 */
export type ReturnDescription = {
  kind: "cancelDelivered" | "cancel" | "restore" | "reopen" | "recomplete" | "edit";
  changes: { field: "price" | "warranty" | "cost"; from: number; to: number }[];
};

export function describeReturn(summary: ReturnSummary): ReturnDescription {
  if (summary.cancelled) {
    return { kind: summary.before.status === "completed" ? "cancelDelivered" : "cancel", changes: [] };
  }
  if (summary.restored) return { kind: "restore", changes: [] };
  if (summary.reopened) return { kind: "reopen", changes: [] };
  if (summary.recompleted) return { kind: "recomplete", changes: [] };
  const from = stateValue(summary.before);
  const to = stateValue(summary.after);
  const changes: ReturnDescription["changes"] = [];
  if (from.price !== to.price) changes.push({ field: "price", from: from.price, to: to.price });
  if (from.warranty !== to.warranty) changes.push({ field: "warranty", from: from.warranty, to: to.warranty });
  if (from.cost !== to.cost) changes.push({ field: "cost", from: from.cost, to: to.cost });
  return { kind: "edit", changes };
}

/** One row of `repair_ticket_returns`, as PostgREST sends it. */
export type ReturnRow = {
  ticket_id: string;
  at: string;
  status_before: string;
  status_after: string;
  price_before: number | string | null;
  price_after: number | string | null;
  warranty_before: number | string | null;
  warranty_after: number | string | null;
  cost_before: number | string | null;
  cost_after: number | string | null;
};

export const RETURN_COLUMNS =
  "ticket_id, at, status_before, status_after, price_before, price_after, warranty_before, warranty_after, cost_before, cost_after";

const figure = (value: number | string | null) => (value === null || value === "" ? null : Number(value));

/** The ledger's rows as the figures read them, by ticket, oldest first — the site's read and the desk app's pull. */
export function returnBookFrom(rows: readonly ReturnRow[]): Record<string, ReturnEntry[]> {
  const book: Record<string, ReturnEntry[]> = {};
  for (const row of rows) {
    (book[row.ticket_id] ??= []).push({
      at: row.at,
      before: { status: row.status_before, price: figure(row.price_before), warranty: figure(row.warranty_before), cost: figure(row.cost_before) },
      after: { status: row.status_after, price: figure(row.price_after), warranty: figure(row.warranty_after), cost: figure(row.cost_after) },
    });
  }
  for (const entries of Object.values(book)) entries.sort((a, b) => a.at.localeCompare(b.at));
  return book;
}

/** Ticket ids with a «راجع» within the period. */
export function returnedWithinIds(returns: ReturnBook, bounds: Bounds): Set<string> {
  const ids = new Set<string>();
  if (!returns) return ids;
  for (const [id, entries] of Object.entries(returns)) {
    if (entries.some((entry) => withinBounds(entry.at, bounds))) ids.add(id);
  }
  return ids;
}

/**
 * Down (سلبي) or up (إيجابي): by what the customer is charged, and where that
 * did not move — a warranty carved out of the same total — by the repair alone.
 */
export function returnDirection(summary: ReturnSummary): "down" | "up" {
  const by = summary.price !== 0 ? summary.price : summary.base;
  return by < 0 ? "down" : "up";
}

/**
 * One ticket's «راجع» into the «راجع» card's own figures — and nothing else.
 * `money` is what it moved in the till (`returnMoneyWithin`), the one card
 * on this day a «راجع» reaches.
 */
export function addReturnToTotals(totals: DeskTotals, summary: ReturnSummary, money = 0): void {
  totals.returnTickets += 1;
  totals.returnPrice += summary.price;
  if (returnDirection(summary) === "down") {
    totals.returnDown += summary.price;
    totals.returnDownTickets += 1;
  } else {
    totals.returnUp += summary.price;
    totals.returnUpTickets += 1;
  }
  totals.returnWarranty += summary.warranty;
  totals.returnCost += summary.cost;
  totals.returnProfit += summary.profit;
  if (summary.cancelled) totals.returnCancelled += 1;
  totals.returnTill += money;
  totals.till += money;
}

/**
 * The money a ticket's «راجع» moved within the period: the payments written in
 * the same moment as a «راجع» — the 10,000 handed back when 50,000 became
 * 40,000 on a cash ticket, the refund of a cancellation. Both ledgers are
 * written by triggers in one transaction, so they share one timestamp; a
 * change made on this computer not yet sent carries one time for both.
 */
export function returnMoneyWithin(id: string, book: PaymentBook, returns: ReturnBook, bounds: Bounds): number {
  if (!book || !returns) return 0;
  const moments = (returns[id] ?? []).filter((entry) => withinBounds(entry.at, bounds)).map((entry) => Date.parse(entry.at));
  if (!moments.length) return 0;
  let money = 0;
  for (const entry of book[id] ?? []) {
    if (!withinBounds(entry.at, bounds)) continue;
    const at = Date.parse(entry.at);
    if (moments.some((moment) => Math.abs(moment - at) <= 2000)) money += entry.amount;
  }
  return money;
}

/**
 * Every payment the bench's tickets have taken from the start of the period
 * on, by ticket id. `null` where the ledger is not on this deployment.
 */
export type PaymentBook = Record<string, readonly PaymentEntry[]> | null;

export type Bounds = { since: string | null; until: string | null };

/** What the figures need of a ticket — a structural slice of the board's row. */
export type FigureRow = {
  id: string;
  status: string;
  createdAt: string;
  /**
   * When the ticket became «مكتمل» — its booking day. Null while it never has
   * (or left the stage the same day). See `20261124_maintenance_stages.sql`.
   */
  completedAt: string | null;
  /** «تم التسليم للزبون» — a badge, never money. */
  handedOverAt?: string | null;
  price: number | null;
  warrantyPrice: number | null;
  costPrice: number | null;
  collected: number | null;
  paymentTerms: PaymentTerms;
  /** When its money row last changed — the stand-in date before the ledger. */
  financeAt?: string | null;
  holderId: string | null;
  holderName: string | null;
};

const before = (at: string, bound: string | null) => bound !== null && at < bound;
const from = (at: string, bound: string | null) => bound === null || at >= bound;

/** Whether an instant falls in the period. */
export function withinBounds(at: string, bounds: Bounds): boolean {
  return from(at, bounds.since) && !(bounds.until !== null && at >= bounds.until);
}

/** The day a ticket's money is dated by when there is no ledger. */
export function fallbackPaidAt(row: FigureRow): string {
  // نقد: when it became «مكتمل» — before that it has paid nothing.
  if (row.paymentTerms === "cash") return row.completedAt ?? row.createdAt;
  // آجل: the last change to what was collected — the only stand-in there is.
  return row.financeAt && row.financeAt > row.createdAt ? row.financeAt : row.createdAt;
}

/**
 * How much of a ticket's money came in before the period, and within it.
 *
 * Read off the ledger when there is one: within is what it dates inside the
 * period, after is what it dates past the period's end, and before is the
 * rest of what the ticket has paid by now — so the book need only hold the
 * period onwards. Nothing comes in before a ticket exists, so for a ticket
 * opened in the period anything not accounted for (a change made offline in
 * the desk app, not yet sent) counts within it.
 */
export function moneyAcross(
  row: FigureRow,
  book: PaymentBook,
  bounds: Bounds,
  options:
    | boolean
    | {
        /**
         * The book holds every entry, not only the period onwards — the desk
         * app's own copy. What it does not account for is then a change not
         * yet sent, dated by the money row (`financeAt`), so a ticket from
         * yesterday settled offline today counts today before the server has
         * heard of it.
         */
        complete?: boolean;
        /**
         * A cancellation records its refund in the ledger, on the day it
         * happens (20261121). Then a cancelled ticket's money is read off the
         * ledger like any other — it came in on one day and went back on
         * another. Before that file it carries none.
         */
        refunds?: boolean;
      } = false,
): { before: number; within: number } {
  const { complete = false, refunds = false } = typeof options === "boolean" ? { complete: options } : options;
  const cancelled = row.status === "cancelled" || row.status === "declined";
  if (cancelled && (!refunds || book === null)) return { before: 0, within: 0 };
  const paid = cancelled
    ? 0
    : repairMoney({
        price: row.price,
        warranty: row.warrantyPrice,
        cost: row.costPrice,
        collected: row.collected,
        terms: row.paymentTerms,
        completed: row.completedAt != null,
      }).collected;

  if (book === null) {
    const at = fallbackPaidAt(row);
    if (before(at, bounds.since)) return { before: paid, within: 0 };
    if (withinBounds(at, bounds)) return { before: 0, within: paid };
    return { before: 0, within: 0 };
  }

  let within = 0;
  let after = 0;
  let ahead = 0;
  for (const entry of book[row.id] ?? []) {
    if (before(entry.at, bounds.since)) ahead += entry.amount;
    else if (bounds.until !== null && entry.at >= bounds.until) after += entry.amount;
    else within += entry.amount;
  }
  // Opened after the period: nothing of it was before the period or in it,
  // whatever the ledger dates later. Without this a نقد ticket opened today,
  // which the old ledger priced at its opening, reached into yesterday as a
  // negative payment and was listed there (2026-11-25).
  if (bounds.until !== null && row.createdAt >= bounds.until) return { before: 0, within };
  if (complete) {
    const unsent = paid - ahead - within - after;
    const at = fallbackPaidAt(row);
    if (before(at, bounds.since)) ahead += unsent;
    else if (withinBounds(at, bounds)) within += unsent;
    if (from(row.createdAt, bounds.since)) return { before: 0, within: within + ahead };
    return { before: ahead, within };
  }
  let earlier = paid - within - after;
  if (from(row.createdAt, bounds.since)) {
    within += earlier;
    earlier = 0;
  }
  return { before: earlier, within };
}

/* ── Which tickets a card counts ───────────────────────────────────────── */

/**
 * The figures' own status filter (the shop, 2026-11-20): every ticket, the
 * three groups the devices card splits into, or one step.
 */
export const STATS_GROUPS = ["all", "progress", "completed", "cancelled"] as const;
export type StatsStatus = (typeof STATS_GROUPS)[number] | (string & {});

export function matchesStatsStatus(status: string, wanted: StatsStatus): boolean {
  if (wanted === "all") return true;
  if (wanted === "progress") return isOpenTicket(status);
  if (wanted === "cancelled") return status === "cancelled" || status === "declined";
  return status === wanted;
}

export type FigureFilters = {
  status: StatsStatus;
  terms: PaymentTerms | null;
  /** An account id, `none` for nobody's, or null for everybody. */
  holderId: string | null;
};

const byFilters = (row: FigureRow, filters: FigureFilters, withHolder: boolean) =>
  matchesStatsStatus(row.status, filters.status) &&
  (!filters.terms || row.paymentTerms === filters.terms) &&
  (!withHolder ||
    !filters.holderId ||
    (filters.holderId === "none" ? !row.holderId : row.holderId === filters.holderId));

export type FigureHolderRow = DeskTotals & { holderId: string | null; name: string };

/**
 * The cards and the per-person table, under the one rule (2026-11-24): only
 * «مكتمل» counts.
 *
 * `rows` is every ticket the page holds — opened in the period, completed in
 * it, paid or changed in it, and every one still open — narrowed here by the
 * figures' own filters. For each:
 *
 * - **booked within the period** (`bookedWithin`): it completed in it, and
 *   ended that day «مكتمل». Only these count in مبلغ الصيانة, الضمان, أسعار
 *   الشراء and الربح — as they stood at the end of that day; the purchase price
 *   is the ticket's own, whenever it was typed.
 * - **money within the period**: what the ledger dates in it, ordinary and
 *   «مرتجع» apart. Ordinary money is split the warranty's part first; the rest
 *   is «واصل نقد» for a نقد ticket or an آجل complete by the period's end, and
 *   «واصل آجل» otherwise. A «مرتجع»'s money reaches the safe and nothing else.
 * - **the debts, now**: what «بانتظار الزبون» tickets still owe, whatever
 *   day — a debt is a fact about today, not about the period.
 * - the counts of what was **opened** in the period (التذاكر · قيد العمل ·
 *   ملغاة), which say nothing about money.
 *
 * A website request (`requested`) is in none of it until it is accepted.
 */
export function computeFigures<R extends FigureRow>({
  rows,
  book,
  returns = null,
  bounds,
  filters,
  complete = false,
}: {
  rows: readonly R[];
  book: PaymentBook;
  /** `repair_ticket_returns` — null until its migration runs. */
  returns?: ReturnBook;
  bounds: Bounds;
  filters: FigureFilters;
  /** The book holds every entry — see `moneyAcross`. */
  complete?: boolean;
}): { totals: DeskTotals; byTech: FigureHolderRow[]; booked: R[]; paidRows: R[]; moneyRows: R[]; returnRows: R[] } {
  // The same file that keeps the «مرتجع» makes a cancellation post its refund.
  const refunds = returns !== null;
  const totals = emptyTotals();
  const perHolder = new Map<string, FigureHolderRow>();
  const holderOf = (row: R) => {
    const key = row.holderId ?? "";
    let entry = perHolder.get(key);
    if (!entry) {
      entry = { ...emptyTotals(), holderId: row.holderId, name: row.holderName ?? "" };
      perHolder.set(key, entry);
    }
    return entry;
  };

  const booked: R[] = [];
  const paidRows: R[] = [];
  const moneyRows: R[] = [];
  const returnRows: R[] = [];
  for (const row of rows) {
    if (stageOf(row.status) === "request") continue;
    if (!byFilters(row, filters, false)) continue;
    const fact = tallyRow(row, { book, returns, bounds, complete, refunds });
    addTally(holderOf(row), fact);
    if (!byFilters(row, filters, true)) continue;
    addTally(totals, fact);
    if (fact.booked) booked.push(row);
    if (fact.ordinary !== 0) moneyRows.push(row);
    if (fact.ordinary > 0 && !fact.opened) paidRows.push(row);
    if (fact.returned) returnRows.push(row);
  }

  const byTech = [...perHolder.values()].sort(
    (a, b) => Number(!a.holderId) - Number(!b.holderId) || b.maintenance - a.maintenance || b.tickets - a.tickets,
  );
  return { totals, byTech, booked, paidRows, moneyRows, returnRows };
}

/** One ticket's part in a period's figures — worked out once, added twice. */
type RowTally = {
  opened: boolean;
  /** The stage now — what the debts read. */
  stage: ReturnType<typeof stageOf>;
  /**
   * The stage at the period's end — what the counts of opened tickets read, so
   * a ticket completed yesterday and cancelled today is not yesterday's
   * cancellation.
   */
  stageThen: ReturnType<typeof stageOf>;
  deferred: boolean;
  booked: TicketState | null;
  /**
   * Opened in the period and completed on a later day. The day it was opened
   * keeps it among its completed tickets — the shop, 2026-11-25: a ticket
   * paid in full on a later day is that day's too, "without decreasing the
   * number of tickets from the day it got created in". Its money is the
   * completion day's, never this one's.
   */
  completedLater: boolean;
  cost: number | null;
  /** Ordinary money within the period, and its split. */
  ordinary: number;
  warrantyIn: number;
  repairIn: number;
  cashLike: boolean;
  /** The «مرتجع» within the period, and the money it moved. */
  returned: ReturnSummary | null;
  returnMoney: number;
  /** What a «بانتظار الزبون» ticket still owes now. */
  remaining: number;
  missingCollected: boolean;
};

function tallyRow(
  row: FigureRow,
  { book, returns, bounds, complete, refunds }: { book: PaymentBook; returns: ReturnBook; bounds: Bounds; complete: boolean; refunds: boolean },
): RowTally {
  const stage = stageOf(row.status);
  const opened = withinBounds(row.createdAt, bounds);
  const all = moneyAcross(row, book, bounds, { complete, refunds });
  const returnMoney = returnMoneyWithin(row.id, book, returns, bounds);
  const ordinary = all.within - returnMoney;
  // The warranty's part first, out of what the ticket had paid by then — and
  // only once it is «مكتمل», so a deposit on a ticket still on the bench is
  // all repair, and the warranty is recognised when the ticket completes.
  const span = returns ? warrantySpan(row, returns, bounds) : null;
  const warrantyNowValue = stateValue(currentState(row)).warranty;
  const warrantyBefore = Math.min(span?.start ?? warrantyNowValue, Math.max(0, all.before));
  const warrantyNow = Math.min(span?.end ?? warrantyNowValue, Math.max(0, all.before + ordinary));
  const warrantyIn = ordinary === 0 ? 0 : warrantyNow - warrantyBefore;
  const completeByEnd = row.completedAt != null && (bounds.until === null || row.completedAt < bounds.until);
  const money = repairMoney({
    price: row.price,
    warranty: row.warrantyPrice,
    cost: row.costPrice,
    collected: row.collected,
    terms: row.paymentTerms,
    completed: row.completedAt != null,
  });
  return {
    opened,
    stage,
    stageThen: stageOf(stateAt(row, returns, bounds.until).status),
    deferred: row.paymentTerms === "deferred",
    booked: bookedWithin(row, returns, bounds),
    completedLater: opened && row.completedAt != null && bounds.until !== null && row.completedAt >= bounds.until,
    cost: row.costPrice,
    ordinary,
    warrantyIn,
    repairIn: ordinary - warrantyIn,
    cashLike: row.paymentTerms === "cash" || completeByEnd,
    returned: returnSummary(row.id, returns, bounds),
    returnMoney,
    remaining: stage === "waiting" ? money.remaining : 0,
    missingCollected: row.paymentTerms === "deferred" && (stage === "accepted" || stage === "waiting") && row.collected == null,
  };
}

function addTally(into: DeskTotals, fact: RowTally): void {
  if (fact.opened) {
    into.tickets += 1;
    if (fact.completedLater) {
      // Counted here as well as on the day it completed; its money is there.
      into.completed += 1;
      into.completedLater += 1;
    } else if (fact.stageThen === "cancelled") into.cancelled += 1;
    else if (fact.stageThen === "accepted" || fact.stageThen === "waiting") into.open += 1;
    if (fact.deferred && fact.stageThen !== "cancelled") into.deferred += 1;
  }
  if (fact.booked) {
    const value = stateValue(fact.booked);
    into.completed += 1;
    if (!fact.opened) into.completedEarlier += 1;
    into.maintenance += value.base;
    into.revenue += value.price;
    if (value.warranty > 0) {
      into.warranty += value.warranty;
      into.warrantyTickets += 1;
    }
    // ⚠️ No purchase price typed counts as zero, and the profit goes on —
    // the shop's rule of 2026-11-20; `missingCost` says how many.
    const cost = fact.cost ?? 0;
    into.cost += cost;
    if (fact.cost == null && value.base > 0) into.missingCost += 1;
    into.profit += value.base - cost;
  }
  if (fact.ordinary !== 0) {
    if (fact.cashLike) into.collectedCash += fact.repairIn;
    else into.collectedDeferred += fact.repairIn;
    into.tillWarranty += fact.warrantyIn;
    into.till += fact.ordinary;
    if (!fact.opened && fact.ordinary > 0) into.paidFromEarlier += 1;
  }
  if (fact.returned) addReturnToTotals(into, fact.returned, fact.returnMoney);
  if (fact.remaining > 0) {
    into.outstanding += fact.remaining;
    into.owing += 1;
  }
  if (fact.missingCollected) into.missingCollected += 1;
}

/**
 * When a ticket was paid in full, off its whole ledger: the last moment its
 * running total went from below its price to at or above it. Null when it
 * never did, or has no price.
 *
 * ⚠️ The stand-in for `completed_at` while `20261124_maintenance_stages.sql`
 * has not run, and the rule its backfill dates an already-completed ticket
 * by. Not the status history: the desk app's queued changes reach the server
 * — and its history — at the moment it syncs, so on 2026-11-23 a whole
 * morning's completions were all stamped 16:54, and the shop's own correction
 * of RP-00099 reads there as a completion on the day it was made. The ledger
 * agrees with the shop on every one: RP-00133 and RP-00122 paid in full on the
 * 24th, the rest on the days they were closed.
 */
export function paidInFullAt(entries: readonly PaymentEntry[], price: number | null): string | null {
  const target = Math.max(0, price ?? 0);
  if (target <= 0) return null;
  let sum = 0;
  let reached: string | null = null;
  for (const entry of [...entries].sort((a, b) => a.at.localeCompare(b.at))) {
    const before = sum;
    sum += entry.amount;
    if (before < target && sum >= target) reached = entry.at;
    else if (sum < target) reached = null;
  }
  return reached;
}

/**
 * The «راجع» book without the entries a booking day owns — the rule
 * `20261124_maintenance_stages.sql` cleans the ledger by: a change on or
 * before the day a ticket was booked is that day's own business. Before the
 * migration runs the ledger still holds entries recorded against the day a
 * ticket was *opened*, and one of them booked RP-00122 at 1 dinar on the day
 * it was paid 45,000. `completions` names the tickets whose booking day is
 * known; every other ticket's entries are left as they are.
 */
export function dropBookingDayReturns(returns: ReturnBook, completions: ReadonlyMap<string, string>): ReturnBook {
  if (!returns) return returns;
  const out: Record<string, ReturnEntry[]> = {};
  for (const [id, entries] of Object.entries(returns)) {
    const booked = completions.get(id);
    const day = booked ? baghdadDay(Date.parse(booked)) : null;
    const kept = day ? entries.filter((entry) => baghdadDay(Date.parse(entry.at)) > day) : [...entries];
    if (kept.length) out[id] = kept;
  }
  return out;
}

/** Ticket ids the ledger dates money for within the period. */
export function paidWithinIds(book: PaymentBook, bounds: Bounds): Set<string> {
  const ids = new Set<string>();
  if (!book) return ids;
  for (const [id, entries] of Object.entries(book)) {
    if (entries.some((entry) => withinBounds(entry.at, bounds) && entry.amount !== 0)) ids.add(id);
  }
  return ids;
}

/**
 * An آجل ticket waiting for its customer and still owing — «آجل غير واصل»
 * (the shop, 2026-11-24). A ticket still on the bench owes nothing yet: the
 * work is not done.
 */
export function owesMoney(row: Omit<FigureRow, "id" | "createdAt" | "holderId" | "holderName" | "completedAt">): boolean {
  if (row.paymentTerms !== "deferred" || stageOf(row.status) !== "waiting") return false;
  return (
    repairMoney({
      price: row.price,
      warranty: row.warrantyPrice,
      cost: row.costPrice,
      collected: row.collected,
      terms: row.paymentTerms,
      completed: false,
    }).remaining > 0
  );
}
