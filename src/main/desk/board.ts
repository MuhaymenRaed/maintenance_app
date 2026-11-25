import { canWith } from "../../site/lib/permissions.ts";
import {
  deskAuthority,
  deskRank,
  repairBase,
  SERVICE_CAPABILITY,
  ticketControl,
  type DeskAuthority,
  type RepairService,
} from "../../site/lib/data/repair-desk.ts";
import { liveFlow, REPAIR_FLOW, type RepairStatus } from "../../site/lib/data/orders.ts";
import { resolveQueueWindow, type QueueWindow } from "../../site/lib/data/queue-window.ts";
import { baghdadDay } from "../../site/lib/data/date-window.ts";
import { recentDevicesFrom } from "../../site/lib/data/recent-devices.ts";
import { recentFaultsFrom } from "../../site/lib/data/repair-faults.ts";
import { MAKE_CODES } from "../../site/lib/data/device-name.ts";
import {
  dropBookingDayReturns,
  paidInFullAt,
  paidWithinIds,
  returnedWithinIds,
  type PaymentBook,
  type PaymentEntry,
  type ReturnBook,
  type ReturnEntry,
} from "../../site/lib/data/desk-figures.ts";
import type { DeskData, DeskPageData, DeskPageParams, DeskRow, DeskScope } from "../../shared/desk-types";
import { store } from "../db/store";
import { financeOf, num, paymentTarget, paymentTargetV1, returnFor, returnForV1, type RawTicket } from "./raw";
import { refs } from "./refs";

/**
 * The desk page, computed — `RepairDeskPage`, `getDeskData` and `getDeskScope`
 * from the dashboard, run over the local database instead of the server's.
 *
 * ---------------------------------------------------------------------------
 * The rows and the ledgers; the window works out the rest
 * ---------------------------------------------------------------------------
 * Since the maintenance section was rebuilt (2026-11-24) the site reads one
 * thing per period — the period's raw rows and the two ledgers — and works
 * out every list, card and person's table from it in the browser
 * (`lib/data/desk-board.ts`, `computeFigures`). So does this: the main
 * process answers the same `DeskData`, and the site's own view, copied into
 * the window, does the arithmetic. One view and one set of rules, so a figure
 * here and the same figure on the dashboard cannot disagree.
 *
 * What is the app's own is where the rows come from — the server's last copy
 * with this computer's waiting changes on top (`store.view`) — and that the
 * ledgers are the whole of them rather than the period onwards (`complete`),
 * with what each waiting change will add to them already in.
 */

/** This reader's standing on one bench — `getDeskScope`. */
export function deskScope(service: RepairService): DeskScope | null {
  const viewer = refs.viewer();
  if (!viewer) return null;
  const people = refs.people(service);
  const deputies = refs.deputies();
  const authority = deskAuthority({
    viewerId: viewer.id,
    role: viewer.role,
    owner: viewer.role === "super_admin" || viewer.role === "admin" || canWith(viewer.role, viewer.grant, "staff.write"),
    canWrite: canWith(viewer.role, viewer.grant, SERVICE_CAPABILITY[service]),
    people,
    deputies,
  });
  return {
    authority,
    people: people.map((person) => ({
      ...person,
      rank: deskRank(person.userId, person.role, people, deputies),
    })),
  };
}

/** Counter or booking, as `learnOrigins` filed it; null when it cannot be told. */
function originOf(serverId: string | null): "counter" | "web" | null {
  if (!serverId) return null;
  const value = store.ref<Record<string, string>>("origins")?.[serverId];
  return value === "counter" || value === "web" ? value : null;
}

