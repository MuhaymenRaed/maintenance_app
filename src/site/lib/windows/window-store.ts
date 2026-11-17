/**
 * The dashboard's open windows — which exist, which is in front, which are
 * folded into the dock.
 *
 * ---------------------------------------------------------------------------
 * Why a module store and not React state
 * ---------------------------------------------------------------------------
 * A window is opened by whatever board owns it — the repair desk opens a
 * ticket, the inventory opens a product — and each of those boards keeps its
 * own form state, because that is where the fields and the save live. What no
 * board can know is *the others*: which window is in front, how many are open,
 * where the next one should land so it does not sit exactly on the last. That
 * is one fact for the whole page, so it lives here, outside React, and is read
 * through `useSyncExternalStore` — the shape `lib/print/station.ts` and
 * `lib/cart` already use for state that outlives any one component.
 *
 * The windows themselves are still rendered by their boards (see
 * `components/admin/app-window.tsx`); this only holds what they share. A board
 * that unmounts takes its windows with it, which is the right blast radius.
 *
 * ⚠️ Pure TypeScript, no React and no DOM at import time: the desktop app
 * vendors this file, and a module that touched `document` on import would
 * throw in its tests.
 */

export type WindowEntry = {
  id: string;
  title: string;
  subtitle?: string;
  /** A hairline of colour on the dock chip — the window's own accent. */
  accent?: string;
  minimized: boolean;
  /** Stacking order. Higher is in front; reassigned on every focus. */
  z: number;
  /** Order of opening, for the dock — a chip must not jump when focus moves. */
  opened: number;
  /** The window's own close: asks first when the window is a form. */
  requestClose: () => void;
  /**
   * A detached window — a real browser window of its own (see
   * `components/admin/app-window.tsx`). The operating system minimises and
   * stacks it, so the dock never folds it; it only brings it forward.
   */
  detached?: boolean;
  /** Raises a detached window above the others on the desktop. */
  raise?: () => void;
};

type Listener = () => void;

const entries = new Map<string, WindowEntry>();
let list: WindowEntry[] = [];
let top = 0;
let opened = 0;
const listeners = new Set<Listener>();

function emit() {
  list = [...entries.values()].sort((a, b) => a.opened - b.opened);
  for (const listener of listeners) listener();
}

export const windowStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Every open window, in the order they were opened. Stable between changes. */
  snapshot(): WindowEntry[] {
    return list;
  },
  /** The server has no windows. One frozen array, so React sees no change. */
  server(): WindowEntry[] {
    return EMPTY;
  },
  get(id: string): WindowEntry | undefined {
    return entries.get(id);
  },
  /** How many are open now — the cascade offset for the next one. */
  count(): number {
    return entries.size;
  },
  /** The window in front, or null when every one is folded away. */
  front(): string | null {
    let best: WindowEntry | null = null;
    for (const entry of entries.values()) {
      if (entry.minimized) continue;
      if (!best || entry.z > best.z) best = entry;
    }
    return best?.id ?? null;
  },
  register(
    id: string,
    init: Pick<WindowEntry, "title" | "subtitle" | "accent" | "requestClose" | "detached" | "raise">,
  ) {
    const existing = entries.get(id);
    entries.set(id, {
      id,
      title: init.title,
      subtitle: init.subtitle,
      accent: init.accent,
      requestClose: init.requestClose,
      detached: init.detached,
      raise: init.raise,
      minimized: existing?.minimized ?? false,
      z: ++top,
      opened: existing?.opened ?? ++opened,
    });
    emit();
  },
  unregister(id: string) {
    if (!entries.delete(id)) return;
    emit();
  },
  patch(id: string, change: Partial<Pick<WindowEntry, "title" | "subtitle" | "accent">>) {
    const entry = entries.get(id);
    if (!entry) return;
    if (
      entry.title === change.title &&
      entry.subtitle === change.subtitle &&
      entry.accent === change.accent
    ) {
      return;
    }
    entries.set(id, { ...entry, ...change });
    emit();
  },
  /** Bring a window to the front, unfolding it if it was in the dock. */
  focus(id: string) {
    const entry = entries.get(id);
    if (!entry) return false;
    // Asked every time, not only on a change: the board presses a row whose
    // window is already "in front" here and buried on the desktop.
    entry.raise?.();
    if (!entry.minimized && entry.z === top) return true;
    entries.set(id, { ...entry, minimized: false, z: ++top });
    emit();
    return true;
  },
  minimize(id: string) {
    const entry = entries.get(id);
    if (!entry || entry.minimized) return;
    entries.set(id, { ...entry, minimized: true });
    emit();
  },
  /** The dock's press: unfold, bring forward, or fold the one already in front. */
  toggle(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    if (!entry.detached && !entry.minimized && windowStore.front() === id) windowStore.minimize(id);
    else windowStore.focus(id);
  },
};

const EMPTY: WindowEntry[] = [];
