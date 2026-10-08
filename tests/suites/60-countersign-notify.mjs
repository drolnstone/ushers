/* Countersigning is only for Sunday First and Second Service. Every other
   event's report is filed when it is signed. The Head Usher and Assistant
   Head Usher are told of every filed report, at once, in the app, by phone
   alert and email, and it is logged. A countersigner who needs approval
   goes through the same instant path. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, makeEnv, client } from "../lib/worker.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const env = makeEnv(root);
  const call = client(mod, env);
  const s = new Suite("countersigning and report notifications");
  const today = mod.londonKey(new Date());
  const focus = mod.sundayOnOrBefore(today);
  const next = mod.keyDow(today) === 0 ? mod.keyAddDays(today, 7) : mod.sundayOnOrAfter(today);
  const sun = (key, n) => "S" + key.replace(/-/g, "") + "-" + n;
  const T = {}, ID = {};
  const login = async (who, pin) => {
    const r = await call("login", { usherId: ID[who], pin: pin || "1234" });
    if (!r.ok) throw new Error("login " + who + ": " + JSON.stringify(r));
    T[who] = r.token;
  };
  const notes = (who, type, ref) => env.DB._rows("SELECT * FROM notifications WHERE usher_id=? AND type=?" + (ref ? " AND ref_id=?" : "") + " ORDER BY created_at",
    ...[ID[who], type].concat(ref ? [ref] : []));
  const emailsTo = (who) => env.DB._rows("SELECT row_json FROM outbox WHERE tab='@email'").map((x) => JSON.parse(x.row_json)).filter((x) => x.to === who.toLowerCase() + "@example.org");
  const entries = [{ category: "General Offering", currency: "GBP", denomination: 2000, quantity: 3 }];
  const body = (eventId, sid, over) => Object.assign({ eventId, submissionId: sid, attendance: { male: 10, female: 12, children: 5 },
    ministration: { minister: "Pastor Ade" }, entries, signature: "John Smith", pin: "1234" }, over || {});

  s.test("set up: a System Administrator, a Head Usher, an Assistant Head Usher and three ushers", async (a) => {
    a.ok((await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" })).ok);
    ID.admin = (await call("people")).people.find((x) => x.name === "Sam Admin").id;
    await login("admin", "9999");
    for (const [k, name] of [["hu", "Grace Okafor"], ["ahu", "Hannah Bello"], ["A", "John Smith"], ["B", "Mary Jones"], ["C", "Peter Brown"]]) {
      const r = await call("usher.save", { name, email: k.toLowerCase() + "@example.org", pin: "1234", mustChange: false }, T.admin);
      a.ok(r.ok, JSON.stringify(r));
      ID[k] = r.usherId;
    }
    a.ok((await call("usher.roles", { usherId: ID.hu, roles: ["usher", "head_usher"] }, T.admin)).ok);
    a.ok((await call("usher.roles", { usherId: ID.ahu, roles: ["usher", "assistant_head_usher"] }, T.admin)).ok);
    for (const k of ["hu", "ahu", "A", "B", "C"]) await login(k);
  });

  s.test("only Sunday First and Second Service are countersigned", async (a) => {
    const types = mod.DEFAULT_CONFIG.event_types;
    for (const k of Object.keys(types)) a.eq(!!types[k].countersign, k === "SUN_FIRST" || k === "SUN_SECOND", k);
    const conf = (await call("me", {}, T.A)).config;
    a.eq(conf.eventTypes.PRAYER.countersign, false, "the apps are told the same");
    a.eq(conf.eventTypes.SUN_FIRST.countersign, true);
  });

  let prayer, prayerReport;
  s.test("a Prayer Meeting report has no countersigner and is filed as soon as it is signed", async (a) => {
    const ev = await call("event.save", { type: "PRAYER", date: today }, T.hu);
    a.ok(ev.ok, JSON.stringify(ev));
    prayer = ev.eventId;
    a.ok((await call("rota.set", { eventId: prayer, usherIds: [ID.A] }, T.hu)).ok);
    const o = await call("report.open", { eventId: prayer }, T.A);
    a.eq(o.event.countersign, false, "the form shows no countersigner box");
    const r = await call("report.submit", body(prayer, "sub-prayer-01"), T.A);
    a.ok(r.ok, JSON.stringify(r));
    prayerReport = r.report.id;
    a.eq(r.report.status, "verified");
    a.eq(r.report.countersignRequired, false);
    a.eq(r.report.countersigner, "");
    a.same(r.report.history.map((x) => x.to), ["Draft", "Submitted", "Verified"]);
    a.eq(r.report.parts.countersign, false);
  });

  s.test("the Head Usher and Assistant Head Usher are told at once, by email too, and it is logged; the filer and the administrator are not", async (a) => {
    for (const who of ["hu", "ahu"]) {
      const n = notes(who, "report_filed", prayerReport);
      a.eq(n.length, 1, who);
      a.has(n[0].title, "Report filed: Prayer Meeting");
      a.has(n[0].body, "John Smith signed and filed the report");
      a.has(n[0].body, "Attendance 27, offering £60.00.");
      a.ok(emailsTo(who).some((m) => m.subject === n[0].title), "emailed to " + who);
      const list = await call("notifications.list", {}, T[who]);
      a.ok(list.notifications.some((x) => x.type === "report_filed" && x.refType === "report" && x.refId === prayerReport && !x.read), "in the list, new");
    }
    a.eq(notes("A", "report_filed").length, 0, "the person who filed it is not told about their own report");
    a.eq(notes("admin", "report_filed").length, 0, "the System Administrator is not told");
    const logged = env.DB._rows("SELECT row_json FROM outbox WHERE tab='NOTIFICATIONS'").map((x) => JSON.parse(x.row_json))
      .filter((x) => x.TYPE === "report_filed" && x.REF_ID === prayerReport);
    a.same(logged.map((x) => x.USHER_ID).sort(), [ID.hu, ID.ahu].sort(), "a row each on the NOTIFICATIONS tab");
    a.ok(env.DB._one("SELECT 1 AS n FROM audit WHERE action='report.submit' AND target_id=?", prayerReport), "and the report itself is on the audit");
  });

  s.test("the Head Usher's phone alert opens the report in the Admin App", async (a) => {
    const ep = "https://push.example/send/hu-1";
    a.ok((await call("push.subscribe", { endpoint: ep }, T.hu)).ok);
    const w = await call("push.what", { endpoint: ep });
    a.has(w.title, "Report filed: Prayer Meeting");
    a.eq(w.url, "./admin/#report/" + prayerReport);
  });

  s.test("when the Head Usher files one, only the Assistant Head Usher is told", async (a) => {
    const ev = await call("event.save", { type: "VIGIL", date: today }, T.hu);
    const r = await call("report.submit", body(ev.eventId, "sub-vigil-01", { signature: "Grace Okafor" }), T.hu);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(notes("hu", "report_filed", r.report.id).length, 0);
    a.eq(notes("ahu", "report_filed", r.report.id).length, 1);
  });

  let sunReport;
  s.test("a First Service report reaches the Head Usher when it is countersigned, not before", async (a) => {
    await call("rota", { from: focus, weeks: 2 }, T.hu);
    a.ok((await call("rota.set", { eventId: sun(focus, 1), usherIds: [ID.A, ID.B] }, T.hu)).ok);
    const r = await call("report.submit", body(sun(focus, 1), "sub-sun1-01", { countersignerId: ID.B }), T.A);
    a.ok(r.ok, JSON.stringify(r));
    sunReport = r.report.id;
    a.eq(r.report.status, "pending_countersignature");
    a.eq(r.countersigner, "authorised", "B is on the rota");
    a.eq(notes("hu", "report_filed", sunReport).length, 0, "not while it waits for the countersignature");
    const c = await call("report.countersign", { reportId: sunReport, submissionId: "cs-sun1-01", signature: "Mary Jones", pin: "1234" }, T.B);
    a.ok(c.ok, JSON.stringify(c));
    for (const who of ["hu", "ahu"]) {
      const n = notes(who, "report_filed", sunReport);
      a.eq(n.length, 1, who);
      a.has(n[0].title, "Report filed: Sunday First Service");
      a.has(n[0].body, "John Smith submitted the report and Mary Jones countersigned it.");
    }
    a.eq(notes("A", "report_filed").length, 0, "the submitter has their own Verified notice instead");
    a.eq(notes("A", "report_status", sunReport).length, 1);
    a.eq(notes("B", "report_filed").length, 0);
  });

  let pendingReport, req;
  s.test("a countersigner off the rota: the Head Usher and Assistant Head Usher are asked at once, by phone alert and email", async (a) => {
    const { outbound } = await import("../lib/worker.mjs");
    a.ok((await call("rota.set", { eventId: sun(focus, 2), usherIds: [ID.A, ID.B] }, T.hu)).ok);
    await call.settle();
    outbound.length = 0;
    const r = await call("report.submit", body(sun(focus, 2), "sub-sun2-01", { countersignerId: ID.C }), T.A);
    a.ok(r.ok, JSON.stringify(r));
    pendingReport = r.report.id;
    a.eq(r.countersigner, "approval_requested");
    for (const who of ["hu", "ahu"]) {
      const n = env.DB._rows("SELECT * FROM notifications WHERE usher_id=? AND type='approval_request'", ID[who]);
      a.eq(n.length, 1, who);
      a.ok(emailsTo(who).some((m) => m.subject === n[0].title), "emailed to " + who);
    }
    await call.settle();
    a.ok(outbound.some((o) => o.url === "https://push.example/send/hu-1"), "the Head Usher's phone is woken");
    a.eq(env.DB._rows("SELECT * FROM notifications WHERE usher_id=?", ID.C).length, 0, "the chosen person is asked only once approved");
    req = env.DB._one("SELECT * FROM authorisations WHERE kind='countersign' AND target_id=? AND status='pending'", pendingReport);
    a.ok(req);
  });

  s.test("choosing the same countersigner again keeps the request already made", async (a) => {
    const r = await call("report.countersigner", { reportId: pendingReport, countersignerId: ID.C }, T.A);
    a.eq(r.countersigner, "approval_requested");
    a.eq(env.DB._one("SELECT status FROM authorisations WHERE id=?", req.id).status, "pending", "not cancelled");
    a.eq(env.DB._rows("SELECT * FROM authorisations WHERE kind='countersign' AND target_id=? AND status='pending'", pendingReport).length, 1);
  });

  s.test("when the Head Usher approves: the chosen person is asked once, the submitter is told, and the request stops showing as new for the other", async (a) => {
    const d = await call("authorisation.decide", { id: req.id, decision: "approve", pin: "1234" }, T.hu);
    a.ok(d.ok, JSON.stringify(d));
    const toC = env.DB._rows("SELECT type FROM notifications WHERE usher_id=?", ID.C).map((x) => x.type);
    a.same(toC, ["countersign_request"], "one notice, not two");
    a.eq(emailsTo("C").length, 1, "one email");
    a.eq(notes("A", "approval_decision").length, 1);
    const ahu = env.DB._one("SELECT read_at FROM notifications WHERE usher_id=? AND type='approval_request' AND ref_id=?", ID.ahu, req.id);
    a.ok(ahu.read_at, "decided, so no longer new for the Assistant Head Usher");
    const c = await call("report.countersign", { reportId: pendingReport, submissionId: "cs-sun2-01", signature: "Peter Brown", pin: "1234" }, T.C);
    a.ok(c.ok, JSON.stringify(c));
    a.eq(notes("ahu", "report_filed", pendingReport).length, 1);
  });

  s.test("not approved: the submitter is told why and chooses again; the chosen person is not bothered", async (a) => {
    a.ok((await call("rota.set", { eventId: sun(next, 1), usherIds: [ID.A] }, T.hu)).ok);
    const r = await call("report.submit", body(sun(next, 1), "sub-next1-01", { countersignerId: ID.C }), T.A);
    a.eq(r.countersigner, "approval_requested");
    const q = env.DB._one("SELECT * FROM authorisations WHERE kind='countersign' AND target_id=? AND status='pending'", r.report.id);
    const before = env.DB._rows("SELECT * FROM notifications WHERE usher_id=?", ID.C).length;
    a.ok((await call("authorisation.decide", { id: q.id, decision: "reject", note: "Peter was not there", pin: "1234" }, T.ahu)).ok);
    a.eq(env.DB._rows("SELECT * FROM notifications WHERE usher_id=?", ID.C).length, before);
    const told = notes("A", "approval_decision", r.report.id).pop();
    a.has(told.body, "Choose somebody else");
    a.has(told.body, "Peter was not there");
    a.ok(env.DB._one("SELECT read_at FROM notifications WHERE usher_id=? AND type='approval_request' AND ref_id=?", ID.hu, q.id).read_at);
    const ch = await call("report.countersigner", { reportId: r.report.id, countersignerId: ID.hu }, T.A);
    a.eq(ch.countersigner, "authorised", "the Head Usher may always countersign");
  });

  s.test("choosing somebody else cancels the old request, and it stops showing as new", async (a) => {
    a.ok((await call("rota.set", { eventId: sun(next, 2), usherIds: [ID.A, ID.hu] }, T.hu)).ok);
    const r = await call("report.submit", body(sun(next, 2), "sub-next2-01", { countersignerId: ID.C }), T.A);
    const q = env.DB._one("SELECT * FROM authorisations WHERE kind='countersign' AND target_id=? AND status='pending'", r.report.id);
    const ch = await call("report.countersigner", { reportId: r.report.id, countersignerId: ID.B }, T.A);
    a.eq(ch.countersigner, "approval_requested");
    a.eq(env.DB._one("SELECT status FROM authorisations WHERE id=?", q.id).status, "cancelled");
    a.ok(env.DB._one("SELECT read_at FROM notifications WHERE usher_id=? AND type='approval_request' AND ref_id=?", ID.ahu, q.id).read_at);
    a.eq(env.DB._rows("SELECT * FROM authorisations WHERE kind='countersign' AND target_id=? AND status='pending'", r.report.id).length, 1, "one new request, for Mary");
  });

  s.test("an amended Prayer Meeting report is filed again at once, and the Head Usher is told", async (a) => {
    const r = await call("report.amend", { reportId: prayerReport, amendmentId: "amend-prayer-01", version: 1, reason: "Two more men were counted.",
      attendance: { male: 12, female: 12, children: 5 }, ministration: { minister: "Pastor Ade" }, entries, signature: "Hannah Bello", pin: "1234" }, T.ahu);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.report.status, "verified");
    a.eq(r.report.version, 2);
    a.eq(r.report.countersignRequired, false);
    const n = notes("hu", "report_filed", prayerReport).pop();
    a.has(n.title, "Report amended: Prayer Meeting");
    a.has(n.body, "Hannah Bello amended the report (version 2). Reason: Two more men were counted.");
    a.has(n.body, "Attendance 29");
    a.eq(notes("ahu", "report_filed", prayerReport).length, 1, "the amender is not told about their own amendment");
    a.eq(notes("A", "report_filed", prayerReport).length, 0, "the first submitter has their own Amended notice");
    a.eq(notes("A", "report_status", prayerReport).length, 1);
  });

  s.test("the Head Usher's Notifications show every filed report, newest first", async (a) => {
    const list = await call("notifications.list", {}, T.hu);
    const filed = list.notifications.filter((x) => x.type === "report_filed");
    a.ok(filed.length >= 4, JSON.stringify(filed.map((x) => x.title)));
    a.has(filed[0].title, "Report amended");
  });

  s.test("who is told is a setting, and only real roles are accepted", async (a) => {
    a.eq((await call("config.set", { key: "report_notify_roles", value: ["nobody"] }, T.admin)).error, "type");
    a.ok((await call("config.set", { key: "report_notify_roles", value: ["head_usher"] }, T.admin)).ok);
    const ev = await call("event.save", { type: "NAMING", date: today }, T.hu);
    a.ok((await call("rota.set", { eventId: ev.eventId, usherIds: [ID.B] }, T.hu)).ok);
    const r = await call("report.submit", body(ev.eventId, "sub-naming-01", { signature: "Mary Jones" }), T.B);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(notes("hu", "report_filed", r.report.id).length, 1);
    a.eq(notes("ahu", "report_filed", r.report.id).length, 0);
    a.ok((await call("config.set", { key: "report_notify_roles", value: ["head_usher", "assistant_head_usher"] }, T.admin)).ok);
  });

  s.test("settings saved before this change are brought in line once, on the record", async (a) => {
    const env2 = makeEnv(root);
    const old = JSON.parse(JSON.stringify(mod.DEFAULT_CONFIG.event_types));
    for (const k of Object.keys(old)) old[k].countersign = true;
    env2.DB._exec("INSERT INTO config (k, v, updated_by, updated_at) VALUES ('event_types', '" + JSON.stringify(old).replace(/'/g, "''") + "', 'U001', 1)");
    env2.DB._exec("INSERT INTO config (k, v, updated_by, updated_at) VALUES ('email_types', '[\"countersign_request\",\"approval_request\"]', 'U001', 1)");
    await mod.migrateOnce(env2);
    const types = JSON.parse(env2.DB._one("SELECT v FROM config WHERE k='event_types'").v);
    a.eq(types.SUN_FIRST.countersign, true);
    a.eq(types.SUN_SECOND.countersign, true);
    a.eq(types.PRAYER.countersign, false);
    a.eq(types.NAMING.countersign, false);
    a.same(JSON.parse(env2.DB._one("SELECT v FROM config WHERE k='email_types'").v),
           ["countersign_request", "approval_request", "report_filed", "duty", "duty_reminder"]);
    const audits = env2.DB._rows("SELECT * FROM audit WHERE action='config.set' AND actor_id='system'");
    a.eq(audits.length, 3);
    a.has(audits.map((x) => x.reason).join(" | "), "Only First and Second Service are countersigned");
    a.has(audits.map((x) => x.reason).join(" | "), "carries the calendar entry");
    a.eq(env2.DB._rows("SELECT * FROM outbox WHERE tab='CONFIG'").length, 3, "and on the CONFIG tab");
    /* An administrator may change it again afterwards: it is not undone. */
    types.PRAYER.countersign = true;
    env2.DB._exec("UPDATE config SET v='" + JSON.stringify(types).replace(/'/g, "''") + "' WHERE k='event_types'");
    await mod.migrateOnce(env2);
    a.eq(JSON.parse(env2.DB._one("SELECT v FROM config WHERE k='event_types'").v).PRAYER.countersign, true, "done once only");
    a.eq(env2.DB._rows("SELECT * FROM audit WHERE action='config.set' AND actor_id='system'").length, 3);
  });

  s.test("a write just after a knock still knocks, a moment later, so its email is not left for the five-minute clock", async (a) => {
    const { outbound } = await import("../lib/worker.mjs");
    const url = "https://script.example/exec-gap";
    const env3 = makeEnv(root, { SHEET_WEBAPP_URL: url });
    const c3 = client(mod, env3);
    env3.DB._exec("INSERT INTO settings (k, v) VALUES ('last_knock', '" + (Date.now() - mod.KNOCK_GAP_MS + 800) + "')");
    const t0 = Date.now();
    await c3("bootstrap", { token: "test-bootstrap", fullName: "X Y", pin: "1234" });
    await c3.settle();
    a.eq(outbound.filter((o) => o.url === url).length, 1, "knocked once the gap had passed");
    a.ok(Date.now() - t0 >= 700, "after waiting out the gap");
  });

  s.test("the offering in the notice uses the configured currency symbol", async (a) => {
    const cur = JSON.parse(JSON.stringify(mod.DEFAULT_CONFIG.currencies));
    cur.GBP.symbol = "GBP ";
    a.ok((await call("config.set", { key: "currencies", value: cur }, T.admin)).ok);
    const ev = await call("event.save", { type: "FUNERAL", date: today }, T.hu);
    a.ok((await call("rota.set", { eventId: ev.eventId, usherIds: [ID.B] }, T.hu)).ok);
    const r = await call("report.submit", body(ev.eventId, "sub-funeral-01", { signature: "Mary Jones" }), T.B);
    a.has(notes("hu", "report_filed", r.report.id)[0].body, "Attendance 27, offering GBP 60.00.");
    a.ok((await call("config.set", { key: "currencies", value: mod.DEFAULT_CONFIG.currencies }, T.admin)).ok);
  });

  s.test("countersigned by somebody given authority meanwhile: the request still waiting is cancelled and stops showing as new", async (a) => {
    const third = mod.keyAddDays(next, 7);
    await call("rota", { from: third, weeks: 1 }, T.hu);
    a.ok((await call("rota.set", { eventId: sun(third, 1), usherIds: [ID.A] }, T.hu)).ok);
    const r = await call("report.submit", body(sun(third, 1), "sub-third1-01", { countersignerId: ID.C }), T.A);
    a.eq(r.countersigner, "approval_requested");
    const q = env.DB._one("SELECT * FROM authorisations WHERE kind='countersign' AND target_id=? AND status='pending'", r.report.id);
    a.ok((await call("rota.set", { eventId: sun(third, 1), usherIds: [ID.A, ID.C] }, T.hu)).ok, "the Head Usher puts Peter on the rota instead");
    const c = await call("report.countersign", { reportId: r.report.id, submissionId: "cs-third1-01", signature: "Peter Brown", pin: "1234" }, T.C);
    a.ok(c.ok, JSON.stringify(c));
    a.eq(env.DB._one("SELECT status, decision_note FROM authorisations WHERE id=?", q.id).status, "cancelled");
    a.ok(env.DB._one("SELECT read_at FROM notifications WHERE usher_id=? AND type='approval_request' AND ref_id=?", ID.hu, q.id).read_at);
    a.eq((await call("authorisation.decide", { id: q.id, decision: "approve", pin: "1234" }, T.ahu)).error, "decided", "nobody can approve it afterwards");
  });

  s.test("several writes just after a knock make one knock between them, not one each", async (a) => {
    const { outbound } = await import("../lib/worker.mjs");
    const url = "https://script.example/exec-burst";
    const env4 = makeEnv(root, { SHEET_WEBAPP_URL: url });
    const c4 = client(mod, env4);
    a.ok((await c4("bootstrap", { token: "test-bootstrap", fullName: "X Y", pin: "1234" })).ok);
    await c4.settle();
    const tok = (await c4("login", { usherId: "U001", pin: "1234" })).token;
    env4.DB._exec("UPDATE settings SET v='" + (Date.now() - mod.KNOCK_GAP_MS + 700) + "' WHERE k='last_knock'");
    /* As on D1, a read answers a moment later, so the requests overlap. */
    const prep = env4.DB.prepare;
    env4.DB.prepare = (sql) => {
      const st = prep(sql), first = st.first;
      st.first = async () => { const r = await first(); await new Promise((d) => setTimeout(d, 5)); return r; };
      return st;
    };
    const before = outbound.filter((o) => o.url === url).length;
    await Promise.all([c4("rota", { from: focus, weeks: 1 }, tok), c4("rota", { from: focus, weeks: 1 }, tok), c4("rota", { from: next, weeks: 1 }, tok)]);
    await c4.settle();
    a.eq(outbound.filter((o) => o.url === url).length - before, 1);
  });

  s.test("a report left waiting for a countersignature its event no longer needs is filed once, and everyone concerned is told", async (a) => {
    const env5 = makeEnv(root);
    const c5 = client(mod, env5);
    const id = {}, tk = {};
    a.ok((await c5("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" })).ok);
    tk.admin = (await c5("login", { usherId: "U001", pin: "9999" })).token;
    for (const [k, name] of [["hu", "Grace Okafor"], ["A", "John Smith"], ["B", "Mary Jones"]]) {
      id[k] = (await c5("usher.save", { name, email: k.toLowerCase() + "@example.org", pin: "1234", mustChange: false }, tk.admin)).usherId;
    }
    await c5("usher.roles", { usherId: id.hu, roles: ["usher", "head_usher"] }, tk.admin);
    for (const k of ["hu", "A", "B"]) tk[k] = (await c5("login", { usherId: id[k], pin: "1234" })).token;
    /* As it was before: a saved copy of the event types with every one countersigned. */
    const old = JSON.parse(JSON.stringify(mod.DEFAULT_CONFIG.event_types));
    for (const k of Object.keys(old)) old[k].countersign = true;
    a.ok((await c5("config.set", { key: "event_types", value: old }, tk.admin)).ok);
    const ev = await c5("event.save", { type: "WEDDING", date: today }, tk.hu);
    a.ok((await c5("rota.set", { eventId: ev.eventId, usherIds: [id.A, id.B] }, tk.hu)).ok);
    const r = await c5("report.submit", body(ev.eventId, "sub-wedding-01", { countersignerId: id.B }), tk.A);
    a.eq(r.report.status, "pending_countersignature", JSON.stringify(r));
    /* The new server starts: its once-only changes have not run on this database yet. */
    env5.DB._exec("DELETE FROM settings WHERE k LIKE 'migrated_%'");
    a.ok(await mod.migrateOnce(env5));
    const rep = env5.DB._one("SELECT * FROM reports WHERE id=?", r.report.id);
    a.eq(rep.status, "verified");
    a.eq(rep.countersign_required, 0);
    a.eq(rep.countersigner_id, null);
    a.has(env5.DB._one("SELECT note FROM report_history WHERE report_id=? ORDER BY id DESC LIMIT 1", r.report.id).note, "no longer needed");
    a.ok(env5.DB._one("SELECT 1 AS n FROM audit WHERE action='report.file' AND target_id=?", r.report.id));
    const hu = env5.DB._rows("SELECT * FROM notifications WHERE usher_id=? AND type='report_filed' AND ref_id=?", id.hu, r.report.id);
    a.eq(hu.length, 1);
    a.has(hu[0].body, "John Smith signed the report. This event no longer needs a countersignature.");
    a.eq(env5.DB._rows("SELECT * FROM notifications WHERE usher_id=? AND type='report_status' AND ref_id=?", id.A, r.report.id).length, 1, "the submitter is told");
    a.ok(env5.DB._one("SELECT read_at FROM notifications WHERE usher_id=? AND type='countersign_request' AND ref_id=?", id.B, r.report.id).read_at, "Mary's request to countersign is done with");
    a.eq((await c5("home", {}, tk.B)).toCountersign.length, 0);
    a.ok(await mod.migrateOnce(env5));
    a.eq(env5.DB._rows("SELECT * FROM notifications WHERE type='report_filed' AND ref_id=?", r.report.id).length, 1, "once only");
  });

  s.test("a once-only change that fails is tried again, and the database is not marked up to date until it works", async (a) => {
    const env6 = makeEnv(root);
    env6.DB._exec("INSERT INTO config (k, v, updated_by, updated_at) VALUES ('email_types', '[\"approval_request\"]', 'U001', 1)");
    const prepare = env6.DB.prepare.bind(env6.DB);
    env6.DB.prepare = (sql) => { if (/^SELECT v FROM config/.test(sql)) throw new Error("D1 hiccup"); return prepare(sql); };
    a.eq(await mod.migrateOnce(env6), false);
    a.eq(env6.DB._rows("SELECT * FROM settings WHERE k='migrated_email_report_filed'").length, 0);
    env6.DB.prepare = prepare;
    a.eq(await mod.migrateOnce(env6), true);
    a.has(env6.DB._one("SELECT v FROM config WHERE k='email_types'").v, "report_filed");
  });

  return s;
}
