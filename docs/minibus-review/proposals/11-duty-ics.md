# 11. Calendar file on duty reminders

**Why.** Minibus attaches a `.ics` to "You are driving", timed to the real
start, with an alarm. An all-day entry put the alarm at midnight, so it
times every entry. Ushers duty reminders and "You are on duty" carry no
calendar entry.

**Size.** Small. Worker and Code.gs mail. Bump server and sheet.

## Files
- `server/worker.js`: `clockTick` duty reminders and `aRotaSet`'s
  "You are on duty". The email row on the outbox (`stOutbox(env, "@email", …)`).
- `Code.gs`: `sendMail()` and the `@email` drain (attach the `.ics`).
- Events need a start time: check `events.start_time` in `schema.sql`;
  fall back to the event type's default time in config.
- New test suite and an extension of `30-sheet.mjs`.

## Steps
1. Add an optional `ics` field to `@email` rows: `{ uid, start, end, title, location }`
   with London times.
2. `Code.gs` builds the file (`BEGIN:VCALENDAR`, `TZID:Europe/London`, a
   `VALARM` 24 hours before, `UID` = appointment id so a re-send updates,
   not duplicates) and attaches it as `duty.ics`.
3. Set it on duty emails only, and only when the event has a time.
4. On removal or cancellation (brief 01), send `METHOD:CANCEL` with the
   same `UID` if emailing.

## Acceptance checks
- A duty email for First Service at 09:00 carries an `.ics` starting 09:00
  London, alarm the day before.
- Re-sending for the same appointment keeps the same UID.
- An event with no time sends no `.ics`.
- Tests READY.
