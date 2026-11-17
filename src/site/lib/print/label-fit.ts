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
 * A character count cannot know where a line will break, so a long fault list
 * that sits near a line boundary is estimated a line longer than it renders,
 * and the fitter drops a rung it might not have needed.
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
 * the ladder harder to reason about. Six rungs cover one fault to about
 * twelve. The top rung is the label's body size — every value on the sticker
 * is set at it when there is room — and the floor is the printer's (see the
 * header). On Arabic the floor is never reached by a realistic ticket; it is
 * there for a four-part Latin name over nine faults.
 */
export const FAULT_SIZES = [8.4, 7.6, 6.8, 6, 5.4, 4.8] as const;

/** The name's ladder: shorter than the fault's, and stopping above its floor. */
export const NAME_SIZES = [8.4, 7.6, 6.8, 6] as const;

/**
 * The width of the value column, in CSS pixels.
 *
 * ⚠️ **One column for both fields since 2026-11-17**, because the label is one
 * grid now and every value starts on the same line. Its width is whatever the
 * widest label leaves, so it is **measured in BOTH locales and the narrower is
 * written down**:
 *
 *     ar 144.1   («مبلغ الصيانة:» is the widest label)   en 154.5   ->  144
 *
 * Re-measure both if a label's wording changes or the label column's padding
 * does.
 */
const NAME_COLUMN_PX = 144;
const FAULT_COLUMN_PX = 144;

/**
 * How much height the two free-text rows have between them.
 *
 * ⚠️ **Measured, never derived, and it is the one number here that moves on
 * its own.** It is what the table has left once its padding, the amount row
 * (its rule included) and the two row gaps are placed: 93 − 7.6 − 28.5 − 9.4
 * = 47.5 px on the rendered 55 x 37 mm sheet, measured 2026-11-17. 46 is that
 * less a cushion. It was 37 before the phone numbers moved into the header and
 * the payment into the amount row; those two moves are where the extra room
 * came from.
 *
 * Re-measure in a browser after changing the lockup, the footer, the amount
 * row or any row's leading. The arithmetic for it is deliberately not in this
 * file: a derived pool goes stale silently, a measured one goes stale loudly
 * the first time somebody renders a label.
 */
export const TEXT_POOL_PX = 46;

/**
 * Advance per character, in em, by field and by script.
 *
 * ⚠️ **Measured in the label's own bold face, and Latin is the wide one.**
 * Expo Arabic in bold, per character, 2026-11-17:
 *
 *     Arabic name   0.494     Latin name    0.557 – 0.570
 *     Arabic fault  0.424     Latin fault   0.489
 *
 * There used to be one figure, 0.46, calibrated on Arabic — and it put a
 * four-part Latin name on one line that in fact takes two, which is what
 * pushed the English nine-fault label into its own footer. A name advances
 * further than a fault list because it has fewer spaces and commas in it.
 * Each figure is rounded up: this model errs pessimistic, on purpose.
 */
const ADVANCE_EM = {
  name: { arabic: 0.5, latin: 0.58 },
  fault: { arabic: 0.46, latin: 0.5 },
} as const;

type Field = keyof typeof ADVANCE_EM;

/** Which advance a text takes: Latin when it has more Latin letters than Arabic ones. */
function advanceOf(text: string, field: Field): number {
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  const arabic = text.match(/[؀-ۿ]/g)?.length ?? 0;
  return ADVANCE_EM[field][latin > arabic ? "latin" : "arabic"];
}

/**
 * Characters a line gives up to the word it could not fit.
 *
 * ⚠️ This is the pessimism. Set it to zero and the model assumes perfect
 * packing, which is what makes a fitter overflow on the one ticket nobody
 * tested. It applies only to a text that wraps: a text that fits on one line
 * whole wraps nothing and gives nothing up, and charging it the waste anyway
 * is what told a 36-character name that fits that it does not.
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

function linesFor(text: string, field: Field, pt: number, columnPx: number): number {
  const charPx = advanceOf(text, field) * pt * PX_PER_PT;
  if (text.length * charPx <= columnPx) return 1;
  const perLine = Math.max(1, Math.floor(columnPx / charPx) - WRAP_WASTE);
  return Math.max(2, Math.ceil(text.length / perLine));
}

/**
 * The largest rung on which `text` fits inside `budgetPx`, with how many lines
 * it will take there.
 *
 * `budgetPx` is the height this field may occupy. The caller owns the pool;
 * this knows nothing about the sheet.
 */
function fit(
  raw: string,
  field: Field,
  budgetPx: number,
  sizes: readonly number[],
  columnPx: number,
): TextFit {
  const text = raw.trim();
  if (!text) return { pt: sizes[0], lines: 1, clamp: false };

  for (const pt of sizes) {
    const lines = linesFor(text, field, pt, columnPx);
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
  return fit(text, "fault", budgetPx, FAULT_SIZES, FAULT_COLUMN_PX);
}

/** The customer's name, which shrinks but never as far as a long fault list. */
export function fitName(text: string, budgetPx: number): TextFit {
  return fit(text, "name", budgetPx, NAME_SIZES, NAME_COLUMN_PX);
}

/**
 * One line of the name at its largest rung, plus a hair.
 *
 * ⚠️ **The name is fitted against ONE LINE, not against its share of the
 * pool.** Given a budget it could spend on two lines it does, and then the
 * fault is clamped — the one outcome that cuts words.
 */
const NAME_LINE_PX = NAME_SIZES[0] * PX_PER_PT * LEADING + 0.9;

/** One line of the fault at its floor, which the name may never eat. */
const FAULT_FLOOR_LINE_PX = FAULT_SIZES[FAULT_SIZES.length - 1] * PX_PER_PT * LEADING;

/**
 * Both free-text fields, sized against the sheet's one pool.
 *
 * The name goes first and is held to one line; the fault takes the rest. See
 * the header for why that order and not the other.
 *
 * ⚠️ **A name too long for one line even at the floor takes two, at the
 * floor.** Reporting it as clamped is no answer: nothing on the sheet clamps
 * a value (an Arabic line box is shorter than its own ink, so `overflow:
 * hidden` cuts the tops off the letters), so the page wraps it anyway, and
 * the fault — sized against a name of one line — then pushes the amount into
 * the footer. The second line is planned for here, and the fault is fitted
 * into what is genuinely left. Two lines and no more: a name that needs a
 * third is not a name anybody types at a counter.
 */
export function fitLabelText(
  name: string,
  fault: string,
  poolPx: number = TEXT_POOL_PX,
): { name: TextFit; fault: TextFit } {
  let nameFit = fitName(name, Math.min(NAME_LINE_PX, poolPx - FAULT_FLOOR_LINE_PX));
  if (nameFit.clamp) {
    const floor = NAME_SIZES[NAME_SIZES.length - 1];
    const twoLines = 2 * floor * PX_PER_PT * LEADING + 0.9;
    nameFit = fit(name, "name", Math.min(twoLines, poolPx - FAULT_FLOOR_LINE_PX), [floor], NAME_COLUMN_PX);
  }
  return { name: nameFit, fault: fitFault(fault, poolPx - heightOf(nameFit)) };
}
