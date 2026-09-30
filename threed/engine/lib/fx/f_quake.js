// f_quake.js — (D2b) fx.quake: strong ground shaking and what it does to two kinds of building.
//   ground motion  a band-limited signal (1.5–6 Hz) under a rise / hold / decay envelope; every part of the FX rides it,
//                  and the camera gets a matching shake (position + a little roll/pitch), strongest at the peak
//   house          a two-storey unreinforced-masonry house: it racks, cracks open along the brick courses, the chimney
//                  topples, the walls peel outwards, the roof drops onto the rubble, and a dust cloud bursts out
//   tower          a 200 m engineered steel-and-glass tower: it sways elastically in its first mode (period ~5 s, the
//                  tip lagging the ground and ringing on after the shaking stops) and stays standing
//   mode           house | tower | compare (both, side by side or one behind the other)
//   Q11 (26 Sep): building 'concrete' (an RC frame that pancakes storey by storey, distinct from the brick house),
//                  mode 'town' (a whole town shakes, a share of its blocks pancake with dust), city {} (every tower of a
//                  city sways, period by height), interior {} (the room rolls, blinds / lamp swing, things rattle and
//                  fall), failure 'roof' (a roof-load collapse), a curtain-wall tower; the FX's own camera shake is off
//                  by default (camera.shake from Q6 instead).
// Everything is a function of t (the collapse is keyframed ballistics with seeded variation).
import * as THREE from 'three';
import { DEG, clamp, lerp, sstep, ease, easeOut, hf, vn, fbm1, makePuffs, makeGrit, syncEnv, stdMat, quakeEnvelope, shakeSignal } from './f_common.js';
import { curl3 } from './billow.js';
import { U } from '../shared/env.js';

export const CATALOG = {
  'fx.quake': {
    desc: 'earthquake: shaking ground + camera shake; an unreinforced brick house that cracks and collapses (chimney, walls, roof, dust) and/or a 200 m engineered skyscraper that sways elastically and stays up; mode compare = both for the comparison shot',
    actions: ['shake'],
    params: { mode: 'compare', layout: 'depth', behind: 600, start: 1.0, hold: 5, magnitude: 9, collapse: 2.2, sway: 7, camera: 0, gap: 60, towerHeight: 200, night: 0 },
    doc: {
      mode: 'house | tower | compare', layout: 'compare only: depth (house in front = the camera subject, the tower `behind` m further along -heading, same apparent size) | side (house left, tower right, gap m apart; the camera frames the tower so the house is small)', behind: 'm (depth layout)',
      start: 's: shaking starts', hold: 's of strong shaking', magnitude: '6..9.5 scales the amplitude', collapse: 's after start when the house gives way',
      sway: 'm: peak tip displacement of the tower (real 200 m towers move ~1–2 m; the default 7 is exaggerated so it reads on screen)', camera: '0..1 the FX\'s own camera shake, OFF by default (it bypasses the camera QA): use camera.shake (Q6) instead', gap: 'm between house and tower (side layout)',
      towerHeight: 'm', night: '0..1 lit windows',
      building: 'house/compare: brick (default) | concrete (a 4-storey RC frame that pancakes storey by storey from collapse)', storeys: 'concrete: 2..7 (4)',
      target: 'town: the town structure ("structures:N" or a kind prefix)', collapse_share: 'town: 0..0.9 (0.3) share of blocks that pancake', collapse_lead: 'town: s after start of the first collapse (0.4)', collapse_span: 'town: s over which the collapses are staggered (1.8)', town_sway: 'town: m of roof sway (0.12)',
      city: 'tower mode: {target: "structures:N", period: [4, 7] s by height, sway: m at the tallest tip (params.sway), exaggerate: x, dir: deg} every tower of that city sways in its first mode, out of phase',
      interior: '{target: "structures:N", roll: s (the room starts to roll, ~0.3 Hz, amp deg 1.1, period 3.3), rattle: s (small things rattle), fall: [t, ...] | [{t, what: tile|lamp, at: [x, z]}] ceiling tiles / the desk lamp come down with dust, shift: s (the room jolts 5 cm)}',
      failure: 'house: quake (default) | roof (a roof-load collapse: the ridge sags, the roof caves in at collapse, the walls stand)',
    },
    footprint: [80, 40], height: 200, snap: false, tags: ['fx', 'earthquake', 'quake', 'collapse', 'building', 'skyscraper', 'disaster'],
  },
};

// ── textures ────────────────────────────────────────────────────────────────────────────────────────────────────
function brickTex(ctx) {
  const k = 'fx.quake.brick';
  if (ctx.cache && ctx.cache.has(k)) return ctx.cache.get(k);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = '#8f8a82'; g.fillRect(0, 0, 256, 256);
  const bh = 16, bw = 48;
  for (let r = 0; r < 256 / bh; r++) for (let c = -1; c < 256 / bw + 1; c++) {
    const x = c * bw + (r % 2) * bw / 2, y = r * bh;
    const v = hf(r * 31 + c, 7), l = 118 + v * 40;
    g.fillStyle = `rgb(${l + 34},${l - 20},${l - 38})`;
    g.fillRect(x + 2, y + 2, bw - 3, bh - 3);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.userData.keep = true;
  if (ctx.cache) ctx.cache.set(k, t);
  return t;
}
function glassTex(ctx, night) {
  // Q11: a curtain wall, not a QR code: 16 bays x 16 floors per tile, spandrel bands at every floor, thin mullions;
  // by day blue-grey glass with a sky gradient, at night dark glass with lit offices in runs along a floor
  const k = 'fx.quake.glass2' + (night ? 'N' : '');
  if (ctx.cache && ctx.cache.has(k)) return ctx.cache.get(k);
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512; const g = cv.getContext('2d');
  const NC = 16, NR = 16, cw = 512 / NC, rh = 512 / NR;
  g.fillStyle = night ? '#1a1f24' : '#39424b'; g.fillRect(0, 0, 512, 512);
  for (let r = 0; r < NR; r++) {
    let run = 0, lit = false, warm = true;
    for (let c = 0; c < NC; c++) {
      if (run <= 0) { run = 1 + Math.floor(hf(r * 31 + c, 21) * 6); lit = hf(r * 17 + c * 5, 22) < 0.3; warm = hf(r * 7 + c, 23) < 0.75; }
      run--;
      const x = c * cw + 1.5, y = r * rh + rh * 0.2, w = cw - 3, h = rh * 0.76, v = hf(r * 131 + c, 24);
      if (night) {
        if (lit) { const L = 0.7 + 0.2 * v; g.fillStyle = warm ? `rgb(${245 * L | 0},${210 * L | 0},${150 * L | 0})` : `rgb(${215 * L | 0},${228 * L | 0},${236 * L | 0})`; }
        else g.fillStyle = `rgb(${18 + v * 10 | 0},${26 + v * 12 | 0},${36 + v * 14 | 0})`;
        g.fillRect(x, y, w, h);
      } else {
        const gr = g.createLinearGradient(0, y, 0, y + h); const L = 0.9 + 0.2 * v;
        gr.addColorStop(0, `rgb(${120 * L | 0},${142 * L | 0},${165 * L | 0})`); gr.addColorStop(1, `rgb(${62 * L | 0},${80 * L | 0},${100 * L | 0})`);
        g.fillStyle = gr; g.fillRect(x, y, w, h);
      }
    }
  }
  g.fillStyle = night ? '#2a3036' : '#8d959c'; for (let c = 0; c <= NC; c++) g.fillRect(c * cw - 1, 0, 2, 512);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.userData.keep = true;
  if (ctx.cache) ctx.cache.set(k, t);
  return t;
}
function boxUV(geo, sx, sy, sz, scale) {
  // world-scaled UVs on a box so the bricks keep their size on every chunk
  const P = geo.attributes.position, N = geo.attributes.normal, UV = geo.attributes.uv;
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i));
    const x = P.getX(i) + sx, y = P.getY(i) + sy, z = P.getZ(i) + sz;
    if (nx > 0.5) UV.setXY(i, z / scale, y / scale); else if (ny > 0.5) UV.setXY(i, x / scale, z / scale); else UV.setXY(i, x / scale, y / scale);
  }
  UV.needsUpdate = true;
}

