/**
 * The label, in the label printer's own language.
 *
 * ---------------------------------------------------------------------------
 * Why TSPL at all, when Windows has a driver for the printer
 * ---------------------------------------------------------------------------
 * Measured on the counter's machine on 2026-11-05: the LPQ58 is plugged in on
 * `USB001` (the port's own description reads `HPRTLPQ58`), and the queue on it
 * is **"PPTII-A"** — HPRT's *receipt* driver (`hprtpos.inf`), whose only paper
 * sizes are 48 x 297, 48 x 420 and 48 x 3276 mm. A 57 x 39 mm label is not a
 * shape that driver can describe, which is the whole of "the sticker paper is
 * not recognised": every browser dialog fell back to a 48 mm receipt.
 *
 * The printer itself speaks TSPL and ESC/POS (HPRT's spec sheet). Sending TSPL
 * straight through the queue — the spooler's RAW datatype, which every Windows
 * driver passes untouched — says the label's real size, its gap and its
 * darkness in the job itself, so the driver's paper list stops mattering.
 *
 * ---------------------------------------------------------------------------
 * Why a bitmap and not TSPL's own TEXT command
 * ---------------------------------------------------------------------------
 * The printer's fonts have no Arabic, and if they had, they would not join the
 * letters. The browser draws the label — Expo Arabic, shaped and joined — and
 * this file sends the picture. One `BITMAP` command, one dot per dot.
 *
 * ⚠️ **Polarity is TSC's: a 1 bit is paper, a 0 bit is a printed dot.** That
 * is the convention of the TSPL manuals and of every encoder in the wild, and
 * it is the opposite of what most image code assumes — get it wrong and the
 * label prints as a black slab with white writing. `invert` exists for a
 * firmware that reads the other way; the test print in the printer setup is
 * how anybody finds out.
 *
 * Pure: no DOM, no network, nothing to mock. The browser hands it pixels.
 */

/** A 1-bit picture, row-major, one byte per dot: 1 prints, 0 is paper. */
export type DotBitmap = {
  width: number;
  height: number;
  dots: Uint8Array;
};

export type TsplLabel = {
  /** The label's width, as the SIZE command says it. */
  widthMm: number;
  /** The label's height — or the picture's, on continuous paper. */
  heightMm: number;
  /** The gap between die-cut labels. 0 means continuous paper. */
  gapMm: number;
  /** Where the gap sits relative to the tear point; 0 for nearly every roll. */
  gapOffsetMm: number;
  /** Darkness, 0 – 15. */
  density: number;
  /** Inches per second. */
  speed: number;
  /** 1 and 0 print the same label rotated 180° from each other. */
  direction: 0 | 1;
  /** Where the bitmap starts, in dots from the printable area's corner. */
  x?: number;
  y?: number;
  /** Flip the bit polarity for a printer that reads 1 as a dot. */
  invert?: boolean;
};

/** Dots per millimetre at 203 dpi — the LPQ58's only resolution. */
export const DOTS_PER_MM = 8;

/**
 * Pixels to dots. A pixel is a dot when, laid over white, it is darker than
 * `threshold` (0 – 255).
 *
 * Alpha is composited over white rather than ignored, because the canvas this
 * reads from is a drawing of a page and a soft edge is a partly-covered pixel:
 * judging the colour alone would print every anti-aliased fringe as black.
 */
export function thresholdToDots(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): DotBitmap {
  const dots = new Uint8Array(width * height);
  for (let i = 0; i < dots.length; i += 1) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3] / 255;
    const luminance = (r * 299 + g * 587 + b * 114) / 1000;
    const overWhite = 255 - a * (255 - luminance);
    dots[i] = overWhite < threshold ? 1 : 0;
  }
  return { width, height, dots };
}

