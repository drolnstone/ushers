# 13. Repeating events and announcements

**Why.** From the 5 October ideas (project file
`minibus-review/ideas-signin-and-announcements.md`, part B). Admin →
Message already sends a title and message to everyone, in the app, as a
push and by email (search `admin_message` in `server/worker.js`). The
department also has fixed patterns: the prayer meeting on the first
Saturday of each month, the retreat in September. Thanksgiving Sunday is
already made by a rule in Settings, which is the pattern to extend.

**Size.** Large. Split into three PRs, in this order. Build only after
Asim answers the questions below.

## PR 13a. Repeating events
- `server/worker.js`: where Thanksgiving Sunday is generated (search
  `thanksgiving`), generalise to a list of rules in config:
  `{ title, type, rule: "first-saturday" | "nth-weekday:2:sun" | "last-friday" | "weekly:wed" | "yearly:09:first-saturday", time }`.
- Events made from a rule carry `rule_id` so a changed rule updates future
  events only.
- Admin → Settings: add, pause, delete a rule.
- Accept: the first Saturday of each month appears as Prayer Meeting
  17:00 for the next 12 months; editing the time moves only future ones.

## PR 13b. Reminder patterns per event type
- Config per event type: a list of offsets (e.g. `-6d 12:00`, `0d 09:00`,
  `0d 16:00`), sent to everybody or to a chosen role.
- Sent from `clockTick`, deduped with the existing `remind()` dedupe key,
  obeying quiet hours (brief 02).
- Accept: each reminder goes once; pausing the pattern stops it.

## PR 13c. Better Message screen
- Who: everybody · on duty this Sunday · First Service · counters · Head
  Ushers · chosen people.
- When: now, or later (a date and time, sent by `clockTick`).
- Pin to Home until a date.
- Seen by n of m (from `read_at`), with "Remind those who haven't".
- Accept: a message scheduled for 10:00 goes at the first tick after
  10:00, once; pinned shows on Home until its date.

## Later, not in these PRs
RSVP ("I'll be there" / "Can't make it") and an `.ics` per announcement
(reuse brief 11's builder).

## Questions for Asim (defaults in brackets)
1. Who may send announcements? (Head Usher and Assistant, as today. The
   System Administrator only for test messages.)
2. Repeating reminders by email to everyone, or only to people with alerts
   off? (Only alerts off, as today.)
3. The real patterns: prayer meeting day and time, retreat dates.
   (First Saturday 17:00; retreat first Saturday of September.)
