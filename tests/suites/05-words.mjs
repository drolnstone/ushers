/* Brief 05: prompts and instructions only. Every sentence cut here is kept
   in the list below so it cannot come back, and every label is checked
   against the record it describes, so nothing says one thing of another. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department } from "../lib/people.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Cut on 8 October 2026. Each explained the app rather than saying what to
   do or what happened. */
const CUT = [
  "This phone will be told the moment anything new arrives.",
  "To be told on your phone instead, tap the bell",
  "waiting for connection",
  "It will be sent automatically.",
  "You will be told when it is decided.",
  "Their reports and dues stay on the record.",
  "You can bring them back by ticking Active.",
  "You are confirming it, not filling in another one.",
  "This makes the first System Administrator, who then adds everyone else.",
  "It shows once the signal is back.",
  "Each rule is stored on the server and written to the CONFIG tab.",
  "it is sent when the signal is back",
  "sent when the signal is back"
];

const SCREENS = ["index.html", "admin/index.html", "shared/core.js", "shared/reports.js", "shared/pdf.js", "admin/testing.js", "server/worker.js"];

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("plain words");
  const text = SCREENS.map((f) => readFileSync(join(root, f), "utf8")).join("\n");

  for (const phrase of CUT) {
    s.test("gone, and stays gone: “" + phrase.slice(0, 48) + "”", (a) => a.hasnt(text, phrase));
  }

  s.test("a test alert says only that it is a test", async (a) => {
    const D = await department(mod, root, [["A", "John Smith"]]);
    const ep = "https://push.example/send/words-A";
    a.ok((await D.call("push.subscribe", { endpoint: ep }, D.T.A)).ok);
    a.ok((await D.call("push.test", { endpoint: ep }, D.T.A)).ok);
    const w = await D.call("push.what", { endpoint: ep });
    a.eq(w.title, "Test.");
    a.eq(w.body, "");
  });

  /* WORDS MATCH WHAT IS BEHIND THEM. A label is only as good as the record
     it is read off, so each one is checked against a real report. */
  s.test("every status label is the status it is read from", (a) => {
    const want = { draft: "Draft", submitted: "Submitted", pending_countersignature: "Pending Countersignature", verified: "Verified" };
    a.same(mod.STATUS_LABELS, want);
  });

  let D, sunday, first, other, rep;
  s.test("set up: a Sunday service and a prayer meeting, both reported", async (a) => {
    D = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["A", "John Smith"], ["B", "Mary Jones"]]);
    sunday = mod.sundayOnOrAfter(mod.londonKey(new Date()));
    first = "S" + sunday.replace(/-/g, "") + "-1";
    await D.call("rota", { from: sunday, weeks: 1 }, D.T.hu);
    a.ok((await D.call("rota.set", { eventId: first, usherIds: [D.ID.A, D.ID.B] }, D.T.hu)).ok);
    const ev = await D.call("event.save", { type: "PRAYER", title: "Prayer Meeting", date: sunday }, D.T.hu);
    a.ok(ev.ok, JSON.stringify(ev));
    other = ev.eventId;
    a.ok((await D.call("rota.set", { eventId: other, usherIds: [D.ID.A] }, D.T.hu)).ok);
  });

  s.test("“Pending Countersignature” is only said of a report that is waiting for one", async (a) => {
    const body = (eventId, sid, extra) => Object.assign({ eventId, submissionId: sid, attendance: { male: 1, female: 1, children: 0 },
      ministration: { minister: "Pastor Ade" }, entries: [{ category: "Tithe", currency: "GBP", denomination: 1000, quantity: 1 }],
      signature: "John Smith", pin: "1234" }, extra || {});
    const sun = await D.call("report.submit", body(first, "words-sun-01", { countersignerId: D.ID.B }), D.T.A);
    a.ok(sun.ok, JSON.stringify(sun));
    rep = sun.report.id;
    a.eq(sun.report.status, "pending_countersignature");
    a.eq(sun.report.statusLabel, "Pending Countersignature");

    const pray = await D.call("report.submit", body(other, "words-pray-01"), D.T.A);
    a.ok(pray.ok, JSON.stringify(pray));
    a.eq(pray.report.status, "verified", "an event that needs no countersignature is filed at once");
    a.eq(pray.report.statusLabel, "Verified");
    a.ne(pray.report.statusLabel, "Pending Countersignature", "never said of an event that needs none");
  });

  s.test("“Verified” is only said once it is countersigned", async (a) => {
    const cs = await D.call("report.countersign", { reportId: rep, submissionId: "words-cs-01", signature: "Mary Jones", pin: "1234" }, D.T.B);
    a.ok(cs.ok, JSON.stringify(cs));
    const v = await D.call("report.open", { reportId: rep }, D.T.hu);
    a.eq(v.report.status, "verified");
    a.eq(v.report.statusLabel, "Verified");
  });

  s.test("“Report not yet submitted” is only sent while no report has been", async (a) => {
    const today = mod.londonKey(new Date());
    const ev = (await D.call("event.save", { type: "VIGIL", title: "Vigil", date: today }, D.T.hu)).eventId;
    a.ok((await D.call("rota.set", { eventId: ev, usherIds: [D.ID.B] }, D.T.hu)).ok);
    const cfg = await mod.loadConfig(D.env);
    const at = new Date(Date.parse(today + "T" + String(cfg.report_reminder_hour).padStart(2, "0") + ":30:00Z"));
    await mod.clockTick(D.env, at);
    const asked = D.env.DB._rows("SELECT * FROM notifications WHERE usher_id=? AND type='report_reminder'", D.ID.B);
    a.eq(asked.length, 1, "asked once, for the event with no report");
    a.has(asked[0].title, "Report not yet submitted: Vigil");
    a.eq(D.env.DB._rows("SELECT * FROM notifications WHERE type='report_reminder' AND title LIKE '%Prayer Meeting%'").length, 0,
      "the prayer meeting's report is in, so nobody is asked for it");
  });

  return s;
}
