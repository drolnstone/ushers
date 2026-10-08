/* ==========================================================================
   USHERING APP — the Google Sheet (Apps Script, bound to the spreadsheet)

   The sheet is the historical record. It is not where the department is
   run: the apps are. This script pulls what the server has recorded
   (the Worker's outbox), writes it onto the tabs by HEADER, never by
   column number, and sends the emails the server asks for.

   Same pattern as the Driver App's Code.gs (drolnstone/minibus-check):
   header-driven tabs, a drain from the Worker with a knock and a timer
   underneath, sendMail() with a sender name, secrets in Script Properties.

   Script Properties (Project Settings > Script Properties):
     WORKER_URL          the Worker, e.g. https://ushers-api.example.workers.dev
     SHEET_TOKEN         same value as the Worker secret SHEET_TOKEN
     SENDER_NAME         optional. Name emails show as sent by
     REPLY_TO            optional. Where replies to emails go
     UNLOCK_MAX_MINUTES  optional. Longest a tab may stay unlocked (5)

   Menu: Ushering > Set up the sheet (once), then Check everything.
   ========================================================================== */

var SHEET_VERSION = "v0.3.2";

/* The tabs and the headers each starts with. A missing header is added at
   the end; a header is never renamed or moved by this script, and a column
   a person adds is left alone. */
var TABS = {
  USHERS:         ["USHER_ID", "FULL_NAME", "EMAIL", "PHONE", "ROLES", "ACTIVE", "PIN_SET", "UPDATED_AT"],
  EVENTS:         ["EVENT_ID", "EVENT_TYPE", "TITLE", "DATE", "START_TIME", "SUNDAY", "THANKSGIVING", "STATUS", "NOTES", "UPDATED_AT"],
  APPOINTMENTS:   ["APPOINTMENT_ID", "EVENT_ID", "DATE", "EVENT_TITLE", "USHER_ID", "FULL_NAME", "DUTY", "STATUS", "CHANGED_BY", "CHANGED_AT"],
  REPORTS:        ["REPORT_ID", "SUBMISSION_ID", "EVENT_ID", "DATE", "EVENT_TITLE", "STATUS", "SUBMITTER_ID", "SUBMITTER", "SUBMITTED_AT",
                   "SUBMIT_PIN_CHECK", "COUNTERSIGNER_ID", "COUNTERSIGNER", "COUNTERSIGNED_AT", "COUNTERSIGN_AUTH_ID", "VERIFIED_AT",
                   "MALE", "FEMALE", "CHILDREN", "ATTENDANCE_TOTAL", "OFFERING_TOTAL", "NOTES", "VERSION", "UPDATED_AT"],
  /* One row per report VERSION. CURRENT is "No" on a version an amendment
     replaced: filter CURRENT = Yes before adding anything up. */
  ATTENDANCE:     ["ATTENDANCE_ID", "REPORT_ID", "VERSION", "CURRENT", "EVENT_ID", "DATE", "EVENT_TITLE", "MALE", "FEMALE", "CHILDREN", "TOTAL", "RECORDED_AT"],
  MINISTRATION:   ["MINISTRATION_ID", "REPORT_ID", "VERSION", "CURRENT", "EVENT_ID", "DATE", "EVENT_TITLE", "FIELD", "VALUE", "RECORDED_AT"],
  OFFERING:       ["OFFERING_ID", "REPORT_ID", "VERSION", "CURRENT", "EVENT_ID", "DATE", "LINE", "CATEGORY", "CURRENCY", "DENOMINATION", "QUANTITY", "AMOUNT", "RECORDED_AT"],
  REPORT_VERSIONS:["VERSION_ID", "REPORT_ID", "VERSION", "EVENT_ID", "DATE", "EVENT_TITLE", "STATUS_WHEN_REPLACED", "SUBMITTER", "COUNTERSIGNER",
                   "ATTENDANCE_TOTAL", "OFFERING_TOTAL", "REPLACED_BY", "REPLACED_BY_ID", "REPLACED_AT", "REASON", "NEW_VERSION"],
  AUTHORISATIONS: ["AUTH_ID", "KIND", "SUBJECT_ID", "SUBJECT", "TARGET_TYPE", "TARGET_ID", "REQUESTED_BY", "REQUESTED_BY_NAME", "REASON",
                   "STATUS", "DECIDED_BY", "DECIDED_AT", "NOTE", "CONSUMED_AT", "CREATED_AT"],
  DUES:           ["PAYMENT_ID", "USHER_ID", "FULL_NAME", "YEAR", "PAID_ON", "AMOUNT", "METHOD", "NOTE", "RECORDED_BY", "RECORDED_AT", "STATUS", "VOID_REASON"],
  NOTIFICATIONS:  ["NOTIFICATION_ID", "USHER_ID", "FULL_NAME", "TYPE", "TITLE", "REF_TYPE", "REF_ID", "CREATED_AT"],
  AUDIT:          ["AUDIT_ID", "AT", "ACTOR_ID", "ACTION", "TARGET_TYPE", "TARGET_ID", "BEFORE", "AFTER", "REASON"],
  AUTH_LOG:       ["LOG_ID", "AT", "USHER_ID", "EVENT", "DETAIL"],
  CONFIG:         ["KEY", "VALUE", "UPDATED_BY", "UPDATED_AT"]
};

