/* The sheet: header-driven writes, protection with a short unlock window,
   and the drain from the real Worker. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, makeEnv, client } from "../lib/worker.mjs";
import { loadCodeGs } from "../lib/codegs.mjs";

/* UrlFetchApp in the fake is synchronous; the Worker is not. So the Worker's
   answers are prepared first and handed back in order. */
export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("the Google Sheet record");
  const PROPS = { WORKER_URL: "https://api.test", SHEET_TOKEN: "test-sheet-token" };

  s.test("set up makes every tab with its headers, protects each to the owner, and installs the timers", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: PROPS, userEmail: "owner@example.org" });
    ctx.setUpSheet();
    for (const tab of Object.keys(ctx.TABS)) {
      const sh = gas.ss.getSheetByName(tab);
      a.ok(sh, tab);
      a.same(ctx.headerRow(sh), ctx.TABS[tab]);
      const p = sh.protections[0];
      a.ok(p && !p.warn, tab + " is strictly protected");
      a.same(p.editors, ["owner@example.org"], tab + " only the owner edits");
      a.not(p.domain);
    }
    a.same(gas.triggers.map((t) => t.fn).sort(), ["drain", "relockOverdue"]);
    const g = gas.ss.getSheetByName("GUIDE");
    a.ok(g, "a GUIDE tab explains the others");
    a.same(ctx.headerRow(g), ["TAB", "WHAT IT HOLDS", "ONE ROW IS", "GOOD TO KNOW"]);
    for (const tab of Object.keys(ctx.TABS)) a.ok(ctx.GUIDE.some((r) => r[0] === tab), "GUIDE explains " + tab);
    a.eq(g.protections.length, 1, "GUIDE is protected too");
  });

  s.test("rows are written by header: moving a column breaks nothing, and an added column is kept", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: PROPS, tabs: {
      USHERS: [["NOTES BY HAND", "FULL_NAME", "USHER_ID", "EMAIL"], ["keep me", "Old Name", "U001", "x@example.org"]]
    } });
    ctx.writeTab(gas.ss, "USHERS", [
      { tab: "USHERS", mode: "upsert", key: "USHER_ID", value: "U001", row: { USHER_ID: "U001", FULL_NAME: "John Smith" } },
      { tab: "USHERS", mode: "upsert", key: "USHER_ID", value: "U002", row: { USHER_ID: "U002", FULL_NAME: "=HYPERLINK(\"x\")" } }
    ]);
    const sh = gas.ss.getSheetByName("USHERS");
    const map = ctx.headerMap(sh);
    a.eq(sh.getRange(2, map.FULL_NAME).getValue(), "John Smith");
    a.eq(sh.getRange(2, map["NOTES BY HAND"]).getValue(), "keep me");
    a.eq(sh.getRange(2, map.EMAIL).getValue(), "x@example.org");
    a.eq(sh.getRange(3, map.USHER_ID).getValue(), "U002");
    a.eq(sh.getRange(3, map.FULL_NAME).getValue(), "'=HYPERLINK(\"x\")", "a formula is written as text");
    a.ok(map.ROLES, "missing headers are added at the end");
  });

  s.test("a write unlocks only its tabs and protects them again, even when it fails", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: PROPS, userEmail: "owner@example.org" });
    ctx.setUpSheet();
    const ss = gas.ss;
    let seen;
    ctx.withUnlocked(ss, ["REPORTS"], () => { seen = ss.getSheetByName("REPORTS").protections.length; });
    a.eq(seen, 0, "open during the write");
    a.eq(ss.getSheetByName("REPORTS").protections.length, 1, "protected after");
    a.eq(ss.getSheetByName("AUDIT").protections.length, 1, "other tabs never opened");
    try { ctx.withUnlocked(ss, ["REPORTS"], () => { throw new Error("boom"); }); } catch (e) {}
    a.eq(ss.getSheetByName("REPORTS").protections.length, 1, "protected after a failure");
    a.same(JSON.parse(gas.props.unlockedTabs), {});
  });

  s.test("a tab left open past the window is protected again by the timer, not before", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: PROPS, userEmail: "owner@example.org" });
    ctx.setUpSheet();
    const sh = gas.ss.getSheetByName("DUES");
    sh.protections.length = 0;
    gas.props.unlockedTabs = JSON.stringify({ DUES: Date.now() - 60000 });
    a.same(ctx.relockOverdue(), [], "one minute in: left alone");
    gas.props.unlockedTabs = JSON.stringify({ DUES: Date.now() - 6 * 60000 });
    a.same(ctx.relockOverdue(), ["DUES"], "six minutes in: protected");
    a.eq(sh.protections.length, 1);
  });

  s.test("the drain takes the server's outbox onto the tabs, sends the emails, and acknowledges", async (a) => {
    const env = makeEnv(root);
    const call = client(mod, env);
    await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999", email: "sam@example.org" });
    const admin = (await call("login", { usherId: "U001", pin: "9999" })).token;
    await call("usher.save", { name: "John Smith", email: "john@example.org", pin: "1234", mustChange: false }, admin);
    await call("usher.roles", { usherId: "U001", roles: ["usher", "system_admin", "head_usher"] }, admin);
    a.ok((await call("notify.send", { all: true, title: "Welcome", body: "Hello" }, admin)).ok);
    /* Two pulls prepared from the real Worker, the second empty. */
    const first = await call("sheet.pull", { sheetToken: "test-sheet-token", max: 200 });
    const { gas, ctx } = loadCodeGs(root, { props: PROPS, userEmail: "owner@example.org" });
    ctx.setUpSheet();
    const acks = [];
    gas.setFetchReply((url, opts) => {
      const body = JSON.parse(opts.payload);
      if (url.endsWith("/api/sheet.pull")) return { code: 200, body: JSON.stringify(acks.length ? { ok: true, rows: [], more: 0 } : first) };
      if (url.endsWith("/api/sheet.ack")) { acks.push(body); return { code: 200, body: JSON.stringify({ ok: true }) }; }
      return { code: 404, body: "{}" };
    });
    const r = ctx.drain();
    a.ok(r.written > 0);
    a.eq(r.emailed, 2, "the admin message emailed to both: ");
    a.eq(acks.length, 1);
    a.eq(acks[0].ids.length, first.rows.length);
    const ack = await call("sheet.ack", acks[0]);
    a.eq(ack.done, first.rows.length);
    const sh = gas.ss.getSheetByName("USHERS");
    const map = ctx.headerMap(sh);
    const names = sh.getRange(2, map.FULL_NAME, sh.getLastRow() - 1, 1).getValues().map((x) => x[0]);
    a.same(names, ["Sam Admin", "John Smith"]);
    a.eq(gas.mail[0].to, "sam@example.org");
    for (const tab of Object.keys(ctx.TABS)) a.eq(gas.ss.getSheetByName(tab).protections.length, 1, tab + " protected after the drain");
  });

  s.test("an email that fails to send is not acknowledged, so the server offers it again", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: PROPS, userEmail: "owner@example.org" });
    ctx.setUpSheet();
    const rows = [
      { id: 1, tab: "@email", row: { to: "a@example.org", subject: "One", body: "x" } },
      { id: 2, tab: "@email", row: { to: "b@example.org", subject: "Two", body: "x" } },
      { id: 3, tab: "@email", row: { subject: "No address", body: "x" } }
    ];
    const acks = [];
    gas.setFetchReply((url, opts) => {
      if (url.endsWith("/api/sheet.pull")) return { code: 200, body: JSON.stringify(acks.length ? { ok: true, rows: [] } : { ok: true, claim: "c1", rows, more: 0 }) };
      if (url.endsWith("/api/sheet.ack")) { acks.push(JSON.parse(opts.payload)); return { code: 200, body: "{\"ok\":true}" }; }
      return { code: 404, body: "{}" };
    });
    const send = ctx.MailApp.sendEmail;
    ctx.MailApp.sendEmail = function (m) {
      if ((typeof m === "object" ? m.to : m) === "b@example.org") throw new Error("Service invoked too many times for one day: email.");
      return send.apply(this, arguments);
    };
    const r = ctx.drain();
    a.eq(r.emailed, 1, "only the email that went is counted");
    a.same(acks[0].ids, [1, 3], "the failed send is left for the next drain; a row with no address is done");
  });

  s.test("text made only of digits keeps its leading zero", (a) => {
    const { ctx } = loadCodeGs(root, { props: PROPS });
    a.eq(ctx.safeCell("07700900123"), "'07700900123");
    a.eq(ctx.safeCell("2026"), "'2026");
    a.eq(ctx.safeCell("+447700900123"), "'+447700900123");
    a.eq(ctx.safeCell("07700 900123"), "07700 900123");
    a.eq(ctx.safeCell(12), 12, "a number stays a number");
    a.eq(ctx.safeCell("-5"), "-5");
    a.eq(ctx.safeCell(""), "");
  });

  s.test("Check everything shows the knock, the last collection and the server's clock", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: PROPS, userEmail: "owner@example.org" });
    ctx.setUpSheet();
    const health = (checks, people) => gas.setFetchReply(() => ({ code: 200, body: JSON.stringify({ ok: true, server: "w0.3.5",
      checks: Object.assign({ pinPepper: true, sheetToken: true, waitingForSheet: 0 }, checks), people: people }) }));
    health({ sheetKnock: false, sheetLastDrained: 0, clockLastTick: 0 });
    let lines = ctx.healthLines().join("\n");
    a.has(lines, "✗ The server has SHEET_WEBAPP_URL");
    a.has(lines, "✗ The sheet has never collected");
    a.has(lines, "✗ The server's clock has never run");
    a.has(lines, "NEEDS ATTENTION");
    health({ sheetKnock: true, sheetLastDrained: Date.now() - 12 * 60000, clockLastTick: Date.now() - 2 * 60000 });
    lines = ctx.healthLines().join("\n");
    a.has(lines, "✓ The server has SHEET_WEBAPP_URL");
    a.has(lines, "✓ The sheet last collected 12 minutes ago");
    a.has(lines, "✓ The server's clock last ran 2 minutes ago");
    a.has(lines, "Nothing needs attention.");
    a.hasnt(lines, "NEEDS ATTENTION");
    health({ sheetKnock: true, sheetLastDrained: Date.now(), clockLastTick: Date.now() - 3 * 3600000 });
    a.has(ctx.healthLines().join("\n"), "✗ The server's clock last ran 3 hours ago");
  });

  s.test("Check everything names people, and sorts them into the three blocks", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: PROPS, userEmail: "owner@example.org" });
    ctx.setUpSheet();
    const ok = { pinPepper: true, sheetToken: true, sheetKnock: true, waitingForSheet: 0,
      sheetLastDrained: Date.now(), clockLastTick: Date.now() - 60000 };
    gas.setFetchReply(() => ({ code: 200, body: JSON.stringify({ ok: true, server: "w0.3.11", checks: ok, people: {
      ushers: 9, alertsOn: 7, alertsOff: ["John Smith", "Mary Jones"], unreachable: ["Mary Jones"],
      defaultPin: ["Peter Obi"], sunday: "2026-10-11",
      sundayGaps: ["Sunday Second Service: 1 of 2"], reportsOverdue: ["Vigil 03/10/2026"]
    } }) }));
    const lines = ctx.healthLines();
    const text = lines.join("\n");
    const block = (name) => text.slice(text.indexOf(name), text.indexOf(name) === -1 ? 0 : undefined).split(/\n(?=[A-Z]{4})/)[0];
    a.has(block("NEEDS ATTENTION"), "Nothing can reach: Mary Jones");
    a.has(block("NEEDS ATTENTION"), "Sunday 2026-10-11 is short — Sunday Second Service: 1 of 2");
    a.has(block("NEEDS ATTENTION"), "Report still missing: Vigil 03/10/2026");
    a.has(block("STILL TO DO"), "No alerts yet for: John Smith, Mary Jones");
    a.has(block("STILL TO DO"), "Still on the default PIN: Peter Obi");
    a.has(block("FINE"), "Alerts on: 7 of 9");
    a.hasnt(block("FINE"), "Nothing can reach");
  });

  s.test("with nobody to chase, the people lines say so", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: PROPS, userEmail: "owner@example.org" });
    ctx.setUpSheet();
    gas.setFetchReply(() => ({ code: 200, body: JSON.stringify({ ok: true, server: "w0.3.11",
      checks: { pinPepper: true, sheetToken: true, sheetKnock: true, waitingForSheet: 0, sheetLastDrained: Date.now(), clockLastTick: Date.now() },
      people: { ushers: 9, alertsOn: 9, alertsOff: [], unreachable: [], defaultPin: [], sunday: "2026-10-11", sundayGaps: [], reportsOverdue: [] } }) }));
    const text = ctx.healthLines().join("\n");
    a.has(text, "Nothing needs attention.");
    a.has(text, "✓ Alerts on: 9 of 9");
    a.has(text, "✓ Sunday 2026-10-11 is fully rostered");
    a.has(text, "✓ No reports outstanding");
    a.hasnt(text, "STILL TO DO");
  });

  s.test("the same rows drained twice are written once", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: PROPS });
    const rows = [{ tab: "AUDIT", mode: "upsert", key: "AUDIT_ID", value: "x1", row: { AUDIT_ID: "x1", ACTION: "a" } }];
    ctx.writeTab(gas.ss, "AUDIT", rows);
    ctx.writeTab(gas.ss, "AUDIT", rows);
    a.eq(gas.ss.getSheetByName("AUDIT").getLastRow(), 2);
  });

  s.test("the knock needs the sheet token", (a) => {
    const { ctx } = loadCodeGs(root, { props: PROPS });
    const out = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: "drain", sheetToken: "wrong" }) } }).getContent());
    a.eq(out.error, "forbidden");
  });

  return s;
}
