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
| Admin App | `admin/` | Head Usher, Assistant Head Usher and System Administrator only; its sign-in lists only them. Has its own Notifications tab. Opens with no signal through the Ushers App's `sw.js` |
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
  Thanksgiving Sunday. Someone taken off a duty still to come is told
  ("You are no longer on duty"), and everyone on duty is told when an
  event is cancelled ("Cancelled: …") or brought back ("Back on: …").
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
- **What went out.** The Admin App's Notifications tab has "What went out":
  one line per batch of phone alerts or emails from the last fortnight, with
  who sent it and how many it reached, a batch that reached nobody included.
  After a Message the sender also gets one notification, "Sent to 31: 24
  phones, 7 emails, 0 unreachable". Reminder runs list a line and notify
  nobody. Admins only, and never a money figure.
- **Check everything names people.** The sheet's Ushering → Check
  everything answers in three blocks. *Needs attention*: anything broken
  today, anyone nothing can reach (no phone alerts and no email), a coming
  Sunday that is short of ushers or counters, a report still missing.
  *Still to do*: alerts not yet on, anyone still on their default PIN.
  *Fine*: the rest, with "Alerts on: n of m". Only the first block counts
  as a fault. The names come from the server, which builds them from the
  same queries it sends by, so the report cannot certify the silence it
  exists to catch; `/api/health` without the sheet's token still names
  nobody.
- **Emails carry a link.** Every email ends with the address of the screen
  it is about, built from `app_url`: a report, Approvals, Notifications. It
  is the same screen the phone alert opens, from one place in the code.
  Looking costs nothing: a link only opens the app, carries no token and
  does nothing by itself; the PIN is what acts.
- **The duty in your own diary.** A duty email carries a calendar entry
  timed to the service's real start, so a tap puts it in the phone's diary
  with a reminder the day before. It is timed, never all-day, and the entry
  belongs to the appointment: a reminder updates the same entry instead of
  adding a second, and coming off the duty, or the event being cancelled,
  takes it out again. An event with no start time sends none.
- **Sabotage.** `node tests/sabotage.mjs` takes each past fix back out of a
  scratch copy of the repo, one at a time, and expects that fix's own suite
  to go red; anything that stays green is named, and so is any entry whose
  code has moved, so the file cannot quietly stop testing anything. All 19
  entries are caught today. It is not part of `run-tests.mjs`, because it
  runs a suite per entry.
- **Tested against an old database.** `tests/fixtures/schema-w0.3.5.sql` is
  the schema as it stood at an earlier release, kept old on purpose, with
  `tests/suites/04-old-database.mjs` running the current Worker against it:
  a whole Sunday, plus the newest features. Taking a line out of the
  Worker's upgrade list turns the suite red. The code is always newer than
  somebody's database, so that is the case worth testing.
- **Words.** Prompts and instructions only: the screens say what to do and
  what happened, never how the app works. Every sentence cut for that
  reason is kept in `tests/suites/05-words.mjs`, which fails if one comes
  back, and the same suite checks each status label against the record it
  is read from.
- **Phone alerts.** Notifications → Turn on alerts (either app). Every new
  notification then also wakes the phone. As in the Driver App, the push
  carries nothing: the phone asks the server what it is for. On iPhone it
  works once Ushers is added to the Home Screen and opened from there.
- **Quiet hours.** Between `quiet_from` (21) and `quiet_to` (8), London
  time, phones are woken only for `urgent_types` (a countersign request, an
  approval request). Everything else is in the app at once and wakes the
  phone when quiet hours end. The email to anyone with alerts on no phone
  waits too. Setting the two hours the same turns quiet hours off.
- **The bell.** Both apps have a bell in the banner once signed in, as the
  Driver App's coordinator app. Hollow while alerts are off on this phone:
  a tap turns them on. Filled once they are on: a tap opens Notifications.
  It carries the unread count (also on the Notifications tab and, where the
  phone allows, on the home-screen icon) and keeps listening while the app
  is open: it asks `notifications.count` every `refreshSeconds`, again when
  the app comes back into view, and at once when a phone alert lands.
  Anything new is shown in a strip at the foot of the screen. Notifications
  → Send a test alert (`push.test`) proves the chain end to end.
