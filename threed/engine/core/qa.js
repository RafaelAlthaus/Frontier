// qa.js — what the camera may not do, measured the same way by the planner (camera.js) and by the QA pass:
//   probe.check(p, t)   terrain/water clearance, inside a solid (leaf-mesh / per-instance boxes on a grid, moving
//                       vehicles as cylinders), distance to the nearest figure (capsules; group members via members(t))
//   qaFrame(t)          one frame: {clearance_m, cam_speed, ang_speed, roll_deg, inside, fig_dist, warnings, transition}
//   qaScene(fps)        every frame of the scene, aggregated, with the flagged time ranges
import * as THREE from 'three';

const LIMITS_DEFAULT = { clear: 2, clearFast: 6, fig: 1.2, speedK: 0.8, nearGround: 80, ang: 45, roll: 8, margin: 0.6, minEnd: 0.08 };
export const LIMITS = { clear: 2, clearFast: 6, fig: 1.2, speedK: 0.8, nearGround: 80, ang: 45, roll: 8, margin: 0.6, minEnd: 0.08 };
// the hand-held first-person run (camera.move 'pov'): a human eye 1.6 m above the ground at a sprint, head turns for the
// glances back; still never inside a solid, clear of figures, roll <= 8 deg, moving at both ends
export const POV_LIMITS = { clear: 1.3, clearFast: 1.3, fig: 0.9, speedK: 5.0, nearGround: 80, ang: 185, roll: 8, margin: 0.4, minEnd: 0.08 };
// camera.limits 'eye' (keys moves): an operator's eye-level camera, 1.3 m clear of the ground instead of 2 m (additive)
export const EYE_LIMITS = { ...LIMITS, clear: 1.3, clearFast: 1.3 };
// camera.limits 'macro' (keys moves, Q6): a lens 0.15 m over the ground for small subjects (a burrow, a shrew); the speed
// rule still holds (0.8 x max(0.5 m, clearance) per s, i.e. 0.4 m/s near the ground), figures 0.6 m
export const MACRO_LIMITS = { ...LIMITS, clear: 0.15, clearFast: 0.15, fig: 0.6 };
export const limitsFor = (spec) => (spec?.camera?.move === 'pov' ? POV_LIMITS : spec?.camera?.limits === 'eye' ? EYE_LIMITS : spec?.camera?.limits === 'macro' ? MACRO_LIMITS : LIMITS);

const _b = new THREE.Box3(), _m = new THREE.Matrix4(), _v = new THREE.Vector3();

// static solids: leaf meshes (and each instance of an instanced mesh) that rise more than ~1.8 m above the ground
function collectBoxes(root, ground, skip) {
  const boxes = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    for (let p = o; p; p = p.parent) { if (p.userData && (p.userData.noQA || p.userData.ground)) return; if (skip.has(p)) return; }
    const g = o.geometry; if (!g) return;
    if (!g.boundingBox) g.computeBoundingBox();
    let interior = false;
    for (let p = o; p; p = p.parent) if (p.name && /^interior\./.test(p.name)) { interior = true; break; }
    const add = (bb) => {
      const sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z;
      if (!(sx < 400 && sz < 400) && !o.userData.obstacle) return;              // terrain chunks, water, domes
      if (interior && sx > 2.5 && sz > 2.5) return;                             // an interior's shell (vault, floor, ceiling) is hollow: we film from inside
      const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      const gy = ground(cx, cz);
      if (bb.max.y - gy < 1.8) return;                                          // below the 2 m clearance anyway
      boxes.push({ min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z], name: o.name || o.parent?.name || 'mesh' });
    };
    if (o.isInstancedMesh) {
      const n = Math.min(o.count, 60000);
      for (let i = 0; i < n; i++) { o.getMatrixAt(i, _m); _m.premultiply(o.matrixWorld); _b.copy(g.boundingBox).applyMatrix4(_m); add(_b); }
    } else {
      _b.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      const pos = g.attributes && g.attributes.position;
      // a merged mesh (a whole town in one draw call) would be one box over every street: one box per 6 m cell of its
      // triangles instead, so a camera can walk the streets (additive fix for the disasters film)
      if (((_b.max.x - _b.min.x) > 40 || (_b.max.z - _b.min.z) > 40) && pos && pos.count >= 3 && !o.userData.obstacle) splitBoxes(o, g, add);
      else add(_b);
    }
  });
  return boxes;
}
function splitBoxes(o, g, add, cell = 6) {
  const pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count, M = o.matrixWorld;
  const cells = new Map(), v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i + 2 < n; i += 3) {
    for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(M);
    const cx = (v[0].x + v[1].x + v[2].x) / 3, cz = (v[0].z + v[1].z + v[2].z) / 3;
    const key = Math.floor(cx / cell) * 100003 + Math.floor(cz / cell);
    let b = cells.get(key);
    if (!b) { b = new THREE.Box3(); cells.set(key, b); }
    for (let k = 0; k < 3; k++) b.expandByPoint(v[k]);
  }
  for (const b of cells.values()) add(b);
}

function grid(boxes, cell = 16) {
  const G = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  boxes.forEach((b, n) => {
    const i0 = Math.floor(b.min[0] / cell), i1 = Math.floor(b.max[0] / cell), j0 = Math.floor(b.min[2] / cell), j1 = Math.floor(b.max[2] / cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4000) return;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); if (!G.has(k)) G.set(k, []); G.get(k).push(n); }
  });
  return (x, z) => G.get(key(Math.floor(x / cell), Math.floor(z / cell))) || [];
}

