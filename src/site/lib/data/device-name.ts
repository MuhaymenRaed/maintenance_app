/**
 * The standard name of a device, and the key two names are the same device
 * under.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * Every device picker on this site listed the shop's own products **by the
 * name they carry in stock**, and an ERP stock name is not a device name. It
 * is a device name plus everything the till needs to tell two units apart:
 *
 *     Samsung Galaxy A17 256GB / 8GB
 *     Apple iPhone 17 Pro Max 256GB (Orange)
 *     Apple iPhone 17 Pro Max Deep Biue 256GB
 *     Honor X9d 256GB / 8GB (Used)
 *     Nokia 5310 (Dubai)
 *
 * Measured against the live catalogue on 2026-11-03: **266** live device
 * products hold only **172** distinct devices, so a brand-scoped picker was
 * showing the same handset up to **seven** times — once per capacity, colour
 * and grade — with nothing on any row to say which was which. The shop's own
 * words: the options "must be with the standard name of the device instead of
 * what it is called in our stock".
 *
 * So one function answers "what device is this", and every picker on the site
 * reads it: the repair wizard, the replacement wizard, the counter's own
 * ticket and replacement dialogs, `/compare`, and the catalogue editor's model
 * suggestions.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ The standard name carries the maker's word, and that is not decoration
 * ---------------------------------------------------------------------------
 * "Galaxy A17" would read better inside a picker that already has Samsung
 * chosen above it. The brand stays anyway, because the picker's value is
 * **stored** and then printed alone:
 *
 *   * `repair_tickets.device_model` is the whole of the device line on all
 *     three papers `repair-print.tsx` draws — the 60×40mm label, the A5
 *     receipt and the A5 warranty certificate — and on the board row and the
 *     dialog subtitle. None of them prints the make beside it. "X9d" on a
 *     warranty certificate is not a device; "Honor X9d" is.
 *   * the same string reaches the parts board and the repair price list, where
 *     the make is what separates one maker's X9 from another's.
 *
 * It also removes a decision nobody could make consistently. The curated list
 * in `device-catalogue.ts` writes Samsung and Apple without their maker
 * ("Galaxy S25 Ultra", "iPhone 17 Pro Max") and everybody else with it
 * ("Honor X9c", "Tecno Spark 30"); `compare_catalogue` publishes every name
 * with it; the shop's own catalogue writes Samsungs both ways ("Samsung Galaxy
 * A17 256GB / 8GB" beside "Galaxy A17 128GB / 4GB (Used)"). Three conventions
 * in one list is a picker whose rows disagree about their own shape. One rule
 * — the maker's full title, which every maker, GSMArena and the shop's own ERP
 * already use — needs no per-brand exceptions and cannot drift.
 *
 * The cost, stated: the make repeats down a brand-scoped list. The brand field
 * is directly above it, so a reader can see why.
 *
 * ---------------------------------------------------------------------------
 * Two functions, because there are two questions
 * ---------------------------------------------------------------------------
 * `modelIdentity` is "are these the same device" — pure, locale-independent,
 * needs no lookups, and is therefore what a **server** keys a price map on.
 * `standardModelName` is "what do we call it" — it takes the known names so
 * the maker's own spelling wins over a stock clerk's, and it is what a
 * **picker** draws.
 *
 * Keeping them apart is what lets `getTradeInBaseValues` key on identity
 * without reading 5,912 rows of world catalogue to find a display spelling it
 * never shows.
 *
 * This file imports nothing. It is read by Client Components (both wizards,
 * the product editor, the compare picker) and by `server-only` query modules,
 * so a value imported from either side would break one of them.
 */

