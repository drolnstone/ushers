/* Removing an usher, an admin among them: they can no longer sign in,
   lose every role but Usher, and come off duties from today on. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, makeEnv, client } from "../lib/worker.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("removing an usher");

  s.test("an admin is removed, keeps the record, and can be brought back as an Usher", async (a) => {
    const env = makeEnv(root);
    const call = client(mod, env);
    await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" });
    const adminId = (await call("people")).people[0].id;
    const admin = (await call("login", { usherId: adminId, pin: "9999" })).token;
    const add = async (name, roles) => {
      const id = (await call("usher.save", { name, pin: "1234", mustChange: false }, admin)).usherId;
      if (roles) await call("usher.roles", { usherId: id, roles }, admin);
      return id;
    };
    const grace = await add("Grace Okafor", ["usher", "head_usher"]);
    const john = await add("John Smith", ["usher", "assistant_head_usher"]);
    const ruth = await add("Ruth Adeyemi", ["usher", "treasurer"]);
    const mary = await add("Mary Jones");
    const hu = (await call("login", { usherId: grace, pin: "1234" })).token;
    const johnTok = (await call("login", { usherId: john, pin: "1234" })).token;

    const sun = mod.sundayOnOrAfter(mod.londonKey(new Date(Date.now() + 86400000)));
    await call("rota", { from: sun, weeks: 1 }, hu);
    const ev = "S" + sun.replace(/-/g, "") + "-1";
    a.ok((await call("rota.set", { eventId: ev, usherIds: [john, mary] }, hu)).ok);

    a.eq((await call("usher.remove", { usherId: grace }, hu))._status, 400, "not yourself");
    a.eq((await call("usher.remove", { usherId: ruth }, hu))._status, 403, "a Treasurer needs a System Administrator");
    a.ok((await call("usher.remove", { usherId: mary }, johnTok)).ok, "an Assistant Head Usher can remove an usher");

    const r = await call("usher.remove", { usherId: john }, hu);
    a.ok(r.ok); a.eq(r.duties, 1, "came off the coming duty");
    a.eq((await call("me", {}, johnTok))._status, 401, "signed out at once");
    a.eq((await call("login", { usherId: john, pin: "1234" }))._status, 403, "cannot sign in");
    let row = (await call("ushers.list", {}, admin)).ushers.find((u) => u.usherId === john);
    a.not(row.active); a.eq(row.roles.join(","), "usher", "no longer an admin");
    a.not((await call("people")).people.some((p) => p.id === john), "off the sign-in list");

    a.ok((await call("usher.remove", { usherId: ruth }, admin)).ok, "a System Administrator can remove a Treasurer");
    a.ok((await call("usher.save", { usherId: john, name: "John Smith", active: true }, hu)).ok, "brought back");
    row = (await call("ushers.list", {}, admin)).ushers.find((u) => u.usherId === john);
    a.ok(row.active); a.eq(row.roles.join(","), "usher");
  });

  s.test("only a System Administrator can make, change or reset a System Administrator or Treasurer", async (a) => {
    const env = makeEnv(root);
    const call = client(mod, env);
    await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" });
    const adminId = (await call("people")).people[0].id;
    const admin = (await call("login", { usherId: adminId, pin: "9999" })).token;
    const add = async (name, roles) => {
      const id = (await call("usher.save", { name, pin: "1234", mustChange: false }, admin)).usherId;
      if (roles) await call("usher.roles", { usherId: id, roles }, admin);
      return id;
    };
    const grace = await add("Grace Okafor", ["usher", "head_usher"]);
    const john = await add("John Smith", ["usher", "assistant_head_usher"]);
    const ruth = await add("Ruth Adeyemi", ["usher", "treasurer"]);
    const mary = await add("Mary Jones");
    const hu = (await call("login", { usherId: grace, pin: "1234" })).token;
    const ahu = (await call("login", { usherId: john, pin: "1234" })).token;

    for (const [tok, self] of [[hu, grace], [ahu, john]]) {
      a.eq((await call("usher.roles", { usherId: mary, roles: ["usher", "system_admin"] }, tok))._status, 403, "cannot make a System Administrator");
      a.eq((await call("usher.roles", { usherId: self, roles: ["usher", "head_usher", "system_admin"] }, tok))._status, 403, "not even themselves");
      a.eq((await call("usher.roles", { usherId: adminId, roles: ["usher"] }, tok))._status, 403, "cannot take it away");
      a.eq((await call("usher.resetPin", { usherId: adminId }, tok))._status, 403, "cannot reset a System Administrator's PIN");
      a.eq((await call("usher.resetPin", { usherId: ruth }, tok))._status, 403, "nor a Treasurer's");
      a.eq((await call("usher.save", { usherId: adminId, name: "Sam Admin", phone: "07700 900123" }, tok))._status, 403, "cannot change their details");
      a.eq((await call("usher.save", { usherId: adminId, name: "Sam Admin", active: false }, tok))._status, 403, "cannot switch them off");
      a.eq((await call("config.get", {}, tok))._status, 403, "no Settings");
      a.eq((await call("config.set", { key: "dues_monthly", value: 1 }, tok))._status, 403, "cannot change Settings");
    }
    a.ok((await call("usher.resetPin", { usherId: mary, pin: "4321" }, hu)).ok, "an usher's PIN can still be reset");
    a.ok((await call("usher.roles", { usherId: mary, roles: ["usher", "system_admin"] }, admin)).ok, "a System Administrator can");
    a.ok((await call("config.get", {}, admin)).ok);
  });

  return s;
}
