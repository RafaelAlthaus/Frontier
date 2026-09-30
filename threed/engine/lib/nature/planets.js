// planets.js — E4 (v2, 27 Sep 2026): the Solar System from space ("How Long You'd Last on Every Planet").
//   space.mercury space.venus space.jupiter space.saturn space.uranus space.neptune space.pluto (+ space.mars and
//   space.moon, built here for space.js), space.solar_system, space.lineup.
// Every body is a procedural shader on a sphere (no textures, no seams: 3D noise on the unit sphere, detail faded by the
// pixel footprint so a far dot does not shimmer and a 1080p flyby still has structure), lit by ONE space sun per scene
// (spaceState: `look.sun` {az, el} or `world.sun` if given, else the first body's `phase` solved against the planned
// camera at mid-shot, else the look's sun). Rings (Saturn, Uranus, Neptune) are a lit annulus with the real radial
// profile (C, B, Cassini division, A with the Encke gap, F), the planet's shadow on them and their shadow on the globe.
// A back-face halo shell draws the atmosphere outside the limb (forward-scattering glow when backlit: Pluto's blue
// haze, Venus's bright ring). Orientation: `lon`/`lat` = the point facing the camera (at mid-shot; `face`), `tilt`
// leans the north pole to the viewer's right. Everything is a function of t.
import * as THREE from 'three';
import { U, dirFromAzEl } from '../shared/env.js';
import { clamp, lerp } from '../shared/util.js';
import { NOISE_GLSL } from './tex.js';

const DEG = Math.PI / 180;

// ── one sun per space scene ─────────────────────────────────────────────────────────────────────────────────────────
// ctx.e4space = { uSun: {value: Vector3 (toward the sun)}, explicit, phase, faces, resolve() }. Bodies, rings, halos,
// the star sphere's sun disc (space.js) and the space camera moves (core/spacecam.js) share it.
export function spaceState(ctx) {
  if (!ctx) return { uSun: { value: U.uSunDir.value.clone() }, faces: [], resolve() {}, setExplicit() {} };
  if (ctx.e4space) return ctx.e4space;
  const st = { uSun: { value: new THREE.Vector3(0.62, 0.22, 0.75).normalize() }, explicit: null, phase: null, faces: [], done: false, ctx };
  const ls = ctx.lookSpec && ctx.lookSpec.sun;
  if (ls && Number.isFinite(+ls.az)) st.explicit = dirFromAzEl(+ls.az, Number.isFinite(+ls.el) ? +ls.el : 15, new THREE.Vector3());
  st.setExplicit = (v) => { st.explicit = v.clone().normalize(); st.uSun.value.copy(st.explicit); st.done = false; };
  st.resolve = () => resolveSpace(st);
  ctx.e4space = st;
  return st;
}
export function sunFromSpec(s) {
  if (Array.isArray(s) && s.length >= 3) return new THREE.Vector3(+s[0], +s[1], +s[2]).normalize();
  if (s && typeof s === 'object' && Number.isFinite(+s.az)) return dirFromAzEl(+s.az, Number.isFinite(+s.el) ? +s.el : 15, new THREE.Vector3());
  return null;
}
// the loaded scene with its camera plan (null while the scene is being built / planned): the page's own handle
export function planOf(ctx) { const c = globalThis.__f3d && globalThis.__f3d.cur; return c && c.ctx === ctx && c.plan ? c : null; }
function resolveSpace(st) {
  if (st.done) return;
  const cur = planOf(st.ctx);
  if (!cur) { st.uSun.value.copy(st.explicit || U.uSunDir.value); return; }        // planning: provisional
  const D = cur.dur || 8, cam = cur.plan.camAt(D / 2);
  const pos = new THREE.Vector3(...cam.pos), look = new THREE.Vector3(...cam.look);
  for (const f of st.faces) { try { f(pos); } catch (e) { console.error(e); } }
  if (st.explicit) st.uSun.value.copy(st.explicit);
  else if (st.phase) {
    // `phase` (deg): 0 full, 90 half, 150 a crescent, 180 backlit; the lit side toward phase_side of the frame
    const P = st.phase, C = P.center(), V = pos.clone().sub(C).normalize();
    const F = look.clone().sub(pos).normalize(), up = new THREE.Vector3(0, 1, 0);
    const R = new THREE.Vector3().crossVectors(F, up); if (R.lengthSq() < 1e-6) R.set(1, 0, 0); R.normalize();
    const Up = new THREE.Vector3().crossVectors(R, F).normalize();
    const side = P.side === 'left' ? R.clone().negate() : P.side === 'top' ? Up.clone() : P.side === 'bottom' ? Up.clone().negate() : R.clone();
    side.addScaledVector(V, -side.dot(V)).normalize();
    const L = V.clone().multiplyScalar(Math.cos(P.phase * DEG)).addScaledVector(side, Math.sin(P.phase * DEG));
    const upO = Up.clone().addScaledVector(L, -Up.dot(L)); if (upO.lengthSq() > 1e-6) { upO.normalize(); const el = (P.el ?? 10) * DEG; L.multiplyScalar(Math.cos(el)).addScaledVector(upO, Math.sin(el)); }
    st.uSun.value.copy(L.normalize());
  } else st.uSun.value.copy(U.uSunDir.value);
  st.done = true;
}

