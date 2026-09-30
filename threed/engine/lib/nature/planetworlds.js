// planetworlds.js — E4 (v2, 27 Sep 2026): standing on other worlds. biome.venus, biome.mercury, biome.pluto, biome.titan.
// The ground is world.js's terrain (a private biome definition injected into BIOMES: craters for Mercury, basalt flows
// with Maat Mons lost in the murk for Venus, nitrogen-ice ridges for Pluto, dunes for Titan); this module adds what
// makes each world unmistakable and replaces the look's Earth light every sub-frame (spacefx.js overrideLights):
//   venus    92 bar: dense orange air (short visibility), a diffuse orange light with no sun disc, soft shadows, a
//            slowly churning cloud deck overhead, drifting haze veils with a rising heat shimmer near the ground
//   mercury  no air: a black sky with stars even by day, the Sun ~2.5x its size seen from Earth and blinding,
//            pitch-black shadows; world.side day | terminator (knife-edge: the Sun on the horizon) | night
//   pluto    a black sky, the Sun a tiny blinding star, cold dim light, layered blue haze on the horizon, Charon hanging
//            in the sky (world.charon false to hide), nitrogen-ice plains with blocky ridges
//   titan    an orange haze sky, dim diffuse light, dark hydrocarbon dunes, Saturn a faint smudge
import * as THREE from 'three';
import { U, dirFromAzEl } from '../shared/env.js';
import { clamp } from '../shared/util.js';
import { BIOMES } from './biomes.js';
import { buildWorld as buildTerrain } from './world.js';
import { spaceState, sunFromSpec, planOf } from './planets.js';
import { skyDome, overrideLights, bakeEnv, hazeVeils, dustMotes } from './spacefx.js';

const same = (c) => ({ spring: [c, c, c], summer: [c, c, c], autumn: [c, c, c], winter: [c, c, c] });
// private terrain definitions (not in world.js's catalog: that was built before this module is imported)
const DEFS = {
  e4_venus: { shape: 'volcanic', relief: 0.32, soil: ['#443a33', '#524539'], grass: same('#4a3f36'), rock: '#352e29', lush: 0, rockSlope: 0.3, snow: 0, lava: 0, sandy: 0,
    flora: [['boulder', 0.7, 'any'], ['rock', 4, 'any']], forest: 0, sky: 'e4', mood: { haze: 0, fog: 0 } },
  e4_mercury: { shape: 'moon', relief: 0.6, soil: ['#56524d', '#67625c'], grass: same('#5e5a55'), rock: '#4f4b47', lush: 0, rockSlope: 0.6, snow: 0,
    flora: [['boulder', 0.35, 'any'], ['rock', 3, 'any']], forest: 0, sky: 'e4', mood: { haze: 0, fog: 0 } },
  e4_pluto: { shape: 'ice', relief: 0.85, soil: ['#b9aa98', '#cbbfae'], grass: same('#c4b8a8'), rock: '#7d6c5e', lush: 0, rockSlope: 0.5, snow: 0.92, snowLine: -2e4, forceSeason: 'winter', ice: 0,
    flora: [['boulder', 0.5, 'any'], ['rock', 1.5, 'any']], forest: 0, sky: 'e4', mood: { haze: 0, fog: 0 } },
  e4_titan: { shape: 'dunes', relief: 0.55, soil: ['#4c3c2a', '#5a4632'], grass: same('#534230'), rock: '#403428', sand: ['#4f3e2c', '#5e4a34'], sandy: 1, lush: 0, rockSlope: 0.75, snow: 0,
    flora: [['rock', 0.25, 'any']], forest: 0, sky: 'e4', mood: { haze: 0, fog: 0 } },
};
for (const [k, v] of Object.entries(DEFS)) if (!BIOMES[k]) BIOMES[k] = v;

