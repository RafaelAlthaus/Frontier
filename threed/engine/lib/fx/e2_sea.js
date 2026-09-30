// e2_sea.js — (E2, Frontier 3D v2) the sea-disaster kit: the iceberg and the distress rockets.
//   nature.iceberg   a procedural faceted iceberg: 60-150 m long, up to ~30 m above the water, and the 7/8 of it
//                    below the waterline modelled (a wider, deeper, blue-green mass). White and pale-blue facets, darker
//                    creases, a blue-green band and a wet sheen at the waterline, a foam collar. At night it reads as a
//                    dark mass against the stars with a faint cold rim. Drifts slowly, bobs a few centimetres.
//   fx.flare         white socket signals (the Titanic's distress rockets): fired at `times` from a deck anchor or a
//   (fx.distress_rocket)  point, they streak up 180-250 m on a smoke trail, burst into white stars that drift down and
//                    fade, and each burst lights the ship and the sea for a few seconds (a point light + a glow on the
//                    water + its reflection).
// Pure functions of t (world time); seeded.
import * as THREE from 'three';
import { U, patchMaterial } from '../shared/env.js';
import { rng, clamp, lerp, smooth } from '../shared/util.js';
import { glowTex, puffTex, prm, num } from './w_common.js';
import { ensureUnderwater } from './e2_under.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;

export const CATALOG = {
  'nature.iceberg': {
    desc: 'procedural faceted iceberg (the Titanic berg), shape pinnacle (default: spires and jagged cliffs that LOOM over a low camera near a bow) | dome | tabular | drydock: 60-150 m long, 20-46 m above the water, the 7/8 below the waterline modelled (underwater and waterline cameras look right); white and pale-blue facets, darker creases, a blue-green waterline band with a wet sheen and a foam collar. At night it reads as a black mass against the stars with a faint cold rim (as the lookouts saw it). Put it on an ocean world; drift is slow.',
    actions: ['idle', 'drift'],
    params: { at: '[x, z]', shape: 'pinnacle (default: spires and jagged cliffs that loom over a low camera) | dome | tabular | drydock (two high walls, a low channel between)', size: 'length m (60..150; default pinnacle 80, else 90)', height: 'm above the water (default pinnacle 0.5 x size <= 46, dome 0.26, tabular 0.2, drydock 0.38; max 60)', seed: 'int (shape)', heading: 'deg: the long axis', drift: 'm/s (default 0.04; action drift: 0.25)', peaks: '1..4 spires (default pinnacle 3, else 2)', rim: '0..2 night rim strength (default 1)', dark: '0..1 how dark it reads at night (default 1: a black mass against the stars)' },
    footprint: [60, 90], height: 22, tags: ['ice', 'sea', 'titanic', 'nature'], section: 'objects',
  },
  'fx.flare': {
    desc: "distress rockets (white socket signals, as fired from the Titanic's bridge): each streaks up 180-250 m on a thin smoke trail, bursts into white stars that drift down and fade over ~6 s, and briefly lights the ship and the sea (a light with falloff, a glow on the water and its reflection). Fire from a deck anchor of a ship (from: 'bridge_wing') or from `at`.",
    actions: ['fire'],
    params: { at: '[x, z] launch point (if no `from`)', from: "anchor of a ship in the scene: 'bridge_wing' | 'bridge_wing_starboard' | 'bridge' | 'stern_deck' | 'objects:N.<anchor>' (the ship's named point; it follows the ship)", times: '[t, ...] launch times s (default [0.5])', height: 'burst height m (default 200, 180..250)', stars: '8..30 per burst (default 16)', light: '0..3 light strength (default 1)', color: 'white (default) | red (a lesser signal)', lean: 'deg the rockets lean off vertical (default 6)' },
    footprint: [4, 4], height: 220, tags: ['fx', 'sea', 'titanic', 'night', 'light', 'rocket', 'flare', 'distress'], section: 'objects',
  },
};
CATALOG['fx.distress_rocket'] = { ...CATALOG['fx.flare'], desc: 'alias of fx.flare: ' + CATALOG['fx.flare'].desc };

export async function build(kind, item, ctx) {
  if (kind === 'nature.iceberg') return iceberg(item, ctx);
  return flare(item, ctx);
}
const waterOf = (ctx) => (ctx.ground && ctx.ground.water && typeof ctx.ground.water.heightAt === 'function' ? ctx.ground.water : null);

