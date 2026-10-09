/* Brief 07: Check everything names people. The server builds its answer
   from the same queries it sends by, so taking the sending code away takes
   the report with it; and the open health answer still names nobody. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { at, department } from "../lib/people.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("Check everything names people");
  let D, sunday, cfg;

  s.test("set up: five ushers, one of them reachable by nothing at all", async (a) => {
    D = await department(mod, root, [
      ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
      ["A", "John Smith", null, { email: "a@example.org" }],
      ["B", "Mary Jones"],
      ["C", "Peter Obi", null, { email: "c@example.org" }],
      ["D", "Ruth Adeyemi", null, { email: "d@example.org" }]
    ]);
    cfg = await mod.loadConfig(D.env);
    sunday = mod.sundayOnOrAfter(mod.londonKey(new Date()));
    await D.call("rota", { from: sunday, weeks: 1 }, D.T.hu);
  });

  s.test("somebody with no phone alerts and no email is named as unreachable", async (a) => {
    const p = await mod.healthPeople(D.env, cfg);
    a.ok(p.alertsOff.indexOf("Mary Jones") !== -1, "alerts off");
    a.same(p.unreachable, ["Mary Jones"], "nothing reaches her");
    a.eq(p.ushers, 6, "the System Administrator counts too");
    a.eq(p.alertsOn, 0, "nobody has turned alerts on yet");
  });

  s.test("turning alerts on moves somebody off both lists", async (a) => {
    a.ok((await D.call("push.subscribe", { endpoint: "https://push.example/send/h7-A" }, D.T.A)).ok);
    const p = await mod.healthPeople(D.env, cfg);
    a.eq(p.alertsOff.indexOf("John Smith"), -1);
    a.eq(p.alertsOn, 1);
  });

  s.test("somebody with alerts off but an email is still to do, not needing attention", async (a) => {
    const p = await mod.healthPeople(D.env, cfg);
    a.ok(p.alertsOff.indexOf("Peter Obi") !== -1);
    a.eq(p.unreachable.indexOf("Peter Obi"), -1);
  });

  s.test("a coming Sunday with one counter instead of two is short", async (a) => {
    const second = "S" + sunday.replace(/-/g, "") + "-2";
    a.ok((await D.call("rota.set", { eventId: "S" + sunday.replace(/-/g, "") + "-1", usherIds: [D.ID.A, D.ID.B] }, D.T.hu)).ok);
    let gaps = await mod.sundayGaps(D.env, cfg, sunday);
    a.eq(gaps.length, 1, "only the counting duty is short");
    a.eq(gaps[0].eventId, second);
    a.eq(gaps[0].on, 0);
    a.eq(gaps[0].want, 2);
    const p = await mod.healthPeople(D.env, cfg);
    a.same(p.sundayGaps, ["Sunday Second Service: 0 of 2"]);
    a.eq(p.sunday, sunday);
  });

  s.test("a fully rostered Sunday is no gap at all", async (a) => {
    const second = "S" + sunday.replace(/-/g, "") + "-2";
    a.ok((await D.call("rota.set", { eventId: second, usherIds: [D.ID.C, D.ID.D] }, D.T.hu)).ok);
    a.same(await mod.sundayGaps(D.env, cfg, sunday), []);
    a.same((await mod.healthPeople(D.env, cfg)).sundayGaps, []);
  });

  s.test("a report still missing is named, and goes once it is in", async (a) => {
    const today = mod.londonKey(new Date());
    const ev = (await D.call("event.save", { type: "VIGIL", title: "Vigil", date: today }, D.T.hu)).eventId;
    a.ok((await D.call("rota.set", { eventId: ev, usherIds: [D.ID.A] }, D.T.hu)).ok);
    let over = await mod.reportsOverdue(D.env, cfg, today);
    a.eq(over.length, 1);
    a.eq(over[0].id, ev);
    a.has((await mod.healthPeople(D.env, cfg)).reportsOverdue.join(" "), "Vigil " + mod.ukDate(today));
    const r = await D.call("report.submit", { eventId: ev, submissionId: "health-vigil-01",
      attendance: { male: 1, female: 1, children: 0 }, ministration: { minister: "Pastor Ade" }, entries: [],
      signature: "John Smith", pin: "1234" }, D.T.A);
    a.ok(r.ok, JSON.stringify(r));
    a.same(await mod.reportsOverdue(D.env, cfg, today), []);
  });

  s.test("a cancelled event is nobody's outstanding report", async (a) => {
    const today = mod.londonKey(new Date());
    const ev = (await D.call("event.save", { type: "PRAYER", title: "Prayer Meeting", date: today }, D.T.hu)).eventId;
    a.eq((await mod.reportsOverdue(D.env, cfg, today)).length, 1);
    a.ok((await D.call("event.cancel", { eventId: ev }, D.T.hu)).ok);
    a.same(await mod.reportsOverdue(D.env, cfg, today), []);
  });

  s.test("somebody still on the default PIN is named until they answer", async (a) => {
    const E = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]]]);
    const made = await E.call("usher.save", { name: "Sade Bello", phone: "07700 900123" }, E.T.admin);
    a.ok(made.ok, JSON.stringify(made));
    a.eq(made.pinFrom, "default");
    const c = await mod.loadConfig(E.env);
    a.same((await mod.healthPeople(E.env, c)).defaultPin, ["Sade Bello"]);
    const tok = (await E.call("login", { usherId: made.usherId, pin: "0123" })).token;
    a.ok(tok, "signed in on the default PIN");
    a.ok((await E.call("pin.keep", {}, tok)).ok, "they chose to keep it");
    a.same((await mod.healthPeople(E.env, c)).defaultPin, [], "the question has been answered");
  });

  s.test("the sender and the report share one query, so neither can go quiet alone", async (a) => {
    /* Emails wait out the quiet hours, so this runs at midday rather than
       whenever the suite happens to run. */
    await at("2026-11-10T12:00:00Z", async () => {
      const E = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["C", "Peter Obi", null, { email: "c@example.org" }]]);
      a.ok((await E.call("notify.send", { title: "Hall change", body: "", usherIds: [E.ID.C] }, E.T.hu)).ok);
      E.env.DB._exec("UPDATE notifications SET type='duty_reminder', emailed=0");
      const c = await mod.loadConfig(E.env);
      a.ok((await mod.healthPeople(E.env, c)).alertsOff.indexOf("Peter Obi") !== -1, "the report names him");
      a.eq(await mod.emailUnalerted(E.env, c, Date.now() + 61 * 60000), 1, "and the email reaches him");
      a.ok((await E.call("push.subscribe", { endpoint: "https://push.example/send/h7-C" }, E.T.C)).ok);
      a.eq((await mod.healthPeople(E.env, c)).alertsOff.indexOf("Peter Obi"), -1, "both read the same list");
      E.env.DB._exec("UPDATE notifications SET emailed=0, read_at=NULL");
      a.eq(await mod.emailUnalerted(E.env, c, Date.now() + 61 * 60000), 0);
    });
  });

  s.test("the open health answer names nobody; only the sheet's token gets names", async (a) => {
    const open = await D.call("health", {});
    a.ok(open.ok);
    a.eq(open.people, undefined, "no names without the sheet token");
    a.ok(open.checks, "the plain checks are still there");
    const sheet = await D.call("health", { sheetToken: "test-sheet-token" });
    a.ok(sheet.people, "the sheet gets the people section");
    a.ok(Array.isArray(sheet.people.alertsOff));
    a.eq((await D.call("health", { sheetToken: "wrong" })).people, undefined, "a wrong token is no token");
  });

  return s;
}
