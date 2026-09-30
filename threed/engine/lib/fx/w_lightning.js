// w_lightning.js — fx.lightning: cloud-to-ground strikes (v2, Q7 quality pass).
// The channel is a tortuous, near-vertical random walk (straight steps, sharp kinks, micro-zigzags) with branches that
// fade out before the ground, drawn as continuous camera-facing glow strips (joined, tapered: no quads, no seams): a
// white-hot core and a violet glow, at least ~1 px wide with the energy kept (far bolts get thinner-dimmer, not fat).
// Timing per strike (world seconds, so a slowed world clock slows it): a stepped leader creeps down with its branches,
// the return stroke flashes the channel, 1-3 subsequent strokes flicker through the main channel only (60-140 ms apart,
// with a continuing current between them), then a quick afterglow (it cools to orange in slow motion). Visible 0.1-0.4 s.
// The flash lights the scene: a sky/cloud flash (additive dome shell, patchy like lit cloud, strongest toward the bolt),
// a cloud-base glow, a key light from the channel and a light at the ground point.
//   mode 'strike'          one bolt at `at` (t_strike). A tree/pole/house found at `at` is the target: the bolt ends in
//                          its top and runs down the trunk; aftermath: sparks, a bark blast, steam then smoke, a small
//                          crown fire for the rest of the shot; ground-current arcs radiate from the base.
//   mode 'storm'           mostly cloud flashes (`flashes`, intra-cloud flicker lighting the sky) and `count` ground
//                          strikes round `at` (radius) at seeded times.
//   mode 'through_figure'  a mannequin at `at`: the bolt hits the head (pose 'standing') or the raised hand (pose
//                          'raised'); a 0.2-0.4 s flashover crawls over the wet skin with the strokes, the figure stiffens
//                          then slumps, steam rises from the shoulders; a Lichtenberg fern glows on the ground, fades to
//                          embers over ~1.5 s and stays as a scorch.
// Slow motion (auto when the scene's clock rate < 0.7, or `slowmo: true`): a 0.3 s stepped leader, strokes 70-140 ms
// apart, a second leader forking off the channel inside the frame to a second ground point (return stroke + re-strike),
// then the channel cools (white -> orange -> gone) over ~0.6 s.
import * as THREE from 'three';
import { prm, num, glowSprite, mannequin, Puffs, LOGV, LOGF, rng, clamp, lerp, sstep, TAU, DEG } from './w_common.js';
import { makeFire, makeGlowStreaks } from './glowkit.js';

export const CATALOG = {
  'fx.lightning': {
    desc: 'lightning: a tortuous branching bolt (white core, violet glow) that lasts 0.1-0.4 s with 2-4 flickering strokes and flashes the sky, clouds and ground. mode "strike" (one bolt at `at`, t_strike s; a tree/pole found at `at` is hit in its top: sparks, bark blast, steam, a small crown fire, ground-current arcs; side_flash [x,z] arcs to a nearby figure), "storm" (mostly cloud flashes + `count` ground strikes within radius m of `at`; pair with look sky "storm", time "dusk|night", weather rain), "through_figure" (a mannequin at `at`: head strike, 0.2-0.4 s skin flashover, stiffen + slump, steam from the shoulders, a Lichtenberg fern scorched on the ground). Slow motion (clock rate < 0.7 or slowmo: true): stepped leader, fork, re-strikes, the channel cooling.',
    actions: ['strike', 'storm', 'through_figure'],
    params: { mode: 'strike', cloud: 420, count: 6, radius: 900, flash: 1.0, reveal: 0.45, flashes: null, strokes: null, leader: null, slowmo: 'auto', aftermath: 'auto', ground_current: 'auto', side_flash: null, fork: 'auto', pose: 'standing', react: true, sky: 1.0 },
    doc: {
      t_strike: 's (world time) of the return stroke — the scored thunder/strike cue', flash: 'scene flash strength 0..2', sky: 'sky flash strength 0..2',
      flashes: 'storm: cloud flashes (default 1.6 x count + 2)', strokes: '2..4 strokes per bolt (default seeded)', leader: 'stepped-leader duration s (default 0.035, 0.3 in slow motion)',
      slowmo: '"auto" | true | false', aftermath: 'strike: sparks, bark blast, steam, crown fire when a target stands at `at` ("auto") | true | false',
      ground_current: 'strike: radial ground arcs at the base ("auto" = when a target is hit) | true | false', side_flash: '[x, z] or [x, y, z]: an arc from the struck object to a nearby figure',
      fork: 'slow motion: a second leader forks off to a second ground point ("auto")', pose: 'through_figure: "standing" (head strike) | "raised" (the old raised-hand pose)', react: 'through_figure: stiffen + slump',
    },
    footprint: [2, 2], height: 2, tags: ['disaster', 'storm', 'lightning', 'fx'], section: 'objects', contact: false,
  },
};

// ── small vector helpers ──────────────────────────────────────────────────────────────────────────────────────────
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ── channel generation ─────────────────────────────────────────────────────────────────────────────────────────
// a tortuous near-vertical walk from a to b: straight steps with sharp kinks, persistent meanders, pulled to the end
function walkTo(R, a, b, o = {}) {
  const H = vdist(a, b), step = o.step ?? clamp(H / 60, 0.2, 9), dev = o.dev ?? 1.05;
  const out = [a.slice()];
  let p = a.slice(), prev = vnorm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const minStep = o.minStep ?? 0.1;
  for (let g = 0; g < 4000; g++) {
    const to = [b[0] - p[0], b[1] - p[1], b[2] - p[2]], L = vlen(to);
    const stepH = clamp(L * 0.2, minStep, step);
    if (L < stepH * 1.3) break;
    const td = [to[0] / L, to[1] / L, to[2] / L];
    const big = R() < 0.14 ? 2.3 : 1;
    const k = [(R() - 0.5) * dev * big, (R() - 0.5) * dev * 0.35, (R() - 0.5) * dev * big];
    const pull = 0.85 + 2.2 * Math.pow(clamp(1 - L / H), 3);
    let d = vnorm([td[0] * pull + prev[0] * 0.6 + k[0], td[1] * pull + prev[1] * 0.6 + k[1], td[2] * pull + prev[2] * 0.6 + k[2]]);
    if (d[1] > -0.2) d = vnorm([d[0], -0.2, d[2]]);                           // never climbs
    const s = Math.min(stepH * (0.35 + R() * 1.25), L * 0.55);
    p = [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
    out.push(p); prev = d;
  }
  out.push(b.slice());
  return out;
}
// a branch: wanders along a mean direction for len metres (stops above `floor`)
function walkDir(R, a, dir, len, o = {}) {
  const step = o.step ?? clamp(len / 14, 0.15, 6), out = [a.slice()];
  let p = a.slice(), prev = dir, run = 0;
  for (let g = 0; g < 600 && run < len; g++) {
    const big = R() < 0.15 ? 2.2 : 1;
    const k = [(R() - 0.5) * big, (R() - 0.5) * 0.4, (R() - 0.5) * big];
    let d = vnorm([dir[0] * 0.9 + prev[0] * 0.55 + k[0], dir[1] * 0.9 + prev[1] * 0.55 + k[1] - 0.12 * run / len, dir[2] * 0.9 + prev[2] * 0.55 + k[2]]);
    if (d[1] > -0.12) d = vnorm([d[0], -0.12, d[2]]);
    const s = step * (0.4 + R() * 1.1);
    p = [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
    if (o.floor != null && p[1] < o.floor) break;
    out.push(p); prev = d; run += s;
  }
  return out;
}
// micro-kinks: each segment gets a displaced midpoint (times passes)
function jag(R, pts, amt = 0.2, times = 1, keepEnd = true) {
  for (let t = 0; t < times; t++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1], L = vdist(p, q);
      out.push([(p[0] + q[0]) / 2 + (R() - 0.5) * L * amt, (p[1] + q[1]) / 2 + (R() - 0.5) * L * amt * 0.3, (p[2] + q[2]) / 2 + (R() - 0.5) * L * amt], q);
    }
    pts = out;
  }
  if (keepEnd) return pts;
  return pts;
}
// a bolt: main channel + branches (+ sub-branches); s = vertical progress 0 (cloud) .. 1 (ground) per point
function makeBolt(seed, top, ground, o = {}) {
  const R = rng(seed);
  const H = top[1] - ground[1];
  const sOf = (p) => clamp((top[1] - p[1]) / H, 0, 1);
  const main = jag(R, walkTo(R, top, ground, { step: o.step ?? clamp(H / 55, 0.25, 8) }), 0.22, 2);
  const lines = [{ pts: main, s: main.map(sOf), lvl: 0, w: 1, taper: 0 }];
  const nb = o.branches ?? 9;
  for (let k = 0; k < nb; k++) {
    const f = 0.06 + Math.pow(R(), 1.3) * 0.72;
    const i = Math.floor(f * (main.length - 1)), p = main[i];
    const L = H * (0.07 + R() * 0.24) * (1 - f * 0.55);
    const a = R() * TAU, dn = 0.65 + R() * 0.55;
    const br = jag(R, walkDir(R, p, vnorm([Math.cos(a), -dn, Math.sin(a)]), L, { floor: ground[1] + H * 0.06 }), 0.2, 1);
    if (br.length < 3) continue;
    lines.push({ pts: br, s: br.map(sOf), lvl: 1, w: 0.55, taper: 1 });
    if (R() < 0.65) {
      const j = Math.floor(br.length * (0.25 + R() * 0.45)), q = br[j], a2 = a + (R() - 0.5) * 2.2;
      const sb = jag(R, walkDir(R, q, vnorm([Math.cos(a2), -0.9 - R() * 0.4, Math.sin(a2)]), L * (0.25 + R() * 0.3), { floor: ground[1] + H * 0.05 }), 0.2, 1);
      if (sb.length >= 3) lines.push({ pts: sb, s: sb.map(sOf), lvl: 2, w: 0.32, taper: 1 });
    }
  }
  return lines;
}

