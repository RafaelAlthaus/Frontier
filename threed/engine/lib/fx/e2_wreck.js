// e2_wreck.js — (E2, Frontier 3D v2) after the sinking: people in the water, wreckage, lifeboats lowered from davits.
//   crowd.in_water   faceless white mannequins in white 1912 cork life jackets, treading water / floating back / waving,
//                    slow bob on the swell, small sculling arm movement; a scatter around a point or a field along a
//                    heading (the sink's debris field); they can surface one by one over `appear` [t0, t1]. Tasteful: no
//                    injuries, no faces, the head and shoulders above the water, the jacket at the waterline.
//   debris.wreckage  deck chairs, planks, lifebuoys, crates and cork floating on the swell, drifting and turning slowly.
//   ship.lifeboat    a 30 ft wooden lifeboat lowered from a liner's davit (swung out, lowered on its falls to the water
//                    over lower_dur s with a slight sway, the falls let go), crew seated in life jackets, then rows away
//                    (oars sweeping) along a smooth track; the liner's own boat at that station disappears as it goes.
// Instanced, pure functions of t, seeded.
import * as THREE from 'three';
import { rng, clamp, lerp, smooth } from '../shared/util.js';
import { prm, num } from './w_common.js';
import { boatGeos, DAVIT_S, TI_HB, deckBoat } from '../human/titanic.js';
import { smoothTrack, speedProfile } from '../human/motion.js';
import { ensureUnderwater } from './e2_under.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const waterOf = (ctx) => (ctx.ground && ctx.ground.water && typeof ctx.ground.water.heightAt === 'function' ? ctx.ground.water : null);

export const CATALOG = {
  'crowd.in_water': {
    desc: 'people in the water after a sinking (tasteful, no gore): faceless white mannequins in white 1912 cork life jackets, head and shoulders above the water; tread (upright, arms sculling), float (lying back on the jacket, arms spread), wave (one arm up, calling for help), mix (default). Slow bob on the swell, drifting apart slowly. Scatter around `at` (radius) or a field along `heading` (length x width: lay it along the sunk ship). `appear` [t0, t1]: they surface one by one (else there from the start).',
    actions: ['tread', 'float', 'wave', 'mix'],
    params: { at: '[x, z] centre', count: '1..120 (default 24)', radius: 'm (scatter, default 25)', length: 'm (a field along heading instead of a disc)', width: 'm (field, default 40)', heading: 'deg (field axis)', appear: '[t0, t1] s: surfacing times spread over this window', drift: 'm/s (default 0.05)', seed: 'int' },
    footprint: [40, 40], height: 0.6, tags: ['people', 'sea', 'titanic', 'survivors', 'water', 'figure', 'crowd'], section: 'groups',
  },
  'debris.wreckage': {
    desc: 'floating wreckage: steamer deck chairs, planks, white lifebuoys, crates and cork blocks bobbing on the swell, drifting and turning slowly. Scatter around `at` or a field along `heading`; `appear` [t0, t1] lets them come up over time.',
    actions: ['idle'],
    params: { at: '[x, z]', count: '1..400 (default 70)', radius: 'm (default 35)', length: 'm (field along heading)', width: 'm (default 50)', heading: 'deg', mix: "{plank, chair, buoy, crate, cork} weights (default titanic mix)", appear: '[t0, t1] s', seed: 'int' },
    footprint: [60, 60], height: 0.5, tags: ['sea', 'debris', 'wreck', 'titanic', 'water'], section: 'objects',
  },
  'ship.lifeboat': {
    desc: "a 30 ft wooden lifeboat lowered from a liner's davit: swung out, lowered on its falls to the water over lower_dur s (a slight sway, one end a little ahead), the falls let go, then its crew (seated, faceless, in life jackets) row it away from the ship's side along a smooth track. The liner's own boat at that station disappears when it goes. Needs ship.liner_1912 in the scene; davit = one of its stations boat_port_1..8 / boat_starboard_1..8 (1 = forward).",
    actions: ['lower', 'row', 'idle'],
    params: { from: "the liner ('titanic' id, 'objects:N'; optional: the davit name is looked up in the scene)", davit: 'boat_port_1..8 | boat_starboard_1..8 (default boat_port_3)', lower_at: 's the swing-out starts (default 1)', lower_dur: 's to reach the water (default 6)', row_away: 'true (default) | false', row_speed: 'm/s (default 1.3)', crew: '0..12 seated (default 7)', at: '[x, z] only without a liner: afloat here, heading' },
    footprint: [2.75, 9.15], height: 1.6, tags: ['ship', 'boat', 'lifeboat', 'titanic', '1910s'], section: 'objects',
  },
};

