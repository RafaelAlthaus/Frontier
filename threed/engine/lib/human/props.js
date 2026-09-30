// props.js — a detached house with a working front door, and small props for the disaster films (H1 for Q9, 26 Sep 2026)
//   landmark.house     style farmhouse: a US farmhouse c.1900 (two storeys, white clapboard, gable roof with a standing-seam
//                      roof, full-width front porch on posts); style suburban: a one-storey ranch (painted lap siding,
//                      asphalt shingles). The FRONT faces `heading` (compass: 180 = the front and the door face south, +Z).
//                      The front door (a 0.9 x 2.05 m opening in a 0.2 m wall, hinged on the left seen from outside) swings
//                      INWARD on `door` keys [[t, deg], ...] (0 closed, 90 open, smoothstep per segment; a slam = two keys
//                      ~0.12 s apart); setDoor(deg) overrides the keys (setDoor(null) hands back to them). Windows glow warm
//                      on `lit` keys [[t, 0..1], ...] (default: when the sun is low, as towns.js). The ground floor is at
//                      ground level (no step): a ground-snapped figure walks in. Behind the door is a dim entrance hall
//                      (floor that follows the terrain, stairs, back wall, a table lamp that glows when lit).
//                      anchors.door: Object3D at the threshold centre on the floor, outside face, local +Z outward,
//                      userData {width, height, hinge:'left', swing:'in', heading, inside:[x,z], outside:[x,z]}
//                      (also .pos [x,y,z], .heading, .w, .h for actions.js)
//   prop.sign          US hurricane EVACUATION ROUTE sign (blue, white hurricane symbol) | stop | blank (+ text) on a post
//   prop.power_poles   wooden utility poles (crossarm, insulators) along `path` with sagging wires; lean 0..1 tilts them
//   prop.fence         wire (barbed) | rail | picket fence along `path`, posts every ~2.5 m on the ground
//   prop.siren_pole    civil-defence siren on a 12 m pole, the horn head turning slowly (deterministic in t)
//   prop.tv            a flat TV on a low stand: flickering screen (news | weather | static) and a soft blue-white glow
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { plain } from '../shared/materials.js';
import { patchMaterial, U } from '../shared/env.js';
import { rng as makeRng, clamp, lerp, smooth } from '../shared/util.js';
import { ground, xz, DEG, patchAll, yawFromHeading } from './common.js';

const TAU = Math.PI * 2;
const LIGHTS = () => smooth((0.12 - U.uSunDir.value.y) / 0.2);
const hdg = (h) => ((((+h || 0) % 360) + 360) % 360);

// ── keys: [[t, v], ...] or [{t, v|deg|value}], smoothstep per segment ─────────────────────────────────────────────────
function keyList(k) {
  if (typeof k === 'number' && Number.isFinite(k)) return [[0, k]];
  if (k === true || k === false) return [[0, k ? 1 : 0]];
  if (!Array.isArray(k) || !k.length) return null;
  if (k.length === 2 && Number.isFinite(+k[0]) && Number.isFinite(+k[1]) && !Array.isArray(k[0])) k = [k];
  const L = [];
  for (const e of k) {
    if (Array.isArray(e) && e.length >= 2 && Number.isFinite(+e[0]) && Number.isFinite(+e[1])) L.push([+e[0], +e[1]]);
    else if (e && typeof e === 'object') { const v = e.v ?? e.deg ?? e.value ?? e.angle ?? e.lit; if (Number.isFinite(+e.t) && Number.isFinite(+v)) L.push([+e.t, +v]); }
  }
  if (!L.length) return null;
  return L.sort((a, b) => a[0] - b[0]);
}
function keyAt(L, t) {
  if (t <= L[0][0]) return L[0][1];
  for (let i = 1; i < L.length; i++) {
    if (t < L[i][0]) { const [ta, va] = L[i - 1], [tb, vb] = L[i]; return va + (vb - va) * smooth((t - ta) / Math.max(1e-6, tb - ta)); }
  }
  return L[L.length - 1][1];
}

// ── geometry helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
// box with UVs in metres (textures tile by size)
function boxM(w, h, d) { const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); } return g; }
// box spanning [x0,x1] x [y0,y1] x [z0,z1]
function bx(x0, x1, y0, y1, z0, z1, metric = true) { const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0); const g = metric ? boxM(w, h, d) : new THREE.BoxGeometry(w, h, d); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; }
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _M = new THREE.Matrix4();
function tf(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _M.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)); g.applyMatrix4(_M); return g; }
// a box between two points (rails, braces): local +X along a->b
function beam(a, b, w, h) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(); d.normalize();
  const g = boxM(L, h, w); _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d);
  _M.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1)); return g.applyMatrix4(_M);
}
function mergeList(list) {
  if (!list.length) return null;
  const keep = ['position', 'normal', 'uv', 'color'].filter((k) => list.every((g) => g.attributes[k]));
  const gs = list.map((g) => { const h = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(h.attributes)) if (!keep.includes(k)) h.deleteAttribute(k); h.morphAttributes = {}; return h; });
  return mergeGeometries(gs, false);
}
// geometry bins per material key, merged into one mesh each
class Bin {
  constructor() { this.m = new Map(); }
  add(key, g, M) { if (M) g.applyMatrix4(M); if (!this.m.has(key)) this.m.set(key, []); this.m.get(key).push(g); return g; }
  meshes(mats, parent, o = {}) {
    const out = {};
    for (const [key, list] of this.m) {
      const geo = mergeList(list); if (!geo || !mats[key]) continue;
      const mesh = new THREE.Mesh(geo, mats[key]); mesh.name = (o.prefix || '') + key;
      mesh.castShadow = o.cast ?? true; mesh.receiveShadow = true;
      if (o.noQA === true || (Array.isArray(o.noQA) && o.noQA.includes(key))) mesh.userData.noQA = true;
      parent.add(mesh); out[key] = mesh;
    }
    return out;
  }
}
// a colour attribute (per-vertex constant) so merged pieces can carry a per-piece factor
function tint(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }

// ── canvas textures ──────────────────────────────────────────────────────────────────────────────────────────────────
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function ctex(c, srgb = true, wrap = true) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t; }
// colour + normal maps from a per-pixel painter f(u, v) -> [r, g, b, height m]; `ppm` pixels per metre (normal scale)
function painted(w, h, ppm, f) {
  const [c1, g1] = canvas(w, h), [c2, g2] = canvas(w, h);
  const col = g1.createImageData(w, h), nor = g2.createImageData(w, h), H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const r = f(x / w, 1 - (y + 0.5) / h, x, y); const i = (y * w + x) * 4; col.data[i] = clamp(r[0], 0, 255); col.data[i + 1] = clamp(r[1], 0, 255); col.data[i + 2] = clamp(r[2], 0, 255); col.data[i + 3] = 255; H[y * w + x] = r[3] || 0; }
  const k = ppm / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const hx = H[y * w + (x + 1) % w] - H[y * w + (x - 1 + w) % w], hy = H[((y + 1) % h) * w + x] - H[((y - 1 + h) % h) * w + x];
    const nx = -hx * k, ny = hy * k, l = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
    nor.data[i] = (nx / l * 0.5 + 0.5) * 255; nor.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; nor.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nor.data[i + 3] = 255;
  }
  g1.putImageData(col, 0, 0); g2.putImageData(nor, 0, 0);
  return { map: ctex(c1, true), normalMap: ctex(c2, false) };
}
const hash = (a, b = 0, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; };
const vnoise = (x, s = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i, s), hash(i + 1, s), u); };

