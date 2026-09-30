// sinking.js — ships going down (E2, Frontier 3D v2): the staged sink of any ship.* kind (action "sink"), the hull
// broken in two, and the water around it (foam ring at the waterline, a turbulence patch, spray, floating debris).
// Pure functions of t; the stages scale to any `dur` (the director compresses 2 h 40 min into seconds).
//
//   mode bow_first  settles by the head, the stern lifts to trim_max, she slides under bow first
//   mode list       heels over to list_max while settling, rolls further and goes under on her side
//   mode capsize    rolls past 90 deg, floats keel-up for a while, goes under by the stern
//   mode break      (ship.liner_1912 default) the bow settles, the forecastle goes awash, the boat deck floods, the
//                   stern rises to trim_max (30-45 deg), the lights flicker and die, the hull breaks at break_at, the
//                   stern falls back, fills, stands up vertical and slips under
// Frames: the ship's local frame has +Z forward, Y up, origin on the waterline; `bowZ` is the stem's z, `sternZ` the
// counter's z. A section is posed by a reference point R (local) put at P (in the heading frame: x across, y up, z
// forward, origin at the ship's reference) and rotated by trim (bow down +) and list (to port +) about R.
import * as THREE from 'three';
import { pchip } from '../../core/wcam.js';
import { clamp, lerp, smooth, smoother, rng } from '../shared/util.js';

const DEG = Math.PI / 180;
const K = (pts) => pchip(pts, 'zero');                 // monotone, eased keys (never overshoots)

