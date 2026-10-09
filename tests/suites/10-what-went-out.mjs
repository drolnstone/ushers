/* Brief 10: what went out. After a message or a reminder run, the Head
   Usher can see whether it went and how many it reached, a run that reached
   nobody included. Read by admins only, and never a money figure. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { at, department, notesOf } from "../lib/people.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("what went out");
  let D;

  s.test("set up: four ushers — two with phones, one email only, one reachable by nothing", async (a) => {
    D = await department(mod, root, [
      ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
      ["A", "John Smith", null, { email: "a@example.org" }],
      ["B", "Mary Jones", null, { email: "b@example.org" }],
      ["C", "Peter Obi", null, { email: "c@example.org" }],
      ["E", "Sade Bello"]
    ]);
    for (const k of ["A", "B"]) a.ok((await D.call("push.subscribe", { endpoint: "https://push.example/send/w-" + k }, D.T[k])).ok);
  });

  s.test("a message to three says how far it reached, and tells the sender", async (a) => {
    const r = await D.call("notify.send", { title: "Retreat on Saturday", body: "Bring a coat", usherIds: [D.ID.A, D.ID.B, D.ID.C] }, D.T.hu);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.sent, 3);
    a.eq(r.phones, 2, "two have alerts on");
    a.eq(r.emails, 1, "one is reachable only by email");
    a.eq(r.unreachable, 0);
    const told = notesOf(D.env, D.ID.hu).filter((n) => n.type === "sent_report");
    a.eq(told.length, 1, "the sender is told once");
    a.has(told[0].title, "Sent to 3: Retreat on Saturday");
    a.has(told[0].body, "2 phones, 1 email, 0 unreachable.");
    const list = await D.call("sent.list", {}, D.T.hu);
    a.ok(list.ok, JSON.stringify(list));
    const mine = list.sent.filter((x) => x.title === "Retreat on Saturday");
    a.eq(mine.length, 2, "one line for the phones, one for the emails");
    a.eq(mine.filter((x) => x.kind === "push")[0].reached, 2);
    a.eq(mine.filter((x) => x.kind === "email")[0].reached, 1);
    a.eq(mine[0].by, "Grace Okafor", "and who sent it");
  });

  s.test("a message that reaches nobody still shows, with 0", async (a) => {
    const E = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["C", "Peter Obi"]]);
    const r = await E.call("notify.send", { title: "Nobody home", body: "", usherIds: [E.ID.C] }, E.T.hu);
    a.ok(r.ok);
    a.eq(r.phones, 0);
    a.eq(r.emails, 0);
    a.eq(r.unreachable, 1, "no phone and no email");
    const line = (await E.call("sent.list", {}, E.T.hu)).sent.filter((x) => x.title === "Nobody home");
    a.eq(line.length, 2);
    for (const x of line) a.eq(x.reached, 0, x.kind);
    a.has(notesOf(E.env, E.ID.hu).filter((n) => n.type === "sent_report")[0].body, "1 unreachable.");
  });

  s.test("a reminder run lists a line and tells nobody", async (a) => {
    const E = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["A", "John Smith", null, { email: "a@example.org" }]]);
    const sunday = mod.sundayOnOrAfter(mod.londonKey(new Date()));
    await E.call("rota", { from: sunday, weeks: 1 }, E.T.hu);
    a.ok((await E.call("rota.set", { eventId: "S" + sunday.replace(/-/g, "") + "-1", usherIds: [E.ID.A] }, E.T.hu)).ok);
    const cfg = await mod.loadConfig(E.env);
    const day = mod.keyAddDays(sunday, -cfg.duty_reminder_days[0]);
    const sent = await mod.clockTick(E.env, new Date(Date.parse(day + "T" + String(cfg.reminder_hour).padStart(2, "0") + ":30:00Z")));
    a.eq(sent, 1, "one duty reminder");
    const lines = (await E.call("sent.list", {}, E.T.hu)).sent.filter((x) => x.type === "reminder");
    a.eq(lines.length, 1);
    a.eq(lines[0].toCount, 1);
    a.eq(notesOf(E.env, E.ID.hu).filter((n) => n.type === "sent_report").length, 0, "a reminder run notifies nobody");
  });

  s.test("the email to people with alerts off lists its run too", async (a) => {
    /* Emails wait out the quiet hours, so this runs at midday rather than
       whenever the suite happens to run. */
    await at("2026-11-10T12:00:00Z", async () => {
      const E = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["C", "Peter Obi", null, { email: "c@example.org" }]]);
      a.ok((await E.call("notify.send", { title: "Hall change", body: "", usherIds: [E.ID.C] }, E.T.hu)).ok);
      E.env.DB._exec("UPDATE notifications SET type='duty_reminder', emailed=0");
      a.eq(await mod.emailUnalerted(E.env, await mod.loadConfig(E.env), Date.now() + 61 * 60000), 1);
      const line = (await E.call("sent.list", {}, E.T.hu)).sent.filter((x) => x.type === "unalerted");
      a.eq(line.length, 1);
      a.eq(line[0].reached, 1);
    });
  });

  s.test("a plain usher cannot read it", async (a) => {
    a.eq((await D.call("sent.list", {}, D.T.A))._status, 403);
    a.eq((await D.call("sent.list", {}, D.T.C))._status, 403);
    a.ok((await D.call("sent.list", {}, D.T.admin)).ok, "the System Administrator can, for testing");
  });

  s.test("no line carries a money figure", async (a) => {
    const list = await D.call("sent.list", {}, D.T.hu);
    for (const x of list.sent) {
      a.hasnt(x.title, "£");
      a.hasnt(JSON.stringify(x), "offering");
      a.hasnt(JSON.stringify(x), "dues");
    }
  });

  s.test("only the last fortnight, and at most ninety days", async (a) => {
    D.env.DB._exec("INSERT INTO sent_log (at, kind, type, title, to_count, reached) VALUES (" + (Date.now() - 40 * 86400000) + ", 'push', 'admin_message', 'Last month', 3, 3)");
    a.eq((await D.call("sent.list", {}, D.T.hu)).sent.filter((x) => x.title === "Last month").length, 0, "older than a fortnight");
    a.eq((await D.call("sent.list", { days: 60 }, D.T.hu)).sent.filter((x) => x.title === "Last month").length, 1);
    a.eq((await D.call("sent.list", { days: 9999 }, D.T.hu)).days, 90, "ninety days at most");
  });

  return s;
}
