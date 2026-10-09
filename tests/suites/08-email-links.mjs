/* Brief 08: a link in every email, to the screen the notification is
   about. Looking costs nothing: a link only opens the app, and the PIN is
   still what acts, so no link carries a token or does anything by itself. */

import { Suite } from "../lib/t.mjs";
import { loadWorker } from "../lib/worker.mjs";
import { at, department, emailsTo } from "../lib/people.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("a link in every email");
  const BASE = "https://drolnstone.github.io/ushers";
  let D, sunday, first, reportId;

  s.test("set up: a Head Usher, an Assistant, and two ushers with addresses", async (a) => {
    D = await department(mod, root, [
      ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
      ["ahu", "Paul Mensah", ["usher", "assistant_head_usher"], { email: "ahu@example.org" }],
      ["A", "John Smith", null, { email: "a@example.org" }],
      ["B", "Mary Jones", null, { email: "b@example.org" }],
      ["C", "Peter Obi", null, { email: "c@example.org" }]
    ]);
    sunday = mod.sundayOnOrAfter(mod.londonKey(new Date()));
    first = "S" + sunday.replace(/-/g, "") + "-1";
    await D.call("rota", { from: sunday, weeks: 1 }, D.T.hu);
    a.ok((await D.call("rota.set", { eventId: first, usherIds: [D.ID.A, D.ID.B] }, D.T.hu)).ok);
  });

  s.test("a countersign-request email links to that report in the Ushers App", async (a) => {
    const r = await D.call("report.submit", { eventId: first, submissionId: "link-sun-01",
      attendance: { male: 2, female: 3, children: 1 }, ministration: { minister: "Pastor Ade" },
      entries: [{ category: "Tithe", currency: "GBP", denomination: 2000, quantity: 1 }],
      countersignerId: D.ID.B, signature: "John Smith", pin: "1234" }, D.T.A);
    a.ok(r.ok, JSON.stringify(r));
    reportId = r.report.id;
    const m = emailsTo(D.env, "b@example.org").pop();
    a.ok(m, "the chosen countersigner was emailed");
    a.has(m.body, "Open: " + BASE + "/#rep/" + reportId);
  });

  s.test("an approval-request email links to Approvals in the Admin App", async (a) => {
    /* An usher chooses somebody who is neither on the rota nor an admin, so
       the Head Usher and Assistant Head Usher are asked. */
    const E = await department(mod, root, [
      ["hu", "Grace Okafor", ["usher", "head_usher"], { email: "hu@example.org" }],
      ["ahu", "Paul Mensah", ["usher", "assistant_head_usher"], { email: "ahu@example.org" }],
      ["A", "John Smith", null, { email: "a@example.org" }],
      ["C", "Peter Obi", null, { email: "c@example.org" }]
    ]);
    const ev = "S" + sunday.replace(/-/g, "") + "-1";
    await E.call("rota", { from: sunday, weeks: 1 }, E.T.hu);
    a.ok((await E.call("rota.set", { eventId: ev, usherIds: [E.ID.A] }, E.T.hu)).ok);
    const r = await E.call("report.submit", { eventId: ev, submissionId: "link-appr-01",
      attendance: { male: 1, female: 1, children: 0 }, ministration: { minister: "Pastor Ade" }, entries: [],
      countersignerId: E.ID.C, signature: "John Smith", pin: "1234" }, E.T.A);
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.countersigner, "approval_requested");
    for (const who of ["hu", "ahu"]) {
      const m = emailsTo(E.env, who + "@example.org").filter((x) => x.subject.indexOf("Approval needed") === 0).pop();
      a.ok(m, who + " was asked");
      a.has(m.body, "Open: " + BASE + "/admin/#approvals");
    }
  });

  s.test("a Report filed email takes an admin to the Admin App's copy", async (a) => {
    a.ok((await D.call("report.countersign", { reportId, submissionId: "link-cs-01", signature: "Mary Jones", pin: "1234" }, D.T.B)).ok);
    const m = emailsTo(D.env, "hu@example.org").filter((x) => x.subject.indexOf("Report filed") === 0).pop();
    a.ok(m, "the Head Usher was told");
    a.has(m.body, "Open: " + BASE + "/admin/#report/" + reportId);
  });

  s.test("the email to somebody with alerts on no phone links each line", async (a) => {
    /* Emails wait out the quiet hours, so this runs at midday rather than
       whenever the suite happens to run. */
    await at("2026-11-10T12:00:00Z", async () => {
      const E = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["C", "Peter Obi", null, { email: "c@example.org" }]]);
      a.ok((await E.call("notify.send", { title: "Hall change", body: "Side door", usherIds: [E.ID.C] }, E.T.hu)).ok);
      /* An admin message is emailed as it is made, so for this check it is
         turned into the sort that is not: a duty reminder. */
      E.env.DB._exec("UPDATE notifications SET type='duty_reminder', emailed=0");
      a.eq(await mod.emailUnalerted(E.env, await mod.loadConfig(E.env), Date.now() + 61 * 60000), 1);
      const m = emailsTo(E.env, "c@example.org").pop();
      a.has(m.body, "Hall change");
      a.has(m.body, BASE + "/#notes");
    });
  });

  s.test("another church can move the apps: the links follow app_url", async (a) => {
    /* Emails wait out the quiet hours, so this runs at midday rather than
       whenever the suite happens to run. */
    await at("2026-11-10T12:00:00Z", async () => {
      const E = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["C", "Peter Obi", null, { email: "c@example.org" }]]);
      a.ok((await E.call("config.set", { key: "app_url", value: "https://example.church/ushers/" }, E.T.admin)).ok);
      a.ok((await E.call("notify.send", { title: "Moved", body: "", usherIds: [E.ID.C] }, E.T.hu)).ok);
      /* An admin message is emailed as it is made, so for this check it is
         turned into the sort that is not: a duty reminder. */
      E.env.DB._exec("UPDATE notifications SET type='duty_reminder', emailed=0");
      a.eq(await mod.emailUnalerted(E.env, await mod.loadConfig(E.env), Date.now() + 61 * 60000), 1);
      a.has(emailsTo(E.env, "c@example.org").pop().body, "https://example.church/ushers/#notes");
    });
  });

  s.test("with no app_url set, the email still says where to look", async (a) => {
    /* Emails wait out the quiet hours, so this runs at midday rather than
       whenever the suite happens to run. */
    await at("2026-11-10T12:00:00Z", async () => {
      const E = await department(mod, root, [["hu", "Grace Okafor", ["usher", "head_usher"]], ["C", "Peter Obi", null, { email: "c@example.org" }]]);
      a.ok((await E.call("config.set", { key: "app_url", value: "" }, E.T.admin)).ok);
      a.ok((await E.call("notify.send", { title: "No address", body: "", usherIds: [E.ID.C] }, E.T.hu)).ok);
      /* An admin message is emailed as it is made, so for this check it is
         turned into the sort that is not: a duty reminder. */
      E.env.DB._exec("UPDATE notifications SET type='duty_reminder', emailed=0");
      a.eq(await mod.emailUnalerted(E.env, await mod.loadConfig(E.env), Date.now() + 61 * 60000), 1);
      const m = emailsTo(E.env, "c@example.org").pop();
      a.has(m.body, "Open the Ushers App to see them.");
      a.hasnt(m.body, "http");
    });
  });

  s.test("the phone alert and the email open the same screen", (a) => {
    const cases = [
      [{ type: "countersign_request", ref_type: "report", ref_id: "R0001" }, false, "#rep/R0001"],
      [{ type: "report_filed", ref_type: "report", ref_id: "R0001" }, true, "admin/#report/R0001"],
      [{ type: "report_filed", ref_type: "report", ref_id: "R0001" }, false, "#rep/R0001"],
      [{ type: "approval_request", ref_type: "authorisation", ref_id: "A0001" }, false, "admin/#approvals"],
      [{ type: "duty_reminder", ref_type: "event", ref_id: "E0001" }, false, "#report/E0001"],
      [{ type: "admin_message", ref_type: "", ref_id: "" }, false, "#notes"]
    ];
    for (const [n, isAdmin, want] of cases) {
      a.eq(mod.linkFor(n, isAdmin), want, n.type + (isAdmin ? " (admin)" : ""));
      a.eq(mod.linkTo({ app_url: "https://x.test/u/" }, n, isAdmin), "https://x.test/u/" + want);
    }
  });

  return s;
}
