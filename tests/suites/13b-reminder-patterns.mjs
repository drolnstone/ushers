/* Brief 13b: extra reminders per kind of event, beyond the one standard
   duty reminder. Each goes once, a paused pattern goes not at all, and a
   pattern aimed at a role reaches only the people holding it. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department, notesOf, at, londonAt } from "../lib/people.mjs";

const SUN = "2026-10-11", FIRST = "S20261011-1";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("extra reminders per kind of event");
  let D;
  const remindersOf = (k) => notesOf(D.env, D.ID[k]).filter((n) => n.title.indexOf("Reminder: ") === 0);

  s.test("set up: a Sunday service a week ahead, with two ushers on it", async (a) => {
    await at(londonAt(mod, "2026-10-04", "09:00"), async () => {
      D = await department(mod, root, [
        ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
        ["A", "John Smith", null, { email: "a@example.org" }],
        ["B", "Mary Jones", null, { email: "b@example.org" }]
      ]);
      await D.call("rota", { from: SUN, weeks: 1 }, D.T.hu);
      a.ok((await D.call("rota.set", { eventId: FIRST, usherIds: [D.ID.A, D.ID.hu] }, D.T.hu)).ok);
    });
  });

  s.test("a pattern is refused unless it makes sense", async (a) => {
   await at(londonAt(mod, "2026-10-04", "10:00"), async () => {
    const bad = await D.call("config.set", { key: "reminder_patterns", value: { SUN_FIRST: [{ days: 99, hour: 12 }] } }, D.T.admin);
    a.eq(bad.ok, false);
    a.has(bad.message, "from 0 (the day itself) to 60");
    const hour = await D.call("config.set", { key: "reminder_patterns", value: { SUN_FIRST: [{ days: 6, hour: 24 }] } }, D.T.admin);
    a.eq(hour.ok, false);
    a.has(hour.message, "0 to 23");
    const nowhere = await D.call("config.set", { key: "reminder_patterns", value: { NO_SUCH: [{ days: 1, hour: 9 }] } }, D.T.admin);
    a.eq(nowhere.ok, false);
    a.has(nowhere.message, "No kind of event");
   });
  });

  s.test("six days before at noon, and again on the morning of the day", async (a) => {
    await at(londonAt(mod, "2026-10-04", "10:30"), async () => {
      a.ok((await D.call("config.set", { key: "reminder_patterns", value: {
        SUN_FIRST: [{ days: 6, hour: 12 }, { days: 0, hour: 7 }]
      } }, await D.as("admin"))).ok);
    });
    await at(londonAt(mod, "2026-10-05", "11:00"), async () => {
      a.eq(await mod.clockTick(D.env, londonAt(mod, "2026-10-05", "11:00")), 0, "not before noon");
    });
    await at(londonAt(mod, "2026-10-05", "12:30"), async () => {
      const n = await mod.clockTick(D.env, londonAt(mod, "2026-10-05", "12:30"));
      a.eq(n, 2, "both people on that service");
      a.eq(remindersOf("A")[0].title, "Reminder: Sunday First Service");
      a.has(remindersOf("A")[0].body, "in 6 days at 09:00");
      a.eq(await mod.clockTick(D.env, londonAt(mod, "2026-10-05", "13:30")), 0, "and once only");
    });
    await at(londonAt(mod, SUN, "07:30"), async () => {
      const n = await mod.clockTick(D.env, londonAt(mod, SUN, "07:30"));
      a.ok(n >= 2, "the morning one, got " + n);
      a.has(remindersOf("A")[0].body, "is today at 09:00");
      a.eq(remindersOf("A").length, 2, "two in all, for the two patterns");
    });
  });

  s.test("pausing one stops it, and nothing else", async (a) => {
    await at(londonAt(mod, "2026-10-06", "09:00"), async () => {
      a.ok((await D.call("config.set", { key: "reminder_patterns", value: {
        SUN_FIRST: [{ days: 6, hour: 12, paused: true }, { days: 5, hour: 12 }]
      } }, await D.as("admin"))).ok);
    });
    await at(londonAt(mod, "2026-10-06", "12:30"), async () => {
      const before = remindersOf("A").length;
      const n = await mod.clockTick(D.env, londonAt(mod, "2026-10-06", "12:30"));
      a.eq(n, 2, "the five-day one went");
      a.eq(remindersOf("A").length, before + 1);
    });
    /* The paused one's day comes round for another event: still nothing. */
    await at(londonAt(mod, "2026-10-05", "12:30"), async () => {
      const before = remindersOf("A").length;
      await mod.clockTick(D.env, londonAt(mod, "2026-10-05", "12:30"));
      a.eq(remindersOf("A").length, before, "the paused pattern sends nothing");
    });
  });

  s.test("a pattern can be aimed at one role", async (a) => {
    await at(londonAt(mod, "2026-10-07", "07:00"), async () => {
      a.ok((await D.call("config.set", { key: "reminder_patterns", value: {
        SUN_FIRST: [{ days: 4, hour: 8, role: "head_usher" }]
      } }, await D.as("admin"))).ok);
    });
    await at(londonAt(mod, "2026-10-07", "08:30"), async () => {
      const mine = remindersOf("A").length;
      const n = await mod.clockTick(D.env, londonAt(mod, "2026-10-07", "08:30"));
      a.eq(n, 1, "the Head Usher alone");
      a.eq(remindersOf("A").length, mine, "not the ordinary usher");
      a.ok(remindersOf("hu").length >= 1);
    });
  });

  s.test("a cancelled event reminds nobody", async (a) => {
    await at(londonAt(mod, "2026-10-08", "09:00"), async () => {
      a.ok((await D.call("event.cancel", { eventId: FIRST }, await D.as("hu"))).ok);
      a.ok((await D.call("config.set", { key: "reminder_patterns", value: {
        SUN_FIRST: [{ days: 2, hour: 9 }] } }, await D.as("admin"))).ok);
      const before = remindersOf("A").length;
      await mod.clockTick(D.env, londonAt(mod, "2026-10-09", "09:30"));
      a.eq(remindersOf("A").length, before, "nothing for an event that is off");
    });
  });

  return s;
}
