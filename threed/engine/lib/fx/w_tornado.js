// w_tornado.js — fx.tornado: an EF5 funnel moving along a path (v2, Q7 quality pass).
// The funnel is ONE opaque condensation shell (front faces, depth-written): a lumpy silhouette that turns with the flow,
// helical striations sweeping round it (>= 0.3 rev/s at the base of a rope/cone funnel), a soft ragged fresnel edge, a
// dirt-brown base fading into the debris cloud and a top merging into the slowly turning wall cloud. Shapes: 'rope' |
// 'cone' | 'wedge' (auto from width >= 450 m: a near-cylindrical black wall, low cloud base, rain curtains wrapping it).
// A billowing dust/debris cloud boils out of the ground ring (the shared billow puffs, dark where it wraps the funnel,
// lit on the sun side, torn as it climbs; Q4's shaping) with grit orbiting through it; debris orbits the funnel (planks,
// roof panels, bricks, glass glints, a tumbling car); the trees along the track are stripped as it passes.
// debris_events: bursts of one kind (boards | glass | bricks | car) flying past the camera at a world time (on a cue).
// sweep: a structure in the core is destroyed: the roof lifts off and flies, the walls peel away top-down into debris
// and dust, leaving the bare slab (t .. t_end). The root moves along the path. Every motion is a pure function of t.
import * as THREE from 'three';
import { prm, num, Puffs, lightsOf, stdMat, NOISE_GLSL, LOGV, LOGF, FOGF, FOG_U, carGeo, coniferGeo, plankGeo, sheetGeo, trunkGeo, rng, clamp, lerp, smooth, sstep, fbm1, vnoise, TAU, DEG } from './w_common.js';
import { curl3 } from './billow.js';
import { makeGrit, syncEnv } from './f_common.js';
import { makeGlowStreaks } from './glowkit.js';

export const CATALOG = {
  'fx.tornado': {
    desc: 'EF5 tornado: an opaque rotating condensation funnel (shape rope|cone|wedge; wedge = a dark rain-wrapped wall, auto from width >= 450 m) with a billowing debris cloud at the base, orbiting debris (planks, roof panels, bricks, glass, a tumbling car) and a wall cloud, moving from `at` along `heading` at `speed` (or along `path` [[x,z]..]); strips the trees it passes. debris_events [{t, kind: boards|glass|bricks|car}] fly past the camera at world time t; sweep {at, radius, t, t_end} destroys a structure (roof off, walls peeled, bare slab). Use a storm look (sky storm, grade cold).',
    actions: ['move'],
    params: { width: 160, cloud: 480, speed: 12, debris: 900, trees: 160, car: true, bend: 0.25, dust: 1.0, shape: 'auto', rain: 'auto', debris_events: [], sweep: null },
    doc: {
      width: 'm (funnel diameter near the ground; wedge 500-1200)', cloud: 'm cloud base', shape: '"auto" | "rope" | "cone" | "wedge"', rain: 'rain curtains 0..1 ("auto": wedge 1, else 0)',
      debris_events: '[{t: world s, kind: "boards"|"glass"|"bricks"|"car", n?: count, side?: -1|1 (from the left/right of the frame), dist?: m from the camera}]',
      sweep: '{at: [x, z] (the structure), radius: m (16), t: world s roof off, t_end: world s bare slab} or a list of them',
    },
    footprint: [160, 160], height: 820, tags: ['disaster', 'storm', 'wind', 'tornado', 'fx'], section: 'objects', contact: false,
  },
};

