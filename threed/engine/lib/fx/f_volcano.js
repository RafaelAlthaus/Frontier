// f_volcano.js — (D2b) volcanic FX.
//   fx.pyroclastic  a pyroclastic density current rolling down the slope at speed: a glowing, churning basal flow, the
//                   billowing ash cloud boiling up behind the front (hundreds of metres), a thin fast surge running ahead,
//                   the ground greyed with ash where it has passed, orange light on whatever it is about to hit.
//                   Pair it with structures: town.ancient_mediterranean for Pompeii.
//   fx.eruption     a Plinian eruption column: incandescent jet at the vent, a convecting column kilometres high, the
//                   mushrooming umbrella cloud, lightning flickering in the plume, glowing ballistic bombs on arcs. On
//                   biome volcanic put it at [-1600, -5200] (the biome's crater); anywhere else it raises its own cone.
// Local frame (both): u = metres along the heading (the direction the flow travels), v = metres to the right.
import * as THREE from 'three';
import { DEG, clamp, lerp, sstep, ease, hf, vn, fbm1, makePuffs, makeSparks, makeFlames, makeGrit, terrainGrid, frame, syncEnv, stdMat } from './f_common.js';
import { curl3 } from './billow.js';
import { U } from '../shared/env.js';

export const CATALOG = {
  'fx.pyroclastic': {
    desc: 'pyroclastic density current (Pompeii): a glowing, billowing wall of hot ash rolling down the slope at ~40 m/s with a surge front ahead, ash-grey ground behind; heading = direction of travel, at = where the front is at t = arrive',
    actions: ['flow'],
    params: { speed: 40, arrive: 7, width: 1100, height: 320, heat: 1, surge: 1, ash: 1 },
    doc: {
      speed: 'm/s of the front (real flows: 20–200 m/s)', arrive: 's: when the front reaches `at`', width: 'm across the flow', height: 'm: height of the ash cloud behind the front',
      heat: '0..1 glow of the basal flow', surge: '0..1 the dilute surge running ahead', ash: '0..1 ash on the ground behind',
      vent: 'optional [x, z]: the flow pours out of this vent at `start` and runs down to `at` (arrive = start + distance / speed); narrow at the vent, fanning out', start: 's: with vent, when the flow leaves the vent',
    },
    footprint: [1100, 1100], height: 320, snap: false, tags: ['fx', 'volcano', 'pyroclastic', 'flow', 'ash', 'pompeii', 'disaster'],
  },
  'fx.eruption': {
    desc: 'Plinian volcanic eruption: glowing vent jet, a column kilometres high, mushrooming umbrella cloud, lightning in the plume, glowing ballistic bombs; at = the crater (biome volcanic: [-1600, -5200]); raises its own cone on flat ground',
    actions: ['erupt'],
    params: { height: 9000, umbrella: 9000, onset: -200, rate: 1, lightning: 1, bombs: 1, cone: 'auto', coneHeight: 1500, coneRadius: 4800 },
    doc: {
      height: 'm: column top / umbrella level', umbrella: 'm: final umbrella radius', onset: 's: when the eruption starts (negative = already raging; 0 = the column grows during the shot)',
      rate: 'time scale of the column motion (1 = ~5x real so it reads in a shot)', lightning: '0..1', bombs: '0..1', cone: 'auto | true | false', coneHeight: 'm', coneRadius: 'm',
      collapse: 'optional s: from then the column collapses: the jet fountains up to collapseH and falls back round the vent as a curtain that spills down the flanks (pair with fx.pyroclastic vent/start for the flow that pours on down)', collapseH: 'm: fountain height (default 0.3 x height, max 2600)',
      collapseDir: 'optional compass deg: a big pyroclastic lobe pours down the flank that way from the collapse (1 s after it), billows 150-400 m, visible from kilometres', collapseSpeed: 'm/s of that lobe (default 280; time-compressed like `rate`)',
      caldera: 'true: a supereruption (Yellowstone) instead of a Plinian vent: no cone, a ring of vents with fire fountains on the flat ground, jets merging into a column several km wide that convects in big billows, an umbrella spreading towards the horizon and an ash surge across the plain; onset < 0 = seen at its climax (column at full height). Use height 20000-30000, umbrella 25000-40000',
      calderaR: 'm: radius of the ring of vents (default height / 8, 1500-5000); the column is ~1.7x as wide at its base',
    },
    footprint: [9000, 9000], height: 9000, snap: false, tags: ['fx', 'volcano', 'eruption', 'plinian', 'ash', 'lightning', 'disaster'],
  },
};

const ASH_TINT = [0.36, 0.34, 0.33];
const HOT = [1.0, 0.36, 0.1];

// ── pyroclastic density current ─────────────────────────────────────────────────────────────────────────────────
async function buildPDC(item, ctx) {
  const p = item.params || {};
  const G = ctx.ground, at = item.at || [0, 0];
  const gy0 = G.height(at[0], at[1]);
  const root = new THREE.Group(); root.name = 'fx.pyroclastic'; root.position.set(at[0], gy0, at[1]);
  const F = frame(at[0], at[1], item.heading ?? 0);
  const seed = (item.seed ?? 11) | 0;
  const speed = Math.max(5, +(p.speed ?? 40)), arrive = +(p.arrive ?? 7), Wd = +(p.width ?? 1100), Hc = +(p.height ?? 320);
  const heat = clamp(+(p.heat ?? 1), 0, 2), surgeK = clamp(+(p.surge ?? 1), 0, 2), ashK = clamp(+(p.ash ?? 1), 0, 1);
  const s1 = hf(seed, 1) * 6, s2 = hf(seed, 2) * 6, s3 = hf(seed, 3) * 6, s4 = hf(seed, 4) * 6, s5 = hf(seed, 5) * 6;
  // Q4 (opt-in) vent-fed flow: `vent` [x, z] + `start` (s): the flow pours out of the vent at `start` and runs down to
  // `at` (arrive = start + distance / speed); it is born narrow at the vent and fans out; nothing exists before `start`
  // or behind the vent. Without `vent` everything is as before (a front that has been running for ever).
  const vent = Array.isArray(p.vent) && p.vent.length >= 2 ? [+p.vent[0], +p.vent[1]] : null;
  const uVent = vent ? Math.min(-50, F.toLocal(vent[0], vent[1])[0]) : -2900;
  const tStart = vent ? +(p.start ?? 0) : -1e9;
  const arriveE = vent ? tStart - uVent / speed : arrive;
  const rearK = (u) => (vent ? sstep(uVent - 40, uVent + 160, u) : sstep(-3200, -2600, u));
  const taper = (u) => (vent ? 0.16 + 0.84 * sstep(uVent, uVent + Math.min(1600, -uVent * 0.65), u) : 1);
  const front = (t, v) => speed * (t - arriveE) + 45 * Math.sin(v / 180 + s1) + 22 * Math.sin(v / 67 + s2) + 9 * Math.sin(v / 23 + s3);
  // lobes of the cloud: a lumpy skyline with a few thermals boiling far higher
  const lobeH = (v) => 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(v / 150 + s4)) + 0.9 * Math.pow(Math.max(0, Math.sin(v / 95 + s5)), 4);
  const hs = (x, z) => G.height(x, z) - gy0;
  const puffs = makePuffs(ctx, { count: 5600, tint: ASH_TINT, glow: HOT, heat: [1.0, 0.34, 0.08], heatHDR: 2.2, near: 14, groundFade: 0.24, softK: 0.22, fog: 0.7 });
  root.add(puffs.mesh);
  const sparks = makeSparks(ctx, { count: 900, maxPx: 3.5, minPx: 1.2 });
  root.add(sparks.mesh);
  const grit = makeGrit(ctx, { count: 520, maxPx: 5, minPx: 1.3 });            // Q4: ash grit and pumice thrown ahead of the head
  root.add(grit.mesh);
  const _cf = new THREE.Vector3(), CU = [0, 0, 0];
  // ash-grey ground where the flow has passed (+ a hot glowing band right behind the front)
  const span = Wd + 400;
  const ggeo = terrainGrid(G, at[0], at[1], span, span, 6, 0, 0.2, gy0);
  const gU = { uT: { value: 0 }, uSpeed: { value: speed }, uArr: { value: arriveE }, uFwd: { value: new THREE.Vector2(F.fx, F.fz) }, uRight: { value: new THREE.Vector2(F.rx, F.rz) }, uC: { value: new THREE.Vector2(at[0], at[1]) }, uW: { value: Wd }, uS: { value: new THREE.Vector2(hf(seed, 1) * 6, hf(seed, 2) * 6) }, uS3: { value: hf(seed, 3) * 6 }, uAsh: { value: ashK }, uHeat: { value: heat } };
  const gmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  gmat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, gU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFxW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFxW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vFxW; uniform float uT, uSpeed, uArr, uW, uAsh, uHeat, uS3; uniform vec2 uFwd, uRight, uC, uS;