/** One ticket shaped for the desk, in one language — `shapeRow` in the site's query. */
export function shapeRow(
  id: string,
  raw: RawTicket,
  locale: "ar" | "en",
  scope: DeskScope,
  viewerId: string,
): DeskRow {
  const ar = locale === "ar";
  const ledger = financeOf(raw);
  const actualCost = num(raw.actual_cost);
  const quoteAmount = num(raw.quote_amount);
  const warrantyPrice = num(raw.warranty_price);
  const price = actualCost ?? quoteAmount;
  const person = raw.assigned_to ? scope.people.find((candidate) => candidate.userId === raw.assigned_to) : undefined;
  const directory = refs.directory();
  const listed = raw.assigned_to ? directory[raw.assigned_to] : undefined;
  const holderName = person?.name ?? listed?.name ?? raw.technicians?.name ?? null;
  const handedBy = raw.handed_over_by ?? null;
  const record = store.tickets.get(id);
  const row: DeskRow = {
    id,
    code: raw.code,
    status: raw.status,
    createdAt: raw.created_at,
    deviceModel: raw.device_model,
    brandCode: raw.brand_code,
    customerName: raw.customer_name,
    customerPhone: raw.customer_phone,
    customerPhone2: raw.customer_phone2,
    fulfillment: raw.fulfillment,
    addressLine: raw.address_line,
    branchName: raw.branches ? (ar ? raw.branches.name_ar : raw.branches.name_en) : null,
    technicianId: raw.technician_id,
    technicianName: holderName,
    preferredAt: raw.preferred_at,
    notes: raw.notes,
    quoteAmount,
    quoteNotes: raw.quote_notes,
    actualCost,
    photosBefore: raw.photos_before ?? [],
    photosAfter: raw.photos_after ?? [],
    issues: (raw.repair_ticket_issues ?? []).flatMap((link) =>
      link.repair_issues ? [ar ? link.repair_issues.name_ar : link.repair_issues.name_en] : [],
    ),
    issueCodes: (raw.repair_ticket_issues ?? []).map((link) => link.issue_code),
    faults: (raw.repair_ticket_issues ?? []).map((link) => ({
      code: link.issue_code,
      name: link.repair_issues ? (ar ? link.repair_issues.name_ar : link.repair_issues.name_en) : link.issue_code,
    })),
    customFaults: (raw.custom_faults ?? []).filter((fault) => fault.trim()),
    service: raw.service === "software" ? "software" : "hardware",
    price,
    basePrice: repairBase(price, warrantyPrice),
    warrantyPrice,
    warrantyDays: raw.warranty_days ?? null,
    warrantyStart: raw.warranty_start ?? null,
    costPrice: num(ledger?.cost_price),
    collected: num(ledger?.collected),
    paymentTerms: ledger?.payment_terms === "deferred" ? "deferred" : "cash",
    financeAt: ledger?.updated_at ?? null,
    // Before 20261124_maintenance_stages.sql there is no column: a completed
    // ticket is booked on the day it was opened until the ledger says
    // otherwise (`deskData`), as on the site.
    completedAt:
      raw.completed_at !== undefined ? raw.completed_at : raw.status === "completed" ? raw.created_at : null,
    handedOverAt: raw.handed_over_at ?? null,
    handedOverBy: handedBy,
    handedOverName: handedBy
      ? (scope.people.find((candidate) => candidate.userId === handedBy)?.name ?? directory[handedBy]?.name ?? null)
      : null,
    holderId: raw.assigned_to,
    holderName,
    holderRank: !raw.assigned_to
      ? null
      : (person?.rank ?? (listed?.role === "technician" ? "technician" : "manager")),
    control: ticketControl(scope.authority, viewerId, raw.assigned_to),
    sync: store.syncStateOf(id),
    localCode: Boolean(record?.createdHere && !record.serverId),
    editedAt: raw.quote_sent_at ?? null,
    // Opened on this computer: the shop's own, whatever the server says.
    origin: record?.createdHere ? "counter" : originOf(record?.serverId ?? null),
  };
  return scope.authority.seesMoney ? row : forTechnician(row);
}

