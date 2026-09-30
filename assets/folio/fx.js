/* FOLIO — fx: light, air and the transitions drawn inside a shot.
 *
 *  S.glow(L, {x, y, r=220, color="#FFD9A0", a=.85, pulse=0})       a soft light bloom (screen blend) — lamps, sun, windows
 *  S.rays(L, {x, y, angle=110, spread=26, len=1400, color="#FFE7B8", a=.22, sway=0})  a light shaft from a window/opening
 *  S.motes(L, {x, y, w, h, n=40, color="#FFF3D6", size=[2,6], drift=14, seed})       dust floating in the light
 *  S.bokeh(L, {n=14, area:[x,y,w,h], colors:["#FFE2A8","#FFFFFF"], size:[40,140], a=.22, seed, hex=true})  defocused lights
 *  S.fog(L, {y=700, h=380, color="#FFFFFF", a=.55})                 a horizontal haze band (distance, mist)
 *  S.sparkle(L, {x, y, t, size=60})                                 a four-point glint at time t
 *  S.vignette(a=.28)                                                darker corners (screen space)
 *  S.flash({tc, rise=.35, fall=.45, x=960, y=540, color="#FFF1D8"})  a warm bloom over the whole frame, peaking at time tc
 *  S.whiteout({t0, t1, dir:"in"|"out"})                             cloud bank rising to white (out) or clearing (in)
 *  S.speed(L, {angle=0, n=18, color="#FFFFFF", a=.35, t0, t1})      thin speed streaks (a fast move, wind)
 *
 *  Transitions: a shot whose SCENE.in / SCENE.out kind is "bloom" or "whiteout" gets the matching overlay
 *  automatically (bloom starts from the key light: SCENE.out.x/y, default frame centre).
 */
