-- The schema as it stood at server w0.3.5 (commit 4a5dc03), kept on
-- purpose: a live database can still look like this, so the Worker has to
-- bring it up to date by itself. Never refresh this file to match the
-- current schema; add a newer fixture only when this one can no longer be
-- a live state.
-- ==========================================================================
-- Ushering App, D1 schema
--
-- The Worker owns the live data. Every material change also adds a row to
-- `outbox`, which Apps Script drains onto the Google Sheet: the historical
-- record. Nothing flows back from the sheet.
--
-- Money is held in pence (whole numbers). Dates are London dates, YYYY-MM-DD.
-- Moments are milliseconds since 1970 (UTC).
--
-- A new database: paste this whole file into the D1 console and run it, or
--   wrangler d1 execute ushers --file=server/schema.sql --remote
-- Safe to run twice.
-- ==========================================================================

-- ---- people --------------------------------------------------------------

-- U001, U002 ... are internal. The apps show full_name; names are never keys.
CREATE TABLE IF NOT EXISTS ushers (
  id          TEXT PRIMARY KEY,
  full_name   TEXT NOT NULL,
  email       TEXT DEFAULT '',
  phone       TEXT DEFAULT '',
  active      INTEGER DEFAULT 1,
  -- PIN: PBKDF2-SHA-256 over (PIN_PEPPER + pin) with this user's own salt.
  -- The PIN itself is never stored. NULL hash means no PIN set yet.
  pin_salt    TEXT,
  pin_hash    TEXT,
  pin_iter    INTEGER,
  pin_set_at  INTEGER,
  created_at  INTEGER,
  updated_at  INTEGER
);

-- Additive: one row per role held.
-- usher | head_usher | assistant_head_usher | treasurer | system_admin
CREATE TABLE IF NOT EXISTS user_roles (
  usher_id    TEXT NOT NULL,
  role        TEXT NOT NULL,
  granted_by  TEXT,
  granted_at  INTEGER,
  PRIMARY KEY (usher_id, role)
);

-- Only the SHA-256 of the token is kept, so a copy of this table opens nothing.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  usher_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_usher ON sessions(usher_id);

-- Three wrong PINs, then a pause. Counted here, not on the phone.
CREATE TABLE IF NOT EXISTS pin_failures (
  usher_id     TEXT PRIMARY KEY,
  count        INTEGER DEFAULT 0,
  first_at     INTEGER,
  locked_until INTEGER
);

-- Rules, as JSON values. Defaults live in worker.js; a row here overrides.
CREATE TABLE IF NOT EXISTS config (
  k           TEXT PRIMARY KEY,
  v           TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  INTEGER
);

-- Sequences for readable ids (U001, R0001 ...).
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  n    INTEGER NOT NULL
);

-- ---- services and events -------------------------------------------------

-- One engine for every kind of event. A Sunday is two events (First and
-- Second Service) sharing sunday_key.
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,       -- key into config event_types
  title         TEXT NOT NULL,
  date          TEXT NOT NULL,       -- London date
  start_time    TEXT DEFAULT '',     -- "10:00"
  sunday_key    TEXT DEFAULT '',     -- the Sunday it belongs to, if any
  thanksgiving  INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'scheduled',  -- scheduled | cancelled
  notes         TEXT DEFAULT '',
  created_by    TEXT,
  created_at    INTEGER,
  updated_at    INTEGER
);
CREATE INDEX IF NOT EXISTS events_date ON events(date);
CREATE UNIQUE INDEX IF NOT EXISTS events_sunday_type ON events(sunday_key, type) WHERE sunday_key <> '';

-- Who is on duty. Removing someone marks the row, it is never deleted.
CREATE TABLE IF NOT EXISTS appointments (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL,
  usher_id    TEXT NOT NULL,
  duty        TEXT NOT NULL,         -- ushering | counting | ...
  status      TEXT DEFAULT 'active', -- active | removed
  created_by  TEXT,
  created_at  INTEGER,
  removed_by  TEXT,
  removed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS appointments_event ON appointments(event_id);
CREATE INDEX IF NOT EXISTS appointments_usher ON appointments(usher_id);
-- Being on the First Service AND counting at the Second is fine (different
-- events); being on the same duty at the same event twice is not.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_once
  ON appointments(event_id, usher_id, duty) WHERE status = 'active';

-- ---- reports -------------------------------------------------------------

-- One report per event: one submitter, optional second-person verification.
-- draft | submitted | pending_countersignature | verified
CREATE TABLE IF NOT EXISTS reports (
  id                      TEXT PRIMARY KEY,
  event_id                TEXT NOT NULL UNIQUE,
  status                  TEXT NOT NULL DEFAULT 'draft',
  submitter_id            TEXT,
  countersigner_id        TEXT,
  countersign_required    INTEGER DEFAULT 1,
  male                    INTEGER DEFAULT 0,
  female                  INTEGER DEFAULT 0,
  children                INTEGER DEFAULT 0,
  attendance_total        INTEGER DEFAULT 0,
  offering_total          INTEGER DEFAULT 0,  -- pence
  notes                   TEXT DEFAULT '',
  ministration_json       TEXT DEFAULT '{}',  -- the ministration record, by config key
  submission_id           TEXT UNIQUE,
  submit_signature        TEXT DEFAULT '',
  submitted_at            INTEGER,
  submit_pin_check        TEXT DEFAULT '',    -- server | device
  countersign_auth_id     TEXT,               -- the temporary authority used
  countersign_submission_id TEXT UNIQUE,
  countersign_signature   TEXT DEFAULT '',
  countersigned_at        INTEGER,
  countersign_pin_check   TEXT DEFAULT '',
  verified_at             INTEGER,
  version                 INTEGER DEFAULT 1,
  created_at              INTEGER,
  updated_at              INTEGER
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status);

-- Structured denomination entries. Kept after totals are worked out.
CREATE TABLE IF NOT EXISTS offering_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     TEXT NOT NULL,
  line_no       INTEGER NOT NULL,
  category      TEXT NOT NULL,
  currency      TEXT NOT NULL,
  denomination  INTEGER NOT NULL,   -- pence
  quantity      INTEGER NOT NULL,
  amount        INTEGER NOT NULL    -- pence, denomination x quantity
);
CREATE INDEX IF NOT EXISTS offering_report ON offering_entries(report_id);

