// creatures.js — animals of the nature library, sculpted as smooth unions of round cones and ellipsoids (sculpt.js),
// skinned to world-aligned skeletons and animated as pure functions of t:
//   creature.sauropod (Alamosaurus)  creature.theropod (T. rex)  creature.ceratopsian (Triceratops)
//   creature.pterosaur (Quetzalcoatlus, membrane wings rebuilt per frame)
//   creature.horse (walk / trot / canter / gallop, saddle anchor for a rider)  creature.deer  creature.wolf
//   creature.whale (humpback, swims at the surface)  creature.bird_flock  creature.fish_shoal (instanced)
// Ground animals: 2-bone leg IK, feet planted during stance (stride = speed x duty x period, so nothing slides),
// foot targets follow the terrain, body pitches with the slope, soft contact shadows registered with the core.
// Movement: item.path [[x,z],..] (followed at `speed`), else heading + speed from `at`; count > 1 makes a herd.
import * as THREE from 'three';
import { sculpt, rig, skinMaterial, SKIN_VERT, SKIN_FRAG } from './sculpt.js';
import { U, patchMaterial } from '../shared/env.js';
import { rng, makeNoise, clamp, lerp, smooth } from '../shared/util.js';

const NZ = makeNoise(99);
const TAU = Math.PI * 2;
const lin = (hex) => { const c = parseInt(hex.slice(1), 16); return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255].map((v) => Math.pow(v, 2.2)); };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rc = (b, a, b2, r1, r2, k, o = {}) => Object.assign({ t: 'rc', b, a, b2, r1, r2, k }, o);
const el = (b, c, r, k, o = {}) => Object.assign({ t: 'el', b, c, r, k }, o);
const mir = (v, s) => [v[0] * s, v[1], v[2]];

export const CATALOG = {
  'creature.sauropod': { desc: 'Alamosaurus-like titanosaur, ~26 m long, 10 m tall with neck raised; herds', actions: ['walk', 'graze', 'idle'], params: { speed: 1.1, scale: 1, count: 1 }, footprint: [5, 26], height: 10.5, tags: ['dinosaur', 'cretaceous', 'animal'] },
  'creature.theropod': { desc: 'Tyrannosaurus rex, ~12 m, horizontal posture', actions: ['idle', 'walk', 'run', 'roar'], params: { speed: 2.2, scale: 1 }, footprint: [2.2, 12], height: 4.8, tags: ['dinosaur', 'cretaceous', 'predator'] },
  'creature.ceratopsian': { desc: 'Triceratops, ~8.5 m, frill and three horns', actions: ['graze', 'walk', 'idle'], params: { speed: 1.0, scale: 1, count: 1 }, footprint: [2.4, 8.5], height: 2.9, tags: ['dinosaur', 'cretaceous', 'animal'] },
  'creature.pterosaur': { desc: 'Quetzalcoatlus azhdarchid, 10.5 m wingspan; flies (circle or straight), glides', actions: ['fly', 'glide'], params: { speed: 14, altitude: 40, radius: 80, count: 1 }, footprint: [10, 6], height: 2, tags: ['dinosaur', 'cretaceous', 'flying'], fly: true, snap: false },
  'creature.horse': { desc: 'horse (bay / chestnut / grey / black / white); walk, trot, canter, gallop; anchors.saddle for a rider', actions: ['idle', 'graze', 'walk', 'trot', 'canter', 'gallop'], params: { speed: 1.6, color: 'bay', saddle: false, count: 1 }, footprint: [0.9, 2.5], height: 2.3, tags: ['animal', 'historic', 'war'] },
  'creature.deer': { desc: 'red deer with antlers (stag) or without (hind); graze, walk, run; herds', actions: ['idle', 'graze', 'walk', 'run'], params: { speed: 1.4, antlers: true, count: 1 }, footprint: [0.7, 1.9], height: 1.9, tags: ['animal', 'forest'] },
  'creature.wolf': { desc: 'grey wolf; walk, trot, run; packs', actions: ['idle', 'walk', 'trot', 'run'], params: { speed: 2, count: 1 }, footprint: [0.5, 1.5], height: 0.85, tags: ['animal', 'forest', 'predator'] },
  'creature.whale': { desc: 'humpback whale, 14 m, swims at the surface with slow fluke beats; needs ocean', actions: ['swim', 'dive'], params: { speed: 2.5, depth: 1.2 }, footprint: [4, 14], height: 3, tags: ['animal', 'ocean'], snap: false },
  'creature.bird_flock': { desc: 'flock of birds (gulls or dark birds) wheeling over a point or flying a heading', actions: ['fly', 'circle'], params: { count: 40, altitude: 35, radius: 60, speed: 11, color: 'dark' }, footprint: [60, 60], height: 4, tags: ['animal', 'flying', 'bird'], fly: true, snap: false },
  'creature.fish_shoal': { desc: 'shoal of silver fish milling in shallow clear water', actions: ['swim'], params: { count: 120, radius: 6, depth: 1.2 }, footprint: [12, 12], height: 1, tags: ['animal', 'water'], snap: false },
};
const ALIAS_ACTION = { run: 'run', gallop: 'gallop', canter: 'canter', trot: 'trot', walk: 'walk', graze: 'graze', idle: 'idle', roar: 'roar', stand: 'idle', eat: 'graze', march: 'walk', move: 'walk', drive: 'walk' };

// ── Alamosaurus ────────────────────────────────────────────────────────────────────────────────────────────────
function alamoSpec() {
  const bones = [['pelvis', null, [0, 4.35, 0]], ['back', 'pelvis', [0, 4.75, 2.0]], ['chest', 'back', [0, 4.9, 3.9]]];
  const neck = [[0, 5.35, 5.2], [0, 6.45, 6.7], [0, 7.5, 8.1], [0, 8.45, 9.5], [0, 9.25, 10.85], [0, 9.85, 12.1], [0, 10.15, 13.05]];
  for (let i = 0; i < 6; i++) bones.push(['neck' + i, i ? 'neck' + (i - 1) : 'chest', neck[i]]);
  bones.push(['head', 'neck5', neck[6]]);
  const tail = [[0, 4.8, -1.4], [0, 4.5, -3.4], [0, 4.05, -5.4], [0, 3.55, -7.4], [0, 3.05, -9.4], [0, 2.62, -11.3], [0, 2.3, -13.1]];
  for (let i = 0; i < 6; i++) bones.push(['tail' + i, i ? 'tail' + (i - 1) : 'pelvis', tail[i]]);
  const prims = [
    el('back', [0, 4.2, 1.9], [1.52, 1.62, 3.6], 0.7),
    el('chest', [0, 4.15, 3.55], [1.46, 1.72, 2.05], 0.6),
    el('pelvis', [0, 4.6, 0.0], [1.38, 1.3, 1.85], 0.6),
    el('back', [0, 5.3, 1.6], [0.85, 0.6, 3.1], 0.55),
    el('chest', [0, 5.25, 4.1], [0.95, 0.75, 1.4], 0.5),
  ];
  const nr = [1.22, 0.92, 0.72, 0.58, 0.47, 0.38, 0.32];
  for (let i = 0; i < 6; i++) prims.push(rc('neck' + i, i ? neck[i] : [0, 5.0, 4.7], neck[i + 1], nr[i], nr[i + 1], i ? 0.25 : 0.6, { sx: 0.8 }));
  // head: longish, square-snouted, nostrils set back and high (Rapetosaurus-like), eyes high
  prims.push(el('head', [0, 10.2, 13.3], [0.26, 0.3, 0.42], 0.12));
  prims.push(rc('head', [0, 10.18, 13.35], [0, 9.78, 14.15], 0.25, 0.17, 0.14, { sx: 1.05 }));
  prims.push(el('head', [0, 9.9, 13.72], [0.21, 0.13, 0.44], 0.09));
  prims.push(el('head', [0, 10.33, 13.62], [0.15, 0.12, 0.22], 0.08));
  for (const s of [1, -1]) prims.push(el('head', [0.19 * s, 10.3, 13.45], [0.05, 0.05, 0.05], 0.015, { col: 'eye', zoneBias: 0.02 }));
  const tr = [1.15, 0.9, 0.66, 0.46, 0.31, 0.18, 0.06];
  for (let i = 0; i < 6; i++) prims.push(rc('tail' + i, i ? tail[i] : [0, 4.85, -0.8], tail[i + 1], tr[i], tr[i + 1], i ? 0.25 : 0.55));
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    bones.push(['thigh' + S, 'pelvis', mir([1.05, 4.05, 0.1], s)], ['shin' + S, 'thigh' + S, mir([1.1, 2.25, 0.45], s)], ['foot' + S, 'shin' + S, mir([1.1, 0.62, 0.05], s)]);
    bones.push(['upper' + S, 'chest', mir([1.15, 4.1, 3.95], s)], ['fore' + S, 'upper' + S, mir([1.2, 2.3, 3.7], s)], ['hand' + S, 'fore' + S, mir([1.2, 0.55, 3.95], s)]);
    prims.push(rc('thigh' + S, mir([1.0, 4.2, 0.1], s), mir([1.1, 2.25, 0.45], s), 0.86, 0.52, 0.45));
    prims.push(el('thigh' + S, mir([0.98, 3.55, 0.08], s), [0.62, 1.1, 0.92], 0.4));
    prims.push(rc('shin' + S, mir([1.1, 2.25, 0.45], s), mir([1.1, 0.62, 0.05], s), 0.52, 0.41, 0.14));
    prims.push(rc('foot' + S, mir([1.1, 0.62, 0.05], s), mir([1.13, 0.2, 0.28], s), 0.43, 0.47, 0.12));
    prims.push(el('foot' + S, mir([1.13, 0.2, 0.34], s), [0.52, 0.24, 0.58], 0.1));
    prims.push(rc('upper' + S, mir([1.1, 4.25, 3.95], s), mir([1.2, 2.3, 3.7], s), 0.74, 0.45, 0.4));
    prims.push(rc('fore' + S, mir([1.2, 2.3, 3.7], s), mir([1.2, 0.55, 3.95], s), 0.45, 0.37, 0.12));
    prims.push(rc('hand' + S, mir([1.2, 0.55, 3.95], s), mir([1.2, 0.06, 4.0], s), 0.37, 0.41, 0.08));
    // osteoderms: a few low bony bosses on the upper flanks
    const r = rng(s > 0 ? 11 : 12);
    for (let q = 0; q < 9; q++) prims.push(el('back', mir([1.05 + r() * 0.15, 5.05 + r() * 0.3, -0.4 + q * 0.62 + r() * 0.2], s), [0.13, 0.08, 0.15], 0.06));
  }
  const dors = lin('#6e5d4a'), vent = lin('#b9a68c'), band = lin('#4e4234');
  return { bones, prims, color: (p, n, z) => {
    if (z?.col === 'eye') return [0.01, 0.01, 0.01];
    const d = smooth((n[1] + 0.45) / 0.9);
    let c = mix3(vent, dors, d);
    const st = smooth((Math.sin(p[2] * 1.45 + NZ.noise2(p[0] * 0.4, p[2] * 0.3) * 2.2) - 0.35) / 0.5) * d * (p[2] < 6 && p[2] > -9 ? 1 : 0.3);
    c = mix3(c, band, st * 0.45);
    const m = NZ.fbm2(p[0] * 0.9 + p[1] * 0.7, p[2] * 0.9, 3) * 0.5 + 0.5;
    c = c.map((v) => v * (0.82 + 0.3 * m));
    if (p[1] < 1.3) c = mix3(c, lin('#3a3024'), smooth((1.3 - p[1]) / 1.2) * 0.55);     // mud-stained feet
    return c;
  } };
}

