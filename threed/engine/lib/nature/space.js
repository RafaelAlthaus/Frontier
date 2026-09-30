// space.js — bodies and backdrops beyond the atmosphere:
//   space.earth     Natural Earth II day map, city lights on the night side, ocean glint, drifting clouds with shadows,
//                   blue atmosphere rim that turns amber at the terminator
//   space.moon      procedural maria and craters (3D noise, no seams), hard terminator
//   space.mars      rust surface with dark albedo regions, polar caps, thin butterscotch rim
//   space.sun       blinding disk + corona halo (drives bloom)
//   space.starfield stars + Milky Way on a sphere that follows the camera (also the world backdrop for biome "space")
//   space.asteroid_field   tumbling instanced rocks          space.rocket_exhaust   flickering plume
// Bodies use U.uSunDir for their light. All motion is a function of t (spin in deg/s, tumble per rock).
import * as THREE from 'three';
import { U, FOG_GLSL } from '../shared/env.js';
import { rng, clamp, lerp, makeNoise } from '../shared/util.js';
import * as TX from './tex.js';
import { NOISE_GLSL } from './tex.js';
// E4 (v2): the Solar System bodies live in planets.js (space.moon / space.mars are built there now), the other worlds'
// skies, light overrides and dust in spacefx.js; one space sun per scene (planets.js spaceState) lights them all
import { buildBody, spaceState, sunFromSpec, planOf, makeHalo } from './planets.js';
import { skyDome, overrideLights, bakeEnv, dustMotes } from './spacefx.js';

const BASE = new URL('./data/', import.meta.url).href;

export const CATALOG = {
  'space.earth': { desc: 'the Earth from orbit: real continents (Natural Earth II), clouds, city lights at night, atmosphere. lon/lat = the point facing +Z (or the world point `face: [x, y, z]`, e.g. the camera key) at t = 0; tilt leans the north pole to the viewer\'s right; spin deg/s eastward; veil 0..1 or [from, to] over the shot = a sulphate haze (volcanic winter)', actions: ['idle', 'spin'], params: { radius: 600, spin: 0.4, tilt: 23.4, lon: 10, lat: 0, clouds: 0.8, y: 0 }, footprint: [1200, 1200], height: 1200, tags: ['space', 'planet'] },
  'space.moon': { desc: 'the Moon: grey highlands, dark maria on the near side, craters with relief, Tycho and Copernicus rays, a knife-edge terminator (E4 v2: planets.js; lon/lat/tilt/face/phase as every space.* body)', actions: ['idle', 'spin'], params: { radius: 170, spin: 0.2, y: 0, lon: 0, lat: 0, phase: 'deg (optional): 0 full .. 150 crescent, see space.mercury' }, footprint: [340, 340], height: 340, tags: ['space', 'planet'] },
  'space.mars': { desc: 'Mars from orbit: rust plains, dark Syrtis Major / Acidalia, pale Hellas, Valles Marineris, the Tharsis volcanoes and Olympus Mons, polar caps, a thin butterscotch haze on the limb (E4 v2: planets.js; lon -70 shows Valles Marineris and Tharsis, lon 70 Syrtis and Hellas)', actions: ['idle', 'spin'], params: { radius: 320, spin: 0.4, y: 0, lon: -70, lat: 10, phase: 'deg (optional), see space.mercury' }, footprint: [640, 640], height: 640, tags: ['space', 'planet'] },
  'space.sun': { desc: 'the Sun: blinding disk and corona (place far away along the key light)', actions: ['idle'], params: { radius: 300, y: 0 }, footprint: [600, 600], height: 600, tags: ['space', 'star'] },
  'space.starfield': { desc: 'stars and the Milky Way on the sky sphere (night skies, space)', actions: ['idle'], params: { milky: 0.8, brightness: 1 }, footprint: [0, 0], height: 0, tags: ['space', 'sky'] },
  'space.asteroid_field': { desc: 'a belt of tumbling rocks around a point', actions: ['idle'], params: { count: 400, radius: 400, size: 6 }, footprint: [800, 800], height: 200, tags: ['space'] },
  'space.rocket_exhaust': { desc: 'flickering rocket plume pointing down from `at` (y = altitude)', actions: ['burn'], params: { length: 40, width: 4, y: 20, color: 'orange' }, footprint: [6, 6], height: 40, tags: ['space', 'fx'] },
};

