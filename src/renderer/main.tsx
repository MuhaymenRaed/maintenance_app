import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import { App } from "./app/app";
import { startAppearance } from "./lib/appearance";
import { startChromeTint } from "./lib/chrome-tint";
import { watchDeskChanges } from "./lib/desk-data";
import { watchNotices } from "./lib/notices";
import { startRouter } from "./lib/router";
import { primeSettings, watchSettings } from "./lib/settings";
import { watchSync } from "./lib/sync";

/**
 * The window starts here, in a fixed order.
 *
 * 1. **The settings, before anything is drawn.** Every store and every copied
 *    component reads the language, the theme and the text size synchronously,
 *    so the first frame must already know them — a board drawn in English and
 *    re-drawn in Arabic a moment later is the one start-up nobody forgets.
 * 2. **The appearance**, which writes them onto `<html>` and only then lets
 *    the page paint its own background (`desk-ready` in `app.css`).
 * 3. **The listeners** — the router's, and the four streams from the main
 *    process — before React mounts, so no event can arrive between the first
 *    render and the subscription and be lost.
 */
async function start() {
  primeSettings(await window.desk.getSettings());
  startAppearance();
  startChromeTint();
  watchSettings();
  startRouter();
  watchSync();
  watchNotices();
  watchDeskChanges();

  const root = document.getElementById("root");
  if (!root) throw new Error("#root is missing from index.html");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
