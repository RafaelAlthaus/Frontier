// flora.js — every plant and rock of the nature library, instanced. Foliage is alpha-tested cards cut from one painted
// atlas (alpha to coverage), lit with crown-shaped normals and a translucency term so backlit crowns glow; conifers are
// solid whorls (snow on the upper faces in winter); rocks are displaced icosahedra with triplanar stone.
// Wind: a vertex sway keyed on height and instance position (deterministic in t). Near the lens every plant dissolves
// with a dither (no lens-through-leaves glitch). LOD: full geometry near the stage, lighter variants farther out; the
// far woods are the terrain's canopy shell (world.js).
//   scatterFlora(o) -> { update(t), clearance(x,y,z), count }       build(kind, item, ctx) for director-placed plants
import * as THREE from 'three';
import { rng, clamp, lerp, smooth, makeNoise, lin } from '../shared/util.js';
import { U, patchMaterial } from '../shared/env.js';
import * as TX from './tex.js';
import { NOISE_GLSL } from './tex.js';

const TAU = Math.PI * 2;
const NZ = makeNoise(314);
const sr = (x, a, b) => smooth((x - a) / (b - a));
const nrm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const FU = { uTime: { value: 0 }, uWind: { value: 0.4 }, uSnowAmt: { value: 0 }, uWDir: { value: new THREE.Vector2(0.8, 0.6) } };
const setWindDir = (ctx) => { const w = ctx?.wind; if (w && Math.hypot(w.x, w.z) > 1e-3) FU.uWDir.value.set(w.x, w.z).normalize(); };

export const CATALOG = {
  'flora.conifer': { desc: 'spruce / fir, 18-28 m, snow-laden in winter', actions: ['idle'], params: { scale: 1 }, footprint: [6, 6], height: 22, tags: ['tree', 'modern'] },
  'flora.deciduous': { desc: 'oak/beech-like broad crown, seasonal (spring, summer, autumn colours, bare in winter)', actions: ['idle'], params: { scale: 1 }, footprint: [10, 10], height: 16, tags: ['tree', 'modern'] },
  'flora.broadleaf': { desc: 'tropical rainforest giant with an umbrella crown', actions: ['idle'], params: { scale: 1 }, footprint: [14, 14], height: 30, tags: ['tree', 'jungle'] },
  'flora.palm': { desc: 'coconut / date palm with arching fronds', actions: ['idle'], params: { scale: 1 }, footprint: [7, 7], height: 12, tags: ['tree', 'tropical', 'desert'] },
  'flora.cycad': { desc: 'cycad: squat scaly trunk, rosette of stiff pinnate leaves (Mesozoic)', actions: ['idle'], params: {}, footprint: [3, 3], height: 2.5, tags: ['plant', 'prehistoric'] },
  'flora.treefern': { desc: 'tree fern: slender trunk, crown of arching fronds', actions: ['idle'], params: {}, footprint: [5, 5], height: 5, tags: ['plant', 'prehistoric', 'jungle'] },
  'flora.araucaria': { desc: 'araucaria: tall bare trunk, domed crown of rope-like branches (Mesozoic)', actions: ['idle'], params: {}, footprint: [10, 10], height: 32, tags: ['tree', 'prehistoric'] },
  'flora.sequoia': { desc: 'redwood-like conifer, drooping sprays (Mesozoic and modern)', actions: ['idle'], params: {}, footprint: [10, 10], height: 36, tags: ['tree', 'prehistoric'] },
  'flora.laurel': { desc: 'early flowering tree, rounded crown of broad leaves (Cretaceous)', actions: ['idle'], params: {}, footprint: [9, 9], height: 16, tags: ['tree', 'prehistoric'] },
  'flora.fern': { desc: 'ground fern clump', actions: ['idle'], params: {}, footprint: [1.5, 1.5], height: 1, tags: ['plant'] },
  'flora.horsetail': { desc: 'Equisetum stand on wet ground', actions: ['idle'], params: {}, footprint: [1, 1], height: 2, tags: ['plant', 'prehistoric'] },
  'flora.bush': { desc: 'leafy shrub / hedge plant', actions: ['idle'], params: {}, footprint: [3, 3], height: 2.2, tags: ['plant'] },
  'flora.cactus': { desc: 'saguaro or barrel cactus', actions: ['idle'], params: { type: 'saguaro' }, footprint: [2, 2], height: 8, tags: ['plant', 'desert'] },
  'flora.reeds': { desc: 'reed / cattail clump for river and lake margins', actions: ['idle'], params: {}, footprint: [1.5, 1.5], height: 2.2, tags: ['plant', 'water'] },
  'flora.grass': { desc: 'grass tuft (never in pre-Cenozoic scenes)', actions: ['idle'], params: {}, footprint: [0.6, 0.6], height: 0.6, tags: ['plant', 'modern'] },
  'rock.rock': { desc: 'weathered rock, 0.5-2 m', actions: ['idle'], params: { scale: 1 }, footprint: [1.5, 1.5], height: 1, tags: ['rock'] },
  'rock.boulder': { desc: 'large boulder, 2-6 m', actions: ['idle'], params: { scale: 1 }, footprint: [5, 5], height: 3.5, tags: ['rock'] },
};

