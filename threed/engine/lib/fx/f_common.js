// f_common.js — shared machinery for the D2b disaster FX (fire, earth, space). Not a module (no CATALOG).
//   puffs     lit, sorted, soft billboard volumes (smoke, ash, dust, pyroclastic billows) with sun + sky light, a glow
//             from below (fire / lava), a hot core colour, ground fade, near-camera fade and the shared height fog
//   flames    upright additive flame tongues (procedural, HDR so they bloom); pivot at the base
//   sparks    additive points (embers, bombs' glow, debris sparks), pixel size clamped
//   env       the scene's key/sky lights read once per frame so the volumes match the world's light
//   helpers   integer hash, ease, a terrain-conforming grid, damped shake, local<->world for a rotated footprint
// Everything is a pure function of t: the FX modules compute every particle from its index and t, then push it.
import * as THREE from 'three';
import { U, FOG_GLSL } from '../shared/env.js';
import { makeNoise, clamp, lerp, smooth } from '../shared/util.js';
import { BILLOW_GLSL, billowUniforms, softDepth } from './billow.js';

export const DEG = Math.PI / 180;
export { clamp, lerp, smooth };
export const sstep = (a, b, x) => smooth((x - a) / (b - a));
export const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const easeOut = (x) => { x = clamp(x); return 1 - (1 - x) * (1 - x); };
export const easeIn = (x) => { x = clamp(x); return x * x; };

