import { normalizePhone } from "../validation/account.ts";
import type { PaymentTerms } from "./repair-desk.ts";

/**
 * What a repair ticket's window can change, and what saving it does.
 *
 * The shop, 2026-11-26: "instead of popup modal to confirm the changes after
 * each edit u made, let the admin do all the changes he needs then after
 * finish all of it make the edits get saved by a button of حفظ التغييرات with a
 * popup checking modal too". So the window keeps a draft, and nothing reaches
 * the database until that button is pressed and the review is confirmed.
 *
 * ⚠️ **The draft holds only the fields the reader touched.** A field nobody
 * typed in reads the ticket as it is now, so a change made elsewhere — another
 * counter, the desk app's sync, a status move from this same window — shows
 * through instead of being listed as an "edit" that would quietly put the old
 * value back on save. A copy of the whole ticket taken when the window opened
 * would do exactly that.
 *
 * Pure, and imported relatively with the extension, so `node --test` runs it
 * without a bundler — the pattern `lib/data/queue-window.ts` follows.
 */
export type TicketFields = {
  customerName: string;
  customerPhone: string;
  customerPhone2: string | null;
  brandCode: string | null;
  deviceModel: string;
  /** «النتيجة» — `quote_notes`, what the customer reads became of the device. */
  quoteNotes: string | null;
  /** The repair alone, before any warranty. */
  basePrice: number | null;
  costPrice: number | null;
  paymentTerms: PaymentTerms;
  collected: number | null;
  warrantyPrice: number | null;
  warrantyDays: number | null;
  /** `YYYY-MM-DD`. */
  warrantyStart: string | null;
  /** The fault picker's values: listed codes, `new:` names, `old:` typed faults. */
  faults: readonly string[];
  holderId: string | null;
};

/** What has been typed and not saved — only the fields the reader touched. */
export type TicketDraft = Partial<TicketFields>;

/**
 * One line of the review. The make and the model are one line, «الجهاز»:
 * changing the make clears the model, so neither is ever changed alone.
 */
export type ChangeKey =
  | "customerName"
  | "customerPhone"
  | "customerPhone2"
  | "device"
  | "faults"
  | "holderId"
  | "quoteNotes"
  | "basePrice"
  | "costPrice"
  | "paymentTerms"
  | "collected"
  | "warrantyPrice"
  | "warrantyDays"
  | "warrantyStart";

/** The window's own order, top to bottom, so the review reads the way the form does. */
export const CHANGE_ORDER: readonly ChangeKey[] = [
  "customerName",
  "customerPhone",
  "customerPhone2",
  "device",
  "faults",
  "holderId",
  "quoteNotes",
  "basePrice",
  "costPrice",
  "paymentTerms",
  "collected",
  "warrantyPrice",
  "warrantyDays",
  "warrantyStart",
];

/** The ticket as the window draws it: the draft over what is saved. */
export function draftView(saved: TicketFields, draft: TicketDraft): TicketFields {
  return { ...saved, ...draft };
}

const words = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
const phone = (value: string | null | undefined) => (value ? normalizePhone(value) : "");
const brand = (value: string | null | undefined) => (value ?? "").trim().toLowerCase() || null;
/** A money figure the way the database keeps it: whole, never negative. */
const whole = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.round(value));
const orNull = <T>(value: T | null | undefined) => (value === "" || value == null ? null : value);
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

/**
 * Which lines of the review the draft changes — compared the way the server
 * will store them, so typing a value and typing it back, or adding a space,
 * is not a change.
 */
export function changedKeys(saved: TicketFields, draft: TicketDraft): ChangeKey[] {
  const view = draftView(saved, draft);
  const differs: Record<ChangeKey, boolean> = {
    customerName: "customerName" in draft && words(view.customerName) !== words(saved.customerName),
    customerPhone: "customerPhone" in draft && phone(view.customerPhone) !== phone(saved.customerPhone),
    customerPhone2:
      "customerPhone2" in draft && (phone(view.customerPhone2) || null) !== (phone(saved.customerPhone2) || null),
    device:
      ("brandCode" in draft && brand(view.brandCode) !== brand(saved.brandCode)) ||
      ("deviceModel" in draft && words(view.deviceModel) !== words(saved.deviceModel)),
    faults: "faults" in draft && !sameSet(view.faults, saved.faults),
    holderId: "holderId" in draft && orNull(view.holderId) !== orNull(saved.holderId),
    quoteNotes: "quoteNotes" in draft && (view.quoteNotes ?? "") !== (saved.quoteNotes ?? ""),
    basePrice: "basePrice" in draft && view.basePrice !== saved.basePrice,
    costPrice: "costPrice" in draft && view.costPrice !== saved.costPrice,
    paymentTerms: "paymentTerms" in draft && view.paymentTerms !== saved.paymentTerms,
    // A cash ticket carries no «الواصل»: switching to نقد clears it, so the
    // figure is not a line of its own then.
    collected:
      "collected" in draft && view.paymentTerms === "deferred" && whole(view.collected) !== whole(saved.collected),
    warrantyPrice: "warrantyPrice" in draft && whole(view.warrantyPrice) !== whole(saved.warrantyPrice),
    warrantyDays: "warrantyDays" in draft && (whole(view.warrantyDays) || null) !== (whole(saved.warrantyDays) || null),
    warrantyStart: "warrantyStart" in draft && orNull(view.warrantyStart) !== orNull(saved.warrantyStart),
  };
  return CHANGE_ORDER.filter((key) => differs[key]);
}

