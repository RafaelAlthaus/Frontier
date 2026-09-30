// actions.js — Q10 figure actions for cast figures (the H4 "the narration names an action nobody performs" fails):
//   lie_back       a casualty lying on the back (params: revive_at)
//   cpr            chest compressions on a lie_back / struck_fall figure (params: patient, side, beats | t_start+rate+count)
//   look_up        head and chest tilt up to the sky, optional hand shading the eyes (params: t_start, shade, look_at)
//   watch + look_at  the existing watch pose, head and eyes aimed at a world point (params: look_at [x,y,z] | [x,z])
//   struck_fall    a stiff jolt, a collapse to the ground, lying still (params: t_hit | the timeline entry's t, before)
//   dig / probe / beacon   avalanche rescue with a shovel, a probe pole, a transceiver (props in the hands)
//   ski            a skier on skis with poles gliding along `path`, carving (roll from the path's curvature)
//   blanket_crouch curled low under a wool blanket, on the ground or in a car footwell (params: floor_y, mode)
//   enter          run / walk to a door, the door swings open, step through, the door slams at t_close (prop.door)
//   shield_face    forearms up in front of the face, turning away from heat (params: t_start, from)
//   tap_helmet     the right hand taps the top of the head / helmet at params.taps [t..]
// Hooked into cast.js with a few additive lines: register() adds the names, aliases, speeds; prepare() rewrites items
// that need a path or a placement (enter, cpr, beacon); attach() returns the per-figure handler whose evalAction()
// poses the skeleton for these actions and whose after() places props, the door, the terrain tilt of a lying body.
// Everything is a pure function of t (deterministic), every phase eases, the props are simple clean low-poly shapes.
import * as THREE from 'three';
import * as R from './rig.js';
import { plain } from '../shared/materials.js';
import { ground, xz, yawFromHeading, DEG, polyPath } from './common.js';
import { clamp, lerp } from '../shared/util.js';

const PI = Math.PI, TAU = PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sm = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const smr = (x, a, b) => sm((x - a) / (b - a));
const num = (v, d) => (v != null && Number.isFinite(+v) ? +v : d);

export const ACTIONS = ['lie_back', 'cpr', 'look_up', 'struck_fall', 'dig', 'probe', 'beacon', 'ski', 'blanket_crouch', 'enter', 'shield_face', 'tap_helmet'];
const HIDDEN = ['beacon_stand'];                 // internal: beacon without a path (stands and sweeps)
export const ALIAS = {
  casualty: 'lie_back', lying: 'lie_back', lie: 'lie_back', lie_down: 'lie_back', supine: 'lie_back', unconscious: 'lie_back', patient: 'lie_back',
  compressions: 'cpr', chest_compressions: 'cpr', look_sky: 'look_up', look_upward: 'look_up', struck: 'struck_fall', knocked_down: 'struck_fall',
  collapse: 'struck_fall', fall: 'struck_fall', shovel: 'dig', digging: 'dig', probing: 'probe', transceiver: 'beacon', beacon_search: 'beacon',
  skiing: 'ski', skier: 'ski', blanket: 'blanket_crouch', under_blanket: 'blanket_crouch', crouch_under_blanket: 'blanket_crouch',
  open_door: 'enter', go_indoors: 'enter', go_inside: 'enter', shield: 'shield_face', cover_face: 'shield_face', knock_helmet: 'tap_helmet',
};
export const SPEED = { ski: 9, beacon: 0.75 };
export const MOVING = ['ski', 'beacon'];
// cross-fade seconds into an action (cast.js default 1 s): a jolt is instant
export const FADE = { struck_fall: 0.1, tap_helmet: 0.5, shield_face: 0.45 };

// cast.js calls this once: add the names, aliases, speeds and moving actions to its tables
export function register({ ACTIONS: A, ALIAS: AL, SPEED: SP, MOVING: MV }) {
  for (const a of [...ACTIONS, ...HIDDEN]) if (!A.includes(a)) A.push(a);
  for (const [k, v] of Object.entries(ALIAS)) if (!(k in AL)) AL[k] = v;
  Object.assign(SP, SPEED);
  for (const a of MOVING) MV.add(a);
}
const OWN = new Set([...ACTIONS, ...HIDDEN]);

// ── per-scene registry of cast figures (a rescuer finds its patient) ─────────────────────────────────────────────
const SCENES = new WeakMap();
function reg(ctx) { let r = SCENES.get(ctx); if (!r) { r = { byRef: {}, list: [], doors: {} }; SCENES.set(ctx, r); } return r; }

// the params of one action: item-level keys, item.params, then the timeline entry's own keys (entry wins)
function entriesOf(item) {
  const acts = Array.isArray(item.actions) && item.actions.length ? item.actions.map((e) => (Array.isArray(e) ? { t: +e[0] || 0, action: e[1] } : e)) : [{ t: 0, action: item.action }];
  return acts;
}

// ── prepare: rewrite the item before the controller reads it (enter -> a path through the door; cpr -> placement) ──
export function prepare(item, ctx, res) {
  const R0 = reg(ctx);
  item = { ...item };
  const P = { ...(item.params || {}) };
  const pr = (k, d) => P[k] ?? item[k] ?? d;
  const names = entriesOf(item).map((e) => String(e.action || 'stand').toLowerCase()).map((a) => ALIAS[a] || a);
  // beacon without a path stands and sweeps
  if (names.includes('beacon') && !(Array.isArray(item.path) && item.path.length >= 1)) {
    const ren = (a) => ((ALIAS[String(a).toLowerCase()] || String(a).toLowerCase()) === 'beacon' ? 'beacon_stand' : a);
    if (Array.isArray(item.actions) && item.actions.length) item.actions = item.actions.map((e) => (Array.isArray(e) ? [e[0], ren(e[1])] : { ...e, action: ren(e.action) }));
    else item.action = ren(item.action);
  }
  if (names.includes('enter')) prepareEnter(item, ctx, P, pr, R0);
  if (names.includes('cpr')) prepareCPR(item, ctx, res, P, pr, R0);
  R0.list.push(item);
  if (item.ref) R0.byRef[item.ref] = R0.byRef[item.ref] || { item };
  return item;
}

// ── skeleton helpers ───────────────────────────────────────────────────────────────────────────────────────────────
function basis(a, f) { const s = a.clone().cross(f).normalize(); const ff = s.clone().cross(a).normalize(); return new THREE.Matrix4().makeBasis(a.clone().normalize(), ff, s); }
function restOf(p0, p1, p2, bend) {
  const a1 = p1.clone().sub(p0).normalize(), a2 = p2.clone().sub(p1).normalize();
  const f1 = bend.clone().sub(a1.clone().multiplyScalar(bend.dot(a1))).normalize();
  const f2 = bend.clone().sub(a2.clone().multiplyScalar(bend.dot(a2))).normalize();
  return { m1T: basis(a1, f1).transpose(), m2T: basis(a2, f2).transpose(), L1: p0.distanceTo(p1), L2: p1.distanceTo(p2) };
}
// body probe spheres (bone, local offset, radius): the lowest body surface for lying / kneeling / falling poses
function bodyProbes(fig) {
  const B = fig.rig.B, s = fig.rig.s, bw = (n) => B[n].userData.bind, L = [];
  const add = (b, off, r) => L.push({ b: B[b], o: off, r: r * s });
  const mid = (a, c, f = 0.5) => bw(c).clone().sub(bw(a)).multiplyScalar(f);
  add('pelvis', V3(0, -0.01 * s, -0.01 * s), 0.122); add('pelvis', V3(0.1 * s, -0.06 * s, -0.01 * s), 0.1); add('pelvis', V3(-0.1 * s, -0.06 * s, -0.01 * s), 0.1);
  add('spine', V3(0, 0, -0.01 * s), 0.112); add('chest', V3(0, 0, -0.015 * s), 0.112); add('chest', V3(0, 0.12 * s, -0.02 * s), 0.1);
  add('head', V3(0, 0.09 * s, 0.015 * s), 0.1);
  for (const sd of ['L', 'R']) {
    add('arm' + sd, mid('arm' + sd, 'fore' + sd), 0.05); add('fore' + sd, V3(), 0.045); add('fore' + sd, mid('fore' + sd, 'hand' + sd), 0.04);
    add('hand' + sd, V3(0, -0.06 * s, 0), 0.03);
    add('thigh' + sd, mid('thigh' + sd, 'shin' + sd), 0.078); add('shin' + sd, V3(0, 0, 0.012 * s), 0.055); add('shin' + sd, mid('shin' + sd, 'foot' + sd), 0.05);
    const aH = bw('foot' + sd).y;
    add('foot' + sd, V3(0, -aH, -0.075 * s), 0.012); add('foot' + sd, V3(0, -aH + 0.012 * s, 0.13 * s), 0.012); add('foot' + sd, V3(0, 0.02 * s, 0.06 * s), 0.05);
    add('toe' + sd, V3(0, -bw('toe' + sd).y, 0.07 * s), 0.012);
  }
  return L;
}
const _p = V3();
function minBodyY(fig, probes) {
  const root = fig.rig.B.root; root.updateMatrixWorld(true);
  let m = Infinity;
  for (const q of probes) { q.b.localToWorld(_p.copy(q.o)); root.worldToLocal(_p); m = Math.min(m, _p.y - q.r); }
  return m;
}
// world point of a root-space point for a figure standing at now {x, y, z, yaw}
function toWorldAt(now, l) { const c = Math.cos(now.yaw), s = Math.sin(now.yaw); return [now.x + l[0] * c + l[2] * s, now.y + l[1], now.z - l[0] * s + l[2] * c]; }
function toLocalAt(now, w) { const dx = w[0] - now.x, dz = w[2] - now.z, c = Math.cos(now.yaw), s = Math.sin(now.yaw); return [dx * c - dz * s, w[1] - now.y, dx * s + dz * c]; }
// numeric pose mix (IK specs: the w side wins after 0.5; mix them with mixHand)
function mix(a, b, w) {
  if (w <= 0) return a; if (w >= 1) return b;
  const out = { ...a };
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[k], vb = b[k];
    if (typeof va === 'number' || typeof vb === 'number') out[k] = (typeof va === 'number' ? va : (DEFV[k] ?? 0)) + ((typeof vb === 'number' ? vb : (DEFV[k] ?? 0)) - (typeof va === 'number' ? va : (DEFV[k] ?? 0))) * w;
    else if (k === 'lHand' || k === 'rHand') out[k] = va && vb ? mixHand(va, vb, w) : (w < 0.5 ? va : vb);
    else out[k] = w < 0.5 ? (va ?? vb) : (vb ?? va);
  }
  return out;
}
const DEFV = { lArmZ: 0.07, rArmZ: -0.07, lElbow: -0.14, rElbow: -0.14, lLegY: 0.06, rLegY: -0.06, lLegZ: 0.015, rLegZ: -0.015 };
const lerp3 = (a, b, w) => [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)];
function mixHand(a, b, w) {
  if (a.space !== b.space || !a.p || !b.p) return w < 0.5 ? a : b;
  return { space: a.space, p: lerp3(a.p, b.p, w), fingers: lerp3(a.fingers || [0, -1, 0], b.fingers || [0, -1, 0], w), palm: lerp3(a.palm || [0, 0, 1], b.palm || [0, 0, 1], w), pole: lerp3(a.pole || [0, -0.4, -1], b.pole || [0, -0.4, -1], w) };
}
// catmull-rom through numeric pose keys at u in [0, 1] (keys: [[u, pose], ...] with increasing u)
function poseSpline(keys, u) {
  u = clamp(u, keys[0][0], keys[keys.length - 1][0]);
  let i = 0; while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
  const [u1, p1] = keys[i], [u2, p2] = keys[i + 1], p0 = (keys[i - 1] || keys[i])[1], p3 = (keys[i + 2] || keys[i + 1])[1];
  const f = (u - u1) / Math.max(1e-6, u2 - u1), f2 = f * f, f3 = f2 * f;
  const out = f < 0.5 ? { ...p1 } : { ...p2 };
  for (const k of new Set([...Object.keys(p1), ...Object.keys(p2)])) {
    const g = (p) => (typeof p[k] === 'number' ? p[k] : typeof p1[k] === 'number' ? p1[k] : typeof p2[k] === 'number' ? p2[k] : null);
    const a = g(p0), b = g(p1), c = g(p2), d = g(p3);
    if (b == null || c == null || typeof (f < 0.5 ? p1[k] ?? p2[k] : p2[k] ?? p1[k]) !== 'number') continue;
    out[k] = 0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
  }
  return out;
}

