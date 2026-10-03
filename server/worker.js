/* ==========================================================================
   USHERING APP — Cloudflare Worker

   The server for the Ushers App and the Admin/Coordinator App. It is the
   authority: it checks every session, every PIN and every permission. The
   pages only decide what to show; hiding a button is never the lock.

   Same shape as the Driver App's Worker (drolnstone/minibus-check):
   D1 bound as DB, JSON in and out, Europe/London calendar, and the Google
   Sheet as the record, written by Apps Script draining `outbox`.

   Secrets live in Worker variables, never in this public file:
     PIN_PEPPER       required. Mixed into every PIN hash. Without it every
                      PIN is refused (and the health check says so).
     SHEET_TOKEN      required for the sheet. Same value as the Apps Script
                      property of the same name.
     BOOTSTRAP_TOKEN  optional. Lets the very first System Administrator be
                      made. Remove it once that is done.
     SHEET_WEBAPP_URL optional. The Apps Script web app, knocked after a
                      write so the sheet updates in seconds.
     ALLOWED_ORIGINS  optional. Comma list of page origins. Blank means any.
     PIN_ITERATIONS   optional. PBKDF2 rounds for new PINs (default 20000).
   ========================================================================== */

const SERVER_VERSION = "w0.3.5";

/* ==========================================================================
   CONFIGURATION — defaults. A row in the config table overrides a key.
   Everything a church might want to change is here, not in code below.
   ========================================================================== */

const DEFAULT_CONFIG = {
  dues_monthly_pence: 500,            // £5 a month
  dues_annual_pence: 6000,            // £60 a year
  dues_carry_forward: "none",         // future: rules for carrying balances
  second_service_counters: 2,         // exactly this many counters
  thanksgiving_rule: "first_sunday",  // first_sunday | none
  /* Every report is the whole record of the service: attendance,
     ministration and offering. A church that wants less can switch a part
     off here. Only First and Second Service are countersigned: the second
     person confirms the report is true. Any other event's report is filed
     as soon as it is signed. */
  event_types: {
    SUN_FIRST:   { label: "Sunday First Service",  sunday: 1, start: "09:00", duty: "ushering", attendance: true, ministration: true, offering: true, countersign: true },
    SUN_SECOND:  { label: "Sunday Second Service", sunday: 2, start: "11:30", duty: "counting", attendance: true, ministration: true, offering: true, countersign: true, exact: "second_service_counters" },
    NAMING:      { label: "Naming Ceremony", duty: "ushering", attendance: true, ministration: true, offering: true, countersign: false },
    PRAYER:      { label: "Prayer Meeting",  duty: "ushering", attendance: true, ministration: true, offering: true, countersign: false },
    VIGIL:       { label: "Vigil",           duty: "ushering", attendance: true, ministration: true, offering: true, countersign: false },
    THANKSGIVING:{ label: "Thanksgiving",    duty: "ushering", attendance: true, ministration: true, offering: true, countersign: false },
    WEDDING:     { label: "Wedding",         duty: "ushering", attendance: true, ministration: true, offering: true, countersign: false },
    FUNERAL:     { label: "Funeral",         duty: "ushering", attendance: true, ministration: true, offering: true, countersign: false },
    SPECIAL:     { label: "Special Service", duty: "ushering", attendance: true, ministration: true, offering: true, countersign: false },
    OTHER:       { label: "Other",           duty: "ushering", attendance: true, ministration: true, offering: true, countersign: false }
  },
  /* The ministration record: who ministered and what happened. kind is
     text or number. Add, rename or remove lines here; the key is what is
     stored, so keep a key once reports use it. */
  ministration_fields: [
    { key: "minister",      label: "Minister / preacher",        kind: "text" },
    { key: "sermon_title",  label: "Sermon title",               kind: "text" },
    { key: "bible_text",    label: "Bible text",                 kind: "text" },
    { key: "worship_leader",label: "Praise and worship leader",  kind: "text" },
    { key: "special",       label: "Special ministration",       kind: "text" },
    { key: "first_timers",  label: "First-timers",               kind: "number" },
    { key: "new_converts",  label: "New converts",               kind: "number" }
  ],
  offering_categories: ["Tithe", "Pledge", "Vow", "General Offering", "Other"],
  currencies: {
    GBP: { symbol: "£", denominations: [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] }
  },
  default_currency: "GBP",
  countersign_roles: ["head_usher", "assistant_head_usher"],
  countersign_rostered: true,         // anyone on duty at that event may countersign
  self_approval: false,               // may an approver decide somebody else's request about themselves?
  church_name: "RCCG Dominion Assembly",
  church_place: "Liverpool - Ushering Department",
  role_permissions: null,             // null = ROLE_PERMISSIONS below
  public_name_list: true,             // login screen lists names to pick from
  session_idle_hours: 12,
  session_max_days: 30,
  pin_min_length: 4,
  pin_max_length: 4,                  // PINs are exactly four digits
  pin_max_tries: 3,
  pin_lock_minutes: 5,
  offline_signing: true,              // a report signed with no signal may be sent later
  offline_max_hours: 72,
  duty_reminder_days: [2],            // days before an event
  reminder_hour: 18,                  // London hour reminders go
  report_reminder_hour: 15,           // on the event day
  rota_weeks_ahead: 8,
  push_types: null,                   // null = every notification also goes to phones with alerts on
  email_types: ["countersign_request", "approval_request", "approval_decision", "report_status", "report_filed", "dues_reminder", "admin_message"],
  report_notify_roles: ["head_usher", "assistant_head_usher"]  // told of every report once it is filed
};

/* Roles are additive: a person's permissions are the union of their roles'.
   Head Usher does NOT include any dues permission. */
const ROLES = ["usher", "head_usher", "assistant_head_usher", "treasurer", "system_admin"];
const ROLE_LABELS = {
  usher: "Usher", head_usher: "Head Usher", assistant_head_usher: "Assistant Head Usher",
  treasurer: "Treasurer", system_admin: "System Administrator"
};
const COORD_PERMS = ["admin.app", "dashboard.view", "rota.manage", "events.manage", "reports.view_all",
  "reports.submit_any", "reports.countersign", "exceptions.approve", "attendance.view",
  "offering.summary", "analytics.view", "notifications.send", "ushers.view", "ushers.manage", "roles.manage"];
const ROLE_PERMISSIONS = {
  usher: ["usher.app"],
  head_usher: COORD_PERMS,
  assistant_head_usher: COORD_PERMS,
  /* The Treasurer works inside the Ushers App (its Treasurer tab) and has
     no Admin App: that is for the Head Usher and Assistant Head Usher. */
  treasurer: ["usher.app", "treasurer.app", "dues.view_all", "dues.record", "dues.remind"],
  /* The System Administrator builds and runs the system (people, roles,
     settings, audit) and is not an approver: approvals stay with the Head
     Usher and Assistant Head Usher. To test a role, sign in as a test
     person who holds it (Admin -> Settings -> Testing). */
  system_admin: ["admin.app", "ushers.view", "ushers.manage", "roles.manage", "roles.grant_any",
    "config.manage", "audit.view"]
};
/* Without roles.grant_any a person may grant only these. Treasurer and
   System Administrator need a System Administrator. */
const ROLES_GRANTABLE = ["usher", "head_usher", "assistant_head_usher"];

/* ==========================================================================
   EUROPE/LONDON TIME — copied from the Driver App's worker.js. Workers run
   in UTC; every date here is a London date.
   ========================================================================== */

const TZ = "Europe/London";

function tzOffsetMs(date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const p = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  const asIfUTC = Date.UTC(+p.year, +p.month - 1, +p.day,
                           p.hour === "24" ? 0 : +p.hour, +p.minute, +p.second);
  return asIfUTC - date.getTime();
}

function londonParts(date) {
  const d = new Date(date.getTime() + tzOffsetMs(date));
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    hh: d.getUTCHours(), mi: d.getUTCMinutes(), ss: d.getUTCSeconds(), dow: d.getUTCDay()
  };
}

const p2 = (n) => (n < 10 ? "0" : "") + n;

function londonKey(date) {
  const p = londonParts(date);
  return p.y + "-" + p2(p.m) + "-" + p2(p.d);
}

/* "04/10/2026 10:15:00", London, for the sheet. */
function londonStamp(ms) {
  if (!ms) return "";
  const p = londonParts(new Date(ms));
  return p2(p.d) + "/" + p2(p.m) + "/" + p.y + " " + p2(p.hh) + ":" + p2(p.mi) + ":" + p2(p.ss);
}

function keyAddDays(key, n) {
  const [y, m, d] = String(key).split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.getUTCFullYear() + "-" + p2(x.getUTCMonth() + 1) + "-" + p2(x.getUTCDate());
}

function keyDow(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function validKey(key) {
  const s = String(key || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return keyAddDays(s, 0) === s;
}

/* The coming Sunday, or today when today is Sunday. */
function sundayOnOrAfter(key) { return keyAddDays(key, (7 - keyDow(key)) % 7); }
/* The most recent Sunday, or today when today is Sunday. */
function sundayOnOrBefore(key) { return keyAddDays(key, -keyDow(key)); }

/* First Sunday of the month: its day of the month is 1 to 7. */
function isThanksgiving(cfg, key) {
  if (cfg.thanksgiving_rule !== "first_sunday") return false;
  return keyDow(key) === 0 && Number(String(key).slice(8, 10)) <= 7;
}

/* ==========================================================================
   SMALL HELPERS
   ========================================================================== */

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status; this.code = code; this.extra = extra || null;
  }
}
const fail = (status, code, message, extra) => { throw new HttpError(status, code, message, extra); };

const enc = new TextEncoder();
function hex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => ("0" + b.toString(16)).slice(-2)).join("");
}
function hexBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function randomHex(nBytes) {
  const a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return hex(a);
}
async function sha256Hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(s))));
}
function sameHex(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const text = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || 200);
const wholeNum = (v, max) => {
  if (v === "" || v == null) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > (max || 1e9)) return NaN;
  return n;
};
const uuid = () => crypto.randomUUID();
const pounds = (pence) => Math.round(Number(pence || 0)) / 100;

/* ==========================================================================
   RESPONSES
   ========================================================================== */

function corsHeaders(env, request) {
  const allowed = String((env && env.ALLOWED_ORIGINS) || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request ? request.headers.get("origin") || "" : "";
  let allow = "*";
  if (allowed.length) allow = allowed.indexOf(origin) !== -1 ? origin : allowed[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST,GET,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    "vary": "origin"
  };
}

function json(obj, status, cors) {
  if (obj && typeof obj === "object" && !Array.isArray(obj) && obj.server === undefined) {
    obj.server = SERVER_VERSION;
  }
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json;charset=UTF-8", "cache-control": "no-store" }, cors || {})
  });
}

/* ==========================================================================
   CONFIG, IDS, AUDIT, OUTBOX
   ========================================================================== */

async function loadConfig(env) {
  const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  let rows = [];
  try { rows = (await env.DB.prepare("SELECT k, v FROM config").all()).results || []; } catch (e) {}
  for (const r of rows) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, r.k)) continue;
    try { out[r.k] = JSON.parse(r.v); } catch (e) {}
  }
  return out;
}

