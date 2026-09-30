// camera.js — the camera templates of DESIGN.md, built as keyframes on glide() (C1 paths, speed pinned per key,
// directions low-passed), reading the subject's real position/size/heading from the built scene, varied by the seed
// so repeated moves never look identical, then passed through SAFETY:
//   terrain clearance >= 2 m (6 m when fast), >= 1.2 m from any figure, never inside a solid, speed <= 0.8 x
//   altitude / s near the ground, angular speed <= 45 deg/s, roll <= 8 deg, moving at both ends.
// Local problems are fixed with smooth lift (or side-step) bumps added to the path (Gaussians in t, so the path
// stays C1 and the view direction is unchanged); what bumps cannot fix is re-planned higher/slower/wider
// (relax levels 1..4), and as a last resort the move becomes a safe high flyover. Every change is reported.
import * as THREE from 'three';
import { glide, pchip } from './wcam.js';
import { rng, clamp, lerp, smooth, smoother, deg } from '../lib/shared/util.js';
import { evalAt, LIMITS, POV_LIMITS, EYE_LIMITS, MACRO_LIMITS, describe } from './qa.js';
import { SPACE_TEMPLATES, spaceTarget } from './spacecam.js';   // E4 v2: approach, orbit_planet, map_dive (space targets), fall_through

export const MOVES = ['fpv_flythrough', 'reveal_rise', 'orbit', 'push_in', 'crane_down', 'flyover_high', 'follow', 'pull_back', 'through', 'map_dive', 'pov', 'keys', 'fpv_dive', 'tracking_low', 'dive_under'];
const SPEEDS = { slow: 0.4, medium: 0.55, fast: 0.7 };
const SIDES = { front: 0, right: 90, back: 180, left: -90 };
const dirv = (a) => [Math.sin(a * deg), -Math.cos(a * deg)];                     // compass degrees -> [x, z]
const azOf = (dx, dz) => (Math.atan2(dx, -dz) / deg + 360) % 360;
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// ── subjects ─────────────────────────────────────────────────────────────────────────────────────────────────────
const _box = new THREE.Box3(), _v = new THREE.Vector3();
function itemSubject(it, G, dur) {
  const r = it.res;
  r.root.updateMatrixWorld(true);
  _box.setFromObject(r.root);
  // a cast figure stands inside a root at the origin (the controller places fig.group at `at`): aim at the figure (fix);
  // a vehicle drives its body (anchors.body) inside a root at the origin the same way: aim, track and focus on the body (fix)
  const anchor = (it.section === 'cast' && r.anchors && r.anchors.feet && r.anchors.feet.isObject3D) ? r.anchors.feet
    : (r.anchors && r.anchors.body && r.anchors.body.isObject3D) ? r.anchors.body : r.root;
  const p = anchor.getWorldPosition(new THREE.Vector3());
  let gy = it.aboard ? p.y : G(p.x, p.z);                            // E2 v2: people aboard stand on a deck, not on the sea
  // E4 v2 r3: in a groundless world (space, cloud decks) a thing is measured from its own box, not from the void 10 km below
  const voidK = !it.aboard && gy < -5000 && Number.isFinite(_box.min.y) && _box.min.y > gy + 1000;
  if (voidK) gy = _box.min.y;
  let top = Number.isFinite(_box.max.y) ? _box.max.y - gy : (r.height ?? 2);
  if (it.label) top = Math.max(top, r.height ?? top);
  top = clamp(top, 0.5, voidK ? 1e6 : 400);
  const rad = clamp(r.radius ?? (Number.isFinite(_box.max.x) ? Math.hypot(_box.max.x - _box.min.x, _box.max.z - _box.min.z) / 2 : 2), 0.3, voidK ? 1e6 : 800);
  let heading = it.item?.heading ?? 0;
  const cy = it.label ? top * 0.5 : it.figure ? Math.min(top, 1.9) * 0.62 : top * 0.42;
  const s = { p: [p.x, gy, p.z], top, r: rad, heading, figure: !!it.figure, label: !!it.label, item: it, cy, moving: !!it.moving };
  if (voidK) { const bx = (_box.min.x + _box.max.x) / 2, bz = (_box.min.z + _box.max.z) / 2, dx = bx - p.x, dz = bz - p.z; s.p = [bx, gy, bz]; s.center = (t) => { const xz = s.trackXZ ? s.trackXZ(t) : [p.x, p.z]; return [xz[0] + dx, gy + s.cy, xz[1] + dz]; }; }
  if (it.moving) {
    const HZ = 10, T0 = -0.5, n = Math.ceil((dur + 1) * HZ) + 1, tr = [];
    for (let k = 0; k < n; k++) {
      const t = T0 + k / HZ;
      try { r.update && r.update(t, t); } catch (e) { /* */ }
      if (typeof r.members === 'function') { const M = r.members(t); let x = 0, z = 0; for (const m of M) { x += m[0]; z += m[1]; } tr.push([x / M.length, z / M.length]); }
      else { r.root.updateMatrixWorld(true); anchor.getWorldPosition(_v); tr.push([_v.x, _v.z]); }
    }
    try { r.update && r.update(0, 0); } catch (e) { /* */ }
    s.trackXZ = (t) => { const f = clamp((t - T0) * HZ, 0, n - 1), k = Math.min(n - 2, Math.floor(f)), u = f - k; return [lerp(tr[k][0], tr[k + 1][0], u), lerp(tr[k][1], tr[k + 1][1], u)]; };
    if (it.aboard) { const ys = []; for (let k = 0; k < n; k++) { const t = T0 + k / HZ; try { r.update && r.update(t, t); } catch (e) { /* */ } r.root.updateMatrixWorld(true); anchor.getWorldPosition(_v); ys.push(_v.y); } try { r.update && r.update(0, 0); } catch (e) { /* */ }
      s.center = (t) => { const xz = s.trackXZ(t), f = clamp((t - T0) * HZ, 0, n - 1), k = Math.min(n - 2, Math.floor(f)); return [xz[0], lerp(ys[k], ys[k + 1], f - k) + s.cy, xz[1]]; }; }
    const a = s.trackXZ(0), b = s.trackXZ(Math.min(dur, 2));
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.2) s.heading = azOf(b[0] - a[0], b[1] - a[1]);
  }
  // E4 v2: a body in space (no ground under it) or a builder that knows its own focus point: framed about that point
  if (typeof r.subjectAt === 'function') { const c0 = r.subjectAt(0); s.center = (t) => r.subjectAt(t); s.p = [c0[0], c0[1] - (r.subjectCy ?? 0), c0[2]]; s.cy = r.subjectCy ?? 0; if (r.subjectTop) s.top = r.subjectTop; }
  return s;
}
export function subjectOf(target, S, G, dur, warnings, W = null) {
  let s = null;
  if (Array.isArray(target) && target.length >= 2) { const x = +target[0], z = +target[target.length === 3 ? 2 : 1]; s = { p: [x, G(x, z), z], top: 2, r: 3, heading: 0, cy: 1.2 }; }
  else if (typeof target === 'string' && target !== 'stage') {
    const find = (k) => S.byRef[k] || S.byRef['ref:' + k.replace(/^ref:/, '')] || S.byRef[k.replace(/^ref:/, 'cast:')];
    const it = find(target);
    if (it) s = itemSubject(it, G, dur);
    else {
      // E2 v2: '<ref>.<anchor>' (a ship's stern, a funnel top, a davit): the named point itself, moving with the item
      // (and with her halves when she breaks), framed as a part of it rather than the whole
      const m = /^(.+)\.([A-Za-z_]\w*)$/.exec(target), it2 = m ? find(m[1]) : null, an = it2 && it2.res.anchors ? it2.res.anchors[m[2]] : null;
      if (an && (an.isObject3D || an.isVector3 || typeof an === 'function' || Array.isArray(an))) s = anchorSubject(it2, m[2], G, dur, W);
      else warnings.push(`camera.target '${target}' not found${it2 ? ` (no point anchor '${m[2]}' on ${it2.kind})` : ''}; using the stage`);
    }
  }
  if (!s) {
    // the stage: the origin, sized by what stands near it
    let top = 2, r = 4, heading = 0, fig = null;
    for (const it of S.items) {
      const p = it.res.root.position; const d = Math.hypot(p.x, p.z);
      if (d < 30) { top = Math.max(top, Math.min(it.res.height ?? 2, 40)); r = Math.max(r, Math.min(d + (it.res.radius ?? 1), 40)); if (!fig && it.figure) fig = it; }
    }
    if (fig) heading = fig.item?.heading ?? 0;
    s = { p: [0, G(0, 0), 0], top, r, heading, cy: Math.min(top, 3) * 0.6 };
  }
  if (!s.center) s.center = (t) => { const xz = s.trackXZ ? s.trackXZ(t) : [s.p[0], s.p[2]]; return [xz[0], G(xz[0], xz[1]) + s.cy, xz[1]]; };
  return s;
}
function anchorSubject(it, name, G, dur, W) {
  const tr = itemTrack(it, G, W, dur, name), p0 = tr.center(0), g0 = G(p0[0], p0[2]);
  const r = clamp((it.res.radius ?? 10) * 0.12, 5, 40);
  // the point itself, kept at the surface once it goes under (the lens stays on the water where she went down)
  // a sinking ship's point can jerk (the stern falling back): the lens follows it low-passed over +-0.35 s
  const HZ = 30, T0 = -0.5, n = Math.ceil((dur + 1) * HZ) + 1, raw = [], sm = [];
  for (let k = 0; k < n; k++) { const c = tr.center(T0 + k / HZ); raw.push([c[0], Math.max(c[1], G(c[0], c[2]) + 1), c[2]]); }
  for (let k = 0; k < n; k++) { const a = [0, 0, 0]; let w = 0; for (let j = -21; j <= 21; j++) { const i = clamp(k + j, 0, n - 1), g = Math.exp(-(j * j) / (2 * 10.5 * 10.5)); a[0] += raw[i][0] * g; a[1] += raw[i][1] * g; a[2] += raw[i][2] * g; w += g; } sm.push([a[0] / w, a[1] / w, a[2] / w]); }
  const cAt = (t) => { const f = clamp((t - T0) * HZ, 0, n - 1.000001), k = Math.floor(f); return mix3(sm[k], sm[k + 1], f - k); };
  const s = { p: [p0[0], g0, p0[2]], top: clamp(p0[1] - g0 + 8, 4, 90), r, heading: it.item?.heading ?? 0, item: it, cy: p0[1] - g0, moving: !!tr.moving, anchor: name, center: tr.moving ? cAt : (t) => { const c = tr.center(t); return [c[0], Math.max(c[1], G(c[0], c[2]) + 1), c[2]]; } };
  if (tr.moving) s.trackXZ = (t) => { const c = tr.center(t); return [c[0], c[2]]; };
  const kp = it.res.kin && typeof it.res.kin.pose === 'function' ? it.res.kin.pose : null;       // a ship's axis, not the anchor's drift
  if (kp) { const q = kp(W ? W(0) : 0); s.heading = azOf(q.dir[0], q.dir[1]); }
  return s;
}
// a long vehicle (a ship): {L, B} — orbit and flyover arc beside it instead of spinning it in the frame (E2 v2)
function longSubject(s) {
  const r = s.item && s.item.res; if (!r || s.anchor) return null;
  const L = +r.length || 0, B = +r.beam || 0;
  return L > 25 && B > 0 && L > B * 3 ? { L, B } : null;
}

// distance at which a subject of height h / radius r fills ~frac of the frame height
function frameDist(s, fov, frac = 0.45) {
  const size = Math.max(s.top, s.r * 1.1, 1.2);
  return Math.max(size / (2 * Math.tan(fov * deg / 2) * frac), s.r + 3);
}

// time stations so that speed ~ vf x altitude, rescaled to [T0, T1]
function stationTimes(pts, alts, T0, T1) {
  const w = [0];
  for (let k = 1; k < pts.length; k++) {
    const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2], (pts[k][1] - pts[k - 1][1]) * 0.6);
    w.push(w[k - 1] + d / Math.max(1.5, (alts[k] + alts[k - 1]) / 2));
  }
  const tot = w[w.length - 1] || 1;
  return w.map((x) => T0 + (T1 - T0) * x / tot);
}

// ── templates: each returns {keys:[{pos,look,fov}], times:[[t,k]], lookFn?, logAlt?, bank, focus?, dofAuto} ──────
function T_fpv(P) {
  const { D, s, G, vf, fov, R, alt, T0, T1 } = P;
  const end = P.end || 'continue';
  let a0 = Math.max(2.6, alt[0] ?? 12), a1 = Math.max(2.4, alt[1] ?? 3.5);
  // with things to pass, come in over them (unless the spec fixed the side)
  let ang = P.camAng;
  const PS = P.passes || [];
  if (PS.length && !P.sideName) {
    let cx = 0, cz = 0; for (const q of PS) { cx += q.p[0] - s.p[0]; cz += q.p[2] - s.p[2]; }
    if (Math.hypot(cx, cz) > 5) ang = azOf(cx, cz) + (R() - 0.5) * 16;
  }
  const from = dirv(ang), perp = [-from[1], from[0]];
  let L = vf * ((a0 + a1) / 2) * D;
  let s0, s1;
  const passMax = Math.max(0, ...PS.map((q) => (q.p[0] - s.p[0]) * from[0] + (q.p[2] - s.p[2]) * from[1] + Math.min(q.r, 25)));
  if (end === 'settle') { const dEnd = Math.max(3 * s.r + 2, 8, a1 * 2.5); s1 = dEnd; s0 = Math.max(dEnd + L, passMax + 15); }
  else { s0 = Math.max(L * 0.72, passMax + 15); s1 = -L * 0.28; }
  const need = s0 - s1;
  if (need > L * 1.08) {
    // reaching the passes at a legal speed means flying higher (speed <= 0.8 x altitude)
    const k = need / L; a0 *= k; a1 *= Math.min(k, 2.5);
    P.notes.push(`fpv: altitude x${k.toFixed(2)} to reach the passes at a legal speed`);
    L = need;
  }
  const side = R() < 0.5 ? -1 : 1, amp = Math.min(L * 0.05, 10) * (0.5 + R()), ph = R();
  // each pass on its own side, alternating (weaving), the first opposite to the subject's side
  const passes = (P.passes || []).map((q, i) => { const dx = q.p[0] - s.p[0], dz = q.p[2] - s.p[2]; return { sAx: dx * from[0] + dz * from[1], lat: dx * perp[0] + dz * perp[1], r: Math.min(q.r, 25), side: (i % 2 ? side : -side) }; });
  const n = 9, pts = [], alts = [];
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1), sAx = lerp(s0, s1, u);
    let a = lerp(a0, a1, smooth(u));
    if (end === 'rise') a = lerp(a, Math.max(a1 * 3, 25), smooth((u - 0.62) / 0.38));
    let lat = amp * Math.sin((u * 1.25 + ph) * Math.PI * 2);
    // never through the subject: pass it on one side
    const nearS = Math.exp(-Math.pow(sAx / (s.r + 12), 2));
    const needS = s.r + 3 + a * 0.3;
    if (end !== 'settle') lat = lerp(lat, side * Math.max(Math.abs(lat), needS), nearS);
    for (const q of passes) {
      const w = Math.exp(-Math.pow((sAx - q.sAx) / (q.r + 18), 2));
      const want = q.lat + q.side * (q.r + 3 + a * 0.3);
      lat = lerp(lat, want, w);
    }
    const x = s.p[0] + from[0] * sAx + perp[0] * lat, z = s.p[2] + from[1] * sAx + perp[1] * lat;
    pts.push([x, G(x, z) + a, z]); alts.push(a);
  }
  const times = stationTimes(pts, alts, T0, T1);
  const keys = pts.map((p, k) => {
    const nx = pts[Math.min(n - 1, k + 1)], pv = pts[Math.max(0, k - 1)];
    const tan = nrm3([nx[0] - pv[0], 0, nx[2] - pv[2]]);
    return { pos: p, look: [p[0] + tan[0] * 30, p[1] - alts[k] * 0.55 + (end === 'rise' && k > n * 0.6 ? -alts[k] * 0.5 : 0), p[2] + tan[2] * 30], fov };
  });
  const Tc = s.center;
  const lookFn = end === 'settle' ? (t, base) => mix3(base, Tc(t), smooth((t - 0.5 * D) / (0.45 * D)))
    : end === 'rise' ? (t, base) => mix3(base, Tc(t), smooth((t - 0.6 * D) / (0.4 * D)) * 0.85) : null;
  return { keys, times: times.map((t, k) => [t, k]), lookFn, bank: true, dofAuto: end === 'settle' };
}