// ── Tyrannosaurus ──────────────────────────────────────────────────────────────────────────────────────────────
function rexSpec() {
  const bones = [['pelvis', null, [0, 3.55, 0]], ['back', 'pelvis', [0, 3.75, 1.3]], ['chest', 'back', [0, 3.75, 2.35]],
    ['neck0', 'chest', [0, 3.95, 3.0]], ['neck1', 'neck0', [0, 4.3, 3.55]], ['head', 'neck1', [0, 4.55, 3.95]], ['jaw', 'head', [0, 4.33, 4.08]]];
  const tail = [[0, 3.8, -1.0], [0, 3.72, -2.8], [0, 3.52, -4.6], [0, 3.28, -6.3], [0, 3.05, -7.6], [0, 2.9, -8.5]];
  for (let i = 0; i < 5; i++) bones.push(['tail' + i, i ? 'tail' + (i - 1) : 'pelvis', tail[i]]);
  const prims = [
    el('back', [0, 3.3, 1.1], [0.96, 1.12, 1.9], 0.5), el('chest', [0, 3.1, 2.2], [0.86, 1.06, 1.05], 0.45),
    el('pelvis', [0, 3.72, -0.25], [0.62, 0.66, 1.15], 0.45), el('back', [0, 3.95, 0.9], [0.45, 0.4, 1.6], 0.4),
    rc('neck0', [0, 3.65, 2.55], [0, 4.33, 3.62], 0.72, 0.56, 0.35), rc('neck1', [0, 4.1, 3.3], [0, 4.52, 3.98], 0.52, 0.46, 0.25),
    el('head', [0, 4.63, 4.25], [0.42, 0.44, 0.52], 0.2), el('head', [0, 4.45, 4.38], [0.47, 0.34, 0.46], 0.2),
    rc('head', [0, 4.64, 4.45], [0, 4.4, 5.38], 0.37, 0.21, 0.2, { sx: 0.95 }),
    rc('jaw', [0, 4.2, 4.2], [0, 4.14, 5.25], 0.31, 0.15, 0.1, { sx: 1.1 }),
  ];
  for (const s of [1, -1]) {
    prims.push(el('head', [0.24 * s, 4.96, 4.45], [0.1, 0.07, 0.17], 0.08));
    prims.push(el('head', [0.34 * s, 4.83, 4.47], [0.05, 0.05, 0.05], 0.02, { col: 'eye', zoneBias: 0.02 }));
  }
  const tr = [0.74, 0.58, 0.42, 0.27, 0.14, 0.05];
  for (let i = 0; i < 5; i++) prims.push(rc('tail' + i, i ? tail[i] : [0, 3.85, -0.6], tail[i + 1], tr[i], tr[i + 1], i ? 0.2 : 0.45));
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    bones.push(['thigh' + S, 'pelvis', mir([0.6, 3.3, 0.1], s)], ['shin' + S, 'thigh' + S, mir([0.66, 2.0, 0.65], s)], ['foot' + S, 'shin' + S, mir([0.64, 0.75, -0.2], s)]);
    bones.push(['arm' + S, 'chest', mir([0.55, 3.1, 2.55], s)], ['fore' + S, 'arm' + S, mir([0.62, 2.72, 2.72], s)]);
    prims.push(el('thigh' + S, mir([0.54, 3.0, 0.2], s), [0.52, 0.98, 0.74], 0.35));
    prims.push(rc('thigh' + S, mir([0.6, 3.2, 0.1], s), mir([0.66, 2.0, 0.65], s), 0.52, 0.31, 0.3));
    prims.push(rc('shin' + S, mir([0.66, 2.0, 0.65], s), mir([0.64, 0.75, -0.2], s), 0.31, 0.16, 0.1));
    prims.push(rc('foot' + S, mir([0.64, 0.75, -0.2], s), mir([0.64, 0.13, 0.2], s), 0.14, 0.11, 0.06));
    for (const dx of [-0.16, 0, 0.16]) {
      prims.push(rc('foot' + S, mir([0.64, 0.12, 0.2], s), mir([0.64 + dx * 1.2, 0.06, 0.2 + (dx ? 0.5 : 0.62)], s), 0.1, 0.05, 0.04));
      prims.push(rc('foot' + S, mir([0.64 + dx * 1.2, 0.07, 0.2 + (dx ? 0.48 : 0.6)], s), mir([0.64 + dx * 1.3, 0.02, 0.2 + (dx ? 0.62 : 0.76)], s), 0.045, 0.012, 0.01, { col: 'claw', zoneBias: 0.01 }));
    }
    prims.push(rc('arm' + S, mir([0.5, 3.12, 2.55], s), mir([0.62, 2.72, 2.72], s), 0.14, 0.09, 0.1));
    prims.push(rc('fore' + S, mir([0.62, 2.72, 2.72], s), mir([0.56, 2.58, 3.0], s), 0.085, 0.06, 0.04));
    for (const dz of [0, 0.05]) prims.push(rc('fore' + S, mir([0.56, 2.58, 3.0], s), mir([0.52 + dz, 2.5, 3.14 + dz], s), 0.035, 0.015, 0.01, { col: 'claw' }));
  }
  const dors = lin('#4c4232'), vent = lin('#ab9a7c'), stripe = lin('#2e271e');
  return { bones, prims, color: (p, n, z) => {
    if (z?.col === 'eye') return [0.35, 0.18, 0.02];
    if (z?.col === 'claw') return lin('#2a2420');
    const d = smooth((n[1] + 0.35) / 0.9);
    let c = mix3(vent, dors, d);
    c = mix3(c, stripe, smooth((Math.sin(p[2] * 3.2 + NZ.noise2(p[1] * 2, p[2]) * 1.5) - 0.2) / 0.5) * d * 0.5);
    if (p[2] > 3.8) c = mix3(c, lin('#5e5040'), 0.4);
    const m = NZ.fbm2(p[0] * 1.5 + p[1], p[2] * 1.5, 3) * 0.5 + 0.5;
    return c.map((v) => v * (0.85 + 0.3 * m));
  } };
}

// ── Triceratops ────────────────────────────────────────────────────────────────────────────────────────────────
function triSpec() {
  const bones = [['pelvis', null, [0, 2.2, 0]], ['back', 'pelvis', [0, 2.3, 1.3]], ['chest', 'back', [0, 2.0, 2.4]],
    ['neck', 'chest', [0, 1.85, 3.0]], ['head', 'neck', [0, 1.85, 3.35]],
    ['tail0', 'pelvis', [0, 2.25, -0.9]], ['tail1', 'tail0', [0, 2.0, -2.2]], ['tail2', 'tail1', [0, 1.55, -3.4]]];
  const prims = [
    el('back', [0, 1.85, 1.2], [1.05, 0.95, 1.95], 0.4), el('pelvis', [0, 2.12, 0.0], [0.92, 0.76, 1.0], 0.4),
    el('chest', [0, 1.65, 2.3], [0.86, 0.76, 0.82], 0.35), rc('neck', [0, 1.8, 2.6], [0, 1.85, 3.35], 0.56, 0.46, 0.3),
    el('head', [0, 1.76, 3.9], [0.43, 0.5, 0.74], 0.15),
    rc('head', [0, 1.72, 4.2], [0, 1.26, 4.95], 0.34, 0.14, 0.15, { sx: 0.82 }),
    rc('head', [0, 1.3, 4.86], [0, 1.03, 5.16], 0.14, 0.025, 0.04, { col: 'beak', sx: 0.8 }),
    rc('head', [0, 1.56, 4.6], [0, 1.86, 4.76], 0.09, 0.022, 0.04, { col: 'horn', zoneBias: 0.02 }),
    el('head', [0, 1.42, 4.2], [0.33, 0.25, 0.55], 0.12),
    el('head', [0, 2.38, 3.32], [0.98, 0.82, 0.075], 0.12, { rx: -0.72, col: 'frill' }),
  ];
  for (const s of [1, -1]) {
    prims.push(rc('head', [0.2 * s, 2.08, 3.95], [0.31 * s, 2.62, 4.86], 0.11, 0.018, 0.05, { col: 'horn', zoneBias: 0.02 }));
    prims.push(el('head', [0.34 * s, 1.96, 4.0], [0.045, 0.045, 0.045], 0.015, { col: 'eye', zoneBias: 0.02 }));
  }
  for (let q = 0; q < 11; q++) {                   // epoccipitals round the frill margin
    const a = -Math.PI * 0.95 + q / 10 * Math.PI * 0.9 + Math.PI * 0.525;
    const lx = Math.cos(a) * 0.98, ly = Math.sin(a) * 0.82;
    const c = Math.cos(-0.72), sn = Math.sin(-0.72);
    prims.push(el('head', [lx, 2.38 + ly * c, 3.32 - ly * sn], [0.08, 0.08, 0.06], 0.04, { col: 'horn' }));
  }
  const tr = [0.56, 0.4, 0.22, 0.05];
  const tl = [[0, 2.25, -0.6], [0, 2.0, -2.2], [0, 1.55, -3.4], [0, 1.1, -4.5]];
  for (let i = 0; i < 3; i++) prims.push(rc('tail' + i, tl[i], tl[i + 1], tr[i], tr[i + 1], i ? 0.2 : 0.35));
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    bones.push(['thigh' + S, 'pelvis', mir([0.7, 2.05, 0.1], s)], ['shin' + S, 'thigh' + S, mir([0.75, 1.15, 0.45], s)], ['foot' + S, 'shin' + S, mir([0.75, 0.35, 0.0], s)]);
    bones.push(['upper' + S, 'chest', mir([0.75, 1.65, 2.55], s)], ['fore' + S, 'upper' + S, mir([0.95, 0.95, 2.35], s)], ['hand' + S, 'fore' + S, mir([0.9, 0.28, 2.6], s)]);
    prims.push(el('thigh' + S, mir([0.62, 1.78, 0.1], s), [0.36, 0.6, 0.5], 0.3));
    prims.push(rc('thigh' + S, mir([0.7, 2.0, 0.1], s), mir([0.75, 1.15, 0.45], s), 0.34, 0.2, 0.25));
    prims.push(rc('shin' + S, mir([0.75, 1.15, 0.45], s), mir([0.75, 0.35, 0.0], s), 0.2, 0.13, 0.08));
    prims.push(rc('foot' + S, mir([0.75, 0.35, 0.0], s), mir([0.76, 0.08, 0.3], s), 0.14, 0.12, 0.05));
    prims.push(el('foot' + S, mir([0.76, 0.07, 0.32], s), [0.2, 0.08, 0.25], 0.05));
    prims.push(rc('upper' + S, mir([0.72, 1.72, 2.55], s), mir([0.95, 0.95, 2.35], s), 0.3, 0.18, 0.25));
    prims.push(rc('fore' + S, mir([0.95, 0.95, 2.35], s), mir([0.9, 0.28, 2.6], s), 0.17, 0.12, 0.08));
    prims.push(rc('hand' + S, mir([0.9, 0.28, 2.6], s), mir([0.92, 0.06, 2.76], s), 0.12, 0.12, 0.05));
  }
  const dors = lin('#6f5f42'), vent = lin('#b8a684'), horn = lin('#cbbd9f'), beak = lin('#221c16');
  return { bones, prims, color: (p, n, z) => {
    if (z?.col === 'eye') return [0.01, 0.01, 0.01];
    if (z?.col === 'beak') return beak;
    if (z?.col === 'horn') { const tip = smooth((p[1] - 2.2) / 0.5); return mix3(horn, lin('#3a3228'), tip * 0.7); }
    if (z?.col === 'frill') {
      // display frill: dark rim band, rust fan, pale centre with two dark eye-spots
      const r = Math.hypot(p[0] / 0.98, (p[1] - 2.38) / 0.62);
      let c = mix3(lin('#b8a684'), lin('#7a5436'), smooth((r - 0.35) / 0.4));
      c = mix3(c, lin('#4a3626'), smooth((r - 0.82) / 0.12));
      const spot = Math.hypot(Math.abs(p[0]) - 0.45, p[1] - 2.62);
      c = mix3(c, lin('#4a3426'), smooth((0.14 - spot) / 0.06) * 0.7);
      return c;
    }
    const d = smooth((n[1] + 0.4) / 0.9);
    let c = mix3(vent, dors, d);
    const m = NZ.fbm2(p[0] * 2 + p[1], p[2] * 2, 3) * 0.5 + 0.5;
    return c.map((v) => v * (0.82 + 0.34 * m));
  } };
}

