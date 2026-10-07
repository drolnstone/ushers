# 06. Deploy notes per release, and HANDOVER.md

**Why.** Asim pastes the Worker, pastes Code.gs and merges by hand. Minibus
gives him one note per release in a fixed shape, and a HANDOVER.md that
gets a fresh session up to speed. Both help most now that execution is
moving between sessions.

**Size.** Small. Docs only, no version bump.

Minibus examples: `DEPLOY.txt`, `analysis/DEPLOY-*.txt`, `HANDOVER.md`.

## Files
- New `docs/deploy/DEPLOY-<app>-<server>-<sheet>.txt` per release and a
  copy of the latest at `DEPLOY-LATEST.txt` in the repo root.
- New `HANDOVER.md` in the repo root.
- `DEPLOY.md`: a line under "Updating later" pointing at `DEPLOY-LATEST.txt`.
- `tests/suites/01-stamps.mjs` (brief 03), if built, checks the latest
  note's GOING TO line against the code.

## Steps
1. Write the note for the current state (app v0.3.12 · server w0.3.7 ·
   sheet v0.3.1) in this shape:
   ```
   USHERS
   ======
     app v… · server w… · sheet v…

   <what changed, one line each, in ushers' words>

   YOU ARE ON              GOING TO
     Pages   v…              v…   (merge)
     Worker  w…              w…   (paste | no change)
     Code.gs v…              v…   (paste and New version | no change)

   IN THIS ORDER
   1. <Worker paste, with the raw.githubusercontent.com link to the branch's server/worker.js>
   2. <Code.gs paste, link, then Deploy, Manage deployments, the pencil, New version, Deploy>
   3. Merge the pull request.

   AFTER IT
   A. <what the foot line should say>
   B. <one thing to try that shows the change>
   ```
2. Rules, written at the top of HANDOVER.md: only bump what moved; a
   number already handed over is spent; one PR per step; Claude never
   merges or deploys.
3. HANDOVER.md: what each part is and where it is live; versions on main;
   anything waiting for Asim to paste; how Asim works (reads every line,
   short replies, one PR per step, Minibus is the reference, System
   Administrator is access not authority); the PR list with one line each.
4. Every later brief's PR adds its own note and refreshes
   `DEPLOY-LATEST.txt`.

## Acceptance checks
- A fresh session given only HANDOVER.md can say what is live, what is
  pending and how to release.
- The note's versions match the code.
