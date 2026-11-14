/*
 * ⚠️ Relative, with the extension — never the `@/` alias. Two test files load
 * this module through node's own resolver, which knows nothing about
 * tsconfig paths, and an alias here fails the WHOLE file with
 * `Cannot find package '@/lib'` — every assertion inside it passing, the
 * tally two files short, and nothing in the summary saying why. The same rule
 * `lib/data/queue-window.ts` already follows for `./date-window.ts`.
 */
import { LOCAL_PROVINCE } from "./delivery-zones.ts";

/**
 * Single source of truth for the company's public contact details and
 * social profiles. Kept out of the database because these are chrome,
 * not catalogue data, and are needed for static metadata too.
 */
export const site = {
  email: "alesnad@alisnad.iq",
  /**
   * The shop's own service line — a four-digit national short code.
   *
   * ⚠️ **It is a separate field from `phones`, and merging them would break
   * WhatsApp everywhere.** `whatsappNumber` in `lib/data/whatsapp.ts` only
   * accepts an Iraqi mobile written `07XXXXXXXXX`: it rewrites the leading
   * zero to `964` and hands the result to `wa.me`, which resolves nothing
   * from a short code. A `7274` in that list would produce a link opening
   * WhatsApp's "phone number shared via url is invalid" page — which staff and
   * customers alike read as the feature being broken rather than as the number
   * being the wrong kind.
   *
   * So: this is what "call us" means, everywhere the shop offers a call. The
   * two mobiles below stay, because they are what WhatsApp needs and what a
   * caller from outside the country can dial.
   */
  serviceNumber: "7274",
  /**
   * The counter mobiles. WhatsApp-capable, and the fallback for anyone a
   * short code will not reach.
   */
  phones: ["07710500250", "07809007004"],
  /**
   * The WhatsApp call centre — the shop named it on 2026-10-26. Every
   * "message us on WhatsApp" link reads this, never `phones[0]`, which is the
   * counter's line and was the WhatsApp target by accident of order.
   * `settings.whatsapp_number` holds the same number for the three screens
   * that read the database instead (the buy box, the repair wizard, /track).
   */
  whatsapp: "07809007004",
  /**
   * The two numbers printed on a repair card, as the shop's own card carries
   * them — the desk's lines, not the storefront's.
   */
  repairCardPhones: ["07733441070", "07715009009"],
  social: {
    facebook: "https://www.facebook.com/esnadFor.mobile",
    instagram: "https://www.instagram.com/al_esnad1",
    tiktok: "https://www.tiktok.com/@alesnad1",
  },
} as const;

/** The name used wherever the shop identifies itself to a machine reader. */
export const SITE_NAME =
  "شركة الاسناد لتجارة الهاتف النقال — Al-Esnad Company";

/**
 * The public origin, or `null` when it has not been configured.
 *
 * `null` is a real answer and callers must handle it. Structured data is the
 * only consumer so far, and JSON-LD cannot use a relative URL — it declares
 * *which site* a search endpoint belongs to. Guessing a domain would publish a
 * `SearchAction` pointing at somebody else's, which is worse than publishing
 * none, so the component renders nothing until this is set.
 *
 * Read from the environment rather than hard-coded for the same reason
 * `NEXT_PUBLIC_R2_PUBLIC_URL` is: a preview deployment and production are not
 * the same origin, and neither should be baked into a build.
 */
export const SITE_ORIGIN: string | null =
  process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") || null;

/**
 * Official brand colours, keyed by `brands.code`. The database has no
 * colour column, and these are fixed brand identities rather than data
 * the shop would ever edit. They tint the marks in `BrandStrip`, which are
 * single-colour silhouettes.
 *
 * Each carries a lightened `dark` variant: several official marks are
 * deep navy or forest green and fall below readable contrast on the dark
 * surface. Brands with no entry (Apple) fall back to the ink token, which
 * is what that mark wants anyway — black on light, white on dark.
 */