// ── Quetzalcoatlus (rigid body; wings are rebuilt every frame) ─────────────────────────────────────────────────
function quetzSpec() {
  const bones = [['body', null, [0, 0, 0]]];
  const prims = [
    el('body', [0, 0, 0], [0.23, 0.21, 0.5], 0.12), el('body', [0, 0.03, 0.3], [0.28, 0.24, 0.3], 0.12),
    rc('body', [0, 0.06, 0.45], [0, 0.2, 1.6], 0.13, 0.095, 0.1), rc('body', [0, 0.2, 1.6], [0, 0.14, 2.75], 0.095, 0.085, 0.06),
    el('body', [0, 0.14, 2.95], [0.1, 0.16, 0.3], 0.07),
    el('body', [0, 0.32, 2.88], [0.028, 0.15, 0.3], 0.04, { col: 'crest', zoneBias: 0.01 }),
    rc('body', [0, 0.12, 3.08], [0, -0.3, 4.95], 0.12, 0.01, 0.05, { col: 'beak', sx: 0.72 }),
    rc('body', [0, 0.02, 3.05], [0, -0.33, 4.8], 0.08, 0.01, 0.04, { col: 'beak', sx: 0.72 }),
    rc('body', [0, 0.0, -0.45], [0, 0.02, -0.72], 0.06, 0.02, 0.03),
  ];
  for (const s of [1, -1]) {
    prims.push(el('body', [0.085 * s, 0.2, 2.98], [0.025, 0.025, 0.025], 0.01, { col: 'eye', zoneBias: 0.01 }));
    prims.push(rc('body', [0.14 * s, -0.1, -0.35], [0.3 * s, -0.12, -0.95], 0.075, 0.05, 0.04));
    prims.push(rc('body', [0.3 * s, -0.12, -0.95], [0.42 * s, -0.1, -1.45], 0.05, 0.035, 0.03));
    prims.push(el('body', [0.22 * s, 0.08, 0.35], [0.12, 0.09, 0.12], 0.06));
  }
  const pale = lin('#d8d2c4'), dark = lin('#5a5048');
  return { bones, prims, color: (p, n, z) => {
    if (z?.col === 'eye') return [0.01, 0.01, 0.01];
    if (z?.col === 'crest') return lin('#b0492a');
    if (z?.col === 'beak') return mix3(lin('#cfc6b2'), lin('#2a2420'), smooth((p[2] - 4.0) / 0.9));
    return mix3(pale, dark, smooth((n[1] - 0.3) / 0.7) * 0.35);
  } };
}

// ── generic quadruped (horse, deer, wolf): horse proportions scaled per animal ──────────────────────────────────
function quadSpec(o) {
  const sw = o.sw ?? 1, sy = o.sy ?? 1, sz = o.sz ?? 1;
  const P = (x, y, z) => [x * sw, y * sy, z * sz];
  const bones = [['pelvis', null, P(0, 1.35, -0.55)], ['back', 'pelvis', P(0, 1.45, 0.0)], ['chest', 'back', P(0, 1.4, 0.55)]];
  const nu = o.neckUp ?? 1;                                           // >1: a more upright neck
  const n0 = P(0, 1.45, 0.8), n1 = P(0, 1.45 + 0.3 * nu, 1.05 + 0.02 / nu), hd = P(0, 1.45 + 0.57 * nu, 1.28 - 0.05 * (nu - 1));
  bones.push(['neck0', 'chest', n0], ['neck1', 'neck0', n1], ['head', 'neck1', hd]);
  bones.push(['tail0', 'pelvis', P(0, 1.42, -0.85)], ['tail1', 'tail0', P(0, 1.1, -0.98)]);
  const hs = o.head ?? 1;
  const prims = [
    el('back', P(0, 1.18, -0.02), [0.33 * sw * (o.belly ?? 1), 0.33 * sy, 0.62 * sz], 0.25),
    el('chest', P(0, 1.13, 0.5), [0.3 * sw, 0.33 * sy, 0.3 * sz], 0.22),
    el('pelvis', P(0, 1.3, -0.58), [0.31 * sw, 0.3 * sy, 0.33 * sz], 0.22),
    el('chest', P(0, 1.46, 0.42), [0.14 * sw, 0.15 * sy, 0.28 * sz], 0.14),
    rc('neck0', P(0, 1.3, 0.72), n1, 0.27 * (o.neckR ?? 1), 0.17 * (o.neckR ?? 1), 0.18, { sx: 0.62 }),
    rc('neck1', n1, [hd[0], hd[1] - 0.02, hd[2]], 0.17 * (o.neckR ?? 1), 0.12 * (o.neckR ?? 1), 0.1, { sx: 0.7 }),
  ];
  // head: poll -> muzzle, cheeks, ears
  const mz = [0, hd[1] - 0.5 * hs * (o.headDown ?? 1), hd[2] + 0.45 * hs * (o.snout ?? 1)];
  prims.push(el('head', [0, hd[1] - 0.1 * hs, hd[2] + 0.08 * hs], [0.1 * hs, 0.13 * hs, 0.14 * hs], 0.08));
  prims.push(rc('head', [0, hd[1] - 0.05 * hs, hd[2] + 0.06 * hs], mz, 0.11 * hs, 0.065 * hs * (o.muzzle ?? 1), 0.07, { sx: 0.95 }));
  prims.push(el('head', [mz[0], mz[1] + 0.01, mz[2] - 0.02], [0.07 * hs * (o.muzzle ?? 1), 0.075 * hs, 0.09 * hs], 0.05, { col: 'muzzle' }));
  for (const s of [1, -1]) {
    prims.push(rc('head', [0.055 * s * hs, hd[1] + 0.02, hd[2] - 0.01], [0.085 * s * hs * (o.earOut ?? 1), hd[1] + 0.17 * hs * (o.ear ?? 1), hd[2] - 0.04], 0.035 * hs * (o.earW ?? 1), 0.008, 0.02, { col: 'ear' }));
    prims.push(el('head', [0.085 * s * hs, hd[1] - 0.08 * hs, hd[2] + 0.12 * hs], [0.018, 0.018, 0.018], 0.008, { col: 'eye', zoneBias: 0.01 }));
  }
  if (o.mane) prims.push(rc('neck0', P(0, 1.6, 0.66), [0, hd[1] + 0.06, hd[2] - 0.06], 0.07, 0.05, 0.05, { sx: 0.45, col: 'mane', zoneBias: 0.02 }));
  if (o.antlers) {
    for (const s of [1, -1]) {
      const b0 = [0.05 * s, hd[1] + 0.06, hd[2] + 0.02], b1 = [0.2 * s, hd[1] + 0.4, hd[2] - 0.12], b2 = [0.3 * s, hd[1] + 0.72, hd[2] - 0.05];
      prims.push(rc('head', b0, b1, 0.03, 0.022, 0.015, { col: 'antler', zoneBias: 0.01 }), rc('head', b1, b2, 0.022, 0.012, 0.01, { col: 'antler', zoneBias: 0.01 }));
      prims.push(rc('head', [0.12 * s, hd[1] + 0.22, hd[2] - 0.04], [0.16 * s, hd[1] + 0.3, hd[2] + 0.18], 0.018, 0.008, 0.008, { col: 'antler', zoneBias: 0.01 }));
      prims.push(rc('head', [0.22 * s, hd[1] + 0.48, hd[2] - 0.1], [0.3 * s, hd[1] + 0.56, hd[2] + 0.1], 0.016, 0.007, 0.008, { col: 'antler', zoneBias: 0.01 }));
      prims.push(rc('head', b2, [0.36 * s, hd[1] + 0.8, hd[2] + 0.06], 0.012, 0.006, 0.006, { col: 'antler', zoneBias: 0.01 }));
    }
  }
  // tail
  const t0 = P(0, 1.42, -0.85), t1 = P(0, 1.1, -0.98), tt = P(0, o.tailEnd ?? 0.6, -1.0);
  if (o.tail === 'horse') { prims.push(rc('tail0', t0, t1, 0.06, 0.11, 0.05, { col: 'tail' }), rc('tail1', t1, tt, 0.11, 0.06, 0.05, { col: 'tail' })); }
  else if (o.tail === 'bushy') { prims.push(rc('tail0', t0, t1, 0.05, 0.1, 0.05, { col: 'tailtip' }), rc('tail1', t1, P(0, 0.75, -1.02), 0.1, 0.06, 0.05, { col: 'tailtip' })); }
  else prims.push(rc('tail0', t0, P(0, 1.3, -0.92), 0.06, 0.04, 0.04));
  // legs
  const LEG = o.leg ?? 1;
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    const hip = P(0.2 * s, 1.25, -0.62), stifle = P(0.2 * s, 0.95, -0.42), hock = P(0.2 * s, 0.55, -0.72), hfet = P(0.2 * s, 0.18, -0.66), hhoof = P(0.2 * s, 0.0, -0.62);
    const sh = P(0.19 * s, 1.15, 0.72), elbow = P(0.19 * s, 0.92, 0.58), knee = P(0.19 * s, 0.5, 0.63), ffet = P(0.19 * s, 0.18, 0.66), fhoof = P(0.19 * s, 0.0, 0.7);
    bones.push(['thigh' + S, 'pelvis', hip], ['shin' + S, 'thigh' + S, stifle], ['foot' + S, 'shin' + S, hock]);
    bones.push(['upper' + S, 'chest', sh], ['fore' + S, 'upper' + S, elbow], ['hand' + S, 'fore' + S, knee]);
    prims.push(el('thigh' + S, P(0.19 * s, 1.08, -0.6), [0.15 * sw, 0.3 * sy, 0.23 * sz], 0.16));
    prims.push(rc('thigh' + S, hip, stifle, 0.13 * LEG, 0.1 * LEG, 0.12));
    prims.push(rc('shin' + S, stifle, hock, 0.085 * LEG, 0.055 * LEG, 0.05));
    prims.push(rc('foot' + S, hock, hfet, 0.05 * LEG, 0.042 * LEG, 0.03, { col: 'lower' }));
    prims.push(rc('foot' + S, hfet, hhoof, 0.05 * LEG, 0.06 * LEG * (o.hoof ?? 1), 0.025, { col: o.paw ? 'lower' : 'hoof', zoneBias: 0.005 }));
    prims.push(el('upper' + S, P(0.18 * s, 1.02, 0.66), [0.12 * sw, 0.26 * sy, 0.17 * sz], 0.14));
    prims.push(rc('upper' + S, sh, elbow, 0.13 * LEG, 0.09 * LEG, 0.1));
    prims.push(rc('fore' + S, elbow, knee, 0.075 * LEG, 0.052 * LEG, 0.05));
    prims.push(rc('hand' + S, knee, ffet, 0.048 * LEG, 0.042 * LEG, 0.03, { col: 'lower' }));
    prims.push(rc('hand' + S, ffet, fhoof, 0.05 * LEG, 0.06 * LEG * (o.hoof ?? 1), 0.025, { col: o.paw ? 'lower' : 'hoof', zoneBias: 0.005 }));
  }
  const C = o.colors;
  return { bones, prims, color: (p, n, z) => {
    if (z?.col === 'eye') return [0.01, 0.008, 0.006];
    if (z?.col === 'hoof') return C.hoof;
    if (z?.col === 'mane' || z?.col === 'tail') return C.mane;
    if (z?.col === 'antler') return mix3(lin('#6a5a44'), lin('#d8cdb8'), smooth((p[1] - 1.9) / 0.6));
    if (z?.col === 'tailtip') return mix3(C.coat, C.dark || C.mane, smooth((0.95 - p[1]) / 0.25));
    if (z?.col === 'muzzle') return C.muzzle || mix3(C.coat, [0.02, 0.018, 0.016], 0.5);
    if (z?.col === 'ear' && C.ear) return C.ear;
    const d = smooth((n[1] + 0.3) / 0.9);
    let c = mix3(C.belly || C.coat, C.coat, d);
    if (C.lower && p[1] < 0.55 * sy) c = mix3(c, C.lower, smooth((0.55 * sy - p[1]) / (0.25 * sy)));
    if (z?.col === 'lower' && C.lower) c = C.lower;
    if (C.dapple) c = c.map((v) => v * (0.9 + 0.2 * smooth((NZ.noise2(p[0] * 9 + p[1] * 7, p[2] * 9) + 0.2) * 3)));
    const m = NZ.fbm2(p[0] * 3 + p[1] * 2, p[2] * 3, 3) * 0.5 + 0.5;
    return c.map((v) => v * (0.88 + 0.22 * m));
  } };
}
const HORSE_COATS = {
  bay: { coat: lin('#6b3a1c'), belly: lin('#7a4626'), mane: lin('#121010'), lower: lin('#161210'), hoof: lin('#2a2420') },
  chestnut: { coat: lin('#8a4a22'), belly: lin('#9a5a30'), mane: lin('#7a3a18'), hoof: lin('#3a3028'), lower: lin('#7a4020') },
  black: { coat: lin('#161414'), belly: lin('#1e1a18'), mane: lin('#0c0b0b'), hoof: lin('#222020'), lower: lin('#121010') },
  grey: { coat: lin('#a8a6a2'), belly: lin('#bdbab4'), mane: lin('#6a6864'), hoof: lin('#3a3632'), lower: lin('#5a5854'), dapple: true },
  white: { coat: lin('#d8d4cc'), belly: lin('#e0dcd4'), mane: lin('#c8c2b8'), hoof: lin('#5a5046'), lower: lin('#cfcac2') },
  dun: { coat: lin('#a88a5a'), belly: lin('#b89a6a'), mane: lin('#2a2016'), lower: lin('#2a2016'), hoof: lin('#2a2420') },
};
function horseSpec(color) { return quadSpec({ mane: true, tail: 'horse', colors: HORSE_COATS[color] || HORSE_COATS.bay }); }
function deerSpec(antlers) {
  return quadSpec({ sw: 0.72, sy: 0.82, sz: 0.72, neckUp: 1.35, neckR: 0.72, head: 0.72, headDown: 0.75, snout: 0.9, muzzle: 0.8, ear: 1.2, earW: 1.5, earOut: 1.6, leg: 0.62, hoof: 0.75, tail: 'short', antlers,
    colors: { coat: lin('#7a5234'), belly: lin('#b89a78'), mane: lin('#5a3a22'), lower: lin('#5a3c26'), hoof: lin('#1c1814'), muzzle: lin('#2a2018') } });
}
function wolfSpec() {
  return quadSpec({ sw: 0.62, sy: 0.55, sz: 0.62, neckUp: 0.55, neckR: 0.95, head: 0.62, headDown: 0.45, snout: 1.35, muzzle: 0.75, ear: 1.1, earW: 1.3, earOut: 1.0, leg: 0.62, belly: 1.05, tail: 'bushy', tailEnd: 0.45, paw: true, hoof: 0.9,
    colors: { coat: lin('#6e6860'), belly: lin('#b8b0a2'), mane: lin('#3a3632'), dark: lin('#1e1c1a'), lower: lin('#8a8276'), hoof: lin('#2a2622'), muzzle: lin('#2a2624'), ear: lin('#4a4440'), dapple: false } });
}

