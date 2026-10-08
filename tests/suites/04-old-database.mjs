/* Brief 17A: the code is always newer than somebody's database. The Worker
   brings a database up to date on its first call, so the test that matters
   is the one run against an old one — kept as a fixture rather than read
   from git history, which a shallow clone does not have. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, makeEnv, client } from "../lib/worker.mjs";
import { makeDB } from "../lib/d1.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = "tests/fixtures/schema-w0.3.5.sql";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("a database older than the code");
  const old = readFileSync(join(root, FIXTURE), "utf8");
  let env, call, T = {}, ID = {};

  s.test("the fixture really is old: it has none of the later tables or columns", (a) => {
    for (const later of ["ics_json", "sent_log", "queued_done", "pin_must_change"]) {
      a.not(new RegExp(later).test(old), "no " + later + " in " + FIXTURE);
    }
  });

  s.test("an old database with people, an event and a report in it", async (a) => {
    env = makeEnv(root, { DB: makeDB(join(root, FIXTURE)) });
    call = client(mod, env);
    /* Rows as the old code would have left them, written with the old
       columns only. */
    const now = Date.now() - 86400000;
    env.DB._exec("INSERT INTO ushers (id, full_name, phone, email, active, created_at, updated_at) VALUES " +
      "('U001','Grace Okafor','07700900001','hu@example.org',1," + now + "," + now + ")," +
      "('U002','John Smith','07700900002','a@example.org',1," + now + "," + now + ")");
    env.DB._exec("INSERT INTO user_roles (usher_id, role, granted_at, granted_by) VALUES " +
      "('U001','usher'," + now + ",'U001'),('U001','head_usher'," + now + ",'U001'),('U002','usher'," + now + ",'U001')");
    env.DB._exec("INSERT INTO push_subs (usher_id, endpoint, created_at, seen, fails) VALUES ('U002','https://push.example/old'," + now + "," + now + ",0)");
    env.DB._exec("INSERT INTO notifications (id, usher_id, type, title, body, created_at) VALUES ('N1','U002','duty','You are on duty','',"+ now +")");
    /* PINs are set through the server, so they are hashed as the current
       code hashes them. */
    const cfg = await mod.loadConfig(env);
    for (const id of ["U001", "U002"]) {
      const f = await mod.newPinFields(env, cfg, "1234");
      env.DB._exec("UPDATE ushers SET pin_salt='" + f.pin_salt + "', pin_hash='" + f.pin_hash +
                   "', pin_iter=" + f.pin_iter + ", pin_set_at=" + f.pin_set_at + " WHERE id='" + id + "'");
    }
    a.ok(env.DB._one("SELECT pin_hash FROM ushers WHERE id='U001'").pin_hash, "PINs as the old code left them");
  });

  s.test("the first call brings it up to date", async (a) => {
    const me = await call("login", { usherId: "U001", pin: "1234" });
    a.ok(me.ok, JSON.stringify(me));
    T.hu = me.token;
    for (const [table, col] of [["notifications", "ics_json"], ["ushers", "pin_must_change"]]) {
      const cols = env.DB._rows("PRAGMA table_info(" + table + ")").map((c) => c.name);
      a.ok(cols.indexOf(col) !== -1, table + " gained " + col);
    }
    for (const table of ["sent_log", "queued_done", "report_versions"]) {
      a.ok(env.DB._one("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table), table + " was added");
    }
  });

  s.test("and then a whole Sunday works on it: rota, duty, report, countersignature", async (a) => {
    const sunday = mod.sundayOnOrAfter(mod.londonKey(new Date()));
    const first = "S" + sunday.replace(/-/g, "") + "-1";
    a.ok((await call("rota", { from: sunday, weeks: 1 }, T.hu)).ok);
    const set = await call("rota.set", { eventId: first, usherIds: ["U001", "U002"] }, T.hu);
    a.ok(set.ok, JSON.stringify(set));
    T.a = (await call("login", { usherId: "U002", pin: "1234" })).token;
    const home = await call("home", {}, T.a);
    a.ok(home.ok, JSON.stringify(home));
    const sub = await call("report.submit", { eventId: first, submissionId: "olddb-0001",
      attendance: { male: 2, female: 3, children: 1 }, ministration: { minister: "Pastor Ade" },
      entries: [{ category: "Tithe", currency: "GBP", denomination: 2000, quantity: 2 }],
      countersignerId: "U001", signature: "John Smith", pin: "1234" }, T.a);
    a.ok(sub.ok, JSON.stringify(sub));
    const cs = await call("report.countersign", { reportId: sub.report.id, submissionId: "olddb-cs-01",
      signature: "Grace Okafor", pin: "1234" }, T.hu);
    a.ok(cs.ok, JSON.stringify(cs));
    const notes = await call("notifications.list", {}, T.a);
    a.ok(notes.ok, JSON.stringify(notes));
    a.ok(notes.notifications.some((n) => n.title.indexOf("You are on duty") === 0), "the old notification and the new ones read together");
  });

  s.test("the newest features work on it too: what went out, and a duty in the diary", async (a) => {
    const sent = await call("sent.list", { days: 7 }, T.hu);
    a.ok(sent.ok, JSON.stringify(sent));
    a.ok(sent.sent.length > 0, "the new table is being written");
    const mail = env.DB._rows("SELECT row_json FROM outbox WHERE tab='@email'").map((r) => JSON.parse(r.row_json));
    a.ok(mail.some((m) => m.ics && m.ics.uid), "a diary entry travelled with a duty email");
  });

  return s;
}
