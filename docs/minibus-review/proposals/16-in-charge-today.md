# 16. "In charge today"

From the walkthrough, 4.9. **Needs Asim's (and the Head Usher's) decision
before building.**

**Why.** Minibus shows the emergency contact on every screen
(`51-emergency-contact.mjs`). Change hands it to someone else for **Today
only** or **Until changed back**, and everyone affected is told. Ushers has
no line telling ushers who to go to when the Head Usher is away.

**Size.** Small to medium. Worker, both apps. Bump app and server.

## Files
- `server/worker.js`: a setting `in_charge` `{ usherId, until }`; an
  action `incharge.set` needing `rota.manage`; include it in the `me` or
  Home answer.
- `index.html`: a line on Home "In charge today: <name>" with a call link
  if a phone number is held.
- `admin/index.html`: Change, with Today only / Until changed back.
- New test suite.

## Steps
1. Default: the Head Usher. Set by Head Usher or Assistant.
2. Today only ends at midnight London.
3. On change, every usher on duty that day is told "In charge today: <name>".
4. **Contact only.** It never grants approval or any permission
   (the default; see the question).

## Acceptance checks
- Setting "Today only" shows the new name until midnight, then the Head
  Usher again.
- The person put in charge gains no permission.
- Tests READY.

## Questions for Asim (defaults in brackets)
1. Build it at all? (Yes, contact only.)
2. Should it lend approval rights for the day? (No.)
