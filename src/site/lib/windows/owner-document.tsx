"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Which document a component is drawn into — the dashboard's own page, or a
 * ticket's detached window (see `components/admin/app-window.tsx`).
 *
 * ---------------------------------------------------------------------------
 * Why a component has to ask
 * ---------------------------------------------------------------------------
 * A detached window is a real browser window, opened with `window.open`, and
 * the editor inside it is still part of the dashboard's React tree: React
 * portals into the other window's `<body>`, so the form's state, its saves and
 * its live updates are exactly what they were. What does NOT follow is
 * anything that names the global `document` itself — and the dashboard's
 * pickers did, three ways:
 *
 * - a listbox portalled into `document.body` opened in the **main** window,
 *   behind the ticket the reader was typing in;
 * - "a press outside closes the list" listened on the main `document`, which
 *   never hears a press made in another window;
 * - a confirm dialog's Radix portal defaulted to the main `<body>` as well.
 *
 * So each of them asks this context where it is, and the answer defaults to
 * the page's own `document`: nothing outside a detached window changes.
 *
 * ⚠️ **Another window is another realm.** Its elements are instances of ITS
 * `Node`, so `target instanceof Node` against this window's `Node` is false —
 * a test that silently reads every press inside a detached picker as a press
 * outside it. Duck-type instead (`"nodeType" in target`).
 */
const OwnerDocumentContext = createContext<Document | null>(null);

/**
 * Draws `children` as part of `document`. Null passes straight through, for a
 * caller that only sometimes has a window to draw into — the print station,
 * whose panel follows the window the print was asked for from.
 */
export function OwnerDocumentProvider({ document: owner, children }: { document: Document | null; children: ReactNode }) {
  return <OwnerDocumentContext.Provider value={owner}>{children}</OwnerDocumentContext.Provider>;
}

/** The document to portal into and listen on. Null on the server. */
export function useOwnerDocument(): Document | null {
  const owner = useContext(OwnerDocumentContext);
  if (owner) return owner;
  return typeof document === "undefined" ? null : document;
}

/**
 * The detached window's document when drawn inside one, and null in the page
 * itself — for the components that behave differently there, not merely draw
 * somewhere else.
 */
export function useDetachedDocument(): Document | null {
  return useContext(OwnerDocumentContext);
}

/**
 * `doc` while its window is still open, and null otherwise — including for the
 * page's own document, which is the default everywhere already. So a caller
 * holding a detached window's document falls back to the page once the window
 * is closed, rather than drawing into a document nobody can see.
 */
export function liveDocument(doc: Document | null | undefined): Document | null {
  if (!doc || (typeof document !== "undefined" && doc === document)) return null;
  const view = doc.defaultView;
  return view && !view.closed ? doc : null;
}

/** A DOM node, from this window or another one. */
export function isDomNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).nodeType === "number";
}
