// sealife.js — shore and shallow-sea life for coast scenes (H3, 26 Sep 2026):
//   sealife.ordovician  an Ordovician shallow-sea community (445 Ma): trilobites crawling head first on the wet sand,
//                       orthocone nautiloids gliding shell first just under the surface, crinoid gardens swaying,
//                       rugose horn corals and tabulate honeycomb mounds, ribbed brachiopods in clusters
//   sealife.shellfish   a Stone Age shore (Pinnacle Point, 74 ka): brown-mussel beds and limpets on the rocks and the wet
//                       sand at the tide line, and at `pile` a small midden of opened shells with a little charcoal
// Placement: the item's area (at = centre, size = [w, d] along x / z) is sampled on a 0.5 m grid for the water depth
// (ocean level minus ground); each kind has a depth band, so the life lines the waterline wherever the area crosses it
// (no water: a plain scatter). Things "on the rocks" are raycast onto rock.* objects built before this item.
// Deterministic from seed; every motion is a pure function of t. Instanced vertex-coloured templates.
import * as THREE from 'three';
import { patchMaterial } from '../shared/env.js';
import { rng, clamp, lerp, smooth, lin } from '../shared/util.js';

const TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);

export const CATALOG = {
  'sealife.ordovician': {
    desc: 'Ordovician sea life 445 Ma scattered over an area by water depth: trilobites (7-25 cm, 60 % crawling head first at 1.5-4 cm/s along gentle arcs on the wet sand at the tide line, the rest still), orthocone nautiloids (0.6-1.5 m banded straight shells, tentacles trailing, gliding shell first just under the surface), crinoid sea-lily gardens (clusters of 3-7; 0.35-1 m stalks, feathery crowns, cream/pink/purple/ochre, swaying) in the first 16 cm of water, rugose horn corals + tabulate honeycomb mounds (0.1-0.5 m), ribbed brachiopod clusters. at = area centre, size [w, d]; put the area across the waterline',
    actions: ['idle'],
    params: { size: [24, 14], trilobites: 14, nautiloids: 3, crinoids: 24, corals: 10, brachiopods: '18 = clusters of 6-14 shells', seed: 1 },
    footprint: [24, 14], height: 1, tags: ['sea', 'ocean', 'ordovician', 'paleozoic', 'trilobite', 'nautiloid', 'crinoid', 'coral', 'brachiopod', 'fossil', 'shore', 'prehistoric', 'animal'],
  },
  'sealife.shellfish': {
    desc: 'shellfish on a rocky shore at the tide line: brown mussel beds (blue-black, clustered) and ribbed limpets on the rocks and wet sand, plus at `pile` [x, z] a ~0.8 m midden of opened mussel halves, limpets, whelks and a little charcoal (Pinnacle Point foragers, 74 ka). at = area centre, size [w, d] across the waterline',
    actions: ['idle'],
    params: { size: [16, 6], clusters: 12, pile: '[x, z] or null', seed: 1 },
    footprint: [16, 6], height: 0.1, tags: ['shellfish', 'mussel', 'limpet', 'midden', 'shell', 'shore', 'tide', 'stone age', 'forager', 'coast'],
  },
};

// ── geometry helpers ────────────────────────────────────────────────────────────────────────────────────────────
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V(sx, sy, sz));
const Mdir = (p, dir, s = 1) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()), V(s, s, s));
// non-indexed copy with a colour attribute (colour: [r,g,b] linear, or fn(x, y, z) of the LOCAL position), then placed
function prep(geo, color, m4) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const P = g.attributes.position, n = P.count, C = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = typeof color === 'function' ? color(P.getX(i), P.getY(i), P.getZ(i)) : color;
    C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  if (m4) g.applyMatrix4(m4);
  return g;
}
function merge(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.computeBoundingSphere();
  return out;
}
const dome = (ws, hs) => new THREE.SphereGeometry(1, ws, hs, 0, TAU, 0, Math.PI / 2);
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

function mat(ctx, o = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.rough ?? 0.7, metalness: 0, side: o.double ? THREE.DoubleSide : THREE.FrontSide, envMapIntensity: o.env ?? 0.7 });
  return (ctx.patch || patchMaterial)(m) || m;
}
function inst(geo, material, n, name) {
  const im = new THREE.InstancedMesh(geo, material, Math.max(1, n));
  im.count = n; im.name = name; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.userData.noQA = true;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return im;
}

