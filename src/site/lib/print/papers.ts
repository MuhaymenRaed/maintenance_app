import { qrMatrix } from "@/lib/print/qr";
import { bytesToBase64, canvasToPngBase64, CSS_PX_PER_MM, rasterizeElement } from "@/lib/print/rasterize";
import type { PaperPayload } from "@/lib/print/station";
import type { StationSettings } from "@/lib/print/station-settings";
import { tsplDirection } from "@/lib/print/station-settings";
import { DOTS_PER_MM, encodeTsplLabel, fitToHead, thresholdToDots, type DotBitmap } from "@/lib/print/tspl";

/**
 * A drawn paper, turned into what the print agent sends.
 *
 * Loaded with `import()` by the panel's stage when a run needs pictures, so
 * none of this — nor the rasterizer behind it — is in the board's bundle.
 */

/** 300 dpi: what the Canon prints text sharply at, in pixels per millimetre. */
const A5_PX_PER_MM = 300 / 25.4;
const A5 = { widthMm: 210, heightMm: 148 };

/**
 * An A5 paper — the receipt or the warranty — as a 300 dpi picture of the
 * whole landscape page, the sheet centred on it exactly as `@page` centres it
 * in the dialog path.
 *
 * ⚠️ **The paper is A5 as every driver defines it — 148 x 210, portrait —
 * with landscape set**, never a custom 210 x 148: a driver that knows A5
 * matches the size by name and feeds the right tray, where a custom size is
 * a "user-defined paper" some drivers refuse or put on A4.
 *
 * `fit: "page"` lets the agent fit the picture to what the printer can reach:
 * a printer that cannot print to the edge shrinks it a few per cent instead
 * of cutting the edge off. `actual` prints at exactly A5 and trusts the
 * sheet's own 7 – 10 mm of padding to clear the printer's margins.
 */
export async function a5Paper(sheet: HTMLElement, settings: StationSettings): Promise<PaperPayload> {
  const rect = sheet.getBoundingClientRect();
  const canvas = await rasterizeElement(sheet, {
    ...A5,
    pxPerMm: A5_PX_PER_MM,
    offsetMm: {
      x: (A5.widthMm - rect.width / CSS_PX_PER_MM) / 2,
      y: (A5.heightMm - rect.height / CSS_PX_PER_MM) / 2,
    },
  });
  return {
    kind: "image",
    data: await canvasToPngBase64(canvas),
    widthMm: 148,
    heightMm: 210,
    landscape: true,
    fit: settings.a5.fit,
    mono: false,
  };
}

/**
 * Repaints the QR dot-exact over the label's picture.
 *
 * The rasterized SVG lands wherever the layout put it, which in CSS pixels is
 * rarely a whole number of the head's dots; anti-aliased module edges then
 * threshold to modules a dot wider or narrower than their neighbours. Here
 * every module is a whole block of dots on the grid, the way a QR printer
 * would draw it.
 */
function repaintQr(context: CanvasRenderingContext2D, sheet: HTMLElement, offsetDots: { x: number; y: number }) {
  const symbol = sheet.querySelector<SVGSVGElement>("[data-print-qr]");
  const value = symbol?.getAttribute("data-print-qr");
  if (!symbol || !value) return;
  const matrix = qrMatrix(value);
  const sheetRect = sheet.getBoundingClientRect();
  const rect = symbol.getBoundingClientRect();
  const toDots = (px: number) => (px / CSS_PX_PER_MM) * DOTS_PER_MM;
  const cell = Math.max(1, Math.round(toDots(rect.width) / matrix.length));
  const x = Math.round(offsetDots.x + toDots(rect.left - sheetRect.left));
  const y = Math.round(offsetDots.y + toDots(rect.top - sheetRect.top));
  const size = cell * matrix.length;
  context.fillStyle = "#ffffff";
  context.fillRect(x, y, size, size);
  context.fillStyle = "#000000";
  matrix.forEach((row, my) =>
    row.forEach((dark, mx) => {
      if (dark) context.fillRect(x + mx * cell, y + my * cell, cell, cell);
    }),
  );
}

/** Rows moved down (positive) or up (negative) by whole dots, paper filling the gap. */
function shiftRows(bitmap: DotBitmap, rows: number): DotBitmap {
  if (!rows) return bitmap;
  const dots = new Uint8Array(bitmap.dots.length);
  for (let row = 0; row < bitmap.height; row += 1) {
    const source = row - rows;
    if (source < 0 || source >= bitmap.height) continue;
    dots.set(bitmap.dots.subarray(source * bitmap.width, (source + 1) * bitmap.width), row * bitmap.width);
  }
  return { ...bitmap, dots };
}

/**
 * The device's label, drawn at the head's own 8 dots/mm and judged dot by dot.
 *
 * On continuous paper the label is as tall as the sheet's content plus a
 * millimetre each side, measured from the rendered sheet; on die-cut stock it
 * is the label's height, whatever the content.
 */
export async function labelPaper(sheet: HTMLElement, settings: StationSettings): Promise<PaperPayload> {
  const label = settings.label;
  const rect = sheet.getBoundingClientRect();
  const sheetWidthMm = rect.width / CSS_PX_PER_MM;
  const sheetHeightMm = rect.height / CSS_PX_PER_MM;
  const continuous = label.media === "continuous";
  // Whole dots, so SIZE and the bitmap agree to the dot.
  const heightMm = continuous ? Math.ceil((sheetHeightMm + 2) * DOTS_PER_MM) / DOTS_PER_MM : label.heightMm;
  const offset = { x: (label.widthMm - sheetWidthMm) / 2, y: 1 };

  const canvas = await rasterizeElement(sheet, {
    widthMm: label.widthMm,
    heightMm,
    pxPerMm: DOTS_PER_MM,
    offsetMm: offset,
  });
  const context = canvas.getContext("2d")!;
  repaintQr(context, sheet, { x: offset.x * DOTS_PER_MM, y: offset.y * DOTS_PER_MM });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const bitmap = thresholdToDots(pixels.data, canvas.width, canvas.height, label.threshold);

  if (label.mode === "tspl") {
    const fitted = shiftRows(fitToHead(bitmap, label.headDots, label.shiftX), label.shiftY);
    const bytes = encodeTsplLabel(fitted, {
      widthMm: label.widthMm,
      heightMm,
      gapMm: continuous ? 0 : label.gapMm,
      gapOffsetMm: 0,
      density: label.density,
      speed: label.speed,
      direction: tsplDirection(label),
      invert: label.invert,
    });
    return { kind: "raw", data: bytesToBase64(bytes) };
  }

  // Through the Windows driver: the same black-and-white decision, handed over
  // as a picture so the driver has no grey left to dither.
  const out = context.createImageData(canvas.width, canvas.height);
  bitmap.dots.forEach((dot, index) => {
    const value = dot ? 0 : 255;
    out.data[index * 4] = value;
    out.data[index * 4 + 1] = value;
    out.data[index * 4 + 2] = value;
    out.data[index * 4 + 3] = 255;
  });
  context.putImageData(out, 0, 0);
  return {
    kind: "image",
    data: await canvasToPngBase64(canvas),
    widthMm: label.widthMm,
    heightMm,
    landscape: false,
    fit: "actual",
    mono: true,
  };
}
