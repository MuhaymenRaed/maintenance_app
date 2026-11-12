import type { StatusEvent } from "@/lib/data/orders";
import type { HistoryKind } from "@/lib/queries/status-steps";

/**
 * `lib/actions/status-history.ts` — "when did this ticket become ready?".
 *
 * The one read the desk does not keep a local copy of. `status_events` is the
 * server's own trail, written by its triggers; it is history rather than work
 * in hand, nothing on this computer can add to it, and a ticket's whole trail
 * is a dozen rows asked for once, when somebody opens the panel.
 *
 * So this is a live read, and it is allowed to be unavailable:
 * `available: false` is the dialog saying so in words rather than drawing an
 * empty list that reads as "nothing ever happened". Offline, the last answer
 * for that ticket is served from `refs` — a trail that is a few minutes stale
 * is still the truth about last Tuesday.
 */
export function loadStatusHistory(
  kind: HistoryKind,
  id: string,
): Promise<{ available: boolean; events: StatusEvent[] }> {
  return window.desk.loadStatusHistory(kind, id);
}
