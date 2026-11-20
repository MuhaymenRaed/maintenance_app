import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { repairBase, repairTotal, type RepairService } from "../../site/lib/data/repair-desk.ts";
import { cleanFaultName, faultsChangedMeaning } from "../../site/lib/data/repair-faults.ts";
import { store, type OpRecord } from "../db/store";
import { faultsOfRaw, isContentEdit, markerFor, num, typedFaultCode, type OpPayload, type RawTicket } from "../desk/raw";
import { refs } from "../desk/refs";
import { getSettings } from "../settings";
import { paths, PHOTO_SCHEME } from "../config";
import { accessToken, asFailure, check, failureOf, SyncFailure } from "./client";
import { pullTicket } from "./pull";
import { logger } from "../log";

const log = logger("push");

/**
 * Sending the outbox, oldest first — each change replayed exactly as the
 * dashboard's own server action would have made it.
 *
 * ---------------------------------------------------------------------------
 * Order, and what "done" means
 * ---------------------------------------------------------------------------
 * Changes go in the order they were made. A change to a ticket opened here
 * waits for that ticket's creation; a change to any other ticket does not wait
 * for it. A change is only removed after the server accepted it **and** the
 * ticket has been read back, so the screen goes straight from "my change,
 * waiting" to "the server's copy, with my change in it" with nothing between.
 *
 * ---------------------------------------------------------------------------
 * When the server says no
 * ---------------------------------------------------------------------------
 * A dropped line or a busy server is retried, with a growing wait. A refusal —
 * RLS, the desk guard trigger, a function raising a reason — is not: it would
 * be refused again. The change is marked failed, stops being shown on the
 * ticket, and waits in the sync panel for somebody to retry or discard it.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ A ticket can never be booked twice
 * ---------------------------------------------------------------------------
 * A ticket opened here carries `[desk-app:<its local id>]` in `admin_note`.
 * Before booking, the push asks whether a ticket with that mark already
 * exists — which it does if a previous attempt reached the server and the
 * answer was lost, or if an older backup holding a "waiting" creation was
 * restored — and adopts it instead of booking another.
 */

const BACKOFF = [5, 15, 30, 60, 120, 300].map((s) => s * 1000);

const whole = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? null : Math.max(0, Math.round(value));

export type PushOutcome = { sent: number; failed: { op: OpRecord; reason: string }[]; blockedByNetwork: boolean };

export async function pushAll(client: SupabaseClient, userId: string): Promise<PushOutcome> {
  const outcome: PushOutcome = { sent: 0, failed: [], blockedByNetwork: false };
  const now = Date.now();
  for (const op of [...store.ops]) {
    if (op.state !== "pending" || op.nextAt > now) continue;
    if (!store.ops.includes(op)) continue;
    const record = store.tickets.get(op.ticketId);
    if (op.kind !== "create") {
      // Waits for the ticket's own creation, which is earlier in the queue.
      if (!record?.serverId) continue;
    }
    store.inFlight.add(op.id);
    try {
      await send(client, userId, op);
      outcome.sent += 1;
      log.info(`sent #${op.id} ${op.kind} on ${record?.raw.code ?? op.ticketId}`);
    } catch (error) {
      const failure = asFailure(error, op.kind);
      if (failure.kind === "refused") {
        store.opFailed(op, failure.message);
        outcome.failed.push({ op, reason: failure.message });
        log.warn(`refused #${op.id} ${op.kind} on ${record?.raw.code ?? op.ticketId}: ${failure.message}`);
      } else {
        const wait = BACKOFF[Math.min(op.attempts, BACKOFF.length - 1)];
        store.opRetryLater(op, failure.message, Date.now() + wait);
        log.warn(`will retry #${op.id} ${op.kind} in ${wait / 1000}s: ${failure.message}`);
        if (failure.kind === "network" || failure.kind === "auth") {
          outcome.blockedByNetwork = true;
          if (failure.kind === "auth") throw failure;
          break;
        }
      }
    } finally {
      store.inFlight.delete(op.id);
    }
  }
  return outcome;
}

