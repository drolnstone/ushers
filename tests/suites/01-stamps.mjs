/* Brief 03, part 1: the version stamps agree. A page cached under last
   release's name is served to phones from their cache for ever, so the
   app version and the cache name move together, and anything that names
   versions for a deploy names the ones in the code. */

import { Suite } from "../lib/t.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function stamps(root) {
  const read = (f) => readFileSync(join(root, f), "utf8");
  const one = (f, re, what) => {
    const m = re.exec(read(f));
    if (!m) throw new Error(f + " has no " + what);
    return m[1];
  };
  return {
    app: one("shared/core.js", /APP_VERSION\s*=\s*"([^"]+)"/, "APP_VERSION"),
    cache: one("sw.js", /CACHE\s*=\s*"ushers-([^"]+)"/, "CACHE named ushers-<version>"),
    server: one("server/worker.js", /SERVER_VERSION\s*=\s*"([^"]+)"/, "SERVER_VERSION"),
    sheet: one("Code.gs", /SHEET_VERSION\s*=\s*"([^"]+)"/, "SHEET_VERSION")
  };
}

export default async function ({ root }) {
  const s = new Suite("the version stamps agree");
  const v = stamps(root);

  s.test("the app version and the cache name are the same", (a) => {
    a.eq(v.cache, v.app, "sw.js CACHE is ushers-" + v.cache + " while shared/core.js says " + v.app);
  });

  s.test("each version is a shape the code and the deploy notes can both read", (a) => {
    a.ok(/^v\d+\.\d+\.\d+$/.test(v.app), "app " + v.app);
    a.ok(/^w\d+\.\d+\.\d+$/.test(v.server), "server " + v.server);
    a.ok(/^v\d+\.\d+\.\d+$/.test(v.sheet), "sheet " + v.sheet);
  });

  s.test("the setup guide names the versions that are in the code", (a) => {
    const g = readFileSync(join(root, "DEPLOY.md"), "utf8");
    const m = /app (v\d+\.\d+\.\d+) · server (w\d+\.\d+\.\d+) · sheet (v\d+\.\d+\.\d+)/.exec(g);
    a.ok(m, "DEPLOY.md has no 'app … · server … · sheet …' line");
    a.eq(m[1], v.app, "DEPLOY.md app version");
    a.eq(m[2], v.server, "DEPLOY.md server version");
    a.eq(m[3], v.sheet, "DEPLOY.md sheet version");
  });

  s.test("the latest deploy note names the versions that are in the code", (a) => {
    const f = "DEPLOY-LATEST.txt";
    if (!existsSync(join(root, f))) return;
    const t = readFileSync(join(root, f), "utf8");
    const m = /app (v\d+\.\d+\.\d+) · server (w\d+\.\d+\.\d+) · sheet (v\d+\.\d+\.\d+)/.exec(t);
    a.ok(m, f + " has no 'app … · server … · sheet …' line");
    a.eq(m[1], v.app, f + " app version");
    a.eq(m[2], v.server, f + " server version");
    a.eq(m[3], v.sheet, f + " sheet version");
  });

  return s;
}