// the probe over a built scene. dur: scene length; tracks are sampled at 10 Hz over [-0.5, dur + 0.5]
export function makeProbe(S, stageRoot, ctx, dur) {
  const groundRaw = ctx.ground.height;
  const ground = (x, z) => { const g = groundRaw(x, z); return S.water != null ? Math.max(g, S.water) : g; };
  const dyn = [], figs = [], skip = new Set();
  const T0 = -0.5, T1 = dur + 0.5, HZ = 10, NS = Math.ceil((T1 - T0) * HZ) + 1;
  const tAt = (k) => T0 + k / HZ;
  const wp = new THREE.Vector3();
  // a vehicle drives its body (anchors.body) inside a root that stays at the origin: it is where its body is (fix: a
  // driving car counted as a still solid at its last position, and the camera's subject stayed at the origin)
  const where = (it) => (it.section !== 'cast' && it.res.anchors && it.res.anchors.body && it.res.anchors.body.isObject3D) ? it.res.anchors.body : it.res.root;
  // which items move: sample their update at a few times
  for (const it of S.items) {
    const r = it.res;
    const pos = [];
    for (const t of [0, dur * 0.33, dur * 0.66, dur]) { try { r.update && r.update(t, t); } catch (e) { /* */ } r.root.updateMatrixWorld(true); where(it).getWorldPosition(wp); pos.push(wp.clone()); }
    it.moving = pos.some((p) => p.distanceTo(pos[0]) > 0.05) || (typeof r.members === 'function' && JSON.stringify(r.members(0)[0]) !== JSON.stringify(r.members(dur)[0]));
    const figure = it.figure || it.section === 'cast';
    if (figure || it.moving) skip.add(r.root);
  }
  // tracks
  for (const it of S.items) {
    const r = it.res;
    if (!skip.has(r.root)) continue;
    const figure = it.figure || it.section === 'cast';
    if (typeof r.members === 'function') {
      const M = []; for (let k = 0; k < NS; k++) M.push(r.members(tAt(k)));
      const n = M[0].length;
      for (let m = 0; m < n; m++) figs.push({ track: M.map((a) => a[m]), r: 0.3, h: r.height ?? 1.85, name: `${it.section}:${it.index}#${m}` });
      continue;
    }
    const tr = [];
    // a cast figure stands inside a root at the origin: its position is its feet anchor (fix)
    const anc = (it.section === 'cast' && r.anchors && r.anchors.feet && r.anchors.feet.isObject3D) ? r.anchors.feet : where(it);
    if (!it.moving) { r.root.updateMatrixWorld(true); anc.getWorldPosition(wp); for (let k = 0; k < NS; k++) tr.push([wp.x, wp.z, it.flies ? wp.y : null]); }
    else for (let k = 0; k < NS; k++) { try { r.update && r.update(tAt(k), tAt(k)); } catch (e) { /* */ } r.root.updateMatrixWorld(true); anc.getWorldPosition(wp); tr.push([wp.x, wp.z, it.flies ? wp.y : null]); }
    const v = { track: tr, r: figure ? 0.3 : Math.max(0.5, r.radius ?? 1), h: r.height ?? (figure ? 1.85 : 2), name: `${it.section}:${it.index} ${it.kind}` };
    if (figure && (it.section !== 'groups' || (r.radius ?? 1) < 1.5)) figs.push(v);
    else if (figure) figs.push(Object.assign(v, { zone: true }));                // a library group without members(): its whole volume
    else dyn.push(v);
  }
  // labels count as solids in their standing state (they may rise out of the ground after t = 0)
  for (const it of S.items) {
    const tR = it.label ? Math.min(dur, Math.max(0, (Array.isArray(it.item.t) ? +it.item.t[0] || 0 : 0) + 2.5)) : 0;
    try { it.res.update && it.res.update(tR, tR); } catch (e) { /* */ }
  }
  stageRoot.updateMatrixWorld(true);
  const boxes = collectBoxes(stageRoot, ground, skip);
  for (const it of S.items) { if (it.label) { try { it.res.update && it.res.update(0, 0); } catch (e) { /* */ } } }
  const cellOf = grid(boxes);
  const at = (tr, t) => {
    const f = Math.min(NS - 1, Math.max(0, (t - T0) * HZ)), k = Math.min(NS - 2, Math.floor(f)), u = f - k;
    const a = tr[k], b = tr[k + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] != null ? a[2] + (b[2] - a[2]) * u : null];
  };
  function check(p, t) {
    const g = ground(p[0], p[2]);
    const out = { clearance: p[1] - g, ground: g, inside: false, insideTop: 0, fig: Infinity, figTop: 0, figName: null };
    const M = LIMITS.margin;
    for (const n of cellOf(p[0], p[2])) {
      const b = boxes[n];
      if (p[0] > b.min[0] - M && p[0] < b.max[0] + M && p[1] > b.min[1] - M && p[1] < b.max[1] + M && p[2] > b.min[2] - M && p[2] < b.max[2] + M) {
        if (b.max[1] > out.insideTop) { out.inside = b.name; out.insideTop = b.max[1]; }
      }
    }
    for (const d of dyn) {
      const q = at(d.track, t), gy = q[2] ?? ground(q[0], q[1]);
      if (Math.hypot(p[0] - q[0], p[2] - q[1]) < d.r + M && p[1] < gy + d.h + M && p[1] > gy - 1) { if (gy + d.h > out.insideTop) { out.inside = d.name; out.insideTop = gy + d.h; } }
    }
    for (const f of figs) {
      const q = at(f.track, t);
      const gy = q[2] ?? ground(q[0], q[1]);
      const hd = Math.hypot(p[0] - q[0], p[2] - q[1]);
      if (hd > 60) continue;
      const vy = p[1] < gy ? gy - p[1] : p[1] > gy + f.h ? p[1] - gy - f.h : 0;
      const d = Math.hypot(Math.max(0, hd - f.r - (f.zone ? 0 : 0)), vy);
      if (d < out.fig) { out.fig = d; out.figTop = gy + f.h; out.figName = f.name; }
    }
    return out;
  }
  return { check, ground, boxes, dyn, figs };
}

// camera kinematics at t from a camera function c(t) -> {pos, look, roll}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export function kinematics(camAt, t, h = 1 / 60) {
  const a = camAt(t - h), b = camAt(t + h), c = camAt(t);
  const speed = len(sub(b.pos, a.pos)) / (2 * h);
  const fa = nrm(sub(a.look, a.pos)), fb = nrm(sub(b.look, b.pos));
  const dot = Math.max(-1, Math.min(1, fa[0] * fb[0] + fa[1] * fb[1] + fa[2] * fb[2]));
  const ra = (a.roll || 0), rb = (b.roll || 0);
  const ang = Math.hypot(Math.acos(dot), rb - ra) / (2 * h) * 180 / Math.PI;
  return { c, speed, ang, roll: Math.abs(c.roll || 0) * 180 / Math.PI };
}

// evaluate one time: numbers + the list of rule breaks
export function evalAt(camAt, probe, t, o = {}) {
  const LIMITS = o.limits || LIMITS_DEFAULT;
  // designed layers (camera.js: dolly zoom, shake, handheld) ride on camAt.kin: speed, turn and roll are the operator's
  // path; ground, solids and figures are checked where the lens really is (Q6; without layers both are camAt)
  const k = kinematics(camAt.kin || camAt, t);
  const q = probe.check(camAt.kin ? camAt(t).pos : k.c.pos, t);
  const qk = camAt.kin ? probe.check(k.c.pos, t) : q;
  const warnings = [];
  const fast = o.fast || k.speed > 10;
  const needClear = fast ? LIMITS.clearFast : LIMITS.clear;
  if (q.clearance < needClear - 1e-3) warnings.push({ rule: 'clearance', v: q.clearance, need: needClear });
  const lim = qk.clearance < LIMITS.nearGround ? LIMITS.speedK * Math.max(0.5, qk.clearance) : Infinity;
  if (k.speed > lim * 1.001 + 0.05) warnings.push({ rule: 'speed', v: k.speed, need: lim });
  if (k.ang > LIMITS.ang) warnings.push({ rule: 'angular', v: k.ang, need: LIMITS.ang });
  if (k.roll > LIMITS.roll + 0.01) warnings.push({ rule: 'roll', v: k.roll, need: LIMITS.roll });
  if (q.inside) warnings.push({ rule: 'inside', v: q.inside, top: q.insideTop });
  if (q.fig < LIMITS.fig) warnings.push({ rule: 'figure', v: q.fig, need: LIMITS.fig, top: q.figTop, name: q.figName });
  return { t, k, q, warnings, limit: lim };
}

export function describe(w) {
  switch (w.rule) {
    case 'clearance': return `terrain clearance ${w.v.toFixed(2)} m < ${w.need} m`;
    case 'speed': return `speed ${w.v.toFixed(1)} m/s > ${w.need.toFixed(1)} (0.8 x altitude)`;
    case 'angular': return `angular speed ${w.v.toFixed(0)} deg/s > ${w.need}`;
    case 'roll': return `roll ${w.v.toFixed(1)} deg > ${w.need}`;
    case 'inside': return `inside ${w.v}`;
    case 'figure': return `${w.name || 'figure'} at ${w.v.toFixed(2)} m < ${w.need} m`;
    case 'still': return `camera still at ${w.end}`;
    default: return w.rule;
  }
}

// transitions are part of the picture: report their strength so the frame-difference check can skip them
export function transitionAt(spec, t, dur) {
  const tr = spec.transition || {};
  const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  let warp = 0, white = 0, warpDir = -1;
  // E1 v2: the warp is a 0.15 s whip either side of the cut (was a 0.3 s zoom streak + flash each side)
  const wi = tr.in === 'warp' ? 1 - sm(t / WARP_S) : 0, wo = tr.out === 'warp' ? 1 - sm((dur - t) / WARP_S) : 0;
  warp = Math.max(wi, wo); if (wi > wo) warpDir = 1;
  if (tr.in === 'whiteout') white = Math.max(white, 1 - sm(t / 0.4));
  if (tr.out === 'whiteout') white = Math.max(white, 1 - sm((dur - t) / 0.4));
  return { warp, white, warpDir };
}
export const WARP_S = 0.15;

