// world.js — the ground of every scene: a seeded procedural terrain per biome, carved by the spec's features, on one
// warped grid (2 m cells around the stage, growing geometrically to 25 km), with a biome shader that has no visible
// tiling (world-space noise at three scales, two rotated detail scales, triplanar rock, snow, sand, fields, roads,
// wet banks and a far forest canopy). Water, vegetation and space are built from here too.
//   buildWorld(world, look, ctx) -> { ground: { height(x,z), normal(x,z) }, update(t, clock, camera), water, hints, ... }
// Coordinates: metres, x east, z south, north = -Z; the ground at the origin (the stage) is y = 0.
import * as THREE from 'three';
import { makeNoise, clamp, lerp, smooth, rng, lin } from '../shared/util.js';
import { U, patchMaterial } from '../shared/env.js';
import * as TX from './tex.js';
import { NOISE_GLSL } from './tex.js';
import { BIOMES, biomeOf, SEASONS } from './biomes.js';
import { buildWater } from './water.js';
import { scatterFlora } from './flora.js';
import { buildSpaceWorld } from './space.js';

export const NU = { uTime: { value: 0 }, uWind: { value: 0.4 }, uCamPos: { value: new THREE.Vector3() } };   // library-wide uniforms

const sr = (x, a, b) => smooth((x - a) / (b - a));
const PRE_CENOZOIC = /cretaceous|jurassic|triassic|permian|carbon|devonian|mesozoic|paleozoic|precambrian|dinosaur/i;
const SIDE = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// ── catalog: the world module places nothing itself; it documents the biomes and features for the director ─────
export const CATALOG = {};
for (const [k, b0] of Object.entries(BIOMES)) {
  const b = b0.alias ? BIOMES[b0.alias] : b0;
  CATALOG['biome.' + k] = { desc: b.desc, section: 'world', biome: k, world: true, actions: [], params: { relief: b.relief ?? 0, vegetation: 0.6, season: b.forceSeason || 'summer' }, footprint: [0, 0], height: 0, tags: ['biome'] };
}
Object.assign(CATALOG, {
  'feature.road': { desc: 'road carved into the terrain: {type:"road", from:[x,z], to:[x,z] (a straight road: things placed on that line stand on it) | points:[[x,z]..] (curving through the points), width:5, surface:"dirt|paved|gravel|cobble"}', section: 'world', feature: true, world: true, actions: [], params: { width: 5, surface: 'dirt' }, footprint: [0, 0], height: 0, tags: ['feature'] },
  'feature.river': { desc: 'river channel with flowing water: {type:"river", from, to | points, width:22}', section: 'world', feature: true, world: true, actions: [], params: { width: 22, depth: 2.5 }, footprint: [0, 0], height: 0, tags: ['feature', 'water'] },
  'feature.lake': { desc: 'lake basin with reflections: {type:"lake", at:[x,z], radius:120}', section: 'world', feature: true, world: true, actions: [], params: { radius: 120 }, footprint: [0, 0], height: 0, tags: ['feature', 'water'] },
  'feature.ridge': { desc: 'raised ridge: {type:"ridge", at:[x,z], height:40, length:400, heading:90}', section: 'world', feature: true, world: true, actions: [], params: { height: 40, length: 400 }, footprint: [0, 0], height: 0, tags: ['feature'] },
  'feature.valley': { desc: 'carved valley: {type:"valley", from, to | at, depth:25, width:120}', section: 'world', feature: true, world: true, actions: [], params: { depth: 25, width: 120 }, footprint: [0, 0], height: 0, tags: ['feature'] },
  'feature.forest_edge': { desc: 'forest beyond a line: {type:"forest_edge", side:"north|south|east|west", dist:120}', section: 'world', feature: true, world: true, actions: [], params: { dist: 120 }, footprint: [0, 0], height: 0, tags: ['feature'] },
  'feature.cliff': { desc: 'rock cliff step: {type:"cliff", at:[x,z], height:30, length:300, heading:180 (direction the face looks)}', section: 'world', feature: true, world: true, actions: [], params: { height: 30, length: 300 }, footprint: [0, 0], height: 0, tags: ['feature'] },
});
export async function build() { return { root: new THREE.Group(), radius: 0, height: 0, update() {}, anchors: {} }; }

// ── polylines ─────────────────────────────────────────────────────────────────────────────────────────────────
function makePath(f, R, step = 12, wiggle = 0.035) {
  let pts = f.points ? f.points.map((p) => [p[0], p[1]]) : null;
  if (!pts) {
    const a = f.from || [0, 600], b = f.to || [0, -600];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
    const n = Math.max(2, Math.ceil(L / 40)), ph = R() * 6.28, amp = (f.straight ? 0 : wiggle) * L;
    pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, w = amp * Math.sin(Math.PI * u) * Math.sin(u * 5.1 + ph) * 0.8;
      pts.push([lerp(a[0], b[0], u) + nx * w, lerp(a[1], b[1], u) + nz * w]);
    }
  }
  // densify with Catmull-Rom so curves are smooth
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  const seg = [];
  let s = 0;
  for (let i = 0; i < out.length - 1; i++) {
    const [ax, az] = out[i], [bx, bz] = out[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-6, l = Math.sqrt(l2);
    seg.push({ ax, az, dx, dz, l2, l, s0: s, minx: Math.min(ax, bx), maxx: Math.max(ax, bx), minz: Math.min(az, bz), maxz: Math.max(az, bz) });
    s += l;
  }
  return { pts: out, seg, len: s };
}
// nearest point on a path: { d, s } (s = arc length); `reach` limits the search (bbox reject)
function nearest(path, x, z, reach = 1e9) {
  let best = 1e18, bs = 0;
  for (const g of path.seg) {
    if (x < g.minx - reach || x > g.maxx + reach || z < g.minz - reach || z > g.maxz + reach) continue;
    let t = ((x - g.ax) * g.dx + (z - g.az) * g.dz) / g.l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = g.ax + g.dx * t - x, pz = g.az + g.dz * t - z, d2 = px * px + pz * pz;
    if (d2 < best) { best = d2; bs = g.s0 + g.l * t; }
  }
  return best > 1e17 ? { d: reach + 1, s: 0 } : { d: Math.sqrt(best), s: bs };
}

