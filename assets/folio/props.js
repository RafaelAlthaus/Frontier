/* FOLIO — props: the objects narrations name (S.prop.*). Needs sets.js (FOLIO.kit) loaded first.
 *
 * HOW TO USE
 *  • S.prop.name(L, {x, y, s | h | w, r, flip, far, air, parent, shadow}) draws into layer L and returns
 *    {g, …anchors} in layer coordinates. (x, y) is the prop's BASE — where it stands on the floor/table/ground —
 *    unless noted. s = 1 is life size on the subject plane where a person is ~540 px tall (≈ 300 px per metre);
 *    or give h (height px) / w (width px). r rotates (degrees), flip mirrors (faces left), far/air fade it with
 *    distance, shadow: false drops the soft contact shadow. Outlines stay the same thin weight at any size.
 *  • Put a prop on a table: const t = S.prop.table(L, {x: 900, y: 1000}); S.prop.lamp(L, {x: t.top[0], y: t.top[1]}).
 *  • Motion is built in: flames and glows flicker, wheels turn (spin: turns/s, or move: {x0, x1, t0, t1, y} to roll
 *    along and turn in step), ships rock (rock: degrees) on a strip of waves (water: false to drop it), oars row,
 *    horses and camels walk (walk: strides/s, or with move), birds flap (flap: Hz) or soar, flags flutter, smoke
 *    rises, the globe and the Earth turn (spin: °/s), the toy's rotors spin up (spin: [[t, turns/s], …]).
 *
 * WRITING & LIGHT
 *  book({state: closed|lying|open|stack, color, colors, title}) → {top}
 *  scroll({open: 0…1 (0 = one rolled scroll with a tie), len: 300, color}) → {center, set(p), open(t0, t1, from, to)}
 *  inkpot({quill: true, color}) → {top, tip}           quill = inkpot
 *  map({seed, curl: true}) → {center}                  letter({kind: envelope|sheet, seal: true}) → {center}
 *  coins({n: 6, metal: gold|silver|bronze, loose: 3, glint: true}) → {top}
 *  lamp({kind: parlour (brass, glowing globe — the reference's lamp) | ancient (clay oil lamp) | desk (green shade) |
 *        hanging (shade on a cord; drop), lit: true, glow}) → {flame, glow}
 *  candle({lit, holder: true, len: 80, glow}) → {flame}      torch({lit, bracket, smoke: true, glow}) → {flame}
 *  lantern({kind: hand|ship, lit: true}) → {flame, handle}
 *
 * FURNITURE & CONTAINERS
 *  table({kind: work|round (fringed cloth: cloth colour, cloth: false = bare)|desk|ancient, color}) → {top, left, right,
 *        surface(u) point along the top, u 0…1}
 *  chair({kind: wood|armchair|stool, color, fabric}) side view, faces right → {seat}
 *  crate({label}) → {top}   barrel() → {top}   basket({contents: fruit|bread|fish|scrolls|grain|none}) → {top}
 *  amphora({kind: amphora|jar|pithos|hydria, color, pattern: true}) → {top}      jar = amphora kind jar
 *  tent({kind: a-frame (canvas, Kitty Hawk)|bell|bedouin, color}) → {door, ridge}
 *  rope({from: [x,y], to: [x,y], sag: 60, width: 4})  or rope({coil: true, x, y})     ladder({lean: 14}) → {top}
 *
 * SCIENCE & MEASUREMENT
 *  gnomon({x, y, h: 320, kind: rod|obelisk, sun: {elev°, dir°}, view: side|above, tilt: .3, ray, angle, track})
 *        dir = where the SHADOW points on the ground: 0 right, 90 toward us, 180 left, 270 away; its length is
 *        h / tan(elev). ray: the sun's ray through the tip; angle: arc between rod and ray (angle = 90 − elev; 82.8 →
 *        7.2°, Eratosthenes). → {base, top, tip (shadow end), length, angle, arcAt, setSun(elev, dir),
 *        track([{t, elev, dir}, …])}
 *  sundial({hour: 10, lat: 31}) → {setHour(h), track([[t, hour], …])}
 *  rod({x, y (centre), len: 600, r (deg), units: 10, color, color2}) → {a, b} ends   measuringRod = rod
 *  abacus({rows: 7, beads: 10, values: [..]}) → {set(values), slide(t0, t1, from, to)}
 *  globe({spin: °/s, lon}) → {center}     telescope({angle: 32}) → {eyepiece, lens}
 *  compass({kind: magnetic (needle settles with a wobble; needle: heading°) | dividers (open: 24°)}) → {center | a, b}
 *
 * VEHICLES (side views, facing right; flip for left)
 *  ship({kind: merchant|galley|galleon|felucca|steamer, x, y = WATERLINE, rock: 1.2, water: true, waterColor, sail,
 *        stripes, sailColor, stripe, flag, funnel, row: .55 (galley stroke rate)}) → {deck}     galley = ship galley
 *  cart({kind: cart|wagon|chariot, load: hay|barrels|crates, cover (wagon), paint (chariot), spin | move}) → {hitch, seat}
 *  bicycle({color, spin | move}) → {seat, bars, pedal, front, rear}   (c. 1900 safety bicycle)
 *  airliner({view: below (climbing overhead, r default −35)|side, contrail: true, glint, move}) → {nose, tail}
 *  satellite({kind: panels|sputnik, spin: °/s, move}) → {center}
 *
 * ANIMALS & TOYS
 *  horse({color: bay|chestnut|grey|black|white|dun|"#hex", walk | move, harness}) → {back (saddle), head, nose, hitch}
 *  camel({color, walk | move, saddle: true|"#hex"}) → {back (hump), head, nose}
 *  bird({kind: hawk|gull, x, y (centre), flap: Hz (0 = soar and bank slowly), bank°, path: [[t, x, y], …]}) → {center, tips}
 *        seen from below with wings spread (the soaring buzzard)
 *  flock({n: 7, area: [x, y, w, h], s, flap: 2.2, drift: [vx, vy], color})   distant "m" birds flapping
 *  toy({kind: helicopter (Pénaud's bamboo-cork-paper "bat"; spin turns/s or [[t, v], …], blurs into discs when fast) |
 *        kite}) → {top, hand | bridle}
 *  shadow({x, y, w: 200, h, a: .35})   a soft contact shadow ellipse
 */
