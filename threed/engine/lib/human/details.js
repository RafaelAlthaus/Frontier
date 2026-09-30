// details.js — the DETAIL kit (E3, 2026-09-27): insert-grade props for documentary close-ups, the objects the story is
// carried by (a stopped watch, the engine-order telegraph ringing FULL ASTERN, the CQD on the wireless pad, the flooded
// compartments on the plan, the listing table). Built for macro framing (0.2–0.6 m): bevelled small parts, real
// materials (brass, gold, enamel, glass, porcelain, paper, wood, leather) with a studio reflection map, canvas type from
// the engine's own fonts, every text a param. Each prop brings its own insert set by default (surface + a dark backdrop
// + a motivated warm/cool light) so a 2–3 s insert works in any scene; `on: "structures:0.desk"` puts it on a room's desk.
//   detail.watch      pocket watch (open hunter lid, chain, crown) | variant wall_clock; time, run, time_to + t
//   detail.wall_clock alias of detail.watch variant wall_clock
//   detail.telegraph  ship's engine-order telegraph; setting, move_to + t (the handle swings with a bell-ring jolt)
//   detail.wireless   Marconi-era key, headphones, message pad; text (pencil | typed), write [t0, t1], tap (Morse), lamp
//   detail.bell       ship's bell on a bracket with a rope; ring t (+ strikes)
//   detail.papers     documents: content ship_plan | letter | telegram | newspaper | map
//   detail.tableware  a laid table (+ chandelier); tilt + t: the ship lists, things slide and topple
//   detail.lifebuoy   white cork ring with a painted name; mount water | rail | wall
//   detail.sign       brass nameplate | gilt | enamel sign; mount wall | door
//   detail.lantern    hurricane lantern | ship lantern | candle; flicker
// Time keys are `t` (seconds of the shot): `at` is the position [x, z] everywhere in the engine.
import * as THREE from 'three';
import {
  TAU, clamp, lerp, smooth, smoother, makeRng, DEG, patchAll, yawFromHeading, xz, ground,
  loadFonts, FAM, font, canvas, ctex, cached, rgba, normalFrom, woodTex, linenTex, studioEnv,
  phys, std, metal, glass, porcelain, varnished, mesh, lathe, roundRect, plateGeo, sheetGeo, blob, tube, ropeMat, ropeRepeat,
  easeOutBack, damped, num, hash, vnoise, buildSet, makeRoot, onResolver, SURF, fitInsert, makeMeter, inInterior,
} from './details_core.js';
import { DOCS } from './details_docs.js';
import { patchMaterial } from '../shared/env.js';
import { buildTableware, buildLifebuoy, buildSign, buildLantern, MORE_CATALOG } from './details_more.js';
import { buildPhotoFrame, buildCompass, buildBinoculars, EXTRA_CATALOG } from './details_extra.js';

// ══ shared: a prop root + its set ══════════════════════════════════════════════════════════════════════════════════
// o: defaults for the set (surface, backdrop, light, size, aimY, scale). With `on`, no set unless asked.
export function propBase(kind, it, ctx, o = {}) {
  const hasOn = typeof (it.place_on ?? it.on) === 'string';
  const d = hasOn ? { surface: 'none', backdrop: 'none', light: 'none' } : inInterior(ctx) ? { surface: 'none', backdrop: 'none' } : {};   // round 2: in a room, the room is the set
  const surface = String(it.surface ?? d.surface ?? o.surface ?? 'desk');
  const elev = hasOn ? 0 : num(it.elev, SURF[surface] ?? 0.76);
  const root = makeRoot(kind, it, ctx, elev);
  const S = buildSet(root, { ...d, ...it, surface, elev }, { ...o });
  const resolveOn = onResolver(root, it, ctx);
  return { root, S, env: S.env, resolveOn };
}
let CUR_IT = null;   // the item being built (the registry builds one item at a time)
const PRACTICAL = /flame|chandelier|glow/;
export function finish(root, ctx, res) {
  const it = CUR_IT || {}, A = res.anchors || {};
  const face = res.face || (() => { const a = A.face || A.dial || A.text || A.pad || A.photo || A.card || A.lenses || A.flame || A.center; return a && a.isObject3D ? { anchor: a, size: [Math.min(0.6, (res.radius ?? 0.3) * 1.2), Math.min(0.6, Math.max(0.05, res.height ?? 0.2))], flat: /papers|compass|binoculars|wireless|tableware/.test(root.name) } : null; })();
  const out = { radius: 0.4, height: 0.3, snapped: true, contact: false, ...res, root, index: it.index, e3Issues: [] };
  if (face) {
    try { const notes = fitInsert(root, it, ctx, face); if (notes.length) (ctx.warnings || []).push(`objects:${it.index} ${root.name} fitted to the shot: ${notes.join('; ')}`); } catch (e) { (ctx.warnings || []).push(`${root.name}: fit failed (${String(e).slice(0, 120)})`); }
    out.anchors = { ...A, body: face.anchor };                                    // camera templates aim at the readable face
    out.radius = Math.max(face.size[0], face.size[1]) * 0.7; out.height = Math.max(face.size[1], 0.04);
    const own = []; root.traverse((o) => { if ((o.isSpotLight || o.isPointLight) && !PRACTICAL.test(o.name) && !PRACTICAL.test(o.parent?.name || '')) own.push(o); });
    const meter = makeMeter(root, ctx, out, face, own), u0 = out.update;
    out.update = (t, clock, camera) => { if (u0) u0(t, clock, camera); if (camera) meter(camera); };
  }
  patchAll(root, ctx);
  return out;
}
// QA: detail_unreadable joins qa.issues (strings, never flipping qa.ok) until E1 takes it into qa.js
if (typeof window !== 'undefined' && typeof window.qaScene === 'function' && !window.qaScene.__e3) {
  const q0 = window.qaScene;
  window.qaScene = (...a) => { const r = q0(...a); try { const list = (window.__f3d?.cur?.S?.items || []).flatMap((i) => (i.res && i.res.e3Issues) || []); if (list.length) r.issues = (r.issues || []).concat(list); } catch (e) { /* */ } return r; };
  window.qaScene.__e3 = true;
}
const anchor = (parent, name, x, y, z) => { const a = new THREE.Object3D(); a.name = 'anchor_' + name; a.position.set(x, y, z); parent.add(a); return a; };

