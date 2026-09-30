// sky.js — the painted sky dome: gradient keyed on the sun, sun disk and glow, a cratered moon, stars and a faint
// Milky Way at night, one layer of lit cumulus/stratus with silver linings, and the same haze as the world at
// the horizon. It follows the camera (also the mirrored one) and is drawn first with no depth.
import * as THREE from 'three';
import { U, FOG_GLSL } from '../lib/shared/env.js';
import { makeNoise } from '../lib/shared/util.js';

const NOISE_GLSL = /* glsl */`
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(h13(i), h13(i+vec3(1,0,0)), u.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), u.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), u.x), u.y), u.z); }
float fbm2(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 6; i++){ s += a * vnoise2(p); p = m * p; a *= 0.5; } return s; }
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise3(p); p *= 2.03; a *= 0.5; } return s; }
`;

export const SKY_UNIFORMS = {
  uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunHorizon: { value: new THREE.Color() },
  uSunI: { value: 1 }, uMoonI: { value: 0 }, uStars: { value: 0 }, uCloud: { value: 0.3 }, uCloudDark: { value: 0 },
  uCloudShift: { value: new THREE.Vector2() }, uMoonTex: { value: null }, uAmb: { value: new THREE.Color() },
  uNightSky: { value: 0 }, uSunSize: { value: 1 }, uMoonSize: { value: 1 }, uMilky: { value: 0.8 }, uStarRot: { value: new THREE.Matrix3() },
  // Q5 cloud slab (set per scene by look.js, see cloudParams): base height and thickness (m), cumulus (1: heaped,
  // crisp-edged, rounded tops; 0: flat stratus), the high cirrus veil, the low storm scud, and the ground's bounce colour
  uCloudBase: { value: 1500 }, uCloudThick: { value: 900 }, uCumulus: { value: 1 }, uCirrus: { value: 0.3 }, uScud: { value: 0 },
  uGndCol: { value: new THREE.Color(0.08, 0.07, 0.05) }, uSunDisk: { value: 1 },
  // E1 v2 night: 0..1 how much of the night look applies (look.js: from env.night), and the faint horizon glow colour
  uNightDim: { value: 0 }, uGlow: { value: new THREE.Color(0, 0, 0) },
};

// per-scene cloud parameters from the resolved cloud cover (0..1) and storm (0..1): scattered/clear skies get
// separate heaped cumulus with flat bases around 1.5 km, overcast a lower soft stratus deck, storms a low (650 m),
// thick, dark base with ragged scud under it
export function cloudParams(cloud, storm) {
  const cu = 1 - smoothJS((cloud - 0.62) / 0.33);
  return {
    base: lerpJS(lerpJS(1550, 1050, smoothJS((cloud - 0.5) / 0.5)), 650, storm),
    thick: lerpJS(lerpJS(lerpJS(700, 1150, smoothJS((cloud - 0.1) / 0.4)), 420, 1 - cu), 1500, storm),
    cumulus: Math.max(cu, storm * 0.55),
    cirrus: (1 - smoothJS((cloud - 0.55) / 0.35)) * 0.55,
    scud: smoothJS((storm - 0.35) / 0.5),
  };
}
const smoothJS = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const lerpJS = (a, b, t) => a + (b - a) * t;