/** Sends one change and, once accepted, reads the ticket back and retires the change. */
async function send(client: SupabaseClient, userId: string, op: OpRecord) {
  const role = refs.viewer()?.role ?? "";
  switch (op.kind) {
    case "create":
      return sendCreate(client, userId, role, op);
    case "update":
      return finish(client, op, await sendUpdate(client, userId, role, op));
    case "finance":
      return finish(client, op, await sendFinance(client, userId, role, op));
    case "assign":
      return finish(client, op, await sendAssign(client, userId, role, op));
    case "photos":
      return finish(client, op, await sendPhotos(client, op));
    case "delete":
      return finish(client, op, await sendDelete(client, userId, role, op));
    case "faults":
      return finish(client, op, await sendFaults(client, userId, role, op));
  }
}

async function finish(client: SupabaseClient, op: OpRecord, serverId: string) {
  try {
    await pullTicket(client, serverId);
  } catch (error) {
    // The change is on the server; only reading it back failed. It must not be
    // sent again (adding photos twice is not harmless), so it is retired anyway
    // and the next pull brings the ticket down.
    log.warn(`read-back of ${serverId} failed`, error);
  }
  store.transaction(() => store.opDone(op));
}

function serverIdOf(op: OpRecord): string {
  const id = store.tickets.get(op.ticketId)?.serverId;
  if (!id) throw new SyncFailure("refused", "record_not_found");
  return id;
}

/** `recordActivity` — the staff trail. Never fails the change it describes. */
async function activity(
  client: SupabaseClient,
  userId: string,
  role: string,
  entry: { action: string; entityId: string; amount?: number | null; detail?: Record<string, string | number | boolean> },
) {
  try {
    await client.from("staff_activity").insert({
      actor_id: userId,
      actor_role: role,
      action: entry.action,
      entity: "repair",
      entity_id: entry.entityId,
      amount: entry.amount ?? null,
      detail: { ...(entry.detail ?? {}), via: "desktop" },
    });
  } catch {
    // Swallowed on purpose, as on the dashboard.
  }
}

/** `holderColumns` from the dashboard's desk actions. */
function holderColumns(holderId: string | null, technicianId: string | null) {
  const at = holderId ? new Date().toISOString() : null;
  return { assigned_to: holderId, assigned_at: at, accepted_by: holderId, accepted_at: at, claim_deadline: null, technician_id: technicianId };
}

/* ── A ticket opened here — `createDeskTicket` ────────────────────────── */

