/* Brief 03, part 2: every element the code looks up exists, in the app that
   looks it up. A renamed id leaves a button that silently does nothing,
   which no other test sees. The two apps are checked apart, so an id that
   only the Admin App has never covers a lookup in the Ushers App. */

import { Suite } from "../lib/t.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHARED = ["shared/core.js", "shared/reports.js", "shared/pdf.js"];
const APPS = [
  { name: "the Ushers App", files: ["index.html"].concat(SHARED) },
  { name: "the Admin App", files: ["admin/index.html", "admin/testing.js"].concat(SHARED) }
];

/* Ids built at run time, with the code that builds them. Each is listed on
   purpose: a lookup whose id is not a plain string belongs here. */
const MADE_AT_RUN_TIME = [/^att-/, /^min-/, /^cfg-/];

function idsIn(src) {
  const out = new Set();
  for (const re of [/\bid="([A-Za-z][\w-]*)"/g, /\bid:\s*"([A-Za-z][\w-]*)"/g]) {
    let m;
    while ((m = re.exec(src))) out.add(m[1]);
  }
  return out;
}

function lookupsIn(src, f) {
  const out = [];
  for (const re of [/getElementById\("([^"]*)"\)/g, /querySelector\("#([^"]*)"\)/g]) {
    let m;
    while ((m = re.exec(src))) out.push({ f, id: m[1], at: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

export default async function ({ root }) {
  const s = new Suite("every element the code looks up exists");
  const read = (f) => readFileSync(join(root, f), "utf8");
  let lookups = 0, ids = 0;

  for (const app of APPS) {
    const have = new Set();
    for (const f of app.files) for (const id of idsIn(read(f))) have.add(id);
    ids += have.size;
    for (const f of app.files) {
      for (const w of lookupsIn(read(f), f)) {
        lookups++;
        s.test(app.name + ", " + w.f + ":" + w.at + ", #" + w.id, (a) => {
          a.ok(have.has(w.id) || MADE_AT_RUN_TIME.some((re) => re.test(w.id)),
            "#" + w.id + " is looked up in " + w.f + " line " + w.at + " but nothing in " + app.name + " makes it");
        });
      }
    }
  }

  s.test("the scan found the lookups and the ids", (a) => {
    a.ok(lookups > 20, "only " + lookups + " lookups found; the scan has stopped working");
    a.ok(ids > 20, "only " + ids + " ids found; the scan has stopped working");
  });

  return s;
}
