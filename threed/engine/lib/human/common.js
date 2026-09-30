// common.js — small helpers shared by the human library: ground access, placement, headings, contact shadows,
// material patching through ctx.patch, seeded randomness.
import * as THREE from 'three';
import { patchMaterial } from '../shared/env.js';
import { rng as makeRng, clamp, smooth } from '../shared/util.js';

export const DEG = Math.PI / 180;

// ground: ctx.ground.height(x, z) / normal(x, z) (engine); flat 0 without it
export function ground(ctx) {
  const g = ctx?.ground;
  const h = g?.height ? (x, z) => { const v = g.height(x, z); return Number.isFinite(v) ? v : 0; } : () => 0;
  const n = g?.normal ? (x, z) => { const v = g.normal(x, z); return v?.isVector3 ? v : Array.isArray(v) ? new THREE.Vector3(...v) : new THREE.Vector3(0, 1, 0); } : () => new THREE.Vector3(0, 1, 0);
  return { h, n, water: (x, z) => (ctx?.water?.level ?? -Infinity) };
}
// "stage" | [x, z] | [x, y, z] | {x, z} -> [x, z]
export function xz(at, fallback = [0, 0]) {
  if (at == null || at === 'stage') return fallback.slice();
  if (Array.isArray(at)) return at.length >= 3 ? [+at[0] || 0, +at[2] || 0] : [+at[0] || 0, +at[1] || 0];
  if (typeof at === 'object') return [+at.x || 0, +at.z || 0];
  return fallback.slice();
}
// compass heading in degrees (0 = north = -Z, 90 = east = +X) -> rotation.y for a model authored facing +Z
export const yawFromHeading = (hdg) => Math.PI - (hdg ?? 180) * DEG;
// yaw that makes a +Z-facing model look from (x, z) toward (tx, tz)
export const yawToward = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
export const headingToward = (x, z, tx, tz) => ((Math.atan2(tx - x, -(tz - z)) / DEG) + 360) % 360;

export function rngFor(ctx, seed) { return ctx?.rng ? ctx.rng(seed) : makeRng(seed); }

// every material under root goes through the engine's patch (fog + grade); falls back to the shared height fog
export function patchAll(root, ctx) {
  const seen = new Set();
  root.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (!m || seen.has(m) || m.isShaderMaterial) continue; seen.add(m);
      if (ctx?.patch) { try { ctx.patch(m); } catch (e) { patchMaterial(m); } } else patchMaterial(m);
    }
  });
  return root;
}
export function shadowsOn(root, cast = true, receive = true) { root.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } }); return root; }

// ── contact shadow: a soft dark ellipse conformed to the terrain (static or following a moving thing) ─────────────
let BLOB = null;
function blobTex() {
  if (BLOB) return BLOB;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.35, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  BLOB = new THREE.CanvasTexture(c); BLOB.colorSpace = THREE.SRGBColorSpace; return BLOB;
}
export function blobMaterial(opacity = 0.55) {
  return new THREE.MeshBasicMaterial({ map: blobTex(), color: 0x000000, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}
export function contactShadow(ctx, rx, rz, opacity = 0.55, n = 6) {
  const G = ground(ctx);
  const geo = new THREE.PlaneGeometry(2, 2, n, n); geo.rotateX(-Math.PI / 2);
  const base = Float32Array.from(geo.attributes.position.array);
  const mesh = new THREE.Mesh(geo, blobMaterial(opacity)); mesh.name = 'contactShadow'; mesh.renderOrder = 2; mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  const P = geo.attributes.position, c = Math.cos, s = Math.sin;
  // place(x, z, yaw): the mesh lives in world space (add it to the scene root, not to a moving parent)
  mesh.userData.place = (x, z, yaw = 0, k = 1) => {
    const cy = c(yaw), sy = s(yaw);
    for (let i = 0; i < P.count; i++) {
      const u = base[i * 3] * rx * k, v = base[i * 3 + 2] * rz * k;
      const wx = x + u * cy + v * sy, wz = z - u * sy + v * cy;
      P.setXYZ(i, wx, G.h(wx, wz) + 0.025, wz);
    }
    P.needsUpdate = true; geo.computeBoundingSphere();
  };
  return mesh;
}

// corners of a polyline replaced by circular arcs of radius `R` (smaller where the legs are short), `step` rad per
// arc segment: walkers and columns turn along a curve instead of pivoting on the spot (facing = travel at corners)
export function roundCorners(P, R, step = Math.PI / 16) {
  if (!(R > 0) || P.length < 3) return P;
  const out = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const A = out[out.length - 1], B = P[i], C = P[i + 1];
    const l1 = Math.hypot(B[0] - A[0], B[1] - A[1]), l2 = Math.hypot(C[0] - B[0], C[1] - B[1]);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const u1 = [(B[0] - A[0]) / l1, (B[1] - A[1]) / l1], u2 = [(C[0] - B[0]) / l2, (C[1] - B[1]) / l2];
    const cr = u1[0] * u2[1] - u1[1] * u2[0], phi = Math.acos(clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1));
    if (phi < 0.02) { out.push(B); continue; }
    const tan = Math.min(R * Math.tan(phi / 2), l1 * 0.5, l2 * 0.5), r = tan / Math.tan(phi / 2), sg = cr >= 0 ? 1 : -1;
    const T1 = [B[0] - u1[0] * tan, B[1] - u1[1] * tan], n = [-u1[1] * sg, u1[0] * sg], c = [T1[0] + n[0] * r, T1[1] + n[1] * r];
    const a0 = Math.atan2(T1[1] - c[1], T1[0] - c[0]), m = Math.max(2, Math.ceil(phi / step));
    for (let k = 0; k <= m; k++) { const a = a0 + sg * phi * k / m; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  }
  out.push(P[P.length - 1]);
  return out;
}
// a polyline path in xz: arc length, point + tangent at s. o.round: corner radius (roundCorners), o.w: the tangent's
// smoothing half-window in metres (default 0.9; a rounded path needs less)
export function polyPath(pts, o = {}) {
  const P = roundCorners(pts.map((p) => xz(p)), o.round || 0), L = [0];
  const W = o.w ?? 0.9;
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = L[L.length - 1];
  function at(s) {
    s = clamp(s, 0, total);
    let i = 1; while (i < P.length - 1 && L[i] < s) i++;
    const f = (s - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
    return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * f, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * f];
  }
  // smoothed tangent: average direction over ±w metres (no snapping at corners)
  function dir(s, w = W) {
    const a = at(s - w), b = at(s + w); let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz); if (l < 1e-6) { const q = P[Math.min(1, P.length - 1)], p = P[0]; dx = q[0] - p[0]; dz = q[1] - p[1]; const l2 = Math.hypot(dx, dz) || 1; return [dx / l2, dz / l2]; }
    return [dx / l, dz / l];
  }
  return { at, dir, length: total, pts: P };
}
export { smooth, clamp };
