// markers.js — map-style markers laid on the real terrain: a glowing route line (the mustard #D9A93F highlight) that
// draws itself along a path, a route ending in an arrowhead, and a pin that drops in and glows. Conformed to the ground
// (sampled every metre), slightly lifted and polygon-offset so it never z-fights; eased in over `t`.
//   marker.route  { path: [[x, z]...], width (3), color, t: [draw start, draw end], glow }
//   marker.arrow  same + an arrowhead at the end
//   marker.pin    { at, color, height (12), t: [drop time, out] }
import * as THREE from 'three';
import { patchMaterial } from '../shared/env.js';
import { clamp, smoother } from '../shared/util.js';
import { ground, xz, patchAll } from './common.js';

const MUSTARD = 0xD9A93F;
function lineMaterial(color, glow, prog) {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: glow, roughness: 0.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  m.userData.progKey = 'f3dRoute';
  return patchMaterial(m, (sh) => {
    sh.uniforms.uProg = prog;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aRoute; varying vec2 vRoute;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoute = aRoute;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRoute; uniform float uProg;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        { float edge = 1.0 - smoothstep(0.55, 1.0, abs(vRoute.y));
          float head = smoothstep(uProg, uProg - 0.004, vRoute.x);
          gl_FragColor.a *= edge * head; }`);
  });
}
function ribbon(ctx, pts, width, lift = 0.25) {
  const G = ground(ctx), rows = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 1.0));
    for (let k = i ? 1 : 0; k <= n; k++) rows.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  const S = [0]; for (let i = 1; i < rows.length; i++) S.push(S[i - 1] + Math.hypot(rows[i][0] - rows[i - 1][0], rows[i][1] - rows[i - 1][1])); total = S[S.length - 1] || 1;
  const pos = [], rt = [], idx = [];
  rows.forEach(([x, z], i) => {
    const a = rows[Math.max(0, i - 1)], b = rows[Math.min(rows.length - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    for (let j = 0; j <= 2; j++) { const u = (j - 1) * width / 2, px = x - dz * u, pz = z + dx * u; pos.push(px, G.h(px, pz) + lift, pz); rt.push(S[i] / total, j - 1); }
  });
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 1, c = a + 3, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aRoute', new THREE.Float32BufferAttribute(rt, 2)); g.setIndex(idx); g.computeVertexNormals();
  return { g, total, end: rows[rows.length - 1], dir: (() => { const a = rows[Math.max(0, rows.length - 3)], b = rows[rows.length - 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; })() };
}
export const CATALOG = {
  'marker.route': { desc: 'glowing route line on the terrain (mustard highlight) that draws itself along a path', params: { path: '[[x, z]...]', width: 'm (3)', color: 'hex', t: '[start, end] s of the draw', glow: 'emissive (2.5)' }, footprint: [10, 10], height: 0.3, tags: ['marker', 'map'] },
  'marker.arrow': { desc: 'route line ending in a big arrowhead (campaign / advance arrow)', params: { path: '[[x, z]...]', width: 'm (6)', color: 'hex', t: '[start, end]' }, footprint: [10, 10], height: 0.3, tags: ['marker', 'map'] },
  'marker.pin': { desc: 'map pin standing on the ground: drops in, glows, gentle bob', params: { at: '[x, z]', height: 'm (12)', color: 'hex', t: '[drop, out]' }, footprint: [4, 4], height: 12, tags: ['marker', 'map'] },
};
export async function build(kind, item = {}, ctx = {}) {
  const G = ground(ctx), color = item.color != null ? new THREE.Color(item.color).getHex() : MUSTARD;
  const root = new THREE.Group(); root.name = kind;
  const t0 = item.t?.[0] ?? 0.5, t1 = item.t?.[1] ?? t0 + 3;
  if (kind === 'marker.pin') {
    const at = xz(item.at), H = item.height ?? 12, y0 = G.h(at[0], at[1]);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.35, metalness: 0.2 });
    const pin = new THREE.Group(); root.add(pin);
    const head = new THREE.Mesh(new THREE.SphereGeometry(H * 0.2, 32, 20), mat); head.position.y = H * 0.8; pin.add(head);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(H * 0.12, H * 0.62, 24).rotateX(Math.PI), mat); cone.position.y = H * 0.36; pin.add(cone);
    const ringM = lineMaterial(color, 2.5, { value: 1 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(H * 0.15, H * 0.3, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    ring.position.set(at[0], y0 + 0.2, at[1]); root.add(ring);
    pin.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const update = (t = 0) => {
      const k = smoother((t - t0) / 0.9), out = item.t?.[1] != null ? smoother((t - item.t[1]) / 0.8) : 0;
      pin.position.set(at[0], y0 + (1 - k) * H * 2.5 + 0.15 * Math.sin(t * 1.6) * k, at[1]); pin.visible = k * (1 - out) > 0.01; pin.scale.setScalar(Math.max(0.001, 1 - out));
      ring.visible = pin.visible; ring.scale.setScalar(0.6 + 0.4 * k + 0.1 * Math.sin(t * 2)); ring.material.opacity = 0.6 * k * (1 - out);
    };
    update(0); patchAll(root, ctx);
    return { root, radius: H * 0.4, height: H, update, anchors: { head } };
  }
  const pts = (item.path || [[-20, 0], [20, 0]]).map((p) => xz(p));
  const width = item.width ?? (kind === 'marker.arrow' ? 6 : 3);
  const prog = { value: 0 };
  const rb = ribbon(ctx, pts, width);
  const line = new THREE.Mesh(rb.g, lineMaterial(color, item.glow ?? 2.5, prog)); line.renderOrder = 3; line.frustumCulled = false; root.add(line);
  let head = null;
  if (kind === 'marker.arrow') {
    const s = new THREE.Shape(); s.moveTo(-width * 1.2, 0); s.lineTo(0, width * 2.2); s.lineTo(width * 1.2, 0); s.lineTo(-width * 1.2, 0);
    const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2);
    // conform the head to the ground
    const P = g.attributes.position, yaw = Math.atan2(rb.dir[0], rb.dir[1]), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const rt = [];
    for (let i = 0; i < P.count; i++) { const u = P.getX(i), v = -P.getZ(i), wx = rb.end[0] + u * cy + v * sy, wz = rb.end[1] - u * sy + v * cy; P.setXYZ(i, wx, G.h(wx, wz) + 0.3, wz); rt.push(1, 0); }
    g.setAttribute('aRoute', new THREE.Float32BufferAttribute(rt, 2)); g.computeVertexNormals();
    const hm = lineMaterial(color, item.glow ?? 2.5, { value: 0 }); head = new THREE.Mesh(g, hm); head.renderOrder = 3; head.frustumCulled = false; root.add(head);
  }
  const update = (t = 0) => {
    prog.value = smoother((t - t0) / Math.max(0.1, t1 - t0)) * 1.004;
    if (head) head.material.opacity = smoother((t - t1 + 0.2) / 0.4);
  };
  update(0); patchAll(root, ctx);
  let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; }
  return { root, radius: Math.max(...pts.map((p) => Math.hypot(p[0] - cx / pts.length, p[1] - cz / pts.length))) + width, height: 0.5, update, anchors: {} };
}
