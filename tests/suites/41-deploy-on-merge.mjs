/* Deploy on merge, from the Driver App: Cloudflare builds the Worker from
   wrangler.toml, and a GitHub workflow puts Code.gs live. Both only after
   the tests pass, and neither carries the /exec address. */

import { Suite } from "../lib/t.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export default function ({ root }) {
  const s = new Suite("deploy on merge");
  const read = (f) => readFileSync(join(root, f), "utf8");

  s.test("wrangler.toml builds this Worker, runs the tests first, and keeps the dashboard's variables", (a) => {
    const w = read("wrangler.toml");
    a.has(w, 'name = "ushers-api"');
    a.has(w, 'main = "server/worker.js"');
    a.has(w, 'command = "node tests/run-tests.mjs"');
    a.has(w, "keep_vars = true");
    a.has(w, 'binding = "DB"');
    a.not(/^\s*[A-Z_]+\s*=\s*"/m.test(w.split("[vars]")[1] || ""), "no [vars] that would overwrite the dashboard");
  });

  s.test("the Worker's clock in wrangler.toml is the one DEPLOY.md sets", (a) => {
    a.has(read("wrangler.toml"), 'crons = ["*/5 * * * *"]');
    a.has(read("DEPLOY.md"), "*/5 * * * *");
  });

  s.test("Code.gs goes live only after Tests pass on main, with the deployment ID kept secret", (a) => {
    const y = read(".github/workflows/apps-script.yml");
    a.has(y, "workflows: [Tests]");
    a.has(y, "conclusion == 'success'");
    a.has(y, "DEPLOYMENT_ID: ${{ secrets.DEPLOYMENT_ID }}");
    a.has(y, "SHEET_VERSION = ");
    a.has(read("Code.gs"), 'var SHEET_VERSION = "');
    a.eq(read(".github/workflows/tests.yml").match(/^name: (.*)$/m)[1].trim(), "Tests", "the workflow it waits on is called Tests");
  });

  s.test("Node 22 for Cloudflare's build, which the tests need for node:sqlite", (a) => {
    a.eq(read(".node-version").trim(), "22");
  });

  return s;
}
