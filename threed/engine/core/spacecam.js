// spacecam.js — E4 (v2, 27 Sep 2026): camera moves for space and other worlds, as templates camera.js plans like its
// own (the same safety pass, lens tracks, focus, shake, handheld). Each move computes the camera directly (tp.direct)
// from the target body's real centre and radius (res.planet / res.radius), so a move sized for Pluto (112 m) works for
// Jupiter (6720 m). Everything is eased and a pure function of t; both ends keep moving (no dead stop).
//   approach      from a far dot to the body filling the frame: an exponential zoom (log-distance eased), a gentle arc
//   orbit_planet  a sweeping orbit round the body; `sunrise: true` = a low orbit over the limb and the Sun rising over
//                 the horizon ahead at `rise_at` (the scene's space sun is set for it unless look.sun / world.sun is given)
//   map_dive      (a space.* target) from high above down to the surface point facing the camera, pitching from straight
//                 down to the horizon: the handoff shot before a cut to that world's surface biome
//   fall_through  a vertical descent through cloud decks / an atmosphere: `from` / `to` heights, a slow spin, a speed
//                 profile (terminal: fast then slowing in the thickening air; accelerate; log: altitude-proportional,
//                 the default over real ground so the speed rule holds all the way down)
import * as THREE from 'three';
import { clamp, lerp, deg } from '../lib/shared/util.js';

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const arr = (v) => [v.x, v.y, v.z];
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
// eased progress that never stops: the velocity at both ends stays `k` of the mean (the QA wants motion at the ends)
const ease = (u, k = 0.28) => { u = clamp(u, 0, 1); return k * u + (1 - k) * smooth(u); };
const num = (v, d) => (Number.isFinite(+v) ? +v : d);

// the body a move is about: {C (world centre), R, st (the scene's space state, may be null), it}
function bodyOf(c, S, warnings) {
  const find = (k) => (typeof k === 'string' ? (S.byRef[k] || S.byRef['ref:' + k.replace(/^ref:/, '')]) : null);
  let it = find(c.target);
  if (!it) it = S.items.find((x) => x.res && x.res.planet) || S.items.find((x) => /^space\./.test(x.kind || ''));
  if (!it) return null;
  const r = it.res, root = r.root;
  root.updateMatrixWorld(true);
  if (r.planet) return { C: r.planet.center(), R: r.planet.R, st: r.planet.st, it, rings: r.planet.rings, spanR: r.planet.spanR };
  const C = root.getWorldPosition(new THREE.Vector3());
  return { C, R: Math.max(1, (r.height ?? (r.radius != null ? r.radius * 2 : 20)) / 2), st: null, it, spanR: r.radius };
}
export function spaceTarget(c, S) {
  const k = typeof c.target === 'string' ? c.target : null;
  const it = k ? (S.byRef[k] || S.byRef['ref:' + k.replace(/^ref:/, '')]) : null;
  return !!(it && (it.res?.planet || /^space\.(earth|moon|mars|mercury|venus|jupiter|saturn|uranus|neptune|pluto|titan|charon)$/.test(it.kind || '')));
}
const dirAzEl = (az, el) => new THREE.Vector3(Math.sin(az * deg) * Math.cos(el * deg), Math.sin(el * deg), Math.cos(az * deg) * Math.cos(el * deg));
const UP = new THREE.Vector3(0, 1, 0);