/**
 * The Latin word a make writes in front of its own models, per brand code.
 *
 * One word per make, and it does both jobs: it is the only word that may be
 * **removed** to compare two names, and the one **added** to display a name
 * that lacks it.
 *
 * ⚠️ A sub-brand is not an exception. An earlier draft let "Redmi", "POCO" and
 * "Mi" stand in for Xiaomi, so a curated "Redmi Note 15 Pro+" kept its shape
 * while the world index's "Xiaomi Redmi Note 15 Pro+" kept its own — two
 * spellings of one device in one list, which is the fault this file exists to
 * end. Everything takes the make's word, which is what `compare_catalogue` and
 * the shop's own ERP already write.
 *
 * ⚠️ Only ever dropped **once**, and only this word. Dropping sub-brands as
 * well would fold "Xiaomi 12" and "Xiaomi Redmi 12" onto one key — two
 * different phones — because both would reduce to "12".
 *
 * A code missing from this table falls back to the code itself, which is right
 * for every make whose code *is* its name (nokia, vivo, zte…) and harmless
 * where it is not: both sides of every comparison use the same fallback, so
 * the identity still folds consistently.
 */
const BRAND_WORDS: Record<string, string> = {
  apple: "Apple",
  samsung: "Samsung",
  huawei: "Huawei",
  honor: "Honor",
  oppo: "OPPO",
  realme: "realme",
  // Both codes answer to the same device list — see `DEVICE_CATALOGUE` for why
  // the Redmi row is kept — and both take Xiaomi, because that is what the
  // world index and the ERP both write: "Xiaomi Redmi Note 15 Pro+", "Xiaomi
  // Poco X8 Pro".
  xiaomi: "Xiaomi",
  redmi: "Xiaomi",
  tecno: "Tecno",
  infinix: "Infinix",
  nokia: "Nokia",
  vivo: "vivo",
  motorola: "Motorola",
  zte: "ZTE",
  nubia: "nubia",
  blackview: "Blackview",
  oukitel: "Oukitel",
  ulefone: "Ulefone",
  itel: "itel",
  alcatel: "Alcatel",
  lenovo: "Lenovo",
  tcl: "TCL",
  "g-tab": "G-Tab",
  kxd: "KXD",
  google: "Google",
  sony: "Sony",
};

/**
 * One device from the world index, as `loadWorldModels` hands it over.
 *
 * Declared here rather than in `lib/actions/device-models.ts` so the data
 * layer does not have to import a `"use server"` module to name its own
 * input. That action re-exports it, so every existing import still resolves.
 */
export type WorldModel = {
  /** The maker's own title, as the index publishes it: "Samsung Galaxy A57". */
  name: string;
  year: number | null;
  /** The Arabic name, folded into a picker's search haystack, never drawn. */
  keywords?: string;
  /**
   * The aisle the index files it under — `phones` or `tablets`.
   *
   * Read by the catalogue editor, which fills the category from the model a
   * person picked. Without it an iPad chosen from the world list would be
   * filed under Phones, because the curated list is the only other thing that
   * knows a device's aisle and it has never heard of most of these.
   */
  category?: string;
};

/** The make's own Latin word, for a brand code. */
export function makeWord(brandCode: string | null): string {
  if (!brandCode) return "";
  return BRAND_WORDS[brandCode] ?? brandCode;
}

/**
 * Every make this file can recognise by name, in the order it resolves them.
 *
 * The candidate list `makerOfModel` is asked against when the caller has no
 * narrower one — a Server Action, say, which would otherwise pay a round trip
 * to the `brands` table to turn "Samsung Galaxy A17" into `samsung`.
 *
 * ⚠️ **The order is the tie-break and is not alphabetical.** `xiaomi` and
 * `redmi` share the word "Xiaomi" and `xiaomi` is declared first, which is the
 * right winner: the Redmi row is soft-deleted and folded into Xiaomi (the fold
 * of 2026-09-30 went redmi → xiaomi, never the other way). Re-ordering
 * `BRAND_WORDS` re-orders this.
 */
export const MAKE_CODES: readonly string[] = Object.keys(BRAND_WORDS);

/** `word` at the head of a name, with hyphen and space equivalent. */
function headOf(word: string): RegExp {
  return new RegExp(
    `^${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\s]/g, "[ -]?")}\\b[ -]*`,
    "i",
  );
}

