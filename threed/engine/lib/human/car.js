// car.js — the modern car (Q9, 26 Sep 2026): vehicle.car_modern (sedan) and vehicle.car_suv, routed from vehicles.js.
// Faces +Z, origin on the ground at the body centre. A lofted lower body (hood, deck, plan-rounded corners, wheel arches
// with dark liners), a greenhouse of tinted see-through glass with a painted roof and pillars, an interior seen through
// the glass (dashboard, steering wheel, seats), lamps that light (`lights` true|false|'auto') with soft beams in haze,
// mirrors, door seams and handles, plates, alloy wheels on their own pivots (spun by the distance travelled).
// Options: color, body sedan|suv, driver (a seated mannequin), footwell (a deep rear footwell at ground level, so a
// ground-snapped cast figure can crouch below the windows), roof bags|box, livery police (flashing light bar).
// Geometry is built once per body type and shared by every car; each car only owns its paint and lamp materials.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial, U } from '../shared/env.js';
import { clamp, lerp, smooth, rng } from '../shared/util.js';
import { POSES } from './rig.js';
import { buildCharacter, findCastDef } from './cast.js';

const TAU = Math.PI * 2, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const LIGHTS = () => smooth((0.12 - U.uSunDir.value.y) / 0.2);

// ── body types (metres; z = +front). top: lower-body top line (hood / belt / deck); bot: sill line (arches added);
// roof: greenhouse top line from the rear-window base (gh[0]) to the windshield base (gh[1]) ──────────────────────────
export const BODY = {
  sedan: {
    L: 4.85, W: 1.84, wr: 0.335, tw: 0.235, axF: 1.47, axR: -1.36, track: 1.58, rcF: 0.5, rcR: 0.42, rt: 0.1, rb: 0.06, fl: 0.03, crown: 0.025,
    top: [[-2.425, 0.80], [-2.40, 0.93], [-2.32, 0.995], [-2.1, 1.025], [-1.62, 1.02], [-0.8, 0.995], [0.2, 0.965], [0.72, 0.945], [1.2, 0.885], [1.8, 0.805], [2.2, 0.75], [2.36, 0.70], [2.425, 0.60]],
    bot: [[-2.425, 0.42], [-2.35, 0.31], [-2.1, 0.27], [-1.6, 0.245], [1.7, 0.245], [2.2, 0.26], [2.38, 0.30], [2.425, 0.36]],
    roof: [[-1.62, 1.02], [-1.3, 1.23], [-1.0, 1.385], [-0.8, 1.44], [-0.5, 1.455], [-0.2, 1.445], [0.0, 1.405], [0.2, 1.29], [0.45, 1.12], [0.72, 0.945]],
    gh: [-1.62, 0.72], roofR: -0.93, roofF: -0.02, pillars: [[-0.34, -0.26]], glass: [-1.24, 0.70], tumble: 0.19, ghH: 0.5,
    seams: [0.69, -0.30, -1.25], handles: [-0.06, -1.05],
    floor: 0.3, seatF: -0.15, seatR: -1.02, cushion: 0.52, grille: [0.74, 0.1, 0.535], plateF: 0.42, plateR: 0.62, lampF: [0.5, 0.12], lampR: [0.36, 0.13], clad: 0, rim: 0xB9BDC2,
  },
  suv: {
    L: 4.72, W: 1.9, wr: 0.37, tw: 0.245, axF: 1.44, axR: -1.38, track: 1.64, rcF: 0.45, rcR: 0.3, rt: 0.09, rb: 0.06, fl: 0.03, crown: 0.02,
    top: [[-2.36, 1.0], [-2.33, 1.08], [-2.27, 1.12], [-1.6, 1.13], [0.9, 1.1], [1.3, 1.07], [1.9, 1.03], [2.2, 1.0], [2.32, 0.95], [2.36, 0.88]],
    bot: [[-2.36, 0.52], [-2.28, 0.45], [-2.0, 0.42], [1.95, 0.42], [2.26, 0.45], [2.36, 0.46]],
    roof: [[-2.27, 1.12], [-2.25, 1.35], [-2.2, 1.6], [-2.08, 1.72], [-1.6, 1.745], [-0.5, 1.755], [0.05, 1.74], [0.3, 1.62], [0.6, 1.38], [0.9, 1.10]],
    gh: [-2.27, 0.9], roofR: -2.1, roofF: 0.12, pillars: [[-0.22, -0.14], [-1.25, -1.17]], glass: [-2.02, 0.86], tumble: 0.15, ghH: 0.62,
    seams: [0.87, -0.18, -1.21], handles: [0.07, -1.0],
    floor: 0.44, seatF: -0.1, seatR: -1.02, cushion: 0.68, grille: [0.9, 0.2, 0.74], plateF: 0.53, plateR: 0.72, lampF: [0.45, 0.12], lampR: [0.3, 0.2], clad: 0.16, rim: 0x3E4146,
  },
};
const PAINTS = {   // name: [hex, metalness, roughness], weights roughly as real car colour shares
  white: [0xD9D9D5, 0.0, 0.3], black: [0x0B0C0E, 0.25, 0.32], silver: [0x9EA2A6, 0.75, 0.34], grey: [0x50545A, 0.55, 0.35], navy: [0x1B2740, 0.5, 0.33],
  red: [0x8C1B1B, 0.2, 0.3], blue: [0x2A4C78, 0.45, 0.33], beige: [0x9A8C73, 0.35, 0.4], green: [0x2E3E33, 0.45, 0.36], pearl: [0xCFCBC0, 0.3, 0.3],
};
const MIX = [['white', 22], ['black', 18], ['grey', 16], ['silver', 13], ['red', 8], ['navy', 7], ['blue', 7], ['beige', 4], ['green', 3], ['pearl', 2]];

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
function pchip(P) {          // monotone cubic through [[x, y]..] (x increasing)
  const n = P.length, X = P.map((p) => p[0]), Y = P.map((p) => p[1]), H = [], D = [], M = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { H.push(X[i + 1] - X[i]); D.push((Y[i + 1] - Y[i]) / H[i]); }
  M[0] = D[0]; M[n - 1] = D[n - 2];
  for (let i = 1; i < n - 1; i++) M[i] = D[i - 1] * D[i] <= 0 ? 0 : 3 * (H[i - 1] + H[i]) / ((2 * H[i] + H[i - 1]) / D[i - 1] + (H[i] + 2 * H[i - 1]) / D[i]);
  return (x) => {
    if (x <= X[0]) return Y[0]; if (x >= X[n - 1]) return Y[n - 1];
    let i = 0; while (i < n - 2 && x > X[i + 1]) i++;
    const h = H[i], t = (x - X[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h * M[i] + (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h * M[i + 1];
  };
}
function compact(pos, nrm, uv, idx) {          // a geometry with only the vertices idx uses
  const map = new Map(), P = [], N = [], T = [], I = [];
  for (const k of idx) {
    let m = map.get(k);
    if (m === undefined) { m = map.size; map.set(k, m); P.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]); N.push(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]); T.push(uv[k * 2], uv[k * 2 + 1]); }
    I.push(m);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(T, 2)); g.setIndex(I); return g;
}
// rows[i][j] (Vector3; i along +Z, j across) -> {slot: geometry}; slot(i, j) names the material of quad (i..i+1, j..j+1)
// or returns null to leave it out. Sections that run clockwise seen from +Z face outward; flip reverses the winding.
function grid(rows, slot, flip = false, inflate = 0) {
  const nr = rows.length, nc = rows[0].length, N = nr * nc, pos = new Float32Array(N * 3), uv = new Float32Array(N * 2);
  for (let i = 0; i < nr; i++) { let v = 0; for (let j = 0; j < nc; j++) { const p = rows[i][j], k = i * nc + j; if (j) v += p.distanceTo(rows[i][j - 1]); pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z; uv[k * 2] = p.z; uv[k * 2 + 1] = v; } }
  const lists = {};
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) {
    const s = slot ? slot(i, j) : 'paint'; if (!s) continue;
    const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1;
    (lists[s] ||= []).push(...(flip ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
  }
  const all = new THREE.BufferGeometry(); all.setAttribute('position', new THREE.BufferAttribute(pos, 3)); all.setIndex(Object.values(lists).flat()); all.computeVertexNormals();
  const nrm = all.attributes.normal.array;
  if (inflate) for (let k = 0; k < N; k++) for (let c = 0; c < 3; c++) pos[k * 3 + c] += nrm[k * 3 + c] * inflate;
  const out = {}; for (const [s, idx] of Object.entries(lists)) out[s] = compact(pos, nrm, uv, idx);
  return out;
}
function prep(g) {
  if (g.index === null) { const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
function rbox(w, h, d, r, seg = 2) {           // rounded box
  const g = new THREE.BoxGeometry(w, h, d, seg * 2 + 1, seg * 2 + 1, seg * 2 + 1), p = g.attributes.position, v = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), cx = clamp(x, -hx, hx), cy = clamp(y, -hy, hy), cz = clamp(z, -hz, hz);
    v.set(x - cx, y - cy, z - cz); const l = v.length(); if (l > 1e-6) v.multiplyScalar(r / l);
    p.setXYZ(i, cx + v.x, cy + v.y, cz + v.z);
  }
  g.computeVertexNormals(); return g;
}
const at = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; };
const mirrorX = (g) => { g = g.clone(); g.scale(-1, 1, 1); const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setX(i, -n.getX(i)); return g; };

