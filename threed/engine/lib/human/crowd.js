// crowd.js — groups of figures: formations (column, line, square, crowd, scatter) in any kit, animated (march, walk,
// run/charge, idle sway, cheer, kneel/aim, sit), plus cavalry. The figures are the SAME mannequins as the cast (kits.js),
// built at crowd detail (rig.setDetail), posed at N frames of their cycle and baked into static geometries (CPU skinning,
// vertex colours + per-vertex roughness/metalness). Each (variant, frame) is one InstancedMesh; every frame the
// instances are bucketed by their own gait phase (flipbook instancing), ground-snapped, with instanced contact shadows.
// Deterministic in t; positions come from the formation slots + distance travelled, never from state.
import * as THREE from 'three';
import * as R from './rig.js';
import { dress, KITS, resolveKit, hashStr, stableKey } from './kits.js';
import { buildHorse } from './horse.js';
import { POSE, idlePose, idleLoopClock } from './cast.js';
import { ground, xz, DEG, patchAll, blobMaterial, polyPath, rngFor } from './common.js';
import { clamp, lerp, smoother } from '../shared/util.js';

const TAU = Math.PI * 2;
const DEFP = { lArmZ: 0.07, rArmZ: -0.07, lElbow: -0.14, rElbow: -0.14, lLegY: 0.06, rLegY: -0.06, lLegZ: 0.015, rLegZ: -0.015 };
const ACTIONS = ['march', 'walk', 'run', 'charge', 'idle', 'stand', 'watch', 'cheer', 'kneel', 'aim', 'sit_ground', 'ride'];
const FORMATIONS = ['column', 'line', 'square', 'crowd', 'scatter'];
const SPEED = { march: 1.45, walk: 1.3, run: 3.4, charge: 3.8, ride: 3.2 };

// ── baking ───────────────────────────────────────────────────────────────────────────────────────────────────────
const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();
function bakeSkinned(fig) {                     // current pose of every SkinnedMesh -> one geometry (object space)
  const parts = [];
  fig.group.updateMatrixWorld(true); fig.skeleton.update();
  const BM = fig.skeleton.boneMatrices;
  for (const mesh of fig.meshes) {
    const mat = mesh.material; if (!mat || mat.alphaTest > 0 || mat.transparent) continue;
    const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, n = P.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), mr = new Float32Array(n * 2);
    const c = mat.color || new THREE.Color(1, 1, 1), em = mat.emissive && mat.emissiveIntensity ? mat.emissive.r + mat.emissive.g + mat.emissive.b : 0;
    for (let i = 0; i < n; i++) {
      let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ax = N.getX(i), ay = N.getY(i), az = N.getZ(i);
      for (let k = 0; k < 4; k++) {
        const w = SW.getComponent(i, k); if (w <= 0) continue;
        const e = BM, o = SI.getComponent(i, k) * 16;
        px += w * (e[o] * x + e[o + 4] * y + e[o + 8] * z + e[o + 12]); py += w * (e[o + 1] * x + e[o + 5] * y + e[o + 9] * z + e[o + 13]); pz += w * (e[o + 2] * x + e[o + 6] * y + e[o + 10] * z + e[o + 14]);
        nx += w * (e[o] * ax + e[o + 4] * ay + e[o + 8] * az); ny += w * (e[o + 1] * ax + e[o + 5] * ay + e[o + 9] * az); nz += w * (e[o + 2] * ax + e[o + 6] * ay + e[o + 10] * az);
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz; nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
      col[i * 3] = c.r + (em ? 0.6 : 0); col[i * 3 + 1] = c.g + (em ? 0.45 : 0); col[i * 3 + 2] = c.b + (em ? 0.2 : 0);
      mr[i * 2] = mat.roughness ?? 0.8; mr[i * 2 + 1] = mat.metalness ?? 0;
    }
    parts.push({ pos, nrm, col, mr, idx: g.index.array });
  }
  return parts;
}
function bakeMeshes(root) {                     // rigid hierarchy (horse, props) -> parts in root space
  const parts = []; root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const mat = o.material, g = o.geometry, P = g.attributes.position, N = g.attributes.normal, n = P.count;
    _m.multiplyMatrices(inv, o.matrixWorld); const nm = new THREE.Matrix3().getNormalMatrix(_m);
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), mr = new Float32Array(n * 2), c = mat.color;
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(_m); _n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      pos.set([_v.x, _v.y, _v.z], i * 3); nrm.set([_n.x, _n.y, _n.z], i * 3); col.set([c.r, c.g, c.b], i * 3); mr.set([mat.roughness ?? 0.8, mat.metalness ?? 0], i * 2);
    }
    parts.push({ pos, nrm, col, mr, idx: g.index ? g.index.array : [...Array(n).keys()] });
  });
  return parts;
}
function partsToGeometry(parts, yOff = 0) {
  let nv = 0, ni = 0; for (const p of parts) { nv += p.pos.length / 3; ni += p.idx.length; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), mr = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of parts) {
    const n = p.pos.length / 3; pos.set(p.pos, ov * 3); nrm.set(p.nrm, ov * 3); col.set(p.col, ov * 3); mr.set(p.mr, ov * 2);
    for (let k = 0; k < p.idx.length; k++) idx[oi + k] = p.idx[k] + ov;
    ov += n; oi += p.idx.length;
  }
  if (yOff) for (let i = 1; i < pos.length; i += 3) pos[i] += yOff;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aMR', new THREE.BufferAttribute(mr, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere();
  return g;
}
let CROWD_MAT = null, CROWD_MORPH = null;
// morph (moving crowds): each baked frame also carries the NEXT frame (position2/normal2) and every instance its
// fraction between the two (aMorph), so the gait plays continuously and the planted foot stays put between frames
// (a flipbook alone made it creep forward by stride/frames, then snap back: 7.5 cm walking, 20 cm charging)
const MORPH_VS = [['#include <common>', '#include <common>\nattribute vec3 position2; attribute vec3 normal2; attribute float aMorph;'],
  ['#include <beginnormal_vertex>', 'vec3 objectNormal = normalize( mix( normal, normal2, aMorph ) );\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif'],
  ['#include <begin_vertex>', 'vec3 transformed = mix( position, position2, aMorph );']];
