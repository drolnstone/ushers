/* Brief 02: quiet hours. From 21:00 to 08:00 London a phone is woken only
   for what cannot wait; the rest is in the app at once and wakes the phone
   at 08:00, even when it was made just after 21:00. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, outbound } from "../lib/worker.mjs";
import { department, at } from "../lib/people.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("quiet hours for phone alerts");
  const ep = "https://push.example/send/quiet-A";
  const pushes = () => outbound.filter((o) => o.url === ep).length;
  let D;

  s.test("set up: a Head Usher, and an usher with alerts on", async (a) => {
    D = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["A", "John Smith", null, { email: "john@example.org" }]]);
    a.ok((await D.call("push.subscribe", { endpoint: ep }, D.T.A)).ok);
  });

  s.test("the hours: 21:00 to 08:00 London is quiet, in summer and winter", (a) => {
    const cfg = Object.assign({}, mod.DEFAULT_CONFIG);
    a.ok(mod.quietNow(cfg, Date.parse("2026-11-10T22:30:00Z")), "22:30 GMT");
    a.ok(mod.quietNow(cfg, Date.parse("2026-11-11T07:59:00Z")), "07:59 GMT");
    a.not(mod.quietNow(cfg, Date.parse("2026-11-11T08:00:00Z")), "08:00 GMT");
    a.ok(mod.quietNow(cfg, Date.parse("2026-07-10T20:30:00Z")), "21:30 BST");
    a.not(mod.quietNow(cfg, Date.parse("2026-07-10T19:59:00Z")), "20:59 BST");
    a.not(mod.quietNow(Object.assign({}, cfg, { quiet_from: 8, quiet_to: 8 }), Date.parse("2026-11-10T23:00:00Z")), "equal hours turn it off");
    a.ok(mod.quietNow(Object.assign({}, cfg, { quiet_from: 1, quiet_to: 5 }), Date.parse("2026-11-10T03:00:00Z")), "a span inside one day");
  });

  s.test("reminders are never timed inside quiet hours", (a) => {
    const cfg = mod.DEFAULT_CONFIG;
    for (const k of ["reminder_hour", "report_reminder_hour"]) {
      a.not(mod.quietNow(cfg, Date.parse("2026-11-10T" + String(cfg[k]).padStart(2, "0") + ":05:00Z")), k + " is in quiet hours");
    }
  });

  s.test("a message at 22:30 is in the app at once, pushes nothing, and pushes once at 08:00", async (a) => {
    const n0 = pushes();
    await at("2026-11-10T22:30:00Z", async () => {
      a.ok((await D.call("notify.send", { title: "Retreat on Saturday", body: "Bring a coat", usherIds: [D.ID.A] }, await D.as("hu"))).ok);
      await D.call.settle();
      a.eq((await D.call("notifications.count", {}, await D.as("A"))).latest.title, "Retreat on Saturday", "in the app at once");
    });
    a.eq(pushes(), n0, "no push at 22:30");
    await at("2026-11-11T03:00:00Z", async () => { await mod.pushPending(D.env); });
    a.eq(pushes(), n0, "nor in the night");
    await at("2026-11-11T08:00:00Z", async () => { await mod.pushPending(D.env); });
    a.eq(pushes(), n0 + 1, "once at 08:00");
    await at("2026-11-11T08:05:00Z", async () => { await mod.pushPending(D.env); });
    a.eq(pushes(), n0 + 1, "and not again");
  });

  s.test("one made at 21:05 still goes at 08:00, eleven hours later", async (a) => {
    const n0 = pushes();
    await at("2026-11-11T21:05:00Z", async () => {
      a.ok((await D.call("notify.send", { title: "Early start", body: "", usherIds: [D.ID.A] }, await D.as("hu"))).ok);
      await D.call.settle();
    });
    a.eq(pushes(), n0);
    await at("2026-11-12T08:00:00Z", async () => { await mod.pushPending(D.env); });
    a.eq(pushes(), n0 + 1);
  });

  s.test("a countersign request at 22:30 wakes the phone at once", async (a) => {
    const n0 = pushes();
    const cfg = await mod.loadConfig(D.env);
    const u = await mod.getUsher(D.env, D.ID.A);
    await at("2026-11-12T22:30:00Z", async () => {
      await mod.run(D.env, mod.stNotify(D.env, cfg, u, "countersign_request", "Please countersign: First Service", "", "report", "R0001"));
      await mod.pushPending(D.env);
    });
    a.eq(pushes(), n0 + 1);
  });

  s.test("people with alerts off are not emailed in quiet hours, then are at 08:00", async (a) => {
    const D2 = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["B", "Mary Jones", null, { email: "mary@example.org" }]]);
    const mails = () => D2.env.DB._rows("SELECT row_json FROM outbox WHERE tab='@email'").map((r) => JSON.parse(r.row_json)).filter((m) => m.to === "mary@example.org");
    a.ok((await D2.call("config.set", { key: "email_types", value: [] }, D2.T.admin)).ok, "only the unalerted email is in play");
    await at("2026-11-10T21:10:00Z", async () => {
      a.ok((await D2.call("notify.send", { title: "Hall change", body: "", usherIds: [D2.ID.B] }, await D2.as("hu"))).ok);
    });
    const cfg = await mod.loadConfig(D2.env);
    await at("2026-11-10T23:30:00Z", async () => { a.eq(await mod.emailUnalerted(D2.env, cfg, Date.now()), 0); });
    a.eq(mails().length, 0);
    await at("2026-11-11T08:05:00Z", async () => { a.eq(await mod.emailUnalerted(D2.env, cfg, Date.now()), 1); });
    a.eq(mails().length, 1);
  });

  s.test("Settings refuses an hour that is not 0 to 23", async (a) => {
    a.eq((await D.call("config.set", { key: "quiet_from", value: 25 }, D.T.admin))._status, 400);
    a.eq((await D.call("config.set", { key: "quiet_from", value: 22 }, D.T.admin)).ok, true);
  });

  return s;
}
