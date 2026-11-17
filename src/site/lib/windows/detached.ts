/**
 * Detached windows: a dashboard window opened as a real browser window, so
 * it stays on the desktop when the dashboard's own window is minimised.
 *
 * ---------------------------------------------------------------------------
 * Why
 * ---------------------------------------------------------------------------
 * The shop, 2026-11-17: the add-ticket and ticket windows must be separate
 * from the site's window — minimise the site and the ticket stays where it
 * is, and the same in the desktop app. An in-page window (`AppWindow`) cannot
 * do that: it is drawn inside the page, so it goes wherever the page goes.
 *
 * ---------------------------------------------------------------------------
 * How — and why not a page of its own
 * ---------------------------------------------------------------------------
 * The window is opened with `window.open("")` and the dashboard's React tree
 * renders INTO it through a portal. Nothing about the form moves: its state,
 * its saves, the board's live updates and the print station are exactly the
 * ones the in-page window had, because it is the same component in the same
 * tree. A route of its own per window would have meant a second copy of the
 * ticket's data loading, its permissions and its sync, on the site and again
 * in the desktop app — and two copies of a ticket's state that have to agree.
 *
 * What the portal does not carry is the page's look, so this module gives the
 * new document the dashboard's stylesheets, its `<html>` attributes (the
 * theme, the direction, the fonts) and keeps them in step as they change.
 *
 * ⚠️ The window lives as long as the dashboard page that opened it. Close or
 * reload the dashboard and its windows close with it (`pagehide` below) — a
 * window whose React tree is gone would be an empty frame with a title.
 *
 * Pure DOM, no React: `components/admin/app-window.tsx` reads it through a
 * small store, the shape `lib/windows/window-store.ts` already uses.
 */

export type DetachedState =
  | { status: "open"; win: Window; root: HTMLElement }
  | { status: "blocked" };

type Entry = {
  state: DetachedState;
  /** A close scheduled by an unmount, cancelled by an immediate remount. */
  closeTimer: number | null;
  /** Stops the style mirror and the watchers. */
  dispose: () => void;
  /** The owner's own close, run when the operating system closes the window. */
  onGone: (() => void) | null;
  /** Ask before the window is closed from its own title bar. */
  confirmLeave: boolean;
  /** We are closing it ourselves — no question, and no "gone" report. */
  closing: boolean;
  kind: string;
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** Moves on every change, for a reader that cares that a window came or went, not which. */
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

export const detachedStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get(id: string): DetachedState | null {
    return entries.get(id)?.state ?? null;
  },
  version: () => version,
};

/**
 * A desk: a wide screen driven by a mouse. A phone or a tablet opens a
 * pop-up as a tab, which is no window at all, so there the in-page window
 * stays. Same line the storefront's `desk` variant draws.
 */
export function canDetach(): boolean {
  if (typeof window === "undefined" || window.top !== window) return false;
  return window.matchMedia("(min-width: 64rem) and (pointer: fine)").matches;
}

/** One size remembered per kind of window: every ticket, every new ticket. */
function kindOf(id: string): string {
  return id.split(":")[0].replace(/-?\d+$/, "").replace(/-(hardware|software)$/, "") || "window";
}

const SIZE_KEY = "al-esnad:detached-size:";

function rememberedSize(kind: string): { w: number; h: number } | null {
  try {
    const raw = localStorage.getItem(SIZE_KEY + kind);
    if (!raw) return null;
    const size = JSON.parse(raw) as { w?: unknown; h?: unknown };
    return typeof size.w === "number" && typeof size.h === "number" ? { w: size.w, h: size.h } : null;
  } catch {
    return null;
  }
}

function rememberSize(kind: string, win: Window) {
  try {
    if (win.outerWidth > 0 && win.outerHeight > 0) {
      localStorage.setItem(SIZE_KEY + kind, JSON.stringify({ w: win.outerWidth, h: win.outerHeight }));
    }
  } catch {
    // Not remembered; the next window opens at its own size.
  }
}

