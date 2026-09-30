// billow.js — shared machinery for the lit dust / smoke / ash billows of lib/fx (Q4 quality pass, 26 Sep 2026).
// Not a module (no CATALOG). Both puff renderers use it: f_common.makePuffs (D2b) and w_common.Puffs (D2a).
//   atlas       4x4 cauliflower puffs (DataTexture, 1024^2): every cell is a hierarchy of spheres (a main lobe, lobes on
//               its rim, smaller lobes on theirs, a fourth level of grit-sized bumps) with torn edges.
//               R = density, G/B = the bump normal (x right, y up; 0.5 = flat), A = crevice occlusion (1 = open).
//   noise       tileable value-noise fbm (R, G two independent fields) for the fine detail that boils slowly in t.
//   softDepth   the scene depth after the opaque pass, blitted once per render pass from the bound framebuffer, so a
//               puff fades where it meets terrain or buildings (no hard intersection line). Falls back to off.
//   GLSL        billowTex(): density, normal, occlusion of one puff pixel (rotation, 16 variants, erosion, boil);
//               billowLight(): wrapped key light on the bump normal, crevice + cloud-scale self-shadow (dark core),
//               backlit silver lining on thin edges, sky/ground ambient; billowSoftDepth().
// Everything is deterministic: the textures are seeded, the boil is driven by the world time uniform.
import * as THREE from 'three';
import { makeNoise, clamp } from '../shared/util.js';

