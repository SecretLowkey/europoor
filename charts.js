/* EUROPOOR — drawing office.
   Hand-rolled charts: the crumbling star ring, the gauge, line charts,
   sparklines and the score colour ramp. No libraries were harmed. */
(function () {
  "use strict";
  var EP = (window.EP = window.EP || {});
  var NS = "http://www.w3.org/2000/svg";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- tiny seeded RNG (mulberry32) ---------- */
  EP.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  EP.hash = function (str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  /* ---------- score → colour ---------- */
  var STOPS = [
    [20, [40, 74, 205]],
    [38, [120, 150, 245]],
    [47, [196, 210, 255]],
    [51, [255, 236, 150]],
    [58, [255, 204, 0]],
    [66, [240, 130, 50]],
    [75, [211, 32, 47]],
    [90, [110, 10, 24]]
  ];
  EP.scoreRGB = function (s) {
    if (s == null || isNaN(s)) return [200, 205, 220];
    if (s <= STOPS[0][0]) return STOPS[0][1];
    for (var i = 1; i < STOPS.length; i++) {
      if (s <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i], t = (s - a[0]) / (b[0] - a[0]);
        return [0, 1, 2].map(function (k) { return Math.round(a[1][k] + (b[1][k] - a[1][k]) * t); });
      }
    }
    return STOPS[STOPS.length - 1][1];
  };
  EP.scoreColor = function (s) { var c = EP.scoreRGB(s); return "rgb(" + c.join(",") + ")"; };
  EP.isLight = function (s) { var c = EP.scoreRGB(s); return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) > 150; };
  EP.rampCSS = function () {
    return "linear-gradient(90deg," + STOPS.map(function (st) {
      return "rgb(" + st[1].join(",") + ") " + Math.round(((st[0] - 20) / 70) * 100) + "%";
    }).join(",") + ")";
  };


  /* ---------- flags, drawn by hand (emoji flags don't render on Windows) ---------- */
  var V = { BE: ["#1a1a1a", "#fdda24", "#ef3340"], FR: ["#0055a4", "#fff", "#ef4135"], IE: ["#169b62", "#fff", "#ff883e"], IT: ["#009246", "#fff", "#ce2b37"], RO: ["#002b7f", "#fcd116", "#ce1126"] };
  var Hz = { AT: ["#c8102e", "#fff", "#c8102e"], BG: ["#fff", "#00966e", "#d62612"], DE: ["#1a1a1a", "#dd0000", "#ffce00"], EE: ["#0072ce", "#1a1a1a", "#fff"], HU: ["#ce2939", "#fff", "#477050"], LT: ["#fdb913", "#006a44", "#c1272d"], LU: ["#ef3340", "#fff", "#00a3e0"], NL: ["#ae1c28", "#fff", "#21468b"], HR: ["#ff0000", "#fff", "#171796"], SI: ["#fff", "#005da4", "#ed1c24"], SK: ["#fff", "#0b4ea2", "#ee1c25"] };
  var NORDIC = { DK: ["#c8102e", "#fff"], SE: ["#006aa7", "#fecc00"], FI: ["#fff", "#002f6c"], NO: ["#ba0c2f", "#fff", "#00205b"], IS: ["#02529c", "#fff", "#dc1e35"] };
  function rect(x, y, w, h, f) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + f + '"/>'; }
  EP.flagSVG = function (code) {
    var b = "";
    if (V[code]) V[code].forEach(function (c, i) { b += rect(i * 10, 0, 10, 20, c); });
    else if (Hz[code]) Hz[code].forEach(function (c, i) { b += rect(0, i * 20 / 3, 30, 20 / 3 + 0.1, c); });
    else if (NORDIC[code]) {
      var n = NORDIC[code]; b = rect(0, 0, 30, 20, n[0]) + rect(8, 0, 4, 20, n[1]) + rect(0, 8, 30, 4, n[1]);
      if (n[2]) b += rect(9, 0, 2, 20, n[2]) + rect(0, 9, 30, 2, n[2]);
    } else switch (code) {
      case "LV": b = rect(0, 0, 30, 20, "#9e3039") + rect(0, 8, 30, 4, "#fff"); break;
      case "CZ": b = rect(0, 0, 30, 10, "#fff") + rect(0, 10, 30, 10, "#d7141a") + '<path d="M0 0L15 10L0 20Z" fill="#11457e"/>'; break;
      case "PL": b = rect(0, 0, 30, 10, "#fff") + rect(0, 10, 30, 10, "#dc143c"); break;
      case "ES": b = rect(0, 0, 30, 20, "#aa151b") + rect(0, 5, 30, 10, "#f1bf00"); break;
      case "PT": b = rect(0, 0, 12, 20, "#046a38") + rect(12, 0, 18, 20, "#da291c") + '<circle cx="12" cy="10" r="4" fill="#ffe000"/><circle cx="12" cy="10" r="2.3" fill="#da291c"/>'; break;
      case "MT": b = rect(0, 0, 15, 20, "#fff") + rect(15, 0, 15, 20, "#cf142b") + rect(2.5, 2.5, 3.5, 3.5, "#9a9a9a"); break;
      case "CH": b = rect(0, 0, 30, 20, "#da291c") + rect(13, 4, 4, 12, "#fff") + rect(9, 8, 12, 4, "#fff"); break;
      case "CY": b = rect(0, 0, 30, 20, "#fff") + '<path d="M8 9c3-3 8-4 13-3l2 2-3 2-4 1-5 1z" fill="#d57800"/><path d="M11 15q4 2 8 0" stroke="#4e5b31" stroke-width="1.2" fill="none"/>'; break;
      case "GR":
        for (var i = 0; i < 9; i++) b += rect(0, i * 20 / 9, 30, 20 / 9 + 0.05, i % 2 ? "#fff" : "#0d5eaf");
        b += rect(0, 0, 11.1, 11.1, "#0d5eaf") + rect(4.45, 0, 2.2, 11.1, "#fff") + rect(0, 4.45, 11.1, 2.2, "#fff"); break;
      case "GB": b = rect(0, 0, 30, 20, "#012169") + '<path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0L30 20M30 0L0 20" stroke="#c8102e" stroke-width="1.4"/>' + rect(12, 0, 6, 20, "#fff") + rect(0, 7, 30, 6, "#fff") + rect(13.2, 0, 3.6, 20, "#c8102e") + rect(0, 8.2, 30, 3.6, "#c8102e"); break;
      case "EU": b = rect(0, 0, 30, 20, "#003399"); for (var k = 0; k < 12; k++) { var a = k * Math.PI / 6; b += '<circle cx="' + (15 + Math.cos(a) * 6).toFixed(2) + '" cy="' + (10 + Math.sin(a) * 6).toFixed(2) + '" r="1" fill="#ffcc00"/>'; } break;
      default: b = rect(0, 0, 30, 20, "#c9cee2");
    }
    return '<svg class="flag-svg" viewBox="0 0 30 20" aria-hidden="true">' + b + '<rect x=".25" y=".25" width="29.5" height="19.5" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".5"/></svg>';
  };
  EP.flag = function (code) { return EP.flagSVG(code); };

  /* ---------- star geometry ---------- */
  function starPts(cx, cy, R, rot) {
    var pts = [], r = R * 0.382;
    for (var i = 0; i < 10; i++) {
      var a = rot - Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r : R;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return pts;
  }

  /* ---------- THE RING: twelve stars, some of them leaving ---------- */
  EP.ring = function (canvas, score) {
    var ctx = canvas.getContext("2d");
    var W = 0, H = 0, dpr = 1;
    var broken = Math.max(1, Math.min(11, Math.round((score / 100) * 12)));
    var rand = EP.rng(1957); // Treaty of Rome. It seemed like a good idea at the time.
    var stars = [];
    var shards = [];
    var settled = [];
    var pointer = null;
    var last = 0, spawnT = 0, raf = 0, visible = true;

    function layout() {
      var rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = rect.width; H = rect.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var R = Math.min(W, H) * 0.385, cx = W / 2, cy = H * 0.47, size = Math.min(W, H) * 0.05;
      stars = [];
      for (var i = 0; i < 12; i++) {
        var ang = -Math.PI / 2 + (i * Math.PI) / 6;
        // stars 1..broken (clockwise from one o'clock) are cracked; the last third have slipped
        var k = i === 0 ? 0 : i;
        var isBroken = k >= 1 && k <= broken;
        var slip = isBroken && k > broken - Math.floor(broken / 3);
        var depth = isBroken ? (k / broken) : 0;
        var x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R, rot = 0;
        if (slip) { x += (rand() - 0.2) * size * 1.4; y += size * (0.8 + rand() * 1.6); rot = (rand() - 0.5) * 1.2; }
        var pts = starPts(x, y, size, rot);
        var tris = [];
        for (var t = 0; t < 10; t++) {
          var gone = isBroken && rand() < 0.12 + depth * 0.32;
          tris.push({ a: pts[t], b: pts[(t + 1) % 10], gone: gone, off: isBroken ? 0.6 + rand() * 2.2 : 0 });
        }
        stars.push({ x: x, y: y, size: size, broken: isBroken, depth: depth, tris: tris });
      }
      settled = settled.filter(function (s) { return s.y < H; });
    }

    function shardAt(st, burst) {
      var ang = rand() * Math.PI * 2, d = rand() * st.size * 0.8;
      var n = 3 + (rand() < 0.4 ? 1 : 0), sz = 1.6 + rand() * (burst ? 5 : 4);
      var poly = [];
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2 + rand() * 0.9;
        poly.push([Math.cos(a) * sz * (0.6 + rand() * 0.6), Math.sin(a) * sz * (0.6 + rand() * 0.6)]);
      }
      shards.push({
        x: st.x + Math.cos(ang) * d, y: st.y + Math.sin(ang) * d,
        vx: (rand() - 0.35) * (burst ? 2.2 : 0.6), vy: burst ? -rand() * 2 : rand() * 0.4,
        r: rand() * 6, vr: (rand() - 0.5) * 0.2, poly: poly, a: 1
      });
    }

    function heapTop(x) {
      // settled shards form a rough heap along the bottom
      var top = H - 4, n = 0;
      for (var i = settled.length - 1; i >= 0 && n < 120; i--) {
        var s = settled[i];
        if (Math.abs(s.x - x) < 6) { top = Math.min(top, s.y - 2.5); n++; }
      }
      return top;
    }

    function drawPoly(x, y, r, poly, alpha) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(r);
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]);
      for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath(); ctx.fill(); ctx.restore();
    }

    function frame(t) {
      raf = 0;
      if (!visible) return;
      var dt = Math.min(48, t - (last || t)); last = t;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#ffcc00";

      stars.forEach(function (st) {
        st.tris.forEach(function (tr) {
          if (tr.gone) return;
          var mx = (tr.a[0] + tr.b[0]) / 2 - st.x, my = (tr.a[1] + tr.b[1]) / 2 - st.y;
          var len = Math.hypot(mx, my) || 1, ox = (mx / len) * tr.off, oy = (my / len) * tr.off;
          ctx.beginPath();
          ctx.moveTo(st.x + ox, st.y + oy);
          ctx.lineTo(tr.a[0] + ox, tr.a[1] + oy);
          ctx.lineTo(tr.b[0] + ox, tr.b[1] + oy);
          ctx.closePath(); ctx.fill();
        });
      });

      if (!reduce) {
        spawnT += dt;
        var every = 260 - broken * 12;
        while (spawnT > every) {
          spawnT -= every;
          var pool = stars.filter(function (s) { return s.broken; });
          if (pool.length) shardAt(pool[Math.floor(Math.pow(rand(), 0.6) * pool.length)], false);
        }
        if (pointer) {
          stars.forEach(function (st) {
            if (st.broken && Math.hypot(pointer.x - st.x, pointer.y - st.y) < st.size * 2.2 && rand() < 0.5) shardAt(st, true);
          });
        }
      }

      var g = 0.045 * (dt / 16);
      for (var i = shards.length - 1; i >= 0; i--) {
        var s = shards[i];
        s.vy += g; s.x += s.vx * (dt / 16); s.y += s.vy * (dt / 16); s.r += s.vr;
        var floor = heapTop(s.x);
        if (s.y >= floor) {
          s.y = floor; shards.splice(i, 1);
          if (s.x > 0 && s.x < W) settled.push(s);
          continue;
        }
        if (s.x < -20 || s.x > W + 20) { shards.splice(i, 1); continue; }
        drawPoly(s.x, s.y, s.r, s.poly, 1);
      }
      if (settled.length > 520) settled.splice(0, settled.length - 520);
      for (var j = 0; j < settled.length; j++) drawPoly(settled[j].x, settled[j].y, settled[j].r, settled[j].poly, 0.92);

      if (!reduce) raf = requestAnimationFrame(frame);
    }

    function prefill() {
      // start with some rubble already on the floor, so the first frame tells the story
      for (var i = 0; i < 160; i++) {
        var pool = stars.filter(function (s) { return s.broken; });
        var st = pool[Math.floor(rand() * pool.length)];
        shardAt(st, false);
        var s = shards.pop();
        s.x = W * 0.55 + (rand() - 0.3) * W * 0.5 * rand();
        s.y = heapTop(s.x);
        settled.push(s);
      }
    }

    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener("pointermove", function (e) { pointer = pos(e); });
    canvas.addEventListener("pointerleave", function () { pointer = null; });
    canvas.addEventListener("click", function () {
      stars.forEach(function (st) { if (st.broken) for (var i = 0; i < 6; i++) shardAt(st, true); });
      if (reduce) frame(performance.now());
    });

    var ro = new ResizeObserver(function () { layout(); if (!raf) raf = requestAnimationFrame(frame); });
    ro.observe(canvas);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (en) {
        visible = en[0].isIntersecting;
        if (visible && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      }).observe(canvas);
    }
    layout(); prefill();
    raf = requestAnimationFrame(frame);
    return { destroy: function () { ro.disconnect(); cancelAnimationFrame(raf); visible = false; } };
  };

  /* ---------- svg helpers ---------- */
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  EP.svgEl = el;

  /* ---------- the gauge, as on the old site but angrier ---------- */
  EP.gauge = function (score) {
    var cx = 160, cy = 160, R = 120, w = 30, segs = 5, gap = 0.035;
    var out = '<svg viewBox="0 0 320 190" role="img" aria-label="Gauge: ' + score.toFixed(1) + ' out of 100">';
    for (var i = 0; i < segs; i++) {
      var a0 = Math.PI + (i / segs) * Math.PI + gap, a1 = Math.PI + ((i + 1) / segs) * Math.PI - gap;
      var on = score >= (i / segs) * 100 + 2;
      var p = arc(cx, cy, R, a0, a1);
      out += '<path d="' + p + '" fill="none" stroke="' + (on ? "var(--red)" : "var(--track)") + '" stroke-width="' + w + '"/>';
    }
    // minor ticks
    for (var t = 0; t <= 20; t++) {
      var a = Math.PI + (t / 20) * Math.PI, r0 = R + w / 2 + 4, r1 = r0 + (t % 5 === 0 ? 9 : 4);
      out += '<line x1="' + (cx + Math.cos(a) * r0) + '" y1="' + (cy + Math.sin(a) * r0) + '" x2="' + (cx + Math.cos(a) * r1) + '" y2="' + (cy + Math.sin(a) * r1) + '" stroke="var(--ink-3)" stroke-width="1.2"/>';
    }
    out += '<text x="' + (cx - R - 2) + '" y="' + (cy + 24) + '" text-anchor="middle" style="font:500 11px var(--f-mono);fill:var(--ink-2)">0</text>';
    out += '<text x="' + (cx + R + 2) + '" y="' + (cy + 24) + '" text-anchor="middle" style="font:500 11px var(--f-mono);fill:var(--ink-2)">100</text>';
    var ang = -90 + (score / 100) * 180;
    out += '<g class="gauge-needle" data-angle="' + ang + '" style="transform:rotate(-90deg)">' +
      '<path d="M157 160 L160 58 L163 160 Z" fill="var(--ink)"/>' +
      '<circle cx="160" cy="160" r="11" fill="var(--ink)"/><circle cx="160" cy="160" r="4" fill="var(--sheet)"/></g>';
    out += "</svg>";
    return out;
  };
  EP.settleGauges = function (root) {
    (root || document).querySelectorAll(".gauge-needle").forEach(function (n) {
      requestAnimationFrame(function () { requestAnimationFrame(function () { n.style.transform = "rotate(" + n.getAttribute("data-angle") + "deg)"; }); });
    });
  };
  function arc(cx, cy, r, a0, a1) {
    var x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
    return "M" + x0.toFixed(2) + " " + y0.toFixed(2) + " A" + r + " " + r + " 0 0 1 " + x1.toFixed(2) + " " + y1.toFixed(2);
  }

  /* ---------- wobbly hand-drawn path (for the auditor's pen) ---------- */
  EP.wobble = function (points, seed, amp) {
    var r = EP.rng(seed || 7), d = "";
    amp = amp == null ? 1.6 : amp;
    points.forEach(function (p, i) {
      var x = p[0] + (r() - 0.5) * amp, y = p[1] + (r() - 0.5) * amp;
      if (i === 0) d += "M" + x.toFixed(1) + " " + y.toFixed(1);
      else {
        var q = points[i - 1];
        var mx = (q[0] + p[0]) / 2 + (r() - 0.5) * amp * 2, my = (q[1] + p[1]) / 2 + (r() - 0.5) * amp * 2;
        d += " Q" + mx.toFixed(1) + " " + my.toFixed(1) + " " + x.toFixed(1) + " " + y.toFixed(1);
      }
    });
    return d;
  };
  EP.circleScribble = function (w, h, seed) {
    var r = EP.rng(seed || 3), pts = [], n = 22, turns = 1.12;
    for (var i = 0; i <= n; i++) {
      var a = -2.2 + (i / n) * Math.PI * 2 * turns, k = 1 + (r() - 0.5) * 0.08;
      pts.push([w / 2 + Math.cos(a) * (w / 2) * k, h / 2 + Math.sin(a) * (h / 2) * k]);
    }
    return EP.wobble(pts, seed, 1.2);
  };

  /* ---------- line chart ---------- */
  // opts: { labels:[], series:[{values:[], cls:'', name:''}], yMin, yMax, band:[lo,hi], fmt:fn, ann:[{i, text, dx, dy}], height }
  EP.lineChart = function (host, opts) {
    var W = 720, H = opts.height || 300, m = { t: 22, r: 18, b: 30, l: 40 };
    var labels = opts.labels, n = labels.length;
    var all = [];
    opts.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
    var lo = opts.yMin != null ? opts.yMin : Math.min.apply(null, all);
    var hi = opts.yMax != null ? opts.yMax : Math.max.apply(null, all);
    if (opts.yMin == null || opts.yMax == null) { var pad = (hi - lo) * 0.12 || 1; if (opts.yMin == null) lo -= pad; if (opts.yMax == null) hi += pad; }
    var fmt = opts.fmt || function (v) { return v.toFixed(1); };
    var X = function (i) { return m.l + (n === 1 ? 0 : (i / (n - 1)) * (W - m.l - m.r)); };
    var Y = function (v) { return m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b); };

    host.innerHTML = "";
    host.style.position = "relative";
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, class: "chart", role: "img", "aria-label": opts.label || "Line chart" }, host);
    var g = el("g", { class: "grid" }, svg);
    var ticks = niceTicks(lo, hi, 5);
    ticks.forEach(function (tv) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(tv), y2: Y(tv) }, g);
      var tx = el("text", { x: m.l - 8, y: Y(tv) + 4, "text-anchor": "end" }, svg); tx.textContent = fmt(tv);
    });
    if (opts.band) el("rect", { class: "band", x: m.l, width: W - m.l - m.r, y: Y(opts.band[1]), height: Math.max(0, Y(opts.band[0]) - Y(opts.band[1])) }, svg);
    var step = Math.max(1, Math.ceil(n / 9));
    labels.forEach(function (lb, i) {
      if (i % step && !(i === n - 1 && (n - 1) % step >= step / 2)) return;
      var tx = el("text", { x: X(i), y: H - 8, "text-anchor": "middle" }, svg); tx.textContent = lb;
    });
    opts.series.forEach(function (s, si) {
      var d = "", started = false;
      s.values.forEach(function (v, i) {
        if (v == null) { started = false; return; }
        d += (started ? " L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); started = true;
      });
      if (si === 0 && opts.area !== false) {
        var first = s.values.findIndex(function (v) { return v != null; });
        var lastI = s.values.length - 1; while (lastI > 0 && s.values[lastI] == null) lastI--;
        el("path", { class: "area", d: d + " L" + X(lastI) + " " + Y(lo) + " L" + X(first) + " " + Y(lo) + " Z" }, svg);
      }
      var p = el("path", { class: "line " + (s.cls || ""), d: d }, svg);
      if (!reduce && si === 0) {
        var L = p.getTotalLength ? 2400 : 0;
        p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
        p.style.transition = "stroke-dashoffset 1.6s cubic-bezier(.5,.1,.2,1)";
        requestAnimationFrame(function () { requestAnimationFrame(function () { p.style.strokeDashoffset = 0; }); });
      }
    });
    var s0 = opts.series[0].values, li = s0.length - 1; while (li > 0 && s0[li] == null) li--;
    el("circle", { class: "dot", cx: X(li), cy: Y(s0[li]), r: 5 }, svg);
    (opts.ann || []).forEach(function (a, k) {
      var x = X(a.i), y = Y(s0[a.i]), tx = x + (a.dx || -60), ty = y + (a.dy || -40);
      el("path", { class: "ann-line", d: EP.wobble([[tx + (a.dx < 0 ? 30 : -10), ty + 6], [(tx + x) / 2, (ty + y) / 2 - 4], [x - (a.dx < 0 ? 6 : -6), y - 6]], 40 + k, 2) }, svg);
      var t = el("text", { class: "ann", x: tx, y: ty, "text-anchor": a.dx < 0 ? "end" : "start" }, svg);
      t.textContent = a.text;
    });
    // hover
    var hl = el("line", { class: "hover-line", y1: m.t, y2: H - m.b, x1: -10, x2: -10, opacity: 0 }, svg);
    var tip = document.createElement("div"); tip.className = "chart-tip"; tip.hidden = true; host.appendChild(tip);
    svg.addEventListener("pointermove", function (e) {
      var r = svg.getBoundingClientRect(), sx = ((e.clientX - r.left) / r.width) * W;
      var i = Math.round(((sx - m.l) / (W - m.l - m.r)) * (n - 1)); i = Math.max(0, Math.min(n - 1, i));
      hl.setAttribute("x1", X(i)); hl.setAttribute("x2", X(i)); hl.setAttribute("opacity", 1);
      tip.hidden = false;
      tip.innerHTML = "<b>" + labels[i] + "</b><br>" + opts.series.map(function (s) {
        return (s.name ? s.name + ": " : "") + (s.values[i] == null ? "–" : fmt(s.values[i]));
      }).join("<br>");
      var v = s0[i] != null ? s0[i] : lo;
      tip.style.left = (X(i) / W) * 100 + "%"; tip.style.top = (Y(v) / H) * r.height + "px";
    });
    svg.addEventListener("pointerleave", function () { tip.hidden = true; hl.setAttribute("opacity", 0); });
  };

  function niceTicks(lo, hi, count) {
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (count / span) * step;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var out = [], s = Math.ceil(lo / step) * step;
    for (var v = s; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }

  /* ---------- sparkline, returns markup ---------- */
  EP.spark = function (vals, opts) {
    opts = opts || {};
    var w = opts.w || 120, h = opts.h || 30, clean = vals.filter(function (v) { return v != null; });
    if (clean.length < 2) return "";
    var lo = Math.min.apply(null, clean), hi = Math.max.apply(null, clean); if (hi === lo) hi = lo + 1;
    var d = "", k = 0;
    vals.forEach(function (v, i) {
      if (v == null) return;
      var x = (i / (vals.length - 1)) * (w - 4) + 2, y = h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
      d += (k++ ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    });
    var lx = w - 2, lv = clean[clean.length - 1], ly = h - 3 - ((lv - lo) / (hi - lo)) * (h - 6);
    return '<svg viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" aria-hidden="true" style="display:inline-block;vertical-align:middle;overflow:visible">' +
      '<path d="' + d + '" fill="none" stroke="' + (opts.color || "var(--blue)") + '" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="' + lx + '" cy="' + ly.toFixed(1) + '" r="2.6" fill="var(--red)"/></svg>';
  };

  /* ---------- area chart for weekly league scores ---------- */
  EP.weekly = function (vals, labels) {
    var W = 420, H = 150, m = { t: 16, r: 10, b: 24, l: 10 }, n = vals.length;
    var hi = Math.max.apply(null, vals.concat([1]));
    var X = function (i) { return m.l + (i / Math.max(1, n - 1)) * (W - m.l - m.r); };
    var Y = function (v) { return m.t + (1 - v / hi) * (H - m.t - m.b); };
    var d = vals.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" ");
    var out = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Decline score, last ' + n + ' weeks">';
    out += '<path d="' + d + " L" + X(n - 1) + " " + Y(0) + " L" + X(0) + " " + Y(0) + ' Z" fill="var(--red)" opacity=".12"/>';
    out += '<path d="' + d + '" fill="none" stroke="var(--red)" stroke-width="2.4" stroke-linejoin="round"/>';
    vals.forEach(function (v, i) {
      out += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="3.5" fill="var(--red)" stroke="var(--sheet)" stroke-width="1.5"/>';
      out += '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? "start" : i === n - 1 ? "end" : "middle") + '">' + labels[i] + "</text>";
      out += '<text x="' + X(i) + '" y="' + (Y(v) - 8) + '" text-anchor="' + (i === 0 ? "start" : i === n - 1 ? "end" : "middle") + '" style="fill:var(--ink);font-weight:600">' + (Math.round(v * 10) / 10) + "</text>";
    });
    return out + "</svg>";
  };
})();
