// labels.js — monumental 3D lettering standing in the world (place / date titles): solid extruded letters from the
// house fonts (shared/text3d.js) in stone, bronze, gold, clay, neon or ice. Each letter rises out of the ground (or the
// water) in a stagger, eased, with a dust / splash hook per letter, and sinks back at the end of its window.
// Letters are ground-snapped one by one (a letter never floats over a dip), face `face` / `heading` (or the camera
// position at the reveal when the engine provides ctx.cameraAt(t)), and stay upright and readable.
//   item = { text, sub, style, at, height (cap height m, default 8), heading | face, t: [in, out], font }
import * as THREE from 'three';
import { loadFont, textLetters } from '../shared/text3d.js';
import { patchMaterial } from '../shared/env.js';
import { clamp, smoother, lerp } from '../shared/util.js';
import { ground, xz, DEG, patchAll, yawFromHeading } from './common.js';

const FONTS = { Cinzel: 'Cinzel.ttf', 'Inter Display Black': 'InterDisplay-Black.ttf', 'Inter SemiBold': 'Inter-SemiBold.ttf', 'EB Garamond': 'EB-Garamond.ttf', 'Special Elite': 'SpecialElite.ttf', 'Courier Prime': 'CourierPrime-Bold.ttf', Inter: 'Inter-SemiBold.ttf' };
const fontUrl = (f) => new URL('../../fonts/' + FONTS[f], import.meta.url).href;
const NOISE = /* glsl */`
float lh(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float ln(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(lh(i), lh(i+vec3(1,0,0)), u.x), mix(lh(i+vec3(0,1,0)), lh(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(lh(i+vec3(0,0,1)), lh(i+vec3(1,0,1)), u.x), mix(lh(i+vec3(0,1,1)), lh(i+vec3(1,1,1)), u.x), u.y), u.z); }
float lf(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * ln(p); p = p * 2.07 + 7.3; a *= 0.5; } return s; }`;
// one surface shader per style: colour, roughness and metal from world-space noise (letters of any size look solid)
function styleMaterial(style, o = {}) {
  const S = {
    stone: { base: [0.62, 0.6, 0.56], alt: [0.5, 0.48, 0.45], metal: 0, rough: 0.88, scale: 0.35 },
    bronze: { base: [0.19, 0.12, 0.065], alt: [0.16, 0.27, 0.21], metal: 1, rough: 0.42, scale: 0.3 },
    gold: { base: [0.78, 0.55, 0.2], alt: [0.62, 0.42, 0.14], metal: 1, rough: 0.26, scale: 0.4 },
    clay: { base: [0.55, 0.26, 0.15], alt: [0.46, 0.22, 0.13], metal: 0, rough: 0.92, scale: 0.6 },
    neon: { base: [0.08, 0.08, 0.09], alt: [0.05, 0.05, 0.06], metal: 0.2, rough: 0.35, scale: 0.5 },
    ice: { base: [0.72, 0.84, 0.92], alt: [0.55, 0.72, 0.86], metal: 0, rough: 0.12, scale: 0.8 },
  }[style] || null;
  const m = style === 'ice' ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0, transmission: 0.35, thickness: 1.5, ior: 1.31, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.3 })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: S.rough, metalness: S.metal, envMapIntensity: style === 'gold' || style === 'bronze' ? 1.2 : 0.7 });
  if (style === 'neon') { m.emissive = new THREE.Color(o.color ?? 0xD9A93F); m.emissiveIntensity = 3.2; }
  m.userData.progKey = 'f3dLabel' + style;
  const b = S.base.map((v) => v.toFixed(3)).join(','), a = S.alt.map((v) => v.toFixed(3)).join(',');
  return patchMaterial(m, (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLW; varying vec3 vLN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vLW = (modelMatrix * vec4(transformed, 1.0)).xyz; vLN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vLW; varying vec3 vLN;\n${NOISE}\nfloat lMet; float lRou;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      { vec3 p = vLW * ${S.scale.toFixed(2)};
        float n1 = lf(p), n2 = lf(p * 4.3 + 3.1), top = smoothstep(0.4, 0.95, vLN.y);
        float mixv = smoothstep(0.45, 0.8, n1 * 0.7 + top * ${style === 'bronze' ? '0.45' : '0.1'} + n2 * 0.2);
        diffuseColor.rgb = mix(vec3(${b}), vec3(${a}), mixv) * (0.8 + 0.4 * n2);
        ${style === 'stone' ? 'diffuseColor.rgb *= 1.0 - smoothstep(0.62, 0.9, lf(p * 11.0)) * 0.25;' : ''}
        lMet = ${S.metal.toFixed(1)} * (1.0 - ${style === 'bronze' ? 'mixv * 0.85' : '0.0'});
        lRou = ${S.rough.toFixed(2)} + (n2 - 0.5) * 0.12 + ${style === 'bronze' ? 'mixv * 0.35' : '0.0'}; }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = lRou;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = lMet;');
  });
}
const STYLE_FONT = { stone: 'Cinzel', bronze: 'Cinzel', gold: 'Cinzel', clay: 'Inter Display Black', neon: 'Inter Display Black', ice: 'Inter Display Black' };