// integer hash -> [0, 1)
export function hf(i, s = 0) {
  let h = Math.imul((i | 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((s | 0) + 0x632BE5AB, 0xC2B2AE35);
  h ^= h >>> 13; h = Math.imul(h, 0x27D4EB2F); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// smooth 1D value noise in t (for flicker/turbulence), -1..1
export function vn(x, s = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hf(i, s) * 2 - 1, hf(i + 1, s) * 2 - 1, u);
}
export const fbm1 = (x, s = 0) => vn(x, s) * 0.55 + vn(x * 2.13 + 7.1, s + 1) * 0.3 + vn(x * 4.37 + 3.3, s + 2) * 0.15;

// ── textures ────────────────────────────────────────────────────────────────────────────────────────────────────
function cacheGet(ctx, key, make) {
  const c = ctx.cache;
  if (c && c.has(key)) return c.get(key);
  const v = make();
  if (c) c.set(key, v);
  return v;
}
// 2x2 atlas of billowy blobs: R = density, G = "thickness" (a blurred density for self-shadowing)
export function puffAtlas(ctx) {
  return cacheGet(ctx, 'fx.puffAtlas', () => {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S * 2;
    const g = cv.getContext('2d'), img = g.createImageData(S * 2, S * 2), d = img.data;
    for (let cell = 0; cell < 4; cell++) {
      const nz = makeNoise(101 + cell * 17), ox = (cell % 2) * S, oy = Math.floor(cell / 2) * S;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
        const r = Math.hypot(u, v);
        const big = nz.fbm2(u * 1.6 + cell * 3.1, v * 1.6 - cell, 3);
        const fine = nz.fbm2(u * 5.2 + 11, v * 5.2 - 7, 4);
        const edge = r * 1.08 + big * 0.3 + fine * 0.1;
        let den = clamp((0.92 - edge) * 1.8);
        den = den * den * (3 - 2 * den);
        den *= (0.78 + 0.22 * (fine * 0.5 + 0.5)) * (1 - smooth((r - 0.6) / 0.32));
        const th = clamp(1 - r * 1.05 + big * 0.2);
        const k = ((oy + y) * S * 2 + ox + x) * 4;
        d[k] = Math.round(den * 255); d[k + 1] = Math.round(clamp(th) * 255); d[k + 2] = 0; d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.userData.keep = true;
    return t;
  });
}
// tileable fbm noise (R: fbm, G: ridged), 256^2, repeat-wrapped
export function noiseTex(ctx) {
  return cacheGet(ctx, 'fx.noiseTex', () => {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'), img = g.createImageData(S, S), d = img.data, nz = makeNoise(707);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const f = nz.fbm2(x / S * 8, y / S * 8, 5, 2, 0.5, 8, 8) * 0.5 + 0.5;
      const r = nz.ridge2(x / S * 4 + 3, y / S * 4 + 5, 4, 4, 4);
      const k = (y * S + x) * 4; d[k] = Math.round(clamp(f) * 255); d[k + 1] = Math.round(clamp(r) * 255); d[k + 2] = 0; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData.keep = true;
    return t;
  });
}

// ── the scene's light, read once per frame (the look is applied after the build) ───────────────────────────────
export const FXU = {
  uKey: { value: new THREE.Color(1, 1, 1) },       // key light colour x intensity
  uSky: { value: new THREE.Color(0.4, 0.45, 0.55) }, // hemisphere sky x intensity
  uGnd: { value: new THREE.Color(0.15, 0.12, 0.1) },
};
let _lights = null, _lightsScene = null;
export function syncEnv(ctx) {
  const sc = ctx.world3;
  if (!sc) return;
  if (_lightsScene !== sc || !_lights || !_lights.key) {
    _lights = { key: null, hemi: null }; _lightsScene = sc;
    sc.traverse((o) => { if (o.isDirectionalLight && o.castShadow && !_lights.key) _lights.key = o; if (o.isHemisphereLight && !_lights.hemi) _lights.hemi = o; });
  }
  const { key, hemi } = _lights;
  if (key) FXU.uKey.value.copy(key.color).multiplyScalar(key.intensity);
  if (hemi) { FXU.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity); FXU.uGnd.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity); }
}

// ── puffs: lit smoke/ash/dust volumes ───────────────────────────────────────────────────────────────────────────
// Q4: the puffs are lit cauliflower billows (billow.js): bump normals + crevice occlusion from the atlas, fine detail
// boiling in the world time, a self-shadowed core (per-puff `occ`), a silver lining when backlit, soft-depth fade where
// they meet geometry. Fog is evaluated per vertex (once per puff).
const PUFF_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 iA;   // xyz centre (world), size (radius m)
attribute vec4 iB;   // rotation, alpha, atlas cell, ground y
attribute vec4 iC;   // albedo, glow, heat, stretch (vertical elongation)
attribute vec4 iD;   // soft (0 crisp billow .. 1 wispy haze), occ (1 lit surface .. 0 deep core), seed, blend (0..1)
uniform float uFogK;
${FOG_GLSL}
varying vec2 vQ; varying vec2 vCS; varying vec3 vW; varying vec3 vR; varying vec3 vU; varying vec3 vF;
varying float vAlpha; varying float vGround; varying float vSize; varying vec3 vC; varying float vDepth;
varying vec4 vD; varying float vCell; varying vec4 vFog;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 fwd = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 q = position.xy * 2.0;                                   // -1..1
  vec2 qs = vec2(q.x, q.y * (1.0 + iC.w));
  vec3 w = iA.xyz + (right * qs.x + up * qs.y) * iA.w;
  vQ = q; vCS = vec2(cos(iB.x), sin(iB.x)); vW = w; vR = right; vU = up; vF = fwd;
  vAlpha = iB.y; vGround = iB.w; vSize = iA.w; vC = iC.xyz; vD = iD;
  vCell = mod(floor(iB.z + 0.5) + 4.0 * floor(fract(iD.z * 7.123) * 4.0), 16.0);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDepth = -mv.z;
  vec3 fr = iA.xyz - cameraPosition; float fd = length(fr); vec3 frd = fr / max(fd, 1e-3);
  vFog = vec4(wfogColor(frd), wfogAmount(cameraPosition, frd, fd) * uFogK);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const PUFF_FS = /* glsl */`
#include <logdepthbuf_pars_fragment>
uniform vec3 uTint; uniform vec3 uGlowCol; uniform vec3 uHeatCol; uniform float uHeatHDR; uniform vec3 uSunDir;
uniform vec3 uKey; uniform vec3 uSky; uniform vec3 uGnd; uniform vec3 uSunColor; uniform float uNear; uniform float uLightK;
uniform float uGroundFade; uniform float uSoftK;
${BILLOW_GLSL}
varying vec2 vQ; varying vec2 vCS; varying vec3 vW; varying vec3 vR; varying vec3 vU; varying vec3 vF;
varying float vAlpha; varying float vGround; varying float vSize; varying vec3 vC; varying float vDepth;
varying vec4 vD; varying float vCell; varying vec4 vFog;
void main() {
  #include <logdepthbuf_fragment>
  float soft = vD.x, occ = vD.y;
  vec4 b = billowTex(vQ, vCS, vCell, vD.z, soft);
  float den = b.x;
  float a = clamp(den * vAlpha, 0.0, 1.0);
  a *= smoothstep(vGround - 0.1 * vSize, vGround + uGroundFade * vSize, vW.y);
  a *= smoothstep(uNear * 0.4, uNear, vDepth);
  if (a < 0.003) discard;
  a *= billowSoftDepth(vDepth, vSize * uSoftK);
  if (a < 0.003) discard;
  vec3 N = normalize(vR * b.y + vU * b.z + vF * sqrt(max(1.0 - dot(b.yz, b.yz), 0.02)));
  // blend (iD.w, 0 = off): a billow deep inside a big convecting mass: its own relief and crevices fade out of the
  // shading, so neighbours on the shadow side merge into one volume instead of reading as separate balls
  float ao = b.w;
  if (vD.w > 0.0) { N = normalize(mix(N, vF, vD.w)); ao = mix(b.w, 1.0, 0.7 * vD.w); }
  vec3 V = normalize(vW - cameraPosition);
  vec3 alb = uTint * vC.x * (0.9 + 0.2 * den);
  vec3 col = billowLight(alb, N, uSunDir, V, den, ao, occ, soft, uKey * (0.95 * uLightK), uSky * 0.85, uGnd * 0.85);
  // glow from below (fire, lava): the underside, the crevices and thin edges catch it
  float under = clamp(0.55 - N.y * 0.6, 0.0, 1.0);
  col += alb * uGlowCol * vC.y * (0.35 + under) * mix(1.0, ao, 0.4) + uGlowCol * vC.y * 0.06 * (1.0 - den);
  // hot core (pyroclastic base, lava-lit ash): emissive, blooms above ~2.4; hottest in the crevices
  col = mix(col, uHeatCol * uHeatHDR * (0.5 + 0.5 * den) * mix(1.0, 1.3 - ao * 0.6, 0.5), clamp(vC.z * (0.35 + 0.65 * den), 0.0, 1.0));
  col = mix(col, vFog.rgb, vFog.a);
  gl_FragColor = vec4(col, a);
}`;
const ADD_FS = /* glsl */`
#include <logdepthbuf_pars_fragment>
uniform vec3 uTint; uniform float uNear;
${BILLOW_GLSL}
varying vec2 vQ; varying vec2 vCS; varying vec3 vW; varying vec3 vR; varying vec3 vU; varying vec3 vF;
varying float vAlpha; varying float vGround; varying float vSize; varying vec3 vC; varying float vDepth;
varying vec4 vD; varying float vCell; varying vec4 vFog;
void main() {
  #include <logdepthbuf_fragment>
  float den = billowTex(vQ, vCS, vCell, vD.z, vD.x).x;
  float core = exp(-dot(vQ, vQ) * 3.0);
  float a = (den * 0.6 + core * 0.7) * vAlpha * smoothstep(uNear * 0.4, uNear, vDepth) * billowSoftDepth(vDepth, vSize * 0.3);
  vec3 col = uTint * vC * a * (1.0 - vFog.a);
  gl_FragColor = vec4(col, 1.0);
}`;

// o: {count, mode:'lit'|'add', tint:[r,g,b], glow:[r,g,b], heat:[r,g,b], heatHDR, near, fog, light, order, groundFade, softK}
export function makePuffs(ctx, o = {}) {
  const N = o.count ?? 1000;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.setAttribute('position', base.attributes.position); geo.setAttribute('uv', base.attributes.uv);
  const A = new Float32Array(N * 4), B = new Float32Array(N * 4), C = new Float32Array(N * 4), D = new Float32Array(N * 4);
  const aA = new THREE.InstancedBufferAttribute(A, 4), aB = new THREE.InstancedBufferAttribute(B, 4), aC = new THREE.InstancedBufferAttribute(C, 4), aD = new THREE.InstancedBufferAttribute(D, 4);
  for (const a of [aA, aB, aC, aD]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iA', aA); geo.setAttribute('iB', aB); geo.setAttribute('iC', aC); geo.setAttribute('iD', aD);
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1); geo.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0));
  const add = o.mode === 'add';
  const uniforms = {
    ...billowUniforms(U.uTime), uTint: { value: new THREE.Color(...(o.tint || [0.5, 0.48, 0.46])) },
    uGlowCol: { value: new THREE.Color(...(o.glow || [1.0, 0.42, 0.12])) }, uHeatCol: { value: new THREE.Color(...(o.heat || [1.0, 0.45, 0.12])) },
    uHeatHDR: { value: o.heatHDR ?? 3.0 }, uNear: { value: o.near ?? 6 }, uFogK: { value: o.fog ?? 1 }, uLightK: { value: o.light ?? 1 },
    uGroundFade: { value: o.groundFade ?? 0.35 }, uSoftK: { value: o.softK ?? 0.35 },
    uKey: FXU.uKey, uSky: FXU.uSky, uGnd: FXU.uGnd, uSunColor: U.uSunColor,
    uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uSunDir: U.uSunDir, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff, uFogBase: U.uFogBase, uMirror: U.uMirror,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: PUFF_VS, fragmentShader: add ? ADD_FS : PUFF_FS,
    transparent: true, depthWrite: false, depthTest: true,
    blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, premultipliedAlpha: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.userData.noQA = true; mesh.renderOrder = o.order ?? 10; mesh.name = o.name || 'fx.puffs';
  // staging (unsorted)
  const sA = new Float32Array(N * 4), sB = new Float32Array(N * 4), sC = new Float32Array(N * 4), sD = new Float32Array(N * 4), dep = new Float32Array(N);
  let idx = new Array(N).fill(0).map((_, i) => i);
  let n = 0;
  const cam = new THREE.Vector3();
  const api = {
    mesh, uniforms, N,
    begin() { n = 0; },
    get n() { return n; },
    // x, y, z, size (radius), rot, alpha, cell 0..3, ground y, albedo, glow, heat, stretch,
    // soft (0 fresh crisp billow .. 1 old wispy haze), occ (sun visibility: 1 lit surface .. 0 deep in the core),
    // seed (0..1, constant per particle: picks one of 4 variants of the cell and its detail),
    // blend (0 own relief .. 1 flat: a billow inside a big mass shades like its neighbours, see PUFF_FS)
    push(x, y, z, size, rot, alpha, cell, gy, alb = 1, glow = 0, heat = 0, stretch = 0, soft = 0, occ = 1, seed = 0, blend = 0) {
      if (n >= N || !(alpha > 0.002) || !(size > 0)) return;
      const k = n * 4;
      sA[k] = x; sA[k + 1] = y; sA[k + 2] = z; sA[k + 3] = size;
      sB[k] = rot; sB[k + 1] = alpha; sB[k + 2] = cell; sB[k + 3] = gy;
      sC[k] = alb; sC[k + 1] = glow; sC[k + 2] = heat; sC[k + 3] = stretch;
      sD[k] = soft; sD[k + 1] = occ; sD[k + 2] = seed; sD[k + 3] = blend;
      n++;
    },
    end(camera) {
      const root = mesh.parent;
      let ox = 0, oy = 0, oz = 0;
      if (root) { root.updateMatrixWorld(); const e = root.matrixWorld.elements; ox = e[12]; oy = e[13]; oz = e[14]; }
      if (camera) camera.getWorldPosition(cam); else cam.set(0, 1e5, 0);
      for (let i = 0; i < n; i++) { const k = i * 4; const dx = sA[k] + ox - cam.x, dy = sA[k + 1] + oy - cam.y, dz = sA[k + 2] + oz - cam.z; dep[i] = dx * dx + dy * dy + dz * dz; }
      const ord = idx.slice(0, n);
      if (!add) ord.sort((a, b) => dep[b] - dep[a]);
      for (let j = 0; j < n; j++) {
        const s = ord[j] * 4, d = j * 4;
        A[d] = sA[s] + ox; A[d + 1] = sA[s + 1] + oy; A[d + 2] = sA[s + 2] + oz; A[d + 3] = sA[s + 3];
        B[d] = sB[s]; B[d + 1] = sB[s + 1]; B[d + 2] = sB[s + 2]; B[d + 3] = sB[s + 3] + oy;
        C[d] = sC[s]; C[d + 1] = sC[s + 1]; C[d + 2] = sC[s + 2]; C[d + 3] = sC[s + 3];
        D[d] = sD[s]; D[d + 1] = sD[s + 1]; D[d + 2] = sD[s + 2]; D[d + 3] = sD[s + 3];
      }
      geo.instanceCount = n;
      aA.needsUpdate = aB.needsUpdate = aC.needsUpdate = aD.needsUpdate = true;
      for (const a of [aA, aB, aC, aD]) a.addUpdateRange(0, Math.max(4, n * 4));
    },
  };
  // the mesh is rendered with an identity model matrix: positions are pushed in the root's local frame and
  // converted to world in end() (the shader builds the billboard in world space)
  mesh.matrixAutoUpdate = false;
  mesh.onBeforeRender = (renderer) => { mesh.matrixWorld.identity(); softDepth(renderer, uniforms); };
  return api;
}

