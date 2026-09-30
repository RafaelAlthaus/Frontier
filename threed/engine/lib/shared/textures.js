// textures.js — every surface texture of the world, painted procedurally at start-up (no files, no requests).
// Colour maps are sRGB DataTextures; normal / roughness / data maps are linear. All tile (RepeatWrapping)
// unless noted; masonry and planks are painted to a known size in metres so geometry can map UVs in metres.
import * as THREE from 'three';
import { rng, makeNoise, clamp, lerp, smooth } from './util.js';

const N = makeNoise(7);
const N2 = makeNoise(31);

function dataTex(data, size, srgb, opts = {}) {
  const t = new THREE.DataTexture(data, size, opts.h || size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// height (Float32Array size*size, tileable) -> tangent-space normal map
function normalMap(h, size, strength, wrap = true) {
  const d = new Uint8Array(size * size * 4);
  const at = (x, y) => {
    if (wrap) { x = (x + size) % size; y = (y + size) % size; } else { x = clamp(x, 0, size - 1); y = clamp(y, 0, size - 1); }
    return h[y * size + x];
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    // image rows go down; texture v goes up -> flip dy so bumps read the right way round
    let nx = -dx, ny = dy, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  return dataTex(d, size, false, { clamp: !wrap });
}

function hexRGB(hex) { const c = parseInt(hex.slice(1), 16); return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }

// ── ashlar masonry: courses of dressed blocks, tileable; `meters` square per tile ─────────────────────────────
export function masonry({ size = 1024, meters = 8, courseH = 0.66, blockL = [0.8, 1.9], tones = ['#D9CDB6', '#CFC2A8', '#E1D6C2', '#C9C0B2'],
  mortar = '#B8AD9A', bevel = 0.035, chip = 0.5, seed = 3, dirt = 0.35, stoneRough = 0.82 } = {}) {
  const R = rng(seed);
  const ppm = size / meters;
  const courses = Math.max(1, Math.round(meters / courseH));
  const ch = size / courses;                         // course height in px
  const cols = [];                                   // per course: block id per x, left joint, right joint per id
  const tonesRGB = tones.map(hexRGB);
  const blocks = [];
  for (let c = 0; c < courses; c++) {
    const joints = [];
    let x = R() * size;
    const start = x;
    while (x < start + size - blockL[0] * ppm * 0.6) {
      joints.push(x % size);
      x += (blockL[0] + R() * (blockL[1] - blockL[0])) * ppm;
    }
    joints.sort((a, b) => a - b);
    const id = new Int32Array(size), L = new Float32Array(size), Rr = new Float32Array(size);
    for (let px = 0; px < size; px++) {
      // find the joint at or left of px (wrapping)
      let k = -1;
      for (let j = joints.length - 1; j >= 0; j--) if (joints[j] <= px) { k = j; break; }
      const left = k >= 0 ? joints[k] : joints[joints.length - 1] - size;
      const right = k + 1 < joints.length ? joints[k + 1] : joints[0] + size;
      const bi = (k + joints.length) % joints.length;
      id[px] = blocks.length + bi;
      L[px] = px - left; Rr[px] = right - px;
    }
    for (let j = 0; j < joints.length; j++) {
      const t = tonesRGB[Math.floor(R() * tonesRGB.length)];
      const v = 0.9 + R() * 0.2;
      blocks.push({ rgb: t.map((u) => u * v), stain: R(), sx: R() * 50, sy: R() * 50 });
    }
    cols.push({ id, L, R: Rr });
  }
  const mRGB = hexRGB(mortar);
  const col = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const hgt = new Float32Array(size * size);
  const bevelPx = bevel * ppm;
  const per = 8;                                      // noise period (cells) across the tile
  for (let y = 0; y < size; y++) {
    const c = Math.min(courses - 1, Math.floor(y / ch));
    const yIn = y - c * ch;
    const row = cols[c];
    const dyEdge = Math.min(yIn, ch - yIn);
    for (let x = 0; x < size; x++) {
      const b = blocks[row.id[x]];
      const dxEdge = Math.min(row.L[x], row.R[x]);
      const u = x / size * per, v = y / size * per;
      const nFine = N.fbm2(u * 6, v * 6, 3, 2, 0.5, per * 6, per * 6);
      const nMid = N2.fbm2(u * 1.5 + b.sx, v * 1.5 + b.sy, 4);
      // chipped arrises: the edge distance is eaten by noise
      const e = Math.min(dxEdge, dyEdge) - chip * bevelPx * (0.5 + 0.5 * N.noise2(u * 9, v * 9, per * 9, per * 9));
      const face = smooth(e / bevelPx);
      const isJoint = e < 0.9;
      const hFace = 0.55 + 0.45 * face + nFine * 0.05 + nMid * 0.06;
      const i = y * size + x;
      hgt[i] = isJoint ? 0.0 : hFace;
      let r, g, bl;
      if (isJoint) { r = mRGB[0]; g = mRGB[1]; bl = mRGB[2]; }
      else {
        const shade = (0.93 + 0.07 * face) * (1 + nFine * 0.06 + nMid * 0.08);
        r = b.rgb[0] * shade; g = b.rgb[1] * shade; bl = b.rgb[2] * shade;
        // a few blocks carry old stains / lichen-ish mottling
        if (b.stain > 0.72) { const s = smooth((nMid + 0.1) * 3) * dirt; r *= 1 - s * 0.35; g *= 1 - s * 0.33; bl *= 1 - s * 0.38; }
      }
      const k = i * 4;
      col[k] = clamp(r, 0, 255); col[k + 1] = clamp(g, 0, 255); col[k + 2] = clamp(bl, 0, 255); col[k + 3] = 255;
      const ro = isJoint ? 0.97 : stoneRough + nFine * 0.08 - face * 0.04;
      rough[k] = rough[k + 1] = rough[k + 2] = clamp(ro, 0, 1) * 255; rough[k + 3] = 255;
    }
  }
  return {
    map: dataTex(col, size, true),
    normalMap: normalMap(hgt, size, 2.2),
    roughnessMap: dataTex(rough, size, false),
    meters,
  };
}

// ── large-scale grime: R blotches, G vertical streaks, B speckle (tileable, linear) ─────────────────────────
export function grime(size = 512) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const a = N.fbm2(u * 4, v * 4, 5, 2, 0.55, 4, 4) * 0.5 + 0.5;
    const s = N2.fbm2(u * 24, v * 2, 4, 2, 0.5, 24, 2) * 0.5 + 0.5;
    const p = N.fbm2(u * 64, v * 64, 2, 2, 0.5, 64, 64) * 0.5 + 0.5;
    const i = (y * size + x) * 4;
    d[i] = a * 255; d[i + 1] = s * 255; d[i + 2] = p * 255; d[i + 3] = 255;
  }
  return dataTex(d, size, false);
}

// ── rock: limestone boulders and cliffs ───────────────────────────────────────────────────────────────────
export function rock(size = 512) {
  const col = new Uint8Array(size * size * 4), h = new Float32Array(size * size), ro = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * 4, v = y / size * 4;
    const r1 = N.ridge2(u * 2, v * 2, 5, 8, 8);
    const f = N2.fbm2(u * 3, v * 3, 5, 2, 0.5, 12, 12);
    const fine = N.fbm2(u * 16, v * 16, 3, 2, 0.5, 64, 64);
    const hh = r1 * 0.6 + f * 0.3 + fine * 0.1;
    const i = y * size + x; h[i] = hh;
    const cr = Math.pow(clamp(1 - r1 * 1.05), 3);         // cracks darker
    const base = 0.62 + f * 0.18 + fine * 0.08 - cr * 0.35;
    const k = i * 4;
    col[k] = clamp(196 * base + 12, 0, 255); col[k + 1] = clamp(184 * base + 8, 0, 255); col[k + 2] = clamp(164 * base, 0, 255); col[k + 3] = 255;
    ro[k] = ro[k + 1] = ro[k + 2] = clamp(0.86 + fine * 0.1, 0, 1) * 255; ro[k + 3] = 255;
  }
  return { map: dataTex(col, size, true), normalMap: normalMap(h, size, 5.0), roughnessMap: dataTex(ro, size, false) };
}