const TEXC = {};
// lap siding: `exp` m board exposure; the tile is 2 m wide and n boards tall
function sidingTex(exp) {
  const key = 'siding' + exp; if (TEXC[key]) return TEXC[key];
  const n = Math.max(3, Math.round(0.96 / exp)), V = n * exp, U2 = 2.0, W = 512, Hh = 512, ppm = Hh / V;
  const joints = []; for (let b = 0; b < n; b++) { const R = makeRng(71 + b * 13); joints.push(R() < 0.55 ? [R() * U2] : []); }
  const t = painted(W, Hh, ppm, (u, v) => {
    const vm = v * V, b = Math.min(n - 1, Math.floor(vm / exp)), f = vm / exp - b, um = u * U2;
    const tone = 0.965 + hash(b, 3) * 0.05, grain = 0.985 + vnoise(um * 9 + b * 7.1, 5) * 0.03 - vnoise(vm * 80, 9) * 0.01;
    let s = tone * grain;
    s *= 1 - 0.3 * smooth((f - 0.86) / 0.14);                                       // the lap's shadow under the next butt
    s *= 1 + 0.03 * (1 - f);
    let jd = 9; for (const j of joints[b]) jd = Math.min(jd, Math.abs(um - j));
    if (jd < 0.0025) s *= 0.86;
    const hgt = 0.011 * (1 - f) + (jd < 0.0025 ? -0.001 : 0);
    return [238 * s, 236 * s, 230 * s, hgt];
  });
  for (const x of [t.map, t.normalMap]) x.repeat.set(1 / U2, 1 / V);
  return (TEXC[key] = t);
}
// standing-seam metal (farmhouse) or three-tab asphalt shingles (suburban); u across the roof, v up the slope
function roofTex(kind) {
  const key = 'roof' + kind; if (TEXC[key]) return TEXC[key];
  let t;
  if (kind === 'metal') {
    const U2 = 1.8, V = 2.0, W = 256, Hh = 256;
    t = painted(W, Hh, W / U2, (u, v) => {
      const um = u * U2, p = Math.floor(um / 0.45), fu = um / 0.45 - p;
      const seam = Math.max(smooth(1 - fu / 0.05), smooth((fu - 0.95) / 0.05));
      const streak = vnoise(um * 14, 2) * 0.08 + vnoise(v * 3 + p, 4) * 0.05;
      const s = (0.9 + hash(p, 7) * 0.12 - streak) * (1 + seam * 0.18) * (fu > 0.05 && fu < 0.09 ? 0.86 : 1);
      const rust = smooth((vnoise(um * 3 + 11, 6) * vnoise(v * 5, 8) - 0.5) / 0.2) * 0.12;
      return [lerp(150 * s, 118, rust), lerp(154 * s, 96, rust), lerp(156 * s, 80, rust), seam * 0.02];
    });
    for (const x of [t.map, t.normalMap]) x.repeat.set(1 / U2, 1 / V);
  } else {
    const U2 = 1.0, V = 0.98, W = 256, Hh = 256, rowH = 0.14;
    t = painted(W, Hh, Hh / V, (u, v, px, py) => {
      const um = u * U2, vm = v * V, r = Math.floor(vm / rowH), fv = vm / rowH - r;
      const uu = um + (r % 2) * 0.1667, tab = Math.floor(uu / 0.3333), fu = uu / 0.3333 - tab;
      const slot = (fu < 0.018 || fu > 0.982) && fv < 0.55;
      const g = 0.86 + hash(px, py, 3) * 0.28;
      let s = (0.82 + hash(tab + r * 17, 5) * 0.3) * g;
      if (fv < 0.07) s *= 0.55 + fv * 5;
      if (slot) s *= 0.35;
      return [92 * s, 86 * s, 82 * s, 0.005 * (1 - fv) - (slot ? 0.003 : 0)];
    });
    for (const x of [t.map, t.normalMap]) x.repeat.set(1 / U2, 1 / V);
  }
  return (TEXC[key] = t);
}
// four-panel door (whole leaf in UV 0..1): colour is near-white shading, the material colour paints it
function doorTex() {
  if (TEXC.door) return TEXC.door;
  const Wm = 0.94, Hm = 2.06, W = 128, Hh = 280;
  const panels = [[0.13, 0.43, 0.24, 0.9], [0.51, 0.81, 0.24, 0.9], [0.13, 0.43, 1.08, 1.9], [0.51, 0.81, 1.08, 1.9]];
  TEXC.door = painted(W, Hh, Hh / Hm, (u, v) => {
    const x = u * Wm, y = v * Hm;
    let hgt = 0, edge = 1;
    for (const [x0, x1, y0, y1] of panels) if (x > x0 && x < x1 && y > y0 && y < y1) { const d = Math.min(x - x0, x1 - x, y - y0, y1 - y); hgt = -0.012 * smooth(d / 0.035); edge = d; }
    const grain = 0.94 + vnoise(x * 60 + vnoise(y * 3, 2) * 4, 1) * 0.08;
    const s = grain * (edge < 0.035 ? 0.93 : 1);
    return [226 * s, 222 * s, 216 * s, hgt];
  });
  for (const x of [TEXC.door.map, TEXC.door.normalMap]) { x.wrapS = x.wrapT = THREE.ClampToEdgeWrapping; }
  return TEXC.door;
}
// the room behind a lit window: warm walls, a lamp pool, curtains at the sides, a dark sofa back
function roomTex() {
  if (TEXC.room) return TEXC.room;
  const [c, g] = canvas(128, 128);
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#B07040'); gr.addColorStop(0.45, '#F0B878'); gr.addColorStop(1, '#6A4228');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const rg = g.createRadialGradient(84, 58, 2, 84, 58, 46); rg.addColorStop(0, 'rgba(255,236,190,0.95)'); rg.addColorStop(1, 'rgba(255,200,130,0)'); g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(40,22,12,0.85)'; g.fillRect(14, 96, 78, 32); g.fillRect(10, 88, 14, 40); g.fillRect(82, 88, 14, 40);   // sofa back
  g.fillStyle = 'rgba(60,34,18,0.9)'; g.fillRect(100, 70, 14, 58);                                                          // a lamp stand / shelf
  for (const [x0, x1] of [[0, 22], [106, 128]]) { for (let x = x0; x < x1; x++) { const f = 0.62 + 0.25 * Math.sin((x - x0) * 0.9); g.fillStyle = `rgb(${Math.round(196 * f)},${Math.round(150 * f)},${Math.round(104 * f)})`; g.fillRect(x, 0, 1, 128); } }
  TEXC.room = ctex(c, true, false);
  return TEXC.room;
}
function louvreTex() {
  if (TEXC.louvre) return TEXC.louvre;
  const [c, g] = canvas(32, 128); g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 32, 128);
  g.fillStyle = '#7a7a7a'; for (let y = 8; y < 120; y += 5) g.fillRect(4, y, 24, 2);
  g.fillStyle = '#b0b0b0'; g.fillRect(0, 0, 4, 128); g.fillRect(28, 0, 4, 128); g.fillRect(0, 0, 32, 5); g.fillRect(0, 123, 32, 5); g.fillRect(0, 62, 32, 4);
  return (TEXC.louvre = ctex(c, true, false));
}
function soft(w, h, inset) {      // a soft rounded-rectangle shadow (contact AO around a building)
  const key = 'soft' + inset; if (TEXC[key]) return TEXC[key];
  const [c, g] = canvas(w, h); g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.filter = `blur(${Math.round(inset * 0.45)}px)`; g.fillStyle = '#fff'; g.fillRect(inset, inset, w - inset * 2, h - inset * 2); g.filter = 'none';
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return (TEXC[key] = t);
}
function planksTex(key, o) { if (TEXC[key]) return TEXC[key]; const p = TX.planks(o); for (const x of [p.map, p.normalMap, p.roughnessMap]) { x.repeat.set(1 / p.meters, 1 / p.meters); } return (TEXC[key] = p); }
function brickTex() {
  if (TEXC.brick) return TEXC.brick;
  const b = TX.masonry({ size: 256, meters: 1.2, courseH: 0.075, blockL: [0.2, 0.24], tones: ['#8A4632', '#7A3C2C', '#94503A', '#6E3628'], mortar: '#A89E90', bevel: 0.006, chip: 0.3, seed: 11, dirt: 0.3 });
  for (const x of [b.map, b.normalMap, b.roughnessMap]) x.repeat.set(1 / 1.2, 1 / 1.2);
  return (TEXC.brick = b);
}
function stoneTex() {
  if (TEXC.stone) return TEXC.stone;
  const b = TX.masonry({ size: 256, meters: 2, courseH: 0.25, blockL: [0.3, 0.6], tones: ['#8C857A', '#7E776C', '#989083', '#716A60'], mortar: '#5E574E', bevel: 0.02, seed: 29, dirt: 0.5 });
  for (const x of [b.map, b.normalMap, b.roughnessMap]) x.repeat.set(1 / 2, 1 / 2);
  return (TEXC.stone = b);
}
function wallpaperTex() {
  if (TEXC.paper) return TEXC.paper;
  const [c, g] = canvas(64, 64); g.fillStyle = '#c9c0a8'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#b3a88e'; for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 5, 64);
  g.fillStyle = 'rgba(150,120,90,0.35)'; for (let y = 4; y < 64; y += 16) for (let x = 9; x < 64; x += 16) g.fillRect(x, y, 2, 4);
  const t = ctex(c, true); t.repeat.set(1 / 0.35, 1 / 0.35); return (TEXC.paper = t);
}

// terrain-following slab in a local frame: top at h(x, z) + top, with a skirt around its edges down to h - skirt
function slab(hL, x0, x1, z0, z1, top, skirt = 0.12, step = 0.5) {
  const nx = Math.max(1, Math.ceil((x1 - x0) / step)), nz = Math.max(1, Math.ceil((z1 - z0) / step));
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = lerp(x0, x1, i / nx), z = lerp(z0, z1, j / nz); pos.push(x, hL(x, z) + top, z); uv.push(x, -z); }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const parts = [g];
  if (skirt > 0) {
    const ring = []; for (let i = 0; i <= nx; i++) ring.push([lerp(x0, x1, i / nx), z1]); for (let j = nz; j >= 0; j--) ring.push([x1, lerp(z0, z1, j / nz)]);
    for (let i = nx; i >= 0; i--) ring.push([lerp(x0, x1, i / nx), z0]); for (let j = 0; j <= nz; j++) ring.push([x0, lerp(z0, z1, j / nz)]);
    const sp = [], su = [], si = []; let acc = 0;
    ring.forEach(([x, z], k) => { if (k) acc += Math.hypot(x - ring[k - 1][0], z - ring[k - 1][1]); const y = hL(x, z); sp.push(x, y + top, z, x, y - skirt, z); su.push(acc, top, acc, -skirt); });
    for (let k = 0; k < ring.length - 1; k++) { const a = k * 2, b = a + 1, c = a + 2, d = a + 3; si.push(a, b, c, c, b, d); }
    const s = new THREE.BufferGeometry(); s.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); s.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2)); s.setIndex(si); s.computeVertexNormals(); parts.push(s);
  }
  return mergeList(parts);
}
// wall panel: outline (rectangle, or a gable pentagon up to `peak`) with rectangular holes, extruded t; outer face at z = 0
function wallGeo(L, yb, yTop, t, holes, peak) {
  const s = new THREE.Shape();
  s.moveTo(-L / 2, yb); s.lineTo(L / 2, yb); s.lineTo(L / 2, yTop); if (peak) s.lineTo(0, peak); s.lineTo(-L / 2, yTop); s.lineTo(-L / 2, yb);
  for (const o of holes) { const p = new THREE.Path(); p.moveTo(o.x0, o.y0); p.lineTo(o.x1, o.y0); p.lineTo(o.x1, o.y1); p.lineTo(o.x0, o.y1); p.lineTo(o.x0, o.y0); s.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -t);
  return g;
}

// ══ landmark.house ═══════════════════════════════════════════════════════════════════════════════════════════════════
const HOUSE = {
  farmhouse: { W: 9.4, D: 7.2, t: 0.2, He: 6.0, pitch: 38, ov: 0.45, rake: 0.3, rth: 0.14, exp: 0.12, roof: 'metal', roofCol: 0xB4BAC0, roofMetal: 0.55, roofRough: 0.42,
    siding: '#F2F0EA', trim: 0xF7F6F2, door: '#5A3A24', shutter: '#27332B', found: 0.3, foundTex: 'stone', transom: true, Hc: 2.7, porch: true, lamp: 'hall',
    win: { w: 0.9, g0: 0.8, g1: 2.35, u0: 3.75, u1: 5.2, lites: 2 },
    front: { g: [-2.5, 2.5], u: [-2.5, 0, 2.5], shutters: true }, back: { g: [-2.2, 2.2], u: [-2.2, 2.2] }, side: { g: [-1.5, 1.5], u: [-1.5, 1.5], attic: true } },
  suburban: { W: 12.6, D: 8.4, t: 0.2, He: 2.8, pitch: 22, ov: 0.6, rake: 0.45, rth: 0.12, exp: 0.19, roof: 'shingle', roofCol: 0xFFFFFF, roofMetal: 0, roofRough: 0.9,
    siding: null, trim: 0xF4F3EE, door: '#7A2622', shutter: '#1E2226', found: 0.16, foundTex: 'concrete', transom: false, Hc: 2.45, porch: false, lamp: 'hall',
    win: { w: 0.95, g0: 0.95, g1: 2.25, lites: 1 },
    front: { g: [2.9, 4.8], picture: [-3.4, 2.4], shutters: true }, back: { g: [-4, -1.2, 2.5, 4.6] }, side: { g: [-1.8, 1.8] } },
};
const SUBURB_COLS = ['#A9B7A0', '#C9B99A', '#9FB2C2', '#E0D3AE', '#B8B4AA', '#C8A89A'];
const DOOR = { w: 0.9, h: 2.05, open: 0.94 };      // clear opening 0.9 x 2.05; the wall hole is 0.94 wide (2 cm linings)