// ── flames: upright additive tongues, base at the pushed point ──────────────────────────────────────────────────
const FLAME_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 iA;  // base xyz (world), height
attribute vec4 iB;  // width, phase, intensity, temperature (0 cool red .. 1 white-hot)
varying vec2 vUv; varying float vPhase; varying float vI; varying float vT; varying vec3 vW;
void main() {
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // upright (cylindrical) billboards; seen from high above they tilt towards the camera so they never read as slivers
  float k = smoothstep(0.4, 0.85, -normalize(iA.xyz - cameraPosition).y);
  vec3 side = normalize(mix(normalize(vec3(camR.x, 0.0, camR.z) + vec3(1e-4, 0.0, 0.0)), camR, k));
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), camU, k * 0.85));
  vec3 w = iA.xyz + side * position.x * iB.x + up * (position.y + 0.5) * iA.w;
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  vPhase = iB.y; vI = iB.z; vT = iB.w; vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FLAME_FS = /* glsl */`
#include <logdepthbuf_pars_fragment>
uniform sampler2D uNoise; uniform float uTime; uniform float uHDR; uniform float uFogK;
${FOG_GLSL}
varying vec2 vUv; varying float vPhase; varying float vI; varying float vT; varying vec3 vW;
void main() {
  #include <logdepthbuf_fragment>
  float t = uTime + vPhase * 11.0;
  vec2 uv = vUv;
  // rising, stretched noise: large licks + fine flicker
  float n1 = texture2D(uNoise, vec2(uv.x * 0.7 + vPhase * 3.1, uv.y * 0.55 - t * 0.9)).r;
  float n2 = texture2D(uNoise, vec2(uv.x * 1.9 - vPhase * 1.7, uv.y * 1.5 - t * 1.9)).r;
  float n3 = texture2D(uNoise, vec2(uv.x * 4.1 + vPhase, uv.y * 3.2 - t * 3.4)).g;
  float n = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
  float x = (uv.x - 0.5) * 2.0;
  x += (n1 - 0.5) * 0.9 * uv.y + (n2 - 0.5) * 0.35;
  float w = mix(0.9, 0.25, uv.y);
  float body = clamp(1.0 - (x * x) / (w * w), 0.0, 1.0);
  float fall = 1.0 - uv.y;
  float f = body * (fall * 1.25 + 0.05) - (1.0 - n) * (0.35 + uv.y * 0.75);
  f = smoothstep(0.0, 0.35, f) * smoothstep(0.0, 0.08, uv.y);
  if (f < 0.004) discard;
  float temp = clamp(f * (0.7 + vT * 0.5) * (1.2 - uv.y * 0.6), 0.0, 1.0);
  vec3 col = mix(vec3(0.55, 0.05, 0.005), vec3(1.0, 0.28, 0.03), smoothstep(0.05, 0.35, temp));
  col = mix(col, vec3(1.0, 0.55, 0.12), smoothstep(0.35, 0.7, temp));
  col = mix(col, vec3(1.0, 0.85, 0.5), smoothstep(0.75, 1.0, temp));
  float hdr = uHDR * (0.35 + 0.9 * temp * temp);
  vec3 fr = vW - cameraPosition; float fd = length(fr); vec3 frd = fr / max(fd, 1e-3);
  float fa = wfogAmount(cameraPosition, frd, fd) * uFogK;
  gl_FragColor = vec4(col * f * vI * hdr * (1.0 - fa), 1.0);
}`;
export function makeFlames(ctx, o = {}) {
  const N = o.count ?? 800;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.setAttribute('position', base.attributes.position);
  const A = new Float32Array(N * 4), B = new Float32Array(N * 4);
  const aA = new THREE.InstancedBufferAttribute(A, 4), aB = new THREE.InstancedBufferAttribute(B, 4);
  aA.setUsage(THREE.DynamicDrawUsage); aB.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iA', aA); geo.setAttribute('iB', aB); geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1); geo.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0));
  const uniforms = {
    uNoise: { value: noiseTex(ctx) }, uTime: { value: 0 }, uHDR: { value: o.hdr ?? 5 }, uFogK: { value: o.fog ?? 1 },
    uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uSunDir: U.uSunDir, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff, uFogBase: U.uFogBase, uMirror: U.uMirror,
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.userData.noQA = true; mesh.renderOrder = o.order ?? 12; mesh.name = o.name || 'fx.flames';
  mesh.matrixAutoUpdate = false; mesh.onBeforeRender = () => { mesh.matrixWorld.identity(); };
  let n = 0;
  return {
    mesh, uniforms, N,
    begin(t) { n = 0; uniforms.uTime.value = t; },
    get n() { return n; },
    push(x, y, z, h, w, phase, inten, temp = 0.5) {
      if (n >= N || !(inten > 0.003) || !(h > 0.05)) return;
      const k = n * 4; A[k] = x; A[k + 1] = y; A[k + 2] = z; A[k + 3] = h; B[k] = w; B[k + 1] = phase; B[k + 2] = inten; B[k + 3] = temp; n++;
    },
    end() {
      const root = mesh.parent;
      if (root) { root.updateMatrixWorld(); const e = root.matrixWorld.elements; for (let i = 0; i < n; i++) { A[i * 4] += e[12]; A[i * 4 + 1] += e[13]; A[i * 4 + 2] += e[14]; } }
      geo.instanceCount = n; aA.needsUpdate = aB.needsUpdate = true;
    },
  };
}

// ── sparks: additive points (embers, glowing bombs, debris sparks) ──────────────────────────────────────────────
const SPARK_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 iCol;  // rgb (HDR), size (m)
varying vec3 vCol; varying float vFade;
uniform float uPx; uniform float uMaxPx; uniform float uMinPx;
${FOG_GLSL}
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = iCol.w * uPx / max(-mv.z, 0.1);
  float cl = clamp(px, uMinPx, uMaxPx);
  vCol = iCol.rgb * min(1.0, px / uMinPx) * min(1.0, (px * px) / (cl * cl) + 0.35);
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz; vec3 fr = wp - cameraPosition; float fd = length(fr);
  vFade = 1.0 - wfogAmount(cameraPosition, fr / max(fd, 1e-3), fd);
  gl_PointSize = cl;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const SPARK_FS = /* glsl */`
#include <logdepthbuf_pars_fragment>
varying vec3 vCol; varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
 vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard; float a = exp(-r * 3.0); gl_FragColor = vec4(vCol * a * vFade, 1.0); }`;
export function makeSparks(ctx, o = {}) {
  const N = o.count ?? 2000;
  const P = new Float32Array(N * 3), Cc = new Float32Array(N * 4);
  const geo = new THREE.BufferGeometry();
  const aP = new THREE.BufferAttribute(P, 3), aC = new THREE.BufferAttribute(Cc, 4);
  aP.setUsage(THREE.DynamicDrawUsage); aC.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aP); geo.setAttribute('iCol', aC); geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1); geo.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const H = +(new URLSearchParams(location.search).get('h') || 1080);
  const uniforms = {
    uPx: { value: H / (2 * Math.tan(20 * DEG)) }, uMaxPx: { value: (o.maxPx ?? 7) * H / 1080 }, uMinPx: { value: (o.minPx ?? 1.6) * H / 1080 },
    uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uSunDir: U.uSunDir, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff, uFogBase: U.uFogBase, uMirror: U.uMirror,
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.userData.noQA = true; pts.renderOrder = o.order ?? 14; pts.name = o.name || 'fx.sparks';
  let n = 0;
  return {
    mesh: pts, uniforms, N,
    begin() { n = 0; },
    get n() { return n; },
    push(x, y, z, r, g, b, size) { if (n >= N) return; P[n * 3] = x; P[n * 3 + 1] = y; P[n * 3 + 2] = z; Cc[n * 4] = r; Cc[n * 4 + 1] = g; Cc[n * 4 + 2] = b; Cc[n * 4 + 3] = size; n++; },
    end() { geo.setDrawRange(0, n); aP.needsUpdate = aC.needsUpdate = true; },
  };
}

