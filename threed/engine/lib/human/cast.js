// cast.js — characters: the recurring cast of a video (CastDef -> the identical mannequin in every scene) and single
// figures, with eased actions, planted walk cycles along paths, ground snapping and a terrain-following contact shadow.
//
//   buildCharacter(castDef, ctx)  -> { fig, extras, kit }    (unplaced figure; same def -> identical figure)
//   build('cast', item, ctx)       item = { ref, at, heading, action | actions: [{t, action}], path, speed, face, seat }
//   build('figure.person', item)   item = { kit, colors, headwear, accessories, build, signature, ...same as cast }
//   build('figure.witness', item)  the brand character (white mannequin, mustard scarf)
// Actions: stand idle watch attention walk run march salute point sit sit_ground kneel wave speak cheer aim ride.
// Every change of action cross-fades the whole skeleton over ~1 s (slerp of every bone); speed ramps are integrated so
// the soles never slide; the figure is always standing on ctx.ground.
import * as THREE from 'three';
import * as R from './rig.js';
import { dress, KITS, resolveKit } from './kits.js';
import { buildHorse } from './horse.js';
import { ground, xz, yawFromHeading, yawToward, patchAll, polyPath, DEG, blobMaterial } from './common.js';
import { smoother, clamp, lerp, rng } from '../shared/util.js';
import * as X from './actions.js';   // Q10: lie_back cpr look_up struck_fall dig probe beacon ski blanket_crouch enter shield_face tap_helmet

const TAU = Math.PI * 2;
export const ACTIONS = ['stand', 'idle', 'watch', 'attention', 'walk', 'run', 'sprint', 'march', 'salute', 'point', 'sit', 'sit_ground', 'kneel', 'take_cover', 'wave', 'speak', 'cheer', 'aim', 'ride'];
const SPEED = { walk: 1.35, march: 1.5, run: 3.4, sprint: 7.5, ride: 1.6 };
const MOVING = new Set(['walk', 'run', 'sprint', 'march', 'ride']);
// gait shapes on the rig (G): the run lands on the heel with a short flight; the sprint runs on the balls of the feet
// with a short stance (27 %), a long flight, high knees, the body lowest at mid-stance and highest in the flight
const GAITS = {
  run: { duty: 0.4, lift: 0.2, flatEnd: 0.24 },
  march: { lift: 0.13 },
  sprint: { duty: 0.27, lift: 0.46, heelEnd: 0, flatEnd: 0, hsPitch: 0.3, toPitch: 1.0, ball: true, bobPh: 0.385, bobA: 0.035, bobOff: 0.05 },
};
const P = R.POSES;
const DEFP = { lArmZ: 0.07, rArmZ: -0.07, lElbow: -0.14, rElbow: -0.14, lLegY: 0.06, rLegY: -0.06, lLegZ: 0.015, rLegZ: -0.015 };
const ALIAS = { idle: 'stand', talk: 'speak', gesture: 'speak', look: 'watch', observe: 'watch', stroll: 'walk', jog: 'run', charge: 'run', dash: 'sprint', flee: 'sprint', sitting: 'sit', seated: 'sit', crouch: 'kneel', greet: 'wave', present: 'speak', stand_guard: 'attention', guard: 'attention', aim_rifle: 'aim', shoot: 'aim', rest: 'sit_ground', horse: 'ride', riding: 'ride',
  cover: 'take_cover', duck: 'take_cover', duck_and_cover: 'take_cover', drop_cover: 'take_cover', drop_cover_hold: 'take_cover', shelter: 'take_cover' };
X.register({ ACTIONS, ALIAS, SPEED, MOVING });   // Q10: the actions.js names, aliases, speeds (ski, beacon move)

