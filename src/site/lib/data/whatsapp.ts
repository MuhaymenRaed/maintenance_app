/**
 * Reaching a customer on WhatsApp, with the conversation already started.
 *
 * Pure and client-safe — it imports nothing, so the order board, the repair
 * bench and the trade-in queue can all call it without dragging anything into
 * their bundles. It builds a `wa.me` link, which is the one form that works on
 * a desktop browser, the desktop app and a phone alike; `whatsapp://` opens
 * nothing on the laptops most of this back office runs on.
 *
 * ---------------------------------------------------------------------------
 * Why the number is rewritten rather than passed through
 * ---------------------------------------------------------------------------
 * Every phone in this database is stored the way an Iraqi customer types it —
 * `07XXXXXXXXX`. WhatsApp resolves nothing from that: the API takes a full
 * international number with no `+`, no leading zero and no separators, and a
 * malformed one opens a "phone number shared via url is invalid" page rather
 * than failing loudly. So the leading `0` becomes `964`, and anything already
 * carrying a country code is left alone.
 */

/** Iraq. Every branch, every customer, every technician. */
const COUNTRY_CODE = "964";

/**
 * A stored phone as WhatsApp wants it, or `null` when it cannot be one.
 *
 * Returning null rather than a best guess is deliberate: a link built from a
 * placeholder like `07XXXXXXXXX` looks live and lands on an error page, and
 * staff read that as WhatsApp being broken rather than as the record being
 * incomplete. The caller omits the button instead.
 */
export function whatsappNumber(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;

  // Arabic-Indic digits reach this from a customer who typed their number on
  // an Arabic keyboard; they are the same digits and must fold to Latin.
  const folded = phone.replace(/[\u0660-\u0669]/g, (d) =>
    String(d.charCodeAt(0) - 0x0660),
  );
  const digits = folded.replace(/\D/g, "");
  if (!digits) return null;

  const international = digits.startsWith("00")
    ? digits.slice(2)
    : digits.startsWith(COUNTRY_CODE)
      ? digits
      : digits.startsWith("0")
        ? COUNTRY_CODE + digits.slice(1)
        : COUNTRY_CODE + digits;

  // 964 + a 10-digit mobile. Shorter than that is a landline or a truncated
  // record, and neither is on WhatsApp.
  return international.length >= 12 && international.length <= 15
    ? international
    : null;
}

/**
 * The link itself, or `null` when the number cannot carry one.
 *
 * The message is pre-filled but never sent — WhatsApp opens the chat with the
 * text in the compose box, so whoever pressed the button still reads it and
 * decides. That is the right way round for a message about someone's money.
 */
export function whatsappLink(
  phone: string | null | undefined,
  message: string,
): string | null {
  const number = whatsappNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