// ── poses ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// lying on the back: pelvis rotated -90° (face up), feet toward +Z (the item's heading), head toward -Z. The pelvis sits
// at the root origin; the drop is settled so the back of the body rests on the ground.
const LIE = { plant: false, drop: 0.85, lean: -PI / 2, spineX: 0.02, chestX: 0.0, headX: -0.18, headY: 0.12, headZ: 0.04,
  lArmX: 0.1, rArmX: 0.08, lArmZ: 0.3, rArmZ: -0.24, lElbow: -0.3, rElbow: -0.18, lForeY: 0.6, rForeY: -0.4, lWristX: 0.1, rWristX: 0.05,
  lLeg: -0.08, rLeg: 0.0, lKnee: 0.22, rKnee: 0.06, lLegZ: 0.07, rLegZ: -0.05, lLegY: 0.42, rLegY: -0.32, lFoot: 0.55, rFoot: 0.45,
  lShape: 'relaxed', rShape: 'soft', weapon: null, armSwing: [0, 0] };
const STAND = { lArmZ: 0.08, rArmZ: -0.08, lElbow: -0.16, rElbow: -0.16, weapon: null };
const WATCH = { headX: 0.05, headY: 0.08, lArmZ: 0.05, rArmZ: -0.05, lElbow: -0.1, rElbow: -0.1, lShape: 'soft', rShape: 'soft', lLegY: 0.12, rLegY: -0.2, rKnee: 0.06, weapon: null };
const LOOKUP = { headX: -0.62, chestX: -0.14, spineX: -0.05, lean: -0.03, lArmZ: 0.06, rArmZ: -0.06, lElbow: -0.12, rElbow: -0.12, lShape: 'soft', rShape: 'soft', lLegY: 0.14, rLegY: -0.18, weapon: null };
// the right hand flat over the brow, palm down, fingers across the forehead
const SHADE = { rHand: { space: 'head', p: [-0.01, 0.085, 0.175], fingers: [0.9, 0.05, 0.42], palm: [0.05, -0.9, 0.42], pole: [-1, -0.45, 0.2] }, rShape: 'flat', rShrug: 0.1 };
const SHIELD = { lean: -0.08, turn: -0.22, chestY: -0.3, headY: -0.5, headX: 0.28, chestX: 0.06, lShrug: 0.22, rShrug: 0.18, lLegY: 0.25, rLegY: -0.1, rKnee: 0.12, lKnee: 0.05, weapon: null,
  lShape: 'soft', rShape: 'soft',
  lHand: { space: 'head', p: [-0.12, 0.1, 0.19], fingers: [-1, 0.12, 0.05], palm: [0.05, -0.1, -1], pole: [1, -0.15, 0.3] },
  rHand: { space: 'head', p: [-0.2, 0.02, 0.1], fingers: [0.15, 0.95, 0.2], palm: [0.3, 0.0, -1], pole: [-1, -0.8, 0.0] } };

// ── attach: the per-figure handler ──────────────────────────────────────────────────────────────────────────────────
export function attach(o) {
  const { fig, item, ctx, now, root } = o;
  const G = ground(ctx), s = fig.rig.s, B = fig.rig.B, R0 = reg(ctx);
  const list = o.list;                                   // the controller's timeline [{t, action, ...entry}]
  const P0 = { ...(item.params || {}) };
  const probes = bodyProbes(fig);
  const DEFP = o.DEFP || DEFV;
  const seedPh = o.seedPh ?? 0;
  const state = { lying: 0, roll: 0, floor: null, hide: null, glide: false, tilt: false };
  const used = new Set(list.filter((e) => OWN.has(e.action) || (e.action === 'watch' && (e.look_at || P0.look_at || item.look_at))).map((e) => e.action));
  const props = [];                                        // {obj, bone, action(s)}
  const handlers = {};
  // params for action a at t: item keys < item.params < the timeline entry (latest entry of a starting at or before t)
  function paramsOf(a, t) {
    let e = null;
    for (const x of list) if (x.action === a && (x.t0 ?? x.t) <= t + 1e-6) e = x;
    if (!e) e = list.find((x) => x.action === a) || { t: 0 };
    const q = { ...item, ...P0 };
    for (const [k, v] of Object.entries(e)) if (!['t', 'action', 'a', 'fade', 't0'].includes(k)) q[k] = v;
    q.__t0 = e.t0 ?? e.t ?? 0;
    return q;
  }
  const self = {
    owns: (a) => used.has(a) && !!handlers[a],
    evalAction(a, t, k, ph, stride) {
      const h = handlers[a];
      const q = paramsOf(a, t);
      h.eval(t, q, { k, ph, stride });
      for (const pr of props) if (pr.for.includes(a)) { pr.place(t, q); if (pr.bone) carryRel(pr); }
    },
    after(t, st) {
      if (blobM) blobM.visible = fig.group.visible && state.hide !== true;
      if (!used.size) return;
      const cur = st.cur, prev = st.prev, w = st.w;
      for (const pr of props) pr.obj.visible = pr.for.includes(cur) || (prev != null && w < 1 && pr.for.includes(prev));
      // a prop whose action is fading in or out rides the bone that grips it (the hand) and scales in / out (below)
      for (const pr of props) {
        if (!pr.bone || !pr.obj.visible) { if (pr.obj.scale.x !== 1 && pr.obj.visible) pr.obj.scale.setScalar(1); continue; }
        const fin = prev != null && w < 1 && pr.for.includes(cur) && !pr.for.includes(prev);
        const fout = prev != null && w < 1 && pr.for.includes(prev) && !pr.for.includes(cur);
        if (!fin && !fout) continue;
        // it appears as the hands arrive (the last 30 % of the blend) and is put away as they leave (the first 30 %),
        // riding the hand that grips it, so it is never floating and never pops
        const k = fin ? sm((w - 0.7) / 0.3) : 1 - sm(w / 0.3);
        boneRoot(pr.bone, _mB); _mP.copy(_mB).multiply(pr.rel);
        _mP.decompose(pr.obj.position, pr.obj.quaternion, pr.obj.scale); pr.obj.scale.setScalar(Math.max(0.001, k));
        if (pr.obj.userData.load) pr.obj.userData.load.visible = false;
      }
      for (const h of Object.values(handlers)) if (h.after) h.after(t, st);
      // a lying / low body follows the terrain slope (pitch + roll of the whole figure) and a wider, centred shadow
      const lyW = (lyingOf(cur) ? (prev != null && !lyingOf(prev) ? w : 1) : (prev != null && lyingOf(prev) ? 1 - w : 0)) * (state.lyingK ?? 1);
      if (lyW > 0.01) tiltToGround(lyW);
      if (state.floor != null) fig.group.position.y = state.floor;
      // the skier's lean: Euler YXZ keeps rotation.y = the heading (rotateZ re-derived XYZ angles, which flip past +-90 deg
      // of yaw, so the locomotion QA read a skier on a 69 deg heading as 50 deg sideways)
      if (state.roll) { const r = fig.group.rotation; r.set(r.x, r.y, r.z + state.roll, 'YXZ'); }
      if (state.hide != null) fig.group.visible = !state.hide;
      fig.group.updateMatrixWorld(true);
      shadowFit(cur, prev, w, lyW);
    },
    glides: () => state.glide,
    state,
  };
  const blobM = root.children.find((c) => c.isMesh && c.geometry === o.blobGeo);
  // root-space matrix of a bone (the figure group's frame = the rig root's frame)
  const _mB = new THREE.Matrix4(), _mP = new THREE.Matrix4(), _mG = new THREE.Matrix4(), _mR = new THREE.Matrix4();
  const _pa = V3(), _pb = V3(), _sa = V3(), _sb = V3(), _one = V3(1, 1, 1), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
  function boneRoot(b, out) { fig.group.updateMatrixWorld(true); _mG.copy(fig.group.matrixWorld).invert(); return out.copy(_mG).multiply(b.matrixWorld); }
  function carryRel(pr) { pr.obj.updateMatrix(); boneRoot(pr.bone, _mB); pr.rel.copy(_mB).invert().multiply(pr.obj.matrix); }
  const lyingOf = (a) => a === 'lie_back' || (a === 'struck_fall' && state.fallen) || a === 'blanket_crouch';
  function tiltToGround(wt) {
    // the ground plane under the body (±0.8 m along it, ±0.3 m across) -> pitch and roll of the figure group
    const yaw = fig.group.rotation.y, f = [Math.sin(yaw), Math.cos(yaw)], l = [Math.cos(yaw), -Math.sin(yaw)];
    const c = fig.group.position, off = state.bodyMid ?? -0.35 * s;
    const px = c.x + f[0] * off, pz = c.z + f[1] * off;
    const hF = G.h(px + f[0] * 0.8, pz + f[1] * 0.8), hB = G.h(px - f[0] * 0.8, pz - f[1] * 0.8);
    const hL = G.h(px + l[0] * 0.3, pz + l[1] * 0.3), hR = G.h(px - l[0] * 0.3, pz - l[1] * 0.3);
    const pitch = Math.atan2(hF - hB, 1.6), roll = Math.atan2(hL - hR, 0.6), hm = (hF + hB + hL + hR) / 4;
    fig.group.rotation.set(-pitch * wt, yaw, roll * wt, 'YXZ');
    fig.group.position.y = lerp(fig.group.position.y, hm - off * Math.sin(pitch) * 0, wt);
  }
  // the controller's blob is sized for feet; a lying body gets a long one under its middle
  function shadowFit(cur, prev, w, lyW) {
    const bg = o.blobGeo, base = o.blobBase; if (!bg || !base) return;
    if (!(lyW > 0.01) && !state.glide) return;
    const Pp = bg.attributes.position, yaw = fig.group.rotation.y, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const x = fig.group.position.x, z = fig.group.position.z, off = (state.bodyMid ?? -0.35 * s) * lyW;
    const rx = lerp(0.42, 0.5, lyW), rz = lerp(0.36, 1.05, lyW);
    for (let i = 0; i < Pp.count; i++) {
      const u = base[i * 3] * rx, v = base[i * 3 + 2] * rz + off;
      const wx = x + u * cy + v * sy, wz = z - u * sy + v * cy;
      Pp.setXYZ(i, wx, G.h(wx, wz) + 0.02, wz);
    }
    Pp.needsUpdate = true;
  }
  // apply a pose dict (+ DEFP), then settle the lowest body point on floorY (root space) when asked
  function applyPose(p, gait = null, settle = false, floorY = 0) {
    fig._apply({ ...DEFP, ...p }, gait);
    if (settle) {
      const m = minBodyY(fig, probes);
      if (Number.isFinite(m)) { B.pelvis.position.y -= (m - floorY); B.root.updateMatrixWorld(true); }
    }
  }
  const ctxA = { fig, item, ctx, now, root, G, s, B, R0, state, probes, props, applyPose, paramsOf, seedPh, o };
  // each action builds its handler lazily (only the ones this figure uses)
  for (const a of used) {
    const mk = BUILD[a];
    if (mk) handlers[a] = mk(ctxA);
  }
  // registry entry (a rescuer finds its patient here)
  if (item.ref) { const e = R0.byRef[item.ref] || (R0.byRef[item.ref] = { item }); e.fig = fig; e.xa = self; e.now = now; e.ctxA = ctxA; }
  // enter: hidden inside once the door has shut
  if (item._enter && item._enter.hide !== false && item._enter.tClose != null) {
    const tc = item._enter.tClose; used.add('__enter');
    handlers.__enter = { eval() {}, after(t) { state.hide = t > tc + 0.15; } };
  }
  // a gliding skier has no planted foot: the locomotion probe must not read its feet as sliding
  if (used.has('ski')) { const orig = fig.footContacts; fig.footContacts = () => (state.glide ? undefined : orig()); }
  return self;
}

