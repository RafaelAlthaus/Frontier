// giants.js — E4 (v2, 27 Sep 2026; round 2): inside the giant planets. biome.jupiter_clouds, biome.saturn_clouds,
// biome.uranus_clouds, biome.neptune_clouds: NO ground (the camera may be anywhere; fall_through drops through them).
// One full-screen dome ray-marches the cloud decks as real volumes, so everything has parallax as the camera falls:
//   * a weather map per deck: coverage with CANYONS (open gaps down to the next deck) and TOWERS: convective columns
//     that rise far above their deck, narrow as they climb and spread into ANVILS (thunderheads);
//   * shape = cauliflower billows (a baked tileable Worley fbm) eroded at the edges by finer billows;
//   * light: a 5-tap march toward the sun (soft self-shadow, dark cores), beer-powder (dark crevices), a forward-
//     scattering phase (silver lining / rim light against the sun), sky light on the tops, the deep's bounce below;
//     sunlight fades with depth under the decks above;
//   * GOD RAYS: the haze between the clouds is lit only where the sun gets through (shafts through the gaps);
//   * LIGHTNING: visible, branching bolts inside the deepest deck (2-4 return strokes), lighting the clouds round them;
//   * SPEED: haze streaks round the lens stretched along the fall (or the wind), so a fall reads as speed;
//   * per world: Jupiter cream/ochre/brown decks; Saturn pale gold, the RINGS as a huge arc with their shadow bands
//     across the haze; Uranus a featureless cyan haze in stratified depth layers; Neptune deep blue with white
//     methane cirrus shearing past at supersonic speed (each deck its own wind).
// Objects (a falling astronaut, a probe) get the matching light and fog every sub-frame. All of it is a function of t.
import * as THREE from 'three';
import { clamp, lerp } from '../shared/util.js';
import { spaceState, sunFromSpec, planOf } from './planets.js';
import { overrideLights, bakeEnv } from './spacefx.js';

// ── tileable 3D noise, baked once (64^3 RG8): R value-noise fbm, G Worley billows (1 - F1 fbm) ─────────────────────
let NOISE3 = null;
function noise3D() {
  if (NOISE3) return NOISE3;
  const N = 64, data = new Uint8Array(N * N * N * 2), fR = new Float32Array(N * N * N), fG = new Float32Array(N * N * N);
  const hash = (x, y, z, s) => { let h = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vn = (px, py, pz, per, s) => {
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz), fx = px - ix, fy = py - iy, fz = pz - iz;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    const m = (a) => ((a % per) + per) % per;
    const x0 = m(ix), x1 = m(ix + 1), y0 = m(iy), y1 = m(iy + 1), z0 = m(iz), z1 = m(iz + 1);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(hash(x0, y0, z0, s), hash(x1, y0, z0, s), ux), l(hash(x0, y1, z0, s), hash(x1, y1, z0, s), ux), uy),
      l(l(hash(x0, y0, z1, s), hash(x1, y0, z1, s), ux), l(hash(x0, y1, z1, s), hash(x1, y1, z1, s), ux), uy), uz);
  };
  const worley = (px, py, pz, per, s) => {
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz); let d2 = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz, wx = ((cx % per) + per) % per, wy = ((cy % per) + per) % per, wz = ((cz % per) + per) % per;
      const ox = cx + hash(wx, wy, wz, s), oy = cy + hash(wx, wy, wz, s + 17), oz = cz + hash(wx, wy, wz, s + 31);
      const e = (ox - px) ** 2 + (oy - py) ** 2 + (oz - pz) ** 2; if (e < d2) d2 = e;
    }
    return Math.sqrt(d2);
  };
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, a = 0.5, per = 4;
    for (let o = 0; o < 4; o++) { const k = per / N; v += a * vn(x * k, y * k, z * k, per, o + 3); a *= 0.5; per *= 2; }
    let w = 0; const WS = [[4, 0.6], [8, 0.27], [16, 0.13]];
    for (const [P, wt] of WS) { const k = P / N; w += wt * (1 - Math.min(1, worley(x * k, y * k, z * k, P, 50 + P))); }
    const i = (z * N + y) * N + x; fR[i] = v; fG[i] = w;
  }
  const norm = (f, sdK) => { let m = 0, q = 0; for (let i = 0; i < f.length; i++) { m += f[i]; q += f[i] * f[i]; } m /= f.length; const sd = Math.sqrt(Math.max(q / f.length - m * m, 1e-9)); return (v) => clamp(0.5 + (v - m) / sd * sdK, 0, 1); };
  const nR = norm(fR, 0.17), nG = norm(fG, 0.17);
  for (let i = 0; i < fR.length; i++) { data[i * 2] = Math.round(nR(fR[i]) * 255); data[i * 2 + 1] = Math.round(nG(fG[i]) * 255); }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true; t.userData.keep = true;
  return (NOISE3 = t);
}