async function sendCreate(client: SupabaseClient, userId: string, role: string, op: OpRecord) {
  const payload = op.payload as OpPayload["create"];
  const input = payload.input;
  const marker = markerFor(op.ticketId);

  let serverId: string | null = null;
  let code: string | null = null;
  /** True when the server already held this ticket complete — nothing more to write. */
  let complete = false;
  /** Typed faults the server's list would not take, kept on the ticket as text. */
  let unfiled: string[] = [];

  /*
   * Three ways in, and the order matters:
   * 1. This computer already linked the ticket to a server row on an earlier
   *    attempt that then lost the line — carry on with the same row.
   * 2. The server holds a ticket with this ticket's mark (a lost answer, or a
   *    restored backup) — adopt it and write nothing over it.
   * 3. Neither — book it.
   */
  const linked = store.tickets.get(op.ticketId)?.serverId ?? null;
  const adopted = linked
    ? { data: null, error: null }
    : await client.from("repair_tickets").select("id, code").eq("admin_note", marker).limit(1).maybeSingle();
  if (adopted.error) throw failureOf(adopted, "create (check)");
  if (linked) {
    serverId = linked;
    code = store.tickets.get(op.ticketId)?.raw.code ?? payload.localCode;
    log.info(`continuing ${op.ticketId} on server row ${linked}`);
  } else if (adopted.data) {
    serverId = adopted.data.id as string;
    code = adopted.data.code as string;
    complete = true;
    log.info(`adopting ${code} for local ${op.ticketId} — it reached the server before`);
  } else {
    // Faults typed at the counter join the bench's list first: the booking
    // files the ticket under codes, and these have none on the server yet.
    // One the list will not take is kept on the ticket as text, the old way.
    const typed = await fileTypedFaults(client, input.service, input.newFaults ?? []);
    unfiled = typed.failed;
    const codes = [...new Set([...input.issueCodes, ...typed.filed])];
    if (!codes.length) throw new SyncFailure("refused", "fault_not_filed");
    const booked = await client.rpc("book_repair", {
      p_brand_code: input.deviceBrandCode,
      p_device_model: input.deviceModel.trim(),
      p_issue_codes: codes,
      p_fulfillment: "drop_off",
      p_branch_id: input.branchId,
      p_address_line: null,
      p_customer_name: input.customerName.trim(),
      p_customer_phone: input.customerPhone.replace(/[\s()-]/g, ""),
      p_customer_phone2: null,
      p_preferred_at: null,
      p_notes: input.notes.trim() || null,
      p_photos: [],
    });
    if (booked.error) {
      const failure = failureOf(booked, "book_repair");
      if (failure.kind === "refused") throw new SyncFailure("refused", /^[a-z_]+$/.test(booked.error.message ?? "") ? booked.error.message! : "booking_failed");
      throw failure;
    }
    const answer = booked.data as { code?: string; ticket_id?: string } | null;
    if (!answer?.code || !answer.ticket_id) throw new SyncFailure("refused", "booking_failed");
    serverId = answer.ticket_id;
    code = answer.code;
  }

  // Remember which server row this is before anything else can fail, so a
  // retry adopts rather than books.
  store.transaction(() => store.linkServer(op.ticketId, serverId!));

  const base = whole(input.price);
  const warranty = whole(input.warranty);
  const total = repairTotal(base, warranty);
  const patch: Record<string, unknown> = { user_id: null, service: input.service, status: "approved", admin_note: marker };
  if (total != null) patch.actual_cost = total;
  if (warranty) patch.warranty_price = warranty;
  const warrantyDays = whole(input.warrantyDays);
  if (warrantyDays) patch.warranty_days = warrantyDays;
  const customFaults = [...new Set([...(input.customFaults ?? []), ...unfiled].map((fault) => fault.trim().slice(0, 120)).filter(Boolean))].slice(0, 10);
  if (customFaults.length) patch.custom_faults = customFaults;

  if (!complete) {
    const update = await client.from("repair_tickets").update(patch).eq("id", serverId).select("id");
    if (update.error) {
      const failure = failureOf(update, "create (details)");
      if (failure.kind !== "refused") throw failure;
      log.warn(`details of ${code} were refused: ${failure.message}`);
    }

    const finance = await client
      .from("repair_ticket_finance")
      .upsert(
        {
          ticket_id: serverId,
          cost_price: whole(input.costPrice),
          collected: whole(input.collected),
          payment_terms: input.paymentTerms === "deferred" ? "deferred" : "cash",
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "ticket_id" },
      )
      .select("ticket_id");
    if (finance.error) {
      const failure = failureOf(finance, "create (money)");
      if (failure.kind !== "refused") throw failure;
      log.warn(`money of ${code} was refused: ${failure.message}`);
    }

    // The holder goes on last, as the dashboard does it: once a ticket is
    // passed up it is out of an assistant's reach.
    const holder = await client.from("repair_tickets").update(holderColumns(input.holderId || null, payload.technicianId)).eq("id", serverId);
    if (holder.error) {
      const failure = failureOf(holder, "create (holder)");
      if (failure.kind !== "refused") throw failure;
    }

    await activity(client, userId, role, {
      action: "repairs.counter",
      entityId: serverId,
      amount: total,
      detail: { code: code!, service: input.service },
    });
  }

  await finish(client, op, serverId);
}

/* ── `updateRepair` ───────────────────────────────────────────────────── */

