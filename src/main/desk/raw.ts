import { createHash } from "node:crypto";
import type { RepairStatus } from "../../site/lib/data/orders.ts";
import { repairBase, repairMoney, repairTotal, type PaymentTerms, type RepairService } from "../../site/lib/data/repair-desk.ts";
import { completionStatus, settledStatus } from "../../site/lib/data/repair-stage.ts";
import { baghdadDay } from "../../site/lib/data/date-window.ts";
import type { ReturnEntry, TicketState } from "../../site/lib/data/desk-figures.ts";
import { cleanFaultName, faultsChangedMeaning } from "../../site/lib/data/repair-faults.ts";
import { normalizePhone } from "../../site/lib/validation/account.ts";
import type { DeskTicketInput, FinancePatch, OpKind, RepairDetailsPatch, RepairPatch } from "../../shared/contract";

/**
 * A repair ticket exactly as PostgREST returns it for `ticketSelect`, and the
 * changes this app can make to one.
 *
 * ---------------------------------------------------------------------------
 * The rule this file exists for
 * ---------------------------------------------------------------------------
 * The local database keeps two things apart: the ticket **as the server last
 * said it is**, and the list of **changes made here that the server has not
 * accepted yet** (the outbox). What the screen shows is always the first with
 * the second applied on top, by `applyOp`.
 *
 * That separation is what makes offline work safe. A pull never overwrites a
 * change waiting to be sent — it replaces the server's half and the waiting
 * change is laid over it again. A refused change is simply no longer applied,
 * and the ticket shows what the server actually holds. And there is no step
 * anywhere that has to "merge" two copies of a ticket by guessing.
 *
 * `applyOp` repeats the dashboard's own server actions field for field —
 * `updateRepair`'s money arithmetic, where «مكتمل» lands, what paying the
 * rest does — and the database's triggers on top of them (the booking day,
 * the badge), so a ticket looks the same here before it is sent as it will
 * on the dashboard after.
 *
 * ---------------------------------------------------------------------------
 * The maintenance stages (the shop, 2026-11-24)
 * ---------------------------------------------------------------------------
 * `20261124_maintenance_stages.sql` gives a ticket `completed_at`, the moment
 * it became «مكتمل» — its booking day — and the badge «تم التسليم للزبون»
 * (`handed_over_*`). Until that file runs on the server the columns are not
 * there, and neither is anything that keeps them: a ticket read without them
 * is never given one here (`"completed_at" in raw`), and the two ledgers
 * follow the old rules (`paymentTargetV1`, `returnForV1`).
 */

const TICKET_COLUMNS = `id, code, status, created_at, updated_at, is_deleted, user_id, branch_id,
  device_model, brand_code, customer_name, customer_phone, customer_phone2, fulfillment,
  address_line, preferred_at, notes, quote_amount, quote_notes, quote_sent_at, actual_cost,
  photos_before, photos_after, technician_id, assigned_to, accepted_by, admin_note,
  service, warranty_price, warranty_days, warranty_start, custom_faults`;

const TICKET_JOINS = `branches ( name_ar, name_en ),
  technicians ( name ),
  repair_ticket_issues ( issue_code, repair_issues ( name_ar, name_en ) ),
  repair_ticket_finance ( cost_price, collected, payment_terms, updated_at )`;

/**
 * The columns a ticket is read with. ⚠️ Naming a column PostgREST does not
 * know fails the whole select, so the stage columns are asked for only once
 * the server is known to have them (`refs.available().stages`).
 */
export function ticketSelect(stages: boolean): string {
  return `${TICKET_COLUMNS},${stages ? " completed_at, handed_over_at, handed_over_by," : ""}
  ${TICKET_JOINS}`;
}

export type RawFinance = {
  cost_price: number | string | null;
  collected: number | string | null;
  payment_terms: PaymentTerms | string | null;
  updated_at?: string | null;
};