/**
 * Capacities written as a bare number, with no GB after them.
 *
 * A closed set on purpose. "Apple iPad 11 A16 128 2025" and "Apple iPad 11 A16
 * 2025 256GB" are one tablet, and the only thing between them is a loose
 * `128`. Stripping *any* bare number instead would delete the model from
 * "Nokia 105", "Honor 600" and "Xiaomi 12" — none of which is a capacity, and
 * all of which are the whole name.
 */
const BARE_CAPACITY = new Set(["32", "64", "128", "256", "512", "1024"]);

/**
 * Words that say which **unit** this is rather than which device.
 *
 * ⚠️ The grade and the provenance, kept apart from the rest of the noise
 * because `/compare` needs them and the wizards must not have them. A used
 * S25 Ultra set against a new one is, in this repo's own words, "the single
 * most useful comparison this shop can offer" — so the comparison picker has
 * to keep the two apart, while a repair ticket for either says "Samsung Galaxy
 * S25 Ultra" because the bench is working on one model.
 *
 * Provenance sits here with the grade for the same reason: an original Nokia
 * 5310 and a Dubai import are one device at two prices.
 */
const GRADE_WORDS =
  /\b(?:used|refurbished|openbox|open-box|original|dubai)\b|مستعمل|مستخدم|أصلي|اصلي|دبي/iu;

/** How much of a stock name to keep. */
export type StripOptions = {
  /**
   * Keep the grade and the provenance — "(Used)", «(مستعمل)», "(Dubai)".
   *
   * Off everywhere except `/compare`. A picker that names a device for a
   * ticket wants the device; a picker that chooses two rows to set against
   * each other wants the unit, because the used one and the new one are two
   * different things to buy.
   */
  keepGrade?: boolean;
};

/** Words a stock name carries that say nothing about which device it is. */
const NOISE_WORDS =
  /\b(?:used|original|refurbished|openbox|open-box|dubai|copy|master|edition)\b|مستعمل|مستخدم|أصلي|اصلي|دبي|نسخة/giu;

/**
 * The same words, non-global, for `.test()`.
 *
 * ⚠️ Built from the one above rather than written twice, so the two cannot
 * drift — and separate rather than reused, because `.test()` on a `/g` regex
 * advances `lastIndex` and the *next* call starts from where the last one
 * stopped. One shared global regex here would answer differently depending on
 * what had been tested before it.
 */
const NOISE_TEST = new RegExp(NOISE_WORDS.source, "iu");

/**
 * Is what is inside these brackets part of the device's name?
 *
 * ⚠️ This is the difference between "Apple iPad (10th gen)" and "Apple iPad",
 * and the test caught it: dropping every bracket but a bare year folded the
 * curated 4th, 5th, 7th, 8th, 9th and 10th-generation iPads onto one identity
 * — `ipad` — so a picker would have offered one row called "Apple iPad" and
 * silently dropped five tablets. The same went for "iPad Pro 12.9 (M1)" and
 * "(M2)".
 *
 * A digit is what separates a qualifier from a colour: "10th gen", "M2",
 * "2017" and "5th gen" all carry one, while "Orange", "Titanium", "Cosmic",
 * «وردي» and "China" do not — and nothing has to list the colours, which are
 * open-ended. A grade note is the one bracket that carries digits and is not
 * a qualifier ("Used — 90% battery"), so the noise words veto it.
 */
function isQualifier(inner: string): boolean {
  return /\d/.test(inner) && !NOISE_TEST.test(inner);
}

