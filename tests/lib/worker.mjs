/* Loads server/worker.js for testing without editing it. Adapted from the
   Driver App (drolnstone/minibus-check tests/lib/worker.mjs): a copy is made
   on every run with one generated export block, so a test can call any
   function directly and never runs a stale copy. */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeDB } from "./d1.mjs";

const DECL = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const CONST = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
const CLASS = /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/;

export function topLevelNames(src) {
  const names = new Set();
  for (const line of src.split("\n")) {
    if (/^\s/.test(line)) continue;
    const m = DECL.exec(line) || CONST.exec(line) || CLASS.exec(line);
    if (m) names.add(m[1]);
  }
  names.delete("default");
  return [...names];
}

let tmpDir = null;

export async function loadWorker(root) {
  const src = readFileSync(join(root, "server", "worker.js"), "utf8");
  const names = topLevelNames(src);
  tmpDir = tmpDir || join(root, "tests", ".build");
  mkdirSync(tmpDir, { recursive: true });
  const out = join(tmpDir, "worker." + Date.now() + "." + Math.random().toString(36).slice(2) + ".mjs");
  writeFileSync(out, src + "\n\nexport { " + names.join(", ") + " };\n");
  const mod = await import(pathToFileURL(out).href);
  return { mod, names, src };
}

export function cleanup(root) {
  try { rmSync(join(root, "tests", ".build"), { recursive: true, force: true }); } catch (e) {}
}

/* Outbound fetch (the knock on the sheet) is recorded, never sent. */
export const outbound = [];
export const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => { outbound.push({ url: String(url), opts }); return new Response("ok", { status: 200 }); };

export function makeEnv(root, over) {
  return Object.assign({
    DB: makeDB(join(root, "server", "schema.sql")),
    PIN_PEPPER: "test-pepper",
    SHEET_TOKEN: "test-sheet-token",
    BOOTSTRAP_TOKEN: "test-bootstrap",
    PIN_ITERATIONS: "1000"
  }, over || {});
}

/* A tiny client: call(action, body, token) against the real fetch handler. */
export function client(mod, env) {
  const waits = [];
  const ctx = { waitUntil(p) { waits.push(p); } };
  async function call(action, body, token) {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    const res = await mod.default.fetch(new Request("https://api.test/api/" + action,
      { method: "POST", headers, body: JSON.stringify(body || {}) }), env, ctx);
    const j = await res.json();
    j._status = res.status;
    return j;
  }
  call.settle = async () => { await Promise.all(waits.splice(0)); };
  return call;
}
