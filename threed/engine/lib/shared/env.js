// env.js — time of day, light and atmosphere. One table keyed on the sun's elevation drives the sun, the sky
// ambient, the haze and the exposure; the moon takes over as key light at night. The height fog below replaces
// three.js's fog chunks in EVERY material (patchMaterial), so the city, the sea, the sky and the tower share one
// aerial perspective: haze thick at the water, thin aloft, warm towards the sun.
import * as THREE from 'three';
import { table, lin, smooth, clamp, deg, lerp } from './util.js';

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonColor: { value: new THREE.Color(0, 0, 0) },
  uFogColor: { value: new THREE.Color(0.5, 0.6, 0.7) },
  uFogSunColor: { value: new THREE.Color(0.3, 0.2, 0.1) },
  uFogDensity: { value: 0.00015 },
  uFogFalloff: { value: 0.0035 },
  uFogBase: { value: 0 },
  uMirror: { value: 0 },
  uNight: { value: 0 },
  uFirePos: { value: new THREE.Vector3(0, 110, 0) },
  uFireColor: { value: new THREE.Color(1, 0.5, 0.2) },
  uFireI: { value: 0 },
  uWet: { value: 0 },
  uAsh: { value: 0 },            // volcanic ash lying on every up-facing surface, 0..1 (core/weather.js sets it)
  uAshKind: { value: 0 },        // 1: weather.ash_kind 'volcanic' (a matte grey deposit, also on roofs, cars, roads)
  uFogNear: { value: new THREE.Color(0.5, 0.6, 0.7) }, uFogBlue: { value: 0 },    // Q5 aerial perspective (look.js sets them)
};

export const FOG_GLSL = /* glsl */`
uniform vec3 uFogColor; uniform vec3 uFogSunColor; uniform vec3 uSunDir;
uniform float uFogDensity; uniform float uFogFalloff; uniform float uFogBase; uniform float uMirror;
float wfogIntegral(vec3 ro, vec3 rd, float d) {
  float b = uFogFalloff;
  float k = rd.y * b;
  float base = uFogDensity * exp(-b * max(ro.y - uFogBase, -50.0));
  float f = abs(k) < 1e-5 ? d : (1.0 - exp(-d * k)) / k;
  return base * f;
}
float wfogAmount(vec3 ro, vec3 rd, float d) {
  float I;
  if (uMirror > 0.5 && ro.y < uFogBase && rd.y > 0.0) {
    float s = min(d, (uFogBase - ro.y) / rd.y);
    vec3 roM = vec3(ro.x, 2.0 * uFogBase - ro.y, ro.z);
    vec3 rdM = vec3(rd.x, -rd.y, rd.z);
    I = wfogIntegral(roM, rdM, s) + wfogIntegral(ro + rd * s, rd, max(d - s, 0.0));
  } else {
    I = wfogIntegral(ro, rd, d);
  }
  return 1.0 - exp(-I);
}
vec3 wfogColor(vec3 rd) {
  float s = max(dot(rd, uSunDir), 0.0);
  return uFogColor + uFogSunColor * (pow(s, 5.0) * 0.5 + pow(s, 40.0) * 0.45);
}
`;
// Q5 aerial perspective for the built-in materials (the fog chunk): through a little air the added light is the sky a
// few degrees up (bluer: distant hills and forests turn blue), through a lot of air it becomes the pale horizon.
// uFogBlue is 0 under a full deck, in fog and at night (look.js), which leaves the old single colour.
const FOG_NEAR_GLSL = /* glsl */`
uniform vec3 uFogNear; uniform float uFogBlue;
vec3 wfogColorA(vec3 rd, float a) { return mix(wfogColor(rd), uFogNear, uFogBlue * (1.0 - smoothstep(0.08, 0.75, a))); }
`;

// replace three.js's fog chunks once, before any material compiles
export function installFogChunks() {
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\n varying vec3 vFogWorld;\n#endif\n`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG\n vFogWorld = transpose(mat3(viewMatrix)) * mvPosition.xyz + cameraPosition;\n#endif\n`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG\n varying vec3 vFogWorld;\n${FOG_GLSL}\n${FOG_NEAR_GLSL}\n#endif\n`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  { vec3 fr = vFogWorld - cameraPosition; float fd = length(fr); vec3 frd = fr / max(fd, 1e-3);
    float fa = wfogAmount(cameraPosition, frd, fd); gl_FragColor.rgb = mix(gl_FragColor.rgb, wfogColorA(frd, fa), fa); }
#endif\n`;
}

const FOG_KEYS = ['uFogColor', 'uFogSunColor', 'uSunDir', 'uFogDensity', 'uFogFalloff', 'uFogBase', 'uMirror', 'uFogNear', 'uFogBlue'];
// give a built-in material the shared fog uniforms (+ an optional extra onBeforeCompile)
export function patchMaterial(m, extra) {
  if (!m || m.userData.__patched) return m;
  m.userData.__patched = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    for (const k of FOG_KEYS) shader.uniforms[k] = U[k];
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(shader, r);
    if (extra) extra(shader, r);
    if (!m.isShaderMaterial) addAsh(shader);
  };
  const key = (m.customProgramCacheKey ? m.customProgramCacheKey() : '') + '|wfog|ash' + (extra ? '|' + (m.userData.progKey || extra.toString().length) : '');
  m.customProgramCacheKey = () => key;
  return m;
}

