/* PDF reports. The layout engine (clean, widths, the banner, tables that
   break across pages with their headings repeated, "Contains names" and
   "Page x of y" on every page) is the Driver App's coord/pdf.js, reused;
   what goes in it is the Ushering App's. The words are real text, so they
   can be selected, searched and read aloud. vendor/jspdf.umd.min.js (MIT,
   licence beside it) does the writing; nothing here reaches the network.

   UshersPdf.service(report, event, conf, opt)  one service report
   UshersPdf.period(summary, conf, opt)         a period summary
   Each returns { doc, name }; doc.save(name) downloads it.
     opt.logo   a PNG data URL, or nothing
     opt.made   when, as it is to be printed
     opt.who    who made it */

(function (root) {
  "use strict";

  /* The PDF's own fonts know Latin-1 and no more. */
  var SWAP = [[/[‘’‛′]/g, "'"], [/[“”″]/g, '"'], [/[–—−]/g, "-"], [/[·•]/g, "-"], [/…/g, "..."], [/[    ]/g, " "], [/→/g, "->"]];
  function clean(s) {
    s = String(s == null ? "" : s);
    SWAP.forEach(function (x) { s = s.replace(x[0], x[1]); });
    return s.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
  }

  var M = 14, FOOT = 10, PAD = 1.4, SIZE = 8.5, LINE = SIZE * 0.3528 * 1.25;

  function widths(doc, cols, rows, avail) {
    var n = cols.length;
    var want = cols.map(function (c, i) {
      doc.setFont("helvetica", "bold");
      var w = doc.getTextWidth(clean(c));
      doc.setFont("helvetica", "normal");
      rows.forEach(function (r) { String(clean(r[i])).split("\n").forEach(function (l) { w = Math.max(w, doc.getTextWidth(l)); }); });
      return w + 2 * PAD + 0.5;
    });
    var total = want.reduce(function (a, b) { return a + b; }, 0);
    if (total <= avail) return want.map(function (w) { return w * avail / total; });
    var share = avail / n;
    var got = want.map(function (w) { return Math.min(w, share); });
    var left = avail - got.reduce(function (a, b) { return a + b; }, 0);
    var need = want.map(function (w, i) { return w - got[i]; });
    var needAll = need.reduce(function (a, b) { return a + b; }, 0);
    return got.map(function (g, i) { return g + (needAll ? left * need[i] / needAll : 0); });
  }

  /* rep: { title, what, period, sections: [{ head, cols, rows, empty }], landscape } */
  function make(rep, opt) {
    opt = opt || {};
    var J = root.jspdf.jsPDF;
    var doc = new J({ orientation: rep.landscape ? "landscape" : "portrait", unit: "mm", format: "a4", compress: true });
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var avail = W - 2 * M;
    var title = clean(rep.title), what = clean(rep.what), period = clean(rep.period);
    doc.setProperties({ title: title + " - " + period, subject: "Contains names", author: clean(opt.church || ""), creator: "Ushering App" });

    var bh = 24, lh = 16, tx = M;
    doc.setFillColor(45, 21, 68);
    doc.rect(0, 0, W, bh, "F");
    if (opt.logo) {
      try { doc.addImage(opt.logo, "PNG", M, (bh - lh) / 2, lh, lh); tx = M + lh + 4; } catch (e) {}
    }
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text(clean(opt.church || "RCCG Dominion Assembly"), tx, bh / 2 - 0.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(210);
    doc.text(clean(opt.place || "Ushering Department"), tx, bh / 2 + 5);
    doc.setTextColor(0);
    var y = bh + 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(18);
    doc.text(title, M, y);
    y += 6;
    if (what) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(60);
      var wl = doc.splitTextToSize(what, avail);
      doc.text(wl, M, y);
      y += wl.length * 4.6;
      doc.setTextColor(0);
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text(period, M, y + 0.5);
    y += 4.8;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
    doc.text(clean("Made " + (opt.made || "") + (opt.who ? " by " + opt.who : "")), M, y);
    doc.setTextColor(0);
    y += 3;
    doc.setDrawColor(150); doc.setLineWidth(0.4); doc.line(M, y, W - M, y);
    y += 6;

    var bottom = H - M - FOOT;
    function newPage() { doc.addPage(); y = M; }
    function rowHeight(cells, ws) {
      var most = 1;
      cells.forEach(function (c, i) { most = Math.max(most, doc.splitTextToSize(clean(c), ws[i] - 2 * PAD).length); });
      return most * LINE + 2 * PAD;
    }
    function drawRow(cells, ws, bold, fill) {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      var h = rowHeight(cells, ws);
      if (fill != null) { doc.setFillColor(fill); doc.rect(M, y, avail, h, "F"); }
      var x = M;
      cells.forEach(function (c, i) {
        doc.text(doc.splitTextToSize(clean(c), ws[i] - 2 * PAD), x + PAD, y + PAD + LINE * 0.78, { lineHeightFactor: 1.25 });
        x += ws[i];
      });
      doc.setDrawColor(210); doc.setLineWidth(0.15); doc.line(M, y + h, W - M, y + h);
      y += h;
    }

    (rep.sections || []).forEach(function (sec) {
      var cols = (sec.cols || []).map(clean);
      var rows = (sec.rows || []).map(function (r) { return r.map(function (c) { return clean(c); }); });
      doc.setFontSize(SIZE);
      var ws = widths(doc, cols, rows, avail);
      var first = rows.length ? rowHeight(rows[0], ws) : LINE;
      if (y + 8 + (cols.some(function (c) { return c; }) ? rowHeight(cols, ws) : 0) + first > bottom) newPage();
      doc.setFont("helvetica", "bold"); doc.setFontSize(11.5);
      doc.text(clean(sec.head), M, y + 4);
      y += 7;
      doc.setFontSize(SIZE);
      if (!rows.length) {
        doc.setFont("helvetica", "normal"); doc.setTextColor(90);
        doc.text(clean(sec.empty || "None."), M, y + 3.5);
        doc.setTextColor(0);
        y += 9;
        return;
      }
      /* A two-column list of facts has no column headings to show. */
      var heads = cols.some(function (c) { return c; });
      if (heads) drawRow(cols, ws, true, 232);
      rows.forEach(function (r, i) {
        if (y + rowHeight(r, ws) > bottom) { newPage(); doc.setFontSize(SIZE); if (heads) drawRow(cols, ws, true, 232); }
        drawRow(r, ws, false, i % 2 ? 247 : null);
      });
      y += 6;
    });

    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
      doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(M, H - M - 4, W - M, H - M - 4);
      doc.setFont("helvetica", "bold");
      doc.text("Contains names", M, H - M);
      doc.setFont("helvetica", "normal");
      doc.text(title + " - " + period, W / 2, H - M, { align: "center" });
      doc.text("Page " + p + " of " + n, W - M, H - M, { align: "right" });
      doc.setTextColor(0);
    }
    return doc;
  }

  /* ---- what goes in them ------------------------------------------------ */

  function money(p) { return "£" + (Number(p || 0) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function coin(p) { p = Number(p); return p >= 100 ? "£" + (p / 100) : p + "p"; }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function day(k) {
    k = String(k || "");
    if (k.length !== 10) return k;
    var d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)));
    return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  function when(ms) {
    return ms ? new Date(ms).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  }
  function fieldsWith(fields, values) {
    return (fields || []).filter(function (f) { return values && values[f.key] !== undefined && values[f.key] !== ""; })
      .map(function (f) { return [f.label, String(values[f.key])]; });
  }

  function service(r, ev, conf, opt) {
    var s = [];
    s.push({ head: "The report", cols: ["", ""], rows: [
      ["Service", ev.title], ["Date", day(ev.date)], ["Status", r.statusLabel + (r.version > 1 ? " (version " + r.version + ", amended)" : "")],
      ["Submitted by", r.submitter + (r.submittedAt ? ", " + when(r.submittedAt) : "") + (r.submitSignature ? " - signed \"" + r.submitSignature + "\"" : "")],
      ["Countersigned by", r.countersignedAt ? r.countersigner + ", " + when(r.countersignedAt) + (r.countersignSignature ? " - signed \"" + r.countersignSignature + "\"" : "")
        : (r.countersignRequired ? "Waiting for " + (r.countersigner || "a countersigner") : "Not needed")]
    ] });
    var parts = r.parts || {};
    if (parts.attendance !== false) {
      s.push({ head: "Attendance", cols: ["Male", "Female", "Children", "Total"],
        rows: [[r.attendance.male, r.attendance.female, r.attendance.children, r.attendance.total]] });
    }
    if (parts.ministration !== false) {
      s.push({ head: "Ministration", cols: ["", ""], rows: fieldsWith(r.ministrationFields || conf.ministrationFields, r.ministration), empty: "Nothing recorded." });
    }
    if (parts.offering !== false) {
      s.push({ head: "Offering, by note and coin", cols: ["Category", "Note or coin", "Quantity", "Amount"],
        rows: (r.entries || []).map(function (x) { return [x.category, coin(x.denomination), x.quantity, money(x.amount)]; }), empty: "No offering recorded." });
      var cats = Object.keys(r.byCategory || {}).map(function (c) { return [c, money(r.byCategory[c])]; });
      cats.push(["Total", money(r.offeringTotal)]);
      s.push({ head: "Offering totals", cols: ["Category", "Amount"], rows: cats });
    }
    if (r.notes) s.push({ head: "Notes", cols: [""], rows: [[r.notes]] });
    s.push({ head: "History", cols: ["When", "Change", "Who", "Note"],
      rows: (r.history || []).map(function (x) { return [when(x.at), (x.from ? x.from + " -> " : "") + x.to, x.who, x.note || ""]; }) });
    if (r.versions && r.versions.length) {
      s.push({ head: "Earlier versions (kept, not current)", cols: ["Version", "Replaced", "By", "Reason", "Attendance", "Offering"],
        rows: r.versions.map(function (v) { return [v.version, when(v.replacedAt), v.replacedBy, v.reason, v.attendance.total, money(v.offeringTotal)]; }) });
    }
    var doc = make({ title: "Service report: " + ev.title, what: "Attendance, ministration and offering, as signed" + (r.countersignRequired ? " and countersigned." : "."),
      period: day(ev.date), sections: s }, Object.assign({ church: conf.churchName, place: conf.churchPlace }, opt));
    return { doc: doc, name: "Ushering - " + clean(ev.title) + " - " + ev.date + (r.version > 1 ? " v" + r.version : "") + ".pdf" };
  }

  function period(p, conf, opt) {
    var t = p.totals, s = [];
    s.push({ head: "Totals", cols: ["", ""], rows: [
      ["Services", t.events], ["Reports verified", t.verified], ["Reports waiting for countersignature", t.waiting], ["Services with no report yet", t.missing],
      ["Attendance (male / female / children)", t.male + " / " + t.female + " / " + t.children], ["Attendance, total", t.attendance], ["Offering, total", money(t.offering)]
    ] });
    var cats = (p.offeringCategories || []).filter(function (c) { return t.byCategory[c]; }).map(function (c) { return [c, money(t.byCategory[c])]; });
    Object.keys(t.byCategory).forEach(function (c) { if ((p.offeringCategories || []).indexOf(c) === -1) cats.push([c, money(t.byCategory[c])]); });
    s.push({ head: "Offering by category", cols: ["Category", "Amount"], rows: cats, empty: "No offering in this period." });
    var nums = (p.ministrationFields || []).filter(function (f) { return f.kind === "number"; }).map(function (f) { return [f.label, t.ministration[f.key] || 0]; });
    if (nums.length) s.push({ head: "Ministration totals", cols: ["", "Total"], rows: nums });
    var mk = ((p.ministrationFields || [])[0] || {}).key;
    s.push({ head: "Services", cols: ["Date", "Service", "Status", "Attendance", "Offering", "Ministered by", "Submitted / countersigned"],
      rows: p.rows.map(function (x) {
        return [day(x.date), x.title, x.statusLabel + (x.version > 1 ? " (v" + x.version + ")" : ""), x.attendance ? x.attendance.total : "",
          x.offeringTotal != null ? money(x.offeringTotal) : "", x.ministration && mk ? x.ministration[mk] || "" : "",
          x.submitter ? x.submitter + (x.countersigner ? " / " + x.countersigner : "") : ""];
      }), empty: "No services in this period." });
    var doc = make({ title: "Ushering summary", what: "Services, attendance, ministration and offering for the period, from the submitted reports.",
      period: day(p.from) + " to " + day(p.to), sections: s, landscape: true },
      Object.assign({ church: p.church || conf.churchName, place: p.place || conf.churchPlace }, opt));
    return { doc: doc, name: "Ushering - Summary - " + p.from + " to " + p.to + ".pdf" };
  }

  root.UshersPdf = { make: make, service: service, period: period, clean: clean };
})(typeof window !== "undefined" ? window : this);
