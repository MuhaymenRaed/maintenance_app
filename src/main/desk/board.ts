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
import { recentDevicesFrom } from "../../site/lib/data/recent-devices.ts";
import { recentFaultsFrom } from "../../site/lib/data/repair-faults.ts";
import { MAKE_CODES } from "../../site/lib/data/device-name.ts";
import {
  computeFigures,
  moneyAcross,
  owesMoney,
  STATS_GROUPS,
  type PaymentBook,
  type PaymentEntry,
  type StatsStatus,
} from "../../site/lib/data/desk-figures.ts";
import type {
  DeskBoard,
  DeskPageData,
  DeskPageParams,
  DeskPerson,
  DeskRow,
  DeskScope,
  DeskStats,
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

/** Counter or booking, as `learnOrigins` filed it; null when it cannot be told. */
function originOf(serverId: string | null): "counter" | "web" | null {
  if (!serverId) return null;
  const value = store.ref<Record<string, string>>("origins")?.[serverId];
  return value === "counter" || value === "web" ? value : null;
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

  // A technician has one list — his own (the shop, 2026-11-17). Everybody
  // else opens on the bench.
  const defaultView: DeskView = isTech ? "mine" : "all";
  const asked = params.view;
  const view: DeskView = isTech
    ? "mine"
    : asked === "all" || asked === "mine" || asked === "pending" || asked === "edited" ||
        (asked === "owing" && authority.seesMoney)
      ? asked
      : defaultView;

  const period = { when: params.when, from: params.from, to: params.to, days: params.days };
  const window = resolveQueueWindow(period, now, {
    fallback: view === "all" || view === "edited" || view === "owing" ? "all" : "open",
    open: true,
  });
  // The figures' own reading of the same address — every day unless a period
  // was chosen — as the site's page does.
  const hasStats = authority.seesMoney && !isTech;
  const statsWindow = hasStats ? resolveQueueWindow(period, now, { fallback: "all", open: true }) : null;
  const search = cleanSearch(params.q);
  const flow = liveFlow(REPAIR_FLOW, refs.steps()) as RepairStatus[];
  const statuses: RepairStatus[] = [...flow, "cancelled"];
  const status = statuses.includes(params.status as RepairStatus) ? params.status! : null;
  const statsStatus: StatsStatus =
    params.sstatus &&
    ((STATS_GROUPS as readonly string[]).includes(params.sstatus) || statuses.includes(params.sstatus as RepairStatus))
      ? params.sstatus
      : "all";
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
  const board = buildBoard(tickets, {
    locale,
    scope,
    viewerId: viewer.id,
    window,
    statsWindow,
    statsStatus,
    search,
    status,
    terms,
    holderId: tech,
    view,
  });
  const counts = deskCounts(tickets, viewer.id, people, window.since, hasStats);

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
    statsStatus,
    statuses,
    flow,
    terms,
    tech,
    board,
    counts,
    branches: refs.branches().map((branch) => ({ id: branch.id, name: ar ? branch.name_ar : branch.name_en })),
    brands: refs.brands().map((brand) => ({ code: brand.code, name: ar ? brand.name_ar : brand.name_en })),
    models: refs.models(),
    // What the counter's model picker opens on: this bench's latest devices,
    // newest first, whatever the filters say — see the site's
    // `lib/data/recent-devices.ts`. `tickets` is already newest first.
    recentDevices: recentDevicesFrom(
      tickets.slice(0, 500).map(({ raw }) => ({ model: raw.device_model, brandCode: raw.brand_code, at: raw.created_at })),
      MAKE_CODES,
    ),
    // Both fault pickers open on the faults this bench used last — the site's
    // `lib/data/repair-faults.ts`, over the same newest-first tickets.
    recentFaults: recentFaultsFrom(
      tickets.slice(0, 500).map(({ raw }) => ({
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
    defaultHolderId:
      store.ref<Record<string, string>>("workDefaults")?.[service === "software" ? "repair_software" : "repair_hardware"] ?? null,
  };
}

/**
 * The ledger of when each part of a ticket's money came in, by this
 * computer's ticket id — `pullPayments`. Null while the table is not on the
 * server; the figures then use the money row's own date, as the site does.
 */
function paymentBook(): PaymentBook {
  const held = store.ref<Record<string, PaymentEntry[]> | null>("payments");
  if (!held) return null;
  const book: Record<string, PaymentEntry[]> = {};
  for (const [serverId, entries] of Object.entries(held)) {
    const id = store.idForServer(serverId) ?? serverId;
    book[id] = entries;
  }
  return book;
}

/**
 * `getRepairDesk`, over this computer's copy — both panels from one pass, as
 * the site's read does, so moving between them is instant here too.
 */
function buildBoard(
  tickets: { id: string; raw: RawTicket }[],
  options: {
    locale: "ar" | "en";
    scope: DeskScope;
    viewerId: string;
    window: ReturnType<typeof resolveQueueWindow>;
    statsWindow: ReturnType<typeof resolveQueueWindow> | null;
    statsStatus: StatsStatus;
    search: string;
    status: string | null;
    terms: PaymentTerms | null;
    holderId: string | null;
    view: DeskView;
  },
): DeskBoard {
  const { locale, scope, viewerId, window, statsWindow, statsStatus, search, status, terms, holderId, view } = options;
  const needle = search.toLocaleLowerCase();
  const isTech = scope.authority.rank === "technician";
  const figures = scope.authority.seesMoney && !isTech ? statsWindow : null;
  // The figures' period always holds the tickets panel's — see the site.
  const readWindow = figures ?? window;

  const found = (id: string, raw: RawTicket) => {
    // ⚠️ A technician reads only the tickets in his own name, whatever view was
    // asked for — the site's `getRepairDesk` holds the same line.
    if (isTech && raw.assigned_to !== viewerId) return false;
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
      return false;
    }
    return true;
  };

  const opened: DeskRow[] = [];
  const before: { id: string; raw: RawTicket }[] = [];
  for (const { id, raw } of tickets) {
    if (!found(id, raw)) continue;
    if (readWindow.since && raw.created_at < readWindow.since) {
      before.push({ id, raw });
      continue;
    }
    if (readWindow.until && raw.created_at >= readWindow.until) continue;
    if (readWindow.when === "open" && !isOpenTicket(raw.status)) continue;
    opened.push(shapeRow(id, raw, locale, scope, viewerId));
  }

  // Tickets opened before the figures' period whose money came in within it.
  const book = figures ? paymentBook() : null;
  const earlier: DeskRow[] = [];
  if (figures?.since) {
    for (const { id, raw } of before) {
      const row = shapeRow(id, raw, locale, scope, viewerId);
      if (moneyAcross(row, book, figures, true).within !== 0) earlier.push(row);
    }
  }

  /* ── The tickets panel ── */
  const inPanelWindow = (row: DeskRow) =>
    (!window.since || row.createdAt >= window.since) &&
    (!window.until || row.createdAt < window.until) &&
    (window.when !== "open" || isOpenTicket(row.status));
  const byView = (row: DeskRow) =>
    view === "mine"
      ? row.holderId === viewerId
      : view === "edited"
        ? Boolean(row.editedAt)
        : view === "pending"
          ? isOpenTicket(row.status) && row.holderRank !== "technician"
          : view === "owing"
            ? owesMoney(row)
            : true;
  const listed = opened.filter((row) => inPanelWindow(row) && byView(row));
  if (view === "all" && figures && window.since === figures.since && window.until === figures.until) {
    for (const row of earlier) listed.push({ ...row, paidWithin: moneyAcross(row, book, figures, true).within });
  }

  const counts: Record<string, number> = {};
  for (const row of listed) counts[row.status] = (counts[row.status] ?? 0) + 1;

  const inScope = listed.filter(
    (row) =>
      (!terms || row.paymentTerms === terms) &&
      (!holderId || (holderId === "none" ? !row.holderId : row.holderId === holderId)),
  );

  const totals = emptyTotals();
  for (const row of inScope) if (!row.paidWithin) addToTotals(totals, row);

  /* ── The figures panel ── */
  let stats: DeskStats | null = null;
  if (figures) {
    const result = computeFigures({
      opened,
      earlier,
      book,
      bounds: figures,
      filters: { status: statsStatus, terms, holderId },
      // This computer holds the whole ledger, and changes not yet sent.
      complete: true,
    });
    stats = {
      status: statsStatus,
      window: figures,
      totals: result.totals,
      byTech: result.byTech,
      rows: result.rows,
      paidRows: result.paidRows.map((row) => ({ ...row, paidWithin: moneyAcross(row, book, figures, true).within })),
      ledger: book !== null,
    };
  }

  return {
    rows: status ? inScope.filter((row) => row.status === status) : inScope,
    counts,
    totals,
    stats,
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
  money: boolean,
) {
  const technicians = new Set(people.filter((person) => person.rank === "technician").map((person) => person.userId));
  let mine = 0;
  let pending = 0;
  let olderOpen = 0;
  let owing = 0;
  // Over every ticket on the bench, open or not — an edited ticket may be done.
  const edited = tickets.filter(({ raw }) => Boolean(raw.quote_sent_at)).length;
  for (const { raw } of tickets) {
    if (money) {
      const ledger = financeOf(raw);
      if (
        owesMoney({
          status: raw.status,
          price: num(raw.actual_cost) ?? num(raw.quote_amount),
          warrantyPrice: null,
          costPrice: null,
          collected: num(ledger?.collected),
          paymentTerms: ledger?.payment_terms === "deferred" ? "deferred" : "cash",
        })
      ) {
        owing += 1;
      }
    }
    if (!isOpenTicket(raw.status)) continue;
    if (raw.assigned_to === viewerId) mine += 1;
    if (!raw.assigned_to || !technicians.has(raw.assigned_to)) pending += 1;
    if (since && raw.created_at < since) olderOpen += 1;
  }
  return { mine, pending, olderOpen, edited, owing };
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
