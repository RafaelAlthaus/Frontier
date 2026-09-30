// town.js — Bastogne and its villages in the snow, 22–26 December 1944.
//
//   const town = await buildTown(geo, opts);   scene.add(town.group);   town.update(t, { lights, snow, fire });
//
// opts  heightAt(x, z)      ground height (m); without it geo.H (height.bin as Float32Array) is sampled bilinearly
//       farm {x, z, rot}    the Kessler farm (default 22, -35, 0). rot = yaw (three.js rotation.y) of a farm whose ridge runs
//                           north-south along the N4 with its yard and doors facing the road (west, -X)
//       burning (5)         burnt-out, burning houses in Assenois
//       pillbox {x, z, rot} the Belgian blockhouse at the link-up; rot 0 = embrasures face north. Default: 9 m off the
//                           right-hand (east) side of the Assenois-Bastogne road at its point nearest (-1300, -700)
//       hemroulle (true)    also build Hemroulle from its footprints;  poles {from: 900, to: -2200, offset: 6 (+ = east)}
//       fieldRadius (400)   wire fences round the fields within this radius of the origin
// update(t, s)  t seconds (fire flicker, embers); s.lights 0..1 warm windows; s.snow 0..1 snow cover + slab thickness;
//               s.fire 0..1 glow of the burning interiors (default 1)
// anchors       chimneys: [Vector3] every chimney top · smoke: [Vector3] the ones that smoke (occupied houses) ·
//               smokeBy: {bastogne (nearest the church first), assenois, hemroulle, arlon, marvie} · churchTop: Vector3 tip of
//               the cross on Saint-Pierre · fires: [Vector3] one per burning house, in its roof opening · fireWindows:
//               [Vector3] burning windows · farmDoor: Vector3 ground outside the Kessler dwelling door · poles: [Vector3]
//               telegraph pole tops · pillbox: Vector3 top of its roof slab
// stats         triangles per region and in total, footprints, build ms
//
// Houses come from the OpenStreetMap footprints in geo.buildings: old Bastogne (within ~550-650 m of Saint-Pierre; the
// dense core round the church and the Grand-Rue kept whole, beyond it only what lines the main roads or stands in attached
// rows — the regular post-war suburbs thin out; blocks > 700 m2 and big schools/shops/garages/flats dropped), Assenois and
// Hemroulle. Each footprint -> minimum-area rectangle (L / T shapes split into rectangles; deep row houses into a front
// house with its ridge along the street and a lower rear wing) -> a stone plinth, 1-4 storeys at 2.9 m, recessed windows
// in a regular grid (pale or dark frames with cross bars, stone sills, painted surrounds, some shutters), a door with
// steps on the street side, a 45-50 deg slate roof with small overhangs, chimneys at the gables, dormers on some town
// houses. Everything is merged per material and region (~17 draw calls a region). Snow: a shader term on every upward
// face plus displaced snow slabs (thick rounded eave edge, sills, chimney caps, drifts) scaled by s.snow.
// Special: Église Saint-Pierre (11 m sandstone west tower, slate-hung hourd, flared pyramid; the 1536 hall with its
// buttresses, pointed windows, outeaux and north porch; polygonal choir), the Porte de Trèves, the village churches.
// Procedural: the Kessler farm (stone long farm, fence, manure heap, woodpile, icicles), four farmsteads at Remoifosse and
// a dozen buildings at Marvie, telegraph poles with sagging wires along the Arlon road, wire fences, the pillbox.
// Units metres, x east, z SOUTH, y up (absolute height). Deterministic: every choice comes from rng(seed) / hash2i.
import * as THREE from 'three';
import { plain, masonry } from '../shared/materials.js';
import * as TX from './textures.js';
import { rng, clamp, lerp, hash2i, makeNoise } from '../shared/util.js';

const DEG = Math.PI / 180;

// ── growable typed buffers ────────────────────────────────────────────────────────────────────────────────────
class Buf {
  constructor(T, n = 1024) { this.T = T; this.a = new T(n); this.n = 0; }
  room(k) {
    if (this.n + k <= this.a.length) return;
    let m = this.a.length * 2; while (m < this.n + k) m *= 2;
    const b = new this.T(m); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  data() { return this.a.slice(0, this.n); }
}

// ── geometry builder: world-space faces, flat normals, UVs in metres anchored to the current origin ──────────────
// poly(pts, want): a planar convex polygon; `want` = the outward direction it must face (winding fixed to match).
class GB {
  constructor(extra = {}, alpha = false) {
    this.P = new Buf(Float32Array); this.N = new Buf(Int8Array); this.UV = new Buf(Float32Array);
    this.C = new Buf(Uint8Array); this.I = new Buf(Uint32Array); this.cnt = 0; this.alpha = alpha;
    this.ex = []; for (const k in extra) this.ex.push({ k, size: extra[k], b: new Buf(Float32Array), cur: k === 'aSpan' ? [-1e4, 1e5] : new Array(extra[k]).fill(0) });
    this.exByKey = {}; for (const e of this.ex) this.exByKey[e.k] = e;
    this.col = [255, 255, 255, 255]; this.ox = 0; this.oy = 0; this.oz = 0; this.swapUV = false;
  }
  color(c) { this.col = c; return this; }
  set(k, ...v) { const e = this.exByKey[k]; if (e) e.cur = v; return this; }
  vert(x, y, z, nx, ny, nz, u, v, off) {
    const P = this.P, N = this.N, T = this.UV, C = this.C;
    P.room(3); N.room(3); T.room(2); C.room(4);
    P.a[P.n++] = x; P.a[P.n++] = y; P.a[P.n++] = z;
    N.a[N.n++] = Math.round(nx * 127); N.a[N.n++] = Math.round(ny * 127); N.a[N.n++] = Math.round(nz * 127);
    T.a[T.n++] = u; T.a[T.n++] = v;
    const c = this.col; C.a[C.n++] = c[0]; C.a[C.n++] = c[1]; C.a[C.n++] = c[2]; if (this.alpha) C.a[C.n++] = c[3] ?? 255;
    for (let i = 0; i < this.ex.length; i++) {
      const e = this.ex[i], src = (off && e.k === 'aSnowOff') ? off : e.cur;
      e.b.room(e.size); for (let j = 0; j < e.size; j++) e.b.a[e.b.n++] = src[j];
    }
    return this.cnt++;
  }
  tri(a, b, c) { const I = this.I; I.room(3); I.a[I.n++] = a; I.a[I.n++] = b; I.a[I.n++] = c; }
  // planar polygon; `disp` = optional per-vertex snow offsets (normal / UV taken from the displaced shape)
  poly(pts, want, disp, vcols) {
    const n = pts.length;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const px = disp ? p[0] + disp[i][0] : p[0], py = disp ? p[1] + disp[i][1] : p[1], pz = disp ? p[2] + disp[i][2] : p[2];
      const qx = disp ? q[0] + disp[(i + 1) % n][0] : q[0], qy = disp ? q[1] + disp[(i + 1) % n][1] : q[1], qz = disp ? q[2] + disp[(i + 1) % n][2] : q[2];
      nx += (py - qy) * (pz + qz); ny += (pz - qz) * (px + qx); nz += (px - qx) * (py + qy);
    }
    const l = Math.hypot(nx, ny, nz); if (l < 1e-10) return;
    nx /= l; ny /= l; nz /= l;
    let rev = false;
    if (want && nx * want[0] + ny * want[1] + nz * want[2] < 0) { nx = -nx; ny = -ny; nz = -nz; rev = true; }
    let tx, tz; if (Math.abs(ny) > 0.985) { tx = 1; tz = 0; } else { tx = nz; tz = -nx; const m = Math.hypot(tx, tz); tx /= m; tz /= m; }
    const vx = ny * tz, vy = nz * tx - nx * tz, vz = -ny * tx;
    const base = this.cnt, keep = this.col;
    for (let i = 0; i < n; i++) {
      const p = pts[i], d = disp ? disp[i] : null;
      const X = p[0] + (d ? d[0] : 0) - this.ox, Y = p[1] + (d ? d[1] : 0) - this.oy, Z = p[2] + (d ? d[2] : 0) - this.oz;
      if (vcols) this.col = vcols[i];
      const U1 = X * tx + Z * tz, V1 = X * vx + Y * vy + Z * vz;
      this.vert(p[0], p[1], p[2], nx, ny, nz, this.swapUV ? V1 : U1, this.swapUV ? U1 : V1, d);
    }
    this.col = keep;
    for (let i = 1; i < n - 1; i++) { if (rev) this.tri(base, base + i + 1, base + i); else this.tri(base, base + i, base + i + 1); }
  }
  quad(a, b, c, d, want, disp) { this.poly([a, b, c, d], want, disp); }
  // oriented box: centre c, unit axes ax ay az, half sizes; skip bits 1 +x 2 -x 4 +y 8 -y 16 +z 32 -z
  obox(c, ax, ay, az, hx, hy, hz, skip = 0) {
    const P = (sx, sy, sz) => [c[0] + ax[0] * hx * sx + ay[0] * hy * sy + az[0] * hz * sz, c[1] + ax[1] * hx * sx + ay[1] * hy * sy + az[1] * hz * sz, c[2] + ax[2] * hx * sx + ay[2] * hy * sy + az[2] * hz * sz];
    const p = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
    const ng = (a) => [-a[0], -a[1], -a[2]];
    if (!(skip & 1)) this.quad(p[1], p[2], p[6], p[5], ax);
    if (!(skip & 2)) this.quad(p[0], p[4], p[7], p[3], ng(ax));
    if (!(skip & 4)) this.quad(p[3], p[7], p[6], p[2], ay);
    if (!(skip & 8)) this.quad(p[0], p[1], p[5], p[4], ng(ay));
    if (!(skip & 16)) this.quad(p[4], p[5], p[6], p[7], az);
    if (!(skip & 32)) this.quad(p[0], p[3], p[2], p[1], ng(az));
  }
  // box aligned to a building frame F: s along u, t along v, y absolute
  fbox(F, s0, s1, y0, y1, t0, t1, skip = 0) {
    const c = F.p((s0 + s1) / 2, (y0 + y1) / 2, (t0 + t1) / 2);
    this.obox(c, [F.ux, 0, F.uz], [0, 1, 0], [F.vx, 0, F.vz], Math.abs(s1 - s0) / 2, Math.abs(y1 - y0) / 2, Math.abs(t1 - t0) / 2, skip);
  }
  // cylinder / cone frustum p0 -> p1 (smooth sides), optional caps
  cyl(p0, p1, r0, r1, seg = 8, capTop = true, capBot = false) {
    const ax = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]; const L = Math.hypot(ax[0], ax[1], ax[2]); if (L < 1e-6) return;
    ax[0] /= L; ax[1] /= L; ax[2] /= L;
    let e1 = Math.abs(ax[1]) < 0.9 ? [ax[2], 0, -ax[0]] : [1, 0, 0];                 // any perpendicular
    let m = Math.hypot(...e1); e1 = e1.map((v) => v / m);
    const e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
    const slope = (r0 - r1) / L;
    const base = this.cnt;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const rx = e1[0] * ca + e2[0] * sa, ry = e1[1] * ca + e2[1] * sa, rz = e1[2] * ca + e2[2] * sa;
      let nx = rx + ax[0] * slope, ny = ry + ax[1] * slope, nz = rz + ax[2] * slope; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const u = i / seg * Math.PI * 2 * Math.max(r0, r1);
      this.vert(p0[0] + rx * r0, p0[1] + ry * r0, p0[2] + rz * r0, nx, ny, nz, u, 0);
      this.vert(p1[0] + rx * r1, p1[1] + ry * r1, p1[2] + rz * r1, nx, ny, nz, u, L);
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; this.tri(a, a + 2, a + 3); this.tri(a, a + 3, a + 1); }
    const cap = (pc, r, dir) => {
      const pts = []; for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2; pts.push([pc[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * r, pc[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * r, pc[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * r]); }
      this.poly(pts, dir);
    };
    if (capTop && r1 > 1e-4) cap(p1, r1, ax);
    if (capBot && r0 > 1e-4) cap(p0, r0, [-ax[0], -ax[1], -ax[2]]);
  }
}

// a building frame: origin (cx, cz), unit axis u; v = u turned 90 deg (x east, z south: u = east -> v = south)
function frame(cx, cz, ux, uz) {
  const vx = -uz, vz = ux;
  return { cx, cz, ux, uz, vx, vz, p: (s, y, t) => [cx + ux * s + vx * t, y, cz + uz * s + vz * t] };
}
// one wall face of a rectangle (a along u, b along v): side 0 t=+b, 1 t=-b, 2 s=+a, 3 s=-a. x runs left->right seen from outside.
function facade(F, side, a, b) {
  let s0, t0, dx, dz, nx, nz, L;
  if (side === 0) { s0 = -a; t0 = b; dx = F.ux; dz = F.uz; nx = F.vx; nz = F.vz; L = 2 * a; }
  else if (side === 1) { s0 = a; t0 = -b; dx = -F.ux; dz = -F.uz; nx = -F.vx; nz = -F.vz; L = 2 * a; }
  else if (side === 2) { s0 = a; t0 = b; dx = -F.vx; dz = -F.vz; nx = F.ux; nz = F.uz; L = 2 * b; }
  else { s0 = -a; t0 = -b; dx = F.vx; dz = F.vz; nx = -F.ux; nz = -F.uz; L = 2 * b; }
  const P0 = F.p(s0, 0, t0);
  return {
    side, L, dx, dz, nx, nz, N: [nx, 0, nz], D: [dx, 0, dz], x0: P0[0], z0: P0[2],
    at(x, y, dep = 0) { return [P0[0] + dx * x - nx * dep, y, P0[2] + dz * x - nz * dep]; },
  };
}

// a wall face between two plan points A, B (world), facing away from the world point `inside`
function facadeAB(A, B, inside) {
  let dx = B[0] - A[0], dz = B[2] - A[2]; const L = Math.hypot(dx, dz); dx /= L; dz /= L;
  let nx = dz, nz = -dx;
  if (((A[0] + B[0]) / 2 - inside[0]) * nx + ((A[2] + B[2]) / 2 - inside[2]) * nz < 0) { nx = -nx; nz = -nz; }
  let P0 = A; if (dx * nz - dz * nx < 0) { P0 = B; dx = -dx; dz = -dz; }
  return { L, dx, dz, nx, nz, N: [nx, 0, nz], D: [dx, 0, dz], at: (x, y, d = 0) => [P0[0] + dx * x - nx * d, y, P0[2] + dz * x - nz * d] };
}

// ── textures & materials (built once per page) ────────────────────────────────────────────────────────────────
let TEX = null;
function textures() {
  if (TEX) return TEX;
  TEX = {
    stone: rubble({ size: 512, meters: 2.5, stoneW: 0.3, stoneH: 0.1, tones: ['#77736C', '#7E776D', '#878077', '#6D6861', '#8C8479', '#7A7266', '#716A60', '#827A6F', '#766D63', '#6E6A66'], mortar: '#59544D', seed: 41 }),
    sand: rubble({ size: 512, meters: 3, stoneW: 0.4, stoneH: 0.15, tones: ['#7D6F60', '#8A7A67', '#766858', '#8E7B66', '#7A6A58', '#857564', '#736A60'], mortar: '#5E574E', seed: 43, joint: 0.045, flat: 0.45 }),
    brick: TX.masonry({ size: 512, meters: 2, courseH: 0.077, blockL: [0.21, 0.24], tones: ['#6E4B40', '#634338', '#785247', '#5A3F36', '#6B4A3E', '#70503F'], mortar: '#8A857E', bevel: 0.008, chip: 0.3, seed: 13, dirt: 0.4, stoneRough: 0.88 }),
    slate: TX.masonry({ size: 512, meters: 2, courseH: 0.16, blockL: [0.2, 0.3], tones: ['#41464E', '#3A3F47', '#484D55', '#3E4249', '#454A50'], mortar: '#25282D', bevel: 0.01, chip: 0.25, seed: 7, dirt: 0.2, stoneRough: 0.62 }),
    planks: TX.planks({ size: 256, meters: 2, boardW: 0.14, tone: '#B4AA9C', tone2: '#CFC6B8', seed: 5 }),
    concrete: concreteTex(256, 4),
    stucco: stuccoTex(256),
    grime: TX.grime(256),
  };
  TEX.stucco.repeat.set(1 / 4, 1 / 4);
  return TEX;
}

// small DataTexture helpers (textures.js keeps its own private)
function dtex(data, size, srgb) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
function nmap(h, size, k) {
  const d = new Uint8Array(size * size * 4), at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let nx = -(at(x + 1, y) - at(x - 1, y)) * k, ny = (at(x, y + 1) - at(x, y - 1)) * k, nz = 1; const l = Math.hypot(nx, ny, nz);
    const i = (y * size + x) * 4; d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (nz / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  return dtex(d, size, false);
}
const hex3 = (h) => { const c = parseInt(h.slice(1), 16); return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; };
// roughly coursed rubble (bedded field stone, recessed joints): jittered Voronoi stones, some merged into long ones; tileable
function rubble({ size = 512, meters = 3, stoneW = 0.3, stoneH = 0.1, tones, mortar, seed = 1, joint = 0.05, flat = 0.34 }) {
  const R = rng(seed), N = makeNoise(seed + 5);
  const cols = Math.max(2, Math.round(meters / stoneW)), rows = Math.max(2, Math.round(meters / stoneH / 2) * 2);
  const T = tones.map(hex3), MC = hex3(mortar), pts = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = (i + 0.5 + (j % 2) * 0.5 + (R() - 0.5) * 0.7) / cols, y = (j + 0.5 + (R() - 0.5) * 0.3) / rows;
    pts.push({ x, y, g: j * cols + i, t: T[Math.floor(R() * T.length)], v: 0.9 + R() * 0.2, n: R() * 40 });
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {             // merge some neighbours into long stones
    const p = pts[j * cols + i], q = pts[j * cols + (i + 1) % cols];
    if (R() < 0.32 && q.g === j * cols + (i + 1) % cols && p.g === j * cols + i) { q.g = p.g; q.t = p.t; q.v = p.v; q.n = p.n; }
  }
  const col = new Uint8Array(size * size * 4), rgh = new Uint8Array(size * size * 4), hgt = new Float32Array(size * size);
  const d3 = [9, 9, 9], p3 = [null, null, null];
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + 0.5) / size, v = (py + 0.5) / size, ci = Math.floor(u * cols), cj = Math.floor(v * rows);
    d3[0] = d3[1] = d3[2] = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -2; di <= 2; di++) {
      const jj = cj + dj, ii = ci + di, wj = ((jj % rows) + rows) % rows, wi = ((ii % cols) + cols) % cols, p = pts[wj * cols + wi];
      const dx = (u - (p.x + (ii - wi) / cols)) * cols, dy = (v - (p.y + (jj - wj) / rows)) * rows * flat, d = Math.sqrt(dx * dx + dy * dy);
      if (d < d3[0]) { d3[2] = d3[1]; p3[2] = p3[1]; d3[1] = d3[0]; p3[1] = p3[0]; d3[0] = d; p3[0] = p; }
      else if (d < d3[1]) { d3[2] = d3[1]; p3[2] = p3[1]; d3[1] = d; p3[1] = p; }
      else if (d < d3[2]) { d3[2] = d; p3[2] = p; }
    }
    const best = p3[0];
    const f2 = p3[1] && p3[1].g !== best.g ? d3[1] : (p3[2] && p3[2].g !== best.g ? d3[2] : 9);
    const e = f2 - d3[0], nF = N.fbm2(u * 64, v * 64, 3, 2, 0.5, 64, 64), nM = N.fbm2(u * 9 + best.n, v * 9, 3, 2, 0.5, 9, 9);
    const jw = joint * (0.75 + 0.6 * N.noise2(u * 23, v * 23, 23, 23));
    const face = Math.min(1, Math.max(0, (e - jw) / 0.18)), isJ = e < jw;
    const i = py * size + px, k = i * 4;
    hgt[i] = isJ ? 0.02 + nF * 0.03 : 0.3 + 0.62 * Math.sqrt(face) + nF * 0.07 + nM * 0.06;
    let r, g, b;
    if (isJ) { const m = 0.9 + nF * 0.12; r = MC[0] * m; g = MC[1] * m; b = MC[2] * m; }
    else { const sh = best.v * (0.93 + 0.07 * face) * (1 + nF * 0.08 + nM * 0.08); r = best.t[0] * sh; g = best.t[1] * sh; b = best.t[2] * sh; }
    col[k] = clamp(r, 0, 255); col[k + 1] = clamp(g, 0, 255); col[k + 2] = clamp(b, 0, 255); col[k + 3] = 255;
    rgh[k] = rgh[k + 1] = rgh[k + 2] = (isJ ? 0.97 : 0.84 + nF * 0.08) * 255; rgh[k + 3] = 255;
  }
  return { map: dtex(col, size, true), normalMap: nmap(hgt, size, 3.0), roughnessMap: dtex(rgh, size, false), meters };
}
// board-marked concrete: horizontal formwork boards 0.2 m with staggered butt joints, soft blotches and rain streaks, tileable
function concreteTex(size = 256, meters = 4) {
  const N = makeNoise(91), R = rng(92), boards = Math.round(meters / 0.2), bt = [], butt = [];
  for (let i = 0; i < boards; i++) { bt.push(0.96 + R() * 0.08); butt.push([R(), R() * 0.5 + 0.25]); }
  const col = new Uint8Array(size * size * 4), rgh = new Uint8Array(size * size * 4), hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, bi = Math.floor(v * boards), inB = v * boards - bi;
    let seam = Math.min(inB, 1 - inB) < 0.03 ? 0.6 : 0;
    for (const j of butt[bi]) { const dd = Math.abs(((u - j + 1.5) % 1) - 0.5); if (dd < 0.0025) seam = 0.4; }
    const blot = N.fbm2(u * 5, v * 5, 4, 2, 0.5, 5, 5), fine = N.fbm2(u * 64, v * 64, 2, 2, 0.5, 64, 64), streak = N.fbm2(u * 24, v * 1, 3, 2, 0.5, 24, 1);
    const t = bt[bi] * (0.9 + blot * 0.08 + fine * 0.04 - Math.max(0, streak) * 0.09) * (1 - seam * 0.12);
    const i = y * size + x, k = i * 4;
    col[k] = clamp(160 * t, 0, 255); col[k + 1] = clamp(158 * t, 0, 255); col[k + 2] = clamp(152 * t, 0, 255); col[k + 3] = 255;
    hgt[i] = 0.5 + fine * 0.04 - seam * 0.05;
    rgh[k] = rgh[k + 1] = rgh[k + 2] = (0.9 + fine * 0.05) * 255; rgh[k + 3] = 255;
  }
  return { map: dtex(col, size, true), normalMap: nmap(hgt, size, 1.2), roughnessMap: dtex(rgh, size, false), meters };
}

