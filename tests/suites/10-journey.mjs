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
  const login = async (who, pin) => {
    const r = await call("login", { usherId: ID[who], pin: pin || "1234" });
    if (!r.ok) throw new Error("login " + who + ": " + JSON.stringify(r));
    T[who] = r.token;
    return r;
  };

  s.test("the first System Administrator is made with the bootstrap token, once", async (a) => {
    a.eq((await call("bootstrap", { token: "wrong", fullName: "Sam Admin", pin: "9999" })).error, "forbidden");
    const r = await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" });
    a.ok(r.ok, JSON.stringify(r));
    a.eq((await call("bootstrap", { token: "test-bootstrap", fullName: "Other", pin: "9999" })).error, "already");
    const p = await call("people");
    ID.admin = p.people.find((x) => x.name === "Sam Admin").id;
    await login("admin", "9999");
  });

  s.test("the administrator adds ushers and gives roles; IDs are U-codes made by the server", async (a) => {
    for (const [k, name] of [["hu", "Grace Okafor"], ["A", "John Smith"], ["B", "Mary Jones"], ["C", "Peter Brown"],
                             ["T", "Ruth Adeyemi"], ["D", "David Cole"], ["D2", "David Cole"]]) {
      const r = await call("usher.save", { name, email: k.toLowerCase() + "@example.org", pin: "1234" }, T.admin);
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
  const body = (over) => Object.assign({ eventId: first, submissionId: "sub-a-0001", attendance: { male: 10, female: 12, children: 5 },
    entries, countersignerId: ID.B, signature: "John Smith", pin: "1234" }, over || {});

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

  s.test("20. a report signed with no signal is accepted later, once, and marked as checked on the phone", async (a) => {
    const at = Date.now() - 60000;
    const r = await call("report.submit", { eventId: second, submissionId: "offline-b-0001", entries: [{ category: "Vow", currency: "GBP", denomination: 5000, quantity: 2 }],
      countersignerId: ID.A, signature: "Mary Jones", offline: true, signedAt: at }, T.B);
    a.ok(r.ok, JSON.stringify(r));
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
    for (const t of ["USHERS", "EVENTS", "APPOINTMENTS", "REPORTS", "ATTENDANCE", "OFFERING", "AUTHORISATIONS", "AUDIT", "NOTIFICATIONS"]) a.ok(tabs.has(t), "has " + t);
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

  s.test("an approver cannot decide their own request", async (a) => {
    const ev = "S" + next.replace(/-/g, "") + "-1";
    const r = await call("authorisation.request", { kind: "report_submission", eventId: ev, reason: "test" }, T.hu);
    a.eq((await call("authorisation.decide", { id: r.authorisationId, decision: "approve", pin: "1234" }, T.hu)).error, "self_approval");
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
