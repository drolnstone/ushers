/* Brief 04: the sign-in screen. The helpers that make it quick live in
   shared/core.js, so they are checked here where every PIN box uses them,
   and the screens are checked for using them at all. */

import { Suite } from "../lib/t.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

/* shared/core.js in a small fake browser: enough DOM for the PIN box and
   enough localStorage for the remembered name. */
function loadCore(root) {
  const listeners = {};
  function input(attrs) {
    const el = {
      value: "", _attrs: attrs || {},
      getAttribute(k) { return el._attrs[k] == null ? null : String(el._attrs[k]); },
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      focus() { el.focused = true; }
    };
    return el;
  }
  const bag = {};
  const localStorage = {
    length: 0,
    getItem: (k) => (k in bag ? bag[k] : null),
    setItem: (k, v) => { bag[k] = String(v); },
    removeItem: (k) => { delete bag[k]; },
    key: () => null
  };
  const timers = [];
  const win = {
    UshersConfig: { api: "https://api.test", pinMax: 4 },
    location: { href: "https://pages.test/", hash: "" },
    navigator: { onLine: true },
    addEventListener() {}, removeEventListener() {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    setInterval: () => 0, clearInterval() {},
    localStorage, crypto: undefined, fetch: () => Promise.reject(new Error("no network in this test")),
    TextEncoder, TextDecoder, URL, Promise, JSON, Date, Math, console
  };
  win.window = win;
  win.document = {
    hidden: false, body: { appendChild() {} }, documentElement: { style: { setProperty() {} }, dataset: {} },
    getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
    createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, style: {}, classList: { add() {}, remove() {} } }),
    addEventListener() {}, createTextNode: (t) => ({ t })
  };
  const ctx = vm.createContext(win);
  vm.runInContext(readFileSync(join(root, "shared", "core.js"), "utf8"), ctx, { filename: "shared/core.js" });
  return { C: win.UshersCore, input, fire: (ev, el) => (listeners[ev] || []).forEach((fn) => fn({ key: ev === "keydown" ? el._key : undefined, target: el })), timers, bag };
}

export default async function ({ root }) {
  const s = new Suite("signing in takes fewer taps");
  const ush = readFileSync(join(root, "index.html"), "utf8");
  const adm = readFileSync(join(root, "admin", "index.html"), "utf8");

  s.test("a PIN box keeps only digits", (a) => {
    const { C, input, fire } = loadCore(root);
    const box = input({ maxlength: "4" });
    C.pinBox(box, null);
    box.value = "1a2b3";
    fire("input", box);
    a.eq(box.value, "123");
  });

  s.test("the fourth digit signs in by itself, after a short pause, and only once", (a) => {
    const { C, input, fire, timers } = loadCore(root);
    const box = input({ maxlength: "4" });
    let went = 0;
    C.pinBox(box, () => went++);
    box.value = "12"; fire("input", box);
    a.eq(timers.filter((t) => t.fn).length, 0, "nothing is timed on two digits");
    box.value = "1234"; fire("input", box);
    const waiting = timers.filter((t) => t.fn);
    a.eq(waiting.length, 1);
    a.eq(waiting[0].ms, 600, "a pause to correct a mistyped digit");
    a.eq(went, 0, "not before the pause");
    waiting[0].fn();
    a.eq(went, 1);
  });

  s.test("a digit corrected during the pause stops the first attempt", (a) => {
    const { C, input, fire, timers } = loadCore(root);
    const box = input({ maxlength: "4" });
    let went = 0;
    C.pinBox(box, () => went++);
    box.value = "1234"; fire("input", box);
    box.value = "123"; fire("input", box);
    timers.forEach((t) => t.fn && t.fn());
    a.eq(went, 0);
  });

  s.test("Enter signs in without waiting", (a) => {
    const { C, input, fire } = loadCore(root);
    const box = input({ maxlength: "4" });
    let went = 0;
    C.pinBox(box, () => went++);
    box.value = "12";
    box._key = "Enter";
    fire("keydown", box);
    a.eq(went, 1);
  });

  s.test("the name chosen last is remembered on this phone, and can be forgotten", (a) => {
    const { C } = loadCore(root);
    a.eq(C.lastWho(), null);
    C.rememberWho("U007", "John Smith");
    a.eq(C.lastWho().id, "U007");
    a.eq(C.lastWho().name, "John Smith");
    C.forgetWho();
    a.eq(C.lastWho(), null);
  });

  s.test("the sign-in list is kept, one list per app", (a) => {
    const { C } = loadCore(root);
    a.eq(C.peopleCached("ushers"), null);
    C.peopleCache("ushers", [{ id: "U001", name: "Grace Okafor" }]);
    C.peopleCache("admin", [{ id: "U002", name: "John Smith" }]);
    a.eq(C.peopleCached("ushers")[0].name, "Grace Okafor");
    a.eq(C.peopleCached("admin")[0].name, "John Smith");
  });

  for (const [name, src] of [["the Ushers App", ush], ["the Admin App", adm]]) {
    s.test(name + "'s sign-in uses the shared helpers", (a) => {
      a.has(src, "C.pinBox(pin, submit)", "the PIN box signs in by itself");
      a.has(src, "C.rememberWho(", "the name is remembered");
      a.has(src, "C.peopleCached(", "the kept list is painted first");
      a.has(src, "C.peopleCache(", "the list is kept");
      a.has(src, 'who.addEventListener("change"', "choosing a name moves to the PIN");
      a.has(src, 'pin.value = ""; pin.focus();', "a wrong PIN empties the box");
      a.has(src, "Not you?", "the remembered name can be cleared");
      a.has(src, "Type to find your name", "a long list can be filtered");
    });
  }

  s.test("every PIN box in the Ushers App keeps only digits through the helper", (a) => {
    for (const id of ["spin", "cpin"]) a.has(ush, 'id: "' + id + '"', id);
    a.has(ush, "C.pinBox(pin, function () { if (amend) sendAmendment(); else submit(); }, CONF.pinMax)", "sign and submit");
    a.has(ush, "C.pinBox(pin, function () { btn.click(); }, CONF.pinMax)", "countersign");
    a.has(ush, "C.pinBox(box,", "change PIN");
  });

  s.test("Approve and Reject stay a tap, because a PIN cannot say which", (a) => {
    a.has(adm, "C.pinBox(pin, null)");
    a.hasnt(adm, 'C.pinBox(pin, function () { decide("approve"); })');
  });

  s.test("with no signal the kept list is shown rather than the typed-name box", (a) => {
    for (const src of [ush, adm]) a.has(src, "if (!people.length) { who.hidden = true;", "only falls back to typing when nothing is kept");
  });

  return s;
}