// neutral lime render: soft blotches and fine grain, tileable (4 m a tile)
function stuccoTex(size) {
  const N = makeNoise(77), d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const t = 0.87 + 0.09 * N.fbm2(u * 5, v * 5, 4, 2, 0.5, 5, 5) + 0.035 * N.fbm2(u * 48, v * 48, 2, 2, 0.5, 48, 48);
    const k = (y * size + x) * 4; d[k] = clamp(t * 236, 0, 255); d[k + 1] = clamp(t * 235, 0, 255); d[k + 2] = clamp(t * 231, 0, 255); d[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(d, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  return tex;
}

// shared uniforms (update() writes them)
const TU = { uTSnow: { value: 1 }, uTLights: { value: 0 }, uTTime: { value: 0 }, uTFire: { value: 1 }, uTNoise: { value: null } };

// the town shader: snow on upward faces, world-space grime, displaced snow slabs, lit windows, fire and embers.
// o: {snow: lo threshold | false, snowK: bool, grime: amount, disp: bool, lit: intensity, fire: intensity, ember: bool}
function townMat(m, o = {}) {
  const prev = m.onBeforeCompile;
  const key = (m.customProgramCacheKey ? m.customProgramCacheKey() : '') + '|town1|' + JSON.stringify(o);
  const f3 = (v) => Number(v).toFixed(3);
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    for (const k in TU) sh.uniforms[k] = TU[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTSnow; varying vec3 vTW; varying vec3 vTN;
        ${o.disp ? 'attribute vec3 aSnowOff;' : ''}
        ${o.lit || o.fire ? 'attribute float aLit; varying float vLit;' : ''}
        ${o.snowK ? 'attribute float aSnowK; varying float vSnowK;' : ''}
        ${o.span ? 'attribute vec2 aSpan; varying vec2 vSpan;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${o.disp ? 'transformed += aSnowOff * clamp(uTSnow, 0.0, 1.5);' : ''}
        ${o.lit || o.fire ? 'vLit = aLit;' : ''}
        ${o.snowK ? 'vSnowK = aSnowK;' : ''}
        ${o.span ? 'vSpan = aSpan;' : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 tw = vec4(transformed, 1.0); vec3 tn = objectNormal;
        #ifdef USE_INSTANCING
          tw = instanceMatrix * tw; tn = mat3(instanceMatrix) * tn;
        #endif
          vTW = (modelMatrix * tw).xyz; vTN = normalize(mat3(modelMatrix) * tn); }`);
    let pre = '', post = '', emi = '';
    if (o.snowVar) pre += `
      { float sv = texture2D(uTNoise, vTW.xz * 0.23).r * 0.6 + texture2D(uTNoise, vTW.xz * 1.9).b * 0.4;
        diffuseColor.rgb *= 0.9 + 0.1 * sv; }`;
    if (o.span) pre += `
      { float hb = vTW.y - vSpan.x, ht = vSpan.y - vTW.y;
        float ao = 1.0 - 0.3 * (1.0 - smoothstep(-0.2, 1.7, hb)) - 0.2 * step(0.0, ht) * (1.0 - smoothstep(0.0, 0.8, ht));
        diffuseColor.rgb *= clamp(ao, 0.45, 1.0); }`;
    if (o.grime) pre += `
      { vec3 g1 = texture2D(uTNoise, vTW.xz * 0.021 + vTW.y * 0.006).rgb;
        vec3 g2 = texture2D(uTNoise, vec2(vTW.x + vTW.z, vTW.y * 0.25) * 0.05).rgb;
        float blot = smoothstep(0.42, 0.8, g1.r), streak = smoothstep(0.5, 0.86, g2.g);
        diffuseColor.rgb *= 1.0 - clamp((blot * 0.2 + streak * 0.22) * ${f3(o.grime)}, 0.0, 0.45); }`;
    if (o.snow) pre += `
      { vec3 Nw = normalize(vTN);
        float n1 = texture2D(uTNoise, vTW.xz * 0.043).r, n2 = texture2D(uTNoise, vTW.xz * 0.53 + vTW.y * 0.21).b;
        float up = Nw.y + (n1 - 0.5) * 0.3 + (n2 - 0.5) * 0.12;
        float lo = mix(1.35, ${f3(o.snow)}, clamp(uTSnow, 0.0, 1.0));
        tSnowCov = smoothstep(lo, lo + 0.1, up);
        ${o.snowK ? 'tSnowCov *= smoothstep(0.4, 0.6, n1 * 0.9 + n2 * 0.25 + vSnowK - 0.55);' : ''}
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.83, 0.87), tSnowCov); }`;
    if (o.snow) post += 'roughnessFactor = mix(roughnessFactor, 0.84, tSnowCov);';
    if (o.lit) emi += `totalEmissiveRadiance += vec3(1.0, 0.55, 0.22) * ${f3(o.lit)} * vLit * uTLights;`;
    if (o.fire) emi += `
      { float fl = 0.58 + 0.2 * sin(uTTime * 6.3 + vTW.x * 1.3 + vTW.z * 0.7) + 0.14 * sin(uTTime * 13.1 + vTW.y * 2.3 + vTW.x) + 0.08 * sin(uTTime * 23.7 + vTW.z * 3.1);
        float nn = texture2D(uTNoise, vTW.xz * 0.21 + vec2(vTW.y * 0.13, -uTTime * 0.07)).r;
        vec3 fc = mix(vec3(0.85, 0.11, 0.015), vec3(1.0, 0.42, 0.07), clamp(vLit * 1.1 - 0.1 + (nn - 0.5) * 0.5, 0.0, 1.0));
        totalEmissiveRadiance = fc * ${f3(o.fire)} * fl * (0.2 + 0.8 * smoothstep(0.3, 0.72, nn)) * pow(vLit, 0.8) * uTFire; }`;
    if (o.ember) emi += `
      { float e = smoothstep(0.6, 0.86, texture2D(uTNoise, vTW.xz * 1.9 + vTW.y * 0.8).r);
        totalEmissiveRadiance += vec3(1.0, 0.28, 0.05) * e * (0.6 + 0.4 * sin(uTTime * 3.1 + vTW.x * 5.0 + vTW.z * 3.0)) * 2.2 * uTFire; }`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTSnow; uniform float uTLights; uniform float uTTime; uniform float uTFire; uniform sampler2D uTNoise;
        varying vec3 vTW; varying vec3 vTN;
        ${o.lit || o.fire ? 'varying float vLit;' : ''}
        ${o.snowK ? 'varying float vSnowK;' : ''}
        ${o.span ? 'varying vec2 vSpan;' : ''}`)
      .replace('#include <roughnessmap_fragment>', `float tSnowCov = 0.0;
        ${pre}
        #include <roughnessmap_fragment>
        ${post}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, tSnowCov));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${emi}`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

function materials(T) {
  TU.uTNoise.value = T.grime;
  const mas = (tex, o, extra = {}) => { const m = masonry(tex, o); m.vertexColors = true; Object.assign(m, extra); return m; };
  const M = {
    stucco: townMat(plain({ map: T.stucco, roughness: 0.94, vertexColors: true }), { snow: 0.55, grime: 1.3, span: true }),
    stone: townMat(mas(T.stone, { grime: 0.45, streak: 0.3, normal: 1.1 }), { snow: 0.55, grime: 0.5, span: true }),
    sand: townMat(mas(T.sand, { grime: 0.5, streak: 0.4, normal: 1.2 }), { snow: 0.55, grime: 0.5, span: true }),
    brick: townMat(mas(T.brick, { grime: 0.35, streak: 0.3, normal: 0.8 }), { snow: 0.55, grime: 0.6, span: true }),
    slate: townMat(mas(T.slate, { grime: 0.25, streak: 0.4, normal: 0.9 }), { snow: 0.28, snowK: true }),
    spire: townMat(mas(T.slate, { grime: 0.3, streak: 0.5, normal: 0.9 }), { snow: 0.62 }),
    trim: townMat(plain({ roughness: 0.72, vertexColors: true }), { snow: 0.5 }),
    wood: townMat(plain({ map: T.planks.map, normalMap: T.planks.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.86, vertexColors: true }), { snow: 0.5, grime: 0.5 }),
    glass: townMat(plain({ color: 0x262d34, roughness: 0.06, metalness: 0.15, envMapIntensity: 1.6 }), { lit: 1.7 }),
    snow: townMat(plain({ color: 0xf1f4f7, roughness: 0.86 }), { disp: true, snowVar: true }),
    char: townMat(plain({ color: 0x14100d, roughness: 0.96 }), { ember: true }),
    fire: townMat(plain({ color: 0x000000, roughness: 1.0, emissive: 0xffffff }), { fire: 2.6 }),
    dark: plain({ color: 0x0c0c0d, roughness: 0.95 }),
    metal: plain({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.5 }),
    concrete: townMat(mas(T.concrete, { grime: 0.7, streak: 0.6, normal: 0.5 }), { snow: 0.45, grime: 1.1 }),
    dung: townMat(plain({ color: 0x3b2d21, roughness: 1.0, vertexColors: true }), { snow: 0.42 }),
    soot: plain({ color: 0x000000, roughness: 1.0, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  M.wood.map.repeat.set(1 / 2, 1 / 2); M.wood.normalMap.repeat.set(1 / 2, 1 / 2);
  return M;
}

// which builder each material gets (extra attributes) and how its mesh casts shadows
const MAT_SPEC = {
  stucco: { cast: true, extra: { aSpan: 2 } }, stone: { cast: true, extra: { aSpan: 2 } }, sand: { cast: true, extra: { aSpan: 2 } }, brick: { cast: true, extra: { aSpan: 2 } },
  slate: { cast: true, extra: { aSnowK: 1 } }, spire: { cast: true }, trim: { cast: true }, wood: { cast: true },
  glass: { cast: false, extra: { aLit: 1 } }, snow: { cast: false, extra: { aSnowOff: 3 } }, char: { cast: true },
  fire: { cast: false, extra: { aLit: 1 } }, dark: { cast: false }, metal: { cast: true }, concrete: { cast: true },
  dung: { cast: true }, soot: { cast: false, alpha: true },
};
function builders() {
  const B = {};
  for (const k in MAT_SPEC) B[k] = new GB(MAT_SPEC[k].extra || {}, !!MAT_SPEC[k].alpha);
  B.setOrg = (x, y, z) => { for (const k in MAT_SPEC) { B[k].ox = Math.round(x / 16) * 16; B[k].oy = 0; B[k].oz = Math.round(z / 16) * 16; } };
  return B;
}
function meshesFrom(B, M, name) {
  const g = new THREE.Group(); g.name = name;
  let tris = 0;
  for (const k in MAT_SPEC) {
    const b = B[k]; if (!b.cnt) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(b.P.data(), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(b.N.data(), 3, true));
    geo.setAttribute('uv', new THREE.BufferAttribute(b.UV.data(), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(b.C.data(), b.alpha ? 4 : 3, true));
    for (const e of b.ex) geo.setAttribute(e.k, new THREE.BufferAttribute(e.b.data(), e.size));
    geo.setIndex(new THREE.BufferAttribute(b.I.data(), 1));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, M[k]);
    mesh.name = name + ':' + k; mesh.castShadow = MAT_SPEC[k].cast; mesh.receiveShadow = k !== 'fire' && k !== 'soot';
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    if (k === 'soot') mesh.renderOrder = 2;
    g.add(mesh); tris += b.I.n / 3;
  }
  g.userData.triangles = tris;
  return g;
}

// ── colours (sRGB hex -> linear 0..255 for vertex colours) ───────────────────────────────────────────────────
const _c = new THREE.Color();
const lin = (hex) => { _c.set(hex); return [Math.round(_c.r * 255), Math.round(_c.g * 255), Math.round(_c.b * 255), 255]; };
const PAL = {
  stucco: ['#E6E5E1', '#DCDBD6', '#D2D0CA', '#C8C6C0', '#DEDAD0', '#D4CEC2', '#C6C1B6', '#BDBCB6', '#B2B1AC', '#D8D4CA', '#CCC7BC', '#BAB6AE', '#C9C3B5'].map(lin),
  stone: ['#FFFFFF', '#F3F4F6', '#E9E8E6', '#F6F2EC', '#E0E0DE', '#ECE8E2'].map(lin),
  brick: ['#FFFFFF', '#F4E8DE', '#EADFD6', '#FFF0E6'].map(lin),
  trim: ['#F0EEE8', '#E8E3D8', '#DCD9D1', '#EDE7DA', '#F2F0EA'].map(lin),
  trimDark: ['#3E4A3E', '#4C3C30', '#34404C', '#5A5A56'].map(lin),
  shutter: ['#46553F', '#54432F', '#5E6D74', '#6E3C2E', '#3B4A40', '#4E5B63', '#5D4A38'].map(lin),
  door: ['#3F2E22', '#4B3A2A', '#2F3C30', '#5A2F25', '#394249', '#5E4A36'].map(lin),
  slate: ['#FFFFFF', '#F2F4F8', '#E6E9EE', '#DDE0E5', '#F6F3F0'].map(lin),
  sill: ['#8D8B86', '#77787A', '#A09A90'].map(lin),
  white: lin('#FFFFFF'), wood: lin('#7A6654'), woodDark: lin('#5A4A3C'), woodGrey: lin('#8E8578'),
};
// Q9: optional palettes for a town (o.palette). Same random draws as PAL (pick() takes one draw whatever the list), so
// only colours change: the layout, the house positions and every later draw stay identical.
const PALETTES = {
  tropical: { stucco: ['#F2D9C4', '#E8C8C8', '#CDE3D3', '#F4E7B8', '#BFE0E4', '#F6F2EA', '#E9D4E6', '#F0CFA8', '#D6E8C8', '#F4F0E4'], shutter: ['#2E8C8A', '#F4F2EC', '#3A7CA5', '#D8704E', '#5E9E6E', '#2E6E8A'],
    door: ['#2E6E8A', '#8A3A2E', '#F2F0EA', '#3E7A5A', '#D8704E'], slate: ['#C87058', '#8FB08F', '#E8E6E0', '#B8C4CC', '#D89070'], trim: ['#FFFFFF', '#F6F2E8', '#FFFFFF'] },
  new_england: { stucco: ['#F4F2EC', '#EDE6D6', '#D8DCDE', '#9A3A2E', '#3E4E66', '#E6D9B8', '#B8BFB0', '#F4F2EC', '#EFE9DC'], shutter: ['#1E2226', '#2F4A3A', '#3A3E48', '#1E2226'],
    door: ['#8A2E26', '#1E2226', '#2F4A3A', '#3E4E66'], slate: ['#9A9CA0', '#7A7C80', '#B0B2B4', '#8A8C90'], trim: ['#FFFFFF', '#F4F2EC'] },
};
for (const P of Object.values(PALETTES)) for (const k of Object.keys(P)) P[k] = P[k].map(lin);
export const PALETTE_NAMES = Object.keys(PALETTES);
let PALX = null;                                   // the palette of the town being built
const palOf = (k) => (PALX && PALX[k]) || PAL[k];

// ── footprint maths ───────────────────────────────────────────────────────────────────────────────────────────
function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
function centroid(p) { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  lo.pop(); hi.pop(); return lo.concat(hi);
}
// minimum-area bounding rectangle: {cx, cz, ux, uz, a (half along u), b (half along v), area}
function mabr(poly) {
  const h = hull(poly); let best = null;
  for (let i = 0; i < h.length; i++) {
    const p = h[i], q = h[(i + 1) % h.length]; let ux = q[0] - p[0], uz = q[1] - p[1]; const L = Math.hypot(ux, uz); if (L < 1e-6) continue;
    ux /= L; uz /= L; const vx = -uz, vz = ux;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const r of h) { const s = r[0] * ux + r[1] * uz, t = r[0] * vx + r[1] * vz; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const A = (s1 - s0) * (t1 - t0);
    if (!best || A < best.area - 1e-6) {
      const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2;
      best = { cx: ux * sc + vx * tc, cz: uz * sc + vz * tc, ux, uz, a: (s1 - s0) / 2, b: (t1 - t0) / 2, area: A };
    }
  }
  return best;
}
function inPoly(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
// split an irregular footprint into up to 3 rectangles (largest empty-rectangle search on a 0.5 m grid in the MABR frame)
function decompose(poly, r) {
  const res = 0.5, W = Math.max(1, Math.round(2 * r.a / res)), H = Math.max(1, Math.round(2 * r.b / res));
  const vx = -r.uz, vz = r.ux, g = new Uint8Array(W * H);
  const loc = poly.map(([x, z]) => [(x - r.cx) * r.ux + (z - r.cz) * r.uz, (x - r.cx) * vx + (z - r.cz) * vz]);
  let total = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const s = -r.a + (i + 0.5) * (2 * r.a / W), t = -r.b + (j + 0.5) * (2 * r.b / H);
    if (inPoly(s, t, loc)) { g[j * W + i] = 1; total++; }
  }
  const out = [], hgt = new Int32Array(W);
  let left = total;
  for (let it = 0; it < 3 && left > total * 0.12; it++) {
    hgt.fill(0); let best = null;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) hgt[i] = g[j * W + i] ? hgt[i] + 1 : 0;
      const st = [];
      for (let i = 0; i <= W; i++) {
        const h = i < W ? hgt[i] : 0; let start = i;
        while (st.length && st[st.length - 1][1] >= h) {
          const [si, sh] = st.pop(); const A = sh * (i - si);
          if (!best || A > best.A) best = { A, i0: si, i1: i, j0: j - sh + 1, j1: j + 1 };
          start = si;
        }
        st.push([start, h]);
      }
    }
    if (!best || best.A * res * res < 14) break;
    for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) g[j * W + i] = 0;
    left -= best.A;
    const sW = 2 * r.a / W, tH = 2 * r.b / H;
    const s0 = -r.a + best.i0 * sW, s1 = -r.a + best.i1 * sW, t0 = -r.b + best.j0 * tH, t1 = -r.b + best.j1 * tH;
    const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2;
    out.push({ cx: r.cx + r.ux * sc + vx * tc, cz: r.cz + r.uz * sc + vz * tc, ux: r.ux, uz: r.uz, a: (s1 - s0) / 2, b: (t1 - t0) / 2, area: (s1 - s0) * (t1 - t0) });
  }
  return out.length ? out : [r];
}

// segment distance helpers
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L < 1e-9 ? 0 : clamp(((px - ax) * dx + (pz - az) * dz) / L);
  const qx = ax + t * dx, qz = az + t * dz;
  return { d: Math.hypot(px - qx, pz - qz), x: qx, z: qz, dx, dz, t };
}
// a uniform grid over segments for "nearest road" queries
function segIndex(segs, cell = 60) {
  const m = new Map();
  const key = (i, j) => i * 100003 + j;
  segs.forEach((s, n) => {
    const i0 = Math.floor(Math.min(s[0], s[2]) / cell), i1 = Math.floor(Math.max(s[0], s[2]) / cell);
    const j0 = Math.floor(Math.min(s[1], s[3]) / cell), j1 = Math.floor(Math.max(s[1], s[3]) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); if (!m.has(k)) m.set(k, []); m.get(k).push(n); }
  });
  return {
    nearest(x, z, maxD = 60) {
      let best = null; const r = Math.ceil(maxD / cell);
      const ci = Math.floor(x / cell), cj = Math.floor(z / cell), seen = new Set();
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        const L = m.get(key(i, j)); if (!L) continue;
        for (const n of L) { if (seen.has(n)) continue; seen.add(n); const s = segs[n]; const q = segDist(x, z, s[0], s[1], s[2], s[3]); if (q.d <= maxD && (!best || q.d < best.d)) { best = q; best.seg = s; } }
      }
      return best;
    },
  };
}

// ═══════════════════════════════ buildings ═══════════════════════════════════════════════════════════════════
const Z3 = [0, 0, 0];
const FH = 2.9;                                   // storey height

// snow on a horizontal rectangle: centre (cx, cz), unit axes a1 / a2 (x, z), half sizes h1 / h2, lying at y; th thick at snow = 1
function snowRect(S, cx, cz, a1x, a1z, a2x, a2z, h1, h2, y, th, round = 0.4) {
  const ins = Math.min(th * round, h1 * 0.45, h2 * 0.45);
  const P = (p, q) => [cx + a1x * p + a2x * q, y - 0.004, cz + a1z * p + a2z * q];
  const b = [P(-h1, -h2), P(h1, -h2), P(h1, h2), P(-h1, h2)];
  const sg = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const off = sg.map(([p, q]) => [a1x * p * ins + a2x * q * ins, th, a1z * p * ins + a2z * q * ins]);
  S.quad(b[0], b[1], b[2], b[3], [0, 1, 0], off);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, mx = (b[i][0] + b[j][0]) / 2 - cx, mz = (b[i][2] + b[j][2]) / 2 - cz;
    S.quad(b[i], b[j], b[j], b[i], [mx, 0.2, mz], [Z3, Z3, off[j], off[i]]);
  }
}
// a box given in facade coordinates: x along the wall, y absolute, depth d (0 = wall face, + into the wall, - proud)
// skip bits: 1 right end, 2 left end, 4 top, 8 bottom, 16 back (inside the wall), 32 front
function fcbox(G, fc, x0, x1, y0, y1, d0, d1, skip = 16) {
  const c = fc.at((x0 + x1) / 2, (y0 + y1) / 2, (d0 + d1) / 2);
  G.obox(c, fc.D, [0, 1, 0], [-fc.nx, 0, -fc.nz], Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(d1 - d0) / 2, skip);
}
const THIN = 1 | 2 | 8 | 16;                       // bands 1-2 cm proud: front + top only