// ── atlas ────────────────────────────────────────────────────────────────────────────────────────────────────────
let ATLAS = null;
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function billowAtlas() {
  if (ATLAS) return ATLAS;
  const C = 256, N = C * 4, data = new Uint8Array(N * N * 4);
  const Hs = new Float64Array(C * C), Sd = new Float32Array(C * C), Hb = new Float32Array(C * C), tmp = new Float32Array(C * C);
  const nz = makeNoise(4242);
  for (let cell = 0; cell < 16; cell++) {
    const R = mulberry(9001 + cell * 7919);
    // the sphere hierarchy in cell units (-1..1), z = depth towards the viewer: every child sits ON its parent's
    // surface (front hemisphere and rim), so it bulges out of it; three levels below the main lobe
    const S = [];
    const r0 = 0.34 + R() * 0.06;
    S.push([(R() - 0.5) * 0.05, -0.02 + (R() - 0.5) * 0.05, 0, r0]);
    const kids = (p, n, rMin, rMax, reach, zMin) => {
      const out = [];
      for (let k = 0; k < n; k++) {
        // a direction on the parent's sphere: stratified azimuth, elevation towards the viewer (z) >= zMin
        const az = (k + R() * 0.7) / n * 6.2832 + R() * 0.4, ez = zMin + (1 - zMin) * Math.pow(R(), 1.25);
        const rr = Math.sqrt(Math.max(0, 1 - ez * ez)), dx = Math.cos(az) * rr, dy = Math.sin(az) * rr * 0.92;
        const r = p[3] * (rMin + R() * (rMax - rMin)), d = p[3] * reach;
        const c = [p[0] + dx * d, p[1] + dy * d, p[2] + ez * d, r];
        S.push(c); out.push(c);
      }
      return out;
    };
    // dense packing: the children cover their parent completely (no smooth parent surface shows)
    // lobes crisp, their bumps more embedded, the grit-sized bumps subtle: the big shapes read first
    const L1 = kids(S[0], 14 + Math.floor(R() * 5), 0.5, 0.68, 0.8, -0.15);
    const L2 = []; for (const p of L1) L2.push(...kids(p, 4 + Math.floor(R() * 2), 0.4, 0.55, 0.7, -0.05));
    for (const p of L2) kids(p, 3, 0.35, 0.5, 0.6, 0.1);
    // fit inside the cell with a transparent margin (mip levels bleed across cells otherwise)
    let ext = 0; for (const s of S) ext = Math.max(ext, Math.hypot(s[0], s[1]) + s[3]);
    const fit = Math.min(1, 0.9 / ext);
    for (const s of S) { s[0] *= fit; s[1] *= fit; s[2] *= fit; s[3] *= fit; }
    // rasterise: smooth max of the sphere heights (log-sum-exp, k = 0.02) + the signed coverage distance
    const K = 0.02;
    Hs.fill(0); Sd.fill(-1);
    for (const [cx, cy, cz, r] of S) {
      const x0 = Math.max(0, Math.floor(((cx - r) * 0.5 + 0.5) * C) - 1), x1 = Math.min(C - 1, Math.ceil(((cx + r) * 0.5 + 0.5) * C) + 1);
      const y0 = Math.max(0, Math.floor(((cy - r) * 0.5 + 0.5) * C) - 1), y1 = Math.min(C - 1, Math.ceil(((cy + r) * 0.5 + 0.5) * C) + 1);
      for (let y = y0; y <= y1; y++) {
        const v = (y + 0.5) / C * 2 - 1, dy = v - cy;
        for (let x = x0; x <= x1; x++) {
          const u = (x + 0.5) / C * 2 - 1, dx = u - cx, d2 = dx * dx + dy * dy, j = y * C + x;
          const sd = r - Math.sqrt(d2);
          if (sd > Sd[j]) Sd[j] = sd;
          if (d2 < r * r) Hs[j] += Math.exp((cz + Math.sqrt(r * r - d2) - 0.5) / K);
        }
      }
    }
    const ox = (cell % 4) * C, oy = Math.floor(cell / 4) * C, ph = cell * 13.7;
    for (let j = 0; j < C * C; j++) {
      const x = j % C, y = (j / C) | 0, u = (x + 0.5) / C * 2 - 1, v = (y + 0.5) / C * 2 - 1;
      // micro relief: two octaves of fbm so the lobes are not polished balls
      const micro = nz.fbm2(u * 9 + ph, v * 9 - ph, 3) * 0.008 + nz.fbm2(u * 23 - ph, v * 23 + ph, 2) * 0.003;
      Hb[j] = Hs[j] > 0 ? K * Math.log(Hs[j]) + 0.5 + micro : -0.25;
    }
    // crevices: height below its blurred neighbourhood (separable box blur, radius 9 px)
    const Rb = 9;
    for (let y = 0; y < C; y++) { let s = 0; for (let x = -Rb; x <= Rb; x++) s += Hb[y * C + Math.min(C - 1, Math.max(0, x))];
      for (let x = 0; x < C; x++) { tmp[y * C + x] = s / (2 * Rb + 1); s += Hb[y * C + Math.min(C - 1, x + Rb + 1)] - Hb[y * C + Math.max(0, x - Rb)]; } }
    const blur = new Float32Array(C * C);
    for (let x = 0; x < C; x++) { let s = 0; for (let y = -Rb; y <= Rb; y++) s += tmp[Math.min(C - 1, Math.max(0, y)) * C + x];
      for (let y = 0; y < C; y++) { blur[y * C + x] = s / (2 * Rb + 1); s += tmp[Math.min(C - 1, y + Rb + 1) * C + x] - tmp[Math.max(0, y - Rb) * C + x]; } }
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const j = y * C + x, u = (x + 0.5) / C * 2 - 1, v = (y + 0.5) / C * 2 - 1;
      // torn edge: the coverage distance pushed around by fbm (wispy at the rim, solid inside)
      const tear = nz.fbm2(u * 6 + ph, v * 6 + ph * 0.5, 4) * 0.045 + nz.fbm2(u * 17 - ph, v * 17, 2) * 0.018;
      const cov = clamp((Sd[j] + tear * 1.2 + 0.012) / 0.06);
      const den = cov * cov * (3 - 2 * cov) * (1 - clamp((Math.hypot(u, v) - 0.9) / 0.08));
      const hL = Hb[y * C + Math.max(0, x - 1)], hR = Hb[y * C + Math.min(C - 1, x + 1)], hD = Hb[Math.max(0, y - 1) * C + x], hU = Hb[Math.min(C - 1, y + 1) * C + x];
      const px = 2 / C;
      let gx = (hR - hL) / (2 * px), gy = (hU - hD) / (2 * px);
      const gl = Math.hypot(gx, gy), gm = 6;                    // clamp the silhouette slope: rim normals stay ~80 deg
      if (gl > gm) { gx *= gm / gl; gy *= gm / gl; }
      let nx = -gx, ny = -gy, nzz = 1; const inv = 1 / Math.hypot(nx, ny, nzz); nx *= inv; ny *= inv;
      if (den < 0.02) { nx = 0; ny = 0; }
      const cav = Math.max(0, blur[j] - Hb[j]);
      const ao = clamp(1 - cav * 7.5) * (0.82 + 0.18 * clamp((Hb[j] + 0.1) / 0.6));
      const k = ((oy + y) * N + ox + x) * 4;
      data[k] = Math.round(den * 255); data[k + 1] = Math.round((nx * 0.5 + 0.5) * 255); data[k + 2] = Math.round((ny * 0.5 + 0.5) * 255); data[k + 3] = Math.round(clamp(ao) * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4;
  t.needsUpdate = true; t.userData.keep = true; t.name = 'fx.billowAtlas';
  ATLAS = t;
  return t;
}

// ── detail noise: tileable, R and G independent fbm fields ──────────────────────────────────────────────────────
let NOISE = null;
export function billowNoise() {
  if (NOISE) return NOISE;
  const S = 256, data = new Uint8Array(S * S * 4), a = makeNoise(515), b = makeNoise(616);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const f = a.fbm2(x / S * 8, y / S * 8, 5, 2, 0.5, 8, 8) * 0.5 + 0.5;
    const g = b.fbm2(x / S * 16 + 3, y / S * 16 + 5, 4, 2, 0.55, 16, 16) * 0.5 + 0.5;
    const k = (y * S + x) * 4;
    data[k] = Math.round(clamp(f) * 255); data[k + 1] = Math.round(clamp(g) * 255); data[k + 2] = 0; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; t.userData.keep = true;
  NOISE = t;
  return t;
}

// ── soft particles: a copy of the scene depth after the opaque pass ────────────────────────────────────────────
// Called from a puff mesh's onBeforeRender (transparent meshes draw after every opaque one). Only for render targets
// the size of the canvas (the camera's film), never for smaller passes (water reflections); anything unexpected
// (no WebGL2, a blit error) switches the copy off for good and the puffs fall back to the ground fade.
const SD = { broken: false, tex: null, glTex: null, fb: null, w: 0, h: 0, fmt: 0, lastFrame: -1, lastFb: null, checked: false };
export const SOFT_U = () => ({ uDepthTex: { value: null }, uDepthRes: { value: new THREE.Vector2(1, 1) }, uSoftOn: { value: 0 } });
export function softDepth(renderer, U) {
  U.uSoftOn.value = 0;
  if (SD.broken) return;
  const gl = renderer.getContext();
  if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext) || !renderer.capabilities.logarithmicDepthBuffer) { SD.broken = true; return; }
  const rt = renderer.getRenderTarget();
  if (!rt || !rt.depthBuffer || rt.depthTexture || rt.width !== gl.drawingBufferWidth || rt.height !== gl.drawingBufferHeight) return;
  const fb = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
  if (!fb) return;
  const w = rt.width, h = rt.height, fmt = rt.stencilBuffer ? gl.DEPTH24_STENCIL8 : gl.DEPTH_COMPONENT24;
  try {
    if (!SD.glTex || SD.w !== w || SD.h !== h || SD.fmt !== fmt) {
      const act = gl.getParameter(gl.ACTIVE_TEXTURE), prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D), prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      if (SD.glTex) gl.deleteTexture(SD.glTex);
      if (!SD.fb) SD.fb = gl.createFramebuffer();
      SD.glTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, SD.glTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
      gl.bindTexture(gl.TEXTURE_2D, prevTex); gl.activeTexture(act);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, SD.fb);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, rt.stencilBuffer ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, SD.glTex, 0);
      const st = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
      if (st !== gl.FRAMEBUFFER_COMPLETE) { SD.broken = true; console.warn('[fx.billow] soft depth: incomplete framebuffer', st); return; }
      SD.w = w; SD.h = h; SD.fmt = fmt; SD.tex = new THREE.ExternalTexture(SD.glTex); SD.lastFb = null; SD.checked = false;
    }
    const frame = renderer.info.render.frame;
    if (frame !== SD.lastFrame || fb !== SD.lastFb) {
      if (!SD.checked) gl.getError();
      const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, SD.fb);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
      if (!SD.checked) {
        const e = gl.getError(); SD.checked = true;
        if (e !== gl.NO_ERROR) { SD.broken = true; console.warn('[fx.billow] soft depth: blit failed', e); return; }
      }
      SD.lastFrame = frame; SD.lastFb = fb;
    }
    U.uDepthTex.value = SD.tex; U.uDepthRes.value.set(w, h); U.uSoftOn.value = 1;
  } catch (err) { SD.broken = true; console.warn('[fx.billow] soft depth off:', String(err)); }
}