function findOccluder(P) {
  const { s, S } = P;
  if (P.passes && P.passes.length) return P.passes[0];
  let best = null, bestScore = -1;
  for (const it of S.items) {
    if (it === s.item || it.figure || it.label) continue;
    const p = it.res.root.position, d = Math.hypot(p.x - s.p[0], p.z - s.p[2]);
    const top = it.res.height ?? 3;
    if (d < 12 || d > 160 || top < 2.5) continue;
    const a = azOf(p.x - s.p[0], p.z - s.p[2]);
    const off = Math.abs(((a - P.camAng + 540) % 360) - 180);
    const sc = (180 - off) / 180 + top / 40;
    if (sc > bestScore) { bestScore = sc; best = { p: [p.x, P.G(p.x, p.z), p.z], r: Math.max(1, it.res.radius ?? 3), top, item: it }; }
  }
  return best;
}
function T_reveal(P) {
  const { D, s, G, vf, fov, alt, T0, T1 } = P;
  const O = findOccluder(P);
  const a0 = Math.max(2.4, alt[0]), a1 = Math.max(a0 + 6, alt[1]);
  let pts, alts, lookAt;
  if (O) {
    const ang = azOf(O.p[0] - s.p[0], O.p[2] - s.p[2]), from = dirv(ang);
    const dO = Math.hypot(O.p[0] - s.p[0], O.p[2] - s.p[2]);
    // start well behind the occluder (its top edge against the sky), be above its near face before reaching it,
    // cross it with room to spare, and settle high enough beyond it to hold the stage
    const back = Math.max(O.r + O.top * 1.6 + 6, a0 * 4 + 10), face = O.r * 0.85 + 3;
    const over = Math.max(O.top + Math.max(6, O.top * 0.35), a1 * 0.75);
    const dEnd = clamp(dO * 0.4, s.r + 6, Math.max(s.r + 6, dO - O.r - 6));
    const at = (d) => [O.p[0] + from[0] * d, 0, O.p[2] + from[1] * d];
    const P2 = [s.p[0] + from[0] * dEnd, 0, s.p[2] + from[1] * dEnd];
    const Pl = [at(back), at(lerp(back, face, 0.55)), at(face), at(0), mix3(at(-O.r - 2), P2, 0.35), P2];
    alts = [a0, lerp(a0, over, 0.4), over - 0.5, over, lerp(over, a1, 0.6), a1];
    pts = Pl.map((p, k) => [p[0], G(p[0], p[2]) + alts[k], p[2]]);
    const topY = O.p[1] + O.top;
    pts[2][1] = Math.max(pts[2][1], topY + 3.5); pts[3][1] = Math.max(pts[3][1], topY + 4.5); pts[4][1] = Math.max(pts[4][1], Math.min(pts[3][1], topY + 2));
    const edge = [O.p[0] - from[0] * (O.r + 20), topY + 1.5, O.p[2] - from[1] * (O.r + 20)];
    lookAt = (t) => mix3(edge, s.center(t), smooth((t - 0.2 * D) / (0.5 * D)));
  } else {
    const from = dirv(P.camAng), d0 = Math.max(40, a1 * 3), d1 = Math.max(frameDist(s, fov) * 1.1, d0 * 0.55);
    pts = []; alts = [];
    for (let k = 0; k < 5; k++) { const u = k / 4, d = lerp(d0, d1, u), a = lerp(a0, a1, smooth(u)); const x = s.p[0] + from[0] * d, z = s.p[2] + from[1] * d; pts.push([x, G(x, z) + a, z]); alts.push(a); }
    lookAt = (t) => { const c = camBase(t); const f = smooth((t - 0.1 * D) / (0.6 * D)); const ahead = [lerp(c.pos[0], s.p[0], 0.25), G(s.p[0], s.p[2]) - 4, lerp(c.pos[2], s.p[2], 0.25)]; return mix3(ahead, s.center(t), f); };
  }
  let camBase = null;
  const times = stationTimes(pts, alts, T0, T1);
  const keys = pts.map((p) => ({ pos: p, look: s.center(0), fov }));
  return { keys, times: times.map((t, k) => [t, k]), lookFn: (t, base, cb) => { camBase = cb; return lookAt(t); }, dofAuto: true, bank: false };
}

function T_orbit(P) {
  const { D, s, G, fov, alt, T0, T1, R, K } = P;
  const LS = longSubject(s);
  let d = frameDist(s, fov, 0.38) * K.dist;
  let arc = Math.min(200, 180 * (0.85 + R() * 0.3)) * K.arc;
  const dir = R() < 0.5 ? -1 : 1;
  let a0 = Math.max(2.4, alt[0] ?? Math.max(3, s.top * 0.6)) * K.alt, a1 = Math.max(a0, (alt[1] ?? Math.max(5, s.top * 0.9)) * K.alt);
  if (LS) {                                                 // E2 v2: a ship turns slowly in the frame (<= 9 deg/s), seen from the side, horizon in frame
    const hf = Math.atan(Math.tan(fov * deg / 2) * 16 / 9);                  // her length ~70 % of the frame width, not a speck
    d = Math.max(LS.L * 0.62 + 25, (LS.L / 0.72) / (2 * Math.tan(hf)) * K.dist); const arcMax = 9 * (T1 - T0);
    if (arc > arcMax) { P.notes.push(`orbit: a ${LS.L.toFixed(0)} m ship: the arc is ${arcMax.toFixed(0)} deg (<= 9 deg/s) beside her, not a spin`); arc = arcMax; }
    const aMax = d * 0.42; if (a1 > aMax) { a1 = Math.max(a0, aMax); } if (a0 > aMax) a0 = aMax;
  }
  const start = P.camAng - dir * arc / 2;
  const n = 9, keys = [];
  const base = Math.max(s.p[1], G(s.p[0], s.p[2]));
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1), a = start + dir * arc * u, v = dirv(a);
    const dd = d * (1 + 0.06 * Math.sin(u * Math.PI));                // breathe a little in the middle
    const oc = s.trackXZ ? s.trackXZ(lerp(T0, T1, u)) : [s.p[0], s.p[2]];   // E2 v2: orbit a moving subject where it is
    const x = oc[0] + v[0] * dd, z = oc[1] + v[1] * dd;
    const h = lerp(a0, a1, smooth(u));
    keys.push({ pos: [x, Math.max(G(x, z), base) + h, z], look: s.center(lerp(T0, T1, u)), fov });
  }
  const times = keys.map((_, k) => [lerp(T0, T1, k / (n - 1)), k]);
  return { keys, times, lookFn: (t) => s.center(t), dofAuto: true, bank: false, lambda: 0.02, rel: movingRel(P) };
}

function T_push(P, reverse = false) {
  const { D, s, G, fov, alt, T0, T1, R, K } = P;
  const df = frameDist(s, fov, 0.5);
  const minD = s.r + (s.figure ? 1.2 + 1.3 : 2.5);
  let dFar = Math.max(df * 1.7, minD + 8) * K.dist, dNear = Math.max(df * 0.8, minD) * Math.max(1, K.dist * 0.9);
  if (reverse) { dNear = Math.max(df * 0.65, minD); dFar = Math.max(df * 3.5, 40) * K.dist; }
  const aNear = Math.max(2.2, (reverse ? alt[0] : alt[1]) ?? Math.max(2.2, Math.min(s.top * 0.85, 12))) * (reverse ? 1 : K.alt);
  const aFar = Math.max(2.4, (reverse ? alt[1] : alt[0]) ?? (reverse ? Math.max(18, dFar * 0.45) : Math.max(2.5, Math.min(s.top * 1.1, 16)))) * K.alt;
  const drift = (R() - 0.5) * 16, n = 6, keys = [];
  const base = s.p[1];
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1), f = reverse ? u : 1 - u;          // f: 1 = far, 0 = near
    const d = lerp(dNear, dFar, f), a = P.camAng + drift * (f - 0.5), v = dirv(a);
    const x = s.p[0] + v[0] * d, z = s.p[2] + v[1] * d;
    const h = reverse ? Math.exp(lerp(Math.log(aNear), Math.log(aFar), u)) : lerp(aFar, aNear, smooth(u));
    keys.push({ pos: [x, Math.max(G(x, z), base) + h, z], look: s.center(0), fov });
  }
  // push-in decelerates, pull-back accelerates; both keep moving at the ends
  const tau = (u) => reverse ? (-0.4 + Math.sqrt(0.16 + 2.4 * u)) / 1.2 : (1.6 - Math.sqrt(2.56 - 2.4 * u)) / 1.2;
  const times = keys.map((_, k) => [lerp(T0, T1, tau(k / (n - 1))), k]);
  return { keys, times, lookFn: (t) => s.center(t), dofAuto: true, bank: false, logAlt: reverse ? 0.5 : 0, lambda: 0.05, carry: movingRel(P) };
}

function T_crane(P) {
  const { D, s, G, fov, alt, T0, T1, R, K } = P;
  const a0 = Math.max(12, (alt[0] ?? Math.max(28, s.top * 3)) * K.alt), a1 = Math.max(2.2, (alt[1] ?? 2.2) * Math.sqrt(K.alt));
  const df = frameDist(s, fov, 0.5) * K.dist;
  const d0 = Math.max(df * 0.8, a0 * 0.45), d1 = Math.max(df, s.r + (s.figure ? 3.2 : 4));
  const drift = (R() - 0.5) * 20, n = 6, keys = [];
  const base = s.p[1];
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1), v = dirv(P.camAng + drift * (u - 0.5));
    const d = lerp(d0, d1, smooth(u)), h = Math.exp(lerp(Math.log(a0), Math.log(a1), u));
    const x = s.p[0] + v[0] * d, z = s.p[2] + v[1] * d;
    keys.push({ pos: [x, Math.max(G(x, z), base) + h, z], look: s.center(0), fov });
  }
  return { keys, times: [[T0, 0], [T1, n - 1]], lookFn: (t) => s.center(t), dofAuto: true, bank: false, logAlt: 1, groundY: base, lambda: 0.05, carry: movingRel(P) };
}

function T_flyover(P) {
  const { D, s, G, fov, alt, T0, T1, R, K, vf, S } = P;
  const extent = Math.max(60, ...S.items.map((it) => Math.hypot(it.res.root.position.x, it.res.root.position.z) + (it.res.radius ?? 0)));
  const a = Math.max(40, (alt[0] ?? clamp(extent * 0.45, 80, 260)) * K.alt);
  const LS = longSubject(s);
  let L = vf * a * D;
  let travel = P.camAng + 90 * (R() < 0.5 ? -1 : 1);
  let off = a * 1.05;
  if (LS) {                                                 // E2 v2: along a ship's axis, off her side, the view turning <= 8 deg/s
    travel = s.heading + (R() < 0.5 ? 0 : 180); off = Math.max(off, LS.L * 0.75, a * 2.2);
    L = Math.min(L, 0.14 * off * D);
    P.notes.push(`flyover_high: beside a ${LS.L.toFixed(0)} m ship, parallel to her, ${off.toFixed(0)} m off, view turning <= 8 deg/s`);
  }
  const tv = dirv(travel), back = dirv(LS ? s.heading + 90 * (((P.camAng - s.heading + 540) % 360 - 180) >= 0 ? 1 : -1) : P.camAng);
  const n = 5, keys = [];
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1), sAx = lerp(-L / 2, L / 2, u) + L * 0.08;
    const x = s.p[0] + back[0] * off + tv[0] * sAx, z = s.p[2] + back[1] * off + tv[1] * sAx;
    const h = a * (1 + 0.06 * Math.sin(u * Math.PI));
    keys.push({ pos: [x, Math.max(G(x, z), s.p[1]) + h, z], look: s.center(0), fov });
  }
  const times = keys.map((_, k) => [lerp(T0, T1, k / (n - 1)), k]);
  // look a little ahead of the stage along the travel, so it is a traverse and not a pure pan
  const lead = L * 0.12;
  return { keys, times, lookFn: (t) => { const c = s.center(t); const f = (t - D / 2) / D; return [c[0] + tv[0] * lead * f * -1, c[1], c[2] + tv[1] * lead * f * -1]; }, bank: false, lambda: 0.05 };
}

function T_follow(P) {
  const { D, s, G, fov, alt, T0, T1, R, K } = P;
  const sideSign = P.sideName === 'left' ? -1 : P.sideName === 'right' ? 1 : (R() < 0.5 ? -1 : 1);
  // a formation is followed from beside its flank, not from where the whole column fits the frame
  const half = s.item?.item?.size ? +s.item.item.size[0] / 2 : (s.item?.section === 'groups' ? Math.min(s.r * 0.35, 8) : s.r);
  const d = (s.item?.section === 'groups' ? Math.max(half + 7, 11) : Math.max(frameDist(s, fov, 0.45) * 0.9, s.r + (s.figure ? 3 : 5))) * K.dist;
  const a = Math.max(2.4, (alt[0] ?? Math.max(3, s.top * 0.9))) * K.alt;
  const a1 = Math.max(2.4, (alt[1] ?? a) * K.alt);
  const n = Math.max(5, Math.round(D / 1.2) + 1), keys = [], times = [];
  const hd = (t) => { if (!s.trackXZ) return s.heading; const p = s.trackXZ(t - 0.5), q = s.trackXZ(t + 0.5); return Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.05 ? azOf(q[0] - p[0], q[1] - p[1]) : s.heading; };
  const still = !s.trackXZ;
  const trackDir = dirv(s.heading + 90 * sideSign);
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1), t = lerp(T0, T1, u);
    const c = s.trackXZ ? s.trackXZ(t) : [s.p[0], s.p[2]];
    // from a 3/4 back view drifting to the side view
    const rel = hd(t) + sideSign * lerp(125, 95, smooth(u));
    const v = dirv(rel);
    let x = c[0] + v[0] * d, z = c[1] + v[1] * d;
    if (still) { const tr = (u - 0.5) * a * 0.35 * D; x += trackDir[0] * 0 + dirv(s.heading)[0] * tr; z += dirv(s.heading)[1] * tr; }
    keys.push({ pos: [x, G(x, z) + lerp(a, a1, smooth(u)), z], look: s.center(t), fov });
    times.push([t, k]);
  }
  return { keys, times, lookFn: (t) => { const c = s.center(t); if (!s.trackXZ) return c; const p = s.trackXZ(t + 0.6); return [lerp(c[0], p[0], 0.5), c[1], lerp(c[2], p[1], 0.5)]; }, dofAuto: true, bank: false, lambda: 0.05, rel: movingRel(P) };
}

