import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, nativeTheme, screen, shell } from "electron";
import { CH } from "../shared/contract";
import { getSettings } from "./settings";
import { paths, SCHEME } from "./config";

/**
 * The one window.
 *
 * Its title bar is the app's own header — the dashboard's brand lockup, the
 * sync status, the bell and the switches — drawn by the page, with Windows'
 * own minimise / maximise / close buttons laid over its corner
 * (`titleBarOverlay`). The overlay is repainted with the page's theme, so the
 * buttons never sit on a strip of the wrong colour.
 */

/**
 * The dashboard's own palette, copied from `src/site/globals.css`:
 * `color` is `--surface` (the header the buttons sit on), `background` is
 * `--canvas` (what the window shows before the page has painted).
 *
 * ⚠️ They must be the tokens exactly. The page leaves its own background
 * transparent until the theme is applied (`desk-ready` in `app.css`), so the
 * first frame is this colour; a value a few points off is a visible step the
 * moment the page takes over.
 */
const CHROME = {
  light: { color: "#ffffff", symbolColor: "#333333", background: "#f5f5f6" },
  dark: { color: "#202024", symbolColor: "#ededed", background: "#161618" },
};

export const TITLEBAR_HEIGHT = 56;

type Bounds = { x?: number; y?: number; width: number; height: number; maximized: boolean };

function boundsFile() {
  return path.join(app.getPath("userData"), "window.json");
}

function savedBounds(): Bounds {
  try {
    const bounds = JSON.parse(fs.readFileSync(boundsFile(), "utf8")) as Bounds;
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return bounds.x === undefined || (bounds.x! >= area.x - 50 && bounds.y! >= area.y - 50 && bounds.x! < area.x + area.width && bounds.y! < area.y + area.height);
    });
    if (visible && bounds.width >= 900 && bounds.height >= 600) return bounds;
  } catch {
    // First run.
  }
  return { width: 1380, height: 880, maximized: false };
}

function keepBounds(window: BrowserWindow) {
  const save = () => {
    if (window.isDestroyed()) return;
    const normal = window.getNormalBounds();
    fs.writeFileSync(boundsFile(), JSON.stringify({ ...normal, maximized: window.isMaximized() }));
  };
  window.on("resized", save);
  window.on("moved", save);
  window.on("maximize", save);
  window.on("unmaximize", save);
}

export function isDark(): boolean {
  const theme = getSettings().theme;
  return theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Paints Windows' caption buttons to match the page under them.
 *
 * `tint` is what the page measured when something has dimmed its title bar —
 * a confirm dialog's scrim, the photo viewer. Windows draws those three
 * buttons itself, above the page, so no scrim of the page's can reach them:
 * left alone they stay a bright white box in the corner of a dimmed window,
 * which is exactly what was reported as "weird fading". The page works out
 * the shade its own bar has become and hands it here.
 */
export function setChrome(window: BrowserWindow, dark: boolean, tint?: { color: string; symbol: string } | null) {
  const palette = dark ? CHROME.dark : CHROME.light;
  window.setBackgroundColor(palette.background);
  if (process.platform === "win32") {
    const valid = tint && HEX.test(tint.color) && HEX.test(tint.symbol);
    window.setTitleBarOverlay({
      color: valid ? tint.color : palette.color,
      symbolColor: valid ? tint.symbol : palette.symbolColor,
      height: TITLEBAR_HEIGHT,
    });
  }
}

/** Where the page is served from: the dev server, or the app's own scheme. */
export function rendererUrl(route: string) {
  const dev = process.env.ELECTRON_RENDERER_URL;
  return dev ? `${dev.replace(/\/+$/, "")}${route}` : `${SCHEME}://desk${route}`;
}

export function createWindow(): BrowserWindow {
  const bounds = savedBounds();
  const dark = isDark();
  const palette = dark ? CHROME.dark : CHROME.light;
  const window = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: getSettings().locale === "ar" ? "صيانة الاسناد" : "Al-Esnad Maintenance",
    icon: fs.existsSync(paths.icon) ? paths.icon : undefined,
    backgroundColor: palette.background,
    titleBarStyle: "hidden",
    titleBarOverlay:
      process.platform === "win32" ? { color: palette.color, symbolColor: palette.symbolColor, height: TITLEBAR_HEIGHT } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (bounds.maximized) window.maximize();
  keepBounds(window);

  // Links out of the app — WhatsApp, a phone number, the dashboard — open in
  // the system's own browser or dialler, never inside the desk.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:|tel:|whatsapp:)/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    const own = target.protocol === `${SCHEME}:` || url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "\u0000");
    if (!own) {
      event.preventDefault();
      if (/^(https?:|mailto:|tel:)/i.test(url)) void shell.openExternal(url);
    }
  });

  window.on("maximize", () => window.webContents.send(CH.winMaximized, true));
  window.on("unmaximize", () => window.webContents.send(CH.winMaximized, false));

  void window.loadURL(rendererUrl(`/${getSettings().locale}/admin/repairs`));
  return window;
}
