import type { RepairStatus } from "../../site/lib/data/orders.ts";
import { repairBase, repairTotal, type PaymentTerms, type RepairService } from "../../site/lib/data/repair-desk.ts";
import type { DeskTicketInput, FinancePatch, OpKind, RepairPatch } from "../../shared/contract";

/**
 * A repair ticket exactly as PostgREST returns it for `TICKET_SELECT`, and the
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
 * `updateRepair`'s money arithmetic in particular — so a ticket looks the same
 * here before it is sent as it will on the dashboard after.
 */

export const TICKET_SELECT = `id, code, status, created_at, updated_at, is_deleted, user_id, branch_id,
  device_model, brand_code, customer_name, customer_phone, customer_phone2, fulfillment,
  address_line, preferred_at, notes, quote_amount, quote_notes, actual_cost,
  photos_before, photos_after, technician_id, assigned_to, accepted_by, admin_note,
  service, warranty_price, warranty_days, warranty_start, custom_faults,
  branches ( name_ar, name_en ),
  technicians ( name ),
  repair_ticket_issues ( issue_code, repair_issues ( name_ar, name_en ) ),
  repair_ticket_finance ( cost_price, collected, payment_terms, updated_at )`;

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
  branches: { name_ar: string; name_en: string } | null;
  technicians: { name: string } | null;
  repair_ticket_issues: { issue_code: string; repair_issues: { name_ar: string; name_en: string } | null }[] | null;
  repair_ticket_finance?: RawFinance | RawFinance[] | null;
};

export const num = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined || value === "" ? null : Number(value);

const whole = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? null : Math.max(0, Math.round(value));

export function financeOf(raw: RawTicket): RawFinance | null {
  const ledger = raw.repair_ticket_finance;
  return (Array.isArray(ledger) ? ledger[0] : ledger) ?? null;
}

/** The op payloads, by kind. */
export type OpPayload = {
  create: { input: DeskTicketInput; localCode: string; at: string; technicianId: string | null; viewerId: string };
  update: RepairPatch;
  finance: FinancePatch;
  assign: { holderId: string | null; technicianId: string | null; holderName: string | null };
  /** Local photos are uploaded first; `uploaded` remembers which have been, so a retry does not send them twice. */
  photos: { urls: string[]; uploaded?: Record<string, string> };
  delete: { label?: string; reason?: string };
};

export type AnyOp = { [K in OpKind]: { kind: K; payload: OpPayload[K] } }[OpKind];

/** A copy, so applying a change can never reach back into the stored server row. */
export function cloneRaw(raw: RawTicket): RawTicket {
  return structuredClone(raw);
}

/** One waiting change, laid over a ticket. Pure; returns the same object it was given. */
export function applyOp(raw: RawTicket, op: AnyOp): RawTicket {
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
      if (patch.status !== undefined) raw.status = patch.status;
      if (patch.quoteNotes !== undefined) raw.quote_notes = patch.quoteNotes;
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
      if (patch.paymentTerms !== undefined) next.payment_terms = patch.paymentTerms === "deferred" ? "deferred" : "cash";
      raw.repair_ticket_finance = next;
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
    case "create":
      // A ticket opened here is stored as its own draft row; there is nothing
      // to lay over it.
      return raw;
  }
}

/** The draft a ticket opened here starts as, before the server gives it a code. */
export function draftTicket(
  id: string,
  payload: OpPayload["create"],
  refs: {
    branch: { name_ar: string; name_en: string } | null;
    issues: Map<string, { name_ar: string; name_en: string }>;
    holderName: string | null;
  },
): RawTicket {
  const input = payload.input;
  const total = repairTotal(whole(input.price), whole(input.warranty));
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
    customer_phone: input.customerPhone.replace(/[\s()-]/g, ""),
    customer_phone2: null,
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
    assigned_to: input.holderId,
    accepted_by: input.holderId,
    admin_note: null,
    service: input.service,
    warranty_price: whole(input.warranty) || null,
    warranty_days: whole(input.warrantyDays) || null,
    warranty_start: null,
    custom_faults: input.customFaults,
    branches: refs.branch,
    technicians: refs.holderName ? { name: refs.holderName } : null,
    repair_ticket_issues: input.issueCodes.map((code) => ({ issue_code: code, repair_issues: refs.issues.get(code) ?? null })),
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
  }
}

/** The idempotency mark a ticket opened here carries on the server. */
export const markerFor = (localId: string) => `[desk-app:${localId}]`;
