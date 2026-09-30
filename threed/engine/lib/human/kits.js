// kits.js — the costume system of Frontier 3D. One rigged mannequin (rig.js, adapted from ww2world/js/soldiers.js)
// dressed from a CastDef: kit (era costume), colors {coat, trousers, accent}, headwear, accessories, build, signature.
// The head is ALWAYS the faceless white plaster egg; hands are plaster unless the kit wears gloves.
//
//   const { fig, extras, kit } = dress(castDef, { seed })     fig = rig figure API (pose/walk/update/group/anchors)
//
// Everything is a pure function of the def (+ seed): the same def always gives the identical figure (colour jitter is
// seeded from the def hash), so a character introduced in scene 1 looks exactly the same in scenes 5 and 9.
import * as THREE from 'three';
import * as R from './rig.js';

const { V3, TAU, lerp, sstep, clamp } = R;
const DS = THREE.DoubleSide, PI = Math.PI;
export const SKIN = 0xEEEAE3;                       // the plaster of the house mannequin

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function stableKey(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(stableKey).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableKey(o[k])).join(',') + '}';
}
const hexOf = (v, d) => { if (v == null) return d; try { return new THREE.Color(v).getHex(); } catch (e) { return d; } };
const sr = (rows, kx = 1, kz = kx) => rows.map(([y, rx, zf, zb, cz]) => [y, rx * kx, zf * kz, zb * kz, cz]);

export const PROF = {
  body: R.WITNESS_TORSO,
  shirt: sr(R.M43.torso, 0.93, 0.92),
  jacket: sr(R.M43.torso, 0.97, 0.97),
  tunic: R.M43.torso,
  coat: R.OVERCOAT.torso,
  greatcoat: R.GREATCOAT.torso,
  armor: sr(R.M43.torso, 1.05, 1.12),
  mail: sr(R.M43.torso, 1.02, 1.05),
  puffy: sr(R.OVERCOAT.torso, 1.08, 1.14),
  robe: sr(R.M43.torso, 0.98, 1.0),
};
export const SK = {
  short: [[1.07, 0.168, 0.118, 0.114, 0], [1.0, 0.173, 0.121, 0.121, 0], [0.93, 0.177, 0.124, 0.127, -0.002]],
  hip: R.M43.skirt,
  thigh: [[1.07, 0.172, 0.122, 0.116, 0], [0.97, 0.186, 0.13, 0.134, -0.002], [0.84, 0.196, 0.136, 0.146, -0.004], [0.72, 0.202, 0.14, 0.152, -0.005]],
  tunic: [[1.07, 0.172, 0.122, 0.116, 0], [0.95, 0.19, 0.136, 0.14, -0.004], [0.8, 0.205, 0.148, 0.155, -0.006], [0.64, 0.218, 0.158, 0.166, -0.008], [0.54, 0.226, 0.164, 0.172, -0.008]],
  knee: R.OVERCOAT.skirt,
  calf: R.GREATCOAT.skirt,
  robe: [[1.07, 0.17, 0.122, 0.116, 0], [0.95, 0.192, 0.138, 0.144, -0.004], [0.75, 0.218, 0.158, 0.168, -0.008], [0.5, 0.244, 0.18, 0.188, -0.01], [0.26, 0.264, 0.196, 0.202, -0.012], [0.055, 0.282, 0.208, 0.212, -0.012]],
  gown: [[1.07, 0.17, 0.122, 0.116, 0], [0.95, 0.2, 0.146, 0.152, -0.004], [0.72, 0.24, 0.178, 0.19, -0.008], [0.46, 0.28, 0.21, 0.222, -0.012], [0.22, 0.31, 0.236, 0.25, -0.014], [0.04, 0.33, 0.25, 0.265, -0.014]],
  puffy: [[1.07, 0.19, 0.14, 0.13, 0], [0.98, 0.2, 0.146, 0.142, 0], [0.9, 0.204, 0.148, 0.148, -0.002]],
};

// a panel following the garment surface: rows from y0 to y1, each spanning a0 ± w(y) (shirt V, lapels, plastron, tabard)
function panel(c, key, at, y0, y1, w0, w1, off, a0 = PI / 2, n = 6, m = 8) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), y = lerp(y0, y1, t), w = lerp(w0, w1, t), row = [];
    for (let j = 0; j < m; j++) row.push(at(y, a0 - w + 2 * w * j / (m - 1), off));
    rows.push(row);
  }
  c.kit.add(key, R.loft(rows, { closed: false, flip: true }), c.tw);
}
function pivot(g, rx = 0, rz = 0, py = 1.68, pz = 0.014) { g.translate(0, -py, -pz); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(0, py, pz); return g; }
// hat shell of revolution round the skull: pts [[rx, y]...], z radius = rx * kz (heads are longer than wide)
function lathe(c, key, pts, o = {}) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), R.getDetail() < 1 ? 20 : (o.seg ?? 44), o.phi0 ?? 0, o.phiL ?? TAU);
  g.scale(1, 1, o.kz ?? 1.22); g.translate(0, 0, o.z ?? 0.012);
  pivot(g, o.rx ?? 0, o.rz ?? 0);
  if (o.dy) g.translate(0, o.dy, 0);
  g.computeVertexNormals();
  c.kit.add(key, g, o.bone ?? c.rig.B.head);
  return g;
}
function hband(c, key, r, y0, y1, o = {}) { return lathe(c, key, [[r, y0], [r + 0.002, y0 + 0.002], [r + 0.002, y1 - 0.002], [r, y1]], o); }
function visor(c, key, y, len, o = {}) {     // a cap peak in front of the brow
  const rows = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4, row = [];
    for (let j = 0; j <= 14; j++) { const a = PI / 2 + lerp(-1.0, 1.0, j / 14), out = t * len * Math.cos((a - PI / 2) * 1.15) ** 1.3 + 0.002; row.push(V3(Math.cos(a) * (0.085 + out), y - t * (o.drop ?? 0.016) - t * t * (o.curl ?? 0.006), Math.sin(a) * (0.104 + out) + 0.012)); }
    rows.push(row);
  }
  const g = R.loft(rows, { closed: false }); pivot(g, o.rx ?? 0);
  c.kit.add(key, g, c.rig.B.head);
  const g2 = R.loft(rows.map((r) => r.map((p) => p.clone().add(V3(0, -0.003, 0)))), { closed: false, flip: true }); pivot(g2, o.rx ?? 0);
  c.kit.add(key, g2, c.rig.B.head);
}
function shortSleeves(c, key, r0, r1, frac) {
  const { B } = c.rig;
  for (const [sd, side] of [['L', 1], ['R', -1]]) {
    const S = c.ref('arm' + sd), E = c.ref('fore' + sd), end = S.clone().lerp(E, frac);
    const pp = R.path([S.clone().add(V3(0, -0.004, 0)), S.clone().lerp(end, 0.5), end], 8);
    c.kit.add(key, R.tube(pp, (t) => lerp(r0, r1, t), 14, { up: V3(side, 0, 0) }), B['arm' + sd]);
    c.kit.add(key, R.sphereG(r0 * 0.94, S.x, S.y - 0.008, S.z, 0.96, 0.72, 1.0, 16, 10), B['arm' + sd]);
  }
}
const skinArms = (c) => R.buildSleeves(c.kit, c.rig, 'skin', { r: [0.052, 0.038, 0.03], ext: -0.004, wrinkle: 0, cap: 0.95 });

// ── the body: plaster egg head, hands (plaster or gloves) ────────────────────────────────────────────────────────────
function base(c, o = {}) {
  c.mat('skin', 'plaster', SKIN, { roughness: 0.5, nScale: 0.5, envMapIntensity: 0.55 }, 0.35, 0);
  R.buildHead(c.kit, c.rig, 'skin', { egg: true, neckR: o.neckR ?? 1, scale: 0.96 });
  if (o.glove) {
    c.mat('glove', o.glove.tex ?? 'leather', o.glove.color ?? 0x3A2E24, { roughness: o.glove.rough ?? 0.6 }, 0.5, 0);
    R.buildHands(c.kit, c.rig, 'glove', { glove: true, cuff: o.glove.cuff });
  } else R.buildHands(c.kit, c.rig, 'skin', {});
}
const torso = (c, key, prof, o = {}) => (c.at = R.buildTorso(c.kit, c.rig, key, { rows: prof, ...o }).at);
const skirt = (c, key, rows, o = {}) => (c.sk = R.buildSkirt(c.kit, c.rig, key, { rows, ...o }).at);
const sleeves = (c, key, r, o = {}) => R.buildSleeves(c.kit, c.rig, key, { r, ...o });
const legs = (c, key, r, end, o = {}) => R.buildLegs(c.kit, c.rig, key, { r, end, ...o });
const boots = (c, kind, keys) => R.buildBoots(c.kit, c.rig, keys, kind, { seed: c.seed });
function buttons(c, key, ys, da = 0, r = 0.0075, off = 0.009) {
  for (const y of ys) for (const d of (Array.isArray(da) ? da : [da])) R.button(c.kit, key, c.at(y, PI / 2 + d, off), R.surfNormal(c.at, y, PI / 2 + d), r, c.tw);
}
function belt(c, key, y, h = 0.045, off = 0.01, buckleKey = 'metal') {
  R.band(c.kit, key, c.at, y, h, off, c.tw);
  R.placeBox(c.kit, buckleKey, R.rbox(0.05, h * 0.95, 0.01, 0.003), c.at, y, PI / 2, off + 0.006, c.tw);
}
function std(c) {                  // common materials
  c.mat('metal', null, 0x8A8C86, { roughness: 0.38, metalness: 0.85 }, 0.3, 0);
  c.mat('brass', null, 0xB08A40, { roughness: 0.35, metalness: 0.9 }, 0.2, 0);
  c.mat('gold', null, 0xD4A845, { roughness: 0.28, metalness: 1.0 }, 0.2, 0);
  c.mat('sole', null, 0x151210, { roughness: 0.85 }, 0.3, 0);
  c.mat('button', null, 0x2A2622, { roughness: 0.45, metalness: 0.3 }, 0.2, 0);
}
function shoes(c, kind = 'shoe', color = 0x16120F, gloss = 0.32) {
  c.mat('shoe', 'leather', color, { roughness: gloss, nScale: 0.4 }, 0.5, 0);
  return boots(c, kind, { upper: 'shoe', sole: 'sole', metal: 'metal' });
}
function suitJacket(c, o = {}) {
  const at = torso(c, 'coat', o.prof ?? PROF.jacket, { edge: [0.34, 0.008, 1.47, 1.02] });
  skirt(c, 'coat', o.skirt ?? SK.hip, { ov: o.ov ?? 0.14, legK: 0.4, shinK: o.shinK ?? 0 });
  sleeves(c, 'coat', o.sleeve ?? [0.064, 0.052, 0.046], { ext: 0.004 });
  if (o.vee !== false) {
    panel(c, 'shirt', at, 1.52, o.veeY ?? 1.3, 0.2, 0.0, 0.004);
    for (const s of [1, -1]) panel(c, 'coat', at, 1.515, (o.veeY ?? 1.3) - 0.01, 0.2 * 0.85, 0.02, 0.008, PI / 2 + s * 0.2, 5, 4);
    if (o.tie !== false) R.strap(c.kit, 'tie', [at(1.5, PI / 2, 0.007), at(1.42, PI / 2, 0.008), at(1.3, PI / 2, 0.008), at(1.2, PI / 2, 0.006)], 0.045, 0.004, c.tw, V3(0, 0, 1));
  }
  R.buildCollar(c.kit, c.rig, 'shirt', 'jacket', null);
  buttons(c, 'button', o.buttons ?? [1.22, 1.12], 0.04);
}

