// main.js — the Frontier 3D render page. Page contract (render.py depends on it):
//   index.html?w=1920&h=1080[&sub=N]
//   window.__ready / window.__error              boot finished / failed
//   await window.loadScene(spec, {cast, quality}) builds one scene (cached modules/textures/fonts between scenes)
//                                                 -> {dur, warnings, camera: {move, level, changes, ok, issues}}
//   window.renderFrame(t)                         draws frame t into canvas#c (sub-frames: motion blur + DOF, post)
//   window.qaFrame(t)                             {clearance_m, cam_speed, ang_speed, roll_deg, inside, fig_dist, warnings, transition}
//   window.qaScene(fps)                           every frame of the scene, aggregated (render.py's gate)
//   window.replan(level)                          re-plan the camera higher/slower/wider -> same report as loadScene.camera
//   window.grabFrame(q)                           {jpg: dataURL, stats: {mean, black, blown, thumb}} of the current canvas
//   window.getCatalog()                           the merged catalog (render.py --catalog)
// Every frame is a pure function of t: seeded randomness only, no clocks, no state carried between frames.
import * as THREE from 'three';
import * as TX from '../lib/shared/textures.js';
import { U, installFogChunks, patchMaterial } from '../lib/shared/env.js';
import { setGrime } from '../lib/shared/materials.js';
import * as MAT from '../lib/shared/materials.js';
import * as TEXT from '../lib/shared/text3d.js';
import { rng, clamp } from '../lib/shared/util.js';
import { makePost } from './post.js';
import { makeLook, TIMES, SKIES } from './look.js';
import { GRADES } from './post.js';
import { makeWeather } from './weather.js';
import { loadLibraries, buildScene, updateScene, makeContacts, catalogJSON } from './registry.js';
import { planCamera, orientLabels, bindLabels, apertureCap, MOVES } from './camera.js';
import { SPACE_CAMERA_DOC } from './spacecam.js';   // E4 v2: the space moves' catalog docs
import { makeProbe, qaFrameAt, qaSceneAt, transitionAt, LIMITS, resolveFigures, resolveLabels, physicalQA, cameraQA, faceStats, figureLuma, silhouetteSep } from './qa.js';
import { locomotionQA, locomotionIssues } from './loco.js';
import { normalizeSpec } from './spec.js';
import { attachAboard } from '../lib/human/aboard.js';
import { BUILTIN_CAST, LABEL_STYLES } from './fallback.js';

const Q = new URLSearchParams(location.search);
const W = +(Q.get('w') || 1920), H = +(Q.get('h') || 1080);
const FPS = 30;
const log = (...a) => console.log('[f3d]', ...a);

const FONTS = [
  ['Cinzel', 'Cinzel.ttf', { weight: '400 900' }], ['Inter Display', 'InterDisplay-Black.ttf', { weight: '900' }],
  ['Inter', 'Inter-SemiBold.ttf', { weight: '600' }], ['Inter', 'Inter-Bold.ttf', { weight: '700' }],
  ['EB Garamond', 'EB-Garamond.ttf', { weight: '400 800' }], ['EB Garamond', 'EB-Garamond-Italic.ttf', { weight: '400 800', style: 'italic' }],
  ['Courier Prime', 'CourierPrime.ttf', { weight: '400' }], ['Courier Prime', 'CourierPrime-Bold.ttf', { weight: '700' }], ['Special Elite', 'SpecialElite.ttf', { weight: '400' }],
];
const FONT_BASE = new URL('../fonts/', import.meta.url).href;

installFogChunks();
const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.0001);                 // turns USE_FOG on; env.js chunks do the work
const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 60000);
scene.add(camera);

let reg = null, look = null, weather = null, post = null, tex = null;
const cache = new Map();                   // builders' shared geometry/material/texture cache, kept for the whole job
let castDefs = {};
let quality = Q.get('quality') || 'final';
let cur = null;                            // the loaded scene

async function loadFonts() {
  await Promise.all(FONTS.map(async ([fam, file, desc]) => {
    try { const f = new FontFace(fam, `url(${FONT_BASE}${file})`, desc); await f.load(); document.fonts.add(f); }
    catch (e) { console.warn('[f3d] font', file, String(e)); }
  }));
}

async function boot() {
  const t0 = performance.now();
  tex = { grime: TX.grime(512), moon: TX.moon(128) };
  setGrime(tex.grime);
  await loadFonts();
  look = makeLook(renderer, scene, tex);
  weather = makeWeather(scene);
  post = makePost(renderer, W, H);
  reg = await loadLibraries();
  for (const w of reg.warnings) console.warn('[f3d]', w);
  log('libraries', JSON.stringify(reg.status), Object.keys(reg.catalog).length, 'kinds');
  log('boot', Math.round(performance.now() - t0), 'ms');
}

function disposeTree(root) {
  const keep = new Set();
  for (const v of cache.values()) collectKeep(v, keep);
  root.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry) && !o.geometry.userData?.keep) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (keep.has(m) || m.userData?.keep) continue;
      for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture && !keep.has(v) && !v.userData?.keep) v.dispose(); }
      m.dispose();
    }
  });
}
function collectKeep(v, keep, depth = 0) {
  if (!v || depth > 3) return;
  if (v.isBufferGeometry || v.isMaterial || v.isTexture) { keep.add(v); return; }
  if (typeof v === 'object') for (const k of Object.keys(v)) collectKeep(v[k], keep, depth + 1);
}

function subFrames() {
  const q = Q.get('sub');
  if (q) return clamp(+q, 1, 16);
  const r = cur?.spec.render?.sub;
  if (r) return clamp(Math.round(+r), 1, 12);
  return Math.max(quality === 'draft' ? 2 : 6, cur?.plan?.minSub?.[quality] ?? 0);   // a rack focus needs more aperture samples (Q6)
}

