// f_wildfire.js — (D2b) fx.wildfire: a fire front advancing through a conifer forest.
//   the flame sheet (surface fire along a wavy front line), crown fire in the trees it reaches (canopies glow, flare,
//   then stand as black skeletons), smoke (a low wall + convective columns leaning downwind, lit orange from below),
//   an ember storm blown ahead of the front, and the charred black ground behind it (a glowing ember bed at the line,
//   smouldering spots cooling off). Optional refuges ("where to hide"): a pond, a creek, a ploughed field — the fire
//   has no fuel there and burns around them — and the burned "black" behind the front.
// Local frame: u = metres forward (the direction the fire travels = the item's heading), v = metres to the right.
// Every state is a function of t: tree i ignites at tb = (u_i - start - wob(v_i)) / speed.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEG, clamp, lerp, sstep, hf, vn, fbm1, makePuffs, terrainGrid, frame, syncEnv, stdMat, FXU } from './f_common.js';
import { U as EU, FOG_GLSL } from '../shared/env.js';
import { makeFire, makeGlowStreaks } from './glowkit.js';

export const CATALOG = {
  'fx.wildfire': {
    desc: 'forest fire front advancing through a conifer forest (heading = direction of travel): flame sheet, crown fire, smoke columns lit by the fire, ember storm, charred black ground behind; hide: ["pond","creek","field","black"] lays out places to survive it',
    actions: ['burn'],
    params: { speed: 1.4, intensity: 0.85, width: 360, depth: 320, start: -8, density: 0.035, hide: [], smoke: 1, embers: 1, pond: [6, -42, 20], field: [-4, 70, 30, 34], creek: 44, black: null },
    doc: {
      speed: 'm/s rate of spread (0.3 creeping .. 3 wind-driven crown fire)', intensity: '0..1 flame height, crown share, glow',
      width: 'm of front', depth: 'm of forest along the heading', start: 'm: front position at t = 0 along the heading, relative to at',
      density: 'trees per m2', hide: 'list of pond, creek, field, black (or "all")', smoke: '0..2', embers: '0..2',
      pond: '[u, v, r] local metres (u forward, v right)', field: '[u, v, halfU, halfV] local', creek: 'u of the creek line', black: '[u, v, r] a burned-over clearing behind the front (default [start - 38, 0, 30])',
    },
    footprint: [320, 360], height: 24, snap: false, tags: ['fx', 'fire', 'wildfire', 'forest', 'disaster', 'smoke'],
  },
};

const FIRE_RGB = [1.0, 0.46, 0.14];