// ── costumes ─────────────────────────────────────────────────────────────────────────────────────────────────────
function dressSuit(c, o = {}) {
  const { coat, trousers, accent } = c.col;
  base(c); std(c);
  c.mat('coat', o.tex ?? 'serge', coat, { roughness: 0.78, side: DS }, 1, 0.02);
  c.mat('trousers', o.tex ?? 'serge', trousers, { roughness: 0.82 }, 1, 0.02);
  c.mat('shirt', 'sateen', o.shirt ?? 0xECEAE4, { roughness: 0.66, side: DS }, 0.5, 0);
  c.mat('tie', 'sateen', accent, { roughness: 0.48 }, 0.3, 0);
  suitJacket(c, o);
  const top = shoes(c, 'shoe');
  legs(c, 'trousers', [0.086, 0.064, 0.06, 0.056], top - 0.02, {});
}
function dressCasual(c, o = {}) {
  const { coat, trousers } = c.col;
  base(c); std(c);
  c.mat('shirt', 'sateen', coat, { roughness: 0.85, side: DS }, 1, 0.03);
  c.mat('trousers', 'serge', trousers, { roughness: 0.9 }, 1, 0.03);
  if (o.long) sleeves(c, 'shirt', [0.06, 0.05, 0.043], { ext: 0.0 });
  else { skinArms(c); shortSleeves(c, 'shirt', 0.062, 0.057, 0.5); }
  torso(c, 'shirt', PROF.shirt, {});
  skirt(c, 'shirt', SK.short, { ov: 0.3, legK: 0.25, shinK: 0 });
  R.buildCollar(c.kit, c.rig, 'shirt', o.collar ?? 'jacket', null);
  c.mat('shoe', 'leather', o.shoe ?? 0xE6E2DA, { roughness: 0.7, nScale: 0.3 }, 0.5, 0);
  c.mat('sole2', null, 0xF2F0EA, { roughness: 0.7 }, 0.3, 0);
  const top = boots(c, o.shoeKind ?? 'sneaker', { upper: 'shoe', sole: 'sole2', metal: 'metal' });
  legs(c, 'trousers', [0.088, 0.066, 0.062, 0.058], top - 0.015, {});
}
function dress1950(c) {
  const { coat, trousers, accent } = c.col;
  base(c); std(c);
  c.mat('coat', 'sateen', coat, { roughness: 0.8, side: DS }, 1, 0.02);
  c.mat('shirt', 'sateen', accent, { roughness: 0.8, side: DS }, 1, 0);
  c.mat('trousers', 'serge', trousers, { roughness: 0.85 }, 1, 0.02);
  const at = torso(c, 'coat', PROF.jacket, { edge: [0.1, 0.006, 1.47, 1.02] });
  skirt(c, 'coat', SK.short, { ov: 0.1, legK: 0.3, shinK: 0 });
  R.band(c.kit, 'coat', at, 0.955, 0.05, 0.012, c.tw);
  sleeves(c, 'coat', [0.066, 0.056, 0.05], { ext: 0.0, turn: [0.05, 0.006] });
  panel(c, 'shirt', at, 1.52, 1.36, 0.16, 0.0, 0.004);
  R.buildCollar(c.kit, c.rig, 'coat', 'jacket', 'shirt');
  const top = shoes(c, 'shoe', 0x3A2418, 0.4);
  legs(c, 'trousers', [0.09, 0.066, 0.062, 0.058], top - 0.02, {});
}
function dressFormal1800(c) {              // tailcoat, waistcoat, white cravat, top hat by default
  const { coat, trousers, accent } = c.col;
  base(c); std(c);
  c.mat('coat', 'melton', coat, { roughness: 0.82, side: DS }, 1, 0.02);
  c.mat('vest', 'sateen', accent, { roughness: 0.6, side: DS }, 1, 0);
  c.mat('shirt', 'sateen', 0xF1EFE8, { roughness: 0.7, side: DS }, 0.5, 0);
  c.mat('trousers', 'serge', trousers, { roughness: 0.85 }, 1, 0.02);
  const at = torso(c, 'coat', PROF.jacket, { edge: [0.36, 0.008, 1.47, 1.02] });
  skirt(c, 'coat', [[1.07, 0.172, 0.122, 0.116, 0], [0.95, 0.182, 0.13, 0.13, -0.004], [0.8, 0.186, 0.13, 0.142, -0.006], [0.62, 0.186, 0.128, 0.15, -0.008], [0.55, 0.184, 0.126, 0.152, -0.008]], { ov: -1.25, legK: 0.35, shinK: 0 });
  sleeves(c, 'coat', [0.062, 0.05, 0.045], { ext: 0.006 });
  panel(c, 'vest', at, 1.47, 1.02, 0.34, 0.22, 0.004);
  panel(c, 'shirt', at, 1.53, 1.38, 0.2, 0.05, 0.007);
  R.buildCollar(c.kit, c.rig, 'coat', 'jacket', 'shirt');
  R.buildScarfGI(c.kit, c.rig, 'shirt');             // the cravat
  buttons(c, 'brass', [1.33, 1.26, 1.19, 1.12], 0.0, 0.006, 0.01);
  const top = shoes(c, 'shoe');
  legs(c, 'trousers', [0.084, 0.062, 0.058, 0.054], top - 0.02, {});
}
function dress1910(c) { dressSuit(c, { prof: PROF.jacket, skirt: SK.thigh, ov: 0.18, buttons: [1.26, 1.17, 1.08], veeY: 1.36 }); }
function dressScientist(c) {                 // white lab coat over shirt and tie
  const { coat, trousers, accent } = c.col;
  base(c); std(c);
  c.mat('coat', 'sateen', coat, { roughness: 0.82, side: DS }, 1, 0.01);
  c.mat('shirt', 'sateen', 0xB9C8D8, { roughness: 0.7, side: DS }, 0.5, 0);
  c.mat('tie', 'sateen', accent, { roughness: 0.5 }, 0.3, 0);
  c.mat('trousers', 'serge', trousers, { roughness: 0.85 }, 1, 0.02);
  const at = torso(c, 'coat', PROF.jacket, {});
  skirt(c, 'coat', SK.knee.map((r) => [r[0], r[1] * 0.92, r[2] * 0.88, r[3] * 0.92, r[4]]).map((r, i, a) => (i === a.length - 1 ? [0.5, ...r.slice(1)] : r)), { ov: -0.12, shinK: 0.35 });
  sleeves(c, 'coat', [0.066, 0.056, 0.05], { ext: 0.01 });
  panel(c, 'shirt', at, 1.52, 1.22, 0.22, 0.02, 0.004);
  R.strap(c.kit, 'tie', [at(1.5, PI / 2, 0.007), at(1.4, PI / 2, 0.008), at(1.26, PI / 2, 0.008)], 0.042, 0.004, c.tw, V3(0, 0, 1));
  for (const s of [1, -1]) panel(c, 'coat', at, 1.515, 1.2, 0.2, 0.03, 0.009, PI / 2 + s * 0.22, 5, 4);
  R.buildCollar(c.kit, c.rig, 'coat', 'jacket', null);
  for (const s of [1, -1]) R.placeBox(c.kit, 'coat', R.rbox(0.13, 0.15, 0.012, 0.01), c.sk, 0.9, PI / 2 - s * 0.62, 0.006, (x, y, z) => [[c.rig.B.pelvis, 1]]);
  R.placeBox(c.kit, 'coat', R.rbox(0.1, 0.11, 0.01, 0.008), at, 1.3, PI / 2 + 0.5, 0.006, c.tw);
  R.placeBox(c.kit, 'metal', R.rbox(0.008, 0.1, 0.008, 0.003), at, 1.33, PI / 2 + 0.47, 0.012, c.tw);   // pen in the breast pocket
  const top = shoes(c, 'shoe');
  legs(c, 'trousers', [0.086, 0.064, 0.06, 0.056], top - 0.02, {});
}
function dressWorker(c) {                    // one-piece coverall, work boots
  const { coat, accent } = c.col;
  base(c, { glove: { tex: 'leather', color: 0x8A6A44, cuff: 'gauntlet' } }); std(c);
  c.mat('coat', 'serge', coat, { roughness: 0.92, side: DS }, 1, 0.04);
  c.mat('stripe', null, accent, { roughness: 0.5, emissive: 0x000000 }, 0.3, 0);
  const at = torso(c, 'coat', PROF.tunic, { edge: [0.02, 0.006, 1.47, 1.02] });
  skirt(c, 'coat', SK.short, { ov: 0.1, legK: 0.3, shinK: 0 });
  sleeves(c, 'coat', [0.066, 0.056, 0.05], { ext: 0.004, turn: [0.06, 0.005] });
  R.buildCollar(c.kit, c.rig, 'coat', 'jacket', null);
  R.band(c.kit, 'stripe', at, 1.2, 0.05, 0.008, c.tw);
  for (const s of [1, -1]) R.placeBox(c.kit, 'coat', R.rbox(0.12, 0.13, 0.014, 0.01), at, 1.3, PI / 2 - s * 0.5, 0.006, c.tw);
  c.mat('boot', 'leather', 0x5A3A22, { roughness: 0.75 }, 0.8, 0.03);
  const top = boots(c, 'jump', { upper: 'boot', sole: 'sole', metal: 'metal' });
  legs(c, 'coat', [0.092, 0.07, 0.066, 0.062], top - 0.03, { blouse: [0.05, 0.01] });
  belt(c, 'coat', 1.05, 0.04, 0.008);
}
function dressAstronaut(c) {
  const { coat, accent } = c.col;
  base(c, { glove: { tex: 'melton', color: 0xD8D6D0, cuff: 'gauntlet', rough: 0.9 }, neckR: 1.2 }); std(c);
  c.mat('suit', 'melton', coat, { roughness: 0.92, nScale: 1.4, side: DS }, 1, 0.01);
  c.mat('hose', null, 0x9A9C9E, { roughness: 0.5, metalness: 0.6 }, 0.3, 0);
  c.mat('patch', null, accent, { roughness: 0.7 }, 0.3, 0);
  const at = torso(c, 'suit', PROF.puffy, {});
  skirt(c, 'suit', SK.puffy, { ov: 0.3, legK: 0.3, shinK: 0 });
  sleeves(c, 'suit', [0.086, 0.076, 0.07], { ext: 0.012, wrinkle: 0.09, cap: 1.0 });
  for (const y of [1.24, 1.12]) R.band(c.kit, 'hose', at, y, 0.02, 0.012, c.tw);
  R.placeBox(c.kit, 'hose', R.rbox(0.2, 0.12, 0.05, 0.015), at, 1.3, PI / 2, 0.03, c.tw);          // chest control box
  R.placeBox(c.kit, 'patch', R.rbox(0.06, 0.04, 0.006, 0.003), at, 1.4, 0.2, 0.004, c.tw);           // flag patch, left shoulder
  c.mat('boot', 'melton', 0xE4E2DC, { roughness: 0.9 }, 0.8, 0);
  c.mat('sole2', null, 0x3A3A3C, { roughness: 0.8 }, 0.3, 0);
  const top = boots(c, 'moon', { upper: 'boot', sole: 'sole2', metal: 'hose' });
  legs(c, 'suit', [0.106, 0.09, 0.088, 0.086], top - 0.03, { blouse: [0.08, 0.016], pelvis: [0.19, 0.14, 0.15] });
  c.acc.push({ kind: 'lifepack' }, { kind: 'space_helmet' });
}
function dressUS(c) {                      // WW2 US infantry (gi() with colours)
  const { coat, trousers } = c.col, jacket = c.def.variant === 'jacket';
  base(c, { glove: { tex: 'knit', color: 0x4E4C39, cuff: 'knit', rough: 1 } }); std(c);
  c.mat('coat', jacket ? 'sateen' : 'melton', coat, { roughness: 0.95, side: DS }, 1, 0.05);
  c.mat('trousers', 'serge', trousers, { roughness: 0.95 }, 1, 0.05);
  c.mat('shirt', 'serge', 0x6A6347, { roughness: 0.95 }, 1);
  c.mat('web', 'web', 0x6D694B, { roughness: 0.95 }, 1, 0.06);
  c.mat('boot', 'leather', 0x5B3F2A, { roughness: 0.78 }, 0.8, 0.04);
  if (!jacket) {
    torso(c, 'coat', R.OVERCOAT.torso, { edge: [0.42, 0.012, 1.47, 1.02] });
    skirt(c, 'coat', R.OVERCOAT.skirt, { ov: 0.42 });
    sleeves(c, 'coat', [0.066, 0.059, 0.058], { ext: 0.022 });
    R.buildCollar(c.kit, c.rig, 'coat', 'roll');
    R.coatDetails(c.kit, c.rig, { button: 'button', coat: 'coat' }, c.at, c.sk, 'overcoat');
  } else {
    torso(c, 'coat', R.M43.torso, { edge: [0.07, 0.008, 1.47, 1.02] });
    skirt(c, 'coat', R.M43.skirt, { ov: 0.12, legK: 0.35, shinK: 0 });
    sleeves(c, 'coat', [0.066, 0.054, 0.047], { ext: 0.012 });
    R.buildCollar(c.kit, c.rig, 'coat', 'jacket', 'shirt');
    R.coatDetails(c.kit, c.rig, { button: 'button', coat: 'coat' }, c.at, c.sk, 'm43');
  }
  R.shoulderStraps(c.kit, c.rig, 'coat', c.at, { button: 'button' });
  const top = boots(c, 'buckle', { upper: 'boot', sole: 'sole', metal: 'metal' });
  legs(c, 'trousers', [0.089, 0.065, 0.061, 0.056], top - 0.035, { blouse: [0.075, 0.017] });
  R.buildGIKit(c.kit, c.rig, { web: 'web', metal: 'metal' }, c.at, {});
}
function dressGerman(c) {                  // WW2 German infantry: greatcoat or M43 tunic, belt kit, marching boots
  const { coat, trousers } = c.col, tunic = c.def.variant === 'tunic';
  base(c, { glove: { tex: 'knit', color: 0x5A5D55, cuff: 'knit', rough: 1 } }); std(c);
  c.mat('coat', tunic ? 'serge' : 'melton', coat, { roughness: 0.95, side: DS }, 1, 0.05);
  c.mat('collar', 'melton', 0x535749, { roughness: 0.95, side: DS }, 1, 0.03);
  c.mat('trousers', 'serge', trousers, { roughness: 0.95 }, 1, 0.04);
  c.mat('boot', 'leather', 0x141311, { roughness: 0.4, nScale: 0.8 }, 0.5, 0);
  c.mat('belt', 'leather', 0x171614, { roughness: 0.45, nScale: 0.6 }, 0.6, 0);
  c.mat('bag', 'serge', 0x666553, { roughness: 0.95 }, 1, 0.05);
  if (!tunic) {
    torso(c, 'coat', R.GREATCOAT.torso, { edge: [0.52, 0.012, 1.44, 1.02] });
    skirt(c, 'coat', R.GREATCOAT.skirt.map((r, i) => (i === R.GREATCOAT.skirt.length - 1 ? [0.36, ...r.slice(1)] : r)), { ov: 0.46, shinK: 0.5 });
    sleeves(c, 'coat', [0.069, 0.059, 0.058], { ext: 0.022, turn: [0.09, 0.005] });
    R.buildCollar(c.kit, c.rig, 'collar', 'wide');
    R.coatDetails(c.kit, c.rig, { button: 'button', coat: 'coat' }, c.at, c.sk, 'greatcoat');
  } else {
    torso(c, 'coat', R.M43.torso, { edge: [0.07, 0.008, 1.47, 1.02] });
    skirt(c, 'coat', R.M43.skirt.map((r, i) => (i === R.M43.skirt.length - 1 ? [0.83, ...r.slice(1)] : r)), { ov: 0.12, legK: 0.35, shinK: 0 });
    sleeves(c, 'coat', [0.064, 0.053, 0.046], { ext: 0.012 });
    R.buildCollar(c.kit, c.rig, 'collar', 'jacket', 'coat');
    R.coatDetails(c.kit, c.rig, { button: 'button', coat: 'coat' }, c.at, c.sk, 'm43');
  }
  R.shoulderStraps(c.kit, c.rig, 'coat', c.at, { w: 0.05, t: 0.005, button: 'button' });
  R.buildGerKit(c.kit, c.rig, { belt: 'belt', metal: 'metal', bag: 'bag' }, c.at);
  const top = boots(c, 'marching', { upper: 'boot', sole: 'sole', metal: 'metal' });
  legs(c, 'trousers', [0.09, 0.064, 0.06, 0.058], top - 0.03);
}
function dressBattledress(c, ww1) {        // British battledress (WW2) or the WW1 service dress with puttees
  const { coat, trousers, accent } = c.col;
  base(c); std(c);
  c.mat('coat', 'serge', coat, { roughness: 0.95, side: DS }, 1, 0.05);
  c.mat('trousers', 'serge', trousers, { roughness: 0.95 }, 1, 0.05);
  c.mat('web', 'web', ww1 ? 0x7A6A48 : 0x8E8762, { roughness: 0.95 }, 1, 0.06);
  c.mat('boot', 'leather', 0x2A1E16, { roughness: 0.55 }, 0.8, 0.03);
  const at = torso(c, 'coat', PROF.tunic, { edge: [0.07, 0.008, 1.47, 1.02] });
  if (ww1) skirt(c, 'coat', SK.thigh, { ov: 0.12, legK: 0.4, shinK: 0 });
  else { skirt(c, 'coat', SK.short, { ov: 0.1, legK: 0.3, shinK: 0 }); R.band(c.kit, 'coat', at, 1.0, 0.06, 0.012, c.tw); }
  sleeves(c, 'coat', [0.066, 0.055, 0.049], { ext: 0.01 });
  R.buildCollar(c.kit, c.rig, 'coat', 'jacket', 'coat');
  for (const s of [1, -1]) {
    R.placeBox(c.kit, 'coat', R.rbox(0.12, 0.13, 0.014, 0.01), at, 1.3, PI / 2 - s * 0.5, 0.004, c.tw);
    R.placeBox(c.kit, 'coat', R.rbox(0.125, 0.045, 0.012, 0.006), at, 1.37, PI / 2 - s * 0.5, 0.016, c.tw, 0.1);
  }
  buttons(c, 'brass', [1.4, 1.31, 1.22, 1.13], 0.0, 0.0065, 0.01);
  R.shoulderStraps(c.kit, c.rig, 'coat', at, { button: 'brass' });
  belt(c, 'web', 1.05, 0.05, 0.012, 'brass');
  for (const s of [1, -1]) for (let k = 0; k < 2; k++) R.placeBox(c.kit, 'web', R.rbox(0.09, 0.11, 0.045, 0.01), at, 1.22, PI / 2 - s * (0.35 + k * 0.4), 0.03, c.tw);
  if (ww1) c.mat('puttee', 'serge', 0x6A5E40, { roughness: 1, nScale: 1.6 }, 1, 0.02);
  const top = boots(c, ww1 ? 'gaiter' : 'buckle', { upper: ww1 ? 'puttee' : 'boot', sole: 'sole', metal: 'metal' });
  legs(c, 'trousers', [0.092, 0.068, 0.064, 0.058], top - 0.035, { blouse: [0.06, 0.018] });
}
function dressNapoleonic(c, french) {      // coatee (red or blue), crossbelts, trousers, gaiters
  const { coat, trousers, accent } = c.col;
  base(c); std(c);
  c.mat('coat', 'melton', coat, { roughness: 0.88, side: DS }, 1, 0.04);
  c.mat('facing', 'melton', accent, { roughness: 0.85, side: DS }, 1, 0);
  c.mat('trousers', 'serge', trousers, { roughness: 0.92 }, 1, 0.04);
  c.mat('belt', 'web', 0xEEEBE2, { roughness: 0.8 }, 0.8, 0);
  c.mat('black', 'leather', 0x121212, { roughness: 0.4 }, 0.5, 0);
  const at = torso(c, 'coat', PROF.tunic, {});
  skirt(c, 'coat', [[1.07, 0.172, 0.122, 0.116, 0], [0.95, 0.18, 0.128, 0.13, -0.004], [0.82, 0.182, 0.128, 0.14, -0.006], [0.72, 0.18, 0.126, 0.146, -0.008]], { ov: -1.35, legK: 0.35, shinK: 0 });
  sleeves(c, 'coat', [0.064, 0.054, 0.049], { ext: 0.006, turn: [0.07, 0.006], turnKey: 'facing' });
  R.buildCollar(c.kit, c.rig, 'facing', 'jacket', null);
  if (french) panel(c, 'facing', at, 1.47, 1.1, 0.34, 0.22, 0.005);                   // the white plastron
  else for (let k = 0; k < 5; k++) for (const s of [1, -1]) R.placeBox(c.kit, 'facing', R.rbox(0.05, 0.012, 0.004, 0.003), at, 1.42 - k * 0.07, PI / 2 + s * 0.12, 0.004, c.tw);   // lace loops
  buttons(c, 'brass', [1.42, 1.35, 1.28, 1.21, 1.14], [0.12, -0.12], 0.0055, 0.009);
  for (const s of [1, -1]) {            // crossbelts from each shoulder to the opposite hip, with the plate where they cross
    R.strap(c.kit, 'belt', [c.at(1.5, PI / 2 + s * 0.95, 0.012), c.at(1.35, PI / 2 + s * 0.35, 0.014), c.at(1.2, PI / 2 - s * 0.25, 0.014), c.at(1.05, PI / 2 - s * 0.95, 0.016), c.at(1.05, 1.5 * PI - s * 0.4, 0.016), c.at(1.3, 1.5 * PI + s * 0.35, 0.012), c.at(1.5, 1.5 * PI + s * 0.9, 0.012)], 0.052, 0.004, c.tw, V3(0, 0, 1));
  }
  R.placeBox(c.kit, 'brass', R.rbox(0.05, 0.065, 0.006, 0.004), at, 1.27, PI / 2, 0.02, c.tw);
  R.placeBox(c.kit, 'black', R.rbox(0.2, 0.14, 0.06, 0.02), at, 1.02, 1.5 * PI - 0.5, 0.05, c.tw);       // cartridge box
  for (const s of [1, -1]) R.placeBox(c.kit, 'facing', R.rbox(0.07, 0.02, 0.05, 0.008), at, 1.46, PI / 2 + s * 1.35, 0.01, c.tw);  // shoulder tufts
  const top = boots(c, 'gaiter', { upper: 'black', sole: 'sole', metal: 'brass' });
  legs(c, 'trousers', [0.088, 0.066, 0.062, 0.058], top - 0.02, {});
}
function dressCivilWar(c) {
  const { coat, trousers } = c.col;
  base(c); std(c);
  c.mat('coat', 'melton', coat, { roughness: 0.9, side: DS }, 1, 0.04);
  c.mat('trousers', 'serge', trousers, { roughness: 0.92 }, 1, 0.04);
  c.mat('belt', 'leather', 0x141210, { roughness: 0.45 }, 0.6, 0);
  c.mat('boot', 'leather', 0x1C1612, { roughness: 0.5 }, 0.6, 0.02);
  const at = torso(c, 'coat', PROF.tunic, { edge: [0.05, 0.008, 1.47, 1.02] });
  skirt(c, 'coat', SK.thigh, { ov: 0.1, legK: 0.4, shinK: 0 });
  sleeves(c, 'coat', [0.066, 0.056, 0.05], { ext: 0.012 });
  R.buildCollar(c.kit, c.rig, 'coat', 'jacket', 'coat');
  buttons(c, 'brass', [1.44, 1.36, 1.28, 1.2], 0.0, 0.0065, 0.01);
  belt(c, 'belt', 1.05, 0.045, 0.012, 'brass');
  R.strap(c.kit, 'belt', [c.at(1.48, PI / 2 + 0.9, 0.012), c.at(1.3, PI / 2 + 0.2, 0.014), c.at(1.1, PI / 2 - 0.9, 0.016)], 0.04, 0.004, c.tw, V3(0, 0, 1));
  R.placeBox(c.kit, 'belt', R.rbox(0.18, 0.12, 0.05, 0.016), at, 1.02, PI + 0.6, 0.05, c.tw);
  const top = boots(c, 'buckle', { upper: 'boot', sole: 'sole', metal: 'metal' });
  legs(c, 'trousers', [0.09, 0.068, 0.064, 0.062], top - 0.06, {});
}
function dressRobe(c, o = {}) {           // ancient robe: long tunic, mantle over the left shoulder, sandals
  const { coat, trousers, accent } = c.col;
  base(c); std(c);
  c.mat('robe', 'serge', coat, { roughness: 0.95, side: DS }, 1, 0.03);
  c.mat('mantle', 'melton', trousers, { roughness: 0.95, side: DS }, 1, 0.03);
  c.mat('trim', 'serge', accent, { roughness: 0.8, side: DS }, 0.6, 0);
  c.mat('sandal', 'leather', 0x6A4428, { roughness: 0.7 }, 0.5, 0);
  const at = torso(c, 'robe', PROF.robe, {});
  skirt(c, 'robe', o.skirt ?? SK.robe, { ov: 0.35, shinK: 0.55 });
  if (o.bareArms) { skinArms(c); shortSleeves(c, 'robe', 0.064, 0.06, 0.55); }
  else sleeves(c, 'robe', [0.068, 0.062, 0.066], { ext: -0.02, wrinkle: 0.07 });
  R.band(c.kit, 'trim', at, 1.04, 0.035, 0.012, c.tw);
  // the mantle: a broad band from the left shoulder across the chest to the right hip and round the back
  R.strap(c.kit, 'mantle', [at(1.47, 0.35, 0.014), at(1.4, PI / 2 - 0.25, 0.02), at(1.2, PI / 2 + 0.35, 0.024), at(1.02, PI / 2 + 0.95, 0.026), at(1.0, PI + 0.4, 0.028), at(1.15, 1.5 * PI, 0.026), at(1.4, 1.5 * PI + 0.9, 0.018), at(1.47, 0.35, 0.014)], 0.2, 0.012, c.tw, V3(0, 0, 1));
  const tailPts = [at(1.46, 0.3, 0.02), at(1.3, 1.7 * PI, 0.03), at(1.0, 1.72 * PI, 0.04), at(0.7, 1.74 * PI, 0.05)];
  R.strap(c.kit, 'mantle', tailPts, 0.24, 0.01, (x, y) => (y > 1.05 ? c.tw(x, y, 0) : [[c.rig.B.pelvis, 1]]), V3(0, 0, -1));
  boots(c, 'sandal', { upper: 'skin', sole: 'sandal', metal: 'sandal' });
  legs(c, 'skin', [0.08, 0.05, 0.046, 0.036], 0.105, { pelvis: [0.14, 0.1, 0.11], hipCap: 0.9 });
}
function dressRoman(c) {
  const { coat, accent } = c.col;
  base(c); std(c);
  c.mat('tunic', 'serge', coat, { roughness: 0.92, side: DS }, 1, 0.04);
  c.mat('steel', 'steel', 0xA9ABA8, { roughness: 0.32, metalness: 0.9, nScale: 0.5, side: DS }, 0.4, 0.01);
  c.mat('leather', 'leather', 0x5A3A22, { roughness: 0.6 }, 0.5, 0.03);
  c.mat('sandal', 'leather', 0x5A3A22, { roughness: 0.7 }, 0.5, 0);
  torso(c, 'tunic', PROF.tunic, {});
  skirt(c, 'tunic', SK.tunic, { ov: 0.4, shinK: 0.2 });
  skinArms(c); shortSleeves(c, 'tunic', 0.064, 0.06, 0.4);
  // lorica segmentata: overlapping steel hoops round the torso + shoulder plates
  const at = c.at;
  for (let k = 0; k < 7; k++) R.band(c.kit, 'steel', at, 1.42 - k * 0.055, 0.052, 0.012 + k * 0.001, c.tw);
  for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
    const g = R.rbox(0.13 - k * 0.012, 0.012, 0.16 - k * 0.01, 0.004); g.rotateZ(s * (0.35 + k * 0.28)); g.translate(s * (0.14 + k * 0.035), 1.47 - k * 0.035, -0.02);
    c.kit.add('steel', g, () => [[c.rig.B.chest, 0.3], [s > 0 ? c.rig.B.clavL : c.rig.B.clavR, 0.7]]);
  }
  belt(c, 'leather', 1.02, 0.05, 0.03, 'brass');
  for (let k = 0; k < 6; k++) { const g = R.rbox(0.02, 0.2, 0.006, 0.003); g.translate(-0.08 + k * 0.032, 0.9, 0.16); c.kit.add('leather', g, c.rig.B.pelvis); }   // apron straps
  boots(c, 'sandal', { upper: 'skin', sole: 'sandal', metal: 'sandal' });
  legs(c, 'skin', [0.08, 0.05, 0.046, 0.036], 0.105, { pelvis: [0.14, 0.1, 0.11], hipCap: 0.9 });
}
function dressPeasant(c) {
  const { coat, trousers, accent } = c.col;
  base(c); std(c);
  c.mat('tunic', 'burlap', coat, { roughness: 1, nScale: 0.6, side: DS }, 1, 0.05);
  c.mat('hose', 'serge', trousers, { roughness: 0.95 }, 1, 0.04);
  c.mat('belt', 'leather', 0x4A3020, { roughness: 0.7 }, 0.5, 0);
  c.mat('shoe', 'leather', 0x3E2A1A, { roughness: 0.8 }, 0.8, 0.03);
  torso(c, 'tunic', PROF.tunic, {});
  skirt(c, 'tunic', SK.tunic, { ov: 0.45, shinK: 0.25 });
  sleeves(c, 'tunic', [0.068, 0.06, 0.056], { ext: 0.0, wrinkle: 0.06 });
  R.band(c.kit, 'belt', c.at, 1.03, 0.03, 0.016, c.tw);
  R.placeBox(c.kit, 'belt', R.rbox(0.1, 0.12, 0.04, 0.015), c.at, 0.98, PI / 2 + 0.7, 0.04, c.tw);    // purse
  const top = boots(c, 'shoe', { upper: 'shoe', sole: 'sole', metal: 'metal' });
  legs(c, 'hose', [0.084, 0.06, 0.056, 0.05], top - 0.02, {});
}
function dressKnight(c) {
  const { coat, accent } = c.col;
  base(c, { glove: { tex: 'steel', color: 0x9EA0A0, cuff: 'gauntlet', rough: 0.35 } }); std(c);
  c.mat('mail', 'net', 0x8E9092, { roughness: 0.45, metalness: 0.85, alphaTest: 0.3, side: DS }, 0.4, 0);
  c.mat('mailbase', 'steel', 0x505254, { roughness: 0.6, metalness: 0.7 }, 0.4, 0);
  c.mat('surcoat', 'serge', coat, { roughness: 0.9, side: DS }, 1, 0.02);
  c.mat('device', 'serge', accent, { roughness: 0.9, side: DS }, 1, 0);
  c.mat('belt', 'leather', 0x2A1C12, { roughness: 0.5 }, 0.5, 0);
  c.mat('plate', 'steel', 0xB4B6B6, { roughness: 0.28, metalness: 0.95, nScale: 0.4 }, 0.4, 0);
  const at = torso(c, 'surcoat', PROF.mail, {});
  skirt(c, 'surcoat', SK.knee.map((r, i, a) => (i === a.length - 1 ? [0.46, ...r.slice(1)] : r)), { ov: 0.05, shinK: 0.45 });
  sleeves(c, 'mailbase', [0.068, 0.06, 0.056], { ext: 0.0, wrinkle: 0.05 });
  sleeves(c, 'mail', [0.07, 0.062, 0.058], { ext: 0.0, wrinkle: 0.05 });
  panel(c, 'device', at, 1.4, 1.12, 0.22, 0.22, 0.004);                 // the cross / device on the chest
  panel(c, 'device', at, 1.34, 1.22, 0.55, 0.55, 0.005);
  R.band(c.kit, 'belt', at, 1.06, 0.04, 0.016, c.tw);
  for (const s of [1, -1]) {           // spaulders
    const g = R.sphereG(0.085, s * 0.2, 1.43, -0.02, 1.05, 0.62, 1.1, 18, 10); c.kit.add('plate', g, () => [[c.rig.B.chest, 0.25], [s > 0 ? c.rig.B.clavL : c.rig.B.clavR, 0.75]]);
  }
  c.mat('boot', 'steel', 0xA8AAAA, { roughness: 0.3, metalness: 0.95, nScale: 0.4 }, 0.5, 0);
  const top = boots(c, 'sabaton', { upper: 'boot', sole: 'sole', metal: 'metal' });
  legs(c, 'mailbase', [0.092, 0.07, 0.066, 0.062], top - 0.03, {});
  c.acc.push({ kind: 'sword' });
}
function dressRenaissance(c) {
  const { coat, trousers, accent } = c.col;
  base(c); std(c);
  c.mat('doublet', 'sateen', coat, { roughness: 0.6, side: DS }, 1, 0.02);
  c.mat('slash', 'sateen', accent, { roughness: 0.55, side: DS }, 1, 0);
  c.mat('hose', 'serge', trousers, { roughness: 0.8 }, 1, 0.02);
  c.mat('shirt', 'sateen', 0xF2EFE6, { roughness: 0.7, side: DS }, 0.5, 0);
  c.mat('shoe', 'leather', 0x201814, { roughness: 0.5 }, 0.5, 0);
  const at = torso(c, 'doublet', PROF.jacket, { edge: [0.02, 0.006, 1.47, 1.02] });
  skirt(c, 'slash', [[1.07, 0.18, 0.13, 0.124, 0], [0.98, 0.215, 0.16, 0.16, -0.004], [0.88, 0.225, 0.17, 0.172, -0.006], [0.8, 0.2, 0.15, 0.156, -0.006]], { ov: 0.3, legK: 0.5, shinK: 0 });   // trunk hose
  sleeves(c, 'doublet', [0.07, 0.054, 0.048], { ext: 0.004 });
  for (const s of [1, -1]) c.kit.add('slash', R.sphereG(0.082, s * 0.2, 1.4, -0.02, 1.0, 1.05, 1.1, 16, 10), () => [[c.rig.B.chest, 0.2], [s > 0 ? c.rig.B.armL : c.rig.B.armR, 0.8]]);
  buttons(c, 'gold', [1.44, 1.38, 1.32, 1.26, 1.2, 1.14], 0.0, 0.005, 0.008);
  R.buildCollar(c.kit, c.rig, 'shirt', 'roll', null);
  const top = boots(c, 'shoe', { upper: 'shoe', sole: 'sole', metal: 'metal' });
  legs(c, 'hose', [0.082, 0.056, 0.054, 0.046], top - 0.02, { muscle: true });
}
function dressRoyal(c) {
  const { coat, trousers, accent } = c.col;
  base(c); std(c);
  c.mat('robe', 'sateen', coat, { roughness: 0.55, side: DS }, 1, 0.01);
  c.mat('trim', null, accent, { roughness: 0.3, metalness: 0.9 }, 0.3, 0);
  c.mat('ermine', 'melton', 0xF3F0EA, { roughness: 1, side: DS }, 1, 0);
  c.mat('shoe', 'leather', 0x1A1410, { roughness: 0.4 }, 0.5, 0);
  const at = torso(c, 'robe', PROF.robe, {});
  skirt(c, 'robe', SK.gown, { ov: 0.3, shinK: 0.5 });
  sleeves(c, 'robe', [0.07, 0.064, 0.07], { ext: -0.01, wrinkle: 0.06 });
  for (const y of [0.1, 1.04]) R.band(c.kit, 'trim', y > 1 ? at : c.sk, y, 0.03, y > 1 ? 0.012 : 0.006, y > 1 ? c.tw : (x) => [[c.rig.B.pelvis, 1]]);
  R.buildCollar(c.kit, c.rig, 'ermine', 'wide');
  boots(c, 'shoe', { upper: 'shoe', sole: 'sole', metal: 'metal' });
  legs(c, 'robe', [0.086, 0.064, 0.06, 0.056], 0.1, {});
  c.acc.push({ kind: 'cape', color: trousers, fur: true });
}

