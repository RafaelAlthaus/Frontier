// w_hurricane.js — fx.hurricane (Cat 5).
//   mode 'wind'         wind-driven horizontal rain (streaks wrapped round the lens), streaming spray sheets, palms
//                       bending and whipping in the gusts, flying debris (boards, roof sheets) — all along `heading`
//                       (the direction the wind blows TO), gusting deterministically.
//   mode 'storm_surge'  a coastal town (place a town kind on the land) and the sea rising and flowing inland: the
//                       water climbs from the sea level to `surge` m (up to the roofs) between `rise` [t0, t1], with
//                       wind waves marching inland on top, foam streaks, spray and the same horizontal rain.
// Q7 pass: the surge advances inland as a front (a foaming bore with small breaking waves, a current of foam streaks
// flowing inland, the level building behind it; `front_speed`), bigger waves ride on the deep surge; `damage` tears
// shingles, roof sections, siding, a porch roof and windows off the houses near the camera on cues (wind mode);
// `waves` break over houses in the surge (spray bursts, debris; `collapse` / `shift`). Rain streaks read at 1080p.
// Everything is a pure function of t.
import * as THREE from 'three';
import { prm, num, Puffs, Streaks, stdMat, plankGeo, sheetGeo, carGeo, rng, clamp, lerp, sstep, fbm1, vnoise, TAU, DEG } from './w_common.js';
import { waterMat } from './w_tsunami.js';

export const CATALOG = {
  'fx.hurricane': {
    desc: 'Cat-5 hurricane. mode "wind": horizontal rain, spray sheets, palms bending, flying debris blowing along `heading` (wind to); palms: count around `at`. mode "storm_surge": the sea rises to `surge` m over `rise` [t0,t1] s and floods inland over a coastal town (put a town kind on land, sea on the `heading` opposite side), wind waves on top, foam, spray, rain. Pair with look sky "storm", grade "cold".',
    actions: ['wind', 'storm_surge'],
    params: { mode: 'wind', wind: 60, rain: 1.0, palms: 14, debris: 160, surge: 6, size: 1400, waves: 1.0, front_speed: 30, damage: [] },
    doc: {
      damage: 'wind mode: [{t, target: "nearest"|"second"|"third"|[x, z], kind: "shingles"|"roof"|"siding"|"porch"|"windows"}] (houses found from a town structure)',
      waves: 'storm_surge: number = wave height scale (1), or a list [{t, target: "nearest"|"second"|[x, z], collapse?: true, shift?: true}] = a wave breaking over that house at t',
      front_speed: 'storm_surge: m/s the surge front runs inland from `at` along heading (0 = the old uniform rise)',
      flotsam: 'storm_surge: 0..2 floating debris (planks, siding, roof sheets, 4 cars) carried inland and stranding along the flood edge (default 1)',
    },
    footprint: [4, 4], height: 4, tags: ['disaster', 'storm', 'hurricane', 'wind', 'rain', 'flood', 'fx'], section: 'objects', contact: false,
  },
};

// ── palm: a curved trunk of stacked segments + a crown of fronds; bend(t) is applied per segment ───────────────────
function palm(ctx, R, h) {
  const g = new THREE.Group();
  const trunkMat = stdMat(ctx, { color: 0x7a6650, roughness: 0.95 }), frondMat = stdMat(ctx, { color: 0x3f6a2c, roughness: 0.8, side: THREE.DoubleSide });
  const N = 8, segs = []; let parent = g;
  for (let i = 0; i < N; i++) {
    const sg = new THREE.Group(); sg.position.y = i === 0 ? 0 : h / N;
    const r0 = lerp(0.24, 0.15, i / N), r1 = lerp(0.24, 0.15, (i + 1) / N);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h / N * 1.02, 8).translate(0, h / N / 2, 0), trunkMat); m.castShadow = true; m.userData.noQA = true;
    sg.add(m); parent.add(sg); segs.push(sg); parent = sg;
  }
  const crown = new THREE.Group(); crown.position.y = h / N; parent.add(crown);
  const fronds = [];
  const fg = (() => { const geo = new THREE.PlaneGeometry(0.9, 4.2, 1, 8).translate(0, 2.1, 0); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 4.2; p.setX(i, p.getX(i) * Math.sin(Math.PI * Math.min(1, y * 1.1 + 0.05))); p.setZ(i, -0.9 * y * y); } geo.computeVertexNormals(); return geo; })();
  for (let k = 0; k < 11; k++) {
    const f = new THREE.Group(); f.rotation.y = (k / 11) * TAU + R() * 0.3; crown.add(f);
    const m = new THREE.Mesh(fg, frondMat); m.rotation.x = -0.9 - R() * 0.5; m.castShadow = true; m.userData.noQA = true; f.add(m); fronds.push({ f, m, base: m.rotation.x, ph: R() * TAU });
  }
  return { g, segs, fronds, crown };
}