export const brandColors: Record<string, { light: string; dark: string }> = {
  samsung: { light: "#1428A0", dark: "#7B95FF" },
  honor: { light: "#CF0A2C", dark: "#FF6B7E" },
  oppo: { light: "#1D5D2E", dark: "#5CC97A" },
  infinix: { light: "#E31E24", dark: "#FF7B7B" },
  // Taken from the fill on Tecno's own logo file
  tecno: { light: "#0064FE", dark: "#5CB3FF" },
  // Both taken from realme's own logo file, which sets dark ink on yellow.
  // The yellow alone is ~1.6:1 on a white surface, so the ink carries the
  // light theme and the yellow carries the dark one.
  realme: { light: "#111111", dark: "#FFC915" },
  huawei: { light: "#CF0A2C", dark: "#FF6B7E" },
  // Straight off the official wordmark file — `rgba(230, 0, 64, 1)`. Measures
  // 4.73:1 on `--surface`, comfortably the strongest end of this map.
  // Lightened for dark, like every other mark here.
  redmi: { light: "#E60040", dark: "#FF6B8A" },
  /*
   * ── Added 2026-09-30 with the six makes the shop asked to carry ──────────
   * Only the three Simple Icons actually ships are here. **Blackview, ZTE and
   * nubia are deliberately absent**, and adding them from memory would be the
   * same mistake as redrawing their marks: a brand colour invented to within
   * "about right" is a brand colour that is wrong, and this map's whole claim
   * is that these are the makes' own values. With no entry the cell falls
   * through to `--ink`, which is the treatment Huawei's caption already takes
   * and is honest — we have nothing of theirs to reproduce.
   *
   * Each `dark` is *solved* to clear 4.5:1 on the dark surface at the mark's
   * own hue and saturation, not picked by eye.
   */
  // vivo Blue. 4.88:1 on `--surface`.
  vivo: { light: "#415FFF", dark: "#7489F6" },
  // Nokia Blue. 5.38:1 light — the strongest of the three.
  nokia: { light: "#005AFF", dark: "#528BF4" },
  // ⚠️ Motorola's is a red, and it lands within a few degrees of this site's
  // own brand red. That is fine *here* — the wall sets marks on `--surface`
  // and never beside `--brand` — but it is the reason the tile below keeps
  // Motorola's own field rather than borrowing an accent: three red-on-white
  // tiles in one grid is already at the edge of the "difference nobody can
  // name" failure the twelve home accents had to be re-solved for.
  motorola: { light: "#E1140A", dark: "#F45A52" },
  // Xiaomi's official orange is #FF6900, which measures 2.89:1 on `--surface`
  // — just under the 3:1 a large graphic needs, and this mark is a solid
  // squircle rather than a hairline wordmark, so it is the one case in this map
  // where the official value lands on the wrong side of the line by a margin
  // too small to see. Deepened to clear 3.2:1 for the light theme; the true
  // orange is what carries dark, where it already measures over 5:1. Same
  // treatment realme gets above, and for the same reason.
  xiaomi: { light: "#F26200", dark: "#FF8A3C" },
};

/* ── A brand tile is the make's own lockup ────────────────────────────────── */

export type BrandLockup = {
  /** The field the make sets its mark on. */
  field: string;
  /** The ink the mark is set in on that field. */
  ink: string;
  /**
   * True when `field` is light enough to disappear against `--surface` and
   * needs a hairline of its own to read as a tile rather than as a gap.
   */
  onLight: boolean;
};