var LOCK_TAG = "Ushering lock";
var UNLOCKED_KEY = "unlockedTabs";

/* ---- settings ----------------------------------------------------------- */

function prop(k) {
  try { return String(PropertiesService.getScriptProperties().getProperty(k) || "").trim(); }
  catch (err) { return ""; }
}

function unlockMaxMs() {
  var n = Number(prop("UNLOCK_MAX_MINUTES"));
  return (n > 0 && n <= 30 ? n : 5) * 60000;
}

/* ---- emails (as the Driver App: every email goes through here) ---------- */

function sendMail(o) {
  var m = {};
  for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) m[k] = o[k];
  var name = prop("SENDER_NAME"), reply = prop("REPLY_TO");
  if (name && !m.name) m.name = name;
  if (reply && !m.replyTo) m.replyTo = reply;
  return MailApp.sendEmail(m);
}

/* ---- header-driven access (reused from the Driver App) ------------------ */

function headerRow(sh) {
  if (sh.getLastColumn() < 1) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
           .map(function (h) { return String(h == null ? "" : h).trim(); });
}

/* { heading: 1-based column }. The first of a duplicated heading wins. */
function headerMap(sh) {
  var map = {};
  headerRow(sh).forEach(function (h, i) {
    if (h && map[h] === undefined) map[h] = i + 1;
  });
  return map;
}

/* The column, or a refusal naming what is missing. */
function colOf(map, heading, tabName) {
  var c = map[heading];
  if (!c) {
    throw new Error("The " + tabName + " tab has no “" + heading + "” column. " +
                    "Run Ushering > Set up the sheet, or put the heading back exactly as it was.");
  }
  return c;
}

/* Make the tab if it is missing; add any missing heading at the end. */
function ensureTab(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var have = headerMap(sh), last = headerRow(sh).length;
  var add = (headers || []).filter(function (h) { return !have[h]; });
  if (add.length) {
    sh.getRange(1, last + 1, 1, add.length).setValues([add]);
    try { sh.setFrozenRows(1); } catch (err) {}
  }
  return sh;
}

/* A cell never starts a formula from somebody's typing, and text made only
   of digits stays text: Sheets would read 07700900123 as a number and drop
   the leading zero. The server sends every quantity as a number, so a digit
   string is always text (a phone, a year in REF_ID, a CONFIG value). */
function safeCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" && /^\d+$/.test(v)) return "'" + v;
  if (typeof v === "string" && /^[=+\-@]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) return "'" + v;
  return v;
}

/* ---- sheet protection --------------------------------------------------- *
   Every tab is protected so that only the owner (the account this script
   runs as) can edit. A write unlocks only the tabs it needs, writes, and
   protects them again in a finally. The time each tab was unlocked is
   written down, and relockOverdue (every five minutes) protects anything
   left open longer than UNLOCK_MAX_MINUTES, which covers a run that was
   killed before its finally. Protection is a second layer: the server's
   permissions are the first. */

