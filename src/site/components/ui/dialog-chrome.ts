/**
 * The scrim behind every dialog and drawer in this app.
 *
 * ---------------------------------------------------------------------------
 * Why it is one constant and not nine copies of a class string
 * ---------------------------------------------------------------------------
 * There were nine — the cart drawer, the filter drawer, the mobile nav, the
 * install prompt, the policy dialog, the review dialog, the order editor, the
 * orders board and the whole admin form kit — and they had already drifted on
 * the blur: two-thirds carried `backdrop-blur-[2px]` and the rest `[3px]`, for
 * no reason anybody could have stated. That is exactly the seam a reader
 * notices without being able to name, and it is what `form-kit.tsx` was
 * extracted to stop happening to the dialogs *inside* the scrim.
 *
 * ⚠️ **`z-60` is load-bearing and is not a free choice.** The scale is written
 * out at the top of `globals.css`: a dialog's scrim sits *below* the sticky
 * site header (70) and its content *above* it (80). Raising this to cover the
 * header is the regression that made the bar unreadable — `--scrim` at 60%
 * over `--surface` at 80% darkens a light bar until the `--ink` text on it
 * stops reading, which is a blank slab where the header was rather than a
 * dimmed header.
 *
 * The blur is 2px throughout. It is not there to obscure anything — the scrim
 * does that — but to stop a page of hard type reading as *sharp* behind a
 * translucent panel, which is what makes a drawer look like it is floating
 * rather than laid on top. 3px costs a mid-range Android phone real frames on
 * the open animation and buys nothing anybody can see.
 */
export const dialogOverlay =
  "fixed inset-0 z-60 bg-scrim/60 backdrop-blur-[2px] " +
  "data-[state=open]:[animation:dialog-overlay-in_150ms_ease-out]";