// ── the terrain function ─────────────────────────────────────────────────────────────────────────────────────
function makeTerrain(world, B, seed, warn) {
  const R = rng(seed * 7919 + 17);
  const n1 = makeNoise(seed * 31 + 1), n2 = makeNoise(seed * 31 + 2), n3 = makeNoise(seed * 31 + 3);
  const relief = clamp(world.relief ?? B.relief ?? 0.4, 0, 1.5);
  const feats = Array.isArray(world.features) ? world.features : [];
  const shape = B.shape;
  const stageFlat = (r) => lerp(0.22, 1, sr(r, 16, 150));

  // coast geometry
  const coast = world.coast || {};
  const seaSide = SIDE[coast.sea || world.sea || 'east'] || SIDE.east;
  const shoreDist = coast.shore ?? 70;
  const cliffSide = coast.cliffs ?? 'north';
  const perp = [-seaSide[1], seaSide[0]];                        // along-shore axis
  let cliffSign = 1;
  { const cs = SIDE[cliffSide]; if (cs) cliffSign = Math.sign(cs[0] * perp[0] + cs[1] * perp[1]) || 1; }
  const shoreE = (x, z) => {
    const u = x * perp[0] + z * perp[1], v = x * seaSide[0] + z * seaSide[1];
    const v0 = shoreDist + 26 * n2.fbm2(u / 320, 3.3, 3) + 7 * n3.fbm2(u / 70, 1.7, 2);
    return { e: v - v0, u: u * cliffSign };
  };

  // rivers / lakes / roads / valleys prepared once
  const rivers = [], lakes = [], roads = [], valleys = [], ridges = [], cliffs = [], edges = [];
  for (const f of feats) {
    if (!f || typeof f !== 'object') continue;
    switch (f.type) {
      case 'river': rivers.push({ f, path: makePath(f, R, 10, 0.06), hw: (f.width ?? 22) / 2, depth: f.depth ?? 2.4 }); break;
      case 'lake': lakes.push({ f, at: f.at || [0, -250], r: f.radius ?? (f.size ? Math.max(...[].concat(f.size)) / 2 : 120), depth: f.depth ?? 4, ph: R() * 10 }); break;
      // fix: a from/to road is the straight line the spec gives, because objects are placed on that line and vehicles
      // drive straight along their heading. The old default wiggle (3 % of the length) moved a 1.7 km road up to 40 m
      // sideways at the stage, so the cars drove on the grass. A curving road takes `points`; `wiggle` (a fraction of
      // the length) opts back in. makePath still draws its phase from R, so later features keep their shapes.
      case 'road': roads.push({ f, path: makePath(f, R, 6, Number.isFinite(+f.wiggle) ? +f.wiggle : 0), hw: (f.width ?? 5) / 2, surface: f.surface || 'dirt' }); break;
      case 'valley': valleys.push({ f, path: makePath(f.at && !f.from ? { from: [f.at[0], f.at[1] + 600], to: [f.at[0], f.at[1] - 600] } : f, R, 20, 0.05), depth: f.depth ?? 25, hw: (f.width ?? 120) / 2 }); break;
      case 'ridge': ridges.push({ at: f.at || [0, -300], h: f.height ?? 40, len: f.length ?? 400, w: f.width ?? (f.height ?? 40) * 3, hd: (f.heading ?? 90) * Math.PI / 180 }); break;
      case 'cliff': cliffs.push({ at: f.at || [0, -200], h: f.height ?? 30, len: f.length ?? 300, hd: (f.heading ?? 180) * Math.PI / 180 }); break;
      case 'forest_edge': edges.push({ dir: SIDE[f.side] || SIDE.north, dist: f.dist ?? 120 }); break;
      case 'coast': case 'beach': break;
      default: warn(`world.features: unknown type "${f.type}" ignored`);
    }
  }
  // biome defaults
  if (shape === 'valley' && !rivers.length) {
    const pts = []; const ph = R() * 6;
    for (let z = 4200; z >= -4200; z -= 150) pts.push([62 + 75 * Math.sin(z / 310 + ph) + 22 * Math.sin(z / 105 + 1 + ph), z]);
    rivers.push({ f: { type: 'river' }, path: makePath({ points: pts }, R, 10), hw: 13, depth: 2.4, auto: true });
  }
  const valleyAxis = shape === 'valley' ? rivers[0].path : null;
  const waterKindHint = world.water?.kind;

  // the base relief of the biome (before features), raw metres
  function base(x, z) {
    const r = Math.hypot(x, z), fl = stageFlat(r);
    switch (shape) {
      case 'rolling': {
        return relief * (24 * n1.fbm2(x / 650, z / 650, 5) + 5 * n2.fbm2(x / 140, z / 140, 3) * fl + 0.5 * n3.fbm2(x / 24, z / 24, 2) * fl)
          + relief * 170 * sr(r, 1100, 4500) * (0.25 + n2.ridge2(x / 2400, z / 2400, 4));
      }
      case 'hills': {
        return relief * (34 * n1.fbm2(x / 480, z / 480, 5) + 7 * n2.fbm2(x / 110, z / 110, 3) * fl + 0.6 * n3.fbm2(x / 22, z / 22, 2) * fl)
          + relief * 280 * sr(r, 450, 2600) * (0.15 + n2.ridge2(x / 1500, z / 1500, 5));
      }
      case 'mountains': {
        const floor = relief * (5 * n1.fbm2(x / 380, z / 380, 4) + 1.2 * n3.fbm2(x / 60, z / 60, 3) * fl);
        const open = sr(Math.abs(x + 40 * Math.sin(z / 400)), 140, 800);                  // the valley runs north-south
        const foot = relief * 170 * sr(r, 260, 1500) * open * (0.3 + n2.fbm2(x / 650, z / 650, 5) + 0.5);
        const rr = n1.ridge2(x / 3000 + 7, z / 3000 + 3, 6);
        const peaks = relief * 1900 * Math.pow(rr, 2.4) * sr(r, 1100, 5200) * (0.35 + 0.65 * open);
        return floor + foot + peaks;
      }
      case 'dunes': {
        const a = 0.35, ca = Math.cos(a), sa = Math.sin(a);
        const w = x * ca + z * sa, al = -x * sa + z * ca;
        const dune = (L, H, o) => {
          const ph = w / L + 1.4 * n1.fbm2(x / (L * 5), z / (L * 5), 3) + 0.7 * n2.noise2(al / (L * 3.2) + o, w / (L * 9));
          const f = ph - Math.floor(ph);
          const p = f < 0.72 ? smooth(f / 0.72) : 1 - smooth((f - 0.72) / 0.28) * 0.97;       // long windward rise, steep slip face
          return H * p * (0.55 + 0.45 * (n3.fbm2(al / (L * 4), w / (L * 4), 2) * 0.5 + 0.5));
        };
        return relief * (dune(430, 80, 0) + dune(110, 18, 3.1) * lerp(0.45, 1, fl) + 1.2 * n3.fbm2(x / 30, z / 30, 2) * fl)
          + relief * 90 * sr(r, 3000, 9000) * n2.ridge2(x / 2600, z / 2600, 4);
      }
      case 'coast': {
        const { e, u } = shoreE(x, z);
        const cm = sr(u, 60, 150);                                                      // headland along the shore
        if (e < 0) {
          const inl = -e;
          const beach = 2.8 * sr(inl, 0, 48) + 3.5 * sr(inl, 38, 95) * (0.6 + 0.4 * n1.fbm2(x / 40, z / 40, 3) + 0.4);
          const land = relief * (14 * sr(inl, 60, 500) * (0.5 + n1.fbm2(x / 380, z / 380, 4)) + 1.2 * n3.fbm2(x / 35, z / 35, 3) * sr(inl, 20, 80));
          const top = 20 + 22 * relief + 5 * n2.fbm2(x / 150, z / 150, 3) + land * 0.5;
          const face = sr(inl + 3.5 * n3.fbm2(x / 9, z / 9, 3), 0.5, 9);
          const h = beach + land;
          return lerp(h, Math.max(h, top * face), cm);
        }
        const sea = -1.2 * sr(e, 0, 30) - 0.035 * e - 18 * sr(e, 60, 900) + 0.6 * n3.fbm2(x / 25, z / 25, 2) * sr(e, 0, 10);   // no sandbar right at the waterline
        return lerp(sea, Math.min(sea, -3.5 - 0.02 * e) + 1.4 * n1.fbm2(x / 12, z / 12, 3) * sr(e, 0, 40), cm);
      }
      case 'valley': {
        const e = Math.min(nearest(valleyAxis, x, z, 3000).d, 4000);
        const floor = 1.2 * relief * n1.fbm2(x / 160, z / 160, 3) * fl + 0.25 * n3.fbm2(x / 20, z / 20, 2) * fl;
        const hills = relief * 220 * sr(e, 230, 1000) * (0.25 + n2.ridge2(x / 1300, z / 1300, 5)) + relief * 30 * sr(e, 180, 500) * (0.5 + n1.fbm2(x / 300, z / 300, 4));
        return floor + hills + 0.004 * e;
      }
      case 'volcanic': {
        const flows = relief * (8 * n1.fbm2(x / 300, z / 300, 5) + 3.2 * Math.pow(n2.ridge2(x / 70, z / 70, 4), 3) * fl + 0.6 * n3.fbm2(x / 9, z / 9, 3) * fl);
        const vx = x + 1600, vz = z + 5200, d = Math.hypot(vx, vz), Rv = 4600;
        const q = clamp(d / Rv), crater = 120 * (1 - sr(d, 180, 420));
        const cone = 1450 * Math.pow(1 - q, 2.05) * (1 + 0.06 * n1.fbm2(vx / 400, vz / 400, 4)) - crater;
        return flows + Math.max(0, cone) + relief * 60 * sr(r, 1800, 6000) * n2.ridge2(x / 1800, z / 1800, 4);
      }
      case 'ice': {
        return relief * (5 * n1.fbm2(x / 600, z / 600, 4) + 3.5 * Math.pow(n2.ridge2(x / 260, z / 260, 3), 8) * fl + 0.25 * n3.fbm2(x / 6, z / 13, 2) * fl);
      }
      case 'moon': case 'mars': {
        let h = relief * (10 * n1.fbm2(x / 700, z / 700, 5) + 1.5 * n2.fbm2(x / 90, z / 90, 3) * fl);
        const scales = shape === 'moon' ? [[520, 0.55], [150, 0.5], [45, 0.45], [13, 0.4]] : [[700, 0.35], [160, 0.3], [40, 0.2]];
        for (const [S, pr] of scales) {
          const cx = Math.floor(x / S), cz = Math.floor(z / S);
          for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
            const ix = cx + ox, iz = cz + oz;
            const hh = hashf(ix, iz, S);
            if (hh > pr) continue;
            const px = (ix + 0.2 + 0.6 * hashf(ix, iz, S + 1)) * S, pz = (iz + 0.2 + 0.6 * hashf(ix, iz, S + 2)) * S;
            const rad = S * (0.12 + 0.3 * hashf(ix, iz, S + 3)), d = Math.hypot(x - px, z - pz) / rad;
            if (d > 1.8) continue;
            const depth = rad * 0.2 * relief * (Math.hypot(px, pz) < 60 ? 0.2 : 1);
            h += d < 1 ? -depth * (1 - d * d) + depth * 0.25 * Math.pow(d, 6) : depth * 0.25 * Math.exp(-(d - 1) * (d - 1) * 9);
          }
        }
        if (shape === 'mars') {
          const m = n2.fbm2(x / 2600 + 3, z / 2600, 4);
          h += relief * 260 * sr(m, 0.12, 0.18) * sr(r, 1400, 3200) + relief * 2.5 * Math.pow(Math.abs(Math.sin(x / 23 + 2 * n3.noise2(x / 90, z / 90))), 2) * fl;
        }
        return h;
      }
      default: return 0;
    }
  }

  // ── features on top of the base ──
  function roadProfile(rd) {                              // smoothed base heights along a road
    const P = rd.path.pts, H = P.map((p) => base(p[0], p[1]));
    const S = []; let s = 0;
    for (let i = 0; i < P.length; i++) { if (i) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); S.push(s); }
    const out = H.map((_, i) => { let a = 0, w = 0; for (let k = -6; k <= 6; k++) { const j = clamp(i + k, 0, H.length - 1); const ww = 1 - Math.abs(k) / 7; a += H[j] * ww; w += ww; } return a / w; });
    rd.S = S; rd.H = out;
    rd.at = (s) => { let lo = 0, hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; } const f = clamp((s - S[lo]) / ((S[hi] - S[lo]) || 1)); return lerp(out[lo], out[hi], f); };
  }
  roads.forEach(roadProfile);

  // water level (raw): the river sits ~0.8 m under its banks, a lake under its rim
  let level = null;
  if (B.water === 'ocean' || waterKindHint === 'ocean') level = 0;
  if (level === null && rivers.length) {
    let m = 1e9; for (const p of rivers[0].path.pts) { if (Math.hypot(p[0], p[1]) < 900) m = Math.min(m, base(p[0], p[1])); }
    if (m > 1e8) m = base(rivers[0].path.pts[0][0], rivers[0].path.pts[0][1]);
    level = m - 0.8;
  }
  if (level === null && lakes.length) {
    const L = lakes[0]; let m = 1e9;
    for (let a = 0; a < 6.28; a += 0.3) m = Math.min(m, base(L.at[0] + Math.cos(a) * L.r * 1.1, L.at[1] + Math.sin(a) * L.r * 1.1));
    level = m - 0.6;
  }
  if (level !== null && world.water && typeof world.water.level === 'number' && B.water !== 'ocean') {
    // an explicit level is relative to the stage: resolved after normalisation (below)
  }
  const lakeR = (L, x, z) => { const a = Math.atan2(z - L.at[1], x - L.at[0]); return L.r * (1 + 0.22 * n3.noise2(Math.cos(a) * 1.6 + L.ph, Math.sin(a) * 1.6) + 0.08 * n2.noise2(Math.cos(a) * 5 + L.ph, Math.sin(a) * 5)); };

  // full height + the per-vertex masks: roadDist, waterDist (signed, + = dry land), rockBias
  const M = { road: 1e3, water: 1e3, rock: 0 };
  function sample(x, z) {
    let h = base(x, z);
    M.road = 1e3; M.water = 1e3; M.rock = 0;
    for (const v of valleys) {
      const { d } = nearest(v.path, x, z, v.hw * 3);
      if (d < v.hw * 3) h -= v.depth * (1 - sr(d, v.hw * 0.4, v.hw * 2.6));
    }
    for (const g of ridges) {
      const c = Math.cos(g.hd), s = Math.sin(g.hd);
      const dx = x - g.at[0], dz = z - g.at[1], along = dx * s - dz * c, across = dx * c + dz * s;
      const k = Math.exp(-(across * across) / (g.w * g.w * 0.25)) * (1 - sr(Math.abs(along), g.len * 0.35, g.len * 0.6));
      h += g.h * k * (0.85 + 0.3 * n2.fbm2(x / 80, z / 80, 3));
      if (k > 0.3) M.rock = Math.max(M.rock, 0.25 * sr(g.h, 25, 80));
    }
    for (const cf of cliffs) {
      const fx = Math.sin(cf.hd), fz = -Math.cos(cf.hd);                     // the direction the face looks
      const dx = x - cf.at[0], dz = z - cf.at[1];
      const out = dx * fx + dz * fz, along = -dx * fz + dz * fx;
      const span = 1 - sr(Math.abs(along), cf.len * 0.4, cf.len * 0.55);
      const jag = 3 * n3.fbm2(x / 11, z / 11, 3);
      const step = 1 - sr(out + jag, -4, 4);
      h += cf.h * step * span * (0.9 + 0.2 * n1.fbm2(x / 90, z / 90, 3));
      if (span > 0.2 && Math.abs(out + jag) < 7) M.rock = Math.max(M.rock, span);
    }
    if (shape === 'coast') { const { e, u } = shoreE(x, z); M.water = -e; if (u > 60 && -e < 12 && -e > -2) M.rock = Math.max(M.rock, sr(u, 60, 150)); }
    for (const rv of rivers) {
      const { d } = nearest(rv.path, x, z, rv.hw + 60);
      if (d < rv.hw + 60 && level !== null) {
        const q = d / rv.hw;
        const bed = level - rv.depth * Math.pow(Math.max(0, 1 - q * q), 0.7) - 0.25 * (q < 1 ? 1 : 0);
        const bank = level + 0.25 + 1.6 * sr(d - rv.hw, 0, 22) + 0.35 * n3.fbm2(x / 7, z / 7, 2);
        if (q < 1) h = Math.min(h, bed);
        else h = lerp(Math.min(h, bank), h, sr(d - rv.hw, 10, 58));
      }
      M.water = Math.min(M.water, d - rv.hw);
    }
    for (const L of lakes) {
      const d = Math.hypot(x - L.at[0], z - L.at[1]);
      if (d < L.r * 1.9 && level !== null) {
        const rr = lakeR(L, x, z), q = d / rr;
        if (q < 1) h = Math.min(h, level - 0.3 - L.depth * Math.pow(1 - q * q, 0.6));
        else h = lerp(Math.min(h, level + 0.3 + 1.5 * sr(d - rr, 0, 30)), h, sr(d - rr, 12, 70));
        M.water = Math.min(M.water, d - rr);
      } else M.water = Math.min(M.water, d - L.r);
    }
    for (const rd of roads) {
      const { d, s } = nearest(rd.path, x, z, rd.hw + 14);
      if (d < rd.hw + 14) {
        const y = rd.at(s) + 0.06 * (1 - clamp(d / rd.hw));
        h = lerp(y, h, sr(d, rd.hw + 0.8, rd.hw + 11));
      }
      M.road = Math.min(M.road, d - rd.hw);
    }
    if (level !== null && shape !== 'coast' && M.water > 0) h = Math.max(h, level + 0.25 + Math.min(M.water, 3) * 0.1);
    return h;
  }

  // forest density at (x, z) in 0..1 (vegetation scatter, forest floor, far canopy)
  const forestBase = B.forest ?? 0;
  function forestAt(x, z) {
    const r = Math.hypot(x, z);
    let f = 0;
    if (forestBase > 0) {
      const n = n2.fbm2(x / 280 + 11, z / 280 - 4, 4) * 0.5 + 0.5 + 0.12 * n3.fbm2(x / 60, z / 60, 2);
      const th = 1 - forestBase;
      f = sr(n, th - 0.07, th + 0.07);
    }
    for (const e of edges) {
      const along = x * e.dir[0] + z * e.dir[1], side = -x * e.dir[1] + z * e.dir[0];
      const wig = 38 * n1.fbm2(side / 140, 5.5, 3) + 9 * n3.noise2(side / 23, 2.2);
      f = Math.max(f, sr(along - e.dist - wig, -3, 5));
    }
    return f;
  }
  return { base, sample, M, forestAt, level, rivers, lakes, roads, edges, relief, shapeName: shape, shoreE: shape === 'coast' ? shoreE : null, lakeR };
}