function openingOf(P) {
  const { s, G } = P;
  const it = s.item;
  const op = it?.res?.anchors?.opening || it?.res?.anchors?.door || it?.res?.anchors?.arch || it?.res?.anchors?.window;
  if (op && op.pos) return { c: op.pos, n: op.normal ? nrm3(op.normal) : [...dirv(s.heading).slice(0, 1), 0, dirv(s.heading)[1]], w: op.w ?? 3, h: op.h ?? 3 };
  if (it && it.label) {
    // between the two letters nearest the middle of the word, through the text plane
    const boxes = [];
    // measure the letters standing (they may still be under the ground at t = 0)
    const tR = clamp((Array.isArray(it.item.t) ? +it.item.t[0] || 0 : 0) + 2.5, 0, P.D);
    try { it.res.update && it.res.update(tR, tR); } catch (e) { /* */ }
    it.res.root.updateMatrixWorld(true);
    it.res.root.traverse((o) => { if (o.isMesh && o.visible !== false && o.name !== 'contactShadow') { const b = new THREE.Box3().setFromObject(o); boxes.push(b); } });
    try { it.res.update && it.res.update(0, 0); } catch (e) { /* */ }
    const hd = (it.item.heading ?? 180), ax = dirv(hd + 90);
    const proj = (b) => { const c = b.getCenter(new THREE.Vector3()); return c.x * ax[0] + c.z * ax[1]; };
    boxes.sort((a, b) => proj(a) - proj(b));
    const minY = Math.min(...boxes.map((b) => b.min.y));
    const main = boxes.filter((b) => b.max.y - minY > (it.res.height ?? 10) * 0.55);
    const L = main.length >= 2 ? main : boxes;
    let best = null;
    for (let k = 0; k < L.length - 1; k++) {
      const a = L[k], b = L[k + 1];
      const ea = Math.max(...[a.min, a.max].flatMap((p) => [p.x * ax[0] + p.z * ax[1]]));
      const sb = Math.min(...[b.min, b.max].flatMap((p) => [p.x * ax[0] + p.z * ax[1]]));
      const gap = sb - ea, mid = Math.abs(k + 0.5 - L.length / 2);
      const score = gap - mid * 0.3;
      if (gap > 0.4 && (!best || score > best.score)) {
        const ca = a.getCenter(new THREE.Vector3()), cb = b.getCenter(new THREE.Vector3());
        const cx = (ca.x + cb.x) / 2, cz = (ca.z + cb.z) / 2;
        const lo = Math.max(a.min.y, b.min.y), hi = Math.min(a.max.y, b.max.y);
        best = { score, c: [cx, Math.max(G(cx, cz) + 2.2, lerp(lo, hi, 0.45)), cz], n: [dirv(hd)[0], 0, dirv(hd)[1]], w: gap, h: hi - lo };
      }
    }
    if (best && best.w >= 2 * LIMITS.margin + 1.0) return best;
    // letters set too tight to pass between: skim over the lettering instead, just above the tops
    if (boxes.length) {
      const bb = boxes.reduce((a, b) => a.union(b), boxes[0].clone());
      const c = bb.getCenter(new THREE.Vector3());
      P.notes.push(`through: gaps between the letters are too narrow (${best ? best.w.toFixed(1) : 0} m); skimming over the lettering`);
      return { c: [c.x, bb.max.y + 2.5, c.z], n: [dirv(hd)[0], 0, dirv(hd)[1]], w: 4, h: 3, over: true };
    }
  }
  return null;
}
function T_through(P) {
  const { D, s, G, fov, T0, T1, vf, R, warnings } = P;
  const op = openingOf(P);
  if (!op) { warnings.push('camera.through: target has no opening (anchors.opening) or letter gap; flying close past it instead'); return T_fpv({ ...P, end: 'continue' }); }
  let n = nrm3([op.n[0], 0, op.n[2]]);
  // come from the side the camera template asked for (front = the opening's facing side)
  const camSide = dirv(P.camAng);
  if (n[0] * camSide[0] + n[2] * camSide[1] < 0) n = mul3(n, -1);
  const h = Math.max(2.4, op.c[1] - G(op.c[0], op.c[2]));
  const v = Math.min(vf * Math.max(h, 4), Math.max(2, 0.8 * h * 0.9));
  const L = v * D;
  const before = L * 0.58, after = L * 0.42;
  const pts = [];
  const nk = 7;
  for (let k = 0; k < nk; k++) {
    const u = k / (nk - 1), sAx = lerp(before, -after, u);
    const x = op.c[0] + n[0] * sAx, z = op.c[2] + n[2] * sAx;
    const y = Math.max(G(x, z) + 2.2, op.c[1] + (sAx > 0 ? Math.min(3, sAx * 0.04) : 0));
    pts.push([x, y, z]);
  }
  const keys = pts.map((p) => ({ pos: p, look: [p[0] - n[0] * 30, p[1] - 1.5, p[2] - n[2] * 30], fov }));
  const times = keys.map((_, k) => [lerp(T0, T1, k / (nk - 1)), k]);
  return { keys, times, lookFn: null, bank: false, through: op, lambda: 0.1 };
}


// ── pov: a first-person run (the hook) — hand-held, deterministic in t ─────────────────────────────────────────────
// camera: { move: 'pov', target: <the threat>, side (where the run starts relative to it), path: [[x, z], ...] (optional,
// else straight away from the target), speed: m/s | slow|medium|fast (4.2/5.2/6.4), eye: 1.62, start_dist: 25,
// glances: [t...] (look back at the target), stumbles: [t...], breath: Hz (0.8), bob: m (0.045) }.
// Checked against POV_LIMITS (qa.js): eye >= 1.3 m above the ground, human sprint speed, eased head turns <= 170 deg/s,
// roll <= 8 deg, never inside a solid, clear of figures, moving at both ends.
function T_pov(P) {
  const { D, s, G, R } = P;
  const c = P.cam || {};
  const V = typeof c.speed === 'number' ? clamp(c.speed, 1.5, 8) : ({ slow: 4.2, medium: 5.2, fast: 6.4 })[c.speed] ?? 5.2;
  const eye = clamp(+c.eye || 1.62, 1.35, 2.0), BOB = clamp(c.bob ?? 0.045, 0, 0.1), BR = c.breath ?? 0.8;
  let pts;
  if (Array.isArray(c.path) && c.path.length >= 2) pts = c.path.map((q) => [+q[0], +q[q.length === 3 ? 2 : 1]]);
  else {
    const d = dirv(P.camAng), st = [s.p[0] + d[0] * (c.start_dist ?? 25), s.p[2] + d[1] * (c.start_dist ?? 25)], L = V * (D + 2) * 1.2 + 10;
    pts = [st, [st[0] + d[0] * L * 0.5 + (R() - 0.5) * L * 0.06, st[1] + d[1] * L * 0.5 + (R() - 0.5) * L * 0.06], [st[0] + d[0] * L, st[1] + d[1] * L]];
  }
  // densify (Catmull-Rom) and measure
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 24; k++) { const t = k / 24, t2 = t * t, t3 = t2 * t; dense.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); }
  }
  dense.push(pts[pts.length - 1]);
  const acc = [0]; for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = acc[acc.length - 1];
  const at = (sd) => {
    const x = clamp(sd, 0, total); let lo = 0, hi = acc.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] <= x) lo = m; else hi = m; }
    const u = (x - acc[lo]) / Math.max(1e-6, acc[hi] - acc[lo]);
    const dx = dense[hi][0] - dense[lo][0], dz = dense[hi][1] - dense[lo][1], l = Math.hypot(dx, dz) || 1;
    return { p: [lerp(dense[lo][0], dense[hi][0], u), lerp(dense[lo][1], dense[hi][1], u)], d: [dx / l, dz / l] };
  };
  const stumbles = (Array.isArray(c.stumbles) ? c.stumbles : [D * 0.64]).map(Number);
  const glances = (Array.isArray(c.glances) ? c.glances : [D * 0.3]).map(Number);
  const gauss = (x) => Math.exp(-x * x);
  const stumbleK = (t) => stumbles.reduce((a, ts) => a + gauss((t - ts) / 0.26), 0);
  // speed with a dip in each stumble, integrated at 240 Hz so the ground speed never jumps
  const HZ = 240, T0 = -1, N = Math.ceil((D + 2) * HZ) + 2, S = new Float32Array(N);
  for (let i = 1; i < N; i++) { const t = T0 + (i - 1) / HZ; S[i] = S[i - 1] + V * (1 - 0.45 * clamp(stumbleK(t + 0.1))) / HZ; }
  const sAt = (t) => { const f = clamp((t - T0) * HZ, 0, N - 1.001), i = Math.floor(f); return lerp(S[i], S[i + 1], f - i) - S[Math.round(-T0 * HZ)]; };
  const smooth5 = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
  const sm3 = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  // glance_dur (s, default 1.1): how long the head takes to turn; glance_max (deg, default 132): how far it may turn
  const GD = clamp(+c.glance_dur || 1.1, 0.5, 3), GM = clamp(+c.glance_max || 132, 30, 180) * Math.PI / 180;
  const glanceK = (t) => glances.reduce((a, tg) => Math.max(a, sm3((t - tg + GD) / GD) * (1 - sm3((t - tg - 0.4) / GD))), 0);
  const f = 2.7 * Math.pow(V / 5.2, 0.35);                                  // steps per second
  const Tc = s.center;
  const direct = (t) => {
    const A = at(sAt(t)), d = A.d, side = [-d[1], d[0]];
    const ph = 2 * Math.PI * f * t;
    const st = stumbleK(t), sgn = (stumbles.findIndex((ts) => Math.abs(t - ts) < 0.9) % 2) ? -1 : 1;
    const sway = 0.035 * Math.sin(ph / 2) + 0.012 * Math.sin(t * 1.3 + 0.5);
    const x = A.p[0] + side[0] * sway, z = A.p[1] + side[1] * sway;
    const y = G(x, z) + eye - BOB * 0.5 * (1 - Math.cos(ph)) + 0.008 * Math.sin(2 * Math.PI * BR * t) - 0.32 * st;
    // look: forward along the run, pitched by the breath and the stumble; a glance swings the head round to the threat
    const pitch = -0.06 + 0.012 * Math.sin(2 * Math.PI * BR * t + 0.6) + 0.018 * Math.cos(ph) - 0.2 * st;
    let yaw = Math.atan2(d[0], d[1]);
    const g = glanceK(t);
    if (g > 1e-4) {
      const tc = Tc(t), toT = Math.atan2(tc[0] - x, tc[2] - z);
      let dy = toT - yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      dy = clamp(dy, -GM, GM);
      yaw += dy * g;
    }
    const gp = g * 0.12;                                                     // a tall threat: look up a little when turned
    const fx = Math.sin(yaw) * Math.cos(pitch + gp), fz = Math.cos(yaw) * Math.cos(pitch + gp), fy = Math.sin(pitch + gp);
    const roll = 0.02 * Math.sin(ph / 2) + 0.09 * st * sgn;
    return { pos: [x, y, z], look: [x + fx * 10, y + fy * 10, z + fz * 10], fov: P.fov, roll };
  };
  return { direct, keys: [], times: [[-0.25, 0], [D + 0.25, 0]], lookFn: null, bank: false, limits: POV_LIMITS };
}

// ── keys: explicit keyframes from the director (additive; the disasters film) ────────────────────────────────────
// camera: { move: 'keys', keys: [{ t, pos: [x, y, z] | at: [x, z] + alt (m above ground),
//                                  look: [x, y, z] | look_at: [x, z] + look_h (m above ground) | omitted = the target,
//                                  fov }, ...], target (DOF focus; with track: true the look follows it), lambda }
// Keys without t are spaced by path length. The first/last keys are stretched to the handles (-0.25 s, dur + 0.25 s)
// so the camera moves at both ends. The path goes through glide() and the same safety pass as every template.
function T_keys(P) {
  const { D, s, G, fov, T0, T1 } = P;
  const c = P.cam || {};
  const src = Array.isArray(c.keys) ? c.keys : [];
  if (src.length < 2) throw new Error('keys: need at least 2 keys');
  const n = src.length, keys = [];
  const xyz = (a, h) => (a.length === 3 ? a.map(Number) : [+a[0], G(+a[0], +a[1]) + h, +a[1]]);
  src.forEach((k, i) => {
    const pos = Array.isArray(k.pos) ? xyz(k.pos, 0) : xyz(k.at || [0, 0], Number.isFinite(+k.alt) ? +k.alt : 2);
    const tk = Number.isFinite(+k.t) ? +k.t : lerp(0, D, i / (n - 1));
    const look = Array.isArray(k.look) ? xyz(k.look, 0) : Array.isArray(k.look_at) ? xyz(k.look_at, Number.isFinite(+k.look_h) ? +k.look_h : 1.5) : s.center(tk);
    keys.push({ pos, look, fov: Number.isFinite(+k.fov) ? clamp(+k.fov, 12, 90) : fov });
  });
  let times;
  if (src.every((k) => Number.isFinite(+k.t))) times = src.map((k, i) => [+k.t, i]);
  else times = stationTimes(keys.map((k) => k.pos), keys.map((k) => Math.max(2, k.pos[1] - G(k.pos[0], k.pos[2]))), 0, D).map((t, i) => [t, i]);
  // a fov on the keys is a lens track in time (monotone, eased; Q6), not a property of the path
  const lens = src.some((k) => Number.isFinite(+k.fov)) ? lensTrack(keys.map((k, i) => ({ t: times[i][0], fov: k.fov }))) : null;
  if (times[0][0] <= 0.001) times[0][0] = T0;
  if (times[n - 1][0] >= D - 0.001) times[n - 1][0] = T1;
  const track = !!c.track;
  return { keys, times, lookFn: track ? (t) => s.center(t) : null, dofAuto: !!c.target, bank: false, lambda: Number.isFinite(+c.lambda) ? +c.lambda : 0.05, limits: c.limits === 'eye' ? EYE_LIMITS : c.limits === 'macro' ? MACRO_LIMITS : undefined, lens };
}

// E2 v2 (round 4): the subject's displacement since t = 0 when it moves (orbit / follow / push / crane ride with it)
function movingRel(P) { const SP = subjectPose(P); return SP.moving && len3(SP.rel(Math.min(P.D, 2))) > 0.3 ? SP.rel : undefined; }
// a template move too fast for its height near the ground/sea is not lifted (the 22.6 m jump into a top-down view): it
// flies the same path shape over a shorter stretch (warp k < 1, keeping up with a moving subject); the lift stays the
// last resort and is reported as an issue
function fitSpeed(tp, P, probe, D, fast) {
  if (!tp || tp.direct || P.cam?.move === 'keys') return tp;
  const worst = (t2) => { const f = assemble(t2, { bumps: [] }); let w = 0; for (let t = 0; t <= D + 1e-6; t += 1 / 15) { const e = evalAt(f, probe, t, { fast, limits: t2.limits }); if (e.warnings.some((x) => x.rule === 'speed')) w = Math.max(w, e.k.speed / Math.max(0.01, e.limit)); } return w; };
  const w0 = worst(tp);
  if (w0 <= 1) return tp;
  let lo = 0.04, hi = 1, best = null;
  for (let i = 0; i < 10; i++) { const k = (lo + hi) / 2, t2 = { ...tp, warp: k, warpRel: tp.rel || null }; if (worst(t2) <= 1) { best = t2; lo = k; } else hi = k; }
  if (best) { P.notes.push(`speed: the ${P.cam?.move || 'move'} was ${w0.toFixed(1)}x too fast for its height; it flies ${Math.round(best.warp * 100)} % of its path at a legal speed instead of being lifted`); return best; }
  P.notes.push(`speed: the ${P.cam?.move || 'move'} stays too fast for its height even at 4 % of its path`);
  return tp;
}

