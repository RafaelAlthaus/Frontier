// rooms.js — distinct small sets (Q9, 26 Sep 2026), routed from interiors.js. Every set is a real place of its own, so no
// set stands in for two places (QUALITY.md H8):
//   interior.storm_cellar   Oklahoma storm cellar: cinder-block room, concrete steps up to a slanted steel hatch (daylight
//                           leaking round it, rattling), shelves of jars / water jugs / radio, a bench, a bare bulb
//   interior.small_room     style bathroom (tub, tiles, toilet, sink, no window) | closet (shelves, coats) | hallway
//   interior.cell           1902 stone prison cell: thick walls, heavy door with a barred grate, high slit window with a
//                           light shaft, straw mat; `glow` t: orange light and smoke through the grate and the slit
//   landmark.boat_sheds     a row of arched stone vaults (Herculaneum fornici) under a terrace, opening to the beach,
//                           with seated huddled people (`people`)
// Local frame: floor at the ground under `at` (y 0), +Z = local front. heading as in interiors.js: rotation.y =
// yawFromHeading(h) - PI, so heading 180 turns the set by 180 deg (world = at - local), heading 0 keeps local = world.
import * as THREE from 'three';
import * as TX from './textures.js';
import { plain, masonry, setGrime, triplanar } from '../shared/materials.js';
import { rock as rockTex } from '../shared/textures.js';
import { yawFromHeading } from './common.js';
import { rng, clamp, smooth, lerp } from '../shared/util.js';

const TAU = Math.PI * 2;
// box with UVs in metres on every face
const box = (w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); } return g; };
const add = (parent, g, m, x = 0, y = 0, z = 0, o = {}) => { const s = new THREE.Mesh(g, m); s.position.set(x, y, z); if (o.ry) s.rotation.y = o.ry; if (o.rx) s.rotation.x = o.rx; if (o.rz) s.rotation.z = o.rz; s.castShadow = o.cast ?? true; s.receiveShadow = true; parent.add(s); return s; };
function rbox(w, h, d, r, seg = 2) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2 + 1, seg * 2 + 1, seg * 2 + 1), p = g.attributes.position, v = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), cx = clamp(x, -hx, hx), cy = clamp(y, -hy, hy), cz = clamp(z, -hz, hz); v.set(x - cx, y - cy, z - cz); const l = v.length(); if (l > 1e-6) v.multiplyScalar(r / l); p.setXYZ(i, cx + v.x, cy + v.y, cz + v.z); }
  g.computeVertexNormals(); return g;
}
function rep(t, m) { const c = t.clone(); c.needsUpdate = true; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(1 / m, 1 / m); return c; }
function canvasTex(w, h, draw, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; }
// a wall with rectangular openings: along local x (length L) at z, from y0 to y1, thickness th; holes [{x0, x1, y0, y1}]
function wallWithHoles(parent, m, L, z, th, H, holes = [], x0 = -L / 2) {
  const xs = new Set([x0, x0 + L]); holes.forEach((h) => { xs.add(h.x0); xs.add(h.x1); });
  const X = [...xs].sort((a, b) => a - b);
  for (let i = 0; i < X.length - 1; i++) {
    const a = X[i], b = X[i + 1], mid = (a + b) / 2, hs = holes.filter((h) => mid > h.x0 && mid < h.x1).sort((p, q) => p.y0 - q.y0);
    let y = 0;
    for (const h of hs) { if (h.y0 > y + 1e-3) add(parent, box(b - a, h.y0 - y, th), m, mid, (y + h.y0) / 2, z); y = Math.max(y, h.y1); }
    if (H > y + 1e-3) add(parent, box(b - a, H - y, th), m, mid, (y + H) / 2, z);
  }
}
// deterministic flicker: 3-4 dips over 0.45 s after each t in list
function flickerK(t, list) {
  let k = 1;
  for (const t0 of list || []) { const u = t - t0; if (u < 0 || u > 0.5) continue; const d = [0.0, 0.09, 0.16, 0.27, 0.34, 0.43]; for (let i = 0; i < d.length - 1; i += 2) if (u >= d[i] && u < d[i + 1]) k = Math.min(k, i === 2 ? 0.35 : 0.05); }
  return k;
}
let TEX = null;
function tex() {
  if (TEX) return TEX;
  setGrime(TX.grime(256));
  TEX = {
    block: TX.masonry({ size: 512, meters: 2.4, courseH: 0.2, blockL: [0.4, 0.4], tones: ['#8E8C86', '#96948D', '#86847D', '#9C9990', '#8A8880'], mortar: '#ABA89F', bevel: 0.008, chip: 0.25, seed: 11, dirt: 0.3, stoneRough: 0.92 }),
    stone: TX.masonry({ size: 512, meters: 3, courseH: 0.34, blockL: [0.35, 0.8], tones: ['#6E665A', '#7A7062', '#62594E', '#817666', '#5A5248'], mortar: '#4A443C', bevel: 0.03, chip: 0.45, seed: 21, dirt: 0.6, stoneRough: 0.9 }),
    flags: TX.masonry({ size: 512, meters: 3, courseH: 0.5, blockL: [0.45, 0.9], tones: ['#5A544B', '#645D52', '#524C44', '#6B6358'], mortar: '#3E3A34', bevel: 0.02, chip: 0.6, seed: 23, dirt: 0.5, stoneRough: 0.85 }),
    tuff: TX.masonry({ size: 512, meters: 3, courseH: 0.12, blockL: [0.12, 0.12], tones: ['#9E8866', '#927E5E', '#A89270', '#8A785A', '#B09A78'], mortar: '#B8A888', bevel: 0.012, chip: 0.4, seed: 33, dirt: 0.55, stoneRough: 0.9 }),
    brick: TX.masonry({ size: 512, meters: 2, courseH: 0.075, blockL: [0.28, 0.32], tones: ['#8A4A34', '#7C4230', '#94543C', '#733C2C'], mortar: '#B8A890', bevel: 0.008, chip: 0.4, seed: 35, dirt: 0.4, stoneRough: 0.9 }),
    stucco: TX.stucco(256),
    planks: TX.planks({ size: 512, meters: 2, boardW: 0.16, tone: '#4A3626', tone2: '#6A4E36', seed: 9 }),
    oldwood: TX.planks({ size: 512, meters: 2, boardW: 0.2, tone: '#3A2C20', tone2: '#554030', seed: 17, pitch: 0.4 }),
    tiles: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#A9A69C'; g.fillRect(0, 0, w, h); const n = 8, s = w / n, R = rng(4); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 232 + Math.floor(R() * 14); g.fillStyle = `rgb(${v},${v - 2},${v - 8})`; g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); } }),
    floorTiles: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#5E6266'; g.fillRect(0, 0, w, h); const n = 16, s = w / n, R = rng(6); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 150 + Math.floor(R() * 30), b = (i + j) % 7 === 0 ? 40 : 0; g.fillStyle = `rgb(${v - b},${v + 4 - b},${v + 10 - b})`; g.fillRect(i * s + 1, j * s + 1, s - 2, s - 2); } }),
    straw: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#7A6436'; g.fillRect(0, 0, w, h); const R = rng(8); for (let k = 0; k < 2600; k++) { const x = R() * w, y = R() * h, a = (R() - 0.5) * 0.9, L = 8 + R() * 22, v = 120 + R() * 110; g.strokeStyle = `rgba(${v},${v * 0.82},${v * 0.42},0.85)`; g.lineWidth = 0.6 + R() * 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); } }),
    concrete: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#8C8A84'; g.fillRect(0, 0, w, h); const R = rng(12); for (let k = 0; k < 900; k++) { const v = 110 + R() * 60; g.fillStyle = `rgba(${v},${v - 1},${v - 5},0.25)`; const r = 1 + R() * 5; g.beginPath(); g.arc(R() * w, R() * h, r, 0, TAU); g.fill(); } for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(60,55,48,0.08)'; g.beginPath(); g.arc(R() * w, R() * h, 20 + R() * 50, 0, TAU); g.fill(); } }),
  };
  return TEX;
}
const std = (o) => plain(o);

