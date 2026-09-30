// vehicles.js — the Bastogne column, night of 18 December 1944: GMC CCKW-353 2½-ton 6×6 trucks (long wheelbase,
// open cab with canvas top and side curtains, front winch, steel cargo body with slatted racks) packed with standing
// troopers of the 101st Airborne, and a Willys MB jeep. Units metres, Y up, a vehicle's front is +Z, origin on the
// ground at its centre. Its LEFT (driver's) side is +X. Deterministic: every random choice comes from rng(seed).
//
//   buildTruck(o)   o = {load: 'troops'|'canvas'|'empty', lights, wet 0..1, mud, seed, winch, ring, crew}
//                   -> {group, update(t, {distance, steer}), anchors: {headlights: [L, R], taillights: [L, R]}, setLights, setWet}
//   buildConvoy(o)  o = {n, path: [[x,y,z]...], spacing, heightAt(x, z), load, lights, wet, seed}
//                   -> {group, update(t, {head}), anchors: {headlights: [{pos, dir}], taillights: [...], trucks: [...]}, length}
//   buildJeep(o)    o = {windscreen: 'up'|'folded', riders 0..4, lights, wet, seed}
//                   -> {group, update(t, {distance, steer}), anchors: {headlights: [L, R], taillights: [L, R]}}
// Anchor Object3Ds sit on the lamp lenses; a headlight's local +Z points along its beam (forward, aimed 1.5° down),
// a taillight's local +Z points backwards out of its lens. Convoy anchors are world-space {pos, dir} (same aims).
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxM } from './geom.js';
import { plain } from '../shared/materials.js';
import { rng, clamp, lerp, smooth } from '../shared/util.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const AIM_DOWN = 1.5 * Math.PI / 180;

// ── geometry helpers: everything becomes non-indexed {position, normal, uv} so any parts can be merged ─────────
function clean(g) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V3(1, 1, 1);
// place a geometry: rotation (Euler XYZ, radians) then translation
function place(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) g.applyMatrix4(_m4.makeRotationFromEuler(_e.set(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}
function mirrorX(g) {                    // mirrored copy across x = 0 (winding flipped back so faces stay outward)
  const m = clean(g.clone());
  const p = m.attributes.position, n = m.attributes.normal;
  for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); n.setX(i, -n.getX(i)); }
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, n, m.attributes.uv]) {
      const s = a.itemSize;
      for (let k = 0; k < s; k++) { const t = a.array[(i + 1) * s + k]; a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k]; a.array[(i + 2) * s + k] = t; }
    }
  }
  return m;
}
const box = (w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => place(clean(boxM(w, h, d)), x, y, z, rx, ry, rz);
// cylinder along an axis ('x' | 'y' | 'z'), centred at (x, y, z)
function cyl(r0, r1, len, axis, x = 0, y = 0, z = 0, seg = 12, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return clean(g);
}
// a rod between two points
function rod(a, b, r, seg = 6) {
  const A = new V3(...a), B = new V3(...b), len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  g.applyQuaternion(_q.setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize()));
  const m = A.add(B).multiplyScalar(0.5); g.translate(m.x, m.y, m.z);
  return clean(g);
}
function tube(pts, r, seg = 24, rs = 6, closed = false) {
  return clean(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new V3(...p)), closed), seg, r, rs, closed));
}
function sphere(r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 10, hs = 8) {
  const g = new THREE.SphereGeometry(r, ws, hs); g.scale(sx, sy, sz); g.translate(x, y, z); return clean(g);
}
function lathe(pts, seg = 16, phi0 = 0, phiLen = TAU) {
  return clean(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg, phi0, phiLen));
}
// a side profile [[z, y], ...] (closed polygon) extruded across x0..x1
function profileX(pts, x0, x1, bevel = 0) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0 - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
  // shape (u=z, v=y) extruded along +Z -> rotate so shape-u -> +Z, extrusion -> +X
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  g.translate(x0 + bevel, 0, 0);
  const c = clean(g);
  // the matrix above mirrors (det -1): flip winding
  const p = c.attributes.position, n = c.attributes.normal, uv = c.attributes.uv;
  for (let i = 0; i < p.count; i += 3) for (const a of [p, n, uv]) {
    const s2 = a.itemSize;
    for (let k = 0; k < s2; k++) { const t = a.array[(i + 1) * s2 + k]; a.array[(i + 1) * s2 + k] = a.array[(i + 2) * s2 + k]; a.array[(i + 2) * s2 + k] = t; }
  }
  // metre UVs on the sides: (z, y); on the extruded faces (x, along)
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i));
    if (nx > 0.7) uv.setXY(i, p.getZ(i), p.getY(i)); else uv.setXY(i, p.getX(i), p.getZ(i) + p.getY(i));
  }
  return c;
}
// sweep a closed cross-section [[x, h]] (x across the vehicle, h along the path normal) along a side path [[z, y]]
function sweepX(path, section, xOff = 0) {
  const pos = [], uv = [];
  const P = path.map(([z, y]) => new THREE.Vector2(z, y));
  const frames = P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const t = b.clone().sub(a).normalize();
    return { p, n: new THREE.Vector2(-t.y, t.x) };        // left normal of the (z, y) tangent: points "up / out"
  });
  let along = 0; const alongs = [0];
  for (let i = 1; i < P.length; i++) { along += P[i].distanceTo(P[i - 1]); alongs.push(along); }
  const S = section.length;
  const vtx = (i, j) => { const f = frames[i], [x, h] = section[j % S]; return [xOff + x, f.p.y + f.n.y * h, f.p.x + f.n.x * h]; };
  for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < S; j++) {
    const a = vtx(i, j), b = vtx(i + 1, j), c = vtx(i + 1, j + 1), d = vtx(i, j + 1);
    const u0 = alongs[i], u1 = alongs[i + 1], v0 = j * 0.1, v1 = (j + 1) * 0.1;
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return creased(g, 0.7);
}
const creased = (g, a = 0.6) => toCreasedNormals(g.index ? g.toNonIndexed() : g, a);
function flipWinding(g) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i += 3) for (const a of [p, n, uv]) {
    if (!a) continue;
    const s2 = a.itemSize;
    for (let k = 0; k < s2; k++) { const t = a.array[(i + 1) * s2 + k]; a.array[(i + 1) * s2 + k] = a.array[(i + 2) * s2 + k]; a.array[(i + 2) * s2 + k] = t; }
  }
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
// a quad in any plane: corners a, b, c, d (counter-clockwise seen from the front), uv rect [u0, v0, u1, v1]
function quad(a, b, c, d, uvr = [0, 0, 1, 1]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  const [u0, v0, u1, v1] = uvr;
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1], 2));
  g.computeVertexNormals();
  return g;
}

// parts collector: feature -> material key -> [geometries]
class Parts {
  constructor() { this.f = {}; }
  add(feature, key, ...gs) {
    const F = (this.f[feature] ??= {});
    (F[key] ??= []).push(...gs.map(clean));
  }
  merged() {
    const out = {};
    for (const [f, mats] of Object.entries(this.f)) {
      out[f] = {};
      for (const [k, list] of Object.entries(mats)) out[f][k] = list.length === 1 ? list[0] : mergeGeometries(list);
    }
    return out;
  }
}
function triCount(geo) { return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3; }

// ── materials ────────────────────────────────────────────────────────────────────────────────────────────────
// GLSL: object-space value noise for mud splashes and paint weathering
const NOISE_GLSL = /* glsl */`
vec3 vgrad(vec3 p) { p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return -1.0 + 2.0 * fract(sin(p) * 43758.5453); }
float gnoise(vec3 p) { vec3 i = floor(p), f = fract(p); vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(dot(vgrad(i), f), dot(vgrad(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                 mix(dot(vgrad(i + vec3(0,1,0)), f - vec3(0,1,0)), dot(vgrad(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(vgrad(i + vec3(0,0,1)), f - vec3(0,0,1)), dot(vgrad(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                 mix(dot(vgrad(i + vec3(0,1,1)), f - vec3(0,1,1)), dot(vgrad(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z); }
float vnoise(vec3 p) { return 0.5 + 0.7 * gnoise(p); }
float vfbm(vec3 p) { return 0.5 + 0.7 * (gnoise(p) * 0.6 + gnoise(p * 2.07 + 5.3) * 0.28 + gnoise(p * 4.3 + 1.7) * 0.12); }
`;
// kind: 'paint' | 'canvas' | 'tyre' | 'plain'. S = shared uniforms {uWet, uMud, uMudH}. Object-space position drives
// the mud (the vehicle's own frame, so the mud travels with it; instanced parts use their geometry space too).
function weather(m, kind, S) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uVWet = S.uWet; sh.uniforms.uVMud = S.uMud; sh.uniforms.uVMudH = S.uMudH;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVP = position;');
    const K = { paint: 0, canvas: 1, tyre: 2, plain: 3 }[kind];
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vVP; uniform float uVWet; uniform float uVMud; uniform float uVMudH;\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float vMudK = 0.0;
        { vec3 q = vVP;
          float n1 = vfbm(q * vec3(1.7, 4.2, 0.9));                 // streaks run along the vehicle
          float n2 = vfbm(q * vec3(6.0, 9.0, 3.0) + 3.1);
          float hh = q.y / uVMudH;
          float fade = smoothstep(0.0, 0.45, (1.0 - hh) * 1.15 + (n1 - 0.5) * 0.8);
          float speck = smoothstep(0.78, 0.9, vnoise(q * vec3(26.0, 34.0, 20.0))) * (1.0 - smoothstep(0.75, 1.3, hh)) * 0.8;
          ${K === 2 ? 'fade = 0.35 + 0.65 * n1; speck = 0.0;' : ''}
          vMudK = clamp(uVMud * max(fade * (0.5 + 0.5 * n2), speck), 0.0, 0.92);
          ${K === 1 ? 'vMudK *= 0.6;' : ''}
          ${K === 0 ? 'diffuseColor.rgb *= 0.92 + 0.16 * vfbm(q * vec3(0.9, 1.8, 0.9));' : ''}
          ${K === 1 ? 'diffuseColor.rgb *= 0.9 + 0.2 * vfbm(q * vec3(1.6, 2.8, 1.6));' : ''}
          vec3 mudC = mix(vec3(0.21, 0.175, 0.125), vec3(0.105, 0.085, 0.058), uVWet);
          diffuseColor.rgb = mix(diffuseColor.rgb, mudC, vMudK);
          diffuseColor.rgb *= 1.0 - uVWet * ${K === 1 ? '0.42' : K === 2 ? '0.25' : '0.3'}; }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, ${K === 1 ? '0.72' : K === 2 ? '0.42' : '0.24'}, uVWet * (1.0 - vMudK * 0.35));
        roughnessFactor = mix(roughnessFactor, mix(0.95, 0.5, uVWet), vMudK * 0.8);`);
  };
  const key = m.customProgramCacheKey() + '|vweather' + kind;
  m.customProgramCacheKey = () => key;
  return m;
}

// decal rows: the atlas holds one row per vehicle number; instanced decals pick their row by an instance attribute
function decalRows(m, rows) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRow; uniform float uRow;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
        { float row = uRow;
        #ifdef USE_INSTANCING
          row += aRow;
        #endif
          vMapUv.y = (vMapUv.y + ${(rows - 1).toFixed(1)} - mod(row, ${rows.toFixed(1)})) / ${rows.toFixed(1)}; }
        #endif`);
    sh.uniforms.uRow = m.userData.uRow;
  };
  m.userData.uRow = { value: 0 };
  const key = m.customProgramCacheKey() + '|vrows' + rows;
  m.customProgramCacheKey = () => key;
  return m;
}

