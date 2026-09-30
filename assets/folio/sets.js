/* FOLIO — sets: skies, terrain, vegetation, architecture, interiors, space (S.set.*).
 *
 * HOW TO USE (read this first)
 *  • Every helper draws into a layer:  const L = S.layer({p: .3, name: "far"});  S.set.dunes(L, {...});
 *    and returns a handle {g, …anchors}. Anchors are in the layer's world coordinates (the 1920×1080 frame at rest,
 *    y down). Objects stand on their base: (x, y) = where they touch the ground, unless noted.
 *  • Parallax planes that look right: sky p .05–.12 · far .25–.4 (blur 1) · mid .5–.7 · subject 1 · foreground
 *    1.3–1.5 with blur 5–9 (grass, a lamp post, a column edge). Big fills use data-cover, so they never show an edge
 *    when the camera moves; the rest spans ±800 px beyond the frame.
 *  • Atmospheric perspective: far: 0…1 mixes every colour toward the air colour (lighter, bluer, less contrast);
 *    air: "#hex" overrides it (default: the air of the last S.set.sky, e.g. warm at dusk). Distant rows of dunes,
 *    hills, mountains, trees on a street already fade on their own.
 *  • seed: varies the random layout. parent: draw inside a given <g> instead of L.g.
 *  • Animation is built in and cheap (transforms/opacity per frame): clouds drift, water shimmers, foam breathes,
 *    palms/trees/grass/reeds sway, flags flutter, flames and glows flicker, stars twinkle, the Earth turns, the
 *    train's windows stream. Most take sway/drift/spin: 0 to hold still. Frame cost ≈ 0.12 s at 1080p.
 *  • The quickest way to a beautiful frame: S.set.stage(kind) builds a whole layered scene (below). Then add props
 *    (S.prop.*), people and labels on out.ground (p 1).
 *
 * STAGE — a full composition in one call (creates its own layers: sky, far, mid, ground, fg)
 *  S.set.stage(kind, {seed, time: "day"|"dawn"|"dusk"|"night", fg: true, palms: true, motes})
 *     kind: desert | nile | beach (dune left, sea, beach grass) | flats (overcast wet sand, puddles) | hills |
 *     mountains | farmland (seen from high up, clouds below) | fieldsAbove | desertAbove (top-down) | street (1900) |
 *     courtyard (Greek, stoa + temple) | harbour | space | orbit (Earth's limb) | moon (lunar surface, Earth in sky)
 *     | library | parlour | workshop | train
 *     space/orbit draw a full moon at the upper left (x 330, y 250) — pass moon: false, or sun: {x, y, r} for the sun
 *     there instead (never paint a light over the moon); orbit = the Earth's limb across the bottom (x 960, y 1650, r 1200)
 *     → {layers: {sky, far, mid, ground, fg} (always all five: a plane the stage lacks is the nearest one it has; fg
 *        is an empty blurred foreground plane when the stage draws none), ground (the layer to stand people on), floor (y of the ground line),
 *        surface(x) (dune stages), sky, street, earth, room}
 *
 * SKY & LIGHT
 *  sky(L, {kind: day|dawn|dusk|night|overcast|space|void, horizon: 700, sun: {x,y,r}|false, moon: {x,y,r,phase}|false,
 *        clouds: n (day 5, dawn/dusk 4), cloudSize: 520, cloudArea: [x,y0,w,y1], contrails: n, stars: n, drift, stops})
 *        → {g, horizon, air, sun, moon, clouds, stars}. Also sets the default air colour for everything drawn after.
 *  cloud(L, {x, y (flat base), w: 460, h, kind, colors: [lit, mid, shade], far, shade: true})  one puffy cartoon cloud
 *  clouds(L, {n: 5, horizon, area: [x, y0, w, y1], size: 520, drift: 7 px/s, far, kind, avoid: {x,y}})  a drifting field
 *  contrails(L, {n: 5, angle, seed})   long soft white trails
 *  stratus(L, {horizon, n: 16, drift})  grey bands of an overcast sky (sky kind overcast adds them)
 *  sun(L, {x, y, r: 50, color, bloom: 10})   disc + bloom        moon(L, {x, y, r, phase: crescent|half|full, lit: right|left, glow})
 *  stars(L, {n: 180, area: [x,y,w,h], dim: 1, twinkle: true})
 *  haze(L, {kind: band|up|glow, y, h, a: .6, color (air), x, r, below, fade})  band: soft horizontal band; up: clear
 *        above y−h, colour from y down (distance haze over a far layer); glow: round haze (a sun at a vanishing point)
 *  lightShaft(L, {from: [x,y], to: [x,y] | angle+len, w0: 180, w1, color: "#FFE6B8", a: .3, soft: 4, pool: true,
 *        motes: 26 (uses S.motes), sway, blend: screen})   a visible shaft of light (window → floor) with dust
 *  glow(L, {x, y, r: 260, color: "#FFD9A0", a: .7, flicker: 0|.1, blend: screen})   a warm bloom around a light
 *  vignette(L, {a: .4, color, x, y, r: 1150, squash: .72})   darker warm edges, moves with the layer
 *
 * TERRAIN
 *  ground(L, {y: 700, kind: sand|grass|dirt|stone|snow|mud|lunar|wet|street|savanna, color, color2, haze: .3, streaks: 14})
 *  dunes(L, {y: 600 (horizon), n: 3 rows, h: 230, width: 900, gap: 70, light: right (shade on the left slopes),
 *        floor: true (front row flat), bushes: n, color: "#EBD4A2", shade, airFar: .42,
 *        bumps: [{x, w, h}] (place the front dunes yourself)}) → {floor, surface(x) = y of the front dune at x, rows}
 *  scrub(L, {n: 8, y0, y1, color, s})   little desert bushes      tufts(L, {n: 40, y0, y1, x0, x1, s, color})  grass tufts
 *  footprints(L, {from: [x,y], to: [x,y], n: 16, size: 16, color})
 *  sea(L, {y (horizon): 560, shore: y+70, color, colorFar, colorNear, waves: n, foam: true, tint})  shimmering sea
 *  beach(L, {y: 560, shore, sand})   sea + wet band + dry sand to the bottom
 *  flats(L, {y: 560, puddles: 14, size, sky: [top, bottom], tufts: 46})   wet overcast sand with mirror puddles
 *  hills(L, {y: 620, n: 3, h: 150, color: "#8DB26E", trees: 7|false, gap})   rolling rows, fading with distance
 *  mountains(L, {y: 620, n: 2, h: 300, color: "#8C9CB2", snow: false, light: left})
 *  river(L, {y (far bank): 620, h: 150, palms: n (far bank), reeds: 5|false, reedKind: papyrus|cattail|reed, reedH: 130,
 *        color, colorFar, colorNear, bankColor, ground}) → {bank (y of the near bank)}
 *  river(L, {view: "above", x, w: 70, path: [[x,y]…], green: true, banks, color})  a meandering ribbon from above
 *  farmland(L, {view: oblique|above, horizon: 300, palette: summer|autumn|spring|nile, haze: .75, river (above)})
 *  desertAbove(L, {color, dunes: 7 (crescent barchans), wind: 20°, ripples, puddles: n, tufts})   straight down
 *
 * VEGETATION (x, y = base; h = height in px)
 *  palm(L, {x, y, h: 520, lean, fronds: 14, frond: .42, dates: false, dead: 3, sway: 1.4, far}) → {top (crown), base}
 *  tree(L, {x, y, h: 420, kind: round|poplar|cypress|olive|pine|conifer|acacia|bare, color, bark, sway, far})
 *  bush(L, {x, y, w: 140, h, color})
 *  reeds(L, {x, y, w: 200, h: 300, n, kind: papyrus|cattail|reed, sway: 2})
 *  grass(L, {x, y, w: 600, h: 260, n, kind: beach|meadow|dry, color, sway: 3})   tall tufts — the blurred foreground
 *  wheat(L, {x, y, w: 1000, h: 240, n, color, mass: true, sway})
 *
 * ANCIENT (stone: color = marble|limestone|sandstone|granite|mud|white or "#hex")
 *  column(L, {x, y, h: 520, order: doric|ionic|egyptian|plain, color, thick}) → {top, base, w}
 *  colonnade(L, {x, y, w: 1500, h: 520, n: 7, order, steps: 3, wall: true, doors: 3, roof: true, painted: true})  a stoa, front
 *  colonnade(L, {view: "perspective", vp: {x,y}, near: {x, y, h}, n: 8, gap: .55, order, depth: .42})  receding stoa
 *  temple(L, {x, y, w: 1100, h: 640, n: 6, order, painted: true}) → {top, floor}
 *  obelisk(L, {x, y, h: 620, tip: gold|stone, glyphs: true, plinth: true}) → {top, base}
 *  pylon(L, {x, y, w: 1300, h: 560, flags: true}) → {gate}
 *  house(L, {x, y, w: 260, h, kind: mud|white|stone, windows: 2, sideDir: 1|-1, stairs, awning}) → {door, top}
 *  village(L, {y: 720, x0, x1, n: 9, size: 200, palms: true, kind, far})
 *  well(L, {x, y, w: 360, frame: true, bucket: true|"rim"|false, rope, roof, swing}) → {rim, bucket, beam}   side view
 *  well(L, {view: "top", x: 960, y: 540, r: 430, water: .3, sun: true|{x,y,r}|false, offset: [dx,dy], rings: 9})
 *        straight down the shaft; the sun shines back from the water with spreading ripples → {center, sun}
 *  courtyard(L, {vp: {x,y}, y (far edge): 640, slab: 110, color}) → {at(X, y) = floor point}   paving in perspective
 *  scrollShelf(L, {x, y, w: 420, h: 620, cell: 72, tag})   pigeonholes full of scroll ends
 *  lampstand(L, {x, y, h: 520})   bronze stand with a burning oil lamp
 *  library(L, {seed, columns: [x…], order: ionic, door: true, light: true, lightTo, table: true, lampstands: true,
 *        vignette: .78}) → {floor, table, lamp, shaft}   the Library of Alexandria, lamp-lit (complete scene)
 *  lighthouse(L, {x, y, h: 560, kind: pharos|modern, fire: true, glow}) → {fire, top}
 *  harbour(L, {y: 560, city: true, mole: true, lighthouse: true, ships: 3}) → {lighthouse, ships}
 *
 * 1850–1950
 *  storefront(L, {x, y, w: 1300, h: 900, sign: "GENERAL STORE", number: 1127, color (brick), trim, windows: 3})
 *        → {door, window: [x, y, w, h], sign}
 *  street(L, {vp: {x: 1180, y: 520}, left: true, right: true, poles, lamps, trees, fence, rails, lit, fog: 55, air})
 *        one-point perspective; → {pr(X, Y, Z) world→screen, scale(Z) px per metre at depth Z, ground(X, Z)}
 *        (X metres across: road −4…5, left facades −8, right walk 5…10; Y up; Z metres away)
 *  pole(L, {x, y, h: 700, arms: 2}) → {wires}      lampPost(L, {x, y, h: 520, lit: false}) → {light}
 *  room(L, {y (floor line): 780, vp, wall: paper|plaster|brick|wood|stone|blue|red|ochre, color, pattern: true,
 *        wainscot: true, ceiling: true, lampX, floor: boards|tiles|stone, floorColor}) → {floor, rail, wainscot}
 *  brickWall(L, {x, y, w, h, color})
 *  window(L, {x (centre), y (top), w: 300, h: 440, view: night|day|dusk, panes: [2, 3], curtains: true, curtainColor,
 *        tied, pelmet, light: true|{…lightShaft options}, floor}) → {center, sill, glass, shaft|glow}
 *  bookshelf(L, {x, y (bottom), w: 330, h: 640, shelves: 5, color, palette})
 *  rug(L, {x, y (centre on the floor), w: 1300, d: 260, vp, color: "#8E3A32", border: "#35507A"})
 *  picture(L, {x, y (centre), w: 190, h: 140, subject: landscape|sea|ship|portrait, frame})
 *  clock(L, {x, y, h: 180, kind: pendulum|wall, time: "10:10", swing: true, run})
 *  pegboard(L, {x, y, w: 300, h: 220, n: 6})      bench(L, {x, y, w: 700, h: 280}) → {top}
 *  workshop(L, {y: 800, lampX, windowX, pegX, shelfX, bench: true}) → {window, lamp, bench}   (complete scene)
 *  train(L, {view: night|day, speed: 1, windows: [[x,y,w,h]…], lampX, seat, wood}) → {seat, lamp}   (complete scene)
 *  parlour(L, {y: 780, vp, wall, view: night, tableX, shelfX, pictureX, windowX, table: true}) → {room, window,
 *        picture, shelf, rug, table, lamp}   the 1878 parlour of the reference (complete scene)
 *  lamp / table / chair / candle(L, o)   = S.prop.* (props.js)
 *
 * SPACE
 *  starfield(L, {kind: space|void, n: 280, milky: true, milkyAngle})
 *  earth(L, {x, y, r: 220, lon: 20 (facing us), tilt: 18, spin: 2 °/s, light: left|right|front, clouds: 30,
 *        night: true, glow: true, land, land2}) — real Natural Earth coastlines (public domain)
 *  moon(L, {x, y, r, phase: "full"}) — with maria and craters (see SKY for crescent/half)
 *  lunarSurface(L, {y: 560, craters: 16, rocks: 40, light: left, footprints: {from, to}|true})
 *
 * KIT (FOLIO.kit, shared with props.js): K.pen(L, {far, air, sw}) → .path/.rect/.circle/.ellipse/.poly (two-stop
 *  gradient fill + ink outline), .stroke, .soft; K.lg/lgs/ulg/urg/soft gradients (cached); K.curve, K.poly, K.blob,
 *  K.puffs, K.puffsFlat, K.cyl (cylinder shading), K.sway(S, el, {amp, f, ox, oy}), K.air(c, far, air), K.LAND, K.ortho.
 */
