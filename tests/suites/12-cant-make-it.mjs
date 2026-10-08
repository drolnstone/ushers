/* Brief 12: an usher says beforehand that they cannot make a duty. The Head
   Usher decides and finds the cover. Four paths: approved with cover,
   approved without, covered afterwards, and refused — and a refusal reaches
   nobody but the person who asked, because a suggested cover was never
   asked in the first place. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department, notesOf, at, londonAt } from "../lib/people.mjs";

const SUN = "2026-10-11", FIRST = "S20261011-1", SECOND = "S20261011-2";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("I can't make it");
  let D, cfg, apFirst, apSecond, req;
  const noteOf = (k, start) => notesOf(D.env, D.ID[k]).find((n) => n.title.indexOf(start) === 0);
  const appt = (ev, k) => D.env.DB._one("SELECT * FROM appointments WHERE event_id=? AND usher_id=? AND status<>'removed'", ev, D.ID[k]);

  s.test("set up: two Sunday services, a week ahead", async (a) => {
    await at(londonAt(mod, "2026-10-05", "12:00"), async () => {
      D = await department(mod, root, [
        ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
        ["A", "John Smith", null, { email: "a@example.org" }],
        ["B", "Mary Jones", null, { email: "b@example.org" }],
        ["C", "Peter Obi", null, { email: "c@example.org" }],
        ["D", "Ruth Adeyemi", null, { email: "d@example.org" }]
      ]);
      cfg = await mod.loadConfig(D.env);
      await D.call("rota", { from: SUN, weeks: 1 }, D.T.hu);
      a.ok((await D.call("rota.set", { eventId: FIRST, usherIds: [D.ID.A, D.ID.B] }, D.T.hu)).ok);
      a.ok((await D.call("rota.set", { eventId: SECOND, usherIds: [D.ID.C, D.ID.D] }, D.T.hu)).ok);
      apFirst = appt(FIRST, "A").id;
      apSecond = appt(SECOND, "C").id;
    });
  });

  s.test("an usher asks, with a reason, and the duty is still theirs until it is answered", async (a) => {
    await at(londonAt(mod, "2026-10-05", "12:30"), async () => {
      const bad = await D.call("authorisation.request", { kind: "duty_release", appointmentId: apFirst }, await D.as("A"));
      a.eq(bad.ok, false, "a reason is needed");
      a.has(bad.message, "why you cannot make it");
      const notMine = await D.call("authorisation.request", { kind: "duty_release", appointmentId: apFirst, reason: "I want his duty off" }, await D.as("B"));
      a.eq(notMine.ok, false, "and it must be their own duty");
      a.eq(notMine._status, 403);
      req = await D.call("authorisation.request", { kind: "duty_release", appointmentId: apFirst, reason: "Away at a wedding", suggestId: D.ID.D }, await D.as("A"));
      a.ok(req.ok, JSON.stringify(req));
      a.eq(req.status, "pending");
      a.eq(req.late, false, "a week ahead is not late");
      a.eq(appt(FIRST, "A").status, "active", "still on duty while it waits");
      const asked = noteOf("hu", "Approval needed: Can't make a duty");
      a.ok(asked, "the Head Usher is asked");
      a.has(asked.body, "Away at a wedding");
      a.has(asked.body, "who has not been asked", "the suggestion is a suggestion, not an invitation");
      a.eq(noteOf("D", "You are on duty: Sunday First Service"), undefined, "and the suggested cover hears nothing");
      const home = await D.call("home", {}, await D.as("A"));
      a.eq(home.thisWeek.concat(home.later).find((x) => x.eventId === FIRST).released, "pending", "his own card says he has asked");
    });
  });

  s.test("approved with the cover named: the duty moves, and both of them are told", async (a) => {
    await at(londonAt(mod, "2026-10-05", "13:00"), async () => {
      const list = await D.call("authorisations.list", { status: "pending" }, await D.as("hu"));
      const one = list.authorisations.find((x) => x.id === req.authorisationId);
      a.ok(one.cover && one.cover.length, "the picker has names");
      const d = one.cover.find((x) => x.usherId === D.ID.C);
      a.eq(d.onDutyThatDay, true, "Peter Obi is already on that Sunday, and it says so");
      a.eq(one.cover.find((x) => x.usherId === D.ID.D).onDutyThatDay, true);
      const dec = await D.call("authorisation.decide", { id: req.authorisationId, decision: "approve", coverId: D.ID.D, pin: "1234" }, await D.as("hu"));
      a.ok(dec.ok, JSON.stringify(dec));
      a.eq(dec.status, "consumed", "done with: the duty is covered");
      a.eq(appt(FIRST, "A").status, "released", "his name stays on the record, released");
      a.eq(appt(FIRST, "D").status, "active", "and Ruth Adeyemi is on it");
      a.has(noteOf("A", "You are off duty: Sunday First Service").body, "Ruth Adeyemi is covering it");
      a.has(noteOf("D", "You are on duty: Sunday First Service").body, "covering for John Smith");
      a.eq(noteOf("B", "You are off duty: Sunday First Service"), undefined, "nobody else is told");
    });
  });

  s.test("approved with nobody named: the duty is a gap and the request waits for cover", async (a) => {
    await at(londonAt(mod, "2026-10-05", "14:00"), async () => {
      const r = await D.call("authorisation.request", { kind: "duty_release", appointmentId: apSecond, reason: "Night shift" }, await D.as("C"));
      a.ok(r.ok, JSON.stringify(r));
      const dec = await D.call("authorisation.decide", { id: r.authorisationId, decision: "approve", pin: "1234" }, await D.as("hu"));
      a.ok(dec.ok, JSON.stringify(dec));
      a.eq(dec.status, "approved", "approved, cover to be arranged");
      a.eq(appt(SECOND, "C").status, "released");
      a.has(noteOf("C", "You are off duty: Sunday Second Service").body, "replacement is still to be arranged");
      /* The gap is real: Check everything and the dashboard read the
         appointment's status, not the name on it. */
      const gaps = await mod.sundayGaps(D.env, cfg, SUN);
      a.ok(gaps.some((g) => g.title.indexOf("Second Service") !== -1), "the Sunday is short, and it says so: " + JSON.stringify(gaps));
      const waiting = await D.call("authorisations.list", {}, await D.as("hu"));
      a.ok(waiting.authorisations.find((x) => x.id === r.authorisationId).needsCover, "and Approvals asks for the cover");
      /* And no reminder goes to somebody who is off the duty. */
      const day = mod.keyAddDays(SUN, -cfg.duty_reminder_days[0]);
      await at(londonAt(mod, day, "18:00"), async () => {
        await mod.clockTick(D.env, londonAt(mod, day, "18:00"));
        a.eq(notesOf(D.env, D.ID.C).filter((n) => n.title.indexOf("Duty reminder: Sunday Second") === 0).length, 0,
             "a reminder reads the status, not the name");
      });
      req = r;
    });
  });

  s.test("cover arranged afterwards finishes the request", async (a) => {
    await at(londonAt(mod, "2026-10-06", "09:00"), async () => {
      const no = await D.call("duty.cover", { id: req.authorisationId, coverId: D.ID.C, pin: "1234" }, await D.as("hu"));
      a.eq(no.ok, false, "not the person who asked to be let off");
      const done = await D.call("duty.cover", { id: req.authorisationId, coverId: D.ID.B, pin: "1234" }, await D.as("hu"));
      a.ok(done.ok, JSON.stringify(done));
      a.eq(done.cover, "Mary Jones");
      a.eq(appt(SECOND, "B").status, "active");
      a.has(noteOf("C", "Covered: Sunday Second Service").body, "Mary Jones is covering");
      a.has(noteOf("B", "You are on duty: Sunday Second Service").body, "covering for Peter Obi");
      const again = await D.call("duty.cover", { id: req.authorisationId, coverId: D.ID.D, pin: "1234" }, await D.as("hu"));
      a.eq(again.ok, false, "and not twice");
      a.has(again.message, "covered already");
    });
  });

  s.test("refused: only the person who asked hears, and only told they are still on duty if they are", async (a) => {
    await at(londonAt(mod, "2026-10-06", "10:00"), async () => {
      const r = await D.call("authorisation.request", { kind: "duty_release", appointmentId: appt(FIRST, "B").id, reason: "Visitors", suggestId: D.ID.C }, await D.as("B"));
      a.ok(r.ok, JSON.stringify(r));
      const dec = await D.call("authorisation.decide", { id: r.authorisationId, decision: "reject", note: "We are short that morning", pin: "1234" }, await D.as("hu"));
      a.ok(dec.ok, JSON.stringify(dec));
      const told = noteOf("B", "Not approved: Can't make a duty");
      a.ok(told, "she is told");
      a.has(told.body, "We are short that morning");
      a.has(told.body, "You are still on duty.");
      a.eq(appt(FIRST, "B").status, "active");
      a.eq(noteOf("C", "Not approved: Can't make a duty"), undefined, "the suggested cover is told nothing: she was never asked");
      a.eq(notesOf(D.env, D.ID.C).filter((n) => n.ref_id === r.authorisationId || (n.body || "").indexOf("Visitors") !== -1).length, 0,
           "nothing at all about Mary Jones's request");
    });
  });

  s.test("and if they have been taken off the rota meanwhile, it does not say they are still on", async (a) => {
    await at(londonAt(mod, "2026-10-06", "11:00"), async () => {
      const r = await D.call("authorisation.request", { kind: "duty_release", appointmentId: appt(SECOND, "D").id, reason: "Exams" }, await D.as("D"));
      a.ok(r.ok, JSON.stringify(r));
      /* The Head Usher reworks the rota before answering, which takes her
         off it anyway. */
      a.ok((await D.call("rota.set", { eventId: SECOND, usherIds: [D.ID.B, D.ID.C] }, await D.as("hu"))).ok);
      a.ok(!appt(SECOND, "D"), "off the rota");
      const dec = await D.call("authorisation.decide", { id: r.authorisationId, decision: "reject", note: "Already sorted", pin: "1234" }, await D.as("hu"));
      a.ok(dec.ok, JSON.stringify(dec));
      const told = notesOf(D.env, D.ID.D).find((n) => n.title.indexOf("Not approved: Can't make a duty") === 0);
      a.ok(told, "she is still told the answer");
      a.has(told.body, "Already sorted");
      a.not(/still on duty/.test(told.body), "but not that she is still on a duty she is off");
    });
  });

  s.test("a request on the day is marked late, and still asked for", async (a) => {
    await at(londonAt(mod, SUN, "07:00"), async () => {
      const r = await D.call("authorisation.request", { kind: "duty_release", appointmentId: appt(FIRST, "D").id, reason: "Taken ill" }, await D.as("D"));
      a.ok(r.ok, JSON.stringify(r));
      a.eq(r.late, true, "no cut-off, but it is marked");
      a.has(noteOf("hu", "Approval needed: Can't make a duty").body, "Late request.");
    });
  });

  s.test("and every step is on the audit and on the sheet", async (a) => {
    const actions = D.env.DB._rows("SELECT DISTINCT action FROM audit").map((r) => r.action);
    for (const want of ["authorisation.request", "authorisation.approve", "authorisation.reject", "appointment.release", "appointment.cover"]) {
      a.ok(actions.indexOf(want) !== -1, want + " is audited");
    }
    const appts = D.env.DB._rows("SELECT row_json FROM outbox WHERE tab='APPOINTMENTS'").map((r) => JSON.parse(r.row_json));
    a.ok(appts.some((x) => x.STATUS === "released"), "the sheet sees the release");
    a.ok(D.env.DB._rows("SELECT row_json FROM outbox WHERE tab='AUTHORISATIONS'").length > 0);
  });

  return s;
}