// ── storm cellar ─────────────────────────────────────────────────────────────────────────────────────────────────
// room x -1.3..1.3, z -1.8..1.8, 2.05 high; the stair shaft leaves through the north wall (-z) at x -0.55..0.55 and
// rises to the hatch 2.2 m up at z -3.3; bench on the west wall (seat top 0.46, x -1.3..-0.88, z -0.35..1.6);
// shelves on the east wall (x 0.92..1.3, z -0.5..1.3)
function stormCellar(o, ctx) {
  const T = tex(), g = new THREE.Group(), lights = [], upd = [];
  const W = 2.6, D = 3.6, H = 2.05, th = 0.2;
  const blockM = masonry(T.block, { grime: 0.45, foot: 0.5, streak: 0.3 });
  const concM = std({ map: rep(T.concrete, 2.5), color: 0xB8B4AC, roughness: 0.95 });
  const ceilM = std({ map: rep(T.concrete, 3), color: 0x9C9A94, roughness: 0.95 });
  const woodM = std({ map: rep(T.oldwood.map, 2), roughness: 0.8 });
  const steelM = std({ color: 0x5C5F60, roughness: 0.55, metalness: 0.6 });
  const darkM = std({ color: 0x2A2A2A, roughness: 0.7, metalness: 0.3 });
  add(g, box(W + 2 * th, 0.2, D + 2 * th), concM, 0, -0.1, 0);
  add(g, box(W + 2 * th, 0.25, D + 2 * th), ceilM, 0, H + 0.125, 0);
  add(g, box(th, H, D + 2 * th), blockM, -W / 2 - th / 2, H / 2, 0); add(g, box(th, H, D + 2 * th), blockM, W / 2 + th / 2, H / 2, 0);
  add(g, box(W, H, th), blockM, 0, H / 2, D / 2 + th / 2);
  wallWithHoles(g, blockM, W, -D / 2 - th / 2, th, H, [{ x0: -0.55, x1: 0.55, y0: 0, y1: H }]);
  // the stair shaft: 11 concrete steps from z -0.9 up to z -3.3, side walls, a sloping soffit, the slanted hatch
  const nSt = 11, rise = 2.2 / nSt, run = 0.215, z0 = -0.9;
  for (let k = 0; k < nSt; k++) add(g, box(1.1, rise * (k + 1), run), concM, 0, rise * (k + 1) / 2, z0 - run * (k + 0.5));
  const zTop = z0 - run * nSt;
  const zs1 = zTop - 0.25;
  for (const s of [1, -1]) add(g, box(th, H + 0.9, -D / 2 - zs1), blockM, s * (0.55 + th / 2), (H + 0.9) / 2, (zs1 - D / 2) / 2);
  add(g, box(1.1 + 2 * th, 0.9 + H, th), blockM, 0, (H + 0.9) / 2, zTop - 0.25 - th / 2);
  // the hatch: two steel leaves on a slope from (y 2.3, z -1.95) to (y 2.85, z -3.45), light leaking round the edges
  const hatch = new THREE.Group(); hatch.position.set(0, 2.3, -1.95); hatch.rotation.x = Math.atan2(0.55, 1.5); g.add(hatch);
  const hl = Math.hypot(0.55, 1.5), leaves = [];
  for (const s of [1, -1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.56, 0, 0); hatch.add(pivot);
    const leaf = add(pivot, box(0.55, 0.035, hl), steelM, -s * 0.28, 0, -hl / 2);
    for (let k = 0; k < 3; k++) add(pivot, box(0.5, 0.03, 0.05), darkM, -s * 0.28, -0.03, -hl * (k + 0.5) / 3);
    add(pivot, box(0.04, 0.05, 0.18), darkM, -s * 0.05, -0.05, -hl * 0.55);
    leaves.push({ pivot, s }); void leaf;
  }
  const gapM = std({ color: 0x000000, emissive: 0xDDE8FF, emissiveIntensity: 3, roughness: 1 });
  add(hatch, box(0.012, 0.02, hl), gapM, 0, 0.01, -hl / 2, { cast: false });
  add(hatch, box(1.14, 0.02, 0.012), gapM, 0, 0.01, -hl, { cast: false }); add(hatch, box(1.14, 0.02, 0.012), gapM, 0, 0.01, 0.0, { cast: false });
  for (const s of [1, -1]) add(hatch, box(0.012, 0.02, hl), gapM, s * 0.575, 0.01, -hl / 2, { cast: false });
  add(g, box(1.1 + 2 * th, 0.2, 0.3), concM, 0, 2.2, -1.85);                                                  // the collar at the low edge
  const sky = new THREE.PointLight(0xC9D8F2, 1.4, 7, 2); sky.position.set(0, 1.7, -2.6); g.add(sky); lights.push(sky);
  // bench on the west wall
  const bench = new THREE.Group(); bench.position.set(-1.09, 0, 0.62); g.add(bench);
  add(bench, box(0.42, 0.05, 1.95), woodM, 0, 0.435, 0);
  for (const z of [-0.85, 0, 0.85]) { add(bench, box(0.06, 0.41, 0.06), woodM, 0.14, 0.205, z); add(bench, box(0.06, 0.41, 0.06), woodM, -0.14, 0.205, z); }
  add(bench, rbox(0.3, 0.1, 0.36, 0.04), std({ color: 0x6E6A5A, roughness: 1 }), 0.02, 0.51, 0.8);          // folded blanket
  add(bench, new THREE.CylinderGeometry(0.02, 0.02, 0.2, 10), std({ color: 0xB8231E, roughness: 0.4 }), 0.05, 0.48, 0.55, { rz: Math.PI / 2, ry: 0.5 });  // flashlight
  // shelves on the east wall: jars, cans, water jugs, a radio, a first-aid box
  const sh = new THREE.Group(); sh.position.set(1.1, 0, 0.4); g.add(sh);
  const metal = std({ color: 0x55585A, roughness: 0.5, metalness: 0.6 });
  for (const y of [0.22, 0.66, 1.1, 1.54]) add(sh, box(0.38, 0.025, 1.7), woodM, 0, y, 0);
  for (const [x, z] of [[-0.18, -0.84], [0.18, -0.84], [-0.18, 0.84], [0.18, 0.84]]) add(sh, box(0.03, 1.8, 0.03), metal, x, 0.9, z);
  const R = rng(o.seed ?? 5), jarG = new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), lidG = new THREE.CylinderGeometry(0.043, 0.043, 0.02, 12);
  const fills = [0xD8782A, 0xB2261C, 0x6E8A2E, 0x8A5C9A, 0xC8A23A, 0x9A3A24];
  const jarPos = []; for (const y of [0.735, 1.175]) for (let k = 0; k < 14; k++) if (R() > 0.12) jarPos.push([(R() - 0.5) * 0.2, y, -0.78 + k * 0.12]);
  const jars = new THREE.InstancedMesh(jarG, std({ roughness: 0.15, metalness: 0.0, envMapIntensity: 1.2 }), jarPos.length), lids = new THREE.InstancedMesh(lidG, std({ color: 0xB8B09A, roughness: 0.3, metalness: 0.8 }), jarPos.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  jarPos.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); jars.setMatrixAt(i, m4); jars.setColorAt(i, col.setHex(fills[Math.floor(R() * fills.length)])); m4.makeTranslation(x, y + 0.08, z); lids.setMatrixAt(i, m4); });
  jars.castShadow = jars.receiveShadow = true; lids.castShadow = true; sh.add(jars); sh.add(lids);
  const jugG = rbox(0.15, 0.27, 0.15, 0.035), jugM = std({ color: 0xE8E8E0, roughness: 0.35, transparent: true, opacity: 0.88 }), capM = std({ color: 0x2A4FB0, roughness: 0.4 });
  const jugPos = []; for (let k = 0; k < 7; k++) jugPos.push([0, 0.37, -0.72 + k * 0.23]); for (let k = 0; k < 4; k++) jugPos.push([-0.34, 0.135, -0.5 + k * 0.2]);
  for (const [x, y, z] of jugPos) { add(sh, jugG, jugM, x, y, z); add(sh, new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), capM, x + 0.03, y + 0.15, z); }
  const canG = new THREE.CylinderGeometry(0.038, 0.038, 0.11, 12); for (let k = 0; k < 10; k++) add(sh, canG, std({ color: [0xB8B8B0, 0x9A2A22, 0x2A5A8A, 0xC8A040][k % 4], roughness: 0.35, metalness: 0.5 }), -0.1 + (k % 2) * 0.12, 1.22 + 0.44 * (k > 5 ? 1 : 0), 0.35 + (k % 5) * 0.09);
  const radio = new THREE.Group(); radio.position.set(0, 1.64, -0.35); sh.add(radio);
  add(radio, rbox(0.3, 0.17, 0.12, 0.02), std({ color: 0x2B2D30, roughness: 0.5 }), 0, 0, 0);
  add(radio, box(0.16, 0.1, 0.01), std({ color: 0x55585C, roughness: 0.6, metalness: 0.4 }), -0.05, 0, -0.062, { ry: Math.PI });
  const dial = add(radio, box(0.07, 0.04, 0.01), std({ color: 0x331800, emissive: 0xFFB050, emissiveIntensity: 1.2 }), 0.09, 0.03, -0.062, { cast: false });
  add(radio, new THREE.CylinderGeometry(0.004, 0.004, 0.45, 6), metal, 0.12, 0.3, 0, { rz: -0.3 }); void dial;
  add(sh, rbox(0.26, 0.16, 0.14, 0.02), std({ color: 0xE8E4DA, roughness: 0.5 }), 0, 1.64, 0.55);
  add(sh, box(0.08, 0.025, 0.005), std({ color: 0xC01818, roughness: 0.5 }), -0.05, 1.64, 0.62, { ry: -Math.PI / 2 }); add(sh, box(0.025, 0.08, 0.005), std({ color: 0xC01818, roughness: 0.5 }), -0.05, 1.64, 0.62, { ry: -Math.PI / 2 });
  // the bare bulb on its cord
  const bulbM = std({ color: 0xFFF2D6, emissive: 0xFFD08A, emissiveIntensity: 6, roughness: 0.2 });
  add(g, new THREE.CylinderGeometry(0.004, 0.004, 0.32, 6), darkM, 0.1, H - 0.16, 0.25, { cast: false });
  add(g, new THREE.CylinderGeometry(0.022, 0.026, 0.05, 10), darkM, 0.1, H - 0.34, 0.25, { cast: false });
  add(g, new THREE.SphereGeometry(0.035, 14, 10), bulbM, 0.1, H - 0.39, 0.25, { cast: false });
  const bulb = new THREE.PointLight(0xFFC27A, 5.5, 9, 2); bulb.position.set(0.1, H - 0.47, 0.25); bulb.castShadow = true; bulb.shadow.mapSize.set(512, 512); bulb.shadow.bias = -0.002; g.add(bulb); lights.push(bulb);
  const amb = new THREE.PointLight(0xFFD8A8, 0.6, 6, 2); amb.position.set(0, 0.4, 0.3); g.add(amb); lights.push(amb);
  // dust sifting from the ceiling while the hatch rattles
  const nD = 260, dpos = new Float32Array(nD * 3), dseed = [];
  for (let k = 0; k < nD; k++) dseed.push([R() * 2.4 - 1.2, R() * 3.2 - 1.6, R(), 0.15 + R() * 0.25]);
  const dustG = new THREE.BufferGeometry(); dustG.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dustM = new THREE.PointsMaterial({ color: 0xC8BCA8, size: 0.012, transparent: true, opacity: 0, depthWrite: false });
  const dust = new THREE.Points(dustG, dustM); dust.frustumCulled = false; g.add(dust);
  const rat = Array.isArray(o.rattle) ? o.rattle : null, flick = Array.isArray(o.flicker) ? o.flicker : [], ajar = o.hatch === 'ajar';
  upd.push((t) => {
    const on = rat ? smooth((t - rat[0]) / 0.4) * (1 - smooth((t - rat[1]) / 0.4)) : 0;
    for (const { pivot, s } of leaves) { const n = Math.sin(t * 37 + s) * 0.6 + Math.sin(t * 23.3 + s * 2) * 0.4; pivot.rotation.z = s * (on * 0.018 * n + (ajar && s > 0 ? 0.2 : 0)); }
    const flash = rat ? on * Math.max(0, Math.sin(t * 2.9) * Math.sin(t * 7.3 + 1) - 0.55) * 6 : 0;
    gapM.emissiveIntensity = (ajar ? 5 : 2.5) * (0.8 + 0.2 * Math.sin(t * 0.7)) + flash * 5; sky.intensity = (ajar ? 3 : 1.4) + flash * 6;
    const k = flickerK(t, flick); bulb.intensity = 5.5 * k; bulbM.emissiveIntensity = 6 * k; amb.intensity = 0.6 * k;
    dustM.opacity = 0.75 * on;
    for (let i = 0; i < nD; i++) { const [x, z, ph, v] = dseed[i]; const y = H - ((t * v + ph * H) % H); dpos[i * 3] = x + 0.03 * Math.sin(t * 1.3 + ph * 9); dpos[i * 3 + 1] = y; dpos[i * 3 + 2] = z; }
    dustG.attributes.position.needsUpdate = true;
  });
  const anchors = { bench: [-1.09, 0.46, 0.62], shelves: [1.1, 0, 0.4], steps: [0, 0, -0.9], hatch: [0, 2.3, -2.7] };
  return { group: g, lights, size: [W, H, D], upd, anchors };
}

