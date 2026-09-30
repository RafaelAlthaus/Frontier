// w_common.js — shared toolkit of the weather & water FX (D2a). Not a module of the catalog (no CATALOG export).
//   Puffs     instanced camera-facing soft volumes (dust, powder snow, spray, mist): lit by the scene's own sun and
//             sky lights, height-fogged like everything else, sorted back to front; the caller fills them per frame
//             from a pure function of t.
//   Streaks   instanced velocity-stretched quads (rain, spray lines, sparks).
//   glowTex / glowSprite, rad textures, props (plank, sheet, car, conifer, palm), the mannequin helper.
// Every shader includes the log-depth chunks (the renderer uses a logarithmic depth buffer) and the shared fog.
import * as THREE from 'three';
import { U, FOG_GLSL } from '../shared/env.js';
import { rng, clamp, lerp, smooth } from '../shared/util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BILLOW_GLSL, billowUniforms, softDepth } from './billow.js';

export { rng, clamp, lerp, smooth, mergeGeometries, U };
export const TAU = Math.PI * 2, DEG = Math.PI / 180;
export const sstep = (a, b, x) => smooth((x - a) / (b - a));
export const gauss = (x) => Math.exp(-x * x);
export const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// 1D value noise (smooth, deterministic)
export function vnoise(x, seed = 0) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash1(i + seed * 17.13), hash1(i + 1 + seed * 17.13), u) * 2 - 1; }
export const fbm1 = (x, seed = 0) => vnoise(x, seed) * 0.6 + vnoise(x * 2.13 + 5.1, seed) * 0.28 + vnoise(x * 4.37 + 9.7, seed) * 0.12;

export const LOGV = /* glsl */`#include <common>\n#include <logdepthbuf_pars_vertex>\n`;
export const LOGF = /* glsl */`#include <common>\n#include <logdepthbuf_pars_fragment>\n`;
export const FOG_U = () => ({ uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uSunDir: U.uSunDir, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff, uFogBase: U.uFogBase, uMirror: U.uMirror });
export const FOGF = FOG_GLSL + /* glsl */`
vec3 applyFog(vec3 col, vec3 wp){ vec3 fr = wp - cameraPosition; float fd = length(fr); vec3 frd = fr / max(fd, 1e-3);
  return mix(col, wfogColor(frd), wfogAmount(cameraPosition, frd, fd)); }
`;
export const NOISE_GLSL = /* glsl */`
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn3(p); p = p * 2.02 + vec3(17.1, 3.3, 9.7); a *= 0.5; } return s; }
float fbm3l(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * vn3(p); p = p * 2.03 + vec3(7.1, 13.3, 1.7); a *= 0.5; } return s / 0.875; }
`;

// ── scene light probe: the look's key light and hemisphere (fixed per scene), skipping our own flash lights ──────
export function lightsOf(ctx) {
  let key = null, hemi = null;
  const find = () => {
    if (key && hemi) return;
    (ctx.world3 || ctx.scene).traverse((o) => {
      if (o.userData?.fx) return;
      if (!key && o.isDirectionalLight) key = o;
      if (!hemi && o.isHemisphereLight) hemi = o;
    });
  };
  const out = { sun: new THREE.Color(1, 1, 1), sky: new THREE.Color(0.5, 0.55, 0.6), gnd: new THREE.Color(0.2, 0.18, 0.16), dir: new THREE.Vector3(0, 1, 0) };
  return () => {
    find();
    if (key) { out.sun.copy(key.color).multiplyScalar(key.intensity); out.dir.copy(key.position).sub(key.target.position).normalize(); }
    if (hemi) { out.sky.copy(hemi.color).multiplyScalar(hemi.intensity); out.gnd.copy(hemi.groundColor).multiplyScalar(hemi.intensity); }
    return out;
  };
}