export async function build(kind, item, ctx) {
  const P = prm(item);
  const mode = P.mode || item.action || 'wind';
  const at = item.at || [0, 0], G = ctx.ground.height, gy0 = G(at[0], at[1]);
  const hd = (item.heading ?? 90) * DEG, dir = [Math.sin(hd), -Math.cos(hd)], perp = [-dir[1], dir[0]];
  const WS = num(P.wind, 60), dur = ctx.dur ?? 12;
  const root = new THREE.Group(); root.name = 'fx.hurricane'; root.position.set(at[0], gy0, at[1]);
  const gust = (t) => 0.72 + 0.18 * fbm1(t * 0.45, 3) + 0.1 * Math.sin(t * 1.7) * Math.sin(t * 0.37);   // 0.5..1
  const level = ctx.water?.level ?? 0;
  const R = rng((item.seed ?? 3) * 17 + 5);

  // ── horizontal rain: streaks in a box that follows the lens
  const NR = Math.round(9000 * clamp(num(P.rain, 1), 0, 2)), BOX = 46;
  const rain = new Streaks(ctx, NR, { color: [0.78, 0.8, 0.84] }); root.add(rain.mesh);
  const RS = new Float32Array(NR * 4); { const r = rng(123); for (let i = 0; i < NR * 4; i++) RS[i] = r(); }
  // spray sheets: large faint puffs streaming with the wind
  const NSP = 600, spray = new Puffs(ctx, NSP, { back: 0.9, dark: 0.1, name: 'hurricane_spray' }); root.add(spray.mesh);
  const SPS = []; { const r = rng(321); for (let i = 0; i < NSP; i++) SPS.push([r(), r(), r(), r(), Math.floor(r() * 4)]); }
  // flying debris
  const NB = Math.round(num(P.debris, 160));
  const woodMat = stdMat(ctx, { color: 0x6b5238, roughness: 0.9 }), tinMat = stdMat(ctx, { color: 0x8a8d8f, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
  const planks = new THREE.InstancedMesh(plankGeo(), woodMat, NB), sheets = new THREE.InstancedMesh(sheetGeo(), tinMat, NB);
  for (const m of [planks, sheets]) { m.frustumCulled = false; m.userData.noQA = true; m.castShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
  const DB = []; { const r = rng(555); for (let i = 0; i < NB; i++) DB.push({ s: [r(), r(), r()], sp: 0.5 + r() * 0.5, sheet: r() < 0.35, spin: [r() - 0.5, r() - 0.5, r() - 0.5], sc: 0.5 + r() * 0.8 }); }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const wrap = (v, c, B) => { const r = ((v - c + B / 2) % B + B) % B - B / 2; return c + r; };
  // integrated wind distance (so gusts never make particles jump): X(t) = WS * integral of gust
  const DT = 1 / 60, NX = Math.ceil((dur + 3) * 60) + 2, XI = new Float32Array(NX);
  for (let i = 1; i < NX; i++) XI[i] = XI[i - 1] + gust((i - 1) * DT) * DT;
  const Xof = (t) => { const f = clamp((t + 1) / DT, 0, NX - 1.001), i = Math.floor(f); return lerp(XI[i], XI[i + 1], f - i) * WS; };

  function updateWeather(t, camera) {
    const cp = camera.position, cx = cp.x - root.position.x, cy = cp.y - root.position.y, cz = cp.z - root.position.z;
    const X = Xof(t), g = gust(t), vx = dir[0] * WS * g, vz = dir[1] * WS * g, vy = -9;
    const k = 0.018;                                                         // streak = distance in ~1/55 s
    for (let i = 0; i < NR; i++) {
      const a = RS[i * 4], b = RS[i * 4 + 1], c = RS[i * 4 + 2], d = RS[i * 4 + 3];
      const sp = 0.8 + 0.4 * d;
      let x = a * BOX * 7 + dir[0] * X * sp, y = b * BOX - 9 * t * sp, z = c * BOX * 7 + dir[1] * X * sp;
      x = wrap(x, cx, BOX); y = wrap(y, cy, BOX * 0.6); z = wrap(z, cz, BOX);
      const dd = Math.hypot(x - cx, y - cy, z - cz);
      const fade = sstep(0.5, 2.5, dd) * (1 - sstep(BOX * 0.36, BOX * 0.5, dd));
      rain.set(i, x - vx * sp * k * 1.5, y - vy * sp * k * 1.5, z - vz * sp * k * 1.5, x, y, z, 0.016 + 0.011 * d, 0.46 * fade * (0.5 + 0.5 * c));
    }
    rain.commit();
    const SB = 260;
    for (let i = 0; i < NSP; i++) {
      const s = SPS[i];
      let x = s[0] * SB * 5 + dir[0] * X * 0.8, z = s[2] * SB * 5 + dir[1] * X * 0.8;
      x = wrap(x, cx, SB); z = wrap(z, cz, SB);
      const gy = (mode === 'storm_surge' ? Math.max(G(x + root.position.x, z + root.position.z), surfLevel(t)) : G(x + root.position.x, z + root.position.z)) - root.position.y;
      const y = gy + 2 + s[1] * 18;
      const dd = Math.hypot(x - cx, z - cz);
      const sz = 10 + s[3] * 22;
      spray.set(i, x, y + sz * 0.3, z, sz, (mode === 'storm_surge' ? 0.08 : 0.16) * g * sstep(8, 30, dd) * (1 - sstep(SB * 0.35, SB * 0.5, dd)), s[3] * 6, 0.86, 0.88, 0.9, s[4]);
    }
    spray.commit(camera);
    const DBX = 140; let np = 0, ns = 0;
    for (let i = 0; i < NB; i++) {
      const b = DB[i];
      let x = b.s[0] * DBX * 5 + dir[0] * X * b.sp * 0.7, z = b.s[2] * DBX * 5 + dir[1] * X * b.sp * 0.7;
      x = wrap(x, cx, DBX); z = wrap(z, cz, DBX);
      const base = (mode === 'storm_surge' ? Math.max(G(x + root.position.x, z + root.position.z), surfLevel(t)) : G(x + root.position.x, z + root.position.z)) - root.position.y;
      const y = base + 1.5 + b.s[1] * 14 + 1.5 * Math.sin(t * 2 + b.s[0] * 30);
      const dd = Math.hypot(x - cx, y - cy, z - cz);
      _p.set(x, y, z); _e.set(b.spin[0] * t * 9, b.spin[1] * t * 7, b.spin[2] * t * 11); _q.setFromEuler(_e);
      _s.setScalar(b.sc * sstep(2, 6, dd) * (1 - sstep(DBX * 0.38, DBX * 0.5, dd))); _m.compose(_p, _q, _s);
      if (b.sheet) sheets.setMatrixAt(ns++, _m); else planks.setMatrixAt(np++, _m);
    }
    planks.count = np; sheets.count = ns; planks.instanceMatrix.needsUpdate = sheets.instanceMatrix.needsUpdate = true;
  }

  // ── palms (wind mode, and on the land in the surge mode)
  const palms = [];
  const NPm = Math.round(num(P.palms, mode === 'wind' ? 14 : 0));
  // Q2: the nature library's coconut palm (leaflet fronds, ringed trunk) bent and streamed by the wind in its material;
  // the old palm's random draws are still made so everything after it keeps its values
  const FL = NPm ? await import('../nature/flora.js').catch(() => null) : null;
  for (let i = 0; i < NPm; i++) {
    const a = R() * TAU, d = 6 + Math.sqrt(R()) * 60, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 7 + R() * 5, pm = FL?.palmMesh ? (() => { for (let k = 0; k < 33; k++) R(); const g = new THREE.Group(); g.add(FL.palmMesh(ctx, i * 5 + 3)); g.rotation.y = a * 3.7; g.scale.setScalar(h / 10.5); return { g, segs: [], fronds: [], crown: new THREE.Group() }; })() : palm(ctx, R, h);
    pm.g.position.set(x, G(at[0] + x, at[1] + z) - gy0, z); root.add(pm.g);
    palms.push({ ...pm, ph: R() * 10, stiff: 0.8 + R() * 0.4 });
  }
  const _ax = new THREE.Vector3(perp[0], 0, perp[1]);
  function updatePalms(t) {
    for (const p of palms) {
      const g = gust(t + p.ph * 0.13);
      const bend = (0.05 + 0.1 * g) / p.stiff + 0.025 * Math.sin(t * 2.3 + p.ph);
      for (let i = 0; i < p.segs.length; i++) p.segs[i].quaternion.setFromAxisAngle(_ax, -bend * (0.4 + i / p.segs.length));
      for (const f of p.fronds) {
        // fronds stream downwind: blend each frond's pitch toward horizontal-downwind, flutter at ~3 Hz
        const fl = 0.18 * Math.sin(t * 17 + f.ph) * g + 0.1 * Math.sin(t * 6.1 + f.ph * 2);
        f.m.rotation.x = lerp(f.base, -1.45, 0.45 * g) + fl;
      }
      p.crown.rotation.y = 0.15 * Math.sin(t * 1.3 + p.ph);
    }
  }

  // ── houses near the camera (for damage / wave events): chimney clusters of the town structures
  let HOUSES = null;
  function houses() {
    if (HOUSES) return HOUSES;
    if (!window.__f3d?.cur?.S) return [];                                     // the scene is still being built
    HOUSES = [];
    const items = window.__f3d?.cur?.S?.items || [];
    const ch = [];
    for (const it of items) for (const c of it.res?.anchors?.chimneys || []) ch.push([c.x, c.y, c.z]);
    const used = new Array(ch.length).fill(false);
    for (let i = 0; i < ch.length; i++) {
      if (used[i]) continue;
      let sx = 0, sz = 0, top = -1e9, n = 0;
      for (let j = i; j < ch.length; j++) if (!used[j] && Math.hypot(ch[j][0] - ch[i][0], ch[j][2] - ch[i][2]) < 10) { used[j] = true; sx += ch[j][0]; sz += ch[j][2]; top = Math.max(top, ch[j][1]); n++; }
      HOUSES.push({ x: sx / n, z: sz / n, roof: top - 1.1, g: G(sx / n, sz / n) });
    }
    return HOUSES;
  }
  function pickHouse(target, te) {
    if (Array.isArray(target)) { const x = +target[0], z = +target[target.length === 3 ? 2 : 1]; return { x, z, g: G(x, z), roof: G(x, z) + 7 }; }
    if (!window.__f3d?.cur?.plan) return undefined;                          // not yet: decided at the first frame
    const H = houses(); if (!H.length) return null;
    let cam = null; try { cam = window.__f3d.cur.plan.camAt(Math.max(0, te)); } catch (e) { cam = null; }
    const c = cam ? [cam.pos[0], cam.pos[2]] : [at[0], at[1]];
    let ord = H.map((h) => ({ h, d: Math.hypot(h.x - c[0], h.z - c[1]) }));
    if (cam && cam.look) {
      // in the frame (within ~75 % of the half-width of view), in front, 18-160 m away: the house the shot is about
      const fx = cam.look[0] - cam.pos[0], fz = cam.look[2] - cam.pos[2], fl = Math.hypot(fx, fz) || 1, half = ((cam.fov ?? 40) * DEG / 2) * 1.6;
      const inView = ord.filter((o) => { const dx = o.h.x - c[0], dz = o.h.z - c[1], a = Math.acos(clamp((dx * fx + dz * fz) / (fl * (Math.hypot(dx, dz) || 1)), -1, 1)); return a < half * 0.75 && o.d > 18 && o.d < 160; });
      if (inView.length) ord = inView;
    }
    ord.sort((a, b) => a.d - b.d);
    const k = { nearest: 0, first: 0, second: 1, third: 2, fourth: 3 }[target] ?? 0;
    return ord[Math.min(k, ord.length - 1)].h;
  }
  const PIECE = { shingles: [0.9, 0.025, 0.34], roof: [6.2, 0.18, 4.2], siding: [2.6, 0.16, 0.035], porch: [3.4, 0.12, 2.0], windows: [0.5, 0.01, 0.4], planks: [2.8, 0.06, 0.2] };
  const debrisMats = { shingles: stdMat(ctx, { color: 0x2f2d2b, roughness: 0.95 }), roof: stdMat(ctx, { color: 0x3a3632, roughness: 0.9 }), siding: stdMat(ctx, { color: 0xd9d4c8, roughness: 0.8 }), porch: stdMat(ctx, { color: 0x6b5a48, roughness: 0.85 }), windows: stdMat(ctx, { color: 0xbfd6e0, roughness: 0.05, metalness: 0.8, emissive: 0x44606a, emissiveIntensity: 0.3 }), planks: stdMat(ctx, { color: 0x7a6248, roughness: 0.9 }) };
  const boxG = new THREE.BoxGeometry(1, 1, 1);
  // damage events (wind): pieces torn off a house and flown downwind
  const DMG = (Array.isArray(P.damage) ? P.damage : []).map((d, k) => ({ t: num(d.t, 0), target: d.target ?? 'nearest', kind: String(d.kind || 'shingles'), k }));
  const dmgRoot = new THREE.Group(); dmgRoot.name = 'fx.hurricane.damage'; ctx.scene.add(dmgRoot);
  for (const d of DMG) {
    const kinds = d.kind === 'roof' ? ['roof', 'planks', 'shingles'] : [d.kind in PIECE ? d.kind : 'shingles'];
    d.parts = kinds.map((kd) => {
      const n = { shingles: 90, roof: 1, siding: 26, porch: 1, windows: 60, planks: 26 }[kd];
      const im = new THREE.InstancedMesh(boxG, debrisMats[kd], n); im.frustumCulled = false; im.castShadow = true; im.userData.noQA = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.count = 0; dmgRoot.add(im);
      const r = rng(900 + d.k * 37 + kd.length), pcs = [];
      for (let i = 0; i < n; i++) pcs.push({ a: r(), b: r(), c: r(), dt: kd === 'roof' || kd === 'porch' ? 0 : (kd === 'planks' ? 0.35 + r() * 0.5 : r() * (kd === 'shingles' ? 1.3 : 0.8)), sp: [(r() - 0.5) * 9, (r() - 0.5) * 7, (r() - 0.5) * 9], lift: 2 + r() * 7, v: 0.55 + r() * 0.45 });
      return { kd, im, pcs };
    });
  }
  function updateDamage(t) {
    if (!DMG.length) return;
    const g = gust(t);
    for (const d of DMG) {
      if (d.house === undefined) d.house = pickHouse(d.target, d.t);
      const Hh = d.house || null;
      for (const part of d.parts) {
        let n = 0;
        if (!Hh) { part.im.count = 0; continue; }
        const S = PIECE[part.kd];
        for (const pc of part.pcs) {
          const x = t - d.t - pc.dt;
          if (x < 0 || x > 4) continue;
          // where it starts: roof pieces on the roof, siding/windows on the windward wall, porch at the front
          const sideOff = (pc.a - 0.5) * 9, up = part.kd === 'siding' || part.kd === 'windows' ? Hh.g + 0.8 + pc.b * 4.5 : Hh.roof - pc.b * 2.2;
          const back = part.kd === 'siding' || part.kd === 'windows' || part.kd === 'porch' ? -5.5 : (pc.c - 0.5) * 7;
          let px = Hh.x + perp[0] * sideOff + dir[0] * back, pz = Hh.z + perp[1] * sideOff + dir[1] * back, py = part.kd === 'porch' ? Hh.g + 3.2 : up;
          const peel = part.kd === 'roof' || part.kd === 'porch' ? 0.4 : 0.14;             // hinged up first, then torn loose
          const hinge = sstep(0, peel, x) * (part.kd === 'roof' ? 1.15 : 1.4);
          const fly = Math.max(0, x - peel);
          const inward = part.kd === 'windows' ? 1 : 0;
          const vx = WS * g * pc.v * (part.kd === 'roof' ? 0.32 : 0.45) * (inward ? 0.25 : 1);
          px += dir[0] * vx * fly * (1 - 0.15 * fly); pz += dir[1] * vx * fly * (1 - 0.15 * fly);
          py += (part.kd === 'windows' ? 0 : pc.lift * fly) - (part.kd === 'windows' ? 4.9 : 2.2) * fly * fly;
          py = Math.max(py, G(px, pz) + 0.05);
          _e.set(-hinge * (dir[0] === 0 ? 1 : 0.6) + pc.sp[0] * fly, Math.atan2(dir[0], dir[1]) + pc.sp[1] * fly * 0.5, hinge * 0.3 + pc.sp[2] * fly); _q.setFromEuler(_e);
          const sc = part.kd === 'windows' ? 0.35 + pc.a * 0.6 : part.kd === 'shingles' ? 0.8 + pc.a * 0.8 : 1;
          _s.set(S[0] * sc, S[1], S[2] * sc).multiplyScalar(1 - sstep(3.3, 4, x));
          _m.compose(_p.set(px, py, pz), _q, _s); part.im.setMatrixAt(n++, _m);
        }
        part.im.count = n; part.im.instanceMatrix.needsUpdate = true;
      }
    }
  }
  // wave events (storm surge): a crest runs at the house and breaks over it (spray, debris; collapse / shift)
  const WEV = [];
  const wevRoot = new THREE.Group(); wevRoot.name = 'fx.hurricane.waves'; ctx.scene.add(wevRoot);
  const wevSpray = Array.isArray(P.waves) && P.waves.length ? new Puffs(ctx, 80 * P.waves.length, { back: 0.9, dark: 0.2, name: 'hurricane_breakers', wisp: 0.35 }) : null;
  if (wevSpray) wevRoot.add(wevSpray.mesh);
  if (Array.isArray(P.waves)) P.waves.forEach((w, k) => {
    const e = { t: num(w.t, 0), target: w.target ?? (k ? 'second' : 'nearest'), collapse: !!w.collapse, shift: !!w.shift, k, house: undefined };
    const n = e.collapse ? 60 : e.shift ? 24 : 10;
    e.im = new THREE.InstancedMesh(boxG, debrisMats.siding, n); e.im2 = new THREE.InstancedMesh(boxG, debrisMats.planks, n);
    for (const im of [e.im, e.im2]) { im.frustumCulled = false; im.castShadow = true; im.userData.noQA = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.count = 0; wevRoot.add(im); }
    const r = rng(4400 + k * 13); e.pcs = []; for (let i = 0; i < n; i++) e.pcs.push({ a: r(), b: r(), c: r(), sp: [(r() - 0.5) * 6, (r() - 0.5) * 4, (r() - 0.5) * 6], dt: r() * 0.5 });
    e.hx = () => { if (e.house === undefined) e.house = pickHouse(e.target, e.t); return e.house || null; };
    // the crest: a ridge 2-3 m high running at the house over the 1.6 s before t, then collapsing into foam
    e.bump = (x, z, t) => {
      const Hh = e.hx(); if (!Hh) return 0;
      const a = t - (e.t - 1.6); if (a < 0 || a > 2.4) return 0;
      const s = (x + at[0] - Hh.x) * dir[0] + (z + at[1] - Hh.z) * dir[1], q = (x + at[0] - Hh.x) * perp[0] + (z + at[1] - Hh.z) * perp[1];
      const sc = -30 + 26 * clamp(a / 1.6);
      const H = 2.6 * sstep(0, 0.5, a) * (1 - sstep(1.6, 2.4, a));
      return H * Math.exp(-(((s - sc) / 4.5) ** 2)) * Math.exp(-((q / 16) ** 2));
    };
    WEV.push(e);
  });
  function updateWaves(t, camera) {
    if (!WEV.length) return;
    let ns = 0;
    for (const e of WEV) {
      const Hh = e.hx();
      let n = 0, n2 = 0;
      if (Hh) {
        const lv = surfLevel(t);
        // debris: siding and planks thrown up, then floating off with the current
        for (let i = 0; i < e.pcs.length; i++) {
          const pc = e.pcs[i], x = t - e.t - pc.dt; if (x < 0) continue;
          const q = (pc.a - 0.5) * 12, s0 = -5 + pc.b * 8;
          let px = Hh.x + perp[0] * q + dir[0] * s0, pz = Hh.z + perp[1] * q + dir[1] * s0;
          const air = Math.min(x, 0.9), flo = Math.max(0, x - 0.9);
          px += dir[0] * (6 * air + 2.2 * flo) + perp[0] * Math.sin(flo * 0.7 + pc.c * 6) * 1.5; pz += dir[1] * (6 * air + 2.2 * flo) + perp[1] * Math.sin(flo * 0.7 + pc.c * 6) * 1.5;
          const py = Math.max(lv + 0.1 + 0.15 * Math.sin(t * 1.3 + i), Hh.g + 2 + pc.c * 5 + 7 * air - 9 * air * air);
          _e.set(pc.sp[0] * air + 0.3 * Math.sin(t + i), pc.sp[1] * x * 0.3 + pc.a * 6, pc.sp[2] * air + 0.2 * Math.cos(t * 0.8 + i)); _q.setFromEuler(_e);
          const S = i % 2 ? PIECE.planks : [3.2, 0.2, 2.2];
          _s.set(S[0] * (0.6 + pc.b * 0.8), S[1], S[2] * (0.6 + pc.c * 0.8));
          _m.compose(_p.set(px, py, pz), _q, _s);
          if (i % 2) e.im2.setMatrixAt(n2++, _m); else e.im.setMatrixAt(n++, _m);
        }
        // spray: the breaker exploding up the seaward wall, blown downwind
        for (let i = 0; i < 80; i++) {
          const L = 2.6, x = t - e.t - (i % 8) * 0.06;
          if (x < 0 || x > L) { wevSpray.hide(ns++); continue; }
          const q = ((i * 0.618) % 1 - 0.5) * 18, up = (10 + 12 * ((i * 0.37) % 1)) * (e.collapse ? 1.35 : 1);
          const px = Hh.x + perp[0] * q - dir[0] * 6 + dir[0] * (4 + 9 * x), pz = Hh.z + perp[1] * q - dir[1] * 6 + dir[1] * (4 + 9 * x);
          const py = lv + up * (1 - Math.exp(-x * 2.2)) - 1.5 * x * x;
          const sz = 4 + 8 * x;
          wevSpray.set(ns++, px, py + sz * 0.2, pz, sz, 0.5 * sstep(0, 0.12, x) * (1 - sstep(0.8, L, x)), i * 1.7 + x, 0.9, 0.92, 0.94, i & 3, clamp(0.72 + 0.28 * x), 0.7);
        }
      } else for (let i = 0; i < 80; i++) wevSpray.hide(ns++);
      e.im.count = n; e.im2.count = n2; e.im.instanceMatrix.needsUpdate = e.im2.instanceMatrix.needsUpdate = true;
    }
    if (wevSpray) wevSpray.commit(camera);
  }

  // ── storm surge: a rising, wind-waved sea sheet over the coastal land
  let surf = null, surfLevel = () => level;
  if (mode === 'storm_surge') {
    const SZ = num(P.size, 1400), SURGE = num(P.surge, 6), NG = 190;
    const rise = Array.isArray(P.rise) ? P.rise.map(Number) : [0, dur * 0.85];
    surfLevel = (t) => level + 0.4 + SURGE * sstep(rise[0], rise[1], t) * 0.94;
    const geo = new THREE.PlaneGeometry(SZ, SZ, NG - 1, NG - 1); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position.array, n = pos.length / 3;
    const X0 = Float32Array.from({ length: n }, (_, i) => pos[i * 3]), Z0 = Float32Array.from({ length: n }, (_, i) => pos[i * 3 + 2]);
    const GRD = new Float32Array(n); for (let i = 0; i < n; i++) GRD[i] = G(at[0] + X0[i], at[1] + Z0[i]);
    const col = new Float32Array(n * 3), fx = new Float32Array(n * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aFx', new THREE.BufferAttribute(fx, 3));
    const uT = { value: 0 }, uFlow = { value: new THREE.Vector2(dir[0] * 9, dir[1] * 9) };
    surf = new THREE.Mesh(geo, waterMat(ctx, uT, { uFlow, rough: 0.3, env: 0.6, bump: 0.9, sss: 0.6 }));
    surf.name = 'storm_surge'; surf.userData.noQA = true; surf.frustumCulled = false; surf.receiveShadow = true; root.add(surf);
    const WAV = [[38, 0.8, 0], [23, 0.45, 0.55], [61, 0.6, -0.4], [14, 0.25, 0.95], [31, 0.4, -0.9], [9, 0.12, 0.3]];    // wavelength, amp, angle offset
    const wavesK = Array.isArray(P.waves) ? 1.25 : num(P.waves, 1);
    const WV = WAV.map(([L, A, ao]) => { const a = hd + ao; return { k: TAU / L, A: A * wavesK, dx: Math.sin(a), dz: -Math.cos(a), w: Math.sqrt(9.81 * TAU / L) }; });
    const FS = num(P.front_speed, 30);
    const riseLv = (tt) => level + 0.4 + SURGE * sstep(rise[0], rise[1], tt) * 0.94;
    surfLevel = (t) => riseLv(t);
    // flotsam: planks, siding, roof sheets and a few cars carried inland by the current; each drifts until the water
    // under it gets too shallow and strands there, so they pile up along the flood edge (a debris line). The paths are
    // precomputed at build (a pure function of t per frame: a table lookup).
    const NFL = Math.round(140 * clamp(num(P.flotsam, 1), 0, 2));
    if (NFL > 0) {
      const RF = rng(8080), t0f = Math.min(rise[0], 0) - 1, t1f = dur + 1, DT = 0.25, NS = Math.ceil((t1f - t0f) / DT) + 1;
      const kinds = ['plank', 'siding', 'sheet', 'car'];
      const fl = [];
      const depthAt = (d, q, tt) => { const x = at[0] + dir[0] * d + perp[0] * q, z = at[1] + dir[1] * d + perp[1] * q; return riseLv(tt - (FS > 0 ? clamp(d, 0, 700) / FS : 0)) - G(x, z); };
      for (let i = 0; i < NFL; i++) {
        const kind = i < 4 ? 'car' : kinds[Math.floor(RF() * 2.999)];
        const q = (RF() - 0.5) * SZ * 0.35, v = (kind === 'car' ? 1.5 : 2.5) + RF() * 3.5;
        const tab = new Float32Array(NS), dep = new Float32Array(NS);
        let d = -120 + RF() * 150;
        for (let k = 0; k < NS; k++) {
          const tt = t0f + k * DT, dd = depthAt(d, q, tt);
          if (dd > (kind === 'car' ? 0.9 : 0.3)) { const dn = d + v * DT; if (depthAt(dn, q, tt) > 0.25) d = dn; }
          tab[k] = d; dep[k] = dd;
        }
        fl.push({ kind, q, tab, dep, sp: [RF() * 6, RF() * 6, RF() * 6], w: [(RF() - 0.5) * 0.4, (RF() - 0.5) * 0.3], sc: 0.8 + RF() * 0.7, ph: RF() * 6 });
      }
      const flM = { plank: stdMat(ctx, { color: 0x6e573f, roughness: 0.9 }), siding: stdMat(ctx, { color: 0xd8d2c4, roughness: 0.8 }), sheet: stdMat(ctx, { color: 0x8a8d8f, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }), car: stdMat(ctx, { color: 0x9a3b2a, roughness: 0.4, metalness: 0.45, vertexColors: true }) };
      const flG = { plank: plankGeo(), siding: new THREE.BoxGeometry(2.6, 0.04, 0.22), sheet: sheetGeo(), car: carGeo() };
      const flI = {};
      for (const k of kinds) { const cnt = fl.filter((f) => f.kind === k).length; if (!cnt) continue; const im = new THREE.InstancedMesh(flG[k], flM[k], cnt); im.frustumCulled = false; im.castShadow = true; im.userData.noQA = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); ctx.scene.add(im); flI[k] = im; }
      const _fm = new THREE.Matrix4(), _fq = new THREE.Quaternion(), _fe = new THREE.Euler(), _fp = new THREE.Vector3(), _fs = new THREE.Vector3();
      surf.userData.flotsam = (t) => {
        const cnt = {}; for (const k in flI) cnt[k] = 0;
        const f = clamp((t - t0f) / DT, 0, NS - 1.001), k0 = Math.floor(f), u = f - k0;
        for (const p of fl) {
          const d = lerp(p.tab[k0], p.tab[k0 + 1], u), dp = lerp(p.dep[k0], p.dep[k0 + 1], u);
          const x = at[0] + dir[0] * d + perp[0] * p.q, z = at[1] + dir[1] * d + perp[1] * p.q, gy = G(x, z);
          const wl = riseLv(t - (FS > 0 ? clamp(d, 0, 700) / FS : 0));
          const afloat = wl - gy > (p.kind === 'car' ? 0.9 : 0.25);
          const y = afloat ? wl + (p.kind === 'car' ? -0.35 : 0.05) + 0.12 * Math.sin(t * 1.3 + p.ph) : gy + (p.kind === 'car' ? 0 : 0.06);
          const vis = sstep(-0.2, 0.3, dp) || (!afloat ? 1 : 0);
          _fe.set(afloat ? p.w[0] + 0.08 * Math.sin(t * 1.1 + p.ph) : 0, p.sp[1] + (afloat ? 0.15 * t : 0), afloat ? p.w[1] + 0.06 * Math.cos(t * 0.9 + p.ph) : 0); _fq.setFromEuler(_fe);
          _fs.setScalar(p.sc * (p.kind === 'car' ? 1 : 1.2) * (vis > 0.01 ? 1 : 1e-4));
          _fm.compose(_fp.set(x, y, z), _fq, _fs); flI[p.kind].setMatrixAt(cnt[p.kind]++, _fm);
        }
        for (const k in flI) { flI[k].count = cnt[k]; flI[k].instanceMatrix.needsUpdate = true; }
      };
    }
    surf.userData.update = (t) => {
      uT.value = t;
      const g = gust(t);
      for (let i = 0; i < n; i++) {
        const x = X0[i], z = Z0[i];
        let h = 0, sx = 0, sz = 0;
        for (const w of WV) { const ph = w.k * (x * w.dx + z * w.dz) - w.w * t; h += w.A * Math.sin(ph); sx += w.A * 0.35 * w.dx * Math.cos(ph); sz += w.A * 0.35 * w.dz * Math.cos(ph); }
        // the surge runs inland as a front: the level at a point lags by its distance inland / front_speed
        const dIn = x * dir[0] + z * dir[1], lag = FS > 0 ? clamp(dIn, 0, 700) / FS : 0;
        const Lv = riseLv(t - lag), depth = Lv - GRD[i];
        const damp = sstep(-0.5, 3.5, depth), deep = sstep(2, 6, depth);    // waves die in the shallows, grow on the deep surge
        // the front: a foaming lip where the water thins out over land that is still flooding, with small breakers
        const rate = FS > 0 ? riseLv(t - lag + 0.25) - Lv : 0;
        const lipK = FS > 0 ? sstep(0.004, 0.05, rate) * Math.exp(-(((depth - 0.35) / 0.55) ** 2)) : 0;
        const slope = FS > 0 && depth > 0 ? (Lv - riseLv(t - lag - 0.3)) / (0.3 * FS) : 0;          // m per m along the run
        const faceK = sstep(0.02, 0.09, slope);
        const brk = 0.5 + 0.5 * Math.sin((x * perp[0] + z * perp[1]) * 0.21 + dIn * 0.35 - t * 2.4) * Math.sin((x * perp[0] + z * perp[1]) * 0.057 + 1.7);
        let bump = lipK * (0.35 + 0.55 * brk);
        for (const e of WEV) bump += e.bump(x, z, t);
        const y = Lv + h * (0.35 + 0.65 * damp) * (0.8 + 0.3 * g) * (1 + 0.7 * deep) + bump;
        pos[i * 3] = x - sx * damp; pos[i * 3 + 1] = y - gy0; pos[i * 3 + 2] = z - sz * damp;
        const crest = sstep(0.45, 1.1, h * (1 + 0.7 * deep));
        const shallow = 1 - sstep(0, 2.5, depth);
        const mod = 0.5 + 0.5 * Math.sin(x * 0.021 + z * 0.013 + 1.3) * Math.sin(x * 0.009 - z * 0.017 + t * 0.2);
        fx[i * 3] = clamp(0.1 + 0.55 * crest * mod + 0.35 * shallow + 0.9 * lipK * (0.6 + 0.4 * brk) + 0.4 * sstep(0.6, 1.6, bump) + 0.75 * faceK * (0.55 + 0.45 * brk)); fx[i * 3 + 1] = 0.4 * crest + 0.5 * lipK; fx[i * 3 + 2] = 0.2;
        const mud = sstep(-1, 4, -(GRD[i] - level));
        col[i * 3] = lerp(0.16, 0.03, mud); col[i * 3 + 1] = lerp(0.14, 0.09, mud); col[i * 3 + 2] = lerp(0.09, 0.1, mud);
      }
      geo.attributes.position.needsUpdate = geo.attributes.aFx.needsUpdate = geo.attributes.color.needsUpdate = true;
      geo.computeVertexNormals();
    };
  }

  function update(t, clock, camera) {
    if (surf) { surf.userData.update(t); if (surf.userData.flotsam) surf.userData.flotsam(t); }
    updatePalms(t);
    if (camera) { root.updateMatrixWorld(true); updateWeather(t, camera); updateDamage(t); updateWaves(t, camera); }
  }
  update(0, 0, null);
  return { root, radius: 4, height: 4, update, snapped: true, anchors: {}, footprint: [4, 4], contact: false, level: (t) => surfLevel(t) };
}
