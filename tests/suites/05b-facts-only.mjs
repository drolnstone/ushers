/* FACTS ONLY. Alerts, emails and refusals say what happened, not what to
   do about it: one wrong piece of advice makes a failure worse (Asim's
   rule in the Driver App, 11 October 2026, taken for Ushers on 17
   October). Prompts that ask for an answer ("Choose who will
   countersign.") and the install steps stay. Each phrase below was once
   sent and was cut; none may come back. "The coordinator" is the Driver
   App's word: in Ushers the Head Usher approves. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";

const GONE = [
  "Ask the coordinator", "ask the coordinator", "the coordinator", "The coordinator",
  "Choose somebody else or ask", "Open it again", "Open the app for the latest",
  "Turn them on first", "Turn them on again", "Try again in a minute", "Try again when you have signal",
  "Please sign in again", "at the same moment. Try again", "Too many tries. Wait",
  "Run Ushering > Set up the sheet, or", "Add the Cron Trigger", "Check the Worker's Cron Trigger",
  "Set WORKER_URL and SHEET_TOKEN"
];

const FILES = ["server/worker.js", "Code.gs", "sw.js", "shared/core.js", "index.html", "admin/index.html"];

export default function ({ root }) {
  const s = new Suite("alerts, emails and refusals carry facts only");
  for (const f of FILES) {
    s.test(f + " says none of the cut advice", (a) => {
      const src = readFileSync(join(root, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");
      for (const g of GONE) a.hasnt(src, g, f + " still says \"" + g + "\"");
    });
  }
  return s;
}
