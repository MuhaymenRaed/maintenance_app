import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canWith } from "../../site/lib/permissions.ts";
import { SERVICE_CAPABILITY, type RepairService } from "../../site/lib/data/repair-desk.ts";
import { toRepairPrintFacts } from "../../site/lib/data/repair-print-facts.ts";
import type { StatusEvent } from "../../site/lib/data/orders.ts";
import type { WorldModel } from "../../site/lib/data/device-name.ts";
import { cleanFaultName, MAX_TICKET_FAULTS } from "../../site/lib/data/repair-faults.ts";
import type {
  CreateTicketResult,
  DeskResult,
  DeskTicketInput,
  FaultsInput,
  FaultsResult,
  FinancePatch,
  PrintFactsResult,
  RecordKind,
  RecordResult,
  RepairPatch,
  SectionResult,
} from "../../shared/contract";
import { store } from "../db/store";
import { paths, PHOTO_SCHEME } from "../config";
import { sync } from "../sync/engine";
import { supabase } from "../sync/client";
import { pullTicket } from "../sync/pull";
import { authorizeTicket, deskScope } from "./board";
import { draftTicket, financeOf, num, typedFaultCode, type OpPayload } from "./raw";
import { refs, type Issue } from "./refs";
import { logger } from "../log";

const log = logger("desk");

/**
 * The dashboard's server actions, answered by this computer.
 *
 * Each one asks the same questions its server twin asks — who holds the
 * ticket, what this account may do to it, whether the fields are sane — from
 * the local copy of the bench, and refuses with the same error keys, so the
 * copied components show the same sentences. Then, instead of writing to the
 * database, it writes the change to the outbox and returns at once: the
 * window shows the change before the server has heard of it, and the sync
 * engine sends it a quarter of a second later, or whenever the line is back.
 *
 * The server still decides. A change accepted here can be refused there (the
 * desk guard, RLS) — it then shows in the sync panel, and the ticket falls back
 * to what the server holds.
 */

function queued(change: () => void) {
  store.transaction(change);
  store.bump();
  sync.refreshCounts();
  sync.kick();
}

export function updateRepair(id: string, patch: RepairPatch): SectionResult {
  const verdict = authorizeTicket(id);
  if (!verdict.ok) return verdict;
  if (verdict.control === "none") return { ok: false, error: "not_your_ticket" };
  const touchesWarranty = patch.warranty !== undefined || patch.warrantyDays !== undefined || patch.warrantyStart !== undefined;
  if (touchesWarranty && verdict.control !== "full") return { ok: false, error: "not_your_ticket" };
  if (touchesWarranty && !refs.available().warranty) return { ok: false, error: "warrantyUnavailable" };
  if (patch.warrantyStart && !/^\d{4}-\d{2}-\d{2}$/.test(patch.warrantyStart)) return { ok: false, error: "save_failed" };
  // The fee may be changed, never emptied — the site's `updateRepair` refuses the same.
  if (patch.price !== undefined && !(typeof patch.price === "number" && patch.price > 0)) {
    return { ok: false, error: "price_required" };
  }
  const clean: RepairPatch = {};
  for (const key of ["status", "price", "warranty", "warrantyDays", "warrantyStart", "quoteNotes"] as const) {
    if (patch[key] !== undefined) (clean as Record<string, unknown>)[key] = patch[key];
  }
  if (!Object.keys(clean).length) return { ok: true, id };
  queued(() => store.addOp(id, "update", clean));
  return { ok: true, id };
}

export function addRepairPhotos(id: string, urls: string[]): SectionResult {
  const verdict = authorizeTicket(id);
  if (!verdict.ok) return verdict;
  if (verdict.control === "none") return { ok: false, error: "not_your_ticket" };
  const list = urls.filter((url) => typeof url === "string" && url.length > 0);
  if (!list.length) return { ok: false, error: "save_failed" };
  queued(() => store.addOp(id, "photos", { urls: list }));
  return { ok: true, id };
}