// ── the star sphere ─────────────────────────────────────────────────────────────────────────────────────────────
export function makeStars(o = {}) {
  const mat = new THREE.ShaderMaterial({
    // E4 v2: uSunDisc 1 draws the Sun (a white disc + glare) toward uSun: space and the lunar sky (off for a starfield
    // object in an Earth sky, which has its own sun)
    uniforms: { uBright: { value: o.brightness ?? 1 }, uMilky: { value: o.milky ?? 0.85 }, uTime: { value: 0 }, uSun: o.uSun || { value: new THREE.Vector3(0, 1, 0) }, uSunDisc: { value: o.sun ? 1 : 0 }, uSunR: { value: (o.sunSize ?? 0.27) * Math.PI / 180 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir; uniform float uBright; uniform float uMilky; uniform float uTime; uniform vec3 uSun; uniform float uSunDisc; uniform float uSunR;
      ${NOISE_GLSL}
      vec3 stars(vec3 rd, float scale, float th, float gain){
        vec3 p = rd * scale; vec3 ci = floor(p), cf = fract(p);
        float h = n_h13(ci);
        if (h < th) return vec3(0.0);
        vec3 sp = vec3(n_h13(ci + 1.7), n_h13(ci + 3.3), n_h13(ci + 5.1)) * 0.6 + 0.2;
        float d = length(cf - sp);
        float mag = pow((h - th) / (1.0 - th), 5.0);
        vec3 sc = mix(vec3(1.0, 0.78, 0.55), vec3(0.7, 0.82, 1.0), n_h13(ci + 9.0));
        return sc * smoothstep(0.08, 0.0, d) * (0.3 + 3.0 * mag) * gain;
      }
      void main(){
        vec3 rd = normalize(vDir);
        vec3 col = stars(rd, 300.0, 0.9, 1.0) + stars(rd, 700.0, 0.95, 0.45) + stars(rd, 1500.0, 0.97, 0.2);
        vec3 gn = normalize(vec3(0.35, 0.55, -0.76));
        float band = exp(-pow(dot(rd, gn) / 0.2, 2.0));
        float mw = n_fbm3(rd * 5.0, 5) * 0.9 + n_fbm3(rd * 22.0, 4) * 0.35;
        float lane = smoothstep(0.5, 0.72, n_fbm3(rd * 8.0 + 4.0, 4));
        vec3 bulge = vec3(1.0, 0.85, 0.65) * exp(-pow(length(rd - normalize(vec3(0.6, -0.1, -0.8))) / 0.5, 2.0)) * 0.6;
        col += (vec3(0.55, 0.62, 0.82) + bulge) * band * mw * (1.0 - lane * (uSunDisc > 0.5 ? 0.3 : 0.75)) * 0.11 * uMilky;   // E4: a soft lane in space (dark blobs read as smoke)
        col += stars(rd, 520.0, 0.93, 0.8) * band * 1.5;
        col *= uBright;
        if (uSunDisc > 0.5) {                                 // E4 v2: the Sun in a black sky: a white disc, a tight glare
          float mu = dot(rd, normalize(uSun)), ang = acos(clamp(mu, -1.0, 1.0));
          col *= 1.0 - 0.9 * exp(-ang / 0.25);               // no stars in the glare
          col += vec3(1.0, 0.98, 0.94) * (smoothstep(uSunR * 1.06, uSunR * 0.94, ang) * 40.0 + exp(-ang / 0.007) * 1.6 + exp(-ang / 0.07) * 0.05 + exp(-ang / 0.35) * 0.012);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false, depthTest: false, side: THREE.BackSide, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1e6 + 2; mesh.name = 'nature.stars'; mesh.userData.noQA = true;
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); mesh.updateMatrixWorld(); };
  return mesh;
}

// ── planets ─────────────────────────────────────────────────────────────────────────────────────────────────────
const PLANET_VS = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vN; varying vec3 vP; varying vec3 vL;          // world normal, world position, body-local direction
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vL = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }`;
function earthMaterial(day, aux, o, st) {
  return new THREE.ShaderMaterial({
    uniforms: { uCtr: { value: new THREE.Vector3() }, uRad: { value: o.radius ?? 600 }, uDay: { value: day }, uAux: { value: aux }, uSunDir: st ? st.uSun : U.uSunDir, uSunColor: U.uSunColor, uTime: { value: 0 }, uClouds: { value: o.clouds ?? 0.8 }, uCloudRot: { value: 0 }, uLights: { value: o.lights ?? 1 }, uSunLocal: { value: new THREE.Vector3(0, 1, 0) }, uVeil: { value: 0 } },
    vertexShader: PLANET_VS,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uCtr; uniform float uRad;
      uniform sampler2D uDay; uniform sampler2D uAux; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uTime; uniform float uClouds; uniform float uCloudRot; uniform float uLights; uniform vec3 uSunLocal; uniform float uVeil;
      varying vec3 vN; varying vec3 vP; varying vec3 vL;
      ${NOISE_GLSL}
      // equirectangular lookup. East must sit on the viewer's right seen from outside with north up: lon = atan(-x, -z)
      // (Q8 26 Sep: it was atan(x, -z), which mirrored every globe east-west)
      vec2 eq(vec3 d){ return vec2(atan(-d.x, -d.z) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5); }
      // mip-correct lookup: at the u wrap (lon 180) take the derivatives of the shifted coordinate (no seam line)
      vec4 texEq(sampler2D s, vec2 uv, float bias){
        vec2 dx = dFdx(uv), dy = dFdy(uv); vec2 u2 = vec2(fract(uv.x + 0.5), uv.y); vec2 dx2 = dFdx(u2), dy2 = dFdy(u2);
        if (abs(dx2.x) + abs(dy2.x) < abs(dx.x) + abs(dy.x)) { dx.x = dx2.x; dy.x = dy2.x; }
        float k = exp2(bias); return textureGrad(s, uv, dx * k, dy * k);
      }
      float cloud(vec3 d){
        float a = uCloudRot; mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a)); d.xz = r * d.xz;
        vec3 q = d * 3.0 + vec3(n_fbm3(d * 2.0, 3), n_fbm3(d * 2.0 + 5.2, 3), n_fbm3(d * 2.0 + 9.1, 3)) * 1.6;
        float n = n_fbm3(q, 6);
        float lat = abs(d.y);
        float band = 0.55 + 0.25 * smoothstep(0.15, 0.0, lat) + 0.2 * smoothstep(0.35, 0.7, lat) - 0.15 * smoothstep(0.1, 0.3, lat) * (1.0 - smoothstep(0.3, 0.45, lat));
        return smoothstep(0.62 - band * 0.2 * uClouds, 0.8, n + (uClouds - 0.8) * 0.2) * uClouds;
      }
      void main(){
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vP); vec3 L = normalize(uSunDir);
        vec2 uv = eq(vL);
        vec3 day = texEq(uDay, uv, 0.0).rgb;
        vec3 ax = texEq(uAux, uv, 0.0).rgb;
        float water = ax.g;
        float ndl = dot(N, L);
        float lit = smoothstep(-0.08, 0.12, ndl);
        // land: a touch deeper and less saturated than the map; oceans: deep blue with glint
        // E4 v2: richer land under the white space sun (the map's deserts read pale and washed out): deeper, more saturated
        vec3 land = pow(day, vec3(1.45)) * 0.9; float lum = dot(land, vec3(0.3, 0.55, 0.15)); land = mix(vec3(lum), land, 1.25);
        vec3 ocean = vec3(0.007, 0.03, 0.078) + vec3(0.0, 0.012, 0.03) * n_fbm3(vL * 20.0, 3);
        vec3 alb = mix(land, ocean, water);
        // sunlight reddens toward the terminator (the long path through the air)
        vec3 sunT = uSunColor * mix(vec3(1.0, 0.5, 0.26), vec3(1.0), smoothstep(-0.02, 0.3, ndl));
        vec3 col = alb * sunT * max(ndl, 0.0) * 1.2;
        vec3 Hh = normalize(L + V);
        col += sunT * water * pow(max(dot(N, Hh), 0.0), 400.0) * 0.7 * lit;         // a small sun glint, not a glassy blob
        col += sunT * water * pow(max(dot(N, Hh), 0.0), 40.0) * 0.025 * lit;
        // clouds + their shadows (no grey ambient on the night side: that read as a glass ball)
        float c = cloud(vL);
        float cs = cloud(normalize(vL + uSunLocal * 0.012));
        col *= 1.0 - cs * 0.55 * lit;
        vec3 cc = vec3(1.0) * sunT * (max(ndl, 0.0) * 0.95 + 0.03 * lit + 0.004) * (0.85 + 0.15 * n_v3(vL * 60.0));
        col = mix(col, cc, c * 0.93);
        // city lights on the night side (under the clouds): small sharp towns clumped by a fine grain, a warm glow over
        // the dense regions (the aux map's dots blurred by the mip chain), whiter in the cores
        float night = 1.0 - smoothstep(-0.12, 0.04, ndl);
        float dens = texEq(uAux, uv, 3.5).r, glowFine = 0.0;
        float grain = n_fbm3(vL * 380.0, 3);
        float towns = pow(ax.r, 2.2) * smoothstep(0.3, 0.7, grain + 0.25 * ax.r);
        { float px = length(fwidth(vL)) * 2400.0, fineK = 1.0 - smoothstep(0.3, 1.0, px);      // close up: specks, not blobs
          towns *= mix(1.0, smoothstep(0.42, 0.8, n_fbm3(vL * 2400.0, 2) + 0.15) * 2.2, fineK); glowFine = fineK;
          float fineK2 = 1.0 - smoothstep(0.3, 1.0, px * 4.0);
          towns *= mix(1.0, smoothstep(0.4, 0.8, n_fbm3(vL * 9600.0, 2) + 0.15) * 2.0, fineK2); }
        float glow = smoothstep(0.015, 0.2, dens) * dens * (0.6 + 0.8 * grain) * (1.0 - 0.5 * glowFine);
        float cityL = (towns * 1.6 + glow * 1.1) * night * (1.0 - c * 0.85) * uLights;
        col += mix(vec3(1.0, 0.55, 0.22), vec3(1.0, 0.86, 0.62), clamp(towns * 1.5, 0.0, 1.0)) * cityL;
        // atmosphere in front of the surface: a thin blue limb on the day side, amber at the terminator,
        // a faint green airglow line on the night limb (no veil over the night disc)
        float mu = max(dot(N, V), 0.0);
        float camK = smoothstep(1.02, 1.4, length(cameraPosition - uCtr) / uRad);   // E4: no limb band for a lens near the surface
        float rim = pow(1.0 - mu, 4.0) * camK;
        float term = exp(-pow(ndl / 0.16, 2.0));
        vec3 atm = mix(vec3(0.25, 0.5, 1.0), vec3(1.0, 0.42, 0.13), term * 0.85) * uSunColor;
        col += atm * rim * smoothstep(-0.2, 0.3, ndl) * 1.0;
        col += vec3(0.1, 0.2, 0.45) * uSunColor * smoothstep(-0.1, 0.5, ndl) * 0.05;
        col += vec3(0.06, 0.2, 0.14) * pow(1.0 - mu, 9.0) * night * 0.6 * camK;
        // (Q8) veil: a sulphate / ash veil (volcanic winter): pale haze over the lit disc, a milky limb, dimmer lights
        if (uVeil > 0.001) {
          float vn = 0.75 + 0.25 * n_fbm3(vL * 3.0 + vec3(uCloudRot * 30.0), 3);
          vec3 vc = vec3(0.8, 0.76, 0.66) * uSunColor * (max(ndl, 0.0) * 0.85 + 0.03);
          col = mix(col, vc, clamp(uVeil * 0.6 * vn, 0.0, 0.85));
          col += vec3(0.95, 0.88, 0.72) * uSunColor * pow(1.0 - mu, 2.2) * uVeil * 0.45 * smoothstep(-0.2, 0.3, ndl);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
function atmosphereShell(color, amount, st) {
  return new THREE.ShaderMaterial({
    uniforms: { uSunDir: st ? st.uSun : U.uSunDir, uSunColor: U.uSunColor, uCol: { value: new THREE.Color(...color) }, uAmt: { value: amount } },
    vertexShader: PLANET_VS,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uCol; uniform float uAmt;
      varying vec3 vN; varying vec3 vP; varying vec3 vL;
      void main(){
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vP);
        float mu = dot(N, V);                                          // back faces: the glow outside the limb
        float edge = pow(clamp(1.0 - abs(mu), 0.0, 1.0), 2.0);
        float ndl = dot(N, normalize(uSunDir));
        float lit = smoothstep(-0.35, 0.25, ndl);
        float fwd = pow(max(dot(-V, normalize(uSunDir)), 0.0), 8.0);
        vec3 c = uCol * uSunColor * (lit * 0.9 + fwd * 1.5) + vec3(1.0, 0.5, 0.2) * uSunColor * exp(-pow(ndl / 0.2, 2.0)) * 0.5;
        float a = edge * edge * uAmt * (lit + fwd);
        gl_FragColor = vec4(c * a, 1.0);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
function rockyMaterial(kind, o) {
  const mars = kind === 'mars';
  return new THREE.ShaderMaterial({
    uniforms: { uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSeed: { value: o.seed ?? 3.7 }, uBumpK: { value: (o.radius ?? 200) * (mars ? 0.0025 : 0.005) } },
    vertexShader: PLANET_VS,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSeed; uniform float uBumpK;
      varying vec3 vN; varying vec3 vP; varying vec3 vL;
      ${NOISE_GLSL}
      // craters: distance to jittered cell centres on the sphere (3D cells), returns (bowl, rim)
      vec2 craters(vec3 d, float s){
        vec3 p = d * s; vec3 i = floor(p); float bowl = 0.0, rim = 0.0;
        for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
          vec3 c = i + vec3(float(x), float(y), float(z));
          float h = n_h13(c + uSeed);
          if (h > 0.45) continue;
          vec3 cp = c + vec3(n_h13(c + 1.3), n_h13(c + 2.9), n_h13(c + 4.1));
          float r = 0.18 + 0.3 * n_h13(c + 7.7);
          float dd = length(p - cp) / r;
          bowl += (1.0 - smoothstep(0.0, 1.0, dd)) * 0.5;
          rim += exp(-pow((dd - 1.0) / 0.18, 2.0));
        }
        return vec2(bowl, rim);
      }
      float heightF(vec3 d){
        vec2 c1 = craters(d, 7.0), c2 = craters(d, 19.0), c3 = craters(d, 47.0);
        return -c1.x * 0.6 + c1.y * 0.35 - c2.x * 0.3 + c2.y * 0.2 - c3.x * 0.12 + c3.y * 0.08 + n_fbm3(d * 30.0, 4) * 0.2;
      }
      void main(){
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vN); vec3 d = normalize(vL);
        // bump from the crater field (object-space gradient approximated with screen derivatives)
        float h = heightF(d);
        vec3 dpx = dFdx(vP), dpy = dFdy(vP); float dhx = dFdx(h * uBumpK), dhy = dFdy(h * uBumpK);
        vec3 r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1);
        vec3 Nb = normalize(abs(det) * N - sign(det) * (dhx * r1 + dhy * r2));
        float ndl = dot(Nb, normalize(uSunDir));
        vec3 alb;
        ${mars ? `
          float dark = smoothstep(0.45, 0.62, n_fbm3(d * 2.2 + uSeed, 5));
          alb = mix(vec3(0.62, 0.3, 0.16), vec3(0.3, 0.17, 0.11), dark) * (0.85 + 0.3 * n_fbm3(d * 12.0, 4));
          alb = mix(alb, vec3(0.9, 0.88, 0.86), smoothstep(0.86, 0.9, abs(d.y) + n_fbm3(d * 8.0, 3) * 0.05));` : `
          float maria = smoothstep(0.5, 0.58, n_fbm3(d * 1.8 + uSeed, 5));
          alb = mix(vec3(0.62, 0.61, 0.59), vec3(0.3, 0.3, 0.31), maria) * (0.85 + 0.3 * n_fbm3(d * 14.0, 4));
          alb += craters(d, 19.0).y * 0.06 + craters(d, 47.0).y * 0.05;`}
        vec3 col = alb * uSunColor * max(ndl, 0.0) * 1.25;
        ${mars ? `{ vec3 V = normalize(cameraPosition - vP); float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0); col += vec3(0.9, 0.55, 0.35) * uSunColor * rim * smoothstep(-0.2, 0.3, dot(N, normalize(uSunDir))) * 0.35; }` : ''}
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ── build ───────────────────────────────────────────────────────────────────────────────────────────────────────
export async function build(kind, item, ctx) {
  const p = Object.assign({}, CATALOG[kind]?.params || {}, item.params || {}, item);
  const root = new THREE.Group(); root.name = kind;
  const at = item.at || [0, 0];
  root.position.set(at[0], p.y ?? 0, at[1]);
  const upd = [], extra = {};
  let radius = 10, height = 10;
  if (kind === 'space.earth') {
    const R = p.radius;
    const [day, aux] = await Promise.all([TX.image(BASE + 'earth_day.jpg'), TX.image(BASE + 'earth_aux.png', false)]);
    const st = spaceState(ctx);                                    // E4 v2: the scene's one space sun (default: the look's)
    if (p.phase != null && Number.isFinite(+p.phase) && !st.phase) st.phase = { phase: clamp(+p.phase, 0, 179), side: p.phase_side || 'right', el: p.phase_el, center: () => root.getWorldPosition(new THREE.Vector3()) };
    const mat = earthMaterial(day, aux, p, st);
    const body = new THREE.Mesh(new THREE.SphereGeometry(R, 256, 128), mat);
    // orientation (Q8): `lon`/`lat` face the view axis at t = 0. The view axis is +Z, or the direction from the Earth
    // to the world point `face: [x, y, z]` (e.g. the camera's key position). `tilt` leans the north pole to the
    // viewer's right around that axis; the spin is eastward (the sub-viewer longitude decreases, as seen from space).
    const spinG = new THREE.Group(); spinG.add(body); spinG.name = 'earth_spin';
    const latG = new THREE.Group(); latG.rotation.x = (p.lat ?? 0) * Math.PI / 180; latG.add(spinG);
    const tilt = new THREE.Group(); tilt.rotation.z = -(p.tilt ?? 23.4) * Math.PI / 180; tilt.add(latG);
    const aimG = new THREE.Group(); aimG.add(tilt); root.add(aimG);
    if (Array.isArray(p.face) && p.face.length >= 3) {
      const eye = new THREE.Vector3(+p.face[0], +p.face[1], +p.face[2]), ctr = new THREE.Vector3(at[0], p.y ?? 0, at[1]);
      if (eye.distanceTo(ctr) > 1e-3) aimG.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, ctr, new THREE.Vector3(0, 1, 0)));
    }
    // E4 v2: a thin physical halo (the ray's closest approach to the surface; bright blue on the day side, a glowing ring
    // when backlit); atmosphere: 'classic' keeps the old thick shell
    const atm = p.atmosphere === 'classic' ? new THREE.Mesh(new THREE.SphereGeometry(R * 1.025, 128, 64), atmosphereShell([0.3, 0.55, 1.0], 1.4, st))
      : makeHalo(R, { halo: 0.017, color: [0.3, 0.55, 1.0], amount: 1.5, fwd: 2.2 }, st);
    root.add(atm);
    const lon0 = (p.lon ?? 10) * Math.PI / 180;
    const qi = new THREE.Quaternion();
    const vl = Array.isArray(p.veil) ? p.veil.map(Number) : [+(p.veil ?? 0), +(p.veil ?? 0)], vdur = Math.max(0.1, +(p.veil_dur ?? ctx.dur ?? 8));
    upd.push((t) => { st.resolve(); root.getWorldPosition(mat.uniforms.uCtr.value); if (atm.material.uniforms.uC) atm.material.uniforms.uC.value.copy(mat.uniforms.uCtr.value); mat.uniforms.uVeil.value = vl[0] + (vl[1] - vl[0]) * Math.min(1, Math.max(0, t / vdur)); spinG.rotation.y = Math.PI - lon0 + (p.spin ?? 0.4) * t * Math.PI / 180; mat.uniforms.uCloudRot.value = t * 0.0008; body.updateWorldMatrix(true, false); body.getWorldQuaternion(qi).invert(); mat.uniforms.uSunLocal.value.copy(st.uSun.value).applyQuaternion(qi).normalize(); });
    radius = R * 1.03; height = R * 2;
    extra.spinG = spinG;
    extra.planet = { key: 'earth', R, obl: 1, center: () => root.getWorldPosition(new THREE.Vector3()), st, body, ring: null, rings: null, spanR: R * 1.03 };   // E4 v2: for the space moves
    extra.subjectAt = () => { const c = root.getWorldPosition(new THREE.Vector3()); return [c.x, c.y, c.z]; }; extra.subjectTop = Math.min(2 * R, 400); extra.subjectCy = 0;
    root.userData.noQA = true;
  } else if (kind === 'space.moon' || kind === 'space.mars') {
    // E4 v2: built by planets.js (relief, named features, lon/lat/tilt/face/phase, the scene's space sun)
    return buildBody(kind === 'space.mars' ? 'mars' : 'moon', item, ctx);
  } else if (kind === 'space.sun') {
    const R = p.radius;
    const core = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(60, 52, 40), fog: false }));
    root.add(core);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(R * 9, R * 9), new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec2 vUv; uniform float uTime; void main(){ vec2 q = vUv - 0.5; float r = length(q) * 2.0; float a = atan(q.y, q.x);
        float ray = 0.6 + 0.4 * sin(a * 18.0 + sin(a * 7.0 + uTime * 0.2) * 2.0);
        vec3 c = vec3(1.0, 0.75, 0.45) * (exp(-r * 9.0) * 7.0 + exp(-r * 3.5) * 0.6 * ray + exp(-r * 1.6) * 0.08);   // E4 r3: a sun object in a space shot no longer blows the frame out
        gl_FragColor = vec4(c, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    root.add(halo);
    upd.push((t) => { halo.material.uniforms.uTime.value = t; });
    radius = R; height = R * 2;
  } else if (kind === 'space.starfield') {
    root.add(makeStars(p));
  } else if (kind === 'space.asteroid_field') {
    const n = p.count ?? 400, Rf = p.radius ?? 400, S = p.size ?? 6;
    const g = new THREE.IcosahedronGeometry(1, 2), pos = g.attributes.position, nz = makeNoise(77);
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const d = 1 + 0.35 * nz.fbm2(x * 1.7 + z, y * 1.7 - z, 4); pos.setXYZ(i, x * d, y * d * 0.8, z * d); }
    g.computeVertexNormals();
    const tr = TX.rock();
    const m = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.95, map: tr.map, normalMap: tr.normalMap });
    const im = new THREE.InstancedMesh(g, (ctx.patch || ((x) => x))(m) || m, n);
    const R = rng(p.seed ?? 5), data = [];
    for (let i = 0; i < n; i++) data.push({ a: R() * Math.PI * 2, r: Rf * (0.6 + R() * 0.8), y: (R() - 0.5) * Rf * 0.25, s: S * (0.2 + Math.pow(R(), 3) * 2.5), ax: new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), w: 0.1 + R() * 0.4, ow: 0.004 + R() * 0.004 });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
    root.add(im);
    upd.push((t) => { data.forEach((d, i) => { const a = d.a + d.ow * t; v.set(Math.cos(a) * d.r, d.y, Math.sin(a) * d.r); q.setFromAxisAngle(d.ax, d.w * t); sc.setScalar(d.s); m4.compose(v, q, sc); im.setMatrixAt(i, m4); }); im.instanceMatrix.needsUpdate = true; });
    radius = Rf * 1.4; height = Rf * 0.3;
  } else if (kind === 'space.rocket_exhaust') {
    const Lx = p.length ?? 40, Wd = p.width ?? 4;
    const g = new THREE.CylinderGeometry(Wd * 0.5, Wd * 0.15, Lx, 32, 16, true); g.translate(0, -Lx / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uL: { value: Lx } },
      vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW; void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `${NOISE_GLSL} varying vec3 vP; varying vec3 vN; varying vec3 vW; uniform float uTime; uniform float uL;
        void main(){ float u = clamp(-vP.y / uL, 0.0, 1.0); vec3 V = normalize(cameraPosition - vW); float f = abs(dot(normalize(vN), V));
          float n = n_fbm3(vec3(vP.x * 0.4, vP.y * 0.25 + uTime * 30.0, vP.z * 0.4), 4);
          float core = pow(f, 1.5) * (1.0 - u) * (0.7 + 0.6 * n);
          vec3 c = mix(vec3(1.0, 0.9, 0.7) * 6.0, vec3(1.0, 0.42, 0.08) * 2.0, smoothstep(0.0, 0.4, u));
          float diamonds = 0.5 + 0.5 * sin(u * 40.0 - uTime * 3.0);
          gl_FragColor = vec4(c * core * (0.8 + 0.4 * diamonds) * (1.0 - smoothstep(0.7, 1.0, u)), 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const plume = new THREE.Mesh(g, mat); root.add(plume);
    upd.push((t) => { mat.uniforms.uTime.value = t; plume.scale.set(1 + 0.05 * Math.sin(t * 37), 1 + 0.04 * Math.sin(t * 23 + 1), 1 + 0.05 * Math.sin(t * 31 + 2)); });
    radius = Wd; height = Lx;
  }
  return { root, radius, height, update(t) { for (const f of upd) f(t); }, anchors: {}, ...extra };
}

// the world for biome "space" (stars only; bodies come as objects) and the sky extras of other bodies (Earth over the Moon)
// E4 v2: one space sun (world.sun {az, el} | [x, y, z], else look.sun, else a body's `phase`, else the look's sun) drawn as
// a disc with glare in the black sky; the look's Earth light replaced every sub-frame (a white key along that sun, no
// blue sky fill, a fixed space exposure) and an environment baked from this sky. Mars (world.js calls this for its
// sky) gets the butterscotch sky with the blue aureole / blue sunset, dust motes and its own image light.
export async function buildSpaceWorld(world, look, ctx, root, opts = {}) {
  const items = [], st = spaceState(ctx);
  ctx.e4world = world.biome === 'moon_surface' ? 'moon_surface' : world.sky === 'mars' ? 'mars' : 'space';   // (space.astronaut: gravity)
  const ws = sunFromSpec(world.sun); if (ws) st.setExplicit(ws);
  const mode = !opts.skyOnly ? 'space' : world.sky === 'mars' ? 'mars' : world.biome === 'moon_surface' ? 'moon' : 'airless';
  let stars = null, sky = null, dust = null, envMat = null, env = null, baked = false;
  if (mode !== 'mars') {
    stars = makeStars({ milky: world.milky ?? 0.9, sun: world.sun_disc !== false, uSun: st.uSun, sunSize: world.sun_size });
    root.add(stars); envMat = stars.material;
  }
  if (mode === 'moon' && world.earth !== false) {
    // the Earth hanging in the black sky, far away (az 200, el 22 by default)
    const az = (world.earth_az ?? 200) * Math.PI / 180, el = (world.earth_el ?? 22) * Math.PI / 180, D = 30000;
    const e = await build('space.earth', { at: [Math.sin(az) * Math.cos(el) * D, -Math.cos(az) * Math.cos(el) * D], y: Math.sin(el) * D, radius: 1100, spin: 0.2 }, ctx);
    e.root.traverse((o) => { if (o.material) o.material.fog = false; });
    root.add(e.root); items.push(e);
  }
  if (mode === 'mars') {
    sky = skyDome({ uSun: st.uSun, mars: true, zen: [0.3, 0.19, 0.12], hor: [0.64, 0.42, 0.26], horSun: [0.7, 0.5, 0.34], sunR: 0.18, sunI: 24, glare: 0.35, glareW: 0.85 });
    root.add(sky.mesh); envMat = sky.mat;
    if (world.dust !== false) { dust = dustMotes({ color: [0.85, 0.58, 0.38], amount: +(world.dust ?? 1), groundY: ctx.ground && ctx.ground.height ? ctx.ground.height(0, 0) : 0, wind: [1.6, 0.12, 0.5], size: 0.8, pxScale: ((ctx.renderer && ctx.renderer.domElement && ctx.renderer.domElement.height) || 1080) / 1080 }); root.add(dust.mesh); }
  }
  const DEGR = 180 / Math.PI, sm = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const update = (t, clock, camera) => {
    st.resolve();
    for (const it of items) it.update(t);
    const L = st.uSun.value, ready = !!planOf(ctx);
    if (ready && !baked && envMat) { env = bakeEnv(ctx, envMat); baked = true; }
    if (mode === 'space') overrideLights(ctx, { dir: L, key: [1, 0.98, 0.95], keyI: 1.55, hemi: [0.1, 0.11, 0.14], gnd: [0.02, 0.022, 0.03], hemiI: 1, exposure: 0.85, sunColor: [1, 0.985, 0.96], env: baked ? env : undefined, envI: 1 });   // E4 r3: a faint fill (a backlit Witness read as a black cut-out)
    else if (mode === 'moon' || mode === 'airless') overrideLights(ctx, { dir: L, key: [1, 0.98, 0.95], keyI: 1.45, hemi: [0.05, 0.05, 0.055], gnd: [0.03, 0.03, 0.03], hemiI: 0.6, sunColor: [1, 0.985, 0.96], env: baked ? env : undefined, envI: 0.35 });
    else if (mode === 'mars') {
      const el = Math.asin(clamp(L.y, -1, 1)) * DEGR, day = 0.12 + 0.88 * sm(-7, 22, el), low = 1 - sm(1, 20, el);
      sky.u.uTime.value = t; sky.u.uDay.value = day;
      if (dust) dust.update(t, camera);
      overrideLights(ctx, {
        key: [1.0, 0.9 - 0.08 * low, 0.78 - 0.12 * low], keyI: 2.6 * sm(-3, 9, el) + 0.05, hemi: [0.62 * day, 0.42 * day, 0.28 * day], gnd: [0.25 * day, 0.14 * day, 0.08 * day], hemiI: 0.95,
        fog: [0.55 * day, 0.36 * day, 0.22 * day], fogSun: [0.22 * low + 0.1, 0.26 * low + 0.07, 0.36 * low + 0.05], fogDensity: 0.00024 * (+(world.haze ?? 1)),
        env: baked ? env : undefined, envI: 0.8,
      });
    }
  };
  return { update, hints: {} };
}
