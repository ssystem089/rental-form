/* SSystem 日／夜主題切換開關（可重用元件，2026-11-09 預覽版）
 * 用法：<button class="ss-tswitch" data-size="lg|sm"></button> ＋ SSThemeSwitch.mount(el, opts)
 *   opts：duration(ms,預設700)、glow(0–1.5,預設1)、key(localStorage 名稱,預設 fir-theme)、onChange(theme)
 * 狀態：pos 0＝夜（滑塊在左、彎月）、1＝日（滑塊在右、太陽）；圖示、顏色、位置全部由 pos 推算，
 *   所以連點時直接從目前位置轉向，不會跳格。
 * 主題：寫 <html data-theme="light|dark"> 與 localStorage；沒存過就跟系統。減少動態效果時改短淡入淡出。 */
(function (global) {
  'use strict';
  var DAY = { page: [236, 235, 232], track: [232, 231, 228], glass: [252, 251, 248, 0.9], dot: [60, 60, 64], edge: [255, 190, 60], glow: [255, 186, 60, 0.6], tint: [255, 200, 80, 0.55], text: [40, 40, 44] };
  var NIGHT = { page: [22, 22, 24], track: [6, 6, 8], glass: [165, 168, 182, 0.42], dot: [250, 250, 252], edge: [168, 176, 255], glow: [118, 110, 255, 0.55], tint: [175, 170, 255, 0.45], text: [236, 235, 231] };

  function mix(a, b, t) { var o = []; for (var i = 0; i < a.length; i++) o.push(a[i] + (b[i] - a[i]) * t); return o; }
  function rgba(c) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (c.length > 3 ? c[3].toFixed(3) : 1) + ')'; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function settle(t) { var e = easeInOut(t); return e + Math.sin(t * Math.PI) * 0 + (t > .7 ? Math.sin((t - .7) / .3 * Math.PI) * 0.035 : 0); } // 尾段輕微過頭再落位

  // 點陣圖案：N×N 格，回傳格點座標（-1..1）
  function sunPts(N) {
    var c = (N - 1) / 2, r = N * 0.16, pts = [];
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var dx = x - c, dy = y - c, d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r + 0.15) { pts.push([dx / c, dy / c]); continue; }
      var a = Math.atan2(dy, dx), k = Math.round(a / (Math.PI / 4)), off = Math.abs(a - k * Math.PI / 4) * d;
      if (d >= r + 1.9 && d <= Math.min(c + 0.2, r + 4.6) && off < 0.5) pts.push([dx / c, dy / c]);
    }
    return pts;
  }
  function moonPts(N) {
    var c = (N - 1) / 2, R = N * 0.36, pts = [], cx = -0.6, cy = 0.5, sx = cx + R * 0.55, sy = cy - R * 0.5;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var dx = x - c, dy = y - c;
      var inMoon = Math.pow(dx - cx, 2) + Math.pow(dy - cy, 2) <= R * R;
      var inCut = Math.pow(dx - sx, 2) + Math.pow(dy - sy, 2) <= Math.pow(R * 0.86, 2);
      if (inMoon && !inCut) pts.push([dx / c, dy / c]);
    }
    // 右上方點陣星星：一顆十字、一顆單點
    var s = Math.max(2, Math.round(N * 0.12)), x0 = N - 1 - s, y0 = s;
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) { pts.push([(x0 + o[0] - c) / c, (y0 + o[1] - c) / c]); });
    pts.push([(N - 1 - Math.round(N * 0.38) - c) / c, (Math.round(N * 0.06) - c) / c]);
    pts.push([(N - 2 - c) / c, (Math.round(N * 0.42) - c) / c]);
    return pts;
  }
  function ghostPts(N) {
    var c = (N - 1) / 2, R = N * 0.36, cx = -0.6, cy = 0.5, pts = [];
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var dx = x - c, dy = y - c;
      if (Math.pow(dx - cx, 2) + Math.pow(dy - cy, 2) <= R * R) pts.push([dx / c, dy / c]);
    }
    return pts;
  }
  function byAngle(p) { return p.slice().sort(function (a, b) { return Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]); }); }

  function mount(el, opts) {
    opts = opts || {};
    var size = el.getAttribute('data-size') || 'lg';
    var N = size === 'sm' ? 11 : 15;
    var cfg = { duration: opts.duration || 700, glow: opts.glow == null ? 1 : opts.glow, key: opts.key || 'fir-theme' };
    var reduce = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');

    var isBtn = el.getAttribute('data-mode') === 'button';
    el.type = 'button';
    el.setAttribute('role', 'switch');
    el.innerHTML = '<span class="ss-ts-track"></span><span class="ss-ts-knob"><span class="ss-ts-tint"></span><canvas class="ss-ts-dots"></canvas><span class="ss-ts-ring"></span></span>';
    var knob = el.querySelector('.ss-ts-knob'), cvs = el.querySelector('canvas'), ctx = cvs.getContext('2d');

    // 配對：夜（彎月）與日（太陽）各點依角度排序，數量不同時多的那邊共用目標
    var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var G = ghostPts(N);
    var A = byAngle(moonPts(N)), B = byAngle(sunPts(N)), n = Math.max(A.length, B.length), pairs = [];
    for (var i = 0; i < n; i++) {
      var a = A[Math.floor(i * A.length / n)], b = B[Math.floor(i * B.length / n)];
      pairs.push({ a: a, b: b, j: [(rnd() - .5) * 1.1, (rnd() - .5) * 1.1], s: 0.5 + rnd() * 0.7 });
    }

    var en = /^en/i.test(document.documentElement.lang || '');
    function label(t) { return t === 'dark' ? (en ? 'Switch to light mode' : '切換成淺色') : (en ? 'Switch to dark mode' : '切換成深色'); }
    function stored() { try { return localStorage.getItem(cfg.key); } catch (e) { return null; } }
    function sysDark() { return !!(global.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
    var theme = stored() || document.documentElement.getAttribute('data-theme') || (sysDark() ? 'dark' : 'light');
    if (theme !== 'dark' && theme !== 'light') theme = sysDark() ? 'dark' : 'light';
    var pos = theme === 'dark' ? 0 : 1, from = pos, target = pos, t0 = 0, dur = 0, raf = 0, fade = 1;

    function resize() {
      var r = knob.getBoundingClientRect(), dpr = Math.min(global.devicePixelRatio || 1, 3);
      cvs.width = Math.round(r.width * dpr); cvs.height = Math.round(r.height * dpr);
      draw(pos, 0);
    }

    function paint(p, prog) {
      var isBtn = el.getAttribute('data-mode') === 'button';
      var t = clamp(p, 0, 1), C = {};
      for (var k in DAY) C[k] = mix(NIGHT[k], DAY[k], t);
      var g = cfg.glow, s = el.style;
      s.setProperty('--ts-track', rgba(C.track));
      s.setProperty('--ts-glass', rgba(C.glass));
      s.setProperty('--ts-edge', rgba(C.edge));
      s.setProperty('--ts-glow', rgba([C.glow[0], C.glow[1], C.glow[2], C.glow[3] * g]));
      s.setProperty('--ts-shade', (0.35 - t * 0.2).toFixed(3));
      s.setProperty('--ts-x', isBtn ? '0' : p.toFixed(4));
      // 邊緣光：一段亮弧常駐（夜：左下；日：右上），切換時順時針沿圓角繞過去並短暫變亮
      var e2 = easeInOut(t), ang = 180 + (390 - 180) * e2, rad = (ang - 90) * Math.PI / 180;
      s.setProperty('--ts-ring-a', ang.toFixed(1) + 'deg');
      s.setProperty('--ts-ring-o', (Math.min(1, g)).toFixed(3));
      s.setProperty('--ts-gx', Math.cos(rad).toFixed(3));
      s.setProperty('--ts-gy', Math.sin(rad).toFixed(3));
      s.setProperty('--ts-tint', rgba(C.tint));
      if (opts.onPaint) opts.onPaint(C, t);
    }

    function draw(p, prog) {
      var w = cvs.width, h = cvs.height, t = clamp(p, 0, 1);
      ctx.clearRect(0, 0, w, h);
      var col = mix(NIGHT.dot, DAY.dot, t), pad = w * (size === 'sm' ? 0.2 : 0.18), half = (w - pad * 2) / 2;
      var cell = (half * 2) / N, dotSz = cell * (size === 'sm' ? 0.9 : 0.78);
      var loose = Math.sin(t * Math.PI);            // 中段最散：鬆散→移動→重組
      var e = easeInOut(t);
      var ga = (1 - t) * (1 - loose) * 0.2 * fade;   // 底紋只在夜晚靜止時出現
      if (ga > 0.01) {
        ctx.fillStyle = rgba([col[0], col[1], col[2], ga]);
        for (var gi = 0; gi < G.length; gi++) ctx.fillRect(w / 2 + G[gi][0] * half - dotSz / 2, h / 2 + G[gi][1] * half - dotSz / 2, dotSz, dotSz);
      }
      ctx.fillStyle = rgba(col);
      if (fade < 1) ctx.globalAlpha = fade;
      // 夜晚圖示亮白帶一點光
      ctx.shadowColor = rgba([col[0], col[1], col[2], (1 - t) * 0.6]);
      ctx.shadowBlur = (1 - t) * cell * 0.8;
      for (var i = 0; i < pairs.length; i++) {
        var q = pairs[i];
        var x = q.a[0] + (q.b[0] - q.a[0]) * e + q.j[0] * loose * q.s;
        var y = q.a[1] + (q.b[1] - q.a[1]) * e + q.j[1] * loose * q.s;
        x = clamp(x, -1.05, 1.05); y = clamp(y, -1.05, 1.05);
        var sz = dotSz * (1 - loose * 0.45);
        ctx.fillRect(w / 2 + x * half - sz / 2, h / 2 + y * half - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      paint(p, prog);
    }

    function frame(now) {
      var k = dur ? clamp((now - t0) / dur, 0, 1) : 1;
      if (reduce && reduce.matches) {
        fade = k < .5 ? 1 - k * 2 : (k - .5) * 2;   // 淡出→換圖→淡入
        pos = k < .5 ? from : target;
        draw(pos, 0);
      } else {
        fade = 1;
        pos = from + (target - from) * settle(k);
        draw(pos, k);
      }
      if (k < 1) raf = requestAnimationFrame(frame); else { raf = 0; fade = 1; pos = target; draw(pos, 1); }
    }

    function set(next, save) {
      if (next === theme && target === (next === 'dark' ? 0 : 1)) return;
      theme = next;
      from = pos; target = next === 'dark' ? 0 : 1;
      var dist = Math.abs(target - from);
      dur = (reduce && reduce.matches) ? 200 : cfg.duration * Math.max(0.35, dist);
      t0 = performance.now();
      document.documentElement.setAttribute('data-theme', next);
      document.documentElement.style.setProperty('--ts-dur', dur + 'ms');
      el.setAttribute('aria-checked', next === 'dark' ? 'true' : 'false');
      el.setAttribute('aria-label', label(next));
      if (save) { try { localStorage.setItem(cfg.key, next); } catch (e) {} }
      if (opts.onChange) opts.onChange(next);
      if (!raf) raf = requestAnimationFrame(frame);
    }

    el.addEventListener('click', function () { set(theme === 'dark' ? 'light' : 'dark', true); });
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); set('dark', true); }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); set('light', true); }
    });
    if (global.matchMedia) {
      var mq = matchMedia('(prefers-color-scheme: dark)');
      var onSys = function () { if (!stored()) set(mq.matches ? 'dark' : 'light', false); };
      mq.addEventListener ? mq.addEventListener('change', onSys) : mq.addListener(onSys);
    }
    document.documentElement.setAttribute('data-theme', theme);
    el.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
    el.setAttribute('aria-label', label(theme));
    if (global.ResizeObserver) new ResizeObserver(resize).observe(knob); else resize();
    resize();

    return {
      set: function (t) { set(t, true); },
      get theme() { return theme; },
      setDuration: function (ms) { cfg.duration = ms; },
      setGlow: function (g) { cfg.glow = g; draw(pos, 1); }
    };
  }

  // 把頁面原本的日月鍵換成單鍵版（保留 id；原本的 onclick 不帶過來）。opts.w：按鍵邊長，例 '40px'
  function upgrade(old, opts) {
    if (!old || old.classList.contains('ss-tswitch')) return null;
    opts = opts || {};
    var b = document.createElement('button');
    if (old.id) b.id = old.id;
    b.className = 'ss-tswitch';
    b.setAttribute('data-mode', 'button');
    b.setAttribute('data-size', 'sm');
    if (opts.w) b.style.setProperty('--ts-w', opts.w);
    old.parentNode.replaceChild(b, old);
    return mount(b, opts);
  }

  global.SSThemeSwitch = { mount: mount, upgrade: upgrade, colors: { DAY: DAY, NIGHT: NIGHT } };
})(window);
