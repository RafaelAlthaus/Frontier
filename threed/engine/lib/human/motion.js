// motion.js — smooth vehicle and vessel kinematics (E2, Frontier 3D v2).
// Robin's Titanic test: a polyline `path` snapped the liner's heading at every corner (a 269 m ship pivoting on the spot).
// Here a path [[x, z], ...] gets its corners filleted with arcs of the vehicle's turning radius, is padded with straight
// lines at both ends, resampled evenly and low-passed along its arc length until its curvature fits the vehicle's turning radius
// (so the heading can never turn faster than speed / radius), then walked at an eased speed along the arc length.
// Everything is a pure function of t. Used by vehicles.js for every ship, boat, car, tank, truck and aircraft kind.
import { clamp, lerp } from '../shared/util.js';

const TAU = Math.PI * 2;
const wrapPi = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// corners replaced by circular arcs (fillets) of radius R (smaller where the legs are short): the path never swings
// wide of a corner (a Catmull-Rom through the corner points would bulge outward before it), `step` m between samples
function fillet(P, R, step) {
  const out = [P[0].slice()];
  for (let i = 1; i < P.length - 1; i++) {
    const A = out[out.length - 1], B = P[i], C = P[i + 1];
    const l1 = Math.hypot(B[0] - A[0], B[1] - A[1]), l2 = Math.hypot(C[0] - B[0], C[1] - B[1]);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const u1 = [(B[0] - A[0]) / l1, (B[1] - A[1]) / l1], u2 = [(C[0] - B[0]) / l2, (C[1] - B[1]) / l2];
    const cr = u1[0] * u2[1] - u1[1] * u2[0], phi = Math.acos(clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1));
    if (phi < 1e-3) { out.push(B.slice()); continue; }
    const tn = Math.min(R * Math.tan(phi / 2), l1 * 0.5, l2 * 0.5), r = tn / Math.tan(phi / 2), sg = cr >= 0 ? 1 : -1;
    const T1 = [B[0] - u1[0] * tn, B[1] - u1[1] * tn], nv = [-u1[1] * sg, u1[0] * sg], c = [T1[0] + nv[0] * r, T1[1] + nv[1] * r];
    const a0 = Math.atan2(T1[1] - c[1], T1[0] - c[0]), m = Math.max(2, Math.ceil(r * phi / step));
    for (let k = 0; k <= m; k++) { const a = a0 + sg * phi * k / m; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  }
  out.push(P[P.length - 1].slice());
  return out;
}
// even resampling of a polyline, `ds` m apart
function resample(D, ds) {
  const acc = [0];
  for (let i = 1; i < D.length; i++) acc.push(acc[i - 1] + Math.hypot(D[i][0] - D[i - 1][0], D[i][1] - D[i - 1][1]));
  const tot = acc[acc.length - 1], n = Math.max(2, Math.round(tot / ds) + 1), out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = tot * k / (n - 1);
    while (j < D.length - 2 && acc[j + 1] < s) j++;
    const u = (s - acc[j]) / Math.max(1e-9, acc[j + 1] - acc[j]);
    out.push([lerp(D[j][0], D[j + 1][0], u), lerp(D[j][1], D[j + 1][1], u)]);
  }
  return { pts: out, ds: tot / (n - 1) };
}
function gaussSmooth(P, sig) {
  if (sig < 0.5) return P.map((p) => p.slice());
  const R = Math.ceil(sig * 3), w = []; let ws = 0;
  for (let k = -R; k <= R; k++) { const g = Math.exp(-(k * k) / (2 * sig * sig)); w.push(g); ws += g; }
  const n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    let x = 0, z = 0;
    for (let k = -R; k <= R; k++) {
      let j = i + k;
      // beyond the ends: reflect through the end point (keeps the end straight lines straight)
      if (j < 0) { const q = P[Math.min(n - 1, -j)]; x += (2 * P[0][0] - q[0]) * w[k + R]; z += (2 * P[0][1] - q[1]) * w[k + R]; continue; }
      if (j >= n) { const q = P[Math.max(0, 2 * (n - 1) - j)]; x += (2 * P[n - 1][0] - q[0]) * w[k + R]; z += (2 * P[n - 1][1] - q[1]) * w[k + R]; continue; }
      x += P[j][0] * w[k + R]; z += P[j][1] * w[k + R];
    }
    out.push([x / ws, z / ws]);
  }
  return out;
}

