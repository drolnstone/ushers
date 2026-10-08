# Handover

For whoever picks this up next, Claude or human. Read this, then
[README.md](README.md) for how the app works and
[DEPLOY-LATEST.txt](DEPLOY-LATEST.txt) for the release note Asim follows.

## The rules

1. **Only bump what moved.** The app version (`APP_VERSION` in
   `shared/core.js`, matched by `CACHE` in `sw.js`), the server
   (`SERVER_VERSION` in `server/worker.js`) and the sheet (`SHEET_VERSION`
   in `Code.gs`) each move only when their own file changed. Tests only, or
   docs only, move nothing.
2. **A number already handed over is spent.** Once a release note names a
   version, the next change takes the next number, even if Asim has not
   pasted it yet.
3. **One pull request per step**, as a draft, with Asim as assignee and
   reviewer.
4. **Claude never merges and never deploys.** Asim pastes the Worker and
   `Code.gs` himself and merges himself. A change to `server/worker.js` is
   not live until he pastes it.
5. **`node tests/run-tests.mjs` must end in READY** before anything is
   pushed. `node tests/sabotage.mjs` is the slower check that the tests
   themselves still bite.
6. **Nothing secret in the repo**, which is public. Above all the Apps
   Script `/exec` address, which lives only in the Worker's
   `SHEET_WEBAPP_URL`; `tests/suites/40-public.mjs` fails if one appears.
   Nothing anywhere says how a default PIN is made.

## The parts, and where they are live

| Part | In the repo | Live |
| --- | --- | --- |
| Ushers App | `index.html`, `shared/`, `sw.js` | GitHub Pages on `main` |
| Admin App | `admin/` | the same Pages site, at `/admin/` |
| Guide to installing | `install.html` | the same site, at `/install.html` |
| Server | `server/worker.js`, `server/schema.sql` | a Cloudflare Worker, `ushers-api`, with a D1 database bound as `DB` |
| The record | `Code.gs` | Apps Script bound to the Google Sheet |

The server is the only authority on sessions, PINs and permissions. The
sheet is the historical record, written from an outbox the script drains.
The app never reads the sheet.

## Where the versions are

The three stamps above are what the foot of both apps shows and what
`/api/health` reports. `tests/suites/01-stamps.mjs` holds them together:
the app version and the cache name must match, and `DEPLOY.md` and
`DEPLOY-LATEST.txt` must name what is in the code. Every release gets its
own note in `docs/deploy/`, and the latest is copied to
`DEPLOY-LATEST.txt`.

## How Asim works

- He reads every line, and answers briefly, sometimes by editing an earlier
  message rather than replying — so check edits.
- When he asks whether something is possible, he wants the answer, not a
  change. Build once he says what he wants.
- He wants complete, numbered steps pasted in the chat, not a pointer to a
  file.
- The Driver App (`drolnstone/minibus-check`, read-only) is the reference
  for anything already solved there.
- His own role in the live app is System Administrator: access, not
  authority. It approves nothing. He tests approving as a test Head Usher.
- Only the Head Usher and Assistant Head Usher approve anything. The
  Treasurer is financial only, inside the Ushers App.

## Where the work stands

Every one of the seventeen briefs in `docs/minibus-review/proposals/` has
been built. Where a brief carried questions for Asim (12, 13, 15, 16), it
was built on the default written in the brief, and each default is named in
the pull request so he can say otherwise:

| Brief | What it added | Its default, if any |
| --- | --- | --- |
| 01 | an usher is told when they are off a duty | — |
| 02 | quiet hours for phone alerts | — |
| 03 | version stamps, every element, no dead code | — |
| 04 | a faster sign-in screen | — |
| 05 | plain words, held by a test | — |
| 06 | this file, and a note per release | — |
| 07 | Check everything names people | — |
| 08 | a link in every email | — |
| 09 | adding Ushers to the phone, and the weekly nudge | — |
| 10 | what went out | — |
| 11 | a calendar entry on duty emails | — |
| 12 | "I can't make it" | the Head Usher picks the cover; no cut-off, late ones marked |
| 13 | repeating events, reminder patterns, the Message screen | admins send; reminders by email as today; first Saturday 17:00 and September for the retreat are examples, not set |
| 14 | every alert in one table, and the Sunday diary | — |
| 15 | the month's and year's summary | monthly and yearly; no PDFs in Drive |
| 16 | in charge today | built, contact only; it lends no permission |
| 17 | the old-database suite and sabotage | — |

## What is waiting for Asim

- Paste the Worker and `Code.gs`, then merge, following
  [DEPLOY-LATEST.txt](DEPLOY-LATEST.txt).
- Say where he saw "the 400 issue in worker.js": nothing in any commit,
  branch, pull request or thread matches it, and the Worker answers 400 on
  purpose for bad input, such as a PIN that is not four digits.
- The real patterns for brief 13: the prayer meeting's day and time, and the
  retreat's dates. Settings takes them without a release.
- Whether a report signed offline may still be sent 72 hours later, which is
  the default nobody has confirmed.

## Still left for later, by his own decision

Analytics beyond the dashboard and the PDF summary ("power bi level stuff.
park for now"), dues carry-forward rules, RSVP on announcements, and saving
PDFs to Drive.
