import type { AppSettings } from "../../shared/contract";
import { alignLocale } from "./router";
import { setChromeTheme } from "./chrome-tint";
import { readSettings, settingsStore } from "./settings";

/**
 * The settings, applied to the document — the language, the direction, the
 * theme, the text size, the motion.
 *
 * ---------------------------------------------------------------------------
 * The same switches the site flips, on the same element
 * ---------------------------------------------------------------------------
 * The dashboard's whole palette hangs off one class: `.dark` on `<html>`
 * re-themes every token (`globals.css`), so a theme change here is one class
 * and nothing else — no component is told. `color-scheme` is written with it,
 * for the reason `viewport.colorScheme` is load-bearing on the site: form
 * controls, scrollbars and the date picker follow it, and Chromium's own
 * Auto Dark Theme repaints a page that does not declare one.
 *
 * ⚠️ The text size is written as an inline `font-size` on `<html>`, and that
 * is the only way to do it that keeps the dashboard's proportions. The site
 * sets `html { font-size: 95% }` and sizes everything in rem, so scaling the
 * root scales the board, the dialogs and the papers' previews together — and
 * an inline style outranks the stylesheet's `@layer base` rule without
 * editing a copied file.
 *
 * The title bar's buttons are Windows', painted by the main process; they are
 * told the theme too (`setChrome`), or a dark desk would wear a white strip of
 * minimise / maximise / close in its top corner.
 */
const DARK_QUERY = window.matchMedia("(prefers-color-scheme: dark)");

function resolvedDark(settings: AppSettings) {
  return settings.theme === "dark" || (settings.theme === "system" && DARK_QUERY.matches);
}

let applied: { locale: string; dark: boolean } | null = null;

export function applyAppearance(settings: AppSettings = readSettings()) {
  const root = document.documentElement;
  const dark = resolvedDark(settings);

  root.lang = settings.locale;
  root.dir = settings.locale === "ar" ? "rtl" : "ltr";
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  root.style.fontSize = `${(95 * settings.fontScale).toFixed(2)}%`;
  root.classList.toggle("desk-reduce-motion", settings.reduceMotion);
  document.title = settings.locale === "ar" ? "صيانة الاسناد" : "Al-Esnad Maintenance";

  // The caption buttons follow the theme *and* whatever is dimming the bar —
  // see `lib/chrome-tint.ts`. Re-sent on every apply, because the bar's own
  // colour is what a tint is measured against.
  setChromeTheme(dark);
  if (applied && applied.locale !== settings.locale) alignLocale(settings.locale);
  applied = { locale: settings.locale, dark };
  // Last, so the page starts painting its own canvas only once it is the
  // right one — see `desk-ready` in `app.css`.
  root.classList.add("desk-ready");
}

/** Installed once, by `main.tsx`. Re-applies whenever a setting or the system theme changes. */
export function startAppearance(): () => void {
  applyAppearance();
  const offSettings = settingsStore.subscribe(() => applyAppearance());
  const onSystem = () => applyAppearance();
  DARK_QUERY.addEventListener("change", onSystem);
  return () => {
    offSettings();
    DARK_QUERY.removeEventListener("change", onSystem);
  };
}

/** For the theme switch in the title bar: what pressing it should move to. */
export function isDark(settings: AppSettings): boolean {
  return resolvedDark(settings);
}