/**
 * How a make's tile is painted — its own field, its own ink.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ This is not `brandColors`, and the two must not be merged
 * ---------------------------------------------------------------------------
 * `brandColors` answers "what ink does this mark take **on our page**" — it is
 * read by the partner wall and the brand chips, where the mark sits directly
 * on `--surface` and therefore has to clear a contrast ratio against a
 * background that inverts. That is a constraint of *our* design, and it is why
 * two of its entries are deliberately off the official value (Xiaomi deepened,
 * realme's yellow swapped for its ink).
 *
 * This answers a different question: "what does this make's logo actually look
 * like". The shop's instruction on 2026-09-30 was to stop painting every tile
 * in an invented accent — *"the Apple category, you've just put this red weird
 * color instead of the white Apple background… and the Apple logo will be in
 * black… the same for Huawei, its logo is red and its background is white…
 * make it exactly like Samsung"*. Samsung was the one they called correct, and
 * Samsung is white-on-blue because **that is Samsung's lockup**, not because
 * blue scored well against anything.
 *
 * So each row here is one make's primary lockup, and a field is coloured only
 * where the make's own is: Samsung's blue oval, Xiaomi's orange squircle,
 * realme's yellow. Everybody else sets their mark on white, which is what
 * their own sites do, and the ink is the make's primary brand colour so six
 * white tiles are still six different tiles — the wordmark carries the
 * identity and the colour supports it.
 *
 * ⚠️ **Neither value inverts with the theme, and that is the point.** A white
 * field is *part of the lockup*, the same argument `--scrim` and
 * `--media-plate-ground` already make: darkening a photograph is not
 * theme-dependent, and neither is Apple's silver. A tile that repainted itself
 * in dark mode would be showing a logo the make does not have. `onLight` is
 * what keeps that legible — it draws the tile its own edge instead.
 *
 * A make with no entry falls back to the category accent, which is what every
 * tile did before this and is right for the nineteen makes the ERP import
 * created: we have no sourced mark for them, so we have no lockup to
 * reproduce.
 */
export const brandLockups: Record<string, BrandLockup> = {
  // Monochrome by design. `#F5F5F7` is the grey Apple's own product pages set
  // the glyph on; `#1D1D1F` is the near-black it is drawn in there.
  apple: { field: "#F5F5F7", ink: "#1D1D1F", onLight: true },
  // Samsung Blue, white wordmark — the lockup the shop confirmed as correct.
  samsung: { field: "#1428A0", ink: "#FFFFFF", onLight: false },
  // The red petal on white. Huawei Red is the same value `brandColors` carries.
  huawei: { field: "#FFFFFF", ink: "#CF0A2C", onLight: true },
  // HONOR Blue — RGB 0/155/255, off HONOR's own brand guideline. Their
  // wordmark is also set in plain black, and that is the treatment *not*
  // taken: apple, honor and infinix would then be three black-on-white tiles
  // in one grid, which is the "two tiles nobody can tell apart" failure the
  // twelve home accents had to be re-solved for.
  honor: { field: "#FFFFFF", ink: "#009BFF", onLight: true },
  // OPPO "Fun Green". OPPO is moving its own logo towards monochrome; the
  // green is still what a shopper in Al Kut recognises on a box.
  oppo: { field: "#FFFFFF", ink: "#046A38", onLight: true },
  // Infinix "Pomegranate", their stated primary.
  infinix: { field: "#FFFFFF", ink: "#EC3A25", onLight: true },
  // realme's own lockup is the one place a yellow field is right: black
  // wordmark on realme yellow. The ink is what `brandColors` calls `light`.
  realme: { field: "#FFC915", ink: "#111111", onLight: true },
  // Measured off the official wordmark file — `rgba(230, 0, 64, 1)`.
  redmi: { field: "#FFFFFF", ink: "#E60040", onLight: true },
  // Off Tecno's own logo file.
  tecno: { field: "#FFFFFF", ink: "#0064FE", onLight: true },
  // The orange squircle with the white mark in it — the true `#FF6900`, not
  // the deepened value `brandColors` needs for ink on our own surface.
  xiaomi: { field: "#FF6900", ink: "#FFFFFF", onLight: false },
  /*
   * ── The three sourced makes added 2026-09-30 ────────────────────────────
   * Blackview, ZTE and nubia have no entry on purpose. A lockup is a claim
   * about what somebody's logo *looks like*, and we have no source for
   * theirs — so their tile keeps the category accent and their name is
   * typeset by `latinWordmark`, which is visibly ours rather than a guess at
   * theirs.
   */
  // vivo sets its wordmark in its blue on white.
  vivo: { field: "#FFFFFF", ink: "#415FFF", onLight: true },
  // Nokia's lockup is the wordmark in Nokia Blue on white.
  nokia: { field: "#FFFFFF", ink: "#005AFF", onLight: true },
  // The batwing on white. ⚠️ Motorola's red is within a few degrees of this
  // site's brand red, so the tile keeps a white field: red-on-red would read
  // as a rendering fault rather than as a logo.
  motorola: { field: "#FFFFFF", ink: "#E1140A", onLight: true },
};