async function sendUpdate(client: SupabaseClient, userId: string, role: string, op: OpRecord): Promise<string> {
  const id = serverIdOf(op);
  const patch = op.payload as OpPayload["update"];
  const money: { actual_cost?: number | null; warranty_price?: number | null } = {};
  if (patch.price !== undefined || patch.warranty !== undefined) {
    // Read the server's own total and warranty now, as `authorizeRepair`
    // does, so the half that did not change is the server's, not this
    // computer's memory of it.
    const current = await client.from("repair_tickets").select("actual_cost, warranty_price").eq("id", id).maybeSingle();
    if (current.error) throw failureOf(current, "update (read)");
    if (!current.data) throw new SyncFailure("refused", "record_not_found");
    const heldWarranty = num(current.data.warranty_price as number | null);
    const warranty = patch.warranty !== undefined ? whole(patch.warranty) : heldWarranty;
    const base = patch.price !== undefined ? whole(patch.price) : repairBase(num(current.data.actual_cost as number | null), heldWarranty);
    money.actual_cost = repairTotal(base, warranty);
    if (patch.warranty !== undefined) money.warranty_price = warranty || null;
  }
  const result = await client
    .from("repair_tickets")
    .update({
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.quoteNotes !== undefined && { quote_notes: patch.quoteNotes }),
      ...(patch.warrantyDays !== undefined && { warranty_days: whole(patch.warrantyDays) || null }),
      ...(patch.warrantyStart !== undefined && { warranty_start: patch.warrantyStart || null }),
      ...money,
    })
    .eq("id", id)
    .select("id");
  check(result, "update");
  if (!result.data?.length) throw new SyncFailure("refused", "forbidden");
  if (isContentEdit(patch)) await markEdited(client, id);
  await activity(client, userId, role, {
    action: patch.status ? "repairs.status" : "repairs.quote",
    entityId: id,
    amount: money.actual_cost ?? null,
    detail: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.warranty != null ? { warranty: patch.warranty } : {}),
    },
  });
  return id;
}

/**
 * The site's `markRepairEdited`: puts the ticket on «المعدّلة». Its own write,
 * after the change has been accepted, and it never fails that change.
 */
async function markEdited(client: SupabaseClient, id: string) {
  try {
    await client.from("repair_tickets").update({ quote_sent_at: new Date().toISOString() }).eq("id", id);
  } catch {
    // Swallowed on purpose.
  }
}

/* ── `updateRepairFinance` ────────────────────────────────────────────── */

async function sendFinance(client: SupabaseClient, userId: string, role: string, op: OpRecord): Promise<string> {
  const id = serverIdOf(op);
  const patch = op.payload as OpPayload["finance"];
  const row: Record<string, unknown> = { ticket_id: id, updated_by: userId, updated_at: new Date().toISOString() };
  if (patch.costPrice !== undefined) row.cost_price = whole(patch.costPrice);
  if (patch.collected !== undefined) row.collected = whole(patch.collected);
  if (patch.paymentTerms !== undefined) row.payment_terms = patch.paymentTerms === "deferred" ? "deferred" : "cash";
  const result = await client.from("repair_ticket_finance").upsert(row, { onConflict: "ticket_id" }).select("ticket_id");
  check(result, "finance");
  if (!result.data?.length) throw new SyncFailure("refused", "forbidden");
  if (!patch.settle) await markEdited(client, id);
  await activity(client, userId, role, {
    action: "repairs.finance",
    entityId: id,
    detail: Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value ?? ""])) as Record<string, string | number>,
  });
  return id;
}

/* ── `assignRepair` ───────────────────────────────────────────────────── */

async function sendAssign(client: SupabaseClient, userId: string, role: string, op: OpRecord): Promise<string> {
  const id = serverIdOf(op);
  const payload = op.payload as OpPayload["assign"];
  const result = await client.from("repair_tickets").update(holderColumns(payload.holderId, payload.technicianId)).eq("id", id).select("id");
  check(result, "assign");
  if (!result.data?.length) throw new SyncFailure("refused", "forbidden");
  await activity(client, userId, role, { action: "repairs.assign", entityId: id, detail: { assigned: Boolean(payload.holderId) } });
  return id;
}

/* ── `updateRepairFaults` ─────────────────────────────────────────────── */