export function qaFrameAt(camAt, probe, t, spec, dur) {
  const e = evalAt(camAt, probe, t, { fast: spec.camera?.speed === 'fast', limits: limitsFor(spec) });
  const warnings = e.warnings.map(describe);
  if ((t <= 1e-6 || t >= dur - 1 / 30 - 1e-6) && e.k.speed < LIMITS.minEnd && e.k.ang < 1) warnings.push('camera still at ' + (t <= 1e-6 ? 'start' : 'end'));
  return {
    t, clearance_m: +e.q.clearance.toFixed(3), cam_speed: +e.k.speed.toFixed(3), ang_speed: +e.k.ang.toFixed(2), roll_deg: +e.k.roll.toFixed(2),
    speed_limit: Number.isFinite(e.limit) ? +e.limit.toFixed(2) : null, inside: e.q.inside || false,
    fig_dist: Number.isFinite(e.q.fig) ? +e.q.fig.toFixed(2) : null, warnings, transition: transitionAt(spec, t, dur),
    ...(camAt.designed ? { designed: camAt.designed(t) } : {}),
  };
}

export function qaSceneAt(camAt, probe, spec, dur, fps = 30) {
  const n = Math.max(1, Math.round(dur * fps));
  const worst = { clearance_m: Infinity, cam_speed: 0, speed_ratio: 0, ang_speed: 0, roll_deg: 0, fig_dist: Infinity };
  const flagged = [];
  for (let k = 0; k < n; k++) {
    const t = k / fps, f = qaFrameAt(camAt, probe, t, spec, dur);
    worst.clearance_m = Math.min(worst.clearance_m, f.clearance_m);
    worst.cam_speed = Math.max(worst.cam_speed, f.cam_speed);
    if (f.speed_limit) worst.speed_ratio = Math.max(worst.speed_ratio, f.cam_speed / Math.max(0.01, f.speed_limit / LIMITS.speedK));
    worst.ang_speed = Math.max(worst.ang_speed, f.ang_speed);
    worst.roll_deg = Math.max(worst.roll_deg, f.roll_deg);
    if (f.fig_dist != null) worst.fig_dist = Math.min(worst.fig_dist, f.fig_dist);
    if (f.warnings.length) flagged.push({ t: +t.toFixed(3), warnings: f.warnings });
  }
  if (!Number.isFinite(worst.fig_dist)) worst.fig_dist = null;
  // compress into ranges per message kind
  const ranges = [];
  for (const f of flagged) for (const w of f.warnings) {
    const key = w.replace(/[\d.]+/g, '#');
    const r = ranges.find((x) => x.key === key && f.t - x.t1 <= 1.5 / fps);
    if (r) { r.t1 = f.t; r.n++; } else ranges.push({ key, t0: f.t, t1: f.t, n: 1, example: w });
  }
  return { ok: flagged.length === 0, frames: n, flagged: flagged.length, worst, issues: ranges.map((r) => ({ from: r.t0, to: r.t1, frames: r.n, what: r.example })) };
}

// ── E1 v2: physical correctness by construction + the QA that catches what slips through ───────────────────────────
// Solids: furniture-sized meshes of structures and objects (interior furniture, walls, props, vehicles), each tested
// as its own oriented box. resolveFigures() moves a cast figure placed inside furniture or another figure to the
// nearest free spot before the camera is planned. physicalQA() adds coded issues to qaScene (render.py's report):
//   interior_water:  sea or terrain inside an interior's floor          clipping:       a figure inside a solid / figure
//   label_hidden:    a label's text occluded while it shows             static_camera:  > 3 s, the view barely changes
//   heading_snap:    a moving thing's yaw jumps between two frames      subject_small:  the hero under 8 % of the frame
// (face_blown: is measured on the rendered frames: faceStats() here, aggregated in render.py.)
const _p3 = new THREE.Vector3(), _q3 = new THREE.Vector3(), _mI = new THREE.Matrix4();
function solidName(o, it) {
  let n = null;
  for (let p = o; p && p !== it.res.root; p = p.parent) if (p.name && !/^(place|group|mesh)$/i.test(p.name)) { n = p.name; break; }
  return `${it.kind}${n ? ' ' + n : ''}`;
}
export function collectSolids(S) {
  const solids = [];
  for (const it of S.items || []) {
    if (!(it.section === 'structures' || it.section === 'objects') || it.flies || it.label || it.figure) continue;
    if (/^(fx|space|marker|label|core\.label)/.test(it.kind)) continue;
    const root = it.res.root; root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.userData.noCollide || o.name === 'contactShadow' || o.name === 'contacts') return;
      for (let p = o; p; p = p.parent) if (!p.visible || p.userData.hollow || p.userData.noCollide) return;   // hollow (E2: the crow's nest drum): people stand in it
      const m = o.material; if (m && !Array.isArray(m) && m.transparent && (m.opacity ?? 1) < 0.5) return;
      const g = o.geometry; if (!g || !g.attributes?.position) return;
      if (!g.boundingBox) g.computeBoundingBox();
      o.matrixWorld.decompose(_p3, new THREE.Quaternion(), _q3);
      const sz = g.boundingBox.getSize(new THREE.Vector3()).multiply(_q3);
      if (Math.max(sz.x, sz.y, sz.z) > 8 || Math.min(sz.x, sz.y, sz.z) < 0.012) return;     // shells, hulls, towns / paper, decals
      solids.push({ o, it, box: g.boundingBox.clone(), inv: new THREE.Matrix4().copy(o.matrixWorld).invert(), name: solidName(o, it) });
    });
  }
  return solids;
}
function refreshSolids(solids) { for (const s of solids) { s.o.updateWorldMatrix(true, false); s.inv.copy(s.o.matrixWorld).invert(); } }
function insideSolid(s, x, y, z, m = 0.012) {
  _p3.set(x, y, z).applyMatrix4(s.inv); const b = s.box;
  return _p3.x > b.min.x + m && _p3.x < b.max.x - m && _p3.y > b.min.y + m && _p3.y < b.max.y - m && _p3.z > b.min.z + m && _p3.z < b.max.z - m;
}
// a segment through a solid's box (slab test in the box's frame): thin parts (a 5 cm desk top) are never stepped over
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), AX = ['x', 'y', 'z'];
function segSolid(s, a, b, m = 0.012) {
  _sa.set(a[0], a[1], a[2]).applyMatrix4(s.inv); _sb.set(b[0], b[1], b[2]).applyMatrix4(s.inv);
  let t0 = 0, t1 = 1;
  for (const k of AX) {
    const o = _sa[k], d = _sb[k] - o, lo = s.box.min[k] + m, hi = s.box.max[k] - m;
    if (hi <= lo) return false;
    if (Math.abs(d) < 1e-9) { if (o <= lo || o >= hi) return false; continue; }
    let u0 = (lo - o) / d, u1 = (hi - o) / d; if (u0 > u1) { const x = u0; u0 = u1; u1 = x; }
    if (u0 > t0) t0 = u0; if (u1 < t1) t1 = u1; if (t0 >= t1) return false;
  }
  return true;
}
// the rooms: each interior's footprint in its own frame (a figure is kept inside the room it was placed in)
function roomsOf(S) {
  const out = [];
  for (const it of S.items || []) {
    if (!/^interior\./.test(it.kind)) continue;
    const place = it.res.root.children[0] || it.res.root; place.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(place.matrixWorld).invert(), box = new THREE.Box3(), c = new THREE.Vector3();
    place.traverse((o) => { if (!o.isMesh || !o.geometry) return; const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox;
      for (let i = 0; i < 8; i++) { c.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld).applyMatrix4(inv); if (Math.abs(c.x) < 60 && Math.abs(c.z) < 60) box.expandByPoint(c); } });
    if (!box.isEmpty()) out.push({ it, inv, box, floor: place.getWorldPosition(new THREE.Vector3()).y });
  }
  return out;
}
const inRoom = (R, x, z, m) => { _p3.set(x, R.floor + 0.5, z).applyMatrix4(R.inv); return _p3.x > R.box.min.x + m && _p3.x < R.box.max.x - m && _p3.z > R.box.min.z + m && _p3.z < R.box.max.z - m; };