// ── small interior rooms: bathroom | closet | hallway ──────────────────────────────────────────────────────────────
// bathroom: x -0.95..0.95, z -1.3..1.3, 2.4 high; doorway in the -z wall at x -0.35..0.55 (door open against the east
// wall); tub along the +z wall (x -0.85..0.85, z 0.5..1.25, rim 0.55, floor inside 0.03); toilet on the east wall,
// sink + mirror on the west wall. closet: x -0.7..0.7, z -0.95..0.95, doorway -z (x -0.4..0.4), shelves both sides,
// coats on a rail at the back. hallway: x -0.6..0.6, z -2.6..2.6, open at -z, doors on both walls, shelves, runner rug.
function smallRoom(o) {
  const T = tex(), g = new THREE.Group(), lights = [], upd = [];
  const style = ['bathroom', 'closet', 'hallway'].includes(o.style) ? o.style : 'bathroom';
  const S = { bathroom: [1.9, 2.6, 2.4], closet: [1.4, 1.9, 2.4], hallway: [1.2, 5.2, 2.4] }[style];
  const [W, D, H] = S, th = 0.14;
  const paint = std({ map: rep(T.stucco, 2), color: style === 'bathroom' ? 0xC9D2C4 : style === 'closet' ? 0xD8CDB8 : 0xCBBFA6, roughness: 0.9 });
  const tileM = std({ map: rep(T.tiles, 1.2), roughness: 0.25, envMapIntensity: 0.7 });
  const floorM = style === 'bathroom' ? std({ map: rep(T.floorTiles, 1.6), roughness: 0.35 }) : std({ map: rep(T.planks.map, 2), color: 0xB89A78, roughness: 0.6 });
  const trim = std({ color: 0xF2EFE6, roughness: 0.5 }), wood = std({ map: rep(T.planks.map, 2), color: 0xC8A880, roughness: 0.55 });
  const white = std({ color: 0xF4F2EC, roughness: 0.18, envMapIntensity: 0.8 }), chrome = std({ color: 0xDADDE0, roughness: 0.12, metalness: 1 });
  add(g, box(W + 2 * th, 0.1, D + 2 * th), floorM, 0, -0.05, 0);
  add(g, box(W + 2 * th, 0.12, D + 2 * th), std({ color: 0xEEEBE4, roughness: 0.95 }), 0, H + 0.06, 0);
  const tileH = style === 'bathroom' ? 1.25 : 0;
  const sideWall = (x, holes = []) => {           // along z at x (tiles below tileH)
    const L = D + 2 * th;
    const grp = new THREE.Group(); grp.position.set(x, 0, 0); grp.rotation.y = Math.PI / 2; g.add(grp);
    if (tileH) { wallWithHoles(grp, tileM, L, 0, th, tileH, holes); const up = new THREE.Group(); up.position.y = tileH; grp.add(up); wallWithHoles(up, paint, L, 0, th, H - tileH, holes.map((h) => ({ ...h, y0: h.y0 - tileH, y1: h.y1 - tileH }))); }
    else wallWithHoles(grp, paint, L, 0, th, H, holes);
  };
  const endWall = (z, holes = [], open = false) => {
    if (open) return;
    if (tileH) { wallWithHoles(g, tileM, W, z, th, tileH, holes); const up = new THREE.Group(); up.position.y = tileH; g.add(up); wallWithHoles(up, paint, W, z, th, H - tileH, holes.map((h) => ({ ...h, y0: h.y0 - tileH, y1: h.y1 - tileH }))); }
    else wallWithHoles(g, paint, W, z, th, H, holes);
  };
  const doorLeaf = (w, h) => { const d = new THREE.Group(); add(d, box(w, h, 0.04), wood, w / 2, h / 2, 0); for (const [y, hh] of [[0.3, 0.7], [1.15, 0.7]]) add(d, box(w - 0.24, hh, 0.012), wood, w / 2, y + hh / 2, 0.024); add(d, new THREE.SphereGeometry(0.03, 10, 8), std({ color: 0xB89A50, roughness: 0.3, metalness: 1 }), w - 0.08, 1.0, 0.05); return d; };
  const frame = (x0, x1, z, h) => { add(g, box(0.06, h, th + 0.04), trim, x0 - 0.03, h / 2, z); add(g, box(0.06, h, th + 0.04), trim, x1 + 0.03, h / 2, z); add(g, box(x1 - x0 + 0.12, 0.06, th + 0.04), trim, (x0 + x1) / 2, h + 0.03, z); };
  const anchors = {};
  if (style === 'bathroom') {
    sideWall(-W / 2 - th / 2); sideWall(W / 2 + th / 2);
    endWall(D / 2 + th / 2);
    const dx0 = -0.35, dx1 = 0.55;
    endWall(-D / 2 - th / 2, [{ x0: dx0, x1: dx1, y0: 0, y1: 2.05 }]); frame(dx0, dx1, -D / 2 - th / 2, 2.05);
    const door = doorLeaf(dx1 - dx0, 2.02); door.position.set(dx1, 0, -D / 2 + 0.02); door.rotation.y = -Math.PI / 2 + 0.15; g.add(door);
    // the tub: a hollow enamel bath along the back wall
    const tub = new THREE.Group(); tub.position.set(0, 0, D / 2 - 0.39); g.add(tub);
    // a hollow enamel tub: bottom, four walls with a rounded rim, the inside a touch greyer
    const inner = std({ color: 0xE2E0DA, roughness: 0.22 });
    add(tub, rbox(1.66, 0.04, 0.66, 0.015), inner, 0, 0.02, 0);
    for (const s of [1, -1]) { add(tub, rbox(1.72, 0.55, 0.075, 0.03), white, 0, 0.275, s * 0.345); add(tub, rbox(0.085, 0.55, 0.72, 0.03), white, s * 0.8175, 0.275, 0); }
    add(tub, new THREE.TorusGeometry(0.04, 0.01, 6, 12), chrome, 0.62, 0.62, 0.3, { rx: Math.PI / 2 });
    add(tub, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), chrome, 0.7, 0.66, 0.34, { rz: Math.PI / 2 });
    // mattress leaning over the tub (tornado shelter)
    if (o.mattress) add(g, rbox(0.95, 1.9, 0.18, 0.06), std({ color: 0xDCD6C6, roughness: 0.95 }), -0.2, 0.9, D / 2 - 0.62, { rx: 0.42, rz: Math.PI / 2 * 0.0 });
    // toilet on the east wall
    const wc = new THREE.Group(); wc.position.set(W / 2 - 0.3, 0, -0.1); wc.rotation.y = -Math.PI / 2; g.add(wc);
    add(wc, rbox(0.36, 0.4, 0.5, 0.08), white, 0, 0.2, 0.05); add(wc, rbox(0.42, 0.06, 0.5, 0.03), white, 0, 0.42, 0.06);
    add(wc, rbox(0.46, 0.38, 0.2, 0.03), white, 0, 0.62, -0.22);
    // sink + mirror on the west wall
    const sk = new THREE.Group(); sk.position.set(-W / 2 + 0.25, 0, -0.4); sk.rotation.y = Math.PI / 2; g.add(sk);
    add(sk, new THREE.CylinderGeometry(0.1, 0.14, 0.78, 16), white, 0, 0.39, 0); add(sk, rbox(0.56, 0.14, 0.44, 0.05), white, 0, 0.84, 0.02);
    add(sk, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), chrome, 0, 0.98, -0.16, { rx: 0.9 });
    add(sk, box(0.52, 0.7, 0.02), std({ color: 0xA8B4BC, roughness: 0.02, metalness: 1 }), 0, 1.5, -0.2);
    add(sk, box(0.56, 0.74, 0.015), trim, 0, 1.5, -0.212);
    // towel rail + towel, a small rug, the ceiling light
    add(g, new THREE.CylinderGeometry(0.01, 0.01, 0.55, 8), chrome, -W / 2 + 0.05, 1.1, 0.35, { rx: Math.PI / 2 });
    add(g, box(0.04, 0.6, 0.5), std({ color: 0x5E7E9A, roughness: 1 }), -W / 2 + 0.07, 0.82, 0.35);
    add(g, box(0.7, 0.012, 0.45), std({ color: 0x8A6E5A, roughness: 1 }), 0.1, 0.006, 0.05, { cast: false });
    anchors.tub = [0, 0.03, D / 2 - 0.39]; anchors.door = [(dx0 + dx1) / 2, 0, -D / 2];
  } else if (style === 'closet') {
    sideWall(-W / 2 - th / 2); sideWall(W / 2 + th / 2); endWall(D / 2 + th / 2);
    endWall(-D / 2 - th / 2, [{ x0: -0.4, x1: 0.4, y0: 0, y1: 2.05 }]); frame(-0.4, 0.4, -D / 2 - th / 2, 2.05);
    const door = doorLeaf(0.8, 2.02); door.position.set(0.4, 0, -D / 2 - th - 0.02); door.rotation.y = -Math.PI / 2 - 0.25; g.add(door);
    const R = rng(o.seed ?? 3);
    for (const s of [1, -1]) for (const y of [0.5, 1.0, 1.5, 1.95]) {
      add(g, box(0.34, 0.025, D - 0.1), wood, s * (W / 2 - 0.17), y, 0);
      for (let k = 0; k < 4; k++) { const hh = 0.12 + R() * 0.25, w = 0.28, dd = 0.25 + R() * 0.2; if (R() < 0.25) continue;
        const cc = [0x7A5A40, 0x8A7A62, 0x5E6E7A, 0x9A8A6A, 0xB8A48A, 0x6A4E3A][Math.floor(R() * 6)];
        add(g, R() < 0.5 ? box(w, hh, dd) : rbox(w, hh, dd, 0.05), std({ color: cc, roughness: 0.9 }), s * (W / 2 - 0.17), y + 0.013 + hh / 2, -D / 2 + 0.3 + k * 0.42); }
    }
    add(g, new THREE.CylinderGeometry(0.014, 0.014, W - 0.7, 8), std({ color: 0xB8B8B0, metalness: 1, roughness: 0.3 }), 0, 1.85, D / 2 - 0.3, { rz: Math.PI / 2 });
    for (let k = 0; k < 5; k++) { const cc = [0x3A3F4A, 0x5A4636, 0x3E4A40, 0x6A5A48, 0x4A4A4E][k]; const c = new THREE.Group(); c.position.set(-0.28 + k * 0.14, 1.82, D / 2 - 0.3); c.rotation.y = (R() - 0.5) * 0.3; g.add(c);
      add(c, rbox(0.1, 0.95, 0.42, 0.04), std({ color: cc, roughness: 0.95 }), 0, -0.5, 0); add(c, new THREE.TorusGeometry(0.05, 0.006, 5, 10, Math.PI), std({ color: 0x8A8A8A, metalness: 1 }), 0, 0.02, 0, { ry: Math.PI / 2 }); }
    anchors.floor = [0, 0, 0]; anchors.door = [0, 0, -D / 2];
  } else {    // hallway, open at -z
    const R = rng(o.seed ?? 7), doors = [[-1, -1.0], [1, 0.6], [-1, 1.7]];
    for (const s of [1, -1]) {
      const holes = doors.filter((d) => d[0] === s).map(([, z]) => ({ x0: z - 0.42, x1: z + 0.42, y0: 0, y1: 2.05 }));
      const grp = new THREE.Group(); grp.position.set(s * (W / 2 + th / 2), 0, 0); grp.rotation.y = Math.PI / 2; g.add(grp);
      wallWithHoles(grp, paint, D + 2 * th, 0, th, H, holes.map((h) => ({ ...h, x0: -h.x1, x1: -h.x0 })));
    }
    for (const [s, z] of doors) { const d = doorLeaf(0.84, 2.02); d.position.set(s * (W / 2 + th / 2), 0, z + 0.42 * s * -1); d.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(d);
      const x = s * (W / 2 - 0.005); for (const dz of [-0.45, 0.45]) add(g, box(0.03, 2.08, 0.07), trim, x, 1.04, z + dz); add(g, box(0.03, 0.07, 0.97), trim, x, 2.085, z); }
    endWall(D / 2 + th / 2);
    add(g, box(0.62, 0.012, D - 0.6), std({ color: 0x6A2E28, roughness: 1 }), 0, 0.006, 0.2, { cast: false });
    const sh = new THREE.Group(); sh.position.set(-W / 2 + 0.16, 0, 0.35 + 0.0); g.add(sh);
    for (const y of [0.4, 0.8, 1.2, 1.6]) add(sh, box(0.28, 0.025, 0.7), wood, 0, y, 0);
    for (const z of [-0.36, 0.36]) add(sh, box(0.3, 1.9, 0.025), wood, 0, 0.95, z); add(sh, box(0.3, 0.025, 0.745), wood, 0, 1.9, 0); add(sh, box(0.02, 1.9, 0.72), wood, -0.14, 0.95, 0);
    add(sh, box(0.3, 0.08, 0.72), wood, 0, 0.04, 0);
    for (let k = 0; k < 18; k++) { const y = [0.4, 0.8, 1.2, 1.6][k % 4], hh = 0.18 + R() * 0.1; add(sh, box(0.2, hh, 0.035 + R() * 0.03), std({ color: new THREE.Color().setHSL(R() * 0.1, 0.4, 0.2 + R() * 0.2).getHex(), roughness: 0.8 }), 0, y + 0.012 + hh / 2, -0.3 + (k >> 2) * 0.14); }
    for (const [z, y] of [[-1.9, 1.5], [1.1, 1.55]]) { add(g, box(0.03, 0.42, 0.34), std({ color: 0x3A2A1E, roughness: 0.6 }), W / 2 - 0.02, y, z); add(g, box(0.035, 0.34, 0.26), std({ color: 0x8A8E80, roughness: 0.7 }), W / 2 - 0.03, y, z); }
    anchors.floor = [0, 0, 0];
  }
  // ceiling light
  const lampM = std({ color: 0xFFFBF0, emissive: 0xFFF1D8, emissiveIntensity: 3, roughness: 0.4 });
  const zs = style === 'hallway' ? [-1.4, 1.2] : [0.1];
  for (const z of zs) {
    add(g, new THREE.SphereGeometry(0.14, 16, 8, 0, TAU, 0, Math.PI / 2), lampM, 0, H - 0.005, z, { rx: Math.PI, cast: false });
    const L = new THREE.PointLight(0xFFE6C4, style === 'hallway' ? 3 : 4, 7, 2); L.position.set(0, H - 0.25, z); if (z === zs[0]) { L.castShadow = true; L.shadow.mapSize.set(512, 512); L.shadow.bias = -0.002; } g.add(L); lights.push(L);
  }
  const lightK = clamp(o.light ?? 1, 0, 1), flick = Array.isArray(o.flicker) ? o.flicker : [];
  upd.push((t) => { const k = flickerK(t, flick) * lightK; lampM.emissiveIntensity = 3 * k; lights.forEach((L, i) => { L.intensity = (style === 'hallway' ? 3 : 4) * k; }); });
  return { group: g, lights, size: [W, H, D], upd, anchors };
}

