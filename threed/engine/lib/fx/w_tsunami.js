// w_tsunami.js — fx.tsunami: a coastal tsunami. A wall of water with a curling foam crest comes in from the sea,
// hits the shoreline, collapses into a churning bore and runs up inland as a debris-laden surge through the streets,
// lifting parked cars and knocking over trees, poles and fences. mode 'knee' is the close-up of a mannequin standing
// in the street when knee-deep fast water arrives and sweeps him off his feet.
//
// Frame: `at` is the shoreline point where the wave lands; `heading` is the direction the wave travels (compass deg,
// toward the land). s = distance along the travel from `at` (negative at sea), u = along the coast.
// Everything is a pure function of t (the front position is analytic, the debris ride on it).
import * as THREE from 'three';
import { prm, num, Puffs, Streaks, stdMat, NOISE_GLSL, carGeo, coniferGeo, plankGeo, sheetGeo, trunkGeo, mannequin, rng, clamp, lerp, smooth, sstep, fbm1, vnoise, gauss, TAU, DEG, lightsOf } from './w_common.js';

export const CATALOG = {
  'fx.tsunami': {
    desc: 'coastal tsunami: a wall of water with a foam crest lands at `at` (the shoreline) travelling along `heading` (toward the land), collapses into a bore and surges inland through the streets carrying debris, lifting cars, knocking over trees/poles/fences. mode "knee": close-up of a mannequin knocked down by knee-deep fast water. mode "drawback": the sea races out (the world ocean level eases from its own level to `to` over t0..t0+dur) and bares a wet seabed with ripples, tide pools, weed, rocks, coral, flopping fish (fish, fish_area [[x0,z0],[x1,z1]]) and a longtail boat on its side (boat, boat_at, boat_heading); `at` = a waterline point, heading = toward the land',
    actions: ['coast', 'knee', 'drawback'],
    // defaults (values). Also: t_arrive (s, when the front reaches `at`; default 0.45 x dur), cars/trees/poles (counts),
    // knee mode: knee_depth (m), t_hit (s, the water reaches the figure), flow (m/s), face 'downstream|upstream'
    params: { mode: 'coast', height: 12, speed: 16, width: 1400, inland: 420, depth: 8, curl: 0.8, debris: 220, props: true, knee_depth: 0.55, t_hit: 2.0, flow: 5.5 },
    footprint: [40, 40], height: 14, tags: ['disaster', 'water', 'wave', 'flood', 'fx'], section: 'objects', contact: false,
  },
};

export function waterMat(ctx, uT, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: o.rough ?? 0.14, metalness: 0.0, vertexColors: true, side: THREE.DoubleSide, envMapIntensity: o.env ?? 1.0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT;
    sh.uniforms.uFlow = o.uFlow || { value: new THREE.Vector2(0, 0) };
    sh.uniforms.uFlowOff = o.uFlowOff || { value: new THREE.Vector2(0, 0) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aFx; varying vec3 vFx; varying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFx = aFx; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uT; uniform vec2 uFlow; uniform vec2 uFlowOff; varying vec3 vFx; varying vec3 vWp;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        // foam: streaky lace stretched along the flow + churned patches where vFx.x (coverage) is high
        vec2 fl = normalize(uFlow + vec2(1e-4));
        vec2 fp = vWp.xz - uFlow * uT - uFlowOff;
        vec2 ap = vec2(dot(fp, fl), dot(fp, vec2(-fl.y, fl.x)));        // along / across the flow
        float dcam = length(vWp - cameraPosition);
        float lod = smoothstep(70.0, 520.0, dcam);                       // far away: coverage only (no aliasing comb)
        // (Q8) churned foam: domain-warped cells boiling in time, stretched along the flow; no vertical streaks
        // 3D in (along, up, across): a vertical face gets blobs, not the vertical stripes of a 2D pattern
        float mudK = smoothstep(0.05, 0.16, diffuseColor.r);
        vec3 fq = vec3(ap.x / ${(+(o.stretch ?? 1)).toFixed(2)}, vWp.y * 2.2, ap.y);   // (Q8) o.stretch: longer foam streaks along a fast current
        vec3 wq = fq * vec3(0.07, 0.07, 0.13) + vec3(uT * 0.2, -uT * 0.25, uT * 0.1);
        vec3 warp = vec3(fbm3(wq + vec3(3.1, 0.0, 0.0)), fbm3(wq + vec3(0.0, 5.7, 0.0)), fbm3(wq + vec3(0.0, 0.0, 8.3))) - 0.5;
        float n1 = fbm3(fq * vec3(0.06, 0.06, 0.15) + warp * 1.6 + vec3(0.0, -uT * 0.3, uT * 0.12));
        float n2 = fbm3(fq * vec3(0.3, 0.3, 0.7) + warp * 3.0 + vec3(0.0, -uT * 0.8, uT * 0.3));
        float n3 = vn3(fq * vec3(1.6, 1.6, 2.4) + vec3(0.0, -uT * 1.3, uT * 0.4));
        float cov = clamp(vFx.x, 0.0, 1.4);
        float lace = smoothstep(0.1, 0.03, abs(n2 - 0.5)) * smoothstep(0.35, 0.7, n1 + cov * 0.35) * smoothstep(0.3, 0.8, cov) * (1.0 - lod);
        float churn = (n2 - 0.5) * vFx.z * 0.8 * (1.0 - lod);
        float patchy = smoothstep(0.8 - cov * 0.46, 1.04 - cov * 0.4, mix(n1 + (n3 - 0.5) * 0.25 + churn, 0.5 + cov * 0.18, lod));
        float foam = clamp(max(patchy, lace * 0.8) * mix(0.78 + 0.22 * n3, 0.9, lod), 0.0, 1.0);
        vec3 foamCol = mix(vec3(0.95, 0.96, 0.97), vec3(0.6, 0.55, 0.46), clamp(diffuseColor.r * 2.2 - 0.12, 0.0, 0.75) + mudK * 0.2) * mix(0.8 + 0.22 * n3, 0.9, lod);
        diffuseColor.rgb = mix(diffuseColor.rgb, foamCol, foam);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n{ vec3 fn = normalize(cross(dFdx(vWp), dFdy(vWp))); float steep = smoothstep(0.35, 0.75, 1.0 - abs(fn.y));   // steep faces: a soft sheen, not rows of glints\n  roughnessFactor = mix(mix(max(roughnessFactor, steep * 0.34), 0.42, mudK), 0.95, foam); }')
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        { float e = 0.35; vec2 q = vWp.xz * 0.9 - (uFlow * uT + uFlowOff) * 0.9;
          float h0 = fbm3l(vec3(q, uT * 1.1)), hx = fbm3l(vec3(q + vec2(e, 0.0), uT * 1.1)), hz = fbm3l(vec3(q + vec2(0.0, e), uT * 1.1));
          vec3 dn = vec3(h0 - hx, 0.0, h0 - hz) * (${(o.bump ?? 0.6).toFixed(2)} * (1.0 - foam)) * (1.0 - smoothstep(40.0, 260.0, dcam));
          normal = normalize(normal + (viewMatrix * vec4(dn, 0.0)).xyz); }
        ${o.farBump ? `{ vec2 q2 = (vWp.xz - (uFlow * uT + uFlowOff)) * 0.11; float g0 = fbm3l(vec3(q2, uT * 0.35)), gx = fbm3l(vec3(q2 + vec2(0.2, 0.0), uT * 0.35)), gz = fbm3l(vec3(q2 + vec2(0.0, 0.2), uT * 0.35));
          vec3 dn2 = vec3(g0 - gx, 0.0, g0 - gz) * ${(+o.farBump).toFixed(2)} * (1.0 - foam) * smoothstep(80.0, 320.0, dcam) * (1.0 - smoothstep(1800.0, 5000.0, dcam));
          normal = normalize(normal + (viewMatrix * vec4(dn2, 0.0)).xyz); }` : ''}`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.02, 0.2, 0.17) * vFx.y * (1.0 - foam) * ${(o.sss ?? 1).toFixed(2)};
        totalEmissiveRadiance += foamCol * foam * 0.35 * lod * (1.0 - mudK);             // (Q8) far breaking foam stays white through the haze`);
  };
  return ctx.patch(m);
}

