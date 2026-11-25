import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOp,
  detailsColumns,
  paymentTarget,
  paymentTargetV1,
  returnFor,
  returnForV1,
  type AnyOp,
  type RawTicket,
} from "../src/main/desk/raw.ts";

/**
 * The maintenance stages (the shop, 2026-11-24), as this computer applies a
 * change before the server has heard of it. Each rule here is the server's own
 * — `updateRepair`, `updateRepairFinance` and the triggers of
 * 20261124_maintenance_stages.sql — so a change made offline shows on the desk
 * exactly as it will once it is sent.
 */

function ticket(patch: Partial<RawTicket> & { terms?: "cash" | "deferred"; collected?: number | null } = {}): RawTicket {
  const { terms = "cash", collected = null, ...rest } = patch;
  return {
    id: "t1",
    code: "RP-00200",
    status: "in_repair",
    created_at: "2026-11-22T07:00:00Z",
    updated_at: null,
    is_deleted: false,
    user_id: null,
    branch_id: "b1",
    device_model: "Samsung Galaxy A17",
    brand_code: "samsung",
    customer_name: "زبون",
    customer_phone: "07701234567",
    customer_phone2: null,
    fulfillment: "drop_off",
    address_line: null,
    preferred_at: null,
    notes: null,
    quote_amount: null,
    quote_notes: null,
    quote_sent_at: null,
    actual_cost: 50000,
    photos_before: [],
    photos_after: [],
    technician_id: null,
    assigned_to: "u1",
    service: "hardware",
    warranty_price: null,
    warranty_days: null,
    warranty_start: null,
    custom_faults: [],
    completed_at: null,
    handed_over_at: null,
    handed_over_by: null,
    branches: null,
    technicians: null,
    repair_ticket_issues: [],
    repair_ticket_finance: { cost_price: null, collected, payment_terms: terms, updated_at: null },
    ...rest,
  };
}

const at = (iso: string, op: Omit<AnyOp, never>): AnyOp => ({ ...op, createdAt: iso }) as AnyOp;

test("«مكتمل» on an آجل that still owes lands on «بانتظار الزبون», unbooked", () => {
  const raw = ticket({ terms: "deferred", collected: 20000 });
  applyOp(raw, at("2026-11-24T08:00:00Z", { kind: "update", payload: { status: "completed" } }));
  assert.equal(raw.status, "ready");
  assert.equal(raw.completed_at, null);
});

test("«مكتمل» on a نقد ticket is booked on the day it is pressed", () => {
  const raw = ticket();
  applyOp(raw, at("2026-11-24T08:00:00Z", { kind: "update", payload: { status: "completed" } }));
  assert.equal(raw.status, "completed");
  assert.equal(raw.completed_at, "2026-11-24T08:00:00Z");
});

test("paying the rest of a waiting ticket completes it, on the day it is paid", () => {
  const raw = ticket({ status: "ready", terms: "deferred", collected: 20000 });
  applyOp(raw, at("2026-11-25T09:00:00Z", { kind: "finance", payload: { collected: 50000 } }));
  assert.equal(raw.status, "completed");
  assert.equal(raw.completed_at, "2026-11-25T09:00:00Z");
});

test("a part-payment on a waiting ticket leaves it waiting", () => {
  const raw = ticket({ status: "ready", terms: "deferred", collected: 20000 });
  applyOp(raw, at("2026-11-25T09:00:00Z", { kind: "finance", payload: { collected: 30000 } }));
  assert.equal(raw.status, "ready");
  assert.equal(raw.completed_at, null);
});

test("switching a waiting ticket to نقد completes it and drops what was typed as collected", () => {
  const raw = ticket({ status: "ready", terms: "deferred", collected: 20000 });
  applyOp(raw, at("2026-11-25T09:00:00Z", { kind: "finance", payload: { paymentTerms: "cash" } }));
  assert.equal(raw.status, "completed");
  const ledger = raw.repair_ticket_finance as { collected: number | null; payment_terms: string };
  assert.equal(ledger.payment_terms, "cash");
  assert.equal(ledger.collected, null);
});

