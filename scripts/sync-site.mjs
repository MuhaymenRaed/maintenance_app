#!/usr/bin/env node
/**
 * Copies the repair desk's own code out of the site into `src/site/`.
 *
 * The desktop app draws the board, the ticket dialog, the papers, the print
 * station and the printer setup with the dashboard's components, unchanged.
 * This script is what keeps them unchanged: it walks the real import graph
 * from the entry files below and copies every module it reaches, stopping at
 * the ones the app replaces (`OVERRIDES` — the server actions, the server
 * queries, the print agent's transport and the Next.js routing). Those live
 * in `src/renderer/overrides/` at the same `@/` path, and both Vite and
 * TypeScript look there first.
 *
 * Run it after the dashboard's repair section changes:
 *
 *   npm run sync:site               # site at ../../Next JS/Al_Isnad
 *   SITE_DIR=/path/to/site npm run sync:site
 *
 * It rewrites `src/site/` from scratch every time, so a file the dashboard
 * stopped using stops being shipped. Never edit `src/site/` by hand: the next
 * sync throws the edit away. Change the site, or add an override.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.resolve(process.env.SITE_DIR ?? path.join(APP, "..", "..", "Next JS", "Al_Isnad"));
const OUT = path.join(APP, "src", "site");

if (!fs.existsSync(path.join(SITE, "lib", "data", "repair-desk.ts"))) {
  console.error(`The site was not found at ${SITE}. Set SITE_DIR to its folder.`);
  process.exit(1);
}

/** What the app draws or computes with, straight from the site. */
const ENTRIES = [
  // The bench itself — its two panels, drawn by the site's own view.
  "components/admin/repair-desk-view.tsx",
  // The desk's password prompt; the app switches it on in `app.tsx`.
  "components/admin/desk-gate.tsx",
  "components/admin/repairs-board.tsx",
  "components/admin/desk-ticket.tsx",
  "components/admin/filter-chips.tsx",
  "components/admin/queue-toolbar.tsx",
  "components/admin/stat-detail.tsx",
  "components/admin/printer-setup.tsx",
  "components/admin/print-station.tsx",
  "components/admin/repair-print.tsx",
  "components/store/brand-logo.tsx",
  "components/ui/glass-control.ts",
  "components/ui/confirm-dialog.tsx",
  "lib/data/repair-desk.ts",
  // Which tickets each card counts, and on which day its money came in —
  // `src/main/desk/board.ts` runs it over this computer's copy.
  "lib/data/desk-figures.ts",
  "lib/data/repair-print-facts.ts",
  "lib/data/orders.ts",
  "lib/data/queue-window.ts",
  "lib/data/date-window.ts",
  "lib/data/datetime.ts",
  "lib/data/stat-money.ts",
  "lib/data/device-name.ts",
  "lib/data/device-catalogue.ts",
  "lib/data/whatsapp.ts",
  "lib/permissions.ts",
  "lib/format.ts",
  "lib/utils.ts",
  "lib/print/station.ts",
  "lib/print/station-settings.ts",
  "lib/print/station-store.ts",
];

/**
 * Modules the app supplies itself. The walk stops here — nothing behind a
 * server action is ever copied, so no Supabase server client, no R2 secret and
 * no `next/headers` can reach the desktop bundle.
 */
const OVERRIDES = new Set([
  "lib/actions/sections.ts",
  "lib/actions/repair-desk.ts",
  "lib/actions/records.ts",
  "lib/actions/status-history.ts",
  "lib/actions/device-models.ts",
  "lib/actions/print-station.ts",
  "lib/actions/upload.ts",
  "lib/queries/repair-desk.ts",
  "lib/queries/status-steps.ts",
  "lib/queries/admin-sections.ts",
  "lib/r2.ts",
  "lib/upload.ts",
  "lib/print/agent-client.ts",
  "i18n/navigation.ts",
]);

/**
 * The dashboard's stylesheet, whole — every token, the dark palette, the
 * cursor, the scrollbars, `data-numeric`, `[data-range]`, the dialog motion.
 * The app's own `src/renderer/app.css` imports it and adds only what a window
 * needs that a page does not (the title bar, the fonts `next/font` used to
 * declare). Copied rather than re-written for the reason the components are:
 * two stylesheets that are supposed to look the same drift the first week.
 */
const STYLES = [["app/globals.css", "globals.css"]];

/** Assets the copied components and stylesheet reference by URL. */
const PUBLIC_DIRS = [
  ["public/cursor", "public/cursor"],
  ["public/print", "public/print"],
];
const FONTS = ["app/fonts/expo-arabic-400.woff", "app/fonts/expo-arabic-500.woff", "app/fonts/expo-arabic-600.woff", "app/fonts/expo-arabic-700.woff"];

const EXTS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
const rel = (abs) => path.relative(SITE, abs).split(path.sep).join("/");

function resolve(spec, from) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SITE, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Cannot resolve ${spec} from ${rel(from)}`);
}

/** Comments out first, so an import named inside a paragraph is not followed. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const copied = new Set();
const packages = new Set();

function walk(abs) {
  const key = rel(abs);
  if (copied.has(key) || OVERRIDES.has(key)) return;
  copied.add(key);
  const src = fs.readFileSync(abs, "utf8");
  for (const match of code(src).matchAll(IMPORT)) {
    const spec = match[1] ?? match[2];
    const target = resolve(spec, abs);
    if (target === null) {
      packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
      continue;
    }
    walk(target);
  }
}

for (const entry of ENTRIES) walk(path.join(SITE, entry));

fs.rmSync(OUT, { recursive: true, force: true });
for (const file of [...copied].sort()) {
  const target = path.join(OUT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(SITE, file), target);
}

// The whole message catalogue — the desk reads Admin, Track, Picker, Roles,
// Brand and Store, and the shared components reach into a few more.
fs.mkdirSync(path.join(OUT, "messages"), { recursive: true });
for (const locale of ["ar", "en"]) {
  fs.copyFileSync(path.join(SITE, "messages", `${locale}.json`), path.join(OUT, "messages", `${locale}.json`));
}

for (const [from, to] of STYLES) {
  fs.copyFileSync(path.join(SITE, from), path.join(OUT, to));
}

for (const [from, to] of PUBLIC_DIRS) {
  const source = path.join(SITE, from);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, path.join(APP, to), { recursive: true });
}
fs.mkdirSync(path.join(APP, "public", "fonts"), { recursive: true });
for (const font of FONTS) fs.copyFileSync(path.join(SITE, font), path.join(APP, "public", "fonts", path.basename(font)));

// The print agent the app starts when none is running on this PC.
fs.cpSync(path.join(SITE, "tools", "print-agent"), path.join(APP, "resources", "print-agent"), { recursive: true });

const stamp = {
  site: SITE,
  syncedAt: new Date().toISOString(),
  files: [...copied].sort(),
  packages: [...packages].sort(),
};
fs.writeFileSync(path.join(OUT, "SYNCED.json"), JSON.stringify(stamp, null, 2) + "\n");

console.log(`Copied ${copied.size} modules from ${SITE}`);
console.log(`Packages they import: ${stamp.packages.join(", ")}`);
