import { formatPrice } from "@/lib/format";

/**
 * A sum of Iraqi dinars on a dashboard tile, **written in full**.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ This used to abbreviate, and the shop asked for the zeros back
 * ---------------------------------------------------------------------------
 * It was `compactMoney` in `lib/data/compact.ts`, and it wrote `18.4M` and
 * `50K`. The argument for that is in the next paragraph and it is a real one;
 * the shop overruled it on 2026-11-13 in these words: *"the k values like 50k
 * must be written as 50,000 — always write the zeros."*
 *
 * **The argument it overrules, kept because it is what a reader of a narrow
 * tile will think of next:** prices here run to eight digits — a mid-range
 * phone is 350,000 and a month's takings are in the tens of millions — and a
 * tile is about nine characters wide, so `18,450,000` either wraps or runs
 * past its own card.
 *
 * What answers that is not abbreviation but **sizing**: every tile is a
 * `@container` and its figure is set in `cqi`, so it shrinks to stay on one
 * line as the tile narrows. See `components/admin/stat-cards.tsx`. That keeps
 * the whole figure, which is what was asked for, and it is the same decision
 * the product card's price band already makes for the same reason.
 *
 * ⚠️ **A rounded figure is still a figure, so this rounds and never cuts.**
 * The fractional part of a dinar is noise from an average, not money anybody
 * holds.
 *
 * Western digits with comma grouping in both locales, like every other price
 * in the app (see `lib/format.ts`).
 *
 * Lives here rather than in `lib/format.ts` because it is a *dashboard*
 * convention — one place to change if the shop ever wants the short form back,
 * which is the whole reason it is still a named function rather than a call to
 * `formatPrice` at thirty-seven sites.
 */
export function statMoney(value: number): string {
  return formatPrice(Math.round(value));
}