/** What a technician is sent — `forTechnician` in the dashboard's query. */
function forTechnician(row: DeskRow): DeskRow {
  const blind: DeskRow = {
    ...row,
    actualCost: row.basePrice,
    quoteAmount: null,
    price: row.basePrice,
    warrantyPrice: null,
    warrantyDays: null,
    warrantyStart: null,
    costPrice: null,
    collected: null,
    paymentTerms: "cash",
  };
  if (row.control === "own") return blind;
  return { ...blind, actualCost: null, price: null, basePrice: null, customerPhone: "", customerPhone2: null, addressLine: null };
}

/** Every live ticket on one bench, as the screen should show it, newest first. */
function benchTickets(service: RepairService): { id: string; raw: RawTicket }[] {
  const out: { id: string; raw: RawTicket }[] = [];
  for (const id of store.tickets.keys()) {
    const raw = store.view(id);
    if (!raw || raw.is_deleted) continue;
    if ((raw.service === "software" ? "software" : "hardware") !== service) continue;
    out.push({ id, raw });
  }
  return out.sort((a, b) => (a.raw.created_at < b.raw.created_at ? 1 : a.raw.created_at > b.raw.created_at ? -1 : a.id.localeCompare(b.id)));
}

/** The page, as `RepairDeskPage` resolves it: the period from the address, the rest from the bench. */
export function deskPage(params: DeskPageParams, service: RepairService): DeskPageData {
  const viewer = refs.viewer();
  if (!viewer) return { ready: false, reason: "no_account" };
  const scope = deskScope(service);
  if (!scope) return { ready: false, reason: "no_account" };
  if (!store.meta("lastFullPull") && store.tickets.size === 0) return { ready: false, reason: "no_data" };

  const { authority, people } = scope;
  const locale = params.locale === "en" ? "en" : "ar";
  const ar = locale === "ar";
  const isTech = authority.rank === "technician";
  const now = Date.now();
  // The site's page: today unless a period was chosen.
  const window = resolveQueueWindow(
    { when: params.when, from: params.from, to: params.to, days: params.days },
    now,
    { fallback: "today", open: false },
  );
  const tickets = benchTickets(service);
  const available = refs.available();
  // What only a manager is handed, as on the site's page.
  const manages = authority.manages;
  const latest = manages ? tickets.slice(0, 500) : [];

  return {
    ready: true,
    service,
    basePath: service === "software" ? "/admin/programming" : "/admin/repairs",
    viewer,
    authority,
    people,
    deputies: refs.deputies(),
    isTech,
    desk: deskData(tickets, { locale, scope, viewerId: viewer.id, window }),
    flow: liveFlow(REPAIR_FLOW, refs.steps()) as RepairStatus[],
    branches: refs.branches().map((branch) => ({ id: branch.id, name: ar ? branch.name_ar : branch.name_en })),
    brands: refs.brands().map((brand) => ({ code: brand.code, name: ar ? brand.name_ar : brand.name_en })),
    models: refs.models(),
    // What the counter's model picker opens on: this bench's latest devices,
    // newest first, whatever the period — the site's `getRecentDeskUse`.
    // `tickets` is already newest first.
    recentDevices: recentDevicesFrom(
      latest.map(({ raw }) => ({ model: raw.device_model, brandCode: raw.brand_code, at: raw.created_at })),
      MAKE_CODES,
    ),
    // Both fault pickers open on the faults this bench used last.
    recentFaults: recentFaultsFrom(
      latest.map(({ raw }) => ({
        codes: (raw.repair_ticket_issues ?? []).map((link) => link.issue_code),
        at: raw.created_at,
      })),
    ),
    issues: refs
      .issues()
      .filter((issue) => issue.service === service)
      .map((issue) => ({ code: issue.code, name: ar ? issue.name_ar : issue.name_en })),
    today: baghdadDay(now),
    now,
    canDelete: canWith(viewer.role, viewer.grant, "records.delete"),
    faultsEditable: manages && Boolean(available.faultsEdit),
    defaultHolderId: manages
      ? (store.ref<Record<string, string>>("workDefaults")?.[service === "software" ? "repair_software" : "repair_hardware"] ?? null)
      : null,
  };
}