async function nextId(env, name, prefix, width) {
  const row = await env.DB.prepare(
    "INSERT INTO counters (name, n) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(name).first();
  return prefix + String(row.n).padStart(width, "0");
}

/* A statement that adds one row to the outbox. key = upsert by that header.
   Every tab has a key, so a drain that is cut off and pulled again writes
   the same row once rather than twice. */
function stOutbox(env, tab, row, keyHeader) {
  return env.DB.prepare(
    "INSERT INTO outbox (tab, mode, key_header, key_value, row_json, created_at) VALUES (?,?,?,?,?,?)"
  ).bind(tab, keyHeader ? "upsert" : "append", keyHeader || "",
         keyHeader ? String(row[keyHeader] == null ? "" : row[keyHeader]) : "",
         JSON.stringify(row), Date.now());
}

/* Audit: the table and the AUDIT tab, together. */
function stAudit(env, actorId, action, targetType, targetId, before, after, reason) {
  const id = uuid(), at = Date.now();
  const b = before == null ? "" : JSON.stringify(before);
  const a = after == null ? "" : JSON.stringify(after);
  return [
    env.DB.prepare(
      "INSERT INTO audit (id, at, actor_id, action, target_type, target_id, before_json, after_json, reason) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(id, at, actorId || "", action, targetType || "", String(targetId || ""), b, a, text(reason, 500)),
    stOutbox(env, "AUDIT", {
      AUDIT_ID: id, AT: londonStamp(at), ACTOR_ID: actorId || "", ACTION: action,
      TARGET_TYPE: targetType || "", TARGET_ID: String(targetId || ""), BEFORE: b, AFTER: a, REASON: text(reason, 500)
    }, "AUDIT_ID")
  ];
}

function stAuthLog(env, usherId, what, detail) {
  return stOutbox(env, "AUTH_LOG", { LOG_ID: uuid(), AT: londonStamp(Date.now()), USHER_ID: usherId || "", EVENT: what, DETAIL: text(detail, 200) }, "LOG_ID");
}

/* A notification, its sheet row, and an email when the type is important
   and the person has an address. */
function stNotify(env, cfg, usher, type, title, body, refType, refId, dedupe) {
  if (!usher) return [];
  const id = uuid(), at = Date.now();
  const email = cfg.email_types.indexOf(type) !== -1 && usher.email ? 1 : 0;
  const out = [
    env.DB.prepare(
      "INSERT INTO notifications (id, usher_id, type, title, body, ref_type, ref_id, created_at, emailed, dedupe) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(id, usher.id, type, text(title, 140), text(body, 1000), refType || "", String(refId || ""), at, email, dedupe || null),
    stOutbox(env, "NOTIFICATIONS", {
      NOTIFICATION_ID: id, USHER_ID: usher.id, FULL_NAME: usher.full_name, TYPE: type, TITLE: text(title, 140),
      REF_TYPE: refType || "", REF_ID: String(refId || ""), CREATED_AT: londonStamp(at)
    }, "NOTIFICATION_ID")
  ];
  if (email) {
    out.push(stOutbox(env, "@email", { to: usher.email, subject: text(title, 140), body: text(body, 1000) }));
  }
  return out;
}

async function run(env, statements) {
  const list = [statements].flat(Infinity).filter(Boolean);
  if (list.length) await env.DB.batch(list);
}

/* ==========================================================================
   PEOPLE, ROLES, PERMISSIONS
   ========================================================================== */

async function getUsher(env, id) {
  if (!id) return null;
  return await env.DB.prepare("SELECT * FROM ushers WHERE id=?").bind(String(id)).first();
}

async function rolesOf(env, usherId) {
  const r = await env.DB.prepare("SELECT role FROM user_roles WHERE usher_id=? ORDER BY role").bind(usherId).all();
  return (r.results || []).map((x) => x.role);
}

function permissionsFor(cfg, roles) {
  const table = cfg.role_permissions || ROLE_PERMISSIONS;
  const set = new Set();
  for (const r of roles) for (const p of (table[r] || [])) set.add(p);
  return set;
}

async function usherWithRoles(env, cfg, id) {
  const u = await getUsher(env, id);
  if (!u) return null;
  const roles = await rolesOf(env, u.id);
  return { usher: u, roles, perms: permissionsFor(cfg, roles) };
}

function need(me, perm) {
  if (!me.perms.has(perm)) fail(403, "forbidden", "You do not have permission for this.");
}

function usherRow(u, roles) {
  return {
    USHER_ID: u.id, FULL_NAME: u.full_name, EMAIL: u.email || "", PHONE: u.phone || "",
    ROLES: roles.map((r) => ROLE_LABELS[r] || r).join(", "), ACTIVE: u.active ? "YES" : "NO",
    PIN_SET: u.pin_hash ? "YES" : "NO", UPDATED_AT: londonStamp(u.updated_at || Date.now())
  };
}

async function namesMap(env) {
  const r = await env.DB.prepare("SELECT id, full_name FROM ushers").all();
  const m = {};
  for (const x of (r.results || [])) m[x.id] = x.full_name;
  return m;
}

/* Everyone with this permission, active. */
async function holders(env, cfg, perm) {
  const r = await env.DB.prepare(
    "SELECT u.*, group_concat(r.role) AS roles FROM ushers u JOIN user_roles r ON r.usher_id=u.id WHERE u.active=1 GROUP BY u.id"
  ).all();
  return (r.results || []).filter((u) => permissionsFor(cfg, String(u.roles || "").split(",")).has(perm));
}

/* The Head Usher and Assistant Head Usher (report_notify_roles) are told of
   every report once it is filed: as soon as it is signed when the event
   needs no countersignature, or when it is countersigned. Each one is kept
   in their notifications, on the NOTIFICATIONS tab, and emailed. Whoever
   did it, and anyone in skip (a submitter who is told already), are left
   out. */
async function stReportFiled(env, cfg, rec, e, title, lead, skip) {
  const roles = (Array.isArray(cfg.report_notify_roles) ? cfg.report_notify_roles : []).filter((x) => ROLES.indexOf(x) !== -1);
  if (!roles.length) return [];
  const r = await env.DB.prepare(
    "SELECT DISTINCT u.* FROM ushers u JOIN user_roles r ON r.usher_id=u.id WHERE u.active=1 AND r.role IN (" + roles.map(() => "?").join(",") + ") ORDER BY u.full_name"
  ).bind(...roles).all();
  const t = typeOf(cfg, e.type), facts = [];
  if (t.attendance) facts.push("attendance " + (rec.attendance_total || 0));
  if (t.offering) facts.push("offering " + (((cfg.currencies || {})[cfg.default_currency] || {}).symbol || "") + pounds(rec.offering_total).toFixed(2));
  const f = facts.join(", ");
  const body = lead + (f ? " " + f.charAt(0).toUpperCase() + f.slice(1) + "." : "");
  const st = [];
  for (const u of (r.results || [])) {
    if ((skip || []).indexOf(u.id) !== -1) continue;
    st.push(stNotify(env, cfg, u, "report_filed", title + ": " + e.title + " " + ukDate(e.date), body, "report", rec.id));
  }
  return st;
}

/* ==========================================================================
   PINS — per-user salt, PBKDF2-SHA-256, a secret pepper, a lockout
   ========================================================================== */

async function pinHash(env, pin, saltHex, iterations) {
  const pepper = String((env && env.PIN_PEPPER) || "");
  if (!pepper) fail(503, "pin_pepper_missing", "The server is not set up for PINs yet (PIN_PEPPER).");
  const key = await crypto.subtle.importKey("raw", enc.encode(pepper + ":" + pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexBytes(saltHex), iterations: iterations }, key, 256);
  return hex(bits);
}

function pinIterations(env) {
  const n = Number(env && env.PIN_ITERATIONS);
  /* Workers cap PBKDF2 at 100000. */
  return Number.isInteger(n) && n >= 1000 && n <= 100000 ? n : 20000;
}

function checkPinShape(cfg, pin) {
  const p = String(pin || "");
  if (!/^\d+$/.test(p) || p.length < cfg.pin_min_length || p.length > cfg.pin_max_length) {
    fail(400, "pin_shape", cfg.pin_min_length === cfg.pin_max_length
      ? "A PIN is exactly " + cfg.pin_min_length + " digits."
      : "A PIN is " + cfg.pin_min_length + " to " + cfg.pin_max_length + " digits.");
  }
  return p;
}

async function newPinFields(env, cfg, pin) {
  const p = checkPinShape(cfg, pin);
  const salt = randomHex(16), iter = pinIterations(env);
  return { pin_salt: salt, pin_hash: await pinHash(env, p, salt, iter), pin_iter: iter, pin_set_at: Date.now() };
}

/* The default PIN. A new usher starts on it and every reset drops back to
   it; at the next sign-in they are asked once whether to keep it. Ushers
   are told how it is made at onboarding; the apps never say. */
function phoneDefaultPin(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : "";
}

/* Throws on a wrong PIN or a lockout; returns quietly on a right one. */
async function verifyPin(env, cfg, usher, pin) {
  if (!usher.pin_hash) fail(403, "no_pin", "No PIN is set for this person. Ask the coordinator.");
  const now = Date.now();
  const f = await env.DB.prepare("SELECT * FROM pin_failures WHERE usher_id=?").bind(usher.id).first();
  if (f && f.locked_until && f.locked_until > now) {
    fail(423, "locked", "Too many tries. Wait " + cfg.pin_lock_minutes + " minutes.",
         { minutes: Math.ceil((f.locked_until - now) / 60000) });
  }
  const got = await pinHash(env, String(pin || "").replace(/\D/g, ""), usher.pin_salt, usher.pin_iter || pinIterations(env));
  if (sameHex(got, usher.pin_hash)) {
    if (f) await env.DB.prepare("DELETE FROM pin_failures WHERE usher_id=?").bind(usher.id).run();
    return true;
  }
  const windowMs = cfg.pin_lock_minutes * 60000;
  let count = (f && f.first_at && now - f.first_at < windowMs && !(f.locked_until && f.locked_until <= now)) ? f.count + 1 : 1;
  const first = count === 1 ? now : f.first_at;
  const locked = count >= cfg.pin_max_tries ? now + windowMs : null;
  await run(env, [
    env.DB.prepare(
      "INSERT INTO pin_failures (usher_id, count, first_at, locked_until) VALUES (?,?,?,?) " +
      "ON CONFLICT(usher_id) DO UPDATE SET count=excluded.count, first_at=excluded.first_at, locked_until=excluded.locked_until"
    ).bind(usher.id, count, first, locked),
    stAuthLog(env, usher.id, locked ? "locked" : "pin_wrong", "")
  ]);
  if (locked) fail(423, "locked", "Too many tries. Wait " + cfg.pin_lock_minutes + " minutes.", { minutes: cfg.pin_lock_minutes });
  fail(403, "bad_pin", "That PIN is not right.", { left: cfg.pin_max_tries - count });
}

/* ==========================================================================
   SESSIONS — one token for both apps, roles re-read on every call
   ========================================================================== */

async function createSession(env, cfg, usherId) {
  const token = randomHex(32), now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, usher_id, created_at, last_seen, expires_at) VALUES (?,?,?,?,?)"
  ).bind(await sha256Hex(token), usherId, now, now, now + cfg.session_max_days * 86400000).run();
  return token;
}

function bearer(request) {
  const h = request.headers.get("authorization") || "";
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(h.trim());
  return m ? m[1].toLowerCase() : "";
}

async function sessionOf(env, cfg, token) {
  if (!token) return null;
  const th = await sha256Hex(token);
  const s = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash=?").bind(th).first();
  const now = Date.now();
  if (!s || s.revoked_at || s.expires_at <= now) return null;
  if (now - s.last_seen > cfg.session_idle_hours * 3600000) return null;
  const me = await usherWithRoles(env, cfg, s.usher_id);
  if (!me || !me.usher.active) return null;
  if (now - s.last_seen > 60000) {
    await env.DB.prepare("UPDATE sessions SET last_seen=? WHERE token_hash=?").bind(now, th).run();
  }
  me.tokenHash = th;
  return me;
}

function meView(me) {
  return {
    name: me.usher.full_name,
    roles: me.roles.map((r) => ROLE_LABELS[r] || r),
    permissions: Array.from(me.perms).sort(),
    hasPin: !!me.usher.pin_hash,
    askPinChange: !!me.usher.pin_must_change
  };
}

/* ==========================================================================
   SIGN IN, SIGN OUT, PIN
   ========================================================================== */

/* Roles whose holders are listed on the Admin App's sign-in. */
const ADMIN_SIGN_IN_ROLES = ["head_usher", "assistant_head_usher", "system_admin"];

async function aPeople(env, cfg, b) {
  /* Before anybody is a System Administrator, the sign-in screen offers
     First-time setup (it still needs BOOTSTRAP_TOKEN). */
  const firstSetup = !!env.BOOTSTRAP_TOKEN &&
    !(await env.DB.prepare("SELECT 1 AS n FROM user_roles WHERE role='system_admin' LIMIT 1").first());
  if (firstSetup) return { ok: true, people: [], firstSetup: true };
  if (!cfg.public_name_list) return { ok: true, people: [], typeName: true };
  /* The Admin App lists only the people it is for. Anyone else is refused
     by the Admin App after sign-in anyway; this keeps the list short. */
  const adminOnly = !!(b && b.app === "admin");
  const r = adminOnly
    ? await env.DB.prepare(
        "SELECT DISTINCT u.id, u.full_name FROM ushers u JOIN user_roles r ON r.usher_id=u.id " +
        "WHERE u.active=1 AND u.pin_hash IS NOT NULL AND r.role IN (" + ADMIN_SIGN_IN_ROLES.map(() => "?").join(",") + ") " +
        "ORDER BY u.full_name COLLATE NOCASE").bind(...ADMIN_SIGN_IN_ROLES).all()
    : await env.DB.prepare(
        "SELECT id, full_name FROM ushers WHERE active=1 AND pin_hash IS NOT NULL ORDER BY full_name COLLATE NOCASE"
      ).all();
  return { ok: true, people: (r.results || []).map((u) => ({ id: u.id, name: u.full_name })) };
}

async function findForLogin(env, b) {
  if (b.usherId) return await getUsher(env, text(b.usherId, 20));
  const name = text(b.name, 80).toLowerCase();
  if (!name) return null;
  const r = await env.DB.prepare("SELECT * FROM ushers WHERE active=1 AND lower(full_name)=?").bind(name).all();
  const list = r.results || [];
  if (list.length > 1) fail(409, "ambiguous_name", "More than one person has that name. Ask the coordinator.");
  return list[0] || null;
}

async function aLogin(env, cfg, b) {
  const u = await findForLogin(env, b);
  if (!u || !u.active) fail(403, "unknown", "That name or PIN is not right.");
  await verifyPin(env, cfg, u, b.pin);
  const token = await createSession(env, cfg, u.id);
  await run(env, [stAuthLog(env, u.id, "login", "")]);
  const me = await usherWithRoles(env, cfg, u.id);
  return { ok: true, token, me: meView(me) };
}

/* The very first System Administrator, once, with BOOTSTRAP_TOKEN. */
async function aBootstrap(env, cfg, b) {
  const want = String(env.BOOTSTRAP_TOKEN || "");
  if (!want || !sameHex(await sha256Hex(b.token || ""), await sha256Hex(want))) fail(403, "forbidden", "Not allowed.");
  const any = await env.DB.prepare("SELECT 1 AS n FROM user_roles WHERE role='system_admin' LIMIT 1").first();
  if (any) fail(409, "already", "There is already a System Administrator.");
  const name = text(b.fullName, 80);
  if (!name) fail(400, "name", "A name is needed.");
  const id = await nextId(env, "usher", "U", 3);
  const pin = await newPinFields(env, cfg, b.pin);
  const now = Date.now();
  const u = Object.assign({ id, full_name: name, email: text(b.email, 120), phone: "", active: 1, created_at: now, updated_at: now }, pin);
  await run(env, [
    env.DB.prepare("INSERT INTO ushers (id, full_name, email, phone, active, pin_salt, pin_hash, pin_iter, pin_set_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(u.id, u.full_name, u.email, u.phone, 1, u.pin_salt, u.pin_hash, u.pin_iter, u.pin_set_at, now, now),
    env.DB.prepare("INSERT INTO user_roles (usher_id, role, granted_by, granted_at) VALUES (?,?,?,?)").bind(id, "usher", "bootstrap", now),
    env.DB.prepare("INSERT INTO user_roles (usher_id, role, granted_by, granted_at) VALUES (?,?,?,?)").bind(id, "system_admin", "bootstrap", now),
    stAudit(env, "bootstrap", "usher.create", "usher", id, null, { name, roles: ["usher", "system_admin"] }, "First System Administrator"),
    stOutbox(env, "USHERS", usherRow(u, ["usher", "system_admin"]), "USHER_ID"),
    stAuthLog(env, id, "pin_set", "bootstrap")
  ]);
  return { ok: true, created: true };
}

async function aLogout(env, cfg, b, me) {
  await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE token_hash=?").bind(Date.now(), me.tokenHash).run();
  await run(env, [stAuthLog(env, me.usher.id, "logout", "")]);
  return { ok: true };
}

async function aMe(env, cfg, b, me) {
  let pushKey = "";
  try { pushKey = (await vapidKeys(env)).pub; } catch (e) {}
  const alerts = await env.DB.prepare("SELECT count(*) AS n FROM push_subs WHERE usher_id=?").bind(me.usher.id).first();
  return { ok: true, me: meView(me), config: publicConfig(cfg), today: londonKey(new Date()), pushKey, alertPhones: alerts ? alerts.n : 0 };
}

function publicConfig(cfg) {
  const types = {};
  for (const k of Object.keys(cfg.event_types)) {
    const t = cfg.event_types[k];
    types[k] = { label: t.label, sunday: t.sunday || 0, attendance: !!t.attendance, ministration: !!t.ministration, offering: !!t.offering, countersign: !!t.countersign, duty: t.duty };
  }
  return {
    eventTypes: types, offeringCategories: cfg.offering_categories, currencies: cfg.currencies,
    defaultCurrency: cfg.default_currency, secondServiceCounters: cfg.second_service_counters,
    offlineSigning: !!cfg.offline_signing, pinMin: cfg.pin_min_length, pinMax: cfg.pin_max_length,
    roles: ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r] })),
    ministrationFields: cfg.ministration_fields || [], churchName: cfg.church_name || "", churchPlace: cfg.church_place || ""
  };
}

/* "Do you wish to change your default PIN?" No: it stays, and they are not
   asked again. They can still change it on the PIN tab whenever they like. */
async function aPinKeep(env, cfg, b, me) {
  if (!me.usher.pin_must_change) return { ok: true };
  await run(env, [
    env.DB.prepare("UPDATE ushers SET pin_must_change=0, updated_at=? WHERE id=?").bind(Date.now(), me.usher.id),
    stAudit(env, me.usher.id, "pin.keep", "usher", me.usher.id, null, null, "Kept the default PIN")
  ]);
  return { ok: true };
}

async function aPinChange(env, cfg, b, me) {
  await verifyPin(env, cfg, me.usher, b.oldPin);
  if (String(b.newPin || "") === String(b.oldPin || "")) fail(400, "same_pin", "Choose a PIN different from the one you have.");
  if (phoneDefaultPin(me.usher.phone) && String(b.newPin || "") === phoneDefaultPin(me.usher.phone)) {
    fail(400, "same_pin", "Choose a different PIN.");
  }
  const pin = await newPinFields(env, cfg, b.newPin);
  const now = Date.now();
  await run(env, [
    env.DB.prepare("UPDATE ushers SET pin_salt=?, pin_hash=?, pin_iter=?, pin_set_at=?, pin_must_change=0, updated_at=? WHERE id=?")
      .bind(pin.pin_salt, pin.pin_hash, pin.pin_iter, pin.pin_set_at, now, me.usher.id),
    /* Every other session of this person ends; this one carries on. */
    env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE usher_id=? AND token_hash<>? AND revoked_at IS NULL").bind(now, me.usher.id, me.tokenHash),
    stAudit(env, me.usher.id, "pin.change", "usher", me.usher.id, null, null, "Changed to a new PIN"),
    stAuthLog(env, me.usher.id, "pin_set", "own change")
  ]);
  return { ok: true };
}

/* ==========================================================================
   EVENTS AND THE ROTA
   ========================================================================== */

function typeOf(cfg, type) {
  const t = cfg.event_types[type];
  if (!t) fail(400, "event_type", "Unknown event type.");
  return t;
}

function sundayTypes(cfg) {
  return Object.keys(cfg.event_types).filter((k) => cfg.event_types[k].sunday)
    .sort((a, b) => cfg.event_types[a].sunday - cfg.event_types[b].sunday);
}

function eventRow(e) {
  return {
    EVENT_ID: e.id, EVENT_TYPE: e.type, TITLE: e.title, DATE: e.date, START_TIME: e.start_time || "",
    SUNDAY: e.sunday_key || "", THANKSGIVING: e.thanksgiving ? "YES" : "", STATUS: e.status,
    NOTES: e.notes || "", UPDATED_AT: londonStamp(e.updated_at || Date.now())
  };
}