// ── curl noise (JS): a divergence-free turbulence field, deterministic, for the churn of billows ─────────────────
function h3(ix, iy, iz, s) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(iz | 0, 0x9e3779b1) ^ Math.imul((s | 0) + 0x632be5ab, 0x85ebca77);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 2147483648 - 1;
}
export function vn3(x, y, z, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = h3(ix, iy, iz, s), b = h3(ix + 1, iy, iz, s), c = h3(ix, iy + 1, iz, s), d = h3(ix + 1, iy + 1, iz, s);
  const e = h3(ix, iy, iz + 1, s), f = h3(ix + 1, iy, iz + 1, s), g = h3(ix, iy + 1, iz + 1, s), k = h3(ix + 1, iy + 1, iz + 1, s);
  const x1 = a + (b - a) * ux, x2 = c + (d - c) * ux, x3 = e + (f - e) * ux, x4 = g + (k - g) * ux;
  const y1 = x1 + (x2 - x1) * uy, y2 = x3 + (x4 - x3) * uy;
  return y1 + (y2 - y1) * uz;
}
// curl of three offset noise potentials at p (units: noise cells), ~unit amplitude; two octaves
export function curl3(x, y, z, s = 0, out = [0, 0, 0]) {
  const e = 0.3;
  let cx = 0, cy = 0, cz = 0, amp = 1, fr = 1;
  for (let o = 0; o < 2; o++) {
    const X = x * fr, Y = y * fr, Z = z * fr, so = s + o * 7;
    const ax = vn3(X, Y, Z, so), ay = vn3(X + 31.7, Y, Z, so + 1), az = vn3(X, Y + 17.3, Z, so + 2);
    const dAx_dy = vn3(X, Y + e, Z, so) - ax, dAx_dz = vn3(X, Y, Z + e, so) - ax;
    const dAy_dx = vn3(X + 31.7 + e, Y, Z, so + 1) - ay, dAy_dz = vn3(X + 31.7, Y, Z + e, so + 1) - ay;
    const dAz_dx = vn3(X + e, Y + 17.3, Z, so + 2) - az, dAz_dy = vn3(X, Y + 17.3 + e, Z, so + 2) - az;
    cx += amp * (dAz_dy - dAy_dz) / e; cy += amp * (dAx_dz - dAz_dx) / e; cz += amp * (dAy_dx - dAx_dy) / e;
    amp *= 0.5; fr *= 2.03;
  }
  out[0] = cx * 0.5; out[1] = cy * 0.5; out[2] = cz * 0.5;
  return out;
}