// decks: [top y, base y, coverage 0..1, noise scale m]; tow: [tower height m, anvil 0..1, edge erosion, density];
// wind: m/s relative to the camera's air; lit / dark: the deck's colours (linear)
const GIANTS = {
  jupiter: {
    decks: [[0, -900, 0.64, 1500], [-2100, -2900, 0.66, 1250], [-4200, -5100, 0.7, 1100]],
    tow: [[1600, 0.0, 0.35, 1.0], [1000, 0.0, 0.35, 1.0], [900, 0.35, 0.3, 0.85]],
    wind: [[40, 0, 6], [-25, 0, 10], [15, 0, -8]],
    lit: [[1.0, 0.93, 0.8], [0.93, 0.62, 0.36], [0.46, 0.45, 0.46]], dark: [[0.3, 0.23, 0.17], [0.24, 0.12, 0.06], [0.04, 0.04, 0.055]],
    skyTop: [0.13, 0.21, 0.38], haze: [0.72, 0.58, 0.4], murk: [[0.52, 0.38, 0.25], [0.3, 0.17, 0.08], [0.05, 0.035, 0.025]], deep: [0.015, 0.01, 0.007],
    sunC: [1.0, 0.92, 0.8], lightDepth: 2200, lightning: 1, sunR: 0.05, stretch: 1.5, hazeK: 1.0, streak: [0, 0, 0],
    desc: 'inside Jupiter at the 1-bar level and below: cream ammonia-ice cloud tops (y 0 .. -900) with towering convective columns and anvils, canyons down to the ochre-brown ammonium-hydrosulfide deck (-2100 .. -2900) and the dark water clouds with thunderheads and visible lightning bolts (-4200 .. -5100), god rays through the gaps, a hot dark abyss below; no ground',
  },
  saturn: {
    decks: [[0, -1100, 0.6, 1700], [-2500, -3300, 0.64, 1350], [-4700, -5600, 0.68, 1150]],
    tow: [[1200, 0.0, 0.35, 0.9], [850, 0.0, 0.35, 1.0], [900, 0.35, 0.3, 0.85]],
    wind: [[90, 0, 8], [-30, 0, 12], [20, 0, -6]],
    lit: [[1.0, 0.92, 0.72], [0.93, 0.7, 0.44], [0.56, 0.52, 0.48]], dark: [[0.34, 0.27, 0.17], [0.26, 0.17, 0.08], [0.06, 0.055, 0.05]],
    skyTop: [0.2, 0.18, 0.17], haze: [0.76, 0.64, 0.42], murk: [[0.58, 0.46, 0.28], [0.34, 0.23, 0.11], [0.05, 0.04, 0.03]], deep: [0.018, 0.012, 0.008],
    sunC: [1.0, 0.94, 0.82], lightDepth: 2400, lightning: 0.7, sunR: 0.028, stretch: 1.9, hazeK: 1.15, streak: [0, 0, 0], rings: 1,
    desc: 'inside Saturn: pale gold cloud tops and towers under a golden haze with the RINGS crossing the sky as a huge arc and their shadow falling across the haze in bands (world.lat 30: your latitude), deeper orange decks, dark water clouds with lightning; no ground',
  },
  uranus: {
    decks: [[-300, -1300, 0.46, 2600], [-2600, -3400, 0.5, 2000]],
    tow: [[250, 0.0, 0.2, 0.45], [200, 0.0, 0.2, 0.6]],
    wind: [[30, 0, 4], [-15, 0, 6]],
    lit: [[0.76, 0.96, 0.98], [0.5, 0.74, 0.78]], dark: [[0.28, 0.46, 0.5], [0.1, 0.2, 0.24]],
    skyTop: [0.06, 0.2, 0.28], haze: [0.44, 0.74, 0.8], murk: [[0.36, 0.62, 0.68], [0.12, 0.26, 0.3]], deep: [0.01, 0.03, 0.04],
    sunC: [0.92, 0.98, 1.0], lightDepth: 2600, lightning: 0, sunR: 0.013, stretch: 4.0, hazeK: 2.6, streak: [0, 0, 0], layers: 1,
    desc: 'inside Uranus: soft, blank cyan-blue haze in every direction, stratified in faint depth layers, pale methane-ice sheets far below; unsettling calm; no ground',
  },
  neptune: {
    decks: [[500, -150, 0.42, 1900], [-900, -1900, 0.6, 1500], [-3200, -4100, 0.64, 1200]],
    tow: [[250, 0.0, 0.3, 0.8], [800, 0.0, 0.35, 1.0], [900, 0.45, 0.3, 0.9]],
    wind: [[420, 0, 30], [-140, 0, 70], [60, 0, -40]],
    lit: [[0.96, 0.98, 1.0], [0.46, 0.62, 0.98], [0.22, 0.32, 0.66]], dark: [[0.36, 0.46, 0.72], [0.12, 0.2, 0.48], [0.04, 0.07, 0.18]],
    skyTop: [0.03, 0.07, 0.24], haze: [0.2, 0.36, 0.86], murk: [[0.16, 0.3, 0.74], [0.08, 0.15, 0.46], [0.02, 0.04, 0.12]], deep: [0.005, 0.01, 0.03],
    sunC: [0.95, 0.97, 1.0], lightDepth: 2200, lightning: 0.4, sunR: 0.009, stretch: 7.0, hazeK: 1.0, streak: [420, 0, 30],
    desc: 'inside Neptune: deep blue, bright white methane cirrus torn into streaks and sheared past at 2,000 km/h (the top deck at 420 m/s, the decks below other ways), darker blue decks with towers below; world.wind x; no ground',
  },
};