// ── templates (metres unless noted; +Z forward, y up, resting on y = 0) ─────────────────────────────────────────────
// trilobite, ~0.86 long before scaling: head shield with glabella, eyes and genal spines, 8 ribbed thorax segments with a
// raised axial lobe, tail shield, a dark rim of legs under the edge
function trilobiteGeo() {
  const L = [], shell = lin('#8a7658'), rib = lin('#5e4d38'), axial = lin('#9d8661'), eye = lin('#221a12');
  L.push(prep(dome(20, 5), lin('#4d4032'), M(0, 0, 0.02, 0, 0, 0, 0.318, 0.009, 0.455)));        // legs fringe
  L.push(prep(dome(20, 6), shell, M(0, 0, 0.25, 0, 0, 0, 0.33, 0.08, 0.2)));                      // cephalon
  L.push(prep(dome(12, 6), axial, M(0, 0.03, 0.29, 0, 0, 0, 0.1, 0.075, 0.14)));                   // glabella
  for (const s of [-1, 1]) {
    L.push(prep(new THREE.SphereGeometry(1, 8, 6), eye, M(s * 0.15, 0.07, 0.24, 0, 0, 0, 0.038, 0.034, 0.038)));
    const dir = V(s * 0.28, -0.05, -1).normalize(), base = V(s * 0.27, 0.015, 0.14);
    L.push(prep(new THREE.ConeGeometry(0.022, 0.26, 6), shell, Mdir(base.clone().addScaledVector(dir, 0.13), dir)));   // genal spines
  }
  const NS = 8;
  for (let k = 0; k < NS; k++) {
    const u = k / (NS - 1), z = lerp(0.1, -0.2, u), w = lerp(0.3, 0.2, u);
    L.push(prep(dome(16, 4), k % 2 ? rib : shell, M(0, 0, z, 0, 0, 0, w, 0.055, 0.032)));
    L.push(prep(dome(10, 4), axial, M(0, 0.02, z, 0, 0, 0, lerp(0.085, 0.06, u), 0.06, 0.03)));
  }
  L.push(prep(dome(16, 5), shell, M(0, 0, -0.29, 0, 0, 0, 0.19, 0.055, 0.12)));                   // pygidium
  L.push(prep(dome(8, 4), axial, M(0, 0.01, -0.26, 0, 0, 0, 0.05, 0.05, 0.08)));
  return merge(L);
}
// orthocone nautiloid: aperture at z = 0, the straight shell to the apex at z = -1, head + tentacles towards +z
function nautiloidGeo() {
  const L = [], r0 = 0.075, brown = lin('#5a3b22'), cream = lin('#d8c6a0'), skin = lin('#8c6b5d'), eye = lin('#15100c');
  const band = (x, y, z) => {
    const a = Math.atan2(x, y), u = -z;                                     // u 0 (aperture) .. 1 (apex)
    const b = 0.5 + 0.5 * Math.sin((u * 15 + 0.12 * Math.sin(a * 3)) * TAU);
    const c = mix3(cream, brown, smooth((b - 0.35) / 0.3));
    return mul3(c, 0.78 + 0.22 * (0.5 - 0.5 * y / r0) + 0.1 * (1 - u));   // lighter underneath, paler towards the living end
  };
  const cyl = new THREE.CylinderGeometry(0.01, r0, 1, 16, 40, true);          // top (+y) = apex
  cyl.applyMatrix4(M(0, 0, -0.5, -Math.PI / 2));
  L.push(prep(cyl, band));
  L.push(prep(new THREE.SphereGeometry(0.012, 6, 4), brown, M(0, 0, -1)));
  L.push(prep(new THREE.TorusGeometry(r0 * 0.98, 0.006, 5, 18), cream, M(0, 0, 0)));                 // aperture rim
  L.push(prep(new THREE.SphereGeometry(1, 14, 10), skin, M(0, 0, 0.03, 0, 0, 0, r0 * 0.86, r0 * 0.8, r0 * 1.5)));   // head
  for (const s of [-1, 1]) L.push(prep(new THREE.SphereGeometry(1, 8, 6), eye, M(s * r0 * 0.72, r0 * 0.22, 0.06, 0, 0, 0, 0.016, 0.016, 0.016)));
  const NT = 12;
  for (let i = 0; i < NT; i++) {
    const a = i / NT * TAU, len = 0.26 + 0.1 * ((i * 7) % 5) / 4;
    const dir = V(Math.cos(a) * 0.22, Math.sin(a) * 0.22 - 0.06, 1).normalize(), base = V(Math.cos(a) * r0 * 0.45, Math.sin(a) * r0 * 0.45, 0.13);
    L.push(prep(new THREE.ConeGeometry(0.009, len, 5), mul3(skin, 0.9), Mdir(base.clone().addScaledVector(dir, len / 2), dir)));
  }
  return merge(L);
}
// crinoid stalk, unit height (scaled in y per instance): columnal rings, a holdfast
function stalkGeo() {
  const pts = [];
  for (let i = 0; i <= 80; i++) { const y = i / 80; pts.push(new THREE.Vector2(0.011 * (1 + 0.22 * Math.pow(Math.abs(Math.sin(y * Math.PI * 45)), 3)) * (1 + 0.25 * (1 - y)), y)); }
  const L = [prep(new THREE.LatheGeometry(pts, 6), (x, y) => mul3([0.82, 0.8, 0.76], 0.8 + 0.2 * Math.abs(Math.sin(y * Math.PI * 45))))];
  L.push(prep(new THREE.ConeGeometry(0.045, 0.05, 7), [0.6, 0.58, 0.55], M(0, 0.02, 0)));
  return merge(L);
}
// crinoid crown (~0.25 m tall, calyx at y = 0): 5 arms branching into 10, feathery pinnules
function crownGeo() {
  const L = [], arm = [0.95, 0.93, 0.9], cup = [0.62, 0.6, 0.57];
  L.push(prep(new THREE.CylinderGeometry(0.034, 0.013, 0.05, 10), cup, M(0, 0.025, 0)));
  const tube = (a, b, c, r) => L.push(prep(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, b, c), 6, r, 4, false), arm));
  for (let i = 0; i < 5; i++) {
    const f = i / 5 * TAU, d = V(Math.cos(f), 0, Math.sin(f));
    const p0 = d.clone().multiplyScalar(0.026).setY(0.048), p1 = d.clone().multiplyScalar(0.042).setY(0.07), p2 = d.clone().multiplyScalar(0.05).setY(0.09);
    tube(p0, p1, p2, 0.009);
    for (const s of [-1, 1]) {
      const g = f + s * 0.3, e = V(Math.cos(g), 0, Math.sin(g));
      const q1 = e.clone().multiplyScalar(0.085).setY(0.17), q2 = e.clone().multiplyScalar(0.15).setY(0.23);
      const curve = new THREE.QuadraticBezierCurve3(p2, q1, q2);
      L.push(prep(new THREE.TubeGeometry(curve, 7, 0.0075, 4, false), arm));
      for (let k = 1; k <= 8; k++) {
        const u = k / 9, P = curve.getPoint(u), T = curve.getTangent(u), side = new THREE.Vector3().crossVectors(T, UP).normalize();
        for (const sd of [-1, 1]) {
          const dir = side.clone().multiplyScalar(sd).addScaledVector(T, 0.7).addScaledVector(UP, 0.25).normalize(), len = 0.05 * (1 - 0.35 * u);
          L.push(prep(new THREE.ConeGeometry(0.0055, len, 3, 1, false), arm, Mdir(P.clone().addScaledVector(dir, len / 2), dir)));
        }
      }
    }
  }
  return merge(L);
}
// rugose horn coral (~1 long before scaling): a curved, ringed horn, tip on the ground, open cup up and out
function hornGeo() {
  const pts = [];
  for (let i = 0; i <= 40; i++) { const y = i / 40; pts.push(new THREE.Vector2(Math.max(0.004, 0.2 * Math.pow(y, 0.75) * (1 + 0.05 * Math.sin(y * 70))), y)); }
  const g = new THREE.LatheGeometry(pts, 14), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { const y = P.getY(i); P.setX(i, P.getX(i) + 0.42 * (1 - y) * (1 - y)); }
  g.computeVertexNormals();
  const a = lin('#9b8158'), b = lin('#6b563e'), L = [prep(g, (x, y) => mix3(a, b, 0.5 + 0.5 * Math.sin(y * 70)))];
  L.push(prep(new THREE.CircleGeometry(0.17, 14), lin('#3b3024'), M(0, 0.93, 0, -Math.PI / 2)));      // the calice floor
  const out = merge(L);
  out.applyMatrix4(M(0, 0, 0, 0, 0, -0.3));                                                           // lean: tip buried, cup up
  return out;
}
// tabulate coral mound (unit radius): packed hexagonal corallites on a low dome, each with a dark pit
function tabulateGeo() {
  const L = [], sp = 0.13, light = lin('#a48d68'), pit = lin('#3d3226'), side = lin('#7c6a4f');
  for (let j = -9; j <= 9; j++) for (let i = -9; i <= 9; i++) {
    const x = (i + (j & 1) * 0.5) * sp, z = j * sp * 0.866, r = Math.hypot(x, z);
    if (r > 0.98) continue;
    const h = 0.025 + 0.68 * Math.pow(Math.max(0, 1 - r * r), 0.65) * (1 + 0.08 * Math.sin(x * 9 + z * 7));
    const cyl = new THREE.CylinderGeometry(0.068, 0.068, h + 0.06, 6, 1, false);
    L.push(prep(cyl, (px, py, pz) => (py > (h + 0.06) / 2 - 1e-4 ? (Math.hypot(px, pz) < 0.01 ? pit : light) : mix3(side, light, smooth((py + (h + 0.06) / 2) / (h + 0.06)))), M(x, (h + 0.06) / 2 - 0.06, z, 0, Math.PI / 6)));
  }
  return merge(L);
}
// brachiopod (unit length along z, hinge at -z): a ribbed, low, rounded valve
function brachioGeo() {
  const g = new THREE.SphereGeometry(1, 40, 6, 0, TAU, 0, Math.PI / 2), P = g.attributes.position;
  const ribA = lin('#b2a283'), ribB = lin('#7e6d55');
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ps = Math.atan2(x, z + 1.1), rib = 0.5 + 0.5 * Math.cos(ps * 26);
    const k = 1 + 0.045 * rib * (1 - y);
    P.setXYZ(i, x * 0.55 * k, y * 0.26 * (1 + 0.08 * rib), z * 0.5 * k * (z < 0 ? 0.85 : 1));
  }
  g.computeVertexNormals();
  return merge([prep(g, (x, y, z) => mix3(ribB, ribA, 0.5 + 0.5 * Math.cos(Math.atan2(x, z + 0.55) * 26)))]);
}
// mussel (unit length along z, umbo at -z): a teardrop, dark blue-black, a brown sheen near the edge; valve = open half
function musselGeo(kindOf) {
  const g = kindOf === 'bowl' ? new THREE.SphereGeometry(1, 16, 6, 0, TAU, Math.PI / 2, Math.PI / 2) : kindOf === 'dome' ? dome(16, 6) : new THREE.SphereGeometry(1, 16, 8), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), t = (z + 1) / 2;
    P.setXYZ(i, x * 0.24 * lerp(0.35, 1, Math.pow(t, 0.6)), y * (kindOf === 'whole' ? 0.17 : 0.12), z * 0.5);
  }
  g.computeVertexNormals();
  const blue = lin('#1a1f2b'), brown = lin('#3b2f24'), pearl = lin('#b3b2ad');
  if (kindOf === 'bowl') return merge([prep(g, (x, y, z) => mix3(pearl, mul3(pearl, 0.7), clamp(Math.abs(x) * 3)))]);
  return merge([prep(g, (x, y, z) => mix3(blue, brown, clamp((z + 0.1) * 1.2) * 0.45))]);
}
// limpet (unit base diameter): a low ribbed cone, apex a little forward
function limpetGeo() {
  const g = new THREE.ConeGeometry(0.5, 0.36, 28, 3, true), P = g.attributes.position, a = lin('#c9c4b7'), b = lin('#85817a');
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), u = (0.18 - y) / 0.36, ps = Math.atan2(x, z), k = 1 + 0.07 * Math.cos(ps * 14) * u;
    P.setXYZ(i, x * k, y + 0.18, z * k + 0.08 * (1 - u));
  }
  g.computeVertexNormals();
  return merge([prep(g, (x, y, z) => mul3(mix3(b, a, 0.5 + 0.5 * Math.cos(Math.atan2(x, z) * 14)), 0.85 + 0.25 * (y / 0.36)))]);
}
// whelk (unit length): a spiral cone, pale with brown bands
function whelkGeo() {
  const g = new THREE.ConeGeometry(0.28, 1, 16, 24, false), P = g.attributes.position, a = lin('#d9d2c3'), b = lin('#8a6e52');
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), u = y + 0.5, ps = Math.atan2(x, z), w = 1 + 0.12 * Math.sin(u * 5 * TAU + ps);
    P.setXYZ(i, x * w, y, z * w);
  }
  g.computeVertexNormals();
  const out = merge([prep(g, (x, y, z) => mix3(a, b, smooth((Math.sin((y + 0.5) * 5 * TAU + Math.atan2(x, z)) - 0.4) * 2) * 0.7))]);
  out.applyMatrix4(M(0, 0.2, 0, Math.PI / 2));                                                          // lying on its side
  return out;
}

