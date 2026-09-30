// f_space.js — (D2b) impacts and cosmic catastrophes.
//   fx.impact  mode "local": a ~10 km asteroid (shown at `scale`) streaking in at an angle inside a plasma sheath with a
//              glowing trail, the impact flash, a white-hot fireball, a shockwave ring racing out over the sea, the
//              ejecta curtain (an inverted cone of debris) rising and spreading.
//              mode "global": the Earth from space (space.earth); from Chicxulub a ring of re-entering ejecta spreads
//              round the globe, the sky glowing red behind it, streaks of debris falling back in.
//   fx.grb     mode "space": a collapsing star far away, its narrow jet crossing space, the Earth's day side flashing,
//              the ozone layer (a thin glowing shell) stripped away from the point facing the beam.
//              mode "sky": from the ground, the whole sky lights up in an eerie violet-white flash that slowly fades.
import * as THREE from 'three';
import { build as buildSpace } from '../nature/space.js';
import { U, FOG_GLSL } from '../shared/env.js';
import { DEG, clamp, lerp, sstep, ease, hf, vn, fbm1, makePuffs, makeSparks, syncEnv, stdMat } from './f_common.js';
import { waterMat } from './w_tsunami.js';

export const CATALOG = {
  'fx.impact': {
    desc: 'Chicxulub asteroid impact. mode local: the asteroid entering inside a plasma trail, impact flash, fireball, shockwave ring, ejecta curtain (over sea); mode global: the Earth from space with ejecta re-entering around the globe and the sky glowing red',
    actions: ['impact'],
    params: { mode: 'local', impact: 5, scale: 0.06, from: 200, angle: 45, radius: 600, lon: -60, lat: 0, spread: 1 },
    doc: {
      mode: 'local | global', impact: 's: the moment of impact', scale: 'local: world scale (0.06 = the 10 km rock is 600 m, the fireball a few km)',
      from: 'local: compass direction the asteroid comes from', angle: 'local: entry angle above the horizon (deg)',
      radius: 'global: Earth radius in scene metres (as space.earth)', lon: 'global: longitude facing +Z (or `face`) at t = 0', lat: 'global: latitude facing +Z (or `face`) at t = 0', face: 'global: [x, y, z] world point the lon/lat faces (e.g. the camera key pos)', tilt: 'global: north-pole lean to the viewer\'s right (deg, 23.4)', spread: 'global: speed of the re-entry ring',
    },
    footprint: [2000, 2000], height: 600, snap: false, fly: true, tags: ['fx', 'asteroid', 'impact', 'chicxulub', 'space', 'disaster'],
  },
  'fx.grb': {
    desc: 'gamma-ray burst. mode space: a distant collapsing star, a narrow beam crossing space, the Earth flashing and its ozone layer (thin glowing shell) stripped; mode sky: from the ground, the whole sky lights up in an eerie flash',
    actions: ['burst'],
    params: { mode: 'space', burst: 2, radius: 600, lon: 10, az: 230, el: 35, fade: 9 },
    doc: { mode: 'space | sky', burst: 's: the moment the beam arrives', radius: 'space: Earth radius (scene m)', lon: 'space: longitude facing +Z (or `face`) at t = 0', lat: 'space: latitude facing +Z (or `face`) at t = 0', face: 'space: [x, y, z] world point the lon/lat faces (e.g. the camera key pos)', tilt: 'space: north-pole lean (deg, 23.4)', az: 'direction of the burst (deg)', el: 'elevation of the burst (deg)', fade: 's: flash decay', second_sun: 'sky: true = a big blinding disc with a glare halo and rays, the sky white-blue around it, strong hard shadows (g08)', shadows: 'sky: false = no shadows from the burst' },
    footprint: [1200, 1200], height: 1200, snap: false, fly: true, tags: ['fx', 'gamma', 'grb', 'space', 'ozone', 'disaster'],
  },
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);
const dirAzEl = (az, el) => new THREE.Vector3(Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), -Math.cos(az * DEG) * Math.cos(el * DEG));
// lat/lon -> local direction on three's SphereGeometry with an equirectangular map starting at lon -180
// (Q8) matches space.js eq(): lon = atan(-x, -z), lat = asin(y)
const latLonDir = (lat, lon) => new THREE.Vector3(-Math.sin(lon * DEG) * Math.cos(lat * DEG), Math.sin(lat * DEG), -Math.cos(lon * DEG) * Math.cos(lat * DEG));