function tagged(ss) {
  var out = {};
  ss.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) {
    if (String(p.getDescription() || "").indexOf(LOCK_TAG) === 0) {
      try { out[p.getRange().getSheet().getName()] = p; } catch (err) {}
    }
  });
  return out;
}

function protectTab(sh) {
  var p = sh.protect().setDescription(LOCK_TAG + ": written by the Ushering App");
  try {
    var me = Session.getEffectiveUser();
    p.addEditor(me);
    p.removeEditors(p.getEditors().filter(function (e) { return e.getEmail() !== me.getEmail(); }));
    if (p.canDomainEdit()) p.setDomainEdit(false);
  } catch (err) {}
  return p;
}

function unlockedJournal() {
  try { return JSON.parse(prop(UNLOCKED_KEY) || "{}"); } catch (err) { return {}; }
}
function saveJournal(j) {
  PropertiesService.getScriptProperties().setProperty(UNLOCKED_KEY, JSON.stringify(j));
}

function withUnlocked(ss, names, fn) {
  var have = tagged(ss), journal = unlockedJournal(), now = Date.now();
  names.forEach(function (n) {
    if (have[n]) have[n].remove();
    journal[n] = now;
  });
  saveJournal(journal);
  try {
    return fn();
  } finally {
    var after = tagged(ss), j = unlockedJournal();
    names.forEach(function (n) {
      var sh = ss.getSheetByName(n);
      if (sh && !after[n]) protectTab(sh);
      delete j[n];
    });
    saveJournal(j);
  }
}

/* Every five minutes: protect anything left open too long, and any tab of
   ours with no protection at all. Returns the tabs it protected. */
function relockOverdue() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var have = tagged(ss), j = unlockedJournal(), now = Date.now(), done = [];
  Object.keys(TABS).forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh || have[n]) return;
    var opened = j[n];
    if (opened && now - opened < unlockMaxMs()) return;
    protectTab(sh);
    delete j[n];
    done.push(n);
  });
  saveJournal(j);
  return done;
}

/* ---- writing rows ------------------------------------------------------- */

/* rows: [{ tab, mode, key, value, row }] for one tab, in order. */
function writeTab(ss, tab, rows) {
  var headers = (TABS[tab] || []).slice();
  rows.forEach(function (r) {
    Object.keys(r.row).forEach(function (h) { if (headers.indexOf(h) === -1) headers.push(h); });
  });
  var sh = ensureTab(ss, tab, headers);
  var map = headerMap(sh), width = headerRow(sh).length;
  var keyIndex = {};
  function indexFor(keyHeader) {
    if (keyIndex[keyHeader]) return keyIndex[keyHeader];
    var col = colOf(map, keyHeader, tab), idx = {};
    var last = sh.getLastRow();
    if (last >= 2) {
      sh.getRange(2, col, last - 1, 1).getValues().forEach(function (v, i) {
        var s = String(v[0]);
        if (s !== "" && idx[s] === undefined) idx[s] = i + 2;
      });
    }
    keyIndex[keyHeader] = idx;
    return idx;
  }
  rows.forEach(function (r) {
    var target = 0;
    if (r.mode === "upsert" && r.key) {
      var idx = indexFor(r.key);
      target = idx[String(r.value)] || 0;
    }
    if (target) {
      /* Only the columns this row carries are written, so a column a person
         added beside them keeps its value. */
      Object.keys(r.row).forEach(function (h) {
        sh.getRange(target, colOf(map, h, tab)).setValue(safeCell(r.row[h]));
      });
    } else {
      var line = [];
      for (var i = 0; i < width; i++) line.push("");
      Object.keys(r.row).forEach(function (h) { line[colOf(map, h, tab) - 1] = safeCell(r.row[h]); });
      var at = sh.getLastRow() + 1;
      sh.getRange(at, 1, 1, width).setValues([line]);
      if (r.mode === "upsert" && r.key) indexFor(r.key)[String(r.value)] = at;
    }
  });
}

