import { BrowserWindow, Notification } from "electron";
import { EventEmitter } from "node:events";
import type { AppNotice } from "../shared/contract";
import { store } from "./db/store";
import { getSettings } from "./settings";
import { paths } from "./config";

/**
 * The app's notifications: kept in its own list (the bell in the title bar)
 * and, when the window is not in front of somebody, raised as a Windows
 * notification — pressing it brings the desk forward on that ticket.
 *
 * When the window *is* in front, the window shows it itself (a toast and a
 * chime), because a system notification over the app you are looking at is
 * the computer telling you twice.
 */
export const noticeEvents = new EventEmitter();

export type NoticeKind = AppNotice["kind"];

export function raise(kind: NoticeKind, title: string, body: string, ticketId: string | null = null) {
  const settings = getSettings();
  const allowed =
    (kind === "new_ticket" && settings.notifyNewTickets) ||
    (kind === "changed" && settings.notifyChanges) ||
    (kind === "sync_failed" && settings.notifySyncProblems) ||
    ((kind === "online" || kind === "offline") && settings.notifyConnection) ||
    kind === "backup";
  if (!allowed) return;

  const saved = store.addNotice(kind, title, body, ticketId);
  const notice: AppNotice = { ...saved, kind };
  noticeEvents.emit("notice", notice);

  const window = BrowserWindow.getAllWindows()[0];
  const inFront = window && window.isVisible() && !window.isMinimized() && window.isFocused();
  if (inFront || !Notification.isSupported()) return;

  const system = new Notification({
    title,
    body,
    silent: !settings.notifySound,
    icon: paths.icon,
  });
  system.on("click", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (ticketId) noticeEvents.emit("open", ticketId);
  });
  system.show();
}
