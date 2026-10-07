# 14. An alerts table in the README, and the diary test

From the walkthrough, 4.7.

**Why.** Minibus lists every alert by who gets it, when, why, how, and
whether a test would catch its removal (its README "Every alert in the
app"), plus a short list of what is deliberately not alerted, so nobody
files those as bugs. Its `22-diary.mjs` walks one person through one whole
Sunday hour by hour: four faults in a row there were "right answer, wrong
hour", which every other test had missed.

**Size.** Small to medium. README and tests only, no version bump unless
the diary finds a fault.

## Files
- `README.md`: new section "Every alert" after "Phone alerts".
- New `tests/suites/90-diary.mjs`, using the fixed-clock pattern in the
  existing suites (`process.env.TZ` is already London in the runner).

## Steps
1. Find every `stNotify(` and `remind(` call in `server/worker.js` and every
   `@email` row. For each write one table row: What (title) · Who · When ·
   How (app, push, email) · Why · Test (suite name, or "none").
2. Add "Deliberately not alerted" below it, e.g. the person who filed a
   report is not told of their own report; reminders skip cancelled events.
3. The diary: one usher on First Service and one counter on Second
   Service, for a Sunday. Step the clock through Saturday 18:00 (duty
   reminder), Sunday 07:00, 09:00 (service), 12:00, 15:00 (report reminder
   if not submitted), after submit, after countersign, 21:30 (quiet hours,
   if brief 02 is in). At each step assert Home's first card, the unread
   count, and which pushes and emails went.
4. Any row in the table marked "none" gets a test, or stays marked.

## Acceptance checks
- Every alert the Worker can send has a row.
- Moving `reminder_hour` to 23 makes the diary fail.
- Tests READY.