async function loadScene(rawSpec, opts = {}) {
  const t0 = performance.now();
  if (opts.cast) setCast(opts.cast);
  if (opts.quality) quality = opts.quality;
  const { spec, warnings } = normalizeSpec(rawSpec);
  if (Array.isArray(rawSpec?.castDefs)) setCast(rawSpec.castDefs);
  if (cur) { scene.remove(cur.stage); disposeTree(cur.stage); cur = null; }
  const stage = new THREE.Group(); stage.name = 'stage'; scene.add(stage);
  const ground = { height: () => 0, normal: () => [0, 1, 0] };
  const groundProxy = { height: (x, z) => ctx.ground.height(x, z), normal: (x, z) => ctx.ground.normal(x, z) };
  const windSpd = clamp(spec.weather.wind ?? 0.15) * 12, windDir = (spec.weather.windDir ?? ((spec.seed * 137) % 360)) * Math.PI / 180;
  const ctx = {
    THREE, scene: stage, world3: scene, renderer, ground, rng: (s) => rng(s), patch: (m) => patchMaterial(m), text3d: TEXT,
    cast: castDefs, lod: { detail: quality === 'draft' ? 0.5 : 1, far: 1 }, quality, tex, cache, seed: spec.seed, dur: spec.dur,
    U, materials: MAT, lookSpec: spec.look, weatherSpec: spec.weather, fonts: FONT_BASE,
    wind: { x: Math.sin(windDir) * windSpd, z: -Math.cos(windDir) * windSpd, speed: windSpd },
    warn: (m) => warnings.push(String(m)), warnings,
  };
  ctx.contacts = makeContacts(stage, groundProxy, ctx.patch);
  const S = await buildScene(reg, spec, ctx, castDefs, warnings);
  const aboard = attachAboard(S, ctx, warnings);                    // E2 v2: cast / groups standing on a ship's deck point
  ctx.contacts.finalize();
  try { resolveFigures(S, (x, z) => ctx.ground.height(x, z), warnings); } catch (e) { console.error(e); warnings.push('placement check failed: ' + String(e).slice(0, 160)); }   // E1 v2: nobody inside furniture
  const W = worldClock(spec);
  if (W) applyWorldClock(S, W);
  const bound = bindLabels(S, (x, z) => { const g = ctx.ground.height(x, z); return S.water != null ? Math.max(g, S.water) : g; }, W, spec.dur, warnings);   // text `on` an item (Q6)
  // every material gets the shared height fog (idempotent for the ones the builders already patched)
  stage.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (!m.isShaderMaterial && !m.isRawShaderMaterial) patchMaterial(m); }); });
  const tb = performance.now();
  let probe = makeProbe(S, stage, ctx, spec.dur);
  let plan = planCamera(spec, S, probe, { warnings, W });
  const turned = orientLabels(S, plan, spec.dur);
  if (turned.length) {
    probe = makeProbe(S, stage, ctx, spec.dur);
    const qa = qaSceneAt(plan.camAt, probe, spec, spec.dur, 10);
    if (!qa.ok) { const p2 = planCamera(spec, S, probe, { warnings, W }); p2.changes.unshift('re-planned after turning the labels to the camera'); plan = p2; }
    plan.changes.push(...turned);
  }
  if (bound.length) plan.changes.push(...bound);
  try { resolveLabels(S, plan, stage, spec.dur, plan.changes); } catch (e) { console.error(e); }   // E1 v2: an occluded label is lifted or goes to screen space
  const tc = performance.now();
  const baseY = S.water != null ? Math.max(ctx.ground.height(0, 0), S.water) : ctx.ground.height(0, 0);
  const L = look.apply(spec.look, spec.weather, { viewAz: plan.viewAz, side: (spec.seed % 2) ? 1 : -1, quality, baseY: Math.min(baseY, plan.shadow.y), noClouds: /space|mars|interior/.test(S.world?.hints?.sky || ''), interior: S.world?.hints?.sky === 'interior' });   // E1 v2: interior void
  warnings.push(...L.warnings);
  weather.set(spec.weather, L.env, spec.seed);
  look.setShadowBox(plan.shadow.cx, plan.shadow.cz, plan.shadow.S, plan.shadow.y);
  look.setShadowMap(quality === 'draft' ? 2048 : 4096);
  cur = { spec, S, ctx, stage, plan, probe, L, warnings, dur: spec.dur, W, gov: look.governor ? look.governor(stage, S, spec.look) : null };   // E1 v2: practicals never blow out a face
  // compile every program now so the first frames are not slower (or different) than the rest
  applyAt(0);
  renderer.compile(scene, camera);
  try { const ec = exposureCeiling(); if (ec && (ec.expK < 1 || ec.glowK < 1)) plan.changes.push(`exposure ceiling: ${(ec.hot0 * 100).toFixed(0)} % of the frame clipped -> ${(ec.hot * 100).toFixed(0)} % (exposure x${ec.expK}${ec.glowK < 1 ? `, sun/glow x${ec.glowK}` : ''})`); } catch (e) { console.error(e); }   // E1 final
  try { const ef = (cur.expK ?? 1) < 1 ? null : exteriorFloor(); if (ef && ef.expK > 1) plan.changes.push(`exposure floor (${cur.L.time}): the frame's p90 ${ef.p90.toFixed(0)} and the hero's outline ${(ef.sep * 100).toFixed(0)} % -> x${ef.expK} (p90 ${ef.p90b.toFixed(0)}, outline ${(ef.sepb * 100).toFixed(0)} %)`); } catch (e) { console.error(e); }   // E1 v2
  try { cur.autoExp = autoExpose(); if (cur.autoExp?.rim) plan.changes.push(`character rim: ${cur.autoExp.who} body-outline separation ${(cur.autoExp.sep0 * 100).toFixed(0)} % -> ${(cur.autoExp.sep * 100).toFixed(0)} % (cool moonlight rim ${cur.autoExp.rim.toFixed(1)} cd from behind; the lamp stays the key)`); } catch (e) { console.error(e); }   // E1 v2
  const res = { id: spec.id, dur: spec.dur, warnings, camera: camReport(plan), world: S.worldKind, items: S.items.length,
    build_ms: Math.round(tb - t0), plan_ms: Math.round(tc - tb), look: { time: L.time, sky: L.sky, sunAz: Math.round(L.sunAz), sunEl: L.sunEl, grade: L.grade }, sub: subFrames() };
  // the world clock as the director needs it: world time at the scene's start, end and every ramp key (Q6)
  if (W) res.clock = { start: +W(0).toFixed(3), end: +W(spec.dur).toFixed(3), offset: +W.info.offset.toFixed(3), at_keys: W.info.keys.map(([t]) => [t, +W(t).toFixed(3)]) };
  log('scene', spec.id, JSON.stringify({ build: res.build_ms, plan: res.plan_ms, move: plan.move, level: plan.level, warnings: warnings.length }));
  return res;
}
// E1 v2: in a room the character always reads, by SEPARATION, not fill: the lamp stays the warm key (face, hands,
// papers); a cool moonlight rim from behind the figure (the window's side when the room has one) outlines the head,
// shoulders and back so the dark silhouette stands off the dark room, and the coat keeps its dark colour. Metered on
// real frames (3 sub-frame-1 renders): silhouetteSep (qa.js, the share of the outline that differs >= 14 luma from the
// room behind it) brought to >= 0.5, at most 40 cd / exposure, the head core <= 160, no new clipped area (no glowing
// halo); no exposure lift. Fixed per scene.
const sepHide = () => [scene.getObjectByName('sky'), cur?.S?.world?.root].filter(Boolean);
// the camera's hero item: spec.camera.target 'objects:1' | 'ref:titanic' | 'titanic.stern' (an anchor of an item)
function targetItem() {
  const t = cur?.spec?.camera?.target; if (typeof t !== 'string') return null;
  const B = cur.S.byRef || {}, h = t.split('.')[0];
  return B[t] || B['ref:' + t] || B[h] || B['ref:' + h] || null;
}
// E1 v2: dawn / dusk / golden exteriors keep their hero readable: when the frame's 90th percentile is under 70 and the
// camera target's outline does not separate (silhouetteSep < 0.35), the exposure is lifted (x1.4 .. x3.6) until it
// does or the frame's p90 reaches 75, never past a new blown area. Night keeps its darkness (too_dark flags it).
// E1 final: the mirror of the floor, an exposure CEILING for every scene. Metered on 3 sub-frame-1 renders (moments
// inside a whiteout or a designed flash are skipped): when more than 12 % of the frame is clipped (blown_area's
// measure), the exposure steps down (x0.8 .. x0.45) and, if that is not enough, the additive glows of suns and space
// bodies (halos, coronas) are dimmed, until the clipped share is under 6 % - while the hero still reads (its outline
// separation is not lost). Fixed per scene.
// the worst of: the clipped share (blown_area's measure) and half the near-white share (luma >= 205: a washed-out
// frame, e.g. a pale sunlit surface filling it)
function frameHot(ts) {
  let hot = 0;
  for (const t of ts) {
    post.frame(1, (j) => renderSub(t, j, 1), Math.round(t * FPS), gradeAt(t), t);
    thumbCx.drawImage(canvas, 0, 0, 64, 36); const d = thumbCx.getImageData(0, 0, 64, 36).data; let c = 0, w = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; if (l >= 150 && Math.max(d[i], d[i + 1], d[i + 2]) >= 245) c++; if (l >= 185) w++; if (l >= 150) b++; }
    hot = Math.max(hot, c / 2304, 0.5 * w / 2304); frameHot.bright = Math.max(frameHot.bright || 0, b / 2304);
  }
  return hot;
}
function glowMeshes() {
  const out = [];
  for (const it of cur.S.items) {
    if (!/^space\.|sun|solar|star/i.test(it.kind || '') || /starfield/.test(it.kind || '')) continue;
    it.res.root.traverse((o) => { const m = o.material; if (o.isMesh && m && !Array.isArray(m) && (m.blending === THREE.AdditiveBlending || (m.isMeshBasicMaterial && m.color && Math.max(m.color.r, m.color.g, m.color.b) > 4))) out.push(o); });   // halos + HDR sun cores (their bloom)
  }
  return out;
}
function dimGlow(o, k) {
  const m = o.material;
  if (m.isShaderMaterial) {
    if (!m.uniforms.uGlowK) {
      const re = /gl_FragColor\s*=\s*vec4\(([^;]*?),\s*1\.0\s*\)\s*;/;
      if (!re.test(m.fragmentShader)) return false;
      m.uniforms.uGlowK = { value: 1 };
      m.fragmentShader = 'uniform float uGlowK;\n' + m.fragmentShader.replace(re, 'gl_FragColor = vec4(($1) * uGlowK, 1.0);');
      m.needsUpdate = true;
    }
    m.uniforms.uGlowK.value = k; return true;
  }
  if (m.color) { if (m.userData.glow0 == null) m.userData.glow0 = m.color.clone(); m.color.copy(m.userData.glow0).multiplyScalar(k); return true; }
  return false;
}
function exposureCeiling() {
  if (!cur) return null;
  const flashAt = (t) => { try { const w = cur.S.world; return w && typeof w.flashAt === 'function' ? +w.flashAt(t) || 0 : 0; } catch (e) { return 0; } };
  const ts = [0.05, 0.35, 0.7].map((f) => f * cur.dur).filter((t) => transitionAt(cur.spec, t, cur.dur).white < 0.01 && !(flashAt(t) > 0));
  if (!ts.length) return null;
  frameHot.bright = 0; const h0 = frameHot(ts), b0 = frameHot.bright, hasGlow = glowMeshes().length > 0;
  if (h0 <= 0.12 && !(hasGlow && b0 > 0.15)) return { hot0: h0, hot: h0, expK: 1, glowK: 1 };
  const it = targetItem();
  const sepNow = () => { if (!it) return null; const t = ts[Math.floor(ts.length / 2)]; post.frame(1, (j) => renderSub(t, j, 1), Math.round(t * FPS), gradeAt(t), t); const q = silhouetteSep(renderer, scene, camera, it, canvas, sepHide()); return q && q.sep != null ? q.sep : null; };
  const s0 = sepNow();
  let expK = 1, glowK = 1, hot = h0;
  for (const k of (h0 > 0.12 ? [0.8, 0.64, 0.52, 0.45] : [])) {
    cur.expK = k; const h = frameHot(ts), sp = sepNow();
    if (s0 != null && sp != null && sp < Math.min(0.35, s0 - 0.05)) break;          // the hero stops reading: stop here
    expK = k; hot = h; if (h < 0.06) break;
  }
  cur.expK = expK;
  // a sun / glow halo never covers more than ~15 % of the frame with bright light
  const glows = glowMeshes();
  frameHot.bright = 0; hot = frameHot(ts);
  if (glows.length && (hot >= 0.06 || frameHot.bright > 0.15)) {
    for (const k of [0.5, 0.25, 0.12, 0.06]) {
      if (!glows.map((o) => dimGlow(o, k)).some(Boolean)) break;
      frameHot.bright = 0; glowK = k; hot = frameHot(ts); if (hot < 0.06 && frameHot.bright <= 0.15) break;
    }
  }
  return { hot0: h0, hot, expK, glowK };
}
function exteriorFloor() {
  if (!cur || cur.L?.interior || !/^(dawn|dusk|golden)$/.test(cur.L?.time || '')) return null;
  const it = targetItem(); if (!it) return null;
  const ts = [0.2, 0.5, 0.8].map((f) => f * cur.dur);
  const meter = () => {
    let p90 = 999, sp = 0, ns = 0, hot = 0;
    for (const t of ts) {
      post.frame(1, (j) => renderSub(t, j, 1), Math.round(t * FPS), gradeAt(t), t);
      const q = silhouetteSep(renderer, scene, camera, it, canvas, sepHide()); if (q && q.sep != null) { sp += q.sep; ns++; }
      thumbCx.drawImage(canvas, 0, 0, 64, 36); const d = thumbCx.getImageData(0, 0, 64, 36).data, ls = []; let c = 0;
      for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; ls.push(l); if (l >= 150 && Math.max(d[i], d[i + 1], d[i + 2]) >= 245) c++; }
      ls.sort((x, y) => x - y); p90 = Math.min(p90, ls[Math.floor(ls.length * 0.9)]); hot = Math.max(hot, c / 2304);
    }
    return { p90, sep: ns ? sp / ns : 0, hot };
  };
  const m0 = meter();
  if (m0.p90 >= 70 || m0.sep >= 0.35) return { p90: m0.p90, sep: m0.sep, expK: 1 };
  let best = { k: 1, m: m0 };
  for (const k of [1.4, 2.0, 2.8, 3.6]) {
    cur.expK = k; const m = meter();
    if (m.hot > Math.max(0.06, m0.hot + 0.02)) break;
    best = { k, m }; if (m.p90 >= 75 || m.sep >= 0.4) break;
  }
  cur.expK = best.k;
  return { p90: m0.p90, sep: m0.sep, expK: best.k, p90b: best.m.p90, sepb: best.m.sep };
}
function autoExpose() {
  if (!cur || !cur.L?.interior) return null;
  const figs = cur.S.items.filter((it) => it.res.figure?.rig?.B?.head && (it.section === 'cast' || it.figure));
  if (!figs.length) return null;
  const tgt = cur.S.byRef?.[cur.spec.camera?.target], it = figs.includes(tgt) ? tgt : figs[0], fig = it.res.figure;
  const ts = [0.2, 0.5, 0.8].map((f) => f * cur.dur), who = `${it.section}:${it.ref || it.index}`;
  const meter = () => {
    let sp = 0, ns = 0, h = 0, hot = 0, mean = 0, nm = 0;
    for (const t of ts) {
      post.frame(1, (j) => renderSub(t, j, 1), Math.round(t * FPS), gradeAt(t), t);
      const f = figureLuma(it, camera, canvas, faceCx), hd = faceStats({ items: [it] }, camera, canvas, faceCx)[0];
      if (f) { mean += f.mean; nm++; }
      if (hd) h = Math.max(h, hd.mean);
      const q = silhouetteSep(renderer, scene, camera, it, canvas, sepHide());
      if (q && q.sep != null) { sp += q.sepBody ?? q.sep; ns++; }                 // the body outline (the head reads by itself)
      thumbCx.drawImage(canvas, 0, 0, 64, 36); const d = thumbCx.getImageData(0, 0, 64, 36).data; let c = 0;
      for (let i = 0; i < d.length; i += 4) if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] >= 150 && Math.max(d[i], d[i + 1], d[i + 2]) >= 245) c++;
      hot = Math.max(hot, c / 2304);
    }
    return ns ? { sep: sp / ns, head: h, hot, mean: nm ? mean / nm : null } : null;
  };
  const m0 = meter();
  if (!m0 || m0.sep >= 0.45) return m0 ? { who, sep0: m0.sep, sep: m0.sep, rim: 0, mean: m0.mean } : null;
  applyAt(cur.dur / 2);
  const B = fig.rig.B, neck = B.neck.getWorldPosition(new THREE.Vector3()), c = cur.plan.camAt(cur.dur / 2);
  const d = new THREE.Vector3(c.pos[0] - neck.x, 0, c.pos[2] - neck.z).normalize(), side = new THREE.Vector3(-d.z, 0, d.x);
  // the window's side, if the room has one (anchors.window), else the side away from the nearest practical
  const room = cur.S.items.find((x) => /^interior\./.test(x.kind) && x.res.anchors?.window);
  const wv = room ? room.res.anchors.window.getWorldPosition(new THREE.Vector3()) : null;
  const sgn = wv ? (side.dot(wv.sub(neck)) >= 0 ? 1 : -1) : 1;
  const rim = new THREE.SpotLight(0xC2D0EA, 0, 4.5, 0.55, 0.6, 2); rim.name = 'character_rim'; rim.userData.noGovern = true;
  rim.position.copy(neck).addScaledVector(d, -1.1).addScaledVector(side, 0.6 * sgn); rim.position.y += 1.3;   // a top-back light: it grazes the head, shoulders and back
  rim.target.position.copy(neck); cur.stage.add(rim, rim.target); rim.target.updateMatrixWorld();
  const ex = Math.max(0.05, look.grade(cur.spec.look, {}).exposure), Imax = 40 / ex;          // subtle: never a glowing halo
  const ok = (m) => m.head <= 160 && m.hot <= m0.hot + 0.004;
  let lo = 0, hi = null, I = 5 / ex, best = { I: 0, m: m0 };
  for (let k = 0; k < 7; k++) {
    rim.intensity = I; const m = meter(); if (!m) break;
    if (ok(m)) { lo = I; best = { I, m }; if (m.sep >= 0.45 || I >= Imax) break; } else hi = I;
    I = hi == null ? Math.min(Imax, I * 2) : (lo + hi) / 2;
  }
  rim.intensity = best.I;
  return { who, sep0: m0.sep, sep: best.m.sep, rim: best.I, head: best.m.head, mean: best.m.mean };
}
function camReport(plan) {
  return { move: plan.move, requested: plan.requested, level: plan.level, changes: plan.changes, ok: plan.ok, issues: plan.issues, dof: plan.dof, view_az: Math.round(plan.viewAz) };
}