float ph(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float pn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(ph(i), ph(i+vec2(1,0)), u.x), mix(ph(i+vec2(0,1)), ph(i+vec2(1,1)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec2 d = vFxW.xz - uC; float fu = dot(d, uFwd), fv = dot(d, uRight);
  float fr = uSpeed * (uT - uArr) + 45.0 * sin(fv / 180.0 + uS.x) + 22.0 * sin(fv / 67.0 + uS.y) + 9.0 * sin(fv / 23.0 + uS3);
  float behind = fr - fu;
  float n = pn(vFxW.xz * 0.05) * 0.6 + pn(vFxW.xz * 0.23) * 0.4;
  float side = smoothstep(uW * 0.5 + 40.0, uW * 0.5 - 120.0 + n * 90.0, abs(fv));
  float cover = smoothstep(-10.0, 60.0 + n * 40.0, behind) * side * uAsh;
  diffuseColor.rgb = mix(vec3(0.34, 0.33, 0.31), vec3(0.5, 0.48, 0.45), n);
  diffuseColor.a = cover;
  float hot = smoothstep(-5.0, 20.0, behind) * (1.0 - smoothstep(60.0, 260.0 + n * 120.0, behind)) * side;
  float fxGlow = hot * (0.4 + 1.2 * pow(n, 3.0)) * uHeat;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.3, 0.07) * fxGlow;');
  };
  gmat.customProgramCacheKey = () => 'fx.pyroclastic.ground';
  ctx.patch(gmat);
  const gm = new THREE.Mesh(ggeo, gmat); gm.receiveShadow = true; gm.userData.noQA = true; gm.renderOrder = 3; root.add(gm);
  // orange light riding the base of the front
  const lights = [];
  for (let k = 0; k < 3; k++) { const L = new THREE.PointLight(new THREE.Color(1, 0.42, 0.14), 0, 900, 2); root.add(L); lights.push(L); }

  const NB = 1500, NC = 800, NS = 260, NH = Math.round(clamp(Wd / 15, 30, 170)), NCORE = 48;
  const envB = 0.45 * speed * 9;                                          // how far behind the front the cloud reaches its height
  function update(t, clock, camera) {
    syncEnv(ctx);
    gU.uT.value = t;
    puffs.begin();
    // Q4: the look of the current (the motion and the front's timing are unchanged): every billow is a lit cauliflower
    // lobe; cloud lobes carry two smaller billows on their forward/upper rim and the head one; the front face and the
    // top are lit by the sun as the cloud's own surface (occ), the core stays dark; lobes roll forward and up;
    // fresh billows are crisp, old ones wispy; curl-noise churn on top of the drift
    const sun = U.uSunDir.value, fwS = F.fx * sun.x + F.fz * sun.z, upS = sun.y;
    let rollS = 0;
    if (camera) { camera.getWorldDirection(_cf); rollS = F.rx * _cf.x + F.rz * _cf.z; }      // (up x fwd) . (-cam fwd) = right . cam fwd: the forward roll on screen
    // 1) the churning basal flow + the cloud boiling up behind the front
    for (let i = 0; i < NB + NC; i++) {
      const cloud = i >= NB;
      const L = cloud ? 26 + 10 * hf(i, 3) : 7 + 5 * hf(i, 4);
      const age = ((t + hf(i, 5) * L) % L + L) % L;
      const tb = t - age;
      if (tb < tStart) continue;                                      // (vent) not poured out yet
      const v = (hf(i, 6) - 0.5) * Wd * (cloud ? 0.95 : 1.0);
      // born at the front, carried forward but slower than the front, so it falls behind and boils up
      const carry = speed * (cloud ? 0.55 : 0.8);
      const u = front(tb, v) + carry * 3 * (1 - Math.exp(-age / 3)) + (hf(i, 7) - 0.3) * 20;
      const [x, z] = F.toWorld(u, v * taper(u) + vn(age * 0.2 + i, 8) * 12);
      const g = hs(x, z);
      const lh = cloud ? Hc * lobeH(v) : 60;
      const rise = cloud ? lh * (1 - Math.exp(-age / 9)) * (0.45 + 0.7 * hf(i, 9)) + 20 : 6 + 30 * hf(i, 10) + age * 3.5;
      // rolling: the front billows turn over (forward on top, back underneath)
      const roll = cloud ? 0 : 7 * Math.sin(age * 1.3 + i);
      const size = cloud ? (38 + 30 * hf(i, 11)) * (hf(i, 16) < 0.22 ? 1.7 : 1) + age * 5 : 16 + age * 4 + 14 * hf(i, 12);
      const behind = front(t, v) - u;
      const edgeFade = 1 - sstep(Wd * 0.42, Wd * 0.5, Math.abs(v));
      const a = (cloud ? 0.82 : 0.92) * sstep(0, cloud ? 0.7 : 0.25, age) * (1 - sstep(L * 0.75, L, age)) * edgeFade * rearK(u);
      if (a < 0.003) continue;
      // emissive heat only in the lowest billows at the front (glowing puffs higher up read as orange balls in the air)
      const hotK = heat * (cloud ? 0.04 * Math.exp(-rise / 30) : 0.7 * Math.exp(-rise / 11)) * Math.exp(-Math.max(0, behind) / 200);
      // the glow from the hot base only reaches the lowest billows (per-billow glow read as orange balls higher up)
      const glow = heat * (cloud ? 0.25 * Math.exp(-rise / 40) : 0.5 * Math.exp(-rise / 24)) * Math.exp(-Math.max(0, behind) / 220);
      let X = x - at[0], Y = g + rise + roll, Z = z - at[1];
      curl3(X / 170 + t * 0.03, Y / 170, Z / 170 - t * 0.02, 31, CU);
      const tk = size * (0.18 + 0.12 * Math.min(age / 6, 1));
      X += CU[0] * tk; Y += CU[1] * tk * 0.7; Z += CU[2] * tk;
      // the cloud's own surface here (its envelope: a steep face at the head, a gentle top far behind) -> sun visibility;
      // billows below the envelope are inside the cloud and darker still
      const hN = clamp(rise / Math.max(lh, 1)), b = Math.max(0, behind), ex = Math.exp(-b / envB);
      const envH = 20 + 0.8 * Hc * lobeH(v) * (1 - ex), slope = 0.8 * Hc * lobeH(v) / envB * ex, sl = Math.hypot(slope, 1);
      const sd = sstep(-0.35, 0.6, (slope * fwS + upS) / sl);         // 0: this face looks away from the sun (backlit wall)
      const inside = clamp((envH - rise) / (0.4 * envH + 10));
      const occ = clamp((0.03 + 0.85 * sd + (hf(i, 17) - 0.5) * 0.12 * (0.3 + sd)) * (1 - 0.55 * inside));
      const soft = clamp((cloud ? 0.06 : 0.04) + age / L * (cloud ? 0.85 : 0.5));
      const spin = hf(i, 13) * 6.28 + age * (cloud ? 0.04 : 0.3) * rollS + age * 0.05 * (hf(i, 14) - 0.5);
      const alb = (cloud ? 0.55 + 0.4 * clamp(rise / Hc) : 0.42) * (0.88 + 0.24 * hf(i, 18));
      puffs.push(X, Y, Z, size, spin, a, i & 3, g, alb, glow * 0.8, clamp(hotK * 0.4, 0, 0.5), cloud ? 0.15 : 0.05, soft, occ, hf(i, 15));
      // smaller billows riding the lobe's forward / upper rim (the cauliflower hierarchy)
      const nk = cloud ? 2 : (i % 3 === 0 ? 1 : 0);
      for (let k = 0; k < nk; k++) {
        const j = i * 3 + k;
        const cf = 0.15 + 0.7 * hf(j, 41), cu = 0.3 + 0.8 * hf(j, 42), cr = (hf(j, 43) - 0.5) * 1.6, cl = Math.hypot(cf, cu, cr);
        const d = size * (0.5 + 0.18 * hf(j, 44)) / cl, ks = size * (0.42 + 0.16 * hf(j, 45));
        const kx = X + (F.fx * cf + F.rx * cr) * d, ky = Y + cu * d, kz = Z + (F.fz * cf + F.rz * cr) * d;
        puffs.push(kx, Math.max(ky, g + ks * 0.3), kz, ks, spin * 1.4 + hf(j, 46) * 6.28, a * 0.95, (i + k + 1) & 3, g, alb * 1.06, glow * 0.8, clamp(hotK * 0.6, 0, 0.8), 0.05,
          clamp(soft + 0.05), clamp(occ + 0.12), hf(j, 47));
      }
    }
    // 2) the dilute surge running ahead: lighter, thinner, faster, wispy
    for (let j = 0; j < NS * surgeK; j++) {
      const i = 9000 + j;
      const L = 4 + 3 * hf(i, 21);
      const age = ((t + hf(i, 22) * L) % L + L) % L;
      if (t - age < tStart) continue;
      const v = (hf(i, 23) - 0.5) * Wd * 0.9;
      const u = front(t - age, v) + speed * 1.25 * age + 10;
      const [x, z] = F.toWorld(u, v * taper(u));
      const g = hs(x, z);
      const size = 10 + age * 6 + 8 * hf(i, 24);
      const a = 0.35 * sstep(0, 0.6, age) * (1 - sstep(L * 0.5, L, age));
      puffs.push(x - at[0], g + 4 + age * 5 + 10 * hf(i, 25), z - at[1], size * 1.2, hf(i, 26) * 6.28 + age * 0.3 * rollS, a * 0.6, i & 3, g, 0.58, 0.3 * heat, 0, 0.0,
        clamp(0.78 + age / L * 0.22), clamp(0.15 + 0.55 * sstep(-0.35, 0.6, fwS)), hf(i, 27));   // a hazy veil, not balls
    }
    // 3) the head: big dense billows riding the front along the ground, rolling over as it advances (it is never
    //    thin at the base, so nothing shows through the foot of the wall)
    for (let i = 0; i < NH; i++) {
      const v = ((i + 0.5) / NH - 0.5) * Wd * 0.96 + (hf(i, 51) - 0.5) * Wd / NH;
      const u = front(t, v) - 12 - 30 * hf(i, 52);
      const [x, z] = F.toWorld(u, v * taper(u));
      const g = hs(x, z), size = (18 + 40 * hf(i, 53) * hf(i, 58)) * Math.min(1, Wd / 900) * (0.55 + 0.45 * taper(u));
      let X = x - at[0], Y = g + size * (0.5 + 0.45 * hf(i, 54)), Z = z - at[1];
      curl3(X / 120 + t * 0.05, Y / 120, Z / 120, 37, CU);
      X += CU[0] * size * 0.25; Y += CU[1] * size * 0.15; Z += CU[2] * size * 0.25;
      const edge = 1 - sstep(Wd * 0.42, Wd * 0.5, Math.abs(v));
      const spin = hf(i, 55) * 6.28 + rollS * speed * t / size * 0.35, al = 0.95 * edge * rearK(u) * (vent ? sstep(tStart, tStart + 0.35, t) : 1);
      const occH = clamp(0.03 + 0.5 * sstep(-0.35, 0.6, fwS) + (hf(i, 56) - 0.5) * 0.14);
      puffs.push(X, Y, Z, size, spin, al, i & 3, g, 0.44, heat * 0.4, clamp(heat * 0.07, 0, 0.8), 0.0, 0.08, occH, hf(i, 57));
      // a smaller billow boiling up out of its top (so the head is one rolling mass, not a row of balls)
      const kd = size * 0.62, ka = (hf(i, 59) - 0.5) * 1.4;
      puffs.push(X + (F.fx * 0.35 + F.rx * ka) * kd, Y + kd * 0.8, Z + (F.fz * 0.35 + F.rz * ka) * kd, size * 0.55, spin * 1.3 + 2, al * 0.95, (i + 1) & 3, g, 0.46, heat * 0.25, 0, 0.0, 0.12, clamp(occH + 0.1), hf(i, 60));
    }
    // 4) the core: a few huge dark billows behind the face, so the gaps between the lobes are deep and dark and the
    //    wall is opaque (a low sun behind it must not shine through)
    for (let i = 0; i < NCORE; i++) {
      const v = ((i % 24 + 0.5) / 24 - 0.5) * Wd * 0.9 + (hf(i, 61) - 0.5) * Wd / 24;
      const lh = Hc * lobeH(v), b = (70 + 120 * hf(i, 63)) * Math.min(1, Hc / 400);
      // inside the cloud: the height the lobes have boiled up to this far behind the front, well below its top
      const hb = 20 + 0.8 * lh * (1 - Math.exp(-b / envB));
      const hk = (Math.floor(i / 24) + 0.3 + 0.4 * hf(i, 62)) / Math.ceil(NCORE / 24);
      if (vent && front(t, v) - b < uVent + 80) continue;              // (vent) the flow is not that long yet
      const [x, z] = F.toWorld(front(t, v) - b, v * taper(front(t, v) - b));
      const g = hs(x, z), size = Math.max(30, Math.min(hb * 0.45, lh * (0.18 + 0.08 * hf(i, 64))));
      const edge = 1 - sstep(Wd * 0.4, Wd * 0.48, Math.abs(v));
      puffs.push(x - at[0], g + size * 0.6 + (hb * 0.62 - size * 0.6) * hk, z - at[1], size, hf(i, 65) * 6.28 + t * 0.01, 0.95 * edge * rearK(front(t, v) - b), i & 3, g, 0.5,
        heat * 0.04 * (1 - hk), 0, 0.1, 0.3, clamp(0.02 + 0.3 * sstep(-0.35, 0.6, upS * hk + fwS * (1 - hk))), hf(i, 66));   // the core: dark, no glow
    }
    puffs.end(camera);
    // glowing lapilli thrown out of the base
    sparks.begin();
    for (let i = 0; i < 900; i++) {
      const L = 1.5 + 2 * hf(i, 31);
      const age = ((t + hf(i, 32) * L) % L + L) % L;
      if (t - age < tStart) continue;
      const v = (hf(i, 33) - 0.5) * Wd * taper(front(t, 0));
      const u0 = front(t - age, v) - 20;
      const vu = speed * (0.9 + 0.5 * hf(i, 34)), vy = 8 + 18 * hf(i, 35);
      const [x, z] = F.toWorld(u0 + vu * age, v + (hf(i, 36) - 0.5) * 30 * age);
      const y = hs(x, z) + 3 + vy * age - 4.9 * age * age;
      if (y < hs(x, z)) continue;
      const k = (1 - age / L) * heat;
      sparks.push(x - at[0], y, z - at[1], 6 * k, 1.8 * k, 0.35 * k, 0.5);
    }
    sparks.end();
    // grit: dark ash clots and pumice flung ahead of the head, falling back into it (the scale of the camera)
    grit.begin();
    for (let i = 0; i < 520; i++) {
      const L = 1.6 + 2.2 * hf(i, 131);
      const age = ((t + hf(i, 132) * L) % L + L) % L;
      if (t - age < tStart) continue;
      const v = (hf(i, 133) - 0.5) * Wd * 0.95 * taper(front(t, 0));
      const vu = speed * (1.0 + 0.45 * hf(i, 134)), vy = 6 + 22 * hf(i, 135);
      const [x, z] = F.toWorld(front(t - age, v) - 5 + vu * age, v + (hf(i, 136) - 0.5) * 20 * age);
      const gy = hs(x, z), y = gy + 4 + 30 * hf(i, 137) + vy * age - 4.9 * age * age;
      if (y < gy) continue;
      const k = 1 - sstep(L * 0.6, L, age), c = 0.08 + 0.1 * hf(i, 138);
      grit.push(x - at[0], y, z - at[1], c * k + 0.16 * (1 - k), c * k + 0.15 * (1 - k), c * k + 0.14 * (1 - k), (0.25 + 1.1 * hf(i, 139)) * (0.4 + 0.6 * k));
    }
    grit.end();
    for (let k = 0; k < 3; k++) {
      const v = (k - 1) * Wd * 0.3, u = front(t, v) - 30;
      const [x, z] = F.toWorld(u, v);
      lights[k].position.set(x - at[0], hs(x, z) + 60, z - at[1]);
      lights[k].intensity = 90000 * heat * (0.85 + 0.15 * fbm1(t * 2, seed + k)) * (vent ? sstep(tStart, tStart + 0.5, t) * taper(u) : 1);
    }
  }
  update(0, 0, null);
  return { root, radius: 200, height: 120, snapped: true, update, anchors: { front: (t) => F.toWorld(front(t, 0), 0) } };
}

