# 15. Monthly summary emails, and PDFs kept in Drive

From the walkthrough, 4.8.

**Why.** Minibus sends a weekly summary, a monthly one after the last
Sunday of each month and a yearly one, and saves its report PDFs to a Drive
folder that is not shared. Ushers can make a summary PDF on demand (Admin
→ Reports, any period up to 400 days) but sends nothing by itself; `docs/DRIVER-APP-REUSE.md`
says "Summary emails are still future".

**Treasurer boundary.** Offering and dues figures go only to people who
hold the permission to see them (`offering.summary`, `dues.view_all`).
Asim, as System Administrator, gets no money figures by this route.

**Size.** Medium. Worker and Code.gs. Bump server and sheet. Ask Asim
the questions below first.

## Files
- `server/worker.js`: `clockTick` (the month-end trigger), a new
  `summaryFor(env, cfg, from, to, perms)` reusing whatever builds the
  Admin → Reports summary (search the summary action used by
  `shared/pdf.js`), `DEFAULTS` (`summary_roles`, `summary_day`).
- `Code.gs`: send the email; optionally build and save a PDF to a Drive
  folder (Minibus: `pdfFolder` one-time run, then `DriveApp`). Note the
  PDF is made on the phone in Ushers today; for Drive, either a plain
  HTML-to-PDF in Apps Script or skip the PDF and send figures in the email.
- New test suite.

## Steps
1. On the first clock tick after 19:00 London on the last Sunday of a
   month, build the month's summary: services held, attendance totals,
   reports filed, still pending countersignature, overdue.
2. Email it to `summary_roles` (default Head Usher and Assistant), without
   offering figures.
3. A separate offering and dues summary to the Treasurer (holders of
   `offering.summary`).
4. Once each (dedupe key `summary:<yyyy-mm>`).
5. Year: the same on the last Sunday of December.

## Acceptance checks
- On a fixed clock at the last Sunday 19:05, one summary email per
  recipient, once.
- The Head Usher's email carries no offering figures unless they hold
  `offering.summary`; the Treasurer's does.
- Tests READY.

## Questions for Asim (defaults in brackets)
1. Monthly only, or weekly too? (Monthly and yearly.)
2. Save PDFs in Drive? (No; email only for now.)
