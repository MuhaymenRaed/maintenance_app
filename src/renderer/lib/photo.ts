/**
 * A photograph from the counter, turned into the one thing the shop stores.
 *
 * ---------------------------------------------------------------------------
 * Why the window converts, rather than the main process or the server
 * ---------------------------------------------------------------------------
 * The site stores **WebP and nothing else** (`lib/r2.ts`, 2026-11-10), and the
 * database's own rule for a repair photo is a key ending `.webp`
 * (`book_repair`'s pattern). Those are two halves of one rule: a JPEG written
 * under a `.webp` name satisfies the pattern and is a lie about the bytes.
 *
 * So the conversion happens here, before the file is written to this computer,
 * which also means the picture on disk is byte-for-byte what will be uploaded
 * when the line returns. The main process has no canvas and the server is the
 * one thing this app may be without for a day.
 *
 * ⚠️ A file no decoder on this machine can read is **refused**, with a reason,
 * not stored as it arrived. The site learned that one the expensive way: seven
 * HEICs from staff phones reached the bucket, every screen drew a broken
 * frame, and the only thing anybody could do was try other copies of the same
 * photograph until one went through.
 */

/** The bench zooms into a cracked screen to quote it, so the cap is generous. */
const MAX_EDGE = 2400;
const QUALITY = 0.82;
/** Larger than any camera produces. Refused before a 48MB bitmap is decoded. */
const MAX_BYTES = 40 * 1024 * 1024;

export type PhotoFailReason =
  /** Not a picture — a video, a document, a HEIC nothing here can decode. */
  | "unsupported"
  /** A picture the decoder could not read. */
  | "unreadable"
  /** Bigger than anything a camera makes. */
  | "too_large";

export type PhotoResult =
  | { ok: true; name: string; type: string; bytes: ArrayBuffer }
  | { ok: false; reason: PhotoFailReason };

/**
 * What a file actually is, from its first bytes.
 *
 * ⚠️ Never from `file.type` or the extension. A phone hands over HEIC bytes
 * named `.jpg`, and Chrome labels a HEIC `""` — the measurement that cost the
 * site a week of "the picture disappeared".
 */
async function sniff(file: File): Promise<"jpeg" | "png" | "webp" | "gif" | "bmp" | "heic" | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const at = (offset: number, ...bytes: number[]) => bytes.every((byte, index) => head[offset + index] === byte);
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (at(0, 0x42, 0x4d)) return "bmp";
  // ISO base media: `....ftyp` then a brand. `heic`/`heix`/`mif1`/`msf1`.
  if (at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return null;
}

function draw(bitmap: ImageBitmap): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
}

export async function toWebp(file: File): Promise<PhotoResult> {
  if (file.size > MAX_BYTES) return { ok: false, reason: "too_large" };
  const kind = await sniff(file);
  if (kind === null || kind === "heic") return { ok: false, reason: "unsupported" };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  try {
    const blob = await encode(draw(bitmap));
    // ⚠️ The type is checked rather than trusted. An encoder asked for WebP
    // that answers with something else (Safari does exactly that) would hand
    // the shop a PNG under a `.webp` key — the mismatch this file exists to
    // prevent, arriving from the other direction.
    if (!blob || blob.type !== "image/webp") return { ok: false, reason: "unreadable" };
    const stem = file.name.replace(/\.[^.]+$/, "") || "photo";
    return { ok: true, name: `${stem}.webp`, type: "image/webp", bytes: await blob.arrayBuffer() };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    bitmap.close();
  }
}