- **Adding Ushers to the phone.** Once signed in where the app is not on the
  Home Screen, the offer to install comes first and the alerts question waits
  behind it, so the two never share the screen. Chrome does it in one tap
  (`beforeinstallprompt`, caught at load); an iPhone gets the three steps,
  which is the only way there. `install.html` is a one-page guide with the
  steps drawn into the page, shareable at onboarding. The app tells the server
  whether it is running from a Home Screen, which is kept as the date they
  first did: Admin → Ushers marks anyone left "Not installed" and counts
  "Installed: n of m", Check everything lists them, they are nudged by app and
  email every Wednesday evening until they have it, and the Head Usher can
  send the steps to one person or to everybody left.
- **Nobody left unalerted.** Once signed in on a phone where alerts are off,
  the person is asked straight out to turn them on, on every sign-in and
  every time the app is opened afresh, for as long as alerts stay off ("Not
  now" puts it away for that visit only; on an iPhone in Safari, they are
  told to add the app to the Home Screen first). Anyone with alerts on no phone is emailed whatever is still unread
  after `unalerted_email_minutes` (60; 0 turns it off), one email listing
  them, at most two days back and once each. Admin → Ushers marks them
  "Alerts off".

### Every alert

Who gets told what, when, and how. "App" is the Notifications tab in
whichever app they use; "phone" is the push, which waits for quiet hours
unless the type is urgent; "email" goes to anyone the type is emailed to,
and to anyone with alerts on no phone as part of their digest.

| What | Who | When | How | Why | Test |
| --- | --- | --- | --- | --- | --- |
| You are on duty: *event* | each usher added | the rota is set or changed | app, phone, email + diary entry | so nobody finds out on the day | `85-off-duty`, `11-duty-ics` |
| You are no longer on duty: *event* | the usher taken off | the rota is changed | app, phone, email + cancellation | being taken off is news too | `85-off-duty` |
| Cancelled: *event* / Back on: *event* | everyone still on it | the event is cancelled or restored | app, phone, email | nobody travels to a cancelled service | `85-off-duty` |
| Duty reminder: *event* | everyone on it | `duty_reminder_days` (2) before, from `reminder_hour` (18) | app, phone, email + diary entry | the one reminder the Driver App found people rely on | `90-diary`, `11-duty-ics` |
| Report not yet submitted: *event* | everyone on that duty | the event day from `report_reminder_hour` (15) | app, phone, email | the record is only as good as the day it is written | `90-diary` |
| Please countersign: *event* | the chosen countersigner | a report is submitted, or approved for them | app, phone (urgent), email | a report waits on one person | `60-countersign-notify`, `08-email-links` |
| Please countersign the amended report | the chosen countersigner | an amendment is submitted | app, phone (urgent), email | an amendment is signed like the first one | `60-countersign-notify` |
| Approval needed: *kind* | Head Usher and Assistant | somebody chosen needs approval | app, phone (urgent), email | only an admin approves | `60-countersign-notify`, `08-email-links` |
| Approved / Not approved: *what* | the person asked about, and whoever asked | an admin decides | app, phone, email | both ends of the request hear the answer | `60-countersign-notify` |
| Verified: *event* | the submitter | it is countersigned | app, phone, email | their report is done | `60-countersign-notify`, `90-diary` |
| Amended: *event* | the submitter | an amendment is filed | app, phone, email | the record changed under their name | `50-new` |
| Filed: *event* | the submitter | a report waiting on a countersignature stops needing one | app, phone, email | it is not left pending for ever | `60-countersign-notify` |
| Report filed: *event* | `report_notify_roles` (Head Usher, Assistant) | every report, as soon as it is filed | app, phone, email | Asim's rule: every report is notified and logged | `60-countersign-notify`, `90-diary` |
| a message from Admin → Message | whoever is chosen | when it is sent | app, phone, email | the department's own announcements | `10-what-went-out` |
| Sent to *n*: *title* | the sender | straight after sending | app | how far it reached, including nobody | `10-what-went-out` |
| Department dues reminder | members behind on the year | the Treasurer sends it | app, phone, email | money chasing stays with the Treasurer | `90-diary` |
| *n* new notifications in the Ushers App | anyone with alerts on no phone | `unalerted_email_minutes` (60) after it was written | email, carrying any diary entries | alerts off must not mean unreachable | `07-health-people`, `08-email-links` |
| Approval needed: Can't make a duty | Head Usher and Assistant | an usher says beforehand they cannot make it | app, phone (urgent), email | a duty nobody can do is better known about early | `12-cant-make-it` |
| You are off duty / Covered: *event* | the usher who asked | it is approved, and again when cover is found | app, phone, email + cancellation | they need to know they are off it, and that it is covered | `12-cant-make-it` |
| Summary for *month* / *year* | `summary_roles` (Head Usher, Assistant) and anyone holding the offering or dues permission | the last Sunday of the month from `summary_hour` (19), the year's as well in December | app, phone, email | the month's record arrives without anyone asking for it | `15-summary` |
| Reminder: *event* | everybody on that duty, or one role | each pattern in `reminder_patterns`, at its own hour | app, phone, email + diary entry | the department's own rhythm, not just the standard reminder | `13b-reminder-patterns` |
| Add Ushers to your phone | anybody not on a Home Screen | Wednesdays from `reminder_hour`, and when Admin sends the steps | app, phone, email | an uninstalled iPhone is woken by nothing | `09-install` |
| In charge today: *name* | everybody on a duty that day | the name is changed | app, phone | they are the people who may need somebody this morning | `16-in-charge` |
| Test. | the phone that asked | Notifications → Send a test alert | phone | proves the chain without pretending to be real news | `80-bell`, `05-words` |