// ── humpback whale ──────────────────────────────────────────────────────────────────────────────────────────
function whaleSpec() {
  const bones = [['body', null, [0, 0, 0]], ['head', 'body', [0, 0.1, 3.2]], ['tail0', 'body', [0, 0, -2.2]], ['tail1', 'tail0', [0, 0.1, -4.4]], ['tail2', 'tail1', [0, 0.15, -6.0]], ['fluke', 'tail2', [0, 0.18, -6.9]],
    ['finL', 'body', [1.1, -0.4, 2.2]], ['finR', 'body', [-1.1, -0.4, 2.2]]];
  const prims = [
    el('head', [0, 0.05, 4.4], [1.15, 0.95, 2.6], 0.5), el('body', [0, 0, 0.8], [1.55, 1.45, 3.6], 0.6),
    rc('tail0', [0, 0.05, -1.4], [0, 0.12, -4.4], 1.25, 0.62, 0.45), rc('tail1', [0, 0.12, -4.4], [0, 0.16, -6.2], 0.62, 0.26, 0.2),
    el('fluke', [1.1, 0.18, -7.1], [1.25, 0.1, 0.55], 0.2, { ry: -0.35 }), el('fluke', [-1.1, 0.18, -7.1], [1.25, 0.1, 0.55], 0.2, { ry: 0.35 }),
    el('body', [0, 1.05, -2.6], [0.18, 0.32, 0.55], 0.2),
    el('head', [0, -0.55, 4.0], [1.05, 0.6, 2.6], 0.4, { col: 'throat' }),
  ];
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    prims.push(rc('fin' + S, [1.1 * s, -0.4, 2.2], [3.9 * s, -1.4, 0.4], 0.38, 0.14, 0.2, { sx: 1.0, col: 'fin' }));
    for (let q = 0; q < 6; q++) prims.push(el('head', [0.55 * s + (q % 2) * 0.2 * s, 0.75 - q * 0.05, 5.8 - q * 0.35], [0.1, 0.07, 0.1], 0.05, { col: 'knob' }));
    prims.push(el('head', [1.05 * s, 0.15, 3.2], [0.06, 0.06, 0.06], 0.02, { col: 'eye', zoneBias: 0.01 }));
  }
  const top = lin('#262a2e'), belly = lin('#c8c8c4');
  return { bones, prims, color: (p, n, z) => {
    if (z?.col === 'eye') return [0.01, 0.01, 0.01];
    if (z?.col === 'fin') return mix3(top, belly, smooth((-n[1] + 0.2) / 0.6) * 0.85 + 0.1);
    if (z?.col === 'throat') { const g = 0.5 + 0.5 * Math.sin(p[0] * 30); return mix3(belly, top, 0.25 + 0.2 * g); }
    const d = smooth((n[1] + 0.35) / 0.7);
    let c = mix3(belly, top, d);
    c = c.map((v) => v * (0.85 + 0.25 * (NZ.fbm2(p[0] * 2, p[2] * 2, 3) * 0.5 + 0.5)));
    if (NZ.noise2(p[0] * 4 + 7, p[2] * 4) > 0.55 && d < 0.7) c = mix3(c, belly, 0.6);           // barnacle scars
    return c;
  } };
}