// ── lie_back (+ revive_at) ────────────────────────────────────────────────────────────────────────────────────────
function lieHandler(A) {
  const { fig, s, B, state, applyPose } = A;
  state.bodyMid = -0.3 * s;
  const kids = [B.neck, B.clavL, B.clavR];
  function chestScale(f, back) {
    B.chest.scale.set(1, 1, f);
    if (f !== 1) B.chest.position.z -= back;
    for (const c of kids) { c.scale.set(1, 1, 1 / f); if (f !== 1) c.position.z = (c.userData.rest.z + back) / f; }
    B.root.updateMatrixWorld(true);
  }
  A.state.resetChest = () => chestScale(1, 0);
  return {
    eval(t, q) {
      let p = LIE;
      const rv = q.revive_at != null ? +q.revive_at : null;
      // chest compressions from a rescuer (cpr): the chest dips with the hands
      const dep = state.cprDepth ? state.cprDepth(t) : 0;
      if (rv != null && t > rv) {
        const u = t - rv, br = Math.sin(clamp(u / 1.1) * PI) * sm(u / 0.2);
        p = { ...LIE, chestX: LIE.chestX - 0.05 * br, headY: LIE.headY + 0.22 * smr(u, 0.15, 1.1), headX: LIE.headX + 0.1 * smr(u, 0.1, 0.9) - 0.06 * br,
          lElbow: LIE.lElbow - 0.45 * smr(u, 0.3, 1.2), lForeY: LIE.lForeY - 0.4 * smr(u, 0.3, 1.2), lShape: u > 0.6 ? 'soft' : 'relaxed', rShape: u > 0.4 ? 'grip' : 'soft', lLeg: LIE.lLeg - 0.12 * smr(u, 0.5, 1.4), lKnee: LIE.lKnee + 0.25 * smr(u, 0.5, 1.4) };
      }
      if (state.cprSide) p = state.cprSide < 0 ? { ...p, rArmZ: -0.06, rArmX: 0.05, rElbow: -0.12 } : { ...p, lArmZ: 0.06, lArmX: 0.05, lElbow: -0.15 };
      chestScale(1, 0);
      applyPose(p, null, true, 0);
      // the sternum dips ~5 cm under the hands: the chest compresses front-to-back about its joint and slides back
      // 0.09*k so the back stays on the ground; the neck and clavicles are counter-scaled (head and arms stay put)
      if (dep > 0) { const k = 0.22 * dep; chestScale(1 - k, 0.09 * s * k); }
      state.lying = 1;
    },
  };
}

// ── cpr ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// the rescuer kneels at the patient's side (params.side: right|left, the patient's), faces the patient, and compresses
// the lower sternum with locked arms, shoulders over the hands, hinging at the hips. Beats: params.beats [t, ...] = the
// moments of full depth (the scored sound), or t_start + rate (per min, default 110) + count. Before the first beat the
// rescuer checks the patient (a hand on the shoulder, head to the face), then leans over and places the hands (~1.3 s).
function patientPoints(E) {
  // the patient's sternum, near shoulder and head in world space, from its lying pose (posed once, cached)
  if (E._pts) return E._pts;
  const A = E.ctxA, fig = A.fig, s = A.s, B = A.B;
  A.applyPose(LIE, null, true, 0);
  const r = B.root, W = (b, off) => { const v = B[b].localToWorld(off.clone()); r.worldToLocal(v); return [v.x, v.y, v.z]; };
  const st = W('chest', V3(0, 0.02 * s, 0.14 * s)), hd = W('head', V3(0, 0.09 * s, 0.015 * s));
  const shL = W('armL', V3(0, 0, 0.06 * s)), shR = W('armR', V3(0, 0, 0.06 * s));
  E._pts = { sternum: toWorldAt(E.now, st), head: toWorldAt(E.now, hd), shoulderL: toWorldAt(E.now, shL), shoulderR: toWorldAt(E.now, shR), yaw: E.now.yaw };
  return E._pts;
}
function prepareCPR(item, ctx, res, P, pr, R0) {
  const ref = pr('patient', null);
  let E = ref ? R0.byRef[ref] : null;
  if (!E) E = [...Object.values(R0.byRef)].reverse().find((x) => x.ctxA && ['lie_back', 'struck_fall'].some((a) => entriesOf(x.item).some((e) => (ALIAS[e.action] || e.action) === a)));
  if (!E || !E.ctxA) { (ctx.warnings || []).push(`cpr: patient "${ref}" not found (list it before the rescuer); kneeling at 'at'`); return; }
  const pts = patientPoints(E);
  const side = String(pr('side', 'right')).toLowerCase() === 'left' ? 1 : -1;       // the patient's own left (+X) or right (-X)
  const yaw = pts.yaw, lx = [Math.cos(yaw) * side, -Math.sin(yaw) * side];          // from the patient's midline toward the rescuer
  item._cpr = { E, pts, side, lx };
  // provisional placement; attach() refines the distance so the shoulders are over the hands
  const D = 0.36;
  item.at = [pts.sternum[0] + lx[0] * D, pts.sternum[2] + lx[1] * D];
  item.heading = ((Math.atan2(-lx[0], lx[1]) / DEG) + 360) % 360;
  delete item.face; delete item.path;
}
function kneelPose(lean, thigh = -0.22) {
  // both knees down, shins flat behind, feet pointed; the thighs keep their world angle while the hips hinge (lean)
  const th = thigh - lean;
  return { plant: false, drop: 0.46, lean, lLeg: th, rLeg: th, lLegZ: 0.06, rLegZ: -0.06, lLegY: 0.05, rLegY: -0.05,
    lKnee: PI / 2 + 0.05 - thigh, rKnee: PI / 2 + 0.05 - thigh, lFoot: 1.35, rFoot: 1.35, lToe: 0, rToe: 0, weapon: null, armSwing: [0, 0] };
}
function cprHandler(A) {
  const { fig, item, ctx, s, B, applyPose, now, state } = A;
  const C = item._cpr;
  const arm = V3().subVectors(B.foreL.userData.bind, B.armL.userData.bind).length() + V3().subVectors(B.handL.userData.bind, B.foreL.userData.bind).length();
  // beats
  function beatsOf(q) {
    if (Array.isArray(q.beats) && q.beats.length) return q.beats.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const rate = num(q.rate, 110), dt = 60 / rate, t0 = num(q.t_start, (q.__t0 ?? 0) + 1.6), n = num(q.count, Math.ceil(((ctx.dur ?? 12) - t0) / dt) + 1);
    return Array.from({ length: Math.max(0, n) }, (_, i) => t0 + i * dt);
  }
  let beats = null, dtb = 0.55;
  function depth(t) {
    let c = 0;
    for (const b of beats) {
      const x = t - b;
      if (x < -dtb * 0.45 || x > dtb * 0.52) continue;
      c = Math.max(c, x < 0 ? sm((x + dtb * 0.45) / (dtb * 0.45)) : 1 - sm(x / (dtb * 0.52)));
    }
    return c;
  }
  // the patient reads the depth (its chest dips with the hands)
  if (C && C.E && C.E.ctxA) { C.E.ctxA.state.cprDepth = (t) => (beats ? depth(t) : 0); C.E.ctxA.state.cprSide = C.side; }
  // targets in the rescuer's root space: the sternum, the patient's near shoulder, the head
  const loc = (w) => toLocalAt(now, w);
  const DEPTH = 0.05 * s;                              // the sternum dip (lie_back compresses the chest to match)
  // solve the lean so the shoulders are at the height of straight arms over the sternum (c = 0 and c = 1)
  const solved = {};
  function shoulderAt(p) { applyPose(p, null, true, 0); const a = V3(), b = V3(); B.armL.getWorldPosition(a); B.armR.getWorldPosition(b); B.root.worldToLocal(a); B.root.worldToLocal(b); return a.add(b).multiplyScalar(0.5); }
  function solveLean(targetH) {
    let lo = 0.1, hi = 1.4;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; const sh = shoulderAt(kneelPose(m)); if (sh.y > targetH) lo = m; else hi = m; }
    const L = (lo + hi) / 2; applyPose(kneelPose(L), null, true, 0);
    return { lean: L, drop: 0.97 - B.pelvis.position.y / s, sh: shoulderAt(kneelPose(L)) };
  }
  const dropCache = new Map();
  function solveLeanCached(L) {
    const key = Math.round(L * 1000);
    if (!dropCache.has(key)) { applyPose(kneelPose(L), null, true, 0); dropCache.set(key, { drop: 0.97 - B.pelvis.position.y / s }); }
    return dropCache.get(key);
  }
  function setup() {
    if (solved.ok || !C) return;
    const st = loc(C.pts.sternum);
    const reach = arm + 0.035 * s;
    solved.c0 = solveLean(st[1] + reach * 0.975);
    solved.c1 = solveLean(st[1] - DEPTH + reach * 0.955);
    solved.up = solveLean(st[1] + reach * 0.975 + 0.16 * s);
    // move the rescuer so the shoulders (c = 0) sit over the sternum: shift along the facing by the z error
    const err = st[2] - solved.c0.sh.z - 0.03 * s;       // 3 cm back: the knees clear the patient's arm
    const f = [Math.sin(now.yaw), Math.cos(now.yaw)];
    now.x += f[0] * err; now.z += f[1] * err; now.y = A.G.h(now.x, now.z);
    solved.shift = [f[0] * err, f[1] * err];
    solved.ok = true;
  }
  return {
    eval(t, q) {
      if (!beats) { beats = beatsOf(q); if (beats.length > 1) dtb = clamp((beats[beats.length - 1] - beats[0]) / (beats.length - 1), 0.35, 0.9); }
      setup();
      if (solved.shift) { now.x = item.at[0] + solved.shift[0]; now.z = item.at[1] + solved.shift[1]; }
      const t0 = q.__t0 ?? 0, b0 = beats.length ? beats[0] : t0 + 1.6;
      const place1 = b0 - dtb * 0.45 - 0.08, place0 = Math.max(t0 - 0.01, place1 - 1.2);
      const wPlace = t0 >= place0 - 1e-3 && b0 - t0 < 1.3 ? 1 : smr(t, place0, place1);
      const c = depth(t);
      if (!C) { applyPose({ ...kneelPose(0.5), lShape: 'soft', rShape: 'soft' }, null, true, 0); return; }
      const st = loc(C.pts.sternum), sh = loc(C.side < 0 ? C.pts.shoulderR : C.pts.shoulderL), hd = loc(C.pts.head);
      // the compress posture
      const a = solved.c0, b = solved.c1;
      const lean = lerp(a.lean, b.lean, c), drop = lerp(a.drop, b.drop, c);
      const fwd = [0, 0.34, 0.94];
      const hR = [st[0], st[1] - DEPTH * c, st[2]], hL = [st[0] + 0.004 * s, st[1] - DEPTH * c + 0.028 * s, st[2] + 0.012 * s];
      const gp = (h) => [h[0] + fwd[0] * 0.047 * s, h[1] + fwd[1] * 0.047 * s, h[2] + fwd[2] * 0.047 * s];
      const comp = { ...kneelPose(lean), drop, chestX: 0.04, headX: 0.32 + 0.06 * c, headY: 0.05, lShrug: 0.05, rShrug: 0.05, lShape: 'soft', rShape: 'soft',
        rHand: { space: 'root', p: gp(hR).map((v) => v / s), fingers: fwd, palm: [0, -1, 0.34], pole: [-1, -0.1, -0.4] },
        lHand: { space: 'root', p: gp(hL).map((v) => v / s), fingers: [0.05, 0.3, 0.95], palm: [0, -1, 0.3], pole: [1, -0.1, -0.4] } };
      let p = comp;
      if (wPlace < 1) {
        // check: upright-ish, left hand on the near shoulder, head turned to the face
        const u = solved.up, az = Math.atan2(hd[0], hd[2]);
        const cl = a.lean + 0.04, ck = solveLeanCached(cl);
        const chk = { ...kneelPose(cl), drop: ck.drop, chestX: 0.16, headX: 0.5, headY: clamp(az * 0.75, -0.9, 0.9), chestY: clamp(az * 0.3, -0.45, 0.45), lShape: 'soft', rShape: 'relaxed',
          lHand: { space: 'root', p: [sh[0] / s, (sh[1] + 0.03 * s) / s, sh[2] / s], fingers: [0.2, -0.2, 0.95], palm: [0, -1, 0], pole: [1, -0.3, -0.3] },
          rHand: { space: 'root', p: [-0.16, 0.5, 0.12], fingers: [0.1, -0.3, 0.95], palm: [0.2, -1, 0], pole: [-1, -0.5, -0.3] } };
        // settle drop for the check lean
        p = mix(chk, comp, sm(wPlace));
      }
      applyPose(p, null, false);
      // keep the knees on the ground: settle only the legs' lowest point via the pelvis (hands stay on target)
      state.lastC = c;
    },
    after() {},
  };
}