const PAL = {
  od: 0x484831, odDark: 0x33342A, canvas: 0x6E6849, canvasTop: 0x7A7250, tyre: 0x1A1A19, black: 0x141413,
  steel: 0x3A3C3A, wood: 0x51502F, coat: 0x4E4A35, coat2: 0x5A5238, coat3: 0x453F2E, helmet: 0x3E4130, skin: 0xCFC8BC,
  rifle: 0x3B2A1E, webbing: 0x6B6446, glass: 0x1E2426, lamp: 0xFFE6BE,
};
export function vehicleMaterials(o = {}) {
  const S = { uWet: { value: 0 }, uMud: { value: 0 }, uMudH: { value: o.mudH ?? 1.1 } };
  const W = (m, kind) => weather(m, kind, S);
  const M = {
    S,
    od: W(plain({ color: PAL.od, roughness: 0.78, metalness: 0.12, envMapIntensity: 0.8 }), 'paint'),
    odDark: W(plain({ color: PAL.odDark, roughness: 0.85, metalness: 0.15, envMapIntensity: 0.6 }), 'paint'),
    canvas: W(plain({ color: PAL.canvas, roughness: 0.95, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide }), 'canvas'),
    canvasTop: W(plain({ color: PAL.canvasTop, roughness: 0.95, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide }), 'canvas'),
    tyre: W(plain({ color: PAL.tyre, roughness: 0.88, metalness: 0, envMapIntensity: 0.5 }), 'tyre'),
    black: plain({ color: PAL.black, roughness: 0.7, metalness: 0.1 }),
    steel: plain({ color: PAL.steel, roughness: 0.45, metalness: 0.75 }),
    wood: W(plain({ color: PAL.wood, roughness: 0.82, metalness: 0 }), 'paint'),
    glass: plain({ color: PAL.glass, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.32, depthWrite: false, envMapIntensity: 1.4, side: THREE.DoubleSide }),
    celluloid: plain({ color: 0x2A2C24, roughness: 0.18, metalness: 0, envMapIntensity: 1.1, side: THREE.DoubleSide }),
    lens: plain({ color: 0x9A9A94, roughness: 0.08, metalness: 0.2, emissive: new THREE.Color(PAL.lamp), emissiveIntensity: 0, envMapIntensity: 1.2 }),
    reflector: plain({ color: 0x8C8C88, roughness: 0.25, metalness: 0.9 }),
    tail: plain({ color: 0x4A0A06, roughness: 0.2, metalness: 0, emissive: new THREE.Color(1.0, 0.08, 0.03), emissiveIntensity: 0 }),
    marker: plain({ color: 0x3A3A36, roughness: 0.3, metalness: 0.2, emissive: new THREE.Color(1.0, 0.72, 0.4), emissiveIntensity: 0 }),
    coat: plain({ color: PAL.coat, roughness: 0.96, metalness: 0 }),
    helmet: plain({ color: PAL.helmet, roughness: 0.72, metalness: 0.08 }),
    skin: plain({ color: PAL.skin, roughness: 0.6, metalness: 0 }),
    rifle: plain({ color: PAL.rifle, roughness: 0.7, metalness: 0 }),
    webbing: plain({ color: PAL.webbing, roughness: 0.95, metalness: 0 }),
  };
  M.decal = decalRows(plain({ color: 0xE4E0D2, map: markingsTexture().tex, roughness: 0.75, metalness: 0, alphaTest: 0.45 }), MARK_ROWS);
  M.star = plain({ color: 0xE4E0D2, map: starTexture(), roughness: 0.75, metalness: 0, alphaTest: 0.45 });
  M.setWet = (w, mud) => {
    w = clamp(w ?? 0); S.uWet.value = w; S.uMud.value = clamp(mud ?? (0.3 + 0.7 * w));
    for (const k of ['coat', 'helmet', 'webbing']) {
      const base = new THREE.Color(PAL[k]); M[k].color.copy(base).multiplyScalar(1 - 0.28 * w);
      M[k].roughness = k === 'helmet' ? lerp(0.72, 0.3, w) : lerp(0.96, 0.8, w);
    }
    M.star.color.setHex(0xE4E0D2).multiplyScalar(1 - 0.2 * w); M.decal.color.copy(M.star.color);
    M.star.roughness = M.decal.roughness = lerp(0.75, 0.3, w);
  };
  M.setLights = (on, k = 1) => {
    M.lens.emissiveIntensity = on ? 24 * k : 0;
    M.lens.color.setHex(on ? 0xFFF4E0 : 0x9A9A94);
    M.tail.emissiveIntensity = on ? 9 * k : 0;
    M.marker.emissiveIntensity = on ? 0 : 0;
  };
  M.setWet(o.wet ?? 0, o.mud);
  M.setLights(!!o.lights);
  return M;
}

// ── markings: bumper codes and hood registration numbers, one atlas row per vehicle ────────────────────────────
const MARK_ROWS = 16;
let _marks = null;
function markingsTexture() {
  if (_marks) return _marks;
  const W = 1024, RH = 64, H = RH * MARK_ROWS;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const R = rng(1944);
  const companies = ['3616Q', '3858Q', '3683Q', '4042Q', '3916Q', '3581Q', '3998Q', '4088Q'];
  const rows = [];
  g.fillStyle = '#fff'; g.textBaseline = 'middle';
  const text = (s, x0, x1, y, size) => {
    g.save(); g.font = `bold ${size}px Arial, Helvetica, sans-serif`;
    const w = g.measureText(s).width, sx = Math.min(0.82, (x1 - x0) / w);
    g.translate((x0 + x1) / 2 - w * sx / 2, y); g.scale(sx, 1); g.fillText(s, 0, 0); g.restore();
  };
  for (let r = 0; r < MARK_ROWS; r++) {
    const y = r * RH + RH / 2 + 2;
    const co = companies[r % companies.length], num = 1 + Math.floor(R() * 48);
    const reg = '4' + String(Math.floor(R() * 1e6)).padStart(6, '0');
    // rows 0..11: CCKW trucks of COM Z quartermaster truck companies; rows 12..15: 101st Airborne jeeps
    const jeep = r >= 12;
    const left = jeep ? '101 AB' : 'COM Z';
    const right = jeep ? `${['327', '501', '502', '506'][r - 12]}-HQ-${num % 12 + 1}` : `${co}-${num}`;
    const regN = jeep ? '20' + String(Math.floor(R() * 1e6)).padStart(6, '0') : reg;
    rows.push({ left, right, reg: regN });
    text(left, 6, 250, y, 50);                 // u 0.00..0.25   bumper, read first (viewer's left = vehicle's right, -X)
    text(right, 262, 506, y, 50);              // u 0.25..0.50   bumper, unit code (vehicle's left, +X)
    text(`USA ${regN}`, 518, 1018, y, 46);     // u 0.50..1.00   hood sides
  }
  // stencil gaps and worn paint
  const id = g.getImageData(0, 0, W, H), d = id.data;
  for (let i = 0; i < W * H; i++) {
    if (d[i * 4 + 3] === 0) continue;
    const x = i % W, yy = (i / W) | 0;
    const wear = R();
    if (wear < 0.05 || ((x * 7 + yy * 13) % 97 === 0)) d[i * 4 + 3] = 0;
  }
  g.putImageData(id, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  _marks = { tex, rows, W, H };
  return _marks;
}
let _star = null;
function starTexture() {                      // u 0..0.5: star in a ring (hood), u 0.5..1: plain star (doors, tailgate)
  if (_star) return _star;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const star = (cx, cy, r) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.382 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  };
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  star(128, 128, 96); g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 116, 0, TAU); g.stroke();
  star(384, 134, 118);
  const id = g.getImageData(0, 0, 512, 256), d = id.data, R = rng(7);
  for (let i = 0; i < 512 * 256; i++) if (d[i * 4 + 3] > 0 && R() < 0.035) d[i * 4 + 3] = 0;
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  _star = t;
  return t;
}