(function () {
  "use strict";
  const F = window.FOLIO;
  const W = F.W, H = F.H;

  // ══════════════════════════════════════════════════════════════════════════════════
  //  KIT — the drawing toolkit shared with props.js (FOLIO.kit)
  // ══════════════════════════════════════════════════════════════════════════════════
  const K = (F.kit = F.kit || {});
  const f1 = (K.f1 = (v) => (Math.round(v * 10) / 10).toString());
  const clamp = F.clamp, lerp = F.lerp;
  K.DARK = "#24160E";                                     // what shade mixes toward (warm, never black)
  K.lite = (c, k) => F.mix(c, "#FFFFFF", clamp(k, 0, 1));
  K.dark = (c, k) => F.mix(c, K.DARK, clamp(k, 0, 1));
  K.air = (c, far, air) => (far > 0 ? F.mix(c, air || "#D8E8F3", Math.min(0.94, far)) : c);
  K.R = (seed, salt = 0) => F.rnd(F.hash("s" + (seed ?? 1) + ":" + salt));
  K.rr = (R, a, b) => a + (b - a) * R();
  K.pick = (R, arr) => arr[Math.floor(R() * arr.length) % arr.length];
  K.deg = Math.PI / 180;

  // two-stop gradients, cached per layer (objectBoundingBox: one def serves every shape)
  const DIRS = { v: [0, 0, 0, 1], h: [0, 0, 1, 0], d: [0, 0, 1, 1], a: [1, 0, 0, 1], u: [0, 1, 0, 0], l: [1, 0, 0, 0] };
  K.lg = (L, c1, c2, dir = "v", a1 = 1, a2 = 1) => {
    const key = `${c1}|${c2}|${dir}|${a1}|${a2}`;
    const C = (L._lgc = L._lgc || new Map());
    let u = C.get(key);
    if (!u) { u = F.lg(L.defs, [[0, c1, a1], [1, c2, a2]], ...(DIRS[dir] || DIRS.v)); C.set(key, u); }
    return u;
  };
  // multi-stop gradient, cached: stops [[o, c, a], …]
  K.lgs = (L, stops, dir = "v") => {
    const key = "S" + JSON.stringify(stops) + dir;
    const C = (L._lgc = L._lgc || new Map());
    let u = C.get(key);
    if (!u) { u = F.lg(L.defs, stops, ...(DIRS[dir] || DIRS.v)); C.set(key, u); }
    return u;
  };
  // a soft radial fill (glows, contact shadows, soft blobs), cached: alpha a at the centre → 0 at the edge
  K.soft = (L, color, a = 1, shape = "soft") => {
    const key = `R${color}|${a}|${shape}`;
    const C = (L._lgc = L._lgc || new Map());
    let u = C.get(key);
    if (!u) {
      const st = shape === "hard" ? [[0, color, a], [0.7, color, a * 0.9], [1, color, 0]]
        : shape === "glow" ? [[0, color, a], [0.12, color, a * 0.75], [0.35, color, a * 0.32], [0.65, color, a * 0.1], [1, color, 0]]
        : shape === "ring" ? [[0, color, 0], [0.7, color, 0], [0.84, color, a], [1, color, 0]]
        : [[0, color, a], [0.45, color, a * 0.62], [1, color, 0]];
      u = F.rg(L.defs, st, 0.5, 0.5, 0.5);
      C.set(key, u);
    }
    return u;
  };
  // a user-space linear gradient (for fills that data-cover stretches, or that must line up with the world)
  K.ulg = (L, stops, x1, y1, x2, y2) => {
    const id = F.uid("ug");
    const g = F.el("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1, y1, x2, y2 }, L.defs);
    stops.forEach(([o, c, a]) => F.el("stop", { offset: o, "stop-color": c, "stop-opacity": a ?? 1 }, g));
    return `url(#${id})`;
  };
  K.urg = (L, stops, cx, cy, r, extra) => {
    const id = F.uid("ur");
    const g = F.el("radialGradient", Object.assign({ id, gradientUnits: "userSpaceOnUse", cx, cy, r }, extra || {}), L.defs);
    stops.forEach(([o, c, a]) => F.el("stop", { offset: o, "stop-color": c, "stop-opacity": a ?? 1 }, g));
    return `url(#${id})`;
  };

  // Catmull-Rom spline through points → cubic Bézier path
  K.curve = (pts, closed = false, tension = 1) => {
    const n = pts.length;
    if (n < 2) return "";
    const P = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), k = tension / 6;
      d += `C${f1(p1[0] + (p2[0] - p0[0]) * k)} ${f1(p1[1] + (p2[1] - p0[1]) * k)} ${f1(p2[0] - (p3[0] - p1[0]) * k)} ${f1(p2[1] - (p3[1] - p1[1]) * k)} ${f1(p2[0])} ${f1(p2[1])}`;
    }
    return closed ? d + "Z" : d;
  };
  K.poly = (pts, closed = true) => "M" + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join("L") + (closed ? "Z" : "");
  // an irregular smooth blob
  K.blob = (cx, cy, rx, ry, R, n = 9, jit = 0.18) => {
    const pts = [];
    const ph = R() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * Math.PI * 2, k = 1 + (R() - 0.5) * 2 * jit;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return K.curve(pts, true);
  };
  // outline of a union of circles [{x,y,r}] seen from its centre (canopies, bushes, smoke puffs)
  K.puffs = (cs, n) => {
    let sx = 0, sy = 0, sw = 0, per = 0;
    for (const c of cs) { const w = c.r * c.r; sx += c.x * w; sy += c.y * w; sw += w; per += c.r; }
    const cx = sx / sw, cy = sy / sw;
    n = n || Math.round(clamp(per * 1.3, 90, 420));
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
      let best = 0;
      for (const c of cs) {
        const bx = cx - c.x, by = cy - c.y, b = ux * bx + uy * by, cc = bx * bx + by * by - c.r * c.r, disc = b * b - cc;
        if (disc >= 0) { const t = -b + Math.sqrt(disc); if (t > best) best = t; }
      }
      pts.push([cx + ux * best, cy + uy * best]);
    }
    return K.poly(pts);
  };
  // a union of circles cut flat at y = base (clouds)
  K.puffsFlat = (cs, base, step = 5, flat0 = 1e9, flat1 = -1e9) => {
    let x0 = 1e9, x1 = -1e9, cL = null, cR = null;
    for (const c of cs) { if (c.x - c.r < x0) { x0 = c.x - c.r; cL = c; } if (c.x + c.r > x1) { x1 = c.x + c.r; cR = c; } }
    const top = [[x0, Math.min(cL.y, base)]], bot = [[x0, Math.min(cL.y, base)]];
    for (let x = x0; x <= x1 + 0.01; x += step) {
      let tY = 1e9, bY = -1e9;
      for (const c of cs) {
        const dx = x - c.x;
        if (Math.abs(dx) < c.r) { const s = Math.sqrt(c.r * c.r - dx * dx); tY = Math.min(tY, c.y - s); bY = Math.max(bY, c.y + s); }
      }
      if (tY > 1e8) continue;
      bY = x >= flat0 && x <= flat1 ? base : Math.min(bY, base);
      if (tY >= bY) continue;
      top.push([x, tY]); bot.push([x, bY]);
    }
    top.push([x1, Math.min(cR.y, base)]);
    return K.poly(top.concat(bot.reverse()));
  };

  // the pen: shapes with a soft two-stop gradient, an outline in a darker shade of the fill (never black),
  // everything mixed toward the air colour by `far` (atmospheric perspective)
  K.pen = (L, o = {}) => {
    const far = clamp(o.far || 0, 0, 1), air = o.air || K.defaultAir || "#D8E8F3";
    const col = (c) => K.air(c, far, air);
    const P = {
      L, far, air, col,
      sw: (o.sw ?? 2.2) * (1 - 0.65 * far),
      line: o.line ?? true,
      g(parent, t, attrs) { const g = F.el("g", attrs || null, parent || L.g); if (t) F.tf(g, t); return g; },
      fill(c, k = 0.1, dir = "v") {
        const cc = col(c); k *= 1 - 0.7 * far;
        return k <= 0.002 ? cc : K.lg(L, K.lite(cc, k), K.dark(cc, k * 1.15), dir);
      },
      ink(c) { return col(F.ink(c)); },
      shape(parent, tag, attrs, c, op = {}) {
        const a = Object.assign({}, attrs);
        a.fill = c && c !== "none" ? (op.flat ? col(c) : op.fill || P.fill(c, op.k ?? 0.1, op.dir)) : "none";
        const ln = op.line ?? P.line, sw = op.sw ?? P.sw;
        if (ln && sw > 0.25) {
          a.stroke = op.stroke ? col(op.stroke) : P.ink(op.inkOf || c || "#666666");
          a["stroke-width"] = f1(sw); a["vector-effect"] = "non-scaling-stroke"; a["stroke-linejoin"] = "round";
        }
        if (op.op != null) a.opacity = op.op;
        return F.el(tag, a, parent || L.g);
      },
      path(parent, d, c, op) { return P.shape(parent, "path", { d }, c, op); },
      rect(parent, x, y, w, h, c, op = {}) { return P.shape(parent, "rect", { x: f1(x), y: f1(y), width: f1(w), height: f1(h), rx: op.rx }, c, op); },
      circle(parent, cx, cy, r, c, op) { return P.shape(parent, "circle", { cx: f1(cx), cy: f1(cy), r: f1(r) }, c, op); },
      ellipse(parent, cx, cy, rx, ry, c, op) { return P.shape(parent, "ellipse", { cx: f1(cx), cy: f1(cy), rx: f1(rx), ry: f1(ry) }, c, op); },
      poly(parent, pts, c, op) { return P.shape(parent, "path", { d: K.poly(pts) }, c, op); },
      // a stroke (rope, wire, pole seen thin); scales with the drawing unless op.fixed
      stroke(parent, d, c, w, op = {}) {
        return F.el("path", { d, fill: "none", stroke: op.raw ? c : col(c), "stroke-width": f1(w), "stroke-linecap": op.cap || "round",
          "stroke-linejoin": "round", opacity: op.op, "stroke-dasharray": op.dash, "vector-effect": op.fixed ? "non-scaling-stroke" : undefined }, parent || L.g);
      },
      // soft ellipse (contact shadow, glow) — no filter, a baked radial gradient
      soft(parent, cx, cy, rx, ry, color, a = 0.5, shape = "soft", blend) {
        return F.el("ellipse", { cx: f1(cx), cy: f1(cy), rx: f1(rx), ry: f1(ry), fill: K.soft(L, color, a, shape),
          style: blend ? `mix-blend-mode:${blend}` : undefined }, parent || L.g);
      },
    };
    return P;
  };

  // a cylinder's horizontal shading (columns, jars, towers): lit on the left, cel shade on the right
  K.cyl = (L, c, k = 1, dir = "h") => K.lgs(L, [[0, K.dark(c, 0.08 * k)], [0.28, K.lite(c, 0.16 * k)], [0.55, c], [0.74, K.dark(c, 0.1 * k)], [0.76, K.dark(c, 0.2 * k)], [1, K.dark(c, 0.3 * k)]], dir);

  // per-frame helpers (need S)
  K.sway = (S, el, o = {}) => {
    const base = el.getAttribute("transform") || "", amp = o.amp ?? 2, fq = o.f ?? 0.35, seed = o.seed ?? 1;
    const ox = o.ox ?? 0, oy = o.oy ?? 0;
    S.on((t) => {
      const a = amp * (0.65 * Math.sin(t * fq * 2 * Math.PI + seed * 1.7) + 0.35 * F.noise(t * fq * 1.6, seed));
      el.setAttribute("transform", `${base} rotate(${a.toFixed(2)} ${f1(ox)} ${f1(oy)})`);
    });
  };

  // ══════════════════════════════════════════════════════════════════════════════════
  //  DATA
  // ══════════════════════════════════════════════════════════════════════════════════
  const SKY = {
    day:      { stops: [[0, "#7DB3E2"], [0.5, "#A3CDEE"], [0.86, "#CFE5F5"], [1, "#DDEBF3"]], cloud: ["#FFFFFF", "#E1ECF6", "#BCCFE2"], sun: "#FFF4D6", air: "#D9E8F2", clouds: 5 },
    dawn:     { stops: [[0, "#6D8CC2"], [0.45, "#ADAFD0"], [0.78, "#F0C3A6"], [1, "#FADCAE"]], cloud: ["#FFF4EC", "#F3CDBE", "#D29FA4"], sun: "#FFE3B0", air: "#F2D8C0", clouds: 4 },
    dusk:     { stops: [[0, "#2F4378"], [0.42, "#786595"], [0.76, "#DC927E"], [1, "#F5BE7B"]], cloud: ["#FFD6B6", "#D9958F", "#8B678A"], sun: "#FFD597", air: "#E9B49A", clouds: 4 },
    night:    { stops: [[0, "#0A1330"], [0.5, "#14234A"], [0.86, "#213664"], [1, "#2B446E"]], cloud: ["#3F5179", "#2C3C63", "#1D2A4A"], sun: "#EEF2FF", air: "#294068", clouds: 0 },
    overcast: { stops: [[0, "#939FAE"], [0.5, "#A7B1BC"], [0.86, "#C7CED4"], [1, "#DCE2E4"]], cloud: ["#E6E9EC", "#C6CDD4", "#A3ADB8"], sun: "#F4F4F0", air: "#D3D9DC", clouds: 0 },
    space:    { stops: [[0, "#02060D"], [0.55, "#0B1B36"], [1, "#224273"]], cloud: null, sun: "#FFFFFF", air: "#0B1B36", clouds: 0 },
    void:     { stops: [[0, "#000205"], [1, "#05080E"]], cloud: null, sun: "#FFFFFF", air: "#05080E", clouds: 0 },
  };
  K.SKY = SKY;

  // Natural Earth 1:110m land (public domain, naturalearthdata.com), merged and simplified; lon/lat × 10
  K.LAND = [[531,166,487,141,435,128,427,167,391,213,385,237,346,281,350,296,342,278,326,294,357,229,369,220,375,188,386,180,395,155,431,127,428,117,449,104,508,120,511,107,480,45,402,-27,392,-47,389,-63,405,-105,408,-148,398,-164,348,-198,354,-242,328,-256,323,-286,271,-335,200,-348,184,-339,182,-317,150,-263,143,-222,118,-180,118,-158,138,-111,123,-61,131,-59,122,-58,88,-7,98,19,94,39,86,48,61,43,41,64,16,62,-20,48,-40,52,-83,46,-125,74,-137,99,-167,124,-172,146,-161,175,-169,219,-144,263,-129,279,-105,291,-92,326,-69,340,-59,358,-19,351,13,365,97,373,111,369,105,363,111,352,102,338,152,324,157,314,189,303,201,311,201,322,216,329,291,308,312,316,326,311,345,316,360,346,360,369,328,360,306,369,297,362,273,370,262,400,334,420,384,409,410,412,418,420,415,427,369,453,393,471,349,462,354,454,366,454,339,444,325,454,336,461,308,466,275,425,288,410,226,405,228,388,241,377,232,380,231,368,216,371,214,382,228,380,211,384,194,403,193,419,132,458,123,454,124,442,185,401,169,405,165,399,172,390,161,379,157,400,88,444,61,431,33,432,33,419,7,408,-3,395,2,388,-21,368,-56,360,-69,372,-86,371,-95,387,-87,410,-89,433,-15,436,-11,463,-47,485,-14,486,-19,497,-2,493,19,510,42,514,36,515,47,528,85,536,86,571,105,574,103,566,108,565,96,555,104,544,143,537,212,553,211,568,217,576,244,573,245,584,238,584,235,592,289,598,287,606,237,600,214,606,211,626,254,650,242,658,216,654,215,644,179,628,171,616,172,607,190,598,167,584,160,562,133,553,126,561,129,566,114,590,70,580,57,585,49,617,97,636,148,678,183,695,230,701,247,710,291,709,309,703,298,697,320,700,410,677,412,668,393,661,325,669,348,659,349,646,374,638,380,643,365,648,369,652,398,646,403,650,398,656,407,660,441,662,440,685,459,685,467,679,449,675,467,668,538,690,540,682,589,690,599,684,609,690,602,696,610,699,685,683,691,690,671,697,673,707,667,709,690,727,715,729,728,727,719,715,727,708,725,691,735,686,716,668,692,666,719,662,748,678,746,687,776,689,738,692,743,707,731,714,737,718,757,723,753,713,761,712,775,713,760,719,785,724,830,717,808,725,806,736,866,739,867,747,877,751,969,759,1040,777,1139,759,1065,731,1103,740,1232,730,1244,738,1289,732,1294,723,1284,721,1312,707,1326,719,1373,714,1397,717,1396,725,1421,727,1495,722,1525,708,1580,710,1615,694,1676,697,1705,688,1710,690,1705,701,1800,690,1800,651,1775,647,1793,632,1791,623,1774,626,1736,617,1700,601,1692,606,1638,600,1620,581,1632,577,1628,568,1633,562,1621,561,1621,548,1601,542,1599,534,1568,510,1556,549,1560,567,1568,577,1637,609,1643,627,1608,608,1599,613,1603,618,1575,618,1543,598,1552,594,1540,591,1513,589,1520,592,1515,595,1496,598,1432,594,1353,549,1368,546,1373,535,1397,543,1414,532,1415,522,1402,485,1355,438,1332,427,1317,432,1298,417,1297,409,1276,398,1274,392,1293,373,1292,352,1265,344,1266,378,1247,381,1254,393,1244,400,1217,389,1223,405,1212,409,1189,392,1178,391,1176,386,1194,371,1208,378,1226,374,1192,350,1214,324,1211,317,1219,309,1210,306,1219,299,1216,284,1165,229,1143,223,1136,229,1135,222,1102,210,1101,203,1099,215,1083,217,1067,210,1056,190,1088,154,1094,130,1092,117,1068,104,1066,96,1049,86,1050,101,1009,127,1010,134,1000,134,992,97,1006,72,1034,49,1034,29,1043,15,1013,29,1001,64,982,84,987,122,976,165,972,171,954,157,942,161,946,176,940,194,906,231,902,218,871,215,868,203,803,157,798,103,775,81,766,89,735,161,726,223,720,212,707,207,690,222,702,230,677,238,664,256,614,251,573,258,564,272,537,267,513,281,500,302,489,304,480,300,482,290,508,248,510,260,515,259,513,246,519,240,544,243,561,261,566,245,598,225,579,202,578,190,551,170,531,166],[-713,119,-719,114,-717,91,-711,93,-715,110,-702,114,-700,122,-679,105,-651,101,-627,107,-623,98,-608,94,-613,84,-592,81,-572,55,-538,58,-512,41,-499,12,-519,-16,-509,-11,-504,-20,-490,-18,-474,-6,-451,-15,-443,-25,-400,-29,-372,-49,-356,-51,-348,-73,-353,-92,-388,-128,-392,-177,-411,-221,-420,-229,-446,-231,-479,-250,-488,-286,-503,-304,-512,-304,-542,-347,-578,-345,-584,-339,-582,-325,-583,-347,-573,-352,-567,-369,-582,-384,-621,-389,-624,-409,-651,-409,-651,-420,-637,-428,-650,-428,-644,-431,-656,-450,-676,-460,-658,-479,-689,-504,-684,-524,-708,-528,-713,-539,-722,-536,-714,-528,-731,-532,-740,-526,-739,-513,-751,-507,-743,-500,-747,-477,-742,-470,-757,-466,-727,-444,-733,-442,-725,-420,-740,-411,-732,-392,-737,-377,-715,-327,-701,-198,-704,-183,-715,-173,-759,-146,-788,-86,-812,-59,-813,-43,-797,-26,-810,-22,-809,-11,-801,8,-789,12,-772,39,-781,84,-794,90,-808,72,-856,99,-875,134,-911,139,-944,163,-965,157,-1034,183,-1055,200,-1058,226,-1094,257,-1095,267,-1139,316,-1148,318,-1147,302,-1094,235,-1101,230,-1121,248,-1124,262,-1150,277,-1140,284,-1157,298,-1175,333,-1206,346,-1237,389,-1244,405,-1239,456,-1246,484,-1222,480,-1228,490,-1277,511,-1281,529,-1303,537,-1300,559,-1306,548,-1309,557,-1336,577,-1469,610,-1517,592,-1506,613,-1541,594,-1533,589,-1542,582,-1629,550,-1576,576,-1575,584,-1604,591,-1618,586,-1622,602,-1639,598,-1661,618,-1644,632,-1611,636,-1612,649,-1661,646,-1681,657,-1647,666,-1602,664,-1637,672,-1664,684,-1662,689,-1568,713,-1367,689,-1271,702,-1261,695,-1248,700,-1236,694,-1230,698,-1156,690,-1140,684,-1154,679,-1100,680,-1072,669,-1083,686,-1062,689,-1016,677,-975,676,-984,681,-973,685,-953,673,-955,680,-936,685,-943,695,-965,703,-964,713,-952,719,-916,702,-927,697,-880,688,-882,678,-873,672,-849,691,-855,698,-826,697,-813,691,-826,684,-815,671,-845,662,-866,665,-860,660,-873,654,-897,659,-873,648,-924,628,-946,604,-947,589,-933,588,-923,570,-906,572,-851,553,-826,551,-823,530,-798,512,-785,523,-797,547,-773,556,-765,567,-772,580,-785,587,-773,600,-781,624,-736,625,-696,607,-697,593,-676,582,-645,603,-619,579,-611,559,-574,546,-582,544,-558,532,-557,521,-601,503,-665,502,-747,450,-690,483,-655,493,-643,489,-659,482,-647,477,-653,471,-645,462,-613,452,-657,436,-661,444,-645,453,-671,452,-702,438,-710,423,-704,416,-736,410,-757,380,-765,385,-759,367,-765,360,-758,356,-808,321,-815,309,-800,266,-804,253,-817,260,-828,278,-827,289,-837,299,-853,297,-863,305,-902,304,-896,299,-901,292,-937,298,-972,281,-976,270,-971,260,-979,226,-958,188,-945,182,-913,186,-904,210,-868,214,-889,159,-850,160,-834,152,-839,113,-822,90,-796,96,-769,81,-748,111,-717,124,-713,119],[-896,480,-918,467,-888,471,-866,465,-850,468,-840,460,-871,457,-878,449,-873,448,-879,432,-875,417,-863,424,-865,441,-855,448,-848,458,-835,453,-837,436,-829,441,-824,430,-813,446,-801,445,-808,460,-841,464,-849,479,-864,487,-880,490,-896,480],[-27,516,-49,516,-41,532,-29,537,-40,548,-51,549,-47,554,-59,566,-53,582,-31,586,-40,580,-18,575,-27,563,-32,561,-17,556,17,525,7,514,14,514,2,508,-53,502,-27,516],[-72,551,-61,552,-55,545,-62,541,-60,529,-66,522,-96,517,-104,519,-93,531,-100,543,-72,551],[340,2,322,0,317,-8,319,-27,328,-25,338,-22,333,-21,341,-6,348,-3,340,2],[539,373,539,389,527,404,546,412,538,421,528,413,526,428,503,443,528,456,529,470,493,465,468,444,503,404,490,391,491,377,522,366,539,373],[800,98,819,73,814,62,801,62,800,98],[-1798,689,-1702,662,-1722,654,-1730,643,-1761,655,-1783,655,-1797,658,-1794,655,-1800,651,-1798,689],[678,762,614,753,570,734,543,734,538,738,546,740,589,759,675,770,689,766,678,762],[553,733,564,732,553,719,571,706,546,707,516,721,538,733,553,733],[965,811,978,808,972,802,915,804,965,811],[977,802,1001,798,994,788,946,791,931,795,977,802],[1029,793,1053,785,1012,782,1003,787,1029,793],[1400,758,1453,756,1420,750,1391,747,1370,752,1388,762,1400,758],[1428,544,1443,493,1431,492,1426,481,1433,466,1418,465,1422,512,1417,523,1428,544],[1211,186,1223,184,1225,171,1214,153,1218,141,1237,139,1241,130,1226,139,1212,136,1209,147,1201,148,1198,163,1204,162,1206,185,1211,186],[1260,93,1266,72,1254,68,1255,57,1241,64,1240,77,1234,74,1225,77,1222,70,1223,80,1234,87,1242,83,1255,98,1260,93],[1410,-26,1445,-38,1458,-55,1474,-60,1478,-67,1471,-67,1472,-74,1507,-103,1478,-101,1460,-81,1445,-76,1426,-93,1389,-81,1391,-76,1378,-53,1337,-34,1330,-41,1323,-30,1339,-21,1323,-22,1313,-9,1340,-7,1350,-33,1378,-15,1410,-26],[209,802,269,802,240,792,187,798,209,802],[168,799,214,787,184,780,167,766,144,772,149,777,118,787,109,798,168,799],[1731,-413,1743,-410,1743,-417,1727,-433,1729,-439,1714,-441,1697,-466,1677,-462,1667,-462,1672,-450,1707,-429,1726,-405,1731,-413],[1733,-349,1743,-352,1747,-368,1755,-365,1761,-376,1785,-377,1771,-397,1760,-412,1746,-413,1753,-403,1738,-391,1746,-388,1748,-369,1733,-349],[1096,20,1109,15,1117,29,1155,50,1167,70,1192,54,1172,36,1181,23,1190,10,1177,7,1160,-36,1147,-42,1141,-33,1118,-35,1102,-29,1089,4,1096,20],[495,-124,505,-154,502,-160,496,-156,472,-248,455,-256,443,-252,434,-229,444,-199,440,-174,445,-162,463,-157,492,-121,495,-124],[1438,441,1453,432,1432,420,1407,426,1407,418,1400,416,1399,427,1413,432,1419,455,1438,441],[1312,336,1320,328,1313,314,1302,313,1302,321,1306,326,1297,334,1312,336],[1412,414,1420,398,1409,379,1409,357,1390,347,1365,347,1369,343,1359,336,1352,339,1354,345,1321,339,1310,344,1329,355,1357,355,1367,367,1383,372,1400,395,1399,406,1412,414],[965,52,975,52,1005,23,1035,5,1047,-24,1060,-31,1058,-57,1046,-59,1016,-32,986,19,955,48,954,56,965,52],[1249,10,1238,3,1203,4,1207,-14,1234,-6,1213,-19,1229,-44,1215,-46,1211,-32,1203,-31,1203,-55,1197,-57,1196,-40,1188,-32,1203,10,1238,8,1250,17,1249,10],[1074,-60,1087,-68,1125,-69,1144,-79,1146,-88,1127,-84,1066,-74,1055,-68,1061,-59,1074,-60],[-155,662,-136,651,-187,634,-218,642,-227,650,-220,655,-242,655,-224,664,-212,654,-204,660,-155,662],[-718,180,-744,183,-724,187,-731,199,-718,197,-701,196,-684,185,-718,180],[-300,836,-215,826,-251,820,-115,814,-201,798,-191,792,-210,786,-209,779,-183,772,-185,768,-219,766,-195,758,-194,752,-205,753,-192,745,-211,741,-205,735,-222,733,-223,721,-247,724,-220,717,-215,705,-238,706,-257,715,-277,710,-285,705,-231,699,-263,687,-321,684,-346,664,-400,656,-433,599,-454,602,-460,611,-489,613,-536,664,-530,668,-539,671,-530,686,-512,687,-505,699,-542,708,-515,704,-511,710,-556,716,-556,725,-547,729,-585,757,-634,763,-681,761,-709,772,-667,777,-728,782,-660,791,-648,800,-670,804,-587,821,-489,824,-453,818,-442,824,-465,830,-300,836],[-818,232,-757,211,-743,201,-777,199,-772,206,-819,227,-843,221,-818,232],[-686,-549,-714,-546,-698,-527,-686,-527,-653,-549,-686,-549],[-1272,506,-1240,492,-1236,483,-1258,491,-1283,506,-1272,506],[-1156,774,-1162,766,-1219,760,-1228,762,-1191,773,-1156,774],[-1083,761,-1055,757,-1059,752,-1125,744,-1176,753,-1156,764,-1111,755,-1091,755,-1103,764,-1086,766,-1083,761],[-1145,726,-1087,725,-1082,717,-1073,719,-1082,731,-1077,733,-1054,728,-1046,711,-1009,697,-1022,698,-1026,696,-1019,690,-1035,688,-1067,694,-1074,690,-1131,685,-1137,692,-1165,694,-1171,701,-1121,704,-1176,706,-1189,720,-1146,734,-1141,731,-1145,726],[-1197,741,-1154,734,-1232,711,-1258,721,-1238,738,-1247,743,-1197,741],[-695,830,-614,824,-714,798,-753,794,-763,790,-744,787,-793,772,-783,766,-896,765,-869,772,-881,777,-870,779,-876,782,-868,788,-843,790,-864,798,-863,803,-800,805,-889,808,-899,812,-890,815,-905,819,-799,829,-695,830],[-1000,739,-970,737,-978,733,-966,718,-987,713,-1006,722,-1027,728,-1005,728,-1015,734,-1000,739],[-849,653,-803,638,-837,638,-855,631,-872,637,-863,641,-860,657,-849,653],[-977,765,-978,751,-1025,755,-1014,760,-1021,763,-977,765],[-1034,793,-996,786,-992,779,-1027,784,-1055,790,-1034,793],[-919,811,-853,792,-906,781,-968,801,-953,810,-919,811],[-943,769,-893,763,-903,761,-882,755,-797,755,-795,749,-803,746,-920,748,-931,764,-966,767,-943,769],[-932,742,-904,739,-940,720,-952,720,-956,737,-932,742],[-555,515,-567,501,-540,494,-537,479,-527,475,-531,467,-542,469,-539,474,-558,469,-552,474,-594,479,-567,513,-555,515],[-866,710,-848,711,-847,716,-859,720,-850,733,-827,737,-803,727,-809,722,-769,727,-674,700,-685,696,-668,693,-680,686,-613,666,-634,651,-665,663,-683,659,-647,640,-645,633,-653,627,-677,631,-663,623,-691,624,-745,647,-782,646,-773,655,-736,655,-744,661,-722,673,-749,690,-764,687,-758,693,-788,702,-821,698,-888,705,-894,711,-879,712,-898,715,-893,731,-850,737,-866,729,-850,714,-866,710],[-496,-2,-484,-4,-485,-8,-505,-18,-506,-3,-496,-2],[1432,-120,1438,-144,1453,-149,1463,-188,1488,-203,1497,-224,1508,-226,1532,-260,1536,-289,1529,-314,1502,-358,1499,-375,1459,-389,1447,-382,1435,-388,1414,-384,1398,-372,1395,-361,1382,-356,1381,-342,1377,-351,1369,-352,1379,-332,1356,-349,1342,-325,1311,-315,1259,-323,1232,-340,1199,-340,1176,-351,1150,-343,1157,-317,1136,-266,1135,-256,1142,-263,1134,-244,1140,-219,1144,-223,1167,-207,1209,-197,1230,-164,1235,-175,1235,-165,1269,-137,1282,-148,1298,-148,1294,-144,1302,-130,1324,-122,1327,-115,1361,-124,1365,-120,1370,-124,1359,-133,1355,-150,1405,-176,1414,-161,1422,-109,1432,-120],[1450,-408,1483,-409,1480,-432,1460,-435,1448,-414,1450,-408]];

  // ══════════════════════════════════════════════════════════════════════════════════
  //  THE PLUGIN
  // ══════════════════════════════════════════════════════════════════════════════════
  F.plugins.push((S) => {
    const set = (S.set = S.set || {});
    K.defaultAir = "#D9E8F2";
    const airOf = (o) => o.air || K.defaultAir;
    const G = (L, o, cls) => { const g = F.el("g", { class: cls }, o && o.parent ? o.parent : L.g); return g; };

    // ── sky ────────────────────────────────────────────────────────────────────────
    set.sky = (L, o = {}) => {
      const kind = SKY[o.kind] ? o.kind : "day", pal = SKY[kind];
      const hz = o.horizon ?? (kind === "space" || kind === "void" ? H + 40 : 700);
      const seed = o.seed ?? 1, R = K.R(seed, 1);
      if (o.setAir !== false) K.defaultAir = pal.air;
      const g = G(L, o, "sky");
      const y0 = o.top ?? (kind === "space" ? -300 : -160);
      const stops = (o.stops || pal.stops).map(([k, c]) => [k, c, 1]);
      F.el("rect", { x: -900, y: -900, width: W + 1800, height: H + 1800, "data-cover": "1",
        fill: K.ulg(L, stops, 0, y0, 0, hz) }, g);
      const out = { g, kind, horizon: hz, air: pal.air };
      // a wide warm glow on the horizon at dawn/dusk
      if (kind === "dawn" || kind === "dusk") {
        const sx = (o.sun && o.sun.x) ?? 1300;
        F.el("ellipse", { cx: sx, cy: hz, rx: 1500, ry: 330, fill: K.soft(L, kind === "dusk" ? "#FFC98A" : "#FFE2B8", 0.55) }, g);
      }
      if (kind === "overcast" && o.bands !== false) out.bands = set.stratus(L, { horizon: hz, seed, parent: g, drift: o.drift });
      const nStars = o.stars ?? (kind === "night" ? 170 : kind === "space" ? 240 : kind === "void" ? 200 : kind === "dusk" ? 24 : 0);
      if (nStars) out.stars = set.stars(L, { n: nStars, seed, parent: g, area: [-400, -300, W + 800, (kind === "night" || kind === "dusk" ? hz * 0.8 : H + 300)],
        dim: kind === "dusk" ? 0.5 : 1 });
      if (o.sun !== false && (o.sun || kind === "day" || kind === "dawn" || kind === "dusk")) {
        const so = Object.assign({ x: kind === "day" ? 1480 : 1300, y: kind === "day" ? 230 : hz - 110, r: kind === "day" ? 50 : 66,
          color: pal.sun, kind, parent: g }, typeof o.sun === "object" ? o.sun : {});
        out.sun = set.sun(L, so);
      }
      if (o.moon || (kind === "night" && o.moon !== false)) {
        out.moon = set.moon(L, Object.assign({ x: 1460, y: 210, r: 34, phase: "crescent", parent: g }, typeof o.moon === "object" ? o.moon : {}));
      }
      const nC = o.clouds ?? pal.clouds;
      if (pal.cloud && nC) out.clouds = set.clouds(L, { n: nC, kind, seed, horizon: hz, parent: g, drift: o.drift, area: o.cloudArea,
        avoid: out.sun, size: o.cloudSize });
      if (o.contrails) out.contrails = set.contrails(L, { n: o.contrails === true ? 5 : o.contrails, seed, parent: g });
      return out;
    };

    // horizontal stratus bands for an overcast sky (they drift slowly)
    set.stratus = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 5), hz = o.horizon ?? 700, n = o.n ?? 16;
      const g = G(L, o, "stratus");
      const bands = [];
      for (let i = 0; i < n; i++) {
        const u = Math.pow(R(), 0.8), y = -120 + u * (hz - 60);
        const light = R() < 0.55;
        const c = light ? (u > 0.6 ? "#E4E8EA" : "#C9D0D7") : "#8995A5";
        const e = F.el("ellipse", { cx: f1(-300 + R() * (W + 600)), cy: f1(y), rx: f1(500 + R() * 900), ry: f1(10 + R() * 34 * (1 - 0.5 * u)),
          fill: K.soft(L, c, light ? 0.55 : 0.42, "soft") }, g);
        bands.push({ e, sp: (o.drift ?? 5) * (0.5 + R()) });
      }
      S.on((t) => { for (const b of bands) b.e.setAttribute("transform", `translate(${f1(b.sp * t)} 0)`); });
      return { g };
    };

    // ── sun (disc + bloom), moon, stars ─────────────────────────────────────────────
    set.sun = (L, o = {}) => {
      const x = o.x ?? 1480, y = o.y ?? 230, r = o.r ?? 50, c = o.color || "#FFF4D6";
      const low = o.kind === "dawn" || o.kind === "dusk";
      const g = G(L, o, "sun");
      F.el("circle", { cx: x, cy: y, r: r * (o.bloom ?? (low ? 12 : 10)), fill: K.soft(L, c, low ? 0.5 : 0.42, "glow") }, g);
      F.el("circle", { cx: x, cy: y, r: r * 2.6, fill: K.soft(L, "#FFFFFF", 0.75, "soft") }, g);
      F.el("circle", { cx: x, cy: y, r, fill: low ? "#FFF3D8" : "#FFFDF6" }, g);
      if (o.pulse !== false) {
        const halo = g.firstChild;
        S.on((t) => halo.setAttribute("opacity", (0.92 + 0.08 * Math.sin(t * 1.3)).toFixed(3)));
      }
      return { g, x, y, r };
    };

    // phase: "crescent" | "half" | "gibbous" | "full"; lit: which side is lit ("right" default)
    set.moon = (L, o = {}) => {
      const x = o.x ?? 1460, y = o.y ?? 210, r = o.r ?? 34, phase = o.phase || "crescent";
      const g = G(L, o, "moon");
      const c = o.color || "#F4F1E6";
      if (o.glow !== false) {
        F.el("circle", { cx: x, cy: y, r: r * (phase === "full" ? 3.4 : 4.2), fill: K.soft(L, o.glowColor || "#CFDFFF", phase === "full" ? 0.4 : 0.3, "glow") }, g);
      }
      if (phase === "full" || phase === "gibbous" || o.craters) {
        drawMoonDisc(L, g, x, y, r, o);
        return { g, x, y, r };
      }
      const sgn = o.lit === "left" ? -1 : 1;
      const off = phase === "half" ? 1.0 : 0.52;
      const d = crescentPath(x, y, r, off * r, -sgn, phase === "half" ? 1.5 : 0.92);
      F.el("path", { d, fill: K.lg(L, "#FFFFFF", c, "d") }, g);
      return { g, x, y, r };
    };
    // the part of circle (x,y,r) outside a circle of radius r*k offset by `off` along ±x (lit crescent)
    function crescentPath(x, y, r, off, dir, k) {
      const r1 = r * k, d = Math.abs(off);
      const a = (r * r - r1 * r1 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r * r - a * a));
      const ux = dir * Math.cos(-0.35), uy = dir * Math.sin(-0.35);     // offset direction (tilted a little)
      const cx1 = x + ux * d, cy1 = y + uy * d;
      const px = x + ux * a, py = y + uy * a, nx = -uy, ny = ux;
      const P1 = [px + nx * h, py + ny * h], P2 = [px - nx * h, py - ny * h];
      void cx1; void cy1;
      return `M${f1(P1[0])} ${f1(P1[1])}A${f1(r)} ${f1(r)} 0 1 ${dir > 0 ? 1 : 0} ${f1(P2[0])} ${f1(P2[1])}` +
             `A${f1(r1)} ${f1(r1)} 0 0 ${dir > 0 ? 0 : 1} ${f1(P1[0])} ${f1(P1[1])}Z`;
    }
    // a full moon disc with maria and craters (space / night)
    function drawMoonDisc(L, g, x, y, r, o) {
      const R = K.R(o.seed ?? 3, 17);
      F.el("circle", { cx: x, cy: y, r, fill: K.urg(L, [[0, "#ECEAE3"], [0.72, "#D9D6CD"], [1, "#A9A9A6"]], x - r * 0.25, y - r * 0.25, r * 1.3) }, g);
      const mare = F.el("g", { opacity: 0.85 }, g);
      const maria = o.maria || [[-0.35, -0.3, 0.34, 0.24], [0.05, -0.42, 0.24, 0.18], [0.3, -0.12, 0.26, 0.2], [-0.05, 0.08, 0.22, 0.16],
        [0.22, 0.28, 0.2, 0.15], [-0.4, 0.18, 0.16, 0.12], [0.4, -0.35, 0.14, 0.1]];
      for (const [mx, my, rx, ry] of maria) {
        F.el("path", { d: K.blob(x + mx * r, y + my * r, rx * r, ry * r, R, 8, 0.22), fill: K.soft(L, "#8E8F8E", 0.7, "soft") }, mare);
      }
      const cr = F.el("g", null, g);
      for (let i = 0; i < (o.craters ?? 10); i++) {
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r * 0.82, cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
        const rr = r * (0.025 + R() * 0.06);
        F.el("circle", { cx: f1(cx + rr * 0.12), cy: f1(cy + rr * 0.12), r: f1(rr), fill: "#A9A8A3", opacity: 0.45 }, cr);
        F.el("circle", { cx: f1(cx), cy: f1(cy), r: f1(rr * 0.82), fill: "#CFCDC6", opacity: 0.5 }, cr);
      }
      F.el("circle", { cx: x, cy: y, r: r * 1.0, fill: "none", stroke: "#8D8F92", "stroke-width": Math.max(1, r * 0.02), opacity: 0.5 }, g);
      return { g };
    }

    set.stars = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 9), n = o.n ?? 180, [ax, ay, aw, ah] = o.area || [-400, -300, W + 800, H + 600];
      const g = G(L, o, "stars");
      const groups = [0, 1, 2, 3].map(() => F.el("g", null, g));
      const dim = o.dim ?? 1;
      const tints = ["#FFFFFF", "#FFFFFF", "#DCE6FF", "#FFF1D8"];
      for (let i = 0; i < n; i++) {
        const x = ax + R() * aw, y = ay + Math.pow(R(), 1.25) * ah, big = R();
        const r = 0.7 + Math.pow(big, 5) * 2.4;
        const gg = groups[i % 4];
        F.el("circle", { cx: f1(x), cy: f1(y), r: f1(r), fill: K.pick(R, tints), opacity: ((0.35 + 0.65 * R()) * dim).toFixed(2) }, gg);
        if (r > 2.3) {
          const s = r * 4.5;
          F.el("path", { d: `M${f1(x - s)} ${f1(y)}Q${f1(x)} ${f1(y - 0.8)} ${f1(x + s)} ${f1(y)}Q${f1(x)} ${f1(y + 0.8)} ${f1(x - s)} ${f1(y)}Z` +
            `M${f1(x)} ${f1(y - s)}Q${f1(x + 0.8)} ${f1(y)} ${f1(x)} ${f1(y + s)}Q${f1(x - 0.8)} ${f1(y)} ${f1(x)} ${f1(y - s)}Z`,
            fill: "#FFFFFF", opacity: (0.6 * dim).toFixed(2) }, gg);
        }
      }
      if (o.twinkle !== false) S.on((t) => groups.forEach((gg, i) => gg.setAttribute("opacity", (0.72 + 0.28 * Math.sin(t * (1.1 + i * 0.37) + i * 1.9)).toFixed(3))));
      return { g };
    };

    // ── clouds ─────────────────────────────────────────────────────────────────────
    // one puffy cartoon cloud: white puffs, soft blue-grey shaded rims, a flat base
    set.cloud = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 11);
      const x = o.x ?? 960, base = o.y ?? 420, w = o.w ?? 460, h = o.h ?? w * 0.42;
      const pal = o.colors || (SKY[o.kind] || SKY.day).cloud;
      const far = o.far || 0, air = airOf(o);
      const c0 = K.air(pal[0], far, air), c1 = K.air(pal[1], far, air), c2 = K.air(pal[2], far, air);
      // puffs on a dome: big in the middle, small at the ends, all standing on a flat base
      const k = Math.max(3, Math.round(w / (h * 0.55)));
      const front = [], back = [];
      const x0 = x - w / 2, span = w;
      for (let i = 0; i < k; i++) {
        const u = 0.06 + 0.88 * i / (k - 1), d = Math.sqrt(Math.max(0, 1 - Math.pow(2 * u - 1, 2)));
        const r = h * (0.22 + 0.24 * d) * (0.88 + 0.24 * R());
        front.push({ x: x0 + u * span + (R() - 0.5) * r * 0.25, y: base - r * lerp(0.42, 0.9, d) * (0.94 + 0.12 * R()), r, z: d });
      }
      const m = Math.max(1, Math.round(k / 2.2));
      for (let j = 0; j < m; j++) {
        const u = (j + 0.5) / m * 0.7 + 0.15, d = Math.sqrt(Math.max(0, 1 - Math.pow(2 * u - 1, 2)));
        const r = h * (0.3 + 0.16 * d) * (0.9 + 0.2 * R());
        back.push({ x: x0 + u * span + (R() - 0.5) * r * 0.4, y: base - h + r * (0.98 + 0.08 * R()), r, z: -1 });
      }
      const g = G(L, o, "cloud");
      const all = back.concat(front);
      F.el("path", { d: K.puffsFlat(all, base, 3, front[0].x, front[front.length - 1].x), fill: K.lgs(L, [[0, c0], [0.55, F.mix(c0, c1, 0.28)], [1, c1]], "v") }, g);
      if (o.shade !== false) for (const c of back) {
        F.el("ellipse", { cx: f1(c.x + c.r * 0.1), cy: f1(c.y + c.r * 0.86), rx: f1(c.r * 0.9), ry: f1(c.r * 0.22), fill: K.soft(L, c1, 0.35) }, g);
      }
      F.el("ellipse", { cx: f1(x), cy: f1(base - h * 0.1), rx: f1(w * 0.46), ry: f1(h * 0.1), fill: K.soft(L, c2, 0.5) }, g);
      return { g, x, y: base, w, h };
    };

    // a field of clouds across the sky (drifting); area [x, y0, w, y1]; far ones lower, smaller, hazier
    set.clouds = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 13), n = o.n ?? 5, hz = o.horizon ?? 700;
      const [ax, ay0, aw, ay1] = o.area || [-260, hz * 0.12, W + 520, hz * 0.68];
      const g = G(L, o, "clouds");
      const list = [];
      const order = [];
      for (let i = 0; i < n; i++) order.push(i);
      for (let i = 0; i < n; i++) {
        const u = (order[i] + 0.2 + R() * 0.6) / n;
        const depth = R();                                    // 0 near/high … 1 far/low
        const w = (o.size ?? 520) * lerp(1.2, 0.5, depth) * (0.8 + 0.4 * R());
        const y = Math.max(lerp(ay0, ay1, 0.15 + 0.85 * depth) + (R() - 0.5) * 40, w * lerp(0.44, 0.3, depth) + 50);
        let cx = ax + u * aw;
        if (o.avoid && Math.abs(cx - o.avoid.x) < w * 0.5 + 170 && Math.abs(y - w * 0.2 - o.avoid.y) < 240) cx += (cx < o.avoid.x ? -1 : 1) * (w * 0.6 + 120);
        list.push({ x: cx, y, w, depth, seed: (o.seed ?? 1) * 31 + i });
      }
      list.sort((a, b) => b.depth - a.depth);                   // far first
      const items = [];
      for (const c of list) {
        const cg = F.el("g", null, g);
        set.cloud(L, { parent: cg, x: c.x, y: c.y, w: c.w, h: c.w * lerp(0.44, 0.3, c.depth), seed: c.seed, kind: o.kind, colors: o.colors, far: (o.far ?? 0) + c.depth * 0.35, air: o.air });
        items.push({ g: cg, sp: (o.drift ?? 7) * lerp(1, 0.45, c.depth) });
      }
      S.on((t) => { for (const it of items) it.g.setAttribute("transform", `translate(${f1(it.sp * t)} 0)`); });
      return { g, items };
    };

    // contrails: long soft white lines crossing the sky
    set.contrails = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 21), n = o.n ?? 5;
      const g = G(L, o, "contrails");
      const out = [];
      for (let i = 0; i < n; i++) {
        const ang = ((o.angle ?? (R() < 0.5 ? -28 : 24)) + (R() - 0.5) * 22) * K.deg;
        const cx = -200 + R() * (W + 400), cy = -100 + R() * (H * 0.9), len = 1400 + R() * 1800;
        const dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2;
        const x1 = cx - dx, y1 = cy - dy, x2 = cx + dx, y2 = cy + dy;
        const wide = 0.5 + R() * 1.2;
        const grad = K.ulg(L, [[0, "#FFFFFF", 0], [0.18, "#FFFFFF", 1], [0.8, "#FFFFFF", 1], [1, "#FFFFFF", 0]], x1, y1, x2, y2);
        const cg = F.el("g", { opacity: (0.55 + 0.45 * R()).toFixed(2) }, g);
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        const band = (w0, w1, a) => F.el("path", { d: K.poly([[x1 + nx * w0, y1 + ny * w0], [x2 + nx * w1, y2 + ny * w1], [x2 - nx * w1, y2 - ny * w1], [x1 - nx * w0, y1 - ny * w0]]),
          fill: grad, opacity: a }, cg);
        band(26 * wide, 70 * wide, 0.12);
        band(9 * wide, 24 * wide, 0.22);
        band(2.2, 6 * wide, 0.8);
        out.push({ g: cg, x1, y1, x2, y2 });
      }
      return { g, trails: out };
    };

    // ── air and light ────────────────────────────────────────────────────────────────
    // haze: kind "band" (a soft horizontal band centred on y), "up" (clear above y-h → colour at y and below),
    // "glow" (a round hazy glow at x,y radius r — a sun at the vanishing point)
    set.haze = (L, o = {}) => {
      const kind = o.kind || "band", color = o.color || airOf(o), a = o.a ?? 0.6;
      const g = G(L, o, "haze");
      if (kind === "glow") {
        const x = o.x ?? 960, y = o.y ?? 480, r = o.r ?? 700;
        F.el("ellipse", { cx: x, cy: y, rx: r * (o.sx ?? 1.3), ry: r, fill: K.soft(L, color, a, "glow") }, g);
      } else if (kind === "up") {
        const y = o.y ?? 700, h = o.h ?? 300;
        F.el("rect", { x: -900, y: y - h, width: W + 1800, height: h + (o.below ?? 1200), "data-cover": "x",
          fill: K.ulg(L, [[0, color, 0], [h / (h + (o.below ?? 1200)), color, a], [1, color, a * (o.fade ?? 1)]], 0, y - h, 0, y + (o.below ?? 1200)) }, g);
      } else {
        const y = o.y ?? 640, h = o.h ?? 320;
        F.el("rect", { x: -900, y: y - h / 2, width: W + 1800, height: h, "data-cover": "x",
          fill: K.ulg(L, [[0, color, 0], [0.5, color, a], [1, color, 0]], 0, y - h / 2, 0, y + h / 2) }, g);
      }
      return { g };
    };

    // a visible shaft of light: from a source (a window) toward a target; soft edges from stacked bands
    set.lightShaft = (L, o = {}) => {
      const [x0, y0] = o.from || [o.x ?? 400, o.y ?? 120];
      let x1, y1;
      if (o.to) [x1, y1] = o.to;
      else { const a = (o.angle ?? 62) * K.deg, len = o.len ?? 1000; x1 = x0 + Math.cos(a) * len; y1 = y0 + Math.sin(a) * len; }
      const w0 = o.w0 ?? 180, w1 = o.w1 ?? w0 * 1.7, color = o.color || "#FFE6B8", a = o.a ?? 0.3;
      const g = G(L, o, "shaft");
      if (o.blend !== false) g.setAttribute("style", `mix-blend-mode:${o.blend || "screen"}`);
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
      const grad = K.ulg(L, [[0, color, 1], [0.6, color, 0.55], [1, color, 0]], x0, y0, x1, y1);
      const steps = o.soft ?? 4;
      for (let i = 0; i < steps; i++) {
        const k = 1 - i / steps * 0.55;
        F.el("path", { d: K.poly([[x0 + nx * w0 / 2 * k, y0 + ny * w0 / 2 * k], [x1 + nx * w1 / 2 * k, y1 + ny * w1 / 2 * k],
          [x1 - nx * w1 / 2 * k, y1 - ny * w1 / 2 * k], [x0 - nx * w0 / 2 * k, y0 - ny * w0 / 2 * k]]), fill: grad, opacity: (a / steps * 1.6).toFixed(3) }, g);
      }
      // the lit patch where it lands
      if (o.pool !== false) F.el("ellipse", { cx: f1(x1), cy: f1(y1), rx: f1(w1 * 0.62), ry: f1(w1 * 0.2), fill: K.soft(L, color, a * 1.3) }, g);
      if (o.motes !== false && S.motes) {
        const mx = Math.min(x0, x1) - w1 / 2, my = Math.min(y0, y1);
        S.motes(L, { x: mx, y: my, w: Math.abs(dx) + w1, h: Math.abs(dy), n: o.motes ?? 26, seed: o.seed });
      }
      if (o.sway) S.on((t) => g.setAttribute("opacity", (0.86 + 0.14 * F.noise(t * 0.6, 5)).toFixed(3)));
      return { g, from: [x0, y0], to: [x1, y1] };
    };

    // a warm light bloom (lamp, window, fire) — a baked radial glow, screen-blended; flicker optional
    set.glow = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 540, r = o.r ?? 260, color = o.color || "#FFD9A0", a = o.a ?? 0.7;
      const g = G(L, o, "glow");
      g.setAttribute("style", `mix-blend-mode:${o.blend || "screen"}`);
      const c = F.el("circle", { cx: f1(x), cy: f1(y), r: f1(r), fill: K.soft(L, color, a, "glow") }, g);
      if (o.flicker) {
        const seed = o.seed ?? F.hash("gl" + x + y) % 97;
        S.on((t) => { const k = 1 + o.flicker * (0.6 * F.noise(t * 7.3, seed) + 0.4 * F.noise(t * 2.1, seed + 3));
          c.setAttribute("r", f1(r * (0.97 + 0.03 * k))); c.setAttribute("opacity", clamp(k, 0, 1.2).toFixed(3)); });
      }
      return { g, x, y, r };
    };

    // ══════════════════════════════════════════════════════════════════════════════
    //  TERRAIN
    // ══════════════════════════════════════════════════════════════════════════════
    const GROUND = {
      sand: ["#EAD3A1", "#DFC28B"], grass: ["#A9C681", "#7FA45D"], dirt: ["#C8AB84", "#A88A63"], stone: ["#D8CEB9", "#BDB097"],
      snow: ["#F1F4F7", "#D9E2EA"], mud: ["#9E8A63", "#7E6B48"], lunar: ["#8F8B82", "#77736B"], wet: ["#AE9D7B", "#8F7E5E"],
      street: ["#D9BE98", "#C8A67E"], savanna: ["#D6C07F", "#BCA260"],
    };
    K.GROUND = GROUND;
    // a flat ground plane from the horizon line y down past the frame, with a few soft streaks
    set.ground = (L, o = {}) => {
      const y = o.y ?? 700, kind = GROUND[o.kind] ? o.kind : "sand", far = o.far || 0, air = airOf(o);
      const c1 = o.color || GROUND[kind][0], c2 = o.color2 || GROUND[kind][1];
      const g = G(L, o, "ground");
      const depth = o.depth ?? Math.max(200, H - y);
      const top = K.air(F.mix(c1, air, o.haze ?? 0.3), far, air);
      F.el("rect", { x: -900, y: f1(y), width: W + 1800, height: f1(depth + 1400), "data-cover": "x",
        fill: K.ulg(L, [[0, top], [0.3, K.air(c1, far, air)], [1, K.air(c2, far, air)]], 0, y, 0, y + depth) }, g);
      const R = K.R(o.seed ?? 1, 51), n = o.streaks ?? 14;
      for (let i = 0; i < n; i++) {
        const u = Math.pow(R(), 1.5), yy = y + 8 + u * depth * 0.95, sc = 0.25 + u;
        const light = R() < 0.5;
        F.el("ellipse", { cx: f1(-300 + R() * (W + 600)), cy: f1(yy), rx: f1((180 + R() * 420) * sc), ry: f1((2 + R() * 5) * sc),
          fill: K.soft(L, K.air(light ? K.lite(c1, 0.35) : K.dark(c2, 0.18), far, air), light ? 0.55 : 0.4) }, g);
      }
      return { g, y };
    };

    // dunes: rows of smooth sand ridges from the horizon forward, lit from one side (shade on the other)
    set.dunes = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 31), y = o.y ?? 600, n = o.n ?? 3, span = o.span ?? 800;
      const far = o.far || 0, air = airOf(o), sand = o.color || "#EBD4A2";
      const shadeLeft = (o.light || "right") === "right";
      const g = G(L, o, "dunes");
      const rows = [];
      const step = 10;
      let front = null;
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 1 : i / (n - 1);
        const isFloor = o.floor !== false && n > 1 && i === n - 1;
        const baseY = y + (o.gap ?? 70) * i * (1 + 0.5 * i);
        const hh = (o.h ?? 230) * (isFloor ? 0.18 : lerp(0.45, 1, n > 2 ? i / (n - 2) : k));
        const rf = clamp(far + (1 - k) * (o.airFar ?? 0.42), 0, 0.9);
        const col = (c) => K.air(c, rf, air);
        // bumps
        const bumps = (o.bumps && i === n - 1) ? o.bumps.map((b) => ({ c: b.x, w: b.w / 2, a: b.h })) : [];
        let bx = -span + (R() - 0.5) * 300;
        while (!bumps.length || (!(o.bumps && i === n - 1) && bx < W + span)) {
          if (o.bumps && i === n - 1) break;
          const bw = (o.width ?? 900) * lerp(0.6, 1.3, k) * (0.7 + 0.6 * R()) * (isFloor ? 1.6 : 1);
          bumps.push({ c: bx + bw * 0.5, w: bw * 0.62, a: hh * (0.45 + 0.55 * R()) });
          bx += bw * (0.75 + 0.35 * R());
        }
        const prof = (u) => (Math.abs(u) >= 1 ? 0 : Math.pow(1 - u * u, u < 0 === shadeLeft ? 1.35 : 1.7));
        const X = [], Y = [], own = [];
        for (let x = -span; x <= W + span; x += step) {
          let best = 0, bi = -1;
          bumps.forEach((b, j) => { const v = b.a * prof((x - b.c) / b.w); if (v > best) { best = v; bi = j; } });
          X.push(x); Y.push(baseY - best); own.push(bi);
        }
        const sil = X.map((x, j) => [x, Y[j]]);
        const bottom = baseY + 1500;
        const fillTop = baseY - hh;
        F.el("path", { d: K.poly(sil.concat([[W + span, bottom], [-span, bottom]])),
          fill: K.ulg(L, [[0, col(K.lite(sand, 0.1))], [0.45, col(sand)], [1, col(K.dark(sand, 0.07))]], 0, fillTop, 0, baseY + 260) }, g);
        // lee-side shade on every bump
        const shade = col(o.shade || "#C9A36C");
        bumps.forEach((b, j) => {
          if (b.a < hh * 0.25 && !o.bumps) return;
          const top = [], inner = [];
          const lee = [];
          for (let jx = 0; jx < X.length; jx++) {
            const u = (X[jx] - b.c) / b.w;
            if (own[jx] !== j || (shadeLeft ? u > 0 || u < -1 : u < 0 || u > 1)) continue;
            lee.push(jx);
          }
          if (lee.length < 3) return;
          const xa = X[lee[0]], xb = X[lee[lee.length - 1]], fade = Math.max(40, b.w * 0.25);
          for (const jx of lee) {
            const u = (X[jx] - b.c) / b.w, au = Math.abs(u);
            const raw = baseY - b.a * prof(u) * (1 - 0.72 * Math.pow(Math.sin(Math.PI * Math.min(1, au * 1.05)), 0.7)) + 1;
            const m = Math.min(1, (X[jx] - xa) / fade + (Math.abs((xa - b.c) / b.w) > 0.97 || Math.abs(xa - b.c) < 12 ? 1 : 0), (xb - X[jx]) / fade + (Math.abs((xb - b.c) / b.w) > 0.97 || Math.abs(xb - b.c) < 12 ? 1 : 0));
            top.push([X[jx], Y[jx]]);
            inner.push([X[jx], Y[jx] + (raw - Y[jx]) * F.smooth(clamp(m, 0, 1))]);
          }
          F.el("path", { d: K.poly(top.concat(inner.reverse())), fill: K.lg(L, shade, K.air(sand, rf * 0.5 + 0.15, air), shadeLeft ? "h" : "l", 0.9, 0.2) }, g);
          // a soft lit rim just over the crest
          const rim = [];
          for (let jx = 0; jx < X.length; jx++) {
            const u = (X[jx] - b.c) / b.w;
            if (own[jx] === j && (shadeLeft ? u >= -0.02 && u < 0.45 : u <= 0.02 && u > -0.45)) rim.push([X[jx], Y[jx] + 2]);
          }
          if (rim.length > 2) F.el("path", { d: K.poly(rim, false), fill: "none", stroke: col("#FBF0D2"), "stroke-width": 3, opacity: 0.55, "stroke-linecap": "round" }, g);
        });
        rows.push({ baseY, X, Y, far: rf });
        front = rows[rows.length - 1];
      }
      const surface = (x) => {
        const X = front.X, j = clamp(Math.round((x - X[0]) / step), 0, X.length - 1);
        return front.Y[j];
      };
      if (o.bushes) set.scrub(L, { n: o.bushes === true ? 7 : o.bushes, y0: front.baseY - 20, y1: front.baseY + 120, seed: o.seed, parent: g, far });
      return { g, horizon: y, rows, floor: front.baseY, surface };
    };

    // desert scrub: little grey-green bushes scattered over a band (perspective: smaller further up)
    set.scrub = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 57), n = o.n ?? 8, y0 = o.y0 ?? 640, y1 = o.y1 ?? 820;
      const g = G(L, o, "scrub");
      for (let i = 0; i < n; i++) {
        const u = R(), yy = lerp(y0, y1, u), s = lerp(0.45, 1.1, u) * (o.s ?? 1);
        set.bush(L, { parent: g, x: -100 + R() * (W + 200), y: yy, w: 70 * s * (0.7 + 0.6 * R()), seed: (o.seed ?? 1) * 13 + i, color: o.color || "#8E9C6C", far: (o.far || 0) + (1 - u) * 0.25, shadow: true });
      }
      return { g };
    };

    // footprints (or hoofprints) along a line, smaller with distance
    set.footprints = (L, o = {}) => {
      const [x0, y0] = o.from || [700, 1040], [x1, y1] = o.to || [1100, 700], n = o.n ?? 16;
      const g = G(L, o, "prints");
      const c = o.color || "#B8975F", s0 = o.size ?? 16;
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), s = s0 * lerp(1, o.far ?? 0.35, u), side = i % 2 ? 1 : -1;
        const x = x0 + dx * u + nx * side * s * 0.9, y = y0 + dy * u + ny * side * s * 0.9;
        F.el("ellipse", { cx: f1(x), cy: f1(y), rx: f1(s * 0.55), ry: f1(s * 0.26), fill: c, opacity: (0.55 * (1 - 0.4 * u)).toFixed(2),
          transform: `rotate(${f1(Math.atan2(dy, dx) / K.deg + 90)} ${f1(x)} ${f1(y)})` }, g);
      }
      return { g };
    };

    // the sea from the horizon to the shore, gentle shimmering waves, foam on the shore
    set.sea = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 61), y = o.y ?? 560, y1 = o.shore ?? y + 70, far = o.far || 0, air = airOf(o);
      const tint = o.tint ?? (K.defaultAir === SKY.day.air ? 0 : 0.42);
      const tn = (c) => (tint ? F.mix(c, air, tint) : c);
      const cFar = K.air(tn(o.colorFar || "#A7CACB"), far, air), cMid = K.air(tn(o.color || "#7DB8C4"), far, air), cNear = K.air(tn(o.colorNear || "#8ED2CA"), far, air);
      const g = G(L, o, "sea");
      F.el("rect", { x: -900, y: f1(y), width: W + 1800, height: f1(y1 - y + 60), "data-cover": "x",
        fill: K.ulg(L, [[0, cFar], [0.35, cMid], [1, cNear]], 0, y, 0, y1 + 20) }, g);
      F.el("rect", { x: -900, y: f1(y - 1.5), width: W + 1800, height: 3, fill: "#F2F7F4", opacity: 0.55, "data-cover": "x" }, g);
      const waves = [0, 1, 2].map(() => F.el("g", null, g));
      const nw = o.waves ?? Math.round((y1 - y) * 0.6 + 20);
      const items = [];
      for (let i = 0; i < nw; i++) {
        const u = Math.pow(R(), 1.6), yy = y + 4 + u * (y1 - y - 8), s = 0.2 + u;
        const wg = waves[i % 3];
        const x = -300 + R() * (W + 600), len = (20 + R() * 60) * s * 2;
        const e = F.el("path", { d: `M${f1(x)} ${f1(yy)}q${f1(len / 2)} ${f1(-2.2 * s)} ${f1(len)} 0`, fill: "none", stroke: "#E9F6F4",
          "stroke-width": f1(1 + 2 * s), "stroke-linecap": "round", opacity: (0.35 + 0.45 * R()).toFixed(2) }, wg);
        items.push({ e, sp: (3 + R() * 6) * (R() < 0.5 ? -1 : 1) * s });
      }
      const foam = [];
      if (o.foam !== false) {
        for (let k = 0; k < 2; k++) {
          const pts = [];
          for (let x = -600; x <= W + 600; x += 60) pts.push([x, y1 + Math.sin(x * 0.011 + k * 2 + R()) * 3 + k * 7]);
          foam.push(F.el("path", { d: K.curve(pts), fill: "none", stroke: "#FFFFFF", "stroke-width": k ? 2.5 : 4.5, opacity: k ? 0.45 : 0.85, "stroke-linecap": "round" }, g));
        }
      }
      S.on((t) => {
        waves.forEach((wg, i) => wg.setAttribute("opacity", (0.7 + 0.3 * Math.sin(t * (0.9 + i * 0.4) + i * 2)).toFixed(3)));
        for (const it of items) it.e.setAttribute("transform", `translate(${f1(it.sp * t)} 0)`);
        foam.forEach((f, k) => { const p = Math.sin(t * 0.7 + k * 1.3); f.setAttribute("transform", `translate(0 ${f1(p * 3)})`); f.setAttribute("opacity", ((k ? 0.3 : 0.7) + 0.2 * p).toFixed(3)); });
      });
      return { g, horizon: y, shore: y1 };
    };

    // a beach: the sea down to the shore, wet sand, then dry sand to the bottom of the frame
    set.beach = (L, o = {}) => {
      const y = o.y ?? 560, y1 = o.shore ?? y + 60;
      const g = G(L, o, "beach");
      const sea = set.sea(L, Object.assign({}, o, { parent: g, y, shore: y1 }));
      const sand = o.sand || "#E6CD98";
      const ground = set.ground(L, { parent: g, y: y1 + 6, color: sand, color2: K.dark(sand, 0.08), haze: 0.12, seed: o.seed, far: o.far, air: o.air });
      F.el("rect", { x: -900, y: f1(y1 - 2), width: W + 1800, height: 40, "data-cover": "x",
        fill: K.ulg(L, [[0, K.air("#CDB183", o.far || 0, airOf(o)), 1], [1, K.air("#CDB183", o.far || 0, airOf(o)), 0]], 0, y1, 0, y1 + 40) }, g);
      // move the foam lines on top of the wet band
      g.querySelectorAll(".sea > path[stroke='#FFFFFF']").forEach((n) => g.appendChild(n));
      return { g, horizon: y, shore: y1, sea, ground };
    };

    // wet sand flats with puddles that mirror a grey sky (an overcast beach)
    set.flats = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 67), y = o.y ?? 560, far = o.far || 0, air = airOf(o);
      const g = G(L, o, "flats");
      set.ground(L, { parent: g, y, kind: "wet", color: o.color, color2: o.color2, haze: 0.45, seed: o.seed, far, air, streaks: 22 });
      const sky = o.sky || ["#E3E8EB", "#B3BCC4"];
      const pud = K.lg(L, K.air(sky[0], far, air), K.air(sky[1], far, air), "v");
      const n = o.puddles ?? 14;
      const list = [];
      for (let i = 0; i < n; i++) {
        const u = Math.pow(R(), 1.25), yy = y + 14 + u * (H - y + 60);
        const s = 0.18 + 0.9 * u, w = (140 + R() * 260) * s * (o.size ?? 1), hh = w * (0.035 + 0.06 * u);
        list.push({ x: -200 + R() * (W + 400), y: yy, w, h: hh, u });
      }
      list.sort((a, b) => a.y - b.y);
      for (const p of list) {
        const pts = [];
        const m = 10;
        for (let k = 0; k < m; k++) {
          const a = (k / m) * Math.PI * 2, j = 1 + (R() - 0.5) * 0.25;
          pts.push([p.x + Math.cos(a) * p.w / 2 * j, p.y + Math.sin(a) * p.h * j * (Math.sin(a) > 0 ? 0.8 : 1.1)]);
        }
        F.el("path", { d: K.curve(pts, true), fill: pud, stroke: K.air("#F3F5F5", far, air), "stroke-width": f1(1 + 1.5 * p.u), "stroke-opacity": 0.85 }, g);
      }
      if (o.tufts !== false) set.tufts(L, { parent: g, n: o.tufts ?? 46, y0: y + 10, y1: H + 40, seed: o.seed, color: o.tuftColor || "#6F6A4E", far });
      return { g, horizon: y };
    };

    // little grass tufts scattered over a band of ground (perspective)
    set.tufts = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 71), n = o.n ?? 40, y0 = o.y0 ?? 600, y1 = o.y1 ?? H, x0 = o.x0 ?? -200, x1 = o.x1 ?? W + 200;
      const g = G(L, o, "tufts");
      const c = K.air(o.color || "#8C8A55", o.far || 0, airOf(o));
      let d = "";
      for (let i = 0; i < n; i++) {
        const u = Math.pow(R(), 0.8), x = lerp(x0, x1, R()), y = lerp(y0, y1, u), s = (o.s ?? 1) * lerp(0.25, 1.3, u);
        const m = 3 + Math.floor(R() * 3);
        for (let k = 0; k < m; k++) {
          const a = (-90 + (k - (m - 1) / 2) * 16 + (R() - 0.5) * 12) * K.deg, len = (16 + R() * 12) * s;
          const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
          d += `M${f1(x - 1.2 * s)} ${f1(y)}Q${f1(x + Math.cos(a) * len * 0.5 + 2 * s)} ${f1(y + Math.sin(a) * len * 0.5)} ${f1(ex)} ${f1(ey)}Q${f1(x + Math.cos(a) * len * 0.5 - 1 * s)} ${f1(y + Math.sin(a) * len * 0.5)} ${f1(x + 1.2 * s)} ${f1(y)}Z`;
        }
      }
      F.el("path", { d, fill: c, opacity: o.op ?? 0.85 }, g);
      return { g };
    };

    // rolling hills in rows, paler and bluer with distance; optional trees on the ridges
    set.hills = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 73), y = o.y ?? 620, n = o.n ?? 3, span = o.span ?? 800, far = o.far || 0, air = airOf(o);
      const base = o.color || "#8DB26E";
      const g = G(L, o, "hills");
      const rows = [];
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 1 : i / (n - 1), baseY = y + (o.gap ?? 55) * i * (1 + 0.4 * i);
        const amp = (o.h ?? 150) * lerp(0.55, 1, k), rf = clamp(far + (1 - k) * (o.airFar ?? 0.55), 0, 0.92);
        const ph = [R() * 9, R() * 9, R() * 9], fq = [0.0017, 0.0041, 0.009].map((v) => v * (0.8 + 0.4 * R()) * lerp(1.3, 0.8, k));
        const pts = [];
        for (let x = -span; x <= W + span; x += 16) {
          const v = 0.55 * Math.sin(x * fq[0] + ph[0]) + 0.3 * Math.sin(x * fq[1] + ph[1]) + 0.15 * Math.sin(x * fq[2] + ph[2]);
          pts.push([x, baseY - amp * (0.55 + 0.45 * v)]);
        }
        const col = (c) => K.air(c, rf, air);
        const cTop = col(K.lite(base, 0.12)), cBot = col(K.dark(base, 0.1));
        F.el("path", { d: K.poly(pts.concat([[W + span, baseY + 1400], [-span, baseY + 1400]])),
          fill: K.ulg(L, [[0, cTop], [1, cBot]], 0, baseY - amp, 0, baseY + 200) }, g);
        rows.push({ baseY, pts, far: rf });
        if (o.trees !== false && k > 0.3) {
          const nt = Math.round((o.trees === true || o.trees == null ? 7 : o.trees) * (0.5 + k));
          for (let j = 0; j < nt; j++) {
            const p = pts[Math.floor(R() * pts.length)], s = lerp(0.35, 0.75, k) * (0.7 + 0.5 * R());
            set.tree(L, { parent: g, x: p[0], y: p[1] + 18 * s, h: 120 * s, kind: R() < 0.2 ? "poplar" : "round", seed: j * 7 + i, far: rf * 0.9, air, sway: 0, shadow: false });
          }
        }
      }
      return { g, rows, horizon: y };
    };

    // distant mountains: jagged rows with a lit face and a shaded face, optional snow
    set.mountains = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 79), y = o.y ?? 620, n = o.n ?? 2, span = o.span ?? 800, far = o.far || 0, air = airOf(o);
      const base = o.color || "#8C9CB2";
      const g = G(L, o, "mountains");
      const lightLeft = (o.light || "left") === "left";
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 1 : i / (n - 1), baseY = y + i * (o.gap ?? 40);
        const hh = (o.h ?? 300) * lerp(1.05, 0.7, k), rf = clamp(far + (1 - k) * 0.45 + 0.1, 0, 0.92);
        const col = (c) => K.air(c, rf, air);
        const pts = [[-span, baseY - hh * 0.2]], peaks = [];
        let x = -span;
        while (x < W + span) {
          const wv = (200 + R() * 260) * lerp(1.15, 0.9, k);
          const px = x + wv * (0.4 + 0.2 * R()), ph = hh * (0.45 + 0.55 * R());
          pts.push([x + wv * 0.2, baseY - ph * (0.35 + 0.2 * R())]);
          pts.push([px, baseY - ph]);
          peaks.push({ i: pts.length - 1, x: px, y: baseY - ph, h: ph });
          pts.push([px + wv * 0.25, baseY - ph * (0.55 + 0.2 * R())]);
          x += wv;
          pts.push([x, baseY - hh * (0.15 + 0.2 * R())]);
        }
        const shadeC = col(K.dark(base, 0.12)), litC = col(K.lite(base, 0.18));
        F.el("path", { d: K.poly(pts.concat([[W + span, baseY + 1400], [-span, baseY + 1400]])), fill: K.ulg(L, [[0, shadeC], [1, col(K.dark(base, 0.02))]], 0, baseY - hh, 0, baseY + 100) }, g);
        for (const pk of peaks) {
          const face = [];
          const a = lightLeft ? pk.i - 2 : pk.i + 2, bI = pk.i;
          const lo = Math.min(a, bI), hi = Math.max(a, bI);
          for (let j = lo; j <= hi; j++) face.push(pts[Math.max(0, Math.min(pts.length - 1, j))]);
          const foot = [pk.x + (lightLeft ? 1 : -1) * pk.h * 0.18, baseY + 20];
          const edge = lightLeft ? face : face.reverse();
          F.el("path", { d: K.poly(edge.concat([foot, [edge[0][0], baseY + 20]])), fill: K.lg(L, litC, col(base), "v"), opacity: 0.9 }, g);
          if (o.snow && pk.h > hh * 0.6) {
            const sh = pk.h * 0.28, lx = pts[pk.i - 1], rx = pts[pk.i + 1];
            const L1 = [lerp(pk.x, lx[0], sh / (pk.y - lx[1] < 0 ? sh : lx[1] - pk.y + 1e-3)), 0];
            void L1;
            const tl = (p) => [lerp(pk.x, p[0], clamp(sh / Math.max(1, p[1] - pk.y), 0, 1)), lerp(pk.y, p[1], clamp(sh / Math.max(1, p[1] - pk.y), 0, 1))];
            const a1 = tl(lx), a2 = tl(rx);
            const zz = [a1];
            for (let z = 1; z < 5; z++) { const u = z / 5; zz.push([lerp(a1[0], a2[0], u), lerp(a1[1], a2[1], u) + (z % 2 ? sh * 0.35 : -sh * 0.05)]); }
            zz.push(a2);
            F.el("path", { d: K.poly([[pk.x, pk.y]].concat(zz.reverse())), fill: K.lg(L, col("#FFFFFF"), col("#DCE4EE"), lightLeft ? "h" : "l") }, g);
          }
        }
      }
      return { g, horizon: y };
    };

    // a river. view "side": far bank, water band, near bank with reeds (the Nile) · view "above": a meandering
    // ribbon with green banks through desert or fields
    set.river = (L, o = {}) => {
      if (o.view === "above") return riverAbove(L, o);
      const R = K.R(o.seed ?? 1, 83), y = o.y ?? 620, h = o.h ?? 150, far = o.far || 0, air = airOf(o), span = o.span ?? 800;
      const col = (c) => K.air(c, far, air);
      const g = G(L, o, "river");
      // water
      F.el("rect", { x: -900, y: f1(y - 4), width: W + 1800, height: f1(h + 30), "data-cover": "x",
        fill: K.ulg(L, [[0, col(o.colorFar || "#B7D2D2")], [0.25, col(o.color || "#7FAEB6")], [1, col(o.colorNear || "#5F929F")]], 0, y, 0, y + h) }, g);
      // far bank: a low green strip with a soft reflection
      const bank = [];
      for (let x = -span; x <= W + span; x += 30) bank.push([x, y - 10 - Math.abs(Math.sin(x * 0.013 + R())) * 12 - R() * 6]);
      const fb = col(o.bankColor || "#7E9A5A");
      F.el("path", { d: K.curve(bank) + `L${W + span} ${f1(y + 2)}L${-span} ${f1(y + 2)}Z`, fill: K.lg(L, K.lite(fb, 0.1), K.dark(fb, 0.15), "v") }, g);
      F.el("rect", { x: -900, y: f1(y + 1), width: W + 1800, height: 26, "data-cover": "x", fill: K.ulg(L, [[0, K.dark(fb, 0.25), 0.45], [1, K.dark(fb, 0.25), 0]], 0, y + 1, 0, y + 27) }, g);
      // shimmer
      const sh = [0, 1, 2].map(() => F.el("g", null, g));
      const items = [];
      for (let i = 0; i < (o.shimmer ?? 46); i++) {
        const u = Math.pow(R(), 1.3), yy = y + 10 + u * (h - 16), s = 0.3 + u, len = (24 + R() * 70) * s;
        const x = -300 + R() * (W + 600);
        const e = F.el("rect", { x: f1(x), y: f1(yy), width: f1(len), height: f1(1.2 + 2 * s), rx: 1.5, fill: "#EAF4F2", opacity: (0.25 + 0.4 * R()).toFixed(2) }, sh[i % 3]);
        items.push({ e, sp: (4 + R() * 5) * s });
      }
      S.on((t) => {
        sh.forEach((q, i) => q.setAttribute("opacity", (0.65 + 0.35 * Math.sin(t * (1.1 + 0.3 * i) + i * 2.1)).toFixed(3)));
        for (const it of items) it.e.setAttribute("transform", `translate(${f1(it.sp * t)} 0)`);
      });
      // near bank: mud edge + ground to the bottom
      const nb = [];
      const ny = y + h;
      for (let x = -span; x <= W + span; x += 40) nb.push([x, ny + Math.sin(x * 0.006 + 1.3) * 8 + (R() - 0.5) * 6]);
      const ground = col(o.ground || "#DCC08C");
      F.el("path", { d: K.curve(nb) + `L${W + span} ${ny + 1400}L${-span} ${ny + 1400}Z`, fill: K.ulg(L, [[0, col("#9C8660")], [0.05, col("#BCA077")], [0.16, ground], [1, K.dark(ground, 0.1)]], 0, ny - 10, 0, ny + 420) }, g);
      for (let i = 0; i < 12; i++) {
        const u = Math.pow(R(), 1.4), yy = ny + 30 + u * 380, sc = 0.3 + u;
        F.el("ellipse", { cx: f1(-300 + R() * (W + 600)), cy: f1(yy), rx: f1((200 + R() * 380) * sc), ry: f1((2 + R() * 4) * sc), fill: K.soft(L, col(R() < 0.5 ? K.lite(ground, 0.3) : K.dark(ground, 0.15)), 0.45) }, g);
      }
      F.el("path", { d: K.curve(nb), fill: "none", stroke: col("#D9E7E4"), "stroke-width": 2.5, opacity: 0.55 }, g);
      if (o.reeds !== false) {
        const nr = o.reeds === true || o.reeds == null ? 5 : o.reeds;
        for (let i = 0; i < nr; i++) {
          const x = (i + 0.2 + R() * 0.6) / nr * (W + 400) - 200;
          set.reeds(L, { parent: g, x, y: ny + 10, w: 110 + R() * 110, h: (o.reedH ?? 130) * (0.75 + 0.5 * R()), n: 7 + Math.floor(R() * 6), kind: o.reedKind || "papyrus", seed: (o.seed ?? 1) * 17 + i, far });
        }
      }
      if (o.palms) {
        const np = o.palms === true ? 6 : o.palms;
        for (let i = 0; i < np; i++) set.palm(L, { parent: g, x: -100 + (i + R() * 0.8) / np * (W + 200), y: y - 8, h: 110 + R() * 70, seed: i * 5 + 3, far: 0.45 + far, sway: 0.6 });
      }
      return { g, y, h, bank: ny };
    };
    function riverAbove(L, o) {
      const R = K.R(o.seed ?? 1, 89), far = o.far || 0, air = airOf(o), w = o.w ?? 70;
      const col = (c) => K.air(c, far, air);
      const g = G(L, o, "river-above");
      const pts = o.path || (() => {
        const q = []; let x = o.x ?? 900;
        for (let yy = -400; yy <= H + 400; yy += 180) { q.push([x, yy]); x += (R() - 0.5) * 360 + (o.drift ?? 0); }
        return q;
      })();
      const d = K.curve(pts);
      const line = (c, sw, op) => F.el("path", { d, fill: "none", stroke: col(c), "stroke-width": f1(sw), opacity: op, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
      const green = o.banks || "#6E9A4E";
      if (o.green !== false) {
        for (let i = 0; i < 7; i++) { const u = i / 6; line(F.mix(K.lite(green, 0.2), K.dark(green, 0.12), u), w * lerp(9, 1.6, u), lerp(0.16, 0.5, u)); }
      }
      line("#3E6E7E", w * 1.12, 1); line(o.color || "#5C95A6", w, 1); line("#8FC0C9", w * 0.32, 0.6);
      return { g, path: pts };
    }

    // farmland patchwork far below — view "oblique" (to a hazy horizon) or "above" (straight down)
    set.farmland = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 97), far = o.far || 0, air = airOf(o);
      const PALS = {
        summer: ["#9DBB6A", "#B6C679", "#D8C88A", "#8BB068", "#C7B86D", "#A4C07B", "#7FA25D", "#DED19A", "#96B46E"],
        autumn: ["#B99A5E", "#C9B070", "#9E8D55", "#D5BC7C", "#8E9A5B", "#BFA062", "#A98F58"],
        spring: ["#9CC474", "#B5D38A", "#86B462", "#C8DB98", "#A9C77E", "#D8D6A0"],
        nile: ["#7FA95A", "#9DBF6A", "#6F9A4E", "#B7C979", "#8DB463", "#C2B874"],
      };
      const pal = PALS[o.palette] || PALS.summer;
      const hedge = o.hedge || "#5E7F46";
      const g = G(L, o, "farmland");
      if (o.view === "above") {
        const cell = o.cell ?? 220, rot = o.rot ?? -12;
        const gg = F.el("g", { transform: `rotate(${rot} 960 540)` }, g);
        const nx = Math.ceil((W + 1600) / cell), ny = Math.ceil((H + 1600) / cell);
        const P = [];
        for (let j = 0; j <= ny; j++) { P.push([]); for (let i = 0; i <= nx; i++) P[j].push([-800 + i * cell + (R() - 0.5) * cell * 0.5, -800 + j * cell * 0.8 + (R() - 0.5) * cell * 0.4]); }
        F.el("rect", { x: -900, y: -900, width: W + 1800, height: H + 1800, fill: col2(hedge), "data-cover": "1" }, gg);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const q = [P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]];
          const c = col2(K.pick(R, pal));
          const inset = 3;
          const cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2;
          const qi = q.map((p) => [p[0] + (cx - p[0]) * inset / cell * 2, p[1] + (cy - p[1]) * inset / cell * 2]);
          F.el("path", { d: K.poly(qi), fill: K.lg(L, K.lite(c, 0.05), K.dark(c, 0.05), "d") }, gg);
          if (R() < 0.35) {           // furrows
            let dd = "";
            for (let s = 1; s < 6; s++) { const u = s / 6; const a = [lerp(qi[0][0], qi[3][0], u), lerp(qi[0][1], qi[3][1], u)], b = [lerp(qi[1][0], qi[2][0], u), lerp(qi[1][1], qi[2][1], u)];
              dd += `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`; }
            F.el("path", { d: dd, stroke: K.dark(c, 0.12), "stroke-width": 2, opacity: 0.35, fill: "none" }, gg);
          }
          if (R() < 0.3) F.el("circle", { cx: f1(q[1][0]), cy: f1(q[1][1]), r: f1(10 + R() * 12), fill: col2("#4F7040") }, gg);
        }
        if (o.river) riverAbove(L, { parent: g, seed: o.seed, w: 40, green: false });
        if (o.haze !== false) F.el("rect", { x: -900, y: -900, width: W + 1800, height: H + 1800, fill: air, opacity: o.haze ?? 0.18, "data-cover": "1" }, g);
        return { g };
      }
      // oblique: a ground grid seen in perspective
      const hz = o.horizon ?? 300, yN = H + 260, zN = 1, zF = o.depth ?? 14;
      const proj = (X, Z) => [W / 2 + (X - (o.cx ?? 0)) * 700 / Z, hz + (yN - hz) * zN / Z];
      F.el("rect", { x: -900, y: f1(hz - 2), width: W + 1800, height: H + 1400, "data-cover": "x", fill: K.ulg(L, [[0, col2(F.mix(pal[0], air, 0.8))], [1, col2(pal[0])]], 0, hz, 0, H) }, g);
      const zs = [];
      for (let z = zN * 0.8; z < zF; z *= 1.18 + R() * 0.12) zs.push(z);
      const xs = [];
      for (let X = -9; X <= 9; X += 0.9 + R() * 0.8) xs.push(X);
      for (let j = zs.length - 2; j >= 0; j--) {
        const shift = (R() - 0.5) * 1.2;
        for (let i = 0; i < xs.length - 1; i++) {
          const z0 = zs[j], z1 = zs[j + 1], x0 = xs[i] + shift, x1 = xs[i + 1] + shift;
          const q = [proj(x0, z1), proj(x1, z1), proj(x1, z0), proj(x0, z0)];
          const depth = Math.pow((z0 - zN) / (zF - zN), 0.55);
          const hz2 = clamp((o.haze ?? 0.75) * depth, 0, 0.9);
          const c = K.air(K.pick(R, pal), clamp(far + hz2, 0, 0.93), air);
          F.el("path", { d: K.poly(q), fill: c, stroke: K.air(hedge, clamp(far + hz2, 0, 0.93), air), "stroke-width": f1(Math.max(0.6, 5 / z0)), "stroke-linejoin": "round" }, g);
          if (R() < 0.25 && z0 < zF * 0.6) {
            const p = q[3], r = 34 / z0;
            F.el("circle", { cx: f1(p[0]), cy: f1(p[1] - r * 0.6), r: f1(r), fill: K.air("#557A45", clamp(far + hz2, 0, 0.93), air) }, g);
          }
        }
      }
      if (o.haze !== false) set.haze(L, { parent: g, kind: "up", y: hz + 30, h: 120, below: 160, color: air, a: 0.9, fade: 0 });
      return { g, horizon: hz };
      function col2(c) { return K.air(c, far, air); }
    };

    // a desert seen from straight above: sand with soft variation, crescent dunes, ripples, optional puddles
    set.desertAbove = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 101), far = o.far || 0, air = airOf(o);
      const sand = o.color || "#D8BC89";
      const col = (c) => K.air(c, far, air);
      const g = G(L, o, "desert-above");
      F.el("rect", { x: -900, y: -900, width: W + 1800, height: H + 1800, fill: col(sand), "data-cover": "1" }, g);
      for (let i = 0; i < 26; i++) {
        const light = R() < 0.5;
        F.el("ellipse", { cx: f1(-300 + R() * (W + 600)), cy: f1(-300 + R() * (H + 600)), rx: f1(160 + R() * 380), ry: f1(90 + R() * 220),
          fill: K.soft(L, col(light ? K.lite(sand, 0.2) : K.dark(sand, 0.14)), 0.5), transform: `rotate(${f1((R() - 0.5) * 60)})` }, g);
      }
      const nd = o.dunes ?? 7;
      for (let i = 0; i < nd; i++) {
        const x = -150 + R() * (W + 300), y = -100 + R() * (H + 200), r = 70 + R() * 130, rot = (o.wind ?? 20) + (R() - 0.5) * 30;
        const dg = F.el("g", { transform: `translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)})` }, g);
        // barchan: a crescent, lit windward back and a dark slip face in its hollow
        F.el("path", { d: `M${f1(-r)} ${f1(r * 0.25)}C${f1(-r * 0.9)} ${f1(-r * 0.9)} ${f1(r * 0.9)} ${f1(-r * 0.9)} ${f1(r)} ${f1(r * 0.25)}C${f1(r * 0.45)} ${f1(-r * 0.2)} ${f1(-r * 0.45)} ${f1(-r * 0.2)} ${f1(-r)} ${f1(r * 0.25)}Z`,
          fill: K.lg(L, col(K.lite(sand, 0.22)), col(sand), "v") }, dg);
        F.el("path", { d: `M${f1(-r * 0.92)} ${f1(r * 0.22)}C${f1(-r * 0.45)} ${f1(-r * 0.18)} ${f1(r * 0.45)} ${f1(-r * 0.18)} ${f1(r * 0.92)} ${f1(r * 0.22)}C${f1(r * 0.4)} ${f1(r * 0.12)} ${f1(-r * 0.4)} ${f1(r * 0.12)} ${f1(-r * 0.92)} ${f1(r * 0.22)}Z`,
          fill: col(K.dark(sand, 0.2)), opacity: 0.8 }, dg);
      }
      if (o.ripples !== false) {
        let d = "";
        for (let i = 0; i < 70; i++) {
          const x = -200 + R() * (W + 400), y = -100 + R() * (H + 200), len = 40 + R() * 110, a = ((o.wind ?? 20) + 90) * K.deg;
          d += `M${f1(x)} ${f1(y)}q${f1(Math.cos(a) * len / 2 + 6)} ${f1(Math.sin(a) * len / 2)} ${f1(Math.cos(a) * len)} ${f1(Math.sin(a) * len)}`;
        }
        F.el("path", { d, fill: "none", stroke: col(K.dark(sand, 0.1)), "stroke-width": 2, opacity: 0.35, "stroke-linecap": "round" }, g);
      }
      if (o.puddles) {
        for (let i = 0; i < (o.puddles === true ? 16 : o.puddles); i++) {
          const x = -100 + R() * (W + 200), y = -60 + R() * (H + 120), r = 26 + R() * 40;
          F.el("path", { d: K.blob(x, y, r, r * (0.45 + 0.3 * R()), R, 9, 0.28), fill: K.lg(L, col("#DCE0DF"), col("#B9C1C3"), "v"), stroke: col("#EEF1F0"), "stroke-width": 2 }, g);
        }
      }
      if (o.tufts) set.tufts(L, { parent: g, n: o.tufts === true ? 60 : o.tufts, y0: -100, y1: H + 100, s: 0.7, seed: o.seed, color: "#7D7651", far });
      return { g };
    };

    // ══════════════════════════════════════════════════════════════════════════════
    //  VEGETATION
    // ══════════════════════════════════════════════════════════════════════════════
    // a date palm: curved ringed trunk, arching feathery fronds, date clusters; the crown sways
    set.palm = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 107), x = o.x ?? 960, y = o.y ?? 900, h = o.h ?? 520;
      const lean = o.lean ?? (R() - 0.5) * 0.28, far = o.far || 0, air = airOf(o);
      const col = (c) => K.air(c, far, air);
      const g = G(L, o, "palm");
      const tx = x + lean * h, ty = y - h, bx = x + lean * h * 0.1 + (R() - 0.5) * h * 0.06, by = y - h * 0.5;
      const B = (t) => [(1 - t) * (1 - t) * x + 2 * (1 - t) * t * bx + t * t * tx, (1 - t) * (1 - t) * y + 2 * (1 - t) * t * by + t * t * ty];
      const tw = (t) => h * (0.03 - 0.011 * t + (t < 0.06 ? (0.06 - t) * 0.22 : 0));
      const left = [], right = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, p = B(t), q = B(Math.min(1, t + 0.01)), p0 = B(Math.max(0, t - 0.01));
        const dx = q[0] - p0[0], dy = q[1] - p0[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
        left.push([p[0] + nx * tw(t), p[1] + ny * tw(t)]); right.push([p[0] - nx * tw(t), p[1] - ny * tw(t)]);
      }
      const trunkC = o.trunk || "#9C7F5A";
      F.el("path", { d: K.poly(left.concat(right.reverse())), fill: K.lg(L, col(K.lite(trunkC, 0.12)), col(K.dark(trunkC, 0.2)), "h") }, g);
      let rings = "";
      for (let i = 1; i < 26; i++) {
        const t = i / 26, p = B(t), w = tw(t), q = B(Math.min(1, t + 0.01)), p0 = B(Math.max(0, t - 0.01));
        const dx = q[0] - p0[0], dy = q[1] - p0[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
        rings += `M${f1(p[0] + nx * w)} ${f1(p[1] + ny * w)}Q${f1(p[0] + dx / l * w * 0.5)} ${f1(p[1] + dy / l * w * 0.5 + w * 0.3)} ${f1(p[0] - nx * w)} ${f1(p[1] - ny * w)}`;
      }
      F.el("path", { d: rings, fill: "none", stroke: col(K.dark(trunkC, 0.3)), "stroke-width": f1(Math.max(1, h * 0.004)), opacity: 0.65 }, g);
      // crown
      const crown = F.el("g", null, g);
      const nF = o.fronds ?? 14, fl = h * (o.frond ?? 0.42);
      const fr = [];
      for (let i = 0; i < nF; i++) {
        const a = (-195 + (i + 0.5) / nF * 210 + (R() - 0.5) * 12) * K.deg;
        fr.push({ a, len: fl * (0.8 + 0.35 * R()), droop: 0.45 + 0.55 * R(), back: Math.sin(a) < -0.6 });
      }
      // dead fronds hanging under the crown
      for (let i = 0; i < (o.dead ?? 3); i++) fr.push({ a: (70 + (i - 1) * 28 + (R() - 0.5) * 10) * K.deg, len: fl * 0.55, droop: 0.2, dead: true });
      fr.sort((p, q) => (q.back - p.back) || (q.dead ? 1 : 0) - (p.dead ? 1 : 0));
      const leafDark = o.leaf || "#4C7440", leafLite = K.lite(leafDark, 0.22);
      for (const f of fr) {
        const pts = [];
        const nS = 24;
        for (let k = 0; k <= nS; k++) {
          const s = k / nS, d = s * f.len;
          pts.push([tx + Math.cos(f.a) * d, ty + Math.sin(f.a) * d + f.droop * d * d / f.len]);
        }
        const c = f.dead ? "#A8895C" : f.back ? K.dark(leafDark, 0.1) : F.mix(leafDark, leafLite, 0.4 + 0.6 * R());
        let dl = "";
        const lw = f.len * 0.011 + 0.4;
        for (let k = 3; k < nS; k++) {
          const s = k / nS, p = pts[k], q = pts[Math.min(nS, k + 1)], p0 = pts[k - 1];
          const tx0 = q[0] - p0[0], ty0 = q[1] - p0[1], l = Math.hypot(tx0, ty0) || 1, ux = tx0 / l, uy = ty0 / l;
          const ll = f.len * (f.dead ? 0.12 : 0.21) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + s * 0.95)), 0.55);
          for (const side of [1, -1]) {
            const ang = side * (38 + 14 * s) * K.deg, ca = Math.cos(ang), sa = Math.sin(ang);
            let dx = ux * ca - uy * sa, dy = ux * sa + uy * ca;
            dy += 0.35 + (side < 0 ? 0.15 : 0);                 // leaflets hang a little
            const m = Math.hypot(dx, dy); dx /= m; dy /= m;
            const ex = p[0] + dx * ll, ey = p[1] + dy * ll, nx = -dy * lw, ny = dx * lw;
            dl += `M${f1(p[0] + nx)} ${f1(p[1] + ny)}L${f1(ex)} ${f1(ey)}L${f1(p[0] - nx)} ${f1(p[1] - ny)}Z`;
          }
        }
        F.el("path", { d: dl, fill: K.air(c, far, air) }, crown);
        F.el("path", { d: K.poly(pts, false), fill: "none", stroke: col(K.dark(c, 0.25)), "stroke-width": f1(Math.max(0.8, h * 0.004)), "stroke-linecap": "round" }, crown);
      }
      if (o.dates) {
        for (let i = 0; i < 2; i++) {
          const cx = tx + (i ? 1 : -1) * h * 0.028, cy = ty + h * 0.03;
          let d = "";
          for (let k = 0; k < 9; k++) { const ex = cx + (R() - 0.5) * h * 0.035, ey = cy + h * (0.03 + R() * 0.05); d += `M${f1(cx)} ${f1(cy)}Q${f1((cx + ex) / 2)} ${f1(cy)} ${f1(ex)} ${f1(ey)}`;
            F.el("circle", { cx: f1(ex), cy: f1(ey), r: f1(h * 0.006), fill: col(R() < 0.5 ? "#D38B31" : "#B06A24") }, crown); }
          F.el("path", { d, fill: "none", stroke: col("#C9A050"), "stroke-width": f1(Math.max(0.8, h * 0.003)) }, crown);
        }
      }
      F.el("ellipse", { cx: f1(tx), cy: f1(ty + h * 0.008), rx: f1(h * 0.028), ry: f1(h * 0.022), fill: col("#7C6644") }, crown);
      if ((o.sway ?? 1.4) > 0 && S) K.sway(S, crown, { amp: o.sway ?? 1.4, f: 0.22 + R() * 0.1, seed: o.seed ?? 1, ox: tx, oy: ty });
      if (o.shadow !== false && !far) F.el("ellipse", { cx: f1(x + h * 0.05), cy: f1(y + 2), rx: f1(h * 0.12), ry: f1(h * 0.02), fill: K.soft(L, "#5A4328", 0.3) }, g);
      return { g, top: [tx, ty], base: [x, y], crown };
    };

    // a tree. kind: round (the reference's sage-green puffs) | poplar | cypress | olive | pine (umbrella) |
    // conifer | acacia | bare
    set.tree = (L, o = {}) => {
      const kind = o.kind || "round", R = K.R(o.seed ?? 1, 113), x = o.x ?? 960, y = o.y ?? 900, h = o.h ?? 420;
      const far = o.far || 0, air = airOf(o);
      const col = (c) => K.air(c, far, air);
      const g = G(L, o, "tree");
      const LEAF = { round: "#8DB87A", poplar: "#7FA862", cypress: "#4E6E47", olive: "#97AA80", pine: "#5A7B4B", conifer: "#4C6A48", acacia: "#8E9E5B", bare: "#7A6450" };
      const leaf = o.color || LEAF[kind] || LEAF.round;
      const bark = o.bark || (kind === "olive" ? "#7F7466" : "#8A7462");
      if (o.shadow !== false && !far) F.el("ellipse", { cx: f1(x), cy: f1(y + 2), rx: f1(h * (kind === "cypress" ? 0.1 : 0.26)), ry: f1(h * 0.035), fill: K.soft(L, "#3E3322", 0.28) }, g);
      const under = F.el("g", null, g);
      const trunk = (x0, y0, x1, y1, w0, w1) => {
        const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
        return F.el("path", { d: `M${f1(x0 + nx * w0)} ${f1(y0 + ny * w0)}Q${f1((x0 + x1) / 2 + nx * (w0 + w1) * 0.6)} ${f1((y0 + y1) / 2 + ny * (w0 + w1) * 0.6)} ${f1(x1 + nx * w1)} ${f1(y1 + ny * w1)}L${f1(x1 - nx * w1)} ${f1(y1 - ny * w1)}Q${f1((x0 + x1) / 2 - nx * (w0 + w1) * 0.4)} ${f1((y0 + y1) / 2 - ny * (w0 + w1) * 0.4)} ${f1(x0 - nx * w0)} ${f1(y0 - ny * w0)}Z`,
          fill: K.lg(L, col(K.lite(bark, 0.1)), col(K.dark(bark, 0.22)), "h") }, under);
      };
      const crown = F.el("g", null, g);
      const canopy = (cs, c, parent = crown) => {
        const d = K.puffs(cs);
        F.el("path", { d, fill: K.lgs(L, [[0, col(K.lite(c, 0.14))], [0.55, col(c)], [1, col(K.dark(c, 0.2))]], "v") }, parent);
        return d;
      };
      let top = [x, y - h];
      if (kind === "round" || kind === "poplar") {
        const cr = h * (kind === "poplar" ? 0.2 : 0.34), cy = y - h + cr * (kind === "poplar" ? 2.3 : 1.05), cx = x + (R() - 0.5) * h * 0.05;
        trunk(x, y, cx + (R() - 0.5) * h * 0.04, cy, h * 0.03, h * 0.018);
        const cs = [{ x: cx, y: cy, r: cr * 0.62 }];
        const nb = kind === "poplar" ? 7 : 8;
        for (let i = 0; i < nb; i++) {
          const a = (i / nb) * Math.PI * 2 + R() * 0.4, dd = cr * (0.42 + 0.12 * R());
          cs.push({ x: cx + Math.cos(a) * dd * (kind === "poplar" ? 0.55 : 1), y: cy + Math.sin(a) * dd * (kind === "poplar" ? 2.2 : 0.78), r: cr * (0.42 + 0.16 * R()) });
        }
        canopy(cs, leaf);
        for (let i = 0; i < 4; i++) {
          const c = cs[1 + Math.floor(R() * (cs.length - 1))];
          F.el("ellipse", { cx: f1(c.x + c.r * 0.15), cy: f1(c.y + c.r * 0.55), rx: f1(c.r * 0.75), ry: f1(c.r * 0.3), fill: K.soft(L, col(K.dark(leaf, 0.35)), 0.28) }, crown);
        }
        F.el("ellipse", { cx: f1(cx - cr * 0.3), cy: f1(cy - cr * 0.35), rx: f1(cr * 0.45), ry: f1(cr * 0.32), fill: K.soft(L, col(K.lite(leaf, 0.45)), 0.35) }, crown);
        top = [cx, cy - cr];
      } else if (kind === "cypress") {
        const w = h * 0.13;
        trunk(x, y, x, y - h * 0.1, h * 0.02, h * 0.018);
        const pts = [[x - w * 0.55, y - h * 0.06], [x - w, y - h * 0.3], [x - w * 0.85, y - h * 0.6], [x - w * 0.35, y - h * 0.9], [x, y - h], [x + w * 0.35, y - h * 0.9], [x + w * 0.85, y - h * 0.6], [x + w, y - h * 0.3], [x + w * 0.55, y - h * 0.06]];
        F.el("path", { d: K.curve(pts, true), fill: K.lg(L, col(K.lite(leaf, 0.12)), col(K.dark(leaf, 0.2)), "h") }, crown);
        let d = "";
        for (let i = 0; i < 9; i++) { const yy = y - h * (0.12 + R() * 0.72), xx = x + (R() - 0.3) * w * 0.9; d += `M${f1(xx)} ${f1(yy)}q${f1(w * 0.12)} ${f1(-h * 0.04)} ${f1(w * 0.05)} ${f1(-h * 0.1)}`; }
        F.el("path", { d, fill: "none", stroke: col(K.dark(leaf, 0.3)), "stroke-width": f1(Math.max(1, h * 0.006)), opacity: 0.6 }, crown);
      } else if (kind === "olive" || kind === "acacia" || kind === "pine") {
        const flat = kind !== "olive";
        const cw = h * (kind === "acacia" ? 0.52 : kind === "pine" ? 0.42 : 0.36), cy = y - h * (kind === "pine" ? 0.84 : 0.72);
        const fork = y - h * (kind === "pine" ? 0.7 : 0.4);
        trunk(x, y, x + (R() - 0.5) * h * 0.05, fork, h * 0.03, h * 0.02);
        const arms = kind === "pine" ? 2 : 3;
        for (let i = 0; i < arms; i++) {
          const ex = x + (i - (arms - 1) / 2) * cw * 0.7, ey = cy + h * 0.05;
          F.el("path", { d: `M${f1(x)} ${f1(fork)}Q${f1((x + ex) / 2)} ${f1(fork - h * 0.02)} ${f1(ex)} ${f1(ey)}`, fill: "none", stroke: col(K.dark(bark, 0.1)), "stroke-width": f1(h * 0.016), "stroke-linecap": "round" }, under);
        }
        const cs = [];
        const nb = kind === "olive" ? 9 : 8;
        for (let i = 0; i < nb; i++) {
          const u = (i + 0.5) / nb - 0.5;
          cs.push({ x: x + u * cw * 2 * (0.9 + 0.2 * R()), y: cy + (flat ? Math.pow(Math.abs(u) * 2, 2) * h * 0.03 + (R() - 0.5) * h * 0.03 : (R() - 0.5) * h * 0.14), r: h * (flat ? 0.085 : 0.12) * (0.8 + 0.4 * R()) });
        }
        if (flat) cs.push({ x, y: cy - h * 0.05, r: h * 0.1 });
        canopy(cs, leaf);
        if (kind === "olive") for (let i = 0; i < 6; i++) { const c = K.pick(R, cs); F.el("ellipse", { cx: f1(c.x - c.r * 0.2), cy: f1(c.y - c.r * 0.3), rx: f1(c.r * 0.5), ry: f1(c.r * 0.3), fill: K.soft(L, col("#D9E2C6"), 0.4) }, crown); }
        top = [x, cy - h * 0.15];
      } else if (kind === "conifer") {
        trunk(x, y, x, y - h * 0.15, h * 0.025, h * 0.02);
        const tiers = 4;
        for (let i = 0; i < tiers; i++) {
          const u = i / tiers, yb = y - h * (0.1 + u * 0.72), wt = h * 0.26 * (1 - u * 0.62), ht = h * 0.36;
          const pts = [[x - wt, yb]];
          for (let k = 1; k < 6; k++) pts.push([x - wt + (k / 6) * wt * 2, yb + (k % 2 ? h * 0.025 : 0)]);
          pts.push([x + wt, yb], [x + wt * 0.15, yb - ht * 0.8], [x, yb - ht], [x - wt * 0.15, yb - ht * 0.8]);
          F.el("path", { d: K.poly(pts), fill: K.lg(L, col(K.lite(leaf, 0.08 + 0.04 * i)), col(K.dark(leaf, 0.2)), "h") }, crown);
        }
      } else if (kind === "bare") {
        const branch = (x0, y0, a, len, w, depth) => {
          const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
          F.el("path", { d: `M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`, stroke: col(bark), "stroke-width": f1(w), "stroke-linecap": "round" }, crown);
          if (depth > 0) for (let k = 0; k < 2; k++) branch(x1, y1, a + (k ? 1 : -1) * (0.3 + R() * 0.4), len * (0.62 + R() * 0.15), w * 0.62, depth - 1);
        };
        branch(x, y, -Math.PI / 2, h * 0.36, h * 0.04, 5);
      }
      const sway = o.sway ?? (kind === "cypress" || kind === "poplar" ? 0.8 : 0.6);
      if (sway > 0) K.sway(S, crown, { amp: sway, f: 0.2 + R() * 0.1, seed: o.seed ?? 1, ox: x, oy: y });
      return { g, base: [x, y], top };
    };

    // a low bush (desert scrub or garden hedge)
    set.bush = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 127), x = o.x ?? 960, y = o.y ?? 900, w = o.w ?? 140, h = o.h ?? w * 0.55;
      const far = o.far || 0, air = airOf(o), c = o.color || "#7E9A5E";
      const col = (v) => K.air(v, far, air);
      const g = G(L, o, "bush");
      if (o.shadow !== false) F.el("ellipse", { cx: f1(x), cy: f1(y), rx: f1(w * 0.6), ry: f1(h * 0.14), fill: K.soft(L, col("#4A3C28"), 0.3) }, g);
      const k = 3 + Math.floor(w / 60);
      const cs = [];
      for (let i = 0; i < k; i++) {
        const u = (i + 0.5) / k, d = Math.sin(Math.PI * u);
        const r = h * (0.32 + 0.3 * d) * (0.85 + 0.3 * R());
        cs.push({ x: x - w / 2 + u * w, y: y - r * 0.8 - d * h * 0.18, r });
      }
      F.el("path", { d: K.puffsFlat(cs, y, 3, cs[0].x, cs[cs.length - 1].x), fill: K.lgs(L, [[0, col(K.lite(c, 0.16))], [0.6, col(c)], [1, col(K.dark(c, 0.25))]], "v") }, g);
      return { g, top: [x, y - h] };
    };

    // reeds by water. kind: papyrus (stalks with starburst umbels) | cattail | reed (feathery plumes)
    set.reeds = (L, o = {}) => {
      const kind = o.kind || "papyrus", R = K.R(o.seed ?? 1, 131), x = o.x ?? 960, y = o.y ?? 900, w = o.w ?? 200, h = o.h ?? 300;
      const n = o.n ?? Math.round(w / 16), far = o.far || 0, air = airOf(o);
      const col = (c) => K.air(c, far, air);
      const g = G(L, o, "reeds");
      const groups = [0, 1, 2].map(() => F.el("g", null, g));
      const stem = col(kind === "papyrus" ? "#6F9148" : "#6E8A45"), head = col(kind === "papyrus" ? "#8FB058" : kind === "cattail" ? "#6B4A2E" : "#CDB98E");
      const blade = col("#5F7F3E");
      // base leaves
      let dBl = "";
      for (let i = 0; i < n * 0.8; i++) {
        const bx = x + (R() - 0.5) * w, a = (-90 + (R() - 0.5) * 70) * K.deg, len = h * (0.18 + R() * 0.3);
        const ex = bx + Math.cos(a) * len, ey = y + Math.sin(a) * len;
        dBl += `M${f1(bx - 3)} ${f1(y)}Q${f1(bx + Math.cos(a) * len * 0.5 + 4)} ${f1(y + Math.sin(a) * len * 0.5)} ${f1(ex)} ${f1(ey)}Q${f1(bx + Math.cos(a) * len * 0.5 - 2)} ${f1(y + Math.sin(a) * len * 0.5)} ${f1(bx + 3)} ${f1(y)}Z`;
      }
      for (let i = 0; i < n; i++) {
        const gg = groups[i % 3];
        const bx = x + (R() - 0.5) * w * 0.8, hh = h * (0.6 + 0.4 * R()), lean = (R() - 0.5) * 0.3;
        const tx = bx + lean * hh, ty = y - hh;
        F.el("path", { d: `M${f1(bx)} ${f1(y)}Q${f1(bx + lean * hh * 0.3)} ${f1(y - hh * 0.5)} ${f1(tx)} ${f1(ty)}`, fill: "none", stroke: stem, "stroke-width": f1(Math.max(1.2, h * (kind === "papyrus" ? 0.012 : 0.009))), "stroke-linecap": "round" }, gg);
        if (kind === "papyrus") {
          let d = "", d2 = "";
          const m = 26, rr = hh * (0.14 + 0.05 * R());
          for (let k = 0; k < m; k++) {
            const a = (k / m) * Math.PI * 2 + R() * 0.2, ca = Math.cos(a), sa = Math.sin(a);
            const ex = tx + ca * rr * (0.8 + 0.3 * R()), ey = ty + sa * rr * 0.62 + rr * (0.25 + 0.3 * Math.abs(ca));
            const line = `M${f1(tx)} ${f1(ty)}Q${f1(tx + ca * rr * 0.55)} ${f1(ty + sa * rr * 0.45 - rr * 0.18)} ${f1(ex)} ${f1(ey)}`;
            if (sa < 0) d += line; else d2 += line;
          }
          F.el("path", { d, fill: "none", stroke: K.dark(head, 0.12), "stroke-width": f1(Math.max(1, h * 0.0065)), "stroke-linecap": "round" }, gg);
          F.el("path", { d: d2, fill: "none", stroke: head, "stroke-width": f1(Math.max(1, h * 0.0075)), "stroke-linecap": "round" }, gg);
          F.el("ellipse", { cx: f1(tx), cy: f1(ty + rr * 0.05), rx: f1(rr * 0.12), ry: f1(rr * 0.08), fill: K.dark(head, 0.2) }, gg);
        } else if (kind === "cattail") {
          if (R() < 0.6) F.el("rect", { x: f1(tx - h * 0.012), y: f1(ty + h * 0.02), width: f1(h * 0.024), height: f1(h * 0.12), rx: f1(h * 0.012), fill: head }, gg);
        } else {
          F.el("path", { d: `M${f1(tx)} ${f1(ty)}q${f1(h * 0.04)} ${f1(h * 0.05)} ${f1(h * 0.02)} ${f1(h * 0.14)}q${f1(-h * 0.03)} ${f1(-h * 0.05)} ${f1(-h * 0.02)} ${f1(-h * 0.14)}Z`, fill: head, opacity: 0.9 }, gg);
        }
      }
      F.el("path", { d: dBl, fill: blade }, g);
      if ((o.sway ?? 2) > 0) groups.forEach((gg, i) => K.sway(S, gg, { amp: (o.sway ?? 2) * (0.7 + 0.2 * i), f: 0.3 + 0.08 * i, seed: i + (o.seed ?? 1), ox: x, oy: y }));
      return { g, base: [x, y] };
    };

    // grass tufts in a row (beach grass with oat-like seed heads — the blurred foreground of the reference)
    // kind: beach | meadow | dry
    set.grass = (L, o = {}) => {
      const kind = o.kind || "beach", R = K.R(o.seed ?? 1, 137), x = o.x ?? 960, y = o.y ?? 1080, w = o.w ?? 600, h = o.h ?? 260;
      const n = o.n ?? Math.max(2, Math.round(w / 150)), far = o.far || 0, air = airOf(o);
      const base = o.color || (kind === "meadow" ? "#7FA350" : kind === "dry" ? "#C9B27A" : "#BFA56C");
      const col = (c) => K.air(c, far, air);
      const g = G(L, o, "grass");
      const tufts = [];
      for (let i = 0; i < n; i++) {
        const tx = x - w / 2 + (i + 0.5) / n * w + (R() - 0.5) * w / n * 0.7, th = h * (0.6 + 0.5 * R());
        const tg = F.el("g", null, g);
        const m = 6 + Math.floor(R() * 5);
        const cA = col(K.dark(base, 0.1)), cB = col(K.lite(base, 0.08));
        let dA = "", dB = "";
        for (let k = 0; k < m; k++) {
          const a = (-90 + (k - (m - 1) / 2) * (kind === "meadow" ? 9 : 7) + (R() - 0.5) * 10) * K.deg, len = th * (0.55 + 0.45 * R()), bw = th * 0.018 + 1;
          const bend = (R() - 0.5) * 0.5 + Math.cos(a) * 0.6;
          const ex = tx + Math.cos(a) * len + bend * len * 0.25, ey = y + Math.sin(a) * len;
          const mx = tx + Math.cos(a) * len * 0.5, my = y + Math.sin(a) * len * 0.5;
          const d = `M${f1(tx - bw)} ${f1(y)}Q${f1(mx + bw)} ${f1(my)} ${f1(ex)} ${f1(ey)}Q${f1(mx - bw * 0.3)} ${f1(my)} ${f1(tx + bw)} ${f1(y)}Z`;
          if (k % 2) dA += d; else dB += d;
        }
        F.el("path", { d: dA, fill: cA }, tg);
        F.el("path", { d: dB, fill: cB }, tg);
        if (kind === "beach" || kind === "dry") {
          const heads = 1 + Math.floor(R() * 3);
          for (let k = 0; k < heads; k++) {
            const a = (-90 + (R() - 0.5) * 40) * K.deg, len = th * (0.95 + 0.3 * R());
            const ex = tx + Math.cos(a) * len, ey = y + Math.sin(a) * len;
            const cx = tx + Math.cos(a) * len * 0.5 + (R() - 0.5) * th * 0.2, cy = y + Math.sin(a) * len * 0.5;
            F.el("path", { d: `M${f1(tx)} ${f1(y)}Q${f1(cx)} ${f1(cy)} ${f1(ex)} ${f1(ey)}`, fill: "none", stroke: cA, "stroke-width": f1(th * 0.008 + 0.8) }, tg);
            // grains along the top third
            let dg = "";
            for (let j = 0; j < 9; j++) {
              const u = 0.62 + j * 0.042, px = (1 - u) * (1 - u) * tx + 2 * (1 - u) * u * cx + u * u * ex, py = (1 - u) * (1 - u) * y + 2 * (1 - u) * u * cy + u * u * ey;
              const s = th * 0.022 * (1 - (j / 9) * 0.5), side = j % 2 ? 1 : -1;
              dg += `M${f1(px)} ${f1(py)}q${f1(side * s * 1.6)} ${f1(-s * 0.4)} ${f1(side * s * 0.8)} ${f1(-s * 2.2)}q${f1(-side * s)} ${f1(s * 0.6)} ${f1(-side * s * 0.8)} ${f1(s * 2.2)}Z`;
            }
            F.el("path", { d: dg, fill: cB }, tg);
          }
        }
        tufts.push({ g: tg, x: tx });
      }
      const amp = o.sway ?? 3;
      if (amp > 0) tufts.forEach((t, i) => K.sway(S, t.g, { amp: amp * (0.7 + 0.5 * ((i * 37) % 10) / 10), f: 0.28 + ((i * 13) % 7) * 0.02, seed: i * 3 + (o.seed ?? 1), ox: t.x, oy: y }));
      return { g, tufts };
    };

    // a strip of wheat: stalks with ears and awns; far: a golden band with texture
    set.wheat = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 139), x = o.x ?? 960, y = o.y ?? 1080, w = o.w ?? 1000, h = o.h ?? 240;
      const n = o.n ?? Math.round(w / 14), far = o.far || 0, air = airOf(o);
      const gold = o.color || "#DDB85E";
      const col = (c) => K.air(c, far, air);
      const g = G(L, o, "wheat");
      if (o.mass !== false) {
        const top = [];
        for (let xx = x - w / 2; xx <= x + w / 2 + 1; xx += 9) top.push([xx, y - h * (0.8 + 0.03 * Math.sin(xx * 0.013) + 0.07 * R())]);
        const fe = Math.min(260, w * 0.2);
        const edge = (xx) => F.smooth(Math.min(1, (xx - (x - w / 2)) / fe, (x + w / 2 - xx) / fe));
        const d = "M" + top.map(([xx, yy]) => `${f1(xx)} ${f1(y + 40 - (y + 40 - yy) * clamp(edge(xx), 0, 1))}`).join("L") + `L${f1(x + w / 2)} ${f1(y + 40)}L${f1(x - w / 2)} ${f1(y + 40)}Z`;
        F.el("path", { d, fill: K.lgs(L, [[0, col(K.lite(gold, 0.08))], [0.25, col(gold)], [1, col(K.dark(gold, 0.4))]], "v") }, g);
      }
      const groups = [0, 1, 2, 3].map(() => F.el("g", null, g));
      const stemC = col(K.dark(gold, 0.15)), earA = col(gold), earB = col(K.dark(gold, 0.18));
      for (let i = 0; i < n; i++) {
        const gg = groups[i % 4];
        const bx = x - w / 2 + R() * w, hh = h * (0.75 + 0.3 * R()), lean = (R() - 0.5) * 0.18;
        const tx = bx + lean * hh, ty = y - hh;
        F.el("path", { d: `M${f1(bx)} ${f1(y + 20)}Q${f1(bx)} ${f1(y - hh * 0.5)} ${f1(tx)} ${f1(ty)}`, fill: "none", stroke: stemC, "stroke-width": f1(Math.max(1, h * 0.008)) }, gg);
        const el = h * 0.13, ew = h * 0.022, a = Math.atan2(ty - (y - hh * 0.5), tx - bx) ;
        void a;
        let d = "";
        for (let k = 0; k < 6; k++) {
          const u = k / 6, cx = tx + lean * el * u, cy = ty - el * u;
          d += `M${f1(cx - ew)} ${f1(cy)}q${f1(ew)} ${f1(-ew * 1.6)} ${f1(ew * 2)} 0q${f1(-ew)} ${f1(ew * 1.2)} ${f1(-ew * 2)} 0Z`;
        }
        F.el("path", { d, fill: i % 2 ? earA : earB }, gg);
        F.el("path", { d: `M${f1(tx)} ${f1(ty - el)}l${f1(-ew * 1.5)} ${f1(-el * 0.7)}M${f1(tx)} ${f1(ty - el)}l${f1(ew * 1.5)} ${f1(-el * 0.7)}M${f1(tx)} ${f1(ty - el)}l0 ${f1(-el * 0.8)}`,
          stroke: earA, "stroke-width": 1, fill: "none", opacity: 0.8 }, gg);
      }
      if ((o.sway ?? 1.5) > 0) groups.forEach((gg, i) => K.sway(S, gg, { amp: o.sway ?? 1.5, f: 0.3 + 0.05 * i, seed: i + 7, ox: x, oy: y + 200 }));
      return { g };
    };

    // ══════════════════════════════════════════════════════════════════════════════
    //  ANCIENT ARCHITECTURE
    // ══════════════════════════════════════════════════════════════════════════════
    const STONE = { marble: "#ECE2CD", limestone: "#E2D2AE", sandstone: "#DCC08E", granite: "#B7A99A", mud: "#C9A57A", white: "#EEE8DA" };
    K.STONE = STONE;
    const stoneOf = (o, d = "marble") => (o.color && o.color[0] === "#" ? o.color : STONE[o.color || o.stone || d] || STONE[d]);

    // one column. order: doric | ionic | egyptian (papyrus bundle with a bell capital) | plain
    set.column = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 900, h = o.h ?? 520, order = o.order || "doric";
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.8 });
      const c = stoneOf(o, order === "egyptian" ? "sandstone" : "marble");
      const g = P.g(G(L, o, "column"));
      const d = h * (o.thick ?? (order === "doric" ? 0.13 : order === "egyptian" ? 0.16 : 0.105));
      const baseH = order === "ionic" ? h * 0.05 : order === "egyptian" ? h * 0.03 : 0;
      const capH = order === "doric" ? h * 0.075 : order === "ionic" ? h * 0.07 : order === "egyptian" ? h * 0.16 : h * 0.04;
      const y0 = y - baseH, y1 = y - h + capH, top = d * (order === "egyptian" ? 0.86 : 0.8);
      const ent = d * 0.025;
      const shaft = `M${f1(x - d / 2)} ${f1(y0)}C${f1(x - d / 2 - ent)} ${f1(lerp(y0, y1, 0.35))} ${f1(x - top / 2)} ${f1(lerp(y0, y1, 0.7))} ${f1(x - top / 2)} ${f1(y1)}L${f1(x + top / 2)} ${f1(y1)}C${f1(x + top / 2)} ${f1(lerp(y0, y1, 0.7))} ${f1(x + d / 2 + ent)} ${f1(lerp(y0, y1, 0.35))} ${f1(x + d / 2)} ${f1(y0)}Z`;
      P.path(g, shaft, c, { fill: K.cyl(L, P.col(c)), inkOf: c });
      // flutes
      const nfl = order === "egyptian" ? 6 : 7;
      let fl = "";
      for (let i = 1; i < nfl; i++) {
        const u = -Math.cos((i / nfl) * Math.PI);
        fl += `M${f1(x + u * d / 2 * 0.96)} ${f1(y0 - 2)}L${f1(x + u * top / 2 * 0.96)} ${f1(y1 + 2)}`;
      }
      P.stroke(g, fl, K.dark(c, 0.2), Math.max(0.8, d * 0.018), { op: 0.45 });
      if (order === "doric") {
        P.path(g, `M${f1(x - top / 2)} ${f1(y1)}C${f1(x - top / 2 - d * 0.05)} ${f1(y1 - capH * 0.3)} ${f1(x - d * 0.62)} ${f1(y1 - capH * 0.45)} ${f1(x - d * 0.64)} ${f1(y1 - capH * 0.55)}L${f1(x + d * 0.64)} ${f1(y1 - capH * 0.55)}C${f1(x + d * 0.62)} ${f1(y1 - capH * 0.45)} ${f1(x + top / 2 + d * 0.05)} ${f1(y1 - capH * 0.3)} ${f1(x + top / 2)} ${f1(y1)}Z`, c, { fill: K.cyl(L, P.col(c)), inkOf: c });
        P.rect(g, x - d * 0.7, y - h, d * 1.4, capH * 0.45, c, { fill: K.cyl(L, P.col(K.lite(c, 0.05)), 0.7), inkOf: c });
      } else if (order === "ionic") {
        P.rect(g, x - d * 0.72, y - h + capH * 0.12, d * 1.44, capH * 0.5, c, { fill: K.cyl(L, P.col(c), 0.7), inkOf: c });
        for (const sd of [-1, 1]) {
          const vx = x + sd * d * 0.62, vy = y - h + capH * 0.62, r = capH * 0.46;
          P.circle(g, vx, vy, r, c, { fill: K.cyl(L, P.col(c), 0.8), inkOf: c });
          P.stroke(g, `M${f1(vx)} ${f1(vy)}m${f1(-r * 0.2)} 0a${f1(r * 0.2)} ${f1(r * 0.2)} 0 1 1 ${f1(r * 0.4)} 0a${f1(r * 0.4)} ${f1(r * 0.4)} 0 1 1 ${f1(-r * 0.8)} 0a${f1(r * 0.6)} ${f1(r * 0.6)} 0 1 1 ${f1(r * 1.2)} 0`, K.dark(c, 0.3), Math.max(0.8, r * 0.07));
        }
        P.rect(g, x - d * 0.58, y - h, d * 1.16, capH * 0.16, c, { inkOf: c });
        P.rect(g, x - d * 0.66, y - baseH * 0.55, d * 1.32, baseH * 0.55, c, { fill: K.cyl(L, P.col(c), 0.7), inkOf: c, rx: baseH * 0.2 });
        P.rect(g, x - d * 0.72, y - baseH * 0.25, d * 1.44, baseH * 0.25, c, { inkOf: c });
        P.rect(g, x - d * 0.6, y - baseH, d * 1.2, baseH * 0.48, c, { fill: K.cyl(L, P.col(c), 0.7), inkOf: c, rx: baseH * 0.2 });
      } else if (order === "egyptian") {
        const bands = ["#3E6E8E", "#B5553A", "#3E6E8E"];
        bands.forEach((bc, i) => P.rect(g, x - top / 2, y1 - capH * 0.02 + i * h * 0.012, top, h * 0.01, bc, { line: false, op: 0.8 }));
        P.path(g, `M${f1(x - top / 2)} ${f1(y1)}C${f1(x - top / 2 - d * 0.1)} ${f1(y1 - capH * 0.4)} ${f1(x - d * 0.95)} ${f1(y1 - capH * 0.7)} ${f1(x - d * 0.95)} ${f1(y - h + capH * 0.12)}L${f1(x + d * 0.95)} ${f1(y - h + capH * 0.12)}C${f1(x + d * 0.95)} ${f1(y1 - capH * 0.7)} ${f1(x + top / 2 + d * 0.1)} ${f1(y1 - capH * 0.4)} ${f1(x + top / 2)} ${f1(y1)}Z`, c, { fill: K.cyl(L, P.col(c)), inkOf: c });
        let lv = "";
        for (let i = -3; i <= 3; i++) lv += `M${f1(x + i * top * 0.13)} ${f1(y1)}Q${f1(x + i * d * 0.2)} ${f1(y1 - capH * 0.5)} ${f1(x + i * d * 0.3)} ${f1(y - h + capH * 0.15)}`;
        P.stroke(g, lv, K.dark(c, 0.25), Math.max(0.8, d * 0.02), { op: 0.5 });
        P.rect(g, x - d * 0.55, y - h, d * 1.1, capH * 0.12, c, { inkOf: c });
      } else {
        P.rect(g, x - d * 0.62, y - h, d * 1.24, capH, c, { fill: K.cyl(L, P.col(c), 0.7), inkOf: c });
      }
      return { g, top: [x, y - h], base: [x, y], w: d };
    };

    // an entablature band (architrave + frieze + cornice) over x0..x1 at top y (height hh)
    function entablature(P, g, x0, x1, y, hh, c, doric, painted) {
      const a = hh * 0.36, fr = hh * 0.36, co = hh * 0.28;
      P.rect(g, x0, y + fr + co, x1 - x0, a, c, { k: 0.06 });
      P.rect(g, x0, y + co, x1 - x0, fr, K.dark(c, 0.05), { k: 0.06 });
      if (doric) {
        const n = Math.max(2, Math.round((x1 - x0) / (fr * 1.6)));
        for (let i = 0; i <= n; i++) {
          const tx = x0 + (i / n) * (x1 - x0) - fr * 0.3;
          P.rect(g, clamp(tx, x0, x1 - fr * 0.6), y + co, fr * 0.6, fr, painted ? "#58708A" : K.dark(c, 0.12), { k: 0.05, sw: 1 });
          P.stroke(g, `M${f1(clamp(tx, x0, x1) + fr * 0.2)} ${f1(y + co + fr * 0.1)}v${f1(fr * 0.8)}M${f1(clamp(tx, x0, x1) + fr * 0.4)} ${f1(y + co + fr * 0.1)}v${f1(fr * 0.8)}`, K.dark(c, 0.35), Math.max(0.7, fr * 0.04), { op: 0.6 });
        }
      } else if (painted) {
        P.rect(g, x0, y + co + fr * 0.35, x1 - x0, fr * 0.3, "#B8674A", { line: false, op: 0.55 });
      }
      P.rect(g, x0 - hh * 0.12, y, x1 - x0 + hh * 0.24, co, K.lite(c, 0.06), { k: 0.08 });
      P.rect(g, x0 - hh * 0.12, y + co - 2, x1 - x0 + hh * 0.24, hh * 0.06, "#000000", { line: false, op: 0.12 });
      // dentils
      let dd = "";
      for (let x = x0; x < x1; x += hh * 0.12) dd += `M${f1(x)} ${f1(y + co * 0.62)}h${f1(hh * 0.06)}v${f1(co * 0.25)}h${f1(-hh * 0.06)}Z`;
      F.el("path", { d: dd, fill: P.col(K.dark(c, 0.18)), opacity: 0.6 }, g);
    }

    // a row of columns under an entablature — a stoa. view "front" (elevation) or "perspective"
    // (receding from `near` {x, y, h} toward the vanishing point `vp` {x, y})
    set.colonnade = (L, o = {}) => {
      if (o.view === "perspective") return colonnadePersp(L, o);
      const x = o.x ?? 960, y = o.y ?? 880, w = o.w ?? 1500, h = o.h ?? 520, n = o.n ?? 7, order = o.order || "doric";
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.8 });
      const c = stoneOf(o);
      const g = P.g(G(L, o, "colonnade"));
      const steps = o.steps ?? 3, sh = h * 0.035, ch = h * 0.78, eh = h * 0.2;
      const colBase = y - steps * sh, top = colBase - ch;
      // back wall in shade + the ceiling shadow
      if (o.wall !== false) {
        const wc = o.wallColor || K.dark(c, 0.32);
        P.rect(g, x - w / 2, top, w, ch, wc, { line: false, fill: K.lg(L, P.col(K.dark(wc, 0.15)), P.col(K.lite(wc, 0.04)), "v") });
        if (o.doors !== false) for (let i = 0; i < (o.doors ?? 3); i++) {
          const dx = x - w / 2 + (i + 0.5) / (o.doors ?? 3) * w, dw = ch * 0.22;
          P.rect(g, dx - dw / 2, colBase - ch * 0.5, dw, ch * 0.5, K.dark(wc, 0.35), { line: false });
        }
      }
      for (let i = 0; i < steps; i++) {
        const ww = w + (steps - i) * sh * 2.2;
        P.rect(g, x - ww / 2, y - (i + 1) * sh, ww, sh, K.lite(c, 0.03 * i), { k: 0.08 });
      }
      const cols = [];
      for (let i = 0; i < n; i++) {
        const cx = x - w / 2 + (w / n) * (i + 0.5);
        cols.push(set.column(L, { parent: g, x: cx, y: colBase, h: ch, order, color: c, far: o.far, air: o.air }));
      }
      entablature(P, g, x - w / 2 - h * 0.02, x + w / 2 + h * 0.02, top - eh, eh, c, order === "doric", o.painted !== false);
      if (o.roof !== false) {
        const rh = h * 0.07, rc = o.roofColor || "#B9704B";
        P.path(g, `M${f1(x - w / 2 - h * 0.05)} ${f1(top - eh)}L${f1(x - w / 2 + h * 0.03)} ${f1(top - eh - rh)}L${f1(x + w / 2 - h * 0.03)} ${f1(top - eh - rh)}L${f1(x + w / 2 + h * 0.05)} ${f1(top - eh)}Z`, rc, { k: 0.12 });
        let tl = "";
        for (let tx = x - w / 2; tx < x + w / 2; tx += h * 0.045) tl += `M${f1(tx)} ${f1(top - eh - rh * 0.9)}v${f1(rh * 0.85)}`;
        P.stroke(g, tl, K.dark(rc, 0.3), Math.max(0.8, h * 0.004), { op: 0.5 });
      }
      // the roof's shadow over the colonnade floor
      P.soft(g, x, colBase - 4, w * 0.52, sh * 1.6, "#3B2E22", 0.18);
      return { g, top: [x, top - eh - h * 0.07], floor: colBase, columns: cols.map((c2) => c2.base) };
    };
    function colonnadePersp(L, o) {
      const vp = o.vp || { x: 1400, y: 470 }, near = o.near || { x: 260, y: 1000, h: 820 };
      const n = o.n ?? 8, gap = o.gap ?? 0.55, order = o.order || "doric";
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.8 });
      const c = stoneOf(o);
      const g = P.g(G(L, o, "colonnade"));
      const side = near.x < vp.x ? 1 : -1;
      const zN = 1, zF = 1 + (n - 1) * gap, zA = 0.55, zB = zF + 1.5;
      // world helpers: a point at lateral offset dx (in near-plane px) from the column line, height y (near px), depth z
      const pt = (dx, yy, z) => [vp.x + (near.x + dx - vp.x) / z, vp.y + (yy - vp.y) / z];
      const depthOff = -side * near.h * (o.depth ?? 0.42);            // the back wall sits behind the columns
      const colTop = near.y - near.h * 0.78, entH = near.h * 0.2, roofH = near.h * 0.12;
      const quad = (a0, a1, b1, b0, fill, op) => F.el("path", { d: K.poly([a0, a1, b1, b0]), fill, opacity: op }, g);
      const wc = o.wallColor || K.dark(c, 0.3);
      // floor under the portico, back wall, ceiling (soffit)
      quad(pt(depthOff, near.y, zA), pt(depthOff, near.y, zB), pt(side * near.h * 0.06, near.y, zB), pt(side * near.h * 0.06, near.y, zA), P.col(K.dark(c, 0.18)));
      quad(pt(depthOff, near.y, zA), pt(depthOff, near.y, zB), pt(depthOff, colTop, zB), pt(depthOff, colTop, zA), K.lg(L, P.col(K.dark(wc, 0.12)), P.col(K.lite(wc, 0.04)), side > 0 ? "l" : "h"));
      if (o.doors !== false) for (let i = 0; i < n - 1; i++) {
        const z0 = zN + (i + 0.3) * gap, z1 = z0 + gap * 0.35;
        quad(pt(depthOff, near.y, z0), pt(depthOff, near.y, z1), pt(depthOff, near.y - near.h * 0.42, z1), pt(depthOff, near.y - near.h * 0.42, z0), P.col(K.dark(wc, 0.35)), 0.9);
      }
      quad(pt(depthOff, colTop, zA), pt(depthOff, colTop, zB), pt(0, colTop, zB), pt(0, colTop, zA), P.col(K.dark(c, 0.42)));
      const list = [];
      for (let i = n - 1; i >= 0; i--) {
        const z = zN + i * gap, p = pt(0, near.y, z), hh = near.h / z;
        list.push(set.column(L, { parent: g, x: p[0], y: p[1], h: hh * 0.78, order, color: c, far: clamp((o.far || 0) + (z - 1) * 0.05, 0, 0.8), air: o.air, sw: 1.8 / Math.sqrt(z) }));
      }
      // entablature: architrave + frieze (with triglyphs) + cornice, receding
      const band = (y0, y1, col, k) => quad(pt(0, y0, zA), pt(0, y0, zB), pt(0, y1, zB), pt(0, y1, zA), K.lg(L, P.col(K.lite(col, k)), P.col(K.dark(col, k)), "v"));
      band(colTop - entH * 0.36, colTop, c, 0.06);
      band(colTop - entH * 0.72, colTop - entH * 0.36, K.dark(c, 0.06), 0.05);
      let tg = "";
      for (let i = 0; i < n * 2 + 2; i++) { const z = zA + i * gap / 2, t0 = pt(0, colTop - entH * 0.7, z), t1 = pt(0, colTop - entH * 0.38, z); tg += `M${f1(t0[0])} ${f1(t0[1])}L${f1(t1[0])} ${f1(t1[1])}`; }
      P.stroke(g, tg, o.painted === false ? K.dark(c, 0.3) : "#58708A", 5, { op: 0.8 });
      band(colTop - entH, colTop - entH * 0.72, K.lite(c, 0.05), 0.08);
      // roof: terracotta tiles sloping back to a ridge
      const rc = o.roofColor || "#B9704B";
      const r0 = pt(side * near.h * 0.03, colTop - entH, zA), r1 = pt(side * near.h * 0.03, colTop - entH, zB);
      const r2 = pt(depthOff * 0.8, colTop - entH - roofH, zB), r3 = pt(depthOff * 0.8, colTop - entH - roofH, zA);
      F.el("path", { d: K.poly([r0, r1, r2, r3]), fill: K.lg(L, P.col(K.lite(rc, 0.08)), P.col(K.dark(rc, 0.12)), "v") }, g);
      let tl = "";
      for (let i = 0; i < n * 6; i++) { const z = zA + i * gap / 6; if (z > zB) break; const a0 = pt(side * near.h * 0.03, colTop - entH, z), a1 = pt(depthOff * 0.8, colTop - entH - roofH, z); tl += `M${f1(a0[0])} ${f1(a0[1])}L${f1(a1[0])} ${f1(a1[1])}`; }
      P.stroke(g, tl, K.dark(rc, 0.3), 2, { op: 0.45 });
      return { g, vp, near, columns: list.map((q) => q.base) };
    }

    // a temple front: steps, columns, entablature and pediment
    set.temple = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 900, w = o.w ?? 1100, h = o.h ?? 640, n = o.n ?? 6, order = o.order || "doric";
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.8 });
      const c = stoneOf(o);
      const g = P.g(G(L, o, "temple"));
      const steps = 3, sh = h * 0.035, ch = h * 0.6, eh = h * 0.13, ph = h * 0.19;
      const colBase = y - steps * sh, top = colBase - ch;
      P.rect(g, x - w / 2 + w * 0.06, top, w * 0.88, ch, K.dark(c, 0.35), { line: false });
      P.rect(g, x - ch * 0.14, colBase - ch * 0.62, ch * 0.28, ch * 0.62, K.dark(c, 0.55), { line: false });
      for (let i = 0; i < steps; i++) { const ww = w + (steps - i) * sh * 2.4; P.rect(g, x - ww / 2, y - (i + 1) * sh, ww, sh, K.lite(c, 0.03 * i), { k: 0.08 }); }
      for (let i = 0; i < n; i++) set.column(L, { parent: g, x: x - w / 2 + (w / n) * (i + 0.5), y: colBase, h: ch, order, color: c, far: o.far, air: o.air });
      entablature(P, g, x - w / 2, x + w / 2, top - eh, eh, c, order === "doric", o.painted !== false);
      const pb = top - eh, pw = w / 2 + h * 0.03;
      P.path(g, `M${f1(x - pw)} ${f1(pb)}L${f1(x)} ${f1(pb - ph)}L${f1(x + pw)} ${f1(pb)}Z`, c, { k: 0.08 });
      P.path(g, `M${f1(x - pw * 0.86)} ${f1(pb - ph * 0.08)}L${f1(x)} ${f1(pb - ph * 0.86)}L${f1(x + pw * 0.86)} ${f1(pb - ph * 0.08)}Z`, o.painted !== false ? "#7F93A6" : K.dark(c, 0.15), { k: 0.06, sw: 1.2 });
      P.path(g, `M${f1(x - pw - h * 0.01)} ${f1(pb + 2)}L${f1(x)} ${f1(pb - ph - h * 0.02)}L${f1(x + pw + h * 0.01)} ${f1(pb + 2)}`, null, { stroke: K.lite(c, 0.1), sw: 3 });
      for (const sx of [-pw, 0, pw]) P.path(g, `M${f1(x + sx - h * 0.02)} ${f1(sx ? pb : pb - ph)}l${f1(h * 0.02)} ${f1(-h * 0.05)}l${f1(h * 0.02)} ${f1(h * 0.05)}Z`, c, { sw: 1.2 });
      return { g, top: [x, pb - ph], floor: colBase, base: [x, y] };
    };

    // an Egyptian obelisk on a plinth, two faces lit/shaded, hieroglyph hints, a gilded pyramidion
    set.obelisk = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 900, h = o.h ?? 620;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.6 });
      const c = stoneOf(o, "granite" === o.stone ? "granite" : "sandstone");
      const g = P.g(G(L, o, "obelisk"));
      const bw = h * 0.1, tw = h * 0.066, sideK = 0.32, pyr = h * 0.075, plinth = o.plinth === false ? 0 : h * 0.06;
      const yb = y - plinth, yt = y - h + pyr;
      if (plinth) {
        P.rect(g, x - bw * 1.05, yb, bw * 2.1, plinth, K.dark(c, 0.06), { k: 0.1 });
        P.poly(g, [[x - bw * 1.05, yb], [x + bw * 1.05, yb], [x + bw * 1.05 - bw * 0.2, yb - plinth * 0.25], [x - bw * 1.05 + bw * 0.1, yb - plinth * 0.25]], K.lite(c, 0.12), { k: 0.04, sw: 1 });
      }
      const L0 = x - bw / 2, R0 = x + bw / 2 - bw * sideK, L1 = x - tw / 2, R1 = x + tw / 2 - tw * sideK;
      P.poly(g, [[L0, yb], [R0, yb], [R1, yt], [L1, yt]], c, { fill: K.lg(L, P.col(K.lite(c, 0.12)), P.col(K.dark(c, 0.02)), "v") });
      P.poly(g, [[R0, yb], [x + bw / 2, yb], [x + tw / 2, yt], [R1, yt]], K.dark(c, 0.26), { k: 0.06 });
      if (o.glyphs !== false) {
        const R = K.R(o.seed ?? 5, 151);
        let d = "";
        const colX = (yy) => { const u = (yb - yy) / (yb - yt); return [lerp(L0, L1, u), lerp(R0, R1, u)]; };
        for (let yy = yt + h * 0.04; yy < yb - h * 0.04; yy += h * 0.024) {
          const [a, b] = colX(yy), cx = (a + b) / 2, ww = (b - a) * 0.36;
          const t = R();
          if (t < 0.3) d += `M${f1(cx - ww / 2)} ${f1(yy)}h${f1(ww)}v${f1(h * 0.008)}h${f1(-ww)}Z`;
          else if (t < 0.55) d += `M${f1(cx)} ${f1(yy - h * 0.006)}a${f1(ww * 0.3)} ${f1(h * 0.007)} 0 1 0 0.1 0Z`;
          else if (t < 0.8) d += `M${f1(cx - ww * 0.4)} ${f1(yy + h * 0.008)}l${f1(ww * 0.4)} ${f1(-h * 0.014)}l${f1(ww * 0.4)} ${f1(h * 0.014)}Z`;
          else d += `M${f1(cx - ww * 0.1)} ${f1(yy - h * 0.008)}h${f1(ww * 0.2)}v${f1(h * 0.018)}h${f1(-ww * 0.2)}Z`;
        }
        F.el("path", { d, fill: P.col(K.dark(c, 0.35)), opacity: 0.55 }, g);
      }
      const tip = o.tip === "stone" ? c : "#E6BE55";
      P.poly(g, [[L1, yt], [R1, yt], [x - tw * 0.1, y - h]], tip, { fill: K.lg(L, P.col(K.lite(tip, 0.25)), P.col(tip), "v"), inkOf: tip });
      P.poly(g, [[R1, yt], [x + tw / 2, yt], [x - tw * 0.1, y - h]], K.dark(tip, 0.25), { inkOf: tip });
      if (o.tip !== "stone" && o.glint !== false) set.glow(L, { parent: g, x: x - tw * 0.2, y: y - h + pyr * 0.4, r: h * 0.06, color: "#FFF1C4", a: 0.6 });
      return { g, top: [x - tw * 0.1, y - h], base: [x, y] };
    };

    // an Egyptian temple pylon: two battered towers with cavetto cornices, a gateway, flags on poles
    set.pylon = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 900, w = o.w ?? 1300, h = o.h ?? 560;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.8 });
      const c = stoneOf(o, "sandstone");
      const g = P.g(G(L, o, "pylon"));
      const tw = w * 0.4, batter = h * 0.07, gw = w * 0.2;
      // flagpoles behind
      const poles = [];
      if (o.flags !== false) for (const sx of [-1, 1]) for (const k of [0.3, 0.7]) {
        const px = x + sx * (gw / 2 + tw * k);
        P.rect(g, px - h * 0.008, y - h * 1.35, h * 0.016, h * 1.3, "#8A6A45", { sw: 1 });
        const flag = F.el("path", { d: "", fill: P.col(k < 0.5 ? "#C9533B" : "#EDE3CC"), stroke: P.ink(k < 0.5 ? "#C9533B" : "#EDE3CC"), "stroke-width": 1.2 }, g);
        poles.push({ px, py: y - h * 1.33, flag, ph: sx * 1.7 + k * 3 });
      }
      for (const sx of [-1, 1]) {
        const x0 = x + sx * gw / 2, x1 = x + sx * (gw / 2 + tw);
        const pts = [[x0, y], [x1 + sx * batter * 0.0, y], [x1 - sx * batter, y - h], [x0 + sx * batter * 0.15, y - h]];
        P.poly(g, pts, sx < 0 ? c : K.dark(c, 0.1), { fill: K.lg(L, P.col(K.lite(c, 0.1)), P.col(K.dark(c, sx < 0 ? 0.05 : 0.14)), "v") });
        // cornice
        const cy = y - h, ch = h * 0.08;
        P.poly(g, [[x0 + sx * batter * 0.1, cy + ch * 0.2], [x1 - sx * batter * 1.08, cy + ch * 0.2], [x1 - sx * batter * 0.8, cy - ch * 0.8], [x0, cy - ch * 0.8]], K.lite(c, 0.08), { k: 0.1 });
        P.stroke(g, `M${f1(x0 + sx * batter * 0.15)} ${f1(cy + ch * 0.2)}L${f1(x1 - sx * batter)} ${f1(cy + ch * 0.2)}`, K.dark(c, 0.3), h * 0.012);
        // a big relief panel and bands of glyphs
        const rx0 = lerp(x0, x1, 0.18), rx1 = lerp(x0, x1, 0.82);
        P.rect(g, Math.min(rx0, rx1), y - h * 0.8, Math.abs(rx1 - rx0), h * 0.5, K.dark(c, 0.06), { k: 0.03, sw: 1.2, op: 0.9 });
        const R = K.R((o.seed ?? 2) + sx, 157);
        let d = "";
        for (let yy = y - h * 0.76; yy < y - h * 0.34; yy += h * 0.045) for (let xx = Math.min(rx0, rx1) + h * 0.02; xx < Math.max(rx0, rx1) - h * 0.03; xx += h * 0.035) {
          if (R() < 0.35) continue;
          d += `M${f1(xx)} ${f1(yy)}h${f1(h * 0.018)}v${f1(h * (0.012 + R() * 0.018))}h${f1(-h * 0.018)}Z`;
        }
        F.el("path", { d, fill: P.col(K.dark(c, 0.3)), opacity: 0.45 }, g);
      }
      // gateway
      const gh = h * 0.72;
      P.rect(g, x - gw / 2, y - gh, gw, gh, K.lite(c, 0.04), { k: 0.1 });
      P.rect(g, x - gw * 0.3, y - gh * 0.72, gw * 0.6, gh * 0.72, "#3B2A1E", { k: 0.1 });
      P.rect(g, x - gw * 0.55, y - gh - h * 0.06, gw * 1.1, h * 0.06, K.lite(c, 0.1), { k: 0.1 });
      // winged sun disc
      P.circle(g, x, y - gh + h * 0.07, h * 0.022, "#C9533B", { sw: 1 });
      P.path(g, `M${f1(x - h * 0.03)} ${f1(y - gh + h * 0.07)}q${f1(-gw * 0.15)} ${f1(-h * 0.03)} ${f1(-gw * 0.3)} 0q${f1(gw * 0.15)} ${f1(h * 0.015)} ${f1(gw * 0.3)} 0Z M${f1(x + h * 0.03)} ${f1(y - gh + h * 0.07)}q${f1(gw * 0.15)} ${f1(-h * 0.03)} ${f1(gw * 0.3)} 0q${f1(-gw * 0.15)} ${f1(h * 0.015)} ${f1(-gw * 0.3)} 0Z`, "#3E6E8E", { sw: 1 });
      if (poles.length) S.on((t) => {
        for (const p of poles) {
          const fw = h * 0.16, fh = h * 0.07, a = Math.sin(t * 3 + p.ph) * fh * 0.25, b = Math.sin(t * 3 + p.ph + 1.4) * fh * 0.25;
          p.flag.setAttribute("d", `M${f1(p.px)} ${f1(p.py)}Q${f1(p.px + fw * 0.5)} ${f1(p.py + a)} ${f1(p.px + fw)} ${f1(p.py + b + fh * 0.2)}L${f1(p.px + fw * 0.95)} ${f1(p.py + fh * 0.5 + b)}Q${f1(p.px + fw * 0.5)} ${f1(p.py + fh + a)} ${f1(p.px)} ${f1(p.py + fh)}Z`);
        }
      });
      return { g, gate: [x, y], top: [x, y - h] };
    };

    // a flat-roofed house (mud brick, whitewashed or stone), seen at a corner (front + shaded side)
    set.house = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 163), x = o.x ?? 960, y = o.y ?? 900, w = o.w ?? 260, h = o.h ?? w * 0.75;
      const kind = o.kind || "mud";
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.6 });
      const c = o.color || (kind === "white" ? STONE.white : kind === "stone" ? "#CDBFA3" : STONE.mud);
      const g = P.g(G(L, o, "house"));
      const side = o.side ?? w * 0.32, sd = o.sideDir ?? 1;
      const fx0 = x - w / 2, fx1 = x + w / 2;
      if (o.shadow !== false) P.soft(g, x + sd * side * 0.4, y + 3, w * 0.7, h * 0.06, "#4A3A28", 0.28);
      // side face
      const sx = sd > 0 ? fx1 : fx0;
      P.poly(g, [[sx, y], [sx + sd * side, y - side * 0.28], [sx + sd * side, y - h - side * 0.28], [sx, y - h]], K.dark(c, 0.22), { k: 0.05 });
      P.rect(g, fx0, y - h, w, h, c, { fill: K.lg(L, P.col(K.lite(c, 0.08)), P.col(K.dark(c, 0.05)), "v") });
      // roof parapet + top
      P.poly(g, [[fx0, y - h], [fx1, y - h], [fx1 + sd * side, y - h - side * 0.28], [fx0 + sd * side, y - h - side * 0.28]], K.lite(c, 0.14), { k: 0.04 });
      P.rect(g, fx0 - 2, y - h - h * 0.05, w + 4, h * 0.05, K.lite(c, 0.05), { k: 0.08 });
      // beam ends
      if (kind === "mud") { let d = ""; for (let bx = fx0 + w * 0.08; bx < fx1 - w * 0.05; bx += w * 0.12) d += `M${f1(bx)} ${f1(y - h * 0.9)}a${f1(h * 0.018)} ${f1(h * 0.018)} 0 1 0 0.1 0Z`; F.el("path", { d, fill: P.col("#6B4B30") }, g); }
      // door + windows
      const dw = w * 0.2, dh = h * 0.5, dx = x + (R() - 0.5) * w * 0.4;
      P.rect(g, dx - dw / 2, y - dh, dw, dh, o.doorColor || "#6E4A30", { k: 0.12, rx: kind === "white" ? dw * 0.5 : 0 });
      const nwin = o.windows ?? 2;
      for (let i = 0; i < nwin; i++) {
        const wx = fx0 + w * (0.15 + (i / Math.max(1, nwin - 1)) * 0.62) + (R() - 0.5) * 8, wy = y - h * 0.8;
        if (Math.abs(wx - dx) < dw * 0.9) continue;
        P.rect(g, wx - w * 0.05, wy, w * 0.1, h * 0.14, "#3D2C22", { k: 0.1 });
      }
      if (o.stairs) P.poly(g, [[fx0, y], [fx0 - w * 0.25, y], [fx0, y - h * 0.9]], K.dark(c, 0.08), { k: 0.05 });
      if (o.awning) {
        P.poly(g, [[dx - dw, y - dh - 4], [dx + dw, y - dh - 4], [dx + dw * 1.2, y - dh + h * 0.08], [dx - dw * 1.2, y - dh + h * 0.08]], "#B98B4E", { k: 0.1 });
      }
      return { g, base: [x, y], top: [x, y - h], door: [dx, y] };
    };
    // a row of houses (a village or a city street far away) with palms between them
    set.village = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 167), x0 = o.x0 ?? -150, x1 = o.x1 ?? W + 150, y = o.y ?? 720, n = o.n ?? 9;
      const g = G(L, o, "village");
      const items = [];
      for (let i = 0; i < n; i++) items.push({ x: lerp(x0, x1, (i + 0.5) / n) + (R() - 0.5) * 60, y: y + (R() - 0.5) * 24, w: (o.size ?? 200) * (0.7 + 0.6 * R()), seed: (o.seed ?? 1) * 11 + i });
      items.sort((a, b) => a.y - b.y);
      for (const it of items) {
        if (o.palms !== false && R() < 0.4) set.palm(L, { parent: g, x: it.x + it.w * 0.55, y: it.y - 4, h: it.w * (1.4 + R() * 0.5), seed: it.seed, far: o.far, sway: 0.5, shadow: false });
        set.house(L, { parent: g, x: it.x, y: it.y, w: it.w, h: it.w * (0.55 + 0.4 * R()), kind: o.kind || (R() < 0.25 ? "white" : "mud"), seed: it.seed, far: o.far, air: o.air, sideDir: it.x < W / 2 ? 1 : -1, windows: 1 + Math.floor(R() * 2) });
      }
      return { g };
    };

    // a stone well. view "side": a stone drum with a wooden frame, rope and bucket;
    // view "top": looking straight down the shaft to the water, which can mirror the sun (o.sun)
    set.well = (L, o = {}) => (o.view === "top" ? wellTop(L, o) : wellSide(L, o));
    function wellSide(L, o) {
      const x = o.x ?? 960, y = o.y ?? 900, w = o.w ?? (o.h ? o.h * 0.9 : 360);
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 2 });
      const c = stoneOf(o, "limestone");
      const g = P.g(G(L, o, "well"));
      const rh = w * 0.42, ry = w * 0.13, top = y - rh;
      P.soft(g, x + w * 0.08, y + 4, w * 0.7, w * 0.08, "#3B2E22", 0.35);
      // body of the drum
      P.path(g, `M${f1(x - w / 2)} ${f1(top)}L${f1(x - w / 2)} ${f1(y)}A${f1(w / 2)} ${f1(ry)} 0 0 0 ${f1(x + w / 2)} ${f1(y)}L${f1(x + w / 2)} ${f1(top)}Z`, c, { fill: K.cyl(L, P.col(c)) });
      // stone courses following the curve
      let d = "";
      const courses = 4;
      for (let i = 1; i < courses; i++) { const yy = top + (rh * i) / courses; d += `M${f1(x - w / 2)} ${f1(yy)}A${f1(w / 2)} ${f1(ry)} 0 0 0 ${f1(x + w / 2)} ${f1(yy)}`; }
      for (let i = 0; i < courses; i++) {
        const y0 = top + (rh * i) / courses, y1 = top + (rh * (i + 1)) / courses;
        for (let k = 0; k < 7; k++) {
          const a = ((k + (i % 2) * 0.5 + 0.25) / 7) * Math.PI, u = -Math.cos(a), bx = x + u * w / 2, bump = Math.sin(a) * ry;
          d += `M${f1(bx)} ${f1(y0 + bump)}L${f1(bx)} ${f1(y1 + bump)}`;
        }
      }
      P.stroke(g, d, K.dark(c, 0.3), Math.max(1, w * 0.006), { op: 0.55 });
      // rim + opening
      P.ellipse(g, x, top, w / 2 + w * 0.03, ry + w * 0.02, K.lite(c, 0.12), { k: 0.1 });
      P.ellipse(g, x, top + 1, w * 0.4, ry * 0.72, "#2A2019", { line: false, fill: K.lg(L, P.col("#16100C"), P.col("#3B2E24"), "v") });
      // the frame: two posts, a crossbeam with a windlass, rope and bucket
      const out = { g, rim: [x, top], base: [x, y] };
      if (o.frame !== false) {
        const wood = o.wood || "#8A6440", ph = w * 1.05, pw = w * 0.06;
        for (const sx of [-1, 1]) P.rect(g, x + sx * w * 0.46 - pw / 2, top - ph, pw, ph + rh * 0.35, wood, { dir: "h", k: 0.15 });
        const by = top - ph + pw * 0.8;
        P.rect(g, x - w * 0.52, by - pw * 0.55, w * 1.04, pw * 1.1, K.lite(wood, 0.05), { rx: pw * 0.5, k: 0.2 });
        P.path(g, `M${f1(x + w * 0.52)} ${f1(by)}h${f1(w * 0.08)}v${f1(w * 0.12)}h${f1(w * 0.04)}`, null, { stroke: "#5C5046", sw: 3 });
        const ropeLen = o.bucket === "rim" ? 0 : (o.rope ?? ph * 0.55);
        const bucketY = by + ropeLen;
        P.stroke(g, `M${f1(x)} ${f1(by)}L${f1(x)} ${f1(bucketY)}`, "#B39A6E", Math.max(2, w * 0.008));
        P.stroke(g, `M${f1(x - pw * 0.6)} ${f1(by - pw * 0.4)}L${f1(x + pw * 0.6)} ${f1(by + pw * 0.4)}M${f1(x - pw * 0.6)} ${f1(by + pw * 0.4)}L${f1(x + pw * 0.6)} ${f1(by - pw * 0.4)}`, "#B39A6E", 3, { op: 0.8 });
        if (o.bucket !== false) {
          const bw = w * 0.16, bh = w * 0.15, bg = P.g(g);
          P.path(bg, `M${f1(x - bw / 2)} ${f1(bucketY + bh * 0.25)}L${f1(x - bw * 0.4)} ${f1(bucketY + bh)}L${f1(x + bw * 0.4)} ${f1(bucketY + bh)}L${f1(x + bw / 2)} ${f1(bucketY + bh * 0.25)}Z`, "#8C6A45", { fill: K.cyl(L, P.col("#8C6A45")) });
          P.stroke(bg, `M${f1(x - bw / 2)} ${f1(bucketY + bh * 0.4)}L${f1(x + bw / 2)} ${f1(bucketY + bh * 0.4)}M${f1(x - bw * 0.43)} ${f1(bucketY + bh * 0.85)}L${f1(x + bw * 0.43)} ${f1(bucketY + bh * 0.85)}`, "#5E5850", 2.5);
          P.path(bg, `M${f1(x - bw / 2)} ${f1(bucketY + bh * 0.25)}Q${f1(x)} ${f1(bucketY - bh * 0.5)} ${f1(x + bw / 2)} ${f1(bucketY + bh * 0.25)}`, null, { stroke: "#5E5850", sw: 2 });
          out.bucket = [x, bucketY + bh];
          if (o.swing !== false) K.sway(S, bg, { amp: 1.2, f: 0.25, seed: 3, ox: x, oy: by });
        }
        if (o.roof) {
          const rc = "#9A6A44";
          P.poly(g, [[x - w * 0.62, top - ph + pw * 0.2], [x, top - ph - w * 0.3], [x + w * 0.62, top - ph + pw * 0.2]], rc, { k: 0.15 });
        }
        out.beam = [x, by];
      }
      return out;
    }
    function wellTop(L, o) {
      const x = o.x ?? 960, y = o.y ?? 540, r = o.r ?? 430;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.6 });
      const c = stoneOf(o, "limestone");
      const g = P.g(G(L, o, "well-top"));
      const off = o.offset || [r * 0.06, r * 0.08];         // the bottom is a little off-centre: a natural perspective
      // ground around the rim
      if (o.ground !== false) F.el("rect", { x: -900, y: -900, width: W + 1800, height: H + 1800, "data-cover": "1", fill: P.col(o.groundColor || "#CDB185") }, g);
      if (o.ground !== false) for (let i = 0; i < 18; i++) {
        const R = K.R(o.seed ?? 3, 171 + i);
        F.el("ellipse", { cx: f1(-200 + R() * (W + 400)), cy: f1(-200 + R() * (H + 400)), rx: f1(90 + R() * 200), ry: f1(60 + R() * 140), fill: K.soft(L, P.col(R() < 0.5 ? "#DCC49A" : "#B99C6E"), 0.45) }, g);
      }
      // outer shadow ring on the ground
      F.el("circle", { cx: x + r * 0.06, cy: y + r * 0.08, r: r * 1.16, fill: K.soft(L, "#3B2E22", 0.3) }, g);
      // rim: an annulus of stone blocks
      const ro = r, ri = r * 0.78;
      F.el("circle", { cx: x, cy: y, r: ro, fill: K.urg(L, [[0, P.col(K.lite(c, 0.15))], [1, P.col(K.dark(c, 0.12))]], x - r * 0.4, y - r * 0.4, r * 2) }, g);
      let jd = "";
      const nb = o.blocks ?? 16;
      for (let i = 0; i < nb; i++) { const a = (i / nb) * Math.PI * 2 + 0.1; jd += `M${f1(x + Math.cos(a) * ri)} ${f1(y + Math.sin(a) * ri)}L${f1(x + Math.cos(a) * ro)} ${f1(y + Math.sin(a) * ro)}`; }
      F.el("path", { d: jd, stroke: P.col(K.dark(c, 0.3)), "stroke-width": 2.2, opacity: 0.6 }, g);
      F.el("circle", { cx: x, cy: y, r: ro, fill: "none", stroke: P.col(F.ink(c)), "stroke-width": 2 }, g);
      // the shaft: rings of stone getting smaller and darker toward the water
      const rings = o.rings ?? 9, rw = r * (o.water ?? 0.3);
      for (let i = 0; i <= rings; i++) {
        const u = i / rings, rr = lerp(ri, rw, Math.pow(u, 0.7)), cx = x + off[0] * u, cy = y + off[1] * u;
        const shade = F.mix(K.dark(c, 0.15 + 0.1 * u), "#1A1310", Math.pow(u, 0.8) * 0.85);
        F.el("circle", { cx: f1(cx), cy: f1(cy), r: f1(rr), fill: P.col(shade), stroke: P.col(K.dark(shade, 0.35)), "stroke-width": f1(Math.max(1, 2.4 * (1 - u))) }, g);
        if (i < rings - 1 && i % 2 === 0) {
          let dd = "";
          const nj = 14;
          for (let k = 0; k < nj; k++) { const a = ((k + (i % 4) * 0.25) / nj) * Math.PI * 2, r2 = lerp(ri, rw, Math.pow((i + 1) / rings, 0.7));
            dd += `M${f1(cx + Math.cos(a) * rr)} ${f1(cy + Math.sin(a) * rr)}L${f1(x + off[0] * (i + 1) / rings + Math.cos(a) * r2)} ${f1(y + off[1] * (i + 1) / rings + Math.sin(a) * r2)}`; }
          F.el("path", { d: dd, stroke: P.col(K.dark(shade, 0.35)), "stroke-width": 1.2, opacity: 0.5 }, g);
        }
      }
      // light falling down one side of the shaft
      F.el("path", { d: `M${f1(x - ri)} ${f1(y)}A${f1(ri)} ${f1(ri)} 0 0 1 ${f1(x + ri * 0.2)} ${f1(y - ri * 0.98)}L${f1(x + off[0] + rw * 0.2)} ${f1(y + off[1] - rw)}A${f1(rw)} ${f1(rw)} 0 0 0 ${f1(x + off[0] - rw)} ${f1(y + off[1])}Z`,
        fill: K.lg(L, "#FFE2A8", "#FFE2A8", "d", 0.18, 0), style: "mix-blend-mode:screen" }, g);
      // water
      const wx = x + off[0], wy = y + off[1];
      F.el("circle", { cx: f1(wx), cy: f1(wy), r: f1(rw), fill: K.urg(L, [[0, P.col("#3E6F7A")], [1, P.col("#16303A")]], wx, wy, rw) }, g);
      const out = { g, center: [wx, wy], rim: [x, y], r };
      if (o.sun !== false) {
        const sp = o.sun && o.sun.x != null ? [o.sun.x, o.sun.y] : [wx - rw * 0.1, wy - rw * 0.12];
        const sr = (o.sun && o.sun.r) || rw * 0.2;
        const glow = set.glow(L, { parent: g, x: sp[0], y: sp[1], r: sr * 4.2, color: "#FFF4D0", a: 0.9 });
        F.el("circle", { cx: f1(sp[0]), cy: f1(sp[1]), r: f1(sr), fill: "#FFFDF4" }, g);
        const rip = [];
        for (let i = 0; i < 3; i++) rip.push(F.el("circle", { cx: f1(sp[0]), cy: f1(sp[1]), r: f1(sr), fill: "none", stroke: "#FFF6DA", "stroke-width": 2, opacity: 0 }, g));
        const clipId = F.uid("wc"), cp = F.el("clipPath", { id: clipId }, L.defs);
        F.el("circle", { cx: f1(wx), cy: f1(wy), r: f1(rw) }, cp);
        rip.forEach((rp) => rp.setAttribute("clip-path", `url(#${clipId})`));
        S.on((t) => {
          rip.forEach((rp, i) => { const p = ((t * 0.35 + i / 3) % 1); rp.setAttribute("r", f1(sr * (1.1 + p * 3.2))); rp.setAttribute("opacity", ((1 - p) * 0.5).toFixed(3)); });
          glow.g.setAttribute("opacity", (0.9 + 0.1 * Math.sin(t * 2.3)).toFixed(3));
        });
        out.sun = sp;
      }
      return out;
    }

    // a paved floor in one-point perspective (courtyards, temple floors, halls)
    set.courtyard = (L, o = {}) => {
      const vp = o.vp || { x: 960, y: 430 }, y0 = o.y ?? 640, R = K.R(o.seed ?? 1, 173);
      const P = K.pen(L, { far: o.far, air: airOf(o), line: false });
      const c = stoneOf(o, "limestone");
      const g = P.g(G(L, o, "courtyard"));
      const yb = H + 500;
      F.el("rect", { x: -900, y: f1(y0), width: W + 1800, height: f1(yb - y0), "data-cover": "x", fill: K.ulg(L, [[0, P.col(F.mix(c, airOf(o), 0.25))], [1, P.col(K.dark(c, 0.06))]], 0, y0, 0, H) }, g);
      // rows: depth z from far (at y0) to near (at the bottom)
      const zOf = (yy) => (yy - vp.y);                   // screen distance below the horizon ∝ 1/depth
      const rowsY = [];
      let yy = y0;
      const slab = o.slab ?? 110;                      // world slab size in px at the bottom of the frame
      while (yy < yb) { rowsY.push(yy); const d = zOf(yy); yy += Math.max(3, slab * d / (H - vp.y)); }
      rowsY.push(yb);
      const colsN = o.cols ?? 44;
      const lines = [];
      for (let i = -colsN / 2; i <= colsN / 2; i++) lines.push(i);
      // slab tones
      for (let j = 0; j < rowsY.length - 1; j++) {
        const ya = rowsY[j], yb2 = rowsY[j + 1], ka = (ya - vp.y) / (H - vp.y), kb = (yb2 - vp.y) / (H - vp.y);
        const shift = (j % 2) * 0.5;
        for (let i = -colsN / 2; i < colsN / 2; i++) {
          if (R() < 0.55) continue;
          const xa0 = vp.x + (i + shift) * slab * ka, xa1 = vp.x + (i + 1 + shift) * slab * ka;
          const xb0 = vp.x + (i + shift) * slab * kb, xb1 = vp.x + (i + 1 + shift) * slab * kb;
          const tone = R() < 0.5 ? K.lite(c, 0.06 + R() * 0.06) : K.dark(c, 0.04 + R() * 0.06);
          F.el("path", { d: K.poly([[xa0, ya], [xa1, ya], [xb1, yb2], [xb0, yb2]]), fill: P.col(tone) }, g);
        }
      }
      let d = "";
      for (let j = 0; j < rowsY.length; j++) d += `M-900 ${f1(rowsY[j])}H${W + 900}`;
      for (let j = 0; j < rowsY.length - 1; j++) {
        const ya = rowsY[j], yb2 = rowsY[j + 1], ka = (ya - vp.y) / (H - vp.y), kb = (yb2 - vp.y) / (H - vp.y), shift = (j % 2) * 0.5;
        for (let i = -colsN / 2; i <= colsN / 2; i++) d += `M${f1(vp.x + (i + shift) * slab * ka)} ${f1(ya)}L${f1(vp.x + (i + shift) * slab * kb)} ${f1(yb2)}`;
      }
      F.el("path", { d, stroke: P.col(K.dark(c, 0.25)), "stroke-width": 1.6, opacity: 0.45, fill: "none" }, g);
      if (o.haze !== false) set.haze(L, { parent: g, kind: "up", y: y0 + 40, h: 40, below: 50, color: airOf(o), a: 0.25, fade: 0 });
      return { g, vp, y: y0, at: (X, yy) => [vp.x + X * (yy - vp.y) / (H - vp.y), yy] };
    };

    // the Pharos of Alexandria (three tiers, fire on top) — or kind "modern" (a striped tower)
    set.lighthouse = (L, o = {}) => {
      const x = o.x ?? 1400, y = o.y ?? 700, h = o.h ?? 560, kind = o.kind || "pharos";
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.5 });
      const c = stoneOf(o, "limestone");
      const g = P.g(G(L, o, "lighthouse"));
      let fireY;
      if (kind === "modern") {
        const bw = h * 0.16, tw = h * 0.1, th = h * 0.82;
        P.poly(g, [[x - bw / 2, y], [x + bw / 2, y], [x + tw / 2, y - th], [x - tw / 2, y - th]], "#F2EEE6", { fill: K.cyl(L, P.col("#F2EEE6")) });
        for (let i = 0; i < 3; i++) { const u0 = (i * 2 + 1) / 7, u1 = (i * 2 + 2) / 7; P.poly(g, [[x - lerp(bw, tw, u0) / 2, y - th * u0], [x + lerp(bw, tw, u0) / 2, y - th * u0], [x + lerp(bw, tw, u1) / 2, y - th * u1], [x - lerp(bw, tw, u1) / 2, y - th * u1]], "#C4473A", { fill: K.cyl(L, P.col("#C4473A")) }); }
        P.rect(g, x - tw * 0.75, y - th - h * 0.02, tw * 1.5, h * 0.025, "#3C3F44", {});
        P.rect(g, x - tw * 0.4, y - th - h * 0.1, tw * 0.8, h * 0.08, "#FFF3C8", {});
        P.path(g, `M${f1(x - tw * 0.5)} ${f1(y - th - h * 0.1)}Q${f1(x)} ${f1(y - th - h * 0.17)} ${f1(x + tw * 0.5)} ${f1(y - th - h * 0.1)}Z`, "#3C3F44", {});
        fireY = y - th - h * 0.06;
      } else {
        const b = { w: h * 0.25, h: h * 0.5 }, m = { w: h * 0.16, h: h * 0.24 }, t = { w: h * 0.1, h: h * 0.13 };
        P.rect(g, x - b.w * 0.85, y - h * 0.03, b.w * 1.7, h * 0.03, K.dark(c, 0.05), { k: 0.1 });
        const tier = (w0, w1, y0, hh, faces) => {
          const yb = y0, yt = y0 - hh;
          if (faces === 2) {
            P.poly(g, [[x - w0 / 2, yb], [x + w0 * 0.18, yb], [x + w1 * 0.18, yt], [x - w1 / 2, yt]], c, { fill: K.lg(L, P.col(K.lite(c, 0.1)), P.col(c), "v") });
            P.poly(g, [[x + w0 * 0.18, yb], [x + w0 / 2, yb], [x + w1 / 2, yt], [x + w1 * 0.18, yt]], K.dark(c, 0.25), { k: 0.05 });
          } else {
            P.poly(g, [[x - w0 / 2, yb], [x + w0 / 2, yb], [x + w1 / 2, yt], [x - w1 / 2, yt]], c, { fill: K.cyl(L, P.col(c)) });
            P.stroke(g, `M${f1(x - w0 * 0.2)} ${f1(yb)}L${f1(x - w1 * 0.2)} ${f1(yt)}M${f1(x + w0 * 0.2)} ${f1(yb)}L${f1(x + w1 * 0.2)} ${f1(yt)}`, K.dark(c, 0.2), 1.5, { op: 0.6 });
          }
          P.rect(g, x - w1 * 0.62, yt - hh * 0.05, w1 * 1.24, hh * 0.06, K.lite(c, 0.08), { k: 0.1 });
          return yt - hh * 0.05;
        };
        let yy = y - h * 0.03;
        yy = tier(b.w, b.w * 0.86, yy, b.h, 2);
        // windows on the base tier
        let wd = "";
        for (let i = 0; i < 5; i++) for (let k = 0; k < 2; k++) wd += `M${f1(x - b.w * 0.34 + k * b.w * 0.22)} ${f1(y - h * 0.1 - i * b.h * 0.18)}h${f1(b.w * 0.05)}v${f1(b.h * 0.07)}h${f1(-b.w * 0.05)}Z`;
        F.el("path", { d: wd, fill: P.col("#3E3024"), opacity: 0.7 }, g);
        yy = tier(m.w, m.w * 0.9, yy, m.h, 2);
        yy = tier(t.w, t.w * 0.95, yy, t.h, 1);
        // the lantern: columns around the fire, a small dome and a statue
        const lh = h * 0.06;
        P.rect(g, x - t.w * 0.45, yy - lh, t.w * 0.9, lh, "#3A2A20", { line: false });
        for (let i = 0; i < 4; i++) P.rect(g, x - t.w * 0.45 + i * t.w * 0.28, yy - lh, t.w * 0.07, lh, c, { sw: 1 });
        P.path(g, `M${f1(x - t.w * 0.55)} ${f1(yy - lh)}Q${f1(x)} ${f1(yy - lh - h * 0.05)} ${f1(x + t.w * 0.55)} ${f1(yy - lh)}Z`, c, { k: 0.15 });
        P.rect(g, x - h * 0.004, yy - lh - h * 0.09, h * 0.008, h * 0.05, "#C9A447", { sw: 1 });
        P.circle(g, x, yy - lh - h * 0.095, h * 0.008, "#C9A447", { sw: 1 });
        fireY = yy - lh * 0.5;
      }
      const out = { g, top: [x, y - h], fire: [x, fireY], base: [x, y] };
      if (o.fire !== false) {
        const gl = set.glow(L, { parent: g, x, y: fireY, r: h * (o.glow ?? 0.18), color: "#FFD27A", a: 0.95, flicker: 0.25 });
        P.circle(g, x, fireY, h * 0.012, "#FFF4D6", { line: false });
        out.glow = gl;
      }
      return out;
    };

    // a harbour seen from the shore: sea, a curving breakwater, a white city, ships, the Pharos
    set.harbour = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 181), y = o.y ?? 560, far = o.far || 0, air = airOf(o);
      const g = G(L, o, "harbour");
      set.sea(L, { parent: g, y, shore: H + 200, seed: o.seed, far, air, foam: false, waves: 90 });
      // the far shore with a white city
      if (o.city !== false) {
        const cy = y + 4;
        const cg = F.el("g", null, g);
        for (let i = 0; i < 40; i++) {
          const bx = W * 0.45 + i * 38 + R() * 20, bw = 30 + R() * 40, bh = 16 + R() * 34;
          F.el("rect", { x: f1(bx), y: f1(cy - bh), width: f1(bw), height: f1(bh + 6), fill: K.air(R() < 0.7 ? "#F1EBDD" : "#E2D4B8", 0.35 + far, air) }, cg);
          if (R() < 0.3) F.el("rect", { x: f1(bx + bw * 0.6), y: f1(cy - bh), width: f1(bw * 0.4), height: f1(bh + 6), fill: K.air("#C9B998", 0.4 + far, air) }, cg);
        }
        F.el("rect", { x: f1(W * 0.42), y: f1(cy), width: f1(W * 0.9), height: 8, fill: K.air("#CDBB93", 0.3 + far, air) }, cg);
        for (let i = 0; i < 5; i++) set.palm(L, { parent: cg, x: W * 0.5 + R() * W * 0.5, y: cy + 4, h: 70 + R() * 40, seed: 40 + i, far: 0.45 + far, sway: 0.4, shadow: false });
      }
      // breakwater from the left
      if (o.mole !== false) {
        const mc = K.air("#CDBFA3", far + 0.1, air);
        F.el("path", { d: `M-300 ${f1(y + 190)}Q${f1(W * 0.25)} ${f1(y + 60)} ${f1(W * 0.52)} ${f1(y + 36)}L${f1(W * 0.52)} ${f1(y + 50)}Q${f1(W * 0.25)} ${f1(y + 84)} -300 ${f1(y + 240)}Z`, fill: K.lg(L, mc, K.dark(mc, 0.15), "v") }, g);
      }
      const out = { g, horizon: y };
      if (o.lighthouse !== false) out.lighthouse = set.lighthouse(L, { parent: g, x: o.lx ?? W * 0.52, y: y + 42, h: o.lh ?? 300, far: far + 0.12, air });
      if ((o.ships ?? 3) > 0) {
        const ships = [];
        for (let i = 0; i < (o.ships ?? 3); i++) {
          const sx = 200 + R() * (W - 400), sy = y + 30 + R() * 120, s = 0.18 + (sy - y) / 400;
          if (S.prop && S.prop.ship) ships.push(S.prop.ship(L, { parent: g, x: sx, y: sy, s, kind: R() < 0.5 ? "galley" : "merchant", far: 0.35 + far, seed: i + 3, water: true }));
        }
        out.ships = ships;
      }
      return out;
    };

    // ══════════════════════════════════════════════════════════════════════════════
    //  1850–1950: STREETS
    // ══════════════════════════════════════════════════════════════════════════════
    const glassFill = (L, c = "#5C7FA6") => K.lgs(L, [[0, K.lite(c, 0.35)], [0.45, c], [1, K.dark(c, 0.3)]], "d");
    // diagonal reflection streaks over a glass rect
    function glassStreaks(g, x, y, w, h, a = 0.35) {
      const d = `M${f1(x + w * 0.15)} ${f1(y + h)}L${f1(x + w * 0.55)} ${f1(y)}L${f1(x + w * 0.72)} ${f1(y)}L${f1(x + w * 0.32)} ${f1(y + h)}Z` +
        `M${f1(x + w * 0.45)} ${f1(y + h)}L${f1(x + w * 0.85)} ${f1(y)}L${f1(x + w * 0.9)} ${f1(y)}L${f1(x + w * 0.5)} ${f1(y + h)}Z`;
      F.el("path", { d, fill: "#FFFFFF", opacity: a }, g);
    }

    // a brick storefront, c. 1900 (two storeys, arched windows, a painted shopfront with a sign and an awning)
    set.storefront = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 960, w = o.w ?? 1300, h = o.h ?? 900;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.8 });
      const brick = o.color || "#B65E45", trim = o.trim || "#2F5B45", cream = "#EDE3CC";
      const g = P.g(G(L, o, "storefront"));
      const x0 = x - w / 2, x1 = x + w / 2, top = y - h, shopH = h * 0.4;
      P.rect(g, x0, top, w, h - shopH, brick, { k: 0.05 });
      // faint brick courses
      let bd = "";
      for (let yy = top + 30; yy < y - shopH; yy += h * 0.028) bd += `M${f1(x0)} ${f1(yy)}H${f1(x1)}`;
      P.stroke(g, bd, K.dark(brick, 0.15), 1, { op: 0.35 });
      // cornice with dentils
      P.rect(g, x0 - w * 0.015, top - h * 0.02, w * 1.03, h * 0.05, K.dark(brick, 0.25), { k: 0.1 });
      let dd = "";
      for (let xx = x0; xx < x1; xx += w * 0.018) dd += `M${f1(xx)} ${f1(top + h * 0.035)}h${f1(w * 0.009)}v${f1(h * 0.018)}h${f1(-w * 0.009)}Z`;
      F.el("path", { d: dd, fill: P.col(K.dark(brick, 0.3)) }, g);
      // upper windows
      const nw = o.windows ?? 3, ww = w * 0.1, wh = h * 0.22, wy = top + h * 0.13;
      for (let i = 0; i < nw; i++) {
        const cx = x0 + w * (i + 0.5) / nw;
        const arch = `M${f1(cx - ww / 2)} ${f1(wy + wh)}V${f1(wy + ww / 2)}A${f1(ww / 2)} ${f1(ww / 2)} 0 0 1 ${f1(cx + ww / 2)} ${f1(wy + ww / 2)}V${f1(wy + wh)}Z`;
        P.path(g, `M${f1(cx - ww / 2 - 8)} ${f1(wy + wh)}V${f1(wy + ww / 2)}A${f1(ww / 2 + 8)} ${f1(ww / 2 + 8)} 0 0 1 ${f1(cx + ww / 2 + 8)} ${f1(wy + ww / 2)}V${f1(wy + wh)}Z`, K.dark(brick, 0.2), { k: 0.05, sw: 1 });
        P.path(g, arch, cream, { k: 0.05 });
        P.path(g, `M${f1(cx - ww / 2 + 7)} ${f1(wy + wh - 6)}V${f1(wy + ww / 2)}A${f1(ww / 2 - 7)} ${f1(ww / 2 - 7)} 0 0 1 ${f1(cx + ww / 2 - 7)} ${f1(wy + ww / 2)}V${f1(wy + wh - 6)}Z`, "#5C7FA6", { fill: glassFill(L, P.col("#5E80A6")), sw: 1 });
        glassStreaks(g, cx - ww / 2 + 7, wy + 8, ww - 14, wh - 14, 0.28);
        P.rect(g, cx - ww / 2 + 4, wy + wh * 0.55, ww - 8, 6, cream, { sw: 1 });
        P.rect(g, cx - 3, wy + 4, 6, wh - 8, cream, { sw: 1 });
        P.rect(g, cx - ww / 2 - 12, wy + wh, ww + 24, h * 0.018, K.lite(cream, 0.05), { k: 0.1 });
      }
      // shopfront
      const sy = y - shopH;
      P.rect(g, x0 + w * 0.03, sy, w * 0.94, shopH * 0.2, trim, { k: 0.1 });
      P.rect(g, x0 + w * 0.05, sy + shopH * 0.03, w * 0.9, shopH * 0.14, "none", { stroke: "#C9A652", sw: 1.5 });
      if (o.sign !== false) {
        const t = F.el("text", { x: f1(x - w * 0.08), y: f1(sy + shopH * 0.145), "text-anchor": "middle", "font-family": "EB Garamond, Georgia, serif",
          "font-size": f1(shopH * 0.12), fill: P.col("#E3C160"), "letter-spacing": f1(shopH * 0.01), text: o.sign || "GENERAL STORE" }, g);
        void t;
      }
      // awning: stripes
      const ay = sy + shopH * 0.2, ah = shopH * 0.09;
      const nst = 26;
      for (let i = 0; i < nst; i++) {
        const ax0 = x0 + w * 0.03 + (w * 0.94 * i) / nst, aw = (w * 0.94) / nst;
        P.path(g, `M${f1(ax0)} ${f1(ay)}h${f1(aw)}l${f1(aw * 0.08)} ${f1(ah)}h${f1(-aw)}Z`, i % 2 ? cream : "#3F7A58", { line: false, k: 0.1 });
      }
      P.stroke(g, `M${f1(x0 + w * 0.03)} ${f1(ay + ah)}H${f1(x0 + w * 0.97)}`, K.dark("#3F7A58", 0.3), 2);
      // display window + door
      const dwx0 = x0 + w * 0.08, dwx1 = x0 + w * 0.66, dwy0 = ay + ah + shopH * 0.05, dwy1 = y - shopH * 0.12;
      P.rect(g, dwx0 - 8, dwy0 - 8, dwx1 - dwx0 + 16, dwy1 - dwy0 + 16, trim, { k: 0.1 });
      P.rect(g, dwx0, dwy0, dwx1 - dwx0, dwy1 - dwy0, "#7E8F96", { fill: K.lgs(L, [[0, P.col("#A9B7BC")], [0.5, P.col("#7F8E95")], [1, P.col("#5E6A70")]], "v") });
      P.soft(g, (dwx0 + dwx1) / 2, dwy1 - (dwy1 - dwy0) * 0.3, (dwx1 - dwx0) * 0.4, (dwy1 - dwy0) * 0.35, "#F2E3C0", 0.35);
      glassStreaks(g, dwx0, dwy0, dwx1 - dwx0, dwy1 - dwy0, 0.22);
      P.rect(g, dwx0, dwy1, dwx1 - dwx0, shopH * 0.12, trim, { k: 0.12 });
      for (let i = 0; i < 4; i++) P.rect(g, dwx0 + 10 + i * (dwx1 - dwx0 - 20) / 4, dwy1 + 10, (dwx1 - dwx0 - 20) / 4 - 10, shopH * 0.12 - 20, "none", { stroke: "#C9A652", sw: 1.2 });
      const dx0 = x0 + w * 0.72, dx1 = x0 + w * 0.86;
      P.rect(g, dx0 - 8, dwy0 - 8, dx1 - dx0 + 16, y - dwy0 + 8, trim, { k: 0.1 });
      P.rect(g, dx0, dwy0 + (y - dwy0) * 0.12, dx1 - dx0, (y - dwy0) * 0.88, K.dark(trim, 0.05), { k: 0.12 });
      P.rect(g, dx0 + 12, dwy0 + (y - dwy0) * 0.17, dx1 - dx0 - 24, (y - dwy0) * 0.38, "#7F8E95", { fill: K.lg(L, P.col("#A9B7BC"), P.col("#66747A"), "v") });
      P.rect(g, dx0 + 12, dwy0 + (y - dwy0) * 0.62, dx1 - dx0 - 24, (y - dwy0) * 0.3, "none", { stroke: "#C9A652", sw: 1.2 });
      P.circle(g, dx0 + (dx1 - dx0) * 0.15, dwy0 + (y - dwy0) * 0.6, 4, "#D7B560", { sw: 1 });
      if (o.number !== false) F.el("text", { x: f1((dx0 + dx1) / 2), y: f1(dwy0 + (y - dwy0) * 0.09), "text-anchor": "middle", "font-family": "EB Garamond, Georgia, serif", "font-size": f1(shopH * 0.06), fill: P.col("#E3C160"), text: String(o.number ?? 1127) }, g);
      for (const px of [x0 + w * 0.03, x0 + w * 0.69, x0 + w * 0.94]) P.rect(g, px, ay, w * 0.03, y - ay, trim, { dir: "h", k: 0.15 });
      P.rect(g, x0, y - 6, w, 12, "#CFC6B6", { k: 0.1 });
      return { g, door: [(dx0 + dx1) / 2, y], window: [(dwx0 + dwx1) / 2, (dwy0 + dwy1) / 2, dwx1 - dwx0, dwy1 - dwy0], sign: [x - w * 0.08, sy + shopH * 0.1], top: [x, top] };
    };

    // a telegraph pole with crossarms and insulators (h = screen height)
    set.pole = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 900, h = o.h ?? 700, arms = o.arms ?? 2;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.4 });
      const g = P.g(G(L, o, "pole"));
      const wood = o.color || "#6E5846", pw = Math.max(1.5, h * 0.018);
      P.path(g, `M${f1(x - pw * 0.65)} ${f1(y)}L${f1(x - pw * 0.45)} ${f1(y - h)}L${f1(x + pw * 0.45)} ${f1(y - h)}L${f1(x + pw * 0.65)} ${f1(y)}Z`, wood, { dir: "h", k: 0.18, line: h > 200 });
      const ends = [];
      for (let i = 0; i < arms; i++) {
        const ay = y - h * (0.93 - i * 0.09), aw = h * (0.2 - i * 0.03);
        P.rect(g, x - aw / 2, ay - pw * 0.35, aw, pw * 0.7, wood, { k: 0.15, line: h > 200 });
        for (let k = 0; k < 4; k++) {
          const ix = x - aw / 2 + aw * (0.08 + 0.84 * k / 3);
          if (h > 120) P.rect(g, ix - pw * 0.18, ay - pw * 0.9, pw * 0.36, pw * 0.6, "#7FA0A0", { line: false });
          ends.push([ix, ay - pw * 0.6]);
        }
      }
      return { g, base: [x, y], top: [x, y - h], wires: ends };
    };

    // a street lamp post, c. 1900: a cast-iron post with a glass lantern (lit: a warm glow)
    set.lampPost = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 900, h = o.h ?? 520;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.4 });
      const g = P.g(G(L, o, "lamppost"));
      const c = o.color || "#2F3A36", pw = h * 0.028;
      P.rect(g, x - pw * 1.3, y - h * 0.08, pw * 2.6, h * 0.08, c, { dir: "h", k: 0.2, rx: pw * 0.3 });
      P.path(g, `M${f1(x - pw * 0.7)} ${f1(y - h * 0.08)}L${f1(x - pw * 0.4)} ${f1(y - h * 0.82)}L${f1(x + pw * 0.4)} ${f1(y - h * 0.82)}L${f1(x + pw * 0.7)} ${f1(y - h * 0.08)}Z`, c, { dir: "h", k: 0.2 });
      P.rect(g, x - pw * 1.1, y - h * 0.84, pw * 2.2, h * 0.025, c, { k: 0.2 });
      const lw = h * 0.11, lt = y - h * 0.98, lb = y - h * 0.84;
      const lit = o.lit ?? false;
      P.poly(g, [[x - lw * 0.38, lb], [x + lw * 0.38, lb], [x + lw * 0.5, lt + h * 0.02], [x - lw * 0.5, lt + h * 0.02]], lit ? "#FFE3A2" : "#C9D6D8", { fill: lit ? P.col("#FFE9B0") : K.lg(L, P.col("#DDE7E8"), P.col("#9FB2B6"), "d"), stroke: c });
      P.stroke(g, `M${f1(x)} ${f1(lb)}L${f1(x)} ${f1(lt + h * 0.02)}`, c, Math.max(1, pw * 0.25));
      P.path(g, `M${f1(x - lw * 0.62)} ${f1(lt + h * 0.02)}L${f1(x)} ${f1(lt - h * 0.03)}L${f1(x + lw * 0.62)} ${f1(lt + h * 0.02)}Z`, c, { k: 0.2 });
      P.circle(g, x, lt - h * 0.035, pw * 0.5, c, {});
      const out = { g, base: [x, y], light: [x, (lt + lb) / 2] };
      if (lit) out.glow = set.glow(L, { parent: g, x, y: (lt + lb) / 2, r: h * 0.35, color: "#FFD9A0", a: 0.75, flicker: o.flicker ?? 0.08 });
      return out;
    };

    // a street c. 1900 in one-point perspective: shopfronts on the left, trees, poles and wires, lamp posts,
    // houses behind a fence on the right, a hazy sun at the vanishing point. (Sky not included.)
    set.street = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 191), vp = o.vp || { x: 1180, y: 520 }, f = o.f ?? 900, hc = o.eye ?? 1.7;
      const air = o.air || "#F3E6CE", far0 = o.far || 0;
      const g = G(L, o, "street");
      const pr = (X, Y, Z) => [vp.x + (X * f) / Z, vp.y + ((hc - Y) * f) / Z];
      const fog = (Z) => clamp(far0 + (1 - Math.exp(-Z / (o.fog ?? 55))) * 0.92, 0, 0.96);
      const col = (c, Z) => K.air(c, fog(Z), air);
      const zN = 1.2, zF = 400;
      const xL = o.left === false ? null : -8, xR = 7, curbL = -4.2, curbR = 5.2;
      // ground: road + sidewalks
      const gp = (X, Z) => pr(X, 0, Z);
      F.el("rect", { x: -900, y: f1(vp.y - 2), width: W + 1800, height: H + 900, "data-cover": "x", fill: K.ulg(L, [[0, air], [0.12, col(o.road || "#D8B894", 30)], [1, o.road || "#CFAE88"]], 0, vp.y, 0, H) }, g);
      const quad = (x0, x1, c, zA = zN, zB = zF) => F.el("path", { d: K.poly([gp(x0, zA), gp(x1, zA), gp(x1, zB), gp(x0, zB)]), fill: K.ulg(L, [[0, air], [0.15, col(c, 25)], [1, c]], 0, vp.y, 0, H) }, g);
      if (xL != null) quad(xL, curbL, o.walk || "#B58B78");
      quad(curbR, xR + 3, o.walk2 || "#CDB9A0");
      // paving lines on the left sidewalk, ruts/rails on the road
      let pd = "";
      if (xL != null) for (let Z = zN; Z < 90; Z *= 1.12) { const a = gp(xL, Z), b = gp(curbL, Z); pd += `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`; }
      F.el("path", { d: pd, stroke: col("#8E6A5C", 10), "stroke-width": 1.5, opacity: 0.5 }, g);
      let rd = "";
      for (const X of o.rails === false ? [-1.4, 1.9] : [-1.2, 0.2, 2.0, 3.4]) { const a = gp(X, zN), b = gp(X, zF); rd += `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`; }
      F.el("path", { d: rd, stroke: "#9A7F62", "stroke-width": 3, opacity: 0.45 }, g);
      // curbs
      for (const X of xL != null ? [curbL, curbR] : [curbR]) {
        const a = pr(X, 0.15, zN), b = pr(X, 0.15, zF), c = gp(X, zF), d = gp(X, zN);
        F.el("path", { d: K.poly([a, b, c, d]), fill: "#BFB3A2" }, g);
      }
      // the far glow at the vanishing point
      F.el("ellipse", { cx: vp.x, cy: vp.y - 20, rx: 900, ry: 420, fill: K.soft(L, "#FFF3DA", 0.8, "glow") }, g);
      // objects, sorted far → near
      const items = [];
      // left: building blocks with shopfronts
      if (xL != null) {
        let Z = zN * 0.8;
        while (Z < 160) {
          const len = 9 + R() * 12, hgt = 9 + R() * 8, c = K.pick(R, o.bricks || ["#8E5A55", "#9B6250", "#7F5C66", "#A36A55", "#8B6B5A"]);
          items.push({ Z: Z + len, draw: blockL.bind(null, Z, Z + len, hgt, c) });
          Z += len;
        }
      }
      // right: trees, poles, lamp posts, houses
      if (o.right !== false) {
        for (let Z = 4; Z < 160; Z += 11 + R() * 5) items.push({ Z, draw: houseR.bind(null, Z, 7 + R() * 3, R()) });
        if (o.trees !== false) for (let Z = 6; Z < 150; Z += 9 + R() * 6) items.push({ Z: Z - 0.5, draw: treeR.bind(null, Z, R()) });
        if (o.fence !== false) items.push({ Z: 150, draw: fenceR });
      }
      const poles = [];
      if (o.poles !== false) for (let Z = 5; Z < 200; Z += 24) poles.push(Z);
      poles.forEach((Z) => items.push({ Z: Z - 0.1, draw: poleR.bind(null, Z) }));
      if (o.lamps !== false) for (let Z = 9; Z < 160; Z += 26) { items.push({ Z, draw: lampR.bind(null, curbR + 0.6, Z) }); if (xL != null) items.push({ Z: Z + 13, draw: lampR.bind(null, curbL - 0.5, Z + 13) }); }
      items.sort((a, b) => b.Z - a.Z);
      for (const it of items) it.draw();
      // wires between poles (over everything but the nearest pole)
      if (o.poles !== false) {
        let wd = "";
        const arm = (Z, k) => pr(curbR + 1.1 + (k - 1.5) * 0.55, 8.2 - (k > 3 ? 0.9 : 0), Z);
        for (let i = 0; i < poles.length - 1; i++) for (let k = 0; k < 4; k++) {
          const a = arm(poles[i], k), b = arm(poles[i + 1], k), m = pr(curbR + 1.1 + (k - 1.5) * 0.55, 7.7, (poles[i] + poles[i + 1]) / 2);
          wd += `M${f1(a[0])} ${f1(a[1])}Q${f1(2 * m[0] - (a[0] + b[0]) / 2)} ${f1(2 * m[1] - (a[1] + b[1]) / 2)} ${f1(b[0])} ${f1(b[1])}`;
        }
        const a0 = arm(poles[0], 0);
        wd += `M${f1(a0[0])} ${f1(a0[1])}Q${f1(a0[0] + 300)} ${f1(a0[1] - 40)} ${f1(W + 300)} ${f1(a0[1] - 150)}`;
        F.el("path", { d: wd, fill: "none", stroke: "#4E4540", "stroke-width": 1.4, opacity: 0.75 }, g);
      }
      if (o.haze !== false) F.el("ellipse", { cx: vp.x, cy: vp.y + 10, rx: 520, ry: 260, fill: K.soft(L, air, 0.7, "glow") }, g);
      return { g, vp, ground: (X, Z) => gp(X, Z), pr, scale: (Z) => f / Z };

      function blockL(z0, z1, hgt, c) {
        const Zm = (z0 + z1) / 2, cc = col(c, Zm);
        const A = pr(xL, 0, z0), B = pr(xL, 0, z1), C = pr(xL, hgt, z1), D = pr(xL, hgt, z0);
        F.el("path", { d: K.poly([A, B, C, D]), fill: K.lg(L, K.lite(cc, 0.05), K.dark(cc, 0.1), "v"), stroke: col(F.ink(c), Zm), "stroke-width": 1 }, g);
        // shop window band at street level
        const sw0 = pr(xL, 0.5, z0 + 0.6), sw1 = pr(xL, 0.5, z1 - 0.6), sw2 = pr(xL, 3.2, z1 - 0.6), sw3 = pr(xL, 3.2, z0 + 0.6);
        const glass = col("#4E5E86", Zm);
        F.el("path", { d: K.poly([sw0, sw1, sw2, sw3]), fill: K.lgs(L, [[0, K.lite(glass, 0.35)], [0.5, glass], [1, K.dark(glass, 0.2)]], "l") }, g);
        const st0 = pr(xL, 0.6, z0 + 1.2), st1 = pr(xL, 3.1, z0 + 2.4), st2 = pr(xL, 3.1, z0 + 3.2), st3 = pr(xL, 0.6, z0 + 2.0);
        F.el("path", { d: K.poly([st0, st1, st2, st3]), fill: "#FFFFFF", opacity: 0.18 }, g);
        // awning
        const aw0 = pr(xL, 3.5, z0 + 0.3), aw1 = pr(xL, 3.5, z1 - 0.3), aw2 = pr(xL + 1.3, 3.0, z1 - 0.3), aw3 = pr(xL + 1.3, 3.0, z0 + 0.3);
        F.el("path", { d: K.poly([aw0, aw1, aw2, aw3]), fill: col(K.dark(c, 0.35), Zm) }, g);
        // sign band
        const sb0 = pr(xL, 3.6, z0 + 0.4), sb1 = pr(xL, 3.6, z1 - 0.4), sb2 = pr(xL, 4.3, z1 - 0.4), sb3 = pr(xL, 4.3, z0 + 0.4);
        F.el("path", { d: K.poly([sb0, sb1, sb2, sb3]), fill: col(R() < 0.5 ? "#2F4F3E" : "#3B3448", Zm) }, g);
        // upper windows
        const rows = Math.floor((hgt - 5) / 3);
        const cols2 = Math.max(1, Math.floor((z1 - z0) / 3));
        let wdd = "";
        for (let r = 0; r < rows; r++) for (let k = 0; k < cols2; k++) {
          const za = z0 + (k + 0.3) * (z1 - z0) / cols2, zb = za + (z1 - z0) / cols2 * 0.45, ya = 5.2 + r * 3, yb = ya + 1.9;
          wdd += `M${f1(pr(xL, ya, za)[0])} ${f1(pr(xL, ya, za)[1])}L${f1(pr(xL, ya, zb)[0])} ${f1(pr(xL, ya, zb)[1])}L${f1(pr(xL, yb, zb)[0])} ${f1(pr(xL, yb, zb)[1])}L${f1(pr(xL, yb, za)[0])} ${f1(pr(xL, yb, za)[1])}Z`;
        }
        F.el("path", { d: wdd, fill: col("#5D6E93", Zm), stroke: col("#E9DFCC", Zm), "stroke-width": f1(Math.max(1, 90 / Zm)) }, g);
        // cornice
        const co0 = pr(xL, hgt, z0), co1 = pr(xL, hgt, z1), co2 = pr(xL + 0.6, hgt - 0.4, z1), co3 = pr(xL + 0.6, hgt - 0.4, z0);
        F.el("path", { d: K.poly([co0, co1, co2, co3]), fill: col(K.dark(c, 0.4), Zm) }, g);
      }
      function houseR(Z, setback, r) {
        const X0 = xR + setback, w = 7 + r * 4, hgt = 6 + r * 3;
        const c = col(r < 0.6 ? "#F1EEE6" : "#E8DCC8", Z), side = col(r < 0.6 ? "#CFCBC4" : "#C9B9A1", Z);
        // front (facing the street, i.e. the plane X = X0) from Z to Z + w
        const A = pr(X0, 0, Z), B = pr(X0, 0, Z + w), C = pr(X0, hgt, Z + w), D = pr(X0, hgt, Z);
        F.el("path", { d: K.poly([A, B, C, D]), fill: side }, g);
        // gable roof
        const E = pr(X0, hgt + 2.4, Z + w / 2);
        F.el("path", { d: K.poly([D, C, E]), fill: col("#9C8F86", Z) }, g);
        // windows
        let wdd = "";
        for (let k = 0; k < 2; k++) for (let r2 = 0; r2 < 2; r2++) {
          const za = Z + 1 + k * (w - 3) / 1.3, zb = za + 1.2, ya = 1.2 + r2 * 2.8, yb = ya + 1.7;
          const p = [pr(X0, ya, za), pr(X0, ya, zb), pr(X0, yb, zb), pr(X0, yb, za)];
          wdd += K.poly(p);
        }
        F.el("path", { d: wdd, fill: col("#7E95B8", Z) }, g);
        // clapboard lines
        let cl = "";
        for (let yy = 0.5; yy < hgt; yy += 0.5) { const a = pr(X0, yy, Z), b = pr(X0, yy, Z + w); cl += `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`; }
        F.el("path", { d: cl, stroke: col("#BDB7AE", Z), "stroke-width": 0.8, opacity: 0.6 }, g);
      }
      function treeR(Z, r) {
        const b = pr(xR + 0.6 + r * 0.8, 0, Z), s = f / Z;
        set.tree(L, { parent: g, x: b[0], y: b[1], h: s * (7.5 + r * 2.5), kind: "round", seed: Math.round(Z * 7), far: fog(Z) * 0.9, air, color: "#9CC38A", sway: 0.5, shadow: false });
      }
      function fenceR() {
        let d = "";
        for (let Z = 3; Z < 150; Z += 0.5) { const a = pr(xR + 0.3, 0, Z), b = pr(xR + 0.3, 1.0, Z); d += `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`; }
        const r0 = pr(xR + 0.3, 0.8, 3), r1 = pr(xR + 0.3, 0.8, 150);
        d += `M${f1(r0[0])} ${f1(r0[1])}L${f1(r1[0])} ${f1(r1[1])}`;
        F.el("path", { d, stroke: "#F4F1EA", "stroke-width": 2, opacity: 0.85 }, g);
      }
      function poleR(Z) {
        const b = pr(curbR + 1.1, 0, Z), s = f / Z;
        set.pole(L, { parent: g, x: b[0], y: b[1], h: s * 8.6, far: fog(Z), air });
      }
      function lampR(X, Z) {
        const b = pr(X, 0, Z), s = f / Z;
        set.lampPost(L, { parent: g, x: b[0], y: b[1], h: s * 4.2, far: fog(Z), air, lit: o.lit });
      }
    };

    // ══════════════════════════════════════════════════════════════════════════════
    //  1850–1950: INTERIORS
    // ══════════════════════════════════════════════════════════════════════════════
    const WALL = { paper: "#8E9B77", plaster: "#E4D6BC", brick: "#9E5B4C", wood: "#7A4E36", stone: "#BDAE92", blue: "#7F93A3", red: "#8E4A3E", ochre: "#C9A15E" };
    // a room shell: back wall (wallpaper / plaster / brick / wood / stone), picture rail, wainscot, a ceiling band
    // with the lamp's warm patch, floorboards in perspective toward vp
    set.room = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 201), floorY = o.y ?? 780, vp = o.vp || { x: 960, y: 470 };
      const wallKind = o.wall || "paper", wc = o.color || WALL[wallKind] || WALL.paper;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.6 });
      const g = P.g(G(L, o, "room"));
      // back wall
      F.el("rect", { x: -900, y: -900, width: W + 1800, height: f1(floorY + 900), "data-cover": "x", fill: K.ulg(L, [[0, P.col(K.dark(wc, 0.25))], [0.35, P.col(wc)], [1, P.col(K.dark(wc, 0.12))]], 0, 0, 0, floorY) }, g);
      if (wallKind === "paper" && o.pattern !== false) {
        const id = F.uid("wp"), s = o.patternSize ?? 90;
        const pat = F.el("pattern", { id, patternUnits: "userSpaceOnUse", width: s, height: s * 1.3 }, L.defs);
        const mc = K.dark(wc, 0.14);
        F.el("path", { d: `M${s / 2} ${s * 0.2}c${s * 0.12} ${s * 0.12} ${s * 0.12} ${s * 0.3} 0 ${s * 0.42}c${-s * 0.12} ${-s * 0.12} ${-s * 0.12} ${-s * 0.3} 0 ${-s * 0.42}Z M0 ${s * 0.85}c${s * 0.08} ${s * 0.08} ${s * 0.08} ${s * 0.2} 0 ${s * 0.28}c${-s * 0.08} ${-s * 0.08} ${-s * 0.08} ${-s * 0.2} 0 ${-s * 0.28}Z M${s} ${s * 0.85}c${s * 0.08} ${s * 0.08} ${s * 0.08} ${s * 0.2} 0 ${s * 0.28}c${-s * 0.08} ${-s * 0.08} ${-s * 0.08} ${-s * 0.2} 0 ${-s * 0.28}Z`, fill: mc, opacity: 0.55 }, pat);
        F.el("circle", { cx: s / 2, cy: s * 0.41, r: s * 0.03, fill: K.lite(wc, 0.2), opacity: 0.5 }, pat);
        F.el("rect", { x: -900, y: -900, width: W + 1800, height: f1(floorY + 900), "data-cover": "x", fill: `url(#${id})`, opacity: 0.8 }, g);
      } else if (wallKind === "brick") {
        brickFill(L, g, -900, -900, W + 1800, floorY + 900, wc, P, o.seed);
      } else if (wallKind === "wood") {
        let d = "";
        for (let x = -900; x < W + 900; x += o.plank ?? 70) d += `M${x} -900V${floorY}`;
        F.el("path", { d, stroke: P.col(K.dark(wc, 0.3)), "stroke-width": 2, opacity: 0.6 }, g);
      }
      const railY = o.rail ?? floorY * 0.16;
      // ceiling band
      if (o.ceiling !== false) {
        const cy = o.ceilingY ?? floorY * 0.09;
        F.el("rect", { x: -900, y: -900, width: W + 1800, height: f1(cy + 900), "data-cover": "x", fill: P.col(o.ceilingColor || "#3B2A22") }, g);
        P.rect(g, -900, cy, W + 1800, 14, K.dark(wc, 0.4), { line: false });
        P.rect(g, -900, cy + 14, W + 1800, 6, K.lite(wc, 0.1), { line: false, op: 0.5 });
        if (o.lamp !== false) F.el("ellipse", { cx: f1(o.lampX ?? 380), cy: f1(cy - 10), rx: 360, ry: cy + 30, fill: K.soft(L, "#E9B878", 0.45) }, g);
      }
      P.rect(g, -900, railY, W + 1800, 8, K.dark(wc, 0.35), { line: false });
      P.rect(g, -900, railY + 8, W + 1800, 3, K.lite(wc, 0.15), { line: false, op: 0.6 });
      // wainscot
      const out = { g, floor: floorY, vp, rail: railY };
      if (o.wainscot !== false) {
        const wy = o.wainscotY ?? floorY - (floorY - railY) * 0.3, wood = o.wood || "#5B3B2D";
        F.el("rect", { x: -900, y: f1(wy), width: W + 1800, height: f1(floorY - wy), "data-cover": "x", fill: K.ulg(L, [[0, P.col(K.lite(wood, 0.06))], [1, P.col(K.dark(wood, 0.15))]], 0, wy, 0, floorY) }, g);
        P.rect(g, -900, wy - 10, W + 1800, 12, K.lite(wood, 0.1), { line: false });
        const pw = o.panel ?? 190;
        for (let x = -900; x < W + 900; x += pw) P.rect(g, x + 16, wy + 18, pw - 32, floorY - wy - 44, K.dark(wood, 0.06), { k: 0.1, sw: 1.2, stroke: K.dark(wood, 0.45) });
        out.wainscot = wy;
      }
      // skirting + floor
      const fl = o.floorColor || "#7A4B36";
      F.el("rect", { x: -900, y: f1(floorY), width: W + 1800, height: H + 900, "data-cover": "x", fill: K.ulg(L, [[0, P.col(K.dark(fl, 0.2))], [0.25, P.col(fl)], [1, P.col(K.lite(fl, 0.05))]], 0, floorY, 0, H) }, g);
      if ((o.floor || "boards") === "boards") {
        let d = "";
        const nb = o.boards ?? 34;
        for (let i = -nb; i <= nb; i++) {
          const bx = vp.x + i * (o.boardW ?? 150);
          const k = (floorY - vp.y) / (H + 300 - vp.y);
          d += `M${f1(vp.x + (bx - vp.x) * k)} ${f1(floorY)}L${f1(bx)} ${f1(H + 300)}`;
        }
        F.el("path", { d, stroke: P.col(K.dark(fl, 0.35)), "stroke-width": 2, opacity: 0.55 }, g);
        // alternating board tones
        for (let i = -nb; i < nb; i += 2) {
          const b0 = vp.x + i * (o.boardW ?? 150), b1 = b0 + (o.boardW ?? 150), k = (floorY - vp.y) / (H + 300 - vp.y);
          if (R() < 0.5) continue;
          F.el("path", { d: K.poly([[vp.x + (b0 - vp.x) * k, floorY], [vp.x + (b1 - vp.x) * k, floorY], [b1, H + 300], [b0, H + 300]]), fill: P.col(K.lite(fl, 0.06)), opacity: 0.6 }, g);
        }
      } else if (o.floor === "tiles" || o.floor === "stone") {
        set.courtyard(L, { parent: g, vp, y: floorY, color: o.floorColor || (o.floor === "tiles" ? "#C9B08A" : "#B8A888"), slab: o.floor === "tiles" ? 90 : 150, haze: false, seed: o.seed });
      }
      P.rect(g, -900, floorY - 16, W + 1800, 18, K.dark(o.wood || "#5B3B2D", 0.2), { line: false });
      P.rect(g, -900, floorY, W + 1800, 18, "#000000", { line: false, op: 0.15, fill: K.lg(L, "#000000", "#000000", "v", 0.25, 0) });
      return out;
    };
    function brickFill(L, g, x, y, w, h, c, P, seed) {
      const id = F.uid("bk"), bw = 64, bh = 26;
      const pat = F.el("pattern", { id, patternUnits: "userSpaceOnUse", width: bw * 2, height: bh * 2 }, L.defs);
      const R = K.R(seed ?? 1, 207);
      F.el("rect", { width: bw * 2, height: bh * 2, fill: P.col(K.lite(c, 0.22)) }, pat);
      const tone = () => P.col(R() < 0.5 ? K.lite(c, R() * 0.08) : K.dark(c, R() * 0.12));
      [[0, 0, bw], [bw, 0, bw], [-bw / 2, bh, bw], [bw / 2, bh, bw], [bw * 1.5, bh, bw]].forEach(([bx, by, ww]) =>
        F.el("rect", { x: bx + 2, y: by + 2, width: ww - 4, height: bh - 4, rx: 2, fill: tone() }, pat));
      F.el("rect", { x, y, width: w, height: h, fill: `url(#${id})`, "data-cover": "x" }, g);
    }
    // a plain brick wall panel (workshops, factories, storefront sides)
    set.brickWall = (L, o = {}) => {
      const P = K.pen(L, { far: o.far, air: airOf(o) });
      const g = P.g(G(L, o, "brickwall"));
      brickFill(L, g, o.x ?? -900, o.y ?? -900, o.w ?? W + 1800, o.h ?? H + 1800, o.color || "#9E5B4C", P, o.seed);
      return { g };
    };

    // a window with a view (night / day / dusk), mullions, curtains; `light` casts a shaft (day) or a glow
    set.window = (L, o = {}) => {
      const x = o.x ?? 1480, y = o.y ?? 180, w = o.w ?? 300, h = o.h ?? 440, view = o.view || "night";
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.8 });
      const g = P.g(G(L, o, "window"));
      const frame = o.frame || "#EAE2D0", R = K.R(o.seed ?? 1, 211);
      const x0 = x - w / 2, fw = w * 0.05;
      P.rect(g, x0 - fw * 1.6, y - fw * 1.6, w + fw * 3.2, h + fw * 3.2, frame, { k: 0.1 });
      // the view
      const vg = F.el("g", null, g);
      const id = F.uid("wv"), cp = F.el("clipPath", { id }, L.defs);
      F.el("rect", { x: f1(x0), y: f1(y), width: f1(w), height: f1(h) }, cp);
      vg.setAttribute("clip-path", `url(#${id})`);
      const skyC = view === "night" ? ["#15254E", "#2F4677"] : view === "dusk" ? ["#6A6A9A", "#F0B488"] : ["#8EC1E8", "#D9ECF7"];
      F.el("rect", { x: f1(x0), y: f1(y), width: f1(w), height: f1(h), fill: K.lg(L, skyC[0], skyC[1], "v") }, vg);
      if (view === "night") {
        let d = "";
        for (let i = 0; i < 70; i++) { const sx = x0 + R() * w, sy = y + R() * h * 0.8; d += `M${f1(sx)} ${f1(sy)}h1.8v1.8h-1.8Z`; }
        F.el("path", { d, fill: "#DCE6FF", opacity: 0.7 }, vg);
        F.el("circle", { cx: f1(x0 + w * 0.7), cy: f1(y + h * 0.2), r: f1(w * 0.06), fill: "#F4F1E6", opacity: 0.9 }, vg);
      }
      if (o.scenery !== false) {
        const hz = y + h * 0.72, sil = view === "night" ? "#1B2A4C" : view === "dusk" ? "#6B5E7E" : "#9DB7A6";
        F.el("path", { d: `M${f1(x0)} ${f1(hz)}Q${f1(x0 + w * 0.3)} ${f1(hz - h * 0.08)} ${f1(x0 + w * 0.6)} ${f1(hz - h * 0.03)}T${f1(x0 + w)} ${f1(hz - h * 0.05)}V${f1(y + h)}H${f1(x0)}Z`, fill: sil }, vg);
        // a house with a lit window
        const hx = x0 + w * 0.35, hw = w * 0.2;
        F.el("path", { d: `M${f1(hx)} ${f1(hz)}v${f1(-h * 0.1)}l${f1(hw / 2)} ${f1(-h * 0.06)}l${f1(hw / 2)} ${f1(h * 0.06)}v${f1(h * 0.1)}Z`, fill: K.dark(sil, 0.15) }, vg);
        if (view !== "day") F.el("rect", { x: f1(hx + hw * 0.38), y: f1(hz - h * 0.07), width: f1(hw * 0.24), height: f1(h * 0.035), fill: "#F7CF7E" }, vg);
        else F.el("circle", { cx: f1(x0 + w * 0.8), cy: f1(hz - h * 0.1), r: f1(w * 0.12), fill: "#8FB27A" }, vg);
      }
      F.el("rect", { x: f1(x0), y: f1(y), width: f1(w), height: f1(h), fill: "#FFFFFF", opacity: 0.08 }, g);
      if (view === "day") glassStreaks(g, x0, y, w, h, 0.16);
      // mullions
      const [nc, nr] = o.panes || [2, 3];
      let md = "";
      for (let i = 1; i < nc; i++) md += `M${f1(x0 + (w * i) / nc)} ${f1(y)}V${f1(y + h)}`;
      for (let i = 1; i < nr; i++) md += `M${f1(x0)} ${f1(y + (h * i) / nr)}H${f1(x0 + w)}`;
      F.el("path", { d: md, stroke: P.col(frame), "stroke-width": f1(fw * 0.8) }, g);
      P.rect(g, x0 - fw * 2.2, y + h + fw * 1.4, w + fw * 4.4, fw * 1.1, K.lite(frame, 0.05), { k: 0.12 });
      const out = { g, center: [x, y + h / 2], sill: [x, y + h + fw * 1.4], glass: [x0, y, w, h] };
      // curtains
      if (o.curtains !== false) {
        const cc = o.curtainColor || "#8E2F2B", cw = w * 0.34, drop = o.drop ?? h + fw * 6;
        const stripes = K.lgs(L, [[0, P.col(K.dark(cc, 0.25))], [0.18, P.col(K.lite(cc, 0.12))], [0.36, P.col(K.dark(cc, 0.18))], [0.55, P.col(K.lite(cc, 0.1))], [0.75, P.col(K.dark(cc, 0.22))], [1, P.col(K.lite(cc, 0.05))]], "h");
        for (const sd of [-1, 1]) {
          const cx0 = sd < 0 ? x0 - fw * 3 - cw * 0.55 : x0 + w + fw * 3 - cw * 0.45;
          const top = y - fw * 4;
          const tie = o.tied ? top + drop * 0.55 : null;
          const d = tie
            ? `M${f1(cx0)} ${f1(top)}h${f1(cw)}Q${f1(cx0 + cw * (sd < 0 ? 0.55 : 0.45))} ${f1(tie)} ${f1(cx0 + cw * (sd < 0 ? 0.62 : 0.38))} ${f1(tie)}Q${f1(cx0 + cw * (sd < 0 ? 1 : 0))} ${f1(top + drop * 0.8)} ${f1(cx0 + cw)} ${f1(top + drop)}h${f1(-cw)}Z`
            : `M${f1(cx0)} ${f1(top)}h${f1(cw)}l${f1(sd * cw * 0.06)} ${f1(drop)}q${f1(-cw * 0.25)} ${f1(-8)} ${f1(-cw * 0.5)} 0q${f1(-cw * 0.25)} 8 ${f1(-cw * 0.5)} 0Z`;
          P.path(g, d, cc, { fill: stripes, inkOf: cc });
        }
        P.rect(g, x0 - fw * 3 - cw * 0.7, y - fw * 4.6, w + fw * 6 + cw * 1.4, fw * 0.9, "#8C6A3A", { rx: fw * 0.4, k: 0.2 });
        if (o.pelmet) P.rect(g, x0 - fw * 3 - cw * 0.7, y - fw * 6, w + fw * 6 + cw * 1.4, fw * 3, o.curtainColor || "#8E2F2B", { k: 0.15 });
      }
      if (o.light) {
        if (view === "day") out.shaft = set.lightShaft(L, Object.assign({ parent: g, from: [x, y + h * 0.5], to: [x - w * 0.4, (o.floor ?? 1000)], w0: w * 0.9, w1: w * 1.6, a: 0.22, motes: 20 }, typeof o.light === "object" ? o.light : {}));
        else out.glow = set.glow(L, { parent: g, x, y: y + h * 0.4, r: w * 0.8, color: view === "night" ? "#9DB3E0" : "#FFD3A0", a: 0.22 });
      }
      return out;
    };

    // a tall bookshelf full of books (some leaning, some lying flat)
    set.bookshelf = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 221), x = o.x ?? 300, y = o.y ?? 780, w = o.w ?? 330, h = o.h ?? 640, n = o.shelves ?? 5;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.6 });
      const wood = o.color || "#5A3A2A";
      const g = P.g(G(L, o, "bookshelf"));
      const x0 = x - w / 2, side = w * 0.05, top = y - h, base = h * 0.06, cap = h * 0.04;
      P.rect(g, x0, top, w, h, K.dark(wood, 0.35), { line: false });
      const cols = o.palette || ["#7E2F2A", "#2F4A6B", "#3E5E3A", "#B08A4E", "#6B4A32", "#8E6A3E", "#2E3F52", "#A4452F", "#C9B48A", "#4F3A5E", "#5E7A55", "#9C3B32"];
      const sh = (h - base - cap) / n;
      for (let i = 0; i < n; i++) {
        const sy1 = top + cap + (i + 1) * sh, sy0 = sy1 - sh;
        let bx = x0 + side + 3;
        const xe = x0 + w - side - 3;
        while (bx < xe - 8) {
          const r = R();
          if (r < 0.06 && xe - bx > sh * 0.9) {           // a stack lying flat
            let sy = sy1;
            for (let k = 0; k < 3 + Math.floor(R() * 3); k++) { const bh = sh * 0.09, bw = sh * (0.65 + R() * 0.25); P.rect(g, bx, sy - bh, bw, bh, K.pick(R, cols), { k: 0.12, sw: 1 }); sy -= bh; }
            bx += sh * 0.95;
            continue;
          }
          if (r < 0.12) { bx += sh * (0.12 + R() * 0.3); continue; }   // a gap
          const bw = sh * (0.1 + R() * 0.14), bh = sh * (0.66 + R() * 0.28), c = K.pick(R, cols);
          if (bx + bw > xe) break;
          const lean = R() < 0.07 ? 12 : 0;
          const bg = P.g(g, lean ? { x: bx, y: sy1, r: lean } : null);
          const lx = lean ? 0 : bx, ly = lean ? 0 : sy1;
          P.rect(bg, lx, ly - bh, bw, bh, c, { dir: "h", k: 0.16, sw: 1 });
          P.rect(bg, lx + 1, ly - bh + bh * 0.12, bw - 2, bh * 0.04, R() < 0.5 ? "#D8B966" : K.dark(c, 0.3), { line: false, op: 0.85 });
          P.rect(bg, lx + 1, ly - bh * 0.18, bw - 2, bh * 0.035, R() < 0.5 ? "#D8B966" : K.dark(c, 0.3), { line: false, op: 0.85 });
          bx += bw + (lean ? bh * 0.2 : 0.5);
        }
        P.rect(g, x0, sy1 - 2, w, sh * 0.07, wood, { k: 0.12 });
      }
      P.rect(g, x0, top, side, h, wood, { dir: "h", k: 0.15 });
      P.rect(g, x0 + w - side, top, side, h, wood, { dir: "h", k: 0.15 });
      P.rect(g, x0 - w * 0.03, top - cap * 0.4, w * 1.06, cap * 1.4, K.lite(wood, 0.05), { k: 0.12 });
      P.rect(g, x0 - w * 0.015, y - base, w * 1.03, base, wood, { k: 0.15 });
      return { g, top: [x, top], base: [x, y] };
    };

    // a rug on the floor in perspective (centre x, y on the floor; w wide, d deep), border + medallions
    set.rug = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 930, w = o.w ?? 1300, d = o.d ?? 260, vp = o.vp || { x: 960, y: 470 };
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.4 });
      const c = o.color || "#8E3A32", bc = o.border || "#35507A";
      const g = P.g(G(L, o, "rug"));
      const yF = y - d / 2, yN = y + d / 2;
      const at = (X, yy) => [vp.x + (X - vp.x) * (yy - vp.y) / (y - vp.y), yy];
      const quad = (x0, x1, y0, y1) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
      P.poly(g, quad(x - w / 2, x + w / 2, yF, yN), c, { fill: K.lg(L, P.col(K.dark(c, 0.1)), P.col(K.lite(c, 0.06)), "v") });
      const b = w * 0.035;
      const ring = (inset, col2, sw) => { const q = quad(x - w / 2 + inset, x + w / 2 - inset, yF + inset * d / w * 1.6, yN - inset * d / w * 1.6); F.el("path", { d: K.poly(q), fill: "none", stroke: P.col(col2), "stroke-width": f1(sw) }, g); };
      ring(b * 0.8, bc, b * 0.9);
      ring(b * 2, "#C9A55C", 2.5);
      for (let i = -2; i <= 2; i++) {
        const p = at(x + i * w * 0.16, y);
        F.el("ellipse", { cx: f1(p[0]), cy: f1(p[1]), rx: f1(w * 0.04 * (p[1] - vp.y) / (y - vp.y)), ry: f1(d * 0.1), fill: P.col(K.dark(c, 0.18)), opacity: 0.8 }, g);
      }
      if (o.fringe !== false) {
        let fd = "";
        for (const yy of [yF, yN]) { const a = at(x - w / 2, yy), bb = at(x + w / 2, yy); for (let u = 0; u <= 1; u += 0.008) { const px = lerp(a[0], bb[0], u); fd += `M${f1(px)} ${f1(yy)}v${f1(yy === yN ? 8 : -5)}`; } }
        F.el("path", { d: fd, stroke: P.col("#E3D2A8"), "stroke-width": 1.5, opacity: 0.8 }, g);
      }
      return { g, center: [x, y] };
    };

    // a framed picture on the wall. subject: landscape | sea | portrait | ship
    set.picture = (L, o = {}) => {
      const x = o.x ?? 560, y = o.y ?? 260, w = o.w ?? 190, h = o.h ?? 140, subject = o.subject || "landscape";
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.4 });
      const g = P.g(G(L, o, "picture"));
      const fc = o.frame || "#B98B3E", fw = w * 0.07;
      if (o.wire !== false) P.stroke(g, `M${f1(x - w * 0.3)} ${f1(y - h / 2)}L${f1(x)} ${f1(y - h / 2 - h * 0.45)}L${f1(x + w * 0.3)} ${f1(y - h / 2)}`, "#3E3028", 1.6);
      P.soft(g, x + 6, y + 8, w * 0.6, h * 0.62, "#20140C", 0.25);
      P.rect(g, x - w / 2, y - h / 2, w, h, fc, { fill: K.lg(L, P.col(K.lite(fc, 0.25)), P.col(K.dark(fc, 0.25)), "d") });
      const ix = x - w / 2 + fw, iy = y - h / 2 + fw, iw = w - 2 * fw, ih = h - 2 * fw;
      P.rect(g, ix - 3, iy - 3, iw + 6, ih + 6, "#EDE5D2", { line: false });
      const pg = F.el("g", null, g);
      if (subject === "portrait") {
        P.rect(pg, ix, iy, iw, ih, "#4E4238", { line: false, fill: K.lg(L, P.col("#6A5A4A"), P.col("#2E251E"), "v") });
        P.ellipse(pg, x, iy + ih * 0.42, iw * 0.16, ih * 0.2, "#C9A58A", { line: false });
        P.path(pg, `M${f1(x - iw * 0.32)} ${f1(iy + ih)}Q${f1(x)} ${f1(iy + ih * 0.5)} ${f1(x + iw * 0.32)} ${f1(iy + ih)}Z`, "#2A2A30", { line: false });
      } else {
        const skyC = subject === "sea" ? ["#9CC3DE", "#DDEAF0"] : ["#A8CBE4", "#E4EEF2"];
        P.rect(pg, ix, iy, iw, ih, skyC[0], { line: false, fill: K.lg(L, P.col(skyC[0]), P.col(skyC[1]), "v") });
        if (subject === "sea" || subject === "ship") {
          P.rect(pg, ix, iy + ih * 0.6, iw, ih * 0.4, "#5E8FA8", { line: false });
          if (subject === "ship") { P.path(pg, `M${f1(x - iw * 0.15)} ${f1(iy + ih * 0.62)}h${f1(iw * 0.3)}l${f1(-iw * 0.05)} ${f1(ih * 0.08)}h${f1(-iw * 0.2)}Z`, "#5A3E2A", { line: false }); P.path(pg, `M${f1(x)} ${f1(iy + ih * 0.6)}V${f1(iy + ih * 0.2)}L${f1(x + iw * 0.14)} ${f1(iy + ih * 0.55)}Z`, "#F2ECDD", { line: false }); }
        } else {
          P.path(pg, `M${f1(ix)} ${f1(iy + ih * 0.62)}Q${f1(x)} ${f1(iy + ih * 0.5)} ${f1(ix + iw)} ${f1(iy + ih * 0.6)}V${f1(iy + ih)}H${f1(ix)}Z`, "#7FA362", { line: false });
          P.rect(pg, x - iw * 0.02, iy + ih * 0.35, iw * 0.04, ih * 0.22, "#5C4632", { line: false });
          P.circle(pg, x, iy + ih * 0.33, iw * 0.12, "#4F7442", { line: false });
        }
      }
      return { g, center: [x, y] };
    };

    // a clock. kind: pendulum (wall case, the pendulum swings) | wall (round) ; time "h:mm"
    set.clock = (L, o = {}) => {
      const x = o.x ?? 1200, y = o.y ?? 300, h = o.h ?? 180, kind = o.kind || "pendulum";
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.4 });
      const g = P.g(G(L, o, "clock"));
      const wood = o.color || "#6A4128";
      const [hh, mm] = String(o.time || "10:10").split(":").map(Number);
      let face;
      if (kind === "pendulum") {
        const w = h * 0.36;
        P.rect(g, x - w / 2, y - h / 2, w, h, wood, { dir: "h", k: 0.16, rx: w * 0.08 });
        P.path(g, `M${f1(x - w * 0.6)} ${f1(y - h / 2)}Q${f1(x)} ${f1(y - h * 0.68)} ${f1(x + w * 0.6)} ${f1(y - h / 2)}Z`, wood, { k: 0.15 });
        face = [x, y - h * 0.22, w * 0.38];
        P.rect(g, x - w * 0.3, y + h * 0.02, w * 0.6, h * 0.42, "#2A1C14", { fill: K.lg(L, P.col("#3E2A1E"), P.col("#1C130E"), "v") });
        const pend = F.el("g", null, g);
        P.stroke(pend, `M${f1(x)} ${f1(y + h * 0.03)}V${f1(y + h * 0.35)}`, "#C9A652", 2);
        P.circle(pend, x, y + h * 0.37, w * 0.1, "#D8B55A", { k: 0.3 });
        if (o.swing !== false) S.on((t) => pend.setAttribute("transform", `rotate(${f1(Math.sin(t * Math.PI) * 9)} ${f1(x)} ${f1(y + h * 0.03)})`));
      } else face = [x, y, h / 2];
      const [fx, fy, fr] = face;
      P.circle(g, fx, fy, fr * 1.12, "#C9A652", { k: 0.25 });
      P.circle(g, fx, fy, fr, "#F3ECDD", { k: 0.05 });
      let tk = "";
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; tk += `M${f1(fx + Math.sin(a) * fr * 0.78)} ${f1(fy - Math.cos(a) * fr * 0.78)}L${f1(fx + Math.sin(a) * fr * 0.9)} ${f1(fy - Math.cos(a) * fr * 0.9)}`; }
      P.stroke(g, tk, "#3A2A20", Math.max(1, fr * 0.05));
      const hand = (a, len, w) => P.stroke(g, `M${f1(fx)} ${f1(fy)}L${f1(fx + Math.sin(a) * len)} ${f1(fy - Math.cos(a) * len)}`, "#2A1E18", w);
      const hmin = hand(((mm / 60) * Math.PI * 2), fr * 0.78, Math.max(1, fr * 0.06));
      const hhr = hand((((hh % 12) + mm / 60) / 12) * Math.PI * 2, fr * 0.5, Math.max(1.4, fr * 0.09));
      if (o.run) S.on((t) => { const m = mm + t * (o.run === true ? 1 : o.run); hmin.setAttribute("transform", `rotate(${f1((m - mm) * 6)} ${f1(fx)} ${f1(fy)})`); hhr.setAttribute("transform", `rotate(${f1((m - mm) * 0.5)} ${f1(fx)} ${f1(fy)})`); });
      return { g, face: [fx, fy] };
    };

    // a pegboard with tool silhouettes (wrenches, hammer, saw, pliers, chisels)
    set.pegboard = (L, o = {}) => {
      const x = o.x ?? 1400, y = o.y ?? 300, w = o.w ?? 300, h = o.h ?? 220;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.2 });
      const g = P.g(G(L, o, "pegboard"));
      const R = K.R(o.seed ?? 1, 227);
      P.rect(g, x - w / 2, y - h / 2, w, h, o.color || "#B8915C", { k: 0.08 });
      let dots = "";
      for (let i = 1; i < 12; i++) for (let k = 1; k < 9; k++) dots += `M${f1(x - w / 2 + (w * i) / 12)} ${f1(y - h / 2 + (h * k) / 9)}h2v2h-2Z`;
      F.el("path", { d: dots, fill: P.col("#6A5034"), opacity: 0.5 }, g);
      const metal = "#8E979C", handle = "#8A3B2E";
      const tools = [
        (tx) => { P.rect(g, tx - 5, y - h * 0.38, 10, h * 0.5, metal, { k: 0.2, rx: 4 }); P.circle(g, tx, y - h * 0.38, 14, metal, {}); P.circle(g, tx, y - h * 0.38, 6, o.color || "#B8915C", { line: false }); },
        (tx) => { P.rect(g, tx - 4, y - h * 0.35, 8, h * 0.62, "#9C7A4E", { k: 0.2 }); P.rect(g, tx - 22, y - h * 0.4, 44, 16, "#4E555A", { k: 0.2, rx: 3 }); },
        (tx) => { P.path(g, `M${f1(tx - 8)} ${f1(y - h * 0.4)}L${f1(tx + 22)} ${f1(y - h * 0.4)}L${f1(tx + 14)} ${f1(y + h * 0.3)}L${f1(tx - 8)} ${f1(y + h * 0.26)}Z`, "#C3CBCF", { k: 0.2 }); P.rect(g, tx - 20, y - h * 0.45, 18, 34, handle, { rx: 6 }); },
        (tx) => { P.rect(g, tx - 3, y - h * 0.2, 6, h * 0.45, metal, { k: 0.2 }); P.rect(g, tx - 6, y - h * 0.38, 12, h * 0.2, handle, { k: 0.2, rx: 4 }); },
        (tx) => { P.path(g, `M${f1(tx - 12)} ${f1(y + h * 0.25)}L${f1(tx - 2)} ${f1(y - h * 0.35)}M${f1(tx + 12)} ${f1(y + h * 0.25)}L${f1(tx + 2)} ${f1(y - h * 0.35)}`, null, { stroke: handle, sw: 7 }); P.circle(g, tx, y - h * 0.05, 5, metal, {}); },
      ];
      const n = o.n ?? 6;
      for (let i = 0; i < n; i++) tools[Math.floor(R() * tools.length)](x - w / 2 + w * (i + 0.5) / n);
      return { g };
    };

    // a workshop: brick wall, a bright window, pegboard, shelf of cans, hanging lamp, beams, floorboards,
    // a workbench — lit warm (the Wright brothers' shop)
    set.workshop = (L, o = {}) => {
      const g = G(L, o, "workshop");
      const floorY = o.y ?? 800;
      const room = set.room(L, { parent: g, y: floorY, wall: "brick", color: o.color || "#9E5B4C", wainscot: false, ceiling: true, ceilingY: 70, lampX: o.lampX ?? 800, vp: o.vp || { x: 900, y: 440 }, floorColor: "#6E4A36", seed: o.seed });
      const P = K.pen(L, { far: o.far, air: airOf(o) });
      // beams
      for (let bx = -100; bx < W + 200; bx += 250) P.rect(g, bx, 40, 60, 60, "#3A2A20", { k: 0.2 });
      P.rect(g, -900, 96, W + 1800, 10, "#4A3528", { line: false });
      const out = { g, room, floor: floorY };
      if (o.window !== false) out.window = set.window(L, { parent: g, x: o.windowX ?? 230, y: 150, w: 260, h: 420, view: "day", curtains: false, panes: [3, 4], frame: "#E9DFC9", light: { to: [640, floorY + 160], w1: 520, a: 0.26 } });
      set.pegboard(L, { parent: g, x: o.pegX ?? 540, y: 330, w: 260, h: 220, seed: o.seed });
      // shelf with cans
      const sx = o.shelfX ?? 1500;
      P.rect(g, sx - 170, 300, 340, 14, "#6B4A32", { k: 0.15 });
      const cans = ["#5E7F6A", "#C9A55C", "#4F6B8A", "#A25A3E", "#6E8C72"];
      cans.forEach((c, i) => P.rect(g, sx - 150 + i * 64, 230 + (i % 2) * 12, 40, 70 - (i % 2) * 12, c, { fill: K.cyl(L, c), rx: 4 }));
      // hanging lamp
      const lx = o.lampX ?? 800;
      P.stroke(g, `M${lx} 100V210`, "#2E2620", 3);
      P.path(g, `M${lx - 60} 262Q${lx} 196 ${lx + 60} 262Z`, "#3F6B4E", { k: 0.25 });
      out.lamp = set.glow(L, { parent: g, x: lx, y: 270, r: 420, color: "#FFD9A0", a: 0.55, flicker: 0.05 });
      P.ellipse(g, lx, 262, 24, 8, "#FFF4D6", { line: false });
      // bench
      if (o.bench !== false) out.bench = set.bench(L, { parent: g, x: o.benchX ?? 1300, y: floorY + 120, w: 760, h: 300 });
      return out;
    };

    // a workbench with drawers (front view); returns the top surface
    set.bench = (L, o = {}) => {
      const x = o.x ?? 1300, y = o.y ?? 920, w = o.w ?? 700, h = o.h ?? 280;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.8 });
      const g = P.g(G(L, o, "bench"));
      const wood = o.color || "#9C7048";
      P.soft(g, x, y + 4, w * 0.56, h * 0.08, "#20140C", 0.35);
      const top = y - h;
      for (const sx of [-1, 1]) P.rect(g, x + sx * w * 0.44 - w * 0.03, top + h * 0.1, w * 0.06, h * 0.9, K.dark(wood, 0.1), { dir: "h", k: 0.15 });
      P.rect(g, x - w * 0.42, top + h * 0.12, w * 0.84, h * 0.4, K.dark(wood, 0.05), { k: 0.1 });
      for (let i = 0; i < 3; i++) {
        const dx = x - w * 0.4 + i * w * 0.27;
        P.rect(g, dx, top + h * 0.16, w * 0.25, h * 0.3, wood, { k: 0.12, sw: 1.2 });
        P.circle(g, dx + w * 0.125, top + h * 0.31, 5, "#D2B062", { sw: 1 });
      }
      P.rect(g, x - w / 2, top, w, h * 0.1, K.lite(wood, 0.1), { k: 0.14 });
      P.rect(g, x - w * 0.44, y - h * 0.15, w * 0.88, h * 0.05, K.dark(wood, 0.1), { k: 0.1 });
      return { g, top: [x, top], left: x - w / 2, right: x + w / 2 };
    };

    // a railway compartment at night (or day): panelling, windows with the landscape streaming past,
    // a luggage rack, an upholstered bench, a wall lamp
    set.train = (L, o = {}) => {
      const g = G(L, o, "train");
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.6 });
      const R = K.R(o.seed ?? 1, 233);
      const wood = o.wood || "#6A3E2A", night = o.view !== "day";
      F.el("rect", { x: -900, y: -900, width: W + 1800, height: H + 1800, "data-cover": "1", fill: K.ulg(L, [[0, P.col(K.dark(wood, 0.2))], [0.5, P.col(wood)], [1, P.col(K.dark(wood, 0.3))]], 0, 0, 0, H) }, g);
      // panels
      for (let px = 1060; px < W + 400; px += 340) P.rect(g, px, 170, 280, 420, K.dark(wood, 0.05), { k: 0.12, sw: 1.4, stroke: K.dark(wood, 0.45) });
      // windows with the moving landscape
      const wins = o.windows || [[110, 170, 420, 440], [560, 170, 420, 440]];
      const speed = o.speed ?? 1;
      wins.forEach(([wx, wy, ww, wh], i) => {
        const id = F.uid("tw"), cp = F.el("clipPath", { id }, L.defs);
        F.el("rect", { x: wx, y: wy, width: ww, height: wh }, cp);
        const vg = F.el("g", { "clip-path": `url(#${id})` }, g);
        F.el("rect", { x: wx, y: wy, width: ww, height: wh, fill: night ? K.lg(L, "#101C3D", "#2A3F6D", "v") : K.lg(L, "#8EC1E8", "#DDEFF7", "v") }, vg);
        if (night) {
          let d = "";
          for (let k = 0; k < 40; k++) d += `M${f1(wx + R() * ww)} ${f1(wy + R() * wh * 0.7)}h1.8v1.8h-1.8Z`;
          F.el("path", { d, fill: "#E0E8FF", opacity: 0.75 }, vg);
          if (i === 0) set.moon(L, { parent: vg, x: wx + ww * 0.3, y: wy + wh * 0.18, r: 16, phase: "crescent" });
          else F.el("circle", { cx: wx + ww * 0.55, cy: wy + wh * 0.3, r: 30, fill: K.soft(L, "#DCE6FF", 0.5) }, vg);
        }
        // parallax strips: far hills (slow), trees (fast), poles and streaks (fastest)
        const far = F.el("g", null, vg), mid = F.el("g", null, vg), near = F.el("g", null, vg);
        const hz = wy + wh * 0.72;
        let hd = `M${wx - 800} ${wy + wh}`;
        for (let xx = wx - 800; xx < wx + ww + 1600; xx += 120) hd += `L${xx} ${f1(hz - 20 - R() * 30)}`;
        hd += `L${wx + ww + 1600} ${wy + wh}Z`;
        F.el("path", { d: hd, fill: night ? "#1C2B50" : "#8FAE93" }, far);
        for (let k = 0; k < 16; k++) set.tree(L, { parent: mid, x: wx - 400 + k * 150 + R() * 60, y: hz + 30, h: 90 + R() * 70, kind: R() < 0.3 ? "poplar" : "round", color: night ? "#223358" : "#6F9A64", sway: 0, shadow: false, seed: k + i * 20, bark: night ? "#1C2848" : undefined });
        F.el("rect", { x: wx - 900, y: hz + 28, width: ww + 2400, height: wh, fill: night ? "#15213F" : "#7F9C6B" }, mid);
        for (let k = 0; k < 6; k++) { const px = wx + k * 260; F.el("rect", { x: px, y: wy - 20, width: 8, height: wh + 40, fill: night ? "#0E162C" : "#4E4034", opacity: 0.8 }, near); }
        for (let k = 0; k < 8; k++) F.el("rect", { x: f1(wx + R() * ww * 2), y: f1(wy + wh * (0.2 + R() * 0.6)), width: f1(40 + R() * 60), height: 1.6, rx: 1, fill: "#FFF1C8", opacity: 0.6 }, near);
        S.on((t) => {
          const d = t * 60 * speed;
          far.setAttribute("transform", `translate(${f1(-((d * 0.2) % 600))} 0)`);
          mid.setAttribute("transform", `translate(${f1(-((d * 1.6) % 900))} 0)`);
          near.setAttribute("transform", `translate(${f1(-((d * 9) % 520))} 0)`);
        });
        // frame + tasselled blind at the top
        P.rect(g, wx - 14, wy - 14, ww + 28, wh + 28, "none", { stroke: K.dark(wood, 0.3), sw: 14, line: true });
        P.rect(g, wx - 14, wy - 24, ww + 28, 22, "#8C6A3A", { k: 0.2 });
        let fr = "";
        for (let xx = wx; xx < wx + ww; xx += 7) fr += `M${xx} ${wy - 2}v7`;
        P.stroke(g, fr, "#D2B062", 1.5);
        F.el("rect", { x: wx, y: wy, width: ww, height: wh, fill: "#FFFFFF", opacity: 0.05 }, g);
        P.rect(g, wx - 20, wy + wh + 10, ww + 40, 18, K.lite(wood, 0.1), { k: 0.15 });
      });
      // luggage rack with a suitcase
      P.stroke(g, "M0 60H1100M0 110H1100", "#C9A652", 5);
      for (let xx = 20; xx < 1100; xx += 180) P.stroke(g, `M${xx} 60V110`, "#C9A652", 4);
      P.rect(g, 170, 64, 120, 44, "#7C4A34", { k: 0.2, rx: 6 });
      P.rect(g, 420, 72, 330, 34, "#E8E2D2", { k: 0.1, rx: 16 });
      // wall lamp
      const lx = o.lampX ?? 1540;
      P.rect(g, lx - 8, 260, 16, 110, "#C9A652", { k: 0.25 });
      P.rect(g, lx - 40, 360, 50, 10, "#C9A652", { k: 0.25 });
      P.path(g, `M${lx - 18} 250Q${lx} 210 ${lx + 18} 250Z`, "#FFF1CF", { k: 0.1 });
      const out = { g, lamp: set.glow(L, { parent: g, x: lx, y: 240, r: 300, color: "#FFD9A0", a: 0.6, flicker: 0.06 }) };
      // bench
      const by = o.benchY ?? 650;
      P.rect(g, 20, by - 40, 1340, 70, K.dark(wood, 0.1), { k: 0.1 });
      P.rect(g, 30, by + 20, 1320, 200, o.seat || "#3E6A4A", { k: 0.14, rx: 18 });
      let bt = "";
      for (let xx = 90; xx < 1320; xx += 110) for (const yy of [by + 70, by + 150]) bt += `M${xx} ${yy}a4 4 0 1 0 0.1 0Z`;
      F.el("path", { d: bt, fill: P.col(K.dark(o.seat || "#3E6A4A", 0.4)) }, g);
      P.rect(g, -900, by + 220, W + 1800, 40, K.dark(wood, 0.15), { k: 0.1 });
      F.el("rect", { x: -900, y: by + 258, width: W + 1800, height: H, fill: P.col(K.dark(o.seat || "#3E6A4A", 0.25)), "data-cover": "x" }, g);
      out.seat = by + 20;
      return out;
    };

    // a parlour, c. 1880 (the reference's opening room): wallpaper, wainscot, bookshelf, lamp-lit round table,
    // a framed picture, red curtains at a night window, a rug on the floorboards
    set.parlour = (L, o = {}) => {
      const g = G(L, o, "parlour");
      const floorY = o.y ?? 780, vp = o.vp || { x: 960, y: 470 };
      const out = { g };
      out.room = set.room(L, { parent: g, y: floorY, vp, wall: o.wall || "paper", color: o.color, lampX: o.lampX ?? 470, seed: o.seed });
      out.window = set.window(L, { parent: g, x: o.windowX ?? 1560, y: 200, w: 250, h: 400, view: o.view || "night", tied: false, light: true });
      out.picture = set.picture(L, { parent: g, x: o.pictureX ?? 540, y: 330, w: 200, h: 140 });
      out.shelf = set.bookshelf(L, { parent: g, x: o.shelfX ?? 190, y: floorY + 8, w: 330, h: 640, seed: o.seed });
      out.rug = set.rug(L, { parent: g, x: 1060, y: floorY + 190, w: 1500, d: 260, vp });
      if (S.prop && S.prop.table && o.table !== false) {
        out.table = S.prop.table(L, { parent: g, x: o.tableX ?? 470, y: floorY + 110, w: 440, kind: "round", cloth: "#4F6B4A" });
        if (S.prop.lamp) out.lamp = S.prop.lamp(L, { parent: g, x: (o.tableX ?? 470) + 10, y: out.table.top[1] + 4, h: 250, kind: "parlour", lit: true });
      }
      return out;
    };

    // ══════════════════════════════════════════════════════════════════════════════
    //  SPACE
    // ══════════════════════════════════════════════════════════════════════════════
    // a starfield: deep-space gradient ("space": blue-black like the reference, "void": black), stars, a faint milky band
    set.starfield = (L, o = {}) => {
      const g = G(L, o, "starfield");
      const sky = set.sky(L, { parent: g, kind: o.kind === "void" ? "void" : "space", stars: o.n ?? 280, seed: o.seed, setAir: o.setAir });
      if (o.milky !== false) {
        const R = K.R(o.seed ?? 1, 241), a = o.milkyAngle ?? -24;
        const mg = F.el("g", { transform: `rotate(${a} 960 540)`, opacity: 0.55 }, g);
        F.el("ellipse", { cx: 960, cy: 520, rx: 1500, ry: 150, fill: K.soft(L, "#9FB6E6", 0.22) }, mg);
        F.el("ellipse", { cx: 800, cy: 530, rx: 900, ry: 70, fill: K.soft(L, "#E6EEFF", 0.18) }, mg);
        let d = "";
        for (let i = 0; i < 260; i++) { const x = -500 + R() * 2900, y = 520 + (R() + R() + R() - 1.5) * 160; d += `M${f1(x)} ${f1(y)}h1.2v1.2h-1.2Z`; }
        F.el("path", { d, fill: "#EEF3FF", opacity: 0.7 }, mg);
      }
      return { g, stars: sky.stars };
    };

    // orthographic projection of lon/lat (degrees) onto a disc of radius r centred at cx,cy; λ0/φ0 the centre
    function ortho(lon, lat, l0, p0, r) {
      const d = Math.PI / 180, la = lat * d, dl = (lon - l0) * d, pp = p0 * d;
      const cosc = Math.sin(pp) * Math.sin(la) + Math.cos(pp) * Math.cos(la) * Math.cos(dl);
      const x = r * Math.cos(la) * Math.sin(dl), y = r * (Math.cos(pp) * Math.sin(la) - Math.sin(pp) * Math.cos(la) * Math.cos(dl));
      return [x, -y, cosc];
    }
    K.ortho = ortho;
    // the Earth from space: ocean, real (simplified) continents, cloud swirls, a night side, an atmosphere glow;
    // lon: the longitude facing us (deg), tilt: the latitude at the centre, spin: deg/s
    set.earth = (L, o = {}) => {
      const x = o.x ?? 1400, y = o.y ?? 330, r = o.r ?? 220, tilt = o.tilt ?? 18;
      const lon0 = o.lon ?? 20, spin = o.spin ?? 2;
      const g = G(L, o, "earth");
      const light = o.light || "left", lx = light === "right" ? 1 : light === "front" ? 0 : -1;
      if (o.glow !== false) {
        F.el("circle", { cx: x, cy: y, r: r * 1.32, fill: K.urg(L, [[0, "#6FA8FF", 0], [0.72, "#6FA8FF", 0], [0.76, "#8EC0FF", 0.55], [0.84, "#4D86D8", 0.25], [1, "#2A5BB0", 0]], x, y, r * 1.32) }, g);
      }
      F.el("circle", { cx: x, cy: y, r, fill: K.urg(L, [[0, "#5AA2DE"], [0.6, "#2F74BE"], [1, "#1B4A8C"]], x + lx * r * 0.35, y - r * 0.3, r * 1.4) }, g);
      const clipId = F.uid("ec"), cp = F.el("clipPath", { id: clipId }, L.defs);
      F.el("circle", { cx: x, cy: y, r: r - 0.5 }, cp);
      const surf = F.el("g", { "clip-path": `url(#${clipId})` }, g);
      // land coloured by latitude band (ice, forest, desert, tropics, desert, grass), as a gradient down the disc
      const desert = o.land || "#CDB57C", green = o.land2 || "#8FAE6B", forest = "#78995C", ice = "#E6ECF0";
      const bands = [[90, ice], [74, ice], [64, forest], [50, green], [38, desert], [18, desert], [6, green], [-14, green], [-22, desert], [-32, desert], [-42, green], [-90, green]];
      const off = (lat) => clamp((1 - Math.sin(clamp(lat - tilt, -90, 90) * Math.PI / 180)) / 2, 0, 1);
      const landFill = K.ulg(L, bands.map(([lat, c]) => [off(lat), c]).sort((a, b) => a[0] - b[0]), x, y - r, x, y + r);
      const landEls = K.LAND.map((ring) => ({ ring, el: F.el("path", { fill: landFill }, surf) }));
      // clouds: soft puffs on the sphere (each foreshortened toward the limb)
      const R = K.R(o.seed ?? 7, 251);
      const puffs = [];
      const cg = F.el("g", null, surf);
      const nC = o.clouds ?? 30;
      for (let i = 0; i < nC; i++) {
        const path = [];
        if (i % 3 === 0) {
          const lat0 = (R() < 0.5 ? 1 : -1) * (35 + R() * 20), lon = R() * 360, turns = 0.8 + R() * 0.5, sg = lat0 > 0 ? 1 : -1;
          for (let k = 0; k <= 12; k++) { const a = (k / 12) * turns * Math.PI * 2, rr = 1.5 + k * 1.4; path.push([lon + Math.cos(a) * rr * 1.5, lat0 + sg * Math.sin(a) * rr * 0.8, 2.2 + k * 0.25]); }
        } else {
          const lat = (R() - 0.5) * 110, lon = R() * 360, n = 5 + Math.floor(R() * 7), dl = (R() < 0.5 ? 1 : -1) * (3.5 + R() * 3);
          for (let k = 0; k < n; k++) path.push([lon + k * dl, lat + Math.sin(k * 0.7 + i) * 2 + (R() - 0.5) * 2, 2.5 + R() * 3.5]);
        }
        for (const [lo, la, rad] of path) puffs.push({ lo, la, rad, el: F.el("ellipse", { fill: K.soft(L, "#FFFFFF", 0.9) }, cg) });
      }
      const draw = (l0) => {
        for (const le of landEls) {
          const ring = le.ring;
          let d = "", vis = false;
          for (let i = 0; i < ring.length; i += 2) {
            let [px, py, c] = ortho(ring[i] / 10, ring[i + 1] / 10, l0, tilt, r);
            if (c > 0) vis = true;
            else { const m = Math.hypot(px, py) || 1; px = (px / m) * r; py = (py / m) * r; }
            d += (i ? "L" : "M") + f1(x + px) + " " + f1(y + py);
          }
          le.el.setAttribute("d", vis ? d + "Z" : "");
        }
        const lc = l0 - (o.cloudDrift ?? 0.25) * (l0 - lon0);
        for (const p of puffs) {
          const [px, py, cc] = ortho(p.lo, p.la, lc, tilt, r);
          if (cc <= 0.02) { p.el.setAttribute("rx", "0"); continue; }
          const sz = (p.rad * Math.PI / 180) * r * 1.3, ang = Math.atan2(py, px) * 180 / Math.PI;
          p.el.setAttribute("cx", f1(x + px)); p.el.setAttribute("cy", f1(y + py));
          p.el.setAttribute("rx", f1(sz * Math.max(0.15, cc))); p.el.setAttribute("ry", f1(sz));
          p.el.setAttribute("transform", `rotate(${f1(ang)} ${f1(x + px)} ${f1(y + py)})`);
        }

      };
      draw(lon0);
      if (spin) S.on((t) => draw(lon0 - spin * t));
      // night side + highlight
      if (o.night !== false) {
        const nx = -lx || 0.0001;
        F.el("circle", { cx: x, cy: y, r, fill: K.ulg(L, [[0, "#06102A", 0], [0.4, "#06102A", 0], [0.52, "#06102A", 0.18], [0.64, "#06102A", 0.55], [0.8, "#040A1C", 0.82], [1, "#030814", 0.93]], x - nx * r * 1.0, y, x + nx * r, y) }, g);
      }
      F.el("ellipse", { cx: f1(x + lx * r * 0.42), cy: f1(y - r * 0.4), rx: f1(r * 0.3), ry: f1(r * 0.22), fill: K.soft(L, "#FFFFFF", 0.22) }, g);
      F.el("circle", { cx: x, cy: y, r, fill: "none", stroke: "#9CCBFF", "stroke-width": f1(Math.max(1.5, r * 0.012)), opacity: 0.6 }, g);
      return { g, x, y, r };
    };

    // the lunar surface: grey ground to a gently curved horizon, craters in perspective, rocks with shadows
    set.lunarSurface = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 257), y = o.y ?? 560, c = o.color || "#8C8880";
      const g = G(L, o, "lunar");
      const sunLeft = (o.light || "left") === "left";
      F.el("path", { d: `M-900 ${f1(y + 30)}Q960 ${f1(y - 14)} ${W + 900} ${f1(y + 30)}L${W + 900} ${H + 900}L-900 ${H + 900}Z`, fill: K.ulg(L, [[0, K.lite(c, 0.12)], [0.3, c], [1, K.dark(c, 0.12)]], 0, y, 0, H) }, g);
      F.el("path", { d: `M-900 ${f1(y + 30)}Q960 ${f1(y - 14)} ${W + 900} ${f1(y + 30)}`, fill: "none", stroke: K.lite(c, 0.3), "stroke-width": 2, opacity: 0.6 }, g);
      const list = [];
      for (let i = 0; i < (o.craters ?? 16); i++) { const u = Math.pow(R(), 1.3); list.push({ u, x: -200 + R() * (W + 400), y: y + 14 + u * (H - y + 60), w: (40 + R() * 160) * (0.2 + u * 1.2) }); }
      list.sort((a, b) => a.y - b.y);
      for (const cr of list) {
        const hh = cr.w * (0.16 + 0.22 * cr.u), sx = sunLeft ? 1 : -1;
        F.el("ellipse", { cx: f1(cr.x), cy: f1(cr.y), rx: f1(cr.w * 0.62), ry: f1(hh * 0.72), fill: K.soft(L, K.lite(c, 0.25), 0.5) }, g);
        F.el("ellipse", { cx: f1(cr.x), cy: f1(cr.y), rx: f1(cr.w / 2), ry: f1(hh / 2), fill: K.dark(c, 0.3) }, g);
        F.el("ellipse", { cx: f1(cr.x + sx * cr.w * 0.1), cy: f1(cr.y + hh * 0.05), rx: f1(cr.w * 0.38), ry: f1(hh * 0.4), fill: K.dark(c, 0.08) }, g);
      }
      let rd = "", sd = "";
      for (let i = 0; i < (o.rocks ?? 40); i++) {
        const u = Math.pow(R(), 1.2), rx = -100 + R() * (W + 200), ry = y + 20 + u * (H - y), s = (2 + R() * 5) * (0.3 + u * 1.4);
        const sx = sunLeft ? 1 : -1;
        sd += `M${f1(rx)} ${f1(ry + s * 0.3)}l${f1(sx * s * 5)} ${f1(s * 0.2)}l${f1(-sx * s * 0.5)} ${f1(s * 0.6)}Z`;
        rd += `M${f1(rx)} ${f1(ry)}a${f1(s)} ${f1(s * 0.75)} 0 1 0 0.1 0Z`;
      }
      F.el("path", { d: sd, fill: K.dark(c, 0.45), opacity: 0.6 }, g);
      F.el("path", { d: rd, fill: K.lite(c, 0.45) }, g);
      if (o.footprints) set.footprints(L, { parent: g, from: o.footprints.from || [760, H - 60], to: o.footprints.to || [1100, y + 60], n: 18, color: K.dark(c, 0.35), size: 20 });
      return { g, horizon: y };
    };

    // ══════════════════════════════════════════════════════════════════════════════
    //  THE LIBRARY (Alexandria, as an illustrator imagines it)
    // ══════════════════════════════════════════════════════════════════════════════
    // pigeonhole shelves full of scroll ends (a few with hanging tags)
    set.scrollShelf = (L, o = {}) => {
      const R = K.R(o.seed ?? 1, 261), x = o.x ?? 960, y = o.y ?? 780, w = o.w ?? 420, h = o.h ?? 620, cell = o.cell ?? 72;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.4 });
      const wood = o.color || "#6B4430";
      const g = P.g(G(L, o, "scrollshelf"));
      const x0 = x - w / 2, top = y - h, nc = Math.max(1, Math.round((w - 20) / cell)), nr = Math.max(1, Math.round((h - 40) / cell));
      const cw = (w - 20) / nc, ch = (h - 40) / nr;
      P.rect(g, x0, top, w, h, wood, { k: 0.12 });
      let back = "", endsA = "", endsB = "", cores = "", tags = "", rims = "";
      for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
        const cx0 = x0 + 10 + c * cw + 4, cy0 = top + 22 + r * ch + 4, iw = cw - 8, ih = ch - 8;
        back += `M${f1(cx0)} ${f1(cy0)}h${f1(iw)}v${f1(ih)}h${f1(-iw)}Z`;
        if (R() < (o.empty ?? 0.06)) continue;
        const rr = Math.min(iw, ih) * 0.17;
        const rows = [[3, 0], [2, 1], [1, 2]];
        const layout = R() < 0.5 ? rows : rows.slice(0, 2);
        for (const [n, k] of layout) for (let i = 0; i < n; i++) {
          const ex = cx0 + iw / 2 + (i - (n - 1) / 2) * rr * 2.05 + (R() - 0.5) * 2, ey = cy0 + ih - rr - 2 - k * rr * 1.8;
          const dd = `M${f1(ex - rr)} ${f1(ey)}a${f1(rr)} ${f1(rr)} 0 1 0 ${f1(2 * rr)} 0a${f1(rr)} ${f1(rr)} 0 1 0 ${f1(-2 * rr)} 0Z`;
          if (R() < 0.55) endsA += dd; else endsB += dd;
          rims += dd;
          cores += `M${f1(ex - rr * 0.28)} ${f1(ey)}a${f1(rr * 0.28)} ${f1(rr * 0.28)} 0 1 0 ${f1(rr * 0.56)} 0a${f1(rr * 0.28)} ${f1(rr * 0.28)} 0 1 0 ${f1(-rr * 0.56)} 0Z`;
          if (R() < 0.14) tags += `M${f1(ex - rr * 0.35)} ${f1(ey + rr * 0.6)}h${f1(rr * 0.7)}v${f1(rr * 1.3)}l${f1(-rr * 0.35)} ${f1(-rr * 0.3)}l${f1(-rr * 0.35)} ${f1(rr * 0.3)}Z`;
        }
      }
      F.el("path", { d: back, fill: K.lg(L, P.col("#2B1C14"), P.col("#46301F"), "v") }, g);
      F.el("path", { d: endsA, fill: K.lg(L, P.col("#F3E8CC"), P.col("#D9C8A0"), "d") }, g);
      F.el("path", { d: endsB, fill: K.lg(L, P.col("#E6D6B0"), P.col("#C8B288"), "d") }, g);
      F.el("path", { d: rims, fill: "none", stroke: P.col("#8E7652"), "stroke-width": 1.1 }, g);
      F.el("path", { d: cores, fill: P.col("#9C8460"), opacity: 0.7 }, g);
      F.el("path", { d: tags, fill: P.col(o.tag || "#B0492F") }, g);
      let fr = "";
      for (let c = 0; c <= nc; c++) fr += `M${f1(x0 + 10 + c * cw)} ${f1(top + 20)}V${f1(y - 16)}`;
      for (let r = 0; r <= nr; r++) fr += `M${f1(x0 + 8)} ${f1(top + 22 + r * ch)}H${f1(x0 + w - 8)}`;
      F.el("path", { d: fr, stroke: P.col(K.lite(wood, 0.08)), "stroke-width": 7, fill: "none" }, g);
      F.el("path", { d: fr, stroke: P.col(K.dark(wood, 0.35)), "stroke-width": 1.2, fill: "none", transform: "translate(2 3)", opacity: 0.6 }, g);
      P.rect(g, x0 - 8, top - 18, w + 16, 24, K.lite(wood, 0.1), { k: 0.15 });
      P.rect(g, x0 - 4, y - 18, w + 8, 18, K.dark(wood, 0.1), { k: 0.12 });
      return { g, top: [x, top], base: [x, y] };
    };

    // a bronze lampstand with an oil lamp burning on top
    set.lampstand = (L, o = {}) => {
      const x = o.x ?? 200, y = o.y ?? 900, h = o.h ?? 520;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.6 });
      const g = P.g(G(L, o, "lampstand"));
      const br = o.color || "#A87B3C";
      P.soft(g, x, y + 2, h * 0.16, h * 0.025, "#20140C", 0.35);
      for (const sx of [-1, 0, 1]) P.stroke(g, `M${x} ${y - h * 0.1}Q${x + sx * h * 0.08} ${y - h * 0.05} ${x + sx * h * 0.13} ${y}`, br, h * 0.014);
      P.rect(g, x - h * 0.008, y - h, h * 0.016, h * 0.92, br, { fill: K.cyl(L, P.col(br)) });
      for (const k of [0.35, 0.62]) P.ellipse(g, x, y - h * k, h * 0.02, h * 0.008, br, { k: 0.2, sw: 1 });
      P.path(g, `M${x - h * 0.09} ${y - h}Q${x} ${y - h * 0.95} ${x + h * 0.09} ${y - h}Z`, br, { k: 0.2 });
      const lamp = S.prop && S.prop.lamp ? S.prop.lamp(L, { parent: g, x, y: y - h + 2, s: h / 900, kind: "ancient" }) : null;
      return { g, top: [x, y - h], lamp };
    };

    // the library interior: warm stone, pigeonhole walls of scrolls between columns, coffered ceiling,
    // a reading table with open scrolls and a lamp, lampstands, light shafts from high windows, dust in the light
    set.library = (L, o = {}) => {
      const g = G(L, o, "library");
      const floorY = o.y ?? 800, vp = o.vp || { x: 960, y: 500 }, seed = o.seed ?? 3;
      const P = K.pen(L, { far: o.far, air: airOf(o), sw: o.sw ?? 1.6 });
      const stone = o.color || "#B98F5E";
      F.el("rect", { x: -900, y: -900, width: W + 1800, height: floorY + 900, "data-cover": "x", fill: K.ulg(L, [[0, P.col(K.dark(stone, 0.5))], [0.35, P.col(K.dark(stone, 0.12))], [1, P.col(K.dark(stone, 0.32))]], 0, -100, 0, floorY) }, g);
      // ceiling beams and coffers
      const ceil = o.ceiling ?? 96;
      F.el("rect", { x: -900, y: -900, width: W + 1800, height: ceil + 900, "data-cover": "x", fill: P.col("#3A2618") }, g);
      for (let bx = -300; bx < W + 300; bx += 160) { P.rect(g, bx, -40, 44, ceil + 40, "#4E3321", { k: 0.2, line: false }); P.rect(g, bx + 60, 10, 80, ceil - 30, "#2E1E14", { line: false, k: 0.1 }); }
      P.rect(g, -900, ceil - 10, W + 1800, 22, "#6B4430", { k: 0.2, line: false });
      // painted frieze band
      P.rect(g, -900, ceil + 12, W + 1800, 26, "#3E6E8E", { line: false, k: 0.08 });
      let fz = "";
      for (let x = -900; x < W + 900; x += 36) fz += `M${x} ${ceil + 38}l18 -26l18 26Z`;
      F.el("path", { d: fz, fill: P.col("#C9A55C"), opacity: 0.85 }, g);
      // high windows with light
      const shaftFrom = o.window || [330, ceil + 70];
      P.rect(g, shaftFrom[0] - 70, ceil + 44, 140, 90, "#FFF1CF", { line: false, fill: K.lg(L, "#FFFBEF", "#FFE2A6", "v") });
      P.rect(g, shaftFrom[0] - 4, ceil + 44, 8, 90, "#6B4430", { line: false });
      // shelves between columns
      const out0 = {};
      const colsX = o.columns || [120, 560, 1360, 1800];
      const bays = [];
      for (let i = 0; i < colsX.length - 1; i++) bays.push([colsX[i], colsX[i + 1]]);
      bays.forEach(([a, b], i) => {
        if (i === 1 && o.door !== false) {
          // the middle bay: a tall doorway onto a bright courtyard (the far light)
          const dx0 = a + 90, dx1 = b - 90, dTop = ceil + 150;
          P.rect(g, dx0 - 30, dTop - 30, dx1 - dx0 + 60, floorY - dTop + 30, K.dark(stone, 0.05), { k: 0.1 });
          F.el("rect", { x: f1(dx0), y: f1(dTop), width: f1(dx1 - dx0), height: f1(floorY - dTop), fill: K.lg(L, "#FFF6E0", "#F2D9A6", "v") }, g);
          for (let k = 0; k < 4; k++) set.column(L, { parent: g, x: dx0 + (k + 0.5) * (dx1 - dx0) / 4, y: floorY - 70, h: (floorY - dTop) * 0.62, order: "ionic", far: 0.55, air: "#FFF1D6" });
          F.el("rect", { x: f1(dx0), y: f1(floorY - 70), width: f1(dx1 - dx0), height: 70, fill: "#EAD2A0" }, g);
          set.glow(L, { parent: g, x: (dx0 + dx1) / 2, y: floorY - 200, r: 520, color: "#FFE9BC", a: 0.55 });
          out0.pool = [(dx0 + dx1) / 2, floorY + 120, dx1 - dx0];
          P.rect(g, dx0 - 30, dTop - 60, dx1 - dx0 + 60, 36, K.lite(stone, 0.1), { k: 0.1 });
          return;
        }
        set.scrollShelf(L, { parent: g, x: (a + b) / 2, y: floorY - 6, w: b - a - 120, h: floorY - ceil - 150, seed: seed + i, far: o.far });
      });
      // floor
      set.courtyard(L, { parent: g, vp, y: floorY, color: o.floorColor || "#A97C50", slab: 170, haze: false, seed });
      F.el("rect", { x: -900, y: floorY, width: W + 1800, height: 40, "data-cover": "x", fill: K.lg(L, "#2A1A10", "#2A1A10", "v", 0.35, 0) }, g);
      // columns in front of the shelves
      colsX.forEach((cx) => set.column(L, { parent: g, x: cx, y: floorY + 10, h: floorY - ceil - 30, order: o.order || "ionic", color: o.columnColor || "#E7D6B4", far: o.far }));
      const out = { g, floor: floorY, vp };
      if (out0.pool) { const [px, py, pw] = out0.pool; F.el("ellipse", { cx: f1(px), cy: f1(py), rx: f1(pw * 0.75), ry: 150, fill: K.soft(L, "#FFE6B0", 0.45), style: "mix-blend-mode:screen" }, g); }
      // light shaft from the high window across to the floor
      if (o.light !== false) out.shaft = set.lightShaft(L, { parent: g, from: [shaftFrom[0], shaftFrom[1] + 20], to: o.lightTo || [760, floorY + 150], w0: 150, w1: 380, a: 0.3, motes: 30, seed });
      // reading table with scrolls, inkpot and a lamp
      if (o.table !== false && S.prop) {
        const tx = o.tableX ?? 960, ty = floorY + 250;
        out.table = S.prop.table(L, { parent: g, x: tx, y: ty, s: 1.05, kind: "work", color: "#7A5236" });
        const top = out.table.top[1];
        S.prop.scroll(L, { parent: g, x: tx - 80, y: top + 6, s: 0.55, open: 1, len: 320, shadow: false });
        S.prop.scroll(L, { parent: g, x: tx + 150, y: top + 4, s: 0.5, open: 0, shadow: false });
        S.prop.inkpot(L, { parent: g, x: tx + 230, y: top + 4, s: 0.45, shadow: false });
        out.lamp = S.prop.lamp(L, { parent: g, x: tx - 250, y: top + 4, s: 1.1, kind: "ancient" });
      }
      if (o.lampstands !== false) {
        out.stands = [set.lampstand(L, { parent: g, x: o.standL ?? 330, y: floorY + 120, h: 470 }), set.lampstand(L, { parent: g, x: o.standR ?? 1600, y: floorY + 120, h: 470 })];
        out.stands.forEach((st) => st.lamp && set.glow(L, { parent: g, x: st.top[0] + 20, y: st.top[1] - 20, r: 460, color: "#FFC77A", a: 0.55, flicker: 0.08 }));
      }
      if (out.lamp) set.glow(L, { parent: g, x: out.lamp.flame[0], y: out.lamp.flame[1] - 20, r: 520, color: "#FFC98A", a: 0.5, flicker: 0.1 });
      if (o.vignette !== false) set.vignette(L, { parent: g, a: o.vignette ?? 0.78 });
      return out;
    };

    // darker, warmer edges (drawn in the layer, so it moves with the room): a baked radial gradient
    set.vignette = (L, o = {}) => {
      const g = G(L, o, "vignette");
      const c = o.color || "#1E120A", a = o.a ?? 0.4, x = o.x ?? 960, y = o.y ?? 560;
      F.el("rect", { x: -900, y: -900, width: W + 1800, height: H + 1800, "data-cover": "1",
        fill: K.urg(L, [[0, c, 0], [0.38, c, 0], [0.58, c, a * 0.18], [0.8, c, a * 0.6], [1, c, a]], x, y, o.r ?? 1150, { gradientTransform: `translate(${x} ${y}) scale(1 ${o.squash ?? 0.72}) translate(${-x} ${-y})` }) }, g);
      return { g };
    };

    // ══════════════════════════════════════════════════════════════════════════════
    //  ALIASES (interior furniture lives in props.js)
    // ══════════════════════════════════════════════════════════════════════════════
    set.lamp = (L, o = {}) => S.prop.lamp(L, o);
    set.table = (L, o = {}) => S.prop.table(L, o);
    set.chair = (L, o = {}) => S.prop.chair(L, o);
    set.candle = (L, o = {}) => S.prop.candle(L, o);

    // ══════════════════════════════════════════════════════════════════════════════
    //  STAGES — a whole parallax composition from one call (sky / far / mid / ground / fg layers)
    // ══════════════════════════════════════════════════════════════════════════════
    set.stage = (kind = "desert", o = {}) => {
      const seed = o.seed ?? 1, time = o.time || "day";
      const lay = (name, p, blur) => S.layer({ p, name: (o.prefix || "") + name, blur });
      const out = { kind, layers: {} };
      const Ls = out.layers;
      const skyKind = time === "night" ? "night" : time;
      const withFg = o.fg !== false;
      const sky = (hz, extra) => { Ls.sky = lay("sky", 0.08); out.sky = set.sky(Ls.sky, Object.assign({ kind: skyKind, horizon: hz, seed }, extra || {})); };
      if (kind === "desert" || kind === "nile") {
        sky(610, { clouds: 4, sun: time === "day" ? { x: 1540, y: 220, r: 46 } : undefined });
        Ls.far = lay("far", 0.3, 1.2);
        set.dunes(Ls.far, { y: 545, n: 2, h: 150, floor: false, seed: seed + 1, airFar: 0.55 });
        set.haze(Ls.far, { kind: "up", y: 605, h: 110, below: 40, a: 0.45, fade: 0 });
        Ls.mid = lay("mid", 0.62);
        if (kind === "nile") set.river(Ls.mid, { y: 615, h: 115, palms: 9, reeds: 4, seed });
        else set.dunes(Ls.mid, { y: 640, n: 2, h: 200, floor: false, seed: seed + 2, airFar: 0.2 });
        Ls.ground = lay("ground", 1);
        const dn = set.dunes(Ls.ground, { y: kind === "nile" ? 770 : 760, n: 1, h: 90, floor: false, seed: seed + 3, width: 1400, bushes: 5 });
        if (o.palms !== false) { set.palm(Ls.ground, { x: 1560, y: 900, h: 600, seed: seed + 4, lean: 0.12 }); set.palm(Ls.ground, { x: 1740, y: 925, h: 450, seed: seed + 5, lean: 0.2 }); }
        out.floor = dn.floor; out.surface = dn.surface;
        if (withFg) { Ls.fg = lay("fg", 1.45, 7); set.grass(Ls.fg, { x: 170, y: 1130, w: 520, h: 430, seed: seed + 6 }); }
      } else if (kind === "beach") {
        sky(560, { clouds: 3, sun: time === "day" ? { x: 1500, y: 200, r: 44 } : undefined });
        Ls.mid = lay("mid", 0.55);
        set.beach(Ls.mid, { y: 560, shore: 600, seed });
        S.prop && S.prop.flock(Ls.mid, { area: [1100, 380, 700, 120], n: 7, seed });
        Ls.ground = lay("ground", 1);
        const dn = set.dunes(Ls.ground, { y: 720, n: 1, floor: false, seed: seed + 3, bumps: [{ x: 120, w: 1500, h: 250 }, { x: 1500, w: 2000, h: 60 }] });
        set.tufts(Ls.ground, { n: 30, y0: 600, y1: 1040, seed, color: "#9C9A5E" });
        set.footprints(Ls.ground, { from: [900, 1070], to: [1200, 760], n: 16, color: "#C9A870" });
        out.floor = 860; out.surface = dn.surface;
        if (withFg) { Ls.fg = lay("fg", 1.45, 6); set.grass(Ls.fg, { x: 200, y: 1120, w: 560, h: 460, seed: seed + 6 }); set.grass(Ls.fg, { x: 1800, y: 1140, w: 360, h: 380, seed: seed + 7 }); }
      } else if (kind === "flats") {
        sky(560, { kind: "overcast" });
        Ls.far = lay("far", 0.35, 1);
        set.dunes(Ls.far, { y: 555, n: 1, h: 60, floor: false, seed, color: "#B9A983", airFar: 0.6, far: 0.4 });
        Ls.ground = lay("ground", 1);
        set.flats(Ls.ground, { y: 560, seed });
        out.floor = 760;
        if (withFg) { Ls.fg = lay("fg", 1.5, 9); set.grass(Ls.fg, { x: 260, y: 1150, w: 620, h: 420, kind: "dry", color: "#6E6448", seed }); set.grass(Ls.fg, { x: 1700, y: 1150, w: 520, h: 360, kind: "dry", color: "#6E6448", seed: seed + 3 }); }
      } else if (kind === "hills" || kind === "mountains") {
        sky(640, { clouds: 4 });
        if (kind === "mountains") { Ls.far = lay("far", 0.2, 0.8); set.mountains(Ls.far, { y: 600, snow: true, seed }); }
        Ls.mid = lay("mid", 0.5);
        set.hills(Ls.mid, { y: kind === "mountains" ? 660 : 600, n: 3, seed });
        Ls.ground = lay("ground", 1);
        set.ground(Ls.ground, { y: 820, kind: "grass", seed });
        set.tree(Ls.ground, { x: 1550, y: 900, h: 520, seed: seed + 2 });
        out.floor = 900;
        if (withFg) { Ls.fg = lay("fg", 1.45, 6); set.grass(Ls.fg, { x: 200, y: 1120, w: 520, h: 360, kind: "meadow", seed }); }
      } else if (kind === "farmland") {
        sky(300, { clouds: 0, sun: false });
        Ls.far = lay("far", 0.15);
        set.farmland(Ls.far, { horizon: 300, seed });
        Ls.mid = lay("clouds", 0.45, 2);
        set.clouds(Ls.mid, { n: 5, horizon: 1300, area: [-300, 300, 2520, 1100], size: 620, seed: seed + 4, drift: 16 });
        out.floor = null;
      } else if (kind === "fieldsAbove" || kind === "desertAbove") {
        Ls.ground = lay("ground", 1);
        if (kind === "fieldsAbove") set.farmland(Ls.ground, { view: "above", river: true, seed }); else set.desertAbove(Ls.ground, { seed, tufts: true });
        if (withFg) { Ls.fg = lay("clouds", 1.6, 10); set.clouds(Ls.fg, { n: 3, horizon: 1600, area: [-400, 200, 2700, 1400], size: 800, seed, drift: 30, far: 0 }); Ls.fg.opacity = 0.7; }
      } else if (kind === "street") {
        sky(560, { clouds: 3, sun: { x: 1170, y: 470, r: 42 } });
        Ls.ground = lay("ground", 1);
        out.street = set.street(Ls.ground, { vp: { x: 1170, y: 520 }, seed });
        out.floor = 1000;
        if (withFg) { Ls.fg = lay("fg", 1.5, 6); set.lampPost(Ls.fg, { x: 1860, y: 1500, h: 1500 }); }
      } else if (kind === "courtyard") {
        sky(560, { clouds: 4, sun: { x: 380, y: 150, r: 44 } });
        Ls.mid = lay("mid", 0.55);
        set.temple(Ls.mid, { x: 1250, y: 560, w: 760, h: 440, far: 0.12 });
        set.tree(Ls.mid, { x: 1720, y: 560, h: 330, kind: "cypress", far: 0.15 });
        Ls.ground = lay("ground", 1);
        set.courtyard(Ls.ground, { vp: { x: 1180, y: 470 }, y: 560, slab: 190, seed });
        set.colonnade(Ls.ground, { view: "perspective", vp: { x: 1180, y: 470 }, near: { x: 180, y: 1040, h: 900 }, n: 9, gap: 0.6 });
        out.floor = 900;
        if (withFg && S.prop) { Ls.fg = lay("fg", 1.35, 6); S.prop.amphora(Ls.fg, { x: 1760, y: 1180, s: 1.5 }); }
      } else if (kind === "harbour") {
        sky(560, { clouds: 3 });
        Ls.mid = lay("mid", 0.6);
        set.harbour(Ls.mid, { y: 560, seed });
        out.floor = null;
      } else if (kind === "space" || kind === "orbit") {
        Ls.sky = lay("stars", 0.05);
        set.starfield(Ls.sky, { seed });
        Ls.far = lay("moon", 0.15);
        // a full moon upper left unless o.moon === false (or o.moon = {x, y, r}); o.sun = {x, y, r} draws the sun instead
        if (o.moon !== false && !o.sun) out.moon = set.moon(Ls.far, Object.assign({ x: 330, y: 250, r: 70, phase: "full" }, typeof o.moon === "object" ? o.moon : {}));
        if (o.sun) { out.sun = set.sun(Ls.far, Object.assign({ r: 46, bloom: 14 }, o.sun)); set.glow(Ls.far, { x: o.sun.x, y: o.sun.y, r: 520, color: "#FFE8C0", a: 0.6 }); }
        Ls.mid = lay("earth", 0.35);
        out.earth = kind === "orbit" ? set.earth(Ls.mid, { x: 960, y: 1650, r: 1200, lon: 20, tilt: 35, spin: 1 }) : set.earth(Ls.mid, { x: 1340, y: 640, r: 420, lon: 15, spin: 3 });
      } else if (kind === "moon") {
        Ls.sky = lay("sky", 0.05);
        set.sky(Ls.sky, { kind: "void", horizon: 700, seed });
        Ls.far = lay("earth", 0.15);
        out.earth = set.earth(Ls.far, { x: 1480, y: 200, r: 110, lon: -40, tilt: 20 });
        Ls.ground = lay("ground", 1);
        set.lunarSurface(Ls.ground, { y: 580, seed });
        out.floor = 760;
      } else if (["library", "parlour", "workshop", "train"].includes(kind)) {
        Ls.room = lay("room", 0.85);
        out.room = set[kind](Ls.room, { seed });
        Ls.ground = Ls.room;
        out.floor = kind === "train" ? 670 : 900;
        if (withFg && S.prop) {
          Ls.fg = lay("fg", 1.4, 8);
          if (kind === "library") S.set.column(Ls.fg, { x: -60, y: 1300, h: 1500, order: "ionic", color: "#D9C39A" });
          else if (kind === "parlour") S.prop.chair(Ls.fg, { x: 1760, y: 1250, s: 1.6, kind: "armchair", flip: true });
          else if (kind === "workshop") S.prop.barrel(Ls.fg, { x: 120, y: 1250, s: 1.5 });
        }
      } else throw new Error("S.set.stage: unknown kind " + kind);
      if (o.motes && S.motes && Ls.ground) S.motes(Ls.ground, { n: 30, seed });
      out.ground = Ls.ground || Ls.mid;
      // every stage answers to the same names: a plane it did not build is the nearest one it did (so a program
      // never reads .g of undefined), and the foreground plane always exists, empty and blurred, ready to frame with
      const near = { sky: ["far", "mid", "room", "ground"], far: ["mid", "sky", "room", "ground"],
                     mid: ["far", "room", "ground", "sky"], ground: ["room", "mid", "far", "sky"] };
      for (const [k, alts] of Object.entries(near)) if (!Ls[k]) { const a = alts.find((x) => Ls[x]); if (a) Ls[k] = Ls[a]; }
      if (!Ls.fg) Ls.fg = lay("fg", 1.4, 7);
      out.layers = Ls;
      return out;
    };
  });
})();