// an additive shell over a sphere: glows where the angle from `site` is within a moving band (re-entry / stripping)
function bandShell(R, o) {
  const uni = { uSite: { value: o.site.clone() }, uAng: { value: 0 }, uWidth: { value: o.width ?? 0.12 }, uCol: { value: new THREE.Color(...o.col) }, uEdge: { value: new THREE.Color(...(o.edge || o.col)) }, uI: { value: 0 }, uFill: { value: o.fill ?? 0.4 }, uMode: { value: o.mode ?? 0 }, uTime: { value: 0 }, uDisc: { value: o.disc ?? 0.35 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: o.side ?? THREE.FrontSide,
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vW; varying vec3 vL;
void main(){ vL = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
uniform vec3 uSite; uniform float uAng; uniform float uWidth; uniform vec3 uCol; uniform vec3 uEdge; uniform float uI; uniform float uFill; uniform float uMode; uniform float uTime; uniform float uDisc;
varying vec3 vN; varying vec3 vW; varying vec3 vL;
float h(vec3 p){ p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y), mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  #include <logdepthbuf_fragment>
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
  float a = acos(clamp(dot(normalize(vL), normalize(uSite)), -1.0, 1.0));
  float nz = n3(vL * 9.0 + uTime * 0.05) * 0.6 + n3(vL * 23.0) * 0.4;
  float d = uAng - a + (nz - 0.5) * uWidth * 0.8;
  float edge = exp(-pow(d / uWidth, 2.0) * 2.0);
  float inside = smoothstep(0.0, uWidth, d);
  vec3 c;
  if (uMode < 0.5) {            // re-entry: glowing band + red sky filling in behind it
    c = uEdge * edge * (0.7 + 0.6 * nz) * 3.0 + uCol * inside * uFill * (0.6 + 0.5 * nz);
    c *= (uDisc + rim * 1.6);
  } else {                      // ozone: the intact shell glows faintly; stripped inside, burning at the edge
    float limb = pow(rim, 3.0);                                   // (Q8) airglow: a thin line on the limb, no glass veil
    c = uCol * (1.0 - inside) * limb * 0.8 + uEdge * edge * (0.06 + limb * 1.5) * 1.4 * (0.6 + 0.6 * nz) + vec3(0.5, 0.2, 0.8) * inside * limb * 0.35;
  }
  gl_FragColor = vec4(c * uI, 1.0);
}`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), mat);
  m.userData.noQA = true; m.renderOrder = o.order ?? 20;
  return { mesh: m, uni };
}

// a camera-facing additive glow sprite
function glowSprite(size, col, order = 22) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(...col) }, uI: { value: 0 }, uS: { value: size } },
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vQ; uniform float uS; void main(){ vQ = position.xy * 2.0; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * uS; gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
varying vec2 vQ; uniform vec3 uCol; uniform float uI; void main(){
  #include <logdepthbuf_fragment>
  float r = length(vQ); float g = exp(-r * r * 9.0) * 3.0 + exp(-r * 3.5) * 0.6 + exp(-r * 1.4) * 0.12; gl_FragColor = vec4(uCol * g * uI * (1.0 - smoothstep(0.85, 1.0, r)), 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.frustumCulled = false; m.userData.noQA = true; m.renderOrder = order;
  return m;
}

// ── impact: local ───────────────────────────────────────────────────────────────────────────────────────────────
async function impactLocal(item, ctx) {
  const p = item.params || {};
  const G = ctx.ground, at = item.at || [0, 0];
  const gy0 = Math.max(G.height(at[0], at[1]), ctx.water ? ctx.water.level : -1e9);
  const root = new THREE.Group(); root.name = 'fx.impact'; root.position.set(at[0], gy0, at[1]);
  const S = +(p.scale ?? 0.06), tI = +(p.impact ?? 5);
  const dir = dirAzEl(+(p.from ?? 200), +(p.angle ?? 45));         // from the impact point towards where it comes from
  const Rr = 5000 * S;                                              // asteroid radius (10 km diameter)
  const vEntry = 20000 * S * 1.0;                                    // m/s in scene units (20 km/s)
  // the rock: a lumpy icosahedron
  const rg = new THREE.IcosahedronGeometry(1, 4); const P = rg.attributes.position;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); const d = 1 + 0.18 * Math.sin(x * 3.1 + 1) * Math.sin(y * 2.7) + 0.1 * Math.sin(z * 5.3 + x * 2); P.setXYZ(i, x * d, y * d * 0.85, z * d); }
  rg.computeVertexNormals();
  const rock = new THREE.Mesh(rg, stdMat(ctx, { color: 0x3b3531, roughness: 0.95, emissive: 0xff5a1a, emissiveIntensity: 0.0 }));
  rock.castShadow = true;
  rock.scale.setScalar(Rr); rock.userData.noQA = true; root.add(rock);
  // plasma sheath + trail (additive cone pointing back along the path)
  const trailL = vEntry * 4.5;                                      // (Q8) a long ionised trail
  const tg = new THREE.CylinderGeometry(Rr * 1.1, Rr * 0.2, trailL, 32, 24, true); tg.translate(0, trailL / 2, 0);
  const trailMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uL: { value: trailL }, uI: { value: 1 }, uWY: { value: -1e9 }, uFH: { value: 900 * S } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying float vU; varying vec3 vN; varying vec3 vW; uniform float uL; void main(){ vU = position.y / uL; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
varying float vU; varying vec3 vN; varying vec3 vW; uniform float uT; uniform float uI; uniform float uWY; uniform float uFH;
void main(){
  #include <logdepthbuf_fragment>
  vec3 V = normalize(cameraPosition - vW); float f = pow(abs(dot(normalize(vN), V)), 1.3);
  float flick = 0.8 + 0.2 * sin(vU * 60.0 - uT * 40.0);
  vec3 c = mix(vec3(0.85, 0.92, 1.0) * 9.0, vec3(1.0, 0.62, 0.3) * 2.6, smoothstep(0.0, 0.18, vU));
  c = mix(c, vec3(0.6, 0.2, 0.07) * 0.8, smoothstep(0.25, 1.0, vU));
  float wf = smoothstep(0.0, uFH, vW.y - uWY);                      // (Q8) fades into the sea: no hard seam
  gl_FragColor = vec4(c * f * (1.0 - smoothstep(0.5, 1.0, vU)) * flick * uI * wf, 1.0); }`,
  });
  const trail = new THREE.Mesh(tg, trailMat); trail.userData.noQA = true; trail.renderOrder = 18;
  trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  root.add(trail);
  const head = glowSprite(Rr * 4.5, [1.0, 0.86, 0.7]); root.add(head);
  // (Q8) a white-hot plasma core inside the head glow, and a wide faint glow that lights the sky around it
  const core = glowSprite(Rr * 1.7, [0.95, 0.97, 1.0], 23); root.add(core);
  const skyGlow = glowSprite(Rr * 14, [1.0, 0.8, 0.6], 16); root.add(skyGlow);
  const overSea = !!ctx.water && ctx.water.level >= G.height(at[0], at[1]) - 1;
  for (const m of [head, core, skyGlow]) m.material.depthTest = !overSea;      // over the sea: the glow is not cut by the water plane
  trailMat.uniforms.uWY.value = gy0;
  if (Array.isArray(ctx.noReflect)) ctx.noReflect.push(rock, trail, head, core, skyGlow);   // no dark mirrored twin in the sea
  // the fireball lights the land it crosses: a moving light with hard shadows (land scenes; `entry_light: false` = off)
  const EL = p.entry_light !== false ? new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.7), 0) : null;
  if (EL) { root.add(EL, EL.target); if (!overSea && p.entry_shadows !== false) { EL.castShadow = true; EL.shadow.mapSize.set(2048, 2048); const sc = EL.shadow.camera; sc.left = sc.bottom = -60; sc.right = sc.top = 60; sc.near = 1; sc.far = 3000; EL.shadow.bias = -0.0004; EL.shadow.normalBias = 0.03; } }
  const _rw = new THREE.Vector3(), _fw2 = new THREE.Vector3();
  const flash = glowSprite(1, [1.0, 0.92, 0.8], 24); root.add(flash);
  const domeMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uT: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vW; varying vec3 vL; void main(){ vL = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
varying vec3 vN; varying vec3 vW; varying vec3 vL; uniform float uI; uniform float uT; void main(){
  #include <logdepthbuf_fragment>
  vec3 V = normalize(cameraPosition - vW); float mu = abs(dot(normalize(vN), V));
  float n = 0.75 + 0.25 * sin(vL.x * 9.0 + uT * 3.0) * sin(vL.z * 8.0 - uT * 2.0) * sin(vL.y * 7.0 + 1.0);
  vec3 c = mix(vec3(1.0, 0.95, 0.88) * 2.6, vec3(1.0, 0.55, 0.2) * 1.6, 1.0 - mu) * n;
  gl_FragColor = vec4(c * (0.1 + 0.9 * pow(1.0 - mu, 2.2)) * uI * smoothstep(-0.05, 0.1, vL.y), 1.0); }`,
  });
  const vdome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), domeMat);
  vdome.userData.noQA = true; vdome.renderOrder = 22; vdome.frustumCulled = false; root.add(vdome);
  const fire = glowSprite(1, [1.0, 0.5, 0.18], 23); root.add(fire);
  // shockwave ring on the surface + condensation
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uR: { value: 0 }, uW: { value: 1 }, uI: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
varying vec2 vP; uniform float uR; uniform float uW; uniform float uI; void main(){
  #include <logdepthbuf_fragment>
  float r = length(vP); float d = (r - uR) / uW; float g = exp(-d * d * 3.0) + 0.25 * exp(-max(-d, 0.0) * 0.8) * step(r, uR);
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * g * uI, 1.0); }`,
  });
  const ringR = 20000 * S * 4;
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(ringR * 2, ringR * 2, 1, 1), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 3; ring.userData.noQA = true; ring.renderOrder = 17; root.add(ring);
  // (Q8) the impact tsunami: a dark water wall racing out as a ring, foam along its crest, spray torn off it
  // (ocean impacts; `water_ring: false` = off). The glowing hoop above stays as a faint condensation shock.
  const WR = !!ctx.water && ctx.water.level >= G.height(at[0], at[1]) - 1 && p.water_ring !== false;
  const NA = 320, NRr = 14, wUT = { value: 0 };
  const PROF = [[-3.2, -0.04], [-2.2, 0.12], [-1.4, 0.35], [-0.7, 0.7], [-0.25, 0.95], [0, 1], [0.18, 0.93], [0.34, 0.72], [0.46, 0.45], [0.56, 0.22], [0.66, 0.08], [0.8, 0.0], [1.0, -0.03], [1.3, -0.05]];
  let wgeo = null, wpos = null, wfx = null;
  if (WR) {
    wgeo = new THREE.BufferGeometry(); wpos = new Float32Array(NA * NRr * 3); wfx = new Float32Array(NA * NRr * 3); const wcol = new Float32Array(NA * NRr * 3);
    for (let i = 0; i < NA * NRr; i++) { wcol[i * 3] = 0.015; wcol[i * 3 + 1] = 0.06; wcol[i * 3 + 2] = 0.075; }
    wgeo.setAttribute('position', new THREE.BufferAttribute(wpos, 3).setUsage(THREE.DynamicDrawUsage)); wgeo.setAttribute('color', new THREE.BufferAttribute(wcol, 3));
    wgeo.setAttribute('aFx', new THREE.BufferAttribute(wfx, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let r = 0; r < NRr - 1; r++) for (let a = 0; a < NA; a++) { const a1 = (a + 1) % NA, i0 = r * NA + a, i1 = r * NA + a1, i2 = (r + 1) * NA + a, i3 = (r + 1) * NA + a1; idx.push(i0, i1, i2, i1, i3, i2); }
    wgeo.setIndex(idx); wgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const wm = new THREE.Mesh(wgeo, waterMat(ctx, wUT, { uFlow: { value: new THREE.Vector2(0, 0) }, rough: 0.2, env: 0.8, bump: 0.5, sss: 1.0 }));
    wm.name = 'impact_ring_wave'; wm.userData.noQA = true; wm.frustumCulled = false; wm.receiveShadow = true; root.add(wm);
  }
  const ringAt = (tau) => ({ rw: craterR * 1.15 + 9000 * S * Math.pow(Math.max(0, tau - 0.15), 0.8), hw: 4000 * S * Math.exp(-Math.max(0, tau) / 7) * sstep(0.15, 0.9, tau) });
  function updateRing(t, tau) {
    if (!WR) return;
    wUT.value = t;
    const { rw, hw } = ringAt(tau), on = tau > 0.15;
    for (let a = 0; a < NA; a++) {
      const th = a / NA * Math.PI * 2, ca = Math.cos(th), sa = Math.sin(th), h = hw * (1 + 0.18 * fbm1(th * 6 + 3, 81) + 0.08 * fbm1(th * 23 + t * 0.3, 82));
      for (let r = 0; r < NRr; r++) {
        const q = PROF[r], rad = rw + q[0] * Math.max(h, 1) * 1.1, i3 = (r * NA + a) * 3;
        wpos[i3] = ca * rad; wpos[i3 + 1] = on ? q[1] * h : -6; wpos[i3 + 2] = sa * rad;
        wfx[i3] = 0.25 + 1.1 * Math.exp(-(((q[0] - 0.05) / 0.3) ** 2)) + 0.5 * sstep(0.3, 0.7, q[0]); wfx[i3 + 1] = 0.8 * Math.exp(-(((q[0] + 0.1) / 0.25) ** 2)); wfx[i3 + 2] = 0.6;
      }
    }
    wgeo.attributes.position.needsUpdate = wgeo.attributes.aFx.needsUpdate = true;
    wgeo.computeVertexNormals();
  }
  // fireball + ejecta curtain + debris
  const wetImp = !!ctx.water && ctx.water.level >= G.height(at[0], at[1]) - 1;           // (Q8) an ocean impact throws water and steam
  const puffs = makePuffs(ctx, { count: 3300, tint: wetImp ? [0.8, 0.8, 0.8] : [0.4, 0.36, 0.33], glow: [1, 0.45, 0.15], heat: [1.0, 0.5, 0.18], heatHDR: 3.5, near: 30, groundFade: 0.05 });
  const sparks = makeSparks(ctx, { count: 2500, maxPx: 4, minPx: 1.3 });
  root.add(puffs.mesh, sparks.mesh);
  const L1 = new THREE.PointLight(new THREE.Color(1, 0.8, 0.6), 0, 200000 * S, 1.2); L1.position.set(0, 3000 * S, 0); root.add(L1);
  const craterR = 90000 * S * 0.25;                                 // transient crater ~ tens of km (scaled)
  function update(t, clock, camera) {
    syncEnv(ctx);
    const tau = t - tI;
    // the rock on its way in
    const inFlight = tau < 0;
    const d = Math.max(0, -tau) * vEntry;
    rock.position.copy(dir).multiplyScalar(d + Rr * 0.3);
    rock.visible = inFlight;
    rock.rotation.set(t * 0.3, t * 0.2, 0);
    rock.material.emissive.setRGB(1.0, 0.7, 0.42); rock.material.emissiveIntensity = inFlight ? 2.4 : 0;   // (Q8) white-hot, ablating
    trail.position.copy(rock.position); trail.visible = inFlight || tau < 0.4;
    trailMat.uniforms.uT.value = t; trailMat.uniforms.uI.value = inFlight ? 1 : Math.max(0, 1 - tau / 0.4);
    head.position.copy(rock.position); head.material.uniforms.uI.value = inFlight ? 1.1 : 0;
    core.position.copy(rock.position); core.material.uniforms.uI.value = inFlight ? 2.6 : 0;
    skyGlow.position.copy(rock.position); skyGlow.material.uniforms.uI.value = inFlight ? 0.1 + 0.18 * Math.exp(tau / 1.5) : 0;
    if (EL) {
      EL.intensity = inFlight ? 2.0 + 7 * Math.exp(tau / 1.2) : 0;
      if (camera) {
        camera.getWorldDirection(_fw2); _fw2.y = 0; if (_fw2.lengthSq() < 1e-6) _fw2.set(0, 0, -1); _fw2.normalize();
        EL.target.position.copy(camera.position).addScaledVector(_fw2, 25).sub(root.position); EL.target.position.y = camera.position.y - root.position.y - 2;
        _rw.copy(rock.position).sub(EL.target.position).normalize();
        EL.position.copy(EL.target.position).addScaledVector(_rw, 800); EL.target.updateMatrixWorld();
      }
    }
    // flash: blinding for a moment, then a white-hot vapour dome that cools into the steam (Q8: not a flat disc)
    const fl = tau >= 0 ? Math.exp(-tau / 0.08) + Math.exp(-tau / 1.2) * 0.08 : 0;
    flash.material.uniforms.uS.value = 22000 * S * (0.5 + Math.min(1, tau * 4));
    flash.material.uniforms.uI.value = fl * 3;
    flash.position.set(0, 900 * S, 0);
    const rd = tau > 0 ? 32000 * S * (1 - Math.exp(-tau / 0.22)) : 0;
    vdome.scale.set(rd + 1, (rd + 1) * 0.6, rd + 1); vdome.visible = tau > 0 && tau < 3.5;
    domeMat.uniforms.uT.value = t; domeMat.uniforms.uI.value = tau > 0 ? 0.35 * Math.exp(-tau / 0.12) : 0;   // only the shock's first instant; the vapour is billows
    if (Array.isArray(ctx.noReflect)) { const k = ctx.noReflect.indexOf(puffs.mesh); if (inFlight && k < 0) ctx.noReflect.push(puffs.mesh); else if (!inFlight && k >= 0) ctx.noReflect.splice(k, 1); }   // the entry smoke is not mirrored either
    updateRing(t, tau);
    // fireball: rises and expands
    const fr = tau > 0 ? 25000 * S * (1 - Math.exp(-tau / 1.4)) : 0;
    fire.position.set(0, fr * 0.55, 0); fire.material.uniforms.uS.value = fr * 1.7 + 1; fire.material.uniforms.uI.value = tau > 0 ? 1.1 * Math.exp(-tau / 4) : 0;
    L1.intensity = tau > 0 ? 6e4 * (Math.exp(-tau / 0.5) * 2 + Math.exp(-tau / 4)) : 0;
    // shockwave ring (supersonic, decelerating)
    const rr = tau > 0 ? 42000 * S * Math.pow(tau, 0.6) : 0;
    ringMat.uniforms.uR.value = rr; ringMat.uniforms.uW.value = 1400 * S + rr * 0.07; ringMat.uniforms.uI.value = tau > 0 ? (WR ? 0.45 : 2.2) * Math.exp(-tau / (WR ? 3 : 6)) : 0;   // Q8: with a water ring this is only the faint condensation shock
    // ejecta curtain: debris launched at ~45 deg from the growing crater rim -> an inverted cone that widens
    puffs.begin(); sparks.begin();
    if (tau > 0) {
      for (let i = 0; i < 1500; i++) {
        const tl = hf(i, 1) * Math.min(tau, 4);                     // launch time after impact
        const age = tau - tl;
        const a = hf(i, 2) * Math.PI * 2;
        const r0 = craterR * Math.sqrt(tl / 4) * 0.9;
        const v0 = (7000 - 4200 * Math.sqrt(tl / 4)) * S * 1.4;
        const vh = v0 * 0.72, vv = v0 * 0.7;
        const g = 9.81 * S * 55;                                     // scaled gravity so the curtain arcs in shot time
        const y = vv * age - 0.5 * g * age * age;
        if (y < -50 * S) continue;
        const r = r0 + vh * age;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const size = 1800 * S + age * 700 * S + hf(i, 3) * 1400 * S;
        const hot = Math.exp(-age / 1.6);
        // Q4: the curtain's outer face and its rim towards the sun lit, its inside dark; fresh debris crisp, then torn
        const occC = clamp(0.2 + 0.62 * sstep(-0.4, 0.6, (Math.cos(a) * U.uSunDir.value.x + Math.sin(a) * U.uSunDir.value.z) * 0.7 + U.uSunDir.value.y * 0.5) + 0.15 * clamp(y / (3000 * S)));
        puffs.push(x, Math.max(y, 0) + size * 0.3, z, size, hf(i, 4) * 6.28 + age * 0.15 * (hf(i, 5) - 0.5), 0.75 * sstep(0, 0.2, age), i & 3, -1e5, wetImp ? lerp(0.95, 0.6, sstep(1, 4, age)) : 0.42, 0.5 * hot, 0.55 * hot, 0.1,
          clamp(0.08 + 0.12 * age), occC, hf(i, 6));
        if (i < 1300) sparks.push(x, Math.max(y, 0) + size * 0.5, z, 7 * hot + 0.4, 3 * hot + 0.15, 0.7 * hot, 60 * S);
      }
      // the rising fireball column
      for (let i = 0; i < 700; i++) {
        const age = hf(i, 11) * tau;
        const a = hf(i, 12) * Math.PI * 2, r = fr * 0.7 * Math.sqrt(hf(i, 13));
        const y = fr * 0.2 + age * 3500 * S * 0.8 * hf(i, 14) + 400 * S;
        const size = fr * 0.35 + 600 * S;
        puffs.push(Math.cos(a) * r, y, Math.sin(a) * r, size, hf(i, 15) * 6.28 + tau * 0.1 * (hf(i, 16) - 0.5), 0.7, i & 3, -1e5, wetImp ? 0.7 : 0.4, 0.8, clamp(0.9 * Math.exp(-tau / 3)), 0.1,
          clamp(0.15 + 0.08 * tau), clamp(0.35 + 0.5 * sstep(-0.3, 0.6, U.uSunDir.value.y + 0.3 * hf(i, 17))), hf(i, 18));
      }
      if (tau < 2.5) for (let i = 0; i < 260; i++) {                  // (Q8) the vapour flash: hot billows on an expanding dome, cooling to steam
        const th = hf(i, 41) * Math.PI * 2, ph = Math.acos(hf(i, 42) * 0.95), rv = 30000 * S * (1 - Math.exp(-tau / 0.22)) * (0.85 + 0.25 * hf(i, 43));
        const hot = Math.exp(-tau / 0.35), size = rv * (0.16 + 0.12 * hf(i, 44)) + 200 * S;
        puffs.push(Math.cos(th) * Math.sin(ph) * rv, Math.cos(ph) * rv * 0.6 + size * 0.3, Math.sin(th) * Math.sin(ph) * rv, size, hf(i, 45) * 6.28, 0.8 * (1 - sstep(0.8, 2.5, tau)), i & 3, -1e5, wetImp ? 0.95 : 0.6, 1.2 * hot, 1.6 * hot, 0.05, clamp(0.1 + 0.3 * tau), 0.8, hf(i, 46));
      }
      if (WR && tau > 0.3) {                                           // (Q8) spray torn off the crest of the water wall
        for (let i = 0; i < 360; i++) {
          const life = 1.2 + hf(i, 31) * 1.6, age = ((tau + hf(i, 32) * life) % life), tb = tau - age;
          if (tb < 0.3) continue;
          const { rw, hw } = ringAt(tb), a = hf(i, 33) * Math.PI * 2, r = rw + age * 600 * S + hw * 0.1;
          const size = hw * (0.35 + 0.5 * hf(i, 34)) * (0.7 + age), y = hw * (0.85 + 0.3 * hf(i, 35)) + age * 900 * S;
          puffs.push(Math.cos(a) * r, y, Math.sin(a) * r, size, hf(i, 36) * 6.28, 0.5 * sstep(0, 0.2, age) * (1 - sstep(0.5, 1, age / life)), i & 3, -1e5, 0.95, 0, 0, 0.1, clamp(0.55 + 0.4 * age / life), 0.9, hf(i, 37));
        }
      }
    } else {
      // smoke of the entry, left along the path
      for (let i = 0; i < 300; i++) {
        const s = hf(i, 21) * 1.5;                                   // seconds ago
        const pos = (d + (0.12 + s) * vEntry);
        const age = s;
        if (pos > vEntry * 3) continue;
        puffs.push(dir.x * pos, dir.y * pos, dir.z * pos, Rr * (1.2 + age * 2.5), hf(i, 22) * 6.28, 0.26 * (1 - s / 1.5), i & 3, -1e5, 0.7, 0.9 * Math.exp(-age * 2), 0.3 * Math.exp(-age * 3), 0.0,
          clamp(0.3 + 0.4 * age), 0.7, hf(i, 23));
      }
    }
    puffs.end(camera); sparks.end();
  }
  update(0, 0, null);
  return { root, radius: 4500, height: 400, snapped: true, update, anchors: { impact: [at[0], gy0, at[1]] } };
}