export function assignRepair(id: string, holderId: string | null): DeskResult {
  const verdict = authorizeTicket(id);
  if (!verdict.ok) return verdict;
  if (verdict.control !== "full") return { ok: false, error: "not_your_ticket" };
  if (holderId && !verdict.authority.assignable.includes(holderId)) return { ok: false, error: "not_your_team" };
  const person = holderId ? verdict.scope.people.find((candidate) => candidate.userId === holderId) : null;
  const holderName = person?.name ?? (holderId ? refs.directory()[holderId]?.name ?? null : null);
  queued(() => store.addOp(id, "assign", { holderId, technicianId: person?.technicianId ?? null, holderName }));
  return { ok: true, id };
}

export function updateRepairFinance(id: string, patch: FinancePatch): DeskResult {
  const verdict = authorizeTicket(id);
  if (!verdict.ok) return verdict;
  if (verdict.control !== "full") return { ok: false, error: "not_your_ticket" };
  if (!refs.available().finance) return { ok: false, error: "financeUnavailable" };
  const clean: FinancePatch = {};
  if (patch.costPrice !== undefined) clean.costPrice = patch.costPrice;
  if (patch.collected !== undefined) clean.collected = patch.collected;
  if (patch.paymentTerms !== undefined) clean.paymentTerms = patch.paymentTerms === "deferred" ? "deferred" : "cash";
  queued(() => store.addOp(id, "finance", clean));
  return { ok: true, id };
}

export function deleteRecord(input: { kind: RecordKind; id: string; label?: string; reason?: string }): RecordResult {
  const viewer = refs.viewer();
  if (!viewer) return { ok: false, error: "not_signed_in" };
  if (!canWith(viewer.role, viewer.grant, "records.delete")) return { ok: false, error: "forbidden" };
  if (input.kind !== "repair") return { ok: false, error: "unknown_record_kind" };
  const record = store.tickets.get(input.id);
  if (!record) return { ok: false, error: "record_not_found" };
  if (!record.serverId) {
    // Never sent: deleting it is discarding its creation.
    const create = store.ops.find((op) => op.ticketId === input.id && op.kind === "create");
    if (create) store.opDiscard(create.id);
    else store.transaction(() => store.removeTicket(input.id));
    store.bump();
    sync.refreshCounts();
    return { ok: true };
  }
  queued(() => store.addOp(input.id, "delete", { label: input.label, reason: input.reason }));
  return { ok: true };
}

/* ── A ticket opened at the counter ───────────────────────────────────── */

/** `OFF-1109-03`: the day it was opened and its place that day — on the receipt until the real code arrives. */
function provisionalCode(): string {
  const now = new Date();
  const day = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const key = `localSeq:${now.toISOString().slice(0, 10)}`;
  const next = Number(store.meta(key) ?? "0") + 1;
  store.setMeta(key, String(next));
  return `OFF-${day}-${String(next).padStart(2, "0")}`;
}

/** How long a ticket waits for the server's own code before the dialog shows the provisional one. */
const CREATE_WAIT_MS = 8000;

