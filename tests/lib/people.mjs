/* A department to test with: a System Administrator, then the people asked
   for, each signed in. Shared by the newer suites so each one reads as what
   it checks rather than how it set up. */

import { makeEnv, client } from "./worker.mjs";

/* people: [[key, full name, roles?, extra fields?], ...]. Returns
   { env, call, T: tokens by key, ID: usher ids by key }. */
export async function department(mod, root, people, envOver) {
  const env = makeEnv(root, envOver);
  const call = client(mod, env);
  const T = {}, ID = {};
  const boot = await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" });
  if (!boot.ok) throw new Error("bootstrap: " + JSON.stringify(boot));
  ID.admin = (await call("people")).people.find((x) => x.name === "Sam Admin").id;
  T.admin = (await call("login", { usherId: ID.admin, pin: "9999" })).token;
  for (const [k, name, roles, extra] of people) {
    const r = await call("usher.save", Object.assign({ name, pin: "1234", mustChange: false }, extra || {}), T.admin);
    if (!r.ok) throw new Error("usher.save " + name + ": " + JSON.stringify(r));
    ID[k] = r.usherId;
    if (roles) {
      const g = await call("usher.roles", { usherId: r.usherId, roles }, T.admin);
      if (!g.ok) throw new Error("usher.roles " + name + ": " + JSON.stringify(g));
    }
    const l = await call("login", { usherId: r.usherId, pin: "1234" });
    if (!l.ok) throw new Error("login " + name + ": " + JSON.stringify(l));
    T[k] = l.token;
  }
  return { env, call, T, ID };
}

/* The notifications one person holds, newest first. */
export function notesOf(env, usherId) {
  return env.DB._rows("SELECT * FROM notifications WHERE usher_id=? ORDER BY created_at DESC, rowid DESC", usherId);
}

/* Emails waiting on the outbox for the sheet to send. */
export function emailsTo(env, to) {
  return env.DB._rows("SELECT row_json FROM outbox WHERE tab='@email'").map((r) => JSON.parse(r.row_json)).filter((m) => !to || m.to === to);
}

/* Run fn with Date.now() and new Date() set to a fixed moment. */
export async function at(when, fn) {
  const RealDate = Date;
  const fixed = typeof when === "number" ? when : new RealDate(when).getTime();
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(fixed); }
    static now() { return fixed; }
  }
  globalThis.Date = FakeDate;
  try { return await fn(); } finally { globalThis.Date = RealDate; }
}