// ── impact: global ──────────────────────────────────────────────────────────────────────────────────────────────
async function impactGlobal(item, ctx) {
  const p = item.params || {};
  const at = item.at || [0, 0];
  const R = +(p.radius ?? 600), tI = +(p.impact ?? 2);
  const ey = (item.y ?? p.y) != null ? +(item.y ?? p.y) : ctx.ground.height(at[0], at[1]) + 170;
  const e = await buildSpace('space.earth', { at, y: ey, radius: R, spin: 0.25, lon: +(p.lon ?? -60), lat: +(p.lat ?? 0), tilt: +(p.tilt ?? 23.4), face: p.face, veil: p.veil, veil_dur: p.veil_dur, clouds: 0.8 }, ctx);
  const root = e.root; root.name = 'fx.impact.global';
  const spinG = e.spinG;
  const site = latLonDir(21.3, -89.5);                              // Chicxulub
  const shell = bandShell(R * 1.012, { site, col: [1.0, 0.18, 0.04], edge: [1.0, 0.62, 0.25], width: 0.1, fill: 0.4, mode: 0 });
  spinG.add(shell.mesh);
  const atm = bandShell(R * 1.045, { site, col: [0.9, 0.15, 0.03], edge: [1.0, 0.4, 0.1], width: 0.2, fill: 0.25, mode: 0, order: 21 });
  spinG.add(atm.mesh);
  const flash = glowSprite(R * 1.2, [1, 0.85, 0.6]); spinG.add(flash);
  flash.position.copy(site).multiplyScalar(R * 1.02);
  const sparks = makeSparks(ctx, { count: 2600, maxPx: 3, minPx: 1.1 });
  spinG.add(sparks.mesh);
  const up = new THREE.Vector3(), tmp = new THREE.Vector3(), b1 = new THREE.Vector3(), b2 = new THREE.Vector3();
  const spread = +(p.spread ?? 1);
  function update(t, clock, camera) {
    e.update(t);
    const tau = t - tI;
    // the ring of re-entering ejecta reaches the antipode (pi) in ~10 s of screen time
    const ang = tau > 0 ? Math.min(Math.PI + 0.3, spread * 0.24 * Math.pow(tau, 0.85)) : 0;
    for (const s of [shell, atm]) { s.uni.uAng.value = ang; s.uni.uI.value = tau > 0 ? 1 : 0; s.uni.uTime.value = t; }
    flash.material.uniforms.uI.value = tau > 0 ? Math.exp(-tau / 0.6) * 2 + 0.3 * Math.exp(-tau / 6) : 0;
    // streaks of debris falling back in near the front
    sparks.begin();
    if (tau > 0) {
      b1.set(0, 1, 0).cross(site).normalize(); if (b1.lengthSq() < 0.1) b1.set(1, 0, 0); b2.copy(site).cross(b1).normalize();
      for (let i = 0; i < 2600; i++) {
        const a = hf(i, 1) * Math.PI * 2, back = hf(i, 2) * 0.5;
        const th = Math.max(0.01, ang - back * 0.8);
        up.copy(site).multiplyScalar(Math.cos(th)).addScaledVector(b1, Math.sin(th) * Math.cos(a)).addScaledVector(b2, Math.sin(th) * Math.sin(a)).normalize();
        const cyc = (t * 0.9 + hf(i, 3)) % 1;
        const hgt = R * (1.12 - 0.1 * cyc);
        tmp.copy(up).multiplyScalar(hgt);
        const k = Math.sin(cyc * Math.PI) * (1 - back);
        sparks.push(tmp.x, tmp.y, tmp.z, 6 * k, 2.2 * k, 0.5 * k, R * 0.004);
      }
    }
    sparks.end();
  }
  update(0, 0, null);
  return { root, radius: R * 1.05, height: R * 2, snapped: true, update, anchors: {} };
}

