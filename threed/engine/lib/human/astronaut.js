// astronaut.js — E4 (v2, 27 Sep 2026): YOU in a spacesuit, in trouble (tasteful, never gory), and the insert props.
//   space.astronaut     ONE hero astronaut (the house faceless mannequin in the white suit, kits.js 'astronaut'):
//                       visor gold | dark | clear; suit intact | cracked_visor | frost | overheating | venting, each
//                       spreading from suit_at over suit_dur; actions float (zero-g drift + tumble), walk (low-gravity
//                       bounding along a path), stand, kneel, reach, look_up, fall (a slow fall at the world's gravity)
//                       in a timeline [{t, action}] with eased 0.6 s blends. A group of astronauts: figure.astronaut.
//   detail.suit_gauge   the chest/wrist gauge: O2, PRESSURE, TEMP dials, needles easing to the values ([from, to] over
//                       the shot) with a live flutter, a blinking warning lamp
//   detail.visor        a helmet visor in close-up: gold (or dark) with a crack or frost spreading from a point / the rim
//   detail.thermometer  a glass thermometer with a scale, the column rising to a value (°C or °F)
// Pure functions of t. Poses are FK on the house rig (rig.js pose parameters), never IK through the body.
import * as THREE from 'three';
import { dress } from './kits.js';
import { patchAll, xz, yawFromHeading } from './common.js';
import { canvas, ctex, loadFonts, FAM, font } from './details_core.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' && typeof v !== 'boolean' ? +v : d);
function cleanParams(item) { const p = {}; for (const [k, v] of Object.entries(item.params || {})) if (!(typeof v === 'string' && /[\s|]/.test(v))) p[k] = v; return Object.assign(p, item); }
const GRAV = { moon_surface: 1.62, mars: 3.71, mercury: 3.7, venus: 8.87, pluto: 0.62, titan: 1.35, space: 0 };

// ── poses (rig.js FK parameters; suited arms stand off the body) ─────────────────────────────────────────────────────
const P = {
  stand: { lArmZ: 0.22, rArmZ: -0.22, lElbow: -0.28, rElbow: -0.28, lLegY: 0.1, rLegY: -0.1, lShape: 'soft', rShape: 'soft', weapon: null },
  float: { plant: false, lean: 0.12, spineX: 0.04, lArmZ: 0.62, rArmZ: -0.55, lArmX: -0.3, rArmX: -0.12, lElbow: -0.62, rElbow: -0.45, lLeg: -0.3, rLeg: 0.08, lKnee: 0.62, rKnee: 0.38, lFoot: 0.3, rFoot: 0.25, headX: -0.08, lShape: 'soft', rShape: 'soft', weapon: null },
  reach: { rArmX: -1.5, rArmZ: -0.16, rArmY: 0.12, rElbow: -0.07, chestX: -0.1, chestY: -0.12, headX: -0.12, headY: -0.08, lArmZ: 0.3, lElbow: -0.45, rShape: 'relaxed', lShape: 'soft', weapon: null },
  // the helmet rides on the head bone: the body leans back to look up, the head only a little (a tilted helmet shows its inside)
  look_up: { headX: -0.28, chestX: -0.34, spineX: -0.16, lean: -0.05, lArmZ: 0.26, rArmZ: -0.26, lElbow: -0.34, rElbow: -0.34, lShape: 'soft', rShape: 'soft', weapon: null },
  kneel: { drop: 0.44, lean: 0.12, chestX: 0.12, headX: 0.18, lLeg: -1.5, lKnee: 1.6, lFoot: -0.1, rLeg: -0.1, rKnee: 2.1, rFoot: 0.62, rToe: -0.8, lArmZ: 0.3, rArmZ: -0.3, lElbow: -0.9, rElbow: -0.7, lArmX: -0.35, rArmX: -0.25, lShape: 'soft', rShape: 'soft', weapon: null },
  walk: { lean: 0.16, chestX: 0.05, headX: 0.04, lArmZ: 0.3, rArmZ: -0.3, lElbow: -0.45, rElbow: -0.45, armSwing: [0.6, 0.6], weapon: null, lShape: 'soft', rShape: 'soft' },
  fallen: { plant: false, lArmZ: 1.1, rArmZ: -1.0, lArmX: -0.4, rArmX: -0.2, lElbow: -0.5, rElbow: -0.35, lLeg: -0.25, rLeg: -0.05, lKnee: 0.5, rKnee: 0.2, headX: -0.1, lShape: 'soft', rShape: 'soft', weapon: null },
};
const ACTIONS = ['stand', 'float', 'walk', 'kneel', 'reach', 'look_up', 'fall'];
function blendPose(a, b, w) {
  if (w <= 0) return a; if (w >= 1) return b;
  const o = { ...a, ...b };
  for (const k of Object.keys(o)) {
    const va = a[k], vb = b[k];
    if (typeof va === 'number' || typeof vb === 'number') o[k] = lerp(typeof va === 'number' ? va : 0, typeof vb === 'number' ? vb : 0, w);
    else o[k] = w < 0.5 ? (va ?? vb) : (vb ?? va);
  }
  if (a.plant === false || b.plant === false) o.plant = w < 0.5 ? a.plant : b.plant;
  return o;
}

