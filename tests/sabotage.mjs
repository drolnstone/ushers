#!/usr/bin/env node
/* SABOTAGE — a test that passes for the wrong reason is worse than no test,
   so each past fix is taken back out of a scratch copy of the repo and its
   suite is expected to go red. Anything that stays green is named.

     node tests/sabotage.mjs            every entry
     node tests/sabotage.mjs quiet      only entries whose name matches

   Not part of run-tests.mjs: it runs the whole suite once per entry, which
   takes a minute or two. */

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));

/* Each entry undoes ONE fix. `find` must appear exactly once in the file,
   so a rewrite that moves the code makes this file fail loudly rather than
   quietly testing nothing. */
const SABOTAGE = [
  { name: "off-duty notice", suite: "85-off-duty", file: "server/worker.js",
    find: '"You are no longer on duty: "', replace: '"Rota changed: "' },
  { name: "quiet hours", suite: "86-quiet-hours", file: "server/worker.js",
    find: "if (quietNow(cfg, now)) return 0;", replace: "if (false) return 0;" },
  { name: "the sign-in list kept on the phone", suite: "04-sign-in", file: "shared/core.js",
    find: "function peopleCached(app)", replace: "function peopleCachedUnused(app)" },
  { name: "plain words", suite: "05-words", file: "index.html",
    find: 'h("b", {}, "Saved on this phone. Not sent yet.")',
    replace: 'h("b", {}, "Saved on this phone. It will be sent automatically.")' },
  { name: "people in Check everything", suite: "07-health-people", file: "server/worker.js",
    find: "unreachable: (await peopleUnreachable(env)).map(name),", replace: "unreachable: []," },
  { name: "who has not installed it", suite: "09-install", file: "server/worker.js",
    find: "notInstalled: (await peopleNotInstalled(env)).map(name),", replace: "notInstalled: []," },
  { name: "a link in every email", suite: "08-email-links", file: "server/worker.js",
    find: 'body: text(body, 1000) + (link ? "\\n\\nOpen: " + link : "")', replace: "body: text(body, 1000)" },
  { name: "the install note", suite: "09-install", file: "server/worker.js",
    find: "if (b.installed && !me.usher.installed_at) {", replace: "if (false) {" },
  { name: "what went out", suite: "10-what-went-out", file: "server/worker.js",
    find: 'need(me, "admin.app");\n  const days = Math.min(90', replace: 'need(me, "admin.app");\n  const days = Math.min(0' },
  { name: "the diary entry on a duty email", suite: "11-duty-ics", file: "server/worker.js",
    find: "if (ics) row.ics = ics;", replace: "" },
  { name: "\"you are still on duty\" only when they are", suite: "12-cant-make-it", file: "server/worker.js",
    find: '(still && still.status === "active" ? " You are still on duty." : "")',
    replace: '" You are still on duty."' },
  { name: "the past is left alone by a changed rule", suite: "13-repeating", file: "server/worker.js",
    find: '"SELECT * FROM events WHERE rule_id=? AND date>=?").bind(String(rule.id), today)',
    replace: '"SELECT * FROM events WHERE rule_id=?").bind(String(rule.id))' },
  { name: "a paused reminder pattern", suite: "13b-reminder-patterns", file: "server/worker.js",
    find: "if (!pat || pat.paused) continue;", replace: "if (!pat) continue;" },
  { name: "a reminder pattern aimed at one role", suite: "13b-reminder-patterns", file: "server/worker.js",
    find: "if (pat.role && (await rolesOf(env, x.id)).indexOf(pat.role) === -1) continue;", replace: "" },
  { name: "who a message is for", suite: "13c-messages", file: "server/worker.js",
    find: 'if (audience === "counters") return await onSunday("SUN_SECOND");', replace: "" },
  { name: "the right alert at the right hour", suite: "90-diary", file: "server/worker.js",
    find: "reminder_hour: 18,", replace: "reminder_hour: 23," },
  { name: "the month's summary", suite: "15-summary", file: "server/worker.js",
    find: "if (today !== lastSundayOfMonth(today)) return 0;", replace: "" },
  { name: "in charge lends no permission", suite: "16-in-charge", file: "server/worker.js",
    find: 'need(me, "rota.manage");\n  const today = londonKey(new Date());\n  const before = await inChargeNow(env, cfg);',
    replace: '  const today = londonKey(new Date());\n  const before = await inChargeNow(env, cfg);' },
  { name: "the upgrade of an old database", suite: "04-old-database", file: "server/worker.js",
    find: '"ALTER TABLE notifications ADD COLUMN ics_json TEXT",', replace: "" }
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const work = SABOTAGE.filter((x) => !only.length || only.some((o) => (x.name + " " + x.suite).indexOf(o) !== -1));

/* A scratch copy, so nothing is done to the repo itself. */
function copyRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ushers-sabotage-"));
  cpSync(ROOT, dir, { recursive: true, filter: (src) => !/\/(node_modules|\.git|tests\/\.build)(\/|$)/.test(src) });
  return dir;
}

let green = [], ok = 0;
for (const x of work) {
  const dir = copyRepo();
  try {
    const path = join(dir, x.file);
    const src = readFileSync(path, "utf8");
    const count = src.split(x.find).length - 1;
    if (count !== 1) {
      green.push(x.name + " — the code it undoes is " + (count ? "in " + count + " places" : "no longer there") +
                 ", so this entry needs rewriting");
      process.stdout.write("? " + x.name + " (" + x.file + ")\n");
      continue;
    }
    writeFileSync(path, src.replace(x.find, x.replace));
    let failed = false, out = "";
    try {
      out = execFileSync(process.execPath, [join(dir, "tests/run-tests.mjs"), x.suite], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      failed = true; out = String((e.stdout || "") + (e.stderr || ""));
    }
    if (!failed && /NOT READY/.test(out)) failed = true;
    if (failed) { ok++; process.stdout.write("✓ " + x.name + " — " + x.suite + " goes red\n"); }
    else {
      green.push(x.name + " — " + x.suite + " stayed green with the fix taken out");
      process.stdout.write("✗ " + x.name + " — " + x.suite + " STAYED GREEN\n");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.stdout.write("\n" + ok + " of " + work.length + " sabotaged fixes were caught\n");
if (green.length) {
  process.stdout.write("\nNot caught:\n" + green.map((g) => "  " + g).join("\n") + "\n\nNOT READY\n");
  process.exit(1);
}
process.stdout.write("\nREADY\n");