// ── geometry per body type (cached) ────────────────────────────────────────────────────────────────────────────────
const GEO = {};
function bodyGeometry(type) {
  if (GEO[type]) return GEO[type];
  const B = BODY[type], parts = {}, add = (k, g) => { (parts[k] ||= []).push(prep(g)); };
  const top = pchip(B.top), bot = pchip(B.bot), roof = pchip(B.roof);
  const zF = B.L / 2, zR = -B.L / 2, w0 = B.W / 2, RA = B.wr + 0.075, zc = B.gh[1], zd = B.gh[0];
  const halfW = (z) => {
    if (z > zF - B.rcF) { const d = z - (zF - B.rcF); return w0 - B.rcF + Math.sqrt(Math.max(0, B.rcF * B.rcF - d * d)); }
    if (z < zR + B.rcR) { const d = zR + B.rcR - z; return w0 - B.rcR + Math.sqrt(Math.max(0, B.rcR * B.rcR - d * d)); }
    return w0;
  };
  const archY = (z) => { let y = -1; for (const az of [B.axF, B.axR]) { const d = z - az; if (Math.abs(d) < RA) y = Math.max(y, B.wr + Math.sqrt(RA * RA - d * d)); } return y; };
  const botY = (z) => Math.max(bot(z), archY(z));
  const sec = (z) => {
    const w = halfW(z), yt = top(z), yb = botY(z), h = Math.max(0.02, yt - yb);
    const rt = Math.min(B.rt, h * 0.5), rb = Math.min(B.rb, h * 0.3), xs = w - B.fl;
    return { w, yt, yb, rt, rb, xs, xt: xs - rt, xb: xs - rb, ys0: yt - rt, ys1: yb + rb };
  };
  // x of the body skin at (z, y) on the right side (the same maths as the rings)
  const sideX = (z, y) => {
    const S = sec(z), hs = Math.max(1e-3, S.ys0 - S.ys1), ym = (S.ys0 + S.ys1) / 2;
    if (y >= S.ys0) { const d = Math.min(S.rt, y - S.ys0); return S.xt + Math.sqrt(Math.max(0, S.rt * S.rt - d * d)); }
    if (y <= S.ys1) { const d = Math.min(S.rb, S.ys1 - y); return S.xb + Math.sqrt(Math.max(0, S.rb * S.rb - d * d)); }
    const q = (y - ym) / (hs / 2); return S.w - B.fl * q * q;
  };
  const NT = 6, NA = 6, NS = 6, NB = 3, NBO = 5;
  const half = (z) => {        // right half, top centre -> bottom centre (clockwise seen from +Z)
    const S = sec(z), P = [], hs = Math.max(1e-3, S.ys0 - S.ys1), ym = (S.ys0 + S.ys1) / 2;
    for (let k = 0; k < NT; k++) { const x = S.xt * k / NT; P.push([x, S.yt + B.crown * (1 - (x / Math.max(S.xt, 1e-3)) ** 2)]); }
    for (let k = 0; k <= NA; k++) { const a = Math.PI / 2 * (1 - k / NA); P.push([S.xt + S.rt * Math.cos(a), S.ys0 + S.rt * Math.sin(a)]); }
    for (let k = 1; k < NS; k++) { const y = lerp(S.ys0, S.ys1, k / NS), q = (y - ym) / (hs / 2); P.push([S.w - B.fl * q * q, y]); }
    for (let k = 0; k <= NB; k++) { const a = -Math.PI / 2 * k / NB; P.push([S.xb + S.rb * Math.cos(a), S.ys1 + S.rb * Math.sin(a)]); }
    for (let k = 1; k <= NBO; k++) P.push([S.xb * (1 - k / NBO), S.yb]);
    return P;
  };
  const NH = NT + NA + 1 + NS - 1 + NB + 1 + NBO, NQ = 2 * NH - 2;        // points per half, quads per ring
  const ring = (z) => { const R = half(z); return [...R, ...R.slice(0, NH - 1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => V3(x, y, z)); };
  // stations: dense round the plan corners, the arch edges and the cabin opening
  const Zs = new Set(), q4 = (v) => Math.round(v * 1e4) / 1e4;
  for (let k = 0; k <= 12; k++) { const th = Math.PI / 2 * k / 12; Zs.add(q4(zF - B.rcF + B.rcF * Math.sin(th))); Zs.add(q4(zR + B.rcR - B.rcR * Math.sin(th))); }
  for (let k = 0; k <= 44; k++) Zs.add(q4(lerp(zR + B.rcR, zF - B.rcF, k / 44)));
  for (const az of [B.axF, B.axR]) { for (let k = 0; k <= 14; k++) Zs.add(q4(az - RA + 2 * RA * k / 14)); Zs.add(q4(az - RA - 0.004)); Zs.add(q4(az + RA + 0.004)); }
  Zs.add(q4(zc)); Zs.add(q4(zd));
  const Z = [...Zs].filter((z) => z >= zR - 1e-6 && z <= zF + 1e-6).sort((a, b) => a - b);
  const rows = Z.map(ring);
  const pj = (j) => (j < NH - 1 ? j : NQ - 1 - j);            // mirror a left quad onto its right twin
  const iSide0 = NT + NA, iBot0 = NT + NA + NS;              // first side quad, first under/sill quad (right half)
  const low = grid(rows, (i, j) => {
    const p = pj(j), z0 = Z[i], z1 = Z[i + 1], zm = (z0 + z1) / 2;
    if (p < NT && z0 >= zd - 1e-6 && z1 <= zc + 1e-6) return null;           // the cabin is open under the greenhouse
    if (p >= iBot0) return 'dark';                                              // sills, bumper lips, underside, arch liners
    if (p >= iSide0 && B.clad > 0) {
      const y = (rows[i][j].y + rows[i][j + 1].y + rows[i + 1][j].y + rows[i + 1][j + 1].y) / 4;
      if (y < bot(zm) + B.clad || (archY(zm) > 0 && y < archY(zm) + 0.07)) return 'clad';
    }
    if (p >= NT && zm > B.seams[2] && zm < B.seams[0]) return 'paint2';                 // doors (white on a police car)
    return 'paint';
  });
  for (const [k, g] of Object.entries(low)) add(k, g);
  // end caps (bumper faces)
  const cap = (row, front) => {
    const c = V3(0, 0, row[0].z); row.forEach((p) => c.add(V3(p.x, p.y, 0))); c.x /= row.length; c.y /= row.length;
    const P = [c.x, c.y, c.z], I = [];
    row.forEach((p) => P.push(p.x, p.y, p.z));
    for (let j = 0; j < row.length - 1; j++) { const a = 1 + j, b = 2 + j; if (front) I.push(0, b, a); else I.push(0, a, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
  };
  add('paint', cap(rows[rows.length - 1], true)); add('paint', cap(rows[0], false));
  // overlays that follow the skin: headlamps (lens + housing), tail lamps, door seams
  const skinStrip = (z0, z1, nz, y0f, y1f, ny, key, off = 0.004, dense = 0) => {
    const R = [];
    for (let i = 0; i <= nz; i++) {
      let u = i / nz; if (dense > 0) u = 1 - (1 - u) ** (1 + dense); if (dense < 0) u = u ** (1 - dense);
      const z = lerp(z0, z1, u), row = [];
      for (let j = 0; j <= ny; j++) { const y = lerp(y0f(z), y1f(z), j / ny); row.push(V3(sideX(z, y), y, z)); }
      R.push(row);
    }
    const g = grid(R, () => key, true, off)[key];
    add(key, g); add(key, mirrorX(g));
  };
  const hz0 = zF - B.lampF[0], hz1 = zF - 0.004;
  skinStrip(hz0, hz1, 16, (z) => top(z) - 0.03 - B.lampF[1] * 0.55, (z) => top(z) - 0.028, 3, 'lampF', 0.004, 1.2);
  skinStrip(hz0, hz1, 16, (z) => top(z) - 0.03 - B.lampF[1], (z) => top(z) - 0.03 - B.lampF[1] * 0.55, 2, 'housing', 0.004, 1.2);
  skinStrip(zR + 0.004, zR + B.lampR[0], 14, (z) => top(z) - 0.03 - B.lampR[1], (z) => top(z) - 0.03, 3, 'lampR', 0.004, -1.2);
  for (const zs of B.seams) skinStrip(zs - 0.005, zs + 0.005, 1, (z) => botY(z) + 0.035, (z) => top(z) - 0.045, 10, 'seam', 0.0018);
  // grille, plates, rear light bar on the bumper faces
  add('grille', at(rbox(B.grille[0], B.grille[1], 0.03, 0.012, 1), 0, B.grille[2], zF - 0.008));
  add('chrome', at(rbox(B.grille[0] * 0.92, 0.012, 0.02, 0.005, 1), 0, B.grille[2] + B.grille[1] / 2 - 0.012, zF + 0.004));
  add('plate', at(new THREE.BoxGeometry(0.52, 0.11, 0.012), 0, B.plateF, zF + 0.002));
  add('plate', at(new THREE.BoxGeometry(0.52, 0.11, 0.012), 0, B.plateR, zR - 0.002));
  add('lampR', at(new THREE.BoxGeometry(2 * (w0 - B.rcR) - 0.1, 0.03, 0.012), 0, top(zR) - 0.09, zR - 0.003));
  // greenhouse: one grid over the top (rear window, roof, windshield), one per side (glass, pillars, seals)
  const Zg = new Set();
  for (let k = 0; k <= 48; k++) Zg.add(q4(lerp(zd, zc, k / 48)));
  for (const v of [B.roofR, B.roofF, B.glass[0], B.glass[1], ...B.pillars.flat()]) Zg.add(q4(v));
  const ZG = [...Zg].sort((a, b) => a - b);
  const xt = (z) => sec(z).xt, gh = (z) => clamp((roof(z) - top(z)) / B.ghH, 0, 1);
  const xe = (z) => xt(z) - B.tumble * gh(z), crownY = (z, u) => B.crown * 1.4 * gh(z) * (1 - u * u);
  const NU = 16, topRows = ZG.map((z) => { const row = []; for (let j = 0; j <= NU; j++) { const u = -1 + 2 * j / NU; row.push(V3(u * xe(z), roof(z) + crownY(z, u), z)); } return row; });
  const topParts = grid(topRows, (i, j) => {
    const zm = (ZG[i] + ZG[i + 1]) / 2;
    if (zm >= B.roofR && zm <= B.roofF) return 'roof';
    if (j === 0 || j === NU - 1) return 'paint';                                  // A / C pillars along the glass edges
    return 'glass';
  });
  for (const [k, g] of Object.entries(topParts)) add(k, g);
  const VS = [0, 0.05, 0.3, 0.55, 0.8, 0.95, 1];
  const sideRows = ZG.map((z) => VS.map((v) => V3(lerp(xt(z), xe(z), v) + 0.012 * Math.sin(Math.PI * v) * gh(z), lerp(top(z), roof(z), v), z)));
  const sideParts = grid(sideRows, (i, j) => {
    const zm = (ZG[i] + ZG[i + 1]) / 2;
    const glassZ = zm > B.glass[0] && zm < B.glass[1] && !B.pillars.some(([a, b]) => zm > a && zm < b);
    if (B.pillars.some(([a, b]) => zm > a && zm < b)) return 'trim';
    if (!glassZ) return 'paint';
    if (j === 0 || j === VS.length - 2) return 'trim';                            // belt seal, window frame
    return 'glass';
  }, true);
  for (const [k, g] of Object.entries(sideParts)) { add(k, g); add(k, mirrorX(g)); }
  // mirrors, handles
  { const z = zc - 0.17, y = top(z) + 0.1, x = xt(z) + 0.19;
    for (const s of [1, -1]) {
      const h = at(rbox(0.21, 0.12, 0.11, 0.035), 0, 0, 0), g = at(new THREE.BoxGeometry(0.16, 0.085, 0.01), 0, 0, -0.056), st = at(rbox(0.13, 0.035, 0.06, 0.012), -0.12, -0.04, 0.01);
      for (const [k, gg] of [['paint', h], ['mirror', g], ['trim', st]]) { gg.translate(x, y, z); add(k, s > 0 ? gg : mirrorX(gg)); }
    } }
  for (const z of B.handles) { const y = top(z) - 0.12, x = sideX(z, y); const g = at(rbox(0.15, 0.028, 0.03, 0.01), x + 0.004, y, z); add('chrome', g); add('chrome', mirrorX(g)); }
  // interior: floor, dashboard, steering wheel, seats, door cards, parcel shelf / cargo floor, wheel-well blocks
  const cw = w0 - 0.14, I = 'interior';
  const fw0 = B.seatR + 0.27, fw1 = B.seatF - 0.34 + 0.15;                          // the rear footwell (footwell: true)
  add(I, at(new THREE.BoxGeometry(2 * cw, 0.04, zc - 0.05 - fw1), 0, B.floor - 0.02, (zc - 0.05 + fw1) / 2));
  add(I, at(new THREE.BoxGeometry(2 * cw, 0.04, fw0 - zd - 0.05), 0, B.floor - 0.02, (fw0 + zd + 0.05) / 2));
  add(I, at(rbox(2 * cw, 0.28, 0.55, 0.06), 0, top(zc) - 0.13, zc - 0.2));
  add('trim', at(rbox(2 * cw - 0.1, 0.05, 0.02, 0.01), 0, top(zc) - 0.05, zc - 0.475));
  add(I, at(new THREE.TorusGeometry(0.185, 0.02, 8, 28), 0.37, top(zc) - 0.02, zc - 0.5, 0.42));
  add(I, at(new THREE.CylinderGeometry(0.03, 0.035, 0.32, 8), 0.37, top(zc) - 0.08, zc - 0.36, 1.15));
  add(I, at(rbox(0.2, 0.22, 0.6, 0.04), 0, B.floor + 0.11, B.seatF + 0.12));
  // door cards above the arches, lower panels between them
  for (const s of [1, -1]) {
    const x = s * (w0 - 0.088), yTopD = top((zc + zd) / 2) - 0.035;
    add(I, at(new THREE.BoxGeometry(0.03, yTopD - (B.wr + RA + 0.02), zc - zd - 0.06), x, (yTopD + B.wr + RA + 0.02) / 2, (zc + zd) / 2));
    const zA = B.axR + RA + 0.02, zB = Math.min(zc - 0.03, B.axF - RA - 0.02);
    add(I, at(new THREE.BoxGeometry(0.03, B.wr + RA + 0.02 - B.floor, zB - zA), x, (B.wr + RA + 0.02 + B.floor) / 2, (zA + zB) / 2));
  }
  add('dark', at(new THREE.BoxGeometry(B.track - B.tw - 0.08, B.wr + RA - B.floor + 0.02, 2 * RA * 0.9), 0, (B.wr + RA + B.floor) / 2, B.axF));
  for (const s of [1, -1]) { const x0 = 0.4, x1 = B.track / 2 - B.tw / 2 - 0.03; add(I, at(new THREE.BoxGeometry(x1 - x0, B.wr + RA - B.floor + 0.02, 2 * RA * 0.9), s * (x0 + x1) / 2, (B.wr + RA + B.floor) / 2, B.axR)); }
  if (type === 'sedan') add(I, at(new THREE.BoxGeometry(2 * cw, 0.03, 0.34), 0, top(zd) - 0.04, zd + 0.2));
  else add(I, at(new THREE.BoxGeometry(2 * cw, 0.04, B.seatR - 0.42 - zd - 0.1), 0, B.floor + 0.26, (B.seatR - 0.42 + zd + 0.1) / 2));
  const seatGeo = (x, zc0, wide) => {
    const cy = B.cushion, w = wide ? 1.36 : 0.5, gs = [];
    gs.push(at(rbox(w, 0.13, 0.5, 0.045), x, cy - 0.065, zc0));
    gs.push(at(rbox(w, wide ? 0.54 : 0.64, 0.12, 0.045), x, cy + (wide ? 0.27 : 0.3), zc0 - 0.28, wide ? -0.36 : -0.28));
    gs.push(at(new THREE.BoxGeometry(w * 0.9, cy - 0.13 - B.floor, 0.42), x, (cy - 0.13 + B.floor) / 2, zc0 + 0.02));
    const hr = (hx) => gs.push(at(rbox(0.26, wide ? 0.13 : 0.19, 0.1, 0.04), hx, cy + (wide ? 0.5 : 0.7), zc0 - (wide ? 0.34 : 0.39), wide ? -0.36 : -0.28));
    if (wide) { hr(x - 0.38); hr(x + 0.38); } else hr(x);
    return gs;
  };
  const front = [...seatGeo(0.37, B.seatF, false), ...seatGeo(-0.37, B.seatF, false)], rear = seatGeo(0, B.seatR, true);
  for (const g of rear) add(I, g);
  // wheels
  const hw = B.tw / 2, rr = B.wr * 0.66, W = {};
  const wadd = (k, g) => { (W[k] ||= []).push(prep(g)); };
  const prof = [[rr, -hw * 0.8], [B.wr - 0.035, -hw], [B.wr - 0.008, -hw * 0.86], [B.wr, -hw * 0.45], [B.wr, hw * 0.45], [B.wr - 0.008, hw * 0.86], [B.wr - 0.035, hw], [rr, hw * 0.8]].map(([r, y]) => new THREE.Vector2(r, y));
  wadd('tyre', new THREE.LatheGeometry(prof, 32).rotateZ(-Math.PI / 2));
  wadd('tyre', at(new THREE.CircleGeometry(rr, 24), -hw * 0.2, 0, 0, 0, Math.PI / 2));
  wadd('disc', at(new THREE.CylinderGeometry(rr * 0.8, rr * 0.8, 0.022, 24), 0.0, 0, 0, 0, 0, Math.PI / 2));
  wadd('rim', at(new THREE.RingGeometry(rr - 0.028, rr + 0.004, 32), hw * 0.8, 0, 0, 0, Math.PI / 2));
  wadd('rim', at(new THREE.CylinderGeometry(0.062, 0.07, 0.05, 16), hw * 0.74, 0, 0, 0, 0, Math.PI / 2));
  for (let k = 0; k < 5; k++) { const g = new THREE.BoxGeometry(0.035, rr - 0.08, 0.052); g.translate(hw * 0.72, 0.055 + (rr - 0.08) / 2, 0); g.rotateX(k / 5 * TAU); wadd('rim', g); }
  const wheel = {}; for (const [k, list] of Object.entries(W)) wheel[k] = mergeGeometries(list, false);
  const merged = {}; for (const [k, list] of Object.entries(parts)) merged[k] = mergeGeometries(list, false);
  const frontSeats = mergeGeometries(front.map(prep), false);
  // the footwell variant: front seats 0.15 m forward, a pit at ground level between the front and rear seats
  const midFloor = prep(at(new THREE.BoxGeometry(2 * cw, 0.04, fw1 - fw0), 0, B.floor - 0.02, (fw0 + fw1) / 2));
  const lampAt = { x: halfW(zF - 0.2) - 0.22, y: top(zF - 0.2) - 0.08, z: zF - 0.2 };
  const dims = { zF, zR, w0, zc, zd, roofTop: Math.max(...B.roof.map((p) => p[1])), roofAt: (z) => roof(z), xe, fw: [fw0, fw1], lampAt, topAt: top };
  return (GEO[type] = { merged, wheel, frontSeats, midFloor, dims });
}

// ── materials (shared, except paint and lamps) ────────────────────────────────────────────────────────────────────
let SHARED = null;
function sharedMats() {
  if (SHARED) return SHARED;
  const std = (o) => patchMaterial(new THREE.MeshStandardMaterial(o));
  SHARED = {
    glass: std({ color: 0x04070A, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.74, envMapIntensity: 1.25, side: THREE.DoubleSide, depthWrite: false }),
    glass_clear: std({ color: 0x0C1216, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.26, envMapIntensity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    trim: std({ color: 0x0D0E10, roughness: 0.42, metalness: 0.2 }),
    dark: std({ color: 0x141416, roughness: 0.9 }),
    clad: std({ color: 0x1E1F21, roughness: 0.72 }),
    chrome: std({ color: 0xD8DADD, roughness: 0.14, metalness: 1.0 }),
    mirror: std({ color: 0xC8D0D8, roughness: 0.05, metalness: 1.0 }),
    grille: std({ color: 0x101114, roughness: 0.32, metalness: 0.35 }),
    housing: std({ color: 0x2A2E33, roughness: 0.22, metalness: 0.85 }),
    plate: std({ color: 0xE4E2D8, roughness: 0.5 }),
    seam: std({ color: 0x050506, roughness: 0.8 }),
    interior: std({ color: 0x2B2B2E, roughness: 0.92 }),
    interior_beige: std({ color: 0x86796A, roughness: 0.9 }),
    tyre: std({ color: 0x151515, roughness: 0.88 }),
    disc: std({ color: 0x5E5F61, roughness: 0.45, metalness: 0.7 }),
  };
  return SHARED;
}
let BEAMTEX = null;
function beamTexture() {          // a length fade for the beam volume: bright at the lamp (canvas row 0 = uv.y 1), gone at the end
  if (BEAMTEX) return BEAMTEX;
  const W = 4, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), id = g.createImageData(W, H);
  for (let y = 0; y < H; y++) { const v = y / (H - 1), a = Math.pow(1 - v, 1.7) * Math.min(1, v * 30); for (let x = 0; x < W; x++) { const k = (y * W + x) * 4; id.data[k] = id.data[k + 1] = id.data[k + 2] = Math.round(255 * a); id.data[k + 3] = 255; } }
  g.putImageData(id, 0, 0); BEAMTEX = new THREE.CanvasTexture(c); BEAMTEX.colorSpace = THREE.SRGBColorSpace; return BEAMTEX;
}
function beamMaterial() {
  return new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xFFEFD6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
}
let POOL = null;
function poolTexture() {
  if (POOL) return POOL;
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128); g.save(); g.scale(1, 2);          // an ellipse that fades to black well inside the plane
  const gr = g.createRadialGradient(32, 24, 1, 32, 28, 29); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.restore();
  POOL = new THREE.CanvasTexture(c); POOL.colorSpace = THREE.SRGBColorSpace; return POOL;
}
function pickPaint(o) {
  const c = o.color;
  if (c != null && PAINTS[String(c).toLowerCase()]) return PAINTS[String(c).toLowerCase()];
  if (c != null) { const col = new THREE.Color(c), hsl = {}; col.getHSL(hsl); return [col.getHex(), hsl.s < 0.12 ? 0.5 : 0.35, 0.33]; }
  const r = rng(((o.seed ?? 7) * 7919 + (o.index ?? 0) * 104729 + 13) >>> 0); r(); r();
  let x = r() * MIX.reduce((s, m) => s + m[1], 0);
  for (const [name, wgt] of MIX) { x -= wgt; if (x <= 0) return PAINTS[name]; }
  return PAINTS.white;
}

// ── the car ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function buildModernCar(item = {}, ctx = {}) {
  // spec keys at the top level, or in params (the registry fills params with catalog description strings: skip those)
  const o = { ...item }, P = item.params || {};
  for (const k of ['body', 'color', 'lights', 'beams', 'driver', 'footwell', 'roof', 'livery', 'interior', 'glass', 'cabin_light']) if (o[k] === undefined && P[k] !== undefined && !(typeof P[k] === 'string' && /[| ]/.test(P[k]))) o[k] = P[k];
  const type = o.body === 'suv' ? 'suv' : 'sedan', B = BODY[type];
  const police = String(o.livery || '').toLowerCase() === 'police';
  const G = bodyGeometry(type), S = sharedMats(), D = G.dims;
  const group = new THREE.Group(); group.name = 'car_' + type;
  const body = new THREE.Group(); body.name = 'sprung'; group.add(body);
  const [pc, pm, pr] = police ? PAINTS.black : pickPaint(o);
  const paint = patchMaterial(new THREE.MeshPhysicalMaterial({ color: pc, metalness: pm, roughness: pr, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.0 }));
  const paint2 = police ? patchMaterial(new THREE.MeshPhysicalMaterial({ color: 0xDCDCD8, metalness: 0, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.07 })) : paint;
  const lampF = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xE6ECF0, emissive: 0xFFF3E0, emissiveIntensity: 0, roughness: 0.12, metalness: 0.1 }));
  const lampR = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x6A0808, emissive: 0xFF1A0E, emissiveIntensity: 0, roughness: 0.18 }));
  const M = { ...S, paint, paint2, roof: paint2, lampF, lampR, glass: o.glass === 'clear' ? S.glass_clear : S.glass, interior: o.interior === 'beige' ? S.interior_beige : S.interior, rim: patchMaterial(new THREE.MeshStandardMaterial({ color: B.rim, roughness: 0.28, metalness: 0.85 })) };
  const mk = (geo, m, shadow = true) => { const x = new THREE.Mesh(geo, m); x.castShadow = shadow; x.receiveShadow = true; body.add(x); return x; };
  for (const [k, geo] of Object.entries(G.merged)) mk(geo, M[k] || M.paint, k !== 'glass' && k !== 'seam');
  // front seats: normal, or slid forward with a deep footwell behind them
  const footwell = !!o.footwell;
  const fs = mk(G.frontSeats, M.interior); if (footwell) fs.position.z = 0.15;
  mk(G.midFloor, M.interior);
  // wheels on pivots (the -X pair turned round, spinning the other way)
  const wheels = [];
  for (const [x, z] of [[1, B.axF], [-1, B.axF], [1, B.axR], [-1, B.axR]]) {
    const pivot = new THREE.Group(); pivot.position.set(x * B.track / 2, B.wr, z); if (x < 0) pivot.rotation.y = Math.PI; group.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    for (const [k, geo] of Object.entries(G.wheel)) { const m = new THREE.Mesh(geo, M[k]); m.castShadow = k === 'tyre'; m.receiveShadow = true; spin.add(m); }
    wheels.push({ spin, sign: x > 0 ? 1 : -1 });
  }
  // lights: beams (additive cones, visible in haze) and a light pool on the road ahead
  const beamM = beamMaterial(), beams = [];
  for (const s of [1, -1]) {        // a soft light volume per lamp: an open frustum, 16 m long, 2.4 m wide at the end, tilted down
    const len = 16, g = new THREE.CylinderGeometry(0.1, 2.4, len, 14, 1, true); g.translate(0, -len / 2, 0);   // uv.y 1 at the lamp
    g.rotateX(-Math.PI / 2); g.rotateX(0.045); g.rotateY(s * 0.03);
    const m = new THREE.Mesh(g, beamM); m.position.set(s * D.lampAt.x, D.lampAt.y, D.lampAt.z + 0.08); m.castShadow = m.receiveShadow = false; m.renderOrder = 5; m.frustumCulled = false; m.userData.noQA = true; body.add(m); beams.push(m);   // light, not a solid
  }
  const poolM = new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0xFFE9C8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 11).rotateX(-Math.PI / 2), poolM); pool.position.set(0, 0.035, D.zF + 5.8); pool.renderOrder = 3; pool.castShadow = pool.receiveShadow = false; pool.userData.noQA = true; body.add(pool);
  // roof cargo
  const roofKind = o.roof ? String(o.roof).toLowerCase() : null;
  if (roofKind === 'bags' || roofKind === 'box' || roofKind === 'rack') {
    const zm = (type === 'sedan' ? -0.5 : -0.9), y = D.roofAt(zm) + 0.02, xr = D.xe(zm) - 0.08, L = type === 'sedan' ? 1.0 : 1.6;
    for (const s of [1, -1]) mk(new THREE.BoxGeometry(0.035, 0.035, L).translate(s * xr, y + 0.04, zm), M.trim);
    for (const dz of [-L * 0.35, L * 0.35]) mk(new THREE.BoxGeometry(2 * xr + 0.05, 0.03, 0.035).translate(0, y + 0.07, zm + dz), M.trim);
    if (roofKind === 'box') mk(rbox(0.85, 0.34, L + 0.3, 0.14).translate(0, y + 0.26, zm), M.trim);
    if (roofKind === 'bags') {
      const r = rng((o.seed ?? 3) * 31 + (o.index ?? 0));
      const cols = [0x2F3B2A, 0x1E2C44, 0x151515, 0x5A2E22, 0x6B6150];
      const bagM = patchMaterial(new THREE.MeshStandardMaterial({ color: cols[Math.floor(r() * cols.length)], roughness: 0.85 }));
      const bag2 = patchMaterial(new THREE.MeshStandardMaterial({ color: cols[Math.floor(r() * cols.length)], roughness: 0.85 }));
      mk(rbox(0.62, 0.3, 0.42, 0.13).translate(-0.18, y + 0.24, zm + 0.22), bagM);
      mk(rbox(0.5, 0.26, 0.38, 0.12).translate(0.24, y + 0.22, zm - 0.25), bag2);
      mk(rbox(0.7, 0.2, 0.34, 0.09).translate(0.02, y + 0.19, zm - (type === 'sedan' ? -0.02 : 0.62)), bagM);
      for (const dz of [-0.2, 0.25]) mk(new THREE.BoxGeometry(2 * xr + 0.06, 0.012, 0.035).translate(0, y + 0.39, zm + dz), M.trim);
    }
  }
  // police light bar
  let bar = null;
  if (police) {
    const zm = type === 'sedan' ? -0.45 : -0.6, y = D.roofAt(zm) + 0.035;
    mk(rbox(1.2, 0.06, 0.26, 0.025).translate(0, y + 0.03, zm), M.trim);
    const red = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x5A0A0A, emissive: 0xFF1E14, emissiveIntensity: 0, roughness: 0.2 }));
    const blue = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x0A1A5A, emissive: 0x2A5BFF, emissiveIntensity: 0, roughness: 0.2 }));
    mk(rbox(0.52, 0.07, 0.22, 0.03).translate(-0.3, y + 0.09, zm), red, false); mk(rbox(0.52, 0.07, 0.22, 0.03).translate(0.3, y + 0.09, zm), blue, false);
    bar = { red, blue };
  }
  // driver (a seated mannequin that shows through the glass)
  const moving = ['drive', 'move', 'taxi'].includes(String(o.action || '').toLowerCase());
  const wantDriver = o.driver ?? (moving && !footwell);
  if (wantDriver) {
    try {
      const ref = typeof o.driver === 'string' ? o.driver : null, def = (ref && findCastDef(ref, ctx)) || { id: 'driver' + (o.index ?? 0), kit: 'modern_casual', colors: { coat: ['#4A5560', '#6B5A48', '#2E3440', '#7A7F86'][(o.index ?? 0) % 4] } };
      const res = buildCharacter(def, ctx), fig = res.fig;
      fig.pose({ ...POSES.seated, lean: -0.2, headX: 0.12, lLeg: -1.3, rLeg: -1.25, lKnee: 1.05, rKnee: 1.15, lHand: undefined, rHand: undefined,
        lArmX: -0.95, rArmX: -0.95, lElbow: -0.75, rElbow: -0.75, lArmZ: 0.12, rArmZ: -0.12, lShape: 'grip', rShape: 'grip', weapon: null });
      fig.group.position.set(0.37, B.cushion - 0.46, B.seatF - 0.06); body.add(fig.group);
      fig.group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    } catch (e) { (ctx.warnings || []).push('car driver: ' + String(e).slice(0, 120)); }
  }
  // cabin light (a warm dome / dash glow, so what is inside reads through the glass at dusk)
  const cabinK = clamp(+(o.cabin_light ?? 0) || 0, 0, 2);
  if (cabinK > 0) {
    const cl = new THREE.PointLight(0xFFB978, 1.1 * cabinK, 3.2, 2); cl.position.set(0, D.roofAt(-0.5) - 0.42, -0.5); body.add(cl);   // low enough not to glare on the glass
    const dl = new THREE.PointLight(0xFF9A50, 0.7 * cabinK, 1.8, 2); dl.position.set(0, D.topAt(D.zc) + 0.05, D.zc - 0.6); body.add(dl);
    mk(new THREE.BoxGeometry(0.5, 0.02, 0.1).translate(0.2, D.topAt(D.zc) + 0.015, D.zc - 0.42), patchMaterial(new THREE.MeshStandardMaterial({ color: 0x1A0E04, emissive: 0xFF9A40, emissiveIntensity: 2 * cabinK })), false);
  }
  // anchors: the footwell (a figure crouches there), seats
  const anchors = { headlights: [], taillights: [] };
  const aw = (name, x, y, z) => { const a = new THREE.Object3D(); a.name = name; a.position.set(x, y, z); body.add(a); return a; };
  anchors.footwell = aw('footwell', 0, B.floor, (G.dims.fw[0] + (footwell ? G.dims.fw[1] : G.dims.fw[1] - 0.15)) / 2);
  anchors.driver = aw('driver', 0.37, B.cushion, B.seatF + (footwell ? 0.15 : 0));
  anchors.rear = aw('rear', 0, B.cushion, B.seatR);
  const lightMode = o.lights ?? 'auto', beamAmt = clamp(o.beams ?? 0.5, 0, 2);
  const wr = B.wr;
  function update(t = 0, s = {}) {
    const d = s.distance ?? 0;
    for (const w of wheels) w.spin.rotation.x = w.sign * d / wr;
    const on = lightMode === true || lightMode === 'on' ? 1 : lightMode === false || lightMode === 'off' ? 0 : LIGHTS();
    lampF.emissiveIntensity = 0.02 + 6 * on; lampR.emissiveIntensity = 0.04 + 2.6 * on;
    beamM.opacity = clamp(beamAmt * on * 0.09, 0, 1);
    for (const b of beams) b.visible = on > 0.01 && beamAmt > 0;
    poolM.opacity = on * 0.14 * (0.35 + 0.65 * LIGHTS()); pool.visible = on > 0.01;
    S.glass.envMapIntensity = 1.2 / (1 + 3 * (U.uNight?.value ?? 0));        // the engine boosts the environment at dusk/night
    if (bar) { const ph = t * 2.3 * TAU, k = smooth(0.5 + 2 * Math.sin(ph)), k2 = smooth(0.5 + 2 * Math.sin(ph * 2 + 1.3)); bar.red.emissiveIntensity = 7 * k * (0.6 + 0.4 * k2); bar.blue.emissiveIntensity = 7 * (1 - k) * (0.6 + 0.4 * k2); }
  }
  update(0, {});
  return { group, body, update, anchors, length: B.L, width: B.W, height: D.roofTop, wheelbase: B.axF - B.axR, track: B.track, wheelRadius: B.wr, type,
    setLights: (on) => { o.lights = on; } };
}