// ── placement over the area ─────────────────────────────────────────────────────────────────────────────────────
function makeField(item, ctx, R) {
  const at = item.at || [0, 0], size = Array.isArray(item.size) ? item.size : Array.isArray(item.params?.size) ? item.params.size : [24, 14];
  const w = Math.max(1, +size[0] || 24), d = Math.max(1, +size[1] || +size[0] || 14);
  const G = (x, z) => (ctx.ground ? ctx.ground.height(x, z) : 0);
  const Wt = [ctx.ground?.water, ctx.water].find((q) => q && Number.isFinite(q.level)) || null;
  const level = Wt ? Wt.level : null;
  const surf = (x, z, t) => (Wt && typeof Wt.heightAt === 'function' ? Wt.heightAt(x, z, t) : level);
  // rocks built before this item: raycast targets for "on the rocks"
  const rocks = [];
  for (const o of ctx.scene?.children || []) if (/^rock\./.test(o.name || '')) { o.updateMatrixWorld(true); o.traverse((m) => { if (m.isMesh) rocks.push(m); }); }
  const ray = new THREE.Raycaster(); ray.far = 30;
  const onRock = (x, z) => {
    if (!rocks.length) return null;
    ray.set(V(x, G(x, z) + 12, z), V(0, -1, 0));
    const h = ray.intersectObjects(rocks, false)[0];
    if (!h) return null;
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : UP.clone();
    return { y: h.point.y, n: n.y > 0.2 ? n : UP.clone() };
  };
  const cells = [], step = 0.5;
  for (let z = at[1] - d / 2 + step / 2; z < at[1] + d / 2; z += step) for (let x = at[0] - w / 2 + step / 2; x < at[0] + w / 2; x += step) {
    const g = G(x, z); cells.push({ x, z, g, dep: level == null ? 0 : level - g });
  }
  // a random point whose water depth is in [lo, hi] (the nearest depths if the area has none)
  const pick = (lo, hi) => {
    let list = cells.filter((c) => c.dep >= lo && c.dep <= hi);
    if (list.length < 3) list = cells.slice().sort((a, b) => Math.min(Math.abs(a.dep - lo), Math.abs(a.dep - hi)) - Math.min(Math.abs(b.dep - lo), Math.abs(b.dep - hi))).slice(0, Math.max(3, cells.length >> 3));
    const c = list[Math.floor(R() * list.length) % list.length];
    return [c.x + (R() - 0.5) * step, c.z + (R() - 0.5) * step];
  };
  const normal = (x, z) => { const e = 0.25; return V(G(x - e, z) - G(x + e, z), 2 * e, G(x, z - e) - G(x, z + e)).normalize(); };
  return { at, w, d, G, level, surf, pick, normal, onRock, rocks };
}

