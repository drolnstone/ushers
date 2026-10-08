/* Brief 09: adding Ushers to the phone. On iPhone an alert reaches nobody
   until the app is on the Home Screen, so the app offers to install, the
   server keeps a note of who has, and anybody who has not is nudged once a
   week and can be sent the steps by hand. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department, notesOf, emailsTo, at, londonAt } from "../lib/people.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("adding Ushers to the phone");
  let D, cfg;
  const names = (p) => p.notInstalled;

  s.test("set up: nobody has it on a phone yet", async (a) => {
    D = await department(mod, root, [
      ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
      ["A", "John Smith", null, { email: "a@example.org" }],
      ["B", "Mary Jones", null, { email: "b@example.org" }]
    ]);
    cfg = await mod.loadConfig(D.env);
    const p = await mod.healthPeople(D.env, cfg);
    a.ok(names(p).indexOf("John Smith") !== -1, "Check everything says so");
    a.ok(names(p).indexOf("Grace Okafor") !== -1);
    const list = await D.call("ushers.list", {}, D.T.hu);
    a.eq(list.ushers.every((u) => u.installed === false), true, "and Admin -> Ushers marks them all");
  });

  s.test("opening it from the Home Screen is what counts, and only then", async (a) => {
    a.ok((await D.call("me", {}, D.T.A)).ok, "opened in a browser tab: nothing is claimed");
    a.eq(D.env.DB._one("SELECT installed_at FROM ushers WHERE id=?", D.ID.A).installed_at, null);
    const me = await D.call("me", { installed: true }, D.T.A);
    a.ok(me.ok, JSON.stringify(me));
    a.ok(D.env.DB._one("SELECT installed_at FROM ushers WHERE id=?", D.ID.A).installed_at > 0, "now it is on a phone");
    const p = await mod.healthPeople(D.env, cfg);
    a.eq(names(p).indexOf("John Smith"), -1, "and Check everything drops him");
    const list = await D.call("ushers.list", {}, D.T.hu);
    a.eq(list.ushers.find((u) => u.usherId === D.ID.A).installed, true);
  });

  s.test("it is a note of what they have ever done, not of what they are holding now", async (a) => {
    const first = D.env.DB._one("SELECT installed_at FROM ushers WHERE id=?", D.ID.A).installed_at;
    a.ok((await D.call("me", {}, D.T.A)).ok, "the same person in a browser tab the next day");
    a.eq(D.env.DB._one("SELECT installed_at FROM ushers WHERE id=?", D.ID.A).installed_at, first, "the note stands");
  });

  s.test("the me answer carries the address of the guide, for the app to link to", async (a) => {
    const me = await D.call("me", {}, D.T.A);
    a.has(me.installGuide, "/install.html");
  });

  s.test("anybody who has not is nudged once a week, by app and by email", async (a) => {
    /* Wednesday 18:00: the weekly nudge. */
    const wed = "2026-10-14";
    await at(londonAt(mod, wed, "18:00"), async () => {
      const n = await mod.clockTick(D.env, londonAt(mod, wed, "18:00"));
      a.ok(n >= 3, "everybody without it, got " + n);
      a.eq(notesOf(D.env, D.ID.B)[0].title, "Add Ushers to your phone");
      a.has(notesOf(D.env, D.ID.B)[0].body, "Add to Home Screen");
      a.eq(notesOf(D.env, D.ID.A).filter((x) => x.type === "install").length, 0, "not the one who has it");
      const m = emailsTo(D.env, "b@example.org").pop();
      a.has(m.subject, "Add Ushers to your phone");
      a.has(m.body, "install.html", "the guide is linked");
      a.eq(await mod.clockTick(D.env, londonAt(mod, wed, "19:00")), 0, "and not twice in one week");
    });
    await at(londonAt(mod, "2026-10-15", "18:00"), async () => {
      a.eq(await mod.clockTick(D.env, londonAt(mod, "2026-10-15", "18:00")), 0, "nor on the other days");
    });
    await at(londonAt(mod, "2026-10-21", "18:00"), async () => {
      a.ok(await mod.clockTick(D.env, londonAt(mod, "2026-10-21", "18:00")) >= 3, "but again the week after");
    });
  });

  s.test("and it stops for good once they have it", async (a) => {
    await at(londonAt(mod, "2026-10-28", "09:00"), async () => {
      a.ok((await D.call("me", { installed: true }, await D.as("B"))).ok);
    });
    await at(londonAt(mod, "2026-10-28", "18:00"), async () => {
      const before = notesOf(D.env, D.ID.B).filter((x) => x.type === "install").length;
      await mod.clockTick(D.env, londonAt(mod, "2026-10-28", "18:00"));
      a.eq(notesOf(D.env, D.ID.B).filter((x) => x.type === "install").length, before, "nothing more for her");
    });
  });

  s.test("the Head Usher can send the steps now, to one person or to everybody left", async (a) => {
    const one = await D.call("install.steps", { usherIds: [D.ID.hu] }, D.T.hu);
    a.ok(one.ok, JSON.stringify(one));
    a.same(one.names, ["Grace Okafor"]);
    a.eq(notesOf(D.env, D.ID.hu)[0].title, "Add Ushers to your phone");
    const hasIt = await D.call("install.steps", { usherIds: [D.ID.A] }, D.T.hu);
    a.eq(hasIt.ok, false, "and not to somebody who has it");
    a.has(hasIt.message, "already");
    const all = await D.call("install.steps", {}, D.T.hu);
    a.ok(all.ok, JSON.stringify(all));
    a.ok(all.sent >= 1);
    const log = D.env.DB._rows("SELECT * FROM sent_log WHERE type='install' ORDER BY at");
    a.ok(log.length >= 2, "and what went out says so");
  });

  s.test("an usher cannot send them, and nobody is told how a PIN is made", async (a) => {
    const no = await D.call("install.steps", {}, await D.as("A"));
    a.eq(no.ok, false);
    a.eq(no._status, 403);
    const guide = readFileSync(join(root, "install.html"), "utf8");
    a.not(/phone number|last four/i.test(guide), "the guide never says where a default PIN comes from");
    a.has(guide, "Add to Home Screen");
    a.has(guide, "Install");
  });

  return s;
}