function colorize(sc, spec) {
  const g = sc.geometry, P = g.attributes.position.array, N = g.attributes.normal.array;
  const col = new Float32Array(sc.nv * 3);
  for (let i = 0; i < sc.nv; i++) {
    const c = spec.color([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], sc.prims[sc.zone[i]]);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const MATS = {};
function skinned(ctx, o) {
  if (MATS[o.key]) return MATS[o.key];
  const m = skinMaterial(o);
  m.customProgramCacheKey = () => 'nature-skin-' + o.key;
  m.onBeforeCompile = (sh) => { SKIN_VERT(sh); SKIN_FRAG(sh, m.userData.skin); };
  MATS[o.key] = (ctx.patch || patchMaterial)(m) || m;
  return MATS[o.key];
}
// sculpted bodies are cached for the whole page (built once per job)
const SC = {};
function body(key) {
  if (SC[key]) return SC[key];
  const t0 = performance.now();
  let spec, h, sigma, relax = 3;
  switch (key) {
    case 'sauropod': spec = alamoSpec(); h = 0.085; sigma = 0.3; break;
    case 'theropod': spec = rexSpec(); h = 0.055; sigma = 0.16; break;
    case 'ceratopsian': spec = triSpec(); h = 0.045; sigma = 0.12; break;
    case 'pterosaur': spec = quetzSpec(); h = 0.022; sigma = 0.1; relax = 2; break;
    case 'whale': spec = whaleSpec(); h = 0.07; sigma = 0.3; break;
    case 'deer': spec = deerSpec(true); h = 0.016; sigma = 0.05; break;
    case 'hind': spec = deerSpec(false); h = 0.016; sigma = 0.05; break;
    case 'wolf': spec = wolfSpec(); h = 0.013; sigma = 0.04; break;
    default: { const c = key.split(':')[1] || 'bay'; spec = horseSpec(c); h = 0.02; sigma = 0.06; }
  }
  const sc = sculpt(spec, h, { sigma, relax }); colorize(sc, spec);
  SC[key] = sc;
  console.log('[nature.creatures] sculpted', key, Math.round(performance.now() - t0), 'ms', sc.nv, 'verts');
  return sc;
}
const MATOPT = {
  sauropod: { key: 'A', scale: 11, bump: 0.02, wrinkle: 0.5, roughness: 0.78, sheen: 0.35 },
  theropod: { key: 'R', scale: 16, bump: 0.012, wrinkle: 0.4, roughness: 0.7, sheen: 0.3 },
  ceratopsian: { key: 'T', scale: 18, bump: 0.01, wrinkle: 0.4, roughness: 0.74, sheen: 0.3 },
  pterosaur: { key: 'Q', scale: 40, bump: 0.004, wrinkle: 0.1, roughness: 0.85, sheen: 0.5 },
  whale: { key: 'W', scale: 6, bump: 0.01, wrinkle: 0.3, roughness: 0.45, sheen: 0.2 },
  horse: { key: 'H', scale: 70, bump: 0.0015, wrinkle: 0.15, roughness: 0.62, sheen: 0.35 },
  deer: { key: 'D', scale: 90, bump: 0.002, wrinkle: 0.2, roughness: 0.8, sheen: 0.3 },
  wolf: { key: 'F', scale: 120, bump: 0.003, wrinkle: 0.3, roughness: 0.9, sheen: 0.4 },
};

// ── gait maths ───────────────────────────────────────────────────────────────────────────────────────────────
const _e = new THREE.Euler();
function setRot(b, x = 0, y = 0, z = 0) { if (b) b.quaternion.setFromEuler(_e.set(x, y, z, 'YXZ')); }
function legIK(bones, names, H, K0, A0, A, bend) {
  const L1 = Math.hypot(K0[1] - H[1], K0[2] - H[2]), L2 = Math.hypot(A0[1] - K0[1], A0[2] - K0[2]);
  let dy = A[1] - H[1], dz = A[2] - H[2];
  let d = Math.hypot(dy, dz); const dmax = (L1 + L2) * 0.999, dmin = Math.abs(L1 - L2) + 0.01;
  if (d > dmax) { dy *= dmax / d; dz *= dmax / d; d = dmax; } else if (d < dmin) { dy *= dmin / d; dz *= dmin / d; d = dmin; }
  const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const th = Math.atan2(dz, dy) + bend * a;
  const ky = Math.cos(th) * L1, kz = Math.sin(th) * L1;
  const r1 = th - Math.atan2(K0[2] - H[2], K0[1] - H[1]);
  const r2 = Math.atan2(dz - kz, dy - ky) - Math.atan2(A0[2] - K0[2], A0[1] - K0[1]) - r1;
  setRot(bones[names[0]], r1); setRot(bones[names[1]], r2);
  return [r1, r2];
}
const headOf = (sc, n) => sc.boneDefs.find((d) => d[0] === n)[2];
// gaits: T cycle (s, at scale 1), beta duty factor, lift (m), leg phase offsets in LEGS order
const QUAD_LEGS = [['thighL', 'shinL', 'footL', 1, 'hind'], ['upperL', 'foreL', 'handL', -1, 'fore'], ['thighR', 'shinR', 'footR', 1, 'hind'], ['upperR', 'foreR', 'handR', -1, 'fore']];
const GAITS = {
  walk: { T: 1.1, beta: 0.64, lift: 0.14, off: [0, 0.25, 0.5, 0.75], bob: 0.015, pitch: 0.01 },
  trot: { T: 0.72, beta: 0.44, lift: 0.2, off: [0, 0.5, 0.5, 0], bob: 0.035, pitch: 0.015 },
  canter: { T: 0.62, beta: 0.4, lift: 0.26, off: [0.3, 0.6, 0, 0.3], bob: 0.06, pitch: 0.06 },
  gallop: { T: 0.46, beta: 0.32, lift: 0.3, off: [0, 0.32, 0.1, 0.42], bob: 0.08, pitch: 0.08 },
  run: { T: 0.5, beta: 0.34, lift: 0.28, off: [0, 0.32, 0.1, 0.42], bob: 0.07, pitch: 0.07 },
  bwalk: { T: 1.6, beta: 0.62, lift: 0.3, off: [0, 0.5], bob: 0.05, pitch: 0.01 },
  brun: { T: 0.95, beta: 0.4, lift: 0.55, off: [0, 0.5], bob: 0.12, pitch: 0.02 },
  swalk: { T: 3.3, beta: 0.68, lift: 0.36, off: [0, 0.25, 0.5, 0.75], bob: 0.03, pitch: 0.0 },
};
const SPEED = { horse: { walk: 1.6, trot: 3.6, canter: 6.5, gallop: 12 }, deer: { walk: 1.3, trot: 3, run: 9 }, wolf: { walk: 1.4, trot: 3.2, run: 9 },
  sauropod: { walk: 1.1 }, theropod: { walk: 2.2, run: 5.5 }, ceratopsian: { walk: 1.0, run: 3.5 } };

// a path's corners as circular arcs of radius R (smaller where the legs are short): an animal turns along a curve
function roundPath(P, R) {
  if (!(R > 0) || P.length < 3) return P;
  const out = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const A = out[out.length - 1], B = P[i], C = P[i + 1];
    const l1 = Math.hypot(B[0] - A[0], B[1] - A[1]), l2 = Math.hypot(C[0] - B[0], C[1] - B[1]);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const u1 = [(B[0] - A[0]) / l1, (B[1] - A[1]) / l1], u2 = [(C[0] - B[0]) / l2, (C[1] - B[1]) / l2];
    const cr = u1[0] * u2[1] - u1[1] * u2[0], phi = Math.acos(clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1));
    if (phi < 0.02) { out.push(B); continue; }
    const tn = Math.min(R * Math.tan(phi / 2), l1 * 0.5, l2 * 0.5), r = tn / Math.tan(phi / 2), sg = cr >= 0 ? 1 : -1;
    const T1 = [B[0] - u1[0] * tn, B[1] - u1[1] * tn], c = [T1[0] - u1[1] * sg * r, T1[1] + u1[0] * sg * r];
    const a0 = Math.atan2(T1[1] - c[1], T1[0] - c[0]), m = Math.max(2, Math.ceil(phi / (Math.PI / 16)));
    for (let k = 0; k <= m; k++) { const a = a0 + sg * phi * k / m; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  }
  out.push(P[P.length - 1]);
  return out;
}
// motion along a path / heading: t -> { x, z, hd (compass rad), v }. R: the turning radius at the path's corners.
// Along a path the heading is the path's own tangent, and the animal brakes smoothly into its end (it used to stop dead)
function motion(item, v, R = 0) {
  const at = item.at || [0, 0];
  const pts0 = Array.isArray(item.path) && item.path.length > 1 ? item.path.map((p) => [p[0], p[1]]) : null;
  if (!pts0 || v === 0) {
    const hd = (item.heading ?? 0) * Math.PI / 180;
    const sx = Math.sin(hd), sz = -Math.cos(hd);
    const t0 = item.t0 ?? 0;
    return (t) => ({ x: at[0] + sx * v * (t - t0), z: at[1] + sz * v * (t - t0), hd, v });
  }
  const pts = roundPath(pts0, R);
  const S = [0]; for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = S[S.length - 1];
  const posAt = (s) => {
    s = clamp(s, 0, L); let i = 0; while (i < S.length - 2 && S[i + 1] < s) i++;
    const f = (s - S[i]) / ((S[i + 1] - S[i]) || 1);
    return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)];
  };
  // constant deceleration over the last db metres (at most ~1.5 s of travel)
  const db = Math.min(L * 0.5, v * 1.5), acc = v * v / (2 * Math.max(1e-6, db)), tb = (L - db) / v;
  const w = Math.max(0.3, R * 0.2);
  return (t) => {
    let s, vv;
    if (t <= tb) { s = v * t; vv = v; }
    else { const u = Math.min(t - tb, v / acc); s = L - db + v * u - acc * u * u / 2; vv = Math.max(0, v - acc * u); }
    const p = posAt(s), a = posAt(Math.min(s, L - w) - w), b = posAt(Math.min(s, L - w) + w);
    return { x: p[0], z: p[1], hd: Math.atan2(b[0] - a[0], -(b[1] - a[1])), v: vv > 0.02 ? vv : 0 };
  };
}

// one ground animal: rig + gait state; returns update(t)
function groundAnimal(kind, sc, mat, o, ctx) {
  const r = rig(sc, mat);
  const s = o.scale ?? 1;
  r.root.scale.setScalar(s);
  r.root.rotation.order = 'YXZ';
  const b = r.bones;
  const quad = kind !== 'theropod';
  const legs = quad ? QUAD_LEGS : [['thighL', 'shinL', 'footL', 1, 'hind'], ['thighR', 'shinR', 'footR', 1, 'hind']];
  const rest = legs.map(([a, bb, c]) => [headOf(sc, a), headOf(sc, bb), headOf(sc, c)]);
  const bodyLen = Math.abs(rest[1][2][2] - rest[0][2][2]) || 4;
  const gh = ctx.ground?.height || (() => 0);
  const mot = o.motion;
  const G = o.gait;
  const self = { root: r.root, bones: b, rig: r, wx: 0, wz: 0, hd: 0, update: null };
  if (ctx.contacts && ctx.contacts.add) {
    const fp = o.footprint;
    ctx.contacts.add({ x: 0, z: 0, w: fp[0] * s * 1.3, l: fp[1] * s * 0.9, a: 0.5, owner: o.owner, fn: () => [self.wx, self.wz, Math.PI - self.hd] });
  }
  const tmp = new THREE.Vector3();
  function update(t) {
    const m = mot(t);
    self.wx = m.x; self.wz = m.z; self.hd = m.hd;
    const moving = m.v > 0.01;
    const T = G.T * Math.sqrt(s), ph = t / T + o.phase;
    const cy = Math.cos(Math.PI - m.hd), syaw = Math.sin(Math.PI - m.hd);
    // ground under the body, and the slope along it
    const fx = m.x + Math.sin(m.hd) * bodyLen * 0.5 * s, fz = m.z - Math.cos(m.hd) * bodyLen * 0.5 * s;
    const bx = m.x - Math.sin(m.hd) * bodyLen * 0.5 * s, bz = m.z + Math.cos(m.hd) * bodyLen * 0.5 * s;
    const hF = gh(fx, fz), hB = gh(bx, bz), h0 = (hF + hB) * 0.5;
    const pitch = -Math.atan2(hF - hB, bodyLen * s) * 0.9;
    const bob = moving ? Math.sin(ph * TAU * 2) * G.bob * s : 0;
    r.root.position.set(m.x, h0 + bob, m.z);
    const pitchT = pitch + (moving ? Math.sin(ph * TAU) * G.pitch : 0), cp = Math.cos(pitchT), sp = Math.sin(pitchT);
    r.root.rotation.set(pitchT, Math.PI - m.hd, 0);
    const Sst = moving ? m.v * G.beta * T / s : 0;                     // stride during stance, rest units
    legs.forEach(([n0, n1, n2, bend, kindL], li) => {
      const R = rest[li];
      let dz = 0, lift = 0;
      if (moving) {
        const f = ((ph + G.off[li]) % 1 + 1) % 1;
        if (f < G.beta) dz = Sst * (0.5 - f / G.beta);
        else {
          // the swing leaves and lands at the stance's speed (Hermite), so the foot is still in the world at lift-off and
          // touch-down (fix: a smoothstep swing touched down moving at the animal's full speed)
          const u = (f - G.beta) / (1 - G.beta), m = -Sst * (1 - G.beta) / G.beta, u2 = u * u, u3 = u2 * u;
          dz = (2 * u3 - 3 * u2 + 1) * (-0.5 * Sst) + (u3 - 2 * u2 + u) * m + (3 * u2 - 2 * u3) * (0.5 * Sst) + (u3 - u2) * m;
          lift = G.lift * Math.sin(Math.PI * u) / s;
        }
      }
      // the foot's target: over the terrain under it, in the body's pitched frame - the whole pitch (the slope AND the
      // gait's rocking) is undone exactly (fix: the rocking swung every planted foot ~5 cm back and forth at a run)
      const lx = R[2][0], lz = R[2][2] + dz;
      const wx = m.x + (cy * lx + syaw * lz) * s, wz = m.z + (-syaw * lx + cy * lz) * s;
      const Y = (gh(wx, wz) - h0 - bob) / s + R[2][1] + lift;
      const [r1, r2] = legIK(b, [n0, n1, n2], R[0], R[1], R[2], [R[2][0], Y * cp + lz * sp, -Y * sp + lz * cp], bend);
      // keep the cannon / foot upright; fold it during the swing (fore knees fold back, hind fetlocks flick)
      const fold = lift > 0 ? (kindL === 'fore' ? 1.1 : 0.45) * Math.min(1, lift * s / G.lift) * (quad ? 1 : 0.3) : 0;
      setRot(b[n2], -(r1 + r2) - pitchT + fold);
    });
    o.pose(b, t, ph, moving, m);
  }
  self.update = update;
  // foot soles in world space, one point per leg (locomotion QA: a planted foot keeps still)
  const _fw = new THREE.Vector3();
  self.feet = () => legs.map(([, , n2], li) => { b[n2].getWorldPosition(_fw); return [[_fw.x, _fw.y - rest[li][2][1] * s, _fw.z]]; });
  return self;
}