const DOME_FS = /* glsl */`
  precision highp sampler3D;
  in vec3 vDir;
  uniform sampler3D uNoise;
  uniform vec3 uSun, uSunC, uSkyTop, uHaze, uDeep, uFlashPos, uRingAxis;
  uniform vec3 uLit[3], uDark[3], uMurk[3], uWindK[3];
  uniform vec4 uDeck[3], uTow[3];
  uniform vec3 uBoltA[24], uBoltB[24];
  uniform float uBoltN, uBoltI;
  uniform float uTime, uTop, uTopMax, uBot, uLightDepth, uFlash, uSunR, uStretch, uRings, uNd, uSteps, uMaxD, uCov, uHazeK, uLayers, uGrowth, uDt0, uBands, uGrsAz;
  uniform vec3 uRust;
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float remap(float x, float a, float b, float c, float d){ return c + (x - a) * (d - c) / max(b - a, 1e-4); }
  vec2 weather(vec2 xz, int k){
    vec2 u = xz / (uDeck[k].w * 5.3) + float(k) * 0.37;
    float c = texture(uNoise, vec3(u, 0.21)).r * 0.7 + texture(uNoise, vec3(u * 2.3 + 0.5, 0.63)).r * 0.3;
    float cov = smoothstep(0.38, 0.6, c);                                 // 0 in the canyons
    float tw = smoothstep(0.54, 0.68, texture(uNoise, vec3(u * 0.85 + 0.13, 0.87)).g);
    return vec2(cov, tw * cov);
  }
  // one deck: the full shape (full = false: the cheap shape for light / shadow taps)
  float gDist = 0.0;                                     // the sample's distance from the lens (erosion LOD)
  float deckD(vec3 p, int k, bool full, out float hF){
    hF = 0.0;
    vec4 dk = uDeck[k], tw = uTow[k];
    if (p.y < dk.y - 20.0 || p.y > dk.x + tw.x + 20.0) return 0.0;
    vec3 wp = p - uWindK[k] * uTime;
    vec2 w = weather(wp.xz, k);
    float tg = texture(uNoise, vec3((wp.xz / (dk.w * 5.3) + float(k) * 0.37) * 0.85 + 0.13, 0.87)).g;
    float tH = smoothstep(0.5, 0.86, tg) * w.x;                       // a domed height field: tallest at the core
    float top = dk.x + tw.x * tH * tH;
    float h = (p.y - dk.y) / max(top - dk.y, 1.0);
    if (h < 0.0 || h > 1.0) return 0.0;
    hF = h;
    float prof = smoothstep(0.0, 0.1, h) * smoothstep(1.0, 0.8, h);
    float col = smoothstep(0.52 + 0.14 * h, 0.66 + 0.14 * h, tg) * w.x;  // the column narrows as it climbs
    float c = mix(w.x * dk.z * uCov, 0.74 - 0.2 * h, col);
    vec3 q = wp / dk.w; q.xz /= vec2(uStretch, 1.0); q.y *= 1.5;
    vec2 n = texture(uNoise, q).rg;
    float shape = n.g * 0.8 + n.r * 0.2;
    float d = remap(shape, 1.0 - c, 1.0, 0.0, 1.0) * prof;
    // the anvil: a smooth, flat-topped sheet spreading from the thunderhead's top (value noise: no fragments)
    if (tw.y > 0.0) {
      float an = tw.y * smoothstep(0.5, 0.66, tg) * w.x * smoothstep(0.8, 0.9, h) * smoothstep(1.0, 0.95, h);
      d = max(d, an * smoothstep(0.42, 0.6, shape) * 0.7);
    }
    if (d <= 0.0) return 0.0;
    if (full) {
      vec2 nd = texture(uNoise, q * 3.6 + vec3(0.37, 0.11, 0.71) + vec3(0.0, uTime * 0.0015, 0.0)).rg;
      d = remap(d, (nd.g * 0.7 + nd.r * 0.3) * tw.z * (1.0 - d) * (1.0 - smoothstep(1200.0, 5000.0, gDist)), 1.0, 0.0, 1.0);
      d = smoothstep(0.0, 0.25, d) * d * 1.4;                                            // no thin confetti
    }
    return max(d, 0.0) * tw.w;
  }
  float dens(vec3 p, bool full, out int which, out float hF){
    float best = 0.0; which = 0; hF = 0.0;
    for (int k = 0; k < 3; k++) { if (float(k) >= uNd) break; float h; float d = deckD(p, k, full, h); if (d > best) { best = d; which = k; hF = h; } }
    return best;
  }
  vec3 murkAt(float y){
    float a = clamp((uDeck[0].x - y) / max(uDeck[0].x - uBot, 1.0), 0.0, 1.0);
    vec3 m = mix(uMurk[0], uMurk[1], smoothstep(0.15, 0.55, a));
    if (uNd > 2.5) m = mix(m, uMurk[2], smoothstep(0.55, 0.95, a));
    return mix(m, uDeep, smoothstep(0.95, 1.25, a));
  }
  float sunAt(float y){ return exp(-max(uTop - y, 0.0) / uLightDepth); }
  float hazeDens(float y){ return 0.00011 * uHazeK * (0.35 + 0.65 * smoothstep(uTop + 400.0, uTop - 900.0, y)); }
  // Saturn's rings: tau at radius r (planet radii) for the arc and for their shadow on the haze
  float ringTau(float r, float fw){
    float t = smoothstep(1.24 - fw, 1.24 + fw, r) * (1.0 - smoothstep(1.527 - fw, 1.527 + fw, r)) * 0.12;
    float b = smoothstep(1.527 - fw, 1.527 + fw, r) * (1.0 - smoothstep(1.951 - fw, 1.951 + fw, r));
    t += b * (1.2 + 1.3 * smoothstep(1.53, 1.75, r) + 0.5 * sin(r * 160.0) * (1.0 - smoothstep(0.002, 0.01, fw)));
    t += smoothstep(1.951 - fw, 1.951 + fw, r) * (1.0 - smoothstep(2.027 - fw, 2.027 + fw, r)) * 0.05;
    float a = smoothstep(2.027 - fw, 2.027 + fw, r) * (1.0 - smoothstep(2.269 - fw, 2.269 + fw, r));
    a *= 1.0 - (smoothstep(2.211 - fw, 2.211 + fw, r) - smoothstep(2.217 - fw, 2.217 + fw, r));
    return t + a * 0.6;
  }
  vec3 ringsSky(vec3 rd, vec3 bg){
    vec3 C = vec3(0.0, -1.0, 0.0), P = normalize(uRingAxis);
    float den = dot(rd, P);
    if (abs(den) < 1e-4) return bg;
    float s = dot(C, P) / den;
    if (s <= 0.0) return bg;
    vec3 H = rd * s; float r = length(H - C);
    float fw = fwidth(r) + 0.001;
    float tau = ringTau(r, fw);
    float b = smoothstep(1.527, 1.53, r) * (1.0 - smoothstep(1.95, 1.953, r)), aa = smoothstep(2.027, 2.03, r) * (1.0 - smoothstep(2.266, 2.269, r));
    vec3 col = mix(vec3(0.56, 0.52, 0.47), vec3(0.93, 0.85, 0.7), b) * (1.0 - aa) + vec3(0.83, 0.79, 0.71) * aa;
    float alpha = 1.0 - exp(-tau / max(abs(den), 0.05));
    vec3 L = normalize(uSun), oc = H - C; float bb = dot(oc, L); float dca = length(oc - L * bb);
    float sh = bb < 0.0 ? smoothstep(0.96, 1.02, dca) : 1.0;
    float lit = sign(dot(L, P)) == sign(dot(-C, P)) ? 1.0 : 0.35;
    vec3 rc = col * (0.35 + 0.65 * sqrt(abs(dot(L, P)))) * lit * sh * 0.85;
    return mix(bg, rc, alpha * smoothstep(-0.02, 0.06, rd.y));
  }
  // the rings' shadow falling across the haze (bands in the sky): transmittance of the sunlight reaching the air
  // 20..120 km along the view ray
  float ringShadow(vec3 rd){
    vec3 C = vec3(0.0, -1.0, 0.0), P = normalize(uRingAxis), L = normalize(uSun);
    float T = 0.0;
    for (int i = 0; i < 3; i++) {
      vec3 X = rd * (0.004 + 0.008 * float(i));
      float den = dot(L, P); if (abs(den) < 1e-4) { T += 1.0; continue; }
      float s = dot(C - X, P) / den;
      if (s <= 0.0) { T += 1.0; continue; }
      float r = length(X + L * s - C);
      T += exp(-ringTau(r, 0.004) / max(abs(den), 0.08));
    }
    return T / 3.0;
  }
  vec3 background(vec3 rd, vec3 ro){
    float up = rd.y;
    vec3 L = normalize(uSun);
    float above = smoothstep(uTop - 400.0, uTop + 300.0, ro.y);
    vec3 sky = mix(uHaze, uSkyTop, smoothstep(-0.02, 0.32, up));
    sky = mix(sky, uHaze * 1.15, pow(max(dot(rd, L), 0.0), 6.0) * 0.45);
    vec3 floorC = mix(uHaze, uMurk[0], 0.4) * 0.9;
    vec3 outside = mix(floorC, sky, smoothstep(-0.12, 0.02, up));
    if (uRings > 0.5) {
      // the rings' shadow thrown across the golden haze: the ring pattern again, displaced below the arc, as dark bands
      vec3 rs = normalize(rd + vec3(0.0, -0.09, 0.0)); vec3 C = vec3(0.0, -1.0, 0.0), P = normalize(uRingAxis);
      float den = dot(rs, P), sh = 1.0;
      if (abs(den) > 1e-4) { float s2 = dot(C, P) / den; if (s2 > 0.0) sh = exp(-ringTau(length(rs * s2 - C), fwidth(s2) * 0.02 + 0.002) * 0.8); }
      outside *= mix(0.62, 1.0, sh) * mix(0.8, 1.0, ringShadow(rd));
      outside = ringsSky(rd, outside);
    }
    float ang = acos(clamp(dot(rd, L), -1.0, 1.0));
    outside += uSunC * (smoothstep(uSunR * 1.1, uSunR * 0.9, ang) * 40.0 + exp(-ang / 0.02) * 1.2 + exp(-ang / 0.2) * 0.1) * smoothstep(-0.02, 0.02, up);
    vec3 m = murkAt(ro.y) * (0.45 + 0.55 * sunAt(ro.y));
    vec3 inside = m * mix(0.5, 1.4, smoothstep(-1.0, 1.0, up)) + uLit[0] * sunAt(ro.y) * pow(max(dot(rd, L), 0.0), 4.0) * 0.25;
    if (uGrsAz > -900.0) {
      float az = atan(rd.x, -rd.z), dA = atan(sin(az - uGrsAz), cos(az - uGrsAz));
      float e = length(vec2(dA / 0.3, (up - 0.012) / 0.028));
      if (e < 1.4) {
        float sw = atan(up - 0.012, dA * 0.093) + (1.0 - e) * 3.0 + uTime * 0.01;
        float n = texture(uNoise, vec3(cos(sw) * e * 0.8, sin(sw) * e * 0.8, 0.3)).r;
        vec3 grs = mix(vec3(0.62, 0.26, 0.14), vec3(0.86, 0.5, 0.3), n) * (0.75 + 0.25 * smoothstep(-0.2, 0.3, dot(rd, L)));
        float a = (1.0 - smoothstep(0.85, 1.25, e)) * smoothstep(-0.018, 0.004, up) * 0.85;
        outside = mix(outside, mix(grs, uHaze, 0.35), a);
      }
    }
    vec3 col = mix(inside, outside, above);
    if (uLayers > 0.5) {                               // Uranus: stratified haze, faint bands with depth
      float yD = ro.y + rd.y * 5000.0;
      col *= 1.0 + 0.07 * sin(yD / 700.0) + 0.04 * sin(yD / 260.0 + 1.3);
    }
    return col;
  }
  float HG(float c, float g){ float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }
  // distance from the ray to a segment: (distance, ray t)
  vec2 raySeg(vec3 ro, vec3 rd, vec3 a, vec3 b){
    vec3 ab = b - a, w0 = ro - a;
    float B = dot(rd, ab), C = max(dot(ab, ab), 1e-6), D = dot(rd, w0), E = dot(ab, w0);
    float den = max(C - B * B, 1e-6);
    float sg = clamp((E - B * D) / den, 0.0, 1.0);
    float tr = max(dot(a + ab * sg - ro, rd), 0.0);
    sg = clamp(dot(ro + rd * tr - a, ab) / C, 0.0, 1.0);
    tr = max(dot(a + ab * sg - ro, rd), 0.0);
    vec3 q = a + ab * sg;
    return vec2(length(ro + rd * tr - q), tr);
  }
  void main(){
    vec3 rd = normalize(vDir), ro = cameraPosition, L = normalize(uSun);
    vec3 bg = background(rd, ro);
    // the visible bolt: nearest approach of the ray to the bolt's segments
    float bD = 1e9, bT = 1e9;
    if (uBoltI > 0.001) for (int i = 0; i < 24; i++) { if (float(i) >= uBoltN) break; vec2 q = raySeg(ro, rd, uBoltA[i], uBoltB[i]); if (q.x < bD) { bD = q.x; bT = q.y; } }
    float bw = 2.5 + bT * 0.0022;                           // a core a few pixels wide at any distance
    vec3 boltC = vec3(0.8, 0.86, 1.0) * uBoltI * (exp(-bD / bw) * 16.0 + exp(-bD / (bw * 7.0)) * 2.2 + exp(-bD / 260.0) * 0.5);
    bool boltAdded = uBoltI <= 0.001;
    // the ray's span through the decks and their towers
    float ta, tb;
    if (abs(rd.y) < 1e-4) { ta = 0.0; tb = (ro.y < uTopMax + 60.0 && ro.y > uBot - 60.0) ? uMaxD : -1.0; }
    else { ta = (uTopMax + 60.0 - ro.y) / rd.y; tb = (uBot - 60.0 - ro.y) / rd.y; if (ta > tb) { float x = ta; ta = tb; tb = x; } }
    float t0 = max(ta, 0.0), t1 = min(tb, uMaxD);
    vec3 acc = vec3(0.0); float T = 1.0;
    if (tb > 0.0 && t0 < t1) {
      float jit = hsh(gl_FragCoord.xy + fract(uTime * 7.31) * 91.0);
      float dt = uDt0 * (1.0 + t0 * 0.002);
      float t = t0 + dt * jit;
      float cosT = dot(rd, L), phase = mix(1.0, HG(cosT, 0.62) * 0.55 + HG(cosT, -0.2) * 0.45, 0.8);
      float vis = 1.0;
      for (int i = 0; i < 110; i++) {
        if (float(i) >= uSteps || t > t1 || T < 0.015) break;
        vec3 p = ro + rd * t;
        float ls = sunAt(p.y);
        // haze with god rays: lit only where the sun gets through the clouds above this point
        float hd = hazeDens(p.y) * dt;
        int kk; float hh;
        if (i % 2 == 0) { float o1 = dens(p + L * 180.0, false, kk, hh) * 180.0 + dens(p + L * 520.0, false, kk, hh) * 340.0; vis = exp(-o1 * 0.006); }
        vec3 hc = murkAt(p.y) * (0.3 + 0.3 * ls) + uSunC * ls * vis * 0.5 * (0.3 + 0.7 * pow(max(cosT, 0.0), 3.0)) * uHaze;
        if (uFlash > 0.0) hc += vec3(0.6, 0.66, 0.9) * uFlash * 1.4 * exp(-length(p - uFlashPos) / 900.0);
        float ha = 1.0 - exp(-hd);
        acc += T * hc * ha; T *= 1.0 - ha;
        int k; float hF;
        gDist = t;
        float d = dens(p, true, k, hF) * smoothstep(6.0, 90.0, t);                     // a cloud wall thickens as the lens flies into it (no one-frame white-out)
        if (d > 0.002) {
          // light: 5 taps toward the sun, growing
          float od = 0.0, sl = 60.0; vec3 q = p;
          for (int j = 0; j < 5; j++) { q += L * sl; float h2; int k2; od += dens(q, false, k2, h2) * sl; sl *= 2.05; }
          od *= 0.012;
          float beer = exp(-od), powder = 1.0 - exp(-d * 2.5);
          float energy = beer * mix(1.0, powder * 1.6, 0.45);
          vec3 lit = k == 0 ? uLit[0] : k == 1 ? uLit[1] : uLit[2];
          if (k == 0 && uBands > 0.5) lit = mix(lit, uRust, smoothstep(0.15, 0.55, sin((p.z - 2600.0) / 6500.0 + 0.4 * sin(p.x / 9000.0))) * 0.75);
          vec3 dark = k == 0 ? uDark[0] : k == 1 ? uDark[1] : uDark[2];
          vec3 amb = mix(dark, lit * 0.42, smoothstep(0.0, 1.0, hF)) * (0.55 + 0.45 * ls) + murkAt(p.y) * 0.06;
          vec3 c = lit * uSunC * ls * energy * phase * 1.9 + amb * (0.3 + 0.7 * exp(-od * 0.35));
          if (uFlash > 0.0) c += vec3(0.75, 0.82, 1.0) * uFlash * 3.2 * exp(-length(p - uFlashPos) / 480.0);
          float a = 1.0 - exp(-d * dt * 0.02);
          acc += T * c * a; T *= 1.0 - a;
        }
        if (!boltAdded && bT < t + dt) { acc += T * boltC; boltAdded = true; }
        t += dt; dt *= uGrowth;
      }
    }
    if (!boltAdded) acc += T * boltC;
    vec3 col = acc + T * bg;
    gl_FragColor = vec4(col, 1.0);
  }`;