/**
 * Categories that are codes rather than objects.
 *
 * `product_kind` only distinguishes device / accessory / package, so a PUBG
 * top-up is stored as an "accessory" — which is how eleven game cards ended up
 * filling the "Complete the Set" rail on an iPhone page as compatible
 * accessories. Anywhere that means *physical* accessories has to exclude these.
 */
/**
 * How many products the home-page hero rotates through.
 *
 * Lives here rather than as a default argument on `getFeaturedProducts` so the
 * back office can state the same number: the featured page draws a line across
 * the shelf at this position, because featuring a tenth product when the hero
 * shows eight is a decision with no visible effect, and an admin who cannot see
 * the line has no way to know that.
 *
 * Eight rather than five. At seven seconds a slide that is a full minute of
 * rotation, which is long, but the cost of the old five was worse: a shop with
 * a dozen things worth showing had to choose seven of them to hide, and the
 * page gave no hint that it was happening. The indicator dots stay legible to
 * roughly a dozen — past that the tray at the top corner starts to crowd the
 * badge, which is why this is a cap rather than "all of them".
 */
export const HERO_SLIDES = 8;

export const DIGITAL_CATEGORIES = ["game-cards", "telecom-cards"] as const;

/**
 * Which aisles publish a price as a range rather than a figure.
 *
 * Phones and tablets, new and used — the shop's words on 2026-10-31: "for
 * tablets, phones (the new ones and the used) prices to get shown as ranges".
 * A device is the thing another shop in Al Kut prices against, and an exact
 * figure on a public page is that shop's homework done for them. A 2,250 IQD
 * cable has no competitor worth hiding a price from, and quoting one as a range
 * would read as evasion rather than as discretion.
 *
 * ⚠️ **An allowlist, for the reason `COMPARABLE_CATEGORIES` is one.** A
 * category added later has to be considered before it inherits this, rather
 * than silently acquiring a pricing policy nobody chose for it.
 *
 * ⚠️ **`used-devices` went out of this list on 2026-10-30 and came back on
 * 2026-10-31, both on the shop's instruction.** The reasoning for leaving was
 * that a used unit is one object priced by hand, so a band only asks which
 * number is real. The shop decided the competitive reason outweighs that. The
 * base price is still the figure off the stock count
 * (`scripts/apply-used-prices.mjs`), and it is still what the till charges.
 *
 * ⚠️ This is the seed for a new product's switch and the fallback for a surface
 * that cannot ask. The decision on a live product is
 * `products.price_as_range`, which the catalogue editor can untick one product
 * at a time.
 */
export const RANGED_CATEGORIES = new Set(["phones", "tablets", "used-devices"]);

/**
 * Which aisles may be bought in instalments: mobile devices, and nothing else.
 *
 * The shop's instruction, 2026-11-09: "التقسيط only for the mobile devices".
 * The plan is a Rafidain Bank card arrangement for a handset, not credit on a
 * case or a charger, so a basket is offered instalments only when **every**
 * line is one of these — a phone with a case in the same basket is two orders,
 * the phone on the plan and the case paid for.
 *
 * ⚠️ Two gates, and both must pass: the aisle (this list) and the product's own
 * `allow_installment`, which the catalogue editor sets and which the ERP sync
 * leaves off for a handset under 100,000 or a used one. The list is the shop's
 * rule; the flag is the per-product exception inside it.
 *
 * ⚠️ `place_order` itself checks neither — it finances whatever it is sent.
 * `placeOrder` in `lib/actions/order.ts` re-checks both against the database
 * before calling it, so the app's own path cannot finance an accessory; a
 * hand-made RPC still could, and closing that is a migration.
 *
 * ⚠️ A THIRD gate sits beside these two and is checked separately —
 * {@link INSTALMENT_PROVINCE} — because it tests a different row
 * (`profiles.default_province_code`, not `products`) and the two conditions
 * can be true independently of each other.
 */
export const INSTALMENT_CATEGORIES = new Set(["phones"]);