/* ---- talking to the Worker --------------------------------------------- */

function workerCall(action, body) {
  var url = prop("WORKER_URL");
  if (!url || !prop("SHEET_TOKEN")) throw new Error("Set WORKER_URL and SHEET_TOKEN in Script Properties.");
  body.sheetToken = prop("SHEET_TOKEN");
  var res = UrlFetchApp.fetch(url.replace(/\/+$/, "") + "/api/" + action, {
    method: "post", contentType: "application/json", payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var j = {};
  try { j = JSON.parse(res.getContentText()); } catch (err) {}
  if (res.getResponseCode() !== 200 || !j.ok) {
    throw new Error("Server said " + res.getResponseCode() + " " + (j.error || ""));
  }
  return j;
}

/* ---- the drain ---------------------------------------------------------- *
   Pull, write, acknowledge, until nothing is waiting or four minutes pass.
   One drain at a time. A row is acknowledged only after it is on the tab
   (or the email has gone), so nothing is marked done that is not. */

function drain() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { busy: true };
  var started = Date.now(), written = 0, emailed = 0;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    for (var round = 0; round < 20 && Date.now() - started < 4 * 60000; round++) {
      var got = workerCall("sheet.pull", { max: 200 });
      if (!got.rows || !got.rows.length) break;
      var byTab = {}, order = [], done = [];
      got.rows.forEach(function (r) {
        if (r.tab === "@email") {
          /* A send that throws (the day's MailApp quota spent, say) is not
             acknowledged, so the server offers it again once the claim
             lapses. A row with no address is acknowledged and not counted. */
          try {
            if (r.row && r.row.to) {
              sendMail({ to: r.row.to, subject: r.row.subject, body: r.row.body });
              emailed++;
            }
            done.push(r.id);
          } catch (err) { Logger.log("email failed: " + err); }
          return;
        }
        if (!byTab[r.tab]) { byTab[r.tab] = []; order.push(r.tab); }
        byTab[r.tab].push(r);
      });
      withUnlocked(ss, order, function () {
        order.forEach(function (tab) {
          writeTab(ss, tab, byTab[tab]);
          byTab[tab].forEach(function (r) { done.push(r.id); written++; });
        });
      });
      workerCall("sheet.ack", { claim: got.claim, ids: done, sheetVersion: SHEET_VERSION });
      if (!got.more) break;
    }
  } finally {
    lock.releaseLock();
  }
  return { written: written, emailed: emailed };
}

/* The Worker knocks here after a write, so the sheet updates in seconds. */
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (err) {}
  var out = { ok: false };
  if (!prop("SHEET_TOKEN") || body.sheetToken !== prop("SHEET_TOKEN")) {
    out.error = "forbidden";
  } else if (body.action === "drain") {
    try { out = { ok: true, result: drain() }; } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, sheet: SHEET_VERSION }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---- set up and checks -------------------------------------------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Ushering")
    .addItem("Set up the sheet", "setUp")
    .addItem("Bring the record up to date now", "drainFromMenu")
    .addItem("Check everything", "checkEverything")
    .addToUi();
}

/* Makes every tab, protects every tab, and installs the two timers. */
/* The GUIDE tab: what each tab holds, for whoever opens the sheet. The
   app writes every other tab; typing in them changes nothing in the app. */
