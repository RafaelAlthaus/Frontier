// hq.js — McAuliffe's command post, Bastogne, 22 December 1944. The 101st Airborne's division headquarters sat in a
// basement of the Heintz Barracks (today's "Nuts cellar"): here a low barrel vault of whitewashed brick, stained by
// damp and lamp soot, a heavy map table under a hanging hurricane lamp, cold snow-light through a sandbagged cellar
// window, and on a small desk against the wall a US Army portable typewriter that types the reply.
//
//   import { buildHQ, typingAt, NUTS_TEXT } from './hq.js';
//   const hq = await buildHQ({ mapCanvas, mapSize: [0.9, 0.9] });
//   hq.update(t, { typing: typingAt(t, { start: 2 }) });     // or your own { text, chars, strike }
//   renderer.render(hq.scene, camera);
//
// Units metres, Y up, floor at y = 0. The room runs along X (window end +X, door end -X); the vault spans Z.
// Every frame is a pure function of (t, s): nothing reads the clock or Math.random.
//
// Lighting notes (engine: logarithmic depth buffer). SpotLight shadows break with log depth, so nothing here uses
// one. PointLight shadows (cube depth, no log-depth write) do work, so the lamp and the desk candle are shadowed
// point lights; the window's daylight shadow is an orthographic DirectionalLight; the soft window fill is a
// RectAreaLight (no shadows). The lamp fount and the candle wax do not cast (a real lantern throws a dark disc
// under itself; cinema cheats it away).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { boxM, drum, mergeGeometries } from './geom.js';
import { plain } from '../shared/materials.js';
import * as TX from './textures.js';
import { rng, makeNoise, clamp, smooth, lerp, hash2i } from '../shared/util.js';
import { patchMaterial } from '../shared/env.js';

export const NUTS_TEXT = '22 December 1944\n\nTo the German Commander:\n\n        N U T S !\n\n              The American Commander';

const V3 = THREE.Vector3;
const DEG = Math.PI / 180;
const fontURL = (f) => new URL(`../../fonts/${f}`, import.meta.url).href;

// ── layout ────────────────────────────────────────────────────────────────────────────────────────────────
export const ROOM = { L: 6.0, W: 4.0, spring: 1.72, crown: 2.62, wallT: 0.55 };
const HL = ROOM.L / 2, HW = ROOM.W / 2, RISE = ROOM.crown - ROOM.spring;
const VR = (HW * HW + RISE * RISE) / (2 * RISE), VYC = ROOM.crown - VR, VPHI = Math.asin(HW / VR);
export const vaultHeight = (z) => VYC + Math.sqrt(Math.max(0, VR * VR - z * z));
const WIN = { iz: 0.40, iy0: 1.70, iy1: 2.36, oz: 0.30, oy0: 1.80, oy1: 2.38, gap: 1.95 };  // inner / outer opening; gap = top of the sandbags
const DOOR = { z0: 0.55, z1: 1.45, y1: 1.80, rise: 0.14, inset: 0.17 };
const TABLE = { x: 0, z: 0.18, w: 2.0, d: 1.05, top: 0.78, t: 0.06 };
const DESK = { x: 1.72, z: -1.70, w: 1.0, d: 0.56, top: 0.745, t: 0.032 };
const LAMP_AT = new V3(-0.16, 1.96, -0.17);                                               // the flame
const MAP_AT = { x: -0.30, z: 0.17 };

// ── the typewriter (a 1940s portable: pica type, 10 characters and 6 lines to the inch) ───────────────────
const TW = {
  platenY: 0.117, platenZ: -0.088, platenR: 0.0165, platenHalf: 0.1175, paperR: 0.0169,
  printA: 10 * DEG, exitA: 26 * DEG, backA: -150 * DEG, curl: 0.9,
  pitch: 0.00254, lineH: 0.0254 / 6, paperW: 0.2159, paperH: 0.2794, paperLeft: -0.108,
  marginL: 0.0381, marginT: 0.0635, capH: 0.00235,
  barL: 0.066, segR: 0.046, fan: 64 * DEG, droop: 6 * DEG,
};

// ── small utilities ───────────────────────────────────────────────────────────────────────────────────────
function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, o = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = o.aniso ?? 16; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  if (o.flipY === false) t.flipY = false;
  if (o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}
function dataTex(d, w, h, srgb, repeat = true) {
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
// height field (rows = +v, as DataTexture rows) -> tangent-space normals
function heightNormals(h, w, hh, k, wrap = true) {
  const d = new Uint8Array(w * hh * 4);
  const at = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + hh) % hh; } else { x = x < 0 ? 0 : x >= w ? w - 1 : x; y = y < 0 ? 0 : y >= hh ? hh - 1 : y; }
    return h[y * w + x];
  };
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const nx = -(at(x + 1, y) - at(x - 1, y)) * k, ny = -(at(x, y + 1) - at(x, y - 1)) * k;
    const l = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  return d;
}
const h01 = (a, b = 0, c = 0) => hash2i(a, b, c + 911);

function mk(geo, mat, parent, pos, rot, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = o.cast ?? true; m.receiveShadow = o.receive ?? true;
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (parent) parent.add(m);
  return m;
}
const lathe = (pts, seg = 48) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
function tube(pts, r, seg = 48, rs = 8, closed = false) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new V3(p[0], p[1], p[2])), closed, 'centripetal', 0.5), seg, r, rs, closed);
}
function cylX(r, len, seg = 32, r2 = r) { const g = new THREE.CylinderGeometry(r2, r, len, seg); g.rotateZ(Math.PI / 2); return g; }   // axis along x
function cylZ(r, len, seg = 32) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateX(Math.PI / 2); return g; }
const rbox = (w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);
// planar UVs in metres by the dominant normal axis
function boxUV(g, s = 1, swap = false) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
    if (swap) { const t = u; u = v; v = t; }
    uv[i * 2] = u * s; uv[i * 2 + 1] = v * s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
function merge(list) {
  const gs = list.map((g0) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return g;
  });
  return mergeGeometries(gs, false);
}
// a closed profile in the (z, y) plane extruded along x from x0 to x1, rounded edges of radius `bevel`
function extrudeX(pts, x0, x1, bevel = 0, curve = 6) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0 - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 3, curveSegments: curve });
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new V3(0, 0, 1), new V3(0, 1, 0), new V3(-1, 0, 0)));
  g.translate(x1 - bevel, 0, 0);
  g.computeVertexNormals();
  return boxUV(g);
}
// a Shape given in (z, y) extruded along x
function extrudeShapeX(shape, x0, x1, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0 - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 16 });
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new V3(0, 0, 1), new V3(0, 1, 0), new V3(-1, 0, 0)));
  g.translate(x1 - bevel, 0, 0);
  return g;
}
// a quad (corners in order) with UVs in metres, facing `toward`
function quad(a, b, c, d, toward) {
  const A = new V3(...a), B = new V3(...b), C = new V3(...c), D = new V3(...d);
  const n = new V3().subVectors(B, A).cross(new V3().subVectors(D, A)).normalize();
  const mid = A.clone().add(B).add(C).add(D).multiplyScalar(0.25);
  const flip = toward && n.dot(new V3(...toward).sub(mid)) < 0;
  const ul = A.distanceTo(B), vl = A.distanceTo(D);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, ul, 0, ul, vl, 0, vl], 2));
  g.setIndex(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

// ── fonts ─────────────────────────────────────────────────────────────────────────────────────────────────
let FONTS_OK = null;
async function loadFonts() {
  if (FONTS_OK) return FONTS_OK;
  FONTS_OK = (async () => {
    for (const [fam, file, style] of [['HQElite', 'SpecialElite.ttf', 'normal'], ['HQCourier', 'CourierPrime.ttf', 'normal'],
      ['HQSerif', 'EB-Garamond.ttf', 'normal'], ['HQSerifI', 'EB-Garamond-Italic.ttf', 'italic'], ['HQSans', 'Inter-Bold.ttf', 'normal']]) {
      const f = new FontFace(fam, `url(${fontURL(file)})`, { style });
      await f.load(); document.fonts.add(f);
    }
    return true;
  })();
  return FONTS_OK;
}

// ══ TEXTURES ═══════════════════════════════════════════════════════════════════════════════════════════════
// whitewashed brick, 2 m square tile: Belgian stretcher bond under a thick, streaky lime wash that has flaked here
// and there down to the red brick. Same {map, normalMap, roughnessMap, meters} shape as textures.js masonry().
function paintWhitewash(seed = 11, size = 1024) {
  const meters = 2, courses = 34, perRow = 10;
  const N = makeNoise(seed), N2 = makeNoise(seed + 101), R = rng(seed);
  const ch = size / courses, bl = size / perRow, jh = 0.0105 / meters * size / 2;
  const tone = new Float32Array(courses * perRow); for (let i = 0; i < tone.length; i++) tone[i] = R();
  const col = new Uint8Array(size * size * 4), rgh = new Uint8Array(size * size * 4), hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const c = Math.floor(y / ch), yIn = y + 0.5 - c * ch, off = (c & 1) ? bl * 0.5 : 0, v = y / size;
    for (let x = 0; x < size; x++) {
      const xx = (x + 0.5 + off) % size, b = Math.floor(xx / bl), xIn = xx - b * bl, u = x / size;
      const nF = N.fbm2(u * 128, v * 128, 2, 2, 0.5, 128, 128);
      const nM = N2.fbm2(u * 12, v * 12, 3, 2, 0.5, 12, 12);
      const nB = N.fbm2(u * 4 + 0.37, v * 4 + 0.71, 4, 2, 0.55, 4, 4);
      const br = N2.fbm2(u * 4, v * 64, 2, 2, 0.5, 4, 64);
      const e = Math.min(xIn, bl - xIn, yIn, ch - yIn) + nF * 1.5;
      const face = smooth((e - jh) / 2.4);
      const t = tone[(c % courses) * perRow + (b % perRow)];
      // the brick only ever shows through as a dull, grimy buff (thin wash, small chips) — never raw red
      const bR = 150 * (0.85 + 0.25 * t), bG = 114 * (0.85 + 0.25 * t), bB = 94 * (0.85 + 0.2 * t);
      const baseR = lerp(160, bR, face), baseG = lerp(152, bG, face), baseB = lerp(138, bB, face);
      const w = 0.955 + br * 0.045 + nF * 0.02 + nM * 0.02;
      let r = 228 * w, g = 223 * w, bb = 210 * w;
      const thin = clamp(0.2 + nM * 0.6 + br * 0.3) * 0.16 * (0.3 + 0.7 * face);
      r = lerp(r, baseR, thin); g = lerp(g, baseG, thin); bb = lerp(bb, baseB, thin);
      // soft grey-brown damp and soot blotches, no hard edge
      const stain = smooth((nB - 0.2) / 0.35) * (0.6 + 0.4 * nM);
      r *= 1 - stain * 0.15; g *= 1 - stain * 0.165; bb *= 1 - stain * 0.185;
      // rare small chips in the wash
      const chip = smooth((nF * 0.6 + nB * 0.5 - 0.5) / 0.04);
      r = lerp(r, baseR * 0.82, chip * 0.75); g = lerp(g, baseG * 0.82, chip * 0.75); bb = lerp(bb, baseB * 0.82, chip * 0.75);
      const jd = 1 - (1 - face) * 0.07; r *= jd; g *= jd; bb *= jd;
      const i = y * size + x, k = i * 4;
      col[k] = clamp(r, 0, 255); col[k + 1] = clamp(g, 0, 255); col[k + 2] = clamp(bb, 0, 255); col[k + 3] = 255;
      hgt[i] = face * 0.35 + (1 - chip) * 0.08 + nF * 0.03 + nM * 0.025;
      const ro = 0.93 - chip * 0.04 + nF * 0.03;
      rgh[k] = rgh[k + 1] = rgh[k + 2] = clamp(ro, 0, 1) * 255; rgh[k + 3] = 255;
    }
  }
  return { map: dataTex(col, size, size, true), normalMap: dataTex(heightNormals(hgt, size, size, 1.4), size, size, false), roughnessMap: dataTex(rgh, size, size, false), meters };
}

// a tileable normal/colour pair from noise (leather grain, crinkle paint, felt, olive-drab sand finish)
function noiseTex({ size = 256, freq = 16, oct = 3, seed = 1, k = 2, ridged = false, rgb = null, vary = 0.1 } = {}) {
  const N = makeNoise(seed), h = new Float32Array(size * size), col = rgb ? new Uint8Array(size * size * 4) : null;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * freq, v = y / size * freq;
    let n = ridged ? N.ridge2(u, v, oct, freq, freq) : N.fbm2(u, v, oct, 2, 0.5, freq, freq);
    const i = y * size + x; h[i] = n;
    if (col) {
      const m = 1 + (N.fbm2(u * 0.25 + 5, v * 0.25 + 3, 3, 2, 0.5, freq / 4, freq / 4) * vary * 2) + n * vary;
      col[i * 4] = clamp(rgb[0] * m, 0, 255); col[i * 4 + 1] = clamp(rgb[1] * m, 0, 255); col[i * 4 + 2] = clamp(rgb[2] * m, 0, 255); col[i * 4 + 3] = 255;
    }
  }
  return { normalMap: dataTex(heightNormals(h, size, size, k), size, size, false), map: col ? dataTex(col, size, size, true) : null };
}

// hessian (burlap) weave for the sandbags
function paintBurlap(seed = 3, S = 256) {
  const N = makeNoise(seed), col = new Uint8Array(S * S * 4), h = new Float32Array(S * S), T = 22;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const fu = (u * T) % 1, fv = (v * T) % 1;
    const warp = Math.pow(Math.max(0, 1 - Math.abs(fu - 0.5) * 2.4), 0.6) * (0.55 + 0.45 * Math.sin(v * T * Math.PI * 2));
    const weft = Math.pow(Math.max(0, 1 - Math.abs(fv - 0.5) * 2.4), 0.6) * (0.55 - 0.45 * Math.sin(u * T * Math.PI * 2));
    const n = N.fbm2(u * 8, v * 8, 3, 2, 0.5, 8, 8), f = N.fbm2(u * 64, v * 64, 2, 2, 0.5, 64, 64);
    const hh = Math.max(warp, weft) + f * 0.15;
    const i = y * S + x, k = i * 4; h[i] = hh;
    const m = (0.42 + 0.58 * clamp(hh * 1.3)) * (0.9 + n * 0.25);
    col[k] = clamp(168 * m, 0, 255); col[k + 1] = clamp(146 * m, 0, 255); col[k + 2] = clamp(104 * m, 0, 255); col[k + 3] = 255;
  }
  return { map: dataTex(col, S, S, true), normalMap: dataTex(heightNormals(h, S, S, 2.5), S, S, false) };
}

