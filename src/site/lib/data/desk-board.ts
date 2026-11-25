import {
  bookedWithin,
  moneyAcross,
  returnMoneyWithin,
  returnSummary,
  withinBounds,
  type Bounds,
  type FigureRow,
  type PaymentBook,
  type ReturnBook,
  type ReturnSummary,
} from "./desk-figures.ts";
import { stageOf, type RepairStage } from "./repair-stage.ts";
import { normalizeSearch } from "../search.ts";
import type { PaymentTerms } from "./repair-desk.ts";

/**
 * كشف التذاكر's lists, the safe's movements and the workshop's cards — the
 * shop's rebuilt maintenance section (2026-11-24), computed from the raw rows
 * the page holds. Pure and relative-imported: the dashboard runs it in the
 * browser over the server's rows, the desktop app over its own copy, so a
 * list reads the same on both and switching a tab costs no request.
 *
 * Which day a ticket belongs to depends on the list:
 *
 * - **مكتمل** — the day it became «مكتمل» (its booking, `bookedWithin`),
 *   and the day it was opened when that was an earlier one (the shop,
 *   2026-11-25: a ticket paid in full on a later day is that day's too,
 *   "without decreasing the number of tickets from the day it got created
 *   in"). Its money is only ever the completion day's.
 * - **غير مكتمل** — the day it was opened, or a day its money came in (an
 *   آجل deposit). Split into «آجل غير واصل» (`waiting`) and «قيد الطلب»
 *   (`progress`). An open ticket from an earlier day with nothing in the
 *   period is not listed; `olderOpen` counts it, so the screen can offer it.
 * - **ملغي** — the day it was opened.
 * - **مرتجع** — the day of the later change.
 * - **طلبات الموقع** — any day: a request waits until somebody decides.
 */
export type DeskList = "completed" | "incomplete" | "waiting" | "progress" | "cancelled" | "returned" | "requests";

export const DESK_LISTS: readonly DeskList[] = ["completed", "incomplete", "waiting", "progress", "cancelled", "returned", "requests"];

/** What the lists know about one row. */
export type RowFacts = {
  stage: RepairStage;
  /** Opened within the period. */
  opened: boolean;
  /** Booked within the period — it completed in it. */
  booked: boolean;
  /** Opened in the period and completed on a later day: listed here too, its money there. */
  completedLater: boolean;
  /** When it became «مكتمل», for the mark that says so. */
  completedAt: string | null;
  /** Ordinary money that came in within the period (a «مرتجع»'s apart). */
  paid: number;
  /** On a list from before the period — for its money or its «مرتجع». */
  earlier: boolean;
  /** Its «مرتجع» within the period. */
  returned: ReturnSummary | null;
};

type Context = { bounds: Bounds; book: PaymentBook; returns: ReturnBook; complete?: boolean };

export function rowFacts(row: FigureRow, { bounds, book, returns, complete = false }: Context): RowFacts {
  const opened = withinBounds(row.createdAt, bounds);
  const all = moneyAcross(row, book, bounds, { complete, refunds: returns !== null });
  const paid = all.within - returnMoneyWithin(row.id, book, returns, bounds);
  return {
    stage: stageOf(row.status),
    opened,
    booked: bookedWithin(row, returns, bounds) !== null,
    completedLater: opened && row.completedAt != null && bounds.until !== null && row.completedAt >= bounds.until,
    completedAt: row.completedAt,
    paid,
    earlier: !opened,
    returned: returnSummary(row.id, returns, bounds),
  };
}