// quaternion: yaw (rotation.y of a +Z model) on a surface normal
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
function surfQ(n, yaw, out) { _q1.setFromUnitVectors(UP, n); _q2.setFromAxisAngle(UP, yaw); return out.copy(_q1).multiply(_q2); }

// ── sealife.ordovician ──────────────────────────────────────────────────────────────────────────────────────────
function buildOrdovician(item, ctx) {
  const P = item.params || {};
  const num = (k, def, max) => Math.max(0, Math.min(max, Math.round(+(item[k] ?? P[k] ?? def)) || 0));
  const nTri = num('trilobites', 14, 200), nNaut = num('nautiloids', 3, 20), nCri = num('crinoids', 24, 300), nCor = num('corals', 10, 120), nBra = num('brachiopods', 18, 200);
  const seed = +(item.seed ?? P.seed ?? 1) || 1, R = rng(seed * 7919 + 101);
  const F = makeField(item, ctx, R), root = new THREE.Group(); root.name = 'sealife.ordovician';
  root.position.set(F.at[0], 0, F.at[1]);
  const ox = F.at[0], oz = F.at[1];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V(), s = V(), col = new THREE.Color();
  const put = (im, i, x, y, z, quat, sc) => { m4.compose(p.set(x - ox, y, z - oz), quat, typeof sc === 'number' ? s.set(sc, sc, sc) : sc); im.setMatrixAt(i, m4); };
  const tint = (im, i, c) => { col.setRGB(c[0], c[1], c[2]); im.setColorAt(i, col); };
  const upd = [];
  const pts = [];

  // brachiopods: clusters of 5-12 ribbed shells, 3-6 cm, in the swash and the shallows
  {
    const list = [];
    for (let c = 0; c < nBra; c++) {
      const [cx, cz] = F.pick(-0.12, 0.02), n = 6 + Math.floor(R() * 9);
      for (let k = 0; k < n; k++) { const a = R() * TAU, r = Math.sqrt(R()) * 0.28; list.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0.04 + R() * 0.025, R() * TAU, R()]); }
      pts.push([cx, cz]);
    }
    const im = inst(brachioGeo(), mat(ctx, { rough: 0.6 }), list.length, 'sealife.brachiopods');
    list.forEach(([x, z, L, yaw, v], i) => {
      const n = F.normal(x, z), tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((v - 0.5) * 0.5, 0, (R() - 0.5) * 0.4));
      surfQ(n, yaw, q).multiply(tilt);
      put(im, i, x, F.G(x, z) - 0.004, z, q, L);
      tint(im, i, mix3([1.0, 0.96, 0.9], [0.8, 0.82, 0.86], v));
    });
    root.add(im);
  }
  // corals: tabulate honeycomb mounds (0.2-0.5 m) and groups of rugose horns (0.1-0.3 m), on rocks when there are any
  {
    const mounds = [], horns = [];
    for (let c = 0; c < nCor; c++) {
      const [x, z] = F.pick(-0.05, 0.08);
      if (R() < 0.62) mounds.push([x, z, 0.1 + R() * 0.15, R() * TAU, R()]);
      else { const n = 2 + Math.floor(R() * 3); for (let k = 0; k < n; k++) horns.push([x + (R() - 0.5) * 0.35, z + (R() - 0.5) * 0.35, 0.1 + R() * 0.22, R() * TAU, R()]); }
      pts.push([x, z]);
    }
    const tm = inst(tabulateGeo(), mat(ctx, { rough: 0.85 }), mounds.length, 'sealife.tabulate');
    mounds.forEach(([x, z, r, yaw, v], i) => {
      const rk = F.onRock(x, z), y = rk ? rk.y - 0.03 * r : F.G(x, z) - 0.04 * r, n = rk ? rk.n : F.normal(x, z);
      surfQ(n, yaw, q); put(tm, i, x, y, z, q, s.set(r, r * (0.8 + 0.4 * v), r));
      tint(tm, i, mix3([1, 0.95, 0.86], [0.82, 0.82, 0.8], v));
    });
    root.add(tm);
    const hm = inst(hornGeo(), mat(ctx, { rough: 0.8, double: true }), horns.length, 'sealife.horncorals');
    horns.forEach(([x, z, L, yaw, v], i) => {
      const rk = F.onRock(x, z), y = rk ? rk.y - 0.01 : F.G(x, z) - 0.015;
      q.setFromAxisAngle(UP, yaw); put(hm, i, x, y, z, q, L);
      tint(hm, i, mix3([1, 0.94, 0.84], [0.78, 0.76, 0.74], v));
    });
    root.add(hm);
  }
  // crinoid gardens: clusters of 3-7 stalks (0.3-1.0 m) with feathery crowns, swaying (each its own sines)
  {
    const cri = [], cols = ['#e6d6b4', '#d99a92', '#9a78a8', '#c99d5c', '#e8c7c0', '#b58ab5'].map((h) => lin(h, 1.15));
    let left = nCri;
    while (left > 0) {
      const n = Math.min(left, 3 + Math.floor(R() * 5)); left -= n;
      const [cx, cz] = F.pick(0.0, 0.16), ci = Math.floor(R() * cols.length);
      for (let k = 0; k < n; k++) {
        const a = R() * TAU, r = Math.sqrt(R()) * 0.7, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, rk = F.onRock(x, z);
        cri.push({ x, z, y: (rk ? rk.y : F.G(x, z)) - 0.02, H: 0.35 + 0.65 * Math.pow(R(), 0.7), cs: 1.0 + R() * 0.5, yaw: R() * TAU,
          c: R() < 0.7 ? cols[ci] : cols[Math.floor(R() * cols.length)], w1: TAU / (2.6 + R() * 1.6), w2: TAU / (1.3 + R() * 0.8), ph: R() * TAU, ph2: R() * TAU, A: 0.05 + R() * 0.06, dir: R() * TAU });
      }
      pts.push([cx, cz]);
    }
    const sm = inst(stalkGeo(), mat(ctx, { rough: 0.65 }), cri.length, 'sealife.crinoid_stalks');
    const cm = inst(crownGeo(), mat(ctx, { rough: 0.6, double: true }), cri.length, 'sealife.crinoid_crowns');
    cri.forEach((c, i) => { tint(sm, i, mul3(c.c, 0.8)); tint(cm, i, c.c); });
    const e = new THREE.Euler(), qs = new THREE.Quaternion(), qc = new THREE.Quaternion(), top = V();
    const pose = (t) => {
      cri.forEach((c, i) => {
        const a = c.A * Math.sin(c.w1 * t + c.ph) + 0.35 * c.A * Math.sin(c.w2 * t + c.ph2), b = 0.45 * c.A * Math.sin(c.w1 * 0.77 * t + c.ph2);
        e.set(a * Math.cos(c.dir) + b * Math.sin(c.dir), 0, a * Math.sin(c.dir) - b * Math.cos(c.dir), 'XYZ');
        qs.setFromEuler(e);
        put(sm, i, c.x, c.y, c.z, qs, s.set(1, c.H, 1));
        top.set(0, c.H, 0).applyQuaternion(qs);
        e.set(e.x * 1.6, c.yaw, e.z * 1.6, 'XYZ'); qc.setFromEuler(e);
        put(cm, i, c.x + top.x, c.y + top.y - 0.005, c.z + top.z, qc, c.cs);
      });
      sm.instanceMatrix.needsUpdate = true; cm.instanceMatrix.needsUpdate = true;
    };
    pose(0); upd.push(pose);
    root.add(sm, cm);
  }
  // trilobites: 60 % crawl head first along gentle arcs at 1.5-4 cm/s, the rest rest; 6-12 cm, a third 15-25 cm
  {
    const tri = [];
    for (let k = 0; k < nTri; k++) {
      const [x, z] = F.pick(-0.12, 0.01), big = R() < 0.45, L = big ? 0.15 + R() * 0.1 : 0.07 + R() * 0.05;
      tri.push({ x, z, L, yaw: R() * TAU, v: R() < 0.6 ? 0.015 + R() * 0.025 : 0, rc: (0.6 + R() * 2.2) * (R() < 0.5 ? -1 : 1), ph: R() * TAU, c: mix3([1.02, 0.98, 0.92], [0.8, 0.82, 0.86], R()) });
      pts.push([x, z]);
    }
    const im = inst(trilobiteGeo(), mat(ctx, { rough: 0.38, env: 1.0 }), tri.length, 'sealife.trilobites');
    tri.forEach((c, i) => tint(im, i, c.c));
    const pose = (t) => {
      tri.forEach((c, i) => {
        // arc of radius rc: heading turns at v / rc, position integrates exactly; a slow start/stop pulse on the speed
        const sArc = c.v * (t + 0.35 * Math.sin(t * 0.9 + c.ph) / 0.9), th = c.yaw + sArc / c.rc;
        const x = c.x + c.rc * (Math.cos(c.yaw) - Math.cos(th)), z = c.z + c.rc * (Math.sin(th) - Math.sin(c.yaw));
        surfQ(F.normal(x, z), th, q);                                                  // travel = (sin th, cos th): head first
        put(im, i, x, F.G(x, z) + 0.002, z, q, c.L / 0.86);
      });
      im.instanceMatrix.needsUpdate = true;
    };
    pose(0); upd.push(pose);
    root.add(im);
  }
  // nautiloids: straight banded shells gliding apex first just under the surface (tentacles trailing), jet pulses
  if (nNaut > 0) {
    const nau = [];
    for (let k = 0; k < nNaut; k++) {
      const [x, z] = F.pick(0.2, 0.7), L = 0.8 + R() * 0.7;
      nau.push({ x, z, L, r0: 0.075 * L, v: 0.12 + R() * 0.1, rc: (5 + R() * 6) * (R() < 0.5 ? -1 : 1), hd: R() * TAU, ph: R() * TAU, deep: 0 });
      pts.push([x, z]);
    }
    const im = inst(nautiloidGeo(), mat(ctx, { rough: 0.35, env: 1.0 }), nau.length, 'sealife.nautiloids');
    const qq = new THREE.Quaternion(), qp = new THREE.Quaternion();
    const pose = (t) => {
      nau.forEach((c, i) => {
        const sArc = c.v * t + 0.05 * Math.sin(TAU * t / 1.8 + c.ph), th = c.hd + sArc / c.rc;
        // travel along the arc: direction (sin th, cos th); the model's +Z (head) points against it
        const x = c.x + c.rc * (Math.cos(c.hd) - Math.cos(th)), z = c.z + c.rc * (Math.sin(th) - Math.sin(c.hd));
        const vx = Math.sin(th), vz = Math.cos(th), yaw = Math.atan2(-vx, -vz);
        let y = F.level == null ? F.G(x, z) + 0.5 : F.surf(x, z, t) - c.r0 * 0.4 - c.deep;       // the back just awash
        let gmax = -1e9; for (let k = 0; k <= 4; k++) { const u = k / 4 * c.L; gmax = Math.max(gmax, F.G(x + vx * u, z + vz * u)); }
        y = Math.max(y, gmax + c.r0 + 0.05) + 0.008 * Math.sin(t * 1.3 + c.ph);
        qq.setFromAxisAngle(UP, yaw); qp.setFromAxisAngle(V(1, 0, 0), 0.03 * Math.sin(TAU * t / 1.8 + c.ph + 1)); qq.multiply(qp);
        put(im, i, x, y, z, qq, c.L);
      });
      im.instanceMatrix.needsUpdate = true;
    };
    pose(0); upd.push(pose);
    root.add(im);
  }
  for (const o of root.children) if (o.instanceColor) o.instanceColor.needsUpdate = true;
  let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; }
  const body = new THREE.Object3D(); body.name = 'sealife.body';
  if (pts.length) { cx /= pts.length; cz /= pts.length; body.position.set(cx - ox, F.G(cx, cz) + 0.2, cz - oz); }
  root.add(body);
  return {
    root, radius: Math.min(40, Math.hypot(F.w, F.d) / 2), height: 1, snapped: true, contact: false,
    update: (t) => { for (const f of upd) f(t || 0); },
    anchors: { body },
  };
}