export type RawTicket = {
  id: string;
  code: string;
  status: RepairStatus;
  created_at: string;
  updated_at: string | null;
  is_deleted: boolean;
  user_id: string | null;
  branch_id: string | null;
  device_model: string;
  brand_code: string | null;
  customer_name: string;
  customer_phone: string;
  customer_phone2: string | null;
  fulfillment: "drop_off" | "pickup";
  address_line: string | null;
  preferred_at: string | null;
  notes: string | null;
  quote_amount: number | string | null;
  quote_notes: string | null;
  /**
   * When the ticket's content was last changed after it was opened — the
   * site's `EDITED_COLUMN` (the retired quote step's column, given this
   * meaning on 2026-11-18). Status moves and hand-overs never write it.
   */
  quote_sent_at?: string | null;
  actual_cost: number | string | null;
  photos_before: string[] | null;
  photos_after: string[] | null;
  technician_id: string | null;
  assigned_to: string | null;
  accepted_by?: string | null;
  admin_note?: string | null;
  service?: RepairService | null;
  warranty_price?: number | string | null;
  warranty_days?: number | null;
  warranty_start?: string | null;
  custom_faults?: string[] | null;
  /**
   * When it became «مكتمل» — its booking day. Absent (not null) while the
   * server has no such column: then nothing here gives it one.
   */
  completed_at?: string | null;
  /** «تم التسليم للزبون» — a badge for the bench, never money. */
  handed_over_at?: string | null;
  handed_over_by?: string | null;
  branches: { name_ar: string; name_en: string } | null;
  technicians: { name: string } | null;
  repair_ticket_issues: { issue_code: string; repair_issues: { name_ar: string; name_en: string } | null }[] | null;
  repair_ticket_finance?: RawFinance | RawFinance[] | null;
};

export const num = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined || value === "" ? null : Number(value);

const whole = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? null : Math.max(0, Math.round(value));

/** A ticket's faults by code and Arabic name, its old typed ones with no code. */
export function faultsOfRaw(raw: RawTicket | null | undefined): { code: string | null; name: string }[] {
  if (!raw) return [];
  return [
    ...(raw.repair_ticket_issues ?? []).map((link) => ({
      code: link.issue_code as string | null,
      name: link.repair_issues?.name_ar ?? link.issue_code,
    })),
    ...(raw.custom_faults ?? []).filter((text) => text.trim()).map((text) => ({ code: null, name: text })),
  ];
}

export function financeOf(raw: RawTicket): RawFinance | null {
  const ledger = raw.repair_ticket_finance;
  return (Array.isArray(ledger) ? ledger[0] : ledger) ?? null;
}

/** What the customer is charged: the total, the warranty inside it. */
export const priceOf = (raw: RawTicket): number | null => num(raw.actual_cost) ?? num(raw.quote_amount);

const termsOf = (raw: RawTicket): PaymentTerms => (financeOf(raw)?.payment_terms === "deferred" ? "deferred" : "cash");

/** What is still owed on an آجل ticket — the site's `repairMoney(...).remaining`. */
function remainingOf(raw: RawTicket): number {
  const ledger = financeOf(raw);
  return repairMoney({
    price: priceOf(raw),
    warranty: num(raw.warranty_price),
    cost: num(ledger?.cost_price),
    collected: num(ledger?.collected),
    terms: termsOf(raw),
    completed: false,
  }).remaining;
}

/* ── The device and the customer, as the counter's form checks them ──── */

/** A model or a name, its spacing folded the way the site's actions fold it. */
const folded = (value: string) => value.trim().replace(/\s+/g, " ");

/**
 * The site's `updateRepairDetails` checks, field by field: an error key, or
 * the columns to write. Shared by the action (which refuses) and the push
 * (which writes), so the two cannot disagree about what a phone number is.
 */
export function detailsColumns(
  patch: RepairDetailsPatch,
): { ok: true; columns: Record<string, string | null> } | { ok: false; error: string } {
  const columns: Record<string, string | null> = {};
  if (patch.deviceModel !== undefined) {
    const model = folded(patch.deviceModel);
    if (model.length < 1 || model.length > 120) return { ok: false, error: "device_required" };
    columns.device_model = model;
  }
  if (patch.brandCode !== undefined) {
    const code = (patch.brandCode ?? "").trim().toLowerCase();
    if (code && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(code)) return { ok: false, error: "device_required" };
    columns.brand_code = code || null;
  }
  if (patch.customerName !== undefined) {
    const name = folded(patch.customerName);
    if (name.length < 2 || name.length > 80) return { ok: false, error: "customer_name_required" };
    columns.customer_name = name;
  }
  if (patch.customerPhone !== undefined) {
    const phone = normalizePhone(patch.customerPhone);
    if (!/^07\d{9}$/.test(phone)) return { ok: false, error: "phone_invalid" };
    columns.customer_phone = phone;
  }
  if (patch.customerPhone2 !== undefined) {
    const typed = (patch.customerPhone2 ?? "").trim();
    const phone = typed ? normalizePhone(typed) : "";
    if (phone && !/^07\d{9}$/.test(phone)) return { ok: false, error: "phone_invalid" };
    columns.customer_phone2 = phone || null;
  }
  return { ok: true, columns };
}