// ── ground: sand, packed earth, scrub ─────────────────────────────────────────────────────────────────────
export function ground(size = 512) {
  const col = new Uint8Array(size * size * 4), h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const f = N.fbm2(u * 8, v * 8, 5, 2, 0.5, 8, 8);
    const g = N2.fbm2(u * 48, v * 48, 3, 2, 0.5, 48, 48);
    const i = y * size + x; h[i] = f * 0.4 + g * 0.6;
    const t = 0.85 + f * 0.1 + g * 0.06;
    const k = i * 4;
    col[k] = clamp(222 * t, 0, 255); col[k + 1] = clamp(204 * t, 0, 255); col[k + 2] = clamp(168 * t, 0, 255); col[k + 3] = 255;
  }
  return { map: dataTex(col, size, true), normalMap: normalMap(h, size, 1.5) };
}

// ── planks: hull strakes / deck boards, `meters` square per tile, boards run along u ───────────────────────
export function planks({ size = 512, meters = 4, boardW = 0.22, tone = '#3A2A1E', tone2 = '#5A4330', seed = 5, pitch = 0.0 } = {}) {
  const R = rng(seed);
  const ppm = size / meters;
  const rows = Math.round(meters / boardW), rh = size / rows;
  const c1 = hexRGB(tone), c2 = hexRGB(tone2);
  const butt = [];
  for (let r = 0; r < rows; r++) { const n = []; let x = R() * size; for (let k = 0; k < 3; k++) { n.push(x % size); x += (1.2 + R() * 1.6) * ppm; } butt.push({ n, v: R() }); }
  const col = new Uint8Array(size * size * 4), h = new Float32Array(size * size), ro = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / rh), yIn = y - r * rh;
    const B = butt[r];
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const grain = N.fbm2(u * 2, v * 40 + r * 3.1, 4, 2, 0.5, 2, 40);
      const knot = N2.fbm2(u * 10, v * 10, 3, 2, 0.5, 10, 10);
      let seam = Math.min(yIn, rh - yIn) < 1.2 ? 1 : 0;
      for (const bx of B.n) { const dd = Math.abs(((x - bx + size * 1.5) % size) - size * 0.5); if (dd < 1.0) seam = 1; }
      const mixv = clamp(0.5 + grain * 0.8 + (B.v - 0.5) * 0.6);
      let rgb = [lerp(c1[0], c2[0], mixv), lerp(c1[1], c2[1], mixv), lerp(c1[2], c2[2], mixv)];
      const sh = seam ? 0.45 : 0.92 + knot * 0.12;
      const i = y * size + x, k = i * 4;
      col[k] = clamp(rgb[0] * sh, 0, 255); col[k + 1] = clamp(rgb[1] * sh, 0, 255); col[k + 2] = clamp(rgb[2] * sh, 0, 255); col[k + 3] = 255;
      h[i] = seam ? 0 : 0.8 + grain * 0.1;
      ro[k] = ro[k + 1] = ro[k + 2] = clamp(0.72 - pitch * 0.3 + grain * 0.1, 0, 1) * 255; ro[k + 3] = 255;
    }
  }
  return { map: dataTex(col, size, true), normalMap: normalMap(h, size, 1.6), roughnessMap: dataTex(ro, size, false), meters };
}