// ── GLSL ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// needs: logdepthbuf_pars_fragment (logDepthBufFC), uniforms below, and the caller's varyings.
export const BILLOW_GLSL = /* glsl */`
uniform sampler2D uBAtlas; uniform sampler2D uBNoise; uniform float uBTime;
uniform sampler2D uDepthTex; uniform vec2 uDepthRes; uniform float uSoftOn;
// one puff pixel. q: quad coords (-1..1, screen-aligned: x right, y up); cs: cos/sin of the texture's rotation on
// screen; cell: 0..15; seed: 0..1; soft: 0 fresh crisp billow .. 1 old wispy haze.
// out: x = density, yz = bump normal on screen (x right, y up), w = crevice occlusion
vec4 billowTex(vec2 q, vec2 cs, float cell, float seed, float soft) {
  vec2 t = vec2(cs.x * q.x + cs.y * q.y, -cs.y * q.x + cs.x * q.y);
  vec2 cellO = vec2(mod(cell, 4.0), floor(cell * 0.25 + 0.01)) * 0.25;
  vec4 tx = texture2D(uBAtlas, cellO + clamp(t * 0.5 + 0.5, 0.004, 0.996) * 0.25);
  // detail: two noise octaves riding the puff (they turn with it), drifting slowly = the boil
  vec2 nuv = t * (0.19 + 0.05 * seed) + vec2(seed * 7.31, seed * 3.17);
  float n1 = texture2D(uBNoise, nuv + vec2(0.0, uBTime * 0.021)).r;
  float n2 = texture2D(uBNoise, nuv * 1.7 + vec2(uBTime * 0.017, 0.31)).g;
  float nd = n1 * 0.6 + n2 * 0.4;
  // erosion: crisp billows keep their edge, old haze is torn into wisps
  float er = mix(0.1, 0.62, soft);
  float den = clamp((tx.r - (1.0 - nd) * er) / max(1.0 - er * 0.55, 0.2), 0.0, 1.0);
  // old haze loses its billow outline: it melts into a soft, noisy blob
  float blob = (1.0 - smoothstep(0.05, 0.95, length(q))) * (0.45 + 0.55 * nd);
  den = mix(den, max(den * 0.6, blob), soft * soft * 0.85);
  den *= 1.0 - smoothstep(0.86, 1.0, length(q));
  vec2 nb = tx.gb * 2.0 - 1.0;
  nb += (vec2(n1, n2) - 0.5) * (0.22 + 0.25 * soft);            // fine grain in the shading
  vec2 ns = vec2(cs.x * nb.x - cs.y * nb.y, cs.y * nb.x + cs.x * nb.y);
  ns *= mix(1.0, 0.55, soft);
  return vec4(den, ns, mix(tx.a, 1.0, 0.35 * soft));
}
// the lit colour of a billow pixel. N: world normal; L: towards the sun; V: camera -> pixel (unit)
// sun, sky, gnd: light colours (x intensity); occ: cloud-scale self-shadow 0 (deep in the core) .. 1 (lit surface)
vec3 billowLight(vec3 alb, vec3 N, vec3 L, vec3 V, float den, float ao, float occ, float soft, vec3 sun, vec3 sky, vec3 gnd) {
  float ndl = dot(N, L);
  float wrap = mix(0.28, 0.6, soft);
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  diff = diff * diff * (3.0 - 2.0 * diff);
  float cav = mix(1.0, ao * ao, 0.85);
  // deep in the cloud's shadow a billow's own relief hardly matters (only multiple scattering reaches it)
  float vis = occ * mix(1.0, diff, clamp(occ * 1.25, 0.25, 1.0)) * cav;
  // silver lining: thin edges glow when the sun is behind the cloud, only where the sun actually reaches them
  float fwd = pow(clamp(dot(V, L), 0.0, 1.0), 5.0);
  float thin = 1.0 - den;
  float rim = fwd * (0.1 + 1.5 * thin * thin) * occ * occ;
  vec3 amb = mix(gnd, sky, clamp(N.y * 0.55 + 0.5, 0.0, 1.0)) * mix(0.45, 1.0, ao) * mix(0.75, 1.0, occ);
  return alb * (sun * (vis + rim) + amb);
}
// 0..1: fades a puff where the opaque scene is just behind it (d = fade distance in metres)
float billowSoftDepth(float fragW, float d) {
  if (uSoftOn < 0.5) return 1.0;
  float z = texture2D(uDepthTex, gl_FragCoord.xy / uDepthRes).r;
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  float sceneW = exp2(z * 2.0 / logDepthBufFC) - 1.0;
  return clamp((sceneW - fragW) / max(d, 0.05), 0.0, 1.0);
#else
  return 1.0;
#endif
}
`;
// the uniforms BILLOW_GLSL reads (the caller adds uBTime -> U.uTime of env.js, the world time)
export function billowUniforms(timeUniform) {
  return { uBAtlas: { value: billowAtlas() }, uBNoise: { value: billowNoise() }, uBTime: timeUniform || { value: 0 }, ...SOFT_U() };
}
