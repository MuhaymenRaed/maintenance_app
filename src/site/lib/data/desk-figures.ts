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
 */

export type PaymentEntry = { at: string; amount: number };

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
  /**
   * The book holds every entry, not only the period onwards — the desk app's
   * own copy. What it does not account for is then a change not yet sent,
   * dated by the money row (`financeAt`), so a ticket from yesterday settled
   * offline today counts today before the server has heard of it.
   */
  complete = false,
): { before: number; within: number } {
  if (row.status === "cancelled" || row.status === "declined") return { before: 0, within: 0 };
  const paid = repairMoney({
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
 * `earlier` is every ticket opened before it whose money came in within it.
 * Both are narrowed here by the figures' own filters.
 */
export function computeFigures<R extends FigureRow>({
  opened,
  earlier,
  book,
  bounds,
  filters,
  complete = false,
}: {
  opened: readonly R[];
  earlier: readonly R[];
  book: PaymentBook;
  bounds: Bounds;
  filters: FigureFilters;
  /** The book holds every entry — see `moneyAcross`. */
  complete?: boolean;
}): { totals: DeskTotals; byTech: FigureHolderRow[]; rows: R[]; paidRows: R[] } {
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
  for (const row of opened) {
    if (!byFilters(row, filters, false)) continue;
    const paid = moneyAcross(row, book, bounds, complete);
    addToTotals(holderOf(row), row, { paid });
    if (!byFilters(row, filters, true)) continue;
    rows.push(row);
    addToTotals(totals, row, { paid });
  }

  const paidRows: R[] = [];
  for (const row of earlier) {
    if (!byFilters(row, filters, false)) continue;
    const paid = moneyAcross(row, book, bounds, complete);
    if (paid.within === 0) continue;
    addToTotals(holderOf(row), row, { counted: false, paid });
    if (!byFilters(row, filters, true)) continue;
    paidRows.push(row);
    addToTotals(totals, row, { counted: false, paid });
  }

  const byTech = [...perHolder.values()].sort(
    (a, b) => Number(!a.holderId) - Number(!b.holderId) || b.maintenance - a.maintenance || b.tickets - a.tickets,
  );
  return { totals, byTech, rows, paidRows };
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