/** Where a new window lands: over the dashboard, a step down from the last. */
function features(width: number, height: number): string {
  const avail = { w: screen.availWidth || 1280, h: screen.availHeight || 800 };
  const w = Math.round(Math.max(420, Math.min(width, avail.w - 40)));
  const h = Math.round(Math.max(360, Math.min(height, avail.h - 40)));
  const step = (entries.size % 6) * 28;
  const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - w) / 2) + step);
  const top = Math.round(window.screenY + 60 + step);
  return `popup=yes,width=${w},height=${h},left=${left},top=${top}`;
}

/** The `<html>` attributes that carry the theme, the direction and the fonts. */
const ROOT_ATTRIBUTES = ["class", "dir", "lang", "style", "data-theme"];

function copyRoot(from: HTMLElement, to: HTMLElement) {
  for (const name of ROOT_ATTRIBUTES) {
    const value = from.getAttribute(name);
    if (value === null) to.removeAttribute(name);
    else to.setAttribute(name, value);
  }
}

function isStyle(node: Node): node is HTMLLinkElement | HTMLStyleElement {
  if (node.nodeName === "STYLE") return true;
  return node.nodeName === "LINK" && (node as HTMLLinkElement).rel === "stylesheet";
}

function cloneStyle(node: HTMLLinkElement | HTMLStyleElement, into: Document): Node {
  const clone = into.importNode(node, true) as HTMLLinkElement | HTMLStyleElement;
  // Absolute, so the address does not depend on what a blank page thinks its base is.
  if (node.nodeName === "LINK") clone.setAttribute("href", (node as HTMLLinkElement).href);
  return clone;
}

/**
 * Gives the new document the page's look and keeps it in step: a stylesheet
 * the dashboard loads later — a lazily loaded chunk, a hot reload — and a
 * theme switch made while the window is open.
 */
function mirror(doc: Document): () => void {
  const clones = new Map<Node, Node>();
  for (const node of document.head.childNodes) {
    if (!isStyle(node)) continue;
    const clone = cloneStyle(node, doc);
    clones.set(node, clone);
    doc.head.appendChild(clone);
  }
  copyRoot(document.documentElement, doc.documentElement);
  doc.body.className = document.body.className;

  const heads = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!isStyle(node) || clones.has(node)) continue;
        const clone = cloneStyle(node, doc);
        clones.set(node, clone);
        doc.head.appendChild(clone);
      }
      for (const node of record.removedNodes) {
        const clone = clones.get(node);
        if (clone?.parentNode) clone.parentNode.removeChild(clone);
        clones.delete(node);
      }
    }
  });
  heads.observe(document.head, { childList: true });
  const root = new MutationObserver(() => copyRoot(document.documentElement, doc.documentElement));
  root.observe(document.documentElement, { attributes: true, attributeFilter: ROOT_ATTRIBUTES });
  return () => {
    heads.disconnect();
    root.disconnect();
  };
}

let unloadHooked = false;

/** The dashboard is going: its windows go with it, rather than stay as empty frames. */
function hookUnload() {
  if (unloadHooked) return;
  unloadHooked = true;
  window.addEventListener("pagehide", () => {
    for (const id of [...entries.keys()]) closeNow(id);
  });
}

/**
 * Opens the window for `id`, or hands back the one already open. Must run in
 * the commit of the press that asked for it — a browser opens a pop-up only
 * while that press's activation lasts — which is why the owner calls it from
 * a layout effect of the component the press mounted.
 */