// ── per-species poses (neck, head, tail, jaw) ──────────────────────────────────────────────────────────────
function posesFor(kind, action, R) {
  const look = (R() - 0.5) * 0.4, ph0 = R() * 10;
  switch (kind) {
    case 'sauropod': return (b, t, ph, moving) => {
      const graze = action === 'graze';
      for (let i = 0; i < 6; i++) setRot(b['neck' + i], (graze ? [0.35, 0.35, 0.3, 0.25, 0.2, 0.1][i] : 0.03) + 0.012 * Math.sin(ph * TAU * 2 + i * 0.4), (look * (0.3 + i * 0.12) + 0.03 * Math.sin(t * 0.4 + ph0 - i * 0.45)) / 2.2, 0);
      setRot(b.head, (graze ? 0.4 : -0.05) + 0.04 * Math.sin(t * 0.9 + ph0), 0.08 * Math.sin(t * 0.6 + ph0), 0);
      for (let i = 0; i < 6; i++) setRot(b['tail' + i], 0.01 * Math.sin(ph * TAU * 2 - i * 0.5) - 0.012, 0.05 * Math.sin(ph * TAU - i * 0.55 + 0.4), 0);
      setRot(b.pelvis, 0, moving ? Math.sin(ph * TAU) * 0.015 : 0, moving ? Math.sin(ph * TAU) * 0.025 : 0);
    };
    case 'theropod': return (b, t, ph, moving) => {
      const br = Math.sin(t * 1.7 + ph0), roar = action === 'roar' ? smooth((Math.sin(t * 0.7 + ph0) - 0.2) / 0.6) : 0;
      setRot(b.back, -0.02 + br * 0.008); setRot(b.chest, -0.015 + br * 0.012);
      setRot(b.neck0, -0.1 - roar * 0.25, -0.08 + 0.04 * Math.sin(t * 0.5 + ph0)); setRot(b.neck1, -0.12 - roar * 0.2, look * 0.5 + 0.05 * Math.sin(t * 0.5 + 0.4));
      setRot(b.head, 0.12 - roar * 0.35 + 0.02 * Math.sin(t * 0.8), -0.12 + 0.06 * Math.sin(t * 0.5 + 0.8), 0.03);
      setRot(b.jaw, 0.1 + 0.03 * Math.sin(t * 1.7) + roar * 0.55);
      for (let i = 0; i < 5; i++) setRot(b['tail' + i], -0.035 + 0.01 * Math.sin(t * 0.9 - i * 0.5), (moving ? 0.07 * Math.sin(ph * TAU - i * 0.6) : 0.05 * Math.sin(t * 0.55 - i * 0.6)), 0);
      setRot(b.armL, 0.3, 0, 0.1); setRot(b.armR, 0.25, 0, -0.1); setRot(b.foreL, -0.6); setRot(b.foreR, -0.7);
      setRot(b.pelvis, moving ? 0.02 : 0.02, moving ? Math.sin(ph * TAU) * 0.04 : 0, moving ? Math.sin(ph * TAU) * 0.03 : 0.015);
    };
    case 'ceratopsian': return (b, t, ph, moving) => {
      const w = t * 1.3 + ph0, graze = action === 'graze' || action === 'idle';
      setRot(b.neck, (graze ? 0.28 : 0.05) + 0.05 * Math.sin(w * 0.7), 0.1 * Math.sin(w * 0.4), 0);
      setRot(b.head, (graze ? 0.38 : 0.05) + 0.06 * Math.sin(w * 2.1), 0.08 * Math.sin(w * 0.9), 0.04 * Math.sin(w * 0.6));
      setRot(b.chest, graze ? 0.05 : 0);
      for (let i = 0; i < 3; i++) setRot(b['tail' + i], -0.02, 0.06 * Math.sin((moving ? ph * TAU : w * 0.8) - i * 0.7), 0);
    };
    default: return (b, t, ph, moving, m) => {                        // horse, deer, wolf
      const graze = action === 'graze' && !moving, fast = /gallop|run|canter/.test(action) && moving;
      const nod = moving ? Math.sin(ph * TAU * (fast ? 1 : 2) + 0.6) * (fast ? 0.12 : 0.05) : 0;
      const gz = graze ? 1 : 0;
      setRot(b.neck0, gz * 0.95 + (fast ? 0.3 : 0.05) + nod * 0.6 + 0.02 * Math.sin(t * 0.5 + ph0), look * 0.4 * (1 - gz) + (graze ? 0.1 * Math.sin(t * 0.3 + ph0) : 0), 0);
      setRot(b.neck1, gz * 0.55 + (fast ? 0.2 : 0) + nod * 0.4, look * 0.3, 0);
      setRot(b.head, gz * 0.2 - (fast ? 0.25 : 0) + (graze ? 0.08 * Math.sin(t * 2.3 + ph0) : 0.03 * Math.sin(t * 0.8 + ph0)), look * 0.3, 0);
      setRot(b.tail0, (fast ? -0.7 : moving ? -0.2 : 0) + 0.05 * Math.sin(t * 1.1 + ph0), 0.12 * Math.sin(t * 0.9 + ph0), 0);
      setRot(b.tail1, fast ? -0.35 : 0, 0.1 * Math.sin(t * 1.3 + ph0 + 1), 0);
      setRot(b.back, moving ? Math.sin(ph * TAU) * 0.02 : 0);
    };
  }
}

// ── builders ─────────────────────────────────────────────────────────────────────────────────────────────────
function herdLayout(item, n, R, spacing) {
  const out = [];
  const size = [].concat(item.size ?? [Math.sqrt(n) * spacing * 1.6]);
  const sx = size[0], sz = size[1] ?? sx;
  for (let i = 0; i < n; i++) {
    if (n === 1) { out.push([0, 0]); continue; }
    let best = null;
    for (let k = 0; k < 20; k++) {                                     // rejection sampling keeps animals apart
      const c = [(R() - 0.5) * sx, (R() - 0.5) * sz];
      if (out.every((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) > spacing)) { best = c; break; }
      if (!best) best = c;
    }
    out.push(best);
  }
  return out;
}

async function buildGround(kind, item, ctx) {
  const p = Object.assign({}, CATALOG[kind]?.params || {}, item.params || {});
  const species = kind.split('.')[1];
  let action = ALIAS_ACTION[item.action] || item.action || (species === 'ceratopsian' ? 'graze' : 'walk');
  const R = rng((item.seed ?? 7) * 131 + species.length);
  const n = Math.max(1, Math.min(40, item.count ?? p.count ?? 1));
  let key = species;
  if (species === 'horse') key = 'horse:' + (item.color || p.color || 'bay');
  if (species === 'deer' && (item.antlers === false || p.antlers === false)) key = 'hind';
  const sc = body(key);
  const mo = MATOPT[species] || MATOPT.horse;
  const mat = skinned(ctx, mo);
  // gait for the action
  const quad = species !== 'theropod';
  let gname = 'walk';
  if (species === 'sauropod') gname = 'swalk';
  else if (species === 'theropod') gname = action === 'run' ? 'brun' : 'bwalk';
  else if (['trot', 'canter', 'gallop', 'run'].includes(action)) gname = action;
  const moving = !['idle', 'graze', 'roar'].includes(action);
  const sp = SPEED[species] || {};
  const v = moving ? (item.speed ?? (sp[action] ?? sp.walk ?? p.speed ?? 1.5)) : 0;
  const root = new THREE.Group(); root.name = kind;
  const hd = (item.heading ?? 0);
  const spacing = { sauropod: 12, theropod: 8, ceratopsian: 6, horse: 2.6, deer: 2.2, wolf: 1.6 }[species] || 3;
  const lay = herdLayout(item, n, R, spacing);
  const animals = [];
  const at = item.at || [0, 0];
  const fp = CATALOG[kind].footprint;
  for (let i = 0; i < n; i++) {
    const [lx, lz] = lay[i];
    const h = hd * Math.PI / 180, cx = Math.cos(h), sx = Math.sin(h);
    const off = [lx * cx - lz * sx, lx * sx + lz * cx];
    const scl = (item.scale ?? p.scale ?? 1) * (n > 1 ? (species === 'sauropod' && i >= Math.ceil(n * 0.6) ? 0.5 : 0.9 + R() * 0.2) : 1);
    const sub = { ...item, at: [at[0] + off[0], at[1] + off[1]], heading: hd + (n > 1 ? (R() - 0.5) * 12 : 0), path: item.path ? item.path.map((q) => [q[0] + off[0], q[1] + off[1]]) : null };
    const A = groundAnimal(species, sc, mat, { scale: scl, phase: R(), gait: GAITS[gname], motion: motion(sub, v * (n > 1 ? 1 : 1), ({ sauropod: 12, theropod: 6, ceratopsian: 4, horse: 3, deer: 2.5, wolf: 1.5 }[species] ?? 3) * scl), pose: posesFor(species, action, R), footprint: fp, owner: null }, ctx);
    root.add(A.root);
    animals.push(A);
  }
  // rider slot: a saddle anchor on the first horse's back
  const anchors = {};
  if (species === 'horse') {
    const A0 = animals[0];
    const saddle = new THREE.Object3D(); saddle.name = 'saddle';
    const bh = headOf(sc, 'back');
    saddle.position.set(0, 1.62 - bh[1], 0.05 - bh[2]);
    A0.bones.back.add(saddle);
    anchors.saddle = saddle;
    if (item.saddle || p.saddle || item.rider) {
      const sm = (ctx.patch || patchMaterial)(new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.6 }));
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.5, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1.25, 0.35, 1), sm);
      seat.position.set(0, -0.06, 0); seat.castShadow = true; saddle.add(seat);
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.62), (ctx.patch || patchMaterial)(new THREE.MeshStandardMaterial({ color: new THREE.Color(item.cloth || '#23305a'), roughness: 0.9 })));
      cloth.position.set(0, -0.26, 0); cloth.castShadow = true; saddle.add(cloth);
    }
  }
  root.userData.creature = species;
  // the group's root travels with its animals (the core's cameras and QA track the root); animals sit relative to it
  const update = (t) => {
    let cx = 0, cz = 0;
    for (const A of animals) { A.update(t); cx += A.wx; cz += A.wz; }
    cx /= animals.length; cz /= animals.length;
    root.position.set(cx, 0, cz);
    for (const A of animals) { A.root.position.x -= cx; A.root.position.z -= cz; }
  };
  update(0);
  // locomotion QA (core/loco.js): each animal's position, facing and planted feet
  const loco = moving ? { kind, walkers: (t) => { update(t); root.updateMatrixWorld(true); return animals.map((A) => ({ x: A.wx, z: A.wz, yaw: Math.PI - A.hd, feet: A.feet() })); } } : undefined;
  return { root, radius: n > 1 ? Math.max(4, spacing * Math.sqrt(n)) : fp[1] * 0.5, height: CATALOG[kind].height, snapped: true, contact: ctx.contacts ? undefined : false, update, anchors, animals, ...(loco ? { loco } : {}) };
}