/**
 * Who the Rafidain Bank instalment plan is for: a signed-in customer whose
 * **account itself** says they live in Wasit.
 *
 * The shop's instruction, 2026-11-10: offer the plan only to people "who lives
 * in واسط governorate and specify that in their account" — otherwise cash
 * only, with a note that card/transfer payment is arranged by WhatsApp after
 * the order is confirmed rather than through the form.
 *
 * ⚠️ **"Specify that in their account" is the whole point, and it rules out
 * the obvious reader.** `MyDetails.provinceCode` — what the checkout form's
 * province field opens on — falls through to the province of the customer's
 * *last delivery* when the account has never set one, which is a guess made
 * on their behalf and not something they told the shop. Testing eligibility
 * against that field would qualify a Baghdad customer who once had a gift
 * delivered to a Wasit address, and would silently refuse a genuine Wasit
 * customer who has never placed an order yet. The test is
 * `session.province` from `lib/auth/session-store.ts` — the bare
 * `profiles.default_province_code`, with no fallback — which is also what
 * `/team` and the More menu already gate the same kind of offer on.
 *
 * ⚠️ `LOCAL_PROVINCE` is reused rather than a second `"wasit"` literal: it is
 * the shop's own province and the same string decides the delivery zone. One
 * constant, so a rename of the code cannot leave this check silently
 * matching nothing.
 *
 * ⚠️ `place_order` cannot check this — it has no `auth.uid()` opinion about
 * what instalments are *for*, only about what a line costs. `placeOrder`
 * re-reads the caller's own `default_province_code` from the database before
 * calling it, exactly as it re-reads the category and the per-product flag.
 */
export const INSTALMENT_PROVINCE = LOCAL_PROVINCE;

/**
 * Which aisles the catalogue editor opens in its **device** shape.
 *
 * Not a storefront rule and nothing reads it outside the back office: it
 * decides which half of the form a product is edited with. The shop's words,
 * 2026-11-04: *“our store is not about mobile phones only … the accessories
 * ones will contain only the things that's important to the accessories
 * guy”*.
 *
 * These four are the aisles sold **by model, finish and capacity** — the
 * three things that make the editor long. Everything else (accessories,
 * covers, audio, gifts, cards, repair parts) is a name, a price and a
 * picture, and asking for a known-model lookup and a colour-per-frame swatch
 * on a screen protector is how a form teaches people to scroll past it.
 *
 * ⚠️ A **seed for the switch**, never a gate. The toggle is at the top of
 * the dialog and an accessory sold in three colours is a real thing — and
 * nothing hidden is ever dropped: see `shape` in `product-editor.tsx`.
 *
 * ⚠️ An allowlist, for the reason the two sets above are. A category added
 * later opens in the simpler shape, which is the safe direction: the worst
 * it costs is one press on the toggle, where inheriting the device form
 * silently would cost every accessory manager the long one for ever.
 */
export const DEVICE_EDITOR_CATEGORIES = new Set([
  "phones",
  "tablets",
  "used-devices",
  "watches",
]);

/**
 * Whether a shopper is offered a colour — as a filter in the catalogue and as
 * a swatch row on a product page. **Off since 2026-10-22, on the shop's
 * instruction, and temporarily**: "remove the colors filters temporarily …
 * leave it as choosable option in adding product menu … I have bigger plans
 * for them but for later".
 *
 * So colour stays *data*: the catalogue editor still writes
 * `product_variants.color_name_*` / `color_hex`, the photo run still files a
 * picture per finish, and `store_facets()` still counts them. Only the two
 * storefront controls are withdrawn, and switching this back to `true`
 * restores both with nothing else to undo.
 *
 * ⚠️ Off means more than hidden, in three places:
 * - `parseStoreFilters` drops `?color=`, so an old shared link cannot narrow
 *   the grid by a control that is no longer on the page — a filtered listing
 *   with no visible filter reads as missing stock.
 * - The product page shows every picture rather than one finish's.
 * - The variant added to the cart is the best-stocked one for the chosen
 *   storage, and its line carries no colour name: the customer did not pick
 *   one, and a basket reading "Titanium Black" would say they had.
 */
export const COLOUR_CHOICE_OFFERED = false;

