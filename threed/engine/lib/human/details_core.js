// details_core.js — shared helpers of the insert-grade detail kit (details.js, E3 2026-09-27): house fonts on canvas,
// canvas textures (wood, linen, paper, relief normals, a studio reflection map), materials for macro framing (brass,
// gold, bronze, blued steel, enamel, glass, porcelain), the insert set (surface + backdrop + motivated light), placement
// on a room's desk (`on`), soft contact shadows and easing. No CATALOG here: details.js is the registered module.
import * as THREE from 'three';
import { patchMaterial } from '../shared/env.js';
import { rng as makeRng, clamp, lerp, smooth, smoother } from '../shared/util.js';
import { ground, xz, DEG, patchAll, yawFromHeading } from './common.js';

export const TAU = Math.PI * 2;
export { clamp, lerp, smooth, smoother, makeRng, DEG, patchAll, yawFromHeading, xz, ground };

// ── fonts: the engine's own files (engine/fonts), loaded once with their weight ranges (variable Garamond / Cinzel) ──
const FONT_FILES = [
  ['E3 Garamond', 'EB-Garamond.ttf', { weight: '400 800' }],
  ['E3 Garamond', 'EB-Garamond-Italic.ttf', { weight: '400 800', style: 'italic' }],
  ['E3 Cinzel', 'Cinzel.ttf', { weight: '400 900' }],
  ['E3 Courier', 'CourierPrime.ttf', { weight: '400' }],
  ['E3 Courier', 'CourierPrime-Bold.ttf', { weight: '700' }],
  ['E3 Elite', 'SpecialElite.ttf', {}],
  ['E3 Inter', 'Inter-SemiBold.ttf', { weight: '400 600' }],
  ['E3 Inter', 'Inter-Bold.ttf', { weight: '700' }],
  ['E3 Display', 'InterDisplay-Black.ttf', { weight: '900' }],
];
let FONTS_P = null;
export function loadFonts() {
  return (FONTS_P ||= Promise.all(FONT_FILES.map(async ([fam, file, d]) => {
    try { const f = new FontFace(fam, `url(${new URL('../../fonts/' + file, import.meta.url).href})`, d); await f.load(); document.fonts.add(f); }
    catch (e) { console.warn('details font', file, e); }
  })));
}
export const FAM = { serif: 'E3 Garamond', caps: 'E3 Cinzel', mono: 'E3 Courier', type: 'E3 Elite', sans: 'E3 Inter', black: 'E3 Display' };
export const font = (w, px, fam, italic = false) => `${italic ? 'italic ' : ''}${w} ${Math.max(1, px).toFixed(1)}px "${fam}", Georgia, serif`;

// ── canvas + textures ──────────────────────────────────────────────────────────────────────────────────────────────
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
export function ctex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 16;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}
const CACHE = {};
const keep = (v) => { if (v && (v.isTexture || v.isMaterial)) v.userData.keep = true; return v; };
export function cached(key, make) { if (!CACHE[key]) { CACHE[key] = make(); for (const v of Object.values(CACHE[key] || {})) keep(v); keep(CACHE[key]); } return CACHE[key]; }
export const hex = (c) => '#' + new THREE.Color(c).getHexString();
export function rgba(c, a) { const k = new THREE.Color(c); return `rgba(${Math.round(k.r * 255)},${Math.round(k.g * 255)},${Math.round(k.b * 255)},${a})`; }

// tangent-space normal map from a grey height canvas (white = high), OpenGL convention
export function normalFrom(src, strength = 2, invert = false) {
  const w = src.width, h = src.height, s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h), out = g.createImageData(w, h), d = out.data;
  const H = (x, y) => { x = x < 0 ? 0 : x >= w ? w - 1 : x; y = y < 0 ? 0 : y >= h ? h - 1 : y; const v = s[(y * w + x) * 4] / 255; return invert ? 1 - v : v; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), k = (y * w + x) * 4;
    d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (dy / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  g.putImageData(out, 0, 0); return ctex(c, false);
}