// a wall face with rectangular holes, cut into strips
function wallHoles(W, fc, y0, y1, holes, xa = 0, xb = fc.L) {
  const xs = [xa, xb], ys = [y0, y1];
  for (const h of holes) { xs.push(clamp(h.x0, xa, xb), clamp(h.x1, xa, xb)); ys.push(clamp(h.y0, y0, y1), clamp(h.y1, y0, y1)); }
  const U = [...new Set(xs.map((v) => Math.round(v * 1e4) / 1e4))].sort((p, q) => p - q);
  const V = [...new Set(ys.map((v) => Math.round(v * 1e4) / 1e4))].sort((p, q) => p - q);
  const emit = (p, q, r, s) => W.quad(fc.at(p, r), fc.at(q, r), fc.at(q, s), fc.at(p, s), fc.N);
  for (let j = 0; j < V.length - 1; j++) {
    const ya = V[j], yb = V[j + 1]; if (yb - ya < 1e-3) continue; const ym = (ya + yb) / 2;
    let run = null;
    for (let i = 0; i < U.length - 1; i++) {
      const p = U[i], q = U[i + 1]; if (q - p < 1e-3) continue; const xm = (p + q) / 2;
      let hole = false; for (const h of holes) if (xm > h.x0 && xm < h.x1 && ym > h.y0 && ym < h.y1) { hole = true; break; }
      if (!hole) { if (run === null) run = p; } else if (run !== null) { emit(run, p, ya, yb); run = null; }
    }
    if (run !== null) emit(run, U[U.length - 1], ya, yb);
  }
}
function layoutCols(L, w, pitch, margin) {
  if (L < w + 0.7) return [];
  if (L < 2 * margin + w) return [L / 2];
  const n = Math.floor((L - 2 * margin - w) / pitch) + 1, span = (n - 1) * pitch, x0 = (L - span) / 2;
  const out = []; for (let i = 0; i < n; i++) out.push(x0 + i * pitch);
  return out;
}
function groundRange(H, F, a, b) {
  let lo = Infinity, hi = -Infinity;
  for (const s of [-a, 0, a]) for (const t of [-b, 0, b]) { const p = F.p(s, 0, t); const h = H(p[0], p[2]); if (h < lo) lo = h; if (h > hi) hi = h; }
  return [lo, hi];
}
function blockIndex(blocks, cell = 32) {
  const m = new Map(), key = (i, j) => i * 100003 + j;
  blocks.forEach((bk, n) => {
    const r = Math.hypot(bk.a, bk.b) + 0.5;
    for (let i = Math.floor((bk.F.cx - r) / cell); i <= Math.floor((bk.F.cx + r) / cell); i++)
      for (let j = Math.floor((bk.F.cz - r) / cell); j <= Math.floor((bk.F.cz + r) / cell); j++) { const k = key(i, j); if (!m.has(k)) m.set(k, []); m.get(k).push(n); }
  });
  return {
    inside(x, z, self, margin = 0.1) {
      const L = m.get(key(Math.floor(x / cell), Math.floor(z / cell))); if (!L) return null;
      let best = null;
      for (const n of L) {
        const bk = blocks[n]; if (bk === self) continue;
        const dx = x - bk.F.cx, dz = z - bk.F.cz;
        if (Math.abs(dx * bk.F.ux + dz * bk.F.uz) < bk.a - margin && Math.abs(dx * bk.F.vx + dz * bk.F.vz) < bk.b - margin) { if (!best || (bk.yE ?? 0) > (best.yE ?? 0)) best = bk; }
      }
      return best;
    },
  };
}

// ── one rectangular block: plinth, walls with openings, gable ends, cornice, roof, snow, chimneys, fire ────────────
// blk: {F, a, b, yB, yF, yE, pitch, wall, wallCol, plinthCol, frameCol, surroundCol, shutterCol, doorCol, slateCol,
//       ops: [4 lists of {x0, x1, y0, y1, kind, lit, shut, shutters}], roof: {ov, vo, thk, snowT} | null, snowK,
//       chimneys: [{s, t, w, d, top, mat, col, smoke}], cornice, surround, lintel, burning, hole}
function buildBlock(ctx, B, blk) {
  const { F, a, b, yB, yF, yE } = blk;
  B.setOrg(F.cx, 0, F.cz);
  const W = B[blk.wall]; W.color(blk.wallCol);
  const tanP = Math.tan(blk.pitch);
  for (const k of ['stucco', 'stone', 'brick', 'sand']) B[k].set('aSpan', blk.yF - 0.25, blk.yE);
  // plinth (a stone base course 4 cm proud; its top ledge catches a line of snow)
  B.stone.color(blk.plinthCol);
  B.stone.fbox(F, -a - 0.04, a + 0.04, yB, yF, -b - 0.04, b + 0.04, 8);
  for (let side = 0; side < 4; side++) {
    const fc = facade(F, side, a, b);
    W.color(blk.wallCol);
    wallHoles(W, fc, yF, yE, blk.ops[side]);
    if (side >= 2 && blk.roof) W.poly([fc.at(0, yE), fc.at(fc.L, yE), fc.at(fc.L / 2, yE + b * tanP)], fc.N);
    if (side < 2 && blk.cornice && blk.roof) {
      const G = blk.wall === 'stucco' ? B.trim : W; G.color(blk.wall === 'stucco' ? blk.surroundCol : blk.wallCol);
      fcbox(G, fc, -0.04, fc.L + 0.04, yE - 0.24, yE, -0.11, 0, 16 | 4);
    }
    for (const op of blk.ops[side]) emitOpening(ctx, B, blk, fc, op);
  }
  if (blk.roof) emitRoof(ctx, B, blk);
  else { W.color(blk.wallCol); W.fbox(F, -a, a, yE - 0.02, yE + 0.25, -b, b, 8); }
  for (const k of ['stucco', 'stone', 'brick', 'sand']) B[k].set('aSpan', -1e4, 1e5);
  for (const ch of blk.chimneys || []) emitChimney(ctx, B, blk, ch);
  if (blk.burning) emitFireInside(ctx, B, blk);
  if (blk.extra) blk.extra(ctx, B, blk);
}

function emitOpening(ctx, B, blk, fc, op) {
  const W = B[blk.wall]; W.color(blk.wallCol);
  const { x0, x1, y0, y1 } = op, D = op.depth ?? 0.22;
  // reveals
  W.quad(fc.at(x0, y0, 0), fc.at(x0, y0, D), fc.at(x0, y1, D), fc.at(x0, y1, 0), fc.D);
  W.quad(fc.at(x1, y0, 0), fc.at(x1, y0, D), fc.at(x1, y1, D), fc.at(x1, y1, 0), [-fc.D[0], 0, -fc.D[2]]);
  W.quad(fc.at(x0, y1, 0), fc.at(x1, y1, 0), fc.at(x1, y1, D), fc.at(x0, y1, D), [0, -1, 0]);
  if (op.kind !== 'door' && op.kind !== 'barn') W.quad(fc.at(x0, y0, 0), fc.at(x1, y0, 0), fc.at(x1, y0, D), fc.at(x0, y0, D), [0, 1, 0]);
  const xm = (x0 + x1) / 2, w = x1 - x0;
  if (blk.burning) {
    // burnt out: no glass, frames gone, soot licking up the wall above the opening
    if (op.kind === 'win' || op.kind === 'door') {
      const S = B.soot, hgt = Math.min(2.4, 1.2 + w), K = [0, 0, 0];
      const rowsY = [y1 - 0.06, y1 + hgt * 0.45, y1 + hgt], spread = [[-0.05, 0.12], [-0.3, 0.28], [-0.55, 0.45]], al = [[0, 235, 0], [0, 150, 0], [0, 0, 0]];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        const X = (rr, cc) => cc === 0 ? x0 + spread[rr][0] - (rr ? 0.2 : 0.1) : cc === 1 ? xm + (rr ? (hash2i(Math.round(xm * 10), rr, 5) - 0.5) * 0.4 : 0) : x1 + spread[rr][1] + (rr ? 0.2 : 0.1);
        const P = (rr, cc) => fc.at(X(rr, cc), rowsY[rr], -0.012), Aa = (rr, cc) => [...K, al[rr][cc]];
        S.poly([P(r, c), P(r, c + 1), P(r + 1, c + 1), P(r + 1, c)], fc.N, null, [Aa(r, c), Aa(r, c + 1), Aa(r + 1, c + 1), Aa(r + 1, c)]);
      }
      if (op.fireWin) ctx.anchors.fireWindows.push(new THREE.Vector3(...fc.at(xm, (y0 + y1) / 2, 0.3)));
    }
    return;
  }
  const T = B.trim;
  if (op.kind === 'win' || op.kind === 'attic') {
    const small = op.kind === 'attic' || w < 0.8;
    if (blk.surround && op.kind === 'win') {                    // painted / stone surround
      T.color(blk.surroundCol);
      fcbox(T, fc, x0 - 0.13, x0, y0 - 0.06, y1, -0.012, 0, THIN);
      fcbox(T, fc, x1, x1 + 0.13, y0 - 0.06, y1, -0.012, 0, THIN);
      fcbox(T, fc, x0 - 0.13, x1 + 0.13, y1, y1 + 0.17, -0.014, 0, THIN);
    } else if (blk.lintel && op.kind === 'win') {
      B.stone.color(blk.lintelCol);
      fcbox(B.stone, fc, x0 - 0.12, x1 + 0.12, y1, y1 + 0.2, -0.015, 0.05, 16);
    }
    B.wood.swapUV = true;
    if (op.shut) {                                              // closed shutters
      B.wood.color(blk.shutterCol);
      fcbox(B.wood, fc, x0 + 0.01, xm - 0.006, y0 + 0.01, y1 - 0.01, 0.08, 0.11, 16 | 8);
      fcbox(B.wood, fc, xm + 0.006, x1 - 0.01, y0 + 0.01, y1 - 0.01, 0.08, 0.11, 16 | 8);
    } else {
      const fw = small ? 0.055 : 0.07, df = 0.13, dp = 0.17;
      T.color(blk.frameCol);
      const bar = (p, q, r, s, d) => T.quad(fc.at(p, r, d), fc.at(q, r, d), fc.at(q, s, d), fc.at(p, s, d), fc.N);
      bar(x0, x0 + fw, y0, y1, df); bar(x1 - fw, x1, y0, y1, df); bar(x0 + fw, x1 - fw, y0, y0 + fw, df); bar(x0 + fw, x1 - fw, y1 - fw, y1, df);
      T.quad(fc.at(x0 + fw, y0 + fw, df), fc.at(x0 + fw, y1 - fw, df), fc.at(x0 + fw, y1 - fw, dp), fc.at(x0 + fw, y0 + fw, dp), fc.D);
      T.quad(fc.at(x1 - fw, y0 + fw, df), fc.at(x1 - fw, y1 - fw, df), fc.at(x1 - fw, y1 - fw, dp), fc.at(x1 - fw, y0 + fw, dp), [-fc.D[0], 0, -fc.D[2]]);
      T.quad(fc.at(x0 + fw, y1 - fw, df), fc.at(x1 - fw, y1 - fw, df), fc.at(x1 - fw, y1 - fw, dp), fc.at(x0 + fw, y1 - fw, dp), [0, -1, 0]);
      T.quad(fc.at(x0 + fw, y0 + fw, df), fc.at(x1 - fw, y0 + fw, df), fc.at(x1 - fw, y0 + fw, dp), fc.at(x0 + fw, y0 + fw, dp), [0, 1, 0]);
      if (!small) {
        const bw = 0.045, yt = y0 + (y1 - y0) * 0.66;
        bar(xm - bw / 2, xm + bw / 2, y0 + fw, y1 - fw, df + 0.012);
        bar(x0 + fw, x1 - fw, yt - bw / 2, yt + bw / 2, df + 0.006);
      }
      B.glass.set('aLit', op.lit || 0);
      B.glass.quad(fc.at(x0, y0, dp), fc.at(x1, y0, dp), fc.at(x1, y1, dp), fc.at(x0, y1, dp), fc.N);
      if (op.shutters) {                                         // open shutters folded back against the wall
        B.wood.color(blk.shutterCol);
        const ww = w / 2 + 0.02;
        fcbox(B.wood, fc, x0 - ww - 0.03, x0 - 0.03, y0 - 0.02, y1 + 0.02, -0.045, -0.006, 16);
        fcbox(B.wood, fc, x1 + 0.03, x1 + ww + 0.03, y0 - 0.02, y1 + 0.02, -0.045, -0.006, 16);
      }
    }
    B.wood.swapUV = false;
    // sill + its snow
    const SM = blk.wall === 'stucco' || blk.wall === 'brick' ? B.stone : B.stone;
    SM.color(blk.sillCol);
    fcbox(SM, fc, x0 - 0.06, x1 + 0.06, y0 - 0.065, y0 + 0.004, -0.065, 0.13, 16);
    if (blk.snowK > 0.2) {
      const c = fc.at(xm, 0, 0.03);
      snowRect(B.snow, c[0], c[2], fc.dx, fc.dz, -fc.nx, -fc.nz, w / 2 + 0.05, 0.09, y0 + 0.004, 0.055 + 0.03 * blk.snowK);
    }
  } else if (op.kind === 'door') {
    const Wd = B.wood; Wd.color(blk.doorCol); Wd.swapUV = true;
    const yl = Math.min(y1, y0 + 2.15);
    Wd.quad(fc.at(x0, y0, 0.12), fc.at(x1, y0, 0.12), fc.at(x1, yl, 0.12), fc.at(x0, yl, 0.12), fc.N);
    fcbox(Wd, fc, x0 + 0.13, x1 - 0.13, y0 + 0.22, y0 + 0.95, 0.1, 0.12, THIN);
    fcbox(Wd, fc, x0 + 0.13, x1 - 0.13, y0 + 1.15, yl - 0.15, 0.1, 0.12, THIN);
    Wd.swapUV = false;
    T.color(blk.frameCol);
    fcbox(T, fc, x0, x0 + 0.07, y0, y1, 0.07, 0.12, 16 | 8);
    fcbox(T, fc, x1 - 0.07, x1, y0, y1, 0.07, 0.12, 16 | 8);
    if (y1 > yl + 0.15) {
      fcbox(T, fc, x0 + 0.07, x1 - 0.07, yl, yl + 0.07, 0.07, 0.12, 16);
      B.glass.set('aLit', op.lit || 0);
      B.glass.quad(fc.at(x0, yl, 0.15), fc.at(x1, yl, 0.15), fc.at(x1, y1, 0.15), fc.at(x0, y1, 0.15), fc.N);
    }
    if (blk.surround) { T.color(blk.surroundCol); fcbox(T, fc, x0 - 0.14, x0, y0, y1, -0.012, 0, THIN); fcbox(T, fc, x1, x1 + 0.14, y0, y1, -0.012, 0, THIN); fcbox(T, fc, x0 - 0.14, x1 + 0.14, y1, y1 + 0.2, -0.014, 0, THIN); }
    else if (blk.lintel) { B.stone.color(blk.lintelCol); fcbox(B.stone, fc, x0 - 0.14, x1 + 0.14, y1, y1 + 0.24, -0.015, 0.05, 16); }
    // threshold / steps down to the ground
    const gp = fc.at(xm, 0, -0.9), g = ctx.heightAt(gp[0], gp[2]), drop = y0 - g;
    B.stone.color(blk.sillCol);
    if (drop > 0.14) {
      const n = Math.min(7, Math.ceil(drop / 0.18));
      for (let i = 0; i < n; i++) fcbox(B.stone, fc, x0 - 0.18, x1 + 0.18, g - 0.4, y0 - i * drop / n, -0.3 * (i + 1), 0, 16);
    } else fcbox(B.stone, fc, x0 - 0.08, x1 + 0.08, Math.min(y0 - 0.12, g - 0.1), y0 + 0.012, -0.22, 0.12, 16);
    if (op.anchor) ctx.anchors.farmDoor.set(gp[0], g, gp[2]);
  } else if (op.kind === 'barn') {
    const Wd = B.wood; Wd.color(blk.barnCol || PAL.woodDark); Wd.swapUV = true;
    const yl = y1;
    fcbox(Wd, fc, x0 + 0.02, xm - 0.01, y0, yl - 0.02, 0.1, 0.16, 16 | 8);
    fcbox(Wd, fc, xm + 0.01, x1 - 0.02, y0, yl - 0.02, 0.1, 0.16, 16 | 8);
    for (const yy of [y0 + 0.5, y0 + (yl - y0) * 0.5, yl - 0.5]) {        // ledges / braces
      fcbox(Wd, fc, x0 + 0.1, xm - 0.1, yy - 0.08, yy + 0.08, 0.06, 0.1, 16);
      fcbox(Wd, fc, xm + 0.1, x1 - 0.1, yy - 0.08, yy + 0.08, 0.06, 0.1, 16);
    }
    Wd.swapUV = false; Wd.color(PAL.woodDark);
    fcbox(Wd, fc, x0 - 0.35, x1 + 0.35, y1, y1 + 0.34, -0.04, 0.2, 16);                // oak lintel beam
  } else {                                                                              // slit / vent: dark void
    B.dark.quad(fc.at(x0, y0, D), fc.at(x1, y0, D), fc.at(x1, y1, D), fc.at(x0, y1, D), fc.N);
  }
}