// sinkPlan(o) -> { at(t) -> state }  o: { mode, t0, dur, trim_max, list_max, break_at (0 bow .. 1 stern), lights_out_at
//   (s, scene time), final 'under'|'awash', bowZ, sternZ, L, draft, top }
export function sinkPlan(o) {
  const mode = ['bow_first', 'list', 'capsize', 'break'].includes(o.mode) ? o.mode : 'bow_first';
  const L = o.L, bowZ = o.bowZ, sternZ = o.sternZ, top = o.top ?? L * 0.15;
  const t0 = +o.t0 || 0, dur = Math.max(2, +o.dur || 20);
  const TM = clamp(+o.trim_max || (mode === 'break' ? 32 : mode === 'bow_first' ? 24 : 8), 0, 89) * DEG;
  const LM = clamp(+o.list_max || (mode === 'list' ? 28 : mode === 'capsize' ? 0 : 6), -60, 60) * DEG;
  const brk = clamp(o.break_at ?? 0.55, 0.15, 0.85), zB = lerp(bowZ, sternZ, brk);
  const under = (o.final ?? 'under') !== 'awash';
  const zP = lerp(bowZ, sternZ, 0.62);                   // whole-ship trim pivot (the centre of the remaining buoyancy)
  const ub = 0.72;                                        // the break (u)
  const lightsOut = o.lights_out_at != null && Number.isFinite(+o.lights_out_at) ? (+o.lights_out_at - t0) / dur : (mode === 'break' ? 0.66 : 0.75);
  // whole-ship keys (u -> value)
  let trim, heave, list;
  if (mode === 'break') {
    trim = K([[0, 0], [0.45, 4.5 * DEG], [0.62, 12 * DEG], [ub, TM]]);
    heave = K([[0, 0], [0.45, -2.2], [0.62, -4], [ub, -5.5]]);
    list = K([[0, 0], [0.3, LM * 0.5], [0.6, LM], [ub, LM * 0.6]]);
  } else if (mode === 'bow_first') {
    trim = K([[0, 0], [0.5, TM * 0.3], [0.8, TM], [1, TM * 1.35]]);
    heave = K([[0, 0], [0.5, -0.02 * L], [0.8, -0.05 * L], [1, under ? -(L * 0.5 * Math.sin(TM * 1.35) + top + 12) : -0.05 * L]]);
    list = K([[0, 0], [0.5, LM * 0.6], [1, LM]]);
  } else if (mode === 'list') {
    trim = K([[0, 0], [0.7, 2 * DEG], [1, 6 * DEG]]);
    heave = K([[0, 0], [0.6, -0.02 * L], [0.85, -0.04 * L], [1, under ? -(top + 20) : -0.04 * L]]);
    list = K([[0, 0], [0.6, LM], [0.85, Math.min(80 * DEG, LM * 2.2)], [1, 85 * DEG]]);
  } else {                                                // capsize: turns turtle, floats keel-up, stern goes last
    trim = K([[0, 0], [0.55, 0], [0.8, -4 * DEG], [1, -30 * DEG]]);
    heave = K([[0, 0], [0.3, -0.01 * L], [0.55, -0.02 * L], [0.8, -0.03 * L], [1, under ? -(L * 0.5 * Math.sin(30 * DEG) + top + 10) : -0.03 * L]]);
    list = K([[0, 0], [0.2, 10 * DEG], [0.42, 95 * DEG], [0.55, 172 * DEG], [1, 178 * DEG]]);
  }
  // the whole ship as one section about the pivot zP
  const whole = (u) => ({ R: [0, 0, zP], P: [0, heave(u), zP], trim: trim(u), list: list(u) });
  // where a local point lands in the heading frame under a section pose
  const apply = (S, p) => {
    const q = new THREE.Vector3(p[0] - S.R[0], p[1] - S.R[1], p[2] - S.R[2]);
    q.applyEuler(new THREE.Euler(S.trim, 0, -S.list, 'XYZ'));
    return [q.x + S.P[0], q.y + S.P[1], q.z + S.P[2]];
  };
  let fore = null, aft = null;
  if (mode === 'break') {
    const Sb = whole(ub), B = [0, 4, zB], PB = apply(Sb, B);
    const Laft = Math.abs(sternZ - zB), Lfore = Math.abs(zB - bowZ);
    const fT = K([[ub, TM], [ub + 0.05, TM + 12 * DEG], [ub + 0.14, 62 * DEG]]);
    const fY = K([[ub, PB[1]], [ub + 0.04, PB[1] - 6], [ub + 0.14, PB[1] - (Lfore + top + 40)]]);
    const fZ = K([[ub, PB[2]], [ub + 0.14, PB[2] + Lfore * 0.12 * Math.sign(bowZ - sternZ)]]);
    const fL = K([[ub, LM * 0.6], [ub + 0.14, LM * 0.2]]);
    fore = (u) => ({ R: B, P: [PB[0], fY(u), fZ(u)], trim: fT(u), list: fL(u) });
    // aft: falls back nearly level (the break end rises to the surface), fills, stands up vertical, slips under
    const u1 = ub + 0.06, u15 = ub + 0.08, u2 = 0.905, u3 = 0.925;               // fall back, float, rise (~2 s of a 20 s sink), hang, slip (~1.5 s)
    const aT = K([[ub, TM], [u1, 4 * DEG], [u15, 6 * DEG], [u2, 86 * DEG], [u3, 88 * DEG], [1, 89 * DEG]]);
    const yV = -(Laft - Math.min(Laft * 0.45, 55));        // the stern stands ~45 % (<= 55 m) of the section out of the water
    const aY = K([[ub, PB[1]], [u1, -3], [u15, -4], [u2, yV], [u3, yV - 5], [1, under ? yV - (Laft + 25) : yV]]);
    const aZ = K([[ub, PB[2]], [u1, PB[2] + 2 * Math.sign(sternZ - zB)], [u2, PB[2] - Laft * 0.25 * Math.sign(sternZ - zB)]]);
    const aL = K([[ub, LM * 0.6], [u1, LM * 0.3], [u2, LM * 0.15]]);
    aft = (u) => ({ R: B, P: [PB[0], aY(u), aZ(u)], trim: aT(u), list: aL(u) });
  }
  // lights: full, flickering over ~6 % of the sink before lights_out_at, dark after (a last flicker as they die)
  const lamps = (u) => {
    if (u < lightsOut - 0.07) return 1;
    if (u > lightsOut + 0.012) return 0;
    const x = (u - (lightsOut - 0.07)) / 0.082, fl = Math.sin(u * dur * 37) * Math.sin(u * dur * 23 + 1.3);
    return clamp((1 - x * 0.7) * (fl > -0.35 ? 1 : 0.15) * (x > 0.9 ? 0.4 : 1), 0, 1);
  };
  const at = (t) => {
    const u = clamp((t - t0) / dur, 0, 1), active = t > t0;
    const W = whole(Math.min(u, ub));
    const broken = mode === 'break' && u > ub;
    return { u, active, mode, whole: mode === 'break' && !broken ? W : mode === 'break' ? whole(ub) : whole(u), fore: broken ? fore(u) : null, aft: broken ? aft(u) : null, broken, lamps: lamps(u), zB, under };
  };
  return { at, mode, t0, dur, zB, ub, apply, TM, lightsOut, brk };
}