/** What one press of «حفظ التغييرات» sends, call by call. */
export type TicketSavePlan = {
  details?: {
    customerName?: string;
    customerPhone?: string;
    customerPhone2?: string | null;
    deviceModel?: string;
    brandCode?: string | null;
  };
  repair?: {
    price?: number | null;
    warranty?: number | null;
    warrantyDays?: number | null;
    warrantyStart?: string | null;
    quoteNotes?: string | null;
  };
  finance?: { costPrice?: number | null; paymentTerms?: PaymentTerms; collected?: number | null };
  faults?: readonly string[];
  holder?: { holderId: string | null };
};

/** A refusal is one of the keys the window already words. */
export type PlanRefusal =
  | "customer_name_required"
  | "phone_invalid"
  | "device_required"
  | "price_required"
  | "deskFaultKeepOne";

export type PlanResult =
  | { ok: true; changes: ChangeKey[]; plan: TicketSavePlan }
  | { ok: false; error: PlanRefusal; field: ChangeKey };

const IRAQ_MOBILE = /^07\d{9}$/;

/**
 * The draft as calls, in the order they must run.
 *
 * ⚠️ **The order is load-bearing.** The customer's details first; then the
 * price, because the money call measures «الواصل» against the ticket's total
 * as the database holds it at that moment; then the money; then the faults;
 * and the holder LAST — handing a ticket up to a manager takes it out of an
 * assistant's control, and every call before it would then be refused.
 *
 * The same checks the server makes are made here first, so a refusal names
 * the field before anything is sent and nothing is half-saved over it.
 */
export function planTicketSave(saved: TicketFields, draft: TicketDraft): PlanResult {
  const changes = changedKeys(saved, draft);
  const view = draftView(saved, draft);
  const has = (key: ChangeKey) => changes.includes(key);
  const plan: TicketSavePlan = {};

  const details: NonNullable<TicketSavePlan["details"]> = {};
  if (has("customerName")) {
    const name = words(view.customerName);
    if (name.length < 2 || name.length > 80) return { ok: false, error: "customer_name_required", field: "customerName" };
    details.customerName = name;
  }
  if (has("customerPhone")) {
    const number = phone(view.customerPhone);
    if (!IRAQ_MOBILE.test(number)) return { ok: false, error: "phone_invalid", field: "customerPhone" };
    details.customerPhone = number;
  }
  if (has("customerPhone2")) {
    const number = phone(view.customerPhone2);
    if (number && !IRAQ_MOBILE.test(number)) return { ok: false, error: "phone_invalid", field: "customerPhone2" };
    details.customerPhone2 = number || null;
  }
  if (has("device")) {
    const model = words(view.deviceModel);
    if (model.length < 1 || model.length > 120) return { ok: false, error: "device_required", field: "device" };
    details.deviceModel = model;
    details.brandCode = brand(view.brandCode);
  }
  if (Object.keys(details).length) plan.details = details;

  const repair: NonNullable<TicketSavePlan["repair"]> = {};
  if (has("basePrice")) {
    // The fee may be changed, never emptied — the server refuses the same.
    if (!(whole(view.basePrice) > 0)) return { ok: false, error: "price_required", field: "basePrice" };
    repair.price = whole(view.basePrice);
  }
  if (has("warrantyPrice")) repair.warranty = whole(view.warrantyPrice) || null;
  if (has("warrantyDays")) repair.warrantyDays = whole(view.warrantyDays) || null;
  if (has("warrantyStart")) repair.warrantyStart = orNull(view.warrantyStart);
  if (has("quoteNotes")) repair.quoteNotes = view.quoteNotes ?? "";
  if (Object.keys(repair).length) plan.repair = repair;

  const finance: NonNullable<TicketSavePlan["finance"]> = {};
  if (has("costPrice")) finance.costPrice = view.costPrice;
  if (has("paymentTerms")) finance.paymentTerms = view.paymentTerms;
  // Cash is paid in full; a figure kept from when it was deferred goes with
  // the switch, as `updateRepairFinance` clears it too.
  if (view.paymentTerms === "cash" && has("paymentTerms")) finance.collected = null;
  else if (has("collected")) finance.collected = view.collected;
  if (Object.keys(finance).length) plan.finance = finance;

  if (has("faults")) {
    if (!view.faults.length) return { ok: false, error: "deskFaultKeepOne", field: "faults" };
    plan.faults = view.faults;
  }

  if (has("holderId")) plan.holder = { holderId: orNull(view.holderId) };

  return { ok: true, changes, plan };
}

/** Which draft fields each call settles, so a call that landed leaves the draft. */
export const STEP_FIELDS = {
  details: ["customerName", "customerPhone", "customerPhone2", "brandCode", "deviceModel"],
  repair: ["basePrice", "warrantyPrice", "warrantyDays", "warrantyStart", "quoteNotes"],
  finance: ["costPrice", "paymentTerms", "collected"],
  faults: ["faults"],
  holder: ["holderId"],
} as const satisfies Record<keyof TicketSavePlan, readonly (keyof TicketFields)[]>;

/** The draft with the fields one call settled taken out. */
export function withoutFields(draft: TicketDraft, fields: readonly (keyof TicketFields)[]): TicketDraft {
  const next: TicketDraft = { ...draft };
  for (const field of fields) delete next[field];
  return next;
}
