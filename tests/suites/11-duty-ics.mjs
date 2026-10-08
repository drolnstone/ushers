/* Brief 11: a calendar entry on duty emails, so the duty lands in the
   usher's own diary at the right hour, with a reminder the day before. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department, emailsTo } from "../lib/people.mjs";
import { loadCodeGs } from "../lib/codegs.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("a calendar entry on duty emails");
  let D, sunday, first, aid;

  /* Duty notices are not emailed one by one by default: they ride the
     digest for people with phone alerts off. Either way the entry travels
     with its own line, so the test looks for the line, not for one shape
     of email. */
  const dutyMail = (env, to, subject) => {
    for (const m of emailsTo(env, to).reverse()) {
      if (m.subject.indexOf(subject) === 0) return m;
      if (m.body.indexOf(subject) !== -1) {
        const ics = m.ics && [m.ics].flat().filter(Boolean);
        return { subject, body: m.body, ics: ics && ics.length === 1 ? ics[0] : ics };
      }
    }
    return null;
  };

  s.test("set up: an usher with an email, on next Sunday's First Service", async (a) => {
    D = await department(mod, root, [
      ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
      ["A", "John Smith", null, { email: "a@example.org" }],
      ["B", "Mary Jones", null, { email: "b@example.org" }]
    ]);
    sunday = mod.sundayOnOrAfter(mod.londonKey(new Date(Date.now() + 86400000)));
    first = "S" + sunday.replace(/-/g, "") + "-1";
    await D.call("rota", { from: sunday, weeks: 1 }, D.T.hu);
    a.ok((await D.call("rota.set", { eventId: first, usherIds: [D.ID.A, D.ID.B] }, D.T.hu)).ok);
    aid = D.env.DB._one("SELECT id FROM appointments WHERE event_id=? AND usher_id=?", first, D.ID.A).id;
  });

  s.test("the duty email carries an entry at the service's own hour", (a) => {
    const m = dutyMail(D.env, "a@example.org", "You are on duty");
    a.ok(m, "John Smith was emailed");
    a.ok(m.ics, "with a calendar entry");
    a.eq(m.ics.date, sunday);
    a.eq(m.ics.start, "09:00", "Sunday First Service starts at 09:00");
    a.eq(m.ics.end, "11:00");
    a.eq(m.ics.method, "REQUEST");
    a.has(m.ics.title, "ushering");
    a.eq(m.ics.uid, "ap-" + aid + "@ushers");
  });

  s.test("the counting duty says so, at the Second Service's hour", async (a) => {
    const second = "S" + sunday.replace(/-/g, "") + "-2";
    a.ok((await D.call("rota.set", { eventId: second, usherIds: [D.ID.A, D.ID.B] }, D.T.hu)).ok);
    const m = dutyMail(D.env, "b@example.org", "You are on duty: Sunday Second Service");
    a.ok(m, "Mary Jones was emailed");
    a.eq(m.ics.start, "11:30");
    a.has(m.ics.title, "offering counting");
  });

  s.test("the reminder two days before carries the same entry, with the same id", async (a) => {
    const cfg = await mod.loadConfig(D.env);
    const day = mod.keyAddDays(sunday, -cfg.duty_reminder_days[0]);
    await mod.clockTick(D.env, new Date(Date.parse(day + "T" + String(cfg.reminder_hour).padStart(2, "0") + ":30:00Z")));
    const m = dutyMail(D.env, "a@example.org", "Duty reminder: Sunday First Service");
    a.ok(m, "reminded");
    a.ok(m.ics, "with the entry");
    a.eq(m.ics.uid, "ap-" + aid + "@ushers", "the same entry, so no duplicate in the diary");
    a.eq(m.ics.start, "09:00");
  });

  s.test("coming off the duty, or the event being cancelled, takes the entry out", async (a) => {
    a.ok((await D.call("rota.set", { eventId: first, usherIds: [D.ID.B] }, D.T.hu)).ok);
    let m = dutyMail(D.env, "a@example.org", "You are no longer on duty");
    a.ok(m, "told he is off it");
    a.eq(m.ics.method, "CANCEL");
    a.eq(m.ics.uid, "ap-" + aid + "@ushers");
    a.ok((await D.call("event.cancel", { eventId: first }, D.T.hu)).ok);
    m = dutyMail(D.env, "b@example.org", "Cancelled:");
    a.ok(m, "told it is off");
    a.eq(m.ics.method, "CANCEL");
  });

  s.test("an event with no start time sends no entry", async (a) => {
    const ev = await D.call("event.save", { type: "PRAYER", title: "Prayer Meeting", date: mod.keyAddDays(sunday, 3) }, D.T.hu);
    a.ok(ev.ok, JSON.stringify(ev));
    a.ok((await D.call("rota.set", { eventId: ev.eventId, usherIds: [D.ID.A] }, D.T.hu)).ok);
    const m = dutyMail(D.env, "a@example.org", "You are on duty: Prayer Meeting");
    a.ok(m, "told about it");
    a.eq(m.ics, undefined, "nothing to put in a diary without a time");
  });

  s.test("one with a time does", async (a) => {
    const ev = await D.call("event.save", { type: "VIGIL", title: "Vigil", date: mod.keyAddDays(sunday, 4), start: "22:30" }, D.T.hu);
    a.ok(ev.ok, JSON.stringify(ev));
    a.ok((await D.call("rota.set", { eventId: ev.eventId, usherIds: [D.ID.A] }, D.T.hu)).ok);
    const m = dutyMail(D.env, "a@example.org", "You are on duty: Vigil");
    a.ok(m, "told about it");
    a.eq(m.ics.start, "22:30");
    a.eq(m.ics.end, "00:30", "past midnight");
  });

  /* The sheet turns that into the file the phone opens. */
  s.test("the sheet attaches it as duty.ics, timed, London, with an alarm the day before", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: { WORKER_URL: "https://api.test", SHEET_TOKEN: "test-sheet-token" }, userEmail: "owner@example.org" });
    ctx.setUpSheet();
    let pulled = false;
    gas.setFetchReply((url, opts) => {
      const body = JSON.parse(opts.payload);
      if (body.action === "sheet.pull" || /sheet\.pull/.test(url)) {
        if (pulled) return { code: 200, body: JSON.stringify({ ok: true, rows: [], more: 0 }) };
        pulled = true;
        return { code: 200, body: JSON.stringify({ ok: true, claim: "c1", more: 0, rows: [
          { id: 1, tab: "@email", mode: "append", row: { to: "a@example.org", subject: "You are on duty: Sunday First Service", body: "Sunday 11/10/2026",
            ics: { uid: "ap-AP00001@ushers", date: "2026-10-11", start: "09:00", end: "11:00", title: "Sunday First Service — ushering", method: "REQUEST" } } },
          { id: 2, tab: "@email", mode: "append", row: { to: "b@example.org", subject: "Cancelled: Vigil", body: "x",
            ics: { uid: "ap-AP00002@ushers", date: "2026-10-12", start: "22:30", end: "00:30", title: "Vigil — ushering", method: "CANCEL" } } },
          { id: 3, tab: "@email", mode: "append", row: { to: "c@example.org", subject: "Hall change", body: "no diary entry here" } }
        ] }) };
      }
      return { code: 200, body: JSON.stringify({ ok: true, done: 3 }) };
    });
    ctx.drain();
    a.eq(gas.mail.length, 3, "all three emails went");
    const first = gas.mail[0];
    a.ok(first.attachments && first.attachments.length === 1, "one attachment");
    a.eq(first.attachments[0].getName(), "duty.ics");
    a.eq(first.attachments[0].getContentType(), "text/calendar");
    const text = first.attachments[0].getDataAsString();
    a.has(text, "BEGIN:VCALENDAR");
    a.has(text, "METHOD:REQUEST");
    a.has(text, "UID:ap-AP00001@ushers");
    a.has(text, "DTSTART;TZID=Europe/London:20261011T090000");
    a.has(text, "DTEND;TZID=Europe/London:20261011T110000");
    a.has(text, "SUMMARY:Sunday First Service — ushering");
    a.has(text, "TRIGGER:-P1D", "a reminder the day before");
    a.hasnt(text, "VALUE=DATE", "timed, never all-day");
    const off = gas.mail[1].attachments[0].getDataAsString();
    a.has(off, "METHOD:CANCEL");
    a.has(off, "STATUS:CANCELLED");
    a.hasnt(off, "BEGIN:VALARM", "nothing to be reminded of");
    a.eq(gas.mail[2].attachments, undefined, "a message with no duty carries no file");
  });

  return s;
}