// ── the house ───────────────────────────────────────────────────────────────────────────────────────────────────
function buildHouse(ctx, seed, o) {
  const g = new THREE.Group(); g.name = 'fx.quake.house';
  const Wd = 9.2, Dp = 7.4, H = 5.9, TH = 0.36, RIDGE = 3.1;
  const brick = stdMat(ctx, { map: brickTex(ctx), color: 0xd8c8bc, roughness: 0.92 });
  const trim = stdMat(ctx, { color: 0xe8e2d6, roughness: 0.8 });
  const glass = stdMat(ctx, { color: 0x10161c, roughness: 0.15, metalness: 0.4 });
  const roofM = stdMat(ctx, { color: 0x5a2e24, roughness: 0.85 });
  const dark = stdMat(ctx, { color: 0x0c0a09, roughness: 1 });
  const pieces = [];
  // interior darkness so the opening cracks read as holes
  const inner = new THREE.Mesh(new THREE.BoxGeometry(Wd - TH * 2 - 0.05, H - 0.1, Dp - TH * 2 - 0.05), dark);
  inner.position.y = H / 2; g.add(inner);
  // walls: [centre x, centre z, length, normal x, normal z, gable]
  const walls = [[0, Dp / 2 - TH / 2, Wd, 0, 1, 0], [0, -Dp / 2 + TH / 2, Wd, 0, -1, 0], [-Wd / 2 + TH / 2, 0, Dp - TH * 2, -1, 0, 1], [Wd / 2 - TH / 2, 0, Dp - TH * 2, 1, 0, 1]];
  let pid = 0;
  for (const [cx, cz, L, nx, nz, gable] of walls) {
    const tx = -nz, tz = nx;                        // tangent along the wall
    const nc = L > 8 ? 6 : 4, nr = 3;                // Q11: smaller chunks (was 4 / 3 columns)
    const cutsC = [0]; for (let c = 1; c < nc; c++) cutsC.push(c / nc + (hf(pid * 7 + c, seed) - 0.5) * 0.12); cutsC.push(1);
    for (let c = 0; c < nc; c++) {
      const cutsR = [0]; for (let r = 1; r < nr; r++) cutsR.push(r / nr + (hf(pid * 11 + c * 3 + r, seed + 1) - 0.5) * 0.14); cutsR.push(1);
      for (let r = 0; r < nr; r++) {
        const a0 = cutsC[c] * L - L / 2, a1 = cutsC[c + 1] * L - L / 2, y0 = cutsR[r] * H, y1 = cutsR[r + 1] * H;
        const len = a1 - a0 - 0.004, hh = y1 - y0 - 0.004;           // Q11: 4 mm (was 2 cm: seams showed on the intact house)
        const geo = new THREE.BoxGeometry(Math.abs(nx) > 0.5 ? TH : len, hh, Math.abs(nx) > 0.5 ? len : TH);
        const mid = (a0 + a1) / 2;
        const px = cx + tx * mid, pz = cz + tz * mid, py = (y0 + y1) / 2;
        boxUV(geo, px, py, pz, 2.2);
        const m = new THREE.Mesh(geo, brick); m.castShadow = m.receiveShadow = true;
        // windows and the door as dark panes set into the chunk
        const win = (r === 1 || r === 2) && c > 0 && c < nc - 1 || (gable === 0 && (r === 1 || r === 2) && hf(pid, 9) > 0.4);
        if (win && len > 1.4) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(nx) > 0.5 ? TH + 0.04 : Math.min(1.1, len * 0.55), Math.min(1.3, hh * 0.62), Math.abs(nx) > 0.5 ? Math.min(1.1, len * 0.55) : TH + 0.04), glass);
          const fr = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(nx) > 0.5 ? TH + 0.02 : Math.min(1.3, len * 0.65), Math.min(1.5, hh * 0.74), Math.abs(nx) > 0.5 ? Math.min(1.3, len * 0.65) : TH + 0.02), trim);
          m.add(fr, w);
        } else if (r === 0 && gable === 0 && nz > 0 && c === 1) {
          const d = new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.1, len * 0.6), Math.min(2.1, hh * 0.95), TH + 0.04), stdMat(ctx, { color: 0x3a2418, roughness: 0.7 }));
          d.position.y = -hh / 2 + Math.min(2.1, hh * 0.95) / 2; m.add(d);
        }
        m.position.set(px, py, pz);
        g.add(m);
        const top = r === nr - 1, bottom = r === 0;
        pieces.push({ m, p0: new THREE.Vector3(px, py, pz), n: [nx, nz], t: [tx, tz], h: hh, len, row: r, stay: bottom && hf(pid, seed + 3) < 0.55, out: hf(pid, seed + 4) < 0.72 ? 1 : -1,
          delay: (top ? 0 : r === 1 ? 0.35 : 0.8) + hf(pid, seed + 5) * 0.45, spin: 0.6 + hf(pid, seed + 6) * 1.6, vout: 0.8 + hf(pid, seed + 7) * 2.2, rest: 0.18 + hf(pid, seed + 8) * (top ? 1.3 : 0.9), side: (hf(pid, seed + 10) - 0.5) * 0.8, id: pid });
        pid++;
      }
    }
    if (gable) {
      // the gable triangle as two stepped blocks
      for (let k = 0; k < 2; k++) {
        const L2 = L * (k ? 0.36 : 0.74), h2 = RIDGE * (k ? 0.42 : 0.55);
        const geo = new THREE.BoxGeometry(TH, h2, L2);
        const py = H + (k ? RIDGE * 0.55 + h2 / 2 : h2 / 2);
        boxUV(geo, cx, py, cz, 2.2);
        const m = new THREE.Mesh(geo, brick); m.castShadow = m.receiveShadow = true; m.position.set(cx, py, cz); g.add(m);
        pieces.push({ m, p0: m.position.clone(), n: [nx, nz], t: [tx, tz], h: h2, len: L2, row: 3 + k, stay: false, out: 1, delay: -0.15 + k * 0.05 + hf(pid, seed + 5) * 0.2, spin: 1.2 + hf(pid, seed + 6), vout: 1.5 + hf(pid, seed + 7) * 1.5, rest: 0.5 + hf(pid, seed + 8), side: 0, id: pid });
        pid++;
      }
    }
  }
  // floor between the storeys (drops with the walls)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(Wd - TH * 2 - 0.1, 0.25, Dp - TH * 2 - 0.1), stdMat(ctx, { color: 0x4a3a2a, roughness: 0.9 }));
  floor.position.y = H * 0.5; floor.castShadow = true; g.add(floor);
  // roof: two slabs per side (they break at the middle)
  const pitch = Math.atan2(RIDGE, Dp / 2), slabL = Math.hypot(RIDGE, Dp / 2) + 0.5;
  const roof = [];
  for (const s of [-1, 1]) for (const half of [-1, 1]) {
    const geo = new THREE.BoxGeometry(Wd / 2 + 0.35, 0.22, slabL);
    const m = new THREE.Mesh(geo, roofM); m.castShadow = m.receiveShadow = true;
    // tiles: thin ridges across the slab
    const rib = new THREE.Mesh(new THREE.BoxGeometry(Wd / 2 + 0.35, 0.06, slabL), stdMat(ctx, { color: 0x6a3a2c, roughness: 0.8 }));
    rib.position.y = 0.12; m.add(rib);
    const base = { x: half * (Wd / 4 + 0.17), y: H + RIDGE / 2 + 0.1, z: s * Dp / 4 + s * 0.12, rx: s * pitch };
    m.position.set(base.x, base.y, base.z); m.rotation.x = base.rx;
    g.add(m);
    roof.push({ m, base, s, half, id: pid++ });
  }
  // chimney: three blocks
  const chim = [];
  for (let k = 0; k < 3; k++) {
    const geo = new THREE.BoxGeometry(0.85, 0.75, 0.85);
    const py = H + RIDGE - 0.3 + k * 0.75 + 0.37;
    boxUV(geo, Wd * 0.28, py, 0, 2.2);
    const m = new THREE.Mesh(geo, brick); m.castShadow = true; m.position.set(Wd * 0.28, py, 0.9); g.add(m);
    chim.push({ m, p0: m.position.clone(), k });
  }
  return { g, pieces, roof, chim, inner, floor, W: Wd, D: Dp, H, RIDGE };
}