async function sendFaults(client: SupabaseClient, userId: string, role: string, op: OpRecord): Promise<string> {
  const id = serverIdOf(op);
  const payload = op.payload as OpPayload["faults"];
  const held = store.tickets.get(op.ticketId)?.raw;
  // What the server held before — a spelling fix is not an edit.
  const before = faultsOfRaw(held);
  const service: RepairService = held?.service === "software" ? "software" : "hardware";
  const codes: string[] = [];
  for (const fault of payload.faults) {
    if (!fault.isNew) {
      codes.push(fault.code);
      continue;
    }
    const typed = await fileTypedFaults(client, service, [fault.name_ar]);
    if (!typed.filed.length) throw new SyncFailure("refused", "fault_not_filed");
    codes.push(typed.filed[0]);
  }
  const result = await client.rpc("set_repair_faults", {
    p_ticket: id,
    p_codes: [...new Set(codes)],
    p_custom: payload.custom,
  });
  if (result.error) {
    if (result.error.code === "PGRST202" || result.error.code === "42883") throw new SyncFailure("refused", "faultsUnavailable");
    const failure = failureOf(result, "faults");
    if (failure.kind === "refused") {
      throw new SyncFailure("refused", /^[a-z_]+$/.test(result.error.message ?? "") ? result.error.message! : "save_failed");
    }
    throw failure;
  }
  const after = [
    ...payload.faults.map((fault) => ({ code: fault.code as string | null, name: fault.name_ar })),
    ...(payload.custom ?? held?.custom_faults ?? []).map((text) => ({ code: null, name: text })),
  ];
  if (!held || faultsChangedMeaning(before, after)) await markEdited(client, id);
  await activity(client, userId, role, { action: "repairs.faults", entityId: id, detail: { faults: codes.length } });
  return id;
}

/**
 * Files faults typed here on the bench's list and answers the code of each —
 * the site's `fileNewFaults`, the same two ways: `add_repair_issue`
 * (20261116_repair_faults_editable.sql), and before it runs, the table's own
 * write policy. A refusal is a name in `failed`; a dropped line is thrown, so
 * the change is retried rather than half-sent.
 */
async function fileTypedFaults(
  client: SupabaseClient,
  service: RepairService,
  names: readonly string[],
): Promise<{ filed: string[]; failed: string[] }> {
  const filed: string[] = [];
  const failed: string[] = [];
  let rpcMissing = false;
  for (const raw of names) {
    const name = cleanFaultName(raw);
    if (name.length < 2) continue;
    if (!rpcMissing) {
      const result = await client.rpc("add_repair_issue", { p_name: name, p_service: service });
      const code = (result.data as { code?: string } | null)?.code;
      if (!result.error && code) {
        filed.push(code);
        continue;
      }
      if (result.error && result.error.code !== "PGRST202" && result.error.code !== "42883") {
        const failure = failureOf(result, "fault");
        if (failure.kind !== "refused") throw failure;
        failed.push(name);
        continue;
      }
      rpcMissing = true;
    }
    const code = await fileThroughPolicy(client, service, name);
    if (code) filed.push(code);
    else failed.push(name);
  }
  return { filed, failed };
}

