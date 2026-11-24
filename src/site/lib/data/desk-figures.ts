import { addToTotals, emptyTotals, isOpenTicket, repairMoney, type DeskTotals, type PaymentTerms } from "./repair-desk.ts";

/**
 * The repair desk's figures panel — which tickets each card counts, and on
 * which day each dinar came in. Pure and shared: the dashboard runs it over
 * the server's rows (`lib/queries/repair-desk.ts`) and the desktop app over
 * its own copy (`src/main/desk/board.ts`), so a card reads the same on both.
 *
 * ---------------------------------------------------------------------------
 * Three clocks (the shop, 2026-11-20 and 2026-11-24)
 * ---------------------------------------------------------------------------
 * - **How many tickets, and what is still owed** — التذاكر and الديون —
 *   belong to the day a ticket was **opened**. الديون is what those tickets
 *   still owed at the period's end, so yesterday keeps the debts it had.
 * - **What a ticket came to** — مبلغ الصيانة, أسعار الشراء, الربح الصافي and
 *   الضمان — belongs to the day it was **paid in full** (`bookingMoment`).
 *   A نقد ticket is paid in full the moment it is opened; an آجل ticket on the
 *   day its last dinar came in. The shop, 2026-11-24: "the ticket must effect
 *   only the reports of the day that it gets filled by … so its day remain as
 *   it is". An آجل ticket opened yesterday and settled today counts in today's
 *   مبلغ الصيانة, parts and profit, and never in yesterday's.
 * - **Money** — «واصل نقد», «واصل آجل», «واصل بالخزنة» — belongs to the day it
 *   **came in**, every dinar once. The dates come from `repair_ticket_payments`,
 *   a ledger the database keeps by itself (`20261120_repair_payments.sql`);
 *   until that file runs, a deferred ticket paid in full is dated by the last
 *   change to its money row, and everything else by the day it was opened.
 *
 * ---------------------------------------------------------------------------
 * «راجع» — the till of its own day, the rest on the ticket's (2026-11-24)
 * ---------------------------------------------------------------------------
 * A change made on a later day than the ticket was paid in full — its price
 * brought down or up, a warranty added, the ticket cancelled — is a «راجع».
 * On the day of the change it moves ONE figure: «واصل بالخزنة», by the money
 * actually handed back or taken; the «راجع» card says what changed. The day
 * the ticket was paid in full counts it as it is now: "its original day must
 * change its statics all of it based on the status of راجع and the ticket".
 * Its till there keeps the money that came in that day — the drawer had it —
 * so every day's till is what the drawer held, and a refund is counted once.
 *
 * A change before the ticket was paid in full is not a «راجع»: an آجل ticket
 * priced today and settled today is simply today's.
 *
 * Which payment is a «راجع»'s is told by the moment: the payments ledger and
 * `repair_ticket_returns` are written by triggers in one transaction, so they
 * share one `now()` (`returnMoneyWithin`). Until 20261121_repair_returns.sql
 * runs there is no book and nothing is a «راجع». The same file makes a
 * cancellation post its refund in the payments ledger on the day it happens,
 * which is what `refunds` turns on.
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

/** The Baghdad calendar day of an instant — Iraq keeps UTC+3 all year. */
export function baghdadDayOf(at: string): string {
  return new Date(Date.parse(at) + 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * When a ticket was paid in full — the day its amount, its part, its warranty
 * and its profit belong to (the shop, 2026-11-24).
 *
 * - an instant: the last event of the first Baghdad day that **ended** with
 *   everything it had taken covering what it was charged then;
 * - `"before"`: before the book starts (`since`) — the site reads the ledger
 *   from the period's start on, and that is all it needs to know;
 * - `null`: not paid in full yet, or never priced — counted nowhere yet.
 *
 * ⚠️ By the day's end, not the first moment, and that is load-bearing: the
 * desk opens an آجل ticket as نقد and turns it آجل a moment later, so the
 * ledger reads +25,000 then −25,000 within one minute. "Paid in full at
 * 16:55" would book an unpaid ticket on the day it was opened.
 *
 * The price at a moment is the ticket's state after every change made up to
 * it — a change and its payment share one `now()` — so a نقد ticket whose
 * price was raised a week later is still paid in full on its own day, and the
 * raise is a «راجع».
 */
export type Moment = string | "before" | null;

export function bookingMoment(
  row: FigureRow,
  book: PaymentBook,
  returns: ReturnBook,
  { since = null, complete = false }: { since?: string | null; complete?: boolean } = {},
): Moment {
  const off = isOff(row.status);
  const now = repairMoney({
    price: row.price,
    warranty: row.warrantyPrice,
    cost: row.costPrice,
    collected: row.collected,
    terms: row.paymentTerms,
  });
  if (book === null) {
    if (off || now.price <= 0 || now.remaining > 0) return null;
    const at = fallbackPaidAt(row);
    return since !== null && at < since ? "before" : at;
  }

  const current: TicketState = { status: row.status, price: row.price, warranty: row.warrantyPrice, cost: row.costPrice };
  const changes = returns?.[row.id] ?? [];
  // What it was charged once everything up to `time` had happened.
  const priceAfter = (time: number) => {
    const next = changes.find((entry) => Date.parse(entry.at) > time);
    return stateValue(next ? next.before : current).price;
  };

  const paidNow = off ? 0 : now.collected;
  const events = (book[row.id] ?? []).map((entry) => ({ time: Date.parse(entry.at), at: entry.at, amount: entry.amount }));
  const recorded = events.reduce((sum, entry) => sum + entry.amount, 0);
  let paid = 0;
  if (complete) {
    // A change made on this computer and not sent yet, dated by the money row.
    const unsent = paidNow - recorded;
    if (unsent !== 0) {
      const at = row.financeAt && row.financeAt > row.createdAt ? row.financeAt : row.createdAt;
      events.push({ time: Date.parse(at), at, amount: unsent });
    }
  } else if (since !== null && row.createdAt < since) {
    // The book starts at `since`: what was paid before it is the rest.
    paid = paidNow - recorded;
    const price = priceAfter(Date.parse(since) - 1);
    if (price > 0 && paid >= price) return "before";
  } else {
    // Money the ledger does not account for came in when the ticket was opened.
    const unrecorded = paidNow - recorded;
    if (unrecorded !== 0) events.push({ time: Date.parse(row.createdAt), at: row.createdAt, amount: unrecorded });
  }
  // A change with no money can settle a ticket too — a price brought down to
  // what it had already paid.
  for (const entry of changes) events.push({ time: Date.parse(entry.at), at: entry.at, amount: 0 });
  events.sort((a, b) => a.time - b.time);

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    paid += event.amount;
    const next = events[index + 1];
    // Only a day's end decides.
    if (next && baghdadDayOf(next.at) === baghdadDayOf(event.at)) continue;
    const price = priceAfter(event.time);
    if (price > 0 && paid >= price) return event.at;
  }
  return null;
}

/** Whether a ticket was paid in full within the period. */
export function bookedWithin(moment: Moment, bounds: Bounds): boolean {
  return typeof moment === "string" && moment !== "before" && withinBounds(moment, bounds);
}

/**
 * Every ticket's paid-in-full moment, and the «راجع» book cut down to what is
 * really a «راجع»: a change made on a later day than the ticket was paid in
 * full. A change before then — an آجل ticket priced the day it is settled — is
 * that day's own business. `since` is where the payments book starts.
 */
export function deskBookings(
  rows: readonly FigureRow[],
  book: PaymentBook,
  returns: ReturnBook,
  { since = null, complete = false }: { since?: string | null; complete?: boolean } = {},
): { moments: Map<string, Moment>; returns: ReturnBook } {
  const moments = new Map<string, Moment>();
  for (const row of rows) moments.set(row.id, bookingMoment(row, book, returns, { since, complete }));
  if (!returns) return { moments, returns: null };
  const kept: Record<string, ReturnEntry[]> = {};
  for (const row of rows) {
    const entries = returns[row.id];
    const moment = moments.get(row.id) ?? null;
    if (!entries?.length || moment === null) continue;
    const later =
      moment === "before" ? [...entries] : entries.filter((entry) => baghdadDayOf(entry.at) > baghdadDayOf(moment));
    if (later.length) kept[row.id] = later;
  }
  return { moments, returns: kept };
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
 * What the figures read of the books once, for every ticket on the page: the
 * books themselves, each ticket's paid-in-full moment, and the «راجع» book cut
 * down to real «راجع» (`deskBookings`). `since` is where the payments book
 * starts — the figures' period on the site, everything in the desk app.
 */
export type FigureContext = {
  book: PaymentBook;
  /** Every recorded change — what a ticket's price was at a moment. */
  changes: ReturnBook;
  /** Only the «راجع»: changes made after the day a ticket was paid in full. */
  returns: ReturnBook;
  moments: Map<string, Moment>;
  since: string | null;
  complete: boolean;
  /** The same file that keeps the «راجع» makes a cancellation post its refund. */
  refunds: boolean;
};

export function figureContext({
  rows,
  book,
  returns,
  since,
  complete = false,
}: {
  rows: readonly FigureRow[];
  book: PaymentBook;
  returns: ReturnBook;
  since: string | null;
  complete?: boolean;
}): FigureContext {
  const booked = deskBookings(rows, book, returns, { since, complete });
  return { book, changes: returns, returns: booked.returns, moments: booked.moments, since, complete, refunds: returns !== null };
}

/** Everything a card asks of one ticket in one period. */
export type FigureFacts = {
  /** Paid in full within the period: its amount, part, warranty and profit count here. */
  booked: boolean;
  /** The ordinary money, before the period and within it — a «راجع»'s left out. */
  paid: { before: number; within: number };
  /** What a «راجع» moved in the till within the period. */
  returnMoney: number;
  /** Its «راجع» within the period. */
  returned: ReturnSummary | null;
  /** The warranty at the period's start and end — what its money is split by. */
  warranty: { start: number; end: number } | null;
  /** What it still owed at the period's end, and whether it was paid in full by then. */
  remaining: number;
  settled: boolean;
};

export function figureFacts(row: FigureRow, context: FigureContext, bounds: Bounds): FigureFacts {
  const { book, changes, returns, complete, refunds } = context;
  const all = moneyAcross(row, book, bounds, { complete, refunds });
  const returnMoney = returnMoneyWithin(row.id, book, returns, bounds);
  const moment = context.moments.has(row.id)
    ? (context.moments.get(row.id) ?? null)
    : bookingMoment(row, book, changes, { since: context.since, complete });
  const now = repairMoney({
    price: row.price,
    warranty: row.warrantyPrice,
    cost: row.costPrice,
    collected: row.collected,
    terms: row.paymentTerms,
  });
  let remaining: number;
  let settled: boolean;
  if (isOff(row.status)) {
    remaining = 0;
    settled = true;
  } else if (book === null) {
    remaining = now.remaining;
    settled = row.paymentTerms === "cash" || now.remaining === 0;
  } else {
    // As it stood at the period's end: what it was charged then, less every
    // dinar it had taken by then.
    const price = stateValue(stateAt(row, changes, bounds.until)).price;
    remaining = Math.max(0, price - (all.before + all.within));
    settled = remaining === 0;
  }
  return {
    booked: bookedWithin(moment, bounds),
    paid: { before: all.before, within: all.within - returnMoney },
    returnMoney,
    returned: returnSummary(row.id, returns, bounds),
    warranty: changes ? warrantySpan(row, changes, bounds) : null,
    remaining,
    settled,
  };
}

/**
 * The cards and the per-person table.
 *
 * `opened` is every ticket opened in the period (the search already applied);
 * `earlier` is every ticket opened before it whose money came in, or changed,
 * within it. Both are narrowed here by the figures' own filters.
 *
 * التذاكر and الديون count the tickets opened in the period; مبلغ الصيانة, the
 * parts, the warranty and the profit count the tickets paid in full within it,
 * whichever day they were opened (`bookingMoment`), each as it is now; the
 * money is the money that came in within it. A «راجع» within the period moves
 * the till and its own card, nothing else.
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
  /** `repair_ticket_returns`, every change — null until its migration runs. */
  returns?: ReturnBook;
  bounds: Bounds;
  filters: FigureFilters;
  /** The book holds every entry — see `moneyAcross`. */
  complete?: boolean;
}): {
  totals: DeskTotals;
  byTech: FigureHolderRow[];
  rows: R[];
  paidRows: R[];
  returnRows: R[];
  /** Tickets opened before the period and paid in full within it. */
  bookedRows: R[];
  /** Every ticket whose amount counts in this period. */
  booked: Set<string>;
} {
  const context = figureContext({ rows: [...opened, ...earlier], book, returns, since: bounds.since, complete });
  const refunds = context.refunds;
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

  const optionsOf = (facts: FigureFacts, counted: boolean) => ({
    counted,
    booked: facts.booked,
    paid: facts.paid,
    refunds,
    warranty: facts.warranty,
    remaining: facts.remaining,
    settled: facts.settled,
  });

  const rows: R[] = [];
  const returnRows: R[] = [];
  const bookedRows: R[] = [];
  const booked = new Set<string>();
  for (const row of opened) {
    if (!byFilters(row, filters, false)) continue;
    const facts = figureFacts(row, context, bounds);
    addToTotals(holderOf(row), row, optionsOf(facts, true));
    if (facts.returned) addReturnToTotals(holderOf(row), facts.returned, facts.returnMoney);
    if (!byFilters(row, filters, true)) continue;
    rows.push(row);
    if (facts.booked) booked.add(row.id);
    addToTotals(totals, row, optionsOf(facts, true));
    if (facts.returned) {
      returnRows.push(row);
      addReturnToTotals(totals, facts.returned, facts.returnMoney);
    }
  }

  const paidRows: R[] = [];
  for (const row of earlier) {
    // A ticket from an earlier day is filtered by the status it came into the
    // period with: one delivered before and refunded today is a delivered
    // ticket's refund, so «مكتمل» keeps it in the till (the shop, 2026-11-24).
    const own = { ...row, status: stateAt(row, context.changes, bounds.since).status };
    if (!byFilters(own, filters, false)) continue;
    const facts = figureFacts(row, context, bounds);
    if (facts.paid.within === 0 && !facts.returned && !facts.booked) continue;
    addToTotals(holderOf(row), row, optionsOf(facts, false));
    if (facts.returned) addReturnToTotals(holderOf(row), facts.returned, facts.returnMoney);
    if (!byFilters(own, filters, true)) continue;
    // A refund is a «راجع», not a payment from an earlier day.
    if (facts.paid.within > 0) paidRows.push(row);
    if (facts.booked) {
      bookedRows.push(row);
      booked.add(row.id);
    }
    if (facts.returned) returnRows.push(row);
    addToTotals(totals, row, optionsOf(facts, false));
    if (facts.returned) addReturnToTotals(totals, facts.returned, facts.returnMoney);
  }

  const byTech = [...perHolder.values()].sort(
    (a, b) => Number(!a.holderId) - Number(!b.holderId) || b.maintenance - a.maintenance || b.tickets - a.tickets,
  );
  return { totals, byTech, rows, paidRows, returnRows, bookedRows, booked };
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
 * - `active` — paid in full within the period and not cancelled, whichever
 *   day it was opened: مبلغ الصيانة, الربح.
 * - `warranty` — of those, the ones with a warranty: الضمان.
 * - `cost` — of those, the ones with a purchase price typed: أسعار الشراء.
 * - `cash` / `deferred` — money that came in within the period and counted in
 *   «واصل نقد» or «واصل آجل», whichever day the ticket was opened.
 * - `till` — any money that came in within the period: «واصل بالخزنة».
 * - `owing` — opened in the period and still owing at its end: الديون.
 */
export const MONEY_FILTERS = ["opened", "active", "warranty", "cost", "cash", "deferred", "till", "owing"] as const;
export type MoneyFilter = (typeof MONEY_FILTERS)[number];

export function isMoneyFilter(value: unknown): value is MoneyFilter {
  return typeof value === "string" && (MONEY_FILTERS as readonly string[]).includes(value);
}

/**
 * Whether a ticket is behind one card — read off the same `figureFacts` the
 * card was summed with, so the two cannot disagree. `opened` says the ticket
 * was opened in the period (an earlier ticket on the list only for its money,
 * or for being paid in full here, is not).
 *
 * A «راجع»'s money (`returnMoney`) is behind «واصل بالخزنة» and no other card,
 * as it is counted.
 */
export function matchesMoneyFilter(
  row: Omit<FigureRow, "id" | "createdAt" | "holderId" | "holderName">,
  filter: MoneyFilter,
  facts: Pick<FigureFacts, "booked" | "paid"> & Partial<Omit<FigureFacts, "booked" | "paid">>,
  opened: boolean,
): boolean {
  if (filter === "opened") return opened;
  const money = repairMoney({
    price: row.price,
    warranty: row.warrantyPrice,
    cost: row.costPrice,
    collected: row.collected,
    terms: row.paymentTerms,
  });
  const off = isOff(row.status);
  const counted = facts.booked && !off;
  const { paid, warranty = null, returnMoney = 0 } = facts;
  const remaining = off ? 0 : (facts.remaining ?? money.remaining);
  const settled = facts.settled ?? (row.paymentTerms === "cash" || money.remaining === 0);
  // The same split `addToTotals` makes: the warranty paid first — over the
  // ordinary money only, a «راجع»'s being the till's alone.
  const warrantyBefore = Math.min(warranty?.start ?? money.warranty, Math.max(0, paid.before));
  const warrantyNow = Math.min(warranty?.end ?? money.warranty, Math.max(0, paid.before + paid.within));
  const repairIn = paid.within - (warrantyNow - warrantyBefore);
  switch (filter) {
    case "active":
      return counted;
    case "warranty":
      return counted && money.warranty > 0;
    case "cost":
      return counted && money.cost != null;
    case "owing":
      return opened && !off && remaining > 0;
    case "till":
      return paid.within + returnMoney !== 0;
    case "cash":
      return repairIn !== 0 && settled;
    case "deferred":
      return repairIn !== 0 && !settled;
  }
}
