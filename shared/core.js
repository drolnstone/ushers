/* Ushering App — shared by the Ushers App and the Admin App.

   One session for both apps: the token is kept under one key on this
   origin, so moving between the two apps needs no second sign-in. The
   server re-checks the session and the current roles on every call.

   Offline rules, from the Driver App: drafts are saved on the phone as they
   are typed; a signed report with no signal waits in a queue, sent one at a
   time, and leaves the queue only when the server has it. The id that stops
   duplicates is made on the phone. */
(function () {
  "use strict";
  var APP_VERSION = "v0.3.10";
  var CFG = window.USHERS_CONFIG || {};
  var K = { session: "ushers.session.v1", device: "ushers.device.v1", queue: "ushers.queue.v1", draft: "ushers.draft.v1:" };

  /* Storage that never throws; memory when the browser refuses. */
  var mem = {};
  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v === null ? (k in mem ? mem[k] : null) : v; } catch (e) { return k in mem ? mem[k] : null; } },
    set: function (k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} },
    getJSON: function (k, d) { try { var v = store.get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    setJSON: function (k, v) { store.set(k, JSON.stringify(v)); }
  };

  function token() { return store.get(K.session) || ""; }
  function setToken(t) { if (t) store.set(K.session, t); else store.del(K.session); }

  var versions = { app: APP_VERSION, server: "", sheet: "" };

  /* Calls the server. Resolves with the answer, ok or not; rejects only when
     the server could not be reached (err.network = true). */
  function api(action, body) {
    var headers = { "content-type": "application/json" };
    if (token()) headers.authorization = "Bearer " + token();
    return fetch(String(CFG.api || "").replace(/\/+$/, "") + "/api/" + action, {
      method: "POST", headers: headers, body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: "bad_answer", message: "The server gave an unreadable answer." }; })
        .then(function (j) {
          j._status = res.status;
          if (j.server) versions.server = j.server;
          if (j.sheet) versions.sheet = j.sheet;
          if (res.status === 401) { setToken(""); if (core.onSignedOut) core.onSignedOut(); }
          if (res.status >= 500) { var e = new Error(j.message || "Server error"); e.network = true; throw e; }
          return j;
        });
    }, function (err) { var e = new Error("No connection"); e.network = true; throw e; });
  }

  /* ---- the phone's own PIN check, for signing with no signal ------------ */

  var enc = new TextEncoder();
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function bytes(h) { var o = new Uint8Array(h.length / 2); for (var i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
  function derive(pin, saltHex) {
    return crypto.subtle.importKey("raw", enc.encode(String(pin)), "PBKDF2", false, ["deriveBits"]).then(function (key) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: bytes(saltHex), iterations: 100000 }, key, 256);
    }).then(hex);
  }
  /* After a PIN the server accepted, remember a salted hash of it here. */
  function rememberPin(name, pin) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve();
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    var salt = hex(a);
    return derive(pin, salt).then(function (h) { store.setJSON(K.device, { name: name, salt: salt, hash: h }); });
  }
  function checkPinOnDevice(name, pin) {
    var d = store.getJSON(K.device, null);
    if (!d || d.name !== name || !window.crypto || !crypto.subtle) return Promise.resolve(false);
    return derive(pin, d.salt).then(function (h) { return h === d.hash; });
  }

  /* ---- drafts and the queue -------------------------------------------- */

  function draftGet(eventId) { return store.getJSON(K.draft + eventId, null); }
  function draftSave(eventId, d) { d.savedAt = Date.now(); store.setJSON(K.draft + eventId, d); }
  function draftClear(eventId) { store.del(K.draft + eventId); }
  function drafts() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(K.draft) === 0) out.push({ eventId: k.slice(K.draft.length), draft: store.getJSON(k, {}) });
      }
    } catch (e) {}
    return out;
  }

  function queue() { return store.getJSON(K.queue, []); }
  function queueAdd(item) { var q = queue(); item.queuedAt = Date.now(); q.push(item); store.setJSON(K.queue, q); }
  function queueRemove(id) { store.setJSON(K.queue, queue().filter(function (x) { return x.id !== id; })); }
  function queueNote(id, note) {
    var q = queue();
    q.forEach(function (x) { if (x.id === id) x.lastError = note; });
    store.setJSON(K.queue, q);
  }

  var flushing = false;
  /* One at a time. An item leaves only when the server has it; a refusal
     stays, with the reason, for the person to see. */
  function flush() {
    if (flushing || !token()) return Promise.resolve();
    var q = queue();
    if (!q.length) return Promise.resolve();
    flushing = true;
    var i = 0;
    function next() {
      if (i >= q.length) return Promise.resolve();
      var item = q[i++];
      return api(item.action, item.body).then(function (j) {
        if (j.ok || j.duplicate) { queueRemove(item.id); if (item.eventId) draftClear(item.eventId); }
        else queueNote(item.id, j.message || j.error);
        return next();
      }, function () { /* still no signal: stop and try later */ });
    }
    return next().then(function () { flushing = false; if (core.onQueueChange) core.onQueueChange(); },
                       function () { flushing = false; });
  }
  window.addEventListener("online", function () { flush(); });
  setInterval(function () { flush(); }, 30000);

  function newId(prefix) {
    if (window.crypto && crypto.randomUUID) return prefix + "-" + crypto.randomUUID();
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  /* ---- formatting ------------------------------------------------------- */

  function money(pence, symbol) {
    var n = Number(pence || 0) / 100;
    return (symbol || "£") + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function denomLabel(pence, symbol) {
    var p = Number(pence);
    return p >= 100 ? (symbol || "£") + (p / 100) : p + "p";
  }
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dateLabel(key) {
    var s = String(key || "");
    if (s.length !== 10) return s;
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  function timeLabel(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function londonToday() {
    var p = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day;
  }

  /* ---- a very small DOM helper ------------------------------------------ */

  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function foot(el) {
    clear(el);
    el.appendChild(h("div", {}, "app " + versions.app + (versions.server ? " · server " + versions.server : "") +
                     (versions.sheet ? " · sheet " + versions.sheet : "")));
    el.appendChild(h("div", { class: "themes", role: "group", "aria-label": "Appearance" },
      THEMES.map(function (t) {
        return h("button", { type: "button", class: t[0] === themeChoice() ? "on" : "", "aria-pressed": String(t[0] === themeChoice()),
                             onclick: function () { try { localStorage.setItem(THEME_KEY, t[0]); } catch (e) {} themeApply(); foot(el); } }, t[1]);
      })));
  }

  /* ---- appearance, as the Driver App: Auto follows the phone ------------
     One key for both apps (same origin), read again in each page's head so
     the first paint is already right. */
  var THEME_KEY = "ushers.theme.v1";
  var THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
  function themeChoice() { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { return "auto"; } }
  function themeApply() {
    var pick = themeChoice(), r = pick;
    if (pick !== "light" && pick !== "dark") {
      var m = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
      r = (m && m.matches) ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", r);
  }
  (function () {
    var m = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (m) { if (m.addEventListener) m.addEventListener("change", themeApply); else if (m.addListener) m.addListener(themeApply); }
  })();

  /* ---- alerts on this phone (push) -------------------------------------
     The server's public key comes from "me". The push itself carries
     nothing; sw.js asks the server what it is for. On iPhone this works
     only once the app is added to the Home Screen and opened from there. */

  function keyBytes(b64) {
    var pad = "=".repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function alertsSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function iPhoneNotInstalled() {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    return ios && !standalone;
  }
  function swReg() {
    var base = String(location.pathname).indexOf("/admin/") !== -1 ? "../" : "./";
    return navigator.serviceWorker.getRegistration(base).then(function (r) {
      return r || navigator.serviceWorker.register(base + "sw.js", { scope: base });
    }).then(function () { return navigator.serviceWorker.ready; });
  }
  /* Resolves "on", "off", "blocked" or "unsupported". */
  function alertsState() {
    if (!alertsSupported()) return Promise.resolve("unsupported");
    if (Notification.permission === "denied") return Promise.resolve("blocked");
    return swReg().then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (s) { return s ? "on" : "off"; }, function () { return "unsupported"; });
  }
  function alertsOn(publicKey) {
    return Notification.requestPermission().then(function (p) {
      if (p !== "granted") throw new Error("Alerts were not allowed on this phone.");
      return swReg();
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (s) {
        return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      });
    }).then(function (sub) {
      return api("push.subscribe", { endpoint: sub.endpoint }).then(function (j) { if (!j.ok) throw new Error(j.message); return j; });
    });
  }
  function alertsOff() {
    return swReg().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (s) {
      if (!s) return;
      return api("push.unsubscribe", { endpoint: s.endpoint }).catch(function () {}).then(function () { return s.unsubscribe(); });
    });
  }

  /* Asks the server for one push to this phone, the caller's own, to prove
     the whole chain. The alert that arrives says "Alerts are working". */
  function alertsTest() {
    return swReg().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (s) {
      if (!s) throw new Error("Alerts are not on for this phone.");
      return api("push.test", { endpoint: s.endpoint }).then(function (j) { if (!j.ok) throw new Error(j.message || "The test could not be sent."); return j; });
    });
  }

  /* ---- the bell, from the Driver App's coordinator bar ------------------
     One bell in the banner of both apps, once signed in. Hollow while alerts
     are off on this phone, filled once they are on; a red count of unread
     notifications on it, on the Notifications tab and (where the phone
     allows) on the home-screen icon. Tapped while off, it turns alerts on;
     tapped while on, it opens Notifications.

     It keeps listening while the app is open: the count is asked for every
     refreshSeconds while the page is in view, at once when the app comes
     back into view, and at once when a phone alert lands (the service
     worker says so). Something new while the app is open is shown as a
     strip at the foot of the screen, so nothing waits for a reload. */
  var BELL = { on: false, key: "", notes: "#notes", onNew: null, timer: null, state: "", busy: false,
               unread: 0, latestId: null, primed: false, synced: false };

  function appBadge(n) {
    try {
      if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n).catch(function () {});
      else if (!n && navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
    } catch (e) {}
  }
  function bellPaint() {
    var b = document.getElementById("bell"), c = document.getElementById("bellCount"), tab = document.getElementById("unread");
    var n = BELL.on ? BELL.unread : 0;
    if (tab) { tab.hidden = !n; tab.textContent = n || ""; }
    if (!b) return;
    b.hidden = !BELL.on;
    if (b.parentNode && b.parentNode.classList) b.parentNode.classList.toggle("has-bell", BELL.on);
    b.disabled = BELL.busy;
    b.classList.toggle("on", BELL.state === "on");
    b.setAttribute("aria-pressed", BELL.state === "on" ? "true" : "false");
    var say = BELL.state === "on" ? "Notifications. Alerts are on for this phone" :
              BELL.state === "off" ? "Notifications. Tap to turn on alerts on this phone" : "Notifications";
    if (n) say += ". " + n + " unread";
    b.setAttribute("aria-label", say); b.title = say;
    if (c) { c.hidden = !n; c.textContent = n > 99 ? "99+" : String(n); }
  }

  var toastTimer = null;
  function toast(text, onTap) {
    var t = document.getElementById("toast");
    if (!t) { t = h("div", { id: "toast", class: "toast", role: "status", "aria-live": "polite" }); document.body.appendChild(t); }
    clear(t);
    t.appendChild(h("span", {}, text));
    t.onclick = function () { t.classList.remove("on"); if (onTap) onTap(); };
    t.classList.toggle("tap", !!onTap);
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, onTap ? 9000 : 5000);
  }

  function openNotes() {
    if (location.hash === BELL.notes) { if (BELL.onNew) BELL.onNew(true); }
    else location.hash = BELL.notes;
  }

  function bellSet(n) { BELL.unread = Math.max(0, Number(n) || 0); bellPaint(); appBadge(BELL.on ? BELL.unread : 0); }

  function bellCheck() {
    if (!BELL.on || !token()) return Promise.resolve();
    return api("notifications.count").then(function (j) {
      if (!j.ok) return;
      bellSet(j.unread);
      var l = j.latest;
      if (BELL.primed && l && l.id !== BELL.latestId && !l.read) {
        toast("New: " + l.title, openNotes);
        if (BELL.onNew) BELL.onNew(false);
      }
      BELL.latestId = l ? l.id : null;
      BELL.primed = true;
    }, function () { /* no signal: the next tick asks again */ });
  }

  function bellState() {
    return alertsState().then(function (s) {
      if (s === "unsupported" && iPhoneNotInstalled()) s = "install";
      if (s === "on" && !BELL.key) s = "unsupported";
      /* Already on here: told to the server again, once per sign-in, so the
         phone is under whoever is signed in now (a shared phone, a removed
         row) and keeps being woken. As the Driver App does on every tap. */
      if (s === "on" && !BELL.synced) {
        BELL.synced = true;
        swReg().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
          if (sub) return api("push.subscribe", { endpoint: sub.endpoint });
        }).catch(function () {});
      }
      BELL.state = s; bellPaint();
      return s;
    }, function () { BELL.state = "unsupported"; bellPaint(); return "unsupported"; });
  }

  function bellTap() {
    if (BELL.busy) return;
    var s = BELL.state;
    if (s === "off") {
      BELL.busy = true; bellPaint();
      alertsOn(BELL.key).then(function () {
        BELL.busy = false; BELL.state = "on"; BELL.synced = true; bellPaint();
        toast("Alerts are on for this phone. Tap the bell to see your notifications.");
        if (location.hash === BELL.notes && BELL.onNew) BELL.onNew(true);
      }, function (e) {
        BELL.busy = false; bellPaint();
        toast(e && e.network ? "No connection. Try again when you have signal." : (e && e.message) || "Could not turn alerts on.");
      });
      return;
    }
    if (s === "install") toast("On iPhone, alerts need Ushers on the Home Screen: tap Share, then Add to Home Screen, and open it from there.");
    else if (s === "blocked") toast("Alerts are blocked for this app in the phone's settings. Allow notifications there to get them.");
    openNotes();
  }

  /* ASKED, NOT LEFT TO BE FOUND. A bell nobody taps leaves a person told of
     nothing until they open the app. So, once signed in on a phone where
     alerts are off, they are asked straight out (as the Driver App's
     "Turn on" sheet), and asked again three days after a "Not now". On an
     iPhone in Safari they are told how to add the app first. The server
     also emails what is still unread to anyone with alerts on no phone. */
  var ASK_KEY = "ushers.alertAsk.v1", ASK_AGAIN_MS = 3 * 24 * 3600000;
  function askClose(not) {
    var a = document.getElementById("alertAsk");
    if (a) a.parentNode.removeChild(a);
    if (not) store.set(ASK_KEY, String(Date.now()));
  }
  function alertAsk(s) {
    if (document.getElementById("alertAsk")) return;
    var last = Number(store.get(ASK_KEY)) || 0;
    if (Date.now() - last < ASK_AGAIN_MS) return;
    var install = s === "install";
    var go = h("button", { type: "button", onclick: function () {
      if (install) return askClose(true);
      go.disabled = true;
      askClose(false);
      BELL.state = "off"; bellTap();
    } }, install ? "OK" : "Turn on alerts");
    document.body.appendChild(h("div", { id: "alertAsk", class: "ask", role: "dialog", "aria-labelledby": "alertAskTitle" },
      h("b", { id: "alertAskTitle" }, "Turn on alerts on this phone?"),
      h("p", {}, install
        ? "On iPhone, alerts need Ushers on your Home Screen: tap Share, then Add to Home Screen, open it from there and tap the bell."
        : "Without them you only find out about duties, reminders, countersignatures and approvals when you next open the app."),
      h("div", { class: "row" }, go, install ? null : h("button", { type: "button", class: "ghost", onclick: function () { askClose(true); } }, "Not now"))));
  }

  /* Called once signed in. opts.key is the server's public key ("me"),
     opts.notes the Notifications screen's address, opts.onNew(opened) is
     told when something new arrives or the bell opens the screen it is on. */
  function bellStart(opts) {
    opts = opts || {};
    BELL.key = opts.key || ""; BELL.notes = opts.notes || "#notes"; BELL.onNew = opts.onNew || null;
    BELL.on = true; BELL.primed = false; BELL.latestId = null; BELL.synced = false;
    var b = document.getElementById("bell");
    if (b && !b._wired) { b._wired = true; b.addEventListener("click", bellTap); }
    bellPaint();
    bellState().then(function (s) { if (BELL.on && (s === "off" || s === "install")) alertAsk(s); });
    bellCheck();
    if (BELL.timer) clearInterval(BELL.timer);
    BELL.timer = setInterval(function () { if (!document.hidden) bellCheck(); }, Math.max(15, Number(CFG.refreshSeconds) || 30) * 1000);
  }
  function bellStop() {
    askClose(false);
    BELL.on = false; BELL.unread = 0; BELL.state = "";
    if (BELL.timer) { clearInterval(BELL.timer); BELL.timer = null; }
    bellPaint(); appBadge(0);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { bellCheck(); if (BELL.on) bellState(); } });
  if ("serviceWorker" in navigator) {
    try {
      navigator.serviceWorker.addEventListener("message", function (e) { if (e.data && e.data.type === "ushers:notified") bellCheck(); });
      if (navigator.serviceWorker.startMessages) navigator.serviceWorker.startMessages();
    } catch (e) {}
  }

  /* ---- PDFs: the library is loaded only when a PDF is made -------------- */

  var pdfLoading = null;
  function script(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = function () { no(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }
  function loadPdf() {
    if (window.UshersPdf && window.jspdf) return Promise.resolve(window.UshersPdf);
    var base = String(location.pathname).indexOf("/admin/") !== -1 ? "../shared/" : "shared/";
    if (!pdfLoading) {
      pdfLoading = script(base + "vendor/jspdf.umd.min.js?v=" + APP_VERSION)
        .then(function () { return script(base + "pdf.js?v=" + APP_VERSION); })
        .then(function () { return window.UshersPdf; }, function (e) { pdfLoading = null; throw e; });
    }
    return pdfLoading;
  }

  /* Back to top, the Driver App's button: both apps, every screen after
     sign-in (the tabs are showing), once the page is well down. A tab change
     starts the new screen at the top, under the tabs that stay put. */
  function stillMotion() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function syncToTop() {
    var b = document.getElementById("toTop"), tabs = document.getElementById("tabs");
    if (b) b.classList.toggle("on", !!tabs && !tabs.hidden && (window.pageYOffset || 0) > 460);
  }
  document.addEventListener("DOMContentLoaded", function () {
    var b = document.getElementById("toTop");
    if (!b) return;
    window.addEventListener("scroll", syncToTop, { passive: true });
    window.addEventListener("hashchange", function () { window.scrollTo(0, 0); syncToTop(); });
    b.addEventListener("click", function () {
      try { window.scrollTo(stillMotion() ? { top: 0 } : { top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
      b.classList.remove("on");
    });
  });

  var core = window.UshersCore = {
    APP_VERSION: APP_VERSION, CFG: CFG, store: store, api: api, token: token, setToken: setToken, versions: versions,
    rememberPin: rememberPin, checkPinOnDevice: checkPinOnDevice,
    draftGet: draftGet, draftSave: draftSave, draftClear: draftClear, drafts: drafts,
    queue: queue, queueAdd: queueAdd, queueRemove: queueRemove, flush: flush, newId: newId,
    money: money, denomLabel: denomLabel, dateLabel: dateLabel, timeLabel: timeLabel, londonToday: londonToday,
    h: h, clear: clear, foot: foot, onSignedOut: null, onQueueChange: null,
    alertsSupported: alertsSupported, alertsState: alertsState, alertsOn: alertsOn, alertsOff: alertsOff, alertsTest: alertsTest, iPhoneNotInstalled: iPhoneNotInstalled,
    bellStart: bellStart, bellStop: bellStop, bellCheck: bellCheck, bellSet: bellSet, bellState: bellState, toast: toast,
    loadPdf: loadPdf
  };
})();
