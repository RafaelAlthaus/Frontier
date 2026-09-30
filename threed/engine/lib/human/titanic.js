// titanic.js — RMS Titanic, North Atlantic, 14 April 1912, about 23:30 ship's time (Frontier 3D intro, shot i_titanic).
// Olympic-class general arrangement, metres, built in the ship's own frame: the stem at the origin on the waterline,
// +Z forward, +X to PORT, Y up; s = metres aft of the stem (z = -s). 269 m x 28.2 m, draught 10.5 m.
//   hull: black shell lofted from a waterline plan and a deck plan (bow flare, counter stern), in-and-out plating with
//         rivets (normal map), red antifouling boot-top, the yellow sheer line at the top of the black, well-deck notches
//   decks: forecastle and poop (B level), well decks (C), bridge-deck shell to A deck, white A-deck promenade, boat deck
//   superstructure: bridge + wings with the red/green sidelights, officers' quarters, two staircase domes, deckhouses,
//         four raked buff funnels with black tops (steam pipes, guys), two raked masts (crow's nest, masthead lights,
//         stays, the Marconi aerial), cowl ventilators, well-deck cranes, capstans, anchors in their hawse pipes
//   boats: 16 wooden lifeboats in Welin davits, 8 a side in groups of 4; the emergency cutters (1, 2) swung out
//   lights: ~1500 portholes/windows (seeded lit/unlit), deck lamps as a cheap uniform-array light (LAMPS, no shadows)
//         injected into every ship material, the Cinzel name in gold relief on both bows
//   sea: bow wave, hull wash and stern wake as foam ribbons lit by the lamps; faint smoke from funnels 1-3
//   people: THE WITNESS at the port rail, an officer on the port bridge wing, two gentlemen in overcoats and bowlers
// Everything is a pure function of time (seeded). update(clock, t, e, s) places the ship from s.titanic {x, z, heading}.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, patchMaterial, FOG_GLSL } from '../shared/env.js';
import * as TX from './textures.js';
import { rng, clamp, lerp, smooth } from '../shared/util.js';
import { loadFont, text3dGeometry } from '../shared/text3d.js';
import { witness, germanOfficer, POSES } from './rig.js';
import { splitAt, sectionMatrix } from './sinking.js';

const LOA = 269, HB = 14.1, VS = 11.3;
export const DAVIT_S = [66, 76, 86, 96, 152, 162, 172, 182];      // lifeboat stations, metres aft of the stem (fore to aft, both sides)
export const TI_HB = HB;
const S_FC = 39, S_SUP = 57, S_AF = 58.5, S_BR = 60, S_AEND = 207, S_SUPEND = 222, S_POOP = 237;
export const FUN = [82, 108, 134, 160];
const RAKE = Math.tan(5 * Math.PI / 180);
const FUN_TOP = 42.8, FRX = 2.9, FRZ = 3.75;

const sheer = (s) => (s < 134 ? 2.6 * (1 - s / 134) ** 2 : 1.2 * ((s - 134) / 135) ** 2);
export const deckB = (s) => 12.1 + sheer(s);           // forecastle, bridge deck, poop (B level)
export const deckC = (s) => deckB(s) - 2.9;            // well decks
export const deckA = (s) => deckB(s) + 3.0;            // promenade deck
export const deckBoat = (s) => deckB(s) + 6.0;         // boat deck
const stepAt = (s, a, w = 0.5) => smooth((s - a) / w + 0.5);
// top of the black shell: bulwark tops at the ends and wells, the bridge-deck shell (to A deck) amidships
function hSide(s) {
  let h = deckB(s) + 1.2;
  h = lerp(h, deckC(s) + 1.2, stepAt(s, S_FC));
  h = lerp(h, deckA(s), stepAt(s, S_SUP));
  h = lerp(h, deckC(s) + 1.2, stepAt(s, S_SUPEND));
  h = lerp(h, deckB(s) + 1.2, stepAt(s, S_POOP));
  return h;
}
function planDeck(s) {
  if (s <= 0) return 0;
  if (s < 72) return HB * (1 - Math.pow(1 - s / 72, 2.4));
  if (s < 196) return HB;
  const u = Math.min(1, (s - 196) / (LOA - 196));
  return HB * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.2)));
}
function planWL(s) {
  if (s <= 0) return 0;
  if (s < 92) return HB * (1 - Math.pow(1 - s / 92, 2.0));
  if (s < 188) return HB;
  const u = (s - 188) / (262 - 188);
  return u >= 1 ? 0 : HB * Math.pow(1 - u * u, 0.7);
}
export function halfW(s, y) {
  const wl = planWL(s), dk = planDeck(s);
  if (y <= 0) return wl * (1 - 0.25 * Math.pow(clamp(-y / 10), 2));
  return lerp(wl, dk, Math.pow(clamp(y / 15), 1.25));
}
const yBot = (s) => (s < 250 ? -2.5 : lerp(-2.5, 5.5, smooth((s - 250) / 19)));
function hullNormal(s, y, sign, out = new THREE.Vector3()) {
  const e = 0.05, s0 = Math.max(0, s - e);
  const fs = (halfW(s + e, y) - halfW(s0, y)) / (s + e - s0);
  const fy = (halfW(s, y + e) - halfW(s, y - e)) / (2 * e);
  return out.set(sign, -fy, fs).normalize();
}
const hullPt = (s, y, sign, off = 0, out = new THREE.Vector3()) => {
  const n = hullNormal(s, y, sign);
  return out.set(sign * halfW(s, y), y, -s).addScaledVector(n, off);
};
const col = (hex) => new THREE.Color(hex);

// ── the lamps: a uniform array of point lights (no shadows) evaluated in every ship material ─────────────────────
const NL = 40;
export const LAMPU = {
  uLampP: { value: Array.from({ length: NL }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uLampC: { value: Array.from({ length: NL }, () => new THREE.Vector3()) },
};
const LAMP_PARS = /* glsl */`uniform vec4 uLampP[${NL}]; uniform vec3 uLampC[${NL}];
vec3 shipLamps(vec3 P, vec3 N, vec3 V, float shin, out vec3 spc) {
  vec3 acc = vec3(0.0); spc = vec3(0.0);
  for (int i = 0; i < ${NL}; i++) {
    vec4 lp = uLampP[i];
    if (lp.w <= 0.0) continue;
    vec3 L = lp.xyz - P; float d2 = dot(L, L);
    if (d2 > lp.w * lp.w) continue;
    float d = sqrt(d2); L /= d;
    float att = (1.0 - smoothstep(lp.w * 0.3, lp.w, d)) / (d2 + 0.6);
    float ndl = dot(N, L);
    acc += uLampC[i] * max((ndl + 0.2) / 1.2, 0.0) * att;
    if (shin > 0.0) spc += uLampC[i] * pow(max(dot(N, normalize(L + V)), 0.0), shin) * att * step(0.0, ndl) * (shin + 8.0) / 25.0;
  }
  return acc;
}
`;
function injectLamps(sh, spec, shin) {
  sh.uniforms.uLampP = LAMPU.uLampP; sh.uniforms.uLampC = LAMPU.uLampC;
  sh.uniforms.uLampSpec = { value: spec }; sh.uniforms.uLampShin = { value: shin };
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vShipW;')
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      { vec4 sw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        sw = instanceMatrix * sw;
        #endif
        vShipW = (modelMatrix * sw).xyz; }`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vShipW; uniform float uLampSpec; uniform float uLampShin;\n' + LAMP_PARS)
    .replace('#include <opaque_fragment>', `
      { vec3 wN = inverseTransformDirection(normal, viewMatrix);
        vec3 sp; vec3 li = shipLamps(vShipW, wN, normalize(cameraPosition - vShipW), uLampShin, sp);
        outgoingLight += diffuseColor.rgb * li + sp * uLampSpec; }
      #include <opaque_fragment>`);
}
function shipMat(o = {}, spec = 0.15, shin = 24) {
  const m = new THREE.MeshStandardMaterial(o);
  m.userData.progKey = 'shiplamp';
  return patchMaterial(m, (sh) => injectLamps(sh, spec, shin));
}
function addLamps(m, spec = 0.15, shin = 16) {              // an already fog-patched material (the figures)
  const prev = m.onBeforeCompile, key = (m.customProgramCacheKey ? m.customProgramCacheKey() : '') + '|shiplamp';
  m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); injectLamps(sh, spec, shin); };
  m.customProgramCacheKey = () => key; m.needsUpdate = true;
}
function glowMat(o = {}) { return patchMaterial(new THREE.MeshBasicMaterial(o)); }

