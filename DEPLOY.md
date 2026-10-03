# Setting up the Ushering App

Versions: app v0.3.4 · server w0.3.3 · sheet v0.3.0.

## 1. The database and server (Cloudflare)

1. Workers & Pages → D1 → Create database `ushers`.
2. Open it → Console → paste the whole of
   https://raw.githubusercontent.com/drolnstone/ushers/main/server/schema.sql
   → Execute.
3. Workers & Pages → Create → Worker, named `ushers-api`. Edit code → paste
   the whole of https://raw.githubusercontent.com/drolnstone/ushers/main/server/worker.js
   → Deploy.
4. The Worker → Settings → Bindings → D1 database: variable name `DB`,
   database `ushers`.
5. Settings → Variables and Secrets, add as **Secret**:
   - `PIN_PEPPER`: a long random value. Never change it once PINs are set.
   - `SHEET_TOKEN`: another long random value.
   - `BOOTSTRAP_TOKEN`: a third random value (delete it after step 3 below).
   And as plain text:
   - `ALLOWED_ORIGINS`: `https://drolnstone.github.io`
6. Settings → Triggers → Cron Triggers → add `*/5 * * * *` (reminders and
   the sheet knock).

## 2. The pages (GitHub Pages)

1. Put the Worker's address (e.g. `https://ushers-api.<you>.workers.dev`) in
   `config.js` as `api`, and merge.
2. Repository Settings → Pages → Deploy from branch `main`, folder `/`.
   The Ushers App is then at https://drolnstone.github.io/ushers/ and the
   Admin App at https://drolnstone.github.io/ushers/admin/.

## 3. The first System Administrator

Open the Ushers App. While nobody is a System Administrator and
`BOOTSTRAP_TOKEN` is set, the sign-in screen shows **First-time setup**:
enter the token, your full name and a PIN. Then delete `BOOTSTRAP_TOKEN`
from the Worker. Sign in, Open Admin App → Ushers to add everyone and give
roles.

To try every role yourself: Admin → Settings → Testing → choose a PIN →
**Add test people and a sample week**, then sign in as Test Head Usher,
Test Treasurer, Test Usher One and so on. Before going live, **Switch off
test people**.

## 4. The Google Sheet

1. Make a new Google Sheet under the church's Google account, Europe/London
   (File → Settings → Time zone).
2. Extensions → Apps Script → paste the whole of
   https://raw.githubusercontent.com/drolnstone/ushers/main/Code.gs → Save.
3. Project Settings → Script Properties: `WORKER_URL` (the Worker address),
   `SHEET_TOKEN` (same as the Worker's), optionally `SENDER_NAME`,
   `REPLY_TO`.
4. Deploy → New deployment → Web app, execute as Me, access Anyone → copy
   the address. Put it in the Worker as the plain variable `SHEET_WEBAPP_URL`.
5. Reload the sheet → Ushering → Set up the sheet (allow the permissions).
   It also writes a GUIDE tab explaining every tab.
6. Ushering → Check everything: every line should be ✓.

## Afterwards, check

A. The foot of both apps reads app v0.3.4 · server w0.3.3 · sheet v0.3.0
   (the sheet number appears after the first drain).
B. A Head Usher signed in on the Ushers App sees Open Admin App, and it opens
   without asking for the PIN again.
C. Admin → Rota: choosing one Second Service counter is refused; two saves.
D. An usher on the rota opens the report, the attendance total adds itself
   up, signs, and the report shows Pending Countersignature.
E. Within a minute the REPORTS, ATTENDANCE, OFFERING and AUDIT tabs have the
   rows, and every tab is still protected.
F. A report has Ministration between Attendance and Offering, on the First
   and Second Service alike, and its PDF button downloads the report.
G. On an iPhone: Share → Add to Home Screen shows the Ushers icon; open it
   from there, Notifications → Turn on alerts on this phone, and ask somebody
   to send you a message (Admin → Message): the alert arrives.
H. Admin → Reports → Make PDF summary downloads the month so far.

## Updating from v0.1.0

1. Paste the new `server/worker.js` into the Worker and deploy. The new
   tables and columns are added by the Worker itself on its first call (or
   run `server/schema.sql` again; it is safe to repeat).
2. Paste the new `Code.gs` into Apps Script, then Ushering → Set up the
   sheet: it adds the MINISTRATION and REPORT_VERSIONS tabs and the VERSION
   and CURRENT columns.
3. Optional Worker variable `PUSH_CONTACT`: an address push services may
   write to about this Worker (e.g. `mailto:` the church office). Without it
   the Worker's own address is used.