function emitRoof(ctx, B, blk) {
  const { F, a, b, yE } = blk, R = blk.roof, S = B.slate;
  const cs = Math.cos(blk.pitch), sn = Math.sin(blk.pitch), tanP = sn / cs;
  const sA = -a - (R.voA ?? R.vo), sB = a + (R.voB ?? R.vo);
  S.color(blk.slateCol); S.set('aSnowK', blk.snowK);
  for (const k of [1, -1]) {
    const tE = k * (b + R.ov);
    const yR = yE + R.thk + b * tanP, yEe = yE + R.thk - R.ov * tanP;
    const nn = [F.vx * k * sn, cs, F.vz * k * sn];
    const holed = blk.hole && (blk.hole.k === k || blk.hole.k === 0);
    const pieces = holed ? [[sA, blk.hole.s0], [blk.hole.s1, sB]] : [[sA, sB]];
    for (const [s0, s1] of pieces) {
      if (s1 - s0 < 0.05) continue;
      S.quad(F.p(s0, yEe, tE), F.p(s1, yEe, tE), F.p(s1, yR, 0), F.p(s0, yR, 0), nn);
      S.quad(F.p(s0, yEe - R.thk, tE), F.p(s1, yEe - R.thk, tE), F.p(s1, yR - R.thk, 0), F.p(s0, yR - R.thk, 0), [-nn[0], -nn[1], -nn[2]]);
      S.quad(F.p(s0, yEe - R.thk, tE), F.p(s1, yEe - R.thk, tE), F.p(s1, yEe, tE), F.p(s0, yEe, tE), [F.vx * k, 0, F.vz * k]);
      for (const [s, sg] of [[s0, -1], [s1, 1]]) S.quad(F.p(s, yR - R.thk, 0), F.p(s, yR, 0), F.p(s, yEe, tE), F.p(s, yEe - R.thk, tE), [F.ux * sg, 0, F.uz * sg]);
    }
    if (blk.snowK > 0.45 && R.snowT > 0) roofSnow(B.snow, F, blk, k, pieces.filter(([p, q]) => q - p > 0.4), cs, sn);
  }
  // ridge tiles
  if (!blk.hole) { S.color(blk.slateCol); const yR = yE + R.thk + b * tanP; S.fbox(F, sA, sB, yR - 0.03, yR + 0.07, -0.1, 0.1, 8 | 16 | 32); }
  if (blk.icicles) icicles(B.snow, F, blk, cs, sn);
  for (const d of blk.dormers || []) emitDormer(ctx, B, blk, d);
}
// a gabled dormer on roof side k: rendered front with a window, slate cheeks, a small steep roof running back into the main one
function emitDormer(ctx, B, blk, d) {
  const { F, b, yE } = blk, R = blk.roof, tanP = Math.tan(blk.pitch), k = d.k;
  const yTop = (t) => yE + R.thk + (b - Math.abs(t)) * tanP;
  const tf = k * (b - 0.6), yb = yTop(tf) - 0.1, ye = yb + 1.6, w = d.w / 2, dp = 52 * DEG, yr = ye + (w + 0.12) * Math.tan(dp);
  const tBack = (y) => k * Math.max(0.15, b - (y - yE - R.thk) / tanP);
  const tbE = tBack(ye), tbR = tBack(yr), s0 = d.s - w, s1 = d.s + w;
  const fc = facadeAB(F.p(s0, 0, tf), F.p(s1, 0, tf), F.p(d.s, 0, 0));
  const W = B[blk.wall]; W.color(blk.wallCol);
  const win = { x0: fc.L / 2 - 0.38, x1: fc.L / 2 + 0.38, y0: yb + 0.45, y1: yb + 1.38, kind: 'win', lit: d.lit, shutters: false };
  wallHoles(W, fc, yb, ye, [win]);
  W.poly([fc.at(-0.02, ye), fc.at(fc.L + 0.02, ye), fc.at(fc.L / 2, yr - 0.14)], fc.N);
  emitOpening(ctx, B, { ...blk, surround: false, lintel: false }, fc, win);
  const S = B.slate; S.color(blk.slateCol); S.set('aSnowK', blk.snowK);
  for (const [s, sg] of [[s0, -1], [s1, 1]]) S.poly([F.p(s, yb, tf), F.p(s, ye, tf), F.p(s, ye, tbE)], [F.ux * sg, 0, F.uz * sg]);
  const tfo = tf + k * 0.16;
  for (const [s, sg] of [[s0 - 0.12, -1], [s1 + 0.12, 1]]) {
    const n = [F.ux * sg * Math.sin(dp), Math.cos(dp), F.uz * sg * Math.sin(dp)];
    S.quad(F.p(s, ye - 0.06, tfo), F.p(d.s, yr, tfo), F.p(d.s, yr, tbR), F.p(s, ye - 0.06, tbE), n);
    S.quad(F.p(s, ye - 0.06, tfo), F.p(d.s, yr, tfo), F.p(d.s, yr - 0.1, tfo), F.p(s, ye - 0.16, tfo), [F.vx * k, 0, F.vz * k]);
  }
}
// the snow blanket on one roof side: thick, rounded at the eave (it overhangs a little), thinner at the ridge
function roofSnow(S, F, blk, k, pieces, cs, sn) {
  const { b, yE } = blk, R = blk.roof, tanP = sn / cs;
  const tE = k * (b + R.ov), yR = yE + R.thk + b * tanP, yEe = yE + R.thk - R.ov * tanP;
  const nn = [F.vx * k * sn, cs, F.vz * k * sn], dd = [F.vx * k * cs, -sn, F.vz * k * cs];
  const rows = [[0, 0.7, 0], [0.5, 1, 0], [1, 1.05, 0.08], [1, 0.5, 0.16], [1, -0.12, 0.11]];
  const wants = [nn, nn, dd, [dd[0] - nn[0], dd[1] - nn[1], dd[2] - nn[2]]];
  for (const [s0, s1] of pieces) {
    const n = Math.max(1, Math.round((s1 - s0) / 1.8)), cols = [];
    for (let i = 0; i <= n; i++) {
      const s = s0 + (s1 - s0) * i / n;
      const outer = (i === 0 && s0 <= -blk.a - (R.voA ?? R.vo) + 0.02 && (R.voA ?? R.vo) > 0.02) || (i === n && s1 >= blk.a + (R.voB ?? R.vo) - 0.02 && (R.voB ?? R.vo) > 0.02);
      const th = R.snowT * (0.8 + 0.4 * hash2i(Math.round(F.cx * 3 + s * 5), Math.round(F.cz * 3) + k * 7, 11)) * (outer ? 0.8 : 1);
      cols.push(rows.map(([f, nm, dm], r) => {
        const P = F.p(s, lerp(yR, yEe, f), tE * f);
        const base = [P[0] - nn[0] * 0.012, P[1] - nn[1] * 0.012, P[2] - nn[2] * 0.012];
        const off = r === 0 ? [0, th * nm / cs, 0] : [nn[0] * th * nm + dd[0] * dm, nn[1] * th * nm + dd[1] * dm, nn[2] * th * nm + dd[2] * dm];
        return { base, off };
      }));
    }
    for (let i = 0; i < n; i++) for (let r = 0; r < rows.length - 1; r++) {
      const A = cols[i][r], Bq = cols[i + 1][r], C = cols[i + 1][r + 1], Dq = cols[i][r + 1];
      S.quad(A.base, Bq.base, C.base, Dq.base, wants[r], [A.off, Bq.off, C.off, Dq.off]);
    }
    for (const [i, sg] of [[0, -1], [n, 1]]) {
      const col = cols[i], w = [F.ux * sg, 0, F.uz * sg];
      for (let r = 0; r < rows.length - 1; r++) S.quad(col[r].base, col[r + 1].base, col[r + 1].base, col[r].base, w, [Z3, Z3, col[r + 1].off, col[r].off]);
    }
  }
}
function icicles(S, F, blk, cs, sn) {
  const { a, b, yE } = blk, R = blk.roof, tanP = sn / cs;
  const yEe = yE + R.thk - R.ov * tanP - R.thk;
  for (const k of [1, -1]) {
    const tE = k * (b + R.ov - 0.03);
    for (let s = -a + 0.3; s < a - 0.2; s += 0.23 + 0.5 * hash2i(Math.round(s * 13), k, 3)) {
      const h = hash2i(Math.round(s * 31), k * 5, 9); if (h < 0.35) continue;
      const len = 0.08 + Math.pow(h, 3) * 0.55, r = 0.018 + 0.02 * h;
      const c = F.p(s, yEe + 0.01, tE);
      const p1 = [c[0] + F.ux * r, c[1], c[2] + F.uz * r], p2 = [c[0] - F.ux * r * 0.5 + F.vx * r * 0.8, c[1], c[2] - F.uz * r * 0.5 + F.vz * r * 0.8], p3 = [c[0] - F.ux * r * 0.5 - F.vx * r * 0.8, c[1], c[2] - F.uz * r * 0.5 - F.vz * r * 0.8];
      const tip = [0, -len, 0];
      S.poly([p1, p2, p1], [F.vx * k, 0, F.vz * k], [Z3, Z3, tip]);
      S.poly([p2, p3, p2], [F.vx * k, 0, F.vz * k], [Z3, Z3, tip]);
      S.poly([p3, p1, p3], [-F.vx * k, 0, -F.vz * k], [Z3, Z3, tip]);
    }
  }
}
function emitChimney(ctx, B, blk, ch) {
  const { F } = blk, G = B[ch.mat]; G.color(ch.col);
  const y0 = blk.yE - 0.3, y1 = ch.top;
  G.fbox(F, ch.s - ch.w / 2, ch.s + ch.w / 2, y0, y1, ch.t - ch.d / 2, ch.t + ch.d / 2, 8 | 4);
  B.stone.color(PAL.sill[1]);
  B.stone.fbox(F, ch.s - ch.w / 2 - 0.05, ch.s + ch.w / 2 + 0.05, y1, y1 + 0.07, ch.t - ch.d / 2 - 0.05, ch.t + ch.d / 2 + 0.05, 8);
  const fl = F.p(ch.s, y1 + 0.072, ch.t);
  B.dark.obox(fl, [F.ux, 0, F.uz], [0, 1, 0], [F.vx, 0, F.vz], Math.min(0.13, ch.w / 2 - 0.1), 0.002, Math.min(0.2, ch.d / 2 - 0.1), 8);
  if (blk.snowK > 0.2 && !ch.smoke) {
    const c = F.p(ch.s, 0, ch.t);
    snowRect(B.snow, c[0], c[2], F.ux, F.uz, F.vx, F.vz, ch.w / 2 + 0.04, ch.d / 2 + 0.04, y1 + 0.07, 0.1 + 0.05 * blk.snowK);
  } else if (blk.snowK > 0.2) {                       // a warm flue: snow only on the rim
    for (const sg of [-1, 1]) { const c = F.p(ch.s, 0, ch.t + sg * (ch.d / 2 - 0.02)); snowRect(B.snow, c[0], c[2], F.ux, F.uz, F.vx, F.vz, ch.w / 2 + 0.04, 0.07, y1 + 0.07, 0.07); }
  }
  const top = new THREE.Vector3(...F.p(ch.s, y1 + 0.1, ch.t));
  ctx.anchors.chimneys.push(top);
  if (ch.smoke) { ctx.anchors.smoke.push(top); const L = ctx.anchors.smokeBy[ctx.place || 'other'] || (ctx.anchors.smokeBy[ctx.place || 'other'] = []); L.push(top); }
}
// a burnt-out house: glowing interior behind the empty windows, charred rafters across the roof opening
function emitFireInside(ctx, B, blk) {
  const { F, a, b, yF, yE } = blk, ins = 0.3, Fi = B.fire;
  const s0 = -a + ins, s1 = a - ins, t0 = -b + ins, t1 = b - ins;
  const bands = [[yF, yF + 1.3, 1.0], [yF + 1.3, yF + FH, 0.6], [yF + FH, yE + 1.0, 0.28]];
  for (const [ya, yb, heat] of bands) {
    if (ya >= yb) continue;
    Fi.set('aLit', heat);
    Fi.quad(F.p(s0, ya, t1), F.p(s1, ya, t1), F.p(s1, yb, t1), F.p(s0, yb, t1), [-F.vx, 0, -F.vz]);
    Fi.quad(F.p(s0, ya, t0), F.p(s1, ya, t0), F.p(s1, yb, t0), F.p(s0, yb, t0), [F.vx, 0, F.vz]);
    Fi.quad(F.p(s1, ya, t0), F.p(s1, ya, t1), F.p(s1, yb, t1), F.p(s1, yb, t0), [-F.ux, 0, -F.uz]);
    Fi.quad(F.p(s0, ya, t0), F.p(s0, ya, t1), F.p(s0, yb, t1), F.p(s0, yb, t0), [F.ux, 0, F.uz]);
  }
  Fi.set('aLit', 1.0);
  Fi.quad(F.p(s0, yF + 0.1, t0), F.p(s1, yF + 0.1, t0), F.p(s1, yF + 0.1, t1), F.p(s0, yF + 0.1, t1), [0, 1, 0]);
  // wall tops (the masonry stands, charred at the crown)
  B.char.fbox(F, -a, a, yE - 0.02, yE + 0.04, b - ins, b, 8); B.char.fbox(F, -a, a, yE - 0.02, yE + 0.04, -b, -b + ins, 8);
  // rafters across the opening, some burnt through, and the sagging ridge beam
  const h = blk.hole; if (!h) return;
  const tanP = Math.tan(blk.pitch), yR = yE + b * tanP, R = rng(Math.round(F.cx * 7 + F.cz * 13));
  for (const k of (h.k === 0 ? [1, -1] : [h.k])) {
    for (let s = h.s0 + 0.25; s < h.s1 - 0.1; s += 0.62 + R() * 0.12) {
      if (R() < 0.12) continue;
      const frac = R() < 0.35 ? 0.35 + R() * 0.45 : 1;
      const pA = F.p(s, yE + 0.08, k * b), pB = F.p(s, yR - 0.1, 0);
      const pE = [lerp(pA[0], pB[0], frac), lerp(pA[1], pB[1], frac), lerp(pA[2], pB[2], frac)];
      const ax = [pE[0] - pA[0], pE[1] - pA[1], pE[2] - pA[2]]; const L = Math.hypot(...ax); ax[0] /= L; ax[1] /= L; ax[2] /= L;
      const az = [F.ux, 0, F.uz], ay = [ax[1] * az[2] - ax[2] * az[1], ax[2] * az[0] - ax[0] * az[2], ax[0] * az[1] - ax[1] * az[0]];
      B.char.obox([(pA[0] + pE[0]) / 2, (pA[1] + pE[1]) / 2, (pA[2] + pE[2]) / 2], ax, ay, az, L / 2, 0.08, 0.05);
    }
  }
  const sag = 0.25 + R() * 0.3, sm = (h.s0 + h.s1) / 2;
  for (const [sa, ya, sb, yb] of [[h.s0 - 0.6, 0, sm - 0.1, sag], [sm + 0.25, sag * 0.7, h.s1 + 0.6, 0]]) {
    const pA = F.p(sa, yR - 0.12 - ya, 0), pB = F.p(sb, yR - 0.12 - yb, 0);
    const ax = [pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]]; const L = Math.hypot(...ax); ax[0] /= L; ax[1] /= L; ax[2] /= L;
    const az = [F.vx, 0, F.vz], ay = [ax[1] * az[2] - ax[2] * az[1], ax[2] * az[0] - ax[0] * az[2], ax[0] * az[1] - ax[1] * az[0]];
    B.char.obox([(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, (pA[2] + pB[2]) / 2], ax, ay, az, L / 2, 0.1, 0.09);
  }
  const fp = F.p(sm, yE + b * tanP * 0.35, (h.k === 0 ? 0 : h.k * b * 0.45));
  ctx.anchors.fires.push(new THREE.Vector3(...fp));
}

// ── from footprints to blocks ───────────────────────────────────────────────────────────────────────────────
const pick = (R, list) => list[Math.floor(R() * list.length) % list.length];
function pickW(R, pairs) { let s = 0; for (const [, w] of pairs) s += w; let x = R() * s; for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; } return pairs[pairs.length - 1][0]; }

const STYLE = {
  town: { wall: [['stucco', 0.6], ['stone', 0.36], ['brick', 0.04]], f3: 0.52, shutters: 0.22, winW: [1.0, 1.12], winH0: 1.62, winH: 1.5,
    pitchX: [2.3, 2.85], pitch: [45, 50], gableWin: 0.5, lit: 0.34, smoke: 0.34, surround: 0.75, cornice: 0.65, chim: 'brick', dark: 0.18, dormer: 0.38 },
  village: { wall: [['stucco', 0.32], ['stone', 0.68]], f3: 0.03, shutters: 0.5, winW: [0.88, 1.0], winH0: 1.38, winH: 1.3,
    pitchX: [2.5, 3.2], pitch: [45, 50], gableWin: 0.65, lit: 0.45, smoke: 0.5, surround: 0.35, cornice: 0.1, chim: 'stone', dark: 0.35, dormer: 0.06 },
  medieval: { wall: [['stucco', 0.3], ['stone', 0.62], ['sand', 0.08]], f3: 0.35, shutters: 0.55, winW: [0.7, 0.85], winH0: 1.2, winH: 1.1,
    pitchX: [2.2, 2.9], pitch: [52, 60], gableWin: 0.8, lit: 0.5, smoke: 0.5, surround: 0.0, cornice: 0.0, chim: 'stone', dark: 0.55, dormer: 0.2 },
  american: { wall: [['stucco', 0.85], ['brick', 0.15]], f3: 0.0, shutters: 0.7, winW: [0.9, 1.05], winH0: 1.5, winH: 1.4,
    pitchX: [2.6, 3.4], pitch: [34, 40], gableWin: 0.7, lit: 0.5, smoke: 0.2, surround: 0.2, cornice: 0.3, chim: 'brick', dark: 0.2, dormer: 0.15 },
};

// footprint -> 1..3 rectangles -> blocks whose ridge follows the street (front houses) or the long side
function blocksFromFootprint(ctx, fp, region, R) {
  const r = mabr(fp.p); if (!r || r.a < 1.1 || r.b < 1.1) return [];
  const area = Math.abs(polyArea(fp.p)), fill = area / r.area;
  const rects = fill < 0.8 && r.area > 50 ? decompose(fp.p, r) : [r];
  const st = ctx.roads.nearest(r.cx, r.cz, 26);
  const out = [];
  rects.forEach((q, qi) => {
    let ux = q.ux, uz = q.uz, a = q.a, b = q.b;
    if (a < b) { const t = ux; ux = -uz; uz = t; const tt = a; a = b; b = tt; }
    let parts = [{ cx: q.cx, cz: q.cz, ux, uz, a, b, rear: qi > 0 }];
    if (st && qi === 0 && region === 'town') {
      const sl = Math.hypot(st.dx, st.dz) || 1, sdx = st.dx / sl, sdz = st.dz / sl, along = Math.abs(ux * sdx + uz * sdz);
      if (along < 0.55) {
        const sg = Math.sign((st.x - q.cx) * ux + (st.z - q.cz) * uz) || 1;
        const D1 = clamp(2 * a * 0.55, 8, 11);
        if (2 * a > 13 && 2 * a - D1 >= 3.2) {
          const sF = sg * (a - D1 / 2), sR = -sg * D1 / 2;
          parts = [{ cx: q.cx + ux * sF, cz: q.cz + uz * sF, ux: -uz, uz: ux, a: b, b: D1 / 2, front: true },
            { cx: q.cx + ux * sR, cz: q.cz + uz * sR, ux, uz, a: a - D1 / 2, b, rear: true }];
        } else if (a / b < 1.4) parts = [{ cx: q.cx, cz: q.cz, ux: -uz, uz: ux, a: b, b: a, front: true }];
      }
    }
    for (const p of parts) {
      if (p.a < p.b && !p.front) { const t = p.ux; p.ux = -p.uz; p.uz = t; const tt = p.a; p.a = p.b; p.b = tt; }
      if (p.b > 7.2 && !p.rear) {                                   // double pile: two parallel roofs
        const vx = -p.uz, vz = p.ux;
        for (const sg of [-1, 1]) out.push({ ...p, cx: p.cx + vx * sg * p.b / 2, cz: p.cz + vz * sg * p.b / 2, b: p.b / 2 });
      } else out.push(p);
    }
  });
  return out.map((p) => ({ F: frame(p.cx, p.cz, p.ux, p.uz), a: p.a + 0.03, b: p.b + 0.03, rear: !!p.rear, fp, street: st }));
}

// materials, colours, heights for every block of one footprint
function dressFootprint(ctx, blocks, style, R, region) {
  if (!blocks.length) return;
  const fp = blocks[0].fp, area = Math.abs(polyArea(fp.p));
  const wall = pickW(R, style.wall);
  const lv = parseInt(fp.lv, 10);
  let floors = Number.isFinite(lv) && lv > 0 ? clamp(lv, 1, 4) : (R() < style.f3 ? 3 : 2);
  const shed = area < 36;
  const dark = R() < style.dark;
  const common = {
    wall, wallCol: pick(R, wall === 'stucco' ? palOf('stucco') : wall === 'brick' ? PAL.brick : PAL.stone),
    plinthCol: lin(pick(R, ['#8E8C88', '#7C7B78', '#9A968E', '#6E6C6A'])),
    frameCol: dark ? pick(R, PAL.trimDark) : pick(R, palOf('trim')),
    surroundCol: wall === 'stucco' ? lin(pick(R, ['#F2F0EA', '#DCD8CF', '#C9C5BC', '#E9E4D8', '#B9B4AA'])) : PAL.trim[0],
    shutterCol: pick(R, palOf('shutter')), doorCol: pick(R, palOf('door')), slateCol: pick(R, palOf('slate')), sillCol: pick(R, PAL.sill),
    lintelCol: lin(pick(R, ['#E6E0D4', '#CFC8BA', '#A8A298'])),
    surround: wall === 'stucco' && R() < style.surround, lintel: wall !== 'stucco', cornice: R() < style.cornice,
    shutters: R() < style.shutters, occupied: R() < style.lit, smoky: R() < style.smoke,
    snowK: R() < 0.86 ? 1 : R() < 0.8 ? 0.75 : 0.5,
    pitch: (style.pitch[0] + R() * (style.pitch[1] - style.pitch[0])) * DEG,
    winW: style.winW[0] + R() * (style.winW[1] - style.winW[0]), pitchX: style.pitchX[0] + R() * (style.pitchX[1] - style.pitchX[0]),
    gableWin: R() < style.gableWin,
  };
  for (const blk of blocks) {
    Object.assign(blk, common);
    blk.shed = shed || (blk.rear && blk.a * blk.b * 4 < 30);
    blk.floors = blk.shed ? 1 : blk.rear ? Math.max(1, floors - (R() < 0.6 ? 1 : 2)) : floors;
    const [lo, hi] = groundRange(ctx.heightAt, blk.F, blk.a, blk.b);
    blk.yB = lo - 0.8; blk.yF = hi + (blk.shed ? 0.12 : 0.4);
    blk.yE = blk.yF + (blk.shed ? 2.5 : blk.floors * FH);
    if (blk.shed) blk.pitch = (36 + R() * 6) * DEG;
    if (blk.b > 6.2) blk.pitch = Math.min(blk.pitch, 42 * DEG);
    blk.roof = { ov: blk.shed ? 0.22 : 0.32, vo: blk.shed ? 0.1 : 0.14, thk: 0.2, snowT: 0.19 + R() * 0.1 };
    blk.region = region;
    if (region === 'village' && !blk.rear && !blk.shed && blk.a * 2 > 16.5 && blk.b * 2 < 13) {   // a long Ardennes farm
      blk.farm = true; blk.floors = 2; blk.yF = hi + 0.25; blk.yE = blk.yF + 5.3; blk.shutters = R() < 0.7; blk.icicles = true;
      blk.pitch = (45 + R() * 3) * DEG; blk.roof.ov = 0.38; blk.roof.snowT = 0.24;
    }
  }
}

// window / door grid of a dressed block (needs the block index for party walls)
function planOpenings(ctx, blk, style, R) {
  const { a, b, yF, floors } = blk;
  blk.ops = [[], [], [], []];
  const w = blk.shed ? 0.7 : blk.winW;
  const rows = [];
  if (blk.shed) rows.push([yF + 1.0, yF + 1.7]);
  else for (let k = 0; k < floors; k++) {
    const y0 = yF + k * FH + (k === 0 ? 0.9 : 0.84);
    const h = k === 0 ? style.winH0 : (k === floors - 1 && floors >= 3 ? style.winH - 0.18 : style.winH);
    rows.push([y0, y0 + h]);
  }
  // the street side (front) gets the door
  let front = -1;
  if (blk.street) {
    let best = -2; for (let side = 0; side < 4; side++) { const fc = facade(blk.F, side, a, b); const d = ((blk.street.x - blk.F.cx) * fc.nx + (blk.street.z - blk.F.cz) * fc.nz); if (d > best) { best = d; front = side; } }
  } else front = R() < 0.5 ? 0 : 1;
  blk.frontSide = front;
  const blocked = (fc, x, y) => { const p = fc.at(x, 0, -0.9); const o = ctx.bidx.inside(p[0], p[2], blk); return o && y < o.yE + 0.6; };
  for (let side = 0; side < 4; side++) {
    const fc = facade(blk.F, side, a, b), gable = side >= 2;
    let cols = gable ? ((blk.gableWin || side === front) && !blk.shed ? layoutCols(fc.L, w, blk.pitchX * 1.1, 1.0) : []) : layoutCols(fc.L, w, blk.pitchX, 0.8);
    if (gable && cols.length > 2) cols = [cols[0], cols[cols.length - 1]];
    if (blk.shed && cols.length > 1) cols = [cols[Math.floor(R() * cols.length)]];
    let doorX = null;
    if (side === front && !blk.rear) {
      const free = cols.filter((x) => !blocked(fc, x, yF + 0.5));
      if (free.length) doorX = free.length > 2 ? free[R() < 0.5 ? 0 : free.length - 1] : free[free.length - 1];
      else if (fc.L > 2.0 && !blocked(fc, fc.L / 2, yF + 0.5)) doorX = fc.L / 2;
    }
    for (const xc of cols) {
      rows.forEach(([y0, y1], k) => {
        if (k === 0 && doorX !== null && Math.abs(xc - doorX) < 0.01) return;
        if (blocked(fc, xc, y0)) return;
        blk.ops[side].push({ x0: xc - w / 2, x1: xc + w / 2, y0, y1, kind: 'win', lit: blk.occupied && R() < 0.5 ? 0.45 + R() * 0.55 : 0,
          shut: R() < (blk.shed ? 0.4 : 0.07), shutters: blk.shutters && fc.L > 2.4 });
      });
    }
    if (doorX !== null) {
      const dw = blk.shed ? 0.95 : 1.1, tall = !blk.shed && R() < 0.6;
      blk.ops[side].push({ x0: doorX - dw / 2, x1: doorX + dw / 2, y0: yF, y1: yF + (tall ? 2.62 : 2.18), kind: 'door', lit: blk.occupied ? 0.6 : 0 });
    }
    // attic window in an exposed gable
    if (gable && !blk.shed && blk.roof && R() < 0.45 && !blocked(fc, fc.L / 2, blk.yE + 0.5) && fc.L > 4) {
      const y0 = blk.yE + 0.45, h = Math.min(0.9, b * Math.tan(blk.pitch) * 0.45);
      if (h > 0.45) blk.ops[side].push({ x0: fc.L / 2 - 0.32, x1: fc.L / 2 + 0.32, y0, y1: y0 + h, kind: 'attic', lit: 0 });
    }
  }
  // shutters must fit between openings
  for (let side = 0; side < 4; side++) for (const op of blk.ops[side]) if (op.shutters) {
    const ww = (op.x1 - op.x0) / 2 + 0.08, L = facade(blk.F, side, a, b).L;
    if (op.x0 - ww < 0.12 || op.x1 + ww > L - 0.12) op.shutters = false;
    for (const o2 of blk.ops[side]) if (o2 !== op && o2.y1 > op.y0 && o2.y0 < op.y1 && ((o2.x1 > op.x0 - ww && o2.x0 < op.x0) || (o2.x0 < op.x1 + ww && o2.x1 > op.x1))) op.shutters = false;
  }
}
function planChimneys(ctx, blk, style, R) {
  blk.chimneys = [];
  if (blk.shed || !blk.roof) return;
  const n = blk.rear ? (R() < 0.35 ? 1 : 0) : (R() < 0.45 ? 2 : 1);
  const yR = blk.yE + blk.roof.thk + blk.b * Math.tan(blk.pitch);
  const mat = blk.wall === 'stone' && style.chim === 'stone' ? 'stone' : blk.wall === 'stucco' && R() < 0.35 ? 'stucco' : 'brick';
  const col = mat === 'stucco' ? blk.wallCol : mat === 'stone' ? blk.wallCol : pick(R, PAL.brick);
  const ss = n === 2 ? [-1, 1] : [R() < 0.5 ? -1 : 1];
  for (const sg of ss) {
    const w = 0.48 + R() * 0.12, d = 0.7 + R() * 0.2;
    const s = sg * Math.max(0, blk.a - 0.55 - R() * 0.4);
    blk.chimneys.push({ s, t: (R() - 0.5) * 0.3, w, d, top: yR + 0.85 + R() * 0.55, mat, col, smoke: blk.smoky && !blk.burning });
  }
  // dormers on the street side of the town houses
  const roll = R();
  if (!blk.farm && !blk.burning && !blk.rear && blk.floors >= 2 && blk.b >= 3.4 && blk.a >= 2.5 && roll < (style.dormer ?? 0)) {
    const k = blk.frontSide === 1 ? -1 : blk.frontSide === 0 ? 1 : (R() < 0.5 ? 1 : -1);
    const ps = blk.a > 5.2 && R() < 0.55 ? [-blk.a * 0.42, blk.a * 0.42] : [(R() - 0.5) * blk.a * 0.3];
    blk.dormers = ps.map((s) => ({ s, k, w: 1.25 + R() * 0.3, lit: blk.occupied && R() < 0.35 ? 0.7 : 0 }));
  }
}

