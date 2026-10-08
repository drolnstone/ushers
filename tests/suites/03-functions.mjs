/* Brief 03, part 3: no dead code. A function nobody calls is usually a
   feature that was removed around it, with its comment left behind saying
   the app still does something it does not. */

import { Suite } from "../lib/t.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { topLevelNames } from "../lib/worker.mjs";

/* The shared page files are one big function, so their declarations sit at
   one indent, not none. Same idea as topLevelNames, one level in. */
function insideNames(src) {
  const out = new Set();
  for (const line of src.split("\n")) {
    const m = /^  (?:async )?function ([A-Za-z_$][\w$]*)\s*\(/.exec(line) || /^  (?:const|let|var) ([A-Za-z_$][\w$]*)\s*=\s*(?:function|\()/.exec(line);
    if (m) out.add(m[1]);
  }
  return [...out];
}

const FILES = ["server/worker.js", "Code.gs", "shared/core.js", "shared/reports.js", "shared/pdf.js", "sw.js"];

/* Called from outside the file, so a file that never names them is right:
   Apps Script's own hooks and menu entries, the Worker's export, and the
   service worker's events. Anything else must be called somewhere. */
const ENTRY = new Set(["doGet", "doPost", "onOpen", "onEdit", "onInstall", "setup", "drain", "health", "checkEverything"]);

/* Comments out, strings kept: a name used only in a string is used (Apps
   Script menus pass function names as strings). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

export default async function ({ root }) {
  const s = new Suite("no dead code");

  for (const f of FILES) {
    const raw = readFileSync(join(root, f), "utf8");
    const code = stripComments(raw);
    const found = topLevelNames(code).concat(insideNames(code));
    const names = [...new Set(found)].filter((n) => !ENTRY.has(n));
    const others = FILES.filter((x) => x !== f).map((x) => stripComments(readFileSync(join(root, x), "utf8")));
    const pages = ["index.html", "admin/index.html", "admin/testing.js"].map((x) => stripComments(readFileSync(join(root, x), "utf8")));

    s.test(f + " names were found to check", (a) => a.ok(names.length > 2, f + ": only " + names.length + " top-level names"));

    for (const n of names) {
      s.test(f + ": " + n + " is used", (a) => {
        const re = new RegExp("\\b" + n.replace(/\$/g, "\\$") + "\\b", "g");
        /* In its own file, once for the declaration and at least once more.
           Elsewhere, any mention counts (the tests' own export block is not
           read here, so a function only tests call still shows as dead). */
        const mine = (code.match(re) || []).length;
        const theirs = others.concat(pages).some((x) => re.test(x));
        a.ok(mine > 1 || theirs, n + " is declared in " + f + " and never used");
      });
    }
  }

  return s;
}