// ── look_up / watch look_at / shield_face / tap_helmet ────────────────────────────────────────────────────────────
function aimHead(A, target, base) {
  const { now, s } = A;
  const w = target.length >= 3 ? target.map(Number) : [+target[0], A.G.h(+target[0], +target[1]) + 1.5, +target[1]];
  const l = toLocalAt(now, w);
  const eyeY = 1.62 * s, az = Math.atan2(l[0], l[2]), el = Math.atan2(l[1] - eyeY, Math.hypot(l[0], l[2]) || 1);
  const turn = clamp(az * 0.12, -0.25, 0.25), chestY = clamp(az * 0.28, -0.5, 0.5), headY = clamp(az - turn - chestY, -1.0, 1.0);
  const up = clamp(-el, -1.05, 0.7);
  return { ...base, turn: (base.turn ?? 0) + turn, chestY: (base.chestY ?? 0) + chestY, headY, headX: up * 0.78, chestX: (base.chestX ?? 0) + Math.min(0, up) * 0.22, spineX: (base.spineX ?? 0) + Math.min(0, up) * 0.06 };
}
function lookUpHandler(A) {
  const { applyPose, seedPh } = A;
  return {
    eval(t, q) {
      const t0 = num(q.t_start, q.__t0 ?? 0), dur = num(q.ease, 1.6), u = smr(t, t0, t0 + dur);
      let p = mix(WATCH, LOOKUP, u);
      if (q.look_at) p = mix(WATCH, aimHead(A, q.look_at, LOOKUP), u);
      // a slow scan of the sky
      p = { ...p, headY: (p.headY ?? 0) + 0.12 * Math.sin(TAU * (t - t0) / 7.5 + seedPh) * u, headX: (p.headX ?? 0) + 0.03 * Math.sin(TAU * t / 5.3 + seedPh) };
      if (q.shade === true || q.shade === 1) {
        const hu = smr(t, t0 + 0.35, t0 + dur + 0.2);
        if (hu > 0) p = { ...p, rShape: hu > 0.5 ? 'flat' : 'soft', rShrug: 0.12 * hu, rHand: hu >= 1 ? SHADE.rHand : mixHand({ space: 'head', p: [-0.2, -0.62, 0.02], fingers: [0, -1, 0.1], palm: [1, 0, 0], pole: [-1, -0.3, 0.2] }, SHADE.rHand, hu) };
      }
      applyPose(p);
    },
  };
}
function watchAtHandler(A) {
  const { applyPose, seedPh } = A;
  return {
    eval(t, q) {
      const target = q.look_at;
      let p = WATCH;
      if (Array.isArray(target) && target.length >= 2) p = aimHead(A, target, WATCH);
      p = { ...p, chestX: (p.chestX ?? 0) + 0.012 * Math.sin(TAU * t / 4.3 + seedPh), headY: (p.headY ?? 0) + 0.025 * Math.sin(TAU * t / 9.5 + seedPh) };
      applyPose(p);
    },
  };
}
function shieldHandler(A) {
  const { applyPose, seedPh } = A;
  return {
    eval(t, q) {
      const t0 = num(q.t_start, q.__t0 ?? 0), u = smr(t, t0, t0 + 0.45);
      const flinch = Math.exp(-4 * Math.max(0, t - t0 - 0.3)) * sm((t - t0) / 0.3);
      let p = mix(STAND, SHIELD, u);
      if (q.from) { const a = aimHead(A, q.from, {}); const side = (a.headY ?? 0) >= 0 ? -1 : 1; p = { ...p, turn: side * 0.22, chestY: side * 0.3, headY: side * 0.5 }; }
      p = { ...p, lean: (p.lean ?? 0) - 0.05 * flinch, headX: (p.headX ?? 0) + 0.05 * Math.sin(TAU * t * 0.7 + seedPh) * u };
      applyPose(p);
    },
  };
}
function tapHelmetHandler(A) {
  const { applyPose } = A;
  return {
    eval(t, q) {
      const t0 = q.__t0 ?? 0, taps = Array.isArray(q.taps) && q.taps.length ? q.taps.map(Number) : [t0 + 0.6, t0 + 0.95];
      const first = taps[0], last = taps[taps.length - 1];
      const up = smr(t, first - 0.55, first - 0.12) * (1 - smr(t, last + 0.35, last + 0.9));
      let lift = 0;
      for (const b of taps) { const x = t - b; if (x > -0.16 && x < 0.2) lift = Math.max(lift, x < 0 ? 1 - sm((x + 0.16) / 0.16) : sm(x / 0.2)); }
      if (t < first - 0.16) lift = 1;
      const top = { space: 'head', p: [-0.02, 0.23 + 0.05 * lift, 0.03], fingers: [0.35, 0.25, 0.9], palm: [0, -1, 0.1], pole: [-1, -0.2, 0.1] };
      const rest = { space: 'head', p: [-0.2, -0.62, 0.02], fingers: [0, -1, 0.1], palm: [1, 0, 0], pole: [-1, -0.3, 0.2] };
      // base: the held pose under the tap (sit_ground, kneel, sit, watch, ... with cast.js's idle life); default standing
      const bn = q.base ? (ALIAS[String(q.base).toLowerCase()] || String(q.base).toLowerCase()) : null;
      const base = bn && A.o.poseFor ? A.o.poseFor(bn, t) : STAND;
      const pB = { ...base, headX: (base.headX ?? 0) + 0.12 * up };
      const pT = { ...pB, rHand: top, rShape: 'flat', rShrug: (base.rShrug ?? 0) + 0.1 };
      if (up <= 0.001) { applyPose(pB); return; }
      if (up >= 0.999) { applyPose(pT); return; }
      // between the base and the tap: blend the right arm's bones (any base: hand on the knee, on the ground, hanging)
      applyPose(pB);
      const chain = [A.B.clavR, A.B.armR, A.B.foreR, A.B.handR], q0 = chain.map((b) => b.quaternion.clone());
      applyPose({ ...pT, rShape: up > 0.4 ? 'flat' : (base.rShape ?? 'relaxed') });
      const w = sm(up);
      chain.forEach((b, i) => b.quaternion.copy(q0[i].slerp(b.quaternion, w)));
      A.B.root.updateMatrixWorld(true);
    },
  };
}

// ── struck_fall ────────────────────────────────────────────────────────────────────────────────────────────────────
// t_hit (default: the action's start in the timeline, else 0.5): jolt 0-0.32 s (stiff, up on the toes, arms flung,
// head back, a tremor), collapse 0.32-1.25 s (knees buckle, hips back and down, the body falls on its back), a small
// bounce, then lying still. params.fall: 'back' (default) | 'forward' (face down). params.before: stand|watch|look_up.
const JOLT = { drop: -0.03, chestX: -0.2, spineX: -0.08, headX: -0.42, lArmZ: 0.62, rArmZ: -0.62, lArmX: -0.4, rArmX: -0.35, lElbow: -0.28, rElbow: -0.25,
  lShape: 'flat', rShape: 'flat', lShrug: 0.26, rShrug: 0.26, lFoot: 0.32, rFoot: 0.3, lToe: -0.5, rToe: -0.5, weapon: null };
function fallKeys(fwd) {
  const f = fwd ? -1 : 1;           // forward fall mirrors the lean
  return [
    [0, { ...JOLT, plant: false, lean: 0, fwd: 0 }],
    [0.3, { plant: false, drop: 0.28, fwd: -0.16 * f, lean: -0.38 * f, lLeg: -0.62, rLeg: -0.5, lKnee: 1.25, rKnee: 1.05, lFoot: -0.3, rFoot: -0.25, chestX: 0.08, headX: 0.3, spineX: 0.04,
      lArmZ: 0.55, rArmZ: -0.5, lArmX: -0.45, rArmX: -0.35, lElbow: -0.45, rElbow: -0.4, lShape: 'soft', rShape: 'soft', weapon: null }],
    [0.64, { plant: false, drop: 0.7, fwd: -0.36 * f, lean: -1.05 * f, lLeg: -0.75, rLeg: -0.62, lKnee: 1.2, rKnee: 0.95, lFoot: 0.15, rFoot: 0.1, chestX: 0.06, headX: 0.22, spineX: 0.03,
      lArmZ: 0.95, rArmZ: -0.85, lArmX: -0.6, rArmX: -0.45, lElbow: -0.4, rElbow: -0.3, lShape: 'soft', rShape: 'relaxed', weapon: null }],
    [1, { ...LIE, fwd: -0.55 * f, lean: -PI / 2 * f }],
  ];
}
function struckHandler(A) {
  const { applyPose, s, B, state, seedPh } = A;
  return {
    eval(t, q) {
      const t0 = q.__t0 ?? 0;
      const tHit = num(q.t_hit, t0 > 0 ? t0 : 0.5), fwd = String(q.fall || 'back') === 'forward';
      const before = q.before === 'look_up' ? LOOKUP : q.before === 'watch' ? WATCH : STAND;
      const x = t - tHit;
      state.bodyMid = -0.55 * s - 0.3 * s;
      if (x < 0) { state.fallen = false; applyPose(before, null, true, 0); return; }
      const JD = num(q.jolt, 0.3), FD = num(q.fall_dur, 0.85);
      let p;
      if (x < JD) {
        const u = sm(x / 0.08);
        p = mix(before, { ...JOLT, plant: false }, u);
        // a stiff tremor
        const tr = Math.sin(TAU * 19 * x + seedPh) * 0.05 * (1 - x / JD);
        p = { ...p, lArmZ: p.lArmZ + tr, rArmZ: p.rArmZ - tr, headX: p.headX + tr * 0.6, chestX: p.chestX + tr * 0.3 };
        state.fallen = false;
      } else {
        const u = clamp((x - JD) / FD), g = u < 1 ? Math.pow(u, 1.35) : 1;
        p = poseSpline(fallKeys(fwd), g);
        const y = x - JD - FD;                               // after the landing: a small bounce, then still
        if (y > 0) { const b = Math.exp(-7 * y) * Math.sin(TAU * 2.6 * y); p = { ...p, headX: p.headX - 0.12 * b, lArmZ: p.lArmZ + 0.08 * b, rArmZ: p.rArmZ - 0.08 * b, chestX: (p.chestX ?? 0) - 0.03 * b }; }
        state.fallen = u > 0.92;
        state.lyingK = smr(u, 0.75, 1);
      }
      applyPose(p, null, true, 0);
    },
  };
}

