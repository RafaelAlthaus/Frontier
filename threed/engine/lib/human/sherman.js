// sherman.js — the M4A3E2 "Jumbo" assault Sherman as "Cobra King" (C Company, 37th Tank Battalion, 4th Armored
// Division; the first tank into Bastogne, 26 December 1944). Metres, Y up, the gun points +Z, origin on the ground under
// the middle of the hull; the tank's right side is -X, its left side +X.
//
//   const tank = buildSherman({ name, codes, stars, seed });   scene.add(tank.group);
//   tank.update(t, { distance, turret, gun, snow });           // a pure function of its arguments
//     distance  metres travelled: road wheels, sprockets, idlers, return rollers and every track link move with it
//     turret    yaw in radians, + = counter-clockwise seen from above (towards the tank's left)
//     gun       elevation in radians (+ = up), clamped to the mount's -10..+25 degrees
//     snow      0..1: snow dusting the upward-facing surfaces (flat tops first, slopes as it grows)
//     t         seconds, only for the antenna's sway
//
// In it: the welded 47-degree M4A3 hull with the Jumbo's 1.5 in glacis and side appliques, the one-piece cast
// transmission cover with its bolted flange, sponsons over the tracks, engine deck with doors and the rear grille, the
// rear plate with exhausts, towing shackles, periscope guards, headlights in brush guards, stowage (tarp, jerrycans,
// crate, pioneer tools), the heavy cast T23-type turret with the 7 in gun shield and the 75 mm M3, a vision cupola with
// its hatch open, the roof .50, the radio mast, VVSS running gear (3 bogies a side with dual road wheels and trailing
// return rollers, front sprockets, rear idlers) and T48 rubber-chevron tracks with the Jumbo's outboard extended end
// connectors (one InstancedMesh per side and material). Stars, the name and the bumper codes are canvas decals.
// Materials are the engine's plain() (its fog patch) with one more onBeforeCompile chained after it: mottled olive
// drab, mud splashed up from the tracks, dust on chamfered edges, a cast-steel bump on cast parts and snow on upward
// faces — all keyed to each vertex's rest position in the tank frame (attribute aW), so they ride with the tank.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { boxM, drum, mergeGeometries } from './geom.js';
import { plain } from '../shared/materials.js';
import { rng, clamp } from '../shared/util.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// ── dimensions ───────────────────────────────────────────────────────────────────────────────────────────────────
// hull 5.89 m long, 2.62 m wide over the side plates (+ the Jumbo's appliques), 2.95 m to the cupola; track centres
// 83 in apart, 16.56 in T48 shoes on a 6 in pitch; 20 in road wheels; 13-tooth sprockets.
const D = {
  roofY: 1.88, floorY: 1.13, bellyY: 0.43,
  hw: 1.27,                  // upper hull half-width over the side plates; the appliques add 0.04
  lw: 0.80,                  // lower hull half-width between the tracks
  gl: { z0: 2.56, y0: 1.13, z1: 1.76, y1: 1.88 },   // glacis, bottom edge -> top edge (47 deg from vertical)
  rearTop: -2.62, rearMid: -2.80, rearLow: -2.62,  // upper rear plate leans in at the top, lower rear at the bottom
  noseZ: 2.955,
  trackX: 1.054, pitch: 0.1524,
  lk: { inner: 0.026, outer: 0.046, horn: 0.096, half: 0.17, conn: 0.21, duck: 0.30 },
  wheelR: 0.254, bogies: [1.47, 0, -1.47], wheelHalf: 0.285,
  spr: { z: 2.33, y: 0.72, teeth: 13 },
  idl: { z: -2.40, y: 0.50, r: 0.272 },
  rol: { r: 0.115, dz: -0.10, top: 1.05 },
  tur: { z: 0.25, y: 1.93 },
  trn: { y: 0.38, z: 0.70 },  // gun trunnion in the turret frame
};
D.wheelY = D.lk.outer + D.lk.inner + D.wheelR;           // road wheel centre height (0.326)
D.rolY = D.rol.top - D.rol.r - D.lk.inner;               // return roller centre height

// ── geometry helpers (UVs in metres where it is cheap, like geom.js) ─────────────────────────────────────────────
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const KEEP = ['position', 'normal', 'uv', 'aE'];
// every part: non-indexed with position / normal / uv / aE (aE = edge mask for the dust), no groups
function prep(g, e = 0) {
  if (g.index) g = g.toNonIndexed();
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.aE) g.setAttribute('aE', new THREE.Float32BufferAttribute(new Float32Array(n).fill(e), 1));
  for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}
const merge = (list) => mergeGeometries(list.filter(Boolean).map((g) => prep(g)));
const setE = (g, e) => { g = prep(g); g.attributes.aE.array.fill(e); return g; };

const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler(), _q = new THREE.Quaternion();
// rotate (Euler XYZ) then translate
function tf(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) g.applyMatrix4(_m4.makeRotationFromEuler(_eu.set(rx, ry, rz)));
  if (x || y || z) g.translate(x, y, z);
  return g;
}
// cylinder along 'x' | 'y' | 'z' from a to b with radius r0 at a, r1 at b (drum from geom.js, UVs in metres)
function cyl(axis, r0, r1, a, b, seg = 16, open = false) {
  const g = drum(r0, r1, a, b, seg, { open });
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}
// cylinder between two points
function rod(a, b, r, seg = 8, r1 = r) {
  const A = V(...a), B = V(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r, len, seg, 1);
  g.applyQuaternion(_q.setFromUnitVectors(V(0, 1, 0), d.normalize()));
  const c = A.add(B).multiplyScalar(0.5);
  return g.translate(c.x, c.y, c.z);
}
// a tube through points (guards, handles, straps)
function tube(pts, r, seg = 24, rs = 6, closed = false) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => V(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(c, seg, r, rs, closed);
}

// convex planar polygons -> flat triangles. Each polygon faces away from c (a point inside the solid); with c = null
// the given winding counts (counter-clockwise seen from outside).
function polyGeo(polys, c = [0, 0, 0]) {
  const pos = [], nor = [], uv = [], ae = [];
  const n = V(), cen = V(), C = c ? V(...c) : null;
  for (const { p, e = 0 } of polys) {
    const pts = p.map((q) => V(...q));
    n.set(0, 0, 0);
    for (let i = 0; i < pts.length; i++) {
      const u = pts[i], w = pts[(i + 1) % pts.length];
      n.x += (u.y - w.y) * (u.z + w.z); n.y += (u.z - w.z) * (u.x + w.x); n.z += (u.x - w.x) * (u.y + w.y);
    }
    if (n.lengthSq() < 1e-16) continue;
    n.normalize();
    if (C) {
      cen.set(0, 0, 0); pts.forEach((q) => cen.add(q)); cen.divideScalar(pts.length);
      if (n.dot(cen.sub(C)) < 0) { pts.reverse(); n.negate(); }
    }
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const UV = (q) => (ax >= ay && ax >= az ? [q.z, q.y] : ay >= az ? [q.x, q.z] : [q.x, q.y]);
    for (let i = 1; i < pts.length - 1; i++) for (const q of [pts[0], pts[i], pts[i + 1]]) {
      pos.push(q.x, q.y, q.z); nor.push(n.x, n.y, n.z); uv.push(...UV(q)); ae.push(e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aE', new THREE.Float32BufferAttribute(ae, 1));
  return g;
}

// box w x h x d centred at the origin with chamfered edges (bevel b); the chamfers carry aE = 1
function cbox(w, h, d, b = 0.012) {
  const X = w / 2, Y = h / 2, Z = d / 2;
  b = Math.max(1e-4, Math.min(b, X * 0.45, Y * 0.45, Z * 0.45));
  const P = (sx, sy, sz, ix, iy, iz) => [sx * (X - ix * b), sy * (Y - iy * b), sz * (Z - iz * b)];
  const polys = [];
  for (const s of [-1, 1]) {
    polys.push({ p: [P(s, -1, -1, 0, 1, 1), P(s, 1, -1, 0, 1, 1), P(s, 1, 1, 0, 1, 1), P(s, -1, 1, 0, 1, 1)] });
    polys.push({ p: [P(-1, s, -1, 1, 0, 1), P(1, s, -1, 1, 0, 1), P(1, s, 1, 1, 0, 1), P(-1, s, 1, 1, 0, 1)] });
    polys.push({ p: [P(-1, -1, s, 1, 1, 0), P(1, -1, s, 1, 1, 0), P(1, 1, s, 1, 1, 0), P(-1, 1, s, 1, 1, 0)] });
  }
  for (const a of [-1, 1]) for (const c of [-1, 1]) {
    polys.push({ p: [P(-1, a, c, 1, 0, 1), P(1, a, c, 1, 0, 1), P(1, a, c, 1, 1, 0), P(-1, a, c, 1, 1, 0)], e: 1 });
    polys.push({ p: [P(a, -1, c, 0, 1, 1), P(a, 1, c, 0, 1, 1), P(a, 1, c, 1, 1, 0), P(a, -1, c, 1, 1, 0)], e: 1 });
    polys.push({ p: [P(a, c, -1, 0, 1, 1), P(a, c, 1, 0, 1, 1), P(a, c, 1, 1, 0, 1), P(a, c, -1, 1, 0, 1)], e: 1 });
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
    polys.push({ p: [P(sx, sy, sz, 0, 1, 1), P(sx, sy, sz, 1, 0, 1), P(sx, sy, sz, 1, 1, 0)], e: 1 });
  return polyGeo(polys, [0, 0, 0]);
}
const cboxAt = (w, h, d, b, x, y, z, rx = 0, ry = 0, rz = 0) => tf(cbox(w, h, d, b), x, y, z, rx, ry, rz);

// a convex (z, y) profile extruded along x from x0 to x1; every edge chamfered by b (chamfers carry aE = 1)
function extrudeX(prof, x0, x1, b = 0.012) {
  const n0 = prof.length;
  // chamfer the profile corners
  const pts = [], edgeE = [];
  for (let i = 0; i < n0; i++) {
    const P0 = prof[(i - 1 + n0) % n0], P1 = prof[i], P2 = prof[(i + 1) % n0];
    const l0 = Math.hypot(P0[0] - P1[0], P0[1] - P1[1]), l2 = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]);
    const bb = Math.min(b, l0 * 0.4, l2 * 0.4);
    pts.push([P1[0] + (P0[0] - P1[0]) / l0 * bb, P1[1] + (P0[1] - P1[1]) / l0 * bb]); edgeE.push(1);
    pts.push([P1[0] + (P2[0] - P1[0]) / l2 * bb, P1[1] + (P2[1] - P1[1]) / l2 * bb]); edgeE.push(0);
  }
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [z0, y0] = pts[i], [z1, y1] = pts[(i + 1) % n]; area += z0 * y1 - z1 * y0; }
  const sg = area > 0 ? 1 : -1;
  // inset polygon for the end caps (edges moved inward by b)
  const ins = pts.map((_, i) => {
    const A = pts[(i - 1 + n) % n], B = pts[i], C = pts[(i + 1) % n];
    const e1 = [B[0] - A[0], B[1] - A[1]], e2 = [C[0] - B[0], C[1] - B[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1 = [-e1[1] / l1 * sg, e1[0] / l1 * sg], n2 = [-e2[1] / l2 * sg, e2[0] / l2 * sg];
    const m = [n1[0] + n2[0], n1[1] + n2[1]], lm = Math.hypot(...m) || 1;
    const cosH = (m[0] * n1[0] + m[1] * n1[1]) / lm;
    const k = b / Math.max(0.3, cosH) / lm;
    return [B[0] + m[0] * k, B[1] + m[1] * k];
  });
  const xa = x0 + b, xb = x1 - b;
  const polys = [];
  const at = (x, q) => [x, q[1], q[0]];
  polys.push({ p: ins.map((q) => at(x0, q)) });
  polys.push({ p: ins.map((q) => at(x1, q)) });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    polys.push({ p: [at(xa, pts[i]), at(xa, pts[j]), at(xb, pts[j]), at(xb, pts[i])], e: edgeE[i] });
    polys.push({ p: [at(xa, pts[i]), at(xa, pts[j]), at(x0, ins[j]), at(x0, ins[i])], e: 1 });
    polys.push({ p: [at(xb, pts[i]), at(xb, pts[j]), at(x1, ins[j]), at(x1, ins[i])], e: 1 });
  }
  let cz = 0, cy = 0; pts.forEach((q) => { cz += q[0]; cy += q[1]; });
  return polyGeo(polys, [(x0 + x1) / 2, cy / n, cz / n]);
}

// lathe around the X axis. prof: [[r, x], ...] walked with the outside on the right-hand side (like three's lathe);
// mirror = the same part on the -X side
function lathe(prof, seg = 24, mirror = false) {
  const p = mirror ? prof.map(([r, x]) => [r, -x]).reverse() : prof;
  const g = new THREE.LatheGeometry(p.map(([r, x]) => new THREE.Vector2(Math.max(0, r), x)), seg);
  g.rotateZ(-Math.PI / 2);           // lathe axis +Y -> +X
  return g;
}
// lathe around Z (barrels): prof [[r, z], ...]
function latheZ(prof, seg = 24) {
  const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(Math.max(0, r), z)), seg);
  g.rotateX(Math.PI / 2);            // +Y -> +Z
  return g;
}