export const POSE = {
  stand: P.stand,
  watch: P.watch,
  attention: P.attention,
  // salute (fix: the hand lay on top of the head, fingers up): upper arm out to the side, forearm up at ~35°, hand straight
  // in line with it, palm down-forward, only the fingertips at the right brow
  salute: { ...P.salute, rShrug: 0.06, rHand: { space: 'head', p: [-0.15, 0.05, 0.1], fingers: [0.835, 0.55, 0.03], palm: [-0.2, -0.9, 0.35], pole: [-1, -0.2, 0.1] } },
  point: { ...P.point, rArmX: -1.42, rArmY: 0.05, headY: -0.05, chestY: -0.06 },
  walk: P.walk,
  march: { ...P.walk, lean: 0.0, headX: -0.03, chestX: -0.03, lElbow: -0.1, rElbow: -0.1, armSwing: [1.9, 1.9], lShape: 'fist', rShape: 'fist' },
  run: { lean: 0.2, headX: -0.14, chestX: 0.05, lElbow: -1.5, rElbow: -1.5, lArmZ: 0.14, rArmZ: -0.14, lForeY: 0.3, rForeY: -0.3, armSwing: [2.1, 2.1], lShape: 'fist', rShape: 'fist', weapon: 'port' },
  // sprint (running for your life): leaning ~20° into it, head a little down, fists pumped hard from the chin to behind the
  // hip by the gait phase (rig armDrive), elbows ~90-110°; the gait (GAITS.sprint) drives the knees high
  sprint: { lean: 0.34, spineX: 0.05, chestX: 0.05, headX: -0.33, lArmX: -0.12, rArmX: -0.12, lArmZ: 0.13, rArmZ: -0.13, lElbow: -1.62, rElbow: -1.62, lForeY: 0.45, rForeY: -0.45,
    lShape: 'fist', rShape: 'fist', armDrive: { a: 0.82, e: 0.34 }, weapon: 'port' },
  sit: { ...P.seated },
  // sitting on the ground (fix: the old angles put both feet ~0.3 m under the floor): hips 0.12 m up, the right leg out
  // with the heel down, the left knee up with the foot flat, leaning back on the right hand, the left forearm on the knee
  sit_ground: { plant: false, drop: 0.805, lean: -0.25, spineX: 0.1, chestX: 0.12, headX: 0.05, weapon: null,
    rLeg: -1.41, rKnee: 0.28, rFoot: 0.35, rLegY: -0.14, rLegZ: -0.08, lLeg: -1.93, lKnee: 1.3, lFoot: 0.88, lLegY: 0.1, lLegZ: 0.06,
    lShape: 'soft', rShape: 'flat',
    rHand: { space: 'root', p: [-0.3, 0.06, -0.24], fingers: [-0.3, 0, -1], palm: [0, -1, 0], pole: [-0.6, 0.3, 1] },
    lHand: { space: 'root', p: [0.13, 0.41, 0.43], fingers: [0.1, -0.6, 0.8], palm: [-0.3, -0.9, 0.1], pole: [0.8, -0.5, -0.5] } },
  kneel: { ...P.crouch, lean: 0.18, chestX: 0.05, headX: -0.08, lArmX: -0.55, lElbow: -1.05, lArmZ: 0.1, rArmX: -0.25, rElbow: -0.7, rArmZ: -0.1, lShape: 'soft', rShape: 'soft', weapon: 'port' },
  wave: { rArmZ: -2.5, rArmX: -0.3, rElbow: -0.45, rShape: 'flat', rWristX: -0.1, headY: -0.04, chestZ: 0.04, rFree: true, lArmZ: 0.08, weapon: 'sling' },
  cheer: { lArmZ: 2.55, rArmZ: -2.55, lArmX: -0.25, rArmX: -0.25, lElbow: -0.35, rElbow: -0.35, lShape: 'fist', rShape: 'fist', headX: -0.2, chestX: -0.06, rFree: true, weapon: 'sling' },
  aim: P.rifle_ready,
  ride: { plant: false, lean: 0.06, lLeg: -1.05, rLeg: -1.05, lLegZ: 0.42, rLegZ: -0.42, lLegY: 0.25, rLegY: -0.25, lKnee: 1.25, rKnee: 1.25, lFoot: 0.25, rFoot: 0.25, weapon: 'sling', armSwing: [0, 0],
    lArmX: -0.55, rArmX: -0.55, lElbow: -1.0, rElbow: -1.0, lArmZ: 0.05, rArmZ: -0.05, lShape: 'grip', rShape: 'grip', rFree: true },
  // drop, cover, hold on: on both knees, curled over the thighs, head down, the left forearm over the back of the neck,
  // the right hand gripping something low ahead (item.hold_at: a desk leg); ~0.6 m tall, fits under a 0.74 m desk
  take_cover: { plant: false, drop: 0.66, lean: 0.95, spineX: 0.38, chestX: 0.32, headX: 0.42, turn: 0, lLeg: -1.9, rLeg: -1.9, lLegY: 0.1, rLegY: -0.1, lLegZ: 0.09, rLegZ: -0.09,
    lKnee: 2.45, rKnee: 2.45, lFoot: 1.15, rFoot: 1.15, lToe: 0.2, rToe: 0.2, weapon: null, lShape: 'soft', rShape: 'grip', lShrug: 0.12, rShrug: 0.06,
    lHand: { space: 'head', p: [-0.02, 0.02, -0.105], fingers: [-1, -0.15, 0.1], palm: [0, 0.2, 1], pole: [1, -0.3, 0.6] },
    rHand: { space: 'root', p: [-0.2, 0.16, 0.62], fingers: [0.15, 0.05, 1], palm: [0.3, -0.9, 0.2], pole: [-1, -0.6, 0] } },
};
const SPEAK = [
  { lArmX: -0.25, rArmX: -0.35, lElbow: -1.2, rElbow: -1.35, lArmZ: 0.12, rArmZ: -0.14, lForeY: 0.6, rForeY: -0.7, headX: -0.03, chestY: 0.05, headY: 0.02 },
  { lArmX: -0.05, rArmX: -0.8, lElbow: -0.25, rElbow: -0.85, lArmZ: 0.08, rArmZ: -0.2, rForeY: -0.95, headX: 0.05, headY: -0.1, chestY: -0.08 },
  { lArmX: -0.42, rArmX: -0.42, lElbow: -1.05, rElbow: -1.05, lArmZ: 0.34, rArmZ: -0.34, lForeY: 0.95, rForeY: -0.95, headX: 0.0, headY: 0.09, chestX: -0.03 },
  { lArmX: -0.1, rArmX: -0.3, lElbow: -0.35, rElbow: -1.45, lArmZ: 0.1, rArmZ: -0.12, rForeY: -0.4, headX: -0.06, headY: -0.04, chestY: 0.03 },
];
function mixPose(a, b, w) {
  const out = { ...a };
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[k] ?? DEFP[k] ?? 0, vb = b[k] ?? DEFP[k] ?? 0;
    if (typeof va === 'number' && typeof vb === 'number') out[k] = va + (vb - va) * w;
    else out[k] = w < 0.5 ? (a[k] ?? b[k]) : (b[k] ?? a[k]);
  }
  return out;
}
const withBreath = (p, t, ph) => ({ ...p, chestX: (p.chestX ?? 0) + 0.012 * Math.sin(TAU * t / 4.3 + ph), headY: (p.headY ?? 0) + 0.05 * Math.sin(TAU * t / 9.5 + ph * 2), headX: (p.headX ?? 0) + 0.015 * Math.sin(TAU * t / 6.1 + ph), side: (p.side ?? 0) + 0.008 * Math.sin(TAU * t / 7.7 + ph) });