// ── gamma-ray burst ─────────────────────────────────────────────────────────────────────────────────────────────
async function grbSpace(item, ctx) {
  const p = item.params || {};
  const at = item.at || [0, 0];
  const R = +(p.radius ?? 600), tB = +(p.burst ?? 2), fade = +(p.fade ?? 9);
  const ey = (item.y ?? p.y) != null ? +(item.y ?? p.y) : ctx.ground.height(at[0], at[1]) + 170;
  const e = await buildSpace('space.earth', { at, y: ey, radius: R, spin: 0.25, lon: +(p.lon ?? 10), lat: +(p.lat ?? 0), tilt: +(p.tilt ?? 23.4), face: p.face, veil: p.veil, veil_dur: p.veil_dur, clouds: 0.8 }, ctx);
  const root = e.root; root.name = 'fx.grb';
  const bdir = dirAzEl(+(p.az ?? 230), +(p.el ?? 35));               // towards the burst, from the Earth
  const D = R * 40;
  // the star: a blinding point far away along bdir
  const star = glowSprite(R * 3, [0.8, 0.85, 1.0], 22); star.position.copy(bdir).multiplyScalar(D); root.add(star);
  // the jet: a thin additive beam from the star to the Earth, switched on as its front sweeps in
  const bl = D;
  const bg = new THREE.CylinderGeometry(R * 0.5, R * 0.2, bl, 24, 60, true); bg.translate(0, bl / 2, 0);   // (Q8) a jet with width, not a laser line
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uHead: { value: 0 }, uI: { value: 0 }, uT: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying float vU; varying vec3 vN; varying vec3 vW; void main(){ vU = uv.y; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
varying float vU; varying vec3 vN; varying vec3 vW; uniform float uHead; uniform float uI; uniform float uT; void main(){
  #include <logdepthbuf_fragment>
  vec3 V = normalize(cameraPosition - vW); float f = pow(abs(dot(normalize(vN), V)), 2.4);
  float on = smoothstep(uHead - 0.03, uHead, 1.0 - vU);
  float knots = 0.6 + 0.4 * pow(0.5 + 0.5 * sin(vU * 90.0 + uT * 14.0), 3.0);
  vec3 c = mix(vec3(0.9, 0.93, 1.0) * 4.0, vec3(0.62, 0.5, 1.0) * 2.2, 1.0 - f);
  gl_FragColor = vec4(c * f * knots * on * uI, 1.0); }`,
  });
  const beam = new THREE.Mesh(bg, beamMat); beam.userData.noQA = true; beam.renderOrder = 19;
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bdir); root.add(beam);
  // (Q8) the giant star before: a big orange envelope, pulsing; `t_collapse`: it shrinks onto a brightening core;
  // `t_jets`: two opposed jets punch out of it (axis side-on to the Earth, or `jets: "earth"` = along the beam) and stay
  const tJ = num(p.t_jets, tB - 1.2), tC = num(p.t_collapse, tJ - 2.2), jetMode = String(p.jets ?? 'side');
  const env = glowSprite(R * 9, [1.0, 0.45, 0.18], 21); env.position.copy(star.position); root.add(env);
  const jAx = jetMode === 'earth' ? bdir.clone() : new THREE.Vector3().crossVectors(bdir, Math.abs(bdir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize().applyAxisAngle(bdir, 0.35);
  const LJ = R * 18, jg = new THREE.CylinderGeometry(R * 0.9, R * 0.03, 1, 24, 40, true); jg.translate(0, 0.5, 0);
  const jetMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uI: { value: 0 }, uLen: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying float vV; varying vec3 vN; varying vec3 vW; void main(){ vV = uv.y; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
varying float vV; varying vec3 vN; varying vec3 vW; uniform float uT; uniform float uI; uniform float uLen; void main(){
  #include <logdepthbuf_fragment>
  vec3 V = normalize(cameraPosition - vW); float f = pow(abs(dot(normalize(vN), V)), 1.6);
  float v = vV;                                                   // 0 at the star .. 1 at the tip
  float knots = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(v * 38.0 - uT * 9.0), 3.0);
  float tip = 1.0 - smoothstep(0.75, 1.0, v);
  vec3 c = mix(vec3(0.85, 0.9, 1.0) * 9.0, vec3(0.6, 0.45, 1.0) * 2.6, smoothstep(0.0, 0.6, v));
  gl_FragColor = vec4(c * f * knots * tip * (1.0 - 0.6 * v) * uI, 1.0); }`,
  });
  const jets = [1, -1].map((sg) => { const m = new THREE.Mesh(jg, jetMat); m.userData.noQA = true; m.renderOrder = 19; m.position.copy(star.position); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), jAx.clone().multiplyScalar(sg)); m.frustumCulled = false; root.add(m); return m; });
  // day-side flash + the ozone shell being stripped (both follow the Earth's spin; the site is the sub-burst point)
  const spinG = e.spinG;
  const ozone = bandShell(R * 1.03, { site: new THREE.Vector3(0, 0, 1), col: [0.35, 0.55, 1.0], edge: [0.55, 1.0, 0.7], width: 0.12, mode: 1, order: 21 });
  spinG.add(ozone.mesh);
  const flashShell = bandShell(R * 1.006, { site: new THREE.Vector3(0, 0, 1), col: [0.8, 0.85, 1.0], edge: [0.12, 0.12, 0.15], width: 0.9, fill: 0.9, mode: 0, order: 20, disc: 0.25 });   // Q8: a brief flash of the facing hemisphere, not a white ball
  spinG.add(flashShell.mesh);
  const qi = new THREE.Quaternion(), loc = new THREE.Vector3();
  const _los = new THREE.Vector3(), _sw = new THREE.Vector3(), _ax = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _yv = new THREE.Vector3(0, 1, 0);
  function update(t, clock, camera) {
    e.update(t);
    const tau = t - tB;
    if (camera && jetMode === 'side') {                           // (Q8) keep the jets side-on to the lens
      star.getWorldPosition(_sw); _los.copy(_sw).sub(camera.position).normalize();
      _ax.crossVectors(_los, Math.abs(_los.y) < 0.9 ? _up : _yv.set(1, 0, 0)).normalize().applyAxisAngle(_los, 0.35); _yv.set(0, 1, 0);
      jets[0].quaternion.setFromUnitVectors(_yv, _ax); jets[1].quaternion.setFromUnitVectors(_yv, _ax.negate());
    }
    // sub-burst point in the spinning frame
    spinG.updateWorldMatrix(true, false); spinG.getWorldQuaternion(qi).invert(); loc.copy(bdir).applyQuaternion(qi).normalize();
    ozone.uni.uSite.value.copy(loc); flashShell.uni.uSite.value.copy(loc);
    const head = clamp((t - (tB - 1.2)) / 1.2);                     // the beam front sweeps in over 1.2 s
    beamMat.uniforms.uHead.value = head; beamMat.uniforms.uT.value = t; beamMat.uniforms.uI.value = tau > -1.2 ? (tau < 0 ? 1 : Math.exp(-tau / fade) + 0.15) : 0;
    star.material.uniforms.uI.value = tau > -1.4 ? (1.5 + 3 * Math.exp(-Math.abs(tau + 1.4) / 0.5)) * (tau < 0 ? 1 : Math.exp(-tau / (fade * 2))) : 0.25;
    // (Q8) collapse + jets
    const kc = sstep(tC, tC + 1.6, t), pulse = 1 + 0.08 * Math.sin(t * 2.3) * (1 - kc);
    env.material.uniforms.uS.value = R * lerp(9, 1.6, kc * kc) * pulse; env.material.uniforms.uI.value = jetMode === 'none' && !p.t_collapse ? 0 : lerp(0.55, 1.4, kc) * (1 - sstep(tJ, tJ + 3, t) * 0.7);
    if (t > tC) star.material.uniforms.uI.value = Math.max(star.material.uniforms.uI.value, 0.25 + 3.5 * kc * kc + 5 * Math.exp(-Math.abs(t - tJ) / 0.25) * (t > tJ - 0.1 ? 1 : 0));
    const jl = jetMode === 'none' ? 0 : LJ * (1 - Math.exp(-Math.max(0, t - tJ) / 0.22));
    for (const m of jets) { m.visible = jl > 1; m.scale.set(1, Math.max(1, jl), 1); }
    jetMat.uniforms.uT.value = t; jetMat.uniforms.uI.value = t > tJ ? 1.2 + 2.5 * Math.exp(-(t - tJ) / 0.6) : 0;
    ozone.uni.uI.value = 1; ozone.uni.uTime.value = t;
    ozone.uni.uAng.value = tau > 0 ? Math.min(Math.PI * 0.55, 0.3 * Math.pow(tau, 0.8)) : 0;
    flashShell.uni.uAng.value = Math.PI * 0.5; flashShell.uni.uI.value = tau > 0 ? 1.1 * Math.exp(-tau / 0.3) : 0;
  }
  update(0);
  return { root, radius: R * 1.05, height: R * 2, snapped: true, update, anchors: {} };
}

