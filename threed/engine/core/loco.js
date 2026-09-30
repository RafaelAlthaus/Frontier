// loco.js — the locomotion probe (QUALITY.md H1): for every moving figure, group instance, creature and horse, the angle
// between where it faces and where it travels, and the gait-vs-ground ratio of its planted foot.
//
// Builders opt in with res.loco = { walkers(t) -> [walker...], kind? } (lib/human cast.js + crowd.js, lib/nature
// creatures.js). A walker is { x, z, yaw, feet?, phase?, stride?, flip? }:
//   yaw     rotation.y of a +Z-authored model (it faces (sin yaw, cos yaw))
//   feet    [[[x, y, z], ...], ...] contact points per foot in world space (heel/ball, hooves): the lowest one is the
//           planted foot; its own world velocity is the slide (a planted foot does not move). y0: the height the rig
//           plants the feet on (a cast figure's root); without it, the terrain under each point
//   phase   gait cycles travelled (continuous) + stride (m per cycle, measured from the pose): gait speed = dphase/dt ×
//           stride (flipbook crowds, whose baked feet are not bones any more)
//   flip    the flipbook step in metres (stride / frames per cycle): the planted foot's saw-tooth, reported
// The velocity is a central difference (±1/60 s) of the positions. A walker is checked while its speed is over
// 0.3 m/s: angle > 35° = sideways, > 90° = backwards. Gait/ground is measured on the planted foot (a contact point
// within 2 cm of the ground) and judged per walker: sliding = its median outside 0.8–1.25, or more than 20 % of its
// contact samples outside (a heel landing for one sample is not a slide); slide_ratio_min/max are the walkers' p5/p95.
// Output (render.py report.json qa.locomotion): {ok, checked, walkers, samples, max_angle_deg, backwards, sideways,
// slide_ratio_min, slide_ratio_max, flip_step_max_m, flagged: [...], items: [...]}

export const LOCO_LIMITS = { speed: 0.3, angle: 35, back: 90, ratio: [0.8, 1.25], share: 0.2, contact: 0.02, dt: 0.1, h: 1 / 60 };
const DEG = 180 / Math.PI;

function angleBetween(yaw, vx, vz) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), v = Math.hypot(vx, vz) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (fx * vx + fz * vz) / v))) * DEG;
}
const r3 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);

