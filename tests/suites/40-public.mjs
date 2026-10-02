/* The repository is public: nothing in a shipped file may be a secret, and
   the pages must never print an internal U-code. */

import { Suite } from "../lib/t.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export default async function ({ root }) {
  const s = new Suite("nothing secret in public code");
  let files = [];
  try { files = execSync("git ls-files", { cwd: root }).toString().split("\n").filter(Boolean); } catch (e) {}
  const shipped = files.filter((f) => !f.startsWith("tests/") && !/\.(png|svg)$/.test(f));

  s.test("no secret values in shipped files", (a) => {
    const bad = [
      [/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/, "an Apps Script deployment address"],
      [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
      [/\b(PIN_PEPPER|SHEET_TOKEN|BOOTSTRAP_TOKEN)\s*[:=]\s*["'][^"']{6,}["']/, "a secret assigned in code"],
      [/\b[a-f0-9]{40,}\b/, "a long hex string"],
      [/AKIA[0-9A-Z]{16}/, "a cloud key"]
    ];
    for (const f of shipped) {
      const src = readFileSync(join(root, f), "utf8");
      for (const [re, what] of bad) a.not(re.test(src), f + " contains " + what);
    }
  });

  s.test("the Worker has no fallback for its secrets", (a) => {
    const w = readFileSync(join(root, "server", "worker.js"), "utf8");
    a.not(/PIN_PEPPER\)\s*\|\|\s*["'][^"']/.test(w), "PIN_PEPPER must not fall back to a value");
    a.not(/SHEET_TOKEN\s*\|\|\s*["'][^"']/.test(w), "SHEET_TOKEN must not fall back to a value");
    a.not(/BOOTSTRAP_TOKEN\s*\|\|\s*["'][^"']/.test(w), "BOOTSTRAP_TOKEN must not fall back to a value");
  });

  /* The browser journey (tests/browser/journey.mjs) also reads every
     usher screen it visits and fails on a visible U-code. */
  s.test("no U-code is typed into a page", (a) => {
    for (const f of ["index.html", "admin/index.html"]) {
      a.not(/\bU\d{3}\b/.test(readFileSync(join(root, f), "utf8")), f);
    }
  });

  return s;
}