// ── idle life (QUALITY.md "Life"; the audit's frozen statues): a figure that holds a pose still breathes, shifts its
// weight between its feet (the feet stay planted: rig plantFeet), looks around in slow eased glances and now and then
// adjusts a hand. Deterministic in t, per figure (seed) - or, for the crowd's baked loops, periodic in u = 0..1.
// IDLE[action] = [breath, weight shift, looking around, hand adjust] (0 = off; a pose holding a hand by IK keeps it)
export const IDLE = {
  stand: [1, 1, 1, 1], watch: [1, 1, 1, 0.6], point: [1, 0.25, 0.35, 0], attention: [0.7, 0, 0.12, 0], salute: [0.7, 0, 0, 0],
  kneel: [1, 0, 1, 1], sit: [1, 0.6, 1, 1], sit_ground: [1, 0.6, 1, 1], take_cover: [1.4, 0, 0.2, 0], aim: [0.8, 0.3, 0.15, 0],
  speak: [0.6, 0.6, 0, 0], wave: [0.6, 0.4, 0, 0], cheer: [0.5, 0.3, 0, 0], ride: [0.8, 0, 0.7, 0],
};
const hash1 = (n) => { const x = Math.sin(n * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x); };
// free-running clock for one figure: breath phase, weight shift -1..1, look (-1..1 yaw, -1..1 pitch), hand 0..1
export function idleClock(t, seed) {
  const r = (n) => hash1(seed * 0.618 + n * 7.31);
  const Tb = 3.8 + 1.0 * r(1), Ts = 7.5 + 3.5 * r(2);
  const shift = Math.sin(TAU * t / Ts + r(3) * TAU) * (0.75 + 0.25 * Math.sin(TAU * t / (Ts * 2.7) + r(4) * TAU));
  // glances: every 4.5-7.5 s the head eases (0.9 s) to a new direction and holds it
  const G = 4.5 + 3 * r(5), u = t / G + r(6), gi = Math.floor(u), gs = (u - gi) * G;
  const dirY = (n) => (hash1(seed * 1.37 + n * 3.17) - 0.5) * 2, dirX = (n) => (hash1(seed * 2.11 + n * 5.03) - 0.5) * 2;
  const e = smoother(gs / 0.9);
  const look = lerp(dirY(gi - 1), dirY(gi), e) + 0.06 * Math.sin(TAU * t / 3.3 + r(7) * 6), lookX = lerp(dirX(gi - 1), dirX(gi), e);
  // a hand adjust: once in every 8-12 s window, ~2 s long, at a random moment, a random hand
  const H = 8 + 4 * r(8), v = t / H + r(9), hi = Math.floor(v), hs = (v - hi) * H, h0 = 1 + hash1(seed * 3.3 + hi * 1.9) * (H - 3.6);
  const hu = hs - h0, hand = hu < 0 || hu > 2.2 ? 0 : smoother(hu / 0.6) * (1 - smoother((hu - 1.3) / 0.9));
  return { breath: TAU * t / Tb + r(10) * TAU, shift, look, lookX, hand, hside: hash1(seed * 4.7 + hi * 2.3) < 0.5 ? 1 : -1 };
}
// periodic clock for a baked loop (crowds): u = 0..1 over the loop, nb breaths per loop, variant v varies the rest
export function idleLoopClock(u, v, nb = 2) {
  const r = (n) => hash1(v * 1.618 + n * 9.7);
  const look = 0.7 * Math.sin(TAU * u + r(1) * TAU) + 0.3 * Math.sin(2 * TAU * u + r(2) * TAU);
  const bump = Math.pow(Math.max(0, Math.sin(TAU * u + r(3) * TAU)), 6);            // one short hand adjust per loop
  return { breath: TAU * nb * u + r(4) * TAU, shift: Math.sin(TAU * u + r(5) * TAU), look, lookX: 0.5 * Math.sin(TAU * u + r(6) * TAU), hand: r(7) < 0.6 ? bump : 0, hside: r(8) < 0.5 ? 1 : -1 };
}
// the life layered on a held pose p of action a (clock c from idleClock / idleLoopClock)
export function idlePose(p, a, c) {
  const w = IDLE[a] || IDLE.stand, q = { ...p };
  const add = (k, v) => { q[k] = (q[k] ?? DEFP[k] ?? 0) + v; };
  // breathing: the chest lifts and opens, the shoulders rise a little, the head rides along
  const b = Math.sin(c.breath), bi = 0.5 + 0.5 * b;
  add('chestX', -0.024 * b * w[0]); add('spineX', -0.01 * b * w[0]); add('lShrug', 0.035 * bi * w[0]); add('rShrug', 0.035 * bi * w[0]); add('headX', 0.012 * b * w[0]);
  // weight shift: standing, the pelvis slides over one foot and tilts up on that side, the chest counters (feet planted);
  // seated/kneeling, the torso sways a little instead
  if (w[1]) {
    const sh = c.shift * w[1];
    if (p.plant !== false && a !== 'kneel') { add('side', 0.017 * sh); add('roll', 0.032 * sh); add('chestZ', -0.026 * sh); add('drop', 0.01 * w[1]); q.plantFeet = p; }
    else { add('spineZ', 0.012 * sh); add('chestZ', 0.016 * sh); }
  }
  // looking around: mostly the head, a little of the chest
  if (w[2]) { add('headY', 0.3 * c.look * w[2]); add('chestY', 0.05 * c.look * w[2]); add('headX', 0.05 * c.lookX * w[2]); }
  // a hand adjust: the forearm comes up a little and turns, the fingers close, then it all relaxes (not a hand held by IK)
  if (w[3] && c.hand > 0) {
    const k = c.hside > 0 ? 'l' : 'r', h = c.hand * w[3];
    if (!p[k + 'Hand'] && !(p.weapon && p.weapon !== 'sling')) { add(k + 'Elbow', -0.5 * h); add(k + 'ArmX', -0.14 * h); add(k + 'ForeY', 0.4 * c.hside * h); if (h > 0.4) q[k + 'Shape'] = 'soft'; }
  }
  return q;
}

// ── skeleton snapshots: blend two fully-evaluated poses bone by bone ─────────────────────────────────────────────────
function snapshot(fig, out) {
  const bs = fig.rig.bones; out = out || new Float32Array(bs.length * 7);
  for (let i = 0; i < bs.length; i++) { const b = bs[i], o = i * 7; out[o] = b.position.x; out[o + 1] = b.position.y; out[o + 2] = b.position.z; out[o + 3] = b.quaternion.x; out[o + 4] = b.quaternion.y; out[o + 5] = b.quaternion.z; out[o + 6] = b.quaternion.w; }
  return out;
}
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
function applyBlend(fig, A, Bs, w) {
  const bs = fig.rig.bones;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i], o = i * 7;
    b.position.set(lerp(A[o], Bs[o], w), lerp(A[o + 1], Bs[o + 1], w), lerp(A[o + 2], Bs[o + 2], w));
    _qa.set(A[o + 3], A[o + 4], A[o + 5], A[o + 6]); _qb.set(Bs[o + 3], Bs[o + 4], Bs[o + 5], Bs[o + 6]);
    b.quaternion.copy(_qa).slerp(_qb, w);
  }
  fig.rig.B.root.updateMatrixWorld(true);
}

