// water.js — the ocean and still/flowing inland water, both self-contained: each renders its own planar reflection in
// onBeforeRender (as three's Reflector does), so it works in any render loop, per sub-frame.
//   ocean  radial grid that follows the camera, Gerstner swell (same function in JS: waveAt, for floating things),
//          detail normals, reflection, bed-depth colour from the terrain, surf, crest foam, wakes, splash rings,
//          sun and moon glitter, the shared height fog.
//   still  river / lake: mirror reflection distorted by flowing ripples, silty body colour clearing over the
//          shallows, damp margins, glitter.
// API on the returned object: level, waveAt(x,z,t), heightAt(x,z,t), addWake(fn(t)->{x,z,dx,dz,strength,length}),
// splash(x,z,t0,size), update(t, clock, camera).
import * as THREE from 'three';
import { U, FOG_GLSL } from '../shared/env.js';
import * as TX from './tex.js';
import { clamp, lin } from '../shared/util.js';

// swell: [dirX, dirZ, amplitude m, wavelength m, steepness, phase]
const WAVES = [
  [0.80, 0.60, 0.34, 58, 0.55, 0.0], [0.55, 0.83, 0.22, 33, 0.60, 1.7], [0.95, 0.30, 0.14, 19, 0.65, 3.1],
  [0.30, 0.95, 0.10, 12, 0.70, 4.4], [-0.2, 0.98, 0.06, 7.5, 0.70, 2.2], [0.99, -0.12, 0.05, 5.2, 0.65, 5.3],
];
const WP = WAVES.map((w) => { const k = 2 * Math.PI / w[3]; return { k, w: Math.sqrt(9.81 * k) }; });
const sstep = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

export const CATALOG = {
  'water.splash': { desc: 'splash ring + froth on the water at time t (something falling in, a breach)', actions: ['idle'], params: { t: 1, size: 1.5 }, footprint: [4, 4], height: 0, tags: ['water', 'fx'] },
  'water.wake': { desc: 'a moving wake (V arms + turbulent band) for a boat that is not simulated: at, heading, speed', actions: ['move'], params: { speed: 6, length: 90, strength: 1 }, footprint: [8, 40], height: 0, tags: ['water', 'fx'] },
};
export async function build(kind, item, ctx) {
  const root = new THREE.Group();
  const W = (ctx.ground && ctx.ground.water && typeof ctx.ground.water.splash === 'function') ? ctx.ground.water : (ctx.water && typeof ctx.water.splash === 'function' ? ctx.water : null);
  root.userData.noQA = true;
  if (!W) return { root, radius: 1, height: 0, snapped: true, contact: false, update() {}, anchors: {} };
  const at = item.at || [0, 0];
  if (kind === 'water.splash') { W.splash(at[0], at[1], item.t ?? item.params?.t ?? 1, item.size ?? item.params?.size ?? 1.5); }
  if (kind === 'water.wake') {
    const hd = (item.heading ?? 0) * Math.PI / 180, v = item.speed ?? item.params?.speed ?? 6;
    const dx = Math.sin(hd), dz = -Math.cos(hd), L = item.length ?? item.params?.length ?? 90, s = item.strength ?? item.params?.strength ?? 1;
    W.addWake((t) => ({ x: at[0] + dx * v * t, z: at[1] + dz * v * t, dx, dz, strength: s, length: L }));
  }
  return { root, radius: 4, height: 0, snapped: true, contact: false, update() {}, anchors: {} };
}

function sceneLights(scene, cache) {
  if (cache.done) return cache;
  cache.done = true;
  scene.traverse((o) => {
    if (o.isDirectionalLight && (!cache.key || o.castShadow)) cache.key = o;
    if (o.isHemisphereLight) cache.hemi = o;
    if (o.isAmbientLight) cache.amb = o;
  });
  return cache;
}
function ambientFrom(L, out) {
  out.setRGB(0, 0, 0);
  if (L.hemi) out.copy(L.hemi.color).multiplyScalar(L.hemi.intensity * 0.75).add(new THREE.Color(L.hemi.groundColor).multiplyScalar(L.hemi.intensity * 0.1));
  if (L.amb) out.add(new THREE.Color(L.amb.color).multiplyScalar(L.amb.intensity * 0.8));
  if (!L.hemi && !L.amb) out.setRGB(0.25, 0.3, 0.38);
  return out;
}