export async function build(kind, item, ctx) {
  if (kind === 'crowd.in_water') return people(item, ctx);
  if (kind === 'debris.wreckage') return wreckage(item, ctx);
  return lifeboat(item, ctx);
}

// ── shared: the mannequin in a cork jacket, as instanced parts ──────────────────────────────────────────────────────
const PARTS = {};
function partGeos() {
  if (PARTS.body) return PARTS;
  const head = new THREE.SphereGeometry(0.105, 18, 14); head.scale(0.92, 1.18, 1.0); head.translate(0, 0.25, 0);
  const neck = new THREE.CylinderGeometry(0.048, 0.055, 0.12, 12); neck.translate(0, 0.1, 0);
  const torso = new THREE.CylinderGeometry(0.16, 0.13, 0.66, 16); torso.translate(0, -0.3, 0);
  const shoulders = new THREE.SphereGeometry(0.17, 16, 8, 0, TAU, 0, Math.PI / 2); shoulders.scale(1.25, 0.45, 0.8);
  const body = mergeParts([head, neck, torso, shoulders]);
  // the 1912 cork jacket: two panels of cork blocks in white canvas, front and back, with shoulder straps
  const jk = [];
  for (const zf of [1, -1]) for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) { const b = new THREE.BoxGeometry(0.155, 0.13, 0.07); b.translate((c - 0.5) * 0.165, -0.04 - r * 0.14, zf * 0.155); jk.push(b); }
  for (const sx of [1, -1]) { const st = new THREE.BoxGeometry(0.07, 0.03, 0.34); st.translate(sx * 0.1, 0.035, 0); jk.push(st); }
  const jacket = mergeParts(jk);
  const upper = new THREE.CylinderGeometry(0.045, 0.04, 0.29, 10); upper.translate(0, -0.145, 0);
  const fore = new THREE.CylinderGeometry(0.038, 0.032, 0.27, 10); fore.translate(0, -0.135, 0);
  const hand = new THREE.SphereGeometry(0.045, 10, 8); hand.scale(0.8, 1.2, 0.5); hand.translate(0, -0.3, 0);
  Object.assign(PARTS, { body, jacket, upper, fore: mergeParts([fore, hand]) });
  for (const g of Object.values(PARTS)) g.userData.keep = true;                   // shared across scenes
  return PARTS;
}
function mergeParts(list) {
  const pos = [], nrm = [], idx = []; let off = 0;
  for (const g0 of list) { const g = g0.index ? g0 : g0; const P = g.attributes.position, N = g.attributes.normal; for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); } const I = g.index ? g.index.array : [...Array(P.count).keys()]; for (const k of I) idx.push(k + off); off += P.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(idx); return g;
}
function figureSet(ctx, n, name) {
  const G = partGeos();
  const skin = new THREE.MeshStandardMaterial({ color: 0xE8E3D8, roughness: 0.55 }), canvas = new THREE.MeshStandardMaterial({ color: 0xF2EEE2, roughness: 0.9 });
  if (ctx.patch) { ctx.patch(skin); ctx.patch(canvas); }
  const mk = (g, m) => { const im = new THREE.InstancedMesh(g, m, n); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.name = name; return im; };
  const S = { body: mk(G.body, skin), jacket: mk(G.jacket, canvas), uL: mk(G.upper, skin), uR: mk(G.upper, skin), fL: mk(G.fore, skin), fR: mk(G.fore, skin) };
  const group = new THREE.Group(); group.name = name; Object.values(S).forEach((m) => group.add(m));
  const M = new THREE.Matrix4(), A = new THREE.Matrix4(), B = new THREE.Matrix4(), Z = new THREE.Matrix4().makeScale(0, 0, 0), e = new THREE.Euler(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  // set(i, bodyMatrix, arms: {l: [flexion, abduction, twist, elbow], r: [...]}) — angles in radians; flexion = forward,
  // abduction = out to the side (0 = arm hanging down), elbow = bend
  function set(i, body, arms) {
    if (!body) { for (const m of Object.values(S)) m.setMatrixAt(i, Z); return; }
    S.body.setMatrixAt(i, body); S.jacket.setMatrixAt(i, body);
    for (const [side, up, fo] of [[1, S.uL, S.fL], [-1, S.uR, S.fR]]) {
      const a = side > 0 ? arms.l : arms.r;
      e.set(-a[0], a[2] * side, side * a[1], 'ZXY'); q.setFromEuler(e);
      A.compose(v.set(side * 0.2, 0.0, 0), q, one); M.multiplyMatrices(body, A); up.setMatrixAt(i, M);
      e.set(-a[3], 0, 0); q.setFromEuler(e); B.compose(v.set(0, -0.29, 0), q, one); M.multiply(B); fo.setMatrixAt(i, M);
    }
  }
  function commit() { for (const m of Object.values(S)) m.instanceMatrix.needsUpdate = true; }
  return { group, set, commit };
}
function layout(P, n, R, at, defR = 25) {
  const L = num(P.length, 0), Wd = num(P.width, 40), hd = num(P.heading, 0) * DEG, out = [];
  const fx = [Math.sin(hd), -Math.cos(hd)], px = [Math.cos(hd), Math.sin(hd)];
  for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
    let x, z;
    if (L > 0) { const a = (R() - 0.5) * L, b = (R() - 0.5) * Wd * (0.6 + 0.4 * Math.cos(a / L * Math.PI)); x = at[0] + fx[0] * a + px[0] * b; z = at[1] + fx[1] * a + px[1] * b; }
    else { const r = num(P.radius, defR) * Math.sqrt(R()), th = R() * TAU; x = at[0] + Math.cos(th) * r; z = at[1] + Math.sin(th) * r; }
    if (out.some((o) => Math.hypot(o[0] - x, o[1] - z) < 1.6)) continue;
    out.push([x, z]); i++;
  }
  return out;
}
const appearAt = (P, i, n, R) => { const ap = Array.isArray(P.appear) ? P.appear.map(Number) : null; return ap && ap.length >= 2 ? lerp(ap[0], ap[1], (i + R() * 0.8) / Math.max(1, n)) : -1e9; };