// wood grain along canvas x: long wavy streaks, colour bands and pores (mahogany, oak, teak deck with caulking)
export function woodTex(kind = 'mahogany') {
  return cached('wood:' + kind, () => {
    const P = {
      mahogany: { base: '#4A2216', dark: '#1E0C06', light: '#6A3420', seed: 3 },
      walnut: { base: '#3A2718', dark: '#160C06', light: '#5A3E28', seed: 5 },
      oak: { base: '#8A6440', dark: '#4A321C', light: '#A8825A', seed: 7 },
      teak: { base: '#8C6A45', dark: '#4E3620', light: '#A7845C', seed: 9, planks: 0.1 },
      panel: { base: '#3A2216', dark: '#150904', light: '#553020', seed: 11, panels: true },
    }[kind] || { base: '#4A2216', dark: '#1E0C06', light: '#6A3420', seed: 3 };
    const W = 2048, H = 2048, R = makeRng(P.seed);
    const [c, g] = canvas(W, H), [rc, rg] = canvas(1024, 1024);
    g.fillStyle = P.base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const y = R() * H, hh = 30 + R() * 160, col = R() < 0.55 ? P.dark : P.light;
      const gr = g.createLinearGradient(0, y - hh, 0, y + hh); gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.5, rgba(col, 0.18 + R() * 0.22)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(0, y - hh, W, hh * 2);
    }
    for (let i = 0; i < 900; i++) {
      const y0 = R() * H, amp = 2 + R() * 14, f = 0.0015 + R() * 0.004, ph = R() * TAU;
      g.strokeStyle = rgba(R() < 0.8 ? P.dark : P.light, 0.05 + R() * 0.2); g.lineWidth = 0.7 + R() * 2.2; g.beginPath();
      for (let x = -20; x <= W + 20; x += 18) { const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.3 + ph * 2) * amp * 0.25; if (x === -20) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 9000; i++) { g.fillStyle = rgba(P.dark, 0.18 + R() * 0.35); g.fillRect(R() * W, R() * H, 2 + R() * 7, 1 + R()); }
    if (P.planks) { const n = Math.round(1 / P.planks); for (let k = 0; k < n; k++) { const y = k * H / n; g.fillStyle = '#15100C'; g.fillRect(0, y, W, 7); g.fillStyle = 'rgba(255,240,210,0.08)'; g.fillRect(0, y + 7, W, 3); for (let j = 0; j < 3; j++) { const x = (R() + j) * W / 3; g.fillStyle = 'rgba(20,14,10,0.7)'; g.fillRect(x, y, 4, H / n); } } }
    if (P.panels) { for (let k = 0; k <= 4; k++) { const x = k * W / 4; g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x - 10, 0, 20, H); g.fillStyle = 'rgba(255,200,150,0.08)'; g.fillRect(x + 10, 0, 6, H); } }
    // roughness: varnish is smooth, the pores and caulking are rough
    rg.filter = 'blur(4px)'; rg.drawImage(c, 0, 0, 1024, 1024); rg.filter = 'none'; const id = rg.getImageData(0, 0, 1024, 1024), d = id.data;   // smooth: a sharp map made blocky streaks in the varnish highlight
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 765; const v = clamp(0.5 - l * 0.45, 0.25, 0.8) * 255; d[i] = d[i + 1] = d[i + 2] = v; }
    rg.putImageData(id, 0, 0);
    return { map: ctex(c, true, true), rough: ctex(rc, false, true) };
  });
}
// linen weave (tablecloth, napkins, book cloth): a fine thread texture + its relief
export function linenTex(tone = '#EFEBE1') {
  return cached('linen:' + tone, () => {
    const W = 1024, R = makeRng(21), [c, g] = canvas(W, W), [hc, hg] = canvas(W, W);
    g.fillStyle = tone; g.fillRect(0, 0, W, W); hg.fillStyle = '#808080'; hg.fillRect(0, 0, W, W);
    for (let i = 0; i < W; i += 4) {
      const a = 0.03 + R() * 0.07, w = 1.2 + R() * 1.6;
      g.fillStyle = `rgba(90,80,60,${a})`; g.fillRect(0, i, W, w); g.fillRect(i, 0, w, W);
      hg.fillStyle = `rgba(255,255,255,${0.25 + R() * 0.3})`; hg.fillRect(0, i + 1, W, 1.5); hg.fillStyle = `rgba(0,0,0,${0.2 + R() * 0.3})`; hg.fillRect(i, 0, 1.2, W);
    }
    for (let k = 0; k < 160; k++) { g.fillStyle = `rgba(120,105,80,${0.05 + R() * 0.08})`; const y = R() * W; g.fillRect(0, y, W, 1 + R() * 3); }
    return { map: ctex(c, true, true), normal: normalFrom(hc, 1.2) };
  });
}
// a studio reflection map (equirect) so brass, gold, glass and porcelain reflect a warm lamp or a cool window
export function studioEnv(mode = 'warm') {
  return cached('env:' + mode, () => {
    const W = 1024, H = 512, [c, g] = canvas(W, H);
    const cool = mode === 'cool';
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, cool ? '#10141C' : '#1C130C'); bg.addColorStop(0.5, cool ? '#1A1F28' : '#2A1C12'); bg.addColorStop(0.52, cool ? '#1A1C22' : '#3A2516'); bg.addColorStop(0.75, cool ? '#101216' : '#24170D'); bg.addColorStop(1, cool ? '#08090B' : '#100A06');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const soft = (x, y, w, h, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(w, h)); gr.addColorStop(0, rgba(col, a)); gr.addColorStop(0.45, rgba(col, a * 0.55)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fillRect(x - w * 1.2, y - h * 1.2, w * 2.4, h * 2.4); };
    if (cool) { soft(W * 0.72, H * 0.3, 150, 110, '#BFD4FF', 1); g.fillStyle = 'rgba(215,228,255,1)'; g.fillRect(W * 0.68, H * 0.18, 90, 120); soft(W * 0.2, H * 0.36, 90, 60, '#FFB870', 0.6); soft(W * 0.45, H * 0.3, 160, 60, '#8090B0', 0.4); }
    else { const wl = g.createLinearGradient(0, H * 0.1, 0, H * 0.5); wl.addColorStop(0, 'rgba(120,80,45,0.0)'); wl.addColorStop(1, 'rgba(150,100,55,0.55)'); g.fillStyle = wl; g.fillRect(0, H * 0.1, W, H * 0.4); soft(W * 0.36, H * 0.22, 190, 110, '#FFD49A', 1); g.fillStyle = 'rgba(255,230,190,1)'; g.fillRect(W * 0.31, H * 0.15, 110, 60); soft(W * 0.82, H * 0.33, 110, 80, '#9AA8C8', 0.5); soft(W * 0.08, H * 0.38, 90, 60, '#FFB060', 0.6); soft(W * 0.6, H * 0.3, 160, 60, '#E8B880', 0.45); }
    const t = ctex(c, true); t.mapping = THREE.EquirectangularReflectionMapping; return t;
  });
}

