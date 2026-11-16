import { makerOfModel, modelIdentity } from "./device-name.ts";
import { mergeBrandModels, type StockModel } from "./device-catalogue.ts";
import type { WorldModel } from "./device-name.ts";

/**
 * The devices a bench has seen lately — the counter's first guess at the next.
 *
 * ---------------------------------------------------------------------------
 * Why the model picker opens on these
 * ---------------------------------------------------------------------------
 * A repair counter does not see the whole world's phones in equal measure: it
 * sees the same twenty handsets again and again — this month's Spark Go, the
 * Honor X7 everybody bought two years ago. The shop asked for the picker to
 * open on "the last devices whose receipts were prepared", and for a search to
 * rank them the same way, so the device on the ticket in front of the counter
 * is usually the first row rather than the fortieth.
 *
 * One row per device, newest first. Identity is brand-qualified, because the
 * picker can now show every make at once and "Note 10" is a Samsung and an
 * Infinix. A ticket written before the make was asked for has no brand code;
 * its maker is read off its own name where the name says, and it keeps a
 * row of its own where it does not.
 */
export type RecentDevice = {
  /** The device line as the ticket carries it — already the standard name. */
  model: string;
  brandCode: string | null;
  /** When it was last on a ticket. */
  at: string;
};

/** Brand-qualified identity: one key per device across every make. */
export function deviceKey(model: string, brandCode: string | null): string {
  return `${brandCode ?? "?"}:${modelIdentity(model, brandCode)}`;
}

/** Newest first, one per device — `rows` must already be newest first. */
export function recentDevicesFrom(
  rows: readonly { model: string | null; brandCode: string | null; at: string }[],
  codes: readonly string[],
  limit = 60,
): RecentDevice[] {
  const seen = new Set<string>();
  const out: RecentDevice[] = [];
  for (const row of rows) {
    const model = (row.model ?? "").trim();
    if (model.length < 2) continue;
    const brandCode = row.brandCode ?? makerOfModel(model, codes);
    const key = deviceKey(model, brandCode);
    if (!key.endsWith(":") && seen.has(key)) continue;
    seen.add(key);
    out.push({ model, brandCode, at: row.at });
    if (out.length >= limit) break;
  }
  return out;
}

/** An option the desk's model picker draws. */
export type DeskModelOption = {
  value: string;
  label: string;
  hint?: string;
  keywords?: string;
  /** Lower is more recent; absent for a device no ticket has carried lately. */
  rank?: number;
  /** The make it belongs to, so picking it can fill the make in. */
  brandCode: string | null;
};

/**
 * Every model the counter might mean, recent ones first.
 *
 * With a make chosen: that make's list (`mergeBrandModels` — the shop's own
 * stock, the curated list, the world catalogue), with this bench's recent
 * devices of that make floated to the top in the order they were last seen.
 *
 * With every make (`brandCode` null): the recent devices first, then each
 * make's stock and curated list in the shop's own brand order. The world
 * catalogue is left out of this one — it is fetched per make, a few hundred
 * names each, and twenty makes of it is a list nobody scrolls; the typed name
 * is always accepted anyway.
 */
export function deskModelOptions({
  brandCode,
  brands,
  stock,
  world,
  recent,
  dayLabel,
}: {
  brandCode: string | null;
  brands: readonly { code: string; name: string }[];
  stock: Readonly<Record<string, readonly StockModel[]>>;
  world: readonly WorldModel[];
  recent: readonly RecentDevice[];
  /** "Last on a ticket 12/11" — the hint a recent device carries. */
  dayLabel: (at: string) => string;
}): DeskModelOption[] {
  const nameOf = new Map(brands.map((brand) => [brand.code, brand.name]));
  const out: DeskModelOption[] = [];
  const seen = new Set<string>();

  const rankOf = new Map<string, number>();
  recent.forEach((device, index) => {
    const key = deviceKey(device.model, device.brandCode);
    if (!rankOf.has(key)) rankOf.set(key, index);
  });

  if (brandCode) {
    const recentHere = recent.filter((device) => device.brandCode === brandCode);
    for (const device of recentHere) {
      const key = deviceKey(device.model, brandCode);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        value: device.model,
        label: device.model,
        hint: dayLabel(device.at),
        rank: rankOf.get(key),
        brandCode,
      });
    }
    for (const option of mergeBrandModels(brandCode, stock[brandCode] ?? [], world)) {
      const key = deviceKey(option.value, brandCode);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        value: option.value,
        label: option.label,
        hint: option.year ? String(option.year) : undefined,
        keywords: option.keywords,
        brandCode,
      });
    }
    return out;
  }

  for (const device of recent) {
    const key = deviceKey(device.model, device.brandCode);
    if (seen.has(key)) continue;
    seen.add(key);
    const make = device.brandCode ? nameOf.get(device.brandCode) : undefined;
    out.push({
      value: device.model,
      label: device.model,
      hint: make ? `${make} · ${dayLabel(device.at)}` : dayLabel(device.at),
      rank: rankOf.get(key),
      brandCode: device.brandCode,
    });
  }
  for (const brand of brands) {
    for (const option of mergeBrandModels(brand.code, stock[brand.code] ?? [], [])) {
      const key = deviceKey(option.value, brand.code);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        value: option.value,
        label: option.label,
        hint: option.year ? `${brand.name} · ${option.year}` : brand.name,
        keywords: `${option.keywords} ${brand.name}`,
        brandCode: brand.code,
      });
    }
  }
  return out;
}
