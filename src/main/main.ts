import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, net, protocol, Tray } from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { APP_ID, paths, PHOTO_SCHEME, SCHEME } from "./config";
import { store } from "./db/store";
import { registerIpc } from "./ipc";
import { sync } from "./sync/engine";
import { backupNow, scheduleBackups } from "./backup";
import { warmAgent } from "./print-agent";
import { applyLoginItem, getSettings, settingsEvents } from "./settings";
import { createWindow, isDark, setChrome } from "./window";
import { noticeEvents } from "./notify";
import { words } from "./i18n";
import { logger } from "./log";
import { CH } from "../shared/contract";

const log = logger("app");

if (squirrelStartup) app.quit();

// The VS Code terminal sets this for its own children; inherited, it would
// start Electron as plain Node and the window would never open.
delete process.env.ELECTRON_RUN_AS_NODE;

app.setAppUserModelId(APP_ID);
app.setName("Al-Esnad Maintenance");

// The queue toolbar's date fields are `<input type="date">`, which Chromium
// formats in the *application's* locale — on most counter PCs that is en-US,
// so the range read mm/dd/yyyy beside a board whose every date is dd/mm/yyyy
// (the dashboard's own rule: `en-GB` for the all-numeric form, in both
// languages). Every date the desk *writes* passes its locale explicitly, so
// this changes nothing but those fields.
app.commandLine.appendSwitch("lang", "en-GB");

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: PHOTO_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const RENDERER = path.join(__dirname, "../renderer");

/**
 * What the built page may load.
 *
 * Scripts and styles are the app's own files; `'unsafe-inline'` for styles
 * only, because React writes `style=""` attributes and the toaster injects a
 * `<style>` tag. Pictures may come from anywhere over https — a ticket's
 * photos live on the shop's image host, a staff avatar on Google's — and from
 * `desk-photo:`, the photos taken here and not yet uploaded. Nothing in the
 * window talks to the network itself: the database, the uploads and the print
 * agent are all reached through the main process, which is why `connect-src`
 * is the page's own origin and the inline data the print station draws with.
 *
 * Sent as a header on the HTML only, from here, so the dev server — whose
 * hot-reload preamble is an inline script — is not held to it.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${PHOTO_SCHEME}:`,
  "font-src 'self' data:",
  `connect-src 'self' data: blob: ${PHOTO_SCHEME}:`,
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The built file a request names, however deep the route it was made from.
 *
 * ⚠️ electron-vite forces the renderer's `base` to `./` in production (and
 * warns if it is changed), so the page asks for `./assets/index-x.js` — which,
 * from a window sitting on `app://desk/ar/admin/repairs`, arrives here as
 * `/ar/admin/assets/index-x.js`. Every suffix of the path is tried against the
 * build folder, longest first, so that resolves to `assets/index-x.js`; a route
 * matches no file at all and falls through to `index.html`, the router's.
 */