export async function build(kind, item, ctx) {
  // params may sit under `params` or at the top level of the entry (both work)
  const p = { ...(item.params || {}) };
  for (const k of Object.keys(item)) if (!['kind', 'at', 'pos', 'heading', 'index', 'seed', 'params', 'requested', 'tags', 'id'].includes(k) && p[k] === undefined) p[k] = item[k];
  const G = ctx.ground;
  const at = item.at || [0, 0];
  const gy0 = G.height(at[0], at[1]);
  const root = new THREE.Group(); root.name = 'fx.wildfire';
  root.position.set(at[0], gy0, at[1]);
  const F = frame(at[0], at[1], item.heading ?? 0);
  const seed = (item.seed ?? 7) | 0;
  const I = clamp(+(p.intensity ?? 0.85), 0, 1);
  const speed = Math.max(0.05, +(p.speed ?? 1.4));
  const W = +(p.width ?? 360), D = +(p.depth ?? 320), start = +(p.start ?? -8);
  const smokeK = clamp(+(p.smoke ?? 1), 0, 2), emberK = clamp(+(p.embers ?? 1), 0, 2);
  const hideRaw = p.hide ?? [];
  const hide = new Set(hideRaw === 'all' ? ['pond', 'creek', 'field', 'black'] : (Array.isArray(hideRaw) ? hideRaw : [hideRaw]));
  const pond = hide.has('pond') ? (p.pond || [6, -42, 20]) : null;
  const field = hide.has('field') ? (p.field || [-4, 70, 30, 34]) : null;
  const creekU = hide.has('creek') ? +(p.creek ?? 44) : null;
  const black = hide.has('black') ? (Array.isArray(p.black) ? p.black : [start - 38, 0, 30]) : null;
  const creekAt = (v) => creekU + 7 * Math.sin(v * 2 * Math.PI / 150 + 1.3) + 2.5 * Math.sin(v * 2 * Math.PI / 47 + 0.4);
  // the wavy front: identical in JS and GLSL
  const ph = [hf(seed, 1) * 6.28, hf(seed, 2) * 6.28, hf(seed, 3) * 6.28];
  const WK = [2 * Math.PI / 170, 2 * Math.PI / 61, 2 * Math.PI / 23], WA = [11, 5, 2.2];
  const wob = (v) => WA[0] * Math.sin(v * WK[0] + ph[0]) + WA[1] * Math.sin(v * WK[1] + ph[1]) + WA[2] * Math.sin(v * WK[2] + ph[2]);
  const front = (t, v) => start + speed * t + wob(v);
  const fuel = (u, v, m = 0) => {
    if (Math.abs(v) > W / 2 || u > D / 2 || u < -D / 2) return 0;
    if (pond && Math.hypot(u - pond[0], v - pond[1]) < pond[2] + 3 + m) return 0;
    if (field && Math.abs(u - field[0]) < field[2] + m && Math.abs(v - field[1]) < field[3] + m) return 0;
    if (creekU != null && Math.abs(u - creekAt(v)) < 4.5 + m) return 0;
    return 1;
  };
  const toW = (u, v) => F.toWorld(u, v);
  const gAt = (x, z) => G.height(x, z);

  // ── forest ────────────────────────────────────────────────────────────────────────────────────────────────────
  const dens = +(p.density ?? 0.035), sp = 1 / Math.sqrt(dens);
  const trees = [];
  for (let a = -D / 2; a < D / 2; a += sp) for (let b = -W / 2; b < W / 2; b += sp) {
    const k = trees.length + 1;
    const u = a + (hf(k, seed + 11) - 0.5) * sp * 0.9, v = b + (hf(k, seed + 12) - 0.5) * sp * 0.9;
    if (!fuel(u, v, 3)) continue;
    if (black && Math.hypot(u - black[0], v - black[1]) < black[2] * (0.85 + 0.3 * hf(k, seed + 19))) continue;
    // an organic edge: the forest thins out over ~45 m along a noisy boundary (never a ruler line)
    const edge = Math.min(D / 2 - Math.abs(u), W / 2 - Math.abs(v)) + 22 * fbm1(u / 60 + v / 45, seed + 20) + 12 * fbm1(v / 23 - u / 31, seed + 21);
    if (edge < 45 && hf(k, seed + 13) > edge / 45) continue;
    const [x, z] = toW(u, v);
    const h = 13 + 11 * Math.pow(hf(k, seed + 14), 0.8);
    trees.push({ u, v, x, z, y: gAt(x, z), h, crown: hf(k, seed + 15) < 0.35 + 0.6 * I, tb: (u - start - wob(v)) / speed, dur: 7 + 6 * hf(k, seed + 16), k, rot: hf(k, seed + 17) * 6.28, lean: (hf(k, seed + 18) - 0.5) * 0.06 });
  }
  const NT = trees.length;
  // the world's own trees inside the burn area would stay green: remove those instances (the forest here is ours)
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _z = new THREE.Matrix4().makeScale(0, 0, 0);
  ctx.scene.updateMatrixWorld(true);
  ctx.scene.traverse((o) => {
    if (!o.isInstancedMesh || !/^nature\./.test(o.name)) return;
    let hit = 0;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, _m); _p.setFromMatrixPosition(_m).applyMatrix4(o.matrixWorld);
      const [u, v] = F.toLocal(_p.x, _p.z);
      if (Math.abs(u) < D / 2 + 6 && Math.abs(v) < W / 2 + 6) { o.setMatrixAt(i, _z); hit++; }
    }
    if (hit) { o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere && o.computeBoundingSphere(); o.computeBoundingBox && o.computeBoundingBox(); }
  });
  const cache = ctx.cache;
  let tg = cache && cache.get('fx.wildfire.treeGeo');
  if (!tg) {
    const trunk = new THREE.CylinderGeometry(0.11, 0.2, 1, 6, 1); trunk.translate(0, 0.5, 0);
    const cones = [[0.16, 0.5, 0.3], [0.13, 0.42, 0.5], [0.095, 0.34, 0.68], [0.055, 0.24, 0.84]].map(([r, h, y]) => { const c = new THREE.ConeGeometry(r, h, 7, 1); c.translate(0, y + h / 2, 0); return c; });
    const canopy = mergeGeometries(cones);
    tg = { trunk, canopy };
    tg.trunk.userData.keep = tg.canopy.userData.keep = true;
    if (cache) cache.set('fx.wildfire.treeGeo', tg);
  }
  const trunkMat = stdMat(ctx, { color: 0xffffff, roughness: 0.95 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
  canopyMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.55, 0.075, 0.01) * vGlow * 1.2;');
  };
  canopyMat.customProgramCacheKey = () => 'fx.wildfire.canopy';
  ctx.patch(canopyMat);
  const trunks = new THREE.InstancedMesh(tg.trunk, trunkMat, NT);
  const canopies = new THREE.InstancedMesh(tg.canopy, canopyMat, NT);
  const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(NT), 1); glowAttr.setUsage(THREE.DynamicDrawUsage);
  canopies.geometry = tg.canopy.clone(); canopies.geometry.setAttribute('aGlow', glowAttr);
  trunks.castShadow = canopies.castShadow = true; trunks.receiveShadow = canopies.receiveShadow = true;
  trunks.name = 'fx.wildfire.trunks'; canopies.name = 'fx.wildfire.canopies';
  root.add(trunks, canopies);
  // burnt snags: branch stubs on the charred trunk (most crowns are consumed; ~40 % keep a charred crown)
  let sg = cache && cache.get('fx.wildfire.stubGeo');
  if (!sg) {
    const parts = [];
    for (let k = 0; k < 9; k++) {
      const y = 0.3 + k * 0.072, a = k * 2.39996, L = 0.9 + 1.7 * (1 - k / 9);
      const g = new THREE.BoxGeometry(L, 0.007, 0.08); g.translate(L / 2, 0, 0); g.rotateZ(0.02 + 0.03 * (k % 3)); g.rotateY(a); g.translate(0, y, 0);
      parts.push(g);
    }
    sg = mergeGeometries(parts); sg.userData.keep = true;
    if (cache) cache.set('fx.wildfire.stubGeo', sg);
  }
  const stubs = new THREE.InstancedMesh(sg, trunkMat, NT); stubs.castShadow = true; stubs.receiveShadow = true; stubs.name = 'fx.wildfire.snags';
  root.add(stubs);
  const green = [new THREE.Color('#34522c'), new THREE.Color('#3d5e31'), new THREE.Color('#2e4a2a'), new THREE.Color('#476636')];
  const scorch = new THREE.Color('#4a2410'), char = new THREE.Color('#0f0d0c'), bark = new THREE.Color('#4a3a2c'), barkBurnt = new THREE.Color('#121010');
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), cc = new THREE.Color(), eul = new THREE.Euler();
  function treeState(tr, t) {
    const a = t - tr.tb;
    const burn = sstep(-0.4, 1.6, a);                          // scorched
    const gone = sstep(1.5, tr.dur * 0.8, a);                  // needles consumed
    const flame = tr.crown ? sstep(-0.2, 1.1, a) * (1 - sstep(tr.dur * 0.5, tr.dur, a)) : sstep(0, 1, a) * (1 - sstep(2.5, 5, a)) * 0.45;
    return { a, burn, gone, flame };
  }
  function updateTrees(t) {
    const gl = glowAttr.array;
    for (let i = 0; i < NT; i++) {
      const tr = trees[i], s = treeState(tr, t);
      eul.set(tr.lean, tr.rot, tr.lean * 0.7); q.setFromEuler(eul);
      pv.set(tr.x - root.position.x, tr.y - root.position.y - 0.3, tr.z - root.position.z);
      sc.set(1, tr.h, 1); m4.compose(pv, q, sc); trunks.setMatrixAt(i, m4);
      const keep = (tr.k % 5) < 2, gk = sstep(0.25, 1, s.gone);
      const cw = keep ? lerp(1, 0.55, s.gone) : lerp(1, 0.001, gk), ch = keep ? lerp(1, 0.86, s.gone) : lerp(1, 0.001, gk);
      sc.set(tr.h * cw, tr.h * ch, tr.h * cw); m4.compose(pv, q, sc); canopies.setMatrixAt(i, m4);
      const st = keep ? 0.001 : Math.max(0.001, sstep(0.15, 0.7, s.gone));
      sc.set(st, tr.h, st); m4.compose(pv, q, sc); stubs.setMatrixAt(i, m4);
      cc.copy(green[tr.k & 3]).lerp(scorch, s.burn * (1 - s.gone)).lerp(char, Math.max(s.gone, s.burn * 0.55));
      canopies.setColorAt(i, cc);
      cc.copy(bark).lerp(barkBurnt, s.burn); trunks.setColorAt(i, cc); stubs.setColorAt(i, cc);
      gl[i] = s.flame * (tr.crown ? 1 : 0.4) * (0.75 + 0.25 * vn(t * 3 + i, 5)) + (s.burn - s.gone) * 0.25;
    }
    trunks.instanceMatrix.needsUpdate = canopies.instanceMatrix.needsUpdate = stubs.instanceMatrix.needsUpdate = true;
    trunks.instanceColor.needsUpdate = canopies.instanceColor.needsUpdate = true; if (stubs.instanceColor) stubs.instanceColor.needsUpdate = true;
    glowAttr.needsUpdate = true;
  }

  // ── charred ground + ember bed (terrain-conforming overlay) ──────────────────────────────────────────────────
  const gw = Math.max(W, D) + 60;
  const ggeo = terrainGrid(G, at[0], at[1], gw, gw, 2.2, 0, 0.07, gy0);
  const gU = {
    uT: { value: 0 }, uStart: { value: start }, uSpeed: { value: speed }, uI: { value: I },
    uFwd: { value: new THREE.Vector2(F.fx, F.fz) }, uRight: { value: new THREE.Vector2(F.rx, F.rz) }, uC: { value: new THREE.Vector2(at[0], at[1]) },
    uWK: { value: new THREE.Vector3(...WK) }, uWA: { value: new THREE.Vector3(...WA) }, uPh: { value: new THREE.Vector3(...ph) },
    uWD: { value: new THREE.Vector2(W, D) }, uGrass: { value: (p.fuel || (dens < 0.004 ? 'grass' : 'forest')) === 'grass' ? clamp(+(p.dry ?? 1), 0, 1) : 0 }, uGK: { value: clamp(+(p.glow_k ?? 1), 0.2, 3) },
    uPond: { value: new THREE.Vector3(...(pond || [0, 0, -100])) }, uField: { value: new THREE.Vector4(...(field || [0, 0, -1, -1])) }, uCreek: { value: creekU ?? -1e5 },
  };
  const gmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  gmat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, gU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFxW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFxW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vFxW; uniform float uT, uStart, uSpeed, uI, uCreek, uGrass, uGK; uniform vec2 uFwd, uRight, uC, uWD; uniform vec3 uWK, uWA, uPh, uPond; uniform vec4 uField;