function animateHouse(hs, t, tc, seed, gm, fail) {
  const G = 9.81;
  if (fail === 'roof') return animateRoofLoad(hs, t, tc, seed, gm);
  const crack = sstep(tc - 1.1, tc + 0.2, t);                 // seams open before the failure
  const rack = gm.rack;                                        // racking (top shear) in metres
  for (const pc of hs.pieces) {
    const { m, p0, n, t: tg } = pc;
    const hk = p0.y / hs.H;
    // shaking + racking + cracks opening
    let x = p0.x + gm.x + rack * hk * 1.0 + n[0] * crack * 0.05 * (0.4 + hk);
    let z = p0.z + gm.z + rack * hk * 0.3 + n[1] * crack * 0.05 * (0.4 + hk);
    let y = p0.y;
    let rx = 0, rz = 0, ry = 0;
    const tr = tc + pc.delay;
    if (!pc.stay && t > tr) {
      const tau = t - tr;
      const fallY = 0.5 * G * tau * tau;
      const drop = Math.max(0, p0.y - pc.rest);
      const landT = Math.sqrt(2 * drop / G) || 0.01;
      const tl = Math.min(tau, landT);
      // outward drift (decelerates after landing), topple about the wall tangent
      const out = pc.out * (pc.vout * tl + (tau > landT ? pc.vout * 0.25 * (1 - Math.exp(-(tau - landT) * 3)) : 0));
      x += n[0] * out + tg[0] * pc.side * tl; z += n[1] * out + tg[1] * pc.side * tl;
      y = p0.y - Math.min(fallY, drop);
      const ang = pc.out * Math.min(1.45, pc.spin * tl * 1.4 + (tau > landT ? 0.15 * (1 - Math.exp(-(tau - landT) * 4)) : 0));
      // rotation about the tangent axis: tipping outwards
      rx = n[1] * ang; rz = -n[0] * ang; ry = (hf(pc.id, seed + 12) - 0.5) * 0.6 * ease(tl / landT);
      const brk = sstep(landT + 0.15, landT + 1.3, tau);                     // Q11: the chunk crumbles into the heap
      pc.sc = 1 - 0.32 * brk; y -= 0.25 * brk * (1 - hk);
    } else if (!pc.stay) {
      // shudder just before letting go
      const k = t > tr - 0.6 ? Math.sin(clamp((t - tr + 0.6) / 0.6) * Math.PI) : 0;   // zero at both ends: no jump on release
      x += vn(t * 13 + pc.id, 3) * 0.02 * k; y += vn(t * 11 + pc.id, 4) * 0.015 * k;
    }
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.setScalar(pc.sc ?? 1); pc.sc = 1;
  }
  // roof drops onto the rubble and flattens out
  const trf = tc + 0.45;
  for (const r of hs.roof) {
    const b = r.base;
    let x = b.x + gm.x + rack, y = b.y, z = b.z + gm.z, rx = b.rx, ry = 0, rz = 0;
    if (t > trf) {
      const tau = t - trf;
      const drop = b.y - (1.35 + hf(r.id, seed + 20) * 0.6);
      const landT = Math.sqrt(2 * drop / G);
      const tl = Math.min(tau, landT), after = Math.max(0, tau - landT);
      y = b.y - Math.min(0.5 * G * tau * tau, drop) + (after > 0 ? 0.12 * Math.sin(Math.min(after * 9, Math.PI)) * Math.exp(-after * 3) : 0);
      const flat = ease(tl / landT) * 0.75 + ease(after * 2) * 0.1;
      rx = b.rx * (1 - flat) + r.s * 0.08 * hf(r.id, seed + 21);
      z = b.z + r.s * (flat * 1.4 + 0.2 * ease(after * 2));
      x += r.half * (0.35 * ease(after * 2) + 0.2 * flat);
      rz = r.half * 0.12 * flat + (hf(r.id, seed + 22) - 0.5) * 0.18 * flat;
      ry = (hf(r.id, seed + 23) - 0.5) * 0.15 * flat;
    }
    r.m.position.set(x, y, z); r.m.rotation.set(rx, ry, rz);
  }
  // chimney topples first
  const tcc = tc - 0.35;
  for (const c of hs.chim) {
    let { x, y, z } = c.p0; x += gm.x + rack; z += gm.z;
    let rz = 0, rx = 0;
    if (t > tcc) {
      const tau = t - tcc - c.k * 0.06;
      if (tau > 0) {
        const drop = c.p0.y - (0.4 + c.k * 0.35);
        const landT = Math.sqrt(2 * drop / 9.81);
        const tl = Math.min(tau, landT);
        y = c.p0.y - Math.min(0.5 * 9.81 * tau * tau, drop);
        x += (1.6 + c.k * 1.1) * tl; z += (1.4 + c.k * 0.5) * tl;
        rz = -Math.min(1.5, (1.2 + c.k * 0.8) * tl * 2); rx = 0.4 * tl;
      }
    }
    c.m.position.set(x, y, z); c.m.rotation.set(rx, 0, rz);
  }
  // the dark interior and the floor go down with the walls
  const down = ease((t - tc - 0.2) / 1.4);
  hs.inner.scale.y = lerp(1, 0.18, down); hs.inner.position.set(gm.x, lerp(hs.H / 2, hs.H * 0.09, down), gm.z);
  hs.floor.position.set(gm.x + rack * 0.5, lerp(hs.H * 0.5, 0.9, easeOutFall(t - tc - 0.3, hs.H * 0.5 - 0.9)), gm.z);
  hs.floor.rotation.set(0.05 * down, 0, -0.07 * down);
}
// Q11: a roof-load collapse (wet ash / snow): the ridge sags for ~1.2 s, the rafters give at tc and the roof caves into
// the top floor in two V-folds (one half first), the gables lose their support and lean in, the walls stand.
function animateRoofLoad(hs, t, tc, seed, gm) {
  const sag = sstep(tc - 1.2, tc, t) * 0.07;
  for (const pc of hs.pieces) {
    const { m, p0, n } = pc; let x = p0.x + gm.x, y = p0.y, z = p0.z + gm.z, rx = 0, rz = 0;
    if (pc.row >= 3) {                                         // the gable peaks: pushed in by the falling roof, they topple inwards
      const a = t - tc - 0.25 - 0.1 * (pc.row - 3);
      if (a > 0) { const tl = Math.min(a, 0.7), ang = Math.min(1.3, 2.6 * tl * tl + 0.4 * tl);
        rx = -n[1] * ang; rz = n[0] * ang; x -= n[0] * 0.8 * tl; z -= n[1] * 0.8 * tl; y = p0.y - Math.min(0.5 * 9.81 * Math.max(0, a - 0.2) ** 2, pc.h * 0.8 + 0.6); }
    } else if (pc.row === 2) {                                 // the top course cracks and leans out a little
      const k = sstep(tc - 0.2, tc + 0.5, t); rx = n[1] * 0.035 * k * (0.5 + hf(pc.id, seed + 70)); rz = -n[0] * 0.035 * k * (0.5 + hf(pc.id, seed + 71));
      x += n[0] * 0.04 * k; z += n[1] * 0.04 * k;
    }
    m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
  }
  const slabL = hs.roof.length ? hs.roof[0].m.geometry.parameters.depth : 5;
  const _p = new THREE.Vector3(), _E = new THREE.Vector3();
  for (const r of hs.roof) {
    const b = r.base, s = r.s, lag = r.half > 0 ? 0 : 0.22 + 0.1 * hf(r.id, seed + 72);
    const a = t - tc - lag;
    // hinge about the eave: the ridge end sinks with the sag, then folds down into the top floor, bounces and settles
    let phi = sag * (1 + 0.3 * r.half);
    if (a > 0) { const tf = 0.55, k = Math.min(a / tf, 1); phi += 0.95 * k * k; if (a > tf) phi -= 0.06 * Math.sin(Math.min((a - tf) * 12, Math.PI)) * Math.exp(-(a - tf) * 5); }
    const rx = b.rx - s * phi;                                   // the ridge end goes down, below the eaves
    _E.set(0, 0, s * slabL / 2).applyAxisAngle(new THREE.Vector3(1, 0, 0), b.rx).add(new THREE.Vector3(b.x, b.y, b.z));
    _p.set(0, 0, s * slabL / 2).applyAxisAngle(new THREE.Vector3(1, 0, 0), rx);
    r.m.position.set(_E.x - _p.x + gm.x, _E.y - _p.y, _E.z - _p.z + gm.z);
    r.m.rotation.set(rx, 0, (a > 0 ? r.half * 0.06 * Math.min(a / 0.55, 1) : 0));
  }
  // the chimney goes down into the house with the ridge
  for (const c of hs.chim) {
    let { x, y, z } = c.p0; x += gm.x; z += gm.z; let rz = 0;
    const a = t - tc - 0.1 - c.k * 0.05;
    if (a > 0) { const drop = Math.min(0.5 * 9.81 * a * a, 1.6 + c.k * 0.5); y -= drop; rz = Math.min(0.9, a * 1.5) * (c.k + 1) * 0.3; x -= 0.4 * Math.min(a, 0.6); }
    else y -= sag * 3;
    c.m.position.set(x, y, z); c.m.rotation.set(0, 0, rz);
  }
  hs.inner.scale.y = 1; hs.inner.position.set(gm.x, hs.H / 2, gm.z);
  hs.floor.position.set(gm.x, hs.H * 0.5, gm.z); hs.floor.rotation.set(0, 0, 0);
}
function easeOutFall(tau, drop) { if (tau <= 0) return 0; return clamp(0.5 * 9.81 * tau * tau / Math.max(drop, 0.01)); }