function setCast(list) {
  castDefs = {};
  for (const d of list || []) if (d && d.id) castDefs[d.id] = d;
  if (!castDefs.witness) castDefs.witness = BUILTIN_CAST.witness;
}

// camera + world at time tt (one sub-frame)
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _dofA = new THREE.Vector3(), _dofC = new THREE.Vector3(), _dofF = new THREE.Vector3();
function setCamera(c) {
  camera.position.set(...c.pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(_tmp.set(...c.look));
  if (c.roll) camera.rotateZ(c.roll);
  camera.fov = c.fov ?? 40; camera.near = c.near ?? 0.05; camera.far = c.far ?? 60000;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
function applyAt(tt) {
  const c = cur.plan.camAt(tt);
  setCamera(c);
  const wt = cur.W ? cur.W(tt) : tt;          // the world's time (spec.clock), the camera keeps the scene's own t
  updateScene(cur.S, tt, tt, camera, cur.ctx);  // items and the world are wrapped by applyWorldClock
  if (cur.gov) cur.gov();                        // E1 v2: cap practical lights at the nearest head (look.js governor)
  weather.update(wt, camera, H);
  look.frame(wt);
  return c;
}

// ── optional world clock (additive): spec.clock = { offset, rate, freeze_at, ease } ─────────────────────────────────
// maps the scene's t (camera, transitions) to the world's t (every item, the world, weather, sky):
// w(t) = offset + rate * t', where t' decelerates smoothly (constant deceleration, `ease` s, default 0.35) to a stop
// at freeze_at. { offset: T, rate: 0 } is a world frozen at T while the camera keeps moving (a "freeze it" moment).
// speed ramps (Q6): keys [{t, rate}] = the world's rate at scene time t, smoothstep-eased between keys and held outside;
// the world time is its exact integral (w = offset + R(t'), R(x) = int_0^x rate), so it never jumps and never runs back.
// keys replace `rate`; freeze_at still decelerates the scene time first. sync {t, w}: solve the offset so the world
// shows its time w at scene time t (put an FX event on a scored sound cue).
function worldClock(spec) {
  const c = spec.clock;
  if (!c || typeof c !== 'object') return null;
  let off = Number.isFinite(+c.offset) ? +c.offset : 0;
  const rate = Number.isFinite(+c.rate) ? +c.rate : 1;
  const fz = c.freeze_at != null && Number.isFinite(+c.freeze_at) ? +c.freeze_at : null;
  const e = Math.max(0.01, Number.isFinite(+c.ease) ? +c.ease : 0.35);
  const K = (Array.isArray(c.keys) ? c.keys : []).filter((k) => k && Number.isFinite(+k.t) && Number.isFinite(+k.rate))
    .map((k) => [+k.t, clamp(+k.rate, 0, 8)]).sort((a, b) => a[0] - b[0])
    .filter((k, i, a) => i === a.length - 1 || a[i + 1][0] - k[0] > 1e-4);           // two keys at one time: the later wins
  const sync = c.sync && Number.isFinite(+c.sync.t) && Number.isFinite(+c.sync.w) ? [+c.sync.t, +c.sync.w] : null;
  if (off === 0 && rate === 1 && fz == null && !K.length && !sync) return null;
  const U = (t) => {
    let u = t;
    if (fz != null) { const a = fz - e; if (t > a) { const d = Math.min(t, fz) - a; u = a + d - d * d / (2 * e); } }
    return u;
  };
  let R = (x) => rate * x;
  if (K.length) {
    // G(x) = int_{t0}^{x} rate; within a segment rate = r_i + (r_i+1 - r_i) * smoothstep(u) -> int = u^3 - u^4 / 2
    const Gk = [0];
    for (let i = 0; i < K.length - 1; i++) { const T = K[i + 1][0] - K[i][0]; Gk.push(Gk[i] + T * (K[i][1] + K[i + 1][1]) / 2); }
    const Gx = (x) => {
      if (x <= K[0][0]) return K[0][1] * (x - K[0][0]);
      const n = K.length - 1;
      if (x >= K[n][0]) return Gk[n] + K[n][1] * (x - K[n][0]);
      let i = 0; while (i < n - 1 && x >= K[i + 1][0]) i++;
      const T = K[i + 1][0] - K[i][0], u = (x - K[i][0]) / T;
      return Gk[i] + K[i][1] * (x - K[i][0]) + (K[i + 1][1] - K[i][1]) * T * (u * u * u - u * u * u * u / 2);
    };
    const G0 = Gx(0);
    R = (x) => Gx(x) - G0;
  }
  if (sync) off = sync[1] - R(U(sync[0]));
  const W = (t) => off + R(U(t));
  W.info = { offset: off, keys: K, sync };
  return W;
}
function applyWorldClock(S, W) {
  const wrap = (o) => {
    if (!o) return;
    if (typeof o.update === 'function') { const u = o.update; o.update = (t, clock, cam) => u.call(o, W(t), W(clock ?? t), cam); }
    if (typeof o.members === 'function') { const m = o.members; o.members = (t) => m.call(o, W(t)); }
    if (typeof o.positionAt === 'function') { const p = o.positionAt; o.positionAt = (t) => p.call(o, W(t)); }
    if (o.loco && typeof o.loco.walkers === 'function') { const w = o.loco.walkers; o.loco.walkers = (t) => w.call(o.loco, W(t)); }
  };
  wrap(S.world);
  for (const it of S.items) if (!it.label) wrap(it.res);     // text runs on the narration's (scene) time, not the world's (Q6)
}
function renderSub(tt, j, n) {
  const c = applyAt(tt);
  const rack = cur.plan.focusAt && n > 2 ? cur.plan.focusAt(tt, c) : null;      // camera.focus keys: {dist, a} (Q6)
  const ap = rack ? 1 : cur.plan.dof && n > 2 ? cur.plan.dof : 0;
  if (ap > 0) {
    const f = rack ? c.look : cur.plan.focusFn(tt);
    if (f) {
      camera.matrixWorld.extractBasis(_r, _u, _f);
      // fix: focus on the plane at the subject's depth ALONG the view axis and re-aim at the point on the central ray,
      // so a framed composition (subject off-centre, keys moves) keeps its framing; a centred subject is unchanged
      const dx = f[0] - c.pos[0], dy = f[1] - c.pos[1], dz = f[2] - c.pos[2];
      const dist = rack ? rack.dist : Math.max(0.3, -(dx * _f.x + dy * _f.y + dz * _f.z));
      // the aperture never makes the nearest solid in frame (a foreground tree, a passing figure) a multi-copy ghost (Q6)
      const a = Math.min(rack ? rack.a : ap * 0.0028 * dist * (quality === 'draft' ? 0.5 : 1), apertureCap(cur.plan.nearAt ? cur.plan.nearAt(tt) : null, dist, c.fov, rack ? 7 : 4.5));
      const ga = 2.399963229728653, rr = a * Math.sqrt((j + 0.5) / n), ang = j * ga + 0.7;
      _tmp.set(c.pos[0] - _f.x * dist, c.pos[1] - _f.y * dist, c.pos[2] - _f.z * dist);
      camera.position.addScaledVector(_r, Math.cos(ang) * rr).addScaledVector(_u, Math.sin(ang) * rr);
      // E1 v2: titles are graphics: compensate every story label for this aperture offset (no ghost copies, labels.js)
      if (!cur.dofLabels) cur.dofLabels = cur.S.items.filter((it) => it.label && typeof it.res.dofShift === 'function');
      if (cur.dofLabels.length) {
        _dofA.set(0, 0, 0).addScaledVector(_r, Math.cos(ang) * rr).addScaledVector(_u, Math.sin(ang) * rr); _dofC.set(...c.pos); _dofF.set(-_f.x, -_f.y, -_f.z);
        for (const it of cur.dofLabels) it.res.dofShift(_dofA, dist, _dofC, _dofF);
      }
      camera.lookAt(_tmp);
      if (c.roll) camera.rotateZ(c.roll);
      camera.updateMatrixWorld();
    }
  }
  // sub-pixel jitter per sub-frame (Halton 2,3; Q2): the sub-frames also supersample every edge, and the fixed per-pixel
  // alpha-to-coverage pattern of foliage averages out instead of reading as stipple
  const jit = n > 1 ? [halton(j + 1, 2) - 0.5, halton(j + 1, 3) - 0.5] : null;
  if (jit) camera.setViewOffset(W, H, jit[0], jit[1], W, H);
  renderer.shadowMap.autoUpdate = true;
  renderer.setRenderTarget(post.rtScene); renderer.clear();
  renderer.render(scene, camera);
  if (jit) camera.clearViewOffset();
}
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
function gradeAt(t) {
  const g = look.grade(cur.spec.look, { dark: /^(space|interior)$/.test(cur.S.world?.hints?.sky || '') });   // Q5: space/moon keep shadow detail
  const tr = transitionAt(cur.spec, t, cur.dur);
  g.warp = tr.warp; g.warpDir = tr.warpDir;             // E1 v2: the whip's side of the cut
  if (cur.expK) g.exposure *= cur.expK;                  // E1 v2: the dawn/dusk exposure floor (exteriorFloor)
  g.white = Math.max(g.white ?? 0, tr.white);
  return g;
}

window.renderFrame = (t) => {
  if (!cur) throw new Error('no scene loaded');
  cur.tNow = t;                                   // E4 v2: grabFrame reports a designed flash at this t (render.py: not a jump)
  const n = subFrames(), shutter = cur.spec.render?.shutter ?? 0.5;
  post.frame(n, (j) => renderSub(t + ((j + 0.5) / n - 0.5) * shutter / FPS, j, n), Math.round(t * FPS), gradeAt(t), t);
  return true;
};
window.qaFrame = (t) => { if (!cur) throw new Error('no scene loaded'); return qaFrameAt(cur.plan.camAt, cur.probe, t, cur.spec, cur.dur); };
window.qaScene = (fps = 30) => {
  if (!cur) throw new Error('no scene loaded');
  const r = qaSceneAt(cur.plan.camAt, cur.probe, cur.spec, cur.dur, fps);
  // locomotion (QUALITY.md H1, core/loco.js): independent of the camera, measured once per scene. `ok` stays the camera
  // gate (render.py re-plans on it); the locomotion verdict is qa.locomotion.ok and its flags join qa.issues
  if (!cur.loco) {
    try { cur.loco = locomotionQA(cur.S, cur.dur, (x, z) => cur.ctx.ground.height(x, z)); }
    catch (e) { console.error(e); cur.loco = { ok: true, error: String(e).slice(0, 300), checked: 0, flagged: [], items: [] }; }
    try { applyAt(0); } catch (e) { /* the next renderFrame sets every item again */ }
  }
  r.locomotion = cur.loco;
  r.issues = r.issues.concat(locomotionIssues(cur.loco, cur.dur));
  // E1 v2: coded physical / cinematography issues, as strings '<code>: ...' (they never flip r.ok, the camera gate)
  if (!cur.phys) {
    try { cur.phys = physicalQA(cur.S, cur.dur, (x, z) => cur.ctx.ground.height(x, z)); } catch (e) { console.error(e); cur.phys = { issues: [], error: String(e).slice(0, 300) }; }
    try { applyAt(0); } catch (e) { /* */ }
  }
  let camIssues = [];
  try { camIssues = cameraQA(cur.spec, cur.S, cur.plan, cur.stage, cur.dur, { w: W, h: H }); } catch (e) { console.error(e); camIssues = []; }
  try { applyAt(0); } catch (e) { /* */ }
  r.issues = r.issues.concat(cur.phys.issues, camIssues);
  if (cur.phys.error) r.physical_error = cur.phys.error;
  return r;
};
window.replan = (level = 1) => {
  if (!cur) throw new Error('no scene loaded');
  const warnings = [];
  const plan = planCamera(cur.spec, cur.S, cur.probe, { warnings, relax: clamp(level, 0, 4), replan: level, W: cur.W });
  plan.changes.unshift(`replan requested at relax level ${level}`);
  cur.plan = plan; cur.warnings.push(...warnings);
  look.setShadowBox(plan.shadow.cx, plan.shadow.cz, plan.shadow.S, plan.shadow.y);
  return camReport(plan);
};
window.worldTime = (t) => (cur && cur.W ? cur.W(t) : t);          // scene time -> world time (spec.clock), for the director
window.setCast = (list) => { setCast(list); return Object.keys(castDefs); };
window.setQuality = (q) => { quality = q === 'draft' ? 'draft' : 'final'; return quality; };
window.loadScene = loadScene;
const thumbCv = document.createElement('canvas'); thumbCv.width = 64; thumbCv.height = 36;
const thumbCx = thumbCv.getContext('2d', { willReadFrequently: true });
const faceCv = document.createElement('canvas'); faceCv.width = faceCv.height = 32;
const faceCx = faceCv.getContext('2d', { willReadFrequently: true });
window.grabFrame = (q = 0.95) => {
  thumbCx.drawImage(canvas, 0, 0, 64, 36);
  const d = thumbCx.getImageData(0, 0, 64, 36).data;
  const th = new Uint8Array(64 * 36); let sum = 0, black = 0, blown = 0, hot = 0;
  for (let i = 0; i < th.length; i++) {
    const l = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    th[i] = l; sum += l; if (l < 6) black++; if (l > 250) blown++;
    if (l >= 150 && Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) >= 245) hot++;          // E1 v2: blown_area (a clipped channel, bright)
  }
  let bin = ''; for (let i = 0; i < th.length; i++) bin += String.fromCharCode(th[i]);
  const p90 = Array.from(th).sort((a, b) => a - b)[Math.floor(th.length * 0.9)];   // E1 v2: too_dark (render.py)
  let faces = [];
  try { if (cur) faces = faceStats(cur.S, camera, canvas, faceCx, (it) => silhouetteSep(renderer, scene, camera, it, canvas, sepHide())); } catch (e) { faces = []; }   // E1 v2: face_blown, too_dark (render.py)
  let target = null;
  try { const it = cur && targetItem(); if (it && !it.res.figure?.rig) { const q = silhouetteSep(renderer, scene, camera, it, canvas, sepHide()); target = { who: `${it.section}:${it.index} ${it.kind}`, sep: q && q.sep != null ? +q.sep.toFixed(3) : null, area: q ? q.area : 0 }; } } catch (e) { target = null; }
  let flash = 0;                                  // E4 v2: a designed flash (lightning) the world or an item reports at this t
  try { if (cur && cur.tNow != null) { const w = cur.S.world; if (w && typeof w.flashAt === 'function') flash = Math.max(flash, +w.flashAt(cur.tNow) || 0); for (const it of cur.S.items) if (typeof it.res.flashAt === 'function') flash = Math.max(flash, +it.res.flashAt(cur.tNow) || 0); } } catch (e) { flash = 0; }
  return { jpg: canvas.toDataURL('image/jpeg', q), stats: { mean: sum / th.length / 255, black: black / th.length, blown: blown / th.length, hot: hot / th.length, p90, thumb: btoa(bin), faces, flash, target } };
};
window.getCatalog = () => catalogJSON(reg, {
  camera: { moves: MOVES.filter((m) => m !== 'map_dive'), v1_1: ['map_dive'], speed: ['slow', 'medium', 'fast'], side: ['left', 'right', 'front', 'back'], end: ['rise', 'continue', 'settle'], target: 'stage | ref:<castId> | groups:N | objects:N | structures:N | labels:N | [x, z]', altitude: '[start_m, end_m] above ground', fov: 'degrees (default 40)', dof: 'auto | off | 0..3',
    keys: 'move keys: [{t, pos: [x,y,z] | at: [x,z] + alt, look: [x,y,z] | look_at: [x,z] + look_h, fov}] (fov per key = an eased lens track), limits: eye (1.3 m) | macro (0.15 m)',
    lens: '[{t, fov}] a lens track on any move (monotone, eased)',
    dolly_zoom: '{t: [t0, t1], fov: end_deg, target}: vertigo shot, the target keeps its size while the lens changes (smaller fov = camera backs away)',
    focus: "[{t, target: 'ref:you' | 'objects:0' | 'objects:0.<anchor>' | [x,y,z] | 'infinity', fstop: 1.4..16, pull: s}] rack focus between real positions (replaces dof)",
    shake: '[{t, amp: deg 0.2..2.5, dur: s <= 2.5, freq: Hz 1.5..14, attack: s}] designed impact shake: rare (one impact per shot), short, eased',
    handheld: '0..1 slow operator drift for eye-level documentary shots (never shaky)',
    strict: 'true: the path is final (no lift, relax or flyover fallback); a failing path is reported, not rendered',
    fpv_dive: "move fpv_dive (E2 v2): one smooth spline from high above (altitude [start, end], default [~1.1 x length, 160..320], [.., pull-up]) diving at the target, skimming past it at `height` m (default: the `pass` anchor's height, else 0.8 x its top) `skim` m clear of its `side` (left = its port), then pulling up (end rise) or away (end away); pass: '<ref>.<anchor>' e.g. 'titanic.funnel_2'; approach: ahead (default for a moving subject: a head-on pass) | astern; fov default 62. The speed is fitted to dur within the safety rule (the start altitude and the skim shrink for a short dur); looks along the flight turned toward the hull, banks <= 6.5 deg. 7-10 s works best",
    tracking_low: "move tracking_low (E2 v2): rides beside a MOVING target at its exact velocity, `height` m over the water / ground (default 3), `offset` m out from its `side` (left = port; default 0.1 x length + 5), at `lead` (fraction of the length ahead of the centre, -0.5..0.5, default 0.12) drifting to `lead_end`, looking at `look_lead` along the hull (default 0.45 = the bow and its bow wave) at `look_h` m; fov default 38. Speed rules are measured relative to the subject (the drift along the hull is kept legal)", ...SPACE_CAMERA_DOC },   // E4 v2
  clock: { offset: 'world time at t=0', rate: 'world speed (0 = frozen)', freeze_at: 's: the world eases to a stop', ease: 's', keys: '[{t, rate}] speed ramps: the rate eases between keys (slow motion into an impact and back)', sync: '{t, w}: the world shows its time w at scene time t (solves offset)' },
  look: { time: Object.keys(TIMES), sky: Object.keys(SKIES), grade: Object.keys(GRADES), fog: '0..1', haze: '0..1', sun: '{az, el} degrees (optional; time sets it)' },
  weather: { rain: '0..1', snow: '0..1', dust: '0..1', ash: '0..1', embers: '0..1', wind: '0..1 (0..12 m/s)', windDir: 'degrees (optional)' },
  labels: { styles: [...Object.keys(LABEL_STYLES), 'almanac', 'almanac_sans'], fields: 'text, sub, style, at, height (cap height m), t: [in, out] s, heading (optional: faces the camera)',
    story: "almanac = off-white serif caps + mustard rule (place/date stamps); almanac_sans = clean sans (numbers: '524 m', '700 °C', '15:00'). t_in, t_out, reveal type|fade|rise|scale|ground, on: 'ref:<id>' | 'objects:N' (follows it) + offset [dx,dy,dz], elev m, face_camera, align center|left|right, rule, unit, screen (cap height as a fraction of the frame)" },
  transitions: { in: ['warp', 'whiteout', 'cut', 'dissolve'], out: ['warp', 'whiteout', 'cut', 'dissolve'], engine: ['warp', 'whiteout'], compositor: ['cut', 'dissolve'] },
  cast: { builtin: Object.keys(BUILTIN_CAST), kits: reg.modules.map((m) => m.mod.KITS).find(Boolean) || null },
  safety: LIMITS,
});
window.__f3d = { THREE, scene, camera, renderer, get cur() { return cur; }, get reg() { return reg; }, look: () => look, U };

boot().then(() => { window.__ready = true; }).catch((e) => { console.error(e); window.__error = String((e && e.stack) || e); });