function crowdMaterial(morph = false) {
  if (morph ? CROWD_MORPH : CROWD_MAT) return morph ? CROWD_MORPH : CROWD_MAT;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 0.7 });
  m.onBeforeCompile = (sh) => {
    if (morph) for (const [a, b] of MORPH_VS) sh.vertexShader = sh.vertexShader.replace(a, b);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aMR; varying vec2 vMR;').replace(morph ? MORPH_VS[2][1] : '#include <begin_vertex>', (morph ? MORPH_VS[2][1] : '#include <begin_vertex>') + '\nvMR = aMR;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vMR;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vMR.x;').replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMR.y;');
  };
  const key = morph ? 'f3d-crowd-morph' : 'f3d-crowd';
  m.customProgramCacheKey = () => key;
  m.userData.progKey = key;
  if (morph) {
    // the shadow passes morph the same way (a sun's depth map, a lamp's distance map)
    const shadowMat = (M, k) => { const d = new M(); d.onBeforeCompile = (sh) => { for (const [a, b] of MORPH_VS.filter((x) => x[0] !== '#include <beginnormal_vertex>')) sh.vertexShader = sh.vertexShader.replace(a, b); }; d.customProgramCacheKey = () => k; return d; };
    m.userData.depth = shadowMat(THREE.MeshDepthMaterial, 'f3d-crowd-morph-depth');
    m.userData.distance = shadowMat(THREE.MeshDistanceMaterial, 'f3d-crowd-morph-dist');
    m.userData.keep = true; m.userData.depth.userData.keep = true; m.userData.distance.userData.keep = true;
  }
  return morph ? (CROWD_MORPH = m) : (CROWD_MAT = m);
}