// ── the atlas: 4 x 4 cells of 512 ───────────────────────────────────────────────────────────────────────────────
const CELL = { spray: 0, arau: 1, fern: 2, cycad: 3, leaf: 4, horse: 5, grass: 6, bark: 7, twig: 8, palm: 9, reed: 10, small: 11, tuft2: 12, pbark: 13, leaflet: 14, dune: 15 };
const AC = 4, AR = 4;
function cellUV(c) { const x = c % AC, y = Math.floor(c / AC); return [x / AC, 1 - (y + 1) / AR, (x + 1) / AC, 1 - y / AR]; }
let ATLAS = null;
function paintAtlas() {
  if (ATLAS) return ATLAS;
  const S = 512, cv = document.createElement('canvas'); cv.width = S * AC; cv.height = S * AR;
  const g = cv.getContext('2d');
  const r = rng(5), r2 = rng(71);                                    // r2: the palm, tuft, bark and leaflet cells (r keeps its old draws)
  const cell = (c, fn) => { g.save(); g.translate((c % AC) * S, Math.floor(c / AC) * S); g.beginPath(); g.rect(0, 0, S, S); g.clip(); fn(); g.restore(); };
  const green = (l, s = 1) => { const k = l * (0.85 + r() * 0.3); return `rgb(${Math.round(60 * k * s)},${Math.round(92 * k)},${Math.round(40 * k * s)})`; };
  const grey = (l) => { const k = Math.round(clamp(l * (0.85 + r() * 0.3), 0, 1) * 235); return `rgb(${k},${k},${Math.round(k * 0.94)})`; };
  cell(CELL.spray, () => {
    for (let b = 0; b < 7; b++) {
      const y0 = S / 2 + (b - 3) * 40 + r() * 20, x0 = 10 + b * 12;
      for (let i = 0; i < 70; i++) {
        const t = i / 70, x = x0 + t * (S - 40 - x0), y = y0 + Math.sin(t * 3) * 10 * (b - 3) / 3, L = 34 * (1 - t * 0.55);
        g.strokeStyle = green(0.9 + 0.3 * (1 - t)); g.lineWidth = 4.2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y - L); g.moveTo(x, y); g.lineTo(x + 6, y + L); g.stroke();
      }
      g.strokeStyle = 'rgb(70,56,38)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(S - 40, y0 + Math.sin(3) * 10 * (b - 3) / 3); g.stroke();
    }
  });
  cell(CELL.arau, () => {
    for (let b = 0; b < 9; b++) {
      const y0 = 60 + b * 48 + r() * 14;
      for (let i = 0; i < 120; i++) {
        const t = i / 120, x = 12 + t * (S - 30), y = y0 - Math.pow(t, 3) * 50 + Math.sin(t * 9 + b) * 4, rad = 19 * (1 - t * 0.3);
        g.fillStyle = green(0.75 + 0.5 * Math.sin(i * 1.7) ** 2, 0.85); g.beginPath(); g.ellipse(x, y, rad * 0.55, rad, 0.6, 0, TAU); g.fill();
      }
    }
  });
  const frond = (stiff, dense, col, droopy = 0) => {
    g.strokeStyle = 'rgb(80,96,48)'; g.lineWidth = 5; g.beginPath(); g.moveTo(S / 2, S - 4); g.lineTo(S / 2, 6); g.stroke();
    for (let i = 0; i < dense; i++) {
      const t = i / dense, y = S - 10 - t * (S - 24), L = (S * 0.46) * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * (1 - t * 0.2);
      for (const sd of [-1, 1]) {
        const ang = stiff ? 0.35 : 0.55 - droopy;
        const ex = S / 2 + sd * L * Math.cos(ang), ey = y - L * Math.sin(ang);
        if (stiff) { g.strokeStyle = col(); g.lineWidth = 5; g.beginPath(); g.moveTo(S / 2, y); g.lineTo(ex, ey); g.stroke(); }
        else {
          g.fillStyle = col(); g.beginPath(); g.moveTo(S / 2, y);
          g.quadraticCurveTo(S / 2 + sd * L * 0.5, y - L * 0.5 - 9, ex, ey); g.quadraticCurveTo(S / 2 + sd * L * 0.5, y - L * 0.3 + 9, S / 2, y + 5); g.fill();
        }
      }
    }
  };
  cell(CELL.fern, () => frond(false, 30, () => green(1.05)));
  cell(CELL.cycad, () => frond(true, 44, () => green(0.85, 0.8)));
  cell(CELL.palm, () => {                                            // a frond for the far palms: wide, overlapping leaflets
    // (neutral grey; the palm's vertex colours are the green) on a rachis down the middle; each half maps to one side
    // of a V-card, so the leaflets must read as a solid, feathery blade once mip-mapped
    for (let i = 0; i < 116; i++) r();                             // the draws the old palm cell made
    for (let i = 0; i < 64; i++) {
      const t = i / 64, y = S - 6 - t * (S - 14), L = S * 0.48 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.95)), 0.7) * (1 - t * 0.3);
      for (const sd of [-1, 1]) {
        const k = Math.round(clamp(0.62 + 0.3 * r2() + 0.08 * (1 - t), 0, 1) * 225);
        g.fillStyle = `rgb(${k},${k},${Math.round(k * 0.95)})`;
        const w = 7 - t * 3, ex = S / 2 + sd * L, ey = y + L * 0.3;
        g.beginPath(); g.moveTo(S / 2, y - w);
        g.quadraticCurveTo(S / 2 + sd * L * 0.5, y - L * 0.06 - w, ex, ey);
        g.quadraticCurveTo(S / 2 + sd * L * 0.5, y - L * 0.02 + w, S / 2, y + w); g.fill();
      }
    }
    g.strokeStyle = 'rgb(205,200,150)'; g.lineWidth = 7; g.beginPath(); g.moveTo(S / 2, S - 2); g.lineTo(S / 2, 4); g.stroke();
  });
  cell(CELL.leaf, () => {                                            // big glossy tropical / broad leaves (neutral grey)
    for (let i = 0; i < 70; i++) {
      const x = 60 + r() * (S - 120), y = 60 + r() * (S - 120), a = r() * TAU, L = 38 + r() * 30;
      g.fillStyle = grey(0.7 + r() * 0.4); g.beginPath(); g.ellipse(x, y, L * 0.38, L, a, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(60,60,60,0.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - Math.sin(a) * L, y + Math.cos(a) * L); g.lineTo(x + Math.sin(a) * L, y - Math.cos(a) * L); g.stroke();
    }
  });
  cell(CELL.small, () => {                                           // dense small leaves (temperate crowns, neutral grey)
    for (let i = 0; i < 420; i++) {
      const rr = Math.sqrt(r()) * S * 0.46, a = r() * TAU, x = S / 2 + Math.cos(a) * rr, y = S / 2 + Math.sin(a) * rr * 0.92;
      const L = 9 + r() * 9, an = r() * TAU, sh = 0.55 + 0.5 * (1 - rr / (S * 0.46)) + (y < S / 2 ? 0.1 : -0.05);
      g.fillStyle = grey(sh); g.beginPath(); g.ellipse(x, y, L * 0.5, L, an, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(70,58,44,0.8)'; g.lineWidth = 3;
    for (let i = 0; i < 9; i++) { const a = r() * TAU; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.cos(a) * S * 0.3, S / 2 + Math.sin(a) * S * 0.3); g.stroke(); }
  });
  cell(CELL.horse, () => {
    for (let i = 0; i < 16; i++) {
      const x = 20 + r() * (S - 40), h = S * (0.55 + r() * 0.45), lean = (r() - 0.5) * 40;
      for (let y = 0; y < h; y += 26) {
        const px = x + lean * y / S, py = S - y;
        g.strokeStyle = `rgb(${90 + r() * 20},${112 + r() * 20},${58})`; g.lineWidth = 6;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + lean * 26 / S, py - 24); g.stroke();
        g.strokeStyle = 'rgb(50,44,30)'; g.lineWidth = 2; g.beginPath(); g.moveTo(px - 4, py); g.lineTo(px + 4, py); g.stroke();
        if (y > h * 0.25) { g.strokeStyle = green(1.0); g.lineWidth = 1.6; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(px, py); g.lineTo(px + sd * 26 * (1 - y / h), py - 18); g.stroke(); } }
      }
    }
  });
  // grass tufts: blades rise from a narrow root and fan out (outer blades shorter and leaning more), every tip stays
  // inside the cell (no clipped, vertical card edges), dark roots, light tips, some dry straw blades, some arching over.
  // Neutral grey: the instance tint is the colour. Back blades first (darker), front blades on top.
  const tone = (l, dry, tip) => {
    const k = clamp(l, 0, 1) * 255;
    if (dry) return `rgb(${Math.round(k)},${Math.round(k * 0.93)},${Math.round(k * 0.66)})`;
    return tip ? `rgb(${Math.round(k)},${Math.round(k * 0.99)},${Math.round(k * 0.84)})` : `rgb(${Math.round(k)},${Math.round(k)},${Math.round(k * 0.95)})`;
  };
  const tuft = (n, spread, hMin, hMax, wMin, wMax, dryP, arch, stalks = 0) => {
    for (let i = 0; i < stalks; i++) {                                 // seed stalks: a thin stem and a small head
      const x0 = S / 2 + (r2() - 0.5) * S * 0.2, tx = clamp(x0 + (r2() - 0.5) * S * 0.3, 20, S - 20), ty = 14 + r2() * S * 0.15;
      g.strokeStyle = tone(0.8, true); g.lineWidth = 2.2; g.beginPath(); g.moveTo(x0, S); g.quadraticCurveTo((x0 + tx) / 2, S * 0.5, tx, ty); g.stroke();
      g.fillStyle = tone(0.9, true, true); g.beginPath(); g.ellipse(tx, ty + 10, 5, 16, Math.atan2(tx - x0, S - ty) * 0.6, 0, TAU); g.fill();
    }
    for (let pass = 0; pass < 2; pass++) {
      const m = pass ? Math.round(n * 0.6) : Math.round(n * 0.4), dim = pass ? 1 : 0.78;
      for (let i = 0; i < m; i++) {
        const u = (r2() + r2() + r2()) / 1.5 - 1;                               // -1..1, centre-weighted
        const x0 = S / 2 + u * S * 0.09 + (r2() - 0.5) * S * 0.04;
        const h = S * lerp(hMax, hMin, Math.abs(u)) * (0.7 + r2() * 0.4);
        const tx = clamp(x0 + u * S * spread * (0.55 + r2() * 0.6) + (r2() - 0.5) * S * 0.05, 14, S - 14);
        const ty = Math.max(12, S - h), w = wMin + r2() * (wMax - wMin);
        const bend = r2() < arch;
        const cx = x0 + (tx - x0) * (bend ? 0.25 : 0.3), cy = bend ? ty - h * 0.02 : S - h * 0.6;
        const ex = bend ? clamp(tx + (tx - x0) * 0.4 + Math.sign(tx - x0 || 1) * S * 0.04, 10, S - 10) : tx, ey = bend ? Math.min(S - 30, ty + h * 0.28) : ty;
        const dry = r2() < dryP;
        const gr = g.createLinearGradient(0, S, 0, Math.min(ey, cy));
        gr.addColorStop(0, tone((0.5 + r2() * 0.08) * dim, dry)); gr.addColorStop(0.5, tone((0.8 + r2() * 0.1) * dim, dry)); gr.addColorStop(1, tone((0.95 + r2() * 0.05) * (0.3 + 0.7 * dim), dry, true));
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(x0 - w, S); g.quadraticCurveTo(cx - w * 0.45, cy, ex, ey); g.quadraticCurveTo(cx + w * 0.45, cy, x0 + w, S); g.closePath(); g.fill();
      }
    }
  };
  cell(CELL.grass, () => { for (let i = 0; i < 1050; i++) r(); tuft(96, 0.34, 0.42, 1.0, 1.5, 3.1, 0.12, 0.14); });   // a meadow tuft: thin, upright blades (r: the old cell's draws)
  cell(CELL.tuft2, () => tuft(44, 0.42, 0.46, 1.0, 1.3, 2.6, 0.25, 0.3, 4));       // a sparse, wispy tuft with seed stalks
  cell(CELL.dune, () => tuft(46, 0.58, 0.5, 1.0, 1.3, 2.5, 0.5, 0.55));           // marram: long, thin, arching, straw
  cell(CELL.pbark, () => {                                           // palm trunk: grey-brown, ringed with leaf scars
    g.fillStyle = 'rgb(152,140,122)'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 240; i++) { const x = r2() * S; g.strokeStyle = `rgba(${100 + r2() * 60},${90 + r2() * 50},${74 + r2() * 40},0.3)`; g.lineWidth = 1 + r2() * 3; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r2() - 0.5) * 8, S); g.stroke(); }
    const ring = (y, amp, wav, dark) => {                              // periodic across the width (the tube's seam)
      const path = (dy) => { g.beginPath(); for (let x = 0; x <= S; x += 8) { const yy = y + dy + Math.sin(x / S * TAU * 2 + wav) * amp + Math.sin(x / S * TAU * 5 + wav * 2) * amp * 0.35; x ? g.lineTo(x, yy) : g.moveTo(x, yy); } g.stroke(); };
      g.lineWidth = 4 + r2() * 3; g.strokeStyle = `rgba(58,50,40,${dark})`; path(0);
      g.lineWidth = 3 + r2() * 2; g.strokeStyle = 'rgba(206,194,172,0.5)'; path(-5.5);
      g.lineWidth = 2; g.strokeStyle = 'rgba(90,80,66,0.35)'; path(6);
    };
    for (let k = 0; k < 14; k++) ring((k + 0.5 + (r2() - 0.5) * 0.3) * S / 14, 1.2 + r2() * 2.2, r2() * TAU, 0.55 + r2() * 0.3);
  });
  cell(CELL.leaflet, () => {                                         // a palm leaflet across the cell: pale midrib, veins
    g.fillStyle = 'rgb(206,206,198)'; g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 2) { const d = Math.abs(x - S / 2) / (S / 2); const k = Math.round(206 * (1.02 - 0.2 * d * d)); g.fillStyle = `rgb(${k},${k},${Math.round(k * 0.96)})`; g.fillRect(x, 0, 2, S); }
    for (let i = 0; i < 9; i++) { const x = S * (0.08 + i * 0.105); g.strokeStyle = 'rgba(160,160,150,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
    g.fillStyle = 'rgb(244,242,222)'; g.fillRect(S / 2 - 7, 0, 14, S);
  });
  cell(CELL.reed, () => {
    for (let i = 0; i < 60; i++) {
      const x = 40 + r() * (S - 80), h = S * (0.6 + r() * 0.4), lean = (r() - 0.5) * 60;
      g.strokeStyle = grey(0.7 + r() * 0.3); g.lineWidth = 3 + r() * 3;
      g.beginPath(); g.moveTo(x, S); g.quadraticCurveTo(x + lean * 0.2, S - h * 0.5, x + lean, S - h); g.stroke();
      if (r() < 0.25) { g.fillStyle = 'rgb(92,64,40)'; g.beginPath(); g.ellipse(x + lean * 0.8, S - h * 0.85, 6, 22, 0, 0, TAU); g.fill(); }
    }
  });
  cell(CELL.bark, () => {
    g.fillStyle = 'rgb(114,98,82)'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) { const x = r() * S; g.strokeStyle = `rgba(${40 + r() * 60},${30 + r() * 40},${22 + r() * 25},0.7)`; g.lineWidth = 2 + r() * 5; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + r() * 16 - 8, S * 0.3, x + r() * 16 - 8, S * 0.6, x + r() * 10 - 5, S); g.stroke(); }
  });
  cell(CELL.twig, () => {                                            // bare twigs, branching up from the bottom centre
    const br = (x, y, a, L, w, d) => {
      const ex = x + Math.sin(a) * L, ey = y - Math.cos(a) * L;
      g.strokeStyle = `rgb(${58 + d * 6},${48 + d * 5},${40 + d * 4})`; g.lineWidth = w; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + ex) / 2 + (r() - 0.5) * L * 0.2, (y + ey) / 2, ex, ey); g.stroke();
      if (d < 6) for (let k = 0; k < 2 + (r() < 0.4 ? 1 : 0); k++) br(ex, ey, a + (r() - 0.5) * 1.3, L * (0.62 + r() * 0.15), w * 0.66, d + 1);
    };
    for (let k = 0; k < 3; k++) br(S / 2 + (k - 1) * 30, S, (k - 1) * 0.35, 120, 10, 0);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  ATLAS = t;
  return t;
}