// ── textures ────────────────────────────────────────────────────────────────────────────────────────────────────
// the shell: one 9.15 m plate length x 4 strakes of 1.83 m; in-and-out strakes, butts staggered, rivet rows
function platingTex() {
  const N = 1024, UM = 9.15, VM = 7.32, ppu = N / UM, ppv = N / VM;
  const h = new Float32Array(N * N), alb = new Uint8Array(N * N * 4);
  const R = rng(1912), tone = Array.from({ length: 16 }, () => 0.86 + R() * 0.28);
  const riv = (d, r) => (d < r ? Math.sqrt(1 - (d * d) / (r * r)) : 0);
  for (let y = 0; y < N; y++) {
    const vm = (y + 0.5) / ppv, k = Math.floor(vm / 1.83), inS = vm - k * 1.83, outer = k % 2 === 0;
    const edge = Math.min(inS, 1.83 - inS);
    for (let x = 0; x < N; x++) {
      const um = (x + 0.5) / ppu, inU = (((um + (k % 2) * 4.575) % UM) + UM) % UM, be = Math.min(inU, UM - inU);
      let z = outer ? 0.02 * smooth(edge / 0.018) : 0;
      if (be < 0.01) z -= 0.004;
      // rivets: two rows along each lap, two columns at each butt, pitch 85 mm, heads 12 mm
      let r = 0;
      for (const row of [0.045, 0.115]) {
        for (const vv of [inS - row, 1.83 - row - inS]) {
          const du = ((um % 0.085) + 0.085) % 0.085 - 0.0425;
          r = Math.max(r, riv(Math.hypot(du, vv), 0.012));
        }
      }
      for (const cc of [0.04, 0.1]) for (const uu of [inU - cc, UM - cc - inU]) {
        const dv = ((vm % 0.085) + 0.085) % 0.085 - 0.0425;
        r = Math.max(r, riv(Math.hypot(uu, dv), 0.012));
      }
      z += r * 0.009;
      h[y * N + x] = z;
      const plate = Math.floor((um + (k % 2) * 4.575) / UM) & 1;
      const t = tone[(k * 2 + plate) % 16] * (1 - 0.35 * smooth(1 - edge / 0.05) * 0.2) * (1 + r * 0.25);
      const i4 = (y * N + x) * 4; const v = clamp(t * 205, 0, 255);
      alb[i4] = v; alb[i4 + 1] = v; alb[i4 + 2] = v; alb[i4 + 3] = 255;
    }
  }
  const nrm = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = (h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)]) * ppu / 2;
    const hy = (h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x]) * ppv / 2;
    const l = Math.hypot(hx, hy, 1), i4 = (y * N + x) * 4;
    nrm[i4] = (-hx / l * 0.5 + 0.5) * 255; nrm[i4 + 1] = (-hy / l * 0.5 + 0.5) * 255; nrm[i4 + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[i4 + 3] = 255;
  }
  const mk = (d, srgb) => { const t = new THREE.DataTexture(d, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(1 / UM, 1 / VM); t.needsUpdate = true; return t; };
  return { map: mk(alb, true), normalMap: mk(nrm, false) };
}
// the grand staircase dome: wrought-iron ribs over lit glass
function domeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  const g = x.createRadialGradient(256, 256, 20, 256, 256, 360); g.addColorStop(0, '#FFE2A8'); g.addColorStop(1, '#C88A44');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  x.strokeStyle = '#2A2016'; x.lineWidth = 7;
  for (let i = 0; i <= 16; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, 512); x.stroke(); }
  x.lineWidth = 5; for (let j = 0; j <= 8; j++) { x.beginPath(); x.moveTo(0, j * 64); x.lineTo(512, j * 64); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// a warm studio-ish night environment for the metals (gold name, brass): dark sky, the ship's glow as a low band
function warmEnv(renderer) {
  const sc = new THREE.Scene();
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vD; void main(){ vec3 d = normalize(vD);
      vec3 c = mix(vec3(0.006, 0.009, 0.02), vec3(0.001), smoothstep(0.05, -0.3, d.y));
      c += vec3(1.0, 0.6, 0.28) * 0.55 * exp(-pow((d.y - 0.03) / 0.07, 2.0));
      c += vec3(1.0, 0.72, 0.42) * 3.0 * pow(max(dot(d, normalize(vec3(0.3, 0.55, 0.78))), 0.0), 40.0);
      c += vec3(0.7, 0.8, 1.0) * 0.8 * pow(max(dot(d, normalize(vec3(-0.6, 0.7, -0.2))), 0.0), 16.0);
      gl_FragColor = vec4(c, 1.0); }` });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), m));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(sc, 0, 0.1, 100);
  pm.dispose();
  return rt.texture;
}

// the hull's own environment: the night sky and its reflection in the flat sea, the haze glowing at the horizon
function coolEnv(renderer) {
  const sc = new THREE.Scene();
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vD; void main(){ vec3 d = normalize(vD); float y = abs(d.y);
      vec3 c = vec3(0.0035, 0.0055, 0.011) * (0.7 + 0.5 * smoothstep(0.0, 0.9, y)) * (d.y < 0.0 ? 0.6 : 1.0);
      c += vec3(0.045, 0.06, 0.085) * exp(-pow(y / 0.09, 2.0));
      c += vec3(0.12, 0.075, 0.04) * exp(-pow(y / 0.03, 2.0)) * smoothstep(0.2, 0.9, -d.z);
      gl_FragColor = vec4(c, 1.0); }` });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), m));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(sc, 0, 0.1, 100);
  pm.dispose();
  return rt.texture;
}
// window glass as seen from outside at night: frame + glazing bars, brighter under the ceiling lamp
function paneTex(round) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.55, '#E8E0D0'); g.addColorStop(1, '#9A8E80');
  x.fillStyle = g;
  if (round) {
    x.fillStyle = '#000'; x.fillRect(0, 0, 128, 128);
    const r = x.createRadialGradient(56, 50, 4, 64, 64, 56); r.addColorStop(0, '#FFFFFF'); r.addColorStop(0.7, '#E6DDCB'); r.addColorStop(1, '#8C8070');
    x.fillStyle = r; x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.fill();
  } else {
    x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#0A0806'; x.fillRect(0, 0, 128, 9); x.fillRect(0, 119, 128, 9); x.fillRect(0, 0, 9, 128); x.fillRect(119, 0, 9, 128);
    x.fillRect(60, 0, 8, 128); x.fillRect(0, 40, 128, 6); x.fillRect(0, 80, 128, 6);
    x.fillStyle = 'rgba(40,24,10,0.35)'; x.fillRect(9, 9, 18, 110); x.fillRect(101, 9, 18, 110);   // curtains at the sides
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ── geometry helpers ────────────────────────────────────────────────────────────────────────────────────────────
function prep(g) {
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
function box(w, h, d, x, y, z, ry = 0, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(x, y, z); return g;
}
function cylBetween(a, b, r0, r1 = r0, seg = 10, open = false) {
  const len = a.distanceTo(b); const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  const m = a.clone().add(b).multiplyScalar(0.5); g.translate(m.x, m.y, m.z); return g;
}
function wire(a, b, r = 0.03, sag = 0, seg = 10) {
  if (sag === 0) return cylBetween(a, b, r, r, 4, true);
  const pts = []; for (let i = 0; i <= seg; i++) { const t = i / seg; pts.push(a.clone().lerp(b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0))); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg * 2, r, 4, false);
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// UVs in metres by box projection (ship frame): walls read (s, y), fronts (x, y), roofs (x, s)
function boxUV(g) {
  const P = g.attributes.position, N = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i));
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (nx >= ny && nx >= nz) uv.setXY(i, -z, y); else if (nz >= ny) uv.setXY(i, x, y); else uv.setXY(i, x, -z);
  }
  uv.needsUpdate = true;
}

// a quad strip along s: fn(s) -> [p0, p1] (two Vector3), uvFn(s, k) -> [u, v]
function strip(ss, fn, flip = false, uvFn = null) {
  const pos = [], uv = [], idx = [];
  ss.forEach((s, i) => { const [a, b] = fn(s); pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const ua = uvFn ? uvFn(s, 0, a) : [s, 0], ub = uvFn ? uvFn(s, 1, b) : [s, 1]; uv.push(...ua, ...ub); });
  for (let i = 0; i < ss.length - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const range = (a, b, d) => { const r = []; for (let s = a; s < b - 1e-6; s += d) r.push(s); r.push(b); return r; };

// ── the hull ────────────────────────────────────────────────────────────────────────────────────────────────────
function stations() {
  const st = [];
  for (let s = 0; s < 20; s += 0.35) st.push(s);
  for (let s = 20; s < 80; s += 0.8) st.push(s);
  for (let s = 80; s < 190; s += 2.0) st.push(s);
  for (let s = 190; s < LOA; s += 0.8) st.push(s);
  for (const b of [S_FC, S_SUP, S_SUPEND, S_POOP]) for (const d of [-0.4, -0.25, -0.12, 0, 0.12, 0.25, 0.4]) st.push(b + d);
  st.push(LOA);
  st.sort((a, b) => a - b);
  return st.filter((v, i) => i === 0 || v - st[i - 1] > 0.02);
}
function hullSide(sign) {
  const st = stations(), C = { red: col('#6E2016'), black: col('#0E0E10'), gold: col('#C8962A') };
  const pos = [], nrm = [], uv = [], cl = [], idx = [], n = new THREE.Vector3();
  let R = 0;
  for (const s of st) {
    const top = hSide(s), bot = yBot(s), boot = Math.max(bot, 0.28);
    const rows = [];
    for (let k = 0; k < 4; k++) rows.push([lerp(bot, boot, k / 3), C.red]);
    for (let k = 0; k < 22; k++) rows.push([lerp(boot, top - 0.3, k / 21), C.black]);
    rows.push([top - 0.3, C.gold], [top - 0.07, C.gold], [top - 0.07, C.black], [top, C.black]);
    R = rows.length;
    for (const [y, c] of rows) {
      pos.push(sign * halfW(s, y), y, -s);
      hullNormal(s, y, sign, n); nrm.push(n.x, n.y, n.z);
      uv.push(s, y); cl.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < st.length - 1; i++) for (let k = 0; k < R - 1; k++) {
    const a = i * R + k, b = a + 1, c = a + R, d = c + 1;
    if (sign > 0) idx.push(a, c, d, a, d, b); else idx.push(a, d, c, a, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
  g.setIndex(idx);
  return g;
}

// ── the lifeboat (H&W 30 ft, double-ended), in its own frame: keel at y 0, bow +Z ─────────────────────────────────
export function boatGeos(Lb = 9.15, Bb = 2.75, Db = 1.15) {
  const NU = 30, NV = 9;
  const wg = (u) => Bb / 2 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * u - 1), 2.4)), 0.62);
  const yg = (u) => Db + 0.3 * Math.pow(Math.abs(2 * u - 1), 2.2);
  const yk = (u) => 0.12 * Math.pow(Math.abs(2 * u - 1), 3);
  const grid = (NI, NJ, f, flip) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= NI; i++) for (let j = 0; j <= NJ; j++) { const p = f(i / NI, j / NJ); pos.push(p[0], p[1], p[2]); uv.push(i / NI * Lb, j / NJ * 3); }
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) {
      const a = i * (NJ + 1) + j, b = a + 1, c = a + NJ + 1, d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  const hull = grid(NU, NV * 2, (u, v) => {
    const w = wg(u), top = yg(u), kb = yk(u), vv = v * 2 - 1, a = Math.abs(vv) * Math.PI / 2;
    return [Math.sign(vv) * w * Math.sin(a), kb + (top - kb) * (1 - Math.cos(a)), (u - 0.5) * Lb];
  }, false);
  const cover = grid(NU, 12, (u, v) => {
    const w = wg(u), ww = v * 2 - 1, k = Math.sqrt(w / (Bb / 2));
    return [ww * w * 1.03, yg(u) + 0.02 + 0.34 * (1 - ww * ww) * k - 0.05 * Math.abs(Math.sin(u * Math.PI * 9)) * (1 - ww * ww), (u - 0.5) * Lb];
  }, true);
  const gun = [];
  for (const sd of [1, -1]) {
    const pts = []; for (let i = 0; i <= 24; i++) { const u = 0.015 + 0.97 * i / 24; pts.push(V3(sd * wg(u) * 1.04, yg(u) - 0.02, (u - 0.5) * Lb)); }
    gun.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.065, 5, false));
  }
  return { hull, cover, gun: mergeGeometries(gun.map(prep)), Lb, Bb, top: yg(0.5) };
}

// ── cowl ventilator (pipe, elbow, bell mouth facing +Z) ────────────────────────────────────────────────────────
function cowl(h, r) {
  const hp = h - r * 2.6, R = r * 1.5;
  const pipe = new THREE.CylinderGeometry(r, r * 1.08, hp, 16, 1, true); pipe.translate(0, hp / 2, 0);
  const arc = []; for (let i = 0; i <= 8; i++) { const th = i / 8 * Math.PI / 2; arc.push(V3(0, hp + R * Math.sin(th), R - R * Math.cos(th))); }
  const elbow = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc), 12, r, 16, false);
  const prof = []; for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push(new THREE.Vector2(r * (1 + 0.8 * t * t), t * r * 1.1)); }
  const bell = new THREE.LatheGeometry(prof, 20); bell.rotateX(Math.PI / 2); bell.translate(0, hp + R, R);
  const inner = bell.clone();
  return { outer: [pipe, elbow, bell], inner };
}