function radialGrid(rings = 300, segs = 320, r0 = 0.35, rMax = 26000) {
  const g = Math.pow(rMax / r0, 1 / rings);
  const pos = [0, 0, 0];
  for (let i = 0; i <= rings; i++) {
    const r = r0 * Math.pow(g, i);
    for (let j = 0; j < segs; j++) { const a = j / segs * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = 1 + i * segs + j, b = 1 + i * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

// bed heights around the stage (for depth colour and surf): Float32 red texture
function bedTexture(ground, half, N) {
  const d = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) d[j * N + i] = ground.height(-half + (i + 0.5) / N * 2 * half, -half + (j + 0.5) / N * 2 * half);
  const t = new THREE.DataTexture(d, N, N, THREE.RedFormat, THREE.FloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

// the mirror: an oblique-clipped camera under the plane y = level, rendered in the water mesh's onBeforeRender
function makeMirror(mesh, getLevel, scale, hide) {
  const vcam = new THREE.PerspectiveCamera();
  const textureMatrix = new THREE.Matrix4();
  let rt = null;
  const camPos = new THREE.Vector3(), rot = new THREE.Matrix4(), look = new THREE.Vector3(), tgt = new THREE.Vector3();
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4(), normal = new THREE.Vector3(0, 1, 0), size = new THREE.Vector2();
  let busy = false, lastKey = '';
  const uniforms = { uRefl: { value: null }, uReflMat: { value: textureMatrix } };
  mesh.onBeforeRender = (renderer, scene, camera) => {
    if (busy || camera === vcam || !camera.isPerspectiveCamera) return;
    const cur = renderer.getRenderTarget();
    if (cur) size.set(cur.width, cur.height); else renderer.getDrawingBufferSize(size);
    const w = Math.max(64, Math.round(size.x * scale)), h = Math.max(64, Math.round(size.y * scale));
    if (!rt || rt.width !== w || rt.height !== h) {
      if (rt) rt.dispose();
      rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 2 });
      rt.texture.generateMipmaps = false;
      uniforms.uRefl.value = rt.texture;
    }
    const L = getLevel();
    const key = camera.matrixWorld.elements.join(',') + '|' + U.uTime.value + '|' + L;
    if (key === lastKey) return;                                  // same view already mirrored (e.g. a depth pre-pass)
    lastKey = key;
    busy = true;
    camPos.setFromMatrixPosition(camera.matrixWorld);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    tgt.set(look.x, 2 * L - look.y, look.z);
    vcam.position.set(camPos.x, 2 * L - camPos.y, camPos.z);
    vcam.up.set(0, 1, 0).applyMatrix4(rot); vcam.up.y *= -1;
    vcam.lookAt(tgt);
    vcam.near = camera.near; vcam.far = camera.far;
    vcam.updateMatrixWorld();
    vcam.projectionMatrix.copy(camera.projectionMatrix);
    vcam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
    plane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, L - 0.02, 0));
    plane.applyMatrix4(vcam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vcam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + pm[8]) / pm[0]; q.y = (Math.sign(clip.y) + pm[9]) / pm[5]; q.z = -1.0; q.w = (1.0 + pm[10]) / pm[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1.0; pm[14] = clip.w;
    const vis = hide.map((o) => o.visible); hide.forEach((o) => { o.visible = false; });
    mesh.visible = false;
    const autoSh = renderer.shadowMap.autoUpdate, xr = renderer.xr.enabled;
    renderer.shadowMap.autoUpdate = false; renderer.xr.enabled = false;
    const mir = U.uMirror.value, fb = U.uFogBase.value;
    U.uMirror.value = 1; U.uFogBase.value = L;
    renderer.setRenderTarget(rt);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, vcam);
    renderer.setRenderTarget(cur);
    U.uMirror.value = mir; U.uFogBase.value = fb;
    renderer.shadowMap.autoUpdate = autoSh; renderer.xr.enabled = xr;
    if (camera.viewport !== undefined) renderer.state.viewport(camera.viewport);
    mesh.visible = true;
    hide.forEach((o, i) => { o.visible = vis[i]; });
    busy = false;
  };
  return uniforms;
}

const OCEAN_TINTS = {
  temperate: { deep: [0.006, 0.03, 0.045], shallow: [0.03, 0.2, 0.2] },
  tropical: { deep: [0.004, 0.035, 0.07], shallow: [0.02, 0.32, 0.3] },
  north: { deep: [0.008, 0.025, 0.035], shallow: [0.03, 0.12, 0.13] },
  storm: { deep: [0.01, 0.022, 0.026], shallow: [0.04, 0.09, 0.09] },
};