let HMAT = null;
function houseMats() {
  if (HMAT) return HMAT;
  const T = TEX_HOUSE();
  HMAT = {
    trim: plain({ color: 0xF7F6F2, roughness: 0.6 }),
    glass: plain({ color: 0x0E1318, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.5, envMapIntensity: 1.3, depthWrite: false }),
    brass: plain({ color: 0xB08A40, roughness: 0.3, metalness: 1 }),
    black: plain({ color: 0x151515, roughness: 0.6 }),
    brick: plain({ map: T.brick.map, normalMap: T.brick.normalMap, roughness: 0.9 }),
    stone: plain({ map: T.stone.map, normalMap: T.stone.normalMap, roughness: 0.95 }),
    concrete: plain({ map: T.stucco, color: 0xA8A298, roughness: 0.95 }),
    deck: plain({ map: T.deck.map, normalMap: T.deck.normalMap, color: 0xB8B4AC, roughness: 0.8 }),
    oak: plain({ map: T.oak.map, normalMap: T.oak.normalMap, roughness: 0.55, envMapIntensity: 0.35 }),
    paper: plain({ map: T.paper, color: 0x9A9280, roughness: 0.92, envMapIntensity: 0.25 }),
    paint: plain({ map: T.stucco, color: 0x8E8A80, roughness: 0.92, envMapIntensity: 0.25 }),
    wains: plain({ color: 0x4A3626, roughness: 0.6, envMapIntensity: 0.3 }),
    ceil: plain({ color: 0x8C877C, roughness: 0.95, envMapIntensity: 0.2 }),
    stair: plain({ map: T.oak.map, color: 0x9A7A60, roughness: 0.55, envMapIntensity: 0.3 }),
    frame: plain({ color: 0x2A1E14, roughness: 0.5 }),
    art: plain({ color: 0x5E6A58, roughness: 0.8 }),
    haint: plain({ color: 0xA8C8C8, roughness: 0.8 }),
  };
  return HMAT;
}
// per house (each house animates its own glow): the room behind each window, dark when off, warm emissive when lit,
// a per-window factor through vertex colours; the hall lamp shade; the porch lantern
function glowMats() {
  const room = new THREE.MeshStandardMaterial({ map: roomTex(), emissiveMap: roomTex(), emissive: 0xFFFFFF, emissiveIntensity: 0, color: 0x3A3632, roughness: 1, side: THREE.BackSide, vertexColors: true, envMapIntensity: 0.15 });
  room.userData.progKey = 'f3dRoomWin';
  const glow = (c) => plain({ color: c, emissive: c, emissiveIntensity: 0, roughness: 0.5 });
  return { room: patchMaterial(room, (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif'); }),
    shade: glow(0xFFD9A0), lantern: glow(0xFFD49A) };
}
let TXH = null;
function TEX_HOUSE() {
  return (TXH ||= {
    brick: brickTex(), stone: stoneTex(), stucco: (() => { const s = TX.stucco(256); s.repeat.set(0.5, 0.5); return s; })(), paper: wallpaperTex(),
    deck: planksTex('deck', { size: 256, meters: 2, boardW: 0.1, tone: '#8C877E', tone2: '#A09A90', seed: 12 }),
    oak: planksTex('oak', { size: 256, meters: 2, boardW: 0.11, tone: '#4A3220', tone2: '#6A4A30', seed: 4 }),
  });
}

function buildHouse(item, ctx) {
  const style = item.style === 'suburban' || item.style === 'ranch' || item.style === 'bungalow' ? 'suburban' : 'farmhouse';
  const S = HOUSE[style], M = { ...houseMats(), ...glowMats() }, G = ground(ctx), at = xz(item.at), heading = hdg(item.heading ?? 180);
  const R = makeRng(((item.seed ?? 7) * 7919 + 13) >>> 0);
  const { W, D, t, He } = S, tp = Math.tan(S.pitch * DEG), yaw = yawFromHeading(heading), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const toW = (x, z) => [at[0] + x * cy + z * sy, at[1] - x * sy + z * cy];
  // floor level 0 = the terrain at the door threshold
  const thr = toW(0, D / 2), y0 = G.h(thr[0], thr[1]);
  const hL = (x, z) => { const w = toW(x, z); return G.h(w[0], w[1]) - y0; };
  let lo = 0; for (let k = 0; k <= 40; k++) { const f = k / 40; for (const [x, z] of [[lerp(-W / 2, W / 2, f), D / 2], [lerp(-W / 2, W / 2, f), -D / 2], [W / 2, lerp(-D / 2, D / 2, f)], [-W / 2, lerp(-D / 2, D / 2, f)], [lerp(-W / 2, W / 2, f), D / 2 + 2.4]]) lo = Math.min(lo, hL(x, z)); }
  const yb = lo - 0.35;
  // the root stands at the house (camera targets read root's position); `place` carries the heading
  const root = new THREE.Group(); root.name = 'landmark.house'; root.position.set(at[0], y0, at[1]);
  const place = new THREE.Group(); place.name = 'house:' + style; place.rotation.y = yaw; root.add(place);
  const walls = new THREE.Group(); walls.name = 'house:walls'; place.add(walls);
  const bin = new Bin(), sidingCol = new THREE.Color(item.color || S.siding || SUBURB_COLS[Math.floor(R() * SUBURB_COLS.length)]);
  const sidingT = sidingTex(S.exp);
  const siding = plain({ map: sidingT.map, normalMap: sidingT.normalMap, color: sidingCol, roughness: 0.78 });
  const roofT = roofTex(S.roof);
  const roofM = plain({ map: roofT.map, normalMap: roofT.normalMap, color: item.roof_color ? new THREE.Color(item.roof_color) : S.roofCol, roughness: S.roofRough, metalness: S.roofMetal });
  const shutterM = plain({ map: louvreTex(), color: new THREE.Color(item.shutter_color || S.shutter), roughness: 0.7 });
  const doorT = doorTex();
  const doorM = plain({ map: doorT.map, normalMap: doorT.normalMap, color: new THREE.Color(item.door_color || S.door), roughness: 0.5 });
  const trimM = item.trim_color ? plain({ color: new THREE.Color(item.trim_color), roughness: 0.6 }) : M.trim;
  const mats = { ...M, trim: trimM, siding, roof: roofM, shutter: shutterM };

  // ── wall frames: front (+Z), back, right (+X), left; local x runs left -> right seen from outside, outer face z = 0
  const Ls = D - 2 * t, peakS = He + (D / 2) * tp, topS = He + t * tp;
  const frames = {
    front: new THREE.Matrix4().compose(new THREE.Vector3(0, 0, D / 2), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
    back: new THREE.Matrix4().compose(new THREE.Vector3(0, 0, -D / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), new THREE.Vector3(1, 1, 1)),
    right: new THREE.Matrix4().compose(new THREE.Vector3(W / 2, 0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1)),
    left: new THREE.Matrix4().compose(new THREE.Vector3(-W / 2, 0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2), new THREE.Vector3(1, 1, 1)),
  };
  const Wn = S.win, openings = { front: [], back: [], right: [], left: [] };
  const addWin = (side, cx, y0w, y1w, w, o = {}) => openings[side].push({ x0: cx - w / 2, x1: cx + w / 2, y0: y0w, y1: y1w, cx, w, kind: 'win', ...o });
  const doorTop = S.transom ? 2.45 : 2.07;
  openings.front.push({ x0: -DOOR.open / 2, x1: DOOR.open / 2, y0: 0, y1: doorTop, cx: 0, w: DOOR.open, kind: 'door' });
  for (const x of S.front.g || []) addWin('front', x, Wn.g0, Wn.g1, Wn.w, { shutters: S.front.shutters });
  if (S.front.picture) addWin('front', S.front.picture[0], 0.8, 2.25, S.front.picture[1], { picture: true, shutters: S.front.shutters });
  for (const x of S.front.u || []) addWin('front', x, Wn.u0, Wn.u1, Wn.w, { shutters: S.front.shutters });
  for (const x of S.back.g || []) addWin('back', x, Wn.g0, Wn.g1, Wn.w);
  for (const x of S.back.u || []) addWin('back', x, Wn.u0, Wn.u1, Wn.w);
  for (const side of ['right', 'left']) {
    for (const x of S.side.g || []) addWin(side, x, Wn.g0, Wn.g1, Wn.w, { shutters: style === 'farmhouse' });
    for (const x of S.side.u || []) addWin(side, x, Wn.u0, Wn.u1, Wn.w, { shutters: style === 'farmhouse' });
    if (S.side.attic) addWin(side, 0, He + 0.4, He + 1.25, 0.6, { attic: true });
  }
  // walls: one mesh per wall (the camera QA sees four thin slabs, so a camera may stand in the hall)
  for (const side of ['front', 'back', 'right', 'left']) {
    const gable = side === 'right' || side === 'left';
    const g = wallGeo(gable ? Ls : W, yb, gable ? topS : He, t, openings[side], gable ? peakS : null).applyMatrix4(frames[side]);
    const m = new THREE.Mesh(g, siding); m.name = 'house:wall:' + side; m.castShadow = m.receiveShadow = true; walls.add(m);
  }
  // window dressing, per wall in its frame
  const Fm = new THREE.Matrix4();
  let wi = 0;
  for (const side of ['front', 'back', 'right', 'left']) {
    Fm.copy(frames[side]);
    const add = (key, g) => bin.add(key, g, Fm);
    for (const o of openings[side]) {
      const { x0, x1, y0: a0, y1: a1 } = o, cw = o.attic ? 0.08 : 0.1;
      if (o.kind === 'door') {
        add('trim', bx(x0 - cw, x0, 0, a1 + 0.1, 0, 0.03)); add('trim', bx(x1, x1 + cw, 0, a1 + 0.1, 0, 0.03));
        add('trim', bx(x0 - cw - 0.04, x1 + cw + 0.04, a1 + 0.1, a1 + 0.27, 0, 0.045)); add('trim', bx(x0 - cw - 0.07, x1 + cw + 0.07, a1 + 0.27, a1 + 0.31, -0.01, 0.075));
        add('trim', bx(x0, x0 + 0.02, 0, a1, -t, 0)); add('trim', bx(x1 - 0.02, x1, 0, a1, -t, 0)); add('trim', bx(x0, x1, a1 - 0.02, a1, -t, 0));
        add('oakdoor', bx(x0, x1, -0.12, 0.018, -t - 0.02, 0.035));                                                  // threshold
        if (S.transom) { add('trim', bx(x0, x1, 2.07, 2.12, -t, 0)); const gl = new THREE.PlaneGeometry(x1 - x0 - 0.04, a1 - 2.14); gl.translate(0, (2.12 + a1 - 0.02) / 2, -0.1); add('glass', gl);
          add('trim', bx(-0.012, 0.012, 2.12, a1 - 0.02, -0.12, -0.08)); }
        continue;
      }
      const hgt = a1 - a0, w = x1 - x0;
      add('trim', bx(x0 - cw, x0, a0, a1 + cw * 0.6, 0, 0.028)); add('trim', bx(x1, x1 + cw, a0, a1 + cw * 0.6, 0, 0.028));
      add('trim', bx(x0 - cw - 0.03, x1 + cw + 0.03, a1, a1 + cw * 1.5, 0, 0.04));
      add('trim', bx(x0 - cw - 0.05, x1 + cw + 0.05, a0 - 0.05, a0 + 0.012, -0.12, 0.06));                          // sill
      add('trim', bx(x0, x0 + 0.015, a0, a1, -t, 0)); add('trim', bx(x1 - 0.015, x1, a0, a1, -t, 0)); add('trim', bx(x0, x1, a1 - 0.015, a1, -t, 0));
      // sashes: frame, meeting rail, muntins
      const zs0 = -0.1, zs1 = -0.055;
      add('trim', bx(x0 + 0.015, x0 + 0.065, a0, a1 - 0.015, zs0, zs1)); add('trim', bx(x1 - 0.065, x1 - 0.015, a0, a1 - 0.015, zs0, zs1));
      add('trim', bx(x0 + 0.015, x1 - 0.015, a1 - 0.075, a1 - 0.015, zs0, zs1)); add('trim', bx(x0 + 0.015, x1 - 0.015, a0 + 0.012, a0 + 0.09, zs0, zs1));
      if (!o.picture) {
        const ym = (a0 + a1) / 2; add('trim', bx(x0 + 0.015, x1 - 0.015, ym - 0.03, ym + 0.03, zs0 - 0.02, zs1));
        if (Wn.lites > 1 || o.attic) add('trim', bx(o.cx - 0.012, o.cx + 0.012, a0 + 0.09, a1 - 0.075, zs0 + 0.01, zs1 - 0.005));
      } else for (const f of [1 / 4, 3 / 4]) add('trim', bx(x0 + w * f - 0.03, x0 + w * f + 0.03, a0 + 0.09, a1 - 0.075, zs0, zs1));
      const gl = new THREE.PlaneGeometry(w - 0.04, hgt - 0.03); gl.translate(o.cx, (a0 + a1) / 2, -0.08); add('glass', gl);
      // the room behind: a box seen from inside (back faces), per-window brightness
      const f = o.attic ? 0.45 : (R() < 0.22 ? 0.12 : 0.6 + R() * 0.4), rb = new THREE.BoxGeometry(w + 0.5, hgt + 0.3, 0.9);
      rb.translate(o.cx + (R() - 0.5) * 0.1, (a0 + a1) / 2, -t - 0.45); add('room', tint(rb, [f, f * (0.92 + R() * 0.08), f * (0.85 + R() * 0.15)]));
      wi++;
      if (o.shutters && !o.attic) {
        const sw = o.picture ? 0.55 : w / 2 + 0.02;
        for (const s of [-1, 1]) { const sg = new THREE.BoxGeometry(sw, hgt + 0.06, 0.03); sg.translate(s < 0 ? x0 - cw - 0.02 - sw / 2 : x1 + cw + 0.02 + sw / 2, (a0 + a1) / 2, 0.035); add('shutter', sg); }
      }
    }
  }
  // corner boards, frieze, foundation band
  const cb = 0.13, tr = 0.03;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    bin.add('trim', bx(sx * W / 2 - (sx > 0 ? cb : 0), sx * W / 2 + (sx > 0 ? 0 : cb), S.found, He, sz * D / 2 - (sz > 0 ? 0 : tr), sz * D / 2 + (sz > 0 ? tr : 0)));
    bin.add('trim', bx(sx * W / 2 - (sx > 0 ? 0 : tr), sx * W / 2 + (sx > 0 ? tr : 0), S.found, He, sz * D / 2 - (sz > 0 ? cb : -tr), sz * D / 2 + (sz > 0 ? tr : cb)));
  }
  for (const sz of [-1, 1]) bin.add('trim', bx(-W / 2 - tr, W / 2 + tr, He - 0.22, He, sz * D / 2 - (sz > 0 ? 0 : tr), sz * D / 2 + (sz > 0 ? tr : 0)));
  const fk = S.foundTex === 'stone' ? 'stone' : 'concrete', fo = 0.04, dx0 = -DOOR.open / 2 - 0.1, dx1 = DOOR.open / 2 + 0.1;
  bin.add(fk, bx(-W / 2 - fo, dx0, yb, S.found, D / 2 - t, D / 2 + fo)); bin.add(fk, bx(dx1, W / 2 + fo, yb, S.found, D / 2 - t, D / 2 + fo));
  bin.add(fk, bx(-W / 2 - fo, W / 2 + fo, yb, S.found, -D / 2 - fo, -D / 2 + t));
  for (const sx of [-1, 1]) bin.add(fk, bx(sx > 0 ? W / 2 - t : -W / 2 - fo, sx > 0 ? W / 2 + fo : -W / 2 + t, yb, S.found, -D / 2 + t, D / 2 - t));
  // ── roof: two slopes (one mesh each), fascia, rake boards, ridge cap, chimney
  const roofG = new THREE.Group(); roofG.name = 'house:roof'; place.add(roofG);
  const rth = S.rth, Lsl = (D / 2 + S.ov) / Math.cos(S.pitch * DEG), p = S.pitch * DEG, RW = W + 2 * S.rake;
  for (const s of [1, -1]) {
    const g = boxM(RW, rth, Lsl);
    const zm = s * (D / 2 + S.ov) / 2, yBot = He + (D / 2 - Math.abs(zm)) * tp;
    tf(g, 0, yBot + (rth / 2) * Math.cos(p), zm + s * (rth / 2) * Math.sin(p), s * p, 0, 0);
    const m = new THREE.Mesh(g, roofM); m.name = 'house:roof:' + (s > 0 ? 'front' : 'back'); m.castShadow = m.receiveShadow = true; roofG.add(m);
    const ye = He - S.ov * tp;                                                                                      // eave fascia
    bin.add('trim', bx(-RW / 2 - 0.02, RW / 2 + 0.02, ye - 0.16, ye + rth / Math.cos(p) + 0.02, s > 0 ? D / 2 + S.ov - 0.01 : -D / 2 - S.ov - 0.04, s > 0 ? D / 2 + S.ov + 0.04 : -D / 2 - S.ov + 0.01));
    for (const sx of [-1, 1]) {                                                                                      // rake boards
      const a = [sx * (RW / 2 + 0.01), ye - 0.1, s * (D / 2 + S.ov)], b = [sx * (RW / 2 + 0.01), He + (D / 2) * tp - 0.08, 0];
      bin.add('trim', beam(a, b, 0.04, 0.2));
    }
  }
  const yr = He + (D / 2) * tp + rth / Math.cos(p);
  bin.add('roof', tf(boxM(RW + 0.04, 0.07, 0.34), 0, yr - 0.01, 0));
  { const cx = style === 'farmhouse' ? 2.6 : -W / 2 + 1.6, cz = -0.5, top = yr + 0.9; bin.add('brick', bx(cx - 0.32, cx + 0.32, He - 0.5, top, cz - 0.3, cz + 0.3)); bin.add('concrete', bx(cx - 0.38, cx + 0.38, top, top + 0.08, cz - 0.36, cz + 0.36)); }

  // ── the front door: leaf on a pivot at the left jamb (seen from outside), at the inner face of the wall; swings inward
  const zi = D / 2 - t;
  const pivot = new THREE.Group(); pivot.name = 'house:doorPivot'; pivot.position.set(-DOOR.open / 2, 0.006, zi); place.add(pivot);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR.open, 2.058, 0.045).translate(DOOR.open / 2, 2.058 / 2, -0.0225), doorM); leaf.name = 'house:door'; leaf.castShadow = leaf.receiveShadow = true; pivot.add(leaf);
  for (const [z, s] of [[0.004, 1], [-0.049, -1]]) {
    const k1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 16).rotateX(Math.PI / 2), M.brass); k1.position.set(DOOR.open - 0.075, 0.97, z + s * 0.006); pivot.add(k1);
    const k2 = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 8).rotateX(Math.PI / 2), M.brass); k2.position.set(DOOR.open - 0.075, 0.97, z + s * 0.03); pivot.add(k2);
    const k3 = new THREE.Mesh(new THREE.SphereGeometry(0.029, 16, 12), M.brass); k3.position.set(DOOR.open - 0.075, 0.97, z + s * 0.058); pivot.add(k3);
    const k4 = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12).rotateX(Math.PI / 2), M.brass); k4.position.set(DOOR.open - 0.075, 1.12, z + s * 0.006); pivot.add(k4);
  }
  for (const y of [0.25, 1.0, 1.8]) { const hg = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.1, 8), M.brass); hg.position.set(0.004, y, -0.05); pivot.add(hg); }

  // ── the entrance hall (hollow): walls, ceiling, floor on the terrain, wainscot, stairs, table + lamp, a picture
  const hall = new THREE.Group(); hall.name = 'house:hall'; place.add(hall);
  const Hc = S.Hc, xl = -DOOR.open / 2 - 0.06, xr = 1.15, zb = zi - 3.4, hb = Math.min(-0.2, lo - 0.2);
  const hbin = new Bin();
  hbin.add(style === 'farmhouse' ? 'paper' : 'paint', bx(xl - 0.1, xl, hb, Hc, zb - 0.1, zi));
  hbin.add(style === 'farmhouse' ? 'paper' : 'paint', bx(xr, xr + 0.1, hb, Hc, zb - 0.1, zi));
  hbin.add(style === 'farmhouse' ? 'paper' : 'paint', bx(xl - 0.1, xr + 0.1, hb, Hc, zb - 0.1, zb));
  hbin.add('ceil', bx(xl - 0.1, xr + 0.1, Hc, Hc + 0.08, zb - 0.1, zi));
  // the front wall seen from inside: a lining beside and over the door (clear of the leaf's swing), inside casing
  const pk = style === 'farmhouse' ? 'paper' : 'paint', ho = DOOR.open / 2;
  hbin.add(pk, bx(ho + 0.1, xr, hb, Hc, zi - 0.012, zi)); hbin.add(pk, bx(xl, xr, doorTop + 0.12, Hc, zi - 0.012, zi));
  hbin.add(pk, bx(xl, -ho, 2.08, doorTop + 0.12, zi - 0.012, zi)); hbin.add(pk, bx(xl, -ho - 0.048, hb, 2.08, zi - 0.012, zi));   // hinge side: above / beside the open leaf
  hbin.add('trim', bx(ho, ho + 0.1, hb, doorTop + 0.12, zi - 0.03, zi)); hbin.add('trim', bx(-ho, ho + 0.1, doorTop, doorTop + 0.12, zi - 0.03, zi));
  hbin.add('wains', bx(ho + 0.1, xr, hb, 0.92, zi - 0.03, zi - 0.012));
  hbin.add('wains', bx(xl, xl + 0.018, hb, 0.92, zb, zi)); hbin.add('wains', bx(xr - 0.018, xr, hb, 0.92, zb, zi - 1.5)); hbin.add('wains', bx(xl, xr, hb, 0.92, zb, zb + 0.018));
  hbin.add('trim', bx(xl, xl + 0.035, 0.92, 0.97, zb, zi)); hbin.add('trim', bx(xl, xr, 0.92, 0.97, zb, zb + 0.035));
  hbin.add('trim', bx(xl - 0.1, xr + 0.1, Hc - 0.08, Hc, zi - 0.03, zi));
  const fl = slab(hL, xl, xr, zb, zi, 0.018, 0.15, 0.4); hbin.add('oak', fl);
  { // stairs up toward the back on the right, a newel post, handrail and balusters
    const zs = zi - 1.45, xs0 = 0.3, ys = hL(0.7, zs) + 0.018; let k = 0;
    for (; zs - (k + 1) * 0.26 > zb - 0.001 && k < 12; k++) {
      hbin.add('stair', bx(xs0, xr, hb, ys + (k + 1) * 0.2, zs - (k + 1) * 0.26, zs - k * 0.26));
      hbin.add('trim', bx(xs0 - 0.02, xr, ys + (k + 1) * 0.2 - 0.03, ys + (k + 1) * 0.2, zs - (k + 1) * 0.26 - 0.02, zs - k * 0.26 + 0.02));
    }
    hbin.add('stair', bx(xs0, xr, hb, ys + k * 0.2, zb, zs - k * 0.26));
    hbin.add('frame', bx(xs0 - 0.05, xs0 + 0.05, ys - 0.05, ys + 1.1, zs - 0.02, zs + 0.08));
    const top = [xs0, ys + k * 0.2 + 0.9, zb + 0.05]; hbin.add('frame', beam([xs0, ys + 1.02, zs + 0.03], top, 0.06, 0.05));
    for (let j = 0; j < k; j++) { const zz = zs - j * 0.26 - 0.13, y1 = ys + (j + 1) * 0.2, yt = lerp(ys + 1.02, top[1], (zs - zz) / (zs - zb)); hbin.add('trim', bx(xs0 - 0.015, xs0 + 0.015, y1, yt, zz - 0.015, zz + 0.015)); }
  }
  // console table + lamp at the back wall, a picture above it
  const tx0 = xl + 0.08, tx1 = 0.18, tz = zb + 0.3, ty = hL((tx0 + tx1) / 2, zb + 0.15) + 0.018;
  hbin.add('frame', bx(tx0, tx1, ty + 0.76, ty + 0.8, zb, tz));
  for (const x of [tx0 + 0.03, tx1 - 0.03]) for (const z of [zb + 0.03, tz - 0.03]) hbin.add('frame', bx(x - 0.02, x + 0.02, ty - 0.05, ty + 0.76, z - 0.02, z + 0.02));
  const lx = (tx0 + tx1) / 2 - 0.08, lz = zb + 0.16;
  hbin.add('brass', tf(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 12), lx, ty + 0.95, lz));
  hbin.add('frame', bx(-0.05, 0.4, 1.35, 1.72, zb, zb + 0.03)); hbin.add('art', bx(-0.01, 0.36, 1.39, 1.68, zb + 0.03, zb + 0.035));
  hbin.meshes(mats, hall, { prefix: 'house:hall:', noQA: true });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.22, 20, 1, true), M.shade); shade.material.side = THREE.DoubleSide; shade.position.set(lx, ty + 1.2, lz); hall.add(shade);
  const lamps = item.lamps !== false;          // lamps:false = emissive only, no PointLights (many houses in one shot)
  const hallLamp = new THREE.PointLight(0xFFB870, 0, 3.6, 1.6); hallLamp.position.set(lx, ty + 1.15, lz + 0.25); if (lamps) hall.add(hallLamp);

  // ── porch (farmhouse): deck on the ground, posts, beam, railing, shed roof, a lantern; stoop + walk (suburban)
  let porchLight = null, lantern = null;
  if (S.porch) {
    const Wp = 7.4, dp = 2.3, zf = D / 2, zpost = zf + dp - 0.1, px = [-Wp / 2 + 0.15, -1.25, 1.25, Wp / 2 - 0.15];
    const deck = slab(hL, -Wp / 2, Wp / 2, zf - 0.05, zf + dp, 0.018, 0.2, 0.5); bin.add('deck', deck);
    const yBeam = 2.62, q = Math.atan2(3.35 - (yBeam + 0.2), zpost - zf);
    for (const x of px) { const yd = hL(x, zpost) + 0.018; bin.add('trim', bx(x - 0.07, x + 0.07, yd, yBeam, zpost - 0.07, zpost + 0.07)); bin.add('trim', bx(x - 0.1, x + 0.1, yd, yd + 0.18, zpost - 0.1, zpost + 0.1)); bin.add('trim', bx(x - 0.1, x + 0.1, yBeam - 0.12, yBeam, zpost - 0.1, zpost + 0.1)); }
    bin.add('trim', bx(-Wp / 2 + 0.02, Wp / 2 - 0.02, yBeam, yBeam + 0.2, zpost - 0.08, zpost + 0.08));
    const Lq = (dp + 0.25 + 0.1) / Math.cos(q), pg = boxM(Wp + 0.3, 0.1, Lq), zmid = zf - 0.1 + (dp + 0.25 + 0.1) / 2;
    const ybot = 3.35 - (zmid - zf) * Math.tan(q);
    tf(pg, 0, ybot + 0.05 * Math.cos(q), zmid + 0.05 * Math.sin(q), q, 0, 0);
    const pm = new THREE.Mesh(pg, roofM); pm.name = 'house:roof:porch'; pm.castShadow = pm.receiveShadow = true; roofG.add(pm);
    { const ze = zf + dp + 0.25, ye = 3.35 - (ze - zf) * Math.tan(q); bin.add('trim', bx(-Wp / 2 - 0.17, Wp / 2 + 0.17, ye - 0.15, ye + 0.1, ze - 0.01, ze + 0.03)); }
    // porch ceiling (haint blue) under the roof, closed at the ends by triangular boards
    { const s = new THREE.Shape(); s.moveTo(zf, yBeam + 0.2); s.lineTo(zpost + 0.08, yBeam + 0.2); s.lineTo(zf, 3.35); s.lineTo(zf, yBeam + 0.2);
      for (const sx of [-1, 1]) { const eg = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }); eg.rotateY(-Math.PI / 2); eg.translate(sx * (Wp / 2) + (sx > 0 ? 0.03 : 0), 0, 0); bin.add('trim', eg); }
      bin.add('haint', bx(-Wp / 2, Wp / 2, yBeam + 0.2, yBeam + 0.22, zf, zpost + 0.08)); }
    // railing between the posts (open in the middle for the steps-free entry) and along the sides
    const rail = (a, b) => {
      const ya = hL(a[0], a[1]) + 0.018, yb2 = hL(b[0], b[1]) + 0.018, L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.floor(L / 0.12));
      bin.add('trim', beam([a[0], ya + 0.88, a[1]], [b[0], yb2 + 0.88, b[1]], 0.08, 0.05)); bin.add('trim', beam([a[0], ya + 0.12, a[1]], [b[0], yb2 + 0.12, b[1]], 0.06, 0.05));
      for (let k = 1; k < n; k++) { const f = k / n, x = lerp(a[0], b[0], f), z = lerp(a[1], b[1], f), yy = lerp(ya, yb2, f); bin.add('trim', bx(x - 0.018, x + 0.018, yy + 0.12, yy + 0.86, z - 0.018, z + 0.018)); }
    };
    rail([px[0] + 0.07, zpost], [px[1] - 0.07, zpost]); rail([px[2] + 0.07, zpost], [px[3] - 0.07, zpost]);
    for (const sx of [-1, 1]) rail([sx * (Wp / 2 - 0.15), zf + 0.05], [sx * (Wp / 2 - 0.15), zpost - 0.07]);
    lantern = new THREE.Mesh(boxM(0.14, 0.22, 0.12), M.lantern); lantern.position.set(0.82, 1.92, zf + 0.09); place.add(lantern);
    bin.add('black', bx(0.73, 0.91, 2.03, 2.07, zf, zf + 0.17)); bin.add('black', bx(0.8, 0.84, 1.8, 1.9, zf, zf + 0.04));
    porchLight = new THREE.PointLight(0xFFC27A, 0, 5.5, 2); porchLight.position.set(0.82, 1.85, zf + 0.5); if (lamps) place.add(porchLight);
  } else {
    const zf = D / 2, walk = Math.max(0, +(item.walk ?? 6));
    bin.add('concrete', slab(hL, -0.9, 0.9, zf - 0.05, zf + 1.4, 0.018, 0.15, 0.45));
    if (walk > 0) bin.add('concrete', slab(hL, -0.55, 0.55, zf + 1.4, zf + 1.4 + walk, 0.016, 0.12, 0.6));
    lantern = new THREE.Mesh(boxM(0.13, 0.2, 0.11), M.lantern); lantern.position.set(0.78, 1.85, zf + 0.085); place.add(lantern);
    bin.add('black', bx(0.7, 0.86, 1.96, 1.99, zf, zf + 0.15));
    porchLight = new THREE.PointLight(0xFFC27A, 0, 5, 2); porchLight.position.set(0.78, 1.8, zf + 0.5); if (lamps) place.add(porchLight);
  }
  // trim sharing the oak threshold material
  mats.oakdoor = M.oak;
  const det = new THREE.Group(); det.name = 'house:details'; place.add(det);
  bin.meshes(mats, det, { prefix: 'house:', noQA: true });

  // contact AO: a soft dark rectangle on the terrain around the base (named contactShadow: the registry adds no blob)
  {
    const mw = W + 1.6, md = D + (S.porch ? 2.3 : 1.4) + 1.6, zc = (S.porch ? 2.3 : 1.4) / 2, n = 24;
    const g = new THREE.PlaneGeometry(mw, md, n, n); g.rotateX(-Math.PI / 2); g.translate(0, 0, zc);
    const P = g.attributes.position; for (let i = 0; i < P.count; i++) P.setY(i, hL(P.getX(i), P.getZ(i)) + 0.008);      // under the deck / floors (they sit at +0.018)
    g.computeVertexNormals();
    const sm = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: soft(128, 128, 18), transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const sh = new THREE.Mesh(g, sm); sh.name = 'contactShadow'; sh.renderOrder = 2; sh.userData.noQA = true; sh.castShadow = false; sh.receiveShadow = false; place.add(sh);
  }

  // ── anchors
  root.updateMatrixWorld(true);
  const door = new THREE.Object3D(); door.name = 'house:door:anchor'; door.position.set(0, 0, D / 2); place.add(door); door.updateMatrixWorld(true);
  const inside = toW(0, D / 2 - 1.0), outside = toW(0, D / 2 + 1.5);
  door.userData = { width: DOOR.w, height: DOOR.h, hinge: 'left', swing: 'in', heading, inside, outside, thickness: t, hingeAt: toW(-DOOR.open / 2, zi) };
  const dw = door.getWorldPosition(new THREE.Vector3());
  door.pos = [dw.x, dw.y, dw.z]; door.heading = heading; door.w = DOOR.w; door.h = DOOR.h;
  const center = new THREE.Object3D(); center.position.set(0, 0, 0); place.add(center);
  const hallA = new THREE.Object3D(); hallA.position.set(0, 0, zi - 1.0); place.add(hallA);
  const lampA = new THREE.Object3D(); lampA.position.copy(hallLamp.position); hall.add(lampA);
  const chimney = new THREE.Object3D(); chimney.position.set(style === 'farmhouse' ? 2.6 : -W / 2 + 1.6, yr + 1.0, -0.5); place.add(chimney);

  // ── animation
  const doorKeys = keyList(item.door ?? item.params?.door), litKeys = keyList(item.lit ?? item.params?.lit);
  let manual = null;
  const setAngle = (deg) => { pivot.rotation.y = clamp(+deg || 0, -5, 115) * DEG; };
  const litAt = (tt) => clamp(litKeys ? keyAt(litKeys, tt) : LIGHTS(), 0, 1.5);
  const update = (tt = 0) => {
    setAngle(manual != null ? manual : doorKeys ? keyAt(doorKeys, tt) : 0);
    const L = litAt(tt), night = LIGHTS(), nk = lerp(1, 0.5, clamp(U.uNight.value));      // exposure is higher at night
    M.room.emissiveIntensity = 2.1 * L * nk;
    const hl = Math.max(L, 0.3 * night);
    hallLamp.intensity = 5.0 * hl; M.shade.emissiveIntensity = 1.8 * hl * nk;
    if (porchLight) { porchLight.intensity = 1.6 * L; M.lantern.emissiveIntensity = 1.0 * L * nk; }
  };
  update(0);
  patchAll(root, ctx);
  const radius = Math.hypot(W, D + (S.porch ? 4.6 : 2.8)) / 2;
  return {
    root, radius, height: yr + 1, update, snapped: true, footprint: [W, D],
    setDoor: (deg) => { manual = deg == null ? null : +deg; setAngle(manual ?? 0); },
    doorAngle: (tt) => (manual != null ? manual : doorKeys ? keyAt(doorKeys, tt) : 0),
    anchors: { door, center, hall: hallA, lamp: lampA, chimney, smoke: chimney },
  };
}

