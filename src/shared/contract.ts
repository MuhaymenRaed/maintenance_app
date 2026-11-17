/**
 * The one door between the window and the main process.
 *
 * The renderer never touches the database, the network or the disk. It asks
 * through `window.desk`, which the preload script builds from this contract,
 * and the main process answers. The method names mirror the dashboard's server
 * actions on purpose (`updateRepair`, `assignRepair`, `createDeskTicket`…): the
 * renderer's overrides of `@/lib/actions/*` are one-line calls into here, so a
 * copied component cannot tell it is not talking to the site.
 */
import type { DeskPageData, DeskPageParams, RepairPrintFacts } from "./desk-types.ts";
import type { StatusEvent } from "../site/lib/data/orders.ts";
import type { WorldModel } from "../site/lib/data/device-name.ts";
import type { PaymentTerms, RepairService } from "../site/lib/data/repair-desk.ts";
import type { RepairStatus } from "../site/lib/data/orders.ts";

/* ── The mutations, shaped exactly as the site's actions take and answer ── */

export type SectionResult = { ok: true; id: string } | { ok: false; error: string };
export type DeskResult = SectionResult;
export type RecordResult = { ok: true } | { ok: false; error: string };

export type RepairPatch = {
  status?: RepairStatus;
  price?: number | null;
  warranty?: number | null;
  warrantyDays?: number | null;
  warrantyStart?: string | null;
  quoteNotes?: string | null;
};

export type FinancePatch = {
  costPrice?: number | null;
  collected?: number | null;
  paymentTerms?: PaymentTerms;
};

export type DeskTicketInput = {
  service: RepairService;
  customerName: string;
  customerPhone: string;
  branchId: string;
  deviceBrandCode: string | null;
  deviceModel: string;
  issueCodes: string[];
  /**
   * Faults typed at the counter that the list does not have yet — filed on
   * the bench's list before the ticket is booked (the site's
   * `createDeskTicket`, 2026-11-16).
   */
  newFaults?: string[];
  /**
   * The old way: words kept on one ticket (`custom_faults`). The dialog no
   * longer sends any; a ticket queued before the change still carries them.
   */
  customFaults?: string[];
  notes: string;
  price: number | null;
  warranty: number | null;
  warrantyDays: number | null;
  costPrice: number | null;
  collected: number | null;
  paymentTerms: PaymentTerms;
  holderId: string;
};

export type CreateTicketResult =
  | {
      ok: true;
      id: string;
      code: string;
      at: string;
      financeSaved: boolean;
      warrantySaved: boolean;
      customSaved: boolean;
      /** Every typed fault is on the list now. Absent here: they go up with the ticket. */
      listSaved?: boolean;
      /** The app's own: saved on this computer and not yet on the server. */
      queued?: boolean;
    }
  | { ok: false; error: string };

/** `updateRepairFaults` — a ticket's faults after it was opened, named. */
export type FaultsInput = { codes: string[]; newFaults?: string[]; custom?: string[] | null; locale?: string };
export type FaultsResult =
  | { ok: true; faults: { code: string; name: string }[]; custom: string[] }
  | { ok: false; error: string };

export type RecordKind = "order" | "repair" | "trade_in";

export type PrintFactsResult =
  | { ok: true; facts: RepairPrintFacts }
  | { ok: false; error: "not_signed_in" | "forbidden" | "bad_request" | "not_found" };

/* ── Settings ─────────────────────────────────────────────────────────── */

export type ThemeChoice = "light" | "dark" | "system";

export type AppSettings = {
  locale: "ar" | "en";
  theme: ThemeChoice;
  /** The whole interface, as a share of the dashboard's own size. */
  fontScale: number;
  reduceMotion: boolean;
  /** Which bench this desk works. Only a bench the account may write is offered. */
  service: RepairService;
  /** How often to ask the server for changes while online, in seconds. */
  syncIntervalSec: number;
  notifyNewTickets: boolean;
  notifyChanges: boolean;
  notifySyncProblems: boolean;
  notifyConnection: boolean;
  notifySound: boolean;
  startWithWindows: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  backupEveryHours: number;
  backupKeep: number;
  backupOnQuit: boolean;
  /** A second folder every backup is also copied to — a USB stick, a shared drive. */
  backupMirror: string | null;
  agentAutoStart: boolean;
  /** The dashboard's address — where photos are uploaded and links open. */
  siteUrl: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  locale: "ar",
  theme: "light",
  fontScale: 1,
  reduceMotion: false,
  service: "hardware",
  syncIntervalSec: 15,
  notifyNewTickets: true,
  notifyChanges: true,
  notifySyncProblems: true,
  notifyConnection: false,
  notifySound: true,
  startWithWindows: false,
  startMinimized: false,
  closeToTray: true,
  backupEveryHours: 6,
  backupKeep: 30,
  backupOnQuit: true,
  backupMirror: null,
  agentAutoStart: true,
  siteUrl: "https://alisnad.iq",
};