/* ── The changes ──────────────────────────────────────────────────────── */

/** The op payloads, by kind. */
export type OpPayload = {
  create: { input: DeskTicketInput; localCode: string; at: string; technicianId: string | null; viewerId: string };
  update: RepairPatch;
  finance: FinancePatch;
  assign: { holderId: string | null; technicianId: string | null; holderName: string | null };
  /** Local photos are uploaded first; `uploaded` remembers which have been, so a retry does not send them twice. */
  photos: { urls: string[]; uploaded?: Record<string, string> };
  delete: { label?: string; reason?: string };
  /**
   * A ticket's faults, the whole new set — named, so the waiting change draws
   * them before the server has heard of it. `isNew` is a fault typed here
   * that the list does not have yet: its `code` is `typedFaultCode`'s, and the
   * push files it on the list first. `custom` is the ticket's old typed
   * faults as they should stand, or null to leave them.
   */
  faults: {
    faults: { code: string; name_ar: string; name_en: string; isNew?: boolean }[];
    custom: string[] | null;
  };
  /** The device and the customer, corrected — checked already (`detailsColumns`). */
  details: RepairDetailsPatch;
  /** «تم التسليم للزبون»: set, with who set it, or taken off. */
  handover: { handed: boolean; by: string | null };
  /** A website request: accepted («تم قبول الطلب») or refused (cancelled). */
  decide: { accept: boolean };
};

/**
 * The code a fault typed here is filed under — the one `add_repair_issue`
 * derives on the server (`c-` and twelve hex of md5 of the bench and the
 * lower-cased name), so a ticket opened offline names its new fault by the
 * code the server will give it.
 */
export function typedFaultCode(service: RepairService, name: string): string {
  const digest = createHash("md5")
    .update(`${service}:${cleanFaultName(name).toLowerCase()}`, "utf8")
    .digest("hex");
  return `c-${digest.slice(0, 12)}`;
}

/**
 * One waiting change. `createdAt` is when it was made here: it dates what the
 * change stamps (the booking day, the badge, «المعدّلة», the money row) the
 * way the server's own clock will, rather than by whenever the screen is next
 * drawn.
 */
export type AnyOp = { [K in OpKind]: { kind: K; payload: OpPayload[K]; createdAt?: string } }[OpKind];

/** A copy, so applying a change can never reach back into the stored server row. */
export function cloneRaw(raw: RawTicket): RawTicket {
  return structuredClone(raw);
}

/** A change to what the ticket says — not its status, not its holder. Puts it on «المعدّلة». */
export function isContentEdit(patch: RepairPatch): boolean {
  return (
    patch.price !== undefined ||
    patch.warranty !== undefined ||
    patch.quoteNotes !== undefined ||
    patch.warrantyDays !== undefined ||
    patch.warrantyStart !== undefined
  );
}

/**
 * A move to a new status, and the booking day the database keeps with it —
 * `repair_ticket_stamp_completed`: into «مكتمل», the moment it got there; out
 * of it on the same Baghdad day, it never was; out of it on a later day, it
 * keeps the day it was booked. Nothing is stamped on a ticket read from a
 * server without the column.
 */
function moveTo(raw: RawTicket, status: RepairStatus, at: string) {
  const was = raw.status;
  raw.status = status;
  if (!("completed_at" in raw)) return;
  if (status === "completed" && was !== "completed") {
    if (!raw.completed_at) raw.completed_at = at;
  } else if (was === "completed" && status !== "completed" && raw.completed_at) {
    if (baghdadDay(Date.parse(raw.completed_at)) === baghdadDay(Date.parse(at))) raw.completed_at = null;
  }
}