// ══ prop.sign ════════════════════════════════════════════════════════════════════════════════════════════════════════
function signFace(style, text) {
  const key = 'sign:' + style + ':' + (text || ''); if (TEXC[key]) return TEXC[key];
  let c, g;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const fit = (s, y, maxW, size, weight = 700) => { let sz = size; do { g.font = `${weight} ${sz}px Inter, Arial, sans-serif`; sz -= 2; } while (g.measureText(s).width * 0.86 > maxW && sz > 10); g.save(); g.translate(c.width / 2, y); g.scale(0.86, 1); g.fillText(s, 0, 0); g.restore(); };
  if (style === 'stop') {
    [c, g] = canvas(512, 512); g.fillStyle = '#9a9ea2'; g.fillRect(0, 0, 512, 512);
    const oct = (r, col) => { g.beginPath(); for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; g.lineTo(256 + Math.cos(a) * r, 256 - Math.sin(a) * r); } g.closePath(); g.fillStyle = col; g.fill(); };
    oct(256, '#C8102E'); oct(240, '#FFFFFF'); oct(228, '#C8102E');
    g.fillStyle = '#FFFFFF'; g.textAlign = 'center'; g.textBaseline = 'middle'; fit(text ? String(text).toUpperCase().slice(0, 8) : 'STOP', 262, 380, 150);
  } else if (style === 'blank') {
    [c, g] = canvas(512, 384); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, 512, 384);
    g.lineWidth = 12; g.strokeStyle = '#111'; rr(14, 14, 484, 356, 26); g.stroke();
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = String(text || '').toUpperCase().split(/\n|\|/).slice(0, 3);
    lines.forEach((s, i) => fit(s, 192 + (i - (lines.length - 1) / 2) * 110, 440, 96));
  } else {
    [c, g] = canvas(512, 640); g.fillStyle = '#1A4A96'; g.fillRect(0, 0, 512, 640);
    g.lineWidth = 12; g.strokeStyle = '#FFFFFF'; rr(16, 16, 480, 608, 30); g.stroke();
    // the hurricane symbol: a ring (the eye wall) with two swept arms
    g.save(); g.translate(256, 222); g.fillStyle = '#FFFFFF';
    for (const s of [1, -1]) { g.save(); g.rotate(s < 0 ? Math.PI : 0); g.beginPath(); g.moveTo(-8, -52); g.bezierCurveTo(40, -150, 150, -150, 168, -96); g.bezierCurveTo(118, -118, 64, -104, 46, -34); g.closePath(); g.fill(); g.restore(); }
    g.beginPath(); g.arc(0, 0, 70, 0, TAU); g.fill(); g.fillStyle = '#1A4A96'; g.beginPath(); g.arc(0, 0, 32, 0, TAU); g.fill(); g.restore();
    g.fillStyle = '#FFFFFF'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fit('HURRICANE', 395, 430, 62); fit('EVACUATION', 470, 440, 76); fit('ROUTE', 552, 430, 80);
  }
  const t = ctex(c, true, false); t.anisotropy = 8;
  return (TEXC[key] = { tex: t, aspect: c.width / c.height });
}
function buildSign(item, ctx) {
  const G = ground(ctx), at = xz(item.at), style = ['stop', 'blank'].includes(item.style) ? item.style : 'evacuation_route';
  const root = new THREE.Group(); root.name = 'prop.sign'; root.position.set(at[0], G.h(at[0], at[1]), at[1]); root.rotation.y = yawFromHeading(hdg(item.heading ?? 180));
  const galv = plain({ color: 0x9EA3A6, roughness: 0.45, metalness: 0.8 }), alu = plain({ color: 0xB9BDC0, roughness: 0.5, metalness: 0.7 });
  const F = signFace(style, item.text);
  const face = plain({ map: F.tex, roughness: 0.45, emissiveMap: F.tex, emissive: 0xFFFFFF, emissiveIntensity: 0.06 });
  const H = +(item.height ?? 2.25);
  let top;
  if (style === 'stop') {
    const r = 0.38, cy = H - r;
    const f = new THREE.Mesh(new THREE.CircleGeometry(r, 8, Math.PI / 8), face); f.position.set(0, cy, 0.035); root.add(f);
    const b = new THREE.Mesh(new THREE.CircleGeometry(r, 8, Math.PI / 8), alu); b.rotation.y = Math.PI; b.position.set(0, cy, 0.023); root.add(b);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r / Math.cos(Math.PI / 8), r / Math.cos(Math.PI / 8), 0.012, 8, 1, true).rotateY(Math.PI / 8).rotateX(Math.PI / 2), alu);
    rim.position.set(0, cy, 0.029); root.add(rim); top = H;
  } else {
    const w = style === 'blank' ? 0.9 : 0.62, h = w / F.aspect, cy = H - h / 2;
    const mats = [alu, alu, alu, alu, face, alu];
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), mats); p.position.set(0, cy, 0.035); root.add(p); top = H;
    for (const y of [cy - h / 2 + 0.06, cy + h / 2 - 0.06]) { const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 8).rotateX(Math.PI / 2), galv); bolt.position.set(0, y, 0.046); root.add(bolt); }
  }
  // square perforated steel post, 0.45 m in the ground
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, top + 0.45 - 0.05, 0.05), galv); post.position.set(0, (top - 0.05 - 0.45) / 2, 0); root.add(post);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  patchAll(root, ctx);
  return { root, radius: 0.5, height: top, update() {}, snapped: true, anchors: { top: post } };
}