export function deskLists<R extends FigureRow>(
  rows: readonly R[],
  context: Context,
): { lists: Record<DeskList, R[]>; facts: Map<string, RowFacts>; olderOpen: R[] } {
  const lists = Object.fromEntries(DESK_LISTS.map((list) => [list, [] as R[]])) as Record<DeskList, R[]>;
  const facts = new Map<string, RowFacts>();
  const olderOpen: R[] = [];
  const { until } = context.bounds;
  for (const row of rows) {
    // A website request waits for somebody whatever day it is.
    if (stageOf(row.status) !== "request" && until !== null && row.createdAt >= until) {
      // Opened after the period: none of its lists, and not "older" either —
      // a past day is never shown a ticket that did not exist yet.
      continue;
    }
    const fact = rowFacts(row, context);
    facts.set(row.id, fact);
    if (fact.stage === "request") {
      lists.requests.push(row);
      continue;
    }
    if (fact.booked || fact.completedLater) lists.completed.push(row);
    if (fact.returned) lists.returned.push(row);
    if (fact.stage === "cancelled" && fact.opened) lists.cancelled.push(row);
    if (fact.stage === "accepted" || fact.stage === "waiting") {
      if (fact.opened || fact.paid !== 0) {
        lists.incomplete.push(row);
        lists[fact.stage === "waiting" ? "waiting" : "progress"].push(row);
      } else {
        olderOpen.push(row);
      }
    }
  }
  return { lists, facts, olderOpen };
}

/**
 * One movement of the safe within the period — تقارير الخزينة's list.
 *
 * - `cash` — a نقد ticket's price, taken when it completed;
 * - `settle` — an آجل ticket's money once it is complete (the rest, paid
 *   off);
 * - `deposit` — an آجل ticket's money while it still owed (a deposit, a
 *   part-payment — or one handed back when it was cancelled before being
 *   completed);
 * - `return` — a «مرتجع»: money handed back or taken on a later day than the
 *   ticket was booked.
 */
export type MoneyMove = { ticketId: string; at: string; amount: number; kind: "cash" | "settle" | "deposit" | "return" };

export function moneyMoves(rows: readonly FigureRow[], { bounds, book, returns }: Context): MoneyMove[] {
  if (!book) return [];
  const moves: MoneyMove[] = [];
  for (const row of rows) {
    if (stageOf(row.status) === "request") continue;
    const moments = (returns?.[row.id] ?? []).map((entry) => Date.parse(entry.at));
    for (const entry of book[row.id] ?? []) {
      if (entry.amount === 0 || !withinBounds(entry.at, bounds)) continue;
      const time = Date.parse(entry.at);
      const kind: MoneyMove["kind"] = moments.some((moment) => Math.abs(moment - time) <= 2000)
        ? "return"
        : row.paymentTerms === "cash"
          ? "cash"
          : row.completedAt != null && entry.at >= row.completedAt
            ? "settle"
            : "deposit";
      moves.push({ ticketId: row.id, at: entry.at, amount: entry.amount, kind });
    }
  }
  return moves.sort((a, b) => a.at.localeCompare(b.at));
}

/** One person's card in إدارة الورشة. */
export type WorkshopPerson = {
  /** Null is «غير مسند». */
  holderId: string | null;
  name: string;
  rank: "manager" | "assistant" | "technician" | null;
  /** On the bench now — accepted or waiting, whatever day. */
  open: number;
  /** Of those, waiting for the customer. */
  waiting: number;
  /** Opened in the period. */
  opened: number;
  /** Completed in the period. */
  completed: number;
  /** Handed to the customer in the period («تم التسليم للزبون»). */
  handed: number;
};

/**
 * إدارة الورشة's cards: everybody who works the bench, then «غير مسند» when
 * any open ticket is nobody's. Work only — no money.
 */