// sample points of a body in its own frame (+Z forward, y up), per posture; `chair`: the seat the cast brings for sit
// the body as vertical columns [lx, lz, y0, y1] in its own frame (+Z forward): a seated figure's thighs may pass under
// a desk top (y < 0.62), its torso may not
const cols = (X, Z, y0, y1) => { const o = []; for (const x of X) for (const z of Z) o.push([x, z, y0, y1]); return o; };
const BODY = {
  stand: cols([-0.14, 0, 0.14], [-0.09, 0.09], 0.08, 1.65),
  sit: [...cols([-0.14, 0, 0.14], [-0.12, 0.04], 0.5, 1.35), ...cols([-0.1, 0.1], [0.24, 0.42], 0.44, 0.6), ...cols([-0.1, 0.1], [0.5], 0.05, 0.48)],
  chair: [...cols([-0.18, 0.18], [-0.25, 0.12], 0.05, 0.49), ...cols([-0.16, 0.16], [-0.25], 0.49, 0.92)],
  sit_ground: cols([-0.14, 0.14], [-0.22, 0.1, 0.42], 0.06, 0.85),
  kneel: cols([-0.14, 0.14], [-0.15, 0.1, 0.3], 0.06, 0.95),
};
// a cast figure placed inside furniture, a prop or another figure moves to the nearest free spot (same heading, same
// room); returns the report lines (warnings). Standing up from a desk is checked where the figure will stand.
export function resolveFigures(S, ground, warnings = []) {
  const figs = (S.items || []).filter((it) => (it.section === 'cast' || it.figure) && typeof it.res.placement === 'function' && typeof it.res.relocate === 'function');
  if (!figs.length) return [];
  const solids = collectSolids(S), rooms = roomsOf(S), done = [], out = [];
  for (const it of figs) {
    const P = it.res.placement();
    if (P.moving || it.aboard) { if (!it.aboard) done.push({ x: P.x, z: P.z, r: 0.3 }); continue; }   // walkers: the locomotion QA's; aboard (E2): the ship's frame
    const sc = (it.res.figure?.rig?.s) || 1, c = Math.cos(P.yaw), sn = Math.sin(P.yaw);
    const sets = [];
    for (const po of P.postures) { sets.push([BODY[po] || BODY.stand, 0]); if (po === 'sit' && P.chair) sets.push([BODY.chair, 0]); }
    if (P.standBack) sets.push([BODY.stand, -P.standBack]);
    const home = rooms.find((R) => inRoom(R, P.x, P.z, 0.02));
    const hitAt = (x, z) => {
      if (home && !inRoom(home, x, z, 0.3)) return 'the room walls';
      const g = ground(x, z);
      for (const [pts, back] of sets) for (const [lx, lz0, y0, y1] of pts) {
        const lz = lz0 + back, wx = x + (lx * c + lz * sn) * sc, wz = z + (-lx * sn + lz * c) * sc;
        const A = [wx, g + y0 * sc, wz], Bp = [wx, g + y1 * sc, wz];
        for (const s of solids) if (segSolid(s, A, Bp)) return s.name;
        for (const d of done) if (Math.hypot(wx - d.x, wz - d.z) < d.r) return d.name;
      }
      return null;
    };
    const hit = hitAt(P.x, P.z);
    let x = P.x, z = P.z;
    if (hit) {
      let best = null;
      // rings of candidates, 5 cm apart up to 3 m; on each ring behind the figure first (a desk is usually in front)
      for (let r = 0.05; r <= 3.001 && !best; r += 0.05) {
        const n = Math.max(12, Math.round(r * 40));
        for (let k = 0; k < n && !best; k++) {
          const a = P.yaw + Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (2 * Math.PI / n);
          const cx = P.x + Math.sin(a) * r, cz = P.z + Math.cos(a) * r;
          if (!hitAt(cx, cz)) best = [cx, cz, r];
        }
      }
      const who = `${it.section}:${it.ref || it.index}`;
      if (best) {
        it.res.relocate(best[0] - P.x, best[1] - P.z); x = best[0]; z = best[1];
        out.push(`${who} was placed inside ${hit}: moved ${best[2].toFixed(2)} m to [${x.toFixed(2)}, ${z.toFixed(2)}] (same heading)`);
      } else out.push(`${who} is inside ${hit} and no free spot within 3 m`);
      try { it.res.update && it.res.update(0, 0); } catch (e) { /* the next frame sets it */ }
    }
    done.push({ x, z, r: P.postures.some((p) => p !== 'stand') ? 0.42 : 0.3, name: `figure ${it.section}:${it.ref || it.index}` });
  }
  for (const l of out) warnings.push(l);
  return out;
}

// bones sampled for the clipping check (hands and arms may touch what they rest on)
function bodyPoints(fig) {
  // bone segments [a, b, part]: the spine chain and both legs (hands and arms may rest on what they touch)
  const B = fig.rig.B, s = fig.rig.s || 1, P = (b, dy = 0) => { const w = b.getWorldPosition(new THREE.Vector3()); return [w.x, w.y + dy, w.z]; };
  const segs = [], pel = P(B.pelvis), sp = P(B.spine), ch = P(B.chest), nk = P(B.neck), hd = P(B.head, 0.1 * s);
  segs.push([pel, sp, 'hips'], [sp, ch, 'torso'], [ch, nk, 'chest'], [nk, hd, 'head']);
  for (const sd of ['L', 'R']) {
    const th = B['thigh' + sd], sh = B['shin' + sd], ft = B['foot' + sd];
    if (!th || !sh || !ft) continue;
    const a = P(th), k = P(sh), f = P(ft);
    segs.push([a, k, 'thigh'], [k, f, 'shin']);
  }
  return segs;
}
function ranges(ts, step) {
  const r = []; for (const t of ts) { const l = r[r.length - 1]; if (l && t - l[1] <= step * 1.5) l[1] = t; else r.push([t, t]); } return r;
}
const fmtR = (rs) => rs.slice(0, 3).map(([a, b]) => (b > a ? `${a.toFixed(1)}-${b.toFixed(1)} s` : `${a.toFixed(1)} s`)).join(', ');