// ── the 1902 cell ───────────────────────────────────────────────────────────────────────────────────────────────────
// room x -1.25..1.25, z -1.5..1.5, walls 0.6 thick, barrel vault 2.1..2.55; door (0.75 x 1.7) in the -z wall at
// x -0.2..0.55 with a barred grate at 1.3..1.55; slit window high in the +z wall (x -0.06..0.06, y 1.85..2.25) with a
// light shaft to the floor; straw mat on the east side (x 0.55..1.2, z -0.3..1.35); a bucket in the north-west corner
function cell(o) {
  const T = tex(), g = new THREE.Group(), lights = [], upd = [];
  const W = 2.5, D = 3.0, th = 0.6, Hs = 2.1, rise = 0.45;
  const stoneM = masonry(T.stone, { grime: 0.6, foot: 0.6, streak: 0.5 });
  const floorM = masonry(T.flags, { grime: 0.5, foot: 0.2, streak: 0.1 });
  add(g, box(W + 2 * th, 0.2, D + 2 * th), floorM, 0, -0.1, 0);
  add(g, box(th, Hs, D + 2 * th), stoneM, -W / 2 - th / 2, Hs / 2, 0); add(g, box(th, Hs, D + 2 * th), stoneM, W / 2 + th / 2, Hs / 2, 0);
  const dx0 = -0.2, dx1 = 0.55, dh = 1.72;
  wallWithHoles(g, stoneM, W, -D / 2 - th / 2, th, Hs + rise + 0.3, [{ x0: dx0, x1: dx1, y0: 0, y1: dh }]);
  wallWithHoles(g, stoneM, W, D / 2 + th / 2, th, Hs + rise + 0.3, [{ x0: -0.07, x1: 0.07, y0: 1.85, y1: 2.25 }]);
  // barrel vault along z: a half-cylinder shell (seen from inside) on the side walls
  const R = (W * W / 4 + rise * rise) / (2 * rise), a = Math.asin((W / 2) / R);
  const vg = new THREE.CylinderGeometry(R, R, D + 0.02, 28, 1, true, Math.PI - a, 2 * a); vg.rotateX(Math.PI / 2);
  const uv = vg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * a * R, uv.getY(i) * D);
  const vault = add(g, vg, masonry(T.stone, { grime: 0.7, foot: 0, streak: 0.4 }), 0, Hs + rise - R, 0); vault.material.side = THREE.DoubleSide;
  add(g, box(W + 2 * th, 0.5, D + 2 * th), stoneM, 0, Hs + rise + 0.3, 0, { cast: true });               // the mass above (closes the top)
  // heavy door: vertical planks, iron bands, studs, a small barred grate
  const door = new THREE.Group(); door.position.set(dx0, 0, -D / 2 - 0.12); g.add(door);
  const plankM = std({ map: rep(T.oldwood.map, 1.5), color: 0x8A7A68, roughness: 0.85 }), iron = std({ color: 0x2A2724, roughness: 0.6, metalness: 0.7 });
  const gw = 0.22, gh = 0.2, gy = 1.32;
  const dw = dx1 - dx0;
  // the leaf with a hole for the grate
  add(door, box(dw, gy, 0.1), plankM, dw / 2, gy / 2, 0);
  add(door, box(dw, dh - gy - gh, 0.1), plankM, dw / 2, gy + gh + (dh - gy - gh) / 2, 0);
  add(door, box((dw - gw) / 2, gh, 0.1), plankM, (dw - gw) / 4, gy + gh / 2, 0); add(door, box((dw - gw) / 2, gh, 0.1), plankM, dw - (dw - gw) / 4, gy + gh / 2, 0);
  for (const y of [0.25, 0.95, 1.6]) add(door, box(dw + 0.02, 0.06, 0.02), iron, dw / 2, y, 0.06);
  for (let k = 0; k < 3; k++) add(door, new THREE.CylinderGeometry(0.009, 0.009, gh, 6), iron, dw / 2 - gw / 3 + k * gw / 3, gy + gh / 2, 0.0);
  for (const y of [0.25, 0.95, 1.6]) for (let k = 0; k < 5; k++) add(door, new THREE.SphereGeometry(0.012, 6, 4), iron, 0.06 + k * (dw - 0.12) / 4, y, 0.075, { cast: false });
  add(door, box(0.05, 0.14, 0.05), iron, dw - 0.07, 0.95, 0.08);
  // outside the grate and the slit: the glow (a hot orange card + light), smoke puffs drifting in
  const glowM = std({ color: 0x000000, emissive: 0xFF6A1A, emissiveIntensity: 0, roughness: 1 });
  add(g, box(gw + 0.1, gh + 0.1, 0.02), glowM, dx0 + dw / 2, gy + gh / 2, -D / 2 - 0.4, { cast: false });
  add(g, box(0.16, 0.44, 0.02), glowM, 0, 2.05, D / 2 + th - 0.05, { cast: false });
  const dayM = std({ color: 0x000000, emissive: 0xD8E2EE, emissiveIntensity: 2.5, roughness: 1 });
  const dayCard = add(g, box(0.16, 0.44, 0.02), dayM, 0, 2.05, D / 2 + th - 0.03, { cast: false });
  const doorL = new THREE.PointLight(0xFF7A2A, 0, 6, 2); doorL.position.set(dx0 + dw / 2, gy + 0.05, -D / 2 + 0.25); g.add(doorL); lights.push(doorL);
  const slitL = new THREE.SpotLight(0xDDE6F2, 9, 7, 0.22, 0.6, 2); slitL.position.set(0, 2.05, D / 2 + 0.1); slitL.target.position.set(-0.25, 0, 0.1); g.add(slitL); g.add(slitL.target); slitL.castShadow = false; lights.push(slitL);
  const fill = new THREE.PointLight(0xAAB4C0, 0.35, 5, 2); fill.position.set(0, 1.5, 0); g.add(fill); lights.push(fill);
  // the light shaft from the slit: two soft additive planes
  const shaftT = canvasTex(32, 128, (c, w, h) => { const id = c.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = (x + 0.5) / w - 0.5, v = y / (h - 1); const a = Math.exp(-Math.pow(u / (0.18 + 0.2 * v), 2) * 3) * Math.pow(1 - v, 0.8) * Math.min(1, v * 8); const k = (y * w + x) * 4; id.data[k] = id.data[k + 1] = id.data[k + 2] = 255 * a; id.data[k + 3] = 255; } c.putImageData(id, 0, 0); });
  const shaftM = new THREE.MeshBasicMaterial({ map: shaftT, color: 0xC8D2DC, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  // the shaft: a soft four-sided light volume from the slit to the floor (additive, fading along its length)
  const from = new THREE.Vector3(0, 2.05, D / 2 - 0.05), to = new THREE.Vector3(-0.25, 0, 0.1), len = from.distanceTo(to);
  const fadeT = canvasTex(4, 128, (c, w, h) => { const id = c.createImageData(w, h); for (let y = 0; y < h; y++) { const v = y / (h - 1), a = smooth(v / 0.1) * (1 - 0.55 * v); for (let x = 0; x < w; x++) { const k = (y * w + x) * 4; id.data[k] = id.data[k + 1] = id.data[k + 2] = 255 * a; id.data[k + 3] = 255; } } c.putImageData(id, 0, 0); });
  shaftM.map = fadeT; shaftM.opacity = 0.16;
  const fg = new THREE.CylinderGeometry(0.1, 0.45, len, 4, 1, true); fg.rotateY(Math.PI / 4); fg.scale(0.8, 1, 1.6);
  const shaft = new THREE.Mesh(fg, shaftM); shaft.position.copy(from).lerp(to, 0.5); shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize()); shaft.renderOrder = 4; g.add(shaft);
  // straw mat, bucket, tin cup, an iron ring in the wall
  const mat = add(g, box(0.62, 0.04, 1.6), std({ map: rep(T.straw, 0.6), color: 0xC8B890, roughness: 1 }), 0.87, 0.02, 0.55, { cast: false });
  for (let k = 0; k < 40; k++) { const Rr = rng(k * 7 + 3); add(g, box(0.004, 0.004, 0.08 + Rr() * 0.1), std({ color: 0xB8A060, roughness: 1 }), 0.56 + Rr() * 0.64 * (Rr() < 0.5 ? 0 : 1) + (Rr() - 0.5) * 0.08, 0.03, -0.25 + Rr() * 1.6, { ry: Rr() * 3, cast: false }); }
  void mat;
  const bucket = new THREE.Group(); bucket.position.set(-0.95, 0, 1.15); g.add(bucket);
  add(bucket, new THREE.CylinderGeometry(0.15, 0.12, 0.3, 14, 1, true), std({ map: rep(T.oldwood.map, 0.5), color: 0x9A8468, roughness: 0.9, side: THREE.DoubleSide }), 0, 0.15, 0);
  add(bucket, new THREE.CylinderGeometry(0.12, 0.12, 0.02, 14), std({ color: 0x3A2E22, roughness: 1 }), 0, 0.02, 0);
  for (const y of [0.05, 0.25]) add(bucket, new THREE.TorusGeometry(0.14 - y * 0.08, 0.008, 5, 18), iron, 0, y, 0, { rx: Math.PI / 2 });
  add(g, new THREE.CylinderGeometry(0.04, 0.035, 0.08, 10), std({ color: 0x8A8A84, roughness: 0.4, metalness: 0.7 }), -0.75, 0.04, 1.3);
  add(g, new THREE.TorusGeometry(0.06, 0.012, 6, 14), iron, -W / 2 + 0.01, 1.1, 0.3, { ry: Math.PI / 2 });
  // smoke puffs drifting in through the grate and the slit once the glow starts
  const puffT = canvasTex(64, 64, (c, w, h) => { const gr = c.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  const puffs = [];
  for (let k = 0; k < 14; k++) {
    const m = new THREE.SpriteMaterial({ map: puffT, color: 0x5A4A40, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(m); s.renderOrder = 6; g.add(s); puffs.push({ s, m, ph: k / 14, slit: k % 3 === 0, r: rng(k * 13 + 1)() });
  }
  const tg = o.glow ?? null;
  upd.push((t) => {
    const gk = tg == null ? 0 : smooth((t - tg) / 1.2), fl = 0.8 + 0.12 * Math.sin(t * 13.1) + 0.08 * Math.sin(t * 29.7 + 1);
    glowM.emissiveIntensity = 6 * gk * fl; doorL.intensity = 7 * gk * fl;
    dayM.emissiveIntensity = 2.5 * (1 - gk); dayCard.visible = gk < 0.99;
    slitL.color.setRGB(lerp(0.87, 1.0, gk), lerp(0.9, 0.45, gk), lerp(0.95, 0.15, gk)); slitL.intensity = 9 * (1 - gk) + 12 * gk * fl;
    shaftM.color.setRGB(lerp(0.78, 1.0, gk), lerp(0.82, 0.5, gk), lerp(0.86, 0.2, gk)); shaftM.opacity = 0.16 + 0.1 * gk;
    for (const p of puffs) {
      const u = tg == null ? -1 : ((t - tg) * 0.22 + p.ph) % 1.0;
      if (tg == null || t < tg || u < 0) { p.m.opacity = 0; continue; }
      const src = p.slit ? new THREE.Vector3(0, 2.05, D / 2 - 0.05) : new THREE.Vector3(dx0 + dw / 2, gy + gh / 2, -D / 2 - 0.05);
      const dir = p.slit ? new THREE.Vector3(-0.2 + p.r * 0.4, 0.15, -1) : new THREE.Vector3(-0.3 + p.r * 0.6, 0.35, 1);
      p.s.position.copy(src).addScaledVector(dir, u * 1.2); p.s.scale.setScalar(0.15 + u * 0.9);
      p.m.opacity = 0.35 * Math.sin(Math.PI * u) * smooth((t - tg) / 1.5);
    }
  });
  const anchors = { wall_seat: [-0.35, 0, 1.2], mat: [0.87, 0, 0.55], door: [(dx0 + dx1) / 2, 0, -D / 2], slit: [0, 2.05, D / 2] };
  return { group: g, lights, size: [W, Hs + rise, D], upd, anchors };
}

// ── Herculaneum boat sheds (fornici): a row of vaulted arches under a terrace, opening to +Z (the beach) ─────────────
function boatSheds(o, ctx) {
  const T = tex(), g = new THREE.Group(), lights = [], upd = [];
  const n = clamp(Math.round(o.count ?? 10), 2, 16), bay = 4.1, pier = 0.9, span = bay - pier, Dp = 8.0, spring = 2.6, H = 6.8;
  const L = n * bay + pier;
  const tuffM = masonry(T.tuff, { grime: 0.6, foot: 0.5, streak: 0.6 }), brickM = masonry(T.brick, { grime: 0.5, foot: 0.3, streak: 0.4 });
  // opus reticulatum: the square tuff blocks laid on the diagonal (the texture turned 45 deg)
  for (const t of [tuffM.map, tuffM.normalMap, tuffM.roughnessMap]) if (t) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 4; }
  const darkM = std({ color: 0x3E362C, roughness: 1 }), vaultM = masonry(T.tuff, { grime: 0.8, foot: 0, streak: 0.3 }); vaultM.side = THREE.DoubleSide; vaultM.color.setScalar(0.6);
  const x0 = -L / 2;
  // piers and back walls, going 2 m into the ground so uneven sand never shows a gap
  for (let i = 0; i <= n; i++) add(g, box(pier, spring + 2, Dp), tuffM, x0 + pier / 2 + i * bay, (spring + 2) / 2 - 2, -Dp / 2);
  add(g, box(L, H + 2, 0.8), tuffM, 0, (H + 2) / 2 - 2, -Dp - 0.4);
  // each bay: a barrel vault (inside) and the arched front face with brick voussoirs
  const r = span / 2;
  for (let i = 0; i < n; i++) {
    const cx = x0 + pier + i * bay + span / 2;
    const vg = new THREE.CylinderGeometry(r, r, Dp, 20, 1, true, Math.PI / 2, Math.PI); vg.rotateX(Math.PI / 2);
    const uv = vg.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * Math.PI * r, uv.getY(k) * Dp);
    add(g, vg, vaultM, cx, spring, -Dp / 2);
    // the front spandrel above the arch: a slab with a semicircular cut, from the springing up to the terrace
    const s = new THREE.Shape(); s.moveTo(-bay / 2, 0); s.lineTo(-r, 0); s.absarc(0, 0, r, Math.PI, 0, true); s.lineTo(bay / 2, 0); s.lineTo(bay / 2, H - spring); s.lineTo(-bay / 2, H - spring); s.lineTo(-bay / 2, 0);
    const sg = new THREE.ExtrudeGeometry(s, { depth: 0.7, bevelEnabled: false, curveSegments: 16 }); sg.translate(0, 0, -0.7);
    const sp = add(g, sg, tuffM, cx, spring, 0.0);
    const ring = new THREE.RingGeometry(r, r + 0.32, 20, 1, 0, Math.PI); const rgp = add(g, ring, brickM, cx, spring, 0.012, { cast: false }); rgp.material.side = THREE.DoubleSide; void sp;
    // the vault's back half in shadow: a dim interior
    add(g, box(span, spring + r, 0.05), darkM, cx, (spring + r) / 2, -Dp + 0.03, { cast: false });
  }
  // the vault spaces above the arches: fill the mass up to the terrace
  add(g, box(L, H - spring - r - 0.35, Dp), tuffM, 0, spring + r + 0.35 + (H - spring - r - 0.35) / 2, -Dp / 2 - 0.35);
  // terrace: a paved deck with a low parapet
  add(g, box(L + 0.4, 0.3, Dp + 1.2), std({ map: rep(T.flags.map, 3), color: 0xB8A888, roughness: 0.9 }), 0, H + 0.15, -Dp / 2 + 0.1);
  add(g, box(L + 0.4, 0.9, 0.35), tuffM, 0, H + 0.75, 0.3);
  // people: seated, huddled in the vaults (earth tones)
  const people = Math.max(0, Math.round(o.people ?? 0)), bays = [];
  for (let i = 0; i < n; i++) bays.push([x0 + pier + i * bay + span / 2, -Dp * 0.45]);
  const anchors = { bays };
  return { group: g, lights, size: [L, H, Dp], upd, anchors, people, bays, span, depth: Dp };
}

// ── a rock cave / rock shelter (landmark.cave) ────────────────────────────────────────────────────────────────────
// The mouth opens toward local -Z (interiors.js turns local -Z to `heading`): a rock cliff face with an overhang and a dark
// mouth, a chamber `depth` m deep that narrows and lowers to the back, a floor that follows the terrain (a ground-snapped
// figure crouches on it), rubble, and the light of a fire outside on the inner walls (`glow`, flickering). The chamber
// darkens with depth (baked occlusion in vertex colours). Camera-exempt (you film from inside, looking out).
function vnoise(x, y, z, seed) {             // smooth value noise, deterministic
  const h = (i, j, k) => { let n = Math.imul(i * 374761393 + j * 668265263 + k * 2147483647 + seed * 1442695041, 1274126177); n ^= n >>> 13; n = Math.imul(n, 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(xi, yi, zi), h(xi + 1, yi, zi), u), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v), L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
}
const fbm3 = (x, y, z, seed) => vnoise(x, y, z, seed) * 0.55 + vnoise(x * 2.1, y * 2.1, z * 2.1, seed + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3, seed + 13) * 0.15;
let CAVETEX = null;
function cave(o, ctx) {
  const g = new THREE.Group(), lights = [], upd = [];
  const D = clamp(+o.depth || 5.5, 3, 12), W = clamp(+o.width || 4.6, 2.5, 10), Hm = clamp(+o.height || 2.7, 1.8, 6), seed = (o.seed ?? 7) | 0;
  const bw = W * 0.42, bh = Math.max(1.25, Hm * 0.5);
  CAVETEX ||= rockTex(512);
  const rockM = triplanar(CAVETEX, { color: new THREE.Color(o.color ?? 0x9A8C78).getHex(), scale: 3.5, roughness: 0.95 });
  rockM.vertexColors = true; rockM.side = THREE.DoubleSide;
  const outerM = triplanar(CAVETEX, { color: new THREE.Color(o.color ?? 0x9A8C78).getHex(), scale: 5, roughness: 0.95 });
  const floorM = triplanar(CAVETEX, { color: 0x6E6254, scale: 2.5, roughness: 1 }); floorM.vertexColors = true;
  // world transform of the local frame (to put the floor on the terrain)
  const at = Array.isArray(o.at) ? o.at : [0, 0], yaw = yawFromHeading(o.heading ?? 180) - Math.PI, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const Gh = (x, z) => (ctx.ground && ctx.ground.height ? ctx.ground.height(x, z) : 0);
  const y0 = Gh(at[0], at[1]);
  const gl = (lx, lz) => Gh(at[0] + lx * cy + lz * sy, at[1] - lx * sy + lz * cy) - y0;     // terrain height at a local point
  // the chamber: arch sections from the mouth (z 0, a lip at -0.35) to the back, closed by a rounded end
  const sec = (z) => { const u = clamp(z / D, 0, 1); return { hw: lerp(W / 2, bw / 2, Math.pow(u, 1.2)), h: lerp(Hm, bh, Math.pow(u, 1.3)) }; };
  const Zs = []; for (let i = 0; i <= 22; i++) Zs.push(-0.35 + (D + 0.35) * i / 22); for (const [dz, k] of [[0.3, 0.72], [0.52, 0.42], [0.66, 0.16], [0.7, 0.02]]) Zs.push(D + dz);
  const scaleAt = (z) => (z <= D ? 1 : [[0.3, 0.72], [0.52, 0.42], [0.66, 0.16], [0.7, 0.02]].find(([dz]) => Math.abs(D + dz - z) < 1e-6)[1]);
  const NA = 26, P = [], C = [], I = [];
  const disp = (x, y, z) => (fbm3(x * 0.9, y * 0.9, z * 0.9, seed) - 0.5) * 0.7 + (fbm3(x * 3.1, y * 3.1, z * 3.1, seed + 3) - 0.5) * 0.18;
  Zs.forEach((z, i) => {
    const { hw, h } = sec(Math.min(z, D)), k = scaleAt(z), zc = Math.min(z, D) + (z > D ? (z - D) : 0);
    for (let j = 0; j <= NA; j++) {
      const th = -0.12 + (Math.PI + 0.24) * j / NA, cx = Math.cos(th), sn = Math.sin(th);
      let x = hw * k * cx, y = -0.35 + (h * k + 0.35) * Math.max(0, sn) ** 0.85 + (sn < 0 ? sn * 0.6 : 0);
      const d = disp(x, y, zc), r = Math.hypot(x, y - 0.2) || 1;
      x += x / r * d * k; y += (y - 0.2) / r * d * k * 0.8;
      P.push(x, y, zc);
      const ao = clamp(1 - Math.pow(clamp(zc / (D + 0.7)), 0.8) * 0.86, 0.12, 1) * (0.8 + 0.2 * clamp(y / Hm + 0.3));
      C.push(ao, ao * 0.97, ao * 0.93);
    }
  });
  const NR = Zs.length, NC = NA + 1;
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NA; j++) { const a = i * NC + j, b = a + 1, c = a + NC, d = c + 1; I.push(a, c, b, b, c, d); }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); cg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); cg.setIndex(I); cg.computeVertexNormals();
  add(g, cg, rockM, 0, 0, 0);
  // the mouth outline (the chamber's first full section), used to cut the cliff face
  const mouth = []; { const { hw, h } = sec(0); for (let j = 0; j <= 40; j++) { const th = Math.PI * j / 40; mouth.push([hw * Math.cos(th) * 0.97, -0.35 + (h + 0.35) * Math.pow(Math.sin(th), 0.85) * 0.97]); } }
  const inMouth = (x, y) => { if (y < -0.3) return false; for (let j = 0; j < mouth.length - 1; j++) { const [x0, y0m] = mouth[j], [x1, y1m] = mouth[j + 1]; if ((x0 - x) * (x1 - x) <= 0 && x0 !== x1) { const yy = y0m + (y1m - y0m) * (x - x0) / (x1 - x0); if (y < yy) return true; } } return false; };
  // cliff face: a displaced grid around the mouth, leaning forward into an overhang at the top
  const FW = Math.max(16, W * 3.5), FH = Math.max(8, Hm * 2.8), NX = 64, NY = 36, FP = [], FI = [], keep = [];
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const u = j / NY, y0f = -0.6 + (FH + 0.6) * u;
    const taper = 1 - 0.3 * smooth((y0f - Hm) / (FH - Hm)) + (fbm3(0, y0f * 0.4, 5, seed + 23) - 0.5) * 0.25;   // narrower, ragged toward the top
    const x = (-FW / 2 + FW * i / NX) * taper, y = y0f + (u > 0.8 ? (fbm3(x * 0.5, 0, 9, seed + 24) - 0.5) * 2.4 * smooth((u - 0.8) / 0.2) : 0);
    const over = -1.3 * smooth((y - Hm * 0.9) / (FH * 0.45)) * (1 - 0.5 * Math.abs(x) / (FW / 2));
    const edge = smooth((Math.abs(x) - (FW / 2 * taper - 4)) / 4);          // the face bends back at its ends into the hill
    const z = over + edge * 3.5 + (fbm3(x * 0.3, y * 0.3, 0, seed + 21) - 0.5) * 2.0 + (fbm3(x * 1.4, y * 1.4, 1, seed + 22) - 0.5) * 0.4 + 0.12;
    const yy = y + (j === 0 ? gl(x, 0) : 0);
    FP.push(x, yy, z);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
    const cx = (FP[a * 3] + FP[d * 3]) / 2, cyv = (FP[a * 3 + 1] + FP[d * 3 + 1]) / 2;
    if (inMouth(cx, cyv)) continue;
    FI.push(a, c, b, b, c, d);                                          // faces -Z (out of the hill)
  }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(FP, 3)); fg.setIndex(FI); fg.computeVertexNormals();
  add(g, fg, outerM, 0, 0, 0);
  // the hill behind and above: rock masses around (never across) the chamber
  const mass = (w, h, d, x, y, z, sd) => { const bg = new THREE.BoxGeometry(w, h, d, 10, 6, 10), p = bg.attributes.position; for (let i = 0; i < p.count; i++) { const vx = p.getX(i) + x, vy = p.getY(i) + y, vz = p.getZ(i) + z, n = (fbm3(vx * 0.3, vy * 0.3, vz * 0.3, sd) - 0.5) * 1.6; p.setXYZ(i, vx + n * 0.4, vy + (vy > y ? n * 0.8 : 0), vz + n * 0.4); } bg.computeVertexNormals(); add(g, bg, outerM, 0, 0, 0); };
  mass(FW * 0.85, FH - Hm - 0.6, D + 5, 0, Hm + 0.4 + (FH - Hm - 0.6) / 2, D / 2 + 3.9, seed + 31);          // front faces behind the cliff face
  for (const s of [1, -1]) mass(FW / 2 - W / 2 - 0.6, Hm + 1.0, D + 5, s * (W / 2 + 0.6 + (FW / 2 - W / 2 - 0.6) / 2), (Hm + 1.0) / 2 - 0.8, D / 2 + 3.9, seed + 32 + s);
  mass(W + 1.2, Hm + 1.2, 3, 0, (Hm + 1.2) / 2 - 0.8, D + 2.4, seed + 35);
  // floor: follows the terrain (+2 cm), dusty, darker deeper in; rubble along the walls
  const FXn = 18, FZn = 26, fP = [], fC = [], fI = [];
  for (let j = 0; j <= FZn; j++) for (let i = 0; i <= FXn; i++) {
    const z = -0.6 + (D + 1.0) * j / FZn, { hw } = sec(Math.min(Math.max(z, 0), D)), x = (-1 + 2 * i / FXn) * (hw + 0.25);
    fP.push(x, gl(x, z) + 0.02, z);
    const ao = clamp(1 - Math.pow(clamp(z / (D + 0.7)), 0.8) * 0.86, 0.12, 1) * (0.85 + 0.25 * fbm3(x * 2, 0, z * 2, seed + 41));
    fC.push(ao, ao * 0.96, ao * 0.9);
  }
  for (let j = 0; j < FZn; j++) for (let i = 0; i < FXn; i++) { const a = j * (FXn + 1) + i, b = a + 1, c = a + FXn + 1, d = c + 1; fI.push(a, c, b, b, c, d); }
  const flg = new THREE.BufferGeometry(); flg.setAttribute('position', new THREE.Float32BufferAttribute(fP, 3)); flg.setAttribute('color', new THREE.Float32BufferAttribute(fC, 3)); flg.setIndex(fI); flg.computeVertexNormals();
  add(g, flg, floorM, 0, 0, 0, { cast: false });
  { const R = rng(seed * 17 + 5), rg = new THREE.IcosahedronGeometry(1, 1), rbl = new THREE.InstancedMesh(rg, outerM, 26), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let k = 0; k < 26; k++) { const z = R() * D * 0.95, { hw } = sec(z), side = R() < 0.5 ? -1 : 1, x = side * (hw - 0.15 - R() * 0.5), s = 0.08 + R() * 0.28; e.set(R() * 3, R() * 3, R() * 3); q.setFromEuler(e); m4.compose(new THREE.Vector3(x, gl(x, z) + s * 0.35, z), q, new THREE.Vector3(s * (1 + R()), s * 0.6, s * (1 + R() * 0.6))); rbl.setMatrixAt(k, m4); }
    rbl.castShadow = rbl.receiveShadow = true; g.add(rbl); }
  // the fire outside, on the inner walls: two warm lights at the mouth, flickering
  const glow = clamp(o.glow ?? 1, 0, 2);
  const L1 = new THREE.PointLight(0xFF7A2E, 0, D * 1.8, 2); L1.position.set(0, 0.9, -0.9); g.add(L1); lights.push(L1);
  const L2 = new THREE.PointLight(0xFF9A48, 0, D * 1.4, 2); L2.position.set(0.6, Hm * 0.8, -0.5); g.add(L2); lights.push(L2);
  upd.push((t) => { const fl = 0.82 + 0.1 * Math.sin(t * 9.1) + 0.06 * Math.sin(t * 17.3 + 1.1) + 0.04 * Math.sin(t * 3.3); L1.intensity = 9 * glow * fl; L2.intensity = 4 * glow * (0.9 + 0.1 * Math.sin(t * 11.7 + 2)); });
  g.userData.noQA = true;
  return { group: g, lights, size: [W, Hm, D], upd, anchors: { inside: [0, 0, D * 0.3], back: [0, 0, D * 0.8], mouth: [0, 0, 0] } };
}

