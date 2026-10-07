# Findings

Minibus pages v1.104.1 · server w2.51.0 · sheet v1.111.0 read against
Ushers app v0.3.12 · server w0.3.7 · sheet v0.3.1, on 7 October 2026.

## 1. Shipped in Ushers (PRs #11 to #21, all merged)

These came from Minibus or from the earlier reviews and are done. Nothing
further is proposed for them.

| Area | Where it lives now |
|---|---|
| Fixed tabs in both apps | `index.html`, `admin/index.html` |
| Admin role assignment (System Administrator, and Head Usher once onboarded) | Admin → Ushers |
| Colours and light/dark themes; deep teal Admin App | `shared/style.css`, theme picker in `shared/core.js` |
| Change PIN, with the default-PIN question | `#pin` screen in `index.html` |
| The bell, unread count, foot strip, test alert | `shared/core.js`, `server/worker.js` `pushPending` / `push.what` |
| Ask to turn alerts on at every sign-in; email for people with alerts off | `emailUnalerted` in `server/worker.js`; "Alerts off" chip in Admin → Ushers |
| Open with no signal, queue changes until it returns | `shared/core.js` outbox, `tests/suites/80-offline.mjs` |

Two pieces have since gone the other way: Minibus took the alerts list,
Settings, the coordinator bell and Change PIN from Ushers (its w2.39.0 and
w2.40.0).

Already right in Ushers, no action: duty reminders skip cancelled events
and removed appointments (`clockTick`, `e.status<>'cancelled' AND
a.status='active'`). Minibus learnt that one the hard way.

## 2. Still open from the 5 October reviews

None of the earlier top recommendations has been built yet. Each now has a
brief:

| Earlier item | Brief |
|---|---|
| 4.3 Tell an usher when taken off a duty | [01](proposals/01-removed-from-duty.md) |
| 4.2 Quiet hours | [02](proposals/02-quiet-hours.md) |
| 2.1 to 2.3 Stamps, elements, functions tests | [03](proposals/03-guard-tests.md) |
| Ideas A: sign-in screen | [04](proposals/04-sign-in.md) |
| 2.4 Plain wording | [05](proposals/05-plain-words.md) |
| 2.5 and 2.6 Deploy notes, HANDOVER.md | [06](proposals/06-deploy-notes-handover.md) |
| 4.1 Check everything names people | [07](proposals/07-check-everything-people.md) |
| 4.4 Email links | [08](proposals/08-email-links.md) |
| Ideas C: install to phone | [09](proposals/09-install-offer.md) |
| 4.6 `.ics` on duty reminders | [11](proposals/11-duty-ics.md) |
| 4.5 Swap and cover requests | [12](proposals/12-swap-cover.md) |
| Ideas B: repeating events and announcements | [13](proposals/13-repeating-events-announcements.md) |

## 3. New in this sweep

### 3.1 Cancelling an event tells nobody (Ushers gap)
`aEventCancel` (`server/worker.js`, "async function aEventCancel") updates
the event, the audit and the sheet, and notifies no one. Everyone rostered
would still turn up. Minibus's highest-ranked driver alert is "Your route
is not running today". Folded into [brief 01](proposals/01-removed-from-duty.md).

### 3.2 The trail of what went out (Minibus w2.45.0 and w2.48.0)
Minibus lists every push and email it sent on the coordinator's Alerts
screen, one line per message (suite `54-what-went-out.mjs`), and each batch
sent to drivers or passengers puts one notification on every coordinator's
phone saying what went and how many it reached, including a batch that
reached nobody (`58-send-trail.mjs`). For Ushers this answers "did the
message go, and to how many?" after Admin → Message. [Brief 10](proposals/10-what-went-out.md).

### 3.3 Words that match what is behind them (Minibus w2.51.0)
Asim asked of a red "Renewal overdue" badge: renewal or service? A sweep
found three more labels saying something other than their data
(`61-words-match.mjs`). The Ushers equivalent is a check that every status
label and notification title matches its record, for example
`STATUS_LABELS` against the report's real state, and "Report not yet
submitted" only when no report exists. Added to [brief 05](proposals/05-plain-words.md).

### 3.4 Archive by heading (Minibus sheet v1.110.0)
Minibus's 3am archive compared columns by position and silently moved
nothing for a month when a live tab's order differed from its archive.
Ushers has no archive yet. When one is built (earlier review 4.11), it
must match by heading, as every other Ushers sheet write already does.
No brief now.

### 3.5 Photos on reports (Minibus w2.50.0)
Defect photos, shrunk on the phone to about 250 KB, stored on the server
only, counted on the sheet. Ushers has no defect concept. A possible later
use is a photo of the counted offering sheet on a Second Service report;
only if Asim or the Head Usher asks. No brief now.

## 4. Not for Ushers

Unchanged from 5 October: everything transport (stops, ETA, walkarounds,
vehicle log, MOT, bookings, passenger page), the shelf, sheet edits
flowing back to phones, the live rehearsal, the shared `PIN_SALT`, and the
PIN carried in session storage. Ushers' own designs there are better.