export function makeSky(moonTex) {
  SKY_UNIFORMS.uMoonTex.value = moonTex;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, SKY_UNIFORMS, {
      uTime: U.uTime, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uMoonDir: U.uMoonDir, uMoonColor: U.uMoonColor,
      uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff,
      uFogBase: U.uFogBase, uMirror: U.uMirror,
    }),
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform float uTime; uniform vec3 uSunColor; uniform vec3 uMoonDir; uniform vec3 uMoonColor;
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunHorizon; uniform vec3 uAmb;
      uniform float uSunI; uniform float uMoonI; uniform float uStars; uniform float uCloud; uniform float uCloudDark;
      uniform vec2 uCloudShift; uniform sampler2D uMoonTex; uniform float uNightSky; uniform float uSunSize; uniform float uMoonSize;
      uniform float uMilky; uniform mat3 uStarRot;
      uniform float uSunDisk; uniform float uNightDim; uniform vec3 uGlow;
      ${FOG_GLSL}
      ${NOISE_GLSL}
      vec3 skyBase(vec3 rd){
        float y = max(rd.y, 0.0);
        vec2 sxz = normalize(uSunDir.xz + 1e-5), rxz = normalize(rd.xz + 1e-5);
        float toward = max(dot(sxz, rxz), 0.0);
        vec3 hor = mix(uHorizon, uSunHorizon, pow(toward, 2.2) * smoothstep(-0.35, 0.12, uSunDir.y + 0.3));
        float g = pow(1.0 - y, 4.0);
        vec3 col = mix(uZenith, hor, g);
        // a band of warm light hugging the horizon near the sun at dusk/dawn
        float band = exp(-y * 18.0) * pow(toward, 5.0) * smoothstep(0.35, -0.05, uSunDir.y) * smoothstep(-0.25, -0.02, uSunDir.y);
        col += uSunHorizon * band * 0.6;
        return col;
      }
      void main(){
        vec3 rd = normalize(vDir);
        vec3 col = skyBase(rd);
        float mu = dot(rd, uSunDir);
        // sun glow + disk
        col += uSunColor * uSunI * (pow(max(mu, 0.0), 12.0) * 0.06 + pow(max(mu, 0.0), 220.0) * 0.18);
        float sang = sqrt(max(2.0 * (1.0 - mu), 0.0));            // angle to the sun (rad)
        float sunR = 0.0095 * uSunSize;
        float disk = smoothstep(sunR * 1.12, sunR * 0.88, sang);
        col += uSunColor * disk * 42.0 * uSunDisk * mix(0.3, 1.0, smoothstep(0.0, 0.25, uSunDir.y)) * step(0.0, rd.y + 0.01) * smoothstep(-0.02, 0.0, uSunDir.y + 0.02);
        // night: stars and the Milky Way
        float nightVis = uStars * smoothstep(-0.02, 0.2, rd.y);
        if (nightVis > 0.001) {
          vec3 rs = uStarRot * rd;
          vec3 p = rs * 360.0;
          vec3 ci = floor(p), cf = fract(p);
          float h = h13(ci);
          if (h > 0.9) {
            vec3 sp = vec3(h13(ci + 1.7), h13(ci + 3.3), h13(ci + 5.1)) * 0.6 + 0.2;
            float d = length(cf - sp);
            float mag = pow((h - 0.9) / 0.1, 6.0);
            float tw = 0.75 + 0.25 * sin(uTime * (2.0 + h * 5.0) + h * 40.0);
            vec3 sc = mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.84, 1.0), h13(ci + 9.0));
            col += sc * smoothstep(0.09, 0.0, d) * (0.4 + 3.2 * mag) * tw * nightVis;
          }
          // fainter dust of stars
          vec3 q = rs * 900.0; vec3 qi = floor(q);
          float h2 = h13(qi);
          // (E1 v2: the water's mirror shows only the brighter stars: the faint dust read as rain streaks on a calm sea)
          if (h2 > 0.965 && uMirror < 0.5) col += vec3(0.8, 0.85, 1.0) * smoothstep(0.35, 0.0, length(fract(q) - 0.5)) * 0.35 * nightVis;
          // E1 v2: a clear night far from land is crowded with stars: a third, dense layer of faint ones
          if (uNightDim > 0.0 && uMirror < 0.5) { vec3 q3 = rs * 1500.0; float h3 = h13(floor(q3) + 17.0);
            if (h3 > 0.955) col += vec3(0.85, 0.88, 1.0) * smoothstep(0.32, 0.0, length(fract(q3) - 0.5)) * (0.16 + 0.5 * pow((h3 - 0.955) / 0.045, 4.0)) * nightVis * uNightDim; }
          vec3 gn = normalize(vec3(0.35, 0.55, -0.76));
          float band = exp(-pow(dot(rs, gn) / 0.16, 2.0));
          float mw = fbm3(rs * 6.0) * 0.8 + fbm3(rs * 18.0) * 0.4;
          float lane = smoothstep(0.52, 0.72, fbm3(rs * 9.0 + 4.0));
          col += vec3(0.55, 0.6, 0.78) * band * mw * (1.0 - lane * 0.35) * 0.075 * nightVis * uMilky;   // E1 v2: a soft dust lane (a strong one read as a dark smudge)
        }
        // the moon: cratered disk with a soft halo
        float mm = dot(rd, uMoonDir);
        float moonR = 0.0105 * uMoonSize;
        if (uMoonI > 0.0) {
          vec3 mx = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
          vec3 my = cross(uMoonDir, mx);
          vec2 muv = vec2(dot(rd, mx), dot(rd, my)) / moonR;
          float r2 = dot(muv, muv);
          if (r2 < 1.0 && mm > 0.0) {
            float alb = texture2D(uMoonTex, muv * 0.5 + 0.5).r;
            float limb = sqrt(1.0 - r2);
            col = mix(col, uMoonColor * alb * (0.55 + 0.45 * limb) * 5.0, smoothstep(1.0, 0.92, r2) * min(uMoonI * 3.0, 1.0));
          }
          col += uMoonColor * uMoonI * (pow(max(mm, 0.0), 2500.0) * 0.6 + pow(max(mm, 0.0), 80.0) * 0.012);
        }
        // the world's haze at the horizon (the clouds, drawn in their own pass, get the haze of their distance)
        float fa = wfogAmount(cameraPosition, rd, 16000.0);
        col = mix(col, wfogColor(rd), fa * 0.9);
        // E1 v2: the faint glow of a clear night's horizon, over the haze (under it the haze ate it and a wide night
        // shot lost its horizon: sea and sky one tone)
        col += uGlow * (exp(-max(rd.y, 0.0) * 16.0) + 0.7 * exp(-max(rd.y, 0.0) * 70.0)) * step(-0.02, rd.y);
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false, depthTest: false, side: THREE.BackSide, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e6;
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); mesh.updateMatrixWorld(); };
  mesh.name = 'sky';
  const clouds = makeClouds();
  mesh.add(clouds); mesh.userData.clouds = clouds;
  return mesh;
}

