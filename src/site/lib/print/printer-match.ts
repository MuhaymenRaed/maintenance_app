/**
 * Which Windows queue gets which paper — guessed from the queue list, then
 * confirmed once per machine in the printer setup.
 *
 * ---------------------------------------------------------------------------
 * The mapping is a property of the computer, not of the deployment
 * ---------------------------------------------------------------------------
 * A queue name is whatever the driver's installer called it on that PC, so
 * there is no value an environment variable could hold that would be right
 * for the counter's machine and a manager's laptop at once. These patterns
 * are the configurable defaults; the choice that sticks is the one saved in
 * that browser by the setup dialog (`lib/print/station-settings.ts`).
 *
 * ⚠️ **Never the Windows default printer.** `default` is on `PrinterInfo`
 * because the agent reports it, and nothing here reads it: the default is
 * whatever was printed to last — on the counter PC it is the label printer —
 * which is exactly the thing that sends an A5 receipt to the label printer.
 *
 * ⚠️ **A queue is not always called what the printer is called.** Measured
 * 2026-11-05: the LPQ58 was first installed as **"PPTII-A"** on HPRT's
 * receipt driver, and later the same day reinstalled as **"HPRT LPQ58"** on a
 * TSC (Seagull) label driver. The label patterns know both, and a queue whose
 * every paper size is narrow is taken as a receipt or label driver.
 */

export type PrinterInfo = {
  name: string;
  driver?: string | null;
  /** The port: `USB001`, an IP port, `PORTPROMPT:`. */
  connection?: string | null;
  default?: boolean;
  density?: number;
  sizes?: { name?: string; mm?: { width: number; height: number } }[];
  /** Windows' PRINTER_STATUS_* flags by name, as the agent reads them. */
  statuses?: string[];
  /** For a USB printer, whether it is plugged in right now; null when Windows cannot tell. */
  connected?: boolean | null;
};

export type PrinterRole = "a5" | "label";

export type PrinterPick = { name: string; confident: boolean; score: number };

/** Software that calls itself a printer and puts no ink on paper. */
const VIRTUAL =
  /\b(pdf|xps|onenote|fax)\b|send to|print to|virtual|anydesk|teamviewer|snagit|cutepdf|bullzip|nitro|foxit|image writer/i;

/** Receipt and label printers, by the names their drivers actually use. */
const LABELISH =
  /lpq\s*-?\s*58|hprt|ppt\s*ii|ppt2|tspl|label|thermal|\bpos\b|receipt|xprinter|\bxp-|\btsc\b|zebra|godex|gprinter/i;

/** Ordinary office printers, the kind that hold a ream of A4 or A5. */
const OFFICE =
  /canon|\bhp\b|hewlett|laserjet|deskjet|officejet|epson|brother|xerox|kyocera|ricoh|samsung|lexmark|pantum|sharp|konica|\boki\b/i;

/** At least this to be offered at all. */
const CANDIDATE = 40;
/** At least this, and clear of the runner-up, to be used without asking. */
const CONFIDENT = 70;
const MARGIN = 20;

const text = (printer: PrinterInfo) => `${printer.name} ${printer.driver ?? ""}`;

/**
 * True when every paper the driver lists is 80 mm wide or less — a receipt or
 * label driver. `null` when the driver listed no sizes, which says nothing.
 */
export function narrowMediaOnly(printer: PrinterInfo): boolean | null {
  const widths = (printer.sizes ?? [])
    .map((size) => (size.mm ? Math.min(size.mm.width, size.mm.height) : NaN))
    .filter((width) => Number.isFinite(width) && width > 0);
  if (widths.length === 0) return null;
  return widths.every((width) => width <= 80);
}

/** Whether the driver offers A5, by name or by its 148 x 210 mm shape. */
export function supportsA5(printer: PrinterInfo): boolean | null {
  const sizes = printer.sizes ?? [];
  if (sizes.length === 0) return null;
  return sizes.some((size) => {
    if (size.name && /\bA5\b/i.test(size.name)) return true;
    if (!size.mm) return false;
    const [short, long] = [size.mm.width, size.mm.height].sort((a, b) => a - b);
    return Math.abs(short - 148) <= 1.5 && Math.abs(long - 210) <= 1.5;
  });
}

export function scorePrinter(role: PrinterRole, printer: PrinterInfo): number {
  const words = text(printer);
  if (VIRTUAL.test(words)) return -Infinity;
  const narrow = narrowMediaOnly(printer);
  let score = 0;

  if (role === "a5") {
    if (/canon/i.test(words)) score += 60;
    else if (OFFICE.test(words)) score += 40;
    if (LABELISH.test(words) || narrow === true) score -= 100;
    const a5 = supportsA5(printer);
    if (a5 === true) score += 25;
    if (a5 === false) score -= 25;
    return score;
  }

  if (/lpq\s*-?\s*58/i.test(words)) score += 90;
  if (/hprt/i.test(words)) score += 40;
  if (LABELISH.test(words) && !/lpq\s*-?\s*58|hprt/i.test(words)) score += 35;
  if (narrow === true) score += 20;
  if (OFFICE.test(words) && !LABELISH.test(words)) score -= 80;
  return score;
}

/** The best queue for one paper, or null when nothing looks like it. */
export function pickPrinter(
  role: PrinterRole,
  printers: readonly PrinterInfo[],
  exclude?: string | null,
): PrinterPick | null {
  const ranked = printers
    .filter((printer) => printer.name !== exclude)
    .map((printer) => ({ name: printer.name, score: scorePrinter(role, printer) }))
    .filter((entry) => entry.score >= CANDIDATE)
    .sort((a, b) => b.score - a.score);
  const [best, runner] = ranked;
  if (!best) return null;
  const clear = !runner || best.score - runner.score >= MARGIN;
  return { name: best.name, score: best.score, confident: best.score >= CONFIDENT && clear };
}

/**
 * Both papers at once.
 *
 * The two can never land on one queue, and not because of a check here: an A5
 * candidate must be neither label-ish by name nor narrow by paper, and a label
 * candidate must be one or the other. The test holds that property over real
 * driver names, which is where a careless pattern change would break it.
 */
export function suggestRoles(printers: readonly PrinterInfo[]): {
  a5: PrinterPick | null;
  label: PrinterPick | null;
} {
  return { a5: pickPrinter("a5", printers), label: pickPrinter("label", printers) };
}
