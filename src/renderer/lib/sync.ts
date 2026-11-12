import { useSyncExternalStore } from "react";
import type { SyncStatus } from "../../shared/contract";

/**
 * Where the desk stands with the server — online, what is waiting, what was
 * refused — for the title bar's pill, the sync panel and the first-run screen.
 *
 * The main process owns the engine and pushes every change of state
 * (`onSyncStatus`); this keeps the last one and hands it to whichever
 * component is drawing. Nothing here polls.
 */
const STARTING: SyncStatus = {
  state: "starting",
  online: navigator.onLine,
  signedIn: false,
  account: null,
  lastPullAt: null,
  lastPushAt: null,
  pending: 0,
  failed: 0,
  lastError: null,
  hasData: false,
  ticketCount: 0,
  nextRunAt: null,
};

let current: SyncStatus = STARTING;
const listeners = new Set<() => void>();

function set(status: SyncStatus) {
  current = status;
  for (const listener of listeners) listener();
}

/** Installed once, by `main.tsx`. */
export function watchSync(): () => void {
  void window.desk.syncStatus().then(set);
  return window.desk.onSyncStatus(set);
}

export const syncStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => current,
};

export function useSync(): SyncStatus {
  return useSyncExternalStore(syncStore.subscribe, syncStore.snapshot, syncStore.snapshot);
}

/** "Sync now" — and the answer is the state it left things in. */
export async function syncNow(): Promise<SyncStatus> {
  const status = await window.desk.syncNow();
  set(status);
  return status;
}
