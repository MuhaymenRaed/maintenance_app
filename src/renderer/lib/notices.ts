import { useSyncExternalStore } from "react";
import type { AppNotice } from "../../shared/contract";

/**
 * The desk's own bell: new tickets, a change a colleague made, a change the
 * server refused, the line dropping and coming back.
 *
 * Kept by the main process in the local database (so the list survives a
 * restart) and raised there, because that is where the sync engine sees the
 * news; it also puts the important ones in the Windows tray when the window
 * is not focused. This is the window's copy of the list.
 */
let current: AppNotice[] = [];
const listeners = new Set<() => void>();

function set(list: AppNotice[]) {
  current = list;
  for (const listener of listeners) listener();
}

export function watchNotices(): () => void {
  void window.desk.notices().then(set);
  return window.desk.onNotice((notice) => {
    // Newest first, and never the same notice twice — a reconnect can replay.
    set([notice, ...current.filter((existing) => existing.id !== notice.id)].slice(0, 200));
  });
}

export const noticeStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => current,
};

export function useNotices(): AppNotice[] {
  return useSyncExternalStore(noticeStore.subscribe, noticeStore.snapshot, noticeStore.snapshot);
}

/** Marks the ones the reader saw — never "everything", which would include one that just arrived. */
export async function markRead(ids: number[]) {
  if (!ids.length) return;
  await window.desk.markNoticesRead(ids);
  const seen = new Set(ids);
  set(current.map((notice) => (seen.has(notice.id) ? { ...notice, read: true } : notice)));
}

export async function clearAll() {
  await window.desk.clearNotices();
  set([]);
}