/**
 * Strip everything an ERP stock name adds to a device name.
 *
 * In order, and each clause earns its place against the live catalogue:
 *
 *  1. **Bracketed anything that is not a model qualifier** — `(Orange)`,
 *     `(Used)`, `(مستعمل)`, `(Titanium)`, `(Used — 90% battery)`,
 *     `(Dubai)`. A bracket carrying a digit is kept, because that is what a
 *     qualifier looks like: "Nokia 105 (2017)" and "Nokia 105 (2023)" are two
 *     handsets the shop prices differently, and "iPad (10th gen)" is a
 *     different tablet from "iPad (9th gen)". See `isQualifier`.
 *  2. **Capacity and RAM**, in every form this catalogue writes them:
 *     `256GB / 8GB`, `1TB`, `128+4`, `1t+12`, and a bare `128`.
 *  3. **Grade and provenance words** — see `NOISE_WORDS`. A Dubai import and
 *     an original are the same device at two prices; the price list knows the
 *     difference and the device name does not.
 *  4. The separators those leave behind: a dangling `/`, an em dash, runs of
 *     space.
 *
 * ⚠️ The final trim must not touch a trailing `+`. It did in the first draft,
 * and "Tecno Spark 40 Pro+ 256GB / 8GB" came out as "Tecno Spark 40 Pro" — a
 * different phone, which `tierForModel` then priced as `mid` where the Pro+
 * resolves to no tier at all. Caught by running the tier over every stock name
 * rather than by reading the regex.
 */
export function stripStockNoise(
  name: string,
  { keepGrade = false }: StripOptions = {},
): string {
  let out = String(name ?? "");

  out = out.replace(/\(([^)]*)\)/g, (whole, inner: string) => {
    // "(Used — 90% battery)" is kept whole: for a second-hand unit the detail
    // inside the bracket is the grade, not noise around it.
    if (keepGrade && GRADE_WORDS.test(inner)) return whole;
    // "(2017)", "(10th gen)", "(M2)" — part of the name. See `isQualifier`.
    if (isQualifier(inner)) return whole;
    return " ";
  });
  out = out.replace(/\b\d+(?:\.\d+)?\s*(?:gb|tb|mb)\b/gi, " ");
  out = out.replace(/\b\d+\s*t\s*\+\s*\d+\b/gi, " ");
  out = out.replace(/\b\d{2,4}\s*\+\s*\d{1,2}\b/g, " ");
  if (!keepGrade) out = out.replace(NOISE_WORDS, " ");
  out = out.replace(/[—–]/g, " ").replace(/\s*\/\s*/g, " ");
  out = out
    .split(/\s+/)
    .filter((word, index) => index === 0 || !BARE_CAPACITY.has(word))
    .join(" ");

  return out
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[\s,\-—–/]+$/, "")
    .trim();
}

/** Drop the make's own word from the head of a name, once. */
function dropMakeWord(name: string, brandCode: string | null): string {
  const word = makeWord(brandCode);
  if (!word) return name;
  const stripped = name.replace(headOf(word), "").trim();
  return stripped || name;
}

/** Does this name already say who made it? */
function namesItsMaker(name: string, brandCode: string | null): boolean {
  const word = makeWord(brandCode);
  return Boolean(word) && headOf(word).test(name);
}

/**
 * Which of these makes a standard model name belongs to, read off the name.
 *
 * ---------------------------------------------------------------------------
 * Why this can be read off the name at all
 * ---------------------------------------------------------------------------
 * Because of the decision of 2026-11-04: every row a picker draws is a
 * **standard** name and a standard name carries its maker's own word —
 * "Samsung Galaxy A17", not "Galaxy A17". That is what makes the maker
 * recoverable from a bare string, and it is why an accessory's
 * `fits_models` can be a `text[]` of names rather than a join table with a
 * brand column: the names already say.
 *
 * ⚠️ **The longest matching word wins, and ties go to the first code given.**
 * Two codes can share one word — `xiaomi` and `redmi` both resolve to
 * "Xiaomi", because that is what the world index and the ERP both write — so
 * "Xiaomi Redmi Note 15" matches both and nothing in the *name* can separate
 * them. First-wins makes the caller's order the tie-break, and every caller
 * here passes the shop's own brand list in `sort_order`; `redmi` is
 * soft-deleted anyway (folded into `xiaomi` on 2026-09-30), so the live list
 * holds one of the two.
 *
 * Returns null for a name whose maker is not in `codes` — a free-typed model,
 * or a make the shop has stopped stocking. Null is "we cannot say", never
 * "universal": a caller that stores this has to decide which it means.
 */