// smoothTrack(pts, {rmin, pad, sigma0, sigmaMax}) -> { length, s0, at(s), dir(s), yaw(s), kappa(s), heel(s, lag),
//   sigma, kmax, fits } where s is metres from the path's first point (negative before it, beyond `length` past the
//   end: the pad continues straight). yaw = atan2(dx, dz) (rotation.y of a +Z model); kappa = d(yaw)/ds, > 0 is a turn
//   to port (the model's +X side, heading decreasing).
export function smoothTrack(pts, o = {}) {
  let P = [];
  for (const p of pts) { const q = [+p[0] || 0, +p[1] || 0]; if (!P.length || Math.hypot(q[0] - P[P.length - 1][0], q[1] - P[P.length - 1][1]) > 1e-3) P.push(q); }
  if (P.length < 2) P = [P[0] || [0, 0], [(P[0] || [0, 0])[0], (P[0] || [0, 0])[1] - 1]];
  const rmin = Math.max(0.5, o.rmin ?? 5);
  let segMin = Infinity, raw = 0;
  for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); segMin = Math.min(segMin, l); raw += l; }
  const sigmaMax = o.sigmaMax ?? Math.max(rmin * 0.9, 4);
  const pad = o.pad ?? Math.max(3.5 * sigmaMax + 20, 60);
  const step = clamp(Math.min(rmin, raw) / 40, 0.2, 2.0);
  const dense = fillet(P, rmin, step);
  const d0 = norm2([dense[1][0] - dense[0][0], dense[1][1] - dense[0][1]]), dn = norm2([dense[dense.length - 1][0] - dense[dense.length - 2][0], dense[dense.length - 1][1] - dense[dense.length - 2][1]]);
  const padded = [[dense[0][0] - d0[0] * pad, dense[0][1] - d0[1] * pad], ...dense, [dense[dense.length - 1][0] + dn[0] * pad, dense[dense.length - 1][1] + dn[1] * pad]];
  const { pts: E, ds } = resample(padded, step);
  const i0 = Math.round(pad / ds);                                    // the original first point's sample
  let sig = Math.max(0, o.sigma0 ?? Math.min(rmin * 0.25, 4)), S = null, K = null, kmax = 0;
  for (let it = 0; it < 12; it++) {
    S = gaussSmooth(E, sig / ds);
    K = curvature(S, ds);
    kmax = 0; for (let i = 2; i < K.length - 2; i++) kmax = Math.max(kmax, Math.abs(K[i]));
    if (kmax <= 1 / rmin * 1.02 || sig >= sigmaMax) break;
    sig = Math.min(sigmaMax, Math.max(sig * 1.5, sig + 2, (kmax * rmin) * sig));
  }
  // arc length of the smoothed curve, headings (unwrapped), curvature
  const n = S.length, acc = new Float64Array(n), yawA = new Float64Array(n);
  for (let i = 1; i < n; i++) acc[i] = acc[i - 1] + Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]);
  for (let i = 0; i < n; i++) {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(n - 1, i + 1)];
    let y = Math.atan2(b[0] - a[0], b[1] - a[1]);
    if (i) y = yawA[i - 1] + wrapPi(y - yawA[i - 1]);
    yawA[i] = y;
  }
  const s0 = acc[Math.min(n - 1, i0)], sEnd = acc[Math.min(n - 1, n - 1 - Math.round(pad / ds))];
  const idx = (s) => { const x = clamp(s + s0, 0, acc[n - 1]); let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] <= x) lo = m; else hi = m; } return [lo, hi, (x - acc[lo]) / Math.max(1e-9, acc[hi] - acc[lo]), x]; };
  const beyond = (s) => { const x = s + s0; return x < 0 ? x : x > acc[n - 1] ? x - acc[n - 1] : 0; };
  function at(s) {
    const [lo, hi, u] = idx(s), b = beyond(s);
    let x = lerp(S[lo][0], S[hi][0], u), z = lerp(S[lo][1], S[hi][1], u);
    if (b) { const d = dir(s); x += d[0] * b; z += d[1] * b; }
    return [x, z];
  }
  function yaw(s) { const [lo, hi, u] = idx(s); return lerp(yawA[lo], yawA[hi], u); }
  function dir(s) { const y = yaw(s); return [Math.sin(y), Math.cos(y)]; }
  function kappa(s) { const [lo, hi, u] = idx(s); return lerp(K[Math.min(K.length - 1, lo)], K[Math.min(K.length - 1, hi)], u); }
  // heel: the curvature low-passed over the last `lag` metres travelled (a hull rolls into its heel over seconds)
  const heelCache = new Map();
  function heel(s, lag) {
    let H = heelCache.get(lag);
    if (!H) {
      H = new Float64Array(n); const a = Math.exp(-ds / Math.max(ds, lag));
      for (let i = 1; i < n; i++) H[i] = H[i - 1] * a + K[Math.min(K.length - 1, i)] * (1 - a);
      heelCache.set(lag, H);
    }
    const [lo, hi, u] = idx(s); return lerp(H[lo], H[hi], u);
  }
  return { at, dir, yaw, kappa, heel, length: sEnd - s0, s0, sigma: sig, kmax, fits: kmax <= 1 / rmin * 1.05, rmin, pts: S, ds };
}
function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
// signed curvature per sample (turning from +z toward +x is negative yaw growth... sign follows d(yaw)/ds)
function curvature(S, ds) {
  const n = S.length, K = new Float64Array(n);
  let prev = null;
  const Y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(n - 1, i + 1)];
    let y = Math.atan2(b[0] - a[0], b[1] - a[1]);
    if (prev != null) y = prev + wrapPi(y - prev);
    Y[i] = y; prev = y;
  }
  for (let i = 1; i < n - 1; i++) K[i] = (Y[i + 1] - Y[i - 1]) / (2 * ds);
  K[0] = K[1] || 0; K[n - 1] = K[n - 2] || 0;
  return K;
}

