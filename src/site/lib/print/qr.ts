import { encode } from "uqr";

/**
 * The QR printed on the device's label: the ticket code, nothing else.
 *
 * ⚠️ **The code, not a URL.** A scanner at the counter types what it reads
 * into whatever field has focus, and the desk's search box already finds a
 * ticket by its code — a URL there would search for a URL. A phone camera
 * shows the code as text, which is what the customer types into `/track`.
 * And the shortest payload is the smallest symbol: "AE-00123" is a version 1
 * QR (21 x 21) in alphanumeric mode, which at four dots a module is 12.5 mm
 * on a 203 dpi head — large modules are what a thermal print scans with.
 *
 * Error correction M (15%): a label on a phone's back gets scratched.
 */

/** Light modules around the symbol. Two is the least that scans reliably. */
export const QR_QUIET = 2;

export function qrMatrix(value: string): boolean[][] {
  return encode(value, { ecc: "M", border: QR_QUIET }).data;
}

/**
 * An SVG path drawing the dark modules, one rectangle per run along each row,
 * in module units — the caller's `viewBox` decides the size.
 */
export function qrPath(matrix: readonly (readonly boolean[])[]): string {
  let path = "";
  matrix.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x += 1) {
      const dark = x < row.length && row[x];
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        const run = x - start;
        path += `M${start},${y}h${run}v1h-${run}z`;
        start = -1;
      }
    }
  });
  return path;
}