// ── the iceberg ─────────────────────────────────────────────────────────────────────────────────────────────────────
function iceberg(item, ctx) {
  const P = prm(item), seed = (num(P.seed, 17) * 7919 + 13) >>> 0, R = rng(seed);
  const shape = ['pinnacle', 'dome', 'tabular', 'drydock'].includes(P.shape) ? P.shape : 'pinnacle';
  const Lz = clamp(num(P.size, shape === 'pinnacle' ? 80 : 90), 20, 220);
  const Hdef = { pinnacle: Math.min(46, Lz * 0.5), dome: Lz * 0.26, tabular: Lz * 0.2, drydock: Lz * 0.38 }[shape];
  const Hy = clamp(num(P.height, Hdef), 4, 60), Wx = Lz * (shape === 'pinnacle' ? lerp(0.6, 0.78, R()) : lerp(0.55, 0.75, R()));
  const peaks = clamp(Math.round(num(P.peaks, shape === 'pinnacle' ? 3 : 2)), 1, 4);
  const pk = Array.from({ length: peaks }, (_, i) => ({ x: (R() - 0.5) * (i ? 0.7 : 0.3), z: peaks === 1 ? (R() - 0.5) * 0.3 : lerp(-0.42, 0.42, i / (peaks - 1)) + (R() - 0.5) * 0.14, h: i === Math.floor(peaks / 2) ? 1 : 0.5 + R() * 0.32, w: 0.2 + R() * 0.12 }));
  // an icosphere, displaced: above the water the peaks + lumps; below it a wider, 6x deeper keel (7/8 of the mass)
  const g = new THREE.IcosahedronGeometry(1, 5).toNonIndexed();
  const p = g.attributes.position, n = p.count;
  const nz = (x, y, z, f, s) => Math.sin(x * f + s) * Math.sin(y * f * 1.3 + s * 2.1) * Math.sin(z * f * 0.9 + s * 3.7);
  const s0 = R() * 10;
  const V = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    V.fromBufferAttribute(p, i);
    const up = V.y > 0;
    let r = 1 + 0.16 * nz(V.x, V.y, V.z, 3.1, s0) + 0.08 * nz(V.x, V.y, V.z, 7.3, s0 + 1) + 0.035 * nz(V.x, V.y, V.z, 15.7, s0 + 2);
    let x = V.x * r, z = V.z * r, y = V.y * r;
    if (up) {
      // the silhouette by shape (heights 0..1 of Hy over the plan x, z in -1..1), cliffs at the rim, ledges, facets
      const rho = Math.hypot(x, z), jag = 0.07 * nz(x, 0, z, 9.1, s0 + 7) + 0.04 * nz(x, 0, z, 21.3, s0 + 9);
      let h;
      if (shape === 'pinnacle') {                                             // spires on a low shelf, jagged cliffs
        h = 0.14 + jag * 1.4;
        for (const q of pk) {                                                 // ridged spires: a star-shaped, broken cone
          const an = Math.atan2(z - q.z, x - q.x), d = Math.hypot((x - q.x) / q.w, (z - q.z) / q.w) * (1 + 0.24 * Math.sin(an * 5 + q.x * 13) + 0.13 * Math.sin(an * 9 + q.z * 7));
          h = Math.max(h, q.h * Math.pow(Math.max(0, 1 - d), 1.05) * (0.9 + 0.1 * Math.sin(an * 3 + q.z * 5)) + jag * q.h * 1.5);
        }
      } else if (shape === 'dome') h = 0.95 * Math.max(0, 1 - rho * rho) + jag * 0.5;
      else if (shape === 'tabular') h = 0.9 + jag * 0.4;
      else { const ch = smooth((Math.abs(z) - 0.12) / 0.3); h = lerp(0.16, 1, ch) * (0.8 + 0.2 * Math.max(0, 1 - Math.abs(x) * 1.2)) + jag; for (const q of pk) { const d = Math.hypot((x - q.x) / q.w, (z - q.z) / q.w); h = Math.max(h, (Math.abs(q.z) > 0.2 ? q.h : 0.3) * Math.pow(Math.max(0, 1 - d), 1.1)); } }
      const cliff = shape === 'dome' ? smooth((1.02 - rho) / 0.35) : smooth((1.02 - rho) / (shape === 'tabular' ? 0.08 : 0.16));
      y = Math.max(0, h) * cliff * (0.85 + 0.15 * Math.pow(Math.max(0, V.y), 0.4));
      y = Math.round(y * 9) / 9 * 0.35 + y * 0.65;                            // ledges and facets
      const pull = 1 - (shape === 'pinnacle' ? 0.2 : 0.08) * smooth(y / 0.7);     // narrower toward the top
      x *= Wx / 2 * pull; z *= Lz / 2 * pull; y *= Hy;
    } else {
      const k = 1.25 + 0.25 * nz(V.x, 0, V.z, 2.2, s0 + 5);
      x *= Wx / 2 * k; z *= Lz / 2 * k * 1.05; y = y * Hy * 5.2;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();                                                   // non-indexed: flat, faceted
  // colours per face: white/pale blue tops, darker creases (steep facets), a blue-green waterline band, deep blue below
  const col = new Float32Array(n * 3), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  for (let f = 0; f < n; f += 3) {
    A.fromBufferAttribute(p, f); B.fromBufferAttribute(p, f + 1); C.fromBufferAttribute(p, f + 2);
    N.subVectors(C, B).cross(A.clone().sub(B)).normalize();
    const cy = (A.y + B.y + C.y) / 3, steep = 1 - Math.abs(N.y), jit = 0.9 + R() * 0.12;
    let c;
    if (cy > 1.2) c = [lerp(0.93, 0.62, steep * 0.7) * jit, lerp(0.96, 0.72, steep * 0.6) * jit, lerp(1.0, 0.86, steep * 0.4) * jit];
    else if (cy > -3.5) { const w = smooth((cy + 3.5) / 4.7); c = [lerp(0.16, 0.6, w), lerp(0.52, 0.8, w), lerp(0.56, 0.9, w)]; }
    else { const w = smooth(clamp(-cy / 60)); c = [lerp(0.2, 0.05, w), lerp(0.55, 0.3, w), lerp(0.62, 0.42, w)]; }
    if (R() < 0.07 && cy > 0) c = c.map((v) => v * 0.8);                     // a darker, older facet here and there
    for (let k = 0; k < 3; k++) col.set(c, (f + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const rimU = { uRim: { value: new THREE.Color(0.2, 0.26, 0.36) }, uDark: { value: 0 }, uUnder: { value: 0 }, uUnderL: { value: 1 }, uLvl: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0, flatShading: true, envMapIntensity: 0.6 });
  mat.userData.progKey = 'e2ice';
  patchMaterial(mat, (sh) => {
    sh.uniforms.uRim = rimU.uRim; sh.uniforms.uDark = rimU.uDark; sh.uniforms.uUnder = rimU.uUnder; sh.uniforms.uUnderL = rimU.uUnderL; sh.uniforms.uLvl = rimU.uLvl;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vE2W;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vE2W = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uDark; uniform float uUnder; uniform float uUnderL; uniform float uLvl; varying vec3 vE2W;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(1.0, 0.45, uDark);')
      .replace('#include <opaque_fragment>', `{ vec3 Vv = normalize(vViewPosition); float fr = pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), 4.0);
        outgoingLight *= mix(1.0, 0.16, uDark);                 // at night a wet berg reads as a dark mass, its sky sheen too
        outgoingLight += uRim * fr * (0.35 + 0.65 * diffuseColor.b);
        if (vE2W.y < uLvl && uUnder > 0.0) { float dd = uLvl - vE2W.y; vec3 ice = vec3(0.46, 0.8, 0.84) * (0.55 + 0.45 * diffuseColor.g) * uUnderL * (0.35 + 0.65 * exp(-dd / 45.0)) * (0.8 + 0.2 * max(normal.y, 0.0));
          outgoingLight = mix(outgoingLight, ice, uUnder); } }
      #include <opaque_fragment>`);
  });
  const root = new THREE.Group(); root.name = 'nature.iceberg';
  const body = new THREE.Mesh(g, mat); body.name = 'iceberg'; body.castShadow = true; body.receiveShadow = true; root.add(body);
  // foam collar at the waterline
  const fg = new THREE.RingGeometry(0.92, 1.18, 96, 1).rotateX(-Math.PI / 2);
  const fm = new THREE.MeshBasicMaterial({ map: glowTex(), color: new THREE.Color(0.55, 0.62, 0.68), transparent: true, opacity: 0.55, depthWrite: false });
  const foam = new THREE.Mesh(fg, fm); foam.scale.set(Wx / 2 * 1.02, 1, Lz / 2 * 1.02); foam.position.y = 0.05; foam.renderOrder = 3; foam.name = 'iceberg-foam'; foam.userData.noQA = true; root.add(foam);
  const at = item.at || [0, 0], hd = (item.heading ?? 0) * DEG;
  const drift = num(P.drift, item.action === 'drift' ? 0.25 : 0.04), dd = [Math.sin(hd + 1.1), -Math.cos(hd + 1.1)];
  const rimK = clamp(num(P.rim, 1), 0, 2);
  const W = () => waterOf(ctx);
  const lvl = () => ctx.water?.level ?? 0;
  const UW = ensureUnderwater(ctx);
  function update(t, clock, camera) {
    if (camera) { UW.update(t, camera); const S2 = UW.state || {}; rimU.uUnder.value = S2.k || 0; rimU.uUnderL.value = 0.3 + 0.7 * Math.max(S2.light ?? 1, 0.15); rimU.uLvl.value = S2.level ?? 0; }
    const x = at[0] + dd[0] * drift * t, z = at[1] + dd[1] * drift * t, w = W();
    const h = w ? (w.heightAt(x, z, t) - lvl()) * 0.15 : 0;                    // a berg barely moves on the swell
    root.position.set(x, lvl() + h + 0.03 * Math.sin(t * 0.37), z);
    root.rotation.set(0.004 * Math.sin(t * 0.29 + 1), -hd, 0.005 * Math.sin(t * 0.23));
    const night = clamp(U.uNight?.value ?? (U.uSunDir.value.y < 0 ? 1 : 0));
    rimU.uRim.value.setRGB(0.09, 0.12, 0.17).multiplyScalar(rimK * lerp(0.15, 1, night)); rimU.uDark.value = night * clamp(num(P.dark, 1), 0, 1);
    mat.color.setScalar(lerp(1, 0.35, rimU.uDark.value)); mat.envMapIntensity = lerp(0.6, 0.08, rimU.uDark.value);
    fm.opacity = lerp(0.55, 0.18, night);
  }
  update(0);
  const anchors = { peak: new THREE.Object3D(), waterline: new THREE.Object3D() };
  anchors.peak.position.set(pk[0].x * Wx / 2, Hy * pk[0].h, pk[0].z * Lz / 2); anchors.waterline.position.set(0, 0, Lz / 2); root.add(anchors.peak, anchors.waterline);
  const solidAt = (q, t) => {
    const x = q[0] - root.position.x, z = q[2] - root.position.z, c = Math.cos(hd), s = Math.sin(hd);
    const lx = x * c - z * s, lz = x * s + z * c, y = q[1] - root.position.y;
    const e = (lx / (Wx / 2 * 1.35)) ** 2 + (lz / (Lz / 2 * 1.35)) ** 2;
    return e < 1 && y < Hy + 1 && y > -Hy * 5.5 ? root.position.y + Hy : 0;
  };
  return { root, radius: Math.max(Lz, Wx) / 2, height: Hy, update, anchors, snapped: true, contact: false, solidAt, length: Lz, beam: Wx };
}

// ── distress rockets ────────────────────────────────────────────────────────────────────────────────────────────────
function flare(item, ctx) {
  const P = prm(item), seed = ((item.seed ?? 3) * 131 + (item.index ?? 0) * 17) >>> 0, R = rng(seed);
  const times = (Array.isArray(P.times) ? P.times : [P.t ?? 0.5]).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const Hb = clamp(num(P.height, 200), 120, 300), NS = clamp(Math.round(num(P.stars, 16)), 6, 30), LK = clamp(num(P.light, 1), 0, 3);
  const red = P.color === 'red', starCol = red ? [10, 2, 1.2] : [11, 10.6, 9.6];
  const lean = num(P.lean, 6) * DEG;
  const root = new THREE.Group(); root.name = 'fx.flare'; root.userData.noQA = true;
  const sky = new THREE.Group(); sky.name = 'fx.flare.sky'; sky.userData.noQA = true; ctx.scene.add(sky);
  const at = item.at || [0, 0];
  // the launch point: a ship's anchor (found by name in the stage when first needed; it rides the ship) or `at`
  const fromName = typeof P.from === 'string' ? P.from.replace(/^.*\./, '') : null;
  let fromObj = null, looked = false;
  const _v = new THREE.Vector3();
  const launchAt = (t) => {
    if (fromName && !looked) { looked = true; ctx.scene.traverse((o) => { if (!fromObj && o.name === 'anchor:' + fromName) fromObj = o; }); if (!fromObj && ctx.warn) ctx.warn(`fx.flare: no anchor '${fromName}' in the scene; firing from at`); }
    if (fromObj) { fromObj.updateWorldMatrix(true, false); fromObj.getWorldPosition(_v); return [_v.x, _v.y + 1.5, _v.z]; }
    const g = ctx.ground?.height ? ctx.ground.height(at[0], at[1]) : 0;
    return [at[0], Math.max(g, ctx.water?.level ?? -1e9) + 2, at[1]];
  };
  const rockets = times.map((t0, i) => {
    const Rk = rng(seed + i * 977), az = Rk() * TAU, ln = lean * (0.5 + Rk());
    return { t0, H: Hb * (0.9 + Rk() * 0.25), az, ln, Ta: 3.2 + Rk() * 0.8, spin: Rk() * TAU,
      stars: Array.from({ length: NS }, () => { const u = Rk() * 2 - 1, a = Rk() * TAU, r = Math.sqrt(1 - u * u); return { d: [r * Math.cos(a), u * 0.7 + 0.25, r * Math.sin(a)], v: 34 + Rk() * 22, life: 4.5 + Rk() * 2.5, tw: Rk() * TAU, sz: 0.8 + Rk() * 0.6 }; }) };
  });
  // sprites: the rocket head, the stars, the burst flash; puffs of the smoke trail
  const glowM = (c) => new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(...c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const heads = rockets.map(() => { const s = new THREE.Sprite(glowM([9, 7.5, 5])); s.renderOrder = 20; s.frustumCulled = false; sky.add(s); return s; });
  const flashes = rockets.map(() => { const s = new THREE.Sprite(glowM(red ? [6, 1, 0.6] : [6, 6, 5.6])); s.renderOrder = 19; s.frustumCulled = false; sky.add(s); return s; });
  const stars = rockets.map((r) => r.stars.map(() => { const s = new THREE.Sprite(glowM(starCol)); s.renderOrder = 20; s.frustumCulled = false; sky.add(s); return s; }));
  const NP = 36, puffM = new THREE.SpriteMaterial({ map: puffTex(), color: 0x8a8f96, transparent: true, depthWrite: false, opacity: 0.0, fog: true });
  const puffs = rockets.map(() => Array.from({ length: NP }, () => { const m = puffM.clone(); const s = new THREE.Sprite(m); s.renderOrder = 12; s.frustumCulled = false; sky.add(s); return s; }));
  // one light for the brightest burst + a glow on the water under it
  const light = new THREE.PointLight(red ? 0xff6040 : 0xfff4e8, 0, 1400, 1.6); light.userData.fx = true; light.castShadow = false; sky.add(light);
  const seaGlow = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1 }));
  seaGlow.renderOrder = 4; seaGlow.frustumCulled = false; seaGlow.name = 'flare-seaglow'; sky.add(seaGlow);
  const wind = ctx.wind || { x: 1, z: 0 };
  const hide = (s) => { s.visible = false; };
  function trajectory(r, L0, tau) {                    // position of the rocket head at tau s after launch (<= Ta)
    const u = clamp(tau / r.Ta), y = r.H * (1 - (1 - u) * (1 - u));                // decelerating climb
    const off = Math.sin(r.ln) * y;
    return [L0[0] + Math.cos(r.az) * off + wind.x * 0.3 * tau, L0[1] + y, L0[2] + Math.sin(r.az) * off + wind.z * 0.3 * tau];
  }
  function update(t) {
    let best = 0, bx = 0, by = 0, bz = 0;
    const lvl = ctx.water?.level ?? 0;
    rockets.forEach((r, i) => {
      const tau = t - r.t0;
      const L0 = launchAt(Math.max(r.t0, 0));
      if (tau < 0 || tau > r.Ta + 9) { hide(heads[i]); hide(flashes[i]); stars[i].forEach(hide); puffs[i].forEach(hide); return; }
      // rising head (bright, flickering) until the burst
      if (tau < r.Ta) { const p = trajectory(r, L0, tau); heads[i].visible = true; heads[i].position.set(...p); const k = 3.5 + 0.8 * Math.sin(t * 61 + i); heads[i].scale.set(k, k, 1); }
      else hide(heads[i]);
      // the smoke trail: puffs laid along the climb as it passes, spreading and drifting with the wind, fading
      puffs[i].forEach((s, k) => {
        const tk = (k / NP) * r.Ta, age = tau - tk;
        if (age < 0) { s.visible = false; return; }
        const p = trajectory(r, L0, tk);
        s.visible = true; s.position.set(p[0] + wind.x * 0.6 * age, p[1] + 0.4 * age, p[2] + wind.z * 0.6 * age);
        const sz = 1.2 + 1.6 * Math.sqrt(age); s.scale.set(sz, sz, 1);
        s.material.opacity = 0.32 * smooth(age / 0.3) * Math.exp(-age / 5) * smooth((r.Ta + 8 - tau) / 2);
        s.material.rotation = k * 1.3 + age * 0.1;
      });
      // the burst: stars flung out, then drifting down under drag, twinkling and fading
      const tb = tau - r.Ta;
      const B = trajectory(r, L0, r.Ta);
      if (tb >= 0) {
        const fl = Math.exp(-tb / 0.035);                                         // a crack of light, gone in ~0.1 s
        flashes[i].visible = fl > 0.03; flashes[i].position.set(...B); flashes[i].scale.set(7 + 7 * fl, 7 + 7 * fl, 1);
        flashes[i].material.opacity = fl;
        r.stars.forEach((st, k) => {
          const s = stars[i][k], a = tb, dr = 0.9;                                   // drag: distance = v * (1 - e^-a/dr) * dr
          const dist = st.v * dr * (1 - Math.exp(-a / dr)), fall = 2.2 * a + 0.35 * a * a;
          const alive = clamp(1 - a / st.life);
          if (alive <= 0) { s.visible = false; return; }
          s.visible = true;
          s.position.set(B[0] + st.d[0] * dist + wind.x * 0.4 * a, B[1] + st.d[1] * dist - fall, B[2] + st.d[2] * dist + wind.z * 0.4 * a);
          const tw = 0.75 + 0.25 * Math.sin(t * 23 + st.tw) * Math.sin(t * 13 + st.tw * 2);
          const k2 = (1.2 + 2.6 * smooth(a / 0.25)) * st.sz * Math.pow(alive, 0.6) * tw; s.scale.set(k2, k2, 1);   // small points of light
        });
        const I = (Math.exp(-tb / 0.12) * 0.9 + 0.55 * clamp(1 - tb / 5.5) ** 1.5) * LK;
        if (I > best) { best = I; bx = B[0]; by = B[1] - 0.2 * tb * tb; bz = B[2]; }
      } else { hide(flashes[i]); stars[i].forEach(hide); }
      if (tau < r.Ta) { const p = trajectory(r, L0, tau); const I = 0.12 * LK; if (I > best) { best = I; bx = p[0]; by = p[1]; bz = p[2]; } }
    });
    light.position.set(bx, by, bz); light.intensity = best * 1.6e4;                    // candela: a few lux at 100-200 m
    const gr = 60 + by * 0.6; seaGlow.position.set(bx, lvl + 0.08, bz); seaGlow.scale.set(gr, 1, gr);
    seaGlow.material.color.setRGB(1, 0.97, 0.92).multiplyScalar(0.06 * best * (red ? 0.6 : 1)); seaGlow.visible = best > 0.005;
  }
  update(0);
  return { root, radius: 3, height: Hb, update, anchors: {}, snapped: true, contact: false,
    anchorsFn: null, frontXZ: (t) => { const r = rockets.find((q) => t >= q.t0) || rockets[0]; const L0 = r ? launchAt(r.t0) : [at[0], 0, at[1]]; return r ? trajectory(r, L0, clamp(t - r.t0, 0, r.Ta)) : L0; } };
}
