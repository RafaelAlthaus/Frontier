// w_avalanche.js — fx.avalanche.
//   mode 'slope'    a 32-degree snow slope (own mesh, spruce on the flanks for scale): at t_release a crown fracture
//                   opens across the top, the slab breaks into blocks and slides, and a powder cloud rolls down,
//                   accelerating and billowing up, with the dense flow churning at its base. `at` = the foot of the
//                   slope; the avalanche runs along `heading`.
//   mode 'cutaway'  a cross-section of avalanche debris: dense layered snow packed round a buried mannequin (curled,
//                   one arm at the face), the air pocket in front of the face, a depth marker from the surface down to
//                   the face (depth m), and a clock face counting the minutes (clock_rate min per s, 15-min mark red).
//   Q11 (26 Sep): the slope is ground (merged into ctx.ground), ski `tracks`, `crown_at`, a smooth crown + cornice until
//   t_release, a fracture racing across in crack_dur, slab plates that slide / tumble, a powder cloud growing out of
//   the slab, `whumpf`. The cutaway keeps every limb in the plane of the cut (no stumps), `pose` curled|head_down, a
//   real air-pocket hollow with pores, `breath` puffs, an `ice_mask` crust with a `sparkle`, a debris field round it.
// Everything is a pure function of t.
import * as THREE from 'three';
import { prm, num, Puffs, stdMat, coniferGeo, mannequin, rng, clamp, lerp, sstep, fbm1, vnoise, TAU, DEG, U } from './w_common.js';
import { curl3 } from './billow.js';
import { mountainSkin, skinField } from '../nature/skin.js';

export const CATALOG = {
  'fx.avalanche': {
    desc: 'avalanche. mode "slope": a 32-deg snow slope whose foot is `at`, running along `heading`: crown fracture, slab blocks, powder cloud rolling down (t_release s). mode "cutaway": cross-section of dense avalanche snow with a buried mannequin, air pocket, depth marker (depth m) and a clock (clock_rate minutes per second, the 15-min mark in red). Pair with biome snowfield/mountains.',
    actions: ['slope', 'cutaway'],
    params: { mode: 'slope', length: 620, width: 420, angle: 32, depth: 1.5, clock_rate: 1.5, trees: 900 },
    doc: {
      t_release: 's (slope): the crack; the fracture races across the slope in crack_dur s, then the slab slides and breaks up',
      crown_at: '[x, z] world (slope): the crown line passes here (e.g. just uphill of YOU) and the crack starts here; default the V1 crown',
      slab: 'm (slope, 60): slab length down the fall line', slab_width: 'm (slope, width/2)', slab_depth: 'm (slope, 1.2)', crack_dur: 's (slope, 0.2)',
      tracks: 'slope: ski tracks conformed to the snow: [[x, z], ...] | {path, start, speed (m/s, 10), from (m), width (0.8)} | a list of either; with start the track grows along the path at speed from t = start',
      cornice: '0..1 (slope, 1): the faint cornice along the crest', ground: 'slope: false = do not merge the slope into ctx.ground',
      whumpf: 'slope: {t, at: [x, z]} a thump in the snowpack: a ring of snow dust puffs out of it at t',
      sastrugi: 'slope: 0..2 (1) wind-packed ripples / sastrugi normal map on the snow (raking light relief); 0 = off',
      debris_clear: 'slope: [[x, z, r], ...] world spots kept clear of the runout debris (a dig site); debris: 0..2 (1) its amount (0 = none)',
      pose: 'cutaway: curled (default, on its side facing the cut) | head_down ("which way is up": head 30 deg below the feet, one arm up)', tilt: 'cutaway: deg, overrides the pose\'s turn in the plane of the cut',
      breath: 'cutaway: exhale times [t, ...] | {at, every} | a period s: a vapour puff out of the mouth into the air pocket', pocket: 'cutaway: 0..2 (1) air-pocket size',
      ice_mask: 'cutaway: t | {t, dur (2.5), sparkle (t)}: a glassy frost crust grows over the face and the pocket walls glaze; crystal glints at sparkle',
      debris: 'cutaway: 0..2 (1) avalanche debris lumps and chunks round the block', ruler: 'cutaway: 0 hides the depth ruler', clock: 'cutaway: 0 hides the clock',
      times: 'every time is on the FX clock = the world clock (spec.clock offset + rate * t), like t_release',
    },
    footprint: [6, 4], height: 3, tags: ['disaster', 'snow', 'avalanche', 'fx'], section: 'objects', contact: false,
  },
};

