/**
 * `lib/queries/repair-desk.ts` — types only.
 *
 * On the site this is the server read that builds the desk's data. Here the
 * data is built by the main process from the local database
 * (`src/main/desk/board.ts`) and arrives whole through `window.desk.page()`.
 * What the copied components still import from this path is the *shape* of
 * it, so that is all this module is — the shared definitions, under the name
 * they have always had.
 *
 * ⚠️ Types only, and it must stay that way. A value exported here would be the
 * first thing in the window that looks like a query, and the next sync would
 * have something to reach for that does not exist.
 */
export type {
  DeskAvailability,
  DeskData,
  DeskPerson,
  DeskRow,
  DeskScope,
  RepairCard,
  RepairFulfillment,
  RowSync,
} from "../../../../shared/desk-types";