/** The table's own write policy (`can_write_repairs()`). Null when it refuses. */
async function fileThroughPolicy(client: SupabaseClient, service: RepairService, name: string): Promise<string | null> {
  const key = name.toLowerCase();
  const bench = await client.from("repair_issues").select("code, name_ar, name_en, is_deleted, sort_order").eq("service", service);
  if (bench.error) {
    const failure = failureOf(bench, "fault (read)");
    if (failure.kind !== "refused") throw failure;
    return null;
  }
  const rows = (bench.data ?? []) as { code: string; name_ar: string; name_en: string; is_deleted: boolean; sort_order: number }[];
  const match = rows
    .filter((row) => row.name_ar.toLowerCase() === key || row.name_en.toLowerCase() === key)
    .sort((a, b) => Number(a.is_deleted) - Number(b.is_deleted) || a.sort_order - b.sort_order)[0];
  if (match) {
    if (!match.is_deleted) return match.code;
    const revived = await client.from("repair_issues").update({ is_deleted: false }).eq("code", match.code).select("code");
    return revived.data?.length ? match.code : null;
  }
  const code = typedFaultCode(service, name);
  const top = await client.from("repair_issues").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const sortOrder = (((top.data ?? [])[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 10;
  const inserted = await client
    .from("repair_issues")
    .insert({ code, name_ar: name, name_en: name, service, sort_order: sortOrder })
    .select("code");
  if (!inserted.error && inserted.data?.length) return code;
  // Another counter filed the same words a moment ago: the code is theirs too.
  if (inserted.error?.code === "23505") return code;
  return null;
}

/* ── `deleteRecord` ───────────────────────────────────────────────────── */

async function sendDelete(client: SupabaseClient, userId: string, role: string, op: OpRecord): Promise<string> {
  const id = serverIdOf(op);
  const payload = op.payload as OpPayload["delete"];
  const result = await client.rpc("delete_record", { p_kind: "repair", p_id: id, p_reason: payload.reason?.trim() || null });
  if (result.error) {
    const failure = failureOf(result, "delete");
    if (result.error.code === "PGRST202" || result.error.code === "42883") throw new SyncFailure("refused", "delete_unavailable");
    throw failure;
  }
  const detail: Record<string, string> = {};
  if (payload.label?.trim()) detail.label = payload.label.trim();
  if (payload.reason?.trim()) detail.reason = payload.reason.trim();
  try {
    await client.from("staff_activity").insert({
      actor_id: userId,
      actor_role: role,
      action: "records.delete",
      entity: "repair",
      entity_id: id,
      detail: { ...detail, via: "desktop" },
    });
  } catch {
    // As `recordActivity`.
  }
  return id;
}

/* ── `addRepairPhotos` — with the upload in front of it ───────────────── */

export function localPhotoPath(url: string): string | null {
  const prefix = `${PHOTO_SCHEME}://local/`;
  if (!url.startsWith(prefix)) return null;
  const name = path.basename(decodeURIComponent(url.slice(prefix.length)));
  return path.join(paths.photos, name);
}

async function sendPhotos(client: SupabaseClient, op: OpRecord): Promise<string> {
  const id = serverIdOf(op);
  const payload = op.payload as OpPayload["photos"];
  payload.uploaded ??= {};

  for (const url of payload.urls) {
    if (payload.uploaded[url]) continue;
    const file = localPhotoPath(url);
    if (!file) {
      payload.uploaded[url] = url;
      continue;
    }
    if (!fs.existsSync(file)) {
      // The picture is gone from this computer; nothing can be sent for it.
      payload.uploaded[url] = "";
      continue;
    }
    payload.uploaded[url] = await uploadPhoto(file);
    // Remembered after each one, so a retry never uploads the same file twice.
    store.updateOpPayload(op);
  }

  const remote = payload.urls.map((url) => payload.uploaded![url]).filter(Boolean);
  if (!remote.length) return id;

  const current = await client.from("repair_tickets").select("photos_after").eq("id", id).maybeSingle();
  if (current.error) throw failureOf(current, "photos (read)");
  const before = ((current.data?.photos_after as string[] | null) ?? []).filter((url) => !remote.includes(url));
  const result = await client.from("repair_tickets").update({ photos_after: [...before, ...remote] }).eq("id", id).select("id");
  check(result, "photos");
  if (!result.data?.length) throw new SyncFailure("refused", "forbidden");
  return id;
}

/**
 * One photo to the shop's storage, through the dashboard's upload route.
 *
 * ⚠️ The storage keys never reach this computer: the route on the site holds
 * them and checks the desk account's token. A 404 means the site has not
 * shipped the route yet — retried later rather than refused, so the photos go
 * up on their own the day it is deployed.
 */
async function uploadPhoto(file: string): Promise<string> {
  const token = await accessToken();
  if (!token) throw new SyncFailure("auth", "no session for upload");
  const bytes = fs.readFileSync(file);
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: "image/webp" }), path.basename(file));
  let response: Response;
  try {
    response = await fetch(`${getSettings().siteUrl}/api/desk/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw asFailure(error, "upload");
  }
  if (response.status === 404) throw new SyncFailure("server", "upload_route_missing");
  if (response.status === 401) throw new SyncFailure("auth", "upload: not signed in");
  if (response.status >= 500 || response.status === 429) throw new SyncFailure("server", `upload: ${response.status}`);
  const body = (await response.json().catch(() => null)) as { ok?: boolean; urls?: string[]; error?: string } | null;
  if (!response.ok || !body?.ok || !body.urls?.[0]) throw new SyncFailure("refused", body?.error ?? `upload_${response.status}`);
  return body.urls[0];
}

/** The `RawTicket` type is re-exported for the engine's notifications. */
export type { RawTicket };
