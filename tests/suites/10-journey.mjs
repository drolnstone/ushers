/* The MVP acceptance test, against the real Worker on a real SQLite database:
   Roster -> Duty -> Report -> Signature -> Countersignature -> Authorisation
   -> Historical record -> Coordinator dashboard. One story, in order. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, makeEnv, client } from "../lib/worker.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const env = makeEnv(root);
  const call = client(mod, env);
  const s = new Suite("MVP journey: roster to dashboard");
  const today = mod.londonKey(new Date());
  const focus = mod.sundayOnOrBefore(today);
  const next = mod.keyDow(today) === 0 ? mod.keyAddDays(today, 7) : mod.sundayOnOrAfter(today);
  const first = "S" + focus.replace(/-/g, "") + "-1", second = "S" + focus.replace(/-/g, "") + "-2";
  const T = {}, ID = {};
  const keyAfter = (k, n) => mod.keyAddDays(k, n);
  const login = async (who, pin) => {
    const r = await call("login", { usherId: ID[who], pin: pin || "1234" });
    if (!r.ok) throw new Error("login " + who + ": " + JSON.stringify(r));
    T[who] = r.token;
    return r;
  };

  s.test("the first System Administrator is made with the bootstrap token, once", async (a) => {
    a.ok((await call("people")).firstSetup, "before anyone is set up, the sign-in screen offers First-time setup");
    a.eq((await client(mod, makeEnv(root, { BOOTSTRAP_TOKEN: "" }))("people")).firstSetup, undefined, "not without a setup token");
    a.eq((await call("bootstrap", { token: "wrong", fullName: "Sam Admin", pin: "9999" })).error, "forbidden");
    const r = await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" });
    a.ok(r.ok, JSON.stringify(r));
    a.eq((await call("bootstrap", { token: "test-bootstrap", fullName: "Other", pin: "9999" })).error, "already");
    const p = await call("people");
    a.not(p.firstSetup, "and never again once there is a System Administrator");
    ID.admin = p.people.find((x) => x.name === "Sam Admin").id;
    await login("admin", "9999");
  });

  s.test("the administrator adds ushers and gives roles; IDs are U-codes made by the server", async (a) => {
    for (const [k, name] of [["hu", "Grace Okafor"], ["A", "John Smith"], ["B", "Mary Jones"], ["C", "Peter Brown"],
                             ["T", "Ruth Adeyemi"], ["D", "David Cole"], ["D2", "David Cole"]]) {
      const r = await call("usher.save", { name, email: k.toLowerCase() + "@example.org", pin: "1234", mustChange: false }, T.admin);
      a.ok(r.ok, JSON.stringify(r));
      a.ok(/^U\d{3}$/.test(r.usherId), r.usherId);
      ID[k] = r.usherId;
    }
    a.ok((await call("usher.roles", { usherId: ID.hu, roles: ["usher", "head_usher"] }, T.admin)).ok);
    a.ok((await call("usher.roles", { usherId: ID.T, roles: ["usher", "treasurer"] }, T.admin)).ok);
    for (const k of ["hu", "A", "B", "C", "T", "D"]) await login(k);
  });

  s.test("names are not identifiers: two people may share a name, and typing it is refused as ambiguous", async (a) => {
    a.ne(ID.D, ID.D2);
    const r = await call("login", { name: "David Cole", pin: "1234" });
    a.eq(r.error, "ambiguous_name");
  });

  s.test("PINs are stored hashed with a different salt per person", async (a) => {
    const rows = env.DB._rows("SELECT id, pin_salt, pin_hash FROM ushers WHERE id IN (?,?)", ID.A, ID.B);
    a.ne(rows[0].pin_salt, rows[1].pin_salt);
    a.ne(rows[0].pin_hash, rows[1].pin_hash, "same PIN, different hash");
    const dump = JSON.stringify(env.DB._rows("SELECT * FROM ushers"));
    a.not(/"1234"/.test(dump), "no plaintext PIN");
  });

  s.test("1. Head Usher creates the First Service rota", async (a) => {
    const w = await call("rota", { from: focus, weeks: 2 }, T.hu);
    a.ok(w.canEdit && w.sundays[0].services.length === 2, JSON.stringify(w));
    const r = await call("rota.set", { eventId: first, usherIds: [ID.A, ID.C] }, T.hu);
    a.ok(r.ok, JSON.stringify(r));
  });

  s.test("an ordinary usher cannot change the rota (server refuses, not just the page)", async (a) => {
    const r = await call("rota.set", { eventId: first, usherIds: [ID.A] }, T.A);
    a.eq(r._status, 403);
  });

  s.test("2. Head Usher appoints exactly two Second Service counters; one is refused", async (a) => {
    const bad = await call("rota.set", { eventId: second, usherIds: [ID.A] }, T.hu);
    a.eq(bad.error, "exact_count");
    const r = await call("rota.set", { eventId: second, usherIds: [ID.A, ID.B] }, T.hu);
    a.ok(r.ok, "the same person on First Service and counting is not a conflict: " + JSON.stringify(r));
  });

  s.test("3. the ordinary usher sees their duties, with no U-codes", async (a) => {
    const h = await call("home", {}, T.A);
    a.ok(h.ok);
    const all = h.thisWeek.concat(h.recent, h.later);
    a.ok(all.some((d) => d.eventId === first && d.duty === "ushering"), JSON.stringify(h));
    a.ok(all.some((d) => d.eventId === second && d.duty === "counting"));
    const rota = await call("rota", { from: focus, weeks: 1 }, T.A);
    a.not(/U\d{3}/.test(JSON.stringify(rota)), "rota for an usher carries no U-codes");
    a.has(JSON.stringify(rota), "John Smith");
  });

  let draftTotals;
  s.test("4-6. Person A opens the report; attendance and offering totals are calculated by the server", async (a) => {
    const o = await call("report.open", { eventId: first }, T.A);
    a.ok(o.canSubmit, JSON.stringify(o));
    draftTotals = await call("report.draft", { eventId: first, attendance: { male: 10, female: 12, children: 5, total: 999 },
      entries: [{ category: "General Offering", currency: "GBP", denomination: 2000, quantity: 10 },
                { category: "Tithe", currency: "GBP", denomination: 500, quantity: 3 }] }, T.A);
    a.eq(draftTotals.attendanceTotal, 27, "the phone's total is ignored");
    a.eq(draftTotals.offeringTotal, 21500);
    a.eq(draftTotals.byCategory["General Offering"], 20000);
  });

  s.test("bad offering lines are refused", async (a) => {
    const r = await call("report.draft", { eventId: first, entries: [{ category: "General Offering", currency: "GBP", denomination: 3000, quantity: 1 }] }, T.A);
    a.eq(r.error, "denomination");
  });

  let reportId;
  const entries = [{ category: "General Offering", currency: "GBP", denomination: 2000, quantity: 10 },
                   { category: "Tithe", currency: "GBP", denomination: 500, quantity: 3 },
                   { category: "Pledge", currency: "GBP", denomination: 1000, quantity: 1 }];
  const ministration = { minister: "Pastor Ade", sermon_title: "Faithful in little", bible_text: "Luke 16:10", first_timers: 3, new_converts: "1" };
  const body = (over) => Object.assign({ eventId: first, submissionId: "sub-a-0001", attendance: { male: 10, female: 12, children: 5 },
    ministration, entries, countersignerId: ID.B, signature: "John Smith", pin: "1234" }, over || {});

  s.test("a wrong PIN is refused and counts down", async (a) => {
    const r = await call("report.submit", body({ pin: "0000" }), T.A);
    a.eq(r.error, "bad_pin");
    a.eq(r.left, 2);
  });

  s.test("you cannot choose yourself to countersign", async (a) => {
    a.eq((await call("report.submit", body({ countersignerId: ID.A }), T.A)).error, "self_countersign");
  });

  s.test("7-11. A selects B (not authorised), signs with PIN; approval is triggered; report is Pending Countersignature", async (a) => {
    const sel = await call("ushers.selectable", {}, T.A);
    a.ok(sel.people.some((p) => p.id === ID.B), "everyone is selectable, not only the rostered");
    a.ok(sel.people.some((p) => p.id === ID.D), "even somebody not on duty");
    const r = await call("report.submit", body(), T.A);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.countersigner, "approval_requested");
    a.eq(r.report.status, "pending_countersignature");
    a.eq(r.report.attendance.total, 27);
    a.eq(r.report.offeringTotal, 22500);
    a.same(r.report.history.map((h) => h.to), ["Draft", "Submitted", "Pending Countersignature"]);
    a.eq(r.report.ministration.minister, "Pastor Ade", "the ministration record is part of the report");
    a.eq(r.report.ministration.new_converts, 1, "numbers are kept as numbers");
    a.eq(r.report.ministration.worship_leader, "", "a line left empty is kept empty");
    reportId = r.report.id;
  });

  s.test("the same submission sent again is filed once", async (a) => {
    const r = await call("report.submit", body(), T.A);
    a.ok(r.duplicate);
    a.eq(env.DB._one("SELECT count(*) AS n FROM reports WHERE event_id=?", first).n, 1);
  });

  s.test("B cannot countersign until the approval is given", async (a) => {
    const h = await call("home", {}, T.B);
    a.eq(h.toCountersign[0].state, "awaiting_approval");
    const r = await call("report.countersign", { reportId, submissionId: "cs-b-0001", signature: "Mary Jones", pin: "1234" }, T.B);
    a.eq(r.error, "awaiting_approval");
  });

  s.test("the Head Usher is notified and approves with their PIN; B's roles do not change", async (a) => {
    const n = await call("notifications.list", {}, T.hu);
    a.ok(n.notifications.some((x) => x.type === "approval_request"));
    const l = await call("authorisations.list", { status: "pending" }, T.hu);
    const req = l.authorisations.find((x) => x.kind === "countersign");
    a.ok(req && req.canDecide, JSON.stringify(l));
    a.eq((await call("authorisation.decide", { id: req.id, decision: "approve", pin: "1234" }, T.A))._status, 403);
    const d = await call("authorisation.decide", { id: req.id, decision: "approve", pin: "1234" }, T.hu);
    a.ok(d.ok, JSON.stringify(d));
    a.same(env.DB._rows("SELECT role FROM user_roles WHERE usher_id=?", ID.B).map((r) => r.role), ["usher"]);
  });

  s.test("12-14. B is notified, opens the same report and sees what A submitted", async (a) => {
    const n = await call("notifications.list", {}, T.B);
    const cs = n.notifications.find((x) => x.type === "countersign_request");
    a.ok(cs && cs.refId === reportId, JSON.stringify(n));
    const o = await call("report.open", { reportId }, T.B);
    a.eq(o.report.id, reportId);
    a.eq(o.report.submitter, "John Smith");
    a.eq(o.report.attendance.total, 27);
    a.ok(o.report.canCountersign);
  });

  s.test("15-16. B signs and PIN-verifies; the report becomes Verified and the authority is consumed", async (a) => {
    a.eq((await call("report.countersign", { reportId, submissionId: "cs-b-0001", signature: "Someone Else", pin: "1234" }, T.B)).error, "signature");
    const r = await call("report.countersign", { reportId, submissionId: "cs-b-0001", signature: "Mary Jones", pin: "1234" }, T.B);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.report.status, "verified");
    a.eq(r.report.countersigner, "Mary Jones");
    a.eq(env.DB._one("SELECT status FROM authorisations WHERE kind='countersign' AND target_id=?", reportId).status, "consumed");
    const sub = await call("notifications.list", {}, T.A);
    a.ok(sub.notifications.some((x) => x.type === "report_status"));
  });

  s.test("17-19. the coordinator dashboard shows the totals and next Sunday's rota", async (a) => {
    const d = await call("dashboard", {}, T.hu);
    a.ok(d.ok, JSON.stringify(d));
    a.eq(d.current.sunday, focus);
    const svc = d.current.services.find((x) => x.eventId === first);
    a.eq(svc.reportStatus, "verified");
    a.same(svc.attendance, { male: 10, female: 12, children: 5, total: 27 });
    a.eq(svc.offering["General Offering"], 20000);
    a.eq(d.current.totals.offeringTotal, 22500);
    a.eq(d.current.reporting.received, 1);
    a.eq(d.next.sunday, next);
    a.eq(d.next.services.length, 2, "First and Second Service both shown");
  });

  s.test("the Second Service report is the same whole report: attendance, ministration and offering", async (a) => {
    const o = await call("report.open", { eventId: second }, T.B);
    a.ok(o.event.attendance && o.event.ministration && o.event.offering, JSON.stringify(o.event));
    a.ok(o.ministrationFields.length >= 5);
  });

  s.test("20. a report signed with no signal is accepted later, once, and marked as checked on the phone", async (a) => {
    const at = Date.now() - 60000;
    const r = await call("report.submit", { eventId: second, submissionId: "offline-b-0001", entries: [{ category: "Vow", currency: "GBP", denomination: 5000, quantity: 2 }],
      attendance: { male: 20, female: 25, children: 9 }, ministration: { minister: "Pastor Bisi", first_timers: 2 },
      countersignerId: ID.A, signature: "Mary Jones", offline: true, signedAt: at }, T.B);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.report.attendance.total, 54, "Second Service attendance is counted too");
    a.eq(r.report.ministration.minister, "Pastor Bisi");
    a.eq(r.countersigner, "authorised", "A is a counter at that service, so rostered");
    a.eq(env.DB._one("SELECT submit_pin_check FROM reports WHERE event_id=?", second).submit_pin_check, "device");
    const again = await call("report.submit", { eventId: second, submissionId: "offline-b-0001", signature: "Mary Jones", offline: true, signedAt: at }, T.B);
    a.ok(again.duplicate);
  });

  s.test("21-22. the sheet gets the record, keyed by header, and the audit names both people", async (a) => {
    a.eq((await call("sheet.pull", { sheetToken: "nope" }))._status, 403);
    const p = await call("sheet.pull", { sheetToken: "test-sheet-token", max: 500 });
    a.ok(p.ok);
    const tabs = new Set(p.rows.map((r) => r.tab));
    for (const t of ["USHERS", "EVENTS", "APPOINTMENTS", "REPORTS", "ATTENDANCE", "MINISTRATION", "OFFERING", "AUTHORISATIONS", "AUDIT", "NOTIFICATIONS"]) a.ok(tabs.has(t), "has " + t);
    const min = p.rows.filter((r) => r.tab === "MINISTRATION" && r.row.REPORT_ID === reportId).map((r) => r.row);
    a.ok(min.some((x) => x.FIELD === "Sermon title" && x.VALUE === "Faithful in little" && x.VERSION === 1 && x.CURRENT === "Yes"), JSON.stringify(min));
    a.ok(p.rows.some((r) => r.tab === "ATTENDANCE" && r.value === reportId + "-v1"), "attendance keyed by report and version");
    const rep = p.rows.filter((r) => r.tab === "REPORTS" && r.value === reportId).pop();
    a.eq(rep.mode, "upsert");
    a.eq(rep.key, "REPORT_ID");
    a.eq(rep.row.STATUS, "Verified");
    a.eq(rep.row.OFFERING_TOTAL, 225);
    const audit = p.rows.filter((r) => r.tab === "AUDIT").map((r) => r.row);
    a.ok(audit.some((x) => x.ACTION === "report.submit" && x.ACTOR_ID === ID.A));
    a.ok(audit.some((x) => x.ACTION === "report.countersign" && x.ACTOR_ID === ID.B));
    a.ok(audit.some((x) => x.ACTION === "authorisation.approve" && x.ACTOR_ID === ID.hu));
    const ack = await call("sheet.ack", { sheetToken: "test-sheet-token", claim: p.claim, ids: p.rows.map((r) => r.id) });
    a.eq(ack.done, p.rows.length);
    const p2 = await call("sheet.pull", { sheetToken: "test-sheet-token" });
    a.eq(p2.rows.length, 0);
  });

  s.test("emails are queued for important notifications to people with an address", async (a) => {
    a.ok(env.DB._one("SELECT count(*) AS n FROM outbox WHERE tab='@email'").n > 0);
  });

  s.test("24. a Head Usher without the Treasurer role cannot see dues", async (a) => {
    for (const act of ["dues.overview", "dues.member", "dues.record"]) {
      a.eq((await call(act, { usherId: ID.A }, T.hu))._status, 403, act);
    }
    const d = await call("dashboard", {}, T.hu);
    a.not(/dues/i.test(JSON.stringify(d)), "nothing about dues on the dashboard");
  });

  s.test("25. the Treasurer records payments and sees balances; the member sees their own", async (a) => {
    const y = Number(today.slice(0, 4));
    a.ok((await call("dues.record", { usherId: ID.A, paidOn: y + "-01-05", amountPence: 500 }, T.T)).ok);
    a.ok((await call("dues.record", { usherId: ID.A, paidOn: y + "-02-04", amountPence: 500 }, T.T)).ok);
    const o = await call("dues.overview", { year: y }, T.T);
    const m = o.members.find((x) => x.name === "John Smith");
    a.eq(m.paid, 1000);
    const mine = await call("dues.mine", {}, T.A);
    a.eq(mine.years[0].paid, 1000);
    a.eq(mine.years[0].annualTarget, 6000);
    a.eq((await call("dues.overview", {}, T.A))._status, 403);
  });

  s.test("26. one session works in both apps; permissions are re-read on every call", async (a) => {
    a.ok((await call("home", {}, T.hu)).ok);
    a.ok((await call("dashboard", {}, T.hu)).ok);
    a.eq((await call("dashboard", {}, T.A))._status, 403);
    a.ok((await call("usher.roles", { usherId: ID.hu, roles: ["usher"] }, T.admin)).ok);
    a.eq((await call("dashboard", {}, T.hu))._status, 403, "role removed, refused at once");
    a.ok((await call("usher.roles", { usherId: ID.hu, roles: ["usher", "head_usher"] }, T.admin)).ok);
  });

  s.test("the Admin App is for the Head Usher and Assistant Head Usher (and the System Administrator), not the Treasurer", async (a) => {
    const all = (await call("people")).people.map((p) => p.name);
    const admins = (await call("people", { app: "admin" })).people.map((p) => p.name);
    a.ok(all.includes("Ruth Adeyemi") && all.includes("John Smith"), "the Ushers App lists everyone");
    a.ok(admins.includes("Grace Okafor") && admins.includes("Sam Admin"), JSON.stringify(admins));
    a.not(admins.includes("Ruth Adeyemi"), "the Treasurer is not listed on the Admin App sign-in");
    a.not(admins.includes("John Smith"), "nor is an ordinary usher");
    const t = (await call("me", {}, T.T)).me.permissions;
    a.not(t.includes("admin.app"), "the Treasurer has no Admin App");
    a.ok(t.includes("dues.view_all") && t.includes("usher.app"), "the Treasurer's page is in the Ushers App");
  });

  s.test("a PIN is always exactly four digits; anyone changes their own", async (a) => {
    for (const bad of ["123", "12345", "123456", "12a4", "abcd"]) {
      const r = await call("pin.change", { oldPin: "1234", newPin: bad }, T.C);
      a.eq(r.error, "pin_shape", bad);
    }
    a.ok(/exactly 4 digits/.test((await call("pin.change", { oldPin: "1234", newPin: "12345" }, T.C)).message));
    a.ok((await call("pin.change", { oldPin: "1234", newPin: "4321" }, T.C)).ok, "four digits are fine");
    await login("C", "4321");
    a.ok((await call("pin.change", { oldPin: "4321", newPin: "1234" }, T.C)).ok);
    await login("C", "1234");
  });

  s.test("new and reset ushers start on the default PIN and are asked once whether to keep it", async (a) => {
    const add = await call("usher.save", { name: "Esther Bello", phone: "07700 900 123", pin: "9999", mustChange: false }, T.hu);
    a.ok(add.ok && add.pinFrom === "default", JSON.stringify(add));
    a.eq((await call("login", { usherId: add.usherId, pin: "9999" })).error, "bad_pin", "a typed PIN is ignored when there is a phone number");
    let l = await call("login", { usherId: add.usherId, pin: "0123" });
    a.ok(l.ok && l.me.askPinChange, "signs in with the default PIN and is asked");
    a.eq((await call("home", {}, l.token)).error, "pin_question", "nothing else until they answer");
    a.ok((await call("me", {}, l.token)).ok);
    a.eq((await call("pin.change", { oldPin: "0123", newPin: "0123" }, l.token)).error, "same_pin");
    a.ok((await call("pin.change", { oldPin: "0123", newPin: "5555" }, l.token)).ok);
    a.ok((await call("home", {}, l.token)).ok, "then everything works");
    a.not((await call("me", {}, l.token)).me.askPinChange);
    const r = await call("usher.resetPin", { usherId: add.usherId, pin: "7777", mustChange: false }, T.hu);
    a.ok(r.ok && r.pinFrom === "default", "a reset drops back to the default PIN");
    a.eq((await call("login", { usherId: add.usherId, pin: "5555" })).error, "bad_pin");
    l = await call("login", { usherId: add.usherId, pin: "0123" });
    a.ok(l.ok && l.me.askPinChange, "and asked again; only a System Administrator can skip the question (test people)");
    a.ok((await call("pin.keep", {}, l.token)).ok, "No: the default PIN stays");
    a.ok((await call("home", {}, l.token)).ok, "and everything works");
    l = await call("login", { usherId: add.usherId, pin: "0123" });
    a.ok(l.ok && !l.me.askPinChange, "not asked again");
    a.ok((await call("pin.change", { oldPin: "0123", newPin: "6060" }, l.token)).ok, "they can still change it later on the PIN tab");
    const none = await call("usher.save", { name: "Femi Ade" }, T.hu);
    a.eq((await call("usher.resetPin", { usherId: none.usherId }, T.hu)).error, "no_default_pin", "no phone and no PIN typed: refused");
    a.ok((await call("usher.resetPin", { usherId: none.usherId, pin: "2222" }, T.hu)).ok, "no phone: a typed PIN");
    a.ok((await call("login", { usherId: none.usherId, pin: "2222" })).me.askPinChange);
    for (const id of [add.usherId, none.usherId]) await call("usher.save", { usherId: id, name: id === add.usherId ? "Esther Bello" : "Femi Ade", active: false }, T.admin);
  });

  s.test("a Head Usher may not grant the Treasurer role; a System Administrator may", async (a) => {
    a.eq((await call("usher.roles", { usherId: ID.C, roles: ["usher", "treasurer"] }, T.hu))._status, 403);
    a.ok((await call("usher.roles", { usherId: ID.C, roles: ["usher", "assistant_head_usher"] }, T.hu)).ok);
    a.ok((await call("usher.roles", { usherId: ID.C, roles: ["usher"] }, T.hu)).ok);
  });

  s.test("somebody not on the rota needs approval to submit, and the approval is used once", async (a) => {
    const ev = "S" + next.replace(/-/g, "") + "-1";
    const r = await call("report.submit", { eventId: ev, submissionId: "sub-d-0001", attendance: { male: 1, female: 1, children: 1 }, entries: [],
      countersignerId: ID.hu, signature: "David Cole", pin: "1234" }, T.D);
    a.eq(r.error, "needs_authorisation");
    a.ok((await call("authorisation.decide", { id: r.authorisationId, decision: "approve", pin: "1234" }, T.hu)).ok);
    const ok = await call("report.submit", { eventId: ev, submissionId: "sub-d-0002", attendance: { male: 1, female: 1, children: 1 }, entries: [],
      countersignerId: ID.hu, signature: "David Cole", pin: "1234" }, T.D);
    a.ok(ok.ok, JSON.stringify(ok));
    a.eq(ok.countersigner, "authorised", "a Head Usher has countersigning authority");
    a.eq(env.DB._one("SELECT status FROM authorisations WHERE id=?", r.authorisationId).status, "consumed");
  });

  s.test("a duty change uses the same engine: approval moves the duty and keeps the original on record", async (a) => {
    const ev = "S" + next.replace(/-/g, "") + "-2";
    a.ok((await call("rota.set", { eventId: ev, usherIds: [ID.A, ID.B] }, T.hu)).ok);
    const ap = env.DB._one("SELECT id FROM appointments WHERE event_id=? AND usher_id=? AND status='active'", ev, ID.A).id;
    const r = await call("authorisation.request", { kind: "duty_takeover", appointmentId: ap, reason: "John was away" }, T.C);
    a.ok(r.ok, JSON.stringify(r));
    a.ok((await call("authorisation.decide", { id: r.authorisationId, decision: "approve", pin: "1234" }, T.hu)).ok);
    a.eq(env.DB._one("SELECT status FROM appointments WHERE id=?", ap).status, "removed");
    a.ok(env.DB._one("SELECT id FROM appointments WHERE event_id=? AND usher_id=? AND status='active'", ev, ID.C));
    a.eq(env.DB._one("SELECT status FROM authorisations WHERE id=?", r.authorisationId).status, "consumed");
  });

  s.test("an approver needs no request: the Head Usher's own duty change happens at once, with their PIN", async (a) => {
    const ev = "S" + next.replace(/-/g, "") + "-2";
    const ap = env.DB._one("SELECT id FROM appointments WHERE event_id=? AND usher_id=? AND status='active'", ev, ID.B).id;
    a.eq((await call("authorisation.request", { kind: "duty_takeover", appointmentId: ap, reason: "Mary was ill", pin: "0000" }, T.hu)).error, "bad_pin");
    const r = await call("authorisation.request", { kind: "duty_takeover", appointmentId: ap, reason: "Mary was ill", pin: "1234" }, T.hu);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.status, "consumed", "approved and used at once");
    const row = env.DB._one("SELECT * FROM authorisations WHERE id=?", r.authorisationId);
    a.eq(row.decided_by, ID.hu, "the record says who approved it");
    a.ok(env.DB._one("SELECT id FROM appointments WHERE event_id=? AND usher_id=? AND status='active'", ev, ID.hu));
    const others = env.DB._rows("SELECT * FROM notifications WHERE type='approval_request' AND ref_id=?", r.authorisationId);
    a.eq(others.length, 0, "nobody is asked to approve it");
  });

  s.test("the System Administrator is not an approver: approvals stay with the Head Ushers", async (a) => {
    const ev = "S" + next.replace(/-/g, "") + "-2";
    const ap = env.DB._one("SELECT id FROM appointments WHERE event_id=? AND usher_id=? AND status='active'", ev, ID.hu).id;
    const r = await call("authorisation.request", { kind: "duty_takeover", appointmentId: ap, reason: "Swap back" }, T.B);
    a.eq(r.status, "pending");
    a.eq((await call("authorisation.decide", { id: r.authorisationId, decision: "approve", pin: "9999" }, T.admin))._status, 403);
    a.not(env.DB._rows("SELECT * FROM notifications WHERE type='approval_request' AND ref_id=?", r.authorisationId).some((n) => n.usher_id === ID.admin),
      "approval requests do not go to the System Administrator");
    a.ok((await call("authorisation.decide", { id: r.authorisationId, decision: "approve", pin: "1234" }, T.C)).ok === false, "nor to an usher");
    a.ok((await call("authorisation.decide", { id: r.authorisationId, decision: "approve", pin: "1234" }, T.hu)).ok, "the Head Usher decides it");
  });

  let adminReport;
  s.test("an approver's report needs no approval to submit but must still be countersigned by somebody else", async (a) => {
    const ev = "S" + next.replace(/-/g, "") + "-2";
    const sub = { eventId: ev, submissionId: "sub-hu-00001", attendance: { male: 4, female: 5, children: 1 }, ministration: { minister: "Pastor Ade" },
      entries: [{ category: "General Offering", currency: "GBP", denomination: 1000, quantity: 2 }], signature: "Grace Okafor", pin: "1234" };
    a.eq((await call("report.submit", Object.assign({}, sub, { countersignerId: ID.hu }), T.hu)).error, "self_countersign");
    const r = await call("report.submit", Object.assign({}, sub, { countersignerId: ID.D }), T.hu);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.report.status, "pending_countersignature", "not verified until somebody else countersigns");
    a.eq(r.countersigner, "authorised", "the approver's choice of countersigner is already approved");
    adminReport = r.report.id;
    a.eq((await call("report.countersign", { reportId: adminReport, submissionId: "cs-hu-self01", signature: "Grace Okafor", pin: "1234" }, T.hu)).error, "not_countersigner");
    const c = await call("report.countersign", { reportId: adminReport, submissionId: "cs-d-000001", signature: "David Cole", pin: "1234" }, T.D);
    a.ok(c.ok, JSON.stringify(c));
    a.eq(c.report.status, "verified");
  });

  s.test("an amendment by an usher needs approval first, and keeps the old version whole", async (a) => {
    const am = { reportId, amendmentId: "amend-a-0001", reason: "Ten more men were counted late", attendance: { male: 20, female: 12, children: 5 },
      ministration, entries, countersignerId: ID.C, signature: "John Smith", pin: "1234", version: 1 };
    const r = await call("report.amend", am, T.A);
    a.eq(r.error, "needs_authorisation", JSON.stringify(r));
    a.eq((await call("report.amend", Object.assign({}, am, { reason: "" }), T.A)).error, "reason");
    a.ok((await call("authorisation.decide", { id: r.authorisationId, decision: "approve", pin: "1234" }, T.hu)).ok);
    const ok = await call("report.amend", am, T.A);
    a.ok(ok.ok, JSON.stringify(ok));
    a.eq(ok.version, 2);
    a.eq(ok.report.status, "pending_countersignature", "an amended report is countersigned again");
    a.eq(ok.report.attendance.total, 37);
    a.eq(ok.report.versions.length, 1);
    a.eq(ok.report.versions[0].attendance.total, 27, "version 1 is kept as it was");
    a.eq(ok.report.versions[0].countersigner, "Mary Jones");
    a.eq(env.DB._one("SELECT status FROM authorisations WHERE id=?", r.authorisationId).status, "consumed");
    a.ok((await call("report.amend", am, T.A)).duplicate, "the same amendment sent twice is filed once");
    a.eq(env.DB._one("SELECT count(*) AS n FROM report_versions WHERE report_id=?", reportId).n, 1);
  });

  s.test("a countersignature made for the old version is refused; the new one verifies the amendment", async (a) => {
    a.eq((await call("report.countersign", { reportId, submissionId: "cs-c-old-01", signature: "Peter Brown", pin: "1234", version: 1 }, T.C)).error, "changed");
    const r = await call("report.countersign", { reportId, submissionId: "cs-c-0001", signature: "Peter Brown", pin: "1234", version: 2 }, T.C);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.report.status, "verified");
    a.eq(r.report.version, 2);
  });

  s.test("an approver amends with no request, but the amendment is still countersigned", async (a) => {
    const r = await call("report.amend", { reportId, amendmentId: "amend-hu-0001", reason: "Pledge was a vow", attendance: { male: 20, female: 12, children: 5 },
      ministration, entries: entries.map((x) => x.category === "Pledge" ? Object.assign({}, x, { category: "Vow" }) : x),
      countersignerId: ID.A, signature: "Grace Okafor", pin: "1234" }, T.hu);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.version, 3);
    a.eq(r.report.status, "pending_countersignature");
    a.eq(r.report.byCategory.Vow, 1000);
  });

  s.test("the sheet keeps every version: old rows are marked not current", async (a) => {
    const p = await call("sheet.pull", { sheetToken: "test-sheet-token", max: 2000 });
    const att = p.rows.filter((r) => r.tab === "ATTENDANCE" && r.row.REPORT_ID === reportId);
    const last = {};
    for (const r of att) last[r.value] = r.row;
    a.eq(last[reportId + "-v1"].CURRENT, "No");
    a.eq(last[reportId + "-v2"].CURRENT, "No");
    a.eq(last[reportId + "-v3"].CURRENT, "Yes");
    a.eq(last[reportId + "-v3"].TOTAL, 37);
    const ver = p.rows.filter((r) => r.tab === "REPORT_VERSIONS").map((r) => r.row);
    a.ok(ver.some((v) => v.VERSION_ID === reportId + "-v1" && v.REASON === "Ten more men were counted late" && v.ATTENDANCE_TOTAL === 27), JSON.stringify(ver));
    a.ok(p.rows.some((r) => r.tab === "AUDIT" && r.row.ACTION === "report.amend"));
    await call("sheet.ack", { sheetToken: "test-sheet-token", claim: p.claim, ids: p.rows.map((r) => r.id) });
  });

  s.test("the period summary adds up the reports for the coordinator's PDF; ushers cannot have it", async (a) => {
    a.eq((await call("reports.period", { from: focus, to: next }, T.A))._status, 403);
    const p = await call("reports.period", { from: focus, to: keyAfter(next, 6) }, T.hu);
    a.ok(p.ok, JSON.stringify(p));
    const one = p.rows.find((x) => x.eventId === first);
    a.eq(one.attendance.total, 37);
    a.eq(one.ministration.minister, "Pastor Ade");
    a.ok(p.totals.attendance >= 37 + 54);
    a.ok(p.totals.ministration.first_timers >= 5);
    a.eq(p.rows.length, 4, "every service in the period is listed");
    a.eq(p.totals.verified + p.totals.waiting + p.totals.missing, 4);
    a.eq((await call("reports.period", { from: next, to: focus }, T.hu)).error, "dates");
  });

  s.test("phones with alerts on are woken for new notifications, and the phone is told what for", async (a) => {
    const { outbound } = await import("../lib/worker.mjs");
    const me = await call("me", {}, T.A);
    a.ok(/^[A-Za-z0-9_-]{80,}$/.test(me.pushKey), "a public key the phone can subscribe with");
    const ep = "https://push.example/send/abc123";
    a.eq((await call("push.subscribe", { endpoint: "http://insecure" }, T.A)).error, "endpoint");
    a.ok((await call("push.subscribe", { endpoint: ep }, T.A)).ok);
    a.eq((await call("me", {}, T.A)).alertPhones, 1);
    await call.settle();
    outbound.length = 0;
    a.ok((await call("notify.send", { title: "Meeting on Tuesday", body: "All ushers please", usherIds: [ID.A] }, T.hu)).ok);
    await call.settle();
    const sent = outbound.find((o) => o.url === ep);
    a.ok(sent, "the push service was called");
    a.ok(/^vapid t=.+, k=/.test(sent.opts.headers.Authorization));
    a.eq(sent.opts.headers["Content-Length"], "0", "nothing personal goes through the push service");
    const w = await call("push.what", { endpoint: ep });
    a.eq(w.title, "Meeting on Tuesday");
    a.eq((await call("push.what", { endpoint: "https://push.example/unknown" })).body, "Open the app for the latest.");
    outbound.length = 0;
    a.ok((await call("notify.send", { title: "Again", body: "x", usherIds: [ID.A] }, T.hu)).ok);
    await call.settle();
    a.eq(outbound.filter((o) => o.url === ep).length, 1, "pushed once, not again for older notifications");
  });

  s.test("three wrong PINs lock the name for a while", async (a) => {
    await call("login", { usherId: ID.C, pin: "0000" });
    await call("login", { usherId: ID.C, pin: "0000" });
    const r = await call("login", { usherId: ID.C, pin: "0000" });
    a.eq(r.error, "locked");
    a.eq((await call("login", { usherId: ID.C, pin: "1234" })).error, "locked", "even the right PIN waits");
  });

  s.test("signing out ends the session", async (a) => {
    a.ok((await call("logout", {}, T.B)).ok);
    a.eq((await call("home", {}, T.B))._status, 401);
  });

  s.test("rules are configuration: three counters can be required instead of two", async (a) => {
    a.ok((await call("config.set", { key: "second_service_counters", value: 3 }, T.admin)).ok);
    const ev = "S" + next.replace(/-/g, "") + "-2";
    a.eq((await call("rota.set", { eventId: ev, usherIds: [ID.A, ID.B] }, T.hu)).error, "exact_count");
    a.eq((await call("config.set", { key: "second_service_counters", value: 3 }, T.hu))._status, 403);
    a.ok((await call("config.set", { key: "second_service_counters", value: 2 }, T.admin)).ok);
  });

  s.test("a write knocks on the sheet when its address is set", async (a) => {
    const env2 = makeEnv(root, { SHEET_WEBAPP_URL: "https://script.example/exec" });
    const c2 = client(mod, env2);
    await c2("bootstrap", { token: "test-bootstrap", fullName: "X Y", pin: "1234" });
    await c2.settle();
    const { outbound } = await import("../lib/worker.mjs");
    a.ok(outbound.some((o) => o.url === "https://script.example/exec"));
  });

  return s;
}
