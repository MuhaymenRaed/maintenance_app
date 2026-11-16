import { normalizeSearch } from "../search.ts";

/**
 * A ticket's faults, as the two desks pick them — on the site and in the desk
 * app, which vendors this file. Pure, so both halves and the tests read one
 * copy.
 *
 * ---------------------------------------------------------------------------
 * What the shop asked for on 2026-11-16
 * ---------------------------------------------------------------------------
 * - **A fault typed at the counter joins the list.** It used to be free text on
 *   one ticket (`custom_faults`), so the next ticket with the same fault had it
 *   typed again. Now the picker offers "add ‹name› as a new fault"; until the
 *   ticket is saved the choice is the value `new:<name>`, and the save files it
 *   on the bench's own list (`add_repair_issue`), where every ticket after it
 *   is offered it like any other.
 * - **The list opens on what the bench used last.** `faultOptions` orders the
 *   bench's faults by their most recent ticket, then the rest in the list's own
 *   order, and ranks a search the same way — the counter sees the same dozen
 *   faults all day, and they should be the first rows rather than the fifth.
 * - **A ticket's faults can be changed after it is opened**
 *   (`set_repair_faults`), so a second fault found on the bench is added to the
 *   ticket instead of opening another one.
 *
 * ⚠️ `custom_faults` is not gone. Tickets written before this carry it, so it
 * is still read, drawn and printed; the ticket editor shows those as `old:`
 * chips that can be removed.
 */

/** `book_repair`'s bound on a booking, and `set_repair_faults`' on an edit. */
export const MAX_TICKET_FAULTS = 8;

/** A fault typed in the picker that is not on the list yet. */
const NEW = "new:";
/** One of a ticket's old typed faults (`custom_faults`), shown in the editor. */
const OLD = "old:";

/** How a fault's name is stored: one space between words, at most 80 letters. */
export function cleanFaultName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * What two spellings of one fault have in common — the picker's own folding
 * (case, hamza and alef forms, ta marbuta), so "شاشه" and "شاشة" are one fault.
 */
export function faultKey(name: string): string {
  return normalizeSearch(cleanFaultName(name));
}

export const newFaultValue = (name: string) => `${NEW}${cleanFaultName(name)}`;
export const oldFaultValue = (text: string) => `${OLD}${text}`;
export const isNewFault = (value: string) => value.startsWith(NEW);
export const isOldFault = (value: string) => value.startsWith(OLD);
/** The words a `new:` or `old:` value carries; the value itself otherwise. */
export const faultText = (value: string) =>
  isNewFault(value) ? value.slice(NEW.length) : isOldFault(value) ? value.slice(OLD.length) : value;

/** A picker's values, sorted into what each write takes. */
export function splitFaults(values: readonly string[]): {
  /** Codes already on the list. */
  codes: string[];
  /** Names to file on the list first. */
  names: string[];
  /** The ticket's old typed faults that stay. */
  old: string[];
} {
  const codes: string[] = [];
  const names: string[] = [];
  const old: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (isOldFault(value)) {
      const text = faultText(value).trim();
      if (text && !old.includes(text)) old.push(text);
    } else if (isNewFault(value)) {
      const name = cleanFaultName(faultText(value));
      const key = faultKey(name);
      if (name.length >= 2 && !seen.has(key)) {
        seen.add(key);
        names.push(name);
      }
    } else if (value.trim() && !codes.includes(value)) {
      codes.push(value);
    }
  }
  return { codes, names, old };
}

/** How many faults the list will hold for this ticket — old typed ones carry no code. */
export const codedFaultCount = (values: readonly string[]) =>
  values.filter((value) => !isOldFault(value)).length;

/** One ticket's faults and when it was opened. */
export type FaultUse = { codes: readonly string[]; at: string };
/** A fault the bench used lately, with its last ticket. */
export type RecentFault = { code: string; at: string; uses: number };

/**
 * Each fault's most recent ticket, newest first, and how often it came up —
 * from the bench's latest tickets, in any order.
 */
export function recentFaultsFrom(tickets: readonly FaultUse[]): RecentFault[] {
  const byCode = new Map<string, RecentFault>();
  for (const ticket of tickets) {
    for (const code of new Set(ticket.codes)) {
      if (!code) continue;
      const seen = byCode.get(code);
      if (!seen) byCode.set(code, { code, at: ticket.at, uses: 1 });
      else {
        seen.uses += 1;
        if (ticket.at > seen.at) seen.at = ticket.at;
      }
    }
  }
  return [...byCode.values()].sort(
    (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.uses - a.uses),
  );
}

/** An option the fault picker draws. */
export type FaultOption = { value: string; label: string; rank?: number };

/**
 * The bench's faults for the picker, most recently used first.
 *
 * `extra` is faults a ticket already carries that the bench's list does not —
 * a retired fault, one from the other bench — so its chip has a name; they
 * come after the list, because nobody should be offered them first.
 *
 * `rank` is a recent fault's place, so a search ranks the recent ones first
 * too (see `SearchableOption.rank`); a fault nobody used lately has none.
 */
export function faultOptions({
  issues,
  recent,
  extra = [],
}: {
  issues: readonly { code: string; name: string }[];
  recent: readonly RecentFault[];
  extra?: readonly { code: string; name: string }[];
}): FaultOption[] {
  const place = new Map(recent.map((fault, index) => [fault.code, index]));
  const listed = issues.map((issue, order) => ({ issue, order, at: place.get(issue.code) }));
  listed.sort((a, b) => {
    if (a.at !== undefined && b.at !== undefined) return a.at - b.at;
    if (a.at !== undefined) return -1;
    if (b.at !== undefined) return 1;
    return a.order - b.order;
  });
  const options: FaultOption[] = listed.map(({ issue, at }) => ({
    value: issue.code,
    label: issue.name,
    ...(at !== undefined ? { rank: at } : {}),
  }));
  const known = new Set(options.map((option) => option.value));
  for (const issue of extra) {
    if (known.has(issue.code)) continue;
    known.add(issue.code);
    options.push({ value: issue.code, label: issue.name });
  }
  return options;
}

/**
 * The value a typed fault becomes: the fault already on the list when one is
 * spelt the same way, so a fault is never filed twice; a `new:` value
 * otherwise. Null for something too short to be a fault.
 */
export function valueForTyped(
  typed: string,
  options: readonly { value: string; label: string }[],
): string | null {
  const name = cleanFaultName(typed);
  if (name.length < 2) return null;
  const key = faultKey(name);
  const match = options.find((option) => faultKey(option.label) === key);
  return match ? match.value : newFaultValue(name);
}
