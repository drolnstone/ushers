/* Brief 16: the name an usher goes to when the Head Usher is away. A
   contact line and nothing else: being in charge for the day lends no
   permission, which is the whole point of the test below. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { department, notesOf, at, londonAt } from "../lib/people.mjs";

const SUN = "2026-10-11", MON = "2026-10-12";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("in charge today");
  let D;
  const home = async (k) => await D.call("home", {}, await D.as(k));

  s.test("with nobody named, it is the Head Usher", async (a) => {
    await at(londonAt(mod, SUN, "07:00"), async () => {
      D = await department(mod, root, [
        ["hu", "Grace Okafor", ["usher", "head_usher"]],
        ["ahu", "Paul Mensah", ["usher", "assistant_head_usher"]],
        ["A", "John Smith"],
        ["B", "Mary Jones"]
      ]);
      /* The phone goes on afterwards, as it would in Admin -> Ushers: it is
         the number the line offers to call. */
      a.ok((await D.call("usher.save", { usherId: D.ID.hu, name: "Grace Okafor", phone: "07700900001" }, D.T.admin)).ok);
      await D.call("rota", { from: SUN, weeks: 1 }, D.T.hu);
      a.ok((await D.call("rota.set", { eventId: "S20261011-1", usherIds: [D.ID.A, D.ID.B] }, D.T.hu)).ok);
      const j = await home("A");
      a.eq(j.inCharge.name, "Grace Okafor");
      a.eq(j.inCharge.phone, "07700900001", "so the line can be tapped to call");
      a.eq(j.inCharge.byDefault, true);
      a.eq(j.inCharge.isMe, false);
    });
  });

  s.test("the Head Usher hands it over for today only, and everybody on duty is told", async (a) => {
    await at(londonAt(mod, SUN, "07:30"), async () => {
      const r = await D.call("incharge.set", { usherId: D.ID.A, todayOnly: true }, await D.as("hu"));
      a.ok(r.ok, JSON.stringify(r));
      a.eq(r.inCharge.name, "John Smith");
      a.eq(r.inCharge.today, true);
      a.eq(r.told, 2, "John and Mary, who are on duty today");
      a.eq(notesOf(D.env, D.ID.B)[0].title, "In charge today: John Smith");
      a.eq(notesOf(D.env, D.ID.hu).filter((n) => n.type === "in_charge").length, 0, "not the one who set it");
      const j = await home("B");
      a.eq(j.inCharge.name, "John Smith");
      a.eq((await home("A")).inCharge.isMe, true, "his own Home does not tell him to go to himself");
    });
  });

  s.test("it gains him nothing: he still cannot do a Head Usher's work", async (a) => {
    await at(londonAt(mod, SUN, "08:00"), async () => {
      const t = await D.as("A");
      const set = await D.call("rota.set", { eventId: "S20261011-2", usherIds: [D.ID.A] }, t);
      a.eq(set.ok, false);
      a.eq(set._status, 403);
      a.eq((await D.call("incharge.set", { usherId: D.ID.B, todayOnly: true }, t)).ok, false, "nor hand it on");
      a.eq((await D.call("dashboard", {}, t)).ok, false, "nor open the coordinator's dashboard");
    });
  });

  s.test("at midnight it lapses, and the Head Usher's name is back", async (a) => {
    await at(londonAt(mod, MON, "00:30"), async () => {
      a.eq((await home("B")).inCharge.name, "Grace Okafor");
      a.eq((await home("B")).inCharge.byDefault, true);
    });
  });

  s.test("until changed back stands day after day, and changing back is one tap", async (a) => {
    await at(londonAt(mod, MON, "09:00"), async () => {
      a.ok((await D.call("incharge.set", { usherId: D.ID.ahu }, await D.as("hu"))).ok);
      a.eq((await home("B")).inCharge.name, "Paul Mensah");
      a.eq((await home("B")).inCharge.standing, true);
    });
    await at(londonAt(mod, "2026-10-20", "09:00"), async () => {
      a.eq((await home("B")).inCharge.name, "Paul Mensah", "still, a week later");
      const back = await D.call("incharge.set", { clear: true }, await D.as("hu"));
      a.ok(back.ok, JSON.stringify(back));
      a.eq(back.inCharge.name, "Grace Okafor");
      a.eq(back.inCharge.byDefault, true);
    });
  });

  s.test("every change is on the audit, with what it was before", async (a) => {
    const rows = D.env.DB._rows("SELECT * FROM audit WHERE action='incharge.set' ORDER BY at");
    a.eq(rows.length, 3);
    a.has(rows[0].reason, "Today only");
    a.has(rows[1].reason, "Until changed back");
    a.has(rows[2].reason, "Back to the Head Usher");
    a.has(rows[0].before_json, D.ID.hu, "the audit says who it was before");
    a.has(rows[2].before_json, D.ID.ahu, "and who it was taken back from");
    a.eq(D.env.DB._rows("SELECT * FROM outbox WHERE tab='AUDIT'").length > 0, true, "and on the sheet");
  });

  s.test("somebody who has left cannot be left in charge", async (a) => {
    await at(londonAt(mod, "2026-10-20", "10:00"), async () => {
      a.ok((await D.call("incharge.set", { usherId: D.ID.A }, await D.as("hu"))).ok);
      a.ok((await D.call("usher.remove", { usherId: D.ID.A }, await D.as("admin"))).ok);
      const j = await home("B");
      a.eq(j.inCharge.name, "Grace Okafor", "it falls back to the Head Usher rather than naming a name nobody can reach");
      const bad = await D.call("incharge.set", { usherId: "U999" }, await D.as("hu"));
      a.eq(bad.ok, false);
      a.has(bad.message, "Choose somebody");
    });
  });

  return s;
}
