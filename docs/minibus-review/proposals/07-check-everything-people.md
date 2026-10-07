# 07. Check everything names people

**Why.** `healthLines()` in `Code.gs` checks properties, tabs, protection,
the server and its clock. It says nothing about people. Minibus sorts its
health report into **Needs attention**, **Still to do** and **Fine**,
names people ("No alerts yet for: …", "Alerts on: 7 of 9"), and uses the
same query to report as it uses to send, after a separate report query
once certified as fine the very silence it was built to catch.

**Size.** Medium. Worker and Code.gs. Bump server and sheet versions.

## Files
- `server/worker.js`: the `health` action (search `pinPepper: !!env.PIN_PEPPER`).
  Needs a people section, so it must require `SHEET_TOKEN` for that part
  (names are personal; the plain health answer stays public).
- `Code.gs`: `healthLines()` and whatever shows it (the Ushering menu).
- New `tests/suites/` suite; extend `30-sheet.mjs` for the sheet side.

## Steps
1. In the Worker, add `health.people` (only when the caller sends the
   sheet token) built from the **same** queries the sending code uses:
   - alerts off: the query behind `emailUnalerted` / the Admin "Alerts off"
     chip (active ushers with no row in `push_subs`);
   - unreachable: alerts off **and** no email;
   - next Sunday: Second Service short of `second_service_counters`, or
     nobody on First Service;
   - reports overdue: the query in `clockTick`'s report reminder, for past
     dates;
   - ushers still on the default PIN, if PIN changes record that.
   Factor each into one function used by both the sender and the report.
2. In `Code.gs`, group lines into three headed blocks. Needs attention:
   anything ✗ today, unreachable people, a short Sunday this week, overdue
   reports. Still to do: alerts off, default PIN. Fine: the rest, plus
   "Alerts on: n of m".
3. Only Needs attention counts as a fault (for any summary line or email).

## Acceptance checks
- An active usher with no phone and no email is named under Needs attention.
- An usher with alerts off but an email is named under Still to do.
- The coming Sunday with one counter shows under Needs attention.
- Removing the sender's query (e.g. changing `emailUnalerted`) changes
  the report too, because they share one function.
- The public `/api/health` still returns no names.
- Tests READY.