const WORLDS = {
  venus: { def: 'e4_venus', hint: 'space_venus', desc: 'the surface of Venus: 92 bar, 465 C: dense orange murk (visibility ~2 km), a diffuse orange light with the Sun hidden behind the cloud deck, flat basalt plates and rocks, drifting haze veils with a rising heat shimmer. world.murk 0.5..2 (visibility), world.shimmer 0..2' },
  mercury: { def: 'e4_mercury', hint: 'space_mercury', desc: 'the surface of Mercury: an airless cratered grey-brown plain, a black sky with stars even by day, the Sun ~2.5x bigger than from Earth and blinding, pitch-black shadows. world.side day (default) | terminator (the Sun on the horizon: knife-edge shadows) | night (starlight only); world.sun {az, el} overrides' },
  pluto: { def: 'e4_pluto', hint: 'space_pluto', desc: 'the surface of Pluto: nitrogen-ice plains with blocky ridges, a black sky, the Sun a tiny blinding star, a cold dim light, thin layered blue haze on the horizon, Charon hanging in the sky (world.charon false; charon_az / charon_el deg)' },
  titan: { def: 'e4_titan', hint: 'space_titan', desc: 'the surface of Titan: dark hydrocarbon dunes under a thick orange haze, a dim diffuse light (1 % of Earth\'s), the Sun a faint smudge. world.murk 0.5..2' },
};
export const CATALOG = {};
for (const [k, w] of Object.entries(WORLDS)) CATALOG['biome.' + k] = { desc: w.desc, section: 'world', biome: k, world: true, actions: [], params: { relief: DEFS[w.def].relief, seed: 1 }, footprint: [0, 0], height: 0, tags: ['biome', 'space', 'planet'] };
export async function build() { return { root: new THREE.Group(), radius: 0, height: 0, update() {}, anchors: {} }; }

const DEGR = 180 / Math.PI;
const sm = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

// Venus: flat slabby rock plates round the stage (the Venera panoramas), dark, a little tilted, lying on the ground
function venusPlates(G, seed, amount, ctx) {
  const n = Math.round(420 * amount); let s = (seed | 0) * 7919 + 17; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const shape = new THREE.Shape(); const K = 7;
  for (let i = 0; i < K; i++) { const a = i / K * Math.PI * 2, r = 0.8 + 0.35 * Math.sin(i * 2.7 + 1.3); const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) shape.lineTo(x, y); else shape.moveTo(x, y); }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.05, bevelSegments: 1 });
  geo.rotateX(-Math.PI / 2); geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3b332d, roughness: 0.93, metalness: 0 });
  const im = new THREE.InstancedMesh(geo, (ctx.patch || ((m) => m))(mat) || mat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, r = 3 + Math.pow(R(), 0.7) * 90, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 0.4 + Math.pow(R(), 2.2) * 2.6;
    e.set((R() - 0.5) * 0.12, R() * Math.PI * 2, (R() - 0.5) * 0.12); q.setFromEuler(e);
    p.set(x, G(x, z) - 0.05, z); sc.set(w * (0.7 + 0.6 * R()), 0.6 + 0.8 * R(), w * (0.7 + 0.6 * R()));
    m4.compose(p, q, sc); im.setMatrixAt(i, m4);
  }
  im.castShadow = im.receiveShadow = true; im.frustumCulled = false; im.name = 'e4.venus_plates';
  return { mesh: im, update() {} };
}
// Venus: seeded flashes inside the cloud deck overhead (a glow in the sky, the light on the ground flickering up)
function venusLightning(world, sky) {
  const k = +(world.lightning ?? 0.6); if (!(k > 0)) return null;
  let s = (world.seed ?? 5) * 9301 + 49297; const R = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const ev = []; for (let t = 1.2 + R() * 2; t < 90; t += (2.5 + R() * 4) / k) ev.push({ t, az: R() * Math.PI * 2, el: 0.25 + R() * 0.6, n: 2 + Math.floor(R() * 2), k: 0.6 + R() * 0.5 });
  return (t) => {
    let f = 0, dir = null;
    for (const e of ev) { const d = t - e.t; if (d < 0 || d > 0.7) continue; let g = 0; for (let j = 0; j < e.n; j++) { const tj = d - j * 0.14; if (tj >= 0) g = Math.max(g, Math.min(1, tj / 0.03) * Math.exp(-Math.max(0, tj - 0.03) / 0.08)); } g *= e.k; if (g > f) { f = g; dir = e; } }
    sky.u.uFlash.value = f;
    if (dir) sky.u.uFlashDir.value.set(Math.sin(dir.az) * Math.cos(dir.el), Math.sin(dir.el), -Math.cos(dir.az) * Math.cos(dir.el));
    return f;
  };
}

