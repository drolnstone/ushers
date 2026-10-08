/* The bell in both apps. It asks notifications.count every half minute for
   the unread number and the newest notification, and a tap while alerts are
   on can send this phone a test (the Driver App's testpush), which the woken
   phone is told is a test and not the newest real notification. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, makeEnv, client, outbound } from "../lib/worker.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const env = makeEnv(root);
  const call = client(mod, env);
  const s = new Suite("the notification bell");
  const T = {}, ID = {};
  const ep = "https://push.example/send/bell-1";

  s.test("set up: a System Administrator, a Head Usher and an usher", async (a) => {
    a.ok((await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" })).ok);
    ID.admin = (await call("people")).people.find((x) => x.name === "Sam Admin").id;
    T.admin = (await call("login", { usherId: ID.admin, pin: "9999" })).token;
    for (const [k, name] of [["hu", "Grace Okafor"], ["A", "John Smith"]]) {
      const r = await call("usher.save", { name, email: k + "@example.org", pin: "1234", mustChange: false }, T.admin);
      a.ok(r.ok, JSON.stringify(r));
      ID[k] = r.usherId;
      T[k] = (await call("login", { usherId: r.usherId, pin: "1234" })).token;
    }
    a.ok((await call("usher.roles", { usherId: ID.hu, roles: ["usher", "head_usher"] }, T.admin)).ok);
  });

  s.test("the count says how many are unread and which is newest, and goes down as they are read", async (a) => {
    let c = await call("notifications.count", {}, T.A);
    a.ok(c.ok, JSON.stringify(c));
    const before = c.unread;
    a.ok((await call("notify.send", { title: "Meeting on Tuesday", body: "All ushers please", usherIds: [ID.A] }, T.hu)).ok);
    c = await call("notifications.count", {}, T.A);
    a.eq(c.unread, before + 1);
    a.eq(c.latest.title, "Meeting on Tuesday");
    a.eq(c.latest.read, false);
    a.ok((await call("notifications.read", { all: true }, T.A)).ok);
    c = await call("notifications.count", {}, T.A);
    a.eq(c.unread, 0);
    a.eq(c.latest.read, true, "the newest is still named, now read, so the bell does not announce it again");
    a.eq((await call("notifications.count", {})).error, "signed_out", "nobody else's count without a session");
  });

  s.test("a test alert reaches only this person's own phone and is told as a test", async (a) => {
    a.eq((await call("push.test", { endpoint: ep }, T.A)).error, "not_subscribed", "alerts must be on first");
    a.ok((await call("push.subscribe", { endpoint: ep }, T.A)).ok);
    a.eq((await call("notifications.count", {}, T.A)).alertPhones, 1);
    a.eq((await call("push.test", { endpoint: ep }, T.hu)).error, "not_subscribed", "nobody can buzz someone else's phone");
    /* Quiet hours off, so this holds whatever hour the tests run at. */
    for (const key of ["quiet_from", "quiet_to"]) a.ok((await call("config.set", { key, value: 0 }, T.admin)).ok);
    a.ok((await call("notify.send", { title: "Real one", body: "x", usherIds: [ID.A] }, T.hu)).ok);
    await call.settle();
    outbound.length = 0;
    const t = await call("push.test", { endpoint: ep }, T.A);
    a.ok(t.ok, JSON.stringify(t));
    a.eq(outbound.filter((o) => o.url === ep).length, 1, "one push to that phone");
    a.eq((await call("push.test", { endpoint: ep }, T.A)).error, "busy", "a double tap sends one");
    const w = await call("push.what", { endpoint: ep });
    a.eq(w.title, "Alerts are working");
    a.eq(w.unread, 1, "the unread count rides along for the home-screen icon");
    const w2 = await call("push.what", { endpoint: ep });
    a.eq(w2.title, "Real one", "the next push is the ordinary one again");
    a.eq(w2.unread, 1);
  });

  s.test("someone with alerts on no phone is emailed what is still unread, once, and nobody else is", async (a) => {
    const emails = () => env.DB._rows("SELECT row_json FROM outbox WHERE tab='@email'").map((x) => JSON.parse(x.row_json));
    const ushers = (await call("ushers.list", {}, T.admin)).ushers;
    a.eq(ushers.find((u) => u.usherId === ID.A).alerts, 1, "John has alerts on");
    a.eq(ushers.find((u) => u.usherId === ID.hu).alerts, 0, "Grace does not: the Admin App says Alerts off");
    a.ok((await call("notify.send", { title: "Prayer meeting moved", body: "Now at 7pm", usherIds: [ID.hu, ID.A] }, T.hu)).ok);
    /* A type that is not emailed anyway, as a duty reminder is. */
    env.DB._exec("UPDATE notifications SET type='duty_reminder', emailed=0 WHERE title='Prayer meeting moved'");
    const before = emails().length;
    a.eq(await mod.emailUnalerted(env, await mod.loadConfig(env), Date.now()), 0, "not before the hour is up");
    a.eq(await mod.emailUnalerted(env, await mod.loadConfig(env), Date.now() + 61 * 60000), 1, "one person emailed");
    const sent = emails().slice(before);
    a.eq(sent.length, 1);
    a.eq(sent[0].to, "hu@example.org", "only the person with no phone alerts");
    a.has(sent[0].body, "Prayer meeting moved");
    a.has(sent[0].body, "tap the bell");
    a.eq(await mod.emailUnalerted(env, await mod.loadConfig(env), Date.now() + 120 * 60000), 0, "and only once");
  });

  return s;
}
