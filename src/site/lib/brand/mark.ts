/**
 * The Al-Esnad mark, as geometry. One copy, for every renderer.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * The mark had three transcriptions and they had already diverged:
 * `components/store/brand-logo.tsx` for the app, `scripts/make-pwa-icons.mjs`
 * for the launcher icons, and `app/[locale]/opengraph-image.tsx` for the share
 * card. Each carried the numbers as literals with a comment saying "change one,
 * change the other" — and when the geometry was finally *measured* against the
 * shop's own artwork, two of the three were still on the old values and the
 * comment had not helped anybody.
 *
 * They cannot share a *component*: the icon script is a Node build script with
 * no React, and `next/og` renders through Satori, which cannot run a component
 * built on Tailwind classes and CSS custom properties. What they can share is
 * this — plain strings and numbers, importable from all three.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ READ OFF THE SHOP'S VECTOR ARTWORK (2026-10-26). Do not adjust by eye.
 * ---------------------------------------------------------------------------
 * The slots and the dot are now the shop's own vector geometry, taken from
 * `assets/brand/lockup/page.svg` — the identity sheet, which draws the mark
 * twice (paths 36 and 37) and the two copies agree to three decimals once
 * each is scaled into this 48-unit box. The dot is fitted from its four
 * on-curve points, which sit on one radius to the third decimal.
 *
 * That replaced the bitmap trace described below, and the trace was off in
 * the direction a reader feels: its slots were ~20% too wide (3.31 units
 * against 2.77) and its dot 14% too large in radius (7.32 against 6.43),
 * which together made the mark heavier than the shop's — "not exactly our
 * logo" was the report. A trace of an 82-pixel preview cannot resolve a
 * two-unit slot; the vector has no such limit.
 *
 * The history, kept because the method is still worth knowing: every value
 * used to come from `scripts/trace-brand-mark.mjs`, which reads the
 * preview bitmap inside `assets/brand/isnad1/` — the shop's own CorelDRAW artwork —
 * reconstructs the shape, rasterises it, and reports its disagreement with the
 * source. The current figures verify at **1.76%** of pixels, which on an
 * 82-pixel-wide source made almost entirely of diagonal edges is anti-aliasing
 * and nothing else.
 *
 * That script exists because this mark has been wrong twice. The first version
 * drew a rounded square with strokes laid *on top*, on the wrong diagonal. The
 * second fixed the plate and the fill rule and still had the dot in the wrong
 * place — it moved it in the right direction and stopped short. Both were
 * plausible, and plausible is what the check now refuses.
 *
 * **To change anything here, re-run the script.** It prints these values ready
 * to paste and refuses to emit above 4% disagreement.
 */

/**
 * The plate: a square rotated 45°, filling the 48-unit box exactly.
 *
 * Not inset. The previous hand-drawn version sat 0.8 units inside the box,
 * which is invisible on its own and wrong the moment anything is aligned to it.
 */
export const MARK_PLATE = "M24 0 L48 24 L24 48 L0 24 Z";

/**
 * The two slots.
 *
 * Congruent parallel bars at 45°, each 2.77 units wide, and both open *onto*
 * the upper-right edge — which is why each ends on the boundary rather than
 * short of it.
 *
 * ⚠️ They are drawn as subpaths of the plate under `fill-rule="evenodd"`, which
 * punches them out as genuine holes. Painting them in a background colour was
 * the original approach and only works while you know what is behind: correct
 * on a page, wrong on the profile banner's mesh, where the mark read as a grey
 * smear with two lighter scratches on it.
 */
export const MARK_NOTCHES =
  "M20.808 15.876 L22.769 17.836 L32.302 8.302 L30.342 6.342 Z " +
  "M30.164 25.232 L32.124 27.192 L41.658 17.658 L39.698 15.698 Z";

/** Plate and slots as one `d`. This is what every caller draws. */
export const MARK_PATH = `${MARK_PLATE} ${MARK_NOTCHES}`;

/**
 * The dot.
 *
 * Not centred: it sits low and toward the start edge. The previous version had
 * that much right and the amount wrong, by nearly three units on both axes.
 */
export const MARK_DOT = { cx: 20.669, cy: 27.326, r: 6.426 } as const;

/**
 * The dot as a subpath, for a mark drawn in ONE colour.
 *
 * ⚠️ The mark is an E with a circle inside it, and a single-colour render that
 * draws only `MARK_PATH` is the E without its circle — which is what the daily
 * diamond's strike button and its streak row shipped (reported 2026-10-26).
 * Under `fill-rule="evenodd"` this punches the dot out of the plate, which is
 * the shop's own black-with-white-dot treatment: correct on any ground,
 * because the hole shows whatever is behind it.
 */
export const MARK_DOT_PATH =
  `M${(MARK_DOT.cx - MARK_DOT.r).toFixed(3)} ${MARK_DOT.cy} ` +
  `a${MARK_DOT.r} ${MARK_DOT.r} 0 1 0 ${(MARK_DOT.r * 2).toFixed(3)} 0 ` +
  `a${MARK_DOT.r} ${MARK_DOT.r} 0 1 0 ${(-MARK_DOT.r * 2).toFixed(3)} 0 Z`;

/** Plate, slots and dot as one `d`, for a mark that has a single colour. */
export const MARK_MONO_PATH = `${MARK_PATH} ${MARK_DOT_PATH}`;

/** The mark's own coordinate space. */
export const MARK_VIEWBOX = "0 0 48 48";