// ── geometry builder ───────────────────────────────────────────────────────────────────────────────────────────
class GB {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.f = []; this.flex = 0; }
  v(p, n, uv, c, f = this.flex) { this.p.push(...p); this.n.push(...n); this.uv.push(...uv); this.c.push(...c); this.f.push(f); return this.p.length / 3 - 1; }
  card(p0, d, w, L, W, droop, cellId, col, nfn, segs = 3, taper = 1) {
    const [u0, v0, u1, v1] = cellUV(cellId);
    const base = this.p.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const cx = p0[0] + d[0] * L * t, cy = p0[1] + d[1] * L * t - droop * t * t, cz = p0[2] + d[2] * L * t;
      const hw = W * 0.5 * (1 - t * (1 - taper));
      for (const sd of [-1, 1]) { const p = [cx + w[0] * hw * sd, cy + w[1] * hw * sd, cz + w[2] * hw * sd]; this.v(p, nfn(p), [sd < 0 ? u0 : u1, lerp(v0, v1, t)], col); }
    }
    for (let s = 0; s < segs; s++) { const a = base + s * 2; this.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  cardX(p0, d, w, L, W, droop, cellId, col, nfn, segs = 3) {
    const [u0, v0, u1, v1] = cellUV(cellId);
    const base = this.p.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const cx = p0[0] + d[0] * L * t, cy = p0[1] + d[1] * L * t - droop * t * t, cz = p0[2] + d[2] * L * t;
      for (const sd of [-1, 1]) { const p = [cx + w[0] * W * 0.5 * sd, cy + w[1] * W * 0.5 * sd, cz + w[2] * W * 0.5 * sd]; this.v(p, nfn(p), [lerp(u0, u1, t), sd < 0 ? v0 : v1], col); }
    }
    for (let s = 0; s < segs; s++) { const a = base + s * 2; this.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  // a quad card centred at c facing roughly `f` (for crown clusters): size s
  blob(c, f, up, s, cellId, col, nfn) {
    const w = nrm(cross(f, up)), u = nrm(cross(w, f));
    const [u0, v0, u1, v1] = cellUV(cellId);
    const b = this.p.length / 3;
    for (const [a, bb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [c[0] + (w[0] * a + u[0] * bb) * s * 0.5, c[1] + (w[1] * a + u[1] * bb) * s * 0.5, c[2] + (w[2] * a + u[2] * bb) * s * 0.5];
      this.v(p, nfn(p), [a < 0 ? u0 : u1, bb < 0 ? v0 : v1], col);
    }
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // tube along a polyline (branches): pts [[x,y,z]..], radii per point
  tube(pts, radii, col, sides = 6, vRep = 3, flex = null, cellId = CELL.bark) {
    const [u0, v0, u1, v1] = cellUV(cellId);
    const base = this.p.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const t = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const x = nrm(cross(t, ref)), y = cross(t, x);
      for (let k = 0; k <= sides; k++) {
        const an = k / sides * TAU, cs = Math.cos(an), sn = Math.sin(an);
        const n = [x[0] * cs + y[0] * sn, x[1] * cs + y[1] * sn, x[2] * cs + y[2] * sn];
        const p = pts[i], rr = radii[i];
        this.v([p[0] + n[0] * rr, p[1] + n[1] * rr, p[2] + n[2] * rr], n, [lerp(u0 + 0.03, u1 - 0.03, k / sides), lerp(v0, v1, (i / (pts.length - 1) * vRep) % 1)], col, flex ? flex[i] : this.flex);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < sides; k++) { const a = base + i * (sides + 1) + k, b = a + 1, c = a + sides + 1, d = c + 1; this.i.push(a, c, b, b, c, d); }
  }
  trunk(h, r0, r1, col, sides = 7, segs = 4, lean = [0, 0]) {
    const pts = [], radii = [];
    for (let s = 0; s <= segs; s++) { const t = s / segs; pts.push([lean[0] * t * t * h, t * h, lean[1] * t * t * h]); radii.push(lerp(r0, r1, Math.pow(t, 0.7)) * (1 + 0.5 * Math.pow(1 - t, 8))); }
    this.tube(pts, radii, col, sides, h / 6);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.f.some((x) => x !== 0)) g.setAttribute('aFlex', new THREE.Float32BufferAttribute(this.f, 1));   // palm fronds: how far a vertex bends in the wind
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
const crownN = (c, k = 0.85) => (p) => nrm([p[0] - c[0], (p[1] - c[1]) * 1.2 + 0.4, p[2] - c[2]]).map((v, i) => v * k + [0, 1, 0][i] * (1 - k));
const WOOD = [0.92, 0.84, 0.76], FOL = [1, 1, 1];   // Q2: bark reads grey-brown, not black

// ── plants (metres; y up; base at the origin) ─────────────────────────────────────────────────────────────────
function araucaria(seed, lod = 0) {
  const r = rng(seed), b = new GB(), H = 30 + r() * 6;
  b.trunk(H, 0.55, 0.12, WOOD, 8, 6);
  const h0 = H * 0.58, cc = [0, H * 0.84, 0];
  for (let y = h0; y < H; y += lod ? 1.9 : 0.95) {
    const f = (y - h0) / (H - h0), L = 1.4 + 6.2 * Math.pow(Math.sin(Math.PI * 0.5 * (1 - f)), 0.6) * (0.85 + r() * 0.3), n = 6, a0 = r() * TAU;
    for (let k = 0; k < n; k++) {
      const a = a0 + k / n * TAU + r() * 0.3, d = nrm([Math.cos(a), 0.12 - f * 0.1, Math.sin(a)]), w = [-Math.sin(a), 0, Math.cos(a)];
      const col = FOL.map((v) => v * (0.8 + 0.3 * f));
      b.cardX([0, y, 0], d, w, L, lod ? 3.4 : 2.6, -0.5 * L * 0.15, CELL.arau, col, crownN(cc), 3);
      if (!lod) b.cardX([0, y, 0], d, [0, 1, 0], L, 2.0, -0.5 * L * 0.15, CELL.arau, col, crownN(cc), 2);
    }
  }
  return b.geo();
}
function sequoia(seed, lod = 0) {
  const r = rng(seed), b = new GB(), H = 34 + r() * 8;
  b.trunk(H, 0.85, 0.08, WOOD, 8, 6);
  const h0 = H * 0.22;
  let a = r() * TAU;
  for (let y = h0; y < H - 0.5; y += lod ? 0.9 : 0.42) {
    const f = (y - h0) / (H - h0), L = 1.0 + 6.6 * Math.pow(1 - f, 0.95) * (0.85 + r() * 0.3);
    a += 2.39996;
    const d = nrm([Math.cos(a), -0.22, Math.sin(a)]), w = [-Math.sin(a), 0, Math.cos(a)], cc = [0, y + 1.5, 0];
    b.cardX([0, y, 0], d, w, L, lod ? 3.6 : 2.8, L * 0.14, CELL.spray, FOL, crownN(cc, 0.75), 2);
    if (!lod) b.cardX([0, y, 0], d, nrm([0, 1, 0.2]), L, 1.8, L * 0.14, CELL.spray, FOL, crownN(cc, 0.75), 2);
  }
  return b.geo();
}
function laurel(seed, lod = 0) {
  const r = rng(seed), b = new GB(), H = 14 + r() * 6;
  b.trunk(H * 0.55, 0.42, 0.22, WOOD, 7, 3, [(r() - 0.5) * 0.3, (r() - 0.5) * 0.3]);
  const cc = [0, H * 0.68, 0], R = H * 0.34;
  for (let i = 0; i < (lod ? 26 : 64); i++) {
    const u = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - u * u);
    const p = [cc[0] + Math.cos(a) * s * R * (0.55 + r() * 0.5), cc[1] + u * R * 0.62, cc[2] + Math.sin(a) * s * R * (0.55 + r() * 0.5)];
    const d = nrm([r() - 0.5, 0.6 + r() * 0.4, r() - 0.5]), w = nrm(cross(d, [r() - 0.5, 0, r() - 0.5]));
    const sz = (3.2 + r() * 1.6) * (lod ? 1.5 : 1);
    b.card([p[0] - d[0] * sz / 2, p[1] - d[1] * sz / 2, p[2] - d[2] * sz / 2], d, w, sz, sz, 0.2, CELL.leaf, FOL.map((v) => v * (0.85 + 0.3 * (u * 0.5 + 0.5))), crownN(cc, 0.85), 1);
  }
  return b.geo();
}
// temperate broadleaf (oak / beech): trunk, limbs and branches as tubes; leaf clusters at the branch ends (or bare twigs)
function deciduous(seed, lod = 0, bare = false) {
  const r = rng(seed), b = new GB(), H = 14 + r() * 6;
  const trunkH = H * (0.27 + r() * 0.08);                         // Q2: a lower, fuller crown (not a lollipop)
  b.trunk(trunkH + 0.5, 0.42, 0.28, WOOD, 8, 3);
  const cc = [0, H * 0.62, 0], R = H * 0.38;
  const ends = [];
  const nL = 5 + Math.floor(r() * 2);
  for (let k = 0; k < nL; k++) {
    const a = k / nL * TAU + r() * 0.6, up = 0.9 + r() * 0.8, L = R * (0.9 + r() * 0.4);
    const p0 = [0, trunkH - r() * 1.2, 0];
    const dir = nrm([Math.cos(a), up, Math.sin(a)]);
    const p1 = [p0[0] + dir[0] * L * 0.55, p0[1] + dir[1] * L * 0.55, p0[2] + dir[2] * L * 0.55];
    const p2 = [p0[0] + dir[0] * L + (r() - 0.5), p0[1] + dir[1] * L * 0.9 + 1, p0[2] + dir[2] * L + (r() - 0.5)];
    b.tube([p0, p1, p2], [0.24, 0.15, 0.06], WOOD, lod ? 4 : 6, 1);
    for (let q = 0; q < (lod ? 2 : 4); q++) {
      const t = 0.35 + q * 0.18 + r() * 0.1, bp = [lerp(p0[0], p2[0], t), lerp(p0[1], p2[1], t), lerp(p0[2], p2[2], t)];
      const ba = a + (r() - 0.5) * 2.2, bl = R * (0.35 + r() * 0.3);
      const bd = nrm([Math.cos(ba), 0.5 + r() * 0.6, Math.sin(ba)]);
      const be = [bp[0] + bd[0] * bl, bp[1] + bd[1] * bl, bp[2] + bd[2] * bl];
      if (!lod) b.tube([bp, be], [0.07, 0.025], WOOD, 4, 1);
      ends.push(be);
    }
    ends.push(p2);
  }
  if (bare) {
    for (const e of ends) for (let q = 0; q < (lod ? 1 : 3); q++) {
      const a = r() * TAU, d = nrm([Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5]), w = [-Math.sin(a), 0, Math.cos(a)];
      b.card([e[0] - d[0] * 0.8, e[1] - d[1] * 0.8, e[2] - d[2] * 0.8], d, w, 4.2, 4.2, 0, CELL.twig, [0.8, 0.78, 0.75], () => [0, 1, 0], 1);
    }
  } else {
    const n = crownN(cc, 0.8);
    for (const e of ends) for (let q = 0; q < (lod ? 3 : 8); q++) {
      const u = [e[0] + (r() - 0.5) * 3.2, e[1] + (r() - 0.35) * 2.4, e[2] + (r() - 0.5) * 3.2];
      const f = nrm([u[0] - cc[0] + (r() - 0.5) * 2, (u[1] - cc[1]) * 0.6 + (r() - 0.5) * 2, u[2] - cc[2] + (r() - 0.5) * 2]);
      const shade = 0.75 + 0.35 * clamp((u[1] - cc[1]) / R * 0.5 + 0.5);
      b.blob(u, f, [0, 1, 0], (2.8 + r() * 1.6) * (lod ? 1.45 : 1), CELL.small, FOL.map((v) => v * shade), n);
    }
    // an inner shell so the crown reads solid from below and at the edges
    for (let q = 0; q < (lod ? 6 : 16); q++) {
      const a = r() * TAU, u = r() * 2 - 1, s = Math.sqrt(1 - u * u);
      const p = [cc[0] + Math.cos(a) * s * R * 0.6, cc[1] + u * R * 0.45, cc[2] + Math.sin(a) * s * R * 0.6];
      b.blob(p, nrm([Math.cos(a) * s, u, Math.sin(a) * s]), [0, 1, 0], 4.5, CELL.small, FOL.map((v) => v * 0.6), crownN(cc, 0.7));
    }
  }
  return b.geo();
}
function broadleaf(seed, lod = 0) {                                   // jungle emergent: tall trunk, buttresses, umbrella crown
  const r = rng(seed), b = new GB(), H = 26 + r() * 10;
  b.trunk(H * 0.8, 0.75, 0.35, WOOD, 8, 5, [(r() - 0.5) * 0.15, (r() - 0.5) * 0.15]);
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + r(); b.tube([[Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2], [Math.cos(a) * 0.6, 3.2, Math.sin(a) * 0.6]], [0.18, 0.1], WOOD, 4, 1); }
  const cc = [0, H * 0.84, 0], R = H * 0.3;
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * TAU + r() * 0.5, p0 = [0, H * 0.7, 0], p1 = [Math.cos(a) * R * 0.8, H * 0.86 + r() * 2, Math.sin(a) * R * 0.8];
    b.tube([p0, p1], [0.3, 0.08], WOOD, 5, 1);
  }
  for (let i = 0; i < (lod ? 30 : 80); i++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * R * 1.05, u = [Math.cos(a) * rr, cc[1] + (r() - 0.3) * 3.5 - rr * rr / (R * R) * 2.5, Math.sin(a) * rr];
    const f = nrm([(r() - 0.5) * 0.8, 1, (r() - 0.5) * 0.8]);
    b.blob(u, f, [Math.cos(a), 0, Math.sin(a)], (4.2 + r() * 2) * (lod ? 1.4 : 1), CELL.leaf, FOL.map((v) => v * (0.75 + 0.3 * r())), crownN(cc, 0.8));
  }
  return b.geo();
}
// coconut palm: a gently curved, ringed, grey-brown trunk (swollen bole, fibrous crown shaft) and a crown of pinnate
// fronds whose leaflets are real blades (width, lit on both sides, hanging in a V below the arching rachis, older fronds
// lower and droopier), a coconut cluster and a dead frond or two. aFlex (metres of bend) lets the palm material stream
// the fronds downwind and flutter the leaflets. Far LOD: the same trunk, the fronds as V-cards of the frond texture.
const lerp3 = (a, c, t) => [lerp(a[0], c[0], t), lerp(a[1], c[1], t), lerp(a[2], c[2], t)];
function ball(b, c, rad, col, seg, uvc) {
  const base = b.p.length / 3, la = Math.max(3, seg >> 1);
  for (let j = 0; j <= la; j++) {
    const th = j / la * Math.PI, y = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k <= seg; k++) { const a = k / seg * TAU, n = [Math.cos(a) * s, y * 1.08, Math.sin(a) * s]; b.v([c[0] + n[0] * rad, c[1] + n[1] * rad, c[2] + n[2] * rad], nrm(n), uvc, col, 0); }
  }
  for (let j = 0; j < la; j++) for (let k = 0; k < seg; k++) { const a = base + j * (seg + 1) + k, d = a + seg + 1; b.i.push(a, d, a + 1, a + 1, d, d + 1); }
}
function palm(seed, lod = 0) {
  const r = rng(seed), b = new GB();
  const H = 8.5 + r() * 4.5, la = r() * TAU, lean = 0.1 + r() * 0.2, lx = Math.cos(la), lz = Math.sin(la);
  const C = (t) => { const off = H * lean * (t - 0.45 * t * t); return [lx * off, t * H, lz * off]; };      // leans out, curves back up
  const rad = (t) => (0.16 + 0.055 * (1 - t)) * (1 + 0.6 * Math.pow(Math.max(0, 1 - t * 8), 2)) * (1 + 0.28 * sr(t, 0.93, 1));
  // ── trunk: rings of vertices on the curve; the ringed bark repeats every REP m and every repeat starts on its own ring
  // of vertices (a quad whose v wrapped 0.9 -> 0.1 would squeeze the rings into a band)
  {
    const [u0, v0, u1, v1] = cellUV(CELL.pbark), sides = lod ? 7 : 12, REP = 1.9, segs = lod ? 10 : 30;
    const ts = []; for (let s = 0; s <= segs; s++) ts.push(s / segs);
    for (let k = 1; k * REP < H; k++) ts.push(k * REP / H);
    ts.sort((a, c) => a - c);
    const ring = (t, vv) => {
      const p = C(t), q = C(Math.min(1, t + 0.01)), p0 = C(Math.max(0, t - 0.01));
      const T = nrm([q[0] - p0[0], q[1] - p0[1], q[2] - p0[2]]), X = nrm(cross(T, [0, 0, 1])), Y = cross(T, X), rr = rad(t);
      const col = t > 0.94 ? [0.66, 0.5, 0.36] : lerp3([0.6, 0.55, 0.48], [0.84, 0.78, 0.68], sr(t, 0, 0.08));
      for (let k = 0; k <= sides; k++) {
        const an = k / sides * TAU, cs = Math.cos(an), sn = Math.sin(an), n = [X[0] * cs + Y[0] * sn, X[1] * cs + Y[1] * sn, X[2] * cs + Y[2] * sn];
        b.v([p[0] + n[0] * rr, p[1] + n[1] * rr, p[2] + n[2] * rr], n, [lerp(u0 + 0.004, u1 - 0.004, k / sides), lerp(v0 + 0.002, v1 - 0.002, vv)], col, 0);
      }
    };
    for (let i = 0; i < ts.length - 1; i++) {
      const ta = ts[i], tb = ts[i + 1]; if (tb - ta < 1e-4) continue;
      const blk = Math.floor((ta * H + 1e-4) / REP), va = (ta * H - blk * REP) / REP, vb = Math.min(1, (tb * H - blk * REP) / REP);
      const base = b.p.length / 3;
      ring(ta, va); ring(tb, vb);
      for (let k = 0; k < sides; k++) { const a = base + k, c = a + sides + 1; b.i.push(a, c, a + 1, a + 1, c, c + 1); }
    }
  }
  // ── fronds
  const top = C(1), up = [0, 1, 0];
  const [lu0, lv0, lu1, lv1] = cellUV(CELL.leaflet), [pu0, pv0, pu1, pv1] = cellUV(CELL.palm), lmid = [(lu0 + lu1) / 2, (lv0 + lv1) / 2];
  const nF = lod ? 11 : 18;
  for (let k = 0; k < nF + 2; k++) {
    const dead = k >= nF;                                                // the last two: dead fronds hanging down the trunk
    if (dead && (lod || r() < 0.3)) continue;
    const age = dead ? 1 : k / (nF - 1);                                 // 0 = youngest (upright) .. 1 = oldest (lowest)
    const az = k * 2.39996 + r() * 0.4;
    const el = dead ? -1.15 - r() * 0.3 : lerp(1.0, -0.28, age) + (r() - 0.5) * 0.24;
    const L = (dead ? 3.0 : lerp(3.2, 4.8, Math.sqrt(age))) * (0.9 + r() * 0.2) * Math.pow(H / 11, 0.3);
    const droop = dead ? 0.25 : lerp(0.55, 1.45, age) * (0.85 + r() * 0.3), curl = (r() - 0.5) * 0.35;
    const cF = dead ? [0.3, 0.2, 0.1] : lerp3([0.2, 0.34, 0.075], [0.36, 0.38, 0.1], clamp(age * 0.75 + r() * 0.25));
    const n = lod ? 5 : 10, P = [], Tn = [];
    let p = [top[0] + Math.cos(az) * 0.12, top[1] + 0.1 - age * 0.35, top[2] + Math.sin(az) * 0.12];
    for (let i = 0; i <= n; i++) {
      const f = i / n, pitch = el - droop * Math.pow(f, 1.6), a = az + curl * f * f;
      const d = [Math.cos(pitch) * Math.cos(a), Math.sin(pitch), Math.cos(pitch) * Math.sin(a)];
      if (i) p = [p[0] + d[0] * L / n, p[1] + d[1] * L / n, p[2] + d[2] * L / n];
      P.push(p); Tn.push(d);
    }
    const flexAt = (f) => Math.pow(f, 1.4) * L / 4.4;
    const at = (f) => { const fi = clamp(f) * n, i0 = Math.min(n - 1, Math.floor(fi)), w = fi - i0; return [lerp3(P[i0], P[i0 + 1], w), nrm(lerp3(Tn[i0], Tn[i0 + 1], w))]; };
    const leafDir = (T, sd, fwd, vang) => {
      const W = nrm(cross(up, T)), Nn = nrm(cross(T, W));
      const Dp = nrm([W[0] * sd * Math.cos(fwd) + T[0] * Math.sin(fwd), W[1] * sd * Math.cos(fwd) + T[1] * Math.sin(fwd), W[2] * sd * Math.cos(fwd) + T[2] * Math.sin(fwd)]);
      return [nrm([Dp[0] * Math.cos(vang) - Nn[0] * Math.sin(vang), Dp[1] * Math.cos(vang) - Nn[1] * Math.sin(vang), Dp[2] * Math.cos(vang) - Nn[2] * Math.sin(vang)]), Nn];
    };
    const leafLen = (f) => 0.95 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + f * 0.95)), 0.75) * (1 - 0.3 * f) * (L / 4.4) * (dead ? 0.7 : 1);
    // the frond card (both LODs): up close it is invisible and the leaflets carry the frond; with distance the palm
    // material fades the card in and thins the leaflets out, so a far palm keeps a solid, feathery crown (no sticks)
    for (const sd of [-1, 1]) {
      const base = b.p.length / 3;
      for (let i = 0; i <= n; i++) {
        const f = Math.max(0.06, i / n), [rp, T] = at(f), ll = leafLen(f), [D, Nn] = leafDir(T, sd, 0.6, dead ? 1.1 : 0.5 + 0.3 * f);
        const tip = [rp[0] + D[0] * ll, rp[1] + D[1] * ll - 0.12 * ll, rp[2] + D[2] * ll], Nsh = nrm([Nn[0] * 0.6, Nn[1] * 0.6 + 0.4, Nn[2] * 0.6]);
        const vv = lerp(pv0 + 0.004, pv1 - 0.004, i / n);
        b.v(rp, Nsh, [(pu0 + pu1) / 2, vv], cF, flexAt(f)); b.v(tip, Nsh, [sd > 0 ? pu1 - 0.004 : pu0 + 0.004, vv], cF, flexAt(f) + ll * 0.4);
      }
      for (let i = 0; i < n; i++) { const a = base + i * 2; if (sd > 0) b.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else b.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    if (!lod) {
      b.tube(P, P.map((_, i) => lerp(0.05, 0.012, i / n)), dead ? [0.4, 0.3, 0.17] : [0.62, 0.6, 0.3], 4, 1, P.map((_, i) => flexAt(i / n)), CELL.leaflet);
      const nL = dead ? 24 : 40;
      for (let i = 0; i < nL; i++) {
        const f = 0.1 + 0.88 * (i + 0.5) / nL, [rp, T] = at(f), ll = leafLen(f), fl = flexAt(f);
        for (const sd of [-1, 1]) {
          const [D, Nn] = leafDir(T, sd, 0.55 + r() * 0.15, dead ? 1.2 : 0.45 + 0.35 * f + (r() - 0.5) * 0.16);
          let Wd = nrm([T[0] - D[0] * (T[0] * D[0] + T[1] * D[1] + T[2] * D[2]), T[1] - D[1] * (T[0] * D[0] + T[1] * D[1] + T[2] * D[2]), T[2] - D[2] * (T[0] * D[0] + T[1] * D[1] + T[2] * D[2])]);
          let Nl = nrm(cross(D, Wd)); if (Nl[1] < 0) Nl = Nl.map((v) => -v);
          const Nsh = nrm([Nl[0] * 0.65 + Nn[0] * 0.35, Nl[1] * 0.65 + Nn[1] * 0.35 + 0.15, Nl[2] * 0.65 + Nn[2] * 0.35]);
          const w0 = (dead ? 0.045 : 0.065) * (0.85 + r() * 0.3), sag = 0.12 * ll;
          const q = (t) => [rp[0] + D[0] * ll * t, rp[1] + D[1] * ll * t - sag * t * t, rp[2] + D[2] * ll * t];
          const c0 = cF.map((v) => v * (0.82 + r() * 0.3)), cT = dead ? c0 : lerp3(c0, [0.42, 0.36, 0.12], f > 0.8 && age > 0.55 ? 0.6 : 0.15);
          const qa = q(0), qm = q(0.5), qt = q(1);
          const e = (pt, s, w) => [pt[0] + Wd[0] * s * w, pt[1] + Wd[1] * s * w, pt[2] + Wd[2] * s * w];
          const i0 = b.v(e(qa, -0.5, w0 * 0.55), Nsh, [lu0, lv0], c0, fl), i1 = b.v(e(qa, 0.5, w0 * 0.55), Nsh, [lu1, lv0], c0, fl);
          const i2 = b.v(e(qm, -0.5, w0), Nsh, [lu0, lerp(lv0, lv1, 0.5)], c0, fl + ll * 0.25), i3 = b.v(e(qm, 0.5, w0), Nsh, [lu1, lerp(lv0, lv1, 0.5)], c0, fl + ll * 0.25);
          const i4 = b.v(qt, Nsh, [(lu0 + lu1) / 2, lv1], cT, fl + ll * 0.5);
          // wind the triangles so their front face is the lit (upper) side
          const g0 = cross([qm[0] - qa[0], qm[1] - qa[1], qm[2] - qa[2]], Wd), flip = g0[0] * Nl[0] + g0[1] * Nl[1] + g0[2] * Nl[2] < 0;
          if (flip) b.i.push(i0, i1, i2, i1, i3, i2, i2, i3, i4); else b.i.push(i0, i2, i1, i1, i2, i3, i2, i4, i3);
        }
      }
    }
  }
  // ── coconuts in a cluster under the crown
  const nC = lod ? 3 : 4 + Math.floor(r() * 5);
  for (let i = 0; i < nC; i++) {
    const a = r() * TAU, rr = 0.2 + r() * 0.16, y = top[1] - 0.12 - r() * 0.4;
    ball(b, [top[0] + Math.cos(a) * rr, y, top[2] + Math.sin(a) * rr], 0.12 + r() * 0.035, r() < 0.65 ? [0.2, 0.27, 0.06] : [0.42, 0.28, 0.09], lod ? 5 : 8, lmid);
  }
  return b.geo();
}
function treefern(seed) {
  const r = rng(seed), b = new GB(), H = 3.2 + r() * 3.2;
  const lean = [(r() - 0.5) * 0.25, (r() - 0.5) * 0.25];
  b.trunk(H, 0.2, 0.16, [0.45, 0.38, 0.3], 6, 4, lean);
  const top = [lean[0] * H, H, lean[1] * H];
  for (let k = 0; k < 13; k++) {
    const a = k / 13 * TAU + r() * 0.3, up = 0.55 + r() * 0.5, L = 2.6 + r() * 1.2;
    const d = nrm([Math.cos(a), up, Math.sin(a)]), w = [-Math.sin(a), 0, Math.cos(a)];
    b.card(top, d, w, L, 1.15, L * 0.55, CELL.fern, FOL, (p) => nrm([p[0] - top[0], 1.2, p[2] - top[2]]), 4, 0.5);
  }
  return b.geo();
}
function cycad(seed) {
  const r = rng(seed), b = new GB(), H = 0.4 + r() * 1.3;
  b.trunk(H, 0.38, 0.3, [0.42, 0.34, 0.24], 7, 2);
  const top = [0, H, 0];
  for (let k = 0; k < 18; k++) {
    const a = k / 18 * TAU + r() * 0.2, up = 0.7 + r() * 0.6, L = 1.3 + r() * 0.7;
    const d = nrm([Math.cos(a), up, Math.sin(a)]), w = [-Math.sin(a), 0, Math.cos(a)];
    b.card(top, d, w, L, 0.62, L * 0.32, CELL.cycad, FOL.map((v) => v * 0.9), (p) => nrm([p[0], 1.4, p[2]]), 3, 0.35);
  }
  return b.geo();
}
function fern(seed) {
  const r = rng(seed), b = new GB(), n = 7 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU + r() * 0.4, up = 0.6 + r() * 0.8, L = 0.7 + r() * 0.7;
    const d = nrm([Math.cos(a), up, Math.sin(a)]), w = [-Math.sin(a), 0, Math.cos(a)];
    b.card([0, 0.02, 0], d, w, L, 0.55, L * 0.45, CELL.fern, FOL.map((v) => v * (0.85 + r() * 0.3)), (p) => nrm([p[0], 1.5, p[2]]), 3, 0.3);
  }
  return b.geo();
}
function horsetail(seed) {
  const r = rng(seed), b = new GB();
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI + r() * 0.4, w = [Math.cos(a), 0, Math.sin(a)];
    b.card([0, -0.1, 0], [0, 1, 0], w, 1.6 + r() * 0.8, 1.4, 0, CELL.horse, FOL, (p) => nrm([p[0] * 0.5, 1, p[2] * 0.5]), 2);
  }
  return b.geo();
}
function bush(seed) {
  const r = rng(seed), b = new GB(), R = 1.1 + r() * 0.6, cc = [0, R * 0.8, 0];
  for (let q = 0; q < 26; q++) {
    const a = r() * TAU, u = r() * 1.6 - 0.6, s = Math.sqrt(Math.max(0, 1 - u * u));
    const p = [Math.cos(a) * s * R * 0.8, cc[1] + u * R * 0.7, Math.sin(a) * s * R * 0.8];
    b.blob(p, nrm([Math.cos(a) * s, u + 0.3, Math.sin(a) * s]), [0, 1, 0], 1.5 + r() * 0.7, CELL.small, FOL.map((v) => v * (0.7 + 0.4 * (u * 0.5 + 0.5))), crownN(cc, 0.8));
  }
  return b.geo();
}
// a grass tuft: 2-4 fan-shaped cards (not an even star), each leaning and bent over at the top by its own amount, of two
// tuft textures; per-card shade. `dune`: marram (long thin arching blades) for the dunes behind a beach.
function grass(seed, dune = false) {
  const r = rng(seed), b = new GB();
  const nC = dune ? 3 + Math.floor(r() * 2) : 3 + Math.floor(r() * 1.8), a0 = r() * Math.PI;
  const cell = dune ? CELL.dune : (r() < 0.4 ? CELL.tuft2 : CELL.grass);
  for (let k = 0; k < nC; k++) {
    const a = a0 + k / nC * Math.PI + (r() - 0.5) * 0.8, w = [Math.cos(a), 0, Math.sin(a)];
    const lean = (r() - 0.5) * 0.55, h = (dune ? 0.7 : 0.32) + r() * (dune ? 0.45 : 0.34), W = (dune ? 0.75 : 0.46) + r() * 0.26;
    const d = nrm([-Math.sin(a) * lean + (r() - 0.5) * 0.12, 1, Math.cos(a) * lean + (r() - 0.5) * 0.12]);
    const o = [(r() - 0.5) * 0.1, -0.03, (r() - 0.5) * 0.1];
    b.card(o, d, w, h, W, h * (0.06 + r() * 0.2), cell, FOL.map((v) => v * (0.82 + r() * 0.32)), (p) => nrm([p[0] * 0.3, 1, p[2] * 0.3]), 2);
  }
  return b.geo();
}
function reeds(seed) {
  const r = rng(seed), b = new GB();
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI + r() * 0.4, w = [Math.cos(a), 0, Math.sin(a)];
    b.card([0, -0.15, 0], nrm([(r() - 0.5) * 0.15, 1, (r() - 0.5) * 0.15]), w, 1.8 + r() * 0.8, 1.2, 0.1, CELL.reed, FOL, (p) => nrm([p[0] * 0.4, 1, p[2] * 0.4]), 2);
  }
  return b.geo();
}
// spruce: drooping star-edged whorls (after ww2world/forest.js), height 1 -> scaled to metres
function conifer(seed, lod = 0) {
  const r = rng(seed);
  const pos = [], col = [], idx = [];
  const add = (x, y, z, c) => { pos.push(x, y, z); col.push(c, c, c); return pos.length / 3 - 1; };
  const W = lod ? 6 : 12, ARMS = lod ? 5 : 8;
  for (let w = 0; w < W; w++) {
    const f = w / (W - 1), y0 = 0.14 + f * 0.8, R = (0.25 * (1 - f) + 0.025) * (0.92 + r() * 0.16), droop = 0.05 + 0.04 * (1 - f);
    const apex = add(0, y0 + 0.06, 0, 1);
    const ring = [], rot = r() * Math.PI;
    for (let k = 0; k < ARMS * 2; k++) {
      const a = rot + k / (ARMS * 2) * TAU, tip = k % 2 === 0;
      const rr = tip ? R * (0.9 + r() * 0.2) : R * 0.42, y = tip ? y0 - droop * (0.8 + r() * 0.4) : y0 - droop * 0.25;
      ring.push(add(Math.cos(a) * rr, y, Math.sin(a) * rr, tip ? 0.75 : 0.95));
    }
    for (let k = 0; k < ring.length; k++) idx.push(apex, ring[(k + 1) % ring.length], ring[k]);
    const under = add(0, y0 - droop * 0.9, 0, 0.35);
    for (let k = 0; k < ring.length; k++) idx.push(under, ring[k], ring[(k + 1) % ring.length]);
  }
  const top = add(0, 1.0, 0, 1);
  for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; const i = add(Math.cos(a) * 0.03, 0.86, Math.sin(a) * 0.03, 0.9); const j = add(Math.cos(a + 1.2566) * 0.03, 0.86, Math.sin(a + 1.2566) * 0.03, 0.9); idx.push(top, j, i); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tr = new THREE.CylinderGeometry(0.008, 0.016, 0.3, 6, 1, true); tr.translate(0, 0.15, 0); tr.deleteAttribute('uv');
  tr.setAttribute('color', new THREE.BufferAttribute(new Float32Array(tr.attributes.position.count * 3).fill(-1), 3));
  const m = mergeTwo(g, tr);
  const H = 22;
  m.scale(H * 0.55, H, H * 0.55);            // a slimmer, taller spruce than the unit shape
  m.computeBoundingSphere();
  return m;
}
function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'color']) g.setAttribute(k, new THREE.Float32BufferAttribute([...a.attributes[k].array, ...b.attributes[k].array], 3));
  const off = a.attributes.position.count;
  g.setIndex([...a.index.array, ...Array.from(b.index.array, (i) => i + off)]);
  return g;
}
function cactus(seed, type = 'saguaro') {
  const r = rng(seed);
  const parts = [];
  const ribbed = (h, rad, x = 0, z = 0, y0 = 0, bendTo = null) => {
    const g = new THREE.CylinderGeometry(rad * 0.92, rad, h, 16, 8, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), a = Math.atan2(vz, vx), rr = Math.hypot(vx, vz);
      const rib = 1 + 0.07 * Math.cos(a * 12), top = vy > h / 2 - 1e-3 ? 0.6 : 1;
      p.setXYZ(i, Math.cos(a) * rr * rib * top, vy + (vy > h / 2 - 1e-3 ? rad * 0.3 : 0), Math.sin(a) * rr * rib * top);
    }
    g.translate(x, y0 + h / 2, z);
    parts.push(g);
  };
  if (type === 'barrel') { ribbed(0.9 + r() * 0.4, 0.45 + r() * 0.15); }
  else {
    const H = 6 + r() * 4, R = 0.32 + r() * 0.08;
    ribbed(H, R);
    const arms = 1 + Math.floor(r() * 3);
    for (let k = 0; k < arms; k++) {
      const a = r() * TAU, y = H * (0.35 + r() * 0.3), out = 0.9 + r() * 0.5, up = H * (0.25 + r() * 0.2);
      const elbow = new THREE.CylinderGeometry(R * 0.7, R * 0.7, out, 10, 1); elbow.rotateZ(Math.PI / 2); elbow.translate(out / 2, 0, 0); elbow.rotateY(-a); elbow.translate(0, y, 0);
      parts.push(elbow);
      ribbed(up, R * 0.72, Math.cos(a) * out, Math.sin(a) * out, y - R * 0.3);
    }
  }
  for (const p of parts) { p.deleteAttribute('uv'); }
  const g = mergeGeoms(parts);
  const c = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < c.length / 3; i++) { const v = 0.8 + 0.2 * Math.sin(i * 1.7); c[i * 3] = 0.19 * v; c[i * 3 + 1] = 0.27 * v; c[i * 3 + 2] = 0.12 * v; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}
