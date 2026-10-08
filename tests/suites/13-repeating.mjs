/* Brief 13a: the department's fixed patterns as rules, the way Thanksgiving
   Sunday already is. A rule's events carry its id, so changing the rule
   moves the ones still to come and leaves the past as it happened. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department, at, londonAt } from "../lib/people.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("repeating events");
  let D;
  const events = (rule) => D.env.DB._rows("SELECT * FROM events WHERE rule_id=? ORDER BY date", rule);

  s.test("a pattern is read in words, or refused", (a) => {
    a.eq(mod.ruleWords("first-saturday"), "the first Saturday of each month");
    a.eq(mod.ruleWords("last-friday"), "the last Friday of each month");
    a.eq(mod.ruleWords("nth-weekday:2:sun"), "the second Sunday of each month");
    a.eq(mod.ruleWords("weekly:wed"), "every Wednesday");
    a.has(mod.ruleWords("yearly:09:first-saturday"), "September");
    a.eq(mod.ruleWords("every other tuesday"), "", "anything else is no pattern at all");
    a.eq(mod.ruleWords("weekly:xyz"), "");
  });

  s.test("and it gives the right dates", (a) => {
    a.same(mod.ruleDates("first-saturday", "2026-10-01", "2026-12-31"), ["2026-10-03", "2026-11-07", "2026-12-05"]);
    a.same(mod.ruleDates("last-friday", "2026-10-01", "2026-11-30"), ["2026-10-30", "2026-11-27"]);
    a.same(mod.ruleDates("nth-weekday:2:sun", "2026-10-01", "2026-10-31"), ["2026-10-11"]);
    a.same(mod.ruleDates("weekly:wed", "2026-10-01", "2026-10-25"), ["2026-10-07", "2026-10-14", "2026-10-21"]);
    a.same(mod.ruleDates("yearly:09:first-saturday", "2026-01-01", "2027-12-31"), ["2026-09-05", "2027-09-04"]);
    a.same(mod.ruleDates("fifth-monday", "2026-02-01", "2026-02-28"), [], "a month without one makes nothing");
  });

  s.test("the first Saturday of each month appears for the year ahead", async (a) => {
    await at(londonAt(mod, "2026-10-05", "09:00"), async () => {
      D = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]]]);
      const set = await D.call("config.set", { key: "event_rules", value: [
        { id: "prayer", title: "Prayer Meeting", type: "PRAYER", rule: "first-saturday", time: "17:00" }
      ] }, D.T.admin);
      a.ok(set.ok, JSON.stringify(set));
      const made = events("prayer");
      a.eq(made.length, 12, "twelve months ahead, got " + made.length);
      a.eq(made[0].date, "2026-11-07", "the one in October has already gone");
      a.eq(made[0].start_time, "17:00");
      a.eq(made[0].title, "Prayer Meeting");
      a.eq(made[0].type, "PRAYER");
    });
  });

  s.test("a rule is not allowed to make Sunday services, or to be nonsense", async (a) => {
    await at(londonAt(mod, "2026-10-05", "09:30"), async () => {
      const sunday = await D.call("config.set", { key: "event_rules", value: [
        { id: "extra", title: "Extra", type: "SUN_FIRST", rule: "weekly:sun" }] }, D.T.admin);
      a.eq(sunday.ok, false);
      a.has(sunday.message, "made by the rota");
      const nonsense = await D.call("config.set", { key: "event_rules", value: [
        { id: "xx", title: "X", type: "PRAYER", rule: "whenever" }] }, D.T.admin);
      a.eq(nonsense.ok, false);
      a.has(nonsense.message, "needs a pattern");
      const noId = await D.call("config.set", { key: "event_rules", value: [{ title: "X", type: "PRAYER", rule: "weekly:wed" }] }, D.T.admin);
      a.eq(noId.ok, false);
      a.has(noId.message, "short id");
      a.eq(events("prayer").length, 12, "and nothing was lost in the refusing");
    });
  });

  s.test("changing the time moves the ones still to come, and only those", async (a) => {
    await at(londonAt(mod, "2026-12-10", "09:00"), async () => {
      /* By December the first two have gone. */
      const before = events("prayer");
      const past = before.filter((e) => e.date < "2026-12-10");
      a.ok(past.length >= 1, "some are in the past now");
      const set = await D.call("config.set", { key: "event_rules", value: [
        { id: "prayer", title: "Prayer and Fasting", type: "PRAYER", rule: "first-saturday", time: "18:30" }
      ] }, await D.as("admin"));
      a.ok(set.ok, JSON.stringify(set));
      const after = events("prayer");
      for (const e of after) {
        if (e.date < "2026-12-10") {
          a.eq(e.start_time, "17:00", e.date + " is past and was left alone");
          a.eq(e.title, "Prayer Meeting");
        } else {
          a.eq(e.start_time, "18:30", e.date + " follows the new rule");
          a.eq(e.title, "Prayer and Fasting");
        }
      }
      a.ok(after.length > before.length, "and the window is filled out to a year again");
    });
  });

  s.test("pausing one cancels the ones still to come and keeps the pattern", async (a) => {
    await at(londonAt(mod, "2026-12-10", "10:00"), async () => {
      a.ok((await D.call("config.set", { key: "event_rules", value: [
        { id: "prayer", title: "Prayer and Fasting", type: "PRAYER", rule: "first-saturday", time: "18:30", paused: true }
      ] }, await D.as("admin"))).ok);
      const after = events("prayer");
      a.ok(after.filter((e) => e.date >= "2026-12-10").every((e) => e.status === "cancelled"), "all of the coming ones are off");
      a.ok(after.filter((e) => e.date < "2026-12-10").every((e) => e.status === "scheduled"), "the past still happened");
      const cfg = await mod.loadConfig(D.env);
      a.eq(cfg.event_rules[0].paused, true, "the pattern is still there, paused");
    });
  });

  s.test("a rule can be started again, and its events come back", async (a) => {
    await at(londonAt(mod, "2026-12-10", "11:00"), async () => {
      a.ok((await D.call("config.set", { key: "event_rules", value: [
        { id: "prayer", title: "Prayer and Fasting", type: "PRAYER", rule: "first-saturday", time: "18:30", paused: false }
      ] }, await D.as("admin"))).ok);
      const coming = events("prayer").filter((e) => e.date >= "2026-12-10");
      a.ok(coming.length > 0);
      a.ok(coming.every((e) => e.status === "scheduled"), "back on");
    });
  });

  s.test("the yearly one appears once a year, and the rota shows it", async (a) => {
    await at(londonAt(mod, "2026-12-10", "12:00"), async () => {
      a.ok((await D.call("config.set", { key: "event_rules", value: [
        { id: "prayer", title: "Prayer and Fasting", type: "PRAYER", rule: "first-saturday", time: "18:30" },
        { id: "retreat", title: "Department Retreat", type: "OTHER", rule: "yearly:09:first-saturday", time: "09:00" }
      ] }, await D.as("admin"))).ok);
      const r = events("retreat");
      a.eq(r.length, 1, "one in the next twelve months");
      a.eq(r[0].date, "2027-09-04");
      const rota = await D.call("rota", { from: "2027-08-29", weeks: 3 }, await D.as("hu"));
      a.ok(rota.ok, JSON.stringify(rota));
      a.ok(rota.events.some((e) => e.title === "Department Retreat"), "and the rota offers it for a duty");
    });
  });

  s.test("people can be put on a repeating event like any other", async (a) => {
    await at(londonAt(mod, "2026-12-10", "13:00"), async () => {
      const ev = events("prayer").filter((e) => e.date >= "2026-12-10")[0];
      const set = await D.call("rota.set", { eventId: ev.id, usherIds: [D.ID.hu] }, await D.as("hu"));
      a.ok(set.ok, JSON.stringify(set));
      a.eq(D.env.DB._one("SELECT count(*) AS n FROM appointments WHERE event_id=? AND status='active'", ev.id).n, 1);
    });
  });

  return s;
}