// ── textures ─────────────────────────────────────────────────────────────────────────────────────────────────────
const TEXC = {};
function canvasTex(w, h, draw, srgb = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.userData.keep = true; return t;
}
// 2x2 atlas of soft billowy blobs (alpha = density, rgb = self-shadowed shading toward the top-left light)
export function puffTex() {
  if (TEXC.puff) return TEXC.puff;
  const S = 128, N = 256;
  TEXC.puff = canvasTex(N, N, (g) => {
    const img = g.createImageData(N, N), d = img.data, r = rng(91);
    for (let cell = 0; cell < 4; cell++) {
      const ox = (cell % 2) * S, oy = Math.floor(cell / 2) * S;
      const blobs = []; for (let k = 0; k < 9; k++) blobs.push([0.5 + (r() - 0.5) * 0.42, 0.5 + (r() - 0.5) * 0.42, 0.14 + r() * 0.16]);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S, v = (y + 0.5) / S;
        let den = 0, lit = 0;
        for (const [bx, by, br] of blobs) {
          const dd = Math.hypot(u - bx, v - by) / br; if (dd < 1) { const w = (1 - dd * dd); den += w * w; lit += w * w * clamp(0.5 + ((bx - u) * 0.7 + (by - v) * 0.9) / br * 0.9, 0, 1.2); }
        }
        const nz = 0.75 + 0.25 * Math.sin(u * 37 + cell * 3) * Math.sin(v * 41 + cell);
        const edge = clamp(1 - Math.hypot(u - 0.5, v - 0.5) / 0.5, 0, 1);
        const a = clamp(den * 0.9 * nz, 0, 1) * smooth(edge * 1.6);
        const sh = den > 1e-4 ? clamp(0.55 + 0.45 * lit / den, 0, 1) : 0.8;
        const i = ((oy + y) * N + ox + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = Math.round(sh * 255); d[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
  });
  TEXC.puff.generateMipmaps = true; TEXC.puff.minFilter = THREE.LinearMipmapLinearFilter;
  return TEXC.puff;
}
export function glowTex() {
  if (TEXC.glow) return TEXC.glow;
  TEXC.glow = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  return TEXC.glow;
}
export function blobTex() {
  if (TEXC.blob) return TEXC.blob;
  TEXC.blob = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  return TEXC.blob;
}

// ── Puffs ────────────────────────────────────────────────────────────────────────────────────────────────────────
// n instanced billboards. set(i, x, y, z, size, alpha, rot, r, g, b, atlas[, wisp, occ, seed]) in the root's local
// space (size = diameter), then commit(camera). o: { emissive (0..), back (forward scatter), dark (depth of the billow's
// own crevice shading), soft (ground fade m), softY, additive, wisp (default 0 crisp billow .. 1 torn haze), softK }
// Q4: the puffs are the lit cauliflower billows of billow.js (bump normals, crevice occlusion, detail boiling in the
// world time, a silver lining when backlit, soft-depth fade into geometry); `occ` (0..1) is the cloud-scale shadow a
// module can give each billow (its dark core), `wisp` how torn it is, `seed` picks one of 16 atlas variants (default:
// from the slot i, which is stable per particle).
export class Puffs {
  constructor(ctx, n, o = {}) {
    this.n = n; this.ctx = ctx; this.lights = lightsOf(ctx); this.wisp = o.wisp ?? 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    this.P = new Float32Array(n * 3); this.Q = new Float32Array(n * 4); this.C = new Float32Array(n * 3); this.X = new Float32Array(n * 4);
    this.sP = new Float32Array(n * 3); this.sQ = new Float32Array(n * 4); this.sC = new Float32Array(n * 3); this.sX = new Float32Array(n * 4);
    this.aP = new THREE.InstancedBufferAttribute(this.sP, 3); this.aQ = new THREE.InstancedBufferAttribute(this.sQ, 4); this.aC = new THREE.InstancedBufferAttribute(this.sC, 3); this.aX = new THREE.InstancedBufferAttribute(this.sX, 4);
    for (const a of [this.aP, this.aQ, this.aC, this.aX]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aP); g.setAttribute('iP', this.aQ); g.setAttribute('iTint', this.aC); g.setAttribute('iX', this.aX);
    for (let i = 0; i < n; i++) { this.X[i * 4 + 1] = 1; this.X[i * 4 + 2] = (i * 0.6180339887) % 1; }
    g.instanceCount = n; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.U = {
      ...billowUniforms(U.uTime), uSun: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uGnd: { value: new THREE.Color() },
      uLDir: { value: new THREE.Vector3(0, 1, 0) }, uBack: { value: o.back ?? 0.6 }, uEmis: { value: o.emissive ?? 0 }, uDark: { value: o.dark ?? 0.45 },
      uFlash: { value: new THREE.Color(0, 0, 0) }, uSoftY: { value: o.softY ?? -1e9 }, uSoft: { value: o.soft ?? 0 }, uSoftK: { value: o.softK ?? 0.3 }, ...FOG_U(),
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: LOGV + FOG_GLSL + /* glsl */`
        attribute vec3 iPos; attribute vec4 iP; attribute vec3 iTint; attribute vec4 iX;
        varying vec2 vQ; varying vec2 vCS; varying float vA; varying vec3 vTint; varying vec3 vW; varying vec3 vR; varying vec3 vUp; varying vec3 vF;
        varying float vCell; varying vec3 vX; varying float vDepth; varying float vSize; varying vec4 vFog;
        void main(){
          vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 camF = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
          vec3 c = (modelMatrix * vec4(iPos, 1.0)).xyz;
          vec2 q = position.xy * 2.0;
          vec3 wp = c + (camR * q.x + camU * q.y) * (iP.x * 0.5);
          vQ = q; vCS = vec2(cos(iP.z), sin(iP.z)); vA = iP.y; vTint = iTint; vW = wp; vR = camR; vUp = camU; vF = camF;
          vCell = mod(floor(iP.w + 0.5) + 4.0 * floor(fract(iX.z * 7.123) * 4.0), 16.0);
          vX = iX.xyz; vSize = iP.x * 0.5;
          vec4 mv = viewMatrix * vec4(wp, 1.0); vDepth = -mv.z;
          vec3 fr = c - cameraPosition; float fd = length(fr); vec3 frd = fr / max(fd, 1e-3);
          vFog = vec4(wfogColor(frd), wfogAmount(cameraPosition, frd, fd));
          gl_Position = projectionMatrix * mv;
          if (iP.y < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOGF + /* glsl */`
        uniform vec3 uSun, uSky, uGnd, uLDir, uFlash; uniform float uBack, uEmis, uDark, uSoftY, uSoft, uSoftK;
        ${BILLOW_GLSL}
        varying vec2 vQ; varying vec2 vCS; varying float vA; varying vec3 vTint; varying vec3 vW; varying vec3 vR; varying vec3 vUp; varying vec3 vF;
        varying float vCell; varying vec3 vX; varying float vDepth; varying float vSize; varying vec4 vFog;
        void main(){
          #include <logdepthbuf_fragment>
          float wisp = vX.x, occ = vX.y;
          vec4 b = billowTex(vQ, vCS, vCell, vX.z, wisp);
          float a = b.x * vA;
          if (uSoft > 0.0) a *= smoothstep(uSoftY, uSoftY + uSoft, vW.y);
          if (a < 0.004) discard;
          a *= billowSoftDepth(vDepth, vSize * uSoftK);
          if (a < 0.004) discard;
          vec3 N = normalize(vR * b.y + vUp * b.z + vF * sqrt(max(1.0 - dot(b.yz, b.yz), 0.02)));
          vec3 V = normalize(vW - cameraPosition);
          float ao = mix(1.0, b.w, clamp(uDark * 1.6, 0.0, 1.0));
          vec3 col = billowLight(vTint, N, uLDir, V, b.x, ao, occ, wisp, uSun * 0.62, uSky * 1.05, uGnd * 1.05);
          float fwd = pow(max(dot(V, uLDir), 0.0), 5.0);
          col += vTint * uSun * (uBack * fwd * (1.0 - b.x * 0.5) * 0.45 * occ);
          col += vTint * uFlash * (0.6 + 0.4 * clamp(dot(N, uLDir) * 0.5 + 0.5, 0.0, 1.0)) + vTint * uEmis;
          col = mix(col, vFog.rgb, vFog.a);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = o.order ?? 12;
    this.mesh.userData.noQA = true; this.mesh.name = o.name || 'fxPuffs';
    this.mesh.onBeforeRender = (renderer) => softDepth(renderer, this.U);
    this.order = new Uint32Array(n); this.dist = new Float32Array(n);
    this.sort = o.sort !== false;
  }
  set(i, x, y, z, size, alpha, rot = 0, r = 1, g = 1, b = 1, atlas = 0, wisp = this.wisp, occ = 1, seed = -1) {
    const P = this.P, Q = this.Q, C = this.C, X = this.X;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    Q[i * 4] = size; Q[i * 4 + 1] = alpha; Q[i * 4 + 2] = rot; Q[i * 4 + 3] = atlas;
    C[i * 3] = r; C[i * 3 + 1] = g; C[i * 3 + 2] = b;
    X[i * 4] = wisp; X[i * 4 + 1] = occ; if (seed >= 0) X[i * 4 + 2] = seed;
  }
  hide(i) { this.Q[i * 4 + 1] = 0; this.Q[i * 4] = 0; }
  commit(camera, flash) {
    const L = this.lights();
    this.U.uSun.value.copy(L.sun); this.U.uSky.value.copy(L.sky); this.U.uGnd.value.copy(L.gnd); this.U.uLDir.value.copy(L.dir);
    if (flash) this.U.uFlash.value.copy(flash); else this.U.uFlash.value.setRGB(0, 0, 0);
    const n = this.n, P = this.P, Q = this.Q, C = this.C, X = this.X, sP = this.sP, sQ = this.sQ, sC = this.sC, sX = this.sX, ord = this.order;
    for (let i = 0; i < n; i++) ord[i] = i;
    if (this.sort && camera) {
      const m = this.mesh.matrixWorld.elements, cp = camera.position;
      const D = this.dist;
      for (let i = 0; i < n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        D[i] = Q[i * 4 + 1] > 0.002 ? (wx - cp.x) ** 2 + (wy - cp.y) ** 2 + (wz - cp.z) ** 2 : -1;
      }
      ord.sort((a, b) => D[b] - D[a]);
    }
    for (let k = 0; k < n; k++) {
      const i = ord[k];
      sP[k * 3] = P[i * 3]; sP[k * 3 + 1] = P[i * 3 + 1]; sP[k * 3 + 2] = P[i * 3 + 2];
      sQ[k * 4] = Q[i * 4]; sQ[k * 4 + 1] = Q[i * 4 + 1]; sQ[k * 4 + 2] = Q[i * 4 + 2]; sQ[k * 4 + 3] = Q[i * 4 + 3];
      sC[k * 3] = C[i * 3]; sC[k * 3 + 1] = C[i * 3 + 1]; sC[k * 3 + 2] = C[i * 3 + 2];
      sX[k * 4] = X[i * 4]; sX[k * 4 + 1] = X[i * 4 + 1]; sX[k * 4 + 2] = X[i * 4 + 2]; sX[k * 4 + 3] = X[i * 4 + 3];
    }
    this.aP.needsUpdate = this.aQ.needsUpdate = this.aC.needsUpdate = this.aX.needsUpdate = true;
  }
}

// ── Streaks: velocity-stretched quads (rain, spray), filled per frame like Puffs ─────────────────────────────────
export class Streaks {
  constructor(ctx, n, o = {}) {
    this.n = n; this.lights = lightsOf(ctx);
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.setAttribute('position', quad.attributes.position);
    this.A = new Float32Array(n * 3); this.B = new Float32Array(n * 3); this.W = new Float32Array(n * 2);
    this.aA = new THREE.InstancedBufferAttribute(this.A, 3); this.aB = new THREE.InstancedBufferAttribute(this.B, 3); this.aW = new THREE.InstancedBufferAttribute(this.W, 2);
    for (const a of [this.aA, this.aB, this.aW]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.aA); g.setAttribute('iB', this.aB); g.setAttribute('iW', this.aW);
    g.instanceCount = n; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.U = { uCol: { value: new THREE.Color(...(o.color || [0.8, 0.82, 0.86])) }, uLit: { value: new THREE.Color(1, 1, 1) }, uAdd: { value: o.additive ? 1 : 0 }, ...FOG_U() };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: LOGV + /* glsl */`
        attribute vec3 iA; attribute vec3 iB; attribute vec2 iW; varying float vA; varying float vX; varying vec3 vW;
        void main(){
          vec3 a = (modelMatrix * vec4(iA, 1.0)).xyz, b = (modelMatrix * vec4(iB, 1.0)).xyz;
          vec3 wp = mix(a, b, position.y);
          vec3 ax = b - a; float L = length(ax); ax = L > 1e-5 ? ax / L : vec3(0.0, 1.0, 0.0);
          vec3 toC = normalize(cameraPosition - wp);
          vec3 sd = cross(ax, toC); float sl = length(sd); sd = sl > 1e-5 ? sd / sl : vec3(1.0, 0.0, 0.0);
          wp += sd * position.x * iW.x;
          vW = wp; vX = position.x * 2.0; vA = iW.y * (0.35 + 0.65 * smoothstep(0.0, 0.25, position.y)) ;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          if (iW.y < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOGF + FOGF + /* glsl */`
        uniform vec3 uCol, uLit; uniform float uAdd; varying float vA; varying float vX; varying vec3 vW;
        void main(){
          #include <logdepthbuf_fragment>
          float a = vA * (1.0 - vX * vX);
          if (a < 0.003) discard;
          vec3 c = uCol * uLit;
          if (uAdd < 0.5) c = applyFog(c, vW);
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = o.order ?? 11; this.mesh.userData.noQA = true;
  }
  set(i, ax, ay, az, bx, by, bz, w, a) {
    const A = this.A, B = this.B, W = this.W;
    A[i * 3] = ax; A[i * 3 + 1] = ay; A[i * 3 + 2] = az; B[i * 3] = bx; B[i * 3 + 1] = by; B[i * 3 + 2] = bz; W[i * 2] = w; W[i * 2 + 1] = a;
  }
  hide(i) { this.W[i * 2 + 1] = 0; }
  commit(lit) {
    if (lit) this.U.uLit.value.copy(lit); else { const L = this.lights(); this.U.uLit.value.copy(L.sky).multiplyScalar(0.9).add(L.sun.clone().multiplyScalar(0.25)); }
    this.aA.needsUpdate = this.aB.needsUpdate = this.aW.needsUpdate = true;
  }
}

// ── glow sprite (additive, HDR) ──────────────────────────────────────────────────────────────────────────────────
export function glowSprite(color = [1, 1, 1], size = 10) {
  const m = new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(...color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const s = new THREE.Sprite(m); s.scale.set(size, size, 1); s.userData.noQA = true; s.renderOrder = 20; s.frustumCulled = false;
  return s;
}

// ── materials ────────────────────────────────────────────────────────────────────────────────────────────────────
export function stdMat(ctx, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color ?? 0x888888), roughness: o.roughness ?? 0.8, metalness: o.metalness ?? 0, side: o.side ?? THREE.FrontSide, flatShading: !!o.flat, vertexColors: !!o.vertexColors });
  if (o.emissive != null) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
  return ctx.patch ? ctx.patch(m) : m;
}

// ── props (geometry, local origin at the base centre) ────────────────────────────────────────────────────────────
const GEO = {};
export function plankGeo() { return GEO.plank || (GEO.plank = new THREE.BoxGeometry(0.22, 0.05, 3.2)); }
export function sheetGeo() {
  if (GEO.sheet) return GEO.sheet;
  const g = new THREE.PlaneGeometry(2.4, 1.0, 12, 1);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, 0.03 * Math.sin(p.getX(i) * 13));      // corrugation
  g.computeVertexNormals(); return (GEO.sheet = g);
}
export function carGeo() {
  if (GEO.car) return GEO.car;
  const body = new THREE.BoxGeometry(1.8, 0.7, 4.3).translate(0, 0.62, 0);
  const cab = new THREE.BoxGeometry(1.6, 0.55, 2.2).translate(0, 1.22, -0.2);
  const pos = cab.attributes.position; for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 1.3) { pos.setX(i, pos.getX(i) * 0.88); pos.setZ(i, pos.getZ(i) * 0.8 - 0.05); }
  const wheels = [];
  for (const [x, z] of [[0.82, 1.35], [-0.82, 1.35], [0.82, -1.35], [-0.82, -1.35]]) wheels.push(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12).rotateZ(Math.PI / 2).translate(x, 0.34, z));
  const g = mergeGeometries([body.toNonIndexed(), cab.toNonIndexed(), ...wheels.map((w) => w.toNonIndexed())]);
  // vertex colours: body paint vs dark glass/tyres (set by the caller's material colour * this mask)
  const c = new Float32Array(g.attributes.position.count * 3);
  const nb = body.toNonIndexed().attributes.position.count, nc = cab.toNonIndexed().attributes.position.count;
  for (let i = 0; i < g.attributes.position.count; i++) { const k = i < nb ? 1 : i < nb + nc ? 0.28 : 0.08; c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return (GEO.car = g);
}
// a conifer (height 1, scaled by the caller). Q2: a spruce of drooping, star-edged whorls of dark needles, lighter at the
// tips and darker inside and underneath, on a thin trunk, smooth normals. (The old stacked cones read as flat-shaded
// cartoon cones and, at three times the nature library's needle brightness, as pale teal ghosts in haze.)
export function coniferGeo() {
  if (GEO.conifer) return GEO.conifer;
  const R = rng(77), pos = [], col = [], idx = [];
  const add = (x, y, z, k) => { pos.push(x, y, z); col.push(0.05 * k, 0.088 * k, 0.055 * k); return pos.length / 3 - 1; };
  const W = 9, ARMS = 7;
  for (let w = 0; w < W; w++) {
    const f = w / (W - 1), y0 = 0.17 + f * 0.76, rr0 = (0.2 * (1 - f) + 0.022) * (0.9 + R() * 0.2), droop = 0.055 + 0.05 * (1 - f);
    const apex = add(0, y0 + 0.07, 0, 0.9), ring = [], rot = R() * Math.PI;
    for (let k = 0; k < ARMS * 2; k++) {
      const a = rot + k / (ARMS * 2) * TAU, tip = k % 2 === 0, rr = tip ? rr0 * (0.85 + R() * 0.3) : rr0 * 0.45;
      ring.push(add(Math.cos(a) * rr, tip ? y0 - droop * (0.8 + R() * 0.4) : y0 - droop * 0.2, Math.sin(a) * rr, tip ? 1.3 + R() * 0.25 : 0.75));
    }
    for (let k = 0; k < ring.length; k++) idx.push(apex, ring[(k + 1) % ring.length], ring[k]);
    const under = add(0, y0 - droop * 0.9, 0, 0.3);
    for (let k = 0; k < ring.length; k++) idx.push(under, ring[k], ring[(k + 1) % ring.length]);
  }
  const top = add(0, 1.0, 0, 1.1);
  for (let k = 0; k < 5; k++) { const a = k / 5 * TAU, i = add(Math.cos(a) * 0.022, 0.88, Math.sin(a) * 0.022, 1), j = add(Math.cos(a + 1.2566) * 0.022, 0.88, Math.sin(a + 1.2566) * 0.022, 1); idx.push(top, j, i); }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); crown.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); crown.setIndex(idx);
  crown.computeVertexNormals();                                          // shared vertices: smooth, soft-edged whorls
  const trunk = new THREE.CylinderGeometry(0.012, 0.024, 0.3, 6).translate(0, 0.15, 0); trunk.deleteAttribute('uv');
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(new Array(trunk.attributes.position.count).fill([0.16, 0.12, 0.08]).flat(), 3));
  return (GEO.conifer = mergeGeometries([crown.toNonIndexed(), trunk.toNonIndexed()]));
}
export function trunkGeo() { return GEO.trunk || (GEO.trunk = new THREE.CylinderGeometry(0.018, 0.032, 1, 6).translate(0, 0.5, 0)); }