// ── the build ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function buildTitanic({ scene, renderer, tex, breakS = null, funnels = 4, livery = 'white_star', length = LOA, name = 'TITANIC', cutaway = null }) {
  // E2 v2 variants: 1-4 funnels, a length (the hull scaled along its axis, beam and heights by the square root), a livery
  const FN = { 1: [124], 2: [98, 150], 3: [88, 121, 154], 4: FUN }[clamp(Math.round(+funnels || 4), 1, 4)];
  const kz = clamp((+length || LOA) / LOA, 0.3, 1.3), kxy = Math.sqrt(kz), cunard = livery === 'cunard';
  const t0 = performance.now();
  const root = new THREE.Group(); root.name = 'titanic'; scene.add(root);
  const R = rng(1415);
  const warm = warmEnv(renderer);
  const plate = platingTex();
  const deckT = TX.planks({ size: 1024, meters: 6, boardW: 0.15, tone: '#8C7456', tone2: '#A48A68', seed: 12 });
  for (const t of [deckT.map, deckT.normalMap, deckT.roughnessMap]) { t.repeat.set(1 / 6, 1 / 6); t.anisotropy = 8; }

  const M = {
    hull: shipMat({ vertexColors: true, map: plate.map, normalMap: plate.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.26, metalness: 0, envMap: coolEnv(renderer), envMapIntensity: 3.2 }, 0.9, 70),
    white: shipMat({ color: 0xE6E1D4, roughness: 0.58, normalMap: plate.normalMap, normalScale: new THREE.Vector2(0.7, 0.7) }, 0.14, 20),
    whiteIn: shipMat({ color: 0xD8D2C4, roughness: 0.7, side: THREE.BackSide }, 0.1, 12),
    deck: shipMat({ map: deckT.map, normalMap: deckT.normalMap, roughnessMap: deckT.roughnessMap, roughness: 1 }, 0.1, 12),
    buff: shipMat({ color: 0xC58A3A, roughness: 0.52, normalMap: plate.normalMap, normalScale: new THREE.Vector2(0.9, 0.9) }, 0.25, 22),
    funnel: cunard ? shipMat({ color: 0xB0301C, roughness: 0.5, normalMap: plate.normalMap, normalScale: new THREE.Vector2(0.9, 0.9) }, 0.25, 22) : null,
    black: shipMat({ color: 0x0B0B0C, roughness: 0.42, normalMap: plate.normalMap, normalScale: new THREE.Vector2(0.9, 0.9) }, 0.4, 40),
    teak: shipMat({ color: 0x5E3C22, roughness: 0.45 }, 0.35, 30),
    canvas: shipMat({ color: 0xB4AB97, roughness: 0.92 }, 0.04, 8),
    iron: shipMat({ color: 0x19191B, roughness: 0.5, metalness: 0.55, envMap: warm, envMapIntensity: 0.6 }, 0.5, 40),
    wire: shipMat({ color: 0x2C2925, roughness: 0.6 }, 0.25, 16),
    gold: shipMat({ color: 0xE0AE4C, roughness: 0.24, metalness: 1.0, envMap: warm, envMapIntensity: 2.2, emissive: 0x3A2206, emissiveIntensity: 0.35 }, 1.6, 70),
    brass: shipMat({ color: 0x8C6E3A, roughness: 0.45, metalness: 1.0, envMap: warm, envMapIntensity: 0.35 }, 0.6, 40),
    glass: shipMat({ color: 0x06070A, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.5 }, 1.2, 140),
    ventIn: shipMat({ color: 0x5A1810, roughness: 0.7, side: THREE.BackSide }, 0.05, 8),
    lit: glowMat({ color: 0xffffff }),
    litRect: glowMat({ color: 0xffffff, map: paneTex(false) }),
    litRound: glowMat({ color: 0xffffff, map: paneTex(true) }),
    dome: glowMat({ map: domeTex(), color: new THREE.Color(1.05, 0.82, 0.55) }),
    lamp: glowMat({ color: new THREE.Color(9.0, 5.6, 2.7) }),
  };
  M.lit.userData.base = 1;
  if (!M.funnel) M.funnel = M.buff;
  const G = {}; const add = (k, g) => { (G[k] ||= []).push(prep(g)); };

  // hull shell, both sides
  for (const sd of [1, -1]) { const m = new THREE.Mesh(hullSide(sd), M.hull); m.name = 'hull'; root.add(m); }
  // ── the underbody (E2 v2 round 5): the hull below the boot-top to the keel, three propellers, the rudder ──
  const keelY = (s) => (s < 16 ? -10.5 * (1 - Math.pow(1 - s / 16, 2)) : s > 236 ? lerp(-10.5, -4.4, smooth((s - 236) / 22)) : -10.5);
  M.anti = shipMat({ color: 0x5A1B13, roughness: 0.6, normalMap: plate.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), side: THREE.DoubleSide }, 0.15, 20);
  M.bronze = shipMat({ color: 0xA67C45, roughness: 0.32, metalness: 1.0, envMap: warm, envMapIntensity: 0.9 }, 0.5, 40);
  { const st = stations().filter((s) => s > 0.3 && s <= 258), RS = 16, pos = [], idx = [];
    st.forEach((s) => {
      const yk = keelY(s), top = Math.min(-2.2, yBot(s) + 0.4);
      for (let j = 0; j <= RS; j++) {
        const a = j / RS, side = a < 0.5 ? 1 : -1, u = a < 0.5 ? a * 2 : (1 - a) * 2;
        const y = lerp(top, yk, Math.pow(u, 0.65));
        const w = halfW(s, Math.max(y, -10)) * (1 - Math.pow(Math.max(0, (u - 0.74) / 0.26), 1.5));
        pos.push(side * w, y, -s);
      }
    });
    for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < RS; j++) { const a = i * (RS + 1) + j, b = a + 1, c = a + RS + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const um = new THREE.Mesh(g, M.anti); um.name = 'hull-under'; root.add(um); }
  const PROPS = [];
  for (const [x, sp, y, Rp, nb] of [[5.9, 256.5, -6.2, 3.5, 3], [-5.9, 256.5, -6.2, 3.5, 3], [0, 263.2, -6.6, 2.5, 4]]) {
    const g = new THREE.Group(); g.position.set(x, y, -sp); g.name = 'ti-prop'; root.add(g); PROPS.push([g, x === 0 ? 1 : Math.sign(x)]);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10).scale(1, 1, 1.7), M.bronze));
    for (let k = 0; k < nb; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8).scale(0.8, Rp / 2, 0.09).translate(0, Rp / 2 + 0.35, 0), M.bronze); const bg = new THREE.Group(); bg.rotation.z = k / nb * Math.PI * 2; b.rotation.y = 0.5; bg.add(b); g.add(bg); }
    if (x !== 0) root.add(new THREE.Mesh(cylBetween(V3(x, y, -sp + 0.8), V3(x * 0.7, y + 1.2, -sp + 24), 0.32, 0.5, 12), M.anti));
  }
  { const rg = new THREE.BoxGeometry(0.55, 14.5, 4.4); rg.translate(0, -2.8, -2.2); const rud = new THREE.Mesh(rg, M.anti); rud.position.set(0, 0, -264.6); rud.name = 'ti-rudder'; root.add(rud); }
  // ── the cutaway (E2 v2 round 5): one side sectioned away, the 15 watertight bulkheads, the compartments flooding ──
  let CUT = null;
  if (cutaway) {
    const nC = clamp(Math.round(+cutaway.compartments || 16), 4, 24);
    const BH = nC === 16 ? [14, 29, 44, 58, 71, 91, 111, 131, 151, 171, 190, 206, 218, 231, 250] : Array.from({ length: nC - 1 }, (_, i) => lerp(14, 250, i / (nC - 2)));
    const topOf = (sB) => deckC(sB) - 2.4;                                  // E deck: where the bulkheads ended
    M.bulk = shipMat({ color: 0x23272c, roughness: 0.8, side: THREE.DoubleSide }, 0.05, 8);
    M.flood = new THREE.MeshStandardMaterial({ color: 0x2a9fe0, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.58, emissive: 0x0d4a78, emissiveIntensity: 1, side: THREE.DoubleSide, depthWrite: false });
    M.spill = new THREE.MeshStandardMaterial({ color: 0x9fe0ec, roughness: 0.1, transparent: true, opacity: 0.55, emissive: 0x2a6f7a, emissiveIntensity: 1, side: THREE.DoubleSide, depthWrite: false });
    const cutG = new THREE.Group(); cutG.name = 'ti-cutaway'; root.add(cutG);
    for (const sB of BH) {                                                 // a plate across the hull from the keel to E deck
      const pts = [], yk = keelY(sB) + 0.05, yt = topOf(sB);
      for (let k = 0; k <= 12; k++) { const y = lerp(yk, yt, k / 12); pts.push([halfW(sB, Math.max(y, -10)) * 0.985, y]); }
      const shp = new THREE.Shape(); shp.moveTo(0, yk); pts.forEach(([x, y]) => shp.lineTo(x, y)); for (let k = pts.length - 1; k >= 0; k--) shp.lineTo(-pts[k][0], pts[k][1]);
      const bg = new THREE.ExtrudeGeometry(shp, { depth: 0.3, bevelEnabled: false }); bg.translate(0, 0, -0.15);
      const m = new THREE.Mesh(bg, M.bulk); m.position.z = -sB; m.name = 'ti-bulkhead'; cutG.add(m);
    }
    const ends = [2.5, ...BH, 262], comps = [];
    for (let i = 0; i < ends.length - 1; i++) {
      const s0 = ends[i] + 0.25, s1 = ends[i + 1] - 0.25, sm = (s0 + s1) / 2, yk = keelY(sm) + 0.1, yt = i < BH.length ? topOf(ends[i + 1]) : topOf(sm);
      const w = 2 * halfW(sm, -5) * 0.93, wg = new THREE.BoxGeometry(w, 1, s1 - s0).translate(0, 0.5, 0), wat = new THREE.Mesh(wg, M.flood);
      wat.position.set(0, yk, -sm); wat.name = 'ti-flood'; wat.frustumCulled = false; cutG.add(wat);
      wg.userData.top = Array.from({ length: wg.attributes.position.count }, (_, v) => wg.attributes.position.getY(v) > 0.5);
      const sp2 = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 1, 0.35).translate(0, -0.5, 0), M.spill); sp2.position.set(0, yt, -ends[i + 1] + 0.3); sp2.visible = false; sp2.name = 'ti-spill'; cutG.add(sp2);
      comps.push({ wat, spill: sp2, yk, yt, top: i < BH.length ? topOf(ends[i + 1]) : yt });
    }
    const keys = (Array.isArray(cutaway.flood) && cutaway.flood.length ? cutaway.flood : [{ t: 0, n: 0 }, { t: 6, n: 5 }]).map((k) => [+k.t || 0, clamp(+k.n || 0, 0, comps.length)]).sort((a, b) => a[0] - b[0]);
    const nAt = (t) => { if (t <= keys[0][0]) return keys[0][1]; for (let i = 0; i < keys.length - 1; i++) if (t <= keys[i + 1][0]) return lerp(keys[i][1], keys[i + 1][1], smooth((t - keys[i][0]) / Math.max(1e-3, keys[i + 1][0] - keys[i][0]))); return keys[keys.length - 1][1]; };
    const plane = new THREE.Plane(), keepPort = (cutaway.side ?? 'starboard') !== 'port';
    CUT = { comps, nAt, plane, keepPort, rise: cutaway.water_level_rise !== false };
    if (renderer) renderer.localClippingEnabled = true;
  }


  // ── decks (planked) ──
  const deckStrip = (s0, s1, yf, inset, ds = 0.5) => strip(range(s0, s1, ds), (s) => {
    const y = yf(s), w = Math.max(0, halfW(s, y) - inset); return [V3(w, y, -s), V3(-w, y, -s)];
  }, false, (s, k, p) => [s, p.x]);
  add('deck', deckStrip(0.3, S_FC + 0.15, deckB, 0.28, 0.35));
  add('deck', deckStrip(S_FC, S_SUP + 0.15, deckC, 0.28));
  add('deck', deckStrip(S_SUP - 0.1, S_AF + 0.2, deckA, 0.02));
  add('deck', deckStrip(S_AF, S_AEND, deckBoat, 0.02, 2));
  add('deck', deckStrip(S_AEND, S_SUPEND + 0.15, deckA, 0.02));
  add('deck', deckStrip(S_SUPEND, S_POOP + 0.15, deckC, 0.28));
  add('deck', deckStrip(S_POOP, LOA - 0.4, deckB, 0.28));
  // white inner bulwarks + teak caps where the deck is open to the side
  for (const [a, b, yf] of [[0.4, S_FC, deckB], [S_FC, S_SUP, deckC], [S_SUPEND, S_POOP, deckC], [S_POOP, LOA - 0.5, deckB]]) {
    for (const sd of [1, -1]) {
      const ss = range(a, b, 0.6);
      add('white', strip(ss, (s) => { const y0 = yf(s), y1 = hSide(s) - 0.06, w0 = halfW(s, y0) - 0.14, w1 = halfW(s, y1) - 0.14;
        return [V3(sd * w0, y0, -s), V3(sd * w1, y1, -s)]; }, sd > 0));
      add('teak', strip(ss, (s) => { const y = hSide(s) + 0.035, w = halfW(s, y); return [V3(sd * (w - 0.24), y, -s), V3(sd * (w + 0.03), y, -s)]; }, sd > 0));
    }
  }
  // bulkheads across the ship (white): forecastle break, bridge-deck front/after end, poop front, A-deck ends
  const across = (s, y0, y1, facing, hw) => { const w = hw ?? halfW(s, (y0 + y1) / 2) - 0.02; add('white', box(2 * w, y1 - y0, 0.25, 0, (y0 + y1) / 2, -s - facing * 0.12)); };
  across(S_FC, deckC(S_FC), deckB(S_FC), -1);
  across(S_SUP, deckC(S_SUP), deckA(S_SUP), 1);
  across(S_SUPEND, deckC(S_SUPEND), deckA(S_SUPEND), -1);
  across(S_POOP, deckC(S_POOP), deckB(S_POOP), 1);
  across(S_AF, deckA(S_AF), deckBoat(S_AF), 1);
  across(S_AEND, deckA(S_AEND), deckBoat(S_AEND), -1);
  // the white A-deck promenade walls (flush with the shell)
  for (const sd of [1, -1]) {
    const ss = range(S_AF, S_AEND, 1.0);
    add('white', strip(ss, (s) => [V3(sd * halfW(s, deckA(s)), deckA(s) - 0.02, -s), V3(sd * halfW(s, deckBoat(s)), deckBoat(s) + 0.05, -s)], sd < 0));
    // boat-deck edge fascia
    add('white', strip(ss, (s) => [V3(sd * (halfW(s, deckBoat(s)) + 0.02), deckBoat(s) - 0.12, -s), V3(sd * (halfW(s, deckBoat(s)) + 0.02), deckBoat(s) + 0.1, -s)], sd < 0));
  }

  // ── boat-deck houses ──
  const HOUSES = [[60.4, 63.8, 7.4, 2.7], [63.8, 87.5, 8.2, 2.7], [89, 102, 7.0, 2.85], [104, 113, 4.6, 2.6], [117, 124, 5.4, 2.6],
    [130, 139, 4.6, 2.6], [141, 152, 6.2, 2.85], [156, 165, 4.6, 2.6], [172, 200, 6.2, 2.7]];
  const houseAt = (s) => HOUSES.find(([a, b]) => s > a + 0.6 && s < b - 0.6);
  for (const [a, b, hw, h] of HOUSES) {
    const sm = (a + b) / 2, y = deckBoat(sm);
    add('white', box(2 * hw, h, b - a, 0, y + h / 2, -sm));
    add('white', box(2 * hw + 0.3, 0.14, b - a + 0.3, 0, y + h + 0.07, -sm));       // roof overhang
  }
  // the bridge: full-width front bulwark, wings over the side, sidelight screens
  { const s = S_BR, y = deckBoat(s);
    add('white', box(2 * 14.75, 1.3, 0.16, 0, y + 0.65, -s));
    add('teak', box(2 * 14.75, 0.08, 0.3, 0, y + 1.33, -s));
    for (const sd of [1, -1]) {
      add('white', box(0.7, 0.14, 2.2, sd * 14.45, y - 0.07, -s - 1.1));
      add('white', box(0.12, 1.3, 2.2, sd * 14.78, y + 0.65, -s - 1.1));
      add('white', box(0.1, 1.6, 1.1, sd * 14.95, y + 1.55, -s - 0.6));          // sidelight screen
    }
  }
  // domes over the grand staircases
  for (const [s, rx, rz, h] of [[95.5, 3.1, 4.1, 1.75], [146.5, 2.4, 3.1, 1.35]]) {
    const y = deckBoat(s) + (s < 100 ? 2.85 : 2.85);
    const g = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(rx, h, rz); g.translate(0, y + 0.45, -s);
    const dm = new THREE.Mesh(g, M.dome); root.add(dm);
    add('white', new THREE.CylinderGeometry(1, 1, 0.45, 40).scale(rx + 0.12, 1, rz + 0.12).translate(0, y + 0.225, -s));
  }

  // ── funnels ──
  for (let fi = 0; fi < FN.length; fi++) {
    const sf = FN[fi], y0 = deckBoat(sf) + 1.5, y1 = FUN_TOP, yb = y1 - 4.6, seg = 64;
    const zc = (y) => -sf - (y - y0) * RAKE;
    const ringGeo = (ys, radF) => {
      const pos = [], nrm = [], uv = [], idx = [];
      ys.forEach((y) => { const f = radF(y); for (let j = 0; j <= seg; j++) { const a = j / seg * Math.PI * 2;
        pos.push(FRX * f * Math.cos(a), y, zc(y) + FRZ * f * Math.sin(a)); const n = V3(Math.cos(a) / FRX, 0, Math.sin(a) / FRZ).normalize(); nrm.push(n.x, n.y, n.z); uv.push(j / seg * 21, y); } });
      for (let i = 0; i < ys.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g;
    };
    const bands = [y0 + (yb - y0) * 0.3, y0 + (yb - y0) * 0.55, y0 + (yb - y0) * 0.8];
    const bump = (y) => 1 + bands.reduce((a, b) => a + 0.022 * Math.exp(-(((y - b) / 0.12) ** 2)), 0);
    const ysB = []; for (let y = y0; y < yb; y += 0.25) ysB.push(y); ysB.push(yb);
    add('funnel', ringGeo(ysB, bump));
    if (cunard) for (const fb of [0.58, 0.7]) { const yy = y0 + (yb - y0) * fb; add('black', ringGeo([yy, yy + 0.55], () => 1.018)); }   // Cunard: thin black bands
    const ysK = []; for (let y = yb; y < y1; y += 0.25) ysK.push(y); ysK.push(y1 - 0.12, y1);
    add('black', ringGeo(ysK, (y) => 1 + 0.03 * smooth((y - (y1 - 0.5)) / 0.4)));
    const lid = new THREE.CircleGeometry(1, 48); lid.rotateX(-Math.PI / 2); lid.scale(FRX * 0.97, 1, FRZ * 0.97); lid.translate(0, y1 - 1.2, zc(y1 - 1.2));
    add('black', lid);
    add('funnel', box(FRX * 2 + 1.2, 1.6, FRZ * 2 + 1.2, 0, deckBoat(sf) + 2.1, -sf));          // casing plinth
    if (fi < 3) for (const [px, pr] of [[0.8, 0.2], [-0.75, 0.15], [0.1, 0.12]]) {
      const ya = y0, yz = y1 - (px > 0 ? 0.6 : 1.4), off = FRZ + 0.42 + pr;
      add('buff', cylBetween(V3(px, ya, zc(ya) + off), V3(px, yz, zc(yz) + off), pr, pr, 10));
      add('buff', cylBetween(V3(px, yz - 3.2, zc(yz - 3.2) + off), V3(px, yz - 2.4, zc(yz - 2.4) + off), pr * 1.8, pr * 1.2, 10));
    }
    // guys: four a side from a band at ~60 % to the deck edge
    const ya = y0 + (y1 - y0) * 0.6;
    for (const sd of [1, -1]) for (const [ang, ds] of [[55, -9.5], [20, -3.5], [-20, 3.5], [-55, 9.5]]) {
      const a = ang * Math.PI / 180, p = V3(sd * FRX * Math.cos(a), ya, zc(ya) + FRZ * Math.sin(a));
      const sd2 = sf + ds, q = V3(sd * (halfW(sd2, deckBoat(sd2)) - 0.25), deckBoat(sd2) + 0.3, -sd2);
      add('wire', wire(p, q, 0.028));
    }
  }

  // ── masts, stays, aerial ──
  const mast = (s, y0, y1, r0, r1) => { const zc = (y) => -s - (y - y0) * RAKE; add('buff', cylBetween(V3(0, y0, zc(y0)), V3(0, y1, zc(y1)), r0, r1, 14)); return zc; };
  const fzc = mast(40.5, deckC(40.5), 47, 0.42, 0.19), mzc = mast(212, deckA(212), 46, 0.4, 0.18);
  // crow's nest (E2 v2: an open drum with a floor, so a lookout stands in it with his chest above the rim)
  // (its own meshes, flagged hollow/noQA: a figure standing in it is not inside a solid)
  const nestG = new THREE.Group(); nestG.name = 'ti-crowsnest'; nestG.userData.noQA = true; nestG.userData.hollow = true; root.add(nestG);
  for (const [g, mk] of [[new THREE.CylinderGeometry(0.95, 0.9, 1.35, 20, 1, true).translate(0, 29.1, fzc(29.1)), 'white'], [new THREE.CylinderGeometry(0.9, 0.86, 1.33, 20, 1, true).translate(0, 29.1, fzc(29.1)), 'whiteIn'],
    [new THREE.CylinderGeometry(0.88, 0.88, 0.06, 20).translate(0, 28.72, fzc(28.72)), 'white'], [new THREE.CylinderGeometry(0.98, 0.98, 0.12, 20, 1, true).translate(0, 29.8, fzc(29.8)), 'black']]) nestG.add(new THREE.Mesh(g, M[mk]));
  const foreTop = V3(0, 46.5, fzc(46.5)), mainTop = V3(0, 45.5, mzc(45.5));
  add('wire', wire(foreTop, V3(0, hSide(0.6) + 0.1, -0.6), 0.04));                                     // forestay
  add('wire', wire(V3(0, 30, fzc(30)), V3(0, hSide(1.2), -1.2), 0.03));
  for (const sd of [1, -1]) {
    for (const ds of [0, 2, 4]) { const s = 41 + ds, y = deckC(s) + 1.2; add('wire', wire(V3(sd * 0.3, 28.3, fzc(28.3)), V3(sd * (halfW(s, y) - 0.2), y, -s), 0.03)); }
    for (const ds of [-2, 1, 4]) { const s = 214 + ds, y = deckA(s) + 0.2; add('wire', wire(V3(sd * 0.3, 36, mzc(36)), V3(sd * (halfW(s, y) - 0.3), y, -s), 0.03)); }
    add('wire', wire(V3(sd * 0.3, 44, fzc(44)), V3(sd * (HB - 0.4), deckBoat(64) + 0.3, -64), 0.03));
  }
  for (const [x0, x1] of [[-0.9, -0.9], [-0.3, -0.3], [0.3, 0.3], [0.9, 0.9]]) add('wire', wire(V3(x0, foreTop.y - 0.2, foreTop.z - 0.4), V3(x1, mainTop.y - 0.2, mainTop.z + 0.4), 0.022, 2.6, 24));
  for (const T of [foreTop, mainTop]) add('wire', box(2.2, 0.08, 0.08, 0, T.y - 0.2, T.z + (T === foreTop ? -0.4 : 0.4)));
  add('wire', wire(V3(0, 44.2, fzc(44.2) - 3), V3(1.2, deckBoat(84) + 2.8, -84), 0.02, 0.5, 12));        // lead-in to the Marconi room

  // ── lifeboats + Welin davits ──
  const BG = boatGeos();
  const boats = [];
  const PORT_S = DAVIT_S;
  for (const sd of [1, -1]) PORT_S.forEach((s, i) => boats.push({ s, sd, cutter: i === 0, out: i === 0 }));
  const bHull = new THREE.InstancedMesh(BG.hull, M.white, boats.length), bCov = new THREE.InstancedMesh(BG.cover, M.canvas, boats.length), bGun = new THREE.InstancedMesh(BG.gun, M.teak, boats.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  boats.forEach((b, i) => {
    const y = deckBoat(b.s), bx = b.sd * (b.out ? HB + 1.55 : 12.3), by = b.out ? y - 0.2 : y + 0.36, k = b.cutter ? 0.83 : 1;
    mtx.compose(V3(bx, by, -b.s), q.identity(), sc.set(b.cutter ? 0.92 : 1, 1, k));
    bHull.setMatrixAt(i, mtx); bCov.setMatrixAt(i, mtx); bGun.setMatrixAt(i, mtx);
    // davits at both ends
    for (const e of [-1, 1]) {
      const zs = -b.s + e * (BG.Lb * k / 2 - 0.3), base = b.sd * (HB - 0.35), head = bx;
      const P = [[base, 0], [base + b.sd * 0.03, 1.5], [base, 2.8], [base + (head - base) * 0.45, 3.85], [head + (base - head) * 0.08, 4.4], [head, 4.3]].map(([x, yy]) => V3(x, y + yy, zs));
      add('white', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P), 20, 0.1, 8, false));
      add('iron', box(0.12, 0.62, 0.5, base, y + 0.31, zs));
      add('wire', wire(V3(head, y + 4.2, zs), V3(bx, by + BG.top + 0.15, zs + (b.out ? 0 : -e * 0.1)), 0.018));
      add('iron', box(0.16, 0.34, 0.16, head, y + 3.95, zs));
      if (!b.out) add('iron', box(0.5, 0.36, 0.3, bx, y + 0.18, -b.s + e * 2.2));        // chocks
    }
  });
  bHull.name = 'ti-boats-hull'; bCov.name = 'ti-boats-cover'; bGun.name = 'ti-boats-gun';
  for (const m of [bHull, bCov, bGun]) root.add(m);
  for (const sd of [1, -1]) {
    const c = new THREE.Mesh(BG.hull, M.canvas); c.scale.set(0.85, 0.34, 0.9); c.position.set(sd * 5.6, deckBoat(76) + 2.84, -76); root.add(c);
    const cc = new THREE.Mesh(BG.cover, M.canvas); cc.scale.set(0.85, 0.3, 0.9); cc.position.copy(c.position); root.add(cc);
  }

  // ── boat-deck rail, well-deck and poop rails ──
  const rail = (s0, s1, yf, xf, sd, h = 1.1, pitch = 1.5) => {
    for (let s = s0; s <= s1; s += pitch) add('white', new THREE.CylinderGeometry(0.028, 0.03, h, 6).translate(sd * xf(s), yf(s) + h / 2, -s));
    const ss = range(s0, s1, 2);
    add('teak', strip(ss, (s) => [V3(sd * (xf(s) - 0.06), yf(s) + h, -s), V3(sd * (xf(s) + 0.06), yf(s) + h, -s)], sd > 0));
    for (const hh of [0.38, 0.72]) add('white', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ss.map((s) => V3(sd * xf(s), yf(s) + hh, -s))), ss.length * 2, 0.014, 4, false));
  };
  for (const sd of [1, -1]) rail(S_BR + 2.3, S_AEND - 0.5, deckBoat, (s) => halfW(s, deckBoat(s)) - 0.12, sd);

  // ── ventilators ──
  const vents = [];
  for (const sf of FN) for (const sd of [1, -1]) vents.push([sf - 5.5, sd * 5.6, 4.2, 0.42, 0], [sf + 5.5, sd * 5.4, 3.4, 0.36, Math.PI]);
  vents.push([30, 3.8, 2.6, 0.34, 0], [30, -3.8, 2.6, 0.34, 0], [53.5, 6.5, 3.0, 0.38, 0], [53.5, -6.5, 3.0, 0.38, 0], [226, 5, 3, 0.36, Math.PI], [226, -5, 3, 0.36, Math.PI]);
  for (const [s, x, h, r, ry] of vents) {
    let y = s < S_FC ? deckB(s) : s < S_SUP ? deckC(s) : s > S_SUPEND ? deckC(s) : deckBoat(s);
    const hs = houseAt(s); if (hs && Math.abs(x) < hs[2]) y += hs[3];
    const c = cowl(h, r), T = (g) => g.rotateY(ry).translate(x, y, -s);
    for (const g of c.outer) add('buff', T(g));
    add('ventIn', T(c.inner));
  }

  // ── forecastle and well-deck gear ──
  for (const sd of [1, -1]) {
    // capstans, bollards, anchor chains, cranes
    add('iron', new THREE.CylinderGeometry(0.42, 0.5, 0.75, 20).translate(sd * 2.4, deckB(12) + 0.37, -12));
    add('iron', new THREE.CylinderGeometry(0.5, 0.42, 0.12, 20).translate(sd * 2.4, deckB(12) + 0.8, -12));
    add('iron', box(0.28, 0.1, 6.8, sd * 1.9, deckB(8.8) + 0.06, -8.8, sd * 0.07));
    for (const s of [7, 21, 34]) for (const dz of [-0.35, 0.35]) add('iron', new THREE.CylinderGeometry(0.16, 0.18, 0.55, 12).translate(sd * (halfW(s, deckB(s)) - 0.7), deckB(s) + 0.27, -s + dz));
    for (const [s, dk] of [[33.5, deckB], [48.5, deckC]]) {
      const y = dk(s), x = sd * 4.2;
      add('iron', new THREE.CylinderGeometry(0.5, 0.62, 2.3, 18).translate(x, y + 1.15, -s));
      add('iron', box(1.6, 1.7, 2.0, x, y + 3.1, -s));
      const jib = box(0.42, 0.5, 10.5, 0, 0, 5.25); jib.rotateX(-0.3); jib.translate(x, y + 2.8, -s + 0.6); add('buff', jib);
    }
    // anchors in their hawse pipes, on the shell below the name
    { const s = 7.6, y = 10.6, n = hullNormal(s, y, sd), p = hullPt(s, y, sd, 0.02);
      const basis = new THREE.Matrix4(), xa = V3(0, 1, 0).cross(n).normalize(), ya = n.clone().cross(xa).normalize();
      basis.makeBasis(xa, ya, n).setPosition(p);
      const parts = [box(0.34, 2.8, 0.28, 0, 0.1, 0.22), box(1.1, 0.42, 0.5, 0, -1.3, 0.28)];
      for (const fx of [-1, 1]) { const f = box(0.42, 1.35, 0.26, 0, 0, 0); f.rotateZ(fx * 0.55); f.translate(fx * 0.55, -0.95, 0.3); parts.push(f); }
      for (const g of parts) add('iron', g.applyMatrix4(basis));
      const ring = new THREE.TorusGeometry(0.5, 0.11, 8, 24); ring.applyMatrix4(new THREE.Matrix4().makeBasis(xa, ya, n).setPosition(hullPt(s, y + 1.45, sd, 0.02)));
      add('iron', ring);
    }
  }
  add('iron', new THREE.CylinderGeometry(0.28, 0.34, 2.2, 14).translate(0, deckB(2.4) + 1.1, -2.4));        // anchor crane
  { const j = box(0.28, 0.32, 5.2, 0, 0, -2.6); j.rotateX(0.18); j.translate(0, deckB(2.4) + 2.1, -2.2); add('iron', j); }
  add('canvas', box(4.6, 0.75, 4.2, 0, deckB(24) + 0.38, -24));      // hatch no. 1
  add('canvas', box(4.6, 0.75, 4.6, 0, deckC(52) + 0.38, -52.5));    // hatch no. 2
  add('iron', box(1.3, 2.2, 1.3, 0, deckC(40.5) + 1.1, -40.5));         // foremast house

  // ── windows and portholes ──
  const lit = [], dark = [], rims = [];
  const warmC = () => { const w = R(); const k = 0.4 + R() * 0.7; return w < 0.25 ? [1.0 * k, 0.7 * k, 0.42 * k] : [1.0 * k, 0.56 * k, 0.24 * k]; };
  const put = (p, n, w, h, round, on, c) => {
    const qq = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), n);
    const e = { m: new THREE.Matrix4().compose(p, qq, V3(w, h, 1)), round, c: c ?? warmC() };
    (on ? lit : dark).push(e);
    if (round) rims.push(new THREE.Matrix4().compose(p.clone().addScaledVector(n, -0.005), qq, V3(w, w, w)));
  };
  const skipWell = (s) => (s > S_FC - 0.6 && s < S_SUP + 0.8) || (s > S_SUPEND - 0.8 && s < S_POOP + 0.6);
  const rows = [[1.9, 70, 226, 2.1, 0.36], [4.2, 14, 250, 1.8, 0.55], [7.2, 9, 255, 1.75, 0.6], [10.3, 5.5, 258, 1.6, 0.66]];
  for (const sd of [1, -1]) {
    for (const [yy, a, b, pitch, pl] of rows) for (let s = a; s <= b; s += pitch * (0.85 + R() * 0.3)) {
      if (yy > 9 && skipWell(s)) continue;
      if (R() < 0.12) { s += pitch * 2; continue; }
      const y = yy + sheer(s); put(hullPt(s, y, sd, 0.02), hullNormal(s, y, sd), 0.2, 0.2, true, R() < pl);
    }
    for (let s = S_SUP + 1.6; s < S_SUPEND - 1.2; s += 1.25 + (R() < 0.3 ? 1.3 : 0)) {             // B-deck windows
      const y = deckB(s) + 1.45; put(hullPt(s, y, sd, 0.02), hullNormal(s, y, sd), 0.5, 0.66, false, R() < 0.72);
    }
    for (let s = S_AF + 1.8; s < S_AEND - 1.2; s += 2.3) {                                           // A-deck promenade
      const y = deckA(s) + 1.55, on = R() < 0.8;
      put(hullPt(s, y, sd, 0.02), hullNormal(s, y, sd), 1.45, 1.15, false, on, on ? [0.3, 0.17, 0.075].map((v) => v * (0.7 + R() * 0.5)) : null);
    }
    for (const [a, b, hw] of HOUSES) for (let s = a + 1.3; s < b - 1.0; s += 2.2) {                  // deckhouse windows
      if (a < 61) continue;
      const y = deckBoat(s) + 1.45; put(V3(sd * (hw + 0.02), y, -s), V3(sd, 0, 0), 0.62, 0.8, false, R() < 0.55, R() < 0.5 ? null : [0.55, 0.3, 0.13]);
    }
  }
  for (let x = -6.3; x <= 6.4; x += 1.05) put(V3(x, deckBoat(S_BR) + 1.9, -S_BR - 0.38), V3(0, 0, 1), 0.8, 0.7, false, R() < 0.12, [0.1, 0.07, 0.04]);   // bridge (kept dark)
  for (let x = -12; x <= 12.1; x += 2.0) put(V3(x, deckB(S_SUP) + 1.5, -S_SUP + 0.02), V3(0, 0, 1), 0.55, 0.7, false, R() < 0.6, [0.5, 0.28, 0.12]);      // B-deck front
  for (let x = -12.5; x <= 12.6; x += 2.5) put(V3(x, deckA(S_AF) + 1.5, -S_AF + 0.02), V3(0, 0, 1), 1.0, 0.95, false, R() < 0.7, [0.3, 0.17, 0.075]); // A-deck front
  for (let x = -9; x <= 9.1; x += 2.2) put(V3(x, deckC(S_FC) + 1.4, -S_FC - 0.02), V3(0, 0, -1), 0.26, 0.26, true, R() < 0.5);  // forecastle break
  const circ = new THREE.CircleGeometry(1, 20), quad = new THREE.PlaneGeometry(1, 1);
  const inst = (list, mat, round) => {
    const L2 = list.filter((e) => e.round === round); if (!L2.length) return;
    if (mat === M.lit) mat = round ? M.litRound : M.litRect;
    const im = new THREE.InstancedMesh(round ? circ : quad, mat, L2.length);
    L2.forEach((e, i) => { im.setMatrixAt(i, e.m); if (mat !== M.glass) im.setColorAt(i, new THREE.Color().setRGB(...e.c)); });
    root.add(im);
  };
  inst(lit, M.lit, true); inst(lit, M.lit, false); inst(dark, M.glass, true); inst(dark, M.glass, false);
  { const im = new THREE.InstancedMesh(new THREE.TorusGeometry(1.08, 0.14, 6, 20), M.brass, rims.length); rims.forEach((m, i) => im.setMatrixAt(i, m)); root.add(im); }

  // ── the name on both bows (Cinzel, gold relief) ──
  try { await loadFont('Cinzel', new URL('../../fonts/Cinzel.ttf', import.meta.url).href); } catch (e) { console.warn('font', e); }
  const NAME = String(name || 'TITANIC').toUpperCase().slice(0, 14), pitch = 1.32 / kz, s0 = 12.6, capH = 0.8;
  for (const sd of [1, -1]) for (let i = 0; i < NAME.length; i++) {
    const s = s0 + (sd > 0 ? i : NAME.length - 1 - i) * pitch;
    const g = text3dGeometry(NAME[i], { font: '700 256px Cinzel', height: capH, depth: 0.045, bevel: 0.03, bevelSegments: 2 }); if (kz !== 1) g.scale(1 / kz, 1, 1);
    const yb = hSide(s) - 0.3 - 0.42 - capH, n = hullNormal(s, yb + capH / 2, sd);
    const ya = V3(0, 1, 0).addScaledVector(n, -n.y).normalize(), xa = ya.clone().cross(n).normalize();
    const p = hullPt(s, yb, sd, 0.06);
    const mm = new THREE.Mesh(g, M.gold); mm.matrixAutoUpdate = false;
    mm.matrix.makeBasis(xa, ya, n).setPosition(p); root.add(mm);
  }

  // ── lamps ──
  const LAMPS = [];
  const warmL = (k) => V3(1.0, 0.6, 0.28).multiplyScalar(k);
  const lampAt = (p, c, r, globe = true, out = null) => { LAMPS.push({ p: out ? p.clone().add(out) : p.clone(), c, r }); if (globe) add('lampG', new THREE.SphereGeometry(0.1, 10, 8).translate(p.x, p.y, p.z)); };
  for (const s of [64.5, 71, 78, 85, 93, 100, 109, 121, 134, 146, 160, 178, 190]) {
    const hs = houseAt(s); if (!hs) continue; const y = deckBoat(s) + 2.25;
    lampAt(V3(hs[2] + 0.14, y, -s), warmL(2.3), 14, true, V3(0.35, 0, 0));
    if ([71, 100, 146, 190].includes(s)) lampAt(V3(-hs[2] - 0.14, y, -s), warmL(2.0), 14, true, V3(-0.35, 0, 0));
  }
  for (const sd of [1, -1]) lampAt(V3(sd * 5.8, deckC(S_SUP) + 2.4, -S_SUP + 0.15), warmL(1.8), 13, true, V3(0, 0, 0.35));
  for (const sd of [1, -1]) lampAt(V3(sd * 5.2, deckC(S_SUPEND) + 2.4, -S_SUPEND - 0.15), warmL(1.6), 12, true, V3(0, 0, -0.35));
  for (const sd of [1, -1]) lampAt(V3(sd * 6, deckB(246) + 2.3, -246), warmL(1.6), 12);
  lampAt(V3(0.9, deckC(40.5) + 2.6, -39.8), warmL(1.7), 14);                                  // at the foremast house
  lampAt(V3(7.0, deckBoat(61.5) + 2.2, -61.9), warmL(1.3), 11, false);                        // wheelhouse door, dimmed
  lampAt(V3(0, deckBoat(95.5) + 3.8, -95.5), warmL(4.5), 20, false);                         // dome glow
  lampAt(V3(0, deckBoat(146.5) + 3.5, -146.5), warmL(3.2), 17, false);
  const sideP = V3(15.1, deckBoat(S_BR) + 1.9, -S_BR - 0.25), sideS = V3(-15.1, deckBoat(S_BR) + 1.9, -S_BR - 0.25);
  lampAt(V3(12.2, deckBoat(60.8) + 1.45, -60.75), warmL(0.75), 6, false);                    // wing binnacle lamp
  LAMPS.push({ p: sideP.clone().add(V3(0.2, 0, 0.3)), c: V3(1.5, 0.06, 0.03), r: 8 }, { p: sideS.clone().add(V3(-0.2, 0, 0.3)), c: V3(0.05, 1.8, 0.6), r: 9 });
  const mastL = V3(0, 33.2, fzc(33.2) + 0.55), mainL = V3(0, 38.5, mzc(38.5) + 0.5);
  LAMPS.push({ p: mastL.clone().add(V3(0, 0, 0.3)), c: V3(2.5, 2.3, 2.0), r: 16 }, { p: mainL.clone(), c: V3(1.5, 1.4, 1.2), r: 12 });
  if (LAMPS.length > NL) console.warn('titanic: too many lamps', LAMPS.length);
  // light sources you can see: sidelights, masthead + range lights, stern light
  const bulbs = [[sideP, [14, 0.35, 0.18], 0.16], [sideS, [0.2, 11, 3.2], 0.16], [mastL, [7, 6.4, 5.6], 0.16], [mainL, [5, 4.6, 4], 0.14], [V3(0, deckB(268) + 1.6, -267.8), [12, 11, 9], 0.14]];
  for (const [p, c, r] of bulbs) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), glowMat({ color: new THREE.Color().setRGB(...c) })); m.position.copy(p); root.add(m); }
  add('iron', box(0.45, 0.55, 0.4, 0, 33.2, fzc(33.2) + 0.3));

  // merge the static geometry per material
  for (const [k, list] of Object.entries(G)) {
    const mat = k === 'lampG' ? M.lamp : M[k];
    const g = mergeGeometries(list, false); if (!g) { console.warn('merge failed', k); continue; }
    if (k === 'white') boxUV(g);
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'ti-' + k; root.add(mesh);
  }

  // ── foam: bow wave, hull wash, stern wake (lit by the lamps and the portholes) ──
  const foamU = { uFoam: { value: tex.foam }, uFlow: { value: 0 }, uStrength: { value: 1 }, uAmb: { value: new THREE.Color(0.011, 0.015, 0.022) },
    uGlow: { value: new THREE.Color(0.11, 0.065, 0.03) }, uLampP: LAMPU.uLampP, uLampC: LAMPU.uLampC,
    uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uSunDir: U.uSunDir, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff, uFogBase: U.uFogBase, uMirror: U.uMirror };
  const foamMat = new THREE.ShaderMaterial({
    uniforms: foamU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aF; varying vec3 vF; varying vec3 vW; varying vec2 vUv;
      void main(){ vF = aF; vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uFoam; uniform float uFlow; uniform float uStrength; uniform vec3 uAmb; uniform vec3 uGlow;
      varying vec3 vF; varying vec3 vW; varying vec2 vUv;
      ${FOG_GLSL}
      ${LAMP_PARS}
      void main(){
        #include <logdepthbuf_fragment>
        // vUv: (metres along the ship, metres out from the hull); vF: (strength, glow from the portholes, streak)
        vec2 p = vec2(vUv.x + uFlow, vUv.y);
        float a1 = texture2D(uFoam, vec2(p.x * 0.028, p.y * 0.16 + vUv.x * 0.004)).r;
        float a2 = texture2D(uFoam, vec2(p.x * 0.12 + 0.37, p.y * 0.3 + 0.21)).r;
        float a3 = texture2D(uFoam, vec2(p.x * 0.012 * (1.0 + vF.z), p.y * 0.05 + 0.6)).g;
        float f = a1 * 0.62 + a2 * 0.5 + a3 * 0.35;
        float th = mix(1.1, 0.42, vF.x);
        float foam = smoothstep(th, th + 0.22, f) * clamp(vF.x * 1.4, 0.0, 1.0);
        foam = max(foam, smoothstep(0.85, 1.0, vF.x) * 0.8 * smoothstep(0.45, 0.8, a1 + a2 * 0.4));
        vec3 sp; vec3 li = shipLamps(vW, vec3(0.0, 1.0, 0.0), normalize(cameraPosition - vW), 0.0, sp);
        vec3 c = vec3(0.86, 0.9, 0.95) * (uAmb + li * 0.7 + uGlow * vF.y);
        vec3 rd = vW - cameraPosition; float d = length(rd); rd /= d;
        c = mix(c, wfogColor(rd), wfogAmount(cameraPosition, rd, d));
        gl_FragColor = vec4(c, foam * 0.95 * uStrength);
      }`,
  });
  const foamG = [];
  const ribbon = (ss, J, fn) => {           // fn(s, j/J) -> {p, u, v, f:[strength, glow, streak]}
    const pos = [], uv = [], ff = [], idx = [];
    ss.forEach((s) => { for (let j = 0; j <= J; j++) { const r = fn(s, j / J); pos.push(r.p.x, r.p.y, r.p.z); uv.push(r.u, r.v); ff.push(...r.f); } });
    for (let i = 0; i < ss.length - 1; i++) for (let j = 0; j < J; j++) { const a = i * (J + 1) + j, b = a + 1, c = a + J + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aF', new THREE.Float32BufferAttribute(ff, 3)); g.setIndex(idx); foamG.push(g);
  };
  const litMask = (s) => smooth((s - 8) / 20) * (1 - smooth((s - 245) / 15));
  for (const sd of [1, -1]) {
    // the bow wave: a rolled crest climbing the stem, spreading and falling aft
    ribbon(range(-0.2, 48, 0.4), 10, (s, v) => {
      const hIn = 0.2 + 1.5 * Math.exp(-Math.max(s, 0) / 6.0), out = 0.5 + 0.2 * Math.max(s, 0);
      const y = hIn * Math.pow(1 - v, 1.7) + 0.35 * Math.sin(Math.PI * v) * Math.exp(-s / 20);
      const base = hullPt(Math.max(s, 0.05), Math.min(y, hIn), sd, 0.05);
      const n = hullNormal(Math.max(s, 0.05), 0.5, sd); n.y = 0; n.normalize();
      const p = base.clone().addScaledVector(n, v * out); p.y = y + 0.02;
      return { p, u: s, v: v * out, f: [clamp(0.92 - v * 0.85 - s / 60, 0, 1), 0.4 * litMask(s + 10) * Math.exp(-v * 2), 0.2] };
    });
    // hull wash along the side: the water sheared by the shell, heavier at the bow and over the screws
    ribbon(range(24, 262, 1.2), 6, (s, v) => {
      const w = 7 + (s > 225 ? (s - 225) * 0.25 : 0), base = V3(sd * (halfW(s, 0.05) + 0.1), 0.04, -s);
      const p = base.clone(); p.x += sd * v * w;
      const k = 0.75 * (1 - smooth((s - 30) / 60)) + 0.42 + (s > 230 ? 0.3 : 0);
      return { p, u: s, v: v * w, f: [clamp(k * (1 - v * 0.9), 0, 1), litMask(s) * Math.exp(-v * 2.5), 1.0] };
    });
  }
  // the stern wake (E2 v2): churned water behind the screws, widening and fading; laid in WORLD space along the track
  // the stern really took (it curves with a turn and stays on the water instead of swinging like a tail)
  const WK = { n: 169, J: 14 }, wkPos = new Float32Array(WK.n * (WK.J + 1) * 3), wkUv = new Float32Array(WK.n * (WK.J + 1) * 2), wkF = new Float32Array(WK.n * (WK.J + 1) * 3), wkIdx = [];
  for (let i = 0; i < WK.n; i++) for (let j = 0; j <= WK.J; j++) {
    const k = i * (WK.J + 1) + j, d = i * 3, v = j / WK.J, w = 15 + d * 0.07, x = (v * 2 - 1) * w, age = d / 504;
    wkUv[k * 2 + 1] = x; wkF[k * 3] = clamp((1 - age) * 1.1 * (1 - Math.pow(Math.abs(v * 2 - 1), 3)), 0, 1); wkF[k * 3 + 1] = 0.25 * Math.exp(-d / 25); wkF[k * 3 + 2] = 0.6;
  }
  for (let i = 0; i < WK.n - 1; i++) for (let j = 0; j < WK.J; j++) { const a = i * (WK.J + 1) + j, b = a + 1, c = a + WK.J + 1, d = c + 1; wkIdx.push(a, c, b, b, c, d); }
  const wkG = new THREE.BufferGeometry(); wkG.setAttribute('position', new THREE.BufferAttribute(wkPos, 3).setUsage(THREE.DynamicDrawUsage));
  wkG.setAttribute('uv', new THREE.BufferAttribute(wkUv, 2).setUsage(THREE.DynamicDrawUsage)); wkG.setAttribute('aF', new THREE.BufferAttribute(wkF, 3)); wkG.setIndex(wkIdx);
  const wakeU = { ...foamU, uFlow: { value: 0 }, uStrength: { value: 0 } };
  const wakeMat = new THREE.ShaderMaterial({ uniforms: wakeU, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: foamMat.vertexShader, fragmentShader: foamMat.fragmentShader });
  const wakeMesh = new THREE.Mesh(wkG, wakeMat); wakeMesh.renderOrder = 2; wakeMesh.frustumCulled = false; wakeMesh.name = 'ti-wake'; wakeMesh.userData.noQA = true;
  scene.add(wakeMesh);
  const foam = new THREE.Mesh(mergeGeometries(foamG, false), foamMat); foam.renderOrder = 2; foam.frustumCulled = false; root.add(foam);

  // ── smoke from funnels 1-3 (the 4th was the dummy): billboards streaming aft on the ship's own wind ──
  const SMOKE_N = 42;
  const smokeU = { uTime: { value: 0 }, uAmb: { value: new THREE.Color(0.016, 0.019, 0.026) }, uUnder: { value: new THREE.Color(0.07, 0.042, 0.02) },
    uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uSunDir: U.uSunDir, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff, uFogBase: U.uFogBase, uMirror: U.uMirror,
    uTop: { value: [0, 1, 2, 3].map((i) => FN[Math.min(i, FN.length - 1)]).map((sf) => V3(0, FUN_TOP + 0.3, -sf - (FUN_TOP - deckBoat(sf) - 1.5) * RAKE)) }, uV: { value: VS }, uAlpha: { value: 1 } };
  const sg = new THREE.InstancedBufferGeometry(); const bq = new THREE.PlaneGeometry(1, 1);
  sg.index = bq.index; sg.attributes.position = bq.attributes.position; sg.attributes.uv = bq.attributes.uv;
  const seeds = new Float32Array(SMOKE_N * 3 * 4); const SR = rng(99);
  for (let i = 0; i < SMOKE_N * 3; i++) { seeds[i * 4] = Math.floor(i / SMOKE_N); seeds[i * 4 + 1] = SR(); seeds[i * 4 + 2] = SR(); seeds[i * 4 + 3] = SR(); }
  sg.setAttribute('aS', new THREE.InstancedBufferAttribute(seeds, 4)); sg.instanceCount = SMOKE_N * 3;
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: smokeU, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime; uniform vec3 uTop[4]; uniform float uV; attribute vec4 aS;
      varying vec2 vUv; varying float vA; varying vec3 vW; varying float vH; varying vec4 vS;
      void main(){
        float life = 6.5; float ph = fract(aS.y + uTime / life); float age = ph * life;
        int f = int(aS.x + 0.5); vec3 top = f == 0 ? uTop[0] : f == 1 ? uTop[1] : uTop[2];
        vec3 c = top + vec3((aS.z - 0.5) * 1.2 + sin(age * 0.9 + aS.w * 6.0) * 0.6 * age * 0.3, 2.4 * pow(age, 0.72) + aS.w * 0.8, -uV * 0.93 * age + (aS.z - 0.5) * 1.5);
        float size = 2.6 + 2.4 * age;
        vec4 wc = modelMatrix * vec4(c, 1.0); vW = wc.xyz; vH = c.y - top.y;
        vec4 mv = viewMatrix * wc; float rot = aS.w * 6.28 + age * 0.3;
        vec2 q = (uv - 0.5) * size; q = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
        mv.xy += q;
        vA = smoothstep(0.0, 0.07, ph) * pow(1.0 - ph, 1.4) * (f == 0 ? 0.9 : f == 1 ? 0.75 : 0.6);
        vUv = uv; vS = aS;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uAmb; uniform vec3 uUnder; uniform float uTime; uniform float uAlpha;
      varying vec2 vUv; varying float vA; varying vec3 vW; varying float vH; varying vec4 vS;
      ${FOG_GLSL}
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
      void main(){
        #include <logdepthbuf_fragment>
        vec2 q = vUv - 0.5; float r = length(q) * 2.0;
        float n = vn(vUv * 3.0 + vS.yz * 17.0) * 0.6 + vn(vUv * 7.0 + vS.zw * 11.0) * 0.4;
        float a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.8) * vA * 0.075 * uAlpha;
        if (a < 0.002) discard;
        vec3 c = uAmb + uUnder * exp(-max(vH, 0.0) / 7.0);
        vec3 rd = vW - cameraPosition; float d = length(rd); rd /= d;
        c = mix(c, wfogColor(rd), wfogAmount(cameraPosition, rd, d));
        gl_FragColor = vec4(c, a);
      }`,
  });
  const smoke = new THREE.Mesh(sg, smokeMat); smoke.frustumCulled = false; smoke.renderOrder = 3; root.add(smoke);

  // ── people: THE WITNESS at the port rail, an officer on the port bridge wing, two gentlemen at the rail aft ──
  const figs = [];
  const place = (fig, s, x, ry, pose) => { fig.group.position.set(x, deckBoat(s), -s); fig.group.rotation.y = ry; fig.pose(pose); root.add(fig.group);
    for (const m of Object.values(fig.materials)) addLamps(m); figs.push(fig); return fig; };
  const W = place(witness({ seed: 7 }), 61.25, 14.05, 0.75, { ...POSES.watch, headY: 0.35, headX: 0.04 });
  const recolor = (fig, map) => { for (const [k, v] of Object.entries(map)) if (fig.materials[k]) { if (v === null) fig.materials[k].visible = false; else fig.materials[k].color.set(v); } };
  const off = place(germanOfficer({ seed: 11 }), 60.95, 8.25, 0.1, { ...POSES.watch, headY: -0.12 });
  recolor(off, { coat: 0x151B28, collar: 0x10141D, breeches: 0x151B28, cap: 0x11151E, band: 0x0C0E14, silver: 0xC9A24C, piping: 0x151B28, board: 0x151B28, belt: 0x151B28, glove: 0x16161A, skin: 0xEEEBE4 });
  const bowler = () => {
    const g = new THREE.Group();
    const cr = new THREE.Mesh(new THREE.SphereGeometry(0.108, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.05, 1.12), M.black); cr.position.y = 0.06; g.add(cr);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.109, 0.109, 0.06, 20, 1, true).scale(1, 1, 1.12), M.black); band.position.y = 0.06; g.add(band);
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.012, 24).scale(1, 1, 1.12), M.black); br.position.y = 0.035; g.add(br);
    return g;
  };
  const gents = [];
  for (const [s, x, ry, pose, coat, sd] of [[96.3, 7.62, Math.PI / 2 + 0.55, { ...POSES.watch, headX: -0.3, headY: 0.25 }, 0x121214, 21], [97.4, 8.35, Math.PI / 2 - 0.2, { ...POSES.point, rArmX: -2.1, rArmZ: -0.35, headX: -0.45 }, 0x2A2622, 23]]) {
    const g = place(germanOfficer({ seed: sd }), s, x, ry, pose);
    recolor(g, { coat, collar: 0x0E0E10, breeches: 0x1C1C1E, cap: null, band: null, visor: null, silver: null, piping: null, board: null, belt: coat, glove: 0x2E251C, skin: 0xEEEBE4, button: 0x1A1A1A, metal: 0x1A1A1A });
    const hat = bowler(); g.anchors.head.add(hat); gents.push(g);
  }
  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });

  // ── named points (E2 v2): cameras and figures can use '<ref>.<anchor>' (they ride the ship, and the right half of it
  // once she breaks) ──
  const anchors = {};
  const A = (name, x, y, sAft) => { const o = new THREE.Object3D(); o.name = 'anchor:' + name; o.position.set(x, y, -sAft); root.add(o); anchors[name] = o; return o; };
  // people aboard (lib/human/aboard.js): floor = the deck under the point (local y offset), face = where they look by
  // default, offset = [dx +port, dz +bow] metres from the point, stand = false where nobody can stand
  const deckOf = { bow: [-1.6, 'bow'], forecastle: [-1.6, 'bow'], crows_nest: [-1.45, 'bow', [0, 0.5]], bridge_wing: [-1.7, 'bow', [0.1, 0]], bridge_wing_starboard: [-1.7, 'bow', [-0.1, 0]],
    bridge: [-2.0, 'bow'], boat_deck: [-1.7, 'out', [2.3, 0]], boat_deck_starboard: [-1.7, 'out', [-2.3, 0]], well_deck: [-1.6, 'bow'], stern_deck: [-1.7, 'stern'], stern: [-1.2, 'stern'] };
  const standOn = () => { for (const [nm, o] of Object.entries(anchors)) { const d = deckOf[nm]; if (d) Object.assign(o.userData, { floor: d[0], face: d[1], offset: d[2] || [0, 0], stand: true }); else o.userData.stand = false; } };
  A('midship', 0, 0, LOA / 2);
  A('bow', 0, deckB(4) + 1.6, 4);
  A('forecastle', 0, deckB(20) + 1.6, 20);
  A('crows_nest', 0, 30.2, 40.5 + (30.2 - deckC(40.5)) * RAKE);
  A('bridge_wing', 14.3, deckBoat(S_BR) + 1.7, S_BR + 1.0);
  A('bridge_wing_starboard', -14.3, deckBoat(S_BR) + 1.7, S_BR + 1.0);
  A('bridge', 0, deckBoat(S_BR) + 2.0, S_BR + 1.8);
  A('boat_deck', 11.0, deckBoat(120) + 1.7, 120);
  A('boat_deck_starboard', -11.0, deckBoat(120) + 1.7, 120);
  A('well_deck', 0, deckC(46) + 1.6, 46);
  A('stern_deck', 0, deckB(255) + 1.7, 255);
  A('stern', 0, deckB(266) + 1.2, 266);
  FN.forEach((sf, i) => A('funnel_' + (i + 1), 0, FUN_TOP, sf + (FUN_TOP - deckBoat(sf) - 1.5) * RAKE));
  // the lifeboat stations: davit heads over the side (boat_port_1..8 fore to aft, boat_starboard_1..8)
  const DAVITS = [];
  for (const sd of [1, -1]) PORT_S.forEach((sb, i) => { const nm = `boat_${sd > 0 ? 'port' : 'starboard'}_${i + 1}`; A(nm, sd * (HB + 1.55), deckBoat(sb) + 4.2, sb); DAVITS.push({ name: nm, s: sb, side: sd, deckY: deckBoat(sb), outX: sd * (HB + 1.55), inX: sd * (i === 0 ? HB + 1.55 : 12.3) }); });

  standOn();
  if (CUT) root.traverse((o) => { if (!o.material) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { m.clippingPlanes = [CUT.plane]; m.clipShadows = false; if (!m.transparent) m.side = THREE.DoubleSide; m.needsUpdate = true; } });
  // ── the break (E2 v2): the ship split in two at breakS (metres aft of the stem), identical until she breaks ──
  let fore = null, aft = null;
  if (breakS != null) {
    const sp = splitAt(root, -breakS, { keep: [foam, smoke] });
    fore = sp.fore; aft = sp.aft; fore.matrixAutoUpdate = aft.matrixAutoUpdate = false;
    // torn ends: a dark, jagged bulkhead face on each half (the inside of a hull is black at night)
    for (const [g, sg] of [[fore, 1], [aft, -1]]) {
      const pts = []; const R2 = rng(sg > 0 ? 71 : 73);
      for (let k = 0; k <= 16; k++) { const y = lerp(-9.5, deckBoat(breakS) + 1, k / 16); const hw = halfW(breakS, Math.min(y, 14)) * 0.99; pts.push([hw, y + (R2() - 0.5) * 0.8]); }
      const shp = new THREE.Shape(); shp.moveTo(0, -10);
      pts.forEach(([x, y]) => shp.lineTo(x, y)); for (let k = pts.length - 1; k >= 0; k--) shp.lineTo(-pts[k][0], pts[k][1] + (R2() - 0.5) * 0.9);
      const cap = new THREE.Mesh(new THREE.ShapeGeometry(shp), shipMat({ color: 0x050505, roughness: 0.9, side: THREE.DoubleSide }, 0.1, 8));
      cap.position.set(0, 0, -breakS + sg * 0.4); cap.name = 'ti-tear'; g.add(cap);
    }
  }
  const lampPart = LAMPS.map((L2) => (breakS != null && -L2.p.z > breakS ? 'aft' : 'fore'));

  // the hull as a solid for the camera probe: local point (x across, y up, z = -s) -> top of the solid there, or 0
  const MAST = [[40.5, deckC(40.5), 47], [212, deckA(212), 46]];
  function solid(x, y, z, m = 0.6, part = null) {
    const s = -z, ax = Math.abs(x);
    if (part === 'fore' && s > breakS + m) return 0;
    if (part === 'aft' && s < breakS - m) return 0;
    if (s < -m - 1 || s > LOA + m || y < -11 - m || y > 48 + m) return 0;
    for (const sf of FN) { const y0 = deckBoat(sf) + 1.5; if (y > y0 - m && y < FUN_TOP + m) { const zc = -sf - (y - y0) * RAKE, dx = ax / (FRX + m), dz = (z - zc) / (FRZ + m); if (dx * dx + dz * dz < 1) return FUN_TOP; } }
    for (const [ms, y0, top] of MAST) if (y < top + m && y > y0 - m && Math.hypot(ax, s - ms - (y - y0) * RAKE) < 0.55 + m) return top;
    const sc = clamp(s, 0, LOA);
    let top = hSide(sc);
    if (sc > S_AF && sc < S_AEND) {
      top = Math.max(top, deckBoat(sc) + 1.2);
      if (ax > 10.2 && sc > 62 && sc < 186) top = deckBoat(sc) + 4.6;                     // boats in their davits
      const hs = houseAt(sc); if (hs && ax < hs[2] + m) top = Math.max(top, deckBoat(sc) + hs[3] + 0.2);
    }
    if (sc > S_BR - 1.5 && sc < S_BR + 3 && ax < 15.3 + m && y > deckBoat(sc) - 0.6 - m) return y < deckBoat(sc) + 3.2 + m ? deckBoat(sc) + 3.2 : 0;   // bridge + wings
    if (y > top + m) return 0;
    if (ax > halfW(sc, clamp(y, -10, 16)) + m) return 0;
    return top;
  }

  console.log('[titanic] built', Math.round(performance.now() - t0), 'ms, lamps', LAMPS.length, 'lit', lit.length, 'dark', dark.length, breakS != null ? `split at ${breakS} m` : '');

  // ── per frame ──
  const tmp = new THREE.Vector3(), IDM = new THREE.Matrix4();
  function update(clock, t, e, s) {
    const st = s.titanic, sk = st.sink && st.sink.active ? st.sink : null;
    root.position.set(st.x, st.y ?? 0, st.z); root.rotation.set(0, st.heading, st.roll || 0);
    if (fore) {
      if (sk) { sectionMatrix(sk.broken ? sk.fore : sk.whole, fore.matrix); sectionMatrix(sk.broken ? sk.aft : sk.whole, aft.matrix); }
      else { fore.matrix.copy(IDM); aft.matrix.copy(IDM); }
      fore.matrixWorldNeedsUpdate = aft.matrixWorldNeedsUpdate = true;
    }
    root.updateMatrixWorld(true);
    for (let i = 0; i < NL; i++) {
      const L2 = LAMPS[i], P = LAMPU.uLampP.value[i];
      if (!L2) { P.set(0, 0, 0, 0); continue; }
      tmp.copy(L2.p).applyMatrix4(fore ? (lampPart[i] === 'aft' ? aft : fore).matrixWorld : root.matrixWorld);
      P.set(tmp.x, tmp.y, tmp.z, L2.r); LAMPU.uLampC.value[i].copy(L2.c).multiplyScalar(st.lamps ?? 1);
    }
    const v = Math.max(0, st.speed ?? VS), sinkK = sk ? 1 - smooth(sk.u * 6) : 1;
    for (const [g, sg] of PROPS) g.rotation.z = sg * clock * Math.PI * 2 * 1.25 * clamp(v / VS, 0, 1.3);
    if (CUT) {
      const nx = new THREE.Vector3(CUT.keepPort ? 1 : -1, 0, 0).transformDirection(root.matrixWorld), p0 = new THREE.Vector3(0, 0, 0).applyMatrix4(root.matrixWorld);
      CUT.plane.setFromNormalAndCoplanarPoint(nx, p0);
      const n = CUT.nAt(clock);
      const trim = sk ? (sk.broken ? sk.fore.trim : sk.whole.trim) : 0, tg = Math.tan(trim);   // the water stays level while she trims by the head
      CUT.comps.forEach((c, i) => {
        const f = clamp(n - i, 0, 1), h = (CUT.rise ? smooth(f) : f > 0 ? 1 : 0) * (c.yt - c.yk);
        c.wat.visible = h > 0.02;
        if (c.wat.visible) { const P2 = c.wat.geometry.attributes.position, top = c.wat.geometry.userData.top; for (let v = 0; v < P2.count; v++) if (top[v]) P2.setY(v, clamp(h + tg * P2.getZ(v), 0.02, c.yt - c.yk)); P2.needsUpdate = true; }
        const prev = CUT.comps[i - 1];                                      // water spilling over the bulkhead from the full one ahead
        c.spill.visible = false;
        if (prev) { const fp = clamp(n - (i - 1), 0, 1); if (fp >= 0.999 && f > 0.02 && f < 0.995) { prev.spill.visible = true; prev.spill.scale.y = Math.max(0.2, prev.top - (c.yk + h)); } }
      });
    }
    foamU.uFlow.value = -VS * clock; foamU.uStrength.value = clamp(v / 8, 0, 1) * sinkK;
    smokeU.uTime.value = clock; smokeU.uV.value = v; smokeU.uAlpha.value = sk ? 1 - smooth(sk.u * 2.5) : 1;
    M.litRect.color.setScalar(st.windows ?? 1); M.litRound.color.setScalar(st.windows ?? 1);
    for (const m of [M.dome, M.lamp]) { if (m.userData.c0 == null) m.userData.c0 = m.color.clone(); m.color.copy(m.userData.c0).multiplyScalar(clamp(st.lamps ?? 1, 0, 1) * 0.98 + 0.02); }
    // the stern wake along the real track (world space)
    if (st.track && v > 0.05) {
      const now = st.track(t); let dist = 0;
      for (let i = 0; i < WK.n; i++) {
        const d = i * 3, q = st.track(t - d / Math.max(1, v));
        const hd = q[2], fx = Math.sin(hd), fz = Math.cos(hd), px = Math.cos(hd), pz = -Math.sin(hd);
        const cx = q[0] - fx * 256 * kz, cz = q[1] - fz * 256 * kz, w = (15 + d * 0.07) * kxy;
        if (i) dist = d;
        for (let j = 0; j <= WK.J; j++) { const k = i * (WK.J + 1) + j, xx = ((j / WK.J) * 2 - 1) * w; wkPos[k * 3] = cx + px * xx; wkPos[k * 3 + 1] = (st.y ?? 0) + 0.035; wkPos[k * 3 + 2] = cz + pz * xx; wkUv[k * 2] = 256 + d; }
        void now; void dist;
      }
      wkG.attributes.position.needsUpdate = true; wkG.attributes.uv.needsUpdate = true; wkG.computeBoundingSphere();
      wakeU.uStrength.value = clamp(v / 8, 0, 1) * sinkK; wakeU.uFlow.value = -v * clock; wakeMesh.visible = true;
    } else { wakeU.uStrength.value = 0; wakeMesh.visible = false; }
    const aftDir = V3(-Math.sin(st.heading), 0, -Math.cos(st.heading));
    for (const f of figs) f.update(clock, { wind: { x: aftDir.x, z: aftDir.z, strength: 0.75 * clamp(v / VS, 0.2, 1) } });
  }
  // a lifeboat item lowering from a station hides the liner's own boat there (E2 v2): hideBoat('boat_port_3', true)
  const hidden = new Map(), _hm = new THREE.Matrix4(), _hp = new THREE.Vector3();
  function hideBoat(name, on) {
    const m = /^boat_(port|starboard)_(\d)$/.exec(name || ''); if (!m) return;
    const sd = m[1] === 'port' ? 1 : -1, i = +m[2] - 1, sb = PORT_S[i]; if (sb == null) return;
    const xs = [sd * (HB + 1.55), sd * 12.3];
    root.traverse((o) => {
      if (!o.isInstancedMesh || !/^ti-boats-/.test(o.name)) return;
      for (let k = 0; k < o.count; k++) {
        const key = o.uuid + ':' + k;
        if (!hidden.has(key)) { o.getMatrixAt(k, _hm); _hp.setFromMatrixPosition(_hm); if (Math.abs(_hp.z + sb) > 0.6 || !xs.some((x) => Math.abs(_hp.x - x) < 0.6)) continue; hidden.set(key, { o, k, m: _hm.clone(), name }); }
        const h = hidden.get(key); if (h.name !== name) continue;
        o.setMatrixAt(k, on ? _hm.makeScale(0, 0, 0) : h.m); o.instanceMatrix.needsUpdate = true;
      }
    });
  }
  if (kz !== 1) { root.scale.set(kxy, kxy, kz); for (const f of figs) f.group.scale.set(1 / kxy, 1 / kxy, 1 / kz); }   // a shorter / longer liner; people keep their size
  root.userData.titanic = { hideBoat, anchors };
  return { root, update, LAMPS, figs, M, anchors, solid, fore, aft, wake: wakeMesh, davits: DAVITS, breakS, hideBoat, kz, kxy, length: LOA * kz, beam: 2 * HB * kxy, funnels: FN.length };
}
