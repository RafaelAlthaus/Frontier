// wcam.js — camera moves for the Bastogne film. The same rules that fixed the Pharos cut (one move = one smooth speed
// curve, no knots where the speed jumps, no overshoot at the ends), plus altitude handled in log space so a camera can
// fall from 30 km over the staff map to 2 m above the snow without racing at the bottom or crawling at the top.
import { catmull, clamp, lerp } from '../lib/shared/util.js';

// monotone cubic Hermite through [[x, y], ...] (Fritsch–Carlson): C1, never overshoots; 'zero' = ease in and out
export function pchip(pts, endSlopes = 'zero') {
  const n = pts.length, X = pts.map((p) => p[0]), Y = pts.map((p) => p[1]);
  const d = []; for (let i = 0; i < n - 1; i++) d.push((Y[i + 1] - Y[i]) / (X[i + 1] - X[i]));
  const m = new Array(n);
  m[0] = endSlopes === 'zero' ? 0 : d[0]; m[n - 1] = endSlopes === 'zero' ? 0 : d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * (X[i + 1] - X[i]) + (X[i] - X[i - 1]), w2 = (X[i + 1] - X[i]) + 2 * (X[i] - X[i - 1]);
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return (x) => {
    if (x <= X[0]) return Y[0];
    if (x >= X[n - 1]) return Y[n - 1];
    let i = 0; while (i < n - 2 && x > X[i + 1]) i++;
    const h = X[i + 1] - X[i], s = (x - X[i]) / h;
    return (2 * s ** 3 - 3 * s * s + 1) * Y[i] + (s ** 3 - 2 * s * s + s) * h * m[i] + (-2 * s ** 3 + 3 * s * s) * Y[i + 1] + (s ** 3 - s * s) * h * m[i + 1];
  };
}

const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

// glide(keys, times, o): one continuous move through keys {pos, look, up?, fov?}; the path is re-parametrised by
// metres travelled + lambda x radians turned (+ logAlt x |d ln(height above ground)| for big altitude changes), and
// `times` [[t, keyIndex], ...] pins when the camera passes given keys. Directions and ups are low-passed along the path.
export function glide(keys, times, o = {}) {
  const lam = o.lambda ?? 0.18, N = 240 * (keys.length - 1), ground = o.ground ?? 0, la = o.logAlt ?? 0;
  const P = keys.map((k) => k.pos), L = keys.map((k) => k.look), UPS = keys.map((k) => k.up ?? [0, 1, 0]);
  const F = keys.map((k) => [Array.isArray(k.fov) ? k.fov[0] : (k.fov ?? 40)]);
  // positions: optionally interpolate altitude in log space (so a 10 000x change in height reads as an even fall)
  const alt = (p) => Math.log(Math.max(0.5, p[1] - ground));
  const PL = la ? P.map((p) => [p[0], alt(p), p[2]]) : P;
  const posAt = (u) => { const q = catmull(PL, u); return la ? [q[0], ground + Math.exp(q[1]), q[2]] : q; };
  const S = []; let acc = 0, prev = null;
  for (let i = 0; i <= N; i++) {
    const u = i / N, pos = posAt(u), look = catmull(L, u), d = norm([look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]]);
    if (prev) {
      const dp = Math.hypot(pos[0] - prev.pos[0], pos[1] - prev.pos[1], pos[2] - prev.pos[2]);
      const h = Math.max(1, Math.min(pos[1], prev.pos[1]) - ground);
      acc += (la ? dp / h * la : dp) + lam * Math.acos(clamp(d[0] * prev.d[0] + d[1] * prev.d[1] + d[2] * prev.d[2], -1, 1));
    }
    prev = { u, s: acc, pos, d }; S.push(prev);
  }
  const sig = o.smooth ?? N * 0.07, R = Math.ceil(sig * 3);
  const ups = S.map((q) => norm(catmull(UPS, q.u)));
  const lp = (arr, i) => { const a = [0, 0, 0]; let w = 0;
    for (let k = -R; k <= R; k++) { const j = Math.min(N, Math.max(0, i + k)); const g = Math.exp(-(k * k) / (2 * sig * sig)); a[0] += arr[j][0] * g; a[1] += arr[j][1] * g; a[2] += arr[j][2] * g; w += g; }
    return norm(a); };
  const D = S.map((q) => q.d);
  for (let i = 0; i <= N; i++) {
    const e = clamp(Math.min(i, N - i) / (R || 1)), k = e * e * (3 - 2 * e);
    const ds = lp(D, i), us = lp(ups, i);
    S[i].ds = norm(D[i].map((v, c) => v + (ds[c] - v) * k));
    S[i].us = norm(ups[i].map((v, c) => v + (us[c] - v) * k));
  }
  const sAtKey = (k) => S[Math.round(k / (keys.length - 1) * N)].s;
  const tm = pchip(times.map(([t, k]) => [t, sAtKey(k)]), o.ends ?? 'zero');
  return (t) => {
    const s = tm(t);
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const mi = (lo + hi) >> 1; if (S[mi].s < s) lo = mi; else hi = mi; }
    const a = S[lo], b = S[hi], f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0, u = a.u + (b.u - a.u) * f;
    const pos = posAt(u), lk = catmull(L, u), dist = Math.max(1, Math.hypot(lk[0] - pos[0], lk[1] - pos[1], lk[2] - pos[2]));
    const d = norm(a.ds.map((v, c) => v + (b.ds[c] - v) * f)), up = norm(a.us.map((v, c) => v + (b.us[c] - v) * f));
    return { pos, look: [pos[0] + d[0] * dist, pos[1] + d[1] * dist, pos[2] + d[2] * dist], up, fov: catmull(F, u)[0], near: o.near ?? 0.05, far: o.far };
  };
}

// a locked-off or slowly drifting camera: pos/look lerped with an eased time over [0, dur]
export function drift(a, b, dur, o = {}) {
  const e = pchip([[0, 0], [dur, 1]], o.ends ?? 'zero');
  return (t) => {
    const f = e(t);
    return { pos: a.pos.map((v, i) => lerp(v, b.pos[i], f)), look: a.look.map((v, i) => lerp(v, b.look[i], f)), fov: lerp(a.fov ?? 35, b.fov ?? a.fov ?? 35, f), near: o.near ?? 0.05, up: a.up };
  };
}

// small handheld life on a locked camera: two slow sines per axis (a camera operator breathing), deterministic
export function handheld(c, t, amt = 1) {
  const s = (f, p) => Math.sin(t * f + p);
  const k = 0.0025 * amt;
  const d = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]], L = Math.hypot(...d);
  return Object.assign({}, c, {
    look: [c.look[0] + L * k * (s(0.9, 0.3) + 0.5 * s(2.3, 1.1)), c.look[1] + L * k * 0.7 * (s(1.1, 2.0) + 0.5 * s(2.9, 0.4)), c.look[2] + L * k * (s(0.7, 4.1) + 0.5 * s(1.9, 2.2))],
    roll: (c.roll ?? 0) + 0.004 * amt * s(0.8, 0.9),
  });
}