// ── props: simple, clean, low-poly shapes in the mannequin style ─────────────────────────────────────────────────
const MATS = {};
function mat(key) {
  if (MATS[key]) return MATS[key];
  const P = {
    blade: { color: 0xD2691E, roughness: 0.45, metalness: 0.15 }, alu: { color: 0xB9BEC4, roughness: 0.32, metalness: 0.75 },
    grip: { color: 0x2A2C30, roughness: 0.65 }, beacon: { color: 0xE3B21F, roughness: 0.4 }, screen: { color: 0x10181C, roughness: 0.15, metalness: 0.3 },
    led: { color: 0xFF4A2A, emissive: 0xFF3A1A, emissiveIntensity: 3.0, roughness: 0.3 }, snow: { color: 0xF2F5FA, roughness: 0.92 },
    pit: { color: 0x8C9BB0, roughness: 0.95 }, ski: { color: 0x243044, roughness: 0.35, metalness: 0.1 }, skitop: { color: 0xE8E4DA, roughness: 0.4 },
    binding: { color: 0x3A3D42, roughness: 0.5, metalness: 0.4 }, pole: { color: 0x3E444C, roughness: 0.38, metalness: 0.6 },
    wood: { color: 0x5B3A24, roughness: 0.7 }, frame: { color: 0xE4DED2, roughness: 0.75 }, dark: { color: 0x0B0B0C, roughness: 1.0 }, brass: { color: 0xB08A40, roughness: 0.35, metalness: 0.9 },
  }[key] || { color: 0x888888 };
  MATS[key] = plain(P);
  return MATS[key];
}
function mesh(g, m, name) { const o = new THREE.Mesh(g, typeof m === 'string' ? mat(m) : m); o.castShadow = true; o.receiveShadow = true; if (name) o.name = name; return o; }
// shovel: origin at the T-grip, the shaft down -Y, the blade (concave toward +Z) at the end; 0.88 m long
function buildShovel() {
  const G = new THREE.Group(); G.name = 'prop:shovel';
  G.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.13, 10).rotateZ(PI / 2), 'grip'));
  G.add(mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.6, 10).translate(0, -0.305, 0), 'alu'));
  G.add(mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.07, 10).translate(0, -0.6, 0.004), 'blade'));
  const bg = new THREE.BoxGeometry(0.235, 0.28, 0.007, 8, 4, 1), P = bg.attributes.position;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i); P.setZ(i, P.getZ(i) + 0.032 * (2 * x / 0.235) ** 2 + 0.01 * (y / 0.14)); }
  bg.computeVertexNormals(); bg.translate(0, -0.76, 0.012);
  G.add(mesh(bg, 'blade'));
  const load = mesh(new THREE.IcosahedronGeometry(0.1, 1).scale(1.05, 1.15, 0.55).translate(0, -0.75, 0.05), 'snow', 'load'); G.add(load);
  G.userData = { len: 0.88, load };
  return G;
}
// avalanche probe: origin at the top, 2.4 m down -Y; the upper 0.3 m is the dark grip section
function buildProbe() {
  const G = new THREE.Group(); G.name = 'prop:probe';
  G.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.32, 8).translate(0, -0.16, 0), 'grip'));
  G.add(mesh(new THREE.CylinderGeometry(0.0075, 0.0068, 2.1, 6).translate(0, -1.35, 0), 'alu'));
  for (let k = 0; k < 6; k++) G.add(mesh(new THREE.CylinderGeometry(0.0082, 0.0082, 0.018, 6).translate(0, -0.55 - k * 0.3, 0), 'blade'));
  G.userData = { len: 2.4 };
  return G;
}
// transceiver: origin at the palm grip, screen up (+Y), antenna end toward +Z
function buildBeacon() {
  const G = new THREE.Group(); G.name = 'prop:beacon';
  G.add(mesh(R.rbox(0.078, 0.03, 0.13, 0.012).translate(0, 0.012, 0.01), 'beacon'));
  G.add(mesh(R.rbox(0.056, 0.004, 0.05, 0.004).translate(0, 0.028, 0.03), 'screen'));
  const led = mesh(new THREE.SphereGeometry(0.006, 8, 6).translate(0.022, 0.028, 0.068), 'led', 'led'); G.add(led);
  G.userData = { led };
  return G;
}
// one ski (origin at the binding centre on the sole, +Z = tip), 1.7 m, tip turned up; and a pole (origin at the grip, down -Y)
function buildSki() {
  const G = new THREE.Group(); G.name = 'prop:ski';
  const L = 1.7, n = 24, rows = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, z = -L * 0.46 + u * L, w = 0.045 - 0.008 * Math.sin(u * PI), tipUp = u > 0.86 ? 0.07 * ((u - 0.86) / 0.14) ** 2 : u < 0.05 ? 0.02 * ((0.05 - u) / 0.05) ** 2 : 0;
    rows.push([[-w, tipUp - 0.045, z], [w, tipUp - 0.045, z], [w, tipUp - 0.028, z], [-w, tipUp - 0.028, z]]);
  }
  const pos = [], idx = [];
  rows.forEach((r) => r.forEach((v) => pos.push(...v)));
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) { const a = i * 4 + j, b = i * 4 + (j + 1) % 4, c = a + 4, d = b + 4; idx.push(a, c, b, b, c, d); }
  idx.push(0, 1, 2, 0, 2, 3); const e = n * 4; idx.push(e, e + 2, e + 1, e, e + 3, e + 2);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  G.add(mesh(g, 'ski'));
  G.add(mesh(R.rbox(0.07, 0.03, 0.3, 0.008).translate(0, -0.015, 0.0), 'binding'));
  return G;
}
function buildPole() {
  const G = new THREE.Group(); G.name = 'prop:pole';
  G.add(mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.16, 8).translate(0, -0.03, 0), 'grip'));
  G.add(mesh(new THREE.CylinderGeometry(0.0085, 0.006, 1.12, 6).translate(0, -0.64, 0), 'pole'));
  G.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 10).translate(0, -1.1, 0), 'grip'));
  return G;
}
// a frame from an origin, a +Y axis (unit) and a hint for +Z -> Matrix4 (unit scale)
const _m4 = new THREE.Matrix4();
function frameM(o, y, zHint) {
  const Y = V3(...y).normalize(); let Z = V3(...zHint); Z.sub(Y.clone().multiplyScalar(Z.dot(Y)));
  if (Z.lengthSq() < 1e-8) Z = Math.abs(Y.z) < 0.9 ? V3(0, 0, 1) : V3(1, 0, 0);
  Z.normalize(); const X = Y.clone().cross(Z).normalize();
  return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(o[0], o[1], o[2]);
}
function setObjM(obj, M) { M.decompose(obj.position, obj.quaternion, obj.scale); obj.updateMatrix(); }
// a prop whose root-space transform is given each frame; parented to fig.group (root space = the figure's frame)
function rootProp(A, obj, forActs, bone = null, carry = null) {
  A.fig.group.add(obj);
  const pr = { obj, for: forActs, M: new THREE.Matrix4(), place() {}, bone: bone ? A.B[bone] : null, rel: new THREE.Matrix4(), carry };
  A.props.push(pr);
  return pr;
}
// hand grip specs for a shaft through `c` (root space, metres) with the shaft axis `ax`, the palm toward `palm`
function shaftGrip(s, c, fingers, palm, pole) { return { space: 'root', p: [c[0] / s, c[1] / s, c[2] / s], fingers, palm, pole }; }
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function rotAbout(v, ax, ang) { const c = Math.cos(ang), s = Math.sin(ang), k = nrm3(ax), d = dot3(k, v), x = cross3(k, v); return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)]; }
// keyframes [phase, {...}] (cyclic) -> smooth values at phase u (catmull-rom on numbers and arrays)
function cyc(keys, u) {
  u = ((u % 1) + 1) % 1;
  let i = keys.length - 1; while (i > 0 && keys[i][0] > u) i--;
  const n = keys.length, k1 = keys[i], k2 = keys[(i + 1) % n], k0 = keys[(i - 1 + n) % n], k3 = keys[(i + 2) % n];
  const u1 = k1[0], u2 = k2[0] + (i + 1 >= n ? 1 : 0), f = (u - u1) / Math.max(1e-6, u2 - u1), f2 = f * f, f3 = f2 * f;
  const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
  const out = {};
  for (const key of Object.keys(k1[1])) {
    const a = k0[1][key], b = k1[1][key], c = k2[1][key], d = k3[1][key];
    out[key] = Array.isArray(b) ? b.map((_, j) => cr(a[j], b[j], c[j], d[j])) : cr(a, b, c, d);
  }
  return out;
}

