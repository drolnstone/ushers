# Minibus walkthrough, for the Ushers App

Read on 5 October 2026.

- Minibus (`drolnstone/minibus-check`) on `main`: pages v1.101.1 · server w2.47.0 · sheet v1.107.0. Read: README (all 2,300 lines), HANDOVER.md, DEPLOY.txt, the test suites and the browser checks.
- Ushers (`drolnstone/ushers`) on `main`: app v0.3.12 · server w0.3.7 · sheet v0.3.1.

Nothing was changed in either repository.

---

## 1. What Ushers already has from Minibus

Ushers was built on the Minibus pattern, and `docs/DRIVER-APP-REUSE.md` records it. In short, Ushers already has:

- GitHub Pages with no build step, a Cloudflare Worker with D1, and Apps Script on the Sheet.
- The outbox drain, the knock after each write, and the five-minute timer underneath.
- Header-driven sheet access (`headerMap`, missing headers added at the end).
- London time helpers.
- `sendMail()` with `SENDER_NAME` and `REPLY_TO`.
- Web Push with an empty payload, where the phone asks `push.what`. The signing keys are made by the Worker.
- The notification bell, the "turn on alerts" prompt every time the app opens, the email fallback for people with alerts off, the unread count on the icon, the strip at the foot, and "Send a test alert".
- The offline queue, with ids made on the phone so a retry is filed once.
- PDFs from `coord/pdf.js`'s layout.
- The `app · server · sheet` line at the foot.
- The test runner (real SQLite through a D1 shim, Apps Script faked, READY or NOT READY) and CI on London time.
- Three tries, then five minutes.
- A public repo with no secrets in files.

Some things went the other way: Minibus later took the alerts list and Settings from Ushers (Minibus README, w2.40.0 and w2.41.0).

Ushers deliberately improved on Minibus in places: real sessions, per-person PBKDF2, strict sheet protection, server-side permissions on every call, and versioned amendments. Keep those.

---

## 2. Good to copy as it is

These are small, cheap to add, and proven on Minibus. Nothing here changes how ushers use the app.

### 2.1 Version stamp test (`tests/suites/01-stamps.mjs`)
Minibus fails the build if the page version and the service worker `CACHE` disagree. That is "the single most common deploy failure": a page changes, the cache name doesn't, and phones keep the old copy.
- **Ushers today:** `APP_VERSION` is in `shared/core.js` and `CACHE` is in `sw.js`. No test ties them together, and none ties them to the version line in DEPLOY.md.
- **Copy:** a small suite that fails if `core.js`, `sw.js` and DEPLOY.md disagree on the app version, or DEPLOY.md and `worker.js` on the server version, or DEPLOY.md and `Code.gs` on the sheet version.

### 2.2 "Every element exists" test (`02-elements.mjs`)
`$("someId")` returning null throws nothing, so a button just quietly never works. The test finds every id the code looks up and checks it exists in the markup or a template, including ids made by helper functions.
- **Ushers:** none. Both apps build their screens with `h(...)` and look ids up, so this applies.

### 2.3 "Every function is used" test (`03-functions.mjs`)
It strips comments, then fails on any function or constant nobody calls. The reason is comments: a dead function keeps a comment that goes on describing a feature that no longer exists. It found three on its first run.
- **Ushers:** none. It is cheap to add while the codebase is still small.

### 2.4 Plain wording, held by a test (`57-plain-alerts.mjs`, README "The words")
Your rule from Minibus: "Prompts and instructions only. Never any essays and stories." Minibus also keeps every phrase it has cut in a test, so none can come back.
- **Ushers sentences that explain the app rather than the duty**, for example:
  - "Alerts are working / This phone will be told the moment anything new arrives." (`server/worker.js:2541`). Minibus now says "Test."
  - "Saved on device — waiting for connection. It will be sent automatically." (`index.html:430`)
  - "Asked. You will be told when it is decided." (`index.html:471`, `:484`, and the same idea at `:465` and `:480`)
  - "Their reports and dues stay on the record. You can bring them back by ticking Active." (`admin/index.html:537`)
- **Copy:** one sweep, plus a banned-phrases test. Keep the faded "e.g." samples: on Minibus those count as samples, not explanation.