// ── GLSL ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const COMMON = /* glsl */`
#define DEG 0.0174532925
float sat(float x){ return clamp(x, 0.0, 1.0); }
float sq(float x){ return x * x; }
// a crater layer of cell scale S shows only where its craters span a few pixels (else the jittered cells read as a grid)
float kS(float S, float px){ return 1.0 - smoothstep(0.025, 0.07, S * px); }
float band(float x, float a, float b, float w){ return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
vec3 rotY(vec3 d, float a){ float c = cos(a), s = sin(a); return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z); }
float wrapA(float a){ return mod(a + PI, 2.0 * PI) - PI; }
float n1(float x){ float i = floor(x), f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(n_h12(vec2(i, 7.1)), n_h12(vec2(i + 1.0, 7.1)), u); }
// a 1D texture along the ring radius, faded to its mean where a pixel covers several of its cells
float n1f(float x, float fw){ return mix(n1(x), 0.5, smoothstep(0.25, 1.0, fw)); }
`;
// craters on the unit sphere: (bowl, rim, fresh ejecta)
const CRATERS = /* glsl */`
vec3 craters(vec3 d, float s, float seed, float dens){
  vec3 p = d * s; vec3 i = floor(p); float bowl = 0.0, rim = 0.0, ej = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 c = i + vec3(float(x), float(y), float(z));
    float h = n_h13(c + seed);
    if (h > dens) continue;
    vec3 cp = c + 0.2 + 0.6 * vec3(n_h13(c + 1.3 + seed), n_h13(c + 2.9 + seed), n_h13(c + 4.1 + seed));
    float r = 0.16 + 0.3 * n_h13(c + 7.7 + seed);
    float dd = length(p - cp) / r;
    if (dd > 3.2) continue;
    bowl += (1.0 - smoothstep(0.0, 1.0, dd)) * 0.5;
    rim += exp(-sq((dd - 1.0) / 0.18));
    float fresh = step(0.86, n_h13(c + 11.3 + seed));
    ej += fresh * exp(-max(dd - 1.0, 0.0) * 2.2) * (0.6 + 0.4 * step(dd, 1.0));
  }
  return vec3(bowl, rim, ej);
}
// a young crater's bright ray system around the unit direction c (angular radius r)
float rays(vec3 d, vec3 c, float r){
  float dc = acos(clamp(dot(d, c), -1.0, 1.0));
  if (dc > r * 14.0) return 0.0;
  vec3 t1 = normalize(cross(c, abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(c, t1);
  float a = atan(dot(d, t2), dot(d, t1));
  float st = smoothstep(0.5, 0.85, n_fbm2(vec2(a * 7.0, dc / r * 0.08), 3)) * exp(-dc / (r * 5.0));
  float halo = exp(-pow(max(dc - r, 0.0) / (r * 1.2), 1.5));
  return clamp(st * 1.2 + halo * 0.8, 0.0, 1.5) * smoothstep(r * 0.6, r * 1.05, dc) + (1.0 - smoothstep(r * 0.7, r, dc)) * 0.35;
}
`;
// ring radial profiles, radius in planet radii -> tau (x) and the particle colour (albedo); fw = the pixel footprint
const RINGS = /* glsl */`
float thinB(float r, float c, float w, float fw){ float W = max(w, fw); return (w / W) * (1.0 - smoothstep(W * 0.5, W * 0.5 + fw * 0.5 + 1e-5, abs(r - c))); }
vec4 ringProfile(float r, float fw, float kind){
  float tau = 0.0; vec3 col = vec3(0.8);
  if (kind < 1.5) {                                        // Saturn
    float w = max(fw, 0.0015);
    float D = band(r, 1.11, 1.236, w) * 0.004;
    float C = band(r, 1.239, 1.527, w) * (0.07 + 0.08 * n1f(r * 160.0, fw * 160.0) + 0.05 * smoothstep(1.43, 1.52, r));
    float Bk = band(r, 1.527, 1.951, w);
    float B = Bk * (1.0 + 1.5 * smoothstep(1.53, 1.72, r) - 0.35 * smoothstep(1.86, 1.95, r) + 0.9 * (n1f(r * 240.0, fw * 240.0) - 0.5) + 0.8 * (n1f(r * 55.0 + 3.0, fw * 55.0) - 0.5));
    float cas = band(r, 1.951, 2.027, w) * 0.05 * (0.6 + 0.8 * n1f(r * 300.0, fw * 300.0));
    float Ak = band(r, 2.027, 2.269, w) * (1.0 - thinB(r, 2.214, 0.0055, fw)) * (1.0 - thinB(r, 2.265, 0.0012, fw));
    float A = Ak * (0.62 + 0.3 * (n1f(r * 320.0, fw * 320.0) - 0.5) - 0.16 * smoothstep(2.12, 2.26, r));
    float F = thinB(r, 2.326, 0.004, fw) * 0.25;
    tau = D + C + B + cas + A + F;
    col = vec3(0.5, 0.46, 0.42) * (C + D + cas) + vec3(0.86, 0.76, 0.6) * B + vec3(0.74, 0.7, 0.63) * A + vec3(0.75) * F;
    col /= max(tau, 1e-4);
  } else if (kind < 2.5) {                                 // Uranus: narrow dark rings, the epsilon ring the brightest
    tau = 0.7 * thinB(r, 1.955, 0.014, fw);
    tau += 0.35 * (thinB(r, 1.637, 0.003, fw) + thinB(r, 1.652, 0.003, fw) + thinB(r, 1.666, 0.003, fw) + thinB(r, 1.751, 0.003, fw)
                 + thinB(r, 1.786, 0.003, fw) + thinB(r, 1.834, 0.004, fw) + thinB(r, 1.863, 0.003, fw) + thinB(r, 1.901, 0.004, fw));
    tau += 0.01 * band(r, 1.6, 2.0, max(fw, 0.002));
    col = vec3(0.34, 0.35, 0.36);
  } else {                                                 // Neptune: faint dusty rings (Galle, Le Verrier, Adams)
    tau = 0.03 * band(r, 1.62, 1.72, max(fw, 0.002)) + 0.08 * thinB(r, 2.15, 0.006, fw) + 0.1 * thinB(r, 2.54, 0.006, fw) + 0.006 * band(r, 2.15, 2.54, max(fw, 0.002));
    col = vec3(0.45, 0.43, 0.42);
  }
  return vec4(col, tau);
}
`;

const PLANET_VS = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uObl;
  varying vec3 vN; varying vec3 vP; varying vec3 vL;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vL = normalize(position * vec3(1.0, 1.0 / uObl, 1.0));
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }`;

// per-body surface code: sets `alb` (albedo) and `hgt` (relief for the bump) from d (the unit direction, body frame)
const SURF = {
  mercury: /* glsl */`
    float big = n_fbm3(d * 1.7 + 11.0 + uSeed, 5);
    float plains = smoothstep(0.52, 0.62, big);
    alb = mix(vec3(0.33, 0.315, 0.3), vec3(0.43, 0.405, 0.37), plains);
    alb = mix(alb, vec3(0.2, 0.205, 0.215), smoothstep(0.6, 0.72, n_fbm3(d * 3.3 + 5.0 + uSeed, 4)) * 0.55);
    alb *= 0.86 + 0.28 * n_fbm3(d * 14.0, 4);
    vec3 c1 = craters(d, 5.0, 1.0 + uSeed, 0.5), c2 = craters(d, 14.0, 3.0 + uSeed, 0.5) * kS(14.0, px), c3 = craters(d, 38.0, 5.0 + uSeed, 0.55) * kS(38.0, px);
    float cr = 1.0 - plains * 0.65;
    hgt = (-c1.x * 0.8 + c1.y * 0.45 - c2.x * 0.4 + c2.y * 0.25) * cr + (-c3.x * 0.16 + c3.y * 0.1 + n_fbm3(d * 40.0, 3) * 0.12) * fk;
    float k4 = kS(100.0, px); if (k4 > 0.01) { vec3 c4 = craters(d, 100.0, 7.0 + uSeed, 0.55); hgt += (-c4.x * 0.06 + c4.y * 0.04) * k4; alb += c4.z * 0.05 * k4; }
    alb += (c2.z * 0.07 + c3.z * 0.09) * vec3(1.0, 0.98, 0.95);
    alb += vec3(0.95, 0.93, 0.9) * (rays(d, normalize(vec3(0.35, -0.42, 0.84)), 0.03) * 0.2 + rays(d, normalize(vec3(-0.62, 0.28, 0.73)), 0.018) * 0.16 + rays(d, normalize(vec3(0.1, 0.8, -0.6)), 0.025) * 0.18);
    { // the Caloris basin: a huge ringed plain
      vec3 cc = normalize(vec3(-0.75, 0.45, -0.5)); float dc = acos(clamp(dot(d, cc), -1.0, 1.0));
      alb = mix(alb, vec3(0.45, 0.42, 0.37), (1.0 - smoothstep(0.38, 0.44, dc)) * 0.6);
      hgt += 0.35 * (exp(-sq((dc - 0.44) / 0.02)) + 0.6 * exp(-sq((dc - 0.52) / 0.025)));
    }`,
  moon: /* glsl */`
    float mar = smoothstep(0.47, 0.55, n_fbm3(d * 1.8 + 1.7 + uSeed, 5) + 0.14 * dot(d, normalize(vec3(-0.35, 0.4, 1.0))) - 0.05);
    alb = mix(vec3(0.54, 0.53, 0.51), vec3(0.22, 0.22, 0.23), mar) * (0.86 + 0.28 * n_fbm3(d * 14.0, 4));
    vec3 c1 = craters(d, 6.0, 1.0 + uSeed, 0.4), c2 = craters(d, 17.0, 3.0 + uSeed, 0.34) * kS(17.0, px), c3 = craters(d, 45.0, 5.0 + uSeed, 0.3) * kS(45.0, px);
    float cr = 1.0 - mar * 0.7;
    hgt = (-c1.x * 0.7 + c1.y * 0.4 - c2.x * 0.35 + c2.y * 0.22) * cr + (-c3.x * 0.14 + c3.y * 0.09 + n_fbm3(d * 30.0, 4) * 0.15) * fk;
    float k4 = kS(110.0, px); if (k4 > 0.01) { vec3 c4 = craters(d, 110.0, 7.0 + uSeed, 0.45); hgt += (-c4.x * 0.05 + c4.y * 0.035) * k4; }
    alb += (c2.y * 0.05 + c3.y * 0.05 + c2.z * 0.06 + c3.z * 0.08);
    alb += vec3(0.9) * rays(d, normalize(vec3(-0.14, -0.68, 0.72)), 0.022) * 0.22;     // Tycho
    alb += vec3(0.9) * rays(d, normalize(vec3(-0.3, 0.17, 0.94)), 0.02) * 0.14;       // Copernicus`,
  mars: /* glsl */`
    float la = asin(clamp(d.y, -1.0, 1.0)), lo = atan(d.x, d.z), laD = la / DEG, loD = lo / DEG;
    float nA = n_fbm3(d * 2.1 + 3.0 + uSeed, 5), nB = n_fbm3(d * 6.0 + 8.0, 4), nC = n_fbm3(d * 18.0 + 2.0, 4);
    alb = vec3(0.56, 0.27, 0.13);
    alb = mix(alb, vec3(0.68, 0.4, 0.22), smoothstep(0.5, 0.62, nA) * 0.75);                     // bright dust
    float dark = smoothstep(0.47, 0.37, nA + 0.12 * (nB - 0.5)) * smoothstep(0.35, -0.2, d.y + 0.2 * (nB - 0.5));
    // named dark regions: Syrtis Major (a wedge pointing north at 70 E), Acidalia, Solis Lacus (the eye)
    vec2 sy = vec2(wrapA(lo - 70.0 * DEG) / (0.16 + 0.12 * smoothstep(0.35, -0.05, la)), (la - 8.0 * DEG) / 0.3);
    dark = max(dark, (1.0 - smoothstep(0.7, 1.0, length(sy) + (nB - 0.5) * 0.5)) * 0.95);
    vec2 ac = vec2(wrapA(lo + 30.0 * DEG) * cos(la) / 0.32, (la - 45.0 * DEG) / 0.14);
    dark = max(dark, (1.0 - smoothstep(0.6, 1.0, length(ac) + (nB - 0.5) * 0.6)) * 0.8);
    vec2 so = vec2(wrapA(lo + 85.0 * DEG) * cos(la) / 0.1, (la + 25.0 * DEG) / 0.08);
    dark = max(dark, (1.0 - smoothstep(0.5, 1.0, length(so) + (nC - 0.5) * 0.5)) * 0.7);
    alb = mix(alb, vec3(0.24, 0.13, 0.08), dark * 0.85);
    // Hellas: a pale basin at 42 S, 70 E
    vec2 he = vec2(wrapA(lo - 70.0 * DEG) * cos(la) / 0.2, (la + 42.0 * DEG) / 0.18);
    float hel = 1.0 - smoothstep(0.75, 1.05, length(he) + (nB - 0.5) * 0.3);
    alb = mix(alb, vec3(0.8, 0.6, 0.44), hel * 0.7);
    // Valles Marineris: branching troughs along 8 S from 110 W to 40 W
    float cl = -8.0 + 2.2 * sin(loD * 0.09) + 1.2 * (nC - 0.5);
    float inR = smoothstep(-114.0, -102.0, loD) * smoothstep(-32.0, -46.0, loD);
    float wv = 0.7 + 1.9 * smoothstep(-100.0, -70.0, loD) * smoothstep(-40.0, -58.0, loD);
    float canyon = inR * (1.0 - smoothstep(wv * 0.35, wv, abs(laD - cl)));
    canyon = max(canyon, inR * 0.7 * (1.0 - smoothstep(0.2, 0.55, abs(laD - cl - 3.2 + 1.5 * sin(loD * 0.2)))) * smoothstep(-95.0, -80.0, loD) * smoothstep(-55.0, -68.0, loD));
    alb = mix(alb, vec3(0.36, 0.19, 0.11), canyon * 0.55);
    // the Tharsis volcanoes and Olympus Mons: pale shields with dark summit calderas
    float vol = 0.0;
    vec4 VO[4]; VO[0] = vec4(-134.0, 18.6, 5.2, 0.9); VO[1] = vec4(-120.5, -9.5, 2.6, 0.6); VO[2] = vec4(-113.0, 1.0, 2.3, 0.6); VO[3] = vec4(-104.5, 11.8, 2.5, 0.6);
    for (int k = 0; k < 4; k++) {
      vec2 g = vec2(wrapA(lo - VO[k].x * DEG) * cos(la), la - VO[k].y * DEG) / (VO[k].z * DEG);
      float e = length(g);
      vol += VO[k].w * exp(-e * e * 1.3);
      alb = mix(alb, vec3(0.74, 0.52, 0.36), (1.0 - smoothstep(0.7, 1.1, e)) * 0.5);
      alb = mix(alb, vec3(0.36, 0.22, 0.15), (1.0 - smoothstep(0.08, 0.2, abs(e - 0.18))) * 0.6);
    }
    // polar caps (the north one larger), with spiral troughs
    float capN = smoothstep(0.952, 0.972, d.y + 0.018 * (nB - 0.5) + 0.006 * sin(atan(d.x, d.z) * 3.0 + d.y * 40.0));
    float capS = smoothstep(0.965, 0.98, -d.y + 0.02 * (nB - 0.5) - 0.004);
    alb = mix(alb, vec3(0.93, 0.91, 0.88), max(capN, capS));
    // the southern highlands are cratered, the northern plains smooth
    vec3 c1 = craters(d, 7.0, 2.0 + uSeed, 0.5), c2 = craters(d, 19.0, 4.0 + uSeed, 0.5) * kS(19.0, px);
    float south = 0.25 + 0.75 * smoothstep(0.25, -0.2, d.y);
    hgt = ((-c1.x * 0.6 + c1.y * 0.35) + (-c2.x * 0.3 + c2.y * 0.2)) * south - canyon * 0.9 + vol * 1.5 + hel * -0.6 + n_fbm3(d * 26.0, 4) * 0.2;
    float fk2 = 1.0 - smoothstep(0.0006, 0.004, px);                                               // close up: dunes, rocks, streaks
    alb *= 0.9 + 0.2 * nC * fk + 0.18 * (n_fbm3(d * 160.0, 4) - 0.5) * fk2;
    hgt += (n_fbm3(d * 420.0, 4) - 0.5) * 0.25 * fk2;`,
  venus: /* glsl */`
    float la = asin(clamp(d.y, -1.0, 1.0));
    vec3 q = rotY(d, -uDrift * 0.01 * uTime);                         // the super-rotation: the clouds race westward
    float lq = atan(q.x, q.z), chev = lq + 1.15 * abs(la);            // UV chevrons pointing west (the dark Y)
    float st = n_fbm3(vec3(cos(chev) * 1.6, la * 3.4, sin(chev) * 1.6) + 4.0 + uSeed, 5);
    float st2 = n_fbm3(vec3(cos(chev) * 3.2, la * 9.0, sin(chev) * 3.2) + 1.0, 4);
    alb = vec3(0.95, 0.86, 0.63);
    alb = mix(alb, vec3(0.8, 0.69, 0.47), smoothstep(0.46, 0.72, st) * 0.55 + smoothstep(0.55, 0.75, st2) * 0.12 * fk);
    alb = mix(alb, vec3(0.99, 0.96, 0.87), smoothstep(52.0 * DEG, 74.0 * DEG, abs(la)) * 0.4);
    alb *= 0.96 + 0.07 * n_fbm3(q * 12.0, 3) * fk;
    hgt = 0.0;`,
  jupiter: /* glsl */`
    float ovk, ovs; vec3 dv = vortexWarp(d, uTime * uDrift, 0.12, 0.55, 5.0, 9.0, ovk, ovs);         // gentle at disc scale
    float ovk2, ovs2; dv = vortexWarp(dv, uTime * uDrift, 0.34 * fk, 0.5, 2.2, 3.8, ovk2, ovs2);    // eddies once resolved
    float la = asin(clamp(dv.y, -1.0, 1.0)), laD = la / DEG;
    float w = uDrift * (0.011 * sin(la * 11.0) + 0.018 * exp(-laD * laD / 70.0));   // zonal jets (rad/s)
    vec3 q = rotY(dv, w * uTime);
    float lo = atan(q.x, q.z);
    vec3 s = q * vec3(2.6, 9.0, 2.6);
    vec3 w1 = vec3(n_fbm3(s + 1.3 + uSeed, 4), n_fbm3(s + 7.1, 4), n_fbm3(s + 3.7, 4)) - 0.5;
    vec3 s2 = s * 1.9 + w1 * 2.6;
    float wn = n_fbm3(s2, 5) - 0.5;
    float edge = 0.5 + 0.5 * cos(la * 22.0);
    float laW = laD + wn * (4.0 + 3.5 * edge);
    // the Great Red Spot pushes the bands aside
    vec2 g = vec2(wrapA(atan(d.x, d.z) - uSpotLon - uTime * uDrift * 0.0004) * cos(la), la + 22.5 * DEG);
    vec2 gs = g / vec2(0.135, 0.088);
    float eG = length(gs);
    laW += sign(gs.y) * 5.5 * exp(-eG * eG * 0.45);
    alb = jupBands(laW);
    float fine = n_fbm3(s2 * 2.3 + wn * 2.0, 4);
    alb *= 0.8 + 0.4 * mix(0.5, fine, fk);
    float fk2 = 1.0 - smoothstep(0.0008, 0.005, px);                                     // close up: fine filaments
    alb *= 1.0 + 0.34 * (n_fbm3(s2 * 5.5 + wn * 4.0, 4) - 0.5) * fk2;                       // close up: folds and shadows in the cloud tops
    alb *= 1.0 - 0.1 * fk2;
    if (fk2 > 0.01) {
      vec3 fq = q * vec3(34.0, 120.0, 34.0) + vec3(n_fbm3(q * 22.0, 3), 0.0, n_fbm3(q * 22.0 + 5.0, 3)) * 3.0;
      float fil = n_fbm3(fq, 4);
      alb = mix(alb, alb * 1.25 + 0.08, smoothstep(0.6, 0.72, fil) * 0.6 * fk2);          // bright combed streaks
      alb = mix(alb, alb * 0.58, smoothstep(0.6, 0.74, n_fbm3(fq * 0.6 + 9.0, 4)) * 0.6 * fk2);
      float puff = smoothstep(0.66, 0.8, n_fbm3(q * vec3(60.0, 90.0, 60.0) + 3.3, 4));
      alb = mix(alb, vec3(1.0, 0.98, 0.94), puff * 0.55 * fk2 * clamp(isBandEdge(laW), 0.3, 1.0));
    }
    // vortex cores: white ovals in the zones, dark brown barges in the belts
    float isBelt = band(laW, 7.0, 18.0, 1.6) + band(laW, -19.0, -7.5, 1.6) + band(laW, 23.5, 30.0, 1.4);
    alb = mix(alb, mix(vec3(0.97, 0.95, 0.9), vec3(0.34, 0.2, 0.13), clamp(isBelt, 0.0, 1.0)), smoothstep(0.86, 0.98, ovk) * abs(ovs) * step(0.62, fract(ovk * 97.0 + laW)) * 0.45);
    alb = mix(alb, vec3(0.4, 0.43, 0.48), smoothstep(0.64, 0.8, n_fbm3(s2 * 1.4 + 7.0, 4)) * band(laW, 5.0, 8.0, 1.5) * 0.65);   // festoons
    alb = mix(alb, vec3(0.97, 0.95, 0.9), smoothstep(0.6, 0.8, fine) * band(laW, 3.0, 8.5, 2.0) * 0.65);          // plumes at the EZ edge
    alb = mix(alb, vec3(0.38, 0.22, 0.15), smoothstep(0.7, 0.85, n_fbm3(s * 3.0 + 5.0, 3)) * band(laW, 13.0, 17.0, 1.0) * 0.7); // brown barges
    // polar regions: small vortices in a grey-blue haze
    float pv = smoothstep(0.62, 0.8, n_fbm3(q * 14.0 + 3.0, 4)) * smoothstep(48.0, 60.0, abs(laD));
    alb = mix(alb, vec3(0.72, 0.7, 0.68), pv * 0.45);
    // white ovals at 41 S
    for (int k = 0; k < 3; k++) {
      vec2 o = vec2(wrapA(atan(d.x, d.z) - uSpotLon - 1.1 - float(k) * 0.4) * cos(la), la + 41.0 * DEG) / vec2(0.034, 0.022);
      alb = mix(alb, vec3(0.97, 0.95, 0.91), (1.0 - smoothstep(0.6, 1.0, length(o))) * 0.85);
    }
    if (eG < 2.2) {
      // the Great Red Spot: an anticyclone turning counter-clockwise, spiral arms of cloud wound into it
      float sw = 3.4 * exp(-eG * eG * 0.9) + uTime * uDrift * 0.03 * exp(-eG * eG);
      float cs = cos(sw), sn = sin(sw);
      vec2 r = mat2(cs, -sn, sn, cs) * gs;
      float n = n_fbm3(vec3(r * 2.6, 4.2), 5);
      float spiral = n_fbm3(vec3(atan(r.y, r.x) * 1.6 + eG * 5.0, eG * 9.0, 1.7), 4);
      float core = 1.0 - smoothstep(0.78, 1.02, eG + (n - 0.5) * 0.28);
      vec3 grs = mix(vec3(0.66, 0.29, 0.16), vec3(0.88, 0.55, 0.36), n * 0.6 + spiral * 0.4);
      grs *= 0.88 + 0.28 * smoothstep(0.35, 0.75, spiral) * (1.0 - smoothstep(0.0, 0.3, eG) * 0.5);
      grs = mix(grs, vec3(0.56, 0.24, 0.14), (1.0 - smoothstep(0.0, 0.5, eG)) * 0.5);
      alb = mix(alb, grs, core);
      alb = mix(alb, vec3(0.95, 0.91, 0.84), (smoothstep(0.95, 1.15, eG) - smoothstep(1.25, 1.75, eG)) * 0.5);
    }
    hgt = 0.0;`,
  saturn: /* glsl */`
    float ovk, ovs; vec3 dv = vortexWarp(d, uTime * uDrift, 0.22, 0.35, 4.0, 10.0, ovk, ovs);
    float la = asin(clamp(dv.y, -1.0, 1.0)), laD = la / DEG;
    vec3 q = rotY(dv, uDrift * 0.008 * sin(la * 9.0) * uTime);
    vec3 s = q * vec3(2.0, 12.0, 2.0);
    float wn = n_fbm3(s + vec3(n_fbm3(s * 1.7 + 2.0 + uSeed, 3)), 4) - 0.5;
    float laW = laD + wn * 2.6;
    vec3 c = vec3(0.9, 0.81, 0.6);
    c = mix(c, vec3(0.94, 0.87, 0.67), band(laW, -9.0, 9.0, 3.0) * 0.6);
    c = mix(c, vec3(0.8, 0.66, 0.45), band(laW, 12.0, 21.0, 2.5) * 0.55);
    c = mix(c, vec3(0.81, 0.68, 0.47), band(laW, -22.0, -12.0, 2.5) * 0.5);
    c = mix(c, vec3(0.78, 0.68, 0.51), band(laW, 27.0, 36.0, 2.5) * 0.42);
    c = mix(c, vec3(0.8, 0.7, 0.53), band(laW, -38.0, -29.0, 2.5) * 0.36);
    c = mix(c, vec3(0.6, 0.64, 0.64), smoothstep(56.0, 76.0, laW) * 0.7);
    c = mix(c, vec3(0.72, 0.67, 0.58), smoothstep(-56.0, -76.0, laW) * 0.5);
    float ph = atan(d.x, d.z), hexR = cos(PI / 6.0) / cos(mod(ph, PI / 3.0) - PI / 6.0), rp = (90.0 - laD) / 13.5;
    c = mix(c, vec3(0.5, 0.55, 0.57), (1.0 - smoothstep(0.0, 0.1, abs(rp - hexR))) * step(55.0, laD) * 0.55);
    c *= 0.9 + 0.16 * mix(0.5, n_fbm3(s * 2.0 + wn, 4), fk);
    float fk2 = 1.0 - smoothstep(0.0008, 0.005, px);
    c *= 1.0 + 0.1 * (n_fbm3(s * 6.0 + wn * 3.0, 4) - 0.5) * fk2;
    c = mix(c, vec3(0.98, 0.95, 0.86), smoothstep(0.9, 0.98, ovk) * abs(ovs) * 0.25);
    alb = c; hgt = 0.0;`,
  uranus: /* glsl */`
    float laD = asin(clamp(d.y, -1.0, 1.0)) / DEG;
    vec3 c = vec3(0.6, 0.84, 0.88);
    c *= 0.975 + 0.035 * sin(laD * 0.3 + 2.0 * n_fbm3(d * vec3(2.0, 8.0, 2.0) + uSeed, 3));
    c = mix(c, vec3(0.8, 0.94, 0.95), smoothstep(35.0, 75.0, laD) * 0.5);
    c = mix(c, vec3(0.94, 0.97, 0.98), smoothstep(0.72, 0.85, n_fbm3(rotY(d, uDrift * 0.01 * uTime) * vec3(4.0, 30.0, 4.0) + 5.0, 4)) * band(laD, 25.0, 40.0, 4.0) * 0.5);
    alb = c; hgt = 0.0;`,
  neptune: /* glsl */`
    float la = asin(clamp(d.y, -1.0, 1.0)), laD = la / DEG;
    vec3 q = rotY(d, uDrift * (-0.02 * cos(la * 2.0) + 0.008) * uTime);
    float lo = atan(q.x, q.z);
    vec3 s = q * vec3(2.2, 10.0, 2.2);
    float wn = n_fbm3(s + 3.0 + uSeed, 4) - 0.5;
    float laW = laD + wn * 4.0;
    vec3 c = vec3(0.22, 0.41, 0.86);
    c = mix(c, vec3(0.17, 0.31, 0.72), band(laW, -32.0, -18.0, 3.0) * 0.6);
    c = mix(c, vec3(0.3, 0.52, 0.92), band(laW, -8.0, 8.0, 4.0) * 0.4);
    c = mix(c, vec3(0.2, 0.36, 0.78), smoothstep(50.0, 75.0, abs(laW)) * 0.5);
    c *= 0.93 + 0.12 * mix(0.5, n_fbm3(s * 2.2 + wn * 2.0, 4), fk);
    vec2 g = vec2(wrapA(lo - uSpotLon) * cos(la), la + 20.0 * DEG) / vec2(0.12, 0.065);
    float n = n_fbm3(vec3(g * 2.0, 1.3), 4), e = length(g);
    c = mix(c, vec3(0.09, 0.16, 0.44), (1.0 - smoothstep(0.7, 1.0, e + (n - 0.5) * 0.3)) * 0.85);
    vec2 cp = (g - vec2(0.35, -1.45)) / vec2(1.3, 0.35);
    c = mix(c, vec3(0.95, 0.97, 1.0), (1.0 - smoothstep(0.4, 1.0, length(cp) + (n - 0.5) * 0.5)) * 0.9);
    float streak = smoothstep(0.62, 0.8, n_fbm3(q * vec3(3.0, 40.0, 3.0) + 9.0, 4)) * (band(laW, 22.0, 32.0, 3.0) + band(laW, -48.0, -38.0, 3.0));
    c = mix(c, vec3(0.93, 0.96, 1.0), streak * 0.85);
    alb = c; hgt = 0.0;`,
  pluto: /* glsl */`
    float la = asin(clamp(d.y, -1.0, 1.0)), lo = atan(d.x, d.z), laD = la / DEG, loD = lo / DEG;
    float nA = n_fbm3(d * 3.0 + uSeed, 5), nB = n_fbm3(d * 9.0 + 4.0, 4);
    alb = vec3(0.7, 0.52, 0.36) * (0.85 + 0.3 * nA);
    alb = mix(alb, vec3(0.73, 0.69, 0.6), smoothstep(45.0, 70.0, laD + 8.0 * (nB - 0.5)) * 0.7);           // the grey-yellow north
    alb = mix(alb, vec3(0.85, 0.77, 0.62), smoothstep(0.62, 0.75, nB) * 0.35);
    // Cthulhu: the dark red whale along the equator west of the heart
    vec2 ct = vec2(wrapA(lo + 72.0 * DEG) * cos(la) / 0.95, (la + 4.0 * DEG) / 0.26);
    float cth = 1.0 - smoothstep(0.75, 1.05, length(ct) + (nA - 0.5) * 0.7 + (nB - 0.5) * 0.25);
    alb = mix(alb, vec3(0.27, 0.13, 0.08), cth * 0.92);
    // the heart (Tombaugh Regio), point down: (x^2 + y^2 - 1)^3 - x^2 y^3 <= 0
    vec2 hq = vec2(wrapA(lo) * cos(la), la - 22.0 * DEG) / (27.0 * DEG);
    hq += (vec2(n_fbm3(d * 6.0 + 1.0, 3), n_fbm3(d * 6.0 + 9.0, 3)) - 0.5) * 0.22;
    hq.y = hq.y * 1.08 + 0.12;
    float hx = hq.x * hq.x, hy = hq.y;
    float hq3 = hx + hy * hy - 1.0; float Hh = hq3 * hq3 * hq3 - hx * hy * hy * hy;
    float heart = 1.0 - smoothstep(-0.02, 0.06 + 0.2 * smoothstep(0.0, 1.0, hq.x), Hh);
    // Sputnik Planitia: the smooth bright western lobe with convection cells
    vec2 sp = vec2(wrapA(lo + 9.0 * DEG) * cos(la), la - 24.0 * DEG) / vec2(15.0 * DEG, 21.0 * DEG);
    float sput = (1.0 - smoothstep(0.8, 1.02, length(sp) + (nB - 0.5) * 0.18));
    vec3 hc = mix(vec3(0.9, 0.86, 0.79), vec3(0.97, 0.95, 0.91), sput);
    vec3 cp3 = d * 34.0; vec3 ci = floor(cp3); float f1 = 9.0, f2 = 9.0;
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
      vec3 c = ci + vec3(float(x), float(y), float(z)); vec3 o = c + vec3(n_h13(c), n_h13(c + 3.1), n_h13(c + 6.7));
      float dd = length(cp3 - o); if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
    }
    float cell = smoothstep(0.0, 0.12, f2 - f1);
    hc *= mix(1.0, 0.86 + 0.14 * cell, sput * fk);
    alb = mix(alb, hc, heart);
    // the water-ice mountains along the heart's west shore
    float shore = heart * (1.0 - smoothstep(0.0, 0.25, abs(length(sp) - 1.0))) * smoothstep(0.0, -0.3, sp.x);
    alb = mix(alb, vec3(0.45, 0.36, 0.3), shore * 0.5 * smoothstep(0.45, 0.65, nB));
    vec3 c1 = craters(d, 8.0, 2.0 + uSeed, 0.45), c2 = craters(d, 22.0, 4.0 + uSeed, 0.45) * kS(22.0, px);
    float cr = 1.0 - sput;
    hgt = ((-c1.x * 0.5 + c1.y * 0.3) + (-c2.x * 0.25 + c2.y * 0.16)) * cr + shore * nB * 1.2 + n_fbm3(d * 30.0, 3) * 0.1 * cr - (1.0 - cell) * 0.08 * sput;`,
  titan: /* glsl */`
    float la = asin(clamp(d.y, -1.0, 1.0));
    alb = vec3(0.78, 0.53, 0.24) * (0.94 + 0.08 * n_fbm3(d * vec3(2.0, 6.0, 2.0) + uSeed, 4));
    alb = mix(alb, vec3(0.62, 0.42, 0.22), smoothstep(40.0 * DEG, 70.0 * DEG, la) * 0.35);
    hgt = 0.0;`,
  charon: /* glsl */`
    float la = asin(clamp(d.y, -1.0, 1.0));
    alb = vec3(0.52, 0.5, 0.48) * (0.85 + 0.3 * n_fbm3(d * 5.0 + uSeed, 5));
    alb = mix(alb, vec3(0.38, 0.22, 0.14), smoothstep(55.0 * DEG, 72.0 * DEG, la + 0.1 * (n_fbm3(d * 8.0, 3) - 0.5)) * 0.85);   // Mordor Macula
    vec3 c1 = craters(d, 9.0, 2.0 + uSeed, 0.5), c2 = craters(d, 24.0, 4.0 + uSeed, 0.5) * kS(24.0, px);
    hgt = -c1.x * 0.5 + c1.y * 0.3 - c2.x * 0.25 + c2.y * 0.16;
    alb += c2.z * 0.06;`,
};
// eddies along the band edges: the sample direction is rotated about jittered centres (curls, ovals, spirals);
// ov = how close to a vortex core (0..1), sg = its sense (+1 / -1)
const VORTEX = /* glsl */`
vec3 vortexWarp(vec3 d, float t, float strength, float dens, float LAd, float LOd, out float ov, out float sg){
  ov = 0.0; sg = 0.0;
  float la = asin(clamp(d.y, -1.0, 1.0)), lo = atan(d.x, d.z);
  float LA = LAd * DEG, LO = LOd * DEG;
  float ci = floor(la / LA), cj = floor(lo / LO);
  vec3 q = d;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) {
    vec2 c = vec2(ci + float(a), cj + float(b));
    float h = n_h12(c + 3.7);
    if (h > dens) continue;
    float cla = (c.x + 0.2 + 0.6 * n_h12(c + 1.1)) * LA, clo = (c.y + 0.2 + 0.6 * n_h12(c + 2.3)) * LO + t * 0.0004 * (h - dens * 0.5);
    vec3 cc = vec3(cos(cla) * sin(clo), sin(cla), cos(cla) * cos(clo));
    float rad = (0.9 + 1.6 * n_h12(c + 5.9)) * LA * 0.45;
    float r = acos(clamp(dot(q, cc), -1.0, 1.0));
    float k = exp(-r * r / (rad * rad));
    float sn = n_h12(c + 7.3) < 0.5 ? -1.0 : 1.0;
    float ang = sn * strength * (2.0 + 3.0 * n_h12(c + 8.1)) * k;
    q = q * cos(ang) + cross(cc, q) * sin(ang) + cc * dot(cc, q) * (1.0 - cos(ang));
    if (k > ov) { ov = k; sg = sn * step(0.5, n_h12(c + 9.4)); }
  }
  return normalize(q);
}
`;
const JUP_BANDS = /* glsl */`
float isBandEdge(float la){ float a1 = (abs(la) - 7.5) / 2.0, a2 = (abs(la) - 18.0) / 2.5, a3 = (abs(la) - 26.0) / 2.5; return exp(-a1 * a1) + exp(-a2 * a2) + exp(-a3 * a3); }
vec3 jupBands(float la){
  vec3 zone = vec3(0.93, 0.88, 0.76), belt = vec3(0.55, 0.36, 0.23), beltR = vec3(0.62, 0.33, 0.18), pol = vec3(0.52, 0.5, 0.5);
  vec3 c = zone;
  c = mix(c, vec3(0.88, 0.76, 0.56), band(la, -6.0, 6.0, 2.0) * 0.55);
  c = mix(c, beltR, band(la, 7.0, 18.0, 0.9) * 0.9);
  c = mix(c, beltR * 1.06, band(la, -19.0, -7.5, 0.9) * 0.85);
  c = mix(c, belt, band(la, 23.5, 30.0, 1.4) * 0.75);
  c = mix(c, belt * 1.08, band(la, -32.0, -26.5, 1.4) * 0.6);
  c = mix(c, belt * 1.12, band(la, 36.0, 42.0, 1.6) * 0.5);
  c = mix(c, belt * 1.12, band(la, -44.0, -38.0, 1.6) * 0.45);
  c = mix(c, pol, smoothstep(46.0, 64.0, abs(la)));
  return c;
}
`;

// light models: 0 airless (Lommel-Seeliger: a flat full disc, a knife-edge terminator), 1 rock with a thin atmosphere,
// 2 cloud deck (soft terminator, bright haze), 3 gas giant (Minnaert limb darkening)
export const BODIES = {
  mercury: { R: 230, surf: 'mercury', model: 0, bump: 0.6, atm: 0, lat: 0, tilt: 0, desc: 'Mercury: a grey-brown, heavily cratered ball with bright ray craters and the ringed Caloris basin; no air, a knife-edge terminator' },
  venus: { R: 570, surf: 'venus', model: 2, wrap: 0.16, atm: 1.0, atmCol: [1.0, 0.86, 0.6], halo: 0.035, fwd: 2.2, spin: 0, drift: 1, desc: 'Venus: a featureless pale-yellow cloud globe with subtle UV-like chevron banding, a soft terminator and a bright haze rim (a glowing ring when backlit)' },
  moon: { R: 164, surf: 'moon', model: 0, bump: 0.55, atm: 0, lat: 0, tilt: 0, desc: 'the Moon: grey highlands, dark maria on the near side, craters, Tycho\'s rays, a hard terminator' },
  mars: { R: 320, surf: 'mars', model: 1, bump: 0.45, atm: 0.4, atmCol: [0.95, 0.62, 0.42], halo: 0.014, fwd: 0.8, desc: 'Mars: rust plains, dark Syrtis Major and Acidalia, pale Hellas, Valles Marineris, the Tharsis volcanoes and Olympus Mons, polar caps, a thin butterscotch haze on the limb' },
  jupiter: { R: 6720, surf: 'jupiter', model: 3, obl: 0.935, wrap: 0.04, atm: 0.3, atmCol: [0.85, 0.8, 0.72], halo: 0.012, fwd: 0.6, lat: 4, tilt: 3, spot: 25, drift: 1, desc: 'Jupiter: cream zones and brown belts with turbulent, swirling edges drifting gently, the Great Red Spot (spot_lon) with its pale hollow, white ovals, grey-blue poles' },
  saturn: { R: 5660, surf: 'saturn', model: 3, obl: 0.902, wrap: 0.04, atm: 0.3, atmCol: [0.92, 0.85, 0.66], halo: 0.012, fwd: 0.6, lat: 20, tilt: 14, rings: 'saturn', drift: 1, desc: 'Saturn: pale gold bands, the blue-grey north with its hexagon, RINGS with the Cassini division and the Encke gap, the planet\'s shadow on the rings and the rings\' shadow on the globe; lat = how open the rings are' },
  uranus: { R: 2400, surf: 'uranus', model: 3, obl: 0.977, wrap: 0.06, atm: 0.9, atmCol: [0.6, 0.9, 0.95], halo: 0.02, fwd: 0.8, lat: 50, tilt: 98, rings: 'uranus', drift: 1, desc: 'Uranus: a nearly featureless cyan haze ball lying on its side (tilt 98), a brighter polar hood, faint narrow dark rings' },
  neptune: { R: 2330, surf: 'neptune', model: 3, obl: 0.983, wrap: 0.05, atm: 0.8, atmCol: [0.35, 0.55, 1.0], halo: 0.02, fwd: 0.8, lat: 8, tilt: 22, spot: -20, drift: 1, desc: 'Neptune: deep blue with darker belts, the Great Dark Spot with its bright companion cloud, white methane streaks racing along the latitudes' },
  pluto: { R: 112, surf: 'pluto', model: 0, bump: 0.7, atm: 0.25, atmCol: [0.35, 0.58, 1.0], halo: 0.07, fwd: 4.0, lat: 12, tilt: 0, desc: 'Pluto: tan and orange with the bright heart (Tombaugh Regio: smooth Sputnik Planitia with its ice cells), the dark red Cthulhu along the equator, a grey north, a thin blue haze ring when backlit' },
  titan: { R: 155, surf: 'titan', model: 2, wrap: 0.25, atm: 1.4, atmCol: [0.95, 0.62, 0.25], halo: 0.12, fwd: 2.5, desc: 'Titan: an orange haze ball, a thick glowing atmosphere' },
  charon: { R: 58, surf: 'charon', model: 0, bump: 0.7, atm: 0, desc: 'Charon: grey with the dark red north (Mordor Macula), craters' },
};

function planetMaterial(key, B, p, st) {
  const surf = SURF[B.surf];
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: st.uSun, uTime: { value: 0 }, uSeed: { value: +(p.seed ?? 0) % 97 }, uObl: { value: B.obl ?? 1 }, uDrift: { value: +(p.drift ?? B.drift ?? 1) },
      uSunI: { value: 1.3 * (+(p.brightness ?? 1)) }, uWrap: { value: B.wrap ?? 0 }, uModel: { value: B.model }, uBump: { value: (B.bump ?? 0) * (+(p.relief ?? 1)) },
      uAtm: { value: (B.atm ?? 0) * (+(p.atmosphere ?? 1)) }, uAtmCol: { value: new THREE.Color(...(B.atmCol || [0.5, 0.6, 1])) },
      uSpotLon: { value: (+(p.spot_lon ?? B.spot ?? 20)) * DEG }, uNightAmb: { value: +(p.night ?? 0) },
      uRot: { value: new THREE.Matrix3() }, uRingOn: { value: 0 }, uRingKind: { value: 1 }, uRingN: { value: new THREE.Vector3(0, 1, 0) }, uC: { value: new THREE.Vector3() }, uR: { value: 1 },
    },
    vertexShader: PLANET_VS,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSun; uniform float uTime, uSeed, uDrift, uSunI, uWrap, uModel, uBump, uAtm, uSpotLon, uNightAmb, uRingOn, uRingKind, uR;
      uniform vec3 uAtmCol, uRingN, uC;
      varying vec3 vN; varying vec3 vP; varying vec3 vL;
      ${NOISE_GLSL}
      ${COMMON}
      ${CRATERS}
      ${RINGS}
      ${B.surf === 'jupiter' || B.surf === 'saturn' ? VORTEX : ''}
      ${B.surf === 'jupiter' ? JUP_BANDS : ''}
      uniform mat3 uRot;
      void surface(vec3 d, float fk, float px, out vec3 alb, out float hgt){
        alb = vec3(0.5); hgt = 0.0;
        ${surf}
      }
      void main(){
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vN), V = normalize(cameraPosition - vP), L = normalize(uSun);
        vec3 d = normalize(vL);
        // detail fade: 1 when a pixel covers well under 1/300 of the radius, 0 for a far dot
        float px = length(fwidth(d));
        float fk = 1.0 - smoothstep(0.004, 0.02, px);
        vec3 alb; float hgt;
        surface(d, fk, px, alb, hgt);
        vec3 Nb = N;
        if (uBump > 0.0) {
          // relief from the height field's gradient in the tangent plane (two more samples): smooth across the mesh's
          // triangles (screen-derivative bump showed the sphere's quads as a hatch inside steep craters)
          float e = max(px * 1.2, 0.00025);
          vec3 tb = normalize(cross(abs(d.y) < 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), d)), bb = cross(d, tb);
          vec3 a1; float h1, h2;
          surface(normalize(d + tb * e), fk, px, a1, h1);
          surface(normalize(d + bb * e), fk, px, a1, h2);
          float K = uBump * 0.012 / e;
          vec3 tw = normalize(uRot * tb), bw = normalize(uRot * bb);
          Nb = normalize(N - (tw * (h1 - hgt) + bw * (h2 - hgt)) * K);
        }
        float ndl = dot(Nb, L), ndl0 = dot(N, L), mu = max(dot(N, V), 0.0);
        float shade;
        if (uModel < 0.5) {                         // airless: Lommel-Seeliger x Lambert, knife-edge
          float mu0 = max(ndl, 0.0);
          shade = mix(mu0, 2.0 * mu0 / (mu0 + max(mu, 0.05)) * 0.5, 0.55) * 1.15 * smoothstep(-0.02, 0.03, ndl0 + 0.02);
        } else if (uModel < 1.5) {                  // rock with a thin atmosphere
          shade = max(ndl, 0.0) * smoothstep(-0.05, 0.05, ndl0 + 0.03);
        } else if (uModel < 2.5) {                  // a cloud deck: soft terminator
          float w = max((ndl0 + uWrap) / (1.0 + uWrap), 0.0);
          shade = pow(w, 1.1) * (0.8 + 0.2 * pow(mu, 0.3));
        } else {                                    // gas giant: Minnaert limb darkening
          float w = max((ndl0 + uWrap) / (1.0 + uWrap), 0.0);
          shade = pow(w, 1.12) * pow(max(mu, 0.02), 0.14);
        }
        // the rings' shadow on the globe
        float ringT = 1.0;
        if (uRingOn > 0.5) {
          float den = dot(L, uRingN);
          if (abs(den) > 1e-4) {
            float s = dot(uC - vP, uRingN) / den;
            if (s > 0.0) { vec3 H = vP + L * s; float r = length(H - uC) / uR; vec4 rp = ringProfile(r, 0.002, uRingKind); ringT = exp(-rp.w / max(abs(den), 0.05)); }
          }
        }
        // sunlight reddens toward the terminator through an atmosphere
        float term = exp(-sq(ndl0 / 0.14));
        vec3 sunC = mix(vec3(1.0, 0.985, 0.96), vec3(1.0, 0.6, 0.35), term * sat(uAtm) * (uModel > 0.5 ? 0.6 : 0.0));
        vec3 col = alb * sunC * shade * uSunI * ringT;
        col += alb * uNightAmb * 0.02;
        // atmosphere in front of the disc: a rim of haze on the lit side, brighter toward the limb
        if (uAtm > 0.0) {
          float camK = smoothstep(1.03, 1.5, length(cameraPosition - uC) / uR);            // near the surface there is no limb
          float rim = pow(1.0 - mu, 3.2) * camK;
          float lit = smoothstep(-0.25, 0.35, ndl0);
          col += uAtmCol * rim * lit * uAtm * 0.55 * uSunI;
          col += uAtmCol * pow(1.0 - mu, 8.0) * pow(max(dot(-V, L), 0.0), 3.0) * uAtm * 0.8 * uSunI * camK;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return mat;
}

// the atmosphere outside the limb: a back-face shell; density from the ray's closest approach to the surface
export function makeHalo(R, o, st) { const B = { halo: o.halo ?? 0.02, atmCol: o.color || [0.35, 0.58, 1.0], atm: o.amount ?? 1, fwd: o.fwd ?? 1.5 }; const g = new THREE.SphereGeometry(R * (1 + B.halo * 4), 128, 64); const m = new THREE.Mesh(g, haloMaterial(B, {}, st, R)); m.renderOrder = 1; m.frustumCulled = false; return m; }
function haloMaterial(B, p, st, R) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: st.uSun, uC: { value: new THREE.Vector3() }, uR: { value: R }, uH: { value: B.halo ?? 0.02 }, uCol: { value: new THREE.Color(...(B.atmCol || [0.5, 0.6, 1])) },
      uAmt: { value: (B.atm ?? 0) * (+(p.atmosphere ?? 1)) }, uFwd: { value: B.fwd ?? 1 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSun, uC, uCol; uniform float uR, uH, uAmt, uFwd;
      varying vec3 vW;
      void main(){
        #include <logdepthbuf_fragment>
        vec3 ro = cameraPosition, rd = normalize(vW - ro), L = normalize(uSun);
        float tc = dot(uC - ro, rd);
        vec3 pc = ro + rd * max(tc, 0.0);
        float dm = length(pc - uC);
        float a = (dm - uR) / (uR * uH);
        if (a < -0.02) discard;
        float dens = exp(-max(a, 0.0) * 3.2) * smoothstep(-0.02, 0.06, a);
        vec3 nrm = normalize(pc - uC);
        float lit = smoothstep(-0.25, 0.3, dot(nrm, L));
        float fwd = pow(max(dot(rd, L), 0.0), 6.0);
        vec3 c = uCol * (lit * 0.9 + fwd * uFwd) * dens * uAmt;
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function ringMaterial(kind, st, R) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: st.uSun, uC: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3(0, 1, 0) }, uR: { value: R }, uKind: { value: kind }, uObl: { value: 1 }, uBright: { value: 1 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vW; varying float vRr; uniform float uR;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vRr = length(position.xz) / uR; gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSun, uC, uN; uniform float uR, uKind, uObl, uBright;
      varying vec3 vW; varying float vRr;
      ${NOISE_GLSL}
      ${COMMON}
      ${RINGS}
      void main(){
        #include <logdepthbuf_fragment>
        float fw = fwidth(vRr);
        vec4 rp = ringProfile(vRr, fw, uKind);
        vec3 V = normalize(cameraPosition - vW), L = normalize(uSun), Nr = normalize(uN);
        float muv = abs(dot(V, Nr)), mus = dot(L, Nr);
        float alpha = 1.0 - exp(-rp.w / max(muv, 0.03));
        if (alpha < 0.002) discard;
        bool litFace = dot(V, Nr) * mus > 0.0;
        // the planet's shadow (the globe, a little oblate: a sphere of 0.96 R is close enough)
        vec3 oc = vW - uC; float b = dot(oc, L);
        float dca = length(oc - L * b);
        float sh = b < 0.0 ? smoothstep(uR * 0.93, uR * 1.0, dca) : 1.0;
        float am = abs(mus);
        vec3 col;
        if (litFace) col = rp.rgb * (0.25 + 0.6 * sqrt(am)) * 1.0;
        else col = rp.rgb * (rp.w * exp(-rp.w) * 2.4 + 0.02) * (0.6 + 1.2 * pow(max(dot(-V, L), 0.0), 4.0)) * 1.25;
        col *= sh * uBright * smoothstep(0.0, 0.02, am + 0.005);
        gl_FragColor = vec4(col * alpha, alpha);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}
const RING_KIND = { saturn: 1, uranus: 2, neptune: 3 };
const RING_SPAN = { saturn: [1.1, 2.36], uranus: [1.6, 2.0], neptune: [1.6, 2.6] };

// the registry merges the catalog's params into item.params: drop the documentation strings (they hold spaces or '|')
const NUMERIC = new Set(['y', 'radius', 'brightness', 'ring_brightness', 'spin', 'tilt', 'lat', 'lon', 'phase', 'phase_el', 'atmosphere', 'drift', 'spot_lon', 'relief', 'seed', 'earth_radius', 'gap', 'size', 'planet_scale', 'orbit_speed', 'angle0']);
export function cleanParams(item) {
  const p = {};
  for (const [k, v] of Object.entries(item.params || {})) {
    if (typeof v === 'string' && (/[\s|]/.test(v) || (NUMERIC.has(k) && !Number.isFinite(+v)))) continue;
    p[k] = v;
  }
  for (const [k, v] of Object.entries(item)) if (!(NUMERIC.has(k) && typeof v === 'string' && !Number.isFinite(+v))) p[k] = v;
  return p;
}

// ── build one body ──────────────────────────────────────────────────────────────────────────────────────────────────
export function buildBody(key, item, ctx, extra = {}) {
  const B = BODIES[key];
  const p = cleanParams(item);
  const st = spaceState(ctx);
  const R = +(p.radius ?? B.R);
  const at = Array.isArray(item.at) ? item.at : [0, 0];
  const root = new THREE.Group(); root.name = 'space.' + key;
  root.position.set(+at[0], +(p.y ?? 0), +at[1]);
  root.userData.noQA = true;
  const aimG = new THREE.Group(), tiltG = new THREE.Group(), latG = new THREE.Group(), spinG = new THREE.Group();
  tiltG.rotation.z = -(+(p.tilt ?? B.tilt ?? 0)) * DEG;
  latG.rotation.x = (+(p.lat ?? B.lat ?? 0)) * DEG;
  root.add(aimG); aimG.add(tiltG); tiltG.add(latG); latG.add(spinG);
  const obl = B.obl ?? 1;
  const seg = R > 1000 ? 384 : 256;
  const geo = new THREE.SphereGeometry(R, seg, seg / 2); if (obl !== 1) { geo.scale(1, obl, 1); geo.computeVertexNormals(); }
  const mat = planetMaterial(key, B, p, st);
  mat.uniforms.uR.value = R;
  const body = new THREE.Mesh(geo, mat); body.name = key + '_body'; body.frustumCulled = false;
  spinG.add(body);
  let halo = null;
  if ((B.atm ?? 0) > 0 && p.atmosphere !== 0 && p.atmosphere !== false) {
    const hg = new THREE.SphereGeometry(R * (1 + (B.halo ?? 0.02) * 4), 128, 64); if (obl !== 1) hg.scale(1, obl, 1);
    halo = new THREE.Mesh(hg, haloMaterial(B, p, st, R)); halo.renderOrder = 1; halo.frustumCulled = false; latG.add(halo);
  }
  let ring = null;
  const rk = p.rings === false ? null : (typeof p.rings === 'string' ? p.rings : (p.rings === true ? (B.rings || key) : B.rings));
  if (rk && RING_KIND[rk]) {
    const [r0, r1] = RING_SPAN[rk];
    const rg = new THREE.RingGeometry(R * r0, R * r1, 512, 6); rg.rotateX(-Math.PI / 2);
    const rm = ringMaterial(RING_KIND[rk], st, R); rm.uniforms.uBright.value = +(p.ring_brightness ?? 1);
    ring = new THREE.Mesh(rg, rm); ring.renderOrder = 2; ring.frustumCulled = false; ring.name = key + '_rings';
    latG.add(ring);
    mat.uniforms.uRingOn.value = 1; mat.uniforms.uRingKind.value = RING_KIND[rk];
  }
  // orientation toward the lens (resolved once per scene at mid-shot) + phase
  const lon0 = (+(p.lon ?? B.lon ?? 0)) * DEG, spin = +(p.spin ?? B.spin ?? 0);
  const center = () => root.getWorldPosition(new THREE.Vector3());
  const aimAt = (eye) => { const c = center(); if (eye.distanceTo(c) > 1e-3) aimG.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, c, new THREE.Vector3(0, 1, 0))); };
  if (Array.isArray(p.face) && p.face.length >= 3) aimAt(new THREE.Vector3(+p.face[0], +p.face[1], +p.face[2]));
  else if (p.face !== false && p.face !== 'z') st.faces.push(aimAt);
  if (p.phase != null && Number.isFinite(+p.phase) && !st.phase) st.phase = { phase: clamp(+p.phase, 0, 179), side: p.phase_side || 'right', el: p.phase_el, center };
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
  const update = (t) => {
    st.resolve();
    spinG.rotation.y = -lon0 + spin * t * DEG;
    mat.uniforms.uTime.value = t;
    root.updateMatrixWorld(true);
    const c = center();
    mat.uniforms.uC.value.copy(c);
    mat.uniforms.uRot.value.setFromMatrix4(body.matrixWorld);
    if (halo) halo.material.uniforms.uC.value.copy(c);
    if (ring) {
      ring.getWorldQuaternion(tmpQ);
      tmpV.set(0, 1, 0).applyQuaternion(tmpQ).normalize();
      ring.material.uniforms.uC.value.copy(c); ring.material.uniforms.uN.value.copy(tmpV);
      mat.uniforms.uRingN.value.copy(tmpV);
    }
  };
  update(0);
  const span = ring ? RING_SPAN[rk][1] : 1 + (B.halo ?? 0) * 2;
  const res = { root, radius: R * span, height: R * 2, update, anchors: {}, contact: false,
    subjectAt: () => { const c = center(); return [c.x, c.y, c.z]; }, subjectTop: 2 * R, subjectCy: 0,   // camera.js: framed about the centre
    planet: { key, R, obl, center, st, body, ring, rings: rk || null, spanR: R * span }, ...extra };
  return res;
}

// ── scale devices: the Solar System schematic and the size lineup ──────────────────────────────────────────────────
const ORDER = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const REAL_R = { mercury: 0.383, venus: 0.949, earth: 1, mars: 0.532, jupiter: 11.21, saturn: 9.45, uranus: 4.01, neptune: 3.88, pluto: 0.186 };
async function buildScaleDevice(kind, item, ctx) {
  const p = cleanParams(item);
  const at = Array.isArray(item.at) ? item.at : [0, 0];
  const root = new THREE.Group(); root.name = kind; root.position.set(+at[0], +(p.y ?? 0), +at[1]); root.userData.noQA = true;
  const list = (Array.isArray(p.planets) ? p.planets : ORDER).filter((k) => REAL_R[k]);
  const parts = [];
  const earthK = await import('./space.js').catch(() => null);
  const mk = async (k, r, x, y, z) => {
    let res;
    if (k === 'earth' && earthK) res = await earthK.build('space.earth', { at: [x, z], y, radius: r, spin: 2, clouds: 0.8 }, ctx);
    else res = buildBody(k, { at: [x, z], y, radius: r, face: 'z', lon: p.lon ?? 0, rings: k === 'saturn' || k === 'uranus' ? undefined : false }, ctx);
    root.add(res.root); res.root.position.set(x, y, z); parts.push(res); return res;
  };
  let radius = 10, height = 10;
  if (kind === 'space.lineup') {
    // the planets side by side at their true relative sizes (Earth = earth_radius), left to right in order from the Sun
    const E = +(p.earth_radius ?? 40), g0 = +(p.gap ?? 0.35), gap = g0 > 3 ? g0 / E / 2 : g0;          // gap in Earth radii (a value over 3 is read as metres)
    let x = 0; const xs = [];
    for (const k of list) { const r = E * REAL_R[k]; const w = r * (k === 'saturn' ? 2.3 : 1); x += w; xs.push([k, r, x]); x += w + E * gap * 2; }
    const off = x / 2;
    for (const [k, r, cx] of xs) await mk(k, r, cx - off, p.align === 'center' ? 0 : r, 0);     // bottoms on one line (align 'center': centres)
    radius = off; height = E * 11.21 * 2;
  } else {
    // a schematic: orbit rings (log-spaced, readable, not to scale) with each planet on its orbit, the Sun in the middle
    const R0 = +(p.size ?? 400), n = list.length;
    const orbitR = (i) => R0 * (0.18 + 0.82 * Math.log(1 + i * 1.35) / Math.log(1 + (n - 1) * 1.35 + 1e-9));
    const sunR = R0 * 0.06;
    const sun = new THREE.Mesh(new THREE.SphereGeometry(sunR, 48, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.5, 3.5) }));
    root.add(sun);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x8a8f99, transparent: true, opacity: 0.55 });
    list.forEach((k, i) => {
      const r = orbitR(i), pts = [];
      for (let a = 0; a <= 256; a++) pts.push(new THREE.Vector3(Math.cos(a / 256 * Math.PI * 2) * r, 0, Math.sin(a / 256 * Math.PI * 2) * r));
      root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    });
    const sizeK = +(p.planet_scale ?? 1);
    for (let i = 0; i < n; i++) {
      const k = list[i], r = orbitR(i), a = (+(p.angle0 ?? 20) + i * 47) * DEG;
      const pr = R0 * 0.012 * sizeK * (1 + Math.log(1 + REAL_R[k]) * 1.6);
      const res = await mk(k, pr, Math.cos(a) * r, 0, Math.sin(a) * r);
      res.orbit = { r, a, w: (+(p.orbit_speed ?? 1)) * 0.06 / Math.pow(1 + i, 1.5) };
    }
    radius = R0 * 1.05; height = R0 * 0.3;
    // each planet is lit from the Sun at the centre: its own sun direction
    parts.forEach((res) => { if (!res.planet) return; const own = { value: new THREE.Vector3() }; res.root.traverse((o) => { const u = o.material && o.material.uniforms; if (!u) return; if (u.uSun) u.uSun = own; if (u.uSunDir) u.uSunDir = own; }); res.ownSun = own; });
  }
  const update = (t) => {
    for (const res of parts) {
      if (res.orbit) { const a = res.orbit.a + res.orbit.w * t; res.root.position.set(Math.cos(a) * res.orbit.r, 0, Math.sin(a) * res.orbit.r); }
      res.update(t);
      if (res.ownSun) { const c = res.root.getWorldPosition(new THREE.Vector3()); res.ownSun.value.copy(root.getWorldPosition(new THREE.Vector3())).sub(c).normalize(); }
    }
  };
  update(0);
  return { root, radius, height, update, anchors: {}, contact: false, parts };
}

