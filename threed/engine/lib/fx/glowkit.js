// glowkit.js — shared emissive FX renderers of the Q7 pass (not a catalog module: no CATALOG export).
//   makeFire(ctx, o)        soft flame sprites: noise-shaped tongues with an orange-red gradient, premultiplied "over"
//                           blending (flames occlude each other instead of adding up to a white band), tone-mapped
//                           cores (the hottest base stays below white after ACES), height/phase variety from the caller.
//   makeGlowStreaks(ctx, o) velocity streaks for sparks and embers: a line from A to B (the motion in one shutter),
//                           at least `minPx` wide on screen with the energy kept (thin far streaks get dimmer, not fat).
// Both are filled per frame from pure functions of t (begin / push / end), positions in the parent root's local frame.
import * as THREE from 'three';
import { U, FOG_GLSL } from '../shared/env.js';

const LOGV = /* glsl */`#include <common>\n#include <logdepthbuf_pars_vertex>\n`;
const LOGF = /* glsl */`#include <common>\n#include <logdepthbuf_pars_fragment>\n`;
const FOGU = () => ({ uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uSunDir: U.uSunDir, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff, uFogBase: U.uFogBase, uMirror: U.uMirror });

// tileable 3-channel value noise (r: large licks, g: mid, b: fine)
let NOISE = null;
export function fireNoise() {
  if (NOISE) return NOISE;
  const N = 256, d = new Uint8Array(N * N * 4);
  const lat = (f, s) => { const a = new Float32Array(f * f); let x = s * 9301 + 49297; for (let i = 0; i < f * f; i++) { x = (x * 233280 + 12345) % 2147483647; a[i] = (x % 10007) / 10007; } return a; };
  const oct = [[4, 11, 0.6], [8, 23, 0.4]], oct2 = [[8, 31, 0.55], [16, 37, 0.45]], oct3 = [[16, 41, 0.5], [32, 43, 0.5]];
  const tabs = new Map();
  const vn = (u, v, f, s) => {
    const key = f * 1000 + s; let L = tabs.get(key); if (!L) { L = lat(f, s); tabs.set(key, L); }
    const x = u * f, y = v * f, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const g = (a, b) => L[((b % f + f) % f) * f + ((a % f + f) % f)];
    return (g(i, j) * (1 - sx) + g(i + 1, j) * sx) * (1 - sy) + (g(i, j + 1) * (1 - sx) + g(i + 1, j + 1) * sx) * sy;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, k = (y * N + x) * 4;
    let a = 0, b = 0, c = 0;
    for (const [f, s, w] of oct) a += w * vn(u, v, f, s);
    for (const [f, s, w] of oct2) b += w * vn(u, v, f, s);
    for (const [f, s, w] of oct3) c += w * vn(u, v, f, s);
    d[k] = Math.round(a * 255); d[k + 1] = Math.round(b * 255); d[k + 2] = Math.round(c * 255); d[k + 3] = 255;
  }
  NOISE = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  NOISE.wrapS = NOISE.wrapT = THREE.RepeatWrapping; NOISE.magFilter = THREE.LinearFilter; NOISE.minFilter = THREE.LinearMipmapLinearFilter;
  NOISE.generateMipmaps = true; NOISE.colorSpace = THREE.NoColorSpace; NOISE.needsUpdate = true; NOISE.userData.keep = true;
  return NOISE;
}

// ── flames ───────────────────────────────────────────────────────────────────────────────────────────────────────
const FIRE_VS = LOGV + /* glsl */`
attribute vec4 iA;   // base xyz (world), height
attribute vec4 iB;   // width, phase, intensity, temperature (0 smouldering red .. 1 hot)
attribute float iL;  // lean (m of tip offset along the wind per m of height)
uniform vec2 uWind; uniform float uNudge;
varying vec2 vUv; varying float vPh; varying float vI; varying float vT; varying vec3 vW;
void main(){
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float k = smoothstep(0.45, 0.9, -normalize(iA.xyz - cameraPosition).y);        // from high above: tilt toward the lens
  vec3 side = normalize(mix(normalize(vec3(camR.x, 0.0, camR.z) + vec3(1e-4, 0.0, 0.0)), camR, k));
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), camU, k * 0.55));
  float y = position.y + 0.5;
  vec3 w = iA.xyz + side * position.x * iB.x * (1.0 + 0.25 * y) + up * y * iA.w + vec3(uWind.x, 0.0, uWind.y) * iL * y * y * iA.w;
  w += normalize(cameraPosition - w) * uNudge;
  vUv = vec2(position.x + 0.5, y); vPh = iB.y; vI = iB.z; vT = iB.w; vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  if (iB.z < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FIRE_FS = LOGF + FOG_GLSL + /* glsl */`
