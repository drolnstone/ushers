/* The foot of both apps names all three versions. The first screen is drawn
   before the server has answered, so the foot must fill in the server and
   sheet when the answer comes, not wait for the next screen. Asim saw the
   Admin App's foot complete and the Ushers App's not. */

import { Suite } from "../lib/t.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

function el() {
  const e = {
    children: [], style: {}, classList: { add() {}, remove() {} },
    setAttribute() {}, addEventListener() {},
    appendChild(c) { e.children.push(c); return c; },
    removeChild(c) { e.children.splice(e.children.indexOf(c), 1); return c; },
    get firstChild() { return e.children[0] || null; },
    get text() { return e.children.map((c) => c.t !== undefined ? c.t : c.text).join(""); }
  };
  Object.defineProperty(e, "textContent", { set(v) { e.children = [{ t: String(v) }]; } });
  return e;
}

function loadCore(root, answer) {
  const bag = {};
  const win = {
    UshersConfig: { api: "https://api.test", pinMax: 4 },
    location: { href: "https://pages.test/", hash: "" },
    navigator: { onLine: true },
    addEventListener() {}, removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: { length: 0, getItem: (k) => (k in bag ? bag[k] : null), setItem: (k, v) => { bag[k] = String(v); }, removeItem: (k) => { delete bag[k]; }, key: () => null },
    crypto: undefined,
    fetch: async () => ({ status: 200, json: async () => Object.assign({}, answer) }),
    TextEncoder, TextDecoder, URL, Promise, JSON, Date, Math, console
  };
  win.window = win;
  win.document = {
    hidden: false, body: el(), documentElement: { style: { setProperty() {} }, dataset: {} },
    getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
    createElement: () => el(), addEventListener() {}, createTextNode: (t) => ({ t })
  };
  vm.runInContext(readFileSync(join(root, "shared", "core.js"), "utf8"), vm.createContext(win), { filename: "shared/core.js" });
  return win.UshersCore;
}

export default async function ({ root }) {
  const s = new Suite("the foot names all three versions");

  s.test("drawn before the server answers, it fills in when the answer comes", async (a) => {
    const C = loadCore(root, { ok: true, server: "w9.9.9", sheet: "v8.8.8" });
    const foot = el();
    C.foot(foot);
    a.eq(foot.children[0].text, "app " + C.APP_VERSION);
    await C.api("people");
    a.eq(foot.children[0].text, "app " + C.APP_VERSION + " · server w9.9.9 · sheet v8.8.8");
  });

  s.test("and is left alone when the versions have not changed", async (a) => {
    const C = loadCore(root, { ok: true, server: "w9.9.9", sheet: "v8.8.8" });
    await C.api("people");
    const foot = el();
    C.foot(foot);
    const line = foot.children[0];
    await C.api("people");
    a.ok(foot.children[0] === line);
  });

  return s;
}
