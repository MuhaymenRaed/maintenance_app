import { useTranslations } from "next-intl";
import { MARK_DOT, MARK_PATH, MARK_VIEWBOX } from "@/lib/brand/mark";

/**
 * Al-Esnad mark: a diamond plate carrying the brand dot and two ticks.
 *
 * Hand-authored rather than using `public/icon.svg` — that file is an
 * autotrace of an export that still had the transparency checkerboard
 * visible, so the pattern is baked in as ~820 grey paths and the diamond
 * only reads as negative space. This version is under 1KB, crisp at any
 * size, and themeable. Swap it out once a clean master exists.
 */
/**
 * The mark's geometry alone, in its own 48×48 space and with no `<svg>` around
 * it, so anything that already owns a viewBox can place it.
 *
 * It exists because the profile banner needs this shape at watermark scale and
 * the alternative was transcribing four elements into a second file. A mark
 * copied is a mark that drifts — the same argument that keeps one component
 * behind both showcase stars — and this one in particular has a history of
 * being redrawn from memory: the banner's watermark was a plain rounded square
 * rotated 45°, which is the diamond *plate* and none of the mark. The dot and
 * the two ticks are what make it Al-Esnad's rather than a lozenge.
 *
 * `dot` is a parameter rather than the hard-coded brand red, because a
 * watermark laid over a mesh built from a customer's own photograph cannot
 * assume the ground it will land on.
 */
/**
 * The Al-Esnad mark, as one path with the notches punched out of it.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ The previous geometry was not this logo
 * ---------------------------------------------------------------------------
 * It drew a rounded square rotated 45°, a centred dot, and **two thin diagonal
 * strokes** in a "notch" colour laid on top. Measured against `public/icon.svg`
 * on 2026-08-26 by rasterising it and classifying the pixels, every one of
 * those four decisions was wrong:
 *
 * | | drawn | actual |
 * |---|---|---|
 * | plate | rounded square, `rx=4` | a diamond with **sharp** corners |
 * | notches | strokes *added* on top | slots **cut out** of the plate |
 * | notch angle | up and to the right | down and to the left |
 * | dot | centred at 24,24 | 23.1, 24.2 — low and to the start side |
 *
 * The angle is what made it look broken rather than merely approximate: the
 * strokes ran along the wrong diagonal, so the upper one crossed the plate's
 * own edge and floated outside it. That is the "disfigured" shape, and it was
 * on the header, the footer, the profile banner and the PWA icons.
 *
 * The real mark is a diamond with two parallel slots stabbing in from the
 * upper-right edge toward the centre — negative space, which is why the
 * autotrace in `public/icon.svg` could only represent them as checkerboard.
 *
 * ---------------------------------------------------------------------------
 * Why one path with `fill-rule="evenodd"` rather than a mask
 * ---------------------------------------------------------------------------
 * The slots have to be genuinely transparent, not painted in a background
 * colour. Painting them was the old approach and it only works while you know
 * what is behind: `var(--canvas)` is right on a page and wrong on the profile
 * banner's mesh, which is exactly where the mark looked like a grey smear with
 * two lighter scratches on it.
 *
 * A `<mask>` would do it and needs an `id`, and an id needs `useId` — a hook,
 * which cannot run in the Server Components that render the footer's logo. Two
 * subpaths under `evenodd` punch the same holes with no id and no hook, so one
 * component serves every caller on both sides of the boundary.
 */
/*
 * The geometry lives in `lib/brand/mark.ts`.
 *
 * ⚠️ It used to be literals here, and in `scripts/make-pwa-icons.mjs`, and in
 * `app/[locale]/opengraph-image.tsx` — three copies, each with a comment saying
 * "change one, change the other". When the mark was finally *measured* against
 * the shop's own artwork, two of the three were still on the superseded values.
 * The comment had not helped anybody, so the numbers moved somewhere all three
 * can import them.
 */

export function BrandMarkShape({
  plate = "var(--mark-ink)",
  dot = "var(--mark-red)",
}: {
  /** Diamond fill. */
  plate?: string;
  /** The centre dot. */
  dot?: string;
}) {
  return (
    <>
      <path d={MARK_PATH} fillRule="evenodd" fill={plate} />
      <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} fill={dot} />
    </>
  );
}

