/* FOLIO runtime — core.
 *
 * Every frame is a screenshot taken at time t, in any order, so everything on screen is a pure
 * function of t: no CSS transitions or keyframes, no requestAnimationFrame, no timers, no Date,
 * no Math.random (use S.rnd / FOLIO.rnd, which are seeded).
 *
 * World: one coordinate system for every layer — (0,0)–(1920,1080) is the frame when the camera is at
 * rest. A layer's `p` is its parallax: 1 = the subject plane, <1 further away (moves less), >1 in front
 * (moves more, usually blurred). The camera is where it looks (x, y on the subject plane) and how close
 * it is (zoom: a dolly, so far layers grow less than near ones).
 *
 *  FOLIO.scene({ build(S) { … } })          the whole shot program; build may create everything up front
 *  S.dur, S.W, S.H                          the shot's length (s) and the frame (1920×1080)
 *  S.at("phrase", frac=0) → s               when the first word of the phrase is spoken in this shot (fallback frac·dur)
 *  S.end("phrase") → s                      when that phrase ends
 *  S.layer({p:1, blur:0, name, opacity, blend}) → L   a plane: L.g (its <g>), L.defs, L.add(svgMarkup|node) → node
 *                                           draw in world units; later layers are in front
 *  S.cam([{t, x:960, y:540, zoom:1, rot:0, e:"smooth"}, …], "keys"|"pchip")   camera keys (pchip: glide through them)
 *  S.focus([[t, {layerName: blurPx, …}], …])                                   rack focus between layers
 *  S.on(t => …)                             a per-frame updater (write attributes/transforms only)
 *  S.tw(t0, t1, p => …, ease)               an eased 0→1 over [t0, t1], called every frame
 *  S.fade(node, t0, t1, from=0, to=1)       opacity over time
 *  S.div("hud"|"fx"|"top", cls, html)       a screen-space HTML element (prefer the hud.js functions for text)
 *  S.rnd()                                  seeded random in [0,1);  S.cast.<id> — the film's people definitions
 *  data-cover="1" on a <rect>               stretch it over everything its layer shows all shot (skies, walls, paper)
 * Helpers on FOLIO (F): F.el(tag, attrs, parent) · F.svg(markup, parent) → <g> · F.tf(node, {x,y,s,sx,sy,r,ox,oy})
 *   F.lg(L.defs, [c0, c1, …] | [[offset, colour, alpha], …], x1,y1,x2,y2) → "url(#…)" linear gradient (0 0 0 1 = top→bottom)
 *   F.rg(L.defs, stops, cx, cy, r) → radial gradient · F.ink(fill) → its outline colour · F.shade(c, ±k) · F.mix(a, b, p)
 *   F.keys(t, [[t, v], …], ease) · F.pchip(t, [[t, v], …]) · F.seg(t, a, b) · F.lerp · F.clamp · F.noise(x, seed)
 *   F.smooth · F.smoother · F.eOut · F.eIn · F.eBack · F.rnd(seed) · F.hash(str) · F.toScreen(x, y, p) → [sx, sy]
 */
