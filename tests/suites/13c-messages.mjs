/* Brief 13c: the Message screen. Who it goes to is read when it goes, not
   when it is written; it can wait for a time; it can sit on Home until a
   date; and "seen by" counts the people who opened it, with a nudge for
   those who have not. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department, notesOf, at, londonAt } from "../lib/people.mjs";

const SUN = "2026-10-11", FIRST = "S20261011-1", SECOND = "S20261011-2";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("messages to the ushers");
  let D;
  const got = (k, title) => notesOf(D.env, D.ID[k]).some((n) => n.title === title);

  s.test("set up: a Sunday with First Service ushers and counters", async (a) => {
    await at(londonAt(mod, "2026-10-07", "09:00"), async () => {
      D = await department(mod, root, [
        ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
        ["A", "John Smith", null, { email: "a@example.org" }],
        ["B", "Mary Jones", null, { email: "b@example.org" }],
        ["C", "Peter Obi", null, { email: "c@example.org" }],
        ["D", "Ruth Adeyemi", null, { email: "d@example.org" }]
      ]);
      await D.call("rota", { from: SUN, weeks: 1 }, D.T.hu);
      a.ok((await D.call("rota.set", { eventId: FIRST, usherIds: [D.ID.A, D.ID.B] }, D.T.hu)).ok);
      a.ok((await D.call("rota.set", { eventId: SECOND, usherIds: [D.ID.C, D.ID.D] }, D.T.hu)).ok);
    });
  });

  s.test("a message can go to one group rather than everybody", async (a) => {
    await at(londonAt(mod, "2026-10-07", "10:00"), async () => {
      const r = await D.call("notify.send", { audience: "first", title: "Doors at 08:30",
        body: "Please be there for half past eight." }, await D.as("hu"));
      a.ok(r.ok, JSON.stringify(r));
      a.eq(r.sent, 2);
      a.eq(r.audienceLabel, "the First Service ushers this Sunday");
      a.eq(got("A", "Doors at 08:30"), true);
      a.eq(got("B", "Doors at 08:30"), true);
      a.eq(got("C", "Doors at 08:30"), false, "not the counters");
      a.eq(got("D", "Doors at 08:30"), false);
    });
  });

  s.test("the counters, the admins and a chosen few are each their own group", async (a) => {
    await at(londonAt(mod, "2026-10-07", "10:30"), async () => {
      a.eq((await D.call("notify.send", { audience: "counters", title: "Bring the bags" }, await D.as("hu"))).sent, 2);
      a.eq(got("C", "Bring the bags"), true);
      a.eq(got("A", "Bring the bags"), false);
      const ad = await D.call("notify.send", { audience: "admins", title: "Rota meeting" }, await D.as("hu"));
      a.ok(ad.sent >= 1);
      a.eq(got("hu", "Rota meeting"), true);
      a.eq(got("A", "Rota meeting"), false);
      const few = await D.call("notify.send", { audience: "chosen", usherIds: [D.ID.D], title: "Thank you" }, await D.as("hu"));
      a.eq(few.sent, 1);
      a.eq(got("D", "Thank you"), true);
      a.eq(got("C", "Thank you"), false);
      const all = await D.call("notify.send", { all: true, title: "Everybody" }, await D.as("hu"));
      a.eq(all.sent, 6, "everybody active, the System Administrator included");
    });
  });

  s.test("one set for later waits, and goes at the first tick after its time", async (a) => {
    let id;
    await at(londonAt(mod, "2026-10-07", "11:00"), async () => {
      const r = await D.call("notify.send", { audience: "sunday", title: "Good morning",
        body: "Thank you for serving today.", sendAt: londonAt(mod, SUN, "07:00").getTime() }, await D.as("hu"));
      a.ok(r.ok, JSON.stringify(r));
      a.eq(r.scheduled, true);
      id = r.messageId;
      a.eq(got("A", "Good morning"), false, "nothing yet");
    });
    await at(londonAt(mod, SUN, "06:30"), async () => {
      a.eq(await mod.sendDueMessages(D.env, await mod.loadConfig(D.env), Date.now()), 0, "not before its time");
    });
    await at(londonAt(mod, SUN, "07:05"), async () => {
      a.eq(await mod.sendDueMessages(D.env, await mod.loadConfig(D.env), Date.now()), 1);
      a.eq(got("A", "Good morning"), true);
      a.eq(got("C", "Good morning"), true, "everybody on duty that Sunday");
      a.eq(await mod.sendDueMessages(D.env, await mod.loadConfig(D.env), Date.now()), 0, "and once only");
      const list = await D.call("messages.list", {}, await D.as("hu"));
      const m = list.messages.find((x) => x.id === id);
      a.ok(m.sentAt > 0, "it is marked as gone");
      a.eq(m.to, 4);
    });
  });

  s.test("a pinned message sits on Home until its date, for the people it went to", async (a) => {
    await at(londonAt(mod, SUN, "08:00"), async () => {
      const r = await D.call("notify.send", { audience: "first", title: "Communion today",
        body: "Two extra ushers at the front.", pinnedUntil: SUN }, await D.as("hu"));
      a.ok(r.ok, JSON.stringify(r));
      const home = await D.call("home", {}, await D.as("A"));
      a.eq(home.pinned.length, 1);
      a.eq(home.pinned[0].title, "Communion today");
      a.eq((await D.call("home", {}, await D.as("C"))).pinned.length, 0, "not for somebody it never went to");
    });
    await at(londonAt(mod, "2026-10-12", "08:00"), async () => {
      a.eq((await D.call("home", {}, await D.as("A"))).pinned.length, 0, "and it comes off by itself the next day");
    });
    await at(londonAt(mod, "2026-10-12", "09:00"), async () => {
      const past = await D.call("notify.send", { audience: "all", title: "Old pin", pinnedUntil: "2026-10-01" }, await D.as("hu"));
      a.eq(past.ok, false, "a date already gone is refused");
      a.has(past.message, "today or later");
    });
  });

  s.test("seen by counts the people who read it, and the rest can be nudged", async (a) => {
    await at(londonAt(mod, "2026-10-12", "10:00"), async () => {
      const r = await D.call("notify.send", { audience: "chosen", usherIds: [D.ID.A, D.ID.B], title: "Please read this" }, await D.as("hu"));
      a.ok(r.ok, JSON.stringify(r));
      let m = (await D.call("messages.list", {}, await D.as("hu"))).messages.find((x) => x.id === r.messageId);
      a.eq(m.to, 2);
      a.eq(m.seen, 0);
      a.ok((await D.call("notifications.read", { all: true }, await D.as("A"))).ok);
      m = (await D.call("messages.list", {}, await D.as("hu"))).messages.find((x) => x.id === r.messageId);
      a.eq(m.seen, 1, "John Smith has read it");
      a.eq(m.unseen, 1);
      const again = await D.call("message.remind", { id: r.messageId }, await D.as("hu"));
      a.ok(again.ok, JSON.stringify(again));
      a.eq(again.sent, 1, "only the one who has not");
      a.eq(notesOf(D.env, D.ID.B).filter((n) => n.title === "Please read this").length, 2);
      a.eq(notesOf(D.env, D.ID.A).filter((n) => n.title === "Please read this").length, 1, "not the one who read it");
      a.ok((await D.call("notifications.read", { all: true }, await D.as("B"))).ok);
      const none = await D.call("message.remind", { id: r.messageId }, await D.as("hu"));
      a.eq(none.ok, false);
      a.has(none.message, "Everybody has read it");
    });
  });

  s.test("an usher cannot send one, or see what was sent", async (a) => {
    await at(londonAt(mod, "2026-10-12", "11:00"), async () => {
      const t = await D.as("A");
      a.eq((await D.call("notify.send", { all: true, title: "From me" }, t)).ok, false);
      a.eq((await D.call("messages.list", {}, t)).ok, false);
      a.eq((await D.call("message.remind", { id: "M0001" }, t)).ok, false);
    });
  });

  return s;
}