/** One waiting change, laid over a ticket. Pure; returns the same object it was given. */
export function applyOp(raw: RawTicket, op: AnyOp): RawTicket {
  const at = op.createdAt ?? new Date().toISOString();
  switch (op.kind) {
    case "update": {
      const patch = op.payload;
      if (patch.price !== undefined || patch.warranty !== undefined) {
        // `updateRepair`'s arithmetic: the total is what is stored, the
        // warranty is "of which", and whichever half changed the other is
        // read back and added.
        const heldWarranty = num(raw.warranty_price);
        const warranty = patch.warranty !== undefined ? whole(patch.warranty) : heldWarranty;
        const base = patch.price !== undefined ? whole(patch.price) : repairBase(num(raw.actual_cost), heldWarranty);
        raw.actual_cost = repairTotal(base, warranty);
        if (patch.warranty !== undefined) raw.warranty_price = warranty || null;
      }
      if (patch.status !== undefined) {
        // «مكتمل» on an آجل that still owes lands on «بانتظار الزبون» (the
        // shop, 2026-11-24) — decided from the ticket's own money, after this
        // change's price, as `updateRepair` decides it.
        const status = patch.status === "completed" ? completionStatus(termsOf(raw), remainingOf(raw)) : patch.status;
        moveTo(raw, status, at);
      }
      if (patch.quoteNotes !== undefined) raw.quote_notes = patch.quoteNotes;
      if (isContentEdit(patch)) raw.quote_sent_at = at;
      if (patch.warrantyDays !== undefined) raw.warranty_days = whole(patch.warrantyDays) || null;
      if (patch.warrantyStart !== undefined) raw.warranty_start = patch.warrantyStart || null;
      return raw;
    }
    case "finance": {
      const patch = op.payload;
      const current = financeOf(raw) ?? { cost_price: null, collected: null, payment_terms: "cash" };
      const next: RawFinance = { ...current };
      if (patch.costPrice !== undefined) next.cost_price = whole(patch.costPrice);
      if (patch.collected !== undefined) next.collected = whole(patch.collected);
      if (patch.paymentTerms !== undefined) {
        next.payment_terms = patch.paymentTerms === "deferred" ? "deferred" : "cash";
        // Cash is paid in full; a figure kept from when it was deferred would
        // only sit in the row contradicting it — `updateRepairFinance`.
        if (next.payment_terms === "cash") next.collected = null;
      }
      // Dated by the change itself, so money taken offline counts on the day
      // it was taken until the server's ledger dates it (desk-figures.ts).
      next.updated_at = at;
      raw.repair_ticket_finance = next;
      if (!patch.settle) raw.quote_sent_at = at;
      // Paying the rest of a ticket that waits for its customer — or switching
      // it to نقد — completes it, on the day of the payment.
      const settled = settledStatus({ status: raw.status, terms: termsOf(raw), remaining: remainingOf(raw) });
      if (settled) moveTo(raw, settled, at);
      return raw;
    }
    case "assign": {
      raw.assigned_to = op.payload.holderId;
      raw.accepted_by = op.payload.holderId;
      raw.technician_id = op.payload.technicianId;
      raw.technicians = op.payload.holderName ? { name: op.payload.holderName } : null;
      return raw;
    }
    case "photos": {
      raw.photos_after = [...(raw.photos_after ?? []), ...op.payload.urls];
      return raw;
    }
    case "delete": {
      raw.is_deleted = true;
      return raw;
    }
    case "faults": {
      const before = faultsOfRaw(raw);
      raw.repair_ticket_issues = op.payload.faults.map((fault) => ({
        issue_code: fault.code,
        repair_issues: { name_ar: fault.name_ar, name_en: fault.name_en },
      }));
      if (op.payload.custom !== null) raw.custom_faults = op.payload.custom;
      // «المعدّلة» only for a fault added or taken off — never the same fault
      // spelt better (the shop, 2026-11-20; the site's `faultsChangedMeaning`).
      if (faultsChangedMeaning(before, faultsOfRaw(raw))) raw.quote_sent_at = at;
      return raw;
    }
    case "details": {
      const checked = detailsColumns(op.payload);
      if (!checked.ok) return raw;
      const { columns } = checked;
      if (columns.device_model != null) raw.device_model = columns.device_model;
      if (columns.brand_code !== undefined) raw.brand_code = columns.brand_code;
      if (columns.customer_name != null) raw.customer_name = columns.customer_name;
      if (columns.customer_phone != null) raw.customer_phone = columns.customer_phone;
      if (columns.customer_phone2 !== undefined) raw.customer_phone2 = columns.customer_phone2;
      if (Object.keys(columns).length) raw.quote_sent_at = at;
      return raw;
    }
    case "handover": {
      raw.handed_over_at = op.payload.handed ? at : null;
      raw.handed_over_by = op.payload.handed ? op.payload.by : null;
      return raw;
    }
    case "decide": {
      if (raw.status === "requested") moveTo(raw, op.payload.accept ? "approved" : "cancelled", at);
      return raw;
    }
    case "create":
      // A ticket opened here is stored as its own draft row; there is nothing
      // to lay over it.
      return raw;
  }
}

