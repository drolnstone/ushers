/* v0.2.0: a database made by the v0.1.0 schema catches up by itself, and
   both PDFs are made from real server answers with the real jsPDF. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, makeEnv, client } from "../lib/worker.mjs";
import { makeDB } from "../lib/d1.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("amendable reports on an older database, and PDFs");

  /* One whole report, on a database built from the v0.1.0 schema. */
  let view, period, cfg;
  s.test("a database made by the v0.1.0 schema gets the new tables and columns on first use", async (a) => {
    let old;
    try { old = execFileSync("git", ["show", "8443ad2:server/schema.sql"], { cwd: root, encoding: "utf8" }); }
    catch (e) { old = null; }
    let env;
    if (old) {
      a.not(/ministration_json|report_versions|push_subs/.test(old), "really the old schema");
      mkdirSync(join(root, "tests", ".build"), { recursive: true });
      const f = join(root, "tests", ".build", "old-schema.sql");
      writeFileSync(f, old);
      env = makeEnv(root, { DB: makeDB(f) });
    } else {
      env = makeEnv(root); /* a shallow clone has no history; still run the rest */
    }
    const call = client(mod, env);
    a.ok((await call("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" })).ok);
    const adminId = (await call("people")).people[0].id;
    const admin = (await call("login", { usherId: adminId, pin: "9999" })).token;
    a.ok((await call("usher.roles", { usherId: adminId, roles: ["system_admin", "head_usher"] }, admin)).ok);
    const u = (await call("usher.save", { name: "John Smith", pin: "1234" }, admin)).usherId;
    const v = (await call("usher.save", { name: "Mary Jones", pin: "1234" }, admin)).usherId;
    const john = (await call("login", { usherId: u, pin: "1234" })).token;
    const mary = (await call("login", { usherId: v, pin: "1234" })).token;
    await call("rota", { from: "2026-10-01", weeks: 1 }, admin);
    a.ok((await call("rota.set", { eventId: "S20261004-1", usherIds: [u, v] }, admin)).ok);
    const sub = await call("report.submit", { eventId: "S20261004-1", submissionId: "old-db-0001", attendance: { male: 1, female: 2, children: 3 },
      ministration: { minister: "Pastor Ade – “guest”", sermon_title: "Grace", first_timers: 1 },
      entries: [{ category: "Tithe", currency: "GBP", denomination: 2000, quantity: 2 }], countersignerId: v, signature: "John Smith", pin: "1234" }, john);
    a.ok(sub.ok, JSON.stringify(sub));
    a.ok((await call("report.countersign", { reportId: sub.report.id, submissionId: "old-db-cs-01", signature: "Mary Jones", pin: "1234" }, mary)).ok);
    const am = await call("report.amend", { reportId: sub.report.id, amendmentId: "old-db-am-01", reason: "Tithe was 3 notes", attendance: { male: 1, female: 2, children: 3 },
      ministration: { minister: "Pastor Ade", sermon_title: "Grace", first_timers: 1 },
      entries: [{ category: "Tithe", currency: "GBP", denomination: 2000, quantity: 3 }], countersignerId: v, signature: "Sam Admin", pin: "9999" }, admin);
    a.ok(am.ok, JSON.stringify(am));
    a.ok(await call("push.subscribe", { endpoint: "https://push.example/x" }, john));
    view = (await call("report.open", { reportId: sub.report.id }, admin));
    period = await call("reports.period", { from: "2026-10-01", to: "2026-10-31" }, admin);
    cfg = (await call("me", {}, admin)).config;
    a.ok(period.ok, JSON.stringify(period));
  });

  /* The same jspdf.umd.min.js the pages load, under Node's require, with
     pdf.js run as a page would run it. */
  function loadPdf() {
    const jspdf = createRequire(import.meta.url)(join(root, "shared", "vendor", "jspdf.umd.min.js"));
    const win = { jspdf };
    vm.runInNewContext(readFileSync(join(root, "shared", "pdf.js"), "utf8"), { window: win, Date, Number, String });
    return win;
  }

  s.test("a service report PDF is made, with every part of the report and its earlier version", (a) => {
    const w = loadPdf();
    a.ok(w.jspdf && w.UshersPdf, "jsPDF and pdf.js loaded");
    const made = w.UshersPdf.service(view.report, view.event, cfg, { made: "2 Oct 2026", who: "Sam Admin" });
    a.eq(made.name, "Ushering - Sunday First Service (Thanksgiving Sunday) - 2026-10-04 v2.pdf");
    const out = made.doc.output();
    a.ok(out.startsWith("%PDF-"), "a PDF");
    a.ok(made.doc.getNumberOfPages() >= 1);
    a.eq(w.UshersPdf.clean("Ade – “guest”"), "Ade - \"guest\"", "characters the PDF fonts lack are made plain, not dropped");
  });

  s.test("a period summary PDF is made from reports.period", (a) => {
    const w = loadPdf();
    const made = w.UshersPdf.period(period, cfg, { made: "2 Oct 2026", who: "Sam Admin" });
    a.eq(made.name, "Ushering - Summary - 2026-10-01 to 2026-10-31.pdf");
    a.ok(made.doc.output().startsWith("%PDF-"));
    a.eq(period.totals.offering, 6000, "the amended total, not the first one");
  });

  s.test("the home-screen icons are real PNGs at the sizes the manifests and iPhone ask for", (a) => {
    const size = (f) => { const b = readFileSync(join(root, f)); a.eq(b.toString("latin1", 1, 4), "PNG", f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    for (const d of ["", "admin/"]) {
      a.same(size(d + "apple-touch-icon.png"), [180, 180]);
      a.same(size(d + "icon-192.png"), [192, 192]);
      a.same(size(d + "icon-512.png"), [512, 512]);
      a.same(size(d + "icon-512-maskable.png"), [512, 512]);
      const html = readFileSync(join(root, d + "index.html"), "utf8");
      a.ok(/<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">/.test(html), d + "index.html links the iPhone icon");
      const man = JSON.parse(readFileSync(join(root, d + "manifest.webmanifest"), "utf8"));
      a.ok(man.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
    }
  });

  return s;
}