// ── dig ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// kneeling, shovelling into the snow ahead and throwing it to the right. Each stroke: ready -> plunge (the blade bites:
// the scrape, on t_start + k * period) -> lever -> lift -> throw -> back. params: t_start (a bite lands exactly there;
// default the action's start + 0.3), period (1.25 s), hole (true: a dug pit + spoil pile at the dig spot).
const DIG = [
  [0.0, { tip: [-0.04, 0.34, 0.98], grip: [-0.15, 0.74, 0.2], roll: 0, lean: 0.62, turn: 0.0, chestY: 0.0 }],
  [0.2, { tip: [-0.07, -0.1, 0.86], grip: [-0.13, 0.56, 0.33], roll: 0, lean: 0.9, turn: 0.02, chestY: 0.02 }],
  [0.38, { tip: [-0.07, -0.04, 0.74], grip: [-0.17, 0.42, 0.14], roll: 0, lean: 0.82, turn: 0.0, chestY: 0.0 }],
  [0.56, { tip: [-0.1, 0.42, 0.9], grip: [-0.2, 0.6, 0.06], roll: 0.1, lean: 0.62, turn: -0.08, chestY: -0.1 }],
  [0.74, { tip: [-0.72, 0.5, 0.52], grip: [-0.3, 0.64, 0.06], roll: 1.1, lean: 0.55, turn: -0.3, chestY: -0.36 }],
  [0.86, { tip: [-0.42, 0.44, 0.84], grip: [-0.22, 0.7, 0.14], roll: 0.4, lean: 0.56, turn: -0.12, chestY: -0.15 }],
];
function snowChunks(A, n) {
  const g = new THREE.DodecahedronGeometry(0.045, 0);
  const im = new THREE.InstancedMesh(g, mat('snow'), n); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.name = 'snow_chunks';
  A.root.add(im);
  return im;
}
function digHandler(A) {
  const { fig, s, B, applyPose, now, G, root, ctx } = A;
  const shovel = buildShovel();
  const carry = new THREE.Matrix4().makeTranslation(0.018 * s, -0.075 * s, 0.012 * s).multiply(new THREE.Matrix4().makeRotationX(0.25));
  const pr = rootProp(A, shovel, ['dig'], 'handR', carry);
  const NCH = 16, chunks = snowChunks(A, NCH), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sv = V3(), Pv = V3();
  let pit = null;
  const rnd = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  function shovelAt(u) {
    const k = cyc(DIG, u);
    const tip = k.tip.map((v) => v * s), grip = k.grip.map((v) => v * s);
    const Y = nrm3(sub3(grip, tip));
    let Z = rotAbout([0, 1, 0], Y, -k.roll);
    const L = 0.88 * s, g0 = add3(tip, Y, L);          // the T-grip sits 0.88 m up the shaft from the tip
    return { k, tip, Y, Z, grip: g0 };
  }
  let lastT = -1, lastQ = null;
  return {
    eval(t, q, gait) {
      const T = num(q.period, 1.25), t0 = num(q.t_start, (q.__t0 ?? 0) + 0.3);
      const u = (t - t0) / T + 0.2;                       // phase 0.2 = the bite, at t_start + k * T
      const sh = shovelAt(u);
      const body = { ...kneelPose(sh.k.lean), turn: sh.k.turn, chestY: sh.k.chestY, chestX: 0.1, headX: 0.35, headY: -0.05, lShape: 'grip', rShape: 'grip', weapon: null };
      if (!this.drops) this.drops = new Map();
      const key = Math.round(sh.k.lean * 200);
      if (!this.drops.has(key)) { applyPose(kneelPose(sh.k.lean), null, true, 0); this.drops.set(key, 0.97 - B.pelvis.position.y / s); }
      body.drop = this.drops.get(key);
      // the hands: right on the T-grip (palm on top), left on the shaft 0.4 m down (palm toward the shaft, from below)
      const gl = add3(sh.grip, sh.Y, -0.4 * s);
      const X = cross3(sh.Y, sh.Z);
      const pose = { ...body,
        rHand: shaftGrip(s, add3(sh.grip, sh.Y, 0.012 * s), sh.Z, sh.Y.map((v) => -v), [-1, -0.4, -0.3]),
        lHand: shaftGrip(s, add3(gl, sh.Z, -0.012 * s), X.map((v) => -v), sh.Z, [1, -0.5, -0.4]) };
      applyPose(pose, null, false);
      // the shovel in root space
      setObjM(shovel, frameM(sh.grip, sh.Y, sh.Z));
      const ph = ((u % 1) + 1) % 1;
      shovel.userData.load.visible = ph > 0.3 && ph < 0.76;
      shovel.userData.load.scale.setScalar(ph > 0.3 && ph < 0.76 ? sm((ph - 0.3) / 0.12) : 0.001);
      lastT = t; lastQ = { u, T, t0 };
    },
    after(t, st) {
      const active = st.cur === 'dig' && (st.prev == null || st.w >= 1 || st.prev === 'dig');
      chunks.visible = active && !!lastQ;
      if (!lastQ) return;
      // the pit and the spoil pile (once, where the blade bites)
      if (pit === null && (A.paramsOf('dig', t).hole ?? true) !== false) pit = buildPit(A, shovelAt(0.2).tip) || false;
      // snow thrown on every stroke: chunks leave the blade at phase 0.74 and fall on the pile
      const { T, t0 } = lastQ, uN = (t - t0) / T + 0.2;
      let n = 0;
      for (const c of [Math.floor(uN - 0.74), Math.floor(uN - 0.74) - 1]) {
        const tc = t0 + (c + 0.74 - 0.2) * T, tau = t - tc, tIn = (A.paramsOf('dig', t).__t0 ?? -1e9) + 0.9;
        if (tau < 0 || tau > 1.3 || tc < tIn) { for (let j = 0; j < 8; j++) { M.makeScale(0, 0, 0); chunks.setMatrixAt(n++, M); } continue; }
        const sh = shovelAt(c + 0.74), bl = add3(sh.tip, sh.Y, 0.12 * s);
        const w0 = toWorldAt(now, bl), side = toWorldAt(now, [-1.0 * s, 0.9, 0.35 * s]);
        const dir = [side[0] - now.x, 0, side[2] - now.z];
        for (let j = 0; j < 8; j++) {
          const r1 = rnd(c, j), r2 = rnd(c + 7, j), r3 = rnd(c + 13, j);
          const vx = dir[0] * (1.6 + r1 * 1.2) + (r2 - 0.5) * 0.8, vz = dir[2] * (1.6 + r1 * 1.2) + (r3 - 0.5) * 0.8, vy = 1.4 + r2 * 1.2;
          let x = w0[0] + vx * tau, z = w0[2] + vz * tau, y = w0[1] + vy * tau - 4.9 * tau * tau;
          const gy = G.h(x, z);
          let sc = (0.55 + r3 * 0.8);
          if (y < gy + 0.02) { y = gy + 0.02; sc *= Math.max(0, 1 - (tau - 0.35) / 0.9); }
          Sv.setScalar(Math.max(0.001, sc)); Q.setFromEuler(new THREE.Euler(tau * 6 + j, tau * 4 + r1 * 6, 0)); Pv.set(x, y, z);
          M.compose(Pv, Q, Sv); chunks.setMatrixAt(n++, M);
        }
      }
      chunks.instanceMatrix.needsUpdate = true;
    },
  };
}
// a dug pit: a shadowed hollow in the snow (two soft blue-grey tones), a low lumpy rim and a spoil mound to the
// digger's right (static, world). Two diggers at the same hole share one pit (params.hole: false = none).
function buildPit(A, tipLocal) {
  const { now, G, s, root, R0 } = A;
  const c = toWorldAt(now, [tipLocal[0], 0, tipLocal[2] + 0.1 * s]);
  R0.pits = R0.pits || [];
  if (R0.pits.some((p) => Math.hypot(p[0] - c[0], p[1] - c[2]) < 1.3)) return null;
  R0.pits.push([c[0], c[2]]);
  const grp = new THREE.Group(); grp.name = 'dig_pit'; root.add(grp);
  const rnd = (i) => { const x = Math.sin(i * 91.7 + 3.1) * 43758.5453; return x - Math.floor(x); };
  const yaw = now.yaw, fw = [Math.sin(yaw), Math.cos(yaw)], lf = [Math.cos(yaw), -Math.sin(yaw)];
  const disc = (rx, rz, lift, m, ord) => {
    const n = 22, geo = new THREE.CircleGeometry(1, n, 0, TAU); geo.rotateX(-PI / 2);
    const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const u = P.getX(i), v = P.getZ(i), a = Math.atan2(v, u), wob = 1 + 0.12 * Math.sin(a * 3 + 1.3) + 0.07 * Math.sin(a * 5 + 0.4);
      const x = c[0] + (u * rx * wob * lf[0] + v * rz * wob * fw[0]) * s, z = c[2] + (u * rx * wob * lf[1] + v * rz * wob * fw[1]) * s;
      P.setXYZ(i, x, G.h(x, z) + lift, z);
    }
    geo.computeVertexNormals();
    const o = new THREE.Mesh(geo, plain({ color: m, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); o.receiveShadow = true; o.renderOrder = ord; grp.add(o);
  };
  disc(0.5, 0.42, 0.012, 0xC3CDD8, 1); disc(0.34, 0.27, 0.016, 0x9EABBB, 2);
  // broken snow: angular chunks (jittered low-poly icosahedra, flat-shaded, three shapes, slightly varied tones) around
  // the rim, a rough faceted spoil heap to the digger's right with chunks piled on it. Seeded, deterministic.
  const chunkGeo = (seed) => {
    const g = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(), P = g.attributes.position, jit = new Map();
    for (let i = 0; i < P.count; i++) {
      const key = `${P.getX(i).toFixed(3)},${P.getY(i).toFixed(3)},${P.getZ(i).toFixed(3)}`;
      if (!jit.has(key)) jit.set(key, 0.62 + rnd(seed * 31 + jit.size) * 0.6);
      const k = jit.get(key); P.setXYZ(i, P.getX(i) * k, P.getY(i) * k * 0.8, P.getZ(i) * k);
    }
    g.computeVertexNormals(); return g;
  };
  const snowFlat = [0xF3F6FA, 0xE4EAF2, 0xD6DEE9].map((c) => plain({ color: c, roughness: 0.9, flatShading: true }));
  const L = [];                                   // [u, v, size, tone, shape, sink]
  for (let i = 0; i < 26; i++) { const an = (i / 26) * TAU + rnd(i) * 0.25, r = 1.02 + rnd(i + 40) * 0.2; L.push([Math.cos(an) * r * 0.5, Math.sin(an) * r * 0.42, 0.035 + rnd(i + 9) * 0.05, i % 3, i % 3, 0.35]); }
  for (let i = 0; i < 16; i++) { const an = rnd(i + 70) * TAU, r = Math.sqrt(rnd(i + 90)) * 0.3; L.push([-1.0 + Math.cos(an) * r, 0.2 + Math.sin(an) * r * 0.8, 0.05 + rnd(i + 3) * 0.07, (i + 1) % 3, (i + 2) % 3, -1.4 + r * 3]); }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
  for (let shape = 0; shape < 3; shape++) {
    const mine = L.filter((x) => x[4] === shape);
    for (let tone = 0; tone < 3; tone++) {
      const lst = mine.filter((x) => x[3] === tone); if (!lst.length) continue;
      const im = new THREE.InstancedMesh(chunkGeo(shape + 1), snowFlat[tone], lst.length); im.castShadow = true; im.receiveShadow = true;
      lst.forEach(([u, v, h, , , sink], i) => {
        const x = c[0] + (u * lf[0] + v * fw[0]) * s, z = c[2] + (u * lf[1] + v * fw[1]) * s, k = i * 7 + shape * 13 + tone;
        Q.setFromEuler(new THREE.Euler((rnd(k + 5) - 0.5) * 1.2, rnd(k + 6) * TAU, (rnd(k + 8) - 0.5) * 1.2));
        const sc = V3(h * (1 + rnd(k + 1) * 0.5), h * (0.7 + rnd(k + 2) * 0.5), h * (1 + rnd(k + 3) * 0.5));
        M.compose(V3(x, G.h(x, z) + h * (sink > 0 ? -sink * 0.5 : 0.35 - sink * 0.05), z), Q, sc); im.setMatrixAt(i, M);
      });
      grp.add(im);
    }
  }
  // the heap under the spoil chunks: a faceted, noisy low mound
  const hg = new THREE.IcosahedronGeometry(1, 1).toNonIndexed(), HP = hg.attributes.position, hj = new Map();
  for (let i = 0; i < HP.count; i++) {
    const key = `${HP.getX(i).toFixed(3)},${HP.getY(i).toFixed(3)},${HP.getZ(i).toFixed(3)}`;
    if (!hj.has(key)) hj.set(key, 0.82 + rnd(500 + hj.size) * 0.3);
    const k = hj.get(key); HP.setXYZ(i, HP.getX(i) * k, HP.getY(i) * k, HP.getZ(i) * k);
  }
  hg.computeVertexNormals();
  const heap = new THREE.Mesh(hg, snowFlat[1]); heap.castShadow = true; heap.receiveShadow = true;
  const hx = c[0] + (-1.0 * lf[0] + 0.2 * fw[0]) * s, hz = c[2] + (-1.0 * lf[1] + 0.2 * fw[1]) * s;
  heap.position.set(hx, G.h(hx, hz) - 0.06 * s, hz); heap.scale.set(0.36 * s, 0.17 * s, 0.3 * s); heap.rotation.y = yaw + 0.4;
  grp.add(heap);
  return grp;
}

// ── probe ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// standing, bent, both hands on a 2.4 m probe held upright ahead, pushing it into the snow and pulling it up. A push
// bottoms out on t_hit + k * period (the thunk); after the last push (params.stay: true) it is left standing there.
function probeHandler(A) {
  const { fig, s, B, applyPose, now, G } = A;
  const probe = buildProbe();
  A.root.add(probe);                                    // world space: it can stay planted when the action ends
  const pr = { obj: probe, for: ['probe'], place() {} };
  let lastW = null, hitW = null, letGo = null;
  return {
    eval(t, q) {
      const T = num(q.period, 1.7), tHit = num(q.t_hit, (q.__t0 ?? 0) + 1.0);
      const u = (((t - tHit) / T + 0.5) % 1 + 1) % 1;   // 0.5 = the bottom of a push
      // the top of the probe: up at 1.62 m, pushed down to 1.12 m (fast), a short hold, pulled up (slow)
      const push = u < 0.3 ? 0 : u < 0.5 ? sm((u - 0.3) / 0.2) : u < 0.62 ? 1 : 1 - sm((u - 0.62) / 0.38);
      const topY = (1.62 - 0.5 * push) * s, px = -0.03 * s, pz = (0.4 + 0.03 * push) * s;
      const lean = 0.2 + 0.28 * push, knee = 0.12 + 0.3 * push;
      const body = { lean, chestX: 0.06, headX: 0.42, lLeg: -knee * 0.9, rLeg: -knee * 0.7, lKnee: knee * 1.6, rKnee: knee * 1.3, lFoot: 0, rFoot: 0, lLegY: 0.18, rLegY: -0.2, weapon: null,
        lShape: 'grip', rShape: 'grip',
        rHand: shaftGrip(s, [px, topY - 0.1 * s, pz], [0.15, 0, 1], [1, 0, 0], [-1, -0.5, -0.3]),
        lHand: shaftGrip(s, [px, topY - 0.42 * s, pz], [-0.15, 0, 1], [-1, 0, 0], [1, -0.5, -0.3]) };
      applyPose(body);
      // the probe in world space (vertical)
      const w = toWorldAt(now, [px, topY, pz]);
      lastW = w;
      if (u > 0.5 && u < 0.62) hitW = w;
      // where the probe is when the next action starts: it is left standing there
      const nx = A.o.list.find((e) => (e.t0 ?? e.t) > (q.__t0 ?? 0) + 1e-6);
      if (nx && !letGo) { const ts = nx.t0 ?? nx.t, us = (((ts - tHit) / T + 0.5) % 1 + 1) % 1, ps = us < 0.3 ? 0 : us < 0.5 ? sm((us - 0.3) / 0.2) : us < 0.62 ? 1 : 1 - sm((us - 0.62) / 0.38);
        letGo = toWorldAt(now, [px, (1.62 - 0.5 * ps) * s, (0.4 + 0.03 * ps) * s]); hitW = letGo; }
      probe.position.set(w[0], w[1], w[2]); probe.rotation.set(0, now.yaw, 0);
    },
    after(t, st) {
      if (st.cur === 'probe') { probe.visible = true; return; }
      if (st.prev === 'probe' && st.w < 1 && letGo) { probe.visible = true; probe.position.set(letGo[0], letGo[1], letGo[2]); probe.rotation.set(0, now.yaw, 0); return; }
      // after probing: the probe stays where it struck (tip deep, 1.1 m standing out of the snow); computed from the
      // figure's place, so it is there even when the probing happened before the shot (negative times)
      const q = A.paramsOf('probe', t), tHit = num(q.t_hit, (q.__t0 ?? 0) + 1.0);
      if ((q.stay ?? true) && t > tHit) {
        const w = letGo || hitW || toWorldAt(now, [-0.03 * s, 1.12 * s, 0.43 * s]);
        probe.visible = true;
        if (letGo) { probe.position.set(w[0], w[1], w[2]); probe.rotation.set(0, now.yaw, 0); }
        else { probe.position.set(w[0], G.h(w[0], w[2]) + 1.1 * s, w[2]); probe.rotation.set(0.06, now.yaw, 0.04); }
      } else probe.visible = false;
    },
  };
}

// ── beacon ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// the transceiver held out ahead at chest height, screen up, sweeping slowly left-right; head bent to the screen.
// 'beacon' walks along `path` (0.75 m/s or speed); without a path it stands (beacon_stand). params.beeps [t..] blink
// the red LED (the scored beeps).
function beaconHandler(A) {
  const { fig, s, applyPose } = A;
  const dev = buildBeacon();
  rootProp(A, dev, ['beacon', 'beacon_stand'], 'handR');
  return {
    eval(t, q, gait) {
      const sw = Math.sin(TAU * t / 2.2 + 0.7) * 0.35;
      const hx = Math.sin(sw) * 0.36 * s - 0.06 * s, hz = Math.cos(sw) * 0.4 * s + 0.02 * s, hy = 1.1 * s;
      const pose = { ...WATCH, lean: 0.12, chestX: 0.1, headX: 0.5, headY: sw * 0.6, chestY: sw * 0.35, lShape: 'soft', rShape: 'grip', lArmZ: 0.12, lElbow: -0.35, armSwing: [0.6, 0],
        rHand: { space: 'root', p: [hx / s, hy / s, hz / s], fingers: [Math.sin(sw) * 0.8, -0.25, Math.cos(sw)], palm: [0, 1, 0], pole: [-1, -0.8, -0.2] } };
      const moving = gait && gait.k > 0.02 && A.fig && q.__moving !== false;
      if (moving && A.o.path) {
        const g = fig.gait, saved = fig.stride;
        fig.stride = gait.stride ?? fig.stride;
        fig._apply({ ...A.o.DEFP, ...pose }, { ph: gait.ph, k: clamp(gait.k, 0, 1) });
        fig.stride = saved;
      } else applyPose(pose);
      // the device in the palm (root space), screen up, antenna ahead
      const c = V3(); A.fig.anchors.rightHand.getWorldPosition(c); A.B.root.worldToLocal(c);
      setObjM(dev, frameM([c.x, c.y + 0.012 * s, c.z], [0, 1, 0], [Math.sin(sw), 0, Math.cos(sw)]));
      const beeps = Array.isArray(q.beeps) ? q.beeps : null;
      dev.userData.led.visible = beeps ? beeps.some((b) => t >= b && t < b + 0.09) : (t % 1.0) < 0.09;
    },
  };
}

// ── ski ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// on skis, poles in the hands, gliding along `path` at `speed` (default 9 m/s) on whatever ctx.ground is (the avalanche
// slope counts once fx.avalanche is built). Flexed stance, the body leans into the path's curvature (v^2 k / g, capped
// 26 deg) with the inside knee bent more, the skis follow the slope under each foot. No gait: the feet glide.
function skiHandler(A) {
  const { fig, s, B, applyPose, now, G, state, o } = A;
  const skis = [buildSki(), buildSki()], poles = [buildPole(), buildPole()];
  rootProp(A, skis[0], ['ski'], 'footL'); rootProp(A, skis[1], ['ski'], 'footR'); rootProp(A, poles[0], ['ski'], 'handL'); rootProp(A, poles[1], ['ski'], 'handR');
  const legs = { L: restOf(B.thighL.userData.bind, B.shinL.userData.bind, B.footL.userData.bind, V3(0, 0, -1)), R: restOf(B.thighR.userData.bind, B.shinR.userData.bind, B.footR.userData.bind, V3(0, 0, -1)) };
  const aH = B.footL.userData.bind.y;
  const qTmp = new THREE.Quaternion(), qR = new THREE.Quaternion(), mTmp = new THREE.Matrix4(), mInv = new THREE.Matrix4();
  function leanAt(t) {
    const path = o.path; if (!path || !o.sAt) return 0;
    const sNow = o.sAt(t), v = o.vAt ? o.vAt(t) : 0, W = 3;
    const d0 = path.dir(Math.max(0, sNow - W)), d1 = path.dir(Math.min(path.length, sNow + W));
    const y0 = Math.atan2(d0[0], d0[1]), y1 = Math.atan2(d1[0], d1[1]);
    let dy = y1 - y0; while (dy > PI) dy -= TAU; while (dy < -PI) dy += TAU;
    const k = dy / (2 * W);                              // yaw rate per metre (+ = turning left)
    return clamp(-Math.atan(v * v * k / 9.81) * 0.85, -0.45, 0.45);
  }
  return {
    eval(t, q) {
      state.glide = true;
      const roll = leanAt(t); state.roll = roll;
      const body = { plant: false, drop: 0.17, fwd: -0.05, lean: 0.36, spineX: 0.04, chestX: 0.06, headX: -0.3, lArmZ: 0.2, rArmZ: -0.2, lShape: 'grip', rShape: 'grip', weapon: null, armSwing: [0, 0],
        chestZ: -roll * 0.35, headZ: -roll * 0.5,
        rHand: { space: 'root', p: [-0.3, 0.84, 0.36], fingers: [0.3, -0.62, 0.72], palm: [1, 0, 0.1], pole: [-1, -0.7, -0.3] },
        lHand: { space: 'root', p: [0.3, 0.84, 0.36], fingers: [-0.3, -0.62, 0.72], palm: [-1, 0, 0.1], pole: [1, -0.7, -0.3] } };
      applyPose(body);
      // legs: IK the ankles onto the snow under each foot (rolled body frame), skis pitched to the slope
      const yaw = now.yaw, lf = [Math.cos(yaw), -Math.sin(yaw)], fw = [Math.sin(yaw), Math.cos(yaw)];
      const g0 = G.h(now.x, now.z), cR = Math.cos(roll), sR = Math.sin(roll);
      B.root.updateMatrixWorld(true);
      const rq = B.root.getWorldQuaternion(new THREE.Quaternion());
      for (const [sd, side] of [['L', 1], ['R', -1]]) {
        const x = side * 0.11 * s, z = 0.03 * s;
        const wx = now.x + lf[0] * x + fw[0] * z, wz = now.z + lf[1] * x + fw[1] * z;
        const dg = G.h(wx, wz) - g0;
        const y = (dg - x * sR) / cR + 0.045 * s + aH;
        const hF = G.h(wx + fw[0] * 0.6, wz + fw[1] * 0.6), hB = G.h(wx - fw[0] * 0.6, wz - fw[1] * 0.6);
        const pitch = clamp(Math.atan2(hB - hF, 1.2), -0.7, 0.7);
        const T = B.root.localToWorld(V3(x, y, z));
        const pole = V3(side * 0.1, 0, 1).applyQuaternion(rq);
        R.twoBone(B['thigh' + sd], B['shin' + sd], legs[sd].L1, legs[sd].L2, T, pole, legs[sd]);
        R.setWorldRot(B['foot' + sd], rq.clone().multiply(qTmp.setFromAxisAngle(V3(1, 0, 0), pitch)).multiply(qR.setFromAxisAngle(V3(0, 0, 1), -roll)));
        B['toe' + sd].rotation.x = 0;
      }
      B.root.updateMatrixWorld(true);
      // skis under the soles, poles through the fists (down, back and out)
      mInv.copy(B.root.matrixWorld).invert();
      [['L', 0], ['R', 1]].forEach(([sd, i]) => {
        mTmp.copy(B['foot' + sd].matrixWorld).multiply(new THREE.Matrix4().makeTranslation(0, -aH, 0.05 * s));
        setObjM(skis[i], mInv.clone().multiply(mTmp));
      });
      [['leftHand', 1, 0], ['rightHand', -1, 1]].forEach(([an, side, i]) => {
        const c = V3(); A.fig.anchors[an].getWorldPosition(c); B.root.worldToLocal(c);
        setObjM(poles[i], frameM([c.x, c.y + 0.035 * s, c.z], [-side * 0.22, 0.72, 0.66], [0, 0.66, -0.72]));
      });
    },
    after(t, st) {
      const on = st.cur === 'ski' || (st.prev === 'ski' && st.w < 1);
      state.glide = on; if (!on) state.roll = 0;
    },
  };
}

// ── enter: through a door (prepare builds the path and the timing; the gait is cast.js's walk / run) ─────────────────
// params: door [x, z] (the threshold centre), door_heading (compass deg the door faces OUT), t_close (the slam: the
// figure crosses the threshold at t_close - 0.55 and is inside when the leaf shuts), gait run|walk, speed, hide (true:
// the figure is hidden once the door has shut), approach (m straight out of the door, 1.8).
function prepareEnter(item, ctx, P, pr, R0) {
  const door = pr('door', null);
  if (!Array.isArray(door) || door.length < 2) { (ctx.warnings || []).push('enter: params.door [x, z] missing; the figure just walks'); replaceAct(item, 'enter', 'walk'); return; }
  const d = xz(door), hdg = num(pr('door_heading', null), null);
  const at = xz(item.at);
  const out = hdg != null ? [Math.sin(hdg * DEG), -Math.cos(hdg * DEG)] : (() => { const v = [at[0] - d[0], at[1] - d[1]], l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; })();
  const appr = num(pr('approach', 1.8), 1.8);
  const A1 = [d[0] + out[0] * appr, d[1] + out[1] * appr];
  const L1 = Math.hypot(A1[0] - at[0], A1[1] - at[1]) + appr;
  const tClose = num(pr('t_close', null), null), tThrough = num(pr('t_through', tClose != null ? tClose - 0.55 : null), null);
  let gait = String(pr('gait', '') || '').toLowerCase();
  let v = num(pr('speed', null), null);
  let start = null;
  if (tThrough != null) {
    if (v == null) v = gait === 'walk' ? 1.4 : gait === 'run' ? 3.4 : clamp(L1 / Math.max(0.5, tThrough - 0.6), 1.3, 5.5);
    start = tThrough - 0.4 - L1 / v;
    if (start < 0) { v = clamp(L1 / Math.max(0.3, tThrough - 0.4), 0.8, 6.5); start = 0; }
  }
  if (!gait) gait = (v ?? 3.4) > 2.2 ? 'run' : 'walk';
  replaceAct(item, 'enter', gait);
  // the path runs on inside past the braking distance, so the figure crosses the threshold at full speed (hidden later)
  const inside = num(pr('inside', null), Math.max(3.2, 0.9 * (v ?? 3.4) + 1.2));
  const IN = [d[0] - out[0] * inside, d[1] - out[1] * inside];
  item.path = [A1, d, IN];
  if (v != null) item.speed = v;
  if (start != null && start > 0.01) item.start = start;
  item._enter = { door: d, out, tThrough, tClose, hide: pr('hide', true) };
  if (hdg == null && item.heading == null) item.heading = ((Math.atan2(A1[0] - at[0], -(A1[1] - at[1])) / DEG) + 360) % 360;
}
function replaceAct(item, from, to) {
  const ren = (a) => ((ALIAS[String(a).toLowerCase()] || String(a).toLowerCase()) === from ? to : a);
  if (Array.isArray(item.actions) && item.actions.length) item.actions = item.actions.map((e) => (Array.isArray(e) ? [e[0], ren(e[1])] : { ...e, action: ren(e.action) }));
  else item.action = ren(item.action || from);
}

// ── blanket_crouch ──────────────────────────────────────────────────────────────────────────────────────────────────
// curled low on both knees, head down, the hands holding the blanket's edges under the chin, a grey wool blanket draped
// over head, back and shoulders down to the floor (a heightfield over the posed body, rebuilt every frame so it
// breathes). params: floor_y (m above the ground: a car's footwell floor), mode 'kneel' (default) | 'sit' (sitting on
// the floor, knees up, hugging them), shiver (0..1).
const CURL = { plant: false, drop: 0.64, lean: 0.9, spineX: 0.34, chestX: 0.3, headX: 0.5, lLeg: -1.85, rLeg: -1.85, lLegY: 0.12, rLegY: -0.12, lLegZ: 0.1, rLegZ: -0.1,
  lKnee: 2.42, rKnee: 2.42, lFoot: 1.1, rFoot: 1.1, lToe: 0.2, rToe: 0.2, weapon: null, lShape: 'grip', rShape: 'grip', lShrug: 0.2, rShrug: 0.2,
  lHand: { space: 'head', p: [0.05, -0.08, 0.14], fingers: [-0.2, 0.9, 0.3], palm: [0.2, 0.1, -1], pole: [1, -0.6, 0.2] },
  rHand: { space: 'head', p: [-0.05, -0.09, 0.13], fingers: [0.2, 0.9, 0.3], palm: [-0.2, 0.1, -1], pole: [-1, -0.6, 0.2] } };
const HUG = { plant: false, drop: 0.8, lean: -0.05, spineX: 0.35, chestX: 0.3, headX: 0.55, lLeg: -2.05, rLeg: -2.0, lKnee: 2.3, rKnee: 2.25, lLegZ: 0.08, rLegZ: -0.08, lFoot: 0.35, rFoot: 0.3, weapon: null,
  lShape: 'grip', rShape: 'grip', lShrug: 0.2, rShrug: 0.2,
  lHand: { space: 'head', p: [0.05, -0.1, 0.14], fingers: [-0.2, 0.9, 0.3], palm: [0.2, 0.1, -1], pole: [1, -0.6, 0.2] },
  rHand: { space: 'head', p: [-0.05, -0.11, 0.13], fingers: [0.2, 0.9, 0.3], palm: [-0.2, 0.1, -1], pole: [-1, -0.6, 0.2] } };
let BLANKET_TEX = null;
function blanketTex() {
  if (BLANKET_TEX) return BLANKET_TEX;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#76716A'; g.fillRect(0, 0, 256, 256);
  const id = g.getImageData(0, 0, 256, 256);
  let r = 12345; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4, st = (y > 212 && y < 224) || (y > 232 && y < 238);
    const k = (st ? 0.6 : 1) * (0.9 + 0.1 * rnd()) * (1 + 0.035 * Math.sin(x * 0.9 + y * 0.3) * Math.sin(y * 1.7));
    id.data[i] *= k; id.data[i + 1] *= k; id.data[i + 2] *= k;
  }
  g.putImageData(id, 0, 0);
  BLANKET_TEX = new THREE.CanvasTexture(c); BLANKET_TEX.colorSpace = THREE.SRGBColorSpace; BLANKET_TEX.anisotropy = 4;
  BLANKET_TEX.wrapS = THREE.RepeatWrapping; BLANKET_TEX.repeat.set(3, 1);
  return BLANKET_TEX;
}
// the blanket: a smooth hull over the posed body (star-shaped from the body's centre: the far hit of each ray on the
// inflated body spheres), smoothed like cloth, with vertical folds and a hem spread on the floor
function blanketHandler(A) {
  const { fig, s, B, applyPose, probes, state, G } = A;
  const NU = 32, NV = 12, TH = 1.72;                    // longitude segments, rings from the top to ~98 deg, + the hem ring
  const nv = (NU + 1) * (NV + 2), pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = [];
  for (let j = 0; j <= NV + 1; j++) for (let i = 0; i <= NU; i++) { const k = j * (NU + 1) + i; uv[k * 2] = i / NU; uv[k * 2 + 1] = 1 - j / (NV + 1); }
  for (let j = 0; j <= NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
  const m = plain({ color: 0xffffff, map: blanketTex(), roughness: 0.97, side: THREE.DoubleSide });
  const blanket = new THREE.Mesh(geo, m); blanket.castShadow = true; blanket.receiveShadow = true; blanket.name = 'prop:blanket'; blanket.frustumCulled = false;
  rootProp(A, blanket, ['blanket_crouch'], 'chest');
  const R = new Float32Array((NU + 1) * (NV + 1)), R2 = new Float32Array(R.length), sph = [];
  // the torso is wider than the spine spheres: shoulder blades and hips; the scarf stays under the blanket (hidden)
  const extra = [['chest', 0.15, 0.1, -0.03, 0.09], ['chest', -0.15, 0.1, -0.03, 0.09], ['chest', 0.1, -0.05, -0.05, 0.1], ['chest', -0.1, -0.05, -0.05, 0.1], ['pelvis', 0.13, 0, -0.03, 0.1], ['pelvis', -0.13, 0, -0.03, 0.1]]
    .map(([b, x, y, z, r]) => ({ b: B[b], o: V3(x * s, y * s, z * s), r: r * s }));
  const hideMe = []; fig.group.traverse((c) => { if (c.isMesh && (c.name === 'scarf' || c.name === 'fringe')) hideMe.push(c); });
  return {
    eval(t, q) {
      const sit = String(q.mode || '') === 'sit';
      const sv = num(q.shiver, 0.35), br = Math.sin(TAU * t / 3.6 + A.seedPh);
      const base = sit ? HUG : CURL;
      const p = { ...base, chestX: base.chestX + 0.03 * br, lShrug: base.lShrug + 0.03 * Math.sin(TAU * 7 * t) * sv, headX: base.headX + 0.02 * br };
      applyPose(p, null, true, 0);
      state.bodyMid = sit ? 0.05 * s : 0.12 * s;
      B.root.updateMatrixWorld(true);
      sph.length = 0; let cx = 0, cy = 0, cz = 0, wsum = 0;
      for (const pr of [...probes, ...extra]) { const v = pr.b.localToWorld(pr.o.clone()); B.root.worldToLocal(v); const r = pr.r + 0.06 * s; sph.push([v.x, v.y, v.z, r]); const w = r * r; cx += v.x * w; cy += v.y * w; cz += v.z * w; wsum += w; }
      cx /= wsum; cz /= wsum; cy = Math.max(0.22 * s, cy / wsum);
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
        const th = (j / NV) * TH, ph = (i / NU) * TAU, d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        let best = 0.12 * s;
        for (const [sx, sy, sz, r] of sph) {
          const ox = sx - cx, oy = sy - cy, oz = sz - cz, tt = ox * d[0] + oy * d[1] + oz * d[2], h2 = r * r - (ox * ox + oy * oy + oz * oz - tt * tt);
          if (h2 > 0) best = Math.max(best, tt + Math.sqrt(h2));
        }
        R[j * (NU + 1) + i] = best;
      }
      // cloth: smooth the radii (cyclic in longitude), 3 passes, never inside the body (bridges hollows, keeps peaks)
      const R0b = Float32Array.from(R);
      for (let pass = 0; pass < 3; pass++) {
        for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
          const k = j * (NU + 1) + i, il = (i + NU - 1) % NU, ir = (i + 1) % NU, jm = Math.max(0, j - 1), jp = Math.min(NV, j + 1);
          R2[k] = 0.4 * R[k] + 0.15 * (R[j * (NU + 1) + il] + R[j * (NU + 1) + ir]) + 0.15 * (R[jm * (NU + 1) + i] + R[jp * (NU + 1) + i]);
        }
        for (let i = 0; i < R.length; i++) R[i] = Math.max(R0b[i], R2[i]);
        for (let j = 0; j <= NV; j++) R[j * (NU + 1) + NU] = R[j * (NU + 1)];
      }
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
        const th = (j / NV) * TH, ph = (i / NU) * TAU, k = j * (NU + 1) + i;
        const fold = 1 + 0.045 * Math.sin(ph * 7 + 1.1) * (j / NV) ** 2 + 0.02 * Math.sin(ph * 13) * (j / NV) ** 3;
        const r = R[k] * fold;
        let x = cx + Math.sin(th) * Math.cos(ph) * r, y = cy + Math.cos(th) * r, z = cz + Math.sin(th) * Math.sin(ph) * r;
        if (y < 0.012 * s) y = 0.012 * s;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      }
      // the hem: the last ring dropped to the floor and spread 5 cm
      for (let i = 0; i <= NU; i++) {
        const k0 = NV * (NU + 1) + i, k = (NV + 1) * (NU + 1) + i, dx = pos[k0 * 3] - cx, dz = pos[k0 * 3 + 2] - cz, l = Math.hypot(dx, dz) || 1;
        pos[k * 3] = pos[k0 * 3] + dx / l * 0.05 * s; pos[k * 3 + 1] = 0.01 * s; pos[k * 3 + 2] = pos[k0 * 3 + 2] + dz / l * 0.05 * s;
      }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
      blanket.position.set(0, 0, 0); blanket.quaternion.identity(); blanket.scale.set(1, 1, 1);
      state.floorY = num(q.floor_y, null);
    },
    after(t, st) {
      const on = st.cur === 'blanket_crouch' || (st.prev === 'blanket_crouch' && st.w < 1);
      for (const c of hideMe) c.visible = !on;
      if (on && state.floorY != null) { const g = fig.group.position; state.floor = G.h(g.x, g.z) + state.floorY; }
      else if (!on) state.floor = null;
    },
  };
}

const BUILD = {
  lie_back: lieHandler, cpr: cprHandler, look_up: lookUpHandler, watch: watchAtHandler, shield_face: shieldHandler, tap_helmet: tapHelmetHandler, struck_fall: struckHandler,
  dig: digHandler, probe: probeHandler, beacon: beaconHandler, beacon_stand: beaconHandler, ski: skiHandler, blanket_crouch: blanketHandler,
};


// ── objects (prop.*) ────────────────────────────────────────────────────────────────────────────────────────────────
export const CATALOG = {};
export async function build(kind, item, ctx) { throw new Error('actions.js: unknown kind ' + kind); }