export const CATALOG = {
  label: { desc: 'monumental 3D lettering in the world: text (+ sub line), style stone|bronze|gold|clay|neon|ice; letters rise out of the ground in a stagger and sink at t[1]', params: { text: 'string', sub: 'string (smaller line under)', style: 'stone|bronze|gold|clay|neon|ice', at: '[x, z]', height: 'cap height m (8)', heading: 'deg the letters face', face: '[x, z] to face', t: '[in, out] s', color: 'neon colour' }, footprint: [40, 6], height: 10, tags: ['label', 'text'] },
};
for (const s of ['stone', 'bronze', 'gold', 'clay', 'neon', 'ice']) CATALOG['label.' + s] = { ...CATALOG.label, desc: `3D lettering in ${s}` };

// ── story text (Q6, 26 Sep 2026): quiet, timed type in the world (the ALMANAC look: an editorial serif and a clean sans,
// off-white, one mustard accent; revealed by a type-on, fade, rise or scale, never a bounce) ──────────────────────────
//   item = { text, sub, unit, style: almanac | almanac_sans | any monumental style, height (cap m; almanac 1.2),
//            at [x, z] + elev (m above the ground) | on 'ref:<id>' | 'objects:N' | '<ref>.<anchor>' + offset [dx, dy, dz],
//            heading | face [x, z] | face_camera (turns to the camera every frame; default for text `on` an item),
//            t_in, t_out (or t: [in, out]), reveal type | fade | rise | scale | ground, align center | left | right,
//            rule (the mustard rule; default on for almanac), rule_len, caps, color, screen (cap height as a fraction of
//            the frame height at the reveal) }
// Text runs on the scene's time (the narration), not the world clock. Glyphs: EB Garamond and Inter cover digits, ° · – ×.
export const STORY = {
  almanac: { font: 'EB Garamond', weight: 500, color: '#ECE6D8', rule: '#D9A93F', track: 40, subTrack: 60, caps: true, sub: 0.44, unit: 0.5, depth: 0.05, rough: 0.62, glow: 0.3, H: 1.2 },
  almanac_sans: { font: 'Inter', weight: 600, color: '#ECE6D8', rule: '#D9A93F', track: 6, subTrack: 44, caps: false, sub: 0.34, unit: 0.46, depth: 0.05, rough: 0.55, glow: 0.3, H: 1.2 },
};
const STORY_KEYS = ['t_in', 't_out', 'reveal', 'on', 'offset', 'elev', 'face_camera', 'align', 'rule', 'rule_len', 'unit', 'screen', 'caps'];
CATALOG['label.almanac'] = { ...CATALOG.label, desc: 'story text, ALMANAC look: off-white editorial serif caps with a thin mustard rule, for place / date stamps in the world ("LITUYA BAY, ALASKA" / "9 JULY 1958"); types on', params: { text: 'string', sub: 'second line (date)', at: '[x, z]', elev: 'm above ground', on: "'ref:<id>' | 'objects:N' (follows it)", offset: '[dx, dy, dz] m', height: 'cap height m (1.2)', screen: 'cap height as a fraction of the frame (0.04)', t_in: 's', t_out: 's', reveal: 'type|fade|rise|scale', align: 'center|left|right', face_camera: 'bool' }, footprint: [8, 1], height: 2, tags: ['label', 'text', 'story', 'stamp', 'date', 'place'] };
CATALOG['label.almanac_sans'] = { ...CATALOG['label.almanac'], desc: 'story text, ALMANAC look: clean off-white sans for numbers ("524 m", "700 °C", "15:00", "M 9.1"), optional small unit and mustard rule', tags: ['label', 'text', 'story', 'number'] };

