import { addToTotals, emptyTotals, isOpenTicket, repairMoney, type DeskTotals, type PaymentTerms } from "./repair-desk.ts";

/**
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
 * A ticket from an earlier day that is edited, or cancelled, later "must
 * affect the revenue of the day it got edited in" and be shown on that day
 * under «راجع». So the day a ticket was opened counts it as it was at the end
 * of that day — `bookedState` — and every later change to its money is
 * counted on the day it was made, inside the cards and on a «راجع» card of
 * its own. A day plus every later day's «راجع» is what the ticket comes to
 * now, and a report printed yesterday reads the same today.
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

/** What a state counts for — nothing at all once cancelled. */
export function stateValue(state: TicketState): { price: number; warranty: number; base: number; cost: number } {
  if (isOff(state.status)) return { price: 0, warranty: 0, base: 0, cost: 0 };
  const money = repairMoney({ price: state.price, warranty: state.warranty, cost: state.cost, collected: null, terms: "deferred" });
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

/** `bookedState` in the shape `addToTotals` and the filters take. */
export function bookedFields(
  id: string,
  returns: ReturnBook,
): { status: string; price: number | null; warrantyPrice: number | null; costPrice: number | null } | null {
  const state = bookedState(id, returns);
  return state ? { status: state.status, price: state.price, warrantyPrice: state.warranty, costPrice: state.cost } : null;
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
    at: last.at,
    changes: entries.length,
  };
}

/**
 * What a «راجع» was, for a reader: called off (after delivery or not),
 * brought back, or which of the three figures moved and from what to what.
 */
export type ReturnDescription = {
  kind: "cancelDelivered" | "cancel" | "restore" | "edit";
  changes: { field: "price" | "warranty" | "cost"; from: number; to: number }[];
};