const TAU = Math.PI * 2;
// ── the concrete-frame block (Q11) ──────────────────────────────────────────────────────────────────────────────
// A 4-storey reinforced-concrete frame (slabs on a 4 x 3 column grid, plastered infill panels with windows). It fails
// the way such frames do, and not like the brick house: the ground-storey columns buckle, the whole block drops one
// storey onto them, the impact crushes the next storey, and so on - the slabs end up stacked like pancakes with a
// hand's breadth of rubble between them, the infill panels burst out and crumble at the foot.
function panelTex(ctx) {
  const k = 'fx.quake.panel';
  if (ctx.cache && ctx.cache.has(k)) return ctx.cache.get(k);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = '#d9d3c7'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { const v = 190 + hf(i, 5) * 40; g.fillStyle = `rgba(${v},${v - 6},${v - 16},0.35)`; g.fillRect(hf(i, 6) * 256, hf(i, 7) * 256, 2 + hf(i, 8) * 5, 2 + hf(i, 9) * 5); }
  for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(120,110,95,${0.12 + hf(i, 11) * 0.2})`; g.lineWidth = 1; g.beginPath(); const x = hf(i, 12) * 256; g.moveTo(x, 0); g.lineTo(x + (hf(i, 13) - 0.5) * 60, 256); g.stroke(); }
  g.fillStyle = '#e9e4da'; g.fillRect(70, 62, 116, 124);                        // window frame
  g.fillStyle = '#1b2127'; g.fillRect(78, 70, 100, 108);                        // glass (dark, the rooms are unlit)
  g.fillStyle = '#e9e4da'; g.fillRect(126, 70, 4, 108); g.fillRect(78, 120, 100, 4);
  g.fillStyle = 'rgba(160,190,210,0.25)'; g.fillRect(82, 74, 40, 42);          // a little sky in the upper pane
  g.fillStyle = '#b8b2a6'; g.fillRect(64, 186, 128, 8);                         // sill
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.keep = true;
  if (ctx.cache) ctx.cache.set(k, t);
  return t;
}
function buildConcrete(ctx, seed, o) {
  const g = new THREE.Group(); g.name = 'fx.quake.concrete';
  const NS = clamp(Math.round(+(o.storeys ?? 4)), 2, 7), FH = 3.0, Wd = 14, Dp = 10, SL = 0.3, CW = 0.42;
  const conc = stdMat(ctx, { color: 0xb5b1a8, roughness: 0.92 });
  const plain = stdMat(ctx, { color: 0xd4cec2, roughness: 0.9 });
  const pmat = new THREE.MeshStandardMaterial({ map: panelTex(ctx), roughness: 0.85 }); ctx.patch(pmat);
  const dark = stdMat(ctx, { color: 0x0e0d0c, roughness: 1 });
  const colX = [-Wd / 2 + CW / 2, -Wd / 6, Wd / 6, Wd / 2 - CW / 2], colZ = [-Dp / 2 + CW / 2, 0, Dp / 2 - CW / 2];
  const slabs = [], cols = [], panels = [], inner = [];
  for (let j = 1; j <= NS; j++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Wd + 0.5, SL, Dp + 0.5), conc); m.castShadow = m.receiveShadow = true;
    const y0 = j * FH - SL / 2; m.position.y = y0; g.add(m); slabs.push({ m, y0, j });
    if (j === NS) { for (const [w, d, x, z] of [[Wd + 0.5, 0.2, 0, Dp / 2 + 0.15], [Wd + 0.5, 0.2, 0, -Dp / 2 - 0.15], [0.2, Dp + 0.5, Wd / 2 + 0.15, 0], [0.2, Dp + 0.5, -Wd / 2 - 0.15, 0]]) {
        const pp = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), conc); pp.position.set(x, SL / 2 + 0.35, z); pp.castShadow = true; m.add(pp); }
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 14), stdMat(ctx, { color: 0x2d3a44, roughness: 0.6 })); tank.position.set(Wd * 0.28, SL / 2 + 0.7, -Dp * 0.2); tank.castShadow = true; m.add(tank); }
  }
  // ground slab / plinth
  const base = new THREE.Mesh(new THREE.BoxGeometry(Wd + 0.6, 0.25, Dp + 0.6), conc); base.position.y = 0.05; base.receiveShadow = true; g.add(base);
  for (let k = 0; k < NS; k++) {
    for (const cx of colX) for (const cz of colZ) {
      if (cz === 0 && (cx === colX[1] || cx === colX[2])) continue;             // interior columns hidden by the panels anyway
      const h = FH - SL, m = new THREE.Mesh(new THREE.BoxGeometry(CW, h, CW), conc); m.castShadow = true;
      m.position.set(cx, k * FH + h / 2, cz); g.add(m); cols.push({ m, k, x: cx, z: cz, h, id: cols.length });
    }
    // the dark rooms behind the windows
    const r = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.6, FH - SL - 0.1, Dp - 0.6), dark); r.position.y = k * FH + (FH - SL) / 2; g.add(r); inner.push({ m: r, k });
    // infill panels between the columns: [x0, x1] along the wall, normal (nx, nz)
    const faces = [];
    for (let b = 0; b < 3; b++) { faces.push([colX[b] + CW / 2, colX[b + 1] - CW / 2, 0, 1]); faces.push([colX[b] + CW / 2, colX[b + 1] - CW / 2, 0, -1]); }
    for (let b = 0; b < 2; b++) { faces.push([colZ[b] + CW / 2, colZ[b + 1] - CW / 2, 1, 0]); faces.push([colZ[b] + CW / 2, colZ[b + 1] - CW / 2, -1, 0]); }
    for (const [a0, a1, nx, nz] of faces) {
      const L = a1 - a0, h = FH - SL - 0.04, T = 0.2;
      const geo = new THREE.BoxGeometry(L, h, T);
      // the texture repeats per ~2.4 m of wall so every bay has windows of the same size
      const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * Math.max(1, Math.round(L / 2.4)));
      pmat.map.wrapS = THREE.RepeatWrapping;
      const m = new THREE.Mesh(geo, [plain, plain, plain, plain, pmat, plain]); m.castShadow = m.receiveShadow = true;
      const mid = (a0 + a1) / 2, px = nx ? nx * (Wd / 2 - CW / 2) : mid, pz = nz ? nz * (Dp / 2 - CW / 2) : mid;
      m.position.set(px, k * FH + h / 2 + 0.02, pz); m.rotation.y = Math.atan2(nx, nz);
      g.add(m);
      panels.push({ m, k, p0: m.position.clone(), n: [nx, nz], ry: m.rotation.y, h, L, id: panels.length });
    }
  }
  return { g, slabs, cols, panels, inner, NS, FH, SL, W: Wd, D: Dp, H: NS * FH, RIDGE: 0.9, concrete: true };
}
function animateConcrete(cs, t, tc, seed, gm) {
  const G = 9.81, FH = cs.FH, NS = cs.NS, rub = 0.55, drop = FH - rub, tf = Math.sqrt(2 * drop / G);
  // storey k gives way at tk (bottom first, each crushed by the fall of everything above)
  const tk = (k) => tc + k * (tf + 0.05) + (hf(k, seed + 80) - 0.5) * 0.1;
  const fall = (k) => { const a = t - tk(k); if (a <= 0) return 0; if (a < tf) return 0.5 * G * a * a; const b = a - tf; return drop - 0.07 * Math.sin(Math.min(b * 16, Math.PI)) * Math.exp(-b * 6); };
  const F = []; let acc = 0; for (let k = 0; k < NS; k++) { F.push(acc); acc += fall(k); } F.push(acc);   // F[j] = drop of storey j's floor
  const H = cs.H;
  for (const s of cs.slabs) {
    const D = F[s.j], hk = s.y0 / H, settled = clamp(D / Math.max(drop * s.j, 0.01));
    const tilt = settled * (hf(s.j, seed + 81) - 0.5) * 0.09, tiltz = settled * (hf(s.j, seed + 82) - 0.5) * 0.07;
    s.m.position.set(gm.x + gm.rack * hk + (hf(s.j, seed + 83) - 0.5) * 0.5 * settled, s.y0 - D, gm.z + gm.rack * hk * 0.3 + (hf(s.j, seed + 84) - 0.5) * 0.4 * settled);
    s.m.rotation.set(tilt, 0, tiltz);
  }
  for (const c of cs.cols) {
    const f = fall(c.k), crushed = clamp(f / drop), base = c.k * FH - F[c.k], h = Math.max(0.12, c.h - f * (c.h / drop) * (1 - rub / FH));
    const hk = (c.k * FH) / H, sg = hf(c.id, seed + 85) < 0.5 ? -1 : 1;
    c.m.scale.set(1 + 0.3 * crushed, h / c.h, 1 + 0.3 * crushed);
    c.m.position.set(c.x + gm.x + gm.rack * hk + sg * 0.35 * crushed, base + h / 2, c.z + gm.z + (hf(c.id, seed + 86) - 0.5) * 0.5 * crushed);
    c.m.rotation.set((hf(c.id, seed + 87) - 0.5) * 0.9 * crushed, 0, sg * 0.6 * crushed);
    c.m.visible = crushed < 0.98 || c.k > 0;
  }
  for (const r of cs.inner) { const f = fall(r.k), h = Math.max(0.05, (FH - cs.SL - 0.1) - f); r.m.scale.y = h / (FH - cs.SL - 0.1); r.m.position.set(gm.x, r.k * FH - F[r.k] + h / 2, gm.z); }
  for (const pn of cs.panels) {
    const a = t - tk(pn.k) - 0.05 - hf(pn.id, seed + 88) * 0.25, hk = pn.p0.y / H;
    let x = pn.p0.x + gm.x + gm.rack * hk, z = pn.p0.z + gm.z + gm.rack * hk * 0.3, y = pn.p0.y - F[pn.k], rx = 0, rz = 0, sc = 1;
    if (a > 0) {
      // burst out as the storey is crushed, drop to the ground, tip outwards and crumble
      const out = (0.6 + 1.6 * hf(pn.id, seed + 89)) * Math.min(a, 0.9) + 0.2 * Math.max(0, a - 0.9);
      const yb = pn.p0.y - F[pn.k], land = Math.sqrt(2 * Math.max(yb - 0.25, 0.01) / G);
      y = yb - Math.min(0.5 * G * a * a, Math.max(yb - 0.25, 0));
      x += pn.n[0] * out; z += pn.n[1] * out;
      const tip = Math.min(1.35, (1.2 + hf(pn.id, seed + 90)) * Math.min(a, land) * 1.6);
      rx = tip;
      sc = 1 - 0.45 * sstep(0, 1.2, a - land);
    }
    pn.m.position.set(x, y, z); pn.m.rotation.set(0, pn.ry, 0); pn.m.rotateX(rx); pn.m.scale.set(sc, sc, 1);
  }
}

// ── Q11: the rest of the scene the quake acts on ────────────────────────────────────────────────────────────────
// Structures are built after objects, so targets are resolved lazily at the first update. `target` = 'structures:N'
// (the Nth town / interior / building root in the stage) or a kind prefix ('town.', 'interior.office').
function findTarget(ctx, target) {
  const want = String(target ?? 'structures:0'), kids = ctx.scene.children;
  const cands = kids.filter((o) => /^(town\.|interior\.|city|building|house|structure|village|landmark)/.test(o.name || ''));
  const m = /^structures:(\d+)$/.exec(want);
  if (m) return cands[+m[1]] || cands[0] || null;
  return kids.find((o) => (o.name || '').startsWith(want)) || cands[0] || null;
}
// every instanced unit box (0..1 in y: the town / city blocks) under a root: base matrices, heights, footprints
function collectBlocks(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isInstancedMesh || !o.geometry) return;
    o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox;
    if (Math.abs(b.min.y) > 1e-3 || Math.abs(b.max.y - 1) > 1e-3 || Math.abs(b.max.x - 0.5) > 1e-3) return;
    const n = o.count, base = new Float32Array(o.instanceMatrix.array.slice(0, n * 16));
    const P = [], Q = [], S = [];
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < n; i++) { m.fromArray(base, i * 16); m.decompose(p, q, s); P.push(p.clone()); Q.push(q.clone()); S.push(s.clone()); }
    o.instanceMatrix.setUsage(THREE.DynamicDrawUsage); o.frustumCulled = false;
    out.push({ im: o, n, P, Q, S, base });
  });
  return out;
}
const _T = new THREE.Matrix4(), _Sh = new THREE.Matrix4(), _RS = new THREE.Matrix4(), _q2 = new THREE.Quaternion(), _e2 = new THREE.Euler(), _v2 = new THREE.Vector3(), _s2 = new THREE.Vector3();
// one block: translate (dx, dz), shear the top by (ax, az) metres, crush to hs of its height, tilt (tx, tz)
function setBlock(B, i, dx, dy, dz, ax, az, hs, tx, tz, spread) {
  const p = B.P[i], s = B.S[i], H = s.y * hs;
  _T.makeTranslation(p.x + dx, p.y + dy, p.z + dz);
  _Sh.makeShear(0, 0, H > 0.01 ? ax / H : 0, H > 0.01 ? az / H : 0, 0, 0);
  _q2.setFromEuler(_e2.set(tx, 0, tz)).multiply(B.Q[i]);
  _RS.compose(_v2.set(0, 0, 0), _q2, _s2.set(s.x * spread, H, s.z * spread));
  _T.multiply(_Sh).multiply(_RS); B.im.setMatrixAt(i, _T);
}
// the interior: the room rolls (the set moves, the camera does not), hanging things swing, small things rattle,
// ceiling tiles / books come down with a puff of dust
function interiorRig(ctx, spec, seed) {
  const I = typeof spec === 'object' && spec ? spec : {};
  return { I, target: null, ready: false, seed, parts: { blinds: [], lamp: [], small: [], lights: [] }, falls: [], tiles: null };
}
function interiorSetup(R, ctx) {
  const tg = R.target; R.ready = true;
  tg.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(tg); R.ceil = bb.max.y; R.floor = bb.min.y;
  // the room's own frame: interiors put the room in a 'place' group (at `at`, turned to the heading) under the root
  const fr = tg.children.find((c) => c.children && c.children.length && !c.isMesh) || tg; R.frame = fr;
  R.pivot = fr.getWorldPosition(new THREE.Vector3());
  R.inv = new THREE.Matrix4().copy(fr.matrixWorld).invert();
  const w = new THREE.Vector3();
  tg.traverse((o) => {
    if (o.isPointLight) { R.parts.lights.push({ o, p0: o.position.clone() }); return; }
    if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
    const g = o.geometry, pr = g.parameters || {};
    if (g.type === 'BoxGeometry' && pr.width <= 0.045 && pr.height <= 0.035 && pr.depth >= 0.6) { R.parts.blinds.push({ o, p0: o.position.clone(), r0: o.rotation.clone() }); return; }
    if (g.type === 'CylinderGeometry' && Math.max(pr.radiusTop, pr.radiusBottom) <= 0.2 && pr.height <= 0.4) { R.parts.lamp.push({ o, p0: o.position.clone(), q0: o.quaternion.clone() }); return; }
    g.computeBoundingBox(); const s = g.boundingBox.getSize(w);
    if (Math.max(s.x, s.y, s.z) < 0.4) R.parts.small.push({ o, p0: o.position.clone(), r0: o.rotation.clone(), thin: s.y < 0.01 });
  });
  // the blinds hang from the top slat: its height in the parent frame
  if (R.parts.blinds.length) R.blindTop = Math.max(...R.parts.blinds.map((b) => b.p0.y)) + 0.08;
  // the lamp rocks about the bottom of its base (in the base's parent frame)
  if (R.parts.lamp.length) { const base = R.parts.lamp.reduce((a, b) => (b.p0.y < a.p0.y ? b : a)); const pr = base.o.geometry.parameters; R.lampPivot = base.p0.clone(); R.lampPivot.y -= pr.height / 2; R.lampParent = base.o.parent; }
  // falling things: ceiling tiles by default, or the lamp; positions in the room's own frame (the desk is at ~[0.3, -0.6])
  const spots = [[1.35, -1.35, 0], [-0.95, -1.55, 0], [0.55, -0.45, 0.79], [1.6, -0.4, 0], [-1.3, -0.6, 0]];
  const F = Array.isArray(R.I.fall) ? R.I.fall : R.I.fall != null ? [R.I.fall] : [];
  const tileM = stdMat(ctx, { color: 0xe6e3dc, roughness: 0.95 }), holeM = stdMat(ctx, { color: 0x1a1816, roughness: 1 });
  F.forEach((f, k) => {
    const o = typeof f === 'object' && f ? f : { t: f };
    const what = o.what || (k === 1 && R.parts.lamp.length ? 'lamp' : 'tile');
    let lx = spots[k % spots.length][0], lz = spots[k % spots.length][1], land = spots[k % spots.length][2];
    if (Array.isArray(o.at)) { const v = new THREE.Vector3(+o.at[0], 0, +o.at[o.at.length - 1]).applyMatrix4(R.inv); lx = v.x; lz = v.z; land = +(o.land ?? 0); }
    if (what === 'lamp') { R.falls.push({ t: +o.t, what, lamp: true }); return; }
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.022, 0.6), tileM); m.castShadow = true; m.receiveShadow = true; m.visible = false;
    const top = R.ceil - fr.getWorldPosition(new THREE.Vector3()).y - 0.03;
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6).rotateX(Math.PI / 2), holeM); hole.position.set(lx, top + 0.02, lz); hole.visible = false; fr.add(hole);
    fr.add(m);
    R.falls.push({ t: +o.t, what, m, hole, lx, lz, top, land, k, ax: hf(k, 301) * TAU });
  });
}
function interiorUpdate(R, ctx, t, env, dust) {
  const I = R.I, tR = +(I.roll ?? 0), A = +(I.amp ?? 1.1) * DEG, Tr = +(I.period ?? 3.3), stage = ctx.scene;
  const on = env(t) * sstep(tR, tR + 1.4, t);
  // the room rolls (~0.3 Hz) about the floor centre, a slow lateral sway with it; `shift` jolts it sideways
  const ph = 2 * Math.PI * (t - tR) / Tr, roll = A * on * Math.sin(ph), pitch = A * 0.35 * on * Math.sin(ph * 0.83 + 1.3);
  const sh = I.shift != null ? 0.05 * sstep(+I.shift, +I.shift + 0.28, t) : 0;
  _q2.setFromEuler(_e2.set(pitch, 0, roll));
  stage.quaternion.copy(_q2);
  _v2.copy(R.pivot).applyQuaternion(_q2);
  stage.position.set(R.pivot.x - _v2.x + 0.035 * on * Math.sin(ph - 0.6) + sh, R.pivot.y - _v2.y, R.pivot.z - _v2.z + 0.02 * on * Math.sin(ph * 0.83));
  stage.updateMatrixWorld(true);
  // blinds swing as one hanging stack, the lower slats lagging, and clatter against the frame
  const sw = on * 0.05 * Math.sin(ph - 0.9);                                // a few cm at the bottom slat
  for (const b of R.parts.blinds) { const d = R.blindTop - b.p0.y, lag = d * 0.9;
    b.o.position.set(b.p0.x - Math.sin(on * 0.05 * Math.sin(ph - 0.9 - lag)) * d, b.p0.y - (1 - Math.cos(sw)) * d, b.p0.z);
    b.o.rotation.set(b.r0.x, b.r0.y, b.r0.z + on * 0.25 * Math.sin(t * 17 + d * 9) * 0.3); }
  // the lamp rocks on its base; its light moves with it
  let lampFall = null; for (const f of R.falls) if (f.lamp) lampFall = f;
  if (R.parts.lamp.length) {
    const la = lampFall ? t - lampFall.t : -1;
    const wob = on * 0.09 * Math.sin(ph * 1.7 + 0.4) + (t > +(I.rattle ?? 1e9) ? 0.02 * on * Math.sin(t * 23) : 0);
    let tip = 0, dx = 0, dy = 0;
    if (la > 0) { const tf = 0.42; tip = Math.min(1.55, 0.6 * la * la * 9); dx = 0.35 * Math.min(la, tf) / tf; dy = -0.5 * 9.81 * Math.max(0, la - 0.15) ** 2; dy = Math.max(dy, -0.74); }
    _q2.setFromEuler(_e2.set(0, 0, wob + tip));
    for (const L of R.parts.lamp) { _v2.copy(L.p0).sub(R.lampPivot).applyQuaternion(_q2).add(R.lampPivot); _v2.x += dx; _v2.y += dy; L.o.position.copy(_v2); L.o.quaternion.copy(_q2).multiply(L.q0); }
    for (const L of R.parts.lights) if (L.o.parent === R.lampParent) { _v2.copy(L.p0).sub(R.lampPivot).applyQuaternion(_q2).add(R.lampPivot); _v2.x += dx; _v2.y += dy; L.o.position.copy(_v2); }
  }
  // small things rattle from `rattle`, papers creep across the desk with the roll
  const rt = +(I.rattle ?? tR + 0.4), rk = on * sstep(rt, rt + 0.25, t);
  for (const s of R.parts.small) {
    const j = s.o.id;
    if (s.thin) { s.o.position.set(s.p0.x + 0.03 * on * Math.sin(ph - 0.5 + j), s.p0.y, s.p0.z + 0.015 * on * Math.sin(ph * 0.8 + j)); continue; }
    s.o.position.set(s.p0.x + 0.003 * rk * Math.sin(t * 29 + j), s.p0.y + 0.002 * rk * Math.max(0, Math.sin(t * 37 + j * 2)), s.p0.z + 0.003 * rk * Math.sin(t * 31 + j * 3));
    s.o.rotation.set(s.r0.x + 0.02 * rk * Math.sin(t * 27 + j), s.r0.y, s.r0.z + 0.02 * rk * Math.sin(t * 33 + j));
  }
  // falling tiles: a dark hole opens in the ceiling, the tile tumbles down, slaps flat, a puff of dust and grit
  for (const f of R.falls) {
    if (f.lamp) continue;
    const a = t - f.t; f.m.visible = a > -0.4 && a < 1e3; f.hole.visible = a > 0;
    const pre = a < 0 ? Math.max(0, 1 + a / 0.4) : 0;                          // it sags a little before it lets go
    const drop = f.top - f.land - 0.011, tl = Math.sqrt(2 * drop / 9.81);
    let y = f.top - 0.02 * pre, rx = 0.05 * pre, rz = 0;
    if (a > 0) { const tt = Math.min(a, tl); y = f.top - 0.5 * 9.81 * tt * tt; const k = tt / tl; rx = Math.sin(k * Math.PI) * 0.9 * Math.cos(f.ax); rz = Math.sin(k * Math.PI) * 0.7 * Math.sin(f.ax);
      if (a > tl) { const b = a - tl; y = f.land + 0.011 + 0.04 * Math.abs(Math.sin(Math.min(b * 18, Math.PI))) * Math.exp(-b * 8); rx = 0.04 * Math.cos(f.ax) * Math.exp(-b * 6); rz = 0; } }
    f.m.position.set(f.lx + (a > 0 ? 0.25 * Math.min(a, tl) * Math.cos(f.ax) : 0), y, f.lz + (a > 0 ? 0.2 * Math.min(a, tl) * Math.sin(f.ax) : 0));
    f.m.rotation.set(rx, f.ax * 0.3, rz);
    f.hit = a > tl ? a - tl : -1;
  }
  if (dust) {
    for (const f of R.falls) {
      if (f.lamp || f.hit == null || f.hit < 0 || f.hit > 3) continue;
      const w = f.m.getWorldPosition(new THREE.Vector3());
      for (let i = 0; i < 12; i++) {
        const b = f.hit - i * 0.012, ang = hf(i + f.k * 17, 311) * TAU, r = 0.15 + 0.7 * (1 - Math.exp(-b * 2.5)) * (0.5 + hf(i, 312));
        const sz = 0.12 + 0.35 * (1 - Math.exp(-b * 1.5));
        dust.push(w.x + Math.cos(ang) * r, w.y + 0.05 + 0.35 * (1 - Math.exp(-b * 1.2)) * hf(i, 313), w.z + Math.sin(ang) * r, sz, ang + b * 0.3, 0.4 * sstep(0, 0.08, b) * (1 - sstep(0.8, 3, b)), i & 3, R.floor, 0.62, 0, 0, 0, clamp(0.3 + 0.3 * b), 0.8, hf(i, 314));
      }
    }
  }
}
// the town: every block shakes with the ground and sways a little; a share of them pancake at staggered times, each
// with a burst of dust; the dust rises from many roofs while it shakes
function townSetup(TW, ctx) {
  TW.ready = true; TW.blocks = collectBlocks(TW.target);
  let k = 0;
  for (const B of TW.blocks) { B.col = []; for (let i = 0; i < B.n; i++, k++) {
    const h = hf(k, TW.seed + 401), p = B.P[i];
    const big = B.S[i].y > 3;                                                     // skip flat props
    B.col.push(big && h < TW.share ? TW.t0 + TW.lead + hf(k, TW.seed + 402) * TW.span : Infinity);
    p.k = k; } }
}
function townUpdate(TW, t, gm, env) {
  const E = env(t), gx = E * TW.shake * shakeSignal(t, TW.seed + 11, 2.4), gz = E * TW.shake * 0.8 * shakeSignal(t, TW.seed + 12, 2.1);
  for (const B of TW.blocks) {
    for (let i = 0; i < B.n; i++) {
      const k = B.P[i].k, H = B.S[i].y, f = 1.6 + 1.4 * hf(k, TW.seed + 403), sw = E * TW.swayK * Math.min(1, H / 12) * Math.sin(2 * Math.PI * f * t + hf(k, TW.seed + 404) * 6.28);
      const tc = B.col[i]; let hs = 1, tx = 0, tz = 0, spread = 1, dy = 0;
      if (t > tc) { const a = clamp((t - tc) / 0.85), e = a * a; hs = 1 - 0.74 * e; spread = 1 + 0.1 * e;
        tx = (hf(k, TW.seed + 405) - 0.5) * 0.16 * e; tz = (hf(k, TW.seed + 406) - 0.5) * 0.16 * e; }
      setBlock(B, i, gm.x * 0.9 + gx, dy, gm.z * 0.9 + gz, sw, sw * 0.4 * (hf(k, TW.seed + 407) - 0.5), hs, tx, tz, spread);
    }
    B.im.instanceMatrix.needsUpdate = true;
  }
}
function townDust(TW, t, dust, env) {
  const E = env(t); let n = 0;
  for (const B of TW.blocks) for (let i = 0; i < B.n; i++) {
    const tc = B.col[i], p = B.P[i], s = B.S[i], k = p.k;
    if (t > tc) {                                                                 // a collapse: a burst rolling out at street level
      const a = t - tc - 0.25; if (a <= 0 || a > 7) continue;
      for (let j = 0; j < 12 && n < TW.maxPuffs; j++, n++) {
        const ang = hf(k * 13 + j, 411) * TAU, R0 = 0.5 * Math.max(s.x, s.z), r = R0 * (0.6 + 0.5 * hf(j, 412)) + (2.5 + 3 * hf(k + j, 413)) * (1 - Math.exp(-a / 1.3));
        const sz = (2.6 + 3 * hf(k + j, 414)) * (1 + 1.6 * (1 - Math.exp(-a / 1.6)));
        const y = p.y + sz * 0.35 + (0.5 + 7 * hf(j, 415)) * (1 - Math.exp(-a / 2));
        dust.push(p.x + Math.cos(ang) * r + TW.wx * a * 0.4, y, p.z + Math.sin(ang) * r + TW.wz * a * 0.4, sz, ang + a * 0.1, 0.62 * sstep(0, 0.2, a) * (1 - sstep(2.5, 7, a)), j & 3, p.y, 0.55, 0, 0, 0, clamp(0.12 + 0.12 * a), clamp(0.45 + 0.5 * hf(j, 416)), hf(k + j, 417));
      }
    } else if (E > 0.25 && hf(k, TW.seed + 420) < 0.3) {                           // shaken dust off roofs and facades
      const a = ((t * 0.35 + hf(k, 421)) % 1), sz = 1.2 + 2 * a;
      if (n >= TW.maxPuffs) continue; n++;
      dust.push(p.x + (hf(k, 422) - 0.5) * s.x, p.y + s.y * (0.5 + 0.6 * a), p.z + (hf(k, 423) - 0.5) * s.z, sz, a * 3, 0.2 * E * Math.sin(a * Math.PI), k & 3, p.y, 0.55, 0, 0, 0, 0.6, 0.8, hf(k, 424));
    }
  }
}
// the city: every tower sways in its first mode, period by height (4..7 s), each out of phase with its neighbours
function cityUpdate(CT, t, drive) {
  const [P0, P1] = CT.period;
  for (const B of CT.blocks) {
    for (let i = 0; i < B.n; i++) {
      const H = B.S[i].y, k = B.P[i].k ?? i, T = lerp(P0, P1, clamp((H - 30) / 170)), A = CT.sway * Math.pow(clamp(H / CT.Hmax), 1.5);
      const ph = hf(k, CT.seed + 501) * 6.28, dir = CT.dir + (hf(k, CT.seed + 502) - 0.5) * 1.1;
      const d = A * drive * Math.sin(2 * Math.PI * t / T + ph);
      setBlock(B, i, 0, 0, 0, d * Math.cos(dir), d * Math.sin(dir), 1, 0, 0, 1);
    }
    B.im.instanceMatrix.needsUpdate = true;
  }
}

// ── the tower ───────────────────────────────────────────────────────────────────────────────────────────────────
function buildTower(ctx, o) {
  const g = new THREE.Group(); g.name = 'fx.quake.tower';
  const H = o.H, Wt = 32, P = 7;                              // shaft height above the podium, width, podium height
  const U = { uSway: { value: 0 }, uSway2: { value: 0 }, uH: { value: H + P }, uBase: { value: P } };
  const bend = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSway; uniform float uSway2; uniform float uH; uniform float uBase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 wq = modelMatrix * vec4(transformed, 1.0);
        float hh = clamp((position.y + uOffY - uBase) / (uH - uBase), 0.0, 1.0);
        float m1 = 1.0 - cos(1.5708 * hh), m2 = sin(4.712 * hh) * hh;
        transformed.x += uSway * m1 + uSway2 * m2; }`);
  };
  const mk = (geo, mat, offY, key) => {
    const m = new THREE.Mesh(geo, mat);
    const off = { uOffY: { value: offY } };
    const patchV = (sh) => { Object.assign(sh.uniforms, off); bend(sh); sh.vertexShader = sh.vertexShader.replace('uniform float uSway;', 'uniform float uOffY; uniform float uSway;'); };
    mat.onBeforeCompile = patchV; mat.customProgramCacheKey = () => 'fx.quake.bend.' + key;
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    dm.onBeforeCompile = patchV; dm.customProgramCacheKey = () => 'fx.quake.bendD.' + key;
    m.customDepthMaterial = dm;
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const gt = glassTex(ctx, o.night > 0.5);
  const tex = gt.clone(); tex.repeat.set(Wt / 24, H / 57.6); tex.needsUpdate = true; tex.userData.keep = false;
  const shaftMat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.18, metalness: 0.55, emissive: o.night > 0.5 ? 0xffffff : 0x000000, emissiveMap: o.night > 0.5 ? tex : null, emissiveIntensity: 0.6 * o.night });
  const shaftGeo = new THREE.BoxGeometry(Wt, H, Wt, 1, 60, 1); shaftGeo.translate(0, H / 2, 0);
  const shaft = mk(shaftGeo, shaftMat, P, 'shaft'); shaft.position.y = P; shaft.name = 'fx.quake.shaft';
  ctx.patch(shaftMat);
  // corner fins and the crown
  const finMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.4, metalness: 0.6 });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const fg = new THREE.BoxGeometry(1.4, H + 6, 1.4, 1, 60, 1); fg.translate(sx * Wt / 2, (H + 6) / 2, sz * Wt / 2);
    const fm = finMat.clone(); const f = mk(fg, fm, P, 'fin'); f.position.y = P; g.add(f); ctx.patch(fm);
  }
  const crownGeo = new THREE.BoxGeometry(Wt * 0.7, 9, Wt * 0.7, 1, 2, 1); crownGeo.translate(0, H + 4.5, 0);
  const cm = finMat.clone(); const crown = mk(crownGeo, cm, P, 'crown'); crown.position.y = P; g.add(crown); ctx.patch(cm);
  const mastGeo = new THREE.CylinderGeometry(0.5, 0.9, 26, 8, 4); mastGeo.translate(0, H + 9 + 13, 0);
  const mm = finMat.clone(); const mast = mk(mastGeo, mm, P, 'mast'); mast.position.y = P; g.add(mast); ctx.patch(mm);
  const podium = new THREE.Mesh(new THREE.BoxGeometry(Wt + 8, P, Wt + 8), stdMat(ctx, { color: 0x3a434b, roughness: 0.35, metalness: 0.4 }));   // a glass lobby
  podium.position.y = P / 2; podium.castShadow = podium.receiveShadow = true;
  g.add(shaft, podium);
  return { g, U, H: H + P, W: Wt };
}