// ash cover: after an ashfall everything that faces up is grey (ground, grass, roofs, cars, shoulders), a little patchy.
// Lit like the surface it lies on (it replaces the albedo before lighting). U.uAsh = 0 leaves every material as it was.
function addAsh(shader) {
  const fs = shader.fragmentShader, mainRe = /void\s+main\s*\(\s*\)\s*\{/;
  if (!fs.includes('#include <normal_fragment_maps>') || !mainRe.test(fs) || fs.includes('uAshCover')) return;
  shader.uniforms.uAshCover = U.uAsh; shader.uniforms.uAshKind = U.uAshKind; shader.uniforms.uAshWet = U.uWet;
  shader.fragmentShader = fs
    .replace(mainRe, (m) => `uniform float uAshCover; uniform float uAshKind; uniform float uAshWet;
      float ashH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float ashN(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(ashH(i), ashH(i + vec2(1.0, 0.0)), u.x), mix(ashH(i + vec2(0.0, 1.0)), ashH(i + vec2(1.0, 1.0)), u.x), u.y); }
      ${m}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uAshCover > 0.001) {
        vec3 aN = inverseTransformDirection(normal, viewMatrix);
      #ifdef USE_FOG
        vec3 aP = vFogWorld;
      #else
        vec3 aP = vec3(0.0);
      #endif
        float aV = ashN(aP.xz * 0.23 + 3.7) * 0.6 + ashN(aP.xz * 0.9 - 1.3) * 0.4;
        if (uAshKind > 0.5) {
          // volcanic ash: a matte, fine-grained grey deposit on everything that faces up (roofs, car roofs and hoods,
          // windscreens, roads, grass), thicker on the flat; soaked by rain it is darker and a little glossier
          float aD = length(aP - cameraPosition);
          float grain = mix(0.5, ashH(floor(aP.xz * 55.0 + aP.y * 13.0)), 1.0 - smoothstep(6.0, 30.0, aD));
          float aKv = clamp(uAshCover * smoothstep(0.1, 0.55, aN.y) * (0.82 + 0.18 * aV), 0.0, 0.97);
          vec3 ashC = vec3(0.5, 0.48, 0.44) * (0.86 + 0.22 * aV) * (0.82 + 0.36 * grain) * (1.0 - 0.4 * uAshWet);
          diffuseColor.rgb = mix(diffuseColor.rgb, ashC, aKv);
        #ifdef STANDARD
          roughnessFactor = mix(roughnessFactor, mix(0.98, 0.72, uAshWet), aKv);
          metalnessFactor = mix(metalnessFactor, 0.0, aKv);
        #endif
        } else {
          float aK = uAshCover * smoothstep(0.2, 0.75, aN.y) * (0.72 + 0.28 * aV);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.37, 0.355, 0.33) * (0.9 + 0.2 * aV), clamp(aK, 0.0, 0.94));
        }
      }`);
}

// ── the day ─────────────────────────────────────────────────────────────────────────────────────────────
// rows keyed on sun elevation in degrees. Colours are sRGB hex -> linear on use.
const DAY = [
  { k: -24, sun: [0, 0, 0], sunI: 0, zen: lin('#01030A'), hor: lin('#060B18'), sunHor: lin('#060B18'), amb: lin('#10203C'), ambI: 0.05, gnd: lin('#05070A'),
    fog: lin('#0A1222'), fogSun: lin('#000000'), dens: 0.00010, exp: 2.7, stars: 1.0, night: 1 },
  { k: -12, sun: [0, 0, 0], sunI: 0, zen: lin('#040A1E'), hor: lin('#101C38'), sunHor: lin('#1C2446'), amb: lin('#1A2A4C'), ambI: 0.07, gnd: lin('#070A10'),
    fog: lin('#14203A'), fogSun: lin('#0A0A14'), dens: 0.00011, exp: 2.5, stars: 0.9, night: 1 },
  { k: -6, sun: [0, 0, 0], sunI: 0, zen: lin('#0E1C44'), hor: lin('#34466E'), sunHor: lin('#6C5A78'), amb: lin('#34487A'), ambI: 0.12, gnd: lin('#0C1018'),
    fog: lin('#2A3858'), fogSun: lin('#3A2A3A'), dens: 0.00012, exp: 2.2, stars: 0.35, night: 0.85 },
  { k: -2, sun: lin('#FF6A2A'), sunI: 0.15, zen: lin('#1C3466'), hor: lin('#6A6A8C'), sunHor: lin('#E07A4A'), amb: lin('#5A6A9A'), ambI: 0.22, gnd: lin('#1A1612'),
    fog: lin('#5A5A74'), fogSun: lin('#C0603A'), dens: 0.00013, exp: 1.6, stars: 0.05, night: 0.4 },
  { k: 1, sun: lin('#FF7A38'), sunI: 1.3, zen: lin('#2A4E8A'), hor: lin('#B4A0A4'), sunHor: lin('#F79A56'), amb: lin('#7A88B0'), ambI: 0.3, gnd: lin('#2A2018'),
    fog: lin('#9A8E96'), fogSun: lin('#F08A48'), dens: 0.00014, exp: 1.25, stars: 0, night: 0.1 },
  { k: 5, sun: lin('#FFA25A'), sunI: 2.5, zen: lin('#2E5A9E'), hor: lin('#CFB49A'), sunHor: lin('#F8B878'), amb: lin('#8298C4'), ambI: 0.34, gnd: lin('#3A2E22'),
    fog: lin('#B8A490'), fogSun: lin('#F49A58'), dens: 0.0001, exp: 0.98, stars: 0, night: 0 },
  { k: 12, sun: lin('#FFC690'), sunI: 3.0, zen: lin('#2C62B0'), hor: lin('#B8C8D8'), sunHor: lin('#F0CFA0'), amb: lin('#88A8D4'), ambI: 0.4, gnd: lin('#4A3E30'),
    fog: lin('#A8BCD0'), fogSun: lin('#E8B080'), dens: 0.000065, exp: 0.88, stars: 0, night: 0 },
  { k: 30, sun: lin('#FFE6C8'), sunI: 3.4, zen: lin('#2466BC'), hor: lin('#A6C2E0'), sunHor: lin('#DCD8CC'), amb: lin('#8CB0DC'), ambI: 0.44, gnd: lin('#5A4C3C'),
    fog: lin('#9CB8D6'), fogSun: lin('#D0C0A8'), dens: 0.00005, exp: 0.82, stars: 0, night: 0 },
  { k: 60, sun: lin('#FFF2E2'), sunI: 3.6, zen: lin('#205FB8'), hor: lin('#9EBCDE'), sunHor: lin('#D4DCE4'), amb: lin('#90B4E0'), ambI: 0.46, gnd: lin('#605040'),
    fog: lin('#98B4D4'), fogSun: lin('#C4BCA8'), dens: 0.000045, exp: 0.8, stars: 0, night: 0 },
];

// sun position from the hour (latitude 31 N, spring), rotated by `az` degrees for composition
export function sunFromHour(h, azOffset = 0) {
  const lat = 31.2 * deg, dec = 4 * deg;
  const H = (h - 12) * 15 * deg;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI; // from north, clockwise
  az += azOffset * deg;
  return { el: el / deg, az: az / deg };
}

// world direction from azimuth (deg from north = -Z, clockwise to east = +X) and elevation (deg)
export function dirFromAzEl(az, el, out = new THREE.Vector3()) {
  const a = az * deg, e = el * deg;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

// the whole state of the sky for one moment. o: {sunAz, sunEl} or {hour, azOffset}; moonAz/moonEl; cloud; haze; storm
export function computeEnv(o) {
  let sunEl, sunAz;
  if (o.sunEl != null) { sunEl = o.sunEl; sunAz = o.sunAz ?? 250; }
  else { const s = sunFromHour(o.hour ?? 12, o.azOffset ?? 0); sunEl = s.el; sunAz = s.az; }
  const row = table(DAY, sunEl);
  const storm = clamp(o.storm ?? 0);
  const sunDir = dirFromAzEl(sunAz, Math.max(sunEl, -30));
  const moonDir = dirFromAzEl(o.moonAz ?? 150, o.moonEl ?? 25);
  const night = row.night;
  const moonUp = smooth((moonDir.y + 0.02) / 0.12);
  const moonI = night * moonUp * (o.moonI ?? 0.7);
  const haze = o.haze ?? 1;
  const e = {
    sunEl, sunAz, sunDir, moonDir, night, storm,
    sunColor: row.sun, sunI: row.sunI * (1 - storm * 0.85) * (o.sunMul ?? 1),
    moonColor: lin('#B4C4EC'), moonI,
    zenith: row.zen, horizon: row.hor, sunHorizon: row.sunHor,
    amb: row.amb, ambI: row.ambI * (1 + storm * 0.3) * (o.ambMul ?? 1), gnd: row.gnd,
    fog: row.fog.map((v, i) => lerp(v, [0.16, 0.16, 0.17][i] * (1 - night * 0.8), storm * 0.8)),
    fogSun: row.fogSun.map((v) => v * (1 - storm)),
    fogDensity: row.dens * haze * (1 + storm * 2.5),
    fogFalloff: o.falloff ?? 0.0032,
    exposure: row.exp * (o.expMul ?? 1) * (1 + storm * 0.25),
    stars: row.stars * (1 - storm),
    cloud: clamp((o.cloud ?? 0.35) + storm * 0.9),
    cloudDark: storm,
    cityLights: smooth((night - 0.25) / 0.6),
    fireI: o.fireI ?? (0.06 + 0.94 * smooth((night - 0.05) / 0.5)),
  };
  return e;
}
