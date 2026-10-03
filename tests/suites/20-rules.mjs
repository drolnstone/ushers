/* Calendar, dues and reminders: small rules, checked directly. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, makeEnv, client } from "../lib/worker.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("calendar, dues and reminders");
  const cfg = JSON.parse(JSON.stringify(mod.DEFAULT_CONFIG));

  s.test("the first Sunday of a month is Thanksgiving Sunday", (a) => {
    a.ok(mod.isThanksgiving(cfg, "2026-11-01"));
    a.not(mod.isThanksgiving(cfg, "2026-11-08"));
    a.ok(mod.isThanksgiving(cfg, "2026-10-04"));
    a.not(mod.isThanksgiving(Object.assign({}, cfg, { thanksgiving_rule: "none" }), "2026-10-04"));
  });

  s.test("London dates hold across the clock change", (a) => {
    a.eq(mod.londonKey(new Date("2026-10-24T23:30:00Z")), "2026-10-25", "BST: 00:30 London is the next day");
    a.eq(mod.londonKey(new Date("2026-10-25T23:30:00Z")), "2026-10-25", "GMT: 23:30 London is the same day");
    a.eq(mod.sundayOnOrAfter("2026-10-01"), "2026-10-04");
    a.eq(mod.sundayOnOrBefore("2026-10-01"), "2026-09-27");
    a.eq(mod.sundayOnOrBefore("2026-10-04"), "2026-10-04");
  });

  s.test("dues: expected, paid, outstanding and status", (a) => {
    const pay = (y, amount, voided) => ({ year: y, amount, voided_at: voided ? 1 : null, paid_on: y + "-01-01" });
    const p = mod.duesPosition(cfg, [pay(2026, 500), pay(2026, 500), pay(2026, 500)], 2026, "2026-03-15");
    a.eq(p.expected, 1500); a.eq(p.paid, 1500); a.eq(p.status, "Up to date"); a.eq(p.outstanding, 0);
    a.eq(mod.duesPosition(cfg, [pay(2026, 500)], 2026, "2026-03-15").status, "Behind");
    a.eq(mod.duesPosition(cfg, [pay(2026, 2000)], 2026, "2026-03-15").status, "Ahead");
    a.eq(mod.duesPosition(cfg, [pay(2026, 500, true)], 2026, "2026-03-15").paid, 0, "a voided payment does not count");
    const old = mod.duesPosition(cfg, [pay(2025, 3000)], 2025, "2026-03-15");
    a.eq(old.expected, 6000); a.eq(old.outstanding, 3000, "last year's balance stays on record");
  });

  s.test("duty reminders go once, two days before, after the reminder hour", async (a) => {
    const env = makeEnv(root);
    const call = client(mod, env);
    await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" });
    const people = (await call("people")).people;
    const admin = (await call("login", { usherId: people[0].id, pin: "9999" })).token;
    const u = (await call("usher.save", { name: "John Smith", email: "j@example.org", pin: "1234", mustChange: false }, admin)).usherId;
    await call("usher.roles", { usherId: people[0].id, roles: ["usher", "system_admin", "head_usher"] }, admin);
    await call("rota", { from: "2026-10-01", weeks: 2 }, admin);
    a.ok((await call("rota.set", { eventId: "S20261011-1", usherIds: [u] }, admin)).ok);
    const at = new Date("2026-10-09T18:30:00Z"); // 19:30 London, Friday
    a.eq(await mod.clockTick(env, at), 1);
    a.eq(await mod.clockTick(env, at), 0, "not twice");
    a.eq(await mod.clockTick(env, new Date("2026-10-09T10:00:00Z")), 0);
  });

  return s;
}