// ── grit: small dark lit specks (brick chips, lapilli, grit) at the scale of the camera; normal blending ─────────
const GRIT_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 iCol;  // albedo rgb, size (m)
uniform float uPx; uniform float uMaxPx; uniform float uMinPx; uniform vec3 uKey; uniform vec3 uSky;
${FOG_GLSL}
varying vec3 vCol; varying float vA; varying vec4 vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = iCol.w * uPx / max(-mv.z, 0.1);
  vA = clamp(px / uMinPx, 0.0, 1.0);                           // sub-pixel specks fade instead of growing
  vCol = iCol.rgb * (uSky * 0.9 + uKey * 0.5);
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz; vec3 fr = wp - cameraPosition; float fd = length(fr); vec3 frd = fr / max(fd, 1e-3);
  vFog = vec4(wfogColor(frd), wfogAmount(cameraPosition, frd, fd));
  gl_PointSize = clamp(px, uMinPx, uMaxPx);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const GRIT_FS = /* glsl */`
#include <logdepthbuf_pars_fragment>
varying vec3 vCol; varying float vA; varying vec4 vFog;
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard;
  gl_FragColor = vec4(mix(vCol, vFog.rgb, vFog.a), vA * (1.0 - smoothstep(0.35, 1.0, r)));
}`;
// o: {count, maxPx, minPx, order}; push(x, y, z, r, g, b, size m) in the root's frame, per frame (begin/end)
export function makeGrit(ctx, o = {}) {
  const N = o.count ?? 800;
  const P = new Float32Array(N * 3), Cc = new Float32Array(N * 4);
  const geo = new THREE.BufferGeometry();
  const aP = new THREE.BufferAttribute(P, 3), aC = new THREE.BufferAttribute(Cc, 4);
  aP.setUsage(THREE.DynamicDrawUsage); aC.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aP); geo.setAttribute('iCol', aC); geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1); geo.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const H = +(new URLSearchParams(location.search).get('h') || 1080);
  const uniforms = {
    uPx: { value: H / (2 * Math.tan(20 * DEG)) }, uMaxPx: { value: (o.maxPx ?? 6) * H / 1080 }, uMinPx: { value: (o.minPx ?? 1.5) * H / 1080 },
    uKey: FXU.uKey, uSky: FXU.uSky,
    uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uSunDir: U.uSunDir, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff, uFogBase: U.uFogBase, uMirror: U.uMirror,
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: GRIT_VS, fragmentShader: GRIT_FS, transparent: true, depthWrite: false, blending: THREE.NormalBlending });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.userData.noQA = true; pts.renderOrder = o.order ?? 13; pts.name = o.name || 'fx.grit';
  let n = 0;
  return {
    mesh: pts, uniforms, N,
    begin() { n = 0; },
    get n() { return n; },
    push(x, y, z, r, g, b, size) { if (n >= N) return; P[n * 3] = x; P[n * 3 + 1] = y; P[n * 3 + 2] = z; Cc[n * 4] = r; Cc[n * 4 + 1] = g; Cc[n * 4 + 2] = b; Cc[n * 4 + 3] = size; n++; },
    end() { geo.setDrawRange(0, n); aP.needsUpdate = aC.needsUpdate = true; },
  };
}