// ══ 1. detail.watch / wall_clock ═══════════════════════════════════════════════════════════════════════════════════
export function parseTime(s, d = 10 * 3600 + 8 * 60 + 23) {
  if (typeof s === 'number' && Number.isFinite(s)) return s * 3600;
  const m = /(\d{1,2})(?:[:.h](\d{2}))?(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i.exec(String(s ?? ''));
  if (!m) return d;
  let h = +m[1] % 12; if (m[4] && /p/i.test(m[4])) h += 12;
  return h * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}
// displayed time (s) of the hands at shot time t: run true/'tick' = real time (the seconds hand beats), a number = minutes
// per second (time-lapse), false/'stop' = stopped; time_to + t (+ jump s): the hands sweep forward to time_to at t
function makeClock(it, beats) {
  const T0 = parseTime(it.time);
  const run = it.run ?? true;
  const rate = run === false || /^(stop|none|false|stopped)$/i.test(String(run)) ? 0 : (Number.isFinite(+run) && typeof run !== 'boolean' ? +run * 60 : 1);
  const tj = num(it.t, null), to = it.time_to != null ? parseTime(it.time_to) : null, jd = Math.max(0, num(it.jump, 0.9));
  return (t) => {
    let T = T0 + t * rate, sweep = rate > 1.5;
    if (to != null && tj != null && t >= tj) {
      const Tb = T0 + tj * rate; let Tt = to; while (Tt < Tb - 1e-6) Tt += 43200;
      const u = jd > 0 ? smoother((t - tj) / jd) : 1;
      T = lerp(Tb, Tt, u) + Math.max(0, t - tj - jd) * rate;
      if (u < 1) sweep = true;
    }
    let S = T;
    if (!sweep && rate > 0 && rate <= 1.5) {          // a mechanical beat: the hand jumps early in each beat, a small recoil
      const b = Math.floor(T * beats), f = T * beats - b;
      S = (b + easeOutBack(clamp(f / (beats > 2 ? 0.35 : 0.1)), beats > 2 ? 0.4 : 2.2)) / beats;
    }
    return { T, S };
  };
}
const ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
function dialCanvas(o) {
  const N = o.size || 2048, [c, g] = canvas(N, N), cx = N / 2, R = N / 2 * 0.985, R0 = makeRng(o.seed || 5);
  const modern = o.style === 'modern';
  const bg = g.createRadialGradient(cx, cx * 0.92, 0, cx, cx, R);
  bg.addColorStop(0, modern ? '#FAFAF7' : '#F8F4EA'); bg.addColorStop(0.8, modern ? '#F2F2EE' : '#F0E9DA'); bg.addColorStop(1, modern ? '#DCDCD8' : '#DCD2BD');
  g.fillStyle = bg; g.beginPath(); g.arc(cx, cx, N / 2, 0, TAU); g.fill();
  const ink = modern ? '#111214' : '#15130F';
  // enamel age: faint crazing hairlines and a warm stain
  const age = clamp(num(o.age, modern ? 0 : 0.35));
  if (age > 0) {
    for (let i = 0; i < 26 * age; i++) { g.strokeStyle = `rgba(90,75,50,${0.05 + R0() * 0.1})`; g.lineWidth = 1 + R0(); g.beginPath(); let x = cx + (R0() - 0.5) * R * 1.6, y = cx + (R0() - 0.5) * R * 1.6; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R0() - 0.5) * 160; y += (R0() - 0.5) * 160; g.lineTo(x, y); } g.stroke(); }
    const st = g.createRadialGradient(cx * 1.3, cx * 0.6, 0, cx * 1.3, cx * 0.6, R * 0.6); st.addColorStop(0, `rgba(160,120,60,${0.07 * age})`); st.addColorStop(1, 'rgba(160,120,60,0)'); g.fillStyle = st; g.fillRect(0, 0, N, N);
  }
  g.save(); g.translate(cx, cx);
  g.strokeStyle = ink; g.fillStyle = ink;
  if (!modern) { g.lineWidth = R * 0.006; g.beginPath(); g.arc(0, 0, R * 0.955, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, R * 0.885, 0, TAU); g.stroke(); }
  for (let i = 0; i < 60; i++) {
    const a = i * 6 * DEG, five = i % 5 === 0;
    g.save(); g.rotate(a);
    if (modern) { g.fillRect(-R * (five ? 0.012 : 0.004), -R * 0.955, R * (five ? 0.024 : 0.008), R * (five ? 0.1 : 0.05)); }
    else { g.lineWidth = R * (five ? 0.013 : 0.0055); g.beginPath(); g.moveTo(0, -R * 0.885); g.lineTo(0, -R * 0.955); g.stroke(); if (five) { g.beginPath(); g.arc(0, -R * 0.92, R * 0.012, 0, TAU); g.fill(); } }
    g.restore();
  }
  const sub = o.sub !== false && !modern;
  const style = o.numerals || (modern ? 'sans' : 'roman');
  for (let k = 0; k < 12; k++) {
    if (sub && k === 6) continue;
    const a = k * 30 * DEG;
    g.save();
    if (style === 'roman') {
      g.rotate(a); g.font = font(500, R * 0.2, FAM.serif); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.save(); g.translate(0, -R * 0.64); g.scale(k === 4 || k === 8 ? 0.82 : 0.9, 1); g.fillText(ROMAN[k], 0, 0); g.restore();
    } else {
      const r = R * (style === 'sans' ? 0.72 : 0.72);
      g.translate(Math.sin(a) * r, -Math.cos(a) * r); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = style === 'sans' ? font(600, R * 0.19, FAM.sans) : font(500, R * 0.2, FAM.serif);
      g.fillText(String(k === 0 ? 12 : k), 0, R * 0.01);
    }
    g.restore();
  }
  if (sub) {                                   // subsidiary seconds at 6
    g.save(); g.translate(0, R * 0.47); const r = R * 0.215;
    g.lineWidth = R * 0.004; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, r * 0.8, 0, TAU); g.stroke();
    for (let i = 0; i < 60; i++) { g.save(); g.rotate(i * 6 * DEG); g.lineWidth = R * (i % 5 ? 0.0025 : 0.005); g.beginPath(); g.moveTo(0, -r * 0.8); g.lineTo(0, -r * (i % 5 ? 0.9 : 1)); g.stroke(); g.restore(); }
    g.font = font(500, R * 0.052, FAM.serif); g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 1; i <= 6; i++) { const a = i * 60 * DEG; g.fillText(String(i * 10), Math.sin(a) * r * 0.6, -Math.cos(a) * r * 0.6); }
    g.restore();
  }
  if (o.maker) { g.font = font(500, R * 0.068, FAM.serif); g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.scale(1, 1); const s = String(o.maker).toUpperCase(); g.letterSpacing = `${R * 0.012}px`; g.fillText(s, 0, -R * 0.36); g.restore(); if (o.maker_sub) { g.font = font(400, R * 0.045, FAM.serif, true); g.fillText(String(o.maker_sub), 0, -R * 0.27); } }
  g.restore();
  return c;
}
// watch hands, flat shapes pointing +Y from the pivot, extruded thin, then laid to point -Z (12 o'clock) and face +Y
function handGeo(type, L, w, depth) {
  const shapes = [];
  const rect = (x0, y0, x1, y1) => { const s = new THREE.Shape(); s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.closePath(); return s; };
  const circ = (x, y, r, hole) => { const s = new THREE.Shape(); s.absarc(x, y, r, 0, TAU, false); if (hole) { const h = new THREE.Path(); h.absarc(x, y, hole, 0, TAU, true); s.holes.push(h); } return s; };
  if (type === 'breguet') {
    const ra = L * 0.78, rr = w * 2.1;
    shapes.push(rect(-w / 2, -L * 0.12, w / 2, ra - rr * 0.8));
    shapes.push(circ(0, ra, rr, rr * 0.62));
    const tip = new THREE.Shape(); tip.moveTo(-w * 0.55, ra + rr * 0.8); tip.lineTo(w * 0.55, ra + rr * 0.8); tip.lineTo(0, L); tip.closePath(); shapes.push(tip);
    shapes.push(circ(0, 0, w * 1.5, w * 0.45)); shapes.push(circ(0, -L * 0.12, w * 1.1));
  } else if (type === 'spade') {
    const s = new THREE.Shape(); s.moveTo(-w / 2, -L * 0.2); s.lineTo(w / 2, -L * 0.2); s.lineTo(w / 2, L * 0.6);
    s.quadraticCurveTo(w * 3.2, L * 0.68, w * 1.4, L * 0.82); s.lineTo(0, L); s.lineTo(-w * 1.4, L * 0.82); s.quadraticCurveTo(-w * 3.2, L * 0.68, -w / 2, L * 0.6); s.closePath();
    shapes.push(s); shapes.push(circ(0, 0, w * 1.6, w * 0.5)); shapes.push(circ(0, -L * 0.2, w * 1.5));
  } else if (type === 'baton') {
    const s = new THREE.Shape(); s.moveTo(-w / 2, -L * 0.18); s.lineTo(w / 2, -L * 0.18); s.lineTo(w * 0.35, L); s.lineTo(-w * 0.35, L); s.closePath(); shapes.push(s); shapes.push(circ(0, 0, w * 1.2, w * 0.4));
  } else {                                                    // needle (seconds)
    const s = new THREE.Shape(); s.moveTo(-w / 2, -L * 0.28); s.lineTo(w / 2, -L * 0.28); s.lineTo(w * 0.3, L); s.lineTo(-w * 0.3, L); s.closePath(); shapes.push(s); shapes.push(circ(0, 0, w * 1.8, 0)); shapes.push(circ(0, -L * 0.28, w * 1.3));
  }
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 18 });
  g.rotateX(-Math.PI / 2); return g;
}
function knurl(r, h, n = 48, depth = 0.08) {
  const g = new THREE.CylinderGeometry(r, r, h, n * 2, 1, false), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), rr = Math.hypot(x, z); if (rr < r * 0.99) continue; const k = 1 - depth * (0.5 + 0.5 * Math.cos(a * n)); p.setX(i, x * k); p.setZ(i, z * k); }
  g.computeVertexNormals(); return g;
}
async function buildWatch(kind, it, ctx) {
  await loadFonts();
  const wall = kind === 'detail.wall_clock' || /wall|clock/.test(String(it.variant || ''));
  if (wall) return buildWallClock(kind, it, ctx);
  const { root, S, env, resolveOn } = propBase(kind, it, ctx, { size: [1.2, 0.8], aimY: 0.008, scale: 0.8 });
  const modern = it.era === 'modern' || it.style === 'modern';
  const caseM = metal(it.metal || (modern ? 'steel' : 'gold'), env, { env: 1.25 });
  const watch = new THREE.Group(); watch.name = 'watch'; root.add(watch);
  const Rc = 0.026;
  const body = new THREE.Group(); watch.add(body);
  const stand = new THREE.Group(); stand.visible = false; root.add(stand);
  const setTilt = (deg) => {                              // stands on its 6 o'clock edge, leaning back; a walnut stand with a brass hook holds it
    const th = clamp(deg, 0, 80) * DEG, s = watch.scale.x;
    watch.position.set(0, 0, Rc * s); watch.rotation.x = th; body.position.z = -Rc;
    stand.visible = th > 0.5; stand.position.set(0, 0, Rc * s); stand.userData.th = th; stand.scale.setScalar(s);
    const ch = watch.getObjectByName('chain'); if (ch) ch.visible = th < 0.5; const tb = watch.getObjectByName('tbar'); if (tb) tb.visible = th < 0.5;
    stand.clear();
    if (th > 0.5) { const wal = varnished(woodTex('walnut'), env, { clearcoat: 0.9 }), br = metal('brass', env); const top = 2 * Rc * Math.sin(th), back = -2 * Rc * Math.cos(th);
      mesh(lathe([[0, 0], [0.045, 0], [0.047, 0.004], [0.043, 0.01], [0.036, 0.013], [0, 0.013]], 64), wal, stand, 0, 0, back * 0.5);
      mesh(new THREE.CylinderGeometry(0.0022, 0.0022, top + 0.03, 12), br, stand, 0, (top + 0.03) / 2, back - 0.012);
      const hook = tube([[0, top + 0.03, back - 0.012], [0, top + 0.036, back - 0.004], [0, top + 0.03, back + 0.004]], 0.0016, br, 16, 6); stand.add(hook); }
  };
  // case: back, band, bezel (lathe, 128 segments for macro)
  mesh(lathe([[0, 0], [0.012, 0.0002], [0.02, 0.0012], [0.0245, 0.0032], [0.0259, 0.0058], [Rc, 0.0078], [0.0257, 0.0096], [0.0249, 0.0104], [0.0246, 0.0107], [0.0247, 0.0114], [0.0242, 0.0121], [0.0233, 0.0123], [0.0229, 0.0118], [0.0229, 0.0099], [0, 0.0099]], 128), caseM, body);
  const dialC = dialCanvas({ style: modern ? 'modern' : 'pocket', numerals: it.numerals, maker: it.maker, maker_sub: it.maker_sub, age: it.age, sub: !modern, seed: 5 });
  const dial = mesh(new THREE.CircleGeometry(0.0229, 128).rotateX(-Math.PI / 2), phys({ map: ctex(dialC), roughness: 0.6, clearcoat: 0, envMap: env, envMapIntensity: 0.3 }), body, 0, 0.0100, 0);   // round 2: matte enamel (no glow)
  dial.name = 'dial';
  const handM = modern ? metal('steel', env, { roughness: 0.18 }) : metal('blued', env, { roughness: 0.2, env: 1.4 });
  const mk = (type, L, w, y) => { const m = mesh(handGeo(type, L, w, 0.00022), handM, body, 0, y, 0); m.castShadow = true; return m; };
  const hourH = mk(modern ? 'baton' : 'breguet', 0.0128, 0.0008, 0.0102), minH = mk(modern ? 'baton' : 'breguet', 0.0198, 0.0006, 0.01045);
  let secH;
  if (modern) secH = mk('needle', 0.0205, 0.00028, 0.0107);
  else { secH = mk('needle', 0.0046, 0.00022, 0.01025); secH.position.z = 0.0107; }
  mesh(new THREE.CylinderGeometry(0.0005, 0.0005, 0.0011, 16), handM, body, 0, 0.0104, 0);
  // crystal: a shallow glass dome
  const Rs = 0.1203, th = Math.asin(0.0231 / Rs);
  const cr = mesh(new THREE.SphereGeometry(Rs, 128, 12, 0, TAU, 0, th), glass(env, { thickness: 0.0015, env: 0.45 }), body, 0, 0.0141 - Rs, 0, false); cr.name = 'crystal';
  // pendant, crown (knurled), bow
  const pend = new THREE.Group(); pend.position.set(0, 0.0062, -Rc + 0.0006); body.add(pend);
  mesh(new THREE.CylinderGeometry(0.0034, 0.0038, 0.0048, 32).rotateX(Math.PI / 2), caseM, pend, 0, 0, -0.0024);
  mesh(knurl(0.0044, 0.0045, 40, 0.1).rotateX(Math.PI / 2), caseM, pend, 0, 0, -0.0068);
  mesh(new THREE.SphereGeometry(0.0044, 32, 12, 0, TAU, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 0.35), caseM, pend, 0, 0, -0.009);
  const bow = mesh(new THREE.TorusGeometry(0.0082, 0.00115, 16, 64).rotateX(Math.PI / 2), caseM, pend, 0, -0.0045, -0.0158); bow.name = 'bow';
  // hunter lid, open at the 9 o'clock hinge, an engraved `inscription` inside
  if (it.lid !== false && it.lid !== 'none' && !modern) {
    const hinge = new THREE.Group(); hinge.name = 'lid_hinge'; hinge.position.set(-Rc - 0.0006, 0.0102, 0); body.add(hinge);
    const lid = new THREE.Group(); lid.position.set(Rc + 0.0006, 0, 0); hinge.add(lid);
    const [lc, lg] = canvas(1024, 1024);
    lg.fillStyle = '#B8923F'; lg.fillRect(0, 0, 1024, 1024);
    for (let r = 20; r < 512; r += 7) { lg.strokeStyle = `rgba(255,236,190,${0.05 + 0.05 * Math.sin(r * 0.7)})`; lg.lineWidth = 2; lg.beginPath(); lg.arc(512, 512, r, 0, TAU); lg.stroke(); }
    const ins = String(it.inscription ?? '');
    if (ins) { lg.fillStyle = 'rgba(40,26,8,0.9)'; lg.textAlign = 'center'; lg.textBaseline = 'middle'; const lines = ins.split(/\n|\|/); lines.forEach((s, i) => { lg.font = font(500, 64, FAM.serif, true); lg.fillText(s, 512, 512 + (i - (lines.length - 1) / 2) * 84); }); }
    const [hc, hg] = canvas(512, 512); hg.drawImage(lc, 0, 0, 512, 512); const id = hg.getImageData(0, 0, 512, 512); for (let i = 0; i < id.data.length; i += 4) { const v = id.data[i] < 100 ? 40 : 160; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; } hg.putImageData(id, 0, 0);
    const inner = phys({ map: ctex(lc), normalMap: normalFrom(hc, 3), metalness: 1, roughness: 0.22, envMap: env, envMapIntensity: 1.2, color: 0xFFE2A0 });
    const lp = mesh(lathe([[0, 0.0036], [0.015, 0.003], [0.023, 0.0016], [Rc, 0], [0.0253, -0.0006], [0, -0.0002]], 128), caseM, lid);
    const face = mesh(new THREE.CircleGeometry(0.0235, 96).rotateX(Math.PI / 2), inner, lid, 0, -0.00025, 0); face.name = 'lid_inside'; face.rotation.y = Math.PI;   // upright to the reader once the lid is open
    hinge.rotation.z = num(it.lid_angle, 155) * DEG * (it.lid === 'closed' ? 0 : 1);
    mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.012, 16).rotateX(Math.PI / 2), caseM, hinge);
    void lp;
  }
  // chain: flat / upright links alternating along a lazy S on the surface, to a T-bar
  if (it.chain !== false) {
    const P = (Array.isArray(it.chain_path) ? it.chain_path : [[0, -0.05], [-0.03, -0.1], [-0.02, -0.16], [0.04, -0.19], [0.09, -0.16]]).map(([x, z]) => new THREE.Vector3(x, 0, z));
    P.unshift(new THREE.Vector3(0, 0.0015, -0.047));
    const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal'), L = curve.getLength(), step = 0.0034, n = Math.floor(L / step);
    const lg = new THREE.TorusGeometry(0.0021, 0.00055, 8, 20); lg.scale(1, 1.45, 1);
    const inst = new THREE.InstancedMesh(lg, caseM, n); inst.castShadow = true; inst.receiveShadow = true; inst.name = 'chain';
    const q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, p = curve.getPointAt(u), tg = curve.getTangentAt(u).setY(0).normalize();
      const flat = i % 2 === 0;
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(tg, up).normalize(), tg, up);   // torus y (long axis) along the chain
      q.setFromRotationMatrix(m); if (!flat) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
      m4.compose(new THREE.Vector3(p.x, flat ? 0.0006 : 0.0021, p.z), q, new THREE.Vector3(1, 1, 1)); inst.setMatrixAt(i, m4);
    }
    watch.add(inst);
    const end = curve.getPointAt(1), tb = mesh(new THREE.CylinderGeometry(0.0013, 0.0013, 0.022, 12).rotateZ(Math.PI / 2), caseM, watch, end.x, 0.0013, end.z); tb.rotation.y = 0.6; tb.name = 'tbar';
  }
  blob(root, 0.075, 0.075, 0.55, 0, 0, 0.0005);
  if (it.chain !== false) blob(root, 0.12, 0.2, 0.18, 0.02, -0.12, 0.0004);
  if (num(it.tilt, 0) > 0) setTilt(num(it.tilt, 0));
  const clock = makeClock(it, modern ? 4 : 5);
  const face = anchor(body, 'dial', 0, 0.0105, 0), crownA = anchor(pend, 'crown', 0, 0, -0.0068);
  const update = (t) => {
    if (resolveOn) resolveOn();
    const { T, S: Sec } = clock(t);
    hourH.rotation.y = -((T / 3600) % 12) * 30 * DEG; minH.rotation.y = -((T / 60) % 60) * 6 * DEG; secH.rotation.y = -(Sec % 60) * 6 * DEG;
  };
  update(0);
  const fc = { anchor: face, size: [0.047, 0.047], flat: true, movable: true, scale: [1, 1.45], setScale: (s) => { watch.scale.setScalar(s); if (stand.visible) setTilt(stand.userData.th / DEG); }, tilt: (deg) => { setTilt(deg); fc.stood = true; const hg = body.getObjectByName('lid_hinge'); if (hg) hg.rotation.z = 100 * DEG; } };   // stood up: the lid opens like a door
  return finish(root, ctx, { radius: 0.12, height: 0.03, update, anchors: { dial: face, face, crown: crownA, center: face, hands: face }, face: fc });
}
async function buildWallClock(kind, it, ctx) {
  const it2 = { surface: 'none', ...it };
  const elev = num(it.elev, 1.75);
  const { root, S, env, resolveOn } = propBase(kind, { ...it2, elev }, ctx, { surface: 'none', backdrop: 'dark', back: -0.075, aimY: 0, scale: 1.2, bokeh: false, key: [-0.3, 0.55, 1.2] });
  const modern = it.era === 'modern' || it.style === 'modern';
  const R = modern ? 0.16 : 0.155;
  const wood = varnished(woodTex('mahogany'), env, { clearcoat: 0.8 }), brass = metal('brass', env);
  const clockG = new THREE.Group(); clockG.name = 'wall_clock'; root.add(clockG);
  if (S.backdrop === 'none' && it.wall !== false) {    // at least a strip of wall to hang on
    const wt = woodTex('panel'), wm = std({ map: wt.map, color: 0x9A8070, roughness: 0.55 }); mesh(new THREE.PlaneGeometry(1.6, 1.4), wm, root, 0, -0.1, -0.075);
  }
  if (modern) {
    mesh(new THREE.TorusGeometry(R + 0.012, 0.016, 24, 128), std({ color: 0x151515, roughness: 0.35 }), clockG, 0, 0, -0.02);
    mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.04, 96).rotateX(Math.PI / 2), std({ color: 0x151515, roughness: 0.4 }), clockG, 0, 0, -0.045);
  } else {
    // octagonal drop-dial surround + a turned bezel + the drop box with a window on the swinging pendulum
    const oct = new THREE.Shape(); for (let k = 0; k < 8; k++) { const a = (k + 0.5) * TAU / 8; const x = Math.cos(a) * 0.225, y = Math.sin(a) * 0.225; if (k) oct.lineTo(x, y); else oct.moveTo(x, y); } oct.closePath();
    const hole = new THREE.Path(); hole.absarc(0, 0, R + 0.004, 0, TAU, true); oct.holes.push(hole);
    const og = new THREE.ExtrudeGeometry(oct, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 48 }); og.translate(0, 0, -0.06);
    mesh(og, wood, clockG);
    const drop = new THREE.Shape(); drop.moveTo(-0.13, -0.16); drop.lineTo(0.13, -0.16); drop.lineTo(0.09, -0.46); drop.quadraticCurveTo(0, -0.5, -0.09, -0.46); drop.closePath();
    const win = new THREE.Path(); win.moveTo(-0.035, -0.37); win.lineTo(0.035, -0.37); win.lineTo(0.035, -0.43); win.lineTo(-0.035, -0.43); win.closePath(); drop.holes.push(win);
    const dg = new THREE.ExtrudeGeometry(drop, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 }); dg.translate(0, 0, -0.075); mesh(dg, wood, clockG);
    mesh(new THREE.BoxGeometry(0.08, 0.07, 0.005), std({ color: 0x0A0806, roughness: 1 }), clockG, 0, -0.4, -0.06, false);
    const pend = new THREE.Group(); pend.position.set(0, -0.2, -0.035); clockG.add(pend); pend.name = 'pendulum';
    mesh(new THREE.BoxGeometry(0.006, 0.19, 0.002), brass, pend, 0, -0.095, 0); mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.006, 48).rotateX(Math.PI / 2), brass, pend, 0, -0.2, 0);
    clockG.userData.pend = pend;
    mesh(new THREE.TorusGeometry(R + 0.006, 0.009, 24, 128), brass, clockG, 0, 0, -0.012);
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 12).rotateX(Math.PI / 2), brass, clockG, R * 0.55, -R * 0.4, -0.02);   // winding arbor
  }
  const dialC = dialCanvas({ style: modern ? 'modern' : 'wall', numerals: it.numerals || (modern ? 'sans' : 'roman'), maker: it.maker, age: it.age ?? (modern ? 0 : 0.25), sub: false, seed: 7 });
  const dial = mesh(new THREE.CircleGeometry(R, 128), phys({ map: ctex(dialC), roughness: 0.65, clearcoat: 0, envMap: env, envMapIntensity: 0.25 }), clockG, 0, 0, -0.03); dial.name = 'dial';   // round 2: matte enamel, never a glow
  if (!modern) for (const a of [0.34, 0.66]) mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 24).rotateX(Math.PI / 2), brass, clockG, Math.sin(a * TAU + Math.PI) * R * 0.42 * (a < 0.5 ? -1 : 1), -R * 0.28, -0.028);
  const handM = modern ? std({ color: 0x111111, roughness: 0.4 }) : metal('black_steel', env, { roughness: 0.3 });
  const hg = (type, L, w) => { const g = handGeo(type, L, w, 0.0016); g.rotateX(Math.PI / 2); return g; };   // back to the XY plane, facing +Z
  const hourH = mesh(hg(modern ? 'baton' : 'spade', R * 0.55, R * 0.028), handM, clockG, 0, 0, -0.026), minH = mesh(hg(modern ? 'baton' : 'spade', R * 0.8, R * 0.02), handM, clockG, 0, 0, -0.023);
  const secOn = it.seconds ?? true;
  const secH = secOn ? mesh(hg('needle', R * 0.86, R * 0.008), modern ? std({ color: 0xC0201A, roughness: 0.4 }) : handM, clockG, 0, 0, -0.02) : null;
  mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 16).rotateX(Math.PI / 2), brass, clockG, 0, 0, -0.018);
  const cr = mesh(new THREE.CircleGeometry(R + 0.003, 96), glass(env, { thickness: 0.002, env: 0.35, roughness: 0.06 }), clockG, 0, 0, -0.008, false); cr.name = 'crystal';
  const clock = makeClock(it, 1);
  const face = anchor(clockG, 'dial', 0, 0, -0.02);
  const update = (t) => {
    if (resolveOn) resolveOn();
    const { T, S: Sec } = clock(t);
    hourH.rotation.z = -((T / 3600) % 12) * 30 * DEG; minH.rotation.z = -((T / 60) % 60) * 6 * DEG; if (secH) secH.rotation.z = -(Sec % 60) * 6 * DEG;
    const pd = clockG.userData.pend; if (pd) pd.rotation.z = 0.09 * Math.sin(Math.PI * T);
  };
  update(0);
  return finish(root, ctx, { radius: 0.35, height: 0.5, update, anchors: { dial: face, face, center: face }, face: { anchor: face, size: [2 * R, 2 * R], flat: false, movable: true } });
}