// ══ prop.power_poles ═════════════════════════════════════════════════════════════════════════════════════════════════
// path props are built in world coordinates inside `inner`; the returned root stands at the path's centroid (camera
// targets and occluder picks read root.position), with `inner` offset back so every child keeps its world place
function recenter(inner, name, G, pts) {
  let cx = 0, cz = 0; for (const p of pts) { cx += p.x; cz += p.z; } cx /= pts.length; cz /= pts.length;
  const cy = G.h(cx, cz), root = new THREE.Group(); root.name = name; root.position.set(cx, cy, cz);
  inner.name = name + ':world'; inner.position.set(-cx, -cy, -cz); root.add(inner); root.updateMatrixWorld(true);
  return root;
}
function pathPts(path, at) { const P = Array.isArray(path) && path.length >= 2 ? path.map((p) => xz(p)) : null; return P || [[at[0] - 60, at[1]], [at[0] + 60, at[1]]]; }
function alongPath(P, spacing) {
  const L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = L[L.length - 1], n = Math.max(1, Math.round(total / spacing)), out = [];
  const at = (s) => { let i = 1; while (i < P.length - 1 && L[i] < s) i++; const f = clamp((s - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1])); return { x: lerp(P[i - 1][0], P[i][0], f), z: lerp(P[i - 1][1], P[i][1], f) }; };
  for (let k = 0; k <= n; k++) {
    const s = total * k / n, a = at(Math.max(0, s - 1)), b = at(Math.min(total, s + 1)), p = at(s);
    out.push({ ...p, dir: Math.atan2(b.z - a.z, b.x - a.x), s });
  }
  return { pts: out, total };
}
function buildPoles(item, ctx) {
  const G = ground(ctx), at = xz(item.at), P = pathPts(item.path ?? item.params?.path, at), spacing = Math.max(8, +(item.spacing ?? 40)), lean = clamp(+(item.lean ?? 0));
  const R = makeRng(((item.seed ?? 3) * 977 + 5) >>> 0), { pts } = alongPath(P, spacing);
  const root = new THREE.Group(); root.name = 'prop.power_poles';
  const wood = plain({ color: 0x5A4838, roughness: 0.92 }), arm = plain({ color: 0x6A5846, roughness: 0.9 }), cer = plain({ color: 0xC9D2CC, roughness: 0.3 }), can = plain({ color: 0x8E9496, roughness: 0.5, metalness: 0.5 });
  const Hp = +(item.height ?? 10.5), bury = 1.5, n = pts.length;
  const shaftG = new THREE.CylinderGeometry(0.12, 0.17, Hp + bury, 10); shaftG.translate(0, (Hp - bury) / 2, 0);
  const armG = new THREE.BoxGeometry(2.4, 0.1, 0.11); armG.translate(0, Hp - 0.7, 0);
  const insG = new THREE.CylinderGeometry(0.045, 0.06, 0.16, 10); const braceG = new THREE.BoxGeometry(0.05, 0.9, 0.04);
  const canG = new THREE.CylinderGeometry(0.24, 0.24, 0.75, 14);
  const shafts = new THREE.InstancedMesh(shaftG, wood, n), arms = new THREE.InstancedMesh(armG, arm, n), ins = new THREE.InstancedMesh(insG, cer, n * 3), braces = new THREE.InstancedMesh(braceG, arm, n * 2);
  const cans = new THREE.InstancedMesh(canG, can, Math.max(1, Math.ceil(n / 3))); let nc = 0;
  const mats = [], ix = [-1.05, -0.3, 1.05], attach = [];
  const Mp = new THREE.Matrix4(), Ml = new THREE.Matrix4(), q = new THREE.Quaternion(), qt = new THREE.Quaternion(), ax = new THREE.Vector3();
  pts.forEach((pt, i) => {
    const y = G.h(pt.x, pt.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -pt.dir + Math.PI / 2);                 // crossarm across the line
    const tilt = lean * (0.25 + 0.75 * R()) * 20 * DEG, side = R() < 0.75 ? (R() < 0.5 ? 1 : -1) : 0, ang = pt.dir + Math.PI / 2 * (side || (R() < 0.5 ? 1 : -1)) + (R() - 0.5) * 0.8;
    ax.set(Math.sin(ang), 0, -Math.cos(ang)); qt.setFromAxisAngle(ax, tilt);
    Mp.compose(new THREE.Vector3(pt.x, y, pt.z), qt.clone().multiply(q), new THREE.Vector3(1, 1, 1)); mats.push(Mp.clone());
    shafts.setMatrixAt(i, Mp); arms.setMatrixAt(i, Mp);
    const at3 = [];
    ix.forEach((x, k) => { Ml.makeTranslation(x, Hp - 0.57, 0); ins.setMatrixAt(i * 3 + k, Mp.clone().multiply(Ml)); at3.push(new THREE.Vector3(x, Hp - 0.49, 0).applyMatrix4(Mp)); });
    attach.push(at3);
    for (const s of [-1, 1]) { Ml.compose(new THREE.Vector3(s * 0.38, Hp - 1.08, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s * 0.72), new THREE.Vector3(1, 1, 1)); braces.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), Mp.clone().multiply(Ml)); }
    if (i % 3 === 1 && nc < cans.count) { Ml.makeTranslation(0, Hp - 2.4, -0.36); cans.setMatrixAt(nc++, Mp.clone().multiply(Ml)); }
  });
  cans.count = nc;
  for (const m of [shafts, arms, ins, braces, cans]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; root.add(m); }
  // wires: parabolic sag between consecutive insulators (more sag and slack where poles lean)
  const wg = [];
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < 3; k++) {
    const a = attach[i][k], b = attach[i + 1][k], span = a.distanceTo(b), sag = span * (0.022 + lean * 0.03 * R()) + 0.1, m = 14, pts3 = [];
    for (let j = 0; j <= m; j++) { const f = j / m; pts3.push(new THREE.Vector3().lerpVectors(a, b, f).setY(lerp(a.y, b.y, f) - sag * 4 * f * (1 - f))); }
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts3), m, 0.014, 4, false), cnt = tg.attributes.position.count, sa = new Float32Array(cnt * 2), ph = R() * TAU;
    for (let v = 0; v < cnt; v++) { const f = Math.floor(v / 5) / m; sa[v * 2] = 4 * f * (1 - f) * (span / 40); sa[v * 2 + 1] = ph + i * 0.9; }
    tg.setAttribute('aSway', new THREE.BufferAttribute(sa, 2)); wg.push(tg);
  }
  // wind sway, deterministic in t: each span swings across the wind and bounces (0 at the insulators, most mid-span)
  const WT = { value: new THREE.Vector4(0, 0, 0, 0) }, wind = ctx.wind || {}, ws = +(wind.speed ?? 0) || 0;
  // the wires swing across the line (its horizontal normal), harder when the wind blows across it
  const P0 = P[0], P1 = P[P.length - 1], ll = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]) || 1, px = -(P1[1] - P0[1]) / ll, pz = (P1[0] - P0[0]) / ll;
  const wl = Math.hypot(wind.x || 0, wind.z || 0), across = wl > 1e-6 ? ((wind.x || 0) * px + (wind.z || 0) * pz) / wl : 1;
  const amp = clamp(item.sway != null ? +item.sway : (0.04 + ws * 0.035 + lean * 0.12) * (0.4 + 0.6 * Math.abs(across)), 0, 3);
  const wdx = px * (across < 0 ? -1 : 1), wdz = pz * (across < 0 ? -1 : 1);
  if (wg.length) {
    const geo = mergeGeometries(wg.map((g) => g.toNonIndexed()), false);
    const wireSway = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x1C1C1C, roughness: 0.5, metalness: 0.3 }), (sh) => {
      sh.uniforms.uWT = WT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aSway; uniform vec4 uWT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { float sw = aSway.x, ph = aSway.y; float a = sin(uWT.x * 1.6 + ph) * 0.7 + sin(uWT.x * 2.9 + ph * 1.7) * 0.3;
            transformed.x += uWT.y * uWT.w * sw * a; transformed.z += uWT.z * uWT.w * sw * a;
            transformed.y -= uWT.w * 0.35 * sw * (0.5 + 0.5 * sin(uWT.x * 2.2 + ph * 1.3)); }`);
    });
    wireSway.userData.progKey = 'f3dWireSway';
    const w = new THREE.Mesh(geo, wireSway); w.name = 'powerWires'; w.castShadow = true; w.receiveShadow = false; w.frustumCulled = false; root.add(w);
  }
  patchAll(root, ctx);
  const c = pts[Math.floor(n / 2)], mid = new THREE.Object3D(); mid.position.set(c.x, G.h(c.x, c.z) + Hp - 0.5, c.z); root.add(mid);
  const update = (t = 0) => { WT.value.set(t, wdx, wdz, amp); };
  update(0);
  const total = pts.length > 1 ? pts[pts.length - 1].s : 10;
  return { root: recenter(root, 'prop.power_poles', G, pts), radius: clamp(total / 2, 10, 300), height: Hp, update, snapped: true, contact: false, anchors: { poles: pts.map((p) => [p.x, p.z]), mid } };
}

// ══ prop.fence ═══════════════════════════════════════════════════════════════════════════════════════════════════════
function buildFence(item, ctx) {
  const G = ground(ctx), at = xz(item.at), P = pathPts(item.path ?? item.params?.path, at);
  const style = ['rail', 'picket'].includes(item.style) ? item.style : 'wire', R = makeRng(((item.seed ?? 5) * 613 + 1) >>> 0);
  const spacing = +(item.spacing ?? (style === 'rail' ? 3.0 : 2.5)), { pts, total } = alongPath(P, spacing), n = pts.length;
  const root = new THREE.Group(); root.name = 'prop.fence';
  const weathered = plain({ color: 0x7A6A58, roughness: 0.95 }), white = plain({ color: 0xF2F0EA, roughness: 0.7 }), steel = plain({ color: 0x6A6A68, roughness: 0.45, metalness: 0.7 });
  const postH = style === 'picket' ? 1.15 : style === 'rail' ? 1.3 : 1.3, bury = 0.5;
  const postG = style === 'wire' ? new THREE.CylinderGeometry(0.055, 0.065, postH + bury, 8) : new THREE.BoxGeometry(style === 'rail' ? 0.13 : 0.1, postH + bury, style === 'rail' ? 0.13 : 0.1);
  postG.translate(0, (postH - bury) / 2, 0);
  const posts = new THREE.InstancedMesh(postG, style === 'picket' ? white : weathered, n);
  const tops = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  pts.forEach((pt, i) => { const y = G.h(pt.x, pt.z), j = (R() - 0.5) * 0.04; q.setFromAxisAngle(up, -pt.dir + (R() - 0.5) * 0.1); m4.compose(new THREE.Vector3(pt.x, y, pt.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(j, -pt.dir, j * 0.5)), new THREE.Vector3(1, 0.96 + R() * 0.08, 1)); posts.setMatrixAt(i, m4); tops.push([pt.x, y, pt.z]); });
  root.add(posts);
  // straight members between posts as instances of a unit box / cylinder along +X, scaled to length
  const unitBox = new THREE.BoxGeometry(1, 1, 1), unitCyl = new THREE.CylinderGeometry(1, 1, 1, 5).rotateZ(Math.PI / 2);
  const members = [];      // [a, b, w, h]
  const addSpan = (a, b, w, h) => members.push([a, b, w, h]);
  const levels = style === 'wire' ? [0.32, 0.58, 0.84, 1.1] : style === 'rail' ? [0.42, 0.82, 1.18] : [0.22, 0.86];
  for (let i = 0; i < n - 1; i++) for (const lv of levels) {
    const a = tops[i], b = tops[i + 1], jz = style === 'rail' ? (R() - 0.5) * 0.06 : 0;
    addSpan([a[0], a[1] + lv + jz, a[2]], [b[0], b[1] + lv - jz, b[2]], style === 'wire' ? 0.005 : style === 'rail' ? 0.1 : 0.04, style === 'wire' ? 0.005 : style === 'rail' ? 0.13 : 0.09);
  }
  const mem = new THREE.InstancedMesh(style === 'wire' ? unitCyl : unitBox, style === 'wire' ? steel : style === 'picket' ? white : weathered, Math.max(1, members.length));
  const d = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  members.forEach(([a, b, w, h], k) => {
    d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const L = d.length(); d.normalize();
    // yaw then pitch (no roll): rails stay upright on slopes
    const yawA = Math.atan2(-d.z, d.x), pitch = Math.asin(clamp(d.y, -1, 1));
    q.setFromEuler(new THREE.Euler(0, yawA, pitch, 'YZX'));
    const off = style === 'picket' ? 0.06 : 0;
    m4.compose(new THREE.Vector3((a[0] + b[0]) / 2 + Math.sin(yawA) * off, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + Math.cos(yawA) * off), q, new THREE.Vector3(L + (style === 'rail' ? 0.25 : 0), h, w));
    mem.setMatrixAt(k, m4);
  });
  mem.count = members.length; root.add(mem);
  if (style === 'wire' && item.barbed !== false) {                               // barbs every 0.13 m on each strand
    const barbs = []; for (const [a, b] of members) { const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), c = Math.floor(L / 0.13); for (let k = 1; k < c; k++) barbs.push([lerp(a[0], b[0], k / c), lerp(a[1], b[1], k / c), lerp(a[2], b[2], k / c), R() * TAU]); }
    const bg = new THREE.BoxGeometry(0.004, 0.004, 0.045); const bm = new THREE.InstancedMesh(bg, steel, Math.max(1, barbs.length));
    barbs.forEach(([x, y, z, r], k) => { m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r, r * 1.7, 0.6)), new THREE.Vector3(1, 1, 1)); bm.setMatrixAt(k, m4); });
    bm.count = barbs.length; bm.castShadow = false; root.add(bm);
  }
  if (style === 'picket') {                                                        // pointed pickets every 0.14 m on the rails' outer side
    const s = new THREE.Shape(); s.moveTo(-0.04, 0); s.lineTo(0.04, 0); s.lineTo(0.04, 0.94); s.lineTo(0, 1.02); s.lineTo(-0.04, 0.94); s.lineTo(-0.04, 0);
    const pg = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }); pg.translate(0, -0.06, 0);
    const list = []; for (let i = 0; i < n - 1; i++) { const a = tops[i], b = tops[i + 1], L = Math.hypot(b[0] - a[0], b[2] - a[2]), c = Math.max(1, Math.round(L / 0.14)), dir = Math.atan2(b[2] - a[2], b[0] - a[0]); for (let k = 0; k < c; k++) { const f = (k + 0.5) / c, x = lerp(a[0], b[0], f), z = lerp(a[2], b[2], f); list.push([x + Math.sin(-dir + Math.PI / 2) * 0, G.h(x, z), z, dir]); } }
    const pm = new THREE.InstancedMesh(pg, white, Math.max(1, list.length));
    list.forEach(([x, y, z, dir], k) => { const ya = -dir; m4.compose(new THREE.Vector3(x + Math.sin(ya) * 0.09, y, z + Math.cos(ya) * 0.09), new THREE.Quaternion().setFromAxisAngle(up, ya), new THREE.Vector3(1, 1, 1)); pm.setMatrixAt(k, m4); });
    pm.count = list.length; root.add(pm);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; o.frustumCulled = false; } });
  patchAll(root, ctx);
  return { root: recenter(root, 'prop.fence', G, pts), radius: clamp(total / 2, 1, 300), height: postH, update() {}, snapped: true, contact: false, anchors: { posts: pts.map((p) => [p.x, p.z]) } };
}

// ══ prop.siren_pole ══════════════════════════════════════════════════════════════════════════════════════════════════
function buildSiren(item, ctx) {
  const G = ground(ctx), at = xz(item.at), Hp = +(item.height ?? 12), rpm = item.rotate === false ? 0 : +(item.rpm ?? 5), phase = (+(item.phase ?? 0)) * DEG;
  const root = new THREE.Group(); root.name = 'prop.siren_pole'; root.position.set(at[0], G.h(at[0], at[1]), at[1]); root.rotation.y = yawFromHeading(hdg(item.heading ?? 180));
  const wood = plain({ color: 0x5A4838, roughness: 0.92 }), steel = plain({ color: 0xA7ACAE, roughness: 0.4, metalness: 0.8 }), dark = plain({ color: 0x3A3E40, roughness: 0.5, metalness: 0.6 }), paint = plain({ color: 0xC9CDC4, roughness: 0.45, metalness: 0.2 });
  const add = (p, g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; p.add(o); return o; };
  add(root, new THREE.CylinderGeometry(0.14, 0.2, Hp + 1.8, 12).translate(0, (Hp - 1.8) / 2, 0), wood);
  add(root, new THREE.BoxGeometry(0.5, 0.7, 0.25), dark, 0, 3.0, 0.3);                                     // control cabinet
  add(root, new THREE.CylinderGeometry(0.03, 0.03, Hp - 3.3, 6).translate(0, (Hp - 3.3) / 2 + 3.3, 0), steel, 0.12, 0, 0.12);   // conduit
  add(root, new THREE.CylinderGeometry(0.34, 0.3, 0.55, 20), paint, 0, Hp + 0.28, 0);                      // rotor housing
  add(root, new THREE.CylinderGeometry(0.4, 0.4, 0.06, 20), steel, 0, Hp + 0.02, 0);
  const head = new THREE.Group(); head.position.set(0, Hp + 0.6, 0); root.add(head);
  add(head, new THREE.CylinderGeometry(0.26, 0.3, 0.4, 20), paint, 0, 0.15, 0);                            // chopper drum
  // two flared horns back to back (a horn cluster), mouths out
  for (const s of [1, -1]) {
    const pts = []; for (let k = 0; k <= 12; k++) { const f = k / 12; pts.push(new THREE.Vector2(0.16 + 0.34 * Math.pow(f, 2.2), f * 1.1)); }
    const hg = new THREE.LatheGeometry(pts, 24); hg.rotateZ(-s * Math.PI / 2); hg.translate(s * 0.2, 0.18, 0);
    const hm = add(head, hg, paint); hm.material.side = THREE.DoubleSide;
    add(head, new THREE.CylinderGeometry(0.47, 0.47, 0.03, 24, 1, true).rotateZ(Math.PI / 2), steel, s * 1.31, 0.18, 0).material.side = THREE.DoubleSide;
    add(head, new THREE.CircleGeometry(0.16, 20).rotateY(s * Math.PI / 2), dark, s * 0.21, 0.18, 0);
  }
  add(head, new THREE.ConeGeometry(0.34, 0.25, 20), paint, 0, 0.5, 0);
  const update = (t) => { head.rotation.y = phase + (rpm / 60) * TAU * t; };
  update(0);
  patchAll(root, ctx);
  return { root, radius: 1.5, height: Hp + 1.2, update, snapped: true, anchors: { head, top: head } };
}

// ══ prop.tv ══════════════════════════════════════════════════════════════════════════════════════════════════════════
function buildTV(item, ctx) {
  const G = ground(ctx), at = xz(item.at), mode = ['weather', 'static'].includes(item.screen) ? item.screen : 'news', glow = clamp(+(item.glow ?? 1), 0, 3);
  const root = new THREE.Group(); root.name = 'prop.tv'; root.position.set(at[0], G.h(at[0], at[1]), at[1]); root.rotation.y = yawFromHeading(hdg(item.heading ?? 180));
  const wood = plain({ color: 0x3A2A1E, roughness: 0.55 }), black = plain({ color: 0x0C0C0E, roughness: 0.35, metalness: 0.2 });
  const add = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; root.add(o); return o; };
  const sw = +(item.size ?? 1.22), sh = sw * 9 / 16, standH = 0.48;
  add(boxM(1.5, 0.05, 0.45), wood, 0, standH - 0.025, 0); add(boxM(1.5, 0.04, 0.45), wood, 0, 0.1, 0);
  for (const x of [-0.72, 0.72]) add(boxM(0.05, standH - 0.1, 0.43), wood, x, (standH + 0.1) / 2, 0);
  add(boxM(1.44, 0.3, 0.02), wood, 0, 0.28, -0.21);
  for (const [x, z] of [[-0.7, -0.2], [0.7, -0.2], [-0.7, 0.2], [0.7, 0.2]]) add(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8), black, x, 0.04, z);
  add(new THREE.BoxGeometry(0.34, 0.02, 0.2), black, 0, standH + 0.01, 0); add(new THREE.BoxGeometry(0.06, 0.09, 0.03), black, 0, standH + 0.06, -0.02);
  const cyTV = standH + 0.1 + sh / 2 + 0.02;
  add(new THREE.BoxGeometry(sw + 0.03, sh + 0.03, 0.05), black, 0, cyTV, -0.02);
  const scr = patchMaterial(new THREE.MeshBasicMaterial({ color: 0xFFFFFF }));
  const screen = add(new THREE.PlaneGeometry(sw, sh), scr, 0, cyTV, 0.006); screen.castShadow = false; screen.name = 'tvScreen';
  const light = new THREE.PointLight(0xC8DAFF, 0, 7, 2); light.position.set(0, cyTV, 0.7); root.add(light);
  let lastF = -1, painter = null, canvasEl = null;
  { const pc = tvPainterCanvas(mode); painter = pc.paint; canvasEl = pc.canvas; }
  const ctexS = new THREE.CanvasTexture(canvasEl); ctexS.colorSpace = THREE.SRGBColorSpace; ctexS.anisotropy = 4; scr.map = ctexS; scr.needsUpdate = true;
  const update = (t = 0) => {
    const fr = Math.floor(t * 15);
    if (fr !== lastF) { painter(fr / 15); ctexS.needsUpdate = true; lastF = fr; }
    const fl = 1 + 0.07 * Math.sin(t * TAU * 1.7) + 0.05 * (hash(fr, 11) - 0.5) + (mode === 'static' ? 0.1 * (hash(fr, 5) - 0.5) : 0);
    scr.color.setScalar(lerp(1.25, 0.55, clamp(U.uNight.value)) * fl); light.intensity = 2.2 * glow * fl;
  };
  update(0);
  patchAll(root, ctx);
  return { root, radius: 0.9, height: cyTV + sh / 2, update, snapped: true, anchors: { screen, light } };
}
// a TV painter bound to its own canvas (one per TV)
function tvPainterCanvas(mode) {
  const [c, g] = canvas(320, 180);
  return { canvas: c, paint: tvPainterOn(g, mode) };
}
function tvPainterOn(g, mode) {
  const [nc, ng] = canvas(80, 45), nid = ng.createImageData(80, 45);
  const land = (x, y, s) => { g.beginPath(); for (let k = 0; k <= 16; k++) { const a = k / 16 * TAU; const r = s * (0.75 + 0.25 * Math.sin(a * 3 + x) + 0.1 * Math.sin(a * 7)); g.lineTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r); } g.closePath(); g.fill(); };
  const swirl = (x, y, r, rot) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    for (let arm = 0; arm < 3; arm++) { g.rotate(TAU / 3); for (let k = 0; k < 26; k++) { const f = k / 26, a = f * 4.2, rr = r * (0.12 + f); g.fillStyle = `rgba(255,255,255,${0.85 * (1 - f)})`; g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * 0.18 * (1 - f * 0.6), 0, TAU); g.fill(); } }
    g.fillStyle = 'rgba(40,60,90,0.9)'; g.beginPath(); g.arc(0, 0, r * 0.09, 0, TAU); g.fill(); g.restore();
  };
  return (t) => {
    const fr = Math.floor(t * 15 + 1e-6);
    if (mode === 'static') {
      for (let i = 0; i < 80 * 45; i++) { const v = hash(i, fr, 7) * 255, k = i * 4; nid.data[k] = nid.data[k + 1] = nid.data[k + 2] = v; nid.data[k + 3] = 255; }
      ng.putImageData(nid, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(nc, 0, 0, 320, 180);
      g.fillStyle = `rgba(255,255,255,${0.08 + 0.08 * hash(fr, 3)})`; g.fillRect(0, (fr * 23) % 180, 320, 10);
      return;
    }
    if (mode === 'weather') {
      g.fillStyle = '#1E4E7A'; g.fillRect(0, 0, 320, 180);
      g.fillStyle = '#5E7A46'; land(250, 60, 38); land(290, 140, 30); land(60, 20, 26); g.fillStyle = '#6E8A52'; land(210, 170, 22);
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.setLineDash([5, 5]); g.lineWidth = 2; g.beginPath(); g.moveTo(120, 120); g.quadraticCurveTo(190, 110, 240, 70); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(120, 120); g.lineTo(250, 40); g.lineTo(262, 96); g.closePath(); g.fill();
      swirl(120, 120, 46, -t * 0.35);
      g.fillStyle = '#B01C1C'; g.fillRect(0, 150, 320, 30); g.fillStyle = '#FFFFFF'; g.font = '700 17px Inter, Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText('HURRICANE WARNING', 10, 165);
      g.fillStyle = '#FFFFFF'; g.fillRect(262, 154, 52, 22); g.fillStyle = '#B01C1C'; g.font = '700 13px Inter, Arial, sans-serif'; g.fillText('CAT 4', 270, 165);
      return;
    }
    const bg = g.createLinearGradient(0, 0, 320, 180); bg.addColorStop(0, '#0C2448'); bg.addColorStop(1, '#1C4A86'); g.fillStyle = bg; g.fillRect(0, 0, 320, 180);
    g.fillStyle = 'rgba(255,255,255,0.06)'; for (let x = 0; x < 320; x += 24) g.fillRect(x, 0, 2, 150);
    g.fillStyle = '#20242C'; g.beginPath(); g.moveTo(46, 120); g.quadraticCurveTo(50, 90, 96, 86); g.quadraticCurveTo(142, 90, 146, 120); g.closePath(); g.fill(); g.fillRect(88, 76, 16, 12); g.beginPath(); g.ellipse(96, 62, 17, 20, 0, 0, TAU); g.fill();
    g.fillStyle = '#3A3F4A'; g.fillRect(20, 112, 152, 8);
    g.fillStyle = '#1E4E7A'; g.fillRect(176, 26, 128, 84); g.fillStyle = '#5E7A46'; g.save(); g.beginPath(); g.rect(176, 26, 128, 84); g.clip(); land(280, 50, 22); land(290, 100, 16); swirl(222, 78, 26, -t * 0.35); g.restore();
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.strokeRect(176, 26, 128, 84);
    g.fillStyle = '#C01818'; g.fillRect(0, 118, 200, 22); g.fillStyle = '#FFFFFF'; g.font = '700 14px Inter, Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText('BREAKING NEWS', 8, 129);
    g.fillStyle = '#F2F2F2'; g.fillRect(0, 140, 320, 20); g.fillStyle = '#111'; g.font = '600 12px Inter, Arial, sans-serif'; g.fillText('MANDATORY EVACUATION ORDERED FOR COASTAL ZONES', 8, 150);
    g.fillStyle = '#0A1A33'; g.fillRect(0, 160, 320, 20); g.fillStyle = '#FFD24A'; g.font = '600 11px Inter, Arial, sans-serif';
    const crawl = '  STORM SURGE UP TO 15 FT  •  SHELTERS OPEN AT HIGH SCHOOLS  •  WINDS 140 MPH  •  LANDFALL EXPECTED TONIGHT  •';
    const w = g.measureText(crawl).width, off = (t * 40) % w; g.fillText(crawl, -off, 170); g.fillText(crawl, w - off, 170);
  };
}

// the engine disposes a scene's textures/materials between scenes unless userData.keep: keep the module caches
function keepCaches() {
  const mark = (v) => { if (!v) return; if (v.isTexture || v.isMaterial) { v.userData.keep = true; return; } if (typeof v === 'object') for (const w of Object.values(v)) if (w && (w.isTexture || w.isMaterial)) w.userData.keep = true; };
  for (const v of Object.values(TEXC)) mark(v);
  if (HMAT) for (const m of Object.values(HMAT)) mark(m);
  if (TXH) for (const v of Object.values(TXH)) mark(v);
}

// ── catalog + build ─────────────────────────────────────────────────────────────────────────────────────────────────
export const CATALOG = {
  'landmark.house': {
    desc: 'a single detached house with a working front door: farmhouse = US two-storey white clapboard farmhouse c.1900 (gable roof, front porch on posts, shuttered windows); suburban = one-storey ranch (painted siding, asphalt shingles). Front + door face `heading`; door opens inward on keys; windows light warm (lit keys or at dusk); dim entrance hall behind the door, floor at ground level (a figure walks in)',
    params: { at: '[x, z] house centre', heading: 'compass deg the FRONT (door) faces; 180 = south/+Z', style: 'farmhouse|suburban', door: '[[t, deg], ...] 0 closed .. 90 open (inward), smoothstep per segment; slam = two keys 0.12 s apart', lit: '[[t, 0..1], ...] warm window glow (default: auto at dusk)', color: 'siding css colour', door_color: 'css', roof_color: 'css', shutter_color: 'css', trim_color: 'css', walk: 'suburban: front walk length m (6)', lamps: 'false = no PointLights (emissive glow only)', seed: 'int' },
    footprint: [10, 10], height: 10, tags: ['house', 'home', 'farmhouse', 'building', 'america', 'door', 'residential', 'hurricane'], actions: ['door', 'lit'],
  },
  'prop.sign': { desc: 'road sign on a galvanised post (~2.25 m): US hurricane EVACUATION ROUTE (blue, white hurricane symbol), STOP, or blank white with `text`; faces `heading`', params: { at: '[x, z]', heading: 'deg the sign face looks toward', style: 'evacuation_route|stop|blank', text: 'blank: text (| = new line)', height: 'm (2.25)' }, footprint: [0.7, 0.2], height: 2.3, tags: ['sign', 'road', 'hurricane', 'evacuation', 'street'] },
  'prop.power_poles': { desc: 'wooden utility poles (~10.5 m, crossarm, insulators, transformer cans) along a path with sagging wires; lean 0..1 tilts poles (storm damage)', params: { path: '[[x, z], ...]', spacing: 'm between poles (40)', lean: '0..1', height: 'm (10.5)', sway: 'm mid-span wire swing (default from the wind + lean)', seed: 'int' }, footprint: [2.4, 2.4], height: 10.5, tags: ['power', 'poles', 'lines', 'utility', 'wires', 'road', 'storm'] },
  'prop.fence': { desc: 'fence along a path, posts every ~2.5 m following the ground: wire (barbed strands on wooden posts), rail (split rails), picket (white pickets)', params: { path: '[[x, z], ...]', style: 'wire|rail|picket', spacing: 'm between posts (2.5; rail 3)', barbed: 'wire: false = plain strands' }, footprint: [2, 0.2], height: 1.3, tags: ['fence', 'farm', 'field', 'ranch', 'yard'] },
  'prop.siren_pole': { desc: 'civil-defence (tornado / tsunami) siren: flared horn cluster on a rotor atop a ~12 m wooden pole, turning slowly', params: { at: '[x, z]', rotate: 'true|false', rpm: 'turns per minute (5)', height: 'm (12)', phase: 'deg start angle' }, footprint: [0.6, 0.6], height: 13, tags: ['siren', 'warning', 'tornado', 'tsunami', 'civil defence', 'alarm'] },
  'prop.tv': { desc: 'flat TV on a low wooden stand; screen news | weather (hurricane map with a turning storm) | static, flickering (deterministic in t), soft blue-white glow on the room', params: { at: '[x, z]', heading: 'deg the screen faces', screen: 'news|weather|static', glow: '0..1 (room light)', size: 'm screen width (1.22)' }, footprint: [1.5, 0.45], height: 1.3, tags: ['tv', 'television', 'news', 'interior', 'living room'] },
};
export async function build(kind, item = {}, ctx = {}) {
  // item.params = the catalog's param descriptions overlaid with the spec's own params: keep only the spec's
  const cat = CATALOG[kind]?.params || {}, sp = {};
  for (const [k, v] of Object.entries(item.params || {})) if (v !== cat[k]) sp[k] = v;
  const it = { ...sp, ...item };
  const B = { 'landmark.house': buildHouse, 'prop.sign': buildSign, 'prop.power_poles': buildPoles, 'prop.fence': buildFence, 'prop.siren_pole': buildSiren, 'prop.tv': buildTV }[kind];
  if (!B) throw new Error('props.js: unknown kind ' + kind);
  const res = B(it, ctx);
  keepCaches();
  return res;
}