// ── visor overlays: crack / frost textures (R: the mark, G: when it appears, 0 first .. 1 last) ──────────────────────
function overlayTex(kind, seed = 3) {
  const N = 512, [c, g] = canvas(N, N), img = g.createImageData(N, N), d = img.data;
  let s = seed * 9301 + 49297; const R = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const R8 = new Float32Array(N * N), G8 = new Float32Array(N * N).fill(1);
  const plot = (x, y, a, tm, w = 1.4) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const X = Math.round(x + dx), Y = Math.round(y + dy); if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
      const f = Math.max(0, 1 - Math.hypot(dx, dy) / w) * a, i = Y * N + X;
      if (f > R8[i]) R8[i] = f; if (f > 0.05) G8[i] = Math.min(G8[i], tm);
    }
  };
  if (kind === 'crack') {
    const ix = N * 0.36, iy = N * 0.4;                      // the impact point (upper left of the visor)
    for (let a = 0; a < 360; a += 360 / 26) plot(ix + Math.cos(a * DEG) * 3, iy + Math.sin(a * DEG) * 3, 1, 0, 3);
    const walk = (x, y, ang, len, tm0, depth) => {
      let px = x, py = y;
      for (let i = 0; i < len; i++) {
        ang += (R() - 0.5) * 0.35; px += Math.cos(ang) * 2; py += Math.sin(ang) * 2;
        const tm = tm0 + (i / len) * (1 - tm0) * 0.9;
        plot(px, py, 0.9 - depth * 0.15, tm, 1.3 - depth * 0.25);
        if (depth < 2 && R() < 0.018) walk(px, py, ang + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), Math.round(len * (0.25 + R() * 0.35)), tm, depth + 1);
      }
    };
    for (let k = 0; k < 11; k++) walk(ix, iy, k / 11 * TAU + R() * 0.4, 90 + Math.round(R() * 140), 0, 0);
    for (const rr of [22, 44, 71]) {                          // concentric fractures
      let a0 = R() * TAU;
      for (let a = 0; a < TAU * 0.8; a += 0.02) { const r = rr * (1 + 0.08 * Math.sin(a * 5 + rr)); plot(ix + Math.cos(a0 + a) * r, iy + Math.sin(a0 + a) * r, 0.6, 0.1 + rr / 180, 1.1); }
    }
  } else {
    // frost: feathery crystals growing in from the rim (G = distance from the rim), denser near the edge
    for (let k = 0; k < 900; k++) {
      const side = Math.floor(R() * 4), t0 = R();
      let x = side === 0 ? 0 : side === 1 ? N - 1 : t0 * N, y = side === 2 ? 0 : side === 3 ? N - 1 : t0 * N;
      let ang = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
      ang += (R() - 0.5) * 1.2;
      const len = 20 + R() * 110;
      for (let i = 0; i < len; i++) {
        x += Math.cos(ang) * 1.6; y += Math.sin(ang) * 1.6; ang += (R() - 0.5) * 0.25;
        const edge = Math.min(x, y, N - x, N - y) / (N * 0.5);
        plot(x, y, 0.55, clamp(edge * 1.25), 1.2);
        if (R() < 0.08) { const b = ang + (R() < 0.5 ? 1 : -1) * 1.0; for (let j = 1; j < 7; j++) plot(x + Math.cos(b) * j * 1.5, y + Math.sin(b) * j * 1.5, 0.4, clamp(edge * 1.25 + 0.02), 1); }
      }
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x, edge = Math.min(x, y, N - x, N - y) / (N * 0.5); const haze = 0.35 * Math.max(0, 1 - edge * 1.6); if (haze > R8[i]) { R8[i] = Math.max(R8[i], haze); G8[i] = Math.min(G8[i], clamp(edge * 1.25)); } }
  }
  for (let i = 0; i < N * N; i++) { d[i * 4] = Math.round(R8[i] * 255); d[i * 4 + 1] = Math.round(clamp(G8[i]) * 255); d[i * 4 + 2] = 0; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
function overlayMaterial(tex, kind) {
  return new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uGrow: { value: 0 }, uFrost: { value: kind === 'frost' ? 1 : 0 } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uTex; uniform float uGrow, uFrost; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        #include <logdepthbuf_fragment>
        vec4 t = texture2D(uTex, vUv);
        float shown = smoothstep(uGrow + 0.02, uGrow - 0.06, t.g) * step(0.001, uGrow);
        float a = t.r * shown;
        if (a < 0.01) discard;
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
        vec3 c = uFrost > 0.5 ? vec3(0.82, 0.88, 0.95) * (0.55 + 0.6 * fres) : vec3(0.95, 0.96, 1.0) * (0.75 + 0.5 * fres);
        gl_FragColor = vec4(c * a, a * (uFrost > 0.5 ? 0.8 : 0.95));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}
// the visor's own shape (kits.js space_helmet), slightly outside it
function visorGeo(r = 0.1705) { return new THREE.SphereGeometry(r, 48, 32, Math.PI / 2 - 0.97, 1.94, Math.PI * 0.19, Math.PI * 0.48); }

// ── gas / vapour puffs: a pure function of t (birth times spread over the emission) ───────────────────────────────────
function puffs(o) {
  const n = o.count ?? 220, pxK = o.pxScale ?? 1, g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), rnd = new Float32Array(n * 4);
  let s = (o.seed ?? 5) * 7 + 3; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) { rnd[i * 4] = R(); rnd[i * 4 + 1] = R(); rnd[i * 4 + 2] = R(); rnd[i * 4 + 3] = R(); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aR', new THREE.BufferAttribute(rnd, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uT0: { value: o.t0 ?? 0 }, uLife: { value: o.life ?? 1.6 }, uOrig: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, 0, 1) }, uSpeed: { value: o.speed ?? 3 },
      uSpread: { value: o.spread ?? 0.35 }, uCol: { value: new THREE.Color(...(o.color || [0.92, 0.94, 0.97])) }, uSize: { value: (o.size ?? 0.5) * pxK }, uAmt: { value: 1 }, uGrav: { value: o.gravity ?? 0 } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec4 aR; uniform float uT, uT0, uLife, uSpeed, uSpread, uSize, uGrav; uniform vec3 uOrig, uDir; varying float vA;
      void main(){
        float per = uLife, age = mod(uT - uT0 - aR.x * per, per);
        float on = step(0.0, uT - uT0 - aR.x * per);
        vec3 side = normalize(cross(uDir, abs(uDir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), up2 = cross(uDir, side);
        vec3 v = normalize(uDir + (side * (aR.y - 0.5) + up2 * (aR.z - 0.5)) * 2.0 * uSpread) * uSpeed * (0.6 + 0.8 * aR.w);
        float dragT = (1.0 - exp(-age * 1.4)) / 1.4;
        vec3 p = uOrig + v * dragT + vec3(0.0, -0.5 * uGrav * age * age * 0.2, 0.0);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float k = age / per;
        vA = on * smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.35, 1.0, k));
        gl_PointSize = uSize * (0.4 + 2.2 * k) * 900.0 / max(-mv.z, 0.2);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uCol; uniform float uAmt; varying float vA;
      void main(){
        #include <logdepthbuf_fragment>
        vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(q)) * vA * 0.22 * uAmt;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uCol * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 6; pts.userData.noQA = true;
  return { mesh: pts, mat };
}

// ── space.astronaut ────────────────────────────────────────────────────────────────────────────────────────────────
async function buildAstronaut(item, ctx) {
  const p = cleanParams(item);
  const def = { id: p.id || 'astronaut', kit: 'astronaut', colors: p.colors || { coat: '#EEECE6', trousers: '#EEECE6', accent: p.accent || '#1E3A8A' }, build: p.build };
  const { fig } = dress(def, { seed: 11, warn: (m) => (ctx.warnings || []).push(m) });
  fig.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const M = fig.materials || {};
  // the visor: gold (default), dark or clear (the faceless head inside); always a mirror of the world's own sky
  const vk = String(p.visor || 'gold');
  if (M.visor) {
    if (vk === 'dark') { M.visor.color.setHex(0x16181c); M.visor.roughness = 0.04; M.visor.metalness = 0.9; }
    else if (vk === 'clear') { M.visor.color.setHex(0xcfd8de); M.visor.metalness = 0.1; M.visor.roughness = 0.02; M.visor.transparent = true; M.visor.opacity = 0.28; M.visor.depthWrite = false; }
    M.visor.envMapIntensity = 1.8;
  }
  const root = new THREE.Group(); root.name = 'space.astronaut';
  root.add(fig.group);
  const rig = fig.rig, B = fig.bones || rig.B, s = rig.s ?? 1, sw = rig.sw ?? 1.06;
  // overlays on the head bone, in the helmet's own frame (kits.js space_helmet centre (0, 1.66, 0.02))
  const headBind = B.head.userData.bind || new THREE.Vector3(0, 1.62 * s, 0);
  const holder = new THREE.Group(); holder.position.set(0 * sw * s - headBind.x, 1.66 * s - headBind.y, 0.02 * s - headBind.z); holder.scale.set(s * sw, s, s);
  B.head.add(holder);
  const suit = String(p.suit || 'intact'), t0 = num(p.suit_at, 0.5), sdur = Math.max(0.2, num(p.suit_dur, 2.5));
  const pxScale = ((ctx.renderer && ctx.renderer.domElement && ctx.renderer.domElement.height) || 1080) / 1080;
  const grow = (t) => sm((t - t0) / sdur);
  const fx = [];
  if (suit === 'cracked_visor' || suit === 'frost') {
    const ov = new THREE.Mesh(visorGeo(), overlayMaterial(overlayTex(suit === 'frost' ? 'frost' : 'crack', 3), suit)); ov.renderOrder = 7; ov.userData.noQA = true;
    holder.add(ov);
    fx.push((t) => { ov.material.uniforms.uGrow.value = grow(t) * 1.02; });
  }
  const suitMats = ['suit', 'pack', 'boot', 'shellw', 'glove'].map((k) => M[k]).filter(Boolean);
  const base = suitMats.map((m) => ({ m, c: m.color.clone(), e: m.emissive ? m.emissive.clone() : null, r: m.roughness }));
  if (suit === 'frost') {
    const ice = new THREE.Color(0.82, 0.9, 1.0);
    fx.push((t) => { const k = grow(t); for (const b of base) { b.m.color.copy(b.c).lerp(ice, 0.35 * k); b.m.roughness = lerp(b.r, 0.55, k); } });
  }
  if (suit === 'overheating') {
    const hot = new THREE.Color(1.0, 0.32, 0.08);
    const light = new THREE.PointLight(0xff6a2a, 0, 4, 2); light.userData.noGovern = true; root.add(light);
    fx.push((t, P0) => {
      const k = grow(t), fl = 0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1);
      for (const b of base) { if (b.m.emissive) { b.m.emissive.copy(hot).multiplyScalar(0.22 * k * fl); b.m.emissiveIntensity = 1; } b.m.color.copy(b.c).lerp(new THREE.Color(0.62, 0.36, 0.26), 0.35 * k); }
      if (M.visor) M.visor.color.setHex(vk === 'dark' ? 0x2a120a : 0xd07a3a);
      light.intensity = 1.1 * k * fl; light.position.copy(P0.chestL);
    });
    const shimmer = puffs({ count: 90, life: 1.5, speed: 0.8, spread: 0.5, size: 0.05, color: [1.0, 0.5, 0.2], t0, pxScale });
    root.add(shimmer.mesh);
    fx.push((t, P0) => { const u = shimmer.mat.uniforms; u.uT.value = t; u.uOrig.value.copy(P0.chest); u.uDir.value.set(0, 1, 0); u.uAmt.value = 0.3 * grow(t); });
  }
  if (suit === 'venting' || suit === 'cracked_visor') {
    const vent = puffs({ count: suit === 'venting' ? 1100 : 60, life: suit === 'venting' ? 1.2 : 1.0, speed: suit === 'venting' ? 3.6 : 1.4, spread: suit === 'venting' ? 0.14 : 0.3, size: suit === 'venting' ? 0.032 : 0.03, t0: suit === 'venting' ? t0 : t0 + 0.2, pxScale });
    root.add(vent.mesh);
    const from = String(p.vent_from || (suit === 'venting' ? 'pack' : 'visor'));
    fx.push((t, P0) => { const u = vent.mat.uniforms; u.uT.value = t; u.uOrig.value.copy(from === 'visor' ? P0.visor : P0.pack); u.uDir.value.copy(from === 'visor' ? P0.fwd : P0.back).add(P0.upv.clone().multiplyScalar(0.25)).normalize(); u.uAmt.value = (suit === 'venting' ? 0.55 : 0.35) * sm((t - t0) / 0.3) * (suit === 'venting' ? 1 - 0.35 * sm((t - t0 - sdur) / 3) : 1); });
  }
  // ── motion ──
  const G0 = ctx.ground && ctx.ground.height ? (x, z) => { const v = ctx.ground.height(x, z); return Number.isFinite(v) && v > -5000 ? v : null; } : () => null;
  const biome = String(ctx.e4world || (ctx.ground && ctx.ground.level === null ? '' : '')).toLowerCase();
  const grav = num(p.gravity, GRAV[biome] ?? 1.62);
  const a0 = xz(item.at), y0 = num(p.y, null);
  const hd0 = num(item.heading, 180);
  const list = (Array.isArray(p.actions) && p.actions.length ? p.actions.map((e) => ({ t: num(e.t, 0), a: String(e.action || e.a || 'stand') })) : [{ t: 0, a: String(p.action || 'stand') }])
    .map((e) => ({ ...e, a: e.a === 'idle' ? 'stand' : ACTIONS.includes(e.a) ? e.a : 'stand' })).sort((x, y) => x.t - y.t);
  const path = Array.isArray(p.path) && p.path.length >= 2 ? p.path.map((q) => [+q[0], +q[1]]) : Array.isArray(p.to) ? [a0, [+p.to[0], +p.to[1]]] : [a0, [a0[0] + Math.sin(hd0 * DEG) * 20, a0[1] - Math.cos(hd0 * DEG) * 20]];
  const segL = []; let tot = 0; for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); segL.push(l); tot += l; }
  const along = (dd) => { let d = clamp(dd, 0, tot); for (let i = 0; i < segL.length; i++) { if (d <= segL[i] || i === segL.length - 1) { const u = segL[i] ? d / segL[i] : 0, a = path[i], b = path[i + 1]; return { x: lerp(a[0], b[0], u), z: lerp(a[1], b[1], u), h: (Math.atan2(b[0] - a[0], -(b[1] - a[1])) / DEG + 360) % 360 }; } d -= segL[i]; } return { x: a0[0], z: a0[1], h: hd0 }; };
  const speed = num(p.speed, 1.3), boundS = num(p.stride, 1.5), hopH = num(p.hop, clamp(0.55 * 1.62 / Math.max(grav, 0.3), 0.08, 1.2));
  const drift = Array.isArray(p.drift) ? p.drift.map(Number) : [0.05, 0.02, -0.08];
  const tumble = num(p.tumble, 4), tAxis = new THREE.Vector3(0.3, 1, 0.5).normalize();
  // walking distance covered by t: the walk actions' own time
  const walkDist = (t) => { let d = 0; for (let i = 0; i < list.length; i++) { if (list[i].a !== 'walk') continue; const s0 = list[i].t, s1 = i + 1 < list.length ? list[i + 1].t : 1e9; if (t > s0) { const T = Math.min(t, s1) - s0; d += speed * Math.max(0, T - 0.35 * (1 - Math.exp(-T / 0.35))); } } return d; };
  const actionAt = (t) => { let i = 0; while (i + 1 < list.length && list[i + 1].t <= t) i++; return { i, cur: list[i], prev: i > 0 ? list[i - 1] : null, w: i > 0 ? sm((t - list[i].t) / 0.6) : 1 }; };
  const poseOf = (a, t) => (a === 'fall' ? P.fallen : a === 'walk' ? P.walk : P[a] || P.stand);
  const qT = new THREE.Quaternion(), P0 = { chest: new THREE.Vector3(), chestL: new THREE.Vector3(), pack: new THREE.Vector3(), visor: new THREE.Vector3(), fwd: new THREE.Vector3(), back: new THREE.Vector3(), upv: new THREE.Vector3() };
  const floatPos = (t) => [a0[0] + drift[0] * t, (y0 ?? 1.5) + drift[1] * t + 0.04 * Math.sin(t * 0.7), a0[1] + drift[2] * t];
  const update = (t) => {
    const st = actionAt(t), a = st.cur.a, pa = st.prev ? st.prev.a : a;
    let pose = blendPose(poseOf(pa, t), poseOf(a, t), st.w);
    const g = fig.group; g.rotation.set(0, 0, 0); g.quaternion.identity();
    const breathe = Math.sin(t * 1.9) * 0.012;
    pose = { ...pose, chestX: (pose.chestX ?? 0) + breathe };
    if (a === 'float' || (pa === 'float' && st.w < 1)) {
      const fp = floatPos(t), k = a === 'float' ? st.w : 1 - st.w;
      const sway = { lArmZ: (pose.lArmZ ?? 0) + 0.06 * Math.sin(t * 0.9), rArmZ: (pose.rArmZ ?? 0) - 0.05 * Math.sin(t * 0.8 + 1), lKnee: (pose.lKnee ?? 0) + 0.06 * Math.sin(t * 0.6) };
      fig._apply({ ...pose, ...sway, plant: false }, null);
      const gy = G0(fp[0], fp[2]);
      g.position.set(fp[0], Math.max(fp[1], (gy ?? -1e9) + 0.3), fp[2]);
      g.rotation.y = yawFromHeading(hd0) + tumble * DEG * t * 0.6;
      qT.setFromAxisAngle(tAxis, tumble * DEG * t * k); g.quaternion.multiply(qT);
    } else if (a === 'walk') {
      const d = walkDist(t), q = along(d), cyc = d / boundS;              // rig gait: one cycle (2 steps) per stride, phase in radians
      const gy = G0(q.x, q.z) ?? 0;
      const fr = (d / boundS) % 1, hop = hopH * Math.sin(Math.PI * fr) * clamp(d / 0.8);
      const saved = fig.stride; fig.stride = boundS;
      fig._apply({ ...pose, lean: (pose.lean ?? 0) + 0.06 * Math.sin(TAU * fr) }, { ph: cyc * TAU, k: clamp(d / 1.2, 0, 1) });
      fig.stride = saved;
      g.position.set(q.x, gy + hop, q.z); g.rotation.y = yawFromHeading(q.h);
    } else if (a === 'fall') {
      // a slow fall backward at this world's gravity: the body pivots about the heels to lying flat
      const T = t - st.cur.t, tf = Math.sqrt(2 * 1.0 / Math.max(grav, 0.2)) * 1.25, u = clamp(T / tf), ang = (Math.PI / 2) * u * u;
      fig._apply(blendPose(P.stand, P.fallen, sm(u * 1.2)), null);
      const q = along(walkDist(t)), gy = G0(q.x, q.z) ?? 0;
      g.position.set(q.x, gy + 0.12 * Math.sin(Math.PI * clamp(u * 1.4)) * (1 - u) + 0.14 * sm(u), q.z);
      g.rotation.y = yawFromHeading(list.find((e) => e.a === 'walk') ? q.h : hd0);
      g.rotateX(-ang);
    } else {
      fig._apply(pose, null);
      const q = along(walkDist(t)), gy = G0(q.x, q.z);
      const floating = gy == null;
      g.position.set(q.x, floating ? (y0 ?? 0) : gy, q.z);
      g.rotation.y = yawFromHeading(list.some((e) => e.a === 'walk') ? q.h : hd0);
    }
    fig.update(t, {});
    g.updateMatrixWorld(true);
    // emitter points for the suit effects
    B.chest.getWorldPosition(P0.chest); P0.chestL.copy(P0.chest).add(new THREE.Vector3(0, 0.1, 0));
    const gq = g.getWorldQuaternion(new THREE.Quaternion());
    P0.fwd.set(0, 0, 1).applyQuaternion(gq); P0.back.set(0, 0, -1).applyQuaternion(gq); P0.upv.set(0, 1, 0).applyQuaternion(gq);
    P0.pack.copy(P0.chest).addScaledVector(P0.back, 0.32 * s).addScaledVector(P0.upv, 0.12 * s);
    holder.getWorldPosition(P0.visor); P0.visor.addScaledVector(P0.fwd, 0.17 * s);
    for (const f of fx) f(t, P0);
  };
  update(0);
  patchAll(root, ctx);
  // camera.js: framed about the chest wherever the figure is (floating in space there is no ground to measure from)
  let track = null; const HZ = 10, T0 = -0.5, tv = new THREE.Vector3();
  const subjectAt = (t) => {
    if (!track) { track = []; const n = Math.ceil(((ctx.dur ?? 10) + 1) * HZ) + 1; for (let k = 0; k < n; k++) { update(T0 + k / HZ); B.chest.getWorldPosition(tv); track.push([tv.x, tv.y, tv.z]); } update(0); }
    const f = clamp((t - T0) * HZ, 0, track.length - 1.0001), k = Math.floor(f), u = f - k, a = track[k], b = track[Math.min(k + 1, track.length - 1)];
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  };
  return { root, radius: 0.6, height: 1.9 * s, update, anchors: { body: fig.group, feet: fig.group, head: B.head }, figure: fig, contact: false,
    subjectAt, subjectTop: 1.9, subjectCy: 1.1 };
}

