/**
 * How large the label's two free-text fields may be set on a sheet that cannot
 * grow.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * The device label is a die-cut 57 x 39 mm sticker. Everything on it is a
 * fixed length except two fields: `facts.fault` is every listed fault joined
 * with «، », so a bench that ticks nine of them hands this sheet about ninety
 * characters where an ordinary ticket hands it seven — and `customerName` is
 * whatever the customer is called, which in Iraq is routinely four parts.
 *
 * There are only three things a fixed sheet can do with that, and two of them
 * are wrong:
 *
 * - **Let it wrap and overflow.** ⚠️ Worse than it sounds, and worse than it
 *   looks from the code: the rows sit in a `flex-1 justify-between` column,
 *   and **a flex container with negative free space overlaps its own items
 *   rather than growing**. So nothing is reported off the sheet, every
 *   overflow check passes, `scrollHeight - clientHeight` stays at 0 — and
 *   «زبون آجل» is printed straight across the thanks line.
 * - **Clamp it.** That is what shipped before, and the shop's report on
 *   2026-11-13 was that the words come out cut. A fault list ending in «…» is
 *   the bench guessing which faults were left off.
 * - **Set it smaller.** The words stay whole, the sheet stays 37 mm, and the
 *   only cost is that a nine-fault ticket is read a little closer. That is the
 *   one of the three that loses nothing, and it is what this does.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ One pool, not two budgets
 * ---------------------------------------------------------------------------
 * The two fields share the slack, because they do not run away together: the
 * ticket with nine faults usually has a short name, and the customer with four
 * names usually has one fault. Two fixed budgets have to assume the worst of
 * both at once, and the arithmetic of that costs a rung on every ticket.
 *
 * The **name is fitted to one line first** and the fault takes what is left.
 * Not the other way round, and not "fit the name as large as it goes": given a
 * free hand the name grows onto a second line, eats most of the pool, and the
 * fault is clamped — which is the one outcome that cuts words. A name on one
 * line is also simply what a name wants to be.
 *
 * ⚠️ **The floors are different, and the name's is higher.** A fault list is
 * read once, at the bench, by somebody who already knows what they wrote on
 * it. A name is read aloud across a counter to find whose phone this is, and a
 * name too small to read at arm's length defeats the one thing the sticker is
 * for. The fault's floor is the printer rather than taste: the head is 8
 * dots/mm, so 4.8 pt is about 13 dots of cap height — below that Arabic stops
 * resolving its dots at all, and a smaller size would be worse than a clamp.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ It errs PESSIMISTIC, on purpose
 * ---------------------------------------------------------------------------
 * A character count cannot know where a line will break, and the nine-fault
 * ticket sits on a knife edge: ninety characters in the value column at 5.4 pt
 * is 2.0 lines, so any margin at all tips the estimate to three and the fitter
 * drops a rung. Measured both ways on the rendered sheet — it is 2 lines in
 * reality and the model says 3.
 *
 * That is the direction to be wrong in. Pessimistic costs one rung on the
 * hardest ticket in the shop; optimistic costs the footer on a ticket nobody
 * predicted, and the footer is the shop's own phone number.
 */

/**
 * Point sizes the fault may take, largest first.
 *
 * ⚠️ Not a continuous scale. A thermal head rounds every stroke to a whole
 * dot, so sizes a fraction of a point apart print identically and only make
 * the ladder harder to reason about. Five rungs cover one fault to about
 * twelve.
 */
export const FAULT_SIZES = [7.6, 6.8, 6, 5.4, 4.8] as const;

/** The name's ladder: three rungs, stopping well above the fault's floor. */
export const NAME_SIZES = [7.6, 6.8, 6] as const;

/**
 * The width of each field's value column, in CSS pixels.
 *
 * ⚠️ **Measured on the rendered label in BOTH locales, and the narrower of
 * the two is what is written down** — the field label sits in the same row, so
 * a long label starves its own value. Measured 2026-11-13:
 *
 *     name    ar 148.8   en 161      ->  148
 *     fault   ar 149.5   en 166.9    ->  149
 *
 * The English figures are what they are *because* two of the four labels were
 * shortened in the same change: "Customer name:" was 67.4 px against the
 * Arabic «اسم الزبون:» at 41.1, which left the English name column 26 px
 * narrower than the Arabic one — and that, not the Arabic, is why the English
 * nine-fault label overlapped its own footer. Shortening the label is the fix
 * at the source; this constant is the fix in the model.
 *
 * Re-measure both if a label's wording changes, or if the row's `dt` column
 * stops being `auto`.
 */
const NAME_COLUMN_PX = 148;
const FAULT_COLUMN_PX = 149;