export function workshopPeople(
  rows: readonly FigureRow[],
  people: readonly { userId: string; name: string; rank: "manager" | "assistant" | "technician" }[],
  bounds: Bounds,
): WorkshopPerson[] {
  const blank = (holderId: string | null, name: string, rank: WorkshopPerson["rank"]): WorkshopPerson => ({
    holderId,
    name,
    rank,
    open: 0,
    waiting: 0,
    opened: 0,
    completed: 0,
    handed: 0,
  });
  const cards = new Map<string, WorkshopPerson>(
    people.map((person) => [person.userId, blank(person.userId, person.name, person.rank)]),
  );
  for (const row of rows) {
    const stage = stageOf(row.status);
    if (stage === "request") continue;
    const key = row.holderId ?? "";
    let card = cards.get(key);
    if (!card) {
      card = blank(row.holderId, row.holderName ?? "", null);
      cards.set(key, card);
    }
    if (stage === "accepted" || stage === "waiting") card.open += 1;
    if (stage === "waiting") card.waiting += 1;
    if (withinBounds(row.createdAt, bounds)) card.opened += 1;
    if (row.completedAt && stage === "completed" && withinBounds(row.completedAt, bounds)) card.completed += 1;
    if (row.handedOverAt && withinBounds(row.handedOverAt, bounds)) card.handed += 1;
  }
  const nobody = cards.get("");
  return [
    ...[...cards.values()].filter((card) => card.holderId !== null),
    ...(nobody && nobody.open + nobody.opened + nobody.completed > 0 ? [nobody] : []),
  ];
}

/* ── كشف التذاكر's filters and search ────────────────────────────────────── */

/**
 * What narrows كشف التذاكر's list, all of it worked in the browser over the
 * period's rows — so a filter or a word typed changes the list at once, on
 * the site and in the desktop app alike.
 */
export type TicketFilters = {
  terms: PaymentTerms | null;
  /** An account id, `none` for nobody's, or null for everybody. */
  holder: string | null;
  /** «تم التسليم للزبون» — handed over, not yet, or either. */
  handed: "yes" | "no" | null;
  /** «المعدّلة» — changed after it was opened. */
  edited: boolean;
  /** «تذاكري» — held by the reader. */
  mine: boolean;
  search: string;
};

/** What the filters and the search read of a ticket. */
export type FilterableRow = {
  code: string;
  customerName: string;
  customerPhone: string;
  customerPhone2: string | null;
  deviceModel: string;
  notes: string | null;
  issues: readonly string[];
  customFaults: readonly string[];
  paymentTerms: PaymentTerms;
  holderId: string | null;
  handedOverAt?: string | null;
  editedAt?: string | null;
};

/** The words a ticket is found by, folded once. */
function haystack(row: FilterableRow): string {
  return normalizeSearch(
    [row.code, row.customerName, row.customerPhone, row.customerPhone2, row.deviceModel, row.notes, ...row.issues, ...row.customFaults]
      .filter(Boolean)
      .join(" "),
  );
}

export function filterTickets<R extends FilterableRow>(rows: readonly R[], filters: TicketFilters, viewerId: string): R[] {
  // Every word typed must be there; a number typed with spaces still finds
  // the number stored without them.
  const words = normalizeSearch(filters.search).split(" ").filter(Boolean);
  return rows.filter((row) => {
    if (filters.terms && row.paymentTerms !== filters.terms) return false;
    if (filters.holder && (filters.holder === "none" ? row.holderId !== null : row.holderId !== filters.holder)) return false;
    if (filters.handed === "yes" && !row.handedOverAt) return false;
    if (filters.handed === "no" && row.handedOverAt) return false;
    if (filters.edited && !row.editedAt) return false;
    if (filters.mine && row.holderId !== viewerId) return false;
    if (!words.length) return true;
    const hay = haystack(row);
    const tight = hay.replace(/ /g, "");
    return words.every((word) => hay.includes(word)) || tight.includes(words.join(""));
  });
}

/**
 * What a row says about the period beside its own facts: the money a ticket
 * from an earlier day took in it («سُدد في هذه الفترة»), its «مرتجع», and —
 * on the day it was opened — the later day it became «مكتمل», where its money
 * is.
 */
export function rowMarks(fact: RowFacts): {
  paidWithin: number | null;
  earlier: boolean;
  returned: ReturnSummary | null;
  completedLater: string | null;
} {
  return {
    paidWithin: fact.earlier && fact.paid !== 0 ? fact.paid : null,
    earlier: fact.earlier,
    returned: fact.returned,
    completedLater: fact.completedLater ? fact.completedAt : null,
  };
}
