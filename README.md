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
| Admin App | `admin/` | Head Usher, Assistant Head Usher, System Administrator, and the Treasurer's screen. No service worker |
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

Roster → Duty → Report → Signature → Countersignature → Authorisation if
required → Google Sheets record → Coordinator dashboard.

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
- **Status.** Draft → Submitted → Pending Countersignature → Verified, or
  Draft → Submitted → Verified when the event type needs no countersignature.
  Every change is kept in `report_history` and on the AUDIT tab.
- **Countersigner.** Anyone active can be chosen. The server then checks
  authority: the roles in `countersign_roles`, or (with
  `countersign_rostered`) anyone on duty at that event. Without it, a
  transaction-specific authorisation is requested and approvers are told. An
  approval lets that person countersign that report once; their roles never
  change.
- **One authorisation engine** also covers submitting for an event you were
  not rostered on, amending a submitted report, and duty takeovers (B did
  A's duty: the duty moves to B, A's stays on the record as removed).
- **Approvers need no request.** Anyone holding `exceptions.approve` (Head
  Usher and Assistant Head Usher) who does something that
  would need approval has it approved at once, by themselves, on the record
  (`AUTHORISATIONS`, `AUDIT`). Deciding someone else's request still needs
  the approver's PIN. **Every report is still countersigned by somebody
  else**, whoever submits or amends it.
- **Amendments.** A submitted report is never overwritten. Amending needs a
  reason, the signature and the PIN; the version it replaces is kept whole
  (`report_versions`, the `REPORT_VERSIONS` tab), the report gets the next
  version number and goes back to Pending Countersignature. An usher needs
  an approved request first; an approver does not. On the sheet,
  ATTENDANCE, MINISTRATION and OFFERING have a row per version with
  `CURRENT` = Yes or No: filter on Yes before adding up. A countersignature
  made for an older version is refused.
- **Phone alerts.** Notifications → Turn on alerts on this phone. Every new
  notification then also wakes the phone. As in the Driver App, the push
  carries nothing: the phone asks the server what it is for. On iPhone it
  works once Ushers is added to the Home Screen and opened from there.
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
- Treasurer: dues, payments, balances, reminders. **Head Usher has no dues
  permission**; someone with both roles gets both.
- System Administrator: the builder and tester. Ushers, roles (including
  Treasurer and System Administrator), settings, audit. Not an approver and
  sees no reports or dues; to try a role, sign in as a test person
  (Admin → Settings → Testing adds six, across every role, and walks a
  sample week; "Switch off test people" retires them for go-live).

## Sign-in, sessions and app switching

Pick your name (or type it, with `public_name_list` off) and enter your PIN.
PINs are hashed with PBKDF2-SHA-256, a random salt per person and a server
secret (`PIN_PEPPER`); the PIN is never stored. Three wrong tries pause that
name for five minutes. A sign-in makes a session token, stored on the server
only as a hash. Both apps live on one site, so they share the token: **Open
Admin App** and **Open Ushers App** need no second sign-in, and the server
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
session and PIN limits, reminder timings, and which notifications are
emailed. Every change is audited and written to the CONFIG tab.

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
