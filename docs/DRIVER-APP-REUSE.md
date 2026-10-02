# What the Ushering App takes from the Driver App

The Driver App is `drolnstone/minibus-check` (RCCG Dominion Assembly Transport):
three phone web apps on GitHub Pages, a Cloudflare Worker with a D1 database,
and a Google Sheet driven by Apps Script (`Code.gs`). Checked against its code
on `main` at app v1.95.2 · server w2.37.0 · sheet v1.101.0 (2 October 2026).

Nothing in that repository is changed by this work. Code that was copied is
marked at the top of the copy.

| Key | Meaning |
|---|---|
| **REUSE** | Taken as it is (copied, with a note saying where from) |
| **ADAPT** | Same design and much of the same code, changed for ushering |
| **REPLACE** | The Driver App's way does not meet the Ushering spec, so it is done differently |
| **NEW** | The Driver App has nothing like it |

## The shape

| Part | Driver App | Ushering App | Class |
|---|---|---|---|
| Hosting of the pages | GitHub Pages, no build step, plain HTML/JS | Same | **REUSE** |
| Fast server | Cloudflare Worker `server/worker.js` | Same, new file `server/worker.js` | **ADAPT** |
| Database | D1, `server/schema.sql`, safe to run twice | Same pattern, new tables | **ADAPT** |
| Historical record | Google Sheet + Apps Script `Code.gs` | Same | **ADAPT** |
| Who owns what | Sheet owns rota/drivers; Worker owns Sunday activity and drains it to the sheet | Worker owns all live data; the sheet is the historical record, written through the same drain. The spec says the sheet is not the admin interface, so nothing flows back from it | **ADAPT** |
| Coordinator app as a second page | `coord/index.html`, no service worker, reads live | `admin/index.html`, same rules | **ADAPT** |

## Areas the spec asked about