// ── catalog + build (called from interiors.js) ─────────────────────────────────────────────────────────────────────
export const ROOM_CATALOG = {
  'landmark.cave': { desc: 'rock cave / rock shelter: a cliff face with an overhang and a dark mouth facing the heading, a chamber (depth m) narrowing and darkening to the back, terrain-following floor, rubble; glow 0..2 = the light of a fire outside on the inner walls (flickering orange). Film from inside looking out past a crouched figure', params: { at: '[x, z] centre of the mouth', heading: 'deg: the mouth faces it (you look out that way)', depth: 'm (5.5)', width: 'm mouth (4.6)', height: 'm mouth (2.7)', glow: '0..2 (1)', color: 'rock hex', seed: 'n' }, footprint: [16, 12], height: 8, tags: ['landmark', 'cave', 'rock', 'shelter', 'prehistoric'] },
  'interior.storm_cellar': { desc: 'Oklahoma storm cellar: cinder-block room 2.6 x 3.6 x 2.05 m, concrete steps up to a slanted steel hatch (daylight at its edges), shelves of jars / water jugs / weather radio / first aid, a wooden bench (seat 0.46), a bare bulb; rattle [t0,t1] shakes the hatch + sifts dust, flicker [t..] makes the bulb flicker, hatch closed|ajar', params: { at: '[x, z]', heading: 'deg', rattle: '[t0, t1]', flicker: '[t, ...]', hatch: 'closed|ajar' }, footprint: [3, 5.6], height: 2.3, tags: ['interior', 'modern', 'shelter'] },
  'interior.small_room': { desc: 'small windowless interior room: style bathroom (tub along the back wall, tiled walls, toilet, sink + mirror, door open) | closet (shelves, coats, door) | hallway (doors, shelves, runner rug; open at the front)', params: { at: '[x, z]', heading: 'deg', style: 'bathroom|closet|hallway', mattress: 'true|false (bathroom: a mattress over the tub)', light: '0..1', flicker: '[t, ...]' }, footprint: [2.2, 5.4], height: 2.5, tags: ['interior', 'modern', 'shelter'] },
  'interior.cell': { desc: 'bare stone prison cell (1902): 2.5 x 3 m, 0.6 m walls, barrel vault, heavy plank door with iron bands and a barred grate, high slit window with a light shaft, straw mat, bucket; glow t: orange light + smoke through the grate and slit from t', params: { at: '[x, z]', heading: 'deg', glow: 's (start of the orange glow)' }, footprint: [3.7, 4.2], height: 2.6, tags: ['interior', '1900s', 'prison'] },
  'landmark.boat_sheds': { desc: 'Herculaneum boat sheds (fornici): a row of arched tuff vaults with brick arch rings under a terrace, opening toward the heading (the beach); people N = seated huddled figures in the vaults', params: { at: '[x, z]', heading: 'deg (the arches face it)', count: '2..16 (10)', people: 'figures inside (0)', kit: 'kit for the people (ancient_robe)' }, footprint: [42, 9], height: 7.8, tags: ['landmark', 'ancient', 'roman'] },
};
export async function buildRoom(kind, item, ctx) {
  if (kind === 'interior.storm_cellar') return stormCellar(item, ctx);
  if (kind === 'interior.small_room') return smallRoom(item, ctx);
  if (kind === 'interior.cell') return cell(item, ctx);
  if (kind === 'landmark.boat_sheds') return boatSheds(item, ctx);
  if (kind === 'landmark.cave') return cave(item, ctx);
  return null;
}