// ── continuous glow strips (joined vertices: no overlapping quads) ─────────────────────────────────────────────────
function stripGeo(lines) {
  const P = [], Pp = [], Pn = [], E = [], I = [];
  let v = 0;
  for (const l of lines) {
    const n = l.pts.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const p = l.pts[i], pp = l.pts[Math.max(0, i - 1)], pn = l.pts[Math.min(n - 1, i + 1)];
      const f = i / (n - 1);
      const w = l.w * (l.taper ? Math.max(0.12, 1 - Math.pow(f, 1.6) * 0.88) : 1) * (l.wf ? l.wf(f) : 1);
      for (const side of [-1, 1]) { P.push(p[0], p[1], p[2]); Pp.push(pp[0], pp[1], pp[2]); Pn.push(pn[0], pn[1], pn[2]); E.push(side, l.s ? l.s[i] : f, w, l.lvl + (l.taper ? f * 0.49 : 0)); }
      if (i < n - 1) I.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      v += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aPrev', new THREE.Float32BufferAttribute(Pp, 3));
  g.setAttribute('aNext', new THREE.Float32BufferAttribute(Pn, 3));
  g.setAttribute('aE', new THREE.Float32BufferAttribute(E, 4));
  g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}
// o: col, gain, wk (m per width unit), sharp (profile), minPx, blend 'add' | 'dark'
function stripMat(o) {
  const u = {
    uLead: { value: -1 }, uLeadGain: { value: 0.3 }, uStroke: { value: 0 }, uUp: { value: 0 }, uSFork: { value: -1 }, uAfter: { value: 0 }, uBranch: { value: 1 },
    uCool: { value: 0 }, uCol: { value: new THREE.Color(...o.col) }, uColCool: { value: new THREE.Color(...(o.cool || [1.0, 0.32, 0.06])) },
    uGain: { value: o.gain }, uWK: { value: o.wk }, uPx: { value: 0.0012 }, uSharp: { value: o.sharp }, uMinPx: { value: o.minPx ?? 0.8 }, uMinK: { value: o.minK ?? 0.35 },
    uAlpha: { value: 0 },
  };
  const dark = o.blend === 'dark';
  return new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, depthTest: o.depthTest ?? true, side: THREE.DoubleSide,
    blending: dark ? THREE.NormalBlending : THREE.AdditiveBlending,
    vertexShader: LOGV + /* glsl */`
      attribute vec3 aPrev; attribute vec3 aNext; attribute vec4 aE;
      uniform float uWK, uPx, uMinPx, uMinK; varying float vX; varying float vS; varying float vL; varying float vK;
      void main(){
        vec3 P = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 A = (modelMatrix * vec4(aPrev, 1.0)).xyz, B = (modelMatrix * vec4(aNext, 1.0)).xyz;
        vec3 d = B - A; float L = length(d); d = L > 1e-6 ? d / L : vec3(0.0, 1.0, 0.0);
        vec3 toC = normalize(cameraPosition - P);
        vec3 sd = cross(d, toC); float sl = length(sd); sd = sl > 1e-5 ? sd / sl : vec3(1.0, 0.0, 0.0);
        float dist = length(cameraPosition - P);
        float wW = aE.z * uWK, wMin = dist * uPx * uMinPx, w = max(wW, wMin);
        vK = clamp(wW / w, uMinK, 1.0);
        P += sd * aE.x * w;
        vX = aE.x; vS = aE.y; vL = aE.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGF + /* glsl */`
      uniform float uLead, uLeadGain, uStroke, uUp, uSFork, uAfter, uBranch, uCool, uGain, uSharp, uAlpha; uniform vec3 uCol, uColCool;
      varying float vX; varying float vS; varying float vL; varying float vK;
      void main(){
        #include <logdepthbuf_fragment>
        float lvl = floor(vL + 0.01), tip = fract(vL + 0.01);
        float lead = vS <= uLead ? 0.3 + 0.7 * exp(-(uLead - vS) / 0.035) : 0.0;
        float br = lvl < 0.5 ? 1.0 : uBranch * (lvl < 1.5 ? 0.75 : 0.5) * (1.0 - 0.6 * tip);
        float up = (lvl < 0.5 && vS < uSFork) ? uUp : 0.0;
        float I = max(lead * uLeadGain * (lvl < 0.5 ? 1.0 : 0.8 * (1.0 - 0.5 * tip)), uStroke * br + up) + uAfter * (lvl < 0.5 ? 1.0 : 0.12 * uBranch);
        float prof = exp(-vX * vX * uSharp);
        ${dark ? `float a = uAlpha * prof * (lvl < 0.5 ? 1.0 : 0.7) * (1.0 - 0.7 * tip); if (a < 0.003) discard; gl_FragColor = vec4(uCol, a);` : `
        float a = I * prof * uGain * vK;
        if (a < 0.002) discard;
        gl_FragColor = vec4(mix(uCol, uColCool, uCool) * a, 1.0);`}
      }`,
  });
}
function stripMesh(parent, lines, mat, order) {
  const m = new THREE.Mesh(stripGeo(lines), mat); m.frustumCulled = false; m.userData.noQA = true; m.renderOrder = order; parent.add(m); return m;
}

// ── timing of one strike (world s): leader, strokes, continuing current, afterglow/cooling ─────────────────────────
function timeline(ts, R, o) {
  const nS = clamp(Math.round(o.strokes ?? (2 + Math.floor(R() * 2.6))), 1, 5);
  const P = [[0, 1.0]]; let tt = 0;
  for (let k = 1; k < nS; k++) { tt += (o.slow ? 0.07 : 0.035) + R() * (o.slow ? 0.07 : 0.045); P.push([tt, (0.85 - 0.12 * k) * (0.75 + 0.35 * R())]); }
  const end = tt, LD = o.leader, tauS = o.slow ? 0.022 : 0.016, cc = 0.24;
  const aA = o.slow ? 0.36 : 0.24, aTau = o.slow ? 0.12 : 0.035;
  const steps = o.slow ? 28 : 10;
  const fn = (t) => {
    const x = t - ts;
    let lead = -1;
    if (x < 0 && x > -LD) { const f = (x + LD) / LD, st = f * steps; lead = (Math.floor(st) + sstep(0.7, 1, st % 1)) / steps; }
    else if (x >= 0) lead = 1.05;
    let stroke = 0;
    for (const [dt, a] of P) { const y = x - dt; if (y >= -0.002) stroke += a * (y < 0 ? 1 + y / 0.002 : Math.exp(-y / tauS)); }
    const cur = x >= 0 && x <= end + 0.02 ? cc * (0.75 + 0.25 * Math.sin(x * 233 + ts)) : 0;
    const after = x > end ? aA * Math.exp(-(x - end) / aTau) : 0;
    const branch = x < 0 ? 1 : Math.exp(-x / (o.slow ? 0.06 : 0.035));
    const cool = o.slow && x > end ? sstep(0.2 * aTau, 2.2 * aTau, x - end) : 0;           // the orange cooling shows only in slow motion
    return { lead, stroke: Math.min(stroke + cur, 1.8), after, branch, cool, on: x > -LD && x < end + aTau * 5.5, x };
  };
  fn.end = end; fn.P = P;
  return fn;
}

// the world clock's rate at world time ts (slow motion): measured on the loaded scene's own clock function, so it
// works for clock.rate, freeze_at and Q6's clock.keys / sync alike; null while the scene is still being built
function clockRateAt(ts) {
  try {
    const cur = window.__f3d?.cur;
    if (!cur) return null;
    const W = cur.W;
    if (typeof W !== 'function') return 1;
    const dur = cur.dur || 10;
    let best = 0, bd = 1e9;
    for (let i = 0; i <= 600; i++) { const tt = -1 + (dur + 2) * i / 600, d = Math.abs(W(tt) - ts); if (d < bd) { bd = d; best = tt; } }
    return Math.max(0, (W(best + 0.02) - W(best - 0.02)) / 0.04);
  } catch (e) { return 1; }
}

// a standing object at `at` (tree, pole, house): the world box of the meshes standing within 4 m of it, or null
// (mesh boxes, not item roots: a flora item's root can sit at the origin with the tree placed inside it)
function findTarget(ctx, at, skip) {
  const box = new THREE.Box3(), tmp = new THREE.Box3(), c = new THREE.Vector3();
  let n = 0;
  ctx.scene.updateMatrixWorld(true);
  for (const ch of ctx.scene.children) {
    if (skip.has(ch) || /^fx\./.test(ch.name || '') || /^cast:/.test(ch.name || '')) continue;
    ch.traverse((o) => {
      if (!o.isMesh || !o.visible || o.name === 'contactShadow') return;              // instanced leaves count (a whole forest is too wide)
      tmp.setFromObject(o); if (tmp.isEmpty()) return;
      tmp.getCenter(c);
      if (Math.hypot(c.x - at[0], c.z - at[1]) > 4) return;
      const w = Math.max(tmp.max.x - tmp.min.x, tmp.max.z - tmp.min.z), h = tmp.max.y - tmp.min.y;
      if (w > 30 || h < 0.3 || h > 80) return;
      if (!n++) box.copy(tmp); else box.union(tmp);
    });
  }
  if (!n || box.max.y - box.min.y < 2.6) return null;
  box.getCenter(c);
  return { box, base: [c.x, ctx.ground.height(c.x, c.z), c.z] };
}

// sky flash: an additive shell round the camera, patchy like lit cloud, strongest toward the flash
function skyDome() {
  const u = { uI: { value: 0 }, uDir: { value: new THREE.Vector3(0, 1, 0) }, uCol: { value: new THREE.Color(0.62, 0.66, 1.0) }, uSeed: { value: 0 } };
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    vertexShader: LOGV + /* glsl */`varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(position, 1.0)); #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGF + /* glsl */`uniform float uI, uSeed; uniform vec3 uDir, uCol; varying vec3 vD;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        #include <logdepthbuf_fragment>
        float el = vD.y;
        float h = smoothstep(-0.04, 0.12, el) * (0.6 + 0.4 * (1.0 - smoothstep(0.35, 1.0, el)));
        vec2 cp = vD.xz / max(el + 0.18, 0.06) * 1.6 + uSeed;
        float cl = n2(cp) * 0.55 + n2(cp * 2.3 + 3.1) * 0.3 + n2(cp * 5.1 + 7.7) * 0.15;
        float dirK = pow(max(dot(vD, uDir), 0.0), 3.0);
        float I = uI * h * (0.3 + 1.7 * dirK) * (0.45 + 1.1 * cl * cl);
        if (I < 0.002) discard;
        gl_FragColor = vec4(uCol * I, 1.0);
      }`,
  }));
  m.frustumCulled = false; m.userData.noQA = true; m.renderOrder = -1000; m.name = 'fx.lightning.skyflash';
  return { mesh: m, u };
}

export async function build(kind, item, ctx) {
  const P = prm(item);
  const mode = P.mode || item.action || 'strike';
  const dur = ctx.dur ?? 10;
  const at = item.at || [0, 0], G = ctx.ground.height;
  const gy0 = G(at[0], at[1]);
  const root = new THREE.Group(); root.name = 'fx.lightning'; root.position.set(at[0], gy0, at[1]);
  // the bolts and the flash live in their own group (not under root), so the camera frames the figure / ground point
  const sky = new THREE.Group(); sky.name = 'fx.lightning.sky'; sky.position.copy(root.position); sky.userData.noQA = true; ctx.scene.add(sky);
  const Hc = num(P.cloud, 420), FL = num(P.flash, 1), SKY = num(P.sky, 1);
  const seed = (item.seed ?? 5) * 31 + 7;
  const R = rng(seed);
  const slowP = P.slowmo;
  let slow = slowP === true || slowP === 'true' ? true : (slowP === false || slowP === 'false' ? false : null);   // null = auto (first update)
  // auto: read the loaded scene's clock (not available while the scene is being built -> decided at the first frame)
  const slowNow = () => { if (slow != null) return slow; const r = clockRateAt(tS); if (r == null) return null; return (slow = r < 0.7); };
  // flash lights (flagged so the FX probes of the scene lights skip them)
  const key = new THREE.DirectionalLight(0xC8D2FF, 0); key.userData.fx = true; key.castShadow = false;
  const hemi = new THREE.HemisphereLight(0xB8C4FF, 0x303040, 0); hemi.userData.fx = true;
  const pt = new THREE.PointLight(0xD0DAFF, 0, 0, 2); pt.userData.fx = true; pt.castShadow = false;
  sky.add(key, key.target, hemi, pt);
  const dome = skyDome(); ctx.scene.add(dome.mesh); dome.u.uSeed.value = (seed % 97) * 0.37;
  const strikes = [];
  const cloudGlow = glowSprite([0.75, 0.78, 1.0], Hc * 2.4), groundGlow = glowSprite([0.8, 0.85, 1.0], 15);
  sky.add(cloudGlow, groundGlow);
  const tS = num(P.t_strike, mode === 'through_figure' ? 1.4 : dur * 0.35);
  // the slow-motion flag decides the leader length and the cooling; it is read at the first update, so the strikes
  // keep their lines and only the timelines are made then
  function addStrike(ts, gx, gz, gyAbs, o = {}) {
    const top = [gx + (R() - 0.5) * Hc * 0.18, gyAbs - gy0 + Hc, gz + (R() - 0.5) * Hc * 0.18];
    const bot = [gx, gyAbs - gy0, gz];
    const lines = makeBolt(seed + strikes.length * 101, top, bot, { branches: o.branches ?? 9 });
    if (o.extra) lines.push(...o.extra);
    const glowW = o.w ?? 1;
    const core = stripMat({ col: [1.0, 1.0, 1.0], cool: [1.0, 0.42, 0.1], gain: 11 * FL, wk: 0.09 * glowW, sharp: 2.8, minPx: 0.9 });
    const glow = stripMat({ col: [0.46, 0.44, 1.0], cool: [0.6, 0.12, 0.02], gain: 0.7 * FL, wk: 0.33 * glowW, sharp: 2.2, minPx: 4.5, minK: 0.45 });
    const m1 = stripMesh(sky, lines, glow, 30), m2 = stripMesh(sky, lines, core, 31);
    const Rt = rng(seed + strikes.length * 7 + 3);
    R(); R(); R();                                   // V1 drew 3 pulse jitters here: kept, so storm strikes keep their V1 places and times (scored thunder)
    strikes.push({ ts, core, glow, top, bot, m1, m2, Rt, o, tl: null, lines });
    return strikes[strikes.length - 1];
  }

  let man = null, pathMats = null, bodyMats = [], arcsM = null, fern = null, steam = null, figRig = null, figX = null;
  let target = null, after = null, gcur = null, fork = null, side = null;
  const revealT = Math.min(num(P.reveal, 0.45), 0.06);

  if (mode === 'storm') {
    const n = Math.round(num(P.count, 6)), rad = num(P.radius, 900);
    for (let k = 0; k < n; k++) {
      const a = R() * TAU, d = rad * (0.25 + 0.75 * Math.sqrt(R()));
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const ts = 0.6 + (k + 0.3 * R()) * (dur - 1.8) / n;
      addStrike(ts, x, z, G(at[0] + x, at[1] + z), { w: 1.4 + d / 500 });
    }
  } else if (mode === 'through_figure') {
    // figure: a cast figure standing at `at` takes the strike (its own action does the fall), else our own mannequin
    const figRef = P.figure ?? P.stand_in ?? P.fx_stand_in;
    let B = null;
    if (figRef != null && figRef !== false && figRef !== 'own' && figRef !== 'false') {
      const want = typeof figRef === 'string' && !/^(auto|true|cast|nearest)$/.test(figRef) ? figRef.replace(/^ref:/, '') : null;
      let best = null, bd = 3.5; const v = new THREE.Vector3();
      for (const ch of ctx.scene.children) {
        if (!/^cast:/.test(ch.name || '')) continue;
        if (want && ch.name !== 'cast:' + want) continue;
        ch.getWorldPosition(v); const d = Math.hypot(v.x - at[0], v.z - at[1]);
        if (d < bd) { bd = d; best = ch; }
      }
      if (best) {
        B = {}; best.traverse((o) => { if (o.isBone && !B[o.name]) B[o.name] = o; });
        if (!B.head || !B.pelvis) B = null; else figX = { root: best, B };
      }
      if (!figX) ctx.warn(`fx.lightning through_figure: no cast figure ${want || ''} within 3.5 m of at; using its own mannequin`);
    }
    if (!figX) {
      man = await mannequin(ctx, {});
      root.add(man.group);
      man.group.rotation.y = Math.PI - (item.heading ?? 180) * DEG;
    }
    const raised = P.pose === 'raised' && !figX;
    const pose0 = raised ? { rArmZ: -2.75, rArmX: -0.15, rElbow: -0.12, rShape: 'flat', headX: -0.18, lArmZ: 0.12, lElbow: -0.2, lLegY: 0.12, rLegY: -0.12 }
      : { lArmZ: 0.1, rArmZ: -0.1, lElbow: -0.18, rElbow: -0.16, headX: -0.1, lLegY: 0.1, rLegY: -0.1 };
    if (man) { man.pose(pose0); figRig = { raised, pose0 }; B = man.B; }
    root.updateMatrixWorld(true); if (figX) figX.root.updateMatrixWorld(true);
    const wp = (b, dy = 0) => { const v = b.getWorldPosition(new THREE.Vector3()); return [v.x - root.position.x, v.y - root.position.y + dy, v.z - root.position.z]; };
    const tip = raised ? wp(B.fR1tip || B.handR) : wp(B.head, 0.16);
    // the bolt from the cloud to the hand / the top of the head
    addStrike(tS, tip[0], tip[2], tip[1] + gy0 + 0.02, { w: 0.07, branches: 7 });
    // the current's path: ground under the left foot -> leg -> pelvis -> spine -> chest -> (arm -> hand | neck -> head)
    const chain = (raised ? [B.toeL, B.footL, B.shinL, B.thighL, B.pelvis, B.spine, B.chest, B.clavR, B.armR, B.foreR, B.handR] : [B.toeL, B.footL, B.shinL, B.thighL, B.pelvis, B.spine, B.chest, B.neck, B.head]).map((b) => wp(b));
    const g0 = [chain[0][0] + 0.05, 0.01, chain[0][2] + 0.05];
    const pts = [g0, ...chain, tip];
    const RR = rng(seed + 5), fine = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1], L = vdist(p, q), nn = Math.max(2, Math.round(L / 0.05));
      for (let k = 0; k < nn; k++) { const f = k / nn; fine.push([lerp(p[0], q[0], f) + (RR() - 0.5) * 0.025, lerp(p[1], q[1], f) + (RR() - 0.5) * 0.025, lerp(p[2], q[2], f) + (RR() - 0.5) * 0.025]); }
    }
    fine.push(tip);
    const gP = stripGeo([{ pts: fine, s: fine.map((_, i) => i / (fine.length - 1)), lvl: 0, w: 1 }]);
    // flashover: sparks crawling just outside the wet skin, head -> feet, both sides of the body
    const arcLines = [];
    const axis = (y) => { let best = fine[0]; for (const p of fine) if (Math.abs(p[1] - y) < Math.abs(best[1] - y)) best = p; return best; };
    for (let k = 0; k < 18; k++) {
      const y0 = 0.1 + RR() * 1.55, y1 = Math.max(0.02, y0 - 0.25 - RR() * 0.45);
      const c0 = axis(y0), c1 = axis(y1), a = RR() * TAU, rr = 0.13 + RR() * 0.07;
      const p = [c0[0] + Math.cos(a) * rr, y0, c0[2] + Math.sin(a) * rr], q = [c1[0] + Math.cos(a + (RR() - 0.5)) * rr, y1, c1[2] + Math.sin(a + (RR() - 0.5)) * rr];
      const ln = jag(RR, [p, q], 0.5, 4);
      arcLines.push({ pts: ln, s: ln.map((_, i) => i / (ln.length - 1)), lvl: 1, w: 1, taper: 0 });
    }
    // the Lichtenberg fern on the ground round the feet: branching, thinning walks
    const fernLines = [];
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * TAU + RR() * 0.5, L = 1.4 + RR() * 2.4;
      const mainL = walkDir(RR, [g0[0], 0.03, g0[2]], [Math.cos(a), -0.001, Math.sin(a)], L, { step: 0.12 }).map((p) => [p[0], 0.03, p[2]]);
      fernLines.push({ pts: mainL, s: mainL.map((_, i) => i / (mainL.length - 1)), lvl: 1, w: 1, taper: 1 });
      for (let j = 2; j < mainL.length - 3; j += 2 + Math.floor(RR() * 3)) {
        const q = mainL[j], a2 = a + (RR() < 0.5 ? -1 : 1) * (0.5 + RR() * 0.6), L2 = L * (0.12 + RR() * 0.25) * (1 - j / mainL.length);
        const sb = walkDir(RR, q, [Math.cos(a2), -0.001, Math.sin(a2)], L2, { step: 0.08 }).map((p) => [p[0], 0.03, p[2]]);
        if (sb.length > 2) fernLines.push({ pts: sb, s: sb.map((_, i) => i / (sb.length - 1)), lvl: 2, w: 0.6, taper: 1 });
      }
    }
    const pCore = stripMat({ col: [1, 1, 1], gain: 5 * FL, wk: 0.018, sharp: 2.6, depthTest: false, minPx: 1.0 });
    const pGlow = stripMat({ col: [0.35, 0.5, 1.0], gain: 0.45 * FL, wk: 0.07, sharp: 1.6, depthTest: false, minPx: 4 });
    const aCore = stripMat({ col: [0.85, 0.9, 1.0], gain: 7 * FL, wk: 0.012, sharp: 2.4, minPx: 0.8 });
    const aGlow = stripMat({ col: [0.4, 0.5, 1.0], gain: 0.5 * FL, wk: 0.06, sharp: 1.4, minPx: 3.5 });
    const fGlow = stripMat({ col: [0.8, 0.86, 1.0], cool: [1.0, 0.3, 0.05], gain: 3.2 * FL, wk: 0.03, sharp: 2.0, minPx: 0.9 });
    const fDark = stripMat({ col: [0.035, 0.028, 0.02], gain: 1, wk: 0.05, sharp: 1.2, minPx: 1.2, blend: 'dark' });
    pathMats = [pCore, pGlow]; arcsM = [aCore, aGlow]; fern = { glow: fGlow, dark: fDark };
    stripMesh(root, [{ pts: fine, s: fine.map((_, i) => i / (fine.length - 1)), lvl: 0, w: 1 }], pGlow, 40);
    stripMesh(root, [{ pts: fine, s: fine.map((_, i) => i / (fine.length - 1)), lvl: 0, w: 1 }], pCore, 41);
    stripMesh(root, arcLines, aGlow, 42); stripMesh(root, arcLines, aCore, 43);
    stripMesh(root, fernLines, fDark, 4); stripMesh(root, fernLines, fGlow, 39);
    void gP;
    // skin flashover: own copies of the body materials with an animated emissive
    (man ? man.group : figX.root).traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      const cl = ms.map((m) => { const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; if (c.emissive) { c.emissive.setRGB(0.55, 0.65, 1.0); c.emissiveIntensity = 0; bodyMats.push(c); } return c; });
      o.material = Array.isArray(o.material) ? cl : cl[0];
    });
    // steam from the shoulders and the head after the flash
    steam = { puffs: new Puffs(ctx, 70, { back: 0.9, dark: 0.15, name: 'lightning_steam', wisp: 0.85 }), bones: [[B.armL || B.clavL || B.chest, 0.08], [B.armR || B.clavR || B.chest, 0.08], [B.clavL || B.chest, 0.07], [B.clavR || B.chest, 0.07], [B.armL || B.chest, 0.05], [B.armR || B.chest, 0.05], [B.head, 0.1]], wp };
    steam.src = steam.bones.map(([b, dy]) => wp(b, dy));
    root.add(steam.puffs.mesh);
    groundGlow.scale.set(2.2, 2.2, 1);
  } else {
    // strike: hit the object standing at `at` (its top), else the ground
    const tg = findTarget(ctx, at, new Set([root, sky, dome.mesh]));
    let endY = gy0, extra = null, tx = at[0], tz = at[1];
    if (tg && P.hit !== false) {
      const b = tg.box, top = b.max.y, gB = tg.base[1];
      tx = tg.base[0]; tz = tg.base[2];
      const crownR = Math.max(0.6, Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5);
      const hT = top - gB, crownBot = gB + hT * 0.45;
      target = { top, base: gB, crownR, hT, crownBot, x: tx - at[0], z: tz - at[1] };
      endY = top - 0.25;
      // the current runs down the trunk: a jagged scar just outside the bark, from inside the crown to the ground
      const RT = rng(seed + 77), trunk = [];
      const ph0 = RT() * TAU;
      for (let y = top - 0.25; y > gB - 0.05; y -= 0.35) {
        const f = (top - y) / hT, r = y > crownBot ? crownR * 0.25 * (1 - f) + 0.3 : 0.28 + 0.05 * RT();
        const ph = ph0 + f * 1.2 + (RT() - 0.5) * 0.25;
        trunk.push([target.x + Math.cos(ph) * r + (RT() - 0.5) * 0.08, y - gy0, target.z + Math.sin(ph) * r + (RT() - 0.5) * 0.08]);
      }
      trunk.push([target.x + Math.cos(ph0 + 1.2) * 0.3, gB - gy0 - 0.02, target.z + Math.sin(ph0 + 1.2) * 0.3]);
      extra = [{ pts: trunk, s: trunk.map(() => 1), lvl: 0, w: 0.5, taper: 0 }];
      target.scar = trunk;
    }
    const st = addStrike(tS, tx - at[0], tz - at[1], endY, { w: 1.5, extra });
    // ground current: arcs over the wet ground from the base (glow only during the strokes)
    const onOff = (v, auto) => (v == null || v === 'auto' ? auto : v === true || v === 'true' || (typeof v === 'number' && v > 0));
    const gcOn = onOff(P.ground_current, !!target);
    if (gcOn) {
      const RG = rng(seed + 91), lines = [], bx = (target ? target.x : 0), bz = (target ? target.z : 0);
      for (let k = 0; k < 13; k++) {
        const a = (k / 13) * TAU + RG() * 0.45, L = 2.5 + RG() * 5;
        const ln = walkDir(RG, [bx, 0, bz], [Math.cos(a), -0.001, Math.sin(a)], L, { step: 0.25 }).map((p) => { const x = p[0] + at[0], z = p[2] + at[1]; return [p[0], G(x, z) - gy0 + 0.05, p[2]]; });
        lines.push({ pts: ln, s: ln.map((_, i) => i / (ln.length - 1)), lvl: 1, w: 1, taper: 1 });
      }
      const c = stripMat({ col: [0.85, 0.9, 1.0], gain: 5 * FL, wk: 0.035, sharp: 2.4, minPx: 0.9 }), g = stripMat({ col: [0.4, 0.46, 1.0], gain: 0.5 * FL, wk: 0.22, sharp: 1.4, minPx: 4 });
      stripMesh(sky, lines, g, 28); stripMesh(sky, lines, c, 29);
      gcur = [c, g];
    }
    // side flash: an arc from the struck object to a nearby figure
    let sfTo = P.side_flash && !Array.isArray(P.side_flash) && typeof P.side_flash === 'object' ? P.side_flash.to : P.side_flash;
    const sfH = num(P.side_flash?.h, 1.25);
    if (typeof sfTo === 'string') {
      const want = 'cast:' + sfTo.replace(/^ref:/, ''), v = new THREE.Vector3(); let hit = null;
      for (const ch of ctx.scene.children) if (ch.name === want) { hit = ch; break; }
      if (hit) { hit.getWorldPosition(v); sfTo = [v.x, v.z]; } else { ctx.warn(`fx.lightning side_flash: ${sfTo} not found`); sfTo = null; }
    }
    if (Array.isArray(sfTo) && sfTo.length >= 2) {
      const sf = sfTo, sx = +sf[0], sz = +sf[sf.length === 3 ? 2 : 1], sy = sf.length === 3 ? +sf[1] : sfH;
      const RS = rng(seed + 131), a0 = [target ? target.x : 0, (target ? target.base : gy0) - gy0 + 1.7, target ? target.z : 0];
      const b0 = [sx - at[0], G(sx, sz) - gy0 + sy, sz - at[1]];
      const ln = jag(RS, walkTo(RS, a0, b0, { step: 0.25, dev: 1.3 }), 0.3, 2);
      const c = stripMat({ col: [1, 1, 1], gain: 9 * FL, wk: 0.03, sharp: 2.6, minPx: 1.0 }), g = stripMat({ col: [0.45, 0.45, 1.0], gain: 0.6 * FL, wk: 0.3, sharp: 1.5, minPx: 5 });
      stripMesh(sky, [{ pts: ln, s: ln.map(() => 1), lvl: 0, w: 1 }], g, 30); stripMesh(sky, [{ pts: ln, s: ln.map(() => 1), lvl: 0, w: 1 }], c, 31);
      side = [c, g];
    }
    // slow motion: a second leader forks off the channel inside the frame (lines built now, shown only when slow)
    if (P.fork !== false && P.fork !== 'false') {
      const main = st.lines[0].pts, gyE = endY - gy0;
      const wantY = gyE + clamp(Hc * 0.1, 14, 34);
      let fi = 0; for (let i = 0; i < main.length; i++) if (Math.abs(main[i][1] - wantY) < Math.abs(main[fi][1] - wantY)) fi = i;
      const RF = rng(seed + 211), a = RF() * TAU, dd = 10 + RF() * 12;
      const gx = main[fi][0] + Math.cos(a) * dd, gz = main[fi][2] + Math.sin(a) * dd;
      const gEnd = [gx, G(gx + at[0], gz + at[1]) - gy0, gz];
      const top = main[fi], H = top[1] - gEnd[1];
      const sOf = (p) => clamp((top[1] - p[1]) / H, 0, 1);
      const fm = jag(RF, walkTo(RF, top, gEnd, { step: clamp(H / 16, 0.4, 3) }), 0.22, 2);
      const fl = [{ pts: fm, s: fm.map(sOf), lvl: 0, w: 0.8, taper: 0 }];
      for (let k = 0; k < 5; k++) {
        const i = Math.floor((0.1 + RF() * 0.6) * (fm.length - 1)), p = fm[i], a2 = RF() * TAU;
        const br = jag(RF, walkDir(RF, p, vnorm([Math.cos(a2), -0.8 - RF() * 0.5, Math.sin(a2)]), H * (0.15 + RF() * 0.25), { floor: gEnd[1] + 1.5 }), 0.2, 1);
        if (br.length > 2) fl.push({ pts: br, s: br.map(sOf), lvl: 1, w: 0.45, taper: 1 });
      }
      const c = stripMat({ col: [1, 1, 1], cool: [1.0, 0.42, 0.1], gain: 10 * FL, wk: 0.07, sharp: 2.8, minPx: 0.9 }), g = stripMat({ col: [0.46, 0.44, 1.0], cool: [0.6, 0.12, 0.02], gain: 0.65 * FL, wk: 0.28, sharp: 2.2, minPx: 4.5, minK: 0.45 });
      const m1 = stripMesh(sky, fl, g, 30), m2 = stripMesh(sky, fl, c, 31);
      m1.visible = m2.visible = false;
      fork = { c, g, m1, m2, sF: sOf(main[fi]) * 0 + clamp((st.top[1] - main[fi][1]) / (st.top[1] - st.bot[1]), 0, 1), gEnd, t0: tS + 0.1, lead: 0.24 };
    }
    // aftermath on the struck object
    const amOn = onOff(P.aftermath, !!target);
    if (amOn) {
      const tgt = target || { top: gy0 + 1, base: gy0, crownR: 1, hT: 1, crownBot: gy0 + 0.5, x: 0, z: 0, scar: [[0, 1, 0], [0, 0, 0]] };
      const RA = rng(seed + 303);
      const NS = 190, sparks = makeGlowStreaks(ctx, { count: NS, minPx: 1.2, name: 'lightning_sparks' }); sky.add(sparks.mesh);
      const SP = [];
      for (let i = 0; i < NS; i++) {
        const fromTop = RA() < 0.45;
        const src = fromTop ? [tgt.x + (RA() - 0.5) * tgt.crownR * 0.6, tgt.top - gy0 - RA() * 1.2, tgt.z + (RA() - 0.5) * tgt.crownR * 0.6] : tgt.scar[Math.floor(RA() * tgt.scar.length)];
        const a = RA() * TAU, up = fromTop ? RA() * 1.2 - 0.3 : RA() * 0.9 - 0.1;
        const d = vnorm([Math.cos(a), up, Math.sin(a)]), sp = (6 + Math.pow(RA(), 0.7) * 26) * clamp(tgt.hT / 10, 0.7, 1.6);
        SP.push({ p: src, v: [d[0] * sp, d[1] * sp, d[2] * sp], t0: RA() * 0.04 + (RA() < 0.25 ? 0.05 + RA() * 0.1 : 0), life: 0.35 + Math.pow(RA(), 1.5) * 1.4, w: (0.018 + RA() * 0.025) * clamp(tgt.hT / 10, 0.7, 1.6) });
      }
      const NB = 40, chipGeo = new THREE.BoxGeometry(0.1, 0.025, 0.22);
      const chips = new THREE.InstancedMesh(chipGeo, new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.95 }), NB);
      ctx.patch?.(chips.material); chips.castShadow = true; chips.frustumCulled = false; chips.userData.noQA = true; chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage); sky.add(chips);
      const CB = [];
      for (let i = 0; i < NB; i++) {
        const s = tgt.scar[Math.floor(RA() * Math.max(1, tgt.scar.length * 0.8)) + Math.floor(tgt.scar.length * 0.2 * RA())] || tgt.scar[0];
        const out = vnorm([s[0] - tgt.x, 0, s[2] - tgt.z]), sp = 5 + RA() * 11;
        const v = [out[0] * sp + (RA() - 0.5) * 3, 1.5 + RA() * 5, out[2] * sp + (RA() - 0.5) * 3];
        const gl = G(s[0] + at[0] + v[0] * 1.2, s[2] + at[1] + v[2] * 1.2) - gy0;
        const tl = (v[1] + Math.sqrt(Math.max(0, v[1] * v[1] + 2 * 9.81 * (s[1] - gl)))) / 9.81;
        CB.push({ p: s, v, tl, gl, sp: [(RA() - 0.5) * 30, (RA() - 0.5) * 30, (RA() - 0.5) * 30], sc: (0.7 + RA() * 1.3) * clamp(tgt.hT / 10, 0.7, 1.5) });
      }
      const steamP = new Puffs(ctx, 90, { back: 0.8, dark: 0.35, name: 'lightning_smoke' }); sky.add(steamP.mesh);
      // the fire: a small blaze where the bolt entered the crown (flames licking up through the upper branches), a few
      // burning branches, the bark scar smouldering down the trunk, embers rising and falling; not a ring round the crown
      const fire = makeFire(ctx, { count: 24, hdr: 0.85, opacity: 0.5, name: 'lightning_crownfire', nudge: 0.35 }); sky.add(fire.mesh);
      const E = [tgt.x, tgt.top - gy0 - 0.25, tgt.z], szK = clamp(tgt.hT / 10, 0.7, 1.5);
      const FLM = [];
      for (let i = 0; i < 8; i++) {
        const a = RA() * TAU, r = Math.sqrt(RA()) * 0.8 * szK, dy = 0.2 + RA() * 1.5 * szK, big = RA();
        FLM.push({ p: [E[0] + Math.cos(a) * r, E[1] - dy, E[2] + Math.sin(a) * r], tig: 0.25 + Math.pow(RA(), 1.3) * 1.2 + dy * 0.25, h: (0.8 + 1.6 * big) * szK, w: (0.55 + 0.5 * big) * szK, ph: RA(), k: 0.6 + 0.4 * RA() });
      }
      const RB = rng(seed + 505), brL = [];
      for (let k = 0; k < 6; k++) {
        const a = RB() * TAU, L = (1.2 + RB() * 2) * szK;
        const ln = jag(RB, walkDir(RB, [E[0], E[1] - 0.2, E[2]], vnorm([Math.cos(a), -0.35 - RB() * 0.4, Math.sin(a)]), L, { step: 0.25 }), 0.25, 1);
        if (ln.length > 2) brL.push({ pts: ln, s: ln.map((_, q) => q / (ln.length - 1)), lvl: 1, w: 1, taper: 1 });
      }
      const brMat = stripMat({ col: [1.0, 0.3, 0.05], gain: 2.6, wk: 0.045 * szK, sharp: 2.0, minPx: 1.0 }), scMat = stripMat({ col: [1.0, 0.28, 0.04], gain: 1.6, wk: 0.05, sharp: 1.8, minPx: 1.0 });
      if (brL.length) stripMesh(sky, brL, brMat, 26);
      stripMesh(sky, [{ pts: tgt.scar, s: tgt.scar.map(() => 0.5), lvl: 0, w: 1 }], scMat, 26);
      const embers = makeGlowStreaks(ctx, { count: 70, minPx: 1.1, minK: 0.3, name: 'lightning_crownembers' }); sky.add(embers.mesh);
      const fireL = new THREE.PointLight(0xff6a22, 0, 0, 2); fireL.userData.fx = true; fireL.castShadow = false; fireL.position.set(E[0], E[1] - 0.6, E[2]); sky.add(fireL);
      const glowS = glowSprite([1.0, 0.45, 0.12], 3.5 * szK); glowS.position.set(E[0], E[1] - 0.5, E[2]); glowS.visible = false; sky.add(glowS);
      after = { tgt, sparks, SP, chips, CB, steam: steamP, fire, FLM, fireL, embers, E, brMat, scMat, glowS };
    }
  }

  const allRib = [];
  const collect = (o) => { if (o.material?.uniforms?.uPx) allRib.push(o.material); };
  root.traverse(collect); sky.traverse(collect);
  const Hpx = ctx.renderer?.domElement?.height || 1080;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _d = new THREE.Vector3();
  let ready = false;
  function prepare() {
    if (ready) return;
    const sl0 = slowNow();
    ready = sl0 != null;
    const sl = !!sl0;
    const LD = num(P.leader, sl ? 0.3 : 0.035);
    for (const s of strikes) {
      // each strike: slow when the world runs slowly at ITS time (a far strike after a speed ramp is real time)
      const sls = slowP === true || slowP === 'true' ? true : slowP === false || slowP === 'false' ? false : mode === 'storm' ? (clockRateAt(s.ts) ?? 1) < 0.7 : (s === strikes[0] ? sl : (clockRateAt(s.ts) ?? 1) < 0.7);
      s.slow = sls;
      s.tl = timeline(s.ts, s.Rt, { slow: sls, leader: num(P.leader, sls ? 0.3 : 0.035), strokes: P.strokes != null ? num(P.strokes, 3) : null });
    }
    if (!ready) return;
    if (fork && !(sl && mode === 'strike')) fork = null;
    if (fork) { fork.m1.visible = fork.m2.visible = true; fork.tl = timeline(fork.t0 + fork.lead, rng(seed + 17), { slow: true, leader: fork.lead, strokes: 2 }); }
  }
  // storm: intra-cloud flashes (own rng: the ground strikes keep their seeded places and times)
  const CF = [];
  if (mode === 'storm') {
    const n = Math.round(num(P.count, 6)), rad = num(P.radius, 900), RC = rng(seed + 999);
    const nF = Math.round(num(P.flashes, n * 1.6 + 2));
    for (let k = 0; k < nF; k++) {
      const a = RC() * TAU, d = rad * (0.3 + 1.1 * Math.sqrt(RC()));
      const t0 = 0.15 + (k + RC() * 0.8) * (dur - 0.4) / nF;
      const pulses = []; let tt = 0; const np = 2 + Math.floor(RC() * 3);
      for (let j = 0; j < np; j++) { pulses.push([tt, (0.45 + 0.55 * RC()) * (j === 0 ? 0.7 : 1)]); tt += 0.05 + RC() * 0.12; }
      const spr = glowSprite([0.7, 0.74, 1.0], Hc * (1.6 + RC() * 1.6)); sky.add(spr);
      CF.push({ t0, pulses, x: Math.cos(a) * d, z: Math.sin(a) * d, y: Hc * (0.85 + 0.4 * RC()), k: 0.35 + 0.55 * RC(), spr, tau: 0.035 + RC() * 0.05 });
    }
  }
  const skyW = new THREE.Vector3();
  function update(t, clock, camera) {
    prepare();
    if (camera) { const px = 2 * Math.tan(camera.fov * DEG / 2) / Hpx; for (const m of allRib) m.uniforms.uPx.value = px; }
    let flash = 0, fx = 0, fz = 0, fy = Hc, gl = 0, gx = 0, gz = 0, gy = 0;
    for (const s of strikes) {
      const st = s.tl(t);
      for (const m of [s.core, s.glow]) { const u = m.uniforms; u.uLead.value = st.lead; u.uStroke.value = st.stroke; u.uAfter.value = st.after; u.uBranch.value = st.branch; u.uCool.value = st.cool; u.uLeadGain.value = slow ? 0.42 : 0.3; }
      s.m1.visible = s.m2.visible = st.on;
      const f = st.stroke + st.after * 0.25 + (st.lead > 0 && st.lead < 1 ? 0.06 : 0);
      if (f > flash) { flash = f; fx = s.top[0]; fz = s.top[2]; fy = s.top[1]; gx = s.bot[0]; gz = s.bot[2]; gy = s.bot[1]; gl = f; }
      if (fork && fork.tl && s === strikes[0]) {
        const ft = fork.tl(t);
        for (const m of [fork.c, fork.g]) { const u = m.uniforms; u.uLead.value = ft.lead; u.uStroke.value = ft.stroke; u.uAfter.value = ft.after; u.uBranch.value = ft.branch; u.uCool.value = ft.cool; u.uLeadGain.value = 0.45; }
        fork.m1.visible = fork.m2.visible = ft.on || st.on;
        // the fork's strokes also light the channel above the fork point
        for (const m of [s.core, s.glow]) { m.uniforms.uUp.value = ft.lead >= 1 ? ft.stroke * 0.8 : 0; m.uniforms.uSFork.value = fork.sF; }
        const ff = ft.stroke + ft.after * 0.2;
        if (ff > flash) { flash = ff; gx = fork.gEnd[0]; gz = fork.gEnd[2]; gy = fork.gEnd[1]; gl = ff; }
      }
    }
    // cloud flashes (storm): the sky flickers from inside the clouds between the ground strikes
    let cfI = 0, cfx = 0, cfz = 0, cfy = Hc;
    for (const c of CF) {
      const x = t - c.t0; let v = 0;
      if (x > -0.01 && x < 1.2) for (const [dt, a] of c.pulses) { const y = x - dt; if (y >= -0.004) v += a * (y < 0 ? 1 + y / 0.004 : Math.exp(-y / c.tau)); }
      v *= c.k;
      c.spr.position.set(c.x, c.y, c.z); c.spr.material.color.setRGB(0.55 * v, 0.58 * v, 0.8 * v); c.spr.visible = v > 0.004;
      if (v > cfI) { cfI = v; cfx = c.x; cfz = c.z; cfy = c.y; }
    }
    const fk = man || figX ? 0.22 : 1;
    const lightI = Math.max(flash, cfI * 0.55);
    const lx = flash >= cfI * 0.55 ? fx : cfx, lz = flash >= cfI * 0.55 ? fz : cfz, ly = flash >= cfI * 0.55 ? fy : cfy;
    key.intensity = 6 * lightI * FL * fk; hemi.intensity = 1.5 * lightI * FL * fk;
    key.position.set(lx, ly, lz); key.target.position.set(flash >= cfI * 0.55 ? gx : cfx, 0, flash >= cfI * 0.55 ? gz : cfz);
    cloudGlow.position.set(fx, fy + 20, fz); cloudGlow.material.opacity = 1; cloudGlow.material.color.setRGB(0.55 * flash, 0.58 * flash, 0.8 * flash); cloudGlow.visible = flash > 0.003;
    groundGlow.position.set(gx, gy + (man ? 1.0 : 2), gz); groundGlow.material.color.setRGB(0.6 * gl, 0.64 * gl, 0.85 * gl); groundGlow.visible = gl > 0.003;
    pt.position.set(gx, gy + 4, gz);
    // a strike a few metres from the lens must flash the frame, not blow it out: the ground light scales with distance
    const camD = camera ? Math.hypot(sky.position.x + gx - camera.position.x, sky.position.z + gz - camera.position.z) : 100;
    const nearK = clamp(camD / 45, 0.18, 1);
    pt.intensity = mode === 'storm' ? 0 : (man || figX ? 40 : 1400 * nearK * nearK) * flash * FL;
    if (!man && !figX) { key.intensity *= 0.55 + 0.45 * nearK; hemi.intensity *= 0.45 + 0.55 * nearK; groundGlow.scale.setScalar(15 * (0.35 + 0.65 * nearK)); }
    // the sky flash
    if (camera) {
      dome.mesh.position.copy(camera.position); dome.mesh.scale.setScalar(Math.min(camera.far * 0.8, 20000)); dome.mesh.updateMatrixWorld();
      const dI = Math.max(flash * 0.9, cfI) * SKY;
      const wx = (flash >= cfI ? fx : cfx) + sky.position.x - camera.position.x, wy = (flash >= cfI ? fy : cfy) + sky.position.y - camera.position.y, wz = (flash >= cfI ? fz : cfz) + sky.position.z - camera.position.z;
      skyW.set(wx, wy, wz).normalize();
      dome.u.uDir.value.copy(skyW); dome.u.uI.value = 0.55 * dI;
      dome.mesh.visible = dI > 0.003;
    }
    if (gcur) { const st = strikes[0].tl(t); const v = st.x >= 0 ? st.stroke * Math.exp(-st.x / 0.12) : 0; for (const m of gcur) { m.uniforms.uStroke.value = v; m.uniforms.uLead.value = -1; m.uniforms.uAfter.value = 0; m.uniforms.uBranch.value = 1; } }
    if (side) { const st = strikes[0].tl(t); const v = st.x >= 0.005 ? st.stroke * Math.exp(-(st.x - 0.005) / 0.05) : 0; for (const m of side) { m.uniforms.uStroke.value = v; m.uniforms.uLead.value = -1; m.uniforms.uAfter.value = 0; } }
    if (after) updateAfter(t, camera);
    if (man || figX) updateFigure(t, camera);
  }

  function updateAfter(t, camera) {
    const A = after, x = t - tS, g = 9.81;
    A.sparks.begin();
    if (x > 0) for (const s of A.SP) {
      const tau = x - s.t0; if (tau < 0 || tau > s.life) continue;
      const pos = (tt) => { const k = 1.6, e = (1 - Math.exp(-k * tt)) / k; return [s.p[0] + s.v[0] * e, s.p[1] + s.v[1] * e - g / k * (tt - e), s.p[2] + s.v[2] * e]; };
      const b = pos(tau), a = pos(Math.max(0, tau - 1 / 60 * (slow ? 0.6 : 1)));
      const T = Math.exp(-tau / (s.life * 0.45)), fade = 1 - sstep(s.life * 0.7, s.life, tau);
      const r = (1.4 + 2.6 * T) * fade, gg = (0.25 + 2.2 * T * T) * fade, bb = (0.03 + 1.2 * T * T * T) * fade;
      A.sparks.push(a[0], a[1], a[2], b[0], b[1], b[2], r, gg, bb, s.w);
    }
    A.sparks.end(camera);
    for (let i = 0; i < A.CB.length; i++) {
      const c = A.CB[i];
      let px, py, pz, rx, ry, rz;
      if (x <= 0) { _s.setScalar(0); _m.compose(_p.set(0, -999, 0), _q.identity(), _s); A.chips.setMatrixAt(i, _m); continue; }
      const tt = Math.min(x, c.tl);
      px = c.p[0] + c.v[0] * tt; pz = c.p[2] + c.v[2] * tt; py = Math.max(c.gl + 0.02, c.p[1] + c.v[1] * tt - 0.5 * g * tt * tt);
      rx = c.sp[0] * tt; ry = c.sp[1] * tt; rz = c.sp[2] * tt;
      if (x >= c.tl) { rx = Math.round(rx / Math.PI) * Math.PI; rz = Math.round(rz / Math.PI) * Math.PI; }
      _e.set(rx, ry, rz); _q.setFromEuler(_e); _s.setScalar(c.sc); _m.compose(_p.set(px, py, pz), _q, _s); A.chips.setMatrixAt(i, _m);
    }
    A.chips.instanceMatrix.needsUpdate = true;
    // fire in the crown: ignites near the scar, grows, flickers; smoke above it
    A.fire.begin(t);
    let fsum = 0;
    for (const f of A.FLM) {
      const a = x - f.tig; if (a < 0) continue;
      const grow = sstep(0, 1.8, a), fl = 0.72 + 0.28 * Math.sin(t * (7 + f.ph * 5) + f.ph * 40) * Math.sin(t * 3.1 + f.ph * 9);
      const h = f.h * (0.4 + 0.6 * grow) * fl;
      A.fire.push(f.p[0], f.p[1], f.p[2], h, f.w * (0.7 + 0.3 * grow), f.ph, 0.75 * grow * f.k, 0.08 + 0.22 * grow * f.k, 0.35);
      fsum += grow;
    }
    const w = ctx.wind || { x: 0.5, z: 0 }, wl = Math.hypot(w.x, w.z) || 1;
    A.fire.end(camera, [w.x / wl, w.z / wl]);
    const fl2 = 0.8 + 0.2 * Math.sin(t * 11) * Math.sin(t * 4.3);
    A.fireL.intensity = 4 * Math.min(fsum, 8) * fl2;
    A.glowS.visible = fsum > 0.05; A.glowS.material.color.setRGB(0.5 * clamp(fsum / 6) * fl2, 0.2 * clamp(fsum / 6) * fl2, 0.05 * clamp(fsum / 6) * fl2);
    { const u = A.brMat.uniforms, v = x > 0.35 ? sstep(0.35, 1.2, x) * (0.65 + 0.35 * Math.sin(t * 9) * Math.sin(t * 2.7)) : 0; u.uStroke.value = v; u.uLead.value = -1; u.uAfter.value = 0; u.uBranch.value = 1; }
    { const u = A.scMat.uniforms, v = x > 0.1 ? 0.8 * sstep(0.1, 0.6, x) * Math.exp(-(x - 0.1) / 6) * (0.75 + 0.25 * Math.sin(t * 7 + 1)) : 0; u.uStroke.value = v; u.uLead.value = -1; u.uAfter.value = 0; u.uBranch.value = 1; }
    // embers lifting off the burning crown, drifting downwind
    A.embers.begin();
    const fk = clamp(fsum / 5);
    if (fk > 0.02) for (let i = 0; i < 70; i++) {
      const L = 1.6 + (i % 5) * 0.35, age = ((x + (i * 0.618) % 1 * L) % L + L) % L;
      const f0 = A.FLM[(i * 7) % A.FLM.length], falls = i % 2 === 1;
      // half lift off with the heat, half fall through the branches like burning bark flakes
      const pos = (ag) => falls ? [f0.p[0] + w.x * 0.15 * ag + Math.sin(ag * 3.1 + i) * 0.4, f0.p[1] - 1.6 * ag - 0.9 * ag * ag, f0.p[2] + w.z * 0.15 * ag + Math.cos(ag * 2.7 + i) * 0.4]
        : [f0.p[0] + w.x * 0.3 * ag * ag + Math.sin(ag * 2.3 + i) * 0.5, f0.p[1] + 0.8 + 2.4 * ag + 0.6 * Math.sin(ag * 1.7 + i * 0.3), f0.p[2] + w.z * 0.3 * ag * ag + Math.cos(ag * 2.1 + i) * 0.5];
      const b = pos(age), a = pos(Math.max(0, age - 0.08));
      const kk = fk * (1 - sstep(L * 0.6, L, age)) * (0.6 + 0.4 * Math.sin(t * 13 + i));
      A.embers.push(a[0], a[1], a[2], b[0], b[1], b[2], 3.0 * kk, 0.75 * kk, 0.1 * kk, 0.03);
    }
    A.embers.end(camera);
    // steam (white, first) then smoke (grey) rising and drifting downwind
    const T0 = A.tgt, N = 90;
    for (let i = 0; i < N; i++) {
      const L = 2.4 + (i % 7) * 0.25, ph = (i * 0.618) % 1;
      const age = ((x - ph * L) % L + L) % L, born = x - age;
      if (x <= 0 || born < 0.02) { A.steam.hide(i); continue; }
      const isSteam = born < 1.2;
      const src = isSteam ? T0.scar[Math.floor(((i * 37) % 100) / 100 * T0.scar.length)] : [A.E[0] + Math.sin(i * 2.3) * 0.6, A.E[1] - 0.3, A.E[2] + Math.cos(i * 1.7) * 0.6];
      const fireK = isSteam ? 1 : clamp(fsum / 4);
      const rise = (isSteam ? 1.3 : 2.4) * age + 0.4 * age * age;
      const dx = w.x * 0.35 * age * age * 0.5 + w.x * 0.2 * age, dz = w.z * 0.35 * age * age * 0.5 + w.z * 0.2 * age;
      const sk = clamp(T0.hT / 10, 0.8, 1.6);
      const sz = ((isSteam ? 1.2 : 1.8) + age * (isSteam ? 1.8 : 2.4)) * sk;
      const al = (isSteam ? 0.3 : 0.62 * fireK) * sstep(0, 0.35, age) * (1 - sstep(L * 0.55, L, age)) * (isSteam ? 1 - sstep(1.2, 3.5, x) : 1);
      const c = isSteam ? 0.92 : 0.34;
      A.steam.set(i, src[0] + dx, src[1] + rise + sz * 0.2, src[2] + dz, sz * (isSteam ? 1 : 0.8), al * (isSteam ? 1 : 0.75), i * 1.3 + age * 0.3, c, c * 0.95, c * (isSteam ? 1.02 : 0.88), i & 3, isSteam ? 0.85 : clamp(0.65 + 0.35 * age / L), isSteam ? 0.8 : 0.4);
    }
    A.steam.commit(camera);
  }

  function updateFigure(t, camera) {
    const st = strikes[0].tl(t), x = t - tS;
    const on = x >= 0 ? st.stroke : 0;
    const rev = clamp(x / revealT, 0, 1);
    for (const m of pathMats) { const u = m.uniforms; u.uLead.value = x >= 0 ? rev * 1.06 : -1; u.uLeadGain.value = on * 0.9; u.uStroke.value = 0; u.uAfter.value = 0; u.uBranch.value = 1; }
    // the flashover: 1-3 flickers with the strokes, 0.2-0.4 s
    const fo = x >= 0 ? on * (0.6 + 0.4 * Math.sin(t * 173) * Math.sin(t * 61)) : 0;
    for (const m of arcsM) { const u = m.uniforms; u.uLead.value = -1; u.uStroke.value = fo; u.uAfter.value = 0; u.uBranch.value = 1; }
    for (const m of bodyMats) m.emissiveIntensity = 0.9 * on * FL;
    // the fern: glows with the strokes, cools to embers over ~1.5 s, stays as a scorch
    { const u = fern.glow.uniforms; const emb = x > 0 ? 0.32 * Math.exp(-x / 0.55) : 0; u.uLead.value = -1; u.uStroke.value = on * 0.9; u.uAfter.value = emb; u.uBranch.value = 1; u.uCool.value = x > 0 ? sstep(0.05, 0.35, x) : 0; }
    fern.dark.uniforms.uAlpha.value = x > 0 ? 0.55 * sstep(0.05, 0.6, x) : 0;
    // the body: stiffens with the current, then slumps
    if (P.react !== false && figRig) {
      const stiff = x >= 0 ? sstep(0, 0.03, x) * (1 - sstep(0.25, 0.55, x)) : 0, slump = x > 0 ? sstep(0.35, 1.5, x) : 0;
      const p0 = figRig.pose0;
      const p = { ...p0 };
      const add = (k, v) => { p[k] = (p[k] ?? 0) + v; };
      add('headX', 0.22 * stiff + 0.42 * slump); add('chestX', -0.08 * stiff + 0.2 * slump); add('spineX', -0.05 * stiff + 0.1 * slump);
      if (!figRig.raised) { add('lArmZ', 0.32 * stiff - 0.04 * slump); add('rArmZ', -0.32 * stiff + 0.04 * slump); add('lElbow', -0.25 * stiff - 0.1 * slump); add('rElbow', -0.25 * stiff - 0.1 * slump); }
      else { add('rArmZ', 1.4 * slump); add('rElbow', -0.4 * slump); }
      p.lShape = p.rShape = stiff > 0.3 ? 'flat' : 'relaxed';
      man.pose(p);
    }
    // steam from the shoulders and the head
    const S = steam, N = 70;
    if (figX) { figX.root.updateMatrixWorld(true); S.src = S.bones.map(([b, dy]) => S.wp(b, dy)); }
    for (let i = 0; i < N; i++) {
      const L = 1.1 + (i % 5) * 0.15, ph = (i * 0.618) % 1;
      const age = ((x - 0.2 - ph * L) % L + L) % L, born = x - 0.2 - age;
      if (x < 0.2 || born < 0) { S.puffs.hide(i); continue; }
      const src = S.src[i % S.src.length];
      const k = Math.exp(-born / 1.6);
      const sz = 0.07 + age * 0.3, rise = 0.45 * age + 0.2 * age * age;
      const w = ctx.wind || { x: 0, z: 0 };
      S.puffs.set(i, src[0] + (Math.sin(i * 7.1) * 0.06) + w.x * 0.06 * age, src[1] + rise, src[2] + Math.cos(i * 3.3) * 0.06 + w.z * 0.06 * age, sz, 0.1 * k * sstep(0, 0.15, age) * (1 - sstep(L * 0.4, L, age)), i + age, 0.95, 0.96, 1.0, i & 3, 0.95, 0.8);
    }
    S.puffs.commit(camera);
  }

  update(0);
  // framing: the figure for through_figure, the whole bolt for a single strike, a wide patch of sky for a storm
  const rad = man ? 1.0 : 2, hgt = man ? 1.8 : 2;
  return { root, radius: rad, height: hgt, update, snapped: true, anchors: man ? { figure: man.group } : {}, footprint: [1, 1], contact: !!man };
}