// ── variants: palettes so a crowd of civilians is not one family in uniform ─────────────────────────────────────
const CIV = { coat: ['#4A6A8A', '#8A3A2A', '#3A5A3A', '#D8D2C4', '#2A2A30', '#6A5A7A', '#B89A5A', '#5A7A9A', '#9A8A7A'], trousers: ['#34435E', '#2A2A2E', '#6A6258', '#3A3A44', '#4A4034', '#1E2430'] };
const ERA_CIV = { ancient: ['ancient_robe'], medieval: ['medieval_peasant'], '1800s': ['1800s_formal'], '1910s': ['1910s_formal'], '1950s': ['1950s_casual'], modern: ['modern_casual', 'modern_business'] };
function variantDefs(kitName, item, n, r) {
  const out = [];
  const kits = Array.isArray(item.kits) && item.kits.length ? item.kits.map((k) => resolveKit(k)) : [kitName];
  const civilian = !KITS[kitName].armed;
  for (let v = 0; v < n; v++) {
    const kit = kits[v % kits.length], K = KITS[kit];
    const def = { id: `crowd:${kit}:${v}`, kit, colors: item.colors ? { ...item.colors } : undefined, headwear: item.headwear, accessories: item.accessories, variant: item.variant };
    if (civilian && !item.colors && kit !== 'witness') def.colors = { coat: CIV.coat[Math.floor(r() * CIV.coat.length)], trousers: CIV.trousers[Math.floor(r() * CIV.trousers.length)], accent: K.colors.accent };
    if (civilian && item.headwear === undefined && K.headwear === 'none' && r() < 0.25 && kit === 'modern_casual') def.headwear = 'baseball';
    def.build = { height: 1.66 + r() * 0.2, bulk: 0.92 + r() * 0.16 };
    out.push(def);
  }
  return out;
}
// pose + gait for a baked frame
// idle-life loops (static groups): baked frames per loop, played per instance with its own phase and pace (morph)
const LOOP = { idle: 12, kneel: 10, sit_ground: 10, aim: 10 }, LOOP_T = 9;
function framePose(fig, action, f, F, v = 0) {
  const g = fig.gait, base = fig.stride, armed = fig.armed;
  const P = (p) => ({ ...DEFP, ...p, weapon: armed ? (p.weapon ?? 'sling') : null });
  if (action === 'march' || action === 'walk' || action === 'run' || action === 'charge') {
    const run = action === 'run' || action === 'charge';
    const saved = [g.duty, g.lift, g.flatEnd, fig.stride];
    if (run) { g.duty = 0.4; g.lift = 0.2; g.flatEnd = 0.24; fig.stride = base * 1.9; }
    if (action === 'march') { g.lift = 0.13; fig.stride = base * 1.05; }
    const pose = action === 'march' ? POSE.march : run ? { ...POSE.run, weapon: action === 'charge' ? 'port' : 'port' } : POSE.walk;
    fig._apply(P(pose), { ph: f / F * TAU, k: 1 });
    [g.duty, g.lift, g.flatEnd, fig.stride] = saved;
    return;
  }
  if (action === 'cheer') { const o = Math.sin(f / F * TAU); fig._apply(P({ ...POSE.cheer, lArmZ: POSE.cheer.lArmZ - 0.2 * o, rArmZ: POSE.cheer.rArmZ - 0.2 * o, lElbow: -0.35 - 0.25 * (1 + o), rElbow: -0.35 - 0.25 * (1 - o) }), null); return; }
  // breathing, weight shift, glances, a hand adjust (cast.js idlePose), periodic over the loop; the variant varies it
  const life = (pose, a) => (F > 1 ? idlePose(pose, a, idleLoopClock(f / F, v + 1, 2)) : pose);
  if (action === 'kneel' && !armed && F > 1) {
    // kneeling at work (gatherers, rescuers): leaning in, looking down at the hands, which move alternately in front
    const a1 = TAU * 2 * f / F + v, a2 = a1 + Math.PI * 0.8;
    const hand = (x, a) => ({ space: 'root', p: [x + 0.04 * Math.sin(a), 0.3 + 0.07 * Math.max(0, Math.sin(a + 1)), 0.42 + 0.07 * Math.cos(a)], fingers: [0, -0.8, 0.6], palm: [0, -0.9, -0.3], pole: [x > 0 ? 1 : -1, -0.2, -0.6] });
    fig._apply(P(life({ ...POSE.kneel, weapon: null, lean: 0.6, chestX: 0.15, headX: 0.35, lHand: hand(0.14, a1), rHand: hand(-0.14, a2), lShape: 'soft', rShape: 'soft' }, 'kneel')), null);
    return;
  }
  if (action === 'kneel') { fig._apply(P(life({ ...POSE.kneel, weapon: 'port' }, 'kneel')), null); return; }
  if (action === 'aim') { fig._apply(P(life({ ...POSE.aim, weapon: 'aim' }, 'aim')), null); return; }
  if (action === 'sit_ground') { fig._apply(P(life(POSE.sit_ground, 'sit_ground')), null); return; }
  if (action === 'ride') { fig._apply(P({ ...POSE.ride, weapon: 'sling' }), null); return; }
  const w = v % 2 === 1;                                                    // odd variants watch, even ones stand
  fig._apply(P(life(w ? POSE.watch : POSE.stand, w ? 'watch' : 'stand')), null);
}

// the planted foot's backward sweep per gait cycle (m), measured on F baked frames of contact points in root space
// (feet[f] = [[point, ...] per foot]; a foot counts as planted at its lowest point near the frame's lowest sole)
function sweepPerCycle(feet, F) {
  const S = [];
  for (let f = 0; f < F; f++) {
    const A = feet[f], B = feet[(f + 1) % F];
    const low = (fr) => Math.min(...fr.map((foot) => Math.min(...foot.map((p) => p[1]))));
    const lowA = low(A), lowB = low(B);
    A.forEach((foot, k) => {
      let j = 0; foot.forEach((p, q) => { if (p[1] < foot[j][1]) j = q; });
      const a = foot[j], b = B[k] && B[k][j];
      if (!b || a[1] - lowA > 0.03 || b[1] - lowB > 0.03 || a[1] > 0.12 || b[1] > 0.12) return;
      S.push(a[2] - b[2]);
    });
  }
  if (!S.length) return null;
  S.sort((p, q) => p - q);
  return S[S.length >> 1] * F;
}