// ── wheels ───────────────────────────────────────────────────────────────────────────────────────────────────
// bias-ply military tyre with the non-directional (NDT) lug tread, axis along X, outer face +X, centred at 0.
function tyreGeo(R, W, rb, lugs = 18, seg = 72, lugH = 0.016) {
  const hw = W / 2, dr = R - rb;
  const prof = [[-hw * 0.84, rb], [-hw * 1.04, rb + dr * 0.4], [-hw, R - dr * 0.2], [-hw * 0.8, R - dr * 0.075], [-hw * 0.55, R - 0.004], [-hw * 0.18, R],
    [hw * 0.18, R], [hw * 0.55, R - 0.004], [hw * 0.8, R - dr * 0.075], [hw, R - dr * 0.2], [hw * 1.04, rb + dr * 0.4], [hw * 0.84, rb]];
  const np = prof.length, pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const th = i / seg * TAU, c = Math.cos(th), s = Math.sin(th);
    for (let j = 0; j < np; j++) {
      const [x, r] = prof[j];
      const ax = Math.abs(x) / hw;
      let lug = 0;
      if (ax <= 0.81) {
        const ph = th * lugs / TAU + (x >= 0 ? 0.5 : 0) + ax * 0.32;
        const f = ph - Math.floor(ph);
        if (f < 0.52) lug = lugH * (ax < 0.6 ? 1 : 0.65);
      }
      const rr = r + lug;
      pos.push(x, rr * c, rr * s);
      uv.push(x, th * R);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < np - 1; j++) {
    const a = i * np + j, b = (i + 1) * np + j, c = i * np + j + 1, d = (i + 1) * np + j + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return clean(g);
}
// disc wheel: a lathe profile [r, axial] traced from the flange inward (visible side +axial), nuts on the bolt circle
function rimGeo(prof, nuts = 10, nutR = 0.122, nutY = 0.05, seg = 28) {
  const parts = [lathe(prof, seg)];
  for (let k = 0; k < nuts; k++) {
    const a = k / nuts * TAU;
    parts.push(cyl(0.013, 0.013, 0.03, 'y', Math.cos(a) * nutR, nutY + 0.012, Math.sin(a) * nutR, 6));
  }
  const back = lathe([[0.001, prof[0][1] - 0.02], [Math.max(0.05, prof[0][0] - 0.02), prof[0][1] - 0.02]], seg);   // faces inward
  parts.push(back);
  const g = mergeGeometries(parts);
  g.rotateZ(-Math.PI / 2);                      // lathe axis +Y -> +X
  return g;
}
const RIM20 = [[0.268, 0.075], [0.262, 0.092], [0.25, 0.094], [0.24, 0.08], [0.228, 0.045], [0.2, 0.032], [0.15, 0.03], [0.132, 0.048],
  [0.112, 0.052], [0.102, 0.105], [0.082, 0.112], [0.076, 0.15], [0.001, 0.156]];
const scaleProf = (p, sr, sy, dy = 0) => p.map(([r, y]) => [r * sr, y * sy + dy]);
// {tyre, rim} geometries for a single or dual wheel (axis X, outer face +X)
function wheelSet(kind) {
  if (kind === 'cckwF' || kind === 'cckwSpare') {
    return { tyre: tyreGeo(0.466, 0.19, 0.262), od: rimGeo(RIM20) };
  }
  if (kind === 'cckwR') {
    const t1 = tyreGeo(0.466, 0.19, 0.262); t1.translate(0.125, 0, 0);
    const t2 = tyreGeo(0.466, 0.19, 0.262); t2.rotateX(0.17); t2.translate(-0.125, 0, 0);
    const rim = rimGeo(scaleProf(RIM20, 1, 0.72), 10, 0.122, 0.036); rim.translate(0.125, 0, 0);
    const inner = lathe([[0.001, 0], [0.25, 0]], 20); inner.rotateZ(-Math.PI / 2); inner.translate(-0.215, 0, 0);
    return { tyre: mergeGeometries([t1, t2]), od: mergeGeometries([rim, inner]) };
  }
  if (kind === 'jeep') {
    const prof = scaleProf(RIM20, 0.8, 0.8);
    return { tyre: tyreGeo(0.362, 0.16, 0.205, 15, 60, 0.013), od: rimGeo(prof, 5, 0.095, 0.04, 24) };
  }
  throw new Error('wheel kind ' + kind);
}

// ── GMC CCKW-353 ─────────────────────────────────────────────────────────────────────────────────────────────
// layout (m): front axle z = +2.193, bogie centre -1.973 (wheelbase 4.166 = 164 in), rear axles -1.414 / -2.532
// (bogie 44 in), front track 1.59, rear 1.73 (dual centres), 7.50-20 tyres r 0.466 on hubs at 0.455; winch bumper
// face +3.433, tailgate -3.423 (overall 6.86 m), body 2.235 wide, floor 1.12, sides 1.56, racks 2.08, bows 2.77.
export const CCKW = {
  zF: 2.193, zB: -1.973, zR1: -1.414, zR2: -2.532, wb: 4.166, wr: 0.455, R: 0.466, trF: 0.795, trR: 0.865,
  bedZ0: -3.423, bedZ1: 0.237, bedY: 1.12, bedW: 1.117, sideTop: 1.56, rackTop: 2.08,
  lamp: [0.6, 1.24, 2.845], tail: [0.93, 0.93, -3.47], length: 6.866, width: 2.235,
};
const hoodTopAt = (x, z) => {
  const ax = Math.abs(x);
  const pts = [[0, 1.59], [0.2, 1.585], [0.36, 1.57], [0.42, 1.54], [0.44, 1.5]];
  let y = pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) if (ax >= pts[i][0] && ax <= pts[i + 1][0]) { y = lerp(pts[i][1], pts[i + 1][1], (ax - pts[i][0]) / (pts[i + 1][0] - pts[i][0])); break; }
  return y - 0.05 * clamp((z - 1.4) / 1.36);
};
// a decal that hugs the hood top: centre (x, z), size, star texture region u0..u1
function hoodDecal(cx, cz, size, u0, u1) {
  const n = 8, pos = [], uv = [];
  const P = (i, j) => { const x = cx + (0.5 - i / n) * size, z = cz + (j / n - 0.5) * size; return [x, hoodTopAt(x, z) + 0.004, z]; };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    const ua = lerp(u0, u1, i / n), ub = lerp(u0, u1, (i + 1) / n), va = j / n, vb = (j + 1) / n;
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(ua, va, ub, va, ub, vb, ua, va, ub, vb, ua, vb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return creased(g, 1.0);
}

// a 20-litre jerrycan: 0.345 long, 0.165 thick, 0.47 tall, pressed X on the flanks, three handles on top
function jerrycan(x, y0, z, ry = 0) {
  const parts = [box(0.165, 0.43, 0.345, 0, 0.215, 0), box(0.15, 0.04, 0.33, 0, 0.45, 0), box(0.172, 0.012, 0.35, 0, 0.215, 0)];
  for (const dz of [-0.07, 0, 0.07]) parts.push(box(0.03, 0.035, 0.03, 0, 0.485, dz));
  parts.push(box(0.03, 0.02, 0.2, 0, 0.5, 0), cyl(0.022, 0.022, 0.04, 'y', 0, 0.48, 0.13, 8));
  for (const s of [1, -1]) { parts.push(place(box(0.006, 0.02, 0.44), s * 0.085, 0.215, 0, 0.93, 0, 0), place(box(0.006, 0.02, 0.44), s * 0.085, 0.215, 0, -0.93, 0, 0)); }
  return parts.map((g) => place(g, x, y0, z, 0, ry, 0));
}
function cckwKit(o = {}) {
  const P = new Parts();
  const K = CCKW;
  const winch = o.winch !== false;
  const add = (key, ...g) => P.add('base', key, ...g);
  const both = (key, g) => { add(key, g, mirrorX(g)); };
  // ── chassis ──
  const frameFront = winch ? 3.30 : 3.02;
  const fl = frameFront + 3.40;
  both('odDark', box(0.075, 0.22, fl, 0.42, 0.77, frameFront - fl / 2));                 // frame rails
  for (const z of [2.85, 1.25, 0.25, -0.95, -1.973, -3.3]) add('odDark', box(0.84, 0.13, 0.1, 0, 0.75, z));
  // front axle, diff, knuckles, springs
  add('odDark', cyl(0.055, 0.055, 1.44, 'x', 0, K.wr, K.zF, 10), sphere(0.16, 0.12, 0.44, K.zF, 1, 0.95, 0.85, 12, 8));
  both('odDark', cyl(0.075, 0.075, 0.2, 'y', 0.69, K.wr, K.zF, 10));
  for (const [len, dy] of [[1.3, 0], [1.1, -0.018], [0.85, -0.036]]) both('odDark', box(0.07, 0.018, len, 0.42, 0.575 + dy, K.zF));
  both('odDark', box(0.05, 0.12, 0.05, 0.42, 0.63, K.zF + 0.66), box(0.05, 0.12, 0.05, 0.42, 0.63, K.zF - 0.66));
  // rear axles with differentials, bogie springs and trunnion, torque rods
  for (const z of [K.zR1, K.zR2]) {
    add('odDark', cyl(0.06, 0.06, 1.56, 'x', 0, K.wr, z, 10), sphere(0.17, 0, 0.44, z, 1, 0.95, 0.8, 12, 8), cyl(0.07, 0.05, 0.22, 'z', 0, 0.44, z + (z === K.zR1 ? 0.2 : 0.2), 8));
  }
  for (let k = 0; k < 6; k++) {
    const len = 1.28 - k * 0.15;
    const leaf = box(0.075, 0.014, len, 0.53, 0.575 + k * 0.016, K.zB);
    const p = leaf.attributes.position;             // inverted spring: ends curl down onto the axles
    for (let i = 0; i < p.count; i++) { const dz = (p.getZ(i) - K.zB) / 0.64; p.setY(i, p.getY(i) - 0.06 * dz * dz); }
    leaf.computeVertexNormals();
    both('odDark', leaf);
  }
  both('odDark', cyl(0.07, 0.07, 0.2, 'x', 0.5, 0.66, K.zB, 10), box(0.1, 0.24, 0.26, 0.45, 0.76, K.zB));
  for (const z of [K.zR1, K.zR2]) both('odDark', rod([0.36, 0.78, K.zB], [0.3, 0.5, z], 0.025));
  // drive line: transmission, transfer case, shafts, engine sump, radiator
  add('odDark', box(0.34, 0.32, 0.55, 0, 0.78, 1.15), box(0.4, 0.3, 0.4, 0, 0.56, 0.72), box(0.5, 0.42, 1.2, 0, 0.9, 2.05));
  add('steel', rod([0, 0.52, 0.95], [0.1, 0.46, K.zF - 0.2], 0.035), rod([0, 0.52, 0.5], [0, 0.46, K.zR1 + 0.25], 0.035), rod([0, 0.46, K.zR1 - 0.2], [0, 0.46, K.zR2 + 0.25], 0.035));
  add('black', box(0.7, 0.72, 0.1, 0, 1.14, 2.66));
  add('odDark', cyl(0.08, 0.08, 0.7, 'z', -0.3, 0.56, 0.45, 10), rod([-0.3, 0.56, 0.1], [-0.72, 0.5, -0.2], 0.03));
  // fuel tank (right) and spare wheel lying flat (left), both under the front of the body
  add('od', cyl(0.2, 0.2, 0.95, 'z', -0.78, 0.74, -0.33, 14));
  for (const z of [-0.6, -0.06]) add('odDark', box(0.46, 0.03, 0.04, -0.78, 0.53, z), box(0.03, 0.4, 0.04, -0.55, 0.74, z));
  {
    const sp = wheelSet('cckwSpare');
    for (const [key, g0] of Object.entries(sp)) { const g = g0.clone(); g.rotateZ(-Math.PI / 2); g.translate(0.57, 0.555, -0.37); add(key, g); }
    for (const z of [-0.62, -0.12]) add('odDark', box(1.0, 0.035, 0.05, 0.57, 0.445, z), box(0.035, 0.24, 0.05, 1.05, 0.56, z));
  }
  // ── front: bumper (with winch), grille, hood, fenders, lamps ──
  if (winch) {
    add('od', box(2.06, 0.27, 0.15, 0, 0.665, 3.357));
    both('odDark', box(0.1, 0.34, 0.5, 0.36, 0.72, 3.07));
    add('odDark', cyl(0.12, 0.12, 0.5, 'x', 0, 0.8, 3.08, 14), cyl(0.18, 0.18, 0.025, 'x', 0.26, 0.8, 3.08, 16), cyl(0.18, 0.18, 0.025, 'x', -0.26, 0.8, 3.08, 16));
    add('steel', cyl(0.14, 0.14, 0.48, 'x', 0, 0.8, 3.08, 16));
    add('odDark', box(0.26, 0.26, 0.3, 0.43, 0.8, 3.08));
    for (const s of [1, -1]) add('steel', tube([[s * 0.52, 0.6, 3.44], [s * 0.52, 0.52, 3.52], [s * 0.52, 0.66, 3.56], [s * 0.52, 0.74, 3.48], [s * 0.52, 0.72, 3.44]], 0.022, 12, 6));
  } else {
    add('od', box(2.06, 0.23, 0.14, 0, 0.665, 3.0));
    for (const s of [1, -1]) add('steel', tube([[s * 0.44, 0.6, 3.07], [s * 0.44, 0.55, 3.16], [s * 0.44, 0.68, 3.2], [s * 0.44, 0.76, 3.12], [s * 0.44, 0.74, 3.07]], 0.022, 12, 6));
  }
  const bumperZ = winch ? 3.433 : 3.071;
  // bumper codes: vehicle's left (+X) first code, right (-X) unit code; rows picked per vehicle
  const bz = bumperZ + 0.004;
  P.add('base', 'decal', quad([-1.0, 0.585, bz], [-0.3, 0.585, bz], [-0.3, 0.745, bz], [-1.0, 0.745, bz], [0, 0, 0.25, 1]));
  P.add('base', 'decal', quad([0.3, 0.585, bz], [1.0, 0.585, bz], [1.0, 0.745, bz], [0.3, 0.745, bz], [0.25, 0, 0.5, 1]));
  // grille guard: frame + 11 vertical bars, the radiator shell behind
  add('od', box(0.06, 0.74, 0.07, 0.35, 1.15, 2.79), box(0.06, 0.74, 0.07, -0.35, 1.15, 2.79), box(0.76, 0.07, 0.07, 0, 1.5, 2.79), box(0.76, 0.06, 0.07, 0, 0.8, 2.79));
  for (let k = 0; k < 11; k++) add('od', box(0.022, 0.66, 0.03, -0.3 + k * 0.06, 1.15, 2.8));
  add('od', box(0.8, 0.8, 0.05, 0, 1.14, 2.73));
  // hood: crowned section extruded from the cowl (1.40) to the grille (2.77), top dropping 5 cm to the front
  {
    const sec = [[0.45, 1.08], [0.45, 1.44], [0.44, 1.5], [0.42, 1.54], [0.36, 1.57], [0.2, 1.585], [0, 1.59], [-0.2, 1.585], [-0.36, 1.57], [-0.42, 1.54], [-0.44, 1.5], [-0.45, 1.44], [-0.45, 1.08]];
    const s = new THREE.Shape(); s.moveTo(sec[0][0], sec[0][1]); for (const p of sec.slice(1)) s.lineTo(p[0], p[1]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.37, bevelEnabled: false, curveSegments: 2 }); g.translate(0, 0, 1.4);
    const c = clean(g), p = c.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - (p.getY(i) > 1.2 ? 0.05 * clamp((p.getZ(i) - 1.4) / 1.36) : 0));
    add('od', creased(c, 0.5), rod([0, 1.592, 1.42], [0, 1.545, 2.76], 0.012, 5));
    for (let k = 0; k < 7; k++) both('odDark', place(box(0.016, 0.02, 0.32, 0.456, 1.2 + k * 0.035, 1.74), 0, 0, 0, 0, 0, 0));      // louvres
    // registration number on both hood sides
    const y0 = 1.3, y1 = 1.38, z0 = 1.62, z1 = 2.52, x = 0.455;
    P.add('base', 'decal', quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], [0.5, 0, 1, 1]));
    P.add('base', 'decal', quad([-x, y0, z0], [-x, y0, z1], [-x, y1, z1], [-x, y1, z0], [0.5, 0, 1, 1]));
    P.add('base', 'star', hoodDecal(0, 2.06, 0.6, 0, 0.5));
  }
  // inner aprons between hood and fenders
  both('odDark', box(0.02, 0.3, 1.34, 0.47, 0.97, 2.08));
  // front fenders: a crowned shell swept over the wheel, from the running board to the bumper
  {
    const path = [[1.28, 0.745], [1.38, 0.8], [1.5, 0.9], [1.62, 0.99], [1.78, 1.07], [1.98, 1.12], [2.2, 1.14], [2.42, 1.135], [2.62, 1.115], [2.8, 1.08], [2.93, 1.03], [3.01, 0.96], [3.055, 0.87], [3.065, 0.79]];
    const sec = [[0.46, 0], [0.56, 0.018], [0.76, 0.028], [0.93, 0.02], [0.99, 0.0], [1.018, -0.05], [1.03, -0.13], [1.032, -0.22], [1.014, -0.22], [1.01, -0.13], [0.998, -0.055], [0.97, -0.016], [0.76, 0.008], [0.56, -0.002], [0.46, -0.02]];
    both('od', sweepX(path, sec));
    // running boards with brackets, jerrycans in their holders at the rear end
    both('od', box(0.3, 0.03, 1.0, 0.96, 0.735, 0.79));
    both('odDark', box(0.06, 0.2, 0.04, 0.84, 0.64, 1.1), box(0.06, 0.2, 0.04, 0.84, 0.64, 0.45));
    for (const g of jerrycan(0.965, 0.75, 0.465, 0)) both('od', g);
    both('odDark', box(0.2, 0.02, 0.38, 0.965, 0.755, 0.465), box(0.02, 0.36, 0.03, 1.07, 0.93, 0.3), box(0.02, 0.36, 0.03, 1.07, 0.93, 0.63), box(0.02, 0.03, 0.36, 1.072, 1.1, 0.465));
  }
  // headlamps on the fenders beside the grille, with a hoop guard, blackout markers on top; blackout drive lamp (left)
  const lampParts = (s) => {
    const [lx, ly, lz] = K.lamp; const x = s * lx;
    add('od', lathe([[0.001, -0.12], [0.06, -0.115], [0.095, -0.08], [0.105, -0.03], [0.108, 0.0]].map(([r, y]) => [r, y]), 16).rotateX(Math.PI / 2).translate(x, ly, lz - 0.01));
    add('od', cyl(0.112, 0.112, 0.025, 'z', x, ly, lz - 0.008, 16, true));
    add('lens', cyl(0.097, 0.097, 0.012, 'z', x, ly, lz - 0.004, 16));
    add('od', rod([x, ly - 0.08, lz - 0.08], [x, 1.1, lz - 0.1], 0.02));
    add('steel', tube([[x - 0.13, 1.1, lz - 0.1], [x - 0.13, ly + 0.02, lz + 0.05], [x, ly + 0.14, lz + 0.08], [x + 0.13, ly + 0.02, lz + 0.05], [x + 0.13, 1.1, lz - 0.1]], 0.009, 16, 5));
    add('od', box(0.07, 0.055, 0.08, x, ly + 0.14, lz - 0.05));
    add('marker', box(0.045, 0.018, 0.004, x, ly + 0.14, lz - 0.008));
  };
  lampParts(1); lampParts(-1);
  add('od', cyl(0.07, 0.07, 0.1, 'z', 0.86, 1.23, 2.5, 12), box(0.15, 0.02, 0.12, 0.86, 1.3, 2.53), rod([0.86, 1.16, 2.47], [0.86, 1.12, 2.47], 0.015));
  add('marker', box(0.1, 0.012, 0.004, 0.86, 1.22, 2.553));
  // ── cab: cowl, doors, rear panel, seat, dash, wheel, windscreen, canvas top and curtains, mirrors ──
  add('od', box(1.68, 0.1, 0.12, 0, 1.585, 1.37));                               // cowl top / scuttle
  both('od', profileX([[1.42, 0.9], [1.42, 1.6], [1.32, 1.64], [1.3, 0.78], [1.34, 0.76]], 0.44, 0.84));   // cowl flanks
  both('od', profileX([[1.3, 0.8], [1.3, 1.635], [0.66, 1.635], [0.6, 1.6], [0.58, 1.52], [0.58, 0.8]], 0.8, 0.84));   // doors
  both('od', profileX([[0.58, 0.8], [0.58, 1.78], [0.28, 1.78], [0.28, 0.8]], 0.8, 0.84));                  // rear quarters
  both('steel', box(0.02, 0.02, 0.1, 0.85, 1.52, 1.18));
  add('od', box(1.68, 0.98, 0.04, 0, 1.29, 0.3), box(1.64, 0.04, 1.1, 0, 0.9, 0.85));
  add('canvas', box(1.5, 0.12, 0.48, 0, 1.16, 0.74), place(box(1.5, 0.52, 0.1, 0, 0, 0), 0, 1.48, 0.4, -0.18, 0, 0));
  add('odDark', box(1.6, 0.26, 0.1, 0, 1.44, 1.3));
  add('black', place(clean(new THREE.TorusGeometry(0.23, 0.014, 6, 24)), 0.4, 1.6, 1.0, -0.95, 0, 0), rod([0.4, 1.6, 1.0], [0.4, 1.05, 1.36], 0.022));
  // windscreen: two panes in a flat frame on the scuttle
  {
    const zw = 1.395, y0 = 1.64, y1 = 2.13, xw = 0.815;
    add('od', box(1.68, 0.05, 0.05, 0, y1, zw), box(1.68, 0.05, 0.05, 0, y0 + 0.02, zw), box(0.05, y1 - y0, 0.05, xw, (y0 + y1) / 2, zw), box(0.05, y1 - y0, 0.05, -xw, (y0 + y1) / 2, zw), box(0.035, y1 - y0, 0.04, 0, (y0 + y1) / 2, zw));
    add('glass', quad([0.79, y0 + 0.045, zw], [0.02, y0 + 0.045, zw], [0.02, y1 - 0.025, zw], [0.79, y1 - 0.025, zw]), quad([-0.02, y0 + 0.045, zw], [-0.79, y0 + 0.045, zw], [-0.79, y1 - 0.025, zw], [-0.02, y1 - 0.025, zw]));
    // mirrors on arms
    for (const s of [1, -1]) { add('steel', rod([s * 0.84, 1.98, zw], [s * 1.1, 2.02, zw - 0.08], 0.012)); add('black', cyl(0.075, 0.075, 0.02, 'z', s * 1.12, 2.02, zw - 0.09, 14)); }
  }
  // canvas top: crowned, sagging between three bows, valance down the sides
  {
    const nx = 10, nz = 12, x0 = -0.87, x1 = 0.87, z0 = 0.26, z1 = 1.43, pos = [], uv = [];
    const Y = (x, z) => { const u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0); const edge = Math.min(u, 1 - u); return 2.155 + 0.035 * Math.sin(Math.PI * u) - 0.018 * Math.pow(Math.sin(v * Math.PI * 2), 2) * Math.sin(Math.PI * u) - (edge < 0.04 ? (0.04 - edge) * 1.8 : 0); };
    const V = (i, j) => { const x = lerp(x0, x1, i / nx), z = lerp(z0, z1, j / nz); return [x, Y(x, z), z]; };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
      pos.push(...a, ...c, ...b, ...a, ...d, ...c);
      uv.push(a[0], a[2], c[0], c[2], b[0], b[2], a[0], a[2], d[0], d[2], c[0], c[2]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    add('canvasTop', creased(g, 1.0));
    // side curtains with celluloid windows, rear curtain
    for (const s of [1, -1]) {
      const x = s * 0.845;
      const q = s > 0 ? quad([x, 1.62, 1.38], [x, 1.62, 0.28], [x, 2.12, 0.28], [x, 2.12, 1.38]) : quad([x, 1.62, 0.28], [x, 1.62, 1.38], [x, 2.12, 1.38], [x, 2.12, 0.28]);
      add('canvas', q);
      const xw = s * 0.852;
      add('celluloid', s > 0 ? quad([xw, 1.7, 1.3], [xw, 1.7, 0.5], [xw, 2.06, 0.5], [xw, 2.06, 1.3]) : quad([xw, 1.7, 0.5], [xw, 1.7, 1.3], [xw, 2.06, 1.3], [xw, 2.06, 0.5]));
      add('steel', rod([s * 0.845, 2.14, 0.3], [s * 0.845, 1.62, 0.3], 0.012), rod([s * 0.845, 2.14, 1.4], [s * 0.845, 1.64, 1.38], 0.012));
    }
    add('canvas', quad([0.85, 1.76, 0.275], [-0.85, 1.76, 0.275], [-0.85, 2.14, 0.275], [0.85, 2.14, 0.275]));
  }
  // door stars
  P.add('base', 'star', quad([0.846, 1.02, 1.12], [0.846, 1.02, 0.78], [0.846, 1.36, 0.78], [0.846, 1.36, 1.12], [0.5, 0, 1, 1]));
  P.add('base', 'star', quad([-0.846, 1.02, 0.78], [-0.846, 1.02, 1.12], [-0.846, 1.36, 1.12], [-0.846, 1.36, 0.78], [0.5, 0, 1, 1]));
  // ── cargo body: floor, sills, steel sides with ribs, headboard, tailgate, stake pockets, slatted racks ──
  {
    const z0 = K.bedZ0, z1 = K.bedZ1, zc = (z0 + z1) / 2, L = z1 - z0, W = K.bedW;
    add('od', box(2.2, 0.05, L, 0, 1.095, zc));
    both('odDark', box(0.1, 0.12, L, 0.45, 1.0, zc));
    for (let k = 0; k < 8; k++) add('odDark', box(2.18, 0.06, 0.07, 0, 1.04, z0 + 0.2 + k * (L - 0.4) / 7));
    both('od', box(0.03, 0.58, L, W - 0.015, 1.28, zc));
    both('od', box(0.06, 0.05, L + 0.02, W - 0.02, 1.565, zc));
    const nr = 9;
    for (let k = 0; k < nr; k++) both('od', box(0.03, 0.52, 0.05, W + 0.01, 1.29, z0 + 0.12 + k * (L - 0.24) / (nr - 1)));
    add('od', box(2.2, 0.48, 0.03, 0, 1.33, z1 - 0.015), box(2.2, 0.48, 0.03, 0, 1.33, z0 + 0.015));
    add('od', box(2.2, 0.05, 0.06, 0, 1.565, z0 + 0.02), box(2.2, 0.05, 0.06, 0, 1.565, z1 - 0.02));
    // tail lamps, pintle, tailgate chains
    for (const s of [1, -1]) {
      const [tx, ty, tz] = K.tail;
      add('odDark', box(0.12, 0.17, 0.08, s * tx, ty, tz + 0.045), box(0.04, 0.14, 0.04, s * tx, ty + 0.14, tz + 0.06));
      add('tail', box(0.07, 0.035, 0.006, s * tx, ty + 0.045, tz), box(0.07, 0.05, 0.006, s * tx, ty - 0.03, tz));
      add('steel', tube([[s * 1.09, 1.55, z0 - 0.02], [s * 1.1, 1.4, z0 - 0.035], [s * 1.08, 1.33, z0 - 0.03], [s * 1.04, 1.4, z0 - 0.025], [s * 1.02, 1.52, z0 - 0.02]], 0.008, 12, 4));
    }
    add('odDark', box(0.2, 0.16, 0.2, 0, 0.72, -3.38)); add('steel', place(clean(new THREE.TorusGeometry(0.06, 0.018, 6, 12)), 0, 0.72, -3.51, 0, Math.PI / 2, 0));
    // stakes and slatted racks (sides + headboard); folded troop seats lie against the rack inside
    const stakes = [z0 + 0.1, z0 + 0.95, zc, z1 - 0.95, z1 - 0.1];
    for (const z of stakes) {
      both('od', box(0.08, 0.15, 0.1, W + 0.02, 1.49, z));
      both('wood', box(0.05, 0.64, 0.075, W - 0.005, 1.76, z));
    }
    for (const y of [1.66, 1.83, 2.0]) both('wood', box(0.03, 0.09, L - 0.04, W - 0.045, y, zc));
    for (const y of [1.66, 1.83, 2.0]) add('wood', box(2.14, 0.09, 0.03, 0, y, z1 - 0.04));
    for (const x of [-0.7, 0, 0.7]) add('wood', box(0.075, 0.5, 0.045, x, 1.8, z1 - 0.012));
  }
  // rear rack above the tailgate (troops / empty)
  for (const y of [1.74, 1.93]) P.add('rackRear', 'wood', box(2.14, 0.09, 0.03, 0, y, K.bedZ0 + 0.035));
  // bows (empty / canvas) and the tarpaulin (canvas)
  const bowZ = [K.bedZ0 + 0.12, -2.45, -1.6, -0.75, K.bedZ1 - 0.12];
  const bowPts = (dx = 0, dy = 0) => [[1.1 + dx, 1.52], [1.1 + dx, 2.3 + dy], [1.02 + dx, 2.55 + dy], [0.7, 2.7 + dy], [0, 2.745 + dy], [-0.7, 2.7 + dy], [-1.02 - dx, 2.55 + dy], [-1.1 - dx, 2.3 + dy], [-1.1 - dx, 1.52]];
  for (const z of bowZ) P.add('bows', 'wood', tube(bowPts().map(([x, y]) => [x, y, z]), 0.022, 24, 6));
  {
    const sec = bowPts(0.035, 0.03).map(([x, y]) => [x, y]); sec[0][1] = sec[sec.length - 1][1] = 1.56;
    const ss = new THREE.CatmullRomCurve3(sec.map(([x, y]) => new V3(x, y, 0))).getSpacedPoints(26);
    const nz = 40, z0 = K.bedZ0 - 0.03, z1 = K.bedZ1 + 0.03, pos = [], uv = [];
    const R = rng(o.seed ?? 5);
    const jit = Array.from({ length: (nz + 1) * ss.length }, () => R() - 0.5);
    const V = (i, j) => {
      const z = lerp(z0, z1, j / nz), p = ss[i];
      let sag = 0; for (const bz of bowZ) sag = Math.max(sag, 1 - Math.min(1, Math.abs(z - bz) / 0.42));
      const top = smooth(clamp((p.y - 2.2) / 0.5));
      const k = (1 - sag) * (0.04 * top + 0.012) + jit[j * ss.length + i] * 0.006;
      const nx = p.x / Math.hypot(p.x, Math.max(0.2, p.y - 1.9)), ny = (p.y - 1.9) / Math.hypot(p.x, Math.max(0.2, p.y - 1.9));
      return [p.x - nx * k, p.y - ny * k, z];
    };
    for (let i = 0; i < ss.length - 1; i++) for (let j = 0; j < nz; j++) {
      const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv.push(i * 0.12, a[2], (i + 1) * 0.12, b[2], (i + 1) * 0.12, c[2], i * 0.12, a[2], (i + 1) * 0.12, c[2], i * 0.12, d[2]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    P.add('tarp', 'canvas', creased(g, 1.0));
    // end curtains: flat fans closing the arch, the rear one hanging a little loose
    for (const [z, sgn] of [[z1, 1], [z0, -1]]) {
      const cpos = [], cuv = [];
      const cy = 1.56;
      for (let i = 0; i < ss.length - 1; i++) {
        const a = ss[i], b = ss[i + 1];
        const zz = z + sgn * 0.0;
        const tri = sgn > 0 ? [[0, cy, zz], [a.x, a.y, zz], [b.x, b.y, zz]] : [[0, cy, zz], [b.x, b.y, zz], [a.x, a.y, zz]];
        for (const t of tri) { cpos.push(...t); cuv.push(t[0], t[1]); }
      }
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2)); cg.computeVertexNormals();
      P.add('tarp', 'canvas', cg);
    }
  }
  // M36 ring mount over the co-driver (-X) with a .50 cal
  {
    const cx = -0.36, cy = 2.5, cz = 0.86, rr = 0.56;
    P.add('ring', 'od', place(clean(new THREE.TorusGeometry(rr, 0.035, 8, 40)), cx, cy, cz, Math.PI / 2, 0, 0));
    for (const [x, z] of [[-0.84, 1.36], [-0.84, 0.32], [0.14, 1.36], [0.14, 0.32]]) {
      const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz);
      P.add('ring', 'od', rod([x, 1.62, z], [cx + dx / l * rr, cy, cz + dz / l * rr], 0.03));
    }
    P.add('ring', 'odDark', box(0.16, 0.16, 0.55, cx, cy + 0.2, cz + rr - 0.05), box(0.1, 0.25, 0.08, cx, cy + 0.05, cz + rr - 0.05));
    P.add('ring', 'steel', cyl(0.035, 0.035, 0.75, 'z', cx, cy + 0.22, cz + rr + 0.6, 10), cyl(0.013, 0.013, 1.25, 'z', cx, cy + 0.22, cz + rr + 0.8, 6));
  }
  // anchors (vehicle space)
  const lamps = [1, -1].map((s) => ({ pos: new V3(s * K.lamp[0], K.lamp[1], K.lamp[2] + 0.01), dir: new V3(0, -Math.sin(AIM_DOWN), Math.cos(AIM_DOWN)) }));
  const tails = [1, -1].map((s) => ({ pos: new V3(s * K.tail[0], K.tail[1], K.tail[2] - 0.01), dir: new V3(0, 0, -1) }));
  const wheels = [
    { kind: 'cckwF', x: K.trF, z: K.zF, steer: true }, { kind: 'cckwF', x: -K.trF, z: K.zF, steer: true },
    { kind: 'cckwR', x: K.trR, z: K.zR1 }, { kind: 'cckwR', x: -K.trR, z: K.zR1 },
    { kind: 'cckwR', x: K.trR, z: K.zR2 }, { kind: 'cckwR', x: -K.trR, z: K.zR2 },
  ];
  return { P, lamps, tails, wheels, wr: K.wr, R: K.R };
}