// ── people in the water ────────────────────────────────────────────────────────────────────────────────────────────
function people(item, ctx) {
  const P = prm(item), R = rng(((item.seed ?? 5) * 7349 + (item.index ?? 0) * 31) >>> 0);
  const n = clamp(Math.round(num(P.count, 24)), 1, 120), at = item.at || [0, 0];
  const pts = layout(P, n, R, at), N = pts.length;
  const act = String(item.action || P.action || 'mix');
  const F = figureSet(ctx, N, 'crowd.in_water');
  const root = new THREE.Group(); root.name = 'crowd.in_water'; root.add(F.group);
  const drift = num(P.drift, 0.05);
  const P2 = pts.map(([x, z], i) => {
    const r = R(), mode = act === 'mix' ? (r < 0.55 ? 'tread' : r < 0.85 ? 'float' : 'wave') : act;
    return { x, z, mode, yaw: R() * TAU, spin: (R() - 0.5) * 0.04, ph: R() * TAU, f: 0.55 + R() * 0.35, dd: [Math.cos(R() * TAU), Math.sin(R() * TAU)], dv: drift * (0.4 + R()), up: appearAt(P, i, N, R), lean: (R() - 0.5) * 0.12 };
  });
  const W = () => waterOf(ctx), lvl = () => ctx.water?.level ?? 0;
  const body = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const posAt = (p, t) => [p.x + p.dd[0] * p.dv * t, p.z + p.dd[1] * p.dv * t];
  const UW = ensureUnderwater(ctx);
  function update(t, clock, camera) {
    if (camera) UW.update(t, camera);
    const w = W();
    P2.forEach((p, i) => {
      const [x, z] = posAt(p, t), sw = w ? w.heightAt(x, z, t) : lvl();
      const k = smooth((t - p.up) / 1.4);                                         // surfacing
      if (k <= 0) { F.set(i, null); return; }
      const bob = 0.035 * Math.sin(TAU * p.f * t + p.ph) + 0.015 * Math.sin(TAU * 0.23 * t + p.ph * 2);
      const back = p.mode === 'float' ? 0.62 : 0.06 + p.lean;                    // floating: lying back on the jacket
      const y = sw + (p.mode === 'float' ? -0.02 : 0.06) + bob - (1 - k) * 1.6;
      e.set(-back, p.yaw + p.spin * t, p.lean * 0.5, 'YXZ'); q.setFromEuler(e); body.compose(v.set(x, y, z), q, one);
      const s = Math.sin(TAU * p.f * 1.1 * t + p.ph), s2 = Math.sin(TAU * 1.2 * t + p.ph);
      let arms;
      if (p.mode === 'float') arms = { l: [0.15, 1.35 + 0.05 * s, 0, 0.35], r: [0.15, 1.35 - 0.05 * s, 0, 0.35] };
      else if (p.mode === 'wave') arms = { l: [0.3 + 0.1 * s, 2.55, 0.2 * s2, 0.35 + 0.25 * s2], r: [0.35, 1.2 + 0.12 * s, 0.35 * s, 0.6] };
      else arms = { l: [0.35 + 0.15 * s, 1.15, 0.45 * s, 0.55 + 0.15 * s], r: [0.35 - 0.15 * s, 1.15, -0.45 * s, 0.55 - 0.15 * s] };   // treading: sculling
      F.set(i, body, arms);
    });
    F.commit();
  }
  update(0);
  const members = (t) => P2.map((p) => posAt(p, t));
  return { root, radius: Math.max(num(P.radius, 25), num(P.length, 0) / 2), height: 0.6, update, members, anchors: { body: root }, snapped: true, contact: false };
}