/**
 * The categories a shopper may put on the comparison table.
 *
 * `product_kind = 'device'` was doing this job on its own and it is too broad:
 * a smartwatch and a pair of earbuds are both devices, and neither has the
 * RAM, storage, battery or refresh-rate figures the verdict is computed from.
 * Comparing two watches produced a table of dashes and a winner decided by
 * whichever one happened to have a number in it — a confident answer resting
 * on nothing, which is worse than declining to answer.
 *
 * Phones and tablets were the two named here. **Watches have joined them, and
 * the original objection has been checked rather than assumed away.**
 *
 * That objection was that comparing two watches produced a table of dashes and
 * a winner decided by whichever one happened to have a number — true when the
 * verdict scored only `ram`, `storage`, `capacity`, `refresh` and `main`, of
 * which a watch publishes exactly one. Measured against the live catalogue, all
 * six watches carry `capacity`, `life`, `brightness`, `size` and `type`, so
 * with `batteryLife` and `brightness` added to `DIMENSIONS` two watches now
 * score on **three** real numbers rather than one.
 *
 * Audio, accessories and bags are still absent, and for the reason that was
 * always the real one: their spec rows are `compatibility`, `material` and
 * `warranty` — prose, with not one numeric field between them. A comparison
 * table for two pairs of earbuds would be three rows of text and no verdict,
 * which is the "confident answer resting on nothing" this list exists to
 * prevent.
 *
 * Still an allowlist: a category added later has to be checked against its own
 * spec rows before it can be compared, instead of silently inheriting a table
 * it does not fit.
 */
/**
 * ⚠️ **Audio is on this list and is NOT scored.** The allowlist answers
 * "may this aisle be compared at all"; *how* it is compared is decided by
 * `AUDIO_TRAIT_CATEGORIES`, because the two questions have different
 * answers. Phones, tablets and watches carry numbers and get the podium;
 * audio carries none (0 of 547 products have a spec row, measured
 * 2026-09-24) and gets a trait table with no verdict. Putting audio on the
 * scored table would reproduce, exactly, the watches failure this list was
 * created to prevent — see `lib/data/audio-traits.ts`.
 */
export const COMPARABLE_CATEGORIES = [
  "phones",
  "tablets",
  "watches",
  "audio",
  /*
   * ⚠️ Added when used devices moved to their own aisle on 2026-10-30, and
   * the move is exactly why it is needed: the products did not change, their
   * spec sheets did not change, and without this line every second-hand
   * handset would have dropped out of `/compare` as a side effect of being
   * filed somewhere else. Comparing a used S25 Ultra against a new one is
   * also the single most useful comparison this shop can offer.
   */
  "used-devices",
] as const;

/** Whether a product's category belongs on the comparison table. */
export function isComparableCategory(code: string): boolean {
  return (COMPARABLE_CATEGORIES as readonly string[]).includes(code);
}

/**
 * Which aisles may share one comparison table.
 *
 * ⚠️ **A family, not an aisle.** `/compare` and the shortlist used to narrow
 * to the exact `category_code` of the first device, on the reasoning that a
 * phone set against a watch is a table of dashes. True of a watch, and the
 * rule was drawn one level too fine: phones, tablets and used devices carry
 * the same spec sheet — RAM, storage, battery, screen, camera — so narrowing
 * between them hid real answers and blanked nothing.
 *
 * Reported 2026-11-09: choosing "Galaxy Tab A11+" (filed under Phones) hid
 * "Galaxy Tab A11" (Tablets) from the other picker; and choosing any new
 * handset hid every used one, which is the comparison `COMPARABLE_CATEGORIES`
 * calls the most useful this shop can offer — and why `keepGrade` exists.
 *
 * Watches stay apart (they score on battery life and brightness, which a
 * phone does not publish) and audio stays apart (a trait table, never
 * scored — `AUDIO_TRAIT_CATEGORIES`). An aisle not named here is its own
 * family, so a category added later is narrowed exactly as before.
 */
const HANDSET_FAMILY = new Set(["phones", "tablets", "used-devices"]);

export function comparisonFamily(code: string): string {
  return HANDSET_FAMILY.has(code) ? "handsets" : code;
}

/** Whether two aisles' products can sit on one comparison table. */
export function sameComparison(a: string, b: string): boolean {
  return comparisonFamily(a) === comparisonFamily(b);
}

/** Category codes surfaced in the footer's shop column. */
export const footerCategories = [
  "phones",
  "tablets",
  "accessories",
  "watches",
  "audio",
] as const;
