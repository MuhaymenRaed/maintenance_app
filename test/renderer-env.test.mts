import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The window has no `process`.
 *
 * The code under `src/site/` is the dashboard's, copied by `sync:site`, and
 * Next.js inlines `process.env.NEXT_PUBLIC_*` into a client bundle at build
 * time. Vite does not: a bare `process` in any module the window imports
 * throws while the module graph is still loading, before React mounts, and the
 * desk opens on an empty dark window with nothing in the log. So every one the
 * renderer can reach must be named in `define` in `electron.vite.config.ts`,
 * and any other use of `process` there is a bug outright.
 */
const root = path.resolve(import.meta.dirname, "..");
const config = fs.readFileSync(path.join(root, "electron.vite.config.ts"), "utf8");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

/** Comments name `process.env.X` in prose; only code counts. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const uses = ["src/site", "src/renderer"].flatMap((dir) =>
  sources(path.join(root, dir)).flatMap((file) =>
    [...code(fs.readFileSync(file, "utf8")).matchAll(/\bprocess\.(\w+)(?:\.(\w+))?/g)].map((match) => ({
      file: path.relative(root, file).replace(/\\/g, "/"),
      what: match[0],
      env: match[1] === "env" ? match[2] : undefined,
    })),
  ),
);

test("every process.env the window can reach is replaced at build time", () => {
  const missing = uses.filter((use) => use.env && !config.includes(`"process.env.${use.env}"`));
  assert.deepEqual(
    missing.map((use) => `${use.file}: ${use.what}`),
    [],
    "add these to the renderer's `define` in electron.vite.config.ts",
  );
});

test("nothing the window can reach reads process for anything else", () => {
  const other = uses.filter((use) => !use.env);
  assert.deepEqual(
    other.map((use) => `${use.file}: ${use.what}`),
    [],
    "the renderer has no `process` — replace these, or define them",
  );
});
