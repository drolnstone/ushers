/* Ushering App — the parts of a report both apps show: the ministration
   record, earlier versions, and the PDF button. Plain DOM via UshersCore.h. */
(function () {
  "use strict";
  var C = window.UshersCore, h = C.h;

  /* The ministration record, to fill in. fields come from the server's
     configuration (ministration_fields); values is changed in place. */
  function ministrationEdit(fields, values, onChange) {
    return h("div", { class: "card" }, h("h2", {}, "Ministration"),
      (fields || []).map(function (f) {
        var id = "min-" + f.key;
        var v = values[f.key] == null ? "" : values[f.key];
        return h("div", {}, h("label", { for: id }, f.label),
          h("input", { id: id, value: v, type: f.kind === "number" ? "number" : "text", min: f.kind === "number" ? "0" : null, step: f.kind === "number" ? "1" : null,
            inputmode: f.kind === "number" ? "numeric" : null, placeholder: f.kind === "number" ? "e.g. 2" : "",
            oninput: function (e) { values[f.key] = e.target.value; if (onChange) onChange(); } }));
      }));
  }

  function ministrationView(fields, values) {
    var rows = (fields || []).filter(function (f) { return values && values[f.key] !== undefined && values[f.key] !== ""; });
    return h("div", { class: "card" }, h("h2", {}, "Ministration"),
      rows.length ? h("table", {}, rows.map(function (f) { return h("tr", {}, h("td", {}, f.label), h("td", {}, h("b", {}, String(values[f.key])))); }))
        : h("p", { class: "muted" }, "Nothing recorded."));
  }

  function versionsView(versions) {
    if (!versions || !versions.length) return null;
    return h("div", { class: "card" }, h("h3", {}, "Earlier versions"),
      h("p", { class: "muted" }, "Kept as they were. Only the version above counts."),
      versions.slice().reverse().map(function (v) {
        return h("details", {}, h("summary", {}, "Version " + v.version + " · replaced " + C.timeLabel(v.replacedAt) + " by " + v.replacedBy),
          h("div", {}, "Reason: " + (v.reason || "—")),
          h("div", {}, "Submitted by " + (v.submitter || "—") + (v.countersigner ? " · countersigner " + v.countersigner : "") + " · " + v.status),
          h("div", {}, "Attendance " + v.attendance.total + " (" + v.attendance.male + " / " + v.attendance.female + " / " + v.attendance.children + ") · offering " + C.money(v.offeringTotal)));
      }));
  }

  var logo = null;
  function logoData(base) {
    if (logo) return logo;
    logo = fetch(base + "logo.png").then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (ok) { var f = new FileReader(); f.onload = function () { ok(f.result); }; f.onerror = function () { ok(null); }; f.readAsDataURL(b); });
    }).catch(function () { return null; });
    return logo;
  }

  /* A button that makes a PDF. prepare (optional) returns a promise of the
     data, read from the server when pressed; build(pdf, opt, data) returns
     { doc, name }. */
  function pdfButton(label, build, who, prepare) {
    var out = h("span", { class: "muted" });
    var base = String(location.pathname).indexOf("/admin/") !== -1 ? "../shared/" : "shared/";
    var btn = h("button", { class: "ghost", onclick: function () {
      btn.disabled = true; out.textContent = " Making the PDF…";
      Promise.all([C.loadPdf(), logoData(base), prepare ? prepare() : null]).then(function (x) {
        var made = build(x[0], { logo: x[1], who: who, made: new Date().toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) }, x[2]);
        made.doc.save(made.name);
        out.textContent = "";
      }).catch(function (e) { out.textContent = " " + (e && e.message || "Could not make the PDF."); })
        .then(function () { btn.disabled = false; });
    } }, label);
    return h("span", {}, btn, out);
  }

  window.UshersReports = { ministrationEdit: ministrationEdit, ministrationView: ministrationView, versionsView: versionsView, pdfButton: pdfButton };
})();