// rings of points (same count, closed loops) -> smooth surface; optional fan caps at both ends. e: aE per ring
function loftRings(rings, { capStart = false, capEnd = false, e = null } = {}) {
  const R = rings.length, N = rings[0].length;
  const pos = [], idx = [], uv = [], ae = [];
  for (let k = 0; k < R; k++) {
    let s = 0;
    for (let i = 0; i <= N; i++) {
      const p = rings[k][i % N];
      if (i > 0) s += p.distanceTo(rings[k][i - 1]);
      pos.push(p.x, p.y, p.z); uv.push(s, k === 0 ? 0 : p.y); ae.push(e ? e[k] : 0);
    }
  }
  const W = N + 1;
  for (let k = 0; k < R - 1; k++) for (let i = 0; i < N; i++) {
    const a = k * W + i, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aE', new THREE.Float32BufferAttribute(ae, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const parts = [g];
  const cap = (ring, flip) => {
    const c = V(); ring.forEach((p) => c.add(p)); c.divideScalar(ring.length);
    const polys = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      polys.push({ p: flip ? [[c.x, c.y, c.z], [b.x, b.y, b.z], [a.x, a.y, a.z]] : [[c.x, c.y, c.z], [a.x, a.y, a.z], [b.x, b.y, b.z]] });
    }
    return polyGeo(polys, null);
  };
  if (capStart) parts.push(cap(rings[0], true));
  if (capEnd) parts.push(cap(rings[R - 1], false));
  return parts;
}
// reverse the winding of every triangle (non-indexed), keeping the attributes per vertex
function swapWinding(g) {
  g = prep(g);
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name], s = a.itemSize, arr = a.array;
    for (let t = 0; t < a.count; t += 3) for (let k = 0; k < s; k++) {
      const i1 = (t + 1) * s + k, i2 = (t + 2) * s + k; const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp;
    }
  }
  return g;
}
function flipFaces(g) {
  g = swapWinding(g);
  const nr = g.attributes.normal.array; for (let i = 0; i < nr.length; i++) nr[i] = -nr[i];
  return g;
}
// the same part on the other side of the tank (x -> -x), still facing outwards
const mirrorX = (g) => swapWinding(prep(g).clone().scale(-1, 1, 1));
const both = (g) => [g, mirrorX(g)];

// frames on the sloped plates: local +Y = the plate's outward normal
const GL = (() => {
  const { z0, y0, z1, y1 } = D.gl, len = Math.hypot(z1 - z0, y1 - y0);
  const U = V(0, (y1 - y0) / len, (z1 - z0) / len);            // up the slope
  const N = V(0, -U.z, U.y);                                     // outward (forward and up)
  return { O: V(0, y0, z0), U, N, len };
})();
function glacisM(x, u, h) {                                      // local x -> +X, y -> N, z -> down the slope
  const m = new THREE.Matrix4().makeBasis(V(1, 0, 0), GL.N, V(1, 0, 0).cross(GL.N));
  const p = GL.O.clone().addScaledVector(GL.U, u).addScaledVector(GL.N, h); p.x = x;
  return m.setPosition(p);
}
const RP = (() => {                                              // upper rear plate: bottom edge (rearMid, floorY) -> top
  const O = V(0, D.floorY, D.rearMid), T = V(0, D.roofY, D.rearTop), len = T.distanceTo(O);
  const U = T.clone().sub(O).normalize();
  const N = V(0, U.z, -U.y);                                     // outward: back and a little up
  return { O, U, N, len };
})();
function rearM(x, u, h) {                                        // local y -> N (backwards), z -> up the plate
  const m = new THREE.Matrix4().makeBasis(V(1, 0, 0), RP.N, V(1, 0, 0).cross(RP.N));
  const p = RP.O.clone().addScaledVector(RP.U, u).addScaledVector(RP.N, h); p.x = x;
  return m.setPosition(p);
}
const onM = (g, m) => g.applyMatrix4(m);

// ── materials ────────────────────────────────────────────────────────────────────────────────────────────────────
// One extra patch chained after plain()'s (the engine's fog stays). Per material (uniforms, so every Sherman material
// shares one program): uShMud = (mud line height, its fade, mud below the line, mud everywhere), uShWear = (paint
// mottling, edge dust, cast bump, snow multiplier); uShSnow is shared by the whole tank. aW = rest position in the tank
// frame (baked per vertex; instanced parts either transform it by instanceMatrix — static bolts — or offset the noise
// per instance — links and wheels); aE = 1 on chamfers / edges.
const WX_VERT_PARS = /* glsl */`
attribute vec3 aW;
attribute float aE;
uniform float uShInst;
varying vec3 vShP;
varying vec3 vShN;
varying float vShE;
varying float vShSeed;
`;
const WX_VERT = /* glsl */`
{
  vec3 wxP = aW; vec3 wxNo = objectNormal; vShSeed = 0.0;
  #ifdef USE_INSTANCING
    if (uShInst > 0.5) wxP = (instanceMatrix * vec4(aW, 1.0)).xyz;
    vShSeed = float(gl_InstanceID);
    wxNo = mat3(instanceMatrix) * wxNo;
  #endif
  vShP = wxP;
  vShN = normalize(mat3(modelMatrix) * wxNo);
  vShE = aE;
}
`;
const WX_FRAG_PARS = /* glsl */`
uniform float uShSnow;
uniform vec4 uShMud;
uniform vec4 uShWear;
varying vec3 vShP;
varying vec3 vShN;
varying float vShE;
varying float vShSeed;
float wxH(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float wxN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(wxH(i), wxH(i + vec3(1.0, 0.0, 0.0)), f.x), mix(wxH(i + vec3(0.0, 1.0, 0.0)), wxH(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(wxH(i + vec3(0.0, 0.0, 1.0)), wxH(i + vec3(1.0, 0.0, 1.0)), f.x), mix(wxH(i + vec3(0.0, 1.0, 1.0)), wxH(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// fbm with the octaves rotated against each other (no grid-aligned blocks)
const mat3 WXR = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float wxF(vec3 p) {
  float s = wxN(p) * 0.5; p = WXR * p * 2.02; s += wxN(p) * 0.25; p = WXR * p * 2.03; s += wxN(p) * 0.125;
  p = WXR * p * 2.01; s += wxN(p) * 0.0625; return s / 0.9375;
}
`;
const WX_FRAG_COLOR = /* glsl */`
float wxSnow = 0.0; float wxMud = 0.0; float wxDust = 0.0;
{
  vec3 P = vShP + mod(vShSeed * vec3(7.13, 3.31, 5.71), 61.0);
  float n1 = wxF(P * 0.9);             // large: paint mottling, the wandering mud line
  float n2 = wxF(P * 3.1 + 17.0);      // medium: the mud coat, dust
  float n3 = wxF(P * 13.0 + 41.0);     // fine: speckle
  // paint: mottled olive drab, sun-faded patches
  float mot = uShWear.x;
  diffuseColor.rgb *= 1.0 + ((n1 - 0.5) * 0.6 + (n3 - 0.5) * 0.14) * mot;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.16, 1.13, 1.03), smoothstep(0.52, 0.70, n2) * 0.5 * mot);
  // mud: a coat below an irregular line (tank frame), streaky splatter above it, all over the running gear
  float line = uShMud.x + (n1 - 0.5) * 0.6;
  float below = 1.0 - smoothstep(line - uShMud.y, line + uShMud.y * 0.35, vShP.y);
  float splat = smoothstep(0.56, 0.70, wxF(P * vec3(6.0, 2.0, 6.0) + 3.0)) * (1.0 - smoothstep(line, line + 0.5, vShP.y));
  float m = max(below * (0.7 + 0.3 * n2), splat * 0.7) * uShMud.z;
  wxMud = clamp(max(m, uShMud.w * (0.6 + 0.4 * n2)), 0.0, 1.0);
  vec3 mudC = mix(vec3(0.030, 0.026, 0.021), vec3(0.072, 0.064, 0.052), smoothstep(0.35, 0.75, n3 * 0.6 + n2 * 0.4));
  mudC = mix(mudC, vec3(0.16, 0.165, 0.175), uShSnow * 0.3 * smoothstep(0.64, 0.8, n3));
  diffuseColor.rgb = mix(diffuseColor.rgb, mudC, wxMud * 0.85);
  // dry dust caught on the edges
  wxDust = vShE * uShWear.y * smoothstep(0.42, 0.6, n2 * 0.5 + n3 * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.185, 0.15), wxDust * 0.7);
  // snow: holds on flat tops first and on slopes only as it deepens; drifts break it up, edges stay dark
  float cover = clamp(uShSnow * uShWear.w, 0.0, 1.0);
  vec3 Nw = normalize(vShN);
  float drift = wxF(P * 2.3 + 5.0);
  float sv = Nw.y + (drift - 0.5) * 0.45 - vShE * 0.12;
  float T = mix(1.2, 0.42, cover);
  wxSnow = step(0.001, cover) * smoothstep(T - 0.035, T + 0.035, sv) * smoothstep(0.2, 0.45, Nw.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.79, 0.82, 0.87) * (0.84 + 0.16 * smoothstep(0.3, 0.7, n3 * 0.6 + drift * 0.4)), wxSnow);
}
`;
const WX_FRAG_RM = /* glsl */`
roughnessFactor = mix(roughnessFactor, 0.96, wxMud * 0.85);
roughnessFactor = mix(roughnessFactor, 0.9, wxDust * 0.6);
roughnessFactor = mix(roughnessFactor, 0.86, wxSnow);
metalnessFactor = mix(metalnessFactor, 0.0, max(wxMud, wxSnow));
`;
const WX_FRAG_N = /* glsl */`
{
  // bump from the rest position: fine cast-steel texture, soft lumps in the snow (a small rim where a patch ends);
  // each faded out by the pixel footprint before it can alias
  float fp = length(fwidth(vShP));
  float hb = 0.0;
  if (uShWear.z > 0.0) {
    vec3 Pc = vShP * 29.0;
    hb += (wxN(Pc) * 0.6 + wxN(Pc * 2.7 + 9.0) * 0.4) * uShWear.z * 0.0022 * (1.0 - smoothstep(0.014, 0.034, fp)) * (1.0 - wxSnow);
  }
  hb += wxF(vShP * 7.0 + 3.0) * 0.006 * wxSnow * (1.0 - smoothstep(0.05, 0.12, fp));
  vec3 sp = - vViewPosition;
  vec3 sx = dFdx(sp), sy = dFdy(sp);
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  vec3 grad = sign(det) * (dFdx(hb) * r1 + dFdy(hb) * r2);
  normal = normalize(abs(det) * normal - grad);
}
`;