async function buildStory(style, item, ctx) {
  const G = ground(ctx);
  const st = STORY[style] || null;
  const H = clamp(Number.isFinite(+item.height) ? +item.height : st ? st.H : 8, 0.05, 200);
  let fam, weight, subFam, subWeight, track, subTrack;
  if (st) { fam = subFam = st.font; weight = subWeight = st.weight; track = st.track; subTrack = st.subTrack; }
  else {
    fam = item.font && FONTS[item.font] ? item.font : STYLE_FONT[style] || 'Cinzel'; weight = fam === 'Cinzel' ? 700 : 400;
    subFam = style === 'stone' || style === 'bronze' || style === 'gold' ? 'EB Garamond' : 'Inter SemiBold'; subWeight = 400;
    track = fam === 'Cinzel' ? 12 : 4; subTrack = 30;
  }
  for (const f of new Set([fam, subFam])) { try { await loadFont(f, fontUrl(f)); } catch (e) { (ctx.warnings || []).push('label font ' + f + ' failed'); } }
  const caps = item.caps ?? (st ? st.caps : true), tx = (v) => (caps ? String(v).toUpperCase() : String(v));
  const depth = H * (st ? st.depth : 0.28), bevel = st ? 0.012 : 0.03;
  const lettersOf = (s, h, w, f, tr, dz) => textLetters(s, { font: `${w} 256px "${f}"`, height: h, depth: depth * dz, bevel, letterSpacing: tr });
  const main = lettersOf(tx(item.text ?? '') || ' ', H, weight, fam, track, 1);
  const unit = item.unit ? lettersOf(tx(item.unit), H * (st ? st.unit : 0.5), weight, fam, track, 0.8) : null;
  const subH = H * (st ? st.sub : 0.26);
  const sub = item.sub ? lettersOf(tx(item.sub), subH, subWeight, subFam, subTrack, 0.6) : null;
  const extent = (g) => { let lo = Infinity, hi = -Infinity; for (const m of g.children) { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; lo = Math.min(lo, m.position.x + b.min.x); hi = Math.max(hi, m.position.x + b.max.x); } return Number.isFinite(lo) ? [lo, hi] : [0, 0]; };
  // layout, block-local (x right, y up, text front at +z): the line (+ unit) on the baseline, the rule under it, the sub
  const line = new THREE.Group(); line.add(main);
  let [mL, mR] = extent(main);
  if (unit) { const [uL, uR] = extent(unit); unit.position.x = mR + H * 0.2 - uL; line.add(unit); mR += H * 0.2 + (uR - uL); }
  const ruleOn = item.rule ?? !!st, ruleT = H * 0.045, ruleY = -H * 0.3;
  let sL = 0, sR = 0; if (sub) [sL, sR] = extent(sub);
  const align = item.align === 'left' || item.align === 'right' ? item.align : 'center';
  const off = (L, R) => (align === 'left' ? -L : align === 'right' ? -R : -(L + R) / 2);
  line.position.x = off(mL, mR);
  const Wd = Math.max(mR - mL, sub ? sR - sL : 0);
  const block = new THREE.Group(); block.add(line);
  if (sub) { sub.position.x = off(sL, sR); sub.position.y = (ruleOn ? ruleY - ruleT - H * 0.22 : -H * 0.3) - subH; block.add(sub); }
  const mat = (hex, glow) => {
    if (!st) { const m = styleMaterial(style, item); m.transparent = true; return m; }
    const col = new THREE.Color(hex);
    return patchMaterial(new THREE.MeshStandardMaterial({ color: col, roughness: st.rough, metalness: 0, emissive: col, emissiveIntensity: glow, transparent: true, depthWrite: true }));
  };
  let rule = null;
  if (ruleOn) {
    const len = Wd * (Number.isFinite(+item.rule_len) ? clamp(+item.rule_len, 0.1, 2) : 1);
    rule = new THREE.Mesh(new THREE.BoxGeometry(1, ruleT, depth * 0.5).translate(0.5, 0, -depth * 0.25), mat(st ? st.rule : '#D9A93F', 0.35));
    rule.position.set(align === 'left' ? 0 : align === 'right' ? -len : -len / 2, ruleY - ruleT / 2, 0);
    rule.userData.len = len; block.add(rule);
  }
  const minY = sub ? sub.position.y : rule ? ruleY - ruleT : 0, blockH = H - minY;
  // frame (world anchor, yaw) -> pivot (block centre: scale reveals) -> block (bottom at the anchor)
  const root = new THREE.Group(); root.name = 'label:' + tx(item.text ?? '');
  const frame = new THREE.Group(), pivot = new THREE.Group();
  root.add(frame); frame.add(pivot); pivot.add(block);
  pivot.position.y = blockH / 2; block.position.y = -blockH / 2 - minY;
  // per-letter materials (a letter fades on its own); x in block units for the type-on order
  const L = [], xOf = (m, g) => m.position.x + g.position.x + (g.parent === line ? line.position.x : 0);
  const add = (g, part) => g.children.forEach((m) => { m.material = mat(item.color || (st && st.color), st ? st.glow : 0); m.castShadow = !st; m.receiveShadow = !st; m.renderOrder = 3; L.push({ m, part, x: xOf(m, g), y0: m.position.y, h: m.geometry.boundingBox ? m.geometry.boundingBox.max.y : H }); });
  add(main, 0); if (unit) add(unit, 1); if (sub) add(sub, 2);
  if (rule) { rule.castShadow = false; rule.receiveShadow = !st; rule.renderOrder = 3; }
  // timing (scene time)
  const tIn = Number.isFinite(+item.t_in) ? +item.t_in : Array.isArray(item.t) && Number.isFinite(+item.t[0]) ? +item.t[0] : 0.4;
  const tOut = Number.isFinite(+item.t_out) ? +item.t_out : Array.isArray(item.t) && Number.isFinite(+item.t[1]) ? +item.t[1] : Infinity;
  item.t = [tIn, Number.isFinite(tOut) ? tOut : 999];                       // the engine's window (QA probe, orientLabels)
  const reveal = ['type', 'fade', 'rise', 'scale', 'ground'].includes(item.reveal) ? item.reveal : st ? 'type' : 'ground';
  const lineL = Math.min(...L.filter((q) => q.part < 2).map((q) => q.x)), lineR = Math.max(...L.filter((q) => q.part < 2).map((q) => q.x));
  const subL = sub ? Math.min(...L.filter((q) => q.part === 2).map((q) => q.x)) : 0, subR = sub ? Math.max(...L.filter((q) => q.part === 2).map((q) => q.x)) : 0;
  const nLine = L.filter((q) => q.part < 2).length, nSub = L.length - nLine;
  const Tl = clamp(0.035 * nLine, 0.3, 0.9), Ts = clamp(0.028 * nSub, 0.25, 0.8), subDelay = reveal === 'type' ? Tl * 0.55 + 0.15 : 0.22;
  for (const q of L) {
    const u = q.part < 2 ? (lineR > lineL ? (q.x - lineL) / (lineR - lineL) : 0) : (subR > subL ? (q.x - subL) / (subR - subL) : 0);
    q.d = reveal === 'type' ? (q.part < 2 ? u * Tl : subDelay + u * Ts) : reveal === 'ground' ? L.indexOf(q) * 0.07 : q.part === 2 ? subDelay : 0;
  }
  const inDur = { type: 0.28, fade: 0.7, rise: 0.9, scale: 0.8, ground: 1.4 }[reveal];
  // placement: an anchor track (bindAnchor, camera.js bindLabels) or the world point at + elev
  const at = xz(item.at), elev = Number.isFinite(+item.elev) ? +item.elev : 0;
  const ofs = Array.isArray(item.offset) && item.offset.length >= 3 ? item.offset.map((v) => +v || 0) : null;
  let anchor = null, anchorTop = 1.8, yaw0 = 0, capK = 1;
  const headingGiven = !item.faceCamera;                 // the registry sets faceCamera when the spec gives no heading
  let live = !!item.face_camera;
  if (item.face) { const f = xz(item.face); yaw0 = Math.atan2(f[0] - at[0], f[1] - at[1]); }
  else if (headingGiven) yaw0 = yawFromHeading(item.heading);
  const wl = ctx.water && Number.isFinite(ctx.water.level) ? ctx.water.level : null;
  let lift = 0, screen = false;                          // E1 v2: set by core/qa.js resolveLabels when the text is occluded
  const posAt = (t) => {
    if (anchor) { const b = anchor(t), o = ofs || [0, anchorTop + 0.2, 0]; return [b[0] + o[0], b[1] + o[1] + lift, b[2] + o[2]]; }
    const o = ofs || [0, 0, 0], x = at[0] + o[0], z = at[1] + o[2], g = G.h(x, z);
    return [x, (wl != null ? Math.max(g, wl) : g) + elev + o[1] + lift, z];
  };
  const _cf = new THREE.Vector3(), _cu = new THREE.Vector3(), _cr = new THREE.Vector3();
  let lastT = 0;
  function update(t = 0, clock, camera) {
    lastT = t;
    const p = posAt(t);
    frame.position.set(p[0], p[1], p[2]);
    frame.rotation.y = live && camera && camera.position ? Math.atan2(camera.position.x - p[0], camera.position.z - p[2]) : yaw0;
    // E1 v2 screen-space fallback: the text faces the lens in the upper-middle of the frame (never the bottom quarter,
    // where the captions are), at its anchor's depth so the depth of field keeps it as sharp as its subject
    if (screen && camera && camera.isPerspectiveCamera) {
      camera.updateMatrixWorld(); camera.matrixWorld.extractBasis(_cr, _cu, _cf); _cf.negate();
      const D = Math.min(50, Math.max(1.2, Math.hypot(p[0] - camera.position.x, p[1] - camera.position.y, p[2] - camera.position.z)));
      const hh = D * Math.tan((camera.fov * Math.PI / 180) / 2);
      frame.position.copy(camera.position).addScaledVector(_cf, D).addScaledVector(_cu, hh * 0.5);
      frame.quaternion.copy(camera.quaternion);
      const frac = Number.isFinite(+item.screen) && +item.screen > 0 ? +item.screen : 0.04;
      let sk = (2 * hh * frac) / H;
      const maxW = 2 * hh * (camera.aspect || 16 / 9) * 0.84;              // inside the 6 % side margins
      if (Wd * sk > maxW) sk = maxW / Wd;
      frame.scale.setScalar(clamp(sk, 0.002, 60));
    } else if (screen) frame.scale.setScalar(capK);
    const kOut = Number.isFinite(tOut) ? smoother((t - tOut) / 0.6) : 0;
    let blockK = 1;
    if (reveal === 'rise' || reveal === 'scale') blockK = smoother((t - tIn) / inDur);
    pivot.position.y = blockH / 2 - (reveal === 'rise' ? (1 - blockK) * 0.3 * H : 0);
    pivot.scale.setScalar(reveal === 'scale' ? 0.92 + 0.08 * blockK : 1);
    for (const q of L) {
      const k = smoother((t - tIn - q.d) / inDur);
      let a = (reveal === 'ground' ? 1 : k) * (1 - kOut);
      if (reveal === 'ground') { q.m.position.y = q.y0 - (1 - k) * (q.h + H * 0.1); a *= k > 0.001 ? 1 : 0; }
      else if (reveal === 'type') q.m.position.y = q.y0 - (1 - k) * 0.06 * H;
      q.m.material.opacity = a; q.m.visible = a > 0.002;
    }
    if (rule) {
      const kr = smoother((t - tIn - 0.05) / Math.max(0.55, (reveal === 'type' ? Tl : inDur) + 0.2));
      const len = rule.userData.len * Math.max(1e-4, kr);
      rule.scale.x = len;
      rule.position.x = align === 'right' ? -len : align === 'left' ? 0 : -rule.userData.len / 2;
      rule.material.opacity = 1 - kOut; rule.visible = kr > 0.001 && kOut < 0.998;
    }
    root.updateMatrixWorld(true);
  }
  update(0);
  if (Array.isArray(ctx.noReflect)) ctx.noReflect.push(root);   // E1 v2: a title is not in the world: no reflection in the sea
  if (live || item.on != null) root.userData.noQA = true;   // moving / turning text is not a solid for the camera
  return {
    root, radius: Wd / 2 + 0.5, height: blockH + elev, update, anchors: { center: frame }, width: Wd, label: true,
    story: true, snapped: true, contact: false, sceneTime: true,
    get faceLive() { return live; },
    bindAnchor(fn, top) { anchor = fn; anchorTop = top ?? 1.8; if (item.face_camera == null && !headingGiven) live = true; root.userData.noQA = true; update(lastT); },
    faceToward(x, z) { const p = posAt((tIn + Math.min(item.t[1], tIn + 6)) / 2); if (Math.hypot(x - p[0], z - p[2]) < 0.5) return null; yaw0 = Math.atan2(x - p[0], z - p[2]); update(lastT); return ((Math.atan2(x - p[0], -(z - p[2])) / DEG) + 360) % 360; },
    pointAt(t) { const p = posAt(t); return [p[0], p[1] + blockH * capK / 2, p[2]]; },
    // E1 v2: the depth of field must never ghost a title. main.js calls this after it offsets the lens by `a` (the
    // aperture sample) and re-aims it at the focus `dF` m away: the text moves with the lens by a * (1 - d / dF), which
    // keeps its image where the centred lens puts it (sharp, one copy) at any depth d (world or screen-space)
    dofShift(a, dF, camPos, fwd) {
      const d = Math.max(0.05, (frame.position.x - camPos.x) * fwd.x + (frame.position.y - camPos.y) * fwd.y + (frame.position.z - camPos.z) * fwd.z);
      const k = 1 - d / Math.max(0.05, dF);
      frame.position.x += a.x * k; frame.position.y += a.y * k; frame.position.z += a.z * k; frame.updateMatrixWorld(true);
    },
    setLift(dy) { lift = +dy || 0; update(lastT); },
    get lift() { return lift; },
    setScreen(on) {
      screen = !!on;
      root.traverse((o) => { if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { m.depthTest = !screen; m.needsUpdate = true; } if (o.isMesh) o.renderOrder = screen ? 1e6 + 10 : o.renderOrder; });
      update(lastT);
    },
    get screen() { return screen; },
    setCap(h) { capK = clamp(h / H, 0.02, 60); frame.scale.setScalar(capK); update(lastT); },
  };
}