test("taken off «مكتمل» the day it got there, it never was", () => {
  const raw = ticket({ status: "completed", completed_at: "2026-11-24T07:00:00Z" });
  applyOp(raw, at("2026-11-24T09:00:00Z", { kind: "update", payload: { status: "cancelled" } }));
  assert.equal(raw.status, "cancelled");
  assert.equal(raw.completed_at, null);
});

test("taken off «مكتمل» on a later day, it keeps its booking day", () => {
  const raw = ticket({ status: "completed", completed_at: "2026-11-23T07:00:00Z" });
  applyOp(raw, at("2026-11-24T09:00:00Z", { kind: "update", payload: { status: "cancelled" } }));
  assert.equal(raw.completed_at, "2026-11-23T07:00:00Z");
});

test("a server without the booking-day column is left without one", () => {
  const raw = ticket();
  delete (raw as Partial<RawTicket>).completed_at;
  applyOp(raw, at("2026-11-24T08:00:00Z", { kind: "update", payload: { status: "completed" } }));
  assert.equal(raw.status, "completed");
  assert.equal("completed_at" in raw, false);
});

test("the device and the customer, corrected, put the ticket on «المعدّلة»", () => {
  const raw = ticket();
  applyOp(
    raw,
    at("2026-11-24T08:00:00Z", {
      kind: "details",
      payload: { deviceModel: "Samsung Galaxy A26", brandCode: "samsung", customerName: "علي", customerPhone: "07801234567", customerPhone2: null },
    }),
  );
  assert.equal(raw.device_model, "Samsung Galaxy A26");
  assert.equal(raw.customer_name, "علي");
  assert.equal(raw.customer_phone, "07801234567");
  assert.equal(raw.quote_sent_at, "2026-11-24T08:00:00Z");
});

test("«تم التسليم للزبون» is a badge with a name on it, and it comes off whole", () => {
  const raw = ticket({ status: "completed", completed_at: "2026-11-24T07:00:00Z" });
  applyOp(raw, at("2026-11-24T08:00:00Z", { kind: "handover", payload: { handed: true, by: "u9" } }));
  assert.equal(raw.handed_over_at, "2026-11-24T08:00:00Z");
  assert.equal(raw.handed_over_by, "u9");
  assert.equal(raw.status, "completed");
  applyOp(raw, at("2026-11-24T09:00:00Z", { kind: "handover", payload: { handed: false, by: "u9" } }));
  assert.equal(raw.handed_over_at, null);
  assert.equal(raw.handed_over_by, null);
});

test("a website request is accepted into «تم قبول الطلب», or refused into «ملغي»", () => {
  const accepted = ticket({ status: "requested" });
  applyOp(accepted, at("2026-11-24T08:00:00Z", { kind: "decide", payload: { accept: true } }));
  assert.equal(accepted.status, "approved");
  const refused = ticket({ status: "requested" });
  applyOp(refused, at("2026-11-24T08:00:00Z", { kind: "decide", payload: { accept: false } }));
  assert.equal(refused.status, "cancelled");
});

test("what a ticket has paid — the database's `repair_payment_target`", () => {
  assert.equal(paymentTarget(ticket(), 0), 0, "نقد pays nothing before «مكتمل»");
  assert.equal(paymentTarget(ticket({ status: "completed" }), 0), 50000, "نقد pays its price once «مكتمل»");
  assert.equal(paymentTarget(ticket({ terms: "deferred", collected: 20000 }), 0), 20000, "آجل pays what was collected");
  assert.equal(paymentTarget(ticket({ terms: "deferred", collected: 90000 }), 0), 50000, "never more than the price");
  assert.equal(paymentTarget(ticket({ status: "cancelled", terms: "deferred", collected: 20000 }), 20000), 0);
  assert.equal(
    paymentTarget(ticket({ status: "in_repair", completed_at: "2026-11-23T07:00:00Z" }), 50000),
    50000,
    "reopened on a later day, it keeps what it paid",
  );
  assert.equal(paymentTarget(ticket({ is_deleted: true }), 0), null);
});