// ── detail.suit_gauge ──────────────────────────────────────────────────────────────────────────────────────────────
function dialFace(label, lo, hi, unit, red) {
  const N = 512, [c, g] = canvas(N, N);
  g.fillStyle = '#101214'; g.fillRect(0, 0, N, N);
  const cx = N / 2, cy = N / 2, R = N * 0.44;
  g.fillStyle = '#16191c'; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  const a0 = 135 * DEG, a1 = 405 * DEG;
  if (red) { g.strokeStyle = '#c0321f'; g.lineWidth = 16; g.beginPath(); g.arc(cx, cy, R * 0.86, lerp(a0, a1, red[0]), lerp(a0, a1, red[1])); g.stroke(); }
  g.strokeStyle = '#e9e6dc'; g.fillStyle = '#e9e6dc';
  for (let i = 0; i <= 40; i++) { const a = lerp(a0, a1, i / 40), big = i % 5 === 0; g.lineWidth = big ? 5 : 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * (big ? 0.72 : 0.8), cy + Math.sin(a) * R * (big ? 0.72 : 0.8)); g.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9); g.stroke(); }
  g.font = font(600, 34, FAM.sans); g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) { const a = lerp(a0, a1, i / 4), v = lerp(lo, hi, i / 4); g.fillText(String(Math.round(v)), cx + Math.cos(a) * R * 0.56, cy + Math.sin(a) * R * 0.56); }
  g.font = font(700, 44, FAM.sans); g.fillText(label, cx, cy + R * 0.42);
  g.font = font(600, 28, FAM.sans); g.fillStyle = '#a9a69c'; g.fillText(unit, cx, cy + R * 0.66);
  return ctex(c);
}
async function buildGauge(item, ctx) {
  await loadFonts();
  const p = cleanParams(item), [x, z] = xz(item.at);
  const root = new THREE.Group(); root.name = 'detail.suit_gauge';
  const gy = ctx.ground && ctx.ground.height ? ctx.ground.height(x, z) : 0;
  root.position.set(x, num(p.y, (Number.isFinite(gy) && gy > -5000 ? gy : 0) + 1.0), z); root.rotation.y = yawFromHeading(num(item.heading, 180));
  const DIALS = [['O2', 0, 100, '%', [0, 0.2], p.o2 ?? [98, 12]], ['PRESS', 0, 40, 'kPa', [0, 0.25], p.pressure ?? [29.6, 29.6]], ['TEMP', -200, 500, '°C', [0.75, 1], p.temp ?? [21, 21]]];
  const W = 0.34, H = 0.13;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.045, 4, 2, 2), new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.55, metalness: 0.05 }));
  housing.position.z = -0.025; root.add(housing);
  const bezelM = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.35, metalness: 0.8 });
  const glassM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0, transmission: 0, transparent: true, opacity: 0.12, envMapIntensity: 1.4, clearcoat: 1 });
  const needleM = new THREE.MeshStandardMaterial({ color: 0xf0a020, roughness: 0.35, emissive: 0x3a1e00 });
  const needles = [];
  DIALS.forEach(([lab, lo, hi, unit, red, val], i) => {
    const cx = (i - 1) * 0.105;
    const bez = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 12, 48), bezelM); bez.position.set(cx, 0, 0.002); root.add(bez);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.043, 48), new THREE.MeshStandardMaterial({ map: dialFace(lab, lo, hi, unit, red), roughness: 0.6 })); face.position.set(cx, 0, 0.0); root.add(face);
    const nd = new THREE.Group(); nd.position.set(cx, 0, 0.004); root.add(nd);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.0032, 0.036, 0.0015), needleM); bar.position.y = 0.014; nd.add(bar);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.003, 16), bezelM); hub.rotation.x = Math.PI / 2; nd.add(hub);
    const gl = new THREE.Mesh(new THREE.CircleGeometry(0.044, 48), glassM); gl.position.set(cx, 0, 0.007); root.add(gl);
    const v = Array.isArray(val) ? val.map(Number) : [+val, +val];
    needles.push({ nd, lo, hi, v });
  });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.006, 16, 10), new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2010, emissiveIntensity: 0 }));
  lamp.position.set(W / 2 - 0.012, H / 2 - 0.014, 0.004); root.add(lamp);
  const warnAt = num(p.warn_at, null), dur = num(p.dur, ctx.dur ?? 6), tMove = [num(p.t0, 0.3), num(p.t1, Math.max(1, dur - 0.8))];
  const update = (t) => {
    const e = sm((t - tMove[0]) / Math.max(0.1, tMove[1] - tMove[0]));
    let danger = false;
    for (const n of needles) {
      const v = lerp(n.v[0], n.v[1], e), f = (v - n.lo) / (n.hi - n.lo);
      const flutter = 0.006 * Math.sin(t * 13.1 + n.lo) * Math.sin(t * 7.7) * (0.3 + e);
      n.nd.rotation.z = -lerp(-135, 135, clamp(f + flutter, -0.02, 1.02)) * DEG;
      if ((n.hi === 100 && f < 0.2) || (n.lo === -200 && f > 0.75)) danger = true;
    }
    const w = warnAt != null ? t >= warnAt : danger;
    lamp.material.emissiveIntensity = w ? (Math.sin(t * TAU * 1.6) > 0 ? 6 : 0.3) : 0;
  };
  update(0); patchAll(root, ctx);
  return { root, radius: 0.2, height: 0.15, update, anchors: {}, contact: false };
}