/**
 * Fits a picture to the head's width: centred, then moved by `shift` dots.
 *
 * The label is wider than the head can reach (57 mm against 56 mm on the
 * LPQ58), so the picture is cropped to its middle rather than started at its
 * corner — the design keeps 1 mm of paper on each side, and a crop from one
 * edge would spend both millimetres on one side and cut the other.
 *
 * A positive shift moves the print towards the far end of the head. Columns
 * that fall outside the picture are paper, never wrapped round.
 */
export function fitToHead(bitmap: DotBitmap, headDots: number, shift: number): DotBitmap {
  const start = Math.round((bitmap.width - headDots) / 2) - Math.round(shift);
  const dots = new Uint8Array(headDots * bitmap.height);
  for (let row = 0; row < bitmap.height; row += 1) {
    for (let column = 0; column < headDots; column += 1) {
      const source = start + column;
      if (source < 0 || source >= bitmap.width) continue;
      dots[row * headDots + column] = bitmap.dots[row * bitmap.width + source];
    }
  }
  return { width: headDots, height: bitmap.height, dots };
}

/** Rows of bytes, eight dots each, the leftmost dot in the highest bit. */
export function packBitmap(
  bitmap: DotBitmap,
  { invert = false }: { invert?: boolean } = {},
): { bytesPerRow: number; data: Uint8Array } {
  const bytesPerRow = Math.ceil(bitmap.width / 8);
  const data = new Uint8Array(bytesPerRow * bitmap.height);
  for (let row = 0; row < bitmap.height; row += 1) {
    for (let index = 0; index < bytesPerRow; index += 1) {
      // Start from all-paper, so the padding past the last dot stays paper.
      let byte = 0xff;
      for (let bit = 0; bit < 8; bit += 1) {
        const column = index * 8 + bit;
        if (column < bitmap.width && bitmap.dots[row * bitmap.width + column]) {
          byte &= ~(0x80 >> bit);
        }
      }
      data[row * bytesPerRow + index] = invert ? ~byte & 0xff : byte;
    }
  }
  return { bytesPerRow, data };
}

const clamp = (value: number, low: number, high: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : fallback;

/** "39", "31.25" — never "39.000000", which some firmware reads as garbage. */
const mm = (value: number) => `${Number(value.toFixed(2))} mm`;

/**
 * One label: setup, the picture, and a single PRINT.
 *
 * `CLS` comes after the setup and before the bitmap: it clears the image
 * buffer, and a buffer left from a job that failed half way would otherwise be
 * printed underneath this one.
 */
export function encodeTsplLabel(bitmap: DotBitmap, label: TsplLabel): Uint8Array {
  if (bitmap.dots.length !== bitmap.width * bitmap.height) {
    throw new Error(
      `bitmap holds ${bitmap.dots.length} dots for a ${bitmap.width} x ${bitmap.height} picture`,
    );
  }
  const packed = packBitmap(bitmap, { invert: label.invert });
  const x = Math.max(0, Math.round(label.x ?? 0));
  const y = Math.max(0, Math.round(label.y ?? 0));

  const head =
    `SIZE ${mm(label.widthMm)},${mm(label.heightMm)}\r\n` +
    `GAP ${mm(Math.max(0, label.gapMm))},${mm(Math.max(0, label.gapOffsetMm))}\r\n` +
    `DIRECTION ${label.direction === 0 ? 0 : 1},0\r\n` +
    `REFERENCE 0,0\r\n` +
    `DENSITY ${clamp(label.density, 0, 15, 8)}\r\n` +
    `SPEED ${clamp(label.speed, 1, 6, 3)}\r\n` +
    `CLS\r\n` +
    `BITMAP ${x},${y},${packed.bytesPerRow},${bitmap.height},0,`;
  const tail = "\r\nPRINT 1,1\r\n";

  const out = new Uint8Array(head.length + packed.data.length + tail.length);
  for (let i = 0; i < head.length; i += 1) out[i] = head.charCodeAt(i);
  out.set(packed.data, head.length);
  for (let i = 0; i < tail.length; i += 1) out[head.length + packed.data.length + i] = tail.charCodeAt(i);
  return out;
}
