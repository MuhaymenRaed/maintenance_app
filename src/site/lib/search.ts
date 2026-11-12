/**
 * Bilingual (Arabic + English) search folding.
 *
 * This is the TypeScript half of a pair: `search_normalize()` in
 * `supabase/migrations/20260807_store_search.sql` performs the identical
 * transformation in Postgres, and the `products.search_doc` column is built
 * with it. Change one, change the other — if they drift, the browser will
 * decide a query is unchanged while the database disagrees.
 *
 * Folds:
 *   - case
 *   - Arabic letter variants: alef/hamza carriers (آأإٱ → ا), ya (ى/ی → ي),
 *     waw (ؤ → و), hamza-on-ya (ئ → ي), ta-marbuta (ة → ه), keheh (ک → ك)
 *   - Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits → 0-9
 *   - harakat, superscript alef and tatweel — dropped, not spaced, because
 *     they sit inside a word
 *   - Latin diacritics (café → cafe)
 *   - everything else non-alphanumeric → a single space
 */

/** Digit folding for one Arabic-Indic block, given its zero codepoint. */
function foldDigits(text: string, zero: number): string {
  return text.replace(
    new RegExp(
      `[${String.fromCharCode(zero)}-${String.fromCharCode(zero + 9)}]`,
      "g",
    ),
    (d) => String(d.charCodeAt(0) - zero),
  );
}

export function normalizeSearch(input: string): string {
  return (
    // NFC first, then fold Arabic letters BEFORE the NFD pass below. Order is
    // load-bearing: NFD decomposes أ into ا + U+0654 (hamza above), which is
    // outside the U+0300–U+036F combining-mark range the Latin strip removes
    // and outside the harakat range. Folding after decomposition would leave a
    // stray hamza behind and the term would stop matching search_doc.
    foldDigits(
      foldDigits(
        input
          .normalize("NFC")
          .toLowerCase()
          .replace(/[آأإٱ]/g, "ا")
          .replace(/[ىی]/g, "ي")
          .replace(/ؤ/g, "و")
          .replace(/ئ/g, "ي")
          .replace(/ة/g, "ه")
          .replace(/ک/g, "ك"),
        0x0660,
      ),
      0x06f0,
    )
      // harakat (fathatan…sukun), superscript alef, tatweel
      .replace(/[ً-ْٰـ]/g, "")
      // Latin accents: decompose, then drop the combining marks
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/* ── Fuzzy matching ──────────────────────────────────────────────────── */

/**
 * Edit distance with adjacent transpositions (optimal string alignment),
 * capped at `max + 1` so a hopeless pair stops early. "galxy" is one edit
 * from "galaxy"; "iphnoe" is one transposition from "iphone".
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) d[i][0] = i;
  for (let j = 0; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    let rowMin = max + 1;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/**
 * How well a folded haystack answers a folded query, or `null` for not at
 * all. Lower is better: 0 is every token found verbatim.
 *
 * Each token must land somewhere — as a substring (0), as the start of a
 * word (0.25), or within an edit or two of a word or its prefix (the edit
 * count, and only for tokens long enough that a typo is a typo rather than
 * a different word: four letters allow one edit, seven allow two). A token
 * that lands nowhere fails the whole query, so "galxy s24" finds the
 * Galaxy S24 and "galxy zzz" finds nothing rather than every Galaxy.
 *
 * Both sides are expected to have been through `normalizeSearch`.
 */
export function fuzzyScore(haystack: string, query: string): number | null {
  const tokens = query.split(" ").filter(Boolean);
  if (!tokens.length) return 0;
  const words = haystack.split(" ").filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) continue;
    let best: number | null = null;
    const allowed = token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0;
    for (const word of words) {
      if (word.startsWith(token)) {
        best = best === null ? 0.25 : Math.min(best, 0.25);
        continue;
      }
      if (!allowed) continue;
      const whole = editDistance(token, word, allowed);
      const prefix = word.length > token.length ? editDistance(token, word.slice(0, token.length + 1), allowed) + 0.25 : allowed + 1;
      const d = Math.min(whole, prefix);
      if (d <= allowed) best = best === null ? d : Math.min(best, d);
    }
    if (best === null) return null;
    score += best;
  }
  return score;
}
