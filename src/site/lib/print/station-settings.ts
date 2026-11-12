/**
 * The print station's settings — per computer, kept in that browser.
 *
 * Everything here is a fact about the machine at the counter: which Windows
 * queue is the Canon, which is the label printer, how tall the label roll is,
 * how dark the head should burn. None of it is the deployment's business, and
 * a laptop that prints through the browser dialog has none of it at all. So
 * it lives in `localStorage` (see `lib/print/station-store.ts`) and this file
 * is the pure half: the shape, the defaults, and a parser that accepts
 * whatever storage hands back and returns something safe to print with.
 *
 * Imports nothing, so `node --test` loads it as it is.
 */

/** `agent` prints through the print agent on this PC; `dialog` through the browser's own dialog. */
export type StationMethod = "agent" | "dialog";
export type LabelMode = "tspl" | "driver";
/** `gap` is die-cut labels on a liner; `continuous` is one long strip. */
export type LabelMedia = "gap" | "continuous";

export type LabelSettings = {
  /**
   * How the label reaches the printer. `tspl` sends the printer's own
   * language straight through the queue, past the driver — what the LPQ58
   * speaks, whichever driver Windows put it on. `driver` hands Windows a
   * picture and lets the driver decide.
   */
  mode: LabelMode;
  media: LabelMedia;
  widthMm: number;
  /** The die-cut label's height; ignored on continuous paper. */
  heightMm: number;
  gapMm: number;
  /** How many dots the head can reach across — 448 is the LPQ58's 56 mm. */
  headDots: number;
  /** Heat, 0 – 15. Higher is darker and wears the head faster. */
  density: number;
  /** Inches per second. Slower is darker. */
  speed: number;
  /** Print upside down, for a printer that feeds the other way round. */
  rotate: boolean;
  /** Calibration, in dots: positive moves the print further along. */
  shiftX: number;
  shiftY: number;
  /** 1 – 254: under it a pixel prints. Higher draws heavier strokes. */
  threshold: number;
  /** For firmware that reads TSPL's bitmap bits the other way round. */
  invert: boolean;
};

export type StationSettings = {
  version: 1;
  method: StationMethod;
  /** Queue names. `null` means "detect it" — never "the Windows default". */
  printers: { a5: string | null; label: string | null };
  /** Refuse to send to a printer that reports itself offline. */
  checkStatus: boolean;
  /** How long to wait for the spooler's word before saying "no confirmation". */
  confirmSeconds: number;
  label: LabelSettings;
  a5: {
    /**
     * `page` fits the receipt to what the printer can reach, so a printer
     * that cannot print to the edge shrinks it a few per cent rather than
     * cutting it. `actual` prints at exactly A5, trusting the margins.
     */
    fit: "page" | "actual";
  };
};

export const DEFAULT_SETTINGS: StationSettings = {
  version: 1,
  method: "agent",
  printers: { a5: null, label: null },
  checkStatus: true,
  confirmSeconds: 30,
  label: {
    mode: "tspl",
    media: "gap",
    widthMm: 57,
    heightMm: 39,
    gapMm: 2,
    headDots: 448,
    density: 8,
    speed: 3,
    rotate: false,
    shiftX: 0,
    shiftY: 0,
    threshold: 165,
    invert: false,
  },
  a5: { fit: "page" },
};

type Bag = Record<string, unknown>;

const bag = (value: unknown): Bag =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Bag) : {};

function number(value: unknown, low: number, high: number, fallback: number, whole = false): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(high, Math.max(low, n));
  return whole ? Math.round(clamped) : Math.round(clamped * 100) / 100;
}

function choice<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

const queue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function parseSettings(raw: unknown): StationSettings {
  let source: unknown = raw;
  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw);
    } catch {
      source = null;
    }
  }
  const root = bag(source);
  const printers = bag(root.printers);
  const label = bag(root.label);
  const a5 = bag(root.a5);
  const d = DEFAULT_SETTINGS.label;

  return {
    version: 1,
    // "qz" is what this setting was called while printing went through QZ
    // Tray; a PC saved then keeps printing without a dialog.
    method: root.method === "qz" ? "agent" : choice(root.method, ["agent", "dialog"] as const, DEFAULT_SETTINGS.method),
    printers: { a5: queue(printers.a5), label: queue(printers.label) },
    checkStatus: flag(root.checkStatus, DEFAULT_SETTINGS.checkStatus),
    confirmSeconds: number(root.confirmSeconds, 5, 180, DEFAULT_SETTINGS.confirmSeconds, true),
    label: {
      mode: choice(label.mode, ["tspl", "driver"] as const, d.mode),
      media: choice(label.media, ["gap", "continuous"] as const, d.media),
      widthMm: number(label.widthMm, 10, 110, d.widthMm),
      heightMm: number(label.heightMm, 10, 400, d.heightMm),
      gapMm: number(label.gapMm, 0, 20, d.gapMm),
      headDots: number(label.headDots, 128, 1000, d.headDots, true),
      density: number(label.density, 0, 15, d.density, true),
      speed: number(label.speed, 1, 6, d.speed, true),
      rotate: flag(label.rotate, d.rotate),
      shiftX: number(label.shiftX, -200, 200, d.shiftX, true),
      shiftY: number(label.shiftY, -200, 200, d.shiftY, true),
      threshold: number(label.threshold, 1, 254, d.threshold, true),
      invert: flag(label.invert, d.invert),
    },
    a5: { fit: choice(a5.fit, ["page", "actual"] as const, DEFAULT_SETTINGS.a5.fit) },
  };
}

/** TSPL's DIRECTION for these settings: 1 is the usual way out, 0 upside down. */
export function tsplDirection(label: LabelSettings): 0 | 1 {
  return label.rotate ? 0 : 1;
}