### 2.5 One deploy note per release, in Minibus's format
Minibus keeps `analysis/DEPLOY-<versions>.txt`, with the latest copied to `DEPLOY.txt`. Each note has:
- **YOU ARE ON / GOING TO**, a row each for Pages, Worker and Code.gs.
- **IN THIS ORDER**: numbered steps with direct raw.githubusercontent.com links.
- **AFTER IT**: checks A, B, C.
- **WHAT CHANGED**: before → after.

The rules that go with it:
- "A number that has been handed over is spent."
- "Only bump what moved."
- One PR per step, so one paste of each file.
- **Ushers today:** DEPLOY.md is a setup guide with an "Updating later" section. Keep it for setup, and add the per-release note.

### 2.6 HANDOVER.md
This is one page for a fresh Claude session: what is live, what is pending, how you like to work, and the PR history. Project memory covers some of this for Ushers. A file in the repo also survives outside this project.

### 2.7 Small rules worth lifting word for word
- **"Looking costs nothing; only the PIN acts."** No link in an email may ever do anything just by being opened. Mail scanners open links before people do.
- **"Unheard is not applied."** Never tell someone a thing is done before the server has confirmed it.
- **The test alert says "Test."** and nothing else.

---

## 3. Typical patterns (standard practice, no action)

Both apps already do these, and so does any well-built app of this kind. They are listed here so they aren't mistaken for Minibus inventions:
- A PWA with a versioned service worker cache, and a home-screen icon with a new filename whenever it changes (iOS reads the icon once).
- VAPID Web Push. A 404 or 410 deletes the subscription.
- Database columns added on first use. Minibus's `05-migration.mjs` lesson: always test against a database older than the code. Ushers `50-new` does this for amendments only. A general "old database" fixture would be stronger.
- Outbox and acknowledge, with idempotent keys.
- Secrets in Worker variables and Script Properties.
- CI on every PR.
- A fixed clock in tests for anything time-of-day (`tests/lib/clock.mjs`).

---

## 4. Worth adapting for Ushers

Ordered by how much they'd help, I think.

### 4.1 A stronger "Check everything": three buckets, and named people
Minibus's *Is everything working?* sorts its lines into **Needs attention**, **Still to do** and **Fine**. Only "Needs attention" counts as a problem, so it doesn't nag every week about someone who hasn't turned alerts on. It names people:
- "No alerts yet for: Bro X, Sis Y."
- "Alerts on: 7 of 9."
- People with no PIN.
- Reminders deliberately not sent. A skipped reminder looks exactly like a failed one.

It also uses **the same query to report as it uses to send** (`DRIVER_SUB_MATCH`). Once, the report had its own join, and it certified as fine the very silence it was built to catch.

**Ushers today:** `Code.gs` `healthLines()` checks properties, tabs, protection, the server and the clock. Admin → Ushers shows "Alerts off" per person.

**Adapt:** add a people section, using the server's own queries:
- Active ushers with alerts on no phone.
- Ushers who can't be reached at all (no alerts and no email).
- The coming Sunday short of counters, or with nobody on First Service.
- Reports overdue.

### 4.2 Quiet hours for pushes that aren't urgent
Minibus sends nothing from 21:00 to 08:00 except what cannot wait. It tests every timed window against those hours.

**Ushers today:** an admin Message or an approval request wakes phones at any hour. Reminders fire at "hour ≥ reminder_hour" with no upper bound.

**Adapt:** a `quiet_from` / `quiet_to` setting. A notification made in quiet hours is still in the app at once, but its push waits until 08:00. Countersign and approval requests could be marked urgent if you want them at any hour.

### 4.3 Tell an usher when they're taken off a duty
Minibus emails "You are no longer driving" and "You are now driving" when the rota changes inside seven days.

**Ushers today:** `rota.set` tells someone added ("You are on duty", `server/worker.js:826`) but tells **nobody removed** (`:815`). They would still turn up.

**Adapt:** a "You are no longer on duty: <event>" notification on removal. Possibly also the seven-day horizon, so a rota planned months ahead doesn't buzz everyone at once.

### 4.4 A link to the record in every email
Minibus emails carry a link to the decision. **Ushers emails carry the title and body only** (`stNotify`, `server/worker.js:347`).

**Adapt:** end each email with a deep link, for example `…/ushers/admin/#auth/<id>` or `…/ushers/#rep/<id>`. That covers approvals, countersigning and filed reports. Opening the link only opens the app. Ushers already has sessions, so there's no need for Minibus's separate `do/` PIN page.