/* ── Sync ─────────────────────────────────────────────────────────────── */

export type SyncState = "starting" | "idle" | "syncing" | "offline" | "error" | "auth";

export type SyncStatus = {
  state: SyncState;
  online: boolean;
  signedIn: boolean;
  account: { email: string; name: string; role: string } | null;
  /** The last time the server answered a pull. */
  lastPullAt: string | null;
  lastPushAt: string | null;
  pending: number;
  failed: number;
  lastError: string | null;
  /** True once this computer has ever held the bench. */
  hasData: boolean;
  ticketCount: number;
  nextRunAt: number | null;
};

export type OutboxItem = {
  id: number;
  kind: OpKind;
  ticketId: string;
  ticketCode: string;
  detail: string;
  createdAt: string;
  attempts: number;
  state: "pending" | "failed";
  error: string | null;
};

export type OpKind = "create" | "update" | "finance" | "assign" | "photos" | "delete" | "faults";

/* ── Backups ──────────────────────────────────────────────────────────── */

export type BackupInfo = { name: string; path: string; size: number; at: string; reason: string };

/* ── Notifications kept in the app ────────────────────────────────────── */

export type AppNotice = {
  id: number;
  kind: "new_ticket" | "changed" | "sync_failed" | "online" | "offline" | "backup";
  title: string;
  body: string;
  ticketId: string | null;
  at: string;
  read: boolean;
};

/* ── The print agent, reached through the main process ────────────────── */

export type AgentCall = { path: string; method?: "GET" | "POST"; body?: unknown; timeoutMs: number };
export type AgentAnswer =
  | { reached: true; status: number; body: unknown }
  | { reached: false; code: "not_running" | "timeout" | "blocked" | "unsupported"; message: string };
export type AgentInfo = {
  running: boolean;
  /** Started by this app, as opposed to found already running. */
  managed: boolean;
  bundled: boolean;
  version: number | null;
  machine: string | null;
  logPath: string;
};

/* ── The account the desk works as ────────────────────────────────────── */

export type AccountInfo = { email: string; hasPassword: boolean; userId: string | null; name: string | null; role: string | null };

/* ── The API ──────────────────────────────────────────────────────────── */

export type Unsubscribe = () => void;

