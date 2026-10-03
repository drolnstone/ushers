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
    await call("usher.save", { name: "John Smith", email: "john@example.org", pin: "1234" }, admin);
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
