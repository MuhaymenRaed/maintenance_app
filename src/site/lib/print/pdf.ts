/**
 * A PDF made of pictures — one JPEG per page — written in the browser.
 *
 * ---------------------------------------------------------------------------
 * Why pictures, and why by hand
 * ---------------------------------------------------------------------------
 * The profit report's «تنزيل PDF» has to produce a file without the print
 * dialog, in the browser and in the desk app alike. A PDF library that sets
 * Arabic as live text needs a shaping engine and an embedded font subset to
 * get the joins right, and it would be the heaviest thing on the page for a
 * button pressed a few times a month. The report is already drawn as pages
 * for the print agent, through the same rasteriser that draws the receipts,
 * so the file is those pages as images: it looks exactly like the paper, in
 * any viewer, and it costs no dependency at all.
 *
 * A JPEG goes into a PDF as it is — `/DCTDecode` is the JPEG decoder every
 * reader has — so the file is the encoded pages plus a page of bookkeeping.
 * What it gives up is selectable text, which a printed report never had.
 *
 * ⚠️ Byte offsets are the format. The `xref` table at the end records where
 * every object starts, to the byte, and each entry is exactly 20 bytes long.
 * Everything here is counted in bytes, never in characters: the comment on
 * line two is binary on purpose (it tells a file transfer this is not text),
 * and the title is UTF-16 hex so the Arabic never touches the count.
 */

export type PdfImagePage = {
  /** A baseline JPEG, as `canvas.toBlob(…, "image/jpeg")` writes it. */
  jpeg: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** The page on paper. */
  widthMm: number;
  heightMm: number;
};

export type PdfMeta = {
  title?: string;
  creator?: string;
};

const PT_PER_MM = 72 / 25.4;
const encoder = new TextEncoder();

/** A PDF text string that can hold any script: UTF-16BE, as hex, with its BOM. */
function utf16Hex(text: string): string {
  let hex = "FEFF";
  for (let i = 0; i < text.length; i += 1) {
    hex += text.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  }
  return `<${hex}>`;
}

const points = (mm: number) => (mm * PT_PER_MM).toFixed(2);

export function jpegPagesToPdf(pages: readonly PdfImagePage[], meta: PdfMeta = {}): Uint8Array<ArrayBuffer> {
  if (!pages.length) throw new Error("a PDF needs at least one page");

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const open = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  // Objects 1–3 are the catalogue, the page tree and the document's info;
  // each page then takes three: the page, its drawing, its picture.
  const pageId = (index: number) => 4 + index * 3;
  const count = 3 + pages.length * 3;

  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  open(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  open(2);
  const kids = pages.map((_, index) => `${pageId(index)} 0 R`).join(" ");
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  open(3);
  const info = [
    meta.title ? `/Title ${utf16Hex(meta.title)}` : "",
    meta.creator ? `/Creator ${utf16Hex(meta.creator)}` : "",
    "/Producer (Al-Esnad)",
  ]
    .filter(Boolean)
    .join(" ");
  push(`<< ${info} >>\nendobj\n`);

  pages.forEach((page, index) => {
    const id = pageId(index);
    const width = points(page.widthMm);
    const height = points(page.heightMm);

    open(id);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>\nendobj\n`,
    );

    // The picture, stretched over the whole page.
    const draw = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`;
    open(id + 1);
    push(`<< /Length ${encoder.encode(draw).length} >>\nstream\n${draw}endstream\nendobj\n`);

    open(id + 2);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");
  });

  const xref = length;
  push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= count; id += 1) {
    push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * A name Windows will save. The report's name carries the desk and the date,
 * and a desk's name could one day carry a slash or a colon — the characters
 * Windows refuses in a file name, which turn a download into a silent
 * failure or a file called "download".
 */
export function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "");
  return (cleaned || "report").slice(0, 120);
}
