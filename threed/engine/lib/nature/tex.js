// tex.js — procedural textures for the nature library, painted once per page and cached (no files, no requests).
// Colour maps are sRGB DataTextures; normal / data maps are linear. All tile (RepeatWrapping).
import * as THREE from 'three';
import { rng, makeNoise, clamp } from '../shared/util.js';

const N = makeNoise(7), N2 = makeNoise(31), N3 = makeNoise(113);
const CACHE = {};
const once = (k, fn) => CACHE[k] || (CACHE[k] = fn());

export function dataTex(data, size, srgb, opts = {}) {
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

function normalMap(h, size, strength) {
  const d = new Uint8Array(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  return dataTex(d, size, false);
}

// grime / breakup: R big blotches, G streaks, B fine pores, A mid-scale cells (all tile)
export const grime = () => once('grime', () => {
  const size = 512, d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const a = N.fbm2(u * 4, v * 4, 5, 2, 0.55, 4, 4) * 0.5 + 0.5;
    const s = N2.fbm2(u * 24, v * 2, 4, 2, 0.5, 24, 2) * 0.5 + 0.5;
    const p = N.fbm2(u * 64, v * 64, 2, 2, 0.5, 64, 64) * 0.5 + 0.5;
    const c = N3.fbm2(u * 12, v * 12, 3, 2, 0.5, 12, 12) * 0.5 + 0.5;
    const i = (y * size + x) * 4;
    d[i] = clamp(a) * 255; d[i + 1] = clamp(s) * 255; d[i + 2] = clamp(p) * 255; d[i + 3] = clamp(c) * 255;
  }
  return dataTex(d, size, false);
});

// rock: neutral-grey fractured stone (tinted per biome in the shader); map + normal
export const rock = () => once('rock', () => {
  const size = 512, col = new Uint8Array(size * size * 4), h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * 4, v = y / size * 4;
    const r1 = N.ridge2(u * 2, v * 2, 5, 8, 8);
    const f = N2.fbm2(u * 3, v * 3, 5, 2, 0.5, 12, 12);
    const fine = N.fbm2(u * 16, v * 16, 3, 2, 0.5, 64, 64);
    const strata = Math.sin(v * 38 + N3.fbm2(u * 2, v * 2, 3, 2, 0.5, 8, 8) * 5) * 0.5 + 0.5;
    const hh = r1 * 0.55 + f * 0.3 + fine * 0.1 + strata * 0.05;
    const i = y * size + x; h[i] = hh;
    const cr = Math.pow(clamp(1 - r1 * 1.05), 3);
    const base = 0.66 + f * 0.2 + fine * 0.08 - cr * 0.4 + (strata - 0.5) * 0.06;
    const k = i * 4;
    col[k] = clamp(200 * base + 10, 0, 255); col[k + 1] = clamp(196 * base + 8, 0, 255); col[k + 2] = clamp(190 * base + 6, 0, 255); col[k + 3] = 255;
  }
  return { map: dataTex(col, size, true), normalMap: normalMap(h, size, 5.0) };
});

// ground detail: neutral soil / litter / pebbles (luminance around 0.75, tinted in the shader); map + normal
export const soil = () => once('soil', () => {
  const size = 512, col = new Uint8Array(size * size * 4), h = new Float32Array(size * size);
  const R = rng(9);
  const peb = [];
  for (let i = 0; i < 900; i++) peb.push([R(), R(), 0.002 + Math.pow(R(), 3) * 0.012]);
  const grid = new Map();
  for (const p of peb) { const k = Math.floor(p[0] * 32) + ',' + Math.floor(p[1] * 32); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const f = N.fbm2(u * 8, v * 8, 5, 2, 0.5, 8, 8);
    const g = N2.fbm2(u * 48, v * 48, 3, 2, 0.5, 48, 48);
    let pb = 0;
    const cx = Math.floor(u * 32), cy = Math.floor(v * 32);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const L = grid.get(((cx + ox + 32) % 32) + ',' + ((cy + oy + 32) % 32)); if (!L) continue;
      for (const p of L) {
        let dx = u - p[0], dy = v - p[1]; dx -= Math.round(dx); dy -= Math.round(dy);
        const d = Math.hypot(dx, dy) / p[2]; if (d < 1) pb = Math.max(pb, Math.sqrt(1 - d * d));
      }
    }
    const i = y * size + x; h[i] = f * 0.35 + g * 0.45 + pb * 0.8;
    const t = 0.74 + f * 0.12 + g * 0.08 + pb * 0.1;
    const k = i * 4;
    col[k] = clamp(255 * t, 0, 255); col[k + 1] = clamp(250 * t, 0, 255); col[k + 2] = clamp(242 * t, 0, 255); col[k + 3] = 255;
  }
  return { map: dataTex(col, size, true), normalMap: normalMap(h, size, 2.2) };
});