// ── detail.visor ───────────────────────────────────────────────────────────────────────────────────────────────────
async function buildVisor(item, ctx) {
  const p = cleanParams(item), [x, z] = xz(item.at);
  const root = new THREE.Group(); root.name = 'detail.visor';
  const gy = ctx.ground && ctx.ground.height ? ctx.ground.height(x, z) : 0;
  root.position.set(x, num(p.y, (Number.isFinite(gy) && gy > -5000 ? gy : 0) + 1.6), z); root.rotation.y = yawFromHeading(num(item.heading, 180));
  const vk = String(p.visor || 'gold');
  const vm = new THREE.MeshStandardMaterial({ color: vk === 'dark' ? 0x16181c : 0xC9A04A, roughness: 0.06, metalness: 1, envMapIntensity: 1.8, side: THREE.DoubleSide });
  const shell = new THREE.MeshStandardMaterial({ color: 0xF2F0EA, roughness: 0.38, side: THREE.DoubleSide });
  const S = 1.0;
  const vis = new THREE.Mesh(new THREE.SphereGeometry(0.168 * S, 64, 48, Math.PI / 2 - 1.0, 2.0, Math.PI * 0.18, Math.PI * 0.5), vm); root.add(vis);
  const sh = new THREE.Mesh(new THREE.SphereGeometry(0.175 * S, 64, 40, Math.PI / 2 + 0.95, TAU - 1.9, 0, Math.PI * 0.78), shell); root.add(sh);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.172 * S, 0.008, 12, 64, 2.1), shell); rim.rotation.set(0, 0, Math.PI / 2 - 1.05); rim.position.z = 0; root.add(rim);
  const state = String(p.state || 'crack');
  let ov = null;
  if (state === 'crack' || state === 'frost') { ov = new THREE.Mesh(visorGeo(0.1695 * S), overlayMaterial(overlayTex(state, num(p.seed, 3) | 0), state)); ov.renderOrder = 7; root.add(ov); }
  const fog = state === 'fog' ? new THREE.Mesh(visorGeo(0.1692 * S), new THREE.MeshBasicMaterial({ color: 0xe8ecef, transparent: true, opacity: 0, depthWrite: false })) : null;
  if (fog) root.add(fog);
  const t0 = num(p.t0, 0.4), dur = Math.max(0.2, num(p.spread, 2.5));
  const update = (t) => { const k = sm((t - t0) / dur); if (ov) ov.material.uniforms.uGrow.value = k * 1.02; if (fog) fog.material.opacity = 0.75 * k; };
  update(0); patchAll(root, ctx);
  return { root, radius: 0.2, height: 0.35, update, anchors: {}, contact: false };
}

