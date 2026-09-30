// boats.js — small working boats (Q9, 26 Sep 2026), routed from vehicles.js.
//   buildTroller(o, ctx)  1950s wooden salmon troller (~12 m, Lituya Bay 1958: Edrie, Badger, Sunmore): white hull with a
//                         red bottom and boot stripe, sheer rising to the bow, planked deck, wheelhouse with windows and a
//                         name board, mast with two trolling poles out, rigging and lines, gurdies, riding lights, crew
//   addCrew(parent, list, slots, ctx)   cast refs / kits as figures standing or seated on a boat (move with it)
// Faces +Z, origin at the waterline centre. vehicles.js rides it on the swell (heave, pitch, roll, anchor swing).
import * as THREE from 'three';
import * as TX from './textures.js';
import { plain } from '../shared/materials.js';
import { patchMaterial, U } from '../shared/env.js';
import { clamp, lerp, smooth, rng } from '../shared/util.js';
import { POSES } from './rig.js';
import { buildCharacter, findCastDef } from './cast.js';

const TAU = Math.PI * 2, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const LIGHTS = () => smooth((0.12 - U.uSunDir.value.y) / 0.2);
const mesh = (g, m, p, cast = true) => { const x = new THREE.Mesh(g, m); x.castShadow = cast; x.receiveShadow = true; if (p) p.add(x); return x; };
function rod(a, b, r, m, p) { const d = b.clone().sub(a), L = d.length(); const g = new THREE.CylinderGeometry(r, r, L, 6); g.translate(0, L / 2, 0); const x = mesh(g, m, p); x.position.copy(a); x.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); return x; }
function textTex(text, w = 512, h = 96, bg = '#F2EFE6', fg = '#1A1A1A') {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = `700 ${Math.round(h * 0.62)}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(text).toUpperCase().slice(0, 14), w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ── crew ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// list: number | [ref | {ref, kit, colors, pose}] ; slots: [{x, y, z, yaw, pose: 'stand'|'watch'|'seated'}]
export function addCrew(parent, list, slots, ctx = {}, seed = 1) {
  const items = typeof list === 'number' ? Array.from({ length: list }, () => ({})) : (Array.isArray(list) ? list : []).map((e) => (typeof e === 'string' ? { ref: e } : e || {}));
  const OIL = [{ coat: '#C9A227', trousers: '#3A3A36', accent: '#C9A227' }, { coat: '#6E5A44', trousers: '#34373C', accent: '#6E5A44' }, { coat: '#3E4A58', trousers: '#2E2E2E', accent: '#3E4A58' }];
  const figs = [];
  items.slice(0, slots.length).forEach((e, i) => {
    try {
      const def = (e.ref && findCastDef(e.ref, ctx)) || { id: 'crew' + seed + '_' + i, kit: e.kit || 'worker', colors: e.colors || OIL[(seed + i) % OIL.length], headwear: e.headwear };
      const res = buildCharacter(def, ctx), fig = res.fig, s = slots[i];
      const pose = s.pose === 'seated' ? { ...POSES.seated, lHand: undefined, rHand: undefined, lArmX: -0.7, rArmX: -0.7, lElbow: -0.9, rElbow: -0.9, lShape: 'grip', rShape: 'grip', weapon: null }
        : s.pose === 'watch' ? { ...POSES.watch, weapon: null } : { ...POSES.stand, lArmZ: 0.1, rArmZ: -0.1, weapon: null, lLegY: 0.12, rLegY: -0.12 };
      fig.pose(pose);
      fig.group.position.set(s.x, s.y, s.z); fig.group.rotation.y = s.yaw ?? 0; parent.add(fig.group);
      fig.group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      figs.push(fig);
    } catch (err) { (ctx.warnings || []).push('boat crew: ' + String(err).slice(0, 120)); }
  });
  return figs;
}

// ── the troller ──────────────────────────────────────────────────────────────────────────────────────────────────
let TEX = null;
export function buildTroller(o = {}, ctx = {}) {
  TEX ||= { deck: TX.planks({ size: 512, meters: 3, boardW: 0.12, tone: '#7A6448', tone2: '#96805E', seed: 21 }) };
  const L = 12.2, B = 3.7, group = new THREE.Group(); group.name = 'troller';
  const hullCol = o.color != null ? new THREE.Color(o.color).getHex() : 0xE6E2D6;
  const M = {
    hull: plain({ color: hullCol, roughness: 0.55, side: THREE.DoubleSide }),
    bottom: plain({ color: 0x6E2A20, roughness: 0.8, side: THREE.DoubleSide }),
    boot: plain({ color: 0x151515, roughness: 0.6, side: THREE.DoubleSide }),
    rail: plain({ color: o.trim != null ? new THREE.Color(o.trim).getHex() : 0x2F4A3E, roughness: 0.6, side: THREE.DoubleSide }),
    deck: plain({ map: (() => { const t = TEX.deck.map.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 3, 1 / 3); return t; })(), roughness: 0.85 }),
    house: plain({ color: 0xEDEAE0, roughness: 0.6 }), trim: plain({ color: 0x2F4A3E, roughness: 0.6 }), roofM: plain({ color: 0x6B6E6A, roughness: 0.8 }),
    glass: plain({ color: 0x1A232A, roughness: 0.05, metalness: 0.3, envMapIntensity: 1.2 }),
    wood: plain({ color: 0x8A6E4E, roughness: 0.7 }), dark: plain({ color: 0x1E1E1E, roughness: 0.6, metalness: 0.4 }), line: plain({ color: 0x2A2A28, roughness: 0.9 }),
    white: plain({ color: 0xF4F2EA, roughness: 0.5 }), orange: plain({ color: 0xD8641E, roughness: 0.6 }),
  };
  const sheer = (s) => 1.25 + 0.75 * Math.pow(s, 2.2) + 0.1 * Math.pow(1 - s, 3);      // bulwark top (y) along s (0 stern .. 1 bow)
  const keel = (s) => -1.25 + 1.05 * Math.pow(Math.max(0, (s - 0.72) / 0.28), 1.6);    // keel line, rising into the stem
  const halfB = (s) => B / 2 * (s < 0.45 ? lerp(0.82, 1.0, Math.sin(s / 0.45 * Math.PI / 2)) : Math.pow(Math.cos((s - 0.45) / 0.55 * Math.PI / 2), 0.75));
  const NS = 36, rows = [];
  for (let i = 0; i <= NS; i++) {
    const s = i / NS, z = (s - 0.5) * L, hb = Math.max(0.002, halfB(s)), top = sheer(s), bot = keel(s), row = [];
    // rows by height, with exact rows at the boot stripe (-0.08..0.1) and under the rail, so the paint lines run straight
    const ys = [0, 0.3, 0.55, 0.8].map((f) => lerp(bot, -0.08, f)).concat([-0.08, 0.01, 0.1], [0.12, 0.3, 0.5, 0.7, 0.86, 0.94].map((f) => lerp(0.1, top, f)), [top]);
    const half = ys.map((y) => { const u = Math.pow(clamp((y - bot) / (top - bot)), 1 / 1.15); return [hb * Math.pow(Math.sin(u * Math.PI / 2), 0.55 + 0.6 * clamp((s - 0.6) / 0.4)), y]; });
    for (let j = half.length - 1; j >= 0; j--) row.push(V3(half[j][0], half[j][1], z));             // port sheer (+x) down to the keel
    for (let j = 1; j < half.length; j++) row.push(V3(-half[j][0], half[j][1], z));                 // keel up to the starboard sheer
    rows.push(row);
  }
  // one loft, material by height: bottom paint / boot stripe / topsides / rail
  const nc = rows[0].length, pos = [], uv = [], lists = { bottom: [], boot: [], hull: [], rail: [] };
  rows.forEach((row) => row.forEach((p, j) => { pos.push(p.x, p.y, p.z); uv.push(p.z, j / nc); }));
  for (let i = 0; i < NS; i++) for (let j = 0; j < nc - 1; j++) {
    const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1, y = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[d * 3 + 1]) / 4;
    const edge = j === 0 || j === nc - 2;
    const k = edge ? 'rail' : y < -0.075 ? 'bottom' : y < 0.095 ? 'boot' : 'hull';
    lists[k].push(a, c, b, b, c, d);
  }
  const all = new THREE.BufferGeometry(); all.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); all.setIndex(Object.values(lists).flat()); all.computeVertexNormals();
  for (const [k, idx] of Object.entries(lists)) { if (!idx.length) continue; const g = new THREE.BufferGeometry(); g.setAttribute('position', all.attributes.position); g.setAttribute('normal', all.attributes.normal); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); mesh(g, M[k], group); }
  // transom (flat stern face)
  { const sh = new THREE.Shape(), r0 = rows[0]; sh.moveTo(r0[0].x, r0[0].y); for (const p of r0) sh.lineTo(p.x, p.y); const g = new THREE.ShapeGeometry(sh); g.translate(0, 0, -L / 2 - 0.001); g.rotateY(Math.PI); g.translate(0, 0, -L); mesh(g, M.hull, group); void g; }
  // deck (inside the bulwarks, 0.4 below the sheer), cockpit well aft
  const deckY = (s) => sheer(s) - 0.42;
  { const dr = []; for (let i = 0; i <= NS; i++) { const s = i / NS, z = (s - 0.5) * L, hb = halfB(s) * 0.95; dr.push([V3(-hb, deckY(s), z), V3(hb, deckY(s), z)]); }
    const P = [], I = [], T = []; dr.forEach(([a, b]) => { P.push(a.x, a.y, a.z, b.x, b.y, b.z); T.push(a.x, a.z, b.x, b.z); });
    for (let i = 0; i < NS; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; I.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(T, 2)); g.setIndex(I); g.computeVertexNormals(); mesh(g, M.deck, group); }
  const dY = (z) => deckY(z / L + 0.5);
  // wheelhouse (forward of midships), windows, door, name boards, roof
  const wh = new THREE.Group(); wh.position.set(0, dY(1.2), 1.2); group.add(wh);
  const ww = 2.3, wl = 2.6, whh = 1.95;
  mesh(new THREE.BoxGeometry(ww, whh, wl).translate(0, whh / 2, 0), M.house, wh);
  mesh(new THREE.BoxGeometry(ww + 0.35, 0.08, wl + 0.5).translate(0, whh + 0.04, 0.05), M.roofM, wh);
  mesh(new THREE.BoxGeometry(ww + 0.04, 0.12, wl + 0.04).translate(0, 0.06, 0), M.trim, wh);
  for (const x of [-0.72, 0, 0.72]) mesh(new THREE.BoxGeometry(0.62, 0.55, 0.02).translate(x, whh - 0.55, wl / 2 + 0.005), M.glass, wh, false);
  for (const s of [1, -1]) for (const z of [0.55, -0.35]) mesh(new THREE.BoxGeometry(0.02, 0.5, 0.62).translate(s * (ww / 2 + 0.005), whh - 0.58, z), M.glass, wh, false);
  mesh(new THREE.BoxGeometry(0.72, 1.7, 0.02).translate(0.45, 0.85, -wl / 2 - 0.005), M.trim, wh);
  mesh(new THREE.BoxGeometry(0.34, 0.45, 0.025).translate(0.45, 1.25, -wl / 2 - 0.012), M.glass, wh, false);
  const name = o.name ?? 'EDRIE', nameM = plain({ map: textTex(name), roughness: 0.6 });
  for (const s of [1, -1]) { const b = mesh(new THREE.PlaneGeometry(1.5, 0.28), nameM, wh, false); b.position.set(s * (ww / 2 + 0.012), whh - 1.08, 0.1); b.rotation.y = s * Math.PI / 2; }
  { const b = mesh(new THREE.PlaneGeometry(1.8, 0.34), nameM, group, false); b.position.set(0, sheer(0) - 0.35, -L / 2 - 0.02); b.rotation.y = Math.PI; }
  mesh(new THREE.TorusGeometry(0.28, 0.06, 8, 20).rotateY(Math.PI / 2).translate(ww / 2 + 0.07, 1.0, -0.6), M.orange, wh);     // life ring
  // stack + exhaust
  mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.2, 10).translate(-0.6, whh + 0.6, -0.9), M.dark, wh);
  // mast forward of the wheelhouse, trolling poles out to both sides, rigging, lines to the water
  const mastZ = 3.1, mastBase = V3(0, dY(mastZ), mastZ), mastTop = V3(0, dY(mastZ) + 8.2, mastZ);
  rod(mastBase, mastTop, 0.085, M.wood, group); rod(V3(-0.6, dY(mastZ) + 6.6, mastZ), V3(0.6, dY(mastZ) + 6.6, mastZ), 0.04, M.wood, group);
  const polesOut = (o.poles ?? 'out') !== 'up', tips = [];
  for (const s of [1, -1]) {
    const base = V3(s * 0.35, dY(mastZ) + 0.6, mastZ - 0.1), ang = polesOut ? 0.95 : 0.3, len = 12;
    const tip = V3(s * (0.35 + Math.sin(ang) * len), base.y + Math.cos(ang) * len, mastZ - 0.1 - 1.2);
    rod(base, tip, 0.05, M.wood, group); rod(mastTop, base.clone().lerp(tip, 0.65), 0.008, M.line, group); rod(V3(0, dY(mastZ) + 6.6, mastZ), tip, 0.006, M.line, group);
    tips.push(tip);
    if (polesOut) { rod(tip, V3(tip.x * 1.02, -0.2, tip.z - 3.5), 0.004, M.line, group); rod(base.clone().lerp(tip, 0.55), V3(tip.x * 0.6, -0.2, tip.z - 2.5), 0.004, M.line, group); }
  }
  rod(mastTop, V3(0, sheer(1) + 0.1, L / 2 - 0.1), 0.008, M.line, group);                           // forestay
  rod(mastTop, V3(0, dY(1.2) + whh + 0.1, 0.2), 0.008, M.line, group);
  // mizzen at the stern, gurdies, hatch, anchor + rode
  const mz = -L / 2 + 1.1; rod(V3(0, dY(mz), mz), V3(0, dY(mz) + 4.2, mz), 0.06, M.wood, group);
  for (const s of [1, -1]) { const gz = -3.4; mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 14).rotateZ(Math.PI / 2).translate(s * 0.55, dY(gz) + 0.75, gz), M.dark, group); mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08).translate(s * 0.55, dY(gz) + 0.37, gz), M.dark, group); }
  mesh(new THREE.BoxGeometry(1.3, 0.3, 1.1).translate(0, dY(4.4) + 0.15, 4.4), M.trim, group);
  mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3).translate(0, dY(5.3) + 0.15, 5.3), M.dark, group);
  const anchored = (o.action ?? 'idle') === 'idle' && o.anchored !== false;
  if (anchored) rod(V3(0, sheer(1) - 0.1, L / 2 - 0.05), V3(0, -1.6, L / 2 + 5.5), 0.012, M.line, group);
  // riding lights: masthead white, port red (+x), starboard green (-x), a warm cabin light in the windows
  const lampW = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xFFFFF0, emissive: 0xFFF6E0, emissiveIntensity: 0, roughness: 0.3 }));
  const lampR = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x8A1010, emissive: 0xFF2020, emissiveIntensity: 0, roughness: 0.3 }));
  const lampG = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x106A20, emissive: 0x20FF50, emissiveIntensity: 0, roughness: 0.3 }));
  mesh(new THREE.SphereGeometry(0.08, 10, 8).translate(0, mastTop.y + 0.1, mastZ), lampW, group, false);
  mesh(new THREE.BoxGeometry(0.1, 0.1, 0.16).translate(ww / 2 + 0.07, whh - 0.1, wl / 2 - 0.2), lampR, wh, false);
  mesh(new THREE.BoxGeometry(0.1, 0.1, 0.16).translate(-ww / 2 - 0.07, whh - 0.1, wl / 2 - 0.2), lampG, wh, false);
  const cabin = new THREE.PointLight(0xFFC080, 0, 4, 2); cabin.position.set(0, whh - 0.5, 0); wh.add(cabin);
  // crew
  const crewSlots = [{ x: 0.45, y: dY(-3.9), z: -3.9, yaw: 0.25, pose: 'stand' }, { x: -0.95, y: dY(-1.0), z: -1.0, yaw: -0.1, pose: 'watch' }, { x: 0.9, y: dY(-1.4), z: -1.4, yaw: 0.35, pose: 'stand' }];
  const crew = o.crew ?? 1;
  addCrew(group, crew, crewSlots, ctx, o.seed ?? 1);
  const lightMode = o.lights ?? 'auto';
  function update(t = 0) {
    const on = lightMode === true || lightMode === 'on' ? 1 : lightMode === false || lightMode === 'off' ? 0 : LIGHTS();
    lampW.emissiveIntensity = 5 * on; lampR.emissiveIntensity = 4 * on; lampG.emissiveIntensity = 4 * on; cabin.intensity = 2.5 * on;
  }
  update(0);
  return { group, update, length: L, beam: B, height: mastTop.y, deckAt: dY, anchors: { poleTips: tips } };
}

// ── the Thai longtail boat (ruea hang yao) ───────────────────────────────────────────────────────────────────────────
// ~10 m, narrow wooden hull with painted bands and a high upswept bow wrapped in coloured cloth and garlands, an optional
// canvas sunroof on poles, a car engine on a stern pivot with its long propeller shaft (the "long tail") trailing aft.
export function buildLongtail(o = {}) {
  const L = 10, B = 1.5, group = new THREE.Group(); group.name = 'longtail';
  const R = rng((o.seed ?? 3) * 71 + (o.index ?? 0) * 13 + 5);
  const band = o.color != null ? new THREE.Color(o.color).getHex() : [0x2E6EA8, 0xC0392B, 0x2E8B57, 0xE0A020, 0x1E4E8A][Math.floor(R() * 5)];
  const M = {
    wood: plain({ color: 0x8A6242, roughness: 0.75, side: THREE.DoubleSide }), band: plain({ color: band, roughness: 0.6, side: THREE.DoubleSide }),
    dark: plain({ color: 0x2A2622, roughness: 0.8, side: THREE.DoubleSide }), deck: plain({ color: 0x7A5A3E, roughness: 0.85 }),
    metal: plain({ color: 0x9A9EA2, roughness: 0.35, metalness: 0.8 }), engine: plain({ color: 0x3A3E44, roughness: 0.5, metalness: 0.5 }),
    canvas: plain({ color: [0x2E6EA8, 0xD8D2C0, 0x2E8B57][Math.floor(R() * 3)], roughness: 0.95, side: THREE.DoubleSide }),
  };
  const sheer = (s) => 0.55 + 0.05 * (1 - s) + 1.35 * Math.pow(Math.max(0, (s - 0.62) / 0.38), 2.4);   // high upswept bow
  const keel = (s) => -0.32 + 0.3 * Math.pow(Math.max(0, (s - 0.8) / 0.2), 1.5);
  const halfB = (s) => B / 2 * (s < 0.1 ? lerp(0.62, 0.86, s / 0.1) : s < 0.55 ? 1 - 0.14 * Math.pow((0.55 - s) / 0.45, 2) : Math.pow(Math.cos((s - 0.55) / 0.45 * Math.PI / 2), 0.9));
  const NS = 30, rows = [];
  for (let i = 0; i <= NS; i++) {
    const s = i / NS, z = (s - 0.5) * L, hb = Math.max(0.002, halfB(s)), top = sheer(s), bot = keel(s), row = [];
    const ys = [0, 0.35, 0.7].map((f) => lerp(bot, bot + (top - bot) * 0.3, f)).concat([0.45, 0.62, 0.8, 0.9, 1].map((f) => lerp(bot, top, f)));
    const half = ys.map((y) => { const u = clamp((y - bot) / Math.max(1e-3, top - bot)); return [hb * Math.pow(Math.sin(Math.min(1, u * 1.6) * Math.PI / 2), 0.7), y]; });
    for (let j = half.length - 1; j >= 0; j--) row.push(V3(half[j][0], half[j][1], z));
    for (let j = 1; j < half.length; j++) row.push(V3(-half[j][0], half[j][1], z));
    rows.push(row);
  }
  const nc = rows[0].length, pos = [], lists = { wood: [], band: [], dark: [] };
  rows.forEach((row) => row.forEach((p) => pos.push(p.x, p.y, p.z)));
  for (let i = 0; i < NS; i++) for (let j = 0; j < nc - 1; j++) {
    const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1, jj = Math.min(j, nc - 2 - j);
    lists[jj === 0 ? 'dark' : jj === 1 || jj === 2 ? 'band' : 'wood'].push(a, c, b, b, c, d);
  }
  const all = new THREE.BufferGeometry(); all.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); all.setIndex(Object.values(lists).flat()); all.computeVertexNormals();
  for (const [k, idx] of Object.entries(lists)) { if (!idx.length) continue; const g = new THREE.BufferGeometry(); g.setAttribute('position', all.attributes.position); g.setAttribute('normal', all.attributes.normal); g.setIndex(idx); mesh(g, M[k], group); }
  { const sh = new THREE.Shape(), r0 = rows[0]; sh.moveTo(r0[0].x, r0[0].y); for (const p of r0) sh.lineTo(p.x, p.y); const g = new THREE.ShapeGeometry(sh); g.rotateY(Math.PI); g.translate(0, 0, -L / 2 + 0.001); mesh(g, M.wood, group); }
  // thwarts / floorboards, the bow garland and cloth
  for (let k = 0; k < 6; k++) { const z = -L / 2 + 1.2 + k * 1.35, s = z / L + 0.5; mesh(new THREE.BoxGeometry(halfB(s) * 2 * 0.92, 0.04, 0.22).translate(0, sheer(s) - 0.12, z), M.deck, group); }
  { const s0 = 0.93, zb = (s0 - 0.5) * L, yb = sheer(s0); const cols = [0xE03030, 0xF0C020, 0x30A050, 0xF4F0E8, 0xE070B0];
    for (let k = 0; k < 5; k++) mesh(new THREE.TorusGeometry(0.1 + k * 0.012, 0.035, 6, 14).rotateY(Math.PI / 2).translate(0, yb - 0.05 - k * 0.11, zb - 0.06 * k), plain({ color: cols[k], roughness: 0.9 }), group);
    mesh(new THREE.PlaneGeometry(0.5, 0.9).translate(0.02, yb - 0.5, zb - 0.1).rotateY(0.2), plain({ color: 0xD02020, roughness: 0.9, side: THREE.DoubleSide }), group); }
  // sunroof on four poles (most tourist boats)
  if ((o.canopy ?? (R() < 0.6)) !== false) {
    for (const [x, z] of [[0.55, -2.2], [-0.55, -2.2], [0.55, 1.6], [-0.55, 1.6]]) rod(V3(x, sheer(z / L + 0.5) - 0.1, z), V3(x, 2.05, z), 0.025, M.metal, group);
    mesh(new THREE.BoxGeometry(1.35, 0.03, 4.2).translate(0, 2.06, -0.3), M.canvas, group);
  }
  // the engine on its stern pivot and the long propeller shaft
  const eng = new THREE.Group(); eng.position.set(0, sheer(0) + 0.05, -L / 2 + 0.25); eng.rotation.x = -0.12; group.add(eng);
  mesh(new THREE.BoxGeometry(0.45, 0.4, 0.7).translate(0, 0.2, 0.1), M.engine, eng);
  mesh(new THREE.BoxGeometry(0.2, 0.12, 0.3).translate(0, 0.46, 0.35), M.metal, eng);
  rod(V3(0, 0.05, -0.2), V3(0, -0.7, -4.2), 0.028, M.metal, eng);
  mesh(new THREE.BoxGeometry(0.03, 0.22, 0.04).translate(0, -0.7, -4.25), M.metal, eng);
  rod(V3(0, 0.3, 0.3), V3(0, 0.55, 1.6), 0.02, M.metal, eng);                                       // tiller
  return { group, update() {}, length: L, beam: B, height: 2.2 };
}
