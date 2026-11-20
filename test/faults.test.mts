import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOp, draftTicket, typedFaultCode, type RawTicket } from "../src/main/desk/raw.ts";

/**
 * A ticket's faults, edited on this computer and sent later (2026-11-16).
 *
 * The code a typed fault is filed under has to be the one the server derives
 * in `add_repair_issue` — a ticket opened offline names its new fault by that
 * code until the sync files it — so the expected values below were computed by
 * Postgres itself (`'c-' || substr(md5('hardware' || ':' || lower(…)), 1, 12)`)
 * and are pinned here rather than recomputed.
 */

test("a typed fault's code is the server's, whatever its spacing", () => {
  assert.equal(typedFaultCode("hardware", "  يصفر   عند الشحن "), "c-ad5ac9ea78d5");
  assert.equal(typedFaultCode("software", "Face ID Repair"), "c-23d5261c2930");
});

function ticket(): RawTicket {
  return draftTicket(
    "local-1",
    {
      input: {
        service: "hardware",
        customerName: "زبون",
        customerPhone: "07701234567",
        branchId: "b1",
        deviceBrandCode: "samsung",
        deviceModel: "Samsung Galaxy A17",
        issueCodes: ["screen"],
        newFaults: ["يصفر عند الشحن"],
        notes: "",
        price: 25000,
        warranty: null,
        warrantyDays: null,
        costPrice: null,
        collected: null,
        paymentTerms: "cash",
        holderId: "u1",
      },
      localCode: "OFF-1116-01",
      at: "2026-11-16T10:00:00Z",
      technicianId: null,
      viewerId: "u1",
    },
    {
      branch: null,
      issues: new Map([["screen", { name_ar: "الشاشة", name_en: "Screen replacement" }]]),
      holderName: null,
    },
  );
}

test("a ticket opened here shows its typed fault under the server's code", () => {
  const draft = ticket();
  assert.deepEqual(
    draft.repair_ticket_issues?.map((link) => [link.issue_code, link.repair_issues?.name_ar]),
    [
      ["screen", "الشاشة"],
      ["c-ad5ac9ea78d5", "يصفر عند الشحن"],
    ],
  );
  assert.deepEqual(draft.custom_faults, []);
});

test("an edited fault set replaces the ticket's, and old typed faults only when given", () => {
  const raw = ticket();
  raw.custom_faults = ["معالج"];
  applyOp(raw, {
    kind: "faults",
    payload: {
      faults: [
        { code: "battery", name_ar: "البطارية", name_en: "Battery replacement" },
        { code: "c-0123456789ab", name_ar: "لا يشحن", name_en: "لا يشحن", isNew: true },
      ],
      custom: null,
    },
  });
  assert.deepEqual(
    raw.repair_ticket_issues?.map((link) => link.issue_code),
    ["battery", "c-0123456789ab"],
  );
  assert.deepEqual(raw.custom_faults, ["معالج"]);

  applyOp(raw, { kind: "faults", payload: { faults: [{ code: "battery", name_ar: "البطارية", name_en: "Battery replacement" }], custom: [] } });
  assert.deepEqual(raw.custom_faults, []);
  assert.equal(raw.repair_ticket_issues?.length, 1);
});

test("a spelling fix on a ticket's fault is not «معدّلة»; an added or removed fault is (2026-11-20)", () => {
  const fix = ticket();
  fix.quote_sent_at = null;
  applyOp(fix, {
    kind: "faults",
    payload: {
      faults: [
        { code: "screen", name_ar: "الشاشة", name_en: "Screen replacement" },
        // The typed fault, spelt better — a different code for the same fault.
        { code: "c-111111111111", name_ar: "يصفر عند الشاحن", name_en: "يصفر عند الشاحن", isNew: true },
      ],
      custom: null,
    },
  });
  assert.equal(fix.quote_sent_at, null);

  const added = ticket();
  added.quote_sent_at = null;
  applyOp(added, {
    kind: "faults",
    payload: {
      faults: [
        { code: "screen", name_ar: "الشاشة", name_en: "Screen replacement" },
        { code: "c-ad5ac9ea78d5", name_ar: "يصفر عند الشحن", name_en: "يصفر عند الشحن" },
        { code: "battery", name_ar: "البطارية", name_en: "Battery replacement" },
      ],
      custom: null,
    },
  });
  assert.ok(added.quote_sent_at);
});
