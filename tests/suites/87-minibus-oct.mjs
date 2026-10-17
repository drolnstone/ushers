/* From the Driver App, 10 to 17 October 2026: a UK phone number only,
   changes an admin makes are told, and wrong PINs are counted per phone,
   not per name. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department, notesOf } from "../lib/people.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("phone numbers, changes told, PIN lock per phone");
  let D;

  /* A call from a given address, as Cloudflare passes it. */
  const ctx = { waitUntil() {} };
  async function from(ip, action, body, token) {
    const headers = { "content-type": "application/json", "cf-connecting-ip": ip };
    if (token) headers.authorization = "Bearer " + token;
    const res = await mod.default.fetch(new Request("https://api.test/api/" + action,
      { method: "POST", headers, body: JSON.stringify(body || {}) }), D.env, ctx);
    const j = await res.json(); j._status = res.status; return j;
  }

  s.test("set up: a Head Usher, an Assistant, and an usher", async (a) => {
    D = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]],
      ["ahu", "Ruth Ade", ["usher", "assistant_head_usher"]], ["A", "John Smith"]]);
    a.ok(D.ID.A);
  });

  /* ---- phone numbers -------------------------------------------------- */
  s.test("the phone check: eleven digits from 0, however it is typed", (a) => {
    a.eq(mod.normalisePhone("07700 900123"), "07700900123");
    a.eq(mod.normalisePhone("+44 7700 900123"), "07700900123");
    a.eq(mod.normalisePhone("0044 7700 900123"), "07700900123");
    a.eq(mod.normalisePhone("447700900123"), "07700900123");
    a.eq(mod.normalisePhone("4477009001234"), "", "one digit too many");
    a.eq(mod.normalisePhone("0770090012"), "", "one too few");
    a.eq(mod.normalisePhone("17700900123"), "", "not from 0");
  });

  s.test("Admin → Ushers refuses a phone that is not 11 digits, and saves a good one as digits", async (a) => {
    const bad = await D.call("usher.save", { usherId: D.ID.A, name: "John Smith", phone: "4477171946434" }, D.T.hu);
    a.eq(bad.error, "phone");
    a.eq(bad.message, "Not an 11-digit UK phone number.");
    a.eq(D.env.DB._one("SELECT phone FROM ushers WHERE id=?", D.ID.A).phone, "", "nothing saved");
    a.ok((await D.call("usher.save", { usherId: D.ID.A, name: "John Smith", phone: "07700 900 123" }, D.T.hu)).ok);
    a.eq(D.env.DB._one("SELECT phone FROM ushers WHERE id=?", D.ID.A).phone, "07700900123");
    a.eq((await D.call("usher.save", { name: "New Person", phone: "12345" }, D.T.hu)).error, "phone", "nor for somebody new");
    a.ok((await D.call("usher.save", { name: "No Phone", pin: "4321" }, D.T.hu)).ok, "no phone at all is still allowed");
  });

  /* ---- changes are told --------------------------------------------- */
  const last = (k, type) => notesOf(D.env, D.ID[k]).filter((n) => n.type === (type || "account_change"))[0];

  s.test("a phone change: the person and the other admins are told, the one who made it is not", async (a) => {
    a.ok((await D.call("usher.save", { usherId: D.ID.A, name: "John Smith", phone: "07700900124" }, D.T.hu)).ok);
    a.eq(last("A").title, "Your details were changed: phone");
    a.eq(last("A").body, "By Grace Okafor.");
    a.eq(last("ahu").title, "Details changed (phone): John Smith");
    a.eq(last("admin").title, "Details changed (phone): John Smith");
    a.not(notesOf(D.env, D.ID.hu).some((n) => /^Details changed/.test(n.title)), "not the Head Usher who made it");
  });

  s.test("saving with nothing changed tells nobody", async (a) => {
    const n0 = D.env.DB._rows("SELECT * FROM notifications WHERE type='account_change'").length;
    a.ok((await D.call("usher.save", { usherId: D.ID.A, name: "John Smith", phone: "07700900124" }, D.T.hu)).ok);
    a.eq(D.env.DB._rows("SELECT * FROM notifications WHERE type='account_change'").length, n0);
  });

  s.test("a PIN reset and a role change are told; the link opens Admin → Ushers for admins", async (a) => {
    a.ok((await D.call("usher.resetPin", { usherId: D.ID.A }, D.T.hu)).ok);
    a.eq(last("A").title, "Your PIN was reset");
    a.eq(last("ahu").title, "PIN reset: John Smith");
    a.eq(mod.linkFor(last("ahu"), true), "admin/#ushers/" + D.ID.A);
    a.not(/phone|last four|default/i.test(last("A").title + last("A").body), "never says where a default PIN comes from");
    const r = await D.call("usher.roles", { usherId: D.ID.A, roles: ["usher", "treasurer"] }, D.T.admin);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(last("A").title, "Your roles are now: Usher, Treasurer");
    a.eq(last("hu").title, "Roles changed to Usher, Treasurer: John Smith");
  });

  s.test("adding and removing somebody is told to the other admins", async (a) => {
    const made = await D.call("usher.save", { name: "Sade Bello", phone: "07700900125" }, D.T.hu);
    a.ok(made.ok);
    a.eq(last("ahu").title, "Added: Sade Bello");
    a.ok((await D.call("usher.remove", { usherId: made.usherId }, D.T.hu)).ok);
    a.eq(last("ahu").title, "Removed: Sade Bello");
  });

  s.test("test people are left out", async (a) => {
    const n0 = D.env.DB._rows("SELECT * FROM notifications WHERE type='account_change'").length;
    a.ok((await D.call("usher.save", { name: "Test Usher One", pin: "5555", mustChange: false }, D.T.admin)).ok);
    a.eq(D.env.DB._rows("SELECT * FROM notifications WHERE type='account_change'").length, n0);
  });

  /* ---- PIN lock per phone ------------------------------------------- */
  s.test("three wrong PINs from a stranger's phone lock that phone, not the Head Usher's", async (a) => {
    for (let i = 0; i < 3; i++) await from("203.0.113.9", "login", { usherId: D.ID.hu, pin: "0000" });
    const again = await from("203.0.113.9", "login", { usherId: D.ID.hu, pin: "1234" });
    a.eq(again.error, "locked", "the stranger's phone is locked, even with the right PIN");
    a.has(again.message, "Locked for ");
    a.ok((await from("198.51.100.7", "login", { usherId: D.ID.hu, pin: "1234" })).ok, "the Head Usher's own phone signs in");
  });

  s.test("one address cannot reach the name's ceiling alone", async (a) => {
    const ip = "203.0.113.20";
    const k = "c:" + D.ID.ahu + ":";
    let locked = 0;
    for (let i = 0; i < 12; i++) {
      /* the per-phone five minutes is skipped over, to reach the hourly cap */
      D.env.DB._exec("DELETE FROM pin_tries WHERE k LIKE '" + k + "%'");
      const r = await from(ip, "login", { usherId: D.ID.ahu, pin: "0000" });
      if (r.error === "locked") locked++;
    }
    const row = D.env.DB._one("SELECT n FROM pin_tries WHERE k=?", "f:" + D.ID.ahu);
    a.ok(row.n <= 9, "nine wrong PINs an hour from one address at most, had " + row.n);
    a.ok(locked > 0, "then that address is locked for the hour");
  });

  s.test("thirty wrong PINs from many addresses lock the name, except for a phone that knows the PIN", async (a) => {
    a.ok((await from("192.0.2.1", "login", { usherId: D.ID.A, pin: (await pinOf("A")) })).ok, "John's own phone signs in once");
    for (let i = 0; i < 30; i++) await from("10.0.0." + i, "login", { usherId: D.ID.A, pin: "0000" });
    a.eq((await from("10.9.9.9", "login", { usherId: D.ID.A, pin: await pinOf("A") })).error, "locked", "a new address is held");
    a.ok((await from("192.0.2.1", "login", { usherId: D.ID.A, pin: await pinOf("A") })).ok, "John's known phone still gets in");
  });

  s.test("a PIN reset clears every count for that person", async (a) => {
    const r = await D.call("usher.resetPin", { usherId: D.ID.A }, D.T.admin);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(D.env.DB._rows("SELECT * FROM pin_tries WHERE k LIKE ? OR k=?", "_:" + D.ID.A + ":%", "f:" + D.ID.A).length, 0);
  });

  /* John's PIN is his default after the reset above. */
  async function pinOf() { return "0124"; }

  return s;
}
