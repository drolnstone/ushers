# 08. A link in every email

**Why.** Ushers emails carry the title and body only (`stNotify` puts
`{ to, subject, body }` on the outbox). Minibus emails link to the record.
The push already knows the right page for each notification
(`push.what` builds `./#rep/<id>`, `./admin/#approvals`, and so on).

**Rule kept from Minibus:** "Looking costs nothing; only the PIN acts."
A link only opens the app. It never approves, signs or changes anything.

**Size.** Small. Worker only. Bump `SERVER_VERSION`.

## Files
- `server/worker.js`: `DEFAULTS` (add `app_url`), `stNotify`, the
  `push.what` handler (search `let url = "./#notes"`), `emailUnalerted`.
- New test suite.

## Steps
1. Add `app_url: "https://drolnstone.github.io/ushers/"` to `DEFAULTS` and
   the Settings list, so another church can change it.
2. Move the url choice in `push.what` into
   `function linkFor(cfg, n, isAdmin)` returning the relative path. Use it
   in `push.what` unchanged.
3. In `stNotify`, when emailing, append
   `"\n\nOpen: " + cfg.app_url + linkFor(...).replace(/^\.\//, "")`.
   `stNotify` is synchronous and has no roles; pass `isAdmin` false there
   and accept the Ushers App link (the Admin App link is one tap on). Or
   look up roles before building the batch if simple.
4. `emailUnalerted`: one email lists several notifications; add a link
   after each line.

## Acceptance checks
- A countersign-request email ends with a link to `…/ushers/#rep/<id>`.
- An approval-request email links to `…/ushers/admin/#approvals`.
- Opening a link signed out shows sign-in, then the record.
- No link has a token, PIN or action in it.
- Tests READY.
