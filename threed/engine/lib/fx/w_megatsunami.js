// w_megatsunami.js — fx.megatsunami: Lituya Bay 1958. A fjord wall (own mesh: a 38-degree forested slope rising to
// ~700 m out of the bay) and a giant wave that crosses the bay and runs up the slope to `runup` m (524), stripping the
// forest in a clean trimline: below the line the trees fall and the ground turns to bare rock; above it the forest
// stands. A mustard marker and label mark the peak. `at` = the shoreline at the foot of the wall, `heading` = the
// direction the wave travels (uphill). Everything is a pure function of t.
// Q4 (opt-in) `rockfall: {quake, fall, hit, across}`: the cliff at the head of the inlet, across from this wall: it
// shivers in the quake, a slab lets go and falls breaking up in a dust curtain, hits the water, and the wave is born
// from the splash (it reaches the wall's foot at t_arrive). Without `rockfall` nothing changes.
import * as THREE from 'three';
import { prm, num, Puffs, Streaks, stdMat, coniferGeo, rng, clamp, lerp, sstep, fbm1, vnoise, TAU, DEG, U } from './w_common.js';
import { waterMat } from './w_tsunami.js';
import { mountainSkin, skinField } from '../nature/skin.js';
import { makeNoise } from '../shared/util.js';

export const CATALOG = {
  'fx.megatsunami': {
    desc: 'Lituya-Bay megatsunami: a forested fjord wall (38 deg, ~700 m) rising from the bay at `at` (use biome ocean); a giant wave crosses the bay along `heading` and runs up the wall to `runup` m (524), stripping the forest in a clean trimline; a mustard marker + label at the peak. t_arrive = wave at the foot (s), rise = run-up duration (s).',
    actions: ['runup'],
    params: { runup: 524, angle: 38, width: 1500, trees: 5200, wave: 110, speed: 55, rise: 9, label: '524 m', rockfall: null },
    doc: { rockfall: 'optional {quake, fall, hit, across}: s the cliff shivers (default fall - 2.5), s the slab lets go, s its leading edge hits the water (the splash peaks ~0.7 s later; the wave is born from it and reaches the wall foot at t_arrive), m of inlet between the cliff foot and this wall (560). Lituya m04: {quake: 2.38, fall: 4.88, hit: 9.67}' },
    footprint: [200, 200], height: 700, tags: ['disaster', 'water', 'wave', 'megatsunami', 'fjord', 'fx'], section: 'objects', contact: false,
  },
};

