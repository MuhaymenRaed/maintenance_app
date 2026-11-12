/**
 * Header controls sit on a translucent, blurred bar, so whatever scrolls
 * underneath shows through them. A `--line` hairline and a `--muted` glyph
 * both wash out at that opacity, which left the icon row reading as smudges
 * rather than buttons.
 *
 * ⚠️ **They are transparent now, and they used to be glass on glass.** Each
 * control carried `--surface` at 70% and its own backdrop blur, on a bar
 * that is already `--surface` at 80% with a blur — so every button drew a
 * second, slightly different pane inside the first, and the row read as a
 * strip of boxes stuck onto the bar rather than as part of it (the shop's
 * report, 2026-10-26: "not transparent as the navbar"). The bar supplies the
 * glass; a control is a hairline and a glyph on it. A tint arrives only under
 * the pointer, a press or focus — which is when a control should look like
 * one.
 *
 * The rim is `--ink` at 12%, not a fixed grey, so it is a dark hairline on
 * the light bar and a light one on the dark bar without a second rule.
 *
 * Every control shares one 1px rim. The locale pill used to draw 1.5px, which
 * on a 125–150% display renders as a visibly heavier line than the icon
 * buttons beside it; matching them is what keeps the row calm. The rim is
 * reinforcement rather than the control's only cue — the glyph sits at 4.5:1
 * and the fill, hover and focus ring all identify it — so `--line-strong` is
 * tuned for comfort at hairline width instead of being pushed to 3:1.
 */

const base =
  // shrink-0: these sit directly in the header's flex row, where the drawer
  // trigger was being squeezed to half width on a 360px screen.
  //
  // ⚠️ `glass-control` is a **marker class, not a utility**, and it is the only
  // hook `globals.css` has on these controls. The bar sits above a dialog's
  // scrim (70 over 60) and is still translucent, so the dimmed page behind it
  // shows *through* — and a control at `bg-surface/70` over that reads as a
  // smudge with a washed-out glyph in it. The rule that re-opaques them while a
  // modal is open cannot be written as a class here, because a class string
  // cannot carry the `body[data-scroll-locked]` ancestor it needs. See
  // "the bar, while a scrim is up" in `globals.css`.
  "glass-control shrink-0 border-ink/12 bg-transparent transition-[color,background-color,border-color,transform] duration-200 " +
  "hover:border-brand/45 hover:bg-brand/8 hover:text-brand active:scale-95 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/** Square icon button — search, cart, account, theme, menu. */
export const glassControl = `flex size-9 items-center justify-center rounded-[10px] border text-muted ${base}`;

/** Text pill — the locale switch. */
export const glassPill = `rounded-full border px-3 py-1.5 text-[0.78rem] font-bold text-ink ${base}`;

/**
 * Controls that sit **on a photograph** rather than on the header bar.
 *
 * The header's rim borrows `--line-strong` from the theme, which is right there
 * and wrong here: a product shot is not themed. A carousel dot drawn in white
 * disappears against a phone photographed on a white desk, which is precisely
 * how the hero's slide indicators became invisible — the control was still
 * there, and there was no way to see it.
 *
 * So these carry their own contrast rather than borrowing the page's: a dark
 * scrim, a blur, and a light rim. That pairing reads against a white studio
 * background and against a black one, because it never depends on the image
 * being either.
 */
export const mediaControl =
  "flex items-center justify-center rounded-full border border-white/25 bg-black/35 text-white " +
  "shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-md backdrop-saturate-150 transition-colors " +
  "hover:border-white/60 hover:bg-black/55 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** The tray a row of slide indicators sits in, for the same reason. */
export const mediaTray =
  "flex items-center gap-1.5 rounded-full border border-white/20 bg-black/30 px-2.5 py-1.5 " +
  "shadow-[0_2px_10px_rgba(0,0,0,0.3)] backdrop-blur-md backdrop-saturate-150";
