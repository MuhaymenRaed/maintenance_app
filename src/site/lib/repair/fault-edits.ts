/**
 * Faults renamed or taken off the bench's list on this page, until the page's
 * own list catches up.
 *
 * The list reaches a picker as a prop, read when the board was drawn; a rename
 * made from one picker has to show in every picker on the page at once — the
 * counter's "add a ticket" and every open ticket window — without waiting for
 * a refresh. So the edits live here, outside React, and each picker lays them
 * over the list it was given. A refresh that brings the new names makes them
 * redundant, never wrong.
 *
 * ⚠️ Pure TypeScript, no React and no DOM at import time: the desktop app
 * vendors this file.
 */

export type FaultEdit = { name?: string; retired?: boolean };

type Listener = () => void;

let edits: ReadonlyMap<string, FaultEdit> = new Map();
const listeners = new Set<Listener>();

export const faultEdits = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot(): ReadonlyMap<string, FaultEdit> {
    return edits;
  },
  server(): ReadonlyMap<string, FaultEdit> {
    return EMPTY;
  },
  renamed(code: string, name: string) {
    edits = new Map(edits).set(code, { ...edits.get(code), name });
    for (const listener of listeners) listener();
  },
  retired(code: string) {
    edits = new Map(edits).set(code, { ...edits.get(code), retired: true });
    for (const listener of listeners) listener();
  },
};

const EMPTY: ReadonlyMap<string, FaultEdit> = new Map();

/** The list with this page's edits laid over it. */
export function withFaultEdits<T extends { code: string; name: string }>(
  issues: readonly T[],
  overrides: ReadonlyMap<string, FaultEdit>,
  /** Codes a ticket already carries: kept, retired or not, so their chips keep a name. */
  keep: readonly string[] = [],
): T[] {
  if (!overrides.size) return issues as T[];
  return issues.flatMap((issue) => {
    const edit = overrides.get(issue.code);
    if (!edit) return [issue];
    if (edit.retired && !keep.includes(issue.code)) return [];
    return [edit.name ? { ...issue, name: edit.name } : issue];
  });
}
