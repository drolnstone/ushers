# Setting up the Ushering App

Versions: app v0.3.20 · server w0.3.20 · sheet v0.3.4.

Already done once (skip if so): the D1 database exists with `server/schema.sql`
run in its Console, the Worker exists, and `config.js` points at it
(`https://ushers-api.asimbassey.workers.dev`).

## 1. The server (Cloudflare Worker)

1. Workers & Pages → D1 → the database. If it is new, open it → Console →
   paste the whole of
   https://raw.githubusercontent.com/drolnstone/ushers/main/server/schema.sql
   → Execute. (An existing database gets new tables and columns from the
   Worker itself on its first call.)
2. Workers & Pages → the Worker (`ushers-api`) → Edit code → replace
   everything with the whole of
   https://raw.githubusercontent.com/drolnstone/ushers/main/server/worker.js
   → Deploy.
3. The Worker → Settings → Bindings → D1 database: variable name `DB`,
   your database. (The database's own name does not matter.)
4. Settings → Variables and Secrets, add as **Secret**:
   - `PIN_PEPPER`: a long random value. Never change it once PINs are set:
     every PIN would stop working.
   - `SHEET_TOKEN`: another long random value. The same value goes into the
     sheet in step 4.3.
   - `BOOTSTRAP_TOKEN`: a third random value, only until step 3 is done.
   And as **Text**:
   - `ALLOWED_ORIGINS`: `https://drolnstone.github.io`
   - `PUSH_CONTACT` (optional): `mailto:` an address push services may write
     to about this Worker.
5. Settings → Triggers → Cron Triggers → add `*/5 * * * *` (reminders and
   the sheet knock).
6. Open `https://<worker address>/api/health`. It should show
   `"server":"w0.3.20"`, and `pinPepper` and `sheetToken` true.

## 2. The pages (GitHub Pages)

1. `config.js` has the Worker's address as `api` (already done).
2. Repository Settings → Pages → Deploy from branch `main`, folder `/`.
   The Ushers App is then at https://drolnstone.github.io/ushers/ and the
   Admin App at https://drolnstone.github.io/ushers/admin/.

## 3. The first System Administrator

1. Open the Ushers App. While nobody is a System Administrator and
   `BOOTSTRAP_TOKEN` is set, the sign-in screen shows **First-time setup**:
   enter the token, your full name and a four-digit PIN.
2. Delete `BOOTSTRAP_TOKEN` from the Worker (Settings → Variables and
   Secrets).
3. Open the Admin App and sign in. Ushers → add everyone with their name,
   phone number and email. New ushers start on their default PIN; someone
   with no default PIN needs a starting PIN typed in.
4. Give roles: Head Usher and Assistant Head Usher open the Admin App; the
   Treasurer works from the Treasurer tab inside the Ushers App.

To try every role yourself: Admin → Settings → Testing → choose a four-digit
PIN → **Add test people and a sample week**, then sign in as Test Head Usher,
Test Treasurer, Test Usher One and so on. Before going live, **Switch off
test people**.

## 4. The Google Sheet

1. Open the sheet, then File → Settings → Time zone: (GMT+00:00) London.
2. Extensions → Apps Script. The script must be opened from the sheet like
   this so it belongs to the sheet. Replace everything in `Code.gs` with
   the whole of
   https://raw.githubusercontent.com/drolnstone/ushers/main/Code.gs → Save.
3. Project Settings → Script Properties:
   - `WORKER_URL`: the Worker address, without `/api` (e.g.
     `https://ushers-api.asimbassey.workers.dev`)
   - `SHEET_TOKEN`: the same value as the Worker's
   - optional: `SENDER_NAME`, `REPLY_TO` (for emails), `UNLOCK_MAX_MINUTES`
     (the unlock window, 5 if left out)
4. Deploy the web app:
   - First time: Deploy → New deployment → Web app, execute as Me, access
     Anyone → Deploy → copy the address ending `/exec`.
   - Already deployed: Deploy → Manage deployments → the pencil → Version:
     **New version** → Deploy. The address stays the same. Without this the
     web app keeps running the old code.
5. Put the `/exec` address in the Worker as the Text variable
   `SHEET_WEBAPP_URL`. It never goes in GitHub.
6. Reload the sheet → Ushering → Set up the sheet (allow the permissions).
   It protects every tab, writes a GUIDE tab and starts the five-minute
   drain.
7. Ushering → Check everything: every line should be ✓.

## Afterwards, check

A. `/api/health` shows `pinPepper`, `sheetToken` and `sheetKnock` true, and
   after five minutes `clockLastTick` is no longer 0.
B. The foot of both apps reads app v0.3.20 · server w0.3.20 · sheet v0.3.4
   (the sheet number appears after the first drain).
C. The Admin App's sign-in lists only Head Ushers, Assistant Head Ushers and
   System Administrators. A Head Usher moves between the apps with Open
   Admin App and Open Ushers App, with no second sign-in.
D. The Treasurer sees a Treasurer tab in the Ushers App and no Open Admin App.
E. A new usher signing in for the first time is asked "Do you wish to keep
   your default PIN?"; Yes keeps it, No leads to a new PIN.
F. Admin → Rota: choosing one Second Service counter is refused; two saves.
G. An usher on the rota opens the First Service report, the attendance
   total adds itself up, signs, and the report shows Pending
   Countersignature. Once it is countersigned, the Head Usher has "Report
   filed" in Notifications (both apps) and by email.
H. Within a minute the REPORTS, ATTENDANCE, OFFERING and AUDIT tabs have the
   rows, and every tab is still protected.
I. On an iPhone: Share → Add to Home Screen shows the church logo; open it
   from there, tap the bell at the top (or Notifications → Turn on alerts on
   this phone), and ask somebody to send you a message (Admin → Message): the
   alert arrives, and the bell shows the unread count. Notifications → Send a
   test alert sends one that says "Alerts are working".
J. Admin → Reports → Make PDF summary downloads the month so far.
K. Admin → Events: add a Prayer Meeting for today and choose an usher on duty.
   That usher's report has no countersigner box and shows Verified once
   signed, and the Head Usher gets "Report filed" straight away, in the
   app, as a phone alert (if turned on) and by email.
L. The Ushers App's banner is bright purple and the Admin App's is deep
   aubergine, as their home-screen icons. Auto, Light and Dark at the foot of
   either app change both; Auto follows the phone.
M. Open both apps once with signal and look at a few screens. Turn on
   airplane mode and open each again: both open, the screens seen before
   show with "No signal. Showing what this device saved on …", and a rota
   saved in Admin says "Saved on this device". Turn airplane mode off: within
   half a minute the change is on the server and the banner is gone.

## Updating later

The note for the current release, in the order to do it, is
[DEPLOY-LATEST.txt](DEPLOY-LATEST.txt); every release keeps its own copy in
`docs/deploy/`. The steps below are the same thing in general.

1. Worker: Edit code → paste the new `server/worker.js` → Deploy. New tables
   and columns are added on its first call.
2. Sheet: Extensions → Apps Script → paste the new `Code.gs` → Save →
   Deploy → Manage deployments → the pencil → New version → Deploy. Then
   Ushering → Set up the sheet.
3. Pages update by themselves when `main` changes. Phones pick up the new
   version the next time the app is opened.
