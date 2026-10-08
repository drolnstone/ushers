/* Brief 14: one Sunday, hour by hour, for one usher and one counter.
   Every other suite checks the right answer; this one checks the right
   answer at the right hour, which is where the Driver App's diary test
   earned its keep. Each step asserts what Home shows, what is unread, and
   what went out to phones and inboxes. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, outbound } from "../lib/worker.mjs";
import { department, notesOf, emailsTo, at, londonAt } from "../lib/people.mjs";

const SUN = "2026-10-11";          /* a Sunday */
const FRI = "2026-10-09";
const FIRST = "S20261011-1", SECOND = "S20261011-2";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("one Sunday, hour by hour");
  let D;
  const titles = (env, id) => notesOf(env, id).map((n) => n.title);
  const pushes = () => outbound.filter((x) => /push/.test(x.url || "")).length;

  s.test("Friday 12:00 — the rota is set, and both are told at once", async (a) => {
    await at(londonAt(mod, FRI, "12:00"), async () => {
      D = await department(mod, root, [
        ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
        ["A", "John Smith", null, { email: "a@example.org" }],
        ["B", "Mary Jones", null, { email: "b@example.org" }],
        ["C", "Peter Obi", null, { email: "c@example.org" }]
      ]);
      await D.call("rota", { from: SUN, weeks: 1 }, D.T.hu);
      a.ok((await D.call("rota.set", { eventId: FIRST, usherIds: [D.ID.A, D.ID.B] }, D.T.hu)).ok);
      a.ok((await D.call("rota.set", { eventId: SECOND, usherIds: [D.ID.B, D.ID.C] }, D.T.hu)).ok);
      a.eq(titles(D.env, D.ID.A)[0], "You are on duty: Sunday First Service");
      a.eq(titles(D.env, D.ID.B)[0], "You are on duty: Sunday Second Service");
      a.eq(titles(D.env, D.ID.hu).length, 0, "the one who set it is not told about it");
    });
  });

  s.test("Friday 17:00 — too early for the duty reminder", async (a) => {
    await at(londonAt(mod, FRI, "17:00"), async () => {
      a.eq(await mod.clockTick(D.env, londonAt(mod, FRI, "17:00")), 0, "reminders go at 18:00, not before");
    });
  });

  s.test("Friday 18:00 — two days before: each person is reminded once, for each duty", async (a) => {
    await at(londonAt(mod, FRI, "18:00"), async () => {
      const n = await mod.clockTick(D.env, londonAt(mod, FRI, "18:00"));
      a.eq(n, 4, "John once, Mary twice (both services), Peter once");
      a.eq(titles(D.env, D.ID.A)[0], "Duty reminder: Sunday First Service");
      a.same(titles(D.env, D.ID.B).slice(0, 2).sort(),
             ["Duty reminder: Sunday First Service", "Duty reminder: Sunday Second Service"]);
      a.eq(await mod.clockTick(D.env, londonAt(mod, FRI, "19:00")), 0, "and not again later the same evening");
    });
  });

  s.test("Sunday 07:00 — Home leads with today's duty, and nothing has gone out overnight", async (a) => {
    await at(londonAt(mod, SUN, "07:00"), async () => {
      const t = await D.as("A");
      const home = await D.call("home", {}, t);
      a.eq(home.today, SUN);
      a.eq(home.thisWeek.length, 1);
      a.eq(home.thisWeek[0].title, "Sunday First Service");
      a.eq(home.thisWeek[0].start, "09:00");
      a.eq(home.thisWeek[0].reportStatusLabel, "Not started");
      a.eq(home.unread, 2, "the duty notice and the reminder");
      a.eq(await mod.clockTick(D.env, londonAt(mod, SUN, "07:00")), 0, "no reminder is due today");
    });
  });

  s.test("Sunday 14:00 — the report is not in yet, and 15:00 is when that is said", async (a) => {
    await at(londonAt(mod, SUN, "14:00"), async () => {
      a.eq(await mod.clockTick(D.env, londonAt(mod, SUN, "14:00")), 0);
    });
    await at(londonAt(mod, SUN, "15:00"), async () => {
      const n = await mod.clockTick(D.env, londonAt(mod, SUN, "15:00"));
      a.ok(n >= 3, "everybody on a duty with a report still to come, got " + n);
      a.eq(titles(D.env, D.ID.A)[0], "Report not yet submitted: Sunday First Service");
    });
  });

  s.test("Sunday 15:30 — John files the First Service report and Mary is asked to countersign", async (a) => {
    await at(londonAt(mod, SUN, "15:30"), async () => {
      const t = await D.as("A");
      const r = await D.call("report.submit", { eventId: FIRST, submissionId: "diary-first-01",
        attendance: { male: 20, female: 30, children: 10 }, ministration: { minister: "Pastor Ade" },
        entries: [{ category: "Tithe", currency: "GBP", denomination: 2000, quantity: 3 }],
        countersignerId: D.ID.B, signature: "John Smith", pin: "1234" }, t);
      a.ok(r.ok, JSON.stringify(r));
      a.eq(titles(D.env, D.ID.B)[0], "Please countersign: Sunday First Service 11/10/2026");
      a.eq(titles(D.env, D.ID.hu).filter((x) => x.indexOf("Report filed") === 0).length, 0,
           "the Head Usher hears when it is countersigned, not before");
      const home = await D.call("home", {}, await D.as("B"));
      a.eq(home.toCountersign.length, 1);
      a.eq(home.toCountersign[0].state, "ready", "she was on that service, so nobody needs to approve her");
    });
  });

  s.test("Sunday 16:00 — Mary countersigns: John is told it is verified, the Head Usher that it is filed", async (a) => {
    await at(londonAt(mod, SUN, "16:00"), async () => {
      const t = await D.as("B");
      const c = await D.call("report.countersign", { reportId: (await D.call("home", {}, t)).toCountersign[0].reportId,
        submissionId: "diary-first-cs", signature: "Mary Jones", pin: "1234" }, t);
      a.ok(c.ok, JSON.stringify(c));
      a.eq(titles(D.env, D.ID.A)[0], "Verified: Sunday First Service 11/10/2026");
      a.eq(titles(D.env, D.ID.hu)[0], "Report filed: Sunday First Service 11/10/2026");
      const m = emailsTo(D.env, "hu@example.org").pop();
      a.has(m.subject, "Report filed");
      a.not(/£|offering \d/.test(m.subject), "no money in a subject line");
    });
  });

  s.test("Sunday 16:05 — and Home now reads back what happened, for both of them", async (a) => {
    await at(londonAt(mod, SUN, "16:05"), async () => {
      const home = await D.call("home", {}, await D.as("A"));
      a.eq(home.thisWeek[0].reportStatusLabel, "Verified");
      const hers = await D.call("home", {}, await D.as("B"));
      a.eq(hers.toCountersign.length, 0, "nothing left waiting on her");
    });
  });

  s.test("Sunday 21:30 — quiet hours: a message is in the app at once, but no phone is woken", async (a) => {
    await at(londonAt(mod, SUN, "21:30"), async () => {
      const t = await D.as("A");
      a.ok((await D.call("push.subscribe", { endpoint: "https://push.example/diary-a" }, t)).ok);
      outbound.length = 0;
      const sent = await D.call("notify.send", { title: "Thank you all", body: "A good Sunday", usherIds: [D.ID.A] }, await D.as("hu"));
      a.ok(sent.ok, JSON.stringify(sent));
      await mod.pushPending(D.env, await mod.loadConfig(D.env), Date.now());
      a.eq(pushes(), 0, "nothing wakes a phone at half past nine");
      a.eq(titles(D.env, D.ID.A)[0], "Thank you all", "but it is there to read");
      a.eq(await mod.emailUnalerted(D.env, await mod.loadConfig(D.env), Date.now()), 0, "and no email either");
    });
  });

  s.test("Monday 08:00 — once quiet hours end, the phone is woken for what it missed", async (a) => {
    await at(londonAt(mod, "2026-10-12", "08:00"), async () => {
      outbound.length = 0;
      await mod.pushPending(D.env, await mod.loadConfig(D.env), Date.now());
      a.ok(pushes() > 0, "the waiting notification wakes the phone in the morning");
    });
  });

  /* The alerts table in the README says the dues reminder is covered here. */
  s.test("and the one alert no other suite sends: the dues reminder", async (a) => {
    await at(londonAt(mod, "2026-10-12", "09:00"), async () => {
      a.ok((await D.call("usher.roles", { usherId: D.ID.C, roles: ["usher", "treasurer"] }, await D.as("admin"))).ok);
      const r = await D.call("dues.remind", {}, await D.as("C"));
      a.ok(r.ok, JSON.stringify(r));
      a.ok(r.sent >= 1, "whoever is behind on this year's dues, got " + r.sent);
      a.eq(titles(D.env, D.ID.A)[0], "Department dues reminder");
      a.has(notesOf(D.env, D.ID.A)[0].body, "outstanding to date");
    });
  });

  return s;
}