// ── E2 v2: epic moves around a (moving) subject ────────────────────────────────────────────────────────────────────
// the subject's exact pose at scene time t: {c: [x, z] centre, f: [fx, fz] forward (unit), L length, B beam, top}. Vehicles
// and ships expose kin.pose (world time through P.W); anything else uses the sampled track and the heading.
function subjectPose(P) {
  const { s, G } = P, it = s.item, r = it?.res, Wt = P.W || ((t) => t);
  const kp = r?.kin && typeof r.kin.pose === 'function' ? r.kin.pose : null;
  const L = Math.max(1, r?.length ?? (s.r - 1) * 2), B = Math.max(0.6, r?.beam ?? Math.min(L * 0.25, s.r)), top = s.top;
  const hd = (t) => { if (!s.trackXZ) return dirv(s.heading); const a = s.trackXZ(t - 0.5), b = s.trackXZ(t + 0.5), l = Math.hypot(b[0] - a[0], b[1] - a[1]); return l > 0.05 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : dirv(s.heading); };
  const at = (t) => {
    if (kp) { const q = kp(Wt(t)); return { c: [q.x, q.z], f: q.dir.slice() }; }
    return { c: s.trackXZ ? s.trackXZ(t) : [s.p[0], s.p[2]], f: hd(t) };
  };
  const p0 = at(0);
  const rel = (t) => { const q = at(t); return [q.c[0] - p0.c[0], 0, q.c[1] - p0.c[1]]; };
  return { at, rel, L, B, top, base: s.p[1], moving: !!(kp ? true : s.trackXZ) };
}
// centripetal Catmull-Rom through 3D points, densely sampled with cumulative arc length
function crDense(pts, per = 60) {
  const n = pts.length, ext = (a, b) => a.map((v, i) => 2 * v - b[i]);
  const Q = [ext(pts[0], pts[1]), ...pts, ext(pts[n - 1], pts[n - 2])], out = [];
  for (let i = 1; i < Q.length - 2; i++) {
    const p0 = Q[i - 1], p1 = Q[i], p2 = Q[i + 1], p3 = Q[i + 2];
    const kt = (a, b) => Math.max(1e-3, Math.pow(len3(sub3(b, a)), 0.5));
    const t0 = 0, t1 = kt(p0, p1), t2 = t1 + kt(p1, p2), t3 = t2 + kt(p2, p3);
    for (let k = 0; k < per; k++) {
      const t = lerp(t1, t2, k / per), L2 = (a, b, ta, tb) => a.map((v, j) => ((tb - t) * v + (t - ta) * b[j]) / (tb - ta));
      const A1 = L2(p0, p1, t0, t1), A2 = L2(p1, p2, t1, t2), A3 = L2(p2, p3, t2, t3);
      out.push(L2(L2(A1, A2, t0, t2), L2(A2, A3, t1, t3), t1, t2));
    }
  }
  out.push(pts[n - 1].slice());
  const acc = [0]; for (let i = 1; i < out.length; i++) acc.push(acc[i - 1] + len3(sub3(out[i], out[i - 1])));
  const at = (sd) => { const x = clamp(sd, 0, acc[acc.length - 1]); let lo = 0, hi = acc.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] <= x) lo = m; else hi = m; } return mix3(out[lo], out[hi], (x - acc[lo]) / Math.max(1e-9, acc[hi] - acc[lo])); };
  return { at, total: acc[acc.length - 1], pts: out, acc };
}

// fpv_dive: one smooth spline from high above (altitude[0], 150-400 m) diving at the subject, skimming past it close at
// funnel / rigging height (`pass` anchor or `height`, `skim` m clear of its side), then pulling up (end 'rise', default)
// or away (end 'away'). `approach` 'ahead' (default for a moving subject: it rushes at the camera, a head-on pass) or
// 'astern'. Direct: the "rush" (speed / height) eases in as the drone tips over, holds through the dive and the skim and
// eases out on the pull-up; its peak is fitted to the shot (<= 0.66 x height per second below 80 m, so the safety rule
// holds; the start altitude and the skim length shrink when dur is short) and never peaks near 3x its mean. The lens
// looks along the flight, turned toward the subject ahead of it (so the hull and funnels sweep through one side of the
// frame), banking gently into the curves (<= 7 deg).
function T_dive(P) {
  const { D, s, G, R, K, T0, T1 } = P, c = P.cam || {};
  const SP = subjectPose(P), side = P.sideName === 'left' ? 1 : P.sideName === 'right' ? -1 : (R() < 0.5 ? -1 : 1);
  const Lh = SP.L / 2, base = SP.base ?? 0;
  let passTrack = null;
  if (c.pass) { passTrack = pointOf(c.pass, P.S, G, P.W, D, P.warnings); if (passTrack.name === 'stage') passTrack = null; }
  const q0 = SP.at(0);
  const passA = passTrack ? clamp((passTrack.center(0)[0] - q0.c[0]) * q0.f[0] + (passTrack.center(0)[2] - q0.c[1]) * q0.f[1], -Lh, Lh) : 0;
  const passY = passTrack ? passTrack.center(0)[1] - base : null;
  const hs = clamp(+c.height || passY || Math.max(SP.top * 0.8, 8), 3, 400) * Math.sqrt(K.alt);
  const skim = clamp(+c.skim || Math.max(SP.B * 0.35 + 6, SP.top * 0.3, 8), 2.5, 200) * K.dist;
  const lat = SP.B / 2 + skim;
  const moving = SP.moving && len3(SP.rel(Math.min(D, 2))) > 1;
  const ts = (c.approach ?? (moving ? 'ahead' : 'astern')) === 'ahead' ? -1 : 1;          // travel along the hull: +1 toward the bow
  const A1 = clamp(+(P.alt[1] ?? NaN) || Math.max(SP.top * 1.6, hs + 30), 6, 600) * K.alt;
  let A0 = clamp(+(P.alt[0] ?? NaN) || clamp(SP.L * 1.1, 160, 320), hs + 20, 900);
  let span = Math.max(SP.L * 0.9, 40);
  const Tt = T1 - T0, RMAX = 0.66;
  const hEff = (h) => h / Math.pow(1 + Math.pow(h / 200, 4), 0.25);                    // smooth min(h, 200)
  const rOf = (sg) => (0.3 + 0.7 * smoother(sg / 0.3)) * (1 - 0.45 * smoother((sg - 0.8) / 0.2));
  const build = (A0, span) => {
    // centred on the pass point: dive in from `dAway` before the skim, skim `span` m along the hull, pull out beyond it
    const dAway = Math.max(A0 * 0.9, 60), aS = passA - ts * span / 2, aE = passA + ts * span / 2, out = Math.max(60, A1 - hs);
    const K6 = [
      { u: 0.0, a: aS - ts * dAway * 0.95, l: side * (lat + dAway * 0.4), y: A0 },
      { u: 0.24, a: aS - ts * dAway * 0.45, l: side * (lat + dAway * 0.14), y: lerp(A0, hs, 0.62) },
      { u: 0.42, a: aS, l: side * lat * 1.15, y: hs + Math.max(5, (A0 - hs) * 0.06) },
      { u: 0.58, a: passA, l: side * lat, y: hs },
      { u: 0.74, a: aE, l: side * lat * 1.1, y: hs + (c.end === 'away' ? 2 : Math.max(3, (A1 - hs) * 0.15)) },
      { u: 1.0, a: aE + ts * out * 1.3, l: side * (lat + (c.end === 'away' ? out * 1.2 : out * 0.3)), y: c.end === 'away' ? Math.max(hs + 10, (hs + A1) / 2) : A1 },
    ];
    const place = (k, t) => { const q = SP.at(t), f = q.f, pr = [f[1], -f[0]]; const x = q.c[0] + f[0] * k.a + pr[0] * k.l, z = q.c[1] + f[1] * k.a + pr[1] * k.l; return [x, Math.max(base + k.y, G(x, z) + 3), z]; };
    let tk = K6.map((k) => T0 + k.u * Tt), path = null, prof = null, scPrev = 0.6;
    for (let pass = 0; pass < 4; pass++) {
      const pts = K6.map((k, i) => place(k, tk[i]));
      path = crDense(pts, 80);
      const n = 400, S2 = path.total, cum = [0]; let prev = null;
      const kap = (sd) => { const e = Math.max(2, S2 / n * 2), a = path.at(sd - e), b = path.at(sd), q = path.at(sd + e); const u1 = nrm3(sub3(b, a)), u2 = nrm3(sub3(q, b)); return Math.acos(clamp(dot3(u1, u2), -1, 1)) / e; };
      for (let i = 0; i <= n; i++) {
        const sd = S2 * i / n, p = path.at(sd), vr = rOf(i / n) * hEff(Math.max(1, p[1] - G(p[0], p[2])));
        const vk = 0.62 / Math.max(1e-4, kap(sd)) / scPrev;                             // turn-rate cap (0.62 rad/s), in rush units
        const v = 1 / Math.pow(Math.pow(vr, -4) + Math.pow(Math.max(1e-3, vk), -4), 0.25);
        if (prev) cum.push(cum[cum.length - 1] + (S2 / n) / ((v + prev) / 2)); prev = v;
      }
      prof = { cum, n, S2, scale: cum[n] / Tt }; scPrev = Math.max(0.05, prof.scale);
      tk = pts.map((p) => { let best = 0, bd = Infinity; for (let i = 0; i <= n; i++) { const d = len3(sub3(path.at(S2 * i / n), p)); if (d < bd) { bd = d; best = i; } } return T0 + cum[best] / prof.scale; });
      tk[0] = T0; tk[tk.length - 1] = T1;
    }
    return { path, prof, tk };
  };
  let B = build(A0, span), tries = 0;
  const A0req = A0, spanReq = span;
  while (B.prof.scale > RMAX && tries++ < 14) {
    if (span > Math.max(SP.L * 0.3, 50)) span *= 0.8; else A0 = Math.max(hs + 20, A0 * 0.82);
    B = build(A0, span);
  }
  if (A0 < A0req - 1 || span < spanReq - 1) P.notes.push(`fpv_dive: fitted to ${D.toFixed(1)} s at a legal speed: start ${A0.toFixed(0)} m (asked ${A0req.toFixed(0)}), skim ${span.toFixed(0)} m of the hull`);
  if (B.prof.scale > RMAX * 1.12) { P.notes.push(`fpv_dive: no legal dive fits ${D.toFixed(1)} s (needs ${B.prof.scale.toFixed(2)} x height/s); flown as an FPV dart past her instead`); return T_dart(P); }
  if (B.prof.scale > RMAX) P.notes.push(`fpv_dive: still ${B.prof.scale.toFixed(2)} x height per second at its fastest (a longer dur helps)`);
  const { path, prof, tk } = B;
  const sAt = (t) => {
    const x = (t - T0) * prof.scale; const { cum, n, S2 } = prof;
    if (x <= 0) return x / (cum[1] || 1) * (S2 / n);
    if (x >= cum[n]) return S2 + (x - cum[n]) / Math.max(1e-6, cum[n] - cum[n - 1]) * (S2 / n);
    let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= x) lo = m; else hi = m; }
    return S2 * (lo + (x - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo])) / n;
  };
  const posAt = (t) => { const sd = sAt(t); if (sd >= 0 && sd <= path.total) return path.at(sd); const e = sd < 0 ? 0 : path.total, d = sd - e, p = path.at(e), q = path.at(e + (d < 0 ? 1 : -1)); return add3(p, mul3(nrm3(sub3(p, q)), Math.abs(d))); };
  const tan = (t) => nrm3(sub3(posAt(t + 0.06), posAt(t - 0.06)));
  // the lens: along the flight, turned toward the hull ahead of the camera (a point 60 m further along the hull in the
  // direction of travel, kept on the hull), letting go once the camera is past the far end
  const fov = clamp(+c.fov || 62, 30, 100);
  const direct = (t) => {
    const p = posAt(t), tg = tan(t), q = SP.at(t), f = q.f;
    const aCam = (p[0] - q.c[0]) * f[0] + (p[2] - q.c[1]) * f[1];
    const aF = clamp(aCam + ts * 60, -Lh, Lh), F = [q.c[0] + f[0] * aF, base + hs * 0.7, q.c[1] + f[1] * aF];
    const w = 0.6 * (1 - smoother((aCam * ts - (Lh - 30)) / 70));
    const toF = nrm3(sub3(F, p));
    let d = nrm3(add3(mul3(tg, 1 - w), mul3(toF, w)));
    if (d[1] > 0) d = nrm3([d[0], 0.3 * Math.tanh(d[1] / 0.3), d[2]]);                // never stare into the sky (a soft clamp)
    const a = tan(t - 0.3), b = tan(t + 0.3), turn = Math.atan2(a[0] * b[2] - a[2] * b[0], a[0] * b[0] + a[2] * b[2]);
    return { pos: p, look: add3(p, mul3(d, 60)), fov, roll: clamp(turn * 0.8, -6.5 * deg, 6.5 * deg) };
  };
  P.notes.push(`fpv_dive: from ${A0.toFixed(0)} m ${ts < 0 ? 'ahead of' : 'astern of'} the subject, skims ${skim.toFixed(0)} m clear of its ${side > 0 ? 'port' : 'starboard'} side at ${hs.toFixed(0)} m (pass at t=${tk[3].toFixed(1)} s), ${c.end === 'away' ? 'away' : 'pulls up'} to ${A1.toFixed(0)} m; path ${path.total.toFixed(0)} m, peak rush ${prof.scale.toFixed(2)} x height/s`);
  return { direct, keys: [], times: [[T0, 0], [T1, 0]], lookFn: null, bank: false, dofAuto: false };
}

// tracking_low: a camera riding alongside a MOVING subject, low over the water or the ground (height, default 3 m),
// `offset` m out from its side, at `lead` (fraction of the length ahead of the centre, -0.5..0.5) drifting to `lead_end`
// over the shot, looking at `look_lead` along the hull (default the bow: the bow wave in frame). Its velocity is the
// subject's, exactly (the subject's own pose, no sampling lag); speed and turn are measured relative to the subject.
function T_tracking(P) {
  const { D, s, G, R, K, T0, T1 } = P, c = P.cam || {};
  const SP = subjectPose(P);
  if (!SP.moving) P.notes.push('tracking_low: the subject does not move; the camera holds its side station');
  const side = P.sideName === 'left' ? 1 : P.sideName === 'right' ? -1 : (R() < 0.5 ? -1 : 1);
  const h = clamp(+c.height || 3, 2.2, 60) * Math.sqrt(K.alt);
  const off = clamp(Number.isFinite(+c.offset) ? +c.offset : Math.max(SP.L * 0.1 + 5, 4), 1.5, 600) * K.dist;
  const lead0 = clamp(Number.isFinite(+c.lead) ? +c.lead : 0.12, -0.8, 0.8); let lead1 = clamp(Number.isFinite(+c.lead_end) ? +c.lead_end : lead0 + 0.1, -0.8, 0.8);
  const lookLead = clamp(Number.isFinite(+c.look_lead) ? +c.look_lead : 0.45, -0.7, 0.7);
  const hh0 = clamp(+c.height || 3, 2.2, 60), dMax = 0.5 * hh0 * D / Math.max(1, SP.L / 2);        // smoothstep peaks at 1.5x: <= 0.75 x height / s
  if (Math.abs(lead1 - lead0) > dMax) { const l1 = lead0 + Math.sign(lead1 - lead0) * dMax; P.notes.push(`tracking_low: lead drift ${lead0.toFixed(2)} -> ${lead1.toFixed(2)} is faster than the low camera may slide along the hull; ${l1.toFixed(2)}`); lead1 = l1; }
  const lookH = Number.isFinite(+c.look_h) ? +c.look_h : Math.min(SP.top * 0.22, 14);
  const fov = clamp(+c.fov || 38, 14, 90);
  const Tt = T1 - T0;
  const direct = (t) => {
    const q = SP.at(t), f = q.f, pr = [f[1], -f[0]];
    const e = smooth(clamp((t - T0) / Tt)), ld = lerp(lead0, lead1, e) * SP.L / 2;
    const x = q.c[0] + f[0] * ld + pr[0] * side * -1 * (SP.B / 2 + off) * -1, z = q.c[1] + f[1] * ld + pr[1] * side * -1 * (SP.B / 2 + off) * -1;
    const gy = G(x, z);
    const la = lookLead * SP.L / 2, lx = q.c[0] + f[0] * la + pr[0] * side * SP.B * 0.25, lz = q.c[1] + f[1] * la + pr[1] * side * SP.B * 0.25;
    return { pos: [x, gy + h, z], look: [lx, G(lx, lz) + lookH, lz], fov, roll: 0 };
  };
  P.notes.push(`tracking_low: ${h.toFixed(1)} m up, ${off.toFixed(0)} m off the ${side > 0 ? 'port' : 'starboard'} side, lead ${lead0.toFixed(2)} -> ${lead1.toFixed(2)}, looking at ${lookLead.toFixed(2)} of the length; speed rules measured relative to the subject`);
  return { direct, rel: SP.rel, keys: [], times: [[T0, 0], [T1, 0]], lookFn: null, bank: false, dofAuto: true };
}

