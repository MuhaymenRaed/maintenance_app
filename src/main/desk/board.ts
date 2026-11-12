import { canWith } from "../../site/lib/permissions.ts";
import {
  addToTotals,
  deskAuthority,
  deskRank,
  emptyTotals,
  isOpenTicket,
  repairBase,
  SERVICE_CAPABILITY,
  ticketControl,
  type DeskAuthority,
  type PaymentTerms,
  type RepairService,
} from "../../site/lib/data/repair-desk.ts";
import { liveFlow, REPAIR_FLOW, type RepairStatus } from "../../site/lib/data/orders.ts";
import { cleanSearch, resolveQueueWindow } from "../../site/lib/data/queue-window.ts";
import { baghdadDay } from "../../site/lib/data/date-window.ts";
import type {
  DeskBoard,
  DeskPageData,
  DeskPageParams,
  DeskPerson,
  DeskRow,
  DeskScope,
  DeskTechRow,
  DeskView,
} from "../../shared/desk-types";
import { store } from "../db/store";
import { financeOf, num, type RawTicket } from "./raw";
import { refs } from "./refs";

/**
 * The desk page, computed — `RepairDeskPage`, `getRepairDesk`, `getDeskScope`
 * and `getDeskCounts` from the dashboard, run over the local database instead
 * of the server's.
 *
 * The rules are the dashboard's own modules, imported unchanged
 * (`deskAuthority`, `ticketControl`, `addToTotals`, `resolveQueueWindow`), so a
 * figure on this screen and the same figure on the dashboard are the same
 * arithmetic over the same rows. What differs is only where the rows come
 * from: here, the server's last copy with this computer's waiting changes on
 * top (`store.view`).
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

/** One ticket shaped for the board, in one language — `getRepairDesk`'s mapping. */
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
  const listed = raw.assigned_to ? refs.directory()[raw.assigned_to] : undefined;
  const holderName = person?.name ?? listed?.name ?? raw.technicians?.name ?? null;
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
    holderId: raw.assigned_to,
    holderName,
    holderRank: !raw.assigned_to
      ? null
      : (person?.rank ?? (listed?.role === "technician" ? "technician" : "manager")),
    control: ticketControl(scope.authority, viewerId, raw.assigned_to),
    sync: store.syncStateOf(id),
    localCode: Boolean(record?.createdHere && !record.serverId),
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

/** Every live ticket on one bench, as the screen should show it. */
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

const contains = (value: string | null | undefined, needle: string) =>
  Boolean(value) && value!.toLocaleLowerCase().includes(needle);

/** The page, as `RepairDeskPage` resolves it from its search params. */
export function deskPage(params: DeskPageParams, service: RepairService): DeskPageData {
  const viewer = refs.viewer();
  if (!viewer) return { ready: false, reason: "no_account" };
  const scope = deskScope(service);
  if (!scope) return { ready: false, reason: "no_account" };
  if (!store.meta("lastFullPull") && store.tickets.size === 0) return { ready: false, reason: "no_data" };

  const { authority, people } = scope;
  const locale = params.locale === "en" ? "en" : "ar";
  const isTech = authority.rank === "technician";
  const now = Date.now();

  const defaultView: DeskView = isTech ? "mine" : "all";
  const asked = params.view;
  const view: DeskView =
    asked === "all" || asked === "mine" ? asked : asked === "pending" && !isTech ? "pending" : defaultView;

  const window = resolveQueueWindow(
    { when: params.when, from: params.from, to: params.to, days: params.days },
    now,
    { fallback: view === "all" ? "all" : "open", open: true },
  );
  const search = cleanSearch(params.q);
  const flow = liveFlow(REPAIR_FLOW, refs.steps()) as RepairStatus[];
  const statuses: RepairStatus[] = [...flow, "cancelled"];
  const status = statuses.includes(params.status as RepairStatus) ? params.status! : null;
  const terms: PaymentTerms | null =
    authority.seesMoney && (params.terms === "cash" || params.terms === "deferred") ? params.terms : null;
  const asPerson = params.tech;
  const tech =
    view === "mine"
      ? null
      : asPerson === "none" ||
          people.some((person) => person.userId === asPerson && authority.visible.includes(person.userId))
        ? asPerson!
        : null;

  const tickets = benchTickets(service);
  const board = buildBoard(tickets, { locale, scope, viewerId: viewer.id, window, search, status, terms, holderId: tech, view });
  const counts = deskCounts(tickets, viewer.id, people, window.since);

  const ar = locale === "ar";
  return {
    ready: true,
    service,
    basePath: service === "software" ? "/admin/programming" : "/admin/repairs",
    viewer,
    authority,
    people,
    deputies: refs.deputies(),
    isTech,
    defaultView,
    view,
    window,
    search,
    status,
    statuses,
    flow,
    terms,
    tech,
    board,
    counts,
    branches: refs.branches().map((branch) => ({ id: branch.id, name: ar ? branch.name_ar : branch.name_en })),
    brands: refs.brands().map((brand) => ({ code: brand.code, name: ar ? brand.name_ar : brand.name_en })),
    models: refs.models(),
    issues: refs
      .issues()
      .filter((issue) => issue.service === service)
      .map((issue) => ({ code: issue.code, name: ar ? issue.name_ar : issue.name_en })),
    today: baghdadDay(now),
    now,
    canDelete: canWith(viewer.role, viewer.grant, "records.delete"),
  };
}

