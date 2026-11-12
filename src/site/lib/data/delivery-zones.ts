/**
 * What delivery costs, by where it is going.
 *
 * The shop's instruction, 2026-11-05: inside Al Kut **2,000**, the other
 * districts and sub-districts of Wasit **4,000**, Baghdad **5,000**, every
 * other province **6,000** — "based on user location and specifying of his
 * location". Until then every delivery was one flat 5,000 from
 * `settings.delivery_fee_default`, wherever it went.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ Two halves of one rule
 * ---------------------------------------------------------------------------
 * `delivery_zone_fee(province, area)` in the database decides what the till
 * charges; `zoneFee` here decides what the cart and the checkout *show* before
 * the order is placed. The figures themselves are data — `provinces.
 * delivery_fee`, `settings.delivery_fee_local` (inside Kut) and
 * `settings.delivery_fee_default` (anything without a fee of its own) — and
 * reach both halves from the same rows. What is written twice is only the
 * choice between them, and `delivery-zones.test.ts` holds this half of it:
 * change one, change the other.
 *
 * Imports nothing: the checkout is a Client Component and the test runs under
 * `node --test`.
 */

export type DeliveryZones = {
  /** Inside Al Kut itself. */
  local: number;
  /** A province with no fee of its own, or no province chosen yet. */
  fallback: number;
  /** The standing fee per province code. */
  provinces: Record<string, number>;
  /**
   * False until `20261105_store_sort_and_delivery_zones.sql` has run. The till
   * then still charges one flat fee everywhere, so the screen must too —
   * quoting 2,000 for Kut while the till takes 5,000 is the failure this
   * whole module exists to prevent.
   */
  zoned: boolean;
};

/** The province whose seat gets the local rate. Every counter is in Al Kut. */
export const LOCAL_PROVINCE = "wasit";
/** The area code that means "inside the city", shared with `IRAQ_AREAS`. */
export const LOCAL_AREA = "kut";

/**
 * The places in Wasit a customer picks between.
 *
 * Kut is the city — its own sub-districts outside the city are delivered at
 * the Wasit rate, which is what "inside the Kut" means and why the label says
 * so. The five other districts follow, then one line for every sub-district
 * not named: listing the nawahi by name would be a list somebody has to keep
 * right, and the fee does not depend on which one it is. The codes match
 * `IRAQ_AREAS.wasit`, so the edge's guess at a district lands on its own row.
 */
export const WASIT_DELIVERY_AREAS = [
  { code: "kut", ar: "الكوت — داخل المدينة", en: "Kut — inside the city" },
  { code: "suwaira", ar: "الصويرة", en: "Suwaira" },
  { code: "aziziyah", ar: "العزيزية", en: "Aziziyah" },
  { code: "numaniyah", ar: "النعمانية", en: "Numaniyah" },
  { code: "hai", ar: "الحي", en: "Hai" },
  { code: "badra", ar: "بدرة", en: "Badra" },
  {
    code: "wasit-other",
    ar: "ناحية أو منطقة أخرى في واسط",
    en: "Another sub-district of Wasit",
  },
] as const;

export type DeliveryAreaCode = (typeof WASIT_DELIVERY_AREAS)[number]["code"];

export function isDeliveryArea(code: string | null | undefined): code is DeliveryAreaCode {
  return WASIT_DELIVERY_AREAS.some((area) => area.code === code);
}

/** Whether this province asks which part of it the parcel is going to. */
export function asksForArea(province: string | null | undefined): boolean {
  return province === LOCAL_PROVINCE;
}

/**
 * The standing fee for one destination, before any delivery offer.
 *
 * Mirrors `delivery_zone_fee` in the database exactly: the local rate only
 * for Kut inside Wasit, otherwise the province's own fee, otherwise the
 * fallback. An area given for any other province is ignored.
 */
export function zoneFee(
  zones: DeliveryZones,
  province: string | null | undefined,
  area: string | null | undefined,
): number {
  if (!zones.zoned || !province) return zones.fallback;
  if (province === LOCAL_PROVINCE && area === LOCAL_AREA) return zones.local;
  return zones.provinces[province] ?? zones.fallback;
}

/** The name of an area code in the reader's language, or null when unknown. */
export function deliveryAreaLabel(
  code: string | null | undefined,
  locale: string,
): string | null {
  const area = WASIT_DELIVERY_AREAS.find((row) => row.code === code);
  if (!area) return null;
  return locale === "ar" ? area.ar : area.en;
}