// the heavy table's top, one canvas for the whole 2.0 x 1.05 m: five boards, worn varnish, coffee rings, ink, a burn.
// canvas row 0 = the FRONT edge (+z); flipY off so colour, roughness and normals share rows.
function paintTableTop(seed = 23) {
  const W = 2048, H = 1076, c = cnv(W, H), x = c.getContext('2d');
  const img = x.createImageData(W, H), d = img.data, hgt = new Float32Array(W * H), rg = new Uint8Array(W * H * 4);
  const N = makeNoise(seed), N2 = makeNoise(seed + 9), R = rng(seed);
  const boards = 5, bh = H / boards, B = [];
  for (let b = 0; b < boards; b++) B.push({ t: R(), o: R() * 40, k: R() * 6.28 });
  const dark = [66, 43, 26], light = [146, 104, 64];
  for (let j = 0; j < H; j++) {
    const b = Math.min(boards - 1, Math.floor(j / bh)), jb = j - b * bh, bb = B[b];
    const seam = 1 - Math.exp(-Math.min(jb, bh - jb) / 1.4);
    for (let i = 0; i < W; i++) {
      const g1 = N.fbm2(i / 700 + bb.o, j / 5.5 + b * 17.3, 3);
      const ring = Math.pow(Math.abs(Math.sin(j * 0.21 + N2.fbm2(i / 320 + bb.o, jb / 60 + b, 2) * 9 + bb.k)), 6);
      const fig = N2.noise2(i / 80 + bb.o, j / 14);
      const wear = smooth((N.noise2(i / 260, j / 180 + 3) + 0.2) * 1.8) * 0.45 + smooth((0.2 - j / H) / 0.2) * 0.45;
      const l = clamp(0.55 + g1 * 0.3 + fig * 0.06 - ring * 0.15 + (bb.t - 0.5) * 0.16 + wear * 0.1);
      const sd = 0.3 + 0.7 * seam, k = (j * W + i) * 4;
      d[k] = lerp(dark[0], light[0], l) * sd; d[k + 1] = lerp(dark[1], light[1], l) * sd; d[k + 2] = lerp(dark[2], light[2], l) * sd; d[k + 3] = 255;
      hgt[j * W + i] = seam * 0.6 + g1 * 0.05 - ring * 0.03;
      const ro = 0.40 + wear * 0.25 + (1 - seam) * 0.35 + fig * 0.05;
      rg[k] = rg[k + 1] = rg[k + 2] = clamp(ro) * 255; rg[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const px = (X) => (X - TABLE.x + TABLE.w / 2) / TABLE.w * W, py = (Z) => (TABLE.z + TABLE.d / 2 - Z) / TABLE.d * H, ppm = W / TABLE.w;
  // coffee rings where mugs have stood (world x, z, radius)
  x.lineCap = 'round';
  const rings = [[0.30, 0.52, 0.043], [0.36, 0.60, 0.043], [-0.86, 0.50, 0.042], [0.05, -0.20, 0.055], [0.78, 0.60, 0.043], [-0.62, -0.24, 0.043]];
  for (const [X, Z, r] of rings) {
    const cx = px(X), cy = py(Z), rr = r * ppm, a0 = R() * 6.28, span = 4.2 + R() * 2;
    for (let pass = 0; pass < 3; pass++) {
      x.strokeStyle = `rgba(${40 + pass * 8},${22 + pass * 5},${10},${0.20 - pass * 0.05})`; x.lineWidth = (2.6 - pass * 0.6) * (1 + pass);
      x.beginPath();
      for (let k = 0; k <= 60; k++) { const a = a0 + span * k / 60, q = rr * (1 + 0.02 * Math.sin(a * 5 + pass)); const X2 = cx + Math.cos(a) * q, Y2 = cy + Math.sin(a) * q; k ? x.lineTo(X2, Y2) : x.moveTo(X2, Y2); }
      x.stroke();
    }
  }
  // ink blot, a cigarette burn at the front edge, scratches, a wax drip
  x.fillStyle = 'rgba(18,16,40,0.55)';
  for (let k = 0; k < 7; k++) { x.beginPath(); x.arc(px(0.58) + (R() - 0.5) * 30, py(0.02) + (R() - 0.5) * 20, 3 + R() * 9, 0, 6.29); x.fill(); }
  for (const [X, Z] of [[0.62, 0.69], [-0.4, 0.70], [0.9, 0.66]]) {
    const g = x.createRadialGradient(px(X), py(Z), 1, px(X), py(Z), 22); g.addColorStop(0, 'rgba(20,10,4,0.85)'); g.addColorStop(0.5, 'rgba(40,20,8,0.4)'); g.addColorStop(1, 'rgba(40,20,8,0)');
    x.fillStyle = g; x.save(); x.translate(px(X), py(Z)); x.scale(2.2, 0.8); x.translate(-px(X), -py(Z)); x.beginPath(); x.arc(px(X), py(Z), 22, 0, 6.29); x.fill(); x.restore();
  }
  for (let k = 0; k < 90; k++) {
    const X = R() * W, Y = R() * H, L = 20 + R() * 160, a = (R() - 0.5) * 0.6 + (R() < 0.3 ? 1.2 : 0);
    x.strokeStyle = `rgba(${R() < 0.5 ? '190,150,105' : '30,18,10'},${0.10 + R() * 0.12})`; x.lineWidth = 0.8 + R();
    x.beginPath(); x.moveTo(X, Y); x.lineTo(X + Math.cos(a) * L, Y + Math.sin(a) * L); x.stroke();
  }
  x.fillStyle = 'rgba(236,226,196,0.85)';
  for (let k = 0; k < 9; k++) { x.beginPath(); x.ellipse(px(-0.86) + (R() - 0.5) * 60, py(-0.18) + (R() - 0.5) * 60, 2 + R() * 6, 2 + R() * 5, R() * 3, 0, 6.29); x.fill(); }
  return { map: canvasTex(c, { flipY: false }), normalMap: dataTex(heightNormals(hgt, W, H, 1.6, false), W, H, false, false), roughnessMap: dataTex(rg, W, H, false, false) };
}

// plain paper (typing paper, message forms): cream fibre and a faintly yellowed edge
function paperCanvas(W, H, seed, base = [244, 239, 227], edgeK = 0.035) {
  const c = cnv(W, H), x = c.getContext('2d'), img = x.createImageData(W, H), d = img.data, N = makeNoise(seed);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = (j * W + i) * 4;
    const n = (h01(i, j, seed) - 0.5) * 7 + N.noise2(i / 45, j / 45) * 4 + N.noise2(i / 3, j / 13) * 2;
    const e = Math.max(0, 1 - Math.min(i, W - i, j, H - j) / (W * edgeK));
    d[k] = base[0] + n - e * 6; d[k + 1] = base[1] + n - e * 9; d[k + 2] = base[2] + n - e * 16; d[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return { c, x };
}

// the German ultimatum (as printed in McAuliffe's Christmas message), typed on a sheet lying on the table
const ULTIMATUM = [
  'To the U.S.A. Commander of the encircled town of Bastogne.', '',
  'The fortune of war is changing. This time the U.S.A. forces in and near Bastogne have been encircled by strong German armored units. More German armored units have crossed the river Ourthe near Ortheuville, have taken Marche and reached St. Hubert by passing through Hompre-Sibret-Tillet. Libramont is in German hands.', '',
  'There is only one possibility to save the encircled U.S.A. troops from total annihilation: that is the honorable surrender of the encircled town. In order to think it over a term of two hours will be granted beginning with the presentation of this note.', '',
  'If this proposal should be rejected one German Artillery Corps and six heavy A. A. Battalions are ready to annihilate the U.S.A. troops in and near Bastogne. The order for firing will be given immediately after this two hours term.', '',
  'All the serious civilian losses caused by this artillery fire would not correspond with the well-known American humanity.', '',
  '                                  The German Commander.',
];
function typedSheet(lines, seed, W = 1024) {
  const H = Math.round(W * 11 / 8.5), { c, x } = paperCanvas(W, H, seed), ppi = W / 8.5, pitch = ppi / 10, lh = ppi / 6;
  x.fillStyle = '#16130f'; x.textBaseline = 'alphabetic'; x.textAlign = 'center';
  x.font = `${Math.round(pitch * 1.62)}px HQElite`;
  let row = 0; const left = ppi * 1.0, cols = 64;
  for (const para of lines) {
    const words = para.split(' '); let line = '';
    const out = [];
    if (!para.trim()) out.push('');
    else if (para.startsWith(' ')) out.push(para);
    else { for (const w of words) { if ((line + ' ' + w).trim().length > cols) { out.push(line.trim()); line = w; } else line += ' ' + w; } if (line.trim()) out.push(line.trim()); }
    for (const ln of out) {
      [...ln].forEach((ch, k) => { if (ch !== ' ') { x.globalAlpha = 0.72 + 0.26 * h01(row, k, seed); x.fillText(ch, left + (k + 0.5) * pitch, ppi * 1.2 + row * lh + (h01(k, row, 3) - 0.5) * 0.6); } });
      row++;
    }
  }
  x.globalAlpha = 1;
  return c;
}

// US Army field message pad sheet (M-210 style) with a few pencilled lines
function messageForm(seed, W = 512) {
  const H = Math.round(W * 1.45), { c, x } = paperCanvas(W, H, seed, [236, 232, 214]);
  x.strokeStyle = 'rgba(70,90,120,0.55)'; x.lineWidth = 1.2;
  x.fillStyle = 'rgba(40,50,70,0.8)'; x.font = `600 ${Math.round(W * 0.03)}px HQSans`; x.textAlign = 'left';
  x.fillText('MESSAGE', W * 0.06, H * 0.05); x.fillText('No.', W * 0.62, H * 0.05);
  for (let k = 0; k < 18; k++) { x.beginPath(); x.moveTo(W * 0.05, H * (0.12 + k * 0.045)); x.lineTo(W * 0.95, H * (0.12 + k * 0.045)); x.stroke(); }
  x.strokeStyle = 'rgba(55,50,48,0.7)'; x.lineWidth = 1.6; const R = rng(seed);
  for (let k = 0; k < 7; k++) {
    let X = W * 0.08; const Y = H * (0.155 + k * 0.045) - 4; x.beginPath(); x.moveTo(X, Y);
    const end = W * (0.45 + R() * 0.45);
    while (X < end) { X += 3 + R() * 5; x.lineTo(X, Y - R() * 7 + 2); }
    x.stroke();
  }
  return c;
}

// the calendar page above the desk: December 1944, the days of the siege crossed out
function calendar(W = 512) {
  const H = 700, { c, x } = paperCanvas(W, H, 77, [238, 233, 219]);
  x.fillStyle = '#7a1e18'; x.fillRect(0, 0, W, 118);
  x.fillStyle = '#efe6d2'; x.textAlign = 'center'; x.font = `700 58px HQSerif`; x.fillText('DECEMBER', W / 2, 70); x.font = '600 30px HQSans'; x.fillText('1 9 4 4', W / 2, 106);
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], cw = W / 7;
  x.fillStyle = '#2a2320'; x.font = '600 26px HQSans';
  days.forEach((dd, i) => x.fillText(dd, cw * (i + 0.5), 158));
  x.font = '44px HQSerif';
  for (let day = 1; day <= 31; day++) {
    const idx = day + 4, col = idx % 7, row = Math.floor(idx / 7);          // 1 December 1944 was a Friday
    const X = cw * (col + 0.5), Y = 215 + row * 88;
    x.fillStyle = col === 0 ? '#8a2a22' : '#2a2320'; x.fillText(String(day), X, Y);
    if (day <= 21) {
      x.strokeStyle = 'rgba(50,48,52,0.75)'; x.lineWidth = 3; const k = day * 7.1;
      x.beginPath(); x.moveTo(X - 24 + Math.sin(k) * 3, Y - 36); x.lineTo(X + 22, Y + 8 + Math.cos(k) * 3); x.moveTo(X + 22 + Math.cos(k) * 2, Y - 36); x.lineTo(X - 22, Y + 8); x.stroke();
    }
    if (day === 22) { x.strokeStyle = 'rgba(60,40,40,0.8)'; x.lineWidth = 3; x.beginPath(); x.ellipse(X, Y - 14, 34, 30, 0.2, 0, 6.29); x.stroke(); }
  }
  return c;
}

// radio front panel: black crinkle, engraved white legends, an amber-lit tuning dial (the emissive map)
function radioPanel() {
  const W = 1024, H = 640, c = cnv(W, H), x = c.getContext('2d'), e = cnv(W, H), ex = e.getContext('2d');
  const img = x.createImageData(W, H), d = img.data;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = (j * W + i) * 4, n = h01(i, j, 5) * 14 + 12; d[k] = n; d[k + 1] = n; d[k + 2] = n * 0.95; d[k + 3] = 255; }
  x.putImageData(img, 0, 0);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
  // dial window
  const dx = 300, dy = 90, dw = 430, dh = 150;
  x.fillStyle = '#c9a25a'; x.fillRect(dx, dy, dw, dh);
  const g = ex.createLinearGradient(0, dy, 0, dy + dh); g.addColorStop(0, '#6b4a1c'); g.addColorStop(0.5, '#ffcf7a'); g.addColorStop(1, '#6b4a1c');
  ex.fillStyle = g; ex.fillRect(dx, dy, dw, dh);
  for (const ctx of [x, ex]) {
    ctx.strokeStyle = '#1a1208'; ctx.fillStyle = '#1a1208'; ctx.lineWidth = 2; ctx.textAlign = 'center'; ctx.font = '600 22px HQSans';
    for (let k = 0; k <= 40; k++) { const X = dx + 20 + k * (dw - 40) / 40; ctx.beginPath(); ctx.moveTo(X, dy + 18); ctx.lineTo(X, dy + (k % 5 ? 36 : 50)); ctx.stroke(); if (k % 5 === 0) ctx.fillText(String(20 + k / 5), X, dy + 78); }
    ctx.fillStyle = '#b01010'; ctx.fillRect(dx + 20 + 23 * (dw - 40) / 40, dy + 10, 4, dh - 20);
  }
  x.strokeStyle = '#8a8a86'; x.lineWidth = 6; x.strokeRect(dx - 4, dy - 4, dw + 8, dh + 8);
  x.fillStyle = '#e8e4da'; x.textAlign = 'center'; x.font = '600 24px HQSans';
  const labels = [['VOLUME', 150, 380], ['TUNE', 515, 380], ['BAND', 860, 380], ['SEND', 150, 590], ['ANT.', 515, 590], ['CAL.', 860, 590]];
  for (const [t, X, Y] of labels) x.fillText(t, X, Y);
  x.font = '600 20px HQSans'; x.fillText('FREQ. MC', dx + dw / 2, dy + dh + 36);
  x.fillText('RECEIVER - TRANSMITTER', W / 2, 36); x.fillText('SIGNAL CORPS  U. S. ARMY', W / 2, H - 14);
  for (const X of [60, W - 60]) for (const Y of [40, H - 40]) { x.fillStyle = '#6c6c68'; x.beginPath(); x.arc(X, Y, 12, 0, 6.29); x.fill(); x.fillStyle = '#2a2a28'; x.fillRect(X - 9, Y - 1.5, 18, 3); }
  // meter
  x.fillStyle = '#d8d0bc'; x.beginPath(); x.arc(150, 170, 70, Math.PI, 0); x.fill(); x.fillStyle = '#1a1a18'; x.fillRect(80, 170, 140, 4);
  x.strokeStyle = '#1a1a18'; x.lineWidth = 3; x.beginPath(); x.moveTo(150, 170); x.lineTo(120, 115); x.stroke();
  x.fillStyle = '#e8e4da'; x.fillText('PLATE', 150, 270);
  return { map: canvasTex(c), emissive: canvasTex(e) };
}

// stencilled crate side
function crateLabel(lines, seed, W = 512, H = 256) {
  const c = cnv(W, H), x = c.getContext('2d');
  x.clearRect(0, 0, W, H); x.fillStyle = 'rgba(226,206,120,0.9)'; x.textAlign = 'center';
  lines.forEach((t, i) => { x.font = `700 ${i ? 34 : 44}px HQSans`; x.fillText(t, W / 2, 70 + i * 58); });
  // stencil bridges + wear
  x.globalCompositeOperation = 'destination-out'; const R = rng(seed);
  for (let k = 0; k < 1400; k++) { x.fillStyle = `rgba(0,0,0,${0.3 + R() * 0.6})`; x.fillRect(R() * W, R() * H, 1 + R() * 4, 1 + R() * 3); }
  for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(0,0,0,1)'; x.fillRect(20 + i * 34 + R() * 10, 0, 2, H); }
  x.globalCompositeOperation = 'source-over';
  return c;
}

// key legends: one 128 px cell per key, glass-topped black caps with white letters
function keyAtlas(keys) {
  const S = 1024, cell = 128, n = 8, c = cnv(S, S), x = c.getContext('2d');
  x.fillStyle = '#0b0a0a'; x.fillRect(0, 0, S, S);
  keys.forEach((k, i) => {
    const cx = (i % n) * cell + cell / 2, cy = Math.floor(i / n) * cell + cell / 2;
    const g = x.createRadialGradient(cx - 16, cy - 20, 4, cx, cy, 64); g.addColorStop(0, '#2c2a28'); g.addColorStop(0.6, '#121110'); g.addColorStop(1, '#090808');
    x.fillStyle = g; x.fillRect(cx - 64, cy - 64, 128, 128);
    x.fillStyle = '#ECE5D4'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const L = k.legend;
    if (L.length === 1 && L[0].length === 1) { x.font = '700 62px HQSans'; x.fillText(L[0], cx, cy + 3); }
    else if (L.length === 2) { x.font = '700 42px HQSans'; x.fillText(L[1], cx, cy - 22); x.fillText(L[0], cx, cy + 25); }
    else { x.font = '700 24px HQSans'; x.fillText(L[0], cx, cy + 2); }
  });
  const t = canvasTex(c);
  return { tex: t, uv: (i) => ({ u0: (i % n) / n, v0: 1 - (Math.floor(i / n) + 1) / n, s: 1 / n }) };
}

// ── THE MAP: a 1944 staff map of the Bastogne area (placeholder until opts.mapCanvas is supplied) ────────────
// Draws into canvas `c`. o: {km: map width in km (22), seed, contour: interval m (10), overlay: grease-pencil situation
// marks + returns pin positions}. Bastogne sits at the centre; seven main roads converge on it.
const VILLAGES = [
  ['Noville', 0.9, 6.6], ['Foy', 0.3, 3.4], ['Recogne', -0.9, 3.1], ['Bourcy', 5.6, 6.1], ['Longvilly', 7.5, 2.0],
  ['Mageret', 3.9, 1.3], ['Neffe', 2.6, -0.3], ['Wardin', 4.6, -2.0], ['Marvie', 2.8, -2.4], ['Remoifosse', 0.9, -3.8],
  ['Assenois', -1.2, -4.8], ['Sibret', -4.9, -3.6], ['Senonchamps', -3.1, -1.6], ['Mande-St-Étienne', -5.4, 1.6],
  ['Champs', -4.3, 3.3], ['Longchamps', -2.4, 4.6], ['Hemroulle', -2.0, 1.3], ['Savy', -1.2, 2.2], ['Luzery', -0.4, 1.7],
  ['Isle-la-Hesse', -1.6, -0.6], ['Villers-la-Bonne-Eau', 5.0, -5.2], ['Hompré', -2.6, -6.6], ['Flamierge', -8.0, 3.8],
];
const ROADS = [
  { to: 'HOUFFALIZE', pts: [[0, 0], [0.2, 1.6], [0.3, 3.4], [0.6, 5.1], [0.9, 6.6], [1.4, 8.6], [2.0, 11.6]] },
  { to: 'BOURCY', pts: [[0, 0], [1.1, 1.2], [2.5, 2.6], [4.0, 4.3], [5.6, 6.1], [7.1, 8.2], [8.9, 11.6]] },
  { to: 'LONGVILLY', pts: [[0, 0], [1.4, 0.6], [2.6, 0.95], [3.9, 1.3], [5.7, 1.6], [7.5, 2.0], [9.4, 2.7], [11.6, 3.3]] },
  { to: 'WILTZ', pts: [[0, 0], [1.3, -0.4], [2.6, -0.3], [3.8, -1.1], [4.6, -2.0], [6.4, -2.7], [8.6, -3.6], [11.6, -4.7]] },
  { to: 'ARLON', pts: [[0, 0], [0.35, -1.7], [0.9, -3.8], [1.2, -5.5], [1.6, -7.6], [2.1, -9.6], [2.5, -11.6]] },
  { to: 'NEUFCHÂTEAU', pts: [[0, 0], [-1.3, -0.9], [-3.0, -2.3], [-4.9, -3.6], [-6.7, -5.4], [-8.7, -7.6], [-10.9, -9.9]] },
  { to: 'MARCHE', pts: [[0, 0], [-1.6, 0.45], [-3.4, 1.0], [-5.4, 1.6], [-7.4, 2.4], [-9.4, 3.1], [-11.6, 3.9]] },
];
const MINOR = [
  [[-1.3, -0.9], [-1.6, -0.6], [-3.1, -1.6]], [[-1.6, 0.45], [-2.0, 1.3], [-3.2, 2.4], [-4.3, 3.3], [-5.9, 4.4]],
  [[0.2, 1.6], [-0.4, 1.7], [-1.2, 2.2], [-2.4, 4.6], [-2.8, 6.5]], [[0.3, 3.4], [-0.9, 3.1], [-1.9, 2.7]],
  [[2.6, -0.3], [2.8, -2.4], [3.9, -3.5], [5.0, -5.2]], [[0.35, -1.7], [-0.5, -3.2], [-1.2, -4.8], [-2.6, -6.6]],
  [[-3.0, -2.3], [-3.1, -1.6], [-4.2, -0.4], [-5.4, 1.6]], [[3.9, 1.3], [4.4, 2.6], [5.6, 6.1]], [[0.9, 6.6], [3.0, 7.0], [5.6, 6.1]],
];
const RAIL = [[-11.6, -6.4], [-7.2, -4.4], [-3.6, -2.1], [-1.2, -0.7], [0.2, 0.25], [1.7, 1.8], [3.4, 3.7], [5.3, 5.5], [7.3, 7.1], [9.6, 9.0], [11.6, 11.0]];

export function drawStaffMap(c, o = {}) {
  const W = c.width, H = c.height, x = c.getContext('2d');
  const seed = o.seed ?? 1944, km = o.km ?? 22, step = o.contour ?? 10, s = W / 2048;
  const N = makeNoise(seed), N2 = makeNoise(seed + 17), N3 = makeNoise(seed + 29), R = rng(seed);
  const mx = Math.round(W * 0.05), mt = Math.round(H * 0.07), mb = Math.round(H * 0.06);
  const iw = W - 2 * mx, ih = H - mt - mb, ppk = iw / km, kmH = ih / ppk, cx = mx + iw / 2, cy = mt + ih / 2;
  const P = (e, n) => [cx + e * ppk, cy - n * ppk];
  // paper
  { const img = x.createImageData(W, H), d = img.data;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 4, n = (h01(i, j, seed) - 0.5) * 8 + N3.noise2(i / 120, j / 120) * 6 + N3.noise2(i / 9, j / 31) * 2;
      const e = Math.max(0, 1 - Math.min(i, W - i, j, H - j) / (W * 0.03));
      d[k] = 236 + n - e * 10; d[k + 1] = 228 + n - e * 14; d[k + 2] = 206 + n - e * 24; d[k + 3] = 255;
    }
    x.putImageData(img, 0, 0); }
  const valleyN = (e, n) => N2.fbm2(e / 5.2 + 3.3, n / 5.2 - 1.7, 3);
  const valley = (e, n) => 1 - smooth(Math.abs(valleyN(e, n)) / 0.16);
  const hAt = (e, n) => 505 + 32 * N.fbm2(e / 4.5 + 7.1, n / 4.5 + 2.9, 4) - 62 * valley(e, n) + 12 * N3.fbm2(e / 1.3, n / 1.3, 2);
  const towns = [[0, 0, 1.7], ...VILLAGES.map((v) => [v[1], v[2], 0.45])];
  const forest = (e, n) => {
    let m = N3.fbm2(e / 1.6 + 11.3, n / 1.6 - 5.1, 4) + 0.16 * valley(e, n);
    for (const [te, tn, tr] of towns) { const dd = Math.hypot(e - te, n - tn); if (dd < tr * 1.6) m -= 0.55 * (1 - dd / (tr * 1.6)); }
    return m;
  };
  x.save(); x.beginPath(); x.rect(mx, mt, iw, ih); x.clip();
  // woods: soft green fill, diagonal hatching and tree dots, from one mask
  { const qw = Math.round(iw / 4), qh = Math.round(ih / 4), mc = cnv(qw, qh), mx2 = mc.getContext('2d'), img = mx2.createImageData(qw, qh);
    const M = new Float32Array(qw * qh);
    for (let j = 0; j < qh; j++) for (let i = 0; i < qw; i++) {
      const e = ((i + 0.5) / qw - 0.5) * km, n = (0.5 - (j + 0.5) / qh) * kmH, m = forest(e, n), a = smooth((m - 0.06) / 0.035), k = (j * qw + i) * 4;
      M[j * qw + i] = a; img.data[k] = 150; img.data[k + 1] = 188; img.data[k + 2] = 124; img.data[k + 3] = a * 210;
    }
    mx2.putImageData(img, 0, 0);
    x.imageSmoothingEnabled = true; x.drawImage(mc, mx, mt, iw, ih);
    const hc = cnv(iw, ih), hx = hc.getContext('2d');
    hx.strokeStyle = 'rgba(58,96,50,0.55)'; hx.lineWidth = 1.3 * s;
    for (let k = -ih; k < iw; k += 10 * s) { hx.beginPath(); hx.moveTo(k, ih); hx.lineTo(k + ih, 0); hx.stroke(); }
    hx.fillStyle = 'rgba(40,78,36,0.8)';
    for (let j = 0; j < ih; j += 26 * s) for (let i = 0; i < iw; i += 26 * s) {
      const X = i + (h01(i, j, 5) - 0.5) * 16 * s, Y = j + (h01(j, i, 6) - 0.5) * 16 * s, q = M[Math.min(qh - 1, Math.floor(Y / 4)) * qw + Math.min(qw - 1, Math.floor(X / 4))];
      if (q > 0.6) { hx.beginPath(); hx.arc(X, Y, 2.6 * s, 0, 6.29); hx.fill(); }
    }
    hx.globalCompositeOperation = 'destination-in'; hx.drawImage(mc, 0, 0, iw, ih);
    x.drawImage(hc, mx, mt); }
  // contours (marching squares on a 6 px grid)
  { const gs = 6 * s, gw = Math.round(iw / gs), gh = Math.round(ih / gs), G = new Float32Array((gw + 1) * (gh + 1));
    let lo = 1e9, hi = -1e9;
    for (let j = 0; j <= gh; j++) for (let i = 0; i <= gw; i++) { const v = hAt((i / gw - 0.5) * km, (0.5 - j / gh) * kmH); G[j * (gw + 1) + i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const X = (i) => mx + i / gw * iw, Y = (j) => mt + j / gh * ih;
    for (let L = Math.ceil(lo / step) * step; L < hi; L += step) {
      const index = L % (step * 5) === 0;
      x.strokeStyle = index ? 'rgba(150,92,44,0.85)' : 'rgba(168,112,62,0.6)'; x.lineWidth = (index ? 2.2 : 1.1) * s;
      x.beginPath();
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const a = G[j * (gw + 1) + i], b = G[j * (gw + 1) + i + 1], cc = G[(j + 1) * (gw + 1) + i + 1], dd = G[(j + 1) * (gw + 1) + i];
        const id = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (cc > L ? 2 : 0) | (dd > L ? 1 : 0);
        if (id === 0 || id === 15) continue;
        const T = [X(i + (L - a) / (b - a)), Y(j)], Rr = [X(i + 1), Y(j + (L - b) / (cc - b))], B = [X(i + (L - dd) / (cc - dd)), Y(j + 1)], Lf = [X(i), Y(j + (L - a) / (dd - a))];
        const seg = (p, q) => { x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); };
        switch (id) {
          case 1: case 14: seg(Lf, B); break; case 2: case 13: seg(B, Rr); break; case 3: case 12: seg(Lf, Rr); break;
          case 4: case 11: seg(T, Rr); break; case 6: case 9: seg(T, B); break; case 7: case 8: seg(Lf, T); break;
          case 5: seg(Lf, T); seg(B, Rr); break; case 10: seg(T, Rr); seg(Lf, B); break;
        }
      }
      x.stroke();
    }
    // streams: the valley floors (zero set of the valley noise), broken into reaches
    x.strokeStyle = 'rgba(46,92,160,0.9)'; x.lineWidth = 1.7 * s; x.beginPath();
    const S2 = new Float32Array((gw + 1) * (gh + 1));
    for (let j = 0; j <= gh; j++) for (let i = 0; i <= gw; i++) S2[j * (gw + 1) + i] = valleyN((i / gw - 0.5) * km, (0.5 - j / gh) * kmH);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      if (N3.noise2(i * gs / ppk / 2.1 + 50, j * gs / ppk / 2.1) < -0.18) continue;
      const a = S2[j * (gw + 1) + i], b = S2[j * (gw + 1) + i + 1], cc = S2[(j + 1) * (gw + 1) + i + 1], dd = S2[(j + 1) * (gw + 1) + i];
      const id = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (cc > 0 ? 2 : 0) | (dd > 0 ? 1 : 0);
      if (id === 0 || id === 15) continue;
      const T = [X(i + a / (a - b)), Y(j)], Rr = [X(i + 1), Y(j + b / (b - cc))], B = [X(i + dd / (dd - cc)), Y(j + 1)], Lf = [X(i), Y(j + a / (a - dd))];
      const seg = (p, q) => { x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); };
      switch (id) {
        case 1: case 14: seg(Lf, B); break; case 2: case 13: seg(B, Rr); break; case 3: case 12: seg(Lf, Rr); break;
        case 4: case 11: seg(T, Rr); break; case 6: case 9: seg(T, B); break; case 7: case 8: seg(Lf, T); break;
        case 5: seg(Lf, T); seg(B, Rr); break; case 10: seg(T, Rr); seg(Lf, B); break;
      }
    }
    x.stroke(); }
  // grid, 1 km
  const E0 = 71.4, N0 = 50.6;
  x.strokeStyle = 'rgba(20,20,20,0.42)'; x.lineWidth = 1.1 * s; x.beginPath();
  for (let E = Math.ceil(E0 - km / 2); E <= E0 + km / 2; E++) { const [X] = P(E - E0, 0); x.moveTo(X, mt); x.lineTo(X, mt + ih); }
  for (let Nn = Math.ceil(N0 - kmH / 2); Nn <= N0 + kmH / 2; Nn++) { const [, Y] = P(0, Nn - N0); x.moveTo(mx, Y); x.lineTo(mx + iw, Y); }
  x.stroke();
  // roads: a smooth path through the waypoints with a little wobble
  const pathOf = (pts, wob = 0.05) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let k = 0; k < 14; k++) {
        const t = k / 14, t2 = t * t, t3 = t2 * t;
        const e = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const n = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        out.push([e + N.noise2(e * 2.3, n * 2.3 + 40) * wob, n + N.noise2(e * 2.3 + 70, n * 2.3) * wob]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out.map(([e, n]) => P(e, n));
  };
  const stroke = (pp, style, w, dash) => { x.strokeStyle = style; x.lineWidth = w; x.setLineDash(dash || []); x.beginPath(); pp.forEach(([X, Y], i) => (i ? x.lineTo(X, Y) : x.moveTo(X, Y))); x.stroke(); x.setLineDash([]); };
  x.lineJoin = 'round'; x.lineCap = 'round';
  const minor = MINOR.map((m) => pathOf(m, 0.07));
  for (const pp of minor) stroke(pp, '#262220', 5.2 * s);
  for (const pp of minor) stroke(pp, '#e9b64c', 3.0 * s);
  // tracks
  for (let k = 0; k < 16; k++) {
    const a = R() * 6.28, r0 = 1.5 + R() * 8, e0 = Math.cos(a) * r0, n0 = Math.sin(a) * r0, b = a + (R() - 0.5) * 2.4;
    stroke(pathOf([[e0, n0], [e0 + Math.cos(b) * 1.2, n0 + Math.sin(b) * 1.2], [e0 + Math.cos(b + 0.4) * 2.4, n0 + Math.sin(b + 0.4) * 2.4]], 0.08), 'rgba(30,26,24,0.8)', 1.3 * s, [7 * s, 5 * s]);
  }
  const mains = ROADS.map((r) => pathOf(r.pts, 0.04));
  for (const pp of mains) stroke(pp, '#1d1a18', 8.4 * s);
  for (const pp of mains) stroke(pp, '#c8432e', 5.0 * s);
  // railway
  { const pp = pathOf(RAIL, 0.02); stroke(pp, '#1d1a18', 2.6 * s);
    x.strokeStyle = '#1d1a18'; x.lineWidth = 1.6 * s; x.beginPath(); let acc = 0;
    for (let i = 1; i < pp.length; i++) { const dx = pp[i][0] - pp[i - 1][0], dy = pp[i][1] - pp[i - 1][1], L = Math.hypot(dx, dy); acc += L;
      if (acc > 16 * s) { acc = 0; const nx = -dy / L * 5 * s, ny = dx / L * 5 * s; x.moveTo(pp[i][0] - nx, pp[i][1] - ny); x.lineTo(pp[i][0] + nx, pp[i][1] + ny); } }
    x.stroke(); }
  // buildings: Bastogne dense along its seven roads, villages in small clusters
  const building = (e, n, ang, big = 1) => { const [X, Y] = P(e, n); x.save(); x.translate(X, Y); x.rotate(ang); const w = (4 + R() * 6) * s * big, h = (3 + R() * 4) * s * big; x.fillRect(-w / 2, -h / 2, w, h); x.restore(); };
  x.fillStyle = '#1b1816';
  for (let k = 0; k < 420; k++) {
    if (k < 170) { const a = R() * 6.28, r = Math.pow(R(), 0.8) * 0.55; building(Math.cos(a) * r, Math.sin(a) * r, R() * 0.4 + (k % 2) * 1.57); continue; }
    const rd = ROADS[k % 7].pts, t = Math.pow(R(), 1.4) * 1.3, a = Math.atan2(rd[1][1], rd[1][0]), side = R() < 0.5 ? -1 : 1, off = (0.07 + R() * 0.07) * side;
    building(Math.cos(a) * t - Math.sin(a) * off, Math.sin(a) * t + Math.cos(a) * off, -a + (R() - 0.5) * 0.3);
  }
  for (const [nm, e, n] of VILLAGES) for (let k = 0; k < 10; k++) building(e + (R() - 0.5) * 0.5, n + (R() - 0.5) * 0.4, R() * 1.6);
  // the Heintz barracks, north-west edge of town: long blocks round a yard
  for (const [e, n, w, h] of [[-1.13, 0.73, 9, 3.5], [-0.93, 0.74, 9, 3.5], [-1.14, 0.61, 9, 3.5], [-0.92, 0.62, 9, 3.5], [-1.13, 0.49, 9, 3.5], [-0.94, 0.50, 9, 3.5]]) { const [X, Y] = P(e, n); x.fillRect(X - w * s / 2, Y - h * s / 2, w * s, h * s); }
  { const [X, Y] = P(0.05, 0.05); x.fillRect(X - 1.5 * s, Y - 9 * s, 3 * s, 18 * s); x.fillRect(X - 6 * s, Y - 4 * s, 12 * s, 3 * s); }
  // spot heights
  x.font = `${18 * s}px HQSerif`; x.textAlign = 'left';
  for (let k = 0; k < 14; k++) { const e = (R() - 0.5) * km * 0.9, n = (R() - 0.5) * kmH * 0.9, [X, Y] = P(e, n); x.beginPath(); x.arc(X, Y, 2.2 * s, 0, 6.29); x.fill(); x.fillText(String(Math.round(hAt(e, n))), X + 5 * s, Y + 5 * s); }
  // labels
  const label = (t, e, n, font, fill = '#171412', align = 'left', track = 0) => {
    x.font = font; x.textAlign = align; const [X, Y] = P(e, n);
    x.lineWidth = 5 * s; x.strokeStyle = 'rgba(236,228,206,0.9)'; x.lineJoin = 'round';
    if (track) { let cx2 = X; for (const ch of t) { x.strokeText(ch, cx2, Y); x.fillStyle = fill; x.fillText(ch, cx2, Y); cx2 += x.measureText(ch).width + track; } return; }
    x.strokeText(t, X, Y); x.fillStyle = fill; x.fillText(t, X, Y);
  };
  for (const [nm, e, n] of VILLAGES) label(nm, e + 0.18, n + 0.12, `${25 * s}px HQSerif`);
  label('BASTOGNE', 0.45, 0.62, `700 ${50 * s}px HQSerif`, '#141210', 'left', 5 * s);
  for (const r of ROADS) { const p = r.pts[r.pts.length - 2]; label(`to ${r.to}`, p[0] + 0.25, p[1] - 0.25, `italic ${21 * s}px HQSerifI`, '#3a3230'); }
  // grease-pencil situation overlay (wall map)
  const pins = [];
  if (o.overlay) {
    const loop = [];
    for (let k = 0; k <= 64; k++) { const a = k / 64 * 6.2832, r = 4.1 + 0.9 * N.noise2(Math.cos(a) * 1.3 + 9, Math.sin(a) * 1.3) + 0.5 * Math.sin(a * 3 + 1); loop.push([Math.cos(a) * r, Math.sin(a) * r * 0.92]); }
    const lp = loop.map(([e, n]) => P(e, n));
    for (let pass = 0; pass < 3; pass++) stroke(lp.map(([X, Y]) => [X + (h01(X | 0, pass) - 0.5) * 2 * s, Y + (h01(Y | 0, pass) - 0.5) * 2 * s]), `rgba(28,64,170,${0.45 - pass * 0.1})`, (7 - pass * 2) * s);
    for (let k = 0; k < 16; k++) pins.push({ p: lp[k * 4], color: k % 4 === 0 ? 0xd8d2c0 : 0x2848b0 });
    const unit = (t, e, n, col, box = true) => {
      const [X, Y] = P(e, n); x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 3.5 * s;
      if (box) { x.strokeRect(X - 22 * s, Y - 14 * s, 44 * s, 28 * s); x.beginPath(); x.moveTo(X - 22 * s, Y - 14 * s); x.lineTo(X + 22 * s, Y + 14 * s); x.moveTo(X + 22 * s, Y - 14 * s); x.lineTo(X - 22 * s, Y + 14 * s); x.stroke(); }
      x.font = `700 ${24 * s}px HQSans`; x.textAlign = 'center'; x.fillText(t, X, Y - 20 * s);
    };
    for (const [t, e, n] of [['506', 0.4, 2.6], ['502', -2.7, 3.0], ['501', 2.3, 0.6], ['327', 1.5, -2.6], ['327', -2.8, -1.0], ['CCB 10', -0.6, 1.4]]) unit(t, e, n, 'rgba(28,64,170,0.85)');
    for (const [t, e, n] of [['26 VG', -6.2, -1.2], ['PZ LEHR', 5.8, 0.2], ['5 FJ', 2.6, -6.5], ['2 PZ', 3.4, 7.8], ['26 VG', -1.8, 6.6]]) unit(t, e, n, 'rgba(190,30,26,0.85)');
    x.strokeStyle = 'rgba(190,30,26,0.8)'; x.lineWidth = 5 * s;
    for (const [e0, n0, e1, n1] of [[-8.2, -1.8, -5.6, -1.0], [7.4, 0.6, 5.2, 0.9], [3.6, -8.6, 2.2, -5.6], [-1.2, 8.6, -1.0, 5.8], [-7.6, 4.2, -5.0, 3.0]]) {
      const [X0, Y0] = P(e0, n0), [X1, Y1] = P(e1, n1), a = Math.atan2(Y1 - Y0, X1 - X0);
      x.beginPath(); x.moveTo(X0, Y0); x.lineTo(X1, Y1); x.lineTo(X1 - Math.cos(a - 0.45) * 22 * s, Y1 - Math.sin(a - 0.45) * 22 * s); x.moveTo(X1, Y1); x.lineTo(X1 - Math.cos(a + 0.45) * 22 * s, Y1 - Math.sin(a + 0.45) * 22 * s); x.stroke();
      pins.push({ p: [X0, Y0], color: 0xb02018 });
    }
  }
  x.restore();
  // neatline, margin, grid figures, title, scale
  x.strokeStyle = '#161412'; x.lineWidth = 3.2 * s; x.strokeRect(mx, mt, iw, ih);
  x.lineWidth = 1.2 * s; x.strokeRect(mx - 14 * s, mt - 14 * s, iw + 28 * s, ih + 28 * s);
  x.fillStyle = '#1a1714'; x.font = `${19 * s}px HQSans`; x.textAlign = 'center';
  for (let E = Math.ceil(E0 - km / 2); E <= E0 + km / 2; E++) { const [X] = P(E - E0, 0); x.fillText(String(E % 100).padStart(2, '0'), X, mt - 20 * s); x.fillText(String(E % 100).padStart(2, '0'), X, mt + ih + 36 * s); }
  x.textAlign = 'right';
  for (let Nn = Math.ceil(N0 - kmH / 2); Nn <= N0 + kmH / 2; Nn++) { const [, Y] = P(0, Nn - N0); x.fillText(String(Nn % 100).padStart(2, '0'), mx - 20 * s, Y + 7 * s); }
  x.textAlign = 'left';
  for (let Nn = Math.ceil(N0 - kmH / 2); Nn <= N0 + kmH / 2; Nn++) { const [, Y] = P(0, Nn - N0); x.fillText(String(Nn % 100).padStart(2, '0'), mx + iw + 20 * s, Y + 7 * s); }
  x.textAlign = 'center'; x.font = `700 ${46 * s}px HQSerif`;
  { let tw = 0; const t = 'BASTOGNE', tr = 14 * s; for (const ch of t) tw += x.measureText(ch).width + tr; let X = W / 2 - tw / 2; x.textAlign = 'left'; for (const ch of t) { x.fillText(ch, X, mt * 0.52); X += x.measureText(ch).width + tr; } }
  x.font = `${22 * s}px HQSans`; x.textAlign = 'left'; x.fillText('BELGIUM', mx, mt * 0.5); x.textAlign = 'right'; x.fillText(o.km && o.km > 30 ? '1:50,000' : '1:25,000', W - mx, mt * 0.5);
  x.textAlign = 'left'; x.font = `italic ${19 * s}px HQSerifI`; x.fillText(`Contour interval ${step} metres`, mx, H - mb * 0.28);
  x.textAlign = 'right'; x.fillText('Grid lines at 1 kilometre', W - mx, H - mb * 0.28);
  { const X0 = W / 2 - 2 * ppk, Y = H - mb * 0.42; x.lineWidth = 2 * s; x.strokeStyle = '#1a1714';
    for (let k = 0; k < 4; k++) { x.fillStyle = k % 2 ? '#ece4ce' : '#1a1714'; x.fillRect(X0 + k * ppk, Y - 7 * s, ppk, 7 * s); x.strokeRect(X0 + k * ppk, Y - 7 * s, ppk, 7 * s); }
    x.fillStyle = '#1a1714'; x.textAlign = 'center'; x.font = `${17 * s}px HQSans`;
    for (let k = 0; k <= 4; k++) x.fillText(String(k), X0 + k * ppk, Y - 12 * s); x.fillText('KILOMETRES', W / 2, Y + 20 * s); }
  // age: fold creases, a faint coffee ring, darkened edges
  x.globalCompositeOperation = 'multiply';
  for (const [X0, Y0, X1, Y1] of [[W / 3, 0, W / 3, H], [2 * W / 3, 0, 2 * W / 3, H], [0, H / 2, W, H / 2]]) {
    const g = x.createLinearGradient(X0 - (Y1 - Y0 ? 10 : 0), Y0 - (X1 - X0 ? 10 : 0), X0 + (Y1 - Y0 ? 10 : 0), Y0 + (X1 - X0 ? 10 : 0));
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, 'rgba(180,170,150,0.35)'); g.addColorStop(0.55, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(Math.min(X0, X1) - 10, Math.min(Y0, Y1) - 10, Math.abs(X1 - X0) + 20, Math.abs(Y1 - Y0) + 20);
  }
  x.globalCompositeOperation = 'source-over';
  if (!o.overlay) { x.strokeStyle = 'rgba(120,80,40,0.16)'; x.lineWidth = 5 * s; x.beginPath(); x.arc(W * 0.86, H * 0.84, 60 * s, 0.4, 5.3); x.stroke(); }
  return { pins, P, ppk };
}