// ── the cloud pass (Q5) ─────────────────────────────────────────────────────────────────────────────────────────
// A slab of cloud marched as an implicit volume over a flat base: heaped cumulus towers (flat grey bases, bulging
// sunlit and shaded sides, self-shadow toward the sun, bright thin edges), a flat stratus/storm deck with rolls and
// lumps in its base, a high cirrus veil and, for storms, low ragged scud. Drawn last among the opaque objects with a
// depth test at the far plane, so pixels covered by the world never run it; premultiplied alpha over the painted sky.
// Every layer drifts with uCloudShift, a function of t only. In the water mirror (uMirror) a cheaper path runs.
const CLOUD_GLSL = /* glsl */`
float fbmC(vec2 p, int oct){ float s = 0.0, a = 0.5, n = 0.0; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++){ if (i >= oct) break; s += a * vnoise2(p); n += a; p = m * p; a *= 0.5; } return s / n; }
// f > 0 inside. dd: the 2D cover (0 at a cloud's edge, ~1 in its core); cumulus towers narrow toward the top (taper)
// and bulge in 3D (billowy detail); stratus is a deck over the whole cover, a full deck has no holes; a storm is local:
// far out its lid breaks up and the brighter sky beyond shows as a band under it. (oct, det: kept for the callers,
// the baked field carries every octave)
float gCl = 0.5;                                     // the cluster field, read once per ray at its slab entry (cloudSlab)
float cloudF(vec3 q, int oct, float soft, bool det){
  // the cover: the baked 5-octave field (R, period 16 cells), domain-warped by two slower fields (G, B)
  float cu = uCumulus * (1.0 - uCloudDark);
  vec2 uv = (q.xz * mix(0.00034, 0.00045, cu) + uCloudShift * 1.55) / 16.0;
  vec2 w = texture2D(uCloudTex, uv * 0.45 + vec2(0.31, 0.77)).gb - 0.5;
  float d = texture2D(uCloudTex, uv + w * 0.125).r;
  // heaped clouds come in clusters with wide gaps between them (a 10 km field shifts the cover up and down)
  float cl = gCl;
  float dd = (d - (0.78 - 0.6 * pow(uCloud, 1.6)) - (0.5 - cl) * 0.85 * cu) / (0.32 + soft);
  dd = mix(dd, max(dd, 0.2), smoothstep(0.9, 1.0, uCloud) * (1.0 - uCumulus));
  dd -= smoothstep(0.5, 1.0, uCloudDark) * 1.1 * smoothstep(10000.0, 26000.0, length(q.xz - cameraPosition.xz));
  // far heaped clouds read as a flatter layer toward the horizon (less of each tower, more of the field)
  float h = clamp((q.y - uCloudBase) / (uCloudThick * mix(1.0, 0.5, cu * smoothstep(5000.0, 22000.0, length(q.xz - cameraPosition.xz)))), 0.0, 1.0);
  // bulges: billowy detail (A: 380 m and 190 m cells), sheared with height so they are not straight extrusions
  float bil = texture2D(uCloudTex, (q.xz + q.y * vec2(0.62, 0.37)) / 24320.0 + uCloudShift * 0.17).a;
  return dd * mix(3.0, 1.0, uCumulus) - mix(h * 0.9, 1.1 * pow(h, 1.4), uCumulus) + mix(0.12, 0.34, uCumulus) * (bil - 0.5);
}
// the first entry of the ray into the cloud: a coarse march and bisection steps on f; returns the coverage (alpha)
// and the entry point. The coarse start is offset per pixel and per sub-frame (uTime differs between the sub-frames
// of one frame, so a frame is still a pure function of t): solid cloud refines to the same surface whatever the
// offset, only features thinner than a step turn into soft edges when the sub-frames average
float cloudSlab(vec3 ro, vec3 rd, bool cheap, out vec3 Phit){
  Phit = ro;
  float ry = max(rd.y, 0.004), hb = uCloudBase;
  float t0 = max((hb - ro.y) / ry, 0.0), t1 = min((hb + uCloudThick - ro.y) / ry, t0 + 24000.0);
  if (t1 <= 0.0) return 0.0;
  float soft = 0.25 * smoothstep(3000.0, 26000.0, t0);
  vec3 pe = ro + rd * t0;
  gCl = texture2D(uCloudTex, pe.xz * 0.0000105 + uCloudShift * 0.02 + vec2(0.13, 0.71)).b;
  int N = cheap ? 10 : 18;
  float dt = (t1 - t0) / float(N);
  float ta = t0, tb = -1.0, fb = 0.0;
  float jit = fract(sin(dot(gl_FragCoord.xy + fract(uTime * 7.13) * 97.0, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i <= 18; i++){
    if (i > N) break;
    float t = t0 + (float(i) + (i == 0 ? 0.0 : jit - 0.5)) * dt + 1.0;
    float f = cloudF(ro + rd * t, 3, soft, false);
    if (f > 0.0) { tb = t; fb = f; break; }
    ta = t;
  }
  if (tb < 0.0) return 0.0;
  if (tb > t0 + 1.5) {
    for (int k = 0; k < 4; k++){
      if (cheap && k >= 2) break;
      float m = 0.5 * (ta + tb);
      float f = cloudF(ro + rd * m, 3, soft, false);
      if (f > 0.0) { tb = m; fb = f; } else ta = m;
    }
  }
  Phit = ro + rd * tb;
  // coverage: how far inside the ray gets just behind the entry (grazing edges stay thin and soft)
  float f2 = cloudF(ro + rd * (tb + min(dt * 0.5, 400.0)), 3, soft, false);
  return smoothstep(0.0, 0.12 + soft, max(f2, fb));
}
// the base's relief (rolls and lumps hanging down, 0..1): storms and stratus show it as light and shade
float baseRelief(vec2 xz){
  vec2 q = xz * 0.0008 + uCloudShift * 2.2;
  float rolls = vnoise2(vec2(q.x * 0.6, q.y) * 0.8 + 2.0);
  float lumps = smoothstep(0.15, 0.85, vnoise2(q * 2.2 + 7.0));
  return rolls * 0.55 + lumps * 0.45;
}
vec3 shadeCloud(vec3 P, vec3 rd, bool cheap){
  bool day = uSunDir.y > -0.1;
  vec3 L = day ? uSunDir : uMoonDir;
  vec3 lc = day ? uSunColor * uSunI : uMoonColor * uMoonI * 0.35;
  float hb = uCloudBase;
  float hy = clamp(P.y - hb, 0.0, uCloudThick);
  float dist = length(P.xz - cameraPosition.xz);
  // the surface normal: minus the gradient of f (with the bulges); at the floor of the slab the base faces down
  float e = 70.0 + 0.004 * dist;
  int oc = cheap ? 2 : 3;
  float f0 = cloudF(P, oc, 0.0, !cheap);
  vec3 g = vec3(cloudF(P + vec3(e, 0.0, 0.0), oc, 0.0, !cheap), cloudF(P + vec3(0.0, e, 0.0), oc, 0.0, !cheap), cloudF(P + vec3(0.0, 0.0, e), oc, 0.0, !cheap)) - f0;
  vec3 Nh = -normalize(g + vec3(0.0, 1e-4, 0.0));
  float wb = 1.0 - smoothstep(0.0, 40.0 + 0.004 * dist, hy);
  // the underside: relief from the rolls/lumps (a bump map), strongest in storms
  float eb = 160.0 + 0.006 * dist, r0 = baseRelief(P.xz);
  float rx = baseRelief(P.xz + vec2(eb, 0.0)) - r0, rz = baseRelief(P.xz + vec2(0.0, eb)) - r0;
  float rk = 400.0 * (0.2 + 0.8 * uCloudDark) * (1.0 - 0.6 * uCumulus * (1.0 - uCloudDark));
  vec3 Nb = normalize(vec3(rx * rk / eb, -1.0, rz * rk / eb));
  vec3 N = normalize(mix(Nh, Nb, wb));
  // self-shadow: cloud between the point and the light (2 taps; decks soft, no hard-edged lit patches)
  float occ = 0.8;
  if (!cheap) {
    occ = 0.0;
    for (int k = 1; k <= 2; k++){
      vec3 s = P + L * (float(k * k) * 170.0);
      occ += 1.5 * smoothstep(-0.05, mix(1.2, 0.3, uCumulus), cloudF(s, 2, 0.0, false));
    }
  }
  float thick = clamp(cloudF(P + rd * 300.0, 2, 0.0, false) * mix(0.6, 1.5, uCumulus), 0.0, 1.0);     // how solid behind the entry
  float sh = exp(-occ * 1.1);
  float lam = clamp(dot(N, L) * 0.65 + 0.35, 0.0, 1.0);
  float thin = 1.0 - thick;
  float fwd = pow(max(dot(rd, L), 0.0), 5.0);
  // a deck's upper side is rarely seen from below: only a trace of direct sun on it (holes stay soft)
  vec3 col = lc * (0.30 * lam * sh * mix(0.4, 1.0, uCumulus) + (0.08 + 0.5 * fwd) * thin * (1.0 - 0.6 * uCloudDark));
  // skylight (heaped tops see more of it) and the ground's bounce on the underside; a heaped cloud's base is
  // lighter at its thin rim than under its thick middle
  col += uAmb * (0.5 + 0.5 * uCumulus * hy / uCloudThick) * mix(1.0, 0.82 - 0.22 * thick * uCumulus, wb) + uGndCol * wb * 0.6;
  // under a thick deck the light that reaches the base comes in low from the brighter distance: the lumps facing it
  // catch it, the others fall into shade
  vec3 Lh = normalize(vec3(L.x, 0.18, L.z));
  float side = clamp(dot(Nb, Lh) * 1.6 + 0.35, 0.0, 1.4);
  float deck = wb * (1.0 - uCumulus * (1.0 - uCloudDark));
  col *= mix(1.0, 0.55 + 0.6 * side, deck * (0.45 + 0.55 * uCloudDark));
  // storm: a thick cloud absorbs most of the light before the base, darkest overhead (the core is above you),
  // lighter far out where it thins
  float core = mix(0.2, 0.62, smoothstep(1500.0, 18000.0, dist));
  col *= mix(1.0, core * (0.75 + 0.5 * r0) + 0.3 * thin, uCloudDark);
  // E1 v2 night: a cloud at night is a dark, low-contrast shape a little off the sky's colour, with at most a faint
  // moonlit rim (the moonlit tops at night exposure read as bright white cotton balls)
  vec3 nightCol = uAmb * (0.5 + 0.2 * lam) + lc * (0.05 + 0.1 * pow(1.0 - clamp(dot(N, -rd), 0.0, 1.0), 3.0)) * lam * sh;
  return mix(col, nightCol, uNightDim);
}
`;