### 4.5 Swap and cover requests before the Sunday
Minibus has a **Rota Request**: a driver asks for a swap or cover, and the coordinator approves or turns it down from the app or an email link. When approving, the coordinator picks the cover from a drop-down that shows who is already on that Sunday and when each person last served. Everyone affected is told.

**Ushers today:** `duty_takeover` records after the fact that B did A's duty. There is no way for an usher to say beforehand "I can't make Sunday".

**Adapt:** "I can't make it" on a duty in Home. The Head Usher decides it in the Admin App, picking a replacement from a list marked "on duty that day" and "last served". It reuses the one authorisation engine.

### 4.6 Duty reminder emails with a calendar entry
Minibus attaches a `.ics` to the duty email, **timed to the real start**, with a 24-hour alarm. An all-day entry put the alarm at midnight. Its reminders are spaced so that no two land within two hours of each other.

**Adapt:** `.ics` on the Ushers duty reminder email, timed to the event's `start_time`.

### 4.7 An alerts inventory in the README, with the "diary" test
Minibus lists **every alert** by who gets it, when, why, and whether a test would catch its removal. It also has a short list of what is **deliberately not alerted**, so nobody files those as bugs.

Its `22-diary.mjs` walks one person through one whole Sunday, hour by hour. Four faults in a row were "right answer, wrong hour", and every other test had pinned the hour its author was thinking of.

**Adapt:** an alerts table in the Ushers README. Then a diary test of one usher through a Sunday: Home and notifications at 07:00, during the service, after submit, after countersign, and the evening.

### 4.8 Monthly and yearly summary emails, and PDFs saved to Drive
Minibus sends a weekly summary, a monthly one after the last Sunday of each month, and a yearly one. Its PDFs are saved to a Drive folder that isn't shared.

**Ushers today:** "Summary emails are still future" (`docs/DRIVER-APP-REUSE.md`). The PDF summary exists in Admin → Reports.

**Adapt:** a monthly summary to the Head Usher and Assistant (attendance and reports). A separate dues summary would go to the Treasurer, keeping the Treasurer boundary.

### 4.9 "Who to ring today", with a one-day override
Minibus shows the emergency contact on every screen. **Change** hands it to someone else for **Today only** or **Until changed back**, and everyone affected is told.

**Adapt (to discuss):** an "In charge today" line for when the Head Usher is away, so ushers know who to go to. Whether it should also lend approval rights for the day is your call. I'd keep it to the contact only.

### 4.10 Browser checks proven by sabotage (later)
`tests/browser/sabotage.mjs` takes each fix back out of a scratch copy and checks that the test written for it goes red.

**Ushers today:** `tests/browser/journey.mjs` photographs the journey. This is worth doing once Ushers has had a few real bug fixes to guard.

### 4.11 Later, when Ushers is live
- **Archive at 3am:** old rows move to `<tab> (archive)`. The Ushers sheet is small for now.
- **An ushers' handbook PDF and short videos**, like `manual/` and `video/`. Only when you say so, as with the Driver's Manual.

---

## 5. Not for Ushers

- Everything about transport: stops, ETA, geofence auto-end, walkarounds, vehicle log, MOT, bookings, the passenger page.
- **The shelf** (the Worker caching what Apps Script built). Ushers' Worker owns the data, so there's nothing slow to cache.
- **Sheet edits flowing back to phones** (`onEditLive`, `coord_actions`). Ushers' sheet is a record, not where the department is run. That is the right choice.
- **The rehearsal** (test rounds on the live server). Ushers' "test people and a sample week" fits better, because ushering has no live run to rehearse.
- **A shared `PIN_SALT` between the sheet and the Worker.** Ushers keeps PINs on the server only, which is better.
- **The PIN carried in session storage between apps.** Ushers' shared session token already does this better.

---

## Top recommendations

1. **Tell ushers when they're taken off a duty** (4.3). It's a real gap: today they would still turn up.
2. **Quiet hours for pushes** (4.2), so nobody's phone buzzes at midnight for a message.
3. **The three cheap tests** (2.1 to 2.3) and **the plain-wording sweep** (2.4), in one PR.
4. **Per-release deploy notes in the Minibus format** (2.5), starting with the next release.
5. **A stronger Check everything** (4.1), naming who has no alerts and who can't be reached.
6. **Email deep links** (4.4) and **swap/cover requests** (4.5), as the next features to talk about.
