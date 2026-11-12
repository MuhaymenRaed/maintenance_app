/**
 * `lib/queries/status-steps.ts` — the one type the history panel imports.
 *
 * The site's module also probes which statuses this deployment can store
 * ("waiting for parts" arrives with `20261107_status_steps.sql`). That probe
 * runs in the main process here, once per sync, and its answer is already
 * folded into the page as `flow` — so the window never needs to ask.
 */
export type HistoryKind = "order" | "repair" | "trade_in";