// E2 v2: the probe sees a moving item as a cylinder of its radius (a 269 m liner = a 136 m cylinder a camera could never
// come near, 30 m tall so a funnel pass went unchecked). Items with solidAt(p, t) (ships) are tested as their hull,
// superstructure, funnels and masts at time t instead.
function refineProbe(probe, S) {
  if (!probe || probe.__hulls) return;
  const hulls = S.items.filter((it) => it.res && typeof it.res.solidAt === 'function');
  probe.__hulls = hulls.length;
  if (!hulls.length) return;
  const names = new Set(hulls.map((it) => `${it.section}:${it.index} ${it.kind}`));
  if (Array.isArray(probe.dyn)) for (let i = probe.dyn.length - 1; i >= 0; i--) if (names.has(probe.dyn[i].name)) probe.dyn.splice(i, 1);
  const base = probe.check;
  probe.check = (p, t) => {
    const out = base(p, t);
    for (const it of hulls) {
      let top = 0; try { top = it.res.solidAt(p, t, LIMITS.margin) || 0; } catch (e) { top = 0; }
      if (top > 0 && top >= out.insideTop) { out.inside = `${it.section}:${it.index} ${it.kind}`; out.insideTop = top; }
    }
    return out;
  };
}

// fpv dart (E2 v2): the short-shot FPV (< 3.6 s, or when the full move cannot be made legal): one straight, fast line
// past the subject at a legal speed (0.7 x height per second), a constant lens angled toward it (no turn at all, so the
// 45 deg/s rule can never bite), passing it at 55 % of the shot. Beside a ship it runs along her side against her
// motion (head-on), clear of her beam; otherwise it passes the subject on one side, clear of its radius.
function T_dart(P) {
  const { D, s, G, R, K, T0, T1, alt } = P, c = P.cam || {};
  const LS = longSubject(s), side = P.sideName === 'left' ? 1 : P.sideName === 'right' ? -1 : (R() < 0.5 ? -1 : 1);
  const SP = subjectPose(P);
  const a = clamp(((alt[0] ?? NaN) + (alt[1] ?? alt[0] ?? NaN)) / 2 || (LS ? Math.max(8, s.top * 0.45) : Math.max(4, Math.min(s.top * 0.8, 14))), 3, 300) * Math.sqrt(K.alt);
  const moving = SP.moving && len3(SP.rel(Math.min(D, 1))) > 0.3;
  const Tt = T1 - T0, v = 0.7 * a;                                         // legal: <= 0.8 x height per second
  const lat = LS ? LS.B / 2 + Math.max(6, a * 0.6) + (+c.skim || 0) : s.r + 3 + a * 0.3;
  const q0 = SP.at(T0 + Tt * 0.55);
  // travel: along the ship against her motion, else across the view from the chosen side
  let f = LS ? [-q0.f[0], -q0.f[1]] : (() => { const d = dirv(P.camAng + 90 * side); return [d[0], d[1]]; })();
  if (!moving && LS && R() < 0.5) f = [-f[0], -f[1]];
  const pr = [f[1], -f[0]];                                                // lateral: which side of the line the subject is
  const tP = T0 + Tt * 0.55;
  const direct = (t) => {                                                  // a straight line in the world, abeam of her at tP
    const along = v * (t - tP), x = q0.c[0] + pr[0] * lat * side + f[0] * along, z = q0.c[1] + pr[1] * lat * side + f[1] * along;
    const y = G(x, z) + a;
    const yawIn = 16 * deg * side, cy = Math.cos(yawIn), sy = Math.sin(yawIn);
    const fx = f[0] * cy - f[1] * sy, fz = f[0] * sy + f[1] * cy, pitch = -Math.atan2(a * 0.6, lat * 2.2);
    return { pos: [x, y, z], look: [x + fx * 50 * Math.cos(pitch), y + 50 * Math.sin(pitch), z + fz * 50 * Math.cos(pitch)], fov: clamp(+c.fov || 58, 30, 100), roll: 0 };
  };
  P.notes.push(`fpv dart: ${D.toFixed(1)} s, a straight pass ${lat.toFixed(0)} m off the subject at ${a.toFixed(0)} m, ${v.toFixed(1)} m/s${moving ? ' (against her motion)' : ''}, the lens held 16 deg toward it`);
  return { direct, keys: [], times: [[T0, 0], [T1, 0]], lookFn: null, bank: false, dofAuto: false };
}

// dive_under (E2 v2 round 5): the camera glides in toward the subject a few metres over the sea, dips through the
// surface (the waterline transition of fx.underwater) and ends `depth` m down, looking at what is below the waterline:
// a hull, her propellers, an iceberg's hidden mass. {height 4, depth 8, start_dist, end_dist, look_depth, cross 0.4}
function T_diveUnder(P) {
  const { D, s, G, R, T0, T1 } = P, c = P.cam || {}, SP = subjectPose(P), LS = longSubject(s);
  const h0 = clamp(+c.height || 4, 1, 60), dep = clamp(+c.depth || 8, 1.5, 200), cross = clamp(Number.isFinite(+c.cross) ? +c.cross : 0.4, 0.15, 0.85);
  const reach = LS ? LS.B / 2 : s.r;
  const d0 = Math.max(reach + 8, +c.start_dist || reach + 40), d1 = Math.max(reach + 4, +c.end_dist || reach + 14);
  const lookDep = clamp(Number.isFinite(+c.look_depth) ? +c.look_depth : dep * 0.7, 0, 200);
  const side = P.sideName === 'left' ? 1 : P.sideName === 'right' ? -1 : (R() < 0.5 ? -1 : 1);
  const Tt = T1 - T0, lvl = P.S.water ?? 0;
  const e3 = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const direct = (t) => {
    const u = clamp((t - T0) / Tt), q = SP.at(t), f = q.f, pr = [f[1], -f[0]];
    // approach from the chosen side (beside a ship: from her beam, a little ahead)
    const dirv2 = LS ? [pr[0] * side * 0.94 + f[0] * 0.34, pr[1] * side * 0.94 + f[1] * 0.34] : (() => { const d = dirv(P.camAng); return [d[0], d[1]]; })();
    const dd = lerp(d0, d1, e3(u * 0.9 + 0.05));
    const x = q.c[0] + dirv2[0] * dd, z = q.c[1] + dirv2[1] * dd;
    const k = e3((u - cross + 0.3) / 0.6);                                  // above -> below, through the surface at `cross`
    const y = lvl + lerp(h0, -dep, k);
    const ly = lvl + lerp(Math.min(s.top * 0.3, h0), -lookDep, e3((u - cross + 0.2) / 0.5));
    return { pos: [x, y, z], look: [q.c[0], ly, q.c[1]], fov: clamp(+c.fov || 50, 25, 90), roll: 0 };
  };
  P.notes.push(`dive_under: from ${h0} m over the sea ${d0.toFixed(0)} m off, through the surface at ${Math.round(cross * 100)} % of the shot, to ${dep} m down ${d1.toFixed(0)} m off; the water is not a floor for this camera`);
  return { direct, keys: [], times: [[T0, 0], [T1, 0]], lookFn: null, bank: false, dofAuto: false, rel: SP.moving ? SP.rel : undefined };
}
// a camera allowed below the surface (move dive_under or camera.underwater): the sea is not ground for it; clearance is
// measured to the seabed (the world's ground under the water, or 4,000 m down on the open ocean)
function underwaterProbe(probe, S) {
  if (!probe || probe.__under) return; probe.__under = true;
  const lvl = S.water, gRaw = S.world && S.world.ground && S.world.ground.height ? S.world.ground.height : null;
  if (lvl == null) return;
  const base = probe.check;
  probe.check = (p, t) => { const out = base(p, t); let g = gRaw ? gRaw(p[0], p[2]) : lvl - 4000; if (!(g < lvl - 0.5)) g = lvl - 4000; out.ground = g; out.clearance = p[1] - g; return out; };
}

const TEMPLATES = { fpv_flythrough: (P) => (P.D < 3.6 ? T_dart(P) : T_fpv(P)), reveal_rise: T_reveal, orbit: T_orbit, push_in: (P) => T_push(P, false), crane_down: T_crane, flyover_high: T_flyover, follow: T_follow, pull_back: (P) => T_push(P, true), through: T_through, pov: T_pov, keys: T_keys, fpv_dive: T_dive, tracking_low: T_tracking, dive_under: T_diveUnder };
Object.assign(TEMPLATES, SPACE_TEMPLATES); for (const k of Object.keys(SPACE_TEMPLATES)) if (!MOVES.includes(k)) MOVES.push(k);   // E4 v2 (core/spacecam.js)

// ── path assembly ────────────────────────────────────────────────────────────────────────────────────────────────
function assemble(tp, o) {
  if (tp.direct) {                                    // a template that computes the camera itself (pov): bumps still apply
    const bumps = o.bumps || [];
    const f = (t) => { const c = tp.direct(t); let bx = 0, by = 0, bz = 0; for (const b of bumps) { const k = Math.exp(-0.5 * Math.pow((t - b.t) / b.s, 2)); bx += b.v[0] * k; by += b.v[1] * k; bz += b.v[2] * k; } return { pos: [c.pos[0] + bx, c.pos[1] + by, c.pos[2] + bz], look: [c.look[0] + bx, c.look[1] + by, c.look[2] + bz], fov: tp.lens ? tp.lens(t) : c.fov, near: 0.05, far: tp.far ?? 60000, roll: c.roll || 0 }; };   // E4 v2: tp.far (space distances)
    // E2 v2: a tracking move is measured by the speed / turn rules relative to the subject it rides with (tp.rel(t) =
    // the subject's displacement since t = 0); clearance, solids and figures stay on the real path
    if (tp.rel) f.kin = (t) => { const c = f(t), d = tp.rel(t); return { ...c, pos: sub3(c.pos, d), look: sub3(c.look, d) }; };
    return f;
  }
  const g = glide(tp.keys, tp.times, { ends: 'linear', lambda: tp.lambda ?? 0.18, logAlt: tp.logAlt ?? 0, ground: tp.groundY ?? 0, near: 0.05, far: 60000 });
  const bumps = o.bumps || [];
  const B = (t) => {
    const v = [0, 0, 0];
    for (const b of bumps) { const k = Math.exp(-0.5 * Math.pow((t - b.t) / b.s, 2)); v[0] += b.v[0] * k; v[1] += b.v[1] * k; v[2] += b.v[2] * k; }
    return v;
  };
  // E2 v2 (round 4): warp < 1 flies only that fraction of the path (the same shape, slower: the speed fix instead of a
  // lift); a moving subject's displacement is added back so the camera keeps up with her; carry moves a path designed
  // around the subject's start with her
  const kW = tp.warp ?? 1, T0w = tp.times[0][0], rW = tp.warpRel || null, carry = tp.carry || null;
  const base = (t) => {
    let c = kW === 1 ? g(t) : g(T0w + (t - T0w) * kW);
    if (kW !== 1 && rW) { const d = sub3(rW(t), rW(T0w + (t - T0w) * kW)); c = { ...c, pos: add3(c.pos, d), look: add3(c.look, d) }; }
    if (carry) { const d = carry(t); c = { ...c, pos: add3(c.pos, d), look: add3(c.look, d) }; }
    return c;
  };
  const bankK = tp.bank ? 1 : 0;
  // bank into turns: roll ~ yaw rate x speed, low-passed over +-0.5 s, capped at 7 deg
  const tMin = tp.times[0][0], tMax = tp.times[tp.times.length - 1][0];
  const yawRate = (t) => {
    const h = 0.12; t = clamp(t, tMin + h, tMax - h);
    const a = base(t - h).pos, b = base(t).pos, c = base(t + h).pos;
    if (Math.hypot(b[0] - a[0], b[2] - a[2]) < 1e-3 || Math.hypot(c[0] - b[0], c[2] - b[2]) < 1e-3) return 0;
    const h1 = Math.atan2(b[0] - a[0], b[2] - a[2]), h2 = Math.atan2(c[0] - b[0], c[2] - b[2]);
    let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const v = Math.hypot(c[0] - a[0], c[2] - a[2]) / (2 * h);
    return (d / h) * v;
  };
  const rollAt = (t) => {
    if (!bankK) return 0;
    let s = 0, w = 0;
    for (let k = -4; k <= 4; k++) { const g2 = Math.exp(-(k * k) / 8); s += yawRate(t + k * 0.12) * g2; w += g2; }
    const r = -(s / w) * 0.012;
    return clamp(r, -7 * deg, 7 * deg);
  };
  const camAt = (t) => {
    const c = base(t), b = B(t);
    const pos = add3(c.pos, b);
    let look = add3(c.look, b);
    if (tp.lookFn) look = tp.lookFn(t, look, (tt) => ({ pos: add3(base(tt).pos, B(tt)) }));
    return { pos, look, fov: tp.lens ? tp.lens(t) : c.fov, near: 0.05, far: 60000, roll: rollAt(t) };
  };
  const relK = tp.rel || tp.carry;                          // a move riding with a moving subject: its speed is measured relative to her
  if (relK) camAt.kin = (t) => { const c = camAt(t), d = relK(t); return { ...c, pos: sub3(c.pos, d), look: sub3(c.look, d) }; };
  return camAt;
}

function evaluate(camAt, probe, D, fast, step = 1 / 15, limits) {
  const out = [];
  for (let t = 0; t <= D + 1e-6; t += step) { const e = evalAt(camAt, probe, t, { fast, limits }); if (e.warnings.length) out.push(e); }
  // moving at both ends
  for (const t of [0, D - 1 / 30]) { const e = evalAt(camAt, probe, t, { fast, limits }); if (e.k.speed < LIMITS.minEnd && e.k.ang < 1) out.push({ t, k: e.k, q: e.q, warnings: [{ rule: 'still', end: t < 1 ? 'start' : 'end' }] }); }
  return out;
}

// fix local problems with lift / side-step bumps; returns the bumps and the remaining problems
function fixWithBumps(tp, probe, D, fast, changes) {
  const bumps = [];
  let camAt = assemble(tp, { bumps }), bad = evaluate(camAt, probe, D, fast, 1 / 15, tp.limits);
  const sig = clamp(D * 0.12, 0.7, 2.2);
  for (let it = 0; it < 16 && bad.length; it++) {
    // the worst vertical need first
    let best = null;
    for (const e of bad) {
      for (const w of e.warnings) {
        let need = 0, side = null;
        const p = e.k.c.pos;
        if (w.rule === 'clearance') need = w.need - w.v + 0.35;
        else if (w.rule === 'speed') need = Math.min(20, e.k.speed / LIMITS.speedK - e.q.clearance + 0.4);
        else if (w.rule === 'inside') { need = w.top + 1.2 - p[1]; if (need > 12) side = true; }
        else if (w.rule === 'figure') need = w.top + LIMITS.fig + 0.35 - p[1];
        if (need > 0 && (!best || need > best.need)) best = { need, t: e.t, rule: w.rule, side, e };
      }
    }
    if (!best) break;
    if (best.side) {
      // a tall solid: step sideways (perpendicular to the view) rather than climbing over it
      const c = best.e.k.c, f = nrm3(sub3(c.look, c.pos)), sideV = nrm3([-f[2], 0, f[0]]);
      const q = probe.check(add3(c.pos, mul3(sideV, 6)), best.t).inside ? mul3(sideV, -1) : sideV;
      bumps.push({ t: best.t, s: sig, v: mul3(q, 7) });
      changes.push(`side-step 7 m at t=${best.t.toFixed(1)} s (${best.rule})`);
    } else {
      const a = best.need * 1.12 + 0.2;
      bumps.push({ t: best.t, s: sig, v: [0, a, 0] });
      changes.push(`lifted ${a.toFixed(1)} m around t=${best.t.toFixed(1)} s (${best.rule})`);
      if (best.rule === 'speed') (tp.lastResort ||= []).push(`last resort: lifted ${a.toFixed(1)} m at t=${best.t.toFixed(1)} s for speed (the move could not be slowed enough)`);
    }
    camAt = assemble(tp, { bumps });
    bad = evaluate(camAt, probe, D, fast, 1 / 15, tp.limits);
  }
  return { camAt, bad, bumps };
}