// ── geometry helpers ────────────────────────────────────────────────────────────────────────────────────────────
// a grid that follows the terrain: centre (cx, cz) world, size w x l, rotated by rot (radians, about Y), y + lift
export function terrainGrid(ground, cx, cz, w, l, cell, rot = 0, lift = 0.06, oy = 0) {
  const nx = Math.max(2, Math.round(w / cell)), nz = Math.max(2, Math.round(l / cell));
  const geo = new THREE.PlaneGeometry(w, l, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const P = geo.attributes.position, cr = Math.cos(rot), sr = Math.sin(rot);
  const loc = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const lx = P.getX(i), lz = P.getZ(i);
    const x = cx + lx * cr + lz * sr, z = cz - lx * sr + lz * cr;
    loc[i * 2] = lx; loc[i * 2 + 1] = lz;
    P.setXYZ(i, x - cx, ground.height(x, z) + lift - oy, z - cz);
  }
  geo.setAttribute('aLocal', new THREE.BufferAttribute(loc, 2));
  geo.computeVertexNormals();
  return geo;
}

// footprint frame: heading (compass deg: the direction "forward" points), centre at (ax, az)
//   local (u = forward metres, v = right metres) <-> world (x, z)
export function frame(ax, az, heading) {
  const h = heading * DEG, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
  return {
    fx, fz, rx, rz,
    toWorld(u, v) { return [ax + fx * u + rx * v, az + fz * u + rz * v]; },
    toLocal(x, z) { const dx = x - ax, dz = z - az; return [dx * fx + dz * fz, dx * rx + dz * rz]; },
  };
}

// ground-motion shake: a band-limited signal with an envelope; returns displacement in metres
export function shakeSignal(t, seed, f0 = 2.0) {
  return fbm1(t * f0, seed) * 0.7 + vn(t * f0 * 2.7 + 5.3, seed + 9) * 0.3;
}
// quake envelope: rises over `rise` s from t0, holds for `hold`, then decays with time constant `tau`
export function quakeEnvelope(t, t0, rise = 1.2, hold = 4, tau = 2.5) {
  if (t < t0) return 0;
  const a = ease((t - t0) / rise);
  const d = t - t0 - rise - hold;
  return d > 0 ? a * Math.exp(-d / tau) : a;
}

// MeshStandardMaterial helper routed through the scene's fog patch
export function stdMat(ctx, o) { const m = new THREE.MeshStandardMaterial(o); return ctx.patch ? (ctx.patch(m) || m) : m; }
