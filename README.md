# Ushers

The Church Ushering Department app for RCCG Dominion Assembly: rota, duties,
service reports with countersignature, approvals, dues, notifications and a
coordinator dashboard. Built on the same pattern as the Transport/Driver App
(`drolnstone/minibus-check`); see [docs/DRIVER-APP-REUSE.md](docs/DRIVER-APP-REUSE.md)
for what was reused, adapted, replaced and added.

## The parts

| Part | Where | What it is |
|---|---|---|
| Ushers App | `index.html`, `sw.js`, `manifest.webmanifest` | For every usher. Home answers "What am I doing?" |
| Admin App | `admin/` | Head Usher, Assistant Head Usher and System Administrator only; its sign-in lists only them. Has its own Notifications tab. No service worker of its own |
| Shared page code | `shared/core.js`, `shared/reports.js`, `shared/style.css`, `config.js` | Session, server calls, offline queue, drafts, phone alerts, report parts, look |
| PDFs | `shared/pdf.js`, `shared/vendor/jspdf.umd.min.js` (MIT) | Service report and period summary PDFs, made on the phone. Loaded only when a PDF is made |
| Icons | `apple-touch-icon.png`, `icon-*.png` (and the same in `admin/`) | Home-screen icons. Remade by `node tools/make-icons.mjs` from `shared/logo.png` |
| Server | `server/worker.js`, `server/schema.sql` | Cloudflare Worker + D1. The authority on sessions, PINs and permissions |
| Historical record | `Code.gs` | Apps Script bound to the Google Sheet. Pulls from the server and writes the tabs |
| Tests | `tests/` | `node tests/run-tests.mjs` (ends READY or NOT READY) |

## Who owns what

The **server** owns the live data and decides every permission. Hiding a
button is never the lock: every action is checked in `server/worker.js`.

The **Google Sheet** is the historical record, not where the department is
run. Every material change adds a row to the server's `outbox`; Apps Script
drains it onto the tabs, by header (`USHER_ID`, `REPORT_ID`, …), never by
column number. Each row has a key, so a drain that is cut off and repeated
writes the same row once. The server knocks on the sheet after each write
and a five-minute timer drains anything left.

## The journey

Roster → Duty → Report → Signature → Countersignature (First and Second
Service) → Authorisation if required → Google Sheets record → Head Usher
notified → Coordinator dashboard.

- **Rota.** A Sunday is two events, First Service (ushering, any number) and
  Second Service (offering counting, exactly `second_service_counters`, 2).
  Both services have the same whole report.
  Being on both is not a conflict. The first Sunday of each month is
  Thanksgiving Sunday.
- **Report.** One per event, one submitter, and everything about the
  service: attendance (male, female, children) with the total worked out;
  the ministration record (minister, sermon title, Bible text, praise and
  worship leader, special ministration, first-timers, new converts: the list
  is `ministration_fields` in configuration); and offering as denomination
  lines (category, currency, denomination, quantity) with category totals
  and a grand total worked out on the server.
- **Countersigning** is the second person confirming the report is true; it
  is not an approval. Only Sunday First Service and Second Service are
  countersigned. Every other event's report is filed as soon as it is
  signed. A report of another event that was still waiting for a
  countersignature when this rule came in is filed once, by the server, on
  the record, and the Head Usher is told.
- **Status.** First and Second Service: Draft → Submitted → Pending
  Countersignature → Verified. Any other event: Draft → Submitted →
  Verified. Every change is kept in `report_history` and on the AUDIT tab.
- **The Head Usher is told of every report.** The Head Usher and Assistant
  Head Usher (`report_notify_roles`) get a "Report filed" notification as
  soon as a report is complete: when it is signed, or for First and Second
  Service when it is countersigned. Amendments are notified too. It arrives
  in both apps' Notifications tab, as a phone alert and by email, and is
  logged on the NOTIFICATIONS tab. Whoever filed it is not told about their
  own report.
- **Countersigner.** Anyone active can be chosen. The server then checks
  authority: the roles in `countersign_roles`, or (with
  `countersign_rostered`) anyone on duty at that event. Without it, a
  transaction-specific authorisation is requested and the Head Usher and
  Assistant Head Usher are told at once, in the app, as a phone alert and by
  email. When one of them decides, the submitter is told, the chosen person
  is asked to countersign (if approved), and the request stops showing as new
  for the other. An approval lets that person countersign that report once;
  their roles never change.