/* A Sunday is one event per Sunday type, all sharing the Sunday's date. */
async function ensureSunday(env, cfg, key, actorId) {
  if (!validKey(key) || keyDow(key) !== 0) fail(400, "not_sunday", "That date is not a Sunday.");
  const thanks = isThanksgiving(cfg, key) ? 1 : 0;
  const now = Date.now(), made = [];
  for (const type of sundayTypes(cfg)) {
    const t = cfg.event_types[type];
    const id = "S" + key.replace(/-/g, "") + "-" + t.sunday;
    const title = t.label + (thanks ? " (Thanksgiving Sunday)" : "");
    const r = await env.DB.prepare(
      "INSERT OR IGNORE INTO events (id, type, title, date, start_time, sunday_key, thanksgiving, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(id, type, title, key, t.start || "", key, thanks, "scheduled", actorId || "system", now, now).run();
    if (r.meta && r.meta.changes) {
      made.push(stOutbox(env, "EVENTS", eventRow({ id, type, title, date: key, start_time: t.start || "", sunday_key: key, thanksgiving: thanks, status: "scheduled", updated_at: now }), "EVENT_ID"));
    }
  }
  await run(env, made);
  const r = await env.DB.prepare("SELECT * FROM events WHERE sunday_key=? ORDER BY id").bind(key).all();
  return r.results || [];
}

async function activeAppointments(env, eventIds) {
  if (!eventIds.length) return [];
  const qs = eventIds.map(() => "?").join(",");
  const r = await env.DB.prepare(
    "SELECT a.*, u.full_name FROM appointments a JOIN ushers u ON u.id=a.usher_id WHERE a.status='active' AND a.event_id IN (" + qs + ") ORDER BY u.full_name COLLATE NOCASE"
  ).bind(...eventIds).all();
  return r.results || [];
}

/* The rota for Sundays (and other events) in a window. Names for everybody;
   ids only when the caller may edit it. */
async function rotaWindow(env, cfg, fromKey, weeks, me, withIds) {
  const toKey = keyAddDays(fromKey, weeks * 7 - 1);
  const ev = (await env.DB.prepare(
    "SELECT * FROM events WHERE date>=? AND date<=? ORDER BY date, start_time, id").bind(fromKey, toKey).all()).results || [];
  const appts = await activeAppointments(env, ev.map((e) => e.id));
  const reps = ev.length ? ((await env.DB.prepare(
    "SELECT event_id, status FROM reports WHERE event_id IN (" + ev.map(() => "?").join(",") + ")").bind(...ev.map((e) => e.id)).all()).results || []) : [];
  const repOf = {};
  for (const r of reps) repOf[r.event_id] = r.status;
  const view = (e) => ({
    eventId: e.id, type: e.type, title: e.title, date: e.date, start: e.start_time, status: e.status,
    thanksgiving: !!e.thanksgiving, reportStatus: repOf[e.id] || "",
    people: appts.filter((a) => a.event_id === e.id).map((a) => {
      const p = { name: a.full_name, duty: a.duty, mine: !!me && a.usher_id === me.usher.id };
      if (withIds) { p.usherId = a.usher_id; p.appointmentId = a.id; }
      return p;
    })
  });
  const sundays = [];
  for (let k = sundayOnOrAfter(fromKey); k <= toKey; k = keyAddDays(k, 7)) {
    const services = ev.filter((e) => e.sunday_key === k).map(view);
    sundays.push({ sunday: k, thanksgiving: isThanksgiving(cfg, k), services });
  }
  const others = ev.filter((e) => !e.sunday_key).map(view);
  return { from: fromKey, to: toKey, sundays, events: others };
}

async function aRota(env, cfg, b, me) {
  const today = londonKey(new Date());
  const from = validKey(b.from) ? b.from : today;
  const weeks = Math.min(26, Math.max(1, Number(b.weeks) || cfg.rota_weeks_ahead));
  const edit = me.perms.has("rota.manage");
  if (edit) {
    for (let k = sundayOnOrAfter(from), i = 0; i < weeks; k = keyAddDays(k, 7), i++) await ensureSunday(env, cfg, k, me.usher.id);
  }
  return Object.assign({ ok: true, canEdit: edit }, await rotaWindow(env, cfg, from, weeks, me, edit));
}

async function getEvent(env, id) {
  const e = await env.DB.prepare("SELECT * FROM events WHERE id=?").bind(text(id, 40)).first();
  if (!e) fail(404, "no_event", "That event was not found.");
  return e;
}

function apptRow(a, e, name, by) {
  return {
    APPOINTMENT_ID: a.id, EVENT_ID: e.id, DATE: e.date, EVENT_TITLE: e.title, USHER_ID: a.usher_id,
    FULL_NAME: name, DUTY: a.duty, STATUS: a.status, CHANGED_BY: by, CHANGED_AT: londonStamp(Date.now())
  };
}

/* Set exactly who is on one duty at one event. Being on another event the
   same Sunday is never a conflict. */
async function aRotaSet(env, cfg, b, me) {
  need(me, "rota.manage");
  const e = await getEvent(env, b.eventId);
  const t = typeOf(cfg, e.type);
  const duty = text(b.duty || t.duty, 30).toLowerCase();
  const ids = Array.isArray(b.usherIds) ? b.usherIds.map((x) => text(x, 20)) : [];
  if (new Set(ids).size !== ids.length) fail(400, "duplicate", "The same person is listed twice.");
  if (t.exact && duty === t.duty) {
    const n = Number(cfg[t.exact]) || 0;
    if (ids.length !== n && ids.length !== 0) fail(400, "exact_count", "Exactly " + n + " people must be appointed for this duty.", { exact: n });
  }
  const names = await namesMap(env);
  for (const id of ids) {
    const u = await getUsher(env, id);
    if (!u || !u.active) fail(400, "unknown_usher", "Somebody on the list is not an active usher.");
  }
  const current = ((await env.DB.prepare(
    "SELECT * FROM appointments WHERE event_id=? AND duty=? AND status='active'").bind(e.id, duty).all()).results) || [];
  const now = Date.now(), st = [];
  const usherOf = {};
  for (const id of ids) usherOf[id] = await getUsher(env, id);
  for (const a of current) {
    if (ids.indexOf(a.usher_id) !== -1) continue;
    st.push(env.DB.prepare("UPDATE appointments SET status='removed', removed_by=?, removed_at=? WHERE id=?").bind(me.usher.id, now, a.id));
    st.push(stAudit(env, me.usher.id, "appointment.remove", "appointment", a.id, { event: e.id, usher: a.usher_id, duty }, null, text(b.reason, 200)));
    st.push(stOutbox(env, "APPOINTMENTS", apptRow(Object.assign({}, a, { status: "removed" }), e, names[a.usher_id] || "", me.usher.id), "APPOINTMENT_ID"));
  }
  const have = current.map((a) => a.usher_id);
  for (const id of ids) {
    if (have.indexOf(id) !== -1) continue;
    const a = { id: await nextId(env, "appointment", "AP", 5), event_id: e.id, usher_id: id, duty, status: "active" };
    st.push(env.DB.prepare("INSERT INTO appointments (id, event_id, usher_id, duty, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(a.id, e.id, id, duty, "active", me.usher.id, now));
    st.push(stAudit(env, me.usher.id, "appointment.add", "appointment", a.id, null, { event: e.id, usher: id, duty }, text(b.reason, 200)));
    st.push(stOutbox(env, "APPOINTMENTS", apptRow(a, e, names[id] || "", me.usher.id), "APPOINTMENT_ID"));
    st.push(stNotify(env, cfg, usherOf[id], "duty", "You are on duty: " + e.title,
      e.title + " on " + ukDate(e.date) + (duty === "counting" ? ", offering counting." : ", ushering."), "event", e.id));
  }
  await run(env, st);
  return { ok: true };
}

function ukDate(key) {
  const s = String(key || "");
  return s.length === 10 ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : s;
}

async function aEventSave(env, cfg, b, me) {
  need(me, "events.manage");
  const type = text(b.type, 30);
  const t = typeOf(cfg, type);
  if (t.sunday) fail(400, "sunday_type", "Sunday services are made by the rota.");
  if (!validKey(b.date)) fail(400, "date", "A date is needed.");
  const start = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.start || "")) ? b.start : "";
  const title = text(b.title, 100) || t.label;
  const now = Date.now();
  if (b.eventId) {
    const before = await getEvent(env, b.eventId);
    if (before.sunday_key) fail(400, "sunday_type", "Sunday services are made by the rota.");
    const after = Object.assign({}, before, { type, title, date: b.date, start_time: start, notes: text(b.notes, 500), updated_at: now });
    await run(env, [
      env.DB.prepare("UPDATE events SET type=?, title=?, date=?, start_time=?, notes=?, updated_at=? WHERE id=?")
        .bind(type, title, b.date, start, after.notes, now, before.id),
      stAudit(env, me.usher.id, "event.update", "event", before.id, before, after, text(b.reason, 200)),
      stOutbox(env, "EVENTS", eventRow(after), "EVENT_ID")
    ]);
    return { ok: true, eventId: before.id };
  }
  const id = await nextId(env, "event", "E", 4);
  const e = { id, type, title, date: b.date, start_time: start, sunday_key: "", thanksgiving: 0, status: "scheduled", notes: text(b.notes, 500), updated_at: now };
  await run(env, [
    env.DB.prepare("INSERT INTO events (id, type, title, date, start_time, sunday_key, thanksgiving, status, notes, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, type, title, b.date, start, "", 0, "scheduled", e.notes, me.usher.id, now, now),
    stAudit(env, me.usher.id, "event.create", "event", id, null, e, ""),
    stOutbox(env, "EVENTS", eventRow(e), "EVENT_ID")
  ]);
  return { ok: true, eventId: id };
}

async function aEventCancel(env, cfg, b, me) {
  need(me, "events.manage");
  const e = await getEvent(env, b.eventId);
  const after = Object.assign({}, e, { status: b.restore ? "scheduled" : "cancelled", updated_at: Date.now() });
  await run(env, [
    env.DB.prepare("UPDATE events SET status=?, updated_at=? WHERE id=?").bind(after.status, after.updated_at, e.id),
    stAudit(env, me.usher.id, b.restore ? "event.restore" : "event.cancel", "event", e.id, { status: e.status }, { status: after.status }, text(b.reason, 200)),
    stOutbox(env, "EVENTS", eventRow(after), "EVENT_ID")
  ]);
  return { ok: true };
}

/* ==========================================================================
   ONE AUTHORISATION ENGINE
   ==========================================================================
   A request names one transaction: countersign THIS report, submit for THIS
   event, take over THIS appointment. Approval makes a temporary authority
   for that transaction alone, used once and marked consumed. Nobody's roles
   change. The same engine serves countersignatures and duty changes. */

const AUTH_KIND_LABELS = {
  countersign: "Countersign a report",
  report_submission: "Submit a report",
  report_amendment: "Amend a report",
  duty_takeover: "Duty change"
};

function authRow(a, names) {
  return {
    AUTH_ID: a.id, KIND: a.kind, SUBJECT_ID: a.subject_id, SUBJECT: names[a.subject_id] || "",
    TARGET_TYPE: a.target_type, TARGET_ID: a.target_id, REQUESTED_BY: a.requested_by,
    REQUESTED_BY_NAME: names[a.requested_by] || "", REASON: a.reason || "", STATUS: a.status,
    DECIDED_BY: a.decided_by || "", DECIDED_AT: londonStamp(a.decided_at), NOTE: a.decision_note || "",
    CONSUMED_AT: londonStamp(a.consumed_at), CREATED_AT: londonStamp(a.created_at)
  };
}

async function findAuth(env, kind, subjectId, targetType, targetId, statuses) {
  const qs = statuses.map(() => "?").join(",");
  return await env.DB.prepare(
    "SELECT * FROM authorisations WHERE kind=? AND subject_id=? AND target_type=? AND target_id=? AND status IN (" + qs + ") ORDER BY created_at DESC LIMIT 1"
  ).bind(kind, subjectId, targetType, String(targetId), ...statuses).first();
}

/* Returns { id, statements, status }. An identical pending request is
   reused, unless o.fresh (the old one is being cancelled in the same
   batch). An approver needs no request: when the person asking may approve,
   the authorisation is made already approved, by them, on the record, and
   its effect happens at once. A report is still countersigned by somebody
   else whoever submits it; that rule is in the report code, not here. */
async function authRequest(env, cfg, o) {
  const approver = !!(o.me && o.me.perms.has("exceptions.approve") && o.me.usher.id === o.requestedBy);
  if (!approver && !o.fresh) {
    const existing = await findAuth(env, o.kind, o.subjectId, o.targetType, o.targetId, ["pending"]);
    if (existing) return { id: existing.id, statements: [], reused: true, status: "pending" };
  }
  const id = await nextId(env, "authorisation", "A", 4);
  const now = Date.now();
  const a = { id, kind: o.kind, subject_id: o.subjectId, target_type: o.targetType, target_id: String(o.targetId),
              requested_by: o.requestedBy, reason: text(o.reason, 300), status: "pending", created_at: now };
  const names = await namesMap(env);
  const st = [
    env.DB.prepare("INSERT INTO authorisations (id, kind, subject_id, target_type, target_id, requested_by, reason, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, a.kind, a.subject_id, a.target_type, a.target_id, a.requested_by, a.reason, "pending", now),
    stAudit(env, o.requestedBy, "authorisation.request", "authorisation", id, null, { kind: a.kind, subject: a.subject_id, target: a.target_type + ":" + a.target_id }, a.reason)
  ];
  if (approver) {
    const after = Object.assign({}, a, { status: "approved", decided_by: o.requestedBy, decided_at: now,
      decision_note: "Approved by the approver who made the change" });
    st.push(env.DB.prepare("UPDATE authorisations SET status='approved', decided_by=?, decided_at=?, decision_note=? WHERE id=?")
      .bind(o.requestedBy, now, after.decision_note, id));
    st.push(stAudit(env, o.requestedBy, "authorisation.approve", "authorisation", id, { status: "pending" }, { status: "approved" }, after.decision_note));
    const fx = await authEffects(env, cfg, after, o.me.usher, names, { pending: [a] });
    st.push(fx.statements);
    st.push(stOutbox(env, "AUTHORISATIONS", authRow(fx.after, names), "AUTH_ID"));
    return { id, statements: st, status: fx.after.status };
  }
  st.push(stOutbox(env, "AUTHORISATIONS", authRow(a, names), "AUTH_ID"));
  const approvers = await holders(env, cfg, "exceptions.approve");
  for (const u of approvers) {
    if (!cfg.self_approval && (u.id === o.requestedBy || u.id === o.subjectId)) continue;
    st.push(stNotify(env, cfg, u, "approval_request", "Approval needed: " + AUTH_KIND_LABELS[a.kind],
      o.describe || (names[a.subject_id] + " needs approval."), "authorisation", id));
  }
  return { id, statements: st, status: "pending" };
}

/* What an approval does, the same whether an approver decided somebody's
   request or approved their own change. Returns { statements, after }. */
async function authEffects(env, cfg, a, decider, names, opt) {
  const st = [], now = Date.now();
  const after = Object.assign({}, a);
  const about = opt && opt.about ? opt.about : await authAbout(env, a, names);
  if (a.kind === "countersign" && a.subject_id !== decider.id) {
    st.push(stNotify(env, cfg, await getUsher(env, a.subject_id), "countersign_request", "Please countersign: " + (about.title || "a report"),
      (names[a.requested_by] || "The coordinator") + " has asked you to countersign the report.", "report", a.target_id));
  }
  if (a.kind === "duty_takeover") {
    /* The duty moves to the person who did it; the original stays on the
       record as removed, with the reason. */
    const ap = await env.DB.prepare("SELECT * FROM appointments WHERE id=?").bind(a.target_id).first();
    if (ap && ap.status === "active") {
      const e = await getEvent(env, ap.event_id);
      const newId = await nextId(env, "appointment", "AP", 5);
      st.push(env.DB.prepare("UPDATE appointments SET status='removed', removed_by=?, removed_at=? WHERE id=?").bind(decider.id, now, ap.id));
      st.push(stOutbox(env, "APPOINTMENTS", apptRow(Object.assign({}, ap, { status: "removed" }), e, names[ap.usher_id] || "", decider.id), "APPOINTMENT_ID"));
      const dup = await env.DB.prepare("SELECT id FROM appointments WHERE event_id=? AND usher_id=? AND duty=? AND status='active'").bind(e.id, a.subject_id, ap.duty).first();
      if (!dup) {
        st.push(env.DB.prepare("INSERT INTO appointments (id, event_id, usher_id, duty, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)")
          .bind(newId, e.id, a.subject_id, ap.duty, "active", decider.id, now));
        st.push(stOutbox(env, "APPOINTMENTS", apptRow({ id: newId, usher_id: a.subject_id, duty: ap.duty, status: "active" }, e, names[a.subject_id] || "", decider.id), "APPOINTMENT_ID"));
      }
      st.push(stAudit(env, decider.id, "appointment.takeover", "appointment", ap.id,
        { usher: ap.usher_id }, { usher: a.subject_id, appointment: newId }, "Authorisation " + a.id));
    }
    st.push(env.DB.prepare("UPDATE authorisations SET status='consumed', consumed_at=? WHERE id=?").bind(now, a.id));
    after.status = "consumed"; after.consumed_at = now;
  }
  return { statements: st, after };
}

/* A request that no longer applies. The approvers' "Approval needed" for it
   is marked read, so it stops showing as new. */
function stCancelAuth(env, a, note, names, now) {
  return [
    env.DB.prepare("UPDATE authorisations SET status='cancelled', decided_at=?, decision_note=? WHERE id=?").bind(now, note, a.id),
    stOutbox(env, "AUTHORISATIONS", authRow(Object.assign({}, a, { status: "cancelled", decided_at: now, decision_note: note }), names), "AUTH_ID"),
    stAskedRead(env, a.id, now)
  ];
}

function stAskedRead(env, authId, now) {
  return env.DB.prepare("UPDATE notifications SET read_at=? WHERE type='approval_request' AND ref_type='authorisation' AND ref_id=? AND read_at IS NULL")
    .bind(now, String(authId));
}

function stConsume(env, a, names) {
  const now = Date.now();
  return [
    env.DB.prepare("UPDATE authorisations SET status='consumed', consumed_at=? WHERE id=? AND status='approved'").bind(now, a.id),
    stOutbox(env, "AUTHORISATIONS", authRow(Object.assign({}, a, { status: "consumed", consumed_at: now }), names), "AUTH_ID")
  ];
}

async function aAuthList(env, cfg, b, me) {
  const mine = !me.perms.has("exceptions.approve") || b.mine;
  const status = ["pending", "approved", "rejected", "consumed", "cancelled"].indexOf(b.status) !== -1 ? b.status : "";
  let sql = "SELECT * FROM authorisations WHERE 1=1", args = [];
  if (status) { sql += " AND status=?"; args.push(status); }
  if (mine) { sql += " AND (requested_by=? OR subject_id=?)"; args.push(me.usher.id, me.usher.id); }
  sql += " ORDER BY created_at DESC LIMIT 100";
  const rows = (await env.DB.prepare(sql).bind(...args).all()).results || [];
  const names = await namesMap(env);
  const out = [];
  for (const a of rows) {
    const v = {
      id: a.id, kind: a.kind, kindLabel: AUTH_KIND_LABELS[a.kind] || a.kind, status: a.status,
      subject: names[a.subject_id] || "", requestedBy: names[a.requested_by] || "", reason: a.reason,
      createdAt: a.created_at, decidedBy: names[a.decided_by] || "", decidedAt: a.decided_at, note: a.decision_note,
      canDecide: a.status === "pending" && me.perms.has("exceptions.approve") &&
                 (cfg.self_approval || (a.requested_by !== me.usher.id && a.subject_id !== me.usher.id))
    };
    v.about = await authAbout(env, a, names);
    out.push(v);
  }
  return { ok: true, authorisations: out };
}

async function authAbout(env, a, names) {
  try {
    if (a.target_type === "report") {
      const r = await env.DB.prepare("SELECT r.id, e.title, e.date FROM reports r JOIN events e ON e.id=r.event_id WHERE r.id=?").bind(a.target_id).first();
      return r ? { title: r.title, date: r.date, reportId: r.id } : {};
    }
    if (a.target_type === "event") {
      const e = await env.DB.prepare("SELECT * FROM events WHERE id=?").bind(a.target_id).first();
      return e ? { title: e.title, date: e.date, eventId: e.id } : {};
    }
    if (a.target_type === "appointment") {
      const x = await env.DB.prepare("SELECT a.*, e.title, e.date FROM appointments a JOIN events e ON e.id=a.event_id WHERE a.id=?").bind(a.target_id).first();
      return x ? { title: x.title, date: x.date, eventId: x.event_id, rostered: names[x.usher_id] || "", duty: x.duty } : {};
    }
  } catch (e) {}
  return {};
}

/* An usher asks: to submit for an event they were not on, or to say they did
   somebody else's duty. */
async function aAuthRequest(env, cfg, b, me) {
  const kind = text(b.kind, 30);
  const reason = text(b.reason, 300);
  if (kind === "report_submission") {
    const e = await getEvent(env, b.eventId);
    const req = await authRequest(env, cfg, { kind, subjectId: me.usher.id, targetType: "event", targetId: e.id, me,
      requestedBy: me.usher.id, reason, describe: me.usher.full_name + " asks to submit the report for " + e.title + " on " + ukDate(e.date) + "." });
    await run(env, req.statements);
    return { ok: true, authorisationId: req.id, status: req.status };
  }
  if (kind === "report_amendment") {
    const r = await env.DB.prepare("SELECT * FROM reports WHERE id=?").bind(text(b.reportId, 20)).first();
    if (!r) fail(404, "no_report", "That report was not found.");
    const st = await amendState(env, cfg, r, me);
    if (!st.possible) fail(403, "forbidden", "You cannot amend this report.");
    if (st.approver) return { ok: true, status: "approved", authorisationId: null };
    if (reason.length < 3) fail(400, "reason", "Say why the report needs amending.");
    const e = await getEvent(env, r.event_id);
    const req = await authRequest(env, cfg, { kind, subjectId: me.usher.id, targetType: "report", targetId: r.id, me,
      requestedBy: me.usher.id, reason,
      describe: me.usher.full_name + " asks to amend the report for " + e.title + " on " + ukDate(e.date) + ". Reason: " + reason });
    await run(env, req.statements);
    return { ok: true, authorisationId: req.id, status: req.status };
  }
  if (kind === "duty_takeover") {
    const ap = await env.DB.prepare("SELECT * FROM appointments WHERE id=? AND status='active'").bind(text(b.appointmentId, 20)).first();
    if (!ap) fail(404, "no_appointment", "That duty was not found.");
    if (ap.usher_id === me.usher.id) fail(400, "own_duty", "That duty is already yours.");
    const e = await getEvent(env, ap.event_id);
    const names = await namesMap(env);
    /* An approver's own duty change happens at once, so it takes their PIN
       as any approval does. */
    if (me.perms.has("exceptions.approve")) await verifyPin(env, cfg, me.usher, b.pin);
    const req = await authRequest(env, cfg, { kind, subjectId: me.usher.id, targetType: "appointment", targetId: ap.id, me,
      requestedBy: me.usher.id, reason,
      describe: me.usher.full_name + " says they did " + (names[ap.usher_id] || "someone") + "'s duty at " + e.title + " on " + ukDate(e.date) + "." });
    await run(env, req.statements);
    return { ok: true, authorisationId: req.id, status: req.status };
  }
  fail(400, "kind", "Unknown request.");
}

async function aAuthDecide(env, cfg, b, me) {
  need(me, "exceptions.approve");
  const a = await env.DB.prepare("SELECT * FROM authorisations WHERE id=?").bind(text(b.id, 20)).first();
  if (!a) fail(404, "no_authorisation", "That request was not found.");
  if (a.status !== "pending") fail(409, "decided", "That request has already been decided.");
  if (!cfg.self_approval && (a.requested_by === me.usher.id || a.subject_id === me.usher.id)) {
    fail(403, "self_approval", "Somebody else must decide a request you are part of.");
  }
  const approve = b.decision === "approve";
  if (!approve && b.decision !== "reject") fail(400, "decision", "Approve or reject.");
  await verifyPin(env, cfg, me.usher, b.pin);
  const now = Date.now(), names = await namesMap(env);
  const after = Object.assign({}, a, { status: approve ? "approved" : "rejected", decided_by: me.usher.id, decided_at: now, decision_note: text(b.note, 300) });
  const st = [
    env.DB.prepare("UPDATE authorisations SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=? AND status='pending'")
      .bind(after.status, me.usher.id, now, after.decision_note, a.id),
    stAudit(env, me.usher.id, approve ? "authorisation.approve" : "authorisation.reject", "authorisation", a.id,
      { status: "pending" }, { status: after.status }, after.decision_note)
  ];
  /* Decided by one approver: the others' "Approval needed" is done with. */
  st.push(stAskedRead(env, a.id, now));
  const subject = await getUsher(env, a.subject_id);
  const requester = a.requested_by === a.subject_id ? null : await getUsher(env, a.requested_by);
  const about = await authAbout(env, a, names);
  const what = (AUTH_KIND_LABELS[a.kind] || a.kind) + (about.title ? ": " + about.title + " " + ukDate(about.date) : "");
  /* A chosen countersigner hears once: "Please countersign" when approved
     (from authEffects). If not approved, the submitter chooses again. */
  if (a.kind !== "countersign") {
    st.push(stNotify(env, cfg, subject, "approval_decision", (approve ? "Approved: " : "Not approved: ") + what,
      approve ? "You can go ahead." : "Reason: " + (after.decision_note || "none given"), a.target_type, a.target_id));
  }
  if (requester) {
    st.push(stNotify(env, cfg, requester, "approval_decision", (approve ? "Approved: " : "Not approved: ") + what,
      approve ? names[a.subject_id] + " has been approved." : "Choose somebody else or ask the coordinator." + (after.decision_note ? " Reason: " + after.decision_note : ""), a.target_type, a.target_id));
  }
  if (approve) {
    const fx = await authEffects(env, cfg, after, me.usher, names, { about });
    st.push(fx.statements);
    Object.assign(after, fx.after);
  }
  st.push(stOutbox(env, "AUTHORISATIONS", authRow(after, names), "AUTH_ID"));
  await run(env, st);
  return { ok: true, status: after.status };
}

/* ==========================================================================
   REPORTS
   ==========================================================================
   One report per event, one submitter, optional countersignature.
     with:    draft -> submitted -> pending_countersignature -> verified
     without: draft -> submitted -> verified
   Totals are always worked out here, never taken from the phone. */

const STATUS_LABELS = {
  draft: "Draft", submitted: "Submitted", pending_countersignature: "Pending Countersignature", verified: "Verified"
};

async function isAppointed(env, usherId, eventId) {
  return !!(await env.DB.prepare("SELECT 1 AS n FROM appointments WHERE usher_id=? AND event_id=? AND status='active' LIMIT 1").bind(usherId, eventId).first());
}

async function countersignAuthority(env, cfg, usherId, eventId) {
  const roles = await rolesOf(env, usherId);
  if (roles.some((r) => cfg.countersign_roles.indexOf(r) !== -1)) return true;
  if (permissionsFor(cfg, roles).has("exceptions.approve")) return true;
  if (cfg.countersign_rostered && await isAppointed(env, usherId, eventId)) return true;
  return false;
}

/* { ok, auth } — auth is the approved temporary authority, when that is
   what lets them submit. */
async function submitAuthority(env, me, e) {
  if (me.perms.has("reports.submit_any") || me.perms.has("exceptions.approve")) return { ok: true, auth: null };
  if (await isAppointed(env, me.usher.id, e.id)) return { ok: true, auth: null };
  const auth = await findAuth(env, "report_submission", me.usher.id, "event", e.id, ["approved"]);
  if (auth) return { ok: true, auth };
  const pending = await findAuth(env, "report_submission", me.usher.id, "event", e.id, ["pending"]);
  return { ok: false, pending: pending ? pending.id : null };
}

function cleanReport(cfg, t, b) {
  const at = b.attendance || {};
  const out = { male: 0, female: 0, children: 0, total: 0, entries: [], byCategory: {}, offeringTotal: 0, notes: text(b.notes, 1000), ministration: {} };
  if (t.ministration) {
    const m = b.ministration && typeof b.ministration === "object" ? b.ministration : {};
    for (const f of (cfg.ministration_fields || [])) {
      if (f.kind === "number") {
        const n = wholeNum(m[f.key], 100000);
        if (Number.isNaN(n)) fail(400, "ministration", f.label + " must be a whole number.");
        out.ministration[f.key] = n;
      } else {
        out.ministration[f.key] = text(m[f.key], 300);
      }
    }
  }
  if (t.attendance) {
    for (const k of ["male", "female", "children"]) {
      const n = wholeNum(at[k], 100000);
      if (Number.isNaN(n)) fail(400, "attendance", "Attendance must be whole numbers.");
      out[k] = n;
    }
    out.total = out.male + out.female + out.children;
  }
  if (t.offering) {
    const list = Array.isArray(b.entries) ? b.entries : [];
    if (list.length > 300) fail(400, "entries", "Too many offering lines.");
    list.forEach((x, i) => {
      const category = text(x && x.category, 40);
      const currency = text(x && x.currency, 5).toUpperCase() || cfg.default_currency;
      const cur = cfg.currencies[currency];
      if (cfg.offering_categories.indexOf(category) === -1) fail(400, "category", "Unknown offering category on line " + (i + 1) + ".");
      if (!cur) fail(400, "currency", "Unknown currency on line " + (i + 1) + ".");
      const denomination = Number(x.denomination);
      if (cur.denominations.indexOf(denomination) === -1) fail(400, "denomination", "Unknown denomination on line " + (i + 1) + ".");
      const quantity = wholeNum(x.quantity, 1000000);
      if (Number.isNaN(quantity) || quantity < 1) fail(400, "quantity", "Quantity must be a whole number on line " + (i + 1) + ".");
      const amount = denomination * quantity;
      out.entries.push({ line_no: out.entries.length + 1, category, currency, denomination, quantity, amount });
      out.byCategory[category] = (out.byCategory[category] || 0) + amount;
      out.offeringTotal += amount;
    });
  }
  return out;
}

function checkSignature(me, sig) {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!sig || norm(sig) !== norm(me.usher.full_name)) fail(400, "signature", "Type your full name exactly as it appears to sign.");
  return text(sig, 80);
}

/* The PIN, or (when allowed) a signature made with no signal on a phone
   that checked the PIN itself. Returns how it was checked. */
async function signingCheck(env, cfg, me, b) {
  if (b.offline) {
    if (!cfg.offline_signing) fail(403, "offline_off", "Offline signing is switched off.");
    const at = Number(b.signedAt) || 0, now = Date.now();
    if (!at || at > now + 300000 || now - at > cfg.offline_max_hours * 3600000) fail(400, "offline_stale", "This signature is too old. Sign again.");
    return "device";
  }
  await verifyPin(env, cfg, me.usher, b.pin);
  return "server";
}

function reportRow(r, e, names) {
  return {
    REPORT_ID: r.id, SUBMISSION_ID: r.submission_id || "", EVENT_ID: e.id, DATE: e.date, EVENT_TITLE: e.title,
    STATUS: STATUS_LABELS[r.status] || r.status, SUBMITTER_ID: r.submitter_id || "", SUBMITTER: names[r.submitter_id] || "",
    SUBMITTED_AT: londonStamp(r.submitted_at), SUBMIT_PIN_CHECK: r.submit_pin_check || "",
    COUNTERSIGNER_ID: r.countersigner_id || "", COUNTERSIGNER: names[r.countersigner_id] || "",
    COUNTERSIGNED_AT: londonStamp(r.countersigned_at), COUNTERSIGN_AUTH_ID: r.countersign_auth_id || "",
    VERIFIED_AT: londonStamp(r.verified_at), MALE: r.male, FEMALE: r.female, CHILDREN: r.children,
    ATTENDANCE_TOTAL: r.attendance_total, OFFERING_TOTAL: pounds(r.offering_total), NOTES: r.notes || "",
    VERSION: r.version || 1, UPDATED_AT: londonStamp(r.updated_at)
  };
}

async function entriesOf(env, reportId) {
  return ((await env.DB.prepare("SELECT * FROM offering_entries WHERE report_id=? ORDER BY line_no").bind(reportId).all()).results) || [];
}

function ministrationOf(r) {
  try { const m = JSON.parse(r.ministration_json || "{}"); return m && typeof m === "object" ? m : {}; } catch (e) { return {}; }
}

/* The parts of one version of a report, for the sheet. Every row carries the
   version and whether it is the current one, so a total made on the sheet
   can leave out the versions an amendment replaced. */
function stReportParts(env, cfg, t, rec, e, entries, ministration, current) {
  const v = rec.version || 1, now = Date.now(), cur = current ? "Yes" : "No";
  const st = [];
  if (t.attendance) {
    st.push(stOutbox(env, "ATTENDANCE", { ATTENDANCE_ID: rec.id + "-v" + v, REPORT_ID: rec.id, VERSION: v, CURRENT: cur,
      EVENT_ID: e.id, DATE: e.date, EVENT_TITLE: e.title, MALE: rec.male, FEMALE: rec.female, CHILDREN: rec.children,
      TOTAL: rec.attendance_total, RECORDED_AT: londonStamp(now) }, "ATTENDANCE_ID"));
  }
  if (t.ministration) {
    for (const f of (cfg.ministration_fields || [])) {
      if (!(f.key in ministration)) continue;
      st.push(stOutbox(env, "MINISTRATION", { MINISTRATION_ID: rec.id + "-v" + v + "-" + f.key, REPORT_ID: rec.id, VERSION: v, CURRENT: cur,
        EVENT_ID: e.id, DATE: e.date, EVENT_TITLE: e.title, FIELD: f.label, VALUE: ministration[f.key], RECORDED_AT: londonStamp(now) }, "MINISTRATION_ID"));
    }
  }
  for (const x of entries) {
    st.push(stOutbox(env, "OFFERING", { OFFERING_ID: rec.id + "-v" + v + "-" + x.line_no, REPORT_ID: rec.id, VERSION: v, CURRENT: cur,
      EVENT_ID: e.id, DATE: e.date, LINE: x.line_no, CATEGORY: x.category, CURRENCY: x.currency, DENOMINATION: pounds(x.denomination),
      QUANTITY: x.quantity, AMOUNT: pounds(x.amount), RECORDED_AT: londonStamp(now) }, "OFFERING_ID"));
  }
  return st;
}

async function canSeeReport(env, me, r) {
  if (me.perms.has("reports.view_all")) return true;
  if (r.submitter_id === me.usher.id || r.countersigner_id === me.usher.id) return true;
  if (await isAppointed(env, me.usher.id, r.event_id)) return true;
  return false;
}

async function reportView(env, cfg, r, me) {
  const e = await getEvent(env, r.event_id);
  const names = await namesMap(env);
  const entries = await entriesOf(env, r.id);
  const byCategory = {};
  for (const x of entries) byCategory[x.category] = (byCategory[x.category] || 0) + x.amount;
  const hist = ((await env.DB.prepare("SELECT * FROM report_history WHERE report_id=? ORDER BY id").bind(r.id).all()).results) || [];
  let csAuth = null;
  if (r.countersigner_id && r.status === "pending_countersignature") {
    const a = await findAuth(env, "countersign", r.countersigner_id, "report", r.id, ["pending", "approved", "rejected"]);
    csAuth = a ? a.status : null;
    if (!a && !(await countersignAuthority(env, cfg, r.countersigner_id, r.event_id))) csAuth = "missing";
  }
  const meSigns = r.status === "pending_countersignature" && r.countersigner_id === me.usher.id;
  return {
    id: r.id, eventId: e.id, eventTitle: e.title, date: e.date, type: e.type, status: r.status,
    statusLabel: STATUS_LABELS[r.status] || r.status,
    submitter: names[r.submitter_id] || "", countersigner: names[r.countersigner_id] || "",
    iAmSubmitter: r.submitter_id === me.usher.id, iAmCountersigner: r.countersigner_id === me.usher.id,
    countersignRequired: !!r.countersign_required,
    countersignApproval: csAuth,
    canCountersign: meSigns && (csAuth === null || csAuth === "approved"),
    attendance: { male: r.male, female: r.female, children: r.children, total: r.attendance_total },
    entries: entries.map((x) => ({ category: x.category, currency: x.currency, denomination: x.denomination, quantity: x.quantity, amount: x.amount })),
    byCategory, offeringTotal: r.offering_total, notes: r.notes,
    ministration: ministrationOf(r), ministrationFields: cfg.ministration_fields || [],
    parts: { attendance: !!typeOf(cfg, e.type).attendance, ministration: !!typeOf(cfg, e.type).ministration, offering: !!typeOf(cfg, e.type).offering,
             countersign: !!typeOf(cfg, e.type).countersign },
    version: r.version || 1,
    versions: await versionsOf(env, r.id, names),
    amend: await amendState(env, cfg, r, me),
    submittedAt: r.submitted_at, countersignedAt: r.countersigned_at, verifiedAt: r.verified_at,
    submitSignature: r.submit_signature, countersignSignature: r.countersign_signature,
    history: hist.map((h) => ({ at: h.at, who: names[h.actor_id] || "", from: STATUS_LABELS[h.from_status] || h.from_status || "", to: STATUS_LABELS[h.to_status] || h.to_status, note: h.note }))
  };
}

/* Open the report screen for an event. Anybody signed in may open it; what
   they can do there is decided here. */
async function aReportOpen(env, cfg, b, me) {
  let r = null, e;
  if (b.reportId) {
    r = await env.DB.prepare("SELECT * FROM reports WHERE id=?").bind(text(b.reportId, 20)).first();
    if (!r) fail(404, "no_report", "That report was not found.");
    e = await getEvent(env, r.event_id);
  } else {
    e = await getEvent(env, b.eventId);
    r = await env.DB.prepare("SELECT * FROM reports WHERE event_id=?").bind(e.id).first();
  }
  const t = typeOf(cfg, e.type);
  const sub = await submitAuthority(env, me, e);
  const out = {
    ok: true,
    event: { id: e.id, title: e.title, date: e.date, type: e.type, status: e.status, thanksgiving: !!e.thanksgiving,
             attendance: !!t.attendance, ministration: !!t.ministration, offering: !!t.offering, countersign: !!t.countersign },
    ministrationFields: cfg.ministration_fields || [],
    canSubmit: sub.ok && (!r || r.status === "draft") && e.status !== "cancelled",
    submitApproval: sub.ok ? (sub.auth ? "approved" : null) : (sub.pending ? "pending" : "needed"),
    report: null
  };
  if (r && (r.status === "draft" ? (r.submitter_id === me.usher.id || await canSeeReport(env, me, r)) : await canSeeReport(env, me, r))) {
    out.report = await reportView(env, cfg, r, me);
  } else if (r && r.status !== "draft") {
    out.report = { id: r.id, status: r.status, statusLabel: STATUS_LABELS[r.status], restricted: true };
  }
  return out;
}

async function aReportDraft(env, cfg, b, me) {
  const e = await getEvent(env, b.eventId);
  const t = typeOf(cfg, e.type);
  const sub = await submitAuthority(env, me, e);
  if (!sub.ok) return { ok: true, kept: "device" };
  let r = await env.DB.prepare("SELECT * FROM reports WHERE event_id=?").bind(e.id).first();
  if (r && r.status !== "draft") fail(409, "already_submitted", "This report has already been submitted.");
  const c = cleanReport(cfg, t, b);
  const now = Date.now();
  const id = r ? r.id : await nextId(env, "report", "R", 4);
  const st = [];
  if (!r) {
    st.push(env.DB.prepare("INSERT INTO reports (id, event_id, status, submitter_id, countersign_required, male, female, children, attendance_total, offering_total, notes, ministration_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, e.id, "draft", me.usher.id, t.countersign ? 1 : 0, c.male, c.female, c.children, c.total, c.offeringTotal, c.notes, JSON.stringify(c.ministration), now, now));
    st.push(env.DB.prepare("INSERT INTO report_history (report_id, at, actor_id, from_status, to_status) VALUES (?,?,?,?,?)").bind(id, now, me.usher.id, "", "draft"));
  } else {
    st.push(env.DB.prepare("UPDATE reports SET submitter_id=?, male=?, female=?, children=?, attendance_total=?, offering_total=?, notes=?, ministration_json=?, updated_at=? WHERE id=? AND status='draft'")
      .bind(me.usher.id, c.male, c.female, c.children, c.total, c.offeringTotal, c.notes, JSON.stringify(c.ministration), now, id));
  }
  st.push(env.DB.prepare("DELETE FROM offering_entries WHERE report_id=?").bind(id));
  for (const x of c.entries) {
    st.push(env.DB.prepare("INSERT INTO offering_entries (report_id, line_no, category, currency, denomination, quantity, amount) VALUES (?,?,?,?,?,?,?)")
      .bind(id, x.line_no, x.category, x.currency, x.denomination, x.quantity, x.amount));
  }
  await run(env, st);
  return { ok: true, kept: "server", reportId: id, attendanceTotal: c.total, offeringTotal: c.offeringTotal, byCategory: c.byCategory };
}

async function aReportSubmit(env, cfg, b, me) {
  const sid = String(b.submissionId || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(sid)) fail(400, "submission_id", "A submission id is needed.");
  /* The same submission arriving twice (a retry after a lost answer) is the
     same report, filed once. */
  const dup = await env.DB.prepare("SELECT * FROM reports WHERE submission_id=?").bind(sid).first();
  if (dup) return { ok: true, duplicate: true, report: await reportView(env, cfg, dup, me) };

  const e = await getEvent(env, b.eventId);
  if (e.status === "cancelled") fail(409, "cancelled", "This event was cancelled.");
  const t = typeOf(cfg, e.type);
  let r = await env.DB.prepare("SELECT * FROM reports WHERE event_id=?").bind(e.id).first();
  if (r && r.status !== "draft") fail(409, "already_submitted", "This report has already been submitted.");

  const sub = await submitAuthority(env, me, e);
  if (!sub.ok) {
    const req = await authRequest(env, cfg, { kind: "report_submission", subjectId: me.usher.id, targetType: "event", targetId: e.id,
      requestedBy: me.usher.id, reason: text(b.reason, 300) || "Not on the rota for this event",
      describe: me.usher.full_name + " asks to submit the report for " + e.title + " on " + ukDate(e.date) + "." });
    await run(env, req.statements);
    return { ok: false, error: "needs_authorisation", message: "Approval is needed before you can submit. The coordinator has been asked.", authorisationId: req.id };
  }

  const c = cleanReport(cfg, t, b);
  const signature = checkSignature(me, b.signature);
  let cs = null;
  if (t.countersign) {
    cs = await getUsher(env, text(b.countersignerId, 20));
    if (!cs || !cs.active) fail(400, "countersigner", "Choose who will countersign.");
    if (cs.id === me.usher.id) fail(400, "self_countersign", "Somebody else must countersign your report.");
  }
  const pinCheck = await signingCheck(env, cfg, me, b);

  const now = Date.now();
  const id = r ? r.id : await nextId(env, "report", "R", 4);
  const finalStatus = t.countersign ? "pending_countersignature" : "verified";
  const names = await namesMap(env);
  const st = [];
  if (!r) {
    st.push(env.DB.prepare("INSERT INTO reports (id, event_id, status, created_at, updated_at) VALUES (?,?,?,?,?)").bind(id, e.id, "draft", now, now));
    st.push(env.DB.prepare("INSERT INTO report_history (report_id, at, actor_id, from_status, to_status) VALUES (?,?,?,?,?)").bind(id, now, me.usher.id, "", "draft"));
  }
  st.push(env.DB.prepare(
    "UPDATE reports SET status=?, submitter_id=?, countersigner_id=?, countersign_required=?, male=?, female=?, children=?, attendance_total=?, offering_total=?, notes=?, ministration_json=?, submission_id=?, submit_signature=?, submitted_at=?, submit_pin_check=?, verified_at=?, updated_at=?, version=1 WHERE id=? AND status='draft'"
  ).bind(finalStatus, me.usher.id, cs ? cs.id : null, t.countersign ? 1 : 0, c.male, c.female, c.children, c.total, c.offeringTotal, c.notes,
         JSON.stringify(c.ministration), sid, signature, now, pinCheck, t.countersign ? null : now, now, id));
  st.push(env.DB.prepare("DELETE FROM offering_entries WHERE report_id=?").bind(id));
  for (const x of c.entries) {
    st.push(env.DB.prepare("INSERT INTO offering_entries (report_id, line_no, category, currency, denomination, quantity, amount) VALUES (?,?,?,?,?,?,?)")
      .bind(id, x.line_no, x.category, x.currency, x.denomination, x.quantity, x.amount));
  }
  st.push(env.DB.prepare("INSERT INTO report_history (report_id, at, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?,?)")
    .bind(id, now, me.usher.id, "draft", "submitted", pinCheck === "device" ? "Signed with no signal; PIN checked on the phone" : ""));
  st.push(env.DB.prepare("INSERT INTO report_history (report_id, at, actor_id, from_status, to_status) VALUES (?,?,?,?,?)")
    .bind(id, now, me.usher.id, "submitted", finalStatus));
  if (sub.auth) st.push(stConsume(env, sub.auth, names));

  let csState = null;
  if (cs) {
    if (await countersignAuthority(env, cfg, cs.id, e.id)) {
      csState = "authorised";
      st.push(stNotify(env, cfg, cs, "countersign_request", "Please countersign: " + e.title + " " + ukDate(e.date),
        me.usher.full_name + " has submitted the report and chosen you to countersign it.", "report", id));
    } else {
      /* Select first, check authority second: the choice stands and an
         approver is asked. */
      const req = await authRequest(env, cfg, { kind: "countersign", subjectId: cs.id, targetType: "report", targetId: id, me,
        requestedBy: me.usher.id, reason: "Chosen to countersign without countersigning authority",
        describe: me.usher.full_name + " chose " + cs.full_name + " to countersign " + e.title + " on " + ukDate(e.date) + ". Approve?" });
      st.push(req.statements);
      csState = req.status === "approved" ? "authorised" : "approval_requested";
    }
  }
  const rec = { id, event_id: e.id, status: finalStatus, submitter_id: me.usher.id, countersigner_id: cs ? cs.id : null,
    male: c.male, female: c.female, children: c.children, attendance_total: c.total, offering_total: c.offeringTotal, notes: c.notes,
    submission_id: sid, submitted_at: now, submit_pin_check: pinCheck, verified_at: t.countersign ? null : now, updated_at: now, version: 1 };
  if (!t.countersign) {
    st.push(await stReportFiled(env, cfg, rec, e, "Report filed",
      me.usher.full_name + " signed and filed the report. This event needs no countersignature.", [me.usher.id]));
  }
  st.push(stAudit(env, me.usher.id, "report.submit", "report", id, null,
    { status: finalStatus, attendance: c.total, offering: c.offeringTotal, countersigner: cs ? cs.id : "", pinCheck }, ""));
  st.push(stOutbox(env, "REPORTS", reportRow(rec, e, names), "REPORT_ID"));
  st.push(stReportParts(env, cfg, t, rec, e, c.entries, c.ministration, true));
  await run(env, st);
  const fresh = await env.DB.prepare("SELECT * FROM reports WHERE id=?").bind(id).first();
  return { ok: true, countersigner: csState, report: await reportView(env, cfg, fresh, me) };
}

async function aReportCountersign(env, cfg, b, me) {
  const sid = String(b.submissionId || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(sid)) fail(400, "submission_id", "A submission id is needed.");
  const dup = await env.DB.prepare("SELECT * FROM reports WHERE countersign_submission_id=?").bind(sid).first();
  if (dup) return { ok: true, duplicate: true, report: await reportView(env, cfg, dup, me) };
  const r = await env.DB.prepare("SELECT * FROM reports WHERE id=?").bind(text(b.reportId, 20)).first();
  if (!r) fail(404, "no_report", "That report was not found.");
  if (r.status !== "pending_countersignature") fail(409, "not_pending", "This report is not waiting for a countersignature.");
  if (b.version != null && Number(b.version) !== Number(r.version || 1)) fail(409, "changed", "This report was amended after you opened it. Open it again and check it before countersigning.");
  if (r.countersigner_id !== me.usher.id) fail(403, "not_countersigner", "You are not the countersigner for this report.");
  if (r.submitter_id === me.usher.id) fail(403, "self_countersign", "Somebody else must countersign your report.");
  let auth = null;
  if (!(await countersignAuthority(env, cfg, me.usher.id, r.event_id))) {
    auth = await findAuth(env, "countersign", me.usher.id, "report", r.id, ["approved"]);
    if (!auth) {
      const pending = await findAuth(env, "countersign", me.usher.id, "report", r.id, ["pending"]);
      if (pending) fail(409, "awaiting_approval", "Waiting for the coordinator to approve you as countersigner.");
      fail(403, "not_authorised", "You are not authorised to countersign this report.");
    }
  }
  const signature = checkSignature(me, b.signature);
  const pinCheck = await signingCheck(env, cfg, me, b);
  const now = Date.now();
  const e = await getEvent(env, r.event_id);
  const names = await namesMap(env);
  const after = Object.assign({}, r, { status: "verified", countersign_submission_id: sid, countersign_signature: signature,
    countersigned_at: now, countersign_pin_check: pinCheck, countersign_auth_id: auth ? auth.id : null, verified_at: now, updated_at: now });
  const st = [
    env.DB.prepare("UPDATE reports SET status='verified', countersign_submission_id=?, countersign_signature=?, countersigned_at=?, countersign_pin_check=?, countersign_auth_id=?, verified_at=?, updated_at=? WHERE id=? AND status='pending_countersignature'")
      .bind(sid, signature, now, pinCheck, auth ? auth.id : null, now, now, r.id),
    env.DB.prepare("INSERT INTO report_history (report_id, at, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?,?)")
      .bind(r.id, now, me.usher.id, "pending_countersignature", "verified", auth ? "Countersigned with the coordinator's approval" : ""),
    stAudit(env, me.usher.id, "report.countersign", "report", r.id, { status: r.status }, { status: "verified", pinCheck, authorisation: auth ? auth.id : "" }, ""),
    stOutbox(env, "REPORTS", reportRow(after, e, names), "REPORT_ID"),
    stNotify(env, cfg, await getUsher(env, r.submitter_id), "report_status", "Verified: " + e.title + " " + ukDate(e.date),
      me.usher.full_name + " has countersigned the report.", "report", r.id),
    await stReportFiled(env, cfg, after, e, (r.version || 1) > 1 ? "Amended report filed" : "Report filed",
      (names[r.submitter_id] || "The submitter") + " submitted the report and " + me.usher.full_name + " countersigned it.", [me.usher.id, r.submitter_id])
  ];
  if (auth) st.push(stConsume(env, auth, names));
  /* Any other request about countersigning this report no longer applies. */
  const open = ((await env.DB.prepare("SELECT * FROM authorisations WHERE kind='countersign' AND target_type='report' AND target_id=? AND status IN ('pending','approved')").bind(r.id).all()).results) || [];
  for (const a of open) if (!auth || a.id !== auth.id) st.push(stCancelAuth(env, a, "Report countersigned", names, now));
  await run(env, st);
  return { ok: true, report: await reportView(env, cfg, after, me) };
}

/* ---- amendments ----------------------------------------------------------
   A submitted report is never overwritten in place. An amendment keeps the
   version it replaces, whole, in report_versions; the report gets a new
   version number, a new signature and, where the event type asks for it, a
   new countersignature, even when an approver makes the amendment. Anybody
   who is not an approver needs an approved request first, used once. */

async function versionsOf(env, reportId, names) {
  const rows = ((await env.DB.prepare("SELECT * FROM report_versions WHERE report_id=? ORDER BY version").bind(reportId).all()).results) || [];
  return rows.map((v) => {
    let snap = {};
    try { snap = JSON.parse(v.snapshot_json || "{}"); } catch (e) {}
    const r = snap.report || {};
    return { version: v.version, replacedAt: v.replaced_at, replacedBy: names[v.replaced_by] || "", reason: v.reason,
      submitter: names[r.submitter_id] || "", countersigner: names[r.countersigner_id] || "",
      status: STATUS_LABELS[r.status] || r.status || "", attendance: { male: r.male, female: r.female, children: r.children, total: r.attendance_total },
      offeringTotal: r.offering_total, ministration: snap.ministration || {}, entries: snap.entries || [], notes: r.notes || "" };
  });
}

function mayTouchReport(me, r) {
  return me.perms.has("exceptions.approve") || me.perms.has("reports.submit_any") ||
         r.submitter_id === me.usher.id || r.countersigner_id === me.usher.id;
}

/* { possible, approver, approval: null | "needed" | "pending" | "approved" } */
async function amendState(env, cfg, r, me) {
  if (r.status !== "verified" && r.status !== "pending_countersignature") return { possible: false };
  const approver = me.perms.has("exceptions.approve");
  if (!approver && !mayTouchReport(me, r) && !(await isAppointed(env, me.usher.id, r.event_id))) return { possible: false };
  if (approver) return { possible: true, approver: true, approval: null };
  if (await findAuth(env, "report_amendment", me.usher.id, "report", r.id, ["approved"])) return { possible: true, approver: false, approval: "approved" };
  if (await findAuth(env, "report_amendment", me.usher.id, "report", r.id, ["pending"])) return { possible: true, approver: false, approval: "pending" };
  return { possible: true, approver: false, approval: "needed" };
}

async function aReportAmend(env, cfg, b, me) {
  const aid = String(b.amendmentId || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(aid)) fail(400, "amendment_id", "An amendment id is needed.");
  const dup = await env.DB.prepare("SELECT report_id FROM report_versions WHERE amend_submission_id=?").bind(aid).first();
  if (dup) {
    const r0 = await env.DB.prepare("SELECT * FROM reports WHERE id=?").bind(dup.report_id).first();
    return { ok: true, duplicate: true, report: await reportView(env, cfg, r0, me) };
  }
  const r = await env.DB.prepare("SELECT * FROM reports WHERE id=?").bind(text(b.reportId, 20)).first();
  if (!r) fail(404, "no_report", "That report was not found.");
  if (r.status !== "verified" && r.status !== "pending_countersignature") fail(409, "not_submitted", "Only a submitted report can be amended.");
  if (b.version != null && Number(b.version) !== Number(r.version || 1)) fail(409, "changed", "This report has changed since you opened it. Open it again.");
  const reason = text(b.reason, 500);
  if (reason.length < 3) fail(400, "reason", "Say why the report is being amended.");
  if (b.offline) fail(400, "online_only", "An amendment needs a signal, so the PIN can be checked.");
  const state = await amendState(env, cfg, r, me);
  if (!state.possible) fail(403, "forbidden", "You cannot amend this report.");
  const e = await getEvent(env, r.event_id);
  const names = await namesMap(env);
  if (state.approval === "needed" || state.approval === "pending") {
    const req = await authRequest(env, cfg, { kind: "report_amendment", subjectId: me.usher.id, targetType: "report", targetId: r.id, me,
      requestedBy: me.usher.id, reason,
      describe: me.usher.full_name + " asks to amend the report for " + e.title + " on " + ukDate(e.date) + ". Reason: " + reason });
    await run(env, req.statements);
    return { ok: false, error: "needs_authorisation", message: "Approval is needed before you can amend this report. The coordinator has been asked.", authorisationId: req.id };
  }
  const auth = state.approval === "approved" ? await findAuth(env, "report_amendment", me.usher.id, "report", r.id, ["approved"]) : null;

  const t = typeOf(cfg, e.type);
  const c = cleanReport(cfg, t, b);
  const signature = checkSignature(me, b.signature);
  let cs = null;
  if (t.countersign) {
    cs = await getUsher(env, text(b.countersignerId, 20));
    if (!cs || !cs.active) fail(400, "countersigner", "Choose who will countersign.");
    if (cs.id === me.usher.id) fail(400, "self_countersign", "Somebody else must countersign this report.");
  }
  await verifyPin(env, cfg, me.usher, b.pin);

  const now = Date.now();
  const oldEntries = await entriesOf(env, r.id);
  const oldMin = ministrationOf(r);
  const v = (r.version || 1) + 1;
  const finalStatus = t.countersign ? "pending_countersignature" : "verified";
  const st = [
    env.DB.prepare("INSERT INTO report_versions (report_id, version, snapshot_json, replaced_at, replaced_by, reason, amend_submission_id) VALUES (?,?,?,?,?,?,?)")
      .bind(r.id, r.version || 1, JSON.stringify({ report: r, entries: oldEntries, ministration: oldMin }), now, me.usher.id, reason, aid),
    env.DB.prepare(
      "UPDATE reports SET status=?, submitter_id=?, countersigner_id=?, male=?, female=?, children=?, attendance_total=?, offering_total=?, notes=?, ministration_json=?, " +
      "submit_signature=?, submitted_at=?, submit_pin_check='server', countersign_auth_id=NULL, countersign_submission_id=NULL, countersign_signature='', " +
      "countersigned_at=NULL, countersign_pin_check='', countersign_required=?, verified_at=?, version=?, updated_at=? WHERE id=? AND version=?"
    ).bind(finalStatus, me.usher.id, cs ? cs.id : null, c.male, c.female, c.children, c.total, c.offeringTotal, c.notes, JSON.stringify(c.ministration),
           signature, now, t.countersign ? 1 : 0, t.countersign ? null : now, v, now, r.id, r.version || 1),
    env.DB.prepare("DELETE FROM offering_entries WHERE report_id=?").bind(r.id)
  ];
  for (const x of c.entries) {
    st.push(env.DB.prepare("INSERT INTO offering_entries (report_id, line_no, category, currency, denomination, quantity, amount) VALUES (?,?,?,?,?,?,?)")
      .bind(r.id, x.line_no, x.category, x.currency, x.denomination, x.quantity, x.amount));
  }
  st.push(env.DB.prepare("INSERT INTO report_history (report_id, at, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?,?)")
    .bind(r.id, now, me.usher.id, r.status, finalStatus, "Amended to version " + v + ": " + reason + (auth ? " (with the coordinator's approval)" : "")));
  if (auth) st.push(stConsume(env, auth, names));
  /* Any countersign request for the old version no longer applies. */
  const open = ((await env.DB.prepare("SELECT * FROM authorisations WHERE kind='countersign' AND target_type='report' AND target_id=? AND status IN ('pending','approved')").bind(r.id).all()).results) || [];
  for (const a of open) st.push(stCancelAuth(env, a, "Report amended", names, now));
  let csState = null;
  if (cs) {
    if (await countersignAuthority(env, cfg, cs.id, e.id)) {
      csState = "authorised";
      st.push(stNotify(env, cfg, cs, "countersign_request", "Please countersign the amended report: " + e.title + " " + ukDate(e.date),
        me.usher.full_name + " has amended the report (" + reason + ") and chosen you to countersign it.", "report", r.id));
    } else {
      const req = await authRequest(env, cfg, { kind: "countersign", subjectId: cs.id, targetType: "report", targetId: r.id, me, fresh: true,
        requestedBy: me.usher.id, reason: "Chosen to countersign an amended report without countersigning authority",
        describe: me.usher.full_name + " chose " + cs.full_name + " to countersign the amended report for " + e.title + " on " + ukDate(e.date) + ". Approve?" });
      st.push(req.statements);
      csState = req.status === "approved" ? "authorised" : "approval_requested";
    }
  }
  if (r.submitter_id && r.submitter_id !== me.usher.id) {
    st.push(stNotify(env, cfg, await getUsher(env, r.submitter_id), "report_status", "Amended: " + e.title + " " + ukDate(e.date),
      me.usher.full_name + " amended the report you submitted. Reason: " + reason, "report", r.id));
  }
  const rec = Object.assign({}, r, { status: finalStatus, submitter_id: me.usher.id, countersigner_id: cs ? cs.id : null,
    male: c.male, female: c.female, children: c.children, attendance_total: c.total, offering_total: c.offeringTotal, notes: c.notes,
    submitted_at: now, submit_pin_check: "server", countersign_auth_id: null, countersigned_at: null, verified_at: t.countersign ? null : now,
    countersign_required: t.countersign ? 1 : 0, version: v, updated_at: now });
  if (!t.countersign) {
    st.push(await stReportFiled(env, cfg, rec, e, "Report amended",
      me.usher.full_name + " amended the report (version " + v + "). Reason: " + reason.replace(/[.!?]+$/, "") + ".", [me.usher.id, r.submitter_id]));
  }
  st.push(stAudit(env, me.usher.id, "report.amend", "report", r.id,
    { version: r.version || 1, status: r.status, attendance: r.attendance_total, offering: r.offering_total },
    { version: v, status: finalStatus, attendance: c.total, offering: c.offeringTotal, countersigner: cs ? cs.id : "" }, reason));
  st.push(stOutbox(env, "REPORTS", reportRow(rec, e, names), "REPORT_ID"));
  st.push(stOutbox(env, "REPORT_VERSIONS", {
    VERSION_ID: r.id + "-v" + (r.version || 1), REPORT_ID: r.id, VERSION: r.version || 1, EVENT_ID: e.id, DATE: e.date, EVENT_TITLE: e.title,
    STATUS_WHEN_REPLACED: STATUS_LABELS[r.status] || r.status, SUBMITTER: names[r.submitter_id] || "", COUNTERSIGNER: names[r.countersigner_id] || "",
    ATTENDANCE_TOTAL: r.attendance_total, OFFERING_TOTAL: pounds(r.offering_total), REPLACED_BY: names[me.usher.id] || "", REPLACED_BY_ID: me.usher.id,
    REPLACED_AT: londonStamp(now), REASON: reason, NEW_VERSION: v }, "VERSION_ID"));
  st.push(stReportParts(env, cfg, t, r, e, oldEntries, oldMin, false));
  st.push(stReportParts(env, cfg, t, rec, e, c.entries, c.ministration, true));
  await run(env, st);
  const fresh = await env.DB.prepare("SELECT * FROM reports WHERE id=?").bind(r.id).first();
  return { ok: true, version: v, countersigner: csState, report: await reportView(env, cfg, fresh, me) };
}

/* While a report waits, the submitter may choose somebody else. */
async function aReportCountersigner(env, cfg, b, me) {
  const r = await env.DB.prepare("SELECT * FROM reports WHERE id=?").bind(text(b.reportId, 20)).first();
  if (!r) fail(404, "no_report", "That report was not found.");
  if (r.submitter_id !== me.usher.id && !me.perms.has("reports.view_all")) fail(403, "forbidden", "Only the submitter can change this.");
  if (r.status !== "pending_countersignature") fail(409, "not_pending", "This report is not waiting for a countersignature.");
  const cs = await getUsher(env, text(b.countersignerId, 20));
  if (!cs || !cs.active) fail(400, "countersigner", "Choose who will countersign.");
  if (cs.id === r.submitter_id) fail(400, "self_countersign", "Somebody else must countersign this report.");
  const e = await getEvent(env, r.event_id);
  const names = await namesMap(env);
  const now = Date.now();
  const st = [env.DB.prepare("UPDATE reports SET countersigner_id=?, updated_at=? WHERE id=?").bind(cs.id, now, r.id)];
  const open = ((await env.DB.prepare("SELECT * FROM authorisations WHERE kind='countersign' AND target_type='report' AND target_id=? AND status IN ('pending','approved')").bind(r.id).all()).results) || [];
  const authority = await countersignAuthority(env, cfg, cs.id, e.id);
  /* Choosing the same person again keeps the request already made for them. */
  const keep = authority ? null : open.find((a) => a.subject_id === cs.id) || null;
  for (const a of open) if (!keep || a.id !== keep.id) st.push(stCancelAuth(env, a, "Countersigner changed", names, now));
  let state;
  if (authority || (keep && keep.status === "approved")) {
    state = "authorised";
    st.push(stNotify(env, cfg, cs, "countersign_request", "Please countersign: " + e.title + " " + ukDate(e.date),
      names[r.submitter_id] + " has chosen you to countersign the report.", "report", r.id));
  } else if (keep) {
    state = "approval_requested";
  } else {
    const req = await authRequest(env, cfg, { kind: "countersign", subjectId: cs.id, targetType: "report", targetId: r.id, me,
      requestedBy: me.usher.id, reason: "Chosen to countersign without countersigning authority",
      describe: names[r.submitter_id] + " chose " + cs.full_name + " to countersign " + e.title + " on " + ukDate(e.date) + ". Approve?" });
    st.push(req.statements);
    state = req.status === "approved" ? "authorised" : "approval_requested";
  }
  st.push(stAudit(env, me.usher.id, "report.countersigner", "report", r.id, { countersigner: r.countersigner_id }, { countersigner: cs.id }, text(b.reason, 200)));
  st.push(stOutbox(env, "REPORTS", reportRow(Object.assign({}, r, { countersigner_id: cs.id, updated_at: now }), e, names), "REPORT_ID"));
  await run(env, st);
  return { ok: true, countersigner: state };
}

async function aReportsList(env, cfg, b, me) {
  need(me, "reports.view_all");
  const status = Object.keys(STATUS_LABELS).indexOf(b.status) !== -1 ? b.status : "";
  const rows = ((await env.DB.prepare(
    "SELECT r.*, e.title, e.date FROM reports r JOIN events e ON e.id=r.event_id" + (status ? " WHERE r.status=?" : "") + " ORDER BY e.date DESC, e.id LIMIT 100"
  ).bind(...(status ? [status] : [])).all()).results) || [];
  const names = await namesMap(env);
  return { ok: true, reports: rows.map((r) => ({
    id: r.id, eventId: r.event_id, title: r.title, date: r.date, status: r.status, statusLabel: STATUS_LABELS[r.status],
    submitter: names[r.submitter_id] || "", countersigner: names[r.countersigner_id] || "",
    attendanceTotal: r.attendance_total, offeringTotal: r.offering_total })) };
}

/* Everyone who can be chosen as countersigner: all active ushers but you. */
async function aSelectable(env, cfg, b, me) {
  const r = await env.DB.prepare("SELECT id, full_name FROM ushers WHERE active=1 AND id<>? ORDER BY full_name COLLATE NOCASE").bind(me.usher.id).all();
  return { ok: true, people: (r.results || []).map((u) => ({ id: u.id, name: u.full_name })) };
}

/* ==========================================================================
   HOME, HISTORY, NOTIFICATIONS — the ordinary usher
   ========================================================================== */

/* "What am I doing?" */
async function aHome(env, cfg, b, me) {
  const today = londonKey(new Date());
  const thisSunday = sundayOnOrAfter(today);
  const until = keyAddDays(today, cfg.rota_weeks_ahead * 7);
  const rows = ((await env.DB.prepare(
    "SELECT a.id AS appointment_id, a.duty, e.*, r.status AS report_status, r.id AS report_id FROM appointments a JOIN events e ON e.id=a.event_id " +
    "LEFT JOIN reports r ON r.event_id=e.id WHERE a.usher_id=? AND a.status='active' AND e.date>=? AND e.date<=? ORDER BY e.date, e.start_time, e.id"
  ).bind(me.usher.id, keyAddDays(today, -6), until).all()).results) || [];
  const duty = (x) => ({
    eventId: x.id, title: x.title, date: x.date, start: x.start_time, duty: x.duty, thanksgiving: !!x.thanksgiving,
    cancelled: x.status === "cancelled", reportStatus: x.report_status || "", reportStatusLabel: STATUS_LABELS[x.report_status] || "Not started",
    reportDue: !!(cfg.event_types[x.type] || {}).attendance || !!(cfg.event_types[x.type] || {}).offering
  });
  const thisWeek = rows.filter((x) => x.date >= today && x.date <= thisSunday).map(duty);
  const later = rows.filter((x) => x.date > thisSunday).map(duty);
  const recent = rows.filter((x) => x.date < today && (!x.report_status || x.report_status === "draft")).map(duty);
  const toSign = ((await env.DB.prepare(
    "SELECT r.id, e.title, e.date, r.submitter_id FROM reports r JOIN events e ON e.id=r.event_id WHERE r.status='pending_countersignature' AND r.countersigner_id=? ORDER BY e.date"
  ).bind(me.usher.id).all()).results) || [];
  const names = await namesMap(env);
  const signList = [];
  for (const x of toSign) {
    let state = "ready";
    if (!(await countersignAuthority(env, cfg, me.usher.id, (await env.DB.prepare("SELECT event_id FROM reports WHERE id=?").bind(x.id).first()).event_id))) {
      const a = await findAuth(env, "countersign", me.usher.id, "report", x.id, ["approved", "pending", "rejected"]);
      state = a ? (a.status === "approved" ? "ready" : a.status === "pending" ? "awaiting_approval" : "rejected") : "awaiting_approval";
    }
    signList.push({ reportId: x.id, title: x.title, date: x.date, submitter: names[x.submitter_id] || "", state });
  }
  const unread = await env.DB.prepare("SELECT count(*) AS n FROM notifications WHERE usher_id=? AND read_at IS NULL").bind(me.usher.id).first();
  return {
    ok: true, today, thisSunday, thanksgiving: isThanksgiving(cfg, thisSunday), me: meView(me),
    thisWeek, later, recent, toCountersign: signList, unread: unread ? unread.n : 0
  };
}

async function aHistoryMine(env, cfg, b, me) {
  const today = londonKey(new Date());
  const rows = ((await env.DB.prepare(
    "SELECT a.duty, e.id, e.title, e.date, r.status AS report_status, r.submitter_id, r.countersigner_id FROM appointments a JOIN events e ON e.id=a.event_id " +
    "LEFT JOIN reports r ON r.event_id=e.id WHERE a.usher_id=? AND a.status='active' AND e.date<? ORDER BY e.date DESC LIMIT 100"
  ).bind(me.usher.id, today).all()).results) || [];
  const signed = ((await env.DB.prepare(
    "SELECT r.id, r.status, r.submitter_id, r.countersigner_id, e.title, e.date FROM reports r JOIN events e ON e.id=r.event_id " +
    "WHERE (r.submitter_id=? AND r.status<>'draft') OR (r.countersigner_id=? AND r.status='verified') ORDER BY e.date DESC LIMIT 100"
  ).bind(me.usher.id, me.usher.id).all()).results) || [];
  return {
    ok: true,
    duties: rows.map((x) => ({ eventId: x.id, title: x.title, date: x.date, duty: x.duty, reportStatusLabel: STATUS_LABELS[x.report_status] || "No report" })),
    reports: signed.map((x) => ({ reportId: x.id, title: x.title, date: x.date, statusLabel: STATUS_LABELS[x.status],
      role: x.submitter_id === me.usher.id ? "Submitted" : "Countersigned" }))
  };
}

async function aNotifications(env, cfg, b, me) {
  const r = await env.DB.prepare("SELECT * FROM notifications WHERE usher_id=? ORDER BY created_at DESC LIMIT 100").bind(me.usher.id).all();
  return { ok: true, notifications: (r.results || []).map((n) => ({
    id: n.id, type: n.type, title: n.title, body: n.body, refType: n.ref_type, refId: n.ref_id, at: n.created_at, read: !!n.read_at })) };
}

async function aNotificationsRead(env, cfg, b, me) {
  const now = Date.now();
  if (b.all) {
    await env.DB.prepare("UPDATE notifications SET read_at=? WHERE usher_id=? AND read_at IS NULL").bind(now, me.usher.id).run();
  } else {
    const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 200).map((x) => text(x, 40));
    for (const id of ids) {
      await env.DB.prepare("UPDATE notifications SET read_at=? WHERE id=? AND usher_id=? AND read_at IS NULL").bind(now, id, me.usher.id).run();
    }
  }
  return { ok: true };
}

/* A message from the coordinator to some or all ushers. */
async function aNotifySend(env, cfg, b, me) {
  need(me, "notifications.send");
  const title = text(b.title, 140), body = text(b.body, 1000);
  if (!title) fail(400, "title", "A title is needed.");
  let list;
  if (b.all) list = ((await env.DB.prepare("SELECT * FROM ushers WHERE active=1").all()).results) || [];
  else {
    list = [];
    for (const id of (Array.isArray(b.usherIds) ? b.usherIds : []).slice(0, 500)) {
      const u = await getUsher(env, text(id, 20));
      if (u && u.active) list.push(u);
    }
  }
  if (!list.length) fail(400, "nobody", "Choose who to send it to.");
  await run(env, [list.map((u) => stNotify(env, cfg, u, "admin_message", title, body, "", "")),
    stAudit(env, me.usher.id, "notify.send", "notification", "", null, { to: list.map((u) => u.id), title }, "")]);
  return { ok: true, sent: list.length };
}

/* ==========================================================================
   DUES — Treasurer only, apart from your own position
   ========================================================================== */

function duesPosition(cfg, payments, year, todayKey) {
  const ty = Number(todayKey.slice(0, 4)), tm = Number(todayKey.slice(5, 7));
  const months = year < ty ? 12 : year > ty ? 0 : tm;
  const expected = Math.min(cfg.dues_annual_pence, cfg.dues_monthly_pence * months);
  const live = payments.filter((p) => !p.voided_at && p.year === year);
  const paid = live.reduce((s, p) => s + p.amount, 0);
  const status = paid === expected ? "Up to date" : paid < expected ? "Behind" : "Ahead";
  return {
    year, expected, paid, outstanding: Math.max(0, expected - paid),
    annualTarget: cfg.dues_annual_pence, annualRemaining: Math.max(0, cfg.dues_annual_pence - paid), status,
    payments: live.map((p) => ({ id: p.id, paidOn: p.paid_on, amount: p.amount, method: p.method, note: p.note }))
  };
}

async function paymentsOf(env, usherId) {
  return ((await env.DB.prepare("SELECT * FROM dues_payments WHERE usher_id=? ORDER BY paid_on, recorded_at").bind(usherId).all()).results) || [];
}

function yearsOf(payments, thisYear) {
  const ys = new Set([thisYear]);
  for (const p of payments) ys.add(p.year);
  return Array.from(ys).sort((a, b) => b - a);
}

async function aDuesMine(env, cfg, b, me) {
  const today = londonKey(new Date()), y = Number(today.slice(0, 4));
  const pays = await paymentsOf(env, me.usher.id);
  return { ok: true, monthly: cfg.dues_monthly_pence, years: yearsOf(pays, y).map((yr) => duesPosition(cfg, pays, yr, today)) };
}

async function aDuesOverview(env, cfg, b, me) {
  need(me, "dues.view_all");
  const today = londonKey(new Date());
  const year = Number(b.year) || Number(today.slice(0, 4));
  const ushers = ((await env.DB.prepare("SELECT * FROM ushers WHERE active=1 ORDER BY full_name COLLATE NOCASE").all()).results) || [];
  const all = ((await env.DB.prepare("SELECT * FROM dues_payments WHERE year=?").bind(year).all()).results) || [];
  const members = ushers.map((u) => {
    const pos = duesPosition(cfg, all.filter((p) => p.usher_id === u.id), year, today);
    return { usherId: u.id, name: u.full_name, expected: pos.expected, paid: pos.paid, outstanding: pos.outstanding, status: pos.status };
  });
  const sum = (k) => members.reduce((s, m) => s + m[k], 0);
  return { ok: true, year, members, totals: { expected: sum("expected"), paid: sum("paid"), outstanding: sum("outstanding"),
    behind: members.filter((m) => m.status === "Behind").length } };
}

async function aDuesMember(env, cfg, b, me) {
  need(me, "dues.view_all");
  const u = await getUsher(env, text(b.usherId, 20));
  if (!u) fail(404, "no_usher", "Not found.");
  const today = londonKey(new Date()), y = Number(today.slice(0, 4));
  const pays = await paymentsOf(env, u.id);
  return { ok: true, name: u.full_name, years: yearsOf(pays, y).map((yr) => duesPosition(cfg, pays, yr, today)) };
}

function duesRow(p, names, status) {
  return {
    PAYMENT_ID: p.id, USHER_ID: p.usher_id, FULL_NAME: names[p.usher_id] || "", YEAR: p.year, PAID_ON: p.paid_on,
    AMOUNT: pounds(p.amount), METHOD: p.method || "", NOTE: p.note || "", RECORDED_BY: p.recorded_by,
    RECORDED_AT: londonStamp(p.recorded_at), STATUS: status, VOID_REASON: p.void_reason || ""
  };
}

async function aDuesRecord(env, cfg, b, me) {
  need(me, "dues.record");
  const u = await getUsher(env, text(b.usherId, 20));
  if (!u) fail(404, "no_usher", "Not found.");
  if (!validKey(b.paidOn)) fail(400, "date", "The date paid is needed.");
  const amount = Math.round(Number(b.amountPence));
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000) fail(400, "amount", "Enter an amount.");
  const year = Number(b.year) || Number(String(b.paidOn).slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) fail(400, "year", "Enter the dues year.");
  const p = { id: await nextId(env, "payment", "P", 5), usher_id: u.id, paid_on: b.paidOn, year, amount,
              method: text(b.method, 30), note: text(b.note, 200), recorded_by: me.usher.id, recorded_at: Date.now() };
  const names = await namesMap(env);
  await run(env, [
    env.DB.prepare("INSERT INTO dues_payments (id, usher_id, paid_on, year, amount, method, note, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(p.id, p.usher_id, p.paid_on, p.year, p.amount, p.method, p.note, p.recorded_by, p.recorded_at),
    stAudit(env, me.usher.id, "dues.record", "dues_payment", p.id, null, { usher: u.id, year, amount, paidOn: p.paid_on }, p.note),
    stOutbox(env, "DUES", duesRow(p, names, "Recorded"), "PAYMENT_ID")
  ]);
  return { ok: true, paymentId: p.id };
}

async function aDuesVoid(env, cfg, b, me) {
  need(me, "dues.record");
  const p = await env.DB.prepare("SELECT * FROM dues_payments WHERE id=?").bind(text(b.id, 20)).first();
  if (!p) fail(404, "no_payment", "Not found.");
  if (p.voided_at) fail(409, "voided", "Already voided.");
  const reason = text(b.reason, 200);
  if (!reason) fail(400, "reason", "Say why.");
  const now = Date.now(), names = await namesMap(env);
  await run(env, [
    env.DB.prepare("UPDATE dues_payments SET voided_by=?, voided_at=?, void_reason=? WHERE id=?").bind(me.usher.id, now, reason, p.id),
    stAudit(env, me.usher.id, "dues.void", "dues_payment", p.id, { amount: p.amount, status: "Recorded" }, { status: "Voided" }, reason),
    stOutbox(env, "DUES", duesRow(Object.assign({}, p, { void_reason: reason }), names, "Voided"), "PAYMENT_ID")
  ]);
  return { ok: true };
}

async function aDuesRemind(env, cfg, b, me) {
  need(me, "dues.remind");
  const today = londonKey(new Date()), y = Number(today.slice(0, 4));
  const ushers = ((await env.DB.prepare("SELECT * FROM ushers WHERE active=1").all()).results) || [];
  const only = Array.isArray(b.usherIds) && b.usherIds.length ? b.usherIds : null;
  const st = [];
  let n = 0;
  for (const u of ushers) {
    if (only && only.indexOf(u.id) === -1) continue;
    const pos = duesPosition(cfg, await paymentsOf(env, u.id), y, today);
    if (pos.status !== "Behind") continue;
    n++;
    st.push(stNotify(env, cfg, u, "dues_reminder", "Department dues reminder",
      "Your " + y + " dues: £" + pounds(pos.paid).toFixed(2) + " paid, £" + pounds(pos.outstanding).toFixed(2) + " outstanding to date.", "dues", String(y)));
  }
  st.push(stAudit(env, me.usher.id, "dues.remind", "dues", String(y), null, { sent: n }, ""));
  await run(env, st);
  return { ok: true, sent: n };
}

/* ==========================================================================
   THE COORDINATOR DASHBOARD
   ==========================================================================
   On a Sunday: today. Monday to Saturday: the most recent Sunday, so the
   screen is never empty. Either way, next Sunday's full rota beside it. */

async function sundaySummary(env, cfg, key, me) {
  const events = ((await env.DB.prepare("SELECT * FROM events WHERE sunday_key=? AND status<>'cancelled' ORDER BY id").bind(key).all()).results) || [];
  const names = await namesMap(env);
  const services = [];
  const total = { attendance: { male: 0, female: 0, children: 0, total: 0 }, offering: {}, offeringTotal: 0 };
  for (const c of cfg.offering_categories) total.offering[c] = 0;
  let received = 0, outstanding = 0, pendingCs = 0;
  for (const e of events) {
    const t = cfg.event_types[e.type] || {};
    const r = await env.DB.prepare("SELECT * FROM reports WHERE event_id=?").bind(e.id).first();
    const s = { eventId: e.id, title: e.title, reportStatus: r ? r.status : "", reportStatusLabel: r ? STATUS_LABELS[r.status] : "Not started",
      reportId: r && r.status !== "draft" ? r.id : "", submitter: r ? names[r.submitter_id] || "" : "", countersigner: r ? names[r.countersigner_id] || "" : "",
      attendance: null, offering: null, offeringTotal: 0, ministration: null, version: r ? r.version || 1 : 0 };
    if (r && r.status !== "draft") {
      received++;
      if (t.ministration) s.ministration = ministrationOf(r);
      if (r.status === "pending_countersignature") pendingCs++;
      if (t.attendance) {
        s.attendance = { male: r.male, female: r.female, children: r.children, total: r.attendance_total };
        for (const k of ["male", "female", "children", "total"]) total.attendance[k] += s.attendance[k];
      }
      s.offering = {};
      for (const x of await entriesOf(env, r.id)) s.offering[x.category] = (s.offering[x.category] || 0) + x.amount;
      s.offeringTotal = r.offering_total;
      for (const c of Object.keys(s.offering)) total.offering[c] = (total.offering[c] || 0) + s.offering[c];
      total.offeringTotal += r.offering_total;
    } else if (t.attendance || t.offering) outstanding++;
    services.push(s);
  }
  return { sunday: key, thanksgiving: isThanksgiving(cfg, key), services, totals: total, ministrationFields: cfg.ministration_fields || [],
           reporting: { received, outstanding, pendingCountersignature: pendingCs } };
}

async function aDashboard(env, cfg, b, me) {
  need(me, "dashboard.view");
  const today = londonKey(new Date());
  const isSunday = keyDow(today) === 0;
  const focus = sundayOnOrBefore(today);
  const next = isSunday ? keyAddDays(today, 7) : sundayOnOrAfter(today);
  await ensureSunday(env, cfg, focus, "system");
  await ensureSunday(env, cfg, next, "system");
  const current = await sundaySummary(env, cfg, focus, me);
  const approvals = await env.DB.prepare("SELECT count(*) AS n FROM authorisations WHERE status='pending'").first();
  current.reporting.approvalRequests = approvals ? approvals.n : 0;
  const nextRota = await rotaWindow(env, cfg, next, 1, me, false);
  const upcoming = await rotaWindow(env, cfg, keyAddDays(today, 1), 3, me, false);
  const outstandingOld = ((await env.DB.prepare(
    "SELECT e.id, e.title, e.date FROM events e LEFT JOIN reports r ON r.event_id=e.id WHERE e.date<? AND e.date>=? AND e.status<>'cancelled' AND (r.id IS NULL OR r.status='draft') ORDER BY e.date DESC"
  ).bind(focus, keyAddDays(focus, -42)).all()).results) || [];
  return {
    ok: true, today, isSunday, currentLabel: isSunday ? "Today" : "Most recent Sunday",
    current, next: nextRota.sundays[0] || { sunday: next, services: [] },
    otherEvents: upcoming.events,
    olderOutstanding: outstandingOld.map((e) => ({ eventId: e.id, title: e.title, date: e.date }))
  };
}

/* ==========================================================================
   USHERS AND ROLES — Admin
   ========================================================================== */

async function aUshersList(env, cfg, b, me) {
  need(me, "ushers.view");
  const rows = ((await env.DB.prepare(
    "SELECT u.*, group_concat(r.role) AS roles FROM ushers u LEFT JOIN user_roles r ON r.usher_id=u.id GROUP BY u.id ORDER BY u.full_name COLLATE NOCASE"
  ).all()).results) || [];
  return { ok: true, ushers: rows.map((u) => ({
    usherId: u.id, name: u.full_name, email: u.email, phone: u.phone, active: !!u.active, hasPin: !!u.pin_hash,
    roles: String(u.roles || "").split(",").filter(Boolean) })),
    canManage: me.perms.has("ushers.manage"), canGrantAny: me.perms.has("roles.grant_any") };
}

async function aUsherSave(env, cfg, b, me) {
  need(me, "ushers.manage");
  const name = text(b.name, 80);
  if (!name) fail(400, "name", "A full name is needed.");
  const email = text(b.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "email", "That email address does not look right.");
  const phone = text(b.phone, 30);
  const now = Date.now();
  if (b.usherId) {
    const before = await getUsher(env, text(b.usherId, 20));
    if (!before) fail(404, "no_usher", "Not found.");
    const active = b.active === undefined ? before.active : (b.active ? 1 : 0);
    if (!active && before.id === me.usher.id) fail(400, "self", "You cannot deactivate yourself.");
    const after = Object.assign({}, before, { full_name: name, email, phone, active, updated_at: now });
    const st = [
      env.DB.prepare("UPDATE ushers SET full_name=?, email=?, phone=?, active=?, updated_at=? WHERE id=?").bind(name, email, phone, active, now, before.id),
      stAudit(env, me.usher.id, "usher.update", "usher", before.id,
        { name: before.full_name, email: before.email, phone: before.phone, active: before.active },
        { name, email, phone, active }, text(b.reason, 200)),
      stOutbox(env, "USHERS", usherRow(after, await rolesOf(env, before.id)), "USHER_ID")
    ];
    if (!active) st.push(env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE usher_id=? AND revoked_at IS NULL").bind(now, before.id));
    await run(env, st);
    return { ok: true, usherId: before.id };
  }
  const id = await nextId(env, "usher", "U", 3);
  const u = { id, full_name: name, email, phone, active: 1, created_at: now, updated_at: now };
  /* The first PIN is the default PIN; a typed PIN only when there is no
     default. Either way they are asked at first sign-in whether to keep it,
     unless a System Administrator says otherwise (test people). */
  const start = phoneDefaultPin(phone) || (b.pin ? String(b.pin) : "");
  let pin = null;
  if (start) pin = await newPinFields(env, cfg, start);
  const mustChange = pin && !(b.mustChange === false && me.perms.has("roles.grant_any")) ? 1 : 0;
  await run(env, [
    env.DB.prepare("INSERT INTO ushers (id, full_name, email, phone, active, pin_salt, pin_hash, pin_iter, pin_set_at, pin_must_change, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, name, email, phone, 1, pin && pin.pin_salt, pin && pin.pin_hash, pin && pin.pin_iter, pin && pin.pin_set_at, mustChange, now, now),
    env.DB.prepare("INSERT INTO user_roles (usher_id, role, granted_by, granted_at) VALUES (?,?,?,?)").bind(id, "usher", me.usher.id, now),
    stAudit(env, me.usher.id, "usher.create", "usher", id, null, { name, email, phone, roles: ["usher"] }, ""),
    stOutbox(env, "USHERS", usherRow(Object.assign(u, pin || {}), ["usher"]), "USHER_ID"),
    pin ? stAuthLog(env, id, "pin_set", "by " + me.usher.id) : null
  ]);
  return { ok: true, usherId: id, pinFrom: pin ? (phoneDefaultPin(phone) ? "default" : "typed") : "" };
}

async function aUsherRoles(env, cfg, b, me) {
  need(me, "roles.manage");
  const u = await getUsher(env, text(b.usherId, 20));
  if (!u) fail(404, "no_usher", "Not found.");
  const want = Array.from(new Set((Array.isArray(b.roles) ? b.roles : []).map((r) => text(r, 30))));
  for (const r of want) if (ROLES.indexOf(r) === -1) fail(400, "role", "Unknown role.");
  const have = await rolesOf(env, u.id);
  const add = want.filter((r) => have.indexOf(r) === -1), drop = have.filter((r) => want.indexOf(r) === -1);
  if (!me.perms.has("roles.grant_any")) {
    for (const r of add.concat(drop)) if (ROLES_GRANTABLE.indexOf(r) === -1) {
      fail(403, "forbidden", "Only a System Administrator can change the " + ROLE_LABELS[r] + " role.");
    }
  }
  if (u.id === me.usher.id && drop.indexOf("system_admin") !== -1) fail(400, "self", "You cannot remove your own System Administrator role.");
  const now = Date.now();
  const st = [];
  for (const r of add) st.push(env.DB.prepare("INSERT INTO user_roles (usher_id, role, granted_by, granted_at) VALUES (?,?,?,?)").bind(u.id, r, me.usher.id, now));
  for (const r of drop) st.push(env.DB.prepare("DELETE FROM user_roles WHERE usher_id=? AND role=?").bind(u.id, r));
  if (!add.length && !drop.length) return { ok: true, changed: false };
  st.push(stAudit(env, me.usher.id, "roles.change", "usher", u.id, { roles: have }, { roles: want }, text(b.reason, 200)));
  st.push(stOutbox(env, "USHERS", usherRow(u, want), "USHER_ID"));
  await run(env, st);
  return { ok: true, changed: true };
}

async function aUsherResetPin(env, cfg, b, me) {
  need(me, "ushers.manage");
  const u = await getUsher(env, text(b.usherId, 20));
  if (!u) fail(404, "no_usher", "Not found.");
  /* A reset drops back to the default PIN. A typed PIN is only for
     someone with no phone number on file. */
  const start = phoneDefaultPin(u.phone) || (b.pin ? String(b.pin) : "");
  if (!start) fail(400, "no_default_pin", "They have no default PIN yet. Type a starting PIN.");
  const pin = await newPinFields(env, cfg, start);
  const mustChange = b.mustChange === false && me.perms.has("roles.grant_any") ? 0 : 1;
  const now = Date.now();
  await run(env, [
    env.DB.prepare("UPDATE ushers SET pin_salt=?, pin_hash=?, pin_iter=?, pin_set_at=?, pin_must_change=?, updated_at=? WHERE id=?")
      .bind(pin.pin_salt, pin.pin_hash, pin.pin_iter, pin.pin_set_at, mustChange, now, u.id),
    env.DB.prepare("DELETE FROM pin_failures WHERE usher_id=?").bind(u.id),
    env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE usher_id=? AND revoked_at IS NULL").bind(now, u.id),
    stAudit(env, me.usher.id, "pin.reset", "usher", u.id, null, null, text(b.reason, 200) || "PIN set by administrator"),
    stAuthLog(env, u.id, "pin_set", "by " + me.usher.id),
    stOutbox(env, "USHERS", usherRow(Object.assign({}, u, pin, { updated_at: now }), await rolesOf(env, u.id)), "USHER_ID")
  ]);
  return { ok: true, pinFrom: phoneDefaultPin(u.phone) ? "default" : "typed" };
}

/* ==========================================================================
   CONFIGURATION AND AUDIT — System Administrator
   ========================================================================== */

async function aConfigGet(env, cfg, b, me) {
  need(me, "config.manage");
  return { ok: true, config: cfg, defaults: DEFAULT_CONFIG };
}

async function aConfigSet(env, cfg, b, me) {
  need(me, "config.manage");
  const k = text(b.key, 60);
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) fail(400, "key", "Unknown setting.");
  const def = DEFAULT_CONFIG[k];
  const v = b.value;
  if (def !== null && typeof v !== typeof def) fail(400, "type", "That setting takes a " + (Array.isArray(def) ? "list" : typeof def) + ".");
  if (Array.isArray(def) !== Array.isArray(v)) fail(400, "type", "That setting takes a list.");
  if (k === "ministration_fields") {
    const seen = {};
    if (v.length > 30) fail(400, "type", "At most 30 ministration lines.");
    for (const f of v) {
      if (!f || !/^[a-z][a-z0-9_]{0,30}$/.test(String(f.key)) || seen[f.key] || !text(f.label, 60) || (f.kind !== "text" && f.kind !== "number")) {
        fail(400, "type", "Each ministration line needs a key (lower case letters, numbers, _), a label and a kind of text or number.");
      }
      seen[f.key] = 1;
    }
  }
  if (k === "report_notify_roles" && v.some((x) => ROLES.indexOf(x) === -1)) fail(400, "type", "Each entry must be one of: " + ROLES.join(", ") + ".");
  const now = Date.now();
  await run(env, [
    env.DB.prepare("INSERT INTO config (k, v, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
      .bind(k, JSON.stringify(v), me.usher.id, now),
    stAudit(env, me.usher.id, "config.set", "config", k, cfg[k], v, text(b.reason, 200)),
    stOutbox(env, "CONFIG", { KEY: k, VALUE: JSON.stringify(v), UPDATED_BY: me.usher.id, UPDATED_AT: londonStamp(now) }, "KEY")
  ]);
  return { ok: true };
}

async function aAuditList(env, cfg, b, me) {
  need(me, "audit.view");
  const r = await env.DB.prepare("SELECT * FROM audit ORDER BY at DESC LIMIT 200").all();
  const names = await namesMap(env);
  return { ok: true, audit: (r.results || []).map((a) => ({ at: a.at, who: names[a.actor_id] || a.actor_id, action: a.action,
    target: a.target_type + (a.target_id ? " " + a.target_id : ""), before: a.before_json, after: a.after_json, reason: a.reason })) };
}

/* ==========================================================================
   THE SHEET — Apps Script pulls, writes, acknowledges
   ========================================================================== */

const CLAIM_MS = 5 * 60000;

function sheetTokenOk(env, b) {
  const want = String(env.SHEET_TOKEN || "");
  return !!want && sameHex(String((b && b.sheetToken) || ""), want);
}

async function aSheetPull(env, cfg, b) {
  const max = Math.min(500, Math.max(1, Number(b.max) || 200));
  const claim = uuid(), now = Date.now();
  await env.DB.prepare(
    "UPDATE outbox SET claim=?, claimed_at=? WHERE id IN (SELECT id FROM outbox WHERE done_at IS NULL AND (claim IS NULL OR claimed_at<?) ORDER BY id LIMIT ?)"
  ).bind(claim, now, now - CLAIM_MS, max).run();
  const rows = ((await env.DB.prepare("SELECT * FROM outbox WHERE claim=? ORDER BY id").bind(claim).all()).results) || [];
  const left = await env.DB.prepare("SELECT count(*) AS n FROM outbox WHERE done_at IS NULL AND claim IS NULL").first();
  return { ok: true, claim, more: left ? left.n : 0, rows: rows.map((r) => ({
    id: r.id, tab: r.tab, mode: r.mode, key: r.key_header, value: r.key_value, row: JSON.parse(r.row_json) })) };
}

async function aSheetAck(env, cfg, b) {
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 1000);
  const now = Date.now();
  let n = 0;
  for (const id of ids) {
    const r = await env.DB.prepare("UPDATE outbox SET done_at=? WHERE id=? AND claim=? AND done_at IS NULL").bind(now, id, String(b.claim || "")).run();
    n += (r.meta && r.meta.changes) || 0;
  }
  if (b.sheetVersion) await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('sheet_version', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(text(b.sheetVersion, 20)).run();
  await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('sheet_drained', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(String(now)).run();
  return { ok: true, done: n };
}

async function setting(env, k) {
  try { const r = await env.DB.prepare("SELECT v FROM settings WHERE k=?").bind(k).first(); return r ? r.v : ""; } catch (e) { return ""; }
}

async function aHealth(env, cfg) {
  const waiting = await env.DB.prepare("SELECT count(*) AS n FROM outbox WHERE done_at IS NULL").first();
  return {
    ok: true, sheet: await setting(env, "sheet_version"),
    checks: {
      pinPepper: !!env.PIN_PEPPER, sheetToken: !!env.SHEET_TOKEN, sheetKnock: !!env.SHEET_WEBAPP_URL,
      waitingForSheet: waiting ? waiting.n : 0, sheetLastDrained: Number(await setting(env, "sheet_drained")) || 0,
      clockLastTick: Number(await setting(env, "clock_tick")) || 0
    }
  };
}

/* After a write, knock on the sheet's web app so it drains now (and sends
   any email). Same idea as the Driver App's pokeSheet. Never awaited by the
   phone. Knocks are at least KNOCK_GAP_MS apart. A knock in that gap may
   have drained before this write landed, so this one waits for the gap to
   pass and knocks then, unless somebody else knocked meanwhile: an email
   waits seconds, not until the five-minute clock. */
const KNOCK_GAP_MS = 10000;
async function knockSheet(env) {
  if (!env.SHEET_WEBAPP_URL || !env.SHEET_TOKEN) return false;
  const last = await setting(env, "last_knock");
  const wait = KNOCK_GAP_MS - (Date.now() - (Number(last) || 0));
  if (wait > 0) await new Promise((done) => setTimeout(done, Math.min(wait, KNOCK_GAP_MS)));
  /* Claim the knock: only a request that still finds the value it read may
     knock. One that lost the race is covered by the winner's drain, which
     starts after this write had landed. */
  const now = String(Date.now());
  const claim = last
    ? await env.DB.prepare("UPDATE settings SET v=? WHERE k='last_knock' AND v=?").bind(now, last).run()
    : await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('last_knock', ?) ON CONFLICT(k) DO NOTHING").bind(now).run();
  if (!claim || !claim.meta || !claim.meta.changes) return false;
  try {
    const res = await fetch(env.SHEET_WEBAPP_URL, { method: "POST", headers: { "content-type": "text/plain" },
      body: JSON.stringify({ action: "drain", sheetToken: env.SHEET_TOKEN }) });
    return res.ok;
  } catch (e) { return false; }
}

/* ==========================================================================
   THE CLOCK — reminders, once each (dedupe keys)
   ========================================================================== */

async function remind(env, cfg, u, type, title, body, refType, refId, dedupe) {
  const seen = await env.DB.prepare("SELECT 1 AS n FROM notifications WHERE dedupe=?").bind(dedupe).first();
  if (seen) return false;
  await run(env, stNotify(env, cfg, u, type, title, body, refType, refId, dedupe));
  return true;
}

async function clockTick(env, now) {
  const cfg = await loadConfig(env);
  const at = now || new Date();
  const today = londonKey(at), hour = londonParts(at).hh;
  let sent = 0;
  if (hour >= cfg.reminder_hour) {
    for (const days of cfg.duty_reminder_days) {
      const day = keyAddDays(today, days);
      const rows = ((await env.DB.prepare(
        "SELECT a.id AS aid, a.duty, e.id AS eid, e.title, e.date, u.* FROM appointments a JOIN events e ON e.id=a.event_id JOIN ushers u ON u.id=a.usher_id " +
        "WHERE e.date=? AND e.status<>'cancelled' AND a.status='active' AND u.active=1").bind(day).all()).results) || [];
      for (const x of rows) {
        if (await remind(env, cfg, x, "duty_reminder", "Duty reminder: " + x.title,
          "You are on " + (x.duty === "counting" ? "offering counting" : "ushering") + " duty on " + ukDate(x.date) + ".",
          "event", x.eid, "duty:" + x.aid + ":" + days)) sent++;
      }
    }
  }
  if (hour >= cfg.report_reminder_hour) {
    const rows = ((await env.DB.prepare(
      "SELECT e.id AS eid, e.title, e.date, e.type, a.id AS aid, u.* FROM events e JOIN appointments a ON a.event_id=e.id AND a.status='active' JOIN ushers u ON u.id=a.usher_id " +
      "LEFT JOIN reports r ON r.event_id=e.id WHERE e.date=? AND e.status<>'cancelled' AND u.active=1 AND (r.id IS NULL OR r.status='draft')").bind(today).all()).results) || [];
    for (const x of rows) {
      const t = cfg.event_types[x.type] || {};
      if (!t.attendance && !t.offering) continue;
      if (await remind(env, cfg, x, "report_reminder", "Report not yet submitted: " + x.title,
        "The report for " + x.title + " on " + ukDate(x.date) + " has not been submitted.", "event", x.eid, "report:" + x.eid + ":" + x.id)) sent++;
    }
  }
  await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('clock_tick', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(String(Date.now())).run();
  return sent;
}

/* ==========================================================================
   ROUTING
   ========================================================================== */

/* ==========================================================================
   PERIOD SUMMARY — for the coordinator's PDF
   ========================================================================== */

async function aReportsPeriod(env, cfg, b, me) {
  need(me, "reports.view_all");
  const from = text(b.from, 10), to = text(b.to, 10);
  if (!validKey(from) || !validKey(to) || from > to) fail(400, "dates", "Choose a start and end date.");
  if (keyAddDays(from, 400) < to) fail(400, "dates", "Choose a period of at most 400 days.");
  const events = ((await env.DB.prepare(
    "SELECT * FROM events WHERE date>=? AND date<=? AND status<>'cancelled' ORDER BY date, start_time, id").bind(from, to).all()).results) || [];
  const reports = ((await env.DB.prepare(
    "SELECT r.* FROM reports r JOIN events e ON e.id=r.event_id WHERE e.date>=? AND e.date<=?").bind(from, to).all()).results) || [];
  const byEvent = {};
  for (const r of reports) byEvent[r.event_id] = r;
  const names = await namesMap(env);
  const entries = reports.length ? ((await env.DB.prepare(
    "SELECT o.report_id, o.category, sum(o.amount) AS amount FROM offering_entries o JOIN reports r ON r.id=o.report_id JOIN events e ON e.id=r.event_id WHERE e.date>=? AND e.date<=? GROUP BY o.report_id, o.category"
  ).bind(from, to).all()).results) || [] : [];
  const catsOf = {};
  for (const x of entries) (catsOf[x.report_id] = catsOf[x.report_id] || {})[x.category] = x.amount;
  const totals = { events: events.length, reported: 0, verified: 0, waiting: 0, missing: 0, male: 0, female: 0, children: 0, attendance: 0, offering: 0, byCategory: {}, ministration: {} };
  const numFields = (cfg.ministration_fields || []).filter((f) => f.kind === "number");
  const rows = events.map((e) => {
    const r = byEvent[e.id];
    const row = { eventId: e.id, date: e.date, title: e.title, type: e.type, status: r ? r.status : "", statusLabel: r ? STATUS_LABELS[r.status] : "No report",
      submitter: r ? names[r.submitter_id] || "" : "", countersigner: r ? names[r.countersigner_id] || "" : "", version: r ? r.version || 1 : 0 };
    if (!r || r.status === "draft") { totals.missing++; return row; }
    totals.reported++;
    if (r.status === "verified") totals.verified++; else totals.waiting++;
    row.attendance = { male: r.male, female: r.female, children: r.children, total: r.attendance_total };
    row.offeringTotal = r.offering_total;
    row.byCategory = catsOf[r.id] || {};
    row.ministration = ministrationOf(r);
    totals.male += r.male || 0; totals.female += r.female || 0; totals.children += r.children || 0;
    totals.attendance += r.attendance_total || 0; totals.offering += r.offering_total || 0;
    for (const k of Object.keys(row.byCategory)) totals.byCategory[k] = (totals.byCategory[k] || 0) + row.byCategory[k];
    for (const f of numFields) totals.ministration[f.key] = (totals.ministration[f.key] || 0) + (Number(row.ministration[f.key]) || 0);
    return row;
  });
  return { ok: true, from, to, rows, totals, ministrationFields: cfg.ministration_fields || [], offeringCategories: cfg.offering_categories,
           church: cfg.church_name, place: cfg.church_place, madeBy: me.usher.full_name };
}

/* ==========================================================================
   PUSH NOTIFICATIONS TO PHONES — copied from the Driver App's worker.js
   (b64url, vapidKeys, vapidAuth, pushOne), with its rules: the push carries
   no payload, so nothing needs encrypting and nothing personal crosses the
   push service; the phone wakes and asks push.what with its endpoint. The
   key pair is made by the Worker on first use and kept in the settings
   table, never in code. 404/410 from a push service removes that phone.
   ========================================================================== */

const PUSH_TTL = 3600;

function b64url(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function vapidKeys(env) {
  try {
    const had = JSON.parse(await setting(env, "vapid") || "null");
    if (had && had.pub && had.jwk) return had;
  } catch (e) {}
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const made = { pub: b64url(raw), jwk, at: Date.now() };
  /* Two first calls at once: the first key kept wins, and both read it back. */
  await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('vapid', ?) ON CONFLICT(k) DO NOTHING").bind(JSON.stringify(made)).run();
  return JSON.parse(await setting(env, "vapid"));
}

/* Made out to the ORIGIN of the endpoint: Google, Apple and Mozilla each
   reject a token made out to anybody else. sub is this Worker's own origin,
   so nobody's address is kept anywhere. */
async function vapidAuth(env, endpoint, keys, selfOrigin) {
  const aud = new URL(endpoint).origin;
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.PUSH_CONTACT || selfOrigin || "https://ushers.invalid" })));
  const key = await crypto.subtle.importKey("jwk", keys.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return "vapid t=" + head + "." + body + "." + b64url(sig) + ", k=" + keys.pub;
}

async function pushOne(env, sub, keys, selfOrigin) {
  try {
    const res = await fetch(sub.endpoint, { method: "POST", headers: {
      "Authorization": await vapidAuth(env, sub.endpoint, keys, selfOrigin), "TTL": String(PUSH_TTL), "Content-Length": "0", "Urgency": "high" } });
    if (res.status === 404 || res.status === 410) {
      await env.DB.prepare("DELETE FROM push_subs WHERE id=?").bind(sub.id).run();
      return false;
    }
    if (res.ok) { await env.DB.prepare("UPDATE push_subs SET seen=?, fails=0 WHERE id=?").bind(Date.now(), sub.id).run(); return true; }
    await env.DB.prepare("UPDATE push_subs SET fails=fails+1 WHERE id=?").bind(sub.id).run();
    return false;
  } catch (e) {
    try { await env.DB.prepare("UPDATE push_subs SET fails=fails+1 WHERE id=?").bind(sub.id).run(); } catch (x) {}
    return false;
  }
}

/* Every notification not yet sent to phones, from the last two hours. Each
   is marked before sending, so two writes close together never push twice.
   Returns how many phones were woken. */
async function pushPending(env, cfg, selfOrigin) {
  cfg = cfg || await loadConfig(env);
  const since = Date.now() - 2 * 3600000;
  const rows = ((await env.DB.prepare(
    "SELECT id, usher_id, type FROM notifications WHERE pushed_at IS NULL AND created_at>? ORDER BY created_at LIMIT 100").bind(since).all()).results) || [];
  if (!rows.length) return 0;
  const now = Date.now();
  await run(env, rows.map((n) => env.DB.prepare("UPDATE notifications SET pushed_at=? WHERE id=? AND pushed_at IS NULL").bind(now, n.id)));
  const types = Array.isArray(cfg.push_types) ? cfg.push_types : null;
  const who = [...new Set(rows.filter((n) => !types || types.indexOf(n.type) !== -1).map((n) => n.usher_id))];
  if (!who.length) return 0;
  const subs = ((await env.DB.prepare("SELECT * FROM push_subs WHERE usher_id IN (" + who.map(() => "?").join(",") + ")").bind(...who).all()).results) || [];
  if (!subs.length) return 0;
  const keys = await vapidKeys(env);
  let n = 0;
  for (const sub of subs) if (await pushOne(env, sub, keys, selfOrigin)) n++;
  return n;
}

function okEndpoint(v) {
  const s = String(v || "");
  if (s.length > 1000) return "";
  try { return new URL(s).protocol === "https:" ? s : ""; } catch (e) { return ""; }
}

async function aPushSubscribe(env, cfg, b, me) {
  const ep = okEndpoint(b.endpoint);
  if (!ep) fail(400, "endpoint", "This phone did not give a push address.");
  await env.DB.prepare(
    "INSERT INTO push_subs (usher_id, endpoint, created_at, seen, fails) VALUES (?,?,?,?,0) ON CONFLICT(endpoint) DO UPDATE SET usher_id=excluded.usher_id, seen=excluded.seen, fails=0"
  ).bind(me.usher.id, ep, Date.now(), Date.now()).run();
  return { ok: true };
}

async function aPushUnsubscribe(env, cfg, b, me) {
  await env.DB.prepare("DELETE FROM push_subs WHERE endpoint=? AND usher_id=?").bind(String(b.endpoint || ""), me.usher.id).run();
  return { ok: true };
}

/* Asked by the phone's service worker, which holds no session: the endpoint
   is the phone's own unguessable address. Answers with the newest unread
   notification for whoever switched alerts on there, and always with
   something showable (a push that shows nothing is held against the site). */
async function aPushWhat(env, cfg, b) {
  const plain = { ok: true, title: cfg.church_name ? "Ushering" : "Ushering", body: "Open the app for the latest.", tag: "ushers", url: "./#notes" };
  const sub = await env.DB.prepare("SELECT * FROM push_subs WHERE endpoint=?").bind(String(b.endpoint || "")).first();
  if (!sub) return plain;
  const n = await env.DB.prepare(
    "SELECT * FROM notifications WHERE usher_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(sub.usher_id).first();
  if (!n) return plain;
  const more = await env.DB.prepare("SELECT count(*) AS n FROM notifications WHERE usher_id=? AND read_at IS NULL").bind(sub.usher_id).first();
  const extra = more && more.n > 1 ? " (" + (more.n - 1) + " more in the app)" : "";
  let url = "./#notes";
  if (n.ref_type === "report" && n.type === "report_filed" && permissionsFor(cfg, await rolesOf(env, sub.usher_id)).has("admin.app")) url = "./admin/#report/" + n.ref_id;
  else if (n.ref_type === "report") url = "./#rep/" + n.ref_id;
  else if (n.ref_type === "authorisation") url = "./admin/#approvals";
  else if (n.ref_type === "event") url = "./#report/" + n.ref_id;
  return { ok: true, title: n.title, body: (n.body || "") + extra, tag: "n|" + n.id, url };
}

/* ==========================================================================
   SCHEMA CATCH-UP — a database made by an older schema.sql gets the new
   tables and columns on first use. Each step is safe to repeat.
   ========================================================================== */

const MIGRATIONS = [
  "ALTER TABLE reports ADD COLUMN ministration_json TEXT DEFAULT '{}'",
  "ALTER TABLE notifications ADD COLUMN pushed_at INTEGER",
  "CREATE TABLE IF NOT EXISTS report_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, replaced_at INTEGER NOT NULL, replaced_by TEXT NOT NULL, reason TEXT DEFAULT '', amend_submission_id TEXT UNIQUE)",
  "CREATE UNIQUE INDEX IF NOT EXISTS report_versions_once ON report_versions(report_id, version)",
  "CREATE TABLE IF NOT EXISTS push_subs (id INTEGER PRIMARY KEY AUTOINCREMENT, usher_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, created_at INTEGER, seen INTEGER, fails INTEGER DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS push_subs_usher ON push_subs(usher_id)",
  "ALTER TABLE ushers ADD COLUMN pin_must_change INTEGER DEFAULT 0"
];
/* Changes made once, each remembered by name, on the audit like any other.
   A setting saved in Admin -> Settings replaces the whole default, so a rule
   that changes later has to be written into the saved copy too (key and
   change). Other changes to existing records are a run that returns the
   statements to apply. */
const ONCE = [
  { name: "countersign_sunday_only", key: "event_types",
    why: "Only First and Second Service are countersigned",
    change: (v) => {
      let changed = false;
      for (const k of Object.keys(v || {})) {
        const want = !!v[k].sunday;
        if (!!v[k].countersign !== want) { v[k].countersign = want; changed = true; }
      }
      return changed ? v : null;
    } },
  { name: "email_report_filed", key: "email_types",
    why: "Filed reports are emailed to the Head Usher and Assistant Head Usher",
    change: (v) => Array.isArray(v) && v.indexOf("report_filed") === -1 ? v.concat(["report_filed"]) : null },
  { name: "file_uncountersigned_reports", run: fileUncountersigned }
];

/* Reports still waiting for a countersignature when their event stopped
   needing one are filed: the Head Usher is told, the submitter is told, and
   any request about countersigning them is cancelled. */
async function fileUncountersigned(env) {
  const cfg = await loadConfig(env);
  const types = Object.keys(cfg.event_types).filter((k) => !cfg.event_types[k].countersign);
  if (!types.length) return [];
  const rows = ((await env.DB.prepare(
    "SELECT r.* FROM reports r JOIN events e ON e.id=r.event_id WHERE r.status='pending_countersignature' AND e.type IN (" + types.map(() => "?").join(",") + ")"
  ).bind(...types).all()).results) || [];
  if (!rows.length) return [];
  const names = await namesMap(env), now = Date.now(), st = [];
  const note = "Countersignature no longer needed for this event";
  for (const r of rows) {
    const e = await getEvent(env, r.event_id);
    const rec = Object.assign({}, r, { status: "verified", countersigner_id: null, countersign_required: 0, verified_at: now, updated_at: now });
    st.push(env.DB.prepare("UPDATE reports SET status='verified', countersigner_id=NULL, countersign_required=0, verified_at=?, updated_at=? WHERE id=? AND status='pending_countersignature'")
      .bind(now, now, r.id));
    st.push(env.DB.prepare("INSERT INTO report_history (report_id, at, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?,?)")
      .bind(r.id, now, "system", "pending_countersignature", "verified", note));
    st.push(stAudit(env, "system", "report.file", "report", r.id, { status: r.status, countersigner: r.countersigner_id || "" }, { status: "verified" }, note));
    st.push(stOutbox(env, "REPORTS", reportRow(rec, e, names), "REPORT_ID"));
    const open = ((await env.DB.prepare("SELECT * FROM authorisations WHERE kind='countersign' AND target_type='report' AND target_id=? AND status IN ('pending','approved')").bind(r.id).all()).results) || [];
    for (const a of open) st.push(stCancelAuth(env, a, note, names, now));
    st.push(env.DB.prepare("UPDATE notifications SET read_at=? WHERE type='countersign_request' AND ref_type='report' AND ref_id=? AND read_at IS NULL").bind(now, r.id));
    st.push(stNotify(env, cfg, await getUsher(env, r.submitter_id), "report_status", "Filed: " + e.title + " " + ukDate(e.date),
      "Your report is filed. This event no longer needs a countersignature.", "report", r.id));
    st.push(await stReportFiled(env, cfg, rec, e, (r.version || 1) > 1 ? "Amended report filed" : "Report filed",
      (names[r.submitter_id] || "The submitter") + " signed the report. This event no longer needs a countersignature.", [r.submitter_id]));
  }
  return st;
}

/* True when every change is made (or was made before). */
async function migrateOnce(env) {
  let ok = true;
  for (const m of ONCE) {
    const flag = "migrated_" + m.name;
    if (await setting(env, flag)) continue;
    try {
      const now = Date.now();
      const st = [env.DB.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(flag, String(now))];
      if (m.run) {
        st.push(await m.run(env));
      } else {
        const row = await env.DB.prepare("SELECT v FROM config WHERE k=?").bind(m.key).first();
        const after = row ? m.change(JSON.parse(row.v)) : null;
        if (after) {
          st.push(env.DB.prepare("UPDATE config SET v=?, updated_by=?, updated_at=? WHERE k=?").bind(JSON.stringify(after), "system", now, m.key));
          st.push(stAudit(env, "system", "config.set", "config", m.key, JSON.parse(row.v), after, m.why));
          st.push(stOutbox(env, "CONFIG", { KEY: m.key, VALUE: JSON.stringify(after), UPDATED_BY: "system", UPDATED_AT: londonStamp(now) }, "KEY"));
        }
      }
      await run(env, st);
    } catch (e) { ok = false; }
  }
  return ok;
}

let schemaChecked = false;
async function migrate(env) {
  if (schemaChecked) return;
  if (await setting(env, "schema") === SERVER_VERSION) { schemaChecked = true; return; }
  for (const sql of MIGRATIONS) {
    try { await env.DB.prepare(sql).run(); } catch (e) { /* already there */ }
  }
  /* Only marked done when every once-only change is made; if one failed, the
     next fresh start tries again. */
  if (await migrateOnce(env)) {
    try { await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('schema', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(SERVER_VERSION).run(); } catch (e) {}
  }
  schemaChecked = true;
}

/* auth: false = open; "sheet" = SHEET_TOKEN; otherwise a session.
   write: knock on the sheet afterwards. */
const ACTIONS = {
  "health":                 { auth: false, fn: aHealth },
  "people":                 { auth: false, fn: aPeople },
  "login":                  { auth: false, fn: aLogin },
  "bootstrap":              { auth: false, fn: aBootstrap, write: true },
  "sheet.pull":             { auth: "sheet", fn: aSheetPull },
  "sheet.ack":              { auth: "sheet", fn: aSheetAck },
  "logout":                 { fn: aLogout, whileDefaultPin: true },
  "me":                     { fn: aMe, whileDefaultPin: true },
  "pin.change":             { fn: aPinChange, write: true, whileDefaultPin: true },
  "pin.keep":               { fn: aPinKeep, write: true, whileDefaultPin: true },
  "home":                   { fn: aHome },
  "history.mine":           { fn: aHistoryMine },
  "rota":                   { fn: aRota, write: true },
  "rota.set":               { fn: aRotaSet, write: true },
  "event.save":             { fn: aEventSave, write: true },
  "event.cancel":           { fn: aEventCancel, write: true },
  "report.open":            { fn: aReportOpen },
  "report.draft":           { fn: aReportDraft },
  "report.submit":          { fn: aReportSubmit, write: true },
  "report.countersign":     { fn: aReportCountersign, write: true },
  "report.countersigner":   { fn: aReportCountersigner, write: true },
  "report.amend":           { fn: aReportAmend, write: true },
  "reports.period":         { fn: aReportsPeriod },
  "reports.list":           { fn: aReportsList },
  "ushers.selectable":      { fn: aSelectable },
  "authorisations.list":    { fn: aAuthList },
  "authorisation.request":  { fn: aAuthRequest, write: true },
  "authorisation.decide":   { fn: aAuthDecide, write: true },
  "notifications.list":     { fn: aNotifications },
  "notifications.read":     { fn: aNotificationsRead },
  "notify.send":            { fn: aNotifySend, write: true },
  "dues.mine":              { fn: aDuesMine },
  "dues.overview":          { fn: aDuesOverview },
  "dues.member":            { fn: aDuesMember },
  "dues.record":            { fn: aDuesRecord, write: true },
  "dues.void":              { fn: aDuesVoid, write: true },
  "dues.remind":            { fn: aDuesRemind, write: true },
  "dashboard":              { fn: aDashboard, write: true },
  "ushers.list":            { fn: aUshersList },
  "usher.save":             { fn: aUsherSave, write: true },
  "usher.roles":            { fn: aUsherRoles, write: true },
  "usher.resetPin":         { fn: aUsherResetPin, write: true },
  "config.get":             { fn: aConfigGet },
  "config.set":             { fn: aConfigSet, write: true },
  "audit.list":             { fn: aAuditList },
  "push.subscribe":         { fn: aPushSubscribe },
  "push.unsubscribe":       { fn: aPushUnsubscribe },
  "push.what":              { auth: false, fn: aPushWhat }
};

async function handle(request, env, ctx) {
  const cors = corsHeaders(env, request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  const m = /^\/api\/([a-zA-Z.]+)$/.exec(url.pathname);
  if (!m) return json({ ok: false, error: "not_found" }, 404, cors);
  const spec = ACTIONS[m[1]];
  if (!spec) return json({ ok: false, error: "not_found" }, 404, cors);
  if (request.method !== "POST" && !(request.method === "GET" && m[1] === "health")) {
    return json({ ok: false, error: "method" }, 405, cors);
  }
  try {
    let b = {};
    if (request.method === "POST") {
      const raw = await request.text();
      if (raw.length > 200000) fail(413, "too_big", "Too much data.");
      try { b = raw ? JSON.parse(raw) : {}; } catch (e) { fail(400, "bad_json", "Bad request."); }
      if (!b || typeof b !== "object" || Array.isArray(b)) fail(400, "bad_json", "Bad request.");
    }
    await migrate(env);
    const cfg = await loadConfig(env);
    let me = null;
    if (spec.auth === "sheet") {
      if (!sheetTokenOk(env, b)) fail(403, "forbidden", "Not allowed.");
    } else if (spec.auth !== false) {
      me = await sessionOf(env, cfg, bearer(request));
      if (!me) fail(401, "signed_out", "Please sign in again.");
      /* Someone just given the default PIN is asked once whether to change
         it; until they answer (change or keep), nothing else runs. */
      if (me.usher.pin_must_change && !spec.whileDefaultPin) {
        fail(403, "pin_question", "Say whether you wish to keep your default PIN first.");
      }
    }
    const out = await spec.fn(env, cfg, b, me);
    if (out && typeof out === "object" && out.sheet === undefined) out.sheet = await setting(env, "sheet_version");
    if (spec.write && ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(knockSheet(env));
      ctx.waitUntil(pushPending(env, cfg, url.origin).catch((e) => console.log("push", e && e.message)));
    }
    return json(out, 200, cors);
  } catch (err) {
    if (err instanceof HttpError) {
      return json(Object.assign({ ok: false, error: err.code, message: err.message }, err.extra || {}), err.status, cors);
    }
    if (String(err && err.message || "").indexOf("UNIQUE constraint failed") !== -1) {
      return json({ ok: false, error: "conflict", message: "That was changed at the same moment. Try again." }, 409, cors);
    }
    console.log("error", err && err.stack || err);
    return json({ ok: false, error: "server", message: "Something went wrong on the server." }, 500, cors);
  }
}

export default {
  async fetch(request, env, ctx) { return handle(request, env, ctx); },
  async scheduled(event, env, ctx) {
    await migrate(env);
    await clockTick(env);
    await knockSheet(env);
    try { await pushPending(env); } catch (e) { console.log("push", e && e.message); }
  }
};
