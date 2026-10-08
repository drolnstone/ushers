/* Brief 01: someone taken off a duty is told, and so is everyone on duty
   when an event is cancelled or brought back. Nobody turns up for nothing. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department, notesOf } from "../lib/people.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("told when off a duty or the event is off");
  let D, sun, first;

  s.test("set up: a Head Usher and three ushers on next Sunday's First Service", async (a) => {
    D = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["A", "John Smith"], ["B", "Mary Jones"], ["C", "Peter Obi"]]);
    sun = mod.sundayOnOrAfter(mod.londonKey(new Date(Date.now() + 86400000)));
    first = "S" + sun.replace(/-/g, "") + "-1";
    await D.call("rota", { from: sun, weeks: 1 }, D.T.hu);
    a.ok((await D.call("rota.set", { eventId: first, usherIds: [D.ID.A, D.ID.B, D.ID.hu] }, D.T.hu)).ok);
  });

  s.test("the person taken off is told once; those still on hear nothing new", async (a) => {
    const before = notesOf(D.env, D.ID.A).length;
    a.ok((await D.call("rota.set", { eventId: first, usherIds: [D.ID.A, D.ID.hu] }, D.T.hu)).ok);
    const b = notesOf(D.env, D.ID.B).filter((n) => n.title.indexOf("You are no longer on duty") === 0);
    a.eq(b.length, 1);
    a.has(b[0].body, "taken off ushering");
    a.eq(b[0].ref_id, first);
    a.eq(notesOf(D.env, D.ID.A).length, before, "A is still on and hears nothing new");
  });

  s.test("the person making the change is told too when they take themselves off", async (a) => {
    a.ok((await D.call("rota.set", { eventId: first, usherIds: [D.ID.A] }, D.T.hu)).ok);
    a.eq(notesOf(D.env, D.ID.hu).filter((n) => n.title.indexOf("You are no longer on duty") === 0).length, 1);
  });

  s.test("cancelling tells everyone on duty once; restoring tells them once more", async (a) => {
    a.ok((await D.call("rota.set", { eventId: first, usherIds: [D.ID.A, D.ID.C] }, D.T.hu)).ok);
    a.ok((await D.call("event.cancel", { eventId: first }, D.T.hu)).ok);
    for (const k of ["A", "C"]) a.eq(notesOf(D.env, D.ID[k]).filter((n) => n.title.indexOf("Cancelled: ") === 0).length, 1, k);
    a.eq(notesOf(D.env, D.ID.B).filter((n) => n.title.indexOf("Cancelled: ") === 0).length, 0, "B is no longer on it");
    a.ok((await D.call("event.cancel", { eventId: first }, D.T.hu)).ok, "cancelling twice");
    a.eq(notesOf(D.env, D.ID.A).filter((n) => n.title.indexOf("Cancelled: ") === 0).length, 1, "not told twice");
    a.ok((await D.call("event.cancel", { eventId: first, restore: true }, D.T.hu)).ok);
    for (const k of ["A", "C"]) {
      const n = notesOf(D.env, D.ID[k]).filter((x) => x.title.indexOf("Back on: ") === 0);
      a.eq(n.length, 1, k);
      a.has(n[0].body, "You are on duty again.");
    }
  });

  s.test("taking someone off a cancelled event says nothing", async (a) => {
    a.ok((await D.call("event.cancel", { eventId: first }, D.T.hu)).ok);
    const before = notesOf(D.env, D.ID.C).length;
    a.ok((await D.call("rota.set", { eventId: first, usherIds: [D.ID.A] }, D.T.hu)).ok);
    a.eq(notesOf(D.env, D.ID.C).length, before);
    a.ok((await D.call("event.cancel", { eventId: first, restore: true }, D.T.hu)).ok);
  });

  s.test("an event in the past tells nobody", async (a) => {
    const past = "2026-01-04";
    await D.call("rota", { from: past, weeks: 1 }, D.T.hu);
    const ev = "S20260104-1";
    a.ok((await D.call("rota.set", { eventId: ev, usherIds: [D.ID.B, D.ID.C] }, D.T.hu)).ok);
    const bBefore = notesOf(D.env, D.ID.B).length, cBefore = notesOf(D.env, D.ID.C).length;
    a.ok((await D.call("rota.set", { eventId: ev, usherIds: [D.ID.C] }, D.T.hu)).ok);
    a.ok((await D.call("event.cancel", { eventId: ev }, D.T.hu)).ok);
    a.eq(notesOf(D.env, D.ID.B).length, bBefore);
    a.eq(notesOf(D.env, D.ID.C).length, cBefore);
  });

  return s;
}