// ── headwear (rigid on the head bone; skull centre (0, 1.667, 0.014), crown 1.783; the face always stays a bare egg) ────
function hatMat(c, key, col, tex = 'melton', o = {}) { return c.mat(key, tex, col, { roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, side: DS, ...(o.extra || {}) }, 1.1, 0); }
export const HEADWEAR = {
  none: () => {},
  m1: (c) => { c.mat('shell', 'steel', 0x4D4C36, { roughness: 0.78, side: DS }, 1.2, 0.03); c.mat('rim', 'steel', 0x57553E, { roughness: 0.55, metalness: 0.25 }, 0.8, 0); c.mat('liner', null, 0x3A3527, { roughness: 0.9, side: DS }, 0, 0); c.mat('strap', 'web', 0x5C5840, { roughness: 0.95 }, 0.5); R.buildM1(c.kit, c.rig, { shell: 'shell', rim: 'rim', liner: 'liner', strap: 'strap' }, {}); },
  stahlhelm: (c) => { c.mat('shell', 'steel', 0x4D5047, { roughness: 0.84, side: DS }, 1.2, 0.03); c.mat('strap', 'leather', 0x2A2016, { roughness: 0.6 }, 0.3, 0); R.buildM42(c.kit, c.rig, { shell: 'shell', strap: 'strap' }); },
  field_cap: (c) => { hatMat(c, 'cap', c.col.coat); c.mat('insig', null, 0xA9A898, { roughness: 0.7 }, 0.3, 0); R.buildM43(c.kit, c.rig, { cap: 'cap', metal: 'metal', insig: 'insig' }); },
  peaked_cap: (c) => { hatMat(c, 'cap', c.col.coat); hatMat(c, 'band', 0x2D372F); c.mat('visor', null, 0x060606, { roughness: 0.09, side: DS }, 0.3, 0); c.mat('silver', null, 0xCFCFC8, { roughness: 0.32, metalness: 0.92 }, 0.2, 0); c.mat('piping', null, c.col.accent, { roughness: 0.8 }, 0.5, 0); R.buildSchirm(c.kit, c.rig, { band: 'band', cap: 'cap', visor: 'visor', silver: 'silver', piping: 'piping' }); },
  brodie: (c) => {
    c.mat('shell', 'steel', 0x5A5638, { roughness: 0.75, side: DS }, 1.2, 0.02); c.mat('strap', 'leather', 0x3A2A1A, { roughness: 0.6 }, 0.3, 0);
    lathe(c, 'shell', [[0.0, 1.815], [0.05, 1.812], [0.09, 1.795], [0.112, 1.765], [0.12, 1.748], [0.165, 1.736], [0.172, 1.731], [0.166, 1.727], [0.12, 1.738], [0.108, 1.742]], { kz: 1.12, dy: -0.006 });
    R.strap(c.kit, 'strap', [V3(0.1, 1.73, 0.03), V3(0.07, 1.56, 0.07), V3(0, 1.54, 0.085), V3(-0.07, 1.56, 0.07), V3(-0.1, 1.73, 0.03)], 0.014, 0.002, c.rig.B.head, V3(1, 0, 0));
  },
  shako: (c) => {
    const french = c.kitName === 'napoleonic_french';
    c.mat('shako', 'leather', 0x121212, { roughness: 0.45, side: DS }, 1, 0); c.mat('peak', null, 0x070707, { roughness: 0.15, side: DS }, 0.3, 0);
    c.mat('plume', 'melton', french ? 0xB02020 : 0xEDEAE0, { roughness: 1 }, 0.6, 0);
    const top = french ? 0.108 : 0.092;
    lathe(c, 'shako', [[0, 1.935], [top, 1.935], [top - 0.002, 1.925], [0.088, 1.74], [0.086, 1.715], [0.08, 1.712]], { kz: 1.18 });
    visor(c, 'peak', 1.722, 0.06, { drop: 0.008 });
    const plate = R.rbox(0.07, 0.085, 0.004, 0.006); plate.rotateX(-0.08); plate.translate(0, 1.8, 0.118); c.kit.add('brass', plate, c.rig.B.head);
    c.kit.add('plume', R.sphereG(0.026, 0, 1.955, 0.1, 1, 1.25, 1, 12, 8), c.rig.B.head);
    hband(c, 'brass', 0.089, 1.72, 1.73, { kz: 1.18 });
  },
  bicorne: (c) => {
    hatMat(c, 'hat', 0x121212, 'melton'); c.mat('cockade', null, 0x1E3A8A, { roughness: 0.7 }, 0.3, 0);
    lathe(c, 'hat', [[0, 1.83], [0.07, 1.828], [0.086, 1.79], [0.088, 1.74], [0.08, 1.735]], { kz: 1.2 });
    const sh = new THREE.Shape(); sh.moveTo(-0.21, 0.035); sh.quadraticCurveTo(-0.1, 0.03, -0.03, 0.125); sh.quadraticCurveTo(0, 0.135, 0.03, 0.125); sh.quadraticCurveTo(0.1, 0.03, 0.21, 0.035); sh.quadraticCurveTo(0, -0.01, -0.21, 0.035);
    for (const s of [1, -1]) { const g = new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 10 }); g.translate(0, 1.715, s > 0 ? 0.055 : -0.04); pivot(g, s * 0.2, 0, 1.73, 0.012); c.kit.add('hat', g, c.rig.B.head); }
    c.kit.add('cockade', R.sphereG(0.02, 0.09, 1.8, 0.07, 1, 1, 0.3, 12, 8), c.rig.B.head);
  },
  top_hat: (c) => {
    hatMat(c, 'hat', 0x131212, 'melton', { rough: 0.5 }); c.mat('hatband', 'sateen', 0x0A0A0A, { roughness: 0.3 }, 0.3, 0);
    lathe(c, 'hat', [[0, 1.955], [0.084, 1.955], [0.088, 1.95], [0.085, 1.85], [0.083, 1.76], [0.086, 1.74], [0.135, 1.736], [0.148, 1.748], [0.15, 1.754], [0.138, 1.73], [0.084, 1.728]], { kz: 1.22 });
    hband(c, 'hatband', 0.0845, 1.745, 1.775, { kz: 1.22 });
  },
  bowler: (c) => {
    hatMat(c, 'hat', 0x151413, 'melton', { rough: 0.6 }); c.mat('hatband', 'sateen', 0x0A0A0A, { roughness: 0.35 }, 0.3, 0);
    lathe(c, 'hat', [[0, 1.865], [0.04, 1.862], [0.068, 1.845], [0.084, 1.805], [0.087, 1.76], [0.09, 1.742], [0.116, 1.738], [0.124, 1.75], [0.114, 1.733], [0.084, 1.73]], { kz: 1.2 });
    hband(c, 'hatband', 0.0875, 1.745, 1.765, { kz: 1.2 });
  },
  fedora: (c) => {
    hatMat(c, 'hat', c.col.hat ?? 0x4A4038, 'melton', { rough: 0.9 }); c.mat('hatband', 'sateen', 0x151210, { roughness: 0.4 }, 0.3, 0);
    lathe(c, 'hat', [[0, 1.865], [0.03, 1.87], [0.06, 1.862], [0.082, 1.83], [0.088, 1.77], [0.09, 1.742], [0.145, 1.732], [0.158, 1.738], [0.146, 1.728], [0.086, 1.73]], { kz: 1.2, rx: 0.06 });
    hband(c, 'hatband', 0.0885, 1.745, 1.77, { kz: 1.2, rx: 0.06 });
  },
  kepi: (c) => {
    hatMat(c, 'cap', c.col.coat); c.mat('peak', null, 0x080808, { roughness: 0.2, side: DS }, 0.3, 0);
    lathe(c, 'cap', [[0, 1.83], [0.066, 1.83], [0.074, 1.822], [0.084, 1.735], [0.084, 1.715], [0.078, 1.712]], { kz: 1.2, rx: 0.14 });
    visor(c, 'peak', 1.72, 0.05, { drop: 0.018 });
  },
  flat_cap: (c) => {
    hatMat(c, 'cap', c.col.hat ?? 0x5A5248, 'serge');
    lathe(c, 'cap', [[0, 1.8], [0.07, 1.8], [0.1, 1.787], [0.106, 1.772], [0.09, 1.748], [0.083, 1.738]], { kz: 1.25, rx: 0.1, dy: -0.004 });
    visor(c, 'cap', 1.74, 0.045, { drop: 0.012 });
  },
  baseball: (c) => {
    hatMat(c, 'cap', c.col.accent, 'serge');
    lathe(c, 'cap', [[0, 1.818], [0.04, 1.814], [0.07, 1.795], [0.084, 1.758], [0.086, 1.73]], { kz: 1.2 });
    visor(c, 'cap', 1.735, 0.075, { drop: 0.012, curl: 0.004 });
  },
  beret: (c) => {
    hatMat(c, 'cap', c.col.hat ?? 0x2A1A1A, 'melton');
    lathe(c, 'cap', [[0, 1.82], [0.06, 1.82], [0.112, 1.8], [0.118, 1.785], [0.094, 1.768], [0.082, 1.758]], { kz: 1.15, rz: -0.2 });
  },
  hood: (c) => {
    c.mat('hood', 'burlap', c.col.hood ?? c.col.trousers, { roughness: 1, nScale: 0.6, side: DS }, 1, 0.03);
    lathe(c, 'hood', [[0.0, 1.835], [0.06, 1.832], [0.1, 1.8], [0.113, 1.71], [0.105, 1.6], [0.092, 1.535], [0.13, 1.48], [0.2, 1.435], [0.225, 1.405]], { kz: 1.12, phi0: 0.95, phiL: TAU - 1.9, bone: c.rig.B.head, seg: 40 });
  },
  coif: (c) => {
    c.mat('coif', 'net', 0x8E9092, { roughness: 0.45, metalness: 0.85, alphaTest: 0.3, side: DS }, 0.4, 0);
    c.mat('coifbase', 'steel', 0x505254, { roughness: 0.6, metalness: 0.7, side: DS }, 0.4, 0);
    for (const [k, key] of [[1, 'coifbase'], [1.03, 'coif']]) lathe(c, key, [[0.0, 1.8], [0.06, 1.797], [0.092, 1.77], [0.1, 1.7], [0.094, 1.6], [0.086, 1.53], [0.12, 1.48], [0.19, 1.44], [0.2, 1.425]].map(([r, y]) => [r * k, y]), { kz: 1.12, phi0: 0.85, phiL: TAU - 1.7 });
    HEADWEAR.nasal(c);
  },
  nasal: (c) => {
    c.mat('helm', 'steel', 0xB0B2B2, { roughness: 0.3, metalness: 0.95, nScale: 0.4, side: DS }, 0.5, 0);
    lathe(c, 'helm', [[0, 1.885], [0.02, 1.87], [0.06, 1.81], [0.092, 1.745], [0.104, 1.71], [0.104, 1.7]], { kz: 1.15 });
    const g = R.rbox(0.022, 0.1, 0.008, 0.003); g.translate(0, 1.66, 0.123); c.kit.add('helm', g, c.rig.B.head);
  },
  kettle: (c) => {
    c.mat('helm', 'steel', 0xA8AAAA, { roughness: 0.32, metalness: 0.95, nScale: 0.4, side: DS }, 0.5, 0);
    lathe(c, 'helm', [[0, 1.845], [0.05, 1.84], [0.088, 1.805], [0.1, 1.75], [0.104, 1.735], [0.158, 1.695], [0.164, 1.69], [0.158, 1.688], [0.104, 1.726]], { kz: 1.12 });
  },
  galea: (c) => {
    c.mat('helm', 'steel', 0xB9A46A, { roughness: 0.3, metalness: 0.9, nScale: 0.4, side: DS }, 0.5, 0);
    c.mat('crest', 'burlap', 0xA0201C, { roughness: 1, nScale: 1.2 }, 1, 0);
    lathe(c, 'helm', [[0, 1.822], [0.05, 1.818], [0.086, 1.79], [0.1, 1.735], [0.103, 1.69], [0.1, 1.68]], { kz: 1.14 });
    const neck = []; for (let i = 0; i <= 3; i++) { const row = [], t = i / 3; for (let j = 0; j <= 16; j++) { const a = PI * 1.5 + lerp(-1.1, 1.1, j / 16); row.push(V3(Math.cos(a) * (0.1 + t * 0.07), 1.69 - t * 0.04, Math.sin(a) * (0.114 + t * 0.07) + 0.012)); } neck.push(row); }
    c.kit.add('helm', R.loft(neck, { closed: false }), c.rig.B.head); c.kit.add('helm', R.loft(neck, { closed: false, flip: true }), c.rig.B.head);
    for (const s of [1, -1]) { const g = R.rbox(0.008, 0.11, 0.07, 0.004); g.translate(s * 0.098, 1.63, 0.035); c.kit.add('helm', g, c.rig.B.head); }   // cheek guards
    const crest = R.rbox(0.03, 0.08, 0.2, 0.012); crest.translate(0, 1.85, 0.01); c.kit.add('crest', crest, c.rig.B.head);
  },
  crown: (c) => {
    c.mat('velvet', 'melton', c.col.coat, { roughness: 0.9, side: DS }, 1, 0);
    c.mat('jewel', null, 0x9A1030, { roughness: 0.1, metalness: 0.2, emissive: 0x200008 }, 0.2, 0);
    lathe(c, 'velvet', [[0, 1.845], [0.05, 1.84], [0.08, 1.8], [0.086, 1.75]], { kz: 1.15 });
    hband(c, 'gold', 0.088, 1.725, 1.775, { kz: 1.15 });
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * TAU, g = new THREE.ConeGeometry(0.018, 0.06, 4); g.translate(Math.sin(a) * 0.09, 1.8, Math.cos(a) * 0.09 * 1.15 + 0.012); c.kit.add('gold', g, c.rig.B.head);
      c.kit.add('gold', R.sphereG(0.009, Math.sin(a) * 0.09, 1.835, Math.cos(a) * 0.09 * 1.15 + 0.012, 1, 1, 1, 8, 6), c.rig.B.head);
      c.kit.add('jewel', R.sphereG(0.009, Math.sin(a + 0.39) * 0.092, 1.75, Math.cos(a + 0.39) * 0.092 * 1.15 + 0.012, 1, 1, 0.6, 8, 6), c.rig.B.head);
    }
  },
  laurel: (c) => {
    c.mat('leaf', null, 0xC9A441, { roughness: 0.35, metalness: 0.9 }, 0.3, 0);
    for (let k = 0; k < 22; k++) { const a = PI / 2 + 0.35 + k / 22 * (TAU - 0.7), g = R.sphereG(0.016, Math.cos(a) * 0.09, 1.73 + 0.012 * Math.sin(k * 1.7), Math.sin(a) * 0.108 + 0.012, 1.6, 0.5, 0.8, 8, 5); c.kit.add('leaf', g, c.rig.B.head); }
  },
  hard_hat: (c) => {
    c.mat('hat', null, c.col.hat ?? 0xE8B020, { roughness: 0.35 }, 1, 0);
    // fix (audit r11/t06: a ring through the face, a plank on top): the dome comes down to the brow and the brim flares
    // there, seated on the head; the rib follows the dome front to back instead of a flat bar sticking out
    lathe(c, 'hat', [[0, 1.826], [0.04, 1.823], [0.075, 1.805], [0.095, 1.775], [0.103, 1.74], [0.105, 1.708], [0.13, 1.698], [0.134, 1.692], [0.106, 1.694]], { kz: 1.2 });
    const rib = [[0, 1.834], [0.04, 1.831], [0.077, 1.812], [0.098, 1.781], [0.107, 1.745], [0.11, 1.712]];
    lathe(c, 'hat', rib, { kz: 1.2, phi0: -0.05, phiL: 0.1, seg: 3 }); lathe(c, 'hat', rib, { kz: 1.2, phi0: Math.PI - 0.05, phiL: 0.1, seg: 3 });
  },
  space_helmet: (c) => {
    c.mat('shellw', null, 0xF2F0EA, { roughness: 0.35, side: DS }, 0.6, 0);
    c.mat('visor', null, 0xC9A04A, { roughness: 0.08, metalness: 1.0, envMapIntensity: 1.6, side: DS }, 0.2, 0);
    const C = V3(0, 1.66, 0.02);
    const shell = new THREE.SphereGeometry(0.175, 40, 28, PI / 2 + 0.95, TAU - 1.9, 0, PI * 0.78); shell.translate(C.x, C.y, C.z); c.kit.add('shellw', shell, c.rig.B.head);
    const vis = new THREE.SphereGeometry(0.168, 32, 24, PI / 2 - 1.0, 2.0, PI * 0.18, PI * 0.5); vis.translate(C.x, C.y, C.z); c.kit.add('visor', vis, c.rig.B.head);
    const ring = new THREE.TorusGeometry(0.15, 0.018, 8, 36); ring.rotateX(PI / 2); ring.scale(1, 1, 1.08); ring.translate(0, 1.5, -0.01);
    c.kit.add('hose', ring, () => [[c.rig.B.chest, 0.7], [c.rig.B.neck, 0.3]]);
  },
};

