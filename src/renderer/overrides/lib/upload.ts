import toast from "react-hot-toast";
import type { UploadPrefix } from "@/lib/r2";
import { toWebp, type PhotoFailReason } from "../../lib/photo";
import { say } from "../../lib/words";

/**
 * `lib/upload.ts` for a desk that may have no line to the shop.
 *
 * On the site an upload goes straight to storage and comes back as a public
 * URL. Here the photograph is converted to WebP in this window
 * (`lib/photo.ts`), written to this computer by the main process, and handed
 * back as a `desk-photo://` address the board can draw at once. The outbox
 * uploads it later — through the dashboard's `/api/desk/photos`, which holds
 * the storage keys — and swaps the local address for the stored one on the
 * ticket.
 *
 * ⚠️ A file that cannot become a WebP is refused and **said so**. The board
 * calls `uploadPhotos` and does nothing when it gets fewer URLs than files,
 * which on the site is the silent half-success that sent staff round a loop
 * of trying other copies of the same picture. The toast is the app's own,
 * so the copied board stays exactly as it is.
 */
export type { UploadPrefix };

export type UploadFailReason = PhotoFailReason | "upload_failed";
export type UploadFailure = { name: string; reason: UploadFailReason };
export type UploadOutcome = { urls: string[]; failures: UploadFailure[] };

export async function uploadPhotosDetailed(files: File[], _prefix: UploadPrefix): Promise<UploadOutcome> {
  if (!files.length) return { urls: [], failures: [] };
  const failures: UploadFailure[] = [];
  const ready: { name: string; type: string; bytes: ArrayBuffer }[] = [];

  // One at a time: a 12MP photograph is a ~48MB bitmap while it is decoded,
  // and a counter PC with a browser and a print agent open is not the place
  // to ask for four of those at once.
  for (const file of files) {
    const result = await toWebp(file);
    if (result.ok) ready.push({ name: result.name, type: result.type, bytes: result.bytes });
    else failures.push({ name: file.name, reason: result.reason });
  }

  let urls: string[] = [];
  if (ready.length) {
    try {
      urls = await window.desk.savePhotos(ready);
    } catch {
      urls = [];
    }
    if (urls.length < ready.length) {
      for (const file of ready.slice(urls.length)) failures.push({ name: file.name, reason: "upload_failed" });
    }
  }
  return { urls, failures };
}

export async function uploadPhotos(files: File[], prefix: UploadPrefix): Promise<string[]> {
  const { urls, failures } = await uploadPhotosDetailed(files, prefix);
  if (failures.length) {
    const reasons = [...new Set(failures.map((failure) => failure.reason))];
    toast.error(
      say("photosRefused", {
        count: failures.length,
        names: failures.map((failure) => failure.name).join("، "),
        why: reasons.map((reason) => say(`photoWhy_${reason}`)).join(" · "),
      }),
      { duration: 8000 },
    );
  }
  return urls;
}