var GUIDE = [
  ["TAB", "WHAT IT HOLDS", "ONE ROW IS", "GOOD TO KNOW"],
  ["GUIDE", "This page.", "", "Rebuilt by Ushering -> Set up the sheet."],
  ["USHERS", "Everyone in the department and their roles.", "One person (USHER_ID U001, U002 ...)", "Add people and roles in the Admin App, not here. PINs are never stored here."],
  ["EVENTS", "Sunday services and other events.", "One event (S20261004-1 = First Service on 4 Oct 2026; E0001 = other events)", "Sundays appear by themselves; other events are added in Admin -> Events."],
  ["APPOINTMENTS", "Who is on duty, past and present.", "One person on one duty at one event", "STATUS removed keeps changes on the record."],
  ["REPORTS", "One report per event, with its status and both signatures.", "One report (R0001 ...), its current version", "Draft -> Submitted -> Pending Countersignature -> Verified."],
  ["ATTENDANCE", "Male, female, children and total for each report.", "One version of one report", "Add up only rows with CURRENT = Yes; No means an amendment replaced it."],
  ["MINISTRATION", "Minister, sermon, Bible text, first-timers and the rest.", "One line of one version of one report", "Lines are set in Admin -> Settings (ministration_fields). Use CURRENT = Yes."],
  ["OFFERING", "Every note and coin line of every offering.", "One denomination line of one version", "AMOUNT is in pounds. Use CURRENT = Yes."],
  ["REPORT_VERSIONS", "Versions an amendment replaced, with who, when and why.", "One replaced version", "Never edited; amendments only add rows."],
  ["AUTHORISATIONS", "Requests and approvals: countersigning, submitting, amending, duty changes.", "One request (A0001 ...)", "An approval is for one transaction and is used once (CONSUMED)."],
  ["DUES", "Dues payments recorded by the Treasurer.", "One payment (P00001 ...)", "A mistake is VOIDED, never deleted."],
  ["NOTIFICATIONS", "What the app told each person.", "One notification", ""],
  ["AUDIT", "Every change, by whom, before and after.", "One change", ""],
  ["AUTH_LOG", "Sign-ins, sign-outs, wrong PINs, PIN changes.", "One event", ""],
  ["CONFIG", "Rule changes made in Admin -> Settings.", "One rule", "The rule itself lives on the server; this is its history."],
  ["", "", "", ""],
  ["Test rows", "Names beginning \"Test \" come from Admin -> Settings -> Testing.", "", "They stay on the record after the test people are switched off."]
];

function writeGuide(ss) {
  var sh = ss.getSheetByName("GUIDE") || ss.insertSheet("GUIDE", 0);
  try { sh.clear(); } catch (err) {}
  sh.getRange(1, 1, GUIDE.length, GUIDE[0].length).setValues(GUIDE);
  try { sh.setFrozenRows(1); sh.getRange(1, 1, 1, GUIDE[0].length).setFontWeight("bold"); } catch (err) {}
  protectTab(sh);
}

function setUpSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  writeGuide(ss);
  Object.keys(TABS).forEach(function (n) { protectTab(ensureTab(ss, n, TABS[n])); });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction ? t.getHandlerFunction() : t.fn;
    if (f === "drain" || f === "relockOverdue") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("drain").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("relockOverdue").timeBased().everyMinutes(5).create();
  saveJournal({});
}

function setUp() {
  setUpSheet();
  SpreadsheetApp.getUi().alert("✓ The tabs are made and protected, and the timers are on.\n\nNext: Ushering > Check everything.");
}

function drainFromMenu() {
  var r = drain();
  SpreadsheetApp.getUi().alert(r.busy ? "Already bringing the record up to date." :
    "✓ " + r.written + " rows written, " + r.emailed + " emails sent.");
}

/* ✓ and ✗ lines, as the Driver App's health check. */
/* CHECK EVERYTHING, in three blocks: what needs attention today, what is
   still to do, and what is fine. Only the first block counts as a fault.
   The people lines come from the server, which builds them from the same
   queries it sends by, so the report cannot certify the silence it exists
   to catch. */
