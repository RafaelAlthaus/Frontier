// smallcritters.js — small animals for macro shots (a camera 0.2–0.3 m above the ground, 1–1.5 m away):
//   creature.shrew   an ~11 cm shrew (7 cm head and body + 4.5 cm tail), dark grey-brown velvet fur, long twitching
//                    snout; actions sniff | scurry | peek | enter (its burrow), timed by item.actions [{t, action}]
//   creature.burrow  a mound of loose earth ~30 cm across with a dark ~5.6 cm tunnel mouth going down into the ground
// The shrew's body follows its route like a train (every bone at its own arc length), so it bends round turns and dives
// head first down the tunnel; the paws are planted in route coordinates (a stance paw keeps still, the swing leaves
// and lands at the stance's speed). Everything is a pure function of t. H2, 26 Sep 2026.
import * as THREE from 'three';
import { sculpt, rig } from './sculpt.js';
import { patchMaterial } from '../shared/env.js';
import { rng, makeNoise, clamp, lerp, smooth } from '../shared/util.js';

const TAU = Math.PI * 2, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
const NZ = makeNoise(4242);
const lin = (hex) => { const c = parseInt(hex.slice(1), 16); return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255].map((v) => Math.pow(v, 2.2)); };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hash1 = (k, s = 0) => { let h = Math.imul((k | 0) + 0x9E3779B9 * (s + 1), 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

export const CATALOG = {
  'creature.shrew': {
    desc: 'shrew for macro shots (~11 cm incl. 4.5 cm tail; dark grey-brown velvet fur, long twitching snout, whiskers). actions [{t, action}]: sniff (idle: snout, whiskers, head), scurry (bursts at `speed` 0.5 m/s along `path` or the heading, stops between), peek (half out of its burrow, head scanning), enter (runs head first into `burrow`: the head goes in at t + distance/speed, the tail 1.0 s later). burrow [x, z] builds the mound + hole (burrow_heading: where the entrance faces, default towards the shrew). Camera ~0.25 m up, 1.2–1.5 m away',
    actions: ['sniff', 'scurry', 'peek', 'enter'],
    params: { speed: 0.5, burrow: '[x, z]', burrow_heading: 'deg', path: '[[x, z], ...]', actions: '[{t, action, path?, dist?, speed?}]' },
    footprint: [0.03, 0.12], height: 0.03, tags: ['animal', 'mammal', 'shrew', 'mouse', 'small', 'macro', 'burrow', 'cretaceous'],
  },
  'creature.burrow': {
    desc: 'small animal burrow: a mound of loose earth ~30 cm across and a few cm high, crumbs and pebbles, a dark ~5.6 cm tunnel mouth going down into the ground (heading = where the entrance faces)',
    actions: [], params: {}, footprint: [0.3, 0.3], height: 0.06, tags: ['burrow', 'hole', 'ground', 'macro', 'animal'],
  },
};

// ── materials ────────────────────────────────────────────────────────────────────────────────────────────────────
// velvet fur: vertex colours, fine hair streaks along the body in rest space, a soft sheen at grazing angles; everything
// past the burrow mouth (inside the tunnel) fades to black
function furMaterial(ctx, D, o = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.rough ?? 0.74, metalness: 0, envMapIntensity: 0.5 });
  const u = { uFur: { value: o.fur ?? 1300 }, uSheen: { value: o.sheen ?? 0.6 }, uMouth: D.uMouth, uIn: D.uIn, uAxis: D.uAxis, uDark: D.uDark };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRest;\nvarying vec3 vRest;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRest; varying vec3 vWPos; uniform float uFur; uniform float uSheen; uniform vec3 uMouth; uniform vec3 uIn; uniform vec3 uAxis; uniform float uDark;
float fh3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float fn3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fh3(i), fh3(i + vec3(1,0,0)), w.x), mix(fh3(i + vec3(0,1,0)), fh3(i + vec3(1,1,0)), w.x), w.y),
             mix(mix(fh3(i + vec3(0,0,1)), fh3(i + vec3(1,0,1)), w.x), mix(fh3(i + vec3(0,1,1)), fh3(i + vec3(1,1,1)), w.x), w.y), w.z); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ vec3 rp = vRest * uFur;
  float fs = 1.0 - smoothstep(0.5, 1.4, length(fwidth(rp)));
  float s = fn3(vec3(rp.x * 1.7, rp.y * 1.7, rp.z * 0.3)) * 0.65 + fn3(rp * 2.4 + 7.0) * 0.35;
  diffuseColor.rgb *= mix(1.0, 0.78 + 0.44 * s, fs); }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{ float fr = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.4);
  reflectedLight.indirectDiffuse += (diffuseColor.rgb * 0.9 + vec3(0.012)) * fr * uSheen;
  vec3 q = vWPos - uAxis; float along = dot(vWPos - uMouth, uIn); float off = length(q - uIn * dot(q, uIn));
  float dk = uDark * smoothstep(-0.004, 0.045, along) * (1.0 - smoothstep(0.034, 0.05, off));
  float kd = 1.0 - 0.94 * dk;
  reflectedLight.directDiffuse *= kd; reflectedLight.indirectDiffuse *= kd; reflectedLight.directSpecular *= kd; reflectedLight.indirectSpecular *= kd; }`);
  };
  m.customProgramCacheKey = () => 'smallcritters-fur';
  return (ctx.patch || patchMaterial)(m) || m;
}
function softTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#fff'); g.addColorStop(0.45, '#b0b0b0'); g.addColorStop(1, '#000');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; return t;
}
let SOFT = null;
function shadowMat(ctx, a) {
  SOFT ||= softTex();
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: SOFT, transparent: true, opacity: a, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return (ctx.patch || patchMaterial)(m) || m;
}
// a grid mesh (nu x nv) whose vertices are rewritten on the ground each frame
function gridMesh(nu, nv, mat) {
  const g = new THREE.BufferGeometry(), P = new Float32Array(nu * nv * 3), UV = new Float32Array(nu * nv * 2), I = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const k = j * nu + i; UV[k * 2] = i / (nu - 1); UV[k * 2 + 1] = j / (nv - 1); }
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) { const a = j * nu + i; I.push(a, a + nu, a + 1, a + 1, a + nu, a + nu + 1); }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g.setIndex(I);
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 1; m.userData.noQA = true;
  return m;
}

// ── the burrow ───────────────────────────────────────────────────────────────────────────────────────────────────
// at: [x, z] of the hole; heading (compass deg) = where the entrance faces. The tunnel dips 35 deg into the ground away
// from the entrance; the mound is piled behind and round it. Returns the geometry and the maths the shrew walks on.
function makeBurrow(ctx, at, headingDeg, seed) {
  const G = (x, z) => (ctx.ground ? ctx.ground.height(x, z) : 0);
  const R = rng(seed * 977 + 13);
  const hr = headingDeg * Math.PI / 180, fwd = V(Math.sin(hr), 0, -Math.cos(hr)), dh = fwd.clone().negate();
  const rt = 0.028, dip = 35 * Math.PI / 180, LEN = 0.16, NA = 48, K = 14;
  const Mx = at[0] + fwd.x * 0.012, Mz = at[1] + fwd.z * 0.012;
  const M = V(Mx, G(Mx, Mz) + 0.006, Mz);
  const d = dh.clone().multiplyScalar(Math.cos(dip)).add(V(0, -Math.sin(dip), 0)).normalize();
  const Ud = UP.clone().addScaledVector(d, -d.y).normalize(), Ld = new THREE.Vector3().crossVectors(d, Ud).normalize();
  const C0 = M.clone().addScaledVector(Ud, rt);
  const ringS = (k) => LEN * Math.pow(k / K, 1.25);
  const ringPt = (k, j) => { const s = ringS(k), r = rt * (1 - 0.14 * s / LEN), th = j / NA * TAU; return C0.clone().addScaledVector(d, s).addScaledVector(Ud, -Math.cos(th) * r).addScaledVector(Ld, Math.sin(th) * r); };
  const H = V(C0.x, 0, C0.z);
  // the rim (tube ring 0) seen from the hole's centre: angle, radius and height above the ground per column
  const rim = [];
  for (let j = 0; j < NA; j++) { const p = ringPt(0, j), dx = p.x - H.x, dz = p.z - H.z; rim.push({ p, psi: Math.atan2(dz, dx), r: Math.hypot(dx, dz), h: p.y - G(p.x, p.z) }); }
  const psiDh = Math.atan2(dh.z, dh.x), ph0 = R() * 10;
  const back = (psi) => 0.5 + 0.5 * Math.cos(psi - psiDh);
  const Rout = (psi) => 0.115 + 0.06 * back(psi) + 0.018 * NZ.noise2(Math.cos(psi) * 1.7 + ph0, Math.sin(psi) * 1.7 + 3.3);
  const crest = (psi) => 0.006 + 0.017 * Math.pow(back(psi), 1.5);
  const lumps = (x, z) => NZ.noise2(x * 95 + 3.1 + ph0, z * 95 - 7.7) * 0.0028 + NZ.noise2(x * 270 - 1.3, z * 270 + 5.2 + ph0) * 0.0012;
  const hOf = (u, rimH, psi, x, z) => { const uu = clamp(u); return rimH * Math.pow(1 - uu, 1.7) + crest(psi) * 6.75 * uu * (1 - uu) * (1 - uu) + lumps(x, z) * smooth(uu * 5) * (1 - uu * uu * uu); };
  // rim table sorted by angle, for heightAt()
  const tab = rim.map((q) => [q.psi, q.r, q.h]).sort((a, b) => a[0] - b[0]);
  const rimAt = (psi) => {
    const n = tab.length; let i = 0; while (i < n && tab[i][0] < psi) i++;
    const a = tab[(i - 1 + n) % n], b = tab[i % n]; let pa = a[0], pb = b[0]; if (pb < pa) pb += TAU; let p = psi; if (p < pa) p += TAU;
    const f = clamp((p - pa) / ((pb - pa) || 1)); return [lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  };
  const heightAt = (x, z) => {
    const dx = x - H.x, dz = z - H.z, r = Math.hypot(dx, dz); if (r > 0.3) return 0;
    const psi = Math.atan2(dz, dx), [r0, rimH] = rimAt(psi), ro = Rout(psi);
    if (r >= ro) return 0;
    return hOf((r - r0) / (ro - r0), rimH, psi, x, z);
  };
  const group = new THREE.Group(); group.name = 'creature.burrow';
  const soilA = lin('#473628'), soilB = lin('#6b5540'), soilC = lin('#2e241b');
  // mound: rings from the rim out to the irregular foot of the pile
  {
    const NM = 30, cols = NA + 1, P = new Float32Array((NM + 1) * cols * 3), C = new Float32Array((NM + 1) * cols * 3), I = [];
    for (let m = 0; m <= NM; m++) for (let jj = 0; jj < cols; jj++) {
      const j = jj % NA, q = rim[j], u = Math.pow(m / NM, 1.15), ro = Rout(q.psi), r = lerp(q.r, ro, u);
      const x = H.x + Math.cos(q.psi) * r, z = H.z + Math.sin(q.psi) * r, y = m === 0 ? q.p.y : G(x, z) + hOf(u, q.h, q.psi, x, z);
      const k = m * cols + jj; P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
      const nz = NZ.noise2(x * 60 + 1.7, z * 60 - 2.9) * 0.5 + 0.5, fine = NZ.noise2(x * 400, z * 400) * 0.5 + 0.5;
      let c = mix3(soilA, soilB, clamp(nz * 1.2 - 0.1 + (fine - 0.5) * 0.5));
      c = mix3(soilC, c, 0.45 + 0.55 * smooth(u * 3.2));                // darker at the lip of the hole
      c = c.map((v) => v * (0.92 + 0.16 * fine) * (u > 0.92 ? 0.9 : 1));
      C[k * 3] = c[0]; C[k * 3 + 1] = c[1]; C[k * 3 + 2] = c[2];
    }
    for (let m = 0; m < NM; m++) for (let j = 0; j < NA; j++) { const a = m * cols + j, b = a + 1, c = a + cols, e = c + 1; I.push(a, b, c, b, e, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals();
    // the winding must face up: flip if the first triangle's normal points down
    const n0 = g.attributes.normal; let up = 0; for (let i = 0; i < n0.count; i += 7) up += n0.getY(i); if (up < 0) { for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } g.setIndex(I); g.computeVertexNormals(); }
    const mat = (ctx.patch || patchMaterial)(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, side: THREE.DoubleSide })) ;
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'burrow.mound'; mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.noQA = true;
    group.add(mesh);
  }
  // the tunnel: rings down along the axis, dark soil fading to black, closed at the far end
  {
    const cols = NA + 1, P = new Float32Array((K + 2) * cols * 3), C = new Float32Array((K + 2) * cols * 3), I = [];
    for (let k = 0; k <= K; k++) for (let jj = 0; jj < cols; jj++) {
      const p = ringPt(k, jj % NA), i = k * cols + jj; P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      const s = ringS(k), dk = 0.03 + 0.5 * (1 - smooth(s / 0.07)), n = 0.9 + 0.2 * (NZ.noise2(p.x * 300, p.z * 300 + p.y * 200) * 0.5 + 0.5);
      C[i * 3] = soilA[0] * dk * n; C[i * 3 + 1] = soilA[1] * dk * n; C[i * 3 + 2] = soilA[2] * dk * n;
    }
    const e = C0.clone().addScaledVector(d, LEN + 0.004);                 // end cap centre
    for (let jj = 0; jj < cols; jj++) { const i = (K + 1) * cols + jj; P[i * 3] = e.x; P[i * 3 + 1] = e.y; P[i * 3 + 2] = e.z; C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = 0.003; }
    for (let k = 0; k <= K; k++) for (let j = 0; j < NA; j++) { const a = k * cols + j, b = a + 1, c = a + cols, f = c + 1; I.push(a, c, b, b, c, f); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals();
    const mat = (ctx.patch || patchMaterial)(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.2 }));
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'burrow.tunnel'; mesh.receiveShadow = true; mesh.userData.noQA = true;
    group.add(mesh);
  }
  // where the tunnel passes below the terrain, the terrain would show inside it: a black floor over it (only visible
  // through the mouth; the mound covers the rest)
  {
    const nu = 3, nv = 14, mesh = gridMesh(nu, nv, (ctx.patch || patchMaterial)(new THREE.MeshBasicMaterial({ color: 0x050403, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    const P = mesh.geometry.attributes.position.array, Lh = V(-dh.z, 0, dh.x);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = 0.005 + (LEN * Math.cos(dip) + 0.02) * j / (nv - 1), w = lerp(0.022, 0.034, smooth(j / 3)) * (i / (nu - 1) * 2 - 1);
      const x = M.x + dh.x * a + Lh.x * w, z = M.z + dh.z * a + Lh.z * w, k = (j * nu + i) * 3;
      P[k] = x; P[k + 1] = G(x, z) + 0.0015; P[k + 2] = z;
    }
    mesh.geometry.computeVertexNormals(); mesh.name = 'burrow.dark'; mesh.renderOrder = 0;
    group.add(mesh);
  }
  // soft shading at the foot of the pile (contact shadow)
  {
    const nr = 8, na = 40, mesh = gridMesh(na + 1, nr, shadowMat(ctx, 0.42));
    const P = mesh.geometry.attributes.position.array, UV = mesh.geometry.attributes.uv.array;
    for (let j = 0; j < nr; j++) for (let i = 0; i <= na; i++) {
      const psi = i / na * TAU, r = (Rout(psi) + 0.04) * j / (nr - 1), x = H.x + Math.cos(psi) * r, z = H.z + Math.sin(psi) * r, k = j * (na + 1) + i;
      P[k * 3] = x; P[k * 3 + 1] = G(x, z) + 0.001; P[k * 3 + 2] = z;
      UV[k * 2] = 0.5 + Math.cos(psi) * 0.5 * j / (nr - 1); UV[k * 2 + 1] = 0.5 + Math.sin(psi) * 0.5 * j / (nr - 1);
    }
    mesh.geometry.computeVertexNormals(); mesh.name = 'contactShadow';
    group.add(mesh);
  }
  // crumbs of earth and a few pebbles on and round the pile
  {
    const n = 110, geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = (ctx.patch || patchMaterial)(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }));
    const im = new THREE.InstancedMesh(geo, mat, n); im.name = 'burrow.crumbs'; im.castShadow = true; im.receiveShadow = true; im.userData.noQA = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const psi = R() * TAU, [r0] = rimAt(psi), ro = Rout(psi), onPile = i < n * 0.62;
      const r = onPile ? lerp(r0 + 0.012, ro, Math.pow(R(), 0.8)) : ro + Math.pow(R(), 1.6) * 0.13;
      const x = H.x + Math.cos(psi) * r, z = H.z + Math.sin(psi) * r, pebble = R() < 0.1;
      const sz = pebble ? 0.0035 + R() * 0.004 : 0.0012 + Math.pow(R(), 1.5) * 0.0035;
      const y = G(x, z) + heightAt(x, z) + sz * 0.3;
      q.setFromEuler(e.set(R() * TAU, R() * TAU, R() * TAU));
      m4.compose(V(x, y, z), q, V(sz, sz * (0.6 + R() * 0.3), sz * (0.8 + R() * 0.4))); im.setMatrixAt(i, m4);
      if (pebble) col.setRGB(...lin(['#8a8276', '#a39a88', '#6e675e'][Math.floor(R() * 3)]));
      else { const c = mix3(soilA, soilB, R()); col.setRGB(c[0], c[1], c[2]); }
      im.setColorAt(i, col);
    }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    group.add(im);
  }
  // the floor the shrew walks on inside the tunnel (the tube's bottom line) and the way out over the apron
  const tunnelFloor = (s) => M.clone().addScaledVector(d, s);
  return { group, M, d, dh, fwd, C0, rt, heightAt, tunnelFloor, LEN, H, radius: Math.max(...rim.map((q) => Rout(q.psi))) };
}

// ── routes: the floor the paws walk on, sampled every few mm, arc length in 3D ───────────────────────────────────
class Route {
  constructor(pts, o = {}) {
    const P = [pts[0]];
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(P[P.length - 1]) > 4e-4) P.push(pts[i]);
    if (P.length < 2) P.push(P[0].clone().add(V(0, 0, 0.001)));
    const S = [0]; for (let i = 1; i < P.length; i++) S.push(S[i - 1] + P[i].distanceTo(P[i - 1]));
    this.P = P; this.S = S; this.len = S[S.length - 1]; this.sM = o.sM ?? null; this.dir = o.dir ?? null;
  }
  pos(s, out = V()) {
    const P = this.P, S = this.S, n = P.length;
    if (s <= 0) return out.copy(P[1]).sub(P[0]).normalize().multiplyScalar(s).add(P[0]);
    if (s >= this.len) return out.copy(P[n - 1]).sub(P[n - 2]).normalize().multiplyScalar(s - this.len).add(P[n - 1]);
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    return out.copy(P[lo]).lerp(P[hi], (s - S[lo]) / ((S[hi] - S[lo]) || 1));
  }
  frame(s) {
    const p = this.pos(s), T = this.pos(s + 0.006).sub(this.pos(s - 0.006)).normalize();
    const U = UP.clone().addScaledVector(T, -T.y).normalize(), L = new THREE.Vector3().crossVectors(U, T).normalize();
    return { p, T, U, L };
  }
  upTo(s) { const out = []; for (let i = 0; i < this.P.length && this.S[i] < s - 5e-4; i++) out.push(this.P[i].clone()); out.push(this.pos(s)); return out; }
}
function surfacePts(xz, floorY, step = 0.003) {
  const out = [];
  for (let i = 0; i < xz.length - 1; i++) {
    const a = xz[i], b = xz[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = i ? 1 : 0; k <= n; k++) { const x = lerp(a[0], b[0], k / n), z = lerp(a[1], b[1], k / n); out.push(V(x, floorY(x, z), z)); }
  }
  return out;
}
function roundCorners(P, R) {                         // corners as arcs of radius R (an animal turns along a curve)
  if (P.length < 3) return P;
  const out = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const A = out[out.length - 1], B = P[i], C = P[i + 1];
    const l1 = Math.hypot(B[0] - A[0], B[1] - A[1]), l2 = Math.hypot(C[0] - B[0], C[1] - B[1]);
    if (l1 < 1e-5 || l2 < 1e-5) continue;
    const u1 = [(B[0] - A[0]) / l1, (B[1] - A[1]) / l1], u2 = [(C[0] - B[0]) / l2, (C[1] - B[1]) / l2];
    const cr = u1[0] * u2[1] - u1[1] * u2[0], phi = Math.acos(clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1));
    if (phi < 0.02) { out.push(B); continue; }
    const tn = Math.min(R * Math.tan(phi / 2), l1 * 0.5, l2 * 0.5), r = tn / Math.tan(phi / 2), sg = cr >= 0 ? 1 : -1;
    const T1 = [B[0] - u1[0] * tn, B[1] - u1[1] * tn], c = [T1[0] - u1[1] * sg * r, T1[1] + u1[0] * sg * r];
    const a0 = Math.atan2(T1[1] - c[1], T1[0] - c[0]), m = Math.max(2, Math.ceil(phi / (Math.PI / 20)));
    for (let k = 0; k <= m; k++) { const a = a0 + sg * phi * k / m; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  }
  out.push(P[P.length - 1]);
  return out;
}
function bezier2(P0, P1, P2, P3, n) { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, e = t ** 3; out.push([a * P0[0] + b * P1[0] + c * P2[0] + e * P3[0], a * P0[1] + b * P1[1] + c * P2[1] + e * P3[1]]); } return out; }
// s(t) tables: runs in bursts (or on and on) from s0 towards s1 and brakes into s1
function table(t0, T, S, dt) { return (t) => { if (t <= t0) return S[0]; const f = (t - t0) / dt, i = Math.floor(f); if (i >= S.length - 1) return S[S.length - 1]; return lerp(S[i], S[i + 1], f - i); }; }
function burstRun(t0, t1, s0, s1, v, R) {
  const dt = 1 / 240, bursts = []; let tt = t0 + 0.05;
  while (tt < t1) { const b = 0.45 + R() * 0.4; bursts.push([tt, Math.min(t1, tt + b)]); tt += b + 0.22 + R() * 0.38; }
  const vAt = (t) => { for (const [a, b] of bursts) if (t >= a && t <= b) return v * smooth((t - a) / 0.07) * smooth((b - t) / 0.07); return 0; };
  const S = []; let s = s0;
  for (let t = t0; t <= t1 + dt; t += dt) { S.push(s); s = Math.min(s1, s + Math.min(vAt(t), Math.sqrt(2 * 3.0 * Math.max(0, s1 - s))) * dt); }
  return table(t0, null, S, dt);
}

// ── the shrew's body (sculpted once per page) ─────────────────────────────────────────────────────────────────────
const TIP = 0.0395, TAIL0 = -0.029, TAIL_L = 0.046, LEN_ALL = TIP - TAIL0 + TAIL_L;
const BONES = [['pelvis', -0.017, 0.0158], ['spine', -0.002, 0.0168], ['chest', 0.011, 0.016], ['head', 0.0205, 0.0155], ['snout', 0.0295, 0.0135]];
const LEGS = [                       // side (+1 = left, +x), bone, hip (rest), upper, lower, paw length, fore, gait offset
  [1, 'chest', [0.0066, 0.0118, 0.0105], 0.0068, 0.0066, 0.0056, true, 0.0],
  [-1, 'chest', [-0.0066, 0.0118, 0.0105], 0.0068, 0.0066, 0.0056, true, 0.5],
  [1, 'pelvis', [0.0078, 0.0118, -0.0185], 0.0078, 0.0076, 0.0078, false, 0.5],
  [-1, 'pelvis', [-0.0078, 0.0118, -0.0185], 0.0078, 0.0076, 0.0078, false, 0.0],
];
const COL = { back: lin('#3b312a'), flank: lin('#54463b'), belly: lin('#877b70'), nose: lin('#a07e74'), paw: lin('#b0948a'), ear: lin('#43372f'), tailT: lin('#3a302a'), tailB: lin('#7a6c62') };
let SC = null;
function shrewBody() {
  if (SC) return SC;
  const t0 = performance.now();
  const el = (b, c, r, k, o = {}) => Object.assign({ t: 'el', b, c, r, k }, o);
  const rc = (b, a, b2, r1, r2, k, o = {}) => Object.assign({ t: 'rc', b, a, b2, r1, r2, k }, o);
  const bones = [['pelvis', null, [0, 0.0158, -0.017]], ['spine', 'pelvis', [0, 0.0168, -0.002]], ['chest', 'spine', [0, 0.016, 0.011]], ['head', 'chest', [0, 0.0155, 0.0205]], ['snout', 'head', [0, 0.0135, 0.0295]]];
  const prims = [
    el('pelvis', [0, 0.0152, -0.0175], [0.0118, 0.0112, 0.0135], 0.005),
    el('pelvis', [0, 0.013, -0.0285], [0.0032, 0.003, 0.0036], 0.0025),
    el('spine', [0, 0.0165, -0.002], [0.0128, 0.0122, 0.0155], 0.005),
    el('chest', [0, 0.0157, 0.0105], [0.0112, 0.011, 0.0115], 0.005),
    el('head', [0, 0.0148, 0.0225], [0.0079, 0.0076, 0.0102], 0.004),
    rc('snout', [0, 0.0132, 0.0285], [0, 0.0098, 0.0392], 0.0043, 0.0013, 0.0024),
    el('snout', [0, 0.0096, 0.0395], [0.0016, 0.0015, 0.0015], 0.0007, { col: 'nose', zoneBias: 0.0004 }),
  ];
  for (const s of [1, -1]) {
    prims.push(el('head', [0.0059 * s, 0.0172, 0.0262], [0.0011, 0.0011, 0.0011], 0.0003, { col: 'eye', zoneBias: 0.0006 }));
    prims.push(el('head', [0.0072 * s, 0.0205, 0.0165], [0.0028, 0.003, 0.0014], 0.0012, { col: 'ear', ry: 0.5 * s }));
  }
  const color = (p, n, z) => {
    if (z?.col === 'eye') return [0.004, 0.003, 0.003];
    if (z?.col === 'nose') return COL.nose;
    let c = mix3(COL.belly, COL.flank, smooth((n[1] + 0.55) / 0.5));
    c = mix3(c, COL.back, smooth((n[1] - 0.05) / 0.6));
    if (z?.col === 'ear') c = COL.ear;
    if (p[2] > 0.031) c = mix3(c, COL.nose, smooth((p[2] - 0.031) / 0.008) * 0.8);          // the bare pink-grey snout tip
    const g = hash1(Math.floor(p[0] * 2200) * 73856093 ^ Math.floor(p[1] * 2200) * 19349663 ^ Math.floor(p[2] * 500) * 83492791);
    return c.map((v) => v * (0.86 + 0.26 * g));
  };
  const sc = sculpt({ bones, prims }, 0.00055, { sigma: 0.003, relax: 3 });
  const g = sc.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, col = new Float32Array(sc.nv * 3);
  for (let i = 0; i < sc.nv; i++) { const c = color([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], sc.prims[sc.zone[i]]); col.set(c, i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  console.log('[nature.smallcritters] sculpted shrew', Math.round(performance.now() - t0), 'ms', sc.nv, 'verts');
  return (SC = sc);
}
// unit parts (legs, paws) with the attributes the fur material reads
function part(geo, c) {
  const n = geo.attributes.position.count, C = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) C.set(c, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(C, 3)); geo.setAttribute('aRest', geo.attributes.position.clone());
  return geo;
}
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler(), _v = V(), _w = V();
function basisQ(T, U, out) { const X = new THREE.Vector3().crossVectors(U, T).normalize(), Y = new THREE.Vector3().crossVectors(T, X).normalize(); _m.makeBasis(X, Y, T); return out.setFromRotationMatrix(_m); }
function seg(mesh, a, b, r0) { const d = _v.copy(b).sub(a), L = d.length(); mesh.position.copy(a); mesh.quaternion.setFromUnitVectors(UP, d.normalize()); mesh.scale.set(r0, Math.max(L, 1e-5), r0); }

function parseActions(item) {
  const A = { sniff: 'sniff', idle: 'sniff', stand: 'sniff', graze: 'sniff', eat: 'sniff', scurry: 'scurry', run: 'scurry', walk: 'scurry', move: 'scurry', trot: 'scurry', peek: 'peek', look: 'peek', emerge: 'peek', enter: 'enter', hide: 'enter', burrow: 'enter', dive: 'enter' };
  let list = Array.isArray(item.actions) ? item.actions.filter((a) => a && typeof a === 'object').map((a) => ({ ...a, t: +a.t || 0, action: A[a.action] || 'sniff' })) : [];
  if (!list.length) list = [{ t: 0, action: A[item.action] || (item.path ? 'scurry' : 'sniff') }];
  list.sort((a, b) => a.t - b.t);
  if (list[0].t > 0) list.unshift({ t: 0, action: 'sniff' });
  return list;
}

async function buildShrew(kind, item, ctx) {
  const G = (x, z) => (ctx.ground ? ctx.ground.height(x, z) : 0);
  const seed = (item.seed ?? 7) * 131 + 17, R = rng(seed), warn = (m) => (ctx.warn ? ctx.warn(m) : (ctx.warnings || []).push(m));
  const acts = parseActions(item);
  // item.params also carries the catalog's param descriptions (strings): only real numbers and arrays count
  const num = (k) => { const x = item[k] ?? item.params?.[k]; return typeof x === 'number' && Number.isFinite(x) ? x : null; };
  const arr = (k) => (Array.isArray(item[k]) ? item[k] : Array.isArray(item.params?.[k]) ? item.params[k] : null);
  const v = clamp(num('speed') ?? 0.5, 0.15, 0.9);
  const at = item.at || [0, 0], hr = (item.heading ?? 0) * Math.PI / 180, dir0 = [Math.sin(hr), -Math.cos(hr)];
  // the burrow (built here when `burrow` is given; peek/enter without one dig it 25 cm ahead)
  let bAt = arr('burrow');
  if (!bAt && acts.some((a) => a.action === 'enter' || a.action === 'peek')) { bAt = [at[0] + dir0[0] * 0.25, at[1] + dir0[1] * 0.25]; warn(`${kind}: peek/enter without a burrow; one is dug 25 cm ahead`); }
  let B = null;
  if (bAt) {
    const away = Math.hypot(at[0] - bAt[0], at[1] - bAt[1]);
    const bh = num('burrow_heading') ?? (away > 0.05 && acts[0].action !== 'peek' ? Math.atan2(at[0] - bAt[0], -(at[1] - bAt[1])) * 180 / Math.PI : item.heading ?? 0);
    B = makeBurrow(ctx, bAt, +bh, seed);
  }
  const floorY = (x, z) => G(x, z) + (B ? B.heightAt(x, z) : 0);
  const root = new THREE.Group(); root.name = kind;
  if (B) root.add(B.group);
  // ── plan: segments {t0, route, f(t) -> s (arc length of the snout tip), mode} ──
  const segs = [];
  const outPts = () => { const P = []; for (let s = B.LEN + 0.03; s > 0.0005; s -= 0.004) P.push(B.tunnelFloor(s)); P.push(B.M.clone()); const e = [B.M.x + B.fwd.x * 0.4, B.M.z + B.fwd.z * 0.4]; return P.concat(surfacePts([[B.M.x, B.M.z], e], floorY).slice(1)); };
  const peekRoute = () => new Route(outPts(), { sM: B.LEN + 0.03, dir: 'out' });
  let route, s, inside = false, lastMode = null;
  if (acts[0].action === 'peek' && B) { route = peekRoute(); s = route.sM - 0.035; inside = true; }
  else {
    route = new Route(surfacePts([[at[0] - dir0[0] * 0.3, at[1] - dir0[1] * 0.3], [at[0] + dir0[0] * 0.08, at[1] + dir0[1] * 0.08]], floorY));
    s = 0.3 + TIP;                       // the body's middle (model z = 0) stands on `at`
  }
  const timing = {};
  const emerge = (t0, t1) => {           // from inside the tunnel to half out of the mouth, then the head scans
    route = peekRoute(); const s0 = route.sM - 0.035, s1 = route.sM + 0.036, rt = route, ts = t0 + 0.2;
    segs.push({ t0, route: rt, mode: 'peek', f: (t) => lerp(s0, s1, smooth((t - ts) / 0.65)) });
    s = s1; inside = false; lastMode = 'peek';
  };
  const enterAt = (t0, t1) => {           // run head first to the mouth and in; the tail passes the mouth 1.0 s after the head
    const F = route.frame(s), P0 = [F.p.x, F.p.z], D = [F.T.x, F.T.z], dl = Math.hypot(D[0], D[1]) || 1;
    const A = [B.M.x - B.dh.x * 0.05, B.M.z - B.dh.z * 0.05], dist = Math.hypot(A[0] - P0[0], A[1] - P0[1]), k = Math.max(0.02, dist * 0.42);
    const curve = dist > 0.01 ? bezier2(P0, [P0[0] + D[0] / dl * k, P0[1] + D[1] / dl * k], [A[0] - B.dh.x * k, A[1] - B.dh.z * k], A, Math.max(6, Math.ceil(dist / 0.004))) : [P0];
    const hist = route.upTo(s), sur = surfacePts(curve.concat([[B.M.x, B.M.z]]), floorY).slice(1);
    const tun = []; for (let q = 0.004; q <= B.LEN + 0.03; q += 0.004) tun.push(B.tunnelFloor(q));
    const pts = hist.concat(sur); pts.push(B.M.clone());
    const probe = new Route(pts); const sM = probe.len;
    route = new Route(pts.concat(tun), { sM, dir: 'in' });
    const dt = 1 / 240, S = []; let ss = s, tt = t0;
    while (ss < sM && tt < t0 + 20) { S.push(ss); ss += v * smooth((tt - t0 - 0.02) / 0.07) * dt; tt += dt; }
    const tHead = t0 + S.length * dt, run = table(t0, null, S.length ? S : [s], dt), kk = Math.max(1.5, v * 1.0 / LEN_ALL), s0 = s;
    timing.head_in = +tHead.toFixed(2); timing.tail_in = +(tHead + 1.0).toFixed(2);
    segs.push({ t0, route, mode: 'enter', f: (t) => { if (t < tHead) return t <= t0 ? s0 : run(t); const u = (t - tHead) / 1.0; return u < 1 ? sM + LEN_ALL * (1 - Math.pow(1 - u, kk)) : sM + LEN_ALL + 0.02 * Math.min(1, u - 1); } });
    s = sM + LEN_ALL + 0.02; inside = true; lastMode = 'enter';
    return tHead + 1.0;
  };
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i], t0 = a.t, t1 = i + 1 < acts.length ? acts[i + 1].t : t0 + (a.dur ?? 30);
    if (a.action === 'sniff') { const s0 = s; segs.push({ t0, route, mode: inside ? 'hidden' : 'sniff', f: () => s0 }); lastMode = 'sniff'; continue; }
    if (a.action === 'peek') {
      if (!B) { const s0 = s; segs.push({ t0, route, mode: 'sniff', f: () => s0 }); continue; }
      if (inside || i === 0) { emerge(t0, t1); continue; }
      const tIn = enterAt(t0, t1); if (tIn + 0.6 < t1) emerge(tIn + 0.6, t1);
      continue;
    }
    if (a.action === 'enter') {
      if (!B || inside) { const s0 = s; segs.push({ t0, route, mode: inside ? 'hidden' : 'sniff', f: () => s0 }); continue; }
      if (lastMode === 'peek' && route.dir === 'out') {            // after a peek: backs into the tunnel, head last
        const prev = segs[segs.length - 1], s0 = prev && prev.route === route ? prev.f(t0) : s, s1 = route.sM - LEN_ALL - 0.03, rt = route;   // from where it is (a short peek may not have finished emerging) (Q9)
        segs.push({ t0, route: rt, mode: 'withdraw', f: (t) => lerp(s0, s1, smooth((t - t0) / 1.2)) });
        timing.head_in = +(t0 + 1.2).toFixed(2); timing.tail_in = +(t0 + 0.55).toFixed(2);
        s = s1; inside = true; lastMode = 'enter'; continue;
      }
      enterAt(t0, t1); continue;
    }
    // scurry: bursts along the path (or ahead), never past its end
    const emerged = inside && B; if (emerged) emerge(t0, t0 + 0.9);
    const F = route.frame(s), head = [F.p.x, F.p.z];
    let pts2 = a.path || (!segs.some((q) => q.mode === 'run') ? arr('path') : null);
    if (!Array.isArray(pts2) || !pts2.length) { const dist = a.dist ?? Math.min(0.5, v * Math.max(0.3, t1 - t0) * 0.5), dl = Math.hypot(F.T.x, F.T.z) || 1; pts2 = [[head[0] + F.T.x / dl * dist, head[1] + F.T.z / dl * dist]]; }
    const xz = roundCorners([head, ...pts2.map((q) => [+q[0], +q[1]])], 0.035);
    const s0 = s, hist = route.upTo(s);
    route = new Route(hist.concat(surfacePts(xz, floorY).slice(1)), { sM: route.sM, dir: route.dir });
    const tb = emerged ? t0 + 0.9 : t0;
    const run = burstRun(tb, t1, s0, route.len - 0.002, clamp(+(a.speed ?? v), 0.15, 0.9), R), rt = route;
    segs.push({ t0: tb, route: rt, mode: 'run', f: run });
    s = run(t1); lastMode = 'run';
  }
  segs.sort((a, b) => a.t0 - b.t0);
  const segAt = (t) => { let k = 0; for (let i = 0; i < segs.length; i++) if (segs[i].t0 <= t) k = i; return segs[k]; };
  if (timing.head_in != null) console.log('[nature.smallcritters] shrew: head into the burrow at', timing.head_in, 's, tail gone at', timing.tail_in, 's');

  // ── the animal ──
  const D = { uMouth: { value: B ? B.M.clone() : V(1e5, 0, 0) }, uIn: { value: B ? B.d.clone() : V(0, -1, 0) }, uAxis: { value: B ? B.C0.clone() : V(1e5, 0, 0) }, uDark: { value: B ? 1 : 0 } };
  const fur = furMaterial(ctx, D), sc = shrewBody();
  const rg = rig(sc, fur); rg.mesh.name = 'shrew.body';
  const animal = new THREE.Group(); animal.name = 'shrew'; animal.add(rg.root); root.add(animal);
  const bn = BONES.map(([name]) => rg.bones[name]);
  const restOf = Object.fromEntries(sc.boneDefs.map((b) => [b[0], V(...b[2])]));
  // eyes: glossy beads on the head bone
  const eyeMat = (ctx.patch || patchMaterial)(new THREE.MeshStandardMaterial({ color: 0x050404, roughness: 0.12, metalness: 0, envMapIntensity: 1.2 }));
  for (const sd of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.00118, 10, 8), eyeMat); e.position.set(0.0061 * sd, 0.0173, 0.0263).sub(restOf.head); rg.bones.head.add(e); }
  // whiskers: fine pale lines from the snout, whisking
  const wMat = new THREE.LineBasicMaterial({ color: 0xd2c9bf, transparent: true, opacity: 0.6, depthWrite: false });
  const whisk = [];
  for (const sd of [1, -1]) {
    const piv = new THREE.Object3D(); piv.position.set(0.0022 * sd, 0.0113, 0.0355).sub(restOf.snout); rg.bones.snout.add(piv);
    const P = [];
    for (let j = 0; j < 7; j++) {
      const el = (j / 6 - 0.5) * 0.9, L = 0.013 + hash1(j, sd + 3) * 0.006, dz = 0.5 + 0.25 * Math.cos(el * 2), dx = sd * 0.85;
      const dir = V(dx, Math.sin(el) * 0.6, dz).normalize(), o = V(0, (j - 3) * 0.0003, -0.0012 * Math.abs(j - 3) / 3);
      const mid = o.clone().addScaledVector(dir, L * 0.5).add(V(0, -L * 0.04, 0)), end = o.clone().addScaledVector(dir, L).add(V(0, -L * 0.14, 0));
      P.push(o.x, o.y, o.z, mid.x, mid.y, mid.z, mid.x, mid.y, mid.z, end.x, end.y, end.z);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const ls = new THREE.LineSegments(g, wMat); ls.frustumCulled = false; ls.userData.noQA = true; piv.add(ls); whisk.push([piv, sd]);
  }
  // legs: upper and lower segments + a paw, placed by 2-bone IK every frame
  const legFur = part(new THREE.CylinderGeometry(0.75, 1, 1, 8, 1, false).translate(0, 0.5, 0), COL.flank);   // thick end at the hip
  const legLow = part(new THREE.CylinderGeometry(0.8, 1, 1, 8, 1, false).translate(0, 0.5, 0), COL.paw);     // thick end at the knee
  const pawG = part(new THREE.SphereGeometry(1, 10, 6), COL.paw);
  const legs = LEGS.map(([side, bone, hip, L1, L2, pawL, fore, off]) => {
    const anchor = new THREE.Object3D(); anchor.position.set(...hip).sub(restOf[bone]); rg.bones[bone].add(anchor);
    const up = new THREE.Mesh(legFur, fur), lo = new THREE.Mesh(legLow, fur), paw = new THREE.Mesh(pawG, fur);
    for (const m of [up, lo, paw]) { m.castShadow = true; m.frustumCulled = false; animal.add(m); }
    return { side, anchor, L1, L2, pawL, fore, off, hipZ: hip[2], lat: Math.abs(hip[0]) + (fore ? 0.0012 : 0.0014), up, lo, paw, foot: V() };
  });
  // tail: a tapered tube rebuilt along the route every frame
  const NT = 14, NS = 8, tg = new THREE.BufferGeometry(), TP = new Float32Array((NT + 1) * NS * 3), TC = new Float32Array((NT + 1) * NS * 3), TR = new Float32Array((NT + 1) * NS * 3), TI = [];
  for (let k = 0; k <= NT; k++) for (let j = 0; j < NS; j++) { const i = k * NS + j, c = mix3(COL.tailT, COL.tailB, 0.5 - 0.5 * Math.cos(j / NS * TAU)); TC.set(c, i * 3); TR.set([Math.cos(j / NS * TAU) * 0.001, Math.sin(j / NS * TAU) * 0.001, -k / NT * TAIL_L], i * 3); }
  for (let k = 0; k < NT; k++) for (let j = 0; j < NS; j++) { const a = k * NS + j, b = k * NS + (j + 1) % NS, c = a + NS, d = b + NS; TI.push(a, c, b, b, c, d); }
  tg.setAttribute('position', new THREE.BufferAttribute(TP, 3)); tg.setAttribute('color', new THREE.BufferAttribute(TC, 3)); tg.setAttribute('aRest', new THREE.BufferAttribute(TR, 3)); tg.setIndex(TI);
  const tail = new THREE.Mesh(tg, fur); tail.frustumCulled = false; tail.castShadow = true; animal.add(tail);
  // contact shadow under the body (the registry's decals float 4.5 cm up: far above a shrew)
  const shMat = shadowMat(ctx, 0.5), shadow = gridMesh(5, 5, shMat); shadow.name = 'contactShadow'; root.add(shadow);
  const body = new THREE.Object3D(); body.name = 'shrew.body.anchor'; root.add(body);

  const ph = R() * 10, Ls = 0.05, beta = 0.5, LIFT = 0.0045;
  const wq = new THREE.Quaternion(), tq = new THREE.Quaternion(), lq = new THREE.Quaternion(), xq = new THREE.Quaternion();
  const scan = (t, per, amp, sd) => { const k = Math.floor(t / per), f = t / per - k; return amp * lerp(hash1(k, sd) * 2 - 1, hash1(k + 1, sd) * 2 - 1, smooth((f - 0.55) / 0.4)); };
  function pose(t) {
    const S0 = segAt(t), rt = S0.route, s = S0.f(t), sp = (S0.f(t + 0.01) - S0.f(t - 0.01)) / 0.02, mode = S0.mode;
    let vis = true;
    if (rt.sM != null && rt.dir === 'in') vis = s - LEN_ALL < rt.sM + 0.01;
    if (rt.sM != null && rt.dir === 'out') vis = s > rt.sM - 0.03;
    if (mode === 'hidden') vis = false;
    animal.visible = vis;
    const moving = Math.abs(sp) > 0.03, gph = s / Ls, runK = smooth(Math.abs(sp) / 0.15);
    // head life: sniff = look about and down, nose bobbing; peek = slow scans with holds, nose up; run = steady
    let yaw = 0, pitch = 0, twitch = 0;
    const env = smooth(Math.sin(t * 2.3 + ph) * 2 + 0.6);
    if (mode === 'sniff') { yaw = scan(t + ph, 1.1, 0.45, 3); pitch = 0.12 + 0.14 * Math.sin(t * 1.3 + ph) + 0.05 * Math.sin(t * 13) * env; twitch = env; }
    else if (mode === 'peek') { yaw = scan(t + ph, 0.95, 0.6, 5) * smooth((t - S0.t0 - 0.6) / 0.4); pitch = -0.22 + 0.06 * Math.sin(t * 1.7 + ph) + 0.03 * Math.sin(t * 14) * env; twitch = 1; }
    else if (mode === 'enter' || mode === 'withdraw') { pitch = 0.08; twitch = 0.5; }
    else { pitch = 0.03 * Math.sin(gph * TAU * 2); twitch = 0.35 + 0.65 * (1 - runK); yaw = (1 - runK) * scan(t + ph, 0.8, 0.25, 7); }
    const idle = 1 - runK;
    // bones along the route
    wq.identity();
    let spineF = null;
    for (let i = 0; i < BONES.length; i++) {
      const [name, z, y] = BONES[i], b = bn[i], F = rt.frame(s - (TIP - z));
      if (name === 'spine') spineF = F;
      basisQ(F.T, F.U, tq);
      if (i === 0) {
        const bob = moving ? 0.0006 * (0.5 + 0.5 * Math.cos(gph * TAU * 2)) * runK : 0.00025 * Math.sin(t * 5.1 + ph) * idle;
        b.position.copy(F.p).addScaledVector(F.U, y + bob);
        lq.copy(tq);
        lq.multiply(xq.setFromEuler(_e.set(0, 0, 0.05 * Math.sin(t * 0.9 + ph) * idle + (moving ? 0.03 * Math.sin(gph * TAU) : 0), 'YXZ')));   // weight shifts
      } else lq.copy(wq).invert().multiply(tq);
      if (name === 'chest') lq.multiply(xq.setFromEuler(_e.set(0, yaw * 0.25, 0, 'YXZ')));
      if (name === 'head') lq.multiply(xq.setFromEuler(_e.set(pitch, yaw * 0.75, 0.06 * yaw, 'YXZ')));
      if (name === 'snout') lq.multiply(xq.setFromEuler(_e.set(0.1 * twitch * Math.sin(t * 21 + ph) * Math.sin(t * 3.7) + 0.05 * pitch, 0.08 * twitch * Math.sin(t * 17.3 + 1.1), 0, 'YXZ')));
      b.quaternion.copy(lq);
      wq.multiply(lq);
    }
    rg.root.updateMatrixWorld(true);
    for (const [piv, sd] of whisk) piv.rotation.set(0, sd * (0.18 * twitch * Math.sin(t * 26 + sd) - 0.05), 0);
    // legs
    const feet = [];
    for (const L of legs) {
      const sh = s - (TIP - L.hipZ), f = (((gph + L.off) % 1) + 1) % 1;
      let dd, h = 0;
      const Sst = Ls * beta;
      if (f < beta) dd = Sst * (0.5 - f / beta);
      else {
        const u = (f - beta) / (1 - beta), m = -Sst * (1 - beta) / beta, u2 = u * u, u3 = u2 * u;
        dd = (2 * u3 - 3 * u2 + 1) * (-0.5 * Sst) + (u3 - 2 * u2 + u) * m + (3 * u2 - 2 * u3) * (0.5 * Sst) + (u3 - u2) * m;
        h = LIFT * Math.sin(Math.PI * u) * runK;
      }
      const F = rt.frame(sh + dd + (L.fore ? 0.001 : -0.001));
      const P = L.foot.copy(F.p).addScaledVector(F.L, L.side * L.lat).addScaledVector(F.U, h);
      // loco QA contacts (Q9): a paw is reported at its height only while it stays in stance over the probe's +-1/60 s
      // window (margin = speed/60/stride cycles); the others are reported 1 m up (x/z true, same index every sample). A fast
      // shrew gait (10 Hz at 0.5 m/s) otherwise read as a slide whenever the 0.1 s sampling locked onto a lift-off, and a
      // swinging paw in the tunnel (below the terrain) was taken for the planted one.
      const mC = Math.abs(sp) / 60 / Ls;                     // gait cycles per 1/60 s: the probe's +-h window
      feet.push([[P.x, f >= mC && f < beta - mC ? P.y : P.y + 1, P.z]]);
      const Hp = L.anchor.getWorldPosition(_w), A = P.clone().addScaledVector(F.U, 0.0016);
      let dv = A.clone().sub(Hp), dl = dv.length(); const dmax = (L.L1 + L.L2) * 0.995, dmin = Math.abs(L.L1 - L.L2) + 0.0008;
      if (dl > dmax) { A.copy(Hp).addScaledVector(dv.normalize(), dmax); dl = dmax; dv = A.clone().sub(Hp); } else if (dl < dmin) { A.copy(Hp).addScaledVector(dv.normalize(), dmin); dl = dmin; dv = A.clone().sub(Hp); }
      const dn = dv.clone().normalize(), a1 = (L.L1 * L.L1 - L.L2 * L.L2 + dl * dl) / (2 * dl), hh = Math.sqrt(Math.max(0, L.L1 * L.L1 - a1 * a1));
      const bend = F.T.clone().multiplyScalar(L.fore ? -1 : 1).addScaledVector(dn, -F.T.dot(dn) * (L.fore ? -1 : 1)).normalize();
      const Kn = Hp.clone().addScaledVector(dn, a1).addScaledVector(bend, hh);
      seg(L.up, Hp, Kn, L.fore ? 0.0019 : 0.0022);
      seg(L.lo, Kn, A, 0.0013);
      L.paw.position.copy(P).addScaledVector(F.T, L.pawL * 0.25).addScaledVector(F.U, 0.0008);
      basisQ(F.T, F.U, L.paw.quaternion); L.paw.scale.set(0.0017, 0.0009, L.pawL * 0.55);
    }
    // tail: along the route behind the rump, drooping to the tip, swaying (twitchy while the rump squeezes in)
    const sq = mode === 'enter' && s > (rt.sM ?? 1e9) ? 1 : 0, amp = moving ? 0.0035 : 0.0025 + 0.004 * sq, w = moving ? 9 : sq ? 11 : 2.2;
    for (let k = 0; k <= NT; k++) {
      const u = k / NT, F = rt.frame(s - (TIP - TAIL0) - TAIL_L * u), yy = lerp(0.0126, 0.0032, Math.pow(u, 0.75)), sw = amp * Math.sin(w * t + ph - u * 2.6) * u;
      const c = F.p.clone().addScaledVector(F.U, yy).addScaledVector(F.L, sw), r = lerp(0.00145, 0.0006, u);
      for (let j = 0; j < NS; j++) { const a = j / NS * TAU, q = c.clone().addScaledVector(F.U, Math.cos(a) * r).addScaledVector(F.L, Math.sin(a) * r), i = (k * NS + j) * 3; TP[i] = q.x; TP[i + 1] = q.y; TP[i + 2] = q.z; }
    }
    tg.attributes.position.needsUpdate = true; tg.computeVertexNormals();
    // contact shadow: follows the body on the ground, fades as the body goes into the tunnel
    const Fs = spineF, into = rt.sM == null ? 0 : rt.dir === 'in' ? smooth((s - (TIP + 0.002) - rt.sM) / 0.03) : smooth((rt.sM - (s - TIP - 0.002)) / 0.03);
    shMat.opacity = vis ? 0.5 * (1 - into) : 0;
    const SP = shadow.geometry.attributes.position.array;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      const lx = (i / 4 - 0.5) * 0.05, lz = (j / 4 - 0.5) * 0.11, x = Fs.p.x + Fs.L.x * lx + Fs.T.x * lz, z = Fs.p.z + Fs.L.z * lx + Fs.T.z * lz, k = (j * 5 + i) * 3;
      SP[k] = x; SP[k + 1] = floorY(x, z) + 0.0012; SP[k + 2] = z;
    }
    shadow.geometry.attributes.position.needsUpdate = true;
    wMat.opacity = 0.6 * (1 - into);
    const cp = Fs.p.clone().addScaledVector(Fs.U, 0.015); body.position.copy(cp);
    return { x: Fs.p.x, z: Fs.p.z, yaw: Math.atan2(Fs.T.x, Fs.T.z), feet };
  }
  pose(0);
  const radius = B ? Math.max(0.25, B.radius + 0.05) : 0.15;
  return {
    root, radius, height: 0.05, snapped: true, contact: false, timing,
    update: (t) => { pose(t); },
    anchors: { body },
    loco: { kind, walkers: (t) => { const w = pose(t); return animal.visible ? [w] : []; } },
  };
}

export async function build(kind, item, ctx) {
  if (kind === 'creature.burrow') {
    const at = item.at || [0, 0], B = makeBurrow(ctx, at, +(item.heading ?? 0), (item.seed ?? 3) * 131 + 17);
    const root = new THREE.Group(); root.name = kind; root.add(B.group);
    return { root, radius: B.radius + 0.05, height: 0.06, snapped: true, contact: false, anchors: {} };
  }
  return buildShrew(kind, item, ctx);
}