export async function build(kind, item, ctx) {
  const p = item.params || {};
  const at = item.at || [0, 0];
  const G = ctx.ground;
  const seed = (item.seed ?? 3) | 0;
  const mode = ['house', 'tower', 'compare', 'town'].includes(p.mode) ? p.mode : 'compare';
  const building = p.building === 'concrete' ? 'concrete' : 'brick';
  const layout = p.layout === 'side' ? 'side' : 'depth';
  const behind = +(p.behind ?? 600);
  const t0 = +(p.start ?? 1), hold = +(p.hold ?? 5), mag = clamp(+(p.magnitude ?? 9), 5, 9.8);
  const amp = 0.16 * Math.pow(10, (mag - 9) * 0.5);              // ground displacement scale (m)
  const tc = t0 + +(p.collapse ?? 2.2);
  const swayA = +(p.sway ?? 2.6), camK = clamp(+(p.camera ?? 0), 0, 2);   // own camera shake: opt-in (use camera.shake)
  const gap = +(p.gap ?? 60);
  const root = new THREE.Group(); root.name = 'fx.quake';
  const gy0 = G.height(at[0], at[1]);
  root.position.set(at[0], gy0, at[1]);
  const hd = (item.heading ?? 0) * DEG;
  const inner = new THREE.Group(); inner.rotation.y = -hd; root.add(inner);
  // local placement: x = right, z = towards the viewer side (south when heading 0)
  const placeAt = (lx, lz) => { const x = at[0] + lx * Math.cos(hd) - lz * Math.sin(hd), z = at[1] + lx * Math.sin(hd) + lz * Math.cos(hd); return G.height(x, z) - gy0; };
  let house = null, tower = null;
  if (mode !== 'tower' && mode !== 'town') {
    house = building === 'concrete' ? buildConcrete(ctx, seed, p) : buildHouse(ctx, seed, p);
    const hx = mode === 'compare' ? (layout === 'side' ? -gap / 2 : 0) : 0, hz = mode === 'compare' && layout === 'depth' ? 0 : 0;
    house.g.position.set(hx, placeAt(hx, hz), hz);
    inner.add(house.g);
  }
  if (mode !== 'house' && mode !== 'town') {
    tower = buildTower(ctx, { H: +(p.towerHeight ?? 200), night: clamp(+(p.night ?? 0)) });
    const tx = mode === 'compare' ? (layout === 'side' ? gap / 2 + 20 : 0) : 0, tz = mode === 'compare' && layout === 'depth' ? -behind : 0;
    tower.g.position.set(tx, placeAt(tx, tz), tz);
    if (mode === 'compare' && layout === 'depth') {
      // scenery behind the subject: parented to the stage so the camera frames the house, not the whole 600 m
      tower.holder = new THREE.Group(); tower.holder.position.copy(root.position); tower.holder.rotation.y = -hd;
      tower.holder.add(tower.g); ctx.scene.add(tower.holder);
    } else inner.add(tower.g);
  }
  // dust (Q4): a ground surge of billows bursting out from under the falling walls, a rubble plume boiling up over the
  // footprint, smaller billows riding the outer rims of both (the cauliflower hierarchy), a late haze drifting
  // downwind; grit and chips fly out ahead of it. All of it churns on curl noise; the side away from the sun sits in
  // the cloud's own shadow (occ), fresh billows are crisp and turn to wisps as they age (soft).
  // brick and mortar dust: tan-grey, never white (puff light has no 1/pi like the PBR materials: keep tint x albedo ~0.3)
  const dust = house ? makePuffs(ctx, { count: 780, tint: house.concrete ? [0.58, 0.57, 0.54] : [0.56, 0.49, 0.41], near: 2.5, groundFade: 0.16, softK: 0.3 }) : null;
  const dSpan = house && house.concrete ? house.NS * 0.72 : 1.35;              // the pancake takes longer than the brick house
  const roofFail = !!house && !house.concrete && p.failure === 'roof';
  const grit = house ? makeGrit(ctx, { count: 420, maxPx: 5, minPx: 1.4 }) : null;
  if (dust) root.add(dust.mesh, grit.mesh);
  const NSU = 112, NPL = 60, NHZ = 16, NGR = 400;
  const _cf = new THREE.Vector3(), P3 = [0, 0, 0], CU = [0, 0, 0], CK = [0, 0, 0];
  const debrisN = house && !house.concrete ? 130 : 90;                           // Q11: more flying bricks
  const debris = house ? new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.12, 0.12), stdMat(ctx, { color: house.concrete ? 0x9d9a93 : 0x9a5a44, roughness: 0.9 }), debrisN) : null;
  if (debris) { debris.castShadow = true; debris.userData.noQA = true; inner.add(debris); }
  // Q11: the rubble heap of a brick house: loose bricks and broken courses piling up over the footprint, the bottom first
  const NHP = 420, heap = house && !house.concrete && p.failure !== 'roof' ? new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.12, 0.12), stdMat(ctx, { color: 0x8e5442, roughness: 0.95 }), NHP) : null;
  if (heap) { heap.castShadow = true; heap.receiveShadow = true; heap.userData.noQA = true; heap.frustumCulled = false; inner.add(heap); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1);
  const wind = ctx.wind || { x: 0, z: 0 };
  const TW = mode === 'town' ? { target: null, ready: false, seed, t0, lead: +(p.collapse_lead ?? 0.4), span: +(p.collapse_span ?? 1.8), share: clamp(+(p.collapse_share ?? 0.3), 0, 0.9), swayK: +(p.town_sway ?? 0.25), shake: +(p.town_shake ?? 0.1), maxPuffs: 900, wx: wind.x * 0.1, wz: wind.z * 0.1, spec: p.target ?? 'structures:0' } : null;
  const CS = p.city ? (typeof p.city === 'object' ? p.city : {}) : null;
  const CT = CS ? { target: null, ready: false, seed, spec: CS.target ?? 'structures:0', period: Array.isArray(CS.period) ? CS.period.map(Number) : [4, 7], sway: +(CS.sway ?? p.sway ?? 6) * +(CS.exaggerate ?? 1), dir: +(CS.dir ?? 20) * DEG, Hmax: 1 } : null;
  const IR = p.interior ? interiorRig(ctx, p.interior, seed) : null;
  const sdust = TW || IR ? makePuffs(ctx, { count: TW ? 900 : 90, tint: TW ? [0.6, 0.55, 0.48] : [0.78, 0.76, 0.72], near: 0.3, groundFade: 0.12, softK: 0.3 }) : null;
  if (sdust) ctx.scene.add(sdust.mesh);
  const _off = new THREE.Vector3();

  // ground motion at t
  const env = (t) => quakeEnvelope(t, t0, 1.0, hold, 2.2);
  const gm = { x: 0, z: 0, rack: 0 };
  function motion(t) {
    const E = env(t) * amp;
    gm.x = E * shakeSignal(t, seed + 1, 2.4);
    gm.z = E * shakeSignal(t, seed + 2, 2.1) * 0.8;
    gm.rack = E * 0.9 * shakeSignal(t - 0.08, seed + 3, 2.4);   // the top lags a little
  }
  // tower response: first-mode sway lagging the ground (T ~ 5 s), ringing on after the shaking with light damping
  function towerSway(t) {
    const T = 5.2, w = 2 * Math.PI / T;
    const drive = quakeEnvelope(t, t0 + 0.8, 3.2, hold, 6.5);    // builds up slower than the ground, rings longer
    const a1 = swayA * drive * Math.sin(w * (t - t0) + 0.3 * fbm1(t * 0.3, seed + 7));
    const a2 = swayA * 0.12 * env(t) * Math.sin(w * 2.9 * (t - t0) + 1.1);
    return [a1, a2];
  }

  function update(t, clock, camera) {
    syncEnv(ctx);
    motion(t);
    // Q11 scene rigs: find their targets once the whole scene exists (structures are built after objects)
    if (TW && !TW.ready) { TW.target = findTarget(ctx, TW.spec); if (TW.target) townSetup(TW, ctx); }
    if (CT && !CT.ready) { CT.target = findTarget(ctx, CT.spec); if (CT.target) { CT.ready = true; CT.blocks = collectBlocks(CT.target); let k = 0, hm = 1; for (const B of CT.blocks) for (let i = 0; i < B.n; i++) { B.P[i].k = k++; hm = Math.max(hm, B.S[i].y); } CT.Hmax = hm; } }
    if (IR && !IR.ready) { IR.target = findTarget(ctx, IR.I.target ?? 'structures:0'); if (IR.target) interiorSetup(IR, ctx); }
    if (sdust) sdust.begin();
    if (TW && TW.ready) { townUpdate(TW, t, gm, env); if (sdust) townDust(TW, t, sdust, env); }
    if (CT && CT.ready) cityUpdate(CT, t, quakeEnvelope(t, t0 + 0.8, 3.2, hold, 6.5));
    if (IR && IR.ready) interiorUpdate(IR, ctx, t, env, sdust);
    if (sdust) sdust.end(camera);
    if (house) {
      if (house.concrete) animateConcrete(house, t, tc, seed, gm); else animateHouse(house, t, tc, seed, gm, roofFail ? 'roof' : 'quake');
      // dust (see the build): positions in the house frame -> the root frame (world axes), + wind drift + churn
      dust.begin();
      const hx = house.g.position.x, hy = house.g.position.y, hz = house.g.position.z;
      const sun = U.uSunDir.value, ch = Math.cos(-hd), sh = Math.sin(-hd);
      const toRoot = (x, y, z, o) => { o[0] = x * ch + z * sh; o[1] = y; o[2] = -x * sh + z * ch; return o; };
      let cfx = 0, cfy = 0, cfz = -1;
      if (camera) { camera.getWorldDirection(_cf); cfx = _cf.x; cfy = _cf.y; cfz = _cf.z; }
      const wx = ctx.wind ? ctx.wind.x : 0, wz = ctx.wind ? ctx.wind.z : 0;
      const since = Math.max(0, t - tc);
      toRoot(hx, hy + 2.8 + 0.5 * Math.min(since, 4), hz, CK);
      const cX = CK[0] + wx * 0.45 * since, cY = CK[1], cZ = CK[2] + wz * 0.45 * since;
      // sun visibility: billows on the far side of the cloud from the sun, and low down, sit in its shadow
      const occAt = (X, Y, Z, k0) => { const dx = X - cX, dy = Y - cY, dz = Z - cZ, L = Math.hypot(dx, dy, dz) || 1;
        return clamp(k0 + 0.58 * sstep(-0.75, 0.7, (dx * sun.x + dy * sun.y + dz * sun.z) / L) + 0.12 * clamp((Y - hy) / 7)); };
      // screen-space roll of a billow moving along (dx, dz) (world): axis = up x d, seen from the camera
      const rollK = (dx, dz) => dx * cfz - dz * cfx;               // (up x d) . (-camera forward)
      const kid = (X, Y, Z, size, a, up, j, alpha, soft, occ, cell, spin) => {
        // a smaller billow on the parent's outer rim (direction: azimuth a in the root frame, elevation `up`)
        const ce = Math.cos(up), d = size * (0.52 + 0.16 * hf(j, 211));
        const kx = X + Math.cos(a) * ce * d, ky = Y + Math.sin(up) * d, kz = Z + Math.sin(a) * ce * d;
        const ks = size * (0.44 + 0.16 * hf(j, 212));
        curl3(kx * 0.5 + t * 0.2, ky * 0.5, kz * 0.5, 23 + (j & 7), CU);
        dust.push(kx + CU[0] * ks * 0.2, Math.max(ky + CU[1] * ks * 0.2, hy + ks * 0.5), kz + CU[2] * ks * 0.2, ks, spin * 1.3 + hf(j, 213) * 6.28, alpha * 0.95,
          (cell + 1 + j) & 3, hy, 0.56 + 0.08 * hf(j, 214), 0, 0, 0, clamp(soft + 0.06), clamp(occ + 0.1), hf(j, 215));
      };
      // 1) ground surge: out from under the walls as they slam down, low, rolling, decelerating like a gravity current
      for (let i = 0; i < (roofFail ? 0 : NSU); i++) {
        const tb = tc + 0.42 + dSpan * Math.pow(hf(i, 101), 0.8), age = t - tb;
        if (age <= 0) continue;
        const a = hf(i, 102) * 6.2832, ca = Math.cos(a), sa = Math.sin(a);
        const rim = 0.78 + 0.22 * hf(i, 103);
        const V0 = 3.2 + 3.6 * hf(i, 104), tau = 0.8 + 0.6 * hf(i, 105);
        const out = V0 * tau * (1 - Math.exp(-age / tau)) + 0.35 * age;
        const size = (0.75 + 0.6 * hf(i, 106)) * (1 + 1.5 * (1 - Math.exp(-age / 1.3))) + 0.22 * age;
        toRoot(ca * (house.W * 0.5 * rim + out), size * 0.62 + 0.3 * age * (0.5 + hf(i, 107)), sa * (house.D * 0.5 * rim + out), P3);
        const drift = Math.max(0, age - 0.6) * 0.45;
        let X = hx * ch + hz * sh + P3[0] + wx * drift, Y = hy + P3[1], Z = -hx * sh + hz * ch + P3[2] + wz * drift;
        curl3(X * 0.2 + t * 0.1, Y * 0.2, Z * 0.2 - t * 0.07, 11, CU);
        const tk = 0.25 + 0.3 * Math.min(age, 3);
        X += CU[0] * tk; Z += CU[2] * tk; Y = Math.max(Y + CU[1] * tk * 0.5, hy + size * 0.45);
        const alpha = 0.74 * sstep(0, 0.14, age) * (1 - 0.62 * sstep(1.2, 4.6, age));
        const soft = clamp(0.12 + 0.18 * age), occ = occAt(X, Y, Z, 0.36);
        const dX = ca * ch + sa * sh, dZ = -ca * sh + sa * ch;
        const spin = hf(i, 108) * 6.28 + rollK(dX, dZ) * 0.5 * out / Math.max(size, 0.5);
        dust.push(X, Y, Z, size, spin, alpha, i & 3, hy, 0.5 + 0.1 * hf(i, 109), 0, 0, 0, soft, occ, hf(i, 110));
        const aw = Math.atan2(dZ, dX);
        for (let k = 0; k < 2; k++) kid(X, Y, Z, size, aw + (hf(i * 4 + k, 121) - 0.5) * 1.8, 0.25 + 0.75 * hf(i * 4 + k, 122), i * 4 + k, alpha, soft, occ, i & 3, spin);
      }
      // 2) the rubble plume: air pushed up out of the footprint, boiling into a mushrooming mass, then drifting
      //    (kept low: in q03 the tower behind has to stay readable)
      for (let i = 0; i < NPL; i++) {
        const tb = tc + 0.3 + dSpan * 1.1 * hf(i, 131), age = t - tb;
        if (age <= 0) continue;
        const Vr = 1.2 + 1.3 * hf(i, 134), tr = 1.0 + 0.8 * hf(i, 135);
        const rise = Vr * tr * (1 - Math.exp(-age / tr)) + 0.25 * age, spread = 1 + 0.55 * (1 - Math.exp(-age / 1.6));
        const size = (0.95 + 0.75 * hf(i, 136)) * (1 + 0.95 * (1 - Math.exp(-age / 1.8))) + 0.15 * age;
        toRoot((hf(i, 132) - 0.5) * house.W * 0.8 * spread, (roofFail ? house.H - 1.2 : 0.6) + rise, (hf(i, 133) - 0.5) * house.D * 0.8 * spread, P3);
        const drift = Math.max(0, age - 0.3) * 0.6;
        let X = hx * ch + hz * sh + P3[0] + wx * drift, Y = hy + P3[1], Z = -hx * sh + hz * ch + P3[2] + wz * drift;
        curl3(X * 0.18 - t * 0.08, Y * 0.18 - t * 0.12, Z * 0.18, 13, CU);
        const tk = 0.3 + 0.35 * Math.min(age, 3);
        X += CU[0] * tk; Y += CU[1] * tk * 0.6; Z += CU[2] * tk;
        const alpha = 0.72 * sstep(0, 0.22, age) * (1 - 0.66 * sstep(1.8, 5.5, age));
        const soft = clamp(0.12 + 0.15 * age), occ = occAt(X, Y, Z, 0.34);
        const spin = hf(i, 137) * 6.28 + (hf(i, 138) - 0.5) * 0.5 * age;
        dust.push(X, Y, Z, size, spin, alpha, i & 3, hy, 0.52 + 0.1 * hf(i, 139), 0, 0, 0, soft, occ, hf(i, 140));
        for (let k = 0; k < 3; k++) kid(X, Y, Z, size, hf(i * 4 + k, 141) * 6.28, 0.2 + 0.8 * hf(i * 4 + k, 142), 900 + i * 4 + k, alpha, soft, occ, i & 3, spin);
      }
      // 3) the late haze: big, thin, wispy, drifting downwind (the settling dust)
      for (let i = 0; i < NHZ; i++) {
        const tb = tc + 1.0 + 1.8 * hf(i, 151), age = t - tb;
        if (age <= 0) continue;
        const a = hf(i, 152) * 6.2832, rr = (3 + 5 * hf(i, 153)) * (1 + 0.15 * age);
        toRoot(Math.cos(a) * rr, 1.2 + 2 * hf(i, 154) + 0.25 * age, Math.sin(a) * rr, P3);
        const X = hx * ch + hz * sh + P3[0] + wx * age * 0.8, Y = hy + P3[1], Z = -hx * sh + hz * ch + P3[2] + wz * age * 0.8;
        dust.push(X, Y, Z, 4.5 + 2.5 * hf(i, 155) + 0.6 * age, hf(i, 156) * 6.28 + 0.05 * age, 0.16 * sstep(0, 1.2, age) * (1 - sstep(4, 8, age)), i & 3, hy, 0.6, 0, 0, 0, 0.85, 0.9, hf(i, 157));
      }
      dust.end(camera);
      // grit and chips: ballistic, a little drag, they land and lie in the grass
      grit.begin();
      for (let i = 0; i < (roofFail ? 0 : NGR); i++) {
        const tb = tc + 0.15 + 1.3 * hf(i, 171), tau = t - tb;
        if (tau < 0) continue;
        const a = hf(i, 172) * 6.2832, sp = 2.5 + 7 * Math.pow(hf(i, 173), 1.5), vy = 0.8 + 4.5 * hf(i, 174), y0 = 0.4 + 4.5 * hf(i, 175);
        const land = (vy + Math.sqrt(vy * vy + 2 * 9.81 * y0)) / 9.81;
        if (tau > land + 0.6) continue;
        const tt = Math.min(tau, land), y = tau >= land ? 0.03 : y0 + vy * tt - 4.9 * tt * tt, d = sp * (1 - Math.exp(-tt * 1.2)) / 1.2;
        toRoot(hx + Math.cos(a) * (house.W * 0.45 + d), 0, hz + Math.sin(a) * (house.D * 0.45 + d), P3);
        const brick = !house.concrete && hf(i, 176) < 0.55;
        grit.push(P3[0], hy + y, P3[2], brick ? 0.24 : 0.3, brick ? 0.12 : 0.28, brick ? 0.09 : 0.25, 0.03 + 0.07 * hf(i, 177));
      }
      grit.end();
      // flying bricks
      for (let i = 0; i < debrisN; i++) {
        if (roofFail) { m4.makeScale(0, 0, 0); debris.setMatrixAt(i, m4); continue; }
        const tb = tc + 0.1 + hf(i, 61) * (debrisN > 100 ? 1.7 : 1.1), tau = Math.max(0, t - tb);
        const ang = hf(i, 62) * Math.PI * 2, sp = 1.5 + hf(i, 63) * 4, vy = debrisN > 100 ? 0.3 + hf(i, 64) * 1.8 : 1 + hf(i, 64) * 3.5;
        const y0 = 1 + hf(i, 65) * 5;
        const tl = tau; let y = y0 + vy * tl - 4.9 * tl * tl;
        const landT = (vy + Math.sqrt(vy * vy + 19.6 * (y0 - 0.06))) / 9.81;
        const tt = Math.min(tau, landT);
        y = tau >= landT ? 0.06 : y;
        const d = sp * tt;
        v3.set(house.g.position.x + Math.cos(ang) * (house.W * 0.45 + d), house.g.position.y + (t < tb ? -5 : y), house.g.position.z + Math.sin(ang) * (house.D * 0.45 + d));
        e.set(tt * 6 * hf(i, 66), tt * 4, tt * 5 * hf(i, 67)); q.setFromEuler(e);
        s3.setScalar((house.concrete ? 1.6 + hf(i, 68) * 2.6 : 0.8 + hf(i, 68) * 1.8) * sstep(tb, tb + 0.15, t));
        m4.compose(v3, q, s3); debris.setMatrixAt(i, m4);
      }
      debris.instanceMatrix.needsUpdate = true;
      if (heap) {
        for (let i = 0; i < NHP; i++) {
          const u = hf(i, 181) * 2 - 1, w = hf(i, 182) * 2 - 1, prof = Math.max(0, (1 - u * u * 0.8) * (1 - w * w * 0.8));
          const yy = 0.06 + 1.5 * prof * Math.pow(hf(i, 183), 0.7), ta = tc + 0.55 + 1.3 * (yy / 1.6) + 0.25 * hf(i, 184);
          const k = sstep(ta, ta + 0.2, t);
          if (k <= 0) { m4.makeScale(0, 0, 0); heap.setMatrixAt(i, m4); continue; }
          v3.set(house.g.position.x + u * house.W * 0.6, house.g.position.y + yy - 0.25 * (1 - k), house.g.position.z + w * house.D * 0.6);
          e.set(hf(i, 185) * 6.28, hf(i, 186) * 6.28, hf(i, 187) * 6.28); q.setFromEuler(e);
          s3.setScalar((1 + 1.4 * hf(i, 188)) * k); m4.compose(v3, q, s3); heap.setMatrixAt(i, m4);
        }
        heap.instanceMatrix.needsUpdate = true;
      }
    }
    if (tower) {
      const [a1, a2] = towerSway(t);
      tower.U.uSway.value = a1; tower.U.uSway2.value = a2;
      tower.g.position.x = (mode === 'compare' ? (layout === 'side' ? gap / 2 + 20 : 0) : 0) + gm.x * 0.6;
      tower.g.position.z = (mode === 'compare' && layout === 'depth' ? -behind : 0) + gm.z * 0.6;
    }
    // camera shake: jolts at the ground's frequencies + a slower lurch, scaled by the envelope
    if (camera && camK > 0) {
      const E = env(t) * camK * clamp(amp / 0.16, 0.2, 3);
      if (E > 1e-4) {
        const jx = fbm1(t * 7.3, seed + 31) * 0.07 + fbm1(t * 1.9, seed + 32) * 0.1;
        const jy = fbm1(t * 8.1, seed + 33) * 0.05 + fbm1(t * 2.3, seed + 34) * 0.05;
        const rp = fbm1(t * 6.7, seed + 35) * 0.45 + fbm1(t * 1.7, seed + 36) * 0.4;
        const rr = fbm1(t * 5.9, seed + 37) * 0.5 + fbm1(t * 1.3, seed + 38) * 0.5;
        camera.updateMatrixWorld();
        const R = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), Up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        camera.position.addScaledVector(R, jx * E).addScaledVector(Up, jy * E);
        camera.rotateX(rp * DEG * E); camera.rotateZ(rr * DEG * E);
        camera.updateMatrixWorld();
      }
    }
  }
  update(0, 0, null);
  const H = tower ? tower.H : house ? house.H + house.RIDGE : 20;
  // camera subject: the side layout frames both; depth frames the house with the tower rising behind it
  const radius = mode === 'town' ? 40 : mode === 'compare' ? (layout === 'side' ? gap / 2 + 40 : 10) : tower ? 30 : house && house.concrete ? 11 : 7;
  const height = mode === 'town' ? 15 : mode === 'house' || (mode === 'compare' && layout === 'depth') ? (house && house.concrete ? 14 : 10) : H;
  return {
    root, radius, height, snapped: true, update,
    anchors: { house: house ? house.g.position.clone() : null, tower: tower ? tower.g.position.clone() : null, collapse: tc },
  };
}
