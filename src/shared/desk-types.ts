/**
 * The repair desk's shapes, shared by the main process (which computes them
 * from the local database) and the renderer (which draws them).
 *
 * They are the site's own types — `RepairCard`, `DeskRow`, `DeskData`,
 * `DeskPerson` from `lib/queries/*` — restated here because those modules are
 * server-only and the app never copies them. The renderer's override of
 * `@/lib/queries/repair-desk` re-exports these, so the copied components
 * import them from the path they always have.
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
  PaymentTerms,
  RepairService,
} from "../site/lib/data/repair-desk.ts";
import type { QueueWindow } from "../site/lib/data/queue-window.ts";
import type { PaymentBook, ReturnBook, ReturnSummary } from "../site/lib/data/desk-figures.ts";
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
  /** «راجع» — its money changed within the period on a later day than it was booked. */
  returned?: ReturnSummary | null;
  /** On the day it was opened: the later moment it became «مكتمل». */
  completedLater?: string | null;
  /** On a figures row: what the ticket's own day counted, before a later «راجع». */
  booked?: { status: string; price: number | null; warrantyPrice: number | null; costPrice: number | null } | null;
  /** When it became «مكتمل» — its booking day (2026-11-24). Null while it never has. */
  completedAt: string | null;
  /** «تم التسليم للزبون» — a badge for the bench, never money. */
  handedOverAt?: string | null;
  handedOverBy?: string | null;
  /** Who set the badge, by name. */
  handedOverName?: string | null;
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

export type DeskAvailability = {
  service: boolean;
  finance: boolean;
  warranty: boolean;
  customFaults: boolean;
  /**
   * `completed_at`, `handed_over_*` and `requested` — 20261124_maintenance_stages.sql.
   * Asked of the server on every refs pull; until it is there the ledgers keep
   * their old rules and nothing here stamps a booking day.
   */
  stages?: boolean;
  /**
   * A ticket's faults can be changed after it is opened — `set_repair_faults`,
   * 20261116_repair_faults_editable.sql. Asked of the server on every refs pull.
   */
  faultsEdit?: boolean;
};

/**
 * The period's raw rows and the two ledgers — the site's `DeskData`, read
 * from this computer instead of the server. Every list, card and table is
 * worked out from it in the window (`lib/data/desk-board.ts`,
 * `computeFigures`), the same way the dashboard works them out in the
 * browser.
 */
export type DeskData = {
  rows: DeskRow[];
  book: PaymentBook;
  returns: ReturnBook;
  /** The period. */
  window: QueueWindow;
  available: {
    service: boolean;
    finance: boolean;
    warranty: boolean;
    customFaults: boolean;
    stages: boolean;
  };
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

/**
 * What the page asks the main process for: the period and the language.
 * Everything else in the address — the tab, the list, the ticket to open —
 * is the window's own business, and changing it reads nothing.
 */
export type DeskPageParams = {
  locale: "ar" | "en";
  when?: string;
  from?: string;
  to?: string;
  days?: string;
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
      /** The period's rows and the ledgers — the whole ledger, so `complete`. */
      desk: DeskData;
      flow: RepairStatus[];
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
      faultsEditable: boolean;
      /** The bench's default holder (`work_defaults`) — what the counter's dialog opens on. */
      defaultHolderId?: string | null;
    };

/** The papers' facts, as `loadRepairPrintFacts` answers. */
export type { RepairPrintFacts } from "../site/lib/data/repair-print-facts.ts";