// ── accessories ─────────────────────────────────────────────────────────────────────────────────────────────────────
function weapon(c, kind) {
  if (c.extras.props.weapon) return;
  c.mat('wood', 'wood', 0x55311C, { roughness: 0.5 }, 0.25, 0.03); c.mat('wsteel', null, 0x2C2E2B, { roughness: 0.42, metalness: 0.75 }, 0.2, 0);
  if (!c.M.strap) c.mat('strap', 'web', 0x5C5840, { roughness: 0.95 }, 0.5);
  const WB = R.buildWeapon(c.kit, c.rig, kind, { wood: 'wood', steel: 'wsteel', strap: 'strap' });
  c.extras.props.weapon = R.weaponPlacer(c.rig, WB);
  c.extras.armed = true;
}
// Brown Bess / Charleville musket with bayonet: +Z to the muzzle, origin at the right-hand grip (the wrist of the stock)
R.WEAPON.musket = {
  len: 1.55, butt: 0.36, grips: { r: V3(0, -0.012, 0.0), l: V3(0, -0.012, 0.42) }, swivel: [V3(0, -0.02, 0.7), V3(0, -0.09, -0.22)],
  build(add, K) {
    add(K.wood, R.stock([[-0.36, -0.14, 0.035, 0.021], [-0.3, -0.13, 0.036, 0.022], [-0.18, -0.095, 0.03, 0.02], [-0.06, -0.05, 0.022, 0.017], [0.0, -0.038, 0.02, 0.016], [0.06, -0.034, 0.02, 0.017], [0.2, -0.026, 0.016, 0.016], [0.5, -0.02, 0.014, 0.015], [0.95, -0.014, 0.012, 0.012]]));
    add(K.steel, R.rod(V3(0, 0.02, 0.0), V3(0, 0.02, 1.1), 0.011, 0.009, 10));
    add(K.steel, R.rbox(0.03, 0.03, 0.08, 0.004).translate(-0.018, 0.028, 0.02));
    add(K.steel, R.rod(V3(0.0, 0.0, 1.06), V3(0.0, 0.03, 1.5), 0.006, 0.0015, 4));           // socket bayonet
    add(K.steel, R.rod(V3(0.0, 0.02, 1.02), V3(0.0, 0.0, 1.07), 0.012, 0.012, 8));
    add(K.steel, R.rbox(0.044, 0.14, 0.008, 0.003).translate(0, -0.05, -0.358));
  },
};
function sword(c) {                // in its scabbard on the left hip
  c.mat('scabbard', 'leather', 0x201410, { roughness: 0.45 }, 0.5, 0);
  const B = c.rig.B, top = V3(0.2, 1.0, 0.08), tip = V3(0.26, 0.28, -0.22);
  c.kit.add('scabbard', R.rod(top, tip, 0.018, 0.012, 8), B.pelvis);
  const d = tip.clone().sub(top).normalize();
  c.kit.add('metal', R.rod(top, top.clone().addScaledVector(d, -0.14), 0.012, 0.012, 8), B.pelvis);
  const guard = R.rbox(0.13, 0.014, 0.02, 0.005); guard.lookAt?.(d); guard.translate(top.x, top.y + 0.01, top.z + 0.01); c.kit.add('gold', guard, B.pelvis);
  c.kit.add('gold', R.sphereG(0.02, top.x - d.x * 0.15, top.y - d.y * 0.15, top.z - d.z * 0.15, 1, 1, 1, 10, 8), B.pelvis);
}
function shield(c, a) {            // strapped to the left forearm, facing out
  const kind = a.type ?? (c.kitName === 'roman_legion' ? 'scutum' : c.kitName === 'medieval_knight' ? 'heater' : 'round');
  c.mat('shield', 'wood', hexOf(a.color, c.col.accent), { roughness: 0.6 }, 0.8, 0);
  c.mat('rim', null, 0xB08A40, { roughness: 0.35, metalness: 0.9 }, 0.3, 0);
  const B = c.rig.B, F = c.ref('foreL'), H = c.ref('handL'), M = F.clone().lerp(H, 0.55);
  let g;
  if (kind === 'scutum') { g = R.rbox(0.66, 1.02, 0.03, 0.02); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getZ(i) - x * x * 0.55); } g.computeVertexNormals(); }
  else if (kind === 'heater') { const s = new THREE.Shape(); s.moveTo(-0.27, 0.32); s.lineTo(0.27, 0.32); s.quadraticCurveTo(0.28, -0.08, 0, -0.42); s.quadraticCurveTo(-0.28, -0.08, -0.27, 0.32); g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 }); }
  else g = new THREE.CylinderGeometry(0.4, 0.4, 0.03, 32).rotateX(PI / 2);
  // face out (+X of the left arm), a little forward
  g.rotateY(PI / 2 - 0.25); g.translate(M.x + 0.07, M.y + 0.02, M.z + 0.02);
  c.kit.add('shield', g, B.foreL);
  if (kind !== 'scutum') { const boss = R.sphereG(0.06, M.x + 0.1, M.y + 0.02, M.z + 0.02, 0.5, 1, 1, 12, 8); c.kit.add('rim', boss, B.foreL); }
  else { const boss = R.sphereG(0.08, M.x + 0.09, M.y + 0.02, M.z + 0.02, 0.45, 1, 1, 12, 8); c.kit.add('rim', boss, B.foreL); }
}
function briefcase(c) {            // hanging from the right hand
  c.mat('case', 'leather', 0x3A2418, { roughness: 0.42, nScale: 0.45 }, 0.8, 0.02);
  const B = c.rig.B, H = c.ref('handR'), cx = H.x - 0.01, cy = H.y - 0.085;
  c.kit.add('case', R.rbox(0.07, 0.3, 0.42, 0.012).translate(cx, cy - 0.17, H.z + 0.02), B.handR);
  const hd = new THREE.TorusGeometry(0.04, 0.008, 6, 14, PI); hd.rotateY(PI / 2); hd.translate(cx, cy - 0.022, H.z + 0.02); c.kit.add('case', hd, B.handR);
  for (const z of [-0.1, 0.12]) c.kit.add('metal', R.rbox(0.076, 0.02, 0.026, 0.003).translate(cx, cy - 0.06, H.z + 0.02 + z), B.handR);
  c.extras.hold.r = 'grip';
}
function lantern(c) {              // hanging from the left hand, lit
  c.mat('lamp', null, 0x1A1816, { roughness: 0.5, metalness: 0.6 }, 0.3, 0);
  c.mat('glow', null, 0xFFC878, { roughness: 0.2, emissive: 0xFFB050, emissiveIntensity: 2.2 }, 0, 0);
  const B = c.rig.B, H = c.ref('handL'), x = H.x + 0.005, y = H.y - 0.1, z = H.z + 0.01;
  c.kit.add('lamp', R.rbox(0.13, 0.02, 0.13, 0.004).translate(x, y - 0.25, z), B.handL);
  c.kit.add('lamp', new THREE.ConeGeometry(0.08, 0.06, 4).rotateY(PI / 4).translate(x, y - 0.03, z), B.handL);
  c.kit.add('glow', R.rbox(0.1, 0.16, 0.1, 0.01).translate(x, y - 0.15, z), B.handL);
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) c.kit.add('lamp', R.rod(V3(x + dx * 0.055, y - 0.24, z + dz * 0.055), V3(x + dx * 0.055, y - 0.06, z + dz * 0.055), 0.004, 0.004, 4), B.handL);
  c.kit.add('lamp', new THREE.TorusGeometry(0.03, 0.004, 4, 12).translate(x, y + 0.005, z), B.handL);
  c.extras.hold.l = 'grip'; c.extras.light = { bone: 'handL', offset: [x - H.x, y - 0.15 - H.y, z - H.z] };
}
function backpack(c, a) {
  c.mat('pack', 'serge', hexOf(a.color, 0x5A5440), { roughness: 0.95 }, 1, 0.03);
  const at = c.at; R.placeBox(c.kit, 'pack', R.rbox(0.3, 0.38, 0.14, 0.03), at, 1.25, 1.5 * PI, 0.07, c.tw);
  R.placeBox(c.kit, 'pack', R.rbox(0.26, 0.1, 0.1, 0.02), at, 1.08, 1.5 * PI, 0.12, c.tw);
  for (const s of [1, -1]) R.strap(c.kit, 'pack', [at(1.1, PI / 2 + s * 0.55, 0.012), at(1.35, PI / 2 + s * 0.6, 0.012), V3(s * 0.12, 1.49, 0.0), at(1.38, 1.5 * PI + s * 0.5, 0.03)], 0.04, 0.004, c.tw);
}
function lifepack(c) {
  c.mat('pack', 'melton', 0xEDEBE6, { roughness: 0.85 }, 1, 0);
  R.placeBox(c.kit, 'pack', R.rbox(0.42, 0.58, 0.2, 0.04), c.at, 1.22, 1.5 * PI, 0.09, c.tw);
  R.placeBox(c.kit, 'hose', R.rbox(0.3, 0.06, 0.05, 0.015), c.at, 1.52, 1.5 * PI, 0.1, c.tw);
}
function scarf(c, a) {             // a thick knit scarf (the Witness's, in any colour) with two tails
  const col = hexOf(a.color, c.kitName === 'witness' ? 0xE0B24E : c.col.accent);
  c.mat('scarf', 'knit', col, { roughness: 0.93, nScale: 1.25, side: DS }, 0.8, 0);
  c.mat('fringe', 'fringe', col, { roughness: 0.95, alphaTest: 0.5, side: DS }, 0.5, 0);
  const rig = c.rig, k = c.clothed ? 1.14 : 1, wrap = [];
  // E1 v2: the loop drapes: at the back it lies low on the collar and out on the shoulders as thin cloth (it rose up
  // the neck as a thick round tube and read as a red donut from behind); the front, where it is knotted, is unchanged
  const bk = (t) => { const s = Math.max(0, -Math.sin(t)); return s * s * (3 - 2 * s); };
  for (let j = 0; j <= 40; j++) { const t = j / 40 * TAU, sb = bk(t), rr = 1 + 0.16 * sb; wrap.push(V3(Math.cos(t) * 0.084 * k * rr, 1.505 - 0.03 * sb - 0.004 * Math.max(0, Math.sin(t)), (Math.sin(t) * 0.09 * k - 0.026) * rr + 0.004 * sb)); }
  const ww = () => [[rig.B.chest, 0.65], [rig.B.neck, 0.35]];
  c.kit.add('scarf', R.tube(wrap, (t, an) => { const b = 1 + 0.08 * Math.sin(t * TAU * 4 + 0.7) + 0.05 * Math.sin(t * TAU * 9 + 1.3); const cc = Math.cos(an), fold = 1 + 0.18 * Math.max(0, Math.sin(an * 3 + t * 30)) * 0.4, sb = bk(t * TAU); return [0.021 * b * fold * (1 - 0.55 * sb), 0.05 * (1 + 0.1 * Math.sin(t * TAU * 3)) * (1 - 0.08 * cc * cc) * (1 + 0.25 * sb)]; }, 20, { up: V3(0, 1, 0) }), ww);
  const fz = c.clothed ? 0.03 : 0;
  c.kit.add('scarf', R.tube(R.path([[-0.078 * k, 1.536, 0.02], [-0.04, 1.522, 0.07 + fz], [0.012, 1.5, 0.092 + fz], [0.05, 1.472, 0.088 + fz], [0.052, 1.445, 0.1 + fz]], 16), (t, an) => [0.016 * (1 + 0.15 * Math.cos(an * 2)), 0.05 * (1 - 0.25 * t)], 14, { up: V3(0, 0.3, 1) }), ww);
  c.kit.add('scarf', R.sphereG(0.034, 0.042, 1.474, 0.093 + fz, 1.25, 0.95, 0.72, 18, 12), ww);
  const zf = c.clothed ? 0.045 : 0, zb = c.clothed ? -0.035 : 0;
  c.extras.tails.push(
    R.scarfTail(c.kit, rig, 'scarf', 'fringe', [[0.036, 1.47, 0.1 + zf], [0.046, 1.41, 0.132 + zf], [0.052, 1.33, 0.143 + zf], [0.052, 1.22, 0.14 + zf], [0.05, 1.1, 0.126 + zf], [0.048, 0.99, 0.124 + zf]], 5, 0.15, false),
    R.scarfTail(c.kit, rig, 'scarf', 'fringe', [[-0.035, 1.49, -0.112 + zb], [-0.042, 1.43, -0.128 + zb], [-0.046, 1.33, -0.13 + zb], [-0.046, 1.21, -0.127 + zb], [-0.044, 1.08, -0.137 + zb], [-0.04, 0.95, -0.158 + zb]], 5, 0.15, true));
}
function cape(c, a) {              // hangs from the shoulders down the back to the calves
  const col = hexOf(a.color, c.col.accent);
  c.mat('cape', a.fur ? 'melton' : 'serge', col, { roughness: 0.9, side: DS }, 1, 0);
  const B = c.rig.B, n = 12, m = 26, rows = [], hem = a.length === 'short' ? 0.95 : 0.34;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), y = lerp(1.49, hem, t), row = [];
    for (let j = 0; j < m; j++) {
      const u = j / (m - 1), an = lerp(-0.12, PI + 0.12, u) + PI;   // round the back from the left shoulder to the right
      const rx = lerp(0.2, 0.3, sstep(0, 0.6, t)) + 0.01 * Math.sin(u * 22) * t, rz = lerp(0.13, 0.26, sstep(0, 0.7, t)) * (1 + 0.04 * Math.sin(u * 17 + t * 3) * t);
      const yy = y - (t < 0.05 ? 0 : 0) + (1 - Math.abs(Math.sin(an))) * 0.03 * (1 - t);
      row.push(V3(Math.cos(an) * rx, yy, Math.sin(an) * rz - 0.03));
    }
    rows.push(row);
  }
  const g = R.loft(rows, { closed: false });
  c.kit.add('cape', g, (x, y, z) => { const v = sstep(1.35, 1.05, y); return [[B.chest, (1 - v) * 0.75], [x > 0 ? B.clavL : B.clavR, (1 - v) * 0.25], [B.pelvis, v * 0.8], [x > 0 ? B.thighL : B.thighR, v * 0.2 * sstep(0.95, 0.5, y)]]; });
  const g2 = R.loft(rows.map((r) => r.map((p) => V3(p.x * 0.985, p.y, (p.z + 0.03) * 0.985 - 0.03))), { closed: false, flip: true });
  c.kit.add('cape', g2, (x, y, z) => { const v = sstep(1.35, 1.05, y); return [[B.chest, (1 - v) * 0.75], [x > 0 ? B.clavL : B.clavR, (1 - v) * 0.25], [B.pelvis, v * 0.8], [x > 0 ? B.thighL : B.thighR, v * 0.2 * sstep(0.95, 0.5, y)]]; });
  R.placeBox(c.kit, 'gold', R.rbox(0.04, 0.04, 0.01, 0.01), c.at, 1.47, PI / 2 + 0.6, 0.012, c.tw);
}
function flag(c, a) { c.extras.flag = { colors: a.colors ?? [c.col.accent, 0xF2F0EA, c.col.coat], style: a.style ?? 'tricolor', text: a.text }; c.extras.hold.l = 'grip'; c.extras.hold.r = 'grip'; }
export const ACCESSORIES = {
  scarf, cape, flag, backpack, lantern, briefcase, lifepack, shield, sword,
  rifle: (c) => weapon(c, 'garand'), carbine: (c) => weapon(c, 'carbine'), bar: (c) => weapon(c, 'bar'), musket: (c) => weapon(c, 'musket'),
  space_helmet: (c) => HEADWEAR.space_helmet(c),
};
export const SIGNATURES = {
  sash: (c) => { c.mat('sig', 'sateen', c.col.accent, { roughness: 0.6 }, 0.5, 0); R.strap(c.kit, 'sig', [c.at(1.47, PI / 2 + 1.2, 0.014), c.at(1.3, PI / 2 + 0.4, 0.016), c.at(1.1, PI / 2 - 0.5, 0.018), c.at(1.03, PI / 2 - 1.3, 0.02), c.at(1.05, 1.5 * PI - 0.4, 0.02), c.at(1.3, 1.5 * PI + 0.5, 0.016), c.at(1.47, PI / 2 + 1.2 + TAU * 0, 0.014)], 0.09, 0.005, c.tw, V3(0, 0, 1)); },
  armband: (c) => { c.mat('sig', 'serge', c.col.accent, { roughness: 0.8 }, 0.5, 0); const S = c.ref('armL'), E = c.ref('foreL'), p = S.clone().lerp(E, 0.4); c.kit.add('sig', R.tube([p.clone().add(V3(0, 0.035, 0)), p, p.clone().add(V3(0, -0.035, 0))], 0.07, 16, { up: V3(1, 0, 0) }), c.rig.B.armL); },
  medals: (c) => { for (let k = 0; k < 4; k++) R.placeBox(c.kit, 'gold', new THREE.CylinderGeometry(0.014, 0.014, 0.004, 12).rotateX(PI / 2), c.at, 1.34, PI / 2 + 0.32 + k * 0.1, 0.01, c.tw); },
  epaulettes: (c) => { for (const s of [1, -1]) { const g = R.rbox(0.1, 0.02, 0.12, 0.008); g.translate(s * 0.17, 1.475, -0.02); c.kit.add('gold', g, () => [[c.rig.B.chest, 0.3], [s > 0 ? c.rig.B.clavL : c.rig.B.clavR, 0.7]]); } },
  scarf: (c) => scarf(c, {}), cape: (c) => cape(c, {}),
};