// water surface normals (sharp-crested capillaries) and foam (R foam, G blobs)
export const waterNormals = () => once('waterN', () => {
  const size = 512, h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let s = 0, a = 1, f = 4, n = 0;
    for (let o = 0; o < 5; o++) { s += a * (1 - Math.abs(N.noise2(u * f, v * f, f, f))); n += a; a *= 0.5; f *= 2; }
    h[y * size + x] = s / n + N2.fbm2(u * 6, v * 6, 3, 2, 0.5, 6, 6) * 0.35;
  }
  return normalMap(h, size, 3.0);
});
export const foam = () => once('foam', () => {
  const size = 512, d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let s = 0, a = 1, f = 6, n = 0;
    for (let o = 0; o < 4; o++) { s += a * Math.pow(1 - Math.abs(N2.noise2(u * f, v * f, f, f)), 3); n += a; a *= 0.55; f *= 2; }
    const blob = N.fbm2(u * 5, v * 5, 4, 2, 0.5, 5, 5) * 0.5 + 0.5;
    const k = (y * size + x) * 4;
    d[k] = clamp(s / n * 1.3) * 255; d[k + 1] = blob * 255; d[k + 2] = 0; d[k + 3] = 255;
  }
  return dataTex(d, size, false);
});

// moon albedo (clamped) for the sky moon and small moons
export const moonAlbedo = () => once('moon', () => {
  const R = rng(99), size = 512;
  const d = new Uint8Array(size * size * 4);
  const craters = [];
  for (let i = 0; i < 140; i++) craters.push([R(), R(), 0.006 + Math.pow(R(), 3) * 0.07]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const maria = Math.max(0, Math.min(1, (N.fbm2(u * 2.2 + 3, v * 2.2 + 1, 5) + 0.05) * 2.5));
    let c = 0.78 - maria * 0.3 + N2.fbm2(u * 20, v * 20, 3) * 0.05;
    for (const [cx, cy, r] of craters) {
      const dd = Math.hypot(u - cx, v - cy) / r;
      if (dd < 1.25) c += dd < 0.85 ? -0.05 : (dd < 1.0 ? 0.08 : 0.03 * (1.25 - dd) * 4);
    }
    const k = (y * size + x) * 4;
    d[k] = d[k + 1] = clamp(c) * 255; d[k + 2] = clamp(c * 0.97) * 255; d[k + 3] = 255;
  }
  return dataTex(d, size, true, { clamp: true });
});

// images shipped with the library (earth): loaded once, cached
const LOADER = { tex: null };
export function image(url, srgb = true) {
  return once('img:' + url, () => new Promise((res) => {
    const l = LOADER.tex || (LOADER.tex = new THREE.TextureLoader());
    l.load(url, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
      res(t);
    }, undefined, () => res(null));
  }));
}

// shared GLSL helpers (value noise, hashes) for the library's shaders
export const NOISE_GLSL = /* glsl */`
float n_h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n_h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float n_v2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(n_h12(i), n_h12(i+vec2(1,0)), u.x), mix(n_h12(i+vec2(0,1)), n_h12(i+vec2(1,1)), u.x), u.y); }
float n_v3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(n_h13(i), n_h13(i+vec3(1,0,0)), u.x), mix(n_h13(i+vec3(0,1,0)), n_h13(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(n_h13(i+vec3(0,0,1)), n_h13(i+vec3(1,0,1)), u.x), mix(n_h13(i+vec3(0,1,1)), n_h13(i+vec3(1,1,1)), u.x), u.y), u.z); }
float n_fbm2(vec2 p, int oct){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * n_v2(p); p = m * p; a *= 0.5; } return s; }
float n_fbm3(vec3 p, int oct){ float s = 0.0, a = 0.5; for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * n_v3(p); p = p * 2.03 + 0.17; a *= 0.5; } return s; }
vec3 n_bump(vec3 p, vec3 n, float h){
  vec3 dpx = dFdx(p), dpy = dFdy(p); float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx); float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - grad); }
`;