// pairs of 2D points closer than r: [[a, b, d], ...] (spatial hash, a < b)
function closePairs(P, r) {
  const cells = new Map(), out = [], key = (i, j) => i + ',' + j;
  P.forEach((p, n) => { const k = key(Math.floor(p[0] / r), Math.floor(p[1] / r)); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(n); });
  P.forEach((p, n) => {
    const i = Math.floor(p[0] / r), j = Math.floor(p[1] / r);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const m of cells.get(key(i + di, j + dj)) || []) {
      if (m <= n) continue;
      const d = Math.hypot(P[m][0] - p[0], P[m][1] - p[1]); if (d < r) out.push([n, m, d]);
    }
  });
  return out;
}
// random layouts (scatter) may put two figures inside each other: push such pairs apart (the rest keep their slot)
function separate(slots, minSep, iters = 24) {
  for (let k = 0; k < iters; k++) {
    const pairs = closePairs(slots, minSep);
    if (!pairs.length) return;
    for (const [a, b, d] of pairs) {
      let dx = slots[b][0] - slots[a][0], dz = slots[b][1] - slots[a][1];
      if (d < 1e-6) { const an = a * 2.399 + b * 0.7; dx = Math.cos(an); dz = Math.sin(an); } else { dx /= d; dz /= d; }
      const push = (minSep - d) / 2 + 0.005;
      slots[a][0] -= dx * push; slots[a][1] -= dz * push; slots[b][0] += dx * push; slots[b][1] += dz * push;
    }
  }
}

function layout(item, count, r) {
  const f = FORMATIONS.includes(item.formation) ? item.formation : 'crowd';
  const size = Array.isArray(item.size) ? item.size : [item.size ?? 10, item.size ?? 10];
  const slots = [];               // [u (right), v (forward), yawOffset, facingOut]
  if (f === 'column') {
    const across = Math.max(1, item.files ?? Math.max(2, Math.round(size[0] / 1.1))), dx = item.spacing ?? 1.05, dz = (item.spacing ?? 1.05) * 1.3;
    for (let i = 0; i < count; i++) { const a = i % across, b = Math.floor(i / across); slots.push([(a - (across - 1) / 2) * dx + (r() - 0.5) * 0.06, -b * dz + (r() - 0.5) * 0.08, (r() - 0.5) * 0.04]); }
  } else if (f === 'line') {
    const ranks = item.ranks ?? 2, per = Math.ceil(count / ranks), dx = item.spacing ?? 0.95;
    for (let i = 0; i < count; i++) { const a = i % per, b = Math.floor(i / per); slots.push([(a - (per - 1) / 2) * dx + (b % 2) * dx * 0.5 + (r() - 0.5) * 0.05, -b * 1.05, (r() - 0.5) * 0.05, 0, b]); }
  } else if (f === 'square') {
    const ranks = item.ranks ?? (count < 240 ? 2 : 4), per = Math.max(2, Math.ceil(count / 4 / ranks)), dx = 0.9, half = per * dx / 2 + 0.5;
    for (let i = 0; i < count; i++) {
      const face = i % 4, j = Math.floor(i / 4), rank = j % ranks, k = Math.floor(j / ranks);
      const along = (k - (per - 1) / 2) * dx, out = half - rank * 0.9, yaw = face * Math.PI / 2;
      const u = Math.sin(yaw) * out + Math.cos(yaw) * along, v = Math.cos(yaw) * out - Math.sin(yaw) * along;
      slots.push([u, v, yaw, 1, rank]);
    }
  } else if (f === 'scatter') {
    for (let i = 0; i < count; i++) slots.push([(r() - 0.5) * size[0], (r() - 0.5) * size[1], (r() - 0.5) * TAU]);
  } else {                                          // crowd: dense in the middle, facing the focus with jitter
    const minD = Math.sqrt(size[0] * size[1] / Math.max(1, count)) * 0.55;
    let tries = 0;
    while (slots.length < count && tries++ < count * 60) {
      const a = r() * TAU, rr = Math.sqrt(r()), u = Math.cos(a) * rr * size[0] / 2, v = Math.sin(a) * rr * size[1] / 2;
      if (slots.some((s) => Math.abs(s[0] - u) < minD && Math.abs(s[1] - v) < minD && Math.hypot(s[0] - u, s[1] - v) < minD)) continue;
      slots.push([u, v, (r() - 0.5) * 0.9]);
    }
    while (slots.length < count) slots.push([(r() - 0.5) * size[0], (r() - 0.5) * size[1], (r() - 0.5) * 0.9]);
  }
  return { slots, formation: f };
}

// ── catalog ────────────────────────────────────────────────────────────────────────────────────────────────────
const GPARAMS = { count: 'figures (1..3000)', formation: FORMATIONS.join('|'), at: '[x, z]', size: '[width, depth] m', heading: 'deg (0 = north): facing / marching direction',
  action: ACTIONS.join('|'), speed: 'm/s', path: '[[x, z], ...] a column follows it', kits: 'mix kits (crowds)', colors: '{coat, trousers, accent}', face: '[x, z] crowd focus', ranks: 'line/square ranks' };
