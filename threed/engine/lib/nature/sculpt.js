// sculpt.js — clay-like creatures from a skeleton and a handful of primitives. The body is the smooth union
// (polynomial smin, per-primitive blend radius) of round cones and ellipsoids; the surface is extracted with surface nets
// on a narrow-band grid, relaxed (Taubin) and skinned automatically: every vertex takes up to 4 bones, weighted by how
// close it lies to each bone's own primitives, so blends between neck segments or thigh and flank bend smoothly.
// Bones are world-aligned at rest (identity rotations) — animation is plain local quaternions on that rest pose.
//   spec = { bones: [[name, parent|null, [x,y,z]], ...], prims: [{ t: 'rc'|'el', b: bone, a, b2, r1, r2 | c, r, rx?, k, col? }] }
//   sculpt(spec, h) -> { geometry (position, normal, color, aRest, skinIndex, skinWeight), boneDefs, zone(i) }
import * as THREE from 'three';

const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

function sdRoundCone(px, py, pz, P) {
  const bax = P.bx - P.ax, bay = P.by - P.ay, baz = P.bz - P.az;
  const l2 = P.l2, rr = P.r1 - P.r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  let pax = px - P.ax, pay = py - P.ay, paz = pz - P.az;
  if (P.sx !== 1) { pax /= P.sx; }
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const xvx = pax * l2 - bax * y, xvy = pay * l2 - bay * y, xvz = paz * l2 - baz * y;
  const x2 = xvx * xvx + xvy * xvy + xvz * xvz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  let d;
  if (Math.sign(z) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - P.r2;
  else if (Math.sign(y) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - P.r1;
  else d = (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - P.r1;
  return P.sx !== 1 ? d * Math.min(1, P.sx) : d;
}
function sdEllipsoid(px, py, pz, P) {
  let x = px - P.cx, y = py - P.cy, z = pz - P.cz;
  if (P.rx) { const c = Math.cos(P.rx), s = Math.sin(P.rx); const y2 = c * y + s * z, z2 = -s * y + c * z; y = y2; z = z2; }
  if (P.ry) { const c = Math.cos(P.ry), s = Math.sin(P.ry); const x2 = c * x - s * z, z2 = s * x + c * z; x = x2; z = z2; }
  const k0 = Math.sqrt((x / P.r[0]) ** 2 + (y / P.r[1]) ** 2 + (z / P.r[2]) ** 2);
  const k1 = Math.sqrt((x / (P.r[0] * P.r[0])) ** 2 + (y / (P.r[1] * P.r[1])) ** 2 + (z / (P.r[2] * P.r[2])) ** 2);
  return k0 * (k0 - 1) / Math.max(k1, 1e-9);
}
function prep(p) {
  const P = Object.assign({}, p);
  if (p.t === 'rc') {
    [P.ax, P.ay, P.az] = p.a; [P.bx, P.by, P.bz] = p.b2; P.sx = p.sx ?? 1;
    P.l2 = (P.bx - P.ax) ** 2 + (P.by - P.ay) ** 2 + (P.bz - P.az) ** 2;
    const m = Math.max(p.r1, p.r2);
    P.min = [Math.min(P.ax, P.bx) - m * Math.max(1, P.sx), Math.min(P.ay, P.by) - m, Math.min(P.az, P.bz) - m];
    P.max = [Math.max(P.ax, P.bx) + m * Math.max(1, P.sx), Math.max(P.ay, P.by) + m, Math.max(P.az, P.bz) + m];
    P.f = sdRoundCone;
  } else {
    [P.cx, P.cy, P.cz] = p.c; const m = Math.max(...p.r);
    const rot = p.rx || p.ry;
    P.min = rot ? [P.cx - m, P.cy - m, P.cz - m] : [P.cx - p.r[0], P.cy - p.r[1], P.cz - p.r[2]];
    P.max = rot ? [P.cx + m, P.cy + m, P.cz + m] : [P.cx + p.r[0], P.cy + p.r[1], P.cz + p.r[2]];
    P.f = sdEllipsoid;
  }
  P.k = p.k ?? 0.1;
  return P;
}

export function sculpt(spec, h, o = {}) {
  const prims = spec.prims.map(prep);
  const boneNames = spec.bones.map((b) => b[0]);
  const bi = (n) => { const i = boneNames.indexOf(n); if (i < 0) throw new Error('bone ' + n); return i; };
  prims.forEach((P) => { P.bone = bi(P.b); });
  // grid
  const kmax = Math.max(...prims.map((P) => P.k));
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const P of prims) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P.min[c] - kmax - 4 * h); hi[c] = Math.max(hi[c], P.max[c] + kmax + 4 * h); }
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz).fill(1e3);
  const I = (i, j, k) => (k * ny + j) * nx + i;
  for (const P of prims) {
    const m = P.k + 3 * h;
    const i0 = Math.max(0, Math.floor((P.min[0] - m - lo[0]) / h)), i1 = Math.min(nx - 1, Math.ceil((P.max[0] + m - lo[0]) / h));
    const j0 = Math.max(0, Math.floor((P.min[1] - m - lo[1]) / h)), j1 = Math.min(ny - 1, Math.ceil((P.max[1] + m - lo[1]) / h));
    const k0 = Math.max(0, Math.floor((P.min[2] - m - lo[2]) / h)), k1 = Math.min(nz - 1, Math.ceil((P.max[2] + m - lo[2]) / h));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = P.f(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h, P);
      const n = I(i, j, k);
      F[n] = P.sub ? Math.max(F[n], -d) : smin(F[n], d, P.k);
    }
  }
  // surface nets: one vertex per sign-changing cell (mean of edge crossings), one quad per sign-changing edge
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const C = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const OFF = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { v[c] = F[I(i + OFF[c][0], j + OFF[c][1], k + OFF[c][2])]; if (v[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += OFF[a][0] + (OFF[b][0] - OFF[a][0]) * t; sy += OFF[a][1] + (OFF[b][1] - OFF[a][1]) * t; sz += OFF[a][2] + (OFF[b][2] - OFF[a][2]) * t; n++;
    }
    cellV[C(i, j, k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {       // x edges
    const a = F[I(i, j, k)], b = F[I(i + 1, j, k)]; if ((a < 0) === (b < 0)) continue;
    quad(cellV[C(i, j - 1, k - 1)], cellV[C(i, j, k - 1)], cellV[C(i, j, k)], cellV[C(i, j - 1, k)], a < 0);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {       // y edges
    const a = F[I(i, j, k)], b = F[I(i, j + 1, k)]; if ((a < 0) === (b < 0)) continue;
    quad(cellV[C(i - 1, j, k - 1)], cellV[C(i - 1, j, k)], cellV[C(i, j, k)], cellV[C(i, j, k - 1)], a < 0);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {       // z edges
    const a = F[I(i, j, k)], b = F[I(i, j, k + 1)]; if ((a < 0) === (b < 0)) continue;
    quad(cellV[C(i - 1, j - 1, k)], cellV[C(i, j - 1, k)], cellV[C(i, j, k)], cellV[C(i - 1, j, k)], a < 0);
  }
  const nv = pos.length / 3;
  const P = new Float32Array(pos);
  // Taubin relaxation (keeps volume, removes the voxel ripple)
  const nb = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  const tmp = new Float32Array(P.length);
  for (let it = 0; it < (o.relax ?? 3) * 2; it++) {
    const lam = it % 2 === 0 ? 0.55 : -0.58;
    for (let a = 0; a < nv; a++) {
      let x = 0, y = 0, z = 0, n = 0;
      for (const b of nb[a]) { x += P[b * 3]; y += P[b * 3 + 1]; z += P[b * 3 + 2]; n++; }
      if (!n) { tmp[a * 3] = P[a * 3]; tmp[a * 3 + 1] = P[a * 3 + 1]; tmp[a * 3 + 2] = P[a * 3 + 2]; continue; }
      tmp[a * 3] = P[a * 3] + lam * (x / n - P[a * 3]); tmp[a * 3 + 1] = P[a * 3 + 1] + lam * (y / n - P[a * 3 + 1]); tmp[a * 3 + 2] = P[a * 3 + 2] + lam * (z / n - P[a * 3 + 2]);
    }
    P.set(tmp);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('aRest', new THREE.BufferAttribute(P.slice(), 3));
  // skin weights + the primitive each vertex belongs to (for colour zones)
  const nB = boneNames.length;
  const skI = new Uint16Array(nv * 4), skW = new Float32Array(nv * 4), zone = new Int16Array(nv), zoneD = new Float32Array(nv);
  const sig = o.sigma ?? h * 3;
  const bd = new Float32Array(nB);
  for (let a = 0; a < nv; a++) {
    const x = P[a * 3], y = P[a * 3 + 1], z = P[a * 3 + 2];
    bd.fill(1e9);
    let best = 1e9, bz = -1;
    for (let q = 0; q < prims.length; q++) {
      const Pq = prims[q]; if (Pq.sub) continue;
      const d = Pq.f(x, y, z, Pq);
      if (d < bd[Pq.bone]) bd[Pq.bone] = d;
      const dz = d - (Pq.zoneBias ?? 0);
      if (dz < best) { best = dz; bz = q; }
    }
    zone[a] = bz; zoneD[a] = best;
    let dmin = 1e9; for (let b = 0; b < nB; b++) dmin = Math.min(dmin, bd[b]);
    const ws = [];
    for (let b = 0; b < nB; b++) { const e = (bd[b] - dmin) / sig; if (e < 5) ws.push([b, Math.exp(-e * e)]); }
    ws.sort((p, q) => q[1] - p[1]);
    let s = 0; for (let c = 0; c < 4 && c < ws.length; c++) s += ws[c][1];
    for (let c = 0; c < 4; c++) { skI[a * 4 + c] = c < ws.length ? ws[c][0] : 0; skW[a * 4 + c] = c < ws.length ? ws[c][1] / s : 0; }
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skW, 4));
  return { geometry: g, boneDefs: spec.bones, prims, zone, zoneD, nv };
}

// bones for one instance (rest pose, world-aligned) + a SkinnedMesh bound to them
export function rig(sc, material) {
  const bones = [], byName = {};
  for (const [name, parent, head] of sc.boneDefs) {
    const b = new THREE.Bone(); b.name = name;
    const ph = parent ? sc.boneDefs.find((d) => d[0] === parent)[2] : [0, 0, 0];
    b.position.set(head[0] - ph[0], head[1] - ph[1], head[2] - ph[2]);
    b.userData.rest = b.position.clone();
    if (parent) byName[parent].add(b);
    bones.push(b); byName[name] = b;
  }
  const mesh = new THREE.SkinnedMesh(sc.geometry, material);
  const root = new THREE.Group();
  root.add(bones[0]); root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return { root, mesh, bones: byName };
}

// the skin: vertex colours (countershading, patterns) + procedural scales/wrinkles as a bump in rest space
export function skinMaterial(o = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.roughness ?? 0.72, metalness: 0, envMapIntensity: o.env ?? 0.55, side: o.side ?? THREE.FrontSide });
  m.userData.progKey = 'skin' + (o.key ?? '');
  m.userData.skin = {
    uScale: { value: o.scale ?? 14 }, uBump: { value: o.bump ?? 0.012 }, uWrinkle: { value: o.wrinkle ?? 0.6 }, uSheen: { value: o.sheen ?? 0.25 },
    uTrans: { value: o.trans ?? 0 },
  };
  return m;
}
export const SKIN_VERT = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aRest; varying vec3 vRest;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest;');
};
export const SKIN_FRAG = (shader, u) => {
  Object.assign(shader.uniforms, u);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vRest; uniform float uScale; uniform float uBump; uniform float uWrinkle; uniform float uSheen; uniform float uTrans;
      float sh3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float sn3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(sh3(i), sh3(i + vec3(1,0,0)), u.x), mix(sh3(i + vec3(0,1,0)), sh3(i + vec3(1,1,0)), u.x), u.y),
                   mix(mix(sh3(i + vec3(0,0,1)), sh3(i + vec3(1,0,1)), u.x), mix(sh3(i + vec3(0,1,1)), sh3(i + vec3(1,1,1)), u.x), u.y), u.z); }
      // pebbly scales: cellular-ish bumps from the distance to a jittered lattice point
      float scales(vec3 p){ vec3 i = floor(p), f = fract(p); float d = 1.0;
        for (int x = 0; x < 2; x++) for (int y = 0; y < 2; y++) for (int z = 0; z < 2; z++) {
          vec3 o = vec3(float(x), float(y), float(z)); vec3 c = o + vec3(sh3(i + o), sh3(i + o + 7.1), sh3(i + o + 3.3)) * 0.8 - 0.4 + 0.5;
          d = min(d, length(f - c)); }
        return 1.0 - smoothstep(0.0, 0.62, d); }
      vec3 bumpN(vec3 surf_pos, vec3 N, float hgt){
        vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
        vec3 R1 = cross(sy, N), R2 = cross(N, sx);
        float det = dot(sx, R1);
        vec3 g = sign(det) * (dFdx(hgt) * R1 + dFdy(hgt) * R2);
        return normalize(abs(det) * N - g); }`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec3 rp = vRest;
        float fw = length(fwidth(rp));
        float fs = 1.0 - smoothstep(0.25, 0.7, fw * uScale);
        float fw2 = 1.0 - smoothstep(0.25, 0.7, fw * 2.5);
        float hgt = scales(rp * uScale) * fs * 1.0 + (sn3(rp * vec3(2.5, 7.0, 2.5)) - 0.5) * uWrinkle * 4.0 * fw2 + (sn3(rp * uScale * 2.7) - 0.5) * 0.4 * fs;
        normal = bumpN(-vViewPosition, normal, hgt * uBump);
        diffuseColor.rgb *= 0.9 + 0.2 * sn3(rp * 3.1) - 0.12 * scales(rp * uScale) * fs; }`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      { // soft sheen along the silhouette (dust, wet skin) + thin-tissue light (wing membranes)
        float fr = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * fr * uSheen;
      }`);
};