async function buildPterosaur(kind, item, ctx) {
  const p = Object.assign({}, CATALOG[kind].params, item.params || {});
  const sc = body('pterosaur');
  const mat = skinned(ctx, MATOPT.pterosaur);
  const wingMat = (() => {
    if (MATS.wing) return MATS.wing;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, envMapIntensity: 0.4 });
    m.customProgramCacheKey = () => 'nature-wing';
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir2 = U.uSunDir; shader.uniforms.uSunCol2 = U.uSunColor;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos2; varying vec3 vWN2;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos2 = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN2 = mat3(modelMatrix) * objectNormal;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSunDir2; uniform vec3 uSunCol2; varying vec3 vWPos2; varying vec3 vWN2;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          { vec3 Vw = normalize(cameraPosition - vWPos2); float back = pow(saturate(dot(-Vw, uSunDir2)), 3.0);
            float th = 1.0 - abs(dot(normalize(vWN2), Vw));
            reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunCol2 * vec3(1.0, 0.78, 0.55) * (0.12 + 1.0 * back) * (0.6 + 0.4 * th) * 0.8; }`);
    };
    return (MATS.wing = (ctx.patch || patchMaterial)(m) || m);
  })();
  const NU = 44, NV = 8, RING = 7;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function makeWingGeo() {
    const nMem = (NU + 1) * (NV + 1), nTube = (NU + 1) * RING;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((nMem + nTube) * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array((nMem + nTube) * 3), 3));
    const col = new Float32Array((nMem + nTube) * 3), idx = [];
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    for (let i = 0; i < NU; i++) for (let k = 0; k < RING; k++) { const a = nMem + i * RING + k, b = nMem + i * RING + (k + 1) % RING, c = a + RING, d = b + RING; idx.push(a, b, c, b, d, c); }
    const memA = lin('#3a302a'), memB = lin('#5a4a3c'), bone = lin('#8a8070');
    for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
      const u = i / NU, v = j / NV, k = (i * (NV + 1) + j) * 3, fib = 0.85 + 0.15 * Math.sin(u * 140 + v * 6);
      const c = mix3(memB, memA, smooth(v * 1.2) * 0.6 + u * 0.3).map((x) => x * fib * (v > 0.93 ? 0.7 : 1));
      col[k] = c[0]; col[k + 1] = c[1]; col[k + 2] = c[2];
    }
    for (let q = nMem; q < nMem + nTube; q++) { col[q * 3] = bone[0]; col[q * 3 + 1] = bone[1]; col[q * 3 + 2] = bone[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
    return g;
  }
  function wingPts(side, flap, fold) {
    const s = side, dih = 0.12 + flap * 0.62, tipLag = -flap * 0.35 * (1 - fold);
    const rot = (q, o, a) => { const x = q.x - o.x, y = q.y - o.y; return V(o.x + x * Math.cos(a) - y * Math.sin(a) * s, o.y + x * Math.sin(a) * s + y * Math.cos(a), q.z); };
    const S = V(0.2 * s, 0.1, 0.36);
    let E = V(S.x + 0.55 * s, S.y, S.z - 0.14 - fold * 0.2), Wr = V(E.x + (0.95 - fold * 0.35) * s, E.y, E.z + 0.28 + fold * 0.4);
    let K = V(Wr.x + (1.05 - fold * 0.3) * s, Wr.y, Wr.z - 0.04), T = V(K.x + (2.5 - fold * 1.1) * s, K.y, K.z - 0.62 - fold * 0.9);
    [E, Wr, K, T] = [E, Wr, K, T].map((q) => rot(q, S, dih));
    K = rot(K, Wr, tipLag * 0.4); T = rot(rot(T, Wr, tipLag * 0.4), K, tipLag);
    return { S, E, Wr, K, T, A: V(0.43 * s, -0.1, -1.45) };
  }
  function buildWing(g, side, flap, fold) {
    const P = g.attributes.position.array, nMem = (NU + 1) * (NV + 1), w = wingPts(side, flap, fold);
    const lead = [w.S, w.E, w.Wr, w.K, w.T], segL = [0, w.S.distanceTo(w.E), w.E.distanceTo(w.Wr), w.Wr.distanceTo(w.K), w.K.distanceTo(w.T)];
    const tot = segL.reduce((a, b2) => a + b2, 0);
    const leadAt = (u) => { let d = u * tot; for (let i = 1; i < 5; i++) { if (d <= segL[i] || i === 4) return lead[i - 1].clone().lerp(lead[i], clamp(d / segL[i])); d -= segL[i]; } return w.T.clone(); };
    for (let i = 0; i <= NU; i++) {
      const u = i / NU, L = leadAt(u), Tr = w.A.clone().lerp(w.T, Math.pow(u, 0.9));
      Tr.add(L.clone().sub(Tr).multiplyScalar(0.22 * Math.sin(Math.PI * u)));
      for (let j = 0; j <= NV; j++) {
        const v = j / NV, q = L.clone().lerp(Tr, v);
        q.y -= 0.1 * Math.sin(Math.PI * v) * Math.sin(Math.PI * Math.min(1, u * 1.2)) * (0.6 - flap * 0.4);
        const k = (i * (NV + 1) + j) * 3; P[k] = q.x; P[k + 1] = q.y; P[k + 2] = q.z;
      }
      const r = lerp(0.07, 0.015, u);
      const tng = leadAt(Math.min(1, u + 0.02)).sub(leadAt(Math.max(0, u - 0.02))).normalize();
      const bn = tng.clone().cross(V(0, 1, 0)).normalize(), nn = bn.clone().cross(tng).normalize();
      for (let q = 0; q < RING; q++) { const a = q / RING * TAU; const pp = L.clone().addScaledVector(bn, Math.cos(a) * r).addScaledVector(nn, Math.sin(a) * r); const k = (nMem + i * RING + q) * 3; P[k] = pp.x; P[k + 1] = pp.y; P[k + 2] = pp.z; }
    }
    g.attributes.position.needsUpdate = true; g.computeVertexNormals();
  }
  const root = new THREE.Group(); root.name = kind;
  const n = Math.max(1, Math.min(8, item.count ?? p.count ?? 1));
  const R = rng((item.seed ?? 3) * 71);
  const at = item.at || [0, 0], gh = ctx.ground?.height || (() => 0);
  const alt = item.altitude ?? p.altitude ?? 40, rad = item.radius ?? p.radius ?? 80, speed = item.speed ?? p.speed ?? 14;
  const mode = item.path ? 'path' : (item.action === 'fly' && item.heading != null && !item.radius ? 'line' : 'circle');
  const qz = [];
  for (let i = 0; i < n; i++) {
    const r = rig(sc, mat);
    const wings = [1, -1].map(() => { const m = new THREE.Mesh(makeWingGeo(), wingMat); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; r.root.add(m); return m; });
    r.root.scale.setScalar(item.scale ?? 1);
    root.add(r.root);
    qz.push({ r, wings, ph: R() * 10, dr: (R() - 0.5) * rad * 0.5, dy: (R() - 0.5) * 12, dir: R() < 0.5 ? 1 : 1, glide: action(item) === 'glide' ? 0.8 : 0.35 + R() * 0.3 });
  }
  function action(it) { return it.action || 'fly'; }
  const mot = mode === 'path' ? motion(item, speed, 25) : null;
  const cy = gh(at[0], at[1]);
  function update(t) {
    for (const q of qz) {
      let pos, vel;
      if (mode === 'circle') {
        const w = speed / (rad + q.dr), a = q.ph + w * t;
        pos = V(at[0] + Math.cos(a) * (rad + q.dr), cy + alt + q.dy + 3 * Math.sin(t * 0.4 + q.ph), at[1] + Math.sin(a) * (rad + q.dr));
        vel = V(-Math.sin(a) * speed, 1.2 * Math.cos(t * 0.4 + q.ph), Math.cos(a) * speed);
      } else {
        const m = mot ? mot(t) : null;
        const h = (item.heading ?? 0) * Math.PI / 180;
        const x = m ? m.x : at[0] + Math.sin(h) * speed * t + q.dr * 0.3, z = m ? m.z : at[1] - Math.cos(h) * speed * t + q.dy;
        const hh = m ? m.hd : h;
        pos = V(x, Math.max(gh(x, z) + 6, cy + alt + q.dy * 0.3) + 2 * Math.sin(t * 0.5 + q.ph), z);
        vel = V(Math.sin(hh) * speed, Math.cos(t * 0.5 + q.ph), -Math.cos(hh) * speed);
      }
      const root2 = q.r.root;
      root2.position.copy(pos);
      root2.rotation.order = 'YXZ';
      root2.rotation.set(-Math.atan2(vel.y, Math.hypot(vel.x, vel.z)) * 0.6, Math.atan2(vel.x, vel.z), mode === 'circle' ? -0.35 : 0.05 * Math.sin(t * 0.7 + q.ph));
      const flapT = t / 1.25 + q.ph, ph = flapT * TAU;
      const g = q.glide * (0.5 + 0.5 * smooth((Math.sin(t * 0.35 + q.ph) + 0.3) / 0.6));
      const flap = (1 - g) * Math.cos(ph) * 0.95 + g * 0.12 * Math.cos(ph);
      const fold = (1 - g) * Math.max(0, Math.sin(ph)) * 0.35;
      buildWing(q.wings[0].geometry, 1, flap, fold); buildWing(q.wings[1].geometry, -1, flap, fold);
    }
  }
  update(0);
  return { root, radius: 8, height: 3, snapped: true, contact: false, update, anchors: {} };
}

async function buildWhale(kind, item, ctx) {
  const sc = body('whale');
  const mat = skinned(ctx, MATOPT.whale);
  const r = rig(sc, mat);
  const root = new THREE.Group(); root.name = kind; root.add(r.root);
  r.root.rotation.order = 'YXZ';
  const s = item.scale ?? 1; r.root.scale.setScalar(s);
  const level = ctx.ground?.water?.level ?? ctx.water?.level ?? ctx.ground?.level ?? 0;
  const v = item.speed ?? 2.5, depth = item.depth ?? 1.2;
  const mot = motion(item, v, 30);
  const TS = 11;                                                        // surfacing period
  const W = [ctx.ground?.water, ctx.water].find((w) => w && typeof w.splash === 'function') || null;
  if (W) {
    for (let k = 0; k < 3; k++) { const m = mot(k * TS + 0.2); W.splash(m.x, m.z, k * TS + 0.2, 2.2); }
    W.addWake((t) => { const m = mot(t); const u = 0.5 + 0.5 * Math.cos(t / TS * TAU); return { x: m.x, z: m.z, dx: Math.sin(m.hd), dz: -Math.cos(m.hd), strength: 0.8 * smooth((u - 0.4) / 0.5), length: 40 }; });
  }
  const b = r.bones;
  function update(t) {
    const m = mot(t);
    const u = 0.5 + 0.5 * Math.cos(t / TS * TAU);                        // 1 at the surface
    const y = level - depth - 2.2 * (1 - u) + 0.35 * u;
    const pitch = Math.sin(t / TS * TAU) * 0.12;
    r.root.position.set(m.x, y, m.z);
    r.root.rotation.set(pitch, Math.PI - m.hd, 0.03 * Math.sin(t * 0.3));
    const w = TAU / 3.6;
    setRot(b.tail0, 0.06 * Math.sin(w * t)); setRot(b.tail1, 0.14 * Math.sin(w * t - 0.7)); setRot(b.tail2, 0.2 * Math.sin(w * t - 1.3)); setRot(b.fluke, 0.25 * Math.sin(w * t - 1.9));
    setRot(b.head, -0.03 * Math.sin(w * t + 0.4));
    setRot(b.finL, 0, 0, 0.12 * Math.sin(t * 0.5) - 0.1); setRot(b.finR, 0, 0, -0.12 * Math.sin(t * 0.5) + 0.1);
  }
  update(0);
  return { root, radius: 8 * s, height: 3, snapped: true, contact: false, update, anchors: {},
    loco: { kind, walkers: (t) => { const m = mot(t); return [{ x: m.x, z: m.z, yaw: Math.PI - m.hd }]; } } };
}

// ── instanced flocks and shoals ────────────────────────────────────────────────────────────────────────────
function birdGeometry() {
  // body along +Z, wings along X (attribute aWing: signed span position -1..1 for the flap), tail
  const pos = [], wing = [], idx = [];
  const v = (x, y, z, w) => { pos.push(x, y, z); wing.push(w); return pos.length / 3 - 1; };
  const nb = [v(0, 0, 0.2, 0), v(0.045, 0, 0, 0), v(0, 0.04, 0, 0), v(-0.045, 0, 0, 0), v(0, -0.035, 0, 0), v(0, 0, -0.22, 0), v(0, 0.012, 0.28, 0)];
  idx.push(nb[0], nb[1], nb[2], nb[0], nb[2], nb[3], nb[0], nb[3], nb[4], nb[0], nb[4], nb[1], nb[5], nb[2], nb[1], nb[5], nb[3], nb[2], nb[5], nb[4], nb[3], nb[5], nb[1], nb[4], nb[6], nb[2], nb[0]);
  for (const s of [1, -1]) {
    const a = v(0.03 * s, 0.01, 0.07, 0.05 * s), b = v(0.03 * s, 0.01, -0.07, 0.05 * s), c = v(0.28 * s, 0.03, 0.02, 0.55 * s), d = v(0.26 * s, 0.03, -0.1, 0.55 * s), e = v(0.5 * s, 0.02, -0.08, 1.0 * s);
    idx.push(a, c, b, b, c, d, c, e, d);
  }
  const t1 = v(0, 0.005, -0.18, 0), t2 = v(0.07, 0.005, -0.3, 0), t3 = v(-0.07, 0.005, -0.3, 0);
  idx.push(t1, t2, t3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function fishGeometry() {
  const g = new THREE.SphereGeometry(1, 10, 6); g.scale(0.05, 0.08, 0.26);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.22, 0, 0.09, -0.36, 0, -0.09, -0.36], 3)); tail.setIndex([0, 1, 2]);
  g.deleteAttribute('uv');
  const merged = new THREE.BufferGeometry();
  const p1 = g.attributes.position.array, p2 = tail.attributes.position.array;
  merged.setAttribute('position', new THREE.Float32BufferAttribute([...p1, ...p2], 3));
  const i1 = [...g.index.array], off = p1.length / 3;
  merged.setIndex([...i1, off, off + 1, off + 2]);
  merged.computeVertexNormals();
  return merged;
}
function flapMaterial(ctx, key, o) {
  if (MATS[key]) return MATS[key];
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: o.roughness ?? 0.8, metalness: o.metal ?? 0, side: THREE.DoubleSide });
  m.customProgramCacheKey = () => 'nature-' + key;
  const U2 = { uFT: { value: 0 } };
  m.userData.u = U2;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFT = U2.uFT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uFT; ${o.bird ? 'attribute float aWing;' : ''} attribute vec2 iAnim;`)
      .replace('#include <begin_vertex>', o.bird ? `#include <begin_vertex>
        { float ph = uFT * iAnim.x + iAnim.y * 6.2831;
          float amp = mix(0.08, 0.9, smoothstep(-0.2, 0.3, sin(uFT * 0.37 + iAnim.y * 17.0)));
          float a = sin(ph) * amp * sign(aWing) * 0.9;
          float r = abs(aWing) * 0.5;
          transformed.y += sin(a) * r * 1.0 + abs(aWing) * sin(ph + 1.2) * amp * 0.06;
          transformed.x -= (1.0 - cos(a)) * r * sign(aWing); }` : `#include <begin_vertex>
        { float ph = uFT * iAnim.x + iAnim.y * 6.2831;
          float k = smoothstep(0.05, -0.36, transformed.z);
          transformed.x += sin(ph - transformed.z * 12.0) * 0.06 * k; }`);
  };
  return (MATS[key] = (ctx.patch || patchMaterial)(m) || m);
}
async function buildFlock(kind, item, ctx) {
  const p = Object.assign({}, CATALOG[kind].params, item.params || {});
  const bird = kind === 'creature.bird_flock';
  const n = Math.max(1, Math.min(bird ? 400 : 600, item.count ?? p.count));
  const geo = bird ? birdGeometry() : fishGeometry();
  const mat = flapMaterial(ctx, bird ? 'bird' : 'fish', bird ? { roughness: 0.85, bird: true } : { roughness: 0.35, metal: 0.6 });
  const im = new THREE.InstancedMesh(geo, mat, n);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const anim = new Float32Array(n * 2);
  const R = rng((item.seed ?? 5) * 313 + n);
  const col = new THREE.Color();
  const white = (item.color || p.color) === 'white' || (item.color || p.color) === 'gull';
  for (let i = 0; i < n; i++) {
    anim[i * 2] = bird ? 9 + R() * 5 : 7 + R() * 5; anim[i * 2 + 1] = R();
    if (bird) col.setRGB(...(white ? [0.8, 0.8, 0.78] : [0.035, 0.034, 0.036]).map((c) => c * (0.85 + R() * 0.3))); else col.setRGB(0.55, 0.58, 0.6);
    im.setColorAt(i, col);
  }
  geo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(anim, 2));
  im.castShadow = bird; im.receiveShadow = false; im.frustumCulled = false; im.name = kind;
  const root = new THREE.Group(); root.name = kind; root.add(im);
  root.userData.noQA = true;
  const at = item.at || [0, 0], gh = ctx.ground?.height || (() => 0);
  const level = ctx.water?.level ?? 0;
  const alt = item.altitude ?? p.altitude, rad = item.radius ?? p.radius, speed = item.speed ?? p.speed;
  const scale = item.scale ?? (bird ? (white ? 1.6 : 1.0) : 1);
  const cy = bird ? gh(at[0], at[1]) + alt : level - (item.depth ?? p.depth);
  const B = [];
  for (let i = 0; i < n; i++) B.push({ r: Math.sqrt(R()) * (bird ? rad * 0.35 : rad), a: R() * TAU, y: (R() - 0.5) * (bird ? 10 : 1.2), w: (bird ? 0.8 : 0.6) + R() * 0.4, p: R() * TAU, q: R() * TAU, s: 0.8 + R() * 0.4 });
  const line = item.heading != null && item.action !== 'circle' && bird && !item.radius;
  const h = (item.heading ?? 0) * Math.PI / 180;
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), prev = new THREE.Vector3(), e = new THREE.Euler();
  const place = (b, t, out) => {
    if (bird) {
      let cx, cz, cyy = cy;
      if (line) { cx = at[0] + Math.sin(h) * speed * t; cz = at[1] - Math.cos(h) * speed * t; }
      else { const a = speed / rad * t; cx = at[0] + Math.cos(a) * rad * 0.9; cz = at[1] + Math.sin(a) * rad * 0.9; }
      const wob = 0.35;
      out.set(cx + Math.cos(b.a + t * b.w * wob) * b.r + 2.5 * Math.sin(t * 0.7 + b.p), cyy + b.y + 1.5 * Math.sin(t * 0.9 + b.q), cz + Math.sin(b.a + t * b.w * wob) * b.r + 2.5 * Math.cos(t * 0.6 + b.q));
    } else {
      const a = b.a + t * b.w * (speed ? 1 : 0.8) / Math.max(1.5, b.r) * 1.5;
      out.set(at[0] + Math.cos(a) * b.r, cy + b.y * 0.6 + 0.2 * Math.sin(t + b.p), at[1] + Math.sin(a) * b.r);
    }
    return out;
  };
  function update(t) {
    mat.userData.u.uFT.value = t;
    for (let i = 0; i < n; i++) {
      const b = B[i];
      place(b, t, pos); place(b, t - 0.05, prev);
      const d = pos.clone().sub(prev);
      const yaw = Math.atan2(d.x, d.z), pit = -Math.atan2(d.y, Math.hypot(d.x, d.z));
      qt.setFromEuler(e.set(pit, yaw, bird ? -0.3 * Math.sin(t * 0.5 + b.p) : 0, 'YXZ'));
      sc.setScalar(scale * b.s);
      m4.compose(pos, qt, sc); im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { root, radius: rad, height: bird ? 4 : 1, snapped: true, contact: false, update, anchors: {} };
}

export async function build(kind, item, ctx) {
  const k = CATALOG[kind] ? kind : 'creature.horse';
  if (k === 'creature.pterosaur') return buildPterosaur(k, item, ctx);
  if (k === 'creature.whale') return buildWhale(k, item, ctx);
  if (k === 'creature.bird_flock' || k === 'creature.fish_shoal') return buildFlock(k, item, ctx);
  return buildGround(k, item, ctx);
}