function buildBoard(
  tickets: { id: string; raw: RawTicket }[],
  options: {
    locale: "ar" | "en";
    scope: DeskScope;
    viewerId: string;
    window: ReturnType<typeof resolveQueueWindow>;
    search: string;
    status: string | null;
    terms: PaymentTerms | null;
    holderId: string | null;
    view: DeskView;
  },
): DeskBoard {
  const { locale, scope, viewerId, window, search, status, terms, holderId, view } = options;
  const needle = search.toLocaleLowerCase();

  const everything: DeskRow[] = [];
  for (const { id, raw } of tickets) {
    if (window.since && raw.created_at < window.since) continue;
    if (window.until && raw.created_at >= window.until) continue;
    if (window.when === "open" && !isOpenTicket(raw.status)) continue;
    if (view === "mine" && raw.assigned_to !== viewerId) continue;
    if (
      needle &&
      ![
        raw.code,
        raw.customer_name,
        raw.customer_phone,
        raw.customer_phone2,
        raw.device_model,
        raw.notes,
        raw.quote_notes,
        store.tickets.get(id)?.localCode,
      ].some((value) => contains(value, needle))
    ) {
      continue;
    }
    everything.push(shapeRow(id, raw, locale, scope, viewerId));
  }

  const all =
    view === "pending"
      ? everything.filter((row) => isOpenTicket(row.status) && row.holderRank !== "technician")
      : everything;

  const counts: Record<string, number> = {};
  for (const row of all) counts[row.status] = (counts[row.status] ?? 0) + 1;

  const inScope = all.filter(
    (row) =>
      (!terms || row.paymentTerms === terms) &&
      (!holderId || (holderId === "none" ? !row.holderId : row.holderId === holderId)),
  );

  const totals = emptyTotals();
  for (const row of inScope) addToTotals(totals, row);

  const perHolder = new Map<string, DeskTechRow>();
  for (const row of all) {
    if (terms && row.paymentTerms !== terms) continue;
    const key = row.holderId ?? "";
    let entry = perHolder.get(key);
    if (!entry) {
      entry = { ...emptyTotals(), holderId: row.holderId, name: row.holderName ?? "" };
      perHolder.set(key, entry);
    }
    addToTotals(entry, row);
  }
  const byTech = [...perHolder.values()].sort(
    (a, b) => Number(!a.holderId) - Number(!b.holderId) || b.revenue - a.revenue || b.tickets - a.tickets,
  );

  return {
    rows: status ? inScope.filter((row) => row.status === status) : inScope,
    counts,
    totals,
    byTech,
    available: refs.available(),
    truncated: false,
  };
}

/** The tabs' counts — `getDeskCounts`, over every open ticket on the bench. */
function deskCounts(
  tickets: { id: string; raw: RawTicket }[],
  viewerId: string,
  people: readonly DeskPerson[],
  since: string | null,
) {
  const technicians = new Set(people.filter((person) => person.rank === "technician").map((person) => person.userId));
  let mine = 0;
  let pending = 0;
  let olderOpen = 0;
  for (const { raw } of tickets) {
    if (!isOpenTicket(raw.status)) continue;
    if (raw.assigned_to === viewerId) mine += 1;
    if (!raw.assigned_to || !technicians.has(raw.assigned_to)) pending += 1;
    if (since && raw.created_at < since) olderOpen += 1;
  }
  return { mine, pending, olderOpen };
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