export function BrandMark({
  className,
  plate = "var(--mark-ink)",
  dot = "var(--mark-red)",
}: {
  className?: string;
  /** Diamond fill. */
  plate?: string;
  /**
   * The centre dot.
   *
   * `BrandMarkShape` has always taken one and this wrapper did not pass it
   * through, so every caller got `var(--brand)` whatever ground it was drawn
   * on. That is right on a page and wrong on a plate that does not invert:
   * `BrandLockup` sits on `--scrim` in both themes, so a themed dot would be
   * two different reds on one identical grey.
   */
  dot?: string;
}) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} aria-hidden>
      <BrandMarkShape plate={plate} dot={dot} />
    </svg>
  );
}

export function BrandLogo({
  inverted = false,
  showTagline = true,
  taglineAlways = false,
  compact = false,
  className,
}: {
  /** The footer sits on a fixed dark plate regardless of theme. */
  inverted?: boolean;
  showTagline?: boolean;
  /** Keep the tagline at every width — see the note on it below. */
  taglineAlways?: boolean;
  /**
   * Drop the name below `md`, leaving the mark. Only the header passes it:
   * every other caller — the drawer's own heading, the 404, the auth and admin
   * layouts, the navigation veil — draws the lockup in a column with room, and
   * in most of them the name is the only thing naming the shop on that screen.
   */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("Brand");

  /*
   * ⚠️ The mark is sized against the *text block*, not against the bar.
   *
   * With the short name it was a 36px diamond beside one 18px word and the two
   * balanced. "شركة الاسناد" is nearly twice as wide, and the same diamond then
   * read as an afterthought pinned to the front of a long wordmark — which is
   * what "not coordinated" means here. A lockup is coordinated when the mark's
   * height matches the height of the type beside it: `size-9`/`size-10` against
   * a name at 1.05–1.2rem sitting on a tagline, which is ~34–40px of text.
   */
  /*
   * ⚠️ `var(--mark-ink)`, not `var(--ink)`.
   *
   * This override is what kept the header's mark on the near-black text colour
   * after `--mark-ink` was introduced — the token was set, every other renderer
   * picked it up, and the one lockup a visitor sees on every page did not,
   * because this call site was passing its own value. The shop reported it as
   * "you forgot to update the logo", and they were right: a default is only a
   * default where nobody overrides it.
   *
   * The inverted branch stays a literal. The footer's plate is fixed dark in
   * both themes, so a token that inverts would turn the mark charcoal-on-
   * charcoal exactly half the time.
   */
  const mark = (
    <BrandMark
      className="size-8 shrink-0 min-[380px]:size-9 sm:size-10"
      plate={inverted ? "#EEF0F4" : "var(--mark-ink)"}
    />
  );

  /*
   * ⚠️ The size steps down between `sm` and `xl`, and that is a budget, not a
   * preference.
   *
   * `Brand.name` was the short form — "الاسناد" — and is now the full trading
   * name, "شركة الاسناد". That is right: the shop's own sign says the full
   * name and the site was introducing itself by a nickname. It is also roughly
   * **60px wider** in the header, and the header's row is measured to the
   * pixel: `store-nav.tsx` records that seven links plus the mark plus the
   * control cluster land near 999px at a 1024px viewport for a signed-in
   * member of staff. Sixty more overflows it.
   *
   * So the name sets smaller in exactly the band where the room is tight —
   * `lg` and `xl`-minus-one — and returns to full size at `xl`, where the
   * tagline reappears and there is space for both. Paired with the nav's
   * `px-1.5` below `xl` (the other half of the same re-measurement), the bar
   * lands back under 1024 with room.
   *
   * The short form is *not* the fallback for a narrow screen. A brand that
   * calls itself two different things depending on viewport width is worse
   * than one that sets its name a point smaller.
   */
  /*
   * ⚠️ `whitespace-nowrap`, never `truncate`.
   *
   * It was `truncate`, which protects the layout by cutting the string — and
   * the string is the shop's name. "شركة الاس…" in the corner of every page is
   * worse than a bar that is a few pixels tight, and it is the failure mode a
   * longer name makes likely rather than theoretical. The size steps below are
   * what actually buys the room; this makes sure the name is never the thing
   * that gives way.
   *
   * `leading-none` on both lines and a 2px gap between them, so the pair reads
   * as one block against the mark rather than as two loosely stacked lines.
   */
  const name = (
    /*
     * ⚠️ The name is **brand red**, in both themes, and that is the shop's
     * lockup rather than a highlight.
     *
     * Their own sign is a charcoal mark beside a red wordmark over a grey
     * trading line, and the site had been setting the wordmark in `--ink` —
     * so the one place the brand introduces itself was the one place it was
     * not using its own colour. Instruction of 2026-10-01, with a picture of
     * the sign: *"the Sharikat Al Isnad must be written in red and the letter
     * E must be with the same gray colour."*
     *
     * `--brand` rather than a literal, so it lifts to `#ff5f6e` on the dark
     * palette the way every other red on the site does — a pinned `#E11D2E`
     * would sit at 3.1:1 on `--surface` in dark mode. It is display type at
     * `font-black`, so the light theme's 4.8:1 is comfortably past the 3:1 a
     * large graphic needs.
     *
     * The tagline below stays `--muted`: the sign sets it in grey, and two
     * reds would make the lockup one block of colour instead of a mark, a
     * name and a line under it.
     */
    <span
      className="whitespace-nowrap text-[0.92rem] font-black leading-none tracking-[-0.03em] min-[380px]:text-[1rem] sm:text-[1.08rem] xl:text-[1.18rem]"
      style={{ color: inverted ? "#FF5F6E" : "var(--brand)" }}
    >
      {t("name")}
    </span>
  );

  /*
   * Sized *up* from 0.58rem, and that is the other half of "not coordinated".
   *
   * A nine-word Arabic tagline at 0.58rem under a 1.08rem wordmark is a hairline
   * of grey under a heavy black line — two elements that plainly do not belong
   * to each other. At 0.66rem with the same `leading-none` it reads as the
   * second line of one lockup, which is what it is.
   */
  /*
   * ⚠️ **`--mark-ink`, not `--muted`**, and the difference is whose grey it is.
   *
   * `--muted` is a *page* token: body copy, card meta, inactive nav, solved to
   * 4.5:1 against both surfaces and retuned whenever legibility asks. This line
   * is not page copy — it is the third element of the shop's own lockup, and
   * the sign above the door sets it in the same grey as the mark beside it.
   * Leaving it on `--muted` meant the mark moved to #333333 and the line under
   * it did not, so the lockup carried two greys that were nearly but not quite
   * the same: the difference nobody can name, which this codebase has already
   * learned to read as a mistake rather than a decision — the partner wall's
   * two purples, the twelve tiles' two golds.
   *
   * Instruction of 2026-10-01, after the mark took the brand grey: *"make
   * لتجارة الهاتف النقال be in gray too."* So the lockup is now exactly the two
   * colours the identity has: mark and trading line in the grey, name in the
   * red.
   *
   * It inverts with the theme to the shop's own white mark, which is why the
   * token is right where a literal `#333333` would not be. The `inverted`
   * branch keeps its literal for the reason the mark's does: the footer's plate
   * is fixed dark in both themes, so a token that inverts would put a white
   * line on a near-white one exactly half the time.
   */
  const tagline = showTagline ? (
    <span
      className="mt-[3px] whitespace-nowrap text-[0.66rem] font-semibold leading-none"
      style={{ color: inverted ? "#8A8F9D" : "var(--mark-ink)" }}
    >
      {t("tagline")}
    </span>
  ) : null;

  /*
   * The footer's copy — **the same lockup the bar sets**, with the tagline kept
   * at every width.
   *
   * ⚠️ It was a row of its own under mark and name together, and the shop
   * rejected that on 2026-10-03: *"fix the postion of لتجارة الهاتف النقال in
   * the footer to be elegant and postioned correctly as in the nav bar."*
   *
   * The reasoning for the old arrangement is worth keeping because it was not
   * wrong about the geometry: the tagline is the wider of the two lines, so a
   * column holding both is as wide as the tagline while the mark sits beside
   * only part of it — and centred on a phone that put the tagline’s midpoint
   * half a mark’s width from the lockup’s. True, and it solved the wrong
   * problem. The header has always stacked them and reads correctly, because a
   * lockup is **mark, then a block of type** — the type’s own lines align with
   * each other on the inline edge they share, and the mark aligns with the
   * block. Pulling one line out to centre it under everything is what made the
   * footer read as a third thing rather than as the shop’s name.
   *
   * `items-start` is what keeps the mark level with the *name* rather than
   * floating in the middle of a two-line column — the one difference from the
   * bar, where there is only ever one line to be level with below `md`.
   */
  if (taglineAlways) {
    return (
      <span
        className={`flex items-start justify-center gap-2 sm:justify-start sm:gap-2.5 ${className ?? ""}`}
      >
        {mark}
        <span className="flex min-w-0 flex-col items-start leading-none">
          {name}
          {tagline}
        </span>
      </span>
    );
  }

  return (
    <span className={`flex items-center gap-2 sm:gap-2.5 ${className ?? ""}`}>
      {mark}
      {/*
       * ⚠️ The name is absent below `md`, and that is the resolution of a
       * contradiction this file had been carrying.
       *
       * Two rules were both right and could not both hold in a 375px bar. The
       * name must never be cut, so it is `whitespace-nowrap` — and the bar
       * must never overlap, so its `Link` is `min-w-0 shrink`. A nowrap string
       * in a shrinking box does not shrink: it overflows, and the controls to
       * its inline end sit on top of it. Measured on an iPhone SE with a staff
       * session — drawer, mark, name, track, bell, theme, dashboard, avatar —
       * the name rendered as «شركة الا» with the filter glyph across it. That
       * is the "top navbar has overlaying" report, and it was worse than the
       * truncation the nowrap rule was written to prevent, because a control
       * printed over a word is not even legible as a cut word.
       *
       * Hiding it is the one answer that keeps both rules. The mark carries
       * the identity on its own — it is the shop's sign, measured from the
       * shop's own artwork — and the name is still set in full in the drawer,
       * the footer, the hero lockup and every page title. Nothing is cut and
       * nothing overlaps.
       */}
      <span
        className={
          compact
            ? "hidden min-w-0 flex-col leading-none md:flex"
            : "flex min-w-0 flex-col leading-none"
        }
      >
        {name}
        {/*
         * `hidden xl:block` in the header's copy.
         *
         * The tagline is nine words in Arabic and it is the widest thing in the
         * bar after the nav. It is descriptive rather than functional — the mark
         * and the name identify the shop on their own — so it is the first thing
         * to give way, and giving way is what buys the inline links the room to
         * start at `lg` instead of `xl`. Between the two it is absent and the
         * six links are present, which is the right trade: one is navigation,
         * the other is a subtitle.
         */}
        {tagline && <span className="mt-1 hidden xl:block">{tagline}</span>}
      </span>
    </span>
  );
}

/**
 * The shop's full lockup — the one painted on the shopfront.
 *
 * ---------------------------------------------------------------------------
 * Why this is not `BrandLogo`
 * ---------------------------------------------------------------------------
 * `BrandLogo` is the *signature*: mark, short name, descriptive tagline. It
 * goes in the header and the footer, where it has to survive being small,
 * sitting beside six nav links, and giving up its tagline below `xl`.
 *
 * This is the *identity*: the trading name in full — شركة الاسناد لتجارة
 * الهاتف النقال — with the year the shop opened. It is what a customer sees
 * above the door, and it is said once, at the top of the home page, where a
 * first-time visitor is deciding whether this is a real shop. Saying it in
 * both places would make the header heavier for no gain; saying it in neither
 * loses the only bit of the brand that carries any history.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ The lettering is OURS, and it has to be
 * ---------------------------------------------------------------------------
 * The shop's artwork sets that name in **DG Rafah** and **Franklin Gothic
 * Heavy** — `assets/brand/isnad1/font/fontTable.dat` names both — and the
 * archive does not carry either file, because the lettering was converted to
 * curves before it was saved. Knowing the name of a typeface is not the same
 * as having it.
 *
 * So this is set in Expo Arabic, the site's own face, and that is a deliberate
 * choice rather than a shortfall. Cutting letterforms to imitate a face we do
 * not have licensed is the hand-drawn-brand-mark mistake wearing different
 * clothes — the one that produced a defaced realme and a defaced Huawei — and
 * the rule the partner wall settled on applies unchanged: a **sourced mark**
 * plus a **name plainly typeset** is a caption, and a caption is honest.
 *
 * The mark itself is the measured geometry from `lib/brand/mark.ts`, so the
 * one element that *is* reproduced exactly is the one element that can be.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ There is no plate behind this, and there was one twice
 * ---------------------------------------------------------------------------
 * The first version drew the mark in `--ink` on the hero's own `--surface`,
 * which was correct and read as an element floating in a column of white. The
 * second brought a ground — a graded charcoal panel reproducing the shopfront
 * sign, white diamond and red wordmark — which was faithful and was a dark slab
 * in the top corner of a light page.
 *
 * What is here now is neither: the mark, the name and the year, on the page,
 * with space around them and a hairline underneath. The reasoning is the one
 * this codebase keeps arriving at — *the space around a thing is the design* —
 * and it is the same argument that took the scrim off the hero stage and the
 * frame off every product card.
 *
 * So the mark is `--ink` again and everything here inverts with the theme,
 * because there is no longer a fixed ground for it to disagree with. The
 * pinned `SIGN_RED` and `SIGN_PLATE` constants went with the panel.
 */
export function BrandLockup({ className }: { className?: string }) {
  const t = useTranslations("Brand");

  return (
    /*
     * A row, start-aligned, the way the shop's own reference draws it
     * (2026-10-22): the mark, then the name over the trading line, and the
     * year on a pill at the far end of that second line.
     *
     * ⚠️ The pill is on the trading line's row, not on the lockup's. Aligned
     * to the whole block it floats between the two lines; on the second line's
     * own row it sits on that line's baseline, which is where the reference
     * puts it. `flex-wrap` is the narrow-column fallback: the pill drops under
     * the trading line rather than squeezing the shop's name.
     *
     * Not a heading any more — the hero's headline is back and is the page's
     * `h1`. This is the signature above it.
     *
     * ⚠️ The text column shrink-wraps and the pill follows the trading line
     * at a fixed gap — never `justify-between`. Pushed to the far end of a
     * 400px column the year sat a hand's width from the words it qualifies
     * and read as a separate badge (the shop's report, 2026-10-22). The
     * lockup is centred at every width, over a centred headline (2026-10-23).
     */
    <div className={`flex w-full items-center justify-center gap-4 max-sm:gap-3 ${className ?? ""}`}>
      <BrandMark className="size-[4.25rem] shrink-0 max-sm:size-12" />

      <div className="min-w-0">
        <p className="whitespace-nowrap text-[clamp(1.5rem,2.2vw,2rem)] font-black leading-none text-brand">
          {t("legalName")}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <p className="text-[0.95rem] font-extrabold leading-snug text-mark-ink max-sm:text-[0.86rem]">
            {t("trade")}
          </p>

          {/*
           * Latin in both locales, like every caption on the partner wall, so
           * it is pinned `ltr` — and its tracking is an inline style rather
           * than a `tracking-*` utility because `[dir="rtl"] *` in
           * globals.css pins letter-spacing to `normal` across the Arabic
           * tree. As a utility it would be wide in English and tight in Arabic.
           */}
          <span
            dir="ltr"
            style={{ letterSpacing: "0.12em" }}
            className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-[0.64rem] font-black uppercase leading-none text-white max-sm:px-2.5 max-sm:py-1.5 max-sm:text-[0.58rem]"
          >
            {t("since")}
          </span>
        </div>
      </div>
    </div>
  );
}