export function describeReturn(summary: ReturnSummary): ReturnDescription {
  if (summary.cancelled) {
    return { kind: summary.before.status === "completed" ? "cancelDelivered" : "cancel", changes: [] };
  }
  if (summary.restored) return { kind: "restore", changes: [] };
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

/** One ticket's «راجع» into a running total — the cards already count it on this day. */
export function addReturnToTotals(totals: DeskTotals, summary: ReturnSummary): void {
  totals.returnTickets += 1;
  totals.returnPrice += summary.price;
  if (summary.price > 0) totals.returnUp += summary.price;
  else totals.returnDown += summary.price;
  totals.returnWarranty += summary.warranty;
  totals.returnCost += summary.cost;
  totals.returnProfit += summary.profit;
  if (summary.cancelled) totals.returnCancelled += 1;
  totals.maintenance += summary.base;
  totals.revenue += summary.price;
  totals.warranty += summary.warranty;
  totals.cost += summary.cost;
  totals.profit += summary.profit;
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
  const money = repairMoney({
    price: row.price,
    warranty: row.warrantyPrice,
    cost: row.costPrice,
    collected: row.collected,
    terms: row.paymentTerms,
  });
  if (row.paymentTerms === "deferred" && money.price > 0 && money.remaining === 0 && row.financeAt && row.financeAt > row.createdAt) {
    return row.financeAt;
  }
  return row.createdAt;
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
  if (complete) {
    const unsent = paid - ahead - within - after;
    const at = row.financeAt && row.financeAt > row.createdAt ? row.financeAt : row.createdAt;
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
 * The cards and the per-person table.
 *
 * `opened` is every ticket opened in the period (the search already applied);
 * `earlier` is every ticket opened before it whose money came in, or changed,
 * within it. Both are narrowed here by the figures' own filters.
 *
 * A ticket opened in the period counts as its own day booked it
 * (`bookedState`), status included — so a ticket delivered yesterday and
 * cancelled today is a delivered ticket in yesterday's figures. Its «راجع»
 * within the period is added on top, ticket by ticket.
 */
export function computeFigures<R extends FigureRow>({
  opened,
  earlier,
  book,
  returns = null,
  bounds,
  filters,
  complete = false,
}: {
  opened: readonly R[];
  earlier: readonly R[];
  book: PaymentBook;
  /** `repair_ticket_returns` — null until its migration runs. */
  returns?: ReturnBook;
  bounds: Bounds;
  filters: FigureFilters;
  /** The book holds every entry — see `moneyAcross`. */
  complete?: boolean;
}): { totals: DeskTotals; byTech: FigureHolderRow[]; rows: R[]; paidRows: R[]; returnRows: R[] } {
  // The same file that keeps the «راجع» makes a cancellation post its refund.
  const refunds = returns !== null;
  const across = (row: R) => moneyAcross(row, book, bounds, { complete, refunds });
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

  const rows: R[] = [];
  const returnRows: R[] = [];
  for (const row of opened) {
    const booked = bookedFields(row.id, returns);
    // The figures' status filter reads the status the ticket's day counted.
    const own = booked ? { ...row, status: booked.status } : row;
    if (!byFilters(own, filters, false)) continue;
    const paid = across(row);
    const returned = returnSummary(row.id, returns, bounds);
    const warranty = returns ? warrantySpan(row, returns, bounds) : null;
    addToTotals(holderOf(row), row, { paid, booked, refunds, warranty });
    if (returned) addReturnToTotals(holderOf(row), returned);
    if (!byFilters(own, filters, true)) continue;
    rows.push(row);
    addToTotals(totals, row, { paid, booked, refunds, warranty });
    if (returned) {
      returnRows.push(row);
      addReturnToTotals(totals, returned);
    }
  }

  const paidRows: R[] = [];
  for (const row of earlier) {
    if (!byFilters(row, filters, false)) continue;
    const paid = across(row);
    const returned = returnSummary(row.id, returns, bounds);
    if (paid.within === 0 && !returned) continue;
    const warranty = returns ? warrantySpan(row, returns, bounds) : null;
    addToTotals(holderOf(row), row, { counted: false, paid, refunds, warranty });
    if (returned) addReturnToTotals(holderOf(row), returned);
    if (!byFilters(row, filters, true)) continue;
    // A refund is a «راجع», not a payment from an earlier day.
    if (paid.within > 0) paidRows.push(row);
    if (returned) returnRows.push(row);
    addToTotals(totals, row, { counted: false, paid, refunds, warranty });
    if (returned) addReturnToTotals(totals, returned);
  }

  const byTech = [...perHolder.values()].sort(
    (a, b) => Number(!a.holderId) - Number(!b.holderId) || b.maintenance - a.maintenance || b.tickets - a.tickets,
  );
  return { totals, byTech, rows, paidRows, returnRows };
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

/** A deferred ticket that still owes — the «الآجل» list (the shop, 2026-11-20). */
export function owesMoney(row: Omit<FigureRow, "id" | "createdAt" | "holderId" | "holderName">): boolean {
  if (row.paymentTerms !== "deferred" || row.status === "cancelled" || row.status === "declined") return false;
  return (
    repairMoney({
      price: row.price,
      warranty: row.warrantyPrice,
      cost: row.costPrice,
      collected: row.collected,
      terms: row.paymentTerms,
    }).remaining > 0
  );
}

/* ── From a card to the tickets behind it ─────────────────────────────── */

/**
 * The tickets panel's "behind this card" filter (`?mf=`, the shop,
 * 2026-11-20: "when the admin clicks a card, take him to the tickets with the
 * filters that show the tickets that led to that figure"). One per card that
 * is not simply "every ticket in the period":
 *
 * - `opened` — every ticket opened in the period, cancelled ones too: التذاكر.
 * - `active` — opened in the period and not cancelled: مبلغ الصيانة, الربح.
 * - `warranty` — of those, the ones with a warranty: الضمان.
 * - `cost` — of those, the ones with a purchase price typed: أسعار الشراء.
 * - `cash` / `deferred` — money that came in within the period and counted in
 *   «واصل نقد» or «واصل آجل», whichever day the ticket was opened.
 * - `till` — any money that came in within the period: «واصل بالخزنة».
 * - `owing` — opened in the period, deferred, still owing: الديون.
 */
export const MONEY_FILTERS = ["opened", "active", "warranty", "cost", "cash", "deferred", "till", "owing"] as const;
export type MoneyFilter = (typeof MONEY_FILTERS)[number];

export function isMoneyFilter(value: unknown): value is MoneyFilter {
  return typeof value === "string" && (MONEY_FILTERS as readonly string[]).includes(value);
}

/**
 * Whether a ticket is behind one card. `paid` is `moneyAcross`'s answer for
 * the period; `opened` says the ticket was opened in it (an earlier ticket on
 * the list only for its money is not).
 *
 * `booked` is what the ticket's own day counted (`bookedFields`) and
 * `returned` its «راجع» within the period: a card counts both, so the tickets
 * behind it are the ones it counted either way.
 */
export function matchesMoneyFilter(
  row: Omit<FigureRow, "id" | "createdAt" | "holderId" | "holderName">,
  filter: MoneyFilter,
  paid: { before: number; within: number },
  opened: boolean,
  {
    booked = null,
    returned = null,
    warranty = null,
  }: {
    booked?: { status: string; price: number | null; warrantyPrice: number | null; costPrice: number | null } | null;
    returned?: ReturnSummary | null;
    /** `warrantySpan` — what the period's money is split by. The ticket's warranty now when absent. */
    warranty?: { start: number; end: number } | null;
  } = {},
): boolean {
  if (filter === "opened") return opened;
  const own = booked ?? row;
  const counted = opened && !isOff(own.status);
  const day = repairMoney({
    price: own.price,
    warranty: own.warrantyPrice,
    cost: own.costPrice,
    collected: row.collected,
    terms: row.paymentTerms,
  });
  const money = repairMoney({
    price: row.price,
    warranty: row.warrantyPrice,
    cost: row.costPrice,
    collected: row.collected,
    terms: row.paymentTerms,
  });
  // The same split `addToTotals` makes: the warranty paid first.
  const warrantyBefore = Math.min(warranty?.start ?? money.warranty, Math.max(0, paid.before));
  const warrantyNow = Math.min(warranty?.end ?? money.warranty, Math.max(0, paid.before + paid.within));
  const repairIn = paid.within - (warrantyNow - warrantyBefore);
  const cashLike = row.paymentTerms === "cash" || money.remaining === 0;
  switch (filter) {
    case "active":
      return counted || (returned != null && (returned.base !== 0 || returned.profit !== 0));
    case "warranty":
      return (counted && day.warranty > 0) || (returned != null && returned.warranty !== 0);
    case "cost":
      return (counted && day.cost != null) || (returned != null && returned.cost !== 0);
    case "owing":
      return opened && !isOff(row.status) && row.paymentTerms === "deferred" && money.remaining > 0;
    case "till":
      return paid.within !== 0;
    case "cash":
      return repairIn !== 0 && cashLike;
    case "deferred":
      return repairIn !== 0 && !cashLike;
  }
}