// ── cinematography layers (Q6, 26 Sep 2026; additive: a spec without these keys builds the path it built before) ──
//   lens        [{t, fov}] on any move, or `fov` on the keys of move 'keys': a monotone, eased lens track in scene time
//   dolly_zoom  {t: [t0, t1], fov, target, ease}: the vertigo shot. The camera travels along its own axis so the target
//               keeps the size on screen the base shot gives it while the lens goes to `fov` (held after t1)
//   focus       [{t, target, fstop, pull}]: rack focus between REAL positions (cast feet anchor, vehicle/boat body, crowd
//               members, fx fronts, '<ref>.<anchor>', [x, y, z]); the focus plane moves in dioptres, eased; fstop is the
//               full-frame f-number at the current lens; defocus is capped where the sub-frame aperture samples ghost
//   shake       [{t, amp deg, dur s, freq Hz, attack s}]: a designed impact shake, smooth noise under an eased attack /
//               decay envelope, clamped (amp <= 2.5 deg, dur <= 2.5 s, <= 3 per scene)
//   handheld    0..1: an operator's slow drift (< 0.6 Hz; +-0.45 deg yaw, +-0.35 deg pitch, a breath, +-2 cm), never shaky
// The speed / turn / roll rules measure the base path (the move + its safety bumps). The designed layers ride on it with
// their own clamps and are listed in the report ('designed · ...'); the final path must still clear the ground, solids
// and figures, and a designed layer that breaks those is an issue (ok = false), never fixed by a silent lift.
const _pb = new THREE.Box3(), _pv = new THREE.Vector3();
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const fmt = (v, d = 1) => (+v).toFixed(d);

// a lens track: [{t, fov}] -> fov(t), monotone cubic (no overshoot), eased at the first and last key, held outside
export function lensTrack(list) {
  const pts = (Array.isArray(list) ? list : []).filter((k) => k && Number.isFinite(+k.t) && Number.isFinite(+k.fov))
    .map((k) => [+k.t, clamp(+k.fov, 8, 100)]).sort((a, b) => a[0] - b[0]);
  const P = [];
  for (const p of pts) { if (P.length && p[0] - P[P.length - 1][0] < 1e-4) P[P.length - 1] = p; else P.push(p); }
  if (!P.length) return null;
  return pchip(P, 'zero');
}

// where an item really is at scene time t: { base(t) ground point, center(t) focus point, top m }. Cast: the feet anchor
// (a figure walks inside a root at the origin); crowds: the mean of members(t); vehicles and boats: anchors.body; fx:
// anchors.front(t) / frontXZ(t) (world-time functions); '<ref>.<anchor>': a named anchor; else the bounding box.
// Items are sampled at 30 Hz over [-0.5, dur + 0.5] through their own update (already on the world clock).
export function itemTrack(it, G, W, D, anchorName = null) {
  const r = it.res, A = r.anchors || {}, Wt = W || ((t) => t), dur = Number.isFinite(D) ? D : 10;
  const top = clamp(r.height ?? 2, 0.3, 400);
  const isFig = it.section === 'cast' || !!it.figure;
  const name = `${it.section}:${it.index}${anchorName ? '.' + anchorName : ''}`;
  const fixed = (p, cy) => ({ base: () => p.slice(), center: () => [p[0], p[1] + cy, p[2]], top, name });
  const an = anchorName ? A[anchorName] : null;
  // closed-form anchors: fx fronts and named functions / points
  const fn = an && typeof an === 'function' ? an : (!anchorName && typeof A.front === 'function' ? A.front : (!anchorName && typeof r.frontXZ === 'function' ? r.frontXZ : null));
  if (fn) {
    const cy = anchorName ? 0 : Math.min(top * 0.3, 60);
    const base = (t) => { const q = fn(Wt(t)); if (q && q.isVector3) return [q.x, q.y, q.z]; const x = +q[0], z = +q[q.length === 3 ? 2 : 1]; return [x, q.length === 3 ? +q[1] : G(x, z), z]; };
    return { base, center: (t) => { const b = base(t); return [b[0], b[1] + cy, b[2]]; }, top, name };
  }
  if (an && Array.isArray(an) && an.length >= 2) { const x = +an[0], z = +an[an.length === 3 ? 2 : 1]; return fixed([x, an.length === 3 ? +an[1] : G(x, z), z], 0); }
  if (an && an.isVector3) { r.root.updateMatrixWorld(true); const q = an.clone().applyMatrix4(r.root.matrixWorld); return fixed([q.x, q.y, q.z], 0); }
  const obj = an && an.isObject3D ? an : null;
  const cy = obj ? 0 : isFig || A.figure ? Math.min(top, 1.9) * 0.62 : top * 0.42;
  const read = () => {
    if (obj) { obj.getWorldPosition(_pv); return [[_pv.x, _pv.y, _pv.z], 0]; }
    if (it.section === 'cast') { const o = A.feet && A.feet.isObject3D ? A.feet : r.root; o.getWorldPosition(_pv); return [[_pv.x, _pv.y, _pv.z], cy]; }
    return null;
  };
  const readT = (t) => {
    const q = read(); if (q) return q;
    if (typeof r.members === 'function') {
      const M = r.members(t) || []; let x = 0, z = 0; for (const m of M) { x += +m[0]; z += +m[1]; }
      const n = M.length || 1; x /= n; z /= n; return [[x, G(x, z), z], cy];
    }
    const o = A.body && A.body.isObject3D ? A.body : A.figure && A.figure.isObject3D ? A.figure : null;
    if (o) { o.getWorldPosition(_pv); return [[_pv.x, _pv.y, _pv.z], cy]; }
    _pb.setFromObject(r.root);
    if (_pb.isEmpty()) { r.root.getWorldPosition(_pv); return [[_pv.x, G(_pv.x, _pv.z), _pv.z], cy]; }
    _pb.getCenter(_pv); const b = Math.max(G(_pv.x, _pv.z), _pb.min.y);
    return [[_pv.x, b, _pv.z], _pv.y - b];
  };
  const HZ = 30, T0 = -0.5, n = Math.ceil((dur + 1) * HZ) + 2, B = [], C = [];
  for (let k = 0; k < n; k++) {
    const t = T0 + k / HZ;
    try { r.update && r.update(t, t); } catch (e) { /* */ }
    r.root.updateMatrixWorld(true);
    const [b, h] = readT(t); B.push(b); C.push([b[0], b[1] + h, b[2]]);
  }
  try { r.update && r.update(0, 0); } catch (e) { /* */ }
  r.root.updateMatrixWorld(true);
  const moving = B.some((p) => Math.abs(p[0] - B[0][0]) + Math.abs(p[1] - B[0][1]) + Math.abs(p[2] - B[0][2]) > 0.01);
  const lerpT = (arr) => (t) => { const f = clamp((t - T0) * HZ, 0, n - 1.000001), k = Math.floor(f); return mix3(arr[k], arr[k + 1], f - k); };
  const k0 = Math.round(-T0 * HZ);
  const members = typeof r.members === 'function' && it.section !== 'cast' && !anchorName ? (t) => r.members(t) : null;   // crowds focus on their members
  return { base: moving ? lerpT(B) : () => B[k0].slice(), center: moving ? lerpT(C) : () => C[k0].slice(), top, name, moving, members };
}

// a camera target / focus target / label anchor as a track: [x, y, z] (world), [x, z] (1.5 m above the ground),
// 'stage', 'ref:<id>' | 'cast:N' | 'objects:N' | 'groups:N' | 'structures:N' | 'labels:N', optionally '.<anchor>'
export function pointOf(target, S, G, W, D, warnings = []) {
  if (target === 'infinity' || target === 'sky') return { base: () => [0, 0, 0], center: () => [0, 0, 0], top: 0, name: 'infinity', infinity: true };   // focus at infinity (the sky, a sun)
  if (Array.isArray(target) && target.length >= 2) {
    const x = +target[0], z = +target[target.length === 3 ? 2 : 1];
    const p = target.length === 3 ? [x, +target[1], z] : [x, G(x, z) + 1.5, z];
    return { base: () => [x, G(x, z), z], center: () => p.slice(), top: 2, name: `[${target.map((v) => +(+v).toFixed(2)).join(', ')}]` };
  }
  if (typeof target === 'string' && target !== 'stage') {
    const find = (k) => S.byRef[k] || S.byRef['ref:' + k.replace(/^ref:/, '')] || S.byRef[k.replace(/^ref:/, 'cast:')];
    let it = find(target), anchor = null;
    if (!it) { const m = /^(.+)\.([A-Za-z_]\w*)$/.exec(target); if (m && find(m[1])) { it = find(m[1]); anchor = m[2]; } }
    const isPoint = (a) => a != null && (typeof a === 'function' || Array.isArray(a) || a.isVector3 || a.isObject3D);
    if (it && anchor && !isPoint(it.res.anchors && it.res.anchors[anchor])) { warnings.push(`'${target}': no point anchor '${anchor}' on ${it.kind}; using the item`); anchor = null; }
    if (it) return itemTrack(it, G, W, D, anchor);
    warnings.push(`'${target}' not found; using the stage`);
  }
  const s = subjectOf('stage', S, G, D, []);
  return { base: () => [0, G(0, 0), 0], center: (t) => s.center(t), top: s.top, name: 'stage' };
}

// dolly zoom: k(t) = tan(fov(t)/2) / tan(fov0/2); the camera moves along its axis to depth d/k, so size on screen holds
function makeDolly(dz, P, base, notes, warnings) {
  let t0, t1;
  if (Array.isArray(dz.t)) { t0 = +dz.t[0]; t1 = +dz.t[1]; } else { t0 = Number.isFinite(+dz.t) ? +dz.t : 0; t1 = t0 + (Number.isFinite(+dz.dur) ? +dz.dur : 2.5); }
  if (!(Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 + 0.1)) { warnings.push('camera.dolly_zoom: t must be [t0, t1] with t1 > t0; ignored'); return null; }
  const f0 = base(t0).fov ?? 40;
  const want = clamp(Number.isFinite(+dz.fov) ? +dz.fov : f0 * 0.5, 8, 100);
  const kWant = Math.tan(want * deg / 2) / Math.tan(f0 * deg / 2), k1 = clamp(kWant, 0.2, 5);
  const f1 = 2 * Math.atan(k1 * Math.tan(f0 * deg / 2)) / deg;
  if (Math.abs(k1 - kWant) > 1e-6) warnings.push(`camera.dolly_zoom: ${fmt(f0, 0)} -> ${fmt(want, 0)} deg is more than x5; using ${fmt(f1, 0)} deg`);
  const E = dz.ease === 'linear' ? (u) => u : smoother;
  const kAt = (t) => { if (t <= t0) return 1; const f = lerp(f0, f1, E(clamp((t - t0) / (t1 - t0)))); return Math.tan(f * deg / 2) / Math.tan(f0 * deg / 2); };
  const apply = (c, t) => {
    const k = kAt(t);
    if (Math.abs(k - 1) < 1e-9) return c;
    const fw = nrm3(sub3(c.look, c.pos)), d = Math.max(0.5, dot3(sub3(P.center(t), c.pos), fw)), a = d - d / k;
    return { ...c, pos: add3(c.pos, mul3(fw, a)), look: add3(c.look, mul3(fw, a)), fov: 2 * Math.atan(k * Math.tan((c.fov ?? 40) * deg / 2)) / deg };
  };
  let vmax = 0, travel = 0, prev = null;
  for (let t = t0; t <= t1 + 1e-6; t += 1 / 30) { const c = apply(base(t), t); const b = base(t); travel = dot3(sub3(c.pos, b.pos), nrm3(sub3(b.look, b.pos))); if (prev != null) vmax = Math.max(vmax, Math.abs(travel - prev) * 30); prev = travel; }
  notes.push(`designed · dolly zoom ${fmt(t0, 2)}–${fmt(t1, 2)} s on ${P.name}: lens ${fmt(f0, 0)}° -> ${fmt(f1, 0)}°, camera ${travel >= 0 ? 'in' : 'back'} ${fmt(Math.abs(travel))} m (peak ${fmt(vmax)} m/s along the axis; declared, not a speed breach)`);
  return { t0, t1, f0, f1, apply, travel, vmax };
}

// designed shake: sum of three incommensurate sines per axis (smooth, deterministic in t) under an eased envelope
function makeShake(list, seed, notes, warnings) {
  const src = list.filter((e) => e && Number.isFinite(+e.t));
  if (src.length > 3) warnings.push(`camera.shake: ${src.length} shakes; keeping the first 3 (shakes are rare)`);
  const S = src.slice(0, 3).map((e, i) => {
    const amp = clamp(Number.isFinite(+e.amp) ? +e.amp : 0.5, 0, 2.5), dur = clamp(Number.isFinite(+e.dur) ? +e.dur : 0.8, 0.2, 2.5);
    const freq = clamp(Number.isFinite(+e.freq) ? +e.freq : 7, 1.5, 14);
    const att = clamp(Number.isFinite(+e.attack) ? +e.attack : Math.min(0.08, dur * 0.2), 0.03, dur * 0.5);
    const R = rng(((seed >>> 0) + 7919 * (i + 1)) >>> 0), ph = Array.from({ length: 16 }, () => R() * 2 * Math.PI);
    if (+e.amp > 2.5 || +e.dur > 2.5) warnings.push(`camera.shake ${i}: clamped to ${fmt(amp, 2)} deg, ${fmt(dur, 2)} s`);
    return { t: +e.t, amp, dur, freq, att, ph, roll: clamp(Number.isFinite(+e.roll) ? +e.roll : 0.45, 0, 1) };
  });
  if (S.length > 1) warnings.push(`camera.shake: ${S.length} shakes in one shot; keep them rare (one impact per shot)`);
  const env = (s, t) => { const x = t - s.t; if (x <= 0 || x >= s.dur) return 0; return smoother(x / s.att) * Math.pow(1 - smoother(x / s.dur), 2.5); };
  const nz = (s, t, k) => { const w = 2 * Math.PI * s.freq, p = s.ph; return (Math.sin(w * t + p[k]) + 0.55 * Math.sin(1.73 * w * t + p[k + 4]) + 0.3 * Math.sin(2.71 * w * t + p[k + 8])) / 1.85; };
  for (const s of S) notes.push(`designed · shake at ${fmt(s.t, 2)} s: ${fmt(s.amp, 2)}° for ${fmt(s.dur, 2)} s at ${fmt(s.freq)} Hz (attack ${fmt(s.att, 2)} s, eased decay)`);
  return {
    list: S,
    at: (t) => {
      let yaw = 0, pitch = 0, roll = 0, dy = 0, e = 0;
      for (const s of S) {
        const k = env(s, t); if (k <= 0) continue;
        e = Math.max(e, k); const A = s.amp * deg * k;
        pitch += A * nz(s, t, 0); yaw += A * 0.7 * nz(s, t, 1); roll += A * s.roll * nz(s, t, 2); dy += s.amp * 0.012 * k * nz(s, t, 3);
      }
      return { yaw, pitch, roll, dy, e };
    },
  };
}

