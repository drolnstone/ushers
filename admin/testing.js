/* Test people and a sample week, for the System Administrator.

   Everything here goes through the same server actions a person would use,
   signed in as each test person in turn (their sessions are kept only in
   this page, never in place of yours), so the sample is a real journey:
   rota, report, signature, countersignature, dues. Its rows reach every
   tab of the sheet, labelled with the test names. Nothing is invented on
   the sheet itself: the sheet stays the record of what the app did.

   "Switch off test people" makes them inactive and signs them out. Their
   rows stay on the record, as every record does. */
(function () {
  "use strict";
  var C = window.UshersCore, h = C.h;

  var PEOPLE = [
    { key: "hu",  name: "Test Head Usher",           roles: ["usher", "head_usher"] },
    { key: "ahu", name: "Test Assistant Head Usher", roles: ["usher", "assistant_head_usher"] },
    { key: "tr",  name: "Test Treasurer",            roles: ["usher", "treasurer"] },
    { key: "u1",  name: "Test Usher One",            roles: ["usher"] },
    { key: "u2",  name: "Test Usher Two",            roles: ["usher"] },
    { key: "u3",  name: "Test Usher Three",          roles: ["usher"] }
  ];

  /* A call as somebody else: never touches this page's own session. */
  function as(token, action, body) {
    return fetch(String(C.CFG.api || "").replace(/\/+$/, "") + "/api/" + action, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }
  function must(j, what) {
    if (!j || !j.ok) throw new Error(what + ": " + ((j && (j.message || j.error)) || "no answer"));
    return j;
  }
  function addDays(key, n) {
    var d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)));
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dow(key) { return new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10))).getUTCDay(); }
  function evId(key, n) { return "S" + key.replace(/-/g, "") + "-" + n; }

  function seed(pin, log, conf) {
    var id = {}, tok = {};
    var today = C.londonToday();
    var last = addDays(today, -dow(today));
    var next = addDays(last, 7);
    var fields = (conf.ministrationFields || []).map(function (f) { return f.key; });
    function minist(m) { var o = {}; Object.keys(m).forEach(function (k) { if (fields.indexOf(k) !== -1) o[k] = m[k]; }); return o; }

    return C.api("ushers.list").then(function (j) {
      must(j, "Reading ushers");
      var chain = Promise.resolve();
      PEOPLE.forEach(function (p) {
        chain = chain.then(function () {
          var have = j.ushers.filter(function (u) { return u.name === p.name; })[0];
          if (have) {
            id[p.key] = have.usherId;
            return C.api("usher.save", { usherId: have.usherId, name: p.name, active: true }).then(function (x) { must(x, p.name); })
              .then(function () { return C.api("usher.resetPin", { usherId: have.usherId, pin: pin, reason: "Test person" }); })
              .then(function (x) { must(x, p.name + " PIN"); return C.api("usher.roles", { usherId: have.usherId, roles: p.roles }); })
              .then(function (x) { must(x, p.name + " roles"); log(p.name + ": ready again"); });
          }
          return C.api("usher.save", { name: p.name, pin: pin }).then(function (x) {
            must(x, p.name); id[p.key] = x.usherId;
            return C.api("usher.roles", { usherId: x.usherId, roles: p.roles });
          }).then(function (x) { must(x, p.name + " roles"); log(p.name + ": added"); });
        });
      });
      return chain;
    }).then(function () {
      /* Signed in as each of them with a plain call, so this page keeps
         its own session. */
      var chain = Promise.resolve();
      PEOPLE.forEach(function (p) {
        chain = chain.then(function () {
          return fetch(String(C.CFG.api || "").replace(/\/+$/, "") + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ usherId: id[p.key], pin: pin }) }).then(function (r) { return r.json(); })
            .then(function (x) { must(x, "Signing in as " + p.name); tok[p.key] = x.token; });
        });
      });
      return chain;
    }).then(function () {
      return as(tok.hu, "rota", { from: last, weeks: 2 });
    }).then(function (w) {
      must(w, "Opening the rota");
      var plan = [[evId(last, 1), ["u1", "u2"]], [evId(last, 2), ["u2", "u3"]], [evId(next, 1), ["u1", "u3"]], [evId(next, 2), ["u1", "u2"]]];
      var taken = {};
      w.sundays.forEach(function (s) { s.services.forEach(function (sv) { if (sv.people.length) taken[sv.eventId] = 1; }); });
      var chain = Promise.resolve();
      plan.forEach(function (x) {
        chain = chain.then(function () {
          if (taken[x[0]]) { log("Rota for " + x[0].slice(1, 9) + " already set: left as it is"); return; }
          return as(tok.hu, "rota.set", { eventId: x[0], usherIds: x[1].map(function (k) { return id[k]; }) })
            .then(function (r) { must(r, "Rota"); log("Rota set: " + C.dateLabel(x[0].slice(1, 5) + "-" + x[0].slice(5, 7) + "-" + x[0].slice(7, 9)) + (x[0].slice(-1) === "1" ? " First" : " Second") + " Service"); });
        });
      });
      return chain;
    }).then(function () {
      return as(tok.u1, "report.open", { eventId: evId(last, 1) });
    }).then(function (o) {
      if (o.ok && o.report && o.report.status && o.report.status !== "draft") { log("First Service report already there: left as it is"); return; }
      if (!o.ok || !o.canSubmit) { log("First Service report skipped: Test Usher One is not on that rota"); return; }
      return as(tok.u1, "report.submit", { eventId: evId(last, 1), submissionId: C.newId("test"),
        attendance: { male: 42, female: 55, children: 18 },
        ministration: minist({ minister: "Pastor (sample)", sermon_title: "Faithful in little", bible_text: "Luke 16:10", worship_leader: "Sample choir", first_timers: 3, new_converts: 1 }),
        entries: [{ category: conf.offeringCategories[3] || conf.offeringCategories[0], currency: conf.defaultCurrency, denomination: 2000, quantity: 10 },
                  { category: conf.offeringCategories[0], currency: conf.defaultCurrency, denomination: 1000, quantity: 7 }],
        notes: "Sample report made by the test tools", countersignerId: id.hu, signature: "Test Usher One", pin: pin
      }).then(function (r) {
        must(r, "Sample First Service report");
        log("First Service report submitted by Test Usher One");
        return as(tok.hu, "report.countersign", { reportId: r.report.id, submissionId: C.newId("test"), signature: "Test Head Usher", pin: pin, version: r.report.version });
      }).then(function (r) { must(r, "Countersigning"); log("…and countersigned by Test Head Usher: Verified"); });
    }).then(function () {
      return as(tok.u2, "report.open", { eventId: evId(last, 2) });
    }).then(function (o) {
      if (o.ok && o.report && o.report.status && o.report.status !== "draft") { log("Second Service report already there: left as it is"); return; }
      if (!o.ok || !o.canSubmit) { log("Second Service report skipped: Test Usher Two is not on that rota"); return; }
      return as(tok.u2, "report.submit", { eventId: evId(last, 2), submissionId: C.newId("test"),
        attendance: { male: 60, female: 71, children: 25 },
        ministration: minist({ minister: "Pastor (sample)", sermon_title: "Rooted and built up", bible_text: "Colossians 2:7", first_timers: 2, new_converts: 0 }),
        entries: [{ category: conf.offeringCategories[0], currency: conf.defaultCurrency, denomination: 5000, quantity: 4 }],
        notes: "Sample report waiting for Test Usher Three to countersign", countersignerId: id.u3, signature: "Test Usher Two", pin: pin
      }).then(function (r) { must(r, "Sample Second Service report"); log("Second Service report submitted by Test Usher Two, waiting for Test Usher Three to countersign"); });
    }).then(function () {
      return as(tok.tr, "dues.record", { usherId: id.u1, paidOn: today, amountPence: 500, method: "Cash", note: "Sample payment" })
        .then(function (r) { if (r.ok) log("Dues: £5 recorded for Test Usher One by Test Treasurer"); else log("Dues skipped: " + (r.message || r.error)); });
    }).then(function () {
      return Promise.all(Object.keys(tok).map(function (k) { return as(tok[k], "logout", {}).catch(function () {}); }));
    }).then(function () {
      log("Done. Sign out, then sign in as any test person with PIN " + pin + ". Their rows appear on the sheet within a minute.");
    });
  }

  function retire(log) {
    return C.api("ushers.list").then(function (j) {
      must(j, "Reading ushers");
      var test = j.ushers.filter(function (u) { return PEOPLE.some(function (p) { return p.name === u.name; }) && u.active; });
      if (!test.length) { log("No test people are switched on."); return; }
      var chain = Promise.resolve();
      test.forEach(function (u) {
        chain = chain.then(function () {
          return C.api("usher.save", { usherId: u.usherId, name: u.name, active: false, reason: "Test person switched off" })
            .then(function (x) { must(x, u.name); log(u.name + ": switched off"); });
        });
      });
      return chain.then(function () { log("Done. Their past rows stay on the sheet, labelled with the test names."); });
    });
  }

  /* The card on the Settings screen. */
  function card(conf) {
    var pin = h("input", { id: "tpin", type: "password", inputmode: "numeric", maxlength: "4", pattern: "[0-9]*", class: "pin", placeholder: "e.g. 2468" });
    var out = h("div", { class: "muted" });
    function log(t) { out.appendChild(h("div", {}, t)); }
    function busy(b) { add.disabled = off.disabled = b; }
    var add = h("button", { onclick: function () {
      C.clear(out);
      if (!/^\d{4}$/.test(pin.value)) { log("Choose a 4-digit PIN for the test people."); return; }
      busy(true); log("Working…");
      seed(pin.value, log, conf).catch(function (e) { log("Stopped: " + (e && e.message || e)); }).then(function () { busy(false); });
    } }, "Add test people and a sample week");
    var off = h("button", { class: "ghost", onclick: function () {
      C.clear(out); busy(true);
      retire(log).catch(function (e) { log("Stopped: " + (e && e.message || e)); }).then(function () { busy(false); });
    } }, "Switch off test people");
    return h("div", { class: "card" }, h("h2", {}, "Testing"),
      h("p", {}, "Adds six test people (Head Usher, Assistant Head Usher, Treasurer and three ushers), puts them on last Sunday's and next Sunday's rota where nobody is on it yet, and walks a sample week: one report verified, one waiting for its countersignature, and a dues payment. Sign in as any of them to see exactly what that role sees."),
      h("label", { for: "tpin" }, "PIN for every test person"), pin, h("p"),
      h("div", { class: "row" }, add, off), out);
  }

  window.UshersTesting = { card: card, PEOPLE: PEOPLE };
})();