// ── the witness (built in): bare white mannequin with the mustard scarf, as in the Frontier Almanac ─────────────────
function dressWitness(c) {
  c.mat('body', 'plaster', 0xF1EEE8, { roughness: 0.5, nScale: 0.5, envMapIntensity: 0.55 }, 0.35, 0);
  c.M.skin = c.M.body;
  R.buildHead(c.kit, c.rig, 'body', { egg: true, neckR: 0.93, scale: 0.95 });
  R.buildHands(c.kit, c.rig, 'body', {});
  c.at = R.buildTorso(c.kit, c.rig, 'body', { rows: R.WITNESS_TORSO, e: 2.1, m: 64, n: 44, capEnd: true, bulge: (p, a, y) => {
    for (const sx of [1, -1]) { const d2 = ((p.x - sx * 0.075) / 0.07) ** 2 + ((y - 1.3) / 0.06) ** 2; if (Math.sin(a) > 0) p.z += 0.012 * Math.exp(-d2) * Math.sin(a); }
    if (Math.sin(a) < 0) { const d2 = ((y - 0.955) / 0.06) ** 2; p.z -= 0.012 * Math.exp(-d2) * Math.abs(Math.sin(a)) * (Math.abs(Math.cos(a)) < 0.7 ? 1 : 0.5); }
  } }).at;
  R.buildSleeves(c.kit, c.rig, 'body', { r: [0.05, 0.036, 0.029], ext: -0.004, wrinkle: 0, cap: 0.95 });
  R.buildLegs(c.kit, c.rig, 'body', { r: [0.082, 0.05, 0.046, 0.035], end: 0.105, pelvis: [0.13, 0.09, 0.1], hipCap: 0.9, muscle: true });
  R.buildBoots(c.kit, c.rig, { upper: 'body', sole: 'body', metal: 'body' }, 'bare');
  c.clothed = false;
  c.acc.push({ kind: 'scarf', color: '#E0B24E' });
}