// ═══════════════════════════════ which footprints stood in 1944 ═══════════════════════════════════════════════
const BAD = new Set(['school', 'commercial', 'industrial', 'garages', 'garage', 'apartments', 'retail', 'office', 'hospital', 'sports_centre',
  'stadium', 'grandstand', 'construction', 'roof', 'public', 'government', 'warehouse', 'hangar', 'service', 'parking', 'carport',
  'supermarket', 'civic', 'kindergarten', 'university', 'college', 'train_station', 'transportation', 'hotel']);
const keepKind = (b) => !(BAD.has(b.k) && b.a > 400);
function findChurch(geo) {
  let best = null, bd = 1e9;
  for (const b of geo.buildings) {
    if (b.k !== 'church' && !/Saint-Pierre/i.test(b.name || '')) continue;
    const [x, z] = centroid(b.p), d = Math.hypot(x - geo.church.x, z - geo.church.z);
    if (d < bd && d < 60) { bd = d; best = b; }
  }
  return best;
}
function findPorte(geo) {
  return geo.buildings.find((b) => /Porte de Tr[eè]ves/i.test(b.name || '') && b.a < 200 && Math.hypot(centroid(b.p)[0] - geo.church.x, centroid(b.p)[1] - geo.church.z) < 150) || null;
}
// old Bastogne: within ~550-650 m of the church; the dense core round the church and the Grand-Rue kept whole, outside it
// only what lines the main roads or stands in attached rows (the regular post-war suburbs thin out); modern blocks dropped
function selectBastogne(geo, mainIdx, R) {
  const c = geo.church, axis = [];
  for (const r of geo.roads) if (/Sablon|Vivier|Mac-?Auliffe/i.test(r.name || '')) for (let k = 0; k < r.p.length - 1; k++) {
    const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1];
    if (Math.hypot(ax - c.x, az - c.z) < 900) axis.push([ax, az, bx, bz]);
  }
  const cand = [];
  for (const b of geo.buildings) {
    if (b.p.length < 3) continue;
    const [x, z] = centroid(b.p), d = Math.hypot(x - c.x, z - c.z), th = Math.atan2(z - c.z, x - c.x);
    if (d > 600 + 50 * Math.sin(3 * th + 1.3) * Math.cos(2 * th - 0.4)) continue;
    if (b.a > 700 && b.k !== 'church') continue;
    if (!keepKind(b)) continue;
    cand.push({ b, x, z, d });
  }
  const grid = new Map(), key = (i, j) => i * 100003 + j;
  cand.forEach((q, n) => { const k = key(Math.floor(q.x / 25), Math.floor(q.z / 25)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); });
  const near = (q, n) => {
    let cnt = 0; const i0 = Math.floor(q.x / 25), j0 = Math.floor(q.z / 25);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (const m of grid.get(key(i, j)) || []) {
      if (m === n) continue; const o = cand[m].b.p; let hit = false;
      for (const p of q.b.p) { for (const r of o) if (Math.abs(p[0] - r[0]) < 2 && Math.abs(p[1] - r[1]) < 2) { hit = true; break; } if (hit) break; }
      if (hit) cnt++;
    }
    return cnt;
  };
  const out = [];
  cand.forEach((q, n) => {
    let da = 1e9; for (const s of axis) da = Math.min(da, segDist(q.x, q.z, s[0], s[1], s[2], s[3]).d);
    const roll = R();
    if (q.d < 300 || da < 150 || mainIdx.nearest(q.x, q.z, 30) || near(q, n) >= 2 || roll < 0.12) out.push(q.b);
  });
  return out;
}
function selectNear(geo, place, radius, maxA = 700) {
  if (!place) return [];
  return geo.buildings.filter((b) => { const [x, z] = centroid(b.p); return b.p.length >= 3 && Math.hypot(x - place.x, z - place.z) < radius && b.a <= maxA && keepKind(b); });
}

// one region: footprints -> blocks -> heights -> index -> openings -> geometry
function buildRegion(ctx, B, fps, styleName, seed, hooks = {}) {
  const style = STYLE[styleName], R = rng(seed), groups = [];
  for (const fp of fps) {
    if (hooks.special && hooks.special(fp)) continue;
    const blocks = blocksFromFootprint(ctx, fp, styleName, R);
    dressFootprint(ctx, blocks, style, R, styleName);
    if (blocks.length) groups.push(blocks);
  }
  const all = groups.flat();
  ctx.bidx = blockIndex(all.concat(ctx.extraBlocks || []));
  if (hooks.before) hooks.before(groups, R);
  for (const blk of all) {
    if (blk.farm) farmOpenings(ctx, blk, R); else planOpenings(ctx, blk, style, R);
    planChimneys(ctx, blk, style, R);
  }
  if (hooks.after) hooks.after(groups, R);
  for (const blk of all) buildBlock(ctx, B, blk);
  return { blocks: all, groups };
}

// ═══════════════════════════════ special buildings ══════════════════════════════════════════════════════════
// an arched opening in a wall face: rectangle x0..x1 up to the springing ys, then a round (or pointed) head.
// Returns the hole rectangle for wallHoles; emits the spandrels, the reveals (G) and the back panel (Bk).
function archPts(x0, x1, ys, pointed, n = 6) {
  const w = x1 - x0, xm = (x0 + x1) / 2, pts = [];
  if (pointed) {
    for (let i = 0; i <= n; i++) { const t = Math.PI - i / n * Math.PI / 3; pts.push([x1 + w * Math.cos(t), ys + w * Math.sin(t)]); }
    for (let i = n - 1; i >= 0; i--) { const t = i / n * Math.PI / 3; pts.push([x0 + w * Math.cos(t), ys + w * Math.sin(t)]); }
  } else for (let i = 0; i <= 2 * n; i++) { const t = Math.PI - i / (2 * n) * Math.PI; pts.push([xm + w / 2 * Math.cos(t), ys + w / 2 * Math.sin(t)]); }
  return pts;                                          // from (x0, ys) over the top to (x1, ys)
}
function archOpening(Wall, Rev, Back, fc, x0, x1, y0, ys, D, pointed, backDepth) {
  const pts = archPts(x0, x1, ys, pointed), top = Math.max(...pts.map((p) => p[1]));
  const xm = (x0 + x1) / 2;
  // spandrels: fans from the two top corners of the bounding box
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1], cx = (p[0] + q[0]) / 2 < xm ? x0 : x1;
    Wall.poly([fc.at(cx, top), fc.at(p[0], p[1]), fc.at(q[0], q[1])], fc.N);
  }
  // reveals: jambs, sill, arch soffit
  Rev.quad(fc.at(x0, y0, 0), fc.at(x0, y0, D), fc.at(x0, ys, D), fc.at(x0, ys, 0), fc.D);
  Rev.quad(fc.at(x1, y0, 0), fc.at(x1, y0, D), fc.at(x1, ys, D), fc.at(x1, ys, 0), [-fc.D[0], 0, -fc.D[2]]);
  Rev.quad(fc.at(x0, y0, 0), fc.at(x1, y0, 0), fc.at(x1, y0, D), fc.at(x0, y0, D), [0, 1, 0]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    Rev.quad(fc.at(p[0], p[1], 0), fc.at(q[0], q[1], 0), fc.at(q[0], q[1], D), fc.at(p[0], p[1], D), [xm - mx, ys - my, 0].map((v, k) => k === 0 ? fc.D[0] * (xm - mx) : k === 1 ? (ys - 0.001 - my) : fc.D[2] * (xm - mx)));
  }
  if (Back) Back.poly([fc.at(x0, y0, backDepth), fc.at(x1, y0, backDepth), ...pts.slice().reverse().map((p) => fc.at(p[0], p[1], backDepth))].reverse(), fc.N);
  return { x0, x1, y0, y1: top };
}

// Église Saint-Pierre: the square Romanesque west tower (11 m, sandstone, 20-22 m) with its slate-hung hourd and tall
// pyramid roof on flared eaves, the 1536 Gothic hall (rendered walls, sandstone buttresses, tall pointed windows,
// one steep slate roof hipped at the east end), the polygonal choir and the neo-Gothic north porch with its rose.
function buildChurch(ctx, B, fp) {
  const r = mabr(fp.p);
  let ux = r.ux, uz = r.uz, a = r.a, b = r.b;
  if (a < b) { const t = ux; ux = -uz; uz = t; const tt = a; a = b; b = tt; }
  if (ux < 0) { ux = -ux; uz = -uz; }                                      // u points east: the tower end is s = -a
  const F = frame(r.cx, r.cz, ux, uz);                                    // v points south
  const [lo, hi] = groundRange(ctx.heightAt, F, a, b);
  const y0 = hi + 0.3, yB = lo - 1.0;
  B.setOrg(F.cx, 0, F.cz);
  const S = B.sand, Wl = B.stucco, SL = B.slate, SP = B.spire;
  S.color(PAL.white); Wl.color(lin('#D8D2C6')); SL.color(PAL.slate[1]); SL.set('aSnowK', 1); SP.color(lin('#E4E6EA'));
  const tw = 11, sT0 = -a, sT1 = -a + tw, tT1 = b - 2.3, tT0 = tT1 - tw;          // the tower square
  const sH0 = sT1, sH1 = a - 8.4;                                                  // the hall
  const yEv = y0 + 10.5, pitch = 50 * DEG, tanP = Math.tan(pitch);
  const yT = y0 + 21, yHd = yT + 4.6;                                              // tower masonry, hourd top
  const gl = B.glass; gl.set('aLit', 0);
  // ── the tower: walls with small round-arched openings, clocks, hourd, pyramid ──
  const Ft = frame(...F.p((sT0 + sT1) / 2, 0, (tT0 + tT1) / 2).filter((_, i) => i !== 1), ux, uz), ht = tw / 2;
  S.fbox(Ft, -ht - 0.08, ht + 0.08, yB, y0 + 0.6, -ht - 0.08, ht + 0.08, 8);
  for (let side = 0; side < 4; side++) {
    const fc = facade(Ft, side, ht, ht), holes = [];
    const exposed = side !== 2;                                                    // the east face meets the nave roof
    if (exposed) for (const [yy, xx] of [[y0 + 6.2, 0.5], [y0 + 12.4, 0.5], [y0 + 16.3, 0.35], [y0 + 16.3, 0.65]]) {
      const w = yy > y0 + 15 ? 0.62 : 0.5, x0 = fc.L * xx - w / 2;
      holes.push(archOpening(S, S, B.dark, fc, x0, x0 + w, yy, yy + (yy > y0 + 15 ? 1.2 : 1.05), 0.5, false, 0.5));
    }
    wallHoles(S, fc, y0 + 0.6, yT, holes);
    if (exposed) {                                                                 // the clock just under the hourd
      const c = fc.at(fc.L / 2, yT - 2.1, -0.02), n = fc.N;
      B.trim.color(lin('#2A2724')); B.trim.cyl(fc.at(fc.L / 2, yT - 2.1, 0.02), c, 1.0, 1.0, 24, true, false);
      B.trim.color(lin('#C9A45A'));
      B.trim.cyl(c, [c[0] - n[0] * 0.015, c[1], c[2] - n[2] * 0.015], 1.0, 0.94, 24, false, false);
      for (let h = 0; h < 12; h++) { const an = h / 12 * Math.PI * 2, p = fc.at(fc.L / 2 + Math.sin(an) * 0.82, yT - 2.1 + Math.cos(an) * 0.82, -0.035); B.trim.obox(p, fc.D, [0, 1, 0], [-n[0], 0, -n[2]], 0.045, 0.045, 0.01); }
      const hand = (an, len, wd) => {                                          // an: clockwise from twelve, seen from outside
        const d = [fc.D[0] * Math.sin(an), Math.cos(an), fc.D[2] * Math.sin(an)], q = [fc.D[0] * Math.cos(an), -Math.sin(an), fc.D[2] * Math.cos(an)];
        B.trim.obox([c[0] + d[0] * len / 2 + n[0] * 0.01, c[1] + d[1] * len / 2, c[2] + d[2] * len / 2 + n[2] * 0.01], d, q, [-n[0], 0, -n[2]], len / 2, wd, 0.012);
      };
      hand(4.4, 0.55, 0.045); hand(5.95, 0.8, 0.03);
    }
  }
  // hourd: slate-hung gallery corbelled out 0.6 m, two louvred openings a side, a soffit on wooden corbels
  const hh = ht + 0.6;
  for (let side = 0; side < 4; side++) {
    const fc = facade(Ft, side, hh, hh), holes = [];
    for (const xx of [0.3, 0.7]) {
      const x0 = fc.L * xx - 0.6, x1 = x0 + 1.2, ya = yT + 1.4, yb = ya + 2.0;
      holes.push({ x0, x1, y0: ya, y1: yb });
      SP.quad(fc.at(x0, ya, 0), fc.at(x0, ya, 0.3), fc.at(x0, yb, 0.3), fc.at(x0, yb, 0), fc.D);
      SP.quad(fc.at(x1, ya, 0), fc.at(x1, ya, 0.3), fc.at(x1, yb, 0.3), fc.at(x1, yb, 0), [-fc.D[0], 0, -fc.D[2]]);
      SP.quad(fc.at(x0, yb, 0), fc.at(x1, yb, 0), fc.at(x1, yb, 0.3), fc.at(x0, yb, 0.3), [0, -1, 0]);
      SP.quad(fc.at(x0, ya, 0), fc.at(x1, ya, 0), fc.at(x1, ya, 0.3), fc.at(x0, ya, 0.3), [0, 1, 0]);
      B.dark.quad(fc.at(x0, ya, 0.3), fc.at(x1, ya, 0.3), fc.at(x1, yb, 0.3), fc.at(x0, yb, 0.3), fc.N);
      B.wood.color(lin('#4A4038'));
      for (let k = 0; k < 7; k++) {                                              // louvre boards, tilted
        const yy = ya + 0.18 + k * 0.26, c = fc.at((x0 + x1) / 2, yy, 0.15);
        const ay = [-fc.nx * 0.5, 0.866, -fc.nz * 0.5], az = [-fc.nx * 0.866, -0.5, -fc.nz * 0.866];
        B.wood.obox(c, fc.D, ay, az, 0.58, 0.012, 0.13);
      }
    }
    wallHoles(SP, fc, yT, yHd, holes);
    // soffit between the masonry and the overhang, corbels under it
    const fin = facade(Ft, side, ht, ht);
    B.wood.color(lin('#3E3530'));
    B.wood.quad(fc.at(0, yT), fc.at(fc.L, yT), fin.at(fin.L, yT), fin.at(0, yT), [0, -1, 0]);
    for (let k = 0; k < 7; k++) { const x = fin.L * (k + 0.5) / 7; fcbox(B.wood, fin, x - 0.12, x + 0.12, yT - 0.55, yT, -0.58, 0, 16); }
  }
  // pyramid roof on flared eaves (coyaux), finial, cross and weathercock
  const e0 = hh + 0.45, e1 = hh - 0.15, yK = yHd + 0.75, yA = yK + (e1) * Math.tan(69 * DEG);
  const cT = F.p((sT0 + sT1) / 2, 0, (tT0 + tT1) / 2);
  const corner = (h, y, i) => { const sx = [-1, 1, 1, -1][i], sz = [-1, -1, 1, 1][i]; return Ft.p(sx * h, y, sz * h); };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, mid = Ft.p(0, 0, 0);
    const out = (p, q) => { const m = [(p[0] + q[0]) / 2 - mid[0], 0.6, (p[2] + q[2]) / 2 - mid[2]]; return m; };
    const a0 = corner(e0, yHd, i), a1 = corner(e0, yHd, j), b0 = corner(e1, yK, i), b1 = corner(e1, yK, j);
    SP.quad(a0, a1, b1, b0, out(a0, a1));
    SP.poly([b0, b1, [cT[0], yA, cT[2]]], out(b0, b1));
    SP.quad(corner(e0, yHd - 0.18, i), corner(e0, yHd - 0.18, j), a1, a0, out(a0, a1).map((v, k) => k === 1 ? 0 : v));
    SP.quad(corner(e0, yHd - 0.18, i), corner(e0, yHd - 0.18, j), corner(hh, yHd - 0.18, j), corner(hh, yHd - 0.18, i), [0, -1, 0]);
  }
  const M = B.metal;
  M.cyl([cT[0], yA - 0.3, cT[2]], [cT[0], yA + 2.4, cT[2]], 0.09, 0.05, 8, true, false);
  M.cyl([cT[0], yA + 1.3, cT[2]], [cT[0], yA + 1.5, cT[2]], 0.16, 0.16, 10, true, true);
  M.obox([cT[0], yA + 2.0, cT[2]], [ux, 0, uz], [0, 1, 0], [F.vx, 0, F.vz], 0.36, 0.04, 0.04);
  M.obox([cT[0], yA + 2.45, cT[2]], [ux, 0, uz], [0, 1, 0], [F.vx, 0, F.vz], 0.3, 0.13, 0.015);   // the cock, edge-on
  ctx.anchors.churchTop.set(cT[0], yA + 2.6, cT[2]);

  // ── the hall ──
  const nb = 5, bay = (sH1 - sH0) / nb;
  const winW = 2.1, winY0 = y0 + 2.6, winYs = y0 + 7.2;
  const porchBay = 2;
  // plinth
  S.color(lin('#D6D0C4'));
  S.fbox(F, sH0, sH1, yB, y0 + 0.8, -b - 0.06, b + 0.06, 8);
  S.fbox(F, sT0, sH0, yB, y0 + 0.8, -b - 0.06, tT0, 8);
  S.color(PAL.white);
  const longWall = (side) => {                        // side 0 = south (t = +b), side 1 = north (t = -b)
    const sStart = side === 1 ? sT0 : sH0;
    const Fw = frame(...F.p((sStart + sH1) / 2, 0, 0).filter((_, i) => i !== 1), ux, uz), aw = (sH1 - sStart) / 2;
    const fc = facade(Fw, side, aw, b), holes = [];
    const toX = (s) => side === 0 ? s - sStart : sH1 - s;
    for (let k = 0; k < nb; k++) {
      const sc = sH0 + (k + 0.5) * bay, xc = toX(sc);
      if (side === 1 && k === porchBay) continue;
      holes.push(archOpening(Wl, S, gl, fc, xc - winW / 2, xc + winW / 2, winY0, winYs, 0.45, true, 0.42));
      fcbox(S, fc, xc - 0.07, xc + 0.07, winY0, winYs + 0.2, 0.1, 0.4, 16 | 8);                       // mullion
      S.color(lin('#CFC8BA')); fcbox(S, fc, xc - winW / 2 - 0.1, xc + winW / 2 + 0.1, winY0 - 0.12, winY0 + 0.02, -0.08, 0.1, 16); S.color(PAL.white);
    }
    if (side === 1) {                                                                                      // the aisle bay beside the tower
      const xc = toX((sT0 + sH0) / 2);
      holes.push(archOpening(Wl, S, gl, fc, xc - 0.8, xc + 0.8, y0 + 3.2, y0 + 6.8, 0.4, true, 0.38));
    }
    wallHoles(Wl, fc, y0 + 0.8, yEv, holes);
    // buttresses (stepped, sloping tops)
    const bs = []; for (let k = 0; k <= nb; k++) bs.push(sH0 + k * bay);
    if (side === 1) bs.push(sT0 + 0.6);
    for (const s of bs) {
      const xc = toX(s), top = y0 + 7.6;
      fcbox(S, fc, xc - 0.55, xc + 0.55, yB, y0 + 4.2, -1.25, 0, 16);
      fcbox(S, fc, xc - 0.5, xc + 0.5, y0 + 4.2, top, -0.9, 0, 16);
      S.quad(fc.at(xc - 0.5, top, -0.9), fc.at(xc + 0.5, top, -0.9), fc.at(xc + 0.5, top + 1.3, 0), fc.at(xc - 0.5, top + 1.3, 0), [fc.nx, 0.7, fc.nz]);
      S.poly([fc.at(xc - 0.5, top, -0.9), fc.at(xc - 0.5, top + 1.3, 0), fc.at(xc - 0.5, top, 0)], [-fc.D[0], 0, -fc.D[2]]);
      S.poly([fc.at(xc + 0.5, top, -0.9), fc.at(xc + 0.5, top + 1.3, 0), fc.at(xc + 0.5, top, 0)], fc.D);
      S.quad(fc.at(xc - 0.55, y0 + 4.2, -1.25), fc.at(xc + 0.55, y0 + 4.2, -1.25), fc.at(xc + 0.55, y0 + 4.5, -0.9), fc.at(xc - 0.55, y0 + 4.5, -0.9), [fc.nx, 1, fc.nz]);
    }
    // cornice
    S.color(lin('#CFC8BA')); fcbox(S, fc, -0.1, fc.L + 0.1, yEv - 0.3, yEv, -0.16, 0, 16 | 4); S.color(PAL.white);
    if (side === 1) {                                                                                      // the neo-Gothic north porch with its rose
      const xc = toX(sH0 + (porchBay + 0.5) * bay), pw = 2.4, dep = 1.3, yP = y0 + 7.4;
      fcbox(S, fc, xc - pw, xc + pw, yB, yP, -dep, 0, 16 | 32);
      const pf = { ...fc, at: (x, y, d = 0) => fc.at(x, y, d - dep) };
      const door = archOpening(S, S, B.wood.color(lin('#3A2E26')), pf, xc - 0.95, xc + 0.95, y0, y0 + 3.0, 0.35, true, 0.34);
      wallHoles(S, pf, yB, yP, [door], xc - pw, xc + pw);
      B.wood.color(PAL.woodDark);
      S.poly([pf.at(xc - pw - 0.1, yP), pf.at(xc + pw + 0.1, yP), pf.at(xc, yP + pw * 1.35)], fc.N);         // gable
      for (const sg of [-1, 1]) {
        SL.quad(fc.at(xc + sg * (pw + 0.15), yP - 0.05, -dep - 0.2), fc.at(xc, yP + pw * 1.35 + 0.1, -dep - 0.2), fc.at(xc, yP + pw * 1.35 + 0.1, 0.3), fc.at(xc + sg * (pw + 0.15), yP - 0.05, 0.3), [fc.D[0] * sg, 0.7, fc.D[2] * sg]);
        S.cyl(fc.at(xc + sg * pw, yP - 0.2, -dep - 0.05), fc.at(xc + sg * pw, yP + 1.6, -dep - 0.05), 0.2, 0.02, 6, false, false);  // pinnacles
      }
      const rc = fc.at(xc, y0 + 5.3, -dep);
      S.cyl(rc, fc.at(xc, y0 + 5.3, -dep - 0.12), 1.05, 1.05, 20, true, false);
      gl.cyl(fc.at(xc, y0 + 5.3, -dep - 0.1), fc.at(xc, y0 + 5.3, -dep - 0.14), 0.82, 0.82, 20, true, false);
      for (let k = 0; k < 8; k++) { const an = k / 8 * Math.PI; const d = [fc.D[0] * Math.cos(an), Math.sin(an), fc.D[2] * Math.cos(an)]; S.obox(fc.at(xc, y0 + 5.3, -dep - 0.16), d, [0, 0, 0].map((v, i) => i === 1 ? Math.cos(an) : -fc.D[i] * Math.sin(an)), [-fc.nx, 0, -fc.nz], 0.82, 0.03, 0.02); }
    }
  };
  longWall(0); longWall(1);
  // west wall of the north aisle bay (beside the tower) with the Gothic portal, and the small south stub of the hall's west gable
  {
    const Fw = frame(...F.p(sT0, 0, (-b + tT0) / 2).filter((_, i) => i !== 1), ux, uz), bw = (tT0 + b) / 2;
    const fc = facade(Fw, 3, 0.0001, bw);
    const xc = fc.L / 2, hole = archOpening(Wl, S, B.wood.color(lin('#3A2E26')), fc, xc - 0.9, xc + 0.9, y0, y0 + 2.9, 0.35, true, 0.33);
    wallHoles(Wl, fc, y0 + 0.8, yEv, [hole]);
    Wl.poly([fc.at(0, yEv), fc.at(fc.L, yEv), fc.at(fc.L, yEv + (fc.L) * tanP * 0.999)], fc.N);
    fcbox(S, fc, xc - 1.3, xc - 0.95, y0, y0 + 3.9, -0.3, 0, 16); fcbox(S, fc, xc + 0.95, xc + 1.3, y0, y0 + 3.9, -0.3, 0, 16);
    const Fg = frame(...F.p(sH0, 0, (tT1 + b) / 2).filter((_, i) => i !== 1), ux, uz), bg = (b - tT1) / 2;
    const fg = facade(Fg, 3, 0.0001, bg);
    Wl.quad(fg.at(0, y0 + 0.8), fg.at(fg.L, y0 + 0.8), fg.at(fg.L, yEv), fg.at(0, yEv), fg.N);
    Wl.quad(fg.at(0, yEv), fg.at(fg.L, yEv), fg.at(fg.L, yEv + 0.25), fg.at(0, yEv + 0.25 + fg.L * tanP), fg.N);
  }
  // hall roof: gabled against the tower, hipped to the east; the north slope runs on over the aisle bay
  const ov = 0.45, thk = 0.3, yTop = (t) => yEv + thk + (b - Math.abs(t)) * tanP;
  const yRr = yTop(0), sHip = sH1 - b;
  const nS = [F.vx * Math.sin(pitch), Math.cos(pitch), F.vz * Math.sin(pitch)], nN = [-F.vx * Math.sin(pitch), Math.cos(pitch), -F.vz * Math.sin(pitch)];
  const tEs = b + ov, tEn = -b - ov, yEe = yTop(tEs);
  SL.quad(F.p(sH0, yEe, tEs), F.p(sH1 + ov, yEe, tEs), F.p(sHip, yRr, 0), F.p(sH0, yRr, 0), nS);
  SL.quad(F.p(sT0 - 0.3, yEe, tEn), F.p(sH1 + ov, yEe, tEn), F.p(sHip, yRr, 0), F.p(sH0, yRr, 0), nN);
  SL.poly([F.p(sT0 - 0.3, yEe, tEn), F.p(sH0, yRr, 0), F.p(sH0, yTop(tT0), tT0), F.p(sT0 - 0.3, yTop(tT0), tT0)], nN);
  SL.poly([F.p(sH1 + ov, yEe, tEn), F.p(sH1 + ov, yEe, tEs), F.p(sHip, yRr, 0)], [ux, Math.cos(pitch), uz]);
  SL.quad(F.p(sT0 - 0.3, yEe - thk, tEn), F.p(sH1 + ov, yEe - thk, tEn), F.p(sH1 + ov, yEe, tEn), F.p(sT0 - 0.3, yEe, tEn), [-F.vx, 0, -F.vz]);
  SL.quad(F.p(sH0, yEe - thk, tEs), F.p(sH1 + ov, yEe - thk, tEs), F.p(sH1 + ov, yEe, tEs), F.p(sH0, yEe, tEs), [F.vx, 0, F.vz]);
  SL.quad(F.p(sH1 + ov, yEe - thk, tEn), F.p(sH1 + ov, yEe - thk, tEs), F.p(sH1 + ov, yEe, tEs), F.p(sH1 + ov, yEe, tEn), [ux, 0, uz]);
  SL.quad(F.p(sT0 - 0.3, yEe - thk, tEn), F.p(sT0 - 0.3, yEe, tEn), F.p(sT0 - 0.3, yTop(tT0), tT0), F.p(sT0 - 0.3, yTop(tT0) - thk, tT0), [-ux, 0, -uz]);
  SL.quad(F.p(sT0 - 0.3, yEe - thk, tEn), F.p(sH1 + ov, yEe - thk, tEn), F.p(sH1 - b * 0.2, yEv, -b), F.p(sT0, yEv, -b), [0, -1, 0]);
  SL.quad(F.p(sH0, yEe - thk, tEs), F.p(sH1 + ov, yEe - thk, tEs), F.p(sH1 - b * 0.2, yEv, b), F.p(sH0, yEv, b), [0, -1, 0]);
  // small triangular dormers (outeaux) low on both slopes: a slate gable face, a dark vent, two little roof planes
  for (const [k, nn] of [[1, nS], [-1, nN]]) for (let i = 0; i < 4; i++) {
    const s = sH0 + bay * (i + 0.9), t = k * (b - 2.0), yb = yTop(t) - 0.02, w = 0.6, yA = yb + 1.05;
    const tBack = k * (b - (yA - yEv - thk) / tanP);
    const p0 = F.p(s - w, yb, t), p1 = F.p(s + w, yb, t), top = F.p(s, yA, t), back = F.p(s, yA, tBack);
    SL.poly([p0, p1, top], [F.vx * k, 0, F.vz * k]);
    B.dark.poly([F.p(s - 0.26, yb + 0.12, t + k * 0.02), F.p(s + 0.26, yb + 0.12, t + k * 0.02), F.p(s, yb + 0.62, t + k * 0.02)], [F.vx * k, 0, F.vz * k]);
    SL.poly([p0, top, back], [-ux + nn[0], 1, -uz + nn[2]]);
    SL.poly([p1, top, back], [ux + nn[0], 1, uz + nn[2]]);
  }
  // east wall of the hall beside the choir
  const hwC = 4.6, tcC = -0.2;
  for (const [t0, t1] of [[-b, tcC - hwC], [tcC + hwC, b]]) {
    const Fe = frame(...F.p(sH1, 0, (t0 + t1) / 2).filter((_, i) => i !== 1), ux, uz), be = (t1 - t0) / 2;
    const fc = facade(Fe, 2, 0.0001, be);
    Wl.quad(fc.at(0, y0 + 0.8), fc.at(fc.L, y0 + 0.8), fc.at(fc.L, yEv), fc.at(0, yEv), fc.N);
    S.fbox(Fe, -0.06, 0.06, yB, y0 + 0.8, -be, be, 8);
  }
  // choir with a half-octagon apse; pointed windows; a half-cone roof lower than the hall's
  const sA0 = sH1, apC = a - hwC * 0.92, cIn = F.p(apC - 2, 0, tcC);
  const ap = [[sA0, tcC - hwC], [apC, tcC - hwC]];
  for (let i = 1; i < 4; i++) { const an = -Math.PI / 2 + i * Math.PI / 4; ap.push([apC + hwC * Math.cos(an), tcC + hwC * Math.sin(an)]); }
  ap.push([apC, tcC + hwC], [sA0, tcC + hwC]);
  for (let i = 0; i < ap.length - 1; i++) {
    const fc = facadeAB(F.p(ap[i][0], 0, ap[i][1]), F.p(ap[i + 1][0], 0, ap[i + 1][1]), cIn), L = fc.L, holes = [];
    if (L > 2.6) { const w = Math.min(1.6, L - 1.4); holes.push(archOpening(Wl, S, gl, fc, L / 2 - w / 2, L / 2 + w / 2, winY0, winYs - 0.2, 0.4, true, 0.38)); }
    wallHoles(Wl, fc, y0 + 0.8, yEv, holes);
    S.color(PAL.white); fcbox(S, fc, -0.05, L + 0.05, yB, y0 + 0.8, -0.06, 0, 16);
    S.color(lin('#CFC8BA')); fcbox(S, fc, -0.1, L + 0.1, yEv - 0.3, yEv, -0.16, 0, 16 | 4); S.color(PAL.white);
  }
  for (let i = 1; i < ap.length - 1; i++) {                                  // buttresses on the apse corners
    const V = F.p(ap[i][0], 0, ap[i][1]), o = [V[0] - cIn[0], 0, V[2] - cIn[2]], ol = Math.hypot(o[0], o[2]); o[0] /= ol; o[2] /= ol;
    const pr = [o[2], 0, -o[0]], top = y0 + 7.2;
    S.obox([V[0] + o[0] * 0.4, (yB + top) / 2, V[2] + o[2] * 0.4], pr, [0, 1, 0], o, 0.45, (top - yB) / 2, 0.55, 8);
    S.quad([V[0] + o[0] * 0.95 - pr[0] * 0.45, top, V[2] + o[2] * 0.95 - pr[2] * 0.45], [V[0] + o[0] * 0.95 + pr[0] * 0.45, top, V[2] + o[2] * 0.95 + pr[2] * 0.45],
      [V[0] - o[0] * 0.15 + pr[0] * 0.45, top + 1.2, V[2] - o[2] * 0.15 + pr[2] * 0.45], [V[0] - o[0] * 0.15 - pr[0] * 0.45, top + 1.2, V[2] - o[2] * 0.15 - pr[2] * 0.45], [o[0], 0.8, o[2]]);
  }
  // choir roof: a gable that starts inside the hall roof, then a half-cone of four facets over the apse
  const yRc = yEv + thk + hwC * tanP, yEc = yEv + thk - ov * tanP, rW = sH1 - 4.6;
  const apexP = F.p(apC, yRc, tcC), ridgeW = F.p(rW, yRc, tcC);
  for (const sg of [-1, 1]) SL.quad(F.p(rW, yEc, tcC + sg * (hwC + ov)), F.p(apC, yEc, tcC + sg * (hwC + ov)), apexP, ridgeW, [F.vx * sg, 1, F.vz * sg]);
  const eP = []; for (let i = 0; i <= 4; i++) { const an = -Math.PI / 2 + i * Math.PI / 4; eP.push(F.p(apC + (hwC + ov) * Math.cos(an), yEc, tcC + (hwC + ov) * Math.sin(an))); }
  for (let i = 0; i < 4; i++) SL.poly([eP[i], eP[i + 1], apexP], [(eP[i][0] + eP[i + 1][0]) / 2 - apexP[0], 1.2, (eP[i][2] + eP[i + 1][2]) / 2 - apexP[2]]);
  const ring = [F.p(rW, yEc, tcC - hwC - ov), ...eP, F.p(rW, yEc, tcC + hwC + ov)];
  for (let i = 0; i < ring.length - 1; i++) {
    const p = ring[i], q = ring[i + 1];
    SL.quad([p[0], p[1] - thk, p[2]], [q[0], q[1] - thk, q[2]], q, p, [(p[0] + q[0]) / 2 - cIn[0], 0, (p[2] + q[2]) / 2 - cIn[2]]);
  }
}