/**
 * How much height the two free-text rows have between them.
 *
 * ⚠️ **Measured, never derived, and it is the one number here that moves on
 * its own.** It is what the `dl` has left once the amount row, the payment row
 * and all four rows' own padding are placed: 84.1 − 23.6 − 16.0 − 5.7 = 38.8
 * px on the rendered 55 x 37 mm sheet. 37 is that, less a cushion — because
 * `justify-between` needs *some* positive free space, and zero is the value at
 * which it starts overlapping rather than spacing.
 *
 * Re-measure in a browser after changing the lockup, the footer, the fixed
 * rows or any row's leading. The arithmetic for it is deliberately not in this
 * file: a derived pool goes stale silently, a measured one goes stale loudly
 * the first time somebody renders a label.
 */
export const TEXT_POOL_PX = 37;

/**
 * Advance per character, in em, for this label's Arabic at its own sizes.
 *
 * ⚠️ Measured rather than read off the font: what matters is the average
 * advance of *this* text — Arabic names and fault words — not of a
 * representative glyph. Checked against four rendered cases, where 36
 * characters at 8 px occupied 148 px (0.51 em) and 90 characters at 7.2 px
 * occupied two lines of a 149 px column (0.46 em or less).
 */
const ADVANCE_EM = 0.46;

/**
 * Characters a line gives up to the word it could not fit.
 *
 * ⚠️ This is the pessimism. Set it to zero and the model assumes perfect
 * packing, which is what makes a fitter overflow on the one ticket nobody
 * tested. It is one number for both fields because both are Arabic prose of
 * similar word length — a fault list of short comma-separated segments packs a
 * little better than a name, and the difference is inside the margin.
 */
const WRAP_WASTE = 3;

/** CSS pixels per point, and the line height every label row is set on. */
const PX_PER_PT = 96 / 72;
const LEADING = 1.3;

export type TextFit = {
  /** The point size to set the text at. */
  pt: number;
  /** How many lines it will take at that size. */
  lines: number;
  /**
   * True when even the smallest rung overflows, so the caller must cut it.
   * On this catalogue's longest realistic ticket it is always false.
   */
  clamp: boolean;
};

/** The height a fit will actually occupy. */
export function heightOf(fit: TextFit): number {
  return fit.lines * fit.pt * PX_PER_PT * LEADING;
}

function linesFor(chars: number, pt: number, columnPx: number): number {
  const perLine = Math.max(1, Math.floor(columnPx / (ADVANCE_EM * pt * PX_PER_PT)) - WRAP_WASTE);
  return Math.max(1, Math.ceil(chars / perLine));
}

/**
 * The largest rung on which `text` fits inside `budgetPx`, with how many lines
 * it will take there.
 *
 * `budgetPx` is the height this field may occupy. The caller owns the pool;
 * this knows nothing about the sheet.
 */
function fit(
  text: string,
  budgetPx: number,
  sizes: readonly number[],
  columnPx: number,
): TextFit {
  const chars = text.trim().length;
  if (!chars) return { pt: sizes[0], lines: 1, clamp: false };

  for (const pt of sizes) {
    const lines = linesFor(chars, pt, columnPx);
    if (lines * pt * PX_PER_PT * LEADING <= budgetPx) return { pt, lines, clamp: false };
  }

  /*
   * Past the floor. Report the floor's size and as many lines as the budget
   * actually holds, so the caller clamps to a line count that fits rather than
   * to a number somebody guessed.
   */
  const pt = sizes[sizes.length - 1];
  const lines = Math.max(1, Math.floor(budgetPx / (pt * PX_PER_PT * LEADING)));
  return { pt, lines, clamp: true };
}

/** The fault, on the ladder written for it. */
export function fitFault(text: string, budgetPx: number): TextFit {
  return fit(text, budgetPx, FAULT_SIZES, FAULT_COLUMN_PX);
}

/** The customer's name, which shrinks but never as far as a long fault list. */
export function fitName(text: string, budgetPx: number): TextFit {
  return fit(text, budgetPx, NAME_SIZES, NAME_COLUMN_PX);
}

/**
 * One line of the name at its largest rung, plus a hair.
 *
 * ⚠️ **The name is fitted against ONE LINE, not against its share of the
 * pool.** Given a budget it could spend on two lines it does, and then the
 * fault is clamped — the one outcome that cuts words. A second line is
 * reachable only at the floor, where the fault's own single line is already
 * reserved below.
 */
const NAME_LINE_PX = 7.6 * PX_PER_PT * LEADING + 0.9;

/** One line of the fault at its floor, which the name may never eat. */
const FAULT_FLOOR_LINE_PX = 4.8 * PX_PER_PT * LEADING;

/**
 * Both free-text fields, sized against the sheet's one pool.
 *
 * The name goes first and is held to one line; the fault takes the rest. See
 * the header for why that order and not the other.
 */
export function fitLabelText(
  name: string,
  fault: string,
  poolPx: number = TEXT_POOL_PX,
): { name: TextFit; fault: TextFit } {
  const nameFit = fitName(name, Math.min(NAME_LINE_PX, poolPx - FAULT_FLOOR_LINE_PX));
  return { name: nameFit, fault: fitFault(fault, poolPx - heightOf(nameFit)) };
}