// ── materials ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function phys(o) { return patchMaterial(new THREE.MeshPhysicalMaterial(o)); }
export function std(o) { return patchMaterial(new THREE.MeshStandardMaterial(o)); }
const METAL = { brass: [0xD2A955, 0.26], brass_aged: [0xA98440, 0.36], gold: [0xF0C060, 0.17], rose: [0xE8A882, 0.2], bronze: [0xA0703A, 0.34], silver: [0xDCDCD6, 0.2], nickel: [0xC8C8C0, 0.24], steel: [0xAEB2B6, 0.3], blued: [0x24386E, 0.24], black_steel: [0x1A1A1C, 0.3], chrome: [0xE8EAEC, 0.08], tin: [0x9A9C98, 0.42] };
// smudges on polished metal: roughness varies a little (fingerprints, polish marks)
function smudge() {
  return cached('smudge', () => {
    const [c, g] = canvas(512, 512), R = makeRng(33); g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 140; i++) { const x = R() * 512, y = R() * 512, r = 6 + R() * 40, gr = g.createRadialGradient(x, y, 0, x, y, r); const v = R() < 0.5 ? 255 : 0; gr.addColorStop(0, `rgba(${v},${v},${v},${0.08 + R() * 0.12})`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 600; i++) { g.strokeStyle = `rgba(255,255,255,${0.03 + R() * 0.05})`; g.lineWidth = 0.6; g.beginPath(); const x = R() * 512, y = R() * 512, a = R() * TAU, l = 10 + R() * 60; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    return ctex(c, false, true);
  });
}
export function metal(name = 'brass', env, o = {}) {
  const [col, r] = METAL[name] || METAL.brass;
  return phys({ color: o.color ?? col, metalness: 1, roughness: o.roughness ?? r, roughnessMap: o.smudge === false ? null : smudge(), envMap: env || null, envMapIntensity: o.env ?? 1.15, clearcoat: o.clearcoat ?? 0, clearcoatRoughness: 0.1 });
}
export function glass(env, o = {}) {
  return phys({ color: o.color ?? 0xFFFFFF, metalness: 0, roughness: o.roughness ?? 0.02, transmission: 1, thickness: o.thickness ?? 0.002, ior: 1.5, envMap: env || null, envMapIntensity: o.env ?? 1.4, specularIntensity: 1, transparent: false, attenuationColor: new THREE.Color(o.tint ?? 0xF4FFF8), attenuationDistance: o.att ?? 0.5 });
}
export function porcelain(env, o = {}) { return phys({ color: o.color ?? 0xF7F5EE, roughness: o.roughness ?? 0.32, clearcoat: 1, clearcoatRoughness: 0.04, envMap: env || null, envMapIntensity: 0.9, vertexColors: !!o.vertexColors, map: o.map || null }); }
export function varnished(map, env, o = {}) { return phys({ map: map.map || map, roughnessMap: map.rough || null, roughness: o.roughness ?? 0.9, clearcoat: o.clearcoat ?? 0.7, clearcoatRoughness: o.ccr ?? 0.14, envMap: env || null, envMapIntensity: o.env ?? 0.6, color: o.color ?? 0xFFFFFF }); }

// ── geometry helpers ───────────────────────────────────────────────────────────────────────────────────────────────
export function mesh(g, m, parent, x = 0, y = 0, z = 0, cast = true) { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true; if (parent) parent.add(o); return o; }
export const lathe = (pts, seg = 64) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg);
export function roundRect(w, h, r) { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; }
// a flat plate lying in XZ (top face up, +Y), UVs 0..1 over its outline (canvas top = -Z = away from the reader)
export function plateGeo(w, d, t, r = 0, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(roundRect(w, d, Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4) || 1e-4), { depth: t, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);                                     // extrusion +Z -> +Y; shape y -> -Z
  g.computeBoundingBox(); const b = g.boundingBox, uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - b.min.x) / (b.max.x - b.min.x), (b.max.z - p.getZ(i)) / (b.max.z - b.min.z));
  g.translate(0, -b.min.y, 0); return g;
}
// a sheet (paper) lying flat, subdivided, with a gentle curl lifting the corners `curl` m and a soft wave
export function sheetGeo(w, d, curl = 0.003, seed = 1, n = 24) {
  const g = new THREE.PlaneGeometry(w, d, n, Math.max(4, Math.round(n * d / w))); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, R = makeRng(seed), ph = R() * TAU, k = [R(), R(), R(), R()];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2), z = p.getZ(i) / (d / 2);
    const corner = Math.pow(Math.max(0, Math.abs(x) * Math.abs(z)), 3) * (x > 0 ? (z > 0 ? k[0] : k[1]) : (z > 0 ? k[2] : k[3]));
    const edge = Math.pow(Math.max(Math.abs(x), Math.abs(z)), 6) * 0.3;
    p.setY(i, curl * (corner * 1.4 + edge) + curl * 0.15 * (0.5 + 0.5 * Math.sin(x * 2.2 + ph) * Math.cos(z * 1.7)));
  }
  g.computeVertexNormals(); return g;
}
// soft contact shadow on the surface (named contactShadow: the registry, DOF and QA skip it)
export function blob(parent, w, d, a = 0.5, x = 0, z = 0, y = 0.0006) {
  const t = cached('blob', () => { const [c, g] = canvas(128, 128); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(0.45, '#bbb'); gr.addColorStop(0.75, '#444'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return ctex(c, false); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, opacity: a, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.name = 'contactShadow'; m.position.set(x, y, z); m.renderOrder = 1; m.castShadow = m.receiveShadow = false; parent.add(m); return m;
}
export function tube(pts, r, m, seg = 64, radial = 8, closed = false) { const c = new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), closed, 'centripetal'); const o = new THREE.Mesh(new THREE.TubeGeometry(c, seg, r, radial, closed), m); o.castShadow = o.receiveShadow = true; return o; }   // shadows on: a cable outside the lamp's shadow glowed white
// twisted rope: a tube whose texture spirals (hemp / cotton), UV v wraps the tube
export function ropeMat(tone = '#C9B48A', env) {
  const t = cached('rope:' + tone, () => {
    const [c, g] = canvas(256, 64); g.fillStyle = tone; g.fillRect(0, 0, 256, 64);
    for (let i = -8; i < 24; i++) { g.strokeStyle = 'rgba(40,28,14,0.55)'; g.lineWidth = 3; g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + 32, 64); g.stroke(); g.strokeStyle = 'rgba(255,245,220,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(i * 16 + 7, 0); g.lineTo(i * 16 + 39, 64); g.stroke(); }
    return ctex(c, true, true);
  });
  // matte (Lambert): a 2-4 px smooth tube is all grazing angle, and a PBR Fresnel sheen turned black cables white
  const m = patchMaterial(new THREE.MeshLambertMaterial({ map: t })); m.userData.ropeTex = t; return m;
}
// a fresh texture + material per rope (no clone(): a cloned texture/material rendered the rope white)
export function ropeRepeat(meshO, len, r) { const src = meshO.material.map; const t = new THREE.CanvasTexture(src.image); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(len / (r * 5), 1); t.userData.keep = false; meshO.material = patchMaterial(new THREE.MeshLambertMaterial({ map: t })); return meshO; }

// ── easing / time ──────────────────────────────────────────────────────────────────────────────────────────────────
export const easeOutBack = (x, s = 1.2) => { x = clamp(x); const c = s + 1; return 1 + c * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };
export const damped = (t, f, k) => (t < 0 ? 0 : Math.exp(-k * t) * Math.sin(TAU * f * t));
export const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' && typeof v !== 'boolean' ? +v : d);
export const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
// smooth value noise in t (flicker, sway): deterministic
export function vnoise(t, seed = 0) { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1; }

// ── the insert set: surface + backdrop + motivated light, built around a prop whose root sits ON the surface ─────
// root local frame: y = 0 is the surface top, the reader / camera side is +Z (the prop's heading), the floor at -elev.
export const SURF = { desk: 0.76, table: 0.74, wood: 0.76, baize: 0.76, deck: 0, none: 0, floor: 0 };
export function buildSet(root, it, o = {}) {
  const surface = String(it.surface ?? o.surface ?? 'desk'), backdrop = String(it.backdrop ?? o.backdrop ?? 'dark'), light = String(it.light ?? o.light ?? 'warm');
  const elev = num(it.elev, SURF[surface] ?? 0.76);
  const env = studioEnv(light === 'cool' ? 'cool' : 'warm');
  const set = new THREE.Group(); set.name = 'detail_set'; root.add(set);
  const lights = [];
  const [W, D] = o.size || [1.5, 0.9];
  if (surface === 'desk' || surface === 'wood' || surface === 'baize') {
    const wt = woodTex(surface === 'wood' ? 'oak' : 'mahogany'), top = varnished(wt, env, { clearcoat: surface === 'wood' ? 0.35 : 0.8 });
    for (const t of [top.map, top.roughnessMap]) if (t) { t.repeat.set(W / 0.36, D / 0.36); }
    const slab = mesh(new THREE.BoxGeometry(W, 0.045, D), top, set, 0, -0.0225, 0); slab.name = 'detail_surface';
    const edge = mesh(new THREE.BoxGeometry(W + 0.02, 0.02, D + 0.02), top, set, 0, -0.055, 0); edge.name = 'detail_surface';
    if (surface === 'desk' || surface === 'baize') {             // a leather (or baize) writing inlay with a gilt tooled line
      const [c, g] = canvas(1024, 640), baize = surface === 'baize';
      g.fillStyle = baize ? '#1F4A2C' : '#26402C'; g.fillRect(0, 0, 1024, 640);
      const R = makeRng(4); for (let i = 0; i < 26000; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + R() * 0.05})`; g.fillRect(R() * 1024, R() * 640, 1 + R() * 2, 1 + R() * 2); }
      if (!baize) { g.strokeStyle = 'rgba(214,176,92,0.85)'; g.lineWidth = 3; g.strokeRect(22, 22, 980, 596); g.lineWidth = 1.2; g.strokeRect(34, 34, 956, 572); }
      const lm = phys({ map: ctex(c), roughness: baize ? 0.95 : 0.55, clearcoat: baize ? 0 : 0.25, clearcoatRoughness: 0.4, envMap: env, envMapIntensity: 0.4 });
      mesh(new THREE.BoxGeometry(W * 0.74, 0.0012, D * 0.66), lm, set, 0, 0.0006 - 0.0012, 0.03).name = 'detail_surface';
    }
    if (elev > 0.3) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(new THREE.BoxGeometry(0.06, elev - 0.065, 0.06), top, set, sx * (W / 2 - 0.08), -0.065 - (elev - 0.065) / 2, sz * (D / 2 - 0.08));
  } else if (surface === 'table') {                                  // white linen over a table: a draped cloth
    const L = linenTex('#E4DED0'), cloth = phys({ map: L.map, normalMap: L.normal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.92, sheen: 0.6, sheenColor: new THREE.Color(0xFFFFFF), sheenRoughness: 0.5 });
    L.map.repeat.set(W / 0.1, D / 0.1); L.normal.repeat.set(W / 0.1, D / 0.1);
    mesh(new THREE.BoxGeometry(W, 0.004, D), cloth, set, 0, -0.002, 0).name = 'detail_surface';
    const drop = Math.min(0.3, elev - 0.05);
    for (const [w, x, z, ry] of [[W, 0, D / 2, 0], [W, 0, -D / 2, Math.PI], [D, W / 2, 0, Math.PI / 2], [D, -W / 2, 0, -Math.PI / 2]]) {
      const g = new THREE.PlaneGeometry(w, drop, 32, 4), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const u = p.getX(i) / w, v = (p.getY(i) + drop / 2) / drop; p.setZ(i, 0.006 * Math.sin(u * 40) * (1 - v)); }
      g.computeVertexNormals(); const s = mesh(g, cloth, set, x, -drop / 2 - 0.004, z); s.rotation.y = ry;
    }
    mesh(new THREE.BoxGeometry(W - 0.02, 0.03, D - 0.02), std({ color: 0x3A2618, roughness: 0.6 }), set, 0, -0.02, 0, false);
    if (elev > 0.3) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(new THREE.CylinderGeometry(0.03, 0.025, elev - 0.04, 12), std({ color: 0x2A1A10, roughness: 0.5 }), set, sx * (W / 2 - 0.12), -(elev + 0.04) / 2, sz * (D / 2 - 0.12));
  } else if (surface === 'deck') {                                   // teak deck planks with black caulking (the floor)
    const wt = woodTex('teak'), dm = phys({ map: wt.map, roughnessMap: wt.rough, roughness: 1, envMap: env, envMapIntensity: 0.3 });
    wt.map.repeat.set(4 / 1.0, 4 / 1.0); wt.rough.repeat.set(4, 4);
    mesh(new THREE.BoxGeometry(4, 0.04, 4), dm, set, 0, -0.02, 0).name = 'detail_surface';
  }
  if (backdrop !== 'none' && backdrop !== 'false') {
    const bd = new THREE.Group(); bd.name = 'detail_backdrop'; bd.userData.noQA = true; bd.userData.ground = true; set.add(bd);
    const steel = backdrop === 'steel' || backdrop === 'white';
    let wm;
    if (steel) {
      const [c, g] = canvas(1024, 1024), R = makeRng(8); g.fillStyle = '#D9D3C4'; g.fillRect(0, 0, 1024, 1024);
      for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(80,70,50,${R() * 0.05})`; g.fillRect(R() * 1024, R() * 1024, 2 + R() * 30, 2 + R() * 30); }
      for (let k = 0; k < 4; k++) { const y = k * 256 + 20; g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y - 2, 1024, 4); for (let x = 16; x < 1024; x += 42) { const gr = g.createRadialGradient(x, y + 16, 1, x, y + 16, 9); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.6, 'rgba(120,110,90,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 10, y + 6, 20, 20); } }
      const t = ctex(c, true, true); t.repeat.set(1.5, 1.5); wm = std({ map: t, roughness: 0.55, envMap: env, envMapIntensity: 0.25 });
    } else { const wt = woodTex('panel'); const t = wt.map.clone(); t.needsUpdate = true; t.rotation = Math.PI / 2; t.repeat.set(1.2, 1.2); wm = std({ map: t, color: 0x9A8070, roughness: 0.55, envMap: env, envMapIntensity: 0.35 }); }
    const Hh = 2.9, fy = -elev, bz = num(it.back, o.back ?? -1.5), sx = 1.9, fz = 2.4;
    const wall = (w, h, x, y, z, ry) => { const m = mesh(new THREE.PlaneGeometry(w, h), wm, bd, x, y, z, true); m.rotation.y = ry; return m; };
    wall(sx * 2, Hh, 0, fy + Hh / 2, bz, 0); wall(sx * 2, Hh, 0, fy + Hh / 2, fz, Math.PI);
    wall(fz - bz, Hh, -sx, fy + Hh / 2, (fz + bz) / 2, Math.PI / 2); wall(fz - bz, Hh, sx, fy + Hh / 2, (fz + bz) / 2, -Math.PI / 2);
    const ceil = mesh(new THREE.PlaneGeometry(sx * 2, fz - bz), std({ color: steel ? 0xCFC8B8 : 0x2A1C14, roughness: 0.9 }), bd, 0, fy + Hh, (fz + bz) / 2); ceil.rotation.x = Math.PI / 2;
    if (surface !== 'deck') { const fl = mesh(new THREE.PlaneGeometry(sx * 2, fz - bz), std({ color: steel ? 0x3A3630 : 0x1A120C, roughness: 0.8 }), bd, 0, fy + 0.002, (fz + bz) / 2); fl.rotation.x = -Math.PI / 2; }
    if ((it.bokeh ?? o.bokeh ?? true) !== false) {                                        // two warm wall sconces far behind: soft bokeh discs in a macro shot
      const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(2.2) }); glow.userData.noGrade = true;
      for (const [x, y] of [[-0.95, 1.05], [0.75, 1.25]]) { const b = mesh(new THREE.SphereGeometry(0.035, 16, 10), glow, bd, x, fy + elev + y - 0.2, bz + 0.08, false); b.name = 'glow_sconce'; mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.07, 16, 1, true), std({ color: 0xE8D8B8, roughness: 0.7, side: THREE.DoubleSide, emissive: 0xFFB070, emissiveIntensity: 0.6 }), bd, x, fy + elev + y - 0.14, bz + 0.1, false).name = 'glow_shade'; }
    }
  }
  // motivated light: warm = a lamp just out of frame (upper left, in front); cool = a moonlit window / porthole from the
  // right-behind with a faint warm fill; both cast soft shadows. 'none' = the scene's own lights (a room's lamp).
  const lv = num(it.light_level, 1), aim = new THREE.Object3D(); aim.position.set(0, o.aimY ?? 0.03, 0); root.add(aim);
  const spot = (col, I, p, ang = 0.55, sh = true) => { const s = new THREE.SpotLight(col, I * lv, 6, ang, 0.85, 2); s.position.set(...p); s.target = aim; s.castShadow = sh; s.shadow.mapSize.set(1024, 1024); s.shadow.camera.near = 0.1; s.shadow.camera.far = 5; s.shadow.bias = -0.0004; s.shadow.normalBias = 0.004; s.shadow.radius = 5; s.name = 'detail_light'; root.add(s); lights.push(s); return s; };
  const pt = (col, I, p) => { const l = new THREE.PointLight(col, I * lv, 4, 2); l.position.set(...p); l.name = 'detail_fill'; root.add(l); lights.push(l); return l; };
  const S = o.scale ?? 1;
  const kp = o.key ? o.key.map((v) => v * S) : null;   // round 2: wall faces take a frontal-high key (a side key threw the bezel's shadow across the dial)
  if (light === 'warm') { spot(0xFFB36A, 30 * S * S, kp || [-0.75 * S, 0.95 * S, 0.55 * S]); pt(0xFFD2A0, 1.6 * S * S, [0.9 * S, 0.45 * S, 1.1 * S]); pt(0x8FA2C8, 0.6 * S * S, [0.4 * S, 0.8 * S, -1.0 * S]); }
  else if (light === 'cool') { spot(0xAFC8FF, 34 * S * S, [0.95 * S, 0.8 * S, -0.45 * S], 0.6); pt(0xB8C8E8, 1.3 * S * S, [-0.6 * S, 0.6 * S, 1.2 * S]); pt(0xFFB070, 0.45 * S * S, [-1.0 * S, 0.4 * S, -0.3 * S]); }
  else if (light === 'top') { spot(0xFFE8C8, 40 * S * S, [0.1 * S, 1.3 * S, 0.25 * S], 0.6); pt(0xFFD2A0, 1.2 * S * S, [0.8 * S, 0.5 * S, 1.0 * S]); }
  return { set, lights, env, elev, surface, backdrop, light };
}

