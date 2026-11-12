import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockModel } from "../../site/lib/data/device-catalogue.ts";
import type { AccessGrant } from "../../site/lib/permissions.ts";
import type { DeskDeputyRef, RepairService } from "../../site/lib/data/repair-desk.ts";
import { store } from "../db/store";
import { TICKET_SELECT, type RawFinance, type RawTicket } from "../desk/raw";
import { refs, type BenchPerson, type Brand, type Issue, type Viewer } from "../desk/refs";
import { check, failureOf } from "./client";
import { logger } from "../log";

const log = logger("pull");

/**
 * Bringing the server's state down.
 *
 * - **Reference data** — who works the bench, the branches, the fault list,
 *   the makes and models — every few minutes, so a technician added on the
 *   dashboard appears in the assignment picker here without a restart.
 * - **Tickets** — incrementally, by `updated_at`: every row changed since the
 *   last pull, deleted ones included so a ticket deleted on the dashboard
 *   leaves here too. The trigger `trg_repair_updated_at` bumps that column on
 *   every update, so nothing a person does to a ticket is missed.
 * - **The money ledger** — `repair_ticket_finance` is its own table and a
 *   change to it does not touch the ticket's `updated_at`, so it is followed
 *   by its own cursor.
 * - **A full pass** every quarter of an hour, which also notices tickets that
 *   disappeared without passing through `is_deleted`.
 *
 * ⚠️ The incremental cursor re-reads the last two minutes every time. A
 * transaction's `now()` is its *start*, so a row written by a slow transaction
 * can commit with an `updated_at` older than a row already pulled; the overlap
 * is what keeps such a row from falling between two pulls.
 */

const PAGE = 1000;
const OVERLAP_MS = 2 * 60_000;

type Paged<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null; status?: number }>;