// ══ 2. detail.telegraph — engine-order telegraph ═════════════════════════════════════════════════════════════════════
export function teleAngle(s) {
  s = String(s ?? 'stop').toLowerCase();
  if (/stand/.test(s)) return -90; if (/finish/.test(s)) return 90; if (/stop/.test(s)) return 0;
  const k = /full/.test(s) ? 67.5 : /half/.test(s) ? 45 : /slow/.test(s) ? 22.5 : 0;
  return /astern/.test(s) ? -k : k;
}
function teleDial(o) {
  const N = 2048, [c, g] = canvas(N, N), cx = N / 2, R = N / 2 * 0.99;
  g.fillStyle = '#EDE3CA'; g.beginPath(); g.arc(cx, cx, N / 2, 0, TAU); g.fill();
  g.save(); g.translate(cx, cx);
  const secs = [[-90, 'STAND BY', 'mid'], [-67.5, 'FULL', 'astern'], [-45, 'HALF', 'astern'], [-22.5, 'SLOW', 'astern'], [0, 'STOP', 'stop'], [22.5, 'SLOW', 'ahead'], [45, 'HALF', 'ahead'], [67.5, 'FULL', 'ahead'], [90, 'FINISHED WITH ENGINES', 'mid']];
  const r0 = R * 0.2, r1 = R * 0.77;
  for (const [a, label, side] of secs) {
    const a0 = (a - 11.25 - 90) * DEG, a1 = (a + 11.25 - 90) * DEG;
    g.beginPath(); g.arc(0, 0, r1, a0, a1); g.arc(0, 0, r0, a1, a0, true); g.closePath();
    g.fillStyle = side === 'astern' ? '#A42E24' : side === 'mid' ? '#22384F' : side === 'stop' ? '#F3EBD6' : '#EDE3CA'; g.fill();
    // radial words (as on the real dials): they read outward on the AHEAD side, inward on the ASTERN side, upright
    g.save(); g.rotate(a * DEG);
    g.fillStyle = side === 'astern' || side === 'mid' ? '#F6EEDC' : side === 'stop' ? '#A42E24' : '#16130E';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const rad = (s, r, px, w = 700) => { g.save(); g.translate(0, -r); g.rotate(a >= 0 ? -Math.PI / 2 : Math.PI / 2); g.font = font(w, px, FAM.caps); let k = 1; const mw = R * 0.58; const tw = g.measureText(s).width; if (tw > mw) k = mw / tw; g.scale(k, 1); g.fillText(s, 0, 0); g.restore(); };
    if (side === 'stop') { g.font = font(700, R * 0.078, FAM.caps); g.fillText(label, 0, -R * 0.66); }
    else if (side === 'mid') { const w = label.split(' '); if (w.length > 2) { g.save(); g.rotate(-0.045 * Math.sign(a)); rad(w[0], R * 0.53, R * 0.062); g.restore(); g.save(); g.rotate(0.05 * Math.sign(a)); rad(w.slice(1).join(' '), R * 0.53, R * 0.046); g.restore(); } else rad(label, R * 0.53, R * 0.07); }
    else rad(label, R * 0.54, R * 0.1);
    g.restore();
  }
  g.strokeStyle = '#16130E'; g.lineWidth = R * 0.008;
  for (let k = 0; k < 10; k++) { const a = (-101.25 + k * 22.5 - 90) * DEG; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke(); }
  g.beginPath(); g.arc(0, 0, r1, (-101.25 - 90) * DEG, (101.25 - 90) * DEG); g.stroke();
  // outer band with AHEAD / ASTERN along the arc
  g.fillStyle = '#16130E'; g.beginPath(); g.arc(0, 0, R * 0.9, 0, TAU); g.arc(0, 0, R * 0.785, 0, TAU, true); g.fill();   // inside the bezel's shadow line
  const arc = (s, mid, r, px) => { g.font = font(700, px, FAM.caps); const tot = [...s].reduce((w, ch) => w + g.measureText(ch).width + px * 0.18, 0); let a = mid * DEG - tot / r / 2; for (const ch of s) { const w = g.measureText(ch).width; g.save(); g.rotate(a + (w / 2) / r); g.fillStyle = '#F2E6C4'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 0, -r); g.restore(); a += (w + px * 0.18) / r; } };
  arc('AHEAD', 45, R * 0.842, R * 0.066); arc('ASTERN', -45, R * 0.842, R * 0.066);
  // lower half: the maker's plate and the station name
  g.fillStyle = '#16130E'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = font(700, R * 0.075, FAM.caps); g.fillText(String(o.station ?? 'ENGINE ROOM').toUpperCase(), 0, R * 0.5);
  if (o.maker) { g.font = font(500, R * 0.048, FAM.serif, true); g.fillText(String(o.maker), 0, R * 0.64); }
  g.lineWidth = R * 0.006; g.beginPath(); g.moveTo(-R * 0.34, R * 0.41); g.lineTo(R * 0.34, R * 0.41); g.stroke();
  g.restore();
  return c;
}
async function buildTelegraph(kind, it, ctx) {
  await loadFonts();
  const { root, S, env, resolveOn } = propBase(kind, it, ctx, { surface: 'deck', backdrop: 'dark', aimY: 1.15, scale: 1.6 });
  const brass = metal(it.metal || 'brass', env, { env: 1.25 }), brassA = metal('brass_aged', env);
  const T = new THREE.Group(); T.name = 'telegraph'; root.add(T);
  mesh(lathe([[0, 0], [0.19, 0], [0.19, 0.022], [0.172, 0.03], [0.13, 0.05], [0.1, 0.085], [0.082, 0.14], [0.072, 0.3], [0.066, 0.5], [0.078, 0.515], [0.078, 0.545], [0.066, 0.56], [0.061, 0.8], [0.07, 0.86], [0.088, 0.9], [0.098, 0.93], [0.098, 0.95], [0.05, 0.955], [0.05, 0.99], [0, 0.99]], 128), brassA, T);
  for (let k = 0; k < 6; k++) { const a = k * TAU / 6; mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 6), brass, T, Math.cos(a) * 0.165, 0.026, Math.sin(a) * 0.165); }
  const head = new THREE.Group(); head.position.set(0, 1.215, 0); T.add(head); head.name = 'head';
  const Rh = 0.235;
  mesh(new THREE.CylinderGeometry(Rh, Rh, 0.17, 128, 1, true).rotateX(Math.PI / 2), brassA, head);
  const dialT = ctex(teleDial({ station: it.station, maker: it.maker }));
  const dialM = phys({ map: dialT, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.2, envMap: env, envMapIntensity: 0.35 });
  const gl = glass(env, { thickness: 0.003 });
  const faces = [];
  for (const s of [1, -1]) {
    const f = mesh(new THREE.CircleGeometry(Rh - 0.004, 128), dialM, head, 0, 0, s * 0.078); if (s < 0) f.rotation.y = Math.PI; f.name = 'dial';
    mesh(new THREE.TorusGeometry(Rh - 0.004, 0.014, 20, 128), brass, head, 0, 0, s * 0.087);
    mesh(new THREE.TorusGeometry(Rh - 0.009, 0.004, 12, 128), brass, head, 0, 0, s * 0.095);
    const gg = mesh(new THREE.CircleGeometry(Rh - 0.012, 96), gl, head, 0, 0, s * 0.093, false); if (s < 0) gg.rotation.y = Math.PI;
    faces.push(f);
  }
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 48).rotateX(Math.PI / 2), brass, head);
  for (const s of [1, -1]) mesh(new THREE.SphereGeometry(0.034, 32, 16, 0, TAU, 0, Math.PI / 2).rotateX(s * Math.PI / 2), brass, head, 0, 0, s * 0.125);
  // answer pointers (engine room's reply) inside the glass: slim red-tipped needles
  const ansG = new THREE.Group(); head.add(ansG);
  for (const s of [1, -1]) { const n = mesh(new THREE.BoxGeometry(0.008, 0.16, 0.002), std({ color: 0x1A1612, roughness: 0.5 }), ansG, 0, 0.11, s * 0.081); mesh(new THREE.ConeGeometry(0.009, 0.03, 3), std({ color: 0xA42E24, roughness: 0.5 }), n, 0, 0.09, 0); }
  // the handle: two levers outside the faces joined by a crossbar grip over the drum; it is the pointer
  const handle = new THREE.Group(); head.add(handle); handle.name = 'handle';
  for (const s of [1, -1]) {
    const lv = new THREE.Shape(); lv.moveTo(-0.022, 0); lv.lineTo(0.022, 0); lv.lineTo(0.012, 0.35); lv.lineTo(-0.012, 0.35); lv.closePath();
    const hole = new THREE.Path(); hole.absarc(0, 0, 0.008, 0, TAU, true); lv.holes.push(hole);
    const lg = new THREE.ExtrudeGeometry(lv, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 }); lg.translate(0, 0, -0.005);
    mesh(lg, brass, handle, 0, 0, s * 0.112);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 48).rotateX(Math.PI / 2), brass, handle, 0, 0, s * 0.112);
    const arrow = new THREE.Shape(); arrow.moveTo(-0.012, 0.19); arrow.lineTo(0.012, 0.19); arrow.lineTo(0, 0.225); arrow.closePath();
    mesh(new THREE.ExtrudeGeometry(arrow, { depth: 0.003, bevelEnabled: false }).translate(0, 0, s > 0 ? 0.006 : -0.009), std({ color: 0x14110C, roughness: 0.5 }), handle, 0, 0, s * 0.112);
  }
  mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.26, 32).rotateX(Math.PI / 2), brass, handle, 0, 0.345, 0);
  const grip = mesh(lathe([[0.0, -0.075], [0.018, -0.075], [0.022, -0.06], [0.021, 0.06], [0.018, 0.075], [0, 0.075]], 48).rotateX(Math.PI / 2), varnished(woodTex('walnut'), env, { clearcoat: 0.9 }), handle, 0, 0.345, 0); grip.name = 'grip';
  const gripA = anchor(handle, 'handle', 0, 0.345, 0), faceA = anchor(head, 'face', 0, 0.02, 0.095), backA = anchor(head, 'back', 0, 0.02, -0.095);
  if (S.surface !== 'none') blob(root, 0.55, 0.55, 0.6, 0, 0, 0.0005);
  // motion: setting, move_to + t: a fast swing with an overshoot, a double-ring option, the answer 1 s later
  const a0 = teleAngle(it.setting), a1 = it.move_to != null ? teleAngle(it.move_to) : a0, tm = num(it.t, 1), ring = num(it.ring, 1) >= 2 || it.swing === 'double';
  const dur = 0.28 + Math.abs(a1 - a0) * 0.0035, ansDelay = num(it.answer_delay, 1.0);
  const handleAt = (t) => {
    if (a1 === a0 || t <= tm) return a0;
    if (ring) {                                  // swing through to the far end and back to the order (ringing the bell twice)
      const far = a1 >= 0 ? 90 : -90, d1 = 0.22 + Math.abs(far - a0) * 0.003, d2 = 0.2 + Math.abs(far - a1) * 0.003;
      if (t < tm + d1) return lerp(a0, far, smoother((t - tm) / d1));
      const u = (t - tm - d1) / d2; return u < 1 ? lerp(far, a1, easeOutBack(u, 1.4)) : a1 + 2.5 * damped(t - tm - d1 - d2, 3.2, 6);
    }
    const u = (t - tm) / dur; return u < 1 ? lerp(a0, a1, easeOutBack(u, 1.3)) : a1 + 2.2 * damped(t - tm - dur, 3.4, 6);
  };
  const arrive = tm + (ring ? 0.22 + Math.abs((a1 >= 0 ? 90 : -90) - a0) * 0.003 + 0.2 + Math.abs((a1 >= 0 ? 90 : -90) - a1) * 0.003 : dur);
  const ansAt = (t) => (a1 === a0 || t < arrive + ansDelay ? a0 : lerp(a0, a1, smoother((t - arrive - ansDelay) / 0.55)));
  const update = (t) => {
    if (resolveOn) resolveOn();
    handle.rotation.z = -handleAt(t) * DEG;
    ansG.rotation.z = -ansAt(t) * DEG;
    const j = a1 !== a0 ? damped(t - arrive, 13, 11) * 0.5 + damped(t - arrive - ansDelay - 0.55, 13, 12) * 0.2 : 0;   // the bell-ring jolt through the head
    head.rotation.z = j * DEG; head.position.y = 1.215 + j * 0.0006;
  };
  update(0);
  return finish(root, ctx, { radius: 0.4, height: 1.6, update, anchors: { face: faceA, dial: faceA, handle: gripA, back: backA, head } });
}