uniform sampler2D uNoise; uniform float uTime, uHDR, uOp, uFogK, uFar;
varying vec2 vUv; varying float vPh; varying float vI; varying float vT; varying vec3 vW;
void main(){
  #include <logdepthbuf_fragment>
  float t = uTime + vPh * 17.0;
  vec2 uv = vUv;
  float n1 = texture2D(uNoise, vec2(uv.x * 0.55 + vPh * 3.7, uv.y * 0.45 - t * 0.62)).r;
  float n2 = texture2D(uNoise, vec2(uv.x * 1.3 - vPh * 1.9, uv.y * 1.05 - t * 1.35)).g;
  float n3 = texture2D(uNoise, vec2(uv.x * 2.6 + vPh * 5.3, uv.y * 2.2 - t * 2.6)).b;
  float x = (uv.x - 0.5) * 2.0;
  x += ((n1 - 0.5) * 1.25 + (n2 - 0.5) * 0.45) * uv.y;                             // licks sway more toward the tip
  float wdt = mix(0.92, 0.16, pow(uv.y, 0.75));
  float body = 1.0 - smoothstep(0.35, 1.0, abs(x) / wdt);
  float brk = n1 * 0.45 + n2 * 0.35 + n3 * 0.2;
  float d = body * (1.2 - uv.y) - (1.0 - brk) * (0.25 + 0.95 * uv.y);
  float m = smoothstep(0.0, 0.3, d) * smoothstep(0.0, 0.07, uv.y);
  if (m < 0.004) discard;
  float T = clamp(m * (1.15 - uv.y * 0.85) * (0.55 + 0.6 * vT) + (n3 - 0.5) * 0.12, 0.0, 1.0);
  // linear HDR palette chosen for the ACES grade: deep red rims, orange body, a small yellow core (never white)
  vec3 c = mix(vec3(0.42, 0.025, 0.0), vec3(1.35, 0.16, 0.01), smoothstep(0.04, 0.38, T));
  c = mix(c, vec3(1.9, 0.48, 0.05), smoothstep(0.38, 0.72, T));
  c = mix(c, vec3(2.3, 0.95, 0.22), smoothstep(0.78, 1.0, T));
  float a = clamp(m * uOp * (0.35 + 0.65 * (1.0 - uv.y)) * min(vI, 1.0), 0.0, 1.0);
  vec3 fr = vW - cameraPosition; float fd = length(fr);
  // far fire fronts stay readable: a fire line at 200-400 m is a bright orange glow line through the haze, not a smudge
  float db = 1.0 + clamp((fd - 70.0) / 160.0, 0.0, 1.6) * uFar;
  vec3 emit = c * uHDR * vI * m * db;
  float fa = wfogAmount(cameraPosition, fr / max(fd, 1e-3), fd) * uFogK;
  emit = mix(emit, wfogColor(fr / max(fd, 1e-3)) * a, fa);
  gl_FragColor = vec4(emit, a);
}`;
export function makeFire(ctx, o = {}) {
  const N = o.count ?? 1000;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.setAttribute('position', base.attributes.position);
  const A = new Float32Array(N * 4), B = new Float32Array(N * 4), Lk = new Float32Array(N);
  const sA = new Float32Array(N * 4), sB = new Float32Array(N * 4), sL = new Float32Array(N);
  const aA = new THREE.InstancedBufferAttribute(sA, 4), aB = new THREE.InstancedBufferAttribute(sB, 4), aL = new THREE.InstancedBufferAttribute(sL, 1);
  for (const a of [aA, aB, aL]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iA', aA); geo.setAttribute('iB', aB); geo.setAttribute('iL', aL); geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const uniforms = { uNoise: { value: fireNoise() }, uTime: { value: 0 }, uHDR: { value: o.hdr ?? 1 }, uOp: { value: o.opacity ?? 0.62 }, uFogK: { value: o.fog ?? 1 }, uWind: { value: new THREE.Vector2(...(o.wind || [0, 0])) }, uNudge: { value: o.nudge ?? 0 }, uFar: { value: o.far ?? 1 }, ...FOGU() };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: FIRE_VS, fragmentShader: FIRE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.userData.noQA = true; mesh.renderOrder = o.order ?? 13; mesh.name = o.name || 'fx.fire';
  mesh.matrixAutoUpdate = false; mesh.onBeforeRender = () => { mesh.matrixWorld.identity(); };
  const ord = new Uint32Array(N), dep = new Float32Array(N);
  let n = 0;
  return {
    mesh, uniforms, N,
    begin(t) { n = 0; uniforms.uTime.value = t; },
    get n() { return n; },
    // x, y, z: base (root-local), h: height, w: width, phase 0..1, inten 0..1.5, temp 0..1, lean (wind tilt)
    push(x, y, z, h, w, phase, inten, temp = 0.5, lean = 0) {
      if (n >= N || !(inten > 0.003) || !(h > 0.05)) return;
      const k = n * 4; A[k] = x; A[k + 1] = y; A[k + 2] = z; A[k + 3] = h; B[k] = w; B[k + 1] = phase; B[k + 2] = inten; B[k + 3] = temp; Lk[n] = lean; n++;
    },
    // camera: sorts back to front (the "over" blend needs it); wind: [x, z] unit-ish vector the tips lean toward
    end(camera, wind) {
      const root = mesh.parent;
      let ox = 0, oy = 0, oz = 0;
      if (root) { root.updateMatrixWorld(); const e = root.matrixWorld.elements; ox = e[12]; oy = e[13]; oz = e[14]; }
      if (wind) uniforms.uWind.value.set(wind[0], wind[1]);
      for (let i = 0; i < n; i++) ord[i] = i;
      if (camera) {
        const cp = camera.position;
        for (let i = 0; i < n; i++) { const k = i * 4; dep[i] = (A[k] + ox - cp.x) ** 2 + (A[k + 1] + oy + A[k + 3] * 0.4 - cp.y) ** 2 + (A[k + 2] + oz - cp.z) ** 2; }
        const sub = ord.subarray(0, n); sub.sort((a, b) => dep[b] - dep[a]);
      }
      for (let j = 0; j < n; j++) {
        const s = ord[j] * 4, d = j * 4;
        sA[d] = A[s] + ox; sA[d + 1] = A[s + 1] + oy; sA[d + 2] = A[s + 2] + oz; sA[d + 3] = A[s + 3];
        sB[d] = B[s]; sB[d + 1] = B[s + 1]; sB[d + 2] = B[s + 2]; sB[d + 3] = B[s + 3]; sL[j] = Lk[ord[j]];
      }
      geo.instanceCount = n; aA.needsUpdate = aB.needsUpdate = aL.needsUpdate = true;
    },
  };
}

// ── glow streaks (sparks, embers) ────────────────────────────────────────────────────────────────────────────────
const STREAK_VS = LOGV + /* glsl */`
attribute vec3 iA; attribute vec3 iB; attribute vec4 iC;   // rgb (HDR), width (m)
uniform float uPx, uMinPx, uMinK;
varying vec3 vCol; varying vec2 vQ; varying float vFade;
${FOG_GLSL}
void main(){
  float along = position.y + 0.5, acr = position.x * 2.0;
  vec3 ax = iB - iA; float L = length(ax); vec3 d = L > 1e-5 ? ax / L : vec3(0.0, 1.0, 0.0);
  vec3 mid = mix(iA, iB, 0.5);
  float dist = length(cameraPosition - mid);
  float wpx = dist * uPx * uMinPx;                               // metres of one minimum-width line at that distance
  float w = max(iC.w, wpx);
  float k = clamp(iC.w / w, uMinK, 1.0);                          // energy kept when widened to the minimum
  float Le = max(L, w);                                           // never shorter than it is wide (a dot)
  vec3 P = mid + d * (along - 0.5) * (Le + w);
  vec3 toC = normalize(cameraPosition - P);
  vec3 sd = cross(d, toC); float sl = length(sd); sd = sl > 1e-5 ? sd / sl : vec3(1.0, 0.0, 0.0);
  P += sd * acr * w;
  vQ = vec2(acr, (along - 0.5) * 2.0 * (Le + w) / max(Le + w * 0.5, 1e-4));
  vCol = iC.rgb * k * min(1.0, L / max(w, 1e-4) * 0.35 + 0.65);
  vec3 fr = P - cameraPosition; float fd = length(fr);
  vFade = 1.0 - wfogAmount(cameraPosition, fr / max(fd, 1e-3), fd);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  if (dot(iC.rgb, vec3(1.0)) < 1e-4) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
}`;
const STREAK_FS = LOGF + /* glsl */`
varying vec3 vCol; varying vec2 vQ; varying float vFade;
void main(){
  #include <logdepthbuf_fragment>
  float a = exp(-vQ.x * vQ.x * 3.2) * (1.0 - smoothstep(0.55, 1.0, abs(vQ.y)));
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * a * vFade, 1.0);
}`;
export function makeGlowStreaks(ctx, o = {}) {
  const N = o.count ?? 1000;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.setAttribute('position', base.attributes.position);
  const A = new Float32Array(N * 3), B = new Float32Array(N * 3), C = new Float32Array(N * 4);
  const aA = new THREE.InstancedBufferAttribute(A, 3), aB = new THREE.InstancedBufferAttribute(B, 3), aC = new THREE.InstancedBufferAttribute(C, 4);
  for (const a of [aA, aB, aC]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iA', aA); geo.setAttribute('iB', aB); geo.setAttribute('iC', aC); geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const H = +(new URLSearchParams(location.search).get('h') || 1080);
  const uniforms = { uPx: { value: 2 * Math.tan(20 * Math.PI / 180) / H }, uMinPx: { value: (o.minPx ?? 1.3) * H / 1080 }, uMinK: { value: o.minK ?? 0.3 }, ...FOGU() };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: STREAK_VS, fragmentShader: STREAK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.userData.noQA = true; mesh.renderOrder = o.order ?? 15; mesh.name = o.name || 'fx.streaks';
  mesh.matrixAutoUpdate = false; mesh.onBeforeRender = () => { mesh.matrixWorld.identity(); };
  let n = 0;
  return {
    mesh, uniforms, N,
    begin() { n = 0; },
    get n() { return n; },
    // a -> b in the root's local frame (b = the head), rgb HDR, width m
    push(ax, ay, az, bx, by, bz, r, g, b, w) {
      if (n >= N || !(r + g + b > 1e-4)) return;
      const k3 = n * 3, k4 = n * 4;
      A[k3] = ax; A[k3 + 1] = ay; A[k3 + 2] = az; B[k3] = bx; B[k3 + 1] = by; B[k3 + 2] = bz;
      C[k4] = r; C[k4 + 1] = g; C[k4 + 2] = b; C[k4 + 3] = w; n++;
    },
    end(camera) {
      const root = mesh.parent;
      if (root) {
        root.updateMatrixWorld(); const e = root.matrixWorld.elements;
        for (let i = 0; i < n; i++) { const k = i * 3; for (const X of [A, B]) { const x = X[k], y = X[k + 1], z = X[k + 2]; X[k] = e[0] * x + e[4] * y + e[8] * z + e[12]; X[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; X[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; } }
      }
      if (camera) uniforms.uPx.value = 2 * Math.tan((camera.fov || 40) * Math.PI / 360) / H;
      geo.instanceCount = n; aA.needsUpdate = aB.needsUpdate = aC.needsUpdate = true;
    },
  };
}
