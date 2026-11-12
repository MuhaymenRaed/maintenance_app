/**
 * One colour vocabulary for every lifecycle in the app.
 *
 * Shared rather than duplicated because the pill on a row and the bar in the
 * breakdown beside it are the *same* fact rendered twice — if they can drift,
 * eventually they will, and a green bar next to an amber pill is worse than no
 * chart at all.
 *
 * The tone is derived from what a state *means*, not from a per-domain table,
 * so "cancelled" reads the same red whether it ended an order, a repair or a
 * trade-in, and a status added to any enum still lands somewhere sane.
 *
 * These are reserved status colours: they are never handed out as "series 4",
 * and nothing that uses them may rely on colour alone — every bar and pill
 * carries its label as text.
 */

export type StatusTone = "good" | "progress" | "waiting" | "bad";

const GOOD = new Set(["delivered", "completed", "approved", "ready"]);
const BAD = new Set(["cancelled", "declined", "void", "write_off"]);
// `waiting_parts` waits on a supplier, which is the same amber as waiting on a
// customer; `preparing` and `inspecting` are hands on the work and fall
// through to "progress".
const WAITING = new Set([
  "review",
  "pending",
  "quote_sent",
  "received",
  "waiting_parts",
]);

export function statusTone(status: string): StatusTone {
  if (BAD.has(status)) return "bad";
  if (GOOD.has(status)) return "good";
  if (WAITING.has(status)) return "waiting";
  return "progress";
}

/** The CSS custom property each tone paints with, for inline SVG fills. */
export const TONE_VAR: Record<StatusTone, string> = {
  good: "var(--success)",
  progress: "var(--info)",
  waiting: "var(--warning)",
  bad: "var(--brand)",
};

/** Tailwind classes for a soft chip in the same tone. */
export const TONE_CHIP: Record<StatusTone, string> = {
  good: "bg-success/12 text-success",
  progress: "bg-info/12 text-info",
  waiting: "bg-warning/14 text-warning",
  bad: "bg-brand/12 text-brand",
};