export function makerOfModel(
  name: string,
  codes: readonly string[],
): string | null {
  let best: string | null = null;
  let longest = 0;
  for (const code of codes) {
    const word = makeWord(code);
    if (!word || !headOf(word).test(name)) continue;
    if (word.length > longest) {
      longest = word.length;
      best = code;
    }
  }
  return best;
}

/**
 * The key two names are the same device under.
 *
 * Folds, in this order: the stock noise above, the make's own leading word,
 * case, runs of whitespace, `Plus` onto `+`, and a model number separated from
 * its one-letter suffix.
 *
 * ⚠️ `+` stays meaningful and is never dropped. "Galaxy S24+" and "Galaxy S24"
 * are two phones — the trap `identityKey` in `device-catalogue.ts` already
 * records, where folding through `normalizeSearch` deleted thirteen Samsungs
 * from one picker. What *is* folded is the two spellings of the same suffix:
 * the world index writes "Honor X7e Plus" and the shop writes "Spark 40 Pro+",
 * and no maker sells an "X Plus" and an "X+" as different devices.
 *
 * ⚠️ `17 T` folds onto `17T`, and that one was measured. The shop writes
 * "Xiaomi 17 T Pro" and the world index writes "Xiaomi 17T Pro"; without the
 * fold the full name matched nothing, the walk in `standardModelName` dropped
 * its way down to a real but **different** phone — "Xiaomi 17" — and the tier
 * changed with it. Only a *single* letter is joined, so "iPad 11 A16" and
 * "Nokia 105 4G" are untouched.
 *
 * ⚠️ `4G` and `5G` are **not** folded away. "Galaxy A18 4G" and "Galaxy A18
 * 5G" are genuinely two handsets with two spec sheets.
 *
 * Brackets are dropped while **what is inside them is kept**, so the curated
 * "iPad (10th gen)" and the price list's "iPad 10th Gen" are one device, and
 * "Nokia 105 (2017)" and "Nokia 105 (2023)" stay two.
 */