// ── characters ──────────────────────────────────────────────────────────────────────────────────────────────────
const WITNESS = { id: 'witness', name: 'The Witness', kit: 'witness' };
export function findCastDef(ref, ctx) {
  const list = ctx?.cast || [];
  const d = Array.isArray(list) ? list.find((c) => c && c.id === ref) : list[ref];
  if (d) return d;
  if (ref === 'witness') return WITNESS;
  return null;
}
// the one entry point for consistency: identical def -> identical figure (seed from the def's stable hash)
export function buildCharacter(castDef, ctx = {}) {
  const warn = (m) => ctx.warn ? ctx.warn(m) : (ctx.warnings ? ctx.warnings.push(m) : console.warn('[f3d/human]', m));
  let def = castDef?.id === 'witness' && !castDef.kit ? { ...castDef, kit: 'witness' } : castDef || WITNESS;
  // opt-in stand-in (additive): a video cast def with fx_stand_in: true replaces the built-in Witness that FX modules
  // build for "you" (lib/fx mannequin()), so the viewer's character is the same in every scene. No flag, no change.
  if (def?.id === 'witness' && def.kit === 'witness' && ctx.cast && typeof ctx.cast === 'object') {
    const alt = Object.values(ctx.cast).find((d) => d && d.fx_stand_in && d.id !== 'witness');
    if (alt) def = alt;
  }
  const res = dress(def, { warn });
  const { fig, extras } = res;
  // colored flag (carried upright with both hands)
  if (extras.flag) {
    const tex = flagTexture(extras.flag);
    const f = R.whiteFlag({ width: 1.25, height: 0.84, pole: 2.5, tex });
    f.carry(fig, 'upright'); res.flag = f;
  }
  if (extras.light) {
    const L = new THREE.PointLight(0xFFB868, 3.2, 14, 2); L.name = 'lantern';
    const s = fig.rig.s; L.position.set(extras.light.offset[0] * s, extras.light.offset[1] * s, extras.light.offset[2] * s);
    fig.rig.B[extras.light.bone].add(L); res.light = L;
  }
  fig.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return res;
}
function flagTexture(f) {
  const W = 512, H = 344, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), col = (v) => '#' + new THREE.Color(v).getHexString();
  const cs = f.colors.map(col);
  if (f.style === 'horizontal') cs.forEach((cc, i) => { g.fillStyle = cc; g.fillRect(0, i * H / cs.length, W, H / cs.length + 1); });
  else if (f.style === 'plain') { g.fillStyle = cs[0]; g.fillRect(0, 0, W, H); }
  else if (f.style === 'cross') { g.fillStyle = cs[1] || '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = cs[0]; g.fillRect(W * 0.3, 0, W * 0.14, H); g.fillRect(0, H * 0.43, W, H * 0.14); }
  else cs.forEach((cc, i) => { g.fillStyle = cc; g.fillRect(i * W / cs.length, 0, W / cs.length + 1, H); });
  if (f.text) { g.fillStyle = 'rgba(0,0,0,0.75)'; g.font = '700 80px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(f.text).slice(0, 12), W / 2, H / 2); }
  // woven cloth: faint noise
  const id = g.getImageData(0, 0, W, H), r = rng(5);
  for (let i = 0; i < id.data.length; i += 4) { const k = 0.93 + r() * 0.07; id.data[i] *= k; id.data[i + 1] *= k; id.data[i + 2] *= k; }
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { col: t, nrm: null };
}

// ── the controller: actions over time, root motion along a path, eased everything ─────────────────────────────────
function normAction(a, warn) {
  let x = String(a || 'stand').toLowerCase();
  x = ALIAS[x] || x;
  if (!ACTIONS.includes(x)) { warn(`unknown action "${a}" -> stand`); x = 'stand'; }
  return x === 'idle' ? 'stand' : x;
}
function timeline(item, warn) {
  let list = Array.isArray(item.actions) && item.actions.length
    ? item.actions.map((e) => (Array.isArray(e) ? { t: +e[0] || 0, action: e[1] } : { ...e, t: +e.t || 0, action: e.action || e.a }))
    : [{ t: 0, action: item.action }];
  // Q10: an entry keeps its own params ({t, action, beats, ...}), its asked start (t0) and an optional fade (s)
  list = list.map((e) => { let a = normAction(e.action, warn); if (a === 'run' && (e.intensity ?? item.intensity) === 'sprint') a = 'sprint'; return { ...e, t: e.t, t0: e.t, raw: String(e.action ?? '').toLowerCase().trim(), action: a, fade: e.fade ?? X.FADE[a] }; }).sort((a, b) => a.t - b.t);
  list[0].t = Math.min(list[0].t, 0);
  // E1 v2: posture persists. After sit / sit_ground / kneel, an upper-body action (look_up, speak, point, watch, wave,
  // idle, ...) plays as its seated variant (e.base); only an explicit stand ('stand', 'stand_up', 'get_up', 'rise',
  // 'attention') or a whole-body action gets the figure up (e.standUpFrom: it first moves back clear of the desk).
  // Before, `look_up` at t = 7.6 stood the seated Titanic designer up inside his desk.
  let posture = null;
  for (const e of list) {
    if (SEATED.has(e.action)) { posture = e.action; continue; }
    if (!posture) continue;
    if (STAND_WORDS.has(e.raw) || WHOLE_BODY.has(e.action) || MOVING.has(e.action)) { e.standUpFrom = posture; posture = null; continue; }
    if (e.action === 'stand') { e.action = posture; continue; }               // 'idle' (or unknown) while seated: stay seated
    e.base = posture;
  }
  return list;
}
const SEATED = new Set(['sit', 'sit_ground', 'kneel']);
const STAND_WORDS = new Set(['stand', 'stand_up', 'standup', 'stand up', 'get_up', 'getup', 'get up', 'rise', 'attention', 'stand_guard']);
const WHOLE_BODY = new Set(['take_cover', 'lie_back', 'struck_fall', 'blanket_crouch', 'cpr', 'dig', 'probe', 'beacon', 'beacon_stand', 'ski', 'enter', 'ride', 'attention', 'march']);
// a seated variant keeps the seat's pelvis and legs; the arms too, unless the action is about them
const ARM_ACTIONS = new Set(['point', 'wave', 'cheer', 'salute', 'speak', 'aim', 'tap_helmet', 'shield_face']);
const LOWER_KEYS = ['plant', 'drop', 'fwd', 'side', 'holeDepth', 'turn', 'roll', 'lLeg', 'rLeg', 'lKnee', 'rKnee', 'lLegY', 'rLegY', 'lLegZ', 'rLegZ', 'lFoot', 'rFoot', 'lToe', 'rToe', 'armSwing'];
const ARM_KEYS = ['lHand', 'rHand', 'lArmX', 'lArmY', 'lArmZ', 'rArmX', 'rArmY', 'rArmZ', 'lElbow', 'rElbow', 'lForeY', 'rForeY', 'lShape', 'rShape', 'lWristX', 'rWristX', 'lWristY', 'rWristY', 'lShrug', 'rShrug', 'lFwd', 'rFwd', 'rFree', 'lFree'];
export function seatOverlay(p, base, a) {
  const q = { ...p };
  for (const k of LOWER_KEYS) { if (k in base) q[k] = base[k]; else delete q[k]; }
  q.lean = (base.lean ?? 0) + 0.5 * (p.lean ?? 0);
  if (!ARM_ACTIONS.has(a)) for (const k of ARM_KEYS) { if (k in base) q[k] = base[k]; else delete q[k]; }
  q.weapon = null;
  return q;
}
const TR = 1.0;          // cross-fade seconds between actions
function stateAt(list, t) {
  let i = 0; while (i + 1 < list.length && t >= list[i + 1].t) i++;
  const cur = list[i], prev = i > 0 ? list[i - 1] : null;
  const w = prev ? smoother((t - cur.t) / (cur.fade || TR)) : 1;
  return { cur: cur.action, prev: prev ? prev.action : null, w, curBase: cur.base || null, prevBase: prev ? prev.base || null : null };
}

export function makeController(res, item, ctx) {
  item = X.prepare(item, ctx, res);   // Q10: enter -> a path through the door; cpr -> kneel at the patient
  const { fig } = res, G = ground(ctx), warn = (m) => (ctx.warnings ? ctx.warnings.push(m) : console.warn('[f3d/human]', m));
  const list = timeline(item, warn);
  const shift = { x: 0, z: 0 };
  const standBack = (t) => { let b = 0; for (const e of list) { if (e.t > t) break; if (e.standUpFrom === 'sit') b = STAND_BACK * smoother((t - e.t) / (0.6 * (e.fade || TR))); else if (e.action === 'sit') b = 0; } return b; };
  const armed = !!fig.armed, seedPh = (fig.seed % 1000) / 1000 * TAU;
  const at = xz(item.at);
  const usesRide = list.some((e) => e.action === 'ride');
  // path: explicit, or straight ahead along the heading from `at` (long enough for any scene)
  let hdg = item.heading ?? null;
  if (item.face) { const f = xz(item.face); hdg = (Math.atan2(f[0] - at[0], -(f[1] - at[1])) / DEG + 360) % 360; }
  if (hdg == null) hdg = 180;
  let path = null;
  const moving = list.some((e) => MOVING.has(e.action));
  const spd = (a) => (MOVING.has(a) ? (item.speed ?? SPEED[a]) : 0);
  if (moving) {
    // corners become arcs (a walker ~1.2 m, a runner ~1.7 m, a horse 3 m): the figure turns along a curve and faces
    // where it travels, instead of pivoting on the spot at each corner
    const round = usesRide ? 3 : clamp(0.5 * Math.max(...list.map((e) => spd(e.action))), 1.2, 2.5);
    if (Array.isArray(item.path) && item.path.length >= 2) path = polyPath([at, ...item.path.map((p) => xz(p)).filter((p, i) => i > 0 || Math.hypot(p[0] - at[0], p[1] - at[1]) > 0.05)], { round, w: 0.35 });
    else { const d = [Math.sin(hdg * DEG), -Math.cos(hdg * DEG)], L = item.distance ?? 400; path = polyPath([at, [at[0] + d[0] * L, at[1] + d[1] * L]]); }
  }
  // a sprint's stride grows with its speed at a sprinter's cadence (~4.4 steps/s): 7.5 m/s -> 3.4 m per cycle for YOU
  const baseStride = fig.stride, strideOf = (a) => (a === 'run' ? baseStride * 1.9 : a === 'march' ? baseStride * 1.05 : a === 'sprint' ? baseStride * clamp(0.38 * spd('sprint'), 1.9, 2.9) : baseStride);
  // the gait of a moment: the moving action of the current / fading pair. Its stride drives the phase AND every gait pose
  // evaluated at that moment (walk -> run fades, run -> kneel stops), so the planted foot moves exactly with the body
  const gaitOf = (st) => (MOVING.has(st.cur) ? st.cur : st.prev && MOVING.has(st.prev) ? st.prev : st.cur);
  // integrate distance and gait phase at 120 Hz (deterministic; the soles never slide)
  const DT = 1 / 120, TMAX = Math.max(8, item.dur ?? ctx.dur ?? ctx.spec?.dur ?? 40) + 2, N = Math.ceil(TMAX / DT) + 1;
  const S = new Float32Array(N), PH = new Float32Array(N), K = new Float32Array(N), VV = new Float32Array(N), STRN = new Float32Array(N);
  // the stride of the moment fades between two gaits (walk -> run) instead of jumping at the change (a planted foot popped)
  const strideNow = (st) => (st.prev && st.w < 1 && MOVING.has(st.prev) && MOVING.has(st.cur) ? lerp(strideOf(st.prev), strideOf(st.cur), st.w) : strideOf(gaitOf(st)));
  { let s = 0, ph = seedPh; const L = path ? path.length : 0;
    for (let i = 0; i < N; i++) {
      const t = i * DT, st = stateAt(list, t);
      let vNom = lerp(st.prev ? spd(st.prev) : spd(st.cur), spd(st.cur), st.w);
      if (item.start != null) vNom *= smoother((t - item.start) / 0.8);          // a delayed start eases in (was a jump)
      const brake = path ? clamp((L - s) / Math.max(0.4, vNom * 0.9)) : 0;
      const v = vNom * Math.min(1, brake * (2 - brake));
      const ref = Math.max(spd(st.cur), spd(st.prev || st.cur), 0.01), k = clamp(v / ref);
      const sn = strideNow(st);
      S[i] = s; PH[i] = ph; K[i] = k; VV[i] = v; STRN[i] = sn;
      s += v * DT;
      if (k > 0.02) ph += TAU * (ref / sn) * DT;
    }
  }
  // key_pose_at (world time, e.g. a clock freeze): the gait phase is shifted (one constant, the feet stay planted) so that
  // at that moment the figure shows its key pose: the right foot pushing off at the end of its stance, the left knee
  // driven high (key_leg: 'right' swaps them)
  if (item.key_pose_at != null && Number.isFinite(+item.key_pose_at)) {
    const tk = +item.key_pose_at, gk = GAITS[gaitOf(stateAt(list, tk))] || {}, duty = gk.duty ?? fig.gait.duty;
    const want = (((duty - 0.02 + (item.key_leg === 'right' ? 0 : 0.5)) % 1) + 1) % 1 * TAU;
    const x = clamp(tk / DT, 0, N - 1), i0 = Math.floor(x), f0 = x - i0, cur = i0 + 1 < N ? PH[i0] * (1 - f0) + PH[i0 + 1] * f0 : PH[N - 1];
    let d = (want - cur) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
    for (let i = 0; i < N; i++) PH[i] += d;
  }
  // how much of the gait shows at speed v: all of it from ~0.35 m/s (feet planted), fading to the standing pose below
  // (a slower gait than that gets its whole range scaled down)
  const gaitW = (v, ref = 1.35) => smoother((v - 0.03) / Math.max(0.05, Math.min(0.32, ref * 0.8)));
  // cross-fade weight toward the current action: by time, or by speed when one side is a gait and the other is not
  const bySpeedW = (st, v, byspeed) => {
    if (!byspeed) return st.w;
    const g = gaitW(v, spd(gaitOf(st)));
    return MOVING.has(st.cur) && st.cur !== 'ride' ? g : 1 - g;
  };
  const sample = (arr, t) => { const x = clamp(t / DT, 0, N - 1), i = Math.floor(x), f = x - i; return i + 1 < N ? arr[i] * (1 - f) + arr[i + 1] * f : arr[N - 1]; };
  // planted feet through speed changes (starts, stops, walk <-> run): the parametric gait scales its stride with the
  // speed, which moved a planted foot whenever the speed changed. A stance foot now stays where it landed (in the
  // figure's frame: its landing spot minus the distance walked since), a swing leaves from where it lifted off and lands
  // where its next stance begins, at the stance speeds there. Offsets on the rig's gait (ov), from the 120 Hz tables.
  function tOfPh(P) {                                        // when the gait phase (rad) reaches P (PH never decreases)
    if (P <= PH[0]) { const r = (PH[Math.min(1, N - 1)] - PH[0]) / DT; return r > 1e-9 ? (P - PH[0]) / r : 0; }
    if (P >= PH[N - 1]) return (N - 1) * DT;
    let lo = 0, hi = N - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (PH[m] < P) lo = m; else hi = m; }
    return (lo + (P - PH[lo]) / Math.max(1e-9, PH[hi] - PH[lo])) * DT;
  }
  const sAtX = (t) => (t < 0 ? S[0] + VV[0] * t : sample(S, t));
  function footOv(t, duty, strideN) {
    const phc = sample(PH, t) / TAU, kt = sample(K, t), sNow = sample(S, t), out = [];
    for (const off of [0, 0.5]) {                                   // the rig's left foot, right foot (half a cycle later)
      const c = phc + off, u = ((c % 1) + 1) % 1, c0 = c - u, tS = tOfPh((c0 - off) * TAU), kS = sample(K, Math.max(0, tS)) * sample(STRN, Math.max(0, tS));
      if (u < duty) out.push({ d: kS * (0.5 * duty - 0.1) - strideN * kt * (0.5 * duty - u - 0.1) - (sNow - sAtX(tS)) });
      else {
        const tLo = tOfPh((c0 + duty - off) * TAU), tN = tOfPh((c0 + 1 - off) * TAU), kLo = sample(K, Math.max(0, tLo)) * sample(STRN, Math.max(0, tLo)), kN = sample(K, tN) * sample(STRN, tN);
        const lo = kS * (0.5 * duty - 0.1) - (sAtX(tLo) - sAtX(tS));
        out.push({ d0: lo - strideN * kt * (-0.5 * duty - 0.1), d1: (kN - strideN * kt) * (0.5 * duty - 0.1), m0: -kLo * (1 - duty), m1: -kN * (1 - duty) });
      }
    }
    return out;
  }

  // horse (ride)
  let horse = null;
  if (usesRide) { horse = buildHorse({ color: item.horse_color, seed: fig.seed }); res.horse = horse; }
  const root = new THREE.Group(); root.name = 'cast:' + (item.ref || fig.kitName);
  root.add(fig.group);
  if (res.flag) { /* rides on the chest bone */ }
  if (horse) root.add(horse.group);
  // seat for `sit`: its own wooden chair, unless the scene provides the seat (`seat: "bench"` or `"none"`: the pose lands on
  // a 0.46 m seat top that is already there, e.g. a storm-cellar bench); no `seat` = the chair, as before
  let chair = null;
  const ownSeat = !['bench', 'none'].includes(String(item.seat ?? '').toLowerCase());
  if (ownSeat && list.some((e) => e.action === 'sit')) {
    chair = R.chair({ color: 0x5A3E28 }); chair.group.position.set(0, 0, -0.05 * fig.rig.s); root.add(chair.group);
    chair.group.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  }
  // contact shadow in root space, conformed to the terrain every frame
  const blobGeo = new THREE.PlaneGeometry(2, 2, 6, 6); blobGeo.rotateX(-Math.PI / 2);
  const blobBase = Float32Array.from(blobGeo.attributes.position.array);
  const blob = new THREE.Mesh(blobGeo, blobMaterial(0.5)); blob.renderOrder = 2; blob.frustumCulled = false; root.add(blob);
  const rx = horse ? 0.7 : 0.42, rz = horse ? 1.5 : 0.36;

  const SA = new Float32Array(fig.rig.bones.length * 7), SB = new Float32Array(fig.rig.bones.length * 7);
  const wind = () => ctx.weather?.wind ?? item.wind ?? 0.25;
  let horseGait = 0;
  // where the figure stands this frame (set before the pose is evaluated): world targets -> the figure's own frame
  const now = { x: at[0], y: G.h(at[0], at[1]), z: at[1], yaw: yawFromHeading(hdg) };
  // the terrain at a point of the figure's own frame, relative to where it stands (feet on slopes, rig gait/pose .ground)
  const gOf = (lx, lz) => { const c = Math.cos(now.yaw), sn = Math.sin(now.yaw); return G.h(now.x + lx * c + lz * sn, now.z - lx * sn + lz * c) - now.y; };
  const toLocal = (wx, wy, wz) => { const dx = wx - now.x, dz = wz - now.z, c = Math.cos(now.yaw), sn = Math.sin(now.yaw); return [dx * c - dz * sn, wy - now.y, dx * sn + dz * c]; };
  const target3 = (P, lift) => { const x = +P[0], z = +(P.length >= 3 ? P[2] : P[1]); return [x, P.length >= 3 ? +P[1] : Math.max(G.h(x, z), ctx.water?.level ?? -Infinity) + lift, z]; };
  const XA = X.attach({ fig, item, ctx, now, root, list, DEFP, seedPh, blobGeo, blobBase, path, sAt: (t) => sample(S, t), vAt: (t) => sample(VV, t), poseFor: (a, t) => poseFor(a, t) });   // Q10 actions
  // point: a straight arm at shoulder height toward item.point_at ([x, z]: a point ~1.2 m above the ground or sea there;
  // [x, y, z] exact), default ahead-right; the arm on the target's side; pelvis, chest and head turn toward it
  function pointPose() {
    const s = fig.rig.s;
    let l = [-0.42, 0.04 * s, 1];
    if (Array.isArray(item.point_at) && item.point_at.length >= 2) { const w = target3(item.point_at, 1.2); l = toLocal(w[0], w[1], w[2]); l[1] -= 1.43 * s; }
    const az = Math.atan2(l[0], l[2]), el = clamp(Math.atan2(l[1], Math.hypot(l[0], l[2]) || 1), -0.6, 0.7);
    const side = az > 0.35 ? 1 : -1, k = side > 0 ? 'l' : 'r', o = side > 0 ? 'r' : 'l';
    const turn = clamp(az * 0.15, -0.3, 0.3), chestY = clamp(az * 0.3, -0.55, 0.55), headY = clamp(az - turn - chestY, -0.85, 0.85);
    // what a shoulder can do: from ~40° across the body to ~110° out to its own side (relative to the turned chest)
    const rel = clamp((az - turn - chestY) * -side, -1.9, 0.7) * -side + turn + chestY;
    const dir = [Math.sin(rel) * Math.cos(el), Math.sin(el), Math.cos(rel) * Math.cos(el)];
    return { ...POSE.stand, weapon: 'sling', turn, chestY, headY, headX: clamp(-el * 0.7, -0.35, 0.3), lean: 0.02, spineY: chestY * 0.4,
      [k + 'Hand']: { space: 'root', dir, palm: [-side, -0.35, 0] }, [k + 'Shape']: 'point',   // palm in, thumb on top [k + 'Shrug']: 0.08 + Math.max(0, el) * 0.25, [k + 'Fwd']: 0.1,
      [o + 'ArmZ']: side * -0.09, [o + 'Elbow']: -0.2, [o + 'Shape']: 'relaxed', rFree: true };
  }
  // take cover: the right hand grips item.hold_at ([x, y, z] or [x, z] at 0.25 m) when it is within reach, else the floor ahead
  function coverPose() {
    const p = POSE.take_cover, s = fig.rig.s;
    if (!(Array.isArray(item.hold_at) && item.hold_at.length >= 2)) return p;
    const w = item.hold_at.length >= 3 ? item.hold_at.map(Number) : [+item.hold_at[0], G.h(+item.hold_at[0], +item.hold_at[1]) + 0.25, +item.hold_at[1]];
    const l = toLocal(w[0], w[1], w[2]);
    if (Math.hypot(l[0] + 0.2 * s, l[1] - 0.45 * s, l[2] - 0.35 * s) > 0.8 * s) return p;      // out of reach from the right shoulder
    return { ...p, rHand: { space: 'root', p: [l[0] / s, l[1] / s, l[2] / s], fingers: [0.25, 0.1, 1], palm: [1, 0, -0.1], pole: [-1, -0.6, 0] } };   // thumb up, palm in
  }
  function poseFor(a, t) {
    let p = POSE[a] || POSE.stand;
    if (a === 'point') p = pointPose();
    else if (a === 'take_cover') p = coverPose();
    if (a === 'speak') {
      const u = t / 1.35 + seedPh, i = Math.floor(u), f = smoother((u - i - 0.25) / 0.5);
      const pick = (n) => SPEAK[Math.floor(Math.abs(Math.sin(n * 12.9898 + fig.seed) * 43758.5453)) % SPEAK.length];
      p = { ...mixPose(pick(i), pick(i + 1), f), lShape: 'soft', rShape: 'soft', weapon: armed ? 'sling' : null, rFree: true };
      p.headX = (p.headX ?? 0) + 0.035 * Math.sin(TAU * t * 1.7 + seedPh);
    } else if (a === 'wave') {
      const o = Math.sin(TAU * 1.3 * t + seedPh);
      p = { ...p, rArmZ: p.rArmZ + 0.2 * o, rElbow: p.rElbow - 0.2 - 0.18 * o };
    } else if (a === 'cheer') {
      const o = Math.sin(TAU * 1.1 * t + seedPh);
      p = { ...p, lArmZ: p.lArmZ - 0.15 * o, rArmZ: p.rArmZ - 0.15 * o, lElbow: p.lElbow - 0.2 * (1 + o), rElbow: p.rElbow - 0.2 * (1 - o) };
    }
    if (!armed && p.weapon) p = { ...p, weapon: null };
    if (fig.hold?.r && !MOVING.has(a) && a !== 'wave' && a !== 'cheer') p = { ...p, rShape: 'grip' };
    if (fig.hold?.l && a !== 'cheer') p = { ...p, lShape: 'grip' };
    return MOVING.has(a) ? p : idlePose(p, a, idleClock(t, fig.seed));          // idle life (was a faint breath)
  }
  function evalAction(a, t, k, ph, stride, base) {
    // E1 v2: a seated variant: every pose this action applies (here or in actions.js) keeps the seat's lower body
    if (base && !MOVING.has(a)) {
      const orig = fig._apply, bp = poseFor(base, t);
      fig._apply = (p, gait) => orig.call(fig, seatOverlay(p, bp, a), null);
      try { evalAction(a, t, k, ph, stride, null); } finally { fig._apply = orig; }
      return;
    }
    if (XA.owns(a)) return XA.evalAction(a, t, k, ph, stride);   // Q10 actions (actions.js)
    const g = fig.gait;
    if (MOVING.has(a) && a !== 'ride') {
      const savedG = { ...g }, savedStride = fig.stride;
      Object.assign(g, GAITS[a] || {});
      fig.stride = stride ?? strideOf(a);
      fig._apply({ ...DEFP, ...poseFor(a, t) }, { ph, k: clamp(k, 0, 1), ov: footOv(t, g.duty, fig.stride), ground: gOf });
      for (const kk of Object.keys(g)) if (!(kk in savedG)) delete g[kk];
      Object.assign(g, savedG); fig.stride = savedStride;
    } else fig._apply({ ...DEFP, ...poseFor(a, t), ground: gOf }, null);
  }
  const s0 = fig.rig.s;
  const gaitPose = (a) => MOVING.has(a) && a !== 'ride';
  function update(t = 0) {
    const st = stateAt(list, t), k = sample(K, t), ph = sample(PH, t), s = sample(S, t), v = sample(VV, t), stride = sample(STRN, t);
    // root position + yaw
    let x = at[0], z = at[1], yaw = yawFromHeading(hdg), velX = 0, velZ = 0;
    if (path) {
      const p = path.at(s), d = path.dir(s); x = p[0]; z = p[1]; velX = d[0] * v; velZ = d[1] * v;
      if (s > 0.01 || moving) yaw = Math.atan2(d[0], d[1]);
    }
    // E1 v2: the placement resolver's shift (a figure put inside furniture), and the step back clear of the desk when a
    // seated figure stands up (the chair slides back further, behind it)
    x += shift.x; z += shift.z;
    const back = standBack(t);
    if (back > 0) { x -= Math.sin(yaw) * back; z -= Math.cos(yaw) * back; }
    now.x = x; now.z = z; now.y = G.h(x, z); now.yaw = yaw;
    // skeleton: current action (and the previous one while cross-fading). Walking <-> standing fades by SPEED, not by
    // time: the gait stays on while the body moves faster than 0.35 m/s, so the planted foot never skates
    evalAction(st.cur, t, k, ph, stride, st.curBase);
    const fading = st.prev && st.w < 1, byspeed = fading && gaitPose(st.cur) !== gaitPose(st.prev);
    if (fading) {
      snapshot(fig, SB);
      evalAction(st.prev, t, k, ph, stride, st.prevBase); snapshot(fig, SA);
      applyBlend(fig, SA, SB, bySpeedW(st, v, byspeed));
    }
    // a moving action slowing to a stop at the end of its path (or waiting for its start) blends back to standing
    if (gaitPose(st.cur) && k < 0.999 && !byspeed) {
      snapshot(fig, SB);
      fig._apply({ ...DEFP, ...idlePose(POSE.stand, 'stand', idleClock(t, fig.seed)), weapon: armed ? 'sling' : null, ground: gOf }, null); snapshot(fig, SA);
      applyBlend(fig, SA, SB, gaitW(v, spd(st.cur)));
    }
    const y = G.h(x, z);
    fig.group.position.set(x, y, z); fig.group.rotation.set(0, yaw, 0);
    root.position.set(0, 0, 0);
    if (horse) {
      const riding = st.cur === 'ride' ? st.w : st.prev === 'ride' ? 1 - st.w : 0;
      horse.group.position.set(x, y, z); horse.group.rotation.y = yaw;
      horse.update(t, k * 1.0, s);
      if (riding > 0) fig.group.position.y = y + horse.saddleY - 0.87 * s0 + horse.bob(t, k) * riding;
    }
    fig.group.updateMatrixWorld(true);
    // the scarf feels the air the figure runs through: the old default breeze (0.25 toward +X) minus its velocity / 9
    // (a sprint streams it behind; a standing figure is exactly as before)
    { const wx = (+wind() || 0) - velX / 9, wz = -velZ / 9, wl = Math.hypot(wx, wz);
      fig.update(t, { wind: wl > 1e-4 ? { x: wx / wl, z: wz / wl, strength: Math.min(1.3, wl) } : 0 }); }
    if (res.flag) res.flag.update(t, { wind: Math.max(0.35, wind()) });
    // contact shadow under the feet, conformed to the ground
    const Pp = blobGeo.attributes.position, cy = Math.cos(yaw), sy = Math.sin(yaw), ys = st.cur === 'sit_ground' || st.cur === 'kneel' || st.cur === 'take_cover' ? 1.25 : 1;
    for (let i = 0; i < Pp.count; i++) {
      const u = blobBase[i * 3] * rx * ys, v = blobBase[i * 3 + 2] * rz * ys;
      const wx = x + u * cy + v * sy, wz = z - u * sy + v * cy;
      Pp.setXYZ(i, wx, G.h(wx, wz) + 0.02, wz);
    }
    Pp.needsUpdate = true;
    if (chair) { const cb = 0.05 + back * (STAND_CHAIR / STAND_BACK - 1); chair.group.position.set(x - Math.sin(yaw) * cb, y, z - Math.cos(yaw) * cb); chair.group.rotation.y = yaw; }
    XA.after(t, st);   // Q10: props, door, a lying body on the slope
    return root;
  }
  return { root, update, fig, path, horse, actionAt: (t) => stateAt(list, t),
    // E1 v2 placement (core/qa.js resolveFigures): where it sits / stands, which postures it takes, and a shift
    relocate: (dx, dz) => { shift.x += dx; shift.z += dz; },
    placement: () => ({ x: at[0] + shift.x, z: at[1] + shift.z, yaw: yawFromHeading(hdg), moving: !!path, chair: !!chair,
      postures: [...new Set(list.map((e) => (SEATED.has(e.action) ? e.action : e.base ? e.base : 'stand')))], standBack: list.some((e) => e.standUpFrom === 'sit') ? STAND_BACK : 0 }) };
}
const STAND_BACK = 0.15, STAND_CHAIR = 0.6;          // m: the figure steps back as it rises, its chair slides back behind it

