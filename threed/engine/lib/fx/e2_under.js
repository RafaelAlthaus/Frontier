// e2_under.js — (E2, Frontier 3D v2 round 5) under the sea. When the camera goes below the water level the scene becomes
// an underwater one, smoothly across the waterline (0.6 m): the surface seen from below (a bright rippling ceiling,
// Snell's window overhead, total internal reflection beyond it), murk that swallows everything with distance, sunlight
// shafts by day, marine snow, the sky gone; at night near-black, lit only by what shines (portholes, flares, lamps).
// `abyss` mode (the wreck at 3,800 m): no surface at all, black water, a submersible's lamp cone from the camera.
//   fx.underwater  { "kind": "fx.underwater", "murk": 1, "shafts": 1, "snow": 1, "tint": "atlantic|tropical|abyss",
//                    "abyss": false, "lamp": 0..3 }
// Every sea kind of E2 (liners, icebergs, lifeboats, people, wreckage, wrecks) switches it on by itself; the kind is for
// scenes without them. Pure functions of t and the camera; the scene's fog / sky / lights are restored above the water.
import * as THREE from 'three';
import { U } from '../shared/env.js';
import { clamp, lerp, smooth } from '../shared/util.js';

const TAU = Math.PI * 2;
export const CATALOG = {
  'fx.underwater': {
    desc: 'under the sea (automatic in any scene with an E2 sea kind; add this for others): below the waterline the surface is a bright rippling ceiling with Snell\'s window overhead, murk swallows everything with distance, sunlight shafts by day, marine snow; at night near-black, lit only by portholes, flares and lamps. The camera may cross the surface (a 0.6 m waterline transition): use camera.move dive_under or camera.underwater true. abyss true: the deep sea (no surface, black water, a submersible lamp cone from the camera).',
    actions: ['idle'],
    params: { murk: '0..3 (1: ~40 m visibility by day)', shafts: '0..2 sun shafts (day)', snow: '0..2 marine snow', tint: 'atlantic (default) | tropical | abyss', abyss: 'true: the deep sea (wreck scenes)', lamp: '0..3 submersible lamp from the camera (default 0; abyss 1.4)' },
    footprint: [1, 1], height: 0, tags: ['sea', 'underwater', 'fx', 'ocean', 'deep'], section: 'objects',
  },
};
export async function build(kind, item, ctx) {
  const P = { ...(item.params || {}), ...item };
  const u = ensureUnderwater(ctx, { murk: P.murk, shafts: P.shafts, snow: P.snow, tint: P.tint, abyss: P.abyss === true || P.abyss === 'true' || P.tint === 'abyss', lamp: P.lamp });
  const root = new THREE.Group(); root.name = 'fx.underwater'; root.userData.noQA = true;
  return { root, radius: 1, height: 0, snapped: true, contact: false, update: (t, clock, cam) => u.update(t, cam), anchors: {} };
}

// one controller per scene stage; every E2 sea kind calls ensureUnderwater(ctx).update(t, camera) from its update
export function ensureUnderwater(ctx, o = {}) {
  const stage = ctx.scene;
  let C = stage.userData.e2under;
  if (C) { if (o.abyss) C.opts.abyss = true; for (const k of ['murk', 'shafts', 'snow', 'tint', 'lamp']) if (o[k] != null) C.opts[k] = o[k]; return C; }
  C = makeUnder(ctx, o); stage.userData.e2under = C; return C;
}