(function () {
  "use strict";
  const F = window.FOLIO;
  const W = F.W, H = F.H;
  const K = F.kit;
  if (!K) { console.warn("props.js needs sets.js (FOLIO.kit) loaded first"); return; }
  const f1 = K.f1, clamp = F.clamp, lerp = F.lerp, D = Math.PI / 180;

  F.plugins.push((S) => {
    const prop = (S.prop = S.prop || {});
    const airOf = (o) => o.air || K.defaultAir;

    // every prop: a group at (x, y) — its base unless noted — rotated r°, scaled s (or sized by h/w against its
    // native size), mirrored by flip; draws in local units where 1 ≈ 1 px at s = 1 (≈ 300 px per metre)
    function start(L, o, cls, native, nativeW) {
      const s = o.h ? o.h / native : o.w && nativeW ? o.w / nativeW : o.s ?? 1;
      const x = o.x ?? 960, y = o.y ?? 900, r = o.r || 0, fx = o.flip ? -1 : 1;
      const outer = F.el("g", { class: cls }, o.parent || L.g);
      const g = F.el("g", { transform: `translate(${f1(x)} ${f1(y)}) rotate(${f1(r)}) scale(${(s * fx).toFixed(4)} ${s.toFixed(4)})` }, outer);
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 2 * (o.far ? 1 - 0.5 * o.far : 1), line: o.line });
      const ca = Math.cos(r * D), sa = Math.sin(r * D);
      const at = (lx, ly) => { const X = lx * s * fx, Y = ly * s; return [x + X * ca - Y * sa, y + X * sa + Y * ca]; };
      if (o.shadow !== false && o.shadowW !== 0 && !o.noShadow && o._shadow !== false) {
        // callers draw their own contact shadow when they want one (see shadow())
      }
      return { P, g, outer, s, x, y, at, fx };
    }
    const soft = (L, parent, cx, cy, rx, ry, color, a, shape) =>
      F.el("ellipse", { cx: f1(cx), cy: f1(cy), rx: f1(rx), ry: f1(ry), fill: K.soft(L, color, a, shape) }, parent);
    const glowAt = (L, parent, x, y, r, color, a) => {
      const c = F.el("circle", { cx: f1(x), cy: f1(y), r: f1(r), fill: K.soft(L, color, a, "glow"), style: "mix-blend-mode:screen" }, parent);
      return c;
    };
    // a flame (teardrop with a bright core) that flickers; returns its group
    function flame(L, parent, x, y, h, o = {}) {
      const g = F.el("g", null, parent);
      const w = h * (o.wide ?? 0.42);
      F.el("path", { d: `M${f1(x)} ${f1(y - h)}C${f1(x + w * 0.9)} ${f1(y - h * 0.45)} ${f1(x + w)} ${f1(y)} ${f1(x)} ${f1(y)}C${f1(x - w)} ${f1(y)} ${f1(x - w * 0.9)} ${f1(y - h * 0.45)} ${f1(x)} ${f1(y - h)}Z`,
        fill: K.lg(L, "#FFB347", "#FF7A2E", "v") }, g);
      F.el("path", { d: `M${f1(x)} ${f1(y - h * 0.72)}C${f1(x + w * 0.5)} ${f1(y - h * 0.35)} ${f1(x + w * 0.55)} ${f1(y - h * 0.05)} ${f1(x)} ${f1(y - h * 0.05)}C${f1(x - w * 0.55)} ${f1(y - h * 0.05)} ${f1(x - w * 0.5)} ${f1(y - h * 0.35)} ${f1(x)} ${f1(y - h * 0.72)}Z`,
        fill: K.lg(L, "#FFF6D8", "#FFD27A", "v") }, g);
      if (o.flicker !== false) {
        const seed = o.seed ?? Math.round(x * 3 + y);
        S.on((t) => {
          const k = 1 + 0.12 * F.noise(t * 9, seed) + 0.06 * Math.sin(t * 23 + seed), sk = 6 * F.noise(t * 5, seed + 9);
          g.setAttribute("transform", `translate(${f1(x)} ${f1(y)}) skewX(${f1(sk)}) scale(${(1 / Math.sqrt(k)).toFixed(3)} ${k.toFixed(3)}) translate(${f1(-x)} ${f1(-y)})`);
        });
      }
      return g;
    }
    function flickerGlow(el, seed, amt = 0.1) {
      S.on((t) => el.setAttribute("opacity", (1 - amt + amt * (0.6 * F.noise(t * 7.1, seed) + 0.4 * Math.sin(t * 13 + seed))).toFixed(3)));
    }
    K.flame = flame;

    // ── a soft contact shadow ───────────────────────────────────────────────────────
    prop.shadow = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 900, w = o.w ?? 200, h = o.h ?? w * 0.14;
      const e = soft(L, o.parent || L.g, x, y, w / 2, h / 2, o.color || "#2A1C12", o.a ?? 0.35);
      return { g: e };
    };

    // ── books & writing ─────────────────────────────────────────────────────────────
    // a book: state closed (upright, cover to us) | lying | open | stack
    prop.book = (L, o = {}) => {
      const st = o.state || "closed";
      const { P, g, at, outer } = start(L, o, "book", 80);
      const c = o.color || "#7E2F2A", paper = "#F1E8D2";
      if (o.shadow !== false) soft(L, g, 0, 0, st === "open" ? 70 : 42, 7, "#20140C", 0.3);
      if (st === "open") {
        P.path(g, "M-78 -6L-74 -30L0 -24L74 -30L78 -6L0 -2Z", c, { k: 0.12 });
        P.path(g, "M-72 -12C-50 -34 -20 -36 0 -26L0 -6C-20 -16 -50 -14 -72 -12Z", paper, { k: 0.06 });
        P.path(g, "M72 -12C50 -34 20 -36 0 -26L0 -6C20 -16 50 -14 72 -12Z", paper, { k: 0.06, dir: "l" });
        let d = "";
        for (let i = 0; i < 6; i++) { const u = i / 6; d += `M${f1(-62 + u * 4)} ${f1(-26 + u * 13)}Q-34 ${f1(-33 + u * 13)} -8 ${f1(-24 + u * 13)}M8 ${f1(-24 + u * 13)}Q34 ${f1(-33 + u * 13)} ${f1(62 - u * 4)} ${f1(-26 + u * 13)}`; }
        P.stroke(g, d, "#8A7C66", 1.4, { op: 0.6 });
        return { g: outer, top: at(0, -26) };
      }
      if (st === "stack") {
        const cols = o.colors || ["#7E2F2A", "#2F4A6B", "#3E5E3A", "#B08A4E"];
        let yy = 0;
        cols.forEach((cc, i) => {
          const w = 120 - i * 8 + (i % 2) * 10, h = 16 + (i % 3) * 3, dx = (i % 2 ? 5 : -4);
          P.rect(g, -w / 2 + dx, yy - h, w, h, cc, { k: 0.12, rx: 2 });
          P.rect(g, -w / 2 + dx + 4, yy - h + 3, w - 6, h - 6, paper, { k: 0.04, sw: 1 });
          P.rect(g, -w / 2 + dx, yy - h, 8, h, K.dark(cc, 0.1), { k: 0.1, sw: 1 });
          yy -= h;
        });
        return { g: outer, top: at(0, yy) };
      }
      if (st === "lying") {
        P.path(g, "M-55 -14L40 -14L58 -26L-37 -26Z", c, { k: 0.1 });
        P.rect(g, -55, -14, 95, 14, paper, { k: 0.05 });
        P.path(g, "M40 -14L58 -26L58 -12L40 0Z", paper, { k: 0.08 });
        P.rect(g, -55, -14, 6, 14, c, { k: 0.1, sw: 1 });
        return { g: outer, top: at(0, -26) };
      }
      P.rect(g, -28, -80, 56, 80, c, { dir: "h", k: 0.16, rx: 3 });
      P.rect(g, -28, -80, 9, 80, K.dark(c, 0.15), { k: 0.1, sw: 1 });
      P.rect(g, -12, -62, 32, 18, "#D8B966", { k: 0.1, sw: 1 });
      if (o.title) F.el("text", { x: 4, y: -49, "text-anchor": "middle", "font-family": "EB Garamond, serif", "font-size": 8, fill: K.dark(c, 0.4), text: o.title }, g);
      return { g: outer, top: at(0, -80) };
    };

    // a scroll: open 0 (rolled) … 1 (unrolled between two rollers); h.open(t0, t1, from, to) animates it
    prop.scroll = (L, o = {}) => {
      if ((o.open ?? 1) === 0 && !o.anim && o.rollers !== 2) {
        const { P, g, at, outer } = start(L, o, "scroll", 60, 260);
        const paper = o.color || "#EDE0BE";
        if (o.shadow !== false) soft(L, g, 0, 2, 140, 10, "#20140C", 0.3);
        P.rect(g, -120, -52, 240, 50, paper, { fill: K.cyl(L, P.col(paper), 1, "v"), rx: 24 });
        P.ellipse(g, 120, -27, 12, 25, K.lite(paper, 0.08), { k: 0.1 });
        P.stroke(g, "M120 -27m-3 0a3 3 0 1 1 6 0a7 7 0 1 1 -14 0a11 11 0 1 1 22 0", K.dark(paper, 0.3), 1.4);
        P.rect(g, -20, -54, 16, 54, "#A63D2E", { k: 0.15, sw: 1 });
        P.circle(g, -12, -27, 10, "#8A2620", { k: 0.2 });
        return { g: outer, center: at(0, -27), set() {}, open() {} };
      }
      const { P, g, at, outer } = start(L, o, "scroll", 160);
      const paper = o.color || "#EDE0BE", wood = "#8A5E3A", len = o.len ?? 300, H0 = 150;
      if (o.shadow !== false) soft(L, g, 0, 4, len * 0.45, 10, "#20140C", 0.25);
      const sheet = F.el("g", null, g), right = F.el("g", null, g), left = F.el("g", null, g);
      const roller = (parent, x) => {
        P.rect(parent, x - 3, -H0 - 16, 6, H0 + 26, wood, { dir: "h", k: 0.2, rx: 3 });
        P.rect(parent, x - 13, -H0 - 4, 26, H0 + 4, paper, { fill: K.cyl(L, P.col(paper)), rx: 6 });
        P.circle(parent, x, -H0 - 18, 7, wood, { k: 0.2 });
        P.circle(parent, x, 12, 7, wood, { k: 0.2 });
      };
      roller(left, -len / 2);
      const rg = F.el("g", null, right);
      roller(rg, 0);
      const sheetRect = P.rect(sheet, -len / 2, -H0 + 4, 10, H0 - 8, paper, { k: 0.06 });
      const text = F.el("g", null, sheet);
      let d = "";
      for (let r2 = 0; r2 < 9; r2++) for (let k = 0; k < 14; k++) d += `M${f1(-len / 2 + 22 + k * (len - 40) / 14)} ${f1(-H0 + 24 + r2 * 13)}h${f1(8 + ((r2 * 7 + k * 3) % 9))}`;
      P.stroke(text, d, "#5A4632", 2.2, { op: 0.55 });
      const tie = P.rect(right, -16, -H0 * 0.5 - 5, 32, 10, "#A63D2E", { k: 0.1, sw: 1 });
      const clipId = F.uid("sc"), cp = F.el("clipPath", { id: clipId }, L.defs);
      const clipR = F.el("rect", { x: -len / 2, y: -H0 - 30, width: 10, height: H0 + 60 }, cp);
      text.setAttribute("clip-path", `url(#${clipId})`);
      const set = (p) => {
        p = clamp(p, 0, 1);
        const w = 14 + (len - 14) * p;
        sheetRect.setAttribute("width", f1(w));
        clipR.setAttribute("width", f1(w));
        rg.setAttribute("transform", `translate(${f1(-len / 2 + w + 4)} 0)`);
        tie.setAttribute("opacity", p < 0.05 ? 1 : 0);
        tie.setAttribute("transform", `translate(${f1(-len / 2 + w + 4)} 0)`);
      };
      let keys = null;
      set(o.open ?? 1);
      if (o.anim) keys = o.anim;
      const h = { g: outer, center: at(0, -H0 / 2), set };
      h.open = (t0, t1, a = 0, b = 1) => { keys = [[t0, a], [t1, b]]; };
      S.on((t) => { if (keys) set(F.keys(t, keys, "smooth")); });
      return h;
    };

    // an inkpot with a quill standing in it
    prop.inkpot = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "inkpot", 70);
      if (o.shadow !== false) soft(L, g, 0, 2, 44, 8, "#20140C", 0.3);
      const glass = o.color || "#2E3440";
      P.path(g, "M-30 0C-38 -10 -38 -34 -24 -42L24 -42C38 -34 38 -10 30 0Z", glass, { fill: K.cyl(L, P.col(glass), 1.4) });
      P.rect(g, -14, -56, 28, 16, glass, { fill: K.cyl(L, P.col(K.lite(glass, 0.1))), rx: 3 });
      P.ellipse(g, 0, -56, 14, 4, "#15181E", { sw: 1 });
      F.el("path", { d: "M-20 -36C-24 -26 -24 -14 -20 -6", stroke: "#FFFFFF", "stroke-width": 3, fill: "none", opacity: 0.35, "stroke-linecap": "round" }, g);
      const out = { g: outer, top: at(0, -56) };
      if (o.quill !== false) {
        const q = F.el("g", { transform: "rotate(18 0 -52)" }, g);
        P.stroke(q, "M0 -52L0 -250", "#A8977A", 3.5);
        P.path(q, "M0 -250C34 -226 36 -160 10 -104L0 -92C-6 -150 -12 -212 0 -250Z", "#F2EBDB", { k: 0.14, sw: 1.6 });
        P.path(q, "M0 -250C-22 -226 -24 -184 -12 -140L0 -128Z", "#DCD0B6", { k: 0.12, sw: 1.4 });
        let d = "";
        for (let i = 0; i < 12; i++) { const yy = -236 + i * 11; d += `M1 ${yy}l${f1(14 - Math.abs(i - 5) * 1.2)} ${f1(6)}`; }
        P.stroke(q, d, "#CFC3A6", 1.2, { op: 0.8 });
        out.tip = at(Math.sin(18 * D) * 200, -52 - Math.cos(18 * D) * 200);
      }
      return out;
    };
    prop.quill = (L, o = {}) => prop.inkpot(L, o);

    // ── light sources ───────────────────────────────────────────────────────────────
    // kind: parlour (brass oil lamp with a glowing globe, 1880) | ancient (clay oil lamp) | desk (green banker's
    // lamp) | hanging (a shade on a cord) ; lit (default true), flicker
    prop.lamp = (L, o = {}) => {
      const kind = o.kind || "parlour";
      const lit = o.lit !== false;
      if (kind === "ancient") {
        const { P, g, at, outer, s } = start(L, o, "lamp", 50, 120);
        if (o.shadow !== false) soft(L, g, 0, 2, 60, 8, "#20140C", 0.35);
        const clay = o.color || "#B8663F";
        P.path(g, "M-52 -8C-56 -30 -20 -44 12 -36L52 -26C62 -24 62 -12 52 -10L14 -4C-8 0 -46 6 -52 -8Z", clay, { k: 0.16 });
        P.ellipse(g, -12, -34, 16, 5, K.dark(clay, 0.4), { sw: 1 });
        P.path(g, "M-52 -20C-70 -26 -70 -8 -52 -10", null, { stroke: clay, sw: 7 });
        P.stroke(g, "M-52 -20C-70 -26 -70 -8 -52 -10", clay, 7);
        P.circle(g, 50, -18, 4, "#3A2418", { sw: 1 });
        const out = { g: outer, flame: at(52, -24) };
        if (lit) {
          out.glow = glowAt(L, g, 52, -40, 150, "#FFD28A", 0.7);
          flickerGlow(out.glow, 3, 0.15);
          flame(L, g, 52, -20, 38, { seed: 5 });
        }
        return out;
      }
      if (kind === "desk") {
        const { P, g, at, outer } = start(L, o, "lamp", 170);
        if (o.shadow !== false) soft(L, g, 0, 2, 60, 9, "#20140C", 0.3);
        const brass = "#C9A24E";
        P.path(g, "M-44 0L-40 -12L40 -12L44 0Z", brass, { k: 0.2 });
        P.rect(g, -5, -120, 10, 108, brass, { fill: K.cyl(L, P.col(brass)) });
        P.path(g, "M-80 -118Q0 -175 80 -118L70 -108Q0 -150 -70 -108Z", o.shade || "#2F6B4E", { k: 0.2 });
        const out = { g: outer, flame: at(0, -110) };
        if (lit) { out.glow = glowAt(L, g, 0, -100, 220, "#FFE0A8", 0.55); flickerGlow(out.glow, 7, 0.05); P.ellipse(g, 0, -110, 60, 6, "#FFF4D6", { line: false }); }
        return out;
      }
      if (kind === "hanging") {
        const { P, g, at, outer } = start(L, o, "lamp", 120);
        const drop = o.drop ?? 300;
        P.stroke(g, `M0 ${-drop}V-60`, "#2E2620", 3);
        P.path(g, "M-62 0Q0 -76 62 0Z", o.shade || "#3F6B4E", { k: 0.25 });
        const out = { g: outer, flame: at(0, 2) };
        if (lit) { out.glow = glowAt(L, g, 0, 10, 380, "#FFD9A0", 0.55); flickerGlow(out.glow, 11, 0.05); P.ellipse(g, 0, 0, 26, 8, "#FFF4D6", { line: false }); }
        return out;
      }
      // parlour
      const { P, g, at, outer } = start(L, o, "lamp", 250);
      if (o.shadow !== false) soft(L, g, 0, 2, 60, 9, "#20140C", 0.3);
      const brass = o.color || "#C9A24E";
      P.path(g, "M-42 0C-40 -10 -18 -14 -14 -24L-14 -36L14 -36L14 -24C18 -14 40 -10 42 0Z", brass, { fill: K.cyl(L, P.col(brass)) });
      P.path(g, "M-10 -36C-44 -46 -44 -96 -16 -104L16 -104C44 -96 44 -46 10 -36Z", brass, { fill: K.cyl(L, P.col(K.lite(brass, 0.08))) });
      P.rect(g, -18, -114, 36, 12, K.dark(brass, 0.1), { fill: K.cyl(L, P.col(brass)), rx: 3 });
      const out = { g: outer, flame: at(0, -150) };
      if (lit) {
        out.glow = glowAt(L, g, 0, -150, o.glow ?? 330, "#FFE2A6", 0.95);
        flickerGlow(out.glow, 13, 0.06);
        F.el("circle", { cx: 0, cy: -150, r: 50, fill: K.urg(L, [[0, "#FFFFFF"], [0.5, "#FFF6DA"], [1, "#FFE4A6"]], 0, -150, 50) }, g);
        F.el("rect", { x: -9, y: -250, width: 18, height: 70, rx: 7, fill: "#FFFDF4", opacity: 0.9 }, g);
        glowAt(L, g, 0, -150, 90, "#FFFFFF", 0.8);
      } else {
        P.circle(g, 0, -150, 50, "#EFE6D2", { k: 0.1 });
        P.rect(g, -9, -250, 18, 70, "#E9EEF0", { k: 0.1, rx: 7 });
      }
      return out;
    };

    prop.candle = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "candle", 110);
      const wax = o.color || "#F2E9D6";
      if (o.shadow !== false) soft(L, g, 0, 2, 36, 6, "#20140C", 0.3);
      if (o.holder !== false) {
        P.ellipse(g, 0, -6, 34, 9, "#C9A24E", { k: 0.2 });
        P.rect(g, -14, -18, 28, 12, "#C9A24E", { fill: K.cyl(L, P.col("#C9A24E")), rx: 3 });
        P.path(g, "M34 -8C52 -8 52 -30 34 -26", null, { stroke: "#C9A24E", sw: 5 });
        P.stroke(g, "M34 -8C52 -8 52 -30 34 -26", "#C9A24E", 5);
      }
      const hh = o.len ?? 80;
      P.rect(g, -10, -18 - hh, 20, hh, wax, { fill: K.cyl(L, P.col(wax)), rx: 3 });
      P.path(g, `M-10 ${-18 - hh + 4}c0 10 5 12 5 20c0 4 -5 4 -5 0Z`, K.lite(wax, 0.3), { sw: 1 });
      P.stroke(g, `M0 ${-18 - hh}v-7`, "#2A1E18", 2);
      const out = { g: outer, flame: at(0, -18 - hh - 20) };
      if (o.lit !== false) {
        out.glow = glowAt(L, g, 0, -18 - hh - 16, o.glow ?? 150, "#FFD28A", 0.75);
        flickerGlow(out.glow, 17, 0.12);
        flame(L, g, 0, -18 - hh - 4, 30, { seed: 19 });
      }
      return out;
    };

    prop.torch = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "torch", 260);
      const wood = "#7A5436";
      if (o.bracket) { P.rect(g, -20, -150, 40, 16, "#4A4744", { k: 0.2 }); P.path(g, "M-14 -136L0 -110L14 -136", null, { stroke: "#4A4744", sw: 5 }); }
      P.path(g, "M-7 0L-10 -170L10 -170L7 0Z", wood, { dir: "h", k: 0.18 });
      P.path(g, "M-16 -170C-18 -200 18 -200 16 -170L12 -150L-12 -150Z", "#6B5238", { k: 0.2 });
      P.stroke(g, "M-15 -162L15 -168M-14 -178L14 -184", "#4A3828", 3);
      const out = { g: outer, flame: at(0, -230) };
      if (o.lit !== false) {
        out.glow = glowAt(L, g, 0, -230, o.glow ?? 320, "#FFB860", 0.85);
        flickerGlow(out.glow, 23, 0.15);
        flame(L, g, -6, -186, 70, { seed: 29, wide: 0.5 });
        flame(L, g, 8, -186, 56, { seed: 31, wide: 0.45 });
        flame(L, g, 0, -184, 84, { seed: 37, wide: 0.42 });
        if (o.smoke !== false) {
          const puffs = [];
          for (let i = 0; i < 5; i++) puffs.push(F.el("circle", { cx: 0, cy: -270, r: 12, fill: K.soft(L, "#6E6660", 0.35) }, g));
          S.on((t) => puffs.forEach((p, i) => { const u = (t * 0.5 + i / 5) % 1; p.setAttribute("cy", f1(-270 - u * 220)); p.setAttribute("cx", f1(Math.sin(u * 4 + i) * 18 + u * 30)); p.setAttribute("r", f1(12 + u * 34)); p.setAttribute("opacity", ((1 - u) * 0.8).toFixed(3)); }));
        }
      }
      return out;
    };

    // a 19th-century hand lantern (or kind "ship": a heavier storm lantern)
    prop.lantern = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "lantern", 150);
      const metal = o.color || (o.kind === "ship" ? "#B8913F" : "#3E4A44");
      if (o.shadow !== false) soft(L, g, 0, 2, 40, 7, "#20140C", 0.3);
      P.path(g, "M-30 0L-34 -12L34 -12L30 0Z", metal, { k: 0.2 });
      const lit = o.lit !== false;
      P.path(g, "M-26 -12C-34 -40 -34 -70 -24 -92L24 -92C34 -70 34 -40 26 -12Z", lit ? "#FFE8B0" : "#DCE6E6", { fill: lit ? K.lg(L, P.col("#FFF4D2"), P.col("#FFD68A"), "v") : K.lg(L, P.col("#EEF3F3"), P.col("#B8C6C8"), "d"), stroke: metal });
      P.stroke(g, "M-30 -40H30M-28 -70H28M0 -12V-92", metal, 3);
      P.path(g, "M-30 -92L-18 -112L18 -112L30 -92Z", metal, { k: 0.2 });
      P.rect(g, -10, -124, 20, 12, metal, { k: 0.2, rx: 2 });
      P.path(g, "M-22 -118C-26 -160 26 -160 22 -118", null, { stroke: metal, sw: 4 });
      P.stroke(g, "M-22 -118C-26 -160 26 -160 22 -118", metal, 4);
      const out = { g: outer, flame: at(0, -50), handle: at(0, -150) };
      if (lit) { out.glow = glowAt(L, g, 0, -50, o.glow ?? 220, "#FFD28A", 0.8); flickerGlow(out.glow, 41, 0.1); flame(L, g, 0, -34, 26, { seed: 43 }); }
      return out;
    };

    // ── furniture ───────────────────────────────────────────────────────────────────
    // a table. kind: round (a tablecloth with a fringe) | desk (drawers) | work (plank table) | ancient (low, on
    // trestles) ; returns top (the surface point) and the surface span
    prop.table = (L, o = {}) => {
      const kind = o.kind || "work";
      const { P, g, at, outer, s } = start(L, o, "table", 230, kind === "round" ? 440 : 520);
      const wood = o.color || (kind === "ancient" ? "#9A7650" : "#8A5E3C");
      if (o.shadow !== false) soft(L, g, 0, 0, kind === "round" ? 250 : 290, 26, "#20140C", 0.35);
      let topY = -230, half = 250;
      if (kind === "round") {
        const cloth = o.cloth || "#4F6B4A";
        half = 220;
        if (o.cloth === false) {
          P.rect(g, -12, -220, 24, 210, wood, { fill: K.cyl(L, P.col(wood)) });
          P.path(g, "M-80 0Q0 -40 80 0L60 4Q0 -24 -60 4Z", wood, { k: 0.2 });
          P.ellipse(g, 0, -226, 220, 34, wood, { k: 0.15 });
        } else {
          P.path(g, "M-220 -226C-224 -150 -232 -60 -236 -8Q0 20 236 -8C232 -60 224 -150 220 -226Z", cloth,
            { fill: K.lgs(L, [[0, P.col(K.dark(cloth, 0.3))], [0.2, P.col(K.lite(cloth, 0.1))], [0.45, P.col(cloth)], [0.7, P.col(K.lite(cloth, 0.06))], [1, P.col(K.dark(cloth, 0.35))]], "h") });
          let fd = "";
          for (let x = -234; x <= 234; x += 5) fd += `M${x} ${f1(-8 + 12 * (1 - Math.pow(x / 236, 2)))}v12`;
          P.stroke(g, fd, "#C9A55C", 2);
          let fold = "";
          for (let x = -180; x <= 180; x += 60) fold += `M${x} -200Q${x + 8} -100 ${x * 1.06} ${f1(-6 + 12 * (1 - Math.pow(x / 236, 2)))}`;
          P.stroke(g, fold, K.dark(cloth, 0.25), 3, { op: 0.5 });
          P.ellipse(g, 0, -226, 222, 36, cloth, { fill: K.lg(L, P.col(K.lite(cloth, 0.12)), P.col(cloth), "v") });
        }
        topY = -232;
      } else if (kind === "desk") {
        P.rect(g, -250, -230, 500, 20, K.lite(wood, 0.08), { k: 0.15 });
        P.rect(g, -240, -210, 170, 190, wood, { k: 0.1 });
        P.rect(g, 70, -210, 170, 190, wood, { k: 0.1 });
        for (const bx of [-240, 70]) for (let i = 0; i < 3; i++) { P.rect(g, bx + 12, -200 + i * 60, 146, 50, K.lite(wood, 0.04), { k: 0.1, sw: 1.2 }); P.circle(g, bx + 85, -175 + i * 60, 5, "#D2B062", { sw: 1 }); }
        P.rect(g, -70, -210, 140, 34, K.dark(wood, 0.05), { k: 0.1, sw: 1.2 });
        P.rect(g, -240, -20, 170, 20, K.dark(wood, 0.1), { k: 0.1 });
        P.rect(g, 70, -20, 170, 20, K.dark(wood, 0.1), { k: 0.1 });
      } else if (kind === "ancient") {
        half = 240;
        for (const sx of [-1, 1]) P.path(g, `M${sx * 200} 0L${sx * 180} -130L${sx * 200} -130L${sx * 222} 0Z`, K.dark(wood, 0.1), { k: 0.15 });
        P.rect(g, -250, -150, 500, 22, K.lite(wood, 0.08), { k: 0.15 });
        P.path(g, "M-250 -150L-232 -166L232 -166L250 -150Z", K.lite(wood, 0.16), { k: 0.1 });
        topY = -166;
      } else {
        for (const sx of [-1, 1]) {
          P.rect(g, sx * 220 - 14, -210, 28, 210, K.dark(wood, 0.08), { dir: "h", k: 0.15 });
          P.rect(g, sx * 170 - 11, -200, 22, 186, K.dark(wood, 0.25), { dir: "h", k: 0.12 });
        }
        P.rect(g, -230, -210, 460, 36, wood, { k: 0.1 });
        P.path(g, "M-256 -212L-236 -238L236 -238L256 -212Z", K.lite(wood, 0.14), { k: 0.08 });
        P.rect(g, -256, -216, 512, 14, K.lite(wood, 0.04), { k: 0.12 });
        topY = -236;
      }
      return { g: outer, top: at(0, topY), left: at(-half, topY), right: at(half, topY), surface: (u) => at(lerp(-half * 0.85, half * 0.85, u), topY) };
    };

    // a chair, side view (facing: right by default; flip for left). kind: wood | armchair | stool
    prop.chair = (L, o = {}) => {
      const kind = o.kind || "wood";
      const { P, g, at, outer } = start(L, o, "chair", 280);
      const wood = o.color || "#7A4E32";
      if (o.shadow !== false) soft(L, g, 0, 0, 90, 12, "#20140C", 0.3);
      if (kind === "stool") {
        P.ellipse(g, 0, -150, 70, 16, wood, { k: 0.15 });
        for (const lx of [-50, -18, 18, 50]) P.path(g, `M${lx * 0.8} -145L${lx} 0L${lx + 8} 0L${lx * 0.8 + 8} -145Z`, K.dark(wood, 0.1), { k: 0.1 });
        return { g: outer, seat: at(0, -160) };
      }
      if (kind === "armchair") {
        const fab = o.fabric || "#7E3B34";
        P.path(g, "M-80 -140C-96 -250 -92 -300 -60 -310L-30 -305C-44 -260 -46 -200 -30 -140Z", fab, { k: 0.16 });
        P.rect(g, -80, -150, 170, 60, fab, { k: 0.14, rx: 18 });
        P.path(g, "M60 -150C60 -196 100 -200 104 -160L96 -100L60 -100Z", fab, { k: 0.16 });
        P.rect(g, -76, -96, 168, 60, K.dark(fab, 0.12), { k: 0.1, rx: 8 });
        for (const lx of [-66, 78]) P.rect(g, lx, -36, 14, 36, wood, { k: 0.2 });
        return { g: outer, seat: at(10, -150) };
      }
      P.path(g, "M-70 -150L-78 -300L-62 -300L-54 -150Z", wood, { k: 0.14 });
      for (let i = 0; i < 3; i++) P.rect(g, -76 + i * 0.5, -280 + i * 40, 14, 6, K.dark(wood, 0.15), { sw: 1 });
      P.path(g, "M-70 -300C-66 -312 -52 -312 -48 -300", null, { stroke: wood, sw: 6 });
      P.rect(g, -80, -160, 170, 18, K.lite(wood, 0.06), { k: 0.14, rx: 4 });
      for (const lx of [-70, 70]) P.path(g, `M${lx - 7} -142L${lx - 10 + (lx < 0 ? -6 : 6)} 0L${lx + 4 + (lx < 0 ? -6 : 6)} 0L${lx + 7} -142Z`, K.dark(wood, 0.08), { k: 0.12 });
      P.stroke(g, "M-74 -70L74 -70", K.dark(wood, 0.2), 6);
      return { g: outer, seat: at(0, -160) };
    };

    // ── containers & camp ──────────────────────────────────────────────────────────
    prop.crate = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "crate", 180, 210);
      const wood = o.color || "#B08452";
      if (o.shadow !== false) soft(L, g, 20, 0, 140, 14, "#20140C", 0.35);
      const w = 180, h = 170, d = 50;
      P.path(g, `M${w / 2} 0L${w / 2 + d} ${-d * 0.45}L${w / 2 + d} ${-h - d * 0.45}L${w / 2} ${-h}Z`, K.dark(wood, 0.2), { k: 0.08 });
      P.path(g, `M${-w / 2} ${-h}L${-w / 2 + d} ${-h - d * 0.45}L${w / 2 + d} ${-h - d * 0.45}L${w / 2} ${-h}Z`, K.lite(wood, 0.12), { k: 0.06 });
      P.rect(g, -w / 2, -h, w, h, wood, { k: 0.1 });
      let d2 = "";
      for (let i = 1; i < 4; i++) d2 += `M${-w / 2} ${f1(-h + (h * i) / 4)}H${w / 2}`;
      P.stroke(g, d2, K.dark(wood, 0.35), 2, { op: 0.6 });
      P.rect(g, -w / 2, -h, 18, h, K.dark(wood, 0.05), { k: 0.1, sw: 1.4 });
      P.rect(g, w / 2 - 18, -h, 18, h, K.dark(wood, 0.05), { k: 0.1, sw: 1.4 });
      P.path(g, `M${-w / 2 + 18} -8L${w / 2 - 18} ${-h + 8}L${w / 2 - 18} ${-h + 26}L${-w / 2 + 18} 10Z`, K.dark(wood, 0.04), { k: 0.1, sw: 1.4 });
      if (o.label) F.el("text", { x: 0, y: -h * 0.55, "text-anchor": "middle", "font-family": "Nunito, sans-serif", "font-weight": 800, "font-size": 26, fill: K.dark(wood, 0.5), opacity: 0.6, text: o.label }, g);
      return { g: outer, top: at(d * 0.5, -h - d * 0.2) };
    };

    prop.barrel = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "barrel", 260);
      const wood = o.color || "#9A6A40", hoop = "#4E4A46";
      if (o.shadow !== false) soft(L, g, 0, 0, 110, 14, "#20140C", 0.35);
      P.path(g, "M-80 -10C-98 -90 -98 -170 -80 -250L80 -250C98 -170 98 -90 80 -10Z", wood, { fill: K.cyl(L, P.col(wood)) });
      let st = "";
      for (let i = -3; i <= 3; i++) { const x0 = i * 23, x1 = i * 27.5; st += `M${x0} -250C${x1} -170 ${x1} -90 ${x0} -10`; }
      P.stroke(g, st, K.dark(wood, 0.3), 2, { op: 0.5 });
      for (const yy of [-222, -170, -90, -38]) {
        const bulge = yy === -170 || yy === -90 ? 95 : 86;
        P.path(g, `M${-bulge} ${yy}Q0 ${yy + 10} ${bulge} ${yy}L${bulge} ${yy + 12}Q0 ${yy + 22} ${-bulge} ${yy + 12}Z`, hoop, { fill: K.cyl(L, P.col(hoop)) });
      }
      P.ellipse(g, 0, -250, 80, 16, K.lite(wood, 0.12), { k: 0.1 });
      P.ellipse(g, 0, -250, 66, 11, K.dark(wood, 0.05), { k: 0.08, sw: 1 });
      return { g: outer, top: at(0, -266) };
    };

    // a tent. kind: a-frame (canvas, the Kitty Hawk camp) | bell | bedouin (low, black goat-hair)
    prop.tent = (L, o = {}) => {
      const kind = o.kind || "a-frame";
      const { P, g, at, outer } = start(L, o, "tent", 420, 700);
      const cv = o.color || (kind === "bedouin" ? "#4A3E36" : "#EDE6D3");
      if (o.shadow !== false) soft(L, g, 60, 0, 420, 30, "#20140C", 0.3);
      if (kind === "bedouin") {
        P.path(g, "M-360 -40L-300 -200L-100 -240L100 -210L300 -240L380 -60L360 0L-340 0Z", cv, { k: 0.12 });
        let st = "";
        for (let x = -300; x <= 300; x += 60) st += `M${x} -220L${x} -10`;
        P.stroke(g, st, K.lite(cv, 0.15), 2, { op: 0.5 });
        P.path(g, "M-100 0L-80 -150L80 -150L100 0Z", "#231A14", { k: 0.1 });
        for (const px of [-300, 0, 300]) P.stroke(g, `M${px} -230V0`, "#6B5238", 6);
        return { g: outer, door: at(0, 0) };
      }
      if (kind === "bell") {
        P.path(g, "M-300 0C-260 -120 -90 -330 0 -400C90 -330 260 -120 300 0Z", cv, { fill: K.lgs(L, [[0, P.col(K.dark(cv, 0.1))], [0.4, P.col(K.lite(cv, 0.1))], [1, P.col(K.dark(cv, 0.2))]], "h") });
        P.path(g, "M-60 0L0 -300L60 0Z", "#3A2E24", { k: 0.1 });
        P.stroke(g, "M0 -400V-440", "#6B5238", 6);
        return { g: outer, door: at(0, 0) };
      }
      // a-frame, seen at an angle: front triangle + the long roof side
      const ridgeB = [340, -380], ridgeF = [0, -400];
      P.path(g, `M${ridgeF[0]} ${ridgeF[1]}L${ridgeB[0]} ${ridgeB[1]}L${ridgeB[0] + 250} -20L240 10Z`, K.dark(cv, 0.06), { k: 0.1, dir: "d" });
      P.path(g, `M${ridgeF[0]} ${ridgeF[1]}L240 10L-240 10Z`, cv, { fill: K.lg(L, P.col(K.lite(cv, 0.08)), P.col(K.dark(cv, 0.04)), "v") });
      P.path(g, `M0 -330L-80 8L80 8Z`, "#3A2E24", { fill: K.lg(L, P.col("#2A2019"), P.col("#4A3B2E"), "v") });
      P.path(g, `M0 -330L-80 8L-150 8Z`, K.dark(cv, 0.12), { k: 0.08 });
      P.path(g, `M0 -330L80 8L140 8Z`, K.lite(cv, 0.02), { k: 0.08 });
      P.stroke(g, `M${ridgeF[0]} ${ridgeF[1] - 30}V${ridgeF[1]}`, "#6B5238", 6);
      P.stroke(g, `M0 -400L-300 20M0 -400L330 40M${ridgeB[0]} ${ridgeB[1]}L${ridgeB[0] + 330} 20`, "#8C7B62", 2);
      return { g: outer, door: at(0, 0), ridge: at(ridgeF[0], ridgeF[1]) };
    };

    // clay vessels. kind: amphora (two handles, pointed foot, on a ring stand) | jar | pithos | hydria
    prop.amphora = (L, o = {}) => {
      const kind = o.kind || "amphora";
      const { P, g, at, outer } = start(L, o, "amphora", kind === "jar" ? 150 : kind === "pithos" ? 330 : 240);
      const clay = o.color || "#C27A4A", black = "#2E2420";
      if (o.shadow !== false) soft(L, g, 0, 0, kind === "pithos" ? 110 : 70, 10, "#20140C", 0.35);
      let topY;
      if (kind === "jar") {
        P.path(g, "M-30 0C-78 -20 -80 -110 -40 -130L-36 -142L36 -142L40 -130C80 -110 78 -20 30 0Z", clay, { fill: K.cyl(L, P.col(clay)) });
        P.ellipse(g, 0, -142, 38, 8, K.dark(clay, 0.3), { k: 0.1 });
        topY = -150;
      } else if (kind === "pithos") {
        P.path(g, "M-50 0C-120 -60 -130 -240 -80 -300L-70 -318L70 -318L80 -300C130 -240 120 -60 50 0Z", clay, { fill: K.cyl(L, P.col(clay)) });
        for (const yy of [-270, -200, -120]) P.stroke(g, `M-110 ${yy}Q0 ${yy + 16} 110 ${yy}`, K.dark(clay, 0.25), 5, { op: 0.6 });
        P.ellipse(g, 0, -318, 72, 14, K.dark(clay, 0.35), { k: 0.1 });
        topY = -330;
      } else {
        if (kind === "amphora") { P.path(g, "M-30 0L-24 -18L24 -18L30 0Z", "#6B4A32", { k: 0.2 }); }
        const body = kind === "hydria"
          ? "M-24 -10C-80 -40 -84 -150 -40 -180L-30 -206L30 -206L40 -180C84 -150 80 -40 24 -10Z"
          : "M0 -12C-12 -16 -30 -40 -52 -80C-72 -120 -64 -168 -30 -184L-22 -214L22 -214L30 -184C64 -168 72 -120 52 -80C30 -40 12 -16 0 -12Z";
        P.path(g, body, clay, { fill: K.cyl(L, P.col(clay)) });
        if (o.pattern !== false) {
          P.path(g, "M-62 -140Q0 -128 62 -140L64 -108Q0 -96 -64 -108Z", black, { fill: K.cyl(L, P.col(black), 0.5), sw: 1 });
          let mz = "";
          for (let x = -54; x < 54; x += 13) mz += `M${x} -110q6.5 -24 13 0`;
          P.stroke(g, mz, clay, 2.4, { op: 0.85 });
          let dots = "";
          for (let x = -48; x < 52; x += 13) dots += `M${x} -120a2.4 2.4 0 1 0 0.1 0Z`;
          F.el("path", { d: dots, fill: P.col(clay), opacity: 0.85 }, g);
          P.stroke(g, "M-60 -150Q0 -138 60 -150M-56 -98Q0 -86 56 -98", black, 3);
        }
        for (const sx of [-1, 1]) P.path(g, `M${sx * 22} -206C${sx * 60} -214 ${sx * 64} -186 ${sx * 44} -168`, null, { stroke: clay, sw: 8 });
        for (const sx of [-1, 1]) P.stroke(g, `M${sx * 22} -206C${sx * 60} -214 ${sx * 64} -186 ${sx * 44} -168`, K.dark(clay, 0.1), 8);
        P.rect(g, -26, -226, 52, 14, clay, { fill: K.cyl(L, P.col(clay)), rx: 5 });
        topY = -226;
      }
      return { g: outer, top: at(0, topY) };
    };
    prop.jar = (L, o = {}) => prop.amphora(L, Object.assign({ kind: "jar" }, o));

    // a woven basket. contents: bread | fruit | fish | scrolls | grain | none
    prop.basket = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "basket", 120, 200);
      const straw = o.color || "#C9A160";
      if (o.shadow !== false) soft(L, g, 0, 0, 110, 12, "#20140C", 0.3);
      const c = o.contents || "fruit";
      const top = -100;
      const fill = F.el("g", null, g);
      if (c === "fruit") [["#C4452F", -40], ["#E0A13A", 0], ["#7FA44A", 38], ["#C4452F", 18], ["#E0A13A", -20]].forEach(([cc, dx], i) => P.circle(fill, dx, top - 8 - (i > 2 ? 18 : 0), 22, cc, { k: 0.25 }));
      else if (c === "bread") [[-36, 0], [10, -6], [44, 2]].forEach(([dx, dy]) => P.ellipse(fill, dx, top - 8 + dy, 38, 20, "#D59A4E", { k: 0.3 }));
      else if (c === "fish") for (let i = 0; i < 3; i++) P.path(fill, `M${-60 + i * 30} ${top - 6 - i * 6}q40 -20 80 0q-40 18 -80 0Zl-14 -10v20Z`, "#9DB0B8", { k: 0.25 });
      else if (c === "scrolls") for (let i = 0; i < 5; i++) { P.rect(fill, -60 + i * 26, top - 60 - (i % 2) * 14, 22, 70, "#EDE0BE", { fill: K.cyl(L, P.col("#EDE0BE")), rx: 8 }); P.ellipse(fill, -49 + i * 26, top - 60 - (i % 2) * 14, 11, 4, "#CBB98E", { sw: 1 }); }
      else if (c === "grain") P.path(fill, `M-80 ${top}Q0 ${top - 50} 80 ${top}Z`, "#E3C471", { k: 0.2 });
      P.path(g, `M-90 ${top}L-70 0L70 0L90 ${top}Z`, straw, { fill: K.cyl(L, P.col(straw)) });
      let wv = "";
      for (let yy = top + 12; yy < 0; yy += 14) wv += `M${f1(-90 + (yy - top) * 0.2)} ${yy}H${f1(90 - (yy - top) * 0.2)}`;
      for (let x = -80; x <= 80; x += 16) wv += `M${x} ${top}L${f1(x * 0.78)} 0`;
      P.stroke(g, wv, K.dark(straw, 0.35), 1.8, { op: 0.6 });
      P.ellipse(g, 0, top, 90, 12, K.lite(straw, 0.1), { k: 0.1, fill: "none" });
      P.stroke(g, `M-90 ${top}Q0 ${top + 14} 90 ${top}`, K.dark(straw, 0.25), 6);
      return { g: outer, top: at(0, top) };
    };

    // a rope: a sagging line from → to, or a coil (coil: true, at x, y)
    prop.rope = (L, o = {}) => {
      const c = o.color || "#B39A6E";
      if (o.coil) {
        const { P, g, at, outer } = start(L, o, "rope", 60, 160);
        if (o.shadow !== false) soft(L, g, 0, 0, 90, 12, "#20140C", 0.3);
        for (let i = 0; i < 6; i++) P.ellipse(g, 0, -8 - i * 9, 76 - i * 5, 18 - i * 1.2, "none", { stroke: i % 2 ? c : K.dark(c, 0.12), sw: 9, line: true });
        return { g: outer, top: at(0, -60) };
      }
      const [x0, y0] = o.from || [600, 400], [x1, y1] = o.to || [1200, 420], sag = o.sag ?? 60;
      const g = F.el("g", { class: "rope" }, o.parent || L.g);
      const d = `M${f1(x0)} ${f1(y0)}Q${f1((x0 + x1) / 2)} ${f1((y0 + y1) / 2 + sag * 2)} ${f1(x1)} ${f1(y1)}`;
      const w = o.width ?? 4;
      F.el("path", { d, fill: "none", stroke: K.air(K.dark(c, 0.25), o.far || 0, airOf(o)), "stroke-width": w + 1.5, "stroke-linecap": "round" }, g);
      F.el("path", { d, fill: "none", stroke: K.air(c, o.far || 0, airOf(o)), "stroke-width": w, "stroke-linecap": "round", "stroke-dasharray": `${f1(w * 1.4)} ${f1(w * 0.5)}` }, g);
      return { g, mid: [(x0 + x1) / 2, (y0 + y1) / 2 + sag] };
    };

    // a wooden ladder leaning at `lean` degrees (x, y = the foot)
    prop.ladder = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "ladder", 820);
      const wood = o.color || "#A67C4E", lean = o.lean ?? 14, len = 820, w = 110;
      const lg = F.el("g", { transform: `rotate(${f1(lean)})` }, g);
      for (const sx of [-1, 1]) P.rect(lg, sx * w / 2 - 9, -len, 18, len, wood, { dir: "h", k: 0.15 });
      for (let yy = -60; yy > -len + 20; yy -= 72) P.rect(lg, -w / 2, yy, w, 12, K.dark(wood, 0.05), { k: 0.15, sw: 1.2 });
      const a = lean * D;
      return { g: outer, top: at(Math.sin(a) * len, -Math.cos(a) * len) };
    };

    // ── money, letters, maps ───────────────────────────────────────────────────────
    prop.coins = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "coins", 60, 120);
      const metal = o.metal === "silver" ? "#C9CCD0" : o.metal === "bronze" ? "#B7773E" : "#E0B84A";
      if (o.shadow !== false) soft(L, g, 0, 0, 80, 10, "#20140C", 0.3);
      const n = o.n ?? 6;
      for (let i = 0; i < n; i++) {
        const yy = -6 - i * 7, dx = (i % 2) * 3 - 1;
        P.path(g, `M${-26 + dx} ${yy}v6a26 7 0 0 0 52 0v-6`, K.dark(metal, 0.2), { k: 0.1, sw: 1.2 });
        P.ellipse(g, dx, yy, 26, 7, metal, { k: 0.2, sw: 1.2 });
      }
      [[48, -4, 20], [-50, 2, 12], [70, 6, -30]].slice(0, o.loose ?? 3).forEach(([dx, dy, rot]) => {
        P.ellipse(g, dx, dy - 5, 25, 8, metal, { k: 0.25, sw: 1.2 });
        P.ellipse(g, dx, dy - 5, 16, 5, "none", { stroke: K.dark(metal, 0.25), sw: 1, line: true });
        void rot;
      });
      const topY = -6 - (n - 1) * 7;
      const out = { g: outer, top: at(0, topY) };
      if (o.glint !== false) {
        const sp = F.el("path", { d: "M0 -14Q1 -1 14 0Q1 1 0 14Q-1 1 -14 0Q-1 -1 0 -14Z", fill: "#FFFFFF" }, g);
        S.on((t) => { const k = Math.max(0, Math.sin(t * 2.2)); sp.setAttribute("transform", `translate(12 ${topY - 2}) scale(${(0.3 + k).toFixed(3)})`); sp.setAttribute("opacity", k.toFixed(3)); });
      }
      return out;
    };

    // a letter. kind: envelope (with a wax seal) | sheet (handwriting) | folded
    prop.letter = (L, o = {}) => {
      const kind = o.kind || "envelope";
      const { P, g, at, outer } = start(L, o, "letter", 140, 200);
      const paper = o.color || "#F1E8D2";
      if (kind === "sheet") {
        P.rect(g, -70, -200, 140, 200, paper, { k: 0.06 });
        let d = "";
        for (let i = 0; i < 12; i++) { let x = -56; d += `M${x} ${-178 + i * 14}`; while (x < 50) { const w = 6 + ((i * 31 + x * 7) % 14); d += `q${f1(w / 2)} -4 ${f1(w)} 0`; x += w + 3; d += `m3 0`; } }
        P.stroke(g, d, "#3A3A5A", 1.4, { op: 0.7 });
        return { g: outer, center: at(0, -100) };
      }
      P.rect(g, -100, -130, 200, 130, paper, { k: 0.06 });
      P.path(g, "M-100 -130L0 -58L100 -130", null, { stroke: K.dark(paper, 0.25), sw: 2 });
      P.path(g, "M-100 0L-24 -70M100 0L24 -70", null, { stroke: K.dark(paper, 0.2), sw: 1.5 });
      P.stroke(g, "M-100 -130L0 -58L100 -130M-100 0L-24 -70M100 0L24 -70", K.dark(paper, 0.22), 1.8);
      if (o.seal !== false) { P.circle(g, 0, -62, 14, "#A8322A", { k: 0.25 }); P.circle(g, 0, -62, 8, "#8A2620", { line: false }); }
      return { g: outer, center: at(0, -65) };
    };

    // an old map on parchment: coastlines, a dashed route, a compass rose, curled edges
    prop.map = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "map", 300, 420);
      const R = K.R(o.seed ?? 3, 301);
      const paper = o.color || "#E9DCB8", ink = "#6B5236";
      const w = 420, h = 300;
      if (o.shadow !== false) soft(L, g, 8, 10, w * 0.55, 30, "#20140C", 0.3);
      P.rect(g, -w / 2, -h, w, h, paper, { fill: K.urg(L, [[0, P.col(K.lite(paper, 0.1))], [0.75, P.col(paper)], [1, P.col(K.dark(paper, 0.18))]], 0, -h / 2, w * 0.62) });
      const land = F.el("g", null, g);
      for (let i = 0; i < 4; i++) {
        const cx = -w / 2 + 60 + R() * (w - 120), cy = -h + 60 + R() * (h - 120);
        P.path(land, K.blob(cx, cy, 40 + R() * 60, 30 + R() * 40, R, 10, 0.3), "#D8C595", { sw: 1.6, stroke: ink, k: 0.05 });
      }
      P.stroke(g, `M${-w / 2 + 40} ${-h + 250}C${-60} ${-h + 120} ${40} ${-h + 260} ${w / 2 - 50} ${-h + 70}`, "#A8322A", 2.5, { dash: "8 7" });
      P.stroke(g, `M${w / 2 - 58} ${-h + 62}l16 16M${w / 2 - 42} ${-h + 62}l-16 16`, "#A8322A", 3);
      let gr = "";
      for (let x = -w / 2 + 70; x < w / 2; x += 70) gr += `M${x} ${-h + 10}V-10`;
      for (let y = -h + 60; y < 0; y += 60) gr += `M${-w / 2 + 10} ${y}H${w / 2 - 10}`;
      P.stroke(g, gr, ink, 0.8, { op: 0.35 });
      const cx = -w / 2 + 70, cy = -70;
      P.path(g, `M${cx} ${cy - 36}L${cx + 7} ${cy - 7}L${cx + 36} ${cy}L${cx + 7} ${cy + 7}L${cx} ${cy + 36}L${cx - 7} ${cy + 7}L${cx - 36} ${cy}L${cx - 7} ${cy - 7}Z`, "#C9A55C", { sw: 1.2, stroke: ink });
      if (o.curl !== false) for (const sx of [-1, 1]) P.rect(g, sx * w / 2 - 12, -h - 4, 24, h + 8, paper, { fill: K.cyl(L, P.col(K.dark(paper, 0.05))), rx: 12 });
      return { g: outer, center: at(0, -h / 2) };
    };

    // ── science & measurement ──────────────────────────────────────────────────────
    // a gnomon: a vertical rod (or a small obelisk) whose shadow follows the sun.
    // sun {elev°, dir°}: dir is where the SHADOW points on the ground (0 right, 90 toward us, 180 left, 270 away);
    // view "side" (ground foreshortened by tilt) | "above"; ray: draw the sun ray over the tip; angle: mark the
    // angle between rod and ray (Eratosthenes: elev 82.8 → 7.2°). h.setSun(elev, dir) · h.track([{t, elev, dir}])
    prop.gnomon = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 860, h = o.h ?? 320, kind = o.kind || "rod";
      const above = o.view === "above", tilt = above ? 1 : o.tilt ?? 0.3;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 2 });
      const g = F.el("g", { class: "gnomon" }, o.parent || L.g);
      const shade = F.el("path", { fill: K.lg(L, "#2A1C12", "#2A1C12", "h", 0.45, 0.28) }, g);
      const tipSoft = F.el("ellipse", { fill: K.soft(L, "#2A1C12", 0.3) }, g);
      const bw = h * (kind === "obelisk" ? 0.1 : 0.034);
      if (o.base !== false) {
        P.ellipse(g, x, y, h * 0.12, h * 0.12 * tilt * (above ? 1 : 1.2), "#CFC3AA", { k: 0.12 });
        if (!above) P.path(g, `M${f1(x - h * 0.12)} ${f1(y)}v${f1(h * 0.03)}a${f1(h * 0.12)} ${f1(h * 0.036)} 0 0 0 ${f1(h * 0.24)} 0v${f1(-h * 0.03)}`, "#B8AA8E", { k: 0.1 });
      }
      const rod = F.el("g", null, g);
      if (above) P.circle(rod, x, y, bw * 1.2, kind === "obelisk" ? "#DCC08E" : "#B8863E", { k: 0.2 });
      else if (kind === "obelisk") set_obelisk(rod);
      else {
        P.path(rod, `M${f1(x - bw / 2)} ${f1(y)}L${f1(x - bw * 0.3)} ${f1(y - h)}L${f1(x + bw * 0.3)} ${f1(y - h)}L${f1(x + bw / 2)} ${f1(y)}Z`, o.color || "#B8863E", { fill: K.cyl(L, P.col(o.color || "#B8863E")) });
        P.circle(rod, x, y - h, bw * 0.6, o.color || "#B8863E", { k: 0.2 });
      }
      function set_obelisk(parent) {
        const c = "#DCC08E";
        P.path(parent, `M${f1(x - bw / 2)} ${f1(y)}L${f1(x - bw * 0.33)} ${f1(y - h * 0.9)}L${f1(x + bw * 0.1)} ${f1(y - h * 0.9)}L${f1(x + bw * 0.12)} ${f1(y)}Z`, c, { k: 0.1 });
        P.path(parent, `M${f1(x + bw * 0.12)} ${f1(y)}L${f1(x + bw * 0.1)} ${f1(y - h * 0.9)}L${f1(x + bw * 0.33)} ${f1(y - h * 0.9)}L${f1(x + bw / 2)} ${f1(y)}Z`, K.dark(c, 0.25), { k: 0.05 });
        P.path(parent, `M${f1(x - bw * 0.33)} ${f1(y - h * 0.9)}L${f1(x)} ${f1(y - h)}L${f1(x + bw * 0.33)} ${f1(y - h * 0.9)}Z`, "#E6BE55", { k: 0.15 });
      }
      const rayG = F.el("g", null, g);
      const ray = o.ray ? F.el("path", { fill: "none", stroke: o.rayColor || "#F2B84B", "stroke-width": 3, "stroke-dasharray": "14 8", "stroke-linecap": "round" }, rayG) : null;
      const arc = o.angle ? F.el("path", { fill: "none", stroke: o.rayColor || "#F2B84B", "stroke-width": 3 }, rayG) : null;
      const hnd = { g, base: [x, y], top: [x, y - h], tip: [x, y], elev: 0, dir: 0 };
      const setSun = (elev, dir) => {
        elev = clamp(elev, 1, 90);
        const len = h / Math.tan(elev * D), dx = Math.cos(dir * D) * len, dy = Math.sin(dir * D) * len * tilt;
        const tx = x + dx, ty = y + dy, n = Math.hypot(dx, dy) || 1, nx = -dy / n, ny = dx / n;
        const w0 = Math.max(3, bw * 0.95), w1 = Math.max(2, bw * 0.6);
        shade.setAttribute("d", len < 1 ? "" : K.poly([[x + nx * w0, y + ny * w0], [tx + nx * w1, ty + ny * w1], [tx - nx * w1, ty - ny * w1], [x - nx * w0, y - ny * w0]]));
        tipSoft.setAttribute("cx", f1(tx)); tipSoft.setAttribute("cy", f1(ty)); tipSoft.setAttribute("rx", f1(bw * 1.4)); tipSoft.setAttribute("ry", f1(bw * 1.4 * (above ? 1 : 0.5)));
        hnd.tip = [tx, ty]; hnd.elev = elev; hnd.dir = dir; hnd.length = len; hnd.angle = 90 - elev;
        if (ray) {
          const top = above ? [x, y] : [x, y - h];
          const vx = tx - top[0], vy = ty - top[1], m = Math.hypot(vx, vy) || 1;
          const back = h * 1.3;
          ray.setAttribute("d", `M${f1(top[0] - (vx / m) * back)} ${f1(top[1] - (vy / m) * back)}L${f1(tx)} ${f1(ty)}`);
          if (arc) {
            const r = h * 0.22, a0 = Math.PI / 2, a1 = Math.atan2(vy, vx);
            arc.setAttribute("d", `M${f1(top[0] + Math.cos(a0) * r)} ${f1(top[1] + Math.sin(a0) * r)}A${f1(r)} ${f1(r)} 0 0 ${a1 < a0 ? 0 : 1} ${f1(top[0] + Math.cos(a1) * r)} ${f1(top[1] + Math.sin(a1) * r)}`);
            hnd.angle = 90 - elev;
            hnd.arcAt = [top[0] + Math.cos((a0 + a1) / 2) * r * 1.5, top[1] + Math.sin((a0 + a1) / 2) * r * 1.5];
          }
        }
      };
      const sun = o.sun || { elev: 55, dir: 20 };
      setSun(sun.elev ?? 55, sun.dir ?? 20);
      let keys = o.track || null;
      hnd.setSun = setSun;
      hnd.track = (k) => { keys = k; };
      S.on((t) => { if (keys) { const e = F.keys(t, keys.map((k) => [k.t, [k.elev, k.dir]]), "smooth"); setSun(e[0], e[1]); } });
      return hnd;
    };

    // a horizontal sundial on a pedestal; hour (6–18) sets the shadow; h.setHour(h) · h.track([[t, hour], …])
    prop.sundial = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "sundial", 300);
      const stone = o.color || "#D8CCB2", lat = o.lat ?? 31;
      if (o.shadow !== false) soft(L, g, 0, 0, 120, 16, "#20140C", 0.35);
      P.path(g, "M-60 0L-44 -30L44 -30L60 0Z", K.dark(stone, 0.08), { k: 0.1 });
      P.path(g, "M-34 -30L-26 -200L26 -200L34 -30Z", stone, { fill: K.cyl(L, P.col(stone)) });
      const rx = 150, ry = 50, cy = -220;
      P.path(g, `M${-rx} ${cy}v16a${rx} ${ry} 0 0 0 ${rx * 2} 0v-16`, K.dark(stone, 0.15), { k: 0.1 });
      P.ellipse(g, 0, cy, rx, ry, "#C9A55C", { fill: K.lg(L, P.col("#DCC07A"), P.col("#B8913F"), "v") });
      const cx = 0, cyy = cy + ry * 0.45;
      let d = "";
      const ang = (hr) => Math.atan(Math.sin(lat * D) * Math.tan((hr - 12) * 15 * D));
      for (let hr = 6; hr <= 18; hr++) {
        const a = hr === 6 ? -Math.PI / 2 : hr === 18 ? Math.PI / 2 : ang(hr);
        const ex = cx + Math.sin(a) * rx * 0.86, ey = cyy - Math.cos(a) * ry * 1.25;
        d += `M${f1(cx)} ${f1(cyy)}L${f1(ex)} ${f1(ey)}`;
      }
      P.stroke(g, d, "#6B5236", 1.6, { op: 0.8 });
      const sh = F.el("path", { fill: "#3A2A1C", opacity: 0.55 }, g);
      P.path(g, `M${cx} ${cyy}L${cx} ${f1(cyy - 70)}L${cx} ${f1(cy - ry * 0.8)}Z`, "#7A5A2E", { sw: 1.5 });
      P.path(g, `M${cx - 3} ${cyy}L${cx - 3} ${f1(cyy - 70)}L${cx + 3} ${f1(cyy - 70)}L${cx + 3} ${f1(cy - ry * 0.75)}L${cx + 3} ${cyy}Z`, "#8A6A3A", { sw: 1.4 });
      const setHour = (hr) => {
        const a = ang(clamp(hr, 6.2, 17.8));
        const ex = cx + Math.sin(a) * rx * 0.8, ey = cyy - Math.cos(a) * ry * 1.15, nx = Math.cos(a) * 5, ny = Math.sin(a) * 2;
        sh.setAttribute("d", `M${f1(cx + nx)} ${f1(cyy + ny)}L${f1(ex)} ${f1(ey)}L${f1(cx - nx)} ${f1(cyy - ny)}Z`);
      };
      setHour(o.hour ?? 10);
      let keys = null;
      S.on((t) => { if (keys) setHour(F.keys(t, keys, "smooth")); });
      return { g: outer, top: at(0, cy), setHour, track: (k) => { keys = k; } };
    };

    // a measuring rod (a surveyor's staff / cubit rod) lying at angle r, len px long, with painted segments
    prop.rod = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 700, len = o.len ?? 600, r = o.r ?? 0, n = o.units ?? 10;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.6 });
      const g = F.el("g", { class: "rod", transform: `translate(${f1(x)} ${f1(y)}) rotate(${f1(r)})` }, o.parent || L.g);
      const th = o.thick ?? 18, c1 = o.color || "#E9DDBE", c2 = o.color2 || "#A8322A";
      for (let i = 0; i < n; i++) P.rect(g, -len / 2 + (len * i) / n, -th / 2, len / n, th, i % 2 ? c2 : c1, { k: 0.2, sw: 1.2 });
      let d = "";
      for (let i = 0; i <= n * 4; i++) d += `M${f1(-len / 2 + (len * i) / (n * 4))} ${f1(-th / 2)}v${i % 4 ? th * 0.3 : th * 0.55}`;
      P.stroke(g, d, "#2E2620", 1.2, { op: 0.8 });
      const ca = Math.cos(r * D), sa = Math.sin(r * D);
      return { g, a: [x - (len / 2) * ca, y - (len / 2) * sa], b: [x + (len / 2) * ca, y + (len / 2) * sa] };
    };
    prop.measuringRod = prop.rod;

    // an abacus (a counting frame): rows of beads; values[i] = beads pushed right; h.set(values) · h.slide(t0, t1, from, to)
    prop.abacus = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "abacus", 260, 360);
      const rows = o.rows ?? 7, per = o.beads ?? 10, wood = o.color || "#7A4E32";
      const w = 360, h = 260, x0 = -w / 2 + 26, x1 = w / 2 - 26, br = 11;
      if (o.shadow !== false) soft(L, g, 0, 4, 190, 16, "#20140C", 0.3);
      P.rect(g, -w / 2, -h, w, h, "none", { stroke: wood, sw: 2 });
      const rowY = (i) => -h + 30 + (i * (h - 60)) / (rows - 1);
      for (let i = 0; i < rows; i++) P.stroke(g, `M${x0} ${f1(rowY(i))}H${x1}`, "#A8A39A", 3);
      const beads = [];
      const cols = o.colors || ["#B8452F", "#E9D9B2"];
      for (let i = 0; i < rows; i++) {
        beads.push([]);
        for (let k = 0; k < per; k++) beads[i].push(P.ellipse(g, 0, rowY(i), br * 0.9, br, cols[Math.floor(k / 5) % 2], { fill: K.cyl(L, P.col(cols[Math.floor(k / 5) % 2])), sw: 1.2 }));
      }
      for (const sx of [-1, 1]) P.rect(g, sx * w / 2 - (sx > 0 ? 22 : 0), -h, 22, h, wood, { dir: "h", k: 0.15 });
      P.rect(g, -w / 2, -h, w, 20, wood, { k: 0.15 }); P.rect(g, -w / 2, -20, w, 20, wood, { k: 0.15 });
      const set = (vals) => {
        for (let i = 0; i < rows; i++) {
          const v = clamp(vals[i] ?? 0, 0, per);
          for (let k = 0; k < per; k++) {
            const left = x0 + br + k * br * 1.85, right = x1 - br - (per - 1 - k) * br * 1.85;
            const moved = clamp(v - (per - 1 - k), 0, 1);
            beads[i][k].setAttribute("cx", f1(lerp(left, right, moved)));
          }
        }
      };
      set(o.values || [3, 7, 0, 5, 2, 9, 1]);
      let anim = null;
      S.on((t) => { if (anim) { const p = F.ease("smooth")(F.seg(t, anim[0], anim[1])); set(anim[2].map((v, i) => lerp(v, anim[3][i] ?? v, p))); } });
      return { g: outer, top: at(0, -h), set, slide: (t0, t1, a, b) => { anim = [t0, t1, a, b]; } };
    };

    // a terrestrial globe on a stand with a brass meridian ring; spin in °/s
    prop.globe = (L, o = {}) => {
      const { P, g, at, outer, s } = start(L, o, "globe", 330);
      const wood = o.color || "#7A4E32", brass = "#C9A24E", r = 110, cy = -200, tilt = 23.5;
      if (o.shadow !== false) soft(L, g, 0, 0, 100, 14, "#20140C", 0.35);
      P.path(g, "M-80 0Q0 -30 80 0L60 6Q0 -14 -60 6Z", wood, { k: 0.2 });
      P.path(g, "M-12 -14C-20 -50 -8 -70 -8 -80L8 -80C8 -70 20 -50 12 -14Z", wood, { fill: K.cyl(L, P.col(wood)) });
      const gl = F.el("g", { transform: `rotate(${tilt} 0 ${cy})` }, g);
      F.el("circle", { cx: 0, cy, r, fill: K.urg(L, [[0, P.col("#B9D6D2")], [1, P.col("#7FA8AE")]], -r * 0.3, cy - r * 0.3, r * 1.5) }, gl);
      const clipId = F.uid("gc"), cp = F.el("clipPath", { id: clipId }, L.defs);
      F.el("circle", { cx: 0, cy, r: r - 0.5 }, cp);
      const surf = F.el("g", { "clip-path": `url(#${clipId})` }, gl);
      const land = K.LAND.map((ring) => ({ ring, el: F.el("path", { fill: P.col("#E6D3A0"), stroke: P.col("#9C7E4E"), "stroke-width": 1.2, "vector-effect": "non-scaling-stroke" }, surf) }));
      const grat = F.el("path", { fill: "none", stroke: P.col("#6E8E92"), "stroke-width": 0.8, opacity: 0.6, "vector-effect": "non-scaling-stroke" }, surf);
      const draw = (l0) => {
        for (const le of land) {
          let d = "", vis = false;
          for (let i = 0; i < le.ring.length; i += 2) {
            let [px, py, c] = K.ortho(le.ring[i] / 10, le.ring[i + 1] / 10, l0, 10, r);
            if (c > 0) vis = true; else { const m = Math.hypot(px, py) || 1; px = (px / m) * r; py = (py / m) * r; }
            d += (i ? "L" : "M") + f1(px) + " " + f1(cy + py);
          }
          le.el.setAttribute("d", vis ? d + "Z" : "");
        }
        let gd = "";
        for (let lon = 0; lon < 360; lon += 30) { let pen = false; for (let lat = -80; lat <= 80; lat += 10) { const [px, py, c] = K.ortho(lon, lat, l0, 10, r); if (c > 0) { gd += (pen ? "L" : "M") + f1(px) + " " + f1(cy + py); pen = true; } else pen = false; } }
        for (let lat = -60; lat <= 60; lat += 30) { let pen = false; for (let lon = 0; lon <= 360; lon += 10) { const [px, py, c] = K.ortho(lon, lat, l0, 10, r); if (c > 0) { gd += (pen ? "L" : "M") + f1(px) + " " + f1(cy + py); pen = true; } else pen = false; } }
        grat.setAttribute("d", gd);
      };
      const lon0 = o.lon ?? 10;
      draw(lon0);
      if (o.spin) S.on((t) => draw(lon0 - o.spin * t));
      F.el("circle", { cx: -r * 0.35, cy: cy - r * 0.35, r: r * 0.5, fill: K.soft(L, "#FFFFFF", 0.35) }, gl);
      F.el("circle", { cx: 0, cy, r, fill: K.ulg(L, [[0, "#000000", 0], [0.6, "#000000", 0], [1, "#1B120C", 0.35]], -r, cy, r, cy) }, gl);
      P.circle(gl, 0, cy, r, "none", { stroke: "#5E7F84", sw: 1.5 });
      P.path(gl, `M0 ${cy - r - 14}A${r + 14} ${r + 14} 0 0 1 0 ${cy + r + 14}`, null, { stroke: brass, sw: 7 });
      P.stroke(gl, `M0 ${cy - r - 14}A${r + 14} ${r + 14} 0 0 1 0 ${cy + r + 14}`, brass, 7);
      P.stroke(gl, `M0 ${cy + r + 14}L0 ${cy + r + 28}`, brass, 6);
      void s;
      return { g: outer, center: at(0, cy), top: at(0, cy - r - 14) };
    };

    // a brass refractor on a wooden tripod; angle = elevation of the tube in degrees
    prop.telescope = (L, o = {}) => {
      const { P, g, at, outer } = start(L, o, "telescope", 480);
      const brass = o.color || "#C9A24E", wood = "#7A5436", ang = o.angle ?? 32;
      if (o.shadow !== false) soft(L, g, 0, 0, 170, 16, "#20140C", 0.3);
      P.stroke(g, "M0 -270L-130 0M0 -270L120 0", wood, 12);
      P.stroke(g, "M0 -270L20 -20", K.dark(wood, 0.2), 10);
      P.rect(g, -18, -290, 36, 30, "#4A4744", { k: 0.2, rx: 5 });
      const tg = F.el("g", { transform: `translate(0 -290) rotate(${f1(-ang)})` }, g);
      P.path(tg, "M-150 -14L230 -24L230 24L-150 14Z", brass, { fill: K.cyl(L, P.col(brass), 1, "v") });
      P.rect(tg, 200, -30, 60, 60, brass, { fill: K.cyl(L, P.col(K.dark(brass, 0.05)), 1, "v"), rx: 5 });
      P.ellipse(tg, 262, 0, 6, 26, "#5F7F96", { k: 0.3 });
      P.rect(tg, -190, -9, 44, 18, K.dark(brass, 0.15), { fill: K.cyl(L, P.col(K.dark(brass, 0.1)), 1, "v"), rx: 3 });
      P.rect(tg, -40, -40, 110, 12, K.dark(brass, 0.1), { fill: K.cyl(L, P.col(brass), 1, "v"), rx: 4 });
      for (const bx of [-90, 60, 160]) P.rect(tg, bx, -20, 8, 40, K.dark(brass, 0.25), { sw: 1 });
      const a = -ang * D;
      return { g: outer, eyepiece: at(-190 * Math.cos(a), -290 - 190 * Math.sin(a) * -1), lens: at(262 * Math.cos(a), -290 + 262 * Math.sin(a)) };
    };

    // a compass. kind: magnetic (seen from above at an angle; the needle settles with a wobble) | dividers
    prop.compass = (L, o = {}) => {
      if (o.kind === "dividers") {
        const { P, g, at, outer } = start(L, o, "compass", 260);
        const open = o.open ?? 24, metal = o.color || "#B8BCC0";
        for (const sd of [-1, 1]) {
          const lg = F.el("g", { transform: `translate(0 -250) rotate(${sd * open / 2})` }, g);
          P.path(lg, "M-7 0L-3 240L3 240L7 0Z", metal, { dir: "h", k: 0.25 });
        }
        P.circle(g, 0, -250, 14, "#C9A24E", { k: 0.25 });
        P.rect(g, -5, -290, 10, 30, "#C9A24E", { k: 0.2, rx: 3 });
        const sp = Math.sin((open / 2) * D) * 240;
        return { g: outer, a: at(-sp, -10), b: at(sp, -10) };
      }
      const { P, g, at, outer } = start(L, o, "compass", 80, 200);
      const brass = o.color || "#C9A24E";
      if (o.shadow !== false) soft(L, g, 0, 0, 110, 16, "#20140C", 0.3);
      P.path(g, "M-100 -40v18a100 34 0 0 0 200 0v-18", K.dark(brass, 0.15), { k: 0.15 });
      P.ellipse(g, 0, -40, 100, 34, brass, { k: 0.2 });
      P.ellipse(g, 0, -40, 84, 28, "#F1E8D2", { k: 0.05 });
      let d = "";
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, l = i % 2 ? 0.55 : 0.92; d += `M0 -40L${f1(Math.sin(a) * 80 * l)} ${f1(-40 - Math.cos(a) * 26 * l)}`; }
      P.stroke(g, d, "#6B5236", 1.4, { op: 0.7 });
      F.el("text", { x: 0, y: -60, "text-anchor": "middle", "font-family": "EB Garamond, serif", "font-size": 13, fill: "#6B5236", text: "N" }, g);
      const needle = F.el("g", null, g);
      P.path(needle, "M0 -44L-6 -40L0 -36L64 -40Z", "#2E3440", { sw: 1 });
      P.path(needle, "M0 -44L6 -40L0 -36L-64 -40Z", "#B8452F", { sw: 1 });
      P.circle(g, 0, -40, 4, brass, { sw: 1 });
      const head = o.needle ?? 0;
      S.on((t) => { const w = o.wobble === false ? 0 : 22 * Math.exp(-t * 0.8) * Math.sin(t * 4.5) + 2 * Math.sin(t * 1.3); const a = (head + w - 90) * D;
        needle.setAttribute("transform", `translate(0 -40) matrix(${Math.cos(a).toFixed(3)} ${(Math.sin(a) * 0.34).toFixed(3)} ${(-Math.sin(a)).toFixed(3)} ${(Math.cos(a) * 0.34).toFixed(3)} 0 0) translate(0 40)`); });
      return { g: outer, center: at(0, -40) };
    };

    // ── vehicles ─────────────────────────────────────────────────────────────────────
    // a spoked wheel (local, centre cx, cy); returns the spinning group
    function wheel(P, parent, cx, cy, r, o = {}) {
      const g = F.el("g", null, parent);
      const tyre = o.tyre || "#5A4632", rim = o.rim || "#8A6A45", n = o.spokes ?? 12;
      P.circle(g, cx, cy, r, "none", { stroke: tyre, sw: 1, line: true });
      F.el("circle", { cx: f1(cx), cy: f1(cy), r: f1(r - (o.tw ?? r * 0.06) / 2), fill: "none", stroke: P.col(tyre), "stroke-width": f1(o.tw ?? r * 0.08) }, g);
      F.el("circle", { cx: f1(cx), cy: f1(cy), r: f1(r * 0.86), fill: "none", stroke: P.col(rim), "stroke-width": f1(o.rw ?? r * 0.05) }, g);
      const sp = F.el("g", null, g);
      let d = "";
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; d += `M${f1(cx + Math.cos(a) * r * 0.1)} ${f1(cy + Math.sin(a) * r * 0.1)}L${f1(cx + Math.cos(a) * r * 0.86)} ${f1(cy + Math.sin(a) * r * 0.86)}`; }
      F.el("path", { d, stroke: P.col(o.spoke || rim), "stroke-width": f1(o.sw ?? Math.max(1, r * 0.035)), fill: "none" }, sp);
      P.circle(sp, cx, cy, r * 0.12, o.hub || K.dark(rim, 0.2), { k: 0.2, sw: 1 });
      return sp;
    }
    // spin helper: returns a function(t) → rotation in degrees from rps, or from a move (distance / radius)
    function spinner(o, rWorld) {
      if (o.move) { const m = o.move; return (t) => { const x = F.keys(t, [[m.t0 ?? 0, m.x0 ?? 0], [m.t1 ?? 1, m.x1 ?? 0]], m.e || "smooth"); return ((x - (m.x0 ?? 0)) / rWorld) * 180 / Math.PI; }; }
      if (o.spin) return (t) => o.spin * 360 * t;
      return null;
    }
    function mover(o, outer) {
      if (!o.move) return;
      const m = o.move, y0 = o.y ?? 900;
      S.on((t) => { const x = F.keys(t, [[m.t0 ?? 0, m.x0 ?? 0], [m.t1 ?? 1, m.x1 ?? 0]], m.e || "smooth"); outer.setAttribute("transform", `translate(${f1(x - (o.x ?? 960))} ${f1((m.y ?? y0) - y0)})`); });
    }

    // a safety bicycle, c. 1900 (side view); wheels and cranks turn with spin (rps) or with move {x0, x1, t0, t1}
    prop.bicycle = (L, o = {}) => {
      const { P, g, at, outer, s } = start(L, o, "bicycle", 330, 540);
      const frame = o.color || "#2B2B30", tyre = "#8C6A48";
      if (o.shadow !== false) soft(L, g, 0, 2, 260, 12, "#20140C", 0.3);
      const R0 = 106, rear = [-158, -R0], front = [160, -R0], bb = [-12, -96];
      const w1 = wheel(P, g, rear[0], rear[1], R0, { tyre, rim: "#A8A8AA", spokes: 28, tw: 11, rw: 3, sw: 1, spoke: "#B8B8BA", hub: "#6E6E72" });
      const w2 = wheel(P, g, front[0], front[1], R0, { tyre, rim: "#A8A8AA", spokes: 28, tw: 11, rw: 3, sw: 1, spoke: "#B8B8BA", hub: "#6E6E72" });
      const seat = [-62, -268], head = [118, -272], headLo = [128, -226];
      const tube = (a, b, w) => P.stroke(g, `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`, frame, w);
      tube(bb, seat, 9); tube(seat, head, 8); tube(bb, headLo, 9); tube(bb, rear, 7); tube(seat, rear, 6);
      P.stroke(g, `M${head[0]} ${head[1]}L${headLo[0]} ${headLo[1]}Q${front[0] - 8} ${front[1] - 40} ${front[0]} ${front[1]}`, frame, 7);
      P.stroke(g, `M${seat[0]} ${seat[1]}L${seat[0] - 8} ${seat[1] - 34}`, "#8A8A8E", 6);
      P.path(g, `M${seat[0] - 42} ${seat[1] - 40}Q${seat[0] - 8} ${seat[1] - 54} ${seat[0] + 22} ${seat[1] - 44}Q${seat[0] - 10} ${seat[1] - 28} ${seat[0] - 42} ${seat[1] - 40}Z`, "#6B4A32", { k: 0.2 });
      P.stroke(g, `M${head[0]} ${head[1]}L${head[0] - 4} ${head[1] - 30}Q${head[0] - 40} ${head[1] - 40} ${head[0] - 60} ${head[1] - 20}`, "#8A8A8E", 6);
      P.rect(g, head[0] - 72, head[1] - 26, 22, 10, "#6B4A32", { rx: 4, sw: 1 });
      const crank = F.el("g", null, g);
      P.circle(crank, bb[0], bb[1], 26, "none", { stroke: "#8A8A8E", sw: 5, line: true });
      P.stroke(crank, `M${bb[0]} ${bb[1] - 46}L${bb[0]} ${bb[1] + 46}`, "#9A9A9E", 6);
      P.rect(crank, bb[0] - 14, bb[1] - 52, 28, 9, "#3A3A3E", { sw: 1, rx: 2 });
      P.rect(crank, bb[0] - 14, bb[1] + 43, 28, 9, "#3A3A3E", { sw: 1, rx: 2 });
      P.stroke(g, `M${bb[0]} ${bb[1] - 26}L${rear[0]} ${rear[1] - 10}M${bb[0]} ${bb[1] + 26}L${rear[0]} ${rear[1] + 10}`, "#6E6E72", 2.5);
      const rot = spinner(o, R0 * s);
      if (rot) S.on((t) => { const a = rot(t); w1.setAttribute("transform", `rotate(${f1(a)} ${rear[0]} ${rear[1]})`); w2.setAttribute("transform", `rotate(${f1(a)} ${front[0]} ${front[1]})`);
        crank.setAttribute("transform", `rotate(${f1(a * 0.45)} ${bb[0]} ${bb[1]})`); });
      mover(o, outer);
      return { g: outer, seat: at(seat[0] - 10, seat[1] - 46), bars: at(head[0] - 60, head[1] - 22), pedal: at(bb[0], bb[1]), front: at(front[0], 0), rear: at(rear[0], 0) };
    };

    // a cart. kind: cart (two wheels, shafts) | wagon (four wheels; cover: true for a canvas top) | chariot ;
    // load: hay | barrels | crates | none ; wheels turn with spin or move
    prop.cart = (L, o = {}) => {
      const kind = o.kind || "cart";
      const { P, g, at, outer, s } = start(L, o, "cart", 300, kind === "wagon" ? 560 : 520);
      const wood = o.color || "#9A7048";
      if (o.shadow !== false) soft(L, g, 0, 2, kind === "wagon" ? 300 : 230, 14, "#20140C", 0.3);
      const wheels = [];
      if (kind === "chariot") {
        P.stroke(g, "M40 -110L300 -150", K.dark(wood, 0.2), 8);
        P.path(g, "M-80 -110L-70 -190Q-10 -230 50 -190L60 -110Z", o.paint || "#A8452F", { k: 0.18 });
        P.path(g, "M-70 -190Q-10 -230 50 -190", null, { stroke: "#D8B55A", sw: 5 });
        P.stroke(g, "M-70 -190Q-10 -230 50 -190", "#D8B55A", 5);
        wheels.push([wheel(P, g, -20, -90, 90, { spokes: 6, tyre: "#5A4632", rim: "#7A5436", tw: 10, rw: 8, sw: 6 }), -20, -90, 90]);
      } else {
        const len = kind === "wagon" ? 460 : 300, x0 = -len / 2;
        if (kind === "cart") P.stroke(g, `M${x0 + len - 10} -150L${x0 + len + 240} -170`, K.dark(wood, 0.15), 10);
        else P.stroke(g, `M${x0 + len - 10} -80L${x0 + len + 180} -60`, K.dark(wood, 0.15), 8);
        const bedY = kind === "wagon" ? -150 : -160;
        if (o.load === "hay") P.path(g, `M${x0 + 4} ${bedY - 70}C${x0 + 30} ${bedY - 190} ${x0 + len - 30} ${bedY - 200} ${x0 + len - 4} ${bedY - 70}Z`, "#E3C471", { k: 0.2 });
        if (o.load === "barrels") for (let i = 0; i < 2; i++) prop.barrel(L, { parent: g, x: x0 + len * (0.3 + i * 0.4), y: bedY - 60, s: 0.5, shadow: false });
        if (o.load === "crates") for (let i = 0; i < 2; i++) prop.crate(L, { parent: g, x: x0 + len * (0.28 + i * 0.4), y: bedY - 60, s: 0.55, shadow: false });
        if (kind === "wagon" && o.cover) P.path(g, `M${x0 + 10} ${bedY - 60}C${x0 + 10} ${bedY - 300} ${x0 + len - 10} ${bedY - 300} ${x0 + len - 10} ${bedY - 60}Z`, "#EDE6D3", { k: 0.14 });
        P.path(g, `M${x0} ${bedY - 70}L${x0 + len} ${bedY - 70}L${x0 + len - 12} ${bedY}L${x0 + 12} ${bedY}Z`, wood, { k: 0.12 });
        let pl = "";
        for (let i = 1; i < 3; i++) pl += `M${x0 + 6} ${bedY - 70 + i * 23}H${x0 + len - 6}`;
        for (let xx = x0 + 40; xx < x0 + len - 20; xx += 60) pl += `M${xx} ${bedY - 70}V${bedY}`;
        P.stroke(g, pl, K.dark(wood, 0.35), 2, { op: 0.6 });
        if (kind === "wagon") {
          wheels.push([wheel(P, g, x0 + 80, -85, 85, { spokes: 12, tw: 9, rw: 6, sw: 3 }), x0 + 80, -85, 85]);
          wheels.push([wheel(P, g, x0 + len - 70, -70, 70, { spokes: 10, tw: 8, rw: 5, sw: 3 }), x0 + len - 70, -70, 70]);
        } else wheels.push([wheel(P, g, 0, -110, 110, { spokes: 12, tw: 10, rw: 7, sw: 4 }), 0, -110, 110]);
      }
      const rot = spinner(o, wheels[0][3] * s);
      if (rot) S.on((t) => { const a = rot(t); for (const [wg, cx, cy, r] of wheels) wg.setAttribute("transform", `rotate(${f1(a * wheels[0][3] / r)} ${cx} ${cy})`); });
      mover(o, outer);
      return { g: outer, hitch: at(kind === "wagon" ? 230 + 180 : kind === "chariot" ? 300 : 390, kind === "chariot" ? -150 : -170), seat: at(-40, -230) };
    };

    // ── ships ────────────────────────────────────────────────────────────────────────
    // side view; (x, y) = the waterline under the middle. kind: merchant (ancient single mast, striped square sail)
    // | galley (oars that row, a ram, shields) | galleon (three masts) | felucca (Nile lateen sail) | steamer (funnel
    // smoke). rock = roll amplitude in degrees (default 1.2); water: draw a strip of waves over the hull bottom
    prop.ship = (L, o = {}) => {
      const kind = o.kind || "merchant";
      const nat = { merchant: 600, galley: 780, galleon: 720, felucca: 440, steamer: 760 }[kind] || 600;
      const { P, g, at, outer, s } = start(L, o, "ship", nat * 0.9, nat);
      const R = K.R(o.seed ?? 2, 311);
      const rock = F.el("g", null, g);
      const wood = o.color || (kind === "galleon" ? "#5E3A26" : kind === "steamer" ? "#26282C" : "#7A5236");
      const sailC = o.sailColor || (kind === "galley" ? "#EFE3C8" : "#F1E8D4");
      const stripe = o.stripe || "#B0492F";
      const striped = (c, st) => K.lgs(L, [[0, P.col(K.dark(c, 0.08))], [0.28, P.col(c)], [0.28, P.col(st)], [0.36, P.col(st)], [0.36, P.col(c)], [0.64, P.col(c)], [0.64, P.col(st)], [0.72, P.col(st)], [0.72, P.col(c)], [1, P.col(K.dark(c, 0.12))]], "h");
      const sail = (d, c = sailC, st = stripe) => P.path(rock, d, c, { fill: o.stripes === false ? K.lg(L, P.col(K.lite(c, 0.06)), P.col(K.dark(c, 0.1)), "h") : striped(c, st), inkOf: "#8C7E66" });
      const line = (d, w = 1.6, c = "#4A3B2E") => P.stroke(rock, d, c, w);
      const out = { g: outer, deck: at(0, -100) };
      let flags = [];
      if (kind === "merchant") {
        line("M-10 -560L285 -125M-10 -560L-285 -112M-10 -540L-10 -100", 2);
        P.path(rock, "M-290 -110C-200 -96 100 -96 250 -112L292 -132C282 -70 240 -10 170 10L-200 10C-262 -10 -292 -60 -290 -110Z", wood, { k: 0.14 });
        P.stroke(rock, "M-286 -100C-200 -88 100 -88 280 -118", K.lite(wood, 0.25), 6);
        P.stroke(rock, "M-280 -104C-300 -160 -310 -210 -272 -222C-248 -228 -250 -200 -266 -198", wood, 12);
        P.rect(rock, -16, -560, 12, 460, "#8A6440", { dir: "h", k: 0.2 });
        P.stroke(rock, "M-235 -500Q-10 -512 215 -500", "#6B4A32", 9);
        sail("M-228 -496L208 -496Q238 -350 196 -206Q-10 -176 -210 -206Q-258 -350 -228 -496Z");
        P.stroke(rock, "M-268 -110L-300 10", "#6B4A32", 8);
        P.path(rock, "M-306 -10L-290 -12L-282 30L-300 34Z", "#6B4A32", { k: 0.2 });
        P.circle(rock, 250, -90, 7, "#EDE3CC", { sw: 1 }); P.circle(rock, 251, -90, 3.5, "#2A1E18", { line: false });
      } else if (kind === "galley") {
        const ports = [];
        for (let x = -280; x <= 290; x += 34) ports.push(x);
        P.path(rock, "M-360 -72C-200 -62 200 -62 330 -72L372 -44L404 -6L330 2C200 20 -200 20 -330 2C-372 -20 -382 -52 -360 -72Z", wood, { k: 0.14 });
        const oars = F.el("g", null, rock);
        const oarEls = ports.map(() => P.stroke(oars, "", K.dark("#9A7650", 0.1), 5));
        P.path(rock, "M372 -44L404 -6L352 -4Z", "#B8863E", { k: 0.25 });
        P.stroke(rock, "M-350 -64C-200 -54 200 -54 340 -62", K.lite(wood, 0.3), 5);
        let pd = ""; for (const x of ports) pd += `M${x} -45a5 5 0 1 0 0.1 0Z`;
        F.el("path", { d: pd, fill: P.col("#2A1E18") }, rock);
        P.stroke(rock, "M-356 -70C-392 -130 -396 -178 -366 -190C-340 -196 -338 -168 -352 -160", wood, 12);
        const shields = F.el("g", null, rock);
        for (let x = -300; x <= 300; x += 42) P.circle(shields, x, -84, 15, (x / 42) % 2 ? "#B0492F" : "#D9B56A", { k: 0.25, sw: 1.2 });
        P.circle(rock, 330, -54, 9, "#EDE3CC", { sw: 1 }); P.circle(rock, 332, -54, 4.5, "#2A1E18", { line: false });
        line("M0 -520L360 -60M0 -520L-350 -70", 2);
        P.rect(rock, -7, -520, 14, 450, "#8A6440", { dir: "h", k: 0.2 });
        if (o.sail !== false) { P.stroke(rock, "M-200 -470Q0 -482 200 -470", "#6B4A32", 8); sail("M-196 -466L196 -466Q222 -330 186 -212Q0 -186 -186 -212Q-222 -330 -196 -466Z"); }
        else { P.stroke(rock, "M-200 -470Q0 -482 200 -470", "#6B4A32", 8); P.rect(rock, -190, -482, 380, 26, sailC, { k: 0.2, rx: 12 }); }
        const row = o.row ?? 0.55;
        const setOars = (t) => {
          const ph = t * row * Math.PI * 2, sw = Math.sin(ph), lift = Math.max(0, Math.cos(ph));
          ports.forEach((x, i) => {
            const a = (28 + sw * 16) * D, len = 190;
            oarEls[i].setAttribute("d", `M${x} -45L${f1(x - Math.sin(a) * len)} ${f1(-45 + Math.cos(a) * len - lift * 26)}`);
          });
        };
        setOars(0);
        if (row) S.on(setOars);
      } else if (kind === "galleon") {
        line("M180 -700L440 -300M0 -780L180 -700M0 -780L-190 -620M-190 -620L-330 -270M0 -780L-330 -270", 1.6);
        P.path(rock, "M-332 -270L-250 -268L-238 -205C-100 -178 150 -178 240 -205L300 -226L342 -236C306 -86 256 -2 150 18L-250 18C-316 -20 -336 -120 -332 -270Z", wood, { k: 0.14 });
        P.stroke(rock, "M-326 -150C-100 -130 150 -130 330 -160", "#C9A24E", 7);
        let gp = ""; for (let x = -250; x <= 230; x += 50) gp += `M${x} -122h18v16h-18Z`;
        F.el("path", { d: gp, fill: P.col("#1E1410") }, rock);
        for (let i = 0; i < 3; i++) P.rect(rock, -320 + i * 22, -250, 14, 20, "#F2D27A", { sw: 1 });
        P.stroke(rock, "M300 -226L440 -300", "#6B4A32", 8);
        const mast = (x, top, yards) => {
          P.rect(rock, x - 6, top, 12, -200 - top, "#8A6440", { dir: "h", k: 0.2 });
          yards.forEach(([y0, y1, w]) => { P.stroke(rock, `M${x - w} ${y0}L${x + w} ${y0}`, "#6B4A32", 6); sail(`M${x - w + 4} ${y0 + 2}L${x + w - 4} ${y0 + 2}Q${x + w + 18} ${(y0 + y1) / 2} ${x + w - 10} ${y1}Q${x} ${y1 + 18} ${x - w + 10} ${y1}Q${x - w - 18} ${(y0 + y1) / 2} ${x - w + 4} ${y0 + 2}Z`, sailC, sailC); });
          const fl = F.el("path", { fill: P.col(o.flag || "#B0492F") }, rock);
          flags.push({ fl, x, y: top });
        };
        mast(180, -700, [[-640, -500, 120], [-470, -300, 150]]);
        mast(0, -780, [[-720, -560, 140], [-540, -320, 175]]);
        P.rect(rock, -196, -620, 12, 420, "#8A6440", { dir: "h", k: 0.2 });
        sail("M-190 -600L-60 -330L-300 -300Z", sailC, sailC);
        flags.push({ fl: F.el("path", { fill: P.col(o.flag || "#B0492F") }, rock), x: -190, y: -620 });
      } else if (kind === "felucca") {
        P.path(rock, "M-200 -50C-100 -40 100 -40 196 -58L216 -76C192 -22 150 0 100 6L-150 6C-190 -10 -206 -30 -200 -50Z", o.color || "#EDE6D8", { k: 0.14 });
        P.stroke(rock, "M-198 -46C-100 -36 100 -36 200 -56", "#3F6E8E", 6);
        P.rect(rock, 34, -300, 10, 256, "#8A6440", { dir: "h", k: 0.2 });
        P.path(rock, "M-214 -66Q-20 -340 206 -548Q170 -320 86 -70Z", sailC, { fill: K.lg(L, P.col("#FBF7EE"), P.col("#DDD3BE"), "d"), inkOf: "#8C7E66" });
        P.stroke(rock, "M-226 -56L216 -562", "#6B4A32", 6);
      } else if (kind === "steamer") {
        line("M250 -520L360 -150M250 -520L-290 -520M-290 -520L-330 -110", 1.4);
        P.path(rock, "M-342 -102L330 -112L362 -152C332 -40 282 8 200 20L-300 20C-340 0 -352 -60 -342 -102Z", wood, { k: 0.12 });
        P.stroke(rock, "M-340 -92L336 -102", "#EDE6D8", 5);
        P.rect(rock, -230, -200, 380, 90, "#F1ECE2", { k: 0.08 });
        P.rect(rock, 120, -260, 120, 60, "#F1ECE2", { k: 0.08 });
        let wd = ""; for (let x = -214; x < 140; x += 30) wd += `M${x} -176h14v18h-14Z`;
        for (let x = 134; x < 230; x += 26) wd += `M${x} -246h14v16h-14Z`;
        F.el("path", { d: wd, fill: P.col("#3E5870") }, rock);
        for (const [fx, fh] of [[-110, 190], [20, 200]]) {
          P.path(rock, `M${fx - 24} -200L${fx - 34} ${-200 - fh}L${fx + 16} ${-200 - fh}L${fx + 26} -200Z`, o.funnel || "#C4473A", { k: 0.2 });
          P.path(rock, `M${fx - 34} ${-200 - fh}L${fx - 32} ${-200 - fh + 30}L${fx + 18} ${-200 - fh + 30}L${fx + 16} ${-200 - fh}Z`, "#26282C", { k: 0.2 });
          const puffs = [];
          for (let i = 0; i < 6; i++) puffs.push(F.el("circle", { fill: K.soft(L, P.col("#8E8A86"), 0.55) }, rock));
          S.on((t) => puffs.forEach((pf, i) => { const u = (t * 0.35 + i / 6) % 1; pf.setAttribute("cx", f1(fx - 10 - u * 260)); pf.setAttribute("cy", f1(-205 - fh - u * 160)); pf.setAttribute("r", f1(20 + u * 70)); pf.setAttribute("opacity", ((1 - u) * 0.9).toFixed(3)); }));
        }
        P.rect(rock, 244, -520, 8, 410, "#6B5A4A", { k: 0.2 }); P.rect(rock, -294, -520, 8, 420, "#6B5A4A", { k: 0.2 });
      }
      if (flags.length) S.on((t) => flags.forEach((f, i) => { const a = Math.sin(t * 4 + i) * 6, b = Math.sin(t * 4 + i + 1.3) * 6;
        f.fl.setAttribute("d", `M${f.x} ${f.y}Q${f.x - 30} ${f.y + a} ${f.x - 60} ${f.y + 6 + b}L${f.x} ${f.y + 22}Z`); }));
      if (o.water !== false) {
        const wc = P.col(o.waterColor || "#7AB3C1"), half = nat / 2 + 60;
        const wfill = K.ulg(L, [[0, wc, 0], [0.18, wc, 0.95], [0.82, wc, 0.95], [1, wc, 0]], -half, 0, half, 0);
        const cfill = K.ulg(L, [[0, "#E6F3F2", 0], [0.2, "#E6F3F2", 0.9], [0.8, "#E6F3F2", 0.9], [1, "#E6F3F2", 0]], -half, 0, half, 0);
        const wv = F.el("path", { fill: wfill }, g);
        const crest = F.el("path", { fill: "none", stroke: cfill, "stroke-width": 4, "stroke-linecap": "round" }, g);
        const waves = (t) => {
          let d = `M${-half} 60`, c = "";
          for (let x = -half; x <= half; x += 40) { const y = -2 + Math.sin(x * 0.03 + t * 2.2) * 5; d += `L${x} ${f1(y)}`; c += (x === -half ? "M" : "L") + `${x} ${f1(y)}`; }
          wv.setAttribute("d", d + `L${half} 60Z`); crest.setAttribute("d", c);
        };
        waves(0);
        S.on(waves);
      }
      const amp = o.rock ?? 1.2;
      if (amp) S.on((t) => rock.setAttribute("transform", `translate(0 ${f1(Math.sin(t * 1.6 + (o.seed ?? 2)) * 3)}) rotate(${f1(amp * Math.sin(t * 1.1 + (o.seed ?? 2)))})`));
      mover(o, outer);
      void R; void s;
      return out;
    };
    prop.galley = (L, o = {}) => prop.ship(L, Object.assign({ kind: "galley" }, o));

    // ── animals ──────────────────────────────────────────────────────────────────────
    // a jointed leg: hip (hx, hy), segment lengths l1, l2, widths w0, w1, w2; angles a1 (from vertical,
    // + forward), a2 (bend of the lower segment); returns path d + the foot point
    function legPath(hx, hy, l1, l2, w0, w1, w2, a1, a2) {
      const kx = hx + Math.sin(a1) * l1, ky = hy + Math.cos(a1) * l1;
      const fx = kx + Math.sin(a1 + a2) * l2, fy = ky + Math.cos(a1 + a2) * l2;
      const n = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, m = Math.hypot(dx, dy) || 1; return [-dy / m, dx / m]; };
      const [n1x, n1y] = n(hx, hy, kx, ky), [n2x, n2y] = n(kx, ky, fx, fy);
      const kxN = (n1x + n2x) / 2, kyN = (n1y + n2y) / 2;
      const d = `M${f1(hx + n1x * w0)} ${f1(hy + n1y * w0)}L${f1(kx + kxN * w1)} ${f1(ky + kyN * w1)}L${f1(fx + n2x * w2)} ${f1(fy + n2y * w2)}L${f1(fx - n2x * w2)} ${f1(fy - n2y * w2)}L${f1(kx - kxN * w1)} ${f1(ky - kyN * w1)}L${f1(hx - n1x * w0)} ${f1(hy - n1y * w0)}Z`;
      return { d, fx, fy, kx, ky, ang: a1 + a2 };
    }
    // a four-legged walker (horse, camel): body drawn by `body(P, g)`, legs animated with a 4-beat walk
    function quadruped(L, o, cls, native, spec) {
      const { P, g, at, outer, s } = start(L, o, cls, native, spec.w);
      if (o.shadow !== false) soft(L, g, -20, 0, spec.w * 0.45, 16, "#20140C", 0.32);
      const col = o.color || spec.color, dark = o.dark || spec.dark;
      const farLegs = F.el("g", null, g), bodyG = F.el("g", null, g), nearLegs = F.el("g", null, g);
      const legEls = spec.legs.map((lg) => ({ lg, el: F.el("path", { fill: lg.near ? P.fill(col, 0.1, "h") : P.fill(K.dark(col, 0.18), 0.08, "h"), stroke: P.ink(col), "stroke-width": f1(P.sw), "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }, lg.near ? nearLegs : farLegs),
        hoof: F.el("path", { fill: P.col(spec.hoof || "#3A2E26") }, lg.near ? nearLegs : farLegs),
        knee: spec.knee ? F.el("ellipse", { rx: lg.w1 * 1.25, ry: lg.w1 * 1.1, fill: P.col(K.dark(lg.near ? col : K.dark(col, 0.18), 0.15)) }, lg.near ? nearLegs : farLegs) : null }));
      spec.body(P, bodyG, col, dark);
      const walk = o.walk ?? (o.move ? 0.9 : 0);
      const pose = (t) => {
        const bob = walk ? -Math.abs(Math.sin(t * walk * Math.PI * 2)) * spec.bob : 0;
        bodyG.setAttribute("transform", `translate(0 ${f1(bob)})`);
        for (const { lg, el, hoof, knee } of legEls) {
          let a1 = lg.rest * D, a2 = (lg.bend0 || 0) * D;
          if (walk) {
            const p = (t * walk + lg.phase) * Math.PI * 2;
            a1 = (lg.rest + lg.swing * Math.sin(p)) * D;
            a2 = ((lg.bend0 || 0) - lg.bend * Math.max(0, Math.cos(p)) * (lg.front ? 1 : -0.6)) * D;
          }
          const r = legPath(lg.x, lg.y + bob, lg.l1, lg.l2, lg.w0, lg.w1, lg.w2, a1, a2);
          el.setAttribute("d", r.d);
          if (knee) { knee.setAttribute("cx", f1(r.kx)); knee.setAttribute("cy", f1(r.ky)); }
          const hw = lg.w2 * 1.5, hh = spec.hoofH;
          const ca = Math.cos(r.ang), sa = Math.sin(r.ang);
          const pt = (u, v) => `${f1(r.fx + u * ca + v * sa)} ${f1(r.fy - u * sa + v * ca)}`;
          hoof.setAttribute("d", `M${pt(-hw * 0.8, 0)}L${pt(hw * 0.8, 0)}L${pt(hw, hh)}L${pt(-hw * 1.1, hh)}Z`);
        }
      };
      pose(0);
      if (walk) S.on(pose);
      mover(o, outer);
      void s;
      return { P, g, outer, at };
    }

    // a horse, side view facing right (flip: left). color: bay | chestnut | grey | black | white | "#hex";
    // walk: strides per second (auto 0.9 with move {x0, x1, t0, t1}); harness: a collar and bridle
    prop.horse = (L, o = {}) => {
      const COL = { bay: ["#8B5A3C", "#2E221C"], chestnut: ["#A0603A", "#6B3A22"], grey: ["#B9B4AC", "#6E6A66"], black: ["#3E3431", "#1E1816"], white: ["#EAE4D8", "#B8B0A2"], dun: ["#C9A56E", "#4A3A2C"] };
      const [c0, d0] = COL[o.color] || [o.color || COL.bay[0], COL.bay[1]];
      const legs = [
        { x: 150, y: -300, l1: 150, l2: 136, w0: 25, w1: 15, w2: 11, rest: 3, swing: 20, bend: 60, phase: 0.25, near: false, front: true },
        { x: -212, y: -305, l1: 145, l2: 142, w0: 32, w1: 15, w2: 11, rest: -14, bend0: 16, swing: 17, bend: 40, phase: 0.0, near: false },
        { x: 162, y: -300, l1: 150, l2: 136, w0: 25, w1: 15, w2: 11, rest: -3, swing: 20, bend: 60, phase: 0.75, near: true, front: true },
        { x: -200, y: -305, l1: 145, l2: 142, w0: 32, w1: 15, w2: 11, rest: -8, bend0: 12, swing: 17, bend: 40, phase: 0.5, near: true },
      ];
      const q = quadruped(L, Object.assign({}, o, { color: c0, dark: d0 }), "horse", 700, { w: 780, color: c0, dark: d0, bob: 5, hoofH: 14, legs,
        body: (P, g2, col, dark) => {
          const tail = F.el("g", null, g2);
          P.path(tail, "M-272 -452C-312 -450 -332 -418 -336 -360C-340 -300 -328 -250 -316 -218L-298 -222C-304 -282 -310 -342 -290 -412Z", dark, { k: 0.15 });
          if (o.walk || o.move) K.sway(S, tail, { amp: 4, f: 0.9, ox: -272, oy: -452 });
          P.path(g2, "M160 -480C100 -470 -40 -462 -130 -470C-190 -478 -245 -478 -275 -450C-300 -425 -305 -375 -290 -340C-280 -312 -262 -296 -238 -288C-190 -270 -120 -262 -40 -262C40 -262 100 -268 140 -280C175 -285 205 -300 220 -330C235 -360 240 -390 236 -410C262 -470 310 -530 338 -560C350 -570 365 -560 385 -545C410 -530 440 -512 452 -505C468 -500 472 -520 464 -535C440 -575 395 -620 355 -650L335 -662C290 -640 230 -570 160 -480Z",
            col, { fill: K.lgs(L, [[0, P.col(K.lite(col, 0.14))], [0.55, P.col(col)], [1, P.col(K.dark(col, 0.2))]], "v") });
          // mane, forelock, ears
          P.path(g2, "M334 -664C306 -652 250 -600 196 -530C180 -508 168 -492 158 -482L176 -478C196 -506 214 -528 236 -556C272 -598 312 -636 346 -652Z", dark, { k: 0.1, sw: 1 });
          P.path(g2, "M350 -652C366 -646 378 -632 380 -618C368 -626 356 -632 346 -636Z", dark, { sw: 1 });
          P.path(g2, "M336 -660L334 -704L352 -664Z", col, { k: 0.1 });
          P.path(g2, "M322 -662L312 -700L332 -666Z", K.dark(col, 0.2), { k: 0.1 });
          // eye, nostril, mouth, cheek
          P.ellipse(g2, 382, -604, 7.5, 5.5, "#1E1612", { line: false });
          P.circle(g2, 384, -606, 2, "#FFFFFF", { line: false });
          P.ellipse(g2, 458, -522, 6, 4, K.dark(col, 0.45), { line: false });
          P.stroke(g2, "M452 -506Q440 -508 432 -514", K.dark(col, 0.4), 2);
          P.path(g2, "M384 -548C370 -560 366 -580 378 -588", null, { stroke: K.dark(col, 0.18), sw: 2 });
          P.stroke(g2, "M384 -548C370 -560 366 -580 378 -588", K.dark(col, 0.2), 2, { op: 0.6 });
          P.stroke(g2, "M-150 -290C-60 -276 60 -278 120 -292", K.dark(col, 0.18), 2, { op: 0.6 });
          if (o.harness) {
            P.stroke(g2, "M346 -640L456 -518M372 -606L420 -548M340 -575L385 -548", "#3A2A20", 5);
            P.path(g2, "M205 -470C250 -440 252 -360 226 -330L206 -338C226 -380 224 -430 192 -460Z", "#6B4A32", { k: 0.2 });
          }
        } });
      return { g: q.outer, back: q.at(0, -470), head: q.at(385, -610), hitch: q.at(-280, -330), nose: q.at(462, -520) };
    };

    // a dromedary camel, side view facing right; walk / move as the horse; saddle: a blanket and a load
    prop.camel = (L, o = {}) => {
      const c0 = o.color || "#C9A26E", d0 = K.dark(c0, 0.35);
      const legs = [
        { x: 100, y: -405, l1: 200, l2: 196, w0: 24, w1: 12, w2: 9, rest: 3, swing: 18, bend: 50, phase: 0.25, near: false, front: true },
        { x: -196, y: -412, l1: 205, l2: 196, w0: 34, w1: 12, w2: 9, rest: -8, bend0: 8, swing: 16, bend: 35, phase: 0.0, near: false },
        { x: 112, y: -405, l1: 200, l2: 196, w0: 24, w1: 12, w2: 9, rest: -3, swing: 18, bend: 50, phase: 0.75, near: true, front: true },
        { x: -184, y: -412, l1: 205, l2: 196, w0: 34, w1: 12, w2: 9, rest: -3, bend0: 6, swing: 16, bend: 35, phase: 0.5, near: true },
      ];
      const q = quadruped(L, Object.assign({}, o, { color: c0 }), "camel", 720, { w: 720, color: c0, dark: d0, bob: 6, hoofH: 9, hoof: K.dark(c0, 0.25), knee: true, legs,
        body: (P, g2, col) => {
          P.stroke(g2, "M-240 -500C-256 -468 -262 -426 -254 -388", K.dark(col, 0.2), 5);
          P.path(g2, "M-257 -392l-8 34l16 -2Z", K.dark(col, 0.45), { line: false });
          P.path(g2, "M120 -560C90 -640 20 -705 -50 -705C-120 -705 -165 -640 -195 -575C-215 -545 -240 -520 -245 -480C-250 -440 -235 -405 -210 -395C-140 -380 20 -380 90 -392C130 -398 150 -420 160 -450C210 -440 260 -430 290 -460C315 -490 330 -540 340 -590C360 -600 395 -598 420 -592C440 -590 446 -608 440 -622C425 -640 395 -652 368 -656L362 -676L350 -656C335 -652 322 -630 315 -600C305 -560 285 -520 255 -510C215 -500 160 -520 120 -560Z",
            col, { fill: K.lgs(L, [[0, P.col(K.lite(col, 0.16))], [0.6, P.col(col)], [1, P.col(K.dark(col, 0.15))]], "v") });
          P.path(g2, "M150 -452C140 -430 118 -410 96 -404L100 -396C130 -402 152 -424 162 -448Z", K.dark(col, 0.2), { line: false });
          P.ellipse(g2, 386, -634, 6, 4.5, "#1E1612", { line: false });
          P.circle(g2, 388, -636, 1.6, "#FFFFFF", { line: false });
          P.stroke(g2, "M378 -642Q388 -650 398 -644", K.dark(col, 0.35), 2);
          P.stroke(g2, "M438 -616C442 -608 440 -600 432 -596", K.dark(col, 0.4), 2);
          if (o.saddle) {
            P.path(g2, "M-130 -650C-80 -712 40 -712 84 -640L70 -540L-140 -540Z", o.saddle === true ? "#9C3B32" : o.saddle, { k: 0.2 });
            P.stroke(g2, "M-136 -574H76", "#D8B55A", 5);
            let fr = ""; for (let x = -136; x < 76; x += 9) fr += `M${x} -540v14`;
            P.stroke(g2, fr, "#D8B55A", 2.5);
          }
        } });
      return { g: q.outer, back: q.at(-50, -705), head: q.at(390, -640), nose: q.at(440, -610) };
    };

    // a bird seen from below with wings spread. kind: hawk (buzzard: fingered wingtips, barred tail) | gull ;
    // flap: wingbeats per second (0 = soaring); bank: roll in degrees; path: [[t, x, y], …] to fly along
    prop.bird = (L, o = {}) => {
      const kind = o.kind || "hawk";
      const { P, g, at, outer, s } = start(L, o, "bird", 120, 460);
      const body = kind === "gull" ? "#F4F4F2" : "#7E5A3A", wing = kind === "gull" ? "#E4E8EB" : "#D2B48A", tip = kind === "gull" ? "#2A2A2E" : "#3A2A1E";
      const bank = F.el("g", null, g);
      const wingG = [-1, 1].map((sd) => {
        const wf = F.el("g", null, bank);
        const wg = F.el("g", { transform: kind === "gull" ? "" : `scale(1.3 1.22)` }, wf);
        const w = kind === "gull"
          ? `M14 -18C${sd * 70} -30 ${sd * 130} -36 ${sd * 160} -30C${sd * 200} -40 ${sd * 236} -30 ${sd * 252} -22C${sd * 222} -12 ${sd * 190} -6 ${sd * 160} -2C${sd * 110} 10 ${sd * 60} 16 ${sd * 14} 14Z`.replace(/^M14/, `M${sd * 14}`)
          : `M${sd * 18} -26C${sd * 70} -40 ${sd * 120} -44 ${sd * 158} -40L${sd * 200} -40L${sd * 186} -30L${sd * 218} -28L${sd * 196} -20L${sd * 228} -14L${sd * 200} -8L${sd * 226} 2L${sd * 196} 6L${sd * 216} 16L${sd * 186} 18C${sd * 150} 34 ${sd * 90} 44 ${sd * 18} 26Z`;
        P.path(wg, w, wing, { fill: K.lg(L, P.col(K.lite(wing, 0.1)), P.col(K.dark(wing, 0.1)), "v") });
        if (kind === "gull") P.path(wg, `M${sd * 200} -36C${sd * 226} -34 ${sd * 242} -28 ${sd * 252} -22C${sd * 232} -14 ${sd * 212} -10 ${sd * 196} -8Z`, tip, { sw: 1 });
        else {
          P.path(wg, `M${sd * 18} -26C${sd * 70} -40 ${sd * 120} -44 ${sd * 158} -40L${sd * 150} -26C${sd * 110} -30 ${sd * 60} -26 ${sd * 18} -14Z`, K.dark(body, 0.05), { line: false });
          P.path(wg, `M${sd * 160} -40L${sd * 200} -40L${sd * 186} -30L${sd * 218} -28L${sd * 196} -20L${sd * 228} -14L${sd * 200} -8L${sd * 226} 2L${sd * 196} 6L${sd * 216} 16L${sd * 186} 18L${sd * 178} 0Z`, tip, { sw: 1 });
          P.ellipse(wg, sd * 150, -22, 12, 9, K.dark(body, 0.2), { line: false });
          let bars = "";
          for (let i = 1; i < 5; i++) bars += `M${sd * (30 + i * 28)} ${-22 + i}Q${sd * (36 + i * 28)} 10 ${sd * (28 + i * 27)} ${34 - i}`;
          P.stroke(wg, bars, K.dark(wing, 0.25), 2, { op: 0.35 });
        }
        return wf;
      });
      if (kind === "gull") P.path(bank, "M-12 -40C-14 -20 -12 30 -6 50L6 50C12 30 14 -20 12 -40C8 -52 -8 -52 -12 -40Z", body, { k: 0.1 });
      else {
        P.path(bank, "M-10 40L-34 96L34 96L10 40Z", body, { k: 0.15 });
        P.stroke(bank, "M-24 70H24M-28 84H28", K.dark(body, 0.35), 3);
        P.path(bank, "M-16 -38C-22 -10 -20 30 -10 48L10 48C20 30 22 -10 16 -38C10 -54 -10 -54 -16 -38Z", body, { k: 0.12 });
      }
      P.circle(bank, 0, -44, kind === "gull" ? 11 : 13, kind === "gull" ? "#F6F6F4" : K.dark(body, 0.1), { k: 0.1 });
      const flap = o.flap ?? (kind === "gull" ? 0 : 0);
      const b0 = o.bank ?? 0;
      S.on((t) => {
        const a = flap ? Math.sin(t * flap * Math.PI * 2) * 28 : 3 * Math.sin(t * 0.8);
        wingG[0].setAttribute("transform", `rotate(${f1(a)})`); wingG[1].setAttribute("transform", `rotate(${f1(-a)})`);
        bank.setAttribute("transform", `rotate(${f1(b0 + (flap ? 0 : 5 * Math.sin(t * 0.35)))})`);
      });
      if (o.path) S.on((t) => { const x = F.pchip(t, o.path.map((p) => [p[0], p[1]])), y = F.pchip(t, o.path.map((p) => [p[0], p[2]])); outer.setAttribute("transform", `translate(${f1(x - (o.x ?? 960))} ${f1(y - (o.y ?? 900))})`); });
      void s;
      return { g: outer, center: at(0, 0), tips: [at(-230, 0), at(230, 0)] };
    };

    // a flock of distant birds: little "M" strokes that flap and drift (the gulls over the Kitty Hawk dunes)
    prop.flock = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 331), n = o.n ?? 7, [ax, ay, aw, ah] = o.area || [900, 120, 700, 220];
      const g = F.el("g", { class: "flock" }, o.parent || L.g);
      const c = K.air(o.color || "#3E3E46", o.far || 0, airOf(o));
      const birds = [];
      for (let i = 0; i < n; i++) {
        const sz = (o.s ?? 1) * (9 + R() * 8);
        birds.push({ x: ax + R() * aw, y: ay + R() * ah, sz, ph: R() * 6, f: (o.flap ?? 2.2) * (0.8 + 0.4 * R()), el: F.el("path", { fill: "none", stroke: c, "stroke-width": f1(Math.max(1.4, sz * 0.18)), "stroke-linecap": "round", "stroke-linejoin": "round" }, g) });
      }
      const [vx, vy] = o.drift || [18, -2];
      S.on((t) => {
        for (const b of birds) {
          const k = Math.sin(t * b.f * Math.PI * 2 + b.ph), hh = b.sz * (0.18 + 0.42 * k), x = b.x + vx * t, y = b.y + vy * t + Math.sin(t * 0.7 + b.ph) * 4;
          b.el.setAttribute("d", `M${f1(x - b.sz)} ${f1(y + b.sz * 0.1)}Q${f1(x - b.sz * 0.45)} ${f1(y - hh)} ${f1(x)} ${f1(y)}Q${f1(x + b.sz * 0.45)} ${f1(y - hh)} ${f1(x + b.sz)} ${f1(y + b.sz * 0.1)}`);
        }
      });
      return { g };
    };

    // ── toys, machines ───────────────────────────────────────────────────────────────
    // a toy. kind: helicopter (the Pénaud "bat": bamboo, cork, paper rotors, a twisted rubber band; spin in
    // turns per second — fast spins blur into discs) | kite (a diamond kite with a bowed tail)
    prop.toy = (L, o = {}) => {
      const kind = o.kind || "helicopter";
      if (kind === "kite") {
        const { P, g, at, outer } = start(L, o, "toy", 260);
        const c = o.color || "#C4473A";
        const kg = F.el("g", null, g);
        P.path(kg, "M0 -260L90 -150L0 0L-90 -150Z", c, { fill: K.lg(L, P.col(K.lite(c, 0.12)), P.col(K.dark(c, 0.12)), "d") });
        P.path(kg, "M0 -260L90 -150L0 -150Z", "#EDE3CC", { k: 0.1 });
        P.path(kg, "M0 0L-90 -150L0 -150Z", "#EDE3CC", { k: 0.1 });
        P.stroke(kg, "M0 -260V0M-90 -150H90", "#6B4A32", 3);
        const tail = F.el("path", { fill: "none", stroke: P.col("#6B4A32"), "stroke-width": 2 }, kg);
        const bows = [0, 1, 2, 3].map(() => F.el("path", { fill: P.col("#E0A13A") }, kg));
        S.on((t) => {
          let d = "M0 0";
          const pts = [];
          for (let i = 1; i <= 8; i++) { const px = Math.sin(t * 3 + i * 0.8) * i * 5, py = i * 40; d += `L${f1(px)} ${py}`; pts.push([px, py]); }
          tail.setAttribute("d", d);
          bows.forEach((b, i) => { const [px, py] = pts[i * 2 + 1]; b.setAttribute("d", `M${f1(px)} ${py}l-14 -8v16Zl14 -8v16Z`); });
          kg.setAttribute("transform", `rotate(${f1(Math.sin(t * 1.3) * 6)} 0 -150)`);
        });
        return { g: outer, bridle: at(0, -150) };
      }
      const { P, g, at, outer } = start(L, o, "toy", 300);
      const bamboo = "#D9B56A", cork = "#B98A5E", paper = "#EFE6D0";
      P.rect(g, -5, -290, 10, 290, bamboo, { dir: "h", k: 0.2 });
      P.stroke(g, "M-5 -210h10M-5 -110h10", K.dark(bamboo, 0.3), 2);
      let band = "M8 -262";
      for (let i = 0; i < 20; i++) band += `L${i % 2 ? 4 : 13} ${-262 + (i + 1) * 12.2}`;
      P.stroke(g, band, "#8A5A34", 3);
      const rotor = (yy, dir) => {
        const rg = F.el("g", null, g);
        const disc = F.el("ellipse", { cx: 0, cy: yy, rx: 140, ry: 16, fill: P.col("#F2EADB"), opacity: 0 }, rg);
        const blades = [0, 1].map(() => F.el("path", { fill: P.fill(paper, 0.08, "h"), stroke: P.ink(paper), "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }, rg));
        const spars = [0, 1].map(() => F.el("path", { fill: "none", stroke: P.col("#A07A3E"), "stroke-width": 2.5 }, rg));
        P.rect(g, -12, yy - 10, 24, 20, cork, { k: 0.2, rx: 4 });
        return (t, rate) => {
          const a = dir * rate * 360 * t * D;
          const blur = clamp((rate - 3) / 4, 0, 1);
          disc.setAttribute("opacity", (blur * 0.55).toFixed(3));
          [0, 1].forEach((i) => {
            const c = Math.cos(a + i * Math.PI), sn = Math.sin(a + i * Math.PI), L0 = 16 * Math.sign(c || 1), L1 = 140 * c;
            blades[i].setAttribute("d", `M${f1(L0)} ${f1(yy - 5)}L${f1(L1)} ${f1(yy - 14 - 4 * sn)}L${f1(L1)} ${f1(yy + 12 - 4 * sn)}L${f1(L0)} ${f1(yy + 5)}Z`);
            spars[i].setAttribute("d", `M0 ${yy}L${f1(L1 * 0.96)} ${f1(yy - 2 - 4 * sn)}`);
            blades[i].setAttribute("opacity", (1 - blur * 0.7).toFixed(3));
            spars[i].setAttribute("opacity", (1 - blur * 0.7).toFixed(3));
          });
        };
      };
      const top = rotor(-280, 1), bot = rotor(-12, -1);
      const rate = (t) => (typeof o.spin === "function" ? o.spin(t) : Array.isArray(o.spin) ? F.keys(t, o.spin, "smooth") : o.spin ?? 0);
      let acc = 0, last = 0;
      const upd = (t) => { const r = rate(t); acc += r * (t - last); last = t; top(acc / Math.max(r, 1e-6) * r, r); bot(acc, r); };
      const pose = (t) => { const r = rate(t); const turns = Array.isArray(o.spin) ? integrate(t) : r * t; top(turns / Math.max(r, 1e-6), r); bot(turns / Math.max(r, 1e-6), r); };
      const integrate = (t) => { let sum = 0; const n = 40; for (let i = 0; i < n; i++) sum += F.keys((t * (i + 0.5)) / n, o.spin, "smooth") * (t / n); return sum; };
      void upd; void acc;
      pose(0);
      S.on(pose);
      return { g: outer, top: at(0, -290), hand: at(0, -150) };
    };

    // a satellite. kind: panels (gold-foil body, blue solar wings, a dish) | sputnik ; spin: °/s
    prop.satellite = (L, o = {}) => {
      const kind = o.kind || "panels";
      const { P, g, at, outer } = start(L, o, "satellite", 240, 560);
      const rg = F.el("g", null, g);
      if (kind === "sputnik") {
        for (const a of [150, 165, 195, 210]) P.stroke(rg, `M0 -120L${f1(Math.cos(a * D) * 300)} ${f1(-120 + Math.sin(a * D) * 300)}`, "#B8BCC0", 3);
        F.el("circle", { cx: 0, cy: -120, r: 60, fill: K.urg(L, [[0, "#FFFFFF"], [0.35, "#D8DCE0"], [1, "#7E868E"]], -20, -140, 80) }, rg);
      } else {
        const panel = (sx) => {
          P.stroke(rg, `M${sx * 50} -120H${sx * 80}`, "#9A9EA2", 5);
          P.rect(rg, sx > 0 ? 80 : -280, -160, 200, 80, "#2E4F86", { fill: K.lg(L, P.col("#4A74B0"), P.col("#1E3A6A"), "d") });
          let gr = "";
          for (let i = 1; i < 6; i++) gr += `M${(sx > 0 ? 80 : -280) + i * 33.3} -160v80`;
          gr += `M${sx > 0 ? 80 : -280} -120h200`;
          P.stroke(rg, gr, "#8FB0D8", 1.2, { op: 0.6 });
        };
        panel(-1); panel(1);
        P.rect(rg, -50, -170, 100, 100, "#D9A93E", { fill: K.lg(L, P.col("#F2CD6A"), P.col("#A67A22"), "d") });
        P.path(rg, "M-50 -170L-30 -186L70 -186L50 -170Z", "#E9C766", { k: 0.1 });
        P.path(rg, "M50 -170L70 -186L70 -86L50 -70Z", "#9C7020", { k: 0.1 });
        let cr = "";
        for (let i = 0; i < 6; i++) cr += `M${-44 + i * 16} -164l8 30l-6 26`;
        P.stroke(rg, cr, "#8E6418", 1.2, { op: 0.6 });
        P.stroke(rg, "M0 -186V-236", "#9A9EA2", 4);
        P.path(rg, "M-50 -250Q0 -210 50 -250Q0 -236 -50 -250Z", "#F2F2F0", { k: 0.2 });
        P.stroke(rg, "M0 -236L0 -262", "#9A9EA2", 2);
        P.stroke(rg, "M30 -70L60 -30M-30 -70L-50 -34", "#9A9EA2", 2);
      }
      if (o.spin) S.on((t) => rg.setAttribute("transform", `rotate(${f1(o.spin * t)} 0 -120)`));
      mover(o, outer);
      return { g: outer, center: at(0, -120) };
    };

    // an airliner. view: below (planform, as seen climbing overhead — the reference's opening shot) | side ;
    // r rotates it (default −35 for below); contrail: two white trails from the engines
    prop.airliner = (L, o = {}) => {
      const view = o.view || "below";
      const { P, g, at, outer } = start(L, Object.assign({ r: view === "below" ? -35 : 0 }, o), "airliner", 220, 600);
      const white = "#F4F6F8", shade = "#C3CCD6";
      const body = K.lg(L, P.col(white), P.col(shade), "v");
      if (view === "side") {
        P.path(g, "M-150 -40L-60 -40L-230 -150L-270 -150Z", white, { fill: body });
        P.path(g, "M-300 -40C-300 -70 -260 -84 -200 -84L240 -84C290 -84 316 -64 318 -44C316 -24 290 -8 240 -8L-230 -8C-270 -8 -300 -20 -300 -40Z", white, { fill: body });
        P.path(g, "M-300 -52L-250 -150L-214 -150L-236 -60Z", white, { fill: body });
        P.path(g, "M-40 -30L110 -30L40 30L-10 30Z", "#DDE3EA", { k: 0.1 });
        P.rect(g, 20, -2, 90, 30, "#DDE3EA", { fill: K.lg(L, P.col("#EEF2F6"), P.col("#AEB8C4"), "v"), rx: 14 });
        let wd = ""; for (let x = -200; x < 250; x += 18) wd += `M${x} -62h8v9h-8Z`;
        F.el("path", { d: wd, fill: P.col("#4E5E72") }, g);
        P.path(g, "M270 -70Q292 -72 300 -60L284 -60Z", "#4E5E72", { sw: 1 });
        P.stroke(g, "M-296 -46H310", "#6E8FB8", 5, { op: 0.8 });
        return { g: outer, nose: at(318, -44), tail: at(-300, -40) };
      }
      if (o.contrail !== false) {
        for (const sy of [-1, 1]) {
          const grad = K.ulg(L, [[0, "#FFFFFF", 0.85], [1, "#FFFFFF", 0]], -20, 0, -1600, 0);
          F.el("path", { d: `M-20 ${sy * 100 - 6}L-1600 ${sy * 110 - 26}L-1600 ${sy * 110 + 26}L-20 ${sy * 100 + 6}Z`, fill: grad }, g);
        }
      }
      for (const sy of [-1, 1]) {
        P.path(g, `M40 ${sy * 20}L-50 ${sy * 24}L-190 ${sy * 262}L-150 ${sy * 262}Z`, white, { fill: K.lg(L, P.col(white), P.col(shade), sy < 0 ? "v" : "u") });
        P.path(g, `M-230 ${sy * 14}L-268 ${sy * 14}L-318 ${sy * 104}L-296 ${sy * 104}Z`, white, { fill: K.lg(L, P.col(white), P.col(shade), "v") });
        const ey = sy * 104;
        P.rect(g, -20, ey - 16, 92, 32, "#E6EBF0", { fill: K.lg(L, P.col("#F6F8FA"), P.col("#B8C2CE"), sy < 0 ? "v" : "u"), rx: 15 });
        P.ellipse(g, 72, ey, 5, 13, "#4A5058", { sw: 1 });
      }
      P.path(g, "M-300 0C-300 -14 -270 -26 -220 -28L250 -28C300 -28 320 -12 322 0C320 12 300 28 250 28L-220 28C-270 26 -300 14 -300 0Z", white, { fill: K.lgs(L, [[0, P.col(shade)], [0.35, P.col(white)], [0.6, P.col(white)], [1, P.col(K.dark(shade, 0.1))]], "v") });
      P.stroke(g, "M-296 0H300", shade, 2, { op: 0.6 });
      if (o.glint !== false) {
        const sp = F.el("path", { d: "M0 -30Q2 -2 30 0Q2 2 0 30Q-2 2 -30 0Q-2 -2 0 -30Z", fill: "#FFFFFF", opacity: 0 }, g);
        S.on((t) => { const k = Math.max(0, Math.sin(t * 1.4 + 1)); sp.setAttribute("transform", `translate(180 -20) scale(${(0.4 + k * 0.8).toFixed(3)})`); sp.setAttribute("opacity", (k * 0.9).toFixed(3)); });
      }
      mover(o, outer);
      return { g: outer, nose: at(322, 0), tail: at(-300, 0) };
    };
  });
})();
