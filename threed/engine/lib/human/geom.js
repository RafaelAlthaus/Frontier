// geom.js — geometry builders that write UVs in METRES (u along the surface, v up), so one masonry texture of a
// known size reads at the right scale on every wall, cornice, drum and step without per-object tuning.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { mergeGeometries };

// a (tapered) regular prism. apothem a0 at y0, a1 at y1; sides N; faces aligned to the axes for N = 4 / 8.
// opts: {top: true, bottom: false, rot: extra rotation, uOff}
export function prism(N, a0, a1, y0, y1, opts = {}) {
  const pos = [], uv = [], idx = [];
  const rot = (opts.rot ?? 0) + Math.PI / N;             // a face (not a corner) looks along +X / +Z
  const R0 = a0 / Math.cos(Math.PI / N), R1 = a1 / Math.cos(Math.PI / N);
  const side0 = 2 * a0 * Math.tan(Math.PI / N);
  const uOff = opts.uOff ?? 0;
  for (let i = 0; i < N; i++) {
    const t0 = rot + i / N * Math.PI * 2, t1 = rot + (i + 1) / N * Math.PI * 2;
    const p = [
      [Math.cos(t0) * R0, y0, Math.sin(t0) * R0], [Math.cos(t1) * R0, y0, Math.sin(t1) * R0],
      [Math.cos(t1) * R1, y1, Math.sin(t1) * R1], [Math.cos(t0) * R1, y1, Math.sin(t0) * R1],
    ];
    const b = pos.length / 3;
    // wind so the outside faces front (counter-clockwise seen from outside)
    for (const q of p) pos.push(...q);
    const u0 = uOff + i * side0, u1 = u0 + side0;
    uv.push(u1, y0, u0, y0, u0, y1, u1, y1);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  if (opts.top !== false) {
    const b = pos.length / 3;
    pos.push(0, y1, 0); uv.push(0, 0);
    for (let i = 0; i <= N; i++) { const t = rot + i / N * Math.PI * 2; pos.push(Math.cos(t) * R1, y1, Math.sin(t) * R1); uv.push(Math.cos(t) * R1, Math.sin(t) * R1); }
    for (let i = 0; i < N; i++) idx.push(b, b + 2 + i, b + 1 + i);
  }
  if (opts.bottom) {
    const b = pos.length / 3;
    pos.push(0, y0, 0); uv.push(0, 0);
    for (let i = 0; i <= N; i++) { const t = rot + i / N * Math.PI * 2; pos.push(Math.cos(t) * R0, y0, Math.sin(t) * R0); uv.push(Math.cos(t) * R0, Math.sin(t) * R0); }
    for (let i = 0; i < N; i++) idx.push(b, b + 1 + i, b + 2 + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed ? fixNormals(g) : g;
}
// flat shading for prisms (vertex normals would round the arrises)
function fixNormals(g) { const n = g.toNonIndexed(); n.computeVertexNormals(); return n; }

// a cylinder / cone frustum with UVs in metres
export function drum(r0, r1, y0, y1, seg = 48, opts = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, opts.hseg ?? 1, opts.open ?? false);
  g.translate(0, (y0 + y1) / 2, 0);
  const uv = g.attributes.uv, p = g.attributes.position;
  const circ = Math.PI * 2 * Math.max(r0, r1);
  for (let i = 0; i < uv.count; i++) {
    const y = p.getY(i);
    if (Math.abs(g.attributes.normal.getY(i)) > 0.99) uv.setXY(i, p.getX(i), p.getZ(i));
    else uv.setXY(i, uv.getX(i) * circ, y);
  }
  return g;
}

// a box with UVs in metres on every face
export function boxM(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] + x * 0.37, uv.getY(i) * dims[f][1] + y);
  }
  g.translate(x, y, z);
  return g;
}

// stacked mouldings around a prism: profile = [[apothemOffset, height], ...] from the bottom up
export function cornice(N, a, y, profile, opts = {}) {
  const parts = [];
  let yy = y;
  for (const [off, h] of profile) { parts.push(prism(N, a + off, a + off, yy, yy + h, { top: true, bottom: true, rot: opts.rot })); yy += h; }
  return { geo: mergeGeometries(parts), top: yy };
}

// merlons along a square or polygon parapet: returns an array of matrices for an instanced box
export function merlonsOnPolygon(N, a, y, count, w, h, d, rot = 0) {
  const out = [];
  const R = a / Math.cos(Math.PI / N);
  const r0 = rot + Math.PI / N;
  for (let i = 0; i < N; i++) {
    const t0 = r0 + i / N * Math.PI * 2, t1 = r0 + (i + 1) / N * Math.PI * 2;
    const A = new THREE.Vector3(Math.cos(t0) * R, y, Math.sin(t0) * R), B = new THREE.Vector3(Math.cos(t1) * R, y, Math.sin(t1) * R);
    const dir = B.clone().sub(A); const len = dir.length(); dir.normalize();
    const ang = Math.atan2(-dir.z, dir.x);
    for (let k = 0; k < count; k++) {
      const f = (k + 0.5) / count;
      const p = A.clone().lerp(B, f);
      // pull slightly inside the face line
      const n = new THREE.Vector3(dir.z, 0, -dir.x);
      p.addScaledVector(n, -d * 0.5);
      out.push(new THREE.Matrix4().compose(p.setY(y + h / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(w, h, d)));
    }
  }
  return out;
}

// an arcade in profile (x along the run, y up), extruded by `width` along z. arches: [{x0, x1, spring, rise}]
export function arcade(len, h0, h1, thick, width, piers, archRise) {
  const s = new THREE.Shape();
  // deck top from (0,h0) to (len,h1); underside with arches between piers
  s.moveTo(0, 0);
  s.lineTo(0, h0);
  s.lineTo(len, h1);
  s.lineTo(len, 0);
  const n = piers.length;
  for (let i = n - 1; i >= 0; i--) {
    const [px0, px1] = piers[i];      // pier from px0 to px1 (x), arch to the left of it
    s.lineTo(px1, 0);
    s.lineTo(px0, 0);
    if (i > 0) {
      const prev = piers[i - 1][1];
      const mid = (prev + px0) / 2, r = (px0 - prev) / 2;
      const deckAt = (x) => h0 + (h1 - h0) * x / len - thick;
      const spring = Math.max(0.5, deckAt(mid) - r - 0.4);
      s.lineTo(px0, spring);
      s.absarc(mid, spring, r, 0, Math.PI, false);
      s.lineTo(prev, 0);
    }
  }
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -width / 2);
  // extrude UVs: shape x,y in metres on the sides; depth faces get (x, z)
  return g;
}
