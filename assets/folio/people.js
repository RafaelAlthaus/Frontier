/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * FOLIO people — the character rig. Cut-out puppets in the look of the reference: slim 5.8-head figures,
 * big anime eyes, a visible ear in 3/4, flat fills with a shadow side and a cream rim line, no black lines.
 *
 *   const P = S.person(def, layer, {x, y, h, face, pose, shadow});
 *
 * def — the character, written once per video and reused in every shot (the same def draws the same person):
 *   { id, sex: "m"|"f", age: "child"|"young"|"adult"|"old", build: "slim"|"average"|"heavy", skin: "#F2CBAC",
 *     hair:   { style: "short"|"sidepart"|"balding"|"bald"|"curly"|"wavy"|"long"|"bun"|"bob"|"braid"|"ponytail", color },
 *     facial: { moustache: "none"|"walrus"|"thin"|"handlebar", beard: "none"|"stubble"|"short"|"full"|"long"|"goatee", color },
 *     eyes: "#5E80A4",
 *     outfit: { kind, main, second, accent },   kind → what the three colours paint:
 *        suit: jacket+trousers / vest / tie        coat: coat / trousers / –          labcoat: coat / trousers / tie
 *        uniform: tunic+trousers / belt / buttons  shirt: trousers / shirt / belt     work: trousers / shirt (rolled sleeves) / apron
 *        casual: trousers / top / –               robe: robe / sash+trim / –         toga: tunic / draped mantle / –
 *        tunic: knee tunic / belt / –              kilt: kilt (bare chest) / – / collar   dress: 1900s dress / blouse collar+cuffs / belt
 *        gown: floor gown / trim / belt            (any colour may be left out: sensible defaults per kind)
 *     hat: "none"|"bowler"|"flatcap"|"tophat"|"fedora"|"wreath"|"headcloth"|"bonnet"|"cap"|"helmet", glasses: false,
 *     footwear: "shoes"|"boots"|"sandals"|"bare" }
 *   Unknown fields are ignored, missing ones get defaults (a woman gets a bun and a dress, "old" gets grey balding hair).
 *
 * placement — x, y: the ground point between the feet, in layer coordinates (for "sit": the floor under the seat's front
 *   edge). h: standing height in px (full figure 450–700 in a wide shot; a child ~0.7 of an adult; it still reads at
 *   h≈150). The camera may push in to a head of ~300 px (h≈1700 on screen) — detail holds.
 *   face: "right" | "left" (3/4 views, the main ones) | "front" | "profile-right" | "profile-left" (side views for walking,
 *   running, cycling). One person = one <g> (P.g) in its layer; people created later draw in front.
 *
 * TIMELINE — call in build(); everything is a pure function of time (any frame can be rendered in any order).
 *   P.pose(name, t0, dur = 0.5, {arm, rpm})   blend (smooth) into a pose:
 *     stand · walk (cycle in place) · run (in place) · point · raise (arm up, holding) · reach (both arms up) ·
 *     hold (both hands at the chest, for P.between()) · think (hand on chin) · crossed · sit · write (seated, forearm on a
 *     table ~0.2·h above the seat) · kneel · crouch · lie (prone, head toward the facing side) · wave · hammer (swing loop) ·
 *     look-up · shrug · present (open palm) · ride (on a bicycle: P.bikeAt(t) gives the geometry, rpm option)
 *     One-armed poses use the "left" arm (the facing side): point, raise, wave, present; the "right" arm: think, hammer,
 *     write. {arm: "right"|"left"} swaps. A new pose blends from whatever the body is doing (also mid-walk).
 *   P.walk(t0, t1, x0, x1, y0?, y1?)   walk between two ground points: steps timed to the distance (stride ≈0.28 h,
 *     ~1.05 s per two steps, faster when the time is short), feet planted (no sliding), heel-off and heel-strike, body
 *     bob, arm swing, slight lean; turns the person to face the walk (3/4, or profile if in profile); ends standing.
 *     The upper body keeps its pose (walk while holding: P.pose("hold") first). Pass null for x0/y0 to start where P is.
 *     {h: px} as a 7th argument scales the person along the way (walking into depth: y and h change together).
 *   P.run(t0, t1, x0, x1, y0?, y1?, {h})   the same, running.
 *   P.move([[t, x, y, h?], …])        any other movement of the feet point (a ride, a lift); no steps.
 *   P.face(dir, t0)                    switch view at t0 (a cut-like turn).     P.set({x, y, h, face})   base placement.
 *   P.look(dir, t0, dur = 0.3)        head + eyes: "left" | "right" (screen directions) | "up" | "down" | "camera" |
 *                                      "ahead" | [x, y] a world point (followed every frame, e.g. another person's P.headAt(t)).
 *   P.expr(name, t0, dur = 0.25)      neutral | smile | laugh | surprised | worried | focused | sad | determined
 *   P.talk(t0, t1, amount = 1)         mouth flaps ~5 Hz with noise (not lip sync).   P.blink(t0) an extra blink.
 *   Automatic: blinks every 2.5–5 s (deterministic per id), breathing, a tiny idle sway (never moves the feet).
 *
 * PROPS
 *   P.hand("right"|"left", {upright, grip}) → <g> that follows the palm every frame; draw the prop in px at the size you
 *     want it in the layer. Origin = palm centre. Rotation follows the forearm: +y runs along the forearm toward the
 *     fingertips, +x points out of the thumb side of the fist (up when the forearm points forward). So a hammer, torch,
 *     stick or pencil held in the fist is drawn along +x (its handle end slightly at −x); the fingers are drawn OVER the
 *     prop automatically (the hand becomes a grip). {upright: true}: no rotation — for things carried upright (a lamp, a
 *     basket on a raised hand, a scroll). {grip: false}: keep the pose's hand shape. Props mirror with the person (no text).
 *   P.handFront(side) → <g> drawn above the fingers (same frame), for bits that must cover the hand.
 *   P.between() → <g> centred between both palms, x axis from the "right" palm to the "left" one: a box, a board, a
 *     model held in both hands with the "hold" pose. P.span(t) = the distance between the palms in px (schedule the pose
 *     first, then ask at a time when it has arrived, e.g. const w = P.span(t0 + 1)).
 *   "right" = the near arm (in front of the body in 3/4 and profile, the screen-left arm facing front); "left" = the far
 *   arm on the facing side. Facing left mirrors the drawing, so the names stay with the picture, not the anatomy.
 *
 * QUERIES (world px, pure functions of t)
 *   P.at(t) → [x, y] feet point        P.headAt(t) → [x, y] just above the head (hat included) — for name labels
 *   P.handAt(side, t) → palm point     P.seatAt(t) → the seat's front-top corner under a seated person
 *   P.bikeAt(t) → {crank:[x,y], r, pedals:[[x,y],[x,y]], seat:[x,y], bar:[x,y], angle, k, m} for drawing a bicycle
 *   S.people → every person in the shot.   FOLIO.people.POSES / EXPR / HAIRS / HATS / OUTFITS → the name lists.
 *
 * Example
 *   const W = S.person({ id: "wilbur", build: "slim", hair: { style: "balding", color: "#4A3426" },
 *                        outfit: { kind: "suit", main: "#3B4151" }, hat: "flatcap" }, cast, { x: -150, y: 960, h: 640 });
 *   W.walk(0, 2.6, -150, 720); W.pose("raise", 2.8, 0.5); W.look("up", 2.8); W.expr("smile", 3);
 *   F.svg(`<rect x="-40" y="-90" width="80" height="60" fill="#E9D9B0"/>`, W.hand("left", { upright: true }));
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const F = window.FOLIO;
  if (!F) return;
  F.plugins = F.plugins || [];
  const el = F.el, clamp = F.clamp, lerp = F.lerp;
  const RAD = Math.PI / 180;

  // ══════════════════════════════════════════════════════════════════════════════════
  //  small maths + path helpers
  // ══════════════════════════════════════════════════════════════════════════════════
  const N = (v) => { const r = Math.round(v * 100) / 100; return r === 0 ? "0" : String(r); };
  const P = (p) => N(p[0]) + " " + N(p[1]);
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const mix2 = (a, b, p) => [lerp(a[0], b[0], p), lerp(a[1], b[1], p)];
  const vlen = (a) => Math.hypot(a[0], a[1]);
  const unit = (a) => { const l = vlen(a) || 1e-9; return [a[0] / l, a[1] / l]; };
  const perp = (a) => [-a[1], a[0]];
  const rot = (p, deg) => { const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
  const dirA = (deg) => [Math.sin(deg * RAD), Math.cos(deg * RAD)];      // angle from straight down, + toward +x (forward)
  const angOf = (v) => Math.atan2(v[0], v[1]) / RAD;
  const sm = F.smooth;
  const smr = (p) => F.smoother(p);

  // closed / open Catmull-Rom through points [x, y, corner?] → cubic path
  function crv(pts, closed, tens = 1) {
    const n = pts.length;
    if (n < 2) return "";
    const g = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    let d = "M" + P(pts[0]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      const k1 = p1[2] ? 0 : tens / 6, k2 = p2[2] ? 0 : tens / 6;
      const c1 = [p1[0] + (p2[0] - p0[0]) * k1, p1[1] + (p2[1] - p0[1]) * k1];
      const c2 = [p2[0] - (p3[0] - p1[0]) * k2, p2[1] - (p3[1] - p1[1]) * k2];
      d += "C" + P(c1) + " " + P(c2) + " " + P(p2);
    }
    return closed ? d + "Z" : d;
  }
  const poly = (pts) => "M" + pts.map(P).join("L") + "Z";
  // a tapered stroke as a filled outline: centre points + full widths per point
  function taper(pts, ws) {
    const n = pts.length, A = [], B = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const nn = unit(perp(sub(b, a))), w = ws[i] / 2;
      A.push(add(pts[i], mul(nn, w))); B.push(sub(pts[i], mul(nn, w)));
    }
    A[0][2] = 1; B[0][2] = 1; A[n - 1][2] = 1; B[n - 1][2] = 1;
    if (ws[0] < 0.25) { A[0] = pts[0].slice(0, 2).concat([1]); B.shift(); }
    return crv(A.concat(B.reverse()), true);
  }
  const arcPts = (cx, cy, rx, ry, a0, a1, step = 12) => {
    const out = [], n = Math.max(1, Math.round(Math.abs(a1 - a0) / step));
    for (let i = 0; i <= n; i++) { const a = (a0 + ((a1 - a0) * i) / n) * RAD; out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    return out;
  };
  const ell = (cx, cy, rx, ry) => `M${N(cx - rx)} ${N(cy)}A${N(rx)} ${N(ry)} 0 1 0 ${N(cx + rx)} ${N(cy)}A${N(rx)} ${N(ry)} 0 1 0 ${N(cx - rx)} ${N(cy)}Z`;
  const tr = (x, y, r = 0, s = 1, sy) => `translate(${N(x)} ${N(y)})` + (r ? ` rotate(${N(r)})` : "") + (s !== 1 || (sy != null && sy !== s) ? ` scale(${N(s)} ${N(sy ?? s)})` : "");

  // outline of a two-bone limb A→B→C (widths at A, B, C); round outside the joint, a crease inside,
  // a round cap at A, flat (or round) at C — bending never opens a gap
  function limb(A, B, C, wa, wb, wc, capC) {
    let d1 = sub(B, A), d2 = sub(C, B);
    const l1 = vlen(d1), l2 = vlen(d2);
    d1 = l1 > 1e-6 ? mul(d1, 1 / l1) : [0, 1];
    d2 = l2 > 1e-6 ? mul(d2, 1 / l2) : d1;
    const n1 = perp(d1), n2 = perp(d2);
    const cr = d1[0] * d2[1] - d1[1] * d2[0];
    const ra = wa / 2, rb = wb / 2, rc = wc / 2;
    const side = (s) => ({ a: add(A, mul(n1, s * ra)), b1: add(B, mul(n1, s * rb)), b2: add(B, mul(n2, s * rb)), c: add(C, mul(n2, s * rc)) });
    const S1 = side(1), S2 = side(-1);
    const straight = Math.abs(cr) < 0.02 && d1[0] * d2[0] + d1[1] * d2[1] > 0;
    const inner = cr > 0 ? 1 : -1;
    const meet = (Sx) => {
      const r = sub(Sx.b1, Sx.a), q = sub(Sx.b2, Sx.c);
      const den = r[0] * q[1] - r[1] * q[0];
      if (Math.abs(den) < 1e-6) return mix2(Sx.b1, Sx.b2, 0.5);
      const w = sub(Sx.c, Sx.a);
      const t = (w[0] * q[1] - w[1] * q[0]) / den, u = (w[0] * r[1] - w[1] * r[0]) / den;
      if (t < 0.25 || u < 0.25 || t > 1.05 || u > 1.05) return mix2(Sx.b1, Sx.b2, 0.5);
      return add(Sx.a, mul(r, t));
    };
    const sweep = (p, q) => { const a = sub(p, B), b = sub(q, B); return a[0] * b[1] - a[1] * b[0] > 0 ? 1 : 0; };
    let d = "M" + P(S1.a);
    if (straight) d += "L" + P(S1.b1);
    else if (inner === 1) d += "L" + P(meet(S1));
    else d += "L" + P(S1.b1) + `A${N(rb)} ${N(rb)} 0 0 ${sweep(S1.b1, S1.b2)} ` + P(S1.b2);
    d += "L" + P(S1.c);
    if (capC) d += `A${N(rc)} ${N(rc)} 0 0 0 ` + P(S2.c); else d += "L" + P(S2.c);
    if (straight) d += "L" + P(S2.b2);
    else if (inner === -1) d += "L" + P(meet(S2));
    else d += "L" + P(S2.b2) + `A${N(rb)} ${N(rb)} 0 0 ${sweep(S2.b2, S2.b1)} ` + P(S2.b1);
    d += "L" + P(S2.a) + `A${N(ra)} ${N(ra)} 0 0 0 ` + P(S1.a) + "Z";
    return d;
  }

  // two-bone IK: returns the middle joint; bend = +1 puts the joint on the +x (forward) side of the chord
  function ik2(A, T, l1, l2, bend) {
    let dx = T[0] - A[0], dy = T[1] - A[1];
    let d = Math.hypot(dx, dy);
    const mx = l1 + l2 - 0.01, mn = Math.abs(l1 - l2) + 0.01;
    if (d > mx) { dx *= mx / d; dy *= mx / d; d = mx; }
    if (d < mn) { const k = mn / Math.max(d, 1e-6); dx *= k; dy *= k; d = mn; }
    const a = Math.atan2(dy, dx);
    const c = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const ang = a - bend * Math.acos(c);
    return [A[0] + l1 * Math.cos(ang), A[1] + l1 * Math.sin(ang)];
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  //  colours + the character definition
  // ══════════════════════════════════════════════════════════════════════════════════
  const DARK = "#1f130c";
  const lum = (c) => { const [r, g, b] = F.hex(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  function skinSet(c) {
    const [r, g, b] = F.hex(c);
    return {
      base: c, lit: F.mix(c, "#FFF6EE", 0.12), shade: F.rgb([r * 0.9, g * 0.8, b * 0.79]), deep: F.rgb([r * 0.8, g * 0.64, b * 0.62]),
      ink: F.mix(c, "#3a1206", 0.68), blush: F.mix(c, "#EC6B60", 0.62), line: F.mix(c, "#3a1206", 0.52),
    };
  }
  function cloth(c) {
    const L = lum(c);
    return {
      base: c, lit: F.mix(c, "#FFFFFF", L > 0.75 ? 0.3 : 0.07), shade: F.mix(c, "#2a1c14", L > 0.75 ? 0.17 : 0.3),
      ink: F.mix(c, DARK, L > 0.75 ? 0.5 : 0.58), rim: F.mix(c, "#FFF1D8", L > 0.75 ? 0.5 : 0.6),
      fold: F.mix(c, DARK, L > 0.75 ? 0.28 : 0.38),
    };
  }
  function hairSet(c) {
    const L = lum(c);
    return { base: c, hi: F.mix(c, "#FFF4E2", L > 0.7 ? 0.45 : 0.24), shade: F.mix(c, DARK, 0.22), ink: F.mix(c, DARK, L > 0.7 ? 0.55 : 0.6), strand: F.mix(c, DARK, 0.4) };
  }

  const OUTFITS = {
    suit:    { main: "#3B4151", second: null, accent: "#2B2730" },
    robe:    { main: "#8A6E57", second: "#C9A66A", accent: "#5E3F2A" },
    toga:    { main: "#EFE8D6", second: "#E3D8BE", accent: "#7B4A6A" },
    tunic:   { main: "#A7825C", second: "#5B3E27", accent: "#C9A86A" },
    kilt:    { main: "#EEE8D8", second: "#C79F52", accent: "#3D7A8B" },
    dress:   { main: "#6A5578", second: "#F2EDE3", accent: "#3D2E47" },
    shirt:   { main: "#4A4139", second: "#ECE5D6", accent: "#6A4A32" },
    work:    { main: "#4C4A4D", second: "#8FA6C0", accent: "#CDAE7E" },
    coat:    { main: "#5A4636", second: "#3A3430", accent: "#8C2F2A" },
    uniform: { main: "#47523D", second: "#4A3522", accent: "#D6B25A" },
    labcoat: { main: "#F1F1EC", second: "#46505E", accent: "#3C5A8A" },
    casual:  { main: "#46597A", second: "#C65A48", accent: "#EAE4DA" },
    gown:    { main: "#7A2E3A", second: "#E9D8B4", accent: "#C9A24A" },
  };
  const HAIRS = ["short", "sidepart", "balding", "bald", "curly", "wavy", "long", "bun", "bob", "braid", "ponytail"];
  const HATS = ["none", "bowler", "flatcap", "tophat", "fedora", "wreath", "headcloth", "bonnet", "cap", "helmet"];

  function normDef(d0) {
    const d = Object.assign({}, d0 || {});
    d.id = String(d.id || "person");
    d.sex = d.sex === "f" ? "f" : "m";
    d.age = ["child", "young", "adult", "old"].includes(d.age) ? d.age : "adult";
    d.build = ["slim", "average", "heavy"].includes(d.build) ? d.build : "average";
    d.skin = /^#[0-9a-f]{3,6}$/i.test(d.skin || "") ? d.skin : "#F2CBAC";
    const hair = typeof d.hair === "string" ? { style: d.hair } : Object.assign({}, d.hair || {});
    if (!HAIRS.includes(hair.style)) hair.style = d.sex === "f" ? "bun" : d.age === "old" ? "balding" : "short";
    hair.color = hair.color || (d.age === "old" ? "#DAD6CE" : "#4A3426");
    d.hair = hair;
    const fac = Object.assign({ moustache: "none", beard: "none" }, d.facial || {});
    fac.color = fac.color || hair.color;
    if (d.sex === "f" || d.age === "child") { fac.moustache = d0 && d0.facial && d0.facial.moustache || "none"; fac.beard = d0 && d0.facial && d0.facial.beard || "none"; }
    d.facial = fac;
    d.eyes = d.eyes || "#5E80A4";
    const of = typeof d.outfit === "string" ? { kind: d.outfit } : Object.assign({}, d.outfit || {});
    if (!OUTFITS[of.kind]) of.kind = d.sex === "f" ? "dress" : "suit";
    const od = OUTFITS[of.kind];
    of.main = of.main || od.main; of.second = of.second || od.second; of.accent = of.accent || od.accent;
    d.outfit = of;
    d.hat = HATS.includes(d.hat) ? d.hat : "none";
    d.glasses = !!d.glasses;
    d.footwear = ["shoes", "boots", "sandals", "bare"].includes(d.footwear) ? d.footwear
      : ({ toga: "sandals", robe: "sandals", kilt: "bare", tunic: "sandals" }[of.kind] || "shoes");
    return d;
  }

  // body proportions (body units: 1000 = standing height, ground y = 0, up is −y)
  function proportions(d) {
    const child = d.age === "child", fem = d.sex === "f";
    const b = { slim: 0.9, average: 1, heavy: 1.2 }[d.build];
    const P0 = child
      ? { head: 236, chin: 764, neckBase: 748, hip: 420, thigh: 190, shin: 192, ankle: 38, upper: 146, fore: 128, handS: 0.84,
          neckW: [50, 45], armW: [58, 50, 44], legW: [74, 64, 58], shX: 1.02, hipX: 1.05, stride: 250 }
      : { head: 172, chin: 828, neckBase: 806, hip: 480, thigh: 225, shin: 215, ankle: 40, upper: 176, fore: 158, handS: 0.86,
          neckW: [56, 50], armW: [52, 44, 38], legW: [70, 60, 54], shX: 1, hipX: 1, stride: 280 };
    if (fem && !child) Object.assign(P0, { neckW: [46, 41], armW: [44, 38, 32], legW: [60, 50, 42], shX: 0.88, hipX: 1.05, handS: 0.78 });
    if (d.age === "old") P0.stride = 250;
    P0.torso = P0.neckBase - P0.hip;
    P0.sy = P0.torso / 298;                 // the torso drawing is authored for an adult (298 units)
    P0.sx = 1.38 * P0.shX * (b === 1.2 ? 1.16 : b === 0.9 ? 0.95 : 1);
    P0.b = b;
    P0.armW = P0.armW.map((w) => w * (b === 1.2 ? 1.15 : b));
    P0.legW = P0.legW.map((w) => w * (b === 1.2 ? 1.15 : b));
    P0.hs = P0.head / 100;                  // head units → body units
    return P0;
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  //  heads (head units: crown y = −100, chin y = 0; views: "3q" (facing +x), "front", "side")
  // ══════════════════════════════════════════════════════════════════════════════════
  const HEAD = {
    "3q": {
      face: [[-4, -101], [13, -97.5], [25.5, -89], [32.4, -77], [34.8, -64], [34.9, -52], [33.8, -42], [31.8, -33.5], [29, -25],
        [25.2, -16], [20.2, -7.8], [15.2, -2.4], [11, 0], [6.4, -1], [-0.6, -4.2], [-8.6, -9.6], [-16.6, -16.4], [-23.6, -24], [-29, -31.4],
        [-33.8, -37.6], [-39, -43.6], [-44.2, -51.4], [-46.4, -60], [-44.4, -76], [-35.4, -90.5], [-21, -99.3]],
      sx: 0.95,
      faceRound: [[-4, -101], [13, -97.5], [25.5, -89], [32.4, -77], [34.8, -64], [35, -52], [34.4, -42], [33, -33], [30.4, -24.6], [26.6, -16],
        [21.4, -8.2], [15.6, -2.6], [9.6, 0], [3.6, -0.8], [-3.6, -3.6], [-11.4, -8.6], [-18.6, -15], [-25, -22.4], [-30.4, -30], [-34.4, -37.2],
        [-39, -43.6], [-44.2, -51.4], [-46.4, -60], [-44.4, -76], [-35.4, -90.5], [-21, -99.3]],
      ear: { cx: -21.4, cy: -50.6, s: 1 },
      eyes: [{ cx: 0.5, cy: -48.4, t: "near" }, { cx: 24.6, cy: -48, t: "far" }],
      brows: [{ cx: 0.4, cy: -61.2, t: "near" }, { cx: 25.2, cy: -60.8, t: "far" }],
      nose: "M26.8 -38.6C27.8 -35.4 27.8 -32.6 26 -30.2",
      noseTip: [22.6, -27.6, 3.6, 2.4],
      mouth: [12.6, -13.2, 1],
      blush: [[-5.4, -34.4, 10, 5.4], [26.4, -33.6, 4, 3]],
      pivot: [-9, -16],
      neckTop: [[-25, -24], [5, -6]],
      shadowOff: [-13, -4.6],
      jaw: [[-12.5, -46], [-13, -32], [-8, -18], [2, -7], [12, -3], [22, -8], [29, -17], [32.5, -27]],
    },
    front: {
      face: [[0, -101], [18.5, -97.5], [31.5, -88], [37.5, -74], [39, -60], [37.8, -47], [35.4, -35], [31.4, -23.5], [25.4, -12.5],
        [17.5, -4.5], [8.4, -0.6], [0, 0.6], [-8.4, -0.6], [-17.5, -4.5], [-25.4, -12.5], [-31.4, -23.5], [-35.4, -35], [-37.8, -47],
        [-39, -60], [-37.5, -74], [-31.5, -88], [-18.5, -97.5]],
      faceRound: [[0, -101], [18.5, -97.5], [31.5, -88], [37.5, -74], [39, -60], [38.4, -47], [36.6, -35], [33.2, -24], [28, -13.5], [20.4, -5.2],
        [10.4, -0.8], [0, 0.4], [-10.4, -0.8], [-20.4, -5.2], [-28, -13.5], [-33.2, -24], [-36.6, -35], [-38.4, -47], [-39, -60], [-37.5, -74],
        [-31.5, -88], [-18.5, -97.5]],
      ears: [{ cx: -38.2, cy: -49.5, s: -1 }, { cx: 38.2, cy: -49.5, s: 1 }],
      eyes: [{ cx: -15.2, cy: -48.6, t: "frontR" }, { cx: 15.2, cy: -48.6, t: "frontL" }],
      brows: [{ cx: -15.4, cy: -60.4, t: "frontR" }, { cx: 15.4, cy: -60.4, t: "frontL" }],
      nose: "M-0.6 -41.6C0.8 -37.4 2 -34 0.4 -31.2",
      noseTip: [0, -30.8, 3.2, 2.2],
      mouth: [0, -15.6, 0],
      blush: [[-21.5, -36, 7.5, 4.6], [21.5, -36, 7.5, 4.6]],
      pivot: [0, -14],
      sx: 0.94,
      neckTop: [[-13.5, -10], [13.5, -10]],
      shadowOff: [0, -4.2],
      jaw: [[-35, -46], [-35, -32], [-28, -17], [-16, -5], [0, -1], [16, -5], [28, -17], [35, -32], [35, -46]],
    },
    side: {
      face: [[-6, -101], [10, -98.3], [22.6, -90.8], [30.6, -79.6], [33.8, -67], [35.2, -58.4], [33.4, -52.6], [34.6, -46.8], [37.6, -40.4],
        [41.4, -34.4, 1], [42.2, -32.4], [40.4, -30.4], [36.2, -29.4, 1], [35.6, -26.2], [36.3, -23], [34.5, -20.2, 1], [35.4, -17.2],
        [33.2, -12.6], [32.8, -7], [29.6, -2], [22.4, 0], [11, -3.4], [0, -9.6], [-9, -17.4], [-16, -25], [-29, -32], [-39.4, -40.5],
        [-46.2, -55.5], [-45.6, -73], [-37.6, -88.4], [-23.4, -98]],
      ear: { cx: -7.6, cy: -49.5, s: 1 },
      eyes: [{ cx: 26.4, cy: -48.8, t: "side" }],
      brows: [{ cx: 26.8, cy: -60.2, t: "side" }],
      nose: "",
      noseTip: [38.6, -32.6, 3, 2],
      mouth: [33.6, -20.6, 2],
      blush: [[18.5, -35.5, 7.5, 4.6]],
      pivot: [-8, -14],
      sx: 0.94,
      neckTop: [[-19, -19], [7, -8]],
      shadowOff: [2.5, -3.5],
      jaw: [[-2, -46], [-3, -30], [4, -15], [14, -4], [25, -1], [32, -8], [34, -18], [36, -26]],
    },
  };

  // eyes: sample columns x, top lid y, bottom lid y; heavy = the side the lash line thickens toward
  const EYES = {
    near:   { xs: [-8.4, -6.4, -3.4, 0, 3.4, 6.4, 8.6], top: [0.9, -4.9, -7.7, -8.3, -7.7, -4.7, 1.3], bot: [0.9, 4.9, 7.1, 7.8, 7.1, 4.9, 1.3],
              lash: [0.5, 1.4, 2.1, 2.5, 2.9, 3.2, 3], hook: [10.8, 3.8], iris: [0.9, 0.7, 5.8, 7.4], heavy: 1 },
    far:    { xs: [-5.4, -3.8, -1.3, 1.4, 4, 6.2], top: [0.6, -5, -7.5, -7.7, -5.5, 1.1], bot: [0.6, 5.3, 7.3, 7.1, 5.1, 1.1],
              lash: [0.5, 1.4, 2.1, 2.6, 3, 2.9], hook: [8.4, 3.5], iris: [0.9, 0.7, 4.5, 7.1], heavy: 1 },
    frontL: { xs: [-7.4, -5.2, -2.4, 0.4, 3.2, 5.6, 7.4], top: [0.9, -3.9, -6.4, -7, -6.4, -3.6, 1], bot: [0.9, 4.5, 6.4, 7, 6.3, 4.2, 1],
              lash: [0.35, 1, 1.4, 1.7, 2, 2.3, 2.2], hook: [8.8, 2.8], iris: [0, 0.8, 5, 6.5], heavy: 1 },
    side:   { xs: [-4.8, -3, -0.6, 1.8, 3.8], top: [0.4, -4.4, -6.2, -4.8, 0.8], bot: [0.4, 4.2, 5.6, 4.4, 0.8],
              lash: [0.35, 1.1, 1.8, 2.3, 2.2], hook: [5.4, 2.6], iris: [1.5, 0.6, 2.6, 5.8], heavy: 1 },
  };
  EYES.frontR = mirrorEye(EYES.frontL);
  function mirrorEye(E) {
    const n = E.xs.length, r = (a) => a.slice().reverse();
    return { xs: r(E.xs).map((x) => -x), top: r(E.top), bot: r(E.bot), lash: r(E.lash), hook: [-E.hook[0], E.hook[1]],
             iris: [-E.iris[0], E.iris[1], E.iris[2], E.iris[3]], heavy: -1, n };
  }
  const BROWS = {
    near: { pts: [[-8, 1.9], [-2.6, -1.4], [3.2, -1.7], [7.8, 0.3]], ws: [0.5, 2.1, 2.3, 1.2] },
    far: { pts: [[-4.8, 1], [-1, -1.3], [3, -1.2], [5.8, 0.8]], ws: [1.2, 2.2, 1.8, 0.5] },
    frontL: { pts: [[-6.6, 1.2], [-2, -1.2], [3, -1.2], [7, 0.8]], ws: [1.1, 1.9, 1.6, 0.4] },
    side: { pts: [[-4, 0.6], [-0.6, -1.2], [2.8, -1], [5, 0.6]], ws: [0.9, 1.8, 1.5, 0.4] },
  };
  BROWS.frontR = { pts: BROWS.frontL.pts.map((p) => [-p[0], p[1]]).reverse(), ws: BROWS.frontL.ws.slice().reverse() };

  function eyeGeom(E, drop, rise) {
    const n = E.xs.length, T = [], B = [];
    for (let i = 0; i < n; i++) {
      const w = i === 0 || i === n - 1 ? 0.3 : 1;
      let ty = E.top[i] + drop * w, by = E.bot[i] - rise * w;
      if (by < ty) { const m = Math.max(ty, by); ty = by = Math.min(m, E.bot[i]); }
      T.push([E.xs[i], ty]); B.push([E.xs[i], by]);
    }
    return { T, B };
  }
  function eyeAperture(g) {
    const n = g.T.length, pts = [];
    pts.push([g.T[0][0], g.T[0][1], 1]);
    for (let i = 1; i < n - 1; i++) pts.push(g.T[i]);
    pts.push([g.T[n - 1][0], g.T[n - 1][1], 1]);
    for (let i = n - 2; i >= 1; i--) pts.push(g.B[i]);
    return crv(pts, true);
  }
  function lashPath(E, g) {
    const n = g.T.length, up = [], lo = [];
    for (let i = 0; i < n; i++) { const [x, y] = g.T[i]; up.push([x, y - E.lash[i]]); lo.push([x, y + 0.15]); }
    const hi = E.heavy > 0 ? n - 1 : 0, lo0 = E.heavy > 0 ? 0 : n - 1;
    const hk = [g.T[hi][0] + E.hook[0] - E.xs[hi], g.T[hi][1] + E.hook[1] - (E.top[hi] - g.T[hi][1]) * 0];
    // outline: along the top from the thin end to the heavy end, the hook, back along the lid
    const ord = E.heavy > 0 ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
    const pts = [];
    pts.push([up[ord[0]][0] - 0.5 * E.heavy, g.T[ord[0]][1] + 0.1, 1]);
    for (let k = 1; k < n; k++) pts.push(up[ord[k]]);
    pts.push([hk[0], hk[1], 1]);
    for (let k = n - 1; k >= 1; k--) pts.push(lo[ord[k]]);
    void lo0;
    return crv(pts, true);
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  //  hair (3 views). A style = a cap over the skull + optional back mass behind the body.
  // ══════════════════════════════════════════════════════════════════════════════════
  const HAIRSPEC = {
    short:    { vol: 2.2, front: "plain", side: "burn", back: "nape" },
    sidepart: { vol: 3.2, front: "part", side: "burn", back: "nape" },
    balding:  { vol: 1.2, front: "none", side: "burn", back: "nape", band: true },
    bald:     { none: true },
    curly:    { vol: 5.5, front: "curly", side: "burn", back: "nape", curly: true },
    wavy:     { vol: 4, front: "part", side: "jaw", back: "jaw", wavy: true },
    long:     { vol: 3.2, front: "part", side: "long", back: "long", mass: "long" },
    bun:      { vol: 2.6, front: "plain", side: "ear", back: "nape", extra: "bun", fem: true },
    bob:      { vol: 4.2, front: "notch", side: "ear", back: "jaw" },
    braid:    { vol: 2.6, front: "part", side: "ear", back: "nape", extra: "braid" },
    ponytail: { vol: 2.6, front: "plain", side: "ear", back: "nape", extra: "ponytail" },
  };

  function hair3q(sp) {
    const v = sp.vol, cx = -5, cy = -60, r = 41 + v;
    const out = [];
    const endA = { nape: 128, jaw: 150, long: 168 }[sp.back] - 360;
    const step = sp.curly ? 9 : 12;
    let k = 0;
    for (let a = -9; a >= endA; a -= step, k++) {
      const rr = sp.curly ? r + (k % 2 ? 3.2 : 0) : r;
      out.push([cx + rr * Math.cos(a * RAD), cy + rr * Math.sin(a * RAD)]);
    }
    const inner = [];
    if (sp.back === "nape") inner.push([-33.5, -30.5, 1]);
    if (sp.back === "jaw") inner.push([-43, -37, 1], [-33, -35.5]);
    if (sp.back === "long") inner.push([-45, 14, 1], [-32, 17], [-20, 13, 1]);
    if (sp.side === "burn") inner.push([-32, -42], [-30.5, -55], [-25, -62.5], [-16, -63], [-11.5, -59.5], [-11.5, -50], [-9.8, -45, 1], [-7.2, -51], [-5.6, -60]);
    if (sp.side === "ear") inner.push([-22, -38.5], [-10.8, -40.5, 1], [-8.2, -50], [-6, -60]);
    if (sp.side === "jaw") inner.push([-22, -31], [-11.5, -33, 1], [-8.8, -46], [-6.4, -58]);
    if (sp.side === "long") inner.push([-15, -12], [-10.8, -36], [-8.4, -50], [-6.2, -60]);
    const fr = {
      plain: [[-4.6, -67.2], [0.5, -73.4], [8, -77], [16, -77.8], [25, -75.8], [31.5, -71]],
      notch: [[-4.6, -66.5], [0, -70.5], [6, -70.4], [10.5, -63.5, 1], [14, -69.4], [22, -70.4], [29.5, -67.5], [34, -62.5]],
      part: [[-4.6, -67.5], [-0.5, -76], [6, -81.5], [15, -82], [24, -78], [31, -72]],
      curly: [[-4.8, -67], [0, -74], [5, -72.5], [9, -78], [14, -75.5], [19, -79.5], [25, -75], [31.5, -71]],
      none: [],
    }[sp.front] || [];
    const pts = out.concat(inner, fr);
    const cap = sp.band ? balding3q() : crv(pts, true);
    // highlight band across the top of the cap
    const hi = sp.band ? "" : crv(arcPts(cx + 1, cy - 1, r - 4.2, r - 4.2, -158, -46, 14).concat(arcPts(cx + 1, cy - 1, r - 8.2, r - 8.6, -52, -150, 14)), true);
    const lines = [];
    if (sp.front === "notch") lines.push("M9.5 -101.5C10.5 -88 10.8 -75 10.5 -64.5");
    if (sp.front === "part") lines.push("M-6 -103.5C-2.5 -95 2.5 -87 7.5 -81");
    if (!sp.band) lines.push("M-40 -72C-38 -60 -36 -48 -34 -38", "M-22 -95C-14 -97 -6 -98 2 -97");
    let back = "";
    if (sp.mass === "long") back = crv([[-30, -95], [-48, -72], [-52, -40], [-53, 0], [-50, 38], [-30, 50], [0, 52], [26, 44], [38, 22], [40, -8], [39, -40], [36, -70], [18, -96]], true);
    if (sp.wavy) back = crv([[-30, -95], [-50, -70], [-53, -48], [-50, -30], [-54, -16], [-46, -4], [-30, 0], [-10, -2], [20, -8], [36, -16], [41, -34], [38, -60], [20, -95]], true);
    let extra = "", extraFront = "";
    if (sp.extra === "bun") extra = ell(-37, -91, 14, 12.5);
    if (sp.extra === "ponytail") extra = crv([[-44, -76], [-54, -60], [-58, -30], [-56, 6], [-51, 30, 1], [-46, 4], [-44, -26], [-38, -58]], true);
    if (sp.extra === "braid") extra = crv([[-44, -70], [-50, -50], [-51, -20], [-50, 20], [-47, 48, 1], [-42, 20], [-41, -18], [-37, -56]], true);
    return { cap, hi, lines, back, extra, extraFront };
  }
  function balding3q() {
    // the band of hair from the back of the skull over the ear to the sideburn (Wilbur)
    const outer = [[-27, -87.6], [-33, -87.8], [-40.5, -81], [-45.8, -67], [-47, -52], [-45, -40], [-40, -32.6, 1]];
    const inner = [[-35.2, -35], [-33.6, -46], [-32.6, -60], [-28, -67.6], [-20, -70.4], [-13.4, -67.4], [-11, -60], [-10.6, -50],
      [-9.8, -43.6, 1], [-5.2, -50], [-3.6, -60.5], [-6.4, -71], [-12.6, -77.6], [-20, -82]];
    return crv(outer.concat(inner), true);
  }

  function hairFront(sp) {
    const v = sp.vol, r = 40 + v, cx = 0, cy = -60;
    const bottom = { burn: -58, ear: -40, jaw: -30, long: 18 }[sp.side];
    const out = [];
    let k = 0;
    const step = sp.curly ? 9 : 12;
    for (let a = 12; a >= -192; a -= step, k++) {
      const rr = sp.curly ? r + (k % 2 ? 3 : 0) : r;
      out.push([cx + rr * Math.cos(a * RAD), cy + rr * Math.sin(a * RAD)]);
    }
    // left side (screen right... x>0 first): out runs from right-low over the top to left-low
    const pts = [[r * 0.95 + 1, bottom, 1]].concat(out.filter((p) => p[1] < bottom - 2));
    pts.push([-(r * 0.95 + 1), bottom, 1]);
    const inR = { burn: [[-35, -58], [-35.5, -47, 1], [-32.5, -52], [-32, -62]], ear: [[-33, -40, 1], [-32.5, -52], [-32, -62]],
      jaw: [[-33, -30, 1], [-33, -46], [-32, -62]], long: [[-30, 18, 1], [-33, -10], [-33.5, -40], [-32, -62]] }[sp.side];
    const fr = {
      plain: [[-26, -72], [-14, -77], [0, -78.5], [14, -77], [26, -72]],
      notch: [[-24, -70], [-10, -71], [-2, -64, 1], [4, -70.5], [16, -71], [27, -68]],
      part: [[-25, -74], [-12, -82], [-4, -83], [10, -80], [24, -73]],
      curly: [[-26, -72], [-18, -78], [-10, -75], [-2, -80], [6, -76], [14, -80], [22, -76], [27, -72]],
      none: [],
    }[sp.front] || [];
    const inL = inR.map((p) => [-p[0], p[1], p[2]]).reverse();
    const cap = sp.band ? baldingFront() : crv(pts.concat(inR, fr, inL), true);
    const hi = sp.band ? "" : crv(arcPts(1, -61, r - 4.5, r - 4.5, -150, -40, 14).concat(arcPts(1, -61, r - 8.5, r - 9, -46, -144, 14)), true);
    const lines = [];
    if (sp.front === "notch") lines.push("M-1 -101.5C-1.5 -88 -1.8 -75 -2 -65");
    if (sp.front === "part") lines.push("M-9 -103C-7 -95 -5 -88 -4 -83");
    let back = "";
    if (sp.mass === "long") back = crv([[-40, -80], [-47, -50], [-49, -10], [-47, 38], [-30, 50], [0, 52], [30, 50], [47, 38], [49, -10], [47, -50], [40, -80]], true);
    if (sp.wavy) back = crv([[-40, -80], [-47, -56], [-48, -30], [-44, -18], [-30, -16], [0, -16], [30, -16], [44, -18], [48, -30], [47, -56], [40, -80]], true);
    let extra = "";
    if (sp.extra === "bun") extra = ell(0, -103, 13, 11);
    if (sp.extra === "ponytail") extra = "";
    if (sp.extra === "braid") extra = crv([[-30, -44], [-38, -20], [-40, 20], [-37, 46, 1], [-32, 20], [-30, -18]], true);
    return { cap, hi, lines, back, extra, extraFront: "" };
  }
  function baldingFront() {
    const R = [[39.8, -72], [41.6, -58], [40.6, -44], [37, -34, 1], [35, -40], [34.8, -52], [33.8, -62], [36, -71]];
    const Lp = R.map((p) => [-p[0], p[1], p[2]]);
    return crv(R, true) + crv(Lp, true);
  }

  function hairSide(sp) {
    const v = sp.vol, cx = -6, cy = -60, r = 41 + v;
    const out = [];
    const endA = { nape: 128, jaw: 150, long: 170 }[sp.back] - 360;
    let k = 0;
    const step = sp.curly ? 9 : 12;
    for (let a = -30; a >= endA; a -= step, k++) {
      const rr = sp.curly ? r + (k % 2 ? 3 : 0) : r;
      out.push([cx + rr * Math.cos(a * RAD), cy + rr * Math.sin(a * RAD)]);
    }
    const inner = [];
    if (sp.back === "nape") inner.push([-30, -30, 1]);
    if (sp.back === "jaw") inner.push([-42, -36, 1], [-30, -34]);
    if (sp.back === "long") inner.push([-46, 14, 1], [-34, 17], [-22, 12, 1]);
    if (sp.side === "burn") inner.push([-20, -42], [-19, -56], [-13, -63.5], [-3, -63.5], [2, -60], [2.5, -50], [3.6, -45, 1], [6, -51], [8, -61]);
    if (sp.side === "ear") inner.push([-14, -37.5], [2, -39, 1], [5, -50], [8, -61]);
    if (sp.side === "jaw") inner.push([-12, -30], [4, -31, 1], [5.5, -46], [8, -61]);
    if (sp.side === "long") inner.push([-8, -10], [2, -36], [5, -50], [8, -61]);
    const fr = {
      plain: [[11, -68], [18, -76], [26.5, -80.5]],
      notch: [[11, -68], [17, -70], [21, -66, 1], [25, -71.5], [30, -73]],
      part: [[11, -68], [18, -79], [28, -82.5]],
      curly: [[11, -68], [16, -76], [21, -74], [26, -81]],
      none: [],
    }[sp.front] || [];
    const cap = sp.band ? baldingSide() : crv(out.concat(inner, fr), true);
    const hi = sp.band ? "" : crv(arcPts(cx + 1, cy - 1, r - 4.2, r - 4.2, -160, -50, 14).concat(arcPts(cx + 1, cy - 1, r - 8.2, r - 8.6, -56, -152, 14)), true);
    const lines = [];
    if (!sp.band) lines.push("M-41 -70C-39 -58 -36 -47 -33 -38");
    let back = "";
    if (sp.mass === "long") back = crv([[-30, -95], [-48, -72], [-52, -40], [-53, 0], [-50, 38], [-32, 48], [-12, 44], [-6, 20], [-12, -10], [-6, -60], [10, -96]], true);
    if (sp.wavy) back = crv([[-30, -95], [-50, -70], [-53, -48], [-50, -30], [-54, -16], [-46, -4], [-30, 0], [-16, -4], [-12, -30], [0, -70], [10, -96]], true);
    let extra = "";
    if (sp.extra === "bun") extra = ell(-39, -89, 14, 12.5);
    if (sp.extra === "ponytail") extra = crv([[-44, -76], [-56, -60], [-60, -30], [-58, 6], [-53, 30, 1], [-48, 4], [-46, -26], [-40, -58]], true);
    if (sp.extra === "braid") extra = crv([[-44, -70], [-52, -50], [-53, -20], [-52, 20], [-49, 48, 1], [-44, 20], [-43, -18], [-38, -56]], true);
    return { cap, hi, lines, back, extra, extraFront: "" };
  }
  function baldingSide() {
    return crv([[-26, -89], [-38, -82], [-45.8, -68], [-46.4, -52], [-43, -39], [-35, -30.5, 1], [-24, -32], [-21, -45], [-20, -58], [-14, -65.5],
      [-3, -66.5], [2.4, -62], [2.4, -52], [3.6, -45, 1], [6.8, -51], [8.4, -62], [4, -71.5], [-6, -77], [-16, -84]], true);
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  //  facial hair + hats + glasses (markup builders per view)
  // ══════════════════════════════════════════════════════════════════════════════════
  function moustachePts(kind, view) {
    // around the mouth centre; +x toward the facing side. 3q: near half longer
    const k3 = view === "3q", sd = view === "side";
    const sN = k3 ? 1.12 : sd ? 0.5 : 1, sF = k3 ? 0.82 : sd ? 0.2 : 1;
    let half;
    if (kind === "walrus") half = [[0, -9.4], [4.6, -9], [8.6, -6.6], [11, -2.4], [11.6, 3.2], [10.8, 6.4, 1], [8.8, 2.2], [6, -0.6], [3, -1.6], [0, -1.4]];
    else if (kind === "handlebar") half = [[0, -7.6], [4.4, -7.4], [8.4, -5.2], [12, -3.8], [15, -6], [16.2, -10.4, 1], [14.6, -3.2], [10, -0.6], [5, -1.6], [0, -2.2]];
    else half = [[0, -5.4], [4, -5.2], [7.8, -3.6], [9.2, -1.6, 1], [6, -2.2], [3, -2.9], [0, -3]];
    if (sd) half = half.map(([x, y, c]) => [x, y, c]);
    const F2 = half.map(([x, y, c]) => [x * sF, y, c]);
    const N2 = half.map(([x, y, c]) => [-x * sN, y, c]).reverse();
    const pts = F2.slice(0, -1).concat(N2.slice(1));
    // drop duplicate centre points
    return crv(pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) + Math.abs(p[1] - pts[i - 1][1]) > 0.01), true);
  }
  function beardPath(kind, view) {
    const H = HEAD[view];
    if (kind === "none" || kind === "stubble") return "";
    if (view === "3q") {
      const low = kind === "long" ? 26 : kind === "full" ? 6 : kind === "goatee" ? 4 : 2.5;
      if (kind === "goatee") return crv([[11, -9.5], [18, -8], [25, -10.5], [26, -4], [20, 2], [14, low], [9, 1], [7, -5]], true);
      const top = kind === "short" ? -30 : -36;
      return crv([[-12.4, -49, 1], [-10.5, top], [-4, -24], [6, -17], [12, -12.5], [18, -10.8], [24, -12.5], [29.2, -18], [33.6, -27, 1],
        [33, -16], [28.5, -6], [22, kind === "long" ? low - 4 : 2], [14, low], [4, kind === "long" ? low - 10 : 1.5], [-8, -4], [-18, -14],
        [-24, -22], [-17, -36]], true);
    }
    if (view === "front") {
      const low = kind === "long" ? 28 : kind === "full" ? 7 : 4;
      if (kind === "goatee") return crv([[-7, -9], [0, -8], [7, -9], [7, -2], [0, low], [-7, -2]], true);
      return crv([[-36.4, -48, 1], [-33, -34], [-24, -24], [-12, -16], [-6, -11.5], [0, -10.5], [6, -11.5], [12, -16], [24, -24], [33, -34],
        [36.4, -48, 1], [36, -30], [30, -14], [18, kind === "long" ? low - 8 : 0], [0, low], [-18, kind === "long" ? low - 8 : 0], [-30, -14], [-36, -30]], true);
    }
    const low = kind === "long" ? 24 : kind === "full" ? 5 : 2.5;
    if (kind === "goatee") return crv([[28, -9], [34, -10.5], [35, -4], [30, 2], [24, low], [22, -3]], true);
    return crv([[-2.2, -49, 1], [0, -34], [8, -22], [18, -14], [26, -12], [32, -14], [36, -18, 1], [35.5, -10], [33, -3], [26, kind === "long" ? low - 4 : 2],
      [16, low], [6, kind === "long" ? low - 12 : -1], [-6, -12], [-10, -24], [-6, -38]], true);
  }

  // hats: returns markup (fills from the palette object c) in head units, for a view
  function hatMarkup(kind, view, c, v) {
    const lift = (v || 0) * 0.6;
    const s3 = view === "3q", sd = view === "side";
    const ink = c.ink, W = (x) => x;
    void W;
    let m = "";
    const cx = s3 ? -5 : sd ? -6 : 0;
    const g = (inner) => `<g transform="translate(0 ${N(3.2 - lift)}) translate(${cx} -66) scale(1.07) translate(${-cx} 66)">${inner}</g>`;
    if (kind === "bowler") {
      const dome = s3 ? crv([[-27, -77], [-28.4, -93], [-19, -107], [1.5, -111], [21, -107], [30.4, -94], [30, -79]], false) + "Z"
        : sd ? crv([[-29, -77], [-30, -93], [-20, -107], [0, -111], [19, -106], [27.4, -94], [27, -79]], false) + "Z"
        : crv([[-29, -77], [-30, -94], [-20, -107], [0, -111], [20, -107], [30, -94], [29, -77]], false) + "Z";
      const brim = s3 ? "M-41 -72.5C-41.5 -78 -34 -80.5 -22 -80C-6 -79.5 14 -79.6 28 -80.8C38 -81.6 44.6 -83.4 45.4 -79.6C46 -76 38 -73.2 26 -73C10 -72.8 -12 -73.2 -26 -72.8C-34 -72.6 -40.6 -68.8 -41 -72.5Z"
        : sd ? "M-42 -72C-42 -78 -32 -80.5 -18 -80C0 -79.5 20 -80 32 -81.4C40 -82.4 45 -83.5 45.4 -79.8C45.6 -76.6 38 -73.6 26 -73.4C8 -73.2 -14 -73.4 -28 -72.8C-36 -72.4 -42 -68.6 -42 -72Z"
        : "M-44 -72C-45 -77.5 -36 -80.5 -22 -80.3C-8 -80.1 8 -80.1 22 -80.3C36 -80.5 45 -77.5 44 -72C43 -68.5 34 -72.4 22 -72.6C8 -72.8 -8 -72.8 -22 -72.6C-34 -72.4 -43 -68.5 -44 -72Z";
      m = `<path d="${dome}" fill="${c.fill}" stroke="${ink}" stroke-width="1.3"/>` +
        `<path d="${s3 ? "M-26 -85C-8 -87.5 12 -87.8 30.2 -85.6L30 -79C12 -81 -8 -81 -27 -78.6Z" : sd ? "M-29 -85C-8 -87.5 12 -87.8 27.2 -85.6L27 -79C10 -81 -10 -81 -29 -78.6Z" : "M-29.5 -85C-10 -87.5 10 -87.5 29.5 -85L29 -78C10 -80 -10 -80 -29 -78Z"}" fill="${c.band}" stroke="${ink}" stroke-width="0.9"/>` +
        `<path d="${brim}" fill="${c.fill2}" stroke="${ink}" stroke-width="1.3"/>` +
        `<path d="${s3 ? "M-14 -104C-6 -108.6 6 -109 14 -106.4" : "M-12 -105C-4 -108.8 6 -109 13 -106.6"}" fill="none" stroke="${c.hi}" stroke-width="2.2" stroke-linecap="round" opacity="0.8"/>`;
    } else if (kind === "flatcap") {
      const body = s3 ? "M-47 -63.5C-50.5 -76 -44 -95 -26.5 -103.5C-10 -110 12 -106.8 28 -97.5C38.5 -91.4 46.5 -85.4 49.4 -80.6C50.8 -77.8 46 -76.8 38 -77.4C26 -77.4 13 -74.6 1 -72.2C-15 -69.4 -33 -67 -47 -63.5Z"
        : sd ? "M-48 -62C-51 -76 -44 -96 -26 -104C-8 -110 14 -106 30 -97C40 -91 48 -86 51 -81.5C52.4 -78.6 47 -77.6 39 -78C27 -78 14 -75.4 2 -73C-14 -70 -34 -66.4 -48 -62Z"
        : "M-43 -66C-46 -80 -38 -99 -19 -106C-4 -111 14 -108.5 28 -101C39 -95 45 -84 43 -74C40 -70.6 30 -72 20 -72.6C6 -73.2 -8 -73.2 -22 -72C-32 -71 -40 -68 -43 -66Z";
      const peak = s3 ? "M14 -74.6C26 -77.5 40 -82 49.4 -80.6C51 -77.6 46 -75.4 38.5 -74.6C29 -73.6 21 -72.8 14 -74.6Z"
        : sd ? "M16 -75C28 -78 42 -82.6 51 -81.5C52.4 -78.6 47 -76.2 39.6 -75.4C30 -74.4 22 -73.4 16 -75Z"
        : "M-24 -72.8C-12 -75.6 12 -75.6 24 -72.8C26 -69.4 14 -67.4 0 -67.4C-14 -67.4 -26 -69.4 -24 -72.8Z";
      m = `<path d="${body}" fill="${c.fill}" stroke="${ink}" stroke-width="1.3"/>` +
        `<path d="${peak}" fill="${c.fill2}" stroke="${ink}" stroke-width="1.2"/>` +
        `<path d="${s3 ? "M-40 -80C-30 -96 -8 -104.5 14 -100.5" : sd ? "M-40 -80C-30 -97 -8 -105 14 -101" : "M-30 -90C-18 -101 6 -104 22 -98"}" fill="none" stroke="${c.hi}" stroke-width="2.4" stroke-linecap="round" opacity="0.75"/>` +
        `<path d="${s3 ? "M-20 -73C-6 -80 14 -84 30 -84" : sd ? "M-20 -72C-6 -79 14 -84 32 -84.6" : "M-26 -80C-10 -86 10 -86 26 -80"}" fill="none" stroke="${ink}" stroke-width="0.9" opacity="0.6"/>`;
    } else if (kind === "tophat") {
      const x0 = s3 ? -25 : sd ? -27 : -26, x1 = s3 ? 29 : sd ? 26 : 26;
      m = `<path d="M${x0} -78L${x0 - 1.5} -140C${x0 + 8} -146 ${x1 - 8} -146 ${x1 + 1.5} -140L${x1} -78Z" fill="${c.fill}" stroke="${ink}" stroke-width="1.3"/>` +
        `<path d="M${x0 - 1.5} -140C${x0 + 8} -134.5 ${x1 - 8} -134.5 ${x1 + 1.5} -140C${x1 - 8} -146 ${x0 + 8} -146 ${x0 - 1.5} -140Z" fill="${c.fill2}" stroke="${ink}" stroke-width="1"/>` +
        `<path d="M${x0 - 0.4} -92L${x1 + 0.3} -92L${x1} -82L${x0} -82Z" fill="${c.band}"/>` +
        `<path d="M${x0 - 16} -75C${x0 - 16} -81 ${x1 + 16} -81 ${x1 + 16} -75C${x1 + 16} -71 ${x0 - 16} -71 ${x0 - 16} -75Z" fill="${c.fill2}" stroke="${ink}" stroke-width="1.3"/>` +
        `<path d="M${x0 + 4} -134L${x0 + 4} -96" stroke="${c.hi}" stroke-width="2.4" opacity="0.5" stroke-linecap="round"/>`;
    } else if (kind === "fedora") {
      const crown = s3 ? "M-26 -78C-28 -92 -22 -104 -8 -106C0 -101 6 -101 12 -106C24 -104 31 -94 30 -79Z" : sd ? "M-29 -78C-30 -93 -22 -105 -8 -106C0 -101 6 -101 12 -106C22 -103 28 -93 27 -79Z" : "M-28 -78C-30 -92 -22 -105 -8 -107C-2 -102 2 -102 8 -107C22 -105 30 -92 28 -78Z";
      m = `<path d="${crown}" fill="${c.fill}" stroke="${ink}" stroke-width="1.3"/>` +
        `<path d="${s3 ? "M-26.6 -86L30.4 -86L30 -79L-26 -79Z" : sd ? "M-29.6 -86L27.4 -86L27 -79L-29 -79Z" : "M-29 -86L29 -86L28.6 -79L-28.6 -79Z"}" fill="${c.band}"/>` +
        `<path d="${s3 ? "M-44 -74C-44 -80 -30 -81 0 -80.5C26 -80 48 -82 50 -77C51 -72 40 -71 20 -72.5C0 -73.5 -28 -72.5 -38 -70.5C-42 -69.8 -44 -71 -44 -74Z" : "M-46 -74C-46 -80 -30 -81 0 -80.6C30 -81 46 -80 46 -74C46 -70 34 -72.6 0 -72.8C-34 -72.6 -46 -70 -46 -74Z"}" fill="${c.fill2}" stroke="${ink}" stroke-width="1.3"/>`;
    } else if (kind === "helmet") {
      m = `<g transform="translate(0 5)">` + `<path d="${s3 ? "M-44 -64C-48 -86 -32 -108 -4 -110C24 -110 40 -92 40 -70Z" : sd ? "M-46 -64C-50 -88 -32 -110 -4 -110C22 -110 38 -92 38 -70Z" : "M-42 -66C-44 -92 -24 -110 0 -110C24 -110 44 -92 42 -66Z"}" fill="${c.fill}" stroke="${ink}" stroke-width="1.4"/>` +
        `<path d="${s3 || sd ? "M-52 -62C-52 -68 -30 -71 0 -71C28 -71 50 -70 52 -66C52 -62 30 -62 0 -62.6C-30 -62.6 -52 -58 -52 -62Z" : "M-48 -64C-48 -70 -24 -72 0 -72C24 -72 48 -70 48 -64C48 -60 24 -62 0 -62C-24 -62 -48 -60 -48 -64Z"}" fill="${c.fill2}" stroke="${ink}" stroke-width="1.3"/>` +
        `<path d="M-24 -98C-12 -106 6 -107 18 -101" fill="none" stroke="${c.hi}" stroke-width="3" stroke-linecap="round" opacity="0.6"/></g>`;
    } else if (kind === "cap") {
      m = `<path d="${s3 ? "M-44 -66C-47 -86 -32 -106 -6 -107C18 -107 34 -94 36 -74Z" : sd ? "M-46 -66C-49 -88 -32 -107 -6 -107C16 -107 32 -94 34 -74Z" : "M-40 -68C-42 -92 -22 -108 0 -108C22 -108 42 -92 40 -68Z"}" fill="${c.fill}" stroke="${ink}" stroke-width="1.3"/>` +
        `<path d="${s3 ? "M18 -76C34 -80 52 -80 60 -74C62 -70 50 -68 36 -69C28 -69.6 22 -71 18 -76Z" : sd ? "M18 -76C36 -80 56 -80 64 -74C66 -70 52 -68 38 -69C28 -69.6 22 -71 18 -76Z" : "M-28 -70C-14 -74 14 -74 28 -70C30 -64 14 -61 0 -61C-14 -61 -30 -64 -28 -70Z"}" fill="${c.fill2}" stroke="${ink}" stroke-width="1.2"/>` +
        `<path d="M-2 -107L-2 -104" stroke="${ink}" stroke-width="2.2"/>`;
    } else if (kind === "wreath") {
      const pts = s3 ? arcPts(-4, -64, 44, 20, 195, 345, 9) : sd ? arcPts(-8, -64, 44, 18, 190, 340, 9) : arcPts(0, -70, 41, 11, 180, 360, 9);
      let leaves = "";
      pts.forEach((p, i) => {
        const a = i % 2 ? 35 : -35, s = i % 2 ? 1 : 0.9;
        leaves += `<ellipse cx="${N(p[0])}" cy="${N(p[1])}" rx="${N(5.6 * s)}" ry="${N(2.6 * s)}" transform="rotate(${a} ${N(p[0])} ${N(p[1])})" fill="${i % 3 ? c.fill : c.fill2}" stroke="${ink}" stroke-width="0.7"/>`;
      });
      m = `<path d="${crv(pts, false)}" fill="none" stroke="${c.band}" stroke-width="2"/>` + leaves;
    } else if (kind === "headcloth") {
      // a cloth over the head, framing the face and falling behind the ears to the shoulders, held by a band
      const body = s3 ? crv([[35.8, -62, 1], [35.6, -84], [22, -102.5], [-4, -109], [-30, -101], [-46.6, -83], [-51, -60], [-52, -28], [-51, 2], [-48, 22, 1],
          [-31, 25], [-17, 20, 1], [-13, -8], [-10, -38], [-7, -58], [4, -69], [20, -71.6]], true)
        : sd ? crv([[31, -70, 1], [28.4, -88], [14, -104], [-10, -109.6], [-34, -101], [-48, -83], [-52, -60], [-53, -28], [-52, 2], [-49, 22, 1], [-30, 25], [-12, 20, 1],
          [-6, -8], [-2, -38], [4, -58], [12, -68], [22, -73]], true)
        : crv([[39.4, -58, 1], [38.4, -84], [23, -104.6], [0, -110], [-23, -104.6], [-38.4, -84], [-39.4, -58], [-42, -30], [-46, 0], [-48, 20, 1], [-36, 24], [-35, -6],
          [-33, -40], [-31, -62], [-16, -71.6], [0, -73], [16, -71.6], [31, -62], [33, -40], [35, -6], [36, 24], [48, 20, 1], [46, 0], [42, -30]], true);
      m = `<path d="${body}" fill="${c.fill}" stroke="${ink}" stroke-width="1.3"/>` +
        `<path d="${s3 ? "M-32 -52C-36 -24 -38 0 -40 20M-22 -46C-22 -22 -25 0 -27 18" : sd ? "M-34 -50C-38 -24 -40 0 -42 20M-22 -46C-20 -22 -22 0 -24 18" : "M-38 -40C-40 -20 -42 0 -43 16M38 -40C40 -20 42 0 43 16"}" fill="none" stroke="${F.mix(c.fill, DARK, 0.25)}" stroke-width="1.3" stroke-linecap="round" opacity="0.8"/>` +
        `<path d="${s3 ? "M35.4 -66.6C20 -73 2 -72 -10 -66C-22 -62 -36 -66 -48.6 -73" : sd ? "M29 -73C16 -73 4 -68 -6 -62C-18 -60 -34 -66 -49 -73" : "M-39 -62C-18 -71 18 -71 39 -62"}" fill="none" stroke="${c.band}" stroke-width="4.2" stroke-linecap="round"/>` +
        `<path d="${s3 ? "M-30 -96C-14 -104 8 -104 22 -98" : sd ? "M-28 -98C-12 -105 6 -105 18 -98" : "M-20 -100C-6 -106 8 -106 20 -100"}" fill="none" stroke="${c.hi}" stroke-width="2.2" opacity="0.55" stroke-linecap="round"/>`;
    } else if (kind === "bonnet") {
      const body = s3 ? crv([[40, -60], [38, -84], [22, -104], [-6, -110], [-32, -100], [-48, -78], [-50, -54], [-40, -40, 1], [-30, -54], [-24, -72], [-8, -84], [12, -86], [30, -76], [36, -62, 1]], true)
        : sd ? crv([[40, -58], [36, -84], [18, -104], [-10, -110], [-34, -100], [-48, -78], [-50, -54], [-40, -40, 1], [-28, -56], [-16, -72], [2, -84], [22, -84], [34, -72], [36, -60, 1]], true)
        : crv([[44, -50], [44, -80], [30, -104], [0, -112], [-30, -104], [-44, -80], [-44, -50, 1], [-36, -64], [-24, -80], [0, -86], [24, -80], [36, -64]], true);
      m = `<path d="${body}" fill="${c.fill}" stroke="${ink}" stroke-width="1.3"/>` +
        `<path d="${s3 ? "M-24 -44C-8 -20 8 -8 16 -2" : sd ? "M-8 -42C4 -24 14 -10 22 -2" : "M-34 -44C-24 -22 -12 -8 -6 -2M34 -44C24 -22 12 -8 6 -2"}" fill="none" stroke="${c.band}" stroke-width="2.4" stroke-linecap="round"/>` +
        `<path d="${s3 ? "M-36 -88C-20 -100 4 -102 24 -94" : "M-26 -96C-10 -104 10 -104 26 -96"}" fill="none" stroke="${c.hi}" stroke-width="2.4" opacity="0.6" stroke-linecap="round"/>`;
    }
    return m ? g(m) : "";
  }

  function glassesMarkup(view, ink) {
    const s = `fill="rgba(235,245,255,0.18)" stroke="${ink}" stroke-width="1.1"`;
    if (view === "3q") return `<g><ellipse cx="0.4" cy="-48.2" rx="9.6" ry="8.6" ${s}/><ellipse cx="25.6" cy="-48" rx="6.4" ry="8.2" ${s}/>` +
      `<path d="M9.8 -49.6C13 -52 16.4 -52 19.4 -49.6M-9.2 -49.4L-18 -52" fill="none" stroke="${ink}" stroke-width="1.1"/></g>`;
    if (view === "front") return `<g><ellipse cx="-15.2" cy="-48.2" rx="8.8" ry="8.2" ${s}/><ellipse cx="15.2" cy="-48.2" rx="8.8" ry="8.2" ${s}/>` +
      `<path d="M-6.4 -49.6C-3 -52 3 -52 6.4 -49.6M-24 -49L-36 -51M24 -49L36 -51" fill="none" stroke="${ink}" stroke-width="1.1"/></g>`;
    return `<g><ellipse cx="27.5" cy="-48.2" rx="4.4" ry="8" ${s}/><path d="M23.2 -49L-2 -51" fill="none" stroke="${ink}" stroke-width="1.1"/></g>`;
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  //  hands (hand units = body units; wrist at 0,0, fingers toward +y, thumb toward +x)
  // ══════════════════════════════════════════════════════════════════════════════════
  const HANDS = {
    none: { back: "", thumb: "", lines: [], front: "" },
    relax: {
      back: crv([[-12, 0], [-13.8, 13], [-13.2, 27], [-10.6, 41], [-5.8, 50.5], [1, 53.5], [7, 50], [10.8, 41], [12.6, 27], [12.8, 12], [12, 0]], true),
      thumb: crv([[8.6, 8], [15.4, 13], [18.6, 21.6], [17, 29], [12.6, 29.4], [10.6, 23.4], [7.6, 16.4]], true),
      lines: ["M-3.4 39C-2.6 45 -1.2 49.4 1 52", "M3 37.4C4.4 43 5.8 46.6 7 49"], front: "",
    },
    fist: {
      back: crv([[-13, 1], [-15, 13], [-14.6, 27], [-11, 37.6], [-3, 42.6], [7, 41.8], [13, 35], [15, 24], [14, 10], [12, 1]], true),
      thumb: crv([[7.6, 11.6], [13.6, 16.6], [14.8, 24.6], [11, 28.6], [4, 28.8], [1.8, 24.6], [5, 19.8]], true),
      lines: ["M-12.2 29.4C-6 32.8 4 33 10.6 30", "M-4.6 32.6L-4.4 41", "M2.4 33L2.6 41.6"], front: "",
    },
    grip: {
      back: crv([[-13, 1], [-15, 13], [-15.4, 27], [-12, 38], [-3, 42.6], [7, 41.8], [13.4, 35], [15.2, 24], [14, 10], [12, 1]], true),
      thumb: "",
      lines: [],
      front: crv([[-14.6, 17.6], [-15.4, 29], [-11.4, 37.6], [-2, 41], [8, 39.4], [14, 33], [15, 22], [13, 15], [4, 14.6], [-6, 15]], true),
      frontLines: ["M-6.8 16.6L-6.2 38.4", "M0 16L0.6 40.6", "M6.8 16L7.4 39"],
      frontThumb: crv([[8, 7.6], [15, 12], [15.6, 20.4], [10.6, 22.4], [5.6, 18.6]], true),
    },
    open: {
      back: crv([[-12, 0], [-13.4, 16], [-13, 34], [-11, 50], [-7, 61], [0, 65], [6, 62], [10, 51], [12.4, 35], [13, 18], [12, 0]], true),
      thumb: crv([[10, 7], [18, 11], [25, 19], [26, 25.6], [21.6, 26.6], [16, 21.6], [10, 16]], true),
      lines: ["M-4.2 38L-3.6 60", "M1.8 38L2.4 62", "M7 38L7.6 57"], front: "",
    },
    point: {
      back: crv([[-13, 1], [-15, 13], [-14.6, 26], [-11, 35], [-4, 38.6], [6, 38], [12.4, 32], [14.6, 22], [14, 10], [12, 1]], true),
      thumb: crv([[7.6, 10.6], [13.6, 15.6], [14.4, 23], [10.6, 26.4], [4.6, 26.4], [2.6, 22.4], [5, 18]], true),
      lines: ["M-12 27.4C-7 30.4 -1 31 3 30"], front: "",
      finger: crv([[3.6, 28], [4.6, 44], [4.8, 60], [7.4, 65], [10.4, 63], [11, 46], [11.6, 30]], true),
    },
    palm: {
      back: crv([[-12.6, 0], [-14.6, 14], [-16.4, 30], [-18.4, 44], [-15.8, 53], [-11, 49], [-8.4, 40], [-6, 55], [-1.6, 62], [2.2, 57], [1.8, 41],
        [4.6, 57], [9, 61], [11.6, 55], [8.4, 40], [11.6, 49], [15.4, 50], [15, 41], [13.4, 28], [13.2, 13], [12, 0]], true),
      thumb: crv([[11.6, 7], [19, 11], [25.4, 19], [26, 25.6], [21.6, 26.6], [16, 21.6], [11, 16]], true),
      lines: ["M-7 20C-2 26 5 27 9 24"], front: "",
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════════
  //  poses — angles in degrees. arms: [shoulder (0 = hanging, 90 = forward, 180 = up), elbow bend, wrist, hand, swing]
  //  legs: [hip (0 = straight down, + forward), knee bend, foot]. "N" = near/right arm, "F" = far/left arm (facing side)
  // ══════════════════════════════════════════════════════════════════════════════════
  const POSES = {
    stand:    { aN: [2, 7, 4, "relax", 1], aF: [-2, 9, 2, "relax", 1], lN: [0, 0, 0], lF: [0, 0, 0], idle: 1 },
    walk:     { anim: "walk", aN: [2, 10, 4, "relax", 1], aF: [-2, 10, 2, "relax", 1], lN: [0, 0, 0], lF: [0, 0, 0] },
    run:      { anim: "run", lean: 4, aN: [0, 88, 0, "fist", 1], aF: [0, 88, 0, "fist", 1], lN: [0, 0, 0], lF: [0, 0, 0] },
    point:    { active: "F", lean: 2, aF: [74, 10, 4, "point", 0], aN: [3, 9, 4, "relax", 0.4], lN: [0, 0, 0], lF: [0, 0, 0], zF: 1 },
    raise:    { active: "F", lean: -2, neck: -6, aF: [160, 10, -8, "grip", 0], aN: [5, 12, 4, "relax", 0.4], lN: [0, 0, 0], lF: [0, 0, 0] },
    reach:    { lean: -4, neck: -14, aN: [106, 18, 10, "open", 0], aF: [142, 12, 10, "open", 0], lN: [0, 0, 0], lF: [0, 0, 0], zF: 1 },
    hold:     { lean: 1, neck: 6, aN: [2, 92, 4, "grip", 0, 0.56], aF: [22, 70, 6, "grip", 0], lN: [0, 0, 0], lF: [0, 0, 0], zF: 1 },
    think:    { lean: 2, neck: 6, head: 4, aN: [26, 152, 14, "fist", 0], aF: [6, 22, 4, "relax", 0], lN: [0, 0, 0], lF: [0, 0, 0] },
    crossed:  { lean: -1, aN: [9, 99, 0, "none", 0, 0.78], aF: [14, -98, 0, "none", 0, 0.62], lN: [0, 0, 0], lF: [0, 0, 0], zF: 1 },
    sit:      { seat: 1, lean: 3, aN: [22, 30, 22, "relax", 0], aF: [26, 30, 22, "relax", 0], lN: [86, 88, 0], lF: [84, 84, 0], idle: 0.4 },
    write:    { anim: "write", seat: 1, lean: 14, neck: 16, active: "N", aN: [34, 58, 16, "grip", 0], aF: [40, 50, 10, "relax", 0], lN: [86, 88, 0], lF: [84, 84, 0], zF: 1 },
    kneel:    { lean: 5, aN: [8, 22, 4, "relax", 0], aF: [26, 58, 4, "relax", 0], lN: [2, 94, -62], lF: [88, 88, 0], kneel: 1 },
    crouch:   { lean: 24, neck: -16, aN: [36, 34, 4, "relax", 0], aF: [42, 38, 4, "relax", 0], lN: [104, 132, 4], lF: [96, 122, 2] },
    lie:      { lie: 1, lean: 0, neck: -64, aN: [168, 10, 0, "grip", 0], aF: [176, 6, 0, "relax", 0], lN: [-3, 6, 28], lF: [3, 12, 32], free: 1 },
    wave:     { anim: "wave", active: "F", lean: -1, aF: [112, 62, 0, "palm", 0], aN: [3, 9, 4, "relax", 0.3], lN: [0, 0, 0], lF: [0, 0, 0] },
    hammer:   { anim: "hammer", active: "N", lean: 8, neck: 10, aN: [60, 100, 0, "grip", 0], aF: [40, 64, 0, "grip", 0], lN: [0, 0, 0], lF: [0, 0, 0], zF: 1 },
    "look-up": { lean: -4, neck: -22, aN: [3, 8, 4, "relax", 1], aF: [-2, 10, 2, "relax", 1], lN: [0, 0, 0], lF: [0, 0, 0], gaze: [0.35, -1] },
    shrug:    { lean: -1, head: 7, shrug: 12, aN: [-6, -84, 10, "palm", 0], aF: [14, 84, -16, "palm", 0], lN: [0, 0, 0], lF: [0, 0, 0], zF: 1 },
    present:  { active: "F", lean: 1, aF: [50, 30, -16, "palm", 0], aN: [3, 9, 4, "relax", 0.3], lN: [0, 0, 0], lF: [0, 0, 0] },
    ride:     { anim: "ride", ride: 1, lean: 20, neck: -12, aN: [60, 20, 0, "grip", 0], aF: [60, 20, 0, "grip", 0], lN: [60, 60, 0], lF: [60, 60, 0], free: 1 },
  };
  const NUMK = ["lean", "neck", "head", "shrug", "seat", "lie", "kneel", "idle", "zF", "free", "ride", "rpm",
    "aNsh", "aNel", "aNwr", "aNsw", "aNfs", "aFsh", "aFel", "aFwr", "aFsw", "aFfs", "lNhip", "lNkn", "lNft", "lFhip", "lFkn", "lFft", "gx", "gy", "gw", "ipW"];
  function flatPose(name, opts) {
    const p = POSES[name] || POSES.stand;
    const o = {
      lean: p.lean || 0, neck: p.neck || 0, head: p.head || 0, shrug: p.shrug || 0, seat: p.seat || 0, lie: p.lie || 0,
      kneel: p.kneel || 0, idle: p.idle || 0, zF: p.zF || 0, free: p.free || 0, ride: p.ride || 0, rpm: (opts && opts.rpm) || 55,
      aNsh: p.aN[0], aNel: p.aN[1], aNwr: p.aN[2], hN: p.aN[3], aNsw: p.aN[4], aNfs: p.aN[5] ?? 1,
      aFsh: p.aF[0], aFel: p.aF[1], aFwr: p.aF[2], hF: p.aF[3], aFsw: p.aF[4], aFfs: p.aF[5] ?? 1,
      lNhip: p.lN[0], lNkn: p.lN[1], lNft: p.lN[2], lFhip: p.lF[0], lFkn: p.lF[1], lFft: p.lF[2],
      gx: p.gaze ? p.gaze[0] : 0, gy: p.gaze ? p.gaze[1] : 0, gw: p.gaze ? 1 : 0, anim: p.anim || null, name,
      ipW: p.anim === "walk" || p.anim === "run" ? 1 : 0, ipK: p.anim === "walk" || p.anim === "run" ? p.anim : null,
    };
    const want = opts && opts.arm ? (opts.arm === "right" || opts.arm === "near" ? "N" : "F") : null;
    if (want && p.active && want !== p.active) {
      for (const k of ["sh", "el", "wr", "sw", "fs"]) { const t = o["aN" + k]; o["aN" + k] = o["aF" + k]; o["aF" + k] = t; }
      const t = o.hN; o.hN = o.hF; o.hF = t;
      o.swapped = 1;
    }
    o.active = p.active ? (o.swapped ? (p.active === "N" ? "F" : "N") : p.active) : null;
    return o;
  }
  function blendPose(a, b, w) {
    if (w <= 0) return a; if (w >= 1) return b;
    const o = {};
    for (const k of NUMK) o[k] = lerp(a[k], b[k], w);
    o.hN = w < 0.5 ? a.hN : b.hN; o.hF = w < 0.5 ? a.hF : b.hF;
    o.anim = null; o.name = b.name; o.active = b.active;
    o.ipK = w < 0.5 ? a.ipK || b.ipK : b.ipK || a.ipK;
    return o;
  }

  const EXPR = {
    neutral:    { bY: 0, bR: 0, lid: 0.1, lidB: 0, mw: 7, mo: 0, mc: 0.25, happy: 0, blush: 0.55, iris: 1 },
    smile:      { bY: -1.4, bR: 4, lid: 0.06, lidB: 0.3, mw: 10, mo: 0, mc: 3, happy: 0, blush: 0.9, iris: 1 },
    laugh:      { bY: -2.8, bR: 6, lid: 0, lidB: 0, mw: 11, mo: 5.4, mc: 2.8, happy: 1, blush: 1, iris: 1 },
    surprised:  { bY: -6.5, bR: 2, lid: -0.2, lidB: 0, mw: 5.6, mo: 6.4, mc: 0, happy: 0, blush: 0.6, iris: 0.84 },
    worried:    { bY: -3.4, bR: 18, lid: 0.1, lidB: 0.08, mw: 7, mo: 1.8, mc: -1.8, happy: 0, blush: 0.5, iris: 1 },
    focused:    { bY: 2.2, bR: -12, lid: 0.3, lidB: 0.12, mw: 6, mo: 0, mc: -0.4, happy: 0, blush: 0.45, iris: 1 },
    sad:        { bY: -1.6, bR: 19, lid: 0.34, lidB: 0, mw: 7, mo: 0, mc: -2.6, happy: 0, blush: 0.4, iris: 1 },
    determined: { bY: 3.4, bR: -20, lid: 0.22, lidB: 0.14, mw: 8, mo: 0, mc: -1.4, happy: 0, blush: 0.55, iris: 1 },
  };
  const EXK = ["bY", "bR", "lid", "lidB", "mw", "mo", "mc", "happy", "blush", "iris"];

  // ══════════════════════════════════════════════════════════════════════════════════
  //  view geometry (torso frame: pelvis at 0,0; authored for the adult torso)
  // ══════════════════════════════════════════════════════════════════════════════════
  const VIEWS = {
    "3q":  { neck: [6, -296], shN: [-42, -268], shF: [38, -268], hipN: [-20, 0], hipF: [24, 0] },
    front: { neck: [0, -296], shN: [-62, -270], shF: [62, -270], hipN: [-28, 0], hipF: [28, 0] },
    side:  { neck: [-2, -296], shN: [-6, -276], shF: [-8, -278], hipN: [-4, 0], hipF: [4, 0] },
  };
  const viewOf = (face) => (face === "front" ? "front" : /profile/.test(face || "") ? "side" : "3q");
  const mirOf = (face) => (/left/.test(face || "") ? -1 : 1);

  // ══════════════════════════════════════════════════════════════════════════════════
  //  garments. Torso silhouettes per family and view (torso frame, before the torso x-scale), details per kind.
  // ══════════════════════════════════════════════════════════════════════════════════
  const FAM = {
    jacket: {
      "3q": (L, fem) => [[-15, -305, 1], [-34, -296], [-52 * (fem ? 0.92 : 1), -284], [-60 * (fem ? 0.92 : 1), -266], [-62, -234], [-63, -180], [-62, -110],
        [fem ? -52 : -61, -40], [-60, 30], [-58, L - 3, 1], [-20, L], [16, L + 2, 1], [22, L, 1], [49, L - 3, 1], [51, 40],
        [fem ? 42 : 50, -40], [fem ? 56 : 52, -120], [fem ? 60 : 55, -190], [53, -248], [46 * (fem ? 0.92 : 1), -280], [33, -294], [23, -302, 1],
        [14, -292], [2, -292], [-8, -298]],
      front: (L, fem) => [[18, -302, 1], [44, -292], [70 * (fem ? 0.9 : 1), -280], [78 * (fem ? 0.9 : 1), -260], [78, -200], [fem ? 64 : 74, -110], [fem ? 58 : 72, -30], [72, 40], [70, L - 3, 1], [0, L + 2]],
      side: (L, fem) => [[-22, -304, 1], [-38, -292], [-48, -264], [-52, -200], [-52, -120], [-48, -40], [-50, 40], [-50, L - 3, 1], [30, L, 1], [34, 40], [30, -40],
        [fem ? 44 : 38, -120], [fem ? 48 : 42, -200], [38, -262], [28, -290], [16, -300, 1], [4, -292], [-10, -296]],
    },
    shirt: {
      "3q": (L, fem) => [[-15, -305, 1], [-34, -296], [-50 * (fem ? 0.92 : 1), -284], [-57 * (fem ? 0.92 : 1), -266], [-59, -234], [-59, -180], [fem ? -50 : -57, -100],
        [fem ? -48 : -55, -40], [-55, 0], [-56, L, 1], [10, L + 2], [47, L, 1], [48, 0], [fem ? 40 : 47, -40], [fem ? 50 : 50, -120], [fem ? 60 : 53, -190],
        [52, -248], [45, -280], [32, -294], [23, -302, 1], [14, -292], [2, -292], [-8, -298]],
      front: (L, fem) => [[18, -302, 1], [42, -292], [64 * (fem ? 0.9 : 1), -280], [70 * (fem ? 0.9 : 1), -260], [70, -200], [fem ? 56 : 66, -110], [fem ? 52 : 62, -30], [62, 0], [62, L, 1], [0, L + 2]],
      side: (L, fem) => [[-22, -304, 1], [-38, -292], [-46, -264], [-48, -200], [-46, -120], [-44, -40], [-46, 0], [-46, L, 1], [28, L + 2, 1], [30, 0], [28, -40],
        [fem ? 42 : 34, -120], [fem ? 46 : 38, -200], [34, -262], [26, -290], [16, -300, 1], [4, -292], [-10, -296]],
    },
    bare: {
      "3q": () => [[-15, -300, 1], [-32, -293], [-52, -282], [-62, -262], [-61, -230], [-57, -190], [-51, -130], [-46, -70], [-47, -20], [-48, 12, 1], [10, 14], [44, 12, 1],
        [44, -20], [42, -70], [46, -130], [54, -180], [57, -222], [52, -258], [44, -282], [32, -294], [23, -300, 1], [14, -294], [2, -294], [-8, -298]],
      front: () => [[16, -300, 1], [40, -292], [66, -280], [74, -258], [70, -220], [62, -160], [54, -90], [52, -20], [54, 12, 1], [0, 14]],
      side: () => [[-22, -302, 1], [-38, -290], [-46, -262], [-46, -200], [-40, -120], [-36, -60], [-40, 0], [-42, 12, 1], [26, 12, 1], [28, 0], [26, -60], [30, -130],
        [40, -190], [40, -230], [32, -270], [24, -292], [14, -300, 1], [4, -294], [-10, -296]],
    },
    bodice: {
      "3q": () => [[-12, -304, 1], [-30, -296], [-46, -285], [-54, -268], [-56, -236], [-55, -190], [-50, -140], [-45, -96], [-44, -66], [-46, -34, 1], [42, -34, 1], [41, -66],
        [42, -96], [48, -140], [58, -176], [60, -206], [55, -240], [46, -276], [32, -292], [20, -302, 1], [12, -294], [0, -294], [-8, -298]],
      front: () => [[16, -302, 1], [36, -292], [56, -280], [62, -258], [64, -210], [58, -150], [47, -96], [44, -66], [46, -34, 1], [0, -34]],
      side: () => [[-20, -304, 1], [-36, -292], [-42, -262], [-42, -200], [-36, -120], [-30, -70], [-32, -34, 1], [30, -34, 1], [28, -70], [30, -120], [46, -170],
        [48, -200], [40, -240], [28, -280], [14, -300, 1], [4, -292], [-8, -296]],
    },
    robe: {
      "3q": (L) => [[-15, -305, 1], [-36, -296], [-54, -284], [-62, -266], [-64, -230], [-64, -170], [-62, -100], [-60, -40], [-60, L, 1], [52, L, 1], [52, -40],
        [54, -100], [56, -170], [55, -240], [47, -280], [33, -294], [23, -302, 1], [14, -292], [2, -292], [-8, -298]],
      front: (L) => [[18, -302, 1], [44, -292], [70, -280], [78, -260], [78, -200], [76, -110], [74, -30], [74, L, 1], [0, L]],
      side: (L) => [[-22, -304, 1], [-40, -292], [-50, -262], [-54, -200], [-54, -120], [-52, -40], [-52, L, 1], [40, L, 1], [40, -40], [42, -120], [44, -200],
        [38, -262], [28, -290], [16, -300, 1], [4, -292], [-10, -296]],
    },
  };
  const KIND = {
    suit:    { fam: "jacket", hem: 100, top: "main", legs: "trousers", sleeve: "long", cuff: "shirt" },
    coat:    { fam: "jacket", hem: 100, top: "main", legs: "trousers", sleeve: "long", cuff: "shirt", lower: { hem: -200, flare: 26, open: 1, waist: 40 } },
    labcoat: { fam: "jacket", hem: 100, top: "main", legs: "trousers", sleeve: "long", cuff: "shirt", lower: { hem: -210, flare: 24, open: 1, waist: 40 } },
    uniform: { fam: "jacket", hem: 92, top: "main", legs: "trousers", sleeve: "long", cuff: "accent" },
    shirt:   { fam: "shirt", hem: 14, top: "second", legs: "trousers", sleeve: "long", cuff: "top" },
    work:    { fam: "shirt", hem: 14, top: "second", legs: "trousers", sleeve: "rolled", cuff: null },
    casual:  { fam: "shirt", hem: 26, top: "second", legs: "trousers", sleeve: "long", cuff: "top" },
    robe:    { fam: "robe", hem: 20, top: "main", legs: "skin", sleeve: "wide", cuff: null, lower: { hem: -26, flare: 34, waist: -60 } },
    toga:    { fam: "robe", hem: 20, top: "main", legs: "skin", sleeve: "short", cuff: null, lower: { hem: -34, flare: 30, waist: -60 } },
    tunic:   { fam: "robe", hem: 20, top: "main", legs: "skin", sleeve: "short", cuff: null, lower: { hem: -262, flare: 22, waist: -40 } },
    kilt:    { fam: "bare", hem: 12, top: "skin", legs: "skin", sleeve: "none", cuff: null, lower: { hem: -250, flare: 18, waist: -8 } },
    dress:   { fam: "bodice", hem: -34, top: "main", legs: "stock", sleeve: "puff", cuff: "second", lower: { hem: -14, flare: 84, waist: -66, bell: 1 } },
    gown:    { fam: "bodice", hem: -34, top: "main", legs: "stock", sleeve: "puff", cuff: "second", lower: { hem: -6, flare: 120, waist: -66, bell: 1 } },
  };

  // front silhouettes are authored as the half x >= 0 from the neck down to the centre of the hem
  const mirrorHalf = (half) => half.concat(half.slice(0, -1).reverse().map(([x, y, c]) => [-x, y, c])).concat([[0, half[0][1] + 10]]);

  function garment(d, C, v) {
    const of = d.outfit, K = KIND[of.kind], fem = d.sex === "f";
    const L = K.hem;
    const body = FAM[K.fam][v](L, fem);
    const topC = K.top === "skin" ? C.skin : K.top === "second" ? C.second : C.main;
    const ink = topC.ink;
    const w = (dd, c, sw = 2.2, op = 1) => `<path d="${dd}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${op < 1 ? ` opacity="${op}"` : ""}/>`;
    const f = (dd, c, st, sw = 1.3) => `<path d="${dd}" fill="${c}" ${st ? `stroke="${st}" stroke-width="${sw}"` : ""} stroke-linejoin="round"/>`;
    const btn = (x, y, r, c, st) => `<circle cx="${N(x)}" cy="${N(y)}" r="${N(r)}" fill="${c}" stroke="${st}" stroke-width="0.9"/>`;
    const k = of.kind;
    let det = "", back = "";
    const s3 = v === "3q", fr = v === "front";
    // the collar behind the neck
    if (K.fam !== "bare") back = s3 ? crv([[-15, -305, 1], [-4, -313], [12, -313.6], [23, -302, 1], [10, -304], [-2, -304]], true)
      : fr ? crv([[-18, -302, 1], [0, -312], [18, -302, 1], [0, -306]], true) : crv([[-22, -304, 1], [-6, -313], [16, -300, 1], [0, -304]], true);
    // V opening: shirt + tie + vest (suits, coats, lab coats)
    const vee = (withVest, tieC) => {
      if (s3) {
        let m = "";
        if (withVest) m += f("M-7 -295L18 -116L31 -297L22 -300L12 -292L2 -293Z", C.vest.base, C.vest.ink, 1.2);
        m += f(withVest ? "M-4 -294L13.6 -238L27 -296L12 -290Z" : "M-7 -295L16 -150L31 -297L22 -300L12 -292L2 -293Z", C.shirt.base, C.shirt.ink, 1.1);
        if (tieC) m += f(withVest ? "M10 -287L14.4 -287L16.4 -246L13.2 -236.5L10.2 -246Z" : "M10 -287L14.4 -287L17 -196L13.6 -186L10.6 -196Z", tieC.base, tieC.ink, 1);
        m += f("M-6.5 -296L5.6 -281.5L12.2 -290Z", C.shirt.base, C.shirt.ink, 1.1) + f("M28.4 -298L18.4 -283L12.2 -290Z", C.shirt.base, C.shirt.ink, 1.1);
        if (withVest) for (let i = 0; i < 4; i++) m += btn(15.4 + i * 0.8, -226 + i * 29.5, 2.5, "#D9B45E", "#7A5A26");
        return m;
      }
      if (fr) {
        let m = "";
        if (withVest) m += f("M-20 -298L0 -118L20 -298L0 -290Z", C.vest.base, C.vest.ink);
        m += f(withVest ? "M-16 -296L0 -236L16 -296L0 -290Z" : "M-20 -298L0 -150L20 -298L0 -290Z", C.shirt.base, C.shirt.ink);
        if (tieC) m += f(withVest ? "M-2.6 -286L2.6 -286L4 -246L0 -238L-4 -246Z" : "M-2.6 -286L2.6 -286L4.4 -196L0 -186L-4.4 -196Z", tieC.base, tieC.ink, 1);
        m += f("M-16 -297L-4 -282L0 -290Z", C.shirt.base, C.shirt.ink) + f("M16 -297L4 -282L0 -290Z", C.shirt.base, C.shirt.ink);
        if (withVest) for (let i = 0; i < 4; i++) m += btn(0, -222 + i * 28, 2.5, "#D9B45E", "#7A5A26");
        return m;
      }
      let m = "";
      if (withVest) m += f("M14 -298L28 -290L36 -200L30 -118L24 -200Z", C.vest.base, C.vest.ink);
      m += f("M14 -298L28 -290L32 -250L22 -262Z", C.shirt.base, C.shirt.ink);
      if (tieC) m += f("M26 -284L30 -284L33 -246L29 -240Z", tieC.base, tieC.ink, 1);
      return m;
    };
    const lapels = (notch) => s3 ? w(`M-9 -297L${-22 - notch} -262L${-15 - notch} -251L17 -121`, ink, 2.2) + w(`M32 -297L${41 + notch * 0.5} -268L${34 + notch * 0.5} -257L19 -121`, ink, 2)
      : fr ? w(`M-22 -298L${-40 - notch} -262L${-32 - notch} -252L0 -118M22 -298L${40 + notch} -262L${32 + notch} -252L0 -118`, ink, 2.2)
      : w(`M12 -298L${6 - notch * 0.5} -262L14 -252L30 -118`, ink, 2.2);
    if (k === "suit" || k === "coat" || k === "labcoat") {
      det += vee(k === "suit" || k === "labcoat", k === "labcoat" ? C.accent : C.tie) + lapels(k === "coat" ? 14 : 0);
      det += s3 ? w(`M18 -116C17 -40 16 30 15 ${L + 1}`, ink, 2.2) + btn(18.6, -111, 3.3, topC.shade, ink) : fr ? w(`M0 -116L0 ${L}`, ink, 2) + btn(0, -110, 3.3, topC.shade, ink) : w(`M30 -116L32 ${L}`, ink, 1.8);
      if (k === "suit" && s3) det += w("M-42 18L-8 20", ink, 1.5, 0.8);
      if (k === "coat") det += s3 ? btn(34, -80, 3.3, topC.shade, ink) + btn(34, -20, 3.3, topC.shade, ink) + btn(4, -80, 3, topC.shade, ink) + btn(4, -20, 3, topC.shade, ink)
        : fr ? btn(18, -80, 3.3, topC.shade, ink) + btn(18, -20, 3.3, topC.shade, ink) + btn(-18, -80, 3.3, topC.shade, ink) + btn(-18, -20, 3.3, topC.shade, ink) : "";
      if (k === "labcoat") det += s3 ? w("M-46 34L-14 36L-14 66L-46 64Z", ink, 1.4) + w("M28 -176L46 -176", ink, 1.4) + `<path d="M31 -186L33 -168" stroke="#3C5A8A" stroke-width="2.4"/>` : "";
    } else if (k === "uniform") {
      det += s3 ? f("M-8 -298L12 -289L31 -298L30 -284L12 -276L-6 -284Z", topC.shade, ink, 1.3) + w("M15 -276L18 -100L16 " + L, ink, 2)
        : fr ? f("M-18 -300L0 -290L18 -300L18 -284L0 -276L-18 -284Z", topC.shade, ink, 1.3) + w("M0 -276L0 " + L, ink, 2)
        : f("M8 -302L26 -294L30 -300L28 -286L10 -282Z", topC.shade, ink, 1.3);
      for (let i = 0; i < 5; i++) det += btn(s3 ? 16.4 + i * 0.5 : fr ? 0 : 30, -250 + i * 34, 3.2, C.accent.base, C.accent.ink);
      det += s3 ? f("M-62 -22L51 -24L51 -2L-61 0Z", C.second.base, C.second.ink, 1.3) + f("M10 -25L24 -25L24 -1L10 -1Z", C.accent.base, C.accent.ink, 1) +
        f("M-58 -286L-30 -296L-26 -288L-54 -278Z", C.accent.base, C.accent.ink, 1) + w("M-40 -210L-8 -208M20 -208L46 -210", ink, 1.4, 0.7)
        : fr ? f("M-74 -22L74 -22L74 -2L-74 -2Z", C.second.base, C.second.ink, 1.3) + f("M-8 -25L8 -25L8 -1L-8 -1Z", C.accent.base, C.accent.ink, 1) +
          f("M-72 -284L-44 -292L-42 -284L-68 -276Z", C.accent.base, C.accent.ink, 1) + f("M72 -284L44 -292L42 -284L68 -276Z", C.accent.base, C.accent.ink, 1)
        : f("M-52 -22L36 -22L36 -2L-52 -2Z", C.second.base, C.second.ink, 1.3);
    } else if (k === "shirt" || k === "work" || k === "casual") {
      const sh = C.second;
      if (k === "casual") det += s3 ? f("M-10 -299C-2 -286 18 -284 30 -299L24 -303C16 -292 0 -292 -4 -303Z", sh.shade, sh.ink, 1.2) : fr ? f("M-18 -300C-8 -286 8 -286 18 -300L14 -304C6 -294 -6 -294 -14 -304Z", sh.shade, sh.ink) : "";
      else {
        det += s3 ? f("M-8 -298L12 -283L31 -298L28 -302L12 -292L-2 -302Z", sh.shade, sh.ink, 1.2) + f("M-8 -298L6 -272L12 -286Z", sh.lit, sh.ink, 1.1) + f("M31 -298L20 -272L12 -286Z", sh.lit, sh.ink, 1.1) + w(`M13 -284L16 ${L - 4}`, sh.ink, 1.4)
          : fr ? f("M-18 -300L0 -284L18 -300L14 -304L0 -292L-14 -304Z", sh.shade, sh.ink) + f("M-18 -300L-6 -272L0 -286Z", sh.lit, sh.ink) + f("M18 -300L6 -272L0 -286Z", sh.lit, sh.ink) + w(`M0 -284L0 ${L - 4}`, sh.ink, 1.3)
          : f("M8 -302L26 -292L30 -300L14 -306Z", sh.shade, sh.ink) + w(`M28 -290L30 ${L - 4}`, sh.ink, 1.2);
        for (let i = 0; i < 4; i++) det += btn(s3 ? 14 + i * 0.5 : fr ? 0 : 29, -250 + i * 60, 2, sh.lit, sh.ink);
      }
      if (k === "shirt") {
        // trousers waistband with a belt (the shirt is tucked in); suspenders for men
        det += s3 ? f(`M-62 ${L - 12}L52 ${L - 14}L52 ${L + 6}L-61 ${L + 8}Z`, C.accent.base, C.accent.ink, 1.2) + f(`M8 ${L - 14}L22 ${L - 14}L22 ${L + 6}L8 ${L + 6}Z`, "#C9A45A", "#6E5020", 1)
          : fr ? f(`M-70 ${L - 12}L70 ${L - 12}L70 ${L + 8}L-70 ${L + 8}Z`, C.accent.base, C.accent.ink, 1.2) + f(`M-7 ${L - 12}L7 ${L - 12}L7 ${L + 8}L-7 ${L + 8}Z`, "#C9A45A", "#6E5020", 1)
          : f(`M-50 ${L - 12}L32 ${L - 12}L32 ${L + 8}L-50 ${L + 8}Z`, C.accent.base, C.accent.ink, 1.2);
        if (!fem && s3) det += w(`M-36 -288L-30 ${L - 12}M36 -284L34 ${L - 12}`, C.accent.base, 5) + w(`M-36 -288L-30 ${L - 12}M36 -284L34 ${L - 12}`, C.accent.ink, 0.8, 0.6);
      }
      if (k === "work") {
        const ap = C.accent;
        det += s3 ? f(`M-26 -226C-18 -230 36 -232 44 -226L50 -40L50 ${L + 250}L-30 ${L + 250}L-36 -40Z`, ap.base, ap.ink, 1.5) + w("M-26 -226L-14 -298M44 -226L34 -298", ap.ink, 2.6) + w("M-36 -60L50 -60", ap.fold, 1.2) + w("M-10 -140L30 -140L30 -100L-10 -100Z", ap.ink, 1.2, 0.7)
          : fr ? f(`M-40 -226C-30 -232 30 -232 40 -226L46 -40L46 ${L + 250}L-46 ${L + 250}L-46 -40Z`, ap.base, ap.ink, 1.5) + w("M-38 -226L-26 -300M38 -226L26 -300", ap.ink, 2.6) + w("M-46 -60L46 -60", ap.fold, 1.2)
          : f(`M20 -226L40 -226L44 -40L44 ${L + 250}L22 ${L + 250}L26 -40Z`, ap.base, ap.ink, 1.5);
      }
    } else if (k === "robe") {
      det += s3 ? f("M-6 -298L14 -196L32 -298L22 -302L13 -262L2 -303Z", topC.shade, ink, 1.3) + w("M-8 -297L14 -196L32 -297", C.second.base, 3.4) +
        f(`M-62 -70L54 -72L54 -46L-60 -44Z`, C.second.base, C.second.ink, 1.2) + w("M-40 -250C-36 -200 -34 -150 -36 -90M36 -240C40 -190 42 -140 40 -90", topC.fold, 1.6, 0.8)
        : fr ? f("M-18 -300L0 -196L18 -300L10 -304L0 -262L-10 -304Z", topC.shade, ink, 1.3) + w("M-20 -300L0 -196L20 -300", C.second.base, 3.4) + f("M-76 -70L76 -70L76 -46L-76 -46Z", C.second.base, C.second.ink, 1.2)
        : f("M-54 -70L40 -72L40 -46L-54 -44Z", C.second.base, C.second.ink, 1.2) + w("M18 -300L30 -200", C.second.base, 3.2);
    } else if (k === "toga") {
      // the draped mantle over the near shoulder, falling across the chest to the far hip
      const dc = C.second;
      det += s3 ? f("M-62 -270C-44 -300 -12 -304 6 -298C26 -250 46 -150 54 -30L54 20L36 22C22 -80 -4 -200 -54 -250Z", dc.base, dc.ink, 1.4) +
        w("M-44 -276C-16 -250 14 -190 34 -80M-28 -288C0 -256 24 -196 46 -100M-54 -262C-34 -240 -8 -206 10 -150", dc.fold, 1.6) + w("M-4 -298C4 -286 20 -286 28 -298", ink, 1.4)
        : fr ? f("M-76 -270C-54 -300 -20 -304 0 -298C30 -250 56 -150 70 -30L70 20L48 22C30 -80 0 -200 -64 -250Z", dc.base, dc.ink, 1.4) + w("M-56 -276C-26 -250 10 -190 36 -80M-38 -290C-6 -256 24 -196 52 -100", dc.fold, 1.6)
        : f("M-50 -270C-30 -290 0 -300 16 -296C30 -240 40 -140 40 -30L40 20L20 22C10 -80 -10 -200 -44 -250Z", dc.base, dc.ink, 1.4) + w("M-34 -270C-10 -250 10 -190 26 -80", dc.fold, 1.6);
    } else if (k === "tunic") {
      det += (s3 ? w("M-4 -298C4 -286 20 -286 28 -298", ink, 1.6) + f("M-62 -46L54 -48L54 -26L-61 -24Z", C.second.base, C.second.ink, 1.2) + w("M-30 -200C-26 -150 -26 -100 -28 -60M26 -200C30 -150 30 -100 28 -60", topC.fold, 1.4, 0.8)
        : fr ? w("M-16 -298C-6 -286 6 -286 16 -298", ink, 1.6) + f("M-76 -46L76 -46L76 -24L-76 -24Z", C.second.base, C.second.ink, 1.2)
        : f("M-54 -46L40 -48L40 -26L-54 -24Z", C.second.base, C.second.ink, 1.2));
    } else if (k === "kilt") {
      const sl = C.skin.line;
      det += s3 ? w("M-10 -283C-2 -279 8 -279 16 -284M22 -284C28 -281 34 -280 40 -282", sl, 1.4, 0.8) + w("M-10 -198C4 -176 30 -172 52 -188", sl, 1.6, 0.8) + w("M19 -186L21 -150", sl, 1.2, 0.6) +
        w("M16 -112C20 -110 25 -110 29 -112M21 -54C22 -51 22 -49 21 -46", sl, 1.3, 0.7)
        : fr ? w("M-30 -284C-18 -278 -8 -278 -2 -282M2 -282C8 -278 18 -278 30 -284", sl, 1.4, 0.8) + w("M-50 -190C-36 -170 -12 -170 -2 -186M2 -186C12 -170 36 -170 50 -190", sl, 1.6, 0.8) + w("M0 -60L0 -54", sl, 1.3, 0.7)
        : w("M10 -196C22 -176 32 -172 40 -186", sl, 1.6, 0.8);
      if (of.accent) det += s3 ? f("M-30 -296C-20 -266 20 -262 44 -290L46 -272C24 -238 -18 -240 -38 -276Z", C.accent.base, C.accent.ink, 1.2)
        : fr ? f("M-40 -292C-26 -256 26 -256 40 -292L44 -270C24 -232 -24 -232 -44 -270Z", C.accent.base, C.accent.ink, 1.2) : "";
    } else if (k === "dress" || k === "gown") {
      const bl = C.second;
      det += s3 ? f("M-6 -298C-2 -284 22 -284 30 -298L30 -310C18 -300 0 -300 -6 -310Z", bl.base, bl.ink, 1.2) + w("M13 -284L15 -70", ink, 1.4, 0.8) +
        (k === "dress" ? [0, 1, 2, 3, 4].map((i) => btn(14 + i * 0.3, -262 + i * 38, 2.2, bl.base, bl.ink)).join("") : f("M-56 -268C-30 -250 30 -250 56 -262L56 -250C30 -238 -30 -238 -56 -254Z", bl.base, bl.ink, 1)) +
        f("M-47 -72L43 -74L43 -54L-46 -52Z", C.accent.base, C.accent.ink, 1.2)
        : fr ? f("M-14 -298C-6 -284 6 -284 14 -298L14 -310C6 -300 -6 -300 -14 -310Z", bl.base, bl.ink, 1.2) + w("M0 -284L0 -70", ink, 1.4, 0.8) + f("M-46 -72L46 -72L46 -54L-46 -54Z", C.accent.base, C.accent.ink, 1.2)
        : f("M8 -300C12 -290 22 -288 28 -296L28 -308C20 -300 12 -300 8 -310Z", bl.base, bl.ink, 1.2) + f("M-32 -72L30 -72L30 -54L-32 -54Z", C.accent.base, C.accent.ink, 1.2);
    }
    const sleeve = {
      long: { C: K.top === "second" ? C.second : C.main, w: [1, 1, 1], cuff: K.cuff === "shirt" ? C.shirt : K.cuff === "accent" ? C.accent : K.cuff === "top" ? C.second : null, bare: "" },
      rolled: { C: C.second, w: [1, 1.04, 1], cuff: null, bare: "fore", rolled: true },
      wide: { C: C.main, w: [1.06, 1.24, 1.62], cuff: null, bare: "", wide: true },
      short: { C: C.main, w: [1.12, 1, 1], cuff: null, bare: "fore" },
      none: { C: C.skin, w: [0.94, 0.86, 0.8], cuff: null, bare: "all" },
      puff: { C: C.main, w: [1.34, 0.92, 0.84], cuff: C.second, bare: "" },
    }[K.sleeve];
    const legs = K.legs === "trousers" ? { C: of.kind === "coat" || of.kind === "labcoat" ? C.second : C.main, bare: false }
      : K.legs === "stock" ? { C: cloth("#3E3230"), bare: false, stock: true } : { C: C.skin, bare: true };
    return { body, back, det, hem: L, topC, rim: K.top !== "skin", lower: K.lower || null, sleeve, legs, fam: K.fam };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  //  the person
  // ══════════════════════════════════════════════════════════════════════════════════
  const LIGHT = [0.97, -0.24];      // the lit copy's offset direction (shadow falls on the back edge)
  const RIM = [0.9, 0.44];          // the rim-light copy's offset (the cream line runs along the back and top edges)

  class Person {
    constructor(S, def, layer, o = {}) {
      this.S = S; this.L = layer; this.d = normDef(def);
      this.seed = F.hash(this.d.id);
      this.R = F.rnd(this.seed);
      this.pr = proportions(this.d);
      this.x0 = o.x ?? 960; this.y0 = o.y ?? 900; this.h0 = o.h ?? 600;
      this.face0 = o.face || "right";
      this.pose0 = o.pose || "stand";
      this.opt = o;
      this.ev = { pose: [], face: [], look: [], expr: [], talk: [], move: [], blink: [] };
      this.walks = [];
      this.holding = { N: false, F: false };
      this.upright = { N: false, F: false };
      this.g = el("g", { class: "person", "data-id": this.d.id }, layer.g);
      this.views = {};
      this.cur = null;
      this.propG = { N: el("g"), F: el("g") };
      this.bothG = el("g");
      this.bothOn = false;
      this.userFront = { N: el("g"), F: el("g") };
      this._cache = { t: null };
      this.buildPalette();
      this.ensureView(viewOf(this.face0));
      // blink schedule (deterministic)
      const r = F.rnd(this.seed ^ 0xb1ec);
      this.blinks = [];
      for (let t = 0.6 + r() * 2.2; t < 600; t += 2.5 + r() * 2.5) this.blinks.push(t);
      this.phase = r() * 10;
      S.on((t) => this.update(t));
    }

    buildPalette() {
      const d = this.d, of = d.outfit;
      const C = (this.C = {});
      C.skin = skinSet(d.skin);
      C.hair = hairSet(d.hair.color);
      C.fac = hairSet(d.facial.color);
      C.main = cloth(of.main);
      C.second = cloth(of.second || F.mix(of.main, "#9A9AA2", 0.3));
      C.accent = cloth(of.accent || "#2B2730");
      C.vest = cloth(of.second || F.mix(of.main, "#8E8C94", 0.32));
      C.shirt = cloth("#F3EFE6");
      C.tie = cloth(of.accent || "#2B2730");
      C.trousers = cloth(of.kind === "coat" || of.kind === "labcoat" || of.kind === "work" && false ? of.second || of.main : of.main);
      if (of.kind === "shirt" || of.kind === "casual") C.trousers = cloth(of.main);
      if (of.kind === "labcoat") C.trousers = cloth(of.second);
      if (of.kind === "coat") C.trousers = cloth(of.second);
      C.top = cloth({ shirt: of.second, work: of.second, casual: of.second }[of.kind] || of.main);
      C.sleeve = C.top;
      C.eye = { iris: d.eyes, dark: F.mix(d.eyes, "#10141c", 0.7), lite: F.mix(d.eyes, "#FFFFFF", 0.36), ink: F.mix(d.eyes, "#0d1016", 0.74) };
      const shoe = { shoes: "#4A3226", boots: "#3E2A1E", sandals: "#8A6040", bare: d.skin }[d.footwear];
      C.shoe = cloth(shoe);
      const hatC = { bowler: "#3D2F28", flatcap: "#686A70", tophat: "#2A2627", fedora: "#6B5A48", wreath: "#6E8C4A", headcloth: "#EDE6D2",
        bonnet: "#E8DCC4", cap: "#44506A", helmet: "#8A8266" }[d.hat] || "#555";
      C.hat = { fill: hatC, fill2: F.mix(hatC, DARK, 0.14), band: { bowler: "#6B3A30", tophat: "#3A3030", fedora: "#3E3026", wreath: "#8A7A3A", headcloth: "#3A2E28", bonnet: "#B45A5A" }[d.hat] || F.mix(hatC, DARK, 0.3), hi: F.mix(hatC, "#FFF4E0", 0.35), ink: F.mix(hatC, DARK, 0.6) };
      if (d.hat === "wreath") C.hat.fill2 = "#8AA85A";
    }

    // ── DOM for one view ──────────────────────────────────────────────────────────
    ensureView(v) {
      if (this.views[v]) return this.views[v];
      const L = this.L, defs = L.defs, C = this.C, d = this.d, pr = this.pr;
      const root = el("g", { style: "display:none" }, this.g);
      const V = { v, root, parts: {} };
      this.views[v] = V;
      const grad = (key, stops, x2 = 0, y2 = 1) => { L._ppg = L._ppg || {}; return L._ppg[key] || (L._ppg[key] = F.lg(defs, stops, 0, 0, x2, y2)); };
      const radial = (key, stops) => { L._ppg = L._ppg || {}; return L._ppg[key] || (L._ppg[key] = F.rg(defs, stops, 0.5, 0.5, 0.5)); };
      const litG = (c) => grad("lit" + c.base, [[0, c.lit], [1, c.base]]);
      V.ground = el("ellipse", { cx: 0, cy: 0, rx: 150, ry: 22, fill: radial("gsh", [[0, "#2a1a10", 0.3], [0.6, "#2a1a10", 0.14], [1, "#2a1a10", 0]]) }, root);
      if (this.opt.shadow === false) V.ground.setAttribute("display", "none");
      V.hairBack = el("g", null, root);
      const slots = {};
      for (const s of ["armFback", "legF", "legN", "lower", "torsoBack", "neck", "torso", "armFfront", "head", "armN"]) slots[s] = el("g", null, root);
      V.slots = slots;
      const sw = 3.4;        // body outline width (body units)
      const mk = (parent, fillC, o = {}) => shapeUse(parent, defs, {
        fill: o.flat ? fillC.base : litG(fillC), shade: o.noShade ? null : fillC.shade, ink: fillC.ink, sw: o.sw || sw,
        off: o.off || mul(LIGHT, o.sh || 12), rim: o.rim === false ? null : fillC.rim, rimOff: mul(RIM, o.rimW || 3.6), d: o.d,
      });

      const GM = (V.gm = garment(d, C, v));
      // arms (the far arm lives in armFback or armFfront)
      const SL = GM.sleeve;
      const armOf = (key) => {
        const g = el("g", null, key === "F" ? slots.armFback : slots.armN);
        const fore = SL.bare === "fore" ? mk(g, C.skin, { sh: 8, rim: false, sw: 3 }) : null;
        const sleeve = mk(g, SL.bare === "all" ? C.skin : SL.C, { sh: 11, rimW: 3, sw: 3.2, rim: SL.bare !== "all" });
        const roll = SL.rolled ? el("path", { d: "", fill: SL.C.lit, stroke: SL.C.ink, "stroke-width": 2.6, "stroke-linejoin": "round" }, g) : null;
        const hand = el("g", null, g);
        const cuff = el("path", { d: SL.wide ? "M-15 -6L15 -6L15.4 2L-15.4 2Z" : "M-17 -9L17 -9L17.4 3.4L-17.4 3.4Z", fill: SL.cuff ? SL.cuff.base : "none",
          stroke: SL.cuff ? SL.cuff.ink : "none", "stroke-width": 1.4, "stroke-linejoin": "round" }, hand);
        const handBack = el("g", null, hand);
        const prop = el("g", null, g);
        const front = el("g", null, g);
        const user = el("g", null, g);
        return { g, sleeve, fore, roll, hand, cuff, handBack, prop, front, user, shape: null };
      };
      V.arm = { N: armOf("N"), F: armOf("F") };
      // legs: trousers (the shoe under the hem), stockings, or bare skin (the foot over the leg)
      const legOf = (key) => {
        const g = el("g", null, key === "F" ? slots.legF : slots.legN);
        const bare = GM.legs.bare;
        const shoe = bare ? null : el("g", null, g);
        const leg = mk(g, GM.legs.C, { sh: 12, rimW: 3.4, rim: !bare && !GM.legs.stock });
        const shoe2 = shoe || el("g", null, g);
        this.drawShoe(shoe2, key, v);
        return { g, leg, shoe: shoe2, bare, stock: !!GM.legs.stock };
      };
      V.leg = { N: legOf("N"), F: legOf("F") };
      // lower garment (skirt / robe / coat tails): a hull around the legs, rebuilt every frame
      V.lower = null;
      if (GM.lower) {
        const col = GM.lower.open ? C.main : GM.topC === C.skin ? C.main : GM.topC;
        const lg = el("g", null, slots.lower);
        V.lower = { s: mk(lg, d.outfit.kind === "kilt" ? C.main : col, { sh: 18, rimW: 3.4 }), spec: GM.lower, kind: d.outfit.kind,
          folds: el("path", { fill: "none", stroke: (d.outfit.kind === "kilt" ? C.main : col).fold, "stroke-width": 1.8, "stroke-linecap": "round", opacity: 0.75 }, lg) };
      }
      // torso
      const tg = el("g", null, slots.torso), tb = el("g", null, slots.torsoBack);
      V.torsoG = tg; V.torsoBackG = tb;
      if (GM.back) el("path", { d: GM.back, fill: GM.topC.shade, stroke: GM.topC.ink, "stroke-width": 2.4, "stroke-linejoin": "round" }, tb);
      const bodyShape = mk(tg, GM.topC, { sh: v === "front" ? 14 : 26, rimW: 4.6, d: crv(v === "front" ? mirrorHalf(GM.body) : GM.body, true), rim: GM.rim });
      if (GM.det) F.svg(GM.det, bodyShape.cg);
      V.hem = GM.hem;
      // neck
      V.neck = shapeUse(slots.neck, defs, { fill: C.skin.shade, shade: C.skin.base, ink: C.skin.ink, sw: 3, off: v === "front" ? [0, -6] : [-9, -4], d: "M0 0" });
      // head
      V.headG = el("g", null, slots.head);
      V.hairBackG = el("g", null, V.hairBack);
      this.buildHead(V, v);
      // z-slot of the far arm
      V.zF = 0;
      return V;
    }

    drawShoe(g, key, v) {
      const C = this.C, fw = this.d.footwear;
      const k = this.d.age === "child" ? 0.92 : this.d.sex === "f" ? 0.86 : 1;
      const s = `transform="translate(0 ${N(this.pr.ankle - 42 * k)}) scale(${k})"`;
      if (v === "front") {
        const bare = fw === "bare" || fw === "sandals";
        const c = bare ? C.skin : C.shoe, sd = key === "N" ? -1 : 1;
        let m = `<path d="M-19 41C-23 32 -17 17 ${N(sd * 2)} 15C18 16 23 31 19 41C12 44 -12 44 -19 41Z" fill="${c.base}" stroke="${c.ink}" stroke-width="2.6" stroke-linejoin="round"/>`;
        if (!bare) m += `<path d="M-16 39.5L16 39.5" stroke="${c.ink}" stroke-width="2.2"/><path d="M-8 22C-2 20 4 20 9 22" fill="none" stroke="${c.lit}" stroke-width="2.2" stroke-linecap="round" opacity="0.7"/>`;
        else m += `<path d="M-10 38L-10 41M-4 38L-4 42M2 38L2 42M8 38L8 41" stroke="${C.skin.line}" stroke-width="1.2"/>`;
        if (fw === "sandals") m += `<path d="M-20 41L20 41L20 45L-20 45Z" fill="${C.shoe.base}" stroke="${C.shoe.ink}" stroke-width="1.4"/><path d="M-16 26L16 26" stroke="${C.shoe.base}" stroke-width="4"/>`;
        F.svg(`<g ${s}>${m}</g>`, g);
        return;
      }
      if (fw === "bare" || fw === "sandals") {
        const sk = C.skin;
        let m = `<path d="M-20 38C-24 28 -20 10 -6 4C4 2 14 12 30 22C44 30 56 30 58 36C60 41 54 42 44 42L-14 42C-18 42 -20 41 -20 38Z" fill="${sk.base}" stroke="${sk.ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
          `<path d="M40 34C42 36 44 37 47 37" fill="none" stroke="${sk.line}" stroke-width="1.4"/>`;
        if (fw === "sandals") m += `<path d="M-22 41L58 41L57 45L-21 45Z" fill="${C.shoe.base}" stroke="${C.shoe.ink}" stroke-width="1.6"/>` +
          `<path d="M-8 8C0 20 12 26 22 22M18 18C22 28 26 34 30 38" fill="none" stroke="${C.shoe.base}" stroke-width="4"/>`;
        F.svg(`<g ${s}>${m}</g>`, g);
        return;
      }
      const c = C.shoe;
      let m = `<path d="M-23 40C-25 26 -21 12 -8 6C4 2 14 8 26 16C40 24 56 26 60 33C62.6 38 58 42 50 42L-18 42C-21 42 -23 41.4 -23 40Z" fill="${c.base}" stroke="${c.ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
        `<path d="M-22 39.5L60 39.5" stroke="${c.ink}" stroke-width="2.4"/>` +
        `<path d="M8 14C18 17 32 23 46 27" fill="none" stroke="${c.lit}" stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>`;
      if (fw === "boots") m = `<path d="M-22 -40L10 -40L12 8C24 16 44 22 56 28C62 32 60 42 50 42L-18 42C-22 42 -24 40 -24 36Z" fill="${c.base}" stroke="${c.ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
        `<path d="M-23 39.5L60 39.5" stroke="${c.ink}" stroke-width="2.4"/><path d="M-6 -30L-4 6" stroke="${c.lit}" stroke-width="2.6" opacity="0.6" stroke-linecap="round"/>`;
      F.svg(`<g ${s}>${m}</g>`, g);
    }

    // ── the head (head units) ───────────────────────────────────────────────────
    buildHead(V, v) {
      const C = this.C, d = this.d, L = this.L, defs = L.defs, G = HEAD[v];
      const hg = V.headG, sk = C.skin;
      const H = (V.head = { eyes: [], brows: [] });
      const hsp = Object.assign({}, HAIRSPEC[d.hair.style]);
      const hair = hsp.none ? null : (v === "3q" ? hair3q(hsp) : v === "front" ? hairFront(hsp) : hairSide(hsp));
      const hc = C.hair;
      const hairStroke = 1.3;
      // back hair (behind the whole body)
      if (hair && (hair.back || hair.extra)) {
        let m = "";
        if (hair.back) m += `<path d="${hair.back}" fill="${hc.shade}" stroke="${hc.ink}" stroke-width="${hairStroke}" stroke-linejoin="round"/>`;
        if (hair.extra) m += `<path d="${hair.extra}" fill="${hc.base}" stroke="${hc.ink}" stroke-width="${hairStroke}" stroke-linejoin="round"/>`;
        if (hsp.extra === "braid") m += `<path d="${v === "front" ? "M-38 -16L-32 -12M-39 0L-32 4M-39 16L-33 20M-38 32L-34 36" : "M-50 -40L-43 -36M-51 -24L-43 -20M-51 -8L-43 -4M-51 8L-43 12M-50 24L-44 28M-49 38L-45 42"}" fill="none" stroke="${hc.ink}" stroke-width="1.1"/>`;
        F.svg(m, V.hairBackG);
      }
      // ears behind the head (front view)
      if (v === "front") for (const e of G.ears) this.drawEar(hg, e, v, true);
      // skull + face
      const facePts = d.age === "child" && G.faceRound ? G.faceRound : G.face;
      H.skin = shapeUse(hg, defs, { fill: this.grad("face" + sk.base, [[0, sk.lit], [0.55, sk.base], [1, sk.base]]), shade: sk.shade, ink: sk.ink, sw: 1.5, off: G.shadowOff, d: crv(facePts, true) });
      if (d.hair.style === "bald" || d.hair.style === "balding") el("ellipse", { cx: v === "front" ? 6 : v === "side" ? 2 : 6, cy: -88, rx: 15, ry: 6, fill: "#FFFFFF", opacity: 0.14, transform: "rotate(-8)" }, H.skin.cg);
      // stubble
      if (d.facial.beard === "stubble" || (d.facial.beard === "none" && d.sex === "m" && d.age !== "child" && this.R() < 0)) {
        el("path", { d: beardPath("full", v), fill: C.fac.base, opacity: 0.16 }, H.skin.cg);
      }
      // ear (3q / side)
      if (v !== "front") this.drawEar(hg, G.ear, v, false);
      // blush
      H.blush = el("g", null, hg);
      const bl = this.radial("blush" + sk.blush, [[0, sk.blush, 0.55], [0.55, sk.blush, 0.3], [1, sk.blush, 0]]);
      for (const b of G.blush) el("ellipse", { cx: b[0], cy: b[1], rx: b[2], ry: b[3], fill: bl }, H.blush);
      // features that shift with the look
      const feat = (H.feat = el("g", null, hg));
      if (G.noseTip) el("ellipse", { cx: G.noseTip[0], cy: G.noseTip[1], rx: G.noseTip[2], ry: G.noseTip[3], fill: bl, opacity: 0.7 }, feat);
      if (G.nose) el("path", { d: G.nose, fill: "none", stroke: sk.line, "stroke-width": 1.25, "stroke-linecap": "round" }, feat);
      // old age lines
      if (d.age === "old") {
        const m = v === "3q" ? "M8 -76C14 -78 22 -78 28 -76M5 -71C12 -72.6 20 -72.6 27 -71M-9 -40C-7 -37 -4 -35.6 -1 -35.4M24.4 -30C22.6 -26 21.4 -22.4 22 -19"
          : v === "front" ? "M-14 -76C-4 -78 4 -78 14 -76M-12 -71C-4 -72.4 4 -72.4 12 -71M-9 -28C-10 -24 -10 -21 -8 -18M9 -28C10 -24 10 -21 8 -18"
          : "M22 -76C26 -77 30 -76.4 32 -75M30 -30C28 -26 28 -22 29 -19";
        el("path", { d: m, fill: "none", stroke: sk.line, "stroke-width": 0.9, "stroke-linecap": "round", opacity: 0.7 }, feat);
      }
      // beard (under the mouth)
      if (d.facial.beard !== "none" && d.facial.beard !== "stubble") {
        const fc = C.fac;
        F.svg(`<path d="${beardPath(d.facial.beard, v)}" fill="${fc.base}" stroke="${fc.ink}" stroke-width="1.2" stroke-linejoin="round"/>` +
          (d.facial.beard === "long" || d.facial.beard === "full" ? `<path d="${v === "front" ? "M-10 -2C-8 6 -6 12 -4 18M10 -2C8 6 6 12 4 18" : v === "3q" ? "M4 -3C6 4 9 10 12 16M18 -4C18 4 17 10 16 16" : "M16 -2C18 6 20 12 22 16"}" fill="none" stroke="${fc.hi}" stroke-width="1.3" stroke-linecap="round" opacity="0.8"/>` : ""), feat);
      }
      // eyes
      for (const e of G.eyes) H.eyes.push(this.makeEye(feat, e, v));
      for (const b of G.brows) {
        const B = BROWS[b.t], g = el("g", { transform: tr(b.cx, b.cy) }, feat);
        const bw = d.sex === "f" ? 0.78 : d.age === "child" ? 0.9 : 1.05;
        const p = el("path", { d: taper(B.pts, B.ws.map((w) => w * bw)), fill: F.mix(C.hair.base, DARK, 0.25), stroke: "none" }, g);
        H.brows.push({ g, cx: b.cx, cy: b.cy, t: b.t, p });
      }
      // mouth
      const mg = el("g", { transform: tr(G.mouth[0], G.mouth[1]) }, feat);
      H.mouthG = mg;
      const mid = F.uid("pm");
      H.mouth = el("path", { id: mid, d: "M-3 0L3 0Z", fill: "#6E2A26", stroke: sk.ink, "stroke-width": 1.15, "stroke-linejoin": "round", "stroke-linecap": "round" }, mg);
      const mcl = F.uid("pmc"), cp = el("clipPath", { id: mcl }, defs);
      el("use", { href: "#" + mid }, cp);
      const inner = el("g", { "clip-path": `url(#${mcl})` }, mg);
      H.tongue = el("ellipse", { cx: 0.5, cy: 5, rx: 4, ry: 2.8, fill: "#D9716B" }, inner);
      H.teeth = el("rect", { x: -8, y: -6, width: 16, height: 2.2, fill: "#FBF7EF", opacity: 0 }, inner);
      H.mouthView = G.mouth[2];
      if (d.sex === "f" && d.age !== "child") H.lip = el("path", { d: "", fill: "none", stroke: F.mix(sk.base, "#C8504C", 0.62), "stroke-width": 1.9, "stroke-linecap": "round", opacity: 0.9 }, mg);
      // moustache
      if (d.facial.moustache !== "none") {
        const fc = C.fac;
        H.stache = el("g", { transform: tr(G.mouth[0], G.mouth[1]) }, feat);
        F.svg(`<path d="${moustachePts(d.facial.moustache, v)}" fill="${fc.base}" stroke="${fc.ink}" stroke-width="1.2" stroke-linejoin="round"/>` +
          `<path d="M-6 -5.2C-2 -6.4 2 -6.4 5 -5.4" fill="none" stroke="${fc.hi}" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/>`, H.stache);
      }
      // glasses
      if (d.glasses) F.svg(glassesMarkup(v, "#3A2A20"), feat);
      // hair cap
      if (hair) {
        const cap = shapeUse(hg, defs, { fill: this.grad("hair" + hc.base, [[0, hc.base], [1, hc.shade]]), shade: hc.shade, ink: hc.ink, sw: hairStroke, off: v === "front" ? [0, -2.6] : [-3.4, -2.2], d: hair.cap });
        if (hair.hi) el("path", { d: hair.hi, fill: hc.hi, opacity: 0.75 }, cap.cg);
        if (hair.lines.length) el("path", { d: hair.lines.join(""), fill: "none", stroke: hc.strand, "stroke-width": 1, "stroke-linecap": "round", opacity: 0.8 }, cap.cg);
        H.cap = cap;
      }
      // hat
      if (d.hat !== "none") {
        const m = hatMarkup(d.hat, v, C.hat, hsp.vol || 0);
        if (m) F.svg(m, hg);
      }
    }

    grad(key, stops, x2 = 0, y2 = 1) { const L = this.L; L._ppg = L._ppg || {}; return L._ppg[key] || (L._ppg[key] = F.lg(L.defs, stops, 0, 0, x2, y2)); }
    radial(key, stops) { const L = this.L; L._ppg = L._ppg || {}; return L._ppg[key] || (L._ppg[key] = F.rg(L.defs, stops, 0.5, 0.5, 0.5)); }

    drawEar(parent, e, v, behind) {
      const sk = this.C.skin;
      const s = e.s, g = el("g", { transform: `translate(${N(e.cx)} ${N(e.cy)}) scale(${s} 1)` }, parent);
      if (v === "front") {
        F.svg(`<path d="M-2 -11C4 -13 8 -8 7.6 -1C7.2 6 4 11 -1 11.6C-3 11.8 -4 10 -4 8L-4 -8C-4 -10 -3.4 -10.8 -2 -11Z" fill="${sk.base}" stroke="${sk.ink}" stroke-width="1.3" stroke-linejoin="round"/>` +
          `<path d="M-1 -7C3 -8 5 -4 4.4 0C4 4 2 6 0 6" fill="none" stroke="${sk.line}" stroke-width="1" stroke-linecap="round"/>`, g);
        return g;
      }
      F.svg(`<path d="M7.8 -9.8C4.8 -13.8 -1.2 -14.8 -5.6 -12.2C-9.6 -9.6 -10.8 -3.8 -10.2 1.8C-9.6 7.8 -6 12.8 -0.8 13.4C3.4 13.8 6.6 11.4 8 7.8C8.8 5.4 8.8 2.6 8.4 0Z" fill="${sk.base}" stroke="${sk.ink}" stroke-width="1.35" stroke-linejoin="round"/>` +
        `<path d="M5 -6.8C2.4 -9.6 -2.2 -9.6 -4.6 -6.8C-6.8 -4 -6.6 1 -5.4 4C-4.4 6.6 -2 8.2 0.6 8C3 7.6 4.2 5.4 4.6 2.6Z" fill="${sk.shade}" opacity="0.55"/>` +
        `<path d="M5.4 -7C2.6 -10 -2.6 -10 -5.2 -6.8C-7.6 -4 -7.4 1.4 -6 4.6C-4.6 7.8 -1.6 9.6 1.4 8.6" fill="none" stroke="${sk.ink}" stroke-width="1.05" stroke-linecap="round"/>` +
        `<path d="M2.6 -3.2C-0.2 -4.2 -2.6 -2.2 -2.4 0.6C-2.2 2.8 -0.6 3.8 1.2 3.2" fill="none" stroke="${sk.ink}" stroke-width="0.95" stroke-linecap="round"/>`, g);
      return g;
    }

    makeEye(parent, e, v) {
      const E = EYES[e.t], C = this.C, L = this.L, defs = L.defs;
      const es = this.d.age === "child" ? 1.13 : this.d.sex === "f" ? 1.05 : 1;
      const g = el("g", { transform: tr(e.cx, e.cy) + (es !== 1 ? ` scale(${es})` : "") }, parent);
      const apId = F.uid("pea"), clId = F.uid("pec");
      const geo = eyeGeom(E, 0, 0);
      const ap = el("path", { id: apId, d: eyeAperture(geo) }, defs);
      const cp = el("clipPath", { id: clId }, defs); el("use", { href: "#" + apId }, cp);
      const white = el("use", { href: "#" + apId, fill: this.grad("sclera", [[0, "#C8CCD8"], [0.38, "#FBFAF6"], [1, "#FFFFFF"]]) }, g);
      const inner = el("g", { "clip-path": `url(#${clId})` }, g);
      const irisG = el("g", null, inner);
      const [ix, iy, irx, iry] = E.iris;
      const ic = C.eye;
      const irisFill = this.grad("iris" + ic.iris, [[0, ic.dark], [0.42, F.mix(ic.iris, "#10141c", 0.2)], [0.8, ic.iris], [1, ic.lite]]);
      el("ellipse", { cx: ix, cy: iy, rx: irx, ry: iry, fill: irisFill, stroke: ic.ink, "stroke-width": 0.75 }, irisG);
      el("ellipse", { cx: ix, cy: iy + iry * 0.52, rx: irx * 0.62, ry: iry * 0.28, fill: ic.lite, opacity: 0.55 }, irisG);
      el("ellipse", { cx: ix + 0.2, cy: iy - 0.2, rx: irx * 0.46, ry: iry * 0.5, fill: "#1B1820" }, irisG);
      el("circle", { cx: ix - irx * 0.34, cy: iy - iry * 0.36, r: Math.max(1.1, irx * 0.34), fill: "#FFFFFF" }, irisG);
      el("circle", { cx: ix + irx * 0.4, cy: iy + iry * 0.36, r: Math.max(0.6, irx * 0.15), fill: "#FFFFFF", opacity: 0.9 }, irisG);
      // lid shadow line on the white under the lash
      const lash = el("path", { d: lashPath(E, geo), fill: "#2A1C18", stroke: "#2A1C18", "stroke-width": 0.3, "stroke-linejoin": "round" }, g);
      const n = E.xs.length;
      const lowIdx = E.heavy > 0 ? [1, Math.floor(n / 2)] : [Math.ceil(n / 2) - 1, n - 2];
      const lower = el("path", { d: "", fill: "none", stroke: C.skin.ink, "stroke-width": 0.95, "stroke-linecap": "round" }, g);
      const closed = el("path", { d: "", fill: "none", stroke: "#2A1C18", "stroke-width": 1.9, "stroke-linecap": "round", display: "none" }, g);
      const flick = this.d.sex === "f" && this.d.age !== "child" ? el("path", { d: "", fill: "none", stroke: "#2A1C18", "stroke-width": 1.2, "stroke-linecap": "round" }, g) : null;
      return { g, E, ap, white, inner, irisG, lash, lower, closed, flick, lowIdx, key: "", t: e.t };
    }

    // ── timeline API ────────────────────────────────────────────────────────────
    _dirty() { this._cache = { t: null }; this._skT = null; this._skC = null; }
    pose(name, t0 = 0, dur = 0.5, opts) {
      this._dirty();
      if (!POSES[name]) name = "stand";
      this.ev.pose.push({ t0, dur: Math.max(0, dur), name, opts: opts || {} });
      this.ev.pose.sort((a, b) => a.t0 - b.t0);
      if (name === "ride") this.ensureView("side");
      return this;
    }
    face(dir, t0 = 0) { this._dirty(); this.ev.face.push({ t0, face: dir }); this.ev.face.sort((a, b) => a.t0 - b.t0); this.ensureView(viewOf(dir)); return this; }
    look(dir, t0 = 0, dur = 0.3) { this._dirty(); this.ev.look.push({ t0, dur, dir }); this.ev.look.sort((a, b) => a.t0 - b.t0); return this; }
    expr(name, t0 = 0, dur = 0.25) { this._dirty(); if (!EXPR[name]) name = "neutral"; this.ev.expr.push({ t0, dur, name }); this.ev.expr.sort((a, b) => a.t0 - b.t0); return this; }
    talk(t0, t1, amount = 1) { this._dirty(); this.ev.talk.push({ t0, t1, a: amount }); return this; }
    blink(t0) { this._dirty(); this.blinks.push(t0); this.blinks.sort((a, b) => a - b); return this; }
    set(o = {}) {
      this._dirty();
      if (o.x != null) this.x0 = o.x; if (o.y != null) this.y0 = o.y; if (o.h != null) this.h0 = o.h;
      if (o.face) { this.face0 = o.face; this.ensureView(viewOf(o.face)); }
      return this;
    }
    move(keys) {
      this._dirty();
      const K = keys.map((k) => ({ t: k[0], x: k[1], y: k[2], h: k[3] }));
      if (!K.length) return this;
      this.ev.move.push({ t0: K[0].t, t1: K[K.length - 1].t, K, kind: "move" });
      this.ev.move.sort((a, b) => a.t0 - b.t0);
      return this;
    }
    walk(t0, t1, x0, x1, y0, y1, o = {}) { return this.locomote("walk", t0, t1, x0, x1, y0, y1, o); }
    run(t0, t1, x0, x1, y0, y1, o = {}) { return this.locomote("run", t0, t1, x0, x1, y0, y1, o); }

    locomote(kind, t0, t1, x0, x1, y0, y1, o) {
      this._dirty();
      const base = this.posAt(t0 - 1e-4);
      if (x0 == null) x0 = base.x;
      if (y0 == null) y0 = base.y;
      if (y1 == null) y1 = y0;
      const h = base.h, k = h / 1000;
      const Dpx = Math.hypot(x1 - x0, y1 - y0), D = Dpx / k;
      const run = kind === "run";
      const Lnom = (run ? 520 : this.pr.stride) * (o.stride || 1), tauN = run ? 0.33 : 0.525;
      const T = Math.max(0.3, t1 - t0);
      // choose the number of steps: stride stays near 0.28 h (cartoon legs look wrong beyond ~0.33 h), cadence absorbs the rest
      let best = null;
      for (let n = 2; n < 600; n++) {
        const Ls = D / (n - 1), tau = T / n;
        let c = 3 * Math.log(Math.max(Ls, 1) / Lnom) ** 2 + Math.log(tau / tauN) ** 2;
        if (Ls > Lnom * 1.18) c += 50 * (Ls / Lnom - 1.18);
        if (tau < (run ? 0.2 : 0.3)) c += 50 * ((run ? 0.2 : 0.3) - tau);
        if (!best || c < best.c) best = { n, Ls, tau, c };
        if (Ls < Lnom * 0.3) break;
      }
      if (D < 30) best = { n: 2, Ls: D, tau: T / 2 };
      const W = { kind, t0, t1: t0 + T, x0, x1, y0, y1, D, k, n: best.n, Ls: best.Ls, tau: best.tau, dir: x1 >= x0 ? 1 : -1,
                  h0: h, h1: o.h != null ? o.h : h };
      // pelvis progress knots (units along the path)
      // the pelvis is midway between the feet when a heel lands (0.9 of each step for a walk, the step end for a run)
      const land = run ? 1 : 0.9, lag = run ? 0.3 : 0.5;     // a runner lands with the foot nearly under the body
      const knots = [[t0, 0]];
      for (let i = 1; i < W.n; i++) knots.push([t0 + (i - 1 + land) * W.tau, (i - lag) * W.Ls]);
      knots.push([W.t1, D]);
      W.knots = knots;
      this.walks.push(W);
      this.walks.sort((a, b) => a.t0 - b.t0);
      this.ev.move.push({ t0: W.t0, t1: W.t1, W, kind: "walk" });
      this.ev.move.sort((a, b) => a.t0 - b.t0);
      this._dirty();
      // facing follows the walk direction
      const cur = this.faceAt(t0);
      const prof = /profile/.test(cur);
      const nf = prof ? (W.dir > 0 ? "profile-right" : "profile-left") : (W.dir > 0 ? "right" : "left");
      if (nf !== cur) this.face(nf, t0 - 0.01);
      return this;
    }

    // ── evaluation ───────────────────────────────────────────────────────────────
    faceAt(t) {
      let f = this.face0;
      for (const e of this.ev.face) if (e.t0 <= t) f = e.face; else break;
      return f;
    }
    posAt(t) {
      let x = this.x0, y = this.y0, h = this.h0, walk = null;
      for (const m of this.ev.move) {
        if (m.t0 > t) break;
        if (m.kind === "move") {
          const K = m.K;
          const tt = Math.min(t, m.t1);
          x = K.length > 2 ? F.pchip(tt, K.map((k) => [k.t, k.x])) : F.keys(tt, K.map((k) => [k.t, k.x]));
          y = K.length > 2 ? F.pchip(tt, K.map((k) => [k.t, k.y])) : F.keys(tt, K.map((k) => [k.t, k.y]));
          if (K[0].h != null) h = F.keys(tt, K.map((k) => [k.t, k.h ?? h]));
        } else {
          const W = m.W;
          const s = t >= W.t1 ? W.D : F.pchip(t, W.knots);
          const p = W.D > 1e-6 ? s / W.D : 1;
          x = lerp(W.x0, W.x1, p); y = lerp(W.y0, W.y1, p); h = lerp(W.h0, W.h1, p);
          if (t < W.t1 + 0.4) walk = { W, s };
        }
      }
      return { x, y, h, walk };
    }

    poseAt(t) {
      const E = this.ev.pose;
      let j = -1;
      for (let i = 0; i < E.length; i++) { if (E[i].t0 <= t) j = i; else break; }
      return this.poseEval(j, t, 0);
    }
    poseEval(j, t, depth) {
      const E = this.ev.pose;
      if (j < 0) return this.animPose(flatPose(this.pose0, this.opt.poseOpts), t, t + 100);
      const e = E[j];
      const tgt = this.animPose(flatPose(e.name, e.opts), t, t - e.t0, e.opts);
      const w = e.dur > 0 ? smr((t - e.t0) / e.dur) : 1;
      if (w >= 1 || depth > 6) return tgt;
      return blendPose(this.poseEval(j - 1, t, depth + 1), tgt, w);
    }
    // animated poses (loops): pure functions of time
    animPose(p, t, tl, opts) {
      if (!p.anim) return p;
      const ph = this.phase;
      if (p.anim === "wave") {
        const a = Math.sin((t + ph) * 2 * Math.PI * 1.7);
        const k = p.active === "N" ? "aN" : "aF";
        p[k + "el"] += 16 * a; p[k + "wr"] += 10 * a;
      } else if (p.anim === "hammer") {
        const cyc = 0.9, u = (((t + ph) % cyc) + cyc) % cyc / cyc;
        // raise slowly (0 → 0.72), strike fast (0.72 → 0.82), rest
        const up = u < 0.72 ? sm(u / 0.72) : u < 0.82 ? 1 - F.eIn((u - 0.72) / 0.1) : 0;
        const k = p.active === "F" ? "aF" : "aN";
        p[k + "sh"] = lerp(38, 50, up); p[k + "el"] = lerp(38, 84, up); p[k + "wr"] = lerp(-6, -34, up);
        p.lean += 2 * (1 - up);
      } else if (p.anim === "write") {
        const k = p.active === "F" ? "aF" : "aN";
        const a = (t + ph) * 2 * Math.PI;
        p[k + "sh"] += 2.2 * Math.sin(a * 1.9) + 1.2 * Math.sin(a * 0.37);
        p[k + "el"] += 3 * Math.sin(a * 1.9 + 1.3);
        p[k + "wr"] += 6 * Math.sin(a * 3.8);
      } else if (p.anim === "ride") {
        p.ride = 1;
      }
      return p;
    }
    exprAt(t) {
      const E = this.ev.expr;
      let j = -1;
      for (let i = 0; i < E.length; i++) { if (E[i].t0 <= t) j = i; else break; }
      const ev = (i, dp) => {
        if (i < 0) return Object.assign({}, EXPR.neutral);
        const e = E[i], tg = EXPR[e.name], w = e.dur > 0 ? sm((t - e.t0) / e.dur) : 1;
        if (w >= 1 || dp > 5) return Object.assign({}, tg);
        const a = ev(i - 1, dp + 1), o = {};
        for (const k of EXK) o[k] = lerp(a[k], tg[k], w);
        return o;
      };
      return ev(j, 0);
    }
    lookAt(t, head) {
      // returns {gx, gy, tilt, fx}
      const E = this.ev.look;
      const tgt = (dir) => {
        if (Array.isArray(dir)) {
          const m = head.m, dx = (dir[0] - head.x) * m, dy = dir[1] - head.y, l = Math.hypot(dx, dy) || 1;
          const ux = dx / l, uy = dy / l;
          return { gx: clamp(ux * 1.25, -1, 1), gy: clamp(uy * 1.5, -1, 1), tilt: clamp(uy * 14, -14, 10), fx: clamp(ux * 1.8, -2.5, 1.5) };
        }
        const m = head.m;
        switch (dir) {
          case "right": return { gx: m, gy: 0.05, tilt: 0, fx: m > 0 ? 1 : -2.4 };
          case "left": return { gx: -m, gy: 0.05, tilt: 0, fx: m > 0 ? -2.4 : 1 };
          case "up": return { gx: 0.3, gy: -1, tilt: -12, fx: 0 };
          case "down": return { gx: 0.3, gy: 1, tilt: 10, fx: 0 };
          case "camera": return { gx: -0.5, gy: 0, tilt: 0, fx: -1.8 };
          default: return { gx: 0.35, gy: 0.05, tilt: 0, fx: 0 };
        }
      };
      let j = -1;
      for (let i = 0; i < E.length; i++) { if (E[i].t0 <= t) j = i; else break; }
      const ev = (i, dp) => {
        if (i < 0) return tgt("ahead");
        const e = E[i], b = tgt(e.dir), w = e.dur > 0 ? sm((t - e.t0) / e.dur) : 1;
        if (w >= 1 || dp > 5) return b;
        const a = ev(i - 1, dp + 1);
        return { gx: lerp(a.gx, b.gx, w), gy: lerp(a.gy, b.gy, w), tilt: lerp(a.tilt, b.tilt, w), fx: lerp(a.fx, b.fx, w) };
      };
      return ev(j, 0);
    }
    talkAt(t) {
      let o = 0;
      for (const e of this.ev.talk) {
        if (t < e.t0 || t > e.t1) continue;
        const env = Math.min(1, (t - e.t0) / 0.12, (e.t1 - t) / 0.12);
        const s = this.seed % 97;
        const a = 0.5 + 0.5 * Math.sin((t * 4.8 + F.noise(t * 1.3, s) * 1.6) * 2 * Math.PI);
        const b = 0.55 + 0.45 * F.noise(t * 2.7, s + 3);
        o = Math.max(o, env * e.a * clamp(a * b * 1.25, 0, 1));
      }
      return o;
    }
    blinkAt(t) {
      let c = 0;
      for (const b of this.blinks) {
        if (b > t + 0.01) break;
        const dt = t - b;
        if (dt < 0 || dt > 0.2) continue;
        c = Math.max(c, dt < 0.06 ? dt / 0.06 : dt < 0.1 ? 1 : 1 - (dt - 0.1) / 0.09);
      }
      return clamp(c, 0, 1);
    }

    // gait: legs + pelvis for a walk/run at time t (units along the path s)
    gaitAt(W, t) {
      const pr = this.pr, run = W.kind === "run";
      const tau = W.tau, n = W.n, Ls = W.Ls;
      const tl = t - W.t0;
      const s = t >= W.t1 ? W.D : t <= W.t0 ? 0 : F.pchip(t, W.knots);
      const plant = (st) => (st <= 0 ? 0 : st >= n ? W.D : Math.min(W.D, st * Ls));
      // swings of one foot: the lead (near) foot takes the odd steps, the other the even ones
      const swings = (lead) => {
        const out = [];
        for (let st = lead ? 1 : 2; st <= n; st += 2) {
          const s0 = W.t0 + (st - 1) * tau, s1 = W.t0 + st * tau;
          out.push({ a: st <= 2 ? 0 : plant(st - 2), b: st === n ? W.D : plant(st),
                     t0: Math.max(W.t0, run ? s1 - 1.5 * tau : s0 + 0.05 * tau), t1: run ? s1 : s1 - 0.1 * tau });
        }
        return out;
      };
      const fN = footRoll(t, swings(true), tau, run, W.t0, Lnom(run, pr));
      const fF = footRoll(t, swings(false), tau, run, W.t0, Lnom(run, pr));
      const u = clamp(tl / tau, 0, n) % 1;
      const amp = clamp(Ls / Lnom(run, pr), 0, 1.3);
      const envS = clamp(Math.min(tl / tau, (W.t1 - t) / tau), 0, 1);
      return { s, fN, fF, bob: this.bobAt(u, Ls, run) * (run ? envS : 1), phase: tl / tau, env: envS, amp, run };
    }
    // pelvis drop (body units, + = lower) through a step; walk: lowest as the front heel lands, run: lowest mid-stance
    bobAt(u, L, run) {
      const pr = this.pr, reach = (pr.thigh + pr.shin) * 0.99, top = pr.hip - 8;
      if (run) return 18 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (u - 0.25))) - 16;
      const need = (dx, lift) => top - (pr.ankle + lift + Math.sqrt(Math.max(0, reach * reach - dx * dx)));
      const a40 = 40 * RAD;
      const lead = need(Math.max(0, 0.5 * L - 8.8), 3.7);                                                  // front heel lands
      const trail = need(Math.max(0, 0.65 * L - 40 * (1 - Math.cos(a40) + Math.sin(a40))), 40 * (Math.sin(a40) + Math.cos(a40) - 1));   // back toe leaves
      const A = clamp(Math.max(lead, trail) / 0.946 + 2, 3, 48);
      return (pr.hip - top - 3) + A * (0.5 + 0.5 * Math.cos(2 * Math.PI * (u + 0.025)));
    }

    // the whole state at time t
    stateAt(t) {
      if (this._cache.t === t) return this._cache.st;
      const pos = this.posAt(t);
      const face = this.faceAt(t);
      const v = viewOf(face), m = mirOf(face), k = pos.h / 1000;
      let p = this.poseAt(t);
      const st = { t, x: pos.x, y: pos.y, h: pos.h, k, m, v, face, p };
      // locomotion overlay
      const w = pos.walk;
      if (w && t >= w.W.t0 - 1e-6) {
        const W = w.W;
        const g = this.gaitAt(W, Math.min(t, W.t1));
        const after = t > W.t1 ? sm((t - W.t1) / 0.3) : 0;
        const before = sm((t - W.t0) / 0.2);
        st.gait = { W, g, wt: (1 - after) * before };
      } else if (p.ipW > 0.001 && p.ipK) {
        const run = p.ipK === "run";
        const L = Lnom(run, this.pr), tau = run ? 0.33 : 0.525;
        const W = { kind: p.ipK, t0: -1e6, t1: 1e6, n: 1e9, Ls: L, tau, D: 1e12, knots: null };
        const g = this.gaitInPlace(W, t);
        st.gait = { W, g, wt: clamp(p.ipW, 0, 1), inplace: true };
      }
      this._cache = { t, st };
      return st;
    }
    gaitInPlace(W, t) {
      const tau = W.tau, L = W.Ls, run = W.kind === "run";
      const ph = (t + this.phase) / tau;           // continuous step count
      const s = (ph - (run ? 0.3 : 0.5)) * L;
      const swings = (lead) => {
        const out = [], j0 = Math.floor(ph);
        for (let j = j0 - 2; j <= j0 + 3; j++) {
          if ((((j % 2) + 2) % 2) !== (lead ? 1 : 0)) continue;
          out.push({ a: (j - 2) * L, b: j * L, t0: (run ? j - 1.5 : j - 1 + 0.05) * tau, t1: (run ? j : j - 0.1) * tau });
        }
        return out;
      };
      const tt = ph * tau;
      const fN = footRoll(tt, swings(true), tau, run, -1e9, L), fF = footRoll(tt, swings(false), tau, run, -1e9, L);
      return { s, fN, fF, bob: this.bobAt(ph % 1, L, run), phase: ph, env: 1, amp: 1, run };
    }

    // ── skeleton (body units) ─────────────────────────────────────────────────────
    skeleton(st) {
      const pr = this.pr, p = st.p, v = st.v, VW = VIEWS[v];
      const sx = pr.sx, sy = pr.sy;
      const tp = (q) => [q[0] * sx, q[1] * sy];            // torso-frame design → body units
      let lean = p.lean + (this.d.age === "old" ? 4 : 0);
      const neckA = p.neck + (this.d.age === "old" ? 7 : 0);
      const t = st.t;
      // breathing + a little idle sway of the upper body (never of the feet)
      const br = Math.sin((t + this.phase) * 2 * Math.PI / 3.8);
      lean += p.idle * F.noise(t * 0.3, (this.seed % 89) + 1) * 0.9;
      let pel = [0, -pr.hip];
      const sk = { v, br };
      const legs = {};
      const g = st.gait;
      const hipOf = (key) => [(key === "N" ? VW.hipN[0] : VW.hipF[0]) * pr.hipX, 0];
      const frontMir = (key) => (v === "front" && key === "N" ? -1 : 1);
      const fkLeg = (key, pelv) => {
        const hip = add(pelv, hipOf(key));
        let ha = p["l" + key + "hip"], ka = p["l" + key + "kn"];
        const fa = p["l" + key + "ft"];
        let thigh = pr.thigh;
        if (v === "front") { thigh *= Math.max(0.25, Math.cos(ha * RAD)); ha = 3 * frontMir(key); ka = 0; }
        const knee = add(hip, mul(dirA(ha), thigh));
        const ank = add(knee, mul(dirA(ha - ka), pr.shin));
        return { hip, knee, ank, foot: fa };
      };
      const ikLeg = (key, pelv, target, foot) => {
        const hip = add(pelv, hipOf(key));
        const knee = ik2(hip, target, pr.thigh, pr.shin, 1);
        const ank = add(knee, mul(unit(sub(target, knee)), pr.shin));
        return { hip, knee, ank, foot };
      };
      const shiftLeg = (L, d) => { L.hip = add(L.hip, d); L.knee = add(L.knee, d); L.ank = add(L.ank, d); };
      if (p.ride > 0.01 && v !== "front") {
        // on a bicycle: pelvis on the saddle, feet on the turning pedals (P.bike(t) gives the geometry)
        const B = this.bikeGeom(t, st);
        pel = mix2([0, -pr.hip], B.hip, p.ride);
        for (const key of ["N", "F"]) {
          const pd = B.pedal[key];
          const L = ikLeg(key, pel, [pd[0] - 34, pd[1] - 30], -8 + 10 * Math.sin(B.ang[key]));
          const F0 = fkLeg(key, pel);
          legs[key] = p.ride >= 1 ? L : { hip: L.hip, knee: mix2(F0.knee, L.knee, p.ride), ank: mix2(F0.ank, L.ank, p.ride), foot: L.foot };
        }
        sk.bike = B;
      } else if (g && g.wt > 0 && !p.seat && !p.lie && v !== "front") {
        // walking / running: IK legs toward world-planted feet; only the pelvis height eases in
        const G = g.g;
        const pelG = [0, -pr.hip + G.bob + (G.run ? 20 : 3)];
        const w = g.wt;
        const fN0 = fkLeg("N", pel), fF0 = fkLeg("F", pel);
        const low0 = Math.max(fN0.ank[1], fF0.ank[1]) + pr.ankle;
        pelG[1] = lerp(pel[1] - low0, pelG[1], w);
        // never over-extend: the pelvis drops as far as the planted feet need (reach 99 % of the leg)
        const reach = (pr.thigh + pr.shin) * 0.99;
        for (const key of ["N", "F"]) {
          const f = key === "N" ? G.fN : G.fF;
          const dx = f.pos - G.s, ty = -pr.ankle - f.lift;
          const need = ty - Math.sqrt(Math.max(0, reach * reach - dx * dx));
          if (pelG[1] < need) pelG[1] = need;
        }
        for (const key of ["N", "F"]) {
          const f = key === "N" ? G.fN : G.fF;
          const hip = add(pelG, hipOf(key));
          legs[key] = ikLeg(key, pelG, [hip[0] + (f.pos - G.s), -pr.ankle - f.lift], f.ang);
          if (g.inplace && w < 1) {
            const K0 = key === "N" ? fN0 : fF0, d0 = [0, -low0];
            const mixP = (a0, b0) => mix2(add(a0, d0), b0, w);
            legs[key] = { hip: legs[key].hip, knee: mixP(K0.knee, legs[key].knee), ank: mixP(K0.ank, legs[key].ank), foot: lerp(K0.foot, legs[key].foot, w) };
          }
        }
        pel = pelG;
        sk.swing = (G.run ? 34 : 19) * G.amp * G.env * Math.cos(Math.PI * (G.phase - 1)) * (g.inplace ? w : 1);
        lean += (G.run ? 13 : 3.5) * clamp(G.amp, 0, 1.2) * G.env * w;
        sk.walking = w; sk.run = G.run;
      } else {
        legs.N = fkLeg("N", pel); legs.F = fkLeg("F", pel);
        if (!p.lie && !p.free) {
          // the lowest sole (or knee when kneeling) touches y = 0
          const soleLow = (L) => Math.max(...[[-22, pr.ankle], [58, pr.ankle]].map((q) => add(L.ank, rot(q, L.foot))[1]));
          let low = Math.max(soleLow(legs.N), soleLow(legs.F));
          if (p.kneel > 0.01) low = Math.max(low, Math.max(legs.N.knee[1], legs.F.knee[1]) + 26);
          shiftLeg(legs.N, [0, -low]); shiftLeg(legs.F, [0, -low]);
          pel = add(pel, [0, -low]);
        }
        if (p.seat > 0.01) {
          // seated: (x, y) is under the seat's front edge — the feet stay there, the pelvis sits behind
          const dx = -((legs.N.ank[0] + legs.F.ank[0]) / 2) * p.seat;
          shiftLeg(legs.N, [dx, 0]); shiftLeg(legs.F, [dx, 0]);
          pel = add(pel, [dx, 0]);
        }
      }
      // lie: the whole body turns 90° about the pelvis (head toward the facing side, belly down) and rests on the ground
      let rr = 0;
      if (p.lie > 0.001) {
        rr = 90 * p.lie;
        const R = (q) => add(pel, rot(sub(q, pel), rr));
        for (const key of ["N", "F"]) { const L = legs[key]; L.hip = R(L.hip); L.knee = R(L.knee); L.ank = R(L.ank); L.foot += rr; }
        const T0 = (q) => add(pel, rot(tp(q), lean + rr));
        const soles = ["N", "F"].map((k) => add(legs[k].ank, rot([58, pr.ankle], legs[k].foot))[1]);
        const low = Math.max(T0([60, -200])[1], T0([56, -40])[1], legs.N.knee[1] + 24, legs.F.knee[1] + 24, ...soles);
        const standLow = 0;
        const shift = lerp(standLow - Math.max(...soles), -low, p.lie);
        pel = add(pel, [0, shift]);
        shiftLeg(legs.N, [0, shift]); shiftLeg(legs.F, [0, shift]);
      }
      sk.rootRot = rr;
      sk.pel = pel; sk.legs = legs; sk.lean = lean;
      const T = (sk.T = (q) => add(pel, rot(tp(q), lean + rr)));
      const shrug = p.shrug + br * 0.9;
      const up = rot([0, -shrug], rr);
      sk.neckBase = T(VW.neck);
      sk.sh = { N: add(T(VW.shN), up), F: add(T(VW.shF), up) };
      // arms: absolute angles (the front view mirrors the right arm); optional IK targets (bike bar)
      sk.arms = {};
      for (const key of ["N", "F"]) {
        let a = p["a" + key + "sh"], e = p["a" + key + "el"];
        const wr = p["a" + key + "wr"], swingW = p["a" + key + "sw"];
        if (sk.swing) { const s2 = (key === "N" ? -1 : 1) * sk.swing; a += s2 * swingW; e += (Math.max(0, s2) * 0.6 + (sk.run ? 0 : 6 * (sk.walking || 0))) * swingW; }
        const fm = frontMir(key);
        const S0 = sk.sh[key];
        let E0 = add(S0, mul(dirA(a * fm - rr), pr.upper));
        let W0 = add(E0, mul(dirA((a + e) * fm - rr), pr.fore * (p["a" + key + "fs"] ?? 1)));
        const hs0 = key === "N" ? p.hN : p.hF;
        if (v === "front" && e > 22 && a < 80 && hs0 !== "palm" && hs0 !== "open" && !(sk.bike && p.ride > 0.01)) {
          // facing the camera a bent forearm points at us: aim the wrist at the lap / chest (the chin for a hand on
          // the chin, the far side for crossed arms) and let the elbow go out to the side
          const side = key === "N" ? -1 : 1, crossed = hs0 === "none";
          const yT = e > 140 ? -328 : e < 70 ? lerp(24, -150, clamp((e - 30) / 40, 0, 1)) : -150 - clamp((e - 70) * 1.2, 0, 70) + a * 0.6;
          const tg = T([crossed ? -side * 34 : side * (e < 70 ? 44 : 26), yT]);
          const wgt = clamp((e - 22) / 30, 0, 1);
          const cand = [ik2(S0, tg, pr.upper, pr.fore, 1), ik2(S0, tg, pr.upper, pr.fore, -1)];
          const E1 = side < 0 ? (cand[0][0] < cand[1][0] ? cand[0] : cand[1]) : (cand[0][0] > cand[1][0] ? cand[0] : cand[1]);
          const W1 = add(E1, mul(unit(sub(tg, E1)), pr.fore * Math.min(1, vlen(sub(tg, E1)) / pr.fore)));
          E0 = mix2(E0, E1, wgt); W0 = mix2(W0, W1, wgt);
        }
        if (sk.bike && p.ride > 0.01) {
          const tg = sk.bike.grip[key];
          const E1 = ik2(S0, tg, pr.upper, pr.fore, -1);
          const W1 = add(E1, mul(unit(sub(tg, E1)), pr.fore));
          E0 = mix2(E0, E1, p.ride); W0 = mix2(W0, W1, p.ride);
        }
        const foreA = angOf(sub(W0, E0));
        sk.arms[key] = { S: S0, E: E0, W: W0, foreA, handA: foreA + wr * fm };
      }
      // neck + head
      const neckLen = pr.chin + (-HEAD[v].pivot[1]) * pr.hs - pr.neckBase;
      sk.neckTop = add(sk.neckBase, mul(dirA(180 - (lean + rr + neckA * 0.7)), neckLen));
      sk.headA = lean + neckA + p.head;
      return sk;
    }

    // bicycle geometry at time t (body units, relative to the feet anchor = the ground under the crank)
    bikeGeom(t, st) {
      const rpm = (st && st.p && st.p.rpm) || 55;
      const a = ((t + this.phase) * rpm / 60) * 2 * Math.PI;
      const C = [0, -150], r = 88;
      const ped = (x) => [C[0] + r * Math.cos(x), C[1] + r * Math.sin(x)];
      return { crank: C, r, hip: [-96, -520], seat: [-96, -498], bar: [205, -610], ang: { N: a, F: a + Math.PI },
               pedal: { N: ped(a), F: ped(a + Math.PI) }, grip: { N: [196, -622], F: [214, -616] } };
    }

    // ── per-frame update ─────────────────────────────────────────────────────────
    update(t) {
      const st = this.stateAt(t);
      const V = this.ensureView(st.v);
      if (this.cur !== V) {
        if (this.cur) this.cur.root.style.display = "none";
        V.root.style.display = "";
        // move props into this view
        for (const key of ["N", "F"]) { V.arm[key].prop.appendChild(this.propG[key]); V.arm[key].user.appendChild(this.userFront[key]); }
        V.arm.F.prop.appendChild(this.bothG);
        this.cur = V;
      }
      this.g.setAttribute("transform", `translate(${N(st.x)} ${N(st.y)}) scale(${(st.k * st.m).toFixed(5)} ${st.k.toFixed(5)})`);
      const sk = this.skeleton(st);
      this._sk = sk;
      this.draw(V, sk, st);
    }

    draw(V, sk, st) {
      const pr = this.pr, p = st.p, v = st.v;
      // ground shadow
      const cx = (sk.legs.N.ank[0] + sk.legs.F.ank[0]) / 2 + 10;
      V.ground.setAttribute("cx", N(cx));
      V.ground.setAttribute("rx", N(sk.rootRot ? 420 : 120 + Math.abs(sk.legs.N.ank[0] - sk.legs.F.ank[0]) * 0.5));
      // torso
      const rr = sk.rootRot || 0;
      const tt = `translate(${N(sk.pel[0])} ${N(sk.pel[1])}) rotate(${N(sk.lean + rr)}) scale(${N(pr.sx)} ${N(pr.sy * (1 + sk.br * 0.004))})`;
      V.torsoG.setAttribute("transform", tt); V.torsoBackG.setAttribute("transform", tt);
      // far arm z
      const zF = p.zF > 0.5 ? 1 : 0;
      if (zF !== V.zF) { (zF ? V.slots.armFfront : V.slots.armFback).appendChild(V.arm.F.g); V.zF = zF; }
      // legs
      for (const key of ["N", "F"]) {
        const L = sk.legs[key], G = V.leg[key];
        const [w0, w1, w2] = pr.legW;
        if (G.bare) G.leg.set(limb(L.hip, L.knee, L.ank, w0 * 0.9, w1 * 0.74, w2 * 0.62, true));
        else {
          // trousers break over the shoe: a flat hem a little below the ankle
          const hem = add(L.ank, mul(unit(sub(L.ank, L.knee)), 16));
          G.leg.set(limb(L.hip, L.knee, hem, w0, w1, w2 * 1.04, false));
        }
        G.shoe.setAttribute("transform", `translate(${N(L.ank[0])} ${N(L.ank[1])}) rotate(${N(L.foot)})`);
      }
      // lower garment
      if (V.lower) this.drawLower(V, sk);
      // arms
      const SL = V.gm.sleeve;
      for (const key of ["N", "F"]) {
        const A = sk.arms[key], G = V.arm[key];
        let shape = key === "N" ? p.hN : p.hF;
        if (this.holding[key] && (shape === "relax" || shape === "fist")) shape = "grip";
        if (G.shape !== shape) { this.drawHand(G, shape); G.shape = shape; }
        const [a0, a1, a2] = pr.armW;
        const w0 = a0 * SL.w[0], w1 = a1 * SL.w[1], w2 = a2 * SL.w[2];
        if (SL.bare === "fore") {
          // a bare arm under a short or rolled sleeve
          G.fore.set(limb(A.S, A.E, A.W, a0 * 0.9, a1 * 0.78, a2 * 0.72, true));
          const end = mix2(A.S, A.E, SL.rolled ? 0.9 : 0.56);
          G.sleeve.set(limb(A.S, mix2(A.S, end, 0.5), end, w0 * 1.06, w0 * 1.05, w0 * (SL.rolled ? 0.98 : 1.12), false));
          if (G.roll) {
            const dir = unit(sub(A.E, A.S)), nn = perp(dir), hw = w0 * 0.56, hh = 8;
            const q = (u, v) => add(add(end, mul(nn, u * hw)), mul(dir, v * hh));
            G.roll.setAttribute("d", crv([q(-1, -1), q(1, -1), q(1.04, 1), q(-1.04, 1)], true, 0.3));
          }
        } else if (SL.bare === "all") {
          G.sleeve.set(limb(A.S, A.E, A.W, a0 * 0.94, a1 * 0.84, a2 * 0.76, true));
        } else {
          const Wx = SL.wide ? add(A.W, mul(unit(sub(A.W, A.E)), 8)) : A.W;
          G.sleeve.set(limb(A.S, A.E, Wx, w0, w1, w2, shape === "none"));
        }
        const hs = pr.handS;
        const htf = `translate(${N(A.W[0])} ${N(A.W[1])}) rotate(${N(-A.handA)}) scale(${N(hs * (v === "front" && key === "N" ? -1 : 1))} ${N(hs)})`;
        G.hand.setAttribute("transform", htf);
        G.front.setAttribute("transform", htf);
        // prop frame: palm centre, forearm rotation, px units
        const palm = add(A.W, rot([0, 26 * hs], -A.handA));
        const inv = 1 / st.k;
        const r = this.upright[key] ? 0 : -A.handA;
        this.propG[key].setAttribute("transform", `translate(${N(palm[0])} ${N(palm[1])}) rotate(${N(r)}) scale(${inv.toFixed(5)})`);
        this.userFront[key].setAttribute("transform", `translate(${N(palm[0])} ${N(palm[1])}) rotate(${N(r)}) scale(${inv.toFixed(5)})`);
      }
      if (this.bothOn) {
        const hs = pr.handS;
        const pa = add(sk.arms.N.W, rot([0, 26 * hs], -sk.arms.N.handA)), pb = add(sk.arms.F.W, rot([0, 26 * hs], -sk.arms.F.handA));
        const mid = mix2(pa, pb, 0.5), ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) / RAD;
        this.bothG.setAttribute("transform", `translate(${N(mid[0])} ${N(mid[1])}) rotate(${N(ang)}) scale(${(1 / st.k).toFixed(5)})`);
      }
      // neck
      const VW = VIEWS[v], HG = HEAD[v], hs = pr.hs;
      const hsx = hs * (HG.sx || 1) * (this.d.sex === "f" && this.d.age !== "child" ? 0.95 : 1);
      const headM = (q) => { const r0 = sub(q, HG.pivot); return add(sk.neckTop, rot([r0[0] * hsx, r0[1] * hs], sk.headA + rr)); };
      const nb = [sk.T([VW.neck[0] - 22, VW.neck[1] + 8]), sk.T([VW.neck[0] + 20, VW.neck[1] + 8])];
      const t1 = headM(HG.neckTop[0]), t2 = headM(HG.neckTop[1]);
      const m1 = add(mix2(nb[0], t1, 0.5), mul(unit(perp(sub(t1, nb[0]))), -2.5));
      const m2 = add(mix2(t2, nb[1], 0.5), mul(unit(perp(sub(nb[1], t2))), -2.5));
      V.neck.set(crv([[nb[0][0], nb[0][1], 1], m1, [t1[0], t1[1], 1], [t2[0], t2[1], 1], m2, [nb[1][0], nb[1][1], 1]], true));
      // head transform
      const ht = `translate(${N(sk.neckTop[0])} ${N(sk.neckTop[1])}) rotate(${N(sk.headA + rr + this.lookTilt(st))}) scale(${N(hsx)} ${N(hs)}) translate(${N(-HG.pivot[0])} ${N(-HG.pivot[1])})`;
      V.headG.setAttribute("transform", ht);
      V.hairBack.setAttribute("transform", ht);
      this.drawFace(V, st);
    }
    lookTilt(st) {
      return this._lk ? this._lk.tilt * 0.85 : 0;
    }

    drawHand(G, shape) {
      const H = HANDS[shape] || HANDS.relax, sk = this.C.skin;
      while (G.handBack.firstChild) G.handBack.removeChild(G.handBack.firstChild);
      while (G.front.firstChild) G.front.removeChild(G.front.firstChild);
      let m = H.back ? `<path d="${H.back}" fill="${sk.base}" stroke="${sk.ink}" stroke-width="2.4" stroke-linejoin="round"/>` : "";
      if (H.finger) m += `<path d="${H.finger}" fill="${sk.base}" stroke="${sk.ink}" stroke-width="2.3" stroke-linejoin="round"/>`;
      if (H.thumb) m += `<path d="${H.thumb}" fill="${sk.base}" stroke="${sk.ink}" stroke-width="2.3" stroke-linejoin="round"/>`;
      if (H.lines.length) m += `<path d="${H.lines.join("")}" fill="none" stroke="${sk.line}" stroke-width="1.6" stroke-linecap="round"/>`;
      if (m) F.svg(m, G.handBack);
      G.cuff.setAttribute("display", shape === "none" ? "none" : "");
      if (H.front) {
        let f = `<path d="${H.front}" fill="${sk.base}" stroke="${sk.ink}" stroke-width="2.4" stroke-linejoin="round"/>`;
        if (H.frontLines) f += `<path d="${H.frontLines.join("")}" fill="none" stroke="${sk.line}" stroke-width="1.6" stroke-linecap="round"/>`;
        if (H.frontThumb) f += `<path d="${H.frontThumb}" fill="${sk.base}" stroke="${sk.ink}" stroke-width="2.3" stroke-linejoin="round"/>`;
        F.svg(f, G.front);
      }
    }

    drawLower(V, sk) {
      // a skirt / robe / coat-tail hull around the legs, from the waist to the hem
      const pr = this.pr, sp = V.lower.spec, v = V.v;
      const L = sk.legs, T = sk.T;
      const fr = v === "front";
      const wx = V.gm.fam === "bodice" ? [-44, 42] : V.gm.fam === "bare" ? [-47, 44] : V.gm.fam === "jacket" ? [-58, 49] : [-60, 52];
      const W1 = T([fr ? -Math.abs(wx[0]) * 1.2 : v === "side" ? -50 : wx[0], sp.waist]), W2 = T([fr ? Math.abs(wx[0]) * 1.2 : v === "side" ? 36 : wx[1], sp.waist]);
      const hemY = sp.hem;
      const pts = [W1, W2];
      if (sp.bell) { pts.push(T([(fr ? -60 : v === "side" ? -58 : wx[0] - 14), sp.waist + 70]), T([(fr ? 60 : v === "side" ? 44 : wx[1] + 12), sp.waist + 70])); }
      const flare = sp.flare;
      const lw = pr.legW[0] * 0.5 + 8;
      for (const key of ["N", "F"]) {
        const l = L[key];
        const seg = [l.hip, l.knee, l.ank];
        for (let i = 0; i < 2; i++) {
          const a = seg[i], b = seg[i + 1], nn = unit(perp(sub(b, a)));
          for (let u = 0; u <= 1.0001; u += 0.25) {
            const q = mix2(a, b, u);
            if (q[1] > hemY + 1) continue;
            pts.push(add(q, mul(nn, lw)), sub(q, mul(nn, lw)));
          }
          if ((a[1] - hemY) * (b[1] - hemY) < 0) {
            const u = (hemY - a[1]) / (b[1] - a[1]), q = mix2(a, b, u);
            pts.push([q[0] - flare, hemY], [q[0] + flare, hemY]);
          }
        }
        if (l.ank[1] < hemY) pts.push([l.ank[0] - flare, hemY], [l.ank[0] + flare, hemY]);
      }
      // a fixed bell under the pelvis, so the silhouette keeps its shape whatever the legs do
      const bell = { dress: 150, gown: 190, robe: 104, toga: 98, tunic: 84, kilt: 76, coat: 96, labcoat: 96 }[V.lower.kind] || 96;
      const px0 = sk.pel[0] + (v === "3q" ? 4 : 0), bw = bell * (fr ? 1.1 : v === "side" ? 0.82 : 1);
      if (sk.rootRot < 45) pts.push([px0 - bw, hemY], [px0 + bw, hemY], [px0 - bw * 0.97, hemY - 30], [px0 + bw * 0.97, hemY - 30]);
      const hull = convexHull(pts);
      V.lower.s.set(crv(hull.map((q) => [q[0], q[1]]), true, 0.55));
      // folds from the waist toward the hem (and the coat's front opening)
      const lo = hull.reduce((a, q) => (q[1] > a[1] ? q : a), hull[0]);
      const xs = hull.filter((q) => q[1] > lo[1] - 30).map((q) => q[0]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      let f = "";
      const fr3 = sp.open ? [0.62] : V.lower.kind === "kilt" ? [0.2, 0.4, 0.6, 0.8] : [0.28, 0.52, 0.76];
      for (const k of fr3) {
        const top = mix2(W1, W2, k), bx = lerp(minX + 8, maxX - 8, k);
        f += `M${P(add(top, [0, sp.open ? 0 : 24]))}Q${P([lerp(top[0], bx, 0.5) + (sp.open ? 0 : 5), (top[1] + lo[1]) / 2])} ${P([bx, lo[1] - (sp.open ? 2 : 8)])}`;
      }
      V.lower.folds.setAttribute("d", f);
    }

    drawFace(V, st) {
      const H = V.head, t = st.t;
      const ex = this.exprAt(t);
      const hx = this.headWorld(st);
      const lk = this.lookAt(t, { x: hx[0], y: hx[1], m: st.m });
      // pose-driven gaze (look-up)
      const p = st.p;
      if (p.gw > 0.01) { lk.gx = lerp(lk.gx, p.gx, p.gw); lk.gy = lerp(lk.gy, p.gy, p.gw); }
      this._lk = lk;
      const blink = this.blinkAt(t);
      const talk = this.talkAt(t);
      // eyes
      const open = clamp((1 - ex.lid) * (1 - blink), -0.3, 1.3);
      for (const E of H.eyes) {
        const D = E.E;
        const hgt = 14;
        const drop = (1 - open) * hgt, rise = ex.lidB * 5 * (1 - ex.happy);
        const closed = open < 0.14 || ex.happy > 0.5;
        const key = `${drop.toFixed(2)}|${rise.toFixed(2)}|${closed ? (ex.happy > 0.5 ? "h" : "c") : "o"}`;
        if (key !== E.key) {
          E.key = key;
          if (closed) {
            E.white.setAttribute("display", "none"); E.inner.setAttribute("display", "none"); E.lash.setAttribute("display", "none"); E.lower.setAttribute("display", "none");
            if (E.flick) E.flick.setAttribute("display", "none");
            E.closed.setAttribute("display", "");
            const n = D.xs.length;
            const pts = [];
            for (let i = 0; i < n; i++) {
              const y = ex.happy > 0.5 ? (D.top[i] + D.bot[i]) / 2 - Math.sin((i / (n - 1)) * Math.PI) * 4 + 3 : D.bot[i] * 0.55 + 1;
              pts.push([D.xs[i], y]);
            }
            E.closed.setAttribute("d", crv(pts, false));
          } else {
            E.white.setAttribute("display", ""); E.inner.setAttribute("display", ""); E.lash.setAttribute("display", ""); E.lower.setAttribute("display", "");
            if (E.flick) E.flick.setAttribute("display", "");
            E.closed.setAttribute("display", "none");
            const geo = eyeGeom(D, drop, rise);
            E.ap.setAttribute("d", eyeAperture(geo));
            E.lash.setAttribute("d", lashPath(D, geo));
            if (E.flick) {
              const n = geo.T.length, j = D.heavy > 0 ? n - 1 : 0, j2 = D.heavy > 0 ? n - 2 : 1, h0 = D.heavy;
              const a = geo.T[j], b = geo.T[j2];
              E.flick.setAttribute("d", `M${P([a[0] - h0 * 0.4, a[1] - D.lash[j] * 0.6])}q${N(h0 * 1.6)} ${N(-1)} ${N(h0 * 2.8)} ${N(-3.6)}` +
                `M${P([b[0], b[1] - D.lash[j2] * 0.9])}q${N(h0 * 1.2)} ${N(-1.6)} ${N(h0 * 1.9)} ${N(-4)}`);
            }
            const [i0, i1] = E.lowIdx;
            const lo = geo.B.slice(i0, i1 + 1).map((q) => [q[0], q[1] + 1.3]);
            E.lower.setAttribute("d", lo.length > 1 ? crv(lo, false) : "");
          }
        }
        const gxS = E.t === "far" ? 2.1 : E.t === "side" ? 1.4 : 2.8;
        E.irisG.setAttribute("transform", `translate(${N(lk.gx * gxS)} ${N(lk.gy * 2.2)}) ` + (ex.iris !== 1 ? `scale(${N(ex.iris)})` : ""));
      }
      // brows
      for (const B of H.brows) {
        const sgn = B.t === "near" || B.t === "frontR" ? -1 : 1;
        const r = ex.bR * sgn * (B.t === "side" ? 0.6 : 1);
        B.g.setAttribute("transform", tr(B.cx, B.cy + ex.bY - (blink > 0.5 ? 0.6 : 0)) + ` rotate(${N(r)})`);
      }
      // mouth
      const mo = ex.mo + talk * 3.4, mc = ex.mc - talk * 0.4, mw = ex.mw - talk * 0.8;
      const mkey = `${mo.toFixed(2)}|${mc.toFixed(2)}|${mw.toFixed(2)}`;
      if (mkey !== H.mkey) {
        H.mkey = mkey;
        const view = H.mouthView;   // 1 = 3q, 0 = front, 2 = side
        const wl = view === 1 ? mw * 0.56 : view === 2 ? mw * 0.18 : mw * 0.5, wr = view === 1 ? mw * 0.42 : view === 2 ? mw * 0.05 : mw * 0.5;
        const Lc = [-wl, -mc / 2], Rc = [wr, -mc / 2 * (view === 1 ? 0.9 : 1)];
        const cxm = (Rc[0] + Lc[0]) / 2;
        const topQ = 1.5 * mc - mo * 0.8, botQ = 1.5 * mc + mo * 2.2 + 0.55;
        H.mouth.setAttribute("d", `M${P(Lc)}Q${N(cxm)} ${N(topQ)} ${P(Rc)}Q${N(cxm)} ${N(botQ)} ${P(Lc)}Z`);
        H.tongue.setAttribute("cy", N(Math.max(1, (topQ + botQ) / 2 + mo * 0.35)));
        H.tongue.setAttribute("opacity", mo > 1.2 ? 1 : 0);
        H.teeth.setAttribute("y", N((topQ + Lc[1]) / 2 - 1.2));
        H.teeth.setAttribute("opacity", mo > 2 && mc > 1 ? 1 : 0);
        if (H.lip) H.lip.setAttribute("d", `M${N(cxm - mw * 0.25)} ${N(botQ * 0.5 + 1.6 + Math.max(0, mo) * 0.4)}Q${N(cxm)} ${N(botQ * 0.5 + 2.6 + mo * 0.5)} ${N(cxm + mw * 0.22)} ${N(botQ * 0.5 + 1.6 + mo * 0.4)}`);
        if (H.stache) H.stache.setAttribute("transform", tr(HEAD[V.v].mouth[0], HEAD[V.v].mouth[1] - Math.max(0, mo) * 0.25));
      }
      // feature shift (a small head turn)
      H.feat.setAttribute("transform", `translate(${N(lk.fx)} ${N(lk.gy * 0.8)})`);
      H.blush.setAttribute("opacity", N(clamp(ex.blush, 0, 1)));
    }

    headWorld(st) {
      // a point at the centre of the head, world px
      const sk = this._sk;
      if (!sk) return [st.x, st.y - st.h * 0.9];
      const HG = HEAD[st.v], hs = this.pr.hs;
      const q = add(sk.neckTop, rot(mul(sub([4, -55], HG.pivot), hs), sk.headA + (sk.rootRot || 0)));
      return [st.x + q[0] * st.k * st.m, st.y + q[1] * st.k];
    }

    // ── queries (pure functions of t) ───────────────────────────────────────────
    at(t) { const s = this.stateAt(t); const sk = this.skelAt(t); const cx = (sk.legs.N.ank[0] + sk.legs.F.ank[0]) / 2; return [s.x + cx * s.k * s.m, s.y]; }
    skelAt(t) {
      if (this._skT === t && this._skC) return this._skC;
      const s = this.stateAt(t);
      const sk = this.skeleton(s);
      this._skT = t; this._skC = sk;
      return sk;
    }
    toWorld(t, q) { const s = this.stateAt(t); return [s.x + q[0] * s.k * s.m, s.y + q[1] * s.k]; }
    headAt(t) {
      const s = this.stateAt(t), sk = this.skelAt(t), HG = HEAD[s.v], hs = this.pr.hs;
      const top = add(sk.neckTop, rot(mul(sub([0, -112 - (this.d.hat === "tophat" ? 36 : this.d.hat !== "none" ? 8 : 0)], HG.pivot), hs), sk.headA + (sk.rootRot || 0)));
      return this.toWorld(t, top);
    }
    handAt(side, t) {
      const key = sideKey(side);
      const s = this.stateAt(t), sk = this.skelAt(t), A = sk.arms[key];
      const palm = add(A.W, rot([0, 26 * this.pr.handS], -A.handA));
      return this.toWorld(t, palm);
    }
    hand(side = "right", o = {}) {
      const key = sideKey(side);
      if (o.grip !== false) this.holding[key] = true;
      if (o.upright) this.upright[key] = true;
      return this.propG[key];
    }
    handFront(side = "right") { return this.userFront[sideKey(side)]; }
    between() { this.bothOn = true; this.holding.N = this.holding.F = true; return this.bothG; }
    span(t) { const a = this.handAt("right", t), b = this.handAt("left", t); return Math.hypot(b[0] - a[0], b[1] - a[1]); }
    seatAt(t) { const s = this.stateAt(t), sk = this.skelAt(t); void s; return this.toWorld(t, [sk.pel[0] + 60, sk.pel[1] + 30]); }
    // bicycle geometry for the "ride" pose, in world px: {crank, r, pedals:[near, far], seat, bar, angle}
    bikeAt(t) {
      const st = this.stateAt(t), B = this.bikeGeom(t, st), w = (q) => this.toWorld(t, q);
      return { crank: w(B.crank), r: B.r * st.k, pedals: [w(B.pedal.N), w(B.pedal.F)], seat: w(B.seat), bar: w(B.bar), angle: B.ang.N / RAD * st.m, k: st.k, m: st.m };
    }
  }
  // one foot through its swings [{a, b, t0, t1}] (plants along the path, swing window): heel-off before the swing
  // (the foot rolls over the ball), the swing arc, heel-strike after (it rolls down from the heel). Returns the ankle
  // offset along the path (pos), its lift above the flat stance, and the shoe angle (+ = heel up).
  function footRoll(t, swings, tau, run, tStart, Lref) {
    const ho = (run ? 0.16 : 0.35) * tau, hs = (run ? 0.06 : 0.1) * tau;
    const TOE = (run ? 36 : 40) * RAD, HEEL = (run ? 6 : 12) * RAD;
    const ball = (A, a) => ({ pos: A + 40 * (1 - Math.cos(a) + Math.sin(a)), lift: 40 * (Math.sin(a) + Math.cos(a) - 1), ang: a / RAD });
    const heel = (B, b) => ({ pos: B - 22 + 22 * Math.cos(b) - 40 * Math.sin(b), lift: 22 * Math.sin(b) + 40 * Math.cos(b) - 40, ang: -b / RAD });
    let pos = swings.length ? swings[0].a : 0;
    for (const S of swings) {
      const h0 = Math.max(S.t0 - ho, tStart);
      if (t < h0) break;
      if (t < S.t0) return ball(S.a, TOE * sm((t - h0) / Math.max(1e-4, S.t0 - h0)));
      const toe = TOE * (S.t0 - h0 < ho * 0.5 ? (S.t0 - h0) / ho : 1);
      if (t < S.t1) {
        const u = (t - S.t0) / (S.t1 - S.t0), e = run ? sm(Math.pow(u, 1.5)) : sm(u);
        const A = ball(S.a, toe), B = heel(S.b, HEEL);
        const big = clamp(Math.abs(S.b - S.a) / (2 * Lref), 0.3, 1.2);
        return { pos: lerp(A.pos, B.pos, e), lift: lerp(A.lift, B.lift, u) + Math.sin(Math.PI * Math.pow(u, run ? 0.62 : 0.8)) * (run ? 150 : 40) * big,
                 ang: lerp(A.ang, B.ang, sm(clamp((u - 0.15) / 0.8, 0, 1))) };
      }
      if (t < S.t1 + hs) return heel(S.b, HEEL * (1 - sm((t - S.t1) / hs)));
      pos = S.b;
    }
    return { pos, lift: 0, ang: 0 };
  }
  const sideKey = (s) => (s === "left" || s === "far" || s === "F" || s === "other" ? "F" : "N");
  const Lnom = (run, pr) => (run ? 520 : pr.stride);

  function convexHull(pts) {
    const P2 = pts.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of P2) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P2.length - 1; i >= 0; i--) { const p = P2[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    hi.pop(); lo.pop();
    return lo.concat(hi);
  }

  // shaded shape: base in the shadow colour, a lit copy shifted toward the light and clipped to the shape,
  // an optional rim line on the dark edge, the outline on top. set(d) updates every copy at once.
  function shapeUse(parent, defs, st) {
    const id = F.uid("pz"), cid = F.uid("pzc");
    const src = el("path", { id, d: st.d || "M0 0" }, defs);
    const cp = el("clipPath", { id: cid }, defs); el("use", { href: "#" + id }, cp);
    const g = el("g", null, parent);
    el("use", { href: "#" + id, fill: st.rim || st.shade || st.fill }, g);
    const cg = el("g", { "clip-path": `url(#${cid})` }, g);
    if (st.rim) el("use", { href: "#" + id, fill: st.shade || st.fill, transform: `translate(${P(st.rimOff)})` }, cg);
    if (st.shade) el("use", { href: "#" + id, fill: st.fill, transform: `translate(${P(st.off)})` }, cg);
    if (!st.rim && !st.shade) cg.appendChild(el("g"));
    if (st.ink) el("use", { href: "#" + id, fill: "none", stroke: st.ink, "stroke-width": st.sw, "stroke-linejoin": "round", "stroke-linecap": "round" }, g);
    const o = { g, src, cg, d: st.d, set(d) { if (d !== o.d) { src.setAttribute("d", d); o.d = d; } } };
    return o;
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  //  plugin
  // ══════════════════════════════════════════════════════════════════════════════════
  F.people = { POSES: Object.keys(POSES), EXPR: Object.keys(EXPR), HAIRS, HATS, OUTFITS: Object.keys(OUTFITS) };
  F.plugins.push((S) => {
    S.people = [];
    S.person = (def, layer, o = {}) => {
      if (!layer || !layer.g) throw new Error("S.person(def, layer, {x, y, h}) — layer is a S.layer(...)");
      const P0 = new Person(S, def, layer, o);
      S.people.push(P0);
      return P0;
    };
  });
})();