// the outside through the cellar window: snow at the sill, a grey overcast sky, a fence post
function outsideView() {
  const c = cnv(256, 256), x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#c9d2dc'); g.addColorStop(0.55, '#dfe4ea'); g.addColorStop(0.62, '#f4f6f8'); g.addColorStop(1, '#ffffff');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.fillStyle = 'rgba(70,72,78,0.55)'; x.fillRect(160, 60, 7, 100); x.fillRect(40, 110, 200, 3);
  x.fillStyle = 'rgba(120,124,130,0.35)'; for (let i = 0; i < 12; i++) x.fillRect(i * 22 + 4, 128 + (i % 3) * 3, 14, 20);
  return canvasTex(c);
}

function glowTex() {
  const c = cnv(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.45)'); g.addColorStop(0.5, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return canvasTex(c, { srgb: false });
}
function smokeTex(seed = 9) {
  const S = 128, c = cnv(S, S), x = c.getContext('2d'), img = x.createImageData(S, S), N = makeNoise(seed);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = i / S - 0.5, v = j / S - 0.5, r = Math.hypot(u, v) * 2, n = N.fbm2(i / 22, j / 22, 4) * 0.5 + 0.5;
    const a = clamp((1 - r) * 1.4) * clamp(n * 1.8 - 0.35), k = (j * S + i) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
  }
  x.putImageData(img, 0, 0);
  return canvasTex(c, { srgb: false });
}

