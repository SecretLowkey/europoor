/* EUROPOOR — recreation department.
   Three daily games. Same puzzle for everyone each UTC day; streaks and
   achievements live in this browser only. */
(function () {
  "use strict";
  var EP = (window.EP = window.EP || {});
  var KEY = "ep-games-v1";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var GAMES = {
    poorer: { id: "poorer", title: "Poorer or Richer?", art: "A&nbsp;/&nbsp;B", blurb: "Two countries, one statistic. Pick the one doing worse. Ten rounds, real figures.", rounds: 10 },
    europoordle: { id: "europoordle", title: "Europoordle", art: "? ? ?", blurb: "Guess today's country from its statistics. Every wrong guess reveals another clue. Six tries.", rounds: 6 },
    "real-or-satire": { id: "real-or-satire", title: "Real or Satire?", art: "REAL?", blurb: "Eight headlines. Some are real news. Some we made up. It is harder than it should be.", rounds: 8 }
  };

  /* ---------- the date, for everyone ---------- */
  function today() { return new Date().toISOString().slice(0, 10); }
  function puzzleNo() { return Math.floor((Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - Date.UTC(2026, 0, 1)) / 864e5) + 1; }
  function untilMidnight() {
    var n = new Date(), m = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n.getTime();
    var h = Math.floor(m / 3600e3), mi = Math.floor((m % 3600e3) / 60e3);
    return h + " h " + mi + " min";
  }
  function yesterday(d) { var t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); }

  /* ---------- storage ---------- */
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && s.games) return s; } catch (e) {}
    return { games: {}, ach: {}, total: 0 };
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function gstate(s, id) { return (s.games[id] = s.games[id] || { played: 0, streak: 0, best: 0, last: null, results: {} }); }
  function record(id, result) {
    var s = load(), g = gstate(s, id), d = today();
    if (g.results[d]) return s;
    g.results[d] = result;
    g.played++; s.total = (s.total || 0) + 1;
    g.streak = g.last === yesterday(d) ? g.streak + 1 : 1;
    g.best = Math.max(g.best, g.streak); g.last = d;
    // keep the archive small
    var keys = Object.keys(g.results).sort(); while (keys.length > 60) delete g.results[keys.shift()];
    checkAch(s, id, result);
    save(s);
    return s;
  }

  var ACH = [
    ["first", "📎", "First filing", "Finish any game."],
    ["perfect", "📉", "Perfect austerity", "Score 10/10 in Poorer or Richer."],
    ["triple", "🗂️", "Bean counter", "Play all three games in one day."],
    ["streak3", "🔥", "Streak of decline", "A 3-day streak in any game."],
    ["streak7", "📆", "Fiscal year", "A 7-day streak in any game."],
    ["eurocrat", "🏛️", "Eurocrat", "Solve Europoordle in two guesses or fewer."],
    ["checker", "🔍", "Fact-checker", "Get 8/8 in Real or Satire."],
    ["gullible", "🤡", "Gullible", "Call three satire headlines real in one game."],
    ["insider", "🪪", "Brussels insider", "Finish 10 games."],
    ["lifer", "⛓️", "Long-term unemployed", "Finish 30 games."]
  ];
  var newAch = [];
  function grant(s, k) { if (!s.ach[k]) { s.ach[k] = today(); newAch.push(k); } }
  function checkAch(s, id, r) {
    grant(s, "first");
    if (id === "poorer" && r.score === 10) grant(s, "perfect");
    if (id === "europoordle" && r.won && r.tries <= 2) grant(s, "eurocrat");
    if (id === "real-or-satire" && r.score === 8) grant(s, "checker");
    if (id === "real-or-satire" && r.fooled >= 3) grant(s, "gullible");
    var d = today();
    if (["poorer", "europoordle", "real-or-satire"].every(function (g) { return s.games[g] && s.games[g].results[d]; })) grant(s, "triple");
    Object.keys(s.games).forEach(function (g) { if (s.games[g].streak >= 3) grant(s, "streak3"); if (s.games[g].streak >= 7) grant(s, "streak7"); });
    if (s.total >= 10) grant(s, "insider");
    if (s.total >= 30) grant(s, "lifer");
  }

  /* ---------- the scratch cards on the home page and hub ---------- */
  EP.Games = {};
  var CARD_TITLES = { poorer: "Poorer <i>or</i> Richer?", europoordle: "Euro<i>poordle</i>", "real-or-satire": "Real <i>or</i> Satire?" };
  var PRIZES = { poorer: "Top prize: being right about bad news", europoordle: "Top prize: a working knowledge of Latvia", "real-or-satire": "Top prize: trust issues" };
  EP.Games.cards = function () {
    var s = load(), d = today();
    return '<div class="cards">' + Object.keys(GAMES).map(function (k, i) {
      var g = GAMES[k], st = s.games[k] || {}, done = st.results && st.results[d];
      return '<div class="card c' + (i + 1) + ' rv" style="--d:' + (i * .1) + 's"><div class="top"><span>Game ' + (i + 1) + " of 3</span><span>Nº " + String(puzzleNo()).padStart(4, "0") + "</span></div>" +
        "<h3>" + CARD_TITLES[k] + "</h3><p>" + g.blurb + "</p>" +
        '<div class="scratch"><div class="under"><b>' + (done ? "Played ✓" : "You can play!") + "</b><span>" + PRIZES[k] + '</span></div><canvas data-scratch="' + k + '" aria-hidden="true"' + (done ? ' class="gone"' : "") + "></canvas></div>" +
        '<div class="card-foot"><span class="micro" style="color:rgba(255,255,255,.8)">Streak ' + (st.streak || 0) + " · best " + (st.best || 0) + '</span><a class="btn sm" href="#/play/' + k + '" data-route>' + (done ? "See result" : "Play today") + "</a></div></div>";
    }).join("") + "</div>";
  };
  EP.Games.bindCards = function (scope) {
    $$("canvas[data-scratch]", scope).forEach(function (c) {
      if (c.classList.contains("gone")) return;
      EP.scratch(c, function () { var a = c.closest(".card").querySelector(".btn"); if (a) a.focus({ preventScroll: true }); });
    });
  };

  EP.Games.render = function (root, id, ctx) {
    newAch = [];
    if (!id || !GAMES[id]) return hub(root, ctx);
    var g = GAMES[id];
    root.innerHTML = ctx.phead({ crumbs: '<a href="#/play" data-route>Play</a><span>/</span><span>' + g.title + "</span>", title: CARD_TITLES[id], intro: g.blurb }) +
      '<section class="s-cotton page-body"><div class="wrap"><div class="game-shell"><div class="game-card rv"><div class="game-top"><span>Nº ' + String(puzzleNo()).padStart(4, "0") + " · " + today() + '</span><span class="progress-pips" id="pips"></span><span id="gscore"></span></div><div class="game-body" id="gbody"></div></div></div></div></section>';
    var s = load(), st = s.games[id], done = st && st.results && st.results[today()];
    var body = $("#gbody");
    if (done) return finished(body, id, done, ctx, true);
    PLAY[id](body, ctx, EP.rng(EP.hash(id + today())), false);
  };

  function hub(root, ctx) {
    var s = load();
    var totalStreak = Object.keys(GAMES).reduce(function (a, k) { return Math.max(a, (s.games[k] || {}).streak || 0); }, 0);
    var best = Object.keys(GAMES).reduce(function (a, k) { return Math.max(a, (s.games[k] || {}).best || 0); }, 0);
    root.innerHTML = ctx.phead({ crumbs: '<a href="#/" data-route>Home</a><span>/</span><span>Play</span>', title: "Three daily <i>games</i>", intro: "The same puzzles for everyone, every day, with streaks, a share grid and achievements kept on your device. Scratch a card to play. New puzzles at midnight UTC, in " + untilMidnight() + "." }) +
      '<section class="s-cotton page-body"><div class="wrap" style="display:grid;gap:clamp(30px,4vw,50px)">' + EP.Games.cards() +
      '<div class="cols-2"><div class="panel rv"><div class="panel-h"><h3>Your <i>record</i></h3><span class="micro">Kept on this device</span></div><div class="panel-b"><div class="streaks">' +
      "<div><b>" + (s.total || 0) + "</b><span>Games played</span></div><div><b>" + totalStreak + "</b><span>Current streak</span></div><div><b>" + best + "</b><span>Best streak</span></div><div><b>" + Object.keys(s.ach || {}).length + "/" + ACH.length + "</b><span>Achievements</span></div></div></div></div>" +
      '<div class="panel rv"><div class="panel-h"><h3>Rules of the <i>house</i></h3></div><div class="panel-b prose"><p>All figures are real and come from the <a href="#/data" data-route>data pages</a>. All real headlines come from <a href="#/wire" data-route>the wire</a> and link to their source once you answer. The fake ones are labelled once you answer, and we are not proud of how plausible they are.</p></div></div></div>' +
      '<div class="panel rv"><div class="panel-h"><h3><i>Achievements</i></h3></div><div class="panel-b"><div class="achievements">' +
      ACH.map(function (a) { var got = s.ach && s.ach[a[0]]; return '<div class="ach' + (got ? " got" : "") + '"><span class="medal">' + a[1] + "</span><b>" + a[2] + "</b><span>" + a[3] + "</span>" + (got ? '<span class="micro">Earned ' + got + "</span>" : "") + "</div>"; }).join("") +
      "</div></div></div></div></section>";
    EP.Games.bindCards(root);
  }

  function pips(n, res, cur) {
    $("#pips").innerHTML = Array.from({ length: n }, function (_, i) { return "<i class=\"" + (res[i] === true ? "ok" : res[i] === false ? "no" : i === cur ? "cur" : "") + '"></i>'; }).join("");
  }

  function finished(body, id, r, ctx, already, practice) {
    var g = GAMES[id], s = load(), st = s.games[id] || {};
    var text = g.title.toUpperCase() + " Nº " + puzzleNo() + " — " + r.summary + "\n" + r.grid + "\nEUROPOOR";
    pips(r.marks.length, r.marks, -1);
    $("#gscore").textContent = r.summary;
    body.innerHTML = '<div class="result">' +
      '<span class="stamp big stamp-in ' + (r.good ? "blue" : "") + '">' + esc(r.verdict) + "</span>" +
      '<p class="q">' + esc(r.summary) + "<small>" + (practice ? "Practice round. It does not count, like most promises." : already ? "You have already filed today's puzzle. The next one opens in " + untilMidnight() + "." : "Filed. The next puzzle opens in " + untilMidnight() + ".") + "</small></p>" +
      '<div class="share-grid" aria-label="Your result grid">' + r.grid + "</div>" +
      '<label class="sr" for="shareTxt">Share text</label><textarea class="share-text" id="shareTxt" rows="3" readonly>' + esc(text) + "</textarea>" +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><button class="btn" type="button" id="copyRes">Copy result</button>' +
      '<a class="btn ghost" href="https://x.com/intent/post?text=' + encodeURIComponent(text + "\n") + '" target="_blank" rel="noopener">Post on X</a>' +
      '<button class="btn ghost" type="button" id="practice">Practice round</button></div>' +
      (practice ? "" : '<div class="streaks" style="width:100%;margin-top:6px"><div><b>' + (st.played || 0) + "</b><span>Played</span></div><div><b>" + (st.streak || 0) + "</b><span>Streak</span></div><div><b>" + (st.best || 0) + "</b><span>Best</span></div><div><b>" + Object.keys(s.ach || {}).length + "</b><span>Achievements</span></div></div>") +
      (newAch.length ? '<div class="achievements" style="width:100%">' + newAch.map(function (k) { var a = ACH.filter(function (x) { return x[0] === k; })[0]; return '<div class="ach got"><span class="medal">' + a[1] + "</span><b>New: " + a[2] + "</b><span>" + a[3] + "</span></div>"; }).join("") + "</div>" : "") +
      (r.extra || "") + "</div>";
    $("#copyRes").addEventListener("click", function () { ctx.copy(text); });
    $("#practice").addEventListener("click", function () { newAch = []; PLAY[id](body, ctx, EP.rng((Math.random() * 1e9) | 0), true); });
  }

  function done(body, id, ctx, r, practice) {
    if (!practice) record(id, r);
    finished(body, id, r, ctx, false, practice);
  }

  /* ======================================================================
     1. Poorer or Richer?
     ====================================================================== */
  var ASK = {
    inflation: "Which has higher inflation?", food_inflation: "Where are food prices rising faster?", unemployment: "Which has higher unemployment?",
    youth_unemployment: "Where is youth unemployment worse?", growth: "Which economy is growing more slowly?", debt: "Which government owes more, relative to its economy?",
    deficit: "Which runs the bigger budget deficit?", electricity: "Where is household electricity pricier?", gas: "Where is household gas pricier?",
    housing: "Where are house prices rising faster?", purchasing_power: "Where do people have less purchasing power?", industry: "Where is industry doing worse?"
  };
  var PLAY = {};
  PLAY.poorer = function (body, ctx, rnd, practice) {
    var D = ctx.data, keys = D.measures.map(function (m) { return m.key; }).filter(function (k) { return ASK[k]; });
    var M = {}; D.measures.forEach(function (m) { M[m.key] = m; });
    var rounds = [];
    var guard = 0;
    while (rounds.length < 10 && guard++ < 500) {
      var k = keys[Math.floor(rnd() * keys.length)];
      var pool = D.countries.filter(function (c) { return c.values[k] && c.values[k].v != null; });
      if (pool.length < 2) continue;
      var a = pool[Math.floor(rnd() * pool.length)], b = pool[Math.floor(rnd() * pool.length)];
      if (a === b || a.values[k].v === b.values[k].v) continue;
      if (rounds.some(function (r) { return r.k === k && (r.a === a || r.b === a); })) continue;
      rounds.push({ k: k, a: a, b: b });
    }
    var i = 0, res = [];
    function fmt(k, v) {
      var m = M[k]; if (m.unit === "€/kWh") return "€" + v.toFixed(3); if (m.unit === "EU=100") return v.toFixed(0);
      return String(v.toFixed(m.decimals != null ? m.decimals : 1)).replace(/^-/, "−") + (m.unit.indexOf("%") === 0 ? "%" : "");
    }
    function show() {
      pips(10, res, i);
      $("#gscore").textContent = res.filter(Boolean).length + " / " + res.length;
      var r = rounds[i], m = M[r.k];
      body.innerHTML = '<p class="q">' + ASK[r.k] + "<small>" + esc(m.label) + " · " + esc(m.desc || "") + "</small></p>" +
        '<div class="versus">' + [r.a, r.b].map(function (c, j) { return '<button class="vs-card" type="button" data-j="' + j + '"><span class="fl">' + EP.flag(c.code) + '</span><span class="nm">' + esc(c.name) + '</span><span class="val"></span></button>' + (j === 0 ? '<span class="vs-mid">vs</span>' : ""); }).join("") + "</div>" +
        '<div class="feedback" id="fb"></div>';
      $$(".vs-card", body).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var j = +btn.getAttribute("data-j"), va = r.a.values[r.k].v, vb = r.b.values[r.k].v;
          var worseIdx = (m.worse === "lower" ? va < vb : va > vb) ? 0 : 1, ok = j === worseIdx;
          res.push(ok);
          $$(".vs-card", body).forEach(function (x, xi) { x.disabled = true; $(".val", x).textContent = fmt(r.k, xi === 0 ? va : vb); x.classList.add(xi === worseIdx ? "right" : "wrong"); });
          var per = (r.a.values[r.k].label || r.a.values[r.k].period || "");
          $("#fb").innerHTML = '<span class="pen">' + (ok ? ["Correct. Sadly.", "Right. Condolences.", "Yes. That's the bad one.", "Correct, and grim."][res.length % 4] : ["No. It's worse than you think.", "Wrong. Optimist.", "Nope. Check the receipts."][res.length % 3]) + '</span><br><span class="micro">Latest official figures · ' + esc(per) + "</span>";
          pips(10, res, -1);
          setTimeout(function () {
            i++;
            if (i < rounds.length) show();
            else {
              var score = res.filter(Boolean).length;
              done(body, "poorer", ctx, {
                score: score, marks: res, summary: score + "/10",
                grid: res.map(function (x) { return x ? "🟦" : "🟥"; }).join(""),
                verdict: score >= 9 ? "Chief economist" : score >= 7 ? "Senior analyst" : score >= 5 ? "Intern" : "Optimist",
                good: score >= 7
              }, practice);
            }
          }, 1400);
        });
      });
    }
    show();
  };

  /* ======================================================================
     2. Europoordle
     ====================================================================== */
  var POS = { IS: [0, 0], NO: [5, 0], SE: [6, 0], FI: [7, 0], IE: [1, 1], GB: [2, 1], DK: [5, 1], EE: [7, 1], NL: [3, 2], DE: [4, 2], PL: [5, 2], LT: [6, 2], LV: [7, 2], BE: [2, 3], LU: [3, 3], CZ: [4, 3], SK: [5, 3], FR: [2, 4], CH: [3, 4], AT: [4, 4], HU: [5, 4], RO: [6, 4], PT: [1, 5], ES: [2, 5], IT: [3, 5], SI: [4, 5], HR: [5, 5], BG: [6, 5], MT: [3, 6], GR: [6, 6], CY: [7, 6] };
  var ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
  PLAY.europoordle = function (body, ctx, rnd, practice) {
    var D = ctx.data, M = {}; D.measures.forEach(function (m) { M[m.key] = m; });
    var target = D.countries[Math.floor(rnd() * D.countries.length)];
    var clueKeys = ["inflation", "unemployment", "debt", "growth", "purchasing_power", "electricity"].filter(function (k) { return M[k]; });
    var clues = clueKeys.map(function (k) { var v = target.values[k] || {}; return { k: M[k].label, v: v.v == null ? "not published" : fmt(k, v.v) + "  (" + (v.label || v.period || "") + ")" }; });
    clues.push({ k: "Region & money", v: target.region + " · " + (target.euro ? "uses the euro" : "uses its own currency") });
    function fmt(k, v) { var m = M[k]; if (m.unit === "€/kWh") return "€" + v.toFixed(3) + "/kWh"; if (m.unit === "EU=100") return v.toFixed(0) + " (EU = 100)"; return String(v.toFixed(1)).replace(/^-/, "−") + (m.unit.indexOf("%") === 0 ? "%" : "") + (m.unit === "% of GDP" ? " of GDP" : ""); }
    var guesses = [], res = [], over = false;
    function shown() { return Math.min(clues.length, guesses.length + 2); }
    function draw() {
      pips(6, res, over ? -1 : guesses.length);
      $("#gscore").textContent = "Guess " + Math.min(6, guesses.length + 1) + " of 6";
      body.innerHTML = '<p class="q">Which country is this?<small>' + (6 - guesses.length) + " guesses left. Wrong guesses reveal another clue and point you towards the answer.</small></p>" +
        '<div class="clues">' + clues.map(function (c, i) { var open = i < shown() || over; return '<div class="clue' + (open ? "" : " locked") + '"><span class="k">' + esc(c.k) + '</span><span class="v">' + (open ? esc(c.v) : "Locked · guess to reveal") + "</span></div>"; }).join("") + "</div>" +
        '<div class="guesses">' + guesses.map(function (g) {
          var c = g.c, ok = c === target, d = g.dist;
          return '<span class="chip' + (ok ? " solid" : "") + '" style="font-size:.78rem;padding:6px 8px">' + EP.flag(c.code) + " " + esc(c.name) + (ok ? " ✓" : " · " + d.n + " sq " + d.arrow) + "</span>";
        }).join("") + "</div>" +
        (over ? "" : '<form class="guess-row" id="gform"><label class="sr" for="gsel">Your guess</label><select class="field" id="gsel" required><option value="">Pick a country…</option>' +
          D.countries.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).filter(function (c) { return !guesses.some(function (g) { return g.c === c; }); })
            .map(function (c) { return '<option value="' + c.code + '">' + esc(c.name) + "</option>"; }).join("") +
          '</select><button class="btn" type="submit">Guess</button></form>');
      var f = $("#gform");
      if (f) f.addEventListener("submit", function (e) {
        e.preventDefault();
        var code = $("#gsel").value; if (!code) return;
        var c = D.countries.filter(function (x) { return x.code === code; })[0];
        var a = POS[c.code] || [0, 0], b = POS[target.code] || [0, 0], dx = b[0] - a[0], dy = b[1] - a[1];
        var n = Math.max(Math.abs(dx), Math.abs(dy)), ang = Math.atan2(dy, dx), oct = Math.round(ang / (Math.PI / 4));
        guesses.push({ c: c, dist: { n: n, arrow: ARROWS[(oct + 8) % 8] } });
        var ok = c === target; res.push(ok);
        if (ok || guesses.length >= 6) {
          over = true; draw();
          setTimeout(function () {
            done(body, "europoordle", ctx, {
              won: ok, tries: guesses.length, marks: res, good: ok,
              summary: ok ? guesses.length + "/6" : "X/6",
              grid: res.map(function (x) { return x ? "🟦" : "🟥"; }).join("") + (ok ? "" : " 🏳️"),
              verdict: ok ? (guesses.length <= 2 ? "Eurocrat" : guesses.length <= 4 ? "Diplomat" : "Tourist") : "Lost in Brussels",
              extra: '<p style="color:var(--muted)">It was <b>' + EP.flag(target.code) + " " + esc(target.name) + '</b>. <a href="#/country/' + target.slug + '" data-route>Read its dossier</a>.</p>'
            }, practice);
          }, 900);
        } else draw();
      });
    }
    draw();
  };

  /* ======================================================================
     3. Real or Satire?
     The fakes below are invented by the Directorate and are revealed as such
     the moment you answer.
     ====================================================================== */
  var FAKES = [
    "Finance ministers agree to define 'growth' as anything above minus one per cent",
    "Germany launches commission to investigate why its other commission has not reported",
    "France unveils budget plan that relies on 'a very good summer'",
    "ECB confirms inflation target remains 2%, 'spiritually'",
    "Belgian coalition talks enter third season; streaming rights sold to Netflix",
    "Italy issues 100-year bond, asks investors not to check back",
    "EU announces strategic plan to publish a strategic plan on competitiveness",
    "Dutch households advised to heat homes by 'thinking warm thoughts'",
    "Eurostat revises GDP figure upward after finding €4bn behind a sofa in Luxembourg",
    "Spanish government declares siesta a productivity measure, raises growth forecast",
    "Brussels sets up working group to work out why nobody is working",
    "Austrian central bank replaces forecasts with a coin it flips 'very carefully'",
    "Portugal reports record tourism as residents move to tents to rent out flats",
    "Swedish krona falls so far it is now classed as a 'flat-pack currency'",
    "Commission proposes 28th regulation on bottle caps to boost the economy",
    "Finnish economy shrinks; government blames 'unusually long winter, again'",
    "Poland overtakes Germany in industrial output, Germany asks for a recount",
    "UK Treasury discovers new fiscal rule that it had already broken",
    "Irish budget surplus so large ministers 'afraid to look directly at it'",
    "Greek debt officially reclassified as a heritage site",
    "Euro area agrees to meet again to agree on when to meet again",
    "Swiss franc so strong that Swiss now book holidays in their own kitchens",
    "Bundestag passes debt brake on the debt brake",
    "Hungary's inflation reaches level where shops price items 'by vibe'",
    "European car makers pivot to making excuses, report record output",
    "Frankfurt banks report stable profits; nobody else reports anything stable",
    "EU leaders hail 'historic' summit after agreeing on the lunch menu",
    "Czech brewery becomes country's largest employer after factory closures",
    "Pension age raised to 'whenever you can no longer find the office'",
    "Latvian minister: 'we are not in recession, we are in a pre-growth phase'",
    "Danish pharma firm now accounts for 140% of national growth, economists say",
    "French prime minister survives confidence vote by not attending it",
    "Norway's oil fund buys a small EU member state 'as a long-term hold'",
    "Luxembourg admits it is mostly a postbox with a flag",
    "Eurozone factories report new orders for 'thoughts and prayers'",
    "Romanian deficit so large it has applied for its own EU membership",
    "Croatian tourism board markets 'authentic austerity experience' to Germans",
    "Bulgaria joins euro, immediately asks if it can have the lev back for weekends"
  ];
  PLAY["real-or-satire"] = function (body, ctx, rnd, practice) {
    var real = ctx.news.items.filter(function (i) { return i.severity >= 1 && i.title.length > 30 && i.title.length < 140; });
    // pick from the most recent 120, stably by id so everyone gets the same set for the day
    real = real.slice(0, 120).sort(function (a, b) { return EP.hash(a.id + today()) - EP.hash(b.id + today()); });
    var fakes = FAKES.slice().sort(function () { return rnd() - 0.5; });
    var deck = [];
    var nReal = Math.min(4, real.length);
    for (var i = 0; i < nReal; i++) deck.push({ real: true, title: real[i].title, source: real[i].source, url: real[i].url, when: real[i].published });
    for (var j = 0; deck.length < 8; j++) deck.push({ real: false, title: fakes[j] });
    deck.sort(function () { return rnd() - 0.5; });
    var k = 0, res = [], fooled = 0;
    function show() {
      pips(8, res, k);
      $("#gscore").textContent = res.filter(Boolean).length + " / " + res.length;
      var h = deck[k];
      body.innerHTML = '<p class="q">Real news, or did we make it up?<small>Headline ' + (k + 1) + " of 8</small></p>" +
        '<div class="headline-card"><h3>“' + esc(h.title) + '”</h3><p class="src" id="hsrc">Source withheld until you answer</p></div>' +
        '<div class="choice-row"><button class="btn" type="button" data-a="real">Real news</button><button class="btn ghost" type="button" data-a="fake">Satire</button></div><div class="feedback" id="fb"></div>';
      $$("[data-a]", body).forEach(function (b) {
        b.addEventListener("click", function () {
          var said = b.getAttribute("data-a") === "real", ok = said === h.real;
          if (said && !h.real) fooled++;
          res.push(ok);
          $$("[data-a]", body).forEach(function (x) { x.disabled = true; });
          var card = $(".headline-card", body);
          card.insertAdjacentHTML("beforeend", '<span class="stamp stamp-in ' + (h.real ? "blue" : "") + '">' + (h.real ? "Real" : "Satire") + "</span>");
          $("#hsrc").innerHTML = h.real ? '<a href="' + esc(h.url) + '" target="_blank" rel="noopener">' + esc(h.source) + " ↗</a>" : "Invented by the Directorate. For now.";
          $("#fb").innerHTML = '<span class="pen">' + (ok ? (h.real ? "Correct. It really happened." : "Correct. That one's ours.") : (h.real ? "That one is real. We checked." : "Made up. Give it a month.")) + "</span>";
          pips(8, res, -1);
          var next = document.createElement("button");
          next.className = "btn ghost"; next.type = "button"; next.textContent = k < 7 ? "Next headline" : "See result";
          next.style.justifySelf = "center";
          next.addEventListener("click", function () {
            k++;
            if (k < 8) show();
            else {
              var score = res.filter(Boolean).length;
              done(body, "real-or-satire", ctx, {
                score: score, fooled: fooled, marks: res, good: score >= 6, summary: score + "/8",
                grid: deck.map(function (d, i) { return res[i] ? (d.real ? "📰" : "🃏") : "🟥"; }).join(""),
                verdict: score === 8 ? "Fact-checker" : score >= 6 ? "Sceptic" : score >= 4 ? "Confused" : "Believes everything"
              }, practice);
            }
          });
          body.appendChild(next);
          next.focus();
        });
      });
    }
    show();
  };
})();