// ── approach: a far dot -> the body filling the frame ────────────────────────────────────────────────────────────────
function T_approach(P) {
  const c = P.cam || {}, D = P.D;
  const B = bodyOf(c, P.S, P.warnings);
  if (!B) throw new Error('approach: no body to approach (target a space.* object)');
  const from = Math.max(2, num(c.from, 30)), to = Math.max(1.02, num(c.to, B.rings ? 3.2 : 1.45));
  const V0 = dirAzEl(num(c.az, 0), num(c.el, 8)).normalize();
  const arc = num(c.arc, 14) * (c.side === 'left' ? -1 : 1);
  const R = B.R, C = B.C;
  const lnA = Math.log(from * R), lnB = Math.log(to * R);
  const lookUp = num(c.look_off, 0);                  // aim this many radii above the centre at the end (a horizon composition)
  const fov = clamp(num(c.fov, 34), 12, 90);
  const direct = (t) => {
    const u = clamp((t + 0.25) / (D + 0.5), 0, 1), e = ease(u, 0.3);
    const d = Math.exp(lerp(lnA, lnB, e));
    const V = V0.clone().applyAxisAngle(UP, arc * deg * e);
    const pos = C.clone().addScaledVector(V, d);
    const look = C.clone().addScaledVector(UP, lookUp * R * smooth(u));
    return { pos: arr(pos), look: arr(look), fov };
  };
  P.notes.push(`approach: ${from} -> ${to} radii of ${B.it.kind} (R ${Math.round(R)} m), exponential zoom`);
  return { direct, dofAuto: false, bank: false, far: from * R * 1.6 + R * 4 };
}

// ── orbit_planet ─────────────────────────────────────────────────────────────────────────────────────────────────────
function T_orbitPlanet(P) {
  const c = P.cam || {}, D = P.D;
  const B = bodyOf(c, P.S, P.warnings);
  if (!B) throw new Error('orbit_planet: no body (target a space.* object)');
  const R = B.R, C = B.C, fov = clamp(num(c.fov, c.sunrise ? 52 : 40), 12, 90);
  const dir = c.side === 'left' ? -1 : 1;
  if (c.sunrise) {
    // a low orbit over the body (it fills the lower frame), looking ahead at the horizon; the Sun rises over it at rise_at
    const Dd = R * Math.max(1.02, num(c.dist, 1.1));
    const arc = num(c.arc, 16) * deg, uStar = clamp(num(c.rise_at, 0.55), 0.15, 0.9);
    const az = num(c.az, 0) * deg, h = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az)).multiplyScalar(dir);
    const dip = Math.PI / 2 - Math.asin(R / Dd);                                    // the horizon's dip below the local level
    const th = (u) => arc * ease(u, 0.3) - arc * 0.5;
    const thStar = th(uStar);
    const gamma = thStar + dip + 0.004;
    const L = h.clone().multiplyScalar(Math.cos(gamma)).addScaledVector(UP, -Math.sin(gamma)).normalize();
    const yawOff = num(c.yaw, 8) * deg * dir;
    if (B.st && !B.st.explicit) B.st.setExplicit(L);
    else if (B.st && B.st.explicit) P.notes.push('orbit_planet sunrise: the scene gives look.sun / world.sun, so the Sun may not rise on cue');
    const pitchK = num(c.horizon, 0.62);                                              // where the horizon sits (0 top .. 1 bottom)
    const direct = (t) => {
      const u = clamp((t + 0.25) / (D + 0.5), 0, 1), a = th(u);
      const up = UP.clone().multiplyScalar(Math.cos(a)).addScaledVector(h, Math.sin(a));
      const T = UP.clone().multiplyScalar(-Math.sin(a)).addScaledVector(h, Math.cos(a));
      const pos = C.clone().addScaledVector(up, Dd);
      const p = dip - (pitchK - 0.5) * fov * deg;
      let F = T.clone().multiplyScalar(Math.cos(p)).addScaledVector(up, -Math.sin(p));
      F.applyAxisAngle(up, yawOff);
      return { pos: arr(pos), look: arr(pos.clone().addScaledVector(F, R)), fov };
    };
    P.notes.push(`orbit_planet sunrise: ${Math.round((Dd / R - 1) * 100)} % of the radius up, the Sun clears the horizon at ${Math.round(uStar * 100)} % of the shot`);
    return { direct, dofAuto: false, bank: false, far: Dd * 6 + R * 4 };
  }
  // a sweeping orbit round the centre, looking at it (the body keeps its lit phase: the terminator sweeps across)
  const Dd = R * Math.max(1.05, num(c.dist, B.rings ? 3.4 : 2.3));
  const arc = num(c.arc, 40) * deg * dir, el0 = num(c.el, 14), el1 = num(c.el_end, el0), az0 = num(c.az, 0);
  const lookOff = num(c.look_off, 0);
  const direct = (t) => {
    const u = clamp((t + 0.25) / (D + 0.5), 0, 1), e = ease(u, 0.3);
    const V = dirAzEl(az0 + arc / deg * e, lerp(el0, el1, e));
    const pos = C.clone().addScaledVector(V, Dd);
    const look = C.clone().addScaledVector(UP, lookOff * R);
    return { pos: arr(pos), look: arr(look), fov };
  };
  P.notes.push(`orbit_planet: ${(Dd / R).toFixed(2)} radii, ${Math.round(Math.abs(arc / deg))} deg`);
  return { direct, dofAuto: false, bank: false, far: Dd * 3 + R * 4 };
}

