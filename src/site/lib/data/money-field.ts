/**
 * A money field, as somebody is typing into it.
 *
 * ---------------------------------------------------------------------------
 * Why this is not `formatPrice`
 * ---------------------------------------------------------------------------
 * `formatPrice` in `lib/format.ts` formats a **number** — a figure the app has
 * already decided on, rendered for a reader. These format a **string somebody
 * is halfway through typing**, which is a different thing and cannot go through
 * `Intl`: `Number("1495013.")` is `1495013` and formatting that back gives
 * `"1,495,013"`, so the decimal point the typist just pressed disappears under
 * their caret. Same for a lone `"-"`, a lone `"."`, and the empty string, none
 * of which is a number and all of which are legitimate things for a field to
 * hold for one keystroke.
 *
 * So the grouping here works on the digit string and never on a `Number`. The
 * two are not a duplicate pair: one takes a figure, the other takes a draft.
 *
 * ---------------------------------------------------------------------------
 * Western digits, comma grouping, in both locales
 * ---------------------------------------------------------------------------
 * The house rule for every price, phone, IMEI and order code on this site, and
 * it is why `Intl.NumberFormat` is not reached for even where it would fit: in
 * `ar` it returns Arabic-Indic digits and an Arabic thousands separator, which
 * is not how a price is written on this shopfront or on its price tags.
 *
 * ⚠️ The fold goes the other way on the way **in**. An Arabic keyboard
 * produces `٠١٢` by default, so a member of staff typing a price on an Arabic
 * layout types Arabic-Indic digits — the case `PhoneInput` already folds for,
 * because every regex and every `Number()` in this codebase rejects them.
 * Perso-Arabic digits are folded too, matching `search_normalize()`.
 */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSO_ARABIC = "۰۱۲۳۴۵۶۷۸۹";

/** Arabic-Indic and Perso-Arabic digits to Latin; everything else untouched. */
export function foldDigits(text: string): string {
  let out = "";
  for (const char of text) {
    const arabic = ARABIC_INDIC.indexOf(char);
    if (arabic >= 0) {
      out += String(arabic);
      continue;
    }
    const perso = PERSO_ARABIC.indexOf(char);
    out += perso >= 0 ? String(perso) : char;
  }
  return out;
}

/**
 * The characters that survive parsing — a digit, the decimal point, the sign.
 *
 * The caret is restored by counting these rather than digits alone: counting
 * digits would place the caret on the wrong side of a decimal point the typist
 * is standing next to.
 */
function isValueChar(char: string): boolean {
  return (char >= "0" && char <= "9") || char === "." || char === "-";
}

export function countValueChars(text: string): number {
  let count = 0;
  for (const char of foldDigits(text)) if (isValueChar(char)) count += 1;
  return count;
}

/** Group a **digit string** in threes. The fractional tail is never grouped. */
export function groupDigits(clean: string): string {
  const negative = clean.startsWith("-");
  const body = negative ? clean.slice(1) : clean;
  const dot = body.indexOf(".");
  const whole = dot === -1 ? body : body.slice(0, dot);
  const tail = dot === -1 ? "" : body.slice(dot);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${tail}`;
}

export type MoneyDraft = {
  /** The parsed figure, or null while the field holds nothing usable. */
  value: number | null;
  /** What the field should now show, grouped. */
  text: string;
};

/**
 * Read whatever is in the box and say what it means and how it should look.
 *
 * ⚠️ Leading zeros are stripped here for the same reason `NumberInput` strips
 * them in its own handler: a field resting at `0` that is typed into reads
 * `07` otherwise, and the state and the screen then disagree. A bare `0` and a
 * `0.5` survive, because the lookahead only matches when a digit follows.
 */
export function readMoney(
  raw: string,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): MoneyDraft {
  const folded = foldDigits(raw);

  let clean = "";
  let seenDot = false;
  for (const char of folded) {
    if (char >= "0" && char <= "9") {
      clean += char;
      continue;
    }
    // Only ever one decimal point, and only after something.
    if (char === "." && !seenDot) {
      seenDot = true;
      clean += char;
      continue;
    }
    // A sign is a sign only in front, and only where negatives are meaningful.
    if (char === "-" && allowNegative && clean === "") clean += char;
  }

  clean = clean.replace(/^(-?)0+(?=\d)/, "$1");

  const numeric = Number(clean);
  const value = clean === "" || !Number.isFinite(numeric) ? null : numeric;
  return { value, text: groupDigits(clean) };
}

/** A stored figure, as the field should show it. */
export function showMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return groupDigits(String(value));
}

/**
 * Where the caret belongs once the box has been reformatted: after the same
 * number of value characters it was after before.
 */
export function caretAfterValueChars(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (isValueChar(text[index])) {
      seen += 1;
      if (seen === count) return index + 1;
    }
  }
  return text.length;
}

/**
 * Backspace and Delete, over a separator the reader did not put there.
 *
 * ⚠️ Without this a grouped field reads as broken, and it is the single thing
 * that makes one feel wrong. Backspacing over the comma in `1,495,013` deletes
 * a character that is not part of the value, so the reformat puts it straight
 * back and the field does not change — the key appears dead, and the only way
 * out is to press it twice. The deletion is widened to take the digit the
 * separator is standing in front of, which is what the reader was aiming at.
 *
 * Returns the text to put in the box, or null to let the browser do its own
 * thing — which is every ordinary case, including any selection.
 */
export function deleteThroughSeparator(
  text: string,
  start: number,
  end: number,
  key: "Backspace" | "Delete",
): { text: string; caret: number } | null {
  if (start !== end) return null;
  if (key === "Backspace") {
    if (start === 0 || isValueChar(text[start - 1])) return null;
    // The separator, and the digit in front of it.
    const cut = start - (start >= 2 && isValueChar(text[start - 2]) ? 2 : 1);
    return { text: text.slice(0, cut) + text.slice(start), caret: cut };
  }
  if (start >= text.length || isValueChar(text[start])) return null;
  const to = start + (start + 1 < text.length && isValueChar(text[start + 1]) ? 2 : 1);
  return { text: text.slice(0, start) + text.slice(to), caret: start };
}