// ── the coastal wave + surge ───────────────────────────────────────────────────────────────────────────────────────
async function buildCoast(item, ctx) {
  const P = prm(item);
  const at = item.at || [0, 0];
  const hd = (item.heading ?? 270) * DEG;
  const dir = [Math.sin(hd), -Math.cos(hd)], perp = [-dir[1], dir[0]];
  const level = ctx.water?.level ?? 0;
  const H = num(P.height, 12), V0 = num(P.speed, 16), W = num(P.width, 1400), INL = num(P.inland, 420), D0 = num(P.depth, 8);
  const CURL = clamp(num(P.curl, 0.8)), dur = ctx.dur ?? 12;
  const tA = num(P.t_arrive, dur * 0.45);
  const root = new THREE.Group(); root.name = 'fx.tsunami';
  const gy0 = ctx.ground.height(at[0], at[1]);
  root.position.set(at[0], gy0, at[1]);
  const G = ctx.ground.height;
  const W2 = (s, u) => [at[0] + dir[0] * s + perp[0] * u, at[1] + dir[1] * s + perp[1] * u];
  // ground grid in (s, u) for fast lookups
  const S0 = -700, S1 = INL + 160, DS = 3, U0 = -W / 2 - 20, DU = 8, NS = Math.ceil((S1 - S0) / DS) + 1, NU = Math.ceil((W + 40) / DU) + 1;
  const GG = new Float32Array(NS * NU);
  for (let i = 0; i < NS; i++) for (let j = 0; j < NU; j++) { const w = W2(S0 + i * DS, U0 + j * DU); GG[i * NU + j] = G(w[0], w[1]); }
  const gAt = (s, u) => {
    const fi = clamp((s - S0) / DS, 0, NS - 1.001), fj = clamp((u - U0) / DU, 0, NU - 1.001), i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j;
    return lerp(lerp(GG[i * NU + j], GG[i * NU + j + 1], b), lerp(GG[(i + 1) * NU + j], GG[(i + 1) * NU + j + 1], b), a);
  };
  // the front: constant speed at sea, then a smooth deceleration inland to rest at INL (C1 at the shore)
  const tau = INL / V0 * 2.2;                                     // decay time so that the run-up ends near INL
  const front = (t) => {
    const dt = t - tA;
    if (dt <= 0) return V0 * dt;
    return INL * (1 - Math.exp(-dt * V0 / INL));                  // v(0) = V0, asymptote INL
  };
  const fspeed = (t) => (t - tA <= 0 ? V0 : V0 * Math.exp(-(t - tA) * V0 / INL));
  const uOff = (u, land) => lerp(10 * fbm1(u / 90, 3), 34 * fbm1(u / 55, 5) + 12 * fbm1(u / 17, 9), land);
  const flood = (s) => level + D0 * Math.max(0.15, 1 - 0.75 * clamp(s / INL)) ;       // absolute flood level inland

  // ── wave mesh: rows = sheet (behind the crest) + front profile (crest -> toe); cols = along the coast
  const NUc = 220, NSh = 64, NFr = 34, NR = NSh + NFr;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(NUc * NR * 3), col = new Float32Array(NUc * NR * 3), fx = new Float32Array(NUc * NR * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aFx', new THREE.BufferAttribute(fx, 3).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let r = 0; r < NR - 1; r++) for (let c = 0; c < NUc - 1; c++) { const a = r * NUc + c, b = a + 1, d = a + NUc, e = d + 1; idx.push(a, d, b, b, d, e); }
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const uT = { value: 0 };
  const uFlow = { value: new THREE.Vector2(dir[0] * 3, dir[1] * 3) };
  const wave = new THREE.Mesh(geo, waterMat(ctx, uT, { uFlow }));
  wave.name = 'tsunami_wave'; wave.userData.noQA = true; wave.frustumCulled = false; wave.receiveShadow = true; wave.castShadow = false;
  root.add(wave);
  const us = []; for (let c = 0; c < NUc; c++) { const k = c / (NUc - 1); us.push((k - 0.5) * W * (0.6 + 0.4 * Math.abs(k - 0.5) * 2) ); }
  // front profile control points (forward, down) in units of the face height, as a function of curl c
  const prof = (c) => [[0, 0], [0.16 + 0.24 * c, -0.05], [0.3 + 0.36 * c, -0.18 - 0.04 * c], [0.3 + 0.4 * c, -0.34 - 0.12 * c], [0.2 + 0.2 * c, -0.46 - 0.06 * c], [0.17 + 0.03 * c, -0.62], [0.24, -0.85], [0.38, -1.02], [0.55, -1.25]];
  const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
  // (Q8) on land the front is a low sloped bore with a turbulent roller, not the curling sea wall
  const boreProf = [[0, 0], [0.5, -0.05], [1.0, -0.18], [1.5, -0.38], [1.9, -0.6], [2.2, -0.8], [2.45, -0.96], [2.7, -1.1], [3.0, -1.25]];
  function sampleProf(c, n, land = 0) {
    const Q = prof(c).map((q, i) => [lerp(q[0], boreProf[i][0], land), lerp(q[1], boreProf[i][1], land)]), out = [];
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1) * (Q.length - 1), i = Math.min(Q.length - 2, Math.floor(f)), t = f - i;
      const q0 = Q[Math.max(0, i - 1)], q1 = Q[i], q2 = Q[i + 1], q3 = Q[Math.min(Q.length - 1, i + 2)];
      out.push([cr(q0[0], q1[0], q2[0], q3[0], t), cr(q0[1], q1[1], q2[1], q3[1], t)]);
    }
    return out;
  }
  // per-row foam / thin / streak for the front profile
  const frFoam = [], frThin = [], frStreak = [];
  for (let k = 0; k < NFr; k++) { const f = k / (NFr - 1); frFoam.push(0.36 + 0.9 * (1 - sstep(0.1, 0.4, f)) + 0.85 * sstep(0.6, 0.84, f)); frThin.push(gauss((f - 0.2) / 0.16)); frStreak.push(sstep(0.25, 0.5, f) * (1 - sstep(0.7, 0.85, f))); }
  const seaCol = [0.018, 0.075, 0.085], deepCol = [0.01, 0.04, 0.05], mudCol = [0.19, 0.165, 0.125];
  const WA = ctx.ground.water || null, WAu = WA && WA.uniforms && WA.uniforms.uLevel ? WA.uniforms.uLevel : null;
  const state = { F: 0, land: 0, crest: new Float32Array(NUc * 3), toe: new Float32Array(NUc * 3) };

  const _cw = new THREE.Vector3();
  function updateWave(t, camera) {
    const F = front(t), land = sstep(-10, 70, F), onSea = 1 - land;
    // (Q8) seen from far away the breaking face reads as one white line (a few pixels tall): more foam on it
    let farW = 0; if (camera) { const fw = W2(F, 0); _cw.set(fw[0], gy0, fw[1]); farW = sstep(220, 650, camera.position.distanceTo(_cw)) * onSea; }
    state.F = F; state.land = land;
    const curl = CURL * (1 - sstep(-30, 45, F));
    const face = sampleProf(curl, NFr, land);
    const lvNow = WAu ? Math.min(level, WAu.value) : level;             // a drawback in the same shot lowers the sea
    const Lb = Math.max(420, F + 380);
    for (let c = 0; c < NUc; c++) {
      const u = us[c];
      const edge = sstep(W / 2, W / 2 - 220, Math.abs(u));
      const Fu = F + uOff(u, land);
      const shoal = 0.55 + 0.45 * sstep(-420, 0, Fu);
      const hVar = 0.8 + 0.4 * (0.5 + 0.5 * fbm1(u / 170, 11));
      const cf = 0.55 + 0.9 * (0.5 + 0.5 * fbm1(u / 60, 21));
      // crest absolute height: the sea wall, then the bore riding on the flood
      const seaCrest = level + H * shoal * hVar;
      const gF = gAt(Fu, u);
      const landCrest = Math.max(flood(Math.max(Fu, 0)) + 1.6 * hVar * (0.6 + 0.4 * Math.exp(-Math.max(0, Fu) / 150)), gF + 1.4);
      const crestY = lerp(level, lerp(seaCrest, landCrest, land), edge);
      const bc = lerp(0.35 * H, 3, land);                                   // crest sits bc behind the front
      const sC = Fu - bc;
      const baseF = Math.max(lvNow, gF) - 0.3;
      const Hf = Math.max(1.5, crestY - baseF);
      // sheet rows: far back -> crest
      for (let r = 0; r < NSh; r++) {
        const k = r / (NSh - 1), b = bc + (Lb - bc) * Math.pow(1 - k, 2.1);
        const s = Fu - b;
        const g = gAt(s, u);
        const backSea = level + (crestY - level) * (0.42 * Math.exp(-(b - bc) / 260) + 0.58 * Math.exp(-(b - bc) / (1.4 * H + 6)));
        let y;
        if (s > 0 || land > 0) {
          const fl = s > 0 ? flood(s) : level + (flood(0) - level) * Math.exp(s / 180);
          const bump = (crestY - fl) * Math.exp(-(b - bc) / 9);
          const landY = Math.max(fl + bump, level - 0.3);
          y = lerp(backSea, landY, land);
        } else y = backSea;
        y = lerp(level - 0.2, y, edge);
        const w = W2(s, u), i3 = (r * NUc + c) * 3;
        pos[i3] = w[0] - at[0]; pos[i3 + 1] = y - gy0; pos[i3 + 2] = w[1] - at[1];
        const nearC = Math.exp(-(b - bc) / (6 + 10 * onSea));
        const inl = sstep(-40, 60, s);
        const tint = [0, 1, 2].map((q) => lerp(lerp(deepCol[q], seaCol[q], nearC), mudCol[q], inl * 0.9));
        col[i3] = tint[0]; col[i3 + 1] = tint[1]; col[i3 + 2] = tint[2];
        fx[i3] = 0.12 + 0.75 * nearC + 0.25 * land + (y - g < 0.6 ? 0.3 : 0); fx[i3 + 1] = 0.5 * nearC * onSea; fx[i3 + 2] = 0;
      }
      // front rows: crest -> toe (can overhang)
      const rollA = land * (0.18 + 0.22 * (0.5 + 0.5 * fbm1(u / 23 + t * 0.9, 33))), rollB = land * 0.12 * fbm1(u / 11 - t * 1.3, 35);
      const cft = 0.55 + 0.9 * (0.5 + 0.5 * fbm1(u / 60 + t * 0.25, 21));
      for (let r = 0; r < NFr; r++) {
        const q = face[r], fr = r / (NFr - 1), bulge = Math.sin(Math.PI * Math.min(1, fr * 1.6)) * (rollA + rollB);
        const sf = sC + (q[0] + bulge) * Hf, y = crestY + q[1] * Hf + Hf * 0.06 * land * fbm1(u / 9 + t * 1.7 + fr * 2, 37);
        const w = W2(sf, u), i3 = ((NSh + r) * NUc + c) * 3;
        pos[i3] = w[0] - at[0]; pos[i3 + 1] = lerp(level - 0.2, y, edge) - gy0; pos[i3 + 2] = w[1] - at[1];
        const inl = sstep(-40, 60, sf);
        const shade = (0.7 + 0.3 * (1 - fr)) * (0.92 + 0.16 * fbm1(u / 130 + 7, 41));   // darker toward the toe, varying along the coast
        const tint = [0, 1, 2].map((qq) => lerp(seaCol[qq] * (1 + frThin[r] * 1.8) * shade, mudCol[qq] * shade, inl * 0.85));
        col[i3] = tint[0]; col[i3 + 1] = tint[1]; col[i3 + 2] = tint[2];
        fx[i3] = (r < NFr * 0.3 ? frFoam[r] : frFoam[r] * cft) * (1 - 0.35 * land) + land * (0.55 + 0.45 * (1 - fr)) + 0.6 * farW; fx[i3 + 1] = frThin[r] * onSea * (1 - farW); fx[i3 + 2] = frStreak[r] * cft + land * 0.8;
        if (r === 0) { state.crest[c * 3] = w[0] - at[0]; state.crest[c * 3 + 1] = crestY - gy0; state.crest[c * 3 + 2] = w[1] - at[1]; }
        if (r === Math.round(NFr * 0.8)) { state.toe[c * 3] = w[0] - at[0]; state.toe[c * 3 + 1] = Math.max(y, baseF + 0.3) - gy0; state.toe[c * 3 + 2] = w[1] - at[1]; }
      }
    }
    geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = geo.attributes.aFx.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // ── spray and mist: blown back off the lip at sea, a churning brown mist at the bore on land
  const NP = 1500;
  const puffs = new Puffs(ctx, NP, { back: 1.3, dark: 0.18, name: 'tsunami_spray' });
  root.add(puffs.mesh);
  const pr = rng(991), PI = [];
  for (let i = 0; i < NP; i++) PI.push({ c: Math.floor(pr() * NUc), ph: pr(), life: 1.5 + pr() * 1.8, sz: 0.45 + pr() * 1.3, at: Math.floor(pr() * 4), rot: pr() * TAU, kind: pr() < 0.62 ? 0 : 1, dx: pr() - 0.5, dz: pr() - 0.5 });
  // (Q8) `spray: "stream"` (default for waves 20 m and up, m06-m09): the lip spray streams back off the crest with the
  // wind as soft small wisps + thin water streaks, white-grey: white-balanced against the scene's sky light (a pink
  // dusk sky made the billows pink), keeping a warm touch of the sun. "billow" = the old look (smaller waves keep it).
  const SPRAY = String(P.spray ?? (H >= 20 ? 'stream' : 'billow')), STREAM = SPRAY === 'stream', NOSPRAY = SPRAY === 'none';   // "none": no spray or mist at all
  const lightsS = lightsOf(ctx), WB = [1, 1, 1], _lc = new THREE.Color();
  const NSS = STREAM ? 1100 : 0, sstreaks = STREAM ? new Streaks(ctx, NSS, { color: [0.92, 0.92, 0.9] }) : null;
  if (sstreaks) root.add(sstreaks.mesh);
  const SSQ = []; { const sr = rng(7788); for (let i = 0; i < NSS; i++) SSQ.push({ c: Math.floor(sr() * NUc), ph: sr(), life: 0.7 + sr() * 1.1, v: 11 + sr() * 12, up: 1 + sr() * 4, dx: sr() - 0.5, len: 0.06 + sr() * 0.1 }); }
  function whiteBalance() {
    const L = lightsS(); _lc.copy(L.sky).multiplyScalar(0.9).add(L.sun.clone().multiplyScalar(0.4));
    const lum = 0.3 * _lc.r + 0.59 * _lc.g + 0.11 * _lc.b + 1e-4;
    WB[0] = clamp(lum / Math.max(1e-4, _lc.r), 0.6, 1.6) * 1.03; WB[1] = clamp(lum / Math.max(1e-4, _lc.g), 0.6, 1.6); WB[2] = clamp(lum / Math.max(1e-4, _lc.b), 0.6, 1.6) * 0.95;   // puffs only (the streaks use neutral grey)
    return lum;
  }
  function updateStream(t) {
    const lum = whiteBalance();
    for (let i = 0; i < NSS; i++) {
      const q = SSQ[i], age = ((t / q.life + q.ph) % 1 + 1) % 1, a = age * q.life, tb = t - a;
      const Fb = front(tb), onLand = sstep(-10, 70, Fb);
      if (tb < -1 || onLand > 0.6) { sstreaks.hide(i); continue; }
      const shift = front(t) - Fb, c = q.c;
      const x0 = state.crest[c * 3] - dir[0] * shift, y0 = state.crest[c * 3 + 1], z0 = state.crest[c * 3 + 2] - dir[1] * shift;
      const bx = x0 - dir[0] * q.v * a + perp[0] * q.dx * 4 * a, bz = z0 - dir[1] * q.v * a + perp[1] * q.dx * 4 * a, by = y0 + q.up * a - 2.5 * a * a;
      const L = q.len * q.v;
      sstreaks.set(i, bx + dir[0] * L, by - q.up * 0.05, bz + dir[1] * L, bx, by, bz, 0.18 + 0.3 * age, 0.26 * sstep(0, 0.1, age) * (1 - age) * sstep(-900, -450, Fb));
    }
    sstreaks.commit(_lc.setRGB(lum * 1.02, lum, lum * 0.95));
  }
  function updatePuffs(t, camera) {
    const land = state.land;
    if (NOSPRAY) { for (let i = 0; i < NP; i++) puffs.hide(i); puffs.commit(camera); return; }
    if (STREAM) { updateStream(t); whiteBalance(); }
    for (let i = 0; i < NP; i++) {
      const p = PI[i];
      const age = ((t / p.life + p.ph) % 1 + 1) % 1, tb = t - age * p.life;
      // spawn point at the birth time: crest (kind 0) or toe (kind 1) of the column
      const Fb = front(tb), onLand = sstep(-10, 70, Fb);
      const c = p.c, src = p.kind === 0 ? state.crest : state.toe;
      if (tb < -1 || (p.kind === 0 && onLand > 0.9 && p.at < 2)) { puffs.hide(i); continue; }
      // approximate the birth position by shifting today's crest back along the travel by the front's advance
      const shift = front(t) - Fb;
      let x = src[c * 3] - dir[0] * shift, y = src[c * 3 + 1], z = src[c * 3 + 2] - dir[1] * shift;
      const a = age * p.life;
      // at sea: offshore wind blows the spray back over the crest and up; on land: a low rolling mist ahead
      const back = lerp(STREAM && p.kind === 0 ? -(12 + 8 * p.sz) : -6, 2.0, onLand), up = lerp(STREAM && p.kind === 0 ? 3.2 : 2.2, 0.8, onLand);
      x += dir[0] * back * a + perp[0] * p.dx * 6 * a; z += dir[1] * back * a + perp[1] * p.dx * 6 * a;
      y += up * a - 0.35 * a * a * (1 - onLand);
      const sz = (p.kind === 0 ? (STREAM ? lerp(3, 10, age) : lerp(5, 18, age)) : lerp(4, 12, age)) * p.sz * lerp(1, 0.75, onLand) * Math.min(H / 12, 1.7);
      const al = sstep(0, 0.15, age) * (1 - sstep(0.35, 1, age)) * (p.kind === 0 ? 0.22 : 0.3) * sstep(-900, -450, Fb);
      const mud = onLand * 0.55;
      const wb = STREAM ? WB : [1, 1, 1], alS = STREAM ? (p.kind === 0 ? 0.6 : 0.55) : 1;
      puffs.set(i, x, y + sz * 0.2, z, sz, al * alS, p.rot + a * 0.3, lerp(0.95, 0.66, mud) * wb[0], lerp(0.97, 0.61, mud) * wb[1], lerp(1.0, 0.53, mud) * wb[2], p.at, STREAM ? lerp(0.9, 1.0, age) : lerp(0.72, 1.0, age), p.kind === 0 ? 1 : 0.7);
    }
    puffs.commit(camera);
  }

  // ── debris riding the front: planks, roof sheets (instanced), tumbling in the churn, calmer behind
  const ND = Math.round(num(P.debris, 220));
  const dr = rng(4242), DI = [];
  for (let i = 0; i < ND; i++) DI.push({ u: (dr() - 0.5) * W * 0.8, off: 4 + Math.pow(dr(), 1.6) * 140, sheet: dr() < 0.3, spin: [dr() - 0.5, dr() - 0.5, dr() - 0.5], ph: dr() * TAU, sc: 0.7 + dr() * 0.8, born: -60 + dr() * 140 });
  const woodMat = stdMat(ctx, { color: 0x6b5238, roughness: 0.9 }), tinMat = stdMat(ctx, { color: 0x8a8d8f, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
  const planks = new THREE.InstancedMesh(plankGeo(), woodMat, ND), sheets = new THREE.InstancedMesh(sheetGeo(), tinMat, ND);
  for (const m of [planks, sheets]) { m.userData.noQA = true; m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), Z = new THREE.Matrix4().makeScale(0, 0, 0);
  const surfAt = (s, u, t) => {
    const F = front(t) + uOff(u, state.land);
    if (s > F) return -1e9;
    const land = state.land;
    const b = F - s;
    const fl = s > 0 ? flood(s) : level + (flood(0) - level) * Math.exp(s / 180);
    const seaY = level + H * 0.5 * Math.exp(-b / 200);
    return lerp(seaY, Math.max(fl, level), land) + 0.8 * Math.exp(-b / 8);
  };
  // (Q8) house pieces (wall panels) and palm fronds riding the bore, own rng so the planks/sheets keep their layout
  const NX = Math.round(num(P.debris, 220) * 0.35), xr = rng(4343), XI = [];
  for (let i = 0; i < NX; i++) XI.push({ u: (xr() - 0.5) * W * 0.75, off: 3 + Math.pow(xr(), 1.5) * 110, panel: xr() < 0.45, spin: [xr() - 0.5, xr() - 0.5, xr() - 0.5], ph: xr() * TAU, sc: 0.8 + xr() * 0.6, born: -40 + xr() * 120, tone: xr() });
  const panelGeo = new THREE.BoxGeometry(3.0, 2.3, 0.14), frondGeo = (() => { const g = new THREE.PlaneGeometry(0.9, 3.4, 1, 8); const q = g.attributes.position; for (let i = 0; i < q.count; i++) { const y = q.getY(i), x = q.getX(i); q.setZ(i, 0.25 * Math.sin((y / 3.4 + 0.5) * Math.PI) + 0.12 * Math.abs(x)); q.setX(i, x * (1 - Math.abs(y) / 2.2)); } g.computeVertexNormals(); return g; })();
  const panels = new THREE.InstancedMesh(panelGeo, stdMat(ctx, { color: 0xffffff, roughness: 0.8 }), Math.max(1, NX)), fronds = new THREE.InstancedMesh(frondGeo, stdMat(ctx, { color: 0x4f6a2c, roughness: 0.75, side: THREE.DoubleSide }), Math.max(1, NX));
  XI.forEach((d, i) => panels.setColorAt(i, new THREE.Color().setRGB(lerp(0.62, 0.9, d.tone), lerp(0.6, 0.86, d.tone), lerp(0.55, 0.78, d.tone))));
  for (const m of [panels, fronds]) { m.userData.noQA = true; m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
  function updateDebrisX(t) {
    const F = front(t), land = state.land; let np = 0, nf = 0;
    for (const d of XI) {
      if (F < d.born + 5 || land < 0.2) continue;
      const off = d.off * (0.4 + 0.6 * sstep(0, 1, (F - d.born) / 120));
      const s = F + uOff(d.u, land) - off, u = d.u + 5 * vnoise(t * 0.2 + d.ph);
      const y = surfAt(s, u, t), g = gAt(s, u), w = W2(s, u), churn = Math.exp(-off / 25), a = t * (0.5 + 2.0 * churn);
      _e.set(d.spin[0] * a * 2 + d.ph, d.spin[1] * a + d.ph * 2, d.spin[2] * a * 2); _q.setFromEuler(_e);
      const k = sstep(g + 0.1, g + 0.6, y) * sstep(d.born + 5, d.born + 30, F), sc = d.sc * k;
      _p.set(w[0] - at[0], Math.max(y, g + 0.05) - gy0 + 0.25 * Math.sin(t * 2 + d.ph) * churn, w[1] - at[1]); _s.set(sc, sc, sc); _m.compose(_p, _q, _s);
      if (d.panel) panels.setMatrixAt(np++, _m); else fronds.setMatrixAt(nf++, _m);
    }
    panels.count = np; fronds.count = nf; panels.instanceMatrix.needsUpdate = fronds.instanceMatrix.needsUpdate = true;
  }
  function updateDebris(t) {
    updateDebrisX(t);
    const F = front(t), land = state.land;
    let np = 0, ns = 0;
    for (let i = 0; i < ND; i++) {
      const d = DI[i];
      // debris joins the flow where the bore picks it up (born = s along the travel); before that it is unseen
      if (F < d.born + 5 || land < 0.2) { (d.sheet ? sheets : planks).setMatrixAt(d.sheet ? ns++ : np++, Z); continue; }
      const off = d.off * (0.4 + 0.6 * sstep(0, 1, (F - d.born) / 120));
      const s = F + uOff(d.u, land) - off, u = d.u + 6 * vnoise(t * 0.2 + d.ph);
      const y = surfAt(s, u, t);
      const g = gAt(s, u);
      const w = W2(s, u);
      const churn = Math.exp(-off / 25);
      const a = t * (0.6 + 2.4 * churn);
      _e.set(d.spin[0] * a * 2 + d.ph, d.spin[1] * a + d.ph * 2, d.spin[2] * a * 2);
      _q.setFromEuler(_e);
      const k = sstep(g + 0.1, g + 0.6, y);
      _p.set(w[0] - at[0], Math.max(y, g + 0.05) - gy0 + 0.2 * Math.sin(t * 2 + d.ph) * churn, w[1] - at[1]);
      const sc = d.sc * (d.sheet ? 1.6 : 1.15) * k * sstep(d.born + 5, d.born + 30, F); _s.set(sc, sc, sc);
      _m.compose(_p, _q, _s);
      if (d.sheet) sheets.setMatrixAt(ns++, _m); else planks.setMatrixAt(np++, _m);
    }
    planks.count = np; sheets.count = ns;
    planks.instanceMatrix.needsUpdate = sheets.instanceMatrix.needsUpdate = true;
  }

  // ── props on land: parked cars (lifted and carried), trees / poles / fences (knocked over by the bore)
  const props = [];
  if (P.props !== false) {
    const carCols = [0xb8b2a6, 0x7a1f1f, 0x2d4a6b, 0xd9d4c8, 0x3a3a3a, 0x8c7a4a, 0x55606a];
    const pr2 = rng((item.seed ?? 7) * 13 + 1);
    const nCars = Math.round(num(P.cars, 16)), nTrees = Math.round(num(P.trees, 70)), nPoles = Math.round(num(P.poles, 18));
    const carMats = carCols.map((c) => stdMat(ctx, { color: c, roughness: 0.35, metalness: 0.4, vertexColors: true }));
    for (let i = 0; i < nCars; i++) {
      const s = 25 + pr2() * (INL * 0.8), u = (pr2() - 0.5) * W * 0.5;
      if (gAt(s, u) < level + 1.2) continue;
      const m = new THREE.Mesh(carGeo(), carMats[i % carMats.length]); m.castShadow = true; m.receiveShadow = true; m.userData.noQA = true;
      root.add(m); props.push({ type: 'car', m, s, u, yaw: pr2() * TAU, ph: pr2() * 10, spin: (pr2() - 0.5) * 2 });
    }
    const leafMat = stdMat(ctx, { color: 0xffffff, roughness: 0.85, vertexColors: true, flat: true });
    const poleMat = stdMat(ctx, { color: 0x5b4a3a, roughness: 0.85 });
    for (let i = 0; i < nTrees; i++) {
      const s = 12 + pr2() * INL, u = (pr2() - 0.5) * W * 0.62, h = 7 + pr2() * 7;
      if (gAt(s, u) < level + 1.2) continue;
      const m = new THREE.Mesh(coniferGeo(), leafMat); m.scale.setScalar(h); m.castShadow = true; m.userData.noQA = true;
      root.add(m); props.push({ type: 'tree', m, s, u, h, ph: pr2(), lean: (pr2() - 0.5) * 0.5 });
    }
    for (let i = 0; i < nPoles; i++) {
      const s = 15 + i * (INL * 0.85 / nPoles), u = -40 + 20 * vnoise(i * 0.7, 4);
      if (gAt(s, u) < level + 1.2) continue;
      const m = new THREE.Mesh(trunkGeo(), poleMat); m.scale.set(6, 9, 6); m.castShadow = true; m.userData.noQA = true;
      root.add(m); props.push({ type: 'pole', m, s, u, h: 9, ph: pr2(), lean: (pr2() - 0.5) * 0.4 });
    }
  }
  const _v = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function updateProps(t) {
    const F = front(t);
    for (const p of props) {
      const Fu = F + uOff(p.u, state.land);
      const hit = Fu - p.s;                                            // metres the bore has passed this prop
      const tHit = hit > 0 ? hit / Math.max(2, fspeed(t)) : -1;       // ~seconds since the hit
      const g = gAt(p.s, p.u);
      if (p.type === 'car') {
        const k = sstep(0, 0.7, tHit);
        const carry = hit > 0 ? hit * (0.9 - 0.25 * sstep(2, 6, tHit)) * k : 0;
        const s = p.s + carry, u = p.u + 3 * k * vnoise(t * 0.3 + p.ph);
        const w = W2(s, u), gs = gAt(s, u);
        const wy = surfAt(s, u, t);
        const y = lerp(gs, Math.max(gs, wy - 0.55), k);
        p.m.position.set(w[0] - at[0], y - gy0, w[1] - at[1]);
        const yaw = p.yaw + k * p.spin * (1.2 + tHit * 0.4);
        const tum = k * (1 - sstep(3, 7, tHit));
        p.m.rotation.set(k * 0.35 * Math.sin(t * 1.3 + p.ph) + tum * 0.9 * Math.sin(t * 2.1 + p.ph), yaw, k * 0.5 * Math.sin(t * 0.9 + p.ph * 2) + k * 0.4 * p.spin + tum * 1.4 * Math.sin(t * 1.7 + p.ph * 3));
      } else {
        const k = sstep(0, 1.3, tHit);                                  // falls over ~1.3 s after the hit, eased
        const w = W2(p.s, p.u);
        p.m.position.set(w[0] - at[0], g - gy0 - k * 0.3, w[1] - at[1]);
        const fall = k * (Math.PI / 2 - 0.08) * (p.type === 'pole' ? 0.92 : 1);
        // tip toward the flow (axis = perp), plus a small individual lean
        _v.set(perp[0], 0, perp[1]).normalize();
        p.m.quaternion.setFromAxisAngle(_v, -fall).multiply(_q.setFromAxisAngle(UP, p.ph * TAU));
      }
    }
  }

  // ── (Q8) `spit: {at, heading, length, width, height, gap: [u0, u1], trees}`: a low gravel-and-forest bar across a bay
  // mouth (La Chaussee), built in the scene's own frame; its trees go down as the crest runs over them
  const spitTrees = [];
  if (P.spit && Array.isArray(P.spit.at)) {
    const SP = P.spit, sa = SP.at, sh = num(SP.heading, 90) * DEG, ax = [Math.sin(sh), -Math.cos(sh)], ac = [-ax[1], ax[0]];
    const SL = num(SP.length, 700), SW = num(SP.width, 60), SH = num(SP.height, 6), gap = Array.isArray(SP.gap) ? SP.gap : null;
    const hSp = (v, w) => {
      const end = sstep(SL / 2, SL / 2 - 60, Math.abs(v)), cut = gap ? 1 - sstep(gap[0] - 12, gap[0] + 6, v) * (1 - sstep(gap[1] - 6, gap[1] + 12, v)) : 1;
      const prof = Math.pow(Math.max(0, 1 - (w / (SW / 2)) ** 2), 0.7);
      return level - 2.5 + (SH + 2.5 + 1.2 * fbm1(v / 40 + 3, 51)) * prof * end * cut;
    };
    const NV = 140, NW = 26, sg = new THREE.PlaneGeometry(1, 1, NV - 1, NW - 1), sp = sg.attributes.position, sc = new Float32Array(sp.count * 3);
    for (let i = 0; i < sp.count; i++) {
      const v = sp.getX(i) * SL, w = sp.getY(i) * SW * 1.3, y = hSp(v, w), x = sa[0] + ax[0] * v + ac[0] * w, z = sa[1] + ax[1] * v + ac[1] * w;
      sp.setXYZ(i, x - at[0], y - gy0, z - at[1]);
      const top = sstep(level + 1.5, level + SH * 0.6, y), n = 0.5 + 0.5 * vnoise(v * 0.07 + w * 0.13, 5);
      sc[i * 3] = lerp(lerp(0.42, 0.5, n), 0.16, top); sc[i * 3 + 1] = lerp(lerp(0.39, 0.46, n), 0.2, top); sc[i * 3 + 2] = lerp(lerp(0.34, 0.4, n), 0.13, top);
    }
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3)); sg.computeVertexNormals();
    const spit = new THREE.Mesh(sg, stdMat(ctx, { color: 0xffffff, roughness: 0.92, vertexColors: true, side: THREE.DoubleSide }));
    spit.name = 'tsunami_spit'; spit.receiveShadow = spit.castShadow = true; spit.userData.noQA = true; root.add(spit);
    const nT = Math.round(num(SP.trees, 420)), tr = rng(5151);
    const tm = new THREE.InstancedMesh(coniferGeo(), stdMat(ctx, { color: 0xffffff, roughness: 0.85, vertexColors: true, flat: true }), Math.max(1, nT));
    tm.castShadow = true; tm.userData.noQA = true; tm.frustumCulled = false; tm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(tm);
    for (let k = 0; k < nT * 4 && spitTrees.length < nT; k++) {
      const v = (tr() - 0.5) * SL * 0.9, w = (tr() - 0.5) * SW * 0.7, y = hSp(v, w); if (y < level + SH * 0.55) continue;
      const x = sa[0] + ax[0] * v + ac[0] * w, z = sa[1] + ax[1] * v + ac[1] * w;
      spitTrees.push({ x, z, y, s: (x - at[0]) * dir[0] + (z - at[1]) * dir[1], u: (x - at[0]) * perp[0] + (z - at[1]) * perp[1], h: 12 + tr() * 10, yaw: tr() * TAU });
    }
    spitTrees.mesh = tm;
  }
  function updateSpit(t) {
    if (!spitTrees.mesh) return;
    const F = front(t);
    spitTrees.forEach((tr, i) => {
      const hit = F + uOff(tr.u, state.land) - lerp(0.35 * H, 3, state.land) - tr.s, k = sstep(-4, 22, hit);
      _e.set(-k * 1.4, tr.yaw, 0); _q.setFromEuler(_e); _p.set(tr.x - at[0] + dir[0] * k * 6, tr.y - gy0 - k * 2, tr.z - at[1] + dir[1] * k * 6);
      const sc = tr.h * (1 - sstep(0.6, 1, k) * 0.9); _s.set(sc, sc, sc); _m.compose(_p, _q, _s); spitTrees.mesh.setMatrixAt(i, _m);
    });
    spitTrees.mesh.count = spitTrees.length; spitTrees.mesh.instanceMatrix.needsUpdate = true;
  }
  // ── (Q8) boats riding the wave: `ride: [{kind, at, heading, carry}]`, built from lib/human (ship.rowboat, a troller,
  // ...) and kept on the wave surface: pitched with the face, lifted over the crest, carried shoreward by `carry`
  // (0 = the crest passes under it, 1 = it rides the crest). Keep the boats seaward of `at` (s < 0).
  const riders = [], rideList = Array.isArray(P.ride) ? P.ride : [];
  // loaded only when used, so a mid-edit ship module never takes the tsunami down with it
  const HM = rideList.length ? await import('../human/index.js').catch((e) => { (ctx.warn || console.warn)(`fx.tsunami ride: lib/human failed (${e.message})`); return null; }) : null;
  const buildHuman = HM ? HM.build : null, HUMAN_CAT = HM ? HM.CATALOG : {};
  for (const rd of (buildHuman ? rideList : [])) {
    const kind = HUMAN_CAT[rd.kind] ? rd.kind : 'ship.rowboat';
    let res = null;
    try { res = await buildHuman(kind, { ...rd, kind, at: [0, 0], heading: rd.heading ?? 0, action: 'idle', index: 900 + riders.length, seed: rd.seed ?? 17 + riders.length, params: { ...(HUMAN_CAT[kind]?.params || {}), ...(rd.params || {}) } }, ctx); } catch (e) { (ctx.warn || console.warn)(`fx.tsunami ride: ${kind} failed (${e.message})`); }
    if (!res || !res.root) continue;
    const hold = new THREE.Group(); hold.name = 'tsunami_rider'; hold.add(res.root); root.add(hold);
    const ra = rd.at || [0, 0], rs = (ra[0] - at[0]) * dir[0] + (ra[1] - at[1]) * dir[1], ru = (ra[0] - at[0]) * perp[0] + (ra[1] - at[1]) * perp[1];
    riders.push({ res, hold, s0: rs, u0: ru, carry: clamp(num(rd.carry, 0.3), 0, 1), ph: riders.length * 1.7, len: num(rd.length, kind === 'ship.rowboat' ? 5 : 8) });
  }
  // the top of the wave mesh at (s, u): nearest column, the highest row segment spanning s (root-local y, dy/ds)
  function surfQ(s, u) {
    let lo = 0, hi = NUc - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (us[m] < u) lo = m; else hi = m; }
    const c = Math.abs(us[lo] - u) < Math.abs(us[hi] - u) ? lo : hi;
    let best = -1e9, slope = 0;
    for (let r = 0; r < NR - 1; r++) {
      const i0 = (r * NUc + c) * 3, i1 = ((r + 1) * NUc + c) * 3;
      const a0 = pos[i0] * dir[0] + pos[i0 + 2] * dir[1], a1 = pos[i1] * dir[0] + pos[i1 + 2] * dir[1];
      if (s < Math.min(a0, a1) || s > Math.max(a0, a1) || Math.abs(a1 - a0) < 1e-4) continue;
      const y = pos[i0 + 1] + (pos[i1 + 1] - pos[i0 + 1]) * (s - a0) / (a1 - a0);
      if (y > best) { best = y; slope = (pos[i1 + 1] - pos[i0 + 1]) / (a1 - a0); }
    }
    return best > -1e8 ? { y: best, slope } : null;
  }
  const _nr = new THREE.Vector3(), _ax = new THREE.Vector3(), UPr = new THREE.Vector3(0, 1, 0), _qr = new THREE.Quaternion();
  function updateRiders(t, clock, camera) {
    if (!riders.length) return;
    const F = front(t), lvW = (WAu ? Math.min(level, WAu.value) : level) - gy0;
    for (const b of riders) {
      const crestS = F + uOff(b.u0, state.land) - lerp(0.35 * H, 3, state.land);
      const past = Math.max(0, crestS - b.s0);
      const s = b.s0 + b.carry * past * (1 - 0.12 * b.carry), u = b.u0, w = W2(s, u);
      // hull-length smoothing: bow and stern ride different heights (pitch), the lift starts as the bow meets the face
      const HL = num(b.len, 7); let ys = 0, ws = 0; const qy = [];
      for (const k of [-1, -0.5, 0, 0.5, 1]) { const q = surfQ(s + k * HL, u), yv = q && q.y > lvW ? q.y : lvW, wg = 1 - 0.5 * Math.abs(k); ys += yv * wg; ws += wg; qy.push(yv); }
      const y = ys / ws, onW = y > lvW + 0.05, slope = clamp((qy[4] - qy[0]) / (2 * HL), -0.85, 0.85);
      b.hold.position.set(w[0] - at[0], y + (onW ? 0.05 : 0.2 * Math.sin(t * 0.9 + b.ph)), w[1] - at[1]);
      _nr.set(-slope * dir[0], 1, -slope * dir[1]).normalize();
      b.hold.quaternion.setFromUnitVectors(UPr, _nr).multiply(_qr.setFromAxisAngle(_ax.set(dir[0], 0, dir[1]), 0.06 * Math.sin(t * 0.8 + b.ph)));
      b.res.update?.(t, clock, camera);
      const hg = b.res.root.children[0]; if (hg) hg.position.y -= (ctx.water?.level ?? 0);     // it floats on its own level: use ours
    }
  }
  function update(t, clock, camera) {
    uT.value = t;
    updateWave(t, camera);
    updateDebris(t);
    updateProps(t);
    updateRiders(t, clock, camera);
    updateSpit(t);
    if (camera) updatePuffs(t, camera);
  }
  update(0, 0, null);
  return { root, radius: 60, height: H, update, snapped: true, anchors: {}, footprint: [40, 40], contact: false, front, frontXZ: (t) => W2(front(t), 0) };
}