// S: the built scene (registry buildScene), dur: the scene length, ground(x, z): terrain height (no water)
export function locomotionQA(S, dur, ground, o = {}) {
  const L = { ...LOCO_LIMITS, ...(o.limits || {}) };
  const out = { ok: true, checked: 0, walkers: 0, samples: 0, max_angle_deg: 0, backwards: 0, sideways: 0, slide_ratio_min: null, slide_ratio_max: null, flip_step_max_m: 0, flagged: [], items: [] };
  const h = L.h;
  const times = []; for (let t = Math.min(0.05, dur / 2); t <= dur - 0.02; t += L.dt) times.push(+t.toFixed(4));
  for (const it of S.items) {
    const lo = it.res && it.res.loco;
    if (!lo || typeof lo.walkers !== 'function') continue;
    const who = `${it.section}:${it.index} ${it.kind}`;
    const rec = { who, walkers: 0, moving: 0, max_angle_deg: 0, backwards: 0, sideways: 0, ratio: [null, null], raw: [null, null], flip_step_m: 0, samples: 0 };
    const worst = new Map();                                   // walker index -> worst sample
    let n = 0;
    const note = (i, s) => { const w = worst.get(i); if (!w || s.bad > w.bad) worst.set(i, s); };
    const moved = new Set(), back = new Set(), side = new Set(), ratios = new Map();
    for (const t of times) {
      let A, B, C;
      try { A = lo.walkers(t - h); C = lo.walkers(t); B = lo.walkers(t + h); } catch (e) { rec.error = String(e).slice(0, 200); break; }
      if (!A || !B || !C) continue;
      n = Math.max(n, C.length);
      for (let i = 0; i < C.length; i++) {
        const a = A[i], b = B[i], c = C[i];
        if (!a || !b || !c) continue;
        const vx = (b.x - a.x) / (2 * h), vz = (b.z - a.z) / (2 * h), sp = Math.hypot(vx, vz);
        if (c.flip) rec.flip_step_m = Math.max(rec.flip_step_m, c.flip);
        if (!(sp > L.speed)) continue;
        moved.add(i); rec.samples++;
        const ang = angleBetween(c.yaw, vx, vz);
        rec.max_angle_deg = Math.max(rec.max_angle_deg, ang);
        if (ang > L.back) back.add(i); else if (ang > L.angle) side.add(i);
        // gait vs ground
        let ratio = null;
        if (Array.isArray(c.feet) && c.feet.length && a.feet && b.feet) {
          let best = null;
          // contact: against the figure's own ground plane (y0, the root the rig plants on) when given, else the terrain
          c.feet.forEach((foot, f) => foot.forEach((p, j) => { const up = p[1] - (Number.isFinite(c.y0) ? c.y0 : ground(p[0], p[2])); if (!best || up < best.up) best = { f, j, up }; }));
          if (best && best.up < L.contact) {
            const pa = a.feet[best.f] && a.feet[best.f][best.j], pb = b.feet[best.f] && b.feet[best.f][best.j];
            if (pa && pb) {
              const fx = (pb[0] - pa[0]) / (2 * h), fz = (pb[2] - pa[2]) / (2 * h);
              ratio = 1 - (fx * vx + fz * vz) / (sp * sp);           // 1 = planted; < 1 the foot skates forward, > 1 backward
            }
          }
        } else if (Number.isFinite(c.phase) && Number.isFinite(a.phase) && Number.isFinite(b.phase) && c.stride > 0) {
          ratio = ((b.phase - a.phase) / (2 * h)) * c.stride / sp;
        }
        if (ratio != null) {
          if (!ratios.has(i)) ratios.set(i, []);
          ratios.get(i).push([ratio, t, sp]);
          rec.raw[0] = rec.raw[0] == null ? ratio : Math.min(rec.raw[0], ratio);
          rec.raw[1] = rec.raw[1] == null ? ratio : Math.max(rec.raw[1], ratio);
        }
        if (ang > L.angle) note(i, { bad: ang, t, angle_deg: Math.round(ang), ratio: r3(ratio), speed: r3(sp) });
      }
    }
    // gait vs ground per walker: median and the share of samples outside the band; p5/p95 for the report
    for (const [i, list] of ratios) {
      const v = list.map((q) => q[0]).sort((p, q) => p - q), at = (f) => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
      const med = at(0.5), p5 = at(0.05), p95 = at(0.95), out = list.filter((q) => q[0] < L.ratio[0] || q[0] > L.ratio[1]);
      rec.ratio[0] = rec.ratio[0] == null ? p5 : Math.min(rec.ratio[0], p5);
      rec.ratio[1] = rec.ratio[1] == null ? p95 : Math.max(rec.ratio[1], p95);
      if (med < L.ratio[0] || med > L.ratio[1] || out.length > L.share * list.length) {
        const w = out.reduce((a, q) => (Math.abs(Math.log(Math.max(1e-3, Math.abs(q[0])))) > Math.abs(Math.log(Math.max(1e-3, Math.abs(a[0])))) ? q : a), out[0] || list[0]);
        note(i, { bad: 1 + Math.abs(Math.log(Math.max(1e-3, Math.abs(med)))) * 10, t: w[1], angle_deg: 0, ratio: r3(med), speed: r3(w[2]), share: r3(out.length / list.length) });
      }
    }
    rec.walkers = n; rec.moving = moved.size; rec.backwards = back.size; rec.sideways = [...side].filter((i) => !back.has(i)).length;
    rec.max_angle_deg = Math.round(rec.max_angle_deg * 10) / 10; rec.ratio = rec.ratio.map(r3); rec.raw = rec.raw.map(r3); rec.flip_step_m = r3(rec.flip_step_m);
    out.items.push(rec);
    out.walkers += n; out.checked += moved.size; out.samples += rec.samples;
    out.backwards += rec.backwards; out.sideways += rec.sideways;
    out.max_angle_deg = Math.max(out.max_angle_deg, rec.max_angle_deg);
    out.flip_step_max_m = Math.max(out.flip_step_max_m, rec.flip_step_m || 0);
    if (rec.ratio[0] != null) out.slide_ratio_min = out.slide_ratio_min == null ? rec.ratio[0] : Math.min(out.slide_ratio_min, rec.ratio[0]);
    if (rec.ratio[1] != null) out.slide_ratio_max = out.slide_ratio_max == null ? rec.ratio[1] : Math.max(out.slide_ratio_max, rec.ratio[1]);
    for (const [i, s] of worst) {
      const what = s.angle_deg > L.back ? `walks backwards (${s.angle_deg}°)` : s.angle_deg > L.angle ? `walks sideways (${s.angle_deg}°)` : `feet slide (gait/ground median ${s.ratio}, ${Math.round((s.share || 0) * 100)} % of contacts outside 0.8–1.25)`;
      out.flagged.push({ who: `${who}#${i}`, t: +s.t.toFixed(2), angle_deg: s.angle_deg, ratio: s.ratio, speed: s.speed, ...(s.share != null ? { share: s.share } : {}), what });
    }
  }
  const dev = (r) => Math.abs(Math.log(Math.max(1e-3, Math.abs(r ?? 1))));
  out.flagged.sort((p, q) => (q.angle_deg - p.angle_deg) || (dev(q.ratio) - dev(p.ratio)));
  out.ok = out.flagged.length === 0;
  out.flagged_total = out.flagged.length;
  if (out.flagged.length > 60) out.flagged = out.flagged.slice(0, 60);
  out.max_angle_deg = Math.round(out.max_angle_deg * 10) / 10;
  return out;
}

// the scene's QA issues for render.py (one line per item that has flagged walkers)
export function locomotionIssues(lo, dur) {
  if (!lo || !Array.isArray(lo.items)) return [];
  const issues = [];
  for (const rec of lo.items) {
    const fl = (lo.flagged || []).filter((f) => f.who.startsWith(rec.who + '#'));
    if (!fl.length && !(rec.backwards || rec.sideways)) continue;
    const bits = [];
    if (rec.backwards) bits.push(`${rec.backwards} of ${rec.walkers} walk backwards`);
    if (rec.sideways) bits.push(`${rec.sideways} of ${rec.walkers} walk sideways`);
    if (rec.ratio[0] != null && (rec.ratio[0] < LOCO_LIMITS.ratio[0] || rec.ratio[1] > LOCO_LIMITS.ratio[1])) bits.push(`gait/ground ${rec.ratio[0]}–${rec.ratio[1]}`);
    const ts = fl.map((f) => f.t);
    issues.push({ from: ts.length ? Math.min(...ts) : 0, to: ts.length ? Math.max(...ts) : dur, frames: fl.length, what: `locomotion: ${rec.who}: ${bits.join(', ') || 'flagged'} (max ${rec.max_angle_deg}°)` });
  }
  return issues;
}