// ══ 3. detail.wireless — the Marconi room desk ═══════════════════════════════════════════════════════════════════════
const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-' };
export function morseTimeline(text, unit) {
  const on = []; let t = 0;
  for (const word of String(text).toUpperCase().split(/\s+/).filter(Boolean)) {
    for (const ch of word) { const code = MORSE[ch]; if (!code) continue; for (const s of code) { const d = s === '.' ? unit : unit * 3; on.push([t, t + d]); t += d + unit; } t += unit * 2; }
    t += unit * 4;
  }
  return { on, period: t + unit * 4 };
}
async function buildWireless(kind, it, ctx) {
  await loadFonts();
  const lampOn = it.lamp !== false;
  const { root, S, env, resolveOn } = propBase(kind, it, ctx, { surface: 'wood', backdrop: 'dark', light: lampOn ? 'none' : 'warm', size: [1.3, 0.8], aimY: 0.02, scale: 0.9 });
  const brass = metal('brass', env), ebon = phys({ color: 0x0C0B0A, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 0.9 });
  // the key (heavy Marconi pattern): ebonite base, trunnion pillars, brass lever, black knob, contacts, spring, posts
  const key = new THREE.Group(); key.name = 'key'; key.position.set(0.12, 0, 0.1); key.rotation.y = -0.18; root.add(key);
  mesh(plateGeo(0.17, 0.085, 0.013, 0.008, 0.002), ebon, key);
  for (const x of [-0.019, 0.019]) mesh(new THREE.CylinderGeometry(0.0055, 0.007, 0.034, 24), brass, key, x, 0.0155 + 0.017, -0.005);
  mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.052, 16).rotateZ(Math.PI / 2), brass, key, 0, 0.044, -0.005);
  for (const x of [-0.026, 0.026]) mesh(knurl(0.0045, 0.004, 20, 0.12).rotateZ(Math.PI / 2), brass, key, x, 0.044, -0.005);
  const lever = new THREE.Group(); lever.position.set(0, 0.044, -0.005); key.add(lever);
  const lvG = new THREE.BoxGeometry(0.011, 0.007, 0.155, 1, 1, 8), p = lvG.attributes.position; for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setX(i, p.getX(i) * (1 - 0.35 * clamp((z - 0.02) / 0.06))); } lvG.computeVertexNormals(); lvG.translate(0, 0, 0.02);
  mesh(lvG, brass, lever);
  const knob = mesh(lathe([[0, 0], [0.007, 0], [0.008, 0.004], [0.015, 0.007], [0.018, 0.011], [0.017, 0.015], [0.012, 0.0175], [0, 0.0185]], 64), ebon, lever, 0, 0.0035, 0.088); knob.name = 'knob';
  mesh(new THREE.CylinderGeometry(0.009, 0.01, 0.003, 32), brass, lever, 0, 0.004, 0.088);
  mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.028, 12), brass, lever, 0, 0.012, -0.045); mesh(knurl(0.0048, 0.0035, 18, 0.12), brass, lever, 0, 0.02, -0.045);
  mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 16), brass, key, 0, 0.023, -0.05);
  const helix = []; for (let k = 0; k <= 60; k++) { const a = k / 60 * TAU * 7; helix.push(new THREE.Vector3(Math.cos(a) * 0.0035, 0.016 + k / 60 * 0.022, -0.028 + Math.sin(a) * 0.0035)); }
  const spring = tube(helix, 0.0006, metal('steel', env), 180, 6); key.add(spring);
  for (const x of [-0.07, 0.07]) { mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 16), brass, key, x, 0.019, -0.03); mesh(knurl(0.0065, 0.006, 22, 0.12), brass, key, x, 0.024, -0.03); }
  const wireM = patchMaterial(new THREE.MeshLambertMaterial({ color: 0x1A1612 }));   // cloth-covered wire: matte
  for (const s of [-1, 1]) key.add(tube([[s * 0.07, 0.02, -0.03], [s * 0.08, 0.004, -0.07], [s * 0.05, 0.003, -0.16], [s * 0.1, 0.003, -0.3]], 0.0022, wireM, 48, 8));
  const spark = mesh(new THREE.SphereGeometry(0.0022, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.85, 1.6) }), key, 0, 0.034, -0.05, false); spark.name = 'glow_spark'; spark.visible = false;
  blob(key, 0.2, 0.12, 0.5, 0, 0, 0.0005);
  // headphones lying on the desk: two ebonite cups on a steel band, a cloth cord
  const hp = new THREE.Group(); hp.name = 'headphones'; hp.position.set(-0.2, 0, 0.02); hp.rotation.y = 0.5; root.add(hp);
  const cupP = [[0, 0], [0.03, 0], [0.034, 0.003], [0.036, 0.015], [0.034, 0.022], [0.03, 0.024], [0, 0.0245]];
  for (const s of [-1, 1]) {
    const cup = new THREE.Group(); cup.position.set(s * 0.085, 0, 0); cup.rotation.z = s * 0.25; hp.add(cup);
    mesh(lathe(cupP, 64), ebon, cup, 0, 0.004, 0); mesh(new THREE.TorusGeometry(0.0345, 0.0022, 12, 64).rotateX(Math.PI / 2), brass, cup, 0, 0.022, 0);
    const [gc, gg] = canvas(512, 512); gg.fillStyle = '#111'; gg.fillRect(0, 0, 512, 512); for (let r = 20; r < 256; r += 26) { gg.strokeStyle = '#2a2a2a'; gg.lineWidth = 6; gg.beginPath(); gg.arc(256, 256, r, 0, TAU); gg.stroke(); } gg.fillStyle = '#000'; gg.beginPath(); gg.arc(256, 256, 24, 0, TAU); gg.fill();
    mesh(new THREE.CircleGeometry(0.029, 64).rotateX(-Math.PI / 2), phys({ map: ctex(gc), roughness: 0.3, clearcoat: 0.8, envMap: env, envMapIntensity: 0.8 }), cup, 0, 0.0288, 0);
  }
  const band = []; for (let k = 0; k <= 32; k++) { const a = Math.PI * k / 32; band.push(new THREE.Vector3(-Math.cos(a) * 0.09, 0.012 + Math.sin(a) * 0.004, -Math.sin(a) * 0.075)); }
  hp.add(tube(band, 0.0022, metal('blued', env, { roughness: 0.4, env: 0.6 }), 80, 8));
  const cordM = ropeMat('#3A2E22', env);
  const cord = tube([[0.085, 0.01, 0.02], [0.14, 0.003, 0.06], [0.2, 0.003, 0.0], [0.26, 0.003, -0.12], [0.4, 0.004, -0.2]], 0.0021, cordM, 120, 8); ropeRepeat(cord, 0.5, 0.0021); hp.add(cord);
  blob(hp, 0.26, 0.14, 0.4, 0, -0.02, 0.0005);
  // the message pad (a form) with the text; a pencil on it
  const padW = 0.2, padD = 0.145;
  const pad = new THREE.Group(); pad.name = 'pad'; pad.position.set(-0.035, 0, 0.13); pad.rotation.y = 0.08; root.add(pad);
  mesh(new THREE.BoxGeometry(padW, 0.008, padD), std({ color: 0xE0D8C4, roughness: 0.95 }), pad, 0, 0.004, 0);
  const doc = DOCS.wireless_form({ text: it.text ?? 'CQD CQD SOS DE MGY — WE HAVE STRUCK ICEBERG. SINKING FAST. COME TO OUR ASSISTANCE. POSITION 41.46 N 50.14 W', header: it.header, hand: it.hand || 'pencil', from: it.from, to: it.to, time: it.time, seed: 3 });
  const sheet = mesh(sheetGeo(padW, padD, 0.0012, 3), phys({ map: doc.tex, roughness: 0.93, sheen: 0.3, sheenColor: new THREE.Color(0xFFFFFF) }), pad, 0, 0.0083, 0); sheet.name = 'paper';
  const pencil = new THREE.Group(); pencil.position.set(0.075, 0.0123, 0.01); pencil.rotation.y = 0.5; pad.add(pencil);
  mesh(new THREE.CylinderGeometry(0.0036, 0.0036, 0.13, 6).rotateX(Math.PI / 2), std({ color: 0x7A2A1E, roughness: 0.45 }), pencil);
  mesh(new THREE.ConeGeometry(0.0036, 0.016, 6).rotateX(Math.PI / 2), std({ color: 0xD8B890, roughness: 0.8 }), pencil, 0, 0, 0.073);
  mesh(new THREE.ConeGeometry(0.0011, 0.0045, 12).rotateX(Math.PI / 2), std({ color: 0x2A2A2C, roughness: 0.35, metalness: 0.4 }), pencil, 0, 0, 0.0825);
  blob(pad, padW * 1.15, padD * 1.15, 0.5, 0, 0, 0.0005);
  // the receiver cabinet behind (depth), the lamp
  const cab = new THREE.Group(); cab.position.set(0.02, 0, -0.2); root.add(cab);
  const cw = varnished(woodTex('mahogany'), env, { clearcoat: 0.8 });
  mesh(new THREE.BoxGeometry(0.34, 0.2, 0.18), cw, cab, 0, 0.1, 0);
  const [dc, dg] = canvas(512, 512); dg.fillStyle = '#E8DFC8'; dg.beginPath(); dg.arc(256, 256, 256, 0, TAU); dg.fill(); dg.strokeStyle = '#222'; dg.fillStyle = '#222'; dg.lineWidth = 3; dg.beginPath(); dg.arc(256, 256, 220, Math.PI * 0.8, Math.PI * 2.2); dg.stroke(); for (let k = 0; k <= 20; k++) { const a = Math.PI * 0.8 + k / 20 * Math.PI * 1.4; dg.beginPath(); dg.moveTo(256 + Math.cos(a) * 220, 256 + Math.sin(a) * 220); dg.lineTo(256 + Math.cos(a) * (k % 5 ? 200 : 185), 256 + Math.sin(a) * (k % 5 ? 200 : 185)); dg.stroke(); } dg.font = font(600, 40, FAM.serif); dg.textAlign = 'center'; dg.fillText('TUNING', 256, 330);
  mesh(new THREE.CircleGeometry(0.035, 64), phys({ map: ctex(dc), roughness: 0.3, clearcoat: 1, envMap: env }), cab, -0.07, 0.11, 0.0905);
  mesh(new THREE.TorusGeometry(0.036, 0.004, 12, 64), brass, cab, -0.07, 0.11, 0.091);
  for (const x of [0.05, 0.12]) { mesh(knurl(0.014, 0.018, 24, 0.08).rotateX(Math.PI / 2), ebon, cab, x, 0.1, 0.1); mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.002, 32).rotateX(Math.PI / 2), brass, cab, x, 0.1, 0.091); }
  blob(cab, 0.42, 0.26, 0.55, 0, 0, 0.0005);
  const lights = [];
  if (lampOn) {
    const lamp = new THREE.Group(); lamp.name = 'lamp'; lamp.position.set(-0.3, 0, -0.14); root.add(lamp);
    mesh(lathe([[0, 0], [0.07, 0], [0.07, 0.012], [0.05, 0.02], [0.012, 0.03], [0.012, 0.3], [0, 0.3]], 48), brass, lamp);
    const shadeG = new THREE.Group(); shadeG.position.set(0.05, 0.3, 0.05); shadeG.rotation.set(0.35, 0, -0.4); lamp.add(shadeG);
    mesh(new THREE.CylinderGeometry(0.025, 0.09, 0.08, 48, 1, true), phys({ color: 0x1E5A34, roughness: 0.2, clearcoat: 1, side: THREE.DoubleSide, envMap: env, envMapIntensity: 0.8 }), shadeG);
    const inner = mesh(new THREE.CylinderGeometry(0.024, 0.088, 0.079, 48, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.8, 0.55).multiplyScalar(0.7), side: THREE.BackSide }), shadeG, 0, -0.001, 0, false); inner.name = 'glow_shade';
    mesh(new THREE.SphereGeometry(0.018, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.6).multiplyScalar(2.4) }), shadeG, 0, -0.02, 0, false).name = 'glow_bulb';
    const aim = new THREE.Object3D(); aim.position.set(0.48, -0.28, 0.48); lamp.add(aim);   // the pool falls on the message pad
    const sp = new THREE.SpotLight(0xFFBE7A, 7 * num(it.light_level, 1), 3, 0.95, 0.75, 2); sp.position.set(0.05, 0.28, 0.06); sp.target = aim; sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.camera.near = 0.05; sp.shadow.bias = -0.0003; sp.shadow.normalBias = 0.003; sp.shadow.radius = 4; lamp.add(sp); lights.push(sp);
    const fill = new THREE.PointLight(0xFFC890, 0.5 * num(it.light_level, 1), 3, 2); fill.position.set(0.3, 0.45, 0.6); root.add(fill);
    blob(lamp, 0.18, 0.18, 0.55, 0, 0, 0.0005);
  }
  // Morse on the key: `tap` true (the text's first words) | a string; wpm; tap_start
  const tapS = it.tap === false || it.tap == null ? null : (typeof it.tap === 'string' ? it.tap : 'CQD CQD SOS DE MGY');
  const unit = 1.2 / clamp(num(it.wpm, 16), 5, 30), tl = tapS ? morseTimeline(tapS, unit) : null, t0 = num(it.tap_start, 0.25);
  const isDown = (t) => { if (!tl || t < t0) return 0; const u = (t - t0) % tl.period; for (const [a, b] of tl.on) { if (u >= a && u < b) return clamp(Math.min((u - a) / 0.012, (b - u) / 0.012 + 0.2)); if (a > u) break; } return 0; };
  const knobA = anchor(lever, 'key', 0, 0.02, 0.088), padA = anchor(pad, 'pad', 0, 0.01, 0), hpA = anchor(hp, 'headphones', 0, 0.02, 0);
  const update = (t) => {
    if (resolveOn) resolveOn();
    const d = isDown(t); lever.rotation.x = d * 1.9 * DEG; spark.visible = d > 0.6;
    doc.update && doc.update(t, it.write);
  };
  update(0);
  return finish(root, ctx, { radius: 0.45, height: 0.35, update, anchors: { key: knobA, knob: knobA, pad: padA, paper: padA, text: padA, headphones: hpA } });
}