export const CATALOG = {};
for (const k of Object.keys(KITS)) CATALOG['figure.' + k] = { desc: `group of ${k.replace(/_/g, ' ')} figures in formation (instanced, animated)`, actions: ACTIONS, params: GPARAMS, footprint: [10, 10], height: 1.8, tags: ['group', 'figure', KITS[k].era] };
Object.assign(CATALOG, {
  'figure.crowd': { desc: 'a civilian crowd of the era (params.era: ancient|medieval|1800s|1910s|1950s|modern)', actions: ACTIONS, params: { ...GPARAMS, era: 'ancient|medieval|1800s|1910s|1950s|modern' }, footprint: [20, 20], height: 1.8, tags: ['group', 'crowd'] },
  'figure.soldier_1944_us': { desc: 'US infantry 1944 (alias of figure.ww2_us)', actions: ACTIONS, params: GPARAMS, footprint: [8, 40], height: 1.8, tags: ['group', '1940s', 'war'] },
  'figure.soldier_1944_german': { desc: 'German infantry 1944 (alias of figure.ww2_german)', actions: ACTIONS, params: GPARAMS, footprint: [8, 40], height: 1.8, tags: ['group', '1940s', 'war'] },
  'figure.cavalry': { desc: 'mounted riders in any kit (params.kit, default napoleonic_french); walk / trot / charge', actions: ['ride', 'march', 'charge', 'idle'], params: { ...GPARAMS, kit: 'rider kit' }, footprint: [20, 30], height: 2.6, tags: ['group', 'horse', 'war'] },
});
export const handles = (kind) => typeof kind === 'string' && kind.startsWith('figure.') && !['figure.person', 'figure.witness'].includes(kind);