// a section pose -> Matrix4 in the heading frame (translate(P) * R(trim, list) * translate(-R))
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);
export function sectionMatrix(S, out = new THREE.Matrix4()) {
  _e.set(S.trim, 0, -S.list, 'XYZ'); _q.setFromEuler(_e);
  out.compose(new THREE.Vector3(0, 0, 0), _q, _one);
  const r = new THREE.Vector3(-S.R[0], -S.R[1], -S.R[2]).applyQuaternion(_q);
  out.setPosition(r.x + S.P[0], r.y + S.P[1], r.z + S.P[2]);
  return out;
}

// split every mesh under `root` (in root's local frame) into a fore part (z > zCut) and an aft part: big meshes by
// triangle (a jagged tear, as steel plates part), instanced meshes by instance, small objects whole by their centre.
// Returns { fore, aft } groups (children of root, identity transforms before the break).
export function splitAt(root, zCut, o = {}) {
  const fore = new THREE.Group(), aft = new THREE.Group(); fore.name = 'fore'; aft.name = 'aft';
  const keep = new Set(o.keep || []);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const kids = [...root.children];
  const _b = new THREE.Box3(), _m = new THREE.Matrix4(), _c = new THREE.Vector3();
  for (const ch of kids) {
    if (keep.has(ch)) continue;
    _b.setFromObject(ch); _b.applyMatrix4(inv);
    const big = ch.isMesh && !ch.isSkinnedMesh && ch.geometry && (_b.max.z - _b.min.z) > (o.small ?? 12);
    if (ch.isInstancedMesh) {
      const parts = [[], []];
      for (let i = 0; i < ch.count; i++) { ch.getMatrixAt(i, _m); _c.setFromMatrixPosition(_m); (_c.z > zCut ? parts[0] : parts[1]).push(i); }
      const mk = (list, parent) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(ch.geometry, ch.material, list.length); im.name = ch.name; im.frustumCulled = ch.frustumCulled; im.renderOrder = ch.renderOrder;
        im.castShadow = ch.castShadow; im.receiveShadow = ch.receiveShadow;
        list.forEach((i, k) => { ch.getMatrixAt(i, _m); im.setMatrixAt(k, _m); if (ch.instanceColor) { const c = new THREE.Color(); ch.getColorAt(i, c); im.setColorAt(k, c); } });
        im.position.copy(ch.position); im.quaternion.copy(ch.quaternion); im.scale.copy(ch.scale);
        parent.add(im);
      };
      mk(parts[0], fore); mk(parts[1], aft); root.remove(ch);
      continue;
    }
    if (big && ch.geometry.index && !o.whole?.includes(ch)) {
      const g = ch.geometry, P = g.attributes.position, I = g.index.array, a = [], b = [];
      const M = ch.matrix;                                   // child -> root
      const v = new THREE.Vector3();
      for (let i = 0; i < I.length; i += 3) {
        let z = 0; for (let k = 0; k < 3; k++) { v.fromBufferAttribute(P, I[i + k]).applyMatrix4(M); z += v.z; }
        (z / 3 > zCut ? a : b).push(I[i], I[i + 1], I[i + 2]);
      }
      const mk = (idx, parent) => {
        if (!idx.length) return;
        const g2 = new THREE.BufferGeometry();
        for (const [k, at] of Object.entries(g.attributes)) g2.setAttribute(k, at);
        g2.setIndex(idx); g2.computeBoundingSphere(); g2.computeBoundingBox();
        const m = new THREE.Mesh(g2, ch.material); m.name = ch.name; m.renderOrder = ch.renderOrder; m.frustumCulled = ch.frustumCulled;
        m.castShadow = ch.castShadow; m.receiveShadow = ch.receiveShadow; m.position.copy(ch.position); m.quaternion.copy(ch.quaternion); m.scale.copy(ch.scale);
        m.onBeforeRender = ch.onBeforeRender;
        parent.add(m);
      };
      mk(a, fore); mk(b, aft); root.remove(ch);
      continue;
    }
    if (_b.isEmpty()) _c.copy(ch.position); else _b.getCenter(_c);
    (_c.z > zCut ? fore : aft).attach(ch);
  }
  root.add(fore, aft);
  return { fore, aft };
}