/** A ticket that is still being worked on, whatever day it was opened — the site's `status.not.in`. */
const CLOSED = new Set(["completed", "cancelled", "declined"]);

/**
 * `getDeskData`, over this computer's copy: the period's rows — everything
 * opened or booked in it, every ticket still open from any day, and the
 * tickets from before it whose money or «مرتجع» falls in it — and the two
 * ledgers of exactly those tickets.
 */
function deskData(
  tickets: { id: string; raw: RawTicket }[],
  { locale, scope, viewerId, window }: { locale: "ar" | "en"; scope: DeskScope; viewerId: string; window: QueueWindow },
): DeskData {
  const { authority } = scope;
  const isTech = authority.rank === "technician";
  const available = refs.available();
  const stages = Boolean(available.stages);
  const finance = authority.seesMoney && !isTech && available.finance;

  // ⚠️ A technician reads only the tickets in his own name (2026-11-17) —
  // the site's `getDeskData` holds the same line, and sends him no money.
  const bench = isTech ? tickets.filter(({ raw }) => raw.assigned_to === viewerId) : tickets;

  // The whole ledgers, as this computer holds them, with what each change
  // still waiting here will add to them when it reaches the server.
  let book: PaymentBook = null;
  let returns: ReturnBook = null;
  if (finance) {
    const pending = waiting();
    book = paymentBook(pending, stages);
    returns = returnBook(pending, stages);
  }

  const all = !window.since && !window.until;
  const inPeriod = (at: string | null | undefined) =>
    typeof at === "string" && (!window.since || at >= window.since) && (!window.until || at < window.until);
  const chosen = new Set<string>();
  for (const { id, raw } of bench) {
    if (all || inPeriod(raw.created_at) || (stages && inPeriod(raw.completed_at)) || !CLOSED.has(raw.status)) chosen.add(id);
  }
  if (window.since) {
    for (const id of paidWithinIds(book, window)) chosen.add(id);
    for (const id of returnedWithinIds(returns, window)) chosen.add(id);
  }

  const rows = bench.filter(({ id }) => chosen.has(id)).map(({ id, raw }) => shapeRow(id, raw, locale, scope, viewerId));
  // Only the chosen tickets' entries, whole: the window reads nothing else,
  // and the whole ledger of every ticket is a lot to pass on every redraw.
  book = only(book, chosen);
  returns = only(returns, chosen);

  // ⚠️ Before 20261124_maintenance_stages.sql there is no `completed_at`: a
  // completed ticket's day is the day its ledger says it was paid in full —
  // the rule the migration backfills it by — and the old ledger's «راجع» on
  // or before that day is the booking day's own business. The site's
  // `getDeskData` does the same.
  if (!stages && book) {
    for (const row of rows) {
      if (row.status === "completed") row.completedAt = paidInFullAt(book[row.id] ?? [], row.price) ?? row.createdAt;
    }
    if (returns) {
      returns = dropBookingDayReturns(
        returns,
        new Map(rows.flatMap((row) => (row.status === "completed" && row.completedAt ? [[row.id, row.completedAt] as const] : []))),
      );
    }
  }

  return {
    rows,
    book,
    returns,
    window,
    available: {
      service: available.service,
      finance,
      warranty: available.warranty,
      customFaults: available.customFaults,
      stages,
    },
    truncated: false,
  };
}

/** A ledger narrowed to some tickets, each ticket's entries whole. */
function only<T>(ledger: Record<string, readonly T[]> | null, ids: ReadonlySet<string>): Record<string, readonly T[]> | null {
  if (!ledger) return null;
  const out: Record<string, readonly T[]> = {};
  for (const id of ids) if (ledger[id]) out[id] = ledger[id];
  return out;
}

/** The tickets with a change on this computer not yet sent: when the last was made, the server's copy, and this one. */
type Waiting = Map<string, { at: string; server: RawTicket; local: RawTicket }>;