export async function createDeskTicket(input: DeskTicketInput): Promise<CreateTicketResult> {
  const service: RepairService = input.service === "software" ? "software" : "hardware";
  const viewer = refs.viewer();
  if (!viewer) return { ok: false, error: "not_signed_in" };
  if (!canWith(viewer.role, viewer.grant, SERVICE_CAPABILITY[service])) return { ok: false, error: "forbidden" };
  const scope = deskScope(service);
  if (!scope?.authority.manages) return { ok: false, error: "forbidden" };
  if (!scope.authority.assignable.includes(input.holderId)) return { ok: false, error: "not_your_team" };

  if (input.customerName.trim().length < 2) return { ok: false, error: "customer_name_required" };
  if (!/^07\d{9}$/.test(input.customerPhone.replace(/[\s()-]/g, ""))) return { ok: false, error: "phone_invalid" };
  if (!input.branchId) return { ok: false, error: "branch_required" };
  if (input.deviceModel.trim().length < 2) return { ok: false, error: "device_required" };
  const listedCodes = [...new Set(input.issueCodes.filter((code) => code.trim()))];
  const typedNames = uniqueFaultNames(input.newFaults ?? []);
  if (!listedCodes.length && !typedNames.length) return { ok: false, error: "issue_required" };
  if (listedCodes.length + typedNames.length > MAX_TICKET_FAULTS) return { ok: false, error: "too_many_issues" };
  // The fee is required, as on the site's `createDeskTicket` (2026-11-16).
  if (!(typeof input.price === "number" && Number.isFinite(input.price) && input.price > 0)) {
    return { ok: false, error: "price_required" };
  }
  const customFaults = [...new Set((input.customFaults ?? []).map((fault) => fault.trim().slice(0, 120)).filter(Boolean))].slice(0, 10);
  // A typed fault the bench's list already has is that fault; the rest go up
  // with the ticket and are filed on the list before it is booked.
  const typed = typedFaults(service, typedNames);
  const issueCodes = [...new Set([...listedCodes, ...typed.filter((fault) => !fault.isNew).map((fault) => fault.code)])];
  const newFaults = typed.filter((fault) => fault.isNew).map((fault) => fault.name_ar);

  const id = randomUUID();
  const at = new Date().toISOString();
  const person = scope.people.find((candidate) => candidate.userId === input.holderId);
  const branch = refs.branches().find((candidate) => candidate.id === input.branchId) ?? null;
  const issues = new Map(refs.issues().map((issue) => [issue.code, { name_ar: issue.name_ar, name_en: issue.name_en }]));
  const clean: DeskTicketInput = { ...input, service, issueCodes, newFaults, customFaults };
  let localCode = "";

  queued(() => {
    localCode = provisionalCode();
    const payload = { input: clean, localCode, at, technicianId: person?.technicianId ?? null, viewerId: viewer.id };
    store.putDraft(
      id,
      draftTicket(id, payload, {
        branch: branch ? { name_ar: branch.name_ar, name_en: branch.name_en } : null,
        issues,
        holderName: person?.name ?? viewer.name,
      }),
      localCode,
    );
    store.addOp(id, "create", payload);
  });
  log.info(`opened ${localCode} (${id})`);

  // With the line up the server answers in well under a second; waiting for it
  // lets the dialog show the real code, as the dashboard's does. Offline, or
  // slow, the provisional code is shown and the ticket goes up later.
  const started = Date.now();
  while (Date.now() - started < CREATE_WAIT_MS) {
    const record = store.tickets.get(id);
    const create = store.ops.find((op) => op.ticketId === id && op.kind === "create");
    if (!create && record?.serverId) {
      return { ok: true, id, code: record.raw.code, at: record.raw.created_at, financeSaved: true, warrantySaved: true, customSaved: true };
    }
    if (create?.state === "failed") return { ok: false, error: create.error ?? "booking_failed" };
    if (sync.status.state === "offline" || (create && create.attempts > 0)) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return { ok: true, id, code: localCode, at, financeSaved: true, warrantySaved: true, customSaved: true, queued: true };
}

/* ── A ticket's faults, after it was opened ─────────────────────────── */

/**
 * The site's `updateRepairFaults`: the whole new set of a ticket's faults,
 * whoever runs the ticket. Refused by the same rules — `set_repair_faults`
 * asks them again on the server — and written to the outbox like every other
 * change, so it shows at once and goes up when the line allows.
 *
 * ⚠️ Answered from this computer. The faults come back named from the local
 * list, a typed one by its own words; the server's answer replaces them when
 * the change is read back.
 */
export function updateRepairFaults(id: string, input: FaultsInput): FaultsResult {
  const verdict = authorizeTicket(id);
  if (!verdict.ok) return verdict;
  if (verdict.control !== "full") return { ok: false, error: "not_your_ticket" };
  if (!refs.available().faultsEdit) return { ok: false, error: "faultsUnavailable" };

  const codes = [...new Set(input.codes.map((code) => code.trim()).filter(Boolean))];
  const names = uniqueFaultNames(input.newFaults ?? []);
  if (!codes.length && !names.length) return { ok: false, error: "no_issues" };
  if (codes.length + names.length > MAX_TICKET_FAULTS) return { ok: false, error: "too_many_issues" };
  const custom =
    input.custom == null
      ? null
      : [...new Set(input.custom.map((fault) => fault.trim().slice(0, 120)).filter(Boolean))].slice(0, 10);

  const listed = new Map(refs.issues().map((issue) => [issue.code, issue]));
  // A fault the ticket carries that the list no longer has keeps its name.
  const own = new Map((verdict.raw.repair_ticket_issues ?? []).map((link) => [link.issue_code, link.repair_issues]));
  const faults: OpPayload["faults"]["faults"] = codes.map((code) => {
    const named = listed.get(code) ?? own.get(code) ?? null;
    return { code, name_ar: named?.name_ar ?? code, name_en: named?.name_en ?? code };
  });
  for (const fault of typedFaults(verdict.service, names)) {
    if (!faults.some((held) => held.code === fault.code)) faults.push(fault);
  }

  queued(() => store.addOp(id, "faults", { faults, custom }));
  const ar = input.locale !== "en";
  return {
    ok: true,
    faults: faults.map((fault) => ({ code: fault.code, name: ar ? fault.name_ar : fault.name_en })),
    custom: custom ?? (verdict.raw.custom_faults ?? []).filter((fault) => fault.trim()),
  };
}

/** The typed names, cleaned, each once whatever its spacing or case. */
function uniqueFaultNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = cleanFaultName(String(raw ?? ""));
    const key = name.toLowerCase();
    if (name.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, MAX_TICKET_FAULTS);
}