(function () {
  "use strict";
  const F = (window.FOLIO = window.FOLIO || {});
  const W = (F.W = 1920), H = (F.H = 1080);
  const NS = (F.NS = "http://www.w3.org/2000/svg");

  // ── maths ──────────────────────────────────────────────────────────────────────────
  const clamp = (F.clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)));
  const lerp = (F.lerp = (a, b, p) => a + (b - a) * p);
  F.seg = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));
  // smoothstep peaks at 1.5x the average speed — use it for anything that moves the frame
  const smooth = (F.smooth = (p) => { p = clamp(p); return p * p * (3 - 2 * p); });
  F.smoother = (p) => { p = clamp(p); return p * p * p * (p * (6 * p - 15) + 10); };
  F.eOut = (p) => 1 - Math.pow(1 - clamp(p), 3);
  F.eOut5 = (p) => 1 - Math.pow(1 - clamp(p), 5);
  F.eIn = (p) => Math.pow(clamp(p), 3);
  F.eInOut = (p) => { p = clamp(p); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  F.eBack = (p, s = 1.5) => { p = clamp(p) - 1; return p * p * ((s + 1) * p + s) + 1; };
  F.linear = (p) => clamp(p);
  const EASE = (F.EASE = { linear: F.linear, smooth, smoother: F.smoother, out: F.eOut, out5: F.eOut5,
                           in: F.eIn, inout: F.eInOut, back: F.eBack });
  const ease = (F.ease = (e) => (typeof e === "function" ? e : EASE[e || "smooth"] || smooth));

  // seeded random (mulberry32) — F.rnd(seed)() → [0,1)
  F.rnd = (seed) => {
    let a = (seed >>> 0) || 0x9e3779b9;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  F.hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  // smooth 1-D value noise in [-1, 1]
  F.noise = (x, seed = 1) => {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    const r = (n) => { const s = Math.sin((n + seed * 157.31) * 12.9898) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    return lerp(r(i), r(i + 1), u);
  };

  // keys: [[t, v], ...] or [{t, v, e}] — v a number or an array of numbers; e the ease INTO that key
  F.keys = (t, keys, e) => {
    const K = keys.map((k) => (Array.isArray(k) ? { t: k[0], v: k[1], e: k[2] } : k));
    if (!K.length) return 0;
    if (t <= K[0].t) return K[0].v;
    for (let i = 1; i < K.length; i++) {
      if (t <= K[i].t) {
        const a = K[i - 1], b = K[i];
        const p = ease(b.e || e)(F.seg(t, a.t, b.t));
        if (Array.isArray(a.v)) return a.v.map((x, j) => lerp(x, b.v[j], p));
        return lerp(a.v, b.v, p);
      }
    }
    return K[K.length - 1].v;
  };

  // monotone cubic (PCHIP) through [[t, v], ...] — a path through several points without stopping at each
  F.pchip = (t, pts) => {
    const n = pts.length;
    if (n === 1 || t <= pts[0][0]) return pts[0][1];
    if (t >= pts[n - 1][0]) return pts[n - 1][1];
    const h = [], d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) { h[i] = pts[i + 1][0] - pts[i][0]; d[i] = (pts[i + 1][1] - pts[i][1]) / (h[i] || 1e-6); }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
    }
    let i = 0; while (i < n - 2 && t > pts[i + 1][0]) i++;
    const s = (t - pts[i][0]) / h[i], s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * pts[i][1] + (s3 - 2 * s2 + s) * h[i] * m[i] +
           (-2 * s3 + 3 * s2) * pts[i + 1][1] + (s3 - s2) * h[i] * m[i + 1];
  };

  // ── svg ────────────────────────────────────────────────────────────────────────────
  let UID = 0;
  F.uid = (p = "f") => `${p}${++UID}`;
  // F.el("rect", {x:0, ...}, parent) — attributes with camelCase are written as-is
  const el = (F.el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(n);
    return n;
  });
  F.g = (parent, attrs) => el("g", attrs, parent);
  // F.svg(`<path d="…"/>…`) → a <g> holding the parsed markup (world units)
  F.svg = (markup, parent, attrs) => {
    const doc = new DOMParser().parseFromString(`<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink">${markup}</svg>`, "image/svg+xml");
    const err = doc.querySelector("parsererror");
    if (err) throw new Error("FOLIO.svg: bad markup — " + err.textContent.slice(0, 160));
    const g = el("g", attrs, parent);
    for (const c of Array.from(doc.documentElement.childNodes)) g.appendChild(document.importNode(c, true));
    return g;
  };
  // transform helper: F.tf(node, {x, y, s, sx, sy, r, ox, oy})
  F.tf = (n, o) => {
    const x = o.x || 0, y = o.y || 0, r = o.r || 0, sx = o.sx ?? o.s ?? 1, sy = o.sy ?? o.s ?? 1, ox = o.ox || 0, oy = o.oy || 0;
    n.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(3)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${(-ox).toFixed(2)} ${(-oy).toFixed(2)})`);
    return n;
  };
  // colours
  F.hex = (c) => { c = c.replace("#", ""); if (c.length === 3) c = c.split("").map((x) => x + x).join(""); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)); };
  F.rgb = (a) => "#" + a.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
  F.mix = (c1, c2, p) => { const a = F.hex(c1), b = F.hex(c2); return F.rgb(a.map((v, i) => lerp(v, b[i], p))); };
  F.shade = (c, k) => (k < 0 ? F.mix(c, "#000000", -k) : F.mix(c, "#ffffff", k));   // k in [-1, 1]
  F.ink = (c) => F.mix(c, "#1b120c", 0.45);            // the outline colour of a fill: a darker shade, never black

  // gradients live in the layer's <defs>; returns "url(#id)"
  F.linear = F.linear; // (easing, kept)
  F.lg = (defs, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1, extra) => {
    const id = F.uid("lg");
    const g = el("linearGradient", Object.assign({ id, x1, y1, x2, y2 }, extra || {}), defs);
    stops.forEach((s, i) => { const [o, c, a] = Array.isArray(s) ? s : [i / Math.max(1, stops.length - 1), s, 1];
      el("stop", { offset: o, "stop-color": c, "stop-opacity": a ?? 1 }, g); });
    return `url(#${id})`;
  };
  F.rg = (defs, stops, cx = 0.5, cy = 0.5, r = 0.5, extra) => {
    const id = F.uid("rg");
    const g = el("radialGradient", Object.assign({ id, cx, cy, r }, extra || {}), defs);
    stops.forEach((s, i) => { const [o, c, a] = Array.isArray(s) ? s : [i / Math.max(1, stops.length - 1), s, 1];
      el("stop", { offset: o, "stop-color": c, "stop-opacity": a ?? 1 }, g); });
    return `url(#${id})`;
  };
  F.blurFilter = (defs, sd, extra = 0.3) => {
    const id = F.uid("bl");
    const f = el("filter", { id, x: -extra, y: -extra, width: 1 + 2 * extra, height: 1 + 2 * extra, "color-interpolation-filters": "sRGB" }, defs);
    el("feGaussianBlur", { stdDeviation: sd }, f);
    return `url(#${id})`;
  };

  // ── the stage ──────────────────────────────────────────────────────────────────────
  // FOLIO.scene({build(S){…}}) is what a shot's program calls; the page then calls FOLIO.boot(SCENE).
  F.scene = (def) => { F._def = def; };
  // a library registers FOLIO.plugins.push(S => { S.person = … }) — run once per shot, before build()
  F.plugins = F.plugins || [];

  function norm(w) { return String(w).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }

  // a written word as the tokens it is spoken as (both sides of every word match go through this)
  const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
  const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
  const ORDW = { first: "one", second: "two", third: "three", fifth: "five", eighth: "eight", ninth: "nine", twelfth: "twelve",
                 hundredth: "hundred", thousandth: "thousand", millionth: "million" };
  const say = (n) => {
    if (n < 20) return [ONES[n]];
    if (n < 100) return [TENS[Math.floor(n / 10)]].concat(n % 10 ? [ONES[n % 10]] : []);
    if (n < 1000) return [ONES[Math.floor(n / 100)], "hundred"].concat(n % 100 ? say(n % 100) : []);
    for (const [d, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]])
      if (n >= d) return say(Math.floor(n / d)).concat([name], n % d ? say(n % d) : []);
    return [String(n)];
  };
  F.spoken = (word) => {
    const w = String(word).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    const m = w.match(/^(\d{1,3}(?:,\d{3})+|\d+)(st|nd|rd|th|s)?$/);
    if (m) { const n = parseInt(m[1].replace(/,/g, ""), 10); return n < 1e12 ? say(n) : [m[1]]; }
    const out = [];
    for (let t of w.match(/[a-z0-9]+/g) || []) {
      if (t === "and") continue;
      if (ORDW[t]) t = ORDW[t];
      else if (t.endsWith("ieth") && TENS.includes(t.slice(0, -4) + "y")) t = t.slice(0, -4) + "y";
      else if (t.endsWith("th") && ONES.includes(t.slice(0, -2))) t = t.slice(0, -2);
      if (t.length > 4) t = t.replace(/tre(s?)$/, "ter$1");
      if (t.length > 5) t = t.replace(/our(s?|ed|ing)$/, "or$1");
      if (t.length > 6) t = t.replace(/is(e|ed|es|ing)$/, "iz$1");
      out.push(t);
    }
    return out;
  };

  F.boot = async function (SC) {
    const root = document.getElementById("stage");
    // #under: the neighbouring shot's frame, for a sheet that slides over it (cover/wipe) or away from it (reveal)
    // #frame: everything this shot draws — transitions move and blur it as one picture
    // #top:   flashes and whiteouts over everything
    const under = document.createElement("div"); under.id = "under"; root.appendChild(under);
    const frame = document.createElement("div"); frame.id = "frame"; root.appendChild(frame);
    const world = document.createElement("div"); world.id = "world"; frame.appendChild(world);
    const fx = document.createElement("div"); fx.id = "fx"; frame.appendChild(fx);
    const hud = document.createElement("div"); hud.id = "hud"; frame.appendChild(hud);
    const edge = document.createElement("div"); edge.id = "edge"; frame.appendChild(edge);
    const top = document.createElement("div"); top.id = "top"; root.appendChild(top);
    const dirSvg = document.createElementNS(NS, "svg");
    dirSvg.setAttribute("width", "0"); dirSvg.setAttribute("height", "0");
    dirSvg.style.position = "absolute";
    dirSvg.innerHTML = `<filter id="fdir" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feGaussianBlur id="fdirb" stdDeviation="0 0" edgeMode="duplicate"/></filter>`;
    root.appendChild(dirSvg);
    if (SC.under_img) {
      const im = document.createElement("img"); im.src = SC.under_img;
      Object.assign(im.style, { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px" });
      under.appendChild(im);
      await new Promise((ok) => { if (im.complete) ok(); else { im.onload = ok; im.onerror = ok; } });
    }
    const S = (F.S = {
      W, H, dur: +SC.dur || 5, t: 0, sc: SC, seed: F.hash(SC.id || "scene"),
      words: (SC.words || []).map((w) => ({ w: w.w, n: norm(w.w), t0: +w.t0, t1: +w.t1 })),
      layers: [], ups: [], camKeys: [{ t: 0, x: W / 2, y: H / 2, zoom: 1, rot: 0 }], camMode: "keys",
      world, fx, hud, top, under, frame, edge, palette: SC.palette || {}, cast: SC.cast || {},
    });
    S.rnd = F.rnd(S.seed);
    S.in = SC.in || { kind: "cut" };
    S.out = SC.out || { kind: "cut" };

    // time of a phrase: first word of `text` spoken at/after `after` (scene seconds); fallback = frac * dur.
    // Words are compared as they are spoken: "40,000" = "forty thousand", "50th" = "fiftieth", "kilometres" =
    // "kilometers", "and" ignored — so a phrase copied from the script finds the voice's subtitle words.
    const toks = [];                        // spoken tokens of the shot's words: {n, i} (i = the word's index)
    S.words.forEach((w, i) => F.spoken(w.w).forEach((n) => toks.push({ n, i })));
    const findTok = (text, after) => {
      const want = String(text).split(/\s+/).flatMap(F.spoken);
      if (!want.length) return -1;
      for (const n of [Math.min(want.length, 4), 2, 1]) {
        for (let k = 0; k < toks.length; k++) {
          if (S.words[toks[k].i].t0 < after) continue;
          let ok = true;
          for (let j = 0; j < n; j++) {
            const a = toks[k + j], b = want[j];
            if (!a || !(a.n === b || (b.length > 3 && a.n.startsWith(b.slice(0, 4)) && Math.abs(a.n.length - b.length) < 3))) { ok = false; break; }
          }
          if (ok) return k;
        }
        if (want.length <= 1) break;
      }
      return -1;
    };
    S.at = (text, frac = 0, after = -1) => {
      const k = findTok(text, after);
      return k < 0 ? frac * S.dur : S.words[toks[k].i].t0;
    };
    // when a phrase ENDS
    S.end = (text, frac = 1) => {
      const k = findTok(text, -1);
      if (k < 0) return frac * S.dur;
      const want = String(text).split(/\s+/).flatMap(F.spoken);
      const last = toks[Math.min(toks.length - 1, k + want.length - 1)];
      return S.words[last.i].t1;
    };
    S.on = (fn) => { S.ups.push(fn); return fn; };
    // S.tw(t0, t1, p => …, ease) — called every frame with the eased progress (0 before, 1 after)
    S.tw = (t0, t1, fn, e = "smooth") => S.on((t) => fn(ease(e)(F.seg(t, t0, t1)), t));
    S.fade = (node, t0, t1, a = 0, b = 1, e = "smooth") => S.tw(t0, t1, (p) => { node.style.opacity = lerp(a, b, p).toFixed(3); }, e);

    // a layer: its own <div> + <svg>; S.layer({p: .3, blur: 6, name: "sky"})
    S.layer = (o = {}) => {
      const div = document.createElement("div"); div.className = "layer";
      const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, overflow: "visible" });
      div.appendChild(svg); world.appendChild(div);
      const defs = el("defs", null, svg);
      const g = el("g", null, svg);
      const L = { div, svg, defs, g, p: o.p ?? 1, blur: o.blur || 0, name: o.name || `L${S.layers.length}`,
                  opacity: o.opacity ?? 1, blend: o.blend, fixed: !!o.fixed };
      if (o.blend) div.style.mixBlendMode = o.blend;
      L.add = (x) => { if (typeof x === "string") return F.svg(x, g); g.appendChild(x); return x; };
      L.group = (attrs) => el("g", attrs, g);
      S.layers.push(L);
      return L;
    };
    // an html plate in screen space (for text): S.plate("hud"|"top"|"fx")
    S.div = (where = "hud", cls = "", html = "") => {
      const d = document.createElement("div"); d.className = "abs " + cls; d.innerHTML = html;
      ({ hud, top, fx, under }[where] || hud).appendChild(d); return d;
    };

    // ── camera ───────────────────────────────────────────────────────────────────────
    // S.cam([{t, x, y, zoom, rot, e}], "keys"|"pchip") — x,y the point on the subject plane at frame centre
    S.cam = (keys, mode = "keys") => {
      S.camKeys = keys.map((k) => Object.assign({ x: W / 2, y: H / 2, zoom: 1, rot: 0 }, k));
      S.camMode = mode; return S;
    };
    S.camAt = (t) => {
      const K = S.camKeys;
      const f = (key) => (S.camMode === "pchip" && K.length > 2
        ? F.pchip(t, K.map((k) => [k.t, k[key]]))
        : F.keys(t, K.map((k) => ({ t: k.t, v: k[key], e: k.e }))));
      return { x: f("x"), y: f("y"), zoom: f("zoom"), rot: f("rot") };
    };
    // focus pulls: S.focus([[t, {layerName: blurPx, …}], …])
    S.focusKeys = null;
    S.focus = (keys) => { S.focusKeys = keys; return S; };

    // user program
    try {
      const def = F._def;
      if (!def || typeof def.build !== "function") throw new Error("the scene program never called FOLIO.scene({build(S){…}})");
      if (F.fonts) await F.fonts();
      for (const pl of F.plugins) pl(S);          // libraries add their S.* helpers (people, sets, hud …)
      await def.build(S);
      if (F.afterBuild) F.afterBuild(S);
      F.cover(S);
    } catch (e) {
      window.__err = String((e && e.stack) || e).slice(0, 1200);
    }
    window.__ready = true;
  };

  // ── transitions made inside the shot ─────────────────────────────────────────────
  // move = how long the shot's own part of the move lasts; d = the dissolve the assembler lays over the cut
  // (the shot is rendered d/2 past its cut, the next one from d/2 before it). Kinds without a move are
  // plain dissolves (dissolve), drawn overlays (bloom, whiteout — fx.js) or a hard cut.
  const TR = (F.TR = {
    cut: { d: 0 }, dissolve: { d: 0.6 }, defocus: { move: 0.55, d: 0.45 }, bloom: { d: 0.4 }, whiteout: { move: 0.9, d: 0.3 },
    whip: { move: 0.32, d: 0.12 }, tilt: { move: 0.32, d: 0.12 }, push: { move: 0.5, d: 0.16 },
    cover: { move: 0.4, d: 0 }, reveal: { move: 0.4, d: 0 }, wipe: { move: 0.36, d: 0 },
  });
  F.trSpec = (o) => Object.assign({}, TR[(o && o.kind) || "cut"] || TR.cut, o || {});

  // the camera part: whip/tilt slide the view a third of a screen, push dollies in
  function camWithTransitions(S, t, c) {
    const out = Object.assign({}, c);
    const ti = F.trSpec(S.in), to = F.trSpec(S.out);
    const slide = (spec, p) => {
      if (spec.kind === "whip") out.x += (spec.dir === "left" ? -1 : 1) * p * W * 0.34;
      if (spec.kind === "tilt") out.y += (spec.dir === "up" ? -1 : 1) * p * H * 0.34;
    };
    if (ti.move && (ti.kind === "whip" || ti.kind === "tilt")) slide(ti, -(1 - F.eOut(F.seg(t, 0, ti.move))));
    if (to.move && (to.kind === "whip" || to.kind === "tilt")) slide(to, F.eIn(F.seg(t, S.dur - to.move, S.dur)));
    if (ti.kind === "push") out.zoom *= 1 + 0.32 * (1 - F.eOut(F.seg(t, 0, ti.move)));
    if (to.kind === "push") {
      const p = F.eIn(F.seg(t, S.dur - to.move, S.dur));
      out.zoom *= 1 + 1.3 * p;
      if (to.x != null) { out.x = lerp(out.x, to.x, F.smooth(p)); out.y = lerp(out.y, to.y ?? out.y, F.smooth(p)); }
    }
    return out;
  }

  // the picture part: blur, slide and fade of the whole #frame
  function frameTransitions(S, t) {
    const ti = F.trSpec(S.in), to = F.trSpec(S.out);
    let bx = 0, by = 0, iso = 0, tx = 0, ty = 0, hudOp = 1, underOn = false, shadow = "";
    const pin = (spec) => 1 - F.eOut(F.seg(t, 0, spec.move));                 // 1 → 0 at the start
    const pout = (spec) => F.eIn(F.seg(t, S.dur - spec.move, S.dur));         // 0 → 1 at the end
    for (const [spec, p] of [[ti, ti.move ? pin(ti) : 0], [to, to.move ? pout(to) : 0]]) {
      if (!spec.move || p <= 0) continue;
      if (spec.kind === "whip") bx = Math.max(bx, 70 * p);
      if (spec.kind === "tilt") by = Math.max(by, 60 * p);
      if (spec.kind === "push") { iso = Math.max(iso, (spec === to ? 16 : 12) * p); hudOp = Math.min(hudOp, 1 - p); }
      if (spec.kind === "defocus" && spec === to) { iso = Math.max(iso, 18 * p); hudOp = Math.min(hudOp, 1 - p); }
    }
    // a sheet sliding over the previous shot (cover: up from below; wipe: in from the right) …
    if ((ti.kind === "cover" || ti.kind === "wipe") && S.sc.under_img) {
      const p = 1 - F.eOut(F.seg(t, 0, ti.move));
      if (p > 0) {
        underOn = true;
        if (ti.kind === "cover") { ty = p * H; shadow = "0 -18px 40px rgba(40,25,10,.35)"; }
        else { tx = p * W; shadow = "-22px 0 44px rgba(20,12,6,.45)"; }
      }
    }
    // … or sliding away from the next one (reveal: down and out)
    if (to.kind === "reveal" && S.sc.under_img) {
      const p = F.eIn(F.seg(t, S.dur - to.move, S.dur));
      if (p > 0) { underOn = true; ty = p * (H + 60); shadow = "0 -18px 40px rgba(40,25,10,.35)"; }
    }
    return { bx, by, iso, tx, ty, hudOp, underOn, shadow };
  }

  F.shutterAt = (t) => {
    const S = F.S; if (!S) return 1;
    const ti = F.trSpec(S.in), to = F.trSpec(S.out);
    const fast = (k) => k === "whip" || k === "tilt" || k === "push";
    if (fast(ti.kind) && t < ti.move) return 5;
    if (fast(to.kind) && t > S.dur - to.move) return 5;
    return (S.shutter && S.shutter(t)) || 1;
  };

  // ── one frame ────────────────────────────────────────────────────────────────────
  F.frame = function (t) {
    const S = F.S; if (!S) return;
    S.t = t;
    const c = camWithTransitions(S, t, S.camAt(t));
    let focus = null;
    if (S.focusKeys) {
      const K = S.focusKeys; let a = K[0], b = K[K.length - 1];
      for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { a = K[i - 1]; b = K[i]; break; }
      const p = smooth(F.seg(t, a[0], b[0]));
      focus = {}; const names = new Set([...Object.keys(a[1]), ...Object.keys(b[1])]);
      names.forEach((n) => { focus[n] = lerp(a[1][n] ?? 0, b[1][n] ?? 0, p); });
    }
    for (const L of S.layers) {
      if (!L.fixed) {
        const p = L.p, s = 1 + (c.zoom - 1) * p;
        const cx = W / 2 + (c.x - W / 2) * p, cy = H / 2 + (c.y - H / 2) * p;
        L.div.style.transform = `translate(${W / 2}px, ${H / 2}px) rotate(${c.rot * p}deg) scale(${s.toFixed(5)}) translate(${(-cx).toFixed(2)}px, ${(-cy).toFixed(2)}px)`;
      }
      let b = L.blur;
      if (focus && focus[L.name] != null) b = focus[L.name];
      const bt = b > 0.2 ? `blur(${b.toFixed(2)}px)` : "";
      if (L._bt !== bt) { L.div.style.filter = bt; L._bt = bt; }
      if (L._op !== L.opacity) { L.div.style.opacity = L.opacity; L._op = L.opacity; }
    }
    S.camNow = c;
    for (const fn of S.ups) fn(t, c);

    // transitions on the whole picture
    const tr = frameTransitions(S, t);
    const fr = S.frame;
    const key = `${tr.bx.toFixed(1)}|${tr.by.toFixed(1)}|${tr.iso.toFixed(1)}`;
    if (fr._fk !== key) {
      fr._fk = key;
      if (tr.bx > 0.3 || tr.by > 0.3) {
        document.getElementById("fdirb").setAttribute("stdDeviation", `${tr.bx.toFixed(1)} ${tr.by.toFixed(1)}`);
        fr.style.filter = "url(#fdir)" + (tr.iso > 0.3 ? ` blur(${tr.iso.toFixed(1)}px)` : "");
      } else fr.style.filter = tr.iso > 0.3 ? `blur(${tr.iso.toFixed(1)}px)` : "";
    }
    // a blurred frame is scaled a touch so its soft edges fall outside the picture
    const grow = 1 + 0.0007 * Math.max(tr.bx, tr.by) + 0.0025 * tr.iso;
    fr.style.transform = (tr.tx || tr.ty ? `translate(${tr.tx.toFixed(1)}px, ${tr.ty.toFixed(1)}px) ` : "") +
      (grow > 1.0005 ? `scale(${grow.toFixed(4)})` : "");
    fr.style.boxShadow = tr.shadow;
    S.hud.style.opacity = tr.hudOp < 1 ? tr.hudOp.toFixed(3) : "";
    S.under.style.display = tr.underOn ? "block" : "none";
  };

  // Backgrounds never show their edge: after build, every element marked data-cover="1" (a sky, a sheet of
  // paper, a wall) is stretched over everything its layer shows during the whole shot, camera moves and
  // transition moves included.
  F.cover = (S) => {
    const N = 48, spans = new Map();
    for (let i = 0; i <= N; i++) {
      const t = (S.dur * i) / N, c = camWithTransitions(S, t, S.camAt(t));
      for (const L of S.layers) {
        const p = L.fixed ? 0 : L.p, s = 1 + (c.zoom - 1) * p;
        const cx = W / 2 + (c.x - W / 2) * p, cy = H / 2 + (c.y - H / 2) * p;
        const r = Math.hypot(W, H) / 2 / Math.max(0.05, s);           // generous: covers any camera roll too
        const hw = c.rot ? r : W / 2 / Math.max(0.05, s), hh = c.rot ? r : H / 2 / Math.max(0.05, s);
        const b = spans.get(L) || [1e9, 1e9, -1e9, -1e9];
        spans.set(L, [Math.min(b[0], cx - hw), Math.min(b[1], cy - hh), Math.max(b[2], cx + hw), Math.max(b[3], cy + hh)]);
      }
    }
    for (const L of S.layers) {
      const b = spans.get(L); if (!b) continue;
      const m = 80 + 40 * (L.blur || 0);
      L.svg.querySelectorAll("[data-cover]").forEach((n) => {
        const x0 = Math.min(b[0] - m, +(n.getAttribute("x") || 0)), y0 = Math.min(b[1] - m, +(n.getAttribute("y") || 0));
        const x1 = Math.max(b[2] + m, +(n.getAttribute("x") || 0) + +(n.getAttribute("width") || 0));
        const y1 = Math.max(b[3] + m, +(n.getAttribute("y") || 0) + +(n.getAttribute("height") || 0));
        if (n.getAttribute("data-cover") === "x") { n.setAttribute("x", x0); n.setAttribute("width", x1 - x0); }
        else { n.setAttribute("x", x0); n.setAttribute("y", y0); n.setAttribute("width", x1 - x0); n.setAttribute("height", y1 - y0); }
      });
      L.cover = b;
    }
  };

  // the on-screen scale of a layer right now (1 at rest) — for things that keep their screen size
  F.layerScale = (L) => { const c = F.S.camNow || F.S.camAt(F.S.t); return 1 + (c.zoom - 1) * (L.fixed ? 0 : L.p); };

  // world → screen for a point on a layer of parallax p (for labels that follow a character)
  F.toScreen = (x, y, p = 1) => {
    const S = F.S, c = S.camNow || S.camAt(S.t);
    const s = 1 + (c.zoom - 1) * p;
    const cx = W / 2 + (c.x - W / 2) * p, cy = H / 2 + (c.y - H / 2) * p;
    return [W / 2 + (x - cx) * s, H / 2 + (y - cy) * s, s];
  };

  window.renderFrame = (t) => F.frame(t);
  window.__shutter = (t) => F.shutterAt(t);
})();