export async function buildWorld(world = {}, look = {}, ctx = {}) {
  const name = String(world.biome || world.kind || '').replace(/^(biome|world)\./, '');
  const cfg = WORLDS[name] || WORLDS.mercury;
  // Titan: liquid methane lakes (world.lakes false: none; world.features: your own)
  const feats = name === 'titan' && world.lakes !== false && !Array.isArray(world.features) ? [{ type: 'lake', at: Array.isArray(world.lake_at) ? world.lake_at : [150, -260], radius: +(world.lake_radius ?? 170) }] : world.features;
  const W = await buildTerrain({ ...world, biome: cfg.def, ...(feats ? { features: feats } : {}) }, look, ctx);
  if (name === 'titan' && W.water && W.water.uniforms && W.water.uniforms.uDeep) {                       // dark, glassy methane
    W.water.uniforms.uDeep.value.setRGB(0.012, 0.007, 0.003); W.water.uniforms.uShallow.value.setRGB(0.07, 0.042, 0.016);
    if (W.water.uniforms.uAmb) W.water.uniforms.uAmb.value.setRGB(0.3, 0.19, 0.08);
  }
  const root = W.root || ctx.scene;
  const st = spaceState(ctx);
  ctx.e4world = name;
  const ws = sunFromSpec(world.sun); if (ws) st.setExplicit(ws);
  const G = (x, z) => W.ground.height(x, z);
  let sky, extra = [], lights, sunEl = null, env = null, baked = false, lightning = null;
  if (name === 'venus') {
    const murk = clamp(+(world.murk ?? 1), 0.3, 3);
    sky = skyDome({ uSun: st.uSun, zen: [0.3, 0.13, 0.035], hor: [0.62, 0.3, 0.085], horSun: [0.72, 0.37, 0.11], sunR: 0, sunI: 0, glare: 0.3, glareW: 0.05, murk: 1.2, shimmer: +(world.shimmer ?? 1) });
    extra.push(venusPlates(G, world.seed ?? 5, +(world.plates ?? 1), ctx)); root.add(extra[extra.length - 1].mesh);
    lightning = venusLightning(world, sky);
    const veils = hazeVeils({ color: [0.95, 0.5, 0.16], amount: 1.2 * murk, shimmer: +(world.shimmer ?? 1), ground: G, seed: world.seed ?? 5 });
    extra.push(veils); root.add(veils.mesh);
    lights = () => ({ key: [1.0, 0.52, 0.2], keyI: 0.8, soft: 16, hemi: [1.05, 0.52, 0.17], gnd: [0.3, 0.12, 0.04], hemiI: 1.6, exposure: 1.05,
      sunColor: [1.0, 0.55, 0.2], fog: [0.62, 0.3, 0.085], fogSun: [0.1, 0.05, 0.015], fogDensity: 0.008 * murk, fogFalloff: 0.00035, envI: 0.9 });
  } else if (name === 'titan') {
    const murk = clamp(+(world.murk ?? 1), 0.3, 3);
    sky = skyDome({ uSun: st.uSun, zen: [0.13, 0.07, 0.025], hor: [0.3, 0.17, 0.06], horSun: [0.36, 0.21, 0.08], sunR: 0.8, sunI: 0.3, glare: 0.2, glareW: 0.15, murk: 0.8, disc: [1.0, 0.8, 0.55] });
    const veils = hazeVeils({ color: [0.7, 0.45, 0.2], amount: 0.6 * murk, shimmer: 0, ground: G, seed: world.seed ?? 9 });
    extra.push(veils); root.add(veils.mesh);
    lights = () => ({ key: [1.0, 0.72, 0.42], keyI: 0.4, soft: 14, hemi: [0.7, 0.45, 0.22], gnd: [0.16, 0.1, 0.05], hemiI: 1.2, exposure: 1.1,
      sunColor: [1.0, 0.7, 0.4], fog: [0.3, 0.17, 0.06], fogSun: [0.15, 0.09, 0.03], fogDensity: 0.0035 * murk, fogFalloff: 0.0004, envI: 0.8 });
  } else if (name === 'pluto') {
    sky = skyDome({ uSun: st.uSun, zen: [0, 0, 0], hor: [0.003, 0.005, 0.01], sunR: 0.02, sunI: 60, glare: 0.9, glareW: 1, stars: 1.25, haze: 0.3, hazeCol: [0.3, 0.46, 0.88] });
    if (world.charon !== false) {
      const az = +(world.charon_az ?? 150), el = +(world.charon_el ?? 22);
      sky.u.uBody.value.copy(dirFromAzEl(az, el, new THREE.Vector3())); sky.u.uBodyR.value = 1.9 * Math.PI / 180; sky.u.uBodyCol.value.setRGB(0.4, 0.38, 0.36);
    }
    sunEl = 22;
    lights = () => ({ key: [0.95, 0.93, 0.9], keyI: 1.05, soft: 1.5, hemi: [0.02, 0.03, 0.06], gnd: [0.01, 0.01, 0.012], hemiI: 1, exposure: 1.0,
      sunColor: [1, 0.97, 0.92], fog: [0.02, 0.035, 0.08], fogSun: [0.05, 0.08, 0.18], fogDensity: 0.00004, fogFalloff: 0.001, envI: 0.4 });
  } else {
    // Mercury: day, terminator or night
    const side = String(world.side || 'day');
    sunEl = side === 'terminator' ? 1.6 : side === 'night' ? -25 : 38;
    const night = side === 'night';
    sky = skyDome({ uSun: st.uSun, zen: [0, 0, 0], hor: [0, 0, 0], sunR: 0.7, sunI: 70, glare: night ? 0 : 1.4, glareW: 1, stars: night ? 1.4 : 1.0, disc: [1, 0.98, 0.95] });
    lights = () => ({ key: night ? [0, 0, 0] : [1, 0.98, 0.95], keyI: night ? 0 : side === 'terminator' ? 6 : 2.6, soft: 1.2, hemi: night ? [0.05, 0.06, 0.09] : [0.012, 0.012, 0.013], gnd: night ? [0.01, 0.01, 0.012] : [0.05, 0.047, 0.043], hemiI: 1,
      exposure: night ? 2.2 : 0.95, sunColor: [1, 0.98, 0.95], fog: [0, 0, 0], fogDensity: 0, envI: 0.25 });
  }
  root.add(sky.mesh);
  // the Sun: an explicit world.sun / look.sun wins; else the look's azimuth at this world's elevation
  const lsun = look && look.sun && Number.isFinite(+look.sun.az);
  const update0 = W.update;
  W.update = (t, clock, camera) => {
    if (update0) update0(t, clock, camera);
    const ready = !!planOf(ctx);
    if (ready && !st.explicit && sunEl != null && !lsun) {
      const d = U.uSunDir.value, az = Math.atan2(d.x, -d.z) * DEGR;
      st.setExplicit(dirFromAzEl(az, sunEl, new THREE.Vector3()));
    }
    st.resolve();
    sky.u.uTime.value = t;
    for (const e of extra) e.update(t, camera);
    if (ready && !baked) { env = bakeEnv(ctx, sky.mat); baked = true; }
    const L = st.uSun.value, o = lights();
    o.dir = L; if (baked) o.env = env;
    if (lightning) { const f = lightning(t); if (f > 0) { o.hemiI *= 1 + 1.6 * f; o.keyI *= 1 + 0.8 * f; } }
    overrideLights(ctx, o);
  };
  if (lightning) W.flashAt = (t) => lightning(t);                                       // render.py: a designed flash is not a jump
  W.hints = { ...(W.hints || {}), sky: cfg.hint, fog: 0, haze: 0, biome: name };
  W.biome = name;
  return W;
}