test("a change to a booked ticket on a later day is a «مرتجع»; anything else is not", () => {
  const booked = ticket({ status: "completed", completed_at: "2026-11-23T07:00:00Z" });
  const cancelled = { ...booked, status: "cancelled" as const };
  const entry = returnFor(booked, cancelled, "2026-11-24T09:00:00Z");
  assert.ok(entry);
  assert.equal(entry.before.status, "completed");
  assert.equal(entry.after.status, "cancelled");
  assert.equal(entry.before.price, 50000);

  assert.equal(returnFor(booked, cancelled, "2026-11-23T10:00:00Z"), null, "the booking day's own business");
  assert.equal(returnFor(ticket(), { ...ticket(), status: "cancelled" }, "2026-11-24T09:00:00Z"), null, "never booked");
  const costOnly = ticket({ status: "completed", completed_at: "2026-11-23T07:00:00Z" });
  costOnly.repair_ticket_finance = { cost_price: 9000, collected: null, payment_terms: "cash", updated_at: null };
  assert.equal(returnFor(booked, costOnly, "2026-11-24T09:00:00Z"), null, "the purchase price is never a «مرتجع»");
});

/*
 * Before 20261124 runs on the server, the ledgers keep the old rules — the
 * deployed `repair_record_payment` (20261120/21) and `repair_record_return`
 * (20261121) — and a change made here must be dated the way they will date it.
 */

test("before the stages, a نقد ticket has paid its price whatever its stage", () => {
  assert.equal(paymentTargetV1(ticket()), 50000, "in repair, still paid");
  assert.equal(paymentTargetV1(ticket({ terms: "deferred", collected: 20000 })), 20000);
  assert.equal(paymentTargetV1(ticket({ status: "cancelled" })), 0, "a cancellation gives it back");
  assert.equal(paymentTargetV1(ticket({ is_deleted: true })), null);
});

test("before the stages, a «راجع» is counted from the day the ticket was opened", () => {
  const opened = ticket({ created_at: "2026-11-22T07:00:00Z" });
  const cheaper = { ...opened, actual_cost: 40000 };
  assert.equal(returnForV1(opened, cheaper, "2026-11-22T12:00:00Z"), null, "its own day's business");
  const entry = returnForV1(opened, cheaper, "2026-11-23T09:00:00Z");
  assert.ok(entry);
  assert.equal(entry.before.price, 50000);
  assert.equal(entry.after.price, 40000);
  assert.ok(returnForV1(opened, { ...opened, status: "cancelled" }, "2026-11-23T09:00:00Z"), "a cancellation on a later day");
  assert.equal(returnForV1(opened, { ...opened, status: "diagnosing" }, "2026-11-23T09:00:00Z"), null, "a step along the flow");
  const unpriced = ticket({ created_at: "2026-11-22T07:00:00Z", actual_cost: null });
  assert.equal(returnForV1(unpriced, { ...unpriced, actual_cost: 30000 }, "2026-11-23T09:00:00Z"), null, "a first price never is");
});

test("the device and the customer are checked the way the counter's form checks them", () => {
  const fine = detailsColumns({ customerPhone: "٠٧٧٠ ١٢٣ ٤٥٦٧", customerPhone2: "+964 780 123 4567", brandCode: " Samsung ", deviceModel: "  Galaxy   A26 " });
  assert.ok(fine.ok);
  assert.deepEqual(fine.columns, {
    customer_phone: "07701234567",
    customer_phone2: "07801234567",
    brand_code: "samsung",
    device_model: "Galaxy A26",
  });
  const cleared = detailsColumns({ customerPhone2: "  ", brandCode: null });
  assert.ok(cleared.ok);
  assert.deepEqual(cleared.columns, { customer_phone2: null, brand_code: null });
  assert.deepEqual(detailsColumns({ customerPhone: "0770123" }), { ok: false, error: "phone_invalid" });
  assert.deepEqual(detailsColumns({ customerName: "ع" }), { ok: false, error: "customer_name_required" });
  assert.deepEqual(detailsColumns({ deviceModel: "   " }), { ok: false, error: "device_required" });
});

test("a refused correction changes nothing on the ticket", () => {
  const raw = ticket();
  applyOp(raw, at("2026-11-24T08:00:00Z", { kind: "details", payload: { customerPhone: "123" } }));
  assert.equal(raw.customer_phone, "07701234567");
  assert.equal(raw.quote_sent_at, null);
});