/** Every row of a query, a page at a time — PostgREST stops at 1,000 without saying so. */
async function pageAll<T>(build: Paged<T>, what: string, cap = 50_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const result = await build(from, from + PAGE - 1);
    check(result, what);
    const rows = result.data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const minus = (iso: string, ms: number) => new Date(Date.parse(iso) - ms).toISOString();

/* ── Reference data ───────────────────────────────────────────────────── */

export async function pullRefs(client: SupabaseClient, userId: string, email: string | null): Promise<void> {
  const profile = await client.from("profiles").select("id, full_name, role").eq("id", userId).maybeSingle();
  check(profile, "profile");
  const grantRow = await client.from("staff_access").select("sections, capabilities, title").eq("user_id", userId).maybeSingle();
  const grant: AccessGrant = grantRow.error || !grantRow.data
    ? { sections: null, capabilities: null, title: null }
    : {
        sections: (grantRow.data.sections ?? null) as AccessGrant["sections"],
        capabilities: (grantRow.data.capabilities ?? null) as AccessGrant["capabilities"],
        title: (grantRow.data.title ?? null) as string | null,
      };
  const viewer: Viewer = {
    id: userId,
    name: (profile.data?.full_name as string | null) ?? email ?? "",
    email: email ?? "",
    role: (profile.data?.role as string | null) ?? "customer",
    grant,
  };
  store.setRef("viewer", viewer);

  // Each of the rest is independent: one that fails keeps its last copy and
  // the others still refresh.
  const tasks: [string, () => Promise<void>][] = [
    ["people:hardware", () => pullPeople(client, "hardware")],
    ["people:software", () => pullPeople(client, "software")],
    ["deputies", async () => {
      const result = await client.from("team_deputies").select("manager_id, deputy_id, can_manage");
      check(result, "deputies");
      store.setRef("deputies", (result.data ?? []).map((row) => ({
        managerId: row.manager_id as string,
        deputyId: row.deputy_id as string,
        canManage: Boolean(row.can_manage),
      })) satisfies DeskDeputyRef[]);
    }],
    ["directory", async () => {
      const result = await client.rpc("staff_directory");
      check(result, "staff directory");
      const map: Record<string, { name: string; role: string }> = {};
      for (const row of (result.data ?? []) as { id: string; name: string; role: string }[]) map[row.id] = { name: row.name, role: row.role };
      store.setRef("directory", map);
    }],
    ["branches", async () => {
      const result = await client.from("branches").select("id, name_ar, name_en").eq("is_deleted", false).eq("is_active", true).order("sort_order");
      check(result, "branches");
      store.setRef("branches", result.data ?? []);
    }],
    ["issues", async () => {
      const result = await client.from("repair_issues").select("code, name_ar, name_en, service").eq("is_deleted", false).order("sort_order");
      check(result, "issues");
      store.setRef("issues", (result.data ?? []).map((row) => ({ ...row, service: row.service === "software" ? "software" : "hardware" })) as Issue[]);
    }],
    ["catalogue", () => pullCatalogue(client)],
    ["steps", async () => {
      const probe = await client.from("repair_tickets").select("id").eq("status", "waiting_parts").limit(1);
      const current = refs.steps();
      store.setRef("steps", { ...current, waitingParts: probe.error?.code !== "22P02" });
    }],
  ];
  for (const [name, task] of tasks) {
    try {
      await task();
    } catch (error) {
      log.warn(`${name} not refreshed`, error);
      if (error instanceof Error && "kind" in error && (error as { kind: string }).kind !== "refused") throw error;
    }
  }
  store.setMeta("lastRefs", new Date().toISOString());
}

/** `bench_staff` — who works one bench, with their manager and bench record. */
async function pullPeople(client: SupabaseClient, service: RepairService) {
  const result = await client.rpc("bench_staff", { p_service: service });
  check(result, `bench ${service}`);
  const people: BenchPerson[] = ((result.data ?? []) as {
    user_id: string;
    name: string | null;
    role: string;
    manager_id: string | null;
    technician_id: string | null;
  }[])
    .map((row) => ({
      userId: row.user_id,
      name: row.name ?? "",
      role: row.role,
      managerId: row.manager_id,
      technicianId: row.technician_id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  store.setRef(`people:${service}`, people);
}

/**
 * The makes and the shop's own models — `getDeviceBrands` and
 * `getDeviceModels`, for the counter dialog's two pickers.
 */
async function pullCatalogue(client: SupabaseClient) {
  const devices = await pageAll<{ brand_code: string | null; category_code: string | null; name_ar: string; name_en: string; kind: string }>(
    (from, to) =>
      client
        .from("products")
        .select("brand_code, category_code, name_ar, name_en, kind")
        .eq("is_deleted", false)
        .eq("is_active", true)
        .not("brand_code", "is", null)
        .order("sort_order")
        .order("id")
        .range(from, to),
    "catalogue",
  );
  const makeCodes = [
    ...new Set(
      devices
        .filter((row) => row.category_code === "phones" || row.category_code === "tablets")
        .map((row) => row.brand_code!)
        .filter(Boolean),
    ),
  ];
  if (makeCodes.length) {
    const brands = await client.from("brands").select("code, name_ar, name_en").in("code", makeCodes).eq("is_deleted", false).order("sort_order");
    check(brands, "brands");
    store.setRef("brands", (brands.data ?? []) as Brand[]);
  }
  const byBrand: Record<string, StockModel[]> = {};
  const seen = new Set<string>();
  for (const row of devices) {
    if (row.kind !== "device" || !row.brand_code) continue;
    const key = `${row.brand_code}:${row.name_en}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (byBrand[row.brand_code] ??= []).push({ name: row.name_en, keywords: row.name_ar });
  }
  store.setRef("models", byBrand);
}

/* ── Tickets ──────────────────────────────────────────────────────────── */

export type PullOutcome = {
  /** Tickets the server holds that this computer had never seen — new bookings. */
  arrived: RawTicket[];
  /** Tickets somebody else moved to another status. */
  moved: { before: RawTicket; after: RawTicket }[];
  changed: boolean;
};

/** Files one row from the server, and answers whether it changed anything here. */
function record(raw: RawTicket, outcome: PullOutcome, announce: boolean): boolean {
  const result = store.putServerTicket(raw);
  if (!result.changed) return false;
  outcome.changed = true;
  if (!announce || raw.is_deleted) return true;
  const local = store.tickets.get(result.id);
  if (result.isNew && !local?.createdHere) outcome.arrived.push(raw);
  else if (
    result.before &&
    result.before.status !== raw.status &&
    !store.ops.some((op) => op.ticketId === result.id)
  ) {
    outcome.moved.push({ before: result.before, after: raw });
  }
  return true;
}

/** Every live ticket, and the ones gone since — the first sync, and every quarter hour. */
export async function pullAllTickets(client: SupabaseClient): Promise<PullOutcome> {
  const announce = store.meta("lastFullPull") !== null;
  const rows = await pageAll<RawTicket>(
    (from, to) =>
      client.from("repair_tickets").select(TICKET_SELECT).eq("is_deleted", false).order("created_at").order("id").range(from, to) as never,
    "tickets",
  );
  const outcome: PullOutcome = { arrived: [], moved: [], changed: false };
  let cursor = store.meta("ticketsCursor");
  let financeCursor = store.meta("financeCursor");
  store.transaction(() => {
    const seen = new Set<string>();
    for (const raw of rows) {
      seen.add(raw.id);
      record(raw, outcome, announce);
      if (raw.updated_at && (!cursor || raw.updated_at > cursor)) cursor = raw.updated_at;
      const ledger = Array.isArray(raw.repair_ticket_finance) ? raw.repair_ticket_finance[0] : raw.repair_ticket_finance;
      if (ledger?.updated_at && (!financeCursor || ledger.updated_at > financeCursor)) financeCursor = ledger.updated_at;
    }
    // Gone from the server without passing through `is_deleted` — or out of
    // this account's sight. Kept only while a change here is waiting on it.
    for (const [serverId, id] of store.serverIdsWithoutWork()) {
      if (!seen.has(serverId)) {
        store.removeTicket(id);
        outcome.changed = true;
      }
    }
    if (cursor) store.setMeta("ticketsCursor", cursor);
    if (financeCursor) store.setMeta("financeCursor", financeCursor);
    store.setMeta("lastFullPull", new Date().toISOString());
  });
  log.info(`full pull: ${rows.length} tickets, ${outcome.arrived.length} new`);
  return outcome;
}

/** Everything changed since the last pull — every few seconds while online. */
export async function pullChanges(client: SupabaseClient): Promise<PullOutcome> {
  const outcome: PullOutcome = { arrived: [], moved: [], changed: false };
  const cursor = store.meta("ticketsCursor");
  if (!cursor) return pullAllTickets(client);

  const rows = await pageAll<RawTicket>(
    (from, to) =>
      client
        .from("repair_tickets")
        .select(TICKET_SELECT)
        .gte("updated_at", minus(cursor, OVERLAP_MS))
        .order("updated_at")
        .order("id")
        .range(from, to) as never,
    "ticket changes",
  );

  const financeCursor = store.meta("financeCursor");
  const ledgers = await pageAll<RawFinance & { ticket_id: string; updated_at: string }>(
    (from, to) => {
      let query = client
        .from("repair_ticket_finance")
        .select("ticket_id, cost_price, collected, payment_terms, updated_at")
        .order("updated_at")
        .order("ticket_id")
        .range(from, to);
      if (financeCursor) query = query.gte("updated_at", minus(financeCursor, OVERLAP_MS));
      return query as never;
    },
    "ledger changes",
  );

  // Counted, not just read: the overlap re-reads the newest row on every pass,
  // so "rows returned" is never zero and logging it wrote "1 ticket changed"
  // four times a minute about a ticket nobody had touched.
  let changedTickets = 0;
  let changedLedgers = 0;
  store.transaction(() => {
    let next = cursor;
    for (const raw of rows) {
      if (record(raw, outcome, true)) changedTickets += 1;
      if (raw.updated_at && raw.updated_at > next) next = raw.updated_at;
    }
    store.setMeta("ticketsCursor", next);

    let nextFinance = financeCursor;
    for (const ledger of ledgers) {
      if (!nextFinance || ledger.updated_at > nextFinance) nextFinance = ledger.updated_at;
      const id = store.idForServer(ledger.ticket_id);
      const existing = id ? store.tickets.get(id) : undefined;
      if (!existing) continue;
      const { ticket_id: _ticket, ...money } = ledger;
      void _ticket;
      const current = Array.isArray(existing.raw.repair_ticket_finance) ? existing.raw.repair_ticket_finance[0] : existing.raw.repair_ticket_finance;
      if (JSON.stringify(current ?? null) === JSON.stringify(money)) continue;
      const updated = store.putServerTicket({ ...existing.raw, repair_ticket_finance: money });
      if (updated.changed) {
        outcome.changed = true;
        changedLedgers += 1;
      }
    }
    if (nextFinance) store.setMeta("financeCursor", nextFinance);
  });
  if (changedTickets || changedLedgers) log.info(`changes: ${changedTickets} tickets, ${changedLedgers} ledgers`);
  return outcome;
}

/** One ticket, read fresh — after a change to it was accepted, and before printing it. */
export async function pullTicket(client: SupabaseClient, serverId: string): Promise<RawTicket | null> {
  const result = await client.from("repair_tickets").select(TICKET_SELECT).eq("id", serverId).maybeSingle();
  if (result.error) throw failureOf(result, "ticket");
  const raw = result.data as unknown as RawTicket | null;
  if (raw) store.putServerTicket(raw);
  return raw;
}
