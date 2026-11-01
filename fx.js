/* EUROPOOR — print room.
   Guilloche, the rosette, split-flap boards, scratch cards, the velocity
   marquee, scroll reveals and the shredder. All drawn by hand, no libraries. */
(function () {
  "use strict";
  var EP = (window.EP = window.EP || {});
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var TAU = Math.PI * 2;
  EP.reduce = reduce;

  function fit(canvas) {
    var r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
    var ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: r.width, h: r.height };
  }
  function css(el, name) { return getComputedStyle(el).getPropertyValue(name).trim(); }
  function onResize(el, fn) {
    if (!("ResizeObserver" in window)) { fn(); return; }
    var last = "";
    new ResizeObserver(function (e) { var r = e[0].contentRect, k = Math.round(r.width) + "x" + Math.round(r.height / 40); if (k !== last) { last = k; fn(); } }).observe(el);
  }

  /* ---------- guilloche: hypotrochoid bands, the stuff on banknotes ---------- */
  function rosetteLines(ctx, cx, cy, R, opt) {
    var n = opt.bands || 36, lobes = opt.lobes || 18, inner = opt.inner || .55, amp = opt.amp || .12;
    ctx.lineWidth = opt.lw || .7;
    for (var b = 0; b < n; b++) {
      var s = b / n, ph = s * TAU * (opt.twist || 1);
      ctx.beginPath();
      for (var i = 0; i <= 720; i++) {
        var t = (i / 720) * TAU;
        var r = R * (inner + (1 - inner) * (.5 + .5 * Math.sin(lobes * t + ph))) + R * amp * Math.sin((lobes / 2 + 1) * t - ph * 2);
        var x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = typeof opt.color === "function" ? opt.color(s) : opt.color;
      ctx.stroke();
    }
  }
  function waveLines(ctx, w, h, opt) {
    ctx.lineWidth = opt.lw || .6; ctx.strokeStyle = opt.color;
    for (var y = -10; y < h + 10; y += opt.step || 6) {
      ctx.beginPath();
      for (var x = 0; x <= w; x += 4) {
        var yy = y + Math.sin(x / (opt.f1 || 26) + y * .045) * (opt.a1 || 4) + Math.sin(x / (opt.f2 || 9) + y * .3) * (opt.a2 || 1.2);
        x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      }
      ctx.stroke();
    }
  }
  EP.heroGuilloche = function (canvas) {
    function draw() {
      var f = fit(canvas), ctx = f.ctx;
      ctx.clearRect(0, 0, f.w, f.h);
      var dark = (css(canvas, "color-scheme") || "").indexOf("dark") >= 0;
      var ink = dark ? "243,242,238" : "29,48,181";
      var R = Math.max(f.w, f.h) * .4;
      rosetteLines(ctx, f.w * .8, f.h * .4, R, { bands: 40, lobes: 24, inner: .52, amp: .08, lw: .6, color: function (s) { return "rgba(" + ink + "," + (.025 + s * .05) + ")"; } });
      rosetteLines(ctx, f.w * .8, f.h * .4, R * .34, { bands: 20, lobes: 12, inner: .42, amp: .14, lw: .6, color: "rgba(" + ink + ",.07)" });
    }
    onResize(canvas, draw);
  };
  EP.noteGuilloche = function (canvas) {
    function draw() {
      var f = fit(canvas), ctx = f.ctx, w = f.w, h = f.h;
      ctx.clearRect(0, 0, w, h);
      waveLines(ctx, w, h, { color: "rgba(255,255,255,.07)", step: Math.max(3, h / 70), a1: h / 60, f1: w / 22, a2: .8, f2: w / 70 });
      rosetteLines(ctx, w * .73, h * .48, h * .5, { bands: 34, lobes: 20, inner: .5, amp: .1, lw: .6, color: function (s) { return "rgba(255,214,120," + (.1 + s * .2) + ")"; } });
      rosetteLines(ctx, w * .25, h * .5, h * .42, { bands: 22, lobes: 16, inner: .62, amp: .06, lw: .5, color: "rgba(180,200,255,.16)" });
      // a guilloche border band, top and bottom
      ctx.lineWidth = .6;
      for (var k = 0; k < 5; k++) {
        ["top", "bot"].forEach(function (side) {
          ctx.beginPath();
          var y0 = side === "top" ? h * .085 : h * .915;
          for (var x = w * .035; x <= w * .965; x += 2) {
            var y = y0 + Math.sin(x / 6 + k * 1.2) * h * .012;
            x === w * .035 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.strokeStyle = "rgba(255,230,160,.22)"; ctx.stroke();
        });
      }
    }
    onResize(canvas, draw);
  };

  /* ---------- the rosette of decline: a guilloche whose lobes are the data ---------- */
  EP.rosette = function (canvas, comps) {
    var phase = 0, prog = reduce ? 1 : 0, visible = false, raf = 0, last = 0, started = false, size = 0;
    var anchors = comps.map(function (c, i) { return -Math.PI / 2 + (i / comps.length) * TAU; });
    function val(t) {
      var num = 0, den = 0;
      for (var i = 0; i < comps.length; i++) { var k = Math.exp(Math.cos(t - anchors[i]) * 5); num += comps[i].v * k; den += k; }
      return num / den;
    }
    var cache = [];
    for (var i = 0; i <= 360; i++) cache.push(val((i / 360) * TAU));
    function draw() {
      // geometry in fractions of the box: an empty centre for the score,
      // lobes reaching out to R, labels sitting just beyond at 44%
      var f = fit(canvas), ctx = f.ctx, S = Math.min(f.w, f.h), cx = f.w / 2, cy = f.h / 2;
      var H0 = S * .165, R = S * .345;
      size = S;
      var fg = css(canvas, "--fg") || "#0d1030", bad = css(canvas, "--bad") || "#d3202f";
      ctx.clearRect(0, 0, f.w, f.h);
      var N = 48, end = Math.round(360 * easeOut(prog));
      ctx.lineJoin = "round";
      for (var k = 0; k < N; k++) {
        var s = k / (N - 1);
        ctx.beginPath();
        for (var j = 0; j <= end; j++) {
          var t = (j / 360) * TAU, v = cache[j % 360] / 100;
          var r = H0 + 6 + s * (R - H0 - 6) * (.2 + .8 * v) + S * .006 * (0.3 + s) * Math.sin(14 * t + s * TAU * 1.5 + phase);
          var x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r;
          j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        var outer = k > N - 4;
        ctx.strokeStyle = outer ? bad : fg;
        ctx.globalAlpha = outer ? .9 : .1 + s * .42;
        ctx.lineWidth = outer ? 1.5 : .7;
        ctx.stroke();
      }
      // a clean ring around the score
      ctx.globalAlpha = 1; ctx.strokeStyle = fg; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, H0, 0, TAU * easeOut(prog)); ctx.stroke();
    }
    function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
    function loop(t) {
      raf = 0; if (!visible) return;
      var dt = Math.min(60, t - (last || t)); last = t;
      if (prog < 1) prog = Math.min(1, prog + dt / 1800);
      phase += dt * .00035;
      draw();
      raf = requestAnimationFrame(loop);
    }
    onResize(canvas, function () { draw(); });
    if (!reduce && "IntersectionObserver" in window) {
      new IntersectionObserver(function (e) {
        visible = e[0].isIntersecting;
        if (visible) { started = true; if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }
        else if (started && prog < 1) { prog = 1; draw(); }
      }, { threshold: .2 }).observe(canvas);
    } else { prog = 1; draw(); }
    // label positions, in % of the box
    return anchors.map(function (a) {
      // each label sits just past the tip of its own lobe
      var j = Math.round(((a / TAU) * 360 + 720) % 360), v = cache[j] / 100;
      var rr = (16.5 + 18 * (.2 + .8 * v)) + 10;
      return { x: 50 + Math.cos(a) * rr, y: 50 + Math.sin(a) * rr };
    });
  };

  /* ---------- split-flap ---------- */
  var FLAP_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-'!?%€£$/&";
  function clean(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[‘’]/g, "'").replace(/[“”«»]/g, "'").replace(/[–—]/g, "-")
      .split("").map(function (c) { return FLAP_CHARS.indexOf(c) >= 0 ? c : " "; }).join("");
  }
  EP.flaps = function (len, text) {
    var t = clean(text || "").slice(0, len); while (t.length < len) t += " ";
    return '<span class="flaps" data-len="' + len + '" aria-label="' + (text || "").replace(/"/g, "&quot;") + '">' +
      t.split("").map(function (c) { return '<span class="flap" aria-hidden="true">' + (c === " " ? "&nbsp;" : c) + "</span>"; }).join("") + "</span>";
  };
  EP.setFlaps = function (wrap, text, opts) {
    opts = opts || {};
    var len = +wrap.getAttribute("data-len"), t = clean(text).slice(0, len);
    if (t.length < len && t.length >= len - 1 && clean(text).length > len) t = t.slice(0, len - 1) + "…";
    while (t.length < len) t += " ";
    wrap.setAttribute("aria-label", text);
    var cells = wrap.children;
    for (var i = 0; i < len; i++) (function (cell, target, i) {
      var cur = cell.textContent === " " ? " " : cell.textContent;
      if (cur === target && !opts.force) return;
      if (reduce) { cell.innerHTML = target === " " ? "&nbsp;" : target; return; }
      var steps = 3 + Math.floor(Math.random() * 6), n = 0;
      setTimeout(function tick() {
        cell.classList.remove("spin"); void cell.offsetWidth; cell.classList.add("spin");
        var c = n++ < steps ? FLAP_CHARS[1 + Math.floor(Math.random() * 36)] : target;
        cell.innerHTML = c === " " ? "&nbsp;" : c;
        if (n <= steps) setTimeout(tick, 55);
      }, (opts.delay || 0) + i * 18);
    })(cells[i], t[i], i);
  };

  /* ---------- scratch card ---------- */
  EP.scratch = function (canvas, done) {
    var f, ctx, drawing = false, moves = 0, cleared = false;
    function paint() {
      f = fit(canvas); ctx = f.ctx;
      var g = ctx.createLinearGradient(0, 0, f.w, f.h);
      g.addColorStop(0, "#9ea4b2"); g.addColorStop(.35, "#e3e6ee"); g.addColorStop(.55, "#a7adbb"); g.addColorStop(1, "#d8dbe4");
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = g; ctx.fillRect(0, 0, f.w, f.h);
      ctx.globalAlpha = .25; ctx.fillStyle = "#fff";
      for (var i = 0; i < 260; i++) ctx.fillRect(Math.random() * f.w, Math.random() * f.h, 1, 1);
      ctx.globalAlpha = 1; ctx.fillStyle = "rgba(20,24,50,.55)";
      ctx.font = "800 14px 'Archivo', sans-serif"; ctx.textAlign = "center";
      ctx.fillText("★  SCRATCH HERE  ★", f.w / 2, f.h / 2 - 4);
      ctx.font = "500 9px 'IBM Plex Mono', monospace";
      ctx.fillText("TODAY'S PUZZLE · NO PURCHASE NECESSARY", f.w / 2, f.h / 2 + 14);
    }
    function pos(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function erase(p) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath(); ctx.arc(p[0], p[1], 17, 0, TAU); ctx.fill();
      if (++moves % 8 === 0) check();
    }
    function check() {
      var d = ctx.getImageData(0, 0, canvas.width, canvas.height).data, clear = 0, tot = 0;
      for (var i = 3; i < d.length; i += 64) { tot++; if (d[i] < 40) clear++; }
      if (clear / tot > .42 && !cleared) { cleared = true; canvas.classList.add("gone"); done && done(); }
    }
    canvas.addEventListener("pointerdown", function (e) { drawing = true; canvas.setPointerCapture(e.pointerId); erase(pos(e)); e.preventDefault(); });
    canvas.addEventListener("pointermove", function (e) { if (drawing || e.pointerType === "mouse" && e.buttons === 0 && e.target === canvas) erase(pos(e)); });
    canvas.addEventListener("pointerup", function () { drawing = false; });
    onResize(canvas, function () { if (!cleared) paint(); });
  };

  /* ---------- velocity marquee ---------- */
  EP.marquee = function (track, dir) {
    var x = 0, vel = 0, lastY = window.scrollY, raf = 0, last = 0, visible = true, half = 0;
    dir = dir || -1;
    function measure() { half = track.scrollWidth / 2; }
    function loop(t) {
      raf = 0; if (!visible) return;
      var dt = Math.min(50, t - (last || t)); last = t;
      var y = window.scrollY, dy = y - lastY; lastY = y;
      vel += (Math.abs(dy) * 1.4 - vel) * .1;
      x += dir * (0.05 + vel * .02) * dt;
      if (half) { if (x <= -half) x += half; if (x > 0) x -= half; }
      var skew = Math.max(-12, Math.min(12, dy * .25 * -dir));
      track.style.transform = "translate3d(" + x.toFixed(1) + "px,0,0) skewX(" + skew.toFixed(2) + "deg)";
      raf = requestAnimationFrame(loop);
    }
    measure(); onResize(track, measure);
    if (reduce) return;
    if ("IntersectionObserver" in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible && !raf) { last = 0; raf = requestAnimationFrame(loop); } }).observe(track.parentNode);
    raf = requestAnimationFrame(loop);
  };

  /* ---------- text splitting + reveals ---------- */
  EP.split = function (el) {
    if (el.dataset.splitDone) return; el.dataset.splitDone = "1";
    var i = 0, out = [];
    Array.prototype.slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        n.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { out.push(document.createTextNode(" ")); return; }
          out.push(word(document.createTextNode(part)));
        });
      } else if (n.nodeName === "BR") out.push(n.cloneNode());
      else out.push(word(n.cloneNode(true)));
    });
    function word(node) {
      var w = document.createElement("span"), s = document.createElement("span");
      w.className = "w"; s.style.setProperty("--i", i++); s.appendChild(node); w.appendChild(s); return w;
    }
    el.textContent = ""; out.forEach(function (n) { el.appendChild(n); });
    el.classList.add("split");
  };
  EP.count = function (el) {
    var to = parseFloat(el.getAttribute("data-count")), dec = +(el.getAttribute("data-dec") || 0), t0 = 0, dur = 1400;
    if (reduce || isNaN(to)) { el.textContent = isNaN(to) ? el.textContent : to.toFixed(dec); return; }
    (function step(t) {
      if (!t0) t0 = t; var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = (to * e).toFixed(dec);
      if (p < 1) requestAnimationFrame(step);
    })(performance.now());
  };
  EP.reveal = function (root) {
    $$("[data-split]", root).forEach(EP.split);
    var els = $$(".rv, .split, [data-count], .coins, [data-reveal-cb]", root);
    if (!("IntersectionObserver" in window) || reduce) { els.forEach(fire); return; }
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (e) { if (e.isIntersecting) { fire(e.target); io.unobserve(e.target); } });
    }, { threshold: .12, rootMargin: "0px 0px -6% 0px" });
    els.forEach(function (el) { io.observe(el); });
    function fire(el) {
      el.classList.add("in");
      if (el.hasAttribute("data-count") && !el.dataset.counted) { el.dataset.counted = 1; EP.count(el); }
      if (el._onReveal) el._onReveal();
    }
  };
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- banknote tilt ---------- */
  EP.tilt = function (note) {
    if (reduce) return;
    var box = note.parentNode;
    box.addEventListener("pointermove", function (e) {
      var r = note.getBoundingClientRect(), mx = (e.clientX - r.left) / r.width, my = (e.clientY - r.top) / r.height;
      note.classList.add("live");
      note.style.setProperty("--mx", mx.toFixed(3)); note.style.setProperty("--my", my.toFixed(3));
      note.style.setProperty("--ry", ((mx - .5) * 16).toFixed(2) + "deg"); note.style.setProperty("--rx", ((.5 - my) * 12).toFixed(2) + "deg");
    });
    box.addEventListener("pointerleave", function () {
      note.classList.remove("live");
      note.style.setProperty("--ry", "0deg"); note.style.setProperty("--rx", "0deg");
    });
    // idle drift so the foil moves even when nobody is touching it
    var t0 = performance.now();
    (function idle(t) {
      if (!note.isConnected) return;
      if (!note.classList.contains("live")) {
        var s = (t - t0) / 1000;
        note.style.setProperty("--mx", (.5 + Math.sin(s * .6) * .35).toFixed(3));
        note.style.setProperty("--my", (.5 + Math.cos(s * .45) * .3).toFixed(3));
      }
      requestAnimationFrame(idle);
    })(t0);
  };

  /* ---------- the shredder: page transitions ---------- */
  var shred = document.getElementById("shred"), shredLabel = document.getElementById("shredLabel");
  if (shred) for (var k = 0; k < 12; k++) { var s = document.createElement("i"); s.style.setProperty("--k", k); shred.appendChild(s); }
  var shredTimers = [];
  EP.shred = function (label, swap) {
    if (reduce || !shred) { swap(); return; }
    // a second tap mid-transition restarts it cleanly instead of stacking timers
    shredTimers.forEach(clearTimeout); shredTimers = [];
    shred.classList.remove("uncover"); void shred.offsetWidth;
    shredLabel.innerHTML = "<span>" + (label || "") + "</span>";
    shredLabel.classList.add("on");
    shred.classList.add("cover");
    shredTimers.push(setTimeout(function () {
      swap();
      shredLabel.classList.remove("on");                 // label leaves before the strips do
      shredTimers.push(setTimeout(function () {
        shred.classList.add("uncover");
        shredTimers.push(setTimeout(function () { shred.classList.remove("cover", "uncover"); }, 850));
      }, 170));
    }, 560));
  };

  /* ---------- the logo: twelve stars, one leaving ---------- */
  EP.logo = function (svg) {
    var out = "";
    for (var i = 0; i < 12; i++) {
      var a = -Math.PI / 2 + (i / 12) * TAU, x = 20 + Math.cos(a) * 15, y = 20 + Math.sin(a) * 15;
      out += '<use href="#star" x="' + (x - 3.2).toFixed(2) + '" y="' + (y - 3.2).toFixed(2) + '" width="6.4" height="6.4" fill="#ffc61a"' + (i === 4 ? ' class="fall"' : "") + "/>";
    }
    svg.innerHTML = out;
  };
})();