// the Porte de Trèves: the 14th-century town gate by the church — a square stone tower, pointed passage, tall hipped roof
function buildPorte(ctx, B, fp) {
  const r = mabr(fp.p), F = frame(r.cx, r.cz, r.ux, r.uz), a = r.a, b = r.b;
  const [lo, hi] = groundRange(ctx.heightAt, F, a, b), y0 = lo + 0.05, yB = lo - 1, yT = y0 + 13.5;
  B.setOrg(F.cx, 0, F.cz);
  const S = B.stone; S.color(lin('#E8E2D8'));
  const st = ctx.roads.nearest(r.cx, r.cz, 30);
  let passSide = 0;                                                  // the passage runs along the street
  if (st) { const sl = Math.hypot(st.dx, st.dz) || 1; passSide = Math.abs((st.dx / sl) * r.ux + (st.dz / sl) * r.uz) > 0.7 ? 2 : 0; }
  for (let side = 0; side < 4; side++) {
    const fc = facade(F, side, a, b), holes = [];
    const pass = (passSide === 2 && side >= 2) || (passSide === 0 && side < 2);
    if (pass) holes.push(archOpening(S, S, null, fc, fc.L / 2 - 1.5, fc.L / 2 + 1.5, y0 - 0.1, y0 + 3.3, 0.02, true, 0));
    for (const yy of [y0 + 6.5, y0 + 10.2]) holes.push(archOpening(S, S, B.dark, fc, fc.L / 2 - 0.25, fc.L / 2 + 0.25, yy, yy + 1.0, 0.45, false, 0.45));
    wallHoles(S, fc, yB, yT, holes);
  }
  // the vaulted passage (inside faces) and its dark depth
  const Lp = passSide === 2 ? a : b;
  for (const sg of [-1, 1]) {
    const q = (u, y, v) => passSide === 2 ? F.p(u, y, v) : F.p(v, y, u);
    S.quad(q(-Lp, y0 - 0.1, sg * 1.5), q(Lp, y0 - 0.1, sg * 1.5), q(Lp, y0 + 3.3, sg * 1.5), q(-Lp, y0 + 3.3, sg * 1.5), passSide === 2 ? [-F.vx * sg, 0, -F.vz * sg] : [-F.ux * sg, 0, -F.uz * sg]);
  }
  const pts = archPts(-1.5, 1.5, y0 + 3.3, true);
  for (let i = 0; i < pts.length - 1; i++) {
    const [p, py] = pts[i], [q2, qy] = pts[i + 1];
    const Q = (u, x, y) => passSide === 2 ? F.p(u, y, x) : F.p(x, y, u);
    const acr = passSide === 2 ? [F.vx, F.vz] : [F.ux, F.uz], mx = (p + q2) / 2, my = (py + qy) / 2;
    S.quad(Q(-Lp, p, py), Q(Lp, p, py), Q(Lp, q2, qy), Q(-Lp, q2, qy), [-acr[0] * mx, y0 + 3.3 - my, -acr[1] * mx]);
  }
  // hipped roof
  const SL = B.slate; SL.color(PAL.slate[2]); SL.set('aSnowK', 1);
  const ov = 0.35, p = 57 * DEG, ea = a + ov, eb = b + ov, yE = yT + 0.1, rl = Math.max(0.01, ea - eb), yR = yE + eb * Math.tan(p);
  const c = (s, t, y) => F.p(s, y, t);
  SL.quad(c(-ea, eb, yE), c(ea, eb, yE), c(rl, 0, yR), c(-rl, 0, yR), [F.vx, 1, F.vz]);
  SL.quad(c(-ea, -eb, yE), c(ea, -eb, yE), c(rl, 0, yR), c(-rl, 0, yR), [-F.vx, 1, -F.vz]);
  SL.poly([c(ea, -eb, yE), c(ea, eb, yE), c(rl, 0, yR)], [F.ux, 1, F.uz]);
  SL.poly([c(-ea, -eb, yE), c(-ea, eb, yE), c(-rl, 0, yR)], [-F.ux, 1, -F.uz]);
  SL.quad(c(-ea, -eb, yE), c(ea, -eb, yE), c(ea, eb, yE), c(-ea, eb, yE), [0, -1, 0]);
  B.metal.cyl(c(rl, 0, yR - 0.1), c(rl, 0, yR + 1.3), 0.05, 0.03, 6); B.metal.cyl(c(-rl, 0, yR - 0.1), c(-rl, 0, yR + 1.3), 0.05, 0.03, 6);
  return { F, a, b, yE: yT };
}

// a village church from its footprint: nave with round-arched windows, square west tower with a slate spire
function buildVillageChurch(ctx, B, fp) {
  const r = mabr(fp.p);
  let ux = r.ux, uz = r.uz, a = r.a, b = r.b;
  if (a < b) { const t = ux; ux = -uz; uz = t; const tt = a; a = b; b = tt; }
  if (ux < 0) { ux = -ux; uz = -uz; }
  const F = frame(r.cx, r.cz, ux, uz);
  const tw = Math.min(5.2, 2 * b - 1), sT = -a + tw / 2;
  const nave = { F: frame(...F.p(tw / 2, 0, 0).filter((_, i) => i !== 1), ux, uz), a: a - tw / 2, b, wall: 'stone', wallCol: PAL.stone[2], plinthCol: PAL.stone[4],
    frameCol: PAL.trim[0], surroundCol: PAL.trim[1], shutterCol: PAL.shutter[0], doorCol: PAL.door[0], slateCol: PAL.slate[1], sillCol: PAL.sill[0], lintelCol: PAL.trim[1],
    snowK: 1, pitch: 50 * DEG, roof: { ov: 0.35, vo: 0.15, thk: 0.22, snowT: 0.24 }, chimneys: [], lintel: false };
  const [lo, hi] = groundRange(ctx.heightAt, nave.F, nave.a, nave.b);
  nave.yB = lo - 0.8; nave.yF = hi + 0.3; nave.yE = nave.yF + 6.6;
  nave.ops = [[], [], [], []];
  for (const side of [0, 1]) { const L = 2 * nave.a; for (let k = 0; k < 3; k++) { const x = L * (k + 0.5) / 3; nave.ops[side].push({ x0: x - 0.6, x1: x + 0.6, y0: nave.yF + 2.2, y1: nave.yF + 5.2, kind: 'win', lit: 0 }); } }
  buildBlock(ctx, B, nave);
  // tower
  const Ft = frame(...F.p(sT, 0, 0).filter((_, i) => i !== 1), ux, uz), ht = tw / 2;
  const [tlo, thi] = groundRange(ctx.heightAt, Ft, ht, ht), yT = thi + 14;
  B.setOrg(Ft.cx, 0, Ft.cz);
  const S = B.stone; S.color(PAL.stone[1]);
  for (let side = 0; side < 4; side++) {
    const fc = facade(Ft, side, ht, ht), holes = [];
    if (side !== 2) holes.push(archOpening(S, S, B.dark, fc, fc.L / 2 - 0.45, fc.L / 2 + 0.45, yT - 3.2, yT - 1.6, 0.4, false, 0.4));
    if (side === 3) holes.push(archOpening(S, S, B.wood.color(PAL.door[1]), fc, fc.L / 2 - 0.7, fc.L / 2 + 0.7, thi + 0.2, thi + 2.4, 0.35, false, 0.33));
    wallHoles(S, fc, tlo - 0.8, yT, holes);
  }
  const SP = B.spire; SP.color(PAL.slate[0]);
  const e = ht + 0.3, yA = yT + 9.5, apex = Ft.p(0, yA, 0);
  const cr = (i, y, h) => Ft.p([-1, 1, 1, -1][i] * h, y, [-1, -1, 1, 1][i] * h);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4, m = Ft.p(0, 0, 0), o = cr(i, yT, e), p = cr(j, yT, e); SP.poly([o, p, apex], [(o[0] + p[0]) / 2 - m[0], 0.4, (o[2] + p[2]) / 2 - m[2]]); }
  SP.quad(cr(0, yT, e), cr(1, yT, e), cr(2, yT, e), cr(3, yT, e), [0, -1, 0]);
  B.metal.cyl(Ft.p(0, yA - 0.2, 0), Ft.p(0, yA + 1.6, 0), 0.05, 0.03, 6);
  B.metal.obox(Ft.p(0, yA + 1.2, 0), [ux, 0, uz], [0, 1, 0], [F.vx, 0, F.vz], 0.3, 0.035, 0.035);
}

// ═══════════════════════════════ farms ════════════════════════════════════════════════════════════════════════
// Ardennes long farm openings. A block either carries blk.part ('dwelling' | 'barn' | 'stable') or is a whole long
// footprint split internally into dwelling / barn / stable. The front is the long side facing the road.
function farmOpenings(ctx, blk, R) {
  const { a, b, yF } = blk;
  blk.ops = [[], [], [], []];
  const parts = blk.part ? [{ kind: blk.part, s0: -a, s1: a }] : (() => {
    const L = 2 * a, dl = clamp(L * 0.38, 7, 11), bl = clamp(L * 0.4, 6, 12), dir = R() < 0.5 ? 1 : -1;
    const cuts = [-a, -a + dl, Math.min(a, -a + dl + bl), a];
    const kinds = ['dwelling', 'barn', 'stable'];
    const ps = kinds.map((k, i) => ({ kind: k, s0: cuts[i], s1: cuts[i + 1] })).filter((p) => p.s1 - p.s0 > 1.5);
    return dir > 0 ? ps : ps.map((p) => ({ kind: p.kind, s0: -p.s1, s1: -p.s0 }));
  })();
  let front = blk.frontSide;
  if (front == null) {
    front = 0;
    if (blk.street) { const d0 = (blk.street.x - blk.F.cx) * blk.F.vx + (blk.street.z - blk.F.cz) * blk.F.vz; front = d0 > 0 ? 0 : 1; }
  }
  const back = 1 - front;
  const X = (side, s) => side === 0 ? s + a : a - s;
  const blocked = (side, s, y) => { const fc = facade(blk.F, side, a, b); const p = fc.at(X(side, s), 0, -0.9); const o = ctx.bidx.inside(p[0], p[2], blk); return o && y < o.yE + 0.6; };
  const add = (side, s, w, y0, y1, kind, extra = {}) => {
    if (blocked(side, s, y0)) return;
    const x = X(side, s); blk.ops[side].push({ x0: x - w / 2, x1: x + w / 2, y0, y1, kind, lit: kind === 'win' && blk.occupied && R() < 0.55 ? 0.5 + R() * 0.5 : 0, shutters: blk.shutters && kind === 'win', ...extra });
  };
  const up = blk.yE - yF > 4.5;
  for (const p of parts) {
    const len = p.s1 - p.s0, sm = (p.s0 + p.s1) / 2;
    if (p.kind === 'dwelling') {
      const cols = layoutCols(len, 0.9, 2.35, 0.75).map((x) => p.s0 + x);
      const doorS = cols.length ? cols[cols.length > 2 ? 1 : Math.floor(R() * cols.length)] : sm;
      for (const s of cols) {
        if (Math.abs(s - doorS) > 0.01) add(front, s, 0.92, yF + 0.85, yF + 2.1, 'win');
        if (up) add(front, s, 0.88, yF + 3.1, yF + 4.25, 'win');
      }
      add(front, doorS, 1.02, yF, yF + 2.15, 'door', { anchor: !!blk.doorAnchor, lit: blk.occupied ? 0.5 : 0 });
      const bc = layoutCols(len, 0.8, 3.2, 1.2).map((x) => p.s0 + x);
      for (const s of bc.slice(0, 2)) { add(back, s, 0.8, yF + 0.95, yF + 1.95, 'win'); if (up) add(back, s, 0.8, yF + 3.2, yF + 4.1, 'win'); }
    } else if (p.kind === 'barn') {
      const w = Math.min(3.6, len - 1.4);
      if (w > 2.2) add(front, sm, w, yF - 0.02, yF + Math.min(3.9, blk.yE - yF - 1.1), 'barn');
      for (const sg of [-1, 1]) { const s = sm + sg * (w / 2 + 0.9); if (Math.abs(s - sm) < len / 2 - 0.4) add(front, s, 0.24, blk.yE - 1.5, blk.yE - 0.7, 'slit'); }
      if (R() < 0.6 && len > 5) add(back, sm, 2.4, yF - 0.02, yF + 2.8, 'barn');
    } else {
      add(front, sm - len * 0.2, 1.08, yF, yF + 2.05, 'door', { lit: 0 });
      if (len > 3.5) add(front, sm + len * 0.22, 0.7, yF + 1.25, yF + 1.85, 'win', { shutters: false });
      if (up) add(front, sm + len * 0.1, 1.0, yF + 3.05, yF + 4.0, 'barn');
      add(back, sm, 0.22, yF + 1.2, yF + 1.9, 'slit');
    }
  }
  // gables
  for (const side of [2, 3]) {
    const sEnd = side === 2 ? a : -a, p = parts.find((q) => sEnd >= q.s0 - 0.01 && sEnd <= q.s1 + 0.01) || parts[0];
    const fc = facade(blk.F, side, a, b), L = fc.L;
    const bl = (x, y) => { const q = fc.at(x, 0, -0.9); const o = ctx.bidx.inside(q[0], q[2], blk); return o && y < o.yE + 0.6; };
    const push = (x, w, y0, y1, kind) => { if (!bl(x, y0)) blk.ops[side].push({ x0: x - w / 2, x1: x + w / 2, y0, y1, kind, lit: kind === 'win' && blk.occupied && R() < 0.4 ? 0.6 : 0, shutters: blk.shutters && kind === 'win' }); };
    if (p.kind === 'dwelling') {
      for (const x of [L * 0.3, L * 0.7]) { push(x, 0.85, yF + 0.9, yF + 2.05, 'win'); if (up) push(x, 0.85, yF + 3.15, yF + 4.2, 'win'); }
      push(L / 2, 0.6, blk.yE + 0.6, blk.yE + 1.4, 'attic');
    } else {
      push(L / 2, 1.1, blk.yE + 0.35, blk.yE + 1.55, 'barn');
      push(L * 0.25, 0.22, yF + 1.4, yF + 2.2, 'slit');
    }
  }
}

