import { app, BrowserWindow, ipcMain, shell } from "electron";
import { canWith } from "../site/lib/permissions.ts";
import type { RepairService } from "../site/lib/data/repair-desk.ts";
import { CH, type AccountInfo, type AgentCall, type AppSettings, type OutboxItem } from "../shared/contract";
import type { DeskPageParams } from "../shared/desk-types";
import { store } from "./db/store";
import { paths } from "./config";
import { deskPage } from "./desk/board";
import * as actions from "./desk/actions";
import { describeOp, type AnyOp } from "./desk/raw";
import { refs } from "./desk/refs";
import { getAccount, getSettings, saveAccount, setSettings, settingsEvents } from "./settings";
import { sync } from "./sync/engine";
import { signOutLocally, testAccount } from "./sync/client";
import { noticeEvents } from "./notify";
import * as backups from "./backup";
import { agentInfo, callAgent, restartAgent } from "./print-agent";
import { logFile } from "./log";
import { setChrome } from "./window";

/**
 * Every call the window can make, bound to its handler — and every event the
 * window listens for, forwarded from the part of the app that raises it.
 * The names come from `CH` in the shared contract, so the preload script and
 * this file cannot disagree about one.
 */
export function registerIpc() {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
    ipcMain.handle(channel, (_event, ...args) => fn(...(args as A)));

  handle(CH.page, (params: DeskPageParams) => deskPage(params, getSettings().service));
  handle(CH.updateRepair, actions.updateRepair);
  handle(CH.addRepairPhotos, actions.addRepairPhotos);
  handle(CH.assignRepair, actions.assignRepair);
  handle(CH.updateRepairFinance, actions.updateRepairFinance);
  handle(CH.createDeskTicket, actions.createDeskTicket);
  handle(CH.updateRepairFaults, actions.updateRepairFaults);
  handle(CH.deleteRecord, actions.deleteRecord);
  handle(CH.loadStatusHistory, actions.loadStatusHistory);
  handle(CH.loadWorldModels, (brand: string) => actions.loadWorldModels(brand));
  handle(CH.loadRepairPrintFacts, actions.loadRepairPrintFacts);
  handle(CH.savePhotos, actions.savePhotos);

  handle(CH.syncStatus, () => sync.status);
  handle(CH.syncNow, () => sync.now());
  handle(CH.outbox, (): OutboxItem[] =>
    store.ops.map((op) => ({
      id: op.id,
      kind: op.kind,
      ticketId: op.ticketId,
      ticketCode: store.tickets.get(op.ticketId)?.raw.code ?? "",
      detail: describeOp({ kind: op.kind, payload: op.payload } as AnyOp),
      createdAt: op.createdAt,
      attempts: op.attempts,
      state: op.state,
      error: op.error,
    })),
  );
  handle(CH.retryOp, (id: number) => {
    store.opRetry(id);
    store.bump();
    sync.refreshCounts();
    sync.kick(0);
  });
  handle(CH.discardOp, (id: number) => {
    store.opDiscard(id);
    store.bump();
    sync.refreshCounts();
  });
  handle(CH.redownload, async () => {
    store.forgetServerCopy();
    store.bump();
    await sync.now();
  });

  handle(CH.getSettings, () => getSettings());
  handle(CH.setSettings, (patch: Partial<AppSettings>) => setSettings(patch));
  handle(CH.benches, (): RepairService[] => {
    const viewer = refs.viewer();
    if (!viewer) return ["hardware"];
    const out: RepairService[] = [];
    if (canWith(viewer.role, viewer.grant, "repairs.write")) out.push("hardware");
    if (canWith(viewer.role, viewer.grant, "programming.write")) out.push("software");
    return out.length ? out : ["hardware"];
  });

  handle(CH.account, (): AccountInfo => {
    const account = getAccount();
    const viewer = refs.viewer();
    return {
      email: account.email,
      hasPassword: Boolean(account.password),
      userId: viewer?.id ?? null,
      name: viewer?.name ?? null,
      role: viewer?.role ?? null,
    };
  });
  handle(CH.setAccount, async (input: { email: string; password: string }) => {
    const email = input.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !input.password) return { ok: false as const, error: "invalid_credentials" };
    const tested = await testAccount(email, input.password);
    if (!tested.ok) return tested;
    await saveAccount({ email, password: input.password });
    await signOutLocally();
    sync.accountChanged();
    return { ok: true as const };
  });

  handle(CH.backups, () => backups.listBackups());
  handle(CH.backupNow, () => backups.backupNow("manual"));
  handle(CH.restoreBackup, backups.restoreBackup);
  handle(CH.importBackup, backups.importBackup);
  handle(CH.exportBackup, backups.exportBackup);
  handle(CH.chooseMirrorFolder, backups.chooseMirrorFolder);
  handle(CH.revealBackups, backups.revealBackups);

  handle(CH.notices, () => store.notices());
  handle(CH.markNoticesRead, (ids?: number[]) => store.markNoticesRead(ids));
  handle(CH.clearNotices, () => store.clearNotices());

  handle(CH.agent, (call: AgentCall) => callAgent(call));
  handle(CH.agentInfo, () => agentInfo());
  handle(CH.restartAgent, () => restartAgent());

  handle(CH.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    dataPath: app.getPath("userData"),
    platform: process.platform,
  }));
  handle(CH.openExternal, async (url: string) => {
    if (/^(https?:|mailto:|tel:)/i.test(url)) await shell.openExternal(url);
  });
  handle(CH.openLogs, async () => {
    void logFile();
    await shell.openPath(paths.logs);
  });
  handle(CH.relaunch, () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.on(CH.winMinimize, (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on(CH.winToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.on(CH.winClose, (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.on(CH.winChrome, (event, input: { dark: boolean; tint?: { color: string; symbol: string } | null }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) setChrome(window, Boolean(input?.dark), input?.tint ?? null);
  });

  /* ── Events out to every window ────────────────────────────────────── */

  const broadcast = (channel: string, payload: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    }
  };

  // Several changes in one sync pass become one redraw.
  let pending: NodeJS.Timeout | null = null;
  store.events.on("changed", (version: number) => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      broadcast(CH.changed, version);
    }, 60);
  });
  sync.on("status", (status) => broadcast(CH.syncStatusEvent, status));
  settingsEvents.on("change", (settings) => {
    broadcast(CH.settingsEvent, settings);
    store.bump();
  });
  noticeEvents.on("notice", (notice) => broadcast(CH.noticeEvent, notice));
  // ⚠️ "open" is NOT forwarded here: main.ts answers it, because it must also
  // bring the window forward first. Sending it from both opened the ticket twice.
}