// ── catalog + build ─────────────────────────────────────────────────────────────────────────────────────────────────
const COMMON_P = { radius: 'm (physical proportions, Earth = 600)', lon: 'deg: the longitude facing the camera', lat: 'deg: tips the north pole toward the camera', tilt: 'deg: leans the north pole to the viewer\'s right',
  face: '"camera" (default: lon/lat face the camera at mid-shot) | [x, y, z] | false (world axes)', spin: 'deg/s (prograde > 0)', phase: 'deg: 0 full .. 90 half .. 150 crescent .. 180 backlit, solved against the camera at mid-shot (sets the scene\'s ONE sun unless look.sun/world.sun is given)',
  phase_side: 'right | left | top | bottom (where the lit limb is)', atmosphere: '0..2 rim/halo strength (0 = off)', brightness: '0.5 .. 2', y: 'm (height)' };
export const CATALOG = {};
for (const [k, B] of Object.entries(BODIES)) {
  if (k === 'moon' || k === 'mars') continue;                          // space.js owns those kinds (built here, see buildBody)
  const params = { ...COMMON_P, radius: B.R };
  if (B.rings) Object.assign(params, { rings: 'true (default) | false', ring_brightness: '0.3 .. 2' });
  if (B.drift) params.drift = 'band drift speed x (default 1; 0 frozen)';
  if (k === 'jupiter') params.spot_lon = 'deg: where the Great Red Spot sits (default 25: right of the disc centre)';
  if (k === 'neptune') params.spot_lon = 'deg: where the Great Dark Spot sits';
  CATALOG['space.' + k] = { desc: B.desc + '. Camera: move orbit_planet / approach / map_dive (core/spacecam.js).', actions: ['idle', 'spin'], params, footprint: [B.R * 2, B.R * 2], height: B.R * 2, tags: ['space', 'planet', k] };
}
CATALOG['space.lineup'] = { desc: 'the planets side by side at their TRUE relative sizes (Mercury .. Pluto, Saturn with its rings), left to right from the Sun, standing on one line; earth_radius sets the scale. For "how big is it" moments: push along the row', actions: ['idle'], params: { earth_radius: 40, gap: 0.35, planets: '["mercury", ...] subset/order', y: 'm (height)' }, footprint: [2200, 900], height: 900, tags: ['space', 'planet', 'scale'] };
CATALOG['space.solar_system'] = { desc: 'a schematic Solar System: the Sun in the middle, log-spaced orbit rings (readable, not to scale), each planet on its orbit, lit by the central Sun; for "where are we" / tier-list moments. size = outer orbit radius', actions: ['idle', 'orbit'], params: { size: 400, planets: '["mercury", ...]', planet_scale: 1, orbit_speed: '1 (0 frozen)', angle0: 20 }, footprint: [800, 800], height: 120, tags: ['space', 'scale'] };

export async function build(kind, item, ctx) {
  if (kind === 'space.lineup' || kind === 'space.solar_system') return buildScaleDevice(kind, item, ctx);
  const key = kind.replace(/^space\./, '');
  if (!BODIES[key]) throw new Error('planets: unknown body ' + kind);
  return buildBody(key, item, ctx);
}