// ── catalog + build ────────────────────────────────────────────────────────────────────────────────────────────
const PARAMS = { at: '[x, z] | "stage"', heading: 'deg (0 = north)', face: '[x, z] to face', action: ACTIONS.join('|'), actions: '[{t, action}] timeline, each change eases over 1 s',
  path: '[[x, z], ...] for walk/run/march/ride (corners are walked as arcs)', speed: 'm/s', start: 's: a moving action waits, then eases in', seat: 'sit: its own chair (default) | "bench" | "none" (the scene has the 0.46 m seat)', horse_color: 'ride: hex',
  point_at: 'point: [x, z] (≈1.2 m above the ground/sea there) | [x, y, z] world target', hold_at: 'take_cover: [x, y, z] | [x, z] what the right hand grips (a desk leg)' };
export const CATALOG = {
  cast: { desc: 'a recurring character of the video: item.ref = CastDef.id (built identically in every scene); witness is built in', actions: ACTIONS, params: PARAMS, footprint: [0.7, 0.5], height: 1.8, tags: ['figure', 'cast', 'character'] },
  'figure.person': { desc: 'one mannequin in any kit (kit, colors {coat, trousers, accent}, headwear, accessories, build {height, bulk}, signature)', actions: ACTIONS, params: { ...PARAMS, kit: Object.keys(KITS).join('|') }, footprint: [0.7, 0.5], height: 1.8, tags: ['figure'] },
  'figure.witness': { desc: 'THE WITNESS: bare white mannequin with the mustard knit scarf (Frontier brand character)', actions: ACTIONS, params: PARAMS, footprint: [0.7, 0.5], height: 1.82, tags: ['figure', 'brand'] },
};
export async function build(kind, item = {}, ctx = {}) {
  let def;
  if (kind === 'cast' || kind === 'cast.character') {
    def = findCastDef(item.ref, ctx);
    if (!def) { (ctx.warnings || []).push(`cast ref "${item.ref}" not in the video cast -> witness`); def = WITNESS; }
  } else if (kind === 'figure.witness') def = WITNESS;
  else def = { id: item.id || item.kit || 'person', kit: item.kit || 'modern_casual', colors: item.colors, headwear: item.headwear, accessories: item.accessories, build: item.build, signature: item.signature, variant: item.variant };
  const res = buildCharacter(def, ctx);
  const ctl = makeController(res, item, ctx);
  ctl.update(0);
  patchAll(ctl.root, ctx);
  const fig = res.fig;
  return {
    root: ctl.root, radius: ctl.horse ? 1.4 : 0.45, height: (ctl.horse ? 2.6 : 1.85) * fig.rig.s,
    update: (t) => ctl.update(t),
    relocate: ctl.relocate, placement: ctl.placement,          // E1 v2: core/qa.js resolveFigures
    anchors: { ...fig.anchors, body: fig.group, feet: fig.group },
    figure: fig, character: def.id,
    // the figure's position at t (for camera targeting / safety) without touching the skeleton
    positionAt: (t) => { ctl.update(t); return fig.group.position.clone(); },
    // fix: a walking/running cast member moves fig.group inside a fixed root, so the camera's subject track and the
    // QA probe (which read root positions unless members() exists) followed the start point; members() reports the
    // figure itself. Only for moving figures (a standing one keeps the old path through its root).
    ...(ctl.path ? { members: (t) => { ctl.update(t); const p = fig.group.position; return [[p.x, p.z]]; } } : {}),
    // locomotion QA (core/loco.js): where the figure is and faces, and the contact points of its feet (the horse's hooves
    // while riding), measured on the posed skeleton
    ...(ctl.path ? { loco: { kind: 'cast', walkers: (t) => {
      ctl.update(t);
      const p = fig.group.position, st = ctl.actionAt(t), riding = ctl.horse && (st.cur === 'ride' || (st.prev === 'ride' && st.w < 0.5));
      return [{ x: p.x, z: p.z, yaw: fig.group.rotation.y, feet: riding && ctl.horse.contacts ? ctl.horse.contacts() : fig.footContacts() }];
    } } } : {}),
  };
}