const matX = (ctx, o) => { const m = new THREE.MeshStandardMaterial(o); return (ctx.patch && ctx.patch(m)) || m; };   // a standard material with any options (maps, transparency)
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t;
}
// the cut face: compacted layers (bands of slightly different whites and blues), grain, ice lenses; denser lower down
function strataTex(seed) {
  const R = rng(seed);
  return canvasTex(1024, 1024, (g, W, H) => {
    const img = g.createImageData(W, H), d = img.data;
    const bands = []; let y = 0; while (y < H) { const h = 18 + R() * 90; bands.push([y, h, 0.88 + R() * 0.1, R() < 0.18]); y += h; }
    for (let j = 0; j < H; j++) {
      const b = bands.find((q) => j >= q[0] && j < q[0] + q[1]) || bands[0];
      const deep = j / H;
      for (let i = 0; i < W; i++) {
        const n = (vnoise(i * 0.05 + j * 0.013, 3) + vnoise(i * 0.21, j * 0.1 + 7) * 0.5) * 0.03;
        const grain = (R() - 0.5) * 0.05;
        let v = b[2] - deep * 0.1 + n + grain;
        const edge = Math.min(j - b[0], b[0] + b[1] - j);
        if (edge < 2.5) v -= 0.06;                                   // thin crust lines between layers
        if (b[3]) v += 0.04;                                          // ice lens
        const k = (j * W + i) * 4;
        d[k] = Math.round(clamp(v * 0.9) * 255); d[k + 1] = Math.round(clamp(v * 0.95) * 255); d[k + 2] = Math.round(clamp(v * 1.02 + 0.03) * 255); d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // pores: the air spaces between the grains (the oxygen a buried person breathes), a few mm across
    for (let i = 0; i < 9000; i++) { const x = R() * W, y = R() * H, r = 0.5 + R() * R() * 2.4; g.fillStyle = `rgba(${70 + R() * 50 | 0},${95 + R() * 50 | 0},${135 + R() * 50 | 0},${0.25 + R() * 0.4})`; g.beginPath(); g.ellipse(x, y, r * (0.6 + R() * 0.8), r, R() * 3, 0, TAU); g.fill(); }
  });
}
function labelTex(text, o = {}) {
  return canvasTex(o.w ?? 512, o.h ?? 160, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.font = `${o.weight ?? 900} ${o.size ?? 104}px "Inter Display", "Inter", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = o.stroke ?? 10; g.strokeStyle = o.strokeCol ?? 'rgba(20,24,30,0.85)'; g.strokeText(text, W / 2, H / 2 + 4);
    g.fillStyle = o.col ?? '#F4F1EA'; g.fillText(text, W / 2, H / 2 + 4);
  });
}

// the cavity lining: packed snow with open pores (the air the buried person breathes), bluer in the hollows
function poreTex(seed) {
  const R = rng(seed);
  return canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = '#EEF3F8'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) { const x = R() * W, y = R() * H, r = 0.6 + R() * R() * 3.2, v = 150 + R() * 70;
      g.fillStyle = `rgba(${v * 0.62 | 0},${v * 0.75 | 0},${v | 0},${0.35 + R() * 0.45})`; g.beginPath(); g.ellipse(x, y, r * (0.7 + R() * 0.6), r, R() * 3, 0, TAU); g.fill(); }
    for (let i = 0; i < 1800; i++) { const x = R() * W, y = R() * H; g.fillStyle = `rgba(255,255,255,${0.4 + R() * 0.5})`; g.fillRect(x, y, 1 + R() * 1.5, 1 + R() * 1.5); }
  });
}
// the ice mask's frost: dense crystal feathers near the mouth, thinning outwards (alpha grows from the centre)
function frostTex(seed) {
  const R = rng(seed);
  return canvasTex(256, 256, (g, W, H) => {
    const gr = g.createRadialGradient(W * 0.5, H * 0.55, 4, W * 0.5, H * 0.5, W * 0.52);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#b8b8b8'); gr.addColorStop(1, '#101010');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 240; i++) { const a = R() * TAU, r0 = R() * W * 0.45, x = W / 2 + Math.cos(a) * r0, y = H / 2 + Math.sin(a) * r0, l = 4 + R() * 16;
      g.strokeStyle = `rgba(90,90,90,${0.3 + R() * 0.4})`; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a + 1.2) * l, y + Math.sin(a + 1.2) * l); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
  }, false);
}
function frostColorTex(seed) {
  const R = rng(seed);
  return canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#8cbde0'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 420; i++) { const x = R() * W, y = R() * H, a = R() * TAU, l = 5 + R() * 22;
      g.strokeStyle = `rgba(255,255,255,${0.35 + R() * 0.55})`; g.lineWidth = 0.8 + R() * 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      for (let b = 1; b < 4; b++) { const bx = x + Math.cos(a) * l * b / 4, by = y + Math.sin(a) * l * b / 4, ba = a + (b % 2 ? 0.9 : -0.9); g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(ba) * l * 0.3, by + Math.sin(ba) * l * 0.3); g.stroke(); } }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(40,80,120,${0.2 + R() * 0.3})`; g.fillRect(R() * W, R() * H, 1.5, 1.5); }
  });
}
// wind-packed snow (DA 10:10): sastrugi and ripples as a tileable normal map, ridges running across the wind with sharp
// windward crests, warped so they never line up, plus fine grain; for the raking morning light on the slope
let SASTRUGI = null;
function sastrugiTex() {
  if (SASTRUGI) return SASTRUGI;
  const N = 256, h = new Float32Array(N * N), TP = Math.PI * 2;
  const R = rng(4242), grain = new Float32Array(N * N); for (let i = 0; i < N * N; i++) grain[i] = R();
  const dirs = [[1, 6, 0.5, 0.0], [2, 7, 0.32, 1.7], [1, 9, 0.22, 3.1], [3, 11, 0.14, 0.6], [-1, 13, 0.1, 2.2]];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / N, v = j / N, w = 0.18 * Math.sin(TP * (2 * u + v)) + 0.12 * Math.sin(TP * (u - 3 * v) + 1.3) + 0.08 * Math.sin(TP * (5 * u + 2 * v) + 0.4);
    let z = 0; for (const [a, b, amp, ph] of dirs) { const s = Math.sin(TP * (a * u + b * v) + ph + TP * w); z += amp * (s > 0 ? Math.pow(s, 0.6) : -0.35 * Math.pow(-s, 1.8)); }
    const k = j * N + i; h[k] = z + 0.06 * (grain[k] - 0.5) + 0.04 * (grain[(k + 7) % (N * N)] - 0.5);
  }
  const data = new Uint8Array(N * N * 4), S = 2.2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const hx = h[j * N + (i + 1) % N] - h[j * N + (i + N - 1) % N], hy = h[((j + 1) % N) * N + i] - h[((j + N - 1) % N) * N + i];
    let nx = -hx * S, ny = -hy * S, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (j * N + i) * 4; data[k] = (nx * 0.5 + 0.5) * 255; data[k + 1] = (ny * 0.5 + 0.5) * 255; data[k + 2] = (nz * 0.5 + 0.5) * 255; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true; t.userData.keep = true;
  return (SASTRUGI = t);
}
function glintTex() {
  return canvasTex(64, 64, (g, W, H) => {
    const c = W / 2, gr = g.createRadialGradient(c, c, 0, c, c, c); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(210,235,255,0.6)'); gr.addColorStop(1, 'rgba(200,230,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillRect(c - 0.8, 2, 1.6, H - 4); g.fillRect(2, c - 0.8, W - 4, 1.6);
  });
}
// burial poses (Q11): every limb stays in the plane of the cut face, so nothing ends at the section (no stumps).
// The figure faces the viewer; rotZ turns the whole body in that plane (pi/2 = lying on its side, head to -x).
const BURIAL = {
  curled: { rotZ: Math.PI / 2 - 0.12, at: [0.25, 0.62], pose: { lean: 0.12, chestX: 0.1, headX: 0.2, lLeg: -0.34, lKnee: 0.68, rLeg: -0.14, rKnee: 0.28, lLegZ: 0.1, rLegZ: -0.14,
    lArmX: -1.9, lElbow: -2.1, lArmZ: 0.3, rArmX: -0.3, rElbow: -0.45, rArmZ: -0.5, lShape: 'soft', rShape: 'fist', plant: false } },
  // "you don't even know which way is up": head 30 deg below the feet, one arm flung up, the other at the face
  head_down: { rotZ: 2.09, at: [0.15, 0.95], left: true, BW: 3.9, pose: { lean: -0.05, chestX: 0.05, headX: -0.15, headZ: 0.2, lLeg: -0.2, lKnee: 0.4, rLeg: -0.05, rKnee: 0.1, lLegZ: 0.26, rLegZ: -0.18,
    lArmX: -0.35, lElbow: -0.5, lArmZ: 1.05, rArmX: -1.85, rElbow: -2.05, rArmZ: -0.3, lShape: 'soft', rShape: 'fist', plant: false } },
};
// a debris field round the block: lumpy snow and chunks, half sunk (the deposition zone, not a display case)
function debrisField(ctx, root, seed, BW, BD, n) {
  const R = rng(seed), G = ctx.ground.height, rp = root.position, ry = root.rotation.y, c = Math.cos(ry), s = Math.sin(ry);
  const geo = new THREE.IcosahedronGeometry(0.5, 1); { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + 0.18 * vnoise(p.getX(i) * 9 + p.getY(i) * 5, 3); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } geo.computeVertexNormals(); }
  const im = new THREE.InstancedMesh(geo, stdMat(ctx, { color: 0xEDF2F7, roughness: 0.95 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < n * 3 && k < n; i++) {
    const a = R() * TAU, r = 2.2 + Math.pow(R(), 0.8) * 13, lx = Math.cos(a) * r, lz = Math.sin(a) * r * 0.9 - 0.6;
    if (Math.abs(lx) < BW / 2 + 0.4 && lz > -BD - 0.4 && lz < 1.2) continue;          // keep the cut and its front clear
    const lump = R() < 0.35, w = lump ? 1.2 + R() * 2.2 : 0.25 + Math.pow(R(), 2) * 1.2;
    const wx = rp.x + lx * c + lz * s, wz = rp.z - lx * s + lz * c;
    p.set(lx, G(wx, wz) - rp.y - w * (lump ? 0.32 : 0.18), lz);
    q.setFromEuler(e.set(R() * TAU, R() * TAU, R() * TAU)); sc.set(w * (0.8 + R() * 0.5), w * (lump ? 0.45 : 0.7 + R() * 0.4), w * (0.8 + R() * 0.5));
    m.compose(p, q, sc); im.setMatrixAt(k++, m);
  }
  im.count = k; im.castShadow = true; im.receiveShadow = true; im.userData.noQA = true; im.name = 'avalanche_debris'; root.add(im);
  return im;
}
// breath: exhale times from `breath` ([t, ...] | {at, every} | a period in s); the puffs of one exhale
function breathTimes(B, dur) {
  if (B == null || B === false) return [];
  if (Array.isArray(B)) return B.map(Number).filter(Number.isFinite);
  const at = typeof B === 'object' ? num(B.at, 1.2) : 1.2, ev = typeof B === 'object' ? num(B.every, 0) : num(B, 3);
  if (!(ev > 0.5)) return [at];
  const out = []; for (let t = at - ev * Math.ceil((at + 2) / ev); t < (dur ?? 30) + ev; t += ev) out.push(t);
  return out;
}

async function buildCutaway(item, ctx, P) {
  const at = item.at || [0, 0], G = ctx.ground.height, gy0 = G(at[0], at[1]);
  const root = new THREE.Group(); root.name = 'fx.avalanche.cutaway'; root.position.set(at[0], gy0, at[1]);
  root.rotation.y = Math.PI - (item.heading ?? 180) * DEG;                 // the cut face looks along heading (+Z local)
  const DEP = num(P.depth, 1.5), RATE = num(P.clock_rate, 1.5);
  const PS = BURIAL[P.pose] || BURIAL.curled;
  const BW = PS.BW || 3.4, BD = 2.4;
  // the buried mannequin: every limb in the plane of the cut, the front half standing out of the section (a relief)
  const man = await mannequin(ctx, {});
  const holder = new THREE.Group(); holder.add(man.group); root.add(holder);
  man.pose(PS.pose);
  holder.rotation.set(0, 0, P.tilt != null ? (90 + num(P.tilt, 0)) * DEG : PS.rotZ);
  man.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.updateMatrixWorld(true);
  { // centre the body on the pose's spot, its mid-plane just in front of the cut (the back half is in the snow)
    const bb = new THREE.Box3(), v = new THREE.Vector3(), inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    man.group.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv); bb.union(b); } });
    bb.getCenter(v);
    const pz = (man.B.pelvis.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).z + man.B.head.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).z) / 2;
    holder.position.set(PS.at[0] - v.x, PS.at[1] - v.y + num(P.lift, 0), num(P.relief, 0.03) - pz);
  }
  root.updateMatrixWorld(true);
  const headW = man.B.head.getWorldPosition(new THREE.Vector3()), headL = root.worldToLocal(headW.clone());
  const mouthO = man.fig.anchors?.mouth, mouthL = mouthO ? root.worldToLocal(mouthO.getWorldPosition(new THREE.Vector3())) : headL.clone().add(new THREE.Vector3(0, -0.03, 0.1));
  const BH = Math.max(headL.y + DEP, 1.2);                                   // the surface is DEP above the face
  // the air pocket: a hollow round the face in the section, lined with porous snow (it glazes into ice later)
  const RP = 0.2 + 0.1 * clamp(num(P.pocket, 1), 0, 2);
  const pc = new THREE.Vector3(lerp(headL.x, mouthL.x, 0.35), lerp(headL.y, mouthL.y, 0.35), -0.02);
  const pTex = poreTex(23); pTex.wrapS = pTex.wrapT = THREE.RepeatWrapping; pTex.repeat.set(2, 1);
  const pocketMat = ctx.patch(new THREE.MeshStandardMaterial({ map: pTex, color: 0xDCE6F2, roughness: 0.95, side: THREE.BackSide }));
  const pocket = new THREE.Mesh(new THREE.SphereGeometry(RP, 40, 24), pocketMat);
  pocket.position.copy(pc); pocket.receiveShadow = true; pocket.name = 'avalanche_airpocket'; pocket.userData.noQA = true; root.add(pocket);
  // the debris block: cut face (strata + pores) with the pocket's opening + rough top + sides
  const faceTex = strataTex(17); faceTex.wrapS = faceTex.wrapT = THREE.RepeatWrapping;
  const holeTex = canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000000';
    const u = (pc.x + BW / 2) / BW, v = pc.y / BH, rx = Math.sqrt(Math.max(RP * RP - pc.z * pc.z, 0.01)) * 0.97;
    g.beginPath(); g.ellipse(u * W, (1 - v) * H, rx / BW * W, rx / BH * H, 0, 0, TAU); g.fill();
  }, false);
  const faceMat = ctx.patch(new THREE.MeshStandardMaterial({ map: faceTex, alphaMap: holeTex, alphaTest: 0.5, roughness: 0.92, color: 0xffffff }));
  const snowMat = stdMat(ctx, { color: 0xF2F5F8, roughness: 0.95 });
  const box = new THREE.BoxGeometry(BW, BH, BD, 60, 24, 30);
  { const p = box.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y > BH / 2 - 1e-3) p.setY(i, y + 0.12 * vnoise(x * 1.3 + 3, 1) + 0.08 * vnoise(z * 1.7, 2) - 0.1 * Math.abs(x) / BW);   // lumpy top
      if (Math.abs(x) > BW / 2 - 1e-3 || z < -BD / 2 + 1e-3) { p.setX(i, x * (1 + 0.03 * vnoise(y * 3 + z, 4))); } } box.computeVertexNormals(); }
  box.translate(0, BH / 2, -BD / 2);                                       // front face at z = 0
  const block = new THREE.Mesh(box, [snowMat, snowMat, snowMat, snowMat, faceMat, snowMat]);
  block.castShadow = true; block.receiveShadow = true; block.name = 'avalanche_block'; root.add(block);
  // depth marker: a slim ruler from the surface above the head down to the face, ticks every 0.25 m, the depth label
  const rx = PS.left ? headL.x - 0.32 : headL.x + 0.62, top = BH + 0.02, bot = headL.y;
  const rulerMat = new THREE.MeshStandardMaterial({ color: 0xD9A93F, roughness: 0.5, metalness: 0.2 });
  const tickMat = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.6 });
  const ruler = new THREE.Group(); root.add(ruler);
  if (num(P.ruler, 1) > 0) {
    ruler.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.035, top - bot, 0.02).translate(0, (top + bot) / 2, 0.012), rulerMat), { castShadow: true }));
    for (let y = bot, k = 0; y <= top + 1e-3; y += 0.25, k++) ruler.add(new THREE.Mesh(new THREE.BoxGeometry(k % 2 ? 0.07 : 0.12, 0.012, 0.022).translate(0, y, 0.014), tickMat));
    for (const y of [top, bot]) ruler.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.024).translate(0, y, 0.014), rulerMat));
    ruler.position.set(rx, 0, 0.004);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.195), new THREE.MeshBasicMaterial({ map: labelTex(`${DEP.toFixed(1)} m`, { col: '#D9A93F' }), transparent: true, depthWrite: false }));
    lab.position.set(rx + (PS.left ? -0.4 : 0.42), (top + bot) / 2 + (PS.left ? -0.25 : 0), 0.02); lab.renderOrder = 4; root.add(lab);
  }
  // the clock: a face on the cut, minutes 0..20, the 15-min mark red; the hand sweeps at clock_rate min/s
  const clockTex = canvasTex(512, 512, (g, W) => {
    const c = W / 2; g.fillStyle = 'rgba(246,243,236,0.96)'; g.beginPath(); g.arc(c, c, c - 6, 0, TAU); g.fill();
    g.lineWidth = 10; g.strokeStyle = '#20242a'; g.stroke();
    g.fillStyle = 'rgba(200,50,40,0.22)'; g.beginPath(); g.moveTo(c, c); g.arc(c, c, c - 22, -Math.PI / 2 + TAU * 15 / 20, -Math.PI / 2 + TAU, false); g.fill();
    for (let m = 0; m < 20; m++) { const a = -Math.PI / 2 + TAU * m / 20, r0 = m % 5 ? c - 40 : c - 62; g.lineWidth = m % 5 ? 5 : 11; g.strokeStyle = m === 15 ? '#C8322A' : '#20242a'; g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * (c - 22), c + Math.sin(a) * (c - 22)); g.stroke(); }
    g.font = '900 64px "Inter Display", "Inter", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const m of [0, 5, 10, 15]) { const a = -Math.PI / 2 + TAU * m / 20; g.fillStyle = m === 15 ? '#C8322A' : '#20242a'; g.fillText(String(m), c + Math.cos(a) * (c - 108), c + Math.sin(a) * (c - 108)); }
    g.font = '700 38px "Inter", sans-serif'; g.fillStyle = '#20242a'; g.fillText('MIN', c, c + 92);
  });
  const clock = new THREE.Group(); root.add(clock);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.42, 64), new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.6 })); clock.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 10, 64), rulerMat); clock.add(rim);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.015).translate(0, 0.15, 0.02), new THREE.MeshStandardMaterial({ color: 0xC8322A, roughness: 0.4 })); clock.add(hand);
  clock.position.set(PS.left ? -BW / 2 + 0.52 : BW / 2 - 0.55, BH - 0.58, 0.03); clock.visible = num(P.clock, 1) > 0;
  const minutesAt = (t) => clamp(t * RATE, 0, 19.9);
  // breath: a small vapour puff out of the mouth into the pocket on every exhale
  const BT = breathTimes(P.breath, ctx.dur), NBR = 5, puffs = new Puffs(ctx, BT.length ? BT.length * NBR : 1, { back: 0.5, dark: 0.2, name: 'avalanche_breath', softK: 0.15 });
  root.add(puffs.mesh);
  // the ice mask: a glassy frost crust growing over the face and mouth from ice_mask (s) over ice_dur, the pocket
  // walls glazing with it; a sparkle of crystal glints at `sparkle` (s)
  const IM = P.ice_mask && typeof P.ice_mask === 'object' ? P.ice_mask : { t: P.ice_mask, dur: P.ice_dur, sparkle: P.sparkle };
  const tIce = IM.t != null ? num(IM.t, 1e9) : 1e9, iceDur = Math.max(0.3, num(IM.dur, 2.5)), tSp = IM.sparkle != null ? num(IM.sparkle, 1e9) : tIce + iceDur * 0.47;
  const headR = 0.125;
  // glassy blue-tinted ice (DA 10:10): a faceted crust with a thicker outer skin, clear speculars on the facets, darker
  // refraction edges at grazing angles (fresnel), a faint #9CC8E8 tint; it grows out from the mouth (alphaTest sweep)
  const iceMk = (op, rough) => {
    const m = new THREE.MeshPhysicalMaterial({ map: frostColorTex(37), color: 0xffffff, roughness: rough, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, transparent: true, opacity: op,
      alphaMap: frostTex(31), alphaTest: 0.73, depthWrite: false, emissive: 0x0c2236, emissiveIntensity: 0.35, flatShading: true, side: THREE.DoubleSide });
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
        { float fr = pow(1.0 - abs(dot(normalize(vViewPosition), normalize(normal))), 2.2);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.32, 0.46, 0.62), clamp(fr * 0.85, 0.0, 1.0));
          gl_FragColor.a = clamp(gl_FragColor.a + fr * 0.5 * step(0.01, gl_FragColor.a), 0.0, 1.0); }`); };
    m.customProgramCacheKey = () => 'fx.avalanche.ice.' + op;
    ctx.patch(m); return m;
  };
  const iceMat = iceMk(0.8, 0.05), iceOuter = iceMk(0.34, 0.12);
  const iceGeo = (r) => { const g = new THREE.SphereGeometry(r, 20, 12, Math.PI * 0.06, Math.PI * 0.88, Math.PI * 0.1, Math.PI * 0.76), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.07 * vnoise(x * 61 + y * 37 + z * 53, 5); p.setXYZ(i, x * k, y * k, z * k); }
    g.computeVertexNormals(); return g; };
  const ice = new THREE.Mesh(iceGeo(headR * 1.14), iceMat), ice2 = new THREE.Mesh(iceGeo(headR * 1.3), iceOuter);
  const iceHolder = new THREE.Group(); iceHolder.add(ice, ice2); man.B.head.add(iceHolder); iceHolder.position.set(0, 0.075, 0.02);
  for (const m of [ice, ice2]) { m.renderOrder = 5; m.visible = false; m.userData.noQA = true; }
  const catchL = new THREE.PointLight(0xe4f2ff, 0, 0.9, 2); catchL.position.set(mouthL.x + 0.1, mouthL.y + 0.18, Math.max(mouthL.z, 0) + 0.35); root.add(catchL);
  const rim2 = new THREE.Mesh(new THREE.TorusGeometry(RP * 0.99, RP * 0.06, 8, 48), iceMat); rim2.position.copy(pc); rim2.position.z = 0.0; rim2.visible = false; rim2.renderOrder = 5; root.add(rim2);
  const gTex = glintTex(), glints = [];
  const GR = rng(77);
  for (let k = 0; k < 7; k++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    const a = GR() * TAU, r = headR * (0.5 + GR() * 0.9); sp.position.set(mouthL.x + Math.cos(a) * r, mouthL.y + Math.sin(a) * r, Math.max(mouthL.z, 0) + 0.03); sp.renderOrder = 20; sp.visible = false; sp.userData = { d: (GR() - 0.5) * 0.3, s: 0.035 + GR() * 0.05, noQA: true }; root.add(sp); glints.push(sp); }
  const _mw = new THREE.Vector3(), _c0 = new THREE.Color(0xDCE6F2), _c1 = new THREE.Color(0xCFE6FA);
  function update(t, clock_, camera) {
    hand.rotation.z = -TAU * minutesAt(t) / 20;
    man.group.updateMatrixWorld(true);
    // ice mask
    const gI = clamp((t - tIce) / iceDur), gE = gI * gI * (3 - 2 * gI);
    ice.visible = ice2.visible = rim2.visible = gE > 0.002; catchL.intensity = (IM.t != null ? 0.7 : 0) * gE * (1 + 0.6 * Math.exp(-(((t - tSp) / 0.12) ** 2)));
    iceMat.alphaTest = 0.73 * (1 - gE) + 0.004; iceOuter.alphaTest = 0.73 * (1 - clamp(gE * 1.15 - 0.15)) + 0.004;
    pocketMat.roughness = lerp(0.95, 0.35, gE); pocketMat.color.copy(_c0).lerp(_c1, gE);
    for (const sp of glints) { const u = (t - tSp - sp.userData.d) / 0.1, a = Math.exp(-u * u), tw = gE > 0.6 ? 0.35 * Math.max(0, Math.sin(t * 2.3 + sp.userData.d * 40)) ** 8 : 0, v = Math.max(a, tw);
      sp.visible = v > 0.02 && gE > 0.2; sp.material.opacity = v; sp.scale.setScalar(sp.userData.s * (0.7 + 1.1 * a) * 1.3); }
    // breath puffs
    if (camera && BT.length) {
      if (mouthO) root.worldToLocal(mouthO.getWorldPosition(_mw)); else _mw.copy(mouthL);
      let i = 0;
      for (const te of BT) for (let k = 0; k < NBR; k++, i++) {
        const a = t - te - k * 0.07;
        if (a < 0 || a > 2.4) { puffs.hide(i); continue; }
        const sz = (0.07 + 0.28 * (1 - Math.exp(-a * 1.8))) * (1 - k * 0.1), dx = (k - 2) * 0.012 + 0.03 * a, rise = 0.05 * a + 0.03 * k * a;
        puffs.set(i, _mw.x + dx, _mw.y + rise, Math.max(_mw.z, 0.02) + 0.03 + 0.05 * (1 - Math.exp(-a * 2)), sz, 0.62 * sstep(0, 0.15, a) * (1 - sstep(0.7, 2.4, a)) * (1 - gE * 0.4), k * 1.3 + a * 0.4, 0.96, 0.98, 1.0, k & 3, clamp(0.5 + 0.25 * a), 1);
      }
      puffs.commit(camera);
    }
  }
  const debris = num(P.debris, 1) > 0 ? debrisField(ctx, root, 5 + (item.seed | 0), BW, BD, Math.round(140 * num(P.debris, 1))) : null;
  update(0);
  return { root, radius: 1.2, height: BH, update, snapped: true, anchors: { figure: man.group, head: root.localToWorld(headL.clone()).toArray(), mouth: root.localToWorld(mouthL.clone()).toArray(), pocket: root.localToWorld(pc.clone()).toArray() }, footprint: [BW, BD], contact: false, minutesAt };
}

async function buildSlope(item, ctx, P) {
  const at = item.at || [0, 0], G = ctx.ground.height, gy0 = G(at[0], at[1]);
  const root = new THREE.Group(); root.name = 'fx.avalanche'; root.position.set(at[0], gy0, at[1]);
  root.rotation.y = Math.PI - (item.heading ?? 180) * DEG;               // local +Z = downhill (the flow direction)
  const L = num(P.length, 620), Wd = num(P.width, 420), ANG = num(P.angle, 32) * DEG, dur = ctx.dur ?? 12;
  const tR = num(P.t_release, 1.0);
  // slope surface: local z from -L*cos (top) to 0 (foot), height rising uphill, a runout apron beyond the foot
  const NZ = 140, NX = 90;
  const geo = new THREE.PlaneGeometry(1, 1, NX - 1, NZ - 1);
  const pos = geo.attributes.position, hgt = (x, z) => {
    const s = -z;                                                          // distance uphill (horizontal)
    const base = s > 0 ? s * Math.tan(ANG) * sstep(0, 60, s) + (s < 60 ? 0 : 0) : 0;
    const gully = -18 * Math.exp(-(x * x) / (2 * 90 * 90)) * sstep(20, 200, s);            // a shallow gully funnels the flow
    const flank = 40 * sstep(Wd * 0.35, Wd * 0.6, Math.abs(x)) * sstep(0, 200, s);
    // a mountain body, not a ramp: the flanks fall away to the ground at the sides, and a back slope behind the crest
    const topS = L * Math.cos(ANG) * 0.97;
    const body = (1 - sstep(Wd * 0.5, Wd * 0.8, Math.abs(x))) * (1 - sstep(topS, topS + 110, s));
    return (base + gully + flank) * body + 2.5 * fbm1(x * 0.02 + s * 0.013, 5) * sstep(0, 50, s);
  };
  for (let i = 0; i < pos.count; i++) { const u = pos.getX(i) + 0.5, v = pos.getY(i) + 0.5; const x = (u - 0.5) * Wd * 1.7, z = -v * (L * Math.cos(ANG) + 250) + 120; pos.setXYZ(i, x, hgt(x, z) - 0.6 * sstep(-5, -120, z) * 0, z); }
  geo.computeVertexNormals();
  // Q5: the mountain skin (erosion ribs and gullies down the fall line, rock on the steep flanks and rib crests, snow in the gullies)
  const slope = new THREE.Mesh(geo, mountainSkin(stdMat(ctx, { color: 0xF1F4F8, roughness: 0.9, side: THREE.DoubleSide }), geo, { snow: 1, rockSlope: 0.42, rock: 0x8e8a83, relief: 1.2, seed: 3 })); slope.receiveShadow = true; slope.castShadow = true; slope.name = 'avalanche_slope'; slope.userData.noQA = true; root.add(slope);
  // trees on the flanks
  const NT = Math.round(num(P.trees, 900)), R = rng(88);
  const trees = new THREE.InstancedMesh(coniferGeo(), stdMat(ctx, { color: 0xffffff, roughness: 0.85, vertexColors: true }), NT);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  let nt = 0;
  for (let i = 0; i < NT * 3 && nt < NT; i++) {
    const x = (R() - 0.5) * Wd * 1.5, z = -R() * L * Math.cos(ANG) * 0.95;
    if (Math.abs(x) < Wd * 0.28 + 30 * vnoise(z * 0.01, 2)) continue;       // the avalanche path is clear of trees
    const h = 12 + R() * 12; _p.set(x, hgt(x, z) - 0.3, z); _q.setFromEuler(_e.set(0, R() * TAU, 0)); _s.set(h, h, h); _m.compose(_p, _q, _s); trees.setMatrixAt(nt++, _m);
  }
  // Q5 (no draws from R): the flank forest grows in stands stretched down the fall line with glades between them, thins
  // to a ragged treeline up the slope, and each stand has its own size and shade
  { const c = new THREE.Color(), LC0 = L * Math.cos(ANG);
    for (let i = 0; i < nt; i++) {
      trees.getMatrixAt(i, _m); _m.decompose(_p, _q, _s);
      const stand = skinField(_p.x * 1.6, _p.z * 0.55, 11), up = clamp(-_p.z / LC0, 0, 1);
      const keep = stand > 0.4 + 0.22 * up + 0.08 * (skinField(_p.x * 5, _p.z * 5, 12) - 0.5);
      _s.multiplyScalar(keep ? 0.72 + 0.56 * clamp((stand - 0.4) * 2.5, 0, 1) : 0); _m.compose(_p, _q, _s); trees.setMatrixAt(i, _m);
      const k = 0.8 + 0.35 * skinField(_p.x * 3 + 200, _p.z * 3, 13); c.setRGB(k * 0.96, k, k * 0.97); trees.setColorAt(i, c);
    }
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true; }
  trees.count = nt; trees.castShadow = true; trees.receiveShadow = true; trees.userData.noQA = true; root.add(trees);
  // ── Q11: the slope is ground. The exact surface of the slope mesh (the same triangles the GPU draws) is merged into
  // ctx.ground.height / normal, so cast figures (their controller queries the ground every frame), later objects,
  // contact shadows and the camera safety pass all stand on it. Figures and props on the slab stay on the original
  // snow surface (the bed under the slab is only exposed after the release).
  const LC = L * Math.cos(ANG), X0 = -Wd * 0.85, X1 = Wd * 0.85, Z0 = -(LC + 250) + 120, Z1 = 120;
  if (num(P.sastrugi, 1) > 0) { const nm = sastrugiTex().clone(); nm.needsUpdate = true; nm.repeat.set((X1 - X0) / 7, (Z1 - Z0) / 7);
    slope.material.normalMap = nm; slope.material.normalScale.set(0.42 * num(P.sastrugi, 1), 0.42 * num(P.sastrugi, 1)); slope.material.needsUpdate = true; }
  const H0 = new Float32Array(pos.count), N0 = new Float32Array(geo.attributes.normal.array);
  for (let i = 0; i < pos.count; i++) H0[i] = pos.getY(i);
  const gridAt = (arr, st, k, lx, lz) => {
    const fx = (lx - X0) / (X1 - X0) * (NX - 1), fz = (lz - Z0) / (Z1 - Z0) * (NZ - 1);
    if (!(fx >= 0 && fx <= NX - 1 && fz >= 0 && fz <= NZ - 1)) return NaN;
    const ix = Math.min(NX - 2, Math.floor(fx)), iz = Math.min(NZ - 2, Math.floor(fz)), u = fx - ix, v = fz - iz;
    const a = iz * NX + ix, b = a + NX, c = b + 1, d = a + 1;
    const A = arr[a * st + k], B = arr[b * st + k], C = arr[c * st + k], D = arr[d * st + k];
    return u + v <= 1 ? A + (D - A) * u + (B - A) * v : C + (B - C) * (1 - u) + (D - C) * (1 - v);
  };
  const ry = root.rotation.y, cR = Math.cos(ry), sR = Math.sin(ry);
  const toLocal = (x, z) => { const dx = x - at[0], dz = z - at[1]; return [dx * cR - dz * sR, dx * sR + dz * cR]; };
  const toWorld = (lx, lz) => [at[0] + lx * cR + lz * sR, at[1] - lx * sR + lz * cR];
  const surfL = (lx, lz) => gridAt(H0, 1, 0, lx, lz);                      // local height of the untouched snow surface
  const slopeHeight = (x, z) => { const l = toLocal(x, z), h = surfL(l[0], l[1]); return h === h ? gy0 + h : NaN; };
  const slopeNormal = (x, z) => {
    const l = toLocal(x, z); let nx = gridAt(N0, 3, 0, l[0], l[1]), ny = gridAt(N0, 3, 1, l[0], l[1]), nz = gridAt(N0, 3, 2, l[0], l[1]);
    const n = Math.hypot(nx, ny, nz) || 1; nx /= n; ny /= n; nz /= n;
    return [nx * cR + nz * sR, ny, -nx * sR + nz * cR];
  };
  if (P.ground !== false && P.ground !== 0) {
    const GR = ctx.ground, prevH = GR.height, prevN = GR.normal;
    GR.height = (x, z) => { const g = prevH(x, z), s = slopeHeight(x, z); return s > g ? s : g; };
    GR.normal = (x, z) => { const g = prevH(x, z), s = slopeHeight(x, z); return s > g ? slopeNormal(x, z) : (prevN ? prevN(x, z) : [0, 1, 0]); };
  }
  const RQ = rng(1107);                                                     // Q11's own draws (the tree scatter keeps R)
  // ── the slab: a grid-aligned release zone below the crown (`crown_at` [x, z] world, default the old crown) ────────
  const sTop = LC * 0.92;                                                    // V1 crown: horizontal distance from the foot
  const dxg = (X1 - X0) / (NX - 1), dzg = (Z1 - Z0) / (NZ - 1);
  let sC0 = sTop, xC = 0;
  if (Array.isArray(P.crown_at) && P.crown_at.length >= 2) { const l = toLocal(+P.crown_at[0], +P.crown_at[P.crown_at.length - 1]); sC0 = clamp(-l[1], 40, LC * 0.96); xC = clamp(l[0], -Wd * 0.3, Wd * 0.3); }
  const SLab = clamp(num(P.slab, 60), 15, 250), SW = clamp(num(P.slab_width, Wd * 0.5), 30, Wd * 0.9), DS = clamp(num(P.slab_depth, 1.2), 0.3, 3);
  const izC = clamp(Math.round((-sC0 - Z0) / dzg), 1, NZ - 3), izL = clamp(izC + Math.max(2, Math.round(SLab / dzg)), izC + 2, NZ - 2);
  const ix0 = clamp(Math.round((xC - SW / 2 - X0) / dxg), 1, NX - 3), ix1 = clamp(Math.round((xC + SW / 2 - X0) / dxg), ix0 + 2, NX - 2);
  const lzC = Z0 + izC * dzg, lzL = Z0 + izL * dzg, lxA = X0 + ix0 * dxg, lxB = X0 + ix1 * dxg;
  const sC = -lzC, SLs = lzL - lzC;                                          // crown (s) and slab length along the fall line
  const crackDur = clamp(num(P.crack_dur, 0.2), 0.05, 0.8);
  const crackX = (t) => clamp((t - tR) / crackDur) * Math.max(xC - lxA, lxB - xC);      // how far the fracture has run
  // the bed: the slope mesh inside the zone sits DS lower (hidden under the cap until the release)
  for (let iz = izC + 1; iz < izL; iz++) for (let ix = ix0 + 1; ix < ix1; ix++) { const i = iz * NX + ix; pos.setY(i, H0[i] - DS); }
  pos.needsUpdate = true;
  // the cap: the untouched snow over the zone (finer grid, the surface's own heights and normals) until the release
  const CS = 3, cnx = (ix1 - ix0) * CS + 1, cnz = (izL - izC) * CS + 1;
  const capGeo = new THREE.PlaneGeometry(1, 1, cnx - 1, cnz - 1), cp = capGeo.attributes.position, cn = capGeo.attributes.normal;
  for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) {
    const k = j * cnx + i, lx = lxA + (lxB - lxA) * i / (cnx - 1), lz = lzC + (lzL - lzC) * j / (cnz - 1);
    cp.setXYZ(k, lx, surfL(lx, lz), lz);
    const nx = gridAt(N0, 3, 0, lx, lz), ny = gridAt(N0, 3, 1, lx, lz), nz = gridAt(N0, 3, 2, lx, lz), nl = Math.hypot(nx, ny, nz) || 1;
    cn.setXYZ(k, nx / nl, ny / nl, nz / nl);
    capGeo.attributes.uv.setXY(k, (lx - X0) / (X1 - X0), 1 - (lz - Z0) / (Z1 - Z0));      // the slope's own uv scale (sastrugi)
  }
  if (geo.attributes.aSkBig) { const sk = geo.attributes.aSkBig.array, A = new Float32Array(cp.count);
    for (let k = 0; k < cp.count; k++) { const v = gridAt(sk, 1, 0, cp.getX(k), cp.getZ(k)); A[k] = v === v ? v : 0; }
    capGeo.setAttribute('aSkBig', new THREE.BufferAttribute(A, 1)); }
  const cap = new THREE.Mesh(capGeo, slope.material); cap.receiveShadow = true; cap.castShadow = true; cap.name = 'avalanche_cap'; cap.userData.noQA = true; root.add(cap);
  // ── the faint cornice along the crest ─────────────────────────────────────────────────────────────────────────
  if (num(P.cornice, 1) > 0) {
    const sCr = LC * 0.965, NXc = 120, prof = [[-2.2, -0.2], [-1.4, 0.55], [-0.3, 0.95], [0.6, 0.85], [1.25, 0.45], [1.3, 0.1], [0.7, -0.25], [-0.4, -0.35]];
    const cg = new THREE.BufferGeometry(), cv = [], ci = [], k0 = num(P.cornice, 1);
    for (let i = 0; i < NXc; i++) {
      const lx = -Wd * 0.42 + Wd * 0.84 * i / (NXc - 1), sc = 0.55 + 0.45 * (0.5 + 0.5 * vnoise(lx * 0.03, 11)), taper = sstep(0, 0.12, i / (NXc - 1)) * sstep(1, 0.88, i / (NXc - 1));
      let best = -1e9, sb = sCr; for (let q = 0; q <= 60; q++) { const sq = LC * 0.9 + 170 * q / 60, hq = surfL(lx, -sq); if (hq > best) { best = hq; sb = sq; } }
      const lzc = -sb + 1.5 * vnoise(lx * 0.05, 12), yb = surfL(lx, lzc);
      for (const [pz, py] of prof) cv.push(lx, yb + py * sc * taper * k0, lzc + pz * sc * k0);
    }
    const np = prof.length;
    for (let i = 0; i < NXc - 1; i++) for (let k = 0; k < np; k++) { const a = i * np + k, b = i * np + (k + 1) % np, c = a + np, d = b + np; ci.push(a, c, b, b, c, d); }
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cv, 3)); cg.setIndex(ci); cg.computeVertexNormals();
    const cor = new THREE.Mesh(cg, stdMat(ctx, { color: 0xF4F7FA, roughness: 0.85, side: THREE.DoubleSide })); cor.castShadow = true; cor.receiveShadow = true; cor.name = 'avalanche_cornice'; cor.userData.noQA = true; root.add(cor);
  }
  // ── ski tracks: ribbons conformed to the snow (`tracks`: [[x, z], ...] | {path, start, speed, width} | a list) ────
  const trackDefs = (() => {
    const T = P.tracks; if (!T) return [];
    const one = (d) => (Array.isArray(d) && d.length >= 2 && Array.isArray(d[0]) ? { path: d } : d && Array.isArray(d.path) ? d : null);
    if (Array.isArray(T) && T.length && Array.isArray(T[0]) && Array.isArray(T[0][0])) return T.map(one).filter(Boolean);
    if (Array.isArray(T) && T.length && T[0] && !Array.isArray(T[0]) && T[0].path) return T.map(one).filter(Boolean);
    const o = one(T); return o ? [o] : [];
  })();
  const trackTex = canvasTex(128, 64, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const lane = (c, w) => { const gr = g.createLinearGradient(c - w, 0, c + w, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.18, 'rgba(250,252,255,0.9)'); gr.addColorStop(0.32, 'rgba(92,112,146,0.78)');
      gr.addColorStop(0.62, 'rgba(128,148,182,0.62)'); gr.addColorStop(0.84, 'rgba(252,253,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(c - w, 0, 2 * w, H); };
    lane(W * 0.3, W * 0.2); lane(W * 0.7, W * 0.2);
  });
  trackTex.wrapT = THREE.RepeatWrapping;
  const tracks = [];
  for (const td of trackDefs) {
    const pts = td.path.map((p) => { const l = toLocal(+p[0], +p[p.length - 1]); return new THREE.Vector3(l[0], 0, l[1]); });
    if (pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), len = curve.getLength(), NSg = Math.max(2, Math.ceil(len / 0.4));
    const sp = curve.getSpacedPoints(NSg), tw = num(td.width, 0.8), tv = [], tuv = [], ti = [];
    for (let i = 0; i <= NSg; i++) {
      const p = sp[i], q = sp[Math.min(NSg, i + 1)], o = sp[Math.max(0, i - 1)], dx = q.x - o.x, dz = q.z - o.z, dl = Math.hypot(dx, dz) || 1;
      const nx = -dz / dl, nz = dx / dl;
      for (const sgn of [-1, 1]) { const lx = p.x + nx * tw * 0.5 * sgn, lz = p.z + nz * tw * 0.5 * sgn, h = surfL(lx, lz); tv.push(lx, (h === h ? h : 0) + 0.03, lz); tuv.push(sgn < 0 ? 0 : 1, i * 0.4 / 1.6); }
      if (i < NSg) { const a = i * 2; ti.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tv, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2)); tg.setIndex(ti); tg.computeVertexNormals();
    const tm = new THREE.Mesh(tg, matX(ctx, { map: trackTex, transparent: true, depthWrite: false, roughness: 0.95, color: 0xffffff, side: THREE.DoubleSide }));
    tm.renderOrder = 2; tm.receiveShadow = true; tm.name = 'avalanche_tracks'; tm.userData.noQA = true; root.add(tm);
    const zone = []; for (let i = 0; i < tv.length / 3; i++) { const lx = tv[i * 3], lz = tv[i * 3 + 2]; if (lx > lxA && lx < lxB && lz > lzC && lz < lzL) zone.push(i, lx, tv[i * 3 + 1]); }
    tracks.push({ tm, NSg, start: td.start != null ? +td.start : null, speed: num(td.speed, 10), s0: num(td.from, 0), zone, dropped: false });
  }
  // ── the flow: the head runs down the fall line, accelerating to ~50 m/s and slowing on the apron (V1 timing) ──────
  const front = (t) => { const x = Math.max(0, t - tR); const d = 0.5 * 9 * x * x; const d2 = d < 300 ? d : 300 + (d - 300) * 0.55; return Math.min(sC + 220, d2 * 1.0); };
  // the head starts at the slab's lower edge and merges into the V1 front (identical from ~7 s after the release on)
  const TB = clamp(Math.sqrt(0.7 * SLs) + 0.7, 7, 10);
  const headD = (t) => { const x = t - tR; return x <= 0 ? SLs : front(t) + SLs * (1 - sstep(0, TB, x)); };
  const slabU = (t) => Math.max(0, headD(t) - SLs);                          // how far the slab has slid
  // ── slab blocks: rows of plates tiling the zone exactly, flush with the snow; they appear as the fracture passes,
  // gaps open (the lower rows run first), then they tumble, ride over the stauchwall and break up into the flow ────
  const BKs = [];
  // bands across the slope, each with its own rows, so the fracture lines never line up into a grid
  { let xa = lxA; while (xa < lxB - 0.5) { let xb = Math.min(lxB, xa + 7 + 9 * RQ()); if (lxB - xb < 5) xb = lxB;
      let s1 = lzC; while (s1 < lzL - 0.5) { let s2 = Math.min(lzL, s1 + 2.4 + 3.4 * RQ()); if (lzL - s2 < 2) s2 = lzL;
        let x1 = xa; while (x1 < xb - 0.5) { let x2 = Math.min(xb, x1 + 2.4 + 3.6 * RQ()); if (xb - x2 < 1.8) x2 = xb;
          BKs.push({ x: (x1 + x2) / 2, z: (s1 + s2) / 2, w: x2 - x1, l: s2 - s1, rf: ((s1 + s2) / 2 - lzC) / SLs, k: 0.01 + 0.05 * RQ() * RQ(), ph: RQ(), yj: (RQ() - 0.5) * 0.3, sp: 0 });
          x1 = x2; }
        s1 = s2; }
      xa = xb; } }
  for (const b of BKs) b.sp = 0.9 + 0.08 * b.rf + 0.14 * RQ();
  const NBk = BKs.length;
  const topTex = canvasTex(64, 64, (g, W, H) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(96,112,138,0.9)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, W - 3, H - 3); });
  const bSide = stdMat(ctx, { color: 0xDCE5EE, roughness: 0.9 }), bTop = matX(ctx, { color: 0xF1F4F8, roughness: 0.9 });
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), [bSide, bSide, bTop, bSide, bSide, bSide], NBk);
  blocks.name = 'avalanche_plates'; blocks.castShadow = true; blocks.receiveShadow = true; blocks.userData.noQA = true; blocks.frustumCulled = false; blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(blocks);
  const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _rq = new THREE.Quaternion();
  let fw = 1, fl = 1;                                                       // slope length / plan length of the last frameAt
  const frameAt = (lx, lz, w, l) => {                                      // a plate's own tangent frame on the surface
    const hx0 = surfL(lx - w / 2, lz), hx1 = surfL(lx + w / 2, lz), hz0 = surfL(lx, lz - l / 2), hz1 = surfL(lx, lz + l / 2);
    _X.set(w, (hx1 === hx1 && hx0 === hx0) ? hx1 - hx0 : 0, 0); fw = _X.length() / w; _X.normalize();
    _Z.set(0, (hz1 === hz1 && hz0 === hz0) ? hz1 - hz0 : 0, l); fl = _Z.length() / l; _Z.normalize();   // plates are cut along the slope, not the plan
    _Y.crossVectors(_Z, _X).normalize(); _Z.crossVectors(_X, _Y).normalize();
    _m.makeBasis(_X, _Y, _Z); _rq.setFromRotationMatrix(_m);
  };
  // ── the crack: a dark line racing out from the crown point to both flanks in crack_dur s, widening as it opens ───
  const crackHalf = (sgn) => {
    const x2 = sgn < 0 ? lxA : lxB, len = Math.abs(x2 - xC), n = Math.max(2, Math.ceil(len / 0.5)), v = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const lx = xC + (x2 - xC) * i / n, zz = lzC + 0.35 * vnoise(lx * 0.9, 21) + 0.18 * vnoise(lx * 3.1, 22) - 0.1;
      for (const e of [-1, 1]) { const lz = zz + e * 0.5, h = surfL(lx, lz); v.push(lx, (h === h ? h : 0) + 0.045, lz, e); }
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry(), P4 = new Float32Array(v), P3 = new Float32Array((v.length / 4) * 3), E = new Float32Array(v.length / 4);
    for (let i = 0; i < v.length / 4; i++) { P3[i * 3] = P4[i * 4]; P3[i * 3 + 1] = P4[i * 4 + 1]; P3[i * 3 + 2] = P4[i * 4 + 2]; E[i] = P4[i * 4 + 3]; }
    g.setAttribute('position', new THREE.BufferAttribute(P3, 3)); g.setIndex(idx); g.userData = { n, E, z0: new Float32Array(P3.length / 3).map((_, i) => P3[i * 3 + 2]) };
    return g;
  };
  const crownW = (() => { const n = Math.max(2, Math.ceil((lxB - lxA) / 0.6)), v = [], idx = [];
    for (let i = 0; i <= n; i++) { const lx = lxA + (lxB - lxA) * i / n, zz = lzC + 0.35 * vnoise(lx * 0.9, 21) + 0.18 * vnoise(lx * 3.1, 22) - 0.1, h = surfL(lx, zz), h0 = h === h ? h : 0;
      const step = DS * (0.75 + 0.25 * vnoise(lx * 0.7, 23)); v.push(lx, h0 + 0.03, zz, lx, h0 - step, zz + 0.25 + 0.2 * vnoise(lx * 1.3, 24));
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, matX(ctx, { color: 0xD3DEE9, roughness: 0.92, side: THREE.DoubleSide })); m.castShadow = true; m.receiveShadow = true; m.name = 'avalanche_crownwall'; m.userData.noQA = true; m.visible = false; root.add(m); return m; })();
  const crackMat = new THREE.MeshBasicMaterial({ color: 0x2E3A4C, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide });
  const crackL = new THREE.Mesh(crackHalf(-1), crackMat), crackR = new THREE.Mesh(crackHalf(1), crackMat);
  for (const c of [crackL, crackR]) { c.renderOrder = 3; c.userData.noQA = true; c.frustumCulled = false; c.name = 'avalanche_crack'; root.add(c); }
  const setCrack = (mesh, t) => {
    const g = mesh.geometry, { n, E, z0 } = g.userData, run = crackX(t), len = Math.abs((mesh === crackL ? lxA : lxB) - xC);
    const segs = run <= 0 ? 0 : Math.min(n, Math.ceil(n * run / Math.max(len, 1e-3)));
    g.setDrawRange(0, segs * 6); mesh.visible = segs > 0;
    if (!segs) return;
    // the gap opens downhill: the uphill lip stays, the lower edge moves away with the slab
    const wdt = 0.07 + 0.3 * sstep(0, 1.2, t - tR) + 0.25 * sstep(1.2, 4, t - tR), P3 = g.attributes.position;
    for (let i = 0; i < E.length; i++) {
      const lz = z0[i] - E[i] * 0.5 + (E[i] < 0 ? -wdt * 0.35 : wdt * 0.65), lx = P3.getX(i), h = surfL(lx, lz);
      P3.setY(i, (h === h ? h : 0) + 0.045); P3.setZ(i, lz);
    }
    P3.needsUpdate = true;
  };
  // ── the deposit: lumpy avalanche debris left behind where the dense flow runs out and stops (the rescue scenes) ────
  // lumps appear as the head passes and settle; `debris` 0..2 (1) scales the count, `debris_clear` [[x, z, r], ...]
  // (world) keeps spots clear (a dig site, a figure's path)
  const NDP = Math.round(700 * clamp(num(P.debris, 1), 0, 2)), DPS = [];
  const clearZ = Array.isArray(P.debris_clear) ? P.debris_clear.filter((c) => Array.isArray(c) && c.length >= 3).map((c) => [+c[0], +c[1], +c[2]]) : [];
  const deposit = NDP ? new THREE.InstancedMesh((() => { const g = new THREE.IcosahedronGeometry(0.5, 2), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 1 + 0.2 * vnoise(p.getX(i) * 9 + p.getY(i) * 5 + p.getZ(i) * 3, 7); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } g.computeVertexNormals(); return g; })(),
    stdMat(ctx, { color: 0xE6ECF2, roughness: 0.95 }), NDP) : null;
  if (deposit) {
    const sEnd = sC - Math.min(sC + 220, 1e9);                              // where the head stops (220 m past the foot)
    for (let i = 0, tries = 0; i < NDP && tries < NDP * 4; tries++) {
      const f = Math.pow(RQ(), 0.8), sq = lerp(40, sEnd + 10, f), d = sC - sq;                // denser towards the tongue
      const half = (26 + 0.12 * Math.min(d, 400)) * (1 - 0.55 * sstep(0.75, 1, f)), lx = xC * (1 - clamp(d / 300)) + (RQ() * 2 - 1) * half * Math.sqrt(RQ());
      const w = toWorld(lx, -sq);
      if (clearZ.some(([cx, cz, r]) => Math.hypot(w[0] - cx, w[1] - cz) < r)) continue;
      const big = RQ() < 0.25, sz = big ? 0.8 + RQ() * 1.4 : 0.25 + Math.pow(RQ(), 2) * 0.9;
      DPS.push({ lx, lz: -sq, d, sz, fl: big ? 0.35 + 0.2 * RQ() : 0.55 + 0.35 * RQ(), a: RQ() * TAU, b: RQ() * TAU, w }); i++;
    }
    deposit.count = DPS.length; deposit.castShadow = true; deposit.receiveShadow = true; deposit.userData.noQA = true; deposit.frustumCulled = false; deposit.name = 'avalanche_deposit';
    deposit.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(deposit);
  }
  // ── snow chunks tumbling at the head of the dense flow ─────────────────────────────────────────────────────────
  const NCH = 180, chunks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), stdMat(ctx, { color: 0xD5DEE8, roughness: 0.95, flat: true }), NCH);
  chunks.castShadow = true; chunks.userData.noQA = true; chunks.frustumCulled = false; chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(chunks);
  const CH = []; for (let i = 0; i < NCH; i++) CH.push({ x: (RQ() - 0.5) * 0.8, lag: Math.pow(RQ(), 1.4) * 14, sz: 0.3 + 0.7 * Math.pow(RQ(), 2), hop: 0.4 + RQ() * 1.6, f: 0.8 + RQ() * 1.6, ph: RQ() * TAU, ax: RQ() * TAU, ay: RQ() * TAU });
  // ── powder cloud (Q4's billows) + spurts along the crack ───────────────────────────────────────────────────────
  const WH = P.whumpf && typeof P.whumpf === 'object' ? P.whumpf : null, NWH = WH ? 26 : 0;
  const NP = 1700, NSP = 44, puffs = new Puffs(ctx, NP + NSP + NWH, { back: 0.9, dark: 0.45, name: 'avalanche_powder', softK: 0.3 }); root.add(puffs.mesh);
  const CU = [0, 0, 0];
  const PP = []; for (let i = 0; i < NP; i++) PP.push({ x: (R() - 0.5), lag: Math.pow(R(), 0.7), h: R(), sz: 0.6 + R() * 0.9, at: Math.floor(R() * 4), rot: R() * TAU, dense: R() < 0.35 });
  const SP = []; for (let i = 0; i < NSP; i++) { const f = (i + RQ()) / NSP, sg = i % 2 ? 1 : -1; SP.push({ x: xC + sg * f * (sg < 0 ? xC - lxA : lxB - xC), f, sz: 3 + RQ() * 3, up: 0.05 + RQ() * 0.4, at: Math.floor(RQ() * 4), rot: RQ() * TAU }); }
  const downPos = (s, x) => [x, hgt(x, -s), -s];                            // s = horizontal distance uphill from the foot
  function update(t, clock, camera) {
    const x = t - tR, U0 = slabU(t);
    // cap / blocks
    cap.visible = x < crackDur; crownW.visible = x > 0;
    const run = crackX(t);
    let nb = 0;
    for (const b of BKs) {
      if (x < 0 || Math.abs(b.x - xC) > run + 0.01) { _m.makeScale(0, 0, 0); blocks.setMatrixAt(nb++, _m); continue; }
      const u = U0 * lerp(1, b.sp, sstep(1.5, 8, U0)), lz = b.z + u, lx = b.x * (1 - 0.3 * clamp(u / 400)) + b.yj * sstep(3, 20, u) + (b.ph - 0.5) * 2.2 * sstep(2, 16, u);
      const vis = 1 - sstep(25 + 30 * b.ph, 110 + 40 * b.ph, u);
      if (vis <= 0.001) { _m.makeScale(0, 0, 0); blocks.setMatrixAt(nb++, _m); continue; }
      frameAt(lx, lz, b.w, b.l);
      const hs = surfL(lx, lz), h = (hs === hs ? hs : 0);
      // inside the zone the plate sits flush in its bed; below it the plate rides on the untouched snow
      const out = sstep(lzL - 1, lzL + 5, lz - b.l * 0.3);
      const tum = Math.max(0, u - 3) * b.k * (0.6 + 0.8 * b.rf), pitch = tum * 1.3, roll = Math.sin(b.ph * 7) * tum * 0.7, yaw = (b.ph - 0.5) * 0.6 * sstep(3, 30, u);
      _q.setFromEuler(_e.set(pitch, yaw + (b.ph - 0.5) * 0.6 * sstep(1.5, 14, u), roll)); _q.premultiply(_rq);   // a flush sheet until it breaks up
      const lift = lerp(0.03 - DS / 2, DS / 2 + 0.02, out) + 0.45 * b.l * Math.abs(Math.sin(pitch)) * 0.5 + 0.25 * DS * Math.abs(Math.sin(roll));
      _p.set(lx + _Y.x * lift, h + _Y.y * lift, lz + _Y.z * lift);
      const gap = 0.006 + 0.2 * sstep(1.5, 6, u);
      _s.set(Math.max(0.01, b.w * fw - gap) * vis, DS * (0.6 + 0.4 * vis), Math.max(0.01, b.l * fl - gap) * vis);
      _m.compose(_p, _q, _s); blocks.setMatrixAt(nb++, _m);
    }
    blocks.instanceMatrix.needsUpdate = true;
    setCrack(crackL, t); setCrack(crackR, t);
    // ski tracks growing behind a skier (start + speed), or already there
    for (const tk of tracks) {
      let segs = tk.NSg;
      if (tk.start != null) segs = clamp(Math.floor((tk.s0 + tk.speed * (t - tk.start)) / 0.4), 0, tk.NSg);
      tk.tm.geometry.setDrawRange(0, segs * 6); tk.tm.visible = segs > 0;
      // on the slab the tracks go with the plates: the part inside the zone drops out of sight once the fracture passes
      if (tk.zone.length) { const TP = tk.tm.geometry.attributes.position; let ch = false;
        for (let j = 0; j < tk.zone.length; j += 3) { const gone = x >= 0 && Math.abs(tk.zone[j + 1] - xC) <= run + 0.01, y = tk.zone[j + 2] - (gone ? 4 : 0);
          if (TP.getY(tk.zone[j]) !== y) { TP.setY(tk.zone[j], y); ch = true; } }
        if (ch) TP.needsUpdate = true; }
    }
    // chunks at the head of the dense flow
    const HD = headD(t), cf = sstep(0.8, 3.2, x), cfD = sstep(0.35, 1.6, x);   // cfD: the dense snow dust starts sooner
    for (let i = 0; i < NCH; i++) {
      const c = CH[i];
      if (x < 1.2) { _m.makeScale(0, 0, 0); chunks.setMatrixAt(i, _m); continue; }
      const d = HD - c.lag, s = sC - d, width = 30 + Math.min(d, 400) * 0.3, lx = xC * (1 - clamp(d / 300)) + c.x * width;
      const hs = hgt(lx, -s), hop = c.hop * Math.abs(Math.sin(t * c.f * 3 + c.ph)) * sstep(1.2, 3, x);
      _p.set(lx, hs + c.sz * 0.45 + hop, -s);
      _q.setFromEuler(_e.set(c.ax + t * c.f * 2.5, c.ay + t * c.f, 0));
      _s.setScalar(c.sz * sstep(1.2, 2.2, x) * (1 - sstep(sC + 150, sC + 215, d)));
      _m.compose(_p, _q, _s); chunks.setMatrixAt(i, _m);
    }
    chunks.instanceMatrix.needsUpdate = true;
    if (deposit) {
      const GH = ctx.ground.height;
      for (let i = 0; i < DPS.length; i++) {
        const q = DPS[i], k = x > 0 ? sstep(q.d + 4, q.d + 30, HD) : 0;       // settles a little behind the passing head
        if (k <= 0) { _m.makeScale(0, 0, 0); deposit.setMatrixAt(i, _m); continue; }
        const gw = GH(q.w[0], q.w[1]) - gy0;
        _p.set(q.lx, gw + q.sz * q.fl * 0.18 - 0.05, q.lz); _q.setFromEuler(_e.set(0.3 * Math.sin(q.a), q.b, 0.3 * Math.cos(q.a)));
        _s.set(q.sz * k, q.sz * q.fl * k, q.sz * (0.8 + 0.3 * Math.sin(q.b)) * k); _m.compose(_p, _q, _s); deposit.setMatrixAt(i, _m);
      }
      deposit.instanceMatrix.needsUpdate = true;
    }
    if (!camera) return;
    // Q4: the powder cloud as billows: crisp at the head, torn behind it; lit as one cloud (its top and the downhill
    // face towards the sun bright, its underside and back in its own blue shadow); the dense flow at the base churns.
    // Q11: it grows out of the moving slab (nothing at the release, a full cloud ~3 s later), white-blue with darker
    // blue-grey undersides, and the dense core hugs the ground in big overlapping billows (no popcorn under the cloud)
    const sn = U.uSunDir.value;
    const sx = sn.x * cR - sn.z * sR, sz0 = sn.x * sR + sn.z * cR, sy = sn.y;          // the sun in the slope's frame
    const grow = sstep(0.8, 6, x);                                          // the cloud keeps growing for ~6 s
    for (let i = 0; i < NP; i++) {
      const p = PP[i];
      const lg = Math.pow(p.lag, 2.2), d = HD - (p.dense ? Math.min(HD, Math.pow(p.lag, 1.3) * 110) : lg * Math.min(HD, 260));   // head-heavy
      if (x <= 0 || (p.dense ? cfD : cf) <= 0.001 || d < 0) { puffs.hide(i); continue; }
      const b = HD - d, s = sC - d;                                        // b: distance behind the head
      const age = clamp(b / 120);
      // the cloud's height here: a rounded nose, a full body, a thinning tail; it rises as the flow speeds up
      const Hc = (10 + 70 * grow) * cf * Math.sqrt(clamp((b + 6) / 26)) * (1 - 0.35 * sstep(60, 260, b)) * (0.55 + 0.45 * clamp(d / 160));   // a powder cloud is 50-100 m tall
      const width = (36 + Math.min(d, 400) * 0.35) * (0.62 + 0.38 * clamp(b / 50)) * (0.6 + 0.4 * cf);
      const ex = Math.abs(p.x) * 2, lxp = xC * (1 - clamp(d / 300)) + p.x * width;
      const g = downPos(s, lxp);
      const hh = Math.pow(p.h, 0.85) * (1 - 0.55 * ex * ex);
      let sz, up, al;
      if (p.dense) { sz = Math.max(5, (7 + 10 * grow) * p.sz * (0.6 + 0.4 * cf)); up = sz * 0.28 + p.h * 1.5; al = 0.9 * (1 - sstep(70, 110, b)) * cfD / Math.max(cf, 1e-3); }
      else { sz = Math.max(4, (0.3 + 0.32 * p.sz) * Hc + 3); up = 0.15 * sz + hh * Hc * 0.85; al = 0.7 * (1 - 0.55 * sstep(0.55, 1, age)) * (1 - 0.35 * ex * ex); }
      al *= sstep(0, 10, d) * cf;
      // the cloud's surface here: its top (up) and its head (downhill, +z); lit crown, blue-shadowed underside
      const hk = clamp(up / Math.max(Hc, 6)), fr = Math.exp(-b / 60);
      const nz = fr * (1 - 0.5 * hk), ny = 0.35 + hk, nl = Math.hypot(nz, ny);
      const occ = clamp(0.12 + 0.62 * sstep(-0.4, 0.65, (nz * sz0 + ny * sy) / nl) + 0.26 * hk - (p.dense ? 0.12 : 0));   // lit crown, blue-grey underside
      const wisp = p.dense ? clamp(0.25 + 0.35 * age) : clamp(0.05 + 0.6 * age * age + 0.2 * hk * age);
      curl3(g[0] / 40 + t * 0.2, (g[1] + up) / 40, g[2] / 40, 29 + p.at, CU);
      const tk = sz * (p.dense ? 0.1 : 0.16);
      const lo = p.dense ? 0.84 : 0.86 + 0.14 * hk;                        // white-blue, darker and bluer underneath
      puffs.set(i, g[0] + CU[0] * tk, Math.max(g[1] + up + CU[1] * tk * 0.5, g[1] + sz * 0.3), g[2] + CU[2] * tk, sz, al, p.rot + t * 0.2 * (p.x - 0.5), lo * 0.9, lo * 0.95, Math.min(1.06, lo * 1.05), p.at, wisp, occ);
    }
    // snow dust spurting from the fracture as it runs past
    for (let k = 0; k < NSP; k++) {
      const q = SP[k], tq = tR + crackDur * q.f, a = t - tq;
      if (a < 0 || a > 2.6) { puffs.hide(NP + k); continue; }
      const h = surfL(q.x, lzC), sz = q.sz * (0.5 + 0.9 * sstep(0, 1.6, a));
      puffs.set(NP + k, q.x, (h === h ? h : 0) + q.up * sstep(0, 1.2, a) + sz * 0.22, lzC + 0.6 + 0.8 * a, sz, 0.2 * sstep(0, 0.15, a) * (1 - sstep(0.6, 2.2, a)), q.rot + a * 0.3, 0.9, 0.94, 1.0, q.at, clamp(0.7 + 0.3 * a), 0.85);
    }
    // the whumpf: the snowpack settles with a thump and a ring of snow dust puffs out of it
    if (WH) { const tw = num(WH.t, 1e9), wa = Array.isArray(WH.at) ? toLocal(+WH.at[0], +WH.at[WH.at.length - 1]) : [xC, lzC + 20];
      for (let k = 0; k < NWH; k++) {
        const a = t - tw - (k % 5) * 0.03;
        if (a < 0 || a > 2) { puffs.hide(NP + NSP + k); continue; }
        // a thump, not a cloud: a low ring of fine snow dust, 1-3 m across, gone in ~2 s
        const ang = k / NWH * TAU + 0.4 * Math.sin(k * 3.1), r = (0.6 + 1.6 * (1 - Math.exp(-a * 2.5))) * (0.7 + 0.3 * ((k * 7) % 5) / 4);
        const lx = wa[0] + Math.cos(ang) * r, lz = wa[1] + Math.sin(ang) * r * 0.8, h = surfL(lx, lz), sz = 0.5 + 1.2 * (1 - Math.exp(-a * 1.8));
        puffs.set(NP + NSP + k, lx, (h === h ? h : 0) + 0.05 + 0.35 * (1 - Math.exp(-a * 2)) + sz * 0.15, lz, sz, 0.3 * sstep(0, 0.08, a) * (1 - sstep(0.5, 2, a)), k * 0.7 + a * 0.3, 0.92, 0.95, 1.0, k & 3, clamp(0.55 + 0.3 * a), 0.9);
      } }
    puffs.commit(camera);
    puffs.U.uGnd.value.lerp(puffs.U.uSky.value, 0.4);
  }
  update(0);
  const slopeAPI = { height: slopeHeight, normal: slopeNormal, toWorld, toLocal, crown: toWorld(xC, lzC), slabLower: toWorld(xC, lzL), fall: [sR, cR], t_release: tR };
  return { root, radius: 60, height: 40, update, snapped: true, anchors: { slope: slopeAPI, crown: slopeAPI.crown }, footprint: [60, 60], contact: false, front, headD, slabU, ground: slopeAPI };
}

export async function build(kind, item, ctx) {
  const P = prm(item);
  const mode = P.mode || item.action || 'slope';
  if (mode === 'cutaway') return buildCutaway(item, ctx, P);
  return buildSlope(item, ctx, P);
}