// ── detail.thermometer ─────────────────────────────────────────────────────────────────────────────────────────────
async function buildThermo(item, ctx) {
  await loadFonts();
  const p = cleanParams(item), [x, z] = xz(item.at);
  const root = new THREE.Group(); root.name = 'detail.thermometer';
  const gy = ctx.ground && ctx.ground.height ? ctx.ground.height(x, z) : 0;
  root.position.set(x, num(p.y, (Number.isFinite(gy) && gy > -5000 ? gy : 0) + 1.0), z); root.rotation.y = yawFromHeading(num(item.heading, 180));
  const unit = String(p.unit || 'C').toUpperCase().startsWith('F') ? 'F' : 'C';
  const lo = num(p.min, unit === 'F' ? -400 : -250), hi = num(p.max, unit === 'F' ? 900 : 500);
  const val = Array.isArray(p.value) ? p.value.map(Number) : [num(p.from, 20), num(p.value, 465)];
  const L = 0.5;
  // the scale plate
  const N = 1024, [c, g] = canvas(256, N);
  g.fillStyle = '#efece3'; g.fillRect(0, 0, 256, N);
  g.strokeStyle = '#1b1c1e'; g.fillStyle = '#1b1c1e'; g.textAlign = 'right'; g.textBaseline = 'middle';
  const yOf = (v) => lerp(N * 0.9, N * 0.06, (v - lo) / (hi - lo));
  const step = (hi - lo) / 15, big = [];
  for (let v = Math.ceil(lo / 10) * 10; v <= hi; v += 10) { const yy = yOf(v), mj = Math.abs(v % 50) < 1e-6; g.lineWidth = mj ? 4 : 1.5; g.beginPath(); g.moveTo(mj ? 150 : 170, yy); g.lineTo(200, yy); g.stroke(); if (mj && Math.abs(v % 100) < 1e-6) big.push([v, yy]); }
  g.font = font(700, 40, FAM.sans);
  for (const [v, yy] of big) g.fillText(String(v), 140, yy);
  g.font = font(700, 52, FAM.sans); g.textAlign = 'center'; g.fillText('°' + unit, 128, N * 0.96);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.12, L * 1.12), new THREE.MeshStandardMaterial({ map: ctex(c), roughness: 0.7 })); plate.position.set(-0.03, 0.0, -0.012); root.add(plate);
  const glassM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 1.3 });
  const tubeH = L * 0.84;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, tubeH, 24, 1, true), glassM); tube.position.set(0.012, 0.02, 0); root.add(tube);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.018, 24, 16), new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.25, emissive: 0x200000 })); bulb.position.set(0.012, 0.02 - tubeH / 2 - 0.012, 0); root.add(bulb);
  const colM = new THREE.MeshStandardMaterial({ color: 0xc41c1c, roughness: 0.25, emissive: 0x300000 });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 1, 16), colM); root.add(col);
  const plateY = (v) => (yOf(v) / N - 0.5) * -(L * 1.12);
  const t0 = num(p.t0, 0.3), dur = Math.max(0.2, num(p.rise, 2.5));
  const update = (t) => {
    const v = lerp(val[0], val[1], sm((t - t0) / dur)) + 0.3 * Math.sin(t * 5.1);
    const yb = bulb.position.y, yt = clamp(plateY(clamp(v, lo, hi)), yb + 0.01, 0.02 + tubeH / 2);
    col.scale.y = Math.max(0.002, yt - yb); col.position.set(0.012, (yt + yb) / 2, 0);
  };
  update(0); patchAll(root, ctx);
  return { root, radius: 0.12, height: 0.6, update, anchors: {}, contact: false };
}

