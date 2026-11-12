/**
 * Prices render with Western digits and comma grouping in both locales —
 * that is how they appear in the Figma design and on Iraqi price tags.
 */
const priceFormatter = new Intl.NumberFormat("en-US");

export function formatPrice(value: number): string {
  return priceFormatter.format(value);
}

const compactFormatter = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return compactFormatter.format(value);
}

/**
 * A published band, the way the storefront writes one: "1,900,000 – 2,000,000".
 *
 * ⚠️ One copy, because there were thirteen. Every surface that quotes a device
 * — the card, the buy box, the cart, the checkout, compare, the wishlist, the
 * hero, the assistant — built this string inline, and a basket that separated
 * its two ends differently from the card it was added from is exactly the kind
 * of difference a reader notices without being able to name. The en dash is
 * spaced, so the pair cannot read as one hyphenated number.
 */
export function formatPriceRange(band: { from: number; to: number }): string {
  return `${formatPrice(band.from)} – ${formatPrice(band.to)}`;
}