// ── placement: at [x, z] + elev, or `on` a room's desk: 'structures:N.desk' | 'desk' (resolved after the room is built) ─
export function makeRoot(kind, it, ctx, elev) {
  const G = ground(ctx), at = xz(it.at);
  const root = new THREE.Group(); root.name = kind;
  const wl = ctx?.water?.level;   // at sea the set stands on the surface (elev = height above it), not on the seabed
  root.position.set(at[0], Math.max(G.h(at[0], at[1]), Number.isFinite(wl) ? wl : -Infinity) + elev, at[1]);
  root.rotation.y = yawFromHeading(num(it.heading, 0));
  return root;
}
const DESK_TOP = { desk: 0.785, table: 0.79, map_table: 0.8 };
export function onResolver(root, it, ctx) {
  const onKey = typeof it.place_on === 'string' ? it.place_on : it.on;   // place_on = the same, without E2's aboard.js 'not a deck point' warning
  if (onKey == null || typeof onKey !== 'string') return null;
  const m = /^(?:structures:(\d+)\.)?([A-Za-z_]\w*)$/.exec(onKey.trim());
  const idx = m && m[1] != null ? +m[1] : 0, name = m ? m[2] : 'desk', off = Array.isArray(it.offset) ? it.offset.map(Number) : [0.15, 0.12];
  let done = false, tries = 0;
  return () => {
    if (done || tries > 4) return; tries++;
    const stage = ctx.scene; if (!stage) return;
    const rooms = stage.children.filter((c) => /^interior\.|^landmark\./.test(c.name || ''));
    const pick = rooms[idx] || rooms[0];
    let tgt = null; (pick || stage).traverse((o) => { if (!tgt && o.name === name && o !== root) tgt = o; });
    if (!tgt) { if (tries > 2) { done = true; (ctx.warnings || []).push(`${root.name}: on '${onKey}' not found (no '${name}' in the scene); left at its 'at'`); } return; }
    done = true; tgt.updateWorldMatrix(true, false);
    const y = DESK_TOP[name] ?? (() => { const b = new THREE.Box3().setFromObject(tgt); return b.max.y - tgt.getWorldPosition(new THREE.Vector3()).y; })();
    const p = new THREE.Vector3(off[0], y + num(it.lift, 0), off[1] ?? 0).applyMatrix4(tgt.matrixWorld);
    root.position.copy(p);
    root.updateMatrixWorld(true);
  };
}

