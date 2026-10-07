# Minibus sweep, 7 October 2026

A fresh A-to-Z read of the Driver App (`drolnstone/minibus-check`) against
Ushers, packaged so another session can build each proposal without
re-reading Minibus.

- Minibus on `main`: pages v1.104.1 · server w2.51.0 · sheet v1.111.0
  (merge of its PR #70).
- Ushers on `main`: app v0.3.12 · server w0.3.7 · sheet v0.3.1.
- Builds on the two earlier reviews of 5 October (project files
  `minibus-review/minibus-vs-ushers.md` and
  `minibus-review/ideas-signin-and-announcements.md`). Nothing in either
  repository's code was changed by this sweep.

## What is here

| File | What it is |
|---|---|
| [walkthrough/](walkthrough/) | The two 5 October walkthrough write-ups, copied as they were |
| [findings.md](findings.md) | What has shipped since the last review, what is new in Minibus, what is still open, and what is not for Ushers |
| [proposals/](proposals/) | One self-contained brief per piece of work: why, files to touch, steps, acceptance checks |

## Proposals, in the suggested order

| # | Brief | Size | Touches |
|---|---|---|---|
| 01 | [Tell an usher they are off a duty](proposals/01-removed-from-duty.md) | Small | Worker, tests |
| 02 | [Quiet hours for phone alerts](proposals/02-quiet-hours.md) | Small | Worker, tests, README |
| 03 | [Three guard tests](proposals/03-guard-tests.md) | Small | tests only |
| 04 | [Faster sign-in](proposals/04-sign-in.md) | Small | Both apps, `shared/core.js` |
| 05 | [Plain words, held by a test](proposals/05-plain-words.md) | Small | Pages, Worker strings, tests |
| 06 | [Deploy notes and HANDOVER.md](proposals/06-deploy-notes-handover.md) | Small | Docs only |
| 07 | [Check everything names people](proposals/07-check-everything-people.md) | Medium | Worker `health`, `Code.gs` |
| 08 | [A link in every email](proposals/08-email-links.md) | Small | Worker |
| 09 | [Add Ushers to your phone](proposals/09-install-offer.md) | Medium | Both apps, Worker, Admin |
| 10 | [What went out, for the Head Usher](proposals/10-what-went-out.md) | Medium | Worker, Admin App |
| 11 | [Calendar file on duty reminders](proposals/11-duty-ics.md) | Small | Worker, `Code.gs` mail |
| 12 | [Can't make it: swap and cover](proposals/12-swap-cover.md) | Large | Worker, both apps, sheet |
| 13 | [Repeating events and announcements](proposals/13-repeating-events-announcements.md) | Large | Worker, Admin App |
| 14 | [Alerts table and the diary test](proposals/14-alerts-inventory-diary.md) | Small | README, tests |
| 15 | [Monthly summary emails](proposals/15-monthly-summaries.md) | Medium | Worker, `Code.gs` |
| 16 | [In charge today](proposals/16-in-charge-today.md) | Small | Worker, both apps |
| 17 | [Old-database and sabotage tests](proposals/17-old-database-and-sabotage-tests.md) | Small | tests only |

01 to 06 are cheap and change little for ushers; any of them can go first.
12, 13, 15 and 16 need Asim's answers to the questions at the end of each brief
before building.

## Every walkthrough item, and where it went

| Walkthrough item | Where now |
|---|---|
| 1. What Ushers already has | findings.md §1 (no action) |
| 2.1 to 2.3 Stamps, elements, functions tests | 03 |
| 2.4 Plain wording | 05 |
| 2.5 Deploy notes, 2.6 HANDOVER.md | 06 |
| 2.7 Small rules ("Looking costs nothing", "Unheard is not applied", "Test.") | 08, 05, and the offline queue already keeps "unheard is not applied" |
| 3. Typical patterns | No action, except the old-database test: 17 |
| 4.1 Check everything names people | 07 |
| 4.2 Quiet hours | 02 |
| 4.3 Told when taken off a duty | 01 (now also event cancelled) |
| 4.4 Email links | 08 |
| 4.5 Swap and cover | 12 |
| 4.6 `.ics` on duty emails | 11 |
| 4.7 Alerts table and diary test | 14 |
| 4.8 Monthly summaries, PDFs to Drive | 15 |
| 4.9 Who to ring today | 16 |
| 4.10 Sabotage checks | 17, part B (later) |
| 4.11 Archive at 3am, handbook and videos | Later, only when asked; archive must match by heading (findings §3.4) |
| 5. Not for Ushers | findings.md §4 |
| Ideas A: sign-in (remember me, cursor, 4th digit, wrong PIN clears, list kept, type to find, every PIN box) | 04 |
| Ideas A.8 Face ID / passkey | 04, "Later" |
| Ideas B.1 to B.4 repeating events, reminder pattern, Message screen, seen by | 13 |
| Ideas B.5 RSVP, B.6 calendar file | 13, "Later" (B.6 reuses 11) |
| Ideas B.7 Quiet hours | 02 |
| Ideas C: install offer, tracking, reminders, Send install steps, guide, Admin App | 09 |
| Can a non-admin use the Admin App? | Answered no on 5 October (server checks every action); no action |

## For the session that builds these

- **One PR per brief**, based on `main`, as a draft, with the deploy steps
  in the PR body (Worker paste, Code.gs paste and New version, or merge only).
  Asim pastes and merges himself; Claude never merges or deploys.
- **Bump only what moved**: app `APP_VERSION` in `shared/core.js` together
  with `CACHE` in `sw.js`; server `SERVER_VERSION` in `server/worker.js`;
  sheet `SHEET_VERSION` in `Code.gs`. A number already handed over is spent.
- **Run** `node tests/run-tests.mjs` (it sets London time itself) and end on
  READY. Add a suite under `tests/suites/` for each behaviour change.
- **Update the README** section the change touches, in the README's own
  plain style.
- **Roles.** Asim is System Administrator: access, not authority. Anything
  about money or approving reports stays with Treasurer, Head Usher and
  Assistant Head Usher. Admin role assignment is for the System
  Administrator and the Head Usher.
- **Words**: prompts and instructions only, never explanations of the app
  (see brief 05).
- If a line number in a brief has moved, search for the quoted code; the
  briefs quote enough to find it.