// ── 1816 farm folk + Middle Stone Age foragers (H2, 26 Sep 2026; additive) ─────────────────────────────────────────
// farm_1800s: a New England farm family, June 1816. Men: linen work shirt (sleeves rolled or down), a waistcoat or braces,
// wool trousers over shoes or into boots (or knee breeches and stockings), maybe a neckerchief, a wide-brimmed felt or
// straw hat. Women: an ankle-length work dress, a linen apron, a wool shawl over the shoulders with its ends crossed on the
// chest, a poke bonnet or bare head. Natural-dye tones; given colours are muted the same way (crowd palettes too).
// Who is who: def.variant 'woman'|'man' (a group's `variant` applies to all of it); otherwise crowd variants run
// man, woman, woman, man, man, woman and a cast figure draws from its def's seed.
// forager: Middle Stone Age foragers of the southern Cape coast (~74 ka): a hide kaross over the shoulders, tied across
// the chest, a hide wrap at the hips, bare arms and legs, bare feet or hide sandals, a string of small shell beads.
// Every colour, given or drawn, becomes a hide tone: nothing bright.
const mulberry = (s) => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (r, a) => a[Math.min(a.length - 1, Math.floor(r() * a.length))];
// explicit colours only: a crowd's generic civilian palette (crowd.js variantDefs: id 'crowd:<kit>:<v>', accent = the kit's
// default) is ignored, so every member draws a period palette from its own seed
const hasColors = (d, kit) => !!(d && d.colors && (d.colors.coat || d.colors.trousers)) && !(/^crowd:/.test(String(d.id ?? '')) && String(d.colors.accent ?? '').toLowerCase() === String(KITS[kit]?.colors.accent ?? '').toLowerCase());
function earthy(hex, sMax = 0.24) {        // a natural-dye version of any colour: indigo, madder, walnut, drab, grey
  const c = new THREE.Color(hex), h = {}; c.getHSL(h);
  let hu = h.h, s = Math.min(h.s, sMax);
  if (hu > 0.66 && hu < 0.95) { hu = 0.62; s *= 0.6; }                  // purple, magenta -> faded indigo
  else if (hu > 0.22 && hu < 0.5) { hu = 0.16; s *= 0.7; }               // greens -> olive drab
  c.setHSL(hu, s, clamp(h.l, 0.13, 0.78)); return c.getHex();
}
function hideTone(hex, r) {                // any colour -> a tanned hide (tan .. dark brown) keeping some of its lightness
  const c = new THREE.Color(hex), h = {}; c.getHSL(h);
  c.setHSL(0.065 + r() * 0.035, 0.3 + r() * 0.15, clamp(0.16 + h.l * 0.55, 0.2, 0.46)); return c.getHex();
}
function farmWoman(c, r) {
  const d = c.def || {}, v = String(d.variant ?? d.gender ?? d.sex ?? '').toLowerCase();
  if (/^(woman|women|female|f|w|girl|girls|wife|mother|farmwife)$/.test(v)) return true;
  if (/^(man|men|male|m|boy|boys|husband|father|farmer)$/.test(v)) return false;
  const m = /^crowd:[^:]*:(\d+)$/.exec(String(d.id ?? ''));
  return m ? [false, true, true, false, false, true][+m[1] % 6] : r() < 0.5;
}
// a skirt with no front opening: each side follows its own thigh (below the knee partly its shin), blended across the
// middle; the apron laid on it takes the same weights, so the two move together and the skirt never cuts the apron
function farmSkirtW(c, top, legK = 1, shinK = 0.5, knee = 0.52) {
  const B = c.rig.B;
  return (x, y) => {
    const v = sstep(top - 0.02, top - 0.24, y) * legK, l = sstep(-0.05, 0.05, x), sh = sstep(knee, knee - 0.16, y) * shinK;
    return [[B.pelvis, 1 - v], [B.thighL, v * l * (1 - sh)], [B.thighR, v * (1 - l) * (1 - sh)], [B.shinL, v * l * sh], [B.shinR, v * (1 - l) * sh]];
  };
}
const FARM_DRESS = [[1.08, 0.171, 0.124, 0.118, 0], [1.0, 0.194, 0.142, 0.146, -0.004], [0.86, 0.22, 0.164, 0.174, -0.008], [0.62, 0.25, 0.186, 0.2, -0.01], [0.36, 0.274, 0.204, 0.22, -0.012], [0.1, 0.29, 0.216, 0.232, -0.012]];
function farmSkirt(c, key, rows, o = {}) {
  const e = 2.2, m = R.getDetail() < 1 ? 40 : 64, n = 20, top = rows[0][0], hem = rows[rows.length - 1][0];
  const ring = (y, k, dy = 0) => {
    const [, rx, zf, zb, cz] = R.rowAt(rows, y), row = [];
    for (let j = 0; j < m; j++) { const a = j / m * TAU, f = k * (1 + 0.012 * Math.sin(a * 11 + 0.7) * sstep(top - 0.1, hem, y)); const p = R.ringPt(y, rx * f, zf * f, zb * f, cz, a, e); p.y += dy; row.push(p); }
    return row;
  };
  const rs = []; for (let i = 0; i < n; i++) rs.push(ring(lerp(top, hem, i / (n - 1)), 1));
  rs.push(ring(hem, 0.975), ring(hem, 0.965, 0.06));            // the hem folded back inside
  c.kit.add(key, R.loft(rs, { closed: true }), farmSkirtW(c, top, o.legK, o.shinK));
}
function farmApron(c, key, rows, o = {}) {
  const e = 2.2, y0 = o.y0 ?? 1.06, y1 = o.y1 ?? 0.36, n = 12, m = 15, rs = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), y = lerp(y0, y1, t), w = lerp(o.w0 ?? 0.85, o.w1 ?? 1.05, t), [, rx, zf, zb, cz] = R.rowAt(rows, y), row = [];
    for (let j = 0; j < m; j++) row.push(R.ringPt(y, rx + 0.011, zf + 0.011, zb + 0.011, cz, PI / 2 - w + 2 * w * j / (m - 1), e));
    rs.push(row);
  }
  c.kit.add(key, R.loft(rs, { closed: false }), farmSkirtW(c, rows[0][0], o.legK, o.shinK));
}
// a wool shawl: open at the front, over the shoulders (clear of the arms), a point down the back; the two ends cross on
// the chest and are tucked into the apron band
function farmShawl(c, key) {
  const m = 56, n = 9, gap = 0.95, rows = [];
  const side = [[1.545, 0.07], [1.525, 0.165], [1.5, 0.228], [1.465, 0.268], [1.42, 0.288], [1.2, 0.296]];
  const sideX = (y) => { for (let i = 0; i < side.length - 1; i++) if (y <= side[i][0] && y >= side[i + 1][0]) return lerp(side[i][1], side[i + 1][1], (side[i][0] - y) / (side[i][0] - side[i + 1][0])); return y > side[0][0] ? side[0][1] : side[side.length - 1][1]; };
  for (let i = 0; i < n; i++) {
    const v = i / (n - 1), row = [];
    for (let j = 0; j < m; j++) {
      const a = PI / 2 + gap / 2 + j / (m - 1) * (TAU - gap), sn = Math.sin(a);
      const yIn = 1.54 - 0.05 * Math.max(0, sn) ** 2, yOut = 1.34 - 0.21 * Math.max(0, -sn) ** 1.6 - 0.1 * Math.max(0, sn) ** 2;
      const y = lerp(yIn, yOut, v), [, bx, bzf, bzb, cz] = R.rowAt(PROF.shirt, Math.min(y, 1.53));
      const rx = Math.max(bx + 0.014, sideX(y)) * (1 + 0.025 * v * Math.sin(a * 9 + 0.5));
      const rzf = bzf + 0.016 + 0.01 * v, rzb = (bzb + 0.016 + 0.012 * v) * (1 + 0.03 * v * Math.sin(a * 7 + 1.3));
      row.push(R.ringPt(y, rx, rzf, rzb, cz, a, 2.3));
    }
    rows.push(row);
  }
  c.kit.add(key, R.loft(rows, { closed: false }), c.tw);
  for (const s of [1, -1]) {            // s = 1: the end from the wearer's right front edge, crossing to the left hip (under)
    const a0 = PI / 2 + s * (gap / 2 - 0.02), off = s > 0 ? 0.02 : 0.028;
    R.strap(c.kit, key, [c.at(1.45, a0, off), c.at(1.33, PI / 2 + s * 0.29, off + 0.002), c.at(1.2, PI / 2 + s * 0.11, off + 0.004), c.at(1.08, PI / 2 - s * 0.13, off + 0.008)], 0.1, 0.0035, c.tw, V3(0, 0, 1));
  }
}
function dressFarm1816(c) {
  const r = mulberry(c.seed * 7 + 1816), woman = farmWoman(c, r), given = hasColors(c.def, c.kitName);
  base(c); std(c);
  c.farm = { woman };
  if (woman) {
    const dressC = given ? earthy(c.col.coat) : pick(r, [0x3E4A5E, 0x5E4636, 0x5A5850, 0x6E4434, 0x464858, 0x6A5E4C, 0x2E3442, 0x4E3E34]);
    const shawlC = given ? earthy(c.col.trousers, 0.3) : pick(r, [0x7A3E2E, 0x5C4A3A, 0x3C3A42, 0x8A7A5C, 0x4C5A68, 0xAEA48C, 0x6A5040]);
    c.mat('dress', 'serge', dressC, { roughness: 0.93, side: DS }, 1, 0.03);
    c.mat('apron', 'sateen', pick(r, [0xBFB5A0, 0xB0A690, 0xA8A294, 0x969A9C, 0xB5A98E]), { roughness: 0.95, nScale: 0.6, side: DS }, 1, 0.02);
    c.mat('shawl', 'melton', shawlC, { roughness: 0.98, side: DS }, 1, 0.03);
    c.mat('stocking', 'knit', pick(r, [0x3A3632, 0x4A4640, 0x5A5650]), { roughness: 0.95, nScale: 0.3 }, 1, 0.02);
    const pushed = r() < 0.5;
    if (pushed) skinArms(c);
    torso(c, 'dress', PROF.shirt, {});
    sleeves(c, 'dress', [0.062, 0.053, 0.048], pushed ? { ext: -0.075, wrinkle: 0.07, turn: [0.035, 0.008] } : { ext: 0.0, wrinkle: 0.07, turn: [0.02, 0.003] });
    farmSkirt(c, 'dress', FARM_DRESS, { legK: 1, shinK: 0.55 });
    farmApron(c, 'apron', FARM_DRESS, { legK: 1, shinK: 0.55 });
    R.band(c.kit, 'apron', c.at, 1.055, 0.03, 0.026, c.tw);
    farmShawl(c, 'shawl');
    const top = shoes(c, 'shoe', pick(r, [0x2A2018, 0x3A2A1E, 0x221C18]), 0.6);
    legs(c, 'stocking', [0.074, 0.05, 0.048, 0.04], top - 0.01, { pelvis: [0.13, 0.1, 0.11], hipCap: 0.9 });
    const b = pick(r, [[0xCDB78A, 'burlap'], [0xE4DECE, 'sateen'], [0xC4AE80, 'burlap'], [0x4A4A52, 'sateen'], [0xD9D2C0, 'sateen']]);
    Object.assign(c.farm, { hat: r() < 0.62 ? 'bonnet' : 'none', bonnet: b[0], bonnetTex: b[1] });
    return;
  }
  const bootC = pick(r, [0x3A2A1E, 0x2A2018, 0x4A3424]);
  c.mat('shirt', 'sateen', pick(r, [0xB8AB92, 0xAC9F86, 0xC2B69E, 0xA39780, 0xB4AA96]), { roughness: 0.92, nScale: 0.7, side: DS }, 1, 0.03);
  c.mat('vest', 'serge', given ? earthy(c.col.coat) : pick(r, [0x5A4632, 0x3E3A36, 0x4A5058, 0x2E3A4E, 0x6E4632, 0x6A5A44, 0x3A4034]), { roughness: 0.88, side: DS }, 1, 0.03);
  c.mat('trousers', 'serge', given ? earthy(c.col.trousers) : pick(r, [0x6A6258, 0x4A4034, 0x5A5E62, 0x3A3C44, 0x8A7A62, 0x7A6E5A]), { roughness: 0.93 }, 1, 0.04);
  const vest = r() < 0.72, rolled = r() < 0.7, legwear = pick(r, ['trousers', 'trousers', 'boots', 'breeches']);
  if (rolled) skinArms(c);
  const at = torso(c, vest ? 'vest' : 'shirt', PROF.shirt, vest ? { edge: [0.05, 0.006, 1.47, 1.02] } : {});
  sleeves(c, 'shirt', rolled ? [0.064, 0.058, 0.054] : [0.064, 0.056, 0.05], rolled ? { ext: -0.115, wrinkle: 0.08, turn: [0.045, 0.01] } : { ext: 0.004, wrinkle: 0.07, turn: [0.028, 0.004] });
  R.buildCollar(c.kit, c.rig, 'shirt', 'jacket', null);
  if (vest) {
    skirt(c, 'vest', SK.short, { ov: 0.14, legK: 0.3, shinK: 0 });
    panel(c, 'shirt', at, 1.52, 1.33, 0.19, 0.0, 0.004);
    buttons(c, 'button', [1.3, 1.23, 1.16, 1.09, 1.02], 0.0, 0.0055, 0.008);
  } else {
    R.band(c.kit, 'trousers', at, 1.04, 0.05, 0.01, c.tw);
    c.mat('braces', 'leather', 0x3A2A1C, { roughness: 0.6 }, 0.5, 0);
    for (const s of [1, -1]) R.strap(c.kit, 'braces', [at(1.06, PI / 2 - s * 0.38, 0.012), at(1.3, PI / 2 - s * 0.42, 0.014), V3(s * 0.1, 1.508, -0.018), at(1.3, 1.5 * PI + s * 0.35, 0.014), at(1.06, 1.5 * PI + s * 0.15, 0.012)], 0.028, 0.003, c.tw, V3(0, 0, 1));
  }
  if (r() < 0.5) { c.mat('kerchief', 'sateen', pick(r, [0x7A3A2A, 0x2E3A4E, 0x3A3632, 0xB8A888, 0x6A2E2A]), { roughness: 0.8, side: DS }, 0.5, 0); R.buildScarfGI(c.kit, c.rig, 'kerchief'); }
  if (legwear === 'boots') {
    c.mat('boot', 'leather', bootC, { roughness: 0.72 }, 0.8, 0.03);
    const top = boots(c, 'marching', { upper: 'boot', sole: 'sole', metal: 'metal' });
    legs(c, 'trousers', [0.09, 0.07, 0.066, 0.062], top - 0.05, { blouse: [0.05, 0.01] });
  } else if (legwear === 'breeches') {
    const top = shoes(c, 'shoe', bootC, 0.6);
    c.mat('stocking', 'knit', pick(r, [0xD8D0BE, 0x8A8478, 0x5A564E, 0xC8BEA8]), { roughness: 0.95, nScale: 0.3 }, 1, 0.02);
    legs(c, 'stocking', [0.072, 0.052, 0.05, 0.04], top - 0.012, { pelvis: [0.12, 0.09, 0.1], hipCap: 0.85 });
    legs(c, 'trousers', [0.094, 0.07, 0.066, 0.062], 0.45, {});
  } else {
    const top = shoes(c, 'shoe', bootC, 0.6);
    legs(c, 'trousers', [0.09, 0.07, 0.066, 0.062], top - 0.02, {});
  }
  const hat = pick(r, ['farm_hat', 'farm_hat', 'farm_hat', 'straw_hat', 'straw_hat', 'none']);
  Object.assign(c.farm, { hat, hatC: c.col.hat ?? (hat === 'straw_hat' ? pick(r, [0xC6B07A, 0xB8A06A, 0xD2BE8A]) : pick(r, [0x3A3028, 0x4E4034, 0x2A2622, 0x5A5046, 0x453A30])) });
}
// hide kaross: from the shoulders round the back and the sides to the front, a ragged hem at mid-thigh, tied on the chest
function kaross(c, key, r) {
  const B = c.rig.B, n = 12, m = 36, rows = [], wrap = 0.85 + r() * 0.2, hemY = 0.66 + r() * 0.1, ph = r() * 6;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), row = [];
    for (let j = 0; j < m; j++) {
      const u = j / (m - 1), an = lerp(-wrap, PI + wrap, u) + PI, sa = Math.abs(Math.sin(an));
      const hem = hemY + 0.04 * Math.sin(an * 3 + ph) + 0.018 * Math.sin(an * 8 + ph * 2) + 0.04 * (1 - sa);
      const y = lerp(1.47 + (1 - sa) * 0.006, hem, t);
      const rx = lerp(0.2, 0.3, sstep(0, 0.5, t)) + 0.012 * Math.sin(u * 19 + ph) * t, rz = lerp(0.09, 0.25, sstep(0, 0.6, t)) * (1 + 0.05 * Math.sin(u * 13 + t * 3) * t);
      row.push(V3(Math.cos(an) * rx, y, Math.sin(an) * rz - 0.03));
    }
    rows.push(row);
  }
  // the sides go with the upper arms (a swinging arm pushes the hide instead of passing through it)
  const w = (x, y, z) => {
    const v = sstep(1.35, 1.05, y), sd = Math.abs(x) / (Math.abs(x) + Math.abs(z) + 1e-4), aw = sstep(0.6, 0.85, sd) * sstep(1.46, 1.25, y) * 0.55;
    return [[B.chest, (1 - v) * (1 - aw)], [B.pelvis, v * 0.8 * (1 - aw)], [x > 0 ? B.thighL : B.thighR, v * 0.2 * sstep(0.95, 0.5, y) * (1 - aw)], [x > 0 ? B.armL : B.armR, aw]];
  };
  c.kit.add(key, R.loft(rows, { closed: false }), w);
  const L = rows[1][m - 1], Rt = rows[1][0];
  R.strap(c.kit, 'thong', [L, c.at(1.37, PI / 2 - 0.2, 0.012), c.at(1.37, PI / 2 + 0.2, 0.012), Rt], 0.009, 0.003, c.tw, V3(0, 0, 1));
}
function shellBeads(c, r) {           // Nassarius-like shell beads on a string round the neck, hanging lower in front
  const n = 44;
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU + 0.04, y = 1.49 - 0.075 * Math.max(0, Math.sin(a)) ** 1.6, p = c.at(y, a, 0.0075);
    c.kit.add(k % 6 === 3 || r() < 0.1 ? 'bead2' : 'bead', R.sphereG(0.0072, p.x, p.y, p.z, 1, 0.82, 1, 8, 6), c.tw);
  }
}
const FORAGER_WRAP = [[1.03, 0.152, 0.108, 0.11, -0.002], [0.96, 0.174, 0.12, 0.13, -0.005], [0.88, 0.186, 0.13, 0.144, -0.006], [0.79, 0.193, 0.136, 0.15, -0.006]];
function dressForager(c) {
  const r = mulberry(c.seed * 13 + 74), given = hasColors(c.def, c.kitName);
  base(c); std(c);
  c.mat('hide', 'leather', given ? hideTone(c.col.coat, r) : pick(r, [0x8A6440, 0x7A5634, 0x96704A, 0x6A4A2E, 0xA07E58, 0x5E4430, 0x7A4A30]), { roughness: 0.88, nScale: 0.9, side: DS }, 1, 0.04);
  c.mat('wrap', 'leather', given ? hideTone(c.col.trousers, r) : pick(r, [0x5E4430, 0x6A4A2E, 0x4E3A28, 0x7A5634, 0x5A3A26]), { roughness: 0.86, nScale: 0.9, side: DS }, 1, 0.04);
  c.mat('thong', 'leather', 0x3A2A1C, { roughness: 0.7 }, 0.5, 0.03);
  c.mat('bead', null, 0xD9CBB0, { roughness: 0.42 }, 0.2, 0.03);
  c.mat('bead2', null, 0x6A4A32, { roughness: 0.5 }, 0.2, 0.03);
  c.at = R.buildTorso(c.kit, c.rig, 'skin', { rows: R.WITNESS_TORSO, e: 2.1, m: 56, n: 40, capEnd: true }).at;
  skinArms(c);
  legs(c, 'skin', [0.082, 0.05, 0.046, 0.035], 0.105, { pelvis: [0.13, 0.09, 0.1], hipCap: 0.9, muscle: true });
  const sandal = r() < 0.4;
  boots(c, sandal ? 'sandal' : 'bare', { upper: 'skin', sole: sandal ? 'wrap' : 'skin', metal: 'thong' });
  skirt(c, 'wrap', FORAGER_WRAP, { ov: 0.55, legK: 0.9, shinK: 0, fold: (a, y) => 0.03 * Math.sin(a * 4 + 0.6) * sstep(0.98, 0.8, y) });
  R.band(c.kit, 'thong', c.sk, 1.0, 0.014, 0.005, c.tw);
  if (r() < 0.8) kaross(c, 'hide', r);
  shellBeads(c, r);
  c.clothed = false;
}
Object.assign(HEADWEAR, {
  farm: (c) => { const h = c.farm ? c.farm.hat : 'farm_hat'; if (h && h !== 'none' && h !== 'farm' && HEADWEAR[h]) HEADWEAR[h](c); },
  farm_hat: (c) => {                 // wide-brimmed felt hat with a low round crown (an 1810s countryman's)
    hatMat(c, 'hat', c.farm?.hatC ?? c.col.hat ?? 0x4A3E32, 'melton', { rough: 0.95 }); c.mat('hatband', 'leather', 0x1E1812, { roughness: 0.6 }, 0.3, 0);
    lathe(c, 'hat', [[0, 1.848], [0.04, 1.846], [0.068, 1.832], [0.084, 1.8], [0.088, 1.76], [0.09, 1.742], [0.15, 1.734], [0.186, 1.724], [0.194, 1.716], [0.188, 1.713], [0.15, 1.726], [0.09, 1.732]], { kz: 1.16 });
    hband(c, 'hatband', 0.0895, 1.743, 1.762, { kz: 1.16 });
  },
  straw_hat: (c) => {                // plaited straw, flat crown, broad flat brim
    hatMat(c, 'hat', c.farm?.hatC ?? c.col.hat ?? 0xC6B07A, 'burlap', { rough: 1 }); c.mat('hatband', 'sateen', 0x2A2420, { roughness: 0.7 }, 0.3, 0);
    lathe(c, 'hat', [[0, 1.836], [0.055, 1.834], [0.08, 1.82], [0.088, 1.78], [0.091, 1.745], [0.15, 1.738], [0.2, 1.73], [0.206, 1.726], [0.2, 1.723], [0.15, 1.731], [0.09, 1.735]], { kz: 1.16 });
    hband(c, 'hatband', 0.0915, 1.745, 1.762, { kz: 1.16 });
  },
  bonnet: (c) => {                   // poke bonnet: a crown over the back of the head and a brim round the (bare) face
    hatMat(c, 'bonnet', c.farm?.bonnet ?? c.col.hat ?? 0xCDB78A, c.farm?.bonnetTex ?? 'burlap', { rough: 0.97 });
    lathe(c, 'bonnet', [[0, 1.815], [0.05, 1.81], [0.086, 1.786], [0.104, 1.735], [0.108, 1.68], [0.104, 1.625], [0.094, 1.59]], { kz: 1.17, phi0: 0.75, phiL: TAU - 1.5 });
    const g = new THREE.LatheGeometry([[0.1, -0.005], [0.108, 0.03], [0.117, 0.07], [0.126, 0.105]].map(([rr, y]) => new THREE.Vector2(rr, y)), R.getDetail() < 1 ? 16 : 32, 0.85, TAU - 1.7);
    g.rotateX(PI / 2); g.scale(1, 1.2, 1); g.translate(0, 1.672, 0.03); g.computeVertexNormals();
    c.kit.add('bonnet', g, c.rig.B.head);
  },
});