// handheld: an operator's slow drift, three incommensurate slow sines per axis (< 0.6 Hz) + a breath; never shaky
function makeHandheld(h, seed, notes) {
  const k = clamp(+h || 0, 0, 1);
  if (k <= 0) return null;
  const R = rng(((seed >>> 0) ^ 0x5bd1e995) >>> 0), P = Array.from({ length: 18 }, () => R() * 2 * Math.PI), w = (f) => 2 * Math.PI * f;
  const n3 = (t, i, a, b, c) => (Math.sin(w(a) * t + P[i]) + 0.6 * Math.sin(w(b) * t + P[i + 1]) + 0.35 * Math.sin(w(c) * t + P[i + 2])) / 1.95;
  notes.push(`designed · handheld ${fmt(k, 2)}: drift ±${fmt(0.45 * k, 2)}° yaw, ±${fmt(0.43 * k, 2)}° pitch, ±${fmt(0.3 * k, 2)}° roll, ±${fmt(2 * k)} cm, below 0.6 Hz`);
  return (t) => ({
    yaw: k * 0.45 * deg * n3(t, 0, 0.11, 0.23, 0.41),
    pitch: k * deg * (0.35 * n3(t, 3, 0.13, 0.29, 0.53) + 0.08 * Math.sin(w(0.26) * t + P[15])),
    roll: k * 0.3 * deg * n3(t, 6, 0.09, 0.19, 0.37),
    dx: k * 0.02 * n3(t, 9, 0.12, 0.27, 0.44), dy: k * 0.012 * n3(t, 12, 0.17, 0.31, 0.47),
  });
}

// small rotations of the view about the camera (yaw about the camera's up, pitch about its right) + roll + offsets
function turnView(c, yaw, pitch, roll, dx, dy) {
  const d = sub3(c.look, c.pos), L = len3(d) || 1, f = mul3(d, 1 / L);
  let r = cross3(f, [0, 1, 0]); const rl = len3(r); r = rl > 1e-4 ? mul3(r, 1 / rl) : [1, 0, 0];
  const u = cross3(r, f);
  const f2 = nrm3(add3(f, add3(mul3(r, Math.tan(yaw)), mul3(u, Math.tan(pitch)))));
  const pos = add3(c.pos, add3(mul3(r, dx), mul3(u, dy)));
  return { ...c, pos, look: add3(pos, mul3(f2, L)), roll: (c.roll || 0) + roll };
}

function makeLayers(spec, c, ptOf, base, warnings, notes) {
  const seed = (hashStr(spec.id || 'scene') ^ Math.imul((spec.seed ?? 1) | 0, 2654435761)) >>> 0;
  const dz = c.dolly_zoom && typeof c.dolly_zoom === 'object' ? makeDolly(c.dolly_zoom, ptOf(c.dolly_zoom.target ?? c.target ?? 'stage'), base, notes, warnings) : null;
  const sh = Array.isArray(c.shake) && c.shake.length ? makeShake(c.shake, seed, notes, warnings) : null;
  const hh = Number(c.handheld) > 0 ? makeHandheld(c.handheld, seed, notes) : null;
  if (!dz && !(sh && sh.list.length) && !hh) return null;
  const apply = (q, t) => {
    let o = dz ? dz.apply(q, t) : q;
    if (sh || hh) {
      let yaw = 0, pitch = 0, roll = 0, dx = 0, dy = 0;
      if (hh) { const h = hh(t); yaw += h.yaw; pitch += h.pitch; roll += h.roll; dx += h.dx; dy += h.dy; }
      if (sh) { const k = sh.at(t); yaw += k.yaw; pitch += k.pitch; roll += k.roll; dy += k.dy; }
      if (yaw || pitch || roll || dx || dy) o = turnView(o, yaw, pitch, roll, dx, dy);
    }
    return o;
  };
  // what render.py's frame check and qaFrame should treat as designed at t
  const designedAt = (t) => ({ shake: sh ? +sh.at(t).e.toFixed(3) : 0, dolly: dz && t > dz.t0 - 0.05 && t < dz.t1 + 0.05 ? 1 : 0 });
  return { apply, designedAt, shakes: sh ? sh.list.map((s) => ({ t: s.t, dur: s.dur, amp: s.amp, freq: s.freq })) : [], dolly: dz ? { t0: dz.t0, t1: dz.t1, f0: dz.f0, f1: dz.f1 } : null };
}