// ── sail: linen panels with the brailing grid, whole sail in UV 0..1 (not tiled) ───────────────────────────
export function sail(size = 1024, cellsU = 9, cellsV = 7) {
  const col = new Uint8Array(size * size * 4), h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const weave = N.fbm2(u * 180, v * 180, 2, 2, 0.5) * 0.5;
    const blot = N2.fbm2(u * 3, v * 3, 5);
    const panel = Math.abs(((u * 18) % 1) - 0.5) > 0.47 ? 1 : 0;          // sewn panel seams
    const gu = Math.abs(((u * cellsU) % 1) - 0.5) > 0.485 ? 1 : 0;        // leather strips / brail lines
    const gv = Math.abs(((v * cellsV) % 1) - 0.5) > 0.48 ? 1 : 0;
    const ring = (gu && gv) ? 1 : 0;
    let r = 232, g = 222, b = 200;
    const t = 0.93 + weave * 0.08 + blot * 0.06 - (1 - v) * 0.05;
    r *= t; g *= t; b *= t;
    if (panel) { r *= 0.9; g *= 0.9; b *= 0.88; }
    if (gu || gv) { r = r * 0.62 + 30; g = g * 0.55 + 20; b = b * 0.45 + 10; }
    if (ring) { r = 60; g = 48; b = 36; }
    const i = y * size + x, k = i * 4;
    col[k] = clamp(r, 0, 255); col[k + 1] = clamp(g, 0, 255); col[k + 2] = clamp(b, 0, 255); col[k + 3] = 255;
    h[i] = (gu || gv) ? 1 : panel ? 0.6 : 0.5 + weave * 0.1;
  }
  const map = dataTex(col, size, true, { clamp: true });
  return { map, normalMap: normalMap(h, size, 1.2, false) };
}

