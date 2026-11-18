import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CH, type DeskApi } from "../shared/contract";

/**
 * `window.desk` — the window's only way out.
 *
 * Built from the shared contract, channel by channel. Nothing here does any
 * work; it forwards. The window runs sandboxed with no Node, so a bug — or a
 * page somebody managed to load — can ask the main process questions through
 * this list and nothing else.
 */
const invoke =
  <A extends unknown[], R>(channel: string) =>
  (...args: A) =>
    ipcRenderer.invoke(channel, ...args) as Promise<R>;

function listen<T>(channel: string, listener: (payload: T) => void) {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: DeskApi = {
  page: invoke(CH.page),
  onChanged: (listener) => listen(CH.changed, listener),

  updateRepair: invoke(CH.updateRepair),
  addRepairPhotos: invoke(CH.addRepairPhotos),
  assignRepair: invoke(CH.assignRepair),
  updateRepairFinance: invoke(CH.updateRepairFinance),
  createDeskTicket: invoke(CH.createDeskTicket),
  updateRepairFaults: invoke(CH.updateRepairFaults),
  editRepairIssue: invoke(CH.editRepairIssue),
  deleteRecord: invoke(CH.deleteRecord),
  loadStatusHistory: invoke(CH.loadStatusHistory),
  loadWorldModels: invoke(CH.loadWorldModels),
  loadRepairPrintFacts: invoke(CH.loadRepairPrintFacts),
  savePhotos: invoke(CH.savePhotos),

  syncStatus: invoke(CH.syncStatus),
  onSyncStatus: (listener) => listen(CH.syncStatusEvent, listener),
  syncNow: invoke(CH.syncNow),
  outbox: invoke(CH.outbox),
  retryOp: invoke(CH.retryOp),
  discardOp: invoke(CH.discardOp),
  redownload: invoke(CH.redownload),

  getSettings: invoke(CH.getSettings),
  setSettings: invoke(CH.setSettings),
  onSettings: (listener) => listen(CH.settingsEvent, listener),
  benches: invoke(CH.benches),

  account: invoke(CH.account),
  setAccount: invoke(CH.setAccount),
  verifyDeskPassword: invoke(CH.verifyDeskPassword),
  setDeskPassword: invoke(CH.setDeskPassword),

  backups: invoke(CH.backups),
  backupNow: invoke(CH.backupNow),
  restoreBackup: invoke(CH.restoreBackup),
  importBackup: invoke(CH.importBackup),
  exportBackup: invoke(CH.exportBackup),
  chooseMirrorFolder: invoke(CH.chooseMirrorFolder),
  revealBackups: invoke(CH.revealBackups),

  notices: invoke(CH.notices),
  onNotice: (listener) => listen(CH.noticeEvent, listener),
  markNoticesRead: invoke(CH.markNoticesRead),
  clearNotices: invoke(CH.clearNotices),

  agent: invoke(CH.agent),
  agentInfo: invoke(CH.agentInfo),
  restartAgent: invoke(CH.restartAgent),

  onOpenTicket: (listener) => listen(CH.openTicket, listener),

  window: {
    minimize: () => ipcRenderer.send(CH.winMinimize),
    toggleMaximize: () => ipcRenderer.send(CH.winToggleMaximize),
    close: () => ipcRenderer.send(CH.winClose),
    setChrome: (input) => ipcRenderer.send(CH.winChrome, input),
    onMaximized: (listener) => listen(CH.winMaximized, listener),
  },
  app: {
    info: invoke(CH.appInfo),
    openExternal: invoke(CH.openExternal),
    openLogs: invoke(CH.openLogs),
    relaunch: invoke(CH.relaunch),
  },
};

contextBridge.exposeInMainWorld("desk", api);