export function modelIdentity(
  name: string,
  brandCode: string | null = null,
  options: StripOptions = {},
): string {
  const cleaned = dropMakeWord(
    stripStockNoise(name, options),
    brandCode,
  ).toLowerCase();
  return cleaned
    .replace(/\bplus\b/g, "+")
    .replace(/\s*\+/g, "+")
    .replace(/[()]/g, " ")
    .replace(/(\d)\s+(\p{L})(?=\s|$)/gu, "$1$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Trailing words that are a *unit*'s description rather than a device's
 * name, and the only words the walk in `standardModelName` may drop.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ Why this is a closed list and not a heuristic
 * ---------------------------------------------------------------------------
 * The walk used to drop any trailing word that carried no digit and was not a
 * known model suffix. Measured on 2026-11-03 — for every live stock name that
 * does not match a known device as written, which words would have to come
 * off for it to match — that rule is aimed at nine words and exposed to
 * fourteen it must never touch:
 *
 *     Honor Magic 8 Pro            -> "Honor Magic"      by dropping 8 Pro
 *     Redmi Note 17 Pro Max 5G     -> "Redmi Note"       by dropping 17 Pro Max 5G
 *     OPPO Reno 16F                -> "OPPO Reno"        by dropping 16F
 *     Galaxy S25 Ultra Neo         -> "Galaxy S25 Ultra" by dropping Neo
 *     Tecno Camon 40 Pro 5G        -> "Tecno Camon 40 Pro" by dropping 5G
 *     Tecno Pova Slim              -> "Tecno Pova"       by dropping Slim
 *
 * The digit and model-suffix guards below catch most of those, and `Slim`
 * proves they cannot catch them all: every maker has word-only variant
 * suffixes — Slim, Go, Music, Shield, Power, Turbo — and enumerating them is
 * the same open-ended list from the other end.
 *
 * So the question is inverted. A word is dropped because it is **known to be
 * a colour, a finish, an edition or a SIM variant**, never because nothing
 * objected to it. A colour this list has not met leaves a slightly noisy
 * label — "Apple iPhone 17 Pro Max Cosmic" — and a *wrong device* is what
 * the other polarity produces. Failing towards a noisy label is the whole
 * reason for the list, and it is the direction `repair-pricing.ts` already
 * argues for when it refuses to keep a table of model names.
 *
 * ⚠️ Nothing may go in here that any maker uses as a model word. `Air`,
 * `Edge`, `Pro`, `Max`, `Plus`, `Neo`, `Phantom` and `Note` all read as
 * colours or finishes in other catalogues and are devices in this one.
 */
const TRIM_WORDS = new Set([
  // Measured: the words the live catalogue actually needs dropped.
  "deep",
  "biue", // the shop's own spelling of Blue, and it is in a product name
  "cosmic",
  "desert",
  "titanium",
  "burgundy",
  "zaa", // the Apple region code the counter writes on an iPhone
  "sim",
  "esim",
  "paperlink",
  "edition",
  // The rest of the colour family, none of which is a model word here.
  "black",
  "white",
  "silver",
  "gold",
  "blue",
  "green",
  "pink",
  "purple",
  "violet",
  "orange",
  "red",
  "grey",
  "gray",
  "midnight",
  "graphite",
  "starlight",
  "obsidian",
  "ivory",
  "lavender",
  "teal",
  "coral",
  "cream",
  "sand",
  "jet",
]);
/**
 * Suffixes that distinguish one model from another, and may never be dropped
 * by the walk in `standardModelName`.
 *
 * A second line of defence behind `TRIM_WORDS`, and it earns its place: it is
 * what stops a word being added to that list by mistake. `Air` is a colourish
 * word and an iPhone; this set is what would refuse it.
 *
 * Without this list, a stock "Honor X7e Plus" on a deployment whose world
 * index happened to hold only "Honor X7e" would be *renamed* to the lesser
 * phone. A colour word can be dropped because losing it cannot change which
 * device is meant; "Pro", "Max" and "5G" are the device.
 */
const MODEL_SUFFIXES = new Set([
  "pro",
  "max",
  "plus",
  "+",
  "ultra",
  "lite",
  "mini",
  "air",
  "edge",
  "fold",
  "flip",
  "se",
  "fe",
  "gt",
  "neo",
  "power",
  "prime",
  "turbo",
  "4g",
  "5g",
]);

/** How many trailing words the walk may drop before it gives up. */
const MAX_DROPPED_WORDS = 4;

/**
 * Every spelling a picker may draw, keyed by identity.
 *
 * Built by `knownModelNames` from the sources that hold a maker's own
 * spelling, so a stock name can be resolved onto one.
 */
export type KnownModels = ReadonlyMap<string, string>;

/**
 * Build the known-name map for one brand, best spelling first.
 *
 * The caller passes its sources in preference order — in practice the curated
 * list from `device-catalogue.ts` and then `compare_catalogue` — and the first
 * spelling of a device wins, because `set` is guarded. The curated list leads
 * for the reason `mergeBrandModels` already gives: it was written for this
 * market, which a world index under-represents.
 *
 * ⚠️ Every entry goes through `standardModelName` on the way in, so the map
 * holds *standardised* spellings. Storing the raw source name instead would
 * leave a curated "Galaxy S25 Ultra" and a world "Samsung Galaxy A57" sitting
 * in one list under two conventions.
 */
export function knownModelNames(
  brandCode: string | null,
  ...sources: readonly (readonly string[])[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const source of sources) {
    for (const raw of source) {
      const id = modelIdentity(raw, brandCode);
      if (id && !map.has(id)) map.set(id, standardModelName(raw, brandCode));
    }
  }
  return map;
}

/**
 * What this shop calls this device when it is being named rather than sold.
 *
 * Three steps, and the third is the one that does the work:
 *
 *  1. strip the stock noise;
 *  2. prefix the maker unless the name already names it;
 *  3. when `known` is given, walk the name from the full string down, dropping
 *     one trailing word at a time, and take the first spelling it matches.
 *
 * Step 3 is what turns "Apple iPhone 17 Pro Max Deep Biue" into "Apple iPhone
 * 17 Pro Max" without this file holding a list of colour words.
 *
 * ⚠️ A word is dropped only when **both** halves agree: it is in
 * `TRIM_WORDS` — known to describe a unit rather than name a device — and it
 * is not something a model word is made of (a digit, a `+`, a
 * `MODEL_SUFFIXES` entry). Bounded by `MAX_DROPPED_WORDS` on top. Dropping a
 * trailing word can otherwise land on a real but **smaller** device, and the
 * measurement in `TRIM_WORDS` lists six that it did.
 *
 * A word is also only ever dropped because dropping it *found a real device*,
 * so an unknown model keeps every word it was given rather than being trimmed
 * on a guess.
 *
 * Measured on 2026-11-03: 201 of 266 live stock names land on a known name
 * this way, and the 65 that do not come out as readable device names anyway
 * ("Honor X9d", "vivo Y33s", "G-Tab Pad 11") because step 1 did its job.
 */
export function standardModelName(
  name: string,
  brandCode: string | null = null,
  known?: KnownModels,
): string {
  const cleaned = stripStockNoise(name);
  if (!cleaned) return "";

  const withMake = namesItsMaker(cleaned, brandCode)
    ? cleaned
    : `${makeWord(brandCode)} ${cleaned}`.trim();

  if (!known || known.size === 0) return withMake;

  const words = withMake.split(/\s+/).filter(Boolean);
  const floor = Math.max(1, words.length - MAX_DROPPED_WORDS);

  for (let take = words.length; take >= floor; take -= 1) {
    const hit = known.get(
      modelIdentity(words.slice(0, take).join(" "), brandCode),
    );
    if (hit) return hit;

    /*
     * The word that would come off next. Stop rather than trade this device
     * for a shorter one that happens to exist.
     *
     * ⚠️ A trailing `+` is stripped before the set is asked, because the
     * word is "pro+" and the set holds "pro". Measured: without this, an
     * "Infinix Note 50 Pro+" whose exact name the world index happens to
     * lack walks down to the curated "Infinix Note 50" — a cheaper phone,
     * and the exact trade this guard exists to refuse. It is latent rather
     * than loud, because the index usually *does* carry the full name and
     * the walk never starts, which is what makes it worth a test rather
     * than a comment.
     */
    const next = words[take - 1]?.toLowerCase() ?? "";
    if (
      // Not a word this file knows to be a unit's description…
      !TRIM_WORDS.has(next) ||
      // …or one of the things a model word is made of. Both have to pass.
      /\d/.test(next) ||
      next.includes("+") ||
      MODEL_SUFFIXES.has(next) ||
      MODEL_SUFFIXES.has(next.replace(/\+$/, ""))
    )
      break;
  }
  return withMake;
}

/**
 * A picker row's label, with the shop's own mark on it.
 *
 * ⚠️ The mark goes in the **label** and never in the value. The value is what
 * a ticket records and a receipt prints, and "Galaxy A17 (متوفر لدينا)" on a
 * warranty certificate is the picker's furniture escaping onto the customer's
 * paperwork.
 *
 * It also replaces the `hint` two of these pickers already carried for the
 * same fact. They drew it as a dimmed span at the end of the row; the shop
 * asked for brackets after the name, and saying it twice was never an option.
 *
 * ⚠️ **Storefront only.** The shop's instruction on 2026-11-04: the mark is
 * not to appear anywhere in the dashboard — not on a repair or programming
 * ticket, not on an order, not in the catalogue editor. Staff know what is on
 * the shelf, so there it is a word in brackets on every row that nobody reads.
 * The three admin pickers pass no mark; `mergeBrandModels` still floats the
 * stocked models to the top for them, which is the useful half of the flag and
 * is invisible.
 */
export function withStockMark(label: string, mark: string | null): string {
  return mark ? `${label} (${mark})` : label;
}