function waiting(): Waiting {
  const out: Waiting = new Map();
  for (const op of store.ops) {
    if (op.state !== "pending") continue;
    const record = store.tickets.get(op.ticketId);
    if (!record?.serverId) continue;
    const seen = out.get(op.ticketId);
    if (seen) {
      if (op.createdAt > seen.at) seen.at = op.createdAt;
      continue;
    }
    const local = store.view(op.ticketId);
    if (local) out.set(op.ticketId, { at: op.createdAt, server: record.raw, local });
  }
  return out;
}

/**
 * `repair_ticket_payments` — when each part of a ticket's money came in, by
 * this computer's ticket id (`pullPayments`) — and, for a change not yet
 * sent, the entry the database will record when it lands: the gap between
 * what the ticket has paid by the rule before the change and after it.
 * Null while the table is not on the server; the figures then use the money
 * row's own date, as the site does.
 */
function paymentBook(pending: Waiting, stages: boolean): PaymentBook {
  const held = store.ref<Record<string, PaymentEntry[]> | null>("payments");
  if (!held) return null;
  const book: Record<string, PaymentEntry[]> = {};
  for (const [serverId, entries] of Object.entries(held)) {
    const id = store.idForServer(serverId) ?? serverId;
    book[id] = [...entries];
  }
  // Before the stages, a change was dated here only once a cancellation gave
  // its money back (20261121, the «راجع» ledger) — what the old rule needs.
  const refunds = store.ref("returns") != null;
  if (!stages && !refunds) return book;
  for (const [id, change] of pending) {
    const sum = (book[id] ?? []).reduce((total, entry) => total + entry.amount, 0);
    const target = (raw: RawTicket) => (stages ? paymentTarget(raw, sum) : paymentTargetV1(raw));
    const was = target(change.server);
    const now = target(change.local);
    if (was === null || now === null) continue;
    const delta = now - was;
    if (delta) (book[id] ??= []).push({ at: change.at, amount: delta });
  }
  return book;
}

/**
 * `repair_ticket_returns` — every «مرتجع» by this computer's ticket id, oldest
 * first (`pullReturns`) — and, for a change not yet sent, the one the
 * database will record when it lands. Null while the table is not on the
 * server, and nothing is «مرتجع».
 */
function returnBook(pending: Waiting, stages: boolean): ReturnBook {
  const held = store.ref<Record<string, ReturnEntry[]> | null>("returns");
  if (!held) return null;
  const book: Record<string, ReturnEntry[]> = {};
  for (const [serverId, entries] of Object.entries(held)) {
    const id = store.idForServer(serverId) ?? serverId;
    book[id] = [...entries];
  }
  for (const [id, change] of pending) {
    const entry = stages ? returnFor(change.server, change.local, change.at) : returnForV1(change.server, change.local, change.at);
    if (entry) (book[id] ??= []).push(entry);
  }
  return book;
}

/** What one reader may do to one ticket, from the local copy — `authorizeRepair`. */
export function authorizeTicket(id: string):
  | { ok: false; error: "not_signed_in" | "forbidden" }
  | {
      ok: true;
      viewerId: string;
      role: string;
      service: RepairService;
      scope: DeskScope;
      authority: DeskAuthority;
      control: "full" | "own" | "none";
      raw: RawTicket;
    } {
  const viewer = refs.viewer();
  if (!viewer) return { ok: false, error: "not_signed_in" };
  const raw = store.view(id);
  if (!raw || raw.is_deleted) return { ok: false, error: "forbidden" };
  const service: RepairService = raw.service === "software" ? "software" : "hardware";
  if (!canWith(viewer.role, viewer.grant, SERVICE_CAPABILITY[service])) return { ok: false, error: "forbidden" };
  const scope = deskScope(service);
  if (!scope) return { ok: false, error: "not_signed_in" };
  return {
    ok: true,
    viewerId: viewer.id,
    role: viewer.role,
    service,
    scope,
    authority: scope.authority,
    control: ticketControl(scope.authority, viewer.id, raw.assigned_to),
    raw,
  };
}