// ── the water around a sinking ship: foam ring at the waterline, a churned patch, spray, debris ───────────────────
// buildSinkFX(ctx, {L, beam, seed}) -> { root (world space), update(t, info) } where info = { active, u, pts: [[x, y, z]
// ...] hull sample points in world space (the waterline is where they cross y = level), level, gone (0..1 how far she
// is under), debris: 0..1 }
let FOAMTEX = null;
function foamTex() {
  if (FOAMTEX) return FOAMTEX;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const R = rng(4242), img = g.createImageData(N, N);
  const blobs = []; for (let k = 0; k < 90; k++) blobs.push([R() * N, R() * N, 4 + R() * 22, 0.3 + R() * 0.7]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let a = 0;
    for (const [bx, by, br, w] of blobs) { let dx = Math.abs(x - bx), dy = Math.abs(y - by); dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy); const d = Math.hypot(dx, dy) / br; if (d < 1) a += w * (1 - d * d) * (0.6 + 0.4 * Math.sin(x * 0.7 + y * 0.9)); }
    const i = (y * N + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
  }
  g.putImageData(img, 0, 0);
  FOAMTEX = new THREE.CanvasTexture(c); FOAMTEX.wrapS = FOAMTEX.wrapT = THREE.RepeatWrapping; FOAMTEX.userData.keep = true;
  return FOAMTEX;
}
export function buildSinkFX(ctx, o = {}) {
  const root = new THREE.Group(); root.name = 'sink-fx'; root.userData.noQA = true;
  const N = 160;
  const tex = foamTex();
  // foam patches: flat instanced quads on the water (world space), alpha from a blob texture, lit by the scene ambient
  const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.55, 0.6, 0.66), transparent: true, depthWrite: false, opacity: 0.85, fog: true });
  const U0 = ctx.U || null;
  const foam = new THREE.InstancedMesh(quad, mat, N); foam.name = 'sink-foam'; foam.frustumCulled = false; foam.renderOrder = 3;
  foam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(foam);
  // churned water: a dark disc (the white-water turmoil darkens at night) under the foam
  const dmat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.02, 0.025, 0.03), transparent: true, depthWrite: false, opacity: 0.0, fog: true });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), dmat); disc.renderOrder = 2; disc.name = 'sink-churn'; disc.frustumCulled = false;
  root.add(disc);
  // debris: planks, chairs, crates (instanced boxes) spreading out from the hull
  const ND = o.debris ?? 140;
  const dgeo = new THREE.BoxGeometry(1, 1, 1);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 0.9 });
  const deb = new THREE.InstancedMesh(dgeo, ctx.patch ? (ctx.patch(wood) || wood) : wood, ND); deb.name = 'sink-debris'; deb.frustumCulled = false; deb.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(deb);
  const R = rng((o.seed ?? 7) * 977 + 3), D = [];
  for (let i = 0; i < ND; i++) {
    const kind = R();
    const size = kind < 0.55 ? [0.25, 0.06, 1.4 + R() * 2.4] : kind < 0.8 ? [0.55, 0.45, 0.6] : [0.9 + R() * 0.8, 0.5, 0.7 + R() * 0.6];
    D.push({ a: (R() - 0.5) * 1.1, d: R(), side: R() < 0.5 ? -1 : 1, lat: 2 + R() * 22, born: 0.15 + R() * 0.8, spin: (R() - 0.5) * 0.4, yaw: R() * 6.28, size, ph: R() * 6.28 });
  }
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const hide = () => { m4.makeScale(0, 0, 0); };
  function update(t, info) {
    const W = ctx.ground?.water, lvl = info.level ?? 0;
    const wave = (x, z) => (W && W.heightAt ? W.heightAt(x, z, t) : lvl);
    // the waterline: where consecutive hull samples cross the level
    const cross = [];
    const P = info.pts || [];
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      if ((a[1] - lvl) * (b[1] - lvl) <= 0 && Math.abs(a[1] - b[1]) > 1e-4) { const f = (lvl - a[1]) / (b[1] - a[1]); cross.push([lerp(a[0], b[0], f), lerp(a[2], b[2], f), a[3]]); }
    }
    const night = clamp(U0?.uNight?.value ?? 0), k0 = info.active ? 1 : 0, k = k0 * (1 - smooth((info.gone ?? 0) * 1.2 - 0.3) * 0.2) * lerp(1, 0.32, night);
    let n = 0;
    const put = (x, z, s, rot, a) => {
      if (n >= N) return;
      qq.setFromEuler(e.set(0, rot, 0)); sv.set(s, 1, s * (0.7 + 0.3 * Math.sin(rot * 3))); pv.set(x, wave(x, z) + 0.06, z);
      m4.compose(pv, qq, sv); foam.setMatrixAt(n, m4); foam.setColorAt(n, new THREE.Color(a, a, a)); n++;
    };
    const beam = o.beam ?? 20;
    for (const [cx, cz, w] of cross) {
      // a ring of foam around where the hull pierces the surface, boiling (turns and breathes with t)
      const r = (w ?? beam * 0.5) + 2;
      for (let j = 0; j < 10; j++) { const a = j / 10 * Math.PI * 2 + t * 0.15; put(cx + Math.cos(a) * r * 0.8, cz + Math.sin(a) * r * 0.8, r * 0.9 + 3 * Math.sin(t * 1.7 + j), a + t * 0.3, 0.9 * k); }
      put(cx, cz, r * 1.6, t * 0.2, 0.7 * k);
    }
    // turbulence where she went down: stays and fades after
    const c = info.center || [0, 0];
    const g = info.gone ?? 0;
    if (g > 0.02 && info.active) {
      const Rr = beam * (1.2 + 2.5 * g) + (info.L ?? 100) * 0.25 * g;
      disc.position.set(c[0], lvl + 0.04, c[1]); disc.scale.set(Rr * 1.3, 1, Rr * 1.3); dmat.opacity = 0.35 * smooth(g * 3) ;
      for (let j = 0; j < 18 && n < N; j++) { const a = j * 2.39996 + t * 0.07, r = Rr * Math.sqrt((j + 0.5) / 18); put(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, Rr * 0.45, a * 1.7 + t * 0.25, 0.75 * smooth(g * 4) * (0.7 + 0.3 * Math.sin(t * 1.1 + j))); }
    } else dmat.opacity = 0;
    for (let i = n; i < N; i++) { hide(); foam.setMatrixAt(i, m4); }
    foam.count = N; foam.instanceMatrix.needsUpdate = true; if (foam.instanceColor) foam.instanceColor.needsUpdate = true;
    // debris floats out along the hull as she goes (born along the length, drifting outward, bobbing on the swell)
    const ax = info.axis || [0, 1], perp = [-ax[1], ax[0]], L = info.L ?? 100, u = info.u ?? 0;
    for (let i = 0; i < ND; i++) {
      const d = D[i], age = (u - d.born) * (info.dur ?? 20);
      if (!info.active || age <= 0) { hide(); deb.setMatrixAt(i, m4); continue; }
      const along = (d.d - 0.5) * L * 0.9, out = d.side * (beam * 0.5 + 1 + d.lat * (1 - Math.exp(-age / 25)) + 0.15 * age);
      const x = c[0] + ax[0] * along + perp[0] * out, z = c[1] + ax[1] * along + perp[1] * out;
      const y = wave(x, z) + d.size[1] * 0.2 + 0.03 * Math.sin(t * 1.3 + d.ph);
      qq.setFromEuler(e.set(0.05 * Math.sin(t + d.ph), d.yaw + d.spin * age, 0.06 * Math.sin(t * 0.8 + d.ph)));
      const grow = smooth(age / 0.8);
      sv.set(d.size[0] * grow, d.size[1] * grow, d.size[2] * grow); pv.set(x, y, z);
      m4.compose(pv, qq, sv); deb.setMatrixAt(i, m4);
    }
    deb.instanceMatrix.needsUpdate = true;
  }
  return { root, update };
}