// ── sealife.shellfish ───────────────────────────────────────────────────────────────────────────────────────────
function buildShellfish(item, ctx) {
  const P = item.params || {};
  const seed = +(item.seed ?? P.seed ?? 1) || 1, R = rng(seed * 6007 + 29);
  const nCl = Math.max(0, Math.min(80, Math.round(+(item.clusters ?? P.clusters ?? 12)) || 0));
  const F = makeField(item, ctx, R), root = new THREE.Group(); root.name = 'sealife.shellfish';
  root.position.set(F.at[0], 0, F.at[1]);
  const ox = F.at[0], oz = F.at[1];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V(), s = V(), col = new THREE.Color(), e = new THREE.Euler();
  const put = (im, i, x, y, z, quat, sc) => { m4.compose(p.set(x - ox, y, z - oz), quat, typeof sc === 'number' ? s.set(sc, sc, sc) : sc); im.setMatrixAt(i, m4); };
  const tint = (im, i, c) => { col.setRGB(c[0], c[1], c[2]); im.setColorAt(i, col); };
  const mus = [], lim = [], pts = [];
  // beds: half the clusters on rocks (when the area has any), the rest on the wet sand at the tide line
  const rockPts = [];
  if (F.rocks.length) {
    for (let k = 0; k < 400 && rockPts.length < 60; k++) {
      const x = F.at[0] + (R() - 0.5) * F.w, z = F.at[1] + (R() - 0.5) * F.d, h = F.onRock(x, z);
      if (h && h.y > F.G(x, z) + 0.04) rockPts.push([x, z]);
    }
  }
  for (let c = 0; c < nCl; c++) {
    const onR = rockPts.length && c % 2 === 0, [cx, cz] = onR ? rockPts[Math.floor(R() * rockPts.length)] : F.pick(-0.14, 0.02);
    pts.push([cx, cz]);
    const nm = 45 + Math.floor(R() * 35), rad = 0.12 + R() * 0.1;
    for (let k = 0; k < nm; k++) { const a = R() * TAU, r = Math.sqrt(R()) * rad; mus.push([cx + Math.cos(a) * r * 1.4, cz + Math.sin(a) * r, 0.06 + R() * 0.05, R()]); }
    const nl = 2 + Math.floor(R() * 6);
    for (let k = 0; k < nl; k++) { const a = R() * TAU, r = rad * (0.6 + R() * 0.9); lim.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0.03 + R() * 0.03, R()]); }
  }
  const surface = (x, z) => { const h = F.onRock(x, z), g = F.G(x, z); return h && h.y > g ? h : { y: g, n: F.normal(x, z) }; };
  // midden at pile
  const pile = Array.isArray(item.pile ?? P.pile) ? (item.pile ?? P.pile).map(Number) : null;
  const halves = [], domes = [], whelks = [], coal = [];
  let heap = null;
  if (pile) {
    const [px, pz] = pile, g0 = F.G(px, pz), Rh = 0.42, Hh = 0.17;
    const hh = (x, z) => { const r = Math.hypot(x - px, z - pz) / Rh; return r >= 1 ? 0 : Hh * Math.pow(1 - r * r, 1.4) * (1 + 0.14 * Math.sin(x * 23 + z * 17) + 0.1 * Math.sin(x * 61 - z * 47) * Math.cos(z * 53 + x * 11)); };
    const top = (x, z) => F.G(x, z) + hh(x, z);
    // the heap itself: a low mound of shell grit and ash
    const geo = new THREE.RingGeometry(0.002, Rh * 1.08, 40, 14); geo.rotateX(-Math.PI / 2);
    const Pp = geo.attributes.position, cA = lin('#bcae95'), cB = lin('#6f6455');
    const C = new Float32Array(Pp.count * 3);
    for (let i = 0; i < Pp.count; i++) {
      const x = Pp.getX(i) + px, z = Pp.getZ(i) + pz; Pp.setXYZ(i, x - ox, top(x, z) + 0.004, z - oz);
      const c = mix3(cB, cA, clamp(0.55 + 0.3 * Math.sin(x * 23 + Math.cos(z * 19) * 2) * Math.cos(z * 17 - x * 7)));
      C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3)); geo.computeVertexNormals();
    const hmat = mat(ctx, { rough: 0.95 }); hmat.polygonOffset = true; hmat.polygonOffsetFactor = -2; hmat.polygonOffsetUnits = -2;
    heap = new THREE.Mesh(geo, hmat); heap.name = 'sealife.midden'; heap.receiveShadow = true; heap.userData.noQA = true;
    for (let k = 0; k < 420; k++) {
      const a = R() * TAU, r = Math.pow(R(), 0.6) * Rh * 1.08, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r, y = top(x, z), v = R();
      if (v < 0.5) halves.push([x, y, z, 0.055 + R() * 0.04]);
      else if (v < 0.64) domes.push([x, y, z, 0.05 + R() * 0.035]);
      else if (v < 0.86) lim.push([x, z, 0.035 + R() * 0.03, R(), y]);
      else if (v < 0.95) whelks.push([x, y, z, 0.045 + R() * 0.03]);
      else coal.push([x, y, z, 0.015 + R() * 0.025]);
    }
    for (let k = 0; k < 10; k++) { const a = R() * TAU, r = R() * 0.18, x = px + 0.12 + Math.cos(a) * r, z = pz - 0.1 + Math.sin(a) * r; coal.push([x, top(x, z), z, 0.02 + R() * 0.03]); }
    pts.push([px, pz]);
    void g0;
  }
  // mussel beds: shells half on end, packed, pointing up and out of the bed (byssus down)
  const mm = inst(musselGeo('whole'), mat(ctx, { rough: 0.3, env: 1.0 }), mus.length, 'sealife.mussels');
  mus.forEach(([x, z, L, v], i) => {
    const S = surface(x, z);
    e.set(-(0.5 + v * 0.7), R() * TAU, (R() - 0.5) * 0.5, 'YXZ'); const qa = new THREE.Quaternion().setFromEuler(e);
    q.setFromUnitVectors(UP, S.n).multiply(qa);
    put(mm, i, x, S.y - 0.01, z, q, L);
    tint(mm, i, mix3([1, 1, 1], [1.25, 1.1, 0.95], v * 0.6));
  });
  root.add(mm);
  const lm = inst(limpetGeo(), mat(ctx, { rough: 0.55 }), lim.length, 'sealife.limpets');
  lim.forEach(([x, z, D, v, yy], i) => {
    const S = yy != null ? { y: yy, n: F.normal(x, z) } : surface(x, z);
    surfQ(S.n, v * TAU, q); put(lm, i, x, S.y - 0.003, z, q, s.set(D, D * (0.8 + 0.4 * v), D));
    tint(lm, i, mix3([1.05, 1.03, 1.0], [0.8, 0.8, 0.82], v));
  });
  root.add(lm);
  if (pile) {
    const hm = inst(musselGeo('bowl'), mat(ctx, { rough: 0.3, double: true, env: 1.0 }), halves.length, 'sealife.midden_valves_open');
    halves.forEach(([x, y, z, L], i) => { e.set((R() - 0.5) * 0.5, R() * TAU, (R() - 0.5) * 0.5, 'YXZ'); q.setFromEuler(e); put(hm, i, x, y + 0.01, z, q, L); });
    const dm = inst(musselGeo('dome'), mat(ctx, { rough: 0.3, env: 1.0 }), domes.length, 'sealife.midden_valves');
    domes.forEach(([x, y, z, L], i) => { e.set((R() - 0.5) * 0.6, R() * TAU, (R() - 0.5) * 0.6, 'YXZ'); q.setFromEuler(e); put(dm, i, x, y - 0.004, z, q, L); });
    const wm = inst(whelkGeo(), mat(ctx, { rough: 0.5 }), whelks.length, 'sealife.midden_whelks');
    whelks.forEach(([x, y, z, L], i) => { e.set(0, R() * TAU, (R() - 0.5) * 0.4, 'YXZ'); q.setFromEuler(e); put(wm, i, x, y, z, q, L); });
    const km = inst(new THREE.IcosahedronGeometry(1, 0), (ctx.patch || patchMaterial)(new THREE.MeshStandardMaterial({ color: 0x151311, roughness: 0.9 })), coal.length, 'sealife.midden_charcoal');
    coal.forEach(([x, y, z, r], i) => { e.set(R() * 3, R() * 3, R() * 3); q.setFromEuler(e); put(km, i, x, y, z, q, s.set(r, r * 0.6, r * 0.8)); });
    root.add(heap, hm, dm, wm, km);
  }
  for (const o of root.children) if (o.instanceColor) o.instanceColor.needsUpdate = true;
  let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; }
  const body = new THREE.Object3D(); body.name = 'sealife.body';
  if (pts.length) { cx /= pts.length; cz /= pts.length; body.position.set(cx - ox, F.G(cx, cz) + 0.1, cz - oz); }
  root.add(body);
  return { root, radius: Math.min(40, Math.hypot(F.w, F.d) / 2), height: 0.15, snapped: true, contact: false, update() {}, anchors: { body } };
}

export async function build(kind, item, ctx) {
  if (kind === 'sealife.shellfish') return buildShellfish(item, ctx);
  return buildOrdovician(item, ctx);
}