| Area | Driver App | Ushering App | Class |
|---|---|---|---|
| **Authentication** | Pick a name from a list, 4-digit PIN. One SHA-256 of `PIN_SALT:name:pin` with a single shared salt held in Script Properties and a Worker variable. Three tries then five minutes, counted in the Worker | Pick a name, PIN. **Per-user random salt** and PBKDF2-SHA-256 (iterations stored per user so they can be raised), plus an optional server-side `PIN_PEPPER` secret. Same three-tries-five-minutes lockout, counted in the Worker. Login also accepts the Driver App's rule that the PIN puts a name on a record | **REPLACE** (hashing) / **REUSE** (lockout rule) |
| **Sessions** | None. The coordinator app keeps the PIN in memory and sends it on every call; it forgets after 15 idle minutes | Real sessions: a random token, stored only as a SHA-256 hash in D1, with idle and absolute expiry. Every call re-reads the user's current roles, so a role removed takes effect on the next call. Signing (submit, countersign, approve) still asks for the PIN | **NEW** |
| **App switching** | Driver app shows a Coordinator button by role; the coordinator app asks for the PIN again | Both apps on one origin share one session token, so Ushers App → Admin App and back needs no second login. The Admin App asks the server (`me`) and refuses without `admin.app` | **ADAPT** |
| **Server/intermediary** | One Worker, `action` in a JSON body, `json()` helper, CORS open, `SHEET_TOKEN` guarding sheet-only calls | Same idea: `POST /api/<action>` with JSON, bearer session token, `SHEET_TOKEN` for the sheet's calls. Permission checks in the Worker for every action | **ADAPT** |
| **Google Sheets communication** | Worker keeps rows with `synced` flags. Apps Script drains them (`drain` / `drained`), a knock (`drainnow`) after each write and a five-minute timer underneath. Each drain stamps what it took and only stamped rows are marked done | Same drain, simplified to one `outbox` table: each material change adds a row naming the tab, the key header and the values. Apps Script pulls with a claim, writes, then acknowledges. Knock after each write, timer underneath | **ADAPT** |
| **Header-driven access** | `headerMap()`, `colOf()`, `colsHard()`, `colsSoft()`; missing headers added at the end, never relabelled | Same functions and rule. Every row arrives keyed by header (`USHER_ID`, `FULL_NAME`, `REPORT_ID`…), so moving columns breaks nothing | **REUSE** |
| **Sheet protection** | Every tab protected *warning-only* and permanently, header rows locked, relocked at 3am, health check names unlocked tabs | Every tab **strictly** protected (owner only). A write unlocks only the tabs it needs, writes, and re-protects in a `finally`. The unlock time is recorded and a timer re-protects anything left open longer than `UNLOCK_MAX_MINUTES` (5). Health check names unprotected tabs, as before | **ADAPT** |
| **Notifications** | Web Push (VAPID) from the Worker, per-phone subscriptions; coordinator alert inbox | In-app notification centre (D1 `notifications`, read/unread, type, link to the record). Since v0.2.0, Web Push reuses the Driver App's `b64url`, `vapidKeys`, `vapidAuth`, `pushOne` and its empty-payload "phone asks what for" design (`push.what`), and its `sw.js` push and notificationclick handlers; the VAPID `sub` is this Worker's own address | **NEW** (centre) / Push **REUSE** |
| **Email** | `sendMail()` in Code.gs adds `SENDER_NAME` and reply-to; addresses in Script Properties | Same `sendMail()`. Important notifications are put on the outbox as email rows and Apps Script sends them | **REUSE** |
| **Approval workflows** | Authorising a stopped bus (role + own PIN, lifts only that one check), email decision links | One authorisation engine for countersignature authority and duty changes. A request names one transaction; approval creates a temporary authority for that transaction only, marked consumed once used, never touching the person's roles | **ADAPT** (the "names the check it lifts and no other" rule) |
| **Offline/retry** | `localStorage` queue, walked one item at a time, an item removed only once the server has it, ids made on the phone so a retry is filed once | Same rules. Drafts autosave to the phone; a signed report with no signal is kept as "Saved on device — waiting for connection" and retried. A unique Submission ID made on the phone stops duplicates | **REUSE** (rules) / **ADAPT** (code) |
| **Dashboard components** | Coordinator app cards, refresh every 30 s | Coordinator dashboard: current or most recent Sunday (attendance, offering, reports received/outstanding, countersignatures pending, approvals) plus next Sunday's full rota | **ADAPT** |
| **Reporting** | PDF reports and summary emails | Reports are recorded on the sheet and totalled on the dashboard. Since v0.2.0, service report and period summary PDFs reuse `coord/pdf.js`'s layout engine (banner, tables split across pages, "Contains names", "Page x of y") and the same `jspdf.umd.min.js` (MIT), loaded only when a PDF is made. Summary emails are still future | **REUSE** (PDF) |
| **Europe/London time** | `tzOffsetMs`, `londonParts`, `londonKey`, `londonMoment`, `sundayKeyOf` | Copied | **REUSE** |
| **Audit** | `History` tab, append-only, before/after/why | `audit` table and `AUDIT` tab with timestamp, actor, action, target, before, after, reason | **ADAPT** |
| **Configuration** | `config.js` holds only addresses and switches; rules in Script Properties | `config.js` holds only the server address. Rules (dues, counters, Thanksgiving, event types, categories, denominations, timings) are in a `config` table with defaults in code, editable by a System Administrator | **ADAPT** |
| **Secrets** | `PIN_SALT`, `SHEET_TOKEN` in Script Properties and Worker variables; none in the public repo | Same rule. `SHEET_TOKEN`, `PIN_PEPPER`, `BOOTSTRAP_TOKEN` are Worker secrets; `SHEET_TOKEN`, `WORKER_URL` are Script Properties | **REUSE** |
| **Tests** | `node tests/run-tests.mjs`, Worker run against real SQLite through a D1 shim, Apps Script faked, GitHub Actions on London time | Same runner shape; `tests/lib/d1.mjs` and `tests/lib/t.mjs` copied | **REUSE** |
| **Versions on the foot** | app · server · sheet printed on every page | Same | **REUSE** |

## Driver App parts not used

Bus stops, ETA, bookings, walkarounds, vehicle log, rehearsal, MOT rules,
passenger page: transport-only, nothing to take.

## What is new for ushering

Ushers with U-codes, additive roles and server permissions, events with a
shared Sunday context, First Service rota, exactly two Second Service
counters, reports with a status lifecycle, attendance with a calculated
total, offering by denomination with calculated totals, countersignature,
transaction-specific authorisation, dues and the Treasurer boundary.

### Added in v0.2.0

| Area | Driver App | Ushering App | Class |
|---|---|---|---|
| **Home-screen icons** | PNG icons (180 apple-touch, 192, 512, maskable) with the church logo | Same sizes and the same `logo.png`, on each app's colour with USHERS or ADMIN beneath, made by `tools/make-icons.mjs` | **ADAPT** |
| **Report amendments** | none | Versioned amendments: the replaced version kept whole, a reason, signature and PIN, countersigned again; ushers need an approved request, approvers do not | **NEW** |
| **Ministration record** | none | Configurable ministration lines on every report | **NEW** |