function locate(relative: string): string | null {
  const segments = relative.split("/").filter(Boolean);
  for (let start = 0; start < segments.length; start++) {
    const candidate = path.normalize(path.join(RENDERER, ...segments.slice(start)));
    // `+ path.sep`, or a sibling folder named `renderer-anything` would pass.
    if (candidate !== RENDERER && !candidate.startsWith(RENDERER + path.sep)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** `app://desk/...` — the built page, with every unknown path answered by `index.html` (the router's). */
function serveRenderer() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = locate(relative) ?? path.join(RENDERER, "index.html");
    const response = await net.fetch(pathToFileURL(file).toString());
    if (!file.endsWith(".html")) return response;
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", CSP);
    return new Response(response.body, { status: response.status, headers });
  });
}

/** `desk-photo://local/<name>` — a photo taken at the desk, kept here until it is uploaded. */
function servePhotos() {
  protocol.handle(PHOTO_SCHEME, (request) => {
    const url = new URL(request.url);
    const file = path.join(paths.photos, path.basename(decodeURIComponent(url.pathname)));
    if (!fs.existsSync(file)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function show() {
  if (!window || window.isDestroyed()) {
    window = createWindow();
    window.once("ready-to-show", () => window?.show());
    attachClose(window);
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function attachClose(target: BrowserWindow) {
  target.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    // Hidden in the tray, the desk keeps syncing and keeps announcing new
    // bookings; otherwise closing the window is quitting the app.
    if (getSettings().closeToTray && tray) target.hide();
    else app.quit();
  });
}

function trayIcon() {
  const icon = fs.existsSync(paths.icon) ? nativeImage.createFromPath(paths.icon) : nativeImage.createEmpty();
  return icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 });
}

function buildTray() {
  const w = words();
  const status = sync.status;
  const menu = Menu.buildFromTemplate([
    { label: w.trayOpen, click: () => show() },
    { type: "separator" },
    { label: status.online ? w.trayOnline : w.trayOffline, enabled: false },
    ...(status.pending ? [{ label: w.trayPending(status.pending), enabled: false }] : []),
    { label: w.traySync, click: () => void sync.now() },
    { type: "separator" },
    // ⚠️ Not `quitting = true` first: `before-quit` is where unsent changes are
    // warned about, and it returns early once `quitting` is set. With the
    // window closed to the tray this menu is the only way out, so setting the
    // flag here skipped the warning for exactly the commonest quit.
    { label: w.trayQuit, click: () => app.quit() },
  ]);
  if (!tray) {
    tray = new Tray(trayIcon());
    tray.on("click", () => show());
  }
  tray.setToolTip(`${w.appName} — ${status.online ? w.trayOnline : w.trayOffline}`);
  tray.setContextMenu(menu);
}

app.on("second-instance", () => show());

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  try {
    store.open(paths.database);
  } catch (error) {
    // A file that cannot be opened is kept, renamed, for whoever looks at it
    // later; the desk starts on a fresh one and downloads the bench again.
    const aside = `${paths.database}.damaged-${Date.now()}`;
    log.error(`could not open the database; moved it to ${aside}`, error);
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(paths.database + suffix)) fs.renameSync(paths.database + suffix, aside + suffix);
    }
    store.open(paths.database);
  }
  registerIpc();
  serveRenderer();
  servePhotos();
  applyLoginItem();

  const hidden = process.argv.includes("--hidden") || (getSettings().startMinimized && app.getLoginItemSettings().wasOpenedAtLogin);
  window = createWindow();
  attachClose(window);
  window.once("ready-to-show", () => {
    if (!hidden) window?.show();
  });

  buildTray();
  sync.on("status", () => buildTray());
  settingsEvents.on("change", () => {
    buildTray();
    if (window && !window.isDestroyed()) setChrome(window, isDark());
  });
  nativeTheme.on("updated", () => {
    if (window && !window.isDestroyed() && getSettings().theme === "system") setChrome(window, isDark());
  });
  noticeEvents.on("open", (ticketId: string) => {
    show();
    window?.webContents.send(CH.openTicket, ticketId);
  });

  sync.start();
  scheduleBackups();
  warmAgent();
  log.info(`started ${app.getVersion()} (${process.versions.electron})`);
});

app.on("before-quit", (event) => {
  if (quitting) return;
  const pending = store.ops.filter((op) => op.state === "pending").length;
  if (pending > 0) {
    const w = words();
    const options = {
      type: "warning" as const,
      title: w.quitPendingTitle,
      message: w.quitPendingTitle,
      detail: w.quitPendingBody(pending),
      buttons: [w.quitAnyway, w.stay],
      defaultId: 1,
      cancelId: 1,
    };
    // A dialog parented to a window hidden in the tray is modal to something
    // nobody can see; unparented, it comes up in front on its own.
    const parent = window && !window.isDestroyed() && window.isVisible() ? window : null;
    const answer = parent ? dialog.showMessageBoxSync(parent, options) : dialog.showMessageBoxSync(options);
    if (answer === 1) {
      event.preventDefault();
      return;
    }
  }
  quitting = true;
});

app.on("will-quit", () => {
  try {
    if (getSettings().backupOnQuit) backupNow("quit");
  } catch (error) {
    log.error("backup on quit failed", error);
  }
  store.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !tray) app.quit();
});

app.on("activate", () => show());