**Deliberately not alerted.** Whoever sets a rota is not told about it;
whoever files a report is not told of their own report; a refused
countersigner hears "Please countersign" only if approved, so a refusal
never reaches the person who was not yet asked; reminders skip cancelled
events and inactive people; nothing about money is ever put in a subject
line; and the System Administrator is sent nothing by role, since the role
has access and no authority.

### The rest of the journey

- **In charge today.** Home carries one line, "In charge today: <name>",
  with a Call button when a number is held. It is the Head Usher unless
  somebody else is named on the Admin dashboard, for today only (it lapses
  at midnight London) or until changed back. Everybody on a duty that day
  is told, and every change is audited. It is a contact line and nothing
  more: being in charge lends no permission, so the person named approves
  only what their own roles already allow.
- **Extra reminders per kind of event.** Beyond the one standard duty
  reminder, `reminder_patterns` holds a list per kind of event:
  `{ days, hour, role, paused }`, counted from the event's own date, sent by
  the clock, deduped like every other reminder and quiet at night. A pattern
  with a role reaches only the people holding it; a paused one sends
  nothing; a cancelled event reminds nobody.
- **Messages.** Admin → Message chooses who it goes to (everybody, everybody
  on duty this Sunday, the First Service ushers, the counters, the Head
  Ushers, or people picked by name), whether it goes now or at a time, and
  whether it sits on Home until a date. Who it goes to is read when it goes,
  not when it was written, so a message set for Sunday morning reaches
  whoever is on duty then. Each one is kept, so the screen shows "Seen by n
  of m" from what people have actually opened, with a nudge for the ones who
  have not, which reaches only them.