export type DeskApi = {
  page(params: DeskPageParams): Promise<DeskPageData>;
  onChanged(listener: (version: number) => void): Unsubscribe;

  updateRepair(id: string, patch: RepairPatch): Promise<SectionResult>;
  addRepairPhotos(id: string, urls: string[]): Promise<SectionResult>;
  assignRepair(id: string, holderId: string | null): Promise<DeskResult>;
  updateRepairFinance(id: string, patch: FinancePatch): Promise<DeskResult>;
  createDeskTicket(input: DeskTicketInput): Promise<CreateTicketResult>;
  updateRepairFaults(id: string, input: FaultsInput): Promise<FaultsResult>;
  deleteRecord(input: { kind: RecordKind; id: string; label?: string; reason?: string }): Promise<RecordResult>;
  loadStatusHistory(kind: "order" | "repair" | "trade_in", id: string): Promise<{ available: boolean; events: StatusEvent[] }>;
  loadWorldModels(brandCode: string, locale: string): Promise<WorldModel[]>;
  loadRepairPrintFacts(ticketId: string, locale: string): Promise<PrintFactsResult>;
  /** Keeps photos on this computer and answers with addresses the window can draw. */
  savePhotos(files: { name: string; type: string; bytes: ArrayBuffer }[]): Promise<string[]>;

  syncStatus(): Promise<SyncStatus>;
  onSyncStatus(listener: (status: SyncStatus) => void): Unsubscribe;
  syncNow(): Promise<SyncStatus>;
  outbox(): Promise<OutboxItem[]>;
  retryOp(id: number): Promise<void>;
  discardOp(id: number): Promise<void>;
  redownload(): Promise<void>;

  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  onSettings(listener: (settings: AppSettings) => void): Unsubscribe;
  benches(): Promise<RepairService[]>;

  account(): Promise<AccountInfo>;
  setAccount(input: { email: string; password: string }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** The desk's password (`src/main/desk-lock.ts`). True when it opens the desk. */
  verifyDeskPassword(password: string): Promise<boolean>;
  setDeskPassword(input: { current: string; next: string }): Promise<{ ok: true } | { ok: false; error: "wrong_password" | "weak_password" }>;

  backups(): Promise<BackupInfo[]>;
  backupNow(): Promise<BackupInfo>;
  restoreBackup(name: string): Promise<{ ok: true } | { ok: false; error: string }>;
  importBackup(): Promise<{ ok: true } | { ok: false; error: string }>;
  exportBackup(): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  chooseMirrorFolder(): Promise<string | null>;
  revealBackups(): Promise<void>;

  notices(): Promise<AppNotice[]>;
  onNotice(listener: (notice: AppNotice) => void): Unsubscribe;
  markNoticesRead(ids?: number[]): Promise<void>;
  clearNotices(): Promise<void>;

  agent(call: AgentCall): Promise<AgentAnswer>;
  agentInfo(): Promise<AgentInfo>;
  restartAgent(): Promise<AgentInfo>;

  onOpenTicket(listener: (ticketId: string) => void): Unsubscribe;

  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    /**
     * The theme for Windows' caption buttons, and — while something has dimmed
     * the page's title bar — the shade it dimmed to (`#rrggbb`), so the buttons
     * dim with it. `tint: null` puts them back on the theme's own colours.
     */
    setChrome(input: { dark: boolean; tint?: { color: string; symbol: string } | null }): void;
    onMaximized(listener: (maximized: boolean) => void): Unsubscribe;
  };
  app: {
    info(): Promise<{ version: string; electron: string; dataPath: string; platform: string }>;
    openExternal(url: string): Promise<void>;
    openLogs(): Promise<void>;
    relaunch(): Promise<void>;
  };
};

/** Every channel, so main and preload cannot disagree about a name. */
export const CH = {
  page: "desk:page",
  changed: "desk:changed",
  updateRepair: "desk:updateRepair",
  addRepairPhotos: "desk:addRepairPhotos",
  assignRepair: "desk:assignRepair",
  updateRepairFinance: "desk:updateRepairFinance",
  createDeskTicket: "desk:createDeskTicket",
  updateRepairFaults: "desk:updateRepairFaults",
  deleteRecord: "desk:deleteRecord",
  loadStatusHistory: "desk:loadStatusHistory",
  loadWorldModels: "desk:loadWorldModels",
  loadRepairPrintFacts: "desk:loadRepairPrintFacts",
  savePhotos: "desk:savePhotos",
  syncStatus: "sync:status",
  syncStatusEvent: "sync:status:event",
  syncNow: "sync:now",
  outbox: "sync:outbox",
  retryOp: "sync:retry",
  discardOp: "sync:discard",
  redownload: "sync:redownload",
  getSettings: "settings:get",
  setSettings: "settings:set",
  settingsEvent: "settings:event",
  benches: "settings:benches",
  account: "account:get",
  setAccount: "account:set",
  verifyDeskPassword: "lock:verify",
  setDeskPassword: "lock:set",
  backups: "backup:list",
  backupNow: "backup:now",
  restoreBackup: "backup:restore",
  importBackup: "backup:import",
  exportBackup: "backup:export",
  chooseMirrorFolder: "backup:mirror",
  revealBackups: "backup:reveal",
  notices: "notice:list",
  noticeEvent: "notice:event",
  markNoticesRead: "notice:read",
  clearNotices: "notice:clear",
  agent: "print:agent",
  agentInfo: "print:agentInfo",
  restartAgent: "print:restartAgent",
  openTicket: "app:openTicket",
  winMinimize: "win:minimize",
  winToggleMaximize: "win:toggleMaximize",
  winClose: "win:close",
  winChrome: "win:chrome",
  winMaximized: "win:maximized",
  appInfo: "app:info",
  openExternal: "app:openExternal",
  openLogs: "app:openLogs",
  relaunch: "app:relaunch",
} as const;