// ── the kit table ────────────────────────────────────────────────────────────────────────────────────────────────
// colors: defaults for {coat, trousers, accent}; headwear / accessories: defaults (a CastDef overrides them)
export const KITS = {
  witness: { dress: dressWitness, h: 1.82, width: 0.94, colors: { coat: '#F1EEE8', trousers: '#F1EEE8', accent: '#E0B24E' }, headwear: 'none', stride: 1.26, era: 'any' },
  ancient_robe: { dress: (c) => dressRobe(c), colors: { coat: '#D9D0BC', trousers: '#8A5A3A', accent: '#7A2E24' }, headwear: 'none', accessories: [], era: 'ancient' },
  roman_legion: { dress: dressRoman, colors: { coat: '#9A2A22', trousers: '#9A2A22', accent: '#A8241E' }, headwear: 'galea', accessories: ['shield', 'sword'], era: 'ancient', armed: true },
  medieval_knight: { dress: dressKnight, colors: { coat: '#EDEAE2', trousers: '#6E7072', accent: '#A01E1E' }, headwear: 'coif', accessories: ['shield'], era: 'medieval', armed: true },
  medieval_peasant: { dress: dressPeasant, colors: { coat: '#7A6A52', trousers: '#4E4436', accent: '#6A4A2A' }, headwear: 'hood', accessories: [], era: 'medieval' },
  renaissance: { dress: dressRenaissance, colors: { coat: '#5A1E28', trousers: '#2A2226', accent: '#C9A441' }, headwear: 'beret', accessories: [], era: '1500s' },
  '1800s_formal': { dress: dressFormal1800, colors: { coat: '#1C1D22', trousers: '#8A8276', accent: '#6A5A3A' }, headwear: 'top_hat', accessories: [], era: '1800s' },
  napoleonic_british: { dress: (c) => dressNapoleonic(c, false), colors: { coat: '#9A1E1A', trousers: '#5E6268', accent: '#E8E4D6' }, headwear: 'shako', accessories: ['musket'], era: '1810s', armed: true },
  napoleonic_french: { dress: (c) => dressNapoleonic(c, true), colors: { coat: '#1E2A5E', trousers: '#E8E4D8', accent: '#EDEAE2' }, headwear: 'shako', accessories: ['musket'], era: '1810s', armed: true },
  civil_war: { dress: dressCivilWar, colors: { coat: '#26304E', trousers: '#6F84A0', accent: '#C9A441' }, headwear: 'kepi', accessories: ['musket'], era: '1860s', armed: true },
  '1910s_formal': { dress: dress1910, colors: { coat: '#2E2A28', trousers: '#2E2A28', accent: '#5A2A2A' }, headwear: 'bowler', accessories: [], era: '1910s' },
  ww1_soldier: { dress: (c) => dressBattledress(c, true), colors: { coat: '#6E6244', trousers: '#6E6244', accent: '#B08A40' }, headwear: 'brodie', accessories: ['rifle'], era: '1910s', armed: true },
  ww2_us: { dress: dressUS, colors: { coat: '#5D553A', trousers: '#5E573F', accent: '#6D694B' }, headwear: 'm1', accessories: ['rifle'], era: '1940s', armed: true },
  ww2_german: { dress: dressGerman, colors: { coat: '#5E6154', trousers: '#5A5D52', accent: '#A9A898' }, headwear: 'stahlhelm', accessories: ['rifle'], era: '1940s', armed: true },
  ww2_british: { dress: (c) => dressBattledress(c, false), colors: { coat: '#6B5C3E', trousers: '#6B5C3E', accent: '#B08A40' }, headwear: 'brodie', accessories: ['rifle'], era: '1940s', armed: true },
  '1950s_casual': { dress: dress1950, colors: { coat: '#6A5A44', trousers: '#3A3A40', accent: '#D8D2C4' }, headwear: 'fedora', accessories: [], era: '1950s' },
  modern_business: { dress: (c) => dressSuit(c), colors: { coat: '#2B2E36', trousers: '#2B2E36', accent: '#7A1F2B' }, headwear: 'none', accessories: [], era: 'modern' },
  modern_casual: { dress: (c) => dressCasual(c), colors: { coat: '#4A6A8A', trousers: '#34435E', accent: '#C23A2A' }, headwear: 'none', accessories: [], era: 'modern' },
  scientist: { dress: dressScientist, colors: { coat: '#F2F1EC', trousers: '#4A4C52', accent: '#2A3A5A' }, headwear: 'none', accessories: [], era: 'modern' },
  astronaut: { dress: dressAstronaut, colors: { coat: '#EEECE6', trousers: '#EEECE6', accent: '#1E3A8A' }, headwear: 'none', accessories: [], era: 'space', h: 1.8, width: 1.06, stride: 1.05 },
  worker: { dress: dressWorker, colors: { coat: '#2E4A6A', trousers: '#2E4A6A', accent: '#E0A020' }, headwear: 'hard_hat', accessories: [], era: 'modern' },
  royalty: { dress: dressRoyal, colors: { coat: '#4A1230', trousers: '#6A1024', accent: '#D4A845' }, headwear: 'crown', accessories: [], era: 'any' },
  farm_1800s: { dress: dressFarm1816, colors: { coat: '#5A4632', trousers: '#6A6258', accent: '#7A3A2A' }, headwear: 'farm', accessories: [], era: '1810s' },
  forager: { dress: dressForager, colors: { coat: '#8A6440', trousers: '#5E4430', accent: '#E8DFCB' }, headwear: 'none', accessories: [], era: 'prehistoric' },
};
export const KIT_ALIASES = {
  soldier_1944_us: 'ww2_us', us: 'ww2_us', gi: 'ww2_us', american_soldier: 'ww2_us', soldier_1944_german: 'ww2_german', german: 'ww2_german', wehrmacht: 'ww2_german',
  tommy: 'ww2_british', british: 'ww2_british', redcoat: 'napoleonic_british', napoleonic: 'napoleonic_french', french: 'napoleonic_french', grenadier: 'napoleonic_french',
  legionary: 'roman_legion', roman: 'roman_legion', knight: 'medieval_knight', peasant: 'medieval_peasant', monk: 'medieval_peasant', ancient: 'ancient_robe', greek: 'ancient_robe', egyptian: 'ancient_robe',
  victorian: '1800s_formal', gentleman: '1800s_formal', edwardian: '1910s_formal', suit: 'modern_business', business: 'modern_business', civilian: 'modern_casual', casual: 'modern_casual',
  tourist: 'modern_casual', doctor: 'scientist', engineer: 'worker', king: 'royalty', queen: 'royalty', emperor: 'royalty', union: 'civil_war', confederate: 'civil_war', doughboy: 'ww1_soldier',
  farmer: 'farm_1800s', farm_family: 'farm_1800s', farmwife: 'farm_1800s', settler: 'farm_1800s', pioneer: 'farm_1800s', homesteader: 'farm_1800s', farm_1816: 'farm_1800s',
  hunter_gatherer: 'forager', huntergatherer: 'forager', stone_age: 'forager', paleolithic: 'forager', palaeolithic: 'forager', prehistoric: 'forager', caveman: 'forager', early_human: 'forager',
};
export function resolveKit(name, warn = () => {}) {
  if (!name) return 'modern_casual';
  const k = String(name).replace(/^figure\./, '').toLowerCase();
  if (KITS[k]) return k;
  if (KIT_ALIASES[k]) return KIT_ALIASES[k];
  for (const key of Object.keys(KITS)) if (k.includes(key) || key.includes(k)) return key;
  for (const [a, key] of Object.entries(KIT_ALIASES)) if (k.includes(a)) return key;
  if (/1944|ww2|wwii|1940/.test(k)) return 'ww2_us';
  if (/ww1|1914|1916|1918|trench/.test(k)) return 'ww1_soldier';
  if (/medieval|castle|crusad/.test(k)) return 'medieval_peasant';
  warn(`unknown kit "${name}" -> modern_casual`);
  return 'modern_casual';
}