// ── the mannequin ("you"): the brand Witness (white, faceless, mustard scarf) or a plain white mannequin ─────────────
// returns { group, fig, pose(p), B (bones) }. p: rig pose keys (lean, turn, headX, lArmX/Y/Z, lElbow, lLeg, lKnee, ...)
export const BASE_POSE = { lArmZ: 0.07, rArmZ: -0.07, lElbow: -0.14, rElbow: -0.14, lLegY: 0.06, rLegY: -0.06, lLegZ: 0.015, rLegZ: -0.015, weapon: null, lShape: 'relaxed', rShape: 'relaxed' };
export async function mannequin(ctx, o = {}) {
  const C = await import('../human/cast.js');
  const def = o.plain ? { id: 'fx_plain', kit: 'witness', accessories: [] } : { id: 'witness', kit: 'witness' };
  const res = C.buildCharacter(def, ctx);
  const fig = res.fig;
  if (o.plain) fig.group.traverse((m) => { if (m.isMesh && /scarf|fringe/i.test(String(m.material?.name || m.name || ''))) m.visible = false; });
  fig.group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const pose = (p, gait) => { fig._apply({ ...BASE_POSE, ...p }, gait || null); fig.group.updateMatrixWorld(true); };
  pose({});
  return { group: fig.group, fig, pose, B: fig.rig.B, res };
}
export function bonePos(b, out = new THREE.Vector3()) { return b.getWorldPosition(out); }

// terrain-following soft contact shadow owned by an FX (the registry sees the name and skips its own)
export function contactBlob(ctx, w = 1, l = 1, a = 0.5) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: a, color: 0x000000 }));
  m.name = 'contactShadow'; m.renderOrder = 2; m.userData.noQA = true;
  m.material.map.colorSpace = THREE.NoColorSpace;
  // alphaMap-like: use the texture's alpha
  return m;
}

// ── params: spec entries may give FX params at the top level or under `params` (catalog defaults merged in) ──────
const RESERVED = new Set(['kind', 'at', 'pos', 'heading', 'index', 'seed', 'params', 'requested', 'tags', 'id']);
export function prm(item) {
  const P = { ...(item.params || {}) };
  for (const k of Object.keys(item)) if (!RESERVED.has(k) && item[k] !== undefined) P[k] = item[k];
  return P;
}
export const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);
