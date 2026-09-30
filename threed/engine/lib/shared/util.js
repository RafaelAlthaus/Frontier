// util.js — seeded randomness, noise, easing and small maths shared by the whole world.
// Nothing in the world reads the clock or Math.random: every frame is a pure function of t.

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const ramp = (x, a, b) => clamp((x - a) / (b - a));
export const sramp = (x, a, b) => smooth((x - a) / (b - a));
export const deg = Math.PI / 180;

// integer hash -> [0,1)
export function hash2i(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

// Perlin gradient noise, optionally periodic (period <= 256 cells per axis), seeded.
export function makeNoise(seed = 1) {
  const r = rng(seed);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const G = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
  const gd = (h, x, y) => { const g = G[h & 7]; return g[0] * x + g[1] * y; };
  function noise2(x, y, px = 256, py = 256) {
    let X = Math.floor(x), Y = Math.floor(y);
    const fx = x - X, fy = y - Y;
    const X0 = ((X % px) + px) % px & 255, Y0 = ((Y % py) + py) % py & 255;
    const X1 = ((X0 + 1) % px) & 255, Y1 = ((Y0 + 1) % py) & 255;
    const u = fade(fx), v = fade(fy);
    const aa = p[p[X0] + Y0], ab = p[p[X0] + Y1], ba = p[p[X1] + Y0], bb = p[p[X1] + Y1];
    const x1 = gd(aa, fx, fy) + u * (gd(ba, fx - 1, fy) - gd(aa, fx, fy));
    const x2 = gd(ab, fx, fy - 1) + u * (gd(bb, fx - 1, fy - 1) - gd(ab, fx, fy - 1));
    return (x1 + v * (x2 - x1)) * 1.41;
  }
  function fbm2(x, y, oct = 5, lac = 2, gain = 0.5, px = 256, py = 256) {
    let a = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * noise2(x, y, px, py); n += a;
      x *= lac; y *= lac; px *= lac; py *= lac; a *= gain;
    }
    return s / n;
  }
  function ridge2(x, y, oct = 5, px = 256, py = 256) {
    let a = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * (1 - Math.abs(noise2(x, y, px, py))); n += a;
      x *= 2; y *= 2; px *= 2; py *= 2; a *= 0.5;
    }
    return s / n;
  }
  return { noise2, fbm2, ridge2 };
}

// keyframe tables: interpolate an array of {k, ...values} rows by key
export function table(rows, k) {
  if (k <= rows[0].k) return rows[0];
  if (k >= rows[rows.length - 1].k) return rows[rows.length - 1];
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (k >= a.k && k <= b.k) {
      const f = smooth((k - a.k) / (b.k - a.k));
      const out = { k };
      for (const key in a) {
        if (key === 'k') continue;
        const va = a[key], vb = b[key];
        if (Array.isArray(va)) out[key] = va.map((v, j) => lerp(v, vb[j], f));
        else out[key] = lerp(va, vb, f);
      }
      return out;
    }
  }
  return rows[0];
}

// sRGB hex -> linear [r,g,b]
export function lin(hex, mul = 1) {
  const c = typeof hex === 'string' ? parseInt(hex.slice(1), 16) : hex;
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [f((c >> 16) & 255) * mul, f((c >> 8) & 255) * mul, f(c & 255) * mul];
}

// piecewise keyframes over time: [[t, value], ...] (value number or array), smoothstep between keys
export function keys(list, t, ease = smooth) {
  if (t <= list[0][0]) return list[0][1];
  const last = list[list.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < list.length - 1; i++) {
    const [ta, va] = list[i], [tb, vb] = list[i + 1];
    if (t >= ta && t <= tb) {
      const f = ease((t - ta) / (tb - ta));
      if (Array.isArray(va)) return va.map((v, j) => lerp(v, vb[j], f));
      return lerp(va, vb, f);
    }
  }
  return last[1];
}

// Catmull-Rom through points (arrays of 3), u in [0,1] with arc-length-ish uniform param
export function catmull(pts, u) {
  const n = pts.length - 1;
  const x = clamp(u) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const out = [];
  for (let k = 0; k < p1.length; k++) {
    const a = p0[k], b = p1[k], c = p2[k], d = p3[k];
    out.push(0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f));
  }
  return out;
}
