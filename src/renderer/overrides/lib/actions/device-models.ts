import type { WorldModel } from "@/lib/data/device-name";

/**
 * `lib/actions/device-models.ts` — every device the makers sell, for the
 * counter's model picker.
 *
 * ⚠️ One device, one name. The dashboard standardises what the pickers draw
 * (`lib/data/device-name.ts`) precisely so a ticket, a warranty certificate
 * and the parts list all spell a handset the same way; the desk reads the same
 * list through the same function, so a ticket opened here is indistinguishable
 * from one opened on the site.
 *
 * `compare_catalogue` is 5,912 rows and never changes in a day, so the main
 * process asks the server once per make and keeps the answer. Offline, the
 * makes already asked for are still there and anything else falls back to the
 * curated list and a free-typed name — a buy-back is often an eight-year-old
 * phone no list carries, and the same is true of what arrives at the bench.
 */
export type { WorldModel };

export function loadWorldModels(brandCode: string, locale: string): Promise<WorldModel[]> {
  return window.desk.loadWorldModels(brandCode, locale);
}