export function openDetached(
  id: string,
  { title, width, height }: { title: string; width: number; height: number },
): DetachedState {
  const existing = entries.get(id);
  if (existing) {
    if (existing.closeTimer !== null) {
      window.clearTimeout(existing.closeTimer);
      existing.closeTimer = null;
    }
    if (existing.state.status === "blocked" || !existing.state.win.closed) return existing.state;
    existing.dispose();
    entries.delete(id);
  }

  const kind = kindOf(id);
  const size = rememberedSize(kind) ?? { w: width, h: height };
  let win: Window | null = null;
  try {
    win = window.open("", `alesnad-win-${id.replace(/[^a-zA-Z0-9_-]+/g, "-")}`, features(size.w, size.h));
  } catch {
    win = null;
  }

  if (!win) {
    const state: DetachedState = { status: "blocked" };
    entries.set(id, { state, closeTimer: null, dispose: () => {}, onGone: null, confirmLeave: false, closing: false, kind });
    emit();
    return state;
  }

  const doc = win.document;
  // Standards mode: a fresh blank page has no doctype, and quirks mode lays a
  // table and a body out differently from the page the styles were written for.
  doc.open();
  doc.write(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title></title></head><body></body></html>',
  );
  doc.close();
  doc.title = title;
  const stopMirror = mirror(doc);
  const root = doc.createElement("div");
  root.id = "window-root";
  doc.body.appendChild(root);

  const opened = win;
  const entry: Entry = {
    state: { status: "open", win: opened, root },
    closeTimer: null,
    dispose: () => {},
    onGone: null,
    confirmLeave: false,
    closing: false,
    kind,
  };

  // Closed from its own title bar. Ask first when it is a form — the browser's
  // own "leave?" — and tell the owner once it has really gone.
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (entry.closing || !entry.confirmLeave) return;
    event.preventDefault();
    event.returnValue = "";
  };
  const gone = () => {
    if (entry.closing || entries.get(id) !== entry) return;
    rememberSize(kind, opened);
    entry.closing = true;
    entry.onGone?.();
  };
  opened.addEventListener("beforeunload", beforeUnload);
  opened.addEventListener("pagehide", gone);
  // A belt for a window that went without a `pagehide`.
  const poll = window.setInterval(() => {
    if (opened.closed) gone();
  }, 1000);

  entry.dispose = () => {
    window.clearInterval(poll);
    stopMirror();
    try {
      opened.removeEventListener("beforeunload", beforeUnload);
      opened.removeEventListener("pagehide", gone);
    } catch {
      // Already gone.
    }
  };
  entries.set(id, entry);
  hookUnload();
  emit();
  return entry.state;
}

/** The owner's say on its window: what to run when the OS closes it, and whether to ask first. */
export function bindDetached(id: string, binding: { onGone: () => void; confirmLeave: boolean }) {
  const entry = entries.get(id);
  if (!entry) return;
  entry.onGone = binding.onGone;
  entry.confirmLeave = binding.confirmLeave;
}

/** What the window is called — on its frame and on the taskbar. */
export function titleDetached(id: string, title: string) {
  const state = entries.get(id)?.state;
  if (state?.status === "open" && !state.win.closed) state.win.document.title = title;
}

/** Brings the window above the others on the desktop. */
export function raiseDetached(id: string) {
  const state = entries.get(id)?.state;
  if (state?.status !== "open" || state.win.closed) return;
  try {
    state.win.focus();
  } catch {
    // A window the browser will not raise is still open where it was.
  }
}

/**
 * The owner unmounted. Closed a moment later rather than at once, so an
 * owner that mounts again straight away — StrictMode in development, a list
 * re-keyed — keeps the window it already had instead of losing it and having
 * no user activation left to open another.
 */
export function releaseDetached(id: string) {
  const entry = entries.get(id);
  if (!entry || entry.closeTimer !== null) return;
  entry.closeTimer = window.setTimeout(() => closeNow(id), 150);
}

function closeNow(id: string) {
  const entry = entries.get(id);
  if (!entry) return;
  entries.delete(id);
  if (entry.closeTimer !== null) window.clearTimeout(entry.closeTimer);
  entry.closing = true;
  entry.dispose();
  if (entry.state.status === "open" && !entry.state.win.closed) {
    rememberSize(entry.kind, entry.state.win);
    entry.state.win.close();
  }
  emit();
}
