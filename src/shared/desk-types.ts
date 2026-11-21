/**
 * The repair desk's shapes, shared by the main process (which computes them
 * from the local database) and the renderer (which draws them).
 *
 * They are the site's own types — `RepairCard`, `DeskRow`, `DeskBoard`,
 * `DeskPerson` from `lib/queries/*` — restated here because those modules are
 * server-only and the app never copies them. The renderer's override of
 * `@/lib/queries/repair-desk` re-exports these, so the copied board imports
 * `DeskRow` from the path it always has.
 *
 * Two fields are the app's own: `sync` on a row, which says whether this
 * ticket has a change still waiting to reach the server, and `localCode`, the
 * provisional code a ticket opened offline carries until it gets a real one.
 */
import type { RepairStatus } from "../site/lib/data/orders.ts";
import type { RecentDevice } from "../site/lib/data/recent-devices.ts";
import type { RecentFault } from "../site/lib/data/repair-faults.ts";
import type {
  DeskAuthority,
  DeskControl,
  DeskDeputyRef,
  DeskRank,
  DeskTotals,
  PaymentTerms,
  RepairService,
} from "../site/lib/data/repair-desk.ts";
import type { QueueWindow } from "../site/lib/data/queue-window.ts";
import type { MoneyFilter, ReturnSummary, StatsStatus } from "../site/lib/data/desk-figures.ts";
import type { StockModel } from "../site/lib/data/device-catalogue.ts";
import type { AccessGrant } from "../site/lib/permissions.ts";

export type RepairFulfillment = "drop_off" | "pickup";

export type RepairCard = {
  id: string;
  code: string;
  status: RepairStatus;
  createdAt: string;
  deviceModel: string;
  brandCode: string | null;
  customerName: string;
  customerPhone: string;
  customerPhone2: string | null;
  fulfillment: RepairFulfillment;
  addressLine: string | null;
  branchName: string | null;
  technicianId: string | null;
  technicianName: string | null;
  preferredAt: string | null;
  notes: string | null;
  quoteAmount: number | null;
  quoteNotes: string | null;
  actualCost: number | null;
  photosBefore: string[];
  photosAfter: string[];
  issues: string[];
};

/** Whether a ticket's latest change has reached the server. */
export type RowSync = "pending" | "failed" | null;

export type DeskRow = RepairCard & {
  service: RepairService;
  issueCodes: string[];
  /** The same faults as pairs, so the ticket window's editor can name each chip. */
  faults: { code: string; name: string }[];
  customFaults: string[];
  /** Entered at the shop, or booked on the site — `learnOrigins`. Null when it cannot be told. */
  origin?: "counter" | "web" | null;
  /** When its content was last changed after it was opened (`quote_sent_at`); null if never. */
  editedAt?: string | null;
  /** مبلغ الصيانة كله — what the customer pays, warranty included. */
  price: number | null;
  /** The repair alone. */
  basePrice: number | null;
  warrantyPrice: number | null;
  warrantyDays: number | null;
  warrantyStart: string | null;
  costPrice: number | null;
  collected: number | null;
  paymentTerms: PaymentTerms;
  /** When its money row last changed — the money's stand-in date before the ledger. */
  financeAt?: string | null;
  /** Set only on a ticket opened before the period whose money came in within it: how much. */
  paidWithin?: number | null;
  /** On the list from before the period — for its money or its «راجع». */
  earlier?: boolean;
  /** «راجع» — its money changed within the period on a later day than it was opened. */
  returned?: ReturnSummary | null;
  holderId: string | null;
  holderName: string | null;
  holderRank: DeskRank | null;
  control: DeskControl;
  /** The app's own: a change on this ticket is still waiting to be sent, or was refused. */
  sync?: RowSync;
  /** The app's own: opened offline, so `code` is provisional until it is sent. */
  localCode?: boolean;
};

export type DeskPerson = {
  userId: string;
  name: string;
  role: string;
  managerId: string | null;
  technicianId: string | null;
  rank: DeskRank;
};

export type DeskScope = { authority: DeskAuthority; people: DeskPerson[] };

export type DeskView = "all" | "mine" | "pending" | "edited" | "owing" | "returned";

export type DeskTechRow = DeskTotals & { holderId: string | null; name: string };

export type DeskAvailability = {
  service: boolean;
  finance: boolean;
  warranty: boolean;
  customFaults: boolean;
  /**
   * A ticket's faults can be changed after it is opened — `set_repair_faults`,
   * 20261116_repair_faults_editable.sql. Asked of the server on every refs pull.
   */
  faultsEdit?: boolean;
};

/** The figures panel — the site's `DeskStats`, from `lib/data/desk-figures.ts`. */
export type DeskStats = {
  status: StatsStatus;
  window: QueueWindow;
  totals: DeskTotals;
  byTech: DeskTechRow[];
  rows: DeskRow[];
  paidRows: DeskRow[];
  /** «راجع» — every ticket whose money changed in the period on a later day, with its summary. */
  returnRows?: DeskRow[];
  /** Money is dated by the ledger (`repair_ticket_payments`). */
  ledger: boolean;
  /** The «راجع» ledger is on the server (`repair_ticket_returns`). */
  returns?: boolean;
};

export type DeskBoard = {
  rows: DeskRow[];
  counts: Record<string, number>;
  totals: DeskTotals;
  stats: DeskStats | null;
  /** «راجع» within the tickets panel's period — the tab's count. */
  returnedCount?: number;
  available: DeskAvailability;
  truncated: boolean;
};

/** Who the app is signed in as, as the dashboard knows them. */
export type DeskViewer = {
  id: string;
  name: string;
  email: string;
  role: string;
  grant: AccessGrant;
};

/** What the page asks for — the dashboard's URL parameters, plus the language. */
export type DeskPageParams = {
  locale: "ar" | "en";
  view?: string;
  when?: string;
  from?: string;
  to?: string;
  days?: string;
  q?: string;
  status?: string;
  terms?: string;
  tech?: string;
  /** The figures' own status filter. */
  sstatus?: string;
  /** "The tickets behind this card", pressed from a figures card. */
  mf?: string;
};

/** Everything the desk page draws, computed in one place, as the server did. */
export type DeskPageData =
  | { ready: false; reason: "no_data" | "no_account" }
  | {
      ready: true;
      service: RepairService;
      basePath: string;
      viewer: DeskViewer;
      authority: DeskAuthority;
      people: DeskPerson[];
      deputies: DeskDeputyRef[];
      isTech: boolean;
      defaultView: DeskView;
      view: DeskView;
      window: QueueWindow;
      search: string;
      status: string | null;
      statsStatus: StatsStatus;
      moneyFilter: MoneyFilter | null;
      statuses: RepairStatus[];
      flow: RepairStatus[];
      terms: PaymentTerms | null;
      tech: string | null;
      board: DeskBoard;
      counts: { mine: number; pending: number; olderOpen: number; edited?: number; owing?: number };
      branches: { id: string; name: string }[];
      brands: { code: string; name: string }[];
      models: Record<string, StockModel[]>;
      /** The bench's latest devices, newest first — the model picker opens on them. */
      recentDevices: RecentDevice[];
      /** The bench's faults by their last ticket, newest first — both fault pickers open on them. */
      recentFaults: RecentFault[];
      issues: { code: string; name: string }[];
      today: string;
      now: number;
      canDelete: boolean;
      /** The bench's default holder (`work_defaults`) — what the counter's dialog opens on. */
      defaultHolderId?: string | null;
    };

/** The papers' facts, as `loadRepairPrintFacts` answers. */
export type { RepairPrintFacts } from "../site/lib/data/repair-print-facts.ts";