// speed profile: cruise `v` m/s; from rest at `start` s over `ramp` s (smoothstep velocity), and with stopAt (metres)
// easing to rest exactly there over `ramp2` s. Returns distance(t) and speed(t). A vessel already under way (no start)
// is moving at t = 0.
export function speedProfile(v, o = {}) {
  const t0 = o.start ?? null, Ta = Math.max(0.01, o.ramp ?? 3), Td = Math.max(0.01, o.ramp2 ?? o.ramp ?? 3);
  const S = (u) => u * u * u - u * u * u * u / 2;                      // integral of smoothstep over [0, u]
  const accel = (t) => {                                               // distance from rest / under way
    if (t0 == null) return v * t;
    const tt = t - t0; if (tt <= 0) return 0;
    return tt < Ta ? v * Ta * S(tt / Ta) : v * (Ta / 2 + tt - Ta);
  };
  const vAcc = (t) => { if (t0 == null) return v; const tt = t - t0; if (tt <= 0) return 0; return tt < Ta ? v * smooth3(tt / Ta) : v; };
  let tStop = null;
  if (o.stopAt != null && v > 0) {
    // the decel starts when the remaining distance equals v * Td / 2 (the area under the smoothstep ramp-down)
    const need = o.stopAt - v * Td / 2;
    // find t with accel(t) = need (monotone)
    let lo = (t0 ?? 0) - 1e3, hi = (t0 ?? 0) + 1e5;
    if (accel(hi) < need) tStop = null; else {
      for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (accel(m) < need) lo = m; else hi = m; }
      tStop = hi;
    }
  }
  const dist = (t) => {
    if (tStop == null || t <= tStop) return accel(t);
    const base = accel(tStop), vs = vAcc(tStop), u = Math.min(1, (t - tStop) / Td);
    return base + vs * Td * (u - S(u));                               // integral of (1 - smoothstep)
  };
  const speed = (t) => { if (tStop == null || t <= tStop) return vAcc(t); const u = Math.min(1, (t - tStop) / Td); return vAcc(tStop) * (1 - smooth3(u)); };
  return { dist, speed, tStop };
}
function smooth3(x) { x = clamp(x); return x * x * (3 - 2 * x); }

// the turning radius a vehicle kind can hold at speed (metres). Ships: a liner needs ~1.6 lengths (Olympic-class
// tactical diameter ~3-4 lengths), small craft pivot; road vehicles by their wheelbase; aircraft by a 45 deg bank.
export function turnRadius(cls, length, speed, kind = '') {
  if (cls === 'ship') return length >= 100 ? 1.6 * length : length >= 20 ? 1.3 * length : Math.max(3, 1.2 * length);
  if (cls === 'air') return Math.max(40, speed * speed / 9.81);
  if (/tank/.test(kind)) return 4;
  return Math.max(4.5, length * 1.15);
}