export async function build(kind, item, ctx) {
  const P = prm(item);
  const at = item.at || [0, 0], G = ctx.ground.height, gy0 = G(at[0], at[1]);
  const level = ctx.water?.level ?? 0;
  const RUN = num(P.runup, 524), ANG = num(P.angle, 38) * DEG, WD = num(P.width, 1500), dur = ctx.dur ?? 14;
  const tA = num(P.t_arrive, dur * 0.3), RISE = num(P.rise, 9), V = num(P.speed, 55), HW = num(P.wave, 110);
  const RFp = P.rockfall && typeof P.rockfall === 'object' ? P.rockfall : (P.rockfall === true ? {} : null);
  const RF = RFp ? { fall: num(RFp.fall, tA - 6.4), hit: num(RFp.hit, tA - 1.63), across: Math.max(250, num(RFp.across, 560)) } : null;
  if (RF) {
    RF.quake = num(RFp.quake, RF.fall - 2.5); RF.sImp = -RF.across + 70; RF.t0 = RF.hit + 0.25;   // the splash sheet sets off
    RF.humpS = (t) => (t < RF.t0 ? -1e4 : lerp(RF.sImp, 0, clamp((t - RF.t0) / Math.max(0.3, tA - RF.t0))));
    RF.humpK = (t) => sstep(RF.hit + 0.05, RF.hit + 0.6, t);
  }
  const root = new THREE.Group(); root.name = 'fx.megatsunami'; root.position.set(at[0], level, at[1]);
  root.rotation.y = Math.PI - (item.heading ?? 0) * DEG;                   // local +Z = uphill (the travel)
  const TOP = 720, SMAX = TOP / Math.tan(ANG) + 160;
  // wall height: rises from the bay floor (-40 m) through the shore into a steep face, a rounded crest; a gentle bowl
  const wall = (s, u) => {
    const face = s * Math.tan(ANG) * (1 + 0.1 * fbm1(u / 260, 4)) + 14 * fbm1(s / 90 + u / 140, 7);
    const crest = TOP + 40 * fbm1(u / 400, 9);
    const h = s < 0 ? s * 0.12 - 2 : Math.min(face, crest - (crest - face) * 0 ) ;
    const soft = crest - 60 * Math.exp(-Math.max(0, face - crest + 60) / 60) ;
    return (s < 0 ? h : Math.min(h, soft)) + 0.00012 * u * u * sstep(0, 300, s);
  };
  const runMax = (u) => RUN * clamp(1 - 0.62 * (u / (WD * 0.42)) ** 2, 0.18, 1) * (1 - 0.16 * (0.5 + 0.5 * fbm1(u / 140 + 4, 72)) * sstep(0, 140, Math.abs(u)));   // peak at the centre line; Q8: an irregular trimline, not a dome
  const sOfH = (h, u) => { let lo = 0, hi = SMAX; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (wall(m, u) < h) lo = m; else hi = m; } return lo; };
  // the run-up: distance reached along the slope, eased (C1) to the peak, then a slow partial drain
  const peakS = new Float32Array(161); for (let j = 0; j <= 160; j++) peakS[j] = sOfH(runMax((j / 160 - 0.5) * WD), (j / 160 - 0.5) * WD);
  const peakAt = (u) => { const f = clamp((u / WD + 0.5) * 160, 0, 159.999), j = Math.floor(f); return lerp(peakS[j], peakS[j + 1], f - j); };
  const reach = (t, u) => {                                                   // s of the water front at t
    if (t < tA) return RF ? RF.humpS(t) : V * (t - tA);                       // crossing the bay (or: born from the rockfall's splash)
    const x = clamp((t - tA) / RISE), e = 1 - (1 - x) * (1 - x) * (1 - x);      // ease-out: arrives fast, stops at the peak
    const drain = sstep(tA + RISE, tA + RISE + 14, t) * 0.35;
    return (V * RISE / 3 > 0 ? peakAt(u) * e : 0) * (1 - drain);
  };
  const reachedMax = (t, u) => reach(Math.min(t, tA + RISE), u);

  // ── the wall (vertex colours: forest floor above the reach, bare rock below it)
  const NS = 150, NU = 170;
  const wgeo = new THREE.PlaneGeometry(1, 1, NU - 1, NS - 1);
  const wp = wgeo.attributes.position, WS = new Float32Array(wp.count), WU = new Float32Array(wp.count), WH = new Float32Array(wp.count);
  for (let i = 0; i < wp.count; i++) { const u = (wp.getX(i)) * WD * 1.4, s = (wp.getY(i) + 0.5) * (SMAX + 250) - 250; const h = wall(s, u); WS[i] = s; WU[i] = u; WH[i] = h; wp.setXYZ(i, u, h, s); }
  wgeo.computeVertexNormals();
  const wcol = new Float32Array(wp.count * 3); wgeo.setAttribute('color', new THREE.BufferAttribute(wcol, 3));
  // Q5: the mountain skin: forest crowns and brushy chutes, rock buttresses and ribs, a bare alpine band and a ragged snow line
  const wallMesh = new THREE.Mesh(wgeo, mountainSkin(stdMat(ctx, { color: 0xffffff, roughness: 0.95, vertexColors: true, side: THREE.DoubleSide }), wgeo, { forest: 1, snowLine: level + 660, rockSlope: 0.29, rock: 0x5b5850, relief: 1.6, seed: 5, waterLine: level }));
  wallMesh.receiveShadow = true; wallMesh.castShadow = true; wallMesh.userData.noQA = true; wallMesh.name = 'fjord_wall'; root.add(wallMesh);
  let lastStrip = -1;
  function paintWall(t) {
    const k = Math.round(clamp((t - tA) / RISE, 0, 1) * 60);
    if (k === lastStrip) return; lastStrip = k;
    for (let i = 0; i < wp.count; i++) {
      const s = WS[i], u = WU[i], h = WH[i];
      const n = 0.5 + 0.5 * vnoise(s * 0.05 + u * 0.031, 3);
      const snow = sstep(640, 700, h + 30 * n);
      const stripped = s > 0 && s < reachedMax(t, u) + 4 ? 1 : 0;
      let c = [lerp(0.13, 0.17, n), lerp(0.17, 0.21, n), lerp(0.11, 0.13, n)];      // dark forest floor
      if (s < 25) c = [0.36, 0.33, 0.28];
      if (stripped) c = [lerp(0.42, 0.52, n), lerp(0.38, 0.47, n), lerp(0.33, 0.4, n)];   // scoured rock + mud
      c = c.map((v, q) => lerp(v, [0.9, 0.92, 0.95][q], snow));
      wcol[i * 3] = c[0]; wcol[i * 3 + 1] = c[1]; wcol[i * 3 + 2] = c[2];
    }
    wgeo.attributes.color.needsUpdate = true;
  }
  // ── the forest (instanced spruce, 18-30 m) with the stripping animation
  const NT = Math.round(num(P.trees, 5200)), R = rng(606);
  const trees = new THREE.InstancedMesh(coniferGeo(), stdMat(ctx, { color: 0xffffff, roughness: 0.85, vertexColors: true }), NT);
  trees.castShadow = true; trees.receiveShadow = true; trees.userData.noQA = true; trees.frustumCulled = false; trees.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(trees);
  const TR = [];
  for (let i = 0; i < NT * 2 && TR.length < NT; i++) {
    const u = (R() - 0.5) * WD * 1.3, s = 30 + R() * SMAX;
    const h = wall(s, u); if (h > 620 + 40 * vnoise(u * 0.01, 2)) continue;
    TR.push({ u, s, y: h, sz: 18 + R() * 12, yaw: R() * TAU, ph: R() });
  }
  // Q5 (no draws from R): the skin's bare rock buttresses carry no trees, and every tree gets a shade (stands of older,
  // darker spruce and younger, lighter ones) so the forest is not one flat green
  { const c = new THREE.Color();
    for (let i = 0; i < TR.length; i++) {
      const tr = TR[i]; tr.bare = skinField(tr.u, tr.s, 5) > 0.635;
      const k = 0.74 + 0.4 * skinField(tr.u * 2.7 + 400, tr.s * 2.7, 9); c.setRGB(k * 0.97, k, k * 0.96); trees.setColorAt(i, c);
    }
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true; }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  function updateTrees(t) {
    for (let i = 0; i < TR.length; i++) {
      const tr = TR[i];
      const r = reachedMax(t, tr.u);
      const passed = r - tr.s;                                                     // metres the front has gone past
      const k = sstep(0, 45, passed);                                              // flattened and swept away, eased
      _p.set(tr.u, tr.y - 0.5 - k * 3, tr.s + k * 12);                            // Q8: they topple uphill, with the flow
      _e.set(k * 1.45, tr.yaw * (1 - k), 0.25 * k * Math.sin(tr.ph * 9)); _q.setFromEuler(_e);
      const sc = tr.bare ? 0 : tr.sz * (1 - 0.55 * sstep(0.6, 1, k));          // Q5: none on the bare buttresses
      _s.set(sc, sc, sc); _m.compose(_p, _q, _s); trees.setMatrixAt(i, _m);
    }
    trees.count = TR.length; trees.instanceMatrix.needsUpdate = true;
  }
  // ── the water: bay surface + the wave crossing the bay + the sheet climbing the wall (one CPU grid in (s, u))
  const GS = 170, GU = 150;
  const geo = new THREE.PlaneGeometry(1, 1, GU - 1, GS - 1);
  const pos = geo.attributes.position.array, n = pos.length / 3;
  const col = new Float32Array(n * 3), fx = new Float32Array(n * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aFx', new THREE.BufferAttribute(fx, 3));
  const QS = new Float32Array(n), QU = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = i % GU, b = Math.floor(i / GU); QU[i] = (a / (GU - 1) - 0.5) * WD * 1.3; QS[i] = -1400 + (b / (GS - 1)) * (SMAX + 1400); }
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const uT = { value: 0 }, uFlow = { value: new THREE.Vector2(0, 8) };
  const water = new THREE.Mesh(geo, waterMat(ctx, uT, { uFlow, rough: 0.26, env: 0.75, bump: 0.8, sss: 1.0, farBump: 0.9 }));
  water.name = 'megatsunami_water'; water.userData.noQA = true; water.frustumCulled = false; water.receiveShadow = true; root.add(water);
  // Q8: the run-up races up the wall's gullies: the skin's bowl field (skinField low = bowls, high = rock buttresses)
  const gullyF = (u, F) => 60 * sstep(0.62, 0.3, skinField(u, Math.max(0, F), 5));
  function updateWater(t) {
    uT.value = t;
    const oc = ctx.ground?.water, calm = (oc?.kind === 'ocean' ? 0.35 + 0.91 * (oc.uniforms?.uSwell?.value ?? 1) : 0) * (1 - sstep(tA - 3, tA, t));   // swell amplitude + margin, until the wave arrives
    for (let i = 0; i < n; i++) {
      const s = QS[i], u = QU[i];
      const F = reach(t, u) + 18 * vnoise(u / 60 + 3, 5);
      const g = wall(s, u);
      let y, foam = 0.1, thin = 0;
      if (t < tA || s < 0) {
        // the bay: a huge hump travelling toward the wall (before it arrives), afterwards a churned, raised bay
        const Fs = t < tA ? (RF ? RF.humpS(t) : V * (t - tA)) : 0;
        // Q8: a breaking wave, not a dome: a long gentle back, a steep front, a wavy crest line, lumps along it
        const Fsu = Fs + 30 * fbm1(u / 160 + 7, 93), lump = 1 + 0.16 * fbm1(u / 90 + 2, 91) + 0.06 * vnoise(u / 65 + t * 0.6, 92);
        const hump = (t < tA ? HW : HW * (1 - sstep(tA, tA + 6, t))) * lump * Math.exp(-(((s - Fsu) / (s <= Fsu ? 160 : 48)) ** 2)) * (1 - sstep(WD * 0.45, WD * 0.64, Math.abs(u)));
        const hk = hump / Math.max(1, HW), fr = s > Fsu ? 1 : 0;
        const rest = 6 * sstep(tA - 2, tA + 3, t) * Math.exp(Math.min(0, s) / 500);
        const lift = hump * (0.7 + 0.3 * sstep(-700, 0, s)) * (RF ? RF.humpK(t) : 1) + rest + (RF ? RF.heave(s, u, t) : 0)
          + hk * (6 * vnoise(s / 19 + u / 31 - t * 2.1, 94) + 3.5 * vnoise(u / 40 + s / 13 + t * 1.7, 95));   // Q8: a turbulent surface (smooth along the crest: no sawtooth)
        y = level + lift - calm * (1 - sstep(0, 2 * calm, lift));           // calm bay: tucked under the ocean's swell (no z-fight)
        foam = 0.12 + 1.15 * sstep(0.55, 0.92, hk) * (0.75 + 0.25 * vnoise(u / 30 + t, 96)) + fr * 0.75 * sstep(0.12, 0.55, hk) + 0.4 * sstep(tA - 1, tA + 4, t) * Math.exp(Math.min(0, s) / 300)
          + (calm > 0.01 ? 0.9 * Math.exp(-(((lift - calm * 1.5) / (calm + 0.5)) ** 2)) : 0);   // churned fringe where the wave meets the calm bay
        thin = sstep(0.35, 0.85, hk) * (0.9 - 0.4 * fr);
      } else {
        // the run-up sheet: a thick foaming bore just behind the front, a thinner sheet behind it
        // Q8: tongues of water race ahead in the gullies (fingers), the sheet boils (bumps), streaky foam over brown water
        const drainK = sstep(tA + RISE - 0.5, tA + RISE + 5, t);
        const fing = (30 * Math.max(0, fbm1(u / 22 + 13, 73)) + 14 * Math.max(0, fbm1(u / 8 + 3, 74)) + gullyF(u, F)) * sstep(tA, tA + 1.2, t) * (1 - 0.7 * drainK);
        const behind = F + fing - s, topS = (F + fing) * (1 - drainK * 0.95);
        const on = sstep(-2, 6, topS - s);
        const tip = sstep(0, 25 + fing * 0.5, behind);                          // finger tips run thin
        const thick = behind < 0 ? -3 : lerp(-3, (2.5 + 20 * Math.exp(-behind / 40) * (1 - drainK * 0.8)) * lerp(0.35, 1, tip) + 3 * sstep(0, 30, behind) + 2.2 * vnoise(s / 13 - t * 3.2 + u / 17, 75) * (1 - drainK), on);
        y = g + thick;
        foam = 0.22 + 0.85 * Math.exp(-Math.max(0, behind) / 45) + 0.45 * (1 - tip) + 0.4 * Math.max(0, fbm1(u / 26 + s / 35 - t * 1.8, 76)) - 0.3 * drainK;   // Q8: grey-green water with foam streaks, not a white sheet
      }
      pos[i * 3] = u; pos[i * 3 + 1] = y - level; pos[i * 3 + 2] = s;
      fx[i * 3] = foam; fx[i * 3 + 1] = thin; fx[i * 3 + 2] = 0.6;
      const mud = s > 0 ? 1 : 0, silt = 0.5 + 0.5 * vnoise(u / 30 + s / 45, 77), hy = clamp((y - level) / Math.max(1, HW));
      const sh = s <= 0 ? lerp(0.75, 1.5, sstep(0.05, 0.8, hy)) : 1;                                        // Q8: depth shading on the wave
      const dep = clamp((y - g) / 16), lw = (0.88 + 0.24 * silt);                                            // Q8: deep = dark green-grey, thin = pale grey-green
      col[i * 3] = lerp(0.02 * sh, lerp(0.32, 0.11, dep) * lw, mud); col[i * 3 + 1] = lerp(0.085 * sh, lerp(0.35, 0.15, dep) * lw, mud); col[i * 3 + 2] = lerp(0.09 * sh, lerp(0.3, 0.13, dep) * lw, mud);
    }
    geo.attributes.position.needsUpdate = geo.attributes.aFx.needsUpdate = geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
  }
  // ── spray at the front + mist
  const NP = 900, puffs = new Puffs(ctx, NP, { back: 1.2, dark: 0.15, name: 'mega_spray' }); root.add(puffs.mesh);
  const PP = []; for (let i = 0; i < NP; i++) PP.push({ u: (R() - 0.5) * WD * 1.2, ph: R(), life: 2 + R() * 3, sz: 0.5 + R(), at: Math.floor(R() * 4), rot: R() * TAU });
  // Q8: spray thrown uphill ahead of the run-up front: thin ballistic water streaks, not billows
  const NSt = 700, streaks = new Streaks(ctx, NSt, { color: [0.86, 0.88, 0.86] }); root.add(streaks.mesh);
  const SQ = []; for (let i = 0; i < NSt; i++) SQ.push({ u: (R() - 0.5) * WD * 0.9, ph: R(), life: 0.9 + R() * 1.1, v: 10 + R() * 16, up: 12 + R() * 18 });
  function updateStreaks(t) {
    for (let i = 0; i < NSt; i++) {
      const q = SQ[i], age = ((t / q.life + q.ph) % 1 + 1) % 1, a = age * q.life, tb = t - a;
      if (tb < tA + 0.2 || tb > tA + RISE * 0.95) { streaks.hide(i); continue; }
      const F0 = reach(tb, q.u) + gullyF(q.u, reach(tb, q.u)) * 0.5, y0 = wall(F0, q.u) + 4;
      const sA = F0 + q.v * a, yA = y0 + q.up * a - 4.9 * a * a, sB = sA - q.v * 0.05, yB = yA - (q.up - 9.8 * a) * 0.05;
      if (yA < wall(sA, q.u)) { streaks.hide(i); continue; }
      streaks.set(i, q.u, yB - level, sB, q.u, yA - level, sA, 0.35, 0.5 * (1 - age));
    }
    streaks.commit();
  }
  function updatePuffs(t, camera) {
    updateStreaks(t);
    for (let i = 0; i < NP; i++) {
      const p = PP[i], age = ((t / p.life + p.ph) % 1 + 1) % 1, tb = t - age * p.life;
      const F = reach(tb, p.u), s = Math.max(F, -1400);
      const onWall = tb >= tA;
      const g = onWall ? wall(s, p.u) + 12 : level + (tb < tA ? HW * 0.85 : 10);
      const a = age * p.life, up = onWall ? (16 + 10 * p.sz) * a - 4.9 * a * a * 0.6 : 18 * a, back = onWall ? (9 + 7 * p.sz) * a : -12 * a;   // Q8: on the wall the spray is thrown ahead, uphill
      const sz = onWall ? Math.min(12, 9 * (0.4 + age) * p.sz) : Math.min(26, 30 * (0.4 + age) * p.sz);   // Q8: capped (DOF turned 100 m billows into bokeh discs)
      const al = 0.26 * sstep(0, 0.15, age) * (1 - sstep(0.4, 1, age)) * sstep(tA - 12, tA - 6, tb) * (1 - sstep(tA + RISE + 1, tA + RISE + 6, tb)) * (RF ? sstep(RF.hit, RF.hit + 0.4, tb) : 1);
      puffs.set(i, p.u, g - level + Math.max(0, up) + sz * 0.25, s + back, sz, al * (onWall ? 0.4 : 0.6 * (1 - sstep(tA - 0.3, tA + 0.6, t))), p.rot, onWall ? 0.9 : 0.95, onWall ? 0.9 : 0.97, onWall ? 0.88 : 1.0, p.at, 0.9 + 0.1 * age, 0.85);
    }
    puffs.commit(camera);
  }
  // ── the peak marker: a mustard pole + label at the highest run-up point (centre line), fades in at the peak
  const sPk = peakAt(0), hPk = wall(sPk, 0);
  const lc = document.createElement('canvas'); lc.width = 1024; lc.height = 300;
  { const g = lc.getContext('2d'); g.font = '900 210px "Inter Display", "Inter", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 18; g.strokeStyle = 'rgba(20,22,26,0.85)'; g.strokeText(String(P.label ?? '524 m'), 512, 160); g.fillStyle = '#D9A93F'; g.fillText(String(P.label ?? '524 m'), 512, 160); }
  const ltex = new THREE.CanvasTexture(lc); ltex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: ltex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
  label.scale.set(220, 64, 1); label.position.set(0, hPk - level + 120, sPk); label.renderOrder = 50; root.add(label);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 90, 10).translate(0, 45, 0), stdMat(ctx, { color: 0xD9A93F, roughness: 0.5, metalness: 0.2, emissive: 0x3a2a08, emissiveIntensity: 0.6 }));
  pole.position.set(0, hPk - level, sPk); pole.castShadow = true; pole.userData.noQA = true; root.add(pole);
  function update(t, clock, camera) {
    updateWater(t); updateTrees(t); paintWall(t);
    const k = sstep(tA + RISE * 0.8, tA + RISE + 1.2, t);
    label.material.opacity = k; pole.scale.set(1, Math.max(0.001, k), 1);
    if (camera) { root.updateMatrixWorld(true); updatePuffs(t, camera); }
    if (RF) RF.update(t, camera);
  }
  if (P.set !== false) buildFjord(ctx, root, { wall, WD, level, P });              // Q8: the T-shaped fjord around the wall
  if (RF) buildRockfall(ctx, root, RF, { WD, level, tA, HW, R: rng(7331) });
  update(0, 0, null);
  return { root, radius: 300, height: 400, update, snapped: true, anchors: {}, footprint: [300, 300], contact: false, reach, peak: [sPk, hPk] };
}

