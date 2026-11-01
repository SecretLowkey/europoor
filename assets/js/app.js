/* EUROPOOR — main office.
   Router, pages, the departures board, the banknote and the meters.
   Plain JS, no build step. */
(function () {
  "use strict";
  var EP = window.EP;
  var D = window.EP_DATA || { measures: [], countries: [], eu: { values: {}, series: {}, index: { score: 50, components: {} } }, history: { years: [], index: [], components: {} } };
  var N = window.EP_NEWS || { items: [], league: { table: [] }, stats: {} };
  var app = document.getElementById("app");
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ======================================================================
     lookups and formatting
     ====================================================================== */
  var M = {}; D.measures.forEach(function (m) { M[m.key] = m; });
  var BY_SLUG = {}, BY_CODE = {};
  D.countries.forEach(function (c) { BY_SLUG[c.slug] = c; BY_CODE[c.code] = c; });
  var REGIONS = ["Western", "Northern", "Southern", "Central & Eastern"];
  var CATS = { inflation: "Inflation", economy: "Economy", government: "Government", jobs: "Jobs", energy: "Energy", debt: "Debt", housing: "Housing", living: "Cost of living" };
  var COMPONENTS = [["debt", "Debt", "Government debt, % of GDP"], ["growth", "Growth", "Real GDP, year on year"], ["energy", "Energy", "Household energy prices"], ["inflation", "Inflation", "Consumer prices, HICP"], ["purchasing_power", "Purchasing power", "Real household income"], ["unemployment", "Unemployment", "Share of the labour force"]];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var STATUS = ["ON TIME", "DELAYED", "DIVERTED", "CANCELLED"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function minus(s) { return String(s).replace(/^-/, "−"); }
  function fmtV(key, v) {
    if (v == null || isNaN(v)) return "–";
    var m = M[key] || { unit: "", decimals: 1 }, d = m.decimals != null ? m.decimals : 1;
    if (m.unit === "€/kWh") return "€" + v.toFixed(3);
    if (m.unit === "EU=100") return v.toFixed(0);
    return minus(v.toFixed(d)) + (m.unit && m.unit.indexOf("%") === 0 ? "%" : "");
  }
  function fmtDelta(key, d) {
    if (d == null || isNaN(d)) return "–";
    var m = M[key] || { unit: "" };
    if (m.unit === "€/kWh") return (d > 0 ? "+" : d < 0 ? "−" : "") + "€" + Math.abs(d).toFixed(3);
    if (m.unit === "EU=100") return (d > 0 ? "+" : "") + minus(d.toFixed(0)) + " pts";
    return (d > 0 ? "+" : "") + minus(d.toFixed(1)) + (m.unit && m.unit.indexOf("%") === 0 ? " pts" : "");
  }
  function worse(key, d) { var m = M[key]; if (!m || d == null || d === 0) return 0; return (m.worse === "lower" ? -d : d) > 0 ? 1 : -1; }
  function deltaCls(key, d) { var w = worse(key, d); return w > 0 ? "delta-dn" : w < 0 ? "delta-up" : ""; }
  function arrow(key, d) { var w = worse(key, d); return w > 0 ? "▼" : w < 0 ? "▲" : "▬"; }
  function ord(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function ordSup(n) { return ord(n).replace(/(\d+)(\D+)/, "$1<sup>$2</sup>"); }
  function label(score) {
    if (score >= 80) return "Send help";
    if (score >= 70) return "Alarming";
    if (score >= 60) return "Worrying";
    if (score >= 50) return "Concerning";
    if (score >= 40) return "Manageable";
    if (score >= 25) return "Coping";
    return "Suspiciously fine";
  }
  function longDate(d) { return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }
  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(s)) return "";
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    var d = Math.round(s / 86400); return d + (d === 1 ? " day ago" : " days ago");
  }
  function hhmm(iso) { var d = new Date(iso); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function dmy(iso) { var d = new Date(iso); return d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3); }
  function flagOf(code) { return EP.flag(code); }
  function nameOf(code) { if (code === "EU") return "EU-wide"; var c = BY_CODE[code]; return c ? c.name : code; }
  function refNo(seed) { var r = EP.rng(EP.hash(String(seed))); return "DG-DECL/" + new Date().getFullYear() + "/" + String(Math.floor(r() * 9000) + 1000); }
  function groupDigits(n) { return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  var toastT;
  function toast(msg) { var t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 2800); }
  function share(text, url) {
    var full = text + (url ? " " + url : "");
    if (navigator.share) navigator.share({ text: text, url: url }).catch(function () { copy(full); });
    else copy(full);
  }
  function copy(text) {
    try { navigator.clipboard.writeText(text).then(function () { toast("Copied. Paste it where it will do the most damage."); }, function () { fallbackCopy(text); }); }
    catch (e) { fallbackCopy(text); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Copied to clipboard."); } catch (e) { toast("Select and copy: " + text.slice(0, 60) + "…"); }
    ta.remove();
  }
  function pageURL(path) { return location.href.split("#")[0] + "#/" + (path || ""); }
  var I = {
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5M5 14v6h14v-6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 1.2h3.7l-8 9.2L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5L9 13 0 1.2h7.6l5.2 6.9 6.1-6.9Zm-1.3 19.4h2L6.5 3.3H4.3l13.3 17.3Z"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 3v13M7 11l5 5 5-5M5 20h14"/></svg>',
    arr: '<svg class="arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
    out: '<svg class="arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M15 2l7 7-3 1-4 4 1 5-2 2-4-5-6 6-1-1 6-6-5-4 2-2 5 1 4-4z"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#star"/></svg>'
  };

  var EU = D.eu, EUI = EU.index || { score: 50, components: {} };
  var leagueRows = (N.league && N.league.table) || [];
  var LEAGUE = {}; leagueRows.forEach(function (r) { LEAGUE[r.code] = r; });
  var dIdx = EUI.prev != null ? EUI.score - EUI.prev : 0;

  /* ======================================================================
     chrome: header, microprint, menu, footer
     ====================================================================== */
  (function chrome() {
    var mb = $("#microband"), txt = "";
    for (var i = 0; i < 6; i++) txt += "<span>Satire built on real news <b>★</b> Every filing links to its source <b>★</b> Every figure from an official statistics office <b>★</b> Not affiliated with the EU, any government or any news outlet <b>★</b> Series 2026 <b>★</b>&nbsp;</span>";
    mb.innerHTML = txt;
    EP.logo($("#logoStars"));
    $("#idxPill").innerHTML = '<span class="lbl">Index</span> <b>' + EUI.score.toFixed(1) + '</b><span class="up">' + (dIdx > 0.05 ? "▲" + dIdx.toFixed(1) : dIdx < -0.05 ? "▼" + Math.abs(dIdx).toFixed(1) : "") + "</span>";
    var head = $("#head");
    function onScroll() { head.classList.toggle("solid", window.scrollY > 30); }
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    var menu = $("#menu");
    function setMenu(open) { menu.classList.toggle("open", open); $("#menuBtn").setAttribute("aria-expanded", open); document.body.style.overflow = open ? "hidden" : ""; }
    $("#menuBtn").addEventListener("click", function () { setMenu(true); });
    $("#menuClose").addEventListener("click", function () { setMenu(false); });
    EP.closeMenu = function () { setMenu(false); };

    // footer: the letters of "poor" fall off when you get close
    var fw = $("#footWord");
    fw.addEventListener("mousemove", function (e) {
      $$("span", fw).forEach(function (s, i) {
        var r = s.getBoundingClientRect(), d = Math.abs(e.clientX - (r.left + r.width / 2));
        var hit = i >= 4 && d < r.width * 1.2;
        s.classList.toggle("drop", hit);
        s.style.transform = hit ? "translateY(" + (14 + (i % 3) * 6) + "%) rotate(" + ((i % 2 ? 1 : -1) * (8 + i)) + "deg)" : "";
      });
    });
    fw.addEventListener("mouseleave", function () { $$("span", fw).forEach(function (s) { s.style.transform = ""; s.classList.remove("drop"); }); });
    $("#footGen").textContent = "Figures filed " + (D.generated ? longDate(new Date(D.generated)) : "–") + " · Wire swept " + (N.generated ? ago(N.generated) : "–");
  })();

  /* ======================================================================
     meters: the shrinking €100 and the debt clock (estimates, labelled)
     ====================================================================== */
  var CLOCK = {
    anchor: Date.UTC(2025, 5, 30),   // end of Q2 2025
    debt: 14.79e12,                  // € — EU27 general government gross debt, approx. (Eurostat gov_10q_ggdebt)
    perYear: 0.031 * 18.4e12,        // ≈ 3.1 % deficit on ≈ €18.4 tn GDP
    people: 450.4e6
  };
  var YEAR = 365.25 * 864e5, opened = Date.now();
  var infl = ((EU.values.inflation || {}).v || 2.5) / 100;
  function debtNow(t) { return CLOCK.debt + ((t - CLOCK.anchor) / YEAR) * CLOCK.perYear; }
  var meterRAF = 0;
  function runMeters() {
    cancelAnimationFrame(meterRAF);
    var hundred = $("#mHundred"), debt = $("#mDebt"), since = $("#mSince");
    if (!hundred) return;
    (function tick() {
      var t = Date.now(), el = (t - opened) / YEAR;
      var s = (100 / Math.pow(1 + infl, el)).toFixed(9), cut = s.length - 4;
      hundred.innerHTML = '<span class="c">€</span>' + s.slice(0, cut) + '<span class="lo">' + s.slice(cut) + "</span>";
      debt.innerHTML = '<span class="c">€</span>' + groupDigits(debtNow(t));
      since.textContent = "€" + groupDigits(((t - opened) / 1000) * (CLOCK.perYear / (365.25 * 86400)));
      meterRAF = requestAnimationFrame(tick);
    })();
  }

  /* ======================================================================
     shared pieces
     ====================================================================== */
  function pushingText(comps) {
    var up = [], down = [];
    COMPONENTS.forEach(function (c) { var v = comps[c[0]]; if (v == null) return; (v >= 50 ? up : down).push([c[1].toLowerCase(), v]); });
    up.sort(function (a, b) { return b[1] - a[1]; }); down.sort(function (a, b) { return a[1] - b[1]; });
    var list = function (a) { a = a.map(function (x) { return x[0]; }); return a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0] || "nothing"; };
    return "<b>Pushing it up:</b> " + list(up) + ". <b>Holding it down:</b> " + list(down) + ".";
  }
  function compList(comps) {
    var rows = COMPONENTS.slice().sort(function (a, b) { return (comps[b[0]] || 0) - (comps[a[0]] || 0); });
    return '<div class="comp-list">' + rows.map(function (c, i) {
      var v = comps[c[0]]; if (v == null) return "";
      var hot = v >= 60;
      return '<div class="comp rv" style="--d:' + (i * 0.07) + 's"><div class="nm">' + c[1] + "<small>" + c[2] + '</small></div><div class="sc' + (hot ? " hot" : "") + '"><span data-count="' + v.toFixed(1) + '" data-dec="1">' + v.toFixed(1) + "</span></div>" +
        '<div class="bar"><i class="' + (hot ? "hot" : "") + '" data-w="' + Math.max(0, Math.min(100, v)) + '"></i></div></div>';
    }).join("") + "</div>";
  }
  function growBars(scope) {
    $$(".bar i[data-w]", scope).forEach(function (i) {
      var row = i.closest(".rv");
      var go = function () { i.style.width = i.getAttribute("data-w") + "%"; };
      if (row) { var prev = row._onReveal; row._onReveal = function () { prev && prev(); setTimeout(go, 200); }; }
      else requestAnimationFrame(go);
    });
  }
  function sectionHead(o) {
    return '<div class="sec-head"><div class="kicker"><span class="no">' + o.kicker + "</span>" + (o.micro ? '<span class="micro">' + o.micro + "</span>" : "") + "</div>" +
      '<div><h2 data-split>' + o.title + "</h2></div><div>" + (o.text ? '<p class="rv">' + o.text + "</p>" : "") + (o.actions ? '<div class="actions rv" style="--d:.1s">' + o.actions + "</div>" : "") + "</div></div>";
  }
  function phead(o) {
    return '<header class="phead ' + (o.ground || "s-cotton") + '"><canvas class="g" aria-hidden="true"></canvas><div class="wrap">' +
      (o.crumbs ? '<div class="crumbs micro">' + o.crumbs + "</div>" : "") + (o.pre || "") +
      '<h1 data-split>' + o.title + "</h1>" + (o.intro ? '<p class="intro rv" style="--d:.2s">' + o.intro + "</p>" : "") +
      (o.actions ? '<div class="actions rv" style="--d:.3s">' + o.actions + "</div>" : "") + (o.stamp || "") + "</div></header>";
  }
  function historyChart(host) {
    var h = D.history; if (!h || !h.years || !h.years.length) { host.innerHTML = '<p class="empty">History unavailable.</p>'; return; }
    var ann = [];
    var mark = function (y, text, dx, dy) { var i = h.years.indexOf(y); if (i >= 0 && h.index[i] != null) ann.push({ i: i, text: text, dx: dx, dy: dy }); };
    mark(2009, "Lehman, mostly", -20, -46);
    mark(2013, "the euro crisis", 30, -40);
    mark(2020, "a virus", -46, 64);
    mark(2022, "the gas bill", 30, -34);
    EP.lineChart(host, { labels: h.years.map(String), series: [{ values: h.index, name: "Europoor Index" }], yMin: 0, yMax: 100, band: [40, 60], ann: ann, height: 320, fmt: function (v) { return v.toFixed(0); }, label: "Europoor Index for the EU, yearly since " + h.years[0] });
    var sc = host.closest(".chart-scroll"); if (sc) requestAnimationFrame(function () { sc.scrollLeft = sc.scrollWidth; });
  }
  function formHTML(form) { return '<span class="form">' + (form || []).map(function (f) { return '<i class="' + f + '" title="' + (f === "L" ? "Bad week (a win, here)" : f === "D" ? "Middling week" : "Quiet week") + '">' + f + "</i>"; }).join("") + "</span>"; }
  function mv(n) { if (!n) return '<span class="mv-0">–</span>'; return n > 0 ? '<span class="mv-up">▲ ' + n + "</span>" : '<span class="mv-dn">▼ ' + -n + "</span>"; }
  function bindGuilloche(scope) { $$(".phead canvas.g", scope).forEach(function (c) { EP.heroGuilloche(c); }); }
  function mountRosette(ro, comps) {
    var SHORT = { debt: "Debt", growth: "Growth", energy: "Energy", inflation: "Prices", purchasing_power: "Income", unemployment: "Jobs" };
    var list = COMPONENTS.map(function (c) { return { key: c[0], label: SHORT[c[0]], v: comps[c[0]] != null ? comps[c[0]] : 50 }; });
    var pos = EP.rosette($("canvas", ro), list);
    list.forEach(function (c, i) {
      var l = document.createElement("div"); l.className = "rosette-lab" + (c.v >= 60 ? " hot" : "");
      l.style.left = pos[i].x + "%"; l.style.top = pos[i].y + "%";
      l.innerHTML = "<b>" + c.v.toFixed(0) + "</b><span>" + c.label + "</span>"; ro.appendChild(l);
    });
  }

  /* ---------- metals for the coin map ---------- */
  var METALS = [
    { n: "Gold", m: ["#ffe7a0", "#d9a521", "#7d560c"], t: "#4a3200" },
    { n: "Silver", m: ["#f4f6fa", "#b7bdca", "#5f6676"], t: "#262c3a" },
    { n: "Bronze", m: ["#f3bd88", "#b9712f", "#663510"], t: "#341804" },
    { n: "Copper", m: ["#e2906a", "#9c4422", "#4f1c09"], t: "#fff0e6" },
    { n: "Rust", m: ["#b9643a", "#6f2a12", "#2c0d04"], t: "#ffd9bf" }
  ];
  function metalFor(t) { return METALS[Math.max(0, Math.min(4, Math.floor(t * 5)))]; }
  function badnessT(measure) {
    var get = measure === "index" ? function (c) { return c.index ? c.index.score : null; } : function (c) { return c.values[measure] && c.values[measure].v; };
    var vals = D.countries.map(get).filter(function (v) { return v != null; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), m = M[measure] || { worse: "higher" };
    return function (c) { var v = get(c); if (v == null) return null; var t = hi === lo ? .5 : (v - lo) / (hi - lo); return m.worse === "lower" ? 1 - t : t; };
  }
  var POS = { IS: [0, 0], NO: [5, 0], SE: [6, 0], FI: [7, 0], IE: [1, 1], GB: [2, 1], DK: [5, 1], EE: [7, 1], NL: [3, 2], DE: [4, 2], PL: [5, 2], LT: [6, 2], LV: [7, 2], BE: [2, 3], LU: [3, 3], CZ: [4, 3], SK: [5, 3], FR: [2, 4], CH: [3, 4], AT: [4, 4], HU: [5, 4], RO: [6, 4], PT: [1, 5], ES: [2, 5], IT: [3, 5], SI: [4, 5], HR: [5, 5], BG: [6, 5], MT: [3, 6], GR: [6, 6], CY: [7, 6] };
  function coinsHTML(measure) {
    var tf = badnessT(measure), k = 0;
    var order = D.countries.filter(function (c) { return POS[c.code]; }).slice().sort(function (a, b) { return (tf(b) || 0) - (tf(a) || 0); }).map(function (c) { return c.code; });
    return D.countries.filter(function (c) { return POS[c.code]; }).map(function (c) {
      var p = POS[c.code], t = tf(c), mt = metalFor(t == null ? .5 : t);
      var v = measure === "index" ? (c.index && c.index.score != null ? c.index.score.toFixed(1) : "–") : fmtV(measure, c.values[measure] && c.values[measure].v);
      return '<a class="coin' + (mt.n === "Rust" ? " rust" : "") + '" href="#/country/' + c.slug + '" data-route data-code="' + c.code + '" style="--gc:' + (p[0] + 1) + ";--gr:" + (p[1] + 1) + ";--o:" + order.indexOf(c.code) + ";--i:" + (k++) + ";--m1:" + mt.m[0] + ";--m2:" + mt.m[1] + ";--m3:" + mt.m[2] + ";--mt:" + mt.t + '" aria-label="' + esc(c.name) + ": " + v + '">' +
        '<span class="coin-in"><span class="coin-f"><span class="c">' + c.code + "<small>" + v + '</small></span></span><span class="coin-b"><span class="s">' + v + "<small>" + mt.n + "</small></span></span></span></a>";
    }).join("");
  }
  function coinSide(c, measure) {
    if (!c) return "";
    var i = c.index || {}, lg = LEAGUE[c.code], tf = badnessT(measure), mt = metalFor(tf(c) == null ? .5 : tf(c));
    return '<div class="anim"><span class="label">' + esc(c.region) + " · " + (c.euro ? "Euro" : esc(c.currency)) + " · minted in " + mt.n.toLowerCase() + "</span>" +
      "<h3>" + flagOf(c.code) + esc(c.name) + "</h3>" +
      '<div class="big">' + (i.score != null ? i.score.toFixed(1) : "–") + '</div><p class="micro">Europoor Index · ' + (i.rank ? ord(i.rank) + " worst of " + D.countries.length : "") + "</p>" +
      '<div class="kv">' + ["inflation", "unemployment", "growth", "debt"].map(function (k) { var v = c.values[k] || {}; return "<div><span>" + M[k].label + "</span><b>" + fmtV(k, v.v) + "</b></div>"; }).join("") +
      (lg ? "<div><span>Decline League</span><b>" + ord(lg.pos) + "</b></div>" : "") + "</div>" +
      '<a class="btn sm" style="margin-top:18px" href="#/country/' + c.slug + '" data-route>Open the dossier ' + I.arr + "</a></div>";
  }
  function coinsSection(ref) {
    var opts = [["index", "Index"], ["inflation", "Inflation"], ["unemployment", "Jobless"], ["growth", "Growth"], ["debt", "Debt"], ["electricity", "Power"]];
    return '<div class="coins-wrap"><div><div class="seg rv" role="group" aria-label="Mint the coins by" style="margin-bottom:22px">' +
      opts.map(function (o) { return '<button type="button" data-m="' + o[0] + '" aria-pressed="' + (ref.m === o[0]) + '">' + o[1] + "</button>"; }).join("") +
      '</div><div class="coins" id="coins">' + coinsHTML(ref.m) + "</div>" +
      '<div class="legend micro">' + METALS.map(function (m) { return '<i style="--m1:' + m.m[0] + ";--m2:" + m.m[1] + ";--m3:" + m.m[2] + '"></i>' + m.n; }).join(" ") + "</div></div>" +
      '<aside class="coin-side" id="coinSide">' + coinSide(BY_CODE.FR || D.countries[0], ref.m) + "</aside></div>";
  }
  function wireCoins(scope, ref) {
    function bind() {
      $$(".coin", scope).forEach(function (t) {
        var show = function () { $("#coinSide", scope).innerHTML = coinSide(BY_CODE[t.getAttribute("data-code")], ref.m); };
        t.addEventListener("mouseenter", show); t.addEventListener("focus", show);
      });
    }
    $$("[data-m]", scope).forEach(function (b) {
      b.addEventListener("click", function () {
        ref.m = b.getAttribute("data-m");
        $$("[data-m]", scope).forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
        var box = $("#coins", scope); box.classList.remove("in"); box.innerHTML = coinsHTML(ref.m);
        requestAnimationFrame(function () { requestAnimationFrame(function () { box.classList.add("in"); }); });
        bind();
      });
    });
    bind();
  }

  /* ---------- league pieces ---------- */
  function podium(rows) {
    return '<div class="podium">' + rows.slice(0, 3).map(function (r, i) {
      return '<a class="pod p' + (i + 1) + ' rv" style="--d:' + (i * .1) + 's" href="#/country/' + r.slug + '" data-route>' +
        '<span class="ord">' + ordSup(i + 1) + "</span>" + (i === 0 ? '<span class="stamp">Champion of decline</span>' : "") +
        '<span class="nm">' + flagOf(r.code) + esc(r.name) + "</span>" +
        '<span class="bottom"><span><span class="sc" data-count="' + r.score.toFixed(1) + '" data-dec="1">' + r.score.toFixed(1) + '</span><br><span class="micro">points · ' + r.filings + " filings</span></span>" + formHTML(r.form) + "</span></a>";
    }).join("") + "</div>";
  }
  function leagueTable(rows, opts) {
    opts = opts || {};
    var key = opts.window || "7d", sorted = rows.slice();
    if (key !== "7d") { var sk = key === "28d" ? "score_28d" : "score_season"; sorted.sort(function (a, b) { return (b[sk] || 0) - (a[sk] || 0); }); }
    var from = opts.from || 0, lim = opts.limit || sorted.length, total = sorted.length;
    var body = sorted.slice(from, lim).map(function (r, j) {
      var pos = from + j + 1, score = key === "7d" ? r.score : key === "28d" ? r.score_28d : r.score_season, fil = key === "7d" ? r.filings : key === "28d" ? r.filings_28d : r.filings_season;
      var zone = pos <= 4 ? "zone-crisis" : pos > total - 4 ? "zone-fine" : "";
      var line = pos === 4 && lim > 4 ? " zone-line" : pos === total - 3 ? " zone-line-fine" : "";
      return '<tr class="' + zone + line + '"><td><span class="pos">' + pos + "</span></td>" +
        '<td><span class="cn">' + flagOf(r.code) + '<a href="#/country/' + r.slug + '" data-route>' + esc(r.name) + "</a></span></td>" +
        '<td class="r"><span class="score">' + (score != null ? score.toFixed(1) : "–") + "</span></td>" +
        "<td>" + formHTML(r.form) + "</td>" + '<td class="r opt">' + (key === "7d" ? mv(r.movement) : "–") + "</td>" + '<td class="r opt">' + (fil != null ? fil : "–") + "</td>" +
        (opts.full ? '<td class="r opt">' + (r.points != null ? r.points.toFixed(1) : "–") + '</td><td class="r opt">' + (r.coverage != null ? r.coverage.toFixed(1) : "–") + "</td>" : "") + "</tr>";
    }).join("");
    return '<div class="tbl-wrap rv"><table class="tbl"><thead><tr><th>Pos</th><th>Country</th><th class="r">Score</th><th>Form</th><th class="r opt">Move</th><th class="r opt">Filings</th>' +
      (opts.full ? '<th class="r opt">Raw pts</th><th class="r opt">Usual coverage</th>' : "") + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  /* ---------- filings ---------- */
  function filing(it, isNew) {
    var also = (it.also || []).length ? " · also " + it.also.map(function (a) { return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.source) + "</a>"; }).join(", ") : "";
    var st = STATUS[it.severity] || STATUS[0];
    return '<article class="filing' + (isNew ? " new" : "") + '" data-id="' + it.id + '">' +
      '<div class="when"><b>' + hhmm(it.published) + "</b><span>" + dmy(it.published) + "</span></div>" +
      '<div class="meta"><span class="cat ' + it.category + '">' + (CATS[it.category] || it.category) + '</span><span class="flags">' + (it.countries || []).map(flagOf).join("") + "</span><span>" + esc((it.countries || []).map(nameOf).join(", ")) + "</span></div>" +
      '<h3><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + "</a></h3>" +
      (it.memo ? '<p class="memo">' + esc(it.memo) + "</p>" : "") +
      '<p class="src">' + esc(it.source) + (it.corroboration > 1 ? " · " + it.corroboration + " sources" : "") + also + " · " + ago(it.published) + " · +" + (it.points || 0).toFixed(1) + " pts</p>" +
      '<span class="status st-' + st.split(" ")[0] + '"><span class="st-pill">' + st + "</span>" + EP.flaps(9, st) + "</span></article>";
  }
  function wireStale() {
    var every = (N.next_refresh_minutes || 15) * 60000;
    return Date.now() - new Date(N.generated).getTime() > every * 2;
  }
  function wireCadence(word) {
    if (wireStale()) return "Last swept " + ago(N.generated);
    return word + (N.next_refresh_minutes || 15) + " min";
  }
  function wireStatus() {
    var st = N.stats || {}, gen = N.generated, next = (N.next_refresh_minutes || 15) * 60000;
    return '<span class="micro wire-live"><b>' + (st.items_24h != null ? st.items_24h : "–") + "</b> filings in 24 h · <b>" + (st.severe_7d != null ? st.severe_7d : "–") + '</b> severe this week · swept <b data-ago="' + esc(gen) + '">' + ago(gen) + '</b>' + (wireStale() ? "" : ' · next sweep <b data-next="' + (new Date(gen).getTime() + next) + '">–</b>') + "</span>";
  }
  setInterval(function () {
    $$("[data-ago]").forEach(function (n) { n.textContent = ago(n.getAttribute("data-ago")); });
    $$("[data-next]").forEach(function (n) {
      var s = Math.round((+n.getAttribute("data-next") - Date.now()) / 1000);
      n.textContent = s > 0 ? Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2) : s > -600 ? "any moment" : "overdue";
    });
  }, 1000);

  /* ---------- the departures board ---------- */
  var boardTimer = 0, clockTimer = 0, boardRestart = null, wireRedraw = null, freshIds = {};
  function departures(host, opts) {
    opts = opts || {};
    clearInterval(boardTimer); clearInterval(clockTimer);
    function getPool() {
      var p = N.items.filter(function (i) { return i.severity >= 1; });
      if (p.length < 10) p = N.items.slice();
      return p.slice(0, 40);
    }
    var pool = getPool();
    var rows = opts.rows || 8, off = 0, sel = 0;
    // phones get two lines of flaps per destination, wrapped on whole words
    var stacked = window.matchMedia && matchMedia("(max-width: 1099px)").matches;
    var per = 44, lines = 1;
    if (stacked) { per = Math.max(14, Math.floor((host.clientWidth - 30) / (window.innerWidth >= 760 ? 14 : 13))); lines = 2; }
    function wrapTo(text, n, max) {
      var out = [], cur = "";
      String(text).split(/\s+/).forEach(function (w) {
        if (out.length >= max || !w) return;
        if (!cur) cur = w.slice(0, n);
        else if ((cur + " " + w).length <= n) cur += " " + w;
        else { out.push(cur); cur = out.length < max ? w.slice(0, n) : ""; }
      });
      if (cur && out.length < max) out.push(cur);
      while (out.length < max) out.push("");
      return out;
    }
    host.innerHTML = '<div class="board rv"><div class="board-top"><div class="board-title"><b>Departures</b><span>Départs · Abfahrt · Partenze · Salidas · Odjazdy</span></div>' +
      '<div class="board-clock" id="bclock">' + EP.flaps(2, "00") + '<span class="flap" aria-hidden="true">:</span>' + EP.flaps(2, "00") + "</div></div>" +
      '<div class="board-cols"><span>Time</span><span>From</span><span>Destination</span><span>Status</span></div><div>' +
      Array.from({ length: rows }, function (_, i) {
        return '<button class="brow" type="button" data-row="' + i + '"><span class="t">' + EP.flaps(5, "") + '</span><span class="cty"><span class="fl"></span><span class="code">' + EP.flaps(2, "") + '</span></span><span class="dest">' + Array.from({ length: lines }, function () { return EP.flaps(per, ""); }).join("") + '</span><span class="stat">' + EP.flaps(9, "") + "</span></button>";
      }).join("") + '</div><div class="board-detail" aria-live="polite"></div></div>';
    var rowEls = $$(".brow", host), detailEl = $(".board-detail", host);
    function fill(first) {
      pool = getPool();
      rowEls.forEach(function (row, i) {
        var it = pool[(off + i) % pool.length]; if (!it) return;
        var st = STATUS[it.severity] || STATUS[0], code = (it.countries || ["EU"])[0] || "EU";
        var delay = first ? i * 90 : i * 40;
        EP.setFlaps($(".t .flaps", row), hhmm(it.published), { delay: delay });
        EP.setFlaps($(".code .flaps", row), code, { delay: delay });
        var parts = wrapTo(it.title, per, lines);
        $$(".dest .flaps", row).forEach(function (f, li) { EP.setFlaps(f, parts[li], { delay: delay + 60 + li * 120 }); });
        EP.setFlaps($(".stat .flaps", row), st, { delay: delay + 120 });
        $(".stat", row).className = "stat st-" + st.split(" ")[0];
        $(".fl", row).innerHTML = flagOf(code);
        row.setAttribute("aria-label", hhmm(it.published) + ", " + nameOf(code) + ": " + it.title + ". " + st);
        row._it = it;
      });
      detail();
    }
    function detail() {
      var it = rowEls[sel] && rowEls[sel]._it; if (!it) return;
      rowEls.forEach(function (r, i) { r.classList.toggle("sel", i === sel); });
      detailEl.innerHTML = '<div class="anim"><h3><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + "</a></h3>" +
        (it.memo ? '<p class="memo pen">' + esc(it.memo) + "</p>" : "") +
        '<div class="meta"><span class="cat ' + it.category + '">' + (CATS[it.category] || it.category) + '</span><span class="flags">' + (it.countries || []).map(flagOf).join("") + '</span><span class="micro">' + esc(it.source) + " · " + ago(it.published) + " · +" + (it.points || 0).toFixed(1) + " pts</span></div></div>" +
        '<a class="btn sm" href="' + esc(it.url) + '" target="_blank" rel="noopener">Read at source ' + I.out + "</a>";
    }
    rowEls.forEach(function (r, i) {
      r.addEventListener("mouseenter", function () { if (sel !== i) { sel = i; detail(); } });
      r.addEventListener("focus", function () { sel = i; detail(); });
      r.addEventListener("click", function () { sel = i; detail(); });
    });
    var started = false, board = $(".board", host);
    boardRestart = function () { off = 0; if (started) fill(false); };
    board._onReveal = function () { if (started) return; started = true; fill(true); };
    function clock() {
      var d = new Date(), f = $$(".board-clock .flaps", host);
      if (!f.length) return;
      EP.setFlaps(f[0], ("0" + d.getHours()).slice(-2)); EP.setFlaps(f[1], ("0" + d.getMinutes()).slice(-2));
    }
    clock(); clockTimer = setInterval(clock, 5000);
    if (!EP.reduce) boardTimer = setInterval(function () {
      if (!host.isConnected) { clearInterval(boardTimer); return; }
      if (!started || document.hidden) return;
      off = (off + 1) % Math.max(1, pool.length); fill(false);
    }, 10000);
  }

  /* poll for a fresher wire. The sweeper rewrites data/news.json; anything new
     is folded straight into the page that is open, no reload needed. */
  var polling = false, FEED = window.EP_FEED || "";
  function poll() {
    if ((location.protocol === "file:" && !FEED) || polling) return;
    polling = true;
    // check the tiny version file first: news.json is about 300 KB and most checks find nothing new
    fetch(FEED + "data/version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
      if (!v || v.generated === N.generated) return null;
      return fetch(FEED + "data/news.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; });
    }).then(function (fresh) {
      if (!fresh || !fresh.items || fresh.generated === N.generated) return;
      var known = {}; N.items.forEach(function (i) { known[i.id] = 1; });
      var arrivals = fresh.items.filter(function (i) { return !known[i.id]; });
      N = fresh; leagueRows = (N.league && N.league.table) || leagueRows;
      LEAGUE = {}; leagueRows.forEach(function (r) { LEAGUE[r.code] = r; });
      arrivals.forEach(function (a) { freshIds[a.id] = 1; });
      $$(".wire-live").forEach(function (el) { el.outerHTML = wireStatus(); });
      if (wireRedraw) wireRedraw();
      if (arrivals.length && boardRestart) boardRestart();
      if (arrivals.length) toast(arrivals.length + " new filing" + (arrivals.length > 1 ? "s" : "") + " on the wire.");
    }).catch(function () {}).then(function () { polling = false; });
  }
  setInterval(poll, 300000);
  setTimeout(poll, 1500);   // the deployed copy may be old: catch up as soon as the page opens
  document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });

  /* ======================================================================
     PAGES
     ====================================================================== */
  var pages = {};
  var heroRing = null;

  /* ---------------- home ---------------- */
  pages.home = function () {
    var s = EUI.score, now = new Date(), st = N.stats || {}, ev = EU.values;
    var word = "poorer".split("").map(function (c, i) { return '<span class="ch foil-text" style="--i:' + i + ";animation-delay:calc(.25s + " + i * 60 + "ms), " + (i * .25) + 's">' + c + "</span>"; }).join("");
    var micro = ""; for (var k = 0; k < 14; k++) micro += "EUROPOOR · DIRECTORATE-GENERAL FOR DECLINE · NOT LEGAL TENDER · ";
    var mItems = [
      ["Inflation", fmtV("inflation", (ev.inflation || {}).v)], ["Debt", fmtV("debt", (ev.debt || {}).v) + " of GDP"], ["Youth jobless", fmtV("youth_unemployment", (ev.youth_unemployment || {}).v)],
      ["Growth", fmtV("growth", (ev.growth || {}).v)], ["Power", fmtV("electricity", (ev.electricity || {}).v) + "/kWh"], ["Deficit", fmtV("deficit", (ev.deficit || {}).v)]
    ];
    var mq = mItems.map(function (m, i) { return '<span class="marquee-item"><span class="' + (i % 2 ? "o" : "") + '">' + m[0] + '</span><span class="v">' + m[1] + "</span>" + I.star + "</span>"; }).join("");
    var cref = { m: "index" };

    app.innerHTML =
      '<section class="hero s-cotton"><canvas class="hero-ring" id="heroRing" aria-hidden="true"></canvas>' +
      '<div class="wrap">' +
      '<div class="hero-meta micro"><span>Series 2026</span><span>Situation report · <b>' + longDate(now) + "</b></span><span>" + refNo(now.toDateString()) + '</span><span>Wire · <b>' + (st.items_24h || "–") + "</b> filings today</span></div>" +
      '<h1><span class="a">Europe is getting <span class="strike">richer<svg viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true"><path d="' + EP.wobble([[4, 40], [80, 26], [160, 34], [230, 18], [296, 26]], 11, 5) + '"/></svg></span></span>' +
      '<span class="b">' + word + '<span class="star" aria-hidden="true">' + I.star + "</span></span></h1>" +
      '<div class="hero-row"><div class="note-wrap rv">' +
      '<div class="note" id="note" role="img" aria-label="A satirical banknote showing the Europoor Index: ' + s.toFixed(1) + " out of 100, " + label(s) + '.">' +
      '<canvas class="g" aria-hidden="true"></canvas><div class="note-microline t" aria-hidden="true">' + micro + '</div><div class="note-microline b" aria-hidden="true">' + micro + "</div>" +
      '<div class="note-frame"></div><div class="note-portrait"></div>' +
      '<div class="note-name">EUROPOOR<small>Index of decline · Series 2026</small></div>' +
      '<div class="note-denom"><span data-count="' + s.toFixed(1) + '" data-dec="1">' + s.toFixed(1) + "</span></div>" +
      '<div class="note-stamp"><span class="stamp">' + label(s) + "</span></div>" +
      '<div class="note-serial">EP ' + String(Math.round(s * 10)).padStart(4, "0") + " " + now.getFullYear() + " ★ " + refNo("serial").slice(-4) + "</div>" +
      '<div class="note-strip"><span>★ EUROPOOR ★ 2026 ★</span></div><div class="note-small">' + s.toFixed(1) + "</div></div>" +
      '<div class="note-caption micro"><span>Legal tender for nothing</span><span>' + (Math.abs(dIdx) < .05 ? "No change on the last reading" : (dIdx > 0 ? "Up " : "Down ") + Math.abs(dIdx).toFixed(1) + " on the last reading") + " · out of 100</span></div></div>" +
      '<div class="h-lede rv" style="--d:.1s"><p class="hero-lede">The Directorate-General for Decline keeps the receipts: <b>an index</b> built from six official statistics, <b>a weekly league</b> of setback news, and <b>a live departures board</b> of every budget hole, price rise and factory closure in 31 countries. Each one links to its source.</p>' +
      '<div class="hero-cta"><a class="btn" href="#/wire" data-route>Open the wire ' + I.arr + '</a><a class="btn ghost" href="#/index" data-route>Read the index</a></div></div>' +
      '<div class="meters rv" style="--d:.2s">' +
      '<div class="meter"><div class="row"><span class="label">€100 in a eurozone savings account, since you arrived</span><span class="micro">at ' + (infl * 100).toFixed(1) + '% inflation</span></div><div class="v" id="mHundred">€100</div></div>' +
      '<div class="meter"><div class="row"><span class="label">EU government debt, roughly right now</span><span class="micro">+€' + groupDigits(CLOCK.perYear / (365.25 * 86400)) + ' a second</span></div><div class="v" id="mDebt">€–</div></div>' +
      '<div class="meter"><div class="row"><span class="label">Borrowed since you opened this page</span><span class="micro" id="mSince">€0</span></div><p class="micro" style="text-transform:none;letter-spacing:.02em">Estimates. Debt: Eurostat\'s latest quarter, extended at the pace of the latest annual deficit. Savings: the latest EU inflation rate, applied by the second.</p></div>' +
      "</div></div></div></section>" +

      '<section class="marquee s-ultra" aria-label="Europe\'s latest figures"><div class="marquee-track" id="mq">' + mq + mq + "</div></section>" +

      '<section class="sec s-paper2"><div class="wrap">' +
      sectionHead({ kicker: "/wire", micro: wireCadence("Live · swept every "), title: "The <i>Wire</i>", text: "Setback news from 31 countries, read off Europe's press and posted like trains that aren't coming. The headlines are the publishers' own. The red ink is ours.", actions: wireStatus() }) +
      '<div id="board"></div><div class="board-foot rv"><span class="micro">On time = good news · delayed = setback · diverted = serious · cancelled = severe</span><a class="btn" href="#/wire" data-route>All departures ' + I.arr + "</a></div></div></section>" +

      '<section class="sec s-cotton"><div class="wrap">' +
      sectionHead({ kicker: "/index", micro: "Series 2000–" + new Date().getFullYear(), title: "The Europoor <i>Index</i>", text: "How badly Europe's economy is doing, scored from 0 (suspiciously fine) to 100 (send help) from six official statistics. Each lobe of the rosette is one of them: the further it reaches past the dashed ring, the worse things are.", actions: '<button class="btn" type="button" id="shareIdx">' + I.share + ' Share the index</button><a class="btn ghost" href="#/index" data-route>How it\'s made</a>' }) +
      '<div class="frame rv"><div class="frame-h"><b>Europe today</b><span class="micro">' + refNo("today" + D.generated) + ' · updated <span data-ago="' + esc(D.generated) + '">' + ago(D.generated) + '</span></span></div><div class="frame-b">' +
      '<div class="rosette-grid"><div class="rosette rv" id="rosette"><canvas aria-hidden="true"></canvas><div class="rosette-center"><div><div class="n" data-count="' + s.toFixed(1) + '" data-dec="1">' + s.toFixed(1) + '</div><div class="micro">out of 100</div></div></div></div>' +
      '<div><p class="pushing rv">' + pushingText(EUI.components) + "</p>" + compList(EUI.components) + '<p class="micro rv" style="margin-top:14px;text-transform:none;letter-spacing:.03em">Badness out of 100. The tick on each bar marks 50, an ordinary figure for 2000–2019.</p></div></div>' +
      '</div><div class="frame-f micro">It only moves when an official figure arrives, is revised or goes out of date. ' + (Math.abs(dIdx) < .05 ? "No change on the last reading." : (dIdx > 0 ? "Up " : "Down ") + Math.abs(dIdx).toFixed(1) + " on the last reading.") + '</div></div>' +
      '<div class="chart-box rv" style="margin-top:clamp(40px,6vw,80px)"><div class="chart-art" aria-hidden="true"></div><div class="top"><h3>Since <i>2000</i></h3><span class="micro">Shaded band: an ordinary year</span></div><div class="chart-scroll"><div id="histHost"></div></div></div>' +
      "</div></section>" +

      '<section class="sec s-ultra"><div class="wrap">' +
      sectionHead({ kicker: "/map", micro: "Tap a coin for its dossier", title: "Small <i>change</i>", text: "Thirty-one countries, minted according to how badly they are doing. Gold means fine. Rust means look away. Geography has been simplified, and so has hope." }) +
      coinsSection(cref) + "</div></section>" +

      '<section class="sec s-paper2"><div class="wrap">' +
      sectionHead({ kicker: "/league", micro: "Rolling 7 days", title: "The Decline <i>League</i>", text: "Countries ranked by setback news. Severity, corroboration and each country's usual media coverage go into the points, so big countries don't win just for being in the news.", actions: '<a class="btn" href="#/league" data-route>Full table ' + I.arr + "</a>" }) +
      podium(leagueRows) + leagueTable(leagueRows, { from: 3, limit: 10 }) +
      '<div class="zone-key micro"><span style="--k:var(--red)">Crisis zone</span><span style="--k:var(--mint)">Suspiciously fine</span><span>Form: L = a bad week, which counts as a win here</span></div></div></section>' +

      '<section class="sec s-cotton"><div class="wrap">' +
      sectionHead({ kicker: "/play", micro: "New puzzles at midnight UTC", title: "Three daily <i>games</i>", text: "The same puzzles for everyone, every day. Scratch a card to play. Streaks, share grids and achievements stay on your device." }) +
      EP.Games.cards() + "</div></section>" +

      '<section class="sec s-ultra follow"><div class="wrap"><p class="label rv">Notifications</p><h2 data-split style="margin-top:18px">Follow the <i>decline.</i></h2>' +
      '<p class="rv">The worst filing of the day, the index whenever it moves, and the league every Monday. On X, where good news goes to die.</p>' +
      '<a class="btn x-cta rv" href="https://x.com/theEuropoor" target="_blank" rel="noopener">' + I.x + " Follow @theEuropoor</a></div></section>";

    heroRing = EP.ring($("#heroRing"), s);
    EP.noteGuilloche($("#note canvas.g"));
    EP.tilt($("#note"));
    EP.marquee($("#mq"));
    departures($("#board"));
    mountRosette($("#rosette"), EUI.components);
    historyChart($("#histHost"));
    wireCoins(app, cref);
    EP.Games.bindCards(app);
    runMeters();
    $("#shareIdx").addEventListener("click", function () { share("The Europoor Index is at " + s.toFixed(1) + "/100 (" + label(s).toLowerCase() + "). Europe is getting poorer, officially-ish.", pageURL("index")); });
  };

  /* ---------------- wire ---------------- */
  var wireState = { cat: "all", country: "all", sev: 1, q: "", shown: 40 };
  pages.wire = function () {
    var items = N.items, st = N.stats || {};
    var counts = {}; items.forEach(function (i) { counts[i.category] = (counts[i.category] || 0) + 1; });
    var ctyCounts = {}; items.forEach(function (i) { (i.countries || []).forEach(function (c) { ctyCounts[c] = (ctyCounts[c] || 0) + 1; }); });
    var ctyOpts = Object.keys(ctyCounts).sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b)); });
    app.innerHTML = phead({
      crumbs: '<a href="#/" data-route>Home</a><span>/</span><span>Wire</span>',
      pre: '<div class="kicker"><span class="no">' + (wireStale() ? "Wire" : "● Live") + '</span><span class="rule"></span><span class="micro">' + wireCadence("Swept every ") + "</span></div>",
      title: "The <i>Wire</i>",
      intro: "Every setback, filed as it lands. Headlines come straight from the publisher and link to the original story. We add the category, the countries, a status (on time, delayed, diverted, cancelled) and a short note from the Directorate. Good news is filed too, with suspicion.",
      actions: wireStatus()
    }) +
      '<section class="s-paper2 page-body"><div class="wrap"><div id="board"></div>' +
      '<div class="wire-layout" style="margin-top:clamp(40px,6vw,80px)"><aside class="wire-side" aria-label="Filter the wire">' +
      '<div class="fgroup"><label class="label" for="wq">Search</label><input class="field" id="wq" type="search" placeholder="Budget, Renault, ECB…" value="' + esc(wireState.q) + '"></div>' +
      '<div class="fgroup cats"><span class="label">Category</span>' + ["all"].concat(Object.keys(CATS)).map(function (k) { return '<button class="fbtn" type="button" data-cat="' + k + '" aria-pressed="' + (wireState.cat === k) + '"><span>' + (k === "all" ? "Everything" : '<span class="cat ' + k + '">' + CATS[k] + "</span>") + '</span><span class="n">' + (k === "all" ? items.length : counts[k] || 0) + "</span></button>"; }).join("") + "</div>" +
      '<div class="fgroup"><label class="label" for="wc">Country</label><select class="field" id="wc"><option value="all">All 31 and the EU</option>' + ctyOpts.map(function (c) { return '<option value="' + c + '"' + (wireState.country === c ? " selected" : "") + ">" + esc(nameOf(c)) + " (" + ctyCounts[c] + ")</option>"; }).join("") + "</select></div>" +
      '<div class="fgroup"><span class="label">Status</span><div class="seg" role="group" aria-label="Minimum severity">' + [[0, "All"], [1, "Delayed+"], [2, "Diverted+"], [3, "Cancelled"]].map(function (s) { return '<button type="button" data-sev="' + s[0] + '" aria-pressed="' + (wireState.sev === s[0]) + '">' + s[1] + "</button>"; }).join("") + "</div></div>" +
      '<div class="fgroup stats-group"><span class="label">This week</span><div class="kv" style="margin-top:0"><div><span>Filings, 24 h</span><b>' + (st.items_24h || "–") + "</b></div><div><span>Filings, 7 days</span><b>" + (st.items_7d || "–") + "</b></div><div><span>Severe, 7 days</span><b>" + (st.severe_7d || "–") + "</b></div><div><span>Most filed</span><b>" + (st.most_filed_country ? esc(nameOf(st.most_filed_country)) : "–") + "</b></div></div></div>" +
      '</aside><div style="min-width:0"><div class="toolbar"><span class="label" id="wCount"></span><span class="micro" style="margin-left:auto">Times in your time zone</span></div><div class="filings" id="wList"></div>' +
      '<div style="text-align:center;margin-top:26px"><button class="btn ghost" type="button" id="wMore">Load older filings</button></div></div></div></div></section>';
    departures($("#board"), { rows: 10 });
    function filtered() {
      var q = wireState.q.toLowerCase();
      return N.items.filter(function (i) {
        if (wireState.cat !== "all" && i.category !== wireState.cat) return false;
        if (wireState.country !== "all" && (i.countries || []).indexOf(wireState.country) < 0) return false;
        if (i.severity < wireState.sev) return false;
        if (q && (i.title + " " + i.source).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    }
    function draw() {
      var list = filtered(), newSet = freshIds;
      $("#wCount").textContent = list.length + " filing" + (list.length === 1 ? "" : "s");
      $("#wList").innerHTML = list.length ? list.slice(0, wireState.shown).map(function (it) { return filing(it, newSet[it.id]); }).join("") :
        '<div class="empty"><span class="pen">Nothing filed.</span>No filings match. Either the filters are too strict, or things are briefly fine. Check again in fifteen minutes.</div>';
      $("#wMore").hidden = list.length <= wireState.shown;
    }
    draw();
    $("#wq").addEventListener("input", function () { wireState.q = this.value; wireState.shown = 40; draw(); });
    $("#wc").addEventListener("change", function () { wireState.country = this.value; wireState.shown = 40; draw(); });
    $$("[data-cat]").forEach(function (b) { b.addEventListener("click", function () { wireState.cat = b.getAttribute("data-cat"); $$("[data-cat]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); wireState.shown = 40; draw(); }); });
    $$("[data-sev]").forEach(function (b) { b.addEventListener("click", function () { wireState.sev = +b.getAttribute("data-sev"); $$("[data-sev]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); draw(); }); });
    $("#wMore").addEventListener("click", function () { wireState.shown += 40; draw(); });
    wireRedraw = draw;
  };

  /* ---------------- index ---------------- */
  pages.index = function () {
    var s = EUI.score;
    var ranked = D.countries.filter(function (c) { return c.index && c.index.score != null; }).sort(function (a, b) { return b.index.score - a.index.score; });
    var movers = ranked.filter(function (c) { return c.index.prev != null; }).map(function (c) { return [c, c.index.score - c.index.prev]; }).sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); }).slice(0, 6);
    var compMoves = COMPONENTS.map(function (c) { var key = c[0] === "energy" ? "electricity" : c[0], v = EU.values[key]; return v ? { k: key, name: c[1], v: v } : null; }).filter(Boolean);
    app.innerHTML = phead({
      crumbs: '<a href="#/" data-route>Home</a><span>/</span><span>Index</span>',
      title: "The Europoor <i>Index</i>",
      intro: "How badly Europe's economy is doing, scored from 0 (suspiciously fine) to 100 (send help) from official statistics for " + D.countries.length + " countries: inflation, unemployment, growth, energy prices, government debt and purchasing power. Unlike the <a href=\"#/league\" data-route>Decline League</a>, which counts bad news, this measures the economy. A satirical composite, not an official statistic.",
      actions: '<button class="btn" type="button" id="shareIdx">' + I.share + " Share the index</button>",
      stamp: '<span class="stamp big stamp-abs">' + label(s) + "</span>"
    }) +
      '<section class="s-cotton page-body"><div class="wrap with-toc"><nav class="toc" aria-label="On this page"><span class="label">On this page</span><a href="#today" data-anchor="today">Europe today</a><a href="#history" data-anchor="history">History</a><a href="#countries" data-anchor="countries">Countries</a><a href="#moved" data-anchor="moved">What moved it</a><a href="#method" data-anchor="method">How it\'s made</a></nav><div class="stack">' +
      '<div class="frame rv" id="today"><div class="frame-h"><b>Europe today</b><span class="micro">' + refNo("today" + D.generated) + '</span></div><div class="frame-b">' +
      '<div class="rosette-grid"><div class="rosette rv" id="rosette"><canvas aria-hidden="true"></canvas><div class="rosette-center"><div><div class="n" data-count="' + s.toFixed(1) + '" data-dec="1">' + s.toFixed(1) + '</div><div class="micro">updated <span data-ago="' + esc(D.generated) + '">' + ago(D.generated) + "</span></div></div></div></div>" +
      '<div><p class="pushing">' + pushingText(EUI.components) + "</p>" + compList(EUI.components) + "</div></div>" +
      '</div><div class="frame-f micro">Badness out of 100. The tick on each bar marks 50, an ordinary figure for 2000–2019.</div></div>' +
      '<div class="chart-box rv" id="history"><div class="chart-art" aria-hidden="true"></div><div class="top"><h3>History, <i>yearly</i></h3><span class="micro">EU · shaded band: an ordinary year</span></div><div class="chart-scroll"><div id="histHost"></div></div>' +
      '<div class="cols-3" style="margin-top:22px">' + COMPONENTS.map(function (c) { var arr = (D.history.components || {})[c[0]] || []; return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid var(--line);padding-top:10px"><span class="label">' + c[1] + "</span>" + EP.spark(arr, { w: 110, h: 26, color: "var(--fg)" }) + "</div>"; }).join("") + "</div></div>" +
      '<div class="panel rv" id="countries"><div class="panel-h"><h3>Countries, <i>worst first</i></h3><span class="micro">Pooled 31-country baseline</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Country</th><th class="r">Index</th>' + COMPONENTS.map(function (c) { return '<th class="r">' + c[1] + "</th>"; }).join("") + "</tr></thead><tbody>" +
      '<tr class="eu-row"><td>–</td><td><span class="cn">' + flagOf("EU") + 'European Union</span></td><td class="r"><span class="score">' + s.toFixed(1) + "</span></td>" + COMPONENTS.map(function (c) { var v = EUI.components[c[0]]; return '<td class="r">' + (v != null ? v.toFixed(0) : "–") + "</td>"; }).join("") + "</tr>" +
      ranked.map(function (c, i) {
        return "<tr><td>" + (i + 1) + '</td><td><span class="cn">' + flagOf(c.code) + '<a href="#/data/' + c.slug + '" data-route>' + esc(c.name) + '</a></span></td><td class="r"><span class="score">' + c.index.score.toFixed(1) + "</span></td>" +
          COMPONENTS.map(function (k) { var v = c.index.components[k[0]]; return '<td class="r"><span class="heat" style="background:' + (v != null ? "rgba(" + EP.scoreRGB(v).join(",") + ",.4)" : "transparent") + '">' + (v != null ? v.toFixed(0) : "–") + "</span></td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div></div>" +
      '<div class="panel rv" id="moved"><div class="panel-h"><h3>What <i>moved</i> it</h3><span class="micro">Latest release vs the one before</span></div><div class="panel-b cols-2">' +
      '<div><span class="label">Europe\'s inputs</span><div class="moved" style="margin-top:10px">' + compMoves.map(function (x) { var d = x.v.prev != null && x.v.v != null ? x.v.v - x.v.prev : null; return "<div><span><b>" + x.name + '</b><br><span class="micro">' + esc(x.v.label || x.v.period || "") + "</span></span><span>" + fmtV(x.k, x.v.v) + '</span><span class="' + deltaCls(x.k, d) + '">' + (d == null ? "–" : arrow(x.k, d) + " " + fmtDelta(x.k, d)) + "</span></div>"; }).join("") + "</div></div>" +
      '<div><span class="label">Biggest country moves</span><div class="moved" style="margin-top:10px">' + movers.map(function (x) { var d = x[1]; return '<div><span style="display:flex;gap:8px;align-items:center;font-weight:700">' + flagOf(x[0].code) + esc(x[0].name) + "</span><span>" + x[0].index.score.toFixed(1) + '</span><span class="' + (d > 0 ? "delta-dn" : d < 0 ? "delta-up" : "") + '">' + (d > 0 ? "▲ +" : d < 0 ? "▼ −" : "▬ ") + Math.abs(d).toFixed(1) + "</span></div>"; }).join("") + "</div></div></div></div>" +
      '<div class="panel rv" id="method"><div class="panel-h"><h3>How it\'s <i>made</i></h3><span class="micro">Form DG-DECL/METHOD</span></div><div class="panel-b"><div class="prose">' +
      "<p>The index takes six measures from official statistics and asks, for each one, how bad this is compared with an ordinary year. An ordinary year is the average of 2000 to 2019, which includes a financial crisis and a euro crisis, so the bar is not high.</p>" +
      '<div class="formula">badness = clamp(0, 100, 50 + 15 × z)<br>z = (latest − average<sub>2000–2019</sub>) ÷ spread<sub>2000–2019</sub><br>index = mean of the six badness scores</div>' +
      "<p>A badness of 50 means the figure is exactly ordinary. 65 means one standard deviation worse than ordinary, and 80 means two. The sign is flipped where lower is worse, such as growth and purchasing power.</p>" +
      "<p>Europe as a whole is compared with its own history. Countries are compared with a pooled baseline across all " + D.countries.length + " countries, so a score of 70 means the same thing in Lisbon and in Oslo.</p>" +
      "<h3>The six inputs</h3><ul style=\"margin:0;padding-left:18px;display:grid;gap:6px\">" + ((D.method && D.method.notes) || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" +
      "<h3>What it is not</h3><p>It is not an official statistic, a forecast, or investment advice. It reads official statistics with the volume turned up. Every input links to the publishing office on the <a href=\"#/data\" data-route>data pages</a>.</p></div></div></div></div></div></section>";
    mountRosette($("#rosette"), EUI.components);
    historyChart($("#histHost"));
    $("#shareIdx").addEventListener("click", function () { share("The Europoor Index is at " + s.toFixed(1) + "/100 (" + label(s).toLowerCase() + ").", pageURL("index")); });
  };

  /* ---------------- data hub ---------------- */
  var dataState = { q: "", region: "all", cur: "all", mode: "latest", sort: null, dir: -1, pins: [] };
  try { dataState.pins = JSON.parse(localStorage.getItem("ep-pins") || "[]"); } catch (e) {}
  pages.data = function () {
    app.innerHTML = phead({
      crumbs: '<a href="#/" data-route>Home</a><span>/</span><span>Data</span>',
      title: "The <i>Data</i>",
      intro: "Official figures for the " + D.countries.length + " countries the site covers, as their statistics offices publish them. Every number shows its period and links to its source, and a figure stays missing until it is published. Sort, filter, pin countries side by side and take the lot away as a CSV.",
      actions: '<button class="btn" type="button" id="shareData">' + I.share + ' Share the data page</button><a class="btn ghost" href="#/index" data-route>The index it feeds</a>'
    }) +
      '<section class="s-cotton page-body"><div class="wrap">' +
      '<div class="toolbar rv"><label class="sr" for="dq">Find a country</label><input class="field" id="dq" type="search" placeholder="Find a country" value="' + esc(dataState.q) + '">' +
      '<label class="sr" for="dr">Region</label><select class="field" id="dr"><option value="all">All regions</option>' + REGIONS.map(function (r) { return '<option value="' + r + '"' + (dataState.region === r ? " selected" : "") + ">" + r + "</option>"; }).join("") + "</select>" +
      '<label class="sr" for="dcur">Currency</label><select class="field" id="dcur"><option value="all">Euro and other currencies</option><option value="euro"' + (dataState.cur === "euro" ? " selected" : "") + '>Euro only</option><option value="other"' + (dataState.cur === "other" ? " selected" : "") + ">Other currencies only</option></select>" +
      '<div class="seg" role="group" aria-label="Show">' + [["latest", "Latest"], ["y1", "Over 1 year"], ["y5", "Over 5 years"]].map(function (s) { return '<button type="button" data-mode="' + s[0] + '" aria-pressed="' + (dataState.mode === s[0]) + '">' + s[1] + "</button>"; }).join("") + "</div>" +
      '<button class="btn sm" type="button" id="csv">' + I.dl + " CSV</button></div>" +
      '<div class="tbl-wrap rv" style="max-height:76vh"><table class="tbl sticky" id="dtbl"></table></div>' +
      '<p class="micro" style="margin-top:14px;text-transform:none;letter-spacing:.02em">Cell colour: how bad the figure is relative to the other countries. Pin countries to keep them at the top. Click a heading to sort.</p></div></section>';
    function rows() {
      var q = dataState.q.toLowerCase();
      var list = D.countries.filter(function (c) {
        if (q && c.name.toLowerCase().indexOf(q) < 0 && c.code.toLowerCase() !== q) return false;
        if (dataState.region !== "all" && c.region !== dataState.region) return false;
        if (dataState.cur === "euro" && !c.euro) return false;
        if (dataState.cur === "other" && c.euro) return false;
        return true;
      });
      var val = function (c, k) { if (k === "name") return c.name; var v = c.values[k]; if (!v || v.v == null) return null; if (dataState.mode === "latest") return v.v; var b = v[dataState.mode]; return b == null ? null : v.v - b; };
      if (dataState.sort) list.sort(function (a, b) { var x = val(a, dataState.sort), y = val(b, dataState.sort); if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * dataState.dir; });
      else list.sort(function (a, b) { return a.name.localeCompare(b.name); });
      list.sort(function (a, b) { return (dataState.pins.indexOf(b.code) >= 0) - (dataState.pins.indexOf(a.code) >= 0); });
      return { list: list, val: val };
    }
    function heat(k, v) {
      if (v == null || dataState.mode !== "latest") return "transparent";
      var vals = D.countries.map(function (c) { return c.values[k] && c.values[k].v; }).filter(function (x) { return x != null; });
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), t = hi === lo ? .5 : (v - lo) / (hi - lo);
      if (M[k].worse === "lower") t = 1 - t;
      return "rgba(" + EP.scoreRGB(22 + t * 66).join(",") + ",.36)";
    }
    function draw() {
      var r = rows();
      var th = function (k, lab, right) { var sorted = dataState.sort === k ? (dataState.dir > 0 ? "ascending" : "descending") : "none"; return "<th" + (right ? ' class="r"' : "") + ' aria-sort="' + sorted + '"><button type="button" data-sort="' + k + '">' + lab + "</button></th>"; };
      var cell = function (c, k) {
        var v = c.values[k] || {}, show;
        if (dataState.mode === "latest") show = '<span class="heat" style="background:' + heat(k, v.v) + '">' + fmtV(k, v.v) + "</span>";
        else { var b = v[dataState.mode], d = v.v != null && b != null ? v.v - b : null; show = '<span class="' + deltaCls(k, d) + '">' + fmtDelta(k, d) + "</span>"; }
        return '<td class="r" title="' + esc(M[k].label + ", " + (v.label || v.period || "")) + '">' + show + "</td>";
      };
      $("#dtbl").innerHTML = "<thead><tr><th><span class=\"sr\">Pin</span></th>" + th("name", "Country") + D.measures.map(function (m) { return th(m.key, m.label, true); }).join("") + "</tr></thead><tbody>" +
        '<tr class="eu-row"><td></td><td><span class="cn">' + flagOf("EU") + "EU average</span></td>" + D.measures.map(function (m) { return cell(EU, m.key); }).join("") + "</tr>" +
        r.list.map(function (c) {
          var pinned = dataState.pins.indexOf(c.code) >= 0;
          return '<tr class="' + (pinned ? "pinned" : "") + '"><td><button class="pin" type="button" data-pin="' + c.code + '" aria-pressed="' + pinned + '" aria-label="Pin ' + esc(c.name) + '">' + I.pin + "</button></td>" +
            '<td><span class="cn">' + flagOf(c.code) + '<a href="#/data/' + c.slug + '" data-route>' + esc(c.name) + "</a></span></td>" + D.measures.map(function (m) { return cell(c, m.key); }).join("") + "</tr>";
        }).join("") + "</tbody>";
      $$("[data-sort]").forEach(function (b) { b.addEventListener("click", function () { var k = b.getAttribute("data-sort"); if (dataState.sort === k) dataState.dir *= -1; else { dataState.sort = k; dataState.dir = k === "name" ? 1 : -1; } draw(); }); });
      $$("[data-pin]").forEach(function (b) { b.addEventListener("click", function () { var k = b.getAttribute("data-pin"), i = dataState.pins.indexOf(k); if (i >= 0) dataState.pins.splice(i, 1); else dataState.pins.push(k); try { localStorage.setItem("ep-pins", JSON.stringify(dataState.pins)); } catch (e) {} draw(); }); });
    }
    draw();
    $("#dq").addEventListener("input", function () { dataState.q = this.value; draw(); });
    $("#dr").addEventListener("change", function () { dataState.region = this.value; draw(); });
    $("#dcur").addEventListener("change", function () { dataState.cur = this.value; draw(); });
    $$("[data-mode]").forEach(function (b) { b.addEventListener("click", function () { dataState.mode = b.getAttribute("data-mode"); $$("[data-mode]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); draw(); }); });
    $("#shareData").addEventListener("click", function () { share("Every European country against twelve official measures. Spoiler: not great.", pageURL("data")); });
    $("#csv").addEventListener("click", function () {
      var head = ["country", "code", "region", "currency"].concat(D.measures.map(function (m) { return m.key; })).concat(D.measures.map(function (m) { return m.key + "_period"; }));
      var csv = [head.join(",")].concat(rows().list.map(function (c) {
        return ['"' + c.name + '"', c.code, '"' + c.region + '"', c.currency].concat(D.measures.map(function (m) { var v = c.values[m.key]; return v && v.v != null ? v.v : ""; })).concat(D.measures.map(function (m) { var v = c.values[m.key]; return v ? v.period || "" : ""; })).join(",");
      })).join("\n");
      try { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "europoor-data.csv"; document.body.appendChild(a); a.click(); a.remove(); toast("CSV downloaded. It is also on your clipboard."); } catch (e) {}
      try { navigator.clipboard.writeText(csv).catch(function () {}); } catch (e) {}
    });
  };

  /* ---------------- country figures ---------------- */
  pages.dataCountry = function (slug) {
    var c = BY_SLUG[slug]; if (!c) return pages.notFound();
    var lg = LEAGUE[c.code];
    var changes = D.measures.map(function (m) { var v = c.values[m.key] || {}; var d = v.v != null && v.y1 != null ? v.v - v.y1 : null; return { m: m, v: v, d: d, w: worse(m.key, d) }; }).filter(function (x) { return x.d != null && x.d !== 0; });
    var worseList = changes.filter(function (x) { return x.w > 0; }), better = changes.filter(function (x) { return x.w < 0; });
    app.innerHTML = phead({
      crumbs: '<a href="#/data" data-route>Data</a><span>/</span><span>' + esc(c.name) + "</span>",
      title: flagOf(c.code) + esc(c.name),
      intro: esc(c.name) + "'s official figures, as published, against the EU average where there is one. " + esc(c.region) + " Europe, " + (c.euro ? "in the euro area" : "outside the euro, in " + esc(c.currency)) + ". " + (c.index ? "Its Europoor Index is <b>" + c.index.score.toFixed(1) + "</b>, " + ord(c.index.rank) + " worst of " + D.countries.length + ". " : "") + (lg ? 'It is <a href="#/country/' + c.slug + '" data-route>' + ord(lg.pos) + " in this week's Decline League</a>." : ""),
      actions: '<a class="btn" href="#/country/' + c.slug + '" data-route>Open the dossier ' + I.arr + '</a><button class="btn ghost" type="button" id="shareC">' + I.share + " Share</button>"
    }) +
      '<section class="s-cotton page-body"><div class="wrap with-toc"><nav class="toc"><span class="label">On this page</span><a href="#latest" data-anchor="latest">Latest figures</a><a href="#changed" data-anchor="changed">What changed</a><a href="#overtime" data-anchor="overtime">Over time</a></nav><div class="stack">' +
      '<div class="panel rv" id="latest"><div class="panel-h"><h3>Latest <i>figures</i></h3><span class="micro">' + refNo(c.code) + '</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Measure</th><th class="r">Latest</th><th>Period</th><th class="r">EU</th><th class="r">Over a year</th><th>Trend</th><th>Source</th></tr></thead><tbody>' +
      D.measures.map(function (m) {
        var v = c.values[m.key] || {}, e = EU.values[m.key] || {}, d = v.v != null && v.y1 != null ? v.v - v.y1 : null;
        var ser = c.series && c.series[m.key] ? c.series[m.key].map(function (p) { return p[1]; }) : null, vsEU = v.v != null && e.v != null ? worse(m.key, v.v - e.v) : 0;
        return '<tr><td class="wrap"><b>' + esc(m.label) + '</b><br><span class="micro" style="text-transform:none;letter-spacing:.01em">' + esc(m.desc || "") + '</span></td><td class="r"><span class="score ' + (vsEU > 0 ? "delta-dn" : "") + '">' + fmtV(m.key, v.v) + "</span></td><td>" + esc(v.label || v.period || "–") + '<br><span class="micro">' + esc(m.freq || "") + '</span></td><td class="r">' + fmtV(m.key, e.v) + "</td>" +
          '<td class="r ' + deltaCls(m.key, d) + '">' + (d == null ? "–" : arrow(m.key, d) + " " + fmtDelta(m.key, d)) + "</td><td>" + (ser ? EP.spark(ser, { w: 90, h: 24, color: "var(--fg)" }) : "") + "</td>" +
          '<td><a href="' + esc(v.src || m.url || "#") + '" target="_blank" rel="noopener">' + ((v.src || "").indexOf("eurostat") >= 0 || !v.src ? "Eurostat" : "National office") + " ↗</a></td></tr>";
      }).join("") + "</tbody></table></div></div>" +
      '<div class="panel rv" id="changed"><div class="panel-h"><h3>What <i>changed</i></h3><span class="micro">Latest vs a year earlier</span></div><div class="panel-b cols-2">' +
      '<div><span class="label" style="color:var(--bad)">Got worse · ' + worseList.length + '</span><div class="moved" style="margin-top:10px">' + (worseList.map(function (x) { return "<div><span>" + esc(x.m.label) + "</span><span>" + fmtV(x.m.key, x.v.v) + '</span><span class="delta-dn">' + fmtDelta(x.m.key, x.d) + "</span></div>"; }).join("") || '<p class="empty">Nothing. Suspicious.</p>') + "</div></div>" +
      '<div><span class="label" style="color:var(--good)">Got better · ' + better.length + '</span><div class="moved" style="margin-top:10px">' + (better.map(function (x) { return "<div><span>" + esc(x.m.label) + "</span><span>" + fmtV(x.m.key, x.v.v) + '</span><span class="delta-up">' + fmtDelta(x.m.key, x.d) + "</span></div>"; }).join("") || '<p class="empty">Nothing at all.</p>') + "</div></div></div></div>" +
      '<div class="panel rv" id="overtime"><div class="panel-h"><h3>Over <i>time</i></h3><span class="micro">Solid: ' + esc(c.name) + ' · dashed: EU</span></div><div class="panel-b cols-2">' +
      ["inflation", "unemployment", "growth", "debt"].map(function (k) { return '<div><span class="label">' + esc(M[k] ? M[k].label : k) + '</span><div data-chart="' + k + '" style="margin-top:8px"></div></div>'; }).join("") + "</div></div></div></div></section>";
    ["inflation", "unemployment", "growth", "debt"].forEach(function (k) {
      var host = $('[data-chart="' + k + '"]'), cs = (c.series || {})[k], es = (EU.series || {})[k];
      if (!cs || !cs.length) { host.innerHTML = '<p class="empty">No series published.</p>'; return; }
      var emap = {}; (es || []).forEach(function (p) { emap[p[0]] = p[1]; });
      EP.lineChart(host, { labels: cs.map(function (p) { return p[0]; }), height: 230, series: [{ values: cs.map(function (p) { return p[1]; }), name: c.name }, { values: cs.map(function (p) { return emap[p[0]] != null ? emap[p[0]] : null; }), cls: "eu", name: "EU" }], fmt: function (v) { return fmtV(k, v); }, label: M[k].label + ", " + c.name + " and EU" });
    });
    $("#shareC").addEventListener("click", function () { share((c.flag || "") + " " + c.name + ": Europoor Index " + (c.index ? c.index.score.toFixed(1) : "–") + "/100.", pageURL("data/" + c.slug)); });
  };

  /* ---------------- league ---------------- */
  var leagueWin = "7d";
  pages.league = function () {
    var upd = N.league && N.league.updated ? new Date(N.league.updated) : new Date();
    app.innerHTML = phead({
      crumbs: '<a href="#/" data-route>Home</a><span>/</span><span>League</span>',
      pre: '<div class="kicker"><span class="no">Matchday</span><span class="rule"></span><span class="micro">Week of ' + longDate(upd) + "</span></div>",
      title: "The Decline <i>League</i>",
      intro: "Points come from real filings on <a href=\"#/wire\" data-route>the wire</a>: weighted by severity, boosted by corroboration, and divided by each country's usual media coverage, so big countries don't top the table just for being in the news. Rolling 7 days, recalculated every 15 minutes.",
      actions: '<button class="btn" type="button" id="shareL">' + I.share + ' Share the matchday card</button><div class="seg" role="group" aria-label="Window">' + [["7d", "Last 7 days"], ["28d", "28 days"], ["season", "Season"]].map(function (w) { return '<button type="button" data-win="' + w[0] + '" aria-pressed="' + (leagueWin === w[0]) + '">' + w[1] + "</button>"; }).join("") + "</div>"
    }) +
      '<section class="s-paper2 page-body"><div class="wrap">' + podium(leagueRows) + '<div id="lt"></div>' +
      '<div class="zone-key micro"><span style="--k:var(--red)">Crisis zone: top four</span><span style="--k:var(--mint)">Suspiciously fine: bottom four</span><span>Form, oldest to newest. L = a bad week (a win, here), D = middling, W = quiet</span></div>' +
      '<div class="cols-2" style="margin-top:clamp(40px,6vw,70px)"><div class="panel rv"><div class="panel-h"><h3>The points <i>formula</i></h3></div><div class="panel-b prose">' +
      '<div class="formula">filing points = severity × (1 + 0.25 × extra sources)<br>score = Σ points ÷ √(usual weekly coverage) × 10</div>' +
      "<p>Severity runs 0–3. A story reported by five outlets is worth twice one reported by a single outlet. Usual coverage is the country's average weekly filings over five weeks, so Germany has to try harder than Malta.</p></div></div>" +
      '<div class="panel rv" style="--d:.1s"><div class="panel-h"><h3><i>Fixtures</i></h3></div><div class="panel-b prose"><p>There are no fixtures. Every country plays every week whether it likes it or not. Promotion and relegation are handled by the bond markets.</p><p>Every one of the ' + leagueRows.length + " countries has a dossier. Click a name.</p></div></div></div></div></section>";
    function draw() { $("#lt").innerHTML = leagueTable(leagueRows, { window: leagueWin, full: true }); $(".tbl-wrap", $("#lt")).classList.add("in"); }
    draw();
    $$("[data-win]").forEach(function (b) { b.addEventListener("click", function () { leagueWin = b.getAttribute("data-win"); $$("[data-win]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); draw(); }); });
    $("#shareL").addEventListener("click", function () {
      var t = "DECLINE LEAGUE, matchday " + longDate(upd) + "\n" + leagueRows.slice(0, 5).map(function (r) { return r.pos + ". " + (r.flag || "") + " " + r.name + " " + r.score.toFixed(1) + " " + (r.form || []).map(function (f) { return f === "L" ? "🟥" : f === "D" ? "⬜" : "▫️"; }).join(""); }).join("\n");
      share(t, pageURL("league"));
    });
  };

  /* ---------------- dossier ---------------- */
  pages.dossier = function (slug) {
    var c = BY_SLUG[slug]; if (!c) return pages.notFound();
    var lg = LEAGUE[c.code] || {}, leader = leagueRows[0];
    var files = N.items.filter(function (i) { return (i.countries || []).indexOf(c.code) >= 0; });
    var weeks = (lg.weekly || []).map(function (_, i, a) { var d = new Date(Date.now() - (a.length - 1 - i) * 7 * 864e5); return d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3); });
    var zoneStamp = lg.zone === "crisis" ? '<span class="stamp big stamp-abs">Crisis zone</span>' : lg.zone === "fine" ? '<span class="stamp big mint stamp-abs">Suspiciously fine</span>' : '<span class="stamp big gold stamp-abs">Under review</span>';
    app.innerHTML = phead({
      crumbs: '<a href="#/league" data-route>League</a><span>/</span><span>' + esc(c.name) + "</span>",
      pre: '<span class="file-tab">Dossier Nº ' + c.code + "-" + new Date().getFullYear() + "</span>",
      title: flagOf(c.code) + esc(c.name),
      intro: lg.pos ? "<b>" + ord(lg.pos) + "</b> of " + leagueRows.length + " in this week's Decline League, with <b>" + (lg.filings || 0) + "</b> filing" + (lg.filings === 1 ? "" : "s") + " in the last 7 days." + (c.index ? " Europoor Index " + c.index.score.toFixed(1) + ", " + ord(c.index.rank) + " worst." : "") : "No league position yet.",
      actions: '<a class="btn" href="#/data/' + c.slug + '" data-route>All figures ' + I.arr + '</a><button class="btn ghost" type="button" id="shareD">' + I.share + " Share dossier</button>",
      stamp: zoneStamp
    }) +
      '<section class="s-cotton page-body"><div class="wrap with-toc"><nav class="toc"><span class="label">On this page</span><a href="#week" data-anchor="week">This week</a><a href="#filings" data-anchor="filings">Filings</a><a href="#numbers" data-anchor="numbers">Numbers</a></nav><div class="stack">' +
      '<div class="panel rv" id="week"><div class="panel-h"><h3>This week in the <i>league</i></h3><a class="micro" href="#/league" data-route>Full table</a></div><div class="dossier-grid">' +
      '<div><span class="label">League position</span><div class="big">' + (lg.pos || "–") + "<sup>" + (lg.pos ? ord(lg.pos).replace(/\d+/, "") : "") + '</sup></div><p class="micro">of ' + leagueRows.length + " · movement " + mv(lg.movement) + "</p>" +
      '<span class="label" style="display:block;margin-top:20px">Points</span><div class="big" style="font-size:2.2rem">' + (lg.points != null ? lg.points.toFixed(1) : "0") + '</div><p class="micro">from ' + (lg.filings || 0) + " filings in 7 days</p></div>" +
      '<div><span class="label">Decline score</span><div class="big" data-count="' + (lg.score || 0).toFixed(1) + '" data-dec="1">' + (lg.score != null ? lg.score.toFixed(1) : "0") + '</div><p class="micro">Leader: ' + (leader ? esc(leader.name) + ", " + leader.score.toFixed(1) : "–") + "</p>" +
      '<span class="label" style="display:block;margin-top:20px">Form, last five weeks</span><div style="margin-top:10px">' + formHTML(lg.form) + "</div></div>" +
      '<div><span class="label">Decline score by week</span>' + (lg.weekly ? EP.weekly(lg.weekly, weeks) : '<p class="empty">No history.</p>') + "</div></div></div>" +
      '<div class="panel rv" id="filings"><div class="panel-h"><h3>Recent <i>filings</i></h3><span class="micro">' + files.length + ' on record</span></div><div class="panel-b" style="padding-block:0"><div class="filings">' +
      (files.length ? files.slice(0, 12).map(function (it) { return filing(it); }).join("") : '<div class="empty"><span class="pen">Quiet.</span>Nothing filed on ' + esc(c.name) + " lately. The Directorate is keeping an eye on it.</div>") + "</div></div></div>" +
      '<div class="panel rv" id="numbers"><div class="panel-h"><h3>The <i>numbers</i></h3><span class="micro">Europoor Index ' + (c.index ? c.index.score.toFixed(1) + " · " + ord(c.index.rank) + " worst" : "") + '</span></div><div class="panel-b cols-2">' +
      "<div>" + (c.index ? '<p class="pushing">' + pushingText(c.index.components) + "</p>" + compList(c.index.components) : "") + "</div>" +
      '<div class="kpis" style="align-self:start">' + ["inflation", "unemployment", "growth", "debt"].map(function (k) { var v = c.values[k] || {}, e = EU.values[k] || {}; return '<div class="kpi"><span class="label">' + esc(M[k].label) + '</span><div class="v">' + fmtV(k, v.v) + "</div><p>EU " + fmtV(k, e.v) + " · " + esc(v.label || v.period || "") + "</p></div>"; }).join("") + "</div></div></div></div></div></section>";
    $("#shareD").addEventListener("click", function () { share((c.flag || "") + " " + c.name + " is " + (lg.pos ? ord(lg.pos) : "unranked") + " in the Decline League this week.", pageURL("country/" + c.slug)); });
  };

  /* ---------------- map ---------------- */
  pages.map = function () {
    var cref = { m: "index" };
    app.innerHTML = phead({ crumbs: '<a href="#/" data-route>Home</a><span>/</span><span>Map</span>', title: "Small <i>change</i>", intro: "Thirty-one countries, minted by how badly they are doing: gold, silver, bronze, copper, rust. Hover a coin to flip it, click for the dossier, or re-mint the lot by a single measure." }) +
      '<section class="s-ultra page-body"><div class="wrap">' + coinsSection(cref) + "</div></section>";
    wireCoins(app, cref);
  };

  /* ---------------- play ---------------- */
  pages.play = function (game) { EP.Games.render(app, game, { data: D, news: N, toast: toast, copy: copy, phead: phead, icons: I }); };

  pages.notFound = function () {
    app.innerHTML = phead({ title: "This page has been <i>cut.</i>", intro: 'Like the budget for it. Try the <a href="#/" data-route>front page</a>.', stamp: '<span class="stamp big stamp-abs">Not found</span>' });
  };

  /* ======================================================================
     router
     ====================================================================== */
  var TITLES = { home: "<i>/</i>home", wire: "<i>/</i>wire", index: "<i>/</i>index", data: "<i>/</i>data", league: "<i>/</i>league", country: "<i>/</i>dossier", map: "<i>/</i>map", play: "<i>/</i>play" };
  function parse() { return (location.hash || "").replace(/^#\/?/, "").split("/").filter(Boolean); }
  function render(anchor) {
    cancelAnimationFrame(meterRAF); clearInterval(boardTimer); clearInterval(clockTimer);
    if (heroRing) { heroRing.destroy(); heroRing = null; }
    wireRedraw = null; boardRestart = null;
    var p = parse(), name = p[0] || "home";
    if (!/^(wire|index|data|league|country|map|play)$/.test(name)) { if (p[0] && document.getElementById(p[0])) return; name = p[0] ? "nf" : "home"; }
    if (name === "home") pages.home();
    else if (name === "wire") pages.wire();
    else if (name === "index") pages.index();
    else if (name === "data" && p[1]) pages.dataCountry(p[1]);
    else if (name === "data") pages.data();
    else if (name === "league") pages.league();
    else if (name === "country" && p[1]) pages.dossier(p[1]);
    else if (name === "map") pages.map();
    else if (name === "play") pages.play(p[1]);
    else pages.notFound();
    $$("[data-nav]").forEach(function (a) { a.setAttribute("aria-current", a.getAttribute("data-nav") === (name === "country" ? "league" : name) ? "page" : "false"); });
    var tt = { home: "EUROPOOR", wire: "The Wire · EUROPOOR", index: "The Europoor Index · EUROPOOR", data: "Data · EUROPOOR", league: "The Decline League · EUROPOOR", country: "Dossier · EUROPOOR", map: "Small change · EUROPOOR", play: "Play · EUROPOOR" };
    document.title = tt[name] || "EUROPOOR";
    bindGuilloche(app); growBars(app); EP.reveal(app);
    if (anchor) { var t = document.getElementById(anchor); if (t) { window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 90); return; } }
    window.scrollTo(0, 0);
  }
  function go(href, anchor) {
    var name = (href.replace(/^#\/?/, "").split("/")[0]) || "home";
    EP.closeMenu && EP.closeMenu();
    EP.shred(TITLES[name] || "", function () {
      try { history.pushState(null, "", href); } catch (err) { location.hash = href; return; }
      render(anchor);
    });
  }
  window.addEventListener("popstate", function () { render(); });
  window.addEventListener("hashchange", function () { render(); });
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-anchor]");
    if (a && !a.hasAttribute("data-route")) {
      e.preventDefault();
      var t = document.getElementById(a.getAttribute("data-anchor"));
      if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 90, behavior: "smooth" });
      return;
    }
    var r = e.target.closest && e.target.closest("a[data-route]");
    if (r && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); go(r.getAttribute("href"), r.getAttribute("data-anchor")); }
  });
  EP.go = go;
  render();
})();
