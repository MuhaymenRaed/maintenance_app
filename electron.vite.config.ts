import fs from "node:fs";
import path from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = __dirname;
const SITE = path.join(root, "src", "site");
const OVERRIDES = path.join(root, "src", "renderer", "overrides");
const SHIMS = path.join(root, "src", "renderer", "shims");
const EXTS = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];

/**
 * `@/x` means the dashboard's own module, unless the app replaces it.
 *
 * The renderer looks in `src/renderer/overrides/` first — the server actions,
 * the server queries, the print agent's transport and the router live there —
 * and falls back to `src/site/`, the code copied from the site by
 * `scripts/sync-site.mjs`. `tsconfig.json` lists the same two folders in the
 * same order, so the type checker and the bundler can never disagree about
 * which file a component is talking to.
 *
 * The main process gets no overrides: it only ever imports the pure modules
 * (the desk's rules, the permissions, the queue window), never a component.
 */
function siteAlias(withOverrides: boolean): Plugin {
  const folders = withOverrides ? [OVERRIDES, SITE] : [SITE];
  return {
    name: "al-esnad-site-alias",
    enforce: "pre",
    resolveId(source) {
      if (!source.startsWith("@/")) return null;
      const rest = source.slice(2);
      for (const folder of folders) {
        for (const ext of EXTS) {
          const candidate = path.join(folder, rest + ext);
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
        }
      }
      return null;
    },
  };
}

/** Next.js and next-intl, as the copied components import them. */
const shims = {
  "next/image": path.join(SHIMS, "next-image.tsx"),
  "next/link": path.join(SHIMS, "next-link.tsx"),
  "next-intl": path.join(SHIMS, "next-intl.ts"),
  "server-only": path.join(SHIMS, "server-only.ts"),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), siteAlias(false)],
    build: {
      outDir: "out/main",
      rollupOptions: { input: { index: path.join(root, "src/main/main.ts") } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: { input: { index: path.join(root, "src/preload/preload.ts") } },
    },
  },
  renderer: {
    root: path.join(root, "src/renderer"),
    // ⚠️ No `base`: electron-vite forces "./" in production whatever is set
    // here. The window's address is a deep route, so the protocol handler in
    // `src/main/main.ts` (`locate`) is what finds `./assets/x.js` from it.
    publicDir: path.join(root, "public"),
    plugins: [siteAlias(true), react(), tailwindcss()],
    resolve: { alias: shims },
    build: {
      outDir: path.join(root, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: { input: { index: path.join(root, "src/renderer/index.html") } },
    },
  },
});