// ── map_dive (a planet target): high above -> the surface point facing the lens, down -> the horizon ────────────────
function T_mapDive(P) {
  const c = P.cam || {}, D = P.D;
  const B = bodyOf(c, P.S, P.warnings);
  if (!B) throw new Error('map_dive: no body');
  const R = B.R, C = B.C, fov = clamp(num(c.fov, 45), 12, 90);
  const n = (Array.isArray(c.point) && c.point.length >= 3 ? V3(c.point) : dirAzEl(num(c.az, 0), num(c.el, 25))).normalize();
  const h0 = R * Math.max(0.2, num(c.from, 2.4)), h1 = R * Math.max(0.0005, num(c.to, 0.025));
  let hd = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y); if (hd.lengthSq() < 1e-4) hd.set(0, 0, -1).addScaledVector(n, -n.z); hd.normalize();   // the heading: toward the planet's north
  const endLook = c.end === 'down' ? 'down' : 'horizon';
  const direct = (t) => {
    const u = clamp((t + 0.25) / (D + 0.5), 0, 1), e = ease(u, 0.25);
    const h = Math.exp(lerp(Math.log(h0), Math.log(h1), e));
    const pos = C.clone().addScaledVector(n, R + h);
    // travel a little toward the heading as it drops (a dive, not an elevator)
    pos.addScaledVector(hd, R * 0.05 * e);
    const dip = Math.PI / 2 - Math.asin(R / (R + h));
    const pEnd = endLook === 'down' ? 80 * deg : Math.max(dip + 6 * deg, 12 * deg);
    const pitch = lerp(84 * deg, pEnd, smooth((u - 0.35) / 0.65));
    const F = hd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(n, -Math.sin(pitch));
    return { pos: arr(pos), look: arr(pos.clone().addScaledVector(F, Math.max(h, R * 0.01))), fov };
  };
  P.notes.push(`map_dive: from ${(h0 / R).toFixed(2)} R above ${B.it.kind} down to ${Math.round(h1)} m, then ${endLook}`);
  return { direct, dofAuto: false, bank: false, far: (R + h0) * 4 + R * 4 };
}