// ── Q4: the rockfall (opt-in, see the header). Local frame of the fx: u across the bay, s towards this wall (+), y up
// from the water level. The cliff's foot is at s = -across, its face rising inland (towards -s) at ~64 degrees to ~860 m.
function buildRockfall(ctx, root, RF, o) {
  const { WD, level, tA, HW, R } = o;
  const sF = -RF.across, TAN = Math.tan(64 * DEG), TOPc = 860;
  // the cliff closes the head of the inlet; both ends drop into the water as spurs (no mesh edge on screen)
  const uEnd = -RF.across * 1.15, uEnd2 = WD * 0.7 + 150;
  const endK = (u) => sstep(uEnd - 260, uEnd + 180, u) * (1 - sstep(uEnd2 - 320, uEnd2 + 40, u)), U0 = uEnd - 420, U1 = uEnd2 + 260;
  const heave = (s, u, t) => 45 * sstep(RF.hit, RF.hit + 0.5, t) * (1 - sstep(RF.hit + 0.9, RF.hit + 3.2, t)) * Math.exp(-(((s - RF.sImp) / 170) ** 2) - ((u / 320) ** 2));
  RF.heave = heave;
  // cliff height at (s, u): an underwater toe, a steep face cut by V-gullies and buttresses and stepped by ledges, and a
  // ragged crest of towers and notches (a rock wall, not a ramp)
  const cliffH = (s, u) => {
    const q = sF - s;                                                          // metres inland from the foot
    const gul = Math.abs(fbm1(u / 95 + 7, 14)) * 85 + Math.abs(fbm1(u / 37 + 2, 15)) * 32 + Math.abs(fbm1(u / 13 + 5, 20)) * 9;   // gullies and buttresses
    // + 2D knobs and slabs across the face, so no part of it is a plane (1D gullies alone left smooth triangles)
    const knob = Math.abs(fbm1(u / 61 + q / 47 + 3, 21)) * 38 + Math.abs(fbm1(u / 23 - q / 31 + 8, 22)) * 14;
    let face = q * TAN * (1 + 0.1 * fbm1(u / 240 + 3, 11)) + 22 * fbm1(q / 70 + u / 110, 12) - (gul + knob) * sstep(20, 160, q) + 12 * fbm1(q / 23 + u / 29, 16);
    const lh = face / 68 + 0.4 * fbm1(u / 170 + 5, 17), lf = lh - Math.floor(lh);
    face -= 15 * sstep(0.6, 0.93, lf) * sstep(40, 120, face);                 // ledges every ~70 m of height
    const spire = Math.pow(Math.max(0, fbm1(u / 52 + 9, 18)), 1.4) * 170 + Math.abs(fbm1(u / 19 + 4, 19)) * 55;
    const top = TOPc - 70 + 70 * fbm1(u / 380 + 1, 13) + spire;                 // towers and notches on the skyline
    const h = q < 0 ? -8 + q * 1.4 : Math.min(face, top - 45 * Math.exp(-Math.max(0, face - top + 45) / 45));
    return lerp(-45 + 0.05 * Math.max(0, q), h + 0.00012 * Math.max(0, u) * Math.min(u, WD * 0.7), endK(u));
  };
  const faceS = (h) => sF - h / TAN;                                           // s of the face at height h (no noise)
  // the slab: the upper face between hLo and hHi, SW wide, centred on u = 0
  const SW = Math.min(620, WD * 0.42), hLo = 430, hHi = 730;
  const T = Math.max(0.8, RF.hit - RF.fall), aF = 2 * (hLo / Math.sin(64 * DEG)) / (T * T);   // the leading edge reaches the water at hit
  const tBreak = RF.fall + Math.min(1.3, T * 0.3);
  const dAt = (t) => (t <= RF.fall ? 0 : 0.5 * aF * (t - RF.fall) ** 2);      // metres slid along the face
  const DS = Math.cos(64 * DEG), DY = -Math.sin(64 * DEG);                    // down the face: towards +s and down
  // ── cliff mesh: Q5's mountain skin (rock on the steep face with fall-line ribs, ledges and bump detail, forest on the
  //    benches, snow up high, wet-dark at the waterline); the vertex colour only says forest (dark) or rock, and an
  //    aScar attribute darkens the fresh, wet scar the slab leaves behind as it slides away
  const NU = 230, NS = 150, S0 = sF - 980, S1 = sF + 70;
  const cg = new THREE.PlaneGeometry(1, 1, NU - 1, NS - 1), cp = cg.attributes.position;
  const CS = new Float32Array(cp.count), CU = new Float32Array(cp.count), CH = new Float32Array(cp.count);
  for (let i = 0; i < cp.count; i++) { const u = U0 + (cp.getX(i) + 0.5) * (U1 - U0), s = S0 + (cp.getY(i) + 0.5) * (S1 - S0), h = cliffH(s, u); CS[i] = s; CU[i] = u; CH[i] = h; cp.setXYZ(i, u, h, s); }
  cg.computeVertexNormals();
  { // the (x, y) -> (u, s) mapping mirrors the winding: flip it so the faces and normals point up and out of the rock
    let sy = 0; const nn = cg.attributes.normal; for (let i = 0; i < nn.count; i += 53) sy += nn.getY(i);
    if (sy < 0) { const ix = cg.index.array; for (let k = 0; k < ix.length; k += 3) { const tmp = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = tmp; } cg.index.needsUpdate = true; cg.computeVertexNormals(); }
  }
  const ccol = new Float32Array(cp.count * 3); cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
  const scar = new Float32Array(cp.count); cg.setAttribute('aScar', new THREE.BufferAttribute(scar, 1));
  const nrm = cg.attributes.normal;
  for (let i = 0; i < cp.count; i++) {
    const u = CU[i], n = 0.5 + 0.5 * vnoise(CS[i] * 0.04 + u * 0.027, 3), steep = 1 - nrm.getY(i);
    const rock = sstep(0.34, 0.5, steep + 0.2 * (n - 0.5));
    const c = [lerp(lerp(0.1, 0.14, n), 0.36, rock), lerp(lerp(0.14, 0.18, n), 0.34, rock), lerp(lerp(0.09, 0.11, n), 0.31, rock)];   // forest floor | rock
    ccol[i * 3] = c[0]; ccol[i * 3 + 1] = c[1]; ccol[i * 3 + 2] = c[2];
  }
  const cmat = stdMat(ctx, { color: 0xffffff, roughness: 0.95, vertexColors: true, side: THREE.DoubleSide });
  { const prev = cmat.onBeforeCompile, key0 = cmat.customProgramCacheKey ? cmat.customProgramCacheKey() : '';
    cmat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(cmat, sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aScar; varying float vRfScar;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRfScar = aScar;');
      // runs after the skin (the skin inserts its block right after the include): the fresh scar is darker, browner rock
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRfScar;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.58, 0.52, 0.47) + vec3(0.025, 0.018, 0.012), vRfScar);');
    };
    cmat.customProgramCacheKey = () => key0 + '|rfscar'; }
  mountainSkin(cmat, cg, { forest: 1, snowLine: level + 760, rockSlope: 0.3, rock: 0x77716a, relief: 2.2, seed: 9, waterLine: level });
  const cliff = new THREE.Mesh(cg, cmat);
  cliff.receiveShadow = true; cliff.castShadow = true; cliff.userData.noQA = true; cliff.name = 'rockfall_cliff'; root.add(cliff);
  let lastScar = -1;
  const inSlab = (u, h) => Math.abs(u) < SW * 0.5 * (0.85 + 0.15 * Math.cos(h * 0.01)) && h > hLo - 20 && h < hHi + 25;
  function paintCliff(t) {
    const top = hHi - dAt(t) * -DY;                                         // the slab's top edge has slid down to here
    const k = t <= RF.fall ? 0 : Math.min(60, Math.round(dAt(t) / 12) + 1);
    if (k === lastScar) return; lastScar = k;
    for (let i = 0; i < cp.count; i++) {
      const u = CU[i], h = CH[i];
      scar[i] = k > 0 && inSlab(u, h) ? sstep(top - 10, top + 25, h) * (1 - sstep(SW * 0.44, SW * 0.52, Math.abs(u))) : 0;
    }
    cg.attributes.aScar.needsUpdate = true;
  }
  // ── the slab's blocks (instanced lumpy rocks) and a few trees riding it
  const NB = 260, blocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), stdMat(ctx, { color: 0x5a544c, roughness: 0.95, flat: true }), NB);
  blocks.castShadow = true; blocks.receiveShadow = true; blocks.userData.noQA = true; blocks.frustumCulled = false; blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(blocks);
  const BK = [];
  for (let i = 0; i < NB; i++) {
    const gx = (i % 20 + R()) / 20, gy = (Math.floor(i / 20) + R()) / Math.ceil(NB / 20);
    const u = (gx - 0.5) * SW * 0.92, h = hLo + (hHi - hLo) * gy;
    BK.push({ u, h, s: faceS(h) + 6, sz: 16 + 30 * Math.pow(R(), 1.6), sep: 8 + 22 * R(), lat: (R() - 0.5) * 50, rx: R() * 6, ry: R() * 6, spin: 0.5 + R(), jit: R() * 50 });
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  const quakeK = (t) => sstep(RF.quake, RF.quake + 0.4, t) * (1 - sstep(RF.fall + 1.5, RF.fall + 4, t));
  function blockAt(b, t) {                                                     // -> [u, y, s, visible 0..1, tumble]
    const d = dAt(t), qk = quakeK(t);
    let u = b.u + qk * 0.8 * vnoise(t * 9 + b.jit, 21), s = b.s - b.sz * 0.45 * (1 - sstep(RF.fall, RF.fall + 0.8, t)), y = b.h;   // sunk into the face until it goes
    s += d * DS; y += d * DY;
    const tb = Math.max(0, t - tBreak);                                        // breaking up: blocks peel off the face
    s += tb * tb * b.sep * 1.3; u += tb * b.lat; y -= tb * tb * 6;
    return [u, y, s, 1 - sstep(-20, -45, y), d / (b.sz * 4) + tb * b.spin];
  }
  function updateBlocks(t) {
    for (let i = 0; i < NB; i++) {
      const b = BK[i], [u, y, s, vis, tum] = blockAt(b, t);
      _p.set(u, y, s); _e.set(b.rx + tum, b.ry + tum * 0.6, tum * 0.3); _q.setFromEuler(_e);
      const k = b.sz * vis; _s.set(k * 1.25, k * 0.8, k); _m.compose(_p, _q, _s); blocks.setMatrixAt(i, _m);
    }
    blocks.instanceMatrix.needsUpdate = true;
  }
  // ── trees on the crest and the sides of the cliff (they shiver in the quake; none on the slab)
  const NT = 900, trees = new THREE.InstancedMesh(coniferGeo(), stdMat(ctx, { color: 0xffffff, roughness: 0.85, vertexColors: true }), NT);
  trees.castShadow = true; trees.receiveShadow = true; trees.userData.noQA = true; trees.frustumCulled = false; root.add(trees);
  const TR = [];
  for (let i = 0; i < NT * 3 && TR.length < NT; i++) {
    const u = U0 + 200 + R() * (U1 - U0 - 260), s = S0 + 40 + R() * (sF - 60 - S0 - 40), h = cliffH(s, u);
    const sl = (cliffH(s + 8, u) - cliffH(s - 8, u)) / 16;                    // the face's slope here
    if (h > 690 || h < 20 || inSlab(u, h) || Math.abs(sl) > 1.4 + 0.6 * R()) continue;
    TR.push({ u, s, h, sz: 18 + R() * 10, yaw: R() * TAU, ph: R() * 10 });
  }
  function updateCliffTrees(t) {
    const qk = quakeK(t);
    for (let i = 0; i < TR.length; i++) {
      const tr = TR[i], w = qk * 0.05 * vnoise(t * 7 + tr.ph, 23);
      _p.set(tr.u, tr.h - 0.5, tr.s); _e.set(w, tr.yaw, w * 0.7); _q.setFromEuler(_e); _s.set(tr.sz, tr.sz, tr.sz); _m.compose(_p, _q, _s); trees.setMatrixAt(i, _m);
    }
    trees.count = TR.length; trees.instanceMatrix.needsUpdate = true;
  }
  // ── dust: puffs off the face in the quake, a burst from the crack, the curtain the falling mass leaves, the impact
  const ND = 560, dust = new Puffs(ctx, ND, { back: 0.7, dark: 0.55, name: 'rockfall_dust', wisp: 0.2, softK: 0.25 }); root.add(dust.mesh);
  const DP = []; for (let i = 0; i < ND; i++) DP.push({ a: R(), b: R(), c: R(), d: R(), e: R(), at: Math.floor(R() * 4) });
  const sunL = new THREE.Vector3();
  function updateDust(t, camera) {
    const sn = U.uSunDir.value, cr = Math.cos(root.rotation.y), sr = Math.sin(root.rotation.y);
    sunL.set(sn.x * cr - sn.z * sr, sn.y, sn.x * sr + sn.z * cr);            // the sun in the local frame
    const occAt = (du, dy, ds) => { const L = Math.hypot(du, dy, ds) || 1; return clamp(0.25 + 0.62 * sstep(-0.4, 0.6, (du * sunL.x + dy * sunL.y + ds * sunL.z) / L)); };
    for (let i = 0; i < ND; i++) {
      const p = DP[i];
      let tb, x = 0, y = 0, z = 0, sz = 0, al = 0, wisp = 0.2, occ = 0.6, shade = 1;
      if (i < 90) {                                                            // quake: puffs popping off the face
        tb = RF.quake + (RF.fall + 0.5 - RF.quake) * p.a; const age = t - tb;
        if (age > 0) { const h = 150 + 650 * p.b, u = uEnd + 300 + p.c * (U1 - uEnd - 400); x = u; y = cliffH(faceS(h), u) * 0 + h + age * 4; z = faceS(h) + 20 + age * 9;
          sz = (12 + 20 * p.d) * (0.6 + 0.5 * Math.min(age, 2.5)); al = 0.34 * sstep(0, 0.25, age) * (1 - sstep(1.2, 3, age)); wisp = 0.45 + 0.25 * age; }
      } else if (i < 170) {                                                   // the crack along the slab's top edge
        tb = RF.fall + 1.4 * p.a; const age = t - tb;
        if (age > 0) { const u = (p.b - 0.5) * SW, h = hHi - 10 + 30 * p.c; x = u; y = h + age * 10; z = faceS(h) + 15 + age * 16;
          sz = (26 + 40 * p.d) * (0.6 + 0.6 * Math.min(age, 3) / 3); al = 0.7 * sstep(0, 0.15, age) * (1 - sstep(3, 7, age)); wisp = 0.25 + 0.12 * age; }
      } else if (i < 470) {                                                   // the curtain behind the falling mass
        tb = RF.fall + 0.6 + (RF.hit + 0.6 - RF.fall - 0.6) * Math.pow(p.a, 0.8); const age = t - tb;
        if (age > 0) {
          const d0 = dAt(tb), h = hLo + (hHi - hLo) * p.b - d0 * -DY + 30 * Math.max(0, tb - tBreak) ** 2 * 0;
          const u = (p.c - 0.5) * SW * (1 + 0.25 * Math.min(age, 4) / 4);
          const tbr = Math.max(0, tb - tBreak);
          x = u; y = Math.max(8, h - tbr * tbr * 6) - age * 6 + Math.max(0, age - 2) * 5;
          z = faceS(Math.max(h, 0)) + 25 + tbr * tbr * 25 + age * (12 + 16 * p.e);
          sz = (55 + 70 * p.d) * (0.55 + 0.75 * Math.min(age, 4) / 4); al = 0.85 * sstep(0, 0.2, age) * (1 - sstep(4, 8, age)); wisp = clamp(0.1 + 0.14 * age);
        }
      } else {                                                                 // the impact: rock dust boiling up with the splash
        tb = RF.hit + 1.1 * p.a; const age = t - tb;
        if (age > 0) { const u = (p.b - 0.5) * SW * 1.1; x = u; y = 20 + age * (30 + 30 * p.c); z = sF + 40 + age * (40 + 60 * p.d);
          sz = (80 + 90 * p.e) * (0.6 + 0.7 * Math.min(age, 3) / 3); al = 0.8 * sstep(0, 0.2, age) * (1 - sstep(3, 6, age)); wisp = 0.15 + 0.15 * age; shade = 0.8; }
      }
      if (al < 0.003) { dust.hide(i); continue; }
      occ = occAt(x, y - 450, z - (sF - 150));
      const g = 0.6 * shade;
      dust.set(i, x, y + sz * 0.25, z, sz * 2, al, p.e * 6.28 + (t - tb) * 0.3 * (p.a - 0.5), g * 1.03, g * 0.97, g * 0.9, p.at, clamp(wisp), occ);
    }
    dust.commit(camera);
  }
  // ── the splash: the water erupts where the mass goes in and is thrown across the inlet as a white sheet
  const NS2 = 700, splash = new Puffs(ctx, NS2, { back: 1.1, dark: 0.3, name: 'rockfall_splash', wisp: 0.35, softK: 0.25 }); root.add(splash.mesh);
  const SP = []; for (let i = 0; i < NS2; i++) SP.push({ a: R(), b: R(), c: R(), d: R(), e: R(), f: R(), at: Math.floor(R() * 4) });
  const GS2 = 105;                                                             // time-compressed gravity of the spray
  function updateSplash(t, camera) {
    for (let i = 0; i < NS2; i++) {
      const p = SP[i];
      const col = i < 260;                                                      // a column straight up + the sheet thrown across
      const tl = RF.hit + (col ? 0.05 + 0.8 * p.a : 0.1 + 1.1 * Math.pow(p.a, 1.4)), a = t - tl;
      if (a <= 0) { splash.hide(i); continue; }
      const vy = col ? 260 + 170 * p.b : 90 + 180 * p.b, vs = col ? 30 + 70 * p.c : 150 + 300 * p.c, vu = (p.d - 0.5) * (col ? 90 : 180);
      const u = (p.e - 0.5) * SW * 0.9 + vu * a, s = RF.sImp + (p.f - 0.5) * 140 + vs * a * (1 - 0.1 * Math.min(a, 4));
      let y = vy * a - 0.5 * GS2 * a * a;
      const sz = (50 + 130 * p.d) * (0.55 + 0.9 * Math.min(a, 2.5) / 2.5);
      const fallen = y < 0 && a > vy / GS2;                                     // back down: a churning mist on the water
      y = Math.max(y, 6 + sz * 0.25);
      const al = 0.9 * sstep(0, 0.1, a) * (1 - sstep(fallen ? 0.3 : 3.0, fallen ? 1.8 : 5.0, fallen ? a - vy / GS2 * 1.8 : a)) * (s > 60 ? 1 - sstep(60, 200, s) * 0.7 : 1);
      if (al < 0.003) { splash.hide(i); continue; }
      const mud = p.f < 0.3 ? 0.65 : 0;                                         // rock dust in the first spray
      const occ = clamp(0.6 + 0.35 * clamp(y / 300) + (p.a - 0.5) * 0.2);
      splash.set(i, u, y, s, sz * 2, al, p.a * 6.28 + a * 0.4 * (p.b - 0.5), lerp(0.95, 0.72, mud), lerp(0.97, 0.69, mud), lerp(1.0, 0.63, mud), p.at, clamp(0.3 + 0.18 * a), occ);
    }
    splash.commit(camera);
  }
  // ── the surge: white water boiling off the crest of the wave the splash launched, all the way to the wall's foot
  const NC = 380, crest = new Puffs(ctx, NC, { back: 1.2, dark: 0.3, name: 'rockfall_surge', wisp: 0.4, softK: 0.3 }); root.add(crest.mesh);
  const CP = []; for (let i = 0; i < NC; i++) CP.push({ a: R(), b: R(), c: R(), d: R(), at: Math.floor(R() * 4) });
  function updateCrest(t, camera) {
    for (let i = 0; i < NC; i++) {
      // short-lived white water torn off the crest where it is now (it trails a little behind the running crest)
      const p = CP[i], life = 0.5 + 0.7 * p.d, age = ((t - RF.t0) + p.a * life) % life, tb = t - age;
      if (t < RF.t0 || tb < RF.t0 || tb > tA + 0.3) { crest.hide(i); continue; }
      const sC = RF.humpS(Math.min(tb, tA - 0.01)) + 25, u = (p.b - 0.5) * WD * 1.2;
      const sz = (50 + 90 * p.c) * (0.6 + 0.8 * age / life);
      const y = HW * (0.6 + 0.45 * p.d) * RF.humpK(tb) + age * (40 + 50 * p.d) + sz * 0.1;
      const al = 0.5 * sstep(0, 0.08, age) * (1 - sstep(life * 0.55, life, age)) * (1 - sstep(WD * 0.5, WD * 0.6, Math.abs(u)));   // Q8: 0.88 hid the wave face
      if (al < 0.003) { crest.hide(i); continue; }
      crest.set(i, u, y, sC - age * 40 * p.c, sz * 1.6, al, p.a * 6.28 + age * 0.5 * (p.b - 0.5), 0.95, 0.97, 1.0, p.at, clamp(0.6 + 0.3 * age), clamp(0.6 + 0.3 * p.d));
    }
    crest.commit(camera);
  }
  RF.update = (t, camera) => {
    paintCliff(t); updateBlocks(t); updateCliffTrees(t);
    if (camera) { updateDust(t, camera); updateSplash(t, camera); updateCrest(t, camera); }
  };
}