// ══ 4. detail.bell — ship's bell on a bracket, with a bell rope ══════════════════════════════════════════════════════
async function buildBell(kind, it, ctx) {
  await loadFonts();
  const elev = num(it.elev, 1.6);
  const { root, S, env, resolveOn } = propBase(kind, { surface: 'none', ...it, elev }, ctx, { surface: 'none', backdrop: 'dark', back: -0.2, aimY: -0.12, scale: 1.3, bokeh: false });
  const bronze = metal(it.metal || 'bronze', env, { env: 1.3, roughness: 0.28 });
  const wallM = S.backdrop === 'none' ? std({ color: 0x3A3630, roughness: 0.7 }) : null;
  if (wallM) mesh(new THREE.BoxGeometry(0.6, 0.9, 0.04), wallM, root, 0, -0.2, -0.2);
  // bracket: a wall plate, an arm with a scroll brace, the hanging pin
  const brk = new THREE.Group(); root.add(brk);
  const iron = std({ color: 0x1E1C1A, roughness: 0.45, metalness: 0.6, envMap: env, envMapIntensity: 0.5 });
  mesh(new THREE.BoxGeometry(0.1, 0.22, 0.012), iron, brk, 0, 0, -0.176);
  mesh(new THREE.BoxGeometry(0.026, 0.022, 0.2), iron, brk, 0, 0.055, -0.08);
  brk.add(tube([[0, -0.08, -0.17], [0, -0.03, -0.12], [0, 0.03, -0.07], [0, 0.046, -0.02]], 0.007, iron, 32, 8));
  mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 16).rotateZ(Math.PI / 2), bronze, brk, 0, 0.04, 0);
  // the bell: a lathe of the real profile (outer then inner), a crown lug; engraved `text` on the waist
  const bell = new THREE.Group(); bell.position.set(0, 0.04, 0); root.add(bell); bell.name = 'bell';
  const H = 0.24, prof = [[0, H + 0.002], [0.035, H], [0.066, H - 0.008], [0.08, H - 0.024], [0.088, H - 0.06], [0.094, H - 0.1], [0.1, H - 0.135], [0.112, H - 0.17], [0.13, H - 0.205], [0.145, H - 0.228], [0.149, H - 0.236], [0.147, H - 0.2405], [0.135, H - 0.238], [0.126, H - 0.222], [0.11, H - 0.185], [0.093, H - 0.14], [0.084, H - 0.1], [0.077, H - 0.06], [0.064, H - 0.03], [0.035, H - 0.018], [0, H - 0.016]];
  const bg = lathe(prof.map(([r, y]) => [r, y - H]), 160);
  // UVs: u around, v = height on the outer surface (for the engraving band)
  { const uv = bg.attributes.uv, p = bg.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); uv.setXY(i, (Math.atan2(x, z) / TAU + 0.5 + 1) % 1, (p.getY(i) + H) / H); } }
  const [ec, eg] = canvas(4096, 1024), [hc, hgc] = canvas(2048, 512);
  eg.fillStyle = '#FFFFFF'; eg.fillRect(0, 0, 4096, 1024); hgc.fillStyle = '#808080'; hgc.fillRect(0, 0, 2048, 512);
  const text = String(it.text ?? it.name ?? '').toUpperCase();
  const bands = (g, sc) => { g.fillRect(0, 1024 * sc * (1 - 0.3), 4096 * sc, 5 * sc); g.fillRect(0, 1024 * sc * (1 - 0.72), 4096 * sc, 5 * sc); g.fillRect(0, 1024 * sc * (1 - 0.78), 4096 * sc, 3 * sc); };
  eg.fillStyle = 'rgba(60,40,20,0.55)'; bands(eg, 1); hgc.fillStyle = '#FFFFFF'; bands(hgc, 0.5);
  if (text) {
    const lines = text.split(/\n|\|/).slice(0, 2);
    for (const [g, sc, col] of [[eg, 1, 'rgba(40,24,10,0.85)'], [hgc, 0.5, '#101010']]) {
      g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
      lines.forEach((s, i) => { g.font = font(700, (lines.length > 1 ? 92 : 120) * sc, FAM.caps); g.letterSpacing = `${14 * sc}px`; g.fillText(s, 2048 * sc, (1024 * (1 - 0.5) + (i - (lines.length - 1) / 2) * 120) * sc); });
    }
  }
  const bm = phys({ color: 0xFFFFFF, map: ctex(ec), normalMap: normalFrom(hc, 2.4), metalness: 1, roughness: 0.27, roughnessMap: null, envMap: env, envMapIntensity: 1.35 });
  bm.color.set(0xB88A48);
  mesh(bg, bm, bell); bell.children[0].name = 'bell_body';
  mesh(new THREE.TorusGeometry(0.017, 0.007, 12, 32), bronze, bell, 0, 0.012, 0);
  // clapper + rope (the rope hangs from the clapper's eye)
  const clap = new THREE.Group(); clap.position.set(0, -0.02, 0); bell.add(clap);
  mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.22, 12), metal('black_steel', env), clap, 0, -0.11, 0);
  mesh(new THREE.SphereGeometry(0.019, 24, 16), metal('black_steel', env, { roughness: 0.4 }), clap, 0, -0.226, 0);   // the ball just shows under the lip
  mesh(new THREE.TorusGeometry(0.008, 0.0025, 8, 20), metal('black_steel', env), clap, 0, -0.252, 0);
  const rope = new THREE.Group(); rope.position.set(0, -0.262, 0); clap.add(rope);
  const rl = num(it.rope, 0.45), ropeM = ropeMat('#E4D8BC', env);
  const r1 = tube([[0, 0, 0], [0, -rl * 0.3, 0.002], [0, -rl * 0.7, -0.002], [0, -rl, 0]], 0.0065, ropeM, 48, 10); ropeRepeat(r1, rl, 0.0065); rope.add(r1);
  mesh(new THREE.SphereGeometry(0.017, 20, 14).scale(1, 1.25, 1), ropeM, rope, 0, -rl * 0.55, 0);
  mesh(new THREE.CylinderGeometry(0.012, 0.022, 0.07, 20, 1, true), ropeMat('#EAE0C8', env), rope, 0, -rl - 0.03, 0);
  // ring: strikes at t (+ every `interval` s): the rope is pulled, the clapper swings to the sound bow and rebounds, the bell rocks
  const times = [];
  { const t0 = it.ring === true ? 0.6 : num(it.ring, num(it.t, null)); const n = Math.max(1, Math.round(num(it.strikes, 3))), iv = num(it.interval, 0.55); if (Array.isArray(it.ring)) times.push(...it.ring.map(Number).filter(Number.isFinite)); else if (t0 != null) for (let k = 0; k < n; k++) times.push(t0 + k * iv); }
  const hitA = Math.asin(0.116 / 0.226);
  const update = (t) => {
    if (resolveOn) resolveOn();
    let ca = 0, rock = 0, pull = 0;
    for (const th of times) {
      const d = t - th;
      if (d > -0.14 && d < 0) { const u = (d + 0.14) / 0.14; ca = Math.max(ca, hitA * u * u); pull = Math.max(pull, u); }
      else if (d >= 0 && d < 0.6) { ca = Math.max(ca, hitA * Math.max(0, Math.exp(-d * 9) * Math.cos(d * 22))); pull = Math.max(pull, Math.exp(-d * 5)); }
      rock += 0.06 * damped(d, 1.7, 3.2);
    }
    clap.rotation.z = ca; bell.rotation.z = rock; rope.rotation.z = -ca - rock + pull * 0.38;   // the hand pulls the rope out to the side; it hangs plumb between strikes
    bell.position.y = 0.04 + Math.abs(rock) * 0.002;
  };
  update(0);
  const faceA = anchor(bell, 'text', 0, -0.12, 0.1), mouthA = anchor(bell, 'mouth', 0, -0.23, 0), ropeA = anchor(rope, 'rope', 0, -0.2, 0);
  return finish(root, ctx, { radius: 0.3, height: 0.6, update, anchors: { face: faceA, text: faceA, bell: faceA, mouth: mouthA, rope: ropeA } });
}

