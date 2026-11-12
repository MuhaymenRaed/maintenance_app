import { DEFAULT_SETTINGS, parseSettings, type StationSettings } from "@/lib/print/station-settings";

/**
 * The print station's settings for this browser, as a store
 * `useSyncExternalStore` can read — the shape `lib/cart` and
 * `lib/auth/session-store` already use, and the reason is the same:
 * `react-hooks/set-state-in-effect` is an error here, and storage is state
 * outside React.
 *
 * ⚠️ The server snapshot is the defaults and the first client render reads
 * storage, so a component drawing these must tolerate one frame of defaults —
 * nothing here is drawn on a prerendered page, so there is no hydration to
 * mismatch.
 */

const KEY = "al-esnad:print-station:v1";

let current: StationSettings | null = null;
const listeners = new Set<() => void>();

function load(): StationSettings {
  if (current) return current;
  try {
    current = parseSettings(localStorage.getItem(KEY));
  } catch {
    current = DEFAULT_SETTINGS;
  }
  return current;
}

export function stationSettings(): StationSettings {
  return typeof window === "undefined" ? DEFAULT_SETTINGS : load();
}

export function saveStationSettings(next: StationSettings) {
  current = parseSettings(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not remembered past this page; the choice still applies to it.
  }
  for (const listener of listeners) listener();
}

export function updateStationSettings(change: (settings: StationSettings) => StationSettings) {
  saveStationSettings(change(stationSettings()));
}

export const stationSettingsStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: stationSettings,
  server: () => DEFAULT_SETTINGS,
};
