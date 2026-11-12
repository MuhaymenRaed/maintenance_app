import { formatPrice } from "@/lib/format";

/**
 * A sum of Iraqi dinars, short enough to sit in a stat tile.
 *
 * Prices in this shop run to eight digits — a mid-range phone is 350,000 and a
 * month's takings are in the tens of millions — and a tile is about nine
 * characters wide. `18,450,000` either wraps or truncates; `18.4M` does not,
 * and the exact figure is one click away on the period panel.
 *
 * Western digits with comma grouping in both locales, like every other price
 * in the app (see `lib/format.ts`). The suffixes are Latin on purpose: `M` and
 * `K` are what Iraqi price lists and bank apps already use, and localising them
 * would give the same number two shapes depending on which tab you opened.
 *
 * Lives here rather than in `lib/format.ts` because it is a *dashboard*
 * convention. A product page must never round a price.
 */
export function compactMoney(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 1_000_000)
    return `${(rounded / 1_000_000).toFixed(1)}M`;
  if (Math.abs(rounded) >= 10_000) return `${Math.round(rounded / 1_000)}K`;
  return formatPrice(rounded);
}
