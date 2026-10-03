#!/usr/bin/env node
/* THE RUNNER — same shape as the Driver App's.

       node tests/run-tests.mjs              everything
       node tests/run-tests.mjs reports      only suites whose file name matches

   Reads the project fresh on every run and ends in one word: READY or
   NOT READY. */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { Suite } from "./lib/t.mjs";
import { cleanup } from "./lib/worker.mjs";

process.env.TZ = "Europe/London";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(here, ".."));
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const PARSE_JS = ["server/worker.js", "Code.gs", "config.js", "shared/core.js", "shared/reports.js", "shared/pdf.js", "sw.js"];
const PAGES = ["index.html", "admin/index.html"];

function parseCheck() {
  const s = new Suite("every file parses");
  for (const f of [...PARSE_JS, ...PAGES, "server/schema.sql", "manifest.webmanifest", "admin/manifest.webmanifest",
                   "shared/vendor/jspdf.umd.min.js", "shared/vendor/jspdf.LICENSE.txt", "shared/logo.png",
                   "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-512-maskable.png",
                   "admin/apple-touch-icon.png", "admin/icon-192.png", "admin/icon-512.png", "admin/icon-512-maskable.png"]) {
    s.test(f + " is present", (a) => a.ok(existsSync(join(ROOT, f)), f + " is missing"));
  }
  for (const f of PARSE_JS) {
    s.test(f + " parses", () => {
      let src = readFileSync(join(ROOT, f), "utf8");
      src = src.replace(/^export default\s*\{/m, "const __default = {").replace(/^export\s+/gm, "");
      new vm.Script(src, { filename: f });
    });
  }
  for (const f of PAGES) {
    s.test(f + " inline scripts parse", () => {
      const html = readFileSync(join(ROOT, f), "utf8");
      const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
      let m;
      while ((m = re.exec(html))) new vm.Script(m[1], { filename: f });
    });
  }
  return s;
}

const BOLD = "\u001b[1m", RED = "\u001b[31m", GREEN = "\u001b[32m", OFF = "\u001b[0m";
const paint = process.stdout.isTTY ? (c, t) => c + t + OFF : (c, t) => t;

const suites = [parseCheck()];
const dir = join(here, "suites");
for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs")).sort()) {
  if (only.length && !only.some((o) => f.indexOf(o) !== -1)) continue;
  const mod = await import(pathToFileURL(join(dir, f)).href);
  const got = await mod.default({ root: ROOT });
  for (const s of [].concat(got)) suites.push(s);
}

let passed = 0, failed = 0;
for (const s of suites) {
  const r = await s.run();
  passed += r.passed; failed += r.failed;
  console.log((r.failed ? paint(RED, "✗") : paint(GREEN, "✓")) + " " + r.name + "  (" + r.passed + "/" + (r.passed + r.failed) + ")");
  for (const f of r.failures) console.log("    " + paint(RED, "✗ " + f.what) + "\n      " + f.why);
}
cleanup(ROOT);
console.log("\n" + passed + " passed, " + failed + " failed");
console.log(paint(BOLD, failed ? paint(RED, "NOT READY") : paint(GREEN, "READY")));
process.exit(failed ? 1 : 0);