export const CATALOG = {};
for (const [k, g] of Object.entries(GIANTS)) CATALOG[`biome.${k}_clouds`] = { desc: g.desc + '. Camera: move fall_through (from/to world y), keys, orbit; `world.wind` x, `world.lightning` 0..3, `world.coverage` 0.6..1.4, `world.towers` x, `world.streaks` 0..2, `world.haze` x' + (k === 'jupiter' ? ', `world.grs_az` deg: the Great Red Spot standing on the horizon at that compass bearing, `world.bands` false: no cream/rust belt change' : '') + (g.rings ? ', world.lat (deg) for the rings\' arc' : ''), section: 'world', biome: `${k}_clouds`, world: true, actions: [], params: { wind: 1, lightning: g.lightning, coverage: 1, towers: 1, streaks: 1 }, footprint: [0, 0], height: 0, tags: ['biome', 'space', 'clouds', k] };
export async function build() { return { root: new THREE.Group(), radius: 0, height: 0, update() {}, anchors: {} }; }

// ── speed streaks: short haze streaks round the lens, drawn along the motion through the air (CPU ribbons) ─────────
function speedStreaks(o) {
  const n = o.count ?? 900, S = o.box ?? 170, wind = new THREE.Vector3(...(o.wind || [0, 0, 0]));
  let sd = 12345; const R = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const off = new Float32Array(n * 4); for (let i = 0; i < n; i++) { off[i * 4] = R() * S; off[i * 4 + 1] = R() * S; off[i * 4 + 2] = R() * S; off[i * 4 + 3] = R(); }
  const pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), al = new Float32Array(n * 4), idx = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) { uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8); idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aA', new THREE.BufferAttribute(al, 1)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(1, 1, 1) }, uAmt: { value: 0 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float aA; varying float vA; varying vec2 vUv;
      void main(){ vA = aA; vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uCol; uniform float uAmt; varying float vA; varying vec2 vUv;
      void main(){
        #include <logdepthbuf_fragment>
        float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * sin(3.14159 * vUv.y) * vA * 0.26 * uAmt;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uCol * a, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 5; m.name = 'e4.streaks'; m.userData.noQA = true;
  const P = new THREE.Vector3(), rel = new THREE.Vector3(), ax = new THREE.Vector3(), vd = new THREE.Vector3(), side = new THREE.Vector3();
  const update = (t, cam, vel) => {
    rel.copy(vel).sub(wind); const sp = rel.length();
    const on = Math.min(1, Math.max(0, (sp - 30) / 110));
    if (sp > 1e-3) ax.copy(rel).multiplyScalar(-1 / sp); else ax.set(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const b = i * 4;
      P.set(off[b] + wind.x * t, off[b + 1] + wind.y * t, off[b + 2] + wind.z * t);
      P.x = cam.x - S / 2 + (((P.x - (cam.x - S / 2)) % S) + S) % S; P.y = cam.y - S / 2 + (((P.y - (cam.y - S / 2)) % S) + S) % S; P.z = cam.z - S / 2 + (((P.z - (cam.z - S / 2)) % S) + S) % S;
      vd.copy(P).sub(cam); const d = vd.length(); vd.divideScalar(Math.max(d, 1e-3));
      side.crossVectors(ax, vd); if (side.lengthSq() < 1e-8) side.set(1, 0, 0); side.normalize();
      const w = 0.1 + 0.006 * d, len = Math.min(20, Math.max(0.5, sp * 0.03)) * (0.6 + 0.8 * off[b + 3]);
      const a = on * (sp > 220 ? 220 / sp : 1) * Math.min(1, Math.max(0, (d - 4) / 14)) * (1 - Math.min(1, Math.max(0, (d - S * 0.3) / (S * 0.2))));   // a fast fall: fewer, softer streaks, not a warp effect
      for (let k = 0; k < 4; k++) {
        const sx = (k & 1) ? 0.5 : -0.5, sy = (k & 2) ? 1 : 0, q = (i * 4 + k) * 3;
        pos[q] = P.x + side.x * sx * w + ax.x * sy * len; pos[q + 1] = P.y + side.y * sx * w + ax.y * sy * len; pos[q + 2] = P.z + side.z * sx * w + ax.z * sy * len;
        al[i * 4 + k] = a;
      }
    }
    g.attributes.position.needsUpdate = true; g.attributes.aA.needsUpdate = true;
  };
  return { mesh: m, mat, update };
}

// ── a branching lightning bolt (seeded): a jagged main channel + two branches, as segments ──────────────────────────
function boltSegments(seed, top, bot, x, z) {
  let s = seed * 7919 + 13; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const segs = [], main = [[x, top, z]], n = 11;
  for (let i = 1; i <= n; i++) { const p = main[i - 1]; main.push([p[0] + (R() - 0.5) * 120, top + (bot - top) * i / n + (R() - 0.5) * 40, p[2] + (R() - 0.5) * 120]); }
  for (let i = 0; i < n; i++) segs.push([main[i], main[i + 1]]);
  for (let b = 0; b < 2; b++) {
    let p = main[2 + Math.floor(R() * 6)], dir = [(R() - 0.5) * 2, -0.6 - R() * 0.5, (R() - 0.5) * 2];
    for (let i = 0; i < 5; i++) { const q = [p[0] + dir[0] * 70 + (R() - 0.5) * 50, p[1] + dir[1] * 70, p[2] + dir[2] * 70 + (R() - 0.5) * 50]; segs.push([p, q]); p = q; }
  }
  return segs.slice(0, 24);
}

export async function buildWorld(world = {}, look = {}, ctx = {}) {
  const name = String(world.biome || world.kind || 'jupiter_clouds').replace(/^(biome|world)\./, '');
  const key = name.replace(/_clouds$/, ''), g = GIANTS[key] || GIANTS.jupiter;
  const root = new THREE.Group(); root.name = 'nature.world'; if (ctx.scene) ctx.scene.add(root);
  const st = spaceState(ctx);
  ctx.e4world = 'space';
  const ws = sunFromSpec(world.sun);
  st.setExplicit(ws || new THREE.Vector3(0.55, 0.4, -0.74).normalize());
  const nd = g.decks.length, towK = +(world.towers ?? 1), windK = +(world.wind ?? 1);
  const pad = (a, f) => [0, 1, 2].map((i) => a[Math.min(i, a.length - 1)] || f);
  const decks = pad(g.decks, [0, 0, 0, 1]).map((d) => new THREE.Vector4(d[0], d[1], d[2], d[3]));
  const tows = pad(g.tow, [0, 0, 0.5, 1]).map((d) => new THREE.Vector4(d[0] * towK, d[1], d[2], d[3]));
  const winds = pad(g.wind, [0, 0, 0]).map((d) => new THREE.Vector3(...d).multiplyScalar(windK));
  const col3 = (a) => pad(a, [0, 0, 0]).map((c) => new THREE.Color(c[0], c[1], c[2]));
  const lat = +(world.lat ?? 30) * Math.PI / 180;
  const topMax = Math.max(...g.decks.map((d, i) => d[0] + g.tow[i][0] * towK));
  const draft = ctx.quality === 'draft';
  const u = {
    uNoise: { value: noise3D() }, uSun: st.uSun, uSunC: { value: new THREE.Color(...g.sunC) }, uTime: { value: 0 },
    uSkyTop: { value: new THREE.Color(...g.skyTop) }, uHaze: { value: new THREE.Color(...g.haze) }, uDeep: { value: new THREE.Color(...g.deep) },
    uWindK: { value: winds }, uFlashPos: { value: new THREE.Vector3() }, uFlash: { value: 0 },
    uLit: { value: col3(g.lit) }, uDark: { value: col3(g.dark) }, uMurk: { value: col3(g.murk) }, uDeck: { value: decks }, uTow: { value: tows }, uNd: { value: nd },
    uBoltA: { value: Array.from({ length: 24 }, () => new THREE.Vector3()) }, uBoltB: { value: Array.from({ length: 24 }, () => new THREE.Vector3()) }, uBoltN: { value: 0 }, uBoltI: { value: 0 },
    uTop: { value: g.decks[0][0] }, uTopMax: { value: topMax }, uBot: { value: g.decks[nd - 1][1] }, uLightDepth: { value: g.lightDepth }, uSunR: { value: g.sunR * Math.PI / 180 },
    uStretch: { value: g.stretch }, uRings: { value: g.rings && world.rings !== false ? 1 : 0 }, uRingAxis: { value: new THREE.Vector3(0, Math.sin(lat), -Math.cos(lat)) },
    uSteps: { value: draft ? 64 : 104 }, uDt0: { value: draft ? 26 : 16 }, uGrowth: { value: draft ? 1.045 : 1.03 }, uMaxD: { value: +(world.view ?? 11000) },
    uCov: { value: clamp(+(world.coverage ?? 1), 0.3, 1.6) }, uHazeK: { value: g.hazeK * +(world.haze ?? 1) }, uLayers: { value: g.layers ? 1 : 0 },
    uBands: { value: key === 'jupiter' && world.bands !== false ? 1 : 0 }, uRust: { value: new THREE.Color(0.86, 0.54, 0.32) },
    uGrsAz: { value: key === 'jupiter' && Number.isFinite(+world.grs_az) ? +world.grs_az * Math.PI / 180 : -999 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, glslVersion: THREE.GLSL3,
    vertexShader: `out vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: 'out vec4 fragColor;\n#define gl_FragColor fragColor\n' + DOME_FS,
    depthWrite: false, depthTest: false, side: THREE.BackSide, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), mat);
  dome.frustumCulled = false; dome.renderOrder = -1e6 + 1.5; dome.name = 'e4.giant'; dome.userData.noQA = true;
  dome.onBeforeRender = (r, s, cam) => { dome.position.copy(cam.position); dome.updateMatrixWorld(); };
  root.add(dome);
  const streaks = speedStreaks({ wind: g.streak.map((v) => v * windK) });
  streaks.mat.uniforms.uCol.value.setRGB(...g.lit[0]); root.add(streaks.mesh);
  const streakK = +(world.streaks ?? 1);
  // lightning: seeded strikes in the deepest deck near the camera's path, 2-4 return strokes, visible bolts
  const lk = +(world.lightning ?? g.lightning);
  const deepest = g.decks[nd - 1], strikes = [];
  if (lk > 0) { let s = (world.seed ?? 3) * 9301 + 49297; const R = () => (s = (s * 9301 + 49297) % 233280) / 233280; let id = 0; for (let tt = 1.5 + R() * 1.5; tt < 90; tt += (1.6 + R() * 3.4) / lk) strikes.push({ id: id++, t: tt, x: (R() - 0.5) * 2400, z: -300 - R() * 2400, y0: deepest[0] + 300 * R(), y1: deepest[1] - 200, k: 0.7 + R() * 0.6, n: 2 + Math.floor(R() * 3) }); }
  const flashOf = (s, t) => { const dtt = t - s.t; if (dtt < 0 || dtt > 0.8) return 0; let f = 0; for (let j = 0; j < s.n; j++) { const tj = dtt - j * 0.12; if (tj >= 0) f = Math.max(f, Math.min(1, tj / 0.02) * Math.exp(-Math.max(0, tj - 0.02) / 0.05)); } return f * s.k; };
  let env = null, baked = false, curBolt = -1;
  const camP = new THREE.Vector3(), vel = new THREE.Vector3();
  const strikeAt = (t) => { let best = null, bf = 0; for (const s of strikes) { const f = flashOf(s, t); if (f > bf) { bf = f; best = s; } } return [best, bf]; };
  const update = (t, clock, camera) => {
    st.resolve();
    u.uTime.value = t;
    if (camera) camP.copy(camera.position);
    const cur = planOf(ctx);
    vel.set(0, 0, 0);
    if (cur) { const a = cur.plan.camAt(t - 0.05).pos, b = cur.plan.camAt(t + 0.05).pos; vel.set((b[0] - a[0]) / 0.1, (b[1] - a[1]) / 0.1, (b[2] - a[2]) / 0.1); }
    // the strike: placed round the camera's position AT THE STRIKE (fixed in the world while it flickers)
    const [s, f0] = strikeAt(t);
    let f = 0;
    if (s) {
      const c0 = cur ? cur.plan.camAt(s.t).pos : [camP.x, camP.y, camP.z];
      const x = c0[0] + s.x, z = c0[2] + s.z;
      if (curBolt !== s.id) {
        const segs = boltSegments(s.id + 1, s.y0, s.y1, x, z);
        segs.forEach((sg, i) => { u.uBoltA.value[i].set(...sg[0]); u.uBoltB.value[i].set(...sg[1]); });
        u.uBoltN.value = segs.length; curBolt = s.id;
      }
      u.uFlashPos.value.set(x, (s.y0 + s.y1) / 2, z);
      f = f0 * Math.exp(-Math.max(0, u.uFlashPos.value.distanceTo(camP) - 900) / 2200);
    }
    u.uFlash.value = f; u.uBoltI.value = f;
    streaks.mat.uniforms.uAmt.value = streakK * (camP.y < g.decks[0][0] + 1500 ? 1 : 0.3);
    streaks.update(t, camP, vel);
    if (cur && !baked) { env = bakeEnv(ctx, mat); baked = true; }
    // light for objects at the camera's depth: sunlight fades, the murk tints, the exposure follows (darker, never black)
    const y = camP.y, top = g.decks[0][0], bot = g.decks[nd - 1][1];
    const ls = Math.exp(-Math.max(top - y, 0) / g.lightDepth), dk = clamp((top - y) / (top - bot), 0, 1.3);
    const mi = dk < 0.35 ? 0 : dk < 0.75 ? 1 : 2, mc = g.murk[Math.min(mi, g.murk.length - 1)];
    overrideLights(ctx, {
      dir: st.uSun.value, key: g.sunC.map((v, i) => v * g.lit[0][i] * ls), keyI: 1.6, soft: 3 + dk * 8, hemi: mc.map((v) => v * (0.5 + 0.8 * ls)), gnd: mc.map((v) => v * 0.25), hemiI: 1.2,
      exposure: 0.72 * (1 + 1.1 * Math.min(dk, 1)) * (1 + 0.3 * f), sunColor: [1, 0.97, 0.92],
      fog: mc.map((v) => v * (0.45 + 0.55 * ls)), fogDensity: y < top + 200 ? 0.00035 : 0.00005, fogFalloff: 0.00001,
      env: baked ? env : undefined, envI: 0.7,
    });
  };
  // designed flashes (render.py's frame check: a lightning flash is not a "jump")
  const flashAt = (t) => { const [, f0] = strikeAt(t); return f0; };
  return { ground: { height: () => -1e4, normal: () => [0, 1, 0], level: null }, update, flashAt, hints: { sky: 'space_clouds', fog: 0, haze: 0, biome: name }, root, warnings: [], biome: name };
}
