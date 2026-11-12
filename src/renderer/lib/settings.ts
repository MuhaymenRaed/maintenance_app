import { useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, type AppSettings } from "../../shared/contract";

/**
 * The app's settings, as the window reads them.
 *
 * One copy for the whole window, outside React, distributed by
 * `useSyncExternalStore` — the shape the dashboard uses for the cart, the
 * session and the print station, and the one the React Compiler allows: a
 * `setState` in an effect mirroring external state is an error in this
 * codebase, and these change from the main process as well as from this page
 * (the tray, another window, the settings file).
 *
 * The main process owns them. Everything here either reads the snapshot or
 * asks it to write, and the answer arrives back through `onSettings` —
 * so a save made in the settings panel reaches the title bar, the provider and
 * the board without any of them being told about each other.
 */
let current: AppSettings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * The first read, awaited before the window draws anything.
 *
 * ⚠️ Not a fetch inside a component. The locale decides the page's direction
 * and the theme decides its palette, so a first paint from `DEFAULT_SETTINGS`
 * would be an English left-to-right light flash on an Arabic dark desk — the
 * flash `ThemeScript` exists to prevent on the site, met again here.
 */
export function primeSettings(settings: AppSettings) {
  current = settings;
  emit();
}

/** Live updates from the main process: the tray, the settings file, another save. */
export function watchSettings() {
  return window.desk.onSettings((settings) => {
    current = settings;
    emit();
  });
}

export const settingsStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => current,
};

export function useSettings(): AppSettings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.snapshot);
}

/** What the rest of the window reads when it is not a component. */
export function readSettings(): AppSettings {
  return current;
}

/**
 * Writes, and takes the main process's answer as the truth.
 *
 * The reply is the whole, cleaned settings — a figure out of range comes back
 * clamped — so the control that sent it ends up showing what was actually
 * stored rather than what it asked for.
 */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const settings = await window.desk.setSettings(patch);
  current = settings;
  emit();
  return settings;
}