// ── build ──────────────────────────────────────────────────────────────────────────────────────────────────────
export async function build(kind, item = {}, ctx = {}) {
  const t0 = performance.now();
  const warn = (m) => (ctx.warnings ? ctx.warnings.push(m) : console.warn('[f3d/human]', m));
  const G = ground(ctx), r = rngFor(ctx, (item.seed ?? 0) + hashStr(stableKey({ kind, at: item.at, count: item.count, formation: item.formation })) % 99991 + 1);
  const cavalry = kind === 'figure.cavalry';
  let kitName = cavalry ? resolveKit(item.kit || 'napoleonic_french', warn) : kind === 'figure.crowd' ? (ERA_CIV[item.era] || ERA_CIV.modern)[0] : resolveKit(kind.replace(/^figure\./, ''), warn);
  if (kind === 'figure.crowd' && !item.kits) item = { ...item, kits: ERA_CIV[item.era] || ERA_CIV.modern };
  const count = clamp(Math.round(item.count ?? 24), 1, 3000);
  let action = String(item.action || (cavalry ? 'ride' : 'idle')).toLowerCase();
  if (!ACTIONS.includes(action)) { warn(`group action "${action}" -> idle`); action = 'idle'; }
  if (action === 'stand' || action === 'watch') action = 'idle';
  const moving = ['march', 'walk', 'run', 'charge', 'ride'].includes(action) || (cavalry && action !== 'idle');
  const riderAction = cavalry ? 'ride' : action;
  const speed = item.speed ?? (cavalry ? (action === 'charge' ? 6.5 : action === 'idle' ? 0 : 3.2) : SPEED[action] ?? 0);
  // frames + variants
  const F = cavalry ? (action === 'idle' ? 1 : 16) : moving ? (action === 'run' || action === 'charge' ? 12 : 16) : action === 'cheer' ? 8 : LOOP[action] ?? 1;
  const looped = !moving && !cavalry && !!LOOP[action] && F > 1;                    // an idle-life loop (not frozen frames)
  const V = clamp(item.variants ?? (KITS[kitName].armed ? 2 : 4), 1, 6);
  const detail = count > 600 ? 0.3 : count > 150 ? 0.38 : 0.5;
  const defs = variantDefs(kitName, item, V, r);
  const geos = [];                 // geos[v][f]
  const bakedStride = [];          // per variant: the planted foot's sweep per gait cycle, measured on the baked frames (loco QA)
  const prevDetail = R.getDetail(); R.setDetail(detail);
  let horse = null;
  const kHorse = action === 'idle' ? 0 : action === 'charge' ? 1.3 : 1.1;     // horse gait: gallop for a charge, else a trot
  try {
    for (const def of defs) {
      const { fig } = dress(def, { warn });
      const list = [], feet = [];
      if (cavalry && !horse) horse = buildHorse({ seed: 3, blanket: new THREE.Color(KITS[kitName].colors.accent).getHex() });
      for (let f = 0; f < F; f++) {
        framePose(fig, riderAction, f, F, defs.indexOf(def));
        if (moving && F > 1) {
          if (cavalry) { horse.update(f / F * 2, kHorse, f / F * horse.strideFor(kHorse)); if (horse.contacts) feet.push(horse.contacts()); }
          else if (fig.footContacts) { fig.group.updateMatrixWorld(true); feet.push(fig.footContacts()); }
        }
        let parts = bakeSkinned(fig);
        if (cavalry) {
          horse.update(f / F * 2, kHorse, f / F * horse.strideFor(kHorse));
          parts = parts.map((p) => { const q = { ...p, pos: p.pos.slice() }; for (let i = 1; i < q.pos.length; i += 3) q.pos[i] += horse.saddleY - 0.87 * fig.rig.s + horse.bob(); return q; }).concat(bakeMeshes(horse.group));
        }
        list.push(partsToGeometry(parts));
      }
      geos.push(list);
      bakedStride.push(feet.length === F ? sweepPerCycle(feet, F) : null);
      for (const m of fig.meshes) m.geometry.dispose();
    }
  } finally { R.setDetail(prevDetail); }
  const { slots, formation } = layout(item, count, r);
  const minSep = cavalry ? 1.8 : 0.62;                          // centre-to-centre: two figures closer than this overlap
  if (formation === 'scatter' || formation === 'crowd') separate(slots, minSep);
  // instance -> variant, phase, speed jitter
  const inst = slots.map((s, i) => ({ s, v: Math.floor(r() * V), ph: formation === 'column' && action === 'march' ? (r() - 0.5) * 0.04 : r(), sp: formation === 'column' ? 1 : 0.88 + r() * 0.24, sway: r() * TAU, idle: Math.floor(r() * 4) }));
  // how each instance travels (moving groups): EVERY figure travels along its own facing (QUALITY.md H1).
  //   column / line / square / a path: rigid, one pace (nobody walks through the rank ahead), all face the travel
  //     (a square marches facing forward; its sides face out only when it halts)
  //   scatter: its own direction within ±15° of the heading; crowd: ±6°; wander: true = any direction, on gentle arcs
  //   (the old scatter yaw becomes the walking direction). Pairs that would walk into each other get the same course.
  const rigid = ['column', 'line', 'square'].includes(formation) || (Array.isArray(item.path) && item.path.length >= 2);
  if (moving) {
    const rm = rngFor(ctx, 7919 + ((item.seed ?? 0) + count * 31) % 99991);   // own stream: the variants keep their draws
    for (const it of inst) {
      const yo = it.s[2];
      it.dirOff = 0; it.kappa = 0; it.fj = 0;
      if (rigid) { it.sp = 1; it.fj = formation === 'square' ? (rm() - 0.5) * 0.04 : clamp(yo, -0.05, 0.05); }
      else if (item.wander) { it.dirOff = formation === 'scatter' ? yo : (rm() - 0.5) * TAU; it.kappa = (rm() < 0.5 ? -1 : 1) * (1 / 80 + rm() * (1 / 25 - 1 / 80)); }
      else it.dirOff = formation === 'scatter' ? yo * (15 / 180) : clamp(yo, -0.45, 0.45) * (6 / 26);
    }
  }
  const root = new THREE.Group(); root.name = 'group:' + kind;
  const morph = F > 1 && (moving || looped || action === 'cheer') && item.morph !== false;
  const mat = crowdMaterial(morph);
  const perV = Array(V).fill(0); for (const it of inst) perV[it.v]++;
  if (morph) geos.forEach((list) => list.forEach((g, f) => {
    const nx = list[(f + 1) % F];
    g.setAttribute('position2', new THREE.BufferAttribute(nx.attributes.position.array, 3));
    g.setAttribute('normal2', new THREE.BufferAttribute(nx.attributes.normal.array, 3));
  }));
  const meshes = geos.map((list, v) => list.map((g) => {
    const m = new THREE.InstancedMesh(g, mat, Math.max(1, perV[v])); m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
    if (morph) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, perV[v])), 1); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aMorph', a);
      m.customDepthMaterial = mat.userData.depth; m.customDistanceMaterial = mat.userData.distance;
    }
    root.add(m); return m;
  }));
  // contact shadows
  const blobGeo = new THREE.PlaneGeometry(cavalry ? 1.3 : 0.9, cavalry ? 2.8 : 0.8); blobGeo.rotateX(-Math.PI / 2);
  const blobs = new THREE.InstancedMesh(blobGeo, blobMaterial(0.45), count); blobs.frustumCulled = false; blobs.renderOrder = 2; root.add(blobs);
  // placement frame
  const at = xz(item.at), focus = item.face ? xz(item.face) : null;
  let hdgDeg = item.heading ?? 180;
  // a walking crowd with a focus walks toward it (while moving, figures face where they go, not the focus)
  if (moving && focus && formation === 'crowd' && Math.hypot(focus[0] - at[0], focus[1] - at[1]) > 1) hdgDeg = (Math.atan2(focus[0] - at[0], -(focus[1] - at[1])) / DEG + 360) % 360;
  const hdg = hdgDeg * DEG;
  const fwd = [Math.sin(hdg), -Math.cos(hdg)], right = [Math.cos(hdg), Math.sin(hdg)];
  // a column turns its corners on arcs wide enough for its inner file (no pivoting, nobody walking backwards)
  const uMax = Math.max(0, ...slots.map((s) => Math.abs(s[0])));
  const path = Array.isArray(item.path) && item.path.length >= 2 ? polyPath(item.path, { round: Math.min(12, uMax + (cavalry ? 3 : 1.5)), w: 0.4 }) : null;
  // the path's heading angle, unwrapped, at s: a file offset u from the centreline walks s + u·(θ(s) − θ(s0)) metres
  let thetaAt = null;
  if (path) {
    const n = Math.max(2, Math.ceil(path.length / 0.25)), TH = new Float64Array(n + 1);
    let prev = null, acc = 0;
    for (let k = 0; k <= n; k++) {
      const d = path.dir(path.length * k / n), a = Math.atan2(d[0], d[1]);
      if (prev != null) { let da = a - prev; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; acc += da; }
      TH[k] = acc; prev = a;
    }
    thetaAt = (s) => { const x = clamp(s / Math.max(1e-6, path.length), 0, 1) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i; return TH[i] * (1 - f) + TH[i + 1] * f; };
  }
  const base = Math.atan2(fwd[0], fwd[1]);
  const _mat = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const counts = meshes.map((l) => l.map(() => 0));
  const cycle = (it) => (cavalry ? horse.strideFor(kHorse) : (defsStride[it.v] || 1.2) * (action === 'run' || action === 'charge' ? 1.9 : action === 'march' ? 1.05 : 1));
  const defsStride = defs.map((d) => (KITS[d.kit].stride ?? 1.18) * (d.build.height / 1.76));
  // x, z, facing yaw, dist = distance travelled along its own track, gd = the distance its feet walked (the gait phase)
  function place(it, t) {
    const [u, v0, yo] = it.s;
    const dist = moving ? speed * it.sp * t : 0;
    let x, z, yaw, gd = dist;
    if (path) {
      const s0 = (item.path_start ?? 0) + v0, s = s0 + dist;     // the head of the column starts at path_start
      let p, d;
      if (s < 0) { d = path.dir(0); const p0 = path.at(0); p = [p0[0] + d[0] * s, p0[1] + d[1] * s]; }
      else if (s > path.length) { d = path.dir(path.length); const p1 = path.at(path.length); p = [p1[0] + d[0] * (s - path.length), p1[1] + d[1] * (s - path.length)]; }
      else { p = path.at(s); d = path.dir(s); }
      x = p[0] - d[1] * u; z = p[1] + d[0] * u;
      yaw = Math.atan2(d[0], d[1]) + (moving ? it.fj : yo);
      if (moving) gd = Math.max(0, dist + u * (thetaAt(s) - thetaAt(s0)));   // the inner file walks less, the outer more
    } else if (moving) {
      // its own straight line (or a gentle arc when wandering), facing along it
      const x0 = at[0] + right[0] * u + fwd[0] * v0, z0 = at[1] + right[1] * u + fwd[1] * v0, y0 = base + it.dirOff;
      if (it.kappa) { const th = y0 + it.kappa * dist; x = x0 + (Math.cos(y0) - Math.cos(th)) / it.kappa; z = z0 + (Math.sin(th) - Math.sin(y0)) / it.kappa; yaw = th; }
      else { x = x0 + Math.sin(y0) * dist; z = z0 + Math.cos(y0) * dist; yaw = y0; }
      yaw += it.fj;
    } else {
      x = at[0] + right[0] * u + fwd[0] * v0; z = at[1] + right[1] * u + fwd[1] * v0;
      yaw = base + yo;
      if (focus && formation === 'crowd') yaw = Math.atan2(focus[0] - x, focus[1] - z) + yo * 0.5;
      if (action === 'idle' && !looped) yaw += 0.05 * Math.sin(t * 0.37 + it.sway);
    }
    return { x, z, yaw, dist, gd };
  }
  // figures that would walk into each other (their own directions / paces cross) take the same course and pace: the
  // conflicting ones are joined into groups (union-find) that walk in parallel from their separated starting places
  if (moving && !rigid && inst.length > 1) {
    const T = Math.max(4, +(item.dur ?? ctx.dur ?? 12) || 12) + 0.5;
    const par = inst.map((_, i) => i), find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const course = inst.map((it) => [it.dirOff, it.kappa, it.sp]);
    let left = 0;
    for (let round = 0; round < 12; round++) {
      const bad = [];
      for (let t = 0; t <= T + 1e-6; t += 0.25) {
        const P = inst.map((it) => { const p = place(it, t); return [p.x, p.z]; });
        for (const [a, b] of closePairs(P, minSep)) if (find(a) !== find(b)) bad.push([a, b]);
      }
      left = bad.length;
      if (!left) break;
      for (const [a, b] of bad) { const ra = find(a), rb = find(b); if (ra !== rb) par[Math.max(ra, rb)] = Math.min(ra, rb); }
      inst.forEach((it, i) => { const c = course[find(i)]; it.dirOff = c[0]; it.kappa = c[1]; it.sp = c[2]; });
    }
    if (left) warn(`${kind}: ${left} close passes between figures left (${formation}, ${count} figures)`);
  }
  // the group's centre, for the camera's subject / DOF focus and QA (the root itself stays at the world origin)
  const body = new THREE.Object3D(); body.name = 'group-centre'; root.add(body);
  function update(t = 0) {
    for (const l of counts) l.fill(0);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < inst.length; i++) {
      const it = inst[i], { x, z, yaw, gd } = place(it, t), y = G.h(x, z);
      cx += x; cy += y; cz += z;
      let f = 0, fr = 0;
      if (moving && F > 1) { const q = (((gd / cycle(it)) + it.ph) % 1 + 1) % 1 * F; f = Math.floor(q) % F; fr = q - Math.floor(q); }
      else if (action === 'cheer') { const q = (((t * 1.1 + it.ph) % 1) + 1) % 1 * F; f = Math.floor(q) % F; fr = q - Math.floor(q); }
      else if (looped) { const q = (((t / (LOOP_T * (0.9 + 0.2 * it.sway / TAU)) + it.ph) % 1) + 1) % 1 * F; f = Math.floor(q) % F; fr = q - Math.floor(q); }
      else if (action === 'idle') f = it.idle % F;
      const sway = !moving && !looped ? 0.012 * Math.sin(t * 0.9 + it.sway) : 0;
      _q.setFromAxisAngle(up, yaw); if (sway) _q.multiply(_q2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), sway));
      _p.set(x, y, z); _mat.compose(_p, _q, _s);
      const m = meshes[it.v][f], c = counts[it.v][f]++;
      m.setMatrixAt(c, _mat);
      if (morph) m.geometry.attributes.aMorph.array[c] = fr;
      const nn = G.n(x, z); _q2.setFromUnitVectors(up, nn).multiply(_q.setFromAxisAngle(up, yaw)); _p.set(x, y + 0.03, z); _mat.compose(_p, _q2, _s); blobs.setMatrixAt(i, _mat);
    }
    meshes.forEach((l, v) => l.forEach((m, f) => { m.count = counts[v][f]; m.instanceMatrix.needsUpdate = true; if (morph) m.geometry.attributes.aMorph.needsUpdate = true; }));
    blobs.instanceMatrix.needsUpdate = true;
    const n = Math.max(1, inst.length); body.position.set(cx / n, cy / n, cz / n);
  }
  update(0);
  patchAll(root, ctx);
  let tris = 0; for (const l of geos) tris += l[0].index.count / 3;
  const ms = Math.round(performance.now() - t0);
  root.userData.stats = { count, variants: V, frames: F, trisPerFigure: Math.round(tris / V), ms };
  const ext = Math.max(...slots.map((s) => Math.hypot(s[0], s[1]))) + 1;
  // anchors.body = the group's centre (camera subject, DOF focus, QA "moving"); members(t) = every figure (camera track,
  // QA figure clearance); contact: false = the group draws its own instanced contact shadows (no registry duplicates)
  return { root, radius: ext, height: cavalry ? 2.6 : 1.9, update: (t) => update(t), anchors: { center: body, body }, stats: root.userData.stats, contact: false,
    positions: (t) => inst.map((it) => { const p = place(it, t); return [p.x, G.h(p.x, p.z), p.z]; }),
    members: (t) => inst.map((it) => { const p = place(it, t); return [p.x, p.z]; }),
    facings: (t) => inst.map((it) => place(it, t).yaw),
    // locomotion QA (core/loco.js): position, facing and gait phase of every instance; stride = the baked frames' measured
    // planted-foot sweep per cycle, flip = the flipbook step (the planted foot's saw-tooth between two baked frames)
    ...(moving && F > 1 ? { loco: { kind, walkers: (t) => inst.map((it) => { const p = place(it, t); return { x: p.x, z: p.z, yaw: p.yaw, phase: p.gd / cycle(it) + it.ph, stride: bakedStride[it.v] ?? cycle(it), flip: morph ? 0 : cycle(it) / F }; }) } } : {}) };
}