// ══ E3 round 2: an insert fits itself to the shot and meters its own light ═════════════════════════════════════════
// The director writes inserts like wide shots (a camera 0.5-1 m off at eye level, `target: objects:N`, any heading).
// fitInsert (build time, before the camera plan, from ctx.spec.camera keys): turn the readable face to the lens,
// prop a flat watch up when the camera is low, scale documents / move small props along the look line so the readable
// part fills ~50 % of the frame (never nearer than 0.33 m: the focus limit), snap onto a room's desk inside interiors.
// meter (first frame with a camera): render the shot, read the readable face, scale the prop's own lights so the face
// lands at luma ~170 (never clipped), and record `detail_unreadable:` when it is < 25 % of the frame or outside 80-235.
export function shotCamera(ctx, index) {
  const c = ctx.spec?.camera; if (!c || c.move !== 'keys' || !Array.isArray(c.keys) || !c.keys.length) return null;
  const G = ground(ctx);
  const xyz = (a, h) => (a.length === 3 ? a.map(Number) : [+a[0], G.h(+a[0], +a[1]) + h, +a[1]]);
  const K = c.keys.map((k) => ({ pos: Array.isArray(k.pos) ? xyz(k.pos, 0) : xyz(k.at || [0, 0], num(k.alt, 2)), look: Array.isArray(k.look) ? xyz(k.look, 0) : Array.isArray(k.look_at) ? xyz(k.look_at, num(k.look_h, 1.5)) : null, fov: clamp(num(k.fov, num(c.fov, 40)), 12, 90) }));
  const a = K[0], b = K[K.length - 1], mid = (u, v) => (u && v ? u.map((x, i) => (x + v[i]) / 2) : u || v);
  return { C: mid(a.pos, b.pos), L: mid(a.look, b.look), fov: (a.fov + b.fov) / 2, K, target: c.target };
}
const V = (a) => new THREE.Vector3(...a);
// the study / office desk of an interior.* in the spec, in world space (interiors.js room(): desk at (0.3, -0.6), top 0.785)
function specDesks(ctx) {
  const out = [];
  for (const e of ctx.spec?.structures || []) {
    if (!/^interior\.(study|office)$/.test(String(e?.kind))) continue;
    const at = xz(e.at), yaw = yawFromHeading(num(e.heading, 0)) - Math.PI, c = Math.cos(yaw), s = Math.sin(yaw);
    out.push({ x: at[0] + 0.3 * c + -0.6 * s, z: at[1] - 0.3 * s + -0.6 * c, yaw, top: ground(ctx).h(at[0], at[1]) + 0.785 });
  }
  return out;
}
export const inInterior = (ctx) => (ctx.spec?.structures || []).some((e) => /^interior\./.test(String(e?.kind)));
// face: { anchor (Object3D under root), size [w, h] m, flat (reads from above), scale: [min, max] + setScale(s),
//         movable, tilt(deg) for a flat thing that can stand up (the watch), docs (lies on a desk's paper stack) }
export function fitInsert(root, it, ctx, face) {
  const notes = [];
  if (!face || !face.anchor || it.fit === false) return notes;
  const cam = shotCamera(ctx, it.index);
  if (!cam || !cam.C) return notes;
  root.updateMatrixWorld(true);
  const F = face.anchor.getWorldPosition(new THREE.Vector3()), R0 = root.position.clone();
  const L = cam.L ? V(cam.L) : F.clone();
  const mine = cam.target === `objects:${it.index}` || Math.hypot(L.x - F.x, L.z - F.z) < 0.8;
  if (!mine) return notes;
  // 1. inside a room: stand on its desk when over it (documents on top of the desk's paper stack)
  if (inInterior(ctx)) {
    for (const d of specDesks(ctx)) {
      const c = Math.cos(d.yaw), s = Math.sin(d.yaw), dx = R0.x - d.x, dz = R0.z - d.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < 0.85 && Math.abs(lz) < 0.45) { root.position.y = d.top + (face.docs ? 0.028 : 0.0005); notes.push(`on the room's desk top (${root.position.y.toFixed(3)} m)`); break; }
    }
  }
  // 1b. the readable centre goes where the director looks (a look point on the surface, within 0.8 m)
  if (cam.L) { root.updateMatrixWorld(true); const Fh = face.anchor.getWorldPosition(new THREE.Vector3()), dx = L.x - Fh.x, dz = L.z - Fh.z; if (Math.hypot(dx, dz) > 0.02 && Math.hypot(dx, dz) < 0.8 && Math.abs(L.y - Fh.y) < 0.35) { root.position.x += dx; root.position.z += dz; notes.push(`centred under the look point (${Math.hypot(dx, dz).toFixed(2)} m)`); } }
  // 2. turn: the reader side (+Z) toward the camera, about the readable face
  root.updateMatrixWorld(true);
  const Fw = face.anchor.getWorldPosition(new THREE.Vector3()), C = V(cam.C);
  if (it.face_camera !== false) {
    const off = Fw.clone().sub(root.position), yaw0 = root.rotation.y, yaw = Math.atan2(C.x - Fw.x, C.z - Fw.z);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw - yaw0);
    root.rotation.y = yaw; root.position.copy(Fw).sub(off); root.updateMatrixWorld(true);
    notes.push(`turned to the camera (${((yaw - yaw0) / DEG).toFixed(0)}°)`);
  }
  // 3. a flat face under a low camera stands up (the watch on its stand)
  const Fc = face.anchor.getWorldPosition(new THREE.Vector3());
  const elev = Math.atan2(C.y - Fc.y, Math.hypot(C.x - Fc.x, C.z - Fc.z)) / DEG;
  if (face.flat && face.tilt && elev < 55) { const tl = clamp(90 - elev - 4, 0, 72); face.tilt(tl); root.updateMatrixWorld(true); const up = face.anchor.getWorldPosition(new THREE.Vector3()).sub(Fc); root.position.sub(up); root.updateMatrixWorld(true); notes.push(`stood up ${tl.toFixed(0)}° for a ${elev.toFixed(0)}° camera`); }   // the face stays on the look line
  // 4. size in frame: documents scale, small props move along the look line (focus >= 0.33 m from every key)
  const fovR = cam.fov * DEG, Fa = face.anchor.getWorldPosition(new THREE.Vector3());
  const frac = (d, s) => Math.max(face.size[1] * s / (2 * d * Math.tan(fovR / 2)), face.size[0] * s / (2 * d * Math.tan(fovR / 2) * 16 / 9));
  let d = C.distanceTo(Fa), sc = 1;
  if (face.scale && face.setScale) { sc = clamp(0.5 / Math.max(1e-4, frac(d, 1)), face.scale[0], face.scale[1]); if (Math.abs(sc - 1) > 0.02) { face.setScale(sc); notes.push(`scaled x${sc.toFixed(2)}`); } }
  if (face.movable && !inInterior(ctx)) {
    const want = frac(d, sc) < 0.4 ? d * frac(d, sc) / 0.5 : frac(d, sc) > 0.7 ? Math.min(d + 0.5, d * frac(d, sc) / 0.55) : d;
    let dn = Math.max(0.33, want);
    const P = (dd) => C.clone().add(Fa.clone().sub(C).setLength(dd));
    for (let k = 0; k < 40 && cam.K.some((q) => V(q.pos).distanceTo(P(dn)) < 0.33); k++) dn += 0.01;
    if (Math.abs(dn - d) > 0.02) { const mv = P(dn).sub(Fa); root.position.add(mv); root.updateMatrixWorld(true); notes.push(`moved ${mv.length().toFixed(2)} m along the look line (lens ${dn.toFixed(2)} m)`); d = dn; }
  }
  notes.push(`readable face ~${Math.round(frac(d, sc) * 100)} % of the frame`);
  return notes;
}
// the meter: one float render of the shot at its first camera; the prop's own lights scale so the face sits at ~170
const aces = (x) => clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1);
const srgb8 = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
export function makeMeter(root, ctx, res, face, own) {
  let done = false;
  return (camera) => {
    if (done || !camera || !ctx.renderer || !ctx.world3 || typeof window === 'undefined' || !window.__f3d) return;
    done = true;
    const r = ctx.renderer, W = 240, H = 135;
    try {
      const X = Math.max(0.02, window.__f3d.look().grade(ctx.lookSpec || {}, {}).exposure);
      const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
      root.updateMatrixWorld(true); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      // the face rectangle on screen
      const a = face.anchor, pts = [], hw = face.size[0] / 2, hh = face.size[1] / 2;
      const axes = face.flat ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];   // in the anchor's own frame (it tilts with a stood-up watch)
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const p = new THREE.Vector3(axes[0][0] * sx * hw + axes[1][0] * sy * hh, axes[0][1] * sx * hw + axes[1][1] * sy * hh, axes[0][2] * sx * hw + axes[1][2] * sy * hh); a.localToWorld(p); pts.push(p.project(camera)); }
      const x0 = clamp(Math.min(...pts.map((p) => p.x)), -1, 1), x1 = clamp(Math.max(...pts.map((p) => p.x)), -1, 1), y0 = clamp(Math.min(...pts.map((p) => p.y)), -1, 1), y1 = clamp(Math.max(...pts.map((p) => p.y)), -1, 1);
      const fracH = Math.max((y1 - y0) / 2, (x1 - x0) / 2);
      const ix0 = Math.floor((x0 * 0.5 + 0.5) * W + (x1 - x0) * 0.5 * W * 0.15), ix1 = Math.ceil((x1 * 0.5 + 0.5) * W - (x1 - x0) * 0.5 * W * 0.15);
      const iy0 = Math.floor((y0 * 0.5 + 0.5) * H + (y1 - y0) * 0.5 * H * 0.15), iy1 = Math.ceil((y1 * 0.5 + 0.5) * H - (y1 - y0) * 0.5 * H * 0.15);
      const rw = Math.max(1, ix1 - ix0), rh = Math.max(1, iy1 - iy0), buf = new Float32Array(rw * rh * 4);
      const read = () => {
        const prev = r.getRenderTarget(); r.setRenderTarget(rt); r.clear(); r.render(ctx.world3, camera); r.readRenderTargetPixels(rt, ix0, iy0, rw, rh, buf); r.setRenderTarget(prev);
        const Y = []; for (let i = 0; i < rw * rh; i++) Y.push(0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]);
        Y.sort((u, v) => u - v); return { mean: Y.reduce((s, v) => s + v, 0) / Y.length, p95: Y[Math.floor(Y.length * 0.95)] };
      };
      const disp = (y) => srgb8(aces(y * X));
      const base = own.map((l) => l.intensity);
      const m1 = read();
      own.forEach((l) => { l.intensity = 0; }); const m0 = read(); own.forEach((l, i) => { l.intensity = base[i]; });
      // target: face mean -> luma 170 (linear exposed ~0.27); highlights (p95) under luma ~235
      const tgt = 0.27 / X, mineY = Math.max(1e-6, m1.mean - m0.mean);
      let k = own.length ? clamp((tgt - m0.mean) / mineY, 0.03, 6) : 1;
      if (own.length) { const p95 = m0.p95 + (m1.p95 - m0.p95) * k; if (disp(p95) > 235) k *= clamp((0.62 / X - m0.p95) / Math.max(1e-6, (m1.p95 - m0.p95) * k), 0.3, 1); }
      own.forEach((l, i) => { l.intensity = base[i] * k; l.userData.e3base = l.intensity; });
      const m2 = read(), luma = disp(m2.mean), hi = disp(m2.p95);
      rt.dispose();
      res.e3Meter = { exposure: +X.toFixed(3), before: Math.round(disp(m1.mean)), after: Math.round(luma), p95: Math.round(hi), k: +k.toFixed(3), frame: Math.round(fracH * 100) };
      const bad = [];
      if (fracH < 0.25) bad.push(`its readable face is ${Math.round(fracH * 100)} % of the frame (< 25 %)`);
      if (luma < 80) bad.push(`face luma ${Math.round(luma)} (< 80)`); if (luma > 235 || hi > 250) bad.push(`face luma ${Math.round(luma)}, highlights ${Math.round(hi)} (clipped)`);
      const tag = `objects:${res.index ?? '?'} ${root.name}`;
      (ctx.warnings || []).push(`${tag}: metered at t=0: face luma ${res.e3Meter.before} -> ${res.e3Meter.after} (own light x${res.e3Meter.k}), ${res.e3Meter.frame} % of the frame`);
      if (bad.length) { const s = `detail_unreadable: ${tag} ${bad.join('; ')}`; res.e3Issues.push(s); (ctx.warnings || []).push(s); }
    } catch (e) { (ctx.warnings || []).push(`${root.name}: meter failed (${String(e).slice(0, 120)})`); }
  };
}