// ── people: the house mannequin (smooth faceless head) in an M1 helmet and an olive wool overcoat ──────────────
function limb(a, b, r0, r1, seg = 7) {
  const A = new V3(...a), B = new V3(...b), len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  g.applyQuaternion(_q.setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize()));
  const m = A.add(B).multiplyScalar(0.5); g.translate(m.x, m.y, m.z);
  return clean(g);
}
const HELMET = [[0.128, -0.058], [0.146, -0.074], [0.156, -0.072], [0.152, -0.055], [0.145, -0.025], [0.136, 0.012], [0.117, 0.05], [0.087, 0.08], [0.047, 0.099], [0.001, 0.104]];
function helmetGeo(seg = 14) { const g = lathe(HELMET, seg); g.scale(0.93, 1, 1.08); return g; }
const COAT_STAND = [[0.001, 0.4], [0.222, 0.4], [0.228, 0.5], [0.2, 0.75], [0.168, 0.98], [0.176, 1.1], [0.205, 1.27], [0.226, 1.37], [0.21, 1.45], [0.13, 1.5], [0.065, 1.525], [0.001, 1.53]];
const COAT_SEAT = [[0.001, 0.0], [0.17, 0.0], [0.176, 0.12], [0.18, 0.3], [0.2, 0.45], [0.21, 0.52], [0.19, 0.57], [0.12, 0.61], [0.06, 0.635], [0.001, 0.64]];
function xform(list, m) { for (const g of list) g.applyMatrix4(m); return list; }
// head, neck and helmet around the neck pivot (0, ny, 0)
function headParts(out, ny, yaw, pitch, tilt, R) {
  const head = [cyl(0.048, 0.05, 0.08, 'y', 0, ny + 0.03, 0, 7, true), sphere(0.105, 0, ny + 0.125, 0.012, 0.92, 1.12, 1.02, 10, 7)];
  const h = helmetGeo(); h.rotateX(tilt); h.translate(0, ny + 0.175, -0.004);
  const piv = new THREE.Matrix4().makeTranslation(0, ny, 0).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))).multiply(new THREE.Matrix4().makeTranslation(0, -ny, 0));
  xform(head, piv); h.applyMatrix4(piv);
  out.skin.push(...head); out.helmet.push(h);
  if (R() < 0.35) { const strap = cyl(0.108, 0.108, 0.012, 'y', 0, ny + 0.07, 0.01, 10, true); strap.scale(0.9, 1, 1); strap.applyMatrix4(piv); out.webbing.push(strap); }
}
// a standing trooper, feet at the origin, facing +Z. o: {sc, arms: 0 hands low | 1 holding on | 2 arms folded, rifle, pack, yaw..}
function standingMan(R, o = {}) {
  const out = { coat: [], helmet: [], skin: [], rifle: [], steel: [], webbing: [] };
  out.coat.push(limb([0.1, 0.0, 0.02], [0.1, 0.46, 0], 0.07, 0.075), limb([-0.1, 0.0, 0.02], [-0.1, 0.46, 0], 0.07, 0.075));
  const torso = lathe(COAT_STAND, 10); torso.scale(1, 1, 0.66);
  out.coat.push(torso, sphere(0.078, 0.19, 1.39, 0, 1, 0.85, 0.9, 7, 5), sphere(0.078, -0.19, 1.39, 0, 1, 0.85, 0.9, 7, 5));
  out.coat.push(cyl(0.097, 0.088, 0.1, 'y', 0, 1.53, 0, 10, true));
  { const belt = cyl(0.186, 0.186, 0.05, 'y', 0, 0.99, 0, 12, true); belt.scale(1, 1, 0.68); out.webbing.push(belt); }
  headParts(out, 1.53, o.headYaw ?? 0, o.headPitch ?? 0, o.tilt ?? 0.05, R);
  const arm = (s, elbow, hand, hide = false) => {
    out.coat.push(limb([s * 0.2, 1.41, 0], elbow, 0.062, 0.056, 6), limb(elbow, hand, 0.056, 0.047, 6));
    if (!hide) out.skin.push(sphere(0.042, hand[0], hand[1], hand[2], 0.85, 1.1, 0.7, 6, 4));
  };
  const a = o.arms ?? 0;
  if (a === 1) { arm(1, [0.25, 1.14, 0.0], [0.21, 0.97, 0.02], true); arm(-1, [-0.25, 1.14, 0.0], [-0.21, 0.97, 0.02], true); }   // hands in the pockets
  else if (a === 2) { arm(1, [0.22, 1.14, 0.1], [-0.07, 1.2, 0.17], true); arm(-1, [-0.22, 1.14, 0.1], [0.07, 1.23, 0.18], true); }  // arms folded
  else { arm(1, [0.235, 1.13, 0.03], [0.18, 0.95, 0.11]); arm(-1, [-0.235, 1.13, 0.03], [-0.18, 0.95, 0.11]); }
  if (o.rifle) {                   // M1 slung on the right shoulder, muzzle up past the helmet
    const s = o.rifle === 'left' ? -1 : 1;
    out.rifle.push(limb([s * 0.12, 0.86, -0.15], [s * 0.2, 1.72, -0.1], 0.028, 0.02, 5));
    out.steel.push(limb([s * 0.2, 1.72, -0.1], [s * 0.215, 1.98, -0.088], 0.011, 0.01, 5));
    out.webbing.push(limb([s * 0.16, 1.2, -0.13], [s * 0.19, 1.42, -0.02], 0.02, 0.02, 4));
  }
  if (o.pack) out.webbing.push(box(0.24, 0.2, 0.09, 0.06, 1.12, -0.16));
  return out;
}
// a seated figure: origin on the seat under the hips, facing +Z. pose 'drive' | 'ride' | 'rifle'
function seatedMan(R, o = {}) {
  const out = { coat: [], helmet: [], skin: [], rifle: [], steel: [], webbing: [], black: [] };
  const torso = lathe(COAT_SEAT, 12); torso.scale(1, 1, 0.66); torso.rotateX(-0.08);
  out.coat.push(torso, sphere(0.078, 0.19, 0.5, -0.03, 1, 0.85, 0.9, 8, 6), sphere(0.078, -0.19, 0.5, -0.03, 1, 0.85, 0.9, 8, 6));
  // legs: 'truck' (seat 0.32 above the floor) or 'jeep' (0.21, knees up)
  const lg = o.legs === 'jeep' ? { knee: [0.12, 0.2, 0.4], foot: [0.12, -0.16, 0.62] } : { knee: [0.12, 0.12, 0.42], foot: [0.12, -0.26, 0.56] };
  out.coat.push(cyl(0.097, 0.088, 0.1, 'y', 0, 0.64, -0.045, 10, true));
  { const ang = Math.atan2(lg.knee[1] - 0.08, lg.knee[2] - 0.02); out.coat.push(place(box(0.38, 0.07, 0.36), 0, (0.08 + lg.knee[1]) / 2 + 0.02, (0.02 + lg.knee[2]) / 2, -ang, 0, 0)); }
  for (const s of [1, -1]) {
    const kn = [s * lg.knee[0], lg.knee[1], lg.knee[2]], ft = [s * lg.foot[0], lg.foot[1], lg.foot[2]];
    out.coat.push(limb([s * 0.1, 0.08, 0.02], kn, 0.078, 0.066), limb(kn, ft, 0.06, 0.05));
    out.black.push(box(0.1, 0.08, 0.25, ft[0], ft[1] - 0.045, ft[2] + 0.06));
  }
  headParts(out, 0.64, o.headYaw ?? 0, o.headPitch ?? 0, o.tilt ?? 0.05, R);
  out.skin.forEach((g) => g.translate(0, 0, -0.045)); out.helmet.forEach((g) => g.translate(0, 0, -0.045));
  const arm = (s, elbow, hand) => {
    out.coat.push(limb([s * 0.2, 0.52, -0.03], elbow, 0.062, 0.056), limb(elbow, hand, 0.056, 0.047));
    out.skin.push(sphere(0.042, hand[0], hand[1], hand[2], 0.85, 1.1, 0.7, 7, 5));
  };
  if (o.pose === 'drive') { arm(1, [0.24, 0.3, 0.18], [0.19, 0.4, 0.43]); arm(-1, [-0.24, 0.3, 0.18], [-0.19, 0.4, 0.43]); }
  else { arm(1, [0.23, 0.28, 0.1], [0.1, 0.17, 0.32]); arm(-1, [-0.23, 0.28, 0.1], [-0.1, 0.17, 0.32]); }
  if (o.pose === 'rifle') {
    const fy = o.legs === 'jeep' ? -0.2 : -0.3;
    out.rifle.push(limb([0.0, fy, 0.44], [0.0, 0.46, 0.34], 0.028, 0.02, 5));
    out.steel.push(limb([0.0, 0.46, 0.34], [0.0, 0.72, 0.32], 0.011, 0.01, 5));
  }
  return out;
}
// merge a figure's parts into a Parts feature, transformed (scale, yaw, position)
function addFigure(P, feature, fig, x, y, z, yaw = 0, sc = 1, lean = 0) {
  const m = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, 0, 'YXZ')), new V3(sc, sc, sc));
  const key = { coat: 'coat', helmet: 'helmet', skin: 'skin', rifle: 'rifle', steel: 'steel', webbing: 'webbing', black: 'black' };
  for (const [k, list] of Object.entries(fig)) for (const g of list) { g.applyMatrix4(m); P.add(feature, key[k], g); }
}
// ~16..20 troopers standing packed in the open bed, mostly facing forward; a few rifle muzzles up
function addTroops(P, feature, seed, bed) {
  const R = rng(seed);
  const rows = 5, cols = 4;
  const zs = Array.from({ length: rows }, (_, k) => lerp(bed.z1 - 0.36, bed.z0 + 0.38, k / (rows - 1)));
  const xs = [-0.77, -0.26, 0.26, 0.77];
  const skip = new Set();
  const nSkip = 1 + Math.floor(R() * 3);                 // 17..19 men
  while (skip.size < nSkip) skip.add(Math.floor(R() * rows * cols));
  let n = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (skip.has(r * cols + c)) continue;
    const edge = c === 0 || c === cols - 1;
    const x = xs[c] + (R() - 0.5) * (edge ? 0.05 : 0.12) + (c === 0 ? 0.02 : c === cols - 1 ? -0.02 : 0);
    const z = zs[r] + (R() - 0.5) * 0.16;
    const sc = 0.95 + R() * 0.09;
    let yaw = (R() - 0.5) * 0.7;
    if (R() < 0.15) yaw += (R() < 0.5 ? 1 : -1) * Math.PI / 2 * 0.9;   // a few turned sideways
    if (r === rows - 1 && R() < 0.4) yaw = Math.PI + (R() - 0.5) * 0.6;  // someone in the back looks back
    const arms = R() < 0.35 ? 1 : R() < 0.35 ? 2 : 0;
    const fig = standingMan(R, {
      arms, rifle: R() < 0.32 ? (R() < 0.8 ? 'right' : 'left') : false, pack: R() < 0.35,
      headYaw: (R() - 0.5) * 0.9, headPitch: (R() - 0.5) * 0.25, tilt: -0.04 + R() * 0.16,
    });
    addFigure(P, feature, fig, x, bed.y, z, yaw, sc, (R() - 0.5) * 0.06);
    n++;
  }
  return n;
}