// ── Q8: the Lituya fjord set around the run-up wall (default on; `set: false` = the old lone wall). A T-shaped fjord in
// the fx's own frame (u across, s toward the wall): the main bay (the T's stem) runs from the head toward the mouth
// between two steep forested walls (|u| < bay_width / 2); at the head the Gilbert and Crillon inlets branch left and
// right (s in -600..0, |u| < inlets) and end in glacier ice cliffs; mountains with snow above all of it; Cenotaph
// Island in the stem. The water is the world ocean (biome ocean); this is only the land.
function buildFjord(ctx, root, o) {
  const { wall, WD, level, P } = o;
  const BW = num(P.bay_width, 2700) / 2, IW = num(P.inlets, 2400), S_IN = -600, TAN = Math.tan(46 * DEG);   // 58 deg read as sheer pale curtains
  const box = (s, u, s0, s1, uh) => { const ds = Math.max(s0 - s, s - s1, 0), du = Math.max(Math.abs(u) - uh, 0); const out = Math.hypot(ds, du); const inside = Math.min(s1 - s, s - s0, uh - Math.abs(u)); return out > 0 ? out : -Math.max(0, inside); };
  const dT = (s, u) => Math.min(box(s, u, -9000, S_IN, BW), box(s, u, S_IN, 0, IW));         // signed distance to the water
  // Cenotaph Island: ~1.3 km long, a forested whaleback ~150 m high
  const isl = (s, u) => { if (P.island === false) return -1; const a = (s + 2600) / 680, b = (u - 150) / 190; const r = a * a + b * b; return r < 1 ? 110 * Math.pow(1 - r, 0.55) * (0.8 + 0.2 * fbm1(s / 90 + 3, 61)) : -1; };
  const NZf = makeNoise(4711);
  const hF = (s, u) => {
    const d = dT(s, u), au = Math.abs(u);
    // 2D fields (no 1D stripes): a ridged summit field (jagged ridgelines, peaks ~0.9-1.6 km), gullies, benches
    const rg = NZf.ridge2(u / 1100 + 3.1, s / 1100 - 1.3, 5), fb = NZf.fbm2(u / 380 + 7.7, s / 380 + 2.2, 4);
    const top = lerp(620, 600 + 950 * rg * rg + 160 * fb, sstep(250, 1500, d));   // lower shoulders by the water, the high peaks set back
    const gul = Math.max(0, NZf.fbm2(u / 140 + 1.3, s / 140 - 4.1, 3)) * 80 * sstep(40, 260, d);
    const hang = 110 * sstep(0.3, 0.6, NZf.fbm2(u / 600 - 5, s / 600 + 3, 2)) * sstep(250, 650, d) * (1 - sstep(650, 1050, d));   // benches, hanging valleys
    const rise = d * TAN * (0.8 + 0.35 * (0.5 + 0.5 * fb)) * (s > -40 && au > WD * 0.7 ? 0.8 : 1) - gul + 20 * NZf.fbm2(u / 45, s / 45, 2) - hang;
    let h = d <= 0 ? -30 + d * 0.05 : top * (1 - Math.exp(-Math.max(0, rise) / top)) + Math.min(0, rise);
    // glaciers fill the inlet valleys beyond the ice cliffs
    { const vm = sstep(S_IN - 420, S_IN - 60, s) * (1 - sstep(80, 440, s)) * sstep(IW - 60, IW + 260, au);   // glacier valleys with sloping sides (no ice gates, no sheer curtains)
      if (vm > 0) h = lerp(h, Math.min(h, 52 + (au - IW) * 0.11 + 10 * fbm1(s / 60 + au / 80, 68) + 4 * (s - S_IN) / 600), vm); }
    // under the run-up wall (it has its own mesh): stay below it, blending into the mountains beside it
    // beside it the land covers the wall mesh's side edge (its height at |u| = 0.7 WD), then tapers smoothly back to the
    // mountains (a hard cut here made a back-facing step that read as a translucent curtain in m02)
    if (s > -60) { const k = Math.max(sstep(WD * 0.62, WD * 0.86, au), sstep(1000, 1250, s)); const eH = wall(Math.max(s, 0), Math.sign(u) * Math.min(au, WD * 0.7)) + 15, tp = s > 0 ? 1 - sstep(WD * 0.72, WD * 1.05, au) : 0; h = lerp(Math.min(h, wall(Math.max(s, 0), u) - 22), Math.max(h, lerp(h, eH, tp)), k); }
    const ih = isl(s, u); if (ih > -1) h = Math.max(h, ih - 3);
    return h;
  };
  // grid: denser across the bay edges, the far mountains coarser
  const NU = 280, NS = 230, U = 4400, SA = -5200, SB = 2600;
  const uMap = (x) => Math.sign(x) * U * Math.pow(Math.abs(x), 1.35), sMap = (y) => SB - (SB - SA) * Math.pow(1 - y, 1.25);
  const g = new THREE.PlaneGeometry(1, 1, NU - 1, NS - 1), gp = g.attributes.position, col = new Float32Array(gp.count * 3);
  for (let i = 0; i < gp.count; i++) { const u = uMap(gp.getX(i) * 2), s = sMap(gp.getY(i) + 0.5); gp.setXYZ(i, u, hF(s, u), s); }
  g.computeVertexNormals();
  { // the plane's (x, y) -> (u, s) mapping mirrors the winding: flip it so the faces (and normals) point up
    let sy = 0; const nn = g.attributes.normal; for (let i = 0; i < nn.count; i += 97) sy += nn.getY(i);
    if (sy < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const tmp = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = tmp; } g.index.needsUpdate = true; g.computeVertexNormals(); }
  }
  const nr = g.attributes.normal;
  for (let i = 0; i < gp.count; i++) {
    const u = gp.getX(i), h = gp.getY(i), s = gp.getZ(i), up = nr.getY(i), n = 0.5 + 0.55 * NZf.fbm2(u / 75 + 1.7, s / 75 - 3.1, 3), n2 = 0.5 + 0.55 * NZf.fbm2(u / 21 - 4.2, s / 21 + 0.9, 2);   // 2D (1D noise drew streaks)
    const au = Math.abs(u), glacier = s > S_IN - 80 && s < 80 && au > IW - 10 && h < 52 + (au - IW) * 0.11 + 14 ? 1 : 0;
    const steep = 1 - up, rock = sstep(0.36, 0.58, steep + 0.18 * (n - 0.5)) , tree = (1 - sstep(520, 680, h + 90 * (n - 0.5))) * (1 - rock);   // spruce to ~600 m, like the wall
    let c = [lerp(0.25, 0.31, n2), lerp(0.24, 0.29, n2), lerp(0.22, 0.26, n2)];                 // rock
    c = c.map((v, q) => lerp(v, [lerp(0.1, 0.14, n2), lerp(0.14, 0.18, n2), lerp(0.09, 0.11, n2)][q], tree));   // spruce forest
    if (isl(s, u) > 9) c = [lerp(0.09, 0.13, n2), lerp(0.13, 0.17, n2), lerp(0.08, 0.1, n2)];   // the island is forested
    if (h < 7 && h > -3) c = [0.36, 0.34, 0.3];                                                 // gravel shore
    const snow = sstep(760, 900, h + 160 * (n - 0.5)) * (1 - 0.7 * sstep(0.45, 0.7, steep));
    c = c.map((v, q) => lerp(v, [0.88, 0.9, 0.93][q], snow));
    if (glacier) { const cr = 0.85 + 0.15 * Math.sin(u * 0.08 + n * 6); c = [0.7 * cr, 0.8 * cr, 0.88 * cr]; }
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, stdMat(ctx, { color: 0xffffff, roughness: 0.93, vertexColors: true, side: THREE.DoubleSide }));   // steep faces never cull into see-through slivers
  m.name = 'fjord_set'; m.receiveShadow = true; m.castShadow = true; m.userData.noQA = true; m.frustumCulled = false; root.add(m);
  // spruce along the shores (lower slopes, soft upper edge), and on the island
  const NT = Math.round(num(P.set_trees, 2600)), R = rng(8181), TR = [];
  for (let k = 0; k < NT * 5 && TR.length < NT; k++) {
    const onIsl = P.island !== false && R() < 0.3;
    const u = onIsl ? 150 + (R() - 0.5) * 300 : (R() < 0.5 ? -1 : 1) * (BW + 15 + Math.pow(R(), 1.6) * 520), s = onIsl ? -2600 + (R() - 0.5) * 1200 : -600 - R() * 3800;
    const h = hF(s, u), nn = vnoise(u * 0.011 + s * 0.013, 9);
    if (h < 6 || h > 300 + 120 * nn || dT(s, u) < 8 && !onIsl) continue;
    TR.push([u, h, s, 16 + R() * 12, R() * TAU]);
  }
  const tm = new THREE.InstancedMesh(coniferGeo(), stdMat(ctx, { color: 0xffffff, roughness: 0.85, vertexColors: true }), Math.max(1, TR.length));
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  TR.forEach((t, i) => { _p.set(t[0], t[1] - 0.8, t[2]); _q.setFromAxisAngle(Y, t[4]); _s.setScalar(t[3]); _m.compose(_p, _q, _s); tm.setMatrixAt(i, _m); });
  tm.castShadow = true; tm.receiveShadow = true; tm.userData.noQA = true; tm.frustumCulled = false; root.add(tm);
  return { hF, dT };
}
