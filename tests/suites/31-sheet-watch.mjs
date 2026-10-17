/* From the Driver App (sheet v1.119.0 and v1.120.0): a new version of
   Code.gs sets the sheet up by itself, and a watchdog emails when the
   server stops. Both ride the five-minute relockOverdue timer, which never
   needs the server to be up. */

import { Suite } from "../lib/t.mjs";
import { loadCodeGs } from "../lib/codegs.mjs";

export default async function ({ root }) {
  const s = new Suite("the sheet sets itself up, and watches the server");
  const PROPS = { WORKER_URL: "https://api.test", SHEET_TOKEN: "test-sheet-token" };
  const health = (tickAgoMin) => ({ code: 200, body: JSON.stringify({ ok: true, server: "w", checks: { clockLastTick: tickAgoMin == null ? 0 : Date.now() - tickAgoMin * 60000 } }) });

  s.test("a new version: the timer runs Set up once, without being asked", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: Object.assign({ SET_UP_FOR: "v0.0.1" }, PROPS) });
    gas.setFetchReply(health(1));
    ctx.relockOverdue();
    a.eq(gas.props.SET_UP_FOR, ctx.SHEET_VERSION, "stamped with this version");
    for (const tab of Object.keys(ctx.TABS)) a.ok(gas.ss.getSheetByName(tab), tab + " made");
    a.same(gas.triggers.map((t) => t.fn).sort(), ["drain", "relockOverdue"]);
    const before = gas.triggers.length;
    a.eq(ctx.setUpIfNew(), false, "and not again for the same version");
    a.eq(gas.triggers.length, before);
  });

  s.test("three tries at most for one version, and Check everything says it has not run", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: Object.assign({}, PROPS) });
    ctx.setUpSheet = () => { throw new Error("no permission"); };
    for (let i = 0; i < 5; i++) { try { ctx.setUpIfNew(); } catch (e) {} }
    a.eq(gas.props.SET_UP_TRIES, ctx.SHEET_VERSION + ":3");
    gas.setFetchReply(health(1));
    a.ok(ctx.healthLines().some((l) => l.indexOf("✗ Set up has not run for " + ctx.SHEET_VERSION) !== -1));
  });

  s.test("the watchdog emails once when the clock stops, and once when it is back", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: Object.assign({}, PROPS), userEmail: "owner@example.org" });
    gas.setFetchReply(health(45));
    a.eq(ctx.watchServer(), "The server's clock last ran 45 minutes ago.");
    a.eq(gas.mail.length, 1);
    a.eq(gas.mail[0].to, "owner@example.org", "the sheet's owner when WATCH_EMAIL is blank");
    a.eq(gas.mail[0].subject, "Ushers: the server has stopped");
    a.eq(ctx.watchServer(), null, "asked at most every half hour");
    gas.props.WATCH_AT = "0";
    ctx.watchServer();
    a.eq(gas.mail.length, 1, "not told twice about the same stop");
    a.ok(ctx.healthLines().some((l) => l.indexOf("Watchdog:") !== -1), "Check everything shows it");
    gas.props.WATCH_AT = "0";
    gas.setFetchReply(health(2));
    a.eq(ctx.watchServer(), "");
    a.eq(gas.mail.length, 2);
    a.eq(gas.mail[1].subject, "Ushers: the server is running again");
  });

  s.test("no answer at all counts, and WATCH_EMAIL is used when set", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: Object.assign({ WATCH_EMAIL: "asim@example.org" }, PROPS) });
    gas.setFetchReply({ code: 502, body: "<html>Bad gateway</html>" });
    a.eq(ctx.watchServer(), "The server did not answer.");
    a.eq(gas.mail[0].to, "asim@example.org");
  });

  s.test("a healthy server sends nothing", (a) => {
    const { gas, ctx } = loadCodeGs(root, { props: Object.assign({}, PROPS) });
    gas.setFetchReply(health(3));
    a.eq(ctx.watchServer(), "");
    a.eq(gas.mail.length, 0);
  });

  return s;
}
