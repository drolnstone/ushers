# 01. Tell an usher they are off a duty, or the event is off

**Why.** Today `rota.set` tells someone added ("You are on duty: …") but
tells nobody removed, and `event.cancel` tells nobody at all. Both people
would still turn up. Minibus emails "You are no longer driving" and pushes
"Your route is not running today" first of everything.

**Size.** Small. Server only. Bump `SERVER_VERSION`.

## Files
- `server/worker.js`: `aRotaSet` (the loop `for (const a of current)` that
  sets `status='removed'`), `aEventCancel`, `DEFAULTS.email_types`.
- `tests/suites/`: new `85-off-duty.mjs` (copy the setup from
  `70-remove.mjs` or `60-countersign-notify.mjs`).
- `README.md`: the Rota bullet under "The journey".

## Steps
1. In `aRotaSet`, inside the removal loop, add
   `st.push(stNotify(env, cfg, await getUsher(env, a.usher_id), "duty", "You are no longer on duty: " + e.title, e.title + " on " + ukDate(e.date) + ". You have been taken off " + (duty === "counting" ? "offering counting." : "ushering."), "event", e.id));`
   Skip it when the event date is in the past (`e.date < londonKey(new Date())`)
   or the event is cancelled.
2. In `aEventCancel`, when cancelling (not `b.restore`), load the active
   appointments for the event and add one `stNotify` per usher, type
   `"duty"`: title "Cancelled: " + e.title, body e.title + " on " + date +
   " will not take place." On `b.restore`, notify the same people
   "Back on: " + e.title + ". You are on duty again." Only for events today
   or later.
3. Add `"duty"` to `DEFAULTS.email_types` only if Asim agrees (see the
   question below). Default: leave email types alone; the existing
   `emailUnalerted` already emails anyone with alerts off.
4. Each person once: the removed person who is also re-added in the same
   call is not told (the existing `ids.indexOf` check already handles it).

## Acceptance checks
- Removing B from First Service with `rota.set` gives B one notification
  "You are no longer on duty: …"; A, still on, gets nothing new.
- Cancelling an event notifies every active appointee once; restoring it
  notifies them once more; an event in the past notifies nobody.
- The person doing the change is still told if they are on the list (they
  may be changing their own duty from Admin).
- `node tests/run-tests.mjs` ends READY.

## Question for Asim (default in brackets)
Should duty changes also be emailed to people with alerts on? (No; the
app and phone alert are enough, and anyone with alerts off is emailed
already.)