// ── landers and probes: the script's hardware (Venera, an Apollo-style LM, the Galileo probe) ─────────────────────
// Stylised, readable silhouettes in the house look. Every motion is a function of t.
function metalMat(color, rough = 0.45, metal = 0.6, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...o }); }
function foilTex() {
  const [c, g] = canvas(256, 256); const img = g.createImageData(256, 256), d = img.data; let s = 7; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 256 * 256; i++) { const v = 150 + R() * 105; d[i * 4] = v; d[i * 4 + 1] = v * 0.9; d[i * 4 + 2] = v * 0.55; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0); g.globalAlpha = 0.35; g.strokeStyle = '#3a2a10';
  for (let k = 0; k < 90; k++) { g.lineWidth = 0.5 + R() * 1.5; g.beginPath(); let x = R() * 256, y = R() * 256; g.moveTo(x, y); for (let j = 0; j < 5; j++) { x += (R() - 0.5) * 60; y += (R() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
  const t = ctex(c, true, true); t.repeat.set(2, 1); return t;
}
function parachute(r = 3, lines = 8, len = 5, color = 0xe8e2d6, stripe = 0xc0522a) {
  const grp = new THREE.Group();
  const geo = new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
  const col = new Float32Array(geo.attributes.position.count * 3), P = geo.attributes.position, c1 = new THREE.Color(color), c2 = new THREE.Color(stripe);
  for (let i = 0; i < P.count; i++) { const a = Math.atan2(P.getZ(i), P.getX(i)); const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12) % 2; const c = k ? c1 : c2; col.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const canopy = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  canopy.position.y = len; grp.add(canopy);
  const lm = new THREE.LineBasicMaterial({ color: 0x9a9488, transparent: true, opacity: 0.8 });
  const ringY = len + r * Math.cos(Math.PI * 0.42), ringR = r * Math.sin(Math.PI * 0.42);
  for (let i = 0; i < lines; i++) { const a = i / lines * Math.PI * 2; grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * ringR, ringY, Math.sin(a) * ringR)]), lm)); }
  grp.userData.canopy = canopy;
  return grp;
}
function buildVenera(item, ctx) {
  const p = cleanParams(item), [x, z] = xz(item.at);
  const root = new THREE.Group(); root.name = 'vehicle.venera';
  const gy = ctx.ground && ctx.ground.height ? ctx.ground.height(x, z) : 0, G0 = Number.isFinite(gy) && gy > -5000 ? gy : 0;
  const body = new THREE.Group(); root.add(body);
  const hullM = metalMat(0xc9c3b5, 0.55, 0.45), darkM = metalMat(0x34302b, 0.7, 0.3), ringM = metalMat(0x8d8577, 0.6, 0.5);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.14, 12, 40), ringM); ring.rotation.x = Math.PI / 2; ring.position.y = 0.16; body.add(ring);
  for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.14), ringM); rib.position.set(Math.cos(a) * 1.05, 0.2, Math.sin(a) * 1.05); rib.rotation.y = -a; body.add(rib); }
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const st = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), ringM); st.position.set(Math.cos(a) * 0.62, 0.55, Math.sin(a) * 0.62); st.lookAt(Math.cos(a) * 1.05, 0.16, Math.sin(a) * 1.05); st.rotateX(Math.PI / 2); body.add(st); }
  const sg = new THREE.SphereGeometry(0.82, 48, 32); const sp = sg.attributes.position.array.slice();
  const sphere = new THREE.Mesh(sg, hullM); sphere.position.y = 1.08; body.add(sphere);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.2, 0.06, 48), hullM); disc.position.y = 1.95; body.add(disc);
  const discRim = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.035, 8, 48), darkM); discRim.rotation.x = Math.PI / 2; discRim.position.y = 1.95; body.add(discRim);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.62, 16, 6, true), darkM); ant.position.y = 2.3; body.add(ant);
  for (const sd of [1, -1]) { const port = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.18, 16), darkM); port.rotation.z = Math.PI / 2; port.position.set(sd * 0.8, 1.2, 0.12); body.add(port); }
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.0), ringM); arm.position.set(0.3, 0.55, 1.05); arm.rotation.x = 0.5; body.add(arm);
  const chute = p.parachute ? parachute(3.2, 10, 6.5) : null; if (chute) { chute.position.y = 2.0; body.add(chute); }
  // descent + crush: from `from` m above the ground, landing at land_at s; crush_at s dents and then collapses the hull
  const from = num(p.from, 0), landAt = num(p.land_at, 6), crushAt = num(p.crush_at, null), dur = num(p.crush_dur, 1.6);
  const dents = []; let ss = 99; const R = () => (ss = (ss * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9; i++) { const u = R() * 2 - 1, a = R() * Math.PI * 2; dents.push([Math.sqrt(1 - u * u) * Math.cos(a), u, Math.sqrt(1 - u * u) * Math.sin(a), 0.35 + R() * 0.3, R() * 0.5]); }
  const P = sg.attributes.position;
  const update = (t) => {
    const u = from > 0 ? clamp(t / Math.max(0.1, landAt)) : 1;
    const yb = G0 + from * (1 - sm(u)) + (from > 0 ? from * 0.12 * (1 - u) : 0);
    root.position.set(x, yb, z);
    body.rotation.z = from > 0 ? 0.05 * Math.sin(t * 1.3) * (1 - u) : 0;
    if (chute) { chute.visible = u < 1 || from === 0; chute.userData.canopy.scale.setScalar(1 + 0.03 * Math.sin(t * 2.1)); }
    if (crushAt != null) {
      const k = clamp((t - crushAt) / dur), col = k > 0.7 ? sm((k - 0.7) / 0.3) : 0;
      for (let i = 0; i < P.count; i++) {
        const ox = sp[i * 3], oy = sp[i * 3 + 1], oz = sp[i * 3 + 2], l = Math.hypot(ox, oy, oz) || 1;
        let dent = 0;
        for (const d of dents) { const c = (ox * d[0] + oy * d[1] + oz * d[2]) / l; dent += Math.max(0, (c - (1 - d[3])) / d[3]) ** 2 * sm((k - d[4] * 0.5) / 0.5) * 0.28; }
        const f = 1 - Math.min(0.55, dent) - col * 0.45 * (0.6 + 0.4 * Math.abs(oy / l));
        P.setXYZ(i, ox * f, oy * f * (1 - col * 0.25), oz * f);
      }
      P.needsUpdate = true; sg.computeVertexNormals();
    }
  };
  update(0); patchAll(root, ctx); root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, radius: 1.3, height: 2.6, update, anchors: { body }, contact: false };
}
function buildApolloLM(item, ctx) {
  const p = cleanParams(item), [x, z] = xz(item.at);
  const root = new THREE.Group(); root.name = 'vehicle.lander_apollo';
  const gy = ctx.ground && ctx.ground.height ? ctx.ground.height(x, z) : 0, G0 = Number.isFinite(gy) && gy > -5000 ? gy : 0;
  const body = new THREE.Group(); root.add(body); body.rotation.y = yawFromHeading(num(item.heading, 180));
  const foil = new THREE.MeshStandardMaterial({ map: foilTex(), color: 0xffffff, roughness: 0.32, metalness: 0.85 });
  const grey = metalMat(0xb9b8b2, 0.5, 0.55), dark = metalMat(0x1c1d20, 0.35, 0.3), black = metalMat(0x0c0c0e, 0.25, 0.2);
  const desc = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.6, 8), foil); desc.rotation.y = Math.PI / 8; desc.position.y = 1.9; body.add(desc);
  const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 0.8, 24, 1, true), dark); noz.position.y = 0.95; body.add(noz);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, cx = Math.cos(a), cz = Math.sin(a);
    const legTop = new THREE.Vector3(cx * 1.9, 2.3, cz * 1.9), foot = new THREE.Vector3(cx * 3.9, 0.12, cz * 3.9);
    const strut = (a0, b0, r) => { const d = b0.clone().sub(a0); const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), grey); m.position.copy(a0).add(b0).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); body.add(m); };
    strut(legTop, foot, 0.08); strut(new THREE.Vector3(cx * 2.0, 1.2, cz * 2.0), foot.clone().lerp(legTop, 0.35), 0.05);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.38, 0.12, 20), grey); pad.position.copy(foot).setY(0.06); body.add(pad);
  }
  const asc = new THREE.Mesh(new THREE.DodecahedronGeometry(1.7, 0), grey); asc.scale.set(1.15, 0.85, 1.0); asc.position.y = 3.75; body.add(asc);
  for (const sd of [-1, 1]) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.34, 3), black); w.position.set(sd * 0.55, 4.0, 1.46); w.rotation.set(-0.35, sd * 0.3, sd > 0 ? Math.PI : 0); body.add(w); }
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.1), grey); hatch.position.set(0, 3.3, 1.55); body.add(hatch);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), grey); mast.position.set(-0.9, 5.0, -0.4); mast.rotation.z = 0.5; body.add(mast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), grey); dish.position.set(-1.35, 5.55, -0.4); dish.rotation.z = 1.1; body.add(dish);
  // landing / take-off: from m above the ground, landing at land_at s; the engine plume while it moves
  const from = num(p.from, 0), landAt = num(p.land_at, 6);
  const pg = new THREE.ConeGeometry(0.8, 4.5, 24, 8, true), pc = new Float32Array(pg.attributes.position.count * 3);
  for (let i = 0; i < pg.attributes.position.count; i++) { const k = Math.max(0, Math.min(1, pg.attributes.position.getY(i) / 4.5 + 0.5)); pc.set([k * k, k * k * 0.85, k * k * 0.6], i * 3); }   // bright at the nozzle, gone at the tip
  pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
  const plume = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  plume.rotation.x = Math.PI; plume.position.y = -1.6; plume.visible = from > 0; noz.add(plume);
  const update = (t) => { const u = from > 0 ? clamp(t / Math.max(0.1, landAt)) : 1; root.position.set(x, G0 + from * (1 - sm(u)), z); plume.visible = from > 0 && u < 0.999; plume.material.opacity = 0.3 + 0.08 * Math.sin(t * 37); };
  update(0); patchAll(root, ctx); root.traverse((o) => { if (o.isMesh && o !== plume) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, radius: 4.2, height: 6, update, anchors: { body }, contact: false };
}
function buildGalileo(item, ctx) {
  const p = cleanParams(item), [x, z] = xz(item.at);
  const root = new THREE.Group(); root.name = 'space.galileo_probe';
  const y0 = num(p.y, 0), rate = num(p.fall, 0);
  const body = new THREE.Group(); root.add(body);
  const shieldM = metalMat(0x2a1d15, 0.8, 0.1), aftM = metalMat(0xd8d2c6, 0.45, 0.5), foil = new THREE.MeshStandardMaterial({ map: foilTex(), roughness: 0.3, metalness: 0.85 });
  const shield = new THREE.Group(); body.add(shield);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.63, 0.45, 48, 1, true), shieldM); cone.rotation.x = Math.PI; cone.position.y = -0.22; shield.add(cone);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), shieldM); nose.position.y = -0.4; shield.add(nose);
  const aft = new THREE.Mesh(new THREE.SphereGeometry(0.64, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.32), aftM); aft.scale.y = 0.55; aft.position.y = -0.02; shield.add(aft);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.75, 32, 16), new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); glow.position.y = -0.35; glow.scale.set(1, 0.6, 1); shield.add(glow);
  const mod = new THREE.Group(); body.add(mod);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.36, 0.42, 32), foil); mod.add(drum);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 32), aftM); lid.position.y = 0.23; mod.add(lid);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3020 })); lamp.position.set(0.2, 0.27, 0.1); mod.add(lamp);
  const chute = parachute(1.6, 8, 3.2); chute.position.y = 0.25; chute.visible = false; mod.add(chute);
  const shieldOff = num(p.shield_off, null), chuteAt = num(p.chute_at, shieldOff != null ? shieldOff + 0.4 : null), lost = num(p.signal_lost, null), meltAt = num(p.melt_at, null), entry = !!p.entry;
  const update = (t) => {
    const k = rate ? t : 0;
    root.position.set(x, y0 - rate * k, z);
    body.rotation.z = 0.08 * Math.sin(t * 0.9); body.rotation.x = 0.06 * Math.sin(t * 0.7 + 1);
    // entry: the shield glows white-orange, then cools
    glow.material.opacity = entry ? 0.85 * (shieldOff != null ? 1 - clamp((t - (shieldOff - 1.5)) / 1.5) : 1) : 0;
    const off = shieldOff != null && t > shieldOff ? t - shieldOff : -1;
    if (off >= 0) { shield.position.set(0.1 * off, -2.2 * off * off - 0.5 * off, 0); shield.rotation.x = off * 1.1; shield.visible = off < 6; }
    else { shield.position.set(0, 0, 0); shield.rotation.x = 0; shield.visible = true; }
    const ch = chuteAt != null && t > chuteAt ? sm((t - chuteAt) / 0.6) : 0;
    chute.visible = ch > 0.01; chute.scale.set(0.3 + 0.7 * ch, ch, 0.3 + 0.7 * ch);
    lamp.visible = (lost == null || t < lost) && (t % 1.0) < 0.18;
    if (meltAt != null && t > meltAt) {
      const m = clamp((t - meltAt) / 3.0);
      drum.material.emissive = drum.material.emissive || new THREE.Color(); drum.material.emissive.setRGB(1.0 * m, 0.35 * m, 0.08 * m); drum.material.emissiveIntensity = 1.2;
      mod.scale.set(1 + 0.15 * m, 1 - 0.35 * sm(m), 1 + 0.15 * m); mod.visible = m < 0.98;
    }
  };
  update(0); patchAll(root, ctx);
  // camera.js: framed about the probe itself (in a cloud world there is no ground to measure from)
  return { root, radius: 0.8, height: 1.2, update, anchors: { body }, contact: false, subjectAt: (t) => [x, y0 - rate * t, z], subjectTop: 1.2, subjectCy: 0 };
}

