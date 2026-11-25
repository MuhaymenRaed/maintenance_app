/**
 * The size of a price, said back in words: 1,350,000 is «مليون و350 ألف».
 *
 * A price box shows the figure grouped in threes, and a dropped or doubled
 * zero still looks like a price — 135,000 for a 1,350,000 handset is the
 * mistake that reaches a card. Read back in words under the box (the shop,
 * 2026-11-25: "the prices submitting … easy and forward"), the magnitude is
 * checked without counting digits.
 *
 * Figures stay Western digits in both locales, the site's rule; only the
 * magnitudes are words. Under a thousand there is nothing to check and the
 * answer is null.
 */
export function moneyInWords(value: number, locale: string): string | null {
  if (!Number.isFinite(value)) return null;
  const whole = Math.round(value);
  if (whole < 1000) return null;

  const millions = Math.floor(whole / 1_000_000);
  const thousands = Math.floor((whole % 1_000_000) / 1000);
  const rest = whole % 1000;
  const arabic = locale === "ar";

  const parts: string[] = [];
  if (millions) parts.push(arabic ? counted(millions, "مليون", "مليونان", "ملايين") : `${millions} million`);
  if (thousands) parts.push(arabic ? counted(thousands, "ألف", "ألفان", "آلاف") : `${thousands} thousand`);
  if (rest) parts.push(String(rest));
  return parts.join(arabic ? " و" : " ");
}

/** One, two, three to ten, and eleven up take different forms in Arabic. */
function counted(n: number, one: string, two: string, few: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return `${n} ${few}`;
  return `${n} ${one}`;
}
