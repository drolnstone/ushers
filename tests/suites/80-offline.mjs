/* Opening with no signal: screens answered from what the device saved, and
   changes made with no signal queued and done once by the server, however
   many times they arrive. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { Suite } from "../lib/t.mjs";
import { loadWorker, makeEnv, client } from "../lib/worker.mjs";

/* shared/core.js in a pretend browser whose network can be cut. */
function browser(root) {
  const ls = new Map();
  const localStorage = {
    get length() { return ls.size; },
    key: (i) => Array.from(ls.keys())[i] ?? null,
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => { ls.set(k, String(v)); },
    removeItem: (k) => { ls.delete(k); }
  };
  const net = { up: true, answers: {}, sent: [] };
  const fetch = (url, opt) => {
    const action = url.split("/api/")[1];
    net.sent.push({ action, body: JSON.parse(opt.body) });
    if (!net.up) return Promise.reject(new TypeError("Failed to fetch"));
    const j = net.answers[action] || { ok: true };
    return Promise.resolve({ status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(j))) });
  };
  const noop = () => {};
  const window = { USHERS_CONFIG: { api: "https://api.test" }, addEventListener: noop, matchMedia: () => ({ matches: false }) };
  const document = { addEventListener: noop, getElementById: () => null, documentElement: { setAttribute: noop } };
  const sandbox = { window, document, localStorage, fetch, setInterval: noop, TextEncoder, navigator: {}, location: { pathname: "/" }, console };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(root, "shared/core.js"), "utf8"), sandbox, { filename: "core.js" });
  return { C: window.UshersCore, net, ls };
}

export default async function ({ root }) {
  const s = new Suite("opening and working with no signal");

  s.test("a screen seen once opens from the saved copy, marked as saved", async (a) => {
    const { C, net } = browser(root);
    C.setToken("tok");
    net.answers.home = { ok: true, thisWeek: [{ eventId: "E1", title: "First Service" }] };
    a.not((await C.api("home"))._savedAt, "fresh from the server");
    net.up = false;
    const j = await C.api("home");
    a.ok(j._savedAt, "marked as saved");
    a.eq(j.thisWeek[0].title, "First Service");
    let err = null;
    try { await C.api("dashboard"); } catch (e) { err = e; }
    a.ok(err && err.network, "a screen never seen still says no connection");
  });

  s.test("a refused answer is never saved, and signing out drops the saved copies", async (a) => {
    const { C, net } = browser(root);
    C.setToken("tok");
    net.answers.home = { ok: true, thisWeek: [] };
    await C.api("home");
    net.answers.home = { ok: false, message: "No" };
    await C.api("home");
    net.up = false;
    a.ok((await C.api("home")).ok, "the good copy stands");
    C.setToken("");
    C.setToken("tok2");
    let err = null;
    try { await C.api("home"); } catch (e) { err = e; }
    a.ok(err && err.network, "nothing left for the next person");
  });

  s.test("a change with no signal is queued with an id, and sent later", async (a) => {
    const { C, net } = browser(root);
    C.setToken("tok");
    net.up = false;
    const x = await C.send("rota.set", { eventId: "E1", usherIds: ["U1"] }, "Rota");
    a.ok(x.ok && x.queued);
    const q = C.queue();
    a.eq(q.length, 1); a.ok(q[0].body.queueId, "carries its own id"); a.eq(q[0].label, "Rota");
    net.up = true;
    await C.flush();
    a.eq(C.queue().length, 0, "gone once the server has it");
    a.eq(net.sent[net.sent.length - 1].body.queueId, q[0].body.queueId, "sent with the same id");
  });

  s.test("the server does a queued change once, however often it arrives", async (a) => {
    const { mod } = await loadWorker(root);
    const env = makeEnv(root);
    const call = client(mod, env);
    await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" });
    const adminId = (await call("people")).people[0].id;
    const sa = (await call("login", { usherId: adminId, pin: "9999" })).token;
    const huId = (await call("usher.save", { name: "Grace Okafor", pin: "1234", mustChange: false }, sa)).usherId;
    await call("usher.roles", { usherId: huId, roles: ["usher", "head_usher"] }, sa);
    const admin = (await call("login", { usherId: huId, pin: "1234" })).token;
    const date = mod.londonKey(new Date(Date.now() + 3 * 86400000));
    const body = { type: Object.keys(JSON.parse(JSON.stringify((await call("me", {}, admin)).config.eventTypes))).find((k) => k.indexOf("SUN") !== 0),
                   title: "Naming Ceremony", date, start: "14:00", queueId: "q-test-1" };
    const one = await call("event.save", body, admin);
    a.ok(one.ok, one.message);
    const two = await call("event.save", body, admin);
    a.ok(two.ok && two.duplicate, "the second is the first answer again");
    a.eq(two.eventId, one.eventId);
    const rota = await call("rota", { from: date, weeks: 2 }, admin);
    a.eq(rota.events.filter((e) => e.title === "Naming Ceremony").length, 1, "one event, not two");
    const three = await call("event.save", Object.assign({}, body, { queueId: "q-test-2" }), admin);
    a.ne(three.eventId, one.eventId, "a new id is a new change");
  });

  s.test("Home gives each duty its event type, for a report started with no signal", async (a) => {
    const { mod } = await loadWorker(root);
    const env = makeEnv(root);
    const call = client(mod, env);
    await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" });
    const adminId = (await call("people")).people[0].id;
    const sa = (await call("login", { usherId: adminId, pin: "9999" })).token;
    const huId = (await call("usher.save", { name: "Grace Okafor", pin: "1234", mustChange: false }, sa)).usherId;
    await call("usher.roles", { usherId: huId, roles: ["usher", "head_usher"] }, sa);
    const admin = (await call("login", { usherId: huId, pin: "1234" })).token;
    const sun = mod.sundayOnOrAfter(mod.londonKey(new Date(Date.now() + 86400000)));
    await call("rota", { from: sun, weeks: 1 }, admin);
    a.ok((await call("rota.set", { eventId: "S" + sun.replace(/-/g, "") + "-1", usherIds: [huId] }, admin)).ok);
    const home = await call("home", {}, admin);
    const d = [].concat(home.thisWeek, home.later).find((x) => x.eventId === "S" + sun.replace(/-/g, "") + "-1");
    a.ok(d && d.type, "the duty names its type");
  });

  return s;
}