// a farm from a spec: {cx, cz, ux, uz (ridge axis), L, D, parts: [[kind, length]], front: 0|1, wall, kessler}
function farmBlocks(ctx, spec, R) {
  const { cx, cz, ux, uz, L, D } = spec, F0 = frame(cx, cz, ux, uz);
  const [lo, hi] = groundRange(ctx.heightAt, F0, L / 2, D / 2);
  const yF = hi + 0.25, yE = yF + (spec.eave ?? 5.3), pitch = (spec.pitch ?? 46) * DEG;
  const out = [];
  let s = -L / 2;
  const stoneCol = pick(R, PAL.stone), slateCol = pick(R, PAL.slate), shutterCol = spec.shutterCol || pick(R, [PAL.shutter[0], PAL.shutter[1], PAL.shutter[5], PAL.shutter[6]]);
  spec.parts.forEach(([kind, len], i) => {
    const sc = s + len / 2, last = i === spec.parts.length - 1;
    const white = kind === 'dwelling' && spec.whiteDwelling;
    out.push({
      F: frame(cx + ux * sc, cz + uz * sc, ux, uz), a: len / 2, b: D / 2, part: kind, frontSide: spec.front ?? 1, farm: true,
      wall: white ? 'stucco' : 'stone', wallCol: white ? lin('#E4E0D6') : stoneCol, plinthCol: lin('#6E6C68'),
      frameCol: kind === 'dwelling' ? PAL.trim[1] : PAL.woodDark, surroundCol: PAL.trim[2], shutterCol, doorCol: pick(R, PAL.door), slateCol, sillCol: PAL.sill[1],
      lintelCol: lin('#B8B2A6'), lintel: !white, surround: white, cornice: false, shutters: kind === 'dwelling', occupied: kind === 'dwelling' && spec.occupied !== false,
      smoky: kind === 'dwelling' && spec.smoke !== false, snowK: spec.snowK ?? 1, pitch, yB: lo - 0.8, yF, yE, floors: 2, barnCol: spec.barnCol || PAL.woodDark,
      roof: { ov: 0.38, vo: 0.18, voA: i === 0 ? 0.18 : 0, voB: last ? 0.18 : 0, thk: 0.2, snowT: 0.24 + R() * 0.06 }, icicles: !!spec.icicles, doorAnchor: kind === 'dwelling' && !!spec.kessler,
      chimneys: [], street: null, region: 'village',
    });
    s += len;
  });
  // chimney on the dwelling: at its outer gable and/or where it meets the barn
  const dw = out.find((o) => o.part === 'dwelling');
  if (dw) {
    const yR = dw.yE + dw.roof.thk + dw.b * Math.tan(pitch), i = out.indexOf(dw), outerSign = i === 0 ? -1 : 1;
    dw.chimneys.push({ s: outerSign * (dw.a - 0.7), t: 0, w: 0.62, d: 0.85, top: yR + 1.0, mat: 'stone', col: dw.wallCol, smoke: dw.smoky });
    if (R() < 0.5) dw.chimneys.push({ s: -outerSign * (dw.a - 0.6), t: 0.2, w: 0.55, d: 0.75, top: yR + 0.9, mat: 'brick', col: PAL.brick[0], smoke: false });
  }
  return out;
}

// ═══════════════════════════════ the Arlon road ═══════════════════════════════════════════════════════════════
// the 1944 road: today's N4 is a dual carriageway here — average its two ways into one centreline x(z) (as ground.js does)
function arlonLine(geo, z0 = -2300, z1 = 1500) {
  const pts = [];
  for (const r of geo.roads) if (r.ref === 'N4') for (let k = 0; k < r.p.length - 1; k++) {
    const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1], L = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s <= L; s += 5) { const x = ax + (bx - ax) * s / L, z = az + (bz - az) * s / L; if (z > z0 - 20 && z < z1 + 20 && Math.abs(x) < 800) pts.push([x, z]); }
  }
  const ZB = 20, NB = Math.ceil((z1 - z0) / ZB) + 1, sum = new Float64Array(NB), cnt = new Float64Array(NB);
  for (const [x, z] of pts) { const b = Math.round((z - z0) / ZB); if (b >= 0 && b < NB) { sum[b] += x; cnt[b]++; } }
  let xs = []; for (let b = 0; b < NB; b++) xs.push(cnt[b] ? sum[b] / cnt[b] : null);
  for (let b = 0; b < NB; b++) if (xs[b] == null) { let l = b, r2 = b; while (l >= 0 && xs[l] == null) l--; while (r2 < NB && xs[r2] == null) r2++; xs[b] = l < 0 ? (xs[r2] ?? 0) : r2 >= NB ? xs[l] : lerp(xs[l], xs[r2], (b - l) / (r2 - l)); }
  for (let it = 0; it < 6; it++) xs = xs.map((v, b) => (xs[Math.max(0, b - 1)] + 2 * v + xs[Math.min(NB - 1, b + 1)]) / 4);
  const x = (z) => { const f = (z - z0) / ZB, b = clamp(Math.floor(f), 0, NB - 2), t = clamp(f - b); return lerp(xs[b], xs[b + 1], t); };
  const dir = (z) => { const dx = x(z - 2) - x(z + 2), dz = -4, l = Math.hypot(dx, dz); return [dx / l, dz / l]; };   // heading north
  return { x, dir };
}

// telegraph line: a pole every ~45 m, cross-arm, four insulators, four sagging wires.
// offset: metres from the road centreline, + = east of the northbound road (keeps the line out of the telephoto from the origin)
function telegraph(ctx, B, line, zFrom, zTo, R, offset = 6) {
  const pts = [];
  for (let z = zFrom; z >= zTo; z -= 4) pts.push([line.x(z), z]);
  const poles = []; let acc = 0, next = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc >= next) {
      const [x, z] = pts[i], [dx, dz] = line.dir(z), lx = dz, lz = -dx;        // (lx, lz): west of the northbound road
      poles.push({ x: x - lx * offset, z: z - lz * offset, dx, dz, lx, lz });
      next = acc + 45 + (R() - 0.5) * 5;
    }
  }
  const W = B.wood, T = B.trim;
  const tops = [];
  for (const p of poles) {
    p.x = p.x; const g = ctx.heightAt(p.x, p.z), H = 7.1 + R() * 0.9;
    const lean = [(R() - 0.5) * 0.025, (R() - 0.5) * 0.025];
    const top = [p.x + lean[0] * H, g + H, p.z + lean[1] * H];
    B.setOrg(p.x, 0, p.z);
    W.color(lin('#6E5F50')); W.cyl([p.x - lean[0] * 1.2, g - 1.2, p.z - lean[1] * 1.2], top, 0.12, 0.09, 8, true, false);
    const ya = top[1] - 0.38, c = [top[0] - lean[0] * 0.38, ya, top[2] - lean[1] * 0.38];
    W.color(lin('#7A6A58')); W.obox(c, [p.lx, 0, p.lz], [0, 1, 0], [p.dx, 0, p.dz], 1.08, 0.055, 0.05);
    const ins = [];
    for (const o of [-0.92, -0.32, 0.32, 0.92]) {
      const b0 = [c[0] + p.lx * o, ya + 0.055, c[2] + p.lz * o];
      T.color(lin('#DDE4E0')); T.cyl(b0, [b0[0], b0[1] + 0.13, b0[2]], 0.035, 0.028, 6, true, false);
      ins.push([b0[0], b0[1] + 0.12, b0[2]]);
    }
    if (ctx.snowOn) snowRect(B.snow, top[0], top[2], 1, 0, 0, 1, 0.07, 0.07, top[1], 0.07, 0.6);
    tops.push(ins);
    ctx.anchors.poles.push(new THREE.Vector3(...top));
  }
  // wires: parabolic sag, thin 4-sided tubes
  const M = B.metal;
  for (let i = 0; i < tops.length - 1; i++) for (let k = 0; k < 4; k++) {
    const A = tops[i][k], C = tops[i + 1][k], sag = 0.4 + 0.15 * R(), n = 12;
    let prev = A;
    for (let j = 1; j <= n; j++) {
      const t = j / n, P = [lerp(A[0], C[0], t), lerp(A[1], C[1], t) - 4 * sag * t * (1 - t), lerp(A[2], C[2], t)];
      M.cyl(prev, P, 0.0075, 0.0075, 4, false, false); prev = P;
    }
  }
  return poles;
}

// wire fence along a polyline of plan points: posts every ~3.2 m, three strands
function wireFence(ctx, B, pts, R, o = {}) {
  const W = B.wood, M = B.metal, posts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 3.2));
    for (let j = i === 0 ? 0 : 1; j <= n; j++) {
      const t = j / n + (j > 0 && j < n ? (R() - 0.5) * 0.08 / n : 0), x = lerp(ax, bx, t), z = lerp(az, bz, t);
      if (ctx.keepOut && ctx.keepOut(x, z)) { posts.push(null); continue; }
      posts.push([x, z]);
    }
  }
  const tops = [];
  W.color(lin('#6A5A4A'));
  for (const q of posts) {
    if (!q) { tops.push(null); continue; }
    const [x, z] = q;
    const g = ctx.heightAt(x, z), h = (o.h ?? 1.3) + (R() - 0.5) * 0.12, lx = (R() - 0.5) * 0.06, lz = (R() - 0.5) * 0.06;
    W.cyl([x, g - 0.35, z], [x + lx, g + h, z + lz], 0.06, 0.05, 6, true, false);
    tops.push({ x, z, g, lx, lz, h });
  }
  const strands = o.strands ?? [0.45, 0.85, 1.2];
  for (let i = 0; i < tops.length - 1; i++) {
    const p = tops[i], q = tops[i + 1];
    if (!p || !q || Math.hypot(q.x - p.x, q.z - p.z) > 6) continue;
    for (const hs of strands) {
      const A = [p.x + p.lx * hs / p.h, p.g + hs, p.z + p.lz * hs / p.h], C = [q.x + q.lx * hs / q.h, q.g + hs, q.z + q.lz * hs / q.h];
      const Mid = [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2 - 0.03, (A[2] + C[2]) / 2];
      M.cyl(A, Mid, 0.004, 0.004, 3, false, false); M.cyl(Mid, C, 0.004, 0.004, 3, false, false);
    }
  }
  return posts.filter(Boolean).length;
}
// post-and-rail wooden fence (farm yards)
function railFence(ctx, B, pts, gaps = []) {
  const W = B.wood; W.color(lin('#7A6A5A'));
  const posts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2.2));
    for (let j = i === 0 ? 0 : 1; j <= n; j++) posts.push([lerp(ax, bx, j / n), lerp(az, bz, j / n), i]);
  }
  const inGap = (x, z) => gaps.some(([gx, gz, r]) => Math.hypot(x - gx, z - gz) < r);
  const tops = posts.map(([x, z, seg]) => ({ x, z, seg, g: ctx.heightAt(x, z), skip: inGap(x, z) }));
  for (const p of tops) if (!p.skip) W.obox([p.x, p.g + 0.5, p.z], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.06, 0.82, 0.06, 8);
  for (let i = 0; i < tops.length - 1; i++) {
    const p = tops[i], q = tops[i + 1]; if (p.skip || q.skip) continue;
    for (const h of [0.55, 1.05]) {
      const A = [p.x, p.g + h, p.z], C = [q.x, q.g + h, q.z], d = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], L = Math.hypot(...d);
      const ax = d.map((v) => v / L), az = [ax[2], 0, -ax[0]], azl = Math.hypot(az[0], az[2]); az[0] /= azl; az[2] /= azl;
      const ay = [ax[1] * az[2] - ax[2] * az[1], ax[2] * az[0] - ax[0] * az[2], ax[0] * az[1] - ax[1] * az[0]];
      W.obox([(A[0] + C[0]) / 2, (A[1] + C[1]) / 2, (A[2] + C[2]) / 2], ax, ay, az, L / 2 + 0.05, 0.05, 0.03);
    }
  }
}
// manure heap: a lumpy low mound (dark, snow on its crown) inside a low stone kerb
function manure(ctx, B, cx, cz, ux, uz, ra, rb, h, R) {
  const vx = -uz, vz = ux, N = 14, rings = 4, D = B.dung;
  const g0 = ctx.heightAt(cx, cz);
  const P = (i, j) => {
    const an = i / N * Math.PI * 2, f = j / rings, w = 0.85 + 0.3 * hash2i(i, j, 7);
    const rr = (1 - f * f * 0.85) * w, s = Math.cos(an) * ra * rr, t = Math.sin(an) * rb * rr;
    const x = cx + ux * s + vx * t, z = cz + uz * s + vz * t;
    return [x, ctx.heightAt(x, z) - 0.15 + h * Math.sin(f * Math.PI / 2) * (0.85 + 0.25 * hash2i(i + 3, j, 5)), z];
  };
  D.color(lin('#FFFFFF'));
  for (let j = 0; j < rings; j++) for (let i = 0; i < N; i++) D.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), [P(i, j)[0] - cx, 0.8, P(i, j)[2] - cz]);
  const top = [cx, g0 - 0.15 + h * 1.02, cz];
  for (let i = 0; i < N; i++) D.poly([P(i, rings), P(i + 1, rings), top], [0, 1, 0]);
  // kerb on three sides
  const S = B.stone; S.color(lin('#9A968E'));
  const F = frame(cx, cz, ux, uz);
  B.setOrg(cx, 0, cz);
  S.fbox(F, -ra - 0.3, ra + 0.3, g0 - 0.4, g0 + 0.4, -rb - 0.45, -rb - 0.2);
  S.fbox(F, -ra - 0.3, -ra - 0.05, g0 - 0.4, g0 + 0.4, -rb - 0.2, rb + 0.3);
  S.fbox(F, ra + 0.05, ra + 0.3, g0 - 0.4, g0 + 0.4, -rb - 0.2, rb + 0.3);
}
// a stack of split logs against a wall: base point C on the ground at the wall, along-wall unit (ax, az), outward unit (ox, oz)
function woodpile(ctx, B, C, ax, az, ox, oz, length, height, R) {
  const W = B.wood, rows = Math.round(height / 0.16), g = ctx.heightAt(C[0], C[1]);
  B.setOrg(C[0], 0, C[1]);
  for (let r = 0; r < rows; r++) {
    for (let x = 0.09 + (r % 2) * 0.08; x < length - 0.08; x += 0.16 + R() * 0.03) {
      const rad = 0.062 + R() * 0.024, y = g + 0.08 + r * 0.155 + (R() - 0.5) * 0.02, sh = (R() - 0.5) * 0.1;
      W.color(lin(pick(R, ['#8C7A64', '#9A876E', '#7E6C58', '#A8957A'])));
      const a0 = [C[0] + ax * x + ox * (0.05 + sh), y, C[1] + az * x + oz * (0.05 + sh)], a1 = [a0[0] + ox * (0.72 + R() * 0.16), y, a0[2] + oz * (0.72 + R() * 0.16)];
      W.cyl(a0, a1, rad, rad, 6, true, true);
    }
  }
  W.color(lin('#5A4A3C'));                                                   // a plank lean-to over it
  const top = g + height + 0.2, c = [C[0] + ax * length / 2 + ox * 0.55, top, C[1] + az * length / 2 + oz * 0.55];
  W.obox(c, [ax, 0, az], [-ox * 0.26, 0.966, -oz * 0.26], [ox * 0.966, 0.26, oz * 0.966], length / 2 + 0.15, 0.025, 0.62);
}

// the Kessler farm and the four farmsteads of Remoifosse
function buildArlonFarms(ctx, B, geo, line, opts, R) {
  const blocks = [];
  // Kessler farm (Company F's command post; the German parlementaires were brought here on 22 December)
  const fm = opts.farm, rot = fm.rot ?? 0, fux = -Math.sin(rot), fuz = -Math.cos(rot);
  const kes = farmBlocks(ctx, { cx: fm.x, cz: fm.z, ux: fux, uz: fuz, L: 28, D: 10.4, parts: [['stable', 6], ['barn', 11.5], ['dwelling', 10.5]], front: 1,
    kessler: true, icicles: true, shutterCol: lin('#4E5A4C'), barnCol: lin('#5A4636') }, R);
  blocks.push(...kes);
  // Remoifosse: four farmsteads strung along the road round the hamlet
  const rem = geo.places?.Remoifosse;
  if (rem) {
    const lay = [[-165, 1, 24, 0], [-75, -1, 27, 1], [15, 1, 22, 0], [105, -1, 25, 1]];
    for (const [dzz, side, set, perp] of lay) {
      const z = rem.z + dzz, x0 = line.x(z), [dx, dz] = line.dir(z), lx = dz, lz = -dx;
      const cx = x0 - lx * side * set, cz = z - lz * side * set;
      const L = 20 + R() * 9, D = 9.5 + R() * 1.2;
      const ux = perp ? -lx * side : dx, uz = perp ? -lz * side : dz;
      const parts = R() < 0.5 ? [['dwelling', L * 0.4], ['barn', L * 0.4], ['stable', L * 0.2]] : [['stable', L * 0.22], ['barn', L * 0.4], ['dwelling', L * 0.38]];
      const fb = farmBlocks(ctx, { cx, cz, ux, uz, L, D, parts, front: perp ? (R() < 0.5 ? 0 : 1) : (side > 0 ? 1 : 0), whiteDwelling: R() < 0.35, icicles: true }, R);
      blocks.push(...fb);
      if (R() < 0.7) {                                    // a detached barn behind
        const bx = cx - lx * side * 14 + dx * 8, bz = cz - lz * side * 14 + dz * 8;
        blocks.push(...farmBlocks(ctx, { cx: bx, cz: bz, ux: -lx * side, uz: -lz * side, L: 9 + R() * 4, D: 7.5, parts: [['barn', 10]], front: 0, eave: 4.2, smoke: false }, R).map((q) => { q.a = q.a; return q; }));
      }
    }
  }
  ctx.bidx = blockIndex(blocks);
  for (const blk of blocks) farmOpenings(ctx, blk, R);
  for (const blk of blocks) buildBlock(ctx, B, blk);
  // Kessler farm yard: fence towards the road with gaps at the cart door and the house door, manure heap, woodpile
  const Fk = frame(fm.x, fm.z, fux, fuz), b = 5.2, a = 14;
  const frontDist = Math.abs((line.x(fm.z) - fm.x) * Fk.vx + 0 * Fk.vz) - b;
  const yard = clamp(frontDist - 9.5, 3.5, 7);
  const P = (s, t) => { const p = Fk.p(s, 0, t); return [p[0], p[2]]; };
  const gaps = [];
  for (const blk of kes) for (const op of blk.ops[1]) if (op.kind === 'door' || op.kind === 'barn') {
    const sl = blk.a - (op.x0 + op.x1) / 2, w = blk.F.p(sl, 0, -b - yard);
    gaps.push([w[0], w[2], op.kind === 'barn' ? 2.1 : 0.9]);
    if (op.kind === 'door' && blk.part === 'dwelling') { const q = blk.F.p(sl, 0, 0); ctx.farmDoorS = q; }
  }
  railFence(ctx, B, [P(-a - 1, -b - 0.2), P(-a - 1, -b - yard), P(a + 1, -b - yard), P(a + 1, -b - 0.2)], gaps);
  const st = kes.find((q) => q.part === 'stable'), sc = st ? st.F : Fk;
  const mp = sc.p(0, 0, -b - yard * 0.5);
  manure(ctx, B, mp[0], mp[2], fux, fuz, 2.2, Math.min(1.7, yard * 0.27), 1.05, R);
  const dw = kes.find((q) => q.part === 'dwelling');
  if (dw) {
    const gs = dw.F.p(dw.a + 0.02, 0, -b + 1.0);                               // against the dwelling's outer gable
    woodpile(ctx, B, [gs[0], gs[2]], dw.F.vx, dw.F.vz, dw.F.ux, dw.F.uz, 3.6, 1.35, R);
  }
  return blocks;
}
// Marvie: a dozen farm buildings and houses along the lanes round the village centre
function buildMarvie(ctx, B, geo, R) {
  const blocks = [];
  // Marvie: a dozen buildings along its lanes
  const mv = geo.places?.Marvie;
  if (mv) {
    const segs = [];
    for (const r of geo.roads) if (['tertiary', 'unclassified', 'residential', 'secondary'].includes(r.k)) for (let k = 0; k < r.p.length - 1; k++) {
      const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1];
      if (Math.hypot((ax + bx) / 2 - mv.x, (az + bz) / 2 - mv.z) < 260) segs.push([ax, az, bx, bz]);
    }
    const placed = [];
    const types = ['farm', 'house', 'farm', 'barn', 'house', 'farm', 'shed', 'house', 'farm', 'house', 'barn', 'shed', 'house', 'farm'];
    let ti = 0;
    segs.sort((p, q) => Math.hypot((p[0] + p[2]) / 2 - mv.x, (p[1] + p[3]) / 2 - mv.z) - Math.hypot((q[0] + q[2]) / 2 - mv.x, (q[1] + q[3]) / 2 - mv.z));
    for (const s of segs) {
      const L = Math.hypot(s[2] - s[0], s[3] - s[1]); if (L < 8) continue;
      const dx = (s[2] - s[0]) / L, dz = (s[3] - s[1]) / L;
      for (let d = 6 + R() * 10; d < L - 4 && ti < 13; d += 26 + R() * 18) {
        const type = types[ti % types.length], side = R() < 0.5 ? 1 : -1;
        const len = type === 'farm' ? 18 + R() * 8 : type === 'house' ? 9 + R() * 3 : type === 'barn' ? 11 + R() * 3 : 6 + R() * 2;
        const dep = type === 'farm' ? 9.5 + R() : type === 'house' ? 8 + R() : type === 'barn' ? 8.5 : 5.5;
        const perp = type !== 'farm' && R() < 0.35;
        const setb = 7 + (perp ? len / 2 : dep / 2) + R() * 3;
        const cx = s[0] + dx * d - dz * side * setb, cz = s[1] + dz * d + dx * side * setb;
        const rad = Math.hypot(len, dep) / 2;
        if (Math.hypot(cx - mv.x, cz - mv.z) > 300) continue;
        if (placed.some((p) => Math.hypot(p[0] - cx, p[1] - cz) < p[2] + rad + 3)) continue;
        if (segs.some((q) => q !== s && segDist(cx, cz, q[0], q[1], q[2], q[3]).d < rad * 0.6 + 4)) continue;
        placed.push([cx, cz, rad]); ti++;
        const ux = perp ? -dz * side : dx, uz = perp ? dx * side : dz;
        const parts = type === 'farm' ? [['dwelling', len * 0.4], ['barn', len * 0.42], ['stable', len * 0.18]] : type === 'house' ? [['dwelling', len]] : [['barn', len]];
        const fb = farmBlocks(ctx, { cx, cz, ux, uz, L: len, D: dep, parts, front: perp ? 1 : (side > 0 ? 1 : 0), eave: type === 'shed' ? 3.0 : type === 'barn' ? 4.6 : 5.3,
          whiteDwelling: R() < 0.3, smoke: type !== 'barn' && type !== 'shed', occupied: type === 'farm' || type === 'house' }, R);
        for (const q of fb) q.street = { x: s[0] + dx * d, z: s[1] + dz * d };
        blocks.push(...fb);
      }
    }
  }
  ctx.bidx = blockIndex(blocks);
  for (const blk of blocks) farmOpenings(ctx, blk, R);
  for (const blk of blocks) buildBlock(ctx, B, blk);
  return blocks;
}