// ── wreckage ───────────────────────────────────────────────────────────────────────────────────────────────────────
function chairGeo() {
  const parts = [];
  const bx = (w, h, d, x, y, z, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); parts.push(g); };
  for (let k = 0; k < 6; k++) bx(0.56, 0.02, 0.09, 0, 0.0, -0.3 + k * 0.12);           // seat slats
  for (let k = 0; k < 5; k++) bx(0.56, 0.02, 0.09, 0, 0.18 + k * 0.1, -0.42 - k * 0.07, -0.95);   // back, reclined
  for (let k = 0; k < 4; k++) bx(0.5, 0.02, 0.09, 0, -0.06 - k * 0.03, 0.42 + k * 0.1, 0.25);     // leg rest
  for (const sx of [-0.3, 0.3]) { bx(0.05, 0.05, 1.3, sx, 0.0, 0.05); bx(0.05, 0.05, 0.6, sx, 0.2, -0.05); }                  // rails, arms
  return mergeParts(parts);
}
function wreckage(item, ctx) {
  const P = prm(item), R = rng(((item.seed ?? 9) * 911 + (item.index ?? 0) * 7) >>> 0);
  const n = clamp(Math.round(num(P.count, 70)), 1, 400), at = item.at || [0, 0];
  const pts = layout(P, n, R, at, 35), N = pts.length;
  const mix = Object.assign({ plank: 4, chair: 2.5, buoy: 1, crate: 1.5, cork: 1 }, typeof P.mix === 'object' ? P.mix : {});
  const tot = Object.values(mix).reduce((a, b) => a + b, 0);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6E5A44, roughness: 0.85 }), teak = new THREE.MeshStandardMaterial({ color: 0x5A3E28, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xEDEAE2, roughness: 0.6 }), cork = new THREE.MeshStandardMaterial({ color: 0xE8E0CC, roughness: 0.95 });
  for (const m of [wood, teak, white, cork]) if (ctx.patch) ctx.patch(m);
  const G = { plank: [new THREE.BoxGeometry(0.24, 0.06, 1), wood], chair: [chairGeo(), teak], buoy: [new THREE.TorusGeometry(0.36, 0.085, 10, 28).rotateX(Math.PI / 2), white], crate: [new THREE.BoxGeometry(0.7, 0.5, 0.6), wood], cork: [new THREE.BoxGeometry(0.16, 0.08, 0.14), cork] };
  const root = new THREE.Group(); root.name = 'debris.wreckage'; root.userData.noQA = true;
  const types = Object.keys(G), inst = {}, list = [];
  pts.forEach(([x, z], i) => {
    let r = R() * tot, ty = types[0]; for (const k of types) { r -= mix[k] || 0; if (r <= 0) { ty = k; break; } }
    list.push({ ty, x, z, yaw: R() * TAU, spin: (R() - 0.5) * 0.08, len: ty === 'plank' ? 1.2 + R() * 3 : 1, tilt: (R() - 0.5) * (ty === 'chair' ? 0.5 : 0.15), ph: R() * TAU, dd: [Math.cos(R() * TAU), Math.sin(R() * TAU)], dv: 0.03 + R() * 0.05, up: appearAt(P, i, N, R) });
  });
  for (const k of types) { const c = list.filter((o) => o.ty === k).length; if (!c) continue; const im = new THREE.InstancedMesh(G[k][0], G[k][1], c); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.name = 'wreck-' + k; root.add(im); inst[k] = { im, i: 0 }; }
  const m4 = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), Z = new THREE.Matrix4().makeScale(0, 0, 0);
  const lvl = () => ctx.water?.level ?? 0;
  function update(t) {
    const w = waterOf(ctx);
    for (const k in inst) inst[k].i = 0;
    for (const o of list) {
      const I = inst[o.ty]; const x = o.x + o.dd[0] * o.dv * t, z = o.z + o.dd[1] * o.dv * t;
      const k = smooth((t - o.up) / 1.2);
      if (k <= 0) { I.im.setMatrixAt(I.i++, Z); continue; }
      const y = (w ? w.heightAt(x, z, t) : lvl()) + (o.ty === 'crate' ? 0.08 : o.ty === 'chair' ? 0.02 : 0.01) - (1 - k) * 1.2 + 0.02 * Math.sin(t * 1.3 + o.ph);
      q.setFromEuler(e.set(o.tilt + 0.05 * Math.sin(t * 0.9 + o.ph), o.yaw + o.spin * t, 0.06 * Math.sin(t * 0.7 + o.ph * 2)));
      sv.set(1, 1, o.ty === 'plank' ? o.len : 1); pv.set(x, y, z); m4.compose(pv, q, sv); I.im.setMatrixAt(I.i++, m4);
    }
    for (const k in inst) inst[k].im.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { root, radius: Math.max(num(P.radius, 35), num(P.length, 0) / 2), height: 0.5, update, anchors: {}, snapped: true, contact: false };
}

