# 09. Add Ushers to your phone

**Why.** Ushers never offers to install. On iPhone alerts do not work
until the app is on the Home Screen, so an usher who never installs is
never alerted. Minibus (`index.html` around 9919-10071,
`sunday/index.html` around 1646) shows a one-tap Install on Android
(`beforeinstallprompt`), a three-step sheet on iPhone, and puts install
before the alerts question so they do not race.

**Size.** Medium. Both apps, Worker, Admin → Ushers. Bump app and server.

## Files
- `shared/core.js`: next to the iOS/standalone check (search
  `display-mode: standalone`) and the alerts prompt.
- `index.html`, `admin/index.html`: after sign-in, before the alerts ask.
- `server/worker.js`: record installed per phone; add `installed` to the
  people list Admin → Ushers reads; `schema.sql` column.
- `admin/index.html`: "Not installed" chip beside "Alerts off" (search
  `"Alerts off"`), and a count "Installed: n of m".

## Steps
1. Catch `beforeinstallprompt` early in `shared/core.js` and keep it.
2. After sign-in, if not standalone: show "Add Ushers to your phone".
   Android: an Install button that calls the saved prompt. iPhone: three
   steps (Share, Add to Home Screen, open from the Home Screen). "Not now"
   hides it for this visit only, like the alerts ask.
3. Order: install first; the alerts question only once installed or after
   "Not now". On iPhone in Safari the alerts ask already says install
   first; keep one message, not two.
4. Each `me` call (or sign-in) sends `installed: true|false` for this
   device id; the Worker stores `installed_at` on the usher (any phone).
5. Admin → Ushers shows "Not installed" and the count. Check everything
   (brief 07) lists them under Still to do.
6. The Admin App gets the same offer with its own icon and manifest.

## Acceptance checks
- In a desktop Chrome tab, the offer shows after sign-in; opened as an
  installed app, it never shows.
- The alerts question never shows at the same moment as the install offer.
- After opening once installed, Admin → Ushers drops "Not installed".
- Tests READY; browser journey passes.

## Question for Asim (default in brackets)
Remind people who have not installed, by notification and email, at most
weekly? (Not now; the chip and Check everything first.)