// ── truck assembly ───────────────────────────────────────────────────────────────────────────────────────────
const _kits = new Map();
const TROOP_SEEDS = [101, 202, 303];
function cckwGeometry(winch = true) {
  const key = winch ? 'W' : 'N';
  if (_kits.has(key)) return _kits.get(key);
  const kit = cckwKit({ winch, seed: 5 });
  const bed = { y: CCKW.bedY, z0: CCKW.bedZ0, z1: CCKW.bedZ1 };
  const counts = TROOP_SEEDS.map((sd, k) => addTroops(kit.P, 'troops' + k, sd, bed));
  const R = rng(77);
  addFigure(kit.P, 'crew', seatedMan(R, { pose: 'drive', headYaw: 0.05, tilt: 0.06 }), 0.4, 1.22, 0.55, 0, 0.96);
  addFigure(kit.P, 'crew', seatedMan(R, { pose: 'rifle', headYaw: -0.35, tilt: 0.1 }), -0.4, 1.22, 0.55, 0, 0.96);
  const out = { parts: kit.P.merged(), wheelGeo: { cckwF: wheelSet('cckwF'), cckwR: wheelSet('cckwR') }, wheels: kit.wheels, lamps: kit.lamps, tails: kit.tails, wr: kit.wr, troopCounts: counts };
  _kits.set(key, out);
  return out;
}
function truckFeatures(load, variant, o = {}) {
  const f = ['base'];
  if (load === 'canvas') f.push('bows', 'tarp');
  else if (load === 'empty') f.push('bows', 'rackRear');
  else f.push('rackRear', 'troops' + (((variant % 3) + 3) % 3));
  if (o.crew !== false) f.push('crew');
  if (o.ring) f.push('ring');
  return f;
}
const NO_SHADOW = new Set(['glass', 'lens', 'tail', 'marker', 'decal', 'star', 'celluloid']);
// Ackermann: the inner front wheel turns tighter. steer > 0 turns left (towards +X)
function ackermann(steer, wb, halfTrack) {
  if (Math.abs(steer) < 1e-5) return [steer, steer];
  const Rt = wb / Math.tan(Math.abs(steer)), sg = Math.sign(steer);
  const inner = Math.atan(wb / Math.max(0.5, Rt - halfTrack)), outer = Math.atan(wb / (Rt + halfTrack));
  return sg > 0 ? [inner * sg, outer * sg] : [outer * sg, inner * sg];      // [left wheel (+X), right wheel (-X)]
}
// one wheel's local matrix: hub position, steer, flip for the right side, roll
const _wm = new THREE.Matrix4(), _wq = new THREE.Quaternion(), _we = new THREE.Euler(), _wp = new V3(), _one = new V3(1, 1, 1);
function wheelMatrix(w, y, steer, roll, out) {
  const right = w.x < 0;
  _we.set(right ? -roll : roll, (w.steer ? steer : 0) + (right ? Math.PI : 0), 0, 'YXZ');
  return out.compose(_wp.set(w.x, y, w.z), _wq.setFromEuler(_we), _one);
}