function mergeGeoms(list) {
  let n = 0, m = 0; for (const g of list) { n += g.attributes.position.count; m += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(n * 3), idx = new Uint32Array(m); let o = 0, q = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    const I = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    for (let i = 0; i < I.length; i++) idx[q++] = I[i] + o;
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
function rockGeo(seed, detail = 3, flat = 0.62) {
  const r = rng(seed), n = makeNoise(seed * 13 + 5);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const sx = 0.8 + r() * 0.5, sz = 0.8 + r() * 0.5;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.28 * n.fbm2(x * 1.3 + y * 0.7, z * 1.3 - y * 0.5, 4) + 0.1 * n.ridge2(x * 3 + 5, z * 3 + y, 2);
    // facets: pull toward a few cut planes so it reads as fractured stone, not a blob
    x *= d * sx; y *= d * flat; z *= d * sz;
    if (y < -0.25) y = -0.25 + (y + 0.25) * 0.3;
    p.setXYZ(i, x, y + 0.2, z);
  }
  g.deleteAttribute('uv');
  const ng = g.toNonIndexed(); ng.computeVertexNormals();
  const c = new Float32Array(ng.attributes.position.count * 3).fill(1);
  ng.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return ng;
}

// ── materials ──────────────────────────────────────────────────────────────────────────────────────────────────
const MATS = {};
function foliageMaterial(ctx, key = 'foliage', o = {}) {
  if (MATS[key]) return MATS[key];
  const m = new THREE.MeshStandardMaterial({ map: paintAtlas(), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: o.env ?? 0.45 });
  m.alphaToCoverage = true;
  m.userData.progKey = 'nflora-' + key;
  m.customProgramCacheKey = () => 'nature-foliage-' + key;
  const sway = o.sway ?? 1, stiff = o.stiff ?? 0.08;
  // bark is not a leaf: no back-light translucency on the bark cells (trunks, branches)
  const inCell = (c) => { const [a, b, cc, d] = cellUV(c); return `step(${a.toFixed(4)}, vMapUv.x) * step(vMapUv.x, ${cc.toFixed(4)}) * step(${b.toFixed(4)}, vMapUv.y) * step(vMapUv.y, ${d.toFixed(4)})`; };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uFTime: FU.uTime, uFWind: FU.uWind, uSunDir3: U.uSunDir, uFWDir: FU.uWDir });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFTime; uniform float uFWind; uniform vec2 uFWDir; varying vec3 vFW; varying vec3 vBarkC;' + (o.flex ? '\nattribute float aFlex;' : ''))
      .replace('#include <color_vertex>', '#include <color_vertex>\n vBarkC = vec3(1.0);\n#ifdef USE_COLOR\n vBarkC = color.rgb;\n#endif')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
          float ph = dot(ip.xz, vec2(0.071, 0.053));
          float hh = max(position.y, 0.0);
          float k = uFWind * ${sway.toFixed(3)} * hh * hh * ${stiff.toFixed(4)};
          float g = sin(uFTime * 1.1 + ph) * 0.6 + sin(uFTime * 2.3 + ph * 1.7) * 0.25 + 0.5;
          float fl = sin(uFTime * 5.7 + ph * 3.0 + position.x * 1.3 + position.z * 1.1) * 0.12;
          transformed.x += k * (g * 0.8 + fl) * 0.06;
          transformed.z += k * (g * 0.45 + fl * 0.8) * 0.05;
        ${o.flex ? `
          // palm fronds (aFlex = metres of bend): stream downwind in the gusts, sag, and the leaflets flutter
          mat3 wm = mat3(modelMatrix);                                   // world wind -> this vertex's local space
        #ifdef USE_INSTANCING
          wm = wm * mat3(instanceMatrix);
        #endif
          vec3 wl = transpose(wm) * vec3(uFWDir.x, 0.0, uFWDir.y) / max(dot(wm[0], wm[0]), 1e-4);
          float gust = 0.6 + 0.28 * sin(uFTime * 0.83 + ph * 1.3) + 0.12 * sin(uFTime * 2.1 + ph * 2.7);
          float flut = sin(uFTime * 7.9 + ph * 3.0 + position.x * 3.1 + position.z * 2.3 + position.y * 1.7);
          float bk = aFlex * clamp(uFWind, 0.0, 1.5);
          transformed += wl * bk * gust * (0.9 + 1.6 * uFWind * uFWind);
          transformed.y -= bk * gust * 0.15;
          transformed += normal * bk * flut * 0.12;
          // the whole palm bends downwind in strong wind (0 at the base, most at the crown): a Cat-5 leans it 10-20 deg
          float hb = max(position.y, 0.0) / 11.0, sg = 0.72 + 0.28 * sin(uFTime * 0.55 + ph * 0.9);
          transformed += wl * uFWind * uFWind * 4.0 * hb * hb * sg;` : ''}
        }`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 fw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fw = instanceMatrix * fw;
        #endif
          vFW = (modelMatrix * fw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uSunDir3; varying vec3 vFW; varying vec3 vBarkC;\n${NOISE_GLSL}`)
      // bark takes its own colour, not the instance's leaf tint (a green tint times dark bark made every trunk black)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef USE_MAP
          diffuseColor.rgb = mix(diffuseColor.rgb, sampledDiffuseColor.rgb * vBarkC, clamp(${inCell(CELL.bark)} + ${inCell(CELL.pbark)}, 0.0, 1.0));
        #endif`)
      // grass: both faces of a card keep the tuft's up-facing normal (a flipped, downward normal lit the back faces with
      // the sky's underside: blue-teal tufts)
      .replace('#include <normal_fragment_begin>', o.upNormal ? `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          normal *= faceDirection; nonPerturbedNormal = normal;
        #endif` : '#include <normal_fragment_begin>')
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        { float dc = length(vFW - cameraPosition);                 // dissolve near the lens
          if (dc < 4.0 && n_h12(gl_FragCoord.xy) > smoothstep(1.3, 4.0, dc)) discard;
        ${o.flex ? `
        #ifdef USE_MAP
          // palms: the frond cards fade in with distance while the (sub-pixel) leaflets thin out (alpha to coverage)
          { float card = ${inCell(CELL.palm)}, leaf = ${inCell(CELL.leaflet)};
            diffuseColor.a *= mix(1.0, smoothstep(38.0, 95.0, dc), card) * mix(1.0, 1.0 - 0.75 * smoothstep(70.0, 170.0, dc), leaf);
            if (diffuseColor.a < 0.01) discard; }
        #endif` : ''}
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { vec3 Vv = normalize(vViewPosition);
          vec3 Ls = normalize((viewMatrix * vec4(uSunDir3, 0.0)).xyz);
          float back = pow(saturate(dot(Vv, Ls)), 4.0);
          float leafy = 1.0;
        #ifdef USE_MAP
          leafy = 1.0 - clamp(${inCell(CELL.bark)} + ${inCell(CELL.pbark)}, 0.0, 1.0);
        #endif
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.85, 0.55) * back * 1.4 * max(uSunDir3.y + 0.1, 0.0) * leafy; }`);
  };
  MATS[key] = (ctx.patch || patchMaterial)(m) || m;
  return MATS[key];
}
function coniferMaterial(ctx) {
  if (MATS.conifer) return MATS.conifer;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide });
  m.userData.progKey = 'nconifer';
  m.customProgramCacheKey = () => 'nature-conifer';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uSnowAmt: FU.uSnowAmt, uFTime: FU.uTime, uFWind: FU.uWind });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW; varying float vShade; uniform float uFTime; uniform float uFWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
          float hh = max(position.y, 0.0) / 22.0; float ph = dot(ip.xz, vec2(0.071, 0.053));
          transformed.x += uFWind * hh * hh * 0.35 * (sin(uFTime * 0.9 + ph) + 0.4 * sin(uFTime * 2.1 + ph * 1.3));
          transformed.z += uFWind * hh * hh * 0.2 * sin(uFTime * 0.7 + ph * 0.8); }`)
      .replace('#include <color_vertex>', '#include <color_vertex>\n vShade = color.r;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 tw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          tw = instanceMatrix * tw;
        #endif
          vTW = (modelMatrix * tw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTW; varying float vShade; uniform float uSnowAmt;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `
        { float dc = length(vTW - cameraPosition);
          if (dc < 4.0 && n_h12(gl_FragCoord.xy) > smoothstep(1.3, 4.0, dc)) discard;
          vec3 Nw = normalize(inverseTransformDirection(vNormal, viewMatrix));
          float n = n_v3(vTW * 2.3) * 0.6 + n_v3(vTW * 7.0) * 0.4;
          vec3 tint = vShade > 0.01 ? vColor.rgb / vShade : vec3(1.0);
          vec3 needle = mix(vec3(0.022, 0.04, 0.028), vec3(0.05, 0.078, 0.048), n) * (0.7 + 0.5 * vShade) * tint;
          float up = gl_FrontFacing ? Nw.y : -Nw.y;
          float snow = smoothstep(0.18, 0.62, up + (n - 0.5) * 0.55) * uSnowAmt * smoothstep(0.2, 0.7, vShade);
          vec3 c = mix(needle, vec3(0.86, 0.88, 0.9), snow);
          if (vShade < 0.0) c = vec3(0.07, 0.055, 0.045) * (0.8 + 0.4 * n);
          diffuseColor.rgb = c; }`);
  };
  MATS.conifer = (ctx.patch || patchMaterial)(m) || m;
  return MATS.conifer;
}
function plainMaterial(ctx, key, o) {
  if (MATS[key]) return MATS[key];
  const m = new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.85, metalness: 0 }, o));
  m.customProgramCacheKey = () => 'nature-plain-' + key;
  MATS[key] = (ctx.patch || patchMaterial)(m) || m;
  return MATS[key];
}
function rockMaterial(ctx) {
  if (MATS.rock) return MATS.rock;
  const tex = TX.rock();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.45 });
  m.customProgramCacheKey = () => 'nature-rock';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRM = { value: tex.map }; sh.uniforms.uRN = { value: tex.normalMap };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRP; varying vec3 vRN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 w = vec4(transformed, 1.0); vec3 nn = objectNormal;
        #ifdef USE_INSTANCING
          w = instanceMatrix * w; nn = mat3(instanceMatrix) * nn;
        #endif
          vRP = (modelMatrix * w).xyz; vRN = normalize(mat3(modelMatrix) * nn); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRP; varying vec3 vRN; uniform sampler2D uRM; uniform sampler2D uRN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec3 bw = pow(abs(normalize(vRN)), vec3(4.0)); bw /= dot(bw, vec3(1.0)); float s = 0.35;
          vec3 c = texture2D(uRM, vRP.zy * s).rgb * bw.x + texture2D(uRM, vRP.xz * s).rgb * bw.y + texture2D(uRM, vRP.xy * s).rgb * bw.z;
          diffuseColor.rgb *= c * 1.3 * (0.75 + 0.25 * smoothstep(-0.4, 0.8, normalize(vRN).y)); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 Nw = normalize(vRN); vec3 bw = pow(abs(Nw), vec3(4.0)); bw /= dot(bw, vec3(1.0)); float s = 0.35;
          vec3 tX = texture2D(uRN, vRP.zy * s).xyz * 2.0 - 1.0, tY = texture2D(uRN, vRP.xz * s).xyz * 2.0 - 1.0, tZ = texture2D(uRN, vRP.xy * s).xyz * 2.0 - 1.0;
          tX = vec3(tX.xy + Nw.zy, abs(tX.z) * Nw.x); tY = vec3(tY.xy + Nw.xz, abs(tY.z) * Nw.y); tZ = vec3(tZ.xy + Nw.xy, abs(tZ.z) * Nw.z);
          vec3 wN = normalize(tX.zyx * bw.x + tY.xzy * bw.y + tZ.xyz * bw.z);
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz); }`);
  };
  MATS.rock = (ctx.patch || patchMaterial)(m) || m;
  return MATS.rock;
}

// ── kinds: geometry variants + material + size + placement rules ─────────────────────────────────────────────
const GEO = {};
function geos(kind, lod, season) {
  const key = kind + ':' + lod + ':' + (kind === 'deciduous' && season === 'winter' ? 'bare' : '');
  if (GEO[key]) return GEO[key];
  const V = { conifer: 3, deciduous: 3, broadleaf: 3, palm: 4, araucaria: 2, sequoia: 2, laurel: 3, treefern: 3, cycad: 3, fern: 3, horsetail: 2, bush: 3, grass: 8, dunegrass: 5, reeds: 2, cactus: 3, barrel: 2, rock: 4, boulder: 3 }[kind] || 1;
  const out = [];
  for (let v = 0; v < V; v++) {
    const s = 1000 + v * 17 + kind.length * 3;
    switch (kind) {
      case 'conifer': out.push(conifer(s, lod)); break;
      case 'deciduous': out.push(deciduous(s, lod, season === 'winter')); break;
      case 'broadleaf': out.push(broadleaf(s, lod)); break;
      case 'palm': out.push(palm(s, lod)); break;
      case 'araucaria': out.push(araucaria(s, lod)); break;
      case 'sequoia': out.push(sequoia(s, lod)); break;
      case 'laurel': out.push(laurel(s, lod)); break;
      case 'treefern': out.push(treefern(s)); break;
      case 'cycad': out.push(cycad(s)); break;
      case 'fern': out.push(fern(s)); break;
      case 'horsetail': out.push(horsetail(s)); break;
      case 'bush': out.push(bush(s)); break;
      case 'grass': out.push(grass(s)); break;
      case 'dunegrass': out.push(grass(s, true)); break;
      case 'reeds': out.push(reeds(s)); break;
      case 'cactus': out.push(cactus(s, 'saguaro')); break;
      case 'barrel': out.push(cactus(s, 'barrel')); break;
      case 'rock': out.push(rockGeo(s, 2, 0.62)); break;
      case 'boulder': out.push(rockGeo(s, 3, 0.75)); break;
      default: out.push(bush(s));
    }
  }
  GEO[key] = out;
  return out;
}
const KIND = {
  conifer: { h: 22, r: 3.2, scale: [0.7, 1.25], sink: 0.3, lod: true, mat: 'conifer', shadow: true },
  deciduous: { h: 16, r: 5.5, scale: [0.75, 1.2], sink: 0.2, lod: true, mat: 'foliage', shadow: true },
  broadleaf: { h: 30, r: 9, scale: [0.8, 1.2], sink: 0.3, lod: true, mat: 'foliage', shadow: true },
  palm: { h: 12, r: 4, scale: [0.85, 1.15], sink: 0.2, lod: true, mat: 'palm', shadow: true },
  araucaria: { h: 32, r: 6, scale: [0.8, 1.2], sink: 0.3, lod: true, mat: 'foliage', shadow: true },
  sequoia: { h: 36, r: 6, scale: [0.75, 1.2], sink: 0.3, lod: true, mat: 'foliage', shadow: true },
  laurel: { h: 16, r: 5, scale: [0.75, 1.2], sink: 0.2, lod: true, mat: 'foliage', shadow: true },
  treefern: { h: 5, r: 2.5, scale: [0.8, 1.2], sink: 0.2, mat: 'foliage', shadow: true },
  cycad: { h: 2.5, r: 1.5, scale: [0.8, 1.3], sink: 0.1, mat: 'foliage', shadow: true },
  fern: { h: 1, r: 0.8, scale: [0.7, 1.5], sink: 0.05, mat: 'foliage', small: true },
  horsetail: { h: 2, r: 0.6, scale: [0.8, 1.4], sink: 0.05, mat: 'foliage', small: true },
  bush: { h: 2.2, r: 1.6, scale: [0.6, 1.4], sink: 0.2, mat: 'foliage', shadow: true },
  grass: { h: 0.6, r: 0.3, scale: [0.7, 1.4], sink: 0.02, mat: 'grass', small: true },
  dunegrass: { h: 0.9, r: 0.4, scale: [0.7, 1.35], sink: 0.03, mat: 'grass', small: true },
  reeds: { h: 2.2, r: 0.7, scale: [0.8, 1.3], sink: 0.1, mat: 'grass', small: true },
  cactus: { h: 8, r: 1.2, scale: [0.7, 1.2], sink: 0.1, mat: 'cactus', shadow: true },
  barrel: { h: 1.2, r: 0.6, scale: [0.8, 1.3], sink: 0.1, mat: 'cactus', shadow: true },
  rock: { h: 1, r: 1, scale: [0.5, 2.0], sink: 0.25, mat: 'rock', shadow: true, rock: true },
  boulder: { h: 3.5, r: 3, scale: [2.0, 5.0], sink: 0.5, mat: 'rock', shadow: true, rock: true },
};
const ALIAS = { tree_fern: 'treefern', 'tree-fern': 'treefern', reed: 'reeds', palms: 'palm', pine: 'conifer', spruce: 'conifer', fir: 'conifer', oak: 'deciduous', beech: 'deciduous', birch: 'deciduous', saguaro: 'cactus' };
// pre-Cenozoic replacements (no grass, no modern broadleaf trees)
const PRE = { grass: null, dunegrass: null, conifer: 'sequoia', deciduous: 'laurel', broadleaf: 'araucaria', palm: 'cycad', bush: 'fern', cactus: null, barrel: null, reeds: 'horsetail' };

// seasonal tints (linear) per kind; foliage textures are neutral grey, so these are the leaf colours
function tintFor(kind, season, R, B) {
  const pick = (list) => list[Math.floor(R() * list.length)];
  const v = 0.85 + R() * 0.3;
  const L = (h) => lin(h).map((x) => x * v);
  if (kind === 'deciduous' || kind === 'bush') {
    if (season === 'autumn') return L(pick(['#b5561c', '#c98a24', '#9c3a18', '#d0a23a', '#7a6a2a', '#b06a22']));
    if (season === 'spring') return L(pick(['#7fae3c', '#8fbc48', '#6f9e34']));
    if (season === 'winter') return kind === 'bush' ? L('#6a5a44') : [0.95, 0.92, 0.9];
    return L(pick(['#4f7a2a', '#5a8430', '#46702a', '#628a34']));
  }
  if (kind === 'broadleaf') return L(pick(['#3f7424', '#4a8028', '#35681f']));
  if (kind === 'dunegrass') return L(pick(['#9aa05c', '#a9a468', '#86925a', '#b3a874']));   // marram: pale, straw-green
  if (kind === 'grass' || kind === 'reeds') {
    const g = (B.grass && (B.grass[season] || B.grass.summer)) || ['#5a7a2e', '#6b7f2e', '#8f8a45'];
    const dry = R() < 0.85 ? Math.floor(R() * 2) : 2;
    const c = lin(g[dry]).map((x) => x * (kind === 'reeds' ? 1.1 : 1.05) * v * (dry === 2 && kind === 'grass' ? 0.72 : 1));
    return c;
  }
  if (kind === 'conifer') return [v, v, v];
  if (kind === 'rock' || kind === 'boulder') { const c = lin(B.rock || '#8a857a'); return c.map((x) => x * 1.6 * (0.85 + R() * 0.3)); }
  return [v, v * 1.02, v * 0.95];
}

function materialFor(kind, ctx) {
  const K = KIND[kind];
  switch (K.mat) {
    case 'conifer': return coniferMaterial(ctx);
    case 'grass': return foliageMaterial(ctx, 'grass', { sway: 1.6, stiff: 2.5, env: 0.3, upNormal: true });
    case 'palm': return foliageMaterial(ctx, 'palm', { sway: 1, stiff: 0.012, flex: true });
    case 'cactus': return plainMaterial(ctx, 'cactus', { roughness: 0.7 });
    case 'rock': return rockMaterial(ctx);
    default: return foliageMaterial(ctx, 'foliage', { sway: 1, stiff: 0.012 });
  }
}

// build instanced meshes for a list of placements [x, y, z, scale, rotY, variant, tint[3], lodFlag]
function instance(kind, list, season, ctx, group, noReflect) {
  const K = KIND[kind];
  const out = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
  for (const lod of K.lod ? [0, 1] : [0]) {
    const G = geos(kind, lod, season);
    for (let v = 0; v < G.length; v++) {
      const items = list.filter((it) => it[5] % G.length === v && (it[7] | 0) === lod);
      if (!items.length) continue;
      const im = new THREE.InstancedMesh(G[v], materialFor(kind, ctx), items.length);
      items.forEach((it, i) => {
        q.setFromAxisAngle(Y, it[4]);
        if (it[8]) { const tilt = new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(...it[8])); q.premultiply(tilt); }
        ps.set(it[0], it[1], it[2]); sc.setScalar(it[3]);
        m4.compose(ps, q, sc); im.setMatrixAt(i, m4);
        col.setRGB(it[6][0], it[6][1], it[6][2]); im.setColorAt(i, col);
      });
      im.castShadow = !!K.shadow; im.receiveShadow = true; im.frustumCulled = false;
      im.name = 'nature.' + kind;
      if (K.small && noReflect) noReflect.push(im);
      group.add(im);
      out.push(im);
    }
  }
  return out;
}

// ── scatter for a whole world ──────────────────────────────────────────────────────────────────────────────────
export async function scatterFlora(o) {
  const { B, ground, T, season, pre, vegetation, level, seed, ctx, root, clear } = o;
  const group = new THREE.Group(); group.name = 'nature.flora'; root.add(group);
  FU.uSnowAmt.value = o.snowCover ?? 0;
  const R = rng(seed * 101 + 7);
  const lists = {};
  const push = (kind, it) => { (lists[kind] || (lists[kind] = [])).push(it); };
  const hash = new Map();                                              // clearance spatial hash (20 m cells)
  const addObstacle = (x, z, y0, h, r) => { const k = Math.floor(x / 20) + ',' + Math.floor(z / 20); if (!hash.has(k)) hash.set(k, []); hash.get(k).push([x, z, y0, h, r]); };
  const isClear = (x, z, pad) => { for (const c of clear) { const dx = x - c[0], dz = z - c[1]; if (dx * dx + dz * dz < (c[2] + pad) * (c[2] + pad)) return false; } return true; };
  const snowLine = o.world && B.snowLine ? B.snowLine : 1e9;

  // what the biome grows (with period swaps) and the density scale
  let rules = (B.flora || []).map(([k, d, rule]) => [ALIAS[k] || k, d, rule]);
  if (o.world.flora) rules = o.world.flora.map((f) => [ALIAS[f.kind || f[0]] || f.kind || f[0], f.density ?? f[1] ?? 1, f.rule ?? f[2] ?? 'any']);
  if (pre) rules = rules.map(([k, d, r]) => [PRE[k] === undefined ? k : PRE[k], d, r]).filter((x) => x[0]);
  if (pre && B.forest > 0.3) rules.push(['araucaria', 8, 'forest'], ['treefern', 14, 'forest'], ['cycad', 10, 'open'], ['fern', 60, 'forest']);
  if (name(o) === 'desert' && (o.world.vegetation ?? 0) > 0.3) rules.push(['palm', 1.5, 'oasis'], ['barrel', 0.6, 'any'], ['cactus', 0.4, 'any']);
  if (name(o) === 'coast' && o.world.palms) rules.push(['palm', 10, 'beach']);
  const vmul = clamp(vegetation / 0.6, 0, 2.5);
  const coast = T?.shapeName === 'coast';
  if (coast && !pre && rules.some((x) => x[0] === 'grass')) rules.push(['dunegrass', 1.1, 'dune', 'new']);   // marram on the dunes behind the beach

  const Rtrees = 760, Rgrass = o.world.grass_radius ?? 80, Rsmall = 240;
  const t0 = performance.now();
  const clearDist = (x, z, pad) => { let d = 1e9; for (const c of clear) d = Math.min(d, Math.hypot(x - c[0], z - c[1]) - (c[2] + pad)); return d; };

  // ground scatter (grass, marram, ferns, reeds): soft edges. Density AND size fall off over several metres near roads,
  // water, clearings and the beach, with sparse single plants beyond the edge; the edges wander (noise), never a
  // ruled line. Own random stream: the trees, bushes and rocks after it keep exactly the placements they had.
  function placeSmall(kind, dens, rule, K) {
    const Rs = rng((seed * 131 + kind.length * 977 + rule.length * 31 + 5) >>> 0);
    const grassy = kind === 'grass' || kind === 'dunegrass';
    const density = (kind === 'grass' ? dens * 4.5 : kind === 'dunegrass' ? dens : dens / 10000) * vmul;
    if (density <= 0) return;
    const Rmax = grassy ? Rgrass : Rsmall;
    const cell = Math.max(0.55, Math.sqrt(1 / density)), n = Math.ceil(Rmax / cell);
    if (n * n * 4 > 6e6) return;
    const duneTint = lin('#a3a266'), strawTint = lin('#b3a684'), snowC = clamp(o.snowCover ?? 0);   // under snow: dead grass, mostly buried
    for (let gz = -n; gz < n; gz++) for (let gx = -n; gx < n; gx++) {
      const x = (gx + Rs()) * cell, z = (gz + Rs()) * cell, rS = Math.hypot(x, z);
      if (rS > Rmax) continue;
      let p = grassy ? clamp((1 - sr(rS, Rmax * 0.2, Rmax)) * (0.8 + 0.5 * (NZ.noise2(x / 13, z / 13) + 0.5))) : 0.45 * (1 - sr(rS, Rmax * 0.85, Rmax));
      const m = ground.fields.masks(x, z), wet = m.water;
      const jit = NZ.noise2(x / 6.1 + 17.3, z / 6.1 - 4.1) * 1.8;
      switch (rule) {
        case 'forest': p *= sr(ground.fields.forestAt(x, z), 0.35, 0.65); break;
        case 'copse': { const c = NZ.fbm2(x / 70 + seed, z / 70, 3); p *= Math.max(sr(c, 0.3, 0.42), sr(ground.fields.forestAt(x, z), 0.35, 0.65)); break; }
        case 'open': p *= 1 - sr(ground.fields.forestAt(x, z), 0.3, 0.6) * 0.8; break;
        case 'margin': { const e = ground.fields.fieldEdge(x, z) + jit * 0.7; p *= grassy ? lerp(0.12, 1, 1 - sr(e, 2.4, 6.5)) : 1 - sr(e, 1.6, 3.2); break; }
        case 'bank': p *= sr(wet, 0.8, 3) * (1 - sr(wet, 8, 22)); break;
        case 'shallows': p *= sr(wet, -5.5, -3.5) * (1 - sr(wet, 0.6, 2.2)); break;
        case 'shore': p *= wet > -12 && wet < 18 ? 1 : 0.08; break;
        case 'dune': p *= coast ? sr(wet + jit * 2.6, 17, 27) * (1 - sr(wet + jit * 2.6, 44, 60)) * sr(NZ.fbm2(x / 7 + 3.3, z / 7 - 1.1, 2), 0.02, 0.3) : 0; break;
        default: break;
      }
      if (p <= 0.002) continue;
      // meadow grass grows in patches (denser and taller in some, short and thin in others), not an even carpet
      const patch = kind === 'grass' ? sr(NZ.fbm2(x / 5.5 + 21.7, z / 5.5 - 9.3, 2), -0.32, 0.26) : 1;
      p *= 0.65 + 0.35 * patch;
      const eRoad = sr(m.road + jit * 0.5, 0.1, 2.8);
      const eWet = rule === 'shallows' || rule === 'shore' || rule === 'dune' ? 1 : sr(wet + jit * 0.8, 0.6, 5);
      const cd = clearDist(x, z, -8) + jit * 1.4, eClear = sr(cd, -2, 4.5), tClear = sr(cd, -6.5, -2);
      let eSand = 1, tSand = 1, inl = 1e3;
      if (coast && rule !== 'dune' && rule !== 'shore' && rule !== 'shallows') { inl = wet + jit * 2.6; eSand = sr(inl, 30, 50); tSand = sr(inl, 18, 30); }
      const edge = Math.min(eRoad, eWet, eClear, eSand), tail = Math.min(eRoad, eWet, Math.max(eClear, tClear), Math.max(eSand, tSand));
      const y = ground.height(x, z);
      if (level !== null && rule !== 'shallows' && rule !== 'shore' && y < level + 0.15) continue;
      const nrmv = ground.normal(x, z), slope = 1 - nrmv[1];
      p *= Math.max(Math.pow(edge, 1.25), 0.08 * tail) * (1 - sr(slope, 0.36, 0.5));
      if (name(o) === 'mountains') p *= 1 - sr(y, snowLine - 190, snowLine - 130);
      if (grassy) p *= 1 - 0.65 * snowC;
      if (Rs() > p) continue;
      const s = lerp(K.scale[0], K.scale[1], Rs()) * (grassy ? 1 - 0.35 * sr(rS, Rmax * 0.5, Rmax) : 1) * lerp(0.32, 1, Math.pow(edge, 0.7)) * (0.82 + 0.3 * patch) * (grassy ? 1 - 0.4 * snowC : 1);
      let tint = tintFor(kind, season, Rs, B);
      if (coast && kind === 'grass') tint = lerp3(tint, duneTint.map((v) => v * (0.85 + Rs() * 0.3)), 0.55 * (1 - sr(inl, 44, 90)));   // drier, paler grass near the dunes
      if (grassy && snowC > 0) tint = lerp3(tint, strawTint.map((v) => v * (0.85 + Rs() * 0.3)), 0.8 * snowC);
      const tilt = kind === 'grass' || kind === 'dunegrass' || kind === 'fern' ? [nrmv[0] * 0.5, 1, nrmv[2] * 0.5] : null;
      push(kind, [x, y - K.sink * s, z, s, Rs() * TAU, Math.floor(Rs() * 97), tint, 0, tilt ? nrm(tilt) : null]);
    }
  }
  // the draws the old small-plant loop made, replayed exactly (no plants placed), so the shared stream R stays in step
  function replayOld(kind, dens, rule, K) {
    const perM2 = kind === 'grass' ? dens * 4.5 : dens / 10000;
    const density = perM2 * vmul;
    if (density <= 0) return;
    const Rmax = kind === 'grass' ? Rgrass : Rsmall;
    const cell = Math.max(0.55, Math.sqrt(1 / density)), n = Math.ceil(Rmax / cell);
    if (n * n * 4 > 6e6) return;
    for (let gz = -n; gz < n; gz++) for (let gx = -n; gx < n; gx++) {
      const x = (gx + R()) * cell, z = (gz + R()) * cell, rS = Math.hypot(x, z);
      if (rS > Rmax) { R(); R(); continue; }
      let p = kind === 'grass' ? 1 - sr(rS, Rmax * 0.2, Rmax) * (0.7 + 0.3 * (NZ.noise2(x / 13, z / 13) + 0.5)) : 1 - 0.55 * sr(rS, 350, Rmax);
      const m = ground.fields.masks(x, z);
      if (m.road < 0.4) continue;
      const wet = m.water;
      switch (rule) {
        case 'forest': p *= sr(ground.fields.forestAt(x, z), 0.35, 0.65); break;
        case 'copse': { const c = NZ.fbm2(x / 70 + seed, z / 70, 3); p *= Math.max(sr(c, 0.3, 0.42), sr(ground.fields.forestAt(x, z), 0.35, 0.65)); break; }
        case 'open': p *= 1 - sr(ground.fields.forestAt(x, z), 0.3, 0.6) * 0.8; break;
        case 'margin': { const e = ground.fields.fieldEdge(x, z); p *= kind === 'grass' ? (e < 4 ? 1 : 0.12) : (e < 2.2 ? 1 : 0); break; }
        case 'bank': p *= wet > 1.5 && wet < 22 ? 1 - sr(wet, 8, 22) : 0; break;
        case 'shallows': p *= wet > -5 && wet < 1.5 ? 1 : 0; break;
        case 'shore': p *= wet > -12 && wet < 18 ? 1 : 0.08; break;
        case 'beach': p *= wet > 8 && wet < 40 ? 1 : 0; break;
        case 'oasis': p *= NZ.fbm2(x / 160 + 3, z / 160, 3) > 0.35 ? 1 : 0; break;
        default: break;
      }
      if (R() > p) { R(); continue; }
      if (rule !== 'shallows' && rule !== 'shore' && wet < 0.8) continue;
      if (!isClear(x, z, -8)) continue;
      const y = ground.height(x, z);
      if (level !== null && rule !== 'shallows' && rule !== 'shore' && y < level + 0.15) continue;
      const nrmv = ground.normal(x, z);
      if (1 - nrmv[1] > 0.45) continue;
      if (y > snowLine - 150 && name(o) === 'mountains') continue;
      R(); tintFor(kind, season, R, B); R(); R();
    }
  }
  for (const [kind, dens, rule, isNew] of rules) {
    const K = KIND[kind];
    if (!K) continue;
    if (K.small) { if (!isNew) replayOld(kind, dens, rule, K); placeSmall(kind, dens, rule, K); continue; }
    const perM2 = kind === 'grass' ? dens * 4.5 : dens / 10000;
    const density = perM2 * vmul;
    if (density <= 0) continue;
    const Rmax = kind === 'grass' ? Rgrass : K.small ? Rsmall : rule === 'forest' || rule === 'copse' || rule === 'margin' ? Rtrees : 620;
    const cell = Math.max(0.55, Math.sqrt(1 / density));
    const n = Math.ceil(Rmax / cell);
    if (n * n * 4 > 6e6) continue;
    for (let gz = -n; gz < n; gz++) for (let gx = -n; gx < n; gx++) {
      const x = (gx + R()) * cell, z = (gz + R()) * cell;
      const rS = Math.hypot(x, z);
      if (rS > Rmax) { R(); R(); continue; }
      // distance falloff: full density near the stage, thinner farther out
      const fall = kind === 'grass' ? 1 - sr(rS, Rmax * 0.2, Rmax) * (0.7 + 0.3 * (NZ.noise2(x / 13, z / 13) + 0.5)) : 1 - 0.55 * sr(rS, 350, Rmax);
      let p = fall;
      const m = ground.fields.masks(x, z);
      if (m.road < (K.r > 2 ? 2.5 : 0.4)) continue;
      const wet = m.water;
      switch (rule) {
        case 'forest': p *= sr(ground.fields.forestAt(x, z), 0.35, 0.65); break;
        case 'copse': { const c = NZ.fbm2(x / 70 + seed, z / 70, 3); p *= Math.max(sr(c, 0.3, 0.42), sr(ground.fields.forestAt(x, z), 0.35, 0.65)); break; }
        case 'open': p *= 1 - sr(ground.fields.forestAt(x, z), 0.3, 0.6) * 0.8; break;
        case 'margin': { const e = ground.fields.fieldEdge(x, z); p *= kind === 'grass' ? (e < 4 ? 1 : 0.12) : (e < 2.2 ? 1 : 0); break; }
        case 'bank': p *= wet > 1.5 && wet < 22 ? 1 - sr(wet, 8, 22) : 0; break;
        case 'shallows': p *= wet > -5 && wet < 1.5 ? 1 : 0; break;
        case 'shore': p *= wet > -12 && wet < 18 ? 1 : 0.08; break;
        case 'beach': p *= wet > 8 && wet < 40 ? 1 : 0; break;
        case 'oasis': p *= NZ.fbm2(x / 160 + 3, z / 160, 3) > 0.35 ? 1 : 0; break;
        default: break;
      }
      if (R() > p) { R(); continue; }
      if (rule !== 'shallows' && rule !== 'shore' && wet < (K.small ? 0.8 : 2.5)) continue;
      if (!isClear(x, z, K.small ? -8 : K.r * 0.6)) continue;
      const y = ground.height(x, z);
      if (level !== null && rule !== 'shallows' && rule !== 'shore' && y < level + 0.15) continue;
      const nrmv = ground.normal(x, z), slope = 1 - nrmv[1];
      if (!K.rock && slope > (K.small ? 0.45 : 0.32)) continue;
      if (!K.rock && y > snowLine - 150 && name(o) === 'mountains') continue;
      const s = lerp(K.scale[0], K.scale[1], R()) * (kind === 'grass' ? 1 - 0.35 * sr(rS, Rmax * 0.5, Rmax) : 1);
      const lodF = K.lod && rS > 260 ? 1 : 0;
      const tint = tintFor(kind, season, R, B);
      const tilt = K.rock ? nrmv : (kind === 'grass' || kind === 'fern' ? [nrmv[0] * 0.5, 1, nrmv[2] * 0.5] : null);
      push(kind, [x, y - K.sink * s, z, s, R() * TAU, Math.floor(R() * 97), tint, lodF, tilt ? nrm(tilt) : null]);
      if (!K.small) addObstacle(x, z, y, K.h * s, K.r * s * (kind === 'conifer' ? 0.8 : 1));
    }
  }
  const counts = {};
  const smallMeshes = [];
  for (const [kind, list] of Object.entries(lists)) { counts[kind] = list.length; const ims = instance(kind, list, season, ctx, group, ctx.noReflect || (ctx.noReflect = [])); if (KIND[kind].small) smallMeshes.push(...ims); }
  console.log('[nature.flora]', JSON.stringify(counts), Math.round(performance.now() - t0), 'ms');

  // surfaces the other builders lay on the ground after the world (town streets: meshes named 'road', ribbons of rows
  // of 5 vertices; anything with userData.groundMask): no grass or ferns on them, a soft 1.5 m verge. Once, at the
  // first update, when every item exists.
  let masked = false;
  function maskSurfaces() {
    masked = true;
    const top = ctx.world3 || ctx.scene;
    if (!top || !smallMeshes.length) return;
    top.updateMatrixWorld(true);
    const segs = [], v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    top.traverse((m) => {
      if (!m.isMesh || !(m.name === 'road' || m.userData?.groundMask)) return;
      const P = m.geometry?.attributes?.position;
      if (!P || P.count < 10 || P.count % 5) return;
      const rows = P.count / 5, C = [];
      for (let i = 0; i < rows; i++) {
        v.fromBufferAttribute(P, i * 5 + 2).applyMatrix4(m.matrixWorld); a.fromBufferAttribute(P, i * 5).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(P, i * 5 + 4).applyMatrix4(m.matrixWorld);
        C.push([v.x, v.z, Math.hypot(a.x - b.x, a.z - b.z) / 2]);
      }
      for (let i = 0; i < rows - 1; i++) segs.push([C[i][0], C[i][1], C[i + 1][0], C[i + 1][1], Math.max(C[i][2], C[i + 1][2])]);
    });
    if (!segs.length) return;
    const H = new Map(), cellOf = (x, z) => Math.floor(x / 12) + ',' + Math.floor(z / 12);
    for (const s of segs) {
      const x0 = Math.min(s[0], s[2]) - s[4] - 2, x1 = Math.max(s[0], s[2]) + s[4] + 2, z0 = Math.min(s[1], s[3]) - s[4] - 2, z1 = Math.max(s[1], s[3]) + s[4] + 2;
      for (let gx = Math.floor(x0 / 12); gx <= Math.floor(x1 / 12); gx++) for (let gz = Math.floor(z0 / 12); gz <= Math.floor(z1 / 12); gz++) { const k = gx + ',' + gz; if (!H.has(k)) H.set(k, []); H.get(k).push(s); }
    }
    const m4 = new THREE.Matrix4(), ps = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    let hidden = 0;
    for (const im of smallMeshes) {
      let touched = false;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4); m4.decompose(ps, q, sc);
        const L = H.get(cellOf(ps.x, ps.z)); if (!L) continue;
        let d = 1e9;
        for (const [ax, az, bx, bz, hw] of L) {
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-6, t = clamp(((ps.x - ax) * dx + (ps.z - az) * dz) / l2);
          d = Math.min(d, Math.hypot(ax + dx * t - ps.x, az + dz * t - ps.z) - hw);
        }
        const k = sr(d + 0.6 * NZ.noise2(ps.x / 3.1, ps.z / 3.1), 0.2, 1.7);
        if (k >= 1) continue;
        const hsh = (Math.sin(ps.x * 12.9898 + ps.z * 78.233) * 43758.5453) % 1;
        sc.multiplyScalar(k > 0.05 && Math.abs(hsh) < k ? 0.4 + 0.6 * k : 0); hidden += sc.x === 0 ? 1 : 0;
        m4.compose(ps, q, sc); im.setMatrixAt(i, m4); touched = true;
      }
      if (touched) im.instanceMatrix.needsUpdate = true;
    }
    console.log('[nature.flora] masked', hidden, 'plants on', segs.length, 'street segments');
  }

  function clearance(x, y, z) {
    let best = 1e9;
    const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      const L = hash.get((cx + ox) + ',' + (cz + oz)); if (!L) continue;
      for (const [tx, tz, y0, h, r] of L) {
        const dxz = Math.hypot(x - tx, z - tz) - r * (y > y0 + h * 0.25 ? 1 : 0.15);
        const dy = y < y0 ? y0 - y : y > y0 + h ? y - (y0 + h) : 0;
        best = Math.min(best, Math.hypot(Math.max(dxz, 0), dy));
      }
    }
    return best;
  }
  return {
    group, counts, clearance,
    update(t) { if (!masked) maskSurfaces(); FU.uTime.value = t; FU.uWind.value = clamp(ctx.weatherSpec?.wind ?? ctx.weather?.wind ?? o.world.wind ?? 0.35, 0, 1.5); setWindDir(ctx); },
  };
}
const name = (o) => o.biome;

// a palm for other modules (the hurricane and tsunami FX): one mesh, base at the origin, 8.5-13 m, lit, bending and
// streaming in the scene's wind like the palms of the world
export function palmMesh(ctx, seed = 1) {
  const G = geos('palm', 0);
  const m = new THREE.Mesh(G[Math.abs(seed | 0) % G.length], materialFor('palm', ctx));
  m.castShadow = true; m.receiveShadow = true; m.userData.noQA = true; m.name = 'nature.palm';
  return m;
}

// ── director-placed plants: { kind: 'flora.palm', at, count, formation: 'scatter|line|cluster', size, heading, scale } ──
export async function build(kind, item, ctx) {
  const k0 = kind.split('.')[1] || 'bush';
  let k = ALIAS[k0] || k0;
  if (k === 'cactus' && (item.params?.type === 'barrel' || item.type === 'barrel')) k = 'barrel';
  if (!KIND[k]) k = 'bush';
  const K = KIND[k];
  const root = new THREE.Group(); root.name = kind;
  const R = rng((item.seed ?? 1) * 977 + k.length);
  const at = item.at || [0, 0], n = Math.max(1, item.count ?? 1);
  const size = [].concat(item.size ?? [n > 1 ? Math.sqrt(n) * K.r * 2.2 : 0]);
  const sx = size[0] ?? 0, sz = size[1] ?? sx;
  const hd = (item.heading ?? 0) * Math.PI / 180;
  const gh = ctx.ground?.height || (() => 0);
  const season = ctx.world?.season || item.season || 'summer';
  const list = [];
  let maxH = 0;
  for (let i = 0; i < n; i++) {
    let lx = 0, lz = 0;
    if (n > 1) {
      if (item.formation === 'line') { lx = 0; lz = (i / (n - 1) - 0.5) * (sz || n * K.r * 2); lx += (R() - 0.5) * K.r * 0.4; }
      else { const a = R() * TAU, rr = Math.sqrt(R()); lx = Math.cos(a) * rr * sx / 2; lz = Math.sin(a) * rr * sz / 2; }
    }
    const x = at[0] + lx * Math.cos(hd) - lz * Math.sin(hd), z = at[1] + lx * Math.sin(hd) + lz * Math.cos(hd);
    const s = (item.scale ?? item.params?.scale ?? 1) * lerp(K.scale[0], K.scale[1], R());
    const y = gh(x, z);
    maxH = Math.max(maxH, K.h * s);
    list.push([x, y - K.sink * s, z, s, n > 1 ? R() * TAU : hd, Math.floor(R() * 97), tintFor(k, season, R, ctx.biome || {}), 0, K.rock ? ctx.ground?.normal?.(x, z) || null : null]);
  }
  instance(k, list, season, ctx, root, null);
  root.userData.noQA = n > 40;
  setWindDir(ctx);
  return { root, radius: Math.max(sx, sz) / 2 + K.r, height: maxH, snapped: true, contact: false, update(t) { FU.uTime.value = t; }, anchors: {} };
}