- **One authorisation engine** also covers submitting for an event you were
  not rostered on, amending a submitted report, and duty takeovers (B did
  A's duty: the duty moves to B, A's stays on the record as removed).
- **Approvers need no request.** Anyone holding `exceptions.approve` (Head
  Usher and Assistant Head Usher) who does something that
  would need approval has it approved at once, by themselves, on the record
  (`AUTHORISATIONS`, `AUDIT`). Deciding someone else's request still needs
  the approver's PIN. A First or Second Service report is still
  countersigned by somebody else, whoever submits or amends it.
- **Amendments.** A submitted report is never overwritten. Amending needs a
  reason, the signature and the PIN; the version it replaces is kept whole
  (`report_versions`, the `REPORT_VERSIONS` tab), the report gets the next
  version number and, for First and Second Service, goes back to Pending
  Countersignature (any other event's is filed at once). An usher needs
  an approved request first; an approver does not. On the sheet,
  ATTENDANCE, MINISTRATION and OFFERING have a row per version with
  `CURRENT` = Yes or No: filter on Yes before adding up. A countersignature
  made for an older version is refused.
- **Phone alerts.** Notifications → Turn on alerts (either app). Every new
  notification then also wakes the phone. As in the Driver App, the push
  carries nothing: the phone asks the server what it is for. On iPhone it
  works once Ushers is added to the Home Screen and opened from there.
- **The bell.** Both apps have a bell in the banner once signed in, as the
  Driver App's coordinator app. Hollow while alerts are off on this phone:
  a tap turns them on. Filled once they are on: a tap opens Notifications.
  It carries the unread count (also on the Notifications tab and, where the
  phone allows, on the home-screen icon) and keeps listening while the app
  is open: it asks `notifications.count` every `refreshSeconds`, again when
  the app comes back into view, and at once when a phone alert lands.
  Anything new is shown in a strip at the foot of the screen. Notifications
  → Send a test alert (`push.test`) proves the chain end to end.
- **Nobody left unalerted.** Once signed in on a phone where alerts are off,
  the person is asked straight out to turn them on (again three days after
  "Not now"; on an iPhone in Safari, told to add the app to the Home Screen
  first). Anyone with alerts on no phone is emailed whatever is still unread
  after `unalerted_email_minutes` (60; 0 turns it off), one email listing
  them, at most two days back and once each. Admin → Ushers marks them
  "Alerts off".
- **PDFs.** Any report has a PDF button (both apps). Admin → Reports makes a
  summary PDF for any period of up to 400 days.
- **Signing** is typing your full name, ticking to confirm, and your PIN.
- **Offline.** Reports are saved on the phone as they are typed. A report
  signed with no signal is kept as "Saved on device — waiting for
  connection" and sent automatically. The PIN is then checked on the phone
  against a salted hash kept from the last sign-in, and the record says so
  (`SUBMIT_PIN_CHECK = device`). `offline_signing` turns this off.
  The Submission ID is made on the phone, so a retry is filed once.

## Roles and permissions

Roles are additive: Usher, Head Usher, Assistant Head Usher, Treasurer,
System Administrator. Permissions are the union of a person's roles
(`ROLE_PERMISSIONS` in `server/worker.js`, overridable by `role_permissions`).

- Head Usher and Assistant Head Usher: rota, events, reports, approvals,
  dashboard (operational offering totals), messages, ushers.

Roles are given on Admin → Ushers: tick them when adding someone, or tap
**Edit details and roles** under a name (it opens at the top of the screen).
The System Administrator can give any role. The Head Usher and Assistant Head
Usher can add people and give or take away Usher, Head Usher and Assistant
Head Usher; Treasurer and System Administrator need a System Administrator
(`ROLES_GRANTABLE`, checked on the server). Anyone who is Treasurer or System
Administrator can be changed, have their PIN reset or be removed only by a
System Administrator, so no other admin can reset a System Administrator's
PIN and sign in as them. Settings (`config.manage`) and Audit are the
System Administrator's alone.

**Removing someone** is on the same Edit screen. They can no longer sign in
(and are signed out at once), every role but Usher is taken away, phone
alerts stop and they come off every duty from today on. Nothing they did is
deleted: reports, dues and the record keep their name, and they are listed
under Removed. Ticking Active brings them back as an Usher. Removing a
Treasurer or System Administrator needs a System Administrator; nobody can
remove themselves. Deleting a row on the sheet removes nobody: the server
owns the list and the sheet is only its record.
- Treasurer: dues, payments, balances, reminders, on a Treasurer tab inside the
  Ushers App; no Admin App. **Head Usher has no dues
  permission**; someone with both roles gets both.
- System Administrator: the builder and tester. Ushers, roles (including
  Treasurer and System Administrator), settings, audit. Not an approver and
  sees no reports or dues; to try a role, sign in as a test person
  (Admin → Settings → Testing adds six, across every role, and walks a
  sample week; "Switch off test people" retires them for go-live).

## Sign-in, sessions and app switching

Pick your name (or type it, with `public_name_list` off) and enter your PIN.
PINs are hashed with PBKDF2-SHA-256, a random salt per person and a server
secret (`PIN_PEPPER`); the PIN is never stored. A PIN is always exactly four digits
(`pin_min_length` = `pin_max_length` = 4). A new usher starts on a default PIN, and every
reset drops back to it; how it is made is told to ushers at onboarding and is
never shown in either app. At the next sign-in they are asked once, "Do you
wish to keep your default PIN?": Yes keeps it, No leads them to a new PIN
(they can still change it later on the PIN tab). Someone with no default PIN gets a
starting PIN typed by whoever adds or resets them. Three wrong tries pause that
name for five minutes. A sign-in makes a session token, stored on the server
only as a hash. Both apps live on one site, so they share the token: **Open
Admin App** and **Open Ushers App** need no second sign-in. The Admin App
also has its own sign-in at `/admin/`, so it can be opened or added to the
home screen on its own; signing in on either app signs you in on both. The server
re-reads the person's roles on every call, so removing a role takes effect at
once.

## The sheet's protection

Every tab is protected so only the owner can edit. A drain unlocks only the
tabs it writes, writes, and protects them again in a `finally`. The time each
tab was opened is written down; `relockOverdue` (every five minutes)
protects anything left open longer than `UNLOCK_MAX_MINUTES` (5).
Protection is a second layer; the server's permissions are the first.

## Configuration

Rules live in the server's `config` table, with defaults in
`DEFAULT_CONFIG` (`server/worker.js`), and a System Administrator changes
them on the Admin App's Settings screen. They include dues (£5 a month, £60 a
year), the number of Second Service counters, the Thanksgiving rule, event
types (and whether each has attendance, ministration, offering and a
countersignature), the ministration lines,
offering categories, currencies and denominations, countersigning roles,
who is told of every filed report, session and PIN limits, reminder
timings, and which notifications are emailed. Every change is audited and written to the CONFIG tab.

