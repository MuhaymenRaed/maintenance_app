import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_DESK_PASSWORD, setAt, verifyAt } from "../src/main/desk-lock-core.ts";

/**
 * The desk's password (2026-11-17): the editor, the figures and the settings
 * ask for it, every time. These pin what the main process answers, against a
 * file in a temporary folder, because the window can only ask and never see.
 */
function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desk-lock-"));
  return { file: path.join(dir, "desk-lock.json"), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("until one is set, the default eight digits open the desk and nothing else does", () => {
  const { file, done } = folder();
  try {
    assert.equal(DEFAULT_DESK_PASSWORD, "13572468");
    assert.equal(verifyAt(file, "13572468"), true);
    assert.equal(verifyAt(file, "1357246"), false);
    assert.equal(verifyAt(file, ""), false);
    assert.equal(verifyAt(file, undefined), false);
    assert.equal(verifyAt(file, 13572468), false);
  } finally {
    done();
  }
});

test("changing it needs the current one, and refuses a weak new one", () => {
  const { file, done } = folder();
  try {
    assert.deepEqual(setAt(file, { current: "00000000", next: "24681357" }), { ok: false, error: "wrong_password" });
    assert.deepEqual(setAt(file, { current: "13572468", next: "12345" }), { ok: false, error: "weak_password" });
    assert.deepEqual(setAt(file, { current: "13572468", next: "      " }), { ok: false, error: "weak_password" });
    assert.equal(fs.existsSync(file), false, "a refused change writes nothing");
  } finally {
    done();
  }
});

test("once changed, the new one opens it, the default stops, and only a hash is kept", () => {
  const { file, done } = folder();
  try {
    assert.deepEqual(setAt(file, { current: "13572468", next: " 24681357 " }), { ok: true });
    assert.equal(verifyAt(file, "24681357"), true, "spaces around it are not part of it");
    assert.equal(verifyAt(file, "13572468"), false);
    const kept = fs.readFileSync(file, "utf8");
    assert.equal(kept.includes("24681357"), false, "the password itself is never written");
    assert.match(JSON.parse(kept).hash, /^[0-9a-f]{64}$/);
    // And it can be changed again, from the new one.
    assert.deepEqual(setAt(file, { current: "24681357", next: "11223344" }), { ok: true });
    assert.equal(verifyAt(file, "11223344"), true);
    assert.equal(verifyAt(file, "24681357"), false);
  } finally {
    done();
  }
});

test("a file that is not JSON opens with the default; a damaged hash is a plain no", () => {
  const { file, done } = folder();
  try {
    fs.writeFileSync(file, "not json");
    assert.equal(verifyAt(file, "13572468"), true);
    fs.writeFileSync(file, JSON.stringify({ salt: "zz", hash: "zz" }));
    let reported = 0;
    assert.equal(verifyAt(file, "13572468", () => reported++), false);
    assert.equal(reported, 0, "a hash of the wrong length is a plain no, not an error");
  } finally {
    done();
  }
});