function healthLines() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var bad = [], todo = [], fine = [];
  (prop("WORKER_URL") ? fine : bad).push("WORKER_URL is set");
  (prop("SHEET_TOKEN") ? fine : bad).push("SHEET_TOKEN is set");
  var have = tagged(ss), open = [];
  Object.keys(TABS).forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh) { bad.push("The " + n + " tab is missing"); return; }
    if (!have[n]) open.push(n);
    var map = headerMap(sh);
    var missing = TABS[n].filter(function (h) { return !map[h]; });
    if (missing.length) bad.push(n + " is missing " + missing.join(", "));
  });
  if (open.length) bad.push("Not protected: " + open.join(", "));
  else fine.push("Every tab is protected");
  if (prop("WORKER_URL") && prop("SHEET_TOKEN")) {
    try {
      var res = UrlFetchApp.fetch(prop("WORKER_URL").replace(/\/+$/, "") + "/api/health",
        { method: "post", contentType: "application/json", muteHttpExceptions: true,
          payload: JSON.stringify({ sheetToken: prop("SHEET_TOKEN") }) });
      var h = JSON.parse(res.getContentText());
      fine.push("The server answers (" + h.server + ")");
      (h.checks && h.checks.pinPepper ? fine : bad).push("The server has PIN_PEPPER");
      (h.checks && h.checks.sheetToken ? fine : bad).push("The server has SHEET_TOKEN");
      (h.checks && h.checks.sheetKnock ? fine : bad).push("The server has SHEET_WEBAPP_URL, so it knocks after a save");
      var drained = h.checks ? Number(h.checks.sheetLastDrained) || 0 : 0;
      if (drained) fine.push("The sheet last collected " + agoWords(drained));
      else bad.push("The sheet has never collected from the server");
      /* The Cron Trigger runs every five minutes, so a quarter of an hour
         without a tick means it has stopped. */
      var tick = h.checks ? Number(h.checks.clockLastTick) || 0 : 0;
      if (!tick) bad.push("The server's clock has never run. Add the Cron Trigger to the Worker in Cloudflare");
      else if (Date.now() - tick > 15 * 60000) bad.push("The server's clock last ran " + agoWords(tick) + ". Check the Worker's Cron Trigger");
      else fine.push("The server's clock last ran " + agoWords(tick));
      fine.push("Waiting to come to the sheet: " + (h.checks ? h.checks.waitingForSheet : "?"));
      peopleLines(h.people, bad, todo, fine);
    } catch (err) { bad.push("The server did not answer"); }
  }
  var out = [];
  if (bad.length) { out.push("NEEDS ATTENTION"); bad.forEach(function (l) { out.push("  ✗ " + l); }); }
  if (todo.length) { out.push(bad.length ? "" : null); out.push("STILL TO DO"); todo.forEach(function (l) { out.push("  • " + l); }); }
  if (fine.length) { out.push(""); out.push("FINE"); fine.forEach(function (l) { out.push("  ✓ " + l); }); }
  if (!bad.length) out.unshift("Nothing needs attention.", "");
  return out.filter(function (l) { return l !== null; });
}

/* The people the server named. Anyone nothing can reach, a short Sunday or
   an overdue report needs attention now; alerts off and a default PIN are
   for whenever there is time. */
function peopleLines(people, bad, todo, fine) {
  if (!people) return;
  var names = function (list) { return (list || []).join(", "); };
  if ((people.unreachable || []).length) bad.push("Nothing can reach: " + names(people.unreachable) + " (no phone alerts and no email)");
  (people.sundayGaps || []).forEach(function (g) { bad.push("Sunday " + people.sunday + " is short — " + g); });
  (people.reportsOverdue || []).forEach(function (r) { bad.push("Report still missing: " + r); });
  if ((people.alertsOff || []).length) todo.push("No alerts yet for: " + names(people.alertsOff));
  if ((people.defaultPin || []).length) todo.push("Still on the default PIN: " + names(people.defaultPin));
  fine.push("Alerts on: " + people.alertsOn + " of " + people.ushers);
  if (!(people.sundayGaps || []).length) fine.push("Sunday " + people.sunday + " is fully rostered");
  if (!(people.reportsOverdue || []).length) fine.push("No reports outstanding");
}

/* "just now", "12 minutes ago", "3 hours ago", "2 days ago". */
function agoWords(ms) {
  var m = Math.round((Date.now() - Number(ms)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " minute" + (m === 1 ? "" : "s") + " ago";
  var h = Math.round(m / 60);
  if (h < 24) return h + " hour" + (h === 1 ? "" : "s") + " ago";
  var d = Math.round(h / 24);
  return d + " day" + (d === 1 ? "" : "s") + " ago";
}

function checkEverything() {
  SpreadsheetApp.getUi().alert("Ushering " + SHEET_VERSION + "\n\n" + healthLines().join("\n"));
}