// ══ router ═════════════════════════════════════════════════════════════════════════════════════════════════════════
async function buildPapers(kind, it, ctx) { await loadFonts(); return DOCS.build(kind, it, ctx, { propBase, finish, anchor }); }
const P_SET = { surface: "desk | table | wood | baize | deck | none (default per prop)", backdrop: 'dark | steel | none (a closed dark panelled set so the insert works in any scene)', light: 'warm | cool | top | none (a motivated key: a lamp just out of frame / a moonlit porthole)', light_level: 'x (1)', elev: 'm: surface height above the ground (desk 0.76)', place_on: "'structures:N.desk': stand on a room's desk (interior.study / office); offset [dx, dz] m on it (on = the same)", heading: 'deg: the side the reader / camera looks from' };
export const CATALOG = {
  'detail.watch': { section: 'objects', desc: 'INSERT: a gold pocket watch lying on a desk (open hunter lid with an engraved inscription, knurled crown, bow, chain to a T-bar, white enamel dial with Roman numerals and a seconds dial, blued Breguet hands, domed crystal). variant wall_clock = a drop-dial wall clock with a swinging pendulum. The hands show `time`; run true = real time (the seconds hand beats), a number = minutes per second of shot (time-lapse), false = a stopped watch; time_to + t = the hands sweep forward to that time at t (jump s)', params: { time: "'11:40' | '2:20:15' | '11:40 PM'", run: 'true | false (stopped) | minutes per second (time-lapse)', time_to: "'2:20'", t: 's: when the hands go to time_to', jump: 's (0.9)', variant: 'pocket | wall_clock', era: '1900s | modern', metal: 'gold | silver | nickel | steel', lid: 'open | closed | false', lid_angle: 'deg (155: lying back, the inscription up)', inscription: "text inside the lid ('To T. A.|1911')", maker: 'dial name', numerals: 'roman | arabic | sans', chain: 'false = none', tilt: 'deg: propped up on its 6 o’clock edge', seconds: 'wall clock: seconds hand', ...P_SET }, actions: ['run', 'time_to'], anchors: ['dial', 'crown', 'center'], footprint: [0.2, 0.3], height: 0.03, tags: ['detail', 'insert', 'watch', 'pocket watch', 'clock', 'time', 'close-up', 'macro'] },
  'detail.wall_clock': { section: 'objects', desc: 'INSERT: a drop-dial wall clock (octagonal mahogany surround, brass bezel, Roman dial, spade hands, seconds hand, a pendulum swinging in the drop window) on a panelled wall; era modern = a black-rimmed office clock with a red sweep hand. Same time params as detail.watch', params: { time: "'11:40'", run: 'true | false | minutes per second', time_to: "'2:20'", t: 's', jump: 's', era: '1900s | modern', seconds: 'true', elev: 'm dial centre above the floor (1.75)', maker: 'dial name', backdrop: 'dark | steel | none', light: 'warm | cool | top | none' }, actions: ['run', 'time_to'], anchors: ['dial'], footprint: [0.45, 0.1], height: 0.7, tags: ['detail', 'insert', 'clock', 'wall clock', 'time'] },
  'detail.telegraph': { section: 'objects', desc: "INSERT: a ship's brass engine-order telegraph on its pedestal (1.45 m): a drum head with twin enamel dials (FULL / HALF / SLOW AHEAD in cream, ASTERN in red, STOP, STAND BY, FINISHED WITH ENGINES), a double lever with a wooden grip that points at the order, the engine room's answer needles. move_to + t: the handle swings with an overshoot and a bell-ring jolt through the head; the answer follows ~1 s later; ring 2 = swung to the end and back (rung twice)", params: { setting: "'stop' | 'full ahead' | 'half astern' | 'stand by' | 'finished'", move_to: "'full astern'", t: 's: when the handle moves', ring: '1 | 2', answer_delay: 's (1)', station: "lower dial text ('ENGINE ROOM')", maker: 'dial maker line', ...P_SET, surface: 'deck (default) | none' }, actions: ['move_to'], anchors: ['face', 'handle', 'back', 'head'], footprint: [0.45, 0.45], height: 1.6, tags: ['detail', 'insert', 'ship', 'bridge', 'telegraph', 'engine order', 'full astern', 'titanic'] },
  'detail.wireless': { section: 'objects', desc: "INSERT: the Marconi room desk: a heavy brass Morse key on an ebonite base (lever, black knob, contacts, spring), headphones, a message form with the `text` handwritten in pencil (or typed), a pencil, a receiver cabinet with a tuning dial, a green-shaded desk lamp (the warm key light). tap = the key taps the Morse of a string; write [t0, t1] = the message is written as we watch", params: { text: "the message ('CQD CQD SOS DE MGY — WE HAVE STRUCK ICEBERG')", hand: 'pencil | ink | typed', write: '[t0, t1] s: the text appears letter by letter', header: "form title ('WIRELESS TELEGRAM')", from: "office of origin ('TITANIC')", to: 'addressee', time: "'11:45 PM'", tap: "true | 'SOS SOS' (Morse on the key)", wpm: 'Morse speed (16)', tap_start: 's', lamp: 'true | false', ...P_SET }, actions: ['tap', 'write'], anchors: ['key', 'pad', 'headphones'], footprint: [0.9, 0.5], height: 0.4, tags: ['detail', 'insert', 'wireless', 'marconi', 'morse', 'telegraph key', 'sos', 'cqd', 'radio'] },
  'detail.bell': { section: 'objects', desc: "INSERT: a ship's bronze bell on an iron wall bracket, with a white bell rope (Turk's head, tassel) on the clapper, the ship's name engraved on the waist. ring t: the rope is pulled, the clapper strikes the sound bow and rebounds, the bell rocks; strikes N at interval s (three bells = an object dead ahead)", params: { text: "engraving ('TITANIC|1912')", ring: 's | [t1, t2, ...] | true', strikes: 'n (3)', interval: 's (0.55)', rope: 'm (0.45)', elev: 'm pin height (1.6)', metal: 'bronze | brass', backdrop: 'dark | steel | none', light: 'warm | cool | top | none' }, actions: ['ring'], anchors: ['text', 'mouth', 'rope'], footprint: [0.35, 0.35], height: 0.6, tags: ['detail', 'insert', 'bell', 'ship', 'crow’s nest', 'warning', 'titanic'] },
  ...DOCS.CATALOG,
};
Object.assign(CATALOG, MORE_CATALOG, EXTRA_CATALOG);
for (const e of Object.values(CATALOG)) { e.tags = e.tags || []; if (!e.tags.includes('detail')) e.tags.push('detail'); }

export async function build(kind, item = {}, ctx = {}) {
  const cat = CATALOG[kind]?.params || {}, sp = {};
  for (const [k, v] of Object.entries(item.params || {})) if (v !== cat[k]) sp[k] = v;
  const it = { ...sp, ...item };
  const B = {
    'detail.watch': buildWatch, 'detail.wall_clock': buildWatch, 'detail.telegraph': buildTelegraph, 'detail.wireless': buildWireless, 'detail.bell': buildBell,
    'detail.papers': buildPapers, 'detail.tableware': buildTableware, 'detail.lifebuoy': buildLifebuoy, 'detail.sign': buildSign, 'detail.lantern': buildLantern,
    'detail.photo_frame': buildPhotoFrame, 'detail.compass': buildCompass, 'detail.binoculars': buildBinoculars,
  }[kind];
  if (!B) throw new Error('details.js: unknown kind ' + kind);
  await loadFonts();
  CUR_IT = it;
  try { return await B(kind, it, ctx, { propBase, finish, anchor }); } finally { CUR_IT = null; }
}
