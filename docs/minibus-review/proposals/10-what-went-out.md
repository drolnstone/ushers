# 10. What went out, for the Head Usher

**Why.** After Admin → Message or a reminder run, nobody can see whether it
went or how many it reached. Minibus lists every push and email on the
coordinator's Alerts screen, one line each, never unread
(`54-what-went-out.mjs`), and puts one notification per batch on each
coordinator's phone, "what went and how many it reached", including a
batch that reached nobody (`58-send-trail.mjs`).

**Size.** Medium. Worker and Admin App. Bump app and server.

## Files
- `server/worker.js`: `pushPending` (count phones woken per notification
  type), `aMessage`-style admin send (search `admin_message`),
  `clockTick` reminders, `emailUnalerted`.
- `server/schema.sql`: a small `sent_log` table (`at`, `kind` push|email,
  `type`, `title`, `to_count`, `reached`).
- `admin/index.html`: a "Sent" list on the Notifications tab.
- New test suite.

## Steps
1. Log one row per batch: an admin Message, each reminder run, each
   `emailUnalerted` run, each `pushPending` run with phones woken.
2. Admin Notifications gets a "Sent" section: the last 14 days, newest
   first, "Message: Retreat · 31 people · 24 phones · 7 emails".
3. After an admin Message, the sender gets one notification
   "Sent to 31: 24 phones, 7 emails, 0 unreachable", unread like any other.
   Reminder runs do not notify; they only list.
4. Readable by `admin.app` holders only. No money figures in any line.

## Acceptance checks
- An admin Message to 3 ushers (2 with phones, 1 email only) lists one
  line with 2 phones and 1 email, and tells the sender.
- A run that reached nobody still lists a line with 0.
- A plain usher cannot read the list.
- Tests READY.