## Secrets

This repository is public. No secret is in any file:

| Where | Key |
|---|---|
| Worker variables (Secrets) | `PIN_PEPPER`, `SHEET_TOKEN`, `BOOTSTRAP_TOKEN` (only until the first administrator exists) |
| Worker variables | `SHEET_WEBAPP_URL`, `ALLOWED_ORIGINS`, `PIN_ITERATIONS`, `PUSH_CONTACT` (all optional) |
| D1 `settings` table | the phone-alert key pair, made by the Worker on first use (never in code) |
| Apps Script Script Properties | `WORKER_URL`, `SHEET_TOKEN`, `SENDER_NAME`, `REPLY_TO`, `UNLOCK_MAX_MINUTES` |

`config.js` holds only the server's address. A test fails if a shipped file
holds anything that looks like a secret.

## Time

Every date, Sunday, deadline, reminder and audit stamp is Europe/London,
using the Driver App's London time helpers, never the phone's clock zone.

## Tests

    node tests/run-tests.mjs              everything
    node tests/run-tests.mjs journey      one suite

The Worker runs against a real SQLite database through a D1 shim, and Code.gs
against a fake of Apps Script (both from the Driver App). The journey suite
is the 27-step acceptance test. `tests/browser/journey.mjs` drives both apps
in Chromium at phone width and photographs each step; run it by hand.

## Left for later (designed for, not built)

The full audit viewer, rolling rota engine, analytics, advanced dues
carry-forward, notification preferences.

See [DEPLOY.md](DEPLOY.md) to set it up.