export function buildTruck(o = {}) {
  const kit = cckwGeometry(o.winch !== false);
  const M = o.materials ?? vehicleMaterials({ wet: o.wet, mud: o.mud, lights: o.lights });
  const seed = o.seed ?? 1;
  const load = o.load ?? 'troops';
  const group = new THREE.Group(); group.name = 'cckw';
  const body = new THREE.Group(); body.name = 'sprung'; group.add(body);
  let tris = 0;
  for (const f of truckFeatures(load, seed, { crew: o.crew, ring: o.ring })) {
    for (const [key, geo] of Object.entries(kit.parts[f] || {})) {
      const mesh = new THREE.Mesh(geo, M[key]);
      mesh.castShadow = !NO_SHADOW.has(key); mesh.receiveShadow = true; mesh.name = f + ':' + key;
      body.add(mesh); tris += triCount(geo);
    }
  }
  M.decal.userData.uRow.value = o.row ?? (seed % 12);
  // wheels: pivot (steer) -> spin (roll)
  const wheels = kit.wheels.map((w) => {
    const holder = new THREE.Group(); holder.matrixAutoUpdate = false; group.add(holder);
    for (const [key, geo] of Object.entries(kit.wheelGeo[w.kind])) {
      const m = new THREE.Mesh(geo, M[key]); m.castShadow = true; m.receiveShadow = true; holder.add(m); tris += triCount(geo);
    }
    return { w, holder };
  });
  const anchor = (p, dir, name) => {
    const a = new THREE.Object3D(); a.name = name; a.position.copy(p.pos);
    a.quaternion.setFromUnitVectors(new V3(0, 0, 1), p.dir); body.add(a); return a;
  };
  const anchors = {
    headlights: kit.lamps.map((l, k) => anchor(l, l.dir, k ? 'headlight_R' : 'headlight_L')),
    taillights: kit.tails.map((l, k) => anchor(l, l.dir, k ? 'taillight_R' : 'taillight_L')),
  };
  const ph = rng(seed * 7 + 3)() * TAU;
  function update(t = 0, s = {}) {
    const roll = (s.distance ?? 0) / kit.wr;
    const [sl, sr] = ackermann(s.steer ?? 0, CCKW.wb, CCKW.trF);
    for (const { w, holder } of wheels) {
      wheelMatrix(w, kit.wr, w.x > 0 ? sl : sr, roll, holder.matrix);
      holder.matrixWorldNeedsUpdate = true;
    }
    // idling engine / road shake on the sprung body, a few millimetres
    const v = s.vibration ?? 1;
    body.position.y = v * (0.0025 * Math.sin(t * 69.1 + ph) + 0.0015 * Math.sin(t * 108.7 + ph * 2));
    body.rotation.set(v * 0.0012 * Math.sin(t * 33.3 + ph), 0, v * 0.0016 * Math.sin(t * 44.6 + ph * 3) + (s.lean ?? 0));
  }
  update(0, {});
  return {
    group, body, update, anchors, materials: M, triangles: tris,
    setLights: (on) => M.setLights(on), setWet: (w, mud) => M.setWet(w, mud),
    dims: { length: CCKW.length, width: CCKW.width, wheelbase: CCKW.wb, wheelRadius: kit.wr },
  };
}