// ── the funnel: one opaque shell with a soft edge ──────────────────────────────────────────────────────────────────
function shellMat(ctx, o) {
  const u = {
    uT: { value: 0 }, uH: { value: o.H }, uOmega: { value: o.omega }, uBend: { value: new THREE.Vector3(o.bend, 0, 0) },
    uSun: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uLDir: { value: new THREE.Vector3(0, 1, 0) },
    uCol: { value: new THREE.Color(...o.col) }, uDirt: { value: new THREE.Color(...o.dirt) }, uSeed: { value: o.seed }, uLump: { value: o.lump ?? 0.14 }, uRag: { value: o.rag ?? 0 }, uBreath: { value: o.breath ?? 0.035 },
    uEdge: { value: o.edge ?? 0.3 }, uBase: { value: o.base ?? 0.06 }, uTop: { value: o.top ?? 0.93 }, uStri: { value: o.stri ?? 1 }, uFogK: { value: o.fogK ?? 0.55 }, ...FOG_U(),
  };
  return new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: true, side: THREE.FrontSide,
    vertexShader: LOGV + NOISE_GLSL + /* glsl */`
      uniform float uT, uH, uOmega, uSeed, uLump, uRag, uBreath; uniform vec3 uBend;
      varying vec3 vW; varying vec3 vN; varying float vH; varying float vA;
      vec2 axisOff(float h){ return uBend.x * uH * vec2(sin(h * 2.2 + uT * 0.11) * h * h, cos(h * 1.7 + uT * 0.07 + 1.0) * h * h * 0.6)
                                   + uH * 0.012 * vec2(sin(uT * 0.9 + h * 7.0), cos(uT * 0.7 + h * 5.0)) * (1.0 - h); }
      void main(){
        vec3 p = position; float h = clamp(p.y / uH, 0.0, 1.0);
        float ang = atan(p.z, p.x);
        float a = ang - uT * uOmega / (0.35 + 1.5 * h);                   // the flow turns faster low down
        float bump = fbm3l(vec3(cos(a) * 1.4, sin(a) * 1.4, h * 8.0 + uSeed)) - 0.5;
        float rag = fbm3l(vec3(cos(a) * 4.2, sin(a) * 4.2, h * 24.0 + uSeed * 1.7 - uT * 0.12)) - 0.5;   // ragged flanks
        float br = 1.0 + uLump * bump * (0.5 + 0.5 * h) + uRag * rag + uBreath * sin(h * 11.0 - uT * 1.4);
        p.xz *= br;
        vec2 o = axisOff(h); p.xz += o;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vW = wp.xyz; vH = h; vA = a;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGF + FOGF + NOISE_GLSL + /* glsl */`
      uniform float uT, uSeed, uEdge, uBase, uTop, uStri, uFogK, uRag; uniform vec3 uSun, uSky, uLDir, uCol, uDirt;
      varying vec3 vW; varying vec3 vN; varying float vH; varying float vA;
      void main(){
        #include <logdepthbuf_fragment>
        float h = vH, a = vA;
        // helical striations: long along the flow, thin across the height, slanting up the funnel
        float s1 = fbm3(vec3(cos(a + h * 2.5) * 1.25, sin(a + h * 2.5) * 1.25, h * 46.0 + uSeed));        // long thin streaks along the flow
        float s2 = fbm3(vec3(cos(a * 1.0 + h * 5.0) * 4.5, sin(a + h * 5.0) * 4.5, h * 70.0 + uSeed * 2.3));
        float stri = mix(0.5, s1 * 0.62 + s2 * 0.38, uStri);
        vec3 V = normalize(vW - cameraPosition), N = normalize(vN);
        float ndv = abs(dot(N, -V));
        float en = fbm3(vec3(cos(a) * 3.2 * (1.0 + uRag * 8.0), sin(a) * 3.2 * (1.0 + uRag * 8.0), h * (16.0 + uRag * 260.0) + uSeed + 5.0));
        float al = smoothstep(0.015, uEdge * (0.55 + 0.9 * en), ndv);                  // opaque body, ragged soft edge
        al *= smoothstep(0.0, uBase, h + (en - 0.5) * 0.03) * (1.0 - smoothstep(uTop, 1.0, h));
        if (al < 0.01) discard;
        float wrap = clamp(dot(N, uLDir) * 0.5 + 0.5, 0.0, 1.0);
        vec3 base = mix(uDirt, uCol, smoothstep(0.0, 0.28, h)) * (0.36 + 1.15 * stri);                     // contrast: the turning reads
        float rim = pow(1.0 - ndv, 2.0);
        vec3 col = base * (uSky * (0.62 + 0.22 * N.y) + uSun * (0.42 * wrap * wrap + 0.25 * rim));
        col = mix(col, applyFog(col, vW), uFogK);
        gl_FragColor = vec4(col, al);
      }`,
  });
}
// rain curtains round a wedge: translucent streaked sheets falling fast, wrapped round most of the circumference
function rainMat(ctx, o) {
  const u = { uT: { value: 0 }, uH: { value: o.H }, uSun: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uOp: { value: o.op }, uSeed: { value: o.seed }, ...FOG_U() };
  return new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: LOGV + /* glsl */`uniform float uH; varying vec3 vW; varying vec2 vP;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vP = vec2(atan(position.z, position.x), position.y / uH);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGF + FOGF + NOISE_GLSL + /* glsl */`uniform float uT, uOp, uSeed; uniform vec3 uSun, uSky; varying vec3 vW; varying vec2 vP;
      void main(){
        #include <logdepthbuf_fragment>
        float a = vP.x, h = vP.y;
        float shafts = fbm3(vec3(cos(a) * 2.2, sin(a) * 2.2, uSeed + uT * 0.04 + h * 0.9));
        float streak = fbm3(vec3(cos(a) * 9.0, sin(a) * 9.0, h * 1.5 + uT * 1.2 + uSeed));
        float wrapK = smoothstep(-0.3, 0.6, sin(a + uSeed) + 0.25);
        float al = uOp * wrapK * smoothstep(0.25, 0.75, shafts) * (0.85 + 0.15 * streak) * smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.25, 0.8, h));
        if (al < 0.004) discard;
        vec3 col = vec3(0.2, 0.21, 0.23) * (uSky * 0.85 + uSun * 0.1);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, al);
      }`,
  });
}
// the old layered volume material (kept for the wall cloud)
function funnelMat(ctx, o) {
  const u = {
    uT: { value: 0 }, uH: { value: o.H }, uOmega: { value: o.omega }, uOp: { value: o.op }, uBend: { value: new THREE.Vector3(o.bend, 0, 0) },
    uSun: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uLDir: { value: new THREE.Vector3(0, 1, 0) },
    uCol: { value: new THREE.Color(...o.col) }, uDirt: { value: new THREE.Color(...o.dirt) }, uSeed: { value: o.seed }, uFreq: { value: o.freq ?? 1 }, uFade: { value: o.fade ?? 1 }, uRim: { value: o.rim ?? 1e6 }, uRim0: { value: o.rim0 ?? 0.45 }, ...FOG_U(),
  };
  return new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: !!o.depthWrite, side: THREE.DoubleSide,
    vertexShader: LOGV + /* glsl */`
      uniform float uT, uH; uniform vec3 uBend;
      varying vec3 vL; varying vec3 vW; varying vec3 vN; varying float vH;
      void main(){
        vec3 p = position; float h = clamp(p.y / uH, 0.0, 1.0);
        vL = vec3(p.x, h, p.z);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vW = wp.xyz; vH = h;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGF + FOGF + NOISE_GLSL + /* glsl */`
      uniform float uT, uOmega, uOp, uSeed, uFreq, uFade, uRim, uRim0; uniform vec3 uSun, uSky, uLDir, uCol, uDirt;
      varying vec3 vL; varying vec3 vW; varying vec3 vN; varying float vH;
      void main(){
        #include <logdepthbuf_fragment>
        float ang = atan(vL.z, vL.x), a = ang - uT * uOmega;
        float r = length(vL.xz);
        float n = fbm3(vec3(cos(a) * 1.8 * (1.0 + r * 0.004), sin(a) * 1.8 * (1.0 + r * 0.004), r * 0.01 + uSeed));
        float al = clamp(uOp * (0.55 + 0.6 * n), 0.0, 1.0) * (1.0 - smoothstep(uRim * (uRim0 + 0.3 * n), uRim, r));
        if (al < 0.004) discard;
        vec3 N = normalize(vN);
        float wrap = clamp(dot(N, uLDir) * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = uCol * (0.7 + 0.5 * n) * (uSky * 0.7 + uSun * 0.3 * wrap);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, al);
      }`,
  });
}
// glass shards: glint when the sky/sun mirrors in them
function glassMat(ctx) {
  const m = new THREE.MeshStandardMaterial({ color: 0x1c262c, roughness: 0.04, metalness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.42, depthWrite: false });
  return ctx.patch ? ctx.patch(m) : m;
}
let BRICK = null;
const brickGeo = () => BRICK || (BRICK = new THREE.BoxGeometry(0.23, 0.075, 0.11));
let SHARD = null;
// an irregular thin sliver ~0.2 m long (a fan over 5 uneven corners), scaled 0.4-1.5 per piece -> 8-30 cm
const shardGeo = () => { if (SHARD) return SHARD; const c = [[0, 0], [-0.11, -0.02], [-0.04, -0.035], [0.09, -0.012], [0.12, 0.026], [-0.02, 0.04]]; const P = []; for (let k = 1; k < c.length - 1; k++) P.push(c[0][0], c[0][1], 0, c[k][0], c[k][1], 0, c[k + 1][0], c[k + 1][1], 0); P.push(c[0][0], c[0][1], 0, c[c.length - 1][0], c[c.length - 1][1], 0, c[1][0], c[1][1], 0); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return (SHARD = g); };

export async function build(kind, item, ctx) {
  const P = prm(item);
  const R0 = num(P.width, 160) / 2, V = num(P.speed, 12);
  const shapeP = P.shape ?? P.style;                                        // `style` accepted as an alias
  const shape = shapeP && shapeP !== 'auto' ? shapeP : (R0 * 2 >= 450 ? 'wedge' : 'cone');
  const wedge = shape === 'wedge';
  const H = num(P.cloud, wedge ? 520 : 820);
  const at = item.at || [0, 0];
  const hd = (item.heading ?? 0) * DEG, dir = [Math.sin(hd), -Math.cos(hd)];
  const G = ctx.ground.height;
  const dur = ctx.dur ?? 10;
  // the track: a polyline (constant speed) or a straight line from `at`
  let pts = Array.isArray(P.path) && P.path.length >= 2 ? P.path.map((p) => [+p[0], +p[1]]) : null;
  const seg = [];
  if (pts) { let L = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push([L, d]); L += d; } }
  const track = (t) => {
    if (!pts) return [at[0] + dir[0] * V * t, at[1] + dir[1] * V * t];
    let s = clamp(V * t, 0, seg[seg.length - 1][0] + seg[seg.length - 1][1]);
    for (let i = 0; i < seg.length; i++) if (s <= seg[i][0] + seg[i][1] || i === seg.length - 1) { const k = clamp((s - seg[i][0]) / seg[i][1]); return [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)]; }
    return pts[0];
  };
  const root = new THREE.Group(); root.name = 'fx.tornado';
  const c0 = track(0); root.position.set(c0[0], G(c0[0], c0[1]), c0[1]);
  const statics = new THREE.Group(); statics.name = 'fx.tornado.track'; ctx.scene.add(statics);
  const L = lightsOf(ctx);
  const seedN = (item.seed ?? 3) % 17;

  // ── the funnel shell (lathe profile: rope/cone narrow at the ground flaring into the wall cloud; wedge ~ a cylinder)
  const prof = (n = 120) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const h = i / n;
      let r;
      if (wedge) r = R0 * (1.12 - 0.27 * Math.pow(h, 1.15)) + R0 * 0.1 * Math.exp(-h * 16);        // monotone: 1.22 R0 at the ground -> 0.85 R0 at the base
      else if (shape === 'rope') r = R0 * (0.35 + 0.25 * h + 3.2 * Math.pow(h, 5)) + R0 * 0.25 * Math.exp(-h * 18);
      else r = R0 * 0.62 + (R0 * 2.7 - R0 * 0.62) * Math.pow(h, 1.7) + R0 * 0.62 * 0.25 * Math.exp(-h * 18);
      out.push(new THREE.Vector2(Math.max(0.5, r), h * H));
    }
    return out;
  };
  const vSurf = wedge ? 70 : 105;                                              // m/s at the surface low down
  const omega = vSurf / Math.max(20, R0 * (wedge ? 0.95 : 0.62)) * 0.35;
  const shellGeo = new THREE.LatheGeometry(prof(), wedge ? 160 : 120);
  const shell = shellMat(ctx, { H, omega, bend: wedge ? num(P.bend, 0.25) * 0.3 : num(P.bend, 0.25), col: wedge ? [0.085, 0.09, 0.095] : [0.24, 0.24, 0.245], dirt: wedge ? [0.08, 0.07, 0.06] : [0.22, 0.18, 0.14], seed: seedN, lump: wedge ? 0.035 : 0.14, rag: wedge ? 0.07 : 0, breath: wedge ? 0 : 0.035, edge: wedge ? 0.36 : 0.32, base: wedge ? 0.03 : 0.06, top: wedge ? 0.72 : 0.93 });
  const mats = [shell];
  const fm = new THREE.Mesh(shellGeo, shell); fm.frustumCulled = false; fm.userData.noQA = true; fm.renderOrder = 14; fm.name = 'funnel'; root.add(fm);
  // ── wall cloud: a broad, slowly turning lowered disk under the storm base
  const WCR = wedge ? R0 * 1.1 : R0 * 14;
  const wcGeo = new THREE.CircleGeometry(WCR, 96, 0, TAU); wcGeo.rotateX(Math.PI / 2);
  { const p = wcGeo.attributes.position; for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)) / WCR; p.setY(i, H * (wedge ? 0.82 : 0.93) + (wedge ? H * 0.12 : 90) * r * r - (wedge ? 20 : 70) * Math.exp(-r * r * 30)); } wcGeo.computeVertexNormals(); }
  const wcMat = funnelMat(ctx, { H, omega: 0.06, op: wedge ? 0.55 : 1.25, bend: 0, col: wedge ? [0.1, 0.105, 0.11] : [0.15, 0.16, 0.17], dirt: [0.15, 0.16, 0.17], seed: seedN + 9, depthWrite: false, freq: 0.3, fade: 0, rim: WCR, rim0: wedge ? 0.3 : 0.45 });
  const wc = new THREE.Mesh(wcGeo, wcMat); wc.frustumCulled = false; wc.userData.noQA = true; wc.renderOrder = 9; root.add(wc); mats.push(wcMat);
  // ── rain curtains (wedge)
  const rainK = P.rain === 'auto' || P.rain == null ? (wedge ? 1 : 0) : clamp(num(P.rain, 0), 0, 1);
  if (rainK > 0) {
    for (const [rf, op, sd] of [[1.45, 0.5, 1.3], [2.1, 0.4, 4.1]]) {
      const g = new THREE.LatheGeometry([0, 0.25, 0.5, 0.75, 1].map((h) => new THREE.Vector2(R0 * rf * (1.05 - 0.2 * h), h * H * 0.95)), 96);
      const m = rainMat(ctx, { H: H * 0.95, op: op * rainK, seed: seedN + sd });
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.userData.noQA = true; mesh.renderOrder = 15; root.add(mesh); mats.push(m);
    }
  }

  // ── dust skirt + debris cloud at the base (Q4's shaping): billows boiling out of the ground ring and whirled round,
  // each with a smaller one on its outer rim, dark where it wraps the funnel and away from the sun, torn as it climbs
  const ND = Math.round(900 * clamp(num(P.dust, 1), 0, 2));
  const dust = new Puffs(ctx, ND * 2, { back: 0.5, dark: 0.55, name: 'tornado_dust', wisp: 0.2, softK: 0.25 }); root.add(dust.mesh);
  const r1 = rng(4711), DP = [];
  const skirtK = wedge ? 1.25 : 1;
  for (let i = 0; i < ND; i++) DP.push({ r: R0 * (0.55 + Math.pow(r1(), 0.8) * 1.6) * (wedge ? 0.62 : 1), a0: r1() * TAU, ph: r1(), life: 3 + r1() * 4, rise: 25 + Math.pow(r1(), 1.5) * 130, sz: 0.6 + r1() * 1.0, at: Math.floor(r1() * 4), shade: 0.7 + r1() * 0.4, ka: (r1() - 0.5) * 1.2, ku: r1() });
  const NG = Math.round(700 * clamp(num(P.dust, 1), 0, 2));
  const grit = makeGrit(ctx, { count: NG, maxPx: 4.5, minPx: 1.3 }); root.add(grit.mesh);
  const CU = [0, 0, 0];
  function updateDust(t, camera) {
    const Ld = L(), sx = Ld.dir.x, sy = Ld.dir.y, sz0 = Ld.dir.z;
    for (let i = 0; i < ND; i++) {
      const p = DP[i], age = ((t / p.life + p.ph) % 1 + 1) % 1;
      const r = p.r * (0.85 + 0.5 * age);
      const w = 55 / r;
      const a = p.a0 + t * w * 0.35 + age * 1.4;
      let x = Math.cos(a) * r, z = Math.sin(a) * r;
      let y = 4 + p.rise * age * (0.6 + 0.8 * (1 - r / (R0 * 3))) * (wedge ? 0.45 : 1) + 3 * Math.sin(a * 2 + p.ph * 9);
      const sz = (14 + 38 * age) * p.sz * (R0 / 80) * (wedge ? 0.36 : 1) * skirtK;
      curl3(x / 60 + t * 0.15, y / 60, z / 60, 17, CU);
      x += CU[0] * sz * 0.2; y += CU[1] * sz * 0.12; z += CU[2] * sz * 0.2;
      const al = sstep(0, 0.18, age) * (1 - sstep(0.55, 1, age)) * 0.8;
      const rl = Math.hypot(x, z) || 1, out = (x * sx + z * sz0) / rl * 0.8 + sy * 0.6;
      const occ = clamp((0.1 + 0.6 * sstep(-0.5, 0.7, out) + 0.15 * clamp(y / 120)) * (0.6 + 0.4 * sstep(R0 * 0.6, R0 * 1.5, r)));
      const wisp = clamp(0.1 + 0.75 * age * age + 0.2 * clamp(y / 150));
      const sh = p.shade * (wedge ? 0.75 : 1);
      dust.set(i, x, y + sz * 0.3, z, sz, al, a * 0.5, 0.3 * sh, 0.25 * sh, 0.19 * sh, p.at, wisp, occ);
      const ka = a + p.ka * 0.5, ce = 0.4 + 0.5 * p.ku, d = sz * 0.3;
      dust.set(ND + i, x + Math.cos(ka) * ce * d, y + sz * 0.3 + (1 - ce) * d * 1.4, z + Math.sin(ka) * ce * d, sz * (0.42 + 0.14 * p.ku), al * 0.95, a * 0.7 + p.ph * 6,
        0.32 * sh, 0.27 * sh, 0.2 * sh, (p.at + 1) & 3, clamp(wisp + 0.05), clamp(occ + 0.1));
    }
    dust.commit(camera);
    syncEnv(ctx);
    grit.begin();
    for (let i = 0; i < NG; i++) {
      const T = 5 + 7 * ((i * 0.7548776662) % 1), f = ((t / T + (i * 0.5698402909) % 1) % 1 + 1) % 1;
      const r0 = R0 * (0.6 + 1.9 * ((i * 0.3183) % 1)), r = r0 * (1 + 0.8 * f);
      const y = 2 + (20 + 200 * ((i * 0.1234567) % 1)) * Math.sin(f * Math.PI) * (1 - 0.3 * f);
      const a = ((i * 2.399963) % TAU) + t * (58 / r) * 0.6;
      const k = sstep(0, 0.1, f) * (1 - sstep(0.85, 1, f)), c = 0.07 + 0.08 * ((i * 0.618) % 1);
      if (k > 0.02) grit.push(Math.cos(a) * r, y, Math.sin(a) * r, c, c * 0.92, c * 0.85, (0.25 + 0.9 * ((i * 0.4142) % 1)) * k);
    }
    grit.end();
  }

  // ── orbiting debris: planks and roof sheets (instanced; the same draws as v1), bricks + glass shards, one car
  const NB = Math.round(num(P.debris, 520));
  const woodMat = stdMat(ctx, { color: 0x6a5238, roughness: 0.9 }), tinMat = stdMat(ctx, { color: 0x8d9093, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide });
  const brickMat = stdMat(ctx, { color: 0x8a3b28, roughness: 0.9 }), gMat = glassMat(ctx);
  const planks = new THREE.InstancedMesh(plankGeo(), woodMat, NB), sheets = new THREE.InstancedMesh(sheetGeo(), tinMat, NB);
  for (const m of [planks, sheets]) { m.frustumCulled = false; m.userData.noQA = true; m.castShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
  const r2 = rng(99), BP = [];
  for (let i = 0; i < NB; i++) BP.push({ sheet: r2() < 0.35, r: R0 * (0.7 + Math.pow(r2(), 1.3) * 2.2), a0: r2() * TAU, ph: r2(), T: 7 + r2() * 9, ymax: 40 + Math.pow(r2(), 1.5) * 380, spin: [r2() - 0.5, r2() - 0.5, r2() - 0.5], sc: 1.6 + r2() * 2.6 });
  const NX = Math.round(NB * 0.35), rX = rng(1234), XP = [];
  for (let i = 0; i < NX; i++) { const g = rX() < 0.45; XP.push({ glass: g, r: R0 * (0.7 + Math.pow(rX(), 1.2) * 1.8), a0: rX() * TAU, ph: rX(), T: 5 + rX() * 7, ymax: 20 + Math.pow(rX(), 1.6) * 220, spin: [rX() - 0.5, rX() - 0.5, rX() - 0.5].map((v) => v * (g ? 3 : 1)), sc: g ? 1.0 + rX() * 1.5 : 2.5 + rX() * 3 }); }
  const bricks = new THREE.InstancedMesh(brickGeo(), brickMat, Math.max(1, NX)), shards = new THREE.InstancedMesh(shardGeo(), gMat, Math.max(1, NX));
  for (const m of [bricks, shards]) { m.frustumCulled = false; m.userData.noQA = true; m.castShadow = m === bricks; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  // debris is drawn oversized for readability far away; near the lens it shrinks to real sizes (planks <= ~4 m)
  let camP = null;
  const nearK = (x, y, z, sc, k0, kd) => { if (!camP) return sc; const d = Math.hypot(root.position.x + x - camP.x, root.position.y + y - camP.y, root.position.z + z - camP.z); return Math.min(sc, k0 + d / kd); };
  function updateDebris(t) {
    let np = 0, ns = 0;
    for (let i = 0; i < NB; i++) {
      const b = BP[i];
      const f = ((t / b.T + b.ph) % 1 + 1) % 1;
      const y = 3 + b.ymax * Math.pow(f, 0.8);
      const hN = y / H;
      const rr = b.r * (1 + 1.8 * hN) * (0.9 + 0.2 * Math.sin(f * 9 + b.ph * 7));
      const a = b.a0 + t * (62 / rr) * 0.55;
      _p.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
      _e.set(b.spin[0] * t * 5 + b.ph * 9, b.spin[1] * t * 4, b.spin[2] * t * 6); _q.setFromEuler(_e);
      const vis = sstep(0, 0.08, f) * (1 - sstep(0.88, 1, f));
      _s.setScalar(nearK(_p.x, _p.y, _p.z, b.sc, 0.9, 40) * vis); _m.compose(_p, _q, _s);
      if (b.sheet) sheets.setMatrixAt(ns++, _m); else planks.setMatrixAt(np++, _m);
    }
    planks.count = np; sheets.count = ns; planks.instanceMatrix.needsUpdate = sheets.instanceMatrix.needsUpdate = true;
    let nb = 0, ng = 0;
    for (let i = 0; i < NX; i++) {
      const b = XP[i];
      const f = ((t / b.T + b.ph) % 1 + 1) % 1;
      const y = 2 + b.ymax * Math.pow(f, 0.9);
      const rr = b.r * (1 + 1.4 * y / H) * (0.9 + 0.2 * Math.sin(f * 7 + b.ph * 5));
      const a = b.a0 + t * (66 / rr) * 0.6;
      _p.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
      _e.set(b.spin[0] * t * 9 + b.ph * 5, b.spin[1] * t * 7, b.spin[2] * t * 11); _q.setFromEuler(_e);
      _s.setScalar(nearK(_p.x, _p.y, _p.z, b.sc, b.glass ? 0.8 : 1.5, 30) * sstep(0, 0.08, f) * (1 - sstep(0.85, 1, f))); _m.compose(_p, _q, _s);
      if (b.glass) shards.setMatrixAt(ng++, _m); else bricks.setMatrixAt(nb++, _m);
    }
    bricks.count = nb; shards.count = ng; bricks.instanceMatrix.needsUpdate = shards.instanceMatrix.needsUpdate = true;
  }
  let car = null;
  const carMat = stdMat(ctx, { color: 0x7a2420, roughness: 0.4, metalness: 0.45, vertexColors: true });
  if (P.car !== false) { car = new THREE.Mesh(carGeo(), carMat); car.castShadow = true; car.userData.noQA = true; root.add(car); }
  function updateCar(t) {
    if (!car) return;
    const rr = R0 * 1.25, a = 0.8 + t * (55 / rr) * 0.5, y = 26 + 18 * Math.sin(t * 0.35) + 6 * Math.sin(t * 1.1);
    car.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
    car.rotation.set(t * 1.1, t * 0.7 + a, t * 0.45);
  }

  // ── debris events: one kind flying past the camera on a cue (camera-relative flight paths, world-time clock)
  const EV = (Array.isArray(P.debris_events) ? P.debris_events : []).map((e, k) => ({ t: num(e.t, 0), kind: String(e.kind || 'boards'), n: e.n, side: num(e.side, k % 2 ? 1 : -1), dist: num(e.dist, 0), k }));
  const evRoot = new THREE.Group(); evRoot.name = 'fx.tornado.events'; ctx.scene.add(evRoot);
  const evMeshes = [];
  for (const ev of EV) {
    const kind = ev.kind === 'glass' ? 'glass' : ev.kind === 'bricks' || ev.kind === 'brick' ? 'bricks' : ev.kind === 'car' || ev.kind === 'cars' ? 'car' : ev.kind === 'sheets' || ev.kind === 'roof' ? 'sheets' : 'boards';
    const n = Math.round(num(ev.n, { boards: 16, glass: 26, bricks: 26, car: 1, sheets: 10 }[kind]));
    const geo = kind === 'glass' ? shardGeo() : kind === 'bricks' ? brickGeo() : kind === 'car' ? carGeo() : kind === 'sheets' ? sheetGeo() : plankGeo();
    const mat = kind === 'glass' ? gMat : kind === 'bricks' ? brickMat : kind === 'car' ? stdMat(ctx, { color: 0xd8d4cc, roughness: 0.35, metalness: 0.5, vertexColors: true }) : kind === 'sheets' ? tinMat : woodMat;
    const im = new THREE.InstancedMesh(geo, mat, n); im.frustumCulled = false; im.userData.noQA = true; im.castShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.count = 0; evRoot.add(im);
    const RE = rng(777 + ev.k * 31), pcs = [];
    for (let i = 0; i < n; i++) pcs.push({ dt: RE() * (kind === 'car' ? 0 : 0.35), x0: RE(), y0: RE(), z0: RE(), sp: [(RE() - 0.5) * 14, (RE() - 0.5) * 12, (RE() - 0.5) * 14].map((v) => v * (kind === 'glass' ? 3 : 1)), sc: kind === 'car' ? 1 : kind === 'glass' ? 0.45 + RE() * 1.05 : kind === 'bricks' ? 2.2 + RE() * 2.2 : 0.8 + RE() * 0.6, u: RE() });
    evMeshes.push({ ev, kind, im, pcs });
  }
  const _cr = new THREE.Vector3(), _cu = new THREE.Vector3(), _cb = new THREE.Vector3(), _n = new THREE.Vector3(), _h = new THREE.Vector3(), _v = new THREE.Vector3();
  const hasGlass = evMeshes.some((E) => E.kind === 'glass');
  const glints = hasGlass ? makeGlowStreaks(ctx, { count: 200, minPx: 1.6, minK: 0.6, name: 'tornado_glints' }) : null;
  if (glints) evRoot.add(glints.mesh);
  function updateEvents(t, camera) {
    if (!evMeshes.length || !camera) return;
    if (glints) glints.begin();
    const Ld = L();
    camera.matrixWorld.extractBasis(_cr, _cu, _cb);                      // right, up, back
    const cp = camera.position, tanH = Math.tan((camera.fov || 40) * DEG / 2), asp = camera.aspect || 16 / 9;
    for (const E of evMeshes) {
      const { ev, kind, im, pcs } = E;
      let n = 0;
      const D = ev.dist || (kind === 'car' ? 38 : kind === 'bricks' || kind === 'glass' ? 16 : 22);
      const Tfly = kind === 'car' ? 0.95 : 0.7;
      for (let i = 0; i < pcs.length; i++) {
        const pc = pcs[i], x = t - ev.t - pc.dt;
        if (x < 0 || x > Tfly) continue;
        const f = x / Tfly;
        // enters from one side of the frame (slightly behind the subject), crosses it and leaves past the camera
        const d = D * (1.25 - 0.55 * f) * (0.8 + 0.4 * pc.z0);
        const halfW = d * tanH * asp, halfH = d * tanH;
        const sx = ev.side * lerp(1.25, -1.35, f) * halfW + (pc.x0 - 0.5) * halfW * 0.5;
        const sy = lerp(0.35 + 0.5 * pc.y0, -0.1 - 0.5 * pc.y0, f * f) * halfH + (kind === 'car' ? 0.1 * halfH : 0);
        _p.copy(cp).addScaledVector(_cr, sx).addScaledVector(_cu, sy).addScaledVector(_cb, -d);
        _e.set(pc.sp[0] * x + pc.u * 6, pc.sp[1] * x, pc.sp[2] * x); _q.setFromEuler(_e);
        _s.setScalar(pc.sc * sstep(0, 0.06, f) * (1 - sstep(0.94, 1, f)) + 1e-4);
        _m.compose(_p, _q, _s); im.setMatrixAt(n++, _m);
        if (glints && kind === 'glass') {
          // a mirror flash when the shard's face turns the sky/sun light into the lens (half-vector test)
          _n.set(0, 0, 1).applyQuaternion(_q); _v.copy(cp).sub(_p).normalize(); _h.copy(_v).add(Ld.dir).normalize();
          const sp = Math.pow(Math.abs(_n.dot(_h)), 55), sk = Math.pow(Math.abs(_n.dot(_v)), 30) * 0.25;
          const g = (sp * 9 + sk * 2) * sstep(0, 0.06, f) * (1 - sstep(0.9, 1, f));
          if (g > 0.08) glints.push(_p.x, _p.y, _p.z, _p.x + 0.01, _p.y + 0.01, _p.z, g * 1.0, g * 1.02, g * 1.08, 0.04 * pc.sc);
        }
      }
      im.count = n; im.instanceMatrix.needsUpdate = true;
    }
    if (glints) glints.end(camera);
  }

  // ── trees along the track: stripped (canopy torn away, trunk snapped over) as the funnel passes
  const NT = Math.round(num(P.trees, 160));
  const trunks = new THREE.InstancedMesh(trunkGeo(), stdMat(ctx, { color: 0x4d3e30, roughness: 0.9 }), NT);
  const crowns = new THREE.InstancedMesh(coniferGeo(), stdMat(ctx, { color: 0xffffff, roughness: 0.92, vertexColors: true }), NT);   // Q2: smooth-shaded, Q2's spruce vertex colours
  for (const m of [trunks, crowns]) { m.castShadow = true; m.receiveShadow = true; m.userData.noQA = true; m.frustumCulled = false; statics.add(m); }
  const r3 = rng(2024), TR = [];
  const span = V * Math.max(ctx.dur ?? 12, 12) * 1.3;
  for (let i = 0; i < NT; i++) {
    const along = -span * 0.2 + r3() * span * 1.1, side = (r3() - 0.5) * R0 * 7;
    const tc = along / V, c = track(tc), c2 = track(tc + 0.5), dx = c2[0] - c[0], dz = c2[1] - c[1], dl = Math.hypot(dx, dz) || 1;
    const x = c[0] + (-dz / dl) * side, z = c[1] + (dx / dl) * side;
    TR.push({ x, z, y: G(x, z), h: 8 + r3() * 9, tc, d: Math.abs(side), yaw: r3() * TAU, fall: r3() });
  }
  function updateTrees(t) {
    for (let i = 0; i < NT; i++) {
      const tr = TR[i];
      const sev = sstep(R0 * 3.2, R0 * 1.1, tr.d);
      const k = sev * sstep(tr.tc - 1.5, tr.tc + 0.8, t);
      const lean = k * (0.4 + 1.0 * tr.fall * sev);
      _p.set(tr.x, tr.y, tr.z);
      _e.set(lean * Math.cos(tr.yaw), tr.yaw, lean * Math.sin(tr.yaw)); _q.setFromEuler(_e);
      _s.set(tr.h * 1.0, tr.h * (1 - 0.35 * k * tr.fall), tr.h); _m.compose(_p, _q, _s); trunks.setMatrixAt(i, _m);
      const cs = 1 - sstep(0.15, 0.7, k);
      _s.set(tr.h * cs, tr.h * Math.max(cs, 0.001), tr.h * cs); _m.compose(_p, _q, _s); crowns.setMatrixAt(i, _m);
    }
    trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
  }

  // ── sweep: a structure standing in the core is torn apart (resolved at the first frame: the structures exist then)
  const SW = (Array.isArray(P.sweep) ? P.sweep : P.sweep ? [P.sweep] : []).map((s) => ({ at: Array.isArray(s.at) ? [+s.at[0], +s.at[s.at.length === 3 ? 2 : 1]] : null, target: typeof s.target === 'string' ? s.target : null, r: num(s.radius, 16), t: num(s.t, 0), t1: num(s.t_end ?? s.clean ?? s.bare, num(s.t, 0) + 2.64), parts: null }));
  const swRoot = new THREE.Group(); swRoot.name = 'fx.tornado.sweep'; ctx.scene.add(swRoot);
  const chunkN = 260;
  const chunks = SW.length ? new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stdMat(ctx, { color: 0xffffff, roughness: 0.9 }), chunkN * SW.length) : null;
  if (chunks) { chunks.frustumCulled = false; chunks.userData.noQA = true; chunks.castShadow = true; chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); chunks.count = 0; swRoot.add(chunks); }
  const swDust = SW.length ? new Puffs(ctx, 140 * SW.length, { back: 0.5, dark: 0.55, name: 'tornado_sweep_dust', wisp: 0.4, softK: 0.3 }) : null;
  if (swDust) swRoot.add(swDust.mesh);
  const skipRoots = new Set([root, statics, evRoot, swRoot]);
  function resolveSweep() {
    const box = new THREE.Box3(), v = new THREE.Vector3(), col = new THREE.Color();
    ctx.scene.updateMatrixWorld(true);
    for (const S of SW) {
      S.parts = []; S.slabs = [];
      // target "structures:N": that structure's root (its meshes, whatever their distance), else everything near `at`
      let troot = null;
      const mt = S.target && /^(structures|objects):(\d+)$/.exec(S.target);
      if (mt) {
        const it = (window.__f3d?.cur?.S?.items || []).find((i) => i.section === mt[1] && i.index === +mt[2]);
        if (it) { troot = it.res.root; troot.getWorldPosition(v); if (!S.at) { const bb = new THREE.Box3().setFromObject(troot); bb.getCenter(v); S.at = [v.x, v.z]; S.r = Math.max(S.r, 0.6 * Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z)); } }
        else ctx.warn(`fx.tornado sweep: ${S.target} not found`);
      }
      if (!S.at) S.at = [at[0], at[1]];
      (troot || ctx.scene).traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
        let p = o; while (p && p.parent !== ctx.scene) p = p.parent;
        if (!troot && (!p || skipRoots.has(p) || /^fx\./.test(p.name || '') || /^cast|figure|witness/i.test(p.name || ''))) return;
        box.setFromObject(o); if (box.isEmpty()) return;
        box.getCenter(v);
        if (Math.hypot(v.x - S.at[0], v.z - S.at[1]) > S.r) return;
        const hgt = box.max.y - box.min.y, w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
        if (hgt < 0.35 || w > S.r * 2.6) return;                           // yards, decals, the ground stay
        S.parts.push({ o, box: box.clone(), m0: o.matrix.clone(), p0: o.position.clone(), q0: o.quaternion.clone(), s0: o.scale.clone(), gy: G(v.x, v.z) });
      });
      if (!S.parts.length) continue;
      let top = -1e9, base = 1e9; for (const q of S.parts) { top = Math.max(top, q.box.max.y); base = Math.min(base, q.gy); }
      S.top = top; S.base = base;
      const HH = top - base, RS = rng(4242 + S.parts.length);
      for (const q of S.parts) {
        q.roof = q.box.min.y > base + HH * 0.5;
        q.k = RS();
        // colour of the part (for its debris)
        const m = Array.isArray(q.o.material) ? q.o.material[0] : q.o.material; col.copy(m?.color || col.setRGB(0.6, 0.55, 0.5)); q.col = col.clone();
        // walls: a bare slab where they stood
        if (!q.roof && q.box.max.y - q.box.min.y > 1.5) {
          const sw = q.box.max.x - q.box.min.x, sd = q.box.max.z - q.box.min.z;
          const slab = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.3, 0.3, sd + 0.3), stdMat(ctx, { color: 0x77726a, roughness: 0.95 }));
          slab.position.set((q.box.min.x + q.box.max.x) / 2, q.gy + 0.1, (q.box.min.z + q.box.max.z) / 2); slab.receiveShadow = true; slab.userData.noQA = true; swRoot.add(slab);
        }
      }
      // debris chunks: born on the part's surface as it is torn, whirled round the core and flung out
      S.ch = [];
      for (let i = 0; i < chunkN; i++) {
        const q = S.parts[Math.floor(RS() * S.parts.length)];
        S.ch.push({ q, u: RS(), v: RS(), w: RS(), sz: [0.3 + RS() * 1.6, 0.05 + RS() * 0.2, 0.2 + RS() * 0.9], sp: [(RS() - 0.5) * 12, (RS() - 0.5) * 12, (RS() - 0.5) * 12], up: 4 + RS() * 14, out: 6 + RS() * 18 });
      }
    }
  }
  function updateSweep(t) {
    if (!SW.length) return;
    if (SW[0].parts == null) resolveSweep();
    let nc = 0, nd = 0;
    const c = track(t);
    for (const S of SW) {
      if (!S.parts || !S.parts.length) continue;
      const HH = S.top - S.base, span = Math.max(0.5, S.t1 - S.t);
      for (const q of S.parts) {
        const o = q.o;
        if (q.roof) {
          // the roof lifts, tilts and flies off with the rotation, breaking up (shrinks as its pieces leave)
          const x = t - S.t - q.k * 0.25;
          if (x <= 0) { o.position.copy(q.p0); o.quaternion.copy(q.q0); o.scale.copy(q.s0); continue; }
          const lift = 2.5 * x * x + 6 * x, drift = 9 * x * x;
          o.position.set(q.p0.x + drift * 0.8, q.p0.y + lift, q.p0.z - drift * 0.6);
          _e.set(0.5 * x * x + 0.3 * x, 0.6 * x, -0.4 * x * x); _q.setFromEuler(_e); o.quaternion.copy(q.q0).multiply(_q);
          const k = 1 - sstep(0.9, 2.2, x); o.scale.copy(q.s0).multiplyScalar(Math.max(k, 1e-3)); o.visible = k > 0.01;
        } else {
          // walls: peeled away from the top down between t and t_end (scaled down about their ground line)
          const x = (t - S.t - 0.25 - q.k * 0.3) / span;
          const k = 1 - sstep(0, 0.95, x);
          const gyL = q.gy - (o.parent ? o.parent.getWorldPosition(_p).y : 0);
          o.scale.set(q.s0.x, q.s0.y * Math.max(k, 1e-3), q.s0.z);
          o.position.set(q.p0.x, gyL + (q.p0.y - gyL) * Math.max(k, 1e-3), q.p0.z);
          o.visible = k > 0.02;
        }
      }
      // chunks: each is torn off at the current top of its part and whirled out round the core
      for (const ch of S.ch) {
        const q = ch.q;
        const born = q.roof ? S.t + 0.4 + ch.u * 1.6 : S.t + 0.25 + q.k * 0.3 + ch.u * span * 0.95;
        const x = t - born;
        if (x < 0 || x > 3.2) continue;
        const bx = lerp(q.box.min.x, q.box.max.x, ch.v), bz = lerp(q.box.min.z, q.box.max.z, ch.w);
        const by = q.roof ? q.box.max.y : lerp(q.box.max.y, q.gy, clamp((born - S.t - 0.25) / span));
        const dx = bx - c[0], dz = bz - c[1], dl = Math.hypot(dx, dz) || 1;
        const tx = -dz / dl, tz = dx / dl;                                    // counter-clockwise swirl
        const px = bx + (tx * 28 + dx / dl * ch.out * 0.4) * x, pz = bz + (tz * 28 + dz / dl * ch.out * 0.4) * x;
        const py = by + ch.up * x + 3 * x * x;
        _p.set(px, py, pz); _e.set(ch.sp[0] * x, ch.sp[1] * x, ch.sp[2] * x); _q.setFromEuler(_e);
        _s.set(ch.sz[0], ch.sz[1], ch.sz[2]).multiplyScalar(1 - sstep(2.4, 3.2, x));
        _m.compose(_p, _q, _s); chunks.setMatrixAt(nc, _m); chunks.setColorAt(nc, q.col); nc++;
      }
      // dust boiling off the torn walls
      const DN = 140;
      for (let i = 0; i < DN; i++) {
        const L = 2.2 + (i % 5) * 0.3, ph = (i * 0.618) % 1;
        const age = ((t - S.t - ph * L) % L + L) % L, born = t - age;
        const q = S.parts[i % S.parts.length];
        if (born < S.t || born > S.t1 + 0.8) { swDust.hide(nd++); continue; }
        const f = clamp((born - S.t) / span);
        const bx = lerp(q.box.min.x, q.box.max.x, (i * 0.37) % 1), bz = lerp(q.box.min.z, q.box.max.z, (i * 0.73) % 1);
        const by = q.roof ? q.box.max.y : lerp(q.box.max.y, q.gy, f);
        const dx = bx - c[0], dz = bz - c[1], dl = Math.hypot(dx, dz) || 1;
        const px = bx + (-dz / dl) * 18 * age, pz = bz + (dx / dl) * 18 * age, py = by + 3 + 5 * age;
        const sz = 3 + 5 * age;
        swDust.set(nd++, px - swRoot.position.x, py, pz - swRoot.position.z, sz, 0.55 * sstep(0, 0.3, age) * (1 - sstep(L * 0.5, L, age)), i * 1.7 + age, 0.36, 0.31, 0.25, i & 3, clamp(0.2 + 0.6 * age / L), 0.55);
      }
      void HH;
    }
    if (chunks) { chunks.count = nc; chunks.instanceMatrix.needsUpdate = true; if (chunks.instanceColor) chunks.instanceColor.needsUpdate = true; }
  }

  function update(t, clock, camera) {
    const c = track(t);
    root.position.x = c[0]; root.position.z = c[1];
    const l = L();
    for (const m of mats) { m.uniforms.uT.value = t; m.uniforms.uSun.value.copy(l.sun); m.uniforms.uSky.value.copy(l.sky); if (m.uniforms.uLDir) m.uniforms.uLDir.value.copy(l.dir); }
    camP = camera ? camera.position : null;
    updateDebris(t); updateCar(t); updateTrees(t);
    if (camera) { root.updateMatrixWorld(true); updateDust(t, camera); updateEvents(t, camera); updateSweep(t); if (swDust) swDust.commit(camera); }
  }
  update(0, 0, null);
  // radius = the funnel near the ground (the camera QA treats a moving item as a solid cylinder of this radius)
  return { root, radius: R0 * (wedge ? 1.0 : 0.75), height: 60, update, anchors: {}, footprint: [R0 * 2, R0 * 2], contact: false, track };
}