// the camera's frame at c: forward, right, up, tan(half vfov), tan(half hfov) (16:9)
function frameOf(c) {
  const f = nrm3(sub3(c.look, c.pos));
  let r = cross3(f, [0, 1, 0]); const rl = len3(r); r = rl > 1e-4 ? mul3(r, 1 / rl) : [1, 0, 0];
  const tv = Math.tan((c.fov ?? 40) * deg / 2);
  return { f, r, u: cross3(r, f), tv, th: tv * 16 / 9 };
}
// a crowd is in focus where its visible members are: the mean of their dioptres, each member weighted by a smooth
// in-frame factor (no jump when one walks out of frame). null when none is in frame. (Q6, audit: w08, v02)
export function crowdDepth(M, c, G, cy = 1.1) {
  const F = frameOf(c);
  let sw = 0, sq = 0;
  for (const m of M || []) {
    const x = +m[0], z = +m[1], d = [x - c.pos[0], G(x, z) + cy - c.pos[1], z - c.pos[2]];
    const zc = dot3(d, F.f); if (zc < 0.5) continue;
    const ex = Math.abs(dot3(d, F.r)) / (zc * F.th), ey = Math.abs(dot3(d, F.u)) / (zc * F.tv);
    const w = (1 - smooth((ex - 0.95) / 0.2)) * (1 - smooth((ey - 0.95) / 0.2)) * smooth((zc - 0.5) / 1.5);
    if (w <= 0) continue;
    sw += w; sq += w / zc;
  }
  return sw > 1e-3 ? sw / sq : null;
}
// what the lens can see that the collision probe skips: opaque, static noQA meshes and instances taller than 1.5 m (the
// trees an fx scatters along a tornado track, a tsunami's cars and poles), never particles, smoke, water or the ground
const _m4 = new THREE.Matrix4(), _bb = new THREE.Box3();
const DOF_SKIP = /puff|flame|spark|grit|smoke|dust|cloud|sky|star|water|ocean|terrain|contact|glow|haze|fog|ash|rain|snow|wave|surge|funnel|debris|ember|beam|flash|label/i;
function visibleSolids(stage) {
  const out = [];
  if (!stage) return out;
  stage.updateMatrixWorld(true);
  stage.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry) return;
    let noqa = false;
    for (let p = o; p; p = p.parent) { if (p.userData && p.userData.ground) return; if (p.userData && p.userData.noQA) noqa = true; if (p.name && DOF_SKIP.test(p.name)) return; }
    if (!noqa) return;                                                    // the probe has it already
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some((m) => !m || m.transparent || m.depthWrite === false || m.isShaderMaterial || m.isRawShaderMaterial)) return;
    if (o.isInstancedMesh && o.instanceMatrix.usage === THREE.DynamicDrawUsage) return;   // flying debris
    const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const add = (bb) => { if (bb.max.y - bb.min.y < 1.5 || Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) > 60) return; out.push({ min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] }); };
    if (o.isInstancedMesh) { const n = Math.min(o.count, 20000); for (let i = 0; i < n; i++) { o.getMatrixAt(i, _m4); _m4.premultiply(o.matrixWorld); add(_bb.copy(g.boundingBox).applyMatrix4(_m4)); } }
    else add(_bb.copy(g.boundingBox).applyMatrix4(o.matrixWorld));
  });
  return out;
}
// the nearest solid in frame over the shot, in dioptres, max-filtered +-0.5 s and smoothed (Q6, audit "pale ghost" trees:
// the legacy aperture grows with the focus distance, so a far focus turned a near tree into a wide six-copy ghost)
function makeNear(cam, probe, D, S) {
  const HZ = 10, n = Math.ceil(D * HZ) + 1, q = new Float64Array(n);
  let stage = S && S.items[0] ? S.items[0].res.root : null;
  while (stage && stage.parent && stage.name !== 'stage') stage = stage.parent;
  const boxes = (probe.boxes || []).concat(visibleSolids(stage)), figs = (probe.figs || []).concat(probe.dyn || []);
  const tr = (T, t) => { const f = clamp((t + 0.5) * 10, 0, T.length - 1.000001), k = Math.floor(f), a = T[k], b = T[k + 1], u = f - k; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] != null ? a[2] + (b[2] - a[2]) * u : null]; };
  for (let k = 0; k < n; k++) {
    const t = Math.min(D, k / HZ), c = cam(t), F = frameOf(c);
    let zn = Infinity;
    const test = (cx, cy, cz, hx, hy, hz) => {
      const dx = cx - c.pos[0], dy = cy - c.pos[1], dz = cz - c.pos[2];
      const z = dx * F.f[0] + dy * F.f[1] + dz * F.f[2], ez = hx * Math.abs(F.f[0]) + hy * Math.abs(F.f[1]) + hz * Math.abs(F.f[2]);
      if (z + ez < 0.3 || z - ez >= zn) return;
      const zz = Math.max(0.3, z);
      const ex = hx * Math.abs(F.r[0]) + hy * Math.abs(F.r[1]) + hz * Math.abs(F.r[2]), ey = hx * Math.abs(F.u[0]) + hy * Math.abs(F.u[1]) + hz * Math.abs(F.u[2]);
      if (Math.abs(dx * F.r[0] + dy * F.r[1] + dz * F.r[2]) - ex > zz * F.th * 1.05) return;
      if (Math.abs(dx * F.u[0] + dy * F.u[1] + dz * F.u[2]) - ey > zz * F.tv * 1.05) return;
      zn = Math.max(0.3, z - ez);
    };
    for (const b of boxes) test((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2, (b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2);
    for (const g of figs) { const p = tr(g.track, t), gy = p[2] ?? probe.ground(p[0], p[1]); test(p[0], gy + g.h / 2, p[1], g.r, g.h / 2, g.r); }
    q[k] = Number.isFinite(zn) ? 1 / zn : 0;
  }
  const W = 5, mx = new Float64Array(n), sm = new Float64Array(n);
  for (let k = 0; k < n; k++) { let m = 0; for (let j = Math.max(0, k - W); j <= Math.min(n - 1, k + W); j++) m = Math.max(m, q[j]); mx[k] = m; }
  for (let k = 0; k < n; k++) { let s = 0, w = 0; for (let j = -6; j <= 6; j++) { const i = clamp(k + j, 0, n - 1), g = Math.exp(-(j * j) / 12.5); s += mx[i] * g; w += g; } sm[k] = s / w; }
  return (t) => { const f = clamp(t * HZ, 0, n - 1.000001), k = Math.floor(f), d = sm[k] + (sm[k + 1] - sm[k]) * (f - k); return d > 1e-4 ? 1 / d : null; };
}
// the largest aperture radius (m) that keeps a solid at depth zn within `px` of blur radius at 1080p, focus at dist
export const apertureCap = (zn, dist, fov, px) => (zn && zn < dist * 0.98 ? px * Math.tan((fov ?? 40) * deg / 2) / (540 * (1 / zn - 1 / dist)) : Infinity);

// rack focus: focus keys -> (t, camera) => { dist (m along the axis), a (aperture radius m) }
const RACK_MAX_SUBJECT = 7, RACK_MAX_BG = 10;          // px of blur radius at 1080p: beyond this 12 aperture samples ghost
function makeFocus(list, ptOf, D, cam, notes, G) {
  const ks = list.filter((k) => k && typeof k === 'object').map((k) => ({
    t: Number.isFinite(+k.t) ? +k.t : 0, P: ptOf(k.target ?? 'stage'), N: clamp(Number.isFinite(+k.fstop) ? +k.fstop : 2.8, 0.7, 32),
    pull: Number.isFinite(+k.pull) ? Math.max(0.05, +k.pull) : null,
  })).sort((a, b) => a.t - b.t);
  if (!ks.length) return null;
  const depthOf = (P, t, c, f) => (P.infinity ? 1e5 : (P.members && crowdDepth(P.members(t), c, G)) || dot3(sub3(P.center(t), c.pos), f));
  const raw = (t, c) => {
    const f = nrm3(sub3(c.look, c.pos));
    let i = 0; while (i < ks.length - 1 && t >= ks[i + 1].t) i++;
    const A = ks[i];
    let inv = 1 / Math.max(0.3, depthOf(A.P, t, c, f)), lnN = Math.log(A.N);
    if (i < ks.length - 1 && t > A.t) {
      const B = ks[i + 1], ts = B.pull != null ? Math.max(A.t, B.t - B.pull) : A.t;
      const e = smoother((t - ts) / Math.max(1e-3, B.t - ts));
      if (e > 0) { inv = lerp(inv, 1 / Math.max(0.3, depthOf(B.P, t, c, f)), e); lnN = lerp(lnN, Math.log(B.N), e); }
    }
    const focalMM = 12 / Math.tan((c.fov ?? 40) * deg / 2);       // full frame, 24 mm tall
    return { dist: 1 / inv, a: focalMM / (2 * Math.exp(lnN)) / 1000, f };
  };
  // the defocus of every focus subject and of the far background, capped moment by moment (a late zoom does not weaken
  // an earlier rack): beyond ~7 px of blur radius at 1080p the 12 aperture samples read as copies, not as blur
  const capped = (t, c) => {
    const q = raw(t, c), fpx = 540 / Math.tan((c.fov ?? 40) * deg / 2);
    let ws = 0; for (const k of ks) { const dj = depthOf(k.P, t, c, q.f); if (dj > 1) ws = Math.max(ws, q.a * Math.abs(1 / q.dist - 1 / dj) * fpx); }
    const wb = q.a / q.dist * fpx, k = Math.min(1, RACK_MAX_SUBJECT / Math.max(1e-6, ws), RACK_MAX_BG / Math.max(1e-6, wb));
    return { dist: q.dist, a: q.a * k, ws: ws * k, wb: wb * k, k };
  };
  let worstS = 0, worstB = 0, minK = 1;
  for (let t = 0; t <= D + 1e-6; t += 0.1) { const r = capped(t, cam(t)); worstS = Math.max(worstS, r.ws); worstB = Math.max(worstB, r.wb); minK = Math.min(minK, r.k); }
  notes.push(`designed · rack focus ${ks.map((k) => `${fmt(k.t, 2)} s ${k.P.name} f/${fmt(k.N)}${k.pull != null ? ` (pull ${fmt(k.pull, 2)} s)` : ''}`).join(' -> ')}; `
    + `defocused subject up to ${fmt(worstS)} px, background up to ${fmt(worstB)} px blur radius at 1080p`
    + (minK < 0.999 ? ` (aperture held down to x${fmt(minK, 2)} where it would pass ${RACK_MAX_SUBJECT} px: the aperture samples would show as copies)` : ''));
  return { at: (t, c) => { const r = capped(t, c); return { dist: r.dist, a: r.a }; } };
}

// story text that follows an item (labels `on`): bound before the probe and the plan (Q6)
export function bindLabels(S, G, W, D, warnings = []) {
  const out = [];
  for (const it of S.items) {
    if (!it.label || !it.res.bindAnchor || it.item.on == null) continue;
    const P = pointOf(it.item.on, S, G, W, D, warnings);
    if (P.name === 'stage' && it.item.on !== 'stage') continue;
    it.res.bindAnchor(P.base, P.top);
    out.push(`labels:${it.index} follows ${P.name}`);
  }
  return out;
}

// ── the planner ──────────────────────────────────────────────────────────────────────────────────────────────────
export function planCamera(spec, S, probe, o = {}) {
  const warnings = o.warnings || [];
  const c = spec.camera || {};
  const D = spec.dur;
  const G = probe.ground;
  let move = c.move || 'fpv_flythrough';
  if (move === 'map_dive' && !spaceTarget(c, S)) { warnings.push('camera.move map_dive is v1.1; using crane_down'); move = 'crane_down'; }   // E4 v2: a space.* target dives (spacecam.js)
  if (!TEMPLATES[move]) { warnings.push(`camera.move '${move}' unknown; using fpv_flythrough`); move = 'fpv_flythrough'; }
  const seed = (spec.seed ?? hashStr(spec.id || 'scene')) + (o.replan ?? 0) * 7919;
  refineProbe(probe, S);                                          // E2 v2: moving hulls tested as hulls, not as a 135 m cylinder
  if (move === 'dive_under' || c.underwater === true) underwaterProbe(probe, S);   // E2 v2: the sea is not a floor for an underwater camera
  const s = subjectOf(c.target ?? 'stage', S, G, D, warnings, o.W);
  // E4 v2 r3: a groundless world (space, the cloud decks): altitudes are measured from the subject's own base (the
  // camera sat 10 km under it in the void: black frames, specks, dark decks); the safety pass keeps the real probe
  const G0 = G, Gt = G(s.p[0], s.p[2]) < -5000 ? ((y) => () => y)(s.p[1]) : G;
  const passes = (Array.isArray(c.passes) ? c.passes : []).map((p) => subjectOf(p, S, G, D, warnings, o.W));
  const fov = clamp(+c.fov || 40, 12, 90);
  const speedName = SPEEDS[c.speed] ? c.speed : 'medium';
  const alt = Array.isArray(c.altitude) ? [c.altitude[0], c.altitude[1] ?? c.altitude[0]].map((v) => (v == null ? undefined : +v)) : (typeof c.altitude === 'number' ? [c.altitude, c.altitude] : []);
  const DEFALT = { fpv_flythrough: [12, 3.5], reveal_rise: [2.6, 18], flyover_high: [undefined, undefined] };
  const changes = [];
  const fast = c.speed === 'fast';
  let result = null;
  // camera.strict (Q6): the director's path is final. No lift bumps, no relax, no flyover fallback: a path that breaks a
  // rule is reported (ok = false, the scene is not rendered) so the spec gets fixed instead of the shot being changed
  const strict = !!c.strict;
  const startLevel = strict ? 0 : o.relax ?? 0;
  for (let level = startLevel; level <= 4 && !result; level++) {
    const R = rng(seed * 31 + level);
    const K = { alt: Math.pow(1.25, level), dist: Math.pow(1.2, level), arc: Math.pow(0.82, level), spd: Math.pow(0.85, level) };
    const sideName = SIDES[c.side] != null ? c.side : null;
    const sideAng = sideName ? SIDES[sideName] : (R() < 0.5 ? -1 : 1) * (25 + R() * 30);
    const camAng = (s.heading + sideAng + 360) % 360;
    const a = [alt[0] ?? DEFALT[move]?.[0], alt[1] ?? DEFALT[move]?.[1]].map((v) => (v == null ? undefined : v * (move === 'orbit' || move === 'flyover_high' || move === 'crane_down' ? 1 : K.alt)));
    const P = { D, s, S, G: Gt, R, K, fov, vf: SPEEDS[speedName] * K.spd, alt: a, camAng, sideName, end: c.end, passes, warnings, notes: [], T0: -0.25, T1: D + 0.25, cam: c, W: o.W, probe, level };
    let tp;
    try { tp = TEMPLATES[move](P); } catch (e) { warnings.push(`camera template ${move} failed: ${String(e).slice(0, 160)}`); console.error(e); break; }
    // E4 v2 r3: in a groundless world an FPV pass keeps its subject in the frame (it looked ahead along the flight and
    // the Witness / probe / lineup passed below the frame: nothing to see but clouds or black)
    if (Gt !== G0 && tp && /^(fpv_flythrough|fpv_dive|through)$/.test(move) && s.item) {
      const toS = (l0, t) => { const c = s.center(t); return [lerp(l0[0], c[0], 0.72), lerp(l0[1], c[1], 0.72), lerp(l0[2], c[2], 0.72)]; };
      if (tp.direct) { const d0 = tp.direct; tp.direct = (t) => { const c = d0(t); return { ...c, look: toS(c.look, t) }; }; }   // the dart
      else { const lf0 = tp.lookFn; tp.lookFn = (t, look, pf) => toS(lf0 ? lf0(t, look, pf) : look, t); }
      tp.dofAuto = false;
    }
    if (!strict) tp = fitSpeed(tp, P, probe, D, fast);        // E2 v2: too fast for its height -> fly less of the path, never lift first
    if (Array.isArray(c.lens) && c.lens.length) { const L = lensTrack(c.lens); if (L) tp.lens = L; }   // a lens track on any move (Q6)
    if (level > startLevel) changes.push(`re-planned at relax level ${level}: altitude x${K.alt.toFixed(2)}, distance x${K.dist.toFixed(2)}, speed x${K.spd.toFixed(2)}${move === 'orbit' ? `, arc x${K.arc.toFixed(2)}` : ''}`);
    changes.push(...P.notes);
    const ch = [];
    const { camAt, bad } = strict ? ((f) => ({ camAt: f, bad: evaluate(f, probe, D, fast, 1 / 15, tp.limits) }))(assemble(tp, { bumps: [] })) : fixWithBumps(tp, probe, D, fast, ch);
    changes.push(...ch);
    if (!bad.length) result = { camAt, tp, level, s };
    else if (strict) {
      changes.push(`strict: the path breaks the rules and was left as designed (${[...new Set(bad.flatMap((e) => e.warnings.map(describe)))].slice(0, 3).join('; ')}; first at t=${bad[0].t.toFixed(2)} s)`);
      result = { camAt, tp, level, s, failed: bad };
    } else if (level === 4) {
      const kinds = [...new Set(bad.flatMap((e) => e.warnings.map((w) => w.rule)))];
      const ex = bad[0];
      changes.push(`still failing after relax 4 (${kinds.join(', ')}; first at t=${ex.t.toFixed(2)} s: ${ex.warnings.map(describe).join(', ')})`);
      result = { camAt, tp, level, s, failed: bad };
    }
  }
  if (result && result.failed && !strict && (move === 'fpv_flythrough' || move === 'fpv_dive')) {
    // E2 v2: an FPV shot stays an FPV shot: a straight dart past the subject before any flyover
    for (const lv of [0, 1, 2]) {
      const R = rng(seed * 37 + lv), K = { alt: Math.pow(1.3, lv), dist: Math.pow(1.25, lv), arc: 1, spd: 1 };
      const sideName = SIDES[c.side] != null ? c.side : null;
      const P = { D, s, S, G: Gt, R, K, fov, vf: 0.55, alt: [alt[0], alt[1]], camAng: (s.heading + (sideName ? SIDES[sideName] : 40) + 360) % 360, sideName, end: c.end, passes, warnings, notes: [], T0: -0.25, T1: D + 0.25, cam: c, W: o.W, probe, level: lv };
      const tp = T_dart(P), ch = [];
      const { camAt, bad } = fixWithBumps(tp, probe, D, fast, ch);
      if (!bad.length) { changes.push(`${move}: the full move broke the rules in ${D.toFixed(1)} s; flown as a straight FPV dart instead (no flyover)`, ...P.notes, ...ch); result = { camAt, tp, level: lv, s, dart: true }; break; }
    }
  }
  if (!result || (result.failed && move !== 'flyover_high' && !strict)) {
    // last resort: a high establishing traverse is always safe
    const R = rng(seed + 99);
    const K = { alt: 1.4, dist: 1.2, arc: 1, spd: 0.8 };
    const P = { D, s, S, G: Gt, R, K, fov, vf: 0.35, alt: [], camAng: s.heading + 30, passes, warnings, notes: [], T0: -0.25, T1: D + 0.25 };
    const tp = T_flyover(P);
    const ch = [];
    const { camAt, bad } = fixWithBumps(tp, probe, D, false, ch);
    changes.push(`fell back to flyover_high (the ${move} could not be made safe)`, ...ch);
    result = { camAt, tp, level: 5, s, failed: bad.length ? bad : null, fallback: 'flyover_high', why: `the ${move} could not be made safe (also as a dart); rendered as flyover_high` };
  }
  // DOF: aperture scaled to the focus distance so the background blurs a few pixels at 1080p
  const dofOpt = c.dof ?? 'auto';
  const strength = dofOpt === false || dofOpt === 'off' || dofOpt === 0 ? 0 : typeof dofOpt === 'number' ? clamp(dofOpt, 0, 3) : (result.tp.dofAuto ? 1 : 0);
  const focusFn = (t) => (result.tp.lookFn || result.tp.dofAuto ? s.center(t) : null);
  // designed layers (Q6): dolly zoom, shake and handheld ride on the base path; the base keeps the speed/turn rules, the
  // final path is checked for ground, solids and figures, and a failure is reported, never lifted
  const base = result.camAt;
  let cam = base, designedBad = null, focus = null, layers = null;
  const designed = [];
  const ptCache = new Map();
  const ptOf = (tg) => { const k = JSON.stringify(tg); if (!ptCache.has(k)) ptCache.set(k, pointOf(tg, S, G, o.W, D, warnings)); return ptCache.get(k); };
  if (c.dolly_zoom || (Array.isArray(c.shake) && c.shake.length) || Number(c.handheld) > 0) {
    layers = makeLayers(spec, c, ptOf, base, warnings, designed);
    if (layers) {
      cam = (t) => layers.apply(base(t), t);
      cam.kin = base.kin || base;              // qa.js measures speed / turn / roll on the operator's path (a tracking move: relative)
      cam.designed = layers.designedAt;
      const bad = evaluate(cam, probe, D, fast, 1 / 15, result.tp.limits);
      if (bad.length && !result.failed) designedBad = bad;
    }
  }
  if (Array.isArray(c.focus) && c.focus.length) {
    focus = makeFocus(c.focus, ptOf, D, cam, designed, G);
    if (focus && c.dof != null) warnings.push('camera.dof is ignored: camera.focus keys set the focus and the aperture');
  }
  // DOF fixes (Q6, the audit): a crowd subject is focused where its visible members are, and the aperture is capped by the
  // nearest solid in frame so a foreground tree softens instead of doubling (both the legacy dof and the rack focus)
  let focusOut = focusFn;
  const mem = s.item && s.item.section !== 'cast' && typeof s.item.res.members === 'function' ? s.item.res.members : null;
  if (mem && strength > 0 && !focus) {
    focusOut = (t) => { const p = focusFn(t); if (!p) return null; const q = cam(t), d = crowdDepth(mem(t), q, G); return d ? add3(q.pos, mul3(nrm3(sub3(q.look, q.pos)), d)) : p; };
    designed.push(`dof on ${s.item.section}:${s.item.index}: focused on its visible members (dioptre mean), not the group centre`);
  }
  const nearAt = focus || (strength > 0 && (result.tp.lookFn || result.tp.dofAuto)) ? makeNear(cam, probe, D, S) : null;
  changes.push(...designed);
  if (designedBad) changes.push(`designed layers break the safety rules (not lifted; fix the spec): ${[...new Set(designedBad.flatMap((e) => e.warnings.map(describe)))].slice(0, 3).join('; ')} (first at t=${designedBad[0].t.toFixed(2)} s)`);
  // summary numbers for the harness: mean view azimuth (sun placement), shadow box (stage-sized, fixed per scene)
  let vx = 0, vz = 0; const xs = [], zs = [];
  for (let k = 0; k <= 24; k++) {
    const t = D * k / 24, q = cam(t), f = sub3(q.look, q.pos);
    vx += f[0]; vz += f[2];
    const fl = Math.hypot(f[0], f[2]) || 1, reach = Math.min(len3(sub3(s.center(t), q.pos)), 220);
    xs.push(q.pos[0], q.pos[0] + f[0] / fl * reach); zs.push(q.pos[2], q.pos[2] + f[2] / fl * reach);
  }
  const viewAz = azOf(vx, vz);
  const minX = Math.min(...xs, s.p[0]), maxX = Math.max(...xs, s.p[0]), minZ = Math.min(...zs, s.p[2]), maxZ = Math.max(...zs, s.p[2]);
  const shadow = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, S: clamp(Math.max(maxX - minX, maxZ - minZ) / 2 + 30, 30, 650) };
  shadow.y = G(shadow.cx, shadow.cz);
  return {
    camAt: cam, move: result.fallback || move, requested: c.move || 'fpv_flythrough', level: result.level, changes, ok: !result.failed && !designedBad,
    issues: result.failed ? [...new Set(result.failed.flatMap((e) => e.warnings.map(describe)))].slice(0, 8)
      : designedBad ? [...new Set(designedBad.flatMap((e) => e.warnings.map((w) => 'designed layer: ' + describe(w))))].slice(0, 8)
      : result.why ? [result.why] : (result.tp && result.tp.lastResort ? [...new Set(result.tp.lastResort)].slice(0, 3) : []),
    subject: s, focusFn: focusOut, dof: focus ? 'rack' : strength, viewAz, shadow, fov,
    focusAt: focus ? focus.at : null, minSub: focus ? { final: 12, draft: 4 } : null, kin: base, nearAt,
    designed: layers ? { shakes: layers.shakes, dolly: layers.dolly, notes: designed } : designed.length ? { notes: designed } : null,
  };
}

// point labels without a heading at the camera (mean position over their visible window), so text is never mirrored
export function orientLabels(S, plan, D) {
  const turned = [];
  for (const it of S.items) {
    if (it.label && it.res.story) { const m = orientStory(it, plan, D); if (m.length) turned.push(...m); continue; }   // Q6 story text
    if (!it.label || !it.item.faceCamera) continue;
    if (plan.subject && plan.subject.item === it) continue;          // the move was built around its heading
    const [t0, t1] = Array.isArray(it.item.t) ? it.item.t : [0, D];
    const a = clamp(t0, 0, D), b = clamp(Math.min(t1, D), a, D);
    let x = 0, z = 0, n = 0;
    for (let k = 0; k <= 10; k++) { const q = plan.camAt(lerp(a, b, k / 10)); x += q.pos[0]; z += q.pos[2]; n++; }
    // a builder whose lettering stands inside a root at the origin turns itself (it would swing round the origin) (Q6 fix)
    if (it.res.faceToward) { const h = it.res.faceToward(x / n, z / n); if (h == null) continue; it.item.heading = h; turned.push(`labels:${it.index} faces the camera (heading ${h.toFixed(0)})`); continue; }
    const r = it.res.root, dx = x / n - r.position.x, dz = z / n - r.position.z;
    if (Math.hypot(dx, dz) < 1) continue;
    const h = azOf(dx, dz);
    r.rotation.y = Math.PI - h * deg;
    it.item.heading = h;
    turned.push(`labels:${it.index} faces the camera (heading ${h.toFixed(0)})`);
  }
  return turned;
}

// story text (Q6): `screen` sizes the cap height to a fraction of the frame height at the reveal; text without a heading
// faces the mean camera position over its window unless it turns to the camera every frame (face_camera)
function orientStory(it, plan, D) {
  const out = [], r = it.res, item = it.item;
  const [t0, t1] = Array.isArray(item.t) ? item.t : [0, D];
  const a = clamp(t0, 0, D), b = clamp(Math.min(t1, D), a, D);
  if (Number.isFinite(+item.screen) && +item.screen > 0 && r.setCap && r.pointAt) {
    const tr = clamp(t0 + 0.6, 0, D), q = plan.camAt(tr), f = nrm3(sub3(q.look, q.pos));
    const d = Math.max(0.5, dot3(sub3(r.pointAt(tr), q.pos), f));
    const cap = clamp(+item.screen, 0.005, 0.5) * 2 * d * Math.tan((q.fov ?? 40) * deg / 2);
    r.setCap(cap);
    out.push(`labels:${it.index} cap height ${cap.toFixed(2)} m (${(+item.screen * 100).toFixed(1)} % of the frame at ${d.toFixed(1)} m)`);
  }
  if (item.faceCamera && !r.faceLive && r.faceToward) {
    let x = 0, z = 0, n = 0;
    for (let k = 0; k <= 10; k++) { const q = plan.camAt(lerp(a, b, k / 10)); x += q.pos[0]; z += q.pos[2]; n++; }
    const h = r.faceToward(x / n, z / n);
    if (h != null) { item.heading = h; out.push(`labels:${it.index} faces the camera (heading ${h.toFixed(0)})`); }
  }
  return out;
}