/* ── What the two ledgers will record when a change reaches the server ── */

/** What the figures read of a ticket — the site's `TicketState`. */
export function stateOf(raw: RawTicket, cost?: number | null): TicketState {
  return {
    status: raw.status,
    price: priceOf(raw),
    warranty: num(raw.warranty_price),
    cost: cost === undefined ? num(financeOf(raw)?.cost_price) : cost,
  };
}

/**
 * What a ticket has paid, by the rule — the database's `repair_payment_target`
 * (20261124): آجل, what was collected; نقد, its price once «مكتمل» and nothing
 * before; reopened on a later day, what it had already paid (`held`); a
 * cancelled ticket nothing; a deleted one is left alone (null).
 */
export function paymentTarget(raw: RawTicket, held: number): number | null {
  if (raw.is_deleted) return null;
  if (raw.status === "cancelled" || raw.status === "declined") return 0;
  const price = Math.max(0, priceOf(raw) ?? 0);
  if (termsOf(raw) === "deferred") return Math.min(price, Math.max(0, num(financeOf(raw)?.collected) ?? 0));
  if (raw.status === "completed") return price;
  if (raw.completed_at) return held;
  return 0;
}

/**
 * The same, before 20261124 runs on the server (20261120 and 20261121): a
 * نقد ticket paid its price whatever its stage, a cancelled one nothing.
 */
export function paymentTargetV1(raw: RawTicket): number | null {
  if (raw.is_deleted) return null;
  if (raw.status === "cancelled" || raw.status === "declined") return 0;
  const ledger = financeOf(raw);
  return repairMoney({
    price: priceOf(raw),
    warranty: num(raw.warranty_price),
    cost: null,
    collected: num(ledger?.collected),
    terms: termsOf(raw),
    completed: true,
  }).collected;
}

const sameDayOrBefore = (at: string, day: string) => baghdadDay(Date.parse(at)) <= baghdadDay(Date.parse(day));

/**
 * The «مرتجع» the database will record for one change — `repair_record_return_v2`
 * (20261124): only a booked ticket, only on a later Baghdad day than it was
 * booked, and only when what counts moved — a state is worth its money while
 * it is «مكتمل», nothing otherwise. The purchase price is never one: the
 * database reads it once, for both sides. Null when it records nothing.
 */
export function returnFor(before: RawTicket, after: RawTicket, at: string): ReturnEntry | null {
  const booked = before.completed_at ?? null;
  if (!booked || sameDayOrBefore(at, booked)) return null;
  const value = (raw: RawTicket) => {
    if (raw.status !== "completed") return { price: 0, warranty: 0 };
    const price = Math.max(0, priceOf(raw) ?? 0);
    return { price, warranty: Math.min(price, Math.max(0, num(raw.warranty_price) ?? 0)) };
  };
  const was = value(before);
  const now = value(after);
  if (was.price === now.price && was.warranty === now.warranty) return null;
  const cost = num(financeOf(after)?.cost_price);
  return { at, before: stateOf(before, cost), after: stateOf(after, cost) };
}

/**
 * The same, before 20261124 runs on the server (`repair_record_return`,
 * 20261121): relative to the day the ticket was opened, a live ticket worth
 * its price, a first price never a «راجع».
 */