// ═══════════════════════════════ fields round the origin ════════════════════════════════════════════════════
function buildFields(ctx, B, line, farm, R, rad = 400) {
  let posts = 0;
  const inR = (p) => Math.hypot(p[0], p[1]) < rad;
  const side_pt = (z, side, off) => { const x0 = line.x(z), [dx, dz] = line.dir(z); return [x0 - dz * side * off, z + dx * side * off]; };
  const nearFarm = (z, side) => side > 0 && Math.abs(z - farm.z) < 34;
  for (const side of [-1, 1]) {
    // along the road, 12 m out, broken by field gates
    let z = rad - 10;
    while (z > -rad + 10) {
      const run = 55 + R() * 95, z1 = Math.max(-rad + 10, z - run), pts = [];
      for (let zz = z; zz >= z1; zz -= 8) { if (nearFarm(zz, side)) { if (pts.length > 1) posts += wireFence(ctx, B, pts.slice(), R); pts.length = 0; continue; } const p = side_pt(zz, side, 12); if (inR(p)) pts.push(p); }
      if (pts.length > 1) posts += wireFence(ctx, B, pts, R);
      z = z1 - (6 + R() * 8);
    }
    // field boundaries running away from the road
    for (let zc = rad - 40 - R() * 60; zc > -rad + 30; zc -= 70 + R() * 90) {
      if (nearFarm(zc, side) || (side > 0 && Math.abs(zc - farm.z) < 60)) continue;
      const p0 = side_pt(zc, side, 12), [dx, dz] = line.dir(zc), ang = (R() - 0.5) * 0.35;
      let ox = -dz * side, oz = dx * side; const c = Math.cos(ang), sn = Math.sin(ang); [ox, oz] = [ox * c - oz * sn, ox * sn + oz * c];
      const L = 100 + R() * 240, pts = [p0];
      for (let d = 20; d <= L; d += 20) { const p = [p0[0] + ox * d, p0[1] + oz * d]; if (!inR(p)) break; pts.push(p); }
      if (pts.length > 1) posts += wireFence(ctx, B, pts, R);
    }
  }
  return posts;
}

// ═══════════════════════════════ the pillbox ════════════════════════════════════════════════════════════════
// a pre-war Belgian concrete blockhouse: board-marked concrete, stepped embrasures towards the road, a rear door behind
// a blast wall, a thick snow cap and drifts; scorch marks where Cobra King's three rounds hit on 26 December
function embrasure(C, Dk, fc, xc, yc, w = 0.5, h = 0.26) {
  const steps = [[w + 0.5, h + 0.42, 0, 0.18], [w + 0.24, h + 0.2, 0.18, 0.36], [w, h, 0.36, 0.95]];
  for (let i = 0; i < steps.length; i++) {
    const [W, H, d0, d1] = steps[i], x0 = xc - W / 2, x1 = xc + W / 2, y0 = yc - H / 2, y1 = yc + H / 2;
    C.quad(fc.at(x0, y0, d0), fc.at(x0, y0, d1), fc.at(x0, y1, d1), fc.at(x0, y1, d0), fc.D);
    C.quad(fc.at(x1, y0, d0), fc.at(x1, y0, d1), fc.at(x1, y1, d1), fc.at(x1, y1, d0), [-fc.D[0], 0, -fc.D[2]]);
    C.quad(fc.at(x0, y1, d0), fc.at(x1, y1, d0), fc.at(x1, y1, d1), fc.at(x0, y1, d1), [0, -1, 0]);
    C.quad(fc.at(x0, y0, d0), fc.at(x1, y0, d0), fc.at(x1, y0, d1), fc.at(x0, y0, d1), [0, 1, 0]);
    if (i < steps.length - 1) {
      const [W2, H2] = steps[i + 1], a0 = xc - W2 / 2, a1 = xc + W2 / 2, b0 = yc - H2 / 2, b1 = yc + H2 / 2;
      C.quad(fc.at(x0, y0, d1), fc.at(x1, y0, d1), fc.at(x1, b0, d1), fc.at(x0, b0, d1), fc.N);
      C.quad(fc.at(x0, b1, d1), fc.at(x1, b1, d1), fc.at(x1, y1, d1), fc.at(x0, y1, d1), fc.N);
      C.quad(fc.at(x0, b0, d1), fc.at(a0, b0, d1), fc.at(a0, b1, d1), fc.at(x0, b1, d1), fc.N);
      C.quad(fc.at(a1, b0, d1), fc.at(x1, b0, d1), fc.at(x1, b1, d1), fc.at(a1, b1, d1), fc.N);
    } else Dk.quad(fc.at(x0, y0, d1), fc.at(x1, y0, d1), fc.at(x1, y1, d1), fc.at(x0, y1, d1), fc.N);
  }
  return { x0: xc - steps[0][0] / 2, x1: xc + steps[0][0] / 2, y0: yc - steps[0][1] / 2, y1: yc + steps[0][1] / 2 };
}
function scorch(S, fc, xc, yc, r, alpha = 200) {
  const c = fc.at(xc, yc, -0.01), n = 9;
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, r0 = r * (0.7 + 0.5 * hash2i(i, Math.round(xc * 10), 4)), r1 = r * (0.7 + 0.5 * hash2i((i + 1) % n, Math.round(xc * 10), 4));
    S.poly([c, fc.at(xc + Math.cos(a0) * r0, yc + Math.sin(a0) * r0 * 0.8, -0.01), fc.at(xc + Math.cos(a1) * r1, yc + Math.sin(a1) * r1 * 0.8, -0.01)], fc.N, null,
      [[0, 0, 0, alpha], [0, 0, 0, 0], [0, 0, 0, 0]]);
  }
}
function buildPillbox(ctx, B, P, R) {
  const F = frame(P.x, P.z, Math.cos(P.rot), -Math.sin(P.rot)), a = 2.6, b = 2.2;
  const [lo, hi] = groundRange(ctx.heightAt, F, a + 1.5, b + 1.5);
  const g = hi - 0.35, yT = g + 2.15, yB = lo - 0.7;
  B.setOrg(P.x, 0, P.z);
  const C = B.concrete; C.color(lin('#FFFFFF'));
  for (let side = 0; side < 4; side++) {
    const fc = facade(F, side, a, b), holes = [];
    if (side === 1) for (const x of [fc.L * 0.3, fc.L * 0.7]) holes.push(embrasure(C, B.dark, fc, x, g + 1.1));
    if (side === 2) holes.push(embrasure(C, B.dark, fc, fc.L / 2, g + 1.1, 0.36, 0.22));
    if (side === 0) {
      const x0 = fc.L / 2 - 0.42, x1 = fc.L / 2 + 0.42, y0 = g + 0.02, y1 = g + 1.8, D = 0.9;
      holes.push({ x0, x1, y0, y1 });
      C.quad(fc.at(x0, y0, 0), fc.at(x0, y0, D), fc.at(x0, y1, D), fc.at(x0, y1, 0), fc.D);
      C.quad(fc.at(x1, y0, 0), fc.at(x1, y0, D), fc.at(x1, y1, D), fc.at(x1, y1, 0), [-fc.D[0], 0, -fc.D[2]]);
      C.quad(fc.at(x0, y1, 0), fc.at(x1, y1, 0), fc.at(x1, y1, D), fc.at(x0, y1, D), [0, -1, 0]);
      B.metal.color(lin('#3A3A38')); B.metal.quad(fc.at(x0, y0, D * 0.6), fc.at(x1, y0, D * 0.6), fc.at(x1, y1, D * 0.6), fc.at(x0, y1, D * 0.6), fc.N);
    }
    wallHoles(C, fc, yB, yT, holes);
    if (side === 1) { scorch(B.soot, fc, fc.L * 0.3 + 0.1, g + 1.2, 0.75, 210); scorch(B.soot, fc, fc.L * 0.7 - 0.2, g + 1.35, 0.55, 170); scorch(B.soot, fc, fc.L * 0.52, g + 1.85, 0.45, 150); }
  }
  C.fbox(F, -a - 0.18, a + 0.18, yT, yT + 0.42, -b - 0.18, b + 0.18);
  C.fbox(F, -1.25, 1.25, yB, g + 1.95, b + 1.05, b + 1.45);                                      // blast wall behind the door
  C.fbox(F, -1.25, -0.95, yB, g + 1.95, b, b + 1.05);
  const c0 = F.p(0, 0, 0);
  snowRect(B.snow, c0[0], c0[2], F.ux, F.uz, F.vx, F.vz, a + 0.14, b + 0.14, yT + 0.42, 0.3, 0.5);
  // a low skirt of drifted snow along the walls (thin, so it reads as a soft fillet, not a wedge)
  const S = B.snow;
  for (let side = 0; side < 4; side++) {
    const fc = facade(F, side, a + 0.18, b + 0.18), n = 5, cols = [];
    for (let i = 0; i <= n; i++) {
      const x = fc.L * i / n, foot = fc.at(x, 0, 0), gf = ctx.heightAt(foot[0], foot[2]);
      const k = (side === 0 ? 0.3 : 0.75) * (0.75 + 0.5 * hash2i(i, side, 17)) * (i === 0 || i === n ? 0.3 : 1);
      const prof = [[0, 0.42], [0.25, 0.36], [0.6, 0.2], [1.1, 0.03]];
      cols.push(prof.map(([o, hh]) => { const q = fc.at(x, 0, -o * k * 1.4); const gq = ctx.heightAt(q[0], q[2]); return { base: [foot[0], gf - 0.08, foot[2]], off: [q[0] - foot[0], gq - gf + hh * k, q[2] - foot[2]] }; }));
    }
    for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) {
      const A = cols[i][r], Bq = cols[i + 1][r], C = cols[i + 1][r + 1], D = cols[i][r + 1];
      S.quad(A.base, Bq.base, C.base, D.base, [fc.nx, 1.5, fc.nz], [A.off, Bq.off, C.off, D.off]);
    }
  }
  return new THREE.Vector3(c0[0], yT + 0.4, c0[2]);
}
function defaultPillbox(ctx) {
  const q = ctx.mainIdx.nearest(-1300, -700, 900);
  if (!q) return { x: -1300, z: -700, rot: 0 };
  let dx = q.dx, dz = q.dz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  if (dz > 0) { dx = -dx; dz = -dz; }                                     // heading north, towards Bastogne
  const rx = -dz, rz = dx;                                                // right-hand side of the road
  return { x: q.x + rx * 9, z: q.z + rz * 9, rot: Math.atan2(rx, rz) };
}

// ═══════════════════════════════ villages: burning houses ═════════════════════════════════════════════════
function markBurning(ctx, groups, n, place, R) {
  if (!n) return;
  const cand = [];
  for (const g of groups) {
    const m = g.find((q) => !q.rear) || g[0], area = m.a * m.b * 4;
    if (m.shed || area < 50 || area > 420) continue;
    const road = ctx.mainIdx.nearest(m.F.cx, m.F.cz, 80), dPl = place ? Math.hypot(m.F.cx - place.x, m.F.cz - place.z) : 0;
    cand.push({ g, m, score: (road ? road.d : 80) + dPl * 0.12 + R() * 30 });
  }
  cand.sort((p, q) => p.score - q.score);
  for (const { g, m } of cand.slice(0, n)) {
    for (const blk of g) Object.assign(blk, { burning: true, snowK: 0, occupied: false, smoky: false, shutters: false, cornice: false, icicles: false });
    const k = R() < 0.3 ? 0 : R() < 0.5 ? 1 : -1, len = m.a * (0.8 + R() * 0.5), c = (R() - 0.5) * m.a * 0.5;
    m.hole = { k, s0: clamp(c - len / 2, -m.a + 0.6, m.a - 1.8), s1: clamp(c + len / 2, -m.a + 1.8, m.a - 0.6) };
  }
}
function markFireWindows(groups) {
  for (const g of groups) for (const blk of g) if (blk.burning) {
    let n = 0;
    for (const side of [0, 1, 2, 3]) for (const op of blk.ops[side]) if ((op.kind === 'win' || op.kind === 'door') && op.y0 < blk.yF + 3.5 && n < 3) { op.fireWin = true; n++; }
  }
}
function fallbackHeight(geo) {
  const Hh = geo.height, A = geo.H;
  if (!A || !Hh) return () => 0;
  const n = Hh.n, cell = Hh.size / (n - 1);
  return (x, z) => {
    const fx = clamp((x - Hh.x0) / cell, 0, n - 1.001), fz = clamp((z - Hh.z0) / cell, 0, n - 1.001), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    return (A[j * n + i] * (1 - tx) + A[j * n + i + 1] * tx) * (1 - tz) + (A[(j + 1) * n + i] * (1 - tx) + A[(j + 1) * n + i + 1] * tx) * tz;
  };
}

// ═══════════════════════════════ the whole town ═════════════════════════════════════════════════════════════
export async function buildTown(geo, opts = {}) {
  const t0 = performance.now();
  const heightAt = opts.heightAt || fallbackHeight(geo);
  const farm = { x: 22, z: -35, rot: 0, ...(opts.farm || {}) };
  const burning = opts.burning ?? 5;
  const T = textures(), M = materials(T);
  const group = new THREE.Group(); group.name = 'town';
  const anchors = { chimneys: [], smoke: [], smokeBy: {}, churchTop: new THREE.Vector3(), fires: [], fireWindows: [], farmDoor: new THREE.Vector3(), poles: [], pillbox: new THREE.Vector3() };
  const segs = [], mainSegs = [];
  for (const r of geo.roads) {
    if (['track', 'path', 'footway', 'cycleway', 'steps', 'service', 'bridleway', 'pedestrian'].includes(r.k)) continue;
    for (let k = 0; k < r.p.length - 1; k++) {
      const s = [r.p[k][0], r.p[k][1], r.p[k + 1][0], r.p[k + 1][1]]; segs.push(s);
      if (['trunk', 'primary', 'secondary', 'tertiary'].includes(r.k)) mainSegs.push(s);
    }
  }
  const ctx = { geo, heightAt, anchors, roads: segIndex(segs, 60), mainIdx: segIndex(mainSegs, 60), snowOn: true, extraBlocks: [] };
  // keep fence posts out of the telephoto sightline from the foxhole line (origin) to the church: a 2 deg wedge, first 450 m
  { const cb = Math.atan2(geo.church.x, -geo.church.z);
    ctx.keepOut = (x, z) => { const d = Math.hypot(x, z); if (d > 450 || d < 3) return false; let da = Math.atan2(x, -z) - cb; da = Math.atan2(Math.sin(da), Math.cos(da)); return Math.abs(da) < 2.0 * DEG + 1.5 / d; }; }
  const stats = {}, tick = () => new Promise((r) => setTimeout(r, 0));
  const add = (B, name, extra = {}) => { const g = meshesFrom(B, M, name); group.add(g); stats[name] = { triangles: g.userData.triangles, ...extra }; return g; };

  // Bastogne: the old town, Saint-Pierre, the Porte de Trèves
  {
    ctx.place = 'bastogne';
    const B = builders(), church = findChurch(geo), porte = findPorte(geo);
    if (porte) { const pb = buildPorte(ctx, B, porte); ctx.extraBlocks = [pb]; }
    const fps = selectBastogne(geo, ctx.mainIdx, rng(1944));
    const reg = buildRegion(ctx, B, fps, 'town', 1225, { special: (fp) => fp === church || fp === porte });
    if (church) buildChurch(ctx, B, church);
    ctx.extraBlocks = [];
    add(B, 'bastogne', { footprints: reg.groups.length, blocks: reg.blocks.length });
  }
  await tick();
  // Assenois, with the burning houses of 26 December
  {
    ctx.place = 'assenois';
    const B = builders(), pl = geo.places?.Assenois, fps = selectNear(geo, pl, 320);
    const churches = fps.filter((b) => b.k === 'church' || b.k === 'chapel');
    const reg = buildRegion(ctx, B, fps, 'village', 2612, { special: (fp) => churches.includes(fp), before: (groups, R) => markBurning(ctx, groups, burning, pl, R), after: markFireWindows });
    for (const c of churches) buildVillageChurch(ctx, B, c);
    add(B, 'assenois', { footprints: reg.groups.length, burning: Math.min(burning, reg.groups.length) });
  }
  await tick();
  // Hemroulle (footprints in the data; opts.hemroulle = false to skip)
  if (opts.hemroulle !== false && geo.places?.Hemroulle) {
    ctx.place = 'hemroulle';
    const B = builders(), fps = selectNear(geo, geo.places.Hemroulle, 230);
    const reg = buildRegion(ctx, B, fps, 'village', 1712);
    add(B, 'hemroulle', { footprints: reg.groups.length });
  }
  await tick();
  // the Arlon road: the Kessler farm, Remoifosse, telegraph line, fences
  const line = arlonLine(geo);
  {
    ctx.place = 'arlon';
    const B = builders(), R = rng(22);
    const blocks = buildArlonFarms(ctx, B, geo, line, { farm }, R);
    const poles = telegraph(ctx, B, line, opts.poles?.from ?? 900, opts.poles?.to ?? -2200, rng(45), opts.poles?.offset ?? 6);
    const posts = buildFields(ctx, B, line, farm, rng(400), opts.fieldRadius ?? 400);
    add(B, 'arlon', { farmBlocks: blocks.length, poles: poles.length, fencePosts: posts });
  }
  await tick();
  // Marvie
  if (geo.places?.Marvie) { ctx.place = 'marvie'; const B = builders(); const blocks = buildMarvie(ctx, B, geo, rng(23)); add(B, 'marvie', { blocks: blocks.length }); }
  // the pillbox at the link-up
  {
    const B = builders(), P = opts.pillbox ? { rot: 0, ...opts.pillbox } : defaultPillbox(ctx);
    anchors.pillbox.copy(buildPillbox(ctx, B, P, rng(1650)));
    add(B, 'pillbox', { at: [Math.round(P.x), Math.round(P.z), +P.rot.toFixed(3)] });
  }
  const cc = new THREE.Vector3(geo.church.x, 0, geo.church.z);
  if (anchors.smokeBy.bastogne) anchors.smokeBy.bastogne.sort((p, q) => Math.hypot(p.x - cc.x, p.z - cc.z) - Math.hypot(q.x - cc.x, q.z - cc.z));
  let tris = 0; for (const k in stats) tris += stats[k].triangles;
  stats.triangles = tris; stats.ms = Math.round(performance.now() - t0);
  group.userData.stats = stats;
  function update(t, s = {}) {
    TU.uTTime.value = t;
    TU.uTSnow.value = s.snow ?? 1;
    TU.uTLights.value = s.lights ?? 0;
    TU.uTFire.value = s.fire ?? 1;
  }
  update(0, {});
  return { group, update, anchors, stats };
}

// ── f3d: a town from synthetic footprints (towns.js lays out streets and plots) ─────────────────────────────────
// o = { heightAt, footprints: [{p: [[x, z]...], k, lv}], roads: [[x0, z0, x1, z1]...], churches: [fp], style, seed, name }
export function buildSyntheticTown(o) {
  const t0 = performance.now();
  PALX = (o.palette && PALETTES[o.palette]) || null;
  const T = textures(), M = materials(T);
  const anchors = { chimneys: [], smoke: [], smokeBy: {}, churchTop: new THREE.Vector3(), fires: [], fireWindows: [], farmDoor: new THREE.Vector3(), poles: [], pillbox: new THREE.Vector3() };
  const segs = o.roads || [];
  const ctx = { geo: {}, heightAt: o.heightAt, anchors, roads: segIndex(segs, 60), mainIdx: segIndex(segs, 60), snowOn: true, extraBlocks: [], place: o.name || 'f3d' };
  const B = builders();
  const churches = o.churches || [];
  const reg = buildRegion(ctx, B, o.footprints.concat(churches), o.style || 'village', o.seed || 1, { special: (fp) => churches.includes(fp) });
  for (const c of churches) buildVillageChurch(ctx, B, c);
  const group = meshesFrom(B, M, o.name || 'town');
  PALX = null;
  function update(t, s = {}) { TU.uTTime.value = t; TU.uTSnow.value = s.snow ?? 0; TU.uTLights.value = s.lights ?? 0; TU.uTFire.value = s.fire ?? 0; }
  update(0, { snow: o.snow ?? 0 });
  return { group, update, anchors, blocks: reg.blocks, stats: { triangles: group.userData.triangles, ms: Math.round(performance.now() - t0) } };
}
export { textures as townTextures, materials as townMaterials, PAL as TOWN_PAL };
