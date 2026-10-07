# 12. "Can't make it": swap and cover

**Why.** `duty_takeover` records after the fact that B did A's duty. An
usher cannot say beforehand "I can't make Sunday". Minibus has a Rota
Request: the driver asks, the coordinator decides from the app or an
email link, choosing the cover from a drop-down marked "already on that
Sunday" and "last served". Everyone affected is told.

**Size.** Large. Worker, both apps, sheet. Bump all three. Build only
after Asim answers the questions below.

## Lessons to keep from Minibus (README "Choosing the cover on the phone")
- Never tell the other person in a refused swap; they were never told it
  was proposed.
- Say "you are still on duty" only if the rota still has their name.
- Approving cover without naming one leaves the request "approved, cover
  to be arranged" and keeps the requester's name on the record, so it
  can be undone. Reminders read the appointment status, not the name.
- An answer to a request is sent whatever the date; the seven-day horizon
  is for unprompted duty changes only.

## Files
- `server/worker.js`: reuse the one authorisation engine (search
  `duty_takeover` and the `authorisations` actions) with a new kind
  `duty_release`; `aRotaSet` logic for the replacement.
- `index.html`: Home duty card gets "I can't make it" (reason, optional
  suggested cover).
- `admin/index.html`: Approvals shows it with a cover picker listing active
  ushers marked "on duty that day" and "last served <date>".
- `Code.gs` and the `AUTHORISATIONS` tab: nothing new beyond the kind.
- Tests: a suite per path (approve with cover, approve without cover,
  refuse, withdraw).

## Steps
1. Usher asks: creates an authorisation `duty_release` for the
   appointment; approvers are told (urgent type, so it passes quiet hours).
2. Approver decides with PIN. Approve with cover: the appointment moves as
   `duty_takeover` does today; requester and cover told. Approve without
   cover: appointment `status='released'`, requester told, Head Usher's
   dashboard shows the gap. Refuse: requester told "You are still on
   duty" only if they still are.
3. Second Service: a release that leaves fewer than
   `second_service_counters` shows as a gap on the dashboard and in Check
   everything (brief 07).

## Acceptance checks
- Each path above leaves the rota, notifications and audit as described.
- A refused request tells nobody but the requester.
- Tests READY.

## Questions for Asim (defaults in brackets)
1. Can an usher name their own cover, who then accepts? (No; the Head
   Usher picks.)
2. Is there a cut-off, e.g. no requests after Saturday 18:00? (No cut-off;
   late ones are marked late.)