/**
 * Typed names as faults: the one on this bench's list when it is spelt the
 * same way, a new one otherwise. A new one is offered at once in every picker
 * on this computer — under the code the server will file it under — and filed
 * on the server's list when the change is sent. The next refs pull replaces
 * this computer's list with the server's, which by then holds it.
 */
function typedFaults(service: RepairService, names: readonly string[]): OpPayload["faults"]["faults"] {
  const all = refs.issues();
  const bench = all.filter((issue) => issue.service === service);
  const out: OpPayload["faults"]["faults"] = [];
  const added: Issue[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    const match = bench.find((issue) => issue.name_ar.toLowerCase() === key || issue.name_en.toLowerCase() === key);
    if (match) {
      out.push({ code: match.code, name_ar: match.name_ar, name_en: match.name_en });
      continue;
    }
    const code = typedFaultCode(service, name);
    out.push({ code, name_ar: name, name_en: name, isNew: true });
    if (!all.some((issue) => issue.code === code) && !added.some((issue) => issue.code === code)) {
      added.push({ code, name_ar: name, name_en: name, service });
    }
  }
  if (added.length) store.setRef("issues", [...all, ...added]);
  return out;
}

/* ── Reads the dialogs make ───────────────────────────────────────────── */

export async function loadStatusHistory(kind: string, id: string): Promise<{ available: boolean; events: StatusEvent[] }> {
  if (kind !== "repair") return { available: false, events: [] };
  const record = store.tickets.get(id);
  const cacheKey = `history:${id}`;
  const cached = store.ref<StatusEvent[]>(cacheKey);
  if (!record?.serverId) return { available: true, events: cached ?? [] };
  if (sync.status.state === "offline") return { available: true, events: cached ?? [] };
  try {
    const result = await supabase()
      .from("status_events")
      .select("status, at, actor")
      .eq("kind", "repair")
      .eq("entity_id", record.serverId)
      .order("at", { ascending: true });
    if (result.error) return { available: Boolean(cached), events: cached ?? [] };
    // Who moved it, by name — the site's `loadStatusHistory` does the same
    // through `staff_directory()`; here the roster is already on this
    // computer (`refs.directory()`). A move made from this app reads as the
    // shop's maintenance account, which is the account that sent it.
    const directory = refs.directory();
    const events = ((result.data ?? []) as { status: string; at: string; actor: string | null }[]).map(
      ({ actor, ...event }): StatusEvent => {
        if (!actor) return { ...event, by: { kind: "system", name: null } };
        const person = directory[actor];
        return person
          ? { ...event, by: { kind: "staff", name: person.name } }
          : { ...event, by: { kind: "customer", name: null } };
      },
    );
    store.setRef(cacheKey, events);
    return { available: true, events };
  } catch {
    return { available: true, events: cached ?? [] };
  }
}