export async function buildWater(o, ctx, root) {
  const scene = ctx.scene;
  const level = o.level ?? 0;
  const L = {};
  const wakes = [];
  const splashes = [];
  const hide = ctx.noReflect || (ctx.noReflect = []);
  let mesh, uniforms, api;
  const wopt = o.world?.water || {};

  if (o.kind === 'ocean') {
    const tint = OCEAN_TINTS[wopt.color || (o.biome === 'jungle' ? 'tropical' : o.look?.sky === 'storm' ? 'storm' : 'temperate')] || OCEAN_TINTS.temperate;
    let swell = wopt.swell ?? (o.look?.sky === 'storm' ? 2.2 : 1.0);
    // E1 v2: the sea state follows weather.wind (0..1 = 0..12 m/s; no weather = 0.35, the old default): wind 0 is a
    // glassy long swell (no short waves, no ripples, no whitecaps: lights and stars reflect as long streaks), 0.5 a
    // moderate chop, 1 a storm sea. Per swell component: the long waves persist in a calm, the short ones need wind.
    const wind = clamp(+(ctx.weatherSpec?.wind ?? ctx.weather?.wind ?? 0.35) || 0, 0, 1.5);
    const ws = (a, b) => sstep((wind - a) / (b - a));
    const ampK = WAVES.map((w) => (w[3] > 30 ? 0.45 + 0.55 * ws(0, 0.35) + 0.5 * ws(0.35, 1) : w[3] > 10 ? ws(0, 0.35) + 0.8 * ws(0.35, 1) : ws(0.02, 0.25) + 0.6 * ws(0.35, 1)));
    const chop = wopt.chop ?? (0.08 + 1.14 * ws(0, 0.35) + 1.2 * ws(0.35, 1));
    const caps = 1.6 * Math.pow(ws(0.25, 1), 1.4);                  // whitecaps: a trace at 0.35, many at 0.7, a storm at 1
    const hasBed = !!o.ground && o.biome !== 'ocean';
    const bed = hasBed ? bedTexture(o.ground, 1400, 1024) : null;
    const wv = WAVES.map((w, i) => new THREE.Vector4(w[0], w[1], w[2] * ampK[i], w[3]));
    const wq = WAVES.map((w) => new THREE.Vector2(w[4], w[5]));
    uniforms = {
      uTime: { value: 0 }, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uMoonDir: U.uMoonDir, uMoonColor: U.uMoonColor,
      uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff,
      uFogBase: U.uFogBase, uMirror: U.uMirror, uNight: U.uNight,
      uNormals: { value: TX.waterNormals() }, uFoam: { value: TX.foam() },
      uBed: { value: bed }, uBedB: { value: new THREE.Vector4(-1400, -1400, 2800, hasBed ? 1 : 0) },
      uWaves: { value: wv }, uWaveQ: { value: wq }, uSwell: { value: swell }, uLevel: { value: level },
      uCenter: { value: new THREE.Vector2() },
      uSunI: { value: 3 }, uMoonI: { value: 0 }, uAmb: { value: new THREE.Color(0.3, 0.35, 0.4) },
      uDeep: { value: new THREE.Color(...tint.deep) }, uShallow: { value: new THREE.Color(...tint.shallow) },
      uSplash: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, -100, 0)) }, uChop: { value: chop }, uCaps: { value: caps },
      uWake: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uWakeDir: { value: Array.from({ length: 6 }, () => new THREE.Vector2(0, 1)) },
      uRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform float uTime; uniform vec2 uCenter; uniform vec4 uWaves[6]; uniform vec2 uWaveQ[6]; uniform float uSwell; uniform float uLevel;
        uniform mat4 uReflMat; uniform sampler2D uBed; uniform vec4 uBedB;
        varying vec3 vW; varying vec3 vFlat; varying vec4 vRC; varying vec3 vGN; varying float vCrest;
        void main(){
          vec3 p = position + vec3(uCenter.x, uLevel, uCenter.y);
          float dist = length(p.xz - cameraPosition.xz);
          // shoaling: the swell breaks and dies in the shallows (the surf lines carry it), so it never floods the beach
          float shoal = 1.0;
          if (uBedB.w > 0.5) { vec2 bu = (p.xz - uBedB.xy) / uBedB.z; if (bu.x > 0.002 && bu.x < 0.998 && bu.y > 0.002 && bu.y < 0.998) shoal = mix(0.1, 1.0, smoothstep(0.25, 4.5, uLevel - texture2D(uBed, bu).r)); }
          float fade = (1.0 - smoothstep(250.0, 1400.0, dist)) * uSwell * shoal;
          vec3 d = vec3(0.0); vec3 n = vec3(0.0, 1.0, 0.0); float crest = 0.0;
          for (int i = 0; i < 6; i++) {
            vec4 w = uWaves[i]; vec2 q = uWaveQ[i];
            float k = 6.2831853 / w.w, om = sqrt(9.81 * k);
            float A = w.z * fade;
            float f = k * dot(w.xy, p.xz) - om * uTime + q.y;
            float c = cos(f), s = sin(f);
            d.x += q.x * A * w.x * c; d.z += q.x * A * w.y * c; d.y += A * s;
            n.x -= w.x * k * A * c; n.z -= w.y * k * A * c; n.y -= q.x * k * A * s;
            crest += q.x * k * A * s;
          }
          vFlat = p;
          p += d;
          vW = p; vGN = normalize(n); vCrest = crest;
          vRC = uReflMat * vec4(vFlat.x, uLevel, vFlat.z, 1.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uTime; uniform vec3 uSunColor; uniform vec3 uMoonDir; uniform vec3 uMoonColor;
        uniform sampler2D uRefl; uniform sampler2D uNormals; uniform sampler2D uFoam; uniform sampler2D uBed; uniform vec4 uBedB;
        uniform float uSunI; uniform float uMoonI; uniform vec3 uAmb; uniform vec3 uDeep; uniform vec3 uShallow; uniform float uLevel;
        uniform vec4 uSplash[12]; uniform float uChop; uniform float uCaps; uniform vec4 uWake[6]; uniform vec2 uWakeDir[6]; uniform float uNight;
        varying vec3 vW; varying vec3 vFlat; varying vec4 vRC; varying vec3 vGN; varying float vCrest;
        ${FOG_GLSL}
        float bedHeight(vec2 xz){
          if (uBedB.w < 0.5) return uLevel - 60.0;
          vec2 u = (xz - uBedB.xy) / uBedB.z;
          if (u.x > 0.002 && u.x < 0.998 && u.y > 0.002 && u.y < 0.998) return texture2D(uBed, u).r;
          return uLevel - 30.0;
        }
        // Q5: four scales of ripple, each on its own rotated grid (no shared axis, no visible repeat) and drifting its
        // own way; their strength varies over wind patches a few hundred metres across (rough stretches, glassy ones)
        vec3 detailN(vec2 xz, float dist){
          const mat2 r2 = mat2(0.96, -0.28, 0.28, 0.96), r3 = mat2(0.6, 0.8, -0.8, 0.6), r4 = mat2(-0.35, 0.94, -0.94, -0.35);
          vec2 u1 = xz / 9.0 + vec2(0.021, 0.034) * uTime, u2 = r2 * xz / 23.0 + vec2(-0.016, 0.012) * uTime;
          vec2 u3 = r3 * xz / 71.0 + vec2(0.006, -0.009) * uTime, u4 = r4 * xz / 187.0 + vec2(-0.003, 0.004) * uTime;
          vec2 n1 = texture2D(uNormals, u1).xy * 2.0 - 1.0, n2 = (texture2D(uNormals, u2).xy * 2.0 - 1.0) * r2;
          vec2 n3 = (texture2D(uNormals, u3).xy * 2.0 - 1.0) * r3, n4 = (texture2D(uNormals, u4).xy * 2.0 - 1.0) * r4;
          float patchK = mix(0.72, 1.16, smoothstep(0.3, 0.7, texture2D(uFoam, xz / 700.0 + vec2(0.002, -0.0015) * uTime).g));
          // wind streaks: long narrow lanes of rougher water (400 m by 25 m)
          patchK *= mix(1.0, 1.4, smoothstep(0.58, 0.78, texture2D(uFoam, mat2(0.8, 0.6, -0.6, 0.8) * xz * vec2(0.0025, 0.04) + vec2(0.0, 0.003) * uTime).g));
          float a = mix(0.7, 0.25, smoothstep(40.0, 900.0, dist)) * uChop * patchK;
          vec2 s = n1 * a + n2 * 0.6 * a + (n3 * 0.5 * mix(1.0, patchK, 0.5) + n4 * 0.2) * clamp(uChop / 1.22, 0.1, 1.0);   // E1 v2: calm = glassy
          return normalize(vec3(s.x, 1.0, -s.y));
        }
        void main(){
          #include <logdepthbuf_fragment>
          vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
          vec3 dn = detailN(vFlat.xz, dist);
          vec3 N = normalize(vec3(vGN.x + dn.x, vGN.y * dn.y, vGN.z + dn.z));
          float ring = 0.0, froth = 0.0;
          for (int i = 0; i < 12; i++) {
            vec4 s = uSplash[i]; float age = uTime - s.z;
            if (age < 0.0 || age > 9.0) continue;
            float r = length(vFlat.xz - s.xy), front = age * (2.2 + s.w * 0.6);
            float w = exp(-pow((r - front) / (0.6 + s.w * 0.35 + age * 0.3), 2.0)) * exp(-age * 0.45);
            ring += w * s.w;
            froth += exp(-pow(r / (s.w * 2.0 + age * 1.5), 2.0)) * exp(-age * 0.55) * s.w;
            N.xz += (vFlat.xz - s.xy) / max(r, 0.01) * w * 0.9 * sin((r - front) * 2.0);
          }
          N = normalize(N);
          float NdV = max(dot(N, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          F *= 1.0 - 0.4 * uNight * smoothstep(150.0, 2500.0, dist);   // E1 v2: a night sea a shade darker than the sky at the horizon
          // Q5: the reflection breaks up. The ripples' tilt (in view space) shifts it on screen, mostly vertically, and
          // more with distance (at grazing angles a small tilt swings the reflected ray a long way): far reflections
          // smear into vertical streaks, three taps along the smear soften them; calm glassy patches stay clearer
          vec3 Nv = (viewMatrix * vec4(N.x, 0.0, N.z, 0.0)).xyz;
          float farR = smoothstep(30.0, 2500.0, dist);
          vec2 ruv = vRC.xy / vRC.w + vec2(Nv.x * mix(0.06, 0.025, farR), -Nv.z * mix(0.07, 0.18, farR));
          float sm = 0.005 + 0.017 * farR;
          vec3 refl = (texture2D(uRefl, clamp(ruv, 0.001, 0.999)).rgb * 2.0 + texture2D(uRefl, clamp(ruv + vec2(0.0, sm), 0.001, 0.999)).rgb
            + texture2D(uRefl, clamp(ruv - vec2(0.0, sm), 0.001, 0.999)).rgb) * 0.25;
          float depth = max(uLevel - bedHeight(vFlat.xz), 0.0);
          float shallow = exp(-depth * 0.35);
          vec3 light = uAmb + uSunColor * uSunI * max(uSunDir.y, 0.0) * 0.55 + uMoonColor * uMoonI * 0.4;
          vec3 body = mix(uDeep, uShallow, shallow) * light;
          // Q5: the sea is not one colour: slow patches of greener and deeper blue water a kilometre across
          float bodyV = texture2D(uFoam, vFlat.xz / 1300.0 + 0.37).g;
          body *= mix(vec3(0.88, 0.9, 0.93), vec3(1.0, 1.08, 1.05), smoothstep(0.2, 0.8, bodyV));
          float sss = pow(max(dot(V, -uSunDir), 0.0), 3.0) * max(vCrest * 1.6 + (vW.y - uLevel) * 0.25, 0.0);
          body += uShallow * uSunColor * uSunI * sss * 0.35;
          vec3 col = mix(body, refl, F);
          float shin = mix(1400.0, 90.0, smoothstep(20.0, 4000.0, dist));
          float norm = (shin + 8.0) / 25.0;
          vec3 Hs = normalize(uSunDir + V);
          col += uSunColor * uSunI * pow(max(dot(N, Hs), 0.0), shin) * norm * F * 3.0 * step(0.0, uSunDir.y);
          vec3 Hm = normalize(uMoonDir + V);
          col += uMoonColor * uMoonI * pow(max(dot(N, Hm), 0.0), shin * 2.4) * norm * F * 0.55;
          float fo = texture2D(uFoam, vFlat.xz / 11.0 + vec2(0.01, 0.02) * uTime).r;
          float fo2 = texture2D(uFoam, vFlat.xz / 4.3 - vec2(0.03, 0.01) * uTime).r;
          // the shore: broken lines of breaking surf travelling in over the shallows (not one solid white band), clear
          // turquoise shallows between them and a crisp waterline on the sand. (No foam fill at depth ~0: the bed
          // texture is 2.7 m per texel, so "depth ~0" smears over metres of the waterline into a cream sheet.)
          float fb = fract(depth * 0.8 + uTime * 0.105 + fo * 0.22);
          float band = smoothstep(0.8, 0.93, fb) * (1.0 - smoothstep(0.93, 0.99, fb));
          band *= smoothstep(0.2, 0.55, depth) * (1.0 - smoothstep(1.4, 2.8, depth)) * smoothstep(0.38, 0.78, fo * 0.72 + fo2 * 0.5 + 0.15 * band);
          float surf = band * 0.9;
          float lap = (1.0 - smoothstep(0.0, 2.5, depth)) * smoothstep(0.62, 0.95, fo2) * (0.5 + 0.5 * sin(uTime * 1.3 + depth * 3.0)) * 0.6;
          float crestFoam = smoothstep(0.55, 0.95, vCrest * 2.2 + fo * 0.5) * uCaps;   // E1 v2: whitecaps by the wind
          float wake = 0.0;
          for (int i = 0; i < 6; i++) {
            vec4 k = uWake[i]; if (k.z <= 0.0) continue;
            vec2 dir = uWakeDir[i]; vec2 rel = vFlat.xz - k.xy;
            float along = -dot(rel, dir); float across = dot(rel, vec2(-dir.y, dir.x));
            if (along < -6.0 || along > k.w) continue;
            float spread = 3.0 + max(along, 0.0) * 0.36;
            float arms = exp(-pow((abs(across) - spread) / (1.2 + along * 0.05), 2.0)) * smoothstep(-6.0, 4.0, along);
            float band = exp(-pow(across / (2.2 + along * 0.08), 2.0)) * smoothstep(-5.0, 2.0, along);
            wake += (arms * 0.9 + band * 0.7) * (1.0 - along / k.w) * k.z;
          }
          float foamAmt = clamp(surf + lap * 0.5 + max(crestFoam, 0.0) + (ring * 0.6 + froth) * smoothstep(0.3, 0.6, fo + 0.2) + wake * smoothstep(0.25, 0.65, fo2 + 0.1), 0.0, 1.0);
          vec3 foamCol = (uAmb * 1.4 + uSunColor * uSunI * max(uSunDir.y, 0.05) * 0.9 + uMoonColor * uMoonI * 0.5) * 0.9;
          col = mix(col, foamCol, foamAmt * 0.92);
          vec3 rd = -V;
          col = mix(col, wfogColor(rd), wfogAmount(cameraPosition, rd, dist));
          gl_FragColor = vec4(col, 1.0);
        }`,
      fog: false,
    });
    mesh = new THREE.Mesh(radialGrid(), mat);
    mesh.frustumCulled = false; mesh.name = 'nature.ocean'; mesh.renderOrder = -10; mesh.userData.noQA = true; mesh.userData.ground = true;
    Object.assign(uniforms, makeMirror(mesh, () => level, 0.55, hide));
    mat.uniforms.uRefl = uniforms.uRefl; mat.uniforms.uReflMat = uniforms.uReflMat;
    root.add(mesh);

    const shoalAt = (x, z) => (hasBed && Math.abs(x) < 1395 && Math.abs(z) < 1395 ? 0.1 + 0.9 * sstep((level - o.ground.height(x, z) - 0.25) / 4.25) : 1);
    const waveAt = (x, z, t, out = {}) => {
      let dx = 0, dy = 0, dz = 0, nx = 0, ny = 1, nz = 0;
      const sh = shoalAt(x, z);
      for (let i = 0; i < WAVES.length; i++) {
        const [ux, uz, A0, , Q, ph] = WAVES[i];
        const A = A0 * ampK[i] * uniforms.uSwell.value * sh, { k, w } = WP[i];
        const f = k * (ux * x + uz * z) - w * t + ph, c = Math.cos(f), s = Math.sin(f);
        dx += Q * A * ux * c; dz += Q * A * uz * c; dy += A * s;
        nx -= ux * k * A * c; nz -= uz * k * A * c; ny -= Q * k * A * s;
      }
      out.y = level + dy; out.dx = dx; out.dz = dz;
      const l = Math.hypot(nx, ny, nz); out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
      return out;
    };
    api = {
      kind: 'ocean', level, mesh, uniforms, waveAt,
      heightAt: (x, z, t) => waveAt(x, z, t).y,
      setSwell: (s) => { uniforms.uSwell.value = s; },
    };
  } else {
    // ── river / lake ──
    const bed = bedTexture(o.ground, 700, 1024);
    const river = o.T?.rivers?.[0];
    let flow = [0, 0];
    if (river) { const P = river.path.pts, a = P[0], b = P[P.length - 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; flow = [(b[0] - a[0]) / l * 0.45, (b[1] - a[1]) / l * 0.45]; }
    const lakeTint = o.biome === 'mountains' ? [[0.01, 0.045, 0.05], [0.05, 0.12, 0.1]] : [[0.018, 0.03, 0.026], [0.09, 0.085, 0.055]];
    uniforms = {
      uTime: { value: 0 }, uSunDir: U.uSunDir, uSunColor: U.uSunColor,
      uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff, uFogBase: U.uFogBase, uMirror: U.uMirror,
      uNormal: { value: TX.waterNormals() }, uBed: { value: bed }, uHX: { value: new THREE.Vector4(-700, -700, 1400, 1400) },
      uAmb: { value: new THREE.Color(0.3, 0.3, 0.35) }, uSunI: { value: 3 }, uFlow: { value: new THREE.Vector2(...flow) }, uLevel: { value: level },
      uDeep: { value: new THREE.Color(...lakeTint[0]) }, uShallow: { value: new THREE.Color(...lakeTint[1]) },
      uSplash: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, -100, 0)) },
      uRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform mat4 uReflMat; uniform float uLevel;
        varying vec3 vW; varying vec4 vRC;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0); w.y = uLevel;
          vW = w.xyz; vRC = uReflMat * w;
          gl_Position = projectionMatrix * viewMatrix * w;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uRefl; uniform sampler2D uNormal; uniform sampler2D uBed; uniform vec4 uHX;
        uniform float uTime; uniform vec3 uSunColor; uniform vec3 uAmb; uniform float uSunI; uniform vec2 uFlow; uniform float uLevel;
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec4 uSplash[12];
        varying vec3 vW; varying vec4 vRC;
        ${FOG_GLSL}
        vec3 nm(vec2 uv){ vec3 t = texture2D(uNormal, uv).xyz * 2.0 - 1.0; return vec3(t.x, t.z, -t.y); }
        void main(){
          #include <logdepthbuf_fragment>
          vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 V = toCam / dist;
          vec2 huv = (vW.xz - uHX.xy) / uHX.zw;
          float inTex = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
          float gh = texture2D(uBed, clamp(huv, 0.001, 0.999)).r;
          float depth = mix(3.0, max(uLevel - gh, 0.0), inTex);
          vec2 p = vW.xz;
          vec3 n1 = nm(p / 11.0 + uFlow * uTime / 11.0);
          vec3 n2 = nm(mat2(0.8, -0.6, 0.6, 0.8) * p / 3.1 + uFlow * uTime / 2.6 + 0.37);
          vec3 n3 = nm(mat2(0.6, 0.8, -0.8, 0.6) * p / 1.1 + uFlow * uTime / 0.9 + 0.71 + vec2(0.013, 0.021) * uTime);
          float far = smoothstep(30.0, 900.0, dist);
          vec2 slope = (n1.xz * 0.55 + n2.xz * 0.35 + n3.xz * 0.2 * (1.0 - smoothstep(4.0, 40.0, dist))) * mix(0.14, 0.03, far);
          float foam = 0.0;
          for (int i = 0; i < 12; i++) {
            vec4 s = uSplash[i]; float age = uTime - s.z;
            if (age < 0.0 || age > 8.0) continue;
            float r = length(p - s.xy), front = age * (1.6 + s.w * 0.5);
            float w = exp(-pow((r - front) / (0.4 + age * 0.25), 2.0)) * exp(-age * 0.5);
            slope += (p - s.xy) / max(r, 0.01) * w * 0.2 * sin((r - front) * 3.0);
            foam += exp(-pow(r / (s.w * 1.5 + age), 2.0)) * exp(-age * 0.8) * s.w * 0.6;
          }
          // a thin collar of foam and a darker damp line where the water meets the bank
          float edge = 1.0 - smoothstep(0.0, 0.35, depth);
          float fz = texture2D(uNormal, p * 0.35 + uFlow * uTime * 0.3).x;
          foam += edge * smoothstep(0.45, 0.8, fz) * 0.35;
          foam = clamp(foam, 0.0, 1.0);
          vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
          vec2 ruv = vRC.xy / vRC.w + N.xz * mix(0.05, 0.012, far);
          vec3 refl = texture2D(uRefl, clamp(ruv, 0.001, 0.999)).rgb;
          float cosT = max(dot(N, V), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          float sunI = max(uSunDir.y, 0.0) * 0.5 + 0.08;
          vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 1.6, depth)) * (uAmb * 1.6 + uSunColor * sunI * uSunI * 0.4);
          vec3 col = mix(body, refl, clamp(fres * 1.05, 0.0, 1.0));
          vec3 Hh = normalize(uSunDir + V); float nh = max(dot(N, Hh), 0.0);
          col += uSunColor * uSunI * (pow(nh, 900.0) * 20.0 + pow(nh, 90.0) * 0.2) * (1.0 - foam) * step(0.0, uSunDir.y);
          vec3 foamCol = uAmb * 2.2 + uSunColor * uSunI * (max(uSunDir.y, 0.0) * 0.4 + 0.08);
          col = mix(col, foamCol * 0.9, foam * 0.8);
          col *= 1.0 - 0.3 * inTex * smoothstep(0.2, 0.0, depth);
          col = mix(col, wfogColor(-V), wfogAmount(cameraPosition, -V, dist));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const geo = new THREE.PlaneGeometry(52000, 52000, 1, 1).rotateX(-Math.PI / 2);
    mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'nature.water'; mesh.frustumCulled = false; mesh.renderOrder = -10; mesh.userData.noQA = true; mesh.userData.ground = true;
    Object.assign(uniforms, makeMirror(mesh, () => level, 0.5, hide));
    mat.uniforms.uRefl = uniforms.uRefl; mat.uniforms.uReflMat = uniforms.uReflMat;
    root.add(mesh);
    api = { kind: o.kind, level, mesh, uniforms, waveAt: (x, z, t, out = {}) => Object.assign(out, { y: level, dx: 0, dz: 0, nx: 0, ny: 1, nz: 0 }), heightAt: () => level };
  }

  const amb = new THREE.Color();
  Object.assign(api, {
    addWake(fn) { wakes.push(fn); },
    splash(x, z, t0, size = 1.5) { splashes.push([x, z, t0, size]); },
    update(t, clock, camera) {
      uniforms.uTime.value = t;
      if (uniforms.uCenter && camera) uniforms.uCenter.value.set(camera.position.x, camera.position.z);
      if (scene) {
        sceneLights(scene, L);
        if (L.key) { const lk = L.key.color, ls = U.uSunColor.value; const a = 0.3 * lk.r + 0.55 * lk.g + 0.15 * lk.b, b = 0.3 * ls.r + 0.55 * ls.g + 0.15 * ls.b; uniforms.uSunI.value = L.key.intensity * a / Math.max(b, 1e-4); } else uniforms.uSunI.value = 3;
        ambientFrom(L, amb); uniforms.uAmb.value.copy(amb);
      }
      if (clock && clock.env) {                                     // if the core hands its env over, prefer it
        const e = clock.env;
        if (e.sunI != null) uniforms.uSunI.value = e.sunI;
        if (e.amb && e.ambI != null) uniforms.uAmb.value.setRGB(...e.amb).multiplyScalar(e.ambI * 1.6);
        if (uniforms.uMoonI && e.moonI != null) uniforms.uMoonI.value = e.moonI;
      } else if (uniforms.uMoonI) uniforms.uMoonI.value = (U.uNight?.value ?? 0) * 0.7;
      // splashes: the most recent 12 that are alive
      const live = splashes.filter((s) => t - s[2] > -0.1 && t - s[2] < 9).slice(-12);
      const S = uniforms.uSplash.value;
      for (let i = 0; i < 12; i++) { const s = live[i]; if (s) S[i].set(s[0], s[1], s[2], s[3]); else S[i].set(0, 0, -100, 0); }
      if (uniforms.uWake) {
        const Wk = uniforms.uWake.value, Wd = uniforms.uWakeDir.value;
        for (let i = 0; i < 6; i++) {
          const w = wakes[i] ? wakes[i](t) : null;
          if (w) { Wk[i].set(w.x, w.z, w.strength ?? 1, w.length ?? 80); Wd[i].set(w.dx, w.dz); } else Wk[i].set(0, 0, 0, 0);
        }
      }
    },
  });
  return api;
}
