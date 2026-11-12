import { useSyncExternalStore } from "react";
import type { DeskPageData, DeskPageParams } from "../../shared/desk-types";

/**
 * The board, read from this computer.
 *
 * ---------------------------------------------------------------------------
 * Why a store rather than a fetch in the page
 * ---------------------------------------------------------------------------
 * The page is re-read for three different reasons — the address changed (a
 * filter), the local database changed (a save here, a sync pass bringing a
 * colleague's change), and `router.refresh()` — and they arrive from three
 * different places. One store owns "what is on screen and what was last
 * asked for", so the reasons cannot race each other: an answer that arrives
 * for parameters the reader has already left is dropped rather than painted
 * over the newer one.
 *
 * ⚠️ The previous board stays on screen until the next arrives. A read is a
 * few milliseconds, so a skeleton between two filters would be a flash, and on
 * a slow first read the honest picture is the last true one rather than an
 * empty board that reads as "no tickets".
 */
type Snapshot = {
  /** The parameters `data` answers. */
  key: string | null;
  data: DeskPageData | null;
  loading: boolean;
  error: string | null;
};

let current: Snapshot = { key: null, data: null, loading: true, error: null };
let wanted: { key: string; params: DeskPageParams } | null = null;
let ticket = 0;
const listeners = new Set<() => void>();

function set(change: Partial<Snapshot>) {
  current = { ...current, ...change };
  for (const listener of listeners) listener();
}

function keyOf(params: DeskPageParams) {
  return JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
}

async function read() {
  if (!wanted) return;
  const { key, params } = wanted;
  const mine = ++ticket;
  set({ loading: true });
  try {
    const data = await window.desk.page(params);
    // A newer request has been made since — this answer is for a page the
    // reader has already left.
    if (mine !== ticket) return;
    set({ key, data, loading: false, error: null });
  } catch (error) {
    if (mine !== ticket) return;
    set({ loading: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Asks for the board for these parameters. `force` re-reads even when they are the ones on screen. */
export function requestPage(params: DeskPageParams, force = false) {
  const key = keyOf(params);
  if (!force && wanted?.key === key && current.key === key) return;
  wanted = { key, params };
  void read();
}

let pendingChange: ReturnType<typeof setTimeout> | null = null;

/**
 * Installed once. A sync pass can write dozens of rows; the main process
 * already folds them into one event every 60ms, and this folds a burst of
 * those into one read.
 */
export function watchDeskChanges(): () => void {
  return window.desk.onChanged(() => {
    if (pendingChange) return;
    pendingChange = setTimeout(() => {
      pendingChange = null;
      void read();
    }, 40);
  });
}

export const deskStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => current,
};

export function useDeskData(): Snapshot {
  return useSyncExternalStore(deskStore.subscribe, deskStore.snapshot, deskStore.snapshot);
}