// chain the weathering after the material's own onBeforeCompile (plain()'s fog uniforms)
function weather(m, snowU, o = {}) {
  const prev = m.onBeforeCompile;
  const uMud = { value: new THREE.Vector4(o.mudTop ?? 1.05, o.mudFade ?? 0.35, o.mud ?? 0.95, o.mudAll ?? 0) };
  const uWear = { value: new THREE.Vector4(o.mottle ?? 1, o.dust ?? 0.8, o.cast ?? 0, o.snow ?? 1) };
  const uInst = { value: o.inst ? 1 : 0 };
  m.onBeforeCompile = (sh, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(m, sh, r);
    sh.uniforms.uShSnow = snowU; sh.uniforms.uShMud = uMud; sh.uniforms.uShWear = uWear; sh.uniforms.uShInst = uInst;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + WX_VERT_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + WX_VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WX_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + WX_FRAG_COLOR)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + WX_FRAG_RM)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + WX_FRAG_N);
  };
  const k0 = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
  m.customProgramCacheKey = () => k0 + '|sherman-wx1';
  m.userData.weather = { uMud, uWear, uInst };
  return m;
}

const OD = 0x4b5034;           // olive drab (sRGB)
function makeMaterials(snowU) {
  const W = (o, w) => weather(plain(o), snowU, w);
  const hullW = { mudTop: 1.02, mudFade: 0.38, mud: 0.95, mottle: 1, dust: 0.85, cast: 0.12, snow: 1 };
  return {
    hull: W({ color: OD, roughness: 0.72, metalness: 0.12 }, hullW),
    cast: W({ color: OD, roughness: 0.78, metalness: 0.1 }, { ...hullW, cast: 1 }),
    deck: W({ color: OD, roughness: 0.74, metalness: 0.12 }, { ...hullW, snow: 0.3 }),      // warm engine deck
    bolt: W({ color: OD, roughness: 0.6, metalness: 0.2 }, { ...hullW, inst: true }),
    run: W({ color: 0x484c33, roughness: 0.8, metalness: 0.15 }, { mudTop: 0.85, mudFade: 0.3, mud: 0.8, mudAll: 0.22, mottle: 0.8, dust: 0.9, cast: 0.5, snow: 0.55 }),
    rubber: W({ color: 0x1c1c1b, roughness: 0.88, metalness: 0 }, { mud: 0, mudAll: 0.18, mottle: 0.3, dust: 0.25, snow: 0.3 }),
    steel: W({ color: 0x5a574e, roughness: 0.5, metalness: 0.35 }, { mud: 0, mudAll: 0.35, mottle: 0.4, dust: 0.9, snow: 0.3 }),
    gun: W({ color: 0x2f312c, roughness: 0.42, metalness: 0.6 }, { mud: 0, mottle: 0.5, dust: 0.5, snow: 0.8 }),
    canvas: W({ color: 0x5c5a45, roughness: 1, metalness: 0 }, { mudTop: 1.9, mudFade: 0.3, mud: 0.3, mottle: 1.3, dust: 0.5, snow: 1 }),
    wood: W({ color: 0x55503f, roughness: 0.9, metalness: 0 }, { mudTop: 1.9, mud: 0.2, mottle: 1.2, dust: 0.6, snow: 1 }),
    can: W({ color: 0x505638, roughness: 0.55, metalness: 0.25 }, { mudTop: 1.9, mud: 0.3, mottle: 0.8, dust: 0.9, snow: 1 }),
    rope: W({ color: 0x3a3226, roughness: 1, metalness: 0 }, { mud: 0, mottle: 0.6, dust: 0.2, snow: 0.6 }),
    glass: plain({ color: 0x0b1318, roughness: 0.06, metalness: 0.5, envMapIntensity: 1.3 }),
    lens: plain({ color: 0x6d726c, roughness: 0.1, metalness: 0.4 }),
    dark: plain({ color: 0x050505, roughness: 0.9, metalness: 0 }),
  };
}