// world-independent checks, measured once per scene (items are updated here; the caller re-applies its frame after)
export function physicalQA(S, dur, ground, o = {}) {
  const issues = [], info = {};
  const items = S.items || [];
  // interior_water: the sea or the terrain above an interior's floor, inside its footprint
  for (const R of roomsOf(S)) {
    let wet = 0, terr = 0;
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const lx = R.box.min.x + (R.box.max.x - R.box.min.x) * (0.08 + 0.84 * i / 6), lz = R.box.min.z + (R.box.max.z - R.box.min.z) * (0.08 + 0.84 * j / 6);
      _q3.set(lx, 0, lz).applyMatrix4(_mI.copy(R.inv).invert());
      if (S.water != null && S.water + 0.4 > R.floor - 0.02) wet++;
      if (ground(_q3.x, _q3.z) > R.floor + 0.03) terr++;
    }
    if (wet) issues.push(`interior_water: sea level ${S.water.toFixed(2)} m (swell up to +0.4) reaches the floor of ${R.it.kind} (floor ${R.floor.toFixed(2)} m): the water shows inside the room`);
    if (terr) issues.push(`interior_water: terrain rises through the floor of ${R.it.kind} at ${terr} of 49 points`);
  }
  // clipping: a figure's body inside a solid or inside another figure, every 0.25 s
  const figs = items.filter((it) => it.res.figure?.rig?.B?.pelvis && (it.section === 'cast' || it.figure));
  if (figs.length) {
    const solids = collectSolids(S), step = 0.25, hits = new Map();
    const note = (key, t) => { if (!hits.has(key)) hits.set(key, []); hits.get(key).push(t); };
    for (let t = 0; t <= dur + 1e-6; t += step) {
      for (const it of items) { try { it.res.update && it.res.update(t, t); } catch (e) { /* */ } }
      for (const it of items) it.res.root.updateMatrixWorld(true);
      refreshSolids(solids);
      const P = figs.map((it) => (it.res.figure.group.visible ? bodyPoints(it.res.figure) : []));
      figs.forEach((it, i) => {
        const who = `${it.section}:${it.ref || it.index}`;
        let found = null;
        for (const [a, b, part] of P[i]) { for (const s of solids) if (segSolid(s, a, b, 0.02)) { found = `${part} inside ${s.name}`; break; } if (found) break; }
        if (found) note(`${who}|${found}`, t);
        for (let j = i + 1; j < figs.length; j++) {
          if (!P[i].length || !P[j].length) continue;
          const a = P[i][0][0], b = P[j][0][0];                 // pelvis to pelvis
          if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.3 && Math.abs(a[1] - b[1]) < 0.6) note(`${who}|inside figure ${figs[j].section}:${figs[j].ref || figs[j].index}`, t);
        }
      });
    }
    for (const [k, ts] of hits) { const [who, what] = k.split('|'); issues.push(`clipping: ${who} ${what} at ${fmtR(ranges(ts, step))}`); }
  }
  // heading_snap: every moving item's yaw at 30 fps; a jump is > 12 deg in one frame, or > 4 deg and 3x its neighbours
  {
    const fps = 30, n = Math.max(2, Math.round(dur * fps)), dir = new THREE.Vector3();
    const movers = items.filter((it) => it.moving && !it.label && !(it.section === 'groups' && !it.res.loco));
    const yawOf = (it) => {
      const body = it.section === 'cast' ? it.res.figure?.group : (it.res.anchors?.body?.isObject3D ? it.res.anchors.body : it.res.root);
      if (!body) return null;
      body.updateWorldMatrix(true, false); dir.set(0, 0, 1).transformDirection(body.matrixWorld);
      return Math.hypot(dir.x, dir.z) > 0.2 ? Math.atan2(dir.x, dir.z) : null;
    };
    for (const it of movers.slice(0, 24)) {
      const Y = [];
      for (let k = 0; k <= n; k++) { const t = k / fps; try { it.res.update && it.res.update(t, t); } catch (e) { /* */ } Y.push(yawOf(it)); }
      const D = Y.map((y, k) => (k && y != null && Y[k - 1] != null ? Math.abs(((y - Y[k - 1] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI : 0));
      const bad = [];
      D.forEach((d, k) => {
        if (k < 1) return;
        const nb = D.slice(Math.max(1, k - 6), k).concat(D.slice(k + 1, k + 7)).sort((a, b) => a - b), med = nb.length ? nb[nb.length >> 1] : 0;
        if (d > 12 || (d > 4 && d > 3 * med + 0.5)) bad.push([k / fps, d]);
      });
      if (bad.length) { const mx = bad.reduce((a, b) => (b[1] > a[1] ? b : a)); issues.push(`heading_snap: ${it.section}:${it.index} ${it.kind} yaw jumps ${mx[1].toFixed(1)} deg in one frame at ${mx[0].toFixed(2)} s (${bad.length} jump${bad.length > 1 ? 's' : ''}: ${bad.slice(0, 4).map((b) => b[0].toFixed(2)).join(', ')} s)`); }
    }
  }
  info.checked = { figures: figs.length };
  return { issues, info };
}

// camera-dependent checks (re-run after a re-plan): static_camera, subject_small, label_hidden
export function cameraQA(spec, S, plan, stage, dur, o = {}) {
  const issues = [];
  const camAt = plan.camAt, subj = plan.subject, W = o.w || 16, H = o.h || 9;
  const tgt = spec.camera?.target;
  const cam = new THREE.PerspectiveCamera(40, W / H, 0.05, 60000);
  const setCam = (c) => { cam.position.set(...c.pos); cam.up.set(0, 1, 0); cam.lookAt(c.look[0], c.look[1], c.look[2]); if (c.roll) cam.rotateZ(c.roll); cam.fov = c.fov ?? 40; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); };
  const center = (t) => { try { const p = subj && subj.center ? subj.center(t) : null; return p && p.length >= 3 ? p : null; } catch (e) { return null; } };
  // static_camera: > 3 s where the view direction turns < 4 deg AND the distance to the target changes < 5 % AND the
  // target moves < 4 % of the frame on screen
  if (dur > 3) {
    const N = 24, dirs = [], dists = [], scr = [];
    for (let k = 0; k <= N; k++) {
      const t = dur * k / N, c = camAt(t), f = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]], l = Math.hypot(...f) || 1;
      dirs.push(f.map((v) => v / l));
      const p = center(t);
      if (p) { dists.push(Math.hypot(p[0] - c.pos[0], p[1] - c.pos[1], p[2] - c.pos[2])); setCam(c); _p3.set(p[0], p[1], p[2]).project(cam); scr.push([_p3.x, _p3.y]); }
    }
    let ang = 0; for (const d of dirs) ang = Math.max(ang, Math.acos(Math.min(1, d[0] * dirs[0][0] + d[1] * dirs[0][1] + d[2] * dirs[0][2])) * 180 / Math.PI);
    const dd = dists.length ? (Math.max(...dists) - Math.min(...dists)) / Math.max(0.01, dists[0]) : 0;
    let mv = 0; for (const s of scr) mv = Math.max(mv, Math.hypot(s[0] - scr[0][0], (s[1] - scr[0][1]) * H / W) / 2);
    if (ang < 4 && dd < 0.05 && mv < 0.04) issues.push(`static_camera: ${dur.toFixed(1)} s shot, the view turns ${ang.toFixed(1)} deg, the distance to the target changes ${(dd * 100).toFixed(1)} %, the target moves ${(mv * 100).toFixed(1)} % of the frame: a near-still frame`);
  }
  const groundless = !!(S.world && S.world.ground && typeof S.world.ground.height === 'function' && S.world.ground.height(0, 0) < -5000);   // E4 v2 r3: space, cloud decks
  // subject_small: the camera target's projected height (median over the shot) under 8 % of the frame
  if (typeof tgt === 'string' && /^(ref|cast|objects|groups):/.test(tgt) && S.byRef?.[tgt] && !/flyover_high|reveal_rise/.test(spec.camera?.move || '')) {
    const it = S.byRef[tgt], root = it.section === 'cast' ? (it.res.figure?.group || it.res.root) : (it.res.anchors?.body?.isObject3D ? it.res.anchors.body : it.res.root);
    const fr = [], bb = new THREE.Box3();
    // E4 v2: a planet (res.planet) is measured by its true angular size, not a box capped at 400 m
    const pl = it.res.planet && typeof it.res.planet.center === 'function' ? it.res.planet : null;
    if (pl) for (let k = 0; k <= 8; k++) { const t = dur * k / 8, c = camAt(t), m = pl.center(); const d = Math.max(1e-3, Math.hypot(m.x - c.pos[0], m.y - c.pos[1], m.z - c.pos[2])); fr.push(2 * Math.asin(Math.min(1, pl.R / d)) / ((c.fov ?? 40) * Math.PI / 180)); }
    else for (let k = 0; k <= 8; k++) {
      const t = dur * k / 8; try { it.res.update && it.res.update(t, t); } catch (e) { /* */ }
      root.updateMatrixWorld(true); bb.setFromObject(root);
      if (bb.isEmpty()) continue;
      const h = Math.min(bb.max.y - bb.min.y, groundless ? 1e6 : 400), c = camAt(t), m = bb.getCenter(new THREE.Vector3());
      const d = Math.max(0.1, Math.hypot(m.x - c.pos[0], m.y - c.pos[1], m.z - c.pos[2]));
      fr.push(h / (2 * d * Math.tan(((c.fov ?? 40) * Math.PI / 180) / 2)));
    }
    fr.sort((a, b) => a - b);
    const med = fr.length ? fr[fr.length >> 1] : 1;
    // E4 v2 r3: in space / the cloud decks (no ground) a target under 10 % of the frame is a speck on black
    if (groundless && med < 0.10) issues.push(`space_subject_small: the target ${tgt} (${it.kind}) is ${(med * 100).toFixed(1)} % of the frame height (median), under 10 % in a space shot: a speck on black`);
    else if (med < 0.08) issues.push(`subject_small: the target ${tgt} (${it.kind}) is ${(med * 100).toFixed(1)} % of the frame height (median), under 8 % for a hero shot`);
    // E4 v2 r3: the target off-screen or behind the lens for over a third of the shot
    let off = 0, nS = 0;
    for (let k = 0; k <= 8; k++) {
      const t = dur * k / 8, p = center(t); if (!p) continue; nS++;
      setCam(camAt(t)); _p3.set(p[0], p[1], p[2]); const v = _p3.clone().applyMatrix4(cam.matrixWorldInverse);
      _p3.project(cam);
      if (v.z > 0 || Math.abs(_p3.x) > 1.02 || Math.abs(_p3.y) > 1.02) off++;
    }
    if (nS && off / nS > 0.34) issues.push(`subject_offscreen: the target ${tgt} (${it.kind}) is off-screen or behind the lens in ${Math.round(off / nS * 100)} % of the shot`);
  }
  // label_hidden: rays from the lens to the label's text; hidden when most of its visible window is blocked
  const labels = (S.items || []).filter((it) => it.label && it.res.pointAt);
  // label_double: the same title twice (two labels, overlapping windows); a single title ghosting in the depth of field
  // cannot happen any more (main.js compensates every story label for the aperture offset per sub-frame)
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const A = labels[i], Bb = labels[j], ta = String(A.item.text || '').trim().toLowerCase();
    if (!ta || ta !== String(Bb.item.text || '').trim().toLowerCase()) continue;
    const [a0, a1] = fitTimes(A, dur), [b0, b1] = fitTimes(Bb, dur);
    if (Math.min(a1, b1) > Math.max(a0, b0)) issues.push(`label_double: labels:${A.index} and labels:${Bb.index} both show "${String(A.item.text).slice(0, 40)}" at ${Math.max(a0, b0).toFixed(1)}-${Math.min(a1, b1).toFixed(1)} s`);
  }
  for (const it of labels) {
    if (it.res.screen) continue;                        // screen-space text is placed inside the safe area
    const f = labelFit(it, camAt, dur, W / H);
    if (f.out) issues.push(`label_clipped: labels:${it.index} "${String(it.item.text || '').slice(0, 40)}" leaves the title safe area (${f.why}) in ${Math.round(f.out / Math.max(1, f.n) * 100)} % of its time on screen`);
  }
  if (labels.length) {
    const occ = occluders(stage, labels);
    for (const it of labels) {
      if (it.res.screen) continue;                      // screen-space text is drawn over everything
      const f = labelHiddenFrac(it, camAt, occ, dur);
      if (f.frac > 0.35) issues.push(`label_hidden: labels:${it.index} "${String(it.item.text || '').slice(0, 40)}" is blocked by ${f.by || 'the scene'} in ${(f.frac * 100).toFixed(0)} % of its time on screen`);
    }
  }
  return issues;
}
function occluders(stage, labels) {
  const skip = new Set(); for (const it of labels) it.res.root.traverse((o) => skip.add(o));
  const list = [];
  stage.traverse((o) => {
    if (!o.isMesh || skip.has(o) || o.userData.ground || o.name === 'contacts' || o.name === 'contactShadow' || o.isPoints || o.isLine) return;
    const mm = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mm && (mm.depthTest === false || mm.depthWrite === false)) return;       // sky spheres (space.starfield) are drawn behind everything
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    const m = o.material; if (m && !Array.isArray(m) && m.transparent && (m.opacity ?? 1) < 0.5) return;
    const g = o.geometry; if (!g) return; if (!g.boundingSphere) g.computeBoundingSphere();
    if (g.boundingSphere && g.boundingSphere.radius > 400) return;           // sea, terrain, domes
    list.push(o);
  });
  return list;
}
function labelTimes(it, dur) {
  const q = it.item || {};
  const a = Number.isFinite(+q.t_in) ? +q.t_in : Array.isArray(q.t) ? +q.t[0] || 0 : 0;
  const b = Number.isFinite(+q.t_out) ? +q.t_out : Array.isArray(q.t) && q.t[1] != null ? +q.t[1] : dur;
  return [Math.max(0, a + 0.3), Math.min(dur, b)];
}
const _ray = new THREE.Raycaster();
export function labelHiddenFrac(it, camAt, occ, dur) {
  const [a, b] = labelTimes(it, dur);
  if (b - a < 0.2) return { frac: 0 };
  let n = 0, hid = 0; const by = new Map();
  const box = new THREE.Box3(), pts = [];
  for (let t = a; t <= b + 1e-6; t += Math.max(0.2, (b - a) / 10)) {
    try { it.res.update(t, t, null); } catch (e) { /* */ }
    it.res.root.updateMatrixWorld(true); box.setFromObject(it.res.root);
    if (box.isEmpty()) continue;
    const c = camAt(t), cp = new THREE.Vector3(...c.pos), m = box.getCenter(new THREE.Vector3());
    // five points along the text line (across the view): any one blocked and the name does not read
    const rx = -(m.z - cp.z), rz = m.x - cp.x, rl = Math.hypot(rx, rz) || 1, hw = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
    pts.length = 0;
    for (const k of [0, -0.35, 0.35, -0.7, 0.7]) pts.push(new THREE.Vector3(m.x + rx / rl * hw * k, m.y, m.z + rz / rl * hw * k));
    let blocked = 0;
    for (const p of pts) {
      const d = p.clone().sub(cp), L = d.length(); if (L < 0.05) continue;
      _ray.set(cp, d.divideScalar(L)); _ray.far = L - 0.03; _ray.near = 0.05;
      const h = _ray.intersectObjects(occ, false);
      if (h.length) { blocked++; const nm = h[0].object.name || h[0].object.parent?.name || 'mesh'; by.set(nm, (by.get(nm) || 0) + 1); }
    }
    n++; if (blocked >= 1) hid++;
  }
  const top = [...by.entries()].sort((x, y) => y[1] - x[1])[0];
  return { frac: n ? hid / n : 0, by: top ? top[0] : null };
}
// E1 v2 labels: a world label whose text is occluded moves so it reads: lifted above the occluder, else to screen space
// (upper-middle frame, never the bottom quarter where the captions live)
export function resolveLabels(S, plan, stage, dur, changes = []) {
  const labels = (S.items || []).filter((it) => it.label && it.res.pointAt && typeof it.res.setLift === 'function');
  if (!labels.length) return changes;
  const occ = occluders(stage, labels);
  for (const it of labels) {
    const f0 = labelHiddenFrac(it, plan.camAt, occ, dur);
    if (f0.frac <= 0.15) continue;
    let ok = null;
    for (let dy = 0.1; dy <= 1.21; dy += 0.1) { it.res.setLift(dy); if (labelHiddenFrac(it, plan.camAt, occ, dur).frac <= 0.1) { ok = dy; break; } }
    if (ok != null) changes.push(`labels:${it.index} was hidden by ${f0.by || 'the scene'} (${(f0.frac * 100).toFixed(0)} %): lifted ${ok.toFixed(1)} m`);
    else { it.res.setLift(0); it.res.setScreen && it.res.setScreen(true); changes.push(`labels:${it.index} was hidden by ${f0.by || 'the scene'} (${(f0.frac * 100).toFixed(0)} %): moved to screen space (upper third)`); }
  }
  // the safe area, for the label's whole time on screen: one constant vertical shift that keeps every sample inside,
  // else screen space (inside by construction). (m0_stern: "2:10 AM" rose with the push-in and left the top edge.)
  for (const it of labels) {
    if (it.res.screen) continue;
    const f = labelFit(it, plan.camAt, dur);
    if (!f.n || !f.out) continue;
    const lift0 = it.res.lift ?? 0;
    if (f.lo <= f.hi) {
      const dy = f.lo > 0 ? f.lo : f.hi < 0 ? f.hi : 0;
      it.res.setLift(lift0 + dy * 1.04);
      if (!labelFit(it, plan.camAt, dur).out) { changes.push(`labels:${it.index} left the safe area (${f.why}) in ${Math.round(f.out / f.n * 100)} % of its time on screen: moved ${(dy * 1.04).toFixed(1)} m ${dy < 0 ? 'down' : 'up'}`); continue; }
      it.res.setLift(lift0);
    }
    if (it.res.setScreen) { it.res.setScreen(true); changes.push(`labels:${it.index} left the safe area (${f.why}) and no shift keeps it inside: moved to screen space (upper third)`); }
  }
  return changes;
}
// E1 v2: the title safe area in NDC: >= 6 % from the top and the sides, never the bottom quarter (the captions)
export const SAFE = { top: 0.06, side: 0.06, bottom: 0.25 };
const SAFE_NDC = { x0: -1 + 2 * SAFE.side, x1: 1 - 2 * SAFE.side, y0: -1 + 2 * SAFE.bottom, y1: 1 - 2 * SAFE.top };
function fitTimes(it, dur) {
  const q = it.item || {};
  const a = Number.isFinite(+q.t_in) ? +q.t_in : Array.isArray(q.t) ? +q.t[0] || 0 : 0;
  const b = Number.isFinite(+q.t_out) ? +q.t_out + 0.5 : Array.isArray(q.t) && q.t[1] != null ? +q.t[1] + 0.5 : dur;
  return [Math.max(0, a), Math.min(dur, b)];
}
// how the label sits in the frame over its window: samples outside the safe area, and the world-y shift range [lo, hi]
// (metres) that would put every sample inside (lo > hi: none)
export function labelFit(it, camAt, dur, aspect = 16 / 9) {
  const [a, b] = fitTimes(it, dur);
  const out = { n: 0, out: 0, lo: -Infinity, hi: Infinity, why: '' };
  if (b - a < 0.1) return out;
  const cam = new THREE.PerspectiveCamera(40, aspect, 0.05, 60000), box = new THREE.Box3(), v = new THREE.Vector3(), fake = { position: new THREE.Vector3() };
  const why = new Set();
  const N = Math.max(4, Math.min(24, Math.round((b - a) * 6)));
  for (let k = 0; k <= N; k++) {
    const t = a + (b - a) * k / N, c = camAt(t);
    fake.position.set(...c.pos);
    try { it.res.update(t, t, fake); } catch (e) { /* */ }
    it.res.root.updateMatrixWorld(true);
    box.setFromObject(it.res.root);
    if (box.isEmpty()) continue;
    cam.position.set(...c.pos); cam.up.set(0, 1, 0); cam.lookAt(c.look[0], c.look[1], c.look[2]); if (c.roll) cam.rotateZ(c.roll);
    cam.fov = c.fov ?? 40; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      const d = v.clone().applyMatrix4(cam.matrixWorldInverse); if (d.z > -0.05) { behind = true; continue; }
      v.project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    if (behind || !Number.isFinite(x0)) continue;
    out.n++;
    const bad = [];
    if (y1 > SAFE_NDC.y1) bad.push('top'); if (y0 < SAFE_NDC.y0) bad.push('bottom quarter');
    if (x0 < SAFE_NDC.x0 || x1 > SAFE_NDC.x1) bad.push('sides');
    if (bad.length) { out.out++; bad.forEach((w) => why.add(w)); }
    // metres per NDC unit at the label's depth -> the vertical shift that fits this sample
    const m = box.getCenter(new THREE.Vector3()).applyMatrix4(cam.matrixWorldInverse), kM = -m.z * Math.tan((cam.fov * Math.PI / 180) / 2);
    out.lo = Math.max(out.lo, (SAFE_NDC.y0 - y0) * kM); out.hi = Math.min(out.hi, (SAFE_NDC.y1 - y1) * kM);
    if (x0 < SAFE_NDC.x0 || x1 > SAFE_NDC.x1) { out.lo = Infinity; }        // a sideways problem: no vertical fix
  }
  out.why = [...why].join(', ');
  try { it.res.update(0, 0, null); } catch (e) { /* */ }
  return out;
}