// ── dress(def): the one entry point ────────────────────────────────────────────────────────────────────────────
// def = CastDef { id, kit, colors, headwear, accessories, build: {height, bulk}, signature, variant }
export function dress(def = {}, o = {}) {
  const warn = o.warn || (() => {});
  const kitName = def.id === 'witness' && !def.kit ? 'witness' : resolveKit(def.kit, warn);
  const K = KITS[kitName];
  const col = {};
  for (const k of ['coat', 'trousers', 'accent']) col[k] = hexOf(def.colors?.[k], hexOf(K.colors[k], 0x808080));
  if (def.colors?.hat) col.hat = hexOf(def.colors.hat, 0x404040);
  const seed = o.seed ?? (hashStr(stableKey(def)) % 100000) + 1;
  const bulk = clamp(def.build?.bulk ?? 1, 0.75, 1.4), stature = clamp(def.build?.height ?? K.h ?? 1.76, 1.2, 2.2);
  // children are not small adults: below ~1.62 m the head grows relative to the body (1.38 m, a ten-year-old: x1.2;
  // 1.2 m: x1.36), the neck shortens, the shoulders narrow, and the body under the head is built shorter so the top of
  // the head stays at the asked height
  const headScale = 1 + 0.85 * Math.max(0, 1.62 - stature), neckCut = 0.1 * (headScale - 1);   // 1.38 m: head x1.2, neck -2 cm
  const h = stature * 1.76 / (1.76 + 0.185 * (headScale - 1) - neckCut);
  const childW = 1 - 0.4 * (headScale - 1);
  const extras = { props: {}, tails: [], flag: null, light: null, hold: {}, armed: false };
  let headwear = def.headwear === undefined ? K.headwear : (def.headwear || 'none');
  if (headwear && !HEADWEAR[headwear]) {
    const alias = { helmet: K.era === '1940s' ? (kitName === 'ww2_german' ? 'stahlhelm' : kitName === 'ww2_british' ? 'brodie' : 'm1') : K.era === 'medieval' ? 'kettle' : K.era === 'ancient' ? 'galea' : kitName === 'astronaut' ? 'none' : 'brodie',
      cap: K.era === '1940s' ? 'field_cap' : K.era === 'modern' ? 'baseball' : K.era === '1860s' ? 'kepi' : 'flat_cap', hat: K.era === '1800s' ? 'top_hat' : K.era === '1950s' ? 'fedora' : 'bowler',
      tophat: 'top_hat', stahlhelm_m42: 'stahlhelm', m42: 'stahlhelm', m43: 'field_cap', helmet_m1: 'm1', great_helm: 'kettle', bascinet: 'kettle', hardhat: 'hard_hat', officer_cap: 'peaked_cap' }[headwear];
    if (alias) headwear = alias; else { warn(`unknown headwear "${headwear}"`); headwear = 'none'; }
  }
  const acc = (def.accessories ?? K.accessories ?? []).map((a) => (typeof a === 'string' ? { kind: a } : a));
  const fig = R.assemble({ h, headScale, neckCut, width: (K.width ?? 1) * lerp(1, bulk, 0.8) * childW, depth: lerp(1, bulk, 0.9), seed, name: def.id || kitName }, (kit, rig, mat, M, r) => {
    const c = { kit, rig, mat, M, r, col, seed, def, kitName, extras, acc: [], clothed: true, ref: R.refOf(rig), tw: R.torsoWeights(rig.B) };
    K.dress(c);
    if (headwear && headwear !== 'none' && !(kitName === 'astronaut')) HEADWEAR[headwear](c);
    for (const a of [...c.acc, ...acc]) {
      const f = ACCESSORIES[a.kind];
      if (!f) { warn(`unknown accessory "${a.kind}"`); continue; }
      if (a.kind === 'space_helmet' && acc.some((x) => x.kind === 'space_helmet') && c.acc.includes(a)) continue;
      f(c, a);
    }
    if (def.signature) for (const s of String(def.signature).split(/[ ,+]+/)) { const f = SIGNATURES[s]; if (f) f(c); else if (s) warn(`unknown signature "${s}"`); }
    return { props: extras.props, tails: extras.tails, stride: K.stride ?? 1.18 };
  });
  fig.kitName = kitName; fig.def = def; fig.seed = seed; fig.armed = extras.armed; fig.hold = extras.hold;
  return { fig, extras, kit: kitName };
}