// ── eruption column ─────────────────────────────────────────────────────────────────────────────────────────────
async function buildEruption(item, ctx) {
  const p = item.params || {};
  const G = ctx.ground, at = item.at || [0, 0];
  let gy0 = G.height(at[0], at[1]);
  const root = new THREE.Group(); root.name = 'fx.eruption';
  const seed = (item.seed ?? 5) | 0;
  const Hc = +(p.height ?? 9000), Ru = +(p.umbrella ?? 9000), onset = +(p.onset ?? -200), rate = +(p.rate ?? 1);
  const lightK = clamp(+(p.lightning ?? 1), 0, 2), bombK = clamp(+(p.bombs ?? 1), 0, 2);
  // Q4 caldera mode (opt-in): a supereruption from a ring fracture, no cone (see calderaPuffs)
  const CAL = p.caldera === true || p.caldera === 'true';
  const wantCone = !CAL && (p.cone === true || p.cone === 'true' || ((p.cone ?? 'auto') === 'auto' && gy0 < 150));
  let coneH = 0;
  if (wantCone) {
    coneH = +(p.coneHeight ?? 1500); const R = +(p.coneRadius ?? 4800);
    const geo = new THREE.CylinderGeometry(1, 1, 1, 160, 40, true);
    const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const a = Math.atan2(P.getZ(i), P.getX(i)), yy = P.getY(i) + 0.5;           // 0 bottom .. 1 top
      const q = 1 - yy;                                                            // radial fraction
      const rr = lerp(260, R, Math.pow(q, 0.85)) * (1 + 0.05 * Math.sin(a * 7 + seed) + 0.03 * Math.sin(a * 19));
      const hh = coneH * Math.pow(1 - q, 1.9) * (1 + 0.04 * Math.sin(a * 13 + q * 20));
      P.setXYZ(i, Math.cos(a) * rr, hh - 30, Math.sin(a) * rr);
    }
    geo.computeVertexNormals();
    const mat = stdMat(ctx, { color: 0x3a3532, roughness: 0.95, flatShading: false });
    const cone = new THREE.Mesh(geo, mat); cone.castShadow = cone.receiveShadow = true; cone.name = 'fx.eruption.cone';
    root.add(cone);
  }
  root.position.set(at[0], gy0, at[1]);
  const vy = coneH;                                            // vent height above the root
  // Q4: the eruption is always the farthest thing in its shots (kilometres away): it draws before everything else
  // that is transparent (render order 9.x < puffs, weather, the pyroclastic flow at 10), so a nearer ash cloud covers
  // the vent jet, the bombs and the lightning instead of the glow hanging in front of it as a bright dot
  const tCol = p.collapse != null && p.collapse !== '' && Number.isFinite(+p.collapse) ? +p.collapse : null;
  const HF = +(p.collapseH ?? Math.min(Hc * 0.3, 2600));
  const colDir = tCol != null && p.collapseDir != null && Number.isFinite(+p.collapseDir) ? +p.collapseDir : null;
  const colSpd = +(p.collapseSpeed ?? 280);
  const puffs = makePuffs(ctx, { count: CAL ? 6200 : tCol == null ? 3300 : (colDir == null ? 4700 : 5600), tint: [0.34, 0.32, 0.31], glow: HOT, heat: [1.0, 0.36, 0.1], heatHDR: 2.4, near: 60, groundFade: 0.1, order: 9.0, softK: 0.2 });
  const sparks = makeSparks(ctx, { count: 2400, maxPx: 4, minPx: 1.4, order: 9.3 });
  const flames = makeFlames(ctx, { count: 60, hdr: 0.8, order: 9.2 });
  root.add(puffs.mesh, sparks.mesh, flames.mesh);
  // lightning: a few jagged bolts inside the plume (additive lines), flashing on hashed times
  const NBOLT = 5, SEG = 22;
  const boltGeo = new THREE.BufferGeometry();
  const bp = new Float32Array(NBOLT * SEG * 2 * 3), bc = new Float32Array(NBOLT * SEG * 2 * 3);
  boltGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3)); boltGeo.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const bolts = new THREE.LineSegments(boltGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  bolts.frustumCulled = false; bolts.userData.noQA = true; bolts.renderOrder = 9.4; root.add(bolts);
  const flash = new THREE.PointLight(new THREE.Color(0.75, 0.8, 1.0), 0, 12000, 2); root.add(flash);
  const glowL = new THREE.PointLight(new THREE.Color(1, 0.4, 0.12), 0, 9000, 2); glowL.position.set(0, vy + 300, 0); root.add(glowL);

  const colR = (h) => 120 + 0.11 * h;                          // column radius grows with height (entrainment)
  const w0 = 160 * rate;                                       // exit velocity (m/s, scaled)
  // height reached after `age` s: fast jet decelerating into the convective rise, capped at Hc
  const riseH = (age) => Math.min(Hc, (w0 * 18) * (1 - Math.exp(-age / 18)) + 25 * rate * age);
  const NCOL = 2200, NUMB = 900, NFO = 360, NFC = 70, NSP = 240, NFL = 380;
  const _cf = new THREE.Vector3(), _cv = [0, 0, 0];
  // the ground under the fountain and the spill: the cone's own surface or the terrain (root frame)
  const coneR = +(p.coneRadius ?? 4800);
  const coneSurf = (r) => { if (r <= 260) return coneH - 30; const q = Math.pow(clamp((r - 260) / Math.max(coneR - 260, 1)), 1 / 0.85); return coneH * Math.pow(1 - q, 1.9) - 30; };
  const surfAt = (x, z) => Math.max(G.height(at[0] + x, at[1] + z) - gy0, wantCone ? coneSurf(Math.hypot(x, z)) : -1e9);
  const sScale = clamp(Hc / 9000, 0.6, 1.6);
  // ── Q4 caldera mode (`caldera: true`, ring radius `calderaR`): a supereruption from a ring fracture on the flat
  // plateau, no cone. Jets from a ring of vents (incandescent at the base) lean in and merge into a column several km
  // wide that convects in big overturning billows (curl noise, deterministic in t) with smaller billows riding them,
  // spreads into an umbrella towards the horizon (lit on top, dark and lumpy underneath), and pushes a ground-hugging
  // ash surge out across the plain. With onset < 0 it is seen at its climax (the column is already at full height).
  const Rb = +(p.calderaR ?? clamp(Hc * 0.125, 1500, 5000));
  const NV = CAL ? Math.round(clamp(Rb / 220, 10, 22)) : 0, NJ = 600, NCC = 1700, NUC = 1500, NSG = 260;
  const vents = [];
  for (let k = 0; k < NV; k++) {
    const a = (k + 0.4 * (hf(k, 201) - 0.5)) / NV * 6.2832, rr = Rb * (0.9 + 0.16 * hf(k, 202));
    const vx = Math.cos(a) * rr, vz = Math.sin(a) * rr;
    vents.push([vx, vz, G.height(at[0] + vx, at[1] + vz) - gy0, 0.75 + 0.5 * hf(k, 203)]);
  }
  const colRc = (h) => Rb * 0.85 + 0.15 * h;                   // wide from the start, widening with height
  const hJ = clamp(Rb * 0.6, 900, 2400), wJ = 240 * rate, wC = 70 * rate, h0C = hJ * 0.2, LcC = (Hc - h0C) / wC;
  const sU = clamp(Hc / 24000, 0.4, 1.5), sR = clamp(Rb / 3000, 0.5, 1.6);
  function calderaPuffs(t, tE, sun) {
    const sx = sun.x, sz = sun.z, sy = sun.y;
    const side = (x, z, rl) => sstep(-0.45, 0.6, (x * sx + z * sz) / (rl || 1) * 0.85 + sy * 0.3);
    // 1. the vent jets: fast and narrow, glowing at the base, widening and leaning in until they merge
    if (tE > 0) for (let i = 0; i < NJ; i++) {
      const v = vents[i % NV], Lj = hJ / wJ * (0.85 + 0.3 * hf(i, 211)), age = ((t + hf(i, 212) * Lj) % Lj + Lj) % Lj;
      const f = age / Lj, h = hJ * 1.1 * f, rj = (60 + 0.3 * h) * v[3];
      const ang = hf(i, 213) * 6.2832, rr = rj * 0.6 * Math.sqrt(hf(i, 214)), lean = 1 - 0.2 * f * f;
      const x = v[0] * lean + Math.cos(ang) * rr, z = v[1] * lean + Math.sin(ang) * rr, y = v[2] + h;
      const occ = clamp(0.34 + 0.58 * side(x, z, Math.hypot(x, z)));
      puffs.push(x, y, z, rj * (0.75 + 0.35 * hf(i, 215)), hf(i, 216) * 6.28 + f * 1.5, 0.92 * sstep(0, 0.05, f) * (1 - sstep(0.72, 1, f)), i & 3, -1e4, 0.5,
        0.9 * Math.exp(-h / 450), 0.55 * Math.exp(-h / 200), 0.15, 0.08 + 0.2 * f, occ, hf(i, 217), 0.8 * Math.pow(1 - occ, 1.5));
    }
    // 2. the column: parcels rise at the convective speed through overturning eddies the size of the column
    for (let i = 0; i < NCC; i++) {
      const age = ((t + hf(i, 221) * LcC) % LcC + LcC) % LcC;
      if (onset >= 0 && age > tE) continue;
      const h = h0C + wC * age;
      if (h > Hc * 1.02) continue;
      const hn = h / Hc, R = colRc(h), u = hf(i, 222), ang0 = hf(i, 223) * 6.2832;
      const rf = lerp(0.72 + 0.28 * u, Math.pow(u, 0.4), sstep(h0C, hJ * 1.7, h));   // low down an annulus fed by the jets
      curl3(Math.cos(ang0) * 2.2, (h - 0.55 * wC * t) / (R * 1.1), Math.sin(ang0) * 2.2, 41 + (i & 3), _cv);
      const ang = ang0 + 0.12 * _cv[1], rad = R * rf * (1 + 0.22 * _cv[0]);
      // low down the parcel still rides one of the jets (leaning in): the column grows out of the ring, no flat floor
      const v = vents[i % NV], mJ = sstep(h0C, hJ * 1.6, h), lean = 1 - 0.2 * Math.min(1, h / (1.1 * hJ)) ** 2;
      const x = lerp(v[0] * lean, Math.cos(ang) * rad + 0.12 * R * _cv[2], mJ), z = lerp(v[1] * lean, Math.sin(ang) * rad - 0.12 * R * _cv[0], mJ);
      const y = h + v[2] * (1 - mJ) + 0.2 * R * _cv[1] * mJ;
      const size = lerp((60 + 0.3 * h) * v[3] * 1.15, R * (0.36 + 0.26 * hf(i, 225)) * (0.8 + 0.2 * rf), mJ), rl = Math.hypot(x, z) || 1;
      const occ = clamp((0.34 + 0.6 * side(x, z, rl)) * (0.62 + 0.38 * rf));
      const a = 0.9 * sstep(h0C, h0C + 400, h) * (1 - sstep(0.9 * Hc, 1.02 * Hc, h));
      const soft = clamp(0.12 + 0.4 * hn), bl = clamp(0.8 * Math.pow(1 - occ, 1.5) + 0.35 * (1 - rf));
      const spin = hf(i, 226) * 6.28 + age * 0.006 * (hf(i, 227) - 0.5), glow = 0.7 * Math.exp(-h / 1200), alb = 0.6 + 0.22 * hn + 0.1 * hf(i, 228);
      puffs.push(x, y, z, size, spin, a, i & 3, -1e4, alb, glow, 0, 0.1, soft, occ, hf(i, 229), bl);
      if (rf > 0.62) {                                             // a smaller billow riding the parcel's outer, upper side
        const kd = size * 0.62, ux = x / rl, uz = z / rl;
        puffs.push(x + ux * kd * 0.75, y + kd * 0.45, z + uz * kd * 0.75, size * 0.47, spin * 1.4 + 1.9, a * 0.95, (i + 1) & 3, -1e4, alb + 0.04,
          glow * 0.6, 0, 0.05, soft + 0.04, clamp(occ + 0.08), hf(i, 230), bl * 0.6);
      }
    }
    // 3. the umbrella: spreads from the column top towards the horizon, flattened; lit on top, dark and lumpy underneath
    if (onset < 0 || h0C + wC * tE >= Hc) {
      const R0 = colRc(Hc), Lu = 420;
      for (let i = 0; i < NUC; i++) {
        const age = ((t + hf(i, 241) * Lu) % Lu + Lu) % Lu;
        if (onset >= 0 && age > tE - LcC) continue;
        const ang = hf(i, 242) * 6.2832 + 0.03 * vn(age * 0.01 + i, 243);
        const edge = Ru * (0.84 + 0.16 * vn(ang * 3 + seed, 244)), rr = R0 * 0.5 + (edge - R0 * 0.5) * Math.sqrt(age / Lu);
        const q = rr / Math.max(Ru, 1), Tk = Hc * 0.2 * (1 - 0.55 * Math.min(q, 1)), yl = hf(i, 245) - 0.5;
        const dome = Hc * 0.1 * Math.exp(-((rr / (R0 * 1.6)) ** 2));             // the overshooting top above the column
        const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr, y = Hc * 0.97 + dome + yl * Tk * 0.8 - Hc * 0.04 * q * q;
        const size = (1300 + 1500 * hf(i, 246)) * (0.75 + 0.6 * Math.min(q, 1)) * sU, top = yl + 0.5;
        const occ = clamp(0.16 + 0.72 * sstep(-0.3, 0.7, sy * (0.3 + top) + (x * sx + z * sz) / (rr || 1) * 0.35 * (1 - top)));
        const a = 0.8 * sstep(0, 15, age) * (1 - 0.7 * sstep(0.9, 1.0, rr / edge)) * (1 - sstep(0.85 * Lu, Lu, age));
        puffs.push(x, y, z, size, hf(i, 247) * 6.28 + age * 0.004, a, i & 3, -1e4, 0.66 + 0.2 * hf(i, 248), 0, 0, -0.3, clamp(0.28 + 0.4 * q), occ, hf(i, 249),
          0.55 * Math.pow(1 - occ, 1.5));
      }
    }
    // 4. the ground surge: a low collar of ash pouring out from the ring (short run-out: it must not wall off the vents)
    for (let i = 0; i < NSG; i++) {
      const Ls = 40, age = ((t + hf(i, 261) * Ls) % Ls + Ls) % Ls;
      if (age > tE) continue;
      const ang = hf(i, 262) * 6.2832, V = (12 + 12 * hf(i, 263)) * rate * sR;
      const rr = Rb * 1.02 + V * age * (1 - 0.3 * age / Ls), x = Math.cos(ang) * rr, z = Math.sin(ang) * rr;
      const size = (170 + 5 * age + 110 * hf(i, 264)) * sR, y = G.height(at[0] + x, at[1] + z) - gy0 + size * (0.45 + 0.004 * age);
      const occ = clamp(0.3 + 0.6 * sstep(-0.4, 0.6, sy * 0.7 + (Math.cos(ang) * sx + Math.sin(ang) * sz) * 0.6));
      puffs.push(x, y, z, size, hf(i, 265) * 6.28 + age * 0.01, 0.85 * sstep(0, 3, age) * (1 - sstep(Ls * 0.6, Ls, age)), i & 3, -1e4, 0.55,
        0.5 * Math.exp(-age / 8), 0, 0, 0.15 + 0.006 * age, occ, hf(i, 266), 0.8 * Math.pow(1 - occ, 1.5));
    }
  }
  function update(t, clock, camera) {
    syncEnv(ctx);
    const tE = t - onset;                                        // time since the eruption began
    puffs.begin();
    // Q4: column and umbrella as lit billows: the side of the column towards the sun and the umbrella's top are lit,
    // the far side and the underside of the umbrella sit in their own shadow; young billows near the vent are crisp
    const sun = U.uSunDir.value;
    if (CAL) calderaPuffs(t, tE, sun);
    else for (let i = 0; i < NCOL + NUMB; i++) {
      const umb = i >= NCOL;
      const L = umb ? 160 : 70 + 30 * hf(i, 3);
      const age = ((t + hf(i, 4) * L) % L + L) % L;
      if (age > tE) continue;                                     // not born yet
      const ang = hf(i, 5) * Math.PI * 2;
      let x, y, z, size, a, heatK = 0, glow = 0, alb = 0.55;
      if (!umb) {
        const h = riseH(age * rate);
        const r = colR(h) * Math.sqrt(hf(i, 6)) * 0.85;
        const wob = 90 * vn(age * 0.15 + i * 0.1, 7) + 0.02 * h * vn(h / 900 + i, 8);
        x = Math.cos(ang) * r + wob; z = Math.sin(ang) * r + 0.6 * wob;
        y = vy + h;
        size = colR(h) * (0.5 + 0.32 * hf(i, 9));                     // Q4: more overlap (was 0.42 + 0.3: gaps read as grapes)
        a = 0.85 * sstep(0, 3, age) * (1 - sstep(0.8 * Hc, 0.96 * Hc, h));
        if (tCol != null && t - age > tCol) a *= 1 - 0.6 * sstep(tCol, tCol + 1.5, t - age);   // the plume starves once the column collapses
        heatK = Math.exp(-h / 420) * 0.85;
        glow = 0.55 * Math.exp(-h / 1100);                             // Q4: lit by the jet only low down (was a pink pillar)
        alb = 0.45 + 0.35 * clamp(h / Hc);
        if (h >= Hc * 0.97) continue;
      } else {
        // umbrella: spreads radially at the top, thinning towards its edge
        const grow = Math.min(Ru, Ru * Math.sqrt(clamp(age * rate / 120)));
        const rr = grow * Math.sqrt(hf(i, 10));
        const lift = 900 * (1 - rr / Math.max(Ru, 1)) * (0.4 + 0.6 * hf(i, 11));
        x = Math.cos(ang) * rr; z = Math.sin(ang) * rr;
        y = vy + Hc * 0.9 + lift + 300 * vn(i * 0.3, 12);
        size = 700 + 900 * hf(i, 13) * (0.5 + rr / Math.max(Ru, 1));
        a = 0.75 * sstep(0, 8, age) * (1 - sstep(L * 0.8, L, age)) * sstep(Hc * 0.8, Hc, riseH(tE * rate));
        alb = 0.7 + 0.2 * hf(i, 14);
      }
      // Q4 round 2: a higher occ floor, softer edges and `blend` (flat shading deep in the shadow) so the shadow side
      // reads as one convecting volume, not separate dark balls
      let occ, soft, bl;
      if (!umb) {
        const rl = Math.hypot(x, z) || 1, rn = clamp(rl / (colR(y - vy) * 0.9));
        occ = clamp((0.36 + 0.58 * sstep(-0.45, 0.6, (x * sun.x + z * sun.z) / rl * 0.85 + sun.y * 0.3)) * (0.74 + 0.26 * rn));
        soft = clamp(0.16 + 0.55 * clamp((y - vy) / Hc));
        bl = clamp(0.8 * Math.pow(1 - occ, 1.5) + 0.25 * (1 - rn));
      } else {
        const rr = Math.hypot(x, z) || 1, top = clamp((y - vy - Hc * 0.9) / 900 + 0.3);
        occ = clamp(0.2 + 0.65 * sstep(-0.3, 0.7, sun.y * (0.4 + top) + (x * sun.x + z * sun.z) / rr * 0.5));
        soft = clamp(0.3 + 0.5 * rr / Math.max(Ru, 1));
        bl = 0.5 * Math.pow(1 - occ, 1.5);
      }
      puffs.push(x, y, z, size, hf(i, 15) * 6.28 + age * 0.02, a, i & 3, -1e4, alb, glow, heatK, 0.1, soft, occ, hf(i, 16), bl);
    }
    // Q4 column collapse: a fountain up to HF that falls back round the vent, then spills down the flanks
    if (tCol != null && t > tCol) {
      const on = sstep(tCol, tCol + 0.6, t);
      for (let i = 0; i < NFO; i++) {
        const Tf = 1.7 + 0.6 * hf(i, 81), age = ((t + hf(i, 82) * Tf) % Tf + Tf) % Tf;
        if (t - age < tCol) continue;
        const f = age / Tf, ang = hf(i, 83) * 6.2832, rOut = (480 + 560 * hf(i, 84)) * sScale, ca = Math.cos(ang), sa = Math.sin(ang);
        const r = 90 + (rOut - 90) * Math.pow(f, 1.1), x = ca * r, z = sa * r;
        // Q4 round 2: bigger, softer, more of them (360, was 260 of 140-420 m), a higher occ floor and `blend`: the
        // curtain is one churning mass, not a bunch of dark grapes
        const size = (170 + 230 * f + 90 * hf(i, 85)) * sScale;
        const y = Math.max(vy + HF * (0.75 + 0.25 * hf(i, 86)) * 4 * f * (1 - f), surfAt(x, z) + size * 0.45);
        const occF = clamp(0.28 + 0.56 * sstep(-0.3, 0.6, sun.y * 0.8 + (ca * sun.x + sa * sun.z) * 0.6) - 0.06 * (1 - f)), blF = 0.85 * Math.pow(1 - occF, 1.5);
        // glow and heat by height (not by age) and shared with the rim billow: a cold dark kid on a hot orange parent
        // read as a dark ball
        const spin = hf(i, 87) * 6.28 + f * 2.2 * (hf(i, 88) - 0.5), dyF = Math.max(0, y - vy), glowF = 0.9 * Math.exp(-dyF / 600), heatF = 0.4 * Math.exp(-dyF / 380);
        puffs.push(x, y, z, size, spin, 0.95 * sstep(0, 0.06, f) * on, i & 3, -1e4, 0.42 + 0.14 * f, glowF, heatF, 0.1, 0.18 + 0.32 * f, occF, hf(i, 89), blF);
        // the curtain's outer, upper rim billow (it overturns outwards as it falls)
        const kd = size * 0.6;
        puffs.push(x + ca * kd * 0.8, y + kd * (0.6 - f), z + sa * kd * 0.8, size * 0.55, spin * 1.3 + 1.7, 0.9 * sstep(0, 0.06, f) * on, (i + 1) & 3, -1e4, 0.44 + 0.14 * f,
          glowF * 0.9, heatF * 0.85, 0.1, 0.24 + 0.32 * f, clamp(occF + 0.06), hf(i, 90), blF * 0.8);
      }
      // the fountain's dense core: big, flat-shaded billows inside the curtain, so no sky shows between its lobes
      for (let i = 0; i < NFC; i++) {
        const Tf = 1.9 + 0.5 * hf(i, 131), age = ((t + hf(i, 132) * Tf) % Tf + Tf) % Tf;
        if (t - age < tCol) continue;
        const f = age / Tf, ang = hf(i, 133) * 6.2832, rOut = (260 + 300 * hf(i, 134)) * sScale, ca = Math.cos(ang), sa = Math.sin(ang);
        const r = 60 + (rOut - 60) * Math.pow(f, 1.2), x = ca * r, z = sa * r, size = (260 + 200 * f + 80 * hf(i, 135)) * sScale;
        const y = Math.max(vy + HF * (0.62 + 0.25 * hf(i, 136)) * 4 * f * (1 - f), surfAt(x, z) + size * 0.4);
        const occC = clamp(0.3 + 0.3 * sstep(-0.3, 0.6, sun.y * 0.8 + (ca * sun.x + sa * sun.z) * 0.5));
        puffs.push(x, y, z, size, hf(i, 137) * 6.28 + f, 0.95 * sstep(0, 0.08, f) * on, i & 3, -1e4, 0.42 + 0.1 * f, 0.9 * Math.exp(-Math.max(0, y - vy) / 700),
          0.35 * Math.exp(-Math.max(0, y - vy) / 380), 0.1, 0.35 + 0.2 * f, occC, hf(i, 138), 0.9);
      }
      for (let i = 0; i < NSP; i++) {
        const Ts = 5 + 3 * hf(i, 91), age = ((t + hf(i, 92) * Ts) % Ts + Ts) % Ts;
        if (t - age < tCol + 1.0) continue;                           // the first curtains land ~1 s after the collapse
        const ang = hf(i, 93) * 6.2832, V = (180 + 120 * hf(i, 95)) * sScale;
        const r = (450 + 450 * hf(i, 94)) * sScale + V * age * (1 - 0.15 * age / Ts), x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const size = (170 + 60 * age + 65 * hf(i, 96)) * sScale;
        const y = surfAt(x, z) + size * (0.5 + 0.12 * age);
        const occS = clamp(0.28 + 0.56 * sstep(-0.35, 0.6, sun.y * 0.7 + (Math.cos(ang) * sun.x + Math.sin(ang) * sun.z) * 0.7)), blS = 0.85 * Math.pow(1 - occS, 1.5);
        const rollS = age * 0.25 * (hf(i, 97) - 0.3), al = 0.9 * sstep(0, 0.3, age) * (1 - sstep(Ts * 0.6, Ts, age));
        puffs.push(x, y, z, size, hf(i, 98) * 6.28 + rollS, al, i & 3, -1e4, 0.44, 0.7 * Math.exp(-age / 2.5), 0.25 * Math.exp(-age / 1.5), 0.05, 0.2 + 0.12 * age, occS, hf(i, 99), blS);
        const kd = size * 0.62;                                          // the head's upper, outer rim billow
        puffs.push(x + Math.cos(ang) * kd * 0.7, y + kd * 0.65, z + Math.sin(ang) * kd * 0.7, size * 0.55, hf(i, 100) * 6.28 + rollS * 1.4, al * 0.95, (i + 2) & 3, -1e4, 0.47,
          0.6 * Math.exp(-age / 2.5), 0.2 * Math.exp(-age / 1.5), 0.05, 0.26 + 0.12 * age, clamp(occS + 0.06), hf(i, 101), blS * 0.8);
      }
      // the main lobe: a pyroclastic flow pouring down the flank towards colDir, stretching as its head runs away
      if (colDir != null && t > tCol + 1.0) {
        const run = t - tCol - 1.0, dx = Math.sin(colDir * DEG), dz = -Math.cos(colDir * DEG), rx = Math.cos(colDir * DEG), rz = Math.sin(colDir * DEG);
        const Vf = colSpd * sScale, r0 = 480 * sScale, headR = r0 + Vf * run * (1 - 0.1 * Math.min(run, 6) / 6);
        let rollS = 0;
        if (camera) { camera.getWorldDirection(_cf); rollS = rx * _cf.x + rz * _cf.z; }
        const fwS = dx * sun.x + dz * sun.z;
        for (let i = 0; i < NFL; i++) {
          const lag = Math.pow(hf(i, 111), 0.85), d = r0 + (headR - r0) * (1 - lag);
          const age = (headR - d) / Vf, wid = (150 + 0.36 * (d - r0)) * (0.5 + 0.5 * sScale);
          const lat = (hf(i, 112) - 0.5) * 2 * wid * (0.55 + 0.45 * hf(i, 113));
          const x = dx * d + rx * lat, z = dz * d + rz * lat;
          const head = lag < 0.1 ? 1 : 0;
          const size = (160 + 130 * hf(i, 114)) * sScale * (1 + 0.45 * Math.min(age, 4) / 4) * (head ? 1.2 : 1);
          const rise = size * (0.45 + 0.22 * Math.min(age, 4)) + 50 * hf(i, 115) * Math.min(age, 4);
          const y = surfAt(x, z) + rise;
          const edge = 1 - sstep(0.75, 1, Math.abs(lat) / wid);
          const al = 0.9 * sstep(0, 0.25, run) * edge * (1 - sstep(0.93, 1, lag) * 0.7);
          const hN = clamp(rise / (size * 1.6)), sdL = sstep(-0.35, 0.6, ((1 - hN) * fwS * Math.exp(-age / 1.5) + (0.4 + hN) * sun.y) / 1.1);
          const occL = clamp(0.16 + 0.7 * sdL + (hf(i, 116) - 0.5) * 0.1), blL = 0.8 * Math.pow(1 - occL, 1.5);
          const spin = hf(i, 117) * 6.28 + rollS * (Vf * Math.min(age, 3)) / size * 0.3;
          const glowL = 0.9 * Math.exp(-age / 2) * Math.exp(-rise / (size * 1.2)), heatL = 0.3 * Math.exp(-age / 1.2) * head;
          puffs.push(x, y, z, size, spin, al, i & 3, -1e4, 0.44 + 0.1 * hN, glowL, heatL, 0.05, 0.14 + 0.12 * Math.min(age, 4), occL, hf(i, 118), blL);
          const kd = size * 0.6, ku = 0.35 + 0.6 * hf(i, 119);          // a rim billow on its forward / upper side
          puffs.push(x + dx * kd * (1 - ku) * 0.9 + rx * (hf(i, 120) - 0.5) * kd, y + kd * ku, z + dz * kd * (1 - ku) * 0.9 + rz * (hf(i, 120) - 0.5) * kd, size * 0.52,
            spin * 1.3 + 2.1, al * 0.95, (i + 1) & 3, -1e4, 0.47 + 0.1 * hN, glowL * 0.8, heatL * 0.7, 0.05, 0.2 + 0.12 * Math.min(age, 4), clamp(occL + 0.06), hf(i, 121), blL * 0.7);
        }
      }
    }
    puffs.end(camera);
    // incandescent jet at the vent
    flames.begin(t);
    if (CAL && tE > 0) for (let k = 0; k < NV * 2; k++) {               // caldera: a fire fountain at every ring vent
      const v = vents[k % NV];
      flames.push(v[0] + (hf(k, 47) - 0.5) * 160 * v[3], v[2] - 20, v[1] + (hf(k, 48) - 0.5) * 160 * v[3], (320 + 380 * hf(k, 43)) * v[3] * (0.7 + 0.3 * vn(t * 1.1 + k, 44)),
        (160 + 140 * hf(k, 45)) * v[3], hf(k, 46), 0.5, 0.5);
    }
    else if (tE > 0) for (let k = 0; k < 40; k++) {
      const ang = hf(k, 41) * 6.28, r = 60 * Math.sqrt(hf(k, 42));
      flames.push(Math.cos(ang) * r, vy - 20, Math.sin(ang) * r, (160 + 220 * hf(k, 43)) * (0.7 + 0.3 * vn(t * 1.3 + k, 44)), 90 + 80 * hf(k, 45), hf(k, 46), 0.5, 0.5);
    }
    flames.end();
    // ballistic bombs with glowing trails
    sparks.begin();
    if (bombK > 0 && tE > 0) for (let b = 0; b < 140 * bombK; b++) {
      const L = 14 + 10 * hf(b, 51);
      const age = ((t + hf(b, 52) * L) % L + L) % L;
      const ang = hf(b, 53) * 6.28, el = (55 + 30 * hf(b, 54)) * DEG, v0 = 110 + 120 * hf(b, 55);
      const vh = v0 * Math.cos(el), vv = v0 * Math.sin(el);
      const vo = CAL ? vents[b % NV] : null, ox = vo ? vo[0] : 0, oz = vo ? vo[1] : 0, oy = vo ? vo[2] : vy;
      for (let k = 0; k < 8; k++) {
        const ta = age - k * 0.06;
        if (ta < 0) break;
        const hx = ox + Math.cos(ang) * vh * ta, hz = oz + Math.sin(ang) * vh * ta, hy = oy + vv * ta - 4.9 * ta * ta;
        const gh = G.height(at[0] + hx, at[1] + hz) - gy0;
        if (hy < gh) break;
        const f = (1 - k / 8) * (1 - sstep(L * 0.7, L, age));
        sparks.push(hx, hy, hz, 9 * f, 3 * f, 0.6 * f, k ? 5 : 8);
      }
    }
    sparks.end();
    // lightning: bolts flicker for ~0.25 s at hashed moments
    let fl = 0;
    const slot = Math.floor(t / 0.9);
    for (let b = 0; b < NBOLT; b++) {
      const s = slot * NBOLT + b, t0 = s / NBOLT * 0.9 + hf(s, 61) * 0.5;
      const on = lightK > 0 && hf(s, 62) < 0.33 * lightK && tE > 8 && t >= t0 && t < t0 + 0.25;
      const k = on ? (Math.sin((t - t0) / 0.25 * Math.PI) * (0.6 + 0.4 * (Math.sin((t - t0) * 90) > 0 ? 1 : 0.3))) : 0;
      fl = Math.max(fl, k);
      // caldera: bolts in the lower column (where the shots see it), scaled to the wider column
      const hA = CAL ? Hc * (0.06 + 0.3 * hf(s, 63)) : vy + riseH(tE * rate) * (0.25 + 0.5 * hf(s, 63)), ang = hf(s, 64) * 6.28;
      const r0 = CAL ? colRc(hA) * 0.75 : colR(hA - vy) * 0.6, bS = CAL ? 2.5 : 1;
      let px = Math.cos(ang) * r0, py = hA, pz = Math.sin(ang) * r0;
      for (let j = 0; j < SEG; j++) {
        const nx = px + (hf(s * 97 + j, 65) - 0.5) * 260 * bS, ny = py - (60 + 90 * hf(s * 97 + j, 66)) * bS, nz = pz + (hf(s * 97 + j, 67) - 0.5) * 260 * bS;
        const o = (b * SEG + j) * 6;
        bp[o] = px; bp[o + 1] = py; bp[o + 2] = pz; bp[o + 3] = nx; bp[o + 4] = ny; bp[o + 5] = nz;
        for (let c = 0; c < 6; c += 3) { bc[o + c] = 6 * k; bc[o + c + 1] = 6.5 * k; bc[o + c + 2] = 8 * k; }
        px = nx; py = ny; pz = nz;
        if (j === Math.floor(SEG / 2)) flash.position.set(px, py, pz);
      }
    }
    boltGeo.attributes.position.needsUpdate = boltGeo.attributes.color.needsUpdate = true;
    flash.intensity = fl * 4e8;
    glowL.intensity = tE > 0 ? 2e7 * (0.85 + 0.15 * fbm1(t * 1.5, seed)) : 0;
  }
  update(0, 0, null);
  return { root, radius: 800, height: 400, snapped: true, update, anchors: { vent: [at[0], gy0 + vy, at[1]] } };
}

export async function build(kind, item, ctx) {
  if (kind === 'fx.pyroclastic') return buildPDC(item, ctx);
  return buildEruption(item, ctx);
}