(function () {
  "use strict";
  const F = window.FOLIO;
  const W = F.W, H = F.H;

  F.plugins.push((S) => {
    const rnd = (seed) => F.rnd(seed ?? (S.seed + 7));

    S.glow = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 540, r = o.r ?? 220, color = o.color || "#FFD9A0", a = o.a ?? 0.85;
      const fill = F.rg(L.defs, [[0, color, a], [0.25, color, a * 0.55], [0.6, color, a * 0.14], [1, color, 0]]);
      const c = F.el("circle", { cx: x, cy: y, r, fill, style: "mix-blend-mode:screen" }, L.g);
      if (o.pulse) {
        const seed = F.hash("glow" + x + y);
        S.on((t) => { c.setAttribute("opacity", (1 + o.pulse * F.noise(t * 3.1, seed)).toFixed(3)); });
      }
      return c;
    };

    S.rays = (L, o = {}) => {
      const x = o.x ?? 300, y = o.y ?? 0, ang = ((o.angle ?? 110) * Math.PI) / 180, spread = ((o.spread ?? 26) * Math.PI) / 180;
      const len = o.len ?? 1400, color = o.color || "#FFE7B8", a = o.a ?? 0.22;
      const g = F.el("g", { style: "mix-blend-mode:screen" }, L.g);
      const id = F.uid("ray");
      const grad = F.el("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: x, y1: y,
        x2: x + Math.cos(ang) * len, y2: y + Math.sin(ang) * len }, L.defs);
      [[0, a], [0.55, a * 0.5], [1, 0]].forEach(([o2, op]) => F.el("stop", { offset: o2, "stop-color": color, "stop-opacity": op }, grad));
      const w0 = o.w0 ?? 30;
      const pts = (sp) => {
        const ax = x + Math.cos(ang + Math.PI / 2) * w0, ay = y + Math.sin(ang + Math.PI / 2) * w0;
        const bx = x - Math.cos(ang + Math.PI / 2) * w0, by = y - Math.sin(ang + Math.PI / 2) * w0;
        const cx = x + Math.cos(ang + sp / 2) * len, cy = y + Math.sin(ang + sp / 2) * len;
        const dx = x + Math.cos(ang - sp / 2) * len, dy = y + Math.sin(ang - sp / 2) * len;
        return `${ax},${ay} ${cx},${cy} ${dx},${dy} ${bx},${by}`;
      };
      const poly = F.el("polygon", { points: pts(spread), fill: `url(#${id})` }, g);
      const blur = F.blurFilter(L.defs, o.soft ?? 18);
      poly.setAttribute("filter", blur);
      if (o.sway) S.on((t) => poly.setAttribute("opacity", (0.85 + 0.15 * F.noise(t * 0.7, 3)).toFixed(3)));
      return g;
    };

    S.motes = (L, o = {}) => {
      const R = rnd(o.seed), n = o.n ?? 40, x = o.x ?? 0, y = o.y ?? 0, w = o.w ?? W, h = o.h ?? H;
      const [s0, s1] = o.size || [2, 6], color = o.color || "#FFF3D6", drift = o.drift ?? 14;
      const g = F.el("g", { style: "mix-blend-mode:screen" }, L.g);
      const ms = [];
      for (let i = 0; i < n; i++) {
        const m = { x: x + R() * w, y: y + R() * h, r: F.lerp(s0, s1, R() * R()), ph: R() * 100, sp: 0.4 + R() * 0.8,
                    a: 0.35 + R() * 0.6 };
        m.c = F.el("circle", { r: m.r, fill: color }, g);
        ms.push(m);
      }
      S.on((t) => {
        for (const m of ms) {
          const dx = F.noise(t * 0.25 * m.sp + m.ph, 11) * drift * 2 + t * drift * 0.3 * m.sp;
          const dy = F.noise(t * 0.22 * m.sp + m.ph, 29) * drift * 2 - t * drift * 0.25;
          let yy = m.y + dy, xx = m.x + dx;
          yy = y + ((((yy - y) % h) + h) % h); xx = x + ((((xx - x) % w) + w) % w);
          const tw = 0.55 + 0.45 * Math.sin(t * (1.3 + m.sp) + m.ph);
          m.c.setAttribute("cx", xx.toFixed(1)); m.c.setAttribute("cy", yy.toFixed(1));
          m.c.setAttribute("opacity", (m.a * tw).toFixed(3));
        }
      });
      return g;
    };

    S.bokeh = (L, o = {}) => {
      const R = rnd(o.seed), n = o.n ?? 14, [ax, ay, aw, ah] = o.area || [-100, -100, W + 200, H + 200];
      const [s0, s1] = o.size || [40, 140], cols = o.colors || ["#FFE2A8", "#FFFFFF", "#FFD28A"], a = o.a ?? 0.22;
      const g = F.el("g", { style: "mix-blend-mode:screen" }, L.g);
      const bs = [];
      for (let i = 0; i < n; i++) {
        const r = F.lerp(s0, s1, R()), cx = ax + R() * aw, cy = ay + R() * ah, col = cols[i % cols.length];
        let shape;
        if (o.hex !== false) {
          const pts = []; const rot = R() * Math.PI;
          for (let k = 0; k < 6; k++) pts.push(`${(Math.cos(rot + (k * Math.PI) / 3) * r).toFixed(1)},${(Math.sin(rot + (k * Math.PI) / 3) * r).toFixed(1)}`);
          shape = F.el("polygon", { points: pts.join(" ") }, g);
        } else shape = F.el("circle", { r }, g);
        shape.setAttribute("fill", F.rg(L.defs, [[0, col, a * 0.8], [0.8, col, a], [1, col, a * 0.25]]));
        bs.push({ el: shape, cx, cy, ph: R() * 50, sp: 0.2 + R() * 0.3 });
      }
      S.on((t) => {
        for (const b of bs) {
          const dx = F.noise(t * b.sp + b.ph, 5) * 12, dy = F.noise(t * b.sp + b.ph, 9) * 9;
          b.el.setAttribute("transform", `translate(${(b.cx + dx).toFixed(1)} ${(b.cy + dy).toFixed(1)})`);
        }
      });
      return g;
    };

    S.fog = (L, o = {}) => {
      const y = o.y ?? 700, h = o.h ?? 380, color = o.color || "#FFFFFF", a = o.a ?? 0.55, span = o.span ?? 1400;
      const fill = F.lg(L.defs, [[0, color, 0], [0.5, color, a], [1, color, 0]]);
      return F.el("rect", { x: -span, y: y - h / 2, width: W + 2 * span, height: h, fill }, L.g);
    };

    S.sparkle = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 540, t0 = o.t ?? 1, sz = o.size ?? 60;
      const g = F.el("g", { style: "mix-blend-mode:screen", opacity: 0 }, L.g);
      F.el("path", { d: `M0 ${-sz} Q2 -2 ${sz} 0 Q2 2 0 ${sz} Q-2 2 ${-sz} 0 Q-2 -2 0 ${-sz}Z`, fill: "#FFFFFF" }, g);
      F.el("circle", { r: sz * 0.35, fill: F.rg(L.defs, [[0, "#FFFFFF", 0.9], [1, "#FFFFFF", 0]]) }, g);
      S.on((t) => {
        const p = F.seg(t, t0 - 0.12, t0 + 0.45), k = p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75;
        g.setAttribute("opacity", Math.max(0, k).toFixed(3));
        g.setAttribute("transform", `translate(${x} ${y}) rotate(${(p * 40).toFixed(1)}) scale(${(0.4 + 0.6 * k).toFixed(3)})`);
      });
      return g;
    };

    S.speed = (L, o = {}) => {
      const R = rnd(o.seed), n = o.n ?? 18, ang = o.angle ?? 0, color = o.color || "#FFFFFF", a = o.a ?? 0.35;
      const g = F.el("g", { transform: `rotate(${ang} 960 540)`, opacity: 0 }, L.g);
      const ls = [];
      for (let i = 0; i < n; i++) {
        const y = R() * H, len = 180 + R() * 520, w = 1 + R() * 2.5;
        ls.push({ el: F.el("rect", { y, height: w, width: len, rx: w / 2, fill: color, opacity: (0.3 + R() * 0.7) * a }, g), len, ph: R() });
      }
      const t0 = o.t0 ?? 0, t1 = o.t1 ?? S.dur;
      S.on((t) => {
        g.setAttribute("opacity", (F.seg(t, t0, t0 + 0.2) * (1 - F.seg(t, t1 - 0.2, t1))).toFixed(3));
        for (const l of ls) l.el.setAttribute("x", ((((l.ph * 2600 - t * 2400) % 2600) + 2600) % 2600 - 400).toFixed(0));
      });
      return g;
    };

    // ── screen-space overlays ──────────────────────────────────────────────────────
    const plate = (where, css) => { const d = S.div(where); Object.assign(d.style, { left: 0, top: 0, width: W + "px", height: H + "px" }, css || {}); return d; };

    S.vignette = (a = 0.28) =>
      plate("fx", { background: `radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(20,12,6,${a}) 100%)` });

    // a warm bloom that peaks at tc (rising over `rise` s before it, falling over `fall` s after)
    S.flash = (o = {}) => {
      const x = o.x ?? W / 2, y = o.y ?? H / 2, color = o.color || "#FFF1D8", tc = o.tc ?? 0.5;
      const rise = o.rise ?? 0.35, fall = o.fall ?? 0.45;
      const d = plate("top", { mixBlendMode: "screen", opacity: 0 });
      const c = F.hex(color).join(",");
      S.on((t) => {
        const k = t <= tc ? F.smooth(F.seg(t, tc - rise, tc)) : 1 - F.smooth(F.seg(t, tc, tc + fall));
        if (k <= 0.001) { d.style.opacity = 0; return; }
        const r = 30 + 110 * k;
        d.style.background = `radial-gradient(circle at ${x}px ${y}px, rgba(${c},1) 0%, rgba(${c},${(0.95 * k).toFixed(3)}) ${(r * 0.35).toFixed(1)}%, rgba(${c},${(0.7 * k).toFixed(3)}) ${r.toFixed(1)}%, rgba(${c},${(0.55 * k).toFixed(3)}) 100%)`;
        d.style.opacity = k.toFixed(3);
      });
      return d;
    };

    // a cloud bank that rises until the frame is white (dir "out", white from t1 on),
    // or white until t0 and then clearing by t1 (dir "in")
    S.whiteout = (o = {}) => {
      const t0 = o.t0 ?? 0, t1 = o.t1 ?? 0.9, dirIn = o.dir === "in";
      const d = plate("top", { opacity: 0 });
      const svg = F.el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
      d.appendChild(svg);
      const defs = F.el("defs", null, svg);
      const blur = F.blurFilter(defs, 22, 0.5);
      const R = F.rnd(S.seed + 31);
      const bank = F.el("g", { filter: blur }, svg);
      for (let i = 0; i < 16; i++) {
        F.el("ellipse", { cx: -100 + R() * 2120, cy: 40 + R() * 200, rx: 180 + R() * 260, ry: 120 + R() * 140, fill: "#FFFFFF" }, bank);
      }
      F.el("rect", { x: -200, y: 180, width: W + 400, height: H * 2, fill: "#FFFFFF" }, bank);
      const wash = F.el("rect", { x: 0, y: 0, width: W, height: H, fill: "#FFFFFF", opacity: 0 }, svg);
      S.on((t) => {
        const q = F.seg(t, t0, t1);
        if (!dirIn) {                       // the bank rises into the frame until it is white
          const e = F.smooth(q);
          d.style.opacity = q > 0 ? 1 : 0;
          bank.setAttribute("transform", `translate(0 ${(H + 60 - e * (H + 420)).toFixed(1)})`);
          wash.setAttribute("opacity", F.smooth(F.seg(q, 0.55, 1)).toFixed(3));
        } else {                            // it keeps rising and leaves through the top while the white thins
          const e = F.smooth(q);
          d.style.opacity = q < 1 ? 1 : 0;
          bank.setAttribute("transform", `translate(0 ${(-360 - e * (H + 700)).toFixed(1)})`);
          wash.setAttribute("opacity", (1 - F.smooth(F.seg(q, 0, 0.3))).toFixed(3));
        }
      });
      return d;
    };
  });

  // automatic transition overlays. The cut sits d/2 before the end of the outgoing shot and d/2 after the
  // start of the incoming one; both draw the same overlay around it, so the dissolve over it is invisible.
  const prevAfter = F.afterBuild;
  F.afterBuild = (S) => {
    if (prevAfter) prevAfter(S);
    const ti = F.trSpec(S.in), to = F.trSpec(S.out);
    if (ti.kind === "bloom") S.flash({ tc: ti.d / 2, x: ti.x, y: ti.y, color: ti.color });
    if (to.kind === "bloom") S.flash({ tc: S.dur - to.d / 2, x: to.x, y: to.y, color: to.color });
    if (ti.kind === "whiteout") S.whiteout({ t0: ti.d / 2, t1: ti.d / 2 + 0.6, dir: "in" });
    if (to.kind === "whiteout") S.whiteout({ t0: S.dur - to.d / 2 - to.move, t1: S.dur - to.d / 2, dir: "out" });
  };
})();