// ── knee mode: the street close-up ────────────────────────────────────────────────────────────────────────────────
async function buildKnee(item, ctx) {
  const P = prm(item);
  const at = item.at || [0, 0];
  const hd = (item.heading ?? 0) * DEG;                         // flow direction
  const dir = [Math.sin(hd), -Math.cos(hd)], perp = [-dir[1], dir[0]];
  const DEP = num(P.knee_depth, 0.55), tH = num(P.t_hit, 2.0), VF = num(P.flow, 5.5), tR = num(P.t_reverse, 1e9);
  // (Q8) backwash: after t_reverse the flow runs back to the sea. Rv(t) = smooth integral of the reversal (s past it)
  const Rv = (t) => { const x = t - tR - 0.35; return 0.5 * (x + Math.sqrt(x * x + 0.16)); };
  const uFlowOff = { value: new THREE.Vector2(0, 0) };
  const G = ctx.ground.height, gy0 = G(at[0], at[1]);
  const root = new THREE.Group(); root.name = 'fx.tsunami.knee'; root.position.set(at[0], gy0, at[1]);
  const uT = { value: 0 }, uFlow = { value: new THREE.Vector2(dir[0] * VF, dir[1] * VF) };
  // the flood sheet: 70 x 50 m around the figure, the front arrives from upstream at tH
  const L = 90, Wd = 60, NX = 150, NZ = 90;
  const geo = new THREE.PlaneGeometry(1, 1, NX - 1, NZ - 1);
  const pos = geo.attributes.position.array, n = pos.length / 3;
  const col = new Float32Array(n * 3), fx = new Float32Array(n * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aFx', new THREE.BufferAttribute(fx, 3));
  const S = new Float32Array(n), Uu = new Float32Array(n), GR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i % NX, b = Math.floor(i / NX);
    const s = (a / (NX - 1) - 0.62) * L * Math.pow(Math.abs(a / (NX - 1) - 0.62) * 1.6 + 0.4, 0.8) ;
    const u = (b / (NZ - 1) - 0.5) * Wd;
    S[i] = s; Uu[i] = u; GR[i] = G(at[0] + dir[0] * s + perp[0] * u, at[1] + dir[1] * s + perp[1] * u);
  }
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const water = new THREE.Mesh(geo, waterMat(ctx, uT, { uFlow, uFlowOff, rough: 0.3, sss: 0.0, bump: 1.7, env: 0.2, stretch: 3.2 }));   // Q8: liquid and fast, not slush
  water.name = 'knee_water'; water.userData.noQA = true; water.frustumCulled = false; water.receiveShadow = true;
  root.add(water);
  const frontS = (t) => (t - tH) * VF * 1.25 - 0.0;          // the front passes the figure (s = 0) at tH
  const depthAt = (s, u, t) => {
    const fr = frontS(t) + 1.5 * vnoise(u * 0.15, 3) + 0.6 * vnoise(u * 0.6 + t, 7);
    const behind = fr - s;
    const wet = sstep(-2.0, 0.6, behind);
    const rise = sstep(-0.8, 4.5, behind);
    const surge = 0.22 * gauss((behind - 1.6) / 1.8);   // the churning lip of the front
    const boil = 0.045 * vnoise(s * 0.7 - (t - tH) * VF * 0.6 + u * 0.23, 11) + 0.03 * vnoise(u * 1.3 + s * 0.4 + t * 2.3, 12);   // Q8: boils and standing waves
    return (DEP * rise * (1 + 0.05 * Math.sin(u * 0.9 + t * 3.1)) + surge + boil * rise) * wet - 0.3 * (1 - wet);
  };
  function updateWater(t) {
    for (let i = 0; i < n; i++) {
      const s = S[i], u = Uu[i];
      const d = depthAt(s, u, t);
      const x = dir[0] * s + perp[0] * u, z = dir[1] * s + perp[1] * u;
      pos[i * 3] = x; pos[i * 3 + 1] = GR[i] + d - gy0; pos[i * 3 + 2] = z;
      const behind = frontS(t) - s;
      const lip = gauss((behind - 0.8) / 1.6);
      fx[i * 3] = 0.32 + 0.55 * lip + 0.35 * Math.exp(-(u * u) / 3) * sstep(0, 1, behind); fx[i * 3 + 1] = 0; fx[i * 3 + 2] = 0.9;
      const tn = 0.9 + 0.2 * vnoise(u * 0.21 + s * 0.05 - t * 0.5, 13);
      col[i * 3] = 0.15 * tn; col[i * 3 + 1] = 0.13 * tn; col[i * 3 + 2] = 0.1 * tn;             // Q8: brown-grey
    }
    geo.attributes.position.needsUpdate = geo.attributes.aFx.needsUpdate = geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
  }
  // the mannequin: standing, braces, legs swept downstream, falls backward into the water and is carried off
  const man = await mannequin(ctx, {});
  const figG = man.group;
  const holder = new THREE.Group(); holder.add(figG); root.add(holder);
  const faceUp = P.face ?? 'downstream';                     // he is running away: back to the water
  const yaw0 = Math.atan2(dir[0], dir[1]) + (faceUp === 'upstream' ? Math.PI : 0);
  // (Q8) the splash sheet: water piling up against the legs and fanning out (an open half-cone, upstream side)
  const sheetM = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.78, 0.76, 0.7), roughness: 0.25, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const sheetG = new THREE.CylinderGeometry(0.62, 0.2, 0.46, 24, 3, true, -Math.PI * 0.62, Math.PI * 1.24); sheetG.translate(0, 0.23, 0);
  { const q = sheetG.attributes.position; for (let i = 0; i < q.count; i++) { const y = q.getY(i), x = q.getX(i), z = q.getZ(i); const k = 1 + 0.25 * Math.sin(Math.atan2(x, z) * 7) * (y / 0.46); q.setXYZ(i, x * k, y, z * k); } sheetG.computeVertexNormals(); }
  const splashSheet = new THREE.Mesh(sheetG, ctx.patch ? ctx.patch(sheetM) : sheetM); splashSheet.userData.noQA = true; splashSheet.renderOrder = 13; root.add(splashSheet);
  // splash puffs + streaks at the legs
  const NPp = 260, puffs = new Puffs(ctx, NPp, { back: 0.9, dark: 0.3, name: 'knee_splash' }); root.add(puffs.mesh);
  const NS2 = 420, streaks = new Streaks(ctx, NS2, { color: [0.75, 0.72, 0.66] }); root.add(streaks.mesh);
  const r0 = rng(77), SP = []; for (let i = 0; i < Math.max(NPp, NS2); i++) SP.push({ ph: r0(), life: 0.6 + r0() * 0.9, a: r0() * TAU, v: 1.5 + r0() * 3.5, up: 1.5 + r0() * 3, at: Math.floor(r0() * 4), sz: 0.5 + r0() });
  const _q = new THREE.Quaternion(), _ax = new THREE.Vector3(), _v = new THREE.Vector3();
  function figState(t) {
    const th = t - tH;
    const brace = sstep(-0.6, 0.15, th), sweep = sstep(0.25, 1.35, th), carried = sstep(1.1, 3.0, th);
    return { th, brace, sweep, carried };
  }
  function updateFig(t) {
    const { th, brace, sweep, carried } = figState(t);
    // travel downstream once swept: accelerate to ~70 % of the flow
    const tt = Math.max(0, th - 0.25), drift = 3.2 * (1 - Math.exp(-tt / 1.6)) - 0.8 * VF * Rv(t) * sstep(0.2, 1.2, tt);
    const s = drift, x = dir[0] * s, z = dir[1] * s;
    const gy = G(at[0] + x, at[1] + z) - gy0;
    // fall backward (toward upstream) around the feet; the body floats at the surface afterwards
    const fall = sweep * 1.35 + carried * 0.15;
    const float = carried * (DEP * 0.55);
    holder.position.set(x, gy + float * 1.0 - sweep * 0.1, z);
    _ax.set(perp[0], 0, perp[1]);
    holder.quaternion.setFromAxisAngle(_ax, fall * (faceUp === 'upstream' ? -1 : 1));
    figG.rotation.set(0, yaw0 + 0.25 * carried * Math.sin(t * 0.8), 0);
    // limbs: run -> brace (arms out) -> flail
    const fl = Math.sin(t * 5.2), fl2 = Math.sin(t * 4.1 + 1.3);
    man.pose({
      lean: lerp(0.18, -0.05, brace) - sweep * 0.2, headX: lerp(-0.1, -0.35, sweep), chestX: -0.1 * sweep,
      lArmZ: lerp(0.15, 1.05, brace) + 0.35 * sweep * fl, rArmZ: -lerp(0.15, 1.05, brace) - 0.35 * sweep * fl2,
      lArmX: -0.4 * brace - 0.6 * sweep, rArmX: -0.3 * brace - 0.7 * sweep, lElbow: -0.6 + 0.3 * brace, rElbow: -0.6 + 0.3 * brace,
      lLeg: -0.25 * brace - 0.5 * sweep, rLeg: 0.2 * brace - 0.2 * sweep, lKnee: 0.35 * brace + 0.5 * sweep, rKnee: 0.15 + 0.6 * sweep,
      lShape: 'soft', rShape: 'soft',
    });
    return { x, z, gy, th };
  }
  function updateSplash(t, camera, fs) {
    const legX = fs.x, legZ = fs.z;
    const wet = sstep(-0.4, 0.2, fs.th) * (1 - 0.6 * sstep(1.5, 3.5, fs.th));
    for (let i = 0; i < NPp; i++) {
      const p = SP[i], age = ((t / p.life + p.ph) % 1 + 1) % 1, a = age * p.life;
      const ang = p.a;
      const x = legX + Math.cos(ang) * 0.35 + dir[0] * p.v * a * 0.6 + Math.sin(ang) * a * 0.8 * perp[0];
      const z = legZ + Math.sin(ang) * 0.35 + dir[1] * p.v * a * 0.6 + Math.sin(ang) * a * 0.8 * perp[1];
      const y = fs.gy + DEP * 0.9 + p.up * a - 4.9 * a * a;
      const sz = lerp(0.18, 0.7, age) * p.sz;
      puffs.set(i, x, Math.max(fs.gy + DEP * 0.6, y), z, sz * 0.45, wet * 0.08 * sstep(0, 0.15, age) * (1 - sstep(0.4, 1, age)), p.a, 0.86, 0.84, 0.8, p.at, 0.98, 1);   // Q8: a faint wet mist only
    }
    puffs.commit(camera);
    for (let i = 0; i < NS2; i++) {
      const p = SP[i], age = ((t / (p.life * 0.7) + p.ph * 1.7) % 1 + 1) % 1, a = age * p.life * 0.7;
      const ang = p.a, r = 0.25 + 0.15 * Math.sin(ang * 3);
      const vx = dir[0] * p.v * 0.9 + Math.cos(ang) * 1.6, vz = dir[1] * p.v * 0.9 + Math.sin(ang) * 1.6, vy = p.up * 1.3;
      const x = legX + Math.cos(ang) * r + vx * a, z = legZ + Math.sin(ang) * r + vz * a, y = fs.gy + DEP * 0.85 + vy * a - 4.9 * a * a;
      const ex = x - vx * 0.03, ez = z - vz * 0.03, ey = y - (vy - 9.8 * a) * 0.03;
      if (y < fs.gy + DEP * 0.4) { streaks.hide(i); continue; }
      streaks.set(i, ex, ey, ez, x, y, z, 0.02, wet * 0.8 * (1 - age));
    }
    streaks.commit();
  }
  // floating junk in the street
  const NJ = 40, jr = rng(313), JI = [];
  for (let i = 0; i < NJ; i++) JI.push({ s: -30 + jr() * 60, u: (jr() - 0.5) * 24, ph: jr() * TAU, sc: 0.3 + jr() * 0.5, sp: 0.6 + jr() * 0.5 });
  const jm = new THREE.InstancedMesh(plankGeo(), stdMat(ctx, { color: 0x5e4a36, roughness: 0.9 }), NJ); jm.userData.noQA = true; jm.castShadow = true; jm.frustumCulled = false; root.add(jm);
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  function updateJunk(t) {
    for (let i = 0; i < NJ; i++) {
      const j = JI[i];
      const fr = frontS(t);
      const s = Math.min(fr - 1, j.s + (t - tH) * VF * j.sp - 2 * VF * j.sp * Rv(t));
      const d = depthAt(s, j.u, t);
      const vis = sstep(0.05, 0.25, d);
      const x = dir[0] * s + perp[0] * j.u, z = dir[1] * s + perp[1] * j.u;
      const g = G(at[0] + x, at[1] + z) - gy0;
      _p.set(x, g + Math.max(0, d) + 0.02, z); _e.set(0.2 * Math.sin(t * 2 + j.ph), j.ph + t * 0.4 * (j.sp - 0.8), 0.2 * Math.sin(t * 1.7 + j.ph)); _q.setFromEuler(_e);
      _s.setScalar(j.sc * vis); _m.compose(_p, _q, _s); jm.setMatrixAt(i, _m);
    }
    jm.instanceMatrix.needsUpdate = true;
  }
  function update(t, clock, camera) {
    uT.value = t;
    uFlowOff.value.set(-2 * VF * dir[0] * Rv(t), -2 * VF * dir[1] * Rv(t));
    updateWater(t);
    const fs = updateFig(t);
    { const th = fs.th, stand = sstep(-0.25, 0.1, th) * (1 - sstep(0.35, 0.9, th)), rev = sstep(tR - 0.2, tR + 0.5, t);
      splashSheet.position.set(fs.x, fs.gy + DEP * 0.55, fs.z);
      splashSheet.rotation.set(0, Math.atan2(-dir[0], -dir[1]) + Math.PI * rev, 0);       // it faces the current (reversed in the backwash)
      const fl = 0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 17 + 1);
      splashSheet.scale.set(fl, (0.6 + 0.6 * stand) * fl, fl); sheetM.opacity = 0.6 * stand; splashSheet.visible = stand > 0.01; }
    updateJunk(t);
    if (camera) updateSplash(t, camera, fs);
  }
  update(0, 0, null);
  return { root, radius: 0.9, height: 1.8, update, snapped: true, anchors: { figure: figG }, footprint: [1.5, 1.5], contact: false };
}