// equirect HDR environment of the lit cellar: warm vault overhead, the lamp, the pale window; used for metal and
// glass reflections and a little diffuse fill
function envTexture() {
  const w = 128, h = 64, d = new Uint16Array(w * h * 4), toH = THREE.DataUtils.toHalfFloat;
  const lampDir = new V3(LAMP_AT.x, LAMP_AT.y - 1.1, LAMP_AT.z).normalize(), winDir = new V3(1, 0.32, 0).normalize(), dir = new V3();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const phi = ((i + 0.5) / w - 0.5) * 2 * Math.PI, el = ((j + 0.5) / h - 0.5) * Math.PI;
    dir.set(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
    let r = 0.022, g = 0.017, b = 0.012;
    const up = smooth((dir.y - 0.05) / 0.5); r += up * 0.075; g += up * 0.055; b += up * 0.036;
    const dn = smooth((-dir.y - 0.05) / 0.4); r *= 1 - dn * 0.6; g *= 1 - dn * 0.6; b *= 1 - dn * 0.6;
    const cl = Math.max(0, dir.dot(lampDir)), spot = Math.pow(cl, 900) * 40 + Math.pow(cl, 14) * 0.3;
    r += spot; g += spot * 0.62; b += spot * 0.3;
    const win = smooth((dir.dot(winDir) - 0.988) / 0.005); r += win * 1.2; g += win * 1.4; b += win * 1.75;
    const k = (j * w + i) * 4; d[k] = toH(r); d[k + 1] = toH(g); d[k + 2] = toH(b); d[k + 3] = toH(1);
  }
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

// ══ MATERIALS ══════════════════════════════════════════════════════════════════════════════════════════════
// room surfaces: tiled texture (UVs in metres) + world-space stains at room scale: blotches, water streaks, rising
// damp with its tide line and salt bloom, lamp soot on the vault, darkened corners.
const STAIN_GLSL = /* glsl */`
{ vec3 p = vHqW; vec3 n = normalize(vHqN);
  vec4 g1 = texture2D(uHqGrime, p.xz * 0.23 + vec2(p.y * 0.11, p.y * 0.07));
  vec4 g2 = texture2D(uHqGrime, vec2((p.x + p.z) * 0.29, p.y * 0.05 + 0.3));
  vec4 g3 = texture2D(uHqGrime, p.xz * 0.9 + p.y * 0.4);
  float blot = smoothstep(0.42, 0.78, g1.r) * uHqAmt.y;
  float streak = smoothstep(0.52, 0.86, g2.g) * uHqAmt.y * (1.0 - uHqAmt.w);
  vec3 col = diffuseColor.rgb;
  col *= mix(vec3(1.0), vec3(0.80, 0.75, 0.64), blot * 0.6);
  col *= mix(vec3(1.0), vec3(0.76, 0.72, 0.64), streak * 0.55);
  if (uHqAmt.w < 0.5) {
    float tide = 0.46 + 0.22 * (g2.r - 0.5) + 0.08 * (g1.g - 0.5);
    float damp = (1.0 - smoothstep(tide - 0.10, tide + 0.02, p.y)) * uHqAmt.x;
    float line = exp(-pow((p.y - tide) / 0.025, 2.0)) * uHqAmt.x;
    float salt = exp(-pow((p.y - tide - 0.07) / 0.05, 2.0)) * smoothstep(0.35, 0.7, g3.b) * uHqAmt.x;
    col *= mix(vec3(1.0), vec3(0.58, 0.58, 0.48), damp * 0.8);
    col *= mix(vec3(1.0), vec3(0.60, 0.53, 0.43), line * 0.55);
    col = mix(col, vec3(0.93, 0.92, 0.88) * diffuseColor.rgb / max(diffuseColor.rgb, vec3(0.05)) * 0.9, salt * 0.25);
  } else {
    float dirt = smoothstep(0.3, 0.8, g3.r) * 0.35 + smoothstep(0.45, 0.75, g1.b) * 0.25;
    col *= 1.0 - dirt * 0.45;
  }
  vec3 ds = p - uHqSoot.xyz;
  float soot = exp(-dot(ds.xz, ds.xz) * 2.6) * smoothstep(0.0, 0.5, ds.y) * uHqSoot.w;
  col *= 1.0 - soot * 0.6;
  float dF = p.y, dE = uHqRoom.x - abs(p.x), dS = uHqRoom.y - abs(p.z);
  float ao = 1.0;
  ao *= mix(1.0, 0.34 + 0.66 * smoothstep(0.0, 0.7, dF), 1.0 - abs(n.y));
  ao *= mix(1.0, 0.38 + 0.62 * smoothstep(0.0, 0.7, dE), 1.0 - abs(n.x));
  ao *= mix(1.0, 0.5 + 0.5 * smoothstep(0.0, 0.5, dS), 1.0 - abs(n.z));
  diffuseColor.rgb = col * mix(1.0, ao, uHqAmt.z); }
`;
function roomMaterial(tex, grime, soot, o = {}) {
  const cl = (t) => { const c = t.clone(); c.needsUpdate = true; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(1 / tex.meters, 1 / tex.meters); return c; };
  const m = new THREE.MeshStandardMaterial({ map: cl(tex.map), normalMap: cl(tex.normalMap), roughnessMap: cl(tex.roughnessMap), roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(o.normal ?? 1, o.normal ?? 1), color: o.color ?? 0xffffff, envMapIntensity: o.env ?? 0.3 });
  m.userData.progKey = 'hqroom';
  return patchMaterial(m, (shader) => {
    shader.uniforms.uHqGrime = { value: grime };
    shader.uniforms.uHqSoot = soot;
    shader.uniforms.uHqRoom = { value: new THREE.Vector4(HL, HW, ROOM.spring, ROOM.crown) };
    shader.uniforms.uHqAmt = { value: new THREE.Vector4(o.damp ?? 1, o.stain ?? 1, o.ao ?? 1, o.floor ? 1 : 0) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHqW; varying vec3 vHqN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vHqW = (modelMatrix * vec4(transformed, 1.0)).xyz; vHqN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHqW; varying vec3 vHqN; uniform sampler2D uHqGrime; uniform vec4 uHqSoot; uniform vec4 uHqRoom; uniform vec4 uHqAmt;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + STAIN_GLSL);
  });
}
// a tiled texture set (UVs in metres) on a plain material
function tiled(tex, o = {}) {
  const cl = (t) => { if (!t) return null; const c = t.clone(); c.needsUpdate = true; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(1 / (tex.meters ?? 1) * (o.scale ?? 1), 1 / (tex.meters ?? 1) * (o.scale ?? 1)); return c; };
  return plain({ map: cl(tex.map), normalMap: cl(tex.normalMap), roughnessMap: cl(tex.roughnessMap), roughness: o.roughness ?? 1, metalness: o.metalness ?? 0,
    color: o.color ?? 0xffffff, normalScale: new THREE.Vector2(o.normal ?? 1, o.normal ?? 1), envMapIntensity: o.env ?? 0.4 });
}

// flame: an additive teardrop, white-yellow core, orange skirt, a blue root
function flameMaterial(h) {
  return new THREE.ShaderMaterial({
    uniforms: { uI: { value: 1 }, uH: { value: h } },
    vertexShader: /* glsl */`#include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main() { vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uI; uniform float uH; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        float h = clamp(vP.y / uH + 0.5, 0.0, 1.0);
        float f = abs(dot(normalize(vN), normalize(vV)));
        vec3 core = vec3(1.0, 0.88, 0.62) * 10.0, mid = vec3(1.0, 0.52, 0.14) * 4.5, root = vec3(0.22, 0.34, 1.0) * 1.6;
        vec3 c = mix(mid, core, smoothstep(0.3, 0.92, f) * (1.0 - smoothstep(0.4, 0.95, h)));
        c = mix(root, c, smoothstep(0.03, 0.22, h));
        float a = smoothstep(0.04, 0.5, f) * (1.0 - smoothstep(0.78, 1.0, h));
        gl_FragColor = vec4(c * uI * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
function flameGeometry(r, h) {
  return lathe([[0, -h / 2], [r * 0.55, -h / 2 + h * 0.08], [r * 0.95, -h / 2 + h * 0.3], [r, -h / 2 + h * 0.42], [r * 0.8, -h / 2 + h * 0.62], [r * 0.4, -h / 2 + h * 0.85], [0, h / 2]], 24);
}

// the volumetric window beam: ray-marched through its box, additive, drifting smoke in it
function shaftMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.5, 0.6, 0.78) }, uInv: { value: new THREE.Matrix4() }, uModel: { value: new THREE.Matrix4() }, uDensity: { value: 0.22 } },
    vertexShader: /* glsl */`#include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime; uniform vec3 uColor; uniform mat4 uInv; uniform mat4 uModel; uniform float uDensity; varying vec3 vW;
      float hsh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vn(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hsh(i), hsh(i + vec3(1,0,0)), f.x), mix(hsh(i + vec3(0,1,0)), hsh(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hsh(i + vec3(0,0,1)), hsh(i + vec3(1,0,1)), f.x), mix(hsh(i + vec3(0,1,1)), hsh(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main() {
        #include <logdepthbuf_fragment>
        vec3 ro = (uInv * vec4(cameraPosition, 1.0)).xyz, rp = (uInv * vec4(vW, 1.0)).xyz;
        vec3 rd = rp - ro; float L = length(rd); rd /= L;
        vec3 inv = 1.0 / rd, t0 = (-0.5 - ro) * inv, t1 = (0.5 - ro) * inv, tn3 = min(t0, t1), tf3 = max(t0, t1);
        float tn = max(max(tn3.x, tn3.y), max(tn3.z, 0.0)), tf = min(min(tf3.x, tf3.y), min(tf3.z, L));
        if (tf <= tn) discard;
        float acc = 0.0; const int NS = 20; float dt = (tf - tn) / float(NS);
        for (int i = 0; i < NS; i++) {
          vec3 q = ro + rd * (tn + (float(i) + 0.5) * dt);
          float edge = smoothstep(0.5, 0.18, abs(q.x)) * smoothstep(0.5, 0.12, abs(q.y));
          float along = smoothstep(-0.5, -0.4, q.z) * (1.0 - smoothstep(-0.2, 0.5, q.z));
          vec3 wq = (uModel * vec4(q, 1.0)).xyz;
          float n1 = vn(wq * 2.3 + vec3(0.03, 0.05, 0.02) * uTime), n2 = vn(wq * 6.1 - vec3(0.04, 0.02, 0.05) * uTime);
          float streak = vn(vec3(q.x * 11.0, q.y * 9.0, q.z * 0.7) + vec3(0.0, 0.0, uTime * 0.01));
          float dust = smoothstep(0.965, 0.995, vn(wq * 70.0 + vec3(0.0, -0.02, 0.01) * uTime)) * 2.5;
          acc += edge * along * (0.12 + 1.5 * n1 * n2 + 0.6 * streak * streak + dust);
        }
        float wl = length(mat3(uModel) * (rd * dt));
        vec3 c = uColor * acc * wl * uDensity;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// the typing paper: base sheet map + the ink canvas composited in its rectangle; the ink shows faintly through the
// back of the sheet, grainy like a cloth ribbon
function paperMaterial(baseTex, inkTex, rect) {
  // a raw material, not plain(): plain() already runs patchMaterial, and patchMaterial ignores a second call, so the
  // ink compositing below would silently never be installed (the sheet stayed blank)
  const m = new THREE.MeshStandardMaterial({ map: baseTex, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.25 });
  m.userData.progKey = 'hqpaper';
  m.userData.inkRect = rect;
  return patchMaterial(m, (shader) => {
    shader.uniforms.uInk = { value: inkTex };
    shader.uniforms.uInkRect = { value: rect };
    shader.uniforms.uInkPx = { value: new THREE.Vector2(inkTex.image.width, inkTex.image.height) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uInk; uniform vec4 uInkRect; uniform vec2 uInkPx;\nfloat hqH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec2 iu = (vMapUv - uInkRect.xy) / uInkRect.zw;
          if (iu.x > 0.0 && iu.x < 1.0 && iu.y > 0.0 && iu.y < 1.0) {
            float a = texture2D(uInk, iu).a;
            vec2 g = floor(iu * uInkPx * 0.5);
            a *= 0.80 + 0.2 * hqH(g) + 0.1 * hqH(floor(g * 0.25) + 7.0);
            a *= gl_FrontFacing ? 1.0 : 0.07;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.028, 0.032), clamp(a, 0.0, 1.0) * 0.95);
          } }`);
  });
}

function makeMaterials(T) {
  const M = {};
  M.wall = roomMaterial(T.whitewash, T.grime, T.soot, { env: 0.12 });
  M.vault = roomMaterial(T.whitewash, T.grime, T.soot, { env: 0.12, damp: 0 });
  M.floor = roomMaterial(T.flags, T.grime, T.soot, { env: 0.12, floor: true, normal: 0.9, color: 0xd8d0c4 });
  M.occluder = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  M.wood = tiled(T.planks, { env: 0.35, roughness: 1 });
  M.woodDark = tiled(T.planksDark, { env: 0.35 });
  M.crateWood = tiled(T.planksCrate, { env: 0.3 });
  M.door = tiled(T.planksDoor, { env: 0.3 });
  M.tableTop = plain({ map: T.table.map, normalMap: T.table.normalMap, roughnessMap: T.table.roughnessMap, roughness: 1, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.6 });
  M.tableEdge = tiled(T.planks, { env: 0.4 });
  M.twBody = plain({ color: 0x141414, roughness: 0.36, metalness: 0.2, normalMap: T.crinkle.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 1.0 });
  T.crinkle.normalMap.repeat.set(30, 30);
  M.chrome = plain({ color: 0xd4d4d0, metalness: 1, roughness: 0.17, envMapIntensity: 1.3 });
  M.steel = plain({ color: 0x9a9a96, metalness: 1, roughness: 0.34, envMapIntensity: 1.1 });
  M.barSteel = plain({ color: 0xd2d0ca, metalness: 0.45, roughness: 0.32, envMapIntensity: 1.4 });
  M.darkSteel = plain({ color: 0x3a3a38, metalness: 0.9, roughness: 0.45, envMapIntensity: 0.9 });
  M.iron = plain({ color: 0x2c2724, metalness: 0.6, roughness: 0.7, envMapIntensity: 0.6 });
  M.rubber = plain({ color: 0x121110, roughness: 0.7, envMapIntensity: 0.4 });
  M.platen = plain({ color: 0x0c0c0c, roughness: 0.52, envMapIntensity: 0.6 });
  M.knob = plain({ color: 0x0e0d0c, roughness: 0.3, normalMap: T.knurl, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 1.0 });
  M.keyTop = plain({ map: T.keys.tex, roughness: 0.12, metalness: 0, envMapIntensity: 1.2 });
  M.bakelite = plain({ color: 0x0f0d0c, roughness: 0.3, envMapIntensity: 0.9 });
  M.leather = plain({ map: T.leather.map, normalMap: T.leather.normalMap, roughness: 0.55, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.6 });
  M.od = plain({ map: T.odPaint.map, normalMap: T.odPaint.normalMap, color: 0xffffff, roughness: 0.74, metalness: 0.1, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.6 });
  M.odHelmet = plain({ map: T.odSand.map, normalMap: T.odSand.normalMap, roughness: 0.8, metalness: 0.05, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.6 });
  M.web = plain({ map: T.web.map, normalMap: T.web.normalMap, roughness: 0.95, envMapIntensity: 0.3 });
  M.brass = plain({ color: 0xb28c4c, metalness: 1, roughness: 0.32, envMapIntensity: 1.1 });
  M.lampPaint = plain({ color: 0x28301e, metalness: 0.35, roughness: 0.5, envMapIntensity: 0.9 });
  M.glass = plain({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6, emissive: new THREE.Color(0xffb060), emissiveIntensity: 0.06 });
  M.bottle = plain({ color: 0x1f3a22, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.72, depthWrite: false, envMapIntensity: 1.6 });
  M.wax = plain({ color: 0xece2c6, roughness: 0.55, emissive: new THREE.Color(0xff9a50), emissiveIntensity: 0.0, envMapIntensity: 0.3 });
  M.wick = plain({ color: 0x0a0806, roughness: 0.9 });
  M.enamel = plain({ map: T.enamel, roughness: 0.22, envMapIntensity: 1.0 });
  M.alu = plain({ color: 0xa8a8a2, metalness: 1, roughness: 0.48, envMapIntensity: 1.0 });
  M.coffee = plain({ color: 0x160c06, roughness: 0.06, envMapIntensity: 1.2 });
  M.cig = plain({ color: 0xe8e2d6, roughness: 0.8 });
  M.ash = plain({ color: 0x77726c, roughness: 1 });
  M.ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 0.9, 0.2) });
  M.paperSheet = plain({ map: T.sheet, roughness: 0.9, envMapIntensity: 0.25 });
  M.ultimatum = plain({ map: T.ultimatum, roughness: 0.9, envMapIntensity: 0.25 });
  M.form = plain({ map: T.form, roughness: 0.9, envMapIntensity: 0.25 });
  M.carbon = plain({ color: 0x14121a, roughness: 0.45, envMapIntensity: 0.4 });
  M.calendar = plain({ map: T.calendar, roughness: 0.9, envMapIntensity: 0.25 });
  M.burlap = plain({ map: T.burlap.map, normalMap: T.burlap.normalMap, roughness: 1, envMapIntensity: 0.25, normalScale: new THREE.Vector2(0.6, 0.6) });
  T.burlap.map.repeat.set(9, 5); T.burlap.normalMap.repeat.set(9, 5);
  M.ribbon = plain({ map: T.ribbon, roughness: 0.85 });
  M.felt = plain({ color: 0x1e2a1e, roughness: 1 });
  M.wire = plain({ color: 0x1a1a14, roughness: 0.6 });
  M.pinHead = (hex) => plain({ color: hex, roughness: 0.3, envMapIntensity: 1.0 });
  M.plywood = tiled(T.plywood, { env: 0.3 });
  M.radioPanel = plain({ map: T.radio.map, emissiveMap: T.radio.emissive, emissive: new THREE.Color(1.0, 0.72, 0.36), emissiveIntensity: 1.2, roughness: 0.55, metalness: 0.2, envMapIntensity: 0.8 });
  M.meterGlass = plain({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 1.5 });
  M.label = (tex) => plain({ map: tex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, envMapIntensity: 0.3 });
  M.outside = new THREE.MeshBasicMaterial({ map: T.outside, color: new THREE.Color(2.3, 2.45, 2.75) });
  M.pencilRed = plain({ color: 0x9c231a, roughness: 0.5 });
  M.pencilBlue = plain({ color: 0x223c86, roughness: 0.5 });
  M.pencilYellow = plain({ color: 0xc8a13a, roughness: 0.5 });
  M.lead = plain({ color: 0x2a2826, roughness: 0.5 });
  M.woodTip = plain({ color: 0xd8b48a, roughness: 0.8 });
  M.tin = plain({ color: 0x8e8a80, metalness: 0.9, roughness: 0.42, envMapIntensity: 1.0 });
  return M;
}

// ══ THE ROOM ═══════════════════════════════════════════════════════════════════════════════════════════════
function vaultGeometry(radius = VR, x0 = -HL, x1 = HL, nA = 72) {
  const pos = [], uv = [], nor = [], idx = [];
  const phi = Math.asin(Math.min(1, HW / radius)) + (radius > VR ? 0.06 : 0);
  for (let i = 0; i <= nA; i++) {
    const a = -phi + 2 * phi * i / nA, z = radius * Math.sin(a), y = VYC + radius * Math.cos(a), s = radius * (a + phi);
    for (const x of [x0, x1]) { pos.push(x, y, z); nor.push(0, -Math.cos(a), -Math.sin(a)); uv.push(x + 0.37, ROOM.spring + s); }
  }
  for (let i = 0; i < nA; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
// end wall outline in shape coords (X_s = z for +X, -z for -X), with the vault arc on top
function endWallShape(door) {
  const s = new THREE.Shape();
  s.moveTo(-HW, 0);
  if (door) {           // -X wall: the door sits at world z in [z0, z1] -> shape X in [-z1, -z0]
    s.lineTo(-DOOR.z1, 0); s.lineTo(-DOOR.z1, DOOR.y1);
    s.quadraticCurveTo(-(DOOR.z0 + DOOR.z1) / 2, DOOR.y1 + DOOR.rise * 2, -DOOR.z0, DOOR.y1);
    s.lineTo(-DOOR.z0, 0);
  }
  s.lineTo(HW, 0); s.lineTo(HW, ROOM.spring);
  for (let i = 1; i <= 48; i++) { const a = VPHI - 2 * VPHI * i / 48; s.lineTo(VR * Math.sin(a), VYC + VR * Math.cos(a)); }
  s.lineTo(-HW, 0);
  return s;
}
function placeEndWall(g, sign) {
  const m = sign > 0 ? new THREE.Matrix4().makeBasis(new V3(0, 0, 1), new V3(0, 1, 0), new V3(-1, 0, 0)) : new THREE.Matrix4().makeBasis(new V3(0, 0, -1), new V3(0, 1, 0), new V3(1, 0, 0));
  m.setPosition(sign * HL, 0, 0);
  g.applyMatrix4(m);
  return g;
}
function buildRoom(M, T, root) {
  const g = new THREE.Group(); g.name = 'room'; root.add(g);
  const recv = { cast: false };
  // floor
  const fl = new THREE.PlaneGeometry(ROOM.L + 0.02, ROOM.W + 0.02); fl.rotateX(-Math.PI / 2);
  { const p = fl.attributes.position, uv = fl.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i)); }
  mk(fl, M.floor, g, null, null, recv);
  // side walls (z = -HW faces +z, z = +HW faces -z)
  for (const s of [-1, 1]) {
    const w = new THREE.PlaneGeometry(ROOM.L + 0.02, ROOM.spring + 0.01); w.translate(0, (ROOM.spring + 0.01) / 2, 0);
    if (s > 0) w.rotateY(Math.PI);
    w.translate(0, 0, s * HW);
    const p = w.attributes.position, uv = w.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, s < 0 ? p.getX(i) : -p.getX(i), p.getY(i));
    mk(w, M.wall, g, null, null, recv);
  }
  mk(vaultGeometry(), M.vault, g, null, null, recv);
  // end walls: window end (+X) with its opening, door end (-X)
  const wsh = endWallShape(false), hole = new THREE.Path();
  hole.moveTo(-WIN.iz, WIN.iy0); hole.lineTo(WIN.iz, WIN.iy0); hole.lineTo(WIN.iz, WIN.iy1); hole.lineTo(-WIN.iz, WIN.iy1); hole.lineTo(-WIN.iz, WIN.iy0);
  wsh.holes.push(hole);
  mk(placeEndWall(new THREE.ShapeGeometry(wsh, 16), +1), M.wall, g, null, null, recv);
  mk(placeEndWall(new THREE.ShapeGeometry(endWallShape(true), 16), -1), M.wall, g, null, null, recv);
  // window embrasure: a splayed tunnel through the 0.55 m wall, flat sill
  const X0 = HL, X1 = HL + ROOM.wallT, cen = [HL + ROOM.wallT / 2, (WIN.iy0 + WIN.iy1) / 2, 0];
  const em = [
    quad([X0, WIN.iy0, -WIN.iz], [X0, WIN.iy0, WIN.iz], [X1, WIN.oy0, WIN.oz], [X1, WIN.oy0, -WIN.oz], cen),
    quad([X0, WIN.iy1, -WIN.iz], [X0, WIN.iy1, WIN.iz], [X1, WIN.oy1, WIN.oz], [X1, WIN.oy1, -WIN.oz], cen),
    quad([X0, WIN.iy0, -WIN.iz], [X1, WIN.oy0, -WIN.oz], [X1, WIN.oy1, -WIN.oz], [X0, WIN.iy1, -WIN.iz], cen),
    quad([X0, WIN.iy0, WIN.iz], [X1, WIN.oy0, WIN.oz], [X1, WIN.oy1, WIN.oz], [X0, WIN.iy1, WIN.iz], cen),
  ];
  for (const q of em) { const m = mk(q, M.wall, g, null, null, { cast: true }); m.userData.embrasure = true; }
  // the outside: a bright overcast sky over snow, iron bars across the opening
  const out = new THREE.PlaneGeometry(1.6, 1.3); out.rotateY(-Math.PI / 2); out.translate(X1 + 0.45, 2.02, 0);
  mk(out, M.outside, g, null, null, { cast: false, receive: false });
  for (const z of [-0.15, 0, 0.15]) mk(drum(0.011, 0.011, WIN.oy0 - 0.02, WIN.oy1 + 0.02, 12), M.iron, g, [X1 - 0.06, 0, z]);
  mk(boxM(0.03, 0.02, WIN.oz * 2 + 0.04, 0, 0, 0), M.iron, g, [X1 - 0.06, WIN.oy1 - 0.08, 0]);
  // occluder shell outside the room: blocks the window light's (directional) shadow everywhere but the opening.
  // It is never seen from inside; the visible walls do not cast, so the point lights get no self-shadow acne.
  mk(vaultGeometry(VR + 0.4, -HL - 0.8, X1 + 0.05, 48), M.occluder, g, null, null, { cast: true, receive: false });
  { const s = new THREE.Shape(); s.moveTo(-2.6, -0.2); s.lineTo(2.6, -0.2); s.lineTo(2.6, 3.4); s.lineTo(-2.6, 3.4); s.lineTo(-2.6, -0.2);
    const h = new THREE.Path(); h.moveTo(-WIN.oz, WIN.oy0); h.lineTo(WIN.oz, WIN.oy0); h.lineTo(WIN.oz, WIN.oy1); h.lineTo(-WIN.oz, WIN.oy1); h.lineTo(-WIN.oz, WIN.oy0); s.holes.push(h);
    const sg = new THREE.ShapeGeometry(s); sg.applyMatrix4(new THREE.Matrix4().makeBasis(new V3(0, 0, 1), new V3(0, 1, 0), new V3(-1, 0, 0)).setPosition(X1 + 0.01, 0, 0));
    mk(sg, M.occluder, g, null, null, { cast: true, receive: false }); }
  // door: reveal, stone threshold, a plank door with battens and strap hinges
  { const D0 = -HL, D1 = -HL - DOOR.inset, zc = (DOOR.z0 + DOOR.z1) / 2, toward = [-HL - 0.08, 1.0, zc];
    mk(quad([D0, 0, DOOR.z0], [D1, 0, DOOR.z0], [D1, DOOR.y1, DOOR.z0], [D0, DOOR.y1, DOOR.z0], toward), M.wall, g, null, null, recv);
    mk(quad([D0, 0, DOOR.z1], [D1, 0, DOOR.z1], [D1, DOOR.y1, DOOR.z1], [D0, DOOR.y1, DOOR.z1], toward), M.wall, g, null, null, recv);
    const n = 12; for (let i = 0; i < n; i++) {
      const za = DOOR.z0 + (DOOR.z1 - DOOR.z0) * i / n, zb = DOOR.z0 + (DOOR.z1 - DOOR.z0) * (i + 1) / n;
      const ya = DOOR.y1 + DOOR.rise * (1 - Math.pow((za - zc) / ((DOOR.z1 - DOOR.z0) / 2), 2)), yb = DOOR.y1 + DOOR.rise * (1 - Math.pow((zb - zc) / ((DOOR.z1 - DOOR.z0) / 2), 2));
      mk(quad([D0, ya, za], [D0, yb, zb], [D1, yb, zb], [D1, ya, za], [D0 - 0.08, 0.5, zc]), M.wall, g, null, null, recv);
    }
    mk(boxM(DOOR.inset + 0.02, 0.02, DOOR.z1 - DOOR.z0, 0, 0, 0), M.floor, g, [-HL - DOOR.inset / 2, 0.0, zc], null, recv);
    const ds = new THREE.Shape(); ds.moveTo(DOOR.z0, 0); ds.lineTo(DOOR.z1, 0); ds.lineTo(DOOR.z1, DOOR.y1);
    ds.quadraticCurveTo(zc, DOOR.y1 + DOOR.rise * 2, DOOR.z0, DOOR.y1); ds.lineTo(DOOR.z0, 0);
    const dg = extrudeShapeX(ds, D1 - 0.045, D1, 0.004); boxUV(dg, 1, true);
    mk(dg, M.door, g);
    for (const y of [0.25, 0.95, 1.62]) mk(boxM(0.025, 0.11, DOOR.z1 - DOOR.z0 - 0.08, 0, 0, 0), M.door, g, [D1 + 0.0125 + 0.001, y, zc]);
    for (const y of [0.3, 1.55]) mk(boxM(0.006, 0.045, 0.52, 0, 0, 0), M.iron, g, [D1 + 0.029, y, DOOR.z1 - 0.28]);
    mk(tube([[D1 + 0.03, 1.02, DOOR.z0 + 0.12], [D1 + 0.07, 0.99, DOOR.z0 + 0.12], [D1 + 0.07, 0.93, DOOR.z0 + 0.12], [D1 + 0.03, 0.9, DOOR.z0 + 0.12]], 0.006, 16, 8), M.iron, g); }
  return g;
}

// ── sandbags: a burlap pillow, one per call, deformed by its own seed ────────────────────────────────────────
function sandbagGeometry(L, H, D, seed) {
  const g = new THREE.SphereGeometry(1, 32, 18), p = g.attributes.position, N = makeNoise(seed);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const sx = Math.sign(x) * Math.pow(Math.abs(x), 0.42), sz = Math.sign(z) * Math.pow(Math.abs(z), 0.5), sy = Math.sign(y) * Math.pow(Math.abs(y), 0.75);
    const end = Math.pow(Math.abs(sx), 6), n = N.noise2(x * 2.1 + seed, z * 2.3 + y * 1.7) * 0.07;
    const yy = sy < 0 ? sy * 0.72 : sy;
    p.setXYZ(i, sx * L / 2, yy * (1 - end * 0.45) * H / 2 * (1 + n), sz * (1 - end * 0.3) * D / 2 * (1 + n * 0.6));
  }
  g.computeVertexNormals();
  return g;
}

// ══ FURNITURE ═════════════════════════════════════════════════════════════════════════════════════════════
function buildTable(M, root) {
  const g = new THREE.Group(); g.name = 'table'; g.position.set(TABLE.x, 0, TABLE.z); root.add(g);
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w, TABLE.t, TABLE.d), [M.tableEdge, M.tableEdge, M.tableTop, M.tableEdge, M.tableEdge, M.tableEdge]);
  top.position.y = TABLE.top - TABLE.t / 2; top.castShadow = top.receiveShadow = true; g.add(top);
  const legH = TABLE.top - TABLE.t, lx = TABLE.w / 2 - 0.11, lz = TABLE.d / 2 - 0.1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mk(boxM(0.095, legH, 0.095, 0, legH / 2, 0), M.wood, g, [sx * lx, 0, sz * lz]);
  for (const sz of [-1, 1]) mk(boxM(2 * lx - 0.09, 0.13, 0.032, 0, 0, 0), M.wood, g, [0, legH - 0.065, sz * (lz - 0.01)]);
  for (const sx of [-1, 1]) mk(boxM(0.032, 0.13, 2 * lz - 0.09, 0, 0, 0), M.wood, g, [sx * (lx - 0.01), legH - 0.065, 0]);
  for (const sx of [-1, 1]) mk(boxM(0.05, 0.06, 2 * lz, 0, 0, 0), M.wood, g, [sx * lx, 0.15, 0]);
  mk(boxM(2 * lx, 0.055, 0.05, 0, 0, 0), M.wood, g, [0, 0.16, 0]);
  return g;
}
function buildDesk(M, root) {
  const g = new THREE.Group(); g.name = 'desk'; g.position.set(DESK.x, 0, DESK.z); root.add(g);
  mk(boxM(DESK.w, DESK.t, DESK.d, 0, DESK.top - DESK.t / 2, 0), M.woodDark, g);
  const legH = DESK.top - DESK.t, lx = DESK.w / 2 - 0.04, lz = DESK.d / 2 - 0.04;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mk(boxM(0.045, legH, 0.045, 0, legH / 2, 0), M.woodDark, g, [sx * lx, 0, sz * lz]);
  mk(boxM(2 * lx, 0.11, 0.022, 0, legH - 0.055, 0), M.woodDark, g, [0, 0, lz]);
  mk(boxM(2 * lx, 0.11, 0.022, 0, legH - 0.055, 0), M.woodDark, g, [0, 0, -lz]);
  for (const sx of [-1, 1]) mk(boxM(0.022, 0.11, 2 * lz, 0, legH - 0.055, 0), M.woodDark, g, [sx * lx, 0, 0]);
  mk(boxM(0.44, 0.085, 0.008, 0, legH - 0.055, 0), M.wood, g, [0.12, 0, lz + 0.014]);
  mk(drum(0.008, 0.008, 0, 0.018, 12).rotateX(Math.PI / 2), M.brass, g, [0.12, legH - 0.055, lz + 0.018]);
  return g;
}
function buildChair(M, parent, x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
  mk(boxM(0.42, 0.028, 0.40, 0, 0.451, 0), M.wood, g);
  for (const sx of [-1, 1]) {
    mk(boxM(0.036, 0.437, 0.036, 0, 0.2185, 0), M.wood, g, [sx * 0.18, 0, 0.165]);
    const back = mk(boxM(0.036, 0.9, 0.036, 0, 0.45, 0), M.wood, g, [sx * 0.18, 0, -0.17]); back.rotation.x = -0.06;
    mk(boxM(0.022, 0.022, 0.30, 0, 0, 0), M.wood, g, [sx * 0.18, 0.14, 0]);
  }
  for (const y of [0.64, 0.8]) { const s = mk(boxM(0.36, 0.06, 0.018, 0, 0, 0), M.wood, g, [0, y, -0.17 - Math.sin(0.06) * (y - 0.45) - 0.002]); s.rotation.x = -0.06; }
  mk(boxM(0.36, 0.022, 0.022, 0, 0, 0), M.wood, g, [0, 0.17, 0.165]);
  return g;
}
function buildCrate(M, T, parent, x, y, z, ry, w, h, d, label) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
  mk(boxM(w, h, d, 0, h / 2, 0), M.crateWood, g);
  for (const yy of [0.02, h - 0.02]) mk(boxM(w + 0.012, 0.03, d + 0.012, 0, yy, 0), M.crateWood, g);
  for (const sx of [-1, 1]) mk(tube([[sx * (w / 2 + 0.002), h * 0.62, -0.05], [sx * (w / 2 + 0.03), h * 0.55, -0.03], [sx * (w / 2 + 0.03), h * 0.55, 0.03], [sx * (w / 2 + 0.002), h * 0.62, 0.05]], 0.007, 16, 6), M.web, g);
  if (label) { const p = new THREE.PlaneGeometry(w * 0.86, h * 0.62); const m = mk(p, M.label(label), g, [0, h * 0.5, d / 2 + 0.0015], null, { cast: false }); m.renderOrder = 1; }
  return g;
}

// ══ PROPS ═════════════════════════════════════════════════════════════════════════════════════════════════
// hurricane lamp (Dietz-style kerosene lantern) — origin at the flame
function buildLamp(M, flameMat) {
  const g = new THREE.Group(); g.name = 'lamp';
  const nc = { cast: false };
  mk(lathe([[0, -0.108], [0.060, -0.108], [0.072, -0.1], [0.076, -0.088], [0.072, -0.074], [0.055, -0.064], [0.030, -0.06], [0, -0.06]], 48), M.lampPaint, g, null, null, nc);
  mk(drum(0.021, 0.019, -0.062, -0.034, 24), M.brass, g, null, null, nc);
  mk(drum(0.017, 0.007, -0.034, -0.02, 24), M.brass, g, null, null, nc);
  mk(cylX(0.004, 0.03, 12), M.brass, g, [0.032, -0.05, 0], null, nc);
  mk(cylX(0.008, 0.004, 16), M.brass, g, [0.049, -0.05, 0], null, nc);
  mk(new THREE.TorusGeometry(0.036, 0.0045, 8, 40).rotateX(Math.PI / 2), M.lampPaint, g, [0, -0.047, 0], null, nc);
  mk(lathe([[0.031, -0.046], [0.046, -0.034], [0.056, -0.012], [0.058, 0.01], [0.052, 0.036], [0.039, 0.056], [0.028, 0.068]], 48), M.glass, g, null, null, nc);
  for (const s of [-1, 1]) {
    mk(drum(0.0068, 0.0068, -0.082, 0.098, 16), M.lampPaint, g, [s * 0.079, 0, 0]);
    mk(new THREE.SphereGeometry(0.0085, 12, 8), M.lampPaint, g, [s * 0.079, 0.099, 0]);
  }
  mk(cylX(0.0085, 0.158, 16), M.lampPaint, g, [0, 0.104, 0], null, nc);
  mk(lathe([[0.043, 0.066], [0.048, 0.074], [0.046, 0.086], [0.034, 0.098], [0.02, 0.112], [0.008, 0.116], [0, 0.116]], 40), M.lampPaint, g, null, null, nc);
  // globe guard wires
  for (let k = 0; k < 4; k++) {
    const a = (k + 0.5) / 4 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    mk(tube([[c * 0.038, -0.05, s * 0.038], [c * 0.062, -0.02, s * 0.062], [c * 0.066, 0.012, s * 0.066], [c * 0.058, 0.045, s * 0.058], [c * 0.044, 0.07, s * 0.044]], 0.0014, 20, 5), M.lampPaint, g);
  }
  mk(new THREE.TorusGeometry(0.0655, 0.0015, 6, 48).rotateX(Math.PI / 2), M.lampPaint, g, [0, 0.012, 0]);
  // bail handle
  mk(tube([[-0.079, 0.1, 0], [-0.06, 0.16, 0], [0, 0.198, 0], [0.06, 0.16, 0], [0.079, 0.1, 0]], 0.0021, 32, 6), M.steel, g, null, null, nc);
  const flame = mk(flameGeometry(0.0072, 0.034), flameMat, g, [0, -0.001, 0], null, { cast: false, receive: false });
  return { group: g, flame, hang: new V3(0, 0.198, 0) };
}
// a candle stuck in a wine bottle — origin at the bottle base; returns the flame's local position
function buildCandleBottle(M, flameMat, seed) {
  const g = new THREE.Group(), nc = { cast: false }, R = rng(seed);
  mk(lathe([[0, 0.006], [0.028, 0.0], [0.035, 0.003], [0.0365, 0.02], [0.0365, 0.185], [0.033, 0.21], [0.02, 0.236], [0.0145, 0.252], [0.014, 0.284], [0.0165, 0.287], [0.0165, 0.296], [0.0125, 0.297]], 40), M.bottle, g, null, null, nc);
  const top = 0.296 + 0.05 + R() * 0.02;
  mk(drum(0.0112, 0.0108, 0.27, top, 24), M.wax, g, null, null, nc);
  mk(new THREE.TorusGeometry(0.0145, 0.0045, 8, 24).rotateX(Math.PI / 2), M.wax, g, [0, 0.298, 0], null, nc);
  for (let k = 0; k < 7; k++) {
    const a = R() * 6.28, len = 0.012 + R() * 0.05, y0 = 0.29 - R() * 0.02;
    const rr = y0 > 0.25 ? 0.0175 : 0.03, drip = new THREE.SphereGeometry(1, 10, 8); drip.scale(0.0032, len / 2, 0.0032);
    const m = mk(drip, M.wax, g, [Math.cos(a) * rr, y0 - len / 2, Math.sin(a) * rr], null, nc);
    if (y0 - len < 0.25) { m.position.set(Math.cos(a) * 0.017, y0 - len / 2, Math.sin(a) * 0.017); m.scale.y = 0.7; }
  }
  mk(drum(0.0009, 0.0007, top - 0.001, top + 0.008, 6), M.wick, g, null, null, nc);
  const fy = top + 0.019;
  const flame = mk(flameGeometry(0.0055, 0.026), flameMat, g, [0, fy, 0], null, { cast: false, receive: false });
  return { group: g, flame, flameY: fy, waxTop: top };
}
// EE-8 field telephone in its leather case, flap folded back, crank on the right
function buildEE8(M) {
  const g = new THREE.Group(), W = 0.245, H = 0.235, D = 0.098;
  mk(boxUV(rbox(W, H, D, 0.012, 4), 30), M.leather, g, [0, H / 2, 0]);
  const lid = mk(boxUV(rbox(W - 0.004, 0.006, 0.108, 0.0025), 30), M.leather, g, [0, H - 0.058, -D / 2 - 0.006]); lid.rotation.x = Math.PI / 2 - 0.1;
  mk(rbox(W - 0.022, 0.0012, D - 0.022, 0.0005, 1), M.bakelite, g, [0, H + 0.0004, 0]);
  for (const x of [-0.07, -0.045]) { mk(drum(0.0045, 0.0045, H, H + 0.012, 12), M.brass, g, [x, 0, 0.012]); mk(drum(0.0065, 0.0065, H + 0.008, H + 0.011, 12), M.brass, g, [x, 0, 0.012]); }
  mk(cylX(0.009, 0.01), M.darkSteel, g, [W / 2 + 0.005, 0.12, 0.01]);
  mk(boxM(0.004, 0.05, 0.007, 0, 0, 0), M.darkSteel, g, [W / 2 + 0.012, 0.098, 0.01]);
  mk(cylX(0.006, 0.024), M.bakelite, g, [W / 2 + 0.024, 0.076, 0.01]);
  for (const s of [-1, 1]) mk(new THREE.TorusGeometry(0.011, 0.0022, 6, 16), M.steel, g, [s * (W / 2 - 0.02), H + 0.008, 0]);
  return g;
}
// TS-9 handset lying on the table, cups down
function buildHandset(M) {
  const g = new THREE.Group();
  mk(drum(0.0275, 0.026, 0, 0.022, 32), M.bakelite, g, [-0.09, 0, 0]);
  mk(drum(0.0255, 0.021, 0, 0.03, 32), M.bakelite, g, [0.09, 0, 0]);
  mk(tube([[-0.092, 0.024, 0], [-0.06, 0.036, 0], [0, 0.041, 0], [0.06, 0.037, 0], [0.09, 0.028, 0]], 0.0115, 32, 12), M.bakelite, g);
  mk(boxM(0.03, 0.006, 0.012, 0, 0, 0), M.darkSteel, g, [0.0, 0.028, 0.0]);
  return g;
}
// field radio on crates: olive-drab case, crinkle panel with a lit dial, knobs, a carrying handle
function buildRadio(M) {
  const g = new THREE.Group(), W = 0.42, H = 0.27, D = 0.24;
  mk(boxUV(rbox(W, H, D, 0.008), 4), M.od, g, [0, H / 2, 0]);
  mk(new THREE.PlaneGeometry(W - 0.03, H - 0.03), M.radioPanel, g, [0, H / 2, D / 2 + 0.0006], null, { cast: false });
  const px = (u) => -W / 2 + 0.015 + u / 1024 * (W - 0.03), py = (v) => H - 0.015 - v / 640 * (H - 0.03);
  for (const [u, v, r] of [[150, 330, 0.016], [515, 330, 0.02], [860, 330, 0.016], [150, 540, 0.012], [515, 540, 0.012], [860, 540, 0.012]]) {
    mk(cylZ(r, 0.016, 32), M.bakelite, g, [px(u), py(v), D / 2 + 0.008]);
    mk(boxM(0.0016, r * 0.8, 0.0012, 0, r * 0.4, 0), M.chrome, g, [px(u), py(v), D / 2 + 0.0165], null, { cast: false });
  }
  mk(new THREE.CircleGeometry(0.0175, 32), M.meterGlass, g, [px(150), py(170) + 0.006, D / 2 + 0.0035], null, { cast: false });
  mk(tube([[-0.13, H, 0], [-0.12, H + 0.035, 0], [0.12, H + 0.035, 0], [0.13, H, 0]], 0.006, 24, 8), M.darkSteel, g);
  for (const s of [-1, 1]) mk(boxM(0.012, 0.03, 0.05, 0, 0, 0), M.darkSteel, g, [s * (W / 2 + 0.004), H * 0.6, 0]);
  return g;
}
function buildHeadphones(M) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) { mk(drum(0.034, 0.03, 0, 0.022, 28), M.bakelite, g, [s * 0.07, 0, 0]); mk(drum(0.028, 0.028, 0.022, 0.026, 28), M.rubber, g, [s * 0.07, 0, 0]); }
  mk(tube([[-0.07, 0.024, 0], [-0.075, 0.03, 0.06], [-0.04, 0.034, 0.105], [0, 0.036, 0.115], [0.04, 0.034, 0.105], [0.075, 0.03, 0.06], [0.07, 0.024, 0]], 0.004, 40, 6), M.darkSteel, g);
  return g;
}
// M1 helmet: oval steel pot, crimped rim, chinstrap buckled round the back of the brim
function buildHelmet(M) {
  const g = new THREE.Group();
  const shell = lathe([[0.1395, 0.0], [0.138, 0.005], [0.1355, 0.018], [0.134, 0.04], [0.131, 0.07], [0.124, 0.1], [0.11, 0.126], [0.09, 0.146], [0.06, 0.16], [0.03, 0.1665], [0, 0.168]], 64);
  shell.scale(1, 1, 1.13);
  mk(shell, M.odHelmet, g);
  const rim = new THREE.TorusGeometry(0.1398, 0.0032, 8, 96); rim.rotateX(Math.PI / 2); rim.scale(1, 1, 1.13);
  mk(rim, M.darkSteel, g, [0, 0.0032, 0]);
  const strap = [];
  for (let k = 0; k <= 24; k++) { const a = Math.PI * 0.62 + Math.PI * 0.76 * k / 24; strap.push([Math.cos(a) * 0.1392, 0.021, Math.sin(a) * 0.1392 * 1.13]); }
  const sg = tube(strap, 0.0055, 48, 4); sg.scale(1.012, 1.35, 1.012);
  mk(sg, M.web, g);
  mk(boxM(0.012, 0.016, 0.004, 0, 0, 0), M.steel, g, [0, 0.021, -0.1392 * 1.13 - 0.004]);
  return g;
}
// M1936 pistol belt lying in a loop, with the holster and a magazine pouch
function buildBelt(M, seed) {
  const g = new THREE.Group(), N = makeNoise(seed), pts = [];
  for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2, r = 1 + 0.08 * N.noise2(Math.cos(a) * 1.4, Math.sin(a) * 1.4); pts.push(new V3(Math.cos(a) * 0.2 * r, 0, Math.sin(a) * 0.13 * r)); }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal'), n = 120, w = 0.056, t = 0.003, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const p = curve.getPointAt(i / n), tg = curve.getTangentAt(i / n), side = new V3(-tg.z, 0, tg.x).normalize();
    for (const [sx, sy] of [[-1, 0], [1, 0], [1, t], [-1, t]]) pos.push(p.x + side.x * sx * w / 2, sy + 0.0002, p.z + side.z * sx * w / 2);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = ((i + 1) % n) * 4;
    idx.push(a + 3, a + 2, b + 3, a + 2, b + 2, b + 3);   // top (normal up)
    idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2, a, a + 3, b, a + 3, b + 3, b);
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setIndex(idx);
  const flat = bg.toNonIndexed(); flat.computeVertexNormals(); boxUV(flat, 22);
  mk(flat, M.web, g);
  for (let k = 0; k < 16; k++) { const p = curve.getPointAt(k / 16); mk(drum(0.003, 0.003, t, t + 0.0012, 8), M.darkSteel, g, [p.x, 0, p.z], null, { cast: false }); }
  // holster (M1916, brown leather) lying beside the loop
  const hs = new THREE.Shape(); hs.moveTo(0, 0); hs.lineTo(0.2, 0.012); hs.lineTo(0.215, 0.05); hs.lineTo(0.2, 0.1); hs.lineTo(0.12, 0.118); hs.lineTo(0.06, 0.11); hs.lineTo(0.0, 0.07); hs.lineTo(0, 0);
  const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 3 });
  hg.rotateX(-Math.PI / 2); hg.translate(-0.2, 0.005, 0.27); hg.computeVertexNormals(); boxUV(hg, 30);
  mk(hg, M.leather, g);
  mk(drum(0.005, 0.005, 0.026, 0.029, 12), M.brass, g, [-0.03, 0, 0.21]);
  // magazine pouch on the belt
  mk(boxUV(rbox(0.1, 0.028, 0.07, 0.008), 22), M.web, g, [0.0, t + 0.014, 0.13]);
  return g;
}
// enamel mug and a canteen cup, each with coffee
function buildMug(M) {
  const g = new THREE.Group();
  mk(lathe([[0, 0], [0.04, 0], [0.041, 0.004], [0.041, 0.084], [0.043, 0.0875], [0.0405, 0.089], [0.0392, 0.085], [0.0392, 0.007], [0, 0.007]], 48), M.enamel, g);
  mk(new THREE.TorusGeometry(0.024, 0.0042, 8, 20, Math.PI), M.enamel, g, [0.041, 0.045, 0], [0, 0, -Math.PI / 2]);
  mk(new THREE.CircleGeometry(0.0391, 40).rotateX(-Math.PI / 2), M.coffee, g, [0, 0.062, 0], null, { cast: false });
  return g;
}
function buildCup(M) {
  const g = new THREE.Group();
  const body = lathe([[0, 0], [0.05, 0], [0.052, 0.005], [0.054, 0.09], [0.0555, 0.093], [0.0535, 0.094], [0.0525, 0.09], [0.0505, 0.006], [0, 0.006]], 48); body.scale(1, 1, 0.78);
  mk(body, M.alu, g);
  mk(boxM(0.12, 0.003, 0.018, 0.06, 0, 0), M.alu, g, [0.05, 0.088, 0]);
  mk(boxM(0.004, 0.02, 0.018, 0, 0, 0), M.alu, g, [0.052, 0.078, 0]);
  const cf = new THREE.CircleGeometry(0.051, 40).rotateX(-Math.PI / 2); cf.scale(1, 1, 0.78);
  mk(cf, M.coffee, g, [0, 0.055, 0], null, { cast: false });
  return g;
}
// C-ration tin lid as an ashtray, butts, and a burning cigarette on the rim
function buildAshtray(M) {
  const g = new THREE.Group();
  mk(lathe([[0, 0], [0.042, 0], [0.044, 0.004], [0.045, 0.014], [0.043, 0.0145], [0.041, 0.005], [0, 0.005]], 40), M.tin, g);
  for (const [x, z, a] of [[-0.012, 0.01, 0.4], [0.01, -0.014, 2.0], [0.018, 0.012, 1.1]]) {
    mk(cylX(0.004, 0.024, 10), M.cig, g, [x, 0.0095, z], [0, a, 0]);
    mk(cylX(0.0041, 0.004, 10), M.ash, g, [x + Math.cos(a) * 0.012, 0.0095, z - Math.sin(a) * 0.012], [0, a, 0]);
  }
  const cig = new THREE.Group(); cig.position.set(0.032, 0.016, 0.0); cig.rotation.set(0, -0.35, -0.08); g.add(cig);
  mk(cylX(0.0042, 0.07, 12), M.cig, cig, [0.028, 0, 0]);
  mk(cylX(0.0043, 0.012, 12), M.ash, cig, [0.069, 0, 0]);
  const ember = mk(cylX(0.0036, 0.002, 12), M.ember, cig, [0.0762, 0, 0], null, { cast: false });
  return { group: g, cig, emberLocal: new V3(0.078, 0, 0) };
}
function buildPencil(M, mat, len = 0.17) {
  const g = new THREE.Group();
  mk(new THREE.CylinderGeometry(0.0036, 0.0036, len, 6).rotateZ(Math.PI / 2), mat, g, [0, 0.0036, 0]);
  mk(new THREE.ConeGeometry(0.0036, 0.018, 6).rotateZ(-Math.PI / 2), M.woodTip, g, [len / 2 + 0.009, 0.0036, 0]);
  mk(new THREE.ConeGeometry(0.0012, 0.005, 6).rotateZ(-Math.PI / 2), M.lead, g, [len / 2 + 0.0165, 0.0036, 0]);
  return g;
}
// a flat sheet lying on a surface (u,v in metres), optionally a tiny lift at one corner
function sheet(w, h, mat, lift = 0) {
  const g = new THREE.PlaneGeometry(w, h, 6, 6); g.rotateX(-Math.PI / 2);
  if (lift) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = Math.max(0, (p.getX(i) / w + 0.5) - 0.7) / 0.3 * Math.max(0, (p.getZ(i) / h + 0.5) - 0.6) / 0.4; p.setY(i, lift * k * k); } g.computeVertexNormals(); }
  return g;
}

// ══ THE TYPEWRITER ════════════════════════════════════════════════════════════════════════════════════════
// Local frame: origin under the middle of the machine on the desk, X to the typist's right, Z toward the typist.
const KEY_ROWS = [
  { z: 0.0655, y: 0.079, x0: -0.0925, keys: [['1', '!'], ['2', '"'], ['3', '#'], ['4', '$'], ['5', '%'], ['6', '_'], ['7', '&'], ['8', "'"], ['9', '('], ['0', ')'], ['-', '*']] },
  { z: 0.084, y: 0.070, x0: -0.088, keys: [...'QWERTYUIOP'].map((c) => [c]).concat([['½', '¼']]), pre: ['TAB'] },
  { z: 0.1025, y: 0.061, x0: -0.0835, keys: [...'ASDFGHJKL'].map((c) => [c]).concat([[';', ':'], ['¢', '@']]), pre: ['LOCK'] },
  { z: 0.121, y: 0.052, x0: -0.079, keys: [...'ZXCVBNM'].map((c) => [c]).concat([[',', ','], ['.', '.'], ['/', '?']]), pre: ['SHIFT'], post: ['SHIFT'] },
];
const KEY_PITCH = 0.0185;
const deckY = (z) => 0.031 + clamp((0.144 - z) / (0.144 - 0.050)) * (0.058 - 0.031);

function layoutText(text) {
  const pos = [{ line: 0, col: 0 }], glyphs = [];
  let line = 0, col = 0, maxCol = 0;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (ch === '\n') { line++; col = 0; } else { if (ch !== ' ') glyphs.push({ k, ch, line, col }); col++; maxCol = Math.max(maxCol, col); }
    pos.push({ line, col });
  }
  return { text, pos, glyphs, lines: line + 1, maxCol };
}

function buildTypewriter(M, T) {
  const g = new THREE.Group(); g.name = 'typewriter';
  const P = new V3(0, TW.platenY + TW.paperR * Math.sin(TW.printA), TW.platenZ + TW.paperR * Math.cos(TW.printA));
  const nP = new V3(0, Math.sin(TW.printA), Math.cos(TW.printA));
  const hS = Math.sqrt(TW.barL * TW.barL - TW.segR * TW.segR);
  const C = new V3(0, P.y - hS, P.z);
  const Yv = new V3(0, 1, 0);
  // ── body
  for (const [fx, fz] of [[-0.128, -0.128], [0.128, -0.128], [-0.128, 0.136], [0.128, 0.136]]) mk(drum(0.0095, 0.0095, 0, 0.0062, 16), M.rubber, g, [fx, 0, fz]);
  mk(boxUV(rbox(0.292, 0.008, 0.298, 0.003, 2)), M.twBody, g, [0, 0.0102, 0.004]);
  mk(extrudeX([[0.152, 0.010], [0.152, 0.025], [0.144, 0.031], [0.050, 0.058], [0.041, 0.0605], [-0.143, 0.0605], [-0.143, 0.010]], -0.145, 0.145, 0.003), M.twBody, g);
  for (const sx of [-1, 1]) mk(boxUV(rbox(0.034, 0.042, 0.202, 0.006)), M.twBody, g, [sx * 0.128, 0.073, -0.042]);
  mk(boxUV(rbox(0.226, 0.038, 0.064, 0.005)), M.twBody, g, [0, 0.075, -0.111]);
  mk(boxM(0.28, 0.003, 0.008, 0, 0, 0), M.chrome, g, [0, 0.0955, -0.129]);
  mk(boxM(0.27, 0.0035, 0.002, 0, 0, 0), M.chrome, g, [0, 0.019, 0.1532]);
  for (const sx of [-1, 1]) {
    mk(drum(0.022, 0.022, 0.094, 0.1, 40), M.chrome, g, [sx * 0.123, 0, -0.040]);
    mk(drum(0.017, 0.017, 0.1, 0.1035, 32), M.ribbonDark ?? M.rubber, g, [sx * 0.123, 0, -0.040]);
    mk(drum(0.0035, 0.0035, 0.1, 0.106, 12), M.chrome, g, [sx * 0.123, 0, -0.040]);
  }
  // ── basket: the segment, the felt rest, 43 type bars
  { const seg = [], rest = [];
    for (let k = 0; k <= 32; k++) { const a = -70 * DEG + 140 * DEG * k / 32; seg.push([Math.sin(a), Math.cos(a)]); }
    const band = (r0, r1, y0, y1, pts) => { const s = new THREE.Shape(); pts.forEach(([sn, cs], i) => (i ? s.lineTo(sn * r1, cs * r1) : s.moveTo(sn * r1, cs * r1))); for (let i = pts.length - 1; i >= 0; i--) s.lineTo(pts[i][0] * r0, pts[i][1] * r0);
      const eg = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: 4 }); eg.rotateX(Math.PI / 2); eg.translate(C.x, y1, C.z); return eg; };
    mk(band(TW.segR - 0.004, TW.segR + 0.004, 0.0605, C.y + 0.003, seg), M.darkSteel, g);
    for (let k = 0; k <= 32; k++) { const a = -68 * DEG + 136 * DEG * k / 32; rest.push([Math.sin(a), Math.cos(a)]); }
    mk(band(TW.segR + TW.barL - 0.009, TW.segR + TW.barL + 0.003, 0.0605, 0.0618, rest), M.felt, g); }
  // ── keys
  const keys = [];
  KEY_ROWS.forEach((row, ri) => {
    const all = [...(row.pre ?? []).map((t) => ({ legend: [t], special: t, dx: -1 })), ...row.keys.map((k, i) => ({ legend: k, dx: i })), ...(row.post ?? []).map((t) => ({ legend: [t], special: t, dx: row.keys.length }))];
    for (const k of all) keys.push({ ...k, row: ri, x: row.x0 + k.dx * KEY_PITCH, y: row.y, z: row.z });
  });
  T.keys = keyAtlas(keys);
  M.keyTop.map = T.keys.tex; M.keyTop.needsUpdate = true;
  const charKey = new Map();
  keys.forEach((k, i) => {
    const grp = new THREE.Group(); grp.position.set(k.x, k.y, k.z); g.add(grp);
    const cap = new THREE.Group(); cap.rotation.x = 0.2; grp.add(cap);
    const disc = new THREE.CircleGeometry(0.0054, 32); disc.rotateX(-Math.PI / 2);
    const cu = T.keys.uv(i), uv = disc.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setXY(j, cu.u0 + uv.getX(j) * cu.s, cu.v0 + uv.getY(j) * cu.s);
    mk(disc, M.keyTop, cap, [0, 0.0006, 0]);
    mk(drum(0.006, 0.006, -0.0018, 0.0006, 32, { open: true }), M.chrome, cap);
    mk(new THREE.TorusGeometry(0.0057, 0.00075, 6, 32).rotateX(Math.PI / 2), M.chrome, cap, [0, 0.0006, 0]);
    mk(new THREE.CircleGeometry(0.006, 24).rotateX(Math.PI / 2), M.darkSteel, cap, [0, -0.0018, 0]);
    const stemLen = k.y - 0.002 - deckY(k.z) + 0.006;
    mk(boxM(0.0016, stemLen, 0.0012, 0, -0.002 - stemLen / 2, 0), M.darkSteel, grp);
    k.grp = grp; k.y0 = k.y; k.index = i;
    if (!k.special) { const [lo, up] = k.legend; charKey.set(lo.toLowerCase(), { key: k, shift: false }); if (lo.length === 1 && /[A-Z]/.test(lo)) charKey.set(lo, { key: k, shift: true }); if (up) charKey.set(up, { key: k, shift: up !== lo }); }
  });
  const shiftKey = keys.find((k) => k.special === 'SHIFT');
  // space bar
  const space = new THREE.Group(); space.position.set(0, 0.041, 0.142); g.add(space);
  mk(rbox(0.15, 0.0062, 0.010, 0.0025), M.chrome, space);
  for (const sx of [-1, 1]) mk(boxM(0.004, 0.004, 0.018, 0, -0.004, -0.01), M.darkSteel, space, [sx * 0.055, 0, 0]);
  // type bars: one per character key, fanned by key position
  const charKeys = keys.filter((k) => !k.special).sort((a, b) => a.x - b.x + (a.row - b.row) * 0.0005);
  const bars = [];
  const nB = charKeys.length;
  charKeys.forEach((k, b) => {
    const phi = -TW.fan + 2 * TW.fan * b / (nB - 1);
    const rH = new V3(Math.sin(phi), 0, Math.cos(phi)), t = new V3(Math.cos(phi), 0, -Math.sin(phi));
    const pivot = C.clone().addScaledVector(rH, TW.segR);
    const aRest = -TW.droop, aHit = Math.atan2(hS, -TW.segR);
    const basis = (a) => new THREE.Matrix4().makeBasis(rH.clone().multiplyScalar(Math.cos(a)).addScaledVector(Yv, Math.sin(a)), rH.clone().multiplyScalar(-Math.sin(a)).addScaledVector(Yv, Math.cos(a)), t.clone().negate());
    const grp = new THREE.Group(); grp.position.copy(pivot); grp.quaternion.setFromRotationMatrix(basis(aRest)); g.add(grp);
    mk(boxM(TW.barL - 0.0035, 0.0026, 0.0011, (TW.barL - 0.0035) / 2, 0, 0), M.barSteel, grp);
    mk(cylZ(0.0017, 0.0014, 12), M.barSteel, grp);
    const qHit = new THREE.Quaternion().setFromRotationMatrix(basis(aHit)), qInv = qHit.clone().invert();
    const sx = nP.clone().negate(), sy = new V3(0, Math.cos(TW.printA), -Math.sin(TW.printA)), sz = sx.clone().cross(sy);
    const qSlugW = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(sx, sy, sz));
    const slug = mk(boxM(0.003, 0.0042, 0.0024, 0, 0, 0), M.darkSteel, grp);
    slug.quaternion.copy(qInv.clone().multiply(qSlugW));
    slug.position.copy(P.clone().addScaledVector(nP, 0.0012 + 0.0015).sub(pivot).applyQuaternion(qInv));
    k.bar = { grp, basis, aRest, aHit };
    bars.push(k.bar);
  });
  // ribbon: a strip across the front of the platen between the spools, lifted by the vibrator on each strike
  const zR = TW.platenZ + TW.paperR + 0.0005, RN = 48;
  const ribbonGeo = new THREE.BufferGeometry();
  { const uvs = []; for (let i = 0; i <= RN; i++) uvs.push(i / RN * 12, 1, i / RN * 12, 0);
    const idx = []; for (let i = 0; i < RN; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    ribbonGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((RN + 1) * 6), 3));
    ribbonGeo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array((RN + 1) * 6), 3));
    ribbonGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); ribbonGeo.setIndex(idx); }
  const ribbonMat = M.ribbon.clone(); ribbonMat.side = THREE.DoubleSide;
  const ribbon = mk(ribbonGeo, ribbonMat, g, null, null, { cast: true }); ribbon.frustumCulled = false;
  function setRibbon(lift) {
    const p = ribbonGeo.attributes.position, n = ribbonGeo.attributes.normal;
    for (let i = 0; i <= RN; i++) {
      const x = -0.123 + 0.246 * i / RN, ax = Math.abs(x), m = 1 - smooth((ax - 0.012) / 0.03), tr = smooth((ax - 0.085) / 0.038);
      let yb = P.y - 0.0155 + lift * m * 0.0073, yt = P.y - 0.0028 + lift * m * 0.0073;
      yb = lerp(yb, 0.1003, tr); yt = lerp(yt, 0.1032, tr);
      const z = lerp(zR, -0.0624, tr);
      p.setXYZ(i * 2, x, yt, z); p.setXYZ(i * 2 + 1, x, yb, z); n.setXYZ(i * 2, 0, 0, 1); n.setXYZ(i * 2 + 1, 0, 0, 1);
    }
    p.needsUpdate = true; n.needsUpdate = true;
  }
  setRibbon(0);
  // ── the carriage (moves along x): platen, knobs, end plates, rail, paper table, bail, return lever, paper
  const car = new THREE.Group(); car.name = 'carriage'; car.position.set(0, TW.platenY, TW.platenZ); g.add(car);
  const platen = new THREE.Group(); car.add(platen);
  mk(cylX(TW.platenR, TW.platenHalf * 2, 64), M.platen, platen);
  for (const sx of [-1, 1]) {
    mk(cylX(0.0045, 0.022, 16), M.chrome, platen, [sx * 0.126, 0, 0]);
    mk(cylX(0.019, 0.022, 48), M.knob, platen, [sx * 0.1335, 0, 0]);
    mk(cylX(0.0128, 0.0014, 40), M.chrome, platen, [sx * 0.1452, 0, 0]);
    mk(cylX(0.0167, 0.0012, 40), M.chrome, platen, [sx * 0.1182, 0, 0]);
  }
  const plate = [[0.021, 0.0045], [0.021, 0.0135], [0.012, 0.020], [-0.010, 0.023], [-0.030, 0.017], [-0.046, -0.003], [-0.046, -0.0205], [0.012, -0.0205], [0.015, -0.006]];
  mk(extrudeX(plate, 0.1195, 0.1225, 0.0006), M.twBody, car);
  mk(extrudeX(plate, -0.1225, -0.1195, 0.0006), M.twBody, car);
  mk(boxM(0.25, 0.005, 0.007, 0, -0.0175, -0.041), M.chrome, car);
  mk(boxM(0.244, 0.009, 0.006, 0, -0.012, -0.041), M.twBody, car);
  { const dB = new V3(0, -Math.cos(TW.backA), Math.sin(TW.backA)), nO = new V3(0, Math.sin(TW.backA), Math.cos(TW.backA));
    const eB = new V3(0, TW.paperR * Math.sin(TW.backA), TW.paperR * Math.cos(TW.backA));
    const base = eB.clone().addScaledVector(dB, 0.012).addScaledVector(nO, 0.0018);
    const pt = mk(boxM(0.226, 0.11, 0.0012, 0, 0.055, 0), M.chrome, car); pt.position.copy(base); pt.quaternion.setFromUnitVectors(new V3(0, 1, 0), dB);
    for (const sx of [-1, 1]) { const arm = mk(boxM(0.004, 0.03, 0.004, 0, 0.015, 0), M.chrome, car); arm.position.set(sx * 0.112, -0.004, -0.02); arm.quaternion.copy(pt.quaternion); } }
  { const a = TW.exitA, rr = TW.paperR + 0.0035;
    mk(cylX(0.0013, 0.242, 12), M.chrome, car, [0, rr * Math.sin(a), rr * Math.cos(a)]);
    for (const x of [-0.094, 0.094]) mk(cylX(0.0034, 0.012, 20), M.rubber, car, [x, rr * Math.sin(a), rr * Math.cos(a)]); }
  const lever = new THREE.Group(); lever.position.set(-0.1215, 0.02, 0.0); car.add(lever);
  mk(tube([[0, 0, 0], [-0.014, 0.006, 0.006], [-0.03, 0.012, 0.022], [-0.038, 0.015, 0.045], [-0.040, 0.016, 0.062]], 0.0021, 24, 8), M.chrome, lever);
  mk(rbox(0.01, 0.0042, 0.026, 0.0016), M.chrome, lever, [-0.040, 0.016, 0.068]);
  // the sheet: letter paper wrapped round the platen; vertices follow the paper path, redone on every line feed
  const PR = 280, pw = TW.paperW, ph = TW.paperH;
  const paperGeo = new THREE.BufferGeometry();
  { const uv = [], idx = [];
    for (let j = 0; j <= PR; j++) for (let i = 0; i <= 2; i++) uv.push(i / 2, 1 - j / PR);
    for (let j = 0; j < PR; j++) for (let i = 0; i < 2; i++) { const a = j * 3 + i, b = a + 1, c = a + 3, d = a + 4; idx.push(a, c, b, b, c, d); }
    paperGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((PR + 1) * 9), 3));
    paperGeo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array((PR + 1) * 9), 3));
    paperGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); paperGeo.setIndex(idx); }
  const path = (s, o) => {
    const r = TW.paperR, a0 = TW.printA, a1 = TW.exitA, a2 = TW.backA, s1 = r * (a1 - a0), s2 = -r * (a0 - a2);
    if (s <= s1 && s >= s2) { const a = a0 + s / r; o.z = r * Math.cos(a); o.y = r * Math.sin(a); o.nz = Math.cos(a); o.ny = Math.sin(a); return o; }
    if (s > s1) { const d = s - s1, k = TW.curl, ph2 = a1 + k * d;
      o.z = r * Math.cos(a1) + (Math.cos(ph2) - Math.cos(a1)) / k; o.y = r * Math.sin(a1) + (Math.sin(ph2) - Math.sin(a1)) / k; o.nz = Math.cos(ph2); o.ny = Math.sin(ph2); return o; }
    const d = s2 - s; o.z = r * Math.cos(a2) + d * Math.sin(a2); o.y = r * Math.sin(a2) - d * Math.cos(a2); o.nz = Math.cos(a2); o.ny = Math.sin(a2); return o;
  };
  const tmp = { y: 0, z: 0, ny: 0, nz: 0 };
  let yLineNow = -1;
  function setPaper(yLine) {
    if (Math.abs(yLine - yLineNow) < 1e-7) return;
    yLineNow = yLine;
    const p = paperGeo.attributes.position, n = paperGeo.attributes.normal;
    for (let j = 0; j <= PR; j++) {
      path(yLine - j / PR * ph, tmp);
      for (let i = 0; i <= 2; i++) { const k = j * 3 + i; p.setXYZ(k, TW.paperLeft + i / 2 * pw, tmp.y, tmp.z); n.setXYZ(k, 0, tmp.ny, tmp.nz); }
    }
    p.needsUpdate = true; n.needsUpdate = true; paperGeo.computeBoundingSphere();
  }
  // ink canvas: covers the typed block only, at 30 px/mm; the paper shader composites it
  const pxmm = 30;
  let inkState = null;
  function makeInk(lay) {
    const x0 = TW.marginL - 0.004, x1 = TW.marginL + (lay.maxCol + 1) * TW.pitch + 0.004;
    const y0 = TW.marginT - TW.capH - 0.004, y1 = TW.marginT + (lay.lines - 1) * TW.lineH + 0.0035;
    const w = Math.ceil((x1 - x0) * 1000 * pxmm), h = Math.ceil((y1 - y0) * 1000 * pxmm);
    const c = cnv(w, h), ctx = c.getContext('2d');
    ctx.font = '100px HQElite';
    const m = ctx.measureText('H'), size = 100 * (TW.capH * 1000 * pxmm) / (m.actualBoundingBoxAscent || 70);
    const tex = canvasTex(c); tex.anisotropy = 16;
    return { lay, c, ctx, tex, x0, y0, x1, y1, size, key: '', rect: new THREE.Vector4(x0 / pw, 1 - y1 / ph, (x1 - x0) / pw, (y1 - y0) / ph) };
  }
  function drawInk(st, n, inkNew) {
    const key = `${n}|${Math.round(inkNew * 48)}`;
    if (st.key === key) return;
    st.key = key;
    const { ctx, c, lay, size } = st, k = 1000 * pxmm;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = `${size.toFixed(2)}px HQElite`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#000';
    for (const gl of lay.glyphs) {
      if (gl.k > n || (gl.k === n && inkNew <= 0)) continue;
      const fresh = gl.k === n ? inkNew : 1;
      const cxp = (TW.marginL + (gl.col + 0.5) * TW.pitch - st.x0) * k + (h01(gl.k, 1) - 0.5) * 0.12 * pxmm;
      const cyp = (TW.marginT + gl.line * TW.lineH - st.y0) * k + (h01(gl.k, 2) - 0.5) * 0.16 * pxmm;
      const dens = (0.74 + 0.24 * h01(gl.k, 3)) * fresh;
      ctx.save(); ctx.translate(cxp, cyp); ctx.rotate((h01(gl.k, 4) - 0.5) * 0.014);
      ctx.globalAlpha = dens; ctx.fillText(gl.ch, 0, 0); ctx.lineWidth = 0.075 * pxmm; ctx.strokeStyle = '#000'; ctx.strokeText(gl.ch, 0, 0);
      ctx.globalAlpha = dens * 0.3; ctx.fillText(gl.ch, 0.35, 0.5);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    st.tex.needsUpdate = true;
  }
  let paperMat = null, paperMesh = null;
  function ensureInk(text) {
    if (inkState && inkState.lay.text === text) return;
    inkState = makeInk(layoutText(text));
    if (!paperMat) {
      paperMat = paperMaterial(T.typingPaper, inkState.tex, inkState.rect);
      paperMesh = mk(paperGeo, paperMat, car, null, null, { cast: true }); paperMesh.frustumCulled = false; paperMesh.name = 'paper';
    } else {
      paperMat.userData.inkRect.copy(inkState.rect);
      paperMat.onBeforeCompile && (paperMat.needsUpdate = true);
      paperMat.userData.inkTex = inkState.tex;
    }
  }
  // state
  const carX = (col) => -TW.paperLeft - (TW.marginL + (col + 0.5) * TW.pitch);
  const yOfLine = (line) => TW.marginT + line * TW.lineH - TW.capH / 2;
  const cur = { text: '', chars: 0, col: 0, line: 0, n: 0, f: 0, key: -1, strike: 0 };
  let pressed = [];
  function setState(ty) {
    const text = ty.text ?? NUTS_TEXT;
    ensureInk(text);
    const lay = inkState.lay, len = text.length;
    const chars = clamp(ty.chars ?? 0, 0, len), n = Math.min(len, Math.floor(chars)), f = n < len ? chars - n : 0;
    const strike = clamp(ty.strike ?? 0, 0, 1), keyIdx = clamp(Math.round(ty.key ?? Math.min(len - 1, n)), 0, len - 1);
    const p0 = lay.pos[n];
    let colF = p0.col, lineF = p0.line;
    if (n < len) {
      const ch = text[n];
      if (ch === '\n') { const e = smooth(f); colF = lerp(p0.col, 0, e); lineF = p0.line + smooth(clamp((f - 0.05) / 0.5)); }
      else colF = p0.col + smooth(clamp((f - 0.35) / 0.4));
    }
    car.position.x = carX(colF);
    platen.rotation.x = -(lineF * TW.lineH) / TW.platenR;
    setPaper(yOfLine(lineF));
    const inkNew = ty.ink != null ? clamp(ty.ink) : (n < len && f > 0 ? smooth(clamp(f / 0.3)) : 0);
    drawInk(inkState, n, inkNew);
    // key, bar, space bar, lever
    for (const k of pressed) { k.grp.position.set(k.x, k.y0, k.z); if (k.bar) k.bar.grp.quaternion.setFromRotationMatrix(k.bar.basis(k.bar.aRest)); }
    pressed = [];
    space.position.y = 0.041; lever.rotation.y = 0;
    let lift = 0;
    const ch = text[keyIdx];
    if (strike > 0 && ch != null) {
      const press = smooth(clamp(strike * 1.25));
      if (ch === ' ') space.position.y = 0.041 - 0.005 * press;
      else if (ch === '\n') lever.rotation.y = -0.32 * press;
      else {
        const ck = charKey.get(ch) ?? charKey.get(ch.toLowerCase());
        if (ck) {
          const k = ck.key; k.grp.position.set(k.x, k.y0 - 0.0068 * press, k.z + 0.0012 * press); pressed.push(k);
          if (ck.shift && shiftKey) { shiftKey.grp.position.set(shiftKey.x, shiftKey.y0 - 0.006, shiftKey.z); pressed.push(shiftKey); }
          const e = strike < 1 ? 1 - Math.pow(1 - strike, 1.6) : 1;
          k.bar.grp.quaternion.setFromRotationMatrix(k.bar.basis(lerp(k.bar.aRest, k.bar.aHit, e)));
          lift = smooth(clamp((strike - 0.45) / 0.45));
        }
      }
    }
    setRibbon(lift);
    Object.assign(cur, { text, chars, col: colF, line: lineF, n, f, key: keyIdx, strike, lay });
  }
  // paper point (x from the sheet's left edge, y from its top edge) -> typewriter-local position + normal
  function paperLocal(px, py, out = new V3(), nrm) {
    path(yLineNow - py, tmp);
    out.set(car.position.x + TW.paperLeft + px, TW.platenY + tmp.y, TW.platenZ + tmp.z);
    if (nrm) nrm.set(0, tmp.ny, tmp.nz);
    return out;
  }
  setState({ text: NUTS_TEXT, chars: 0, strike: 0 });
  return { group: g, setState, paperLocal, cur, printPoint: P.clone(), charKey, car, get layout() { return inkState.lay; } };
}

// ══ TYPING DRIVER ═════════════════════════════════════════════════════════════════════════════════════════
// typingAt(t, {text, start, cps, seed}) -> {text, chars, strike, key}: a deliberate two-finger typist with pauses at
// the returns and a slow, spaced "N U T S !". strike peaks at each impact; the new character inks in 70 ms after
// it; a carriage return runs 0.34 s.
const SCHED = new Map();
function schedule(text, cps, seed) {
  const key = `${text}|${cps}|${seed}`;
  if (SCHED.has(key)) return SCHED.get(key);
  const T = []; let t = 0;
  const nutsAt = text.indexOf('N U T S');
  for (let k = 0; k < text.length; k++) {
    const ch = text[k], prev = text[k - 1];
    let dt = (1 / cps) * (0.72 + 0.56 * h01(k, seed));
    if (prev === '\n') dt = ch === '\n' ? 0.5 : 0.62;
    if (ch === '\n' && prev !== '\n') dt += 0.25;
    if (ch === ' ' && prev === ' ') dt = 0.1;
    if (nutsAt >= 0 && k >= nutsAt && k < nutsAt + 9) dt = k === nutsAt ? 1.1 : 0.34;
    if (nutsAt >= 0 && k === nutsAt + 9) dt = 0.9;
    t += k === 0 ? 0 : dt; T.push(t);
  }
  SCHED.set(key, T);
  return T;
}
// the impact time of every keystroke (seconds after `start`), e.g. to place key-clack sounds
export function typingTimes(o = {}) { return schedule(o.text ?? NUTS_TEXT, o.cps ?? 7, o.seed ?? 3).map((x) => x + (o.start ?? 0)); }
export function typingAt(t, o = {}) {
  const text = o.text ?? NUTS_TEXT, T = schedule(text, o.cps ?? 7, o.seed ?? 3), tt = t - (o.start ?? 0);
  let i = -1; for (let k = 0; k < T.length; k++) { if (T[k] <= tt) i = k; else break; }
  let chars = 0;
  if (i >= 0) chars = i + clamp((tt - T[i]) / (text[i] === '\n' ? 0.34 : 0.07));
  if (i === T.length - 1 && chars >= i + 1) chars = text.length;
  const RISE = 0.05, FALL = 0.085;
  let key = Math.min(text.length - 1, i + 1), strike = 0;
  for (let k = Math.max(0, i); k <= Math.min(T.length - 1, i + 1); k++) {
    const d = tt - T[k]; let v = 0;
    if (d >= -RISE && d < 0) v = smooth((d + RISE) / RISE); else if (d >= 0 && d < FALL) v = 1 - smooth(d / FALL);
    if (v > strike) { strike = v; key = k; }
  }
  if (strike === 0) key = Math.max(0, Math.min(text.length - 1, i));
  return { text, chars, strike, key, done: tt >= T[T.length - 1] + 0.4, duration: T[T.length - 1] + 0.4 };
}

// ══ BUILD ═════════════════════════════════════════════════════════════════════════════════════════════════
export async function buildHQ(opts = {}) {
  await loadFonts();
  RectAreaLightUniformsLib.init();
  const scene = new THREE.Scene(); scene.name = 'hq';
  scene.background = new THREE.Color(0x020202);
  const root = new THREE.Group(); scene.add(root);

  // textures
  const T = {};
  T.whitewash = paintWhitewash(11, 1024);
  T.flags = TX.masonry({ size: 1024, meters: 4, courseH: 0.5, blockL: [0.45, 1.05], tones: ['#8A8276', '#7E766A', '#948B7E', '#756D62'], mortar: '#4E473F', bevel: 0.03, chip: 0.9, seed: 17, dirt: 0.6, stoneRough: 0.8 });
  T.grime = TX.grime(256);
  T.soot = { value: new THREE.Vector4(LAMP_AT.x, LAMP_AT.y + 0.15, LAMP_AT.z, 1) };
  T.planks = TX.planks({ size: 512, meters: 2, boardW: 0.12, tone: '#3E2A1A', tone2: '#6A4A2E', seed: 5 });
  T.planksDark = TX.planks({ size: 512, meters: 2, boardW: 0.14, tone: '#2A1E14', tone2: '#4A3424', seed: 8 });
  T.planksCrate = TX.planks({ size: 512, meters: 2, boardW: 0.1, tone: '#4A4630', tone2: '#6A6444', seed: 12 });
  T.planksDoor = TX.planks({ size: 512, meters: 2, boardW: 0.15, tone: '#2E241A', tone2: '#524232', seed: 14 });
  T.plywood = TX.planks({ size: 256, meters: 1.2, boardW: 1.2, tone: '#8A6E4C', tone2: '#A88A62', seed: 19 });
  T.table = paintTableTop(23);
  T.crinkle = noiseTex({ size: 256, freq: 32, oct: 2, seed: 31, k: 1.6, ridged: true });
  T.leather = noiseTex({ size: 256, freq: 24, oct: 3, seed: 41, k: 1.4, ridged: true, rgb: [104, 62, 34], vary: 0.16 });
  T.odPaint = noiseTex({ size: 256, freq: 12, oct: 3, seed: 43, k: 1.2, rgb: [74, 72, 48], vary: 0.12 });
  T.odSand = noiseTex({ size: 256, freq: 32, oct: 3, seed: 47, k: 1.4, rgb: [72, 72, 48], vary: 0.1 });
  T.odSand.map.repeat.set(10, 4); T.odSand.normalMap.repeat.set(10, 4);
  T.web = noiseTex({ size: 128, freq: 32, oct: 2, seed: 53, k: 2.0, rgb: [108, 100, 70], vary: 0.12 });
  T.burlap = paintBurlap(3, 256);
  { const c = cnv(512, 16), x = c.getContext('2d'); for (let i = 0; i < 512; i += 4) { x.fillStyle = i % 8 ? '#000' : '#fff'; x.fillRect(i, 0, 2, 16); }
    const h = new Float32Array(512 * 16); for (let j = 0; j < 16; j++) for (let i = 0; i < 512; i++) h[j * 512 + i] = Math.abs(Math.sin(i / 512 * Math.PI * 90));
    T.knurl = dataTex(heightNormals(h, 512, 16, 1.5), 512, 16, false); }
  { const c = cnv(8, 64), x = c.getContext('2d'); x.fillStyle = '#6a1712'; x.fillRect(0, 0, 8, 64); x.fillStyle = '#111010'; x.fillRect(0, 0, 8, 32); T.ribbon = canvasTex(c, { repeat: true }); }
  { const c = cnv(256, 64), x = c.getContext('2d'); x.fillStyle = '#e8e2d2'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#1c2a4a'; x.fillRect(0, 0, 256, 6); x.fillStyle = 'rgba(30,30,34,0.9)';
    const R = rng(4); for (let k = 0; k < 9; k++) { x.beginPath(); x.arc(R() * 256, R() * 60, 1 + R() * 3, 0, 6.29); x.fill(); } T.enamel = canvasTex(c); T.enamel.flipY = false; }
  { const { c } = paperCanvas(1024, Math.round(1024 * 11 / 8.5), 61); T.typingPaper = canvasTex(c); }
  { const { c } = paperCanvas(512, 662, 62, [240, 236, 224]); T.sheet = canvasTex(c); }
  T.ultimatum = canvasTex(typedSheet(ULTIMATUM, 71));
  T.form = canvasTex(messageForm(81));
  T.calendar = canvasTex(calendar());
  T.radio = radioPanel();
  T.outside = outsideView();
  T.glow = glowTex(); T.smoke = smokeTex(9);
  T.env = envTexture();
  T.keys = { tex: null, uv: () => ({ u0: 0, v0: 0, s: 1 }) };
  const mapCanvas = opts.mapCanvas ?? (() => { const c = cnv(2048, 2048); drawStaffMap(c, { km: 22 }); return c; })();
  T.map = canvasTex(mapCanvas); T.map.anisotropy = 16;
  const wallMapC = cnv(2048, 1496), wallPins = drawStaffMap(wallMapC, { km: 34, seed: 1945, contour: 20, overlay: true }).pins;
  T.wallMap = canvasTex(wallMapC);
  const M = makeMaterials(T);
  M.map = plain({ map: T.map, roughness: 0.84, envMapIntensity: 0.3 });
  M.wallMap = plain({ map: T.wallMap, roughness: 0.34, envMapIntensity: 0.45 });

  // room and furniture
  buildRoom(M, T, root);
  buildTable(M, root);
  buildDesk(M, root);
  buildChair(M, root, 1.66, -1.16, 0.18);
  buildChair(M, root, 0.25, -0.62, Math.PI - 0.12);
  buildChair(M, root, -1.38, 0.34, Math.PI / 2 + 0.2);
  const stencil1 = canvasTex(crateLabel(['CARTRIDGES CAL .30', 'BALL M2', '1500 ROUNDS'], 5)), stencil2 = canvasTex(crateLabel(['RATION K', 'DINNER UNIT', '36 PACKAGES'], 6));
  buildCrate(M, T, root, -1.26, 0, -1.80, 0.02, 0.62, 0.30, 0.36, stencil1);
  buildCrate(M, T, root, -1.25, 0.30, -1.79, -0.03, 0.62, 0.30, 0.36, stencil2);
  buildCrate(M, T, root, -2.62, 0, -1.62, 0.06, 0.62, 0.30, 0.36, stencil1);
  buildCrate(M, T, root, -2.60, 0.30, -1.64, 0.12, 0.62, 0.30, 0.36, stencil1);
  buildCrate(M, T, root, -2.66, 0, -1.02, Math.PI / 2 - 0.05, 0.62, 0.30, 0.36, stencil2);

  // sandbags in the window embrasure, laid as stretchers across the opening on the outer, sloping part of the sill
  // (their ends run into the jambs), a second course above; the daylight comes in over them
  { const X = HL + ROOM.wallT, sill = (x) => WIN.iy0 + (WIN.oy0 - WIN.iy0) * (x - HL) / ROOM.wallT, slope = Math.atan2(WIN.oy0 - WIN.iy0, ROOM.wallT), bags = [];
    bags.push([X - 0.14, -0.15, 0, 0.46, 0.14, 0.26, 0], [X - 0.15, 0.16, 0, 0.44, 0.14, 0.25, 1]);
    bags.push([X - 0.12, 0.0, 0.14 * 0.84, 0.46, 0.13, 0.24, 5], [X - 0.36, -0.2, 0, 0.36, 0.12, 0.2, 6]);
    for (const [bx, bz, lift, L, H, D, sd] of bags) {
      const m = mk(sandbagGeometry(L, H, D, sd + 3), M.burlap, root, [bx, sill(bx) + lift + H / 2 * 0.72, bz]);
      m.rotation.order = 'ZYX';
      m.rotation.set((h01(sd, 1) - 0.5) * 0.06, Math.PI / 2 + (h01(sd, 2) - 0.5) * 0.16, slope + (h01(sd, 3) - 0.5) * 0.04);
    } }

  // the map on the table
  const mapSize = opts.mapSize ?? [0.9, 0.9], mapYaw = opts.mapYaw ?? 0.035;
  const mapY = TABLE.top + 0.0006;
  const mapMesh = mk(new THREE.PlaneGeometry(mapSize[0], mapSize[1]).rotateX(-Math.PI / 2), M.map, root, [MAP_AT.x, mapY, MAP_AT.z], [0, mapYaw, 0], { cast: false });
  mapMesh.name = 'map';
  // papers, pencils, props on the table
  const onT = (x, z) => [x, TABLE.top, z];
  // right half of the table, laid out in plan so nothing overlaps: telephone back-left, helmet back-right,
  // the ultimatum in the middle, pistol belt and holster front-right, mug and ashtray at the front edge
  mk(sheet(0.216, 0.279, null, 0.004), M.ultimatum, root, onT(0.40, 0.25), [0, -0.28, 0], { cast: false }).position.y += 0.0009;
  mk(sheet(0.216, 0.279, null), M.paperSheet, root, onT(0.43, 0.22), [0, -0.2, 0], { cast: false }).position.y += 0.0004;
  mk(sheet(0.13, 0.19, null), M.form, root, onT(-0.87, 0.02), [0, 0.35, 0], { cast: false }).position.y += 0.0004;
  mk(sheet(0.13, 0.19, null), M.form, root, onT(-0.85, -0.03), [0, 0.2, 0], { cast: false }).position.y += 0.0008;
  { const p = buildPencil(M, M.pencilRed); p.position.set(0.38, TABLE.top + 0.0012, 0.20); p.rotation.y = 0.5; root.add(p);
    const q = buildPencil(M, M.pencilBlue); q.position.set(0.41, TABLE.top + 0.0012, 0.25); q.rotation.y = 0.85; root.add(q); }
  const ee8 = buildEE8(M); ee8.position.set(0.34, TABLE.top, -0.22); ee8.rotation.y = -0.12; root.add(ee8);
  const hand = buildHandset(M); hand.position.set(0.37, TABLE.top, -0.05); hand.rotation.y = 0.22; root.add(hand);
  const helmet = buildHelmet(M); helmet.position.set(0.80, TABLE.top, -0.14); helmet.rotation.y = 2.4; root.add(helmet);
  const belt = buildBelt(M, 7); belt.position.set(0.77, TABLE.top, 0.30); belt.rotation.y = 0.1; root.add(belt);
  const mug1 = buildMug(M); mug1.position.set(0.28, TABLE.top, 0.57); mug1.rotation.y = 2.2; root.add(mug1);
  const cup = buildCup(M); cup.position.set(-0.86, TABLE.top, 0.50); cup.rotation.y = -0.6; root.add(cup);
  const ash = buildAshtray(M); ash.group.position.set(0.47, TABLE.top, 0.60); ash.group.rotation.y = 0.5; root.add(ash.group);
  // field wire from the telephone across the table, down to the floor and away to the window end
  { const sill = (x) => WIN.iy0 + (WIN.oy0 - WIN.iy0) * (x - HL) / ROOM.wallT;
    const pts = [[0.47, TABLE.top + 0.012, -0.21], [0.53, TABLE.top + 0.003, -0.28], [0.57, TABLE.top + 0.003, -0.337], [0.585, TABLE.top - 0.02, -0.36], [0.62, 0.5, -0.42], [0.68, 0.12, -0.5], [0.8, 0.004, -0.56],
      [1.6, 0.003, -0.6], [2.3, 0.003, -0.45], [2.93, 0.003, -0.46], [2.995, 0.2, -0.46], [2.995, 1.2, -0.44], [2.995, 1.62, -0.43], [3.05, sill(3.05) + 0.004, -0.37], [3.2, sill(3.2) + 0.004, -0.33]];
    mk(tube(pts, 0.0024, 220, 6), M.wire, root);
    mk(tube(pts.map(([x, y, z], i) => [x + (i > 6 ? 0.006 : 0.004), y, z + 0.006]), 0.0024, 220, 6), M.wire, root); }
  // map board on the +Z wall, situation map with pins
  { const bw = 1.3, bh = 0.95, cx = -0.55, cy = 1.16, z = HW - 0.012;
    const board = new THREE.Group(); board.position.set(cx, cy, z); board.rotation.set(-0.02, Math.PI, 0); root.add(board);
    mk(boxM(bw, bh, 0.018, 0, 0, 0), M.plywood, board, [0, 0, -0.012]);
    mk(new THREE.PlaneGeometry(bw - 0.07, (bw - 0.07) * 1496 / 2048), M.wallMap, board, [0, -0.005, 0.0096], null, { cast: false });
    for (const [x, y, w, h] of [[0, bh / 2 - 0.011, bw + 0.02, 0.022], [0, -bh / 2 + 0.011, bw + 0.02, 0.022], [-bw / 2 - 0.0, 0, 0.022, bh], [bw / 2, 0, 0.022, bh]]) mk(boxM(w, h, 0.03, 0, 0, 0), M.wood, board, [x, y, 0.006]);
    const mw = bw - 0.07, mh = mw * 1496 / 2048;
    for (const pin of wallPins) {
      const [X, Y] = pin.p, px = -mw / 2 + X / 2048 * mw, py = -0.005 + mh / 2 - Y / 1496 * mh;
      mk(new THREE.SphereGeometry(0.0045, 12, 8), M.pinHead(pin.color), board, [px, py, 0.0096 + 0.009]);
      mk(drum(0.0005, 0.0005, 0, 0.009, 6).rotateX(Math.PI / 2), M.steel, board, [px, py, 0.0096]);
    }
    for (const [x, y, r] of [[0.52, 0.28, 0.05], [0.5, -0.2, -0.04]]) { const f = mk(new THREE.PlaneGeometry(0.13, 0.19), M.form, board, [x + 0.12, y, 0.0108], [0, 0, r], { cast: false }); f.position.x = Math.min(f.position.x, bw / 2 - 0.08); mk(new THREE.SphereGeometry(0.004, 10, 6), M.pinHead(0xc8a13a), board, [f.position.x, y + 0.085, 0.016]); } }
  // desk: the typewriter, a candle in a bottle, paper stack, carbon, mug, pencil; the calendar above
  const tw = buildTypewriter(M, T);
  tw.group.position.set(DESK.x - 0.02, DESK.top, DESK.z + 0.03); tw.group.rotation.y = -0.06; root.add(tw.group);
  const candle = buildCandleBottle(M, flameMaterial(0.026), 21);
  candle.group.position.set(DESK.x - 0.33, DESK.top, DESK.z + 0.2); root.add(candle.group);
  for (let k = 0; k < 6; k++) mk(sheet(0.216, 0.279, null), M.paperSheet, root, [DESK.x + 0.33 + (h01(k, 8) - 0.5) * 0.006, DESK.top + 0.0006 + k * 0.0009, DESK.z - 0.05 + (h01(k, 9) - 0.5) * 0.006], [0, 0.08 + (h01(k, 7) - 0.5) * 0.05, 0], { cast: k === 5 });
  mk(sheet(0.216, 0.279, null), M.carbon, root, [DESK.x + 0.30, DESK.top + 0.0004, DESK.z + 0.01], [0, 0.2, 0], { cast: false });
  const mug2 = buildCup(M); mug2.position.set(DESK.x + 0.39, DESK.top, DESK.z + 0.21); mug2.rotation.y = 2.6; root.add(mug2);
  { const p = buildPencil(M, M.pencilYellow); p.position.set(DESK.x - 0.2, DESK.top, DESK.z + 0.22); p.rotation.y = -0.3; root.add(p); }
  mk(new THREE.PlaneGeometry(0.19, 0.26), M.calendar, root, [DESK.x + 0.3, 1.36, -HW + 0.003], null, { cast: false });
  mk(new THREE.SphereGeometry(0.004, 10, 6), M.iron, root, [DESK.x + 0.3, 1.482, -HW + 0.006]);
  // radio on the crates by the -Z wall, headphones beside it
  const radio = buildRadio(M); radio.position.set(-1.26, 0.60, -1.80); radio.rotation.y = 0.02; root.add(radio);
  const phones = buildHeadphones(M); phones.position.set(-0.99, 0.60, -1.72); phones.rotation.y = 0.5; root.add(phones);
  mk(tube([[-1.3, 0.87, -1.9], [-1.32, 1.1, -1.985], [-1.3, 1.6, -1.99], [-0.8, 1.66, -1.99], [0.2, 1.62, -1.99], [1.2, 1.66, -1.99], [2.4, 1.63, -1.99], [2.99, 1.7, -1.6], [2.99, 1.78, -0.5], [3.1, WIN.iy0 + 0.004, -0.36]], 0.0026, 260, 6), M.wire, root);

  // the hurricane lamp, hanging from a hook at the crown
  const flameLampMat = flameMaterial(0.034);
  const lamp = buildLamp(M, flameLampMat);
  lamp.group.position.copy(LAMP_AT); root.add(lamp.group);
  { const top = LAMP_AT.clone().add(lamp.hang), hookY = vaultHeight(LAMP_AT.z) - 0.005;
    mk(tube([[top.x, top.y, top.z], [top.x, (top.y + hookY) / 2, top.z + 0.002], [top.x, hookY - 0.03, top.z]], 0.0016, 24, 5), M.steel, root);
    mk(new THREE.TorusGeometry(0.014, 0.0028, 6, 16, Math.PI * 1.4), M.iron, root, [top.x, hookY - 0.032, top.z], [0, 0, Math.PI * 0.8]);
    mk(drum(0.004, 0.004, hookY - 0.02, hookY + 0.03, 8), M.iron, root, [top.x, 0, top.z]); }
  // a second candle on the map table (a stub on a tin saucer)
  const candle2 = (() => {
    const g = new THREE.Group(); g.position.set(-0.86, TABLE.top, -0.22); root.add(g);
    mk(lathe([[0, 0], [0.052, 0], [0.056, 0.008], [0.053, 0.009], [0.049, 0.003], [0, 0.003]], 32), M.tin, g);
    mk(drum(0.012, 0.0115, 0.003, 0.058, 20), M.wax, g, null, null, { cast: false });
    mk(new THREE.TorusGeometry(0.016, 0.005, 8, 20).rotateX(Math.PI / 2), M.wax, g, [0, 0.006, 0], null, { cast: false });
    mk(drum(0.0009, 0.0007, 0.057, 0.065, 6), M.wick, g, null, null, { cast: false });
    const flame = mk(flameGeometry(0.0052, 0.024), flameMaterial(0.024), g, [0, 0.076, 0], null, { cast: false, receive: false });
    return { group: g, flame, flameY: 0.076 };
  })();

  // ── lights
  const lampWorld = LAMP_AT.clone();
  const lampLight = new THREE.PointLight(0xffac60, 3.3, 0, 2);
  lampLight.position.copy(lampWorld); lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(1024, 1024); lampLight.shadow.camera.near = 0.09; lampLight.shadow.camera.far = 9;
  lampLight.shadow.bias = -0.002; lampLight.shadow.normalBias = 0.012; lampLight.shadow.radius = 5;
  scene.add(lampLight);
  const candleWorld = new V3(); candle.group.updateMatrixWorld(true); candle.group.localToWorld(candleWorld.set(0, candle.flameY + 0.004, 0));
  const candleLight = new THREE.PointLight(0xff9440, 0.34, 0, 2);
  candleLight.position.copy(candleWorld); candleLight.castShadow = true;
  candleLight.shadow.mapSize.set(1024, 1024); candleLight.shadow.camera.near = 0.02; candleLight.shadow.camera.far = 6;
  candleLight.shadow.bias = -0.0015; candleLight.shadow.normalBias = 0.006; candleLight.shadow.radius = 4;
  scene.add(candleLight);
  const candle2World = new V3(); candle2.group.updateMatrixWorld(true); candle2.group.localToWorld(candle2World.set(0, candle2.flameY + 0.004, 0));
  const candle2Light = new THREE.PointLight(0xff9440, 0.2, 0, 2); candle2Light.position.copy(candle2World); scene.add(candle2Light);
  // the window: a soft cold panel (the sky seen over the sandbags) and, for the patch it throws on the table, an
  // orthographic key from the same direction; overcast light, so its shadow edge is kept very soft
  const WIN_I = 30, SUN_I = 7;
  const winLight = new THREE.RectAreaLight(0xbccde4, WIN_I, WIN.oz * 2, WIN.iy1 - WIN.gap);
  winLight.position.set(HL - 0.02, (WIN.gap + WIN.iy1) / 2, 0); winLight.lookAt(HL - 3, 1.1, 0); scene.add(winLight);
  const sunDir = new V3(-1, -0.5, 0.03).normalize();
  const sun = new THREE.DirectionalLight(0xc6d4e8, SUN_I);
  sun.target.position.set(1.4, 1.0, 0); sun.position.copy(sun.target.position).addScaledVector(sunDir, -7);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; sun.shadow.radius = 14;
  { const sc = sun.shadow.camera; sc.left = -2.3; sc.right = 2.3; sc.top = 2.6; sc.bottom = -2.6; sc.near = 1; sc.far = 13; sc.updateProjectionMatrix(); }
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x5c4c40, 0x121010, 0.12); scene.add(hemi);
  // warm bounce off the whitewashed vault above the lamp (no shadow): lifts the corners without flattening
  const BOUNCE_I = 0.45;
  const bounce = new THREE.PointLight(0xffc690, BOUNCE_I, 0, 2); bounce.position.set(LAMP_AT.x, ROOM.crown - 0.35, LAMP_AT.z); scene.add(bounce);
  scene.environment = T.env; scene.environmentIntensity = 1.0;

  // ── air: glow round the flames, haze round the lamp, the window beam, cigarette smoke
  const glowMat = (c, o) => new THREE.SpriteMaterial({ map: T.glow, color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending });
  const lampGlow = new THREE.Sprite(glowMat(new THREE.Color(1.6, 0.95, 0.45), 0.9)); lampGlow.scale.setScalar(0.16); lampGlow.position.copy(lampWorld); scene.add(lampGlow);
  const lampHaze = new THREE.Sprite(glowMat(new THREE.Color(0.55, 0.36, 0.2), 0.16)); lampHaze.scale.setScalar(1.5); lampHaze.position.copy(lampWorld); scene.add(lampHaze);
  const candleGlow = new THREE.Sprite(glowMat(new THREE.Color(1.5, 0.85, 0.4), 0.7)); candleGlow.scale.setScalar(0.07); candleGlow.position.copy(candleWorld); scene.add(candleGlow);
  const candleHaze = new THREE.Sprite(glowMat(new THREE.Color(0.5, 0.3, 0.15), 0.12)); candleHaze.scale.setScalar(0.5); candleHaze.position.copy(candleWorld); scene.add(candleHaze);
  const candle2Glow = new THREE.Sprite(glowMat(new THREE.Color(1.5, 0.85, 0.4), 0.6)); candle2Glow.scale.setScalar(0.06); candle2Glow.position.copy(candle2World); scene.add(candle2Glow);
  const shaftMat = shaftMaterial();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shaftMat); shaft.frustumCulled = false;
  { const len = 3.2, start = new V3(HL + ROOM.wallT, 2.2, 0), mid = start.clone().addScaledVector(sunDir, len / 2);
    shaft.position.copy(mid); shaft.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new V3(0, 0, 0), sunDir.clone().negate(), new V3(0, 1, 0)));
    shaft.scale.set(WIN.oz * 2 + 0.06, 0.34, len); shaft.updateMatrixWorld(true);
    shaftMat.uniforms.uModel.value.copy(shaft.matrixWorld); shaftMat.uniforms.uInv.value.copy(shaft.matrixWorld).invert(); }
  scene.add(shaft);
  const smokeMat = [];
  const smoke = [];
  const emberWorld = new V3(); ash.group.updateMatrixWorld(true); ash.cig.localToWorld(emberWorld.copy(ash.emberLocal));
  for (let i = 0; i < 26; i++) {
    const m = new THREE.SpriteMaterial({ map: T.smoke, color: new THREE.Color(0.78, 0.76, 0.74), transparent: true, opacity: 0, depthWrite: false, rotation: h01(i, 5) * 6.28 });
    const s = new THREE.Sprite(m); s.position.copy(emberWorld); scene.add(s); smoke.push(s); smokeMat.push(m);
  }

  // ── anchors (vectors are live: update() refreshes them)
  const up = new V3(0, 1, 0), north = new V3(0, 0, -1).applyAxisAngle(up, mapYaw), east = new V3(1, 0, 0).applyAxisAngle(up, mapYaw);
  const mapCenter = new V3(MAP_AT.x, mapY, MAP_AT.z);
  const anchors = {
    map: {
      center: mapCenter, size: mapSize.slice(), normal: up.clone(), north, east, yaw: mapYaw,
      quaternion: mapMesh.quaternion.clone(), mesh: mapMesh, texture: T.map,
      // (u, v) canvas fractions, v from the top (north) edge -> world point on the sheet
      uvToWorld: (u, v, out = new V3()) => out.copy(mapCenter).addScaledVector(east, (u - 0.5) * mapSize[0]).addScaledVector(north, (0.5 - v) * mapSize[1]),
    },
    typewriter: {
      point: new V3(), printPoint: new V3(), lineStart: new V3(), textCenter: new V3(), paperCenter: new V3(), paperNormal: new V3(), paperUp: new V3(), paperRight: new V3(),
      carriage: new V3(), paperTop: new V3(), group: tw.group,
    },
    lamp: { position: lampWorld.clone(), light: lampLight, color: lampLight.color },
    candle: { position: candleWorld.clone(), light: candleLight },
    window: { center: new V3(HL, (WIN.iy0 + WIN.iy1) / 2, 0), normal: new V3(-1, 0, 0), size: [WIN.iz * 2, WIN.iy1 - WIN.iy0], sunDir: sunDir.clone() },
    room: { length: ROOM.L, width: ROOM.W, spring: ROOM.spring, crown: ROOM.crown, vaultHeight },
    shots: {},
  };
  tw.group.updateMatrixWorld(true);
  const twM = tw.group.matrixWorld, twQ = new THREE.Quaternion(); tw.group.getWorldQuaternion(twQ);
  const tA = new V3(), tB = new V3(), tN = new V3();
  function refreshTypewriterAnchors() {
    const A = anchors.typewriter, cu = tw.cur, lay = cu.lay;
    A.printPoint.copy(tw.printPoint).applyMatrix4(twM);
    const idx = cu.n < cu.text.length && cu.f > 0 ? cu.n : Math.max(0, cu.n - 1);
    const p = lay.pos[idx], ch = cu.text[idx];
    const col = ch === '\n' || !cu.n ? lay.pos[cu.n].col : p.col, line = ch === '\n' || !cu.n ? lay.pos[cu.n].line : p.line;
    tw.paperLocal(TW.marginL + (col + 0.5) * TW.pitch, TW.marginT + line * TW.lineH - TW.capH / 2, tA).applyMatrix4(twM); A.point.copy(tA);
    tw.paperLocal(TW.marginL, TW.marginT + cu.line * TW.lineH - TW.capH / 2, tA).applyMatrix4(twM); A.lineStart.copy(tA);
    tw.paperLocal(TW.marginL + (lay.maxCol / 2) * TW.pitch, TW.marginT + Math.min(cu.line, lay.lines - 1) / 2 * TW.lineH - TW.capH / 2, tA, tN).applyMatrix4(twM); A.textCenter.copy(tA);
    const yl = TW.marginT + cu.line * TW.lineH - TW.capH / 2;
    tw.paperLocal(TW.paperW / 2, yl * 0.5, tA, tN).applyMatrix4(twM); A.paperCenter.copy(tA); A.paperNormal.copy(tN).applyQuaternion(twQ).normalize();
    tw.paperLocal(TW.paperW / 2, 0, tA).applyMatrix4(twM); A.paperTop.copy(tA);
    A.paperRight.set(1, 0, 0).applyQuaternion(twQ); A.paperUp.crossVectors(A.paperNormal, A.paperRight).negate().normalize();
    A.carriage.copy(tw.car.position).applyMatrix4(twM);
  }
  function shots() {
    const A = anchors.typewriter, S = anchors.shots;
    S.wide = { pos: [-2.62, 1.5, 1.52], look: [0.95, 0.98, -0.62], fov: 56, up: [0, 1, 0] };
    const mc = anchors.map.center, hFill = (mapSize[0] * 0.47) / Math.tan(Math.atan(Math.tan(20 * DEG) * 16 / 9));
    S.map = { pos: [mc.x, mc.y + hFill, mc.z], look: [mc.x, mc.y, mc.z], up: north.toArray(), fov: 40 };
    const pp = A.printPoint, R = A.paperRight, U = new V3(0, 1, 0), F = new V3(0, 0, 1).applyQuaternion(twQ);
    const mp = pp.clone().addScaledVector(R, -0.009).addScaledVector(U, -0.006).addScaledVector(F, 0.006);
    S.macro = { pos: mp.clone().addScaledVector(F, 0.125).addScaledVector(R, 0.058).addScaledVector(U, 0.1).toArray(), look: mp.clone().addScaledVector(F, 0.012).toArray(), fov: 30, up: [0, 1, 0] };
    const tc = A.textCenter, n = A.paperNormal;
    S.page = { pos: tc.clone().addScaledVector(n, 0.165).addScaledVector(U, 0.01).toArray(), look: tc.toArray(), fov: 30, up: [0, 1, 0] };
  }

  // ── per frame
  let lastTyping = { text: NUTS_TEXT, chars: 0, strike: 0 };
  const flick = (t, k, a = 1) => 1 + a * (0.035 * Math.sin(t * 7.3 + k) + 0.024 * Math.sin(t * 13.9 + k * 2.1) + 0.017 * Math.sin(t * 23.3 + k * 3.7) + 0.011 * Math.sin(t * 37.1 + k * 1.3));
  function update(t, s = {}) {
    if (s.typing) lastTyping = s.typing;
    tw.setState(lastTyping);
    const lm = s.lampMul ?? 1, cm = s.candleMul ?? 1, dm = s.dayMul ?? 1;
    const fl = flick(t, 0.3), fc = flick(t * 1.3, 2.1, 2.2), fc2 = flick(t * 1.2, 4.7, 2.0);
    lampLight.intensity = 3.3 * lm * fl; bounce.intensity = BOUNCE_I * lm * fl;
    flameLampMat.uniforms.uI.value = lm * fl; lamp.flame.scale.set(1, 1 + (fl - 1) * 2.5, 1);
    lampGlow.material.opacity = 0.9 * lm * fl; lampHaze.material.opacity = 0.16 * lm;
    candleLight.intensity = 0.34 * cm * fc; candle.flame.scale.set(1, 1 + (fc - 1) * 2.2, 1); candle.flame.rotation.z = Math.sin(t * 3.1) * 0.05;
    candle.flame.material.uniforms.uI.value = cm * fc; candleGlow.material.opacity = 0.7 * cm * fc; candleHaze.material.opacity = 0.12 * cm;
    candle2Light.intensity = 0.2 * cm * fc2; candle2.flame.scale.set(1, 1 + (fc2 - 1) * 2.2, 1); candle2.flame.material.uniforms.uI.value = cm * fc2; candle2Glow.material.opacity = 0.6 * cm * fc2;
    winLight.intensity = WIN_I * dm; sun.intensity = SUN_I * dm; shaftMat.uniforms.uDensity.value = 0.9 * dm * (s.haze ?? 1); shaftMat.uniforms.uTime.value = t;
    M.outside.color.setRGB(2.3 * dm, 2.45 * dm, 2.75 * dm);
    // smoke: particles born at the ember, rising and curling, deterministic in t
    const showSmoke = s.smoke ?? true;
    for (let i = 0; i < smoke.length; i++) {
      const age = ((t * 0.16 + i / smoke.length) % 1 + 1) % 1, sp = smoke[i], h = age * 0.55;
      const sw = Math.sin(age * 5.0 + i * 1.7 + t * 0.6) * 0.035 * age + Math.sin(t * 0.37 + i) * 0.02 * age * age;
      sp.position.set(emberWorld.x + sw + age * age * 0.06, emberWorld.y + h, emberWorld.z + Math.cos(age * 4.1 + i + t * 0.5) * 0.03 * age);
      sp.scale.setScalar(0.012 + age * 0.17);
      sp.material.opacity = showSmoke ? Math.pow(Math.sin(Math.PI * Math.min(1, age * 1.15)), 1.3) * 0.085 * (1 - age * 0.4) : 0;
      sp.material.rotation = h01(i, 5) * 6.28 + age * 1.3;
    }
    refreshTypewriterAnchors();
    shots();
  }
  update(0, {});
  shots();
  return {
    scene, update, anchors, typewriter: tw,
    setMapCanvas(c) { T.map.image = c; T.map.needsUpdate = true; },
    layout: { ROOM, TABLE, DESK, TW, LAMP: LAMP_AT.clone() },
  };
}