export function returnForV1(before: RawTicket, after: RawTicket, at: string): ReturnEntry | null {
  if (sameDayOrBefore(at, before.created_at)) return null;
  const live = (raw: RawTicket) => raw.status !== "cancelled" && raw.status !== "declined";
  const value = (raw: RawTicket) => {
    if (!live(raw)) return { price: 0, warranty: 0 };
    const price = Math.max(0, priceOf(raw) ?? 0);
    return { price, warranty: Math.min(price, Math.max(0, num(raw.warranty_price) ?? 0)) };
  };
  const was = value(before);
  const now = value(after);
  if (live(before) && live(after) && was.price === 0) return null;
  if (was.price === now.price && was.warranty === now.warranty) return null;
  return { at, before: stateOf(before), after: stateOf(after) };
}

/* ── A ticket opened here ─────────────────────────────────────────────── */

/** The draft a ticket opened here starts as, before the server gives it a code. */
export function draftTicket(
  id: string,
  payload: OpPayload["create"],
  refs: {
    branch: { name_ar: string; name_en: string } | null;
    issues: Map<string, { name_ar: string; name_en: string }>;
    holderName: string | null;
    /** The server keeps a booking day: the draft carries the column too. */
    stages?: boolean;
  },
): RawTicket {
  const input = payload.input;
  const total = repairTotal(whole(input.price), whole(input.warranty));
  const phone2 = (input.customerPhone2 ?? "").trim();
  return {
    id,
    code: payload.localCode,
    status: "approved",
    created_at: payload.at,
    updated_at: null,
    is_deleted: false,
    user_id: null,
    branch_id: input.branchId,
    device_model: input.deviceModel.trim(),
    brand_code: input.deviceBrandCode,
    customer_name: input.customerName.trim(),
    customer_phone: normalizePhone(input.customerPhone),
    customer_phone2: phone2 ? normalizePhone(phone2) : null,
    fulfillment: "drop_off",
    address_line: null,
    preferred_at: null,
    notes: input.notes.trim() || null,
    quote_amount: null,
    quote_notes: null,
    actual_cost: total,
    photos_before: [],
    photos_after: [],
    technician_id: payload.technicianId,
    assigned_to: input.holderId || null,
    accepted_by: input.holderId || null,
    admin_note: null,
    service: input.service,
    warranty_price: whole(input.warranty) || null,
    warranty_days: whole(input.warrantyDays) || null,
    warranty_start: null,
    custom_faults: input.customFaults ?? [],
    ...(refs.stages ? { completed_at: null, handed_over_at: null, handed_over_by: null } : {}),
    branches: refs.branch,
    technicians: refs.holderName ? { name: refs.holderName } : null,
    repair_ticket_issues: [
      ...input.issueCodes.map((code) => ({ issue_code: code, repair_issues: refs.issues.get(code) ?? null })),
      // Typed at the counter: named by their own words until the server files them.
      ...(input.newFaults ?? []).map((name) => ({
        issue_code: typedFaultCode(input.service, name),
        repair_issues: { name_ar: cleanFaultName(name), name_en: cleanFaultName(name) },
      })),
    ],
    repair_ticket_finance: {
      cost_price: whole(input.costPrice),
      collected: whole(input.collected),
      payment_terms: input.paymentTerms === "deferred" ? "deferred" : "cash",
    },
  };
}

/** What a waiting change is, in a line, for the sync panel and the log. */
export function describeOp(op: AnyOp): string {
  switch (op.kind) {
    case "create":
      return `${op.payload.input.customerName} · ${op.payload.input.deviceModel}`;
    case "update":
      return Object.keys(op.payload).join(", ");
    case "finance":
      return Object.keys(op.payload).join(", ");
    case "assign":
      return op.payload.holderName ?? "—";
    case "photos":
      return String(op.payload.urls.length);
    case "delete":
      return op.payload.reason ?? "";
    case "faults":
      return op.payload.faults.map((fault) => fault.name_ar).join("، ");
    case "details":
      return Object.keys(op.payload).join(", ");
    case "handover":
      return op.payload.handed ? "on" : "off";
    case "decide":
      return op.payload.accept ? "accept" : "refuse";
  }
}

/** The idempotency mark a ticket opened here carries on the server. */
export const markerFor = (localId: string) => `[desk-app:${localId}]`;
