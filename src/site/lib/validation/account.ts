/**
 * Field rules for anything that creates or identifies an account.
 *
 * **Client and server share this file**, and that is the whole point rather
 * than a convenience: the browser uses it to say what is wrong while someone
 * is typing, and `lib/actions/auth.ts` runs the identical functions again
 * before it touches Supabase. Client-side validation is a courtesy to the
 * person filling the form and no kind of guarantee — a Server Action is a
 * public HTTP endpoint, and a form that only checks in React is a form that
 * does not check.
 *
 * It imports nothing but types, so it is safe on both sides — the same
 * constraint `lib/pricing.ts` lives under, and for the same reason: a value
 * imported from a `server-only` module drags the Supabase client into the
 * browser bundle and fails the build.
 *
 * Every failure is returned as a **message key**, never as English prose, so
 * the Arabic page renders Arabic. That mirrors how the RPCs report domain
 * failures (`cart_empty`, `invalid_province`) and how `authError` folds
 * Supabase's English strings back into keys.
 */

/** `null` means the value is good. */
export type FieldError = string | null;

/* ── Iraqi mobile numbers ───────────────────────────────────────────
   Eleven digits, `07` then a network digit then eight more. The network
   digit is 3–9: Korek is 075x, Asiacell 077x, Zain 078x/079x, and the
   range is left wide rather than pinned to today's four operators —
   a regex that knows the market is a regex that rejects a real customer
   the week a new prefix is allocated. What it does reject is a landline
   and a mistyped length, which is what actually arrives in this field.

   Three ways to write the same number reach us: the local `07…` form,
   the international `+9647…`, and `009647…`. They are one number, so
   they normalise to one stored value rather than being three rows in
   the same customer's history. `07…` is what is stored, because it is
   what every branch phone, every SMS and every receipt in this shop
   already uses.                                                       */

const IRAQ_MOBILE = /^07[3-9]\d{8}$/;

/**
 * Strip everything a human might type around the digits — spaces, dashes,
 * brackets, a leading `+` — and fold the two international prefixes onto the
 * local one. Arabic-Indic digits are folded too: an Arabic keyboard produces
 * ٠٧٧… and that is the same number.
 */
export function normalizePhone(input: string): string {
  const digits = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "");

  if (digits.startsWith("00964")) return `0${digits.slice(5)}`;
  if (digits.startsWith("964")) return `0${digits.slice(3)}`;
  return digits;
}

export function validatePhone(input: string): FieldError {
  const value = input.trim();
  if (!value) return "phone_required";
  return IRAQ_MOBILE.test(normalizePhone(value)) ? null : "phone_invalid";
}

/* ── Email ──────────────────────────────────────────────────────────
   Deliberately loose. The only test that proves an address exists is
   sending to it, which Supabase already does, so anything stricter than
   "one @ with something either side and a dot in the domain" starts
   rejecting real addresses — apostrophes, plus-addressing, long new
   TLDs — in exchange for nothing. This catches the typo that is
   actually common: a missing @ or a trailing comma.                   */

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/;

export function validateEmail(input: string): FieldError {
  const value = input.trim();
  if (!value) return "email_required";
  return EMAIL.test(value) ? null : "email_invalid";
}

/* ── Passwords ──────────────────────────────────────────────────────
   Length and nothing else. Composition rules — one capital, one digit,
   one symbol — are what produce `Password1!` on a sticky note, and the
   guidance that recommended them has been withdrawn. Eight is the floor
   Supabase itself enforces, matched here so the failure arrives beside
   the field rather than as a round trip.                              */

export const MIN_PASSWORD = 8;

/**
 * A password being **chosen**. Sign-up, and password changes.
 *
 * ⚠️ Not for sign-in — see `validateSignInPassword` below, and the reason it
 * has to exist.
 */
export function validatePassword(input: string): FieldError {
  if (!input) return "password_required";
  return input.length >= MIN_PASSWORD ? null : "weak_password";
}

/**
 * A password being **entered**. Sign-in, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ Why a length rule on sign-in is a lockout
 * ---------------------------------------------------------------------------
 * `validatePassword` was used on both forms, so signing in ran the *sign-up*
 * rule against a password the account already has. Anyone whose password is
 * shorter than eight characters — created from the Supabase dashboard, carried
 * over from before this rule, or typed by an owner into `createStaffAccount`
 * before that gained its own check — could not sign in at all.
 *
 * And the way it failed was the worst part. The form validates live, so the
 * message under the field read **"Use at least 8 characters"** while the person
 * was typing their own correct password, which reads as advice about what they
 * are entering rather than as a refusal to accept it. `signInWithPassword`
 * then returned the same key without ever asking Supabase, so the server
 * agreed with the form and no amount of retyping could get past it.
 *
 * A minimum is a rule about a password somebody is *setting*. At sign-in the
 * only thing worth checking is that there is one — everything else is the
 * authentication server's job, and it answers `invalid_credentials`, which is
 * both true and the only thing anybody should be told about a failed sign-in.
 */
export function validateSignInPassword(input: string): FieldError {
  return input ? null : "password_required";
}

/**
 * The confirmation field.
 *
 * Compared untrimmed and case-sensitively: a trailing space is a real
 * character in a password, and "helpfully" trimming one field but not the
 * other is how a person ends up locked out of an account they just created
 * with a password they typed correctly twice.
 */
export function validatePasswordConfirm(
  password: string,
  confirm: string,
): FieldError {
  if (!confirm) return "confirm_required";
  return password === confirm ? null : "password_mismatch";
}

export function validateName(input: string): FieldError {
  const value = input.trim();
  if (!value) return "name_required";
  // Two characters, so a stray keystroke is caught while a genuinely short
  // name is not. There is no upper bound worth guessing at.
  return value.length >= 2 ? null : "name_too_short";
}

/** Every field on the sign-up form, keyed so the caller can place each one. */
export type SignUpErrors = Partial<
  Record<"fullName" | "phone" | "email" | "password" | "confirm", string>
>;

/**
 * Validate a whole sign-up in one call, so the client and the action cannot
 * disagree about which rules apply.
 *
 * Returns every failure rather than the first: a form that reveals one problem
 * per submission is a form somebody abandons on the third round trip.
 */
export function validateSignUp(input: {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  confirm: string;
}): SignUpErrors {
  const errors: SignUpErrors = {};

  const checks = {
    fullName: validateName(input.fullName),
    phone: validatePhone(input.phone),
    email: validateEmail(input.email),
    password: validatePassword(input.password),
    confirm: validatePasswordConfirm(input.password, input.confirm),
  } as const;

  for (const [field, error] of Object.entries(checks)) {
    if (error) errors[field as keyof SignUpErrors] = error;
  }
  return errors;
}