- **Repeating events.** The department's fixed patterns live in Settings as
  rules rather than dates typed in one at a time: `{ id, title, type, rule,
  time }`, where the pattern is `first-saturday`, `last-friday`,
  `nth-weekday:2:sun`, `weekly:wed` or `yearly:09:first-saturday`. The
  events are made a year ahead and carry the rule's id, so changing the
  title or time moves the ones still to come and leaves the past as it
  happened; pausing or deleting a rule cancels the coming ones, and starting
  it again brings them back, telling anybody already on duty either way.
  Sunday services are made by the rota, never by a rule.
- **"I can't make it".** An usher can say beforehand that they cannot make
  a duty, with a reason and, if they like, a suggested cover who is never
  told anything. It goes through the same authorisation engine as everything
  else, as the kind `duty_release`: the duty stays theirs until it is
  answered. Approved with a cover named, the duty moves and both people are
  told; approved with nobody named, the appointment is released and the
  request waits in Approvals under "Cover still to arrange" — the name stays
  on the record so it can be undone, while reminders, Check everything and
  the dashboard read the status, so the Sunday shows as short. Refused, only
  the person who asked hears, and they are told they are still on duty only
  if the rota still says so. There is no cut-off: a request close to the day
  is marked late. The cover picker names everybody active, marked if they
  are already on something that day and with when they last served.
- **The month's summary.** On the evening of the last Sunday of each month
  the app sends the month's figures itself: services and events, reports
  filed, countersigned and still waiting, attendance, and what is still to
  come. December sends the year's as well. It is the same arithmetic as
  Admin → Reports, from one function, so the two cannot drift apart. Money
  is held back by permission, not by role: the offering figures go only to
  holders of `offering.summary`, the dues position only to holders of
  `dues.view_all`, and the System Administrator is sent nothing by this
  route. Each one goes once, by its own dedupe key.
- **PDFs.** Any report has a PDF button (both apps). Admin → Reports makes a
  summary PDF for any period of up to 400 days.
- **Signing in.** The name chosen last on this phone is already selected
  (with "Not you?" to clear it) and the list the server last gave is shown
  before the server answers, so the screen works with no signal. Choosing a
  name moves to the PIN; the fourth digit signs in by itself after a short
  pause, and so does Enter. A wrong PIN empties the box and says how many
  tries are left. Past about fifteen names a box above the list narrows it
  as you type. Every PIN box in both apps takes digits only. Approve and
  Reject stay their own tap, since a PIN cannot say which was meant.
- **Signing** is typing your full name, ticking to confirm, and your PIN.
- **Offline.** Reports are saved on the phone as they are typed. A report
  signed with no signal is kept as "Saved on this phone. Not sent yet" and
  sent when the signal is back. The PIN is then checked on the phone
  against a salted hash kept from the last sign-in, and the record says so
  (`SUBMIT_PIN_CHECK = device`). `offline_signing` turns this off.
  The Submission ID is made on the phone, so a retry is filed once.
- **Opening with no signal.** After one visit with signal, both apps open
  with none: `sw.js` keeps both apps' files, and each screen's last good
  answer is kept on the device, shown under "No signal. Showing what this
  device saved on …". A report can be started offline for any duty Home
  showed. Other changes (rota, events, ushers and roles, messages,
  settings, dues, approval requests) wait in the same queue with their own
  id, which the server remembers (`queued_done`), so each is done once.
  Signing in, resetting a PIN, deciding an approval and amending a report
  still need a signal. Signing out clears the saved screens. The very first
  open of all needs a signal: until then the device has nothing to show.

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
    node tests/sabotage.mjs               takes each fix back out and expects its suite to go red

The Worker runs against a real SQLite database through a D1 shim, and Code.gs
against a fake of Apps Script (both from the Driver App). The journey suite
is the 27-step acceptance test. `tests/browser/journey.mjs` drives both apps
in Chromium at phone width and photographs each step; run it by hand.

## Left for later (designed for, not built)

The full audit viewer, rolling rota engine, analytics, advanced dues
carry-forward, notification preferences.

See [DEPLOY.md](DEPLOY.md) to set it up.