// ── fall_through: a vertical descent through the cloud decks / an atmosphere ────────────────────────────────────────
function T_fall(P) {
  const c = P.cam || {}, D = P.D, G = P.G;
  const at = Array.isArray(c.at) ? [+c.at[0], +c.at[1]] : (P.s && P.s.p ? [P.s.p[0], P.s.p[2]] : [0, 0]);
  const g0 = G(at[0], at[1]);
  const hasGround = g0 > -5000;
  const y0 = num(c.from, hasGround ? g0 + 900 : 700), y1 = num(c.to, hasGround ? g0 + 6 : -5200);
  const curve = c.curve || (hasGround ? 'log' : 'terminal');
  const drift = Array.isArray(c.drift) ? [+c.drift[0] || 0, +c.drift[1] || 0] : [0, 0];
  const spin = num(c.spin, 40), yaw0 = num(c.yaw, 0), pitch0 = num(c.pitch, -62), pitch1 = num(c.pitch_end, pitch0);
  const fov = clamp(num(c.fov, 60), 12, 100);
  const prog = (u) => {
    if (curve === 'accelerate') return 0.12 * u + 0.88 * u * u;
    if (curve === 'linear') return u;
    if (curve === 'terminal') return 0.12 * u + 0.88 * (1 - (1 - u) * (1 - u));
    return ease(u, 0.3);
  };
  const yAt = (u) => {
    const e = prog(u);
    if (curve === 'log' && hasGround) {
      const gy = G(at[0] + drift[0] * u, at[1] + drift[1] * u);
      const a0 = Math.max(1, y0 - g0), a1 = Math.max(1, y1 - g0);
      return gy + Math.exp(lerp(Math.log(a0), Math.log(a1), e));
    }
    return lerp(y0, y1, e);
  };
  const direct = (t) => {
    const u = clamp((t + 0.25) / (D + 0.5), 0, 1), e = ease(u, 0.3);
    const pos = [at[0] + drift[0] * e, yAt(u), at[1] + drift[1] * e];
    const yaw = (yaw0 + spin * e) * deg, pitch = clamp(lerp(pitch0, pitch1, smooth(u)), -86, 60) * deg;
    const F = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    return { pos, look: [pos[0] + F[0] * 50, pos[1] + F[1] * 50, pos[2] + F[2] * 50], fov };
  };
  P.notes.push(`fall_through: y ${Math.round(y0)} -> ${Math.round(y1)} m (${curve}), spin ${spin} deg`);
  return { direct, dofAuto: false, bank: false, far: 60000 };
}

export const SPACE_TEMPLATES = { approach: T_approach, orbit_planet: T_orbitPlanet, map_dive: T_mapDive, fall_through: T_fall };
export const SPACE_CAMERA_KEYS = ['from', 'to', 'az', 'el', 'el_end', 'arc', 'dist', 'sunrise', 'rise_at', 'yaw', 'horizon', 'look_off', 'point', 'curve', 'drift', 'spin', 'pitch', 'pitch_end', 'at'];
export const SPACE_CAMERA_DOC = {
  approach: "move approach (E4 v2, space): target a space.* body; from a far dot to it filling the frame, an exponential (log-distance) zoom. from: 30 (radii from the centre; 60+ = a real dot, the frame check then calls the first frames black), to: 1.45 (3.2 with rings), az/el: the side it comes from (deg; default 0 / 8 = from +Z), arc: 14 (deg of drift round it), look_off: 0 (radii to aim above the centre at the end), fov 34. 5-10 s",
  orbit_planet: "move orbit_planet (E4 v2, space): target a space.* body; a sweeping orbit round it: dist 2.3 (radii; 3.4 with rings), arc 40 (deg), el / el_end (deg), az (start), side left|right, look_off, fov 40. sunrise: true = a low orbit (dist 1.1) over the limb looking at the horizon ahead; the Sun rises over it at rise_at (0.55 of the shot), horizon 0.62 (where the horizon sits, 0 top .. 1 bottom), yaw 8 (deg the Sun sits off centre); it sets the scene's sun unless look.sun / world.sun is given. 6-12 s",
  map_dive: "move map_dive with a space.* target (E4 v2): from `from` 2.4 radii above the surface point facing the camera (the body's lon/lat) down to `to` 0.025 radii, pitching from straight down to the horizon (end: 'down' stays down); point: [x, y, z] world direction from the centre to dive at. Cut to that world's surface biome after it. 5-8 s. Other targets: crane_down as before",
  fall_through: "move fall_through (E4 v2): a vertical descent through cloud decks (biome.jupiter_clouds ...) or an atmosphere: from / to (world y; defaults: 700 -> -5200 in a cloud world, 900 m -> 6 m over real ground), curve terminal (fast, then slowing: the default in cloud worlds) | accelerate | linear | log (altitude-proportional: the default over ground, keeps the speed rule), spin 40 (deg of yaw over the shot), yaw (start heading), pitch -62 (deg; -86 straight down, 0 the horizon) -> pitch_end, drift [dx, dz] m, at [x, z], fov 60. 6-12 s",
};