// the cloud field, baked once per page: 512 x 512 RGBA8, tileable. R: 5-octave fbm (period 16 cells, the cover),
// G, B: 3-octave fbm at half the frequency (the domain warp), A: billow detail (64 and 128 cells per period). R, G, B
// are remapped to mean 0.5 / sd 0.12, the statistics the cover thresholds were tuned on (value-noise fbm).
let CLOUD_TEX = null;
function cloudTexture() {
  if (CLOUD_TEX) return CLOUD_TEX;
  const N = 512, P = 16;
  const nz = [makeNoise(4101), makeNoise(4203), makeNoise(4307), makeNoise(4409)];
  const ch = [0, 1, 2, 3].map(() => new Float32Array(N * N));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N * P, v = y / N * P, i = y * N + x;
    ch[0][i] = nz[0].fbm2(u, v, 5, 2, 0.5, P, P);
    ch[1][i] = nz[1].fbm2(u * 0.5 + 3.3, v * 0.5 + 1.1, 3, 2, 0.5, P / 2, P / 2);
    ch[2][i] = nz[2].fbm2(u * 0.5 + 7.7, v * 0.5 + 5.5, 3, 2, 0.5, P / 2, P / 2);
    ch[3][i] = (1 - Math.abs(nz[3].noise2(u * 4, v * 4, P * 4, P * 4))) * 0.65 + (1 - Math.abs(nz[3].noise2(u * 8 + 3.7, v * 8 + 1.9, P * 8, P * 8))) * 0.35;
  }
  const d = new Uint8Array(N * N * 4);
  for (let c = 0; c < 4; c++) {
    const a = ch[c]; let m = 0, q = 0;
    for (let i = 0; i < a.length; i++) { m += a[i]; q += a[i] * a[i]; }
    m /= a.length; const sd = Math.sqrt(Math.max(q / a.length - m * m, 1e-9));
    for (let i = 0; i < a.length; i++) {
      const v = c < 3 ? 0.5 + (a[i] - m) / sd * 0.12 : a[i];
      d[i * 4 + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; t.userData.keep = true;
  return (CLOUD_TEX = t);
}

function makeClouds() {
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, SKY_UNIFORMS, {
      uTime: U.uTime, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uMoonDir: U.uMoonDir, uMoonColor: U.uMoonColor,
      uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff,
      uFogBase: U.uFogBase, uMirror: U.uMirror, uCloudTex: { value: cloudTexture() },
    }),
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform float uTime; uniform vec3 uSunColor; uniform vec3 uMoonDir; uniform vec3 uMoonColor; uniform vec3 uAmb;
      uniform float uSunI; uniform float uMoonI; uniform float uCloud; uniform float uCloudDark; uniform vec2 uCloudShift;
      uniform float uCloudBase; uniform float uCloudThick; uniform float uCumulus; uniform float uCirrus; uniform float uScud; uniform vec3 uGndCol;
      uniform sampler2D uCloudTex; uniform float uNightDim;
      ${FOG_GLSL}
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      void main(){
        vec3 rd = normalize(vDir);
        if (rd.y <= 0.0 || uCloud < 0.01) discard;
        vec3 ro = cameraPosition;
        bool cheap = uMirror > 0.5;
        float ry = max(rd.y, 0.004);
        float fa = wfogAmount(ro, rd, 16000.0);
        vec3 fogc = wfogColor(rd);
        bool day = uSunDir.y > -0.1;
        vec3 L = day ? uSunDir : uMoonDir;
        vec3 lc = day ? uSunColor * uSunI : uMoonColor * uMoonI * 0.35;
        vec3 C = vec3(0.0); float A = 0.0;                       // premultiplied, far layers first
        // cirrus veil at ~7.5 km: thin combed streaks, bright, lit through
        if (uCirrus > 0.01) {
          vec2 cp = ro.xz + rd.xz * ((7500.0 - ro.y) / ry);
          cp = mat2(0.87, 0.5, -0.5, 0.87) * cp * vec2(0.00011, 0.00042) + uCloudShift * 0.7 + 5.3;
          float n = fbmC(cp + vec2(0.0, vnoise2(cp * 0.3) * 1.6), cheap ? 3 : 5);
          float a = smoothstep(0.52, 0.8, n) * uCirrus * smoothstep(0.015, 0.2, rd.y) * (1.0 - uCloudDark) * 0.55 * (1.0 - 0.75 * uNightDim);
          vec3 cc = mix(lc * (0.12 + 0.6 * pow(max(dot(rd, L), 0.0), 6.0)) * (1.0 - 0.8 * uNightDim) + uAmb * 1.05, fogc, fa * 0.9);
          C = cc * a + C * (1.0 - a); A = a + A * (1.0 - a);
        }
        vec3 P;
        float ca = cloudSlab(ro, rd, cheap, P) * smoothstep(0.0, 0.03, rd.y);
        if (ca > 0.002) {
          vec3 cc = mix(shadeCloud(P, rd, cheap), fogc, wfogAmount(ro, rd, length(P - ro)) * 0.9);
          C = cc * ca + C * (1.0 - ca); A = ca + A * (1.0 - ca);
        }
        // storm scud at ~420 m: ragged fragments racing under the base
        if (uScud > 0.01) {
          float ts = (420.0 - ro.y) / ry;
          if (ts > 0.0) {
            vec2 sp = (ro.xz + rd.xz * ts) * 0.0016 + uCloudShift * 6.0;
            float n = fbmC(sp + vec2(vnoise2(sp * 0.5 + 1.3), vnoise2(sp * 0.5 + 4.1)) * 0.8, cheap ? 2 : 4);
            float a = smoothstep(0.55, 0.8, n) * uScud * smoothstep(0.0, 0.05, rd.y) * (1.0 - smoothstep(5000.0, 13000.0, ts)) * 0.8;
            vec3 cc = mix((uAmb * 0.8 + uGndCol * 0.3) * (0.8 + 0.4 * n), fogc, wfogAmount(ro, rd, ts) * 0.9);
            C = cc * a + C * (1.0 - a); A = a + A * (1.0 - a);
          }
        }
        if (A < 0.001) discard;
        gl_FragColor = vec4(C, A);
      }`,
    depthWrite: false, depthTest: true, side: THREE.BackSide, fog: false, transparent: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = 1e6;                                         // after every opaque object, before the transparent ones
  m.name = 'sky.clouds'; m.userData.noQA = true;
  return m;
}

export function applySkyEnv(e, amb) {
  const S = SKY_UNIFORMS;
  S.uZenith.value.setRGB(...e.zenith);
  S.uHorizon.value.setRGB(...e.horizon);
  S.uSunHorizon.value.setRGB(...e.sunHorizon);
  S.uAmb.value.setRGB(...e.amb).multiplyScalar(e.ambI * 2.2);
  S.uSunI.value = Math.max(e.sunI, 0.0) + (e.sunEl > -4 ? 0.4 : 0);
  S.uMoonI.value = e.moonI;
  S.uStars.value = e.stars;
  S.uCloud.value = e.cloud;
  S.uCloudDark.value = e.cloudDark;
}