// ── a lifeboat lowered from the liner's davits ────────────────────────────────────────────────────────────────────
function lifeboat(item, ctx) {
  const P = prm(item), R = rng(((item.seed ?? 3) * 613 + (item.index ?? 0) * 11) >>> 0);
  const davit = typeof P.davit === 'string' ? P.davit : 'boat_port_3';
  const md = /^boat_(port|starboard)_(\d)$/.exec(davit) || [null, 'port', '3'];
  const sd = md[1] === 'port' ? 1 : -1, si = clamp(+md[2], 1, 8) - 1, sb = DAVIT_S[si], cutter = si === 0;
  const kL = cutter ? 0.83 : 1, BG = boatGeos(), Lb = BG.Lb * kL;
  const t0 = num(P.lower_at, 1), swing = cutter ? 0.01 : 1.4, Tl = Math.max(1, num(P.lower_dur, 6)), tWater = t0 + swing + Tl;
  const rowAway = P.row_away !== false && P.row_away !== 'false', vRow = num(P.row_speed, 1.3), nCrew = clamp(Math.round(num(P.crew, 7)), 0, 12);
  const white = new THREE.MeshStandardMaterial({ color: 0xE6E1D4, roughness: 0.6, side: THREE.DoubleSide }), teak = new THREE.MeshStandardMaterial({ color: 0x5E3C22, roughness: 0.5 }), wood = new THREE.MeshStandardMaterial({ color: 0x8A6A48, roughness: 0.8 }), rope = new THREE.MeshStandardMaterial({ color: 0x7A6A54, roughness: 0.9 });
  for (const m of [white, teak, wood, rope]) if (ctx.patch) ctx.patch(m);
  const root = new THREE.Group(); root.name = 'ship.lifeboat';
  const boat = new THREE.Group(); boat.name = 'lifeboat-body'; root.add(boat);
  const hull = new THREE.Mesh(BG.hull, white); hull.scale.set(cutter ? 0.92 : 1, 1, kL); boat.add(hull);
  const gun = new THREE.Mesh(BG.gun, teak); gun.scale.copy(hull.scale); boat.add(gun);
  for (let k = 0; k < 5; k++) { const th = new THREE.Mesh(new THREE.BoxGeometry(BG.Bb * 0.86, 0.05, 0.26), wood); th.position.set(0, 0.62, (k - 2) * Lb * 0.17); boat.add(th); }
  // crew: seated on the thwarts, in life jackets; they row once afloat
  const F = figureSet(ctx, Math.max(1, nCrew), 'lifeboat-crew'); boat.add(F.group); if (!nCrew) { F.set(0, null); F.commit(); }
  const seats = []; for (let k = 0; k < nCrew; k++) { const row = Math.floor(k / 2), side = k % 2 ? -1 : 1; seats.push({ x: side * 0.55, z: (row - 1.6) * Lb * 0.17, side, ph: R() * 0.4, rower: row >= 1 && row <= 3 }); }
  // oars: two a side, pivoting at the gunwale
  const oars = [];
  for (const [ox, oz] of [[1, -0.6], [-1, -0.6], [1, 1.0], [-1, 1.0]]) { const g = new THREE.Group(); g.position.set(ox * BG.Bb * 0.5, 1.1, oz); const o = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 4.2, 6).rotateZ(Math.PI / 2).translate(ox * 1.5, 0, 0), wood); g.add(o); g.userData.side = ox; boat.add(g); oars.push(g); }
  // the falls: a rope from each davit head to each end of the boat
  const falls = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 5).translate(0, 0.5, 0), rope); m.frustumCulled = false; root.add(m); return m; });
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // the liner: found through its davit anchor (it rides the ship, and her halves if she breaks)
  let anc = null, tit = null, tRoot = null, looked = false;
  const find = () => { if (looked) return; looked = true; ctx.scene.traverse((o) => { if (!anc && o.name === 'anchor:' + davit) anc = o; }); for (let p = anc; p; p = p.parent) if (p.userData && p.userData.titanic) { tit = p.userData.titanic; tRoot = p; break; } if (!anc && ctx.warn) ctx.warn(`ship.lifeboat: no '${davit}' anchor (no ship.liner_1912 in the scene?); afloat at 'at'`); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z), W = () => waterOf(ctx), lvl = () => ctx.water?.level ?? 0;
  const loc = (x, y, s) => V(x, y, -s).applyMatrix4(anc.parent.matrixWorld);
  const locR = (x, y, s) => V(x, y, -s).applyMatrix4((tRoot || anc.parent).matrixWorld);           // the heading frame (no trim)
  const yb = deckBoat(sb), xIn = sd * (cutter ? TI_HB + 1.55 : 12.3), xOut = sd * (TI_HB + 1.55);
  const fwdOf = () => { const a = loc(0, 0, sb - 1), b = loc(0, 0, sb + 1); return [(a.x - b.x) / 2, (a.z - b.z) / 2]; };
  // the pose where she touches the water (for the row-away track, fixed at build from the ship's pose at tWater)
  let track = null, prof = null, P0 = null, fw0 = null;
  const setBoat = (x, y, z, yaw, pitch, roll) => { boat.position.set(x, y, z); boat.rotation.set(0, 0, 0); boat.rotateY(yaw); boat.rotateX(-pitch); boat.rotateZ(roll); };
  const ends = () => [V(0, BG.top + 0.1, Lb / 2 - 0.3).applyMatrix4(boat.matrixWorld), V(0, BG.top + 0.1, -Lb / 2 + 0.3).applyMatrix4(boat.matrixWorld)];
  const ropeTo = (m, a, b) => { const d = b.clone().sub(a), L = d.length(); m.position.copy(a); m.scale.set(1, Math.max(0.01, L), 1); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); };
  function update(t) {
    find();
    const w = W();
    if (!anc) { const a = item.at || [0, 0], hd = (item.heading ?? 0) * DEG; setBoat(a[0], (w ? w.heightAt(a[0], a[1], t) : lvl()) - 0.35, a[1], Math.PI - hd, 0, 0.02 * Math.sin(t)); falls.forEach((f) => { f.visible = false; }); crew(t, false); return; }
    anc.updateWorldMatrix(true, false);
    if (tit) tit.hideBoat(davit, t >= t0);
    root.visible = t >= t0;
    const fw = fwdOf(), yaw = Math.atan2(fw[0], fw[1]);
    let x, y, z, pitch = 0, roll = 0, onWater = false;
    if (t < tWater) {
      const u1 = smooth((t - t0) / Math.max(0.01, swing)), u2 = clamp((t - t0 - swing) / Tl);
      const xs = lerp(xIn, xOut, u1), ys = yb + lerp(0.36, -0.2, u1) + 0.25 * Math.sin(Math.PI * u1);
      const hang = loc(xs, ys, sb);
      const wy = (w ? w.heightAt(hang.x, hang.z, t) : lvl()) - 0.35;
      const e2 = u2 * u2 * (3 - 2 * u2);
      const rel = locR(xOut, yb - 0.2, sb), bl = smooth((u2 - 0.6) / 0.4);         // settle onto the heading-frame release point
      x = lerp(hang.x, rel.x, bl); z = lerp(hang.z, rel.z, bl); y = lerp(hang.y, wy, e2);
      const sw = Math.sin(TAU * t / 2.3) * (1 - e2) * u1 * (u2 > 0 ? 1 : 0.3);
      roll = 0.05 * sw * sd; pitch = 0.05 * Math.sin(Math.PI * u2) * (R.bias ??= (R() - 0.5) * 2);   // one end a little ahead
      const E = ends();
      const heads = [loc(xOut, yb + 4.3, sb - Lb / 2 + 0.3), loc(xOut, yb + 4.3, sb + Lb / 2 - 0.3)];
      setBoat(x, y, z, yaw, pitch, roll); boat.updateMatrixWorld(true);
      const E2 = ends(); void E;
      falls.forEach((f, k) => { f.visible = u1 > 0.02; ropeTo(f, E2[k], heads[k]); });
    } else {
      onWater = true;
      if (!track) {                                                           // the release point and the row-away track
        (tRoot || anc.parent).updateWorldMatrix(true, false);
        const hang = locR(xOut, yb - 0.2, sb); P0 = [hang.x, hang.z]; const a2 = locR(0, 0, sb - 1), b2 = locR(0, 0, sb + 1); fw0 = [(a2.x - b2.x) / 2, (a2.z - b2.z) / 2];
        const pr = [fw0[1] * sd, -fw0[0] * sd], f = fw0;                        // pr: outward from the hull
        // a straight lead-in behind the release point, so the smoothed track leaves along the boat's own axis (no yaw step)
        const pts = [[P0[0] - f[0] * 40, P0[1] - f[1] * 40], P0, [P0[0] + f[0] * 14 + pr[0] * 1, P0[1] + f[1] * 14 + pr[1] * 1], [P0[0] + f[0] * 32 + pr[0] * 18, P0[1] + f[1] * 32 + pr[1] * 18], [P0[0] + f[0] * 46 + pr[0] * 160, P0[1] + f[1] * 46 + pr[1] * 160]];
        track = smoothTrack(pts, { rmin: 12 });
        prof = speedProfile(rowAway ? vRow : 0, { start: tWater + 1.2, ramp: 4 });
      }
      const s = 40 + (rowAway ? prof.dist(t) : 0), p = track.at(s), yw = track.yaw(s);
      const wy = (w ? w.heightAt(p[0], p[1], t) : lvl()) - 0.35;
      setBoat(p[0], wy, p[1], yw, 0.02 * Math.sin(t * 0.9), 0.03 * Math.sin(t * 1.1 + 1));
      falls.forEach((f, k) => { const k2 = 1 - smooth((t - tWater) / 0.8); f.visible = k2 > 0.02; if (f.visible) { const E2 = ends(); const hd = loc(xOut, yb + 4.3, sb + (k ? 1 : -1) * (Lb / 2 - 0.3)); ropeTo(f, E2[k], hd); f.scale.y *= k2 + 0.001; } });
    }
    crew(t, onWater && rowAway && t > tWater + 1.2);
  }
  function crew(t, rowing) {
    const st = rowing ? TAU * 0.42 * t : 0, s = Math.sin(st), c = Math.cos(st);
    const body = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    seats.forEach((p, i) => {
      const row = rowing && p.rower, lean = row ? 0.25 * s : 0.05;
      e.set(-lean, p.side > 0 ? Math.PI : Math.PI, 0, 'YXZ'); q.setFromEuler(e);
      body.compose(v.set(p.x, 0.62 + 0.6, p.z), q, one);
      const arms = row ? { l: [1.1 + 0.35 * s, 0.25, 0, 0.6 - 0.4 * s], r: [1.1 + 0.35 * s, 0.25, 0, 0.6 - 0.4 * s] } : { l: [0.5, 0.15, 0, 1.3], r: [0.5, 0.15, 0, 1.3] };
      F.set(i, body, arms);
    });
    F.commit();
    oars.forEach((g) => { g.visible = rowing; if (!rowing) return; const sd2 = g.userData.side; g.rotation.set(0, sd2 * (0.45 * s), sd2 * (0.12 + 0.1 * c)); });
  }
  update(0);
  return { root, radius: 5, height: 2, update, anchors: { body: boat }, snapped: true, contact: false };
}