-- Every status change, never overwritten.
CREATE TABLE IF NOT EXISTS report_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id   TEXT NOT NULL,
  at          INTEGER NOT NULL,
  actor_id    TEXT,
  from_status TEXT,
  to_status   TEXT,
  note        TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS report_history_report ON report_history(report_id);

-- An amendment never overwrites: the version it replaces is kept here whole
-- (the report row, its offering lines and its ministration record).
CREATE TABLE IF NOT EXISTS report_versions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id            TEXT NOT NULL,
  version              INTEGER NOT NULL,
  snapshot_json        TEXT NOT NULL,
  replaced_at          INTEGER NOT NULL,
  replaced_by          TEXT NOT NULL,
  reason               TEXT DEFAULT '',
  amend_submission_id  TEXT UNIQUE      -- made on the phone; a retry is filed once
);
CREATE UNIQUE INDEX IF NOT EXISTS report_versions_once ON report_versions(report_id, version);

-- ---- one authorisation engine --------------------------------------------

-- A request for ONE transaction: countersign this report, submit for this
-- event, take over this duty. Approval never changes anybody's roles.
-- pending | approved | rejected | consumed | cancelled
CREATE TABLE IF NOT EXISTS authorisations (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,      -- countersign | report_submission | duty_takeover
  subject_id    TEXT NOT NULL,      -- who would be authorised
  target_type   TEXT NOT NULL,      -- report | event | appointment
  target_id     TEXT NOT NULL,
  requested_by  TEXT NOT NULL,
  reason        TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending',
  decided_by    TEXT,
  decided_at    INTEGER,
  decision_note TEXT DEFAULT '',
  consumed_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_target ON authorisations(target_type, target_id);
CREATE INDEX IF NOT EXISTS auth_status ON authorisations(status);

-- ---- notifications -------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  usher_id    TEXT NOT NULL,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT DEFAULT '',
  ref_type    TEXT DEFAULT '',
  ref_id      TEXT DEFAULT '',
  created_at  INTEGER NOT NULL,
  read_at     INTEGER,
  emailed     INTEGER DEFAULT 0,
  dedupe      TEXT UNIQUE,         -- stops a reminder going twice
  pushed_at   INTEGER              -- sent to the person's phones
);
CREATE INDEX IF NOT EXISTS notifications_usher ON notifications(usher_id, read_at);

-- Phones with alerts switched on. The push carries nothing; the phone asks
-- what it is for (push.what) with its endpoint. 404/410 from the push
-- service removes the row.
CREATE TABLE IF NOT EXISTS push_subs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usher_id    TEXT NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,
  created_at  INTEGER,
  seen        INTEGER,
  fails       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subs_usher ON push_subs(usher_id);

-- ---- dues (Treasurer) ----------------------------------------------------

-- Each payment kept on its own. A mistake is voided, never deleted.
CREATE TABLE IF NOT EXISTS dues_payments (
  id           TEXT PRIMARY KEY,
  usher_id     TEXT NOT NULL,
  paid_on      TEXT NOT NULL,       -- London date
  year         INTEGER NOT NULL,    -- the dues year it counts towards
  amount       INTEGER NOT NULL,    -- pence
  method       TEXT DEFAULT '',
  note         TEXT DEFAULT '',
  recorded_by  TEXT NOT NULL,
  recorded_at  INTEGER NOT NULL,
  voided_by    TEXT,
  voided_at    INTEGER,
  void_reason  TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS dues_usher_year ON dues_payments(usher_id, year);

-- ---- audit ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit (
  id           TEXT PRIMARY KEY,
  at           INTEGER NOT NULL,
  actor_id     TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT DEFAULT '',
  target_id    TEXT DEFAULT '',
  before_json  TEXT DEFAULT '',
  after_json   TEXT DEFAULT '',
  reason       TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_target ON audit(target_type, target_id);

-- ---- to the sheet --------------------------------------------------------

-- One row per thing the sheet should record. tab '@email' is an email for
-- Apps Script to send. mode: append | upsert (by key_header = key_value).
CREATE TABLE IF NOT EXISTS outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tab         TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'append',
  key_header  TEXT DEFAULT '',
  key_value   TEXT DEFAULT '',
  row_json    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  claim       TEXT,
  claimed_at  INTEGER,
  done_at     INTEGER
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(done_at, id);

-- Small facts the Worker keeps for itself (last knock, last clock tick).
CREATE TABLE IF NOT EXISTS settings (
  k  TEXT PRIMARY KEY,
  v  TEXT
);