// ── stucco for the city ───────────────────────────────────────────────────────────────────────────────────
export function stucco(size = 256) {
  const col = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const f = N.fbm2(u * 6, v * 6, 5, 2, 0.5, 6, 6);
    const t = 0.9 + f * 0.1;
    const k = (y * size + x) * 4;
    col[k] = 235 * t; col[k + 1] = 228 * t; col[k + 2] = 214 * t; col[k + 3] = 255;
  }
  return dataTex(col, size, true);
}

// ── detail normals for the sea (tileable) ─────────────────────────────────────────────────────────────────
export function waterNormals(size = 512) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // sharp-crested capillary pattern: 1 - |noise| summed
    let s = 0, a = 1, f = 4, n = 0;
    for (let o = 0; o < 5; o++) { s += a * (1 - Math.abs(N.noise2(u * f, v * f, f, f))); n += a; a *= 0.5; f *= 2; }
    h[y * size + x] = s / n + N2.fbm2(u * 6, v * 6, 3, 2, 0.5, 6, 6) * 0.35;
  }
  return normalMap(h, size, 3.0);
}

// ── foam pattern (linear, tileable): R foam, G streaks ────────────────────────────────────────────────────
export function foam(size = 512) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let s = 0, a = 1, f = 6, n = 0;
    for (let o = 0; o < 4; o++) { s += a * Math.pow(1 - Math.abs(N2.noise2(u * f, v * f, f, f)), 3); n += a; a *= 0.55; f *= 2; }
    const blob = N.fbm2(u * 5, v * 5, 4, 2, 0.5, 5, 5) * 0.5 + 0.5;
    const k = (y * size + x) * 4;
    d[k] = clamp(s / n * 1.3) * 255; d[k + 1] = blob * 255; d[k + 2] = 0; d[k + 3] = 255;
  }
  return dataTex(d, size, false);
}

// ── moon albedo (clamped) ─────────────────────────────────────────────────────────────────────────────────
export function moon(size = 256) {
  const R = rng(99);
  const d = new Uint8Array(size * size * 4);
  const craters = [];
  for (let i = 0; i < 60; i++) craters.push([R(), R(), 0.01 + Math.pow(R(), 3) * 0.08]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const maria = smooth((N.fbm2(u * 2.2 + 3, v * 2.2 + 1, 5) + 0.05) * 2.5);
    let c = 0.78 - maria * 0.3 + N2.fbm2(u * 20, v * 20, 3) * 0.05;
    for (const [cx, cy, r] of craters) {
      const dd = Math.hypot(u - cx, v - cy) / r;
      if (dd < 1.25) c += dd < 0.85 ? -0.06 : (dd < 1.0 ? 0.08 : 0.03 * (1.25 - dd) * 4);
    }
    const k = (y * size + x) * 4;
    d[k] = d[k + 1] = clamp(c) * 255; d[k + 2] = clamp(c * 0.97) * 255; d[k + 3] = 255;
  }
  return dataTex(d, size, true, { clamp: true });
}
