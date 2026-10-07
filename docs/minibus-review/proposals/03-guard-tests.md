# 03. Three guard tests

**Why.** Cheap tests that catch the quiet failures Minibus kept hitting:
a cache name not bumped (phones keep the old page), a `$("id")` that finds
nothing (a button that never works), and a dead function whose comment
still describes a feature that is gone.

**Size.** Small. Tests only, no version bump (nothing ships to phones).

Minibus originals to read: `tests/suites/01-stamps.mjs`,
`02-elements.mjs`, `03-functions.mjs` in `drolnstone/minibus-check`
(public; `git clone --depth 1 https://github.com/drolnstone/minibus-check`).

## Files
- `tests/suites/01-stamps.mjs`, `02-elements.mjs`, `03-functions.mjs` (new).
- Possibly small fixes in `index.html`, `admin/index.html`,
  `shared/*.js`, `server/worker.js`, `Code.gs` for whatever they find.
  Any such fix bumps the matching version.

## Steps
1. **Stamps.** Fail unless `APP_VERSION` in `shared/core.js` equals
   `CACHE` in `sw.js` minus the `ushers-` prefix. If DEPLOY.md or a deploy
   note (brief 06) names versions, check those too: app, `SERVER_VERSION`
   in `server/worker.js`, `SHEET_VERSION` in `Code.gs`.
2. **Elements.** Collect every `getElementById("x")` / `$("x")` /
   `querySelector("#x")` in both pages and `shared/*.js`. Each id must
   appear as `id="x"` in markup or `id: "x"` in an `h(...)` call. Allow
   ids built at run time only through a short, named list.
3. **Functions.** Strip comments, then fail on any top-level `function`
   or `const` in `server/worker.js`, `Code.gs`, `shared/core.js`,
   `shared/reports.js`, `shared/pdf.js` that is never referenced. Entry
   points allowed: `doGet`, `doPost`, `onOpen`, `onEdit`, the Worker's
   default export, and names passed as strings to Apps Script triggers or
   menus (found by the scan).
4. Run them. Fix what they find in the same PR, or list it in the PR
   body if a fix is not obvious.

## Acceptance checks
- Changing `CACHE` in `sw.js` alone makes `01-stamps` fail.
- Renaming an element id in `index.html` alone makes `02-elements` fail.
- Adding an unused function with a comment makes `03-functions` fail.
- Tests READY on the PR head.
