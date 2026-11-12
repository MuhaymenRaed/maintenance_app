import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { IntlMessageFormat } from "intl-messageformat";

/**
 * The desk's own copy, held to the rules the site's `check:messages` holds the
 * dashboard's to — scaled down to the one namespace the app adds.
 *
 * Every failure here is one `tsc`, the build and the window all stay silent
 * about: a key the Arabic file lacks renders as `Desk.key` on the Arabic desk,
 * a message that does not parse throws only when it is drawn, and an argument
 * spelt differently in one language is printed as a literal `{count}`.
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (locale: string) =>
  JSON.parse(fs.readFileSync(path.join(root, "src/renderer/messages", `desk.${locale}.json`), "utf8")) as Record<
    string,
    string
  >;

const en = read("en");
const ar = read("ar");

test("Arabic and English carry the same keys", () => {
  const missingInAr = Object.keys(en).filter((key) => !(key in ar));
  const missingInEn = Object.keys(ar).filter((key) => !(key in en));
  assert.deepEqual(missingInAr, [], "missing from desk.ar.json");
  assert.deepEqual(missingInEn, [], "missing from desk.en.json");
});

test("no message is empty", () => {
  for (const [locale, messages] of [["en", en], ["ar", ar]] as const) {
    for (const [key, value] of Object.entries(messages)) {
      assert.ok(typeof value === "string" && value.trim().length > 0, `${locale}.${key} is empty`);
    }
  }
});

/** The argument names a message reads — `{count, plural, …}` and `{code}` alike. */
function argumentsOf(message: string): string[] {
  const names = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)) names.add(match[1]);
  return [...names].sort();
}

test("both languages read the same arguments", () => {
  for (const key of Object.keys(en)) {
    if (!(key in ar)) continue;
    assert.deepEqual(argumentsOf(ar[key]), argumentsOf(en[key]), `${key}: the two files name different arguments`);
  }
});

test("every message parses and formats, at every plural form Arabic has", () => {
  // 0, 1, 2, 3–10, 11–99, 100+: zero, one, two, few, many, other.
  const counts = [0, 1, 2, 5, 11, 100];
  for (const [locale, messages] of [["en", en], ["ar", ar]] as const) {
    for (const [key, message] of Object.entries(messages)) {
      const args = argumentsOf(message);
      for (const count of counts) {
        const values = Object.fromEntries(args.map((name) => [name, name === "count" ? count : "x"]));
        const formatted = new IntlMessageFormat(message, locale).format(values);
        assert.equal(typeof formatted, "string", `${locale}.${key} did not format`);
        assert.ok(!/\{|\}/.test(String(formatted)), `${locale}.${key} left a brace unformatted: ${formatted}`);
      }
    }
  }
});

/**
 * Every key the window asks for exists.
 *
 * A static scan, like the site's: every `const x = useTranslations("Desk")`
 * binding and every `say(` call, read for a literal first argument. A key built
 * at run time (`tab_${key}`) cannot be read this way; those are listed below by
 * hand from the values they are built from.
 */
test("every key the window reads is defined", () => {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  })(path.join(root, "src/renderer"));

  const used = new Map<string, string>();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const bindings = [...source.matchAll(/const (\w+) = useTranslations\("Desk"\)/g)].map((match) => match[1]);
    for (const name of [...bindings, "say"]) {
      const call = new RegExp(`\\b${name}\\(\\s*(?:[^"()]*\\?\\s*)?"([A-Za-z0-9_]+)"(?:\\s*:\\s*"([A-Za-z0-9_]+)")?`, "g");
      for (const match of source.matchAll(call)) {
        used.set(match[1], path.basename(file));
        if (match[2]) used.set(match[2], path.basename(file));
      }
    }
    // Keys held in lookup tables (`KIND_LABEL`, `FIELD_KEYS`) rather than at the call.
    for (const match of source.matchAll(/:\s*"((?:op|field)[A-Z][A-Za-z0-9]*)"/g)) used.set(match[1], path.basename(file));
  }

  const built = [
    ...["general", "appearance", "notifications", "printing", "sync", "backups", "account", "about"].map((tab) => `tab_${tab}`),
    ...["auto", "manual", "quit", "restore"].map((reason) => `backupReason_${reason}`),
    ...["invalid_credentials", "offline"].map((code) => `accountError_${code}`),
    ...["unsupported", "unreadable", "too_large", "upload_failed"].map((reason) => `photoWhy_${reason}`),
  ];
  for (const key of built) used.set(key, "(built at run time)");

  const missing = [...used].filter(([key]) => !(key in en)).map(([key, file]) => `${key} (${file})`);
  assert.deepEqual(missing, [], "used but not defined in desk.en.json");
  assert.ok(used.size > 100, `the scan found only ${used.size} keys — it has stopped reading the source`);
});

/**
 * The dashboard lines the desk words its own way (`site-overrides.*.json`).
 * Each must still exist on the site — a key the site renamed would otherwise
 * be "overridden" into a namespace nothing reads, and the browser's wording
 * would come back unnoticed — and must read the same ICU arguments as the
 * line it replaces, or the copied component's values go nowhere.
 */
test("every overridden dashboard line still exists, with the same arguments", () => {
  const site = (locale: string) =>
    JSON.parse(fs.readFileSync(path.join(root, "src/site/messages", `${locale}.json`), "utf8")) as Record<
      string,
      Record<string, string>
    >;
  for (const locale of ["ar", "en"]) {
    const overrides = JSON.parse(
      fs.readFileSync(path.join(root, "src/renderer/messages", `site-overrides.${locale}.json`), "utf8"),
    ) as Record<string, Record<string, string>>;
    const original = site(locale);
    for (const [namespace, keys] of Object.entries(overrides)) {
      for (const [key, value] of Object.entries(keys)) {
        const was = original[namespace]?.[key];
        assert.ok(typeof was === "string", `${locale}: ${namespace}.${key} no longer exists on the site`);
        assert.deepEqual(argumentsOf(value), argumentsOf(was), `${locale}: ${namespace}.${key} reads different arguments`);
      }
    }
  }
  const ar = JSON.parse(fs.readFileSync(path.join(root, "src/renderer/messages/site-overrides.ar.json"), "utf8"));
  const en = JSON.parse(fs.readFileSync(path.join(root, "src/renderer/messages/site-overrides.en.json"), "utf8"));
  assert.deepEqual(
    Object.entries(ar).map(([ns, keys]) => [ns, Object.keys(keys as object).sort()]),
    Object.entries(en).map(([ns, keys]) => [ns, Object.keys(keys as object).sort()]),
    "the two override files replace different keys",
  );
});