function hashf(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// warped axis: fine cells in [-F, F], geometric growth outside to +-R
function axis(F, step, R, grow) {
  const v = [];
  const n = Math.round(F / step);
  for (let i = -n; i <= n; i++) v.push(i * step);
  const E = n * step;
  let s = step, x = E; const hi = []; while (x < R) { s *= grow; x += s; hi.push(x); }
  return [...hi.map((q) => -q).reverse(), ...v, ...hi];
}

// ── the terrain material ─────────────────────────────────────────────────────────────────────────────────────
function paletteUniforms(B, season, world) {
  const g = (B.grass && (B.grass[season] || B.grass.summer)) || ['#556b2f', '#6b7f2e', '#8f8a45'];
  const soil = B.soil || ['#6b5a44', '#7d6a50'];
  const sand = B.sand || ['#cdb68c', '#dcc69c'];
  const c = (h) => new THREE.Color().setRGB(...lin(h));
  return {
    uGrassA: { value: c(g[0]) }, uGrassB: { value: c(g[1]) }, uGrassDry: { value: c(g[2]) },
    uSoilA: { value: c(soil[0]) }, uSoilB: { value: c(soil[1]) }, uRockTint: { value: c(B.rock || '#8a857a') },
    uSandA: { value: c(sand[0]) }, uSandB: { value: c(sand[1]) },
  };
}

function terrainMaterial(B, P, ctx) {
  const tr = TX.rock(), so = TX.soil();
  const TU = Object.assign(paletteUniforms(B, P.season, P.world), {
    uRockMap: { value: tr.map }, uRockN: { value: tr.normalMap }, uSoilMap: { value: so.map }, uSoilN: { value: so.normalMap },
    uLush: { value: P.lush }, uRockSlope: { value: B.rockSlope ?? 0.5 }, uSnow: { value: P.snow }, uSnowLine: { value: P.snowLine },
    uSandy: { value: B.sandy ?? 0 }, uFields: { value: B.fields ? 1 : 0 }, uLava: { value: B.lava ?? 0 }, uIce: { value: B.ice ?? 0 },
    uWaterLevel: { value: P.level ?? -1e4 }, uCoast: { value: P.coast ? 1 : 0 }, uRoadType: { value: P.roadType },
    uRoadSeg: { value: [0, 1, 2, 3].map((i) => { const s = (P.roadSegs || [])[i]; return s ? new THREE.Vector4(s.a[0], s.a[1], s.b[0], s.b[1]) : new THREE.Vector4(); }) },
    uRoadHW: { value: [0, 1, 2, 3].map((i) => (P.roadSegs || [])[i]?.hw ?? 0) }, uRoadN: { value: Math.min(4, (P.roadSegs || []).length) },
    uRoadMark: { value: ({ none: 0, us: 1, eu: 2 })[(P.roadSegs || [])[0]?.mark ?? 'us'] ?? 1 }, uRoadSh: { value: +((P.roadSegs || [])[0]?.sh ?? 0.7) },
    uSeed: { value: (P.seed % 97) * 1.37 }, uCanopy: { value: new THREE.Vector2(P.canopyR0, P.canopyR1) }, uForestFloor: { value: P.forestFloor },
    uWinter: { value: P.season === 'winter' ? 1 : 0 }, uAutumn: { value: P.season === 'autumn' ? 1 : 0 }, uMoon: { value: P.moon ? 1 : 0 },
    uFieldRot: { value: P.fieldRot }, uTime: NU.uTime, uPre: { value: P.pre ? 1 : 0 },
  });
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.55 });
  m.userData.progKey = 'nterrain';
  m.customProgramCacheKey = () => 'nature-terrain-v1';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, TU, { uSunDir2: U.uSunDir, uSunColor2: U.uSunColor });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aF; varying vec4 vAF; varying vec3 vGW; varying vec3 vNw;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAF = aF;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vGW = (modelMatrix * vec4(transformed, 1.0)).xyz; vNw = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vAF; varying vec3 vGW; varying vec3 vNw;
        uniform sampler2D uRockMap, uRockN, uSoilMap, uSoilN;
        uniform vec3 uGrassA, uGrassB, uGrassDry, uSoilA, uSoilB, uRockTint, uSandA, uSandB, uSunDir2, uSunColor2;
        uniform float uLush, uRockSlope, uSnow, uSnowLine, uSandy, uFields, uLava, uIce, uWaterLevel, uCoast, uRoadType, uSeed;
        uniform vec4 uRoadSeg[4]; uniform float uRoadHW[4]; uniform int uRoadN; uniform float uRoadMark, uRoadSh;
        // Q9: exact road-local coordinates of the nearest straight road: x = distance from the centreline, y = along, z = half width
        vec3 roadLocal(vec2 p) {
          vec3 best = vec3(1e5, 0.0, 0.0);
          for (int i = 0; i < 4; i++) {
            if (i >= uRoadN) break;
            vec2 a = uRoadSeg[i].xy, ab = uRoadSeg[i].zw - a; float L = max(length(ab), 1e-3); vec2 u = ab / L;
            float s = clamp(dot(p - a, u), 0.0, L); float d = length(p - a - u * s);
            if (d - uRoadHW[i] < best.x - best.z) best = vec3(d, s, uRoadHW[i]);
          }
          return best;
        }
        uniform vec2 uCanopy; uniform float uForestFloor, uWinter, uAutumn, uMoon, uFieldRot, uTime, uPre;
        ${NOISE_GLSL}
        float wRock, wSnow, wSand, wRoad, wWet, wField, wCanopy, wVeg, wLavaGlow, wFurrow, wEro; vec2 wFieldDir;
        vec3 triTex(sampler2D t, vec3 p, vec3 bw, float s){ return texture2D(t, p.zy * s).rgb * bw.x + texture2D(t, p.xz * s).rgb * bw.y + texture2D(t, p.xy * s).rgb * bw.z; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 P = vGW; vec3 Nw = normalize(vNw);
          float slope = 1.0 - Nw.y;
          float dist = length(P - cameraPosition);
          float rS = length(P.xz);
          vec2 sp = P.xz + uSeed * 173.0;
          // macro variation at three scales (no texture => no tiling)
          float m1 = n_fbm2(sp * 0.0019, 4), m2 = n_fbm2(sp * 0.011 + 3.1, 4), m3 = n_v2(sp * 0.09), m4 = n_v2(sp * 0.45);
          // detail texture at two rotated scales, faded out with distance
          mat2 rt = mat2(0.8, -0.6, 0.6, 0.8);
          float dA = dot(texture2D(uSoilMap, P.xz * 0.31).rgb, vec3(0.333)), dB = dot(texture2D(uSoilMap, rt * P.xz * 0.073).rgb, vec3(0.333));
          float det = mix(1.0, (dA * 0.6 + dB * 0.4) / 0.74, 1.0 - smoothstep(60.0, 400.0, dist));
          // soil
          vec3 soil = mix(uSoilA, uSoilB, smoothstep(0.3, 0.7, m2)) * (0.85 + 0.3 * m3);
          // vegetation cover
          float vegN = smoothstep(0.25, 0.75, m1 * 0.6 + m2 * 0.4);
          vec3 veg = mix(uGrassA, uGrassB, vegN);
          veg = mix(veg, uGrassDry, smoothstep(0.55, 0.85, m2 + (m3 - 0.5) * 0.3) * 0.7);
          veg *= 0.82 + 0.3 * m3 + 0.12 * (m4 - 0.5);
          wVeg = uLush * (1.0 - smoothstep(uRockSlope * 0.55, uRockSlope * 0.95, slope)) * smoothstep(0.08, 0.35, m2 + 0.35 * uLush);
          if (uPre > 0.5) { veg = mix(soil * 0.8, veg * vec3(0.8, 0.9, 0.7), 0.55); }     // no grass before the Cenozoic: mossy litter
          vec3 col = mix(soil, veg, wVeg);
          // forest floor under the trees: dark litter / needles
          float forest = vAF.z;
          wCanopy = smoothstep(0.2, 0.6, forest) * smoothstep(uCanopy.x, uCanopy.y, rS);
          col = mix(col, mix(uSoilA * 0.55, uGrassA * 0.5, 0.35 + 0.3 * m3), forest * uForestFloor * (1.0 - wCanopy));
          // farmland: blocks of strips with crops and furrows
          wField = 0.0; wFurrow = 0.0; wFieldDir = vec2(1.0, 0.0);
          if (uFields > 0.5) {
            float ca = cos(uFieldRot), sa = sin(uFieldRot);
            vec2 q = mat2(ca, sa, -sa, ca) * P.xz;
            q += vec2(14.0 * sin(q.y / 190.0 + 1.3), 11.0 * sin(q.x / 230.0 + 0.4));
            vec2 blk = floor(q / 210.0), bf = fract(q / 210.0) * 210.0;
            float hb = n_h12(blk + 7.0);
            bool alongX = hb > 0.5;
            float nStrips = 2.0 + floor(n_h12(blk + 3.0) * 4.0);
            float coord = alongX ? bf.y : bf.x;
            float sid = floor(coord / (210.0 / nStrips));
            float sf = fract(coord / (210.0 / nStrips)) * (210.0 / nStrips);
            float crop = n_h12(blk * 3.1 + sid + 11.0);
            float edgeD = min(min(bf.x, 210.0 - bf.x), min(bf.y, 210.0 - bf.y));
            float stripE = min(sf, 210.0 / nStrips - sf);
            float margin = 1.0 - smoothstep(1.5, 3.2, min(edgeD, stripE + 1.2));
            vec3 fc;
            float rows = alongX ? q.x : q.y;
            float furrow = 0.5 + 0.5 * sin(rows * 6.2832 / 0.75);
            wFieldDir = alongX ? vec2(ca, -sa) : vec2(sa, ca);
            if (crop < 0.28) { fc = mix(vec3(0.46, 0.36, 0.14), vec3(0.58, 0.47, 0.2), m3) * (0.9 + 0.12 * furrow); wFurrow = 0.3; }        // ripe wheat
            else if (crop < 0.46) { fc = mix(uGrassA, uGrassB, 0.3 + 0.4 * m3) * 1.05; }                                                   // pasture
            else if (crop < 0.62) { fc = mix(uSoilA, uSoilB, 0.5) * (0.62 + 0.35 * furrow); wFurrow = 1.0; }                                // ploughed
            else if (crop < 0.78) { fc = mix(uGrassB, vec3(0.2, 0.26, 0.08), 0.5) * (0.85 + 0.25 * furrow); wFurrow = 0.5; }               // green crop rows
            else if (crop < 0.9) { fc = mix(uGrassDry, uGrassB, 0.4 + 0.3 * m3); }                                                            // hay / fallow
            else { fc = mix(vec3(0.62, 0.52, 0.08), vec3(0.4, 0.42, 0.1), uAutumn + uWinter) * (0.9 + 0.1 * furrow); }                      // rapeseed
            if (uWinter > 0.5) fc = mix(fc, vec3(0.3, 0.26, 0.2), 0.5);
            wField = (1.0 - margin) * (1.0 - smoothstep(0.25, 0.4, slope));
            col = mix(col, fc * (0.9 + 0.15 * m4), wField);
            wFurrow *= wField;
          }
          // sand: desert, beach (band above the waterline), Mars
          float beach = uCoast * (1.0 - smoothstep(26.0, 46.0, vAF.y + 10.0 * (m3 - 0.5))) * (1.0 - smoothstep(0.2, 0.45, slope)) * (1.0 - smoothstep(uWaterLevel + 5.0, uWaterLevel + 9.0, P.y));
          wSand = max(uSandy * (1.0 - smoothstep(uRockSlope * 0.8, uRockSlope, slope + (m3 - 0.5) * 0.2)), beach);
          vec3 sand = mix(uSandA, uSandB, smoothstep(0.3, 0.7, m2)) * (0.9 + 0.15 * m3);
          // lee sides of dunes are a touch darker, crests paler
          sand *= 0.95 + 0.1 * smoothstep(-0.2, 0.3, dot(Nw.xz, normalize(vec2(-0.35, -0.94))));
          // the beach: dry sand pale; the swash zone wet (darker, cooler, glossy) with a ragged edge; a thin wrack line
          // of dried weed and shells where the last high water stopped
          float wetSand = uCoast * (1.0 - smoothstep(2.2, 6.5, vAF.y + 3.0 * (m4 - 0.5) + 2.0 * (m3 - 0.5))) * step(-1.0, vAF.y);
          sand = mix(sand * (1.0 + 0.06 * uCoast), sand * vec3(0.6, 0.61, 0.64), wetSand);
          float wrack = uCoast * exp(-pow((vAF.y - 8.5 - 3.0 * (m3 - 0.5)) / 0.4, 2.0)) * smoothstep(0.35, 0.8, m4);
          sand *= 1.0 - 0.3 * wrack;
          col = mix(col, sand, wSand);
          // rock on steep ground (+ cliff masks); triplanar, tinted per biome
          // Q5: erosion ribs (1) and gullies (0) down the fall line break the rock up on steep ground (and bump it)
          vec2 fall = normalize(Nw.xz + 1e-5), ep = vec2(dot(P.xz, vec2(-fall.y, fall.x)), dot(P.xz, fall));
          wEro = (1.0 - abs(2.0 * n_v2(vec2(ep.x / 11.0, ep.y / 55.0) + 3.7) - 1.0)) * 0.65 + (1.0 - abs(2.0 * n_v2(vec2(ep.x / 4.0, ep.y / 20.0) - 1.9) - 1.0)) * 0.35;
          wEro = mix(0.5, wEro, smoothstep(0.1, 0.3, slope) * (1.0 - smoothstep(500.0, 1600.0, dist)));
          float rockN = (m3 - 0.5) * 0.18 + (m4 - 0.5) * 0.06 + (wEro - 0.5) * 0.22;
          wRock = max(smoothstep(uRockSlope - 0.07, uRockSlope + 0.07, slope + rockN), vAF.w * smoothstep(0.05, 0.3, slope));
          if (wRock > 0.004) {
            vec3 bw = pow(abs(Nw), vec3(4.0)); bw /= dot(bw, vec3(1.0));
            vec3 rc = triTex(uRockMap, P, bw, 1.0 / 7.0) * 0.6 + triTex(uRockMap, P, bw, 1.0 / 29.0) * 0.4;
            vec3 rcol = uRockTint * rc * (0.8 + 0.35 * m2) * 1.25 * (0.78 + 0.44 * wEro);     // ribs catch light, gullies hold shade
            rcol *= mix(vec3(1.0), vec3(0.9, 0.95, 0.85), smoothstep(0.4, 0.8, m1) * 0.5);   // lichen
            col = mix(col, rcol, wRock);
          }
          // roads
          // Q9: a straight paved road gets exact, antialiased edges, weathered asphalt with grain and wheel tracks, painted
          // lines (us: yellow centre dashed 3/9 m, double on roads >= 8.8 m, white edge lines; eu: white dashed centre) and
          // a gravel shoulder (shoulder m). Curving and unpaved roads keep the vertex mask.
          vec3 rl = uRoadN > 0 ? roadLocal(P.xz) : vec3(1e5, 0.0, 0.0);
          bool exactRoad = uRoadType > 0.5 && uRoadType < 1.5 && rl.x < rl.z + 30.0;
          float rfw = max(fwidth(rl.x), 1e-4);
          wRoad = exactRoad ? 1.0 - smoothstep(rl.z - rfw, rl.z + rfw, rl.x + (m4 - 0.5) * 0.04)
                            : 1.0 - smoothstep(-0.15, 0.35, vAF.x + (m4 - 0.5) * 0.4 * step(uRoadType, 0.5));
          if (exactRoad) {
            float shw = smoothstep(rl.z - rfw, rl.z + rfw, rl.x) * (1.0 - smoothstep(rl.z + uRoadSh - 0.15, rl.z + uRoadSh + 0.3, rl.x + (m3 - 0.5) * 0.4));
            vec3 grav = vec3(0.35, 0.335, 0.31) * (0.8 + 0.34 * n_h12(floor(P.xz * 9.0)) * (1.0 - smoothstep(0.03, 0.12, rfw))) * (0.9 + 0.2 * det);
            col = mix(col, grav, shw * 0.92);
          }
          if (wRoad > 0.001) {
            vec3 rcol;
            if (uRoadType < 0.5) {                         // dirt track
              rcol = mix(uSoilA * 0.9, uSoilB * 1.1, m4) * (0.85 + 0.2 * det);
            } else if (uRoadType < 1.5 && exactRoad) {     // paved, exact
              float lane = rl.x, lc = rl.z * 0.5, gf = 1.0 - smoothstep(0.02, 0.09, rfw);
              vec3 asph = vec3(0.135, 0.135, 0.14);
              asph *= 1.0 + (n_h12(floor(P.xz * 23.0)) - 0.5) * 0.24 * gf;                              // aggregate grain
              asph *= 0.88 + 0.22 * m4;                                                                   // weathered patches
              asph *= 0.93 + 0.12 * smoothstep(0.35, 0.7, n_v2(P.xz * 0.07 + 5.0));                     // repaired strips
              asph *= 1.0 - 0.1 * exp(-pow((abs(lane - lc) - 0.8) / 0.35, 2.0));                         // wheel tracks
              asph *= 1.0 - 0.07 * exp(-pow((lane - lc) / 0.3, 2.0));                                     // oil at the lane centre
              rcol = asph * (0.9 + 0.2 * det);
              if (uRoadMark > 0.5) {
                float lw = 0.075, ed = abs(lane - (rl.z - 0.3));
                float edge = clamp((lw - ed) / rfw + 0.5, 0.0, 1.0) * clamp(2.0 * lw / rfw, 0.0, 1.0);
                bool dbl = uRoadMark < 1.5 && rl.z >= 4.4;
                float cw = dbl ? 0.05 : 0.06, cd = dbl ? abs(lane - 0.11) : lane;
                float cen = clamp((cw - cd) / rfw + 0.5, 0.0, 1.0) * clamp(2.0 * cw / rfw, 0.0, 1.0);
                float per = uRoadMark < 1.5 ? 12.0 : 9.0, on = uRoadMark < 1.5 ? 0.25 : 0.333;
                float fy = fract(rl.y / per), fw2 = max(fwidth(rl.y / per), 1e-4);
                float dash = dbl ? 1.0 : mix(clamp((on - fy) / fw2 + 0.5, 0.0, 1.0) * clamp(fy / fw2 + 0.5, 0.0, 1.0), on, smoothstep(0.08, 0.3, fw2));
                vec3 cc = uRoadMark < 1.5 ? vec3(0.6, 0.45, 0.08) : vec3(0.72, 0.72, 0.7);
                float wear = 0.78 + 0.22 * n_v2(P.xz * 2.7);
                rcol = mix(rcol, cc, cen * dash * 0.92 * wear);
                rcol = mix(rcol, vec3(0.74, 0.74, 0.72), edge * 0.9 * wear);
              }
            } else if (uRoadType < 1.5) {                  // paved (curving road): weathered asphalt
              rcol = vec3(0.12, 0.12, 0.125) * (0.85 + 0.3 * m4) * (0.9 + 0.2 * det);
            } else if (uRoadType < 2.5) {                  // gravel
              rcol = vec3(0.42, 0.39, 0.34) * (0.8 + 0.3 * det);
            } else {                                        // cobbles
              vec2 cq = P.xz / 0.22; vec2 ci = floor(cq); vec2 cf = fract(cq) - 0.5;
              rcol = vec3(0.3, 0.29, 0.27) * (0.7 + 0.5 * n_h12(ci)) * (1.0 - 0.5 * smoothstep(0.32, 0.5, max(abs(cf.x), abs(cf.y))));
            }
            col = mix(col, rcol, wRoad);
            // the verge: worn soil either side
            if (!exactRoad) col = mix(col, uSoilB * 0.9, (1.0 - smoothstep(0.0, 1.2, vAF.x)) * smoothstep(-0.2, 0.2, vAF.x) * 0.5);
          }
          // wet ground near water
          wWet = (1.0 - smoothstep(0.0, 6.0, vAF.y)) * step(-40.0, vAF.y) * (1.0 - uCoast) * step(uWaterLevel, 1e3);
          col = mix(col, col * vec3(0.45, 0.46, 0.44), wWet * 0.8);
          col *= 1.0 - (1.0 - smoothstep(-0.5, mix(0.2, -0.02, uCoast), P.y - uWaterLevel)) * 0.45 * step(-1e3, uWaterLevel);     // submerged bed darker
          // snow: biome cover + snowline on mountains; less on steep faces, drifts in hollows
          float snowH = smoothstep(uSnowLine - 60.0, uSnowLine + 40.0, P.y + (m2 - 0.5) * 120.0 + (m3 - 0.5) * 60.0);
          // above the tree line and below the snow: scree and bare rock bands
          if (uSnowLine > -1e3 && uSnowLine < 1e4) {
            float alp = smoothstep(uSnowLine - 320.0, uSnowLine - 60.0, P.y + (m2 - 0.5) * 140.0);
            vec3 scree = uRockTint * (0.75 + 0.4 * m3) * 1.1;
            col = mix(col, scree, alp * 0.85);
            snowH *= 1.0 - smoothstep(0.3, 0.55, slope + (m4 - 0.5) * 0.2) * 0.85;
          }
          wSnow = uSnow * snowH * (1.0 - smoothstep(0.45, 0.78, slope + (m3 - 0.5) * 0.3));
          // on a snowy road: packed snow with two darker wheel ruts instead of bare soil
          if (wRoad > 0.001 && wSnow > 0.01) {
            float rut = 1.0 - smoothstep(0.25, 0.7, abs(abs(vAF.x + 1.6) - 0.0) );
            vec3 packed = vec3(0.72, 0.73, 0.75) * (0.92 + 0.1 * m4);
            packed = mix(packed, vec3(0.42, 0.4, 0.38), (1.0 - smoothstep(0.2, 0.6, abs(fract((vAF.x + 3.0) / 1.9) - 0.5) * 1.9)) * 0.45 * step(vAF.x, -0.4));
            col = mix(col, packed, wRoad * wSnow);
            wSnow *= 1.0 - wRoad * 0.3;
          }
          vec3 snow = vec3(0.9, 0.915, 0.94) * (0.96 + 0.06 * m2);
          if (uIce > 0.5) snow = mix(snow, vec3(0.55, 0.72, 0.85), smoothstep(0.62, 0.8, m1) * 0.5);
          col = mix(col, snow, wSnow);
          // far forest canopy (the lifted ground beyond the instanced trees): mottled crowns
          if (wCanopy > 0.001) {
            vec2 cq = P.xz / 6.5; vec2 id = floor(cq); vec2 f = fract(cq) - 0.5 - (vec2(n_h12(id), n_h12(id + 7.1)) - 0.5) * 0.5;
            float crown = 1.0 - smoothstep(0.1, 0.55, length(f));
            vec3 cc = mix(uGrassA * 0.42, uGrassB * 0.6, crown * 0.6 + m3 * 0.4) * (0.75 + 0.35 * crown);
            if (uWinter > 0.5 && uSnow > 0.5) cc = mix(cc, vec3(0.75, 0.77, 0.8), crown * 0.55);
            if (uAutumn > 0.5) cc = mix(cc, vec3(0.35, 0.18, 0.05), n_h12(id + 3.0) * 0.6);
            col = mix(col, cc, wCanopy);
          }
          // the moon's regolith: flat grey, brighter crater rims
          if (uMoon > 0.5) col = mix(uSoilA, uSoilB, m2) * (0.8 + 0.4 * m3) * (0.9 + 0.2 * det);
          // lava: glowing cracks between the basalt plates
          wLavaGlow = 0.0;
          if (uLava > 0.0) {
            float cr = 1.0 - smoothstep(0.0, 0.05, abs(n_fbm2(P.xz * 0.045 + 9.0, 4) - 0.5));
            wLavaGlow = cr * uLava * smoothstep(0.55, 0.75, n_fbm2(P.xz * 0.004, 3)) * (1.0 - wSnow);
            col = mix(col, vec3(0.02, 0.018, 0.016), wLavaGlow);
          }
          diffuseColor.rgb = col * det;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.94, 0.82, wRock);
        roughnessFactor = mix(roughnessFactor, 0.97, wSand);
        roughnessFactor = mix(roughnessFactor, 0.62, wSnow);
        roughnessFactor = mix(roughnessFactor, uRoadType > 0.5 && uRoadType < 1.5 ? 0.78 : 0.95, wRoad);
        roughnessFactor = mix(roughnessFactor, 0.42, wWet * 0.6 + uCoast * (1.0 - smoothstep(1.5, 6.0, vAF.y)) * step(-1.0, vAF.y) * 0.75);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 P = vGW; float dist = length(P - cameraPosition);
          float near = 1.0 - smoothstep(40.0, 320.0, dist);
          // detail normals: soil map at two scales (ground), triplanar rock
          vec3 Nw = normalize(vNw);
          float hgt = 0.0;
          if (near > 0.0) {
            float s1 = dot(texture2D(uSoilMap, P.xz * 0.31).rgb, vec3(0.333));
            float s2 = dot(texture2D(uSoilMap, mat2(0.8, -0.6, 0.6, 0.8) * P.xz * 0.073).rgb, vec3(0.333));
            hgt += (s1 * 0.012 + s2 * 0.035) * (1.0 - wSnow * 0.7) * (1.0 - wRoad * 0.6);
            // sand ripples across the wind, snow wind-ripples, field furrows
            float rip = sin(dot(P.xz, vec2(0.94, -0.35)) * 6.2832 / 0.42 + n_v2(P.xz * 0.35) * 6.0) * 0.5 + 0.5;
            hgt += rip * 0.012 * wSand * (1.0 - 0.75 * uCoast) * (1.0 - smoothstep(0.35, 0.6, 1.0 - Nw.y)) * (1.0 - smoothstep(18.0, 55.0, dist));
            hgt += (n_v2(vec2(P.x * 1.6 + P.z * 0.6, P.z * 3.4 - P.x * 0.9)) * 0.02 + n_v2(P.xz * 0.35) * 0.05) * wSnow;
            float fur = sin(dot(P.xz, vec2(-wFieldDir.y, wFieldDir.x)) * 6.2832 / 0.75);
            hgt += fur * 0.03 * wFurrow;
          }
          hgt += n_fbm2(P.xz * 0.6, 3) * 0.08 * (1.0 - wRoad) * (1.0 - smoothstep(80.0, 600.0, dist));
          hgt += (wEro - 0.5) * 1.1 * max(wRock, smoothstep(0.2, 0.4, 1.0 - Nw.y) * 0.5) * (1.0 - smoothstep(200.0, 600.0, dist));   // Q5: gullies
          normal = n_bump(-vViewPosition, normal, hgt);
          if (wRock > 0.01 && dist < 900.0) {
            vec3 bw = pow(abs(Nw), vec3(4.0)); bw /= dot(bw, vec3(1.0));
            float s = 1.0 / 7.0;
            vec3 tX = texture2D(uRockN, P.zy * s).xyz * 2.0 - 1.0, tY = texture2D(uRockN, P.xz * s).xyz * 2.0 - 1.0, tZ = texture2D(uRockN, P.xy * s).xyz * 2.0 - 1.0;
            tX = vec3(tX.xy + Nw.zy, abs(tX.z) * Nw.x); tY = vec3(tY.xy + Nw.xz, abs(tY.z) * Nw.y); tZ = vec3(tZ.xy + Nw.xy, abs(tZ.z) * Nw.z);
            vec3 wN = normalize(tX.zyx * bw.x + tY.xzy * bw.y + tZ.xyz * bw.z);
            vec3 rN = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
            normal = normalize(mix(normal, rN, wRock * (1.0 - smoothstep(300.0, 900.0, dist))));
          }
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // snow / ice sparkle: tiny facets that catch the sun
          if (wSnow > 0.5) {
            vec3 cell = floor(vGW * 55.0);
            float hs = n_h13(cell);
            if (hs > 0.9975) {
              vec3 V = normalize(cameraPosition - vGW);
              vec3 Nw2 = normalize(inverseTransformDirection(normal, viewMatrix));
              vec3 fac = normalize(Nw2 + (vec3(n_h13(cell + 1.7), n_h13(cell + 3.1), n_h13(cell + 5.9)) - 0.5) * 1.6);
              float gl = pow(max(dot(reflect(-V, fac), uSunDir2), 0.0), 60.0);
              totalEmissiveRadiance += uSunColor2 * gl * 5.0 * wSnow * (1.0 - smoothstep(20.0, 120.0, length(cameraPosition - vGW)));
            }
          }
          if (wLavaGlow > 0.0) totalEmissiveRadiance += vec3(4.0, 1.1, 0.2) * wLavaGlow * (0.7 + 0.3 * sin(uTime * 1.3 + vGW.x * 0.1));
        }`);
  };
  const pm = (ctx.patch || patchMaterial)(m) || m;
  return { m: pm, TU };
}

// ── buildWorld ─────────────────────────────────────────────────────────────────────────────────────────────
export async function buildWorld(world = {}, look = {}, ctx = {}) {
  const T0 = performance.now();
  const warnings = [];
  const warn = (s) => { warnings.push(s); if (ctx.warn) ctx.warn(s); else console.warn('[nature]', s); };
  let name = String(world.biome || 'plains').toLowerCase();
  let B = biomeOf(name);
  if (!B) { warn(`world.biome "${name}" unknown, using plains`); name = 'plains'; B = BIOMES.plains; }
  if (name === 'open_sea') name = 'ocean';
  const seed = (world.seed ?? 1) | 0;
  let season = B.forceSeason || world.season || 'summer';
  if (!SEASONS.includes(season)) { warn(`world.season "${season}" unknown, using summer`); season = 'summer'; }
  const period = String(world.period || look.period || 'modern');
  const pre = PRE_CENOZOIC.test(period);
  const vegetation = clamp(world.vegetation ?? 0.6, 0, 1.5);
  const scene = ctx.scene;
  const root = new THREE.Group(); root.name = 'nature.world';
  if (scene) scene.add(root);
  NU.uWind.value = clamp((ctx.weatherSpec?.wind ?? ctx.weather?.wind ?? world.wind ?? 0.35), 0, 1.5);

  // space: no ground at all
  if (B.shape === 'none' && name === 'space') {
    const sp = await buildSpaceWorld(world, look, ctx, root);
    const ov = makeEnvOverride('space', ctx, root);
    const upd = (t, clock, camera) => { NU.uTime.value = t; ov(); sp.update(t, clock, camera); };
    return finish({ ground: { height: () => -1e4, normal: () => [0, 1, 0], level: null }, update: upd, hints: { sky: 'space', fog: 0, haze: 0, ...(sp.hints || {}) }, root, warnings, biome: name });
  }

  const T = makeTerrain(world, B, seed, warn);
  let hOff = B.shape === 'none' ? 0 : T.sample(0, 0);
  if (T.level !== null && B.water === 'ocean') { /* sea level stays the reference before the offset */ }
  let level = T.level !== null ? T.level - hOff : null;
  if (level !== null && typeof world.water?.level === 'number' && B.water !== 'ocean') level = world.water.level;
  if (name === 'ocean') { hOff = 0; level = world.water?.level ?? 0; }

  let snow = world.snow != null && world.snow !== false ? clamp(+world.snow) : (B.snow ?? 0), snowLine = 2e4;
  if (snow > 0) snowLine = B.snowLine != null ? B.snowLine * Math.max(0.5, T.relief / (B.relief || 0.8)) : -2e4;
  if (season === 'winter' && (B.snow ?? 0) === 0 && world.snow !== false && world.snow == null && ['plains', 'farmland', 'forest', 'river_valley'].includes(name)) { snow = 0.85; snowLine = -2e4; }
  if (name === 'mountains' && season === 'winter') snowLine *= 0.35;
  const P = {
    world, season, seed, lush: (B.lush ?? 0.8) * (season === 'winter' ? 0.55 : 1) * clamp(0.5 + vegetation * 0.8, 0, 1.2),
    snow, snowLine, level, coast: B.shape === 'coast',
    roadType: { dirt: 0, paved: 1, gravel: 2, cobble: 3 }[T.roads[0]?.surface] ?? 0, canopyR0: 620, canopyR1: 760,
    // Q9: straight (from/to) roads for the exact road material: crisp edges, lines, shoulder (curving `points` roads keep the mask)
    roadSegs: T.roads.filter((r) => r.f.from && r.f.to && !r.f.points && !(+r.f.wiggle > 0)).slice(0, 4).map((r) => ({ a: r.f.from, b: r.f.to, hw: r.hw, mark: r.f.markings, sh: r.f.shoulder })),
    forestFloor: B.forest > 0.5 ? 0.9 : 0.6, fieldRot: (seed * 0.37) % 1.2 - 0.6, moon: B.shape === 'moon', pre,
  };

  let mesh = null, heights = null, XS = null, ZS = null;
  if (B.shape !== 'none') {
    const F = world.extent ?? 520, c0 = world.cell ?? 2.0;
    XS = axis(F, c0, 26000, 1.036); ZS = XS.slice();
    const nx = XS.length, nz = ZS.length;
    const pos = new Float32Array(nx * nz * 3), aF = new Float32Array(nx * nz * 4);
    heights = new Float32Array(nx * nz);
    const canR0 = 560, canR1 = 800;
    const canopyH = B.forest ? (name === 'jungle' ? 26 : 17) : 0;
    for (let j = 0; j < nz; j++) {
      const z = ZS[j];
      for (let i = 0; i < nx; i++) {
        const x = XS[i];
        const h = T.sample(x, z) - hOff;
        const k = j * nx + i;
        heights[k] = h;
        let y = h;
        let fo = 0;
        if (B.forest || T.edges.length) {
          fo = T.forestAt(x, z) * (T.M.water > 12 ? 1 : 0) * (T.M.road > 6 ? 1 : 0);
          if (level !== null && h < level + 1) fo = 0;
          if (name === 'mountains' && h > P.snowLine - 120) fo *= 1 - sr(h, P.snowLine - 220, P.snowLine - 100);
          const rr = Math.hypot(x, z);
          if (canopyH && rr > canR0) y += fo * canopyH * sr(rr, canR0, canR1) * (0.85 + 0.3 * hashf(i, j, 5));
        }
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        aF[k * 4] = clamp(T.M.road, -20, 60); aF[k * 4 + 1] = clamp(T.M.water, -60, 200); aF[k * 4 + 2] = fo; aF[k * 4 + 3] = T.M.rock;
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let q = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aF', new THREE.BufferAttribute(aF, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const { m } = terrainMaterial(B, P, ctx);
    mesh = new THREE.Mesh(g, m);
    mesh.name = 'nature.terrain'; mesh.userData.ground = true; mesh.userData.noQA = true; mesh.receiveShadow = true; mesh.castShadow = true; mesh.frustumCulled = false;
    root.add(mesh);
  }
  const tTerrain = performance.now() - T0;

  // ── ground API: exactly the rendered surface (same triangles), analytic outside the grid ──
  const nx = XS ? XS.length : 0;
  const find = (A, v) => { let lo = 0, hi = A.length - 1; if (v <= A[0]) return [0, 0]; if (v >= A[hi]) return [hi - 1, 1]; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (A[m] <= v) lo = m; else hi = m; } return [lo, (v - A[lo]) / (A[lo + 1] - A[lo])]; };
  function height(x, z) {
    if (!heights) return name === 'ocean' ? (level ?? 0) : -1e4;
    if (Math.abs(x) > 25000 || Math.abs(z) > 25000) return T.sample(x, z) - hOff;
    const [i, fx] = find(XS, x), [j, fz] = find(ZS, z);
    const a = heights[j * nx + i], b = heights[j * nx + i + 1], c = heights[(j + 1) * nx + i], d = heights[(j + 1) * nx + i + 1];
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }
  function normal(x, z) {
    const e = 0.6;
    const hx = height(x + e, z) - height(x - e, z), hz = height(x, z + e) - height(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    return [-hx / l, 2 * e / l, -hz / l];
  }
  const fields = {
    forestAt: (x, z) => T.forestAt(x, z),
    masks: (x, z) => { T.sample(x, z); return { road: T.M.road, water: T.M.water, rock: T.M.rock }; },
    fieldEdge: (x, z) => {                                      // metres to the nearest hedge line (farmland blocks), same maths as the shader
      const ca = Math.cos(P.fieldRot), sa = Math.sin(P.fieldRot);
      let qx = ca * x - sa * z, qz = sa * x + ca * z;
      qx += 14 * Math.sin(qz / 190 + 1.3); qz += 11 * Math.sin(qx / 230 + 0.4);
      const fx = ((qx / 210) % 1 + 1) % 1 * 210, fz = ((qz / 210) % 1 + 1) % 1 * 210;
      return Math.min(fx, 210 - fx, fz, 210 - fz);
    },
  };
  const ground = { height, normal, level, fields };
  ctx.ground = ground;

  // ── water ──
  let water = null;
  const wkind = world.water?.kind && world.water.kind !== 'none' ? world.water.kind : (B.water || (T.rivers.length ? 'river' : T.lakes.length ? 'lake' : 'none'));
  if (level !== null || wkind === 'ocean') {
    water = await buildWater({ kind: wkind === 'ocean' ? 'ocean' : 'still', level: level ?? 0, biome: name, ground, T, hOff, world, look }, ctx, root);
    ground.water = water;
    ctx.water = water;
  }

  // ── vegetation, rocks ──
  const tf0 = performance.now();
  let flora = null;
  if (B.shape !== 'none') flora = await scatterFlora({ biome: name, B, ground, T, hOff, season, pre, vegetation, level, seed, world, ctx, root, clear: clearList(world, ctx), snowCover: P.snowLine < -1e3 ? P.snow : 0 });
  const tFlora = performance.now() - tf0;

  // ── sky extras for other bodies (moon: the Earth in the black sky; mars: tint) ──
  let spaceExtras = null;
  if (B.sky === 'space' || B.sky === 'mars') spaceExtras = await buildSpaceWorld({ ...world, sky: B.sky, biome: name }, look, ctx, root, { skyOnly: true });

  const envOv = makeEnvOverride(B.sky, ctx, root);
  function update(t, clock, camera) {
    NU.uTime.value = t;
    envOv();
    if (camera) NU.uCamPos.value.copy(camera.position);
    if (water) water.update(t, clock, camera);
    if (flora) flora.update(t, clock, camera);
    if (spaceExtras) spaceExtras.update(t, clock, camera);
  }
  const mood = B.mood || {};
  const hints = {
    sky: B.sky || 'earth', haze: mood.haze ?? 1, fog: mood.fog ?? 1, tint: mood.tint || null,
    waterLevel: level, snow: P.snow, season, biome: name,
  };
  console.log(`[nature] ${name} built in ${Math.round(performance.now() - T0)} ms (terrain ${Math.round(tTerrain)}, flora ${Math.round(tFlora)})`);
  return finish({ ground, update, water, flora, hints, root, warnings, biome: name, terrain: mesh, clearance: flora ? flora.clearance : () => 1e9 });

  function finish(o) { o.ground = o.ground || ground; return o; }
}

// skies the core does not paint: space (black, stars: the star sphere covers the core's dome) and Mars (butterscotch
// dome + dust-coloured haze). Re-applied every sub-frame after the core's look has set the scene's values.
function makeEnvOverride(mode, ctx, root) {
  if (mode !== 'space' && mode !== 'mars') return () => {};
  let hemi = null, hemiBase = null, found = false;
  if (mode === 'mars') {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: U.uSunDir },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 uSunDir;
        void main(){ vec3 rd = normalize(vDir); float y = max(rd.y, 0.0);
          vec3 col = mix(vec3(0.62, 0.40, 0.25), vec3(0.26, 0.16, 0.11), pow(y, 0.45));
          float mu = max(dot(rd, normalize(uSunDir)), 0.0);
          col += vec3(0.35, 0.45, 0.6) * pow(mu, 40.0) * 0.9 + vec3(0.5, 0.35, 0.25) * pow(mu, 6.0) * 0.25;
          col += vec3(1.0, 0.95, 0.9) * smoothstep(0.99955, 0.9997, mu) * 16.0;
          col = mix(col, vec3(0.55, 0.36, 0.22), exp(-y * 9.0) * 0.7);
          gl_FragColor = vec4(col, 1.0); }`,
      depthWrite: false, depthTest: false, side: THREE.BackSide, fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
    dome.frustumCulled = false; dome.renderOrder = -1e6 + 1; dome.name = 'nature.marsSky'; dome.userData.noQA = true;
    dome.onBeforeRender = (r, s, cam) => { dome.position.copy(cam.position); dome.updateMatrixWorld(); };
    root.add(dome);
  }
  return () => {
    if (!found) {
      found = true;
      const top = ctx.world3 || ctx.scene;
      if (top) top.traverse((o) => { if (o.isHemisphereLight && !hemi) hemi = o; });
      if (hemi) hemiBase = hemi.intensity;
    }
    if (mode === 'space') {
      U.uFogDensity.value = 0;
      if (hemi) hemi.intensity = hemiBase * 0.1;
    } else {
      U.uFogColor.value.setRGB(0.55, 0.36, 0.22); U.uFogSunColor.value.setRGB(0.3, 0.2, 0.12);
      U.uFogDensity.value = Math.max(U.uFogDensity.value, 0.00022);
      if (hemi) { hemi.color.setRGB(0.62, 0.42, 0.28); hemi.groundColor.setRGB(0.25, 0.14, 0.08); }
    }
  };
}

// positions to keep free of trees and rocks: the stage, the spec's things (if the core passes the spec), world.clear
function clearList(world, ctx) {
  const out = [[0, 0, world.stage_clear ?? 16]];
  for (const c of world.clear || []) if (Array.isArray(c)) out.push([c[0], c[1], c[2] ?? 10]);
  const spec = ctx.spec || null;
  if (spec) {
    const add = (it, r) => { if (it && Array.isArray(it.at)) out.push([it.at[0], it.at[1], r]); };
    for (const it of spec.cast || []) add(it, 4);
    for (const it of spec.objects || []) add(it, 8);
    for (const it of spec.structures || []) add(it, 30);
    for (const it of spec.labels || []) add(it, 12);
    for (const it of spec.groups || []) if (Array.isArray(it.at)) { const s = [].concat(it.size || [10, 10]); out.push([it.at[0], it.at[1], Math.max(s[0] ?? 10, s[1] ?? 10) * 0.7 + 4]); }
  }
  return out;
}