export async function build(kind, item = {}, ctx = {}) {
  const G = ground(ctx);
  const style = kind.startsWith('label.') ? kind.slice(6) : (item.style || 'stone');
  if (STORY[style] || STORY_KEYS.some((k) => item[k] != null)) return buildStory(style in STORY || STYLE_FONT[style] ? style : 'almanac', item, ctx);
  const fam = item.font && FONTS[item.font] ? item.font : STYLE_FONT[style] || 'Cinzel';
  try { await loadFont(fam, fontUrl(fam)); } catch (e) { (ctx.warnings || []).push('label font ' + fam + ' failed'); }
  const subFam = style === 'stone' || style === 'bronze' || style === 'gold' ? 'EB Garamond' : 'Inter SemiBold';
  if (item.sub) try { await loadFont(subFam, fontUrl(subFam)); } catch (e) { /* keep going */ }
  const H = item.height ?? 8, mat = styleMaterial(style, item);
  const text = String(item.text ?? '').toUpperCase() || ' ';
  const weight = fam === 'Cinzel' ? '700' : '400';
  const main = textLetters(text, { font: `${weight} 256px "${fam}"`, height: H, depth: H * 0.28, bevel: 0.03, material: mat, letterSpacing: fam === 'Cinzel' ? 12 : 4 });
  let sub = null;
  if (item.sub) sub = textLetters(String(item.sub).toUpperCase(), { font: `400 256px "${subFam}"`, height: H * 0.26, depth: H * 0.08, bevel: 0.02, material: mat, letterSpacing: 30 });
  const at = xz(item.at);
  let yaw;
  if (item.face) { const f = xz(item.face); yaw = Math.atan2(f[0] - at[0], f[1] - at[1]); }
  else if (item.heading != null) yaw = yawFromHeading(item.heading);
  else if (ctx.cameraAt) { const c = ctx.cameraAt((item.t?.[0] ?? 0) + 1); yaw = Math.atan2(c.x - at[0], c.z - at[1]); }
  else yaw = Math.atan2(-at[0], -at[1] + 1e-6) + (Math.hypot(at[0], at[1]) < 1 ? Math.PI : 0);   // face the stage / south
  const root = new THREE.Group(); root.name = 'label:' + text;
  const frame = new THREE.Group(); frame.rotation.y = yaw; frame.position.set(at[0], 0, at[1]); root.add(frame);
  frame.add(main); if (sub) { frame.add(sub); sub.position.set(0, 0, H * 0.45); }
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const water = ctx.waterLevel ?? ctx.world?.water?.level ?? null;
  // per-letter ground snap: lowest ground under the letter's footprint (minus a little so the foot is buried)
  const letters = [];
  const addLetters = (grp, depth, dz, delay) => grp.children.forEach((m, i) => {
    m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox, lx = m.position.x, w = (bb.max.x - bb.min.x) / 2;
    let lo = Infinity;
    for (const u of [-w, 0, w]) for (const v of [0, -depth]) { const px = lx + u, pz = dz + v; const wx = at[0] + px * cy + pz * sy, wz = at[1] - px * sy + pz * cy; lo = Math.min(lo, G.h(wx, wz)); }
    if (water != null && lo < water) lo = water;
    const base = lo - H * 0.04;
    m.castShadow = true; m.receiveShadow = true;
    letters.push({ m, base, h: bb.max.y, delay: delay + i * 0.07, wx: at[0] + lx * cy + dz * sy, wz: at[1] - lx * sy + dz * cy, wet: water != null && lo <= water, lx, w, dep: depth, dz });
  });
  addLetters(main, H * 0.28, 0, 0);
  if (sub) addLetters(sub, H * 0.08, H * 0.45, 0.5 + main.children.length * 0.07);
  const t0 = item.t?.[0] ?? 0.3, t1 = item.t?.[1] ?? 999;
  const hooks = letters.map((L) => ({ kind: L.wet ? 'splash' : 'dust', at: [L.wx, L.wz], t: t0 + L.delay, strength: clamp(H / 10, 0.3, 1.5) }));
  let lastT = 0;
  function update(t = 0) {
    lastT = t;
    for (const L of letters) {
      const kin = smoother((t - t0 - L.delay) / 1.4), kout = smoother((t - t1 - L.delay * 0.5) / 1.2);
      const k = kin * (1 - kout);
      L.m.position.y = L.base - (1 - k) * (L.h + H * 0.1);
      L.m.visible = k > 0.001;
      L.m.rotation.x = (1 - kin) * 0.08;               // a slight lean as it rises, settling upright
    }
    root.updateMatrixWorld(true);
  }
  update(0);
  patchAll(root, ctx);
  const width = main.userData.width ?? H * text.length * 0.8;
  // (Q6) turn to face a point (orientLabels, for a label without a heading): the frame turns in place and every letter's
  // foot is re-snapped to the ground; before, orientLabels turned the root about the world origin and swung the lettering away
  function faceToward(x, z) {
    if (Math.hypot(x - at[0], z - at[1]) < 1) return null;
    const yw = Math.atan2(x - at[0], z - at[1]), c2 = Math.cos(yw), s2 = Math.sin(yw);
    frame.rotation.y = yw;
    letters.forEach((Lt, i) => {
      let lo = Infinity;
      for (const u of [-Lt.w, 0, Lt.w]) for (const v of [0, -Lt.dep]) { const px = Lt.lx + u, pz = Lt.dz + v; lo = Math.min(lo, G.h(at[0] + px * c2 + pz * s2, at[1] - px * s2 + pz * c2)); }
      if (water != null && lo < water) lo = water;
      Lt.base = lo - H * 0.04; Lt.wx = at[0] + Lt.lx * c2 + Lt.dz * s2; Lt.wz = at[1] - Lt.lx * s2 + Lt.dz * c2;
      hooks[i].at = [Lt.wx, Lt.wz];
    });
    update(lastT);
    return ((Math.atan2(x - at[0], -(z - at[1])) / DEG) + 360) % 360;
  }
  return { root, radius: width / 2 + 2, height: H * 1.1, update, anchors: { center: frame }, hooks: { letters: hooks }, width, faceToward, sceneTime: true };
}