// ── the column ───────────────────────────────────────────────────────────────────────────────────────────────
// n trucks on a Catmull-Rom path (arc-length parametrised). All trucks share geometry and materials through
// InstancedMeshes (one per feature x material; wheels one per kind x material), so 40 trucks cost ~40 draw calls.
export function buildConvoy(o = {}) {
  const n = o.n ?? 24, spacing = o.spacing ?? 22;
  const kit = cckwGeometry(o.winch !== false);
  const M = o.materials ?? vehicleMaterials({ wet: o.wet, mud: o.mud, lights: o.lights ?? true });
  const R = rng(o.seed ?? 1218);
  const heightAt = o.heightAt ?? null;
  const pts = (o.path && o.path.length >= 2 ? o.path : [[0, 0, 0], [0, 0, 600]]).map((p) => new V3(p[0], p[1] ?? 0, p[2]));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  curve.arcLengthDivisions = Math.max(200, Math.ceil(curve.getLength() / 0.5)); curve.updateArcLengths();
  const L = curve.getLength();
  const P0 = new V3(), P1 = new V3(), P2 = new V3();
  const pathAt = (s, out) => curve.getPointAt(clamp(s / L), out);
  // per-truck set-up
  const trucks = [];
  for (let i = 0; i < n; i++) {
    const load = typeof o.load === 'function' ? o.load(i) : Array.isArray(o.load) ? o.load[i % o.load.length] : (o.load ?? 'troops');
    const variant = Math.floor(R() * 3);
    const ring = typeof o.ring === 'function' ? !!o.ring(i) : o.ring ?? (R() < 0.25);
    trucks.push({
      i, load, feats: new Set(truckFeatures(load, variant, { ring, crew: o.crew })),
      jitter: (R() - 0.5) * 2 * (o.jitter ?? 0.12) * spacing, breathe: R() * TAU, ph: R() * TAU,
      tone: 0.9 + R() * 0.16, canvasTone: 0.86 + R() * 0.24, row: (o.row0 ?? 0) + i,
      s: 0, visible: false, matrix: new THREE.Matrix4(), bodyMatrix: new THREE.Matrix4(), quat: new THREE.Quaternion(), pos: new V3(),
    });
  }
  const group = new THREE.Group(); group.name = 'convoy';
  const meshes = [];                // {mesh, list}
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const allFeats = new Set(); trucks.forEach((t) => t.feats.forEach((f) => allFeats.add(f)));
  const col = new THREE.Color();
  let trisPerTruck = 0;
  for (const f of allFeats) {
    const list = trucks.filter((t) => t.feats.has(f)).map((t) => t.i);
    for (const [key, geo0] of Object.entries(kit.parts[f] || {})) {
      let geo = geo0;
      if (key === 'decal') {
        geo = geo0.clone();
        geo.setAttribute('aRow', new THREE.InstancedBufferAttribute(new Float32Array(list.map((i) => trucks[i].row % MARK_ROWS)), 1));
      }
      const mesh = new THREE.InstancedMesh(geo, M[key], list.length);
      mesh.name = f + ':' + key; mesh.frustumCulled = false;
      mesh.castShadow = !NO_SHADOW.has(key); mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (key === 'od' || key === 'canvas' || key === 'canvasTop' || key === 'wood') {
        list.forEach((i, j) => { const k = key === 'od' || key === 'wood' ? trucks[i].tone : trucks[i].canvasTone; mesh.setColorAt(j, col.setRGB(k, k * (key === 'od' ? 1 : 0.98), k * (key === 'od' ? 0.97 : 0.94))); });
      }
      group.add(mesh); meshes.push({ mesh, list });
    }
  }
  const wheelMeshes = [];
  for (const kind of ['cckwF', 'cckwR']) {
    const ws = kit.wheels.filter((w) => w.kind === kind);
    for (const [key, geo] of Object.entries(kit.wheelGeo[kind])) {
      const mesh = new THREE.InstancedMesh(geo, M[key], ws.length * n);
      mesh.name = 'wheel:' + kind + ':' + key; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh); wheelMeshes.push({ mesh, ws });
    }
  }
  {
    const f0 = truckFeatures('troops', 0, { crew: o.crew });
    for (const f of f0) for (const g of Object.values(kit.parts[f] || {})) trisPerTruck += triCount(g);
    for (const w of kit.wheels) for (const g of Object.values(kit.wheelGeo[w.kind])) trisPerTruck += triCount(g);
  }
  const anchors = { headlights: [], taillights: [], trucks: trucks.map((t) => ({ index: t.i, s: 0, visible: false, pos: t.pos, quat: t.quat, matrix: t.bodyMatrix })) };
  const pool = { head: [], tail: [] };
  const lampPt = (pool2, k) => (pool2[k] ??= { pos: new V3(), dir: new V3(), truck: 0 });
  const K = CCKW;
  const wheelLocal = new THREE.Matrix4(), tmp = new THREE.Matrix4(), sway = new THREE.Matrix4();
  const e = new THREE.Euler(), q = new THREE.Quaternion(), fw = new V3(), lf = new V3(), tq = new THREE.Quaternion();
  const ground = (x, z, s) => (heightAt ? heightAt(x, z) : pathAt(s, P2).y);
  function headingAt(s) { pathAt(s - 1.5, P0); pathAt(s + 1.5, P1); return Math.atan2(P1.x - P0.x, P1.z - P0.z); }
  function update(t = 0, st = {}) {
    const head = st.head ?? 0, speed = st.speed ?? 8;
    let nh = 0, nt = 0;
    const suspY = new Float32Array(6);
    for (const tr of trucks) {
      const s = head - tr.i * spacing + tr.jitter + 1.1 * Math.sin(t * 0.21 + tr.breathe);
      tr.s = s;
      tr.visible = s + K.bedZ0 >= 0 && s + 3.45 <= L;
      const A = anchors.trucks[tr.i]; A.s = s; A.visible = tr.visible;
      if (!tr.visible) continue;
      // front axle and bogie centre ride on the path; heading from one to the other
      pathAt(s + K.zF, P0); pathAt(s + K.zB, P1);
      const yaw = Math.atan2(P0.x - P1.x, P0.z - P1.z);
      fw.set(Math.sin(yaw), 0, Math.cos(yaw)); lf.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const ox = P1.x - fw.x * K.zB, oz = P1.z - fw.z * K.zB;
      const W = (x, z, sArc) => ground(ox + lf.x * x + fw.x * z, oz + lf.z * x + fw.z * z, sArc);
      const hFL = W(K.trF, K.zF, s + K.zF), hFR = W(-K.trF, K.zF, s + K.zF);
      const h1L = W(K.trR, K.zR1, s + K.zR1), h1R = W(-K.trR, K.zR1, s + K.zR1), h2L = W(K.trR, K.zR2, s + K.zR2), h2R = W(-K.trR, K.zR2, s + K.zR2);
      const front = (hFL + hFR) / 2, rear = (h1L + h1R + h2L + h2R) / 4;
      const pitch = Math.atan2(front - rear, K.wb);
      const left = (hFL + h1L + h2L) / 3, right = (hFR + h1R + h2R) / 3;
      const roll = Math.atan2(left - right, 2 * (K.trF + 2 * K.trR) / 3);
      const y0 = rear + (front - rear) * (-K.zB / K.wb);
      e.set(-pitch, yaw, roll, 'YXZ'); tr.quat.setFromEuler(e);
      tr.pos.set(ox, y0, oz);
      tr.matrix.compose(tr.pos, tr.quat, _one);
      // residual of each wheel to the body plane -> suspension travel (clamped)
      const plane = (x, z) => y0 + Math.tan(pitch) * (z - 0) + Math.tan(roll) * x * 1.0;
      const hs = [hFL, hFR, h1L, h1R, h2L, h2R];
      kit.wheels.forEach((w, k) => { suspY[k] = clamp(hs[k] - plane(w.x, w.z), -0.12, 0.12); });
      // body roll in bends (lateral acceleration), pitch bob and engine shake on the springs
      const dh = headingAt(s + 3) - headingAt(s - 3), kappa = Math.atan2(Math.sin(dh), Math.cos(dh)) / 6;
      const bodyRoll = clamp(speed * speed * kappa * 0.012, -0.035, 0.035);
      const vib = 0.0025 * Math.sin(t * 69.1 + tr.ph) + 0.0015 * Math.sin(t * 108.7 + tr.ph * 2) + 0.006 * Math.sin(t * 5.3 + tr.ph) * clamp(speed / 8);
      e.set(0.0012 * Math.sin(t * 33.3 + tr.ph) + 0.004 * Math.sin(t * 2.1 + tr.ph * 1.7) * clamp(speed / 8), 0, bodyRoll + 0.0016 * Math.sin(t * 44.6 + tr.ph * 3), 'XYZ');
      sway.makeRotationFromEuler(e); sway.setPosition(0, 0.9 + vib, 0);
      tmp.makeTranslation(0, -0.9, 0); sway.multiply(tmp);
      tr.bodyMatrix.multiplyMatrices(tr.matrix, sway);
      // lamps
      tq.setFromRotationMatrix(tr.bodyMatrix);
      for (const l of kit.lamps) { const a = lampPt(pool.head, nh++); a.pos.copy(l.pos).applyMatrix4(tr.bodyMatrix); a.dir.copy(l.dir).applyQuaternion(tq); a.truck = tr.i; }
      for (const l of kit.tails) { const a = lampPt(pool.tail, nt++); a.pos.copy(l.pos).applyMatrix4(tr.bodyMatrix); a.dir.copy(l.dir).applyQuaternion(tq); a.truck = tr.i; }
      // wheels: roll with the distance travelled, steer with the bend
      const steer = Math.atan(K.wb * kappa);
      const [sl, sr] = ackermann(steer, K.wb, K.trF);
      const rollA = s / kit.wr;
      tr.wheelMats = tr.wheelMats || kit.wheels.map(() => new THREE.Matrix4());
      kit.wheels.forEach((w, k) => {
        wheelMatrix(w, kit.wr + suspY[k], w.x > 0 ? sl : sr, rollA, wheelLocal);
        tr.wheelMats[k].multiplyMatrices(tr.matrix, wheelLocal);
      });
    }
    for (const { mesh, list } of meshes) {
      list.forEach((i, j) => mesh.setMatrixAt(j, trucks[i].visible ? trucks[i].bodyMatrix : ZERO));
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const { mesh, ws } of wheelMeshes) {
      let j = 0;
      for (const tr of trucks) for (const w of ws) {
        const k = kit.wheels.indexOf(w);
        mesh.setMatrixAt(j++, tr.visible ? tr.wheelMats[k] : ZERO);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    anchors.headlights.length = 0; for (let k = 0; k < nh; k++) anchors.headlights.push(pool.head[k]);
    anchors.taillights.length = 0; for (let k = 0; k < nt; k++) anchors.taillights.push(pool.tail[k]);
    return anchors;
  }
  // where along the path truck i is at a given head (for cameras): world position + heading
  function truckAt(i) { return anchors.trucks[i]; }
  return {
    group, update, anchors, truckAt, curve, length: L, materials: M, trucks: anchors.trucks,
    trianglesPerTruck: trisPerTruck, setLights: (on) => M.setLights(on), setWet: (w, mud) => M.setWet(w, mud),
  };
}

// ── Willys MB ────────────────────────────────────────────────────────────────────────────────────────────────
// 3.36 m long, 1.57 wide (front fenders), wheelbase 2.032 (80 in), track 1.245 (49 in), 6.00-16 tyres r 0.362.
export const MB = { zF: 1.08, zR: -0.952, wb: 2.032, tr: 0.6225, wr: 0.352, lamp: [0.3, 0.75, 1.468], tail: [0.52, 0.72, -1.566], length: 3.36, width: 1.575 };
function mbKit() {
  const P = new Parts(), J = MB;
  const add = (key, ...g) => P.add('base', key, ...g);
  const both = (key, g) => add(key, g, mirrorX(g));
  // chassis
  both('odDark', box(0.06, 0.11, 3.18, 0.33, 0.47, 0.06));
  for (const z of [1.5, 0.3, -0.5, -1.45]) add('odDark', box(0.66, 0.08, 0.07, 0, 0.46, z));
  for (const z of [J.zF, J.zR]) { add('odDark', cyl(0.045, 0.045, 1.14, 'x', 0, J.wr, z, 10), sphere(0.11, -0.08, J.wr - 0.01, z, 1, 0.95, 0.85, 12, 8)); }
  for (const [z, len] of [[J.zF, 0.9], [J.zR, 1.1]]) both('odDark', box(0.05, 0.035, len, 0.33, 0.405, z));
  add('odDark', box(0.42, 0.32, 0.8, 0, 0.62, 0.95), box(0.28, 0.24, 0.5, 0, 0.5, 0.25));
  add('steel', rod([0, 0.42, 0.05], [-0.08, 0.36, J.zF - 0.12], 0.025), rod([0, 0.42, 0.0], [-0.08, 0.36, J.zR + 0.14], 0.025));
  add('odDark', cyl(0.05, 0.05, 0.6, 'z', -0.22, 0.38, -0.3, 8));
  // hood (flat, slight crown) and the stamped nine-slot grille with the lamps behind round openings
  {
    const sec = [[0.385, 0.62], [0.385, 0.93], [0.375, 0.955], [0.35, 0.968], [0, 0.975], [-0.35, 0.968], [-0.375, 0.955], [-0.385, 0.93], [-0.385, 0.62]];
    const s = new THREE.Shape(); s.moveTo(sec[0][0], sec[0][1]); for (const p of sec.slice(1)) s.lineTo(p[0], p[1]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.18, bevelEnabled: false, curveSegments: 2 }); g.translate(0, 0, 0.25);
    const c = clean(g), p = c.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.8) p.setY(i, p.getY(i) - 0.03 * clamp((p.getZ(i) - 0.25) / 1.18));
    add('od', creased(c, 0.5));
    both('odDark', box(0.05, 0.03, 0.08, 0.25, 0.955, 1.3));                 // windscreen rests
    P.add('base', 'star', (() => { const g2 = new THREE.PlaneGeometry(0.62, 0.62); g2.rotateX(-Math.PI / 2); g2.rotateY(Math.PI); g2.translate(0, 0.982, 0.8); const u = g2.attributes.uv; for (let i = 0; i < u.count; i++) u.setX(i, u.getX(i) * 0.5); return g2; })());
    const x = 0.388, y0 = 0.86, y1 = 0.92, z0 = 0.42, z1 = 1.12;
    P.add('base', 'decal', quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], [0.5, 0, 1, 1]));
    P.add('base', 'decal', quad([-x, y0, z0], [-x, y0, z1], [-x, y1, z1], [-x, y1, z0], [0.5, 0, 1, 1]));
  }
  {
    const zg = 1.445;
    both('od', box(0.17, 0.53, 0.035, 0.3, 0.685, zg));
    add('od', box(0.77, 0.075, 0.035, 0, 0.912, zg), box(0.77, 0.07, 0.035, 0, 0.455, zg));
    for (let k = 0; k < 10; k++) add('od', box(0.018, 0.4, 0.035, -0.2115 + k * 0.047, 0.685, zg));
    add('black', box(0.44, 0.42, 0.05, 0, 0.685, zg - 0.08));
    for (const s of [1, -1]) {
      const [lx, ly, lz] = J.lamp;
      add('od', cyl(0.1, 0.1, 0.02, 'z', s * lx, ly, lz - 0.005, 18, true));
      add('lens', cyl(0.086, 0.086, 0.012, 'z', s * lx, ly, lz - 0.01, 18));
      add('od', box(0.07, 0.05, 0.07, s * 0.47, 0.865, 1.38)); add('marker', box(0.045, 0.016, 0.004, s * 0.47, 0.865, 1.417));
    }
    add('od', cyl(0.065, 0.065, 0.1, 'z', 0.6, 0.93, 1.22, 12), box(0.14, 0.02, 0.12, 0.6, 0.995, 1.25), rod([0.6, 0.87, 1.2], [0.6, 0.84, 1.2], 0.014));
    add('marker', box(0.09, 0.012, 0.004, 0.6, 0.925, 1.272));
  }
  // front fenders (flat), bumper with shackles and codes
  both('od', profileX([[1.44, 0.8], [1.44, 0.838], [0.64, 0.838], [0.53, 0.79], [0.45, 0.68], [0.41, 0.54], [0.385, 0.54], [0.425, 0.685], [0.51, 0.805], [0.625, 0.813], [1.415, 0.813], [1.415, 0.8]], 0.387, 0.787));
  both('od', profileX([[0.26, 0.36], [0.26, 0.81], [0.61, 0.81], [0.515, 0.765], [0.44, 0.63], [0.4, 0.46], [0.4, 0.36]], 0.63, 0.645));
  both('od', box(0.014, 0.05, 0.8, 0.782, 0.814, 1.04));
  add('od', box(1.6, 0.13, 0.12, 0, 0.47, 1.62));
  for (const s of [1, -1]) add('steel', tube([[s * 0.33, 0.42, 1.68], [s * 0.33, 0.38, 1.74], [s * 0.33, 0.47, 1.77], [s * 0.33, 0.54, 1.73], [s * 0.33, 0.52, 1.68]], 0.016, 12, 5));
  P.add('base', 'decal', quad([-0.78, 0.425, 1.684], [-0.24, 0.425, 1.684], [-0.24, 0.515, 1.684], [-0.78, 0.515, 1.684], [0, 0, 0.25, 1]));
  P.add('base', 'decal', quad([0.24, 0.425, 1.684], [0.78, 0.425, 1.684], [0.78, 0.515, 1.684], [0.24, 0.515, 1.684], [0.25, 0, 0.5, 1]));
  // cowl and tub: sides with the seat cut-outs and rear wheel arches, rear panel, floor, wheel housings
  add('od', box(1.33, 0.12, 0.14, 0, 0.93, 0.19), box(1.33, 0.5, 0.025, 0, 0.72, 0.255), box(1.2, 0.16, 0.02, 0, 0.86, 0.12));
  {
    const arc = []; for (let k = 0; k <= 12; k++) { const a = Math.PI - k / 12 * Math.PI; arc.push([J.zR + 0.43 * Math.cos(a), 0.352 + 0.43 * Math.sin(a)]); }
    const side = [[0.26, 0.33], [0.26, 0.98], [0.12, 0.98], [0.02, 0.9], [-0.04, 0.74], [-0.12, 0.665], [-0.52, 0.665], [-0.6, 0.72], [-0.66, 0.84], [-0.74, 0.855], [-1.53, 0.855], [-1.53, 0.33],
      [J.zR - 0.43, 0.33], ...arc, [J.zR + 0.43, 0.33]];
    both('od', profileX(side, 0.64, 0.665));
    add('od', box(1.33, 0.525, 0.025, 0, 0.5925, -1.52), box(1.3, 0.03, 1.79, 0, 0.445, -0.63));
    both('od', box(0.2, 0.025, 0.92, 0.555, 0.79, J.zR), box(0.02, 0.36, 0.92, 0.46, 0.61, J.zR));
    both('od', box(0.3, 0.02, 0.14, 0.51, 0.5, 0.33));                        // steps
  }
  // seats, steering wheel, folded top at the back, spare wheel and jerrycan on the rear, lamps, tools
  for (const s of [1, -1]) { add('canvas', box(0.42, 0.09, 0.42, s * 0.32, 0.61, -0.4), place(box(0.42, 0.4, 0.07), s * 0.32, 0.86, -0.64, -0.2, 0, 0)); }
  add('canvas', box(0.9, 0.09, 0.4, 0, 0.62, -1.2), place(box(0.9, 0.34, 0.06), 0, 0.85, -1.45, -0.18, 0, 0));
  add('black', place(clean(new THREE.TorusGeometry(0.2, 0.012, 6, 24)), 0.32, 0.96, -0.03, -0.95, 0, 0), rod([0.32, 0.96, -0.03], [0.32, 0.5, 0.3], 0.02));
  add('canvasTop', cyl(0.075, 0.075, 1.22, 'x', 0, 0.93, -1.49, 12));
  both('steel', rod([0.6, 0.86, -1.5], [0.61, 0.9, -0.9], 0.012));
  {
    const sp = wheelSet('jeep');
    for (const [key, g0] of Object.entries(sp)) { const g = g0.clone(); g.rotateY(Math.PI / 2); g.translate(-0.28, 0.6, -1.625); add(key, g); }
    add('odDark', box(0.06, 0.2, 0.06, -0.28, 0.6, -1.56));
    add('od', box(0.345, 0.47, 0.165, 0.4, 0.62, -1.625), box(0.36, 0.03, 0.18, 0.4, 0.4, -1.62));
    for (const x of [0.33, 0.4, 0.47]) add('od', box(0.03, 0.03, 0.08, x, 0.87, -1.625));
    add('odDark', box(0.36, 0.03, 0.02, 0.4, 0.7, -1.712), box(0.36, 0.03, 0.02, 0.4, 0.52, -1.712));
  }
  for (const s of [1, -1]) {
    add('odDark', box(0.12, 0.1, 0.12, s * 0.55, 0.4, -1.6), box(0.09, 0.12, 0.05, s * J.tail[0], J.tail[1], -1.545));
    add('tail', box(0.06, 0.028, 0.006, s * J.tail[0], J.tail[1] + 0.03, J.tail[2] + 0.004), box(0.06, 0.04, 0.006, s * J.tail[0], J.tail[1] - 0.025, J.tail[2] + 0.004));
  }
  add('steel', place(clean(new THREE.TorusGeometry(0.045, 0.014, 6, 12)), 0, 0.42, -1.6, 0, Math.PI / 2, 0));
  add('wood', rod([0.675, 0.5, -0.12], [0.675, 0.56, -0.86], 0.016), rod([0.675, 0.66, -1.0], [0.675, 0.63, -0.3], 0.014));
  add('steel', box(0.02, 0.13, 0.09, 0.678, 0.52, -0.1), box(0.02, 0.2, 0.15, 0.678, 0.66, -1.08));
  // windscreen, hinged on the cowl: up (leaning back) or folded flat onto the hood rests
  for (const [feat, ang] of [['wsUp', -0.12], ['wsFold', Math.PI / 2 - 0.035]]) {
    const hinge = new THREE.Matrix4().makeTranslation(0, 0.995, 0.22).multiply(new THREE.Matrix4().makeRotationX(ang));
    const fr = [box(1.3, 0.075, 0.04, 0, 0.04, 0), box(1.3, 0.035, 0.04, 0, 0.335, 0), box(0.035, 0.34, 0.04, 0.63, 0.19, 0), box(0.035, 0.34, 0.04, -0.63, 0.19, 0), box(0.03, 0.27, 0.035, 0, 0.21, 0)];
    for (const g of fr) { g.applyMatrix4(hinge); P.add(feat, 'od', g); }
    for (const s of [1, -1]) {
      const g = quad([s > 0 ? 0.61 : -0.015, 0.08, 0], [s > 0 ? 0.015 : -0.61, 0.08, 0], [s > 0 ? 0.015 : -0.61, 0.318, 0], [s > 0 ? 0.61 : -0.015, 0.318, 0]);
      g.applyMatrix4(hinge); P.add(feat, 'glass', g);
    }
  }
  const lamps = [1, -1].map((s) => ({ pos: new V3(s * J.lamp[0], J.lamp[1], J.lamp[2] + 0.004), dir: new V3(0, -Math.sin(AIM_DOWN), Math.cos(AIM_DOWN)) }));
  const tails = [1, -1].map((s) => ({ pos: new V3(s * J.tail[0], J.tail[1], J.tail[2]), dir: new V3(0, 0, -1) }));
  const wheels = [{ kind: 'jeep', x: J.tr, z: J.zF, steer: true }, { kind: 'jeep', x: -J.tr, z: J.zF, steer: true }, { kind: 'jeep', x: J.tr, z: J.zR }, { kind: 'jeep', x: -J.tr, z: J.zR }];
  // riders: driver, front passenger, rear left, rear right (seated mannequins in helmets and overcoats)
  const R = rng(58);
  addFigure(P, 'rider0', seatedMan(R, { pose: 'drive', legs: 'jeep', headYaw: 0.08, tilt: 0.04 }), 0.32, 0.655, -0.45, 0, 0.96);
  addFigure(P, 'rider1', seatedMan(R, { pose: 'ride', legs: 'jeep', headYaw: -0.45, tilt: 0.1 }), -0.32, 0.655, -0.45, 0, 0.96);
  addFigure(P, 'rider2', seatedMan(R, { pose: 'rifle', legs: 'jeep', headYaw: 0.5, tilt: 0.0 }), 0.24, 0.665, -1.22, 0, 0.95);
  addFigure(P, 'rider3', seatedMan(R, { pose: 'ride', legs: 'jeep', headYaw: -0.2, tilt: 0.12 }), -0.24, 0.665, -1.22, 0, 0.95);
  return { parts: P.merged(), wheelGeo: { jeep: wheelSet('jeep') }, wheels, lamps, tails, wr: J.wr };
}
let _mb = null;
export function buildJeep(o = {}) {
  const kit = _mb ??= mbKit();
  const M = o.materials ?? vehicleMaterials({ wet: o.wet, mud: o.mud, lights: o.lights, mudH: 0.7 });
  const seed = o.seed ?? 1;
  const group = new THREE.Group(); group.name = 'willys-mb';
  const body = new THREE.Group(); body.name = 'sprung'; group.add(body);
  const riders = clamp(Math.round(o.riders ?? 2), 0, 4);
  const feats = ['base', o.windscreen === 'folded' || o.windscreen === false ? 'wsFold' : 'wsUp'];
  for (let k = 0; k < riders; k++) feats.push('rider' + k);
  let tris = 0;
  for (const f of feats) for (const [key, geo] of Object.entries(kit.parts[f] || {})) {
    const mesh = new THREE.Mesh(geo, M[key]); mesh.castShadow = !NO_SHADOW.has(key); mesh.receiveShadow = true; mesh.name = f + ':' + key;
    body.add(mesh); tris += triCount(geo);
  }
  M.decal.userData.uRow.value = o.row ?? (12 + (seed % 4));
  const wheels = kit.wheels.map((w) => {
    const holder = new THREE.Group(); holder.matrixAutoUpdate = false; group.add(holder);
    for (const [key, geo] of Object.entries(kit.wheelGeo[w.kind])) { const m = new THREE.Mesh(geo, M[key]); m.castShadow = true; m.receiveShadow = true; holder.add(m); tris += triCount(geo); }
    return { w, holder };
  });
  const anchor = (p, name) => { const a = new THREE.Object3D(); a.name = name; a.position.copy(p.pos); a.quaternion.setFromUnitVectors(new V3(0, 0, 1), p.dir); body.add(a); return a; };
  const anchors = { headlights: kit.lamps.map((l, k) => anchor(l, k ? 'headlight_R' : 'headlight_L')), taillights: kit.tails.map((l, k) => anchor(l, k ? 'taillight_R' : 'taillight_L')) };
  const ph = rng(seed * 13 + 1)() * TAU;
  function update(t = 0, s = {}) {
    const roll = (s.distance ?? 0) / kit.wr;
    const [sl, sr] = ackermann(s.steer ?? 0, MB.wb, MB.tr);
    for (const { w, holder } of wheels) { wheelMatrix(w, kit.wr, w.x > 0 ? sl : sr, roll, holder.matrix); holder.matrixWorldNeedsUpdate = true; }
    const v = s.vibration ?? 1;
    body.position.y = v * (0.002 * Math.sin(t * 81.7 + ph) + 0.0012 * Math.sin(t * 131.3 + ph * 2));
    body.rotation.set(v * 0.0015 * Math.sin(t * 37.9 + ph), 0, v * 0.002 * Math.sin(t * 51.2 + ph * 3) + (s.lean ?? 0));
  }
  update(0, {});
  return { group, body, update, anchors, materials: M, triangles: tris, setLights: (on) => M.setLights(on), setWet: (w, mud) => M.setWet(w, mud), dims: { length: MB.length, width: MB.width, wheelbase: MB.wb, wheelRadius: kit.wr } };
}