float fxh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float fxn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(fxh(i), fxh(i+vec2(1,0)), u.x), mix(fxh(i+vec2(0,1)), fxh(i+vec2(1,1)), u.x), u.y); }
float fxf(vec2 p){ return fxn(p) * 0.55 + fxn(p * 2.3 + 7.1) * 0.28 + fxn(p * 5.1 + 3.3) * 0.17; }
float fxFuel(float u, float v){
  if (abs(v) > uWD.x * 0.5 + 8.0 || u > uWD.y * 0.5 + 8.0 || u < -uWD.y * 0.5 - 8.0) return 0.0;
  if (length(vec2(u, v) - uPond.xy) < uPond.z + 2.0) return 0.0;
  if (abs(u - uField.x) < uField.z && abs(v - uField.y) < uField.w) return 0.0;
  float cu = uCreek + 7.0 * sin(v * 6.2832 / 150.0 + 1.3) + 2.5 * sin(v * 6.2832 / 47.0 + 0.4);
  if (abs(u - cu) < 4.0) return 0.0;
  return 1.0;
}`).replace('#include <color_fragment>', `#include <color_fragment>
  vec2 dxz = vFxW.xz - uC; float fu = dot(dxz, uFwd), fv = dot(dxz, uRight);
  float wobv = uWA.x * sin(fv * uWK.x + uPh.x) + uWA.y * sin(fv * uWK.y + uPh.y) + uWA.z * sin(fv * uWK.z + uPh.z);
  float age = uT - (fu - uStart - wobv) / uSpeed;
  float n = fxf(vFxW.xz * 0.23), n2 = fxf(vFxW.xz * 1.7 + 5.0);
  float fuelK = fxFuel(fu, fv);
  float edgeK = smoothstep(uWD.x * 0.5 + 8.0, uWD.x * 0.5 - 18.0 + n * 14.0, abs(fv)) * smoothstep(uWD.y * 0.5 + 8.0, uWD.y * 0.5 - 18.0 + n * 14.0, abs(fu));
  float burnt = smoothstep(-0.6, 0.8, age + (n - 0.5) * 1.6) * fuelK * edgeK;
  vec3 ash = mix(vec3(0.018, 0.016, 0.015), vec3(0.16, 0.15, 0.14), smoothstep(0.55, 0.9, n2) * 0.8 + smoothstep(20.0, 60.0, age) * 0.15);
  // grass fuel: the unburnt field ahead of the front is dry, golden grass (what a grass fire runs through)
  float unb = (1.0 - burnt) * fuelK * edgeK * uGrass * smoothstep(0.2, 0.7, n + 0.3);
  vec3 dry = mix(vec3(0.3, 0.24, 0.12), vec3(0.5, 0.41, 0.21), n2);
  diffuseColor.rgb = mix(dry, ash, burnt / max(burnt + unb * 0.5, 1e-3));
  diffuseColor.a = max(burnt, unb * 0.5);
  float bed = smoothstep(-0.5, 0.3, age) * (1.0 - smoothstep(1.0, 9.0, age + n * 4.0));
  float spots = pow(clamp(n2 * 1.25 - 0.2, 0.0, 1.0), 5.0) * exp(-max(age, 0.0) / 16.0) * smoothstep(-0.2, 0.6, age);   // only on burnt ground
  float fxGlow = (bed * smoothstep(0.25, 0.85, n2 + 0.25 * n) * 1.7 + spots * 1.4) * fuelK * edgeK * (0.5 + 0.5 * uI) * uGK;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.24, 0.035) * fxGlow;');
  };
  gmat.customProgramCacheKey = () => 'fx.wildfire.ground';
  ctx.patch(gmat);
  const gmesh = new THREE.Mesh(ggeo, gmat);
  gmesh.receiveShadow = true; gmesh.renderOrder = 3; gmesh.userData.noQA = true; gmesh.name = 'fx.wildfire.ground';
  root.add(gmesh);

  // ── refuges ───────────────────────────────────────────────────────────────────────────────────────────────────
  const waterMat = stdMat(ctx, { color: 0x0b1418, roughness: 0.06, metalness: 0.35 });
  const mudMat = stdMat(ctx, { color: 0x1e1812, roughness: 0.55, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  if (pond) {
    const [pu, pvv, pr] = pond;
    const [cx, cz] = toW(pu, pvv);
    const lev = Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => gAt(cx + Math.cos(k) * pr, cz + Math.sin(k) * pr))) + 0.12;
    const wgeo = new THREE.CircleGeometry(pr, 48); wgeo.rotateX(-Math.PI / 2);
    const wm = new THREE.Mesh(wgeo, waterMat); wm.position.set(cx - at[0], lev - gy0, cz - at[1]); wm.receiveShadow = true; wm.name = 'fx.wildfire.pond'; wm.userData.noQA = true;
    const bank = terrainGrid(G, cx, cz, pr * 2 + 10, pr * 2 + 10, 1.5, 0, 0.09, gy0);
    const bp = bank.attributes.position; const keep = [];
    const bm = new THREE.Mesh(bank, mudMat); bm.position.set(cx - at[0], 0, cz - at[1]); bm.userData.noQA = true;
    // round bank: fade by alpha via vertex colours is overkill; clip the square to a ring with an alpha map
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g2 = cv.getContext('2d');
    const gr = g2.createRadialGradient(64, 64, 64 * pr / (pr + 5) * 0.9, 64, 64, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000');
    g2.fillStyle = gr; g2.fillRect(0, 0, 128, 128);
    const am = new THREE.CanvasTexture(cv); mudMat.alphaMap = am; mudMat.transparent = true; mudMat.depthWrite = false;
    root.add(bm, wm);
    void bp; void keep;
  }
  if (creekU != null) {
    const n = 180, pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const v = -W / 2 - 30 + (W + 60) * i / n, u = creekAt(v);
      for (const s of [-1, 1]) {
        const [x, z] = toW(u + s * 4.2, v);
        pos.push(x - at[0], Math.min(gAt(x, z), gAt(...toW(u, v))) + 0.1 - gy0, z - at[1]);
      }
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setIndex(idx); cg.computeVertexNormals();
    const cm = new THREE.Mesh(cg, waterMat); cm.receiveShadow = true; cm.userData.noQA = true; cm.name = 'fx.wildfire.creek';
    root.add(cm);
  }
  if (field) {
    const [fu, fv, hu, hv] = field;
    const [cx, cz] = toW(fu, fv);
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const g2 = cv.getContext('2d');
    for (let y = 0; y < 256; y++) { const s = 0.5 + 0.5 * Math.sin(y / 256 * Math.PI * 2 * 16); const l = Math.round(58 + 30 * s + (hf(y, 3) - 0.5) * 10); g2.fillStyle = `rgb(${l + 22},${l + 4},${l - 12})`; g2.fillRect(0, y, 64, 1); }
    const ft = new THREE.CanvasTexture(cv); ft.colorSpace = THREE.SRGBColorSpace; ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(4, hu * 2 / 16);
    const fgeo = terrainGrid(G, cx, cz, hv * 2, hu * 2, 2, -((item.heading ?? 0) * DEG), 0.1, gy0);
    const fm = new THREE.Mesh(fgeo, stdMat(ctx, { map: ft, roughness: 1, color: 0xb8aa98, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    fm.position.set(cx - at[0], 0, cz - at[1]); fm.receiveShadow = true; fm.userData.noQA = true; fm.name = 'fx.wildfire.field';
    root.add(fm);
  }

  // ── flames, smoke, embers, fire light (Q7 pass) ─────────────────────────────────────────────────────────────────
  // fuel: 'grass' (low flames 0.5-2 m, a fast thin front) | 'forest' (surface flames 1-10 m + torching crowns to 15-30 m)
  const grassFire = (p.fuel || (dens < 0.004 ? 'grass' : 'forest')) === 'grass';
  const flameK = clamp(+(p.flame_k ?? 1), 0.2, 4), glowK = clamp(+(p.glow_k ?? 1), 0.2, 3);        // front flame height / brightness
  const plumeWall = p.plume === 'wall';                                                                     // a broad smoke wall instead of 3 columns
  const flames = makeFire(ctx, { count: 4600, hdr: (0.95 + 0.35 * I) * glowK, opacity: 0.62, wind: [F.fx, F.fz], name: 'fx.wildfire.flames', fog: 0.65 });
  const puffs = makePuffs(ctx, { count: 2300, tint: [0.3, 0.28, 0.26], glow: FIRE_RGB, heat: [1.0, 0.42, 0.12], heatHDR: 1.8, near: 10 });
  const embers = makeGlowStreaks(ctx, { count: 3000, minPx: 1.1, minK: 0.22, name: 'fx.wildfire.embers' });
  root.add(flames.mesh, puffs.mesh, embers.mesh);
  const NL = 5, lights = [];
  for (let k = 0; k < NL; k++) { const L = new THREE.PointLight(new THREE.Color(...FIRE_RGB), 0, 420, 2); L.castShadow = false; L.userData.fx = true; root.add(L); lights.push(L); }
  // the fire as a key light: orange, from the front toward the unburnt side, casting shadows from houses and people
  const fireKey = new THREE.DirectionalLight(new THREE.Color(1.0, 0.52, 0.22), 0); fireKey.userData.fx = true;
  fireKey.castShadow = p.shadow !== false;
  if (fireKey.castShadow) { const sc = fireKey.shadow.camera; fireKey.shadow.mapSize.set(1024, 1024); sc.left = sc.bottom = -170; sc.right = sc.top = 170; sc.near = 1; sc.far = 900; fireKey.shadow.bias = -0.0006; fireKey.shadow.normalBias = 0.4; }
  root.add(fireKey, fireKey.target);
  const windU = 3.5 + 3 * I;                       // downwind drift of smoke and embers (m/s at low level)
  const cols = [-0.3, 0.06, 0.34].map((f) => f * W);
  const hsAt = (x, z) => gAt(x, z) - gy0;
  // spot fires: embers land 6-50 m ahead of the front and start small fires that grow until the front arrives
  const SPOT = [];
  for (let k = 0; k < (grassFire ? 30 : 20); k++) {
    const v = (hf(k, seed + 91) - 0.5) * W * 0.9, d = (grassFire ? 4 : 8) + (grassFire ? 22 : 45) * hf(k, seed + 92);
    const ti = (hf(k, seed + 93) * 1.4 - 0.2) * (ctx.dur ?? 10);
    const u = start + speed * ti + wob(v) + d;
    if (!fuel(u, v)) continue;
    SPOT.push({ u, v, ti, n: 3 + Math.floor(hf(k, seed + 94) * 4), g: 1.5 + 3 * hf(k, seed + 95), k });
  }
  // flare-ups (a tree torching on a cue): flare [{t, at: [x, z]}] -> the nearest tree that is still standing then
  const FLARE = (Array.isArray(p.flare) ? p.flare : p.flare ? [p.flare] : []).map((f) => ({ t: +(f.t ?? 0), at: Array.isArray(f.at) ? f.at : [at[0], at[1]], n: Math.max(1, Math.round(+(f.trees ?? 3))) }));
  for (const fl of FLARE) {
    const cand = trees.map((tr, i) => ({ i, d: Math.hypot(tr.x - fl.at[0], tr.z - fl.at[1]), ok: tr.tb + tr.dur * 0.5 > fl.t })).filter((c) => c.ok).sort((a, b) => a.d - b.d).slice(0, fl.n);
    for (const c of cand) { const tr = trees[c.i]; tr.crown = true; tr.flare = fl.t; tr.tb = Math.min(tr.tb, fl.t - 0.15); tr.dur = Math.max(tr.dur, 9); }
    if (!cand.length && ctx.warn) ctx.warn('fx.wildfire flare: no standing tree near ' + JSON.stringify(fl.at));
  }
  // the distant plume: a tall convective column sheared downwind into a flat anvil (auto for very wide fronts)
  const plumeK = plumeWall ? 0 : p.plume != null ? clamp(+p.plume, 0, 2) : (W >= 900 ? 1 : 0), plumeH = +(p.plume_h ?? (plumeWall ? 800 : 2400));
  const plumeWk = clamp(+(p.plume_width ?? 1), 0.1, 1.5);

  // the smoke curtain: continuous leaning sheets rising off the whole front, lit orange from below (not puff balls)
  const CL = [[-1, 1.0, 0.0], [-7, 0.8, 1.7], [-15, 0.6, 3.1]], NSx = 200;
  const Hs = (grassFire ? 38 : 85) * (0.7 + 0.3 * smokeK), leanK = grassFire ? 1.0 : 0.75;
  const cPos = new Float32Array(CL.length * (NSx + 1) * 2 * 3), cUV = new Float32Array(CL.length * (NSx + 1) * 2 * 3), cIdx = [];
  for (let l = 0; l < CL.length; l++) for (let i = 0; i <= NSx; i++) for (let e = 0; e < 2; e++) {
    const k = (l * (NSx + 1) + i) * 2 + e;
    cUV[k * 3] = -W / 2 + W * i / NSx; cUV[k * 3 + 1] = e; cUV[k * 3 + 2] = CL[l][2];
    if (i < NSx && e === 0) { const a = (l * (NSx + 1) + i) * 2; cIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const cGeo = new THREE.BufferGeometry();
  cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3)); cGeo.setAttribute('aC', new THREE.BufferAttribute(cUV, 3)); cGeo.setIndex(cIdx);
  cGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const cN = new THREE.Vector3(F.fx, 0, F.fz).multiplyScalar(-1).add(new THREE.Vector3(0, leanK, 0)).normalize();   // the sheet's normal (it leans downwind)
  const cU = { uT: { value: 0 }, uW: { value: W }, uK: { value: smokeK }, uGlow: { value: 0.8 + 0.8 * I }, uN: { value: cN }, uKey: FXU.uKey, uSky: FXU.uSky,
    uFogColor: EU.uFogColor, uFogSunColor: EU.uFogSunColor, uSunDir: EU.uSunDir, uFogDensity: EU.uFogDensity, uFogFalloff: EU.uFogFalloff, uFogBase: EU.uFogBase, uMirror: EU.uMirror };
  const cMat = new THREE.ShaderMaterial({
    uniforms: cU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute vec3 aC; varying vec3 vC; varying vec3 vWp;
      void main(){ vC = aC; vec4 wp = modelMatrix * vec4(position, 1.0); vWp = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\n${FOG_GLSL}
      uniform float uT, uW, uK, uGlow; uniform vec3 uKey, uSky, uN; varying vec3 vC; varying vec3 vWp;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      float fb(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      void main(){
        #include <logdepthbuf_fragment>
        float h = vC.y, along = vC.x, sd = vC.z;
        vec2 q = vec2(along / 22.0 + sd * 3.1, h * 3.2 - uT * 0.09 + sd);
        float n = fb(q + vec2(fb(q * 0.7 + uT * 0.02) * 0.9, 0.0));
        float dens = smoothstep(0.32, 0.75, n + 0.28 * (1.0 - h) - 0.1 * sd);
        float ends = smoothstep(uW * 0.5, uW * 0.5 - 70.0 - 40.0 * n, abs(along));
        vec3 Vd = normalize(vWp - cameraPosition);
        float face = smoothstep(0.18, 0.62, abs(dot(Vd, uN)));                        // seen obliquely it streaks: fade out (the puffs carry it)
        face *= smoothstep(8.0, 45.0, length(vWp - cameraPosition));                   // near the lens: fade (no near-plane cut)
        float a = dens * smoothstep(0.03, 0.2, h) * (1.0 - smoothstep(0.3 + 0.3 * n, 0.95, h)) * ends * face * clamp(uK, 0.0, 1.5) * (0.85 - 0.18 * sd);
        if (a < 0.004) discard;
        vec3 smoke = mix(vec3(0.13, 0.115, 0.105), vec3(0.4, 0.36, 0.32), n) * (uSky * 0.75 + uKey * 0.25);
        vec3 glow = vec3(1.0, 0.33, 0.07) * uGlow * exp(-h * 4.5) * (0.5 + 0.6 * n);
        vec3 col = smoke + glow;
        vec3 fr = vWp - cameraPosition; float fd = length(fr); vec3 frd = fr / max(fd, 1e-3);
        col = mix(col, wfogColor(frd), wfogAmount(cameraPosition, frd, fd));
        gl_FragColor = vec4(col, clamp(a * 0.8, 0.0, 0.7));
      }`,
  });
  const curtainM = new THREE.Mesh(cGeo, cMat); curtainM.frustumCulled = false; curtainM.renderOrder = 11; curtainM.userData.noQA = true; curtainM.name = 'fx.wildfire.curtain';
  if (smokeK > 0.05) root.add(curtainM);
  function updateCurtain(t) {
    cU.uT.value = t;
    for (let l = 0; l < CL.length; l++) for (let i = 0; i <= NSx; i++) {
      const v = -W / 2 + W * i / NSx, u = front(t, v) + CL[l][0];
      const [x0, z0] = toW(u, v), [x1, z1] = toW(u + leanK * Hs, v);
      const k = (l * (NSx + 1) + i) * 2 * 3, y0 = hsAt(x0, z0) - 1;
      cPos[k] = x0 - at[0]; cPos[k + 1] = y0; cPos[k + 2] = z0 - at[1];
      cPos[k + 3] = x1 - at[0]; cPos[k + 4] = y0 + Hs * (1 + 0.2 * l); cPos[k + 5] = z1 - at[1];
    }
    cGeo.attributes.position.needsUpdate = true;
  }

  function update(t, clock, camera) {
    syncEnv(ctx);
    gU.uT.value = t;
    updateTrees(t);
    if (smokeK > 0.05) updateCurtain(t);
    flames.begin(t);
    // the flame front: an irregular line (the wobble + ragged fingers), tall and low stretches, 4 rows of depth
    const sp = grassFire ? 0.6 : 1.15, nv = Math.round(W / sp);
    const rows = grassFire ? [0.15, 0.8, 1.7, 2.9] : [0.4, 2.2, 4.9, 8.2];
    for (let i = 0; i < nv; i++) {
      const v0 = -W / 2 + (i + hf(i, seed + 21)) * W / nv;
      const clump = 0.5 + 0.9 * clamp(0.5 + 0.9 * vn(v0 / (grassFire ? 9 : 24) + 3.1, seed + 27));
      for (let r = 0; r < rows.length; r++) {
        const j = i * 4 + r;
        const off = rows[r] + hf(j, seed + 22) * (grassFire ? 0.7 : 2.0) + (grassFire ? 1.2 : 2.5) * Math.max(0, vn(v0 / 6 + r * 1.7, seed + 28));
        const u = front(t, v0) - off, v = v0 + (hf(j, seed + 23) - 0.5) * sp * 1.4;
        if (!fuel(u, v)) continue;
        const [x, z] = toW(u, v);
        const fl = 0.68 + 0.32 * vn(t * 2.1 + j * 0.37, seed + 24);
        const rk = [1, 0.78, 0.55, 0.34][r];
        const hb = grassFire ? 0.5 + 1.6 * Math.pow(hf(j, seed + 25), 1.5) : 1.0 + 9.0 * Math.pow(hf(j, seed + 25), 2.2);
        const h = hb * clump * rk * (0.5 + 0.5 * I) * fl * flameK;
        flames.push(x - at[0], hsAt(x, z) - 0.1, z - at[1], h, h * (grassFire ? 0.85 : 0.6) + Math.min(grassFire ? 0.35 : 0.9, h * 0.45), hf(j, seed + 26), 0.9 - r * 0.12, 0.78 - r * 0.16, 0.2);
      }
    }
    // spot fires ahead of the front
    for (const s of SPOT) {
      const a = t - s.ti; if (a < 0) continue;
      if (front(t, s.v) - 2 > s.u) continue;                                   // the front has swallowed it
      const g = sstep(0, s.g, a);
      for (let q = 0; q < s.n; q++) {
        const du = (hf(s.k * 7 + q, seed + 96) - 0.5) * (1.5 + 3 * g), dv = (hf(s.k * 7 + q, seed + 97) - 0.5) * (1.5 + 4 * g);
        const [x, z] = toW(s.u + du, s.v + dv);
        const h = (grassFire ? 0.6 + 1.0 * g : 1.0 + 3.5 * g) * (0.6 + 0.4 * hf(s.k * 7 + q, seed + 98)) * (0.75 + 0.25 * vn(t * 2.4 + q + s.k, seed + 99));
        flames.push(x - at[0], hsAt(x, z) - 0.1, z - at[1], h, h * 0.7 + Math.min(0.4, h * 0.3), hf(s.k * 7 + q, seed + 100), 0.85 * sstep(0, 0.3, a), 0.65, 0.2);
      }
    }
    // torching trees: the flames climb the crown from the lowest branches to the tip, following the cone
    for (let i = 0; i < NT; i++) {
      const tr = trees[i]; const a = t - tr.tb;
      if (a < -0.3 || a > tr.dur + 0.5) continue;
      const s = treeState(tr, t);
      if (s.flame < 0.01) continue;
      const bx = tr.x - at[0], bz = tr.z - at[1], by = tr.y - gy0;
      const fl0 = 0.7 + 0.3 * vn(t * 2.3 + i * 0.71, seed + 31);
      if (tr.crown) {
        // a flare-up torches the whole crown in ~0.4 s and throws a flame column 1.5-2x the tree, then settles
        const fu = tr.flare != null ? sstep(tr.flare - 0.08, tr.flare + 0.3, t) : 0;
        const climb = Math.max(sstep(-0.2, 1.3, a), fu), boost = tr.flare != null ? 1 + 1.6 * fu * (1 - 0.5 * sstep(tr.flare + 1.4, tr.flare + 3.5, t)) : 1;
        const sF = Math.max(s.flame, fu);
        if (fu > 0.01) { const hF = tr.h * (1.3 + 0.5 * fu) * fu * (0.8 + 0.2 * fl0) * (1 - 0.4 * sstep(tr.flare + 1.4, tr.flare + 3.5, t)); flames.push(bx, by + tr.h * 0.55, bz, hF, Math.min(tr.h * 0.35, hF * 0.4), hf(i, 52), 0.95, 0.75, 0.15); }
        for (let k = 0; k < 6; k++) {
          const f = (k + 0.5) / 6, yk = 0.2 + 0.74 * f;
          if (yk > 0.2 + 0.8 * climb) break;
          const rc = tr.h * (0.16 - 0.12 * f), ang = hf(i * 7 + k, 44) * 6.28;
          const fl = 0.7 + 0.3 * vn(t * 2.6 + i * 0.71 + k * 1.3, seed + 31);
          const hk = tr.h * (0.2 + 0.18 * (1 - f)) * (1 + 0.7 * hf(i * 7 + k, 45)) * sF * fl * (k === 5 ? 2.0 : 1) * boost * (1 + (flameK - 1) * 0.6);
          flames.push(bx + Math.cos(ang) * rc * 0.5, by + tr.h * yk - hk * 0.22, bz + Math.sin(ang) * rc * 0.5, hk, Math.min(rc * 1.6 + 0.9, hk * 0.75), hf(i * 7 + k, 46), 0.85, 0.55 + 0.3 * f, 0.12);
        }
      } else {
        { const hS = tr.h * 0.3 * s.flame * fl0; flames.push(bx, by, bz, hS, Math.min(tr.h * 0.2, hS * 0.8), hf(i, 47), 0.75, 0.5, 0.1); }
      }
    }
    const wn = [F.fx, F.fz];
    flames.end(camera, wn);
    // smoke: a low curtain leaning downwind, lit orange from below (Q4's billow shaping: torn, occluded by height)
    puffs.begin();
    const NLOW = grassFire ? 1100 : 1300;
    for (let i = 0; i < NLOW; i++) {
      const L = 20 + 9 * hf(i, 51);
      const age = ((t + hf(i, 52) * L) % L + L) % L;
      const tB = t - age;
      const v0 = (hf(i, 53) - 0.5) * W * 0.98;
      const u0 = front(tB, v0) - 2 - hf(i, 54) * 6;
      if (!fuel(u0, v0) && hf(i, 55) > 0.2) continue;
      const rise = (grassFire ? 2.5 : 4) + (grassFire ? 1.4 : 2.2) * age + 9 * 3.2 * (1 - Math.exp(-age / 3.2));
      const hk = clamp(rise / 120);
      const u = u0 + windU * age * (0.45 + 0.75 * hk) + vn(age * 0.3 + i, 56) * 4;
      const v = v0 + (hf(i, 57) - 0.5) * age * 1.6 + vn(age * 0.25 + i * 1.3, 58) * 5;
      const [x, z] = toW(u, v);
      const gy = hsAt(x, z);
      const y = hsAt(...toW(u0, v0)) + rise;
      const size = (grassFire ? 3 : 4) + age * 1.9;
      const alpha = 0.34 * smokeK * sstep(0, 1.0, age) * Math.exp(-age / 7) * (1 - sstep(L * 0.65, L, age));   // densest at the fire, thinning as it rises (no hovering band)
      const dfront = Math.abs(u - front(t, v));
      const glow = (0.8 + 0.7 * I) * Math.exp(-(y - gy) / 70) * Math.exp(-dfront / 40) * (0.8 + 0.2 * vn(t * 2 + i, 59));
      const heat = 0.3 * (1 - sstep(0, 2.2, age)) * I;
      const occS = clamp(0.3 + 0.45 * hk + 0.25 * clamp(age / 8) + (hf(i, 62) - 0.5) * 0.2);
      puffs.push(x - at[0], y, z - at[1], size, hf(i, 60) * 6.28 + age * 0.05 * (hf(i, 61) - 0.5), alpha, (i & 3), gy, 0.3 + 0.35 * clamp(age / L * 1.4), glow, heat, 0.1,
        clamp(0.75 + 0.25 * age / L), occS, hf(i, 63));
    }
    // the smoke wall (plume: "wall"): a broad billowing plume rising off the whole front, sheared downwind, spreading and
    // thinning into the smoke sky at plume_h; replaces the 3 convective columns
    if (plumeWall) {
      const NWALL = 720;
      for (let j = 0; j < NWALL; j++) {
        const i = 12000 + j;
        const L = 40 + 22 * hf(i, 71);
        const age = ((t + hf(i, 72) * L) % L + L) % L, f = age / L;
        const tB = t - age;
        const v0 = (hf(i, 73) - 0.5) * W * plumeWk;
        const u0 = front(tB, v0) - 6;
        // slow near the fire, faster aloft: the wall is densest low down and thins as it climbs (no balls piling up on top)
        const hk = Math.pow(f, 1.35);
        const rise = 10 + plumeH * hk;
        const u = u0 + windU * age * (0.2 + 1.15 * hk) + vn(age * 0.15 + i, 74) * 12;
        const v = v0 + vn(age * 0.12 + i * 0.7, 75) * (10 + age * 1.8);
        const [x, z] = toW(u, v);
        const gy = hsAt(x, z);
        const y = hsAt(...toW(u0, v0)) + rise;
        const size = (22 + plumeH * 0.14 * hk + age * 1.1) * (0.75 + 0.5 * hf(i, 77));
        // fades in over its first ~1.8 s of life (never pops in as a dark disc) and dissolves with height
        const alpha = 0.5 * smokeK * sstep(0, 1.8, age) * (1 - sstep(0.35, 0.95, hk)) * (1 - sstep(0.85, 1.0, f));
        const dfront = Math.abs(u - front(t, v));
        const glow = (0.8 + 0.7 * I) * glowK * Math.exp(-(y - gy) / 150) * Math.exp(-dfront / 90);
        const occW = clamp(0.25 + 0.6 * hk + (hf(i, 78) - 0.5) * 0.2);
        // dark and dense low down; lighter and hazier with height toward the smoke sky; neighbours merge (blend)
        puffs.push(x - at[0], y, z - at[1], size, hf(i, 76) * 6.28 + age * 0.03 * (hf(i, 79) - 0.5), alpha, (i & 3), gy, 0.28 + 0.95 * hk, glow, 0.22 * (1 - sstep(0, 4, age)) * I, 0.12,
          clamp(0.5 + 0.5 * hk), occW, hf(i, 80), clamp(0.55 + 0.4 * hk));
      }
    }
    // convective columns
    if (!plumeWall) for (let c = 0; c < cols.length; c++) {
      for (let j = 0; j < 180; j++) {
        const i = 5000 + c * 1000 + j;
        const L = 30 + 8 * hf(i, 71);
        const age = ((t + hf(i, 72) * L) % L + L) % L;
        const tB = t - age;
        const v0 = cols[c] + (hf(i, 73) - 0.5) * 30;
        const u0 = front(tB, v0) - 4;
        const rise = 6 + 7 * age + 16 * 5 * (1 - Math.exp(-age / 5));
        const hk = clamp(rise / 260);
        const u = u0 + windU * age * (0.3 + 1.1 * hk) + vn(age * 0.2 + i, 74) * 8;
        const v = v0 + vn(age * 0.18 + i * 0.7, 75) * (8 + age * 1.2);
        const [x, z] = toW(u, v);
        const gy = hsAt(x, z);
        const y = hsAt(...toW(u0, v0)) + rise;
        const size = 9 + age * 3.4;
        const alpha = 0.45 * smokeK * sstep(0, 2, age) * (1 - sstep(L * 0.6, L, age));
        const dfront = Math.abs(u - front(t, v));
        const glow = (0.7 + 0.6 * I) * Math.exp(-(y - gy) / 140) * Math.exp(-dfront / 70);
        const occC = clamp(0.28 + 0.5 * hk + (hf(i, 77) - 0.5) * 0.22);
        puffs.push(x - at[0], y, z - at[1], size, hf(i, 76) * 6.28 + age * 0.04 * (hf(i, 78) - 0.5), alpha, (i & 3), gy, 0.34 + 0.3 * clamp(age / L * 1.5), glow, 0.25 * (1 - sstep(0, 3, age)) * I, 0.15,
          clamp(0.6 + 0.4 * age / L), occC, hf(i, 79));
      }
    }
    // the plume: rising column, sheared downwind, spreading into a flat anvil at plumeH
    if (plumeK > 0) {
      const NP = 360;
      const [pcx, pcz] = toW(front(t, 0) - 20, 0);
      for (let j = 0; j < NP; j++) {
        const i = 9000 + j, L = 70 + 25 * hf(i, 81);
        const f = ((t / L + hf(i, 82)) % 1 + 1) % 1;
        const hN = (1 - Math.exp(-3.2 * f)) / (1 - Math.exp(-3.2));
        const y = 30 + plumeH * hN;
        const anv = sstep(0.8, 1.0, hN);
        const rCol = 60 + 0.12 * y + anv * plumeH * 0.55 * hf(i, 83);
        const ang = hf(i, 84) * 6.28 + f * 2.0;
        const shear = plumeH * 0.45 * hN * hN;
        const x = pcx + F.fx * shear + Math.cos(ang) * rCol * (0.4 + 0.6 * hf(i, 85)), z = pcz + F.fz * shear + Math.sin(ang) * rCol * (0.4 + 0.6 * hf(i, 85)) * (1 - 0.5 * anv);
        const yy = y - anv * 120 * hf(i, 86);
        const size = (70 + 0.16 * y) * (1 + 0.8 * anv) * plumeK;
        const alpha = 0.62 * sstep(0, 0.05, f) * (1 - sstep(0.9, 1, f)) * Math.min(1, plumeK);
        const occP = clamp(0.2 + 0.7 * hN + (hf(i, 87) - 0.5) * 0.2);
        puffs.push(x - at[0], yy, z - at[1], size, hf(i, 88) * 6.28 + f * 0.6, alpha, (i & 3), hsAt(x, z), 0.26 + 0.28 * hN, 0.9 * Math.exp(-yy / 250) * I, 0.1 * Math.exp(-yy / 120), 0.1, clamp(0.35 + 0.4 * hN), occP, hf(i, 89));
      }
    }
    puffs.end(camera);
    // embers: small glowing streaks blown ahead of the front (the motion of ~1/15 s: short streaks, never stars)
    embers.begin();
    const NE = Math.round((grassFire ? 1500 : 2800) * clamp(emberK, 0, 1.1));
    for (let i = 0; i < NE; i++) {
      const L = 3 + 5 * hf(i, 81);
      const age = ((t + hf(i, 82) * L) % L + L) % L;
      const v0 = (hf(i, 83) - 0.5) * W;
      const u0 = front(t - age, v0) - 3;
      if (!fuel(u0, v0) && hf(i, 84) > 0.3) continue;
      const y0 = hsAt(...toW(u0, v0)) + (grassFire ? 1 : 3) + (grassFire ? 5 : 14) * hf(i, 88);
      const pos = (ag) => {
        const lift = (12 + 40 * hf(i, 85)) * (grassFire ? 0.5 : 1) * (1 - Math.exp(-ag / 1.4)) - 1.8 * ag;
        const u = u0 + windU * 1.7 * ag * (0.6 + 0.8 * hf(i, 86)) + Math.sin(ag * 1.7 + i) * 2.5;
        const v = v0 + Math.sin(ag * 1.3 + i * 0.37) * 3.5 + (hf(i, 87) - 0.5) * ag * 3;
        const [x, z] = toW(u, v);
        return [x - at[0], Math.max(hsAt(x, z) + 0.2, y0 + lift), z - at[1]];
      };
      const b = pos(age), a = pos(Math.max(0, age - 0.07));
      const fl = 0.55 + 0.45 * Math.sin(t * (9 + 7 * hf(i, 89)) + i);
      const k = fl * (1 - sstep(L * 0.7, L, age)) * sstep(0, 0.3, age) * (0.8 + 0.6 * I);
      embers.push(a[0], a[1], a[2], b[0], b[1], b[2], 3.4 * k, 0.8 * k, 0.1 * k, 0.05 + 0.05 * hf(i, 90));
    }
    embers.end(camera);
    // the fire light: point lights riding the front, flickering, and the key light from the front
    for (let k = 0; k < NL; k++) {
      const v = (k / (NL - 1) - 0.5) * W * 0.8;
      const u = front(t, v) - 10;
      const [x, z] = toW(u, v);
      const Lt = lights[k];
      Lt.position.set(x - at[0], hsAt(x, z) + 42, z - at[1]);
      Lt.intensity = 1100 * (0.4 + 0.6 * I) * (0.82 + 0.18 * fbm1(t * 2.2, seed + k * 13)) * (fuel(u, v) ? 1 : 0.6) * glowK;
    }
    {
      const [x0, z0] = toW(front(t, 0) - 12, 0), [x1, z1] = toW(front(t, 0) + 90, 0);
      fireKey.position.set(x0 - at[0], hsAt(x0, z0) + (grassFire ? 10 : 22), z0 - at[1]);
      fireKey.target.position.set(x1 - at[0], hsAt(x1, z1), z1 - at[1]);
      fireKey.intensity = (grassFire ? 0.9 : 1.6) * (0.4 + 0.6 * I) * (0.85 + 0.15 * fbm1(t * 2.7, seed + 77)) * clamp(+(p.key ?? 1), 0, 3) * glowK;
    }
  }
  update(0, 0, null);
  return {
    root, radius: 110, height: 26, snapped: true, update,
    anchors: {
      front: (t) => toW(front(t, 0), 0),
      pond: pond ? toW(pond[0], pond[1]) : null, field: field ? toW(field[0], field[1]) : null,
      creek: creekU != null ? toW(creekAt(0), 0) : null, black: black ? toW(black[0], black[1]) : null,
    },
  };
}