// face_blown, per rendered frame: each figure's head box on screen (from the camera of this frame) -> near-white share
export function faceStats(S, camera, canvas, cx2d, sepFn = null) {
  const out = [], W = canvas.width, H = canvas.height, v = new THREE.Vector3(), r = new THREE.Vector3();
  for (const it of S.items || []) {
    const fig = it.res.figure; if (!fig?.rig?.B?.head || !fig.group.visible) continue;
    const s = fig.rig.s || 1; fig.rig.B.head.getWorldPosition(v); v.y += 0.08 * s;
    const d = v.distanceTo(camera.position); if (d < 0.1) continue;
    r.copy(v).project(camera); if (r.z > 1 || Math.abs(r.x) > 1 || Math.abs(r.y) > 1) continue;
    const rad = 0.1 * s / (d * Math.tan(camera.fov * Math.PI / 360)) * H / 2;        // px (head half-height)
    if (rad < 4) continue;
    const px = (r.x * 0.5 + 0.5) * W, py = (0.5 - r.y * 0.5) * H, x0 = Math.max(0, Math.round(px - rad * 0.5)), y0 = Math.max(0, Math.round(py - rad * 0.7)), w = Math.min(W - x0, Math.round(rad * 1.0)), h = Math.min(H - y0, Math.round(rad * 1.4));   // the head's core, not the background around it
    if (w < 3 || h < 3) continue;
    cx2d.clearRect(0, 0, 32, 32); cx2d.drawImage(canvas, x0, y0, w, h, 0, 0, 32, 32);
    const d8 = cx2d.getImageData(0, 0, 32, 32).data; let white = 0, sum = 0;
    for (let i = 0; i < d8.length; i += 4) { const l = 0.2126 * d8[i] + 0.7152 * d8[i + 1] + 0.0722 * d8[i + 2]; sum += l; if (l > 242) white++; }
    const body = figureLuma(it, camera, canvas, cx2d), sp = sepFn ? sepFn(it) : null;
    out.push({ who: `${it.section}:${it.ref || it.index}`, white: +(white / 1024).toFixed(3), mean: +(sum / 1024).toFixed(1), px: Math.round(rad * 2), ...(body ? { body: +body.mean.toFixed(1) } : {}), ...(sp && sp.sep != null ? { sep: +sp.sep.toFixed(3), edge: sp.n, ...(sp.sepBody != null ? { sepBody: +sp.sepBody.toFixed(3) } : {}) } : {}) });
  }
  return out;
}
// E1 v2 too_dark / auto-exposure: the mean luma (0-255, the graded frame) of a figure's head-and-torso region on screen,
// and of its head core; null when it is off screen or too small to measure
export function figureLuma(it, camera, canvas, cx2d) {
  const fig = it.res.figure; if (!fig?.rig?.B?.head || !fig.group.visible) return null;
  const s = fig.rig.s || 1, B = fig.rig.B, W = canvas.width, H = canvas.height, pts = [], v = new THREE.Vector3();
  B.head.getWorldPosition(v); v.y += 0.14 * s; pts.push(v.clone());
  B.pelvis.getWorldPosition(v); pts.push(v.clone());
  const mid = pts[0].clone().lerp(pts[1], 0.5), d = mid.distanceTo(camera.position); if (d < 0.2) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { const q = p.clone().project(camera); if (q.z > 1) return null; const px = (q.x * 0.5 + 0.5) * W, py = (0.5 - q.y * 0.5) * H; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  const half = 0.2 * s / (d * Math.tan(camera.fov * Math.PI / 360)) * H / 2;            // +-0.2 m around the spine
  x0 = Math.max(0, Math.round(Math.min(x0, x1) - half)); x1 = Math.min(W, Math.round(Math.max(x0, x1) + half));
  y0 = Math.max(0, Math.round(y0)); y1 = Math.min(H, Math.round(y1));
  const w = x1 - x0, h = y1 - y0; if (w < 6 || h < 6) return null;
  cx2d.clearRect(0, 0, 32, 32); cx2d.drawImage(canvas, x0, y0, w, h, 0, 0, 32, 32);
  const d8 = cx2d.getImageData(0, 0, 32, 32).data; let sum = 0;
  for (let i = 0; i < d8.length; i += 4) sum += 0.2126 * d8[i] + 0.7152 * d8[i + 1] + 0.0722 * d8[i + 2];
  return { mean: sum / 1024, rect: [x0, y0, w, h] };
}

// E1 v2 silhouette separation (too_dark, the rim light): how much of a figure's outline stands off the room behind it.
// A mask pass renders only the figure (camera layer 7, white override, no shadow update) at 192 x 108; along the
// outline each pair (one pixel inside the figure, two pixels outside) is compared in the graded frame, and `sep` is
// the share of pairs whose luma differs by >= 14 levels. A dark coat on a dark room reads when a rim outlines it.
const SEP_W = 192, SEP_H = 108, SEP_LAYER = 7;
let sepRT = null, sepMat = null, sepBuf = null, sepCv = null, sepCx = null;
export function silhouetteSep(renderer, scene, camera, it, canvas, hide = []) {
  // a figure (its group), or any item: the camera target of an exterior (a ship's body, a lifeboat, an iceberg)
  const fig = it.res.figure?.rig ? it.res.figure : null;
  const grp = fig ? fig.group : it.res.root;              // the whole item: a liner's meshes hang under its root
  if (!grp || !grp.visible) return null;
  if (!sepRT) {
    sepRT = new THREE.WebGLRenderTarget(SEP_W, SEP_H); sepMat = [new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })];
    sepBuf = new Uint8Array(SEP_W * SEP_H * 4); sepCv = document.createElement('canvas'); sepCv.width = SEP_W; sepCv.height = SEP_H;
    sepCx = sepCv.getContext('2d', { willReadFrequently: true });
  }
  if (!grp.userData.sepLayer) { grp.traverse((o) => o.layers.enable(SEP_LAYER)); grp.userData.sepLayer = true; }
  // the graded frame, downsampled
  sepCx.drawImage(canvas, 0, 0, SEP_W, SEP_H);
  const img = sepCx.getImageData(0, 0, SEP_W, SEP_H).data;
  // the mask
  // two passes: everything in black (depth: the chair back, the desk hide what they hide), then the figure in white.
  // The sky and the world (the sea and its mirror pass) are hidden: they never occlude a figure in a room.
  const prevMask = camera.layers.mask, prevOv = scene.overrideMaterial, prevRT = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate;
  const prevCol = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha(), prevAC = renderer.autoClear, vis = hide.map((o) => o.visible);
  try {
    hide.forEach((o) => { o.visible = false; });
    renderer.shadowMap.autoUpdate = false; renderer.setRenderTarget(sepRT); renderer.setClearColor(0x000000, 1);
    camera.layers.mask = 1 | (1 << SEP_LAYER); scene.overrideMaterial = sepMat[0]; renderer.autoClear = true; renderer.render(scene, camera);
    camera.layers.set(SEP_LAYER); scene.overrideMaterial = sepMat[1]; renderer.autoClear = false; renderer.render(scene, camera);
    renderer.readRenderTargetPixels(sepRT, 0, 0, SEP_W, SEP_H, sepBuf);
  } finally {
    hide.forEach((o, i) => { o.visible = vis[i]; });
    camera.layers.mask = prevMask; scene.overrideMaterial = prevOv; renderer.shadowMap.autoUpdate = prevAuto; renderer.autoClear = prevAC;
    renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCol, prevA);
  }
  const M = new Uint8Array(SEP_W * SEP_H), L = new Float32Array(SEP_W * SEP_H);
  for (let y = 0; y < SEP_H; y++) for (let x = 0; x < SEP_W; x++) {
    const i = y * SEP_W + x, k = ((SEP_H - 1 - y) * SEP_W + x) * 4;      // the render target is bottom-up
    M[i] = sepBuf[k] > 127 ? 1 : 0; L[i] = 0.2126 * img[i * 4] + 0.7152 * img[i * 4 + 1] + 0.0722 * img[i * 4 + 2];
  }
  // the head's disc on this grid: sepBody leaves it out (a white head on a dark room separates by itself; the rim is
  // there for the shoulders and the back)
  let hx = -1e9, hy = -1e9, hr = 0;
  if (fig) {
    const hv = fig.rig.B.head.getWorldPosition(new THREE.Vector3()), hd = Math.max(0.2, hv.distanceTo(camera.position)); hv.project(camera);
    hx = (hv.x * 0.5 + 0.5) * SEP_W; hy = (0.5 - hv.y * 0.5) * SEP_H; hr = 1.35 * 0.13 * (fig.rig.s || 1) / (hd * Math.tan(camera.fov * Math.PI / 360)) * SEP_H / 2;
  }
  let n = 0, good = 0, area = 0, nb = 0, gb = 0;
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 2; y < SEP_H - 2; y++) for (let x = 2; x < SEP_W - 2; x++) {
    const i = y * SEP_W + x; if (!M[i]) continue; area++;
    for (const [dx, dy] of D) {
      if (M[i + dy * SEP_W + dx]) continue;                         // i is on the outline, facing (dx, dy)
      const inn = i - dy * SEP_W - dx, out = i + 2 * (dy * SEP_W + dx);
      if (!M[inn] || M[out]) continue;
      const g = Math.abs(L[inn] - L[out]) >= 14;
      n++; if (g) good++;
      if (Math.hypot(x - hx, y - hy) > hr) { nb++; if (g) gb++; }
    }
  }
  if (n < 12) return { sep: null, n, area };
  return { sep: good / n, sepBody: fig && nb >= 12 ? gb / nb : null, n, area };
}