// ── drawback mode (Q8): the sea races out and bares the seabed ────────────────────────────────────────────────────
// `at` = a point on the waterline, `heading` = toward the land (as the coast wave). The world ocean's level is eased
// from its own level (`from`) down to `to` over t0..t0+dur (fast start); the bared band gets wet glossy sand with
// ripples, tide pools, weed, rocks and coral heads, fish flopping where the water has left them, and a longtail boat on
// its side. t0 < -dur = already drawn back (continuity shots). Pure function of t.
function hullGeo() {
  // a longtail: open hull 8 m, beam 1.3 m, raised bow; vertex colours (white topsides, blue stripe, red-brown bottom)
  const L = 8, B = 0.65, D = 0.75, NL = 24, NA = 10, pos = [], col = [], idx = [];
  for (let i = 0; i <= NL; i++) {
    const f = i / NL, z = (f - 0.5) * L, taper = Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + f * 0.95)), 0.55), bow = Math.pow(Math.max(0, f - 0.6) / 0.4, 2) * 0.9;
    for (let j = 0; j <= NA; j++) {
      const a = Math.PI * (j / NA), x = Math.cos(a) * B * taper, y = -Math.sin(a) * D * (0.35 + 0.65 * taper) + D + bow;
      pos.push(x, y, z);
      const h = (y - bow) / D, c = h > 0.72 ? [0.86, 0.86, 0.82] : h > 0.55 ? [0.12, 0.3, 0.62] : [0.42, 0.2, 0.14];
      col.push(...c);
    }
  }
  for (let i = 0; i < NL; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function fishGeo() {
  // body lying on its side (long axis Z, flat in Y), origin at the body centre; the tail is a separate mesh
  const g = new THREE.SphereGeometry(1, 14, 8); const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = (1 - 0.45 * Math.max(0, z)) * (1 - 0.35 * Math.max(0, -z));
    p.setXYZ(i, x * 0.062 * k, y * 0.04, z * 0.2);
    const back = x > 0.25 ? 1 : 0; c[i * 3] = back ? 0.2 : 0.85; c[i * 3 + 1] = back ? 0.27 : 0.87; c[i * 3 + 2] = back ? 0.33 : 0.9;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals(); return g;
}
function tailGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.09, 0, -0.13, 0.09, 0, -0.13, 0, 0.004, -0.06], 3));
  g.setIndex([0, 1, 3, 0, 3, 2, 1, 2, 3]); g.computeVertexNormals(); return g;
}
function lumpGeo(seed, k) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, r = rng(seed);
  const a = [r() * 9, r() * 9, r() * 9];
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const d = 1 + k * (Math.sin(x * 3.1 + a[0]) * Math.sin(y * 2.6 + a[1]) * Math.sin(z * 2.9 + a[2])) + 0.08 * Math.sin(x * 9 + z * 7 + a[0]); p.setXYZ(i, x * d, Math.max(-0.25, y) * d * 0.62, z * d); }
  g.computeVertexNormals(); return g;
}
async function buildDrawback(item, ctx) {
  const P = prm(item);
  const at = item.at || [0, 0];
  const hd = (item.heading ?? 270) * DEG;
  const dir = [Math.sin(hd), -Math.cos(hd)], perp = [-dir[1], dir[0]];
  const G = ctx.ground.height;
  const WA = ctx.ground.water || ctx.water || null, uLev = WA && WA.uniforms && WA.uniforms.uLevel ? WA.uniforms.uLevel : null;
  const L0 = num(P.from, WA?.level ?? ctx.water?.level ?? 0), L1 = num(P.to, L0 - 3.5);
  const t0 = num(P.t0, 0), DD = Math.max(0.1, num(P.dur, 2.5));
  const WD = num(P.width, 320), SEA = num(P.reach, 220), BACK = 14;
  const lvl = (t) => { const x = clamp((t - t0) / DD); return lerp(L0, L1, 1 - Math.pow(1 - x, 2.4)); };
  const gy0 = G(at[0], at[1]);
  const root = new THREE.Group(); root.name = 'fx.tsunami.drawback'; root.position.set(at[0], gy0, at[1]);
  const W2 = (s, u) => [at[0] + dir[0] * s + perp[0] * u, at[1] + dir[1] * s + perp[1] * u];
  const uT = { value: 0 }, uLv = { value: L0 }, uL0 = { value: L0 }, uL1 = { value: L1 };
  // ── the bared seabed: a terrain-following sheet over the band, fading out above the old waterline
  const NS = 150, NU = 170, geo = new THREE.PlaneGeometry(1, 1, NU - 1, NS - 1), gp = geo.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const u = gp.getX(i) * WD, s = BACK - (gp.getY(i) + 0.5) * (SEA + BACK);
    const w = W2(s, u); gp.setXYZ(i, w[0] - at[0], G(w[0], w[1]) + 0.025 - gy0, w[1] - at[1]);
  }
  geo.computeVertexNormals(); geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const bed = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  bed.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uT, uLv, uL0, uL1, uDir: { value: new THREE.Vector2(dir[0], dir[1]) } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uT, uLv, uL0, uL1; uniform vec2 uDir; varying vec3 vWp;\n' + NOISE_GLSL + /* glsl */`
      float bedH(vec2 p){ float a = dot(p, uDir), c = dot(p, vec2(-uDir.y, uDir.x));
        return sin(a * 3.3 + fbm3(vec3(p * 0.05, 1.0)) * 7.0 + sin(c * 0.45) * 1.2) * 0.5 + 0.5; }`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        float dry = smoothstep(uL0 - 0.25, uL0 + 0.45, vWp.y);                     // above the old waterline: fades out
        float n1 = fbm3(vec3(vWp.xz * 0.09, 3.0)), n2 = fbm3(vec3(vWp.xz * 0.45, 7.0)), n3 = vn3(vec3(vWp.xz * 2.6, 1.0));
        float depthB = clamp((uL0 - vWp.y) / max(0.5, uL0 - uL1), 0.0, 1.0);       // 0 at the old shore, 1 at the new
        vec3 sand = mix(vec3(0.33, 0.29, 0.23), vec3(0.2, 0.18, 0.15), depthB * 0.7 + n1 * 0.3);
        float weed = smoothstep(0.58, 0.72, n1 + 0.25 * n2) * smoothstep(0.15, 0.5, depthB);
        sand = mix(sand, vec3(0.11, 0.13, 0.07), weed * 0.85);
        float shell = step(0.93, n3) * (1.0 - weed);
        sand = mix(sand, vec3(0.62, 0.6, 0.55), shell * 0.6);
        float sAl = dot(vWp.xz, uDir), run = sin(sAl * 0.85 + fbm3(vec3(vWp.xz * 0.02, 5.0)) * 9.0);  // ridge-and-runnel, ~7 m
        float pool = max(smoothstep(0.6, 0.64, n1 * 0.8 + n2 * 0.35 + depthB * 0.12), smoothstep(0.55, 0.85, run) * smoothstep(0.35, 0.65, n2 + 0.2 * n1) * 0.9) * (1.0 - dry);
        float left = smoothstep(uLv + 0.02, uLv + 0.4, vWp.y);                      // uncovered by now
        diffuseColor.rgb = mix(sand, vec3(0.05, 0.075, 0.085), pool);
        diffuseColor.a *= (1.0 - dry) * smoothstep(0.0, 0.35, left + 0.35);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(0.16, 0.34, n2) * mix(1.0, 2.2, weed), 0.03, pool);')
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        { float e = 0.05; vec2 q = vWp.xz; float h0 = bedH(q), hx = bedH(q + vec2(e, 0.0)), hz = bedH(q + vec2(0.0, e));
          vec3 dn = vec3(h0 - hx, 0.0, h0 - hz) * 0.9 * (1.0 - pool) * (1.0 - weed * 0.6);
          normal = normalize(normal + (viewMatrix * vec4(dn, 0.0)).xyz); }`);
  };
  const bedMesh = new THREE.Mesh(geo, ctx.patch ? ctx.patch(bed) : bed);
  bedMesh.name = 'drawback_bed'; bedMesh.userData.noQA = true; bedMesh.receiveShadow = true; bedMesh.renderOrder = -2; bedMesh.frustumCulled = false;
  root.add(bedMesh);
  // ── rocks and coral heads on the band (below the old shore by 0.6 m or more)
  const R = rng((item.seed ?? 11) * 7 + 3);
  const inBand = (w, min) => { const g = G(w[0], w[1]); return g < L0 - min && g > L1 - 1.5; };
  const place = (n, min, sizeF) => { const out = []; for (let k = 0; k < n * 6 && out.length < n; k++) { const s = -R() * SEA, u = (R() - 0.5) * WD, w = W2(s, u); if (!inBand(w, min)) continue; out.push({ w, g: G(w[0], w[1]), sz: sizeF(R()), yaw: R() * TAU, tilt: (R() - 0.5) * 0.5 }); } return out; };
  const nRock = Math.round(num(P.rocks, 90)), nCoral = Math.round(num(P.coral, 120));
  const rockMat = stdMat(ctx, { color: 0x4d4a44, roughness: 0.62 }), coralMat = stdMat(ctx, { color: 0xffffff, roughness: 0.85, vertexColors: true });
  const lays = [[lumpGeo(5, 0.28), rockMat, place(nRock, 0.5, (r) => 0.3 + Math.pow(r, 2.5) * 1.6), false], [lumpGeo(9, 0.45), coralMat, place(nCoral, 1.0, (r) => 0.25 + Math.pow(r, 2) * 0.9), true]];
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const CORAL = [[0.72, 0.56, 0.5], [0.8, 0.72, 0.55], [0.55, 0.42, 0.52], [0.86, 0.84, 0.78], [0.62, 0.48, 0.3]];
  for (const [g0, mat, list, coral] of lays) {
    const g = coral ? g0.clone() : g0;
    if (coral) { const c = new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    const im = new THREE.InstancedMesh(g, mat, Math.max(1, list.length)); im.count = list.length;
    list.forEach((o, i) => { _e.set(o.tilt, o.yaw, o.tilt * 0.6); _q.setFromEuler(_e); _p.set(o.w[0] - at[0], o.g - gy0 - o.sz * 0.18, o.w[1] - at[1]); _s.set(o.sz, o.sz * (coral ? 0.9 : 0.75), o.sz * 1.1); _m.compose(_p, _q, _s); im.setMatrixAt(i, _m); if (coral) im.setColorAt(i, new THREE.Color(...CORAL[i % CORAL.length])); });
    im.castShadow = im.receiveShadow = true; im.userData.noQA = true; im.frustumCulled = false; root.add(im);
  }
  // ── stranded fish: flop where the water has left them
  const fa = Array.isArray(P.fish_area) && P.fish_area.length === 2 ? P.fish_area : null;
  const nFish = Math.round(num(P.fish, 70)), FI = [];
  for (let k = 0; k < nFish * 8 && FI.length < nFish; k++) {
    let w;
    if (fa) w = [lerp(fa[0][0], fa[1][0], R()), lerp(fa[0][1], fa[1][1], R())];
    else w = W2(-R() * SEA * 0.8, (R() - 0.5) * WD * 0.7);
    const g = G(w[0], w[1]); if (g > L0 - 0.15 || g < L1 + 0.05) continue;
    FI.push({ w, g, len: 0.22 + R() * 0.24, yaw: R() * TAU, ph: R() * 10, rate: 0.55 + R() * 0.9, side: R() < 0.5 ? 1 : -1, tone: R() });
  }
  const fishMat = stdMat(ctx, { color: 0xffffff, roughness: 0.22, metalness: 0.6, vertexColors: true });
  const bodyM = new THREE.InstancedMesh(fishGeo(), fishMat, Math.max(1, FI.length)), tailM = new THREE.InstancedMesh(tailGeo(), stdMat(ctx, { color: 0x6f7780, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }), Math.max(1, FI.length));
  FI.forEach((f, i) => bodyM.setColorAt(i, new THREE.Color().setRGB(lerp(0.55, 0.78, f.tone), lerp(0.6, 0.8, f.tone), lerp(0.66, 0.84, f.tone))));
  for (const m of [bodyM, tailM]) { m.castShadow = true; m.userData.noQA = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
  const _t = new THREE.Vector3(), _mt = new THREE.Matrix4(), _qt = new THREE.Quaternion(), UPV = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3();
  function updateFish(t, L) {
    let n = 0;
    for (const f of FI) {
      const bare = sstep(L + 0.02, L + 0.12, f.g);                       // the water has left this spot
      if (bare <= 0.001) continue;
      // flop: bursts of 2-3 kicks, then rest; the body arches (roll + hop), the tail whips
      const tt = t * f.rate + f.ph, cyc = tt % 2.6, kick = cyc < 0.9 ? Math.sin(cyc / 0.9 * Math.PI * 3) * Math.sin(cyc / 0.9 * Math.PI) : 0;
      const hop = Math.max(0, kick) * 0.09 * f.len / 0.4, roll = f.side * (0.12 + 0.55 * Math.abs(kick)), yawJ = 0.35 * kick;
      _e.set(0, f.yaw + yawJ, roll * 0.25, 'YXZ'); _q.setFromEuler(_e);
      const sc = f.len * bare;
      _p.set(f.w[0] - at[0], f.g - gy0 + 0.035 * sc / 0.4 + hop, f.w[1] - at[1]);
      _q.multiply(_qt.setFromAxisAngle(FWD.set(0, 0, 1), roll));
      _s.set(sc / 0.4, sc / 0.4, sc / 0.4); _m.compose(_p, _q, _s); bodyM.setMatrixAt(n, _m);
      // tail at the rear, whipping sideways
      _t.set(0, 0, -0.19 * sc / 0.4).applyQuaternion(_q).add(_p);
      _qt.copy(_q).multiply(new THREE.Quaternion().setFromAxisAngle(UPV, 0.9 * kick * f.side));
      _mt.compose(_t, _qt, _s); tailM.setMatrixAt(n, _mt);
      n++;
    }
    bodyM.count = tailM.count = n; bodyM.instanceMatrix.needsUpdate = tailM.instanceMatrix.needsUpdate = true;
  }
  // ── a longtail boat left lying on its side
  if (P.boat !== false) {
    let w = Array.isArray(P.boat_at) ? P.boat_at : null;
    if (!w) for (let k = 0; k < 60; k++) { const c = W2(-SEA * (0.2 + 0.25 * R()), (R() - 0.5) * WD * 0.35); const g = G(c[0], c[1]); if (g < L0 - 0.8 && g > L1 + 0.4) { w = c; break; } }
    if (w) {
      const hm = new THREE.Mesh(hullGeo(), stdMat(ctx, { color: 0xffffff, roughness: 0.55, vertexColors: true, side: THREE.DoubleSide }));
      const g = G(w[0], w[1]); hm.position.set(w[0] - at[0], g - gy0 - 0.25, w[1] - at[1]);
      hm.scale.setScalar(1.25); hm.rotation.set(0.05, num(P.boat_heading, 35) * DEG, -0.5, 'YXZ'); hm.castShadow = hm.receiveShadow = true; hm.userData.noQA = true; root.add(hm);
      // the long-tail engine shaft lying on the sand behind it
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6), stdMat(ctx, { color: 0x3a3a3a, roughness: 0.5, metalness: 0.6 }));
      shaft.position.set(0, 0.3, -5.2); shaft.rotation.x = Math.PI / 2 - 0.1; hm.add(shaft);
    }
  }
  function update(t, clock, camera) {
    const L = lvl(t);
    uT.value = t; uLv.value = L;
    if (uLev) uLev.value = L;                                            // the world ocean goes out with it
    updateFish(t, L);
  }
  update(0, 0, null);
  // sceneWater: when the sea is already out for the whole shot, the camera / QA / snapping use the drawn-back level
  return { root, radius: 60, height: 2, update, snapped: true, anchors: {}, footprint: [40, 40], contact: false, level: lvl, sceneWater: t0 + DD <= 0 ? L1 : undefined };
}

export async function build(kind, item, ctx) {
  const mode = prm(item).mode || item.action || 'coast';
  if (mode === 'knee') return buildKnee(item, ctx);
  if (mode === 'drawback') return buildDrawback(item, ctx);
  return buildCoast(item, ctx);
}