// ── decals: canvas textures, weathered with paint chips and scratches (deterministic) ────────────────────────────
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  return t;
}
function chip(g, w, h, R, n, maxR) {
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, r = (0.2 + R() * R()) * maxR;
    g.globalAlpha = 0.35 + R() * 0.65;
    g.beginPath();
    const k = 5 + Math.floor(R() * 4);
    for (let j = 0; j < k; j++) {
      const a = j / k * TAU, rr = r * (0.5 + R() * 0.8);
      j ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.fill();
  }
  // a few scratches and a worn, streaky lower edge
  g.lineCap = 'round';
  for (let i = 0; i < n / 6; i++) {
    const x = R() * w, y = R() * h, a = (R() - 0.5) * 1.2, l = (0.05 + R() * 0.2) * w;
    g.globalAlpha = 0.3 + R() * 0.5; g.lineWidth = 0.6 + R() * 1.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < w / 6; i++) {
    const x = R() * w, l = R() * R() * h * 0.35;
    g.globalAlpha = 0.15 + R() * 0.3; g.lineWidth = 1 + R() * 3;
    g.beginPath(); g.moveTo(x, h); g.lineTo(x + (R() - 0.5) * 6, h - l); g.stroke();
  }
  g.restore();
}
const PAINT = '#e6e2d4';
function starTexture(R) {
  return canvasTex(512, 512, (g, w) => {
    const c = w / 2, ro = w * 0.47, lw = w * 0.045;
    g.strokeStyle = PAINT; g.fillStyle = PAINT; g.lineWidth = lw;
    g.beginPath(); g.arc(c, c, ro - lw / 2, 0, TAU); g.stroke();
    const rs = ro - lw * 1.05, ri = rs * 0.382;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? ri : rs;
      i ? g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r) : g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    chip(g, w, w, R, 260, 7);
  });
}
// text in hand-cut block letters; '^' draws the armored-force triangle
function textTexture(R, text, w, h, px) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = PAINT; g.strokeStyle = PAINT;
    g.font = `bold ${px}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    g.textBaseline = 'middle';
    const parts = text.split('');
    const widths = parts.map((ch) => (ch === '^' ? px * 0.62 : ch === ' ' ? px * 0.32 : g.measureText(ch).width + px * 0.06));
    const total = widths.reduce((a, b) => a + b, 0);
    const sx = Math.min(1, (w * 0.94) / total);
    let x = (w - total * sx) / 2;
    parts.forEach((ch, i) => {
      const cw = widths[i] * sx;
      g.save(); g.translate(x + cw / 2, h / 2 + (R() - 0.5) * px * 0.04); g.rotate((R() - 0.5) * 0.03); g.scale(sx, 1);
      if (ch === '^') {
        const s = px * 0.5; g.lineWidth = px * 0.1; g.lineJoin = 'miter';
        g.beginPath(); g.moveTo(-s * 0.55, s * 0.5); g.lineTo(0, -s * 0.55); g.lineTo(s * 0.55, s * 0.5); g.closePath(); g.stroke();
      } else if (ch !== ' ') { g.textAlign = 'center'; g.fillText(ch, 0, 0); }
      g.restore();
      x += cw;
    });
    chip(g, w, h, R, Math.round(w * h / 1400), px * 0.07);
  });
}

// ── tracks and running gear ──────────────────────────────────────────────────────────────────────────────────────
const WHEEL_Z = D.bogies.flatMap((zb) => [zb + D.wheelHalf, zb - D.wheelHalf]);     // front -> rear
const ROLLER_Z = D.bogies.map((zb) => zb + D.rol.dz);                               // front -> rear

// a bar in a plane x = const from a = [z, y] to b = [z, y]: w wide (x), t thick
function barX(x, a, b, w, t, bev = 0.01) {
  const dz = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dz, dy);
  return tf(cbox(w, len, t, bev), x, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2, Math.atan2(dz, dy), 0, 0);
}

// the pitch line (the link pins) as a closed path in the (z, y) plane, clockwise seen from the tank's left (+X): the
// top run moves forward, the bottom run backward. circles: [{z, y, r}] in that order, r measured to the pitch line.
function trackPath(circles) {
  const n = circles.length, tan = [];
  for (let i = 0; i < n; i++) {
    const A = circles[i], B = circles[(i + 1) % n];
    const dz = B.z - A.z, dy = B.y - A.y, dd = Math.hypot(dz, dy);
    const al = Math.atan2(dy, dz) + Math.acos(clamp((A.r - B.r) / dd, -1, 1));   // outer tangent's normal angle
    tan.push({ al, a: [A.z + A.r * Math.cos(al), A.y + A.r * Math.sin(al)], b: [B.z + B.r * Math.cos(al), B.y + B.r * Math.sin(al)] });
  }
  const segs = [];
  let L = 0;
  for (let i = 0; i < n; i++) {
    const C = circles[i], aIn = tan[(i - 1 + n) % n].al, aOut = tan[i].al;
    let sw = Math.atan2(Math.sin(aIn - aOut), Math.cos(aIn - aOut));   // clockwise sweep round this circle
    if (sw < 0) sw = 0;                                                // a roller just under the line: no wrap
    if (sw > 0) { segs.push({ arc: true, c: C, a0: aIn, len: sw * C.r, s0: L }); L += sw * C.r; }
    const len = Math.hypot(tan[i].b[0] - tan[i].a[0], tan[i].b[1] - tan[i].a[1]);
    segs.push({ arc: false, a: tan[i].a, b: tan[i].b, len, s0: L }); L += len;
  }
  function at(s, out = [0, 0]) {
    s = ((s % L) + L) % L;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].s0 <= s) lo = mid; else hi = mid - 1; }
    const g = segs[lo], u = s - g.s0;
    if (g.arc) { const a = g.a0 - u / g.c.r; out[0] = g.c.z + g.c.r * Math.cos(a); out[1] = g.c.y + g.c.r * Math.sin(a); }
    else { const f = g.len > 0 ? u / g.len : 0; out[0] = g.a[0] + (g.b[0] - g.a[0]) * f; out[1] = g.a[1] + (g.b[1] - g.a[1]) * f; }
    return out;
  }
  return { L, at, a0: tan[n - 1].al };      // a0: the angle on the sprocket where s = 0 starts
}

// the loop round sprocket, road wheels, idler and return rollers. The sprocket's pitch radius is tied to the link
// pitch (13 teeth), and the pitch is stretched a hair so a whole number of links closes the loop.
function layoutTrack() {
  const circ = (rs) => [
    { z: D.spr.z, y: D.spr.y, r: rs },
    ...WHEEL_Z.map((z) => ({ z, y: D.wheelY, r: D.wheelR + D.lk.inner })),
    { z: D.idl.z, y: D.idl.y, r: D.idl.r + D.lk.inner },
    ...ROLLER_Z.slice().reverse().map((z) => ({ z, y: D.rolY, r: D.rol.r + D.lk.inner })),
  ];
  let rs = D.spr.teeth * D.pitch / TAU, path = null, N = 0, p = D.pitch;
  for (let it = 0; it < 6; it++) {
    path = trackPath(circ(rs)); N = Math.round(path.L / D.pitch); p = path.L / N; rs = D.spr.teeth * p / TAU;
  }
  return { path, N, p, rs };
}

// one T48 rubber-chevron shoe of the left (+X) track. Local x outwards, y away from the wheels, z the direction of
// travel, pins at z = +-p/2. The end connectors, the centre guide and the Jumbo's extended end connector ("duckbill",
// outboard only) sit on the front pin, so every pin gets exactly one set.
function linkParts(p) {
  const { inner, outer, half, conn, duck } = D.lk, zf = p / 2;
  const rubber = merge([
    cbox(half * 2, inner * 2, p - 0.012, 0.006),
    tf(boxM(0.165, outer - inner, 0.032), 0.074, (outer + inner) / 2, 0, 0, 22 * DEG, 0),       // the chevron
    tf(boxM(0.165, outer - inner, 0.032), -0.074, (outer + inner) / 2, 0, 0, -22 * DEG, 0),
  ]);
  const steel = merge([
    cboxAt(conn - half, 0.056, 0.06, 0.006, (half + conn) / 2, 0.004, zf),
    cboxAt(conn - half, 0.056, 0.06, 0.006, -(half + conn) / 2, 0.004, zf),
    boxM(0.012, 0.024, 0.03, conn + 0.006, -0.006, zf),
    boxM(0.012, 0.024, 0.03, -conn - 0.006, -0.006, zf),
    boxM(duck - conn, 0.02, 0.11, (duck + conn) / 2, 0.022, zf),
    boxM(0.06, 0.03, 0.08, 0, -inner - 0.015, zf),
    boxM(0.042, 0.044, 0.05, 0, -0.074, zf),
  ]);
  return { rubber, steel };
}

// dual road wheel, 20 in, stamped disc wheels with rubber tyres, gap for the centre guides (symmetric about x = 0)
function roadWheelParts(seg = 20) {
  const tyre = [[0.212, 0.050], [0.244, 0.050], [0.254, 0.060], [0.254, 0.185], [0.244, 0.195], [0.212, 0.195]];
  const disc = [[0.214, 0.192], [0.17, 0.177], [0.105, 0.177], [0.078, 0.203], [0.045, 0.213], [0, 0.215]];
  const inner = [[0.055, 0.052], [0.214, 0.052]];
  const bolts = [];
  for (let k = 0; k < 6; k++) {
    const a = (k + 0.5) / 6 * TAU;
    for (const sx of [1, -1]) bolts.push(boxM(0.012, 0.016, 0.016, sx * 0.213, Math.sin(a) * 0.058, Math.cos(a) * 0.058));
  }
  return {
    rubber: merge([lathe(tyre, seg), lathe(tyre, seg, true)]),
    steel: merge([lathe(disc, seg), lathe(disc, seg, true), lathe(inner, seg), lathe(inner, seg, true),
      cyl('x', 0.055, 0.055, -0.056, 0.056, 12, true), ...bolts]),
  };
}
// idler: the same idea, all steel, 21.4 in
function idlerParts(seg = 22) {
  const rim = [[0.242, 0.048], [0.266, 0.048], [0.272, 0.056], [0.272, 0.184], [0.266, 0.192], [0.242, 0.192]];
  const disc = [[0.244, 0.19], [0.20, 0.178], [0.13, 0.176], [0.09, 0.198], [0.05, 0.21], [0, 0.212]];
  const inner = [[0.05, 0.05], [0.244, 0.05]];
  const bolts = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * TAU;
    for (const sx of [1, -1]) bolts.push(boxM(0.012, 0.018, 0.018, sx * 0.21, Math.sin(a) * 0.072, Math.cos(a) * 0.072));
  }
  return merge([lathe(rim, seg), lathe(rim, seg, true), lathe(disc, seg), lathe(disc, seg, true),
    lathe(inner, seg), lathe(inner, seg, true), cyl('x', 0.05, 0.05, -0.051, 0.051, 12, true), ...bolts]);
}
// dual return roller with rubber tyres
function rollerParts(seg = 16) {
  const tyre = [[0.09, 0.046], [0.108, 0.046], [0.115, 0.054], [0.115, 0.142], [0.108, 0.15], [0.09, 0.15]];
  const disc = [[0.092, 0.148], [0.06, 0.142], [0.04, 0.156], [0, 0.16]];
  const inner = [[0.03, 0.048], [0.092, 0.048]];
  return {
    rubber: merge([lathe(tyre, seg), lathe(tyre, seg, true)]),
    steel: merge([lathe(disc, seg), lathe(disc, seg, true), lathe(inner, seg), lathe(inner, seg, true),
      cyl('x', 0.024, 0.024, -0.05, 0.05, 8, true)]),
  };
}
// drive sprocket: two 13-tooth rings (the teeth take the end connectors), a drum between them, a domed hub.
// Tooth gaps sit at local angle k * 2pi/13 (angles in the (z, y) plane from +z towards +y).
function sprocketParts(rs, seg = 20) {
  const n = D.spr.teeth, al = TAU / n, Rr = rs - 0.038, Rt = rs + 0.052;
  const shape = new THREE.Shape();
  const pts = [];
  for (let k = 0; k < n; k++) {
    const c = (k + 0.5) * al;
    pts.push([c - 0.34 * al, Rr], [c - 0.24 * al, rs], [c - 0.12 * al, Rt], [c + 0.12 * al, Rt], [c + 0.24 * al, rs], [c + 0.34 * al, Rr]);
    pts.push([c + 0.5 * al, Rr - 0.004]);
  }
  pts.forEach(([a, r], i) => { const u = -r * Math.cos(a), v = r * Math.sin(a); if (i) shape.lineTo(u, v); else shape.moveTo(u, v); });
  shape.closePath();
  const ring = (x0) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.028, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 1, curveSegments: 1 });
    g.rotateY(Math.PI / 2);           // extrusion +Z -> +X; shape (u, v) -> (z = -u, y = v)
    return g.translate(x0, 0, 0);
  };
  const bolts = [];
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) * al;
    bolts.push(boxM(0.01, 0.018, 0.018, 0.213, Math.sin(a) * 0.24, Math.cos(a) * 0.24));
  }
  const hub = [[0.165, 0.206], [0.145, 0.222], [0.095, 0.236], [0.05, 0.246], [0, 0.25]];
  return merge([ring(0.176), ring(-0.204), cyl('x', 0.19, 0.19, -0.18, 0.18, seg, true), lathe(hub, seg),
    cyl('x', 0.13, 0.13, -0.30, -0.2, 14, true), ...bolts]);
}
// VVSS bogie (static parts) of the left side at bogie centre zb, in tank coordinates: the bracket casting with the
// return roller on top, the volute spring between the wheels, the two arms and the wheel spindles
function bogieParts(zb) {
  const X = (lx) => D.trackX + lx, rz = zb + D.rol.dz;
  const out = [
    cboxAt(0.36, 0.18, 0.44, 0.03, X(-0.08), 0.69, zb),
    cboxAt(0.24, 0.05, 0.30, 0.015, X(-0.10), 0.795, zb + 0.02),
    cboxAt(0.05, 0.14, 0.12, 0.012, X(-0.20), 0.85, rz),
    tf(cyl('x', 0.03, 0.03, X(-0.25), X(-0.14), 10), 0, D.rolY, rz),
    cboxAt(0.15, 0.035, 0.09, 0.008, X(-0.09), 0.455, zb),
    ...[[0.055, 0.05, 0.47, 0.51], [0.05, 0.047, 0.51, 0.55], [0.047, 0.044, 0.55, 0.59], [0.044, 0.042, 0.59, 0.62]]
      .map(([r0, r1, y0, y1]) => tf(cyl('y', r0, r1, y0, y1, 14), X(-0.07), 0, zb)),
  ];
  for (const s of [1, -1]) {
    const hz = zb + s * D.wheelHalf;
    out.push(barX(X(-0.228), [zb + s * 0.12, 0.62], [hz, D.wheelY], 0.052, 0.07));
    out.push(tf(cyl('x', 0.042, 0.042, X(-0.262), X(-0.2), 10), 0, D.wheelY, hz));
  }
  return out;
}

// ── the hull ─────────────────────────────────────────────────────────────────────────────────────────────────────
// geometry buckets: one merged mesh per material per moving part
function bucket() {
  const b = {};
  return { b, add(k, ...gs) { for (const g of gs.flat()) if (g) (b[k] ||= []).push(prep(g)); } };
}
const gp = (x, u, h) => { const p = GL.O.clone().addScaledVector(GL.U, u).addScaledVector(GL.N, h); return [x, p.y, p.z]; };
const rp = (x, u, h) => { const p = RP.O.clone().addScaledVector(RP.U, u).addScaledVector(RP.N, h); return [x, p.y, p.z]; };
// a clevis: U of round bar hanging from a pin along x, arc swung out by `ang` (radians, from straight up round +X)
function shackle(x, y, z, ang) {
  const u = new THREE.TorusGeometry(0.05, 0.016, 6, 10, Math.PI);
  u.rotateX(ang);
  return [u.translate(x, y, z), cyl('x', 0.013, 0.013, x - 0.075, x + 0.075, 8).translate(0, y, z)];
}
// jerrycan standing upright, broad faces towards +-x
function jerrycan(x, y, z, ry = 0) {
  const w = 0.345, h = 0.47, d = 0.165;
  const parts = [cbox(d, h, w, 0.02)];
  const ang = Math.atan2(h * 0.8, w * 0.8);
  for (const sx of [1, -1]) for (const s of [1, -1]) parts.push(tf(boxM(0.008, 0.022, Math.hypot(w, h) * 0.78), sx * (d / 2 + 0.002), 0, 0, s * ang, 0, 0));
  for (const hz of [-0.09, 0, 0.09]) parts.push(boxM(0.028, 0.03, 0.022, 0, h / 2 + 0.015, hz));
  parts.push(boxM(0.03, 0.012, 0.21, 0, h / 2 + 0.036, 0));
  parts.push(tf(cyl('y', 0.022, 0.02, 0, 0.05, 8), 0, h / 2, w / 2 - 0.05));
  return merge(parts.map((g) => tf(g, 0, 0, 0, 0, ry, 0))).translate(x, y + h / 2, z);
}

function buildHull(B, bolts) {
  const bolt = (x, y, z, nx = 0, ny = 1, nz = 0, s = 1) => bolts.push([x, y, z, nx, ny, nz, s]);
  // upper hull (sponsons over the tracks, 47-degree glacis, leaning rear plate) and the lower hull between the tracks
  B.add('hull', extrudeX([[D.gl.z0, D.gl.y0], [D.gl.z1, D.gl.y1], [D.rearTop, D.roofY], [D.rearMid, D.floorY]], -D.hw, D.hw, 0.016));
  B.add('hull', extrudeX([[2.30, D.bellyY], [2.30, D.floorY], [D.rearMid, D.floorY], [D.rearLow, D.bellyY]], -D.lw, D.lw, 0.016));
  // the Jumbo's 1.5 in side appliques over the fighting compartment
  const sideApp = [[-0.85, 1.17], [2.49, 1.17], [1.76, 1.85], [-0.85, 1.85]];
  B.add('hull', both(extrudeX(sideApp, D.hw, D.hw + 0.04, 0.008)));
  // and the 1.5 in plate welded over the glacis
  B.add('hull', onM(cbox(2.44, 0.038, 0.98, 0.01), glacisM(0, 0.55, 0.019)));
  // welds: glacis applique, side appliques, glacis/side and roof/side seams
  const weld = (a, b, r = 0.009) => B.add('hull', rod(a, b, r, 5));
  const gu0 = 0.06, gu1 = 1.04, gx = 1.225;
  weld(gp(-gx, gu0, 0.005), gp(gx, gu0, 0.005)); weld(gp(-gx, gu1, 0.005), gp(gx, gu1, 0.005));
  weld(gp(-gx, gu0, 0.005), gp(-gx, gu1, 0.005)); weld(gp(gx, gu0, 0.005), gp(gx, gu1, 0.005));
  for (const s of [1, -1]) {
    const x = s * (D.hw + 0.006);
    for (let i = 0; i < sideApp.length; i++) {
      const [z0, y0] = sideApp[i], [z1, y1] = sideApp[(i + 1) % sideApp.length];
      weld([x, y0, z0], [x, y1, z1]);
    }
    weld([s * D.hw, D.gl.y0, D.gl.z0], [s * D.hw, D.gl.y1, D.gl.z1], 0.011);
    weld([s * (D.hw - 0.004), D.roofY + 0.002, D.gl.z1], [s * (D.hw - 0.004), D.roofY + 0.002, D.rearTop], 0.009);
  }

  // one-piece cast transmission cover: a rounded nose lofted across the hull, rounded off at both ends
  const lower = new THREE.CatmullRomCurve3([[2.20, 0.45], [2.50, 0.455], [2.74, 0.505], [2.89, 0.60], [2.975, 0.74]]
    .map(([z, y]) => V(0, y, z)), false, 'centripetal');
  const upper = new THREE.CatmullRomCurve3([[2.975, 0.74], [2.95, 0.86], [2.87, 0.99], [2.72, 1.09], [2.55, 1.145], [2.30, 1.15]]
    .map(([z, y]) => V(0, y, z)), false, 'centripetal');
  const A = V(0, 0.80, 2.46);
  const stations = [];
  for (let k = 0; k <= 6; k++) { const th = k / 6 * Math.PI / 2; stations.push([-(0.70 + 0.12 * Math.cos(th)), Math.sin(th)]); }
  for (let k = 6; k >= 0; k--) { const th = k / 6 * Math.PI / 2; stations.push([0.70 + 0.12 * Math.cos(th), Math.sin(th)]); }
  const coverPart = (prof, back) => {
    const pts = back ? prof.concat(back) : prof, rings = [], ringE = [];
    for (const [x, f] of stations) {
      rings.push(pts.map((p) => V(x, A.y + (p.y - A.y) * f, A.z + (p.z - A.z) * f)));
      ringE.push(f < 0.99 ? 0.6 : 0);
    }
    let g = merge(loftRings(rings, { e: ringE }));
    // face out: on the whole the normals point away from the anchor
    const pa = g.attributes.position, na = g.attributes.normal, q = V(), n = V();
    let sum = 0;
    for (let i = 0; i < pa.count; i++) sum += n.fromBufferAttribute(na, i).dot(q.fromBufferAttribute(pa, i).sub(A));
    if (sum < 0) g = flipFaces(g);
    return g;
  };
  // the nose crease stays sharp: two lofts, each closed round the anchor through the hull (hidden)
  B.add('cast', coverPart(lower.getSpacedPoints(12), [A.clone()]), coverPart(upper.getSpacedPoints(14), [A.clone()]));
  // final drive housings round the sprocket shafts
  const fd = [cyl('x', 0.2, 0.2, 0.62, 0.80, 18), lathe([[0.2, 0.80], [0.19, 0.83], [0.16, 0.85], [0, 0.852]], 18)].map((g) => g.translate(0, D.spr.y, D.spr.z));
  B.add('cast', both(merge(fd)));
  // its bolted flange under the glacis, towing lugs and shackles
  B.add('hull', cboxAt(1.64, 0.022, 0.07, 0.006, 0, 1.141, 2.595));
  for (let i = 0; i <= 20; i++) bolt(-0.78 + i * 0.078, 1.152, 2.60, 0, 1, 0.1);
  for (const s of [1, -1]) {
    B.add('cast', cboxAt(0.06, 0.09, 0.09, 0.015, s * 0.46, 0.60, 2.85));
    B.add('run', shackle(s * 0.46, 0.60, 2.90, 2.0));
  }

  // glacis furniture: headlights in brush guards, the bow .30 ball mount, lifting eyes, the gun travel lock
  for (const s of [1, -1]) {
    const x = s * 1.0, [, yL, zL] = gp(x, 0.26, 0.16);
    B.add('hull', rod(gp(x, 0.26, 0.03), [x, yL, zL - 0.02], 0.025, 8));
    B.add('hull', tf(cyl('z', 0.078, 0.082, -0.07, 0.05, 14), x, yL, zL));
    B.add('lens', tf(cyl('z', 0.066, 0.066, 0.05, 0.058, 14), x, yL, zL));
    B.add('hull', tube([gp(x - 0.13, 0.12, 0.03), [x - 0.13, yL + 0.02, zL + 0.10], [x - 0.08, yL + 0.13, zL + 0.12],
      [x + 0.08, yL + 0.13, zL + 0.12], [x + 0.13, yL + 0.02, zL + 0.10], gp(x + 0.13, 0.12, 0.03)], 0.011, 22, 6));
    B.add('hull', tube([gp(x - 0.1, 0.5, 0.035), [x - 0.1, yL + 0.14, zL + 0.02], [x + 0.1, yL + 0.14, zL + 0.02], gp(x + 0.1, 0.5, 0.035)], 0.01, 16, 5));
    B.add('hull', onM(tf(new THREE.TorusGeometry(0.04, 0.012, 6, 10, Math.PI), 0, 0, 0, 0, Math.PI / 2, 0), glacisM(s * 1.12, 0.98, 0.038)));
  }
  {
    const bm = glacisM(-0.50, 0.60, 0.038);
    B.add('cast', onM(cyl('y', 0.17, 0.15, 0, 0.07, 18), bm));
    B.add('cast', onM(new THREE.SphereGeometry(0.105, 14, 10).translate(0, 0.06, 0), bm.clone()));
    const c = V(0, 0.06, 0).applyMatrix4(bm);
    B.add('gun', rod([c.x, c.y, c.z + 0.06], [c.x, c.y, c.z + 0.26], 0.026, 10));
    B.add('gun', rod([c.x, c.y, c.z + 0.26], [c.x, c.y, c.z + 0.34], 0.012, 8));
    B.add('hull', onM(cboxAt(0.06, 0.05, 0.16, 0.01, 0, 0.06, 0.02), glacisM(0, 1.0, 0.038)));        // travel lock (folded)
    B.add('hull', onM(cboxAt(0.26, 0.04, 0.05, 0.01, 0, 0.04, 0.10), glacisM(0, 1.0, 0.038)));
  }

  // hull roof: driver's and co-driver's hatches with periscopes and guards, ventilator, lifting eyes
  for (const s of [1, -1]) {
    const x = s * 0.50;
    B.add('hull', cboxAt(0.60, 0.035, 0.54, 0.012, x, D.roofY + 0.0175, 1.36));
    B.add('hull', tf(cyl('z', 0.026, 0.026, 1.12, 1.60, 10), s * 0.82, D.roofY + 0.022, 0));
    B.add('hull', cboxAt(0.12, 0.07, 0.10, 0.008, x, 1.95, 1.52));
    B.add('glass', boxM(0.10, 0.034, 0.006, x, 1.952, 1.572));
    B.add('hull', cboxAt(0.19, 0.08, 0.014, 0.004, x, 1.955, 1.62), cboxAt(0.014, 0.08, 0.12, 0.004, x - 0.09, 1.955, 1.565), cboxAt(0.014, 0.08, 0.12, 0.004, x + 0.09, 1.955, 1.565));
    B.add('hull', tube([[x - 0.12, 1.915, 1.2], [x - 0.12, 1.955, 1.16], [x + 0.12, 1.955, 1.16], [x + 0.12, 1.915, 1.2]], 0.009, 10, 5));
    B.add('hull', tf(new THREE.TorusGeometry(0.036, 0.011, 6, 10, Math.PI), s * 1.12, D.roofY, -2.50, 0, Math.PI / 2, 0));
  }
  B.add('hull', drum(0.115, 0.1, D.roofY, 1.925, 16), new THREE.SphereGeometry(0.1, 14, 6, 0, TAU, 0, Math.PI / 2).scale(1, 0.45, 1).translate(0, 1.925, 0));
  B.b.hull[B.b.hull.length - 2].translate(0, 0, 1.60); B.b.hull[B.b.hull.length - 1].translate(0, 0, 1.60);
  // turret ring (seen in the gap under the turret)
  B.add('steel', drum(0.9, 0.9, D.roofY - 0.01, D.tur.y + 0.01, 40, { open: true }).translate(0, 0, D.tur.z));

  // engine deck: two access doors, fuel caps, the rear grille (louvres over a dark well)
  for (const s of [1, -1]) {
    B.add('deck', cboxAt(0.90, 0.022, 1.02, 0.008, s * 0.47, D.roofY + 0.011, -1.55));
    B.add('deck', tf(cyl('z', 0.02, 0.02, -2.03, -1.07, 8), s * 0.93, D.roofY + 0.016, 0));
    B.add('deck', tube([[s * 0.47 - 0.08, 1.902, -1.2], [s * 0.47 - 0.08, 1.93, -1.18], [s * 0.47 + 0.08, 1.93, -1.18], [s * 0.47 + 0.08, 1.902, -1.2]], 0.008, 8, 5));
    for (const z of [-1.12, -2.45]) B.add('deck', drum(0.06, 0.055, D.roofY, 1.905, 12).translate(s * 1.05, 0, z));
    for (const z of [-1.2, -1.55, -1.9]) bolt(s * 0.93, 1.915, z, 0, 1, 0, 0.8);
  }
  B.add('dark', boxM(1.96, 0.004, 0.44, 0, D.roofY + 0.003, -2.33));
  B.add('deck', cboxAt(2.02, 0.034, 0.04, 0.008, 0, D.roofY + 0.017, -2.09), cboxAt(2.02, 0.034, 0.04, 0.008, 0, D.roofY + 0.017, -2.57));
  B.add('deck', cboxAt(0.04, 0.034, 0.52, 0.008, 1.0, D.roofY + 0.017, -2.33), cboxAt(0.04, 0.034, 0.52, 0.008, -1.0, D.roofY + 0.017, -2.33));
  for (let k = 0; k < 9; k++) B.add('deck', cboxAt(1.96, 0.045, 0.01, 0.002, 0, D.roofY + 0.026, -2.14 - k * 0.048, 0.5, 0, 0));
  for (const x of [-0.98, 0.98]) for (const z of [-2.09, -2.57]) bolt(x, D.roofY + 0.034, z, 0, 1, 0, 0.8);

  // rear plate: engine doors, taillights in guards, exhaust deflector and pipes, towing pintle, shackles
  for (const s of [1, -1]) {
    B.add('hull', onM(cbox(0.86, 0.02, 0.50, 0.008), rearM(s * 0.47, 0.42, 0.01)));
    B.add('hull', onM(tf(cyl('x', 0.022, 0.022, -0.40, 0.40, 8), 0, 0.02, 0.24), rearM(s * 0.47, 0.42, 0.0)));
    for (const u of [0.25, 0.6]) bolts.push([...rp(s * 0.47 + s * 0.38, u, 0.02), RP.N.x, RP.N.y, RP.N.z, 0.8]);
    B.add('hull', onM(cbox(0.11, 0.07, 0.12, 0.01), rearM(s * 1.05, 0.62, 0.035)));
    B.add('lens', onM(boxM(0.07, 0.006, 0.05, 0, 0.038, 0.02), rearM(s * 1.05, 0.62, 0.035)));
    const [tx, ty, tz] = rp(s * 1.05, 0.62, 0.0);
    B.add('hull', tube([[tx - 0.09, ty - 0.08, tz], [tx - 0.09, ty - 0.02, tz - 0.12], [tx - 0.06, ty + 0.1, tz - 0.12], [tx + 0.06, ty + 0.1, tz - 0.12],
      [tx + 0.09, ty - 0.02, tz - 0.12], [tx + 0.09, ty - 0.08, tz]], 0.009, 18, 5));
    B.add('steel', rod([s * 0.42, 0.97, -2.76], [s * 0.42, 0.9, -2.93], 0.05, 12));
    B.add('dark', rod([s * 0.42, 0.9, -2.93], [s * 0.42, 0.895, -2.935], 0.043, 12));
    B.add('cast', cboxAt(0.06, 0.09, 0.09, 0.015, s * 0.62, 0.62, -2.68));
    B.add('run', shackle(s * 0.62, 0.62, -2.73, -2.0));
  }
  B.add('hull', cboxAt(1.40, 0.018, 0.24, 0.006, 0, 1.05, -2.89, -0.75, 0, 0));
  B.add('run', tf(cyl('z', 0.05, 0.05, -2.80, -2.66, 12), 0, 0.66, 0), tf(new THREE.TorusGeometry(0.055, 0.018, 6, 12, Math.PI * 1.3), 0, 0.64, -2.84, 0, Math.PI / 2, 0));

  // fenders over the sprockets and idlers, the sandshield rails along the sponsons
  for (const s of [1, -1]) {
    const f = [extrudeX([[2.50, 1.13], [2.86, 1.085], [2.86, 1.077], [2.50, 1.122]], 0.86, 1.30, 0.002),
      extrudeX([[2.86, 1.085], [2.90, 1.01], [2.892, 1.007], [2.853, 1.078]], 0.86, 1.30, 0.002),
      extrudeX([[2.50, 1.125], [2.86, 1.08], [2.86, 1.03], [2.50, 1.075]], 1.292, 1.30, 0.002),
      extrudeX([[-2.70, 1.13], [-2.98, 1.10], [-2.98, 1.093], [-2.70, 1.123]], 0.86, 1.30, 0.002)];
    B.add('hull', s > 0 ? f : f.map(mirrorX));
    B.add('hull', cboxAt(0.02, 0.032, 5.1, 0.005, s * 1.28, 1.146, -0.12));
    for (let z = -2.5; z <= 2.3; z += 0.3) bolt(s * 1.291, 1.146, z, s, 0, 0, 0.7);
    for (const z of [2.6, 2.78]) bolt(s * 1.08, 1.128, z, 0, 1, 0.12, 0.7);
  }

  // running gear, static parts: bogies (bracket, spring, arms, spindles), idler brackets
  for (const zb of D.bogies) {
    B.add('run', both(merge(bogieParts(zb))));
    for (const s of [1, -1]) for (const [dy, dz] of [[0.04, 0.12], [0.04, -0.12], [-0.05, 0.12], [-0.05, -0.12]])
      bolt(s * (D.trackX + 0.10 + 0.002), 0.69 + dy, zb + dz, s, 0, 0, 0.8);
  }
  B.add('run', both(merge([cboxAt(0.07, 0.22, 0.30, 0.015, 0.815, D.idl.y + 0.04, D.idl.z), tf(cyl('x', 0.045, 0.045, 0.78, 0.87, 10), 0, D.idl.y, D.idl.z)])));

  // stowage on the engine deck, clear of the turret bustle's sweep: tarp roll, crate, jerrycans, pioneer tools
  const deck = D.roofY + 0.022;
  B.add('canvas', cyl('x', 0.13, 0.13, -0.95, 0.95, 16).scale(1, 0.85, 1).translate(0, 2.04, -2.49));
  for (const x of [-0.62, 0, 0.62]) B.add('rope', new THREE.TorusGeometry(0.133, 0.011, 5, 18).rotateY(Math.PI / 2).scale(1, 0.85, 1).translate(x, 2.04, -2.49));
  B.add('wood', cboxAt(0.55, 0.30, 0.42, 0.01, 0.60, deck + 0.15, -1.80));
  for (const z of [-1.93, -1.67]) B.add('wood', cboxAt(0.57, 0.02, 0.07, 0.004, 0.60, deck + 0.305, z));
  B.add('can', jerrycan(-0.56, deck, -1.80), jerrycan(-0.20, deck, -1.80));
  B.add('wood', rod([1.14, deck + 0.022, -1.22], [1.14, deck + 0.022, -2.0], 0.018, 8));
  B.add('hull', cboxAt(0.2, 0.012, 0.26, 0.004, 1.14, deck + 0.02, -2.13));
  B.add('wood', rod([-1.12, deck + 0.022, -1.30], [-1.12, deck + 0.022, -2.10], 0.02, 8));
  B.add('hull', cboxAt(0.035, 0.03, 0.2, 0.006, -1.12, deck + 0.03, -2.14));
  for (const [x, z] of [[1.14, -1.4], [1.14, -1.85], [-1.12, -1.5], [-1.12, -1.95]]) B.add('hull', tube([[x - 0.04, deck, z], [x - 0.03, deck + 0.05, z], [x + 0.03, deck + 0.05, z], [x + 0.04, deck, z]], 0.006, 8, 4));
}

// ── the turret ───────────────────────────────────────────────────────────────────────────────────────────────────
// make a part face a direction on average (caps whose winding we did not track)
function orientTo(g, dir) {
  g = prep(g);
  const n = g.attributes.normal, s = V();
  for (let i = 0; i < n.count; i++) s.x += n.getX(i), s.y += n.getY(i), s.z += n.getZ(i);
  return s.dot(dir) < 0 ? flipFaces(g) : g;
}
// the heavy cast T23-type turret seen from above: near-vertical sides, a long bustle, the front recessed between
// two cheeks for the gun shield's rotor. Half outline (x >= 0) from the front centre to the rear centre.
function turretOutline(n = 76) {
  const half = [[0.00, 0.66], [0.30, 0.66], [0.44, 0.70], [0.52, 0.90], [0.72, 0.84], [0.92, 0.58], [1.02, 0.22],
    [1.03, -0.15], [0.98, -0.52], [0.86, -0.90], [0.62, -1.22], [0.30, -1.38], [0.00, -1.42]];
  const loop = half.concat(half.slice(1, -1).reverse().map(([x, z]) => [-x, z]));
  const c = new THREE.CatmullRomCurve3(loop.map(([x, z]) => V(x, 0, z)), true, 'centripetal');
  return c.getSpacedPoints(n).slice(0, n);
}
const TROOF = 0.76;          // turret roof above the turret base

function buildTurret(T, G) {
  // body: rings up the wall, a rounded fillet into the flat roof; radial insets keep the front recess clean
  const OUT = turretOutline(), C = V(0, 0, -0.26);
  const ring = (y, s, inset) => OUT.map((p) => {
    const dx = p.x - C.x, dz = p.z - C.z, r = Math.hypot(dx, dz) * s;
    const k = s * (1 - inset / Math.max(0.25, r));
    return V(C.x + dx * k, y, C.z + dz * k);
  });
  const Rf = 0.17, wallTop = TROOF - Rf, rings = [ring(0, 0.975, 0), ring(0.035, 1.0, 0), ring(wallTop, 0.972, 0)], e = [0.5, 0, 0];
  for (let k = 1; k <= 6; k++) { const th = k / 6 * Math.PI / 2; rings.push(ring(wallTop + Rf * Math.sin(th), 0.972, Rf * (1 - Math.cos(th)))); e.push(k < 6 ? 0.5 + 0.5 * Math.sin(th * 2) : 0.2); }
  const [side, bot, roof] = loftRings(rings, { capStart: true, capEnd: true, e });
  let sideG = prep(side);
  { const pa = sideG.attributes.position, na = sideG.attributes.normal; let best = 0;
    for (let i = 0; i < pa.count; i++) if (pa.getX(i) > pa.getX(best)) best = i;
    if (na.getX(best) < 0) sideG = flipFaces(sideG); }
  T.add('cast', sideG, orientTo(bot, V(0, -1, 0)), orientTo(roof, V(0, 1, 0)));
  T.add('cast', cboxAt(0.90, 0.06, 0.26, 0.02, 0, 0.03, 0.74));                       // chin under the rotor

  // commander's all-round vision cupola (right rear), hatch open
  const cup = (g) => g.translate(-0.42, TROOF, -0.28);
  T.add('cast', cup(drum(0.345, 0.335, 0, 0.07, 28)), cup(drum(0.28, 0.28, 0.07, 0.17, 24)), cup(drum(0.335, 0.31, 0.17, 0.215, 28)));
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * TAU, b = a + Math.PI / 6;
    T.add('cast', cup(tf(cbox(0.15, 0.09, 0.06, 0.01), Math.sin(a) * 0.3, 0.12, Math.cos(a) * 0.3, 0, a, 0)));
    T.add('glass', cup(tf(boxM(0.12, 0.05, 0.006), Math.sin(a) * 0.332, 0.12, Math.cos(a) * 0.332, 0, a, 0)));
    T.add('cast', cup(tf(cbox(0.05, 0.10, 0.07, 0.01), Math.sin(b) * 0.3, 0.12, Math.cos(b) * 0.3, 0, b, 0)));
  }
  const hatch = merge([drum(0.265, 0.26, 0, 0.035, 24).translate(0, 0, 0.265), tube([[-0.08, 0.035, 0.36], [-0.06, 0.07, 0.36], [0.06, 0.07, 0.36], [0.08, 0.035, 0.36]], 0.009, 8, 5)]);
  T.add('cast', cup(hatch.rotateX(-102 * DEG).translate(0, 0.215, -0.265)));
  T.add('cast', cup(tf(cyl('x', 0.024, 0.024, -0.12, 0.12, 10), 0, 0.225, -0.285)));
  // loader's hatch (left), periscopes with guards, ventilator, lifting eyes
  T.add('cast', drum(0.24, 0.235, 0, 0.03, 24).scale(1, 1, 0.8).translate(0.42, TROOF, -0.25));
  T.add('cast', tf(cyl('x', 0.02, 0.02, 0.28, 0.56, 8), 0, TROOF + 0.02, -0.44));
  T.add('cast', tube([[0.36, TROOF + 0.03, -0.12], [0.37, TROOF + 0.07, -0.12], [0.47, TROOF + 0.07, -0.12], [0.48, TROOF + 0.03, -0.12]], 0.009, 8, 5));
  for (const [x, z] of [[-0.28, 0.25], [0.38, 0.22]]) {
    T.add('cast', cboxAt(0.09, 0.075, 0.14, 0.01, x, TROOF + 0.037, z));
    T.add('glass', boxM(0.075, 0.035, 0.006, x, TROOF + 0.045, z + 0.072));
    T.add('hull', cboxAt(0.17, 0.085, 0.014, 0.004, x, TROOF + 0.042, z + 0.13), cboxAt(0.014, 0.085, 0.16, 0.004, x - 0.078, TROOF + 0.042, z + 0.05), cboxAt(0.014, 0.085, 0.16, 0.004, x + 0.078, TROOF + 0.042, z + 0.05));
  }
  T.add('cast', drum(0.10, 0.085, TROOF, TROOF + 0.05, 14).translate(-0.05, 0, -1.02), new THREE.SphereGeometry(0.085, 12, 5, 0, TAU, 0, Math.PI / 2).scale(1, 0.4, 1).translate(-0.05, TROOF + 0.05, -1.02));
  for (const s of [1, -1]) T.add('hull', tf(new THREE.TorusGeometry(0.04, 0.012, 6, 10, Math.PI), s * 1.0, 0.52, 0.12, Math.PI / 2, 0, -s * Math.PI / 2));
  T.add('hull', tf(new THREE.TorusGeometry(0.04, 0.012, 6, 10, Math.PI), 0, 0.52, -1.385, -Math.PI / 2, 0, 0));

  // .50 cal M2 on a pintle behind the cupola, ammunition box on its left
  const m2 = bucket();
  m2.add('cast', drum(0.055, 0.05, 0, 0.05, 12));
  m2.add('gun', drum(0.025, 0.025, 0.05, 0.33, 8), cboxAt(0.13, 0.05, 0.18, 0.01, 0, 0.345, 0), cboxAt(0.11, 0.15, 0.60, 0.012, 0, 0.44, 0.02),
    cboxAt(0.10, 0.03, 0.30, 0.006, 0, 0.53, 0.10), tf(cyl('z', 0.032, 0.032, 0.32, 0.46, 10), 0, 0.44, 0),
    tf(cyl('z', 0.021, 0.019, 0.46, 1.38, 8), 0, 0.44, 0), tf(cyl('z', 0.026, 0.026, 1.34, 1.42, 8), 0, 0.44, 0),
    rod([0.045, 0.44, -0.28], [0.045, 0.44, -0.40], 0.013, 6), rod([-0.045, 0.44, -0.28], [-0.045, 0.44, -0.40], 0.013, 6));
  m2.add('can', cboxAt(0.10, 0.18, 0.28, 0.01, 0.12, 0.40, 0.02));
  for (const k in m2.b) T.add(k, m2.b[k].map((g) => tf(g, 0.06, TROOF, -0.78, -0.04, -0.10, 0)));
  // MP-48 mast base on the bustle (the mast itself sways: built by the caller)
  T.add('cast', drum(0.05, 0.045, TROOF, TROOF + 0.06, 10).translate(0.50, 0, -0.98));
  T.add('dark', drum(0.022, 0.018, TROOF + 0.06, TROOF + 0.2, 8).translate(0.50, 0, -0.98));
  T.add('steel', drum(0.016, 0.016, TROOF + 0.2, TROOF + 0.27, 6).translate(0.50, 0, -0.98));

  // gun group (origin on the trunnion): rotor, the 7 in gun shield, collar, 75 mm M3, coax port, sight aperture
  const rotor = new THREE.CylinderGeometry(0.30, 0.30, 0.80, 24, 1, false, -75 * DEG, 150 * DEG);
  rotor.rotateZ(-Math.PI / 2);
  G.add('cast', rotor, setE(new RoundedBoxGeometry(0.84, 0.56, 0.22, 3, 0.075).translate(0, 0, 0.31), 0.35));
  G.add('cast', latheZ([[0.13, 0.415], [0.13, 0.50], [0.12, 0.54], [0.10, 0.56], [0.08, 0.565]], 24));
  G.add('gun', latheZ([[0.074, 0.40], [0.072, 0.56], [0.066, 0.95], [0.058, 1.65], [0.053, 2.36], [0.057, 2.42], [0.057, 2.49], [0.0385, 2.50]], 24));
  G.add('dark', latheZ([[0.0385, 2.50], [0.0375, 2.30], [0, 2.30]], 16));
  G.add('dark', tf(cyl('z', 0.022, 0.022, 0.40, 0.422, 10), 0.21, 0.02, 0), boxM(0.05, 0.035, 0.012, -0.25, 0.10, 0.418));
  G.add('gun', tf(cyl('z', 0.012, 0.012, 0.42, 0.47, 8), 0.21, 0.02, 0));
}

// ── assembly ─────────────────────────────────────────────────────────────────────────────────────────────────────
// the rest position in the tank frame, per vertex (the weathering noise and the mud line read it)
function bake(g, m = null) {
  const p = g.attributes.position, w = new Float32Array(p.count * 3), v = V();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); if (m) v.applyMatrix4(m);
    w[i * 3] = v.x; w[i * 3 + 1] = v.y; w[i * 3 + 2] = v.z;
  }
  g.setAttribute('aW', new THREE.Float32BufferAttribute(w, 3));
  g.computeBoundingSphere();
  return g;
}
function meshesFrom(B, M, parent, rest) {
  for (const k of Object.keys(B.b)) {
    if (!B.b[k].length) continue;
    const m = new THREE.Mesh(bake(mergeGeometries(B.b[k]), rest), M[k]);
    m.name = 'sherman-' + k; m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
  }
}
function instanced(geo, mat, count, name) {
  const im = new THREE.InstancedMesh(bake(geo), mat, count);
  im.name = name; im.castShadow = true; im.receiveShadow = true;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return im;
}
// two parts with their own materials in one geometry (groups 0 / 1)
const grouped = (a, b) => mergeGeometries([prep(a), prep(b)], true);
function countTriangles(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, c = (g.index ? g.index.count : g.attributes.position.count) / 3;
    n += o.isInstancedMesh ? c * o.count : c;
  });
  return Math.round(n);
}

// opts: { name: painted on both sponsons ('COBRA KING'; '' = none), codes: [division, unit] bumper codes, '^' draws the
//         armored-force triangle (['4^', '37^ C'] — 4th Armored, 37th Tank Bn, C Company; add the vehicle number once a
//         photo confirms it), stars: white stars in circles on the hull sides (true), seed: decal weathering, snow }
export function buildSherman(opts = {}) {
  const R = rng(opts.seed ?? 1944);
  const snowU = { value: clamp(opts.snow ?? 0, 0, 1) };
  const M = makeMaterials(snowU);
  const group = new THREE.Group(); group.name = 'sherman';
  const inst = [];

  // hull and everything fixed to it
  const HB = bucket(), bolts = [];
  buildHull(HB, bolts);
  meshesFrom(HB, M, group, null);
  {
    const bg = merge([drum(0.016, 0.016, 0, 0.011, 6), drum(0.016, 0.011, 0.011, 0.015, 6)]);
    const im = instanced(bg, M.bolt, bolts.length, 'sherman-bolts');
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qs = new THREE.Quaternion(), sc = V();
    bolts.forEach(([x, y, z, nx, ny, nz, s], i) => {
      q.setFromUnitVectors(V(0, 1, 0), V(nx, ny, nz).normalize());
      qs.setFromAxisAngle(V(0, 1, 0), R() * Math.PI / 3);
      im.setMatrixAt(i, m.compose(V(x, y, z), q.multiply(qs), sc.set(s, s, s)));
    });
    im.computeBoundingSphere();
    group.add(im);
  }

  // turret, gun, mast
  const turret = new THREE.Group(); turret.name = 'sherman-turret'; turret.position.set(0, D.tur.y, D.tur.z); group.add(turret);
  const gun = new THREE.Group(); gun.name = 'sherman-gun'; gun.position.set(0, D.trn.y, D.trn.z); turret.add(gun);
  const TB = bucket(), GB = bucket();
  buildTurret(TB, GB);
  meshesFrom(TB, M, turret, new THREE.Matrix4().makeTranslation(0, D.tur.y, D.tur.z));
  meshesFrom(GB, M, gun, new THREE.Matrix4().makeTranslation(0, D.tur.y + D.trn.y, D.tur.z + D.trn.z));
  const mast = new THREE.Group(); mast.name = 'sherman-mast'; mast.position.set(0.50, TROOF + 0.27, -0.98); turret.add(mast);
  {
    const mm = new THREE.Mesh(bake(prep(drum(0.0065, 0.0035, 0, 2.3, 5)), new THREE.Matrix4().makeTranslation(0.5, D.tur.y + TROOF + 0.27, D.tur.z - 0.98)), M.steel);
    mm.castShadow = true; mast.add(mm);
  }

  // running gear: wheels, sprockets, idlers, return rollers (instanced, turned by update)
  const TL = layoutTrack();
  const rw = roadWheelParts(), rr = rollerParts();
  const wheels = instanced(grouped(rw.rubber, rw.steel), [M.rubber, M.run], 12, 'sherman-roadwheels');
  const sprockets = instanced(sprocketParts(TL.rs), M.run, 2, 'sherman-sprockets');
  const idlers = instanced(idlerParts(), M.run, 2, 'sherman-idlers');
  const rollers = instanced(grouped(rr.rubber, rr.steel), [M.rubber, M.run], 6, 'sherman-rollers');
  // tracks: per side one InstancedMesh of rubber shoes, one of steel connectors / guides / duckbills
  const lp = linkParts(TL.p);
  const tracks = [1, -1].map((s) => ({
    s,
    rubber: instanced(s > 0 ? lp.rubber : mirrorX(lp.rubber), M.rubber, TL.N, 'sherman-track-rubber' + (s > 0 ? 'L' : 'R')),
    steel: instanced(s > 0 ? lp.steel : mirrorX(lp.steel), M.steel, TL.N, 'sherman-track-steel' + (s > 0 ? 'L' : 'R')),
  }));
  inst.push(wheels, sprockets, idlers, rollers, ...tracks.flatMap((k) => [k.rubber, k.steel]));
  inst.forEach((im) => group.add(im));

  // decals: stars, the name, bumper codes (front on the glacis applique, rear on the engine doors)
  const decalMat = (tex) => weather(plain({ map: tex, transparent: true, depthWrite: false, roughness: 0.82, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), snowU, { mudTop: 1.02, mudFade: 0.38, mud: 0.95, mottle: 0.15, dust: 0.3, snow: 1 });
  const decal = (mat, w, h, c, n, up) => {
    const N = V(...n).normalize(), U = V(...up).normalize(), Rt = U.clone().cross(N);
    const g = prep(new THREE.PlaneGeometry(w, h));
    g.applyMatrix4(new THREE.Matrix4().makeBasis(Rt, U, N).setPosition(V(...c).addScaledVector(N, 0.003)));
    const m = new THREE.Mesh(bake(g), mat); m.receiveShadow = true; m.renderOrder = 1;
    group.add(m);
  };
  const side = D.hw + 0.04;
  if (opts.stars ?? true) {
    const star = decalMat(starTexture(R));
    for (const s of [1, -1]) decal(star, 0.56, 0.56, [s * side, 1.5, -0.35], [s, 0, 0], [0, 1, 0]);
  }
  const label = opts.name ?? 'COBRA KING';
  if (label) {
    const nm = decalMat(textTexture(R, label, 1024, 160, 120));
    for (const s of [1, -1]) decal(nm, 1.28, 0.2, [s * side, 1.56, 1.02], [s, 0, 0], [0, 1, 0]);
  }
  const codes = opts.codes ?? ['4^', '37^ C'];
  if (codes && codes.length) {
    const [c0, c1] = codes.map((t) => decalMat(textTexture(R, t, 512, 160, 118)));
    const fr = (x) => gp(x, 0.17, 0.038);
    decal(c0, 0.44, 0.14, fr(-0.62), GL.N.toArray(), GL.U.toArray());         // viewer's left from the front
    decal(c1, 0.44, 0.14, fr(0.62), GL.N.toArray(), GL.U.toArray());
    const bk = (x) => rp(x, 0.52, 0.02);
    decal(c0, 0.44, 0.14, bk(0.47), RP.N.toArray(), RP.U.toArray());          // viewer's left from behind
    decal(c1, 0.44, 0.14, bk(-0.47), RP.N.toArray(), RP.U.toArray());
  }

  // ── motion ──
  const m4 = new THREE.Matrix4(), rx = new THREE.Matrix4(), A = [0, 0], B = [0, 0];
  const place = (im, i, x, y, z, ang) => im.setMatrixAt(i, m4.makeTranslation(x, y, z).multiply(rx.makeRotationX(ang)));
  function update(t = 0, s = {}) {
    const d = s.distance ?? 0;
    const yaw = s.turret ?? 0;
    turret.rotation.y = yaw;
    // -10 deg over the front and sides; over the engine deck the stowage stops the gun at +2 deg
    const kd = clamp((-0.2 - Math.cos(yaw)) / 0.45, 0, 1), minE = (-10 + 12 * kd * kd * (3 - 2 * kd)) * DEG;
    gun.rotation.x = -clamp(s.gun ?? 0, minE, 25 * DEG);
    snowU.value = clamp(s.snow ?? 0, 0, 1);
    let k = 0;
    for (const sx of [1, -1]) {
      for (const z of WHEEL_Z) place(wheels, k++, sx * D.trackX, D.wheelY, z, d / D.wheelR);
    }
    [1, -1].forEach((sx, i) => {
      place(sprockets, i, sx * D.trackX, D.spr.y, D.spr.z, d / TL.rs - TL.path.a0);
      place(idlers, i, sx * D.trackX, D.idl.y, D.idl.z, d / (D.idl.r + D.lk.inner));
      ROLLER_Z.forEach((z, j) => place(rollers, i * 3 + j, sx * D.trackX, D.rolY, z, d / D.rol.r));
    });
    for (const tr of tracks) {
      const x = tr.s * D.trackX;
      for (let i = 0; i < TL.N; i++) {
        const s0 = i * TL.p + d;
        TL.path.at(s0, A); TL.path.at(s0 + TL.p, B);
        let tz = B[0] - A[0], ty = B[1] - A[1];
        const l = Math.hypot(tz, ty) || 1; tz /= l; ty /= l;
        m4.set(1, 0, 0, x,
          0, tz, ty, (A[1] + B[1]) / 2,
          0, -ty, tz, (A[0] + B[0]) / 2,
          0, 0, 0, 1);
        tr.rubber.setMatrixAt(i, m4); tr.steel.setMatrixAt(i, m4);
      }
    }
    for (const im of inst) im.instanceMatrix.needsUpdate = true;
    // the whip antenna leans back and sways a little
    mast.rotation.x = -0.05 + 0.025 * Math.sin(t * 1.7) + 0.01 * Math.sin(t * 4.3 + 1.1);
    mast.rotation.z = 0.018 * Math.sin(t * 1.3 + 0.4) + 0.008 * Math.sin(t * 3.7);
  }
  update(0, { snow: snowU.value });
  inst.forEach((im) => im.computeBoundingSphere());
  const triangles = countTriangles(group);
  group.userData.triangles = triangles;
  return { group, update, turret, gun, materials: M, info: { triangles, links: TL.N, pitch: TL.p, loop: TL.path.L, sprocketR: TL.rs } };
}