export async function loadWorldModels(brandCode: string): Promise<WorldModel[]> {
  if (!/^[a-z0-9-]{2,32}$/.test(brandCode)) return [];
  const cacheKey = `world:${brandCode}`;
  const cached = store.ref<WorldModel[]>(cacheKey);
  if (sync.status.state === "offline" && cached) return cached;
  try {
    const result = await supabase()
      .from("compare_catalogue")
      .select("name_en, name_ar, released_year, category_code")
      .eq("brand_code", brandCode)
      .order("released_year", { ascending: false, nullsFirst: false })
      .limit(600);
    if (result.error || !result.data) return cached ?? [];
    const seen = new Set<string>();
    const out: WorldModel[] = [];
    for (const row of result.data as { name_en: string; name_ar: string | null; released_year: number | null; category_code: string | null }[]) {
      const name = (row.name_en ?? "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, year: row.released_year, keywords: (row.name_ar ?? "").trim() || undefined, category: row.category_code ?? undefined });
    }
    store.setRef(cacheKey, out);
    return out;
  } catch {
    return cached ?? [];
  }
}

/**
 * The ticket as it stands, for paper. The dashboard reads it fresh from the
 * server at the press; here it is read fresh when the line is up, and the local
 * copy — which already carries this computer's own waiting changes — otherwise.
 */
export async function loadRepairPrintFacts(ticketId: string, locale: string): Promise<PrintFactsResult> {
  const record = store.tickets.get(ticketId);
  if (!record) return { ok: false, error: "not_found" };
  if (record.serverId && sync.status.state !== "offline") {
    try {
      await Promise.race([pullTicket(supabase(), record.serverId), new Promise((resolve) => setTimeout(resolve, 2500))]);
    } catch {
      // The local copy is what gets printed.
    }
  }
  const verdict = authorizeTicket(ticketId);
  if (!verdict.ok) return { ok: false, error: verdict.error === "not_signed_in" ? "not_signed_in" : "forbidden" };
  if (!verdict.authority.manages) return { ok: false, error: "forbidden" };
  const raw = verdict.raw;
  const ar = locale !== "en";
  const ledger = financeOf(raw);
  return {
    ok: true,
    facts: toRepairPrintFacts({
      code: raw.code,
      customerName: raw.customer_name,
      deviceModel: raw.device_model,
      issues: (raw.repair_ticket_issues ?? []).flatMap((link) =>
        link.repair_issues ? [ar ? link.repair_issues.name_ar : link.repair_issues.name_en] : [],
      ),
      customFaults: (raw.custom_faults ?? []).filter((fault) => fault.trim()),
      price: num(raw.actual_cost) ?? num(raw.quote_amount),
      warrantyPrice: num(raw.warranty_price),
      costPrice: num(ledger?.cost_price),
      collected: num(ledger?.collected),
      paymentTerms: ledger?.payment_terms === "deferred" ? "deferred" : "cash",
      createdAt: raw.created_at,
      warrantyDays: raw.warranty_days ?? null,
      warrantyStart: raw.warranty_start ?? null,
    }),
  };
}

/* ── Photos kept on this computer until they are uploaded ─────────────── */

const EXT: Record<string, string> = { "image/webp": ".webp", "image/jpeg": ".jpg", "image/png": ".png" };

export function savePhotos(files: { name: string; type: string; bytes: ArrayBuffer }[]): string[] {
  const out: string[] = [];
  for (const file of files.slice(0, 12)) {
    const ext = EXT[file.type];
    if (!ext || file.bytes.byteLength > 15 * 1024 * 1024) continue;
    const name = `${randomUUID().replace(/-/g, "")}${ext}`;
    fs.writeFileSync(path.join(paths.photos, name), Buffer.from(file.bytes));
    out.push(`${PHOTO_SCHEME}://local/${name}`);
  }
  return out;
}