function makeUnder(ctx, opts) {
  const C_STATE = {};
  const root = new THREE.Group(); root.name = 'e2-underwater'; root.userData.noQA = true; ctx.scene.add(root);
  const level = () => ctx.water?.level ?? 0;
  // ── the surface from below ──
  const surfU = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uDay: { value: 1 }, uTime: { value: 0 }, uDeep: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uK: { value: 0 }, uMurk: { value: 0.02 } };
  const surf = new THREE.Mesh(new THREE.CircleGeometry(1, 96, 0, TAU).rotateX(Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: surfU, side: THREE.DoubleSide, depthWrite: false, transparent: true, fog: false,
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSun; uniform float uDay; uniform float uTime; uniform vec3 uDeep; uniform vec3 uSky; uniform float uK; uniform float uMurk; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      void main(){
        #include <logdepthbuf_fragment>
        if (uK < 0.001) discard;
        vec3 V = vW - cameraPosition; float d = length(V); V /= d;
        // ripples: a moving normal field; Snell's window: rays within ~48.6 deg of straight up see the sky, the rest reflect the deep
        vec2 q = vW.xz * 0.35; float r1 = n(q + vec2(uTime * 0.21, uTime * 0.13)), r2 = n(q * 2.3 - vec2(uTime * 0.17, -uTime * 0.23));
        vec2 slope = vec2(r1 - 0.5, r2 - 0.5) * 0.55;
        vec3 N = normalize(vec3(slope.x, -1.0, slope.y));
        float cosI = clamp(dot(-N, V), 0.0, 1.0);
        float window = smoothstep(0.62, 0.72, cosI);
        vec3 sky = uSky * (0.8 + 0.6 * r1);
        float sunGlint = pow(max(dot(normalize(V + slope.xyy * vec3(1.0, 0.0, 1.0)), normalize(uSun)), 0.0), 60.0) * uDay;
        vec3 col = mix(uDeep * 1.4, sky, window) + vec3(1.0, 0.95, 0.85) * sunGlint * 3.0;
        col *= 0.75 + 0.5 * smoothstep(0.35, 0.75, r1 * r2 * 2.0);                    // bright ripple bands
        float fog = 1.0 - exp(-uMurk * d * 0.7);
        col = mix(col, uDeep, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, uK);                                              // fades in across the waterline
      }`,
  }));
  surf.frustumCulled = false; surf.renderOrder = -9; surf.name = 'e2-surface-below'; root.add(surf);
  // ── the abyss: a black shell (the sky is gone) ──
  const domeM = new THREE.ShaderMaterial({ uniforms: { uC: { value: new THREE.Color(0, 0, 0) }, uA: { value: 1 } }, side: THREE.BackSide, depthWrite: false, transparent: true, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uC; uniform float uA; varying vec3 vD; void main(){ float y = normalize(vD).y; gl_FragColor = vec4(uC * (0.35 + 0.65 * smoothstep(-0.9, 0.3, y)), uA); }' });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), domeM);
  dome.renderOrder = -20; dome.frustumCulled = false; dome.name = 'e2-deep'; root.add(dome);
  // ── sun shafts: additive vertical ribbons under the surface near the camera ──
  const NSH = 28, shG = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);
  const shM = new THREE.MeshBasicMaterial({ color: 0x9fd8d0, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const shTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); const g2 = g.createLinearGradient(0, 0, 64, 0); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.5, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = g2; g.fillRect(0, 0, 64, 256); const t = new THREE.CanvasTexture(c); t.userData.keep = true; return t; })();
  shM.map = shTex;
  const shafts = new THREE.InstancedMesh(shG, shM, NSH); shafts.frustumCulled = false; shafts.renderOrder = 15; shafts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shafts.name = 'e2-shafts'; root.add(shafts);
  const SH = Array.from({ length: NSH }, (_, i) => ({ a: (i * 2.39996) % TAU, r: 3 + (i * 7.31) % 26, w: 0.8 + ((i * 3.7) % 1) * 2.2, ph: i * 1.7, L: 18 + (i * 5.3) % 22 }));
  // ── marine snow: points wrapped around the camera ──
  const NS = 1400, sp = new Float32Array(NS * 3); for (let i = 0; i < NS; i++) { sp[i * 3] = h1(i * 3.1) * 40 - 20; sp[i * 3 + 1] = h1(i * 5.7) * 40 - 20; sp[i * 3 + 2] = h1(i * 9.3) * 40 - 20; }
  const snowG = new THREE.BufferGeometry(); snowG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const snowM = new THREE.PointsMaterial({ color: 0xcfd8d4, size: 0.045, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, fog: true });
  const snow = new THREE.Points(snowG, snowM); snow.frustumCulled = false; snow.name = 'e2-snow'; root.add(snow);
  // ── the submersible lamp ──
  const lamp = new THREE.SpotLight(0xfff2dc, 0, 80, 0.36, 0.55, 1.4);                  // a tight submersible cone along the view lamp.userData.fx = true; lamp.castShadow = false;
  const lampT = new THREE.Object3D(); root.add(lamp, lampT); lamp.target = lampT;
  // the scene's fog / lights to restore above the water
  let orig = null, lights = null;
  const grab = () => {
    const W3 = ctx.world3 || null;
    orig = { fc: U.uFogColor.value.clone(), fs: U.uFogSunColor.value.clone(), fd: U.uFogDensity.value, ff: U.uFogFalloff.value, fb: U.uFogBase.value, blue: U.uFogBlue?.value ?? 0, envI: W3 && W3.environmentIntensity != null ? W3.environmentIntensity : null };
    lights = []; (ctx.world3 || ctx.scene).traverse((o) => { if ((o.isDirectionalLight || o.isHemisphereLight || o.isAmbientLight) && !o.userData.fx) lights.push([o, o.intensity]); });
    const sky = []; (ctx.world3 || ctx.scene).traverse((o) => { if (o.isMesh && /sky|star|cloud|moon/i.test(o.name || '') && o.visible) sky.push(o); }); orig.sky = sky;
  };
  let lastKey = '', prevK = 0;
  const TINT = { atlantic: [0.012, 0.055, 0.07], tropical: [0.01, 0.09, 0.1], abyss: [0.0, 0.004, 0.006] };
  function update(t, camera) {
    if (!camera) return;
    const key = t.toFixed(4) + camera.matrixWorld.elements[12].toFixed(3) + camera.matrixWorld.elements[13].toFixed(3);
    if (key === lastKey) return; lastKey = key;
    const cp = camera.position, L = level(), abyss = !!opts.abyss;
    const k = abyss ? 1 : smooth((L + 0.6 - cp.y) / 1.2);                 // 0 above the water, 1 below (a 1.2 m band: ~8 frames at 4 m/s)
    const depth = Math.max(0, L - cp.y);
    C_STATE.k = k; C_STATE.level = L;
    if (!orig) grab();                                                     // the scene's own values (look.apply ran before the first frame)
    root.visible = k > 0;
    if (k <= 0 && prevK <= 0) return;                                      // above the water: leave the scene alone
    prevK = k;
    const night = clamp(U.uNight?.value ?? 0), day = abyss ? 0 : clamp(U.uSunDir.value.y * 3) * (1 - night);
    const tint = TINT[abyss ? 'abyss' : opts.tint] || TINT.atlantic;
    const light = abyss ? 0 : Math.exp(-depth / 28) * lerp(0.05, 1, day);
    const deep = new THREE.Color(tint[0], tint[1], tint[2]).multiplyScalar(abyss ? 1 : lerp(0.06, 1, day) * (0.35 + 0.65 * Math.exp(-depth / 40)));
    const murk = (abyss ? 0.045 : lerp(0.03, 0.022, day)) * clamp(+opts.murk || 1, 0.2, 3);
    Object.assign(C_STATE, { k, light, day, level: L });
    // fog, sky and lights: blended across the waterline
    U.uFogColor.value.copy(orig.fc).lerp(deep, k);
    U.uFogSunColor.value.copy(orig.fs).lerp(deep.clone().multiplyScalar(0.6 * day), k);   // no orange sun glow in the water (the dusk glow read as an orange wall)
    U.uFogDensity.value = lerp(orig.fd, murk, k); U.uFogFalloff.value = lerp(orig.ff, 0, k); U.uFogBase.value = lerp(orig.fb, L, k);
    if (U.uFogBlue) U.uFogBlue.value = lerp(orig.blue, 0, k);
    for (const [o, i0] of lights) o.intensity = i0 * lerp(1, abyss ? 0 : 0.04 + 0.96 * light, k);   // sunlight dies with depth (and at dusk / night)
    if (orig.envI != null && ctx.world3) ctx.world3.environmentIntensity = orig.envI * lerp(1, abyss ? 0 : 0.04 + 0.96 * light, k);   // and so does the sky's image-based light
    for (const o of orig.sky) o.visible = k < 0.98;
    // the surface from below, the abyss shell
    surf.visible = !abyss && k > 0; surf.position.set(cp.x, L - 0.02, cp.z); surf.scale.setScalar(3000);
    surfU.uTime.value = t; surfU.uSun.value.copy(U.uSunDir.value); surfU.uDay.value = day; surfU.uK.value = k; surfU.uMurk.value = murk * 0.35;
    surfU.uDeep.value.copy(deep); surfU.uSky.value.setRGB(0.55, 0.78, 0.82).multiplyScalar(lerp(0.015, 1.1, day) * Math.exp(-depth / 60));
    dome.visible = abyss || k > 0.002; dome.position.copy(cp); dome.scale.setScalar(abyss ? 4000 : 2500); domeM.uniforms.uC.value.copy(abyss ? new THREE.Color(0, 0, 0) : deep); domeM.uniforms.uA.value = abyss ? 1 : k;
    if (!orig.ocean) { orig.ocean = []; ctx.scene.traverse((o) => { if (o.isMesh && /nature\.(ocean|water)/.test(o.name)) orig.ocean.push(o); }); }
    for (const o of orig.ocean) o.visible = k < 0.98;                     // from below, the surface is the ceiling above, not the sky's mirror
    // shafts (day, shallow)
    const shK = k * day * clamp(+opts.shafts || 1, 0, 2) * Math.exp(-depth / 35);
    shM.opacity = 0.06 * shK; shafts.visible = shK > 0.01;
    if (shafts.visible) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
      const yaw = Math.atan2(camera.position.x - 0, camera.position.z - 0);
      SH.forEach((o, i) => {
        const a = o.a + t * 0.01, x = cp.x + Math.cos(a) * o.r + Math.sin(t * 0.3 + o.ph) * 0.6, z = cp.z + Math.sin(a) * o.r;
        const face = Math.atan2(cp.x - x, cp.z - z);
        q.setFromEuler(e.set(0.18 * Math.sin(o.ph), face, 0.12)); s.set(o.w * (0.7 + 0.3 * Math.sin(t * 0.8 + o.ph)), o.L, 1); p.set(x, L - 0.1, z);
        m4.compose(p, q, s); shafts.setMatrixAt(i, m4);
      });
      void yaw; shafts.instanceMatrix.needsUpdate = true;
    }
    // marine snow drifting down, wrapped in a 40 m box around the camera
    const snK = k * clamp(+opts.snow || 1, 0, 2);
    snowM.opacity = 0.55 * Math.min(1, snK); snow.visible = snK > 0.01;
    if (snow.visible) {
      const P = snowG.attributes.position.array, W = 40;
      for (let i = 0; i < NS; i++) {
        const x = sp[i * 3] + Math.sin(t * 0.3 + i) * 0.2, y = sp[i * 3 + 1] - t * 0.12, z = sp[i * 3 + 2];
        P[i * 3] = cp.x + (((x - cp.x) % W) + W * 1.5) % W - W / 2; P[i * 3 + 1] = cp.y + (((y - cp.y) % W) + W * 1.5) % W - W / 2; P[i * 3 + 2] = cp.z + (((z - cp.z) % W) + W * 1.5) % W - W / 2;
        if (!abyss && P[i * 3 + 1] > L) P[i * 3 + 1] = L - 0.5;
      }
      snowG.attributes.position.needsUpdate = true; snowG.computeBoundingSphere();
    }
    // the lamp: from just under the camera, along its view
    const lampK = k * (opts.lamp != null ? +opts.lamp : abyss ? 1.4 : 0);
    lamp.intensity = lampK * 420; lamp.visible = lampK > 0.001;
    if (lamp.visible) { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); lamp.position.copy(cp).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), -0.35); lampT.position.copy(cp).addScaledVector(f, 30); lampT.updateMatrixWorld(); }
  }
  return { update, root, opts, state: C_STATE };
}
function h1(x) { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