// ── catalog + build ────────────────────────────────────────────────────────────────────────────────────────────────
export const CATALOG = {
  'space.astronaut': { desc: 'ONE hero astronaut (YOU in a white suit, the faceless house mannequin): visor gold|dark|clear; suit intact|cracked_visor (a crack spreads from an impact, a thin leak)|frost (frost creeps over the visor from the rim, the suit ices, vapour)|overheating (the suit glows orange, heat shimmer, an orange light on the ground)|venting (a gas plume jets from the backpack; vent_from visor) from suit_at over suit_dur; actions float (zero-g drift + slow tumble: y, drift [vx, vy, vz] m/s, tumble deg/s) | walk (low-gravity bounding along path/to at speed, hop height from the world\'s gravity) | stand | kneel | reach | look_up | fall (a slow fall backward at the world\'s gravity); actions: [{t, action}] eased 0.6 s. Put it in `groups` for the figure camera rules (clear to 1.2 m; 0.6 m with camera.limits macro: visor close-ups) or in `objects`. A crowd of astronauts: figure.astronaut', actions: ACTIONS, params: { visor: 'gold', suit: 'intact', suit_at: 0.5, suit_dur: 2.5, action: 'stand', actions: '[{t, action}]', path: '[[x, z], ...]', to: '[x, z]', speed: 1.3, y: 'm (float)', drift: '[vx, vy, vz] m/s', tumble: 4, gravity: 'm/s2 (default from the biome)', heading: 180 }, footprint: [0.8, 0.6], height: 1.9, tags: ['figure', 'space', 'astronaut', 'you'] },
  'detail.suit_gauge': { desc: 'insert: a spacesuit gauge panel with three dials O2 (%), PRESS (kPa), TEMP (°C); needles ease from..to over t0..t1 with a live flutter, a red lamp blinks when a value is in the red (or from warn_at). o2 / pressure / temp: value or [from, to]. ~0.34 m wide: macro keys (limits macro) 0.3-0.5 m away', actions: ['idle'], params: { o2: '[98, 12]', pressure: '[29.6, 29.6]', temp: '[21, 21]', t0: 0.3, t1: 'dur - 0.8', warn_at: 's (optional)', y: 1.0, heading: 180 }, footprint: [0.4, 0.1], height: 0.15, tags: ['detail', 'insert', 'space'] },
  'detail.visor': { desc: 'insert: a helmet visor in close-up (gold or dark mirror, the white shell round it) with state crack (a crack spreads from an impact point) | frost (frost creeps in from the rim) | fog | clear, starting at t0 over spread s. Reflects the world\'s sky', actions: ['idle'], params: { visor: 'gold', state: 'crack', t0: 0.4, spread: 2.5, y: 1.6, heading: 180 }, footprint: [0.4, 0.4], height: 0.35, tags: ['detail', 'insert', 'space'] },
  'vehicle.venera': { desc: 'a Venera-style lander (Venus): the crushable landing ring, the white pressure sphere with camera ports, the airbrake disc and the helix antenna on top (~2.6 m). from: m above the ground to descend (lands at land_at s); parachute: true; crush_at: s -> the hull dimples then buckles inward (crush_dur s). A dark silhouette in the Venus murk', actions: ['idle', 'land', 'crush'], params: { from: 0, land_at: 6, parachute: false, crush_at: 'null (s)', crush_dur: 1.6 }, footprint: [2.4, 2.4], height: 2.6, snap: false, tags: ['vehicle', 'lander', 'space', 'venus'] },
  'vehicle.lander_apollo': { desc: 'an Apollo-style lunar module: gold-foil descent stage on four legs with footpads, the faceted grey ascent stage with its black windows, hatch and antenna dish (~6.5 m). from: m above the ground to land (land_at s) with an engine plume; also the "PICKUP" lander', actions: ['idle', 'land'], params: { from: 0, land_at: 6, heading: 180 }, footprint: [8, 8], height: 6.5, snap: false, tags: ['vehicle', 'lander', 'space', 'moon'] },
  'space.galileo_probe': { desc: 'the Galileo atmospheric probe (Jupiter 1995): the brown conical heat shield + white aft cover; entry: true = the shield glows; shield_off s: the heat shield drops away, chute_at s: the parachute opens over the foil-wrapped descent module, a transmitter lamp blinks every second until signal_lost s; melt_at s: it glows, sags and is gone. y: height, fall: m/s', actions: ['idle', 'fall'], params: { y: 0, fall: 0, entry: false, shield_off: 'null (s)', chute_at: 'shield_off + 0.4', signal_lost: 'null (s)', melt_at: 'null (s)' }, footprint: [1.3, 1.3], height: 1.2, tags: ['space', 'probe', 'jupiter'] },
  'detail.thermometer': { desc: 'insert: a glass thermometer on a printed scale; the red column rises from `from` to `value` (°C, or unit F) over rise s from t0; value may be [from, to]. min/max set the scale (default -250..500 °C: Pluto -230, Venus 465)', actions: ['idle'], params: { value: 465, from: 20, unit: 'C', min: -250, max: 500, t0: 0.3, rise: 2.5, y: 1.0, heading: 180 }, footprint: [0.15, 0.1], height: 0.6, tags: ['detail', 'insert'] },
};
export async function build(kind, item = {}, ctx = {}) {
  if (kind === 'space.astronaut') return buildAstronaut(item, ctx);
  if (kind === 'detail.suit_gauge') return buildGauge(item, ctx);
  if (kind === 'detail.visor') return buildVisor(item, ctx);
  if (kind === 'detail.thermometer') return buildThermo(item, ctx);
  if (kind === 'vehicle.venera') return buildVenera(item, ctx);
  if (kind === 'vehicle.lander_apollo') return buildApolloLM(item, ctx);
  if (kind === 'space.galileo_probe') return buildGalileo(item, ctx);
  throw new Error('astronaut.js: unknown kind ' + kind);
}
