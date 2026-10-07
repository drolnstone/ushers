# 02. Quiet hours for phone alerts

**Why.** An admin Message or an approval request wakes phones at any hour.
Minibus sends nothing from 21:00 to 08:00 except what cannot wait, and
tests every timed alert against those hours.

**Size.** Small. Server only. Bump `SERVER_VERSION`.

## Files
- `server/worker.js`: `DEFAULTS` (near `reminder_hour`), the config list
  that the Admin Settings screen edits (search `name: "email_report_filed"`
  to find the list), `pushPending`, `clockTick`, `emailUnalerted`.
- `tests/suites/`: new `86-quiet-hours.mjs`, using a fixed clock.
- `README.md`: the "Phone alerts" bullet.

## Steps
1. Add to `DEFAULTS`: `quiet_from: 21, quiet_to: 8,` and
   `urgent_types: ["countersign_request", "approval_request"]`. Expose
   `quiet_from` and `quiet_to` as numbers in Settings.
2. Add `function quietNow(cfg, at)` returning true when the London hour
   (`londonParts(at).hh`) is `>= quiet_from` or `< quiet_to`. Handle
   `quiet_from === quiet_to` as "off".
3. In `pushPending`: during quiet hours, select and mark only rows whose
   type is in `urgent_types`; leave the others with `pushed_at IS NULL`.
4. **Watch the window.** `pushPending` only looks back two hours
   (`since = Date.now() - 2 * 3600000`), so a message held from 21:00
   would be dropped at 08:00. Widen it to cover the quiet span, e.g.
   `since = Date.now() - (hoursOfQuiet + 2) * 3600000`, and test it.
5. At 08:00 the five-minute clock calls `pushPending` and the held ones go.
   Several held for one person become one push (the phone already asks
   `push.what`, which shows the newest and "(n more in the app)").
6. `emailUnalerted` follows the same rule: no email in quiet hours.
7. Reminders: `reminder_hour` (18) and `report_reminder_hour` (15) already
   sit outside quiet hours. Add a test that fails if either is moved into
   them.

## Acceptance checks
- An admin Message at 22:30 appears in the app at once, pushes nothing,
  and pushes once at 08:00.
- A countersign request at 22:30 pushes at once.
- A notification made at 21:05 is still pushed at 08:00 (the window
  check in step 4).
- `quiet_from = quiet_to` turns quiet hours off.
- Tests READY.
