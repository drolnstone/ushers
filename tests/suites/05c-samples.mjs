/* A FADED "e.g." SAMPLE IN EVERY TYPING BOX, as in the Driver App (its
   suite 62). PIN boxes, dates and times, ticks and choices stay blank. A
   sample is an example, not explaining text. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";

const FILES = ["index.html", "admin/index.html", "admin/testing.js", "shared/reports.js"];
const BLANK = /type: "(password|checkbox|radio|date|time|datetime-local|file|hidden)"|class: "pin"/;

export default function ({ root }) {
  const s = new Suite("a sample in every typing box");
  for (const f of FILES) {
    s.test(f + ": every typing box has an \"e.g.\" sample", (a) => {
      const src = readFileSync(join(root, f), "utf8");
      const re = /h\("(input|textarea)",\s*\{([\s\S]*?)\}\s*(?:,|\))/g;
      let m, n = 0;
      while ((m = re.exec(src))) {
        const attrs = m[2];
        if (BLANK.test(attrs)) continue;
        n++;
        a.ok(/placeholder:\s*(f\.kind[^,]*\?\s*)?"e\.g\. /.test(attrs), f + ": no \"e.g.\" sample in " + attrs.replace(/\s+/g, " ").slice(0, 90));
      }
      a.ok(n > 0 || f === "admin/testing.js", "found the boxes");
    });
  }
  s.test("the samples are faded", (a) => {
    a.ok(/::placeholder\s*\{[^}]*(opacity|color)/.test(readFileSync(join(root, "shared/style.css"), "utf8")), "style.css fades ::placeholder");
  });
  return s;
}