async function grbSky(item, ctx) {
  const p = item.params || {};
  const tB = +(p.burst ?? 2), fade = +(p.fade ?? 9);
  const root = new THREE.Group(); root.name = 'fx.grb.sky';
  const at = item.at || [0, 0];
  root.position.set(at[0], ctx.ground.height(at[0], at[1]), at[1]);
  const bdir = dirAzEl(+(p.az ?? 230), +(p.el ?? 35));
  // the sky dome glows around the burst point (additive, inside-facing)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(20000, 64, 32), new THREE.ShaderMaterial({
    uniforms: { uDir: { value: bdir }, uI: { value: 0 }, uT: { value: 0 }, uSun: { value: p.second_sun ? 1 : 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
varying vec3 vD; uniform vec3 uDir; uniform float uI; uniform float uT; uniform float uSun; void main(){
  #include <logdepthbuf_fragment>
  float c = max(dot(normalize(vD), uDir), 0.0);
  float core = pow(c, 2000.0) * 60.0 + pow(c, 180.0) * 6.0 + pow(c, 12.0) * 1.2;
  float ang = acos(clamp(c, -1.0, 1.0));
  float disc = smoothstep(0.0085, 0.0062, ang);                   // (Q8) a visible source: a sun-sized white disc
  float spikes = pow(max(0.0, 1.0 - ang * 9.0), 3.0) * (0.35 + 0.65 * pow(abs(sin(atan(vD.z - uDir.z, vD.x - uDir.x) * 3.0)), 24.0));
  float sky = 0.55 + 0.45 * smoothstep(-0.2, 0.6, vD.y);
  float ripple = 0.85 + 0.15 * sin(acos(c) * 40.0 - uT * 3.0);
  vec3 col = vec3(0.72, 0.68, 1.0) * sky * ripple * 0.5 + vec3(0.95, 0.92, 1.0) * (pow(c, 2000.0) * 60.0 + pow(c, 180.0) * 4.0 + pow(c, 12.0) * 0.6) + vec3(1.0, 0.99, 1.04) * (disc * 160.0 + spikes * 3.0);
  if (uSun > 0.5) {
    // (Q8) second_sun: a big, intensely bright disc, a glare halo and subtle rays, the sky hard white-blue around it,
    // the rest of the sky keeping its own colour (contrast: the disc must read)
    vec3 e1 = normalize(cross(uDir, abs(uDir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), e2 = cross(uDir, e1);
    vec3 dd = normalize(vD); float th = atan(dot(dd, e2), dot(dd, e1));
    float big = smoothstep(0.0175, 0.0145, ang);
    float halo = exp(-ang * 70.0) * 2.0 + exp(-ang * 16.0) * 0.8 + exp(-ang * 4.0) * 0.32;
    float rays = pow(abs(cos(th * 6.0 + 0.3)), 140.0) * exp(-ang * 9.0) * 0.5 + pow(abs(cos(th * 4.0 + 1.1)), 200.0) * exp(-ang * 6.0) * 0.25;
    float wash = 0.12 * sky;
    col = vec3(0.7, 0.72, 1.0) * wash + vec3(0.88, 0.94, 1.0) * (halo + rays) + vec3(1.0, 0.99, 1.02) * big * 420.0;
  }
  gl_FragColor = vec4(col * uI, 1.0); }`,
  }));
  dome.frustumCulled = false; dome.userData.noQA = true; dome.renderOrder = -1; root.add(dome);
  const sun = new THREE.DirectionalLight(p.second_sun ? new THREE.Color(0.95, 0.96, 1.0) : new THREE.Color(0.8, 0.8, 1.0), 0); sun.position.copy(bdir).multiplyScalar(1000); root.add(sun, sun.target);
  // (Q8) the burst lights the scene like a second sun: hard shadows from it (`shadows: false` = flat light as before)
  const SH = p.shadows !== false;
  if (SH) { sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = sc.bottom = -45; sc.right = sc.top = 45; sc.near = 1; sc.far = 1400; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; }
  const _fw = new THREE.Vector3();
  function update(t, clock, camera) {
    const tau = t - tB;
    const I = tau > 0 ? (1 - Math.exp(-tau / 0.15)) * (0.25 + 0.75 * Math.exp(-tau / fade)) * (1 + 0.08 * Math.sin(t * 17) * Math.exp(-tau / 2)) : 0;
    dome.material.uniforms.uI.value = I; dome.material.uniforms.uT.value = t;
    if (camera) dome.position.copy(camera.position).sub(root.position);
    sun.intensity = I * (p.second_sun ? 7.5 : 6);
    if (SH && camera) {                                               // the shadow box follows what the camera looks at
      camera.getWorldDirection(_fw); _fw.y = 0; if (_fw.lengthSq() < 1e-6) _fw.set(0, 0, -1); _fw.normalize();
      sun.target.position.copy(camera.position).addScaledVector(_fw, 22).sub(root.position); sun.target.position.y = 0;
      sun.position.copy(sun.target.position).addScaledVector(bdir, 600); sun.target.updateMatrixWorld();
    }

  }
  update(0, 0, null);
  return { root, radius: 20, height: 10, snapped: true, update, anchors: {} };
}

export async function build(kind, item, ctx) {
  const mode = (item.params || {}).mode;
  if (kind === 'fx.grb') return mode === 'sky' ? grbSky(item, ctx) : grbSpace(item, ctx);
  return mode === 'global' ? impactGlobal(item, ctx) : impactLocal(item, ctx);
}
