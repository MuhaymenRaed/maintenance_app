/**
 * The maintenance section's six tabs and its ticket lists, as plain data.
 *
 * ⚠️ They live here rather than beside the tab bar because the page that
 * reads the address is a Server Component. Exported from a `"use client"`
 * file, these lists are client references on the server, and
 * `DESK_TABS.includes(...)` threw on every load of /admin/repairs and
 * /admin/programming (2026-11-25). `lib/data/client-boundary.test.ts` holds
 * the rule for every file.
 */

/** «إضافة تذكرة» is a press, not a tab, so it is not in this list. */
export type DeskTab = "tickets" | "cash" | "profit" | "workshop" | "settings";

export const DESK_TABS: readonly DeskTab[] = ["tickets", "cash", "profit", "workshop", "settings"];

export type TicketList = "all" | "completed" | "incomplete" | "cancelled" | "returned" | "owing" | "requests";

export const TICKET_LISTS: readonly TicketList[] = ["all", "completed", "incomplete", "cancelled", "returned", "owing", "requests"];
