/* Brief 15: the month's summary, sent rather than asked for, on the evening
   of the last Sunday. The figures are the same arithmetic as Admin ->
   Reports, and money is held back: a summary tells nobody anything they
   could not already open in the app. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department, notesOf, emailsTo, at, londonAt } from "../lib/people.mjs";

/* October 2026: Sundays fall on the 4th, 11th, 18th and 25th. */
const LAST = "2026-10-25";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("the month's summary");
  let D, cfg;
  const note = (k, start) => notesOf(D.env, D.ID[k]).find((n) => n.title.indexOf(start) === 0);

  s.test("the last Sunday of the month is found, whatever shape the month is", (a) => {
    a.eq(mod.lastSundayOfMonth("2026-10-01"), LAST);
    a.eq(mod.lastSundayOfMonth("2026-10-25"), LAST);
    a.eq(mod.lastSundayOfMonth("2026-11-11"), "2026-11-29", "a month that ends on a Monday");
    a.eq(mod.lastSundayOfMonth("2026-02-03"), "2026-02-22");
    a.eq(mod.lastSundayOfMonth("2026-12-01"), "2026-12-27");
  });

  s.test("set up: a month with two reports filed and one not", async (a) => {
    await at(londonAt(mod, "2026-10-04", "12:00"), async () => {
      D = await department(mod, root, [
        ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
        ["ahu", "Paul Mensah", ["usher", "assistant_head_usher"], { email: "ahu@example.org" }],
        ["tr", "Esther Bello", ["usher", "treasurer"], { email: "tr@example.org" }],
        ["A", "John Smith", null, { email: "a@example.org" }],
        ["B", "Mary Jones", null, { email: "b@example.org" }]
      ]);
      cfg = await mod.loadConfig(D.env);
      await D.call("rota", { from: "2026-10-04", weeks: 4 }, D.T.hu);
      for (const day of ["20261004", "20261011"]) {
        const ev = "S" + day + "-1";
        a.ok((await D.call("rota.set", { eventId: ev, usherIds: [D.ID.A, D.ID.B] }, D.T.hu)).ok);
        const r = await D.call("report.submit", { eventId: ev, submissionId: "sum-" + day,
          attendance: { male: 10, female: 20, children: 5 }, ministration: { minister: "Pastor Ade" },
          entries: [{ category: "Tithe", currency: "GBP", denomination: 2000, quantity: 5 }],
          countersignerId: D.ID.B, signature: "John Smith", pin: "1234" }, D.T.A);
        a.ok(r.ok, JSON.stringify(r));
        a.ok((await D.call("report.countersign", { reportId: r.report.id, submissionId: "sum-cs-" + day,
          signature: "Mary Jones", pin: "1234" }, D.T.B)).ok);
      }
      a.ok((await D.call("rota.set", { eventId: "S20261018-1", usherIds: [D.ID.A] }, D.T.hu)).ok);
    });
  });

  s.test("nothing goes before the evening, or on any other Sunday", async (a) => {
    await at(londonAt(mod, LAST, "17:00"), async () => {
      a.eq(await mod.summaryDue(D.env, cfg, londonAt(mod, LAST, "17:00")), 0, "too early");
    });
    await at(londonAt(mod, "2026-10-18", "19:30"), async () => {
      a.eq(await mod.summaryDue(D.env, cfg, londonAt(mod, "2026-10-18", "19:30")), 0, "not the last Sunday");
    });
  });

  s.test("on the last Sunday at 19:00 it goes, once, to the people it is for", async (a) => {
    await at(londonAt(mod, LAST, "19:05"), async () => {
      const n = await mod.summaryDue(D.env, cfg, londonAt(mod, LAST, "19:05"));
      a.eq(n, 3, "the Head Usher, the Assistant and the Treasurer");
      a.eq(await mod.summaryDue(D.env, cfg, londonAt(mod, LAST, "20:05")), 0, "and not twice in one month");
    });
  });

  s.test("it says what the month held, and what is still missing", async (a) => {
    const m = note("hu", "Summary for October 2026");
    a.ok(m, "the Head Usher has it");
    a.has(m.body, "Services and events: 8");
    a.has(m.body, "Reports filed: 2 (2 countersigned, 0 still waiting)");
    a.has(m.body, "Attendance: 70 in all (20 men, 40 women, 10 children)");
    a.has(m.body, "Still to come: ");
    a.has(m.body, "Sunday First Service 18/10/2026", "the Sunday nobody reported on");
    const mail = emailsTo(D.env, "hu@example.org").filter((x) => x.subject.indexOf("Summary for October") === 0).pop();
    a.ok(mail, "and by email");
  });

  s.test("money goes only to whoever may see it", async (a) => {
    a.has(note("hu", "Summary for October 2026").body, "Offering: £200.00", "the Head Usher sees the offering");
    a.has(note("hu", "Summary for October 2026").body, "Tithe: £200.00");
    const tr = note("tr", "Summary for October 2026");
    a.ok(tr, "the Treasurer has one too");
    a.not(/Offering: /.test(tr.body), "but no offering figures: that is not the Treasurer's");
    a.has(tr.body, "Dues 2026:", "her own figures are there instead");
    a.not(/Dues 2026/.test(note("hu", "Summary for October 2026").body), "and the Head Usher sees no dues");
    a.eq(note("admin", "Summary for October 2026"), undefined, "the System Administrator is sent none at all");
    a.eq(note("A", "Summary for October 2026"), undefined, "nor an usher");
  });

  s.test("December sends the year's as well as the month's", async (a) => {
    await at(londonAt(mod, "2026-12-27", "19:05"), async () => {
      const n = await mod.summaryDue(D.env, cfg, londonAt(mod, "2026-12-27", "19:05"));
      a.eq(n, 6, "three people, two summaries each");
      a.ok(note("hu", "Summary for December 2026"), "the month");
      a.ok(note("hu", "Summary for 2026"), "and the year");
      a.has(note("hu", "Summary for 2026").body, "Reports filed: 2", "the year carries the whole year");
      a.eq(await mod.summaryDue(D.env, cfg, londonAt(mod, "2026-12-27", "21:05")), 0, "once each");
    });
  });

  s.test("the summary's figures are the Admin App's figures", async (a) => {
    await at(londonAt(mod, LAST, "19:10"), async () => {
      const p = await D.call("reports.period", { from: "2026-10-01", to: LAST }, await D.as("hu"));
      a.ok(p.ok, JSON.stringify(p));
      a.has(note("hu", "Summary for October 2026").body, "Attendance: " + p.totals.attendance + " in all");
      a.has(note("hu", "Summary for October 2026").body, "Services and events: " + p.totals.events);
    });
  });

  return s;
}
