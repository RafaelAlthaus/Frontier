// soldiers.js — the people of Bastogne, 22 December 1944: GIs of the 101st Airborne / 327th Glider Infantry, the German
// truce party (two officers in long greatcoats and shiny boots, two Panzergrenadiers of the 901st, one with the white
// flag), Brig. Gen. McAuliffe in his cellar HQ, and THE WITNESS, the recurring white mannequin of the Frontier Almanac.
// House "mannequin look" (world/js/figures.js): smooth faceless plaster heads and hands, real wool, leather and steel.
//
// Each figure is ONE THREE.Skeleton driving one SkinnedMesh per material: sleeves and trousers bend at elbows and knees,
// the coat skirts part over the striding legs (the two front panels are skinned to opposite thighs and overlap), hard
// things (helmets, soles, rifles, buttons, fingers) are weighted 100 % to one bone. Figures stand at their origin, facing
// +Z, metres, Y up. Deterministic: rng(seed) only.
//
// EXPORTS
//   gi({coat: 'overcoat'|'jacket', weapon: 'garand'|'bar'|'carbine'|null, net, scarf, burlap, overshoes, seed})
//   germanOfficer({briefcase, seed})            germanSoldier({cap: 'm43'|'helmet', coat: 'greatcoat'|'tunic', kit, seed})
//   general({helmet, seed})                      witness({seed})
//   whiteFlag({width, height, pole}) -> { group, pole, cloth, update(t, s), carry(fig, 'upright'|'shoulder') }
//   POSES (stand, attention, walk, salute, hold_paper, laugh, point, carry_flag, rifle_ready, sit_foxhole, crouch,
//          shiver, seated, + seated_laugh, watch)          chair() -> { group, seatHeight: 0.46 }
//
// Every figure returns { group, pose(p), walk(phase, k), update(t, s), anchors, stride, bones, tris, materials }
//   pose(p)       p = POSES.name or a merge ({...POSES.seated, ...POSES.laugh}); FK angles + IK hand targets + props.
//                 Angles follow world/js/figures.js person(): negative X = limb forward, elbows negative, knees
//                 positive; lean/turn/roll/drop move the pelvis; lHand/rHand = IK grip targets {space: 'chest'|'root'|
//                 'head'|'pelvis', p, fingers, palm, pole}; lShape/rShape = hand shapes (relaxed, fist, grip, flat,
//                 pinch, sheet, point, soft); weapon = 'sling'|'aim'|'port'|'parapet'|'low'|null; plant: false keeps the
//                 pelvis where the pose puts it (seated, sit_foxhole), otherwise the soles are set on y = 0.
//   walk(ph, k)   a planted-foot gait on top of the base pose: heel strike -> flat -> toe off, 2-bone leg IK, pelvis bob,
//                 sway and twist, arm swing. ph in radians (2π = one stride = two steps); move the figure forward by
//                 fig.stride * ph / 2π (metres) and the soles do not slide. k 0..1 blends in from standing.
//   update(t, s)  s = {wind: 0..1 (blowing toward +X) | {x, z, strength}, snow: 0..1}: snow dusting on up-facing
//                 surfaces (keyed to the rest pose, so it stays on the shoulders when an arm moves), loose chinstraps,
//                 the Witness's scarf tails. Deterministic in t. Call after pose()/walk() each frame.
//   anchors       { mouth, head, leftHand, rightHand, paper } Object3Ds riding the skeleton. mouth: just in front of the
//                 face (breath). paper: the centre of a sheet held in hold_paper, between the thumb pads, +Z = the printed
//                 face toward the eyes, +Y = up the page; paper.userData.width = the sheet width that fits the grip.
//   Scenes: sit_foxhole expects the parapet 1.1 m above the pit floor (POSES.sit_foxhole.holeDepth: put the figure at
//   ground - 1.1); seated expects a 0.46 m seat (chair()). Flag: flag.carry(fig, 'upright') parents the flag to the
//   bearer's chest and puts both hands on the pole (the IK follows walk()); 'shoulder' carries it on the right shoulder.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { plain } from '../shared/materials.js';
import { rng, makeNoise } from '../shared/util.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

// LOD: crowds build the same garments with fewer segments (setDetail(0.45)); heroes use 1
let DETAIL = 1;
export function setDetail(d) { DETAIL = d; }
export function getDetail() { return DETAIL; }
const dq = (n, min = 4) => (DETAIL >= 1 ? n : Math.max(min, Math.round(n * DETAIL)));

// ── canvas textures (cached, shared by every figure; UVs are in metres, repeat = 1 / tile size) ──────────────────────────
const TEX = {};
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// height field (Float32 0..1, tileable) -> tangent-space normal map
function normalTex(H, w, h, strength, tile) {
  const c = canvas(w, h), g = c.getContext('2d'), id = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const hx = H[y * w + ((x + 1) % w)] - H[y * w + ((x - 1 + w) % w)];
    const hy = H[((y + 1) % h) * w + x] - H[((y - 1 + h) % h) * w + x];
    let nx = -hx * strength, ny = hy * strength, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4; id.data[i] = (nx * 0.5 + 0.5) * 255; id.data[i + 1] = (ny * 0.5 + 0.5) * 255; id.data[i + 2] = (nz * 0.5 + 0.5) * 255; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return finishTex(new THREE.CanvasTexture(c), tile, false);
}
function greyTex(F, w, h, tile, alpha) {      // F(x, y) -> [r, g, b] 0..1 (sRGB) or [r,g,b,a]
  const c = canvas(w, h), g = c.getContext('2d'), id = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = F(x, y), i = (y * w + x) * 4;
    id.data[i] = clamp(v[0]) * 255; id.data[i + 1] = clamp(v[1]) * 255; id.data[i + 2] = clamp(v[2]) * 255; id.data[i + 3] = alpha ? clamp(v[3]) * 255 : 255;
  }
  g.putImageData(id, 0, 0);
  return finishTex(new THREE.CanvasTexture(c), tile, true);
}
function finishTex(t, tile, srgb) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4; t.repeat.set(1 / tile[0], 1 / tile[1]);
  t.needsUpdate = true; return t;
}
// cloth kinds: [colour-variation map, normal map]
function clothTex(kind) {
  if (TEX[kind]) return TEX[kind];
  const N = 256, H = new Float32Array(N * N), C = new Float32Array(N * N);
  const nz = makeNoise(kind.length * 131 + 7), r = rng(kind.length * 977 + 3);
  let tile = [0.08, 0.08], str = 2.0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N; let h = 0, c = 0;
    if (kind === 'melton') {          // felted wool: soft fuzz, no weave
      h = nz.fbm2(u * 16, v * 16, 4, 2, 0.55, 16, 16) * 0.5 + nz.noise2(u * 64, v * 64, 64, 64) * 0.25;
      c = nz.fbm2(u * 4 + 9, v * 4, 3, 2, 0.5, 4, 4) * 0.6 + nz.noise2(u * 48, v * 48, 48, 48) * 0.4; str = 1.4;
    } else if (kind === 'serge') {    // 2/2 twill: diagonal ribs
      const d = (x + y) / N * 40 * TAU; h = Math.sin(d) * 0.35 + nz.noise2(u * 64, v * 64, 64, 64) * 0.2;
      c = nz.fbm2(u * 6, v * 6, 3, 2, 0.5, 6, 6) * 0.5 + Math.sin(d) * 0.15; tile = [0.05, 0.05]; str = 2.2;
    } else if (kind === 'sateen') {   // cotton sateen (M1943 jacket): fine steep twill, smooth
      const d = (x * 2 + y) / N * 48 * TAU; h = Math.sin(d) * 0.25 + nz.noise2(u * 32, v * 32, 32, 32) * 0.15;
      c = nz.fbm2(u * 5, v * 5, 3, 2, 0.5, 5, 5) * 0.5; tile = [0.05, 0.05]; str = 1.6;
    } else if (kind === 'knit') {     // stockinette rib: columns of V stitches (scarf, knit gloves)
      const cols = 8, rows = 11, cx = u * cols, cy = v * rows, fx = cx - Math.floor(cx), fy = cy - Math.floor(cy);
      const lobe = (s) => { const px = (fx - 0.5) * s, py = fy - 0.5 + Math.abs(fx - 0.5) * 0.9; return Math.exp(-(px * px * 9 + py * py * 7)); };
      h = Math.max(lobe(1), 0) * (0.75 + 0.25 * Math.sin(fy * Math.PI)) - Math.exp(-((fx - 0.5) ** 2) * 200) * 0.5;
      h += nz.noise2(u * 64, v * 64, 64, 64) * 0.08; c = h * 0.8 + nz.fbm2(u * 4, v * 4, 3, 2, 0.5, 4, 4) * 0.15; tile = [0.064, 0.07]; str = 3.6;
    } else if (kind === 'burlap') {   // coarse plain weave jute with gaps
      const tx = Math.sin(u * 28 * TAU + nz.noise2(u * 8, v * 8, 8, 8) * 1.5), ty = Math.sin(v * 24 * TAU + nz.noise2(u * 8 + 5, v * 8, 8, 8) * 1.5);
      const over = ((Math.floor(u * 28) + Math.floor(v * 24)) & 1) ? tx : ty;
      h = 0.5 + 0.5 * Math.max(Math.abs(tx), Math.abs(ty)) * 0.6 + over * 0.2; c = h * 0.6 + nz.fbm2(u * 6, v * 6, 3, 2, 0.5, 6, 6) * 0.5 + (r() - 0.5) * 0.2; tile = [0.07, 0.07]; str = 3.5;
    } else if (kind === 'leather') {  // grain + a few soft creases
      h = nz.noise2(u * 90, v * 90, 90, 90) * 0.25 + nz.fbm2(u * 8, v * 8, 4, 2, 0.5, 8, 8) * 0.4 + Math.abs(nz.noise2(u * 6, v * 20, 6, 20)) * -0.5;
      c = nz.fbm2(u * 5, v * 5, 4, 2, 0.55, 5, 5) * 0.8; tile = [0.12, 0.12]; str = 1.2;
    } else if (kind === 'web') {      // cotton webbing: tight ribs across the strap
      h = Math.sin(v * 60 * TAU) * 0.3 + Math.sin(u * 30 * TAU) * 0.1 + nz.noise2(u * 32, v * 32, 32, 32) * 0.1;
      c = nz.fbm2(u * 4, v * 4, 3, 2, 0.5, 4, 4) * 0.5; tile = [0.04, 0.04]; str = 2.0;
    } else if (kind === 'steel') {    // M1 helmet: sand-textured paint
      h = nz.noise2(u * 110, v * 110, 110, 110) * 0.5 + nz.noise2(u * 40, v * 40, 40, 40) * 0.3;
      c = nz.fbm2(u * 6, v * 6, 4, 2, 0.5, 6, 6) * 0.7; tile = [0.1, 0.1]; str = 1.3;
    } else if (kind === 'plaster') {  // mannequin skin: almost nothing
      h = nz.fbm2(u * 6, v * 6, 4, 2, 0.5, 6, 6) * 0.3; c = nz.fbm2(u * 3, v * 3, 3, 2, 0.5, 3, 3) * 0.4; tile = [0.3, 0.3]; str = 0.6;
    } else if (kind === 'wood') {     // walnut grain along u
      const w = u * 3 + nz.fbm2(u * 2, v * 12, 4, 2, 0.5, 2, 12) * 0.6;
      c = 0.5 + 0.35 * Math.sin(w * TAU * 6) * Math.abs(Math.sin(w * TAU * 1.3)) + nz.noise2(u * 40, v * 120, 40, 120) * 0.15; h = c * 0.2; tile = [0.35, 0.12]; str = 0.8;
    }
    H[y * N + x] = h; C[y * N + x] = c;
  }
  const amp = { melton: 0.07, serge: 0.07, sateen: 0.06, knit: 0.34, burlap: 0.3, leather: 0.12, web: 0.1, steel: 0.08, plaster: 0.03, wood: 0.5 }[kind];
  const map = greyTex((x, y) => { const k = 1 - amp * 0.5 + C[y * N + x] * amp; return [k, k, k]; }, N, N, tile);
  const nrm = normalTex(H, N, N, str, tile);
  return (TEX[kind] = { map, nrm, tile });
}
// helmet net: cords 3 mm, 25 mm mesh, knots; alpha-tested
function netTex() {
  if (TEX.net) return TEX.net;
  const N = 256, cell = 32, nz = makeNoise(41);
  const t = greyTex((x, y) => {
    const u = ((x + y) % cell) / cell, v = ((x - y + N * 4) % cell) / cell;          // diagonal diamond mesh
    const du = Math.min(u, 1 - u) * cell, dv = Math.min(v, 1 - v) * cell;
    const cord = Math.min(du, dv), knot = Math.hypot(du, dv);
    const a = cord < 2.2 || knot < 3.8 ? 1 : 0;
    const k = 0.75 + nz.noise2(x / 16, y / 16, 16, 16) * 0.2 - (knot < 3.8 ? 0.1 : 0);
    return [k, k * 0.97, k * 0.88, a];
  }, N, N, [0.2, 0.2], true);
  return (TEX.net = t);
}
// fringe (white bedspread edges and the Witness's scarf ends): vertical threads, alpha
function fringeTex() {
  if (TEX.fringe) return TEX.fringe;
  const W = 256, Hh = 64, r = rng(77), threads = [];
  for (let i = 0; i < 60; i++) threads.push({ x: (i + 0.5) / 60 * W + (r() - 0.5) * 2, len: 0.72 + r() * 0.28, w: 1.1 + r() * 0.7, bend: (r() - 0.5) * 4 });
  const t = greyTex((x, y) => {
    const v = y / Hh; let a = 0, k = 1;
    for (const th of threads) {
      const cx = th.x + th.bend * v * v; const d = Math.abs(x - cx);
      if (d < th.w && v < th.len) { a = Math.max(a, 1 - d / th.w * 0.5); k = 0.8 + 0.2 * (1 - d / th.w); }
    }
    if (v < 0.12) { a = 1; k = 0.85; }           // the knotted band where the threads leave the cloth
    return [k, k, k, a];
  }, W, Hh, [1, 1], true);
  return (TEX.fringe = t);
}

// ── materials ─────────────────────────────────────────────────────────────────────────────────────────────────────
// every material is plain() (engine fog) + a snow patch: s.snow whitens up-facing surfaces, patchy, stuck to the cloth
// (noise in bind-pose object space, so it does not swim over a walking figure)
const NOISE_GLSL = /* glsl */`
float sn_h(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sn_n(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sn_h(i), sn_h(i + vec3(1,0,0)), f.x), mix(sn_h(i + vec3(0,1,0)), sn_h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sn_h(i + vec3(0,0,1)), sn_h(i + vec3(1,0,1)), f.x), mix(sn_h(i + vec3(0,1,1)), sn_h(i + vec3(1,1,1)), f.x), f.y), f.z); }`;
const SNOW_FRAG = /* glsl */`
{ vec3 sWN = normalize(mix(normalize(vSnowN) * (gl_FrontFacing ? 1.0 : -1.0), inverseTransformDirection(normal, viewMatrix), 0.3));
  float sN = sn_n(vSnowP * 26.0) * 0.6 + sn_n(vSnowP * 71.0) * 0.4;
  float sA = uSnow * uSnowK;
  float sC = smoothstep(0.98 - 0.58 * sA, 1.18 - 0.48 * sA, sWN.y + (sN - 0.5) * 0.6) * step(0.001, sA);
  sC *= smoothstep(0.2, 0.55, sN + sA * 0.55);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92), sC);
  roughnessFactor = mix(roughnessFactor, 0.85, sC);
  metalnessFactor = mix(metalnessFactor, 0.0, sC); }
`;
function snowPatch(m, U, k, extra, tag = '') {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.uSnow = U.snow; sh.uniforms.uSnowK = { value: k };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowP; varying vec3 vSnowN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vSnowN = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vSnowP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowP; varying vec3 vSnowN; uniform float uSnow; uniform float uSnowK;\n' + NOISE_GLSL)
      .replace('#include <lights_physical_fragment>', SNOW_FRAG + '\n#include <lights_physical_fragment>');
    if (extra) extra(sh, r);
  };
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => key + '|snow' + tag;
  return m;
}
// material factory. kind: texture set; col: sRGB hex; o: extra MeshStandardMaterial params; snowK: how much snow it holds
function makeMat(U, kind, col, o = {}, snowK = 1) {
  const p = { color: new THREE.Color(col), roughness: 0.9, metalness: 0, ...o };
  if (kind === 'net') p.map = netTex();
  else if (kind === 'fringe') p.map = fringeTex();
  else if (kind) { const t = clothTex(kind); p.map = t.map; p.normalMap = t.nrm; p.normalScale = new THREE.Vector2(o.nScale ?? 1, o.nScale ?? 1); }
  delete p.nScale;
  const m = plain(p);
  return snowPatch(m, U, snowK);
}
// small colour jitter so no two wool coats are the same bolt of cloth
function jitter(hex, r, amt = 0.05) {
  const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h + (r() - 0.5) * amt * 0.3, clamp(hsl.s * (1 + (r() - 0.5) * amt * 2)), clamp(hsl.l * (1 + (r() - 0.5) * amt * 2)));
  return c.getHex();
}

// ── geometry: loft rows of points into a surface with UVs in metres ───────────────────────────────────────────────────
// rows: [[Vector3...], ...] (each row one ring / cross-section). closed: rows wrap around (a seam column is duplicated)
function loft(rows, o = {}) {
  const closed = o.closed ?? true, nr = rows.length, nc = rows[0].length, cols = closed ? nc + 1 : nc;
  const pos = new Float32Array(nr * cols * 3), uv = new Float32Array(nr * cols * 2), idx = [];
  const vAcc = new Float32Array(cols);
  for (let i = 0; i < nr; i++) {
    const row = rows[i];
    let u = 0;
    for (let j = 0; j < cols; j++) {
      const p = row[j % nc], k = i * cols + j;
      if (j > 0) u += p.distanceTo(row[(j - 1) % nc]);
      if (i > 0) vAcc[j] += p.distanceTo(rows[i - 1][j % nc]);
      pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
      uv[k * 2] = u; uv[k * 2 + 1] = vAcc[j];
    }
  }
  const flip = o.flip ? 1 : 0;
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (closed) {             // weld the seam normals
    const n = g.attributes.normal;
    for (let i = 0; i < nr; i++) {
      const a = i * cols, b = i * cols + nc;
      _v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, _v.x, _v.y, _v.z); n.setXYZ(b, _v.x, _v.y, _v.z);
    }
  }
  if (o.capStart || o.capEnd) {
    const parts = [g];
    if (o.capStart) parts.push(cap(rows[0], !flip));
    if (o.capEnd) parts.push(cap(rows[nr - 1], !!flip));
    g = merge(parts);
  }
  return g;
}
function cap(row, rev) {          // fan cap over a ring
  const c = V3(); for (const p of row) c.add(p); c.multiplyScalar(1 / row.length);
  const pos = [c.x, c.y, c.z], uv = [0, 0], idx = [];
  for (const p of row) { pos.push(p.x, p.y, p.z); uv.push(p.x - c.x, p.z - c.z); }
  for (let j = 0; j < row.length; j++) { const a = 1 + j, b = 1 + (j + 1) % row.length; if (rev) idx.push(0, b, a); else idx.push(0, a, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function merge(list) {
  const clean = list.map((g) => { const x = g.index ? g : g; for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); if (!x.index) { const n = x.attributes.position.count; x.setIndex([...Array(n).keys()]); } return x; });
  return mergeGeometries(clean, false);
}
// rows from a function: f(i, j, t, a) -> Vector3, t = i/(n-1) along, a = angle 0..2π around (closed) or 0..1 (open)
function rowsOf(n, m, f, closed = true) {
  const rows = [];
  for (let i = 0; i < n; i++) { const t = i / (n - 1), row = []; for (let j = 0; j < m; j++) row.push(f(i, j, t, closed ? j / m * TAU : j / (m - 1))); rows.push(row); }
  return rows;
}
// tube along a path (Vector3[]), radius r(t, a) (a = angle, 0 = frame side axis), rotation-minimising frames
function tube(path, r, m = 12, o = {}) {
  m = dq(m, 5);
  const n = path.length, T = [], N = [], B = [];
  for (let i = 0; i < n; i++) T.push(path[Math.min(n - 1, i + 1)].clone().sub(path[Math.max(0, i - 1)]).normalize());
  const up = o.up ? o.up.clone() : (Math.abs(T[0].y) > 0.9 ? V3(0, 0, 1) : V3(0, 1, 0));
  N.push(up.sub(T[0].clone().multiplyScalar(up.dot(T[0]))).normalize());
  for (let i = 1; i < n; i++) { const nn = N[i - 1].clone().sub(T[i].clone().multiplyScalar(N[i - 1].dot(T[i]))).normalize(); N.push(nn); }
  for (let i = 0; i < n; i++) B.push(T[i].clone().cross(N[i]));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), row = [];
    for (let j = 0; j < m; j++) {
      const a = j / m * TAU, rr = typeof r === 'function' ? r(t, a) : r;
      const rx = Array.isArray(rr) ? rr[0] : rr, ry = Array.isArray(rr) ? rr[1] : rr;
      row.push(path[i].clone().addScaledVector(N[i], Math.cos(a) * rx).addScaledVector(B[i], Math.sin(a) * ry));
    }
    rows.push(row);
  }
  return loft(rows, { closed: true, capStart: o.caps, capEnd: o.caps });
}
// smooth path through control points (Catmull-Rom), n samples
function path(pts, n) { n = dq(n, 4); const c = new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : V3(...p))), false, 'centripetal'); return c.getSpacedPoints(n - 1); }
function sphereG(r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 14, hs = 10) { const g = new THREE.SphereGeometry(r, dq(ws, 6), dq(hs, 4)); g.scale(sx, sy, sz); g.translate(x, y, z); return g; }
function cylG(r0, r1, h, seg = 12, open = false) { return new THREE.CylinderGeometry(r1, r0, h, seg, 1, open); }
// cylinder from a to b (Vector3), radii ra, rb
function rod(a, b, ra, rb = ra, seg = 10, open = false) {
  const g = new THREE.CylinderGeometry(rb, ra, a.distanceTo(b), seg, 1, open);
  g.applyQuaternion(_q.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize()));
  const m = a.clone().add(b).multiplyScalar(0.5); g.translate(m.x, m.y, m.z); return g;
}
// rounded box (w along x, h along y, d along z) with UVs in metres
function rbox(w, h, d, r, seg = 1) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2 + 1, seg * 2 + 1, seg * 2 + 1), p = g.attributes.position, uv = g.attributes.uv;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const cx = clamp(x, -hx, hx), cy = clamp(y, -hy, hy), cz = clamp(z, -hz, hz);
    _v.set(x - cx, y - cy, z - cz); const l = _v.length();
    if (l > 1e-6) _v.multiplyScalar(r / l);
    p.setXYZ(i, cx + _v.x, cy + _v.y, cz + _v.z);
    const ax = Math.abs(x) / w, ay = Math.abs(y) / h, az = Math.abs(z) / d;
    if (ax >= ay && ax >= az) uv.setXY(i, z, y); else if (ay >= az) uv.setXY(i, x, z); else uv.setXY(i, x, y);
  }
  g.computeVertexNormals(); return g;
}
function xf(g, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], order = 'XYZ' } = {}) {
  _m.compose(V3(...p), _q.setFromEuler(new THREE.Euler(r[0], r[1], r[2], order)), V3(...s)); g.applyMatrix4(_m); return g;
}

// ── skinned kit: geometry per material, each vertex with ≤ 4 bone weights ──────────────────────────────────────────────
// add(matKey, geometry, w): w = a Bone (rigid) or f(x, y, z) -> [[bone, weight], ...] evaluated on bind-pose positions
class Kit {
  constructor(bones, scale = [1, 1, 1]) { this.bones = bones; this.bi = new Map(bones.map((b, i) => [b, i])); this.parts = {}; this.scale = scale; }
  add(key, g, w) {
    if (!g.attributes.normal) g.computeVertexNormals();
    if (g.attributes.skinIndex) g.deleteAttribute('skinIndex');
    if (!g.index) { const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); }
    const P = g.attributes.position, n = P.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      let L;
      if (w && w.isBone) L = [[w, 1]];
      else L = w(P.getX(i), P.getY(i), P.getZ(i), i);
      L = L.filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      let s = 0; for (const e of L) s += e[1];
      for (let k = 0; k < L.length; k++) { const b = L[k][0]; let ix = this.bi.get(b); if (ix === undefined) { ix = this.bones.indexOf(b); if (ix < 0) throw new Error('kit: bone not in rig ' + b.name); this.bi.set(b, ix); } si[i * 4 + k] = ix; sw[i * 4 + k] = L[k][1] / s; }
    }
    const [sx, sy, sz] = this.scale;
    if (sx !== 1 || sy !== 1 || sz !== 1) {
      const N = g.attributes.normal;
      for (let i = 0; i < n; i++) {
        P.setXYZ(i, P.getX(i) * sx, P.getY(i) * sy, P.getZ(i) * sz);
        _v.set(N.getX(i) / sx, N.getY(i) / sy, N.getZ(i) / sz).normalize(); N.setXYZ(i, _v.x, _v.y, _v.z);
      }
    }
    (this.parts[key] ||= []).push({ g, si, sw });
    return g;
  }
  build(mats, skeleton, group) {
    const meshes = []; let tris = 0;
    for (const key of Object.keys(this.parts)) {
      const L = this.parts[key];
      let nv = 0, ni = 0; for (const { g } of L) { nv += g.attributes.position.count; ni += g.index.count; }
      const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), ix = new Uint32Array(ni);
      let ov = 0, oi = 0;
      for (const { g, si: s0, sw: w0 } of L) {
        const n = g.attributes.position.count;
        pos.set(g.attributes.position.array.subarray(0, n * 3), ov * 3); nrm.set(g.attributes.normal.array.subarray(0, n * 3), ov * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), ov * 2);
        si.set(s0, ov * 4); sw.set(w0, ov * 4);
        const id = g.index.array; for (let k = 0; k < id.length; k++) ix[oi + k] = id[k] + ov;
        ov += n; oi += id.length;
      }
      const G = new THREE.BufferGeometry();
      G.setAttribute('position', new THREE.BufferAttribute(pos, 3)); G.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      G.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); G.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      G.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); G.setIndex(new THREE.BufferAttribute(ix, 1));
      const mesh = new THREE.SkinnedMesh(G, mats[key]);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = key;
      group.add(mesh); mesh.bind(skeleton, new THREE.Matrix4());
      meshes.push(mesh); tris += ni / 3;
    }
    return { meshes, tris };
  }
}
// weight helpers
const W1 = (b) => [[b, 1]];
function blend2(a, b, t) { return t <= 0 ? [[a, 1]] : t >= 1 ? [[b, 1]] : [[a, 1 - t], [b, t]]; }

// ── the rig ───────────────────────────────────────────────────────────────────────────────────────────────────────
// bind pose: standing, arms hanging a little away from the body, palms to the thighs, every bone's rotation identity
// (so the pose angles read like figures.js person(): negative X = limb forward, elbow/knee as there)
const J = {
  pelvis: [0, 0.97, 0], spine: [0, 1.09, -0.01], chest: [0, 1.28, -0.02], neck: [0, 1.485, -0.03], head: [0, 1.575, -0.012],
  clav: [0.03, 1.44, -0.005], arm: [0.185, 1.425, -0.025], fore: [0.212, 1.13, -0.04], hand: [0.228, 0.872, -0.018],
  thigh: [0.09, 0.925, 0], shin: [0.095, 0.51, 0.012], foot: [0.1, 0.092, -0.02], toe: [0.1, 0.022, 0.125],
};
const FING = [      // [z at the knuckle, y drop of the knuckle, phalanx lengths, radius]
  [0.030, 0.093, [0.043, 0.026, 0.020], 0.0086], [0.010, 0.098, [0.047, 0.029, 0.021], 0.0091],
  [-0.010, 0.095, [0.044, 0.027, 0.020], 0.0086], [-0.028, 0.086, [0.034, 0.021, 0.018], 0.0074],
];
function makeRig(h, prop = {}) {
  const s = h / 1.76, sw = prop.width ?? 1;          // sw: shoulder/hip width factor (the Witness is slimmer)
  const P = (k, side = 1) => { const j = J[k]; return V3(j[0] * side * s * (k === 'head' || k === 'neck' ? 1 : sw), j[1] * s, j[2] * s); };
  const bones = [], B = {};
  const bone = (name, parent, worldPos) => {
    const b = new THREE.Bone(); b.name = name; b.userData.bind = worldPos.clone();
    if (parent) { b.position.copy(worldPos).sub(parent.userData.bind); parent.add(b); } else b.position.copy(worldPos);
    bones.push(b); B[name] = b; return b;
  };
  const root = bone('root', null, V3(0, 0, 0));
  const pelvis = bone('pelvis', root, P('pelvis'));
  const spine = bone('spine', pelvis, P('spine'));
  const chest = bone('chest', spine, P('chest'));
  const neck = bone('neck', chest, P('neck'));
  bone('head', neck, P('head'));
  for (const [sd, side] of [['L', 1], ['R', -1]]) {
    const clav = bone('clav' + sd, chest, P('clav', side));
    const arm = bone('arm' + sd, clav, P('arm', side));
    const fore = bone('fore' + sd, arm, P('fore', side));
    const hand = bone('hand' + sd, fore, P('hand', side));
    // fingers: phalanx bones hang straight down from the knuckles; the palm faces the thigh (−side·X)
    const hs = s * (prop.hand ?? 1);
    FING.forEach(([z, dy, L], f) => {
      let par = hand, at = P('hand', side).add(V3(0, -dy * hs, z * hs));
      for (let k = 0; k < 3; k++) { const b = bone(`f${sd}${f}${k}`, par, at); par = b; at = at.clone().add(V3(0, -L[k] * hs, 0)); }
      bone(`f${sd}${f}tip`, par, at);
    });
    const tb = P('hand', side).add(V3(-side * 0.012 * hs, -0.026 * hs, 0.026 * hs));
    const td = V3(-side * 0.3, -0.72, 0.62).normalize();
    let par = hand, at = tb;
    [0.04, 0.032, 0.027].forEach((L, k) => { const b = bone(`t${sd}${k}`, par, at); b.userData.dir = td.clone(); par = b; at = at.clone().addScaledVector(td, L * hs); });
    bone(`t${sd}tip`, par, at);
    const thigh = bone('thigh' + sd, pelvis, P('thigh', side));
    const shin = bone('shin' + sd, thigh, P('shin', side));
    const foot = bone('foot' + sd, shin, P('foot', side));
    bone('toe' + sd, foot, P('toe', side));
  }
  // props: weapon, carried case, chinstraps, scarf tails are added by the builders (prop bones parent to root)
  return { bones, B, s, sw, P };
}
function propBone(rig, name, parent = rig.B.root) {
  const b = new THREE.Bone(); b.name = name; b.userData.bind = V3(0, 0, 0);
  // bind at the figure origin with identity rotation: the prop's geometry is authored in its own frame
  parent.add(b); rig.bones.push(b); rig.B[name] = b; b.userData.prop = true;
  b.userData.bindParent = parent;
  return b;
}

// ── hands: finger curl presets [mcp, pip, dip] per finger (index..little) and thumb [cmc flex, mcp, ip, opposition] ────
const HAND = {
  relaxed: { f: [[0.22, 0.32, 0.18], [0.28, 0.38, 0.2], [0.34, 0.42, 0.22], [0.4, 0.48, 0.25]], t: [0.15, 0.15, 0.1, 0.35], spread: 0.04 },
  fist: { f: [[1.45, 1.65, 1.0], [1.5, 1.7, 1.05], [1.55, 1.7, 1.05], [1.6, 1.7, 1.0]], t: [0.45, 0.7, 0.55, 0.95], spread: 0 },
  grip: { f: [[1.0, 1.3, 0.75], [1.05, 1.35, 0.8], [1.1, 1.35, 0.8], [1.15, 1.35, 0.8]], t: [0.35, 0.45, 0.35, 1.0], spread: 0.02 },
  flat: { f: [[0.02, 0.03, 0.02], [0.02, 0.03, 0.02], [0.03, 0.03, 0.02], [0.04, 0.04, 0.02]], t: [0.0, 0.05, 0.05, 0.15], spread: 0.0 },
  pinch: { f: [[0.3, 0.35, 0.2], [0.34, 0.4, 0.22], [0.42, 0.5, 0.25], [0.5, 0.55, 0.28]], t: [0.25, 0.35, 0.3, 0.75], spread: 0.05 },
  point: { f: [[0.05, 0.05, 0.04], [1.5, 1.7, 1.0], [1.55, 1.7, 1.0], [1.6, 1.7, 1.0]], t: [0.4, 0.6, 0.5, 0.9], spread: 0.02 },
  sheet: { f: [[0.3, 0.34, 0.16], [0.36, 0.38, 0.18], [0.44, 0.46, 0.22], [0.52, 0.52, 0.25]], t: [0.02, 0.1, 0.06, 0.5], spread: 0.0 },
  soft: { f: [[0.12, 0.18, 0.1], [0.15, 0.2, 0.1], [0.18, 0.22, 0.12], [0.22, 0.26, 0.14]], t: [0.1, 0.1, 0.08, 0.3], spread: 0.06 },
};
function setHand(B, sd, side, name) {
  const H = HAND[name] || HAND.relaxed;
  for (let f = 0; f < 4; f++) for (let k = 0; k < 3; k++) {
    const b = B[`f${sd}${f}${k}`];
    b.rotation.set(k === 0 ? -(f - 1.5) * H.spread : 0, 0, -side * H.f[f][k]);
  }
  const td = B[`t${sd}0`].userData.dir, n = V3(-side, 0, 0), ax = td.clone().cross(n).normalize();
  const t = H.t;
  B[`t${sd}0`].quaternion.setFromAxisAngle(V3(0, 1, 0), -side * t[3]).multiply(_q.setFromAxisAngle(ax, t[0]));
  B[`t${sd}1`].quaternion.setFromAxisAngle(ax, t[1]);
  B[`t${sd}2`].quaternion.setFromAxisAngle(ax, t[2]);
}

// ── 2-bone IK (world space). S shoulder/hip, T target, pole = where the elbow/knee points. rest: {a1, f1, a2, f2} ─────
function basis(a, f) { const s = a.clone().cross(f).normalize(); const ff = s.clone().cross(a).normalize(); return new THREE.Matrix4().makeBasis(a.clone().normalize(), ff, s); }
function twoBone(b1, b2, L1, L2, T, pole, rest) {
  const S = b1.getWorldPosition(V3());
  const d = T.clone().sub(S); let D = d.length();
  D = clamp(D, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-4); d.normalize();
  const pp = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d)));
  if (pp.lengthSq() < 1e-8) pp.set(0, 0, 1).sub(d.clone().multiplyScalar(d.z));
  pp.normalize();
  const cb = clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1), sb = Math.sqrt(1 - cb * cb);
  const E = S.clone().addScaledVector(d, L1 * cb).addScaledVector(pp, L1 * sb);
  const d1 = E.clone().sub(S).normalize(), Tn = S.clone().addScaledVector(d, D), d2 = Tn.clone().sub(E).normalize();
  // the distal segment bends toward f1: perpendicular to d1, toward d2 (straight arm: away from the pole)
  let f1 = d2.clone().sub(d1.clone().multiplyScalar(d2.dot(d1)));
  if (f1.lengthSq() < 1e-6) f1 = pp.clone().negate(); f1.normalize();
  const s1 = d1.clone().cross(f1).normalize(), f2 = s1.clone().cross(d2).normalize();
  const W1 = basis(d1, f1).multiply(rest.m1T), W2 = basis(d2, f2).multiply(rest.m2T);
  setWorldRot(b1, _q2.setFromRotationMatrix(W1));
  b1.updateMatrixWorld(true);
  setWorldRot(b2, _q2.setFromRotationMatrix(W2));
  b2.updateMatrixWorld(true);
  return E;
}
function setWorldRot(b, qw) { b.parent.getWorldQuaternion(_q); b.quaternion.copy(_q.invert().multiply(qw)); }
function restOf(p0, p1, p2, bend) {   // bind positions and the bend direction (+Z arms, −Z legs)
  const a1 = p1.clone().sub(p0).normalize(), a2 = p2.clone().sub(p1).normalize();
  const f1 = bend.clone().sub(a1.clone().multiplyScalar(bend.dot(a1))).normalize();
  const f2 = bend.clone().sub(a2.clone().multiplyScalar(bend.dot(a2))).normalize();
  return { m1T: basis(a1, f1).transpose(), m2T: basis(a2, f2).transpose(), L1: p0.distanceTo(p1), L2: p1.distanceTo(p2) };
}

// ── the figure: pose / walk / update over a rig + kit ──────────────────────────────────────────────────────────────
const DEF = { lArmZ: 0.07, rArmZ: -0.07, lElbow: -0.14, rElbow: -0.14, lShape: 'relaxed', rShape: 'relaxed' };
function makeFigure(rig, opts = {}) {
  const { B } = rig, s = rig.s;
  const group = new THREE.Group(); group.name = opts.name || 'figure';
  group.add(B.root);
  for (const b of rig.bones) b.userData.rest = b.position.clone();
  const bindW = (n) => B[n].userData.bind;
  const rest = {
    L: restOf(bindW('armL'), bindW('foreL'), bindW('handL'), V3(0, 0, 1)), R: restOf(bindW('armR'), bindW('foreR'), bindW('handR'), V3(0, 0, 1)),
    lL: restOf(bindW('thighL'), bindW('shinL'), bindW('footL'), V3(0, 0, -1)), lR: restOf(bindW('thighR'), bindW('shinR'), bindW('footR'), V3(0, 0, -1)),
  };
  const ankleH = bindW('footL').y, heelB = 0.075 * s, ballF = bindW('toeL').z - bindW('footL').z;
  // anchors
  const A = {};
  const anchor = (name, parent, p) => { const o = new THREE.Object3D(); o.name = name; o.position.copy(p); parent.add(o); A[name] = o; return o; };
  anchor('head', B.head, V3(0, 0.09 * s, 0.015 * s));
  anchor('mouth', B.head, V3(0, 0.03 * s, 0.115 * s));
  anchor('leftHand', B.handL, V3(-0.018 * s, -0.075 * s, 0.01 * s));
  anchor('rightHand', B.handR, V3(0.018 * s, -0.075 * s, 0.01 * s));
  anchor('paper', B.root, V3(0, 1.2 * s, 0.35 * s));
  const held = [];            // objects held by IK: {obj, parent, pos, quat, l: {p, fingers, palm}, r: {...}}
  const api = { group, bones: B, anchors: A, rig, stride: 1.3 * s, held, update: null };
  let base = { ...DEF };
  const props = opts.props || {};     // prop placers: (p, api) -> { lHand?, rHand? } targets

  function resetBones() { for (const b of rig.bones) { if (b.userData.prop) continue; b.position.copy(b.userData.rest); b.quaternion.identity(); } }
  function fk(p) {
    B.pelvis.position.x += (p.side ?? 0) * s; B.pelvis.position.y -= (p.drop ?? 0) * s; B.pelvis.position.z += (p.fwd ?? 0) * s;
    B.pelvis.rotation.set(p.lean ?? 0, p.turn ?? 0, p.roll ?? 0);
    B.spine.rotation.set(p.spineX ?? 0, p.spineY ?? 0, p.spineZ ?? 0);
    B.chest.rotation.set(p.chestX ?? 0, p.chestY ?? 0, p.chestZ ?? 0);
    B.neck.rotation.set((p.headX ?? 0) * 0.4, (p.headY ?? 0) * 0.4, (p.headZ ?? 0) * 0.4);
    B.head.rotation.set((p.headX ?? 0) * 0.6, (p.headY ?? 0) * 0.6, (p.headZ ?? 0) * 0.6);
    for (const [sd, side, k] of [['L', 1, 'l'], ['R', -1, 'r']]) {
      B['clav' + sd].rotation.set(0, -side * (p[k + 'Fwd'] ?? 0), side * (p[k + 'Shrug'] ?? 0));
      B['arm' + sd].rotation.set(p[k + 'ArmX'] ?? 0, p[k + 'ArmY'] ?? 0, p[k + 'ArmZ'] ?? side * 0.07);
      B['fore' + sd].rotation.set(p[k + 'Elbow'] ?? -0.14, p[k + 'ForeY'] ?? 0, 0);
      B['hand' + sd].rotation.set(p[k + 'WristX'] ?? 0, p[k + 'WristY'] ?? 0, p[k + 'WristZ'] ?? 0);
      B['thigh' + sd].rotation.set(p[k + 'Leg'] ?? 0, p[k + 'LegY'] ?? side * 0.06, p[k + 'LegZ'] ?? side * 0.015);
      B['shin' + sd].rotation.set(p[k + 'Knee'] ?? 0, 0, 0);
      B['foot' + sd].rotation.set(p[k + 'Foot'] ?? 0, 0, 0);
      B['toe' + sd].rotation.set(p[k + 'Toe'] ?? 0, 0, 0);
      setHand(B, sd, side, p[k + 'Shape'] ?? 'relaxed');
    }
  }
  // world-space target helpers
  const spaceObj = (sp) => (sp === 'root' ? B.root : sp === 'head' ? B.head : sp === 'pelvis' ? B.pelvis : B.chest);
  function handIK(side, spec) {
    const sd = side > 0 ? 'L' : 'R', par = spec.obj || spaceObj(spec.space);
    par.updateMatrixWorld(true);
    if (spec.dir) {
      // point along a direction (in the space's frame) from the real shoulder: a nearly straight arm (spec.reach of its
      // length, default 0.993), the fingers along it, the palm toward spec.palm (default down), the elbow toward spec.pole
      const R0 = side > 0 ? rest.L : rest.R, qp = par.getWorldQuaternion(new THREE.Quaternion());
      const d = V3(...spec.dir).applyQuaternion(qp).normalize(), S = B['arm' + sd].getWorldPosition(V3());
      const palm0 = V3(...(spec.palm || [0, -1, 0])).applyQuaternion(qp);
      let palm = palm0.sub(d.clone().multiplyScalar(palm0.dot(d)));
      if (palm.lengthSq() < 1e-6) palm = V3(-side, 0, 0).applyQuaternion(qp);
      palm.normalize();
      const pole = V3(...(spec.pole || [side * 0.35, -1, -0.15])).applyQuaternion(B.chest.getWorldQuaternion(new THREE.Quaternion())).normalize();
      twoBone(B['arm' + sd], B['fore' + sd], R0.L1, R0.L2, S.clone().addScaledVector(d, (R0.L1 + R0.L2) * (spec.reach ?? 0.993)), pole, R0);
      const hb = B['hand' + sd], sdir = d.clone().cross(palm).normalize(), pl = sdir.clone().cross(d).normalize();
      const W = new THREE.Matrix4().makeBasis(d, pl, sdir);
      const Rb = new THREE.Matrix4().makeBasis(V3(0, -1, 0), V3(-side, 0, 0), V3(0, -1, 0).cross(V3(-side, 0, 0))).transpose();
      setWorldRot(hb, _q2.setFromRotationMatrix(W.multiply(Rb)));
      hb.updateMatrixWorld(true);
      return;
    }
    const T = par.localToWorld(V3(...spec.p).multiplyScalar(spec.obj ? 1 : s));
    const qp = par.getWorldQuaternion(new THREE.Quaternion());
    const pole = V3(...(spec.pole || [side * 0.5, -0.4, -1])).applyQuaternion(spec.poleObj ? spec.poleObj.getWorldQuaternion(new THREE.Quaternion()) : B.chest.getWorldQuaternion(new THREE.Quaternion())).normalize();
    // the target is the grip point in the palm; aim the wrist so that the grip point lands on T
    const hb = B['hand' + sd];
    let fingers = spec.fingers ? V3(...spec.fingers).applyQuaternion(qp).normalize() : null;
    let palm = spec.palm ? V3(...spec.palm).applyQuaternion(qp).normalize() : null;
    let Tw = T;
    if (fingers && palm) {
      // grip point sits 0.075 down the fingers and 0.02 toward the palm from the wrist joint
      Tw = T.clone().addScaledVector(fingers, -0.072 * s).addScaledVector(palm, -0.02 * s);
    }
    twoBone(B['arm' + sd], B['fore' + sd], (side > 0 ? rest.L : rest.R).L1, (side > 0 ? rest.L : rest.R).L2, Tw, pole, side > 0 ? rest.L : rest.R);
    if (fingers && palm) {
      const sdir = fingers.clone().cross(palm).normalize(); palm = sdir.clone().cross(fingers).normalize();
      const W = new THREE.Matrix4().makeBasis(fingers, palm, sdir);
      const R0 = new THREE.Matrix4().makeBasis(V3(0, -1, 0), V3(-side, 0, 0), V3(0, -1, 0).cross(V3(-side, 0, 0))).transpose();
      setWorldRot(hb, _q2.setFromRotationMatrix(W.multiply(R0)));
    }
    hb.updateMatrixWorld(true);
  }
  function soleMinY() {
    let m = Infinity;
    for (const sd of ['L', 'R']) {
      for (const [bn, p] of [['foot' + sd, V3(0, -ankleH, -heelB)], ['foot' + sd, V3(0, -ankleH, ballF * 0.9)], ['toe' + sd, V3(0, -bindW('toeL').y, 0.07 * s)]]) {
        const w = B[bn].localToWorld(p.clone()); B.root.worldToLocal(w); m = Math.min(m, w.y);
      }
    }
    return m;
  }
  // gait: foot targets in root space for one leg at cycle fraction u (0 = heel strike)
  const G = { duty: 0.62, heelEnd: 0.07, flatEnd: 0.4, hsPitch: -0.28, toPitch: 0.72, lift: 0.1 };
  // ov (optional, cast.js through speed changes): { d } shifts a stance heel to where the foot really landed; { d0, d1,
  // m0, m1 } = the swing's real lift-off / landing shifts and the stance speeds there (planted feet while k changes)
  function footAt(u, stride, k, ov) {
    const st = G.duty, dz = ov && ov.d != null ? ov.d : 0;
    const heelZ = (w) => stride * (0.5 * st - w - 0.1) + heelB * 0.4 + dz;   // heel contact z at stance fraction w (cycles)
    const ankleFrom = (pz, pitch, pivot) => {                                // pivot: 'heel' | 'ball'
      const off = pivot === 'heel' ? V3(0, -ankleH, -heelB) : V3(0, -ankleH, ballF);
      off.applyAxisAngle(V3(1, 0, 0), pitch);
      return V3(0, -off.y, pz - off.z);
    };
    let a, pitch, toe = 0;
    if (u < st && G.ball) {
      // a sprinter's stance (G.ball): landing on the ball of the foot (toes down, hsPitch), the heel dipping a little at
      // mid-stance, then rolling up into toe-off; the ball stays planted the whole time
      const w = u / st;
      pitch = k * (G.hsPitch + (G.toPitch - G.hsPitch) * sstep(0.35, 1, w) ** 1.3 - 0.12 * Math.sin(Math.PI * w));
      a = ankleFrom(heelZ(u) + heelB + ballF, pitch, 'ball'); toe = -pitch;
    } else if (u < st) {
      const hz = heelZ(u);
      if (u < G.heelEnd) { pitch = lerp(G.hsPitch * k, 0, sstep(0, G.heelEnd, u)); a = ankleFrom(hz, pitch, 'heel'); }
      else if (u < G.flatEnd) { pitch = 0; a = ankleFrom(hz, 0, 'heel'); }
      else { pitch = G.toPitch * k * sstep(G.flatEnd, st, u) ** 1.3; a = ankleFrom(hz + heelB + ballF, pitch, 'ball'); toe = -pitch; }
    } else {
      const w = (u - st) / (1 - st);
      const a0 = footAt(st - 1e-4, stride, k, ov ? { d: ov.d0 ?? 0 } : null).a, a1 = footAt(0, stride, k, ov ? { d: ov.d1 ?? 0 } : null).a;
      const e = w * w * (3 - 2 * w);
      // fix (locomotion QA): the swing leaves and lands with the stance's own backward speed (a Hermite in z), so the
      // foot is still in the world at toe-off and at heel strike, and the lift reaches the ground exactly at heel
      // strike. It used to land at 87 % of the swing and skid forward at walking speed until the stance began.
      const m = -stride * (1 - st), m0 = ov && ov.m0 != null ? ov.m0 : m, m1 = ov && ov.m1 != null ? ov.m1 : m, w2 = w * w, w3 = w2 * w;
      const z = (2 * w3 - 3 * w2 + 1) * a0.z + (w3 - 2 * w2 + w) * m0 + (3 * w2 - 2 * w3) * a1.z + (w3 - w2) * m1;
      // the lift keeps a floor (35 %) as the step shortens: a figure starting to walk lifts its feet, not drags them
      a = V3(0, lerp(a0.y, a1.y, e) + Math.sin(Math.PI * w) * G.lift * (0.35 + 0.65 * Math.min(1, k)) * s, z);
      pitch = w < 0.35 ? lerp(G.toPitch * k, 0.1 * k, w / 0.35) : lerp(0.1 * k, G.hsPitch * k, (w - 0.35) / 0.65);
      toe = -Math.max(0, pitch) * (1 - w / 0.35) * (w < 0.35 ? 1 : 0);
    }
    return { a, pitch, toe };
  }
  // p.plantFeet = a reference pose (idle life): its feet are solved first and kept exactly where they are while p moves
  // the pelvis and torso over them (weight shift) - 2-bone leg IK to the reference ankles, the feet keep their angle
  function apply(p, gait) {
    const gnd = !gait && p && p.ground && p.plant !== false ? p.ground : null;
    const ref = !gait && p && p.plant !== false ? (p.plantFeet || (gnd ? p : null)) : null;
    if (!ref) return applyPose(p, gait);
    applyPose(ref, null);
    B.root.updateMatrixWorld(true);
    const py = B.pelvis.position.y, rootInv = new THREE.Matrix4().copy(B.root.matrixWorld).invert();
    const feet = ['L', 'R'].map((sd) => ({ sd, pos: B['foot' + sd].getWorldPosition(V3()).applyMatrix4(rootInv), q: B.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(B['foot' + sd].getWorldQuaternion(new THREE.Quaternion())), toe: B['toe' + sd].rotation.x,
      knee: B['shin' + sd].getWorldPosition(V3()).applyMatrix4(rootInv), hip: B['thigh' + sd].getWorldPosition(V3()).applyMatrix4(rootInv) }));
    // on a slope each reference foot goes onto the terrain under it (and pitches with it); the body drops for the lower one
    let low = 0;
    if (gnd) for (const f of feet) {
      f.gy = gnd(f.pos.x, f.pos.z); low = Math.min(low, f.gy); f.pos.y += f.gy;
      f.q.premultiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), -Math.atan2(gnd(f.pos.x, f.pos.z + 0.12 * s) - gnd(f.pos.x, f.pos.z - 0.12 * s), 0.24 * s)));
    }
    applyPose(p, null);
    B.pelvis.position.y = py - ((p.drop ?? 0) - (ref.drop ?? 0)) * s + low;   // the reference height (no re-planting bob)
    B.root.updateMatrixWorld(true);
    const rq = B.root.getWorldQuaternion(new THREE.Quaternion());
    for (const f of feet) {
      const side = f.sd === 'L' ? 1 : -1, r = side > 0 ? rest.lL : rest.lR;
      // the knee stays in the plane it had in the reference pose (turned-out feet, kneeling legs); straight legs: forward
      const mid = f.hip.clone().add(f.pos).multiplyScalar(0.5), kd = f.knee.clone().sub(mid);
      const pole = (kd.lengthSq() > 1e-4 ? kd.normalize() : V3(side * 0.12, 0, 1)).applyQuaternion(rq);
      twoBone(B['thigh' + f.sd], B['shin' + f.sd], r.L1, r.L2, f.pos.clone().applyMatrix4(B.root.matrixWorld), pole, r);
      setWorldRot(B['foot' + f.sd], rq.clone().multiply(f.q)); B['toe' + f.sd].rotation.x = f.toe;
      B['foot' + f.sd].updateMatrixWorld(true);
    }
    B.root.updateMatrixWorld(true);
  }
  function applyPose(p, gait) {
    resetBones();
    fk(p);
    B.root.updateMatrixWorld(true);
    if (gait) {
      const { ph, k } = gait, stride = api.stride * k;
      const uL = ((ph / TAU) % 1 + 1) % 1, uR = (uL + 0.5) % 1;
      const fL = footAt(uL, stride, k, gait.ov && gait.ov[0]), fR = footAt(uR, stride, k, gait.ov && gait.ov[1]);
      const swing = (fR.a.z - fL.a.z) / Math.max(0.3, api.stride);         // + when the right foot is ahead
      // pelvis: bob (high at mid-stance), sway over the stance foot, twist with the swinging leg
      const bob = (Math.cos(2 * (ph - (G.bobPh ?? 0.28) * TAU)) * (G.bobA ?? 0.014) - (G.bobOff ?? 0.03)) * k * s;
      B.pelvis.position.x += Math.sin(ph - 0.35) * 0.014 * k * s;
      // fix: the pelvis turns WITH the forward leg and the chest back against it (both were mirrored)
      const aDrive = p.armDrive ? Math.cos(ph - G.duty * TAU) : 0;       // sprint: +1 = left arm fully forward
      B.pelvis.rotation.y += (p.armDrive ? -0.09 * aDrive : swing * 0.1) * k;
      B.pelvis.rotation.z += Math.sin(ph) * 0.025 * k;
      B.chest.rotation.y += (p.armDrive ? 0.2 * aDrive : -swing * 0.1) * k;
      if (p.armDrive) B.head.rotation.y -= 0.1 * aDrive * k;             // the head keeps looking where it runs
      B.pelvis.position.y += bob;
      // on a slope (gait.ground: terrain height at a root-local point minus the root's): each foot lands on the terrain
      // under it, pitched to it (fix: feet were planted on a flat plane through the root - ~10 cm in/over a 16° slope)
      const gnd = gait.ground || null;
      for (const f of [fL, fR]) f.gy = 0, f.gp = 0;
      if (gnd) for (const [sd, f] of [['L', fL], ['R', fR]]) {
        const fx = B['foot' + sd].userData.bind.x, fz = f.a.z + 0.03 * s;
        f.gy = gnd(fx, fz); f.gp = -Math.atan2(gnd(fx, fz + 0.12 * s) - gnd(fx, fz - 0.12 * s), 0.24 * s);
      }
      // reach clamp: never ask a leg for more than its length
      for (const [sd, f] of [['L', fL], ['R', fR]]) {
        const hip = B['thigh' + sd].userData.rest.clone().applyQuaternion(B.pelvis.quaternion).add(B.pelvis.position);
        const r = (sd === 'L' ? rest.lL : rest.lR), Lmax = (r.L1 + r.L2) * 0.992;
        const dx = hip.x - (B['foot' + sd].userData.bind.x), dz = hip.z - f.a.z;
        const yMax = f.a.y + f.gy + Math.sqrt(Math.max(0, Lmax * Lmax - dx * dx - dz * dz));
        if (hip.y > yMax) B.pelvis.position.y -= hip.y - yMax;
      }
      B.root.updateMatrixWorld(true);
      const rq = B.root.getWorldQuaternion(new THREE.Quaternion());
      for (const [sd, side, f] of [['L', 1, fL], ['R', -1, fR]]) {
        const T = B.root.localToWorld(V3(B['foot' + sd].userData.bind.x, f.a.y + f.gy, f.a.z));
        const pole = V3(side * 0.12, 0, 1).applyQuaternion(rq);
        twoBone(B['thigh' + sd], B['shin' + sd], (side > 0 ? rest.lL : rest.lR).L1, (side > 0 ? rest.lL : rest.lR).L2, T, pole, side > 0 ? rest.lL : rest.lR);
        const qf = rq.clone().multiply(_q.setFromAxisAngle(V3(1, 0, 0), f.pitch + f.gp)).multiply(_q2.setFromAxisAngle(V3(0, 1, 0), side * 0.05));
        setWorldRot(B['foot' + sd], qf); B['toe' + sd].rotation.x = clamp(f.toe, -0.9, 0);
      }
      // arm swing (only arms that are not held by IK)
      // fix: each arm swings forward with the OPPOSITE leg (it went with the same leg); the forward arm bends more
      const sw = p.armSwing ?? [1, 1];
      if (p.armDrive) {
        // sprint: arms pumped by the gait phase, hand from the chin (forward) to behind the hip (back), elbows ~90-110°
        const A = p.armDrive.a ?? 0.8, E = p.armDrive.e ?? 0.3;
        B.armL.rotation.x -= aDrive * A * k; B.armR.rotation.x += aDrive * A * k;
        B.foreL.rotation.x -= aDrive * E * k; B.foreR.rotation.x += aDrive * E * k;
      } else {
        B.armL.rotation.x -= swing * 0.34 * k * sw[0]; B.armR.rotation.x += swing * 0.34 * k * sw[1];
        B.foreL.rotation.x -= Math.max(0, swing) * 0.25 * k * sw[0]; B.foreR.rotation.x -= Math.max(0, -swing) * 0.25 * k * sw[1];
      }
      B.root.updateMatrixWorld(true);
    } else if (p.plant !== false) {
      B.pelvis.position.y -= soleMinY();
      B.root.updateMatrixWorld(true);
    }
    // props (weapon, case) and IK hands
    let tgt = {};
    for (const k of Object.keys(props)) { const r = props[k](p, api); if (r) Object.assign(tgt, r); }
    for (const h of held) { h.place && h.place(p, api); if (h.l) tgt.l = h.l; if (h.r) tgt.r = h.r; }
    B.root.updateMatrixWorld(true);
    const lSpec = p.lHand || tgt.l, rSpec = p.rHand || tgt.r;
    if (lSpec) handIK(1, lSpec);
    if (rSpec) handIK(-1, rSpec);
    B.root.updateMatrixWorld(true);
    for (const k of Object.keys(props)) if (props[k].after) props[k].after(p, api);
    // paper anchor: between the hands, facing the eyes
    // the sheet sits between the thumb pads (thumbs on its printed face, fingers behind), facing the eyes
    const pinch = (sd) => B[`t${sd}2`].localToWorld(V3().copy(B[`t${sd}tip`].position).multiplyScalar(0.55)).add(B[`f${sd}01`].localToWorld(V3(0, -0.013, 0))).multiplyScalar(0.5);
    const tl = pinch('L'), tr = pinch('R'), eye = A.head.getWorldPosition(V3());
    const tlL = B.root.worldToLocal(tl.clone()), trL = B.root.worldToLocal(tr.clone()), mid = tlL.clone().add(trL).multiplyScalar(0.5), eyeL = B.root.worldToLocal(eye.clone());
    const zA = eyeL.clone().sub(mid).normalize(), xA = tlL.clone().sub(trL).normalize().negate();
    const yA = zA.clone().cross(xA).normalize(); xA.copy(yA.clone().cross(zA)).normalize();
    A.paper.position.copy(mid).addScaledVector(yA, 0.05 * s).addScaledVector(zA, -0.006 * s); A.paper.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
    A.paper.userData.width = tlL.distanceTo(trL) + 0.035 * s;
    A.paper.updateMatrixWorld(true);
  }
  api.pose = (p = {}) => { base = { ...DEF, ...p }; apply(base, null); return api; };
  api.walk = (ph, k = 1) => { apply(base, { ph, k: clamp(k, 0, 1.2) }); return api; };
  api.gait = G;
  api.getPose = () => base;
  api._apply = apply;
  // heel and ball contact points of both feet, world space: [[heelL, ballL], [heelR, ballR]] as [x, y, z] (the
  // locomotion QA probe and the crowd's stride measurement: a planted foot keeps its contact point still in the world)
  api.footContacts = () => ['L', 'R'].map((sd) => [V3(0, -ankleH, -heelB), V3(0, -ankleH, ballF * 0.9)].map((p) => { const w = B['foot' + sd].localToWorld(p); return [w.x, w.y, w.z]; }));
  return api;
}

// ── body and garments (reference units: a 1.76 m man; the kit scales everything to the figure) ─────────────────────
// ref(bone) = the bone's bind position in reference units
function refOf(rig) { const k = [rig.s * rig.sw, rig.s, rig.s]; return (b) => { const p = (b.isBone ? b : rig.B[b]).userData.bind; return V3(p.x / k[0], p.y / k[1], p.z / k[2]); }; }

// faceless egg head + neck. o.egg: the Witness's purer egg (no jaw)
function buildHead(kit, rig, key, o = {}) {
  const { B } = rig, egg = !!o.egg;
  const g = new THREE.SphereGeometry(1, dq(o.egg ? 48 : 30, 12), dq(o.egg ? 36 : 22, 9)), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const lo = sstep(0.05, -1, y);                                   // 0 above the ears, 1 at the chin
    const kx = 1 - (egg ? 0.2 : 0.27) * lo - (egg ? 0 : 0.05 * sstep(0.3, 1, y));
    let kz = 1 - 0.08 * sstep(0.2, -1, y) * (z < 0 ? 1.6 : 0.4);
    if (z > 0 && y < -0.35 && !egg) kz *= 1 + 0.06 * sstep(-0.35, -0.8, y);  // chin forward
    if (z < 0 && y > -0.1 && y < 0.6) kz *= 1 + 0.05 * Math.sin((y + 0.1) / 0.7 * Math.PI);  // occiput
    if (z > 0.55) z = 0.55 + (z - 0.55) * 0.8;                        // the face plane
    const hs = o.scale ?? 1; p.setXYZ(i, x * 0.075 * kx * hs, y * (egg ? 0.121 : 0.116) * hs + 1.667 - (1 - hs) * 0.09, z * 0.098 * kz * hs + 0.014);
  }
  g.computeVertexNormals();
  kit.add(key, g, B.head);
  const nk = tube(path([[0, 1.455, -0.04], [0, 1.53, -0.03], [0, 1.6, -0.012], [0, 1.64, 0.0]], 8), (t) => lerp(0.058, 0.047, sstep(0, 0.6, t)) * (o.neckR ?? 1), 16);
  kit.add(key, nk, (x, y) => (y < 1.5 ? blend2(B.chest, B.neck, sstep(1.46, 1.52, y)) : blend2(B.neck, B.head, sstep(1.56, 1.6, y))));
}

// hands: palm + three-phalanx fingers + thumb, each phalanx rigid on its bone. o.glove: thicker; o.cuff: 'knit'|'gauntlet'
function buildHands(kit, rig, key, o = {}) {
  const { B } = rig, ref = refOf(rig), g0 = o.glove ? 0.0022 : 0;
  for (const [sd, side] of [['L', 1], ['R', -1]]) {
    const W = ref('hand' + sd);
    const rows = [[0.014, 0.022, 0.029, -0.004], [-0.02, 0.0195, 0.037, 0.0], [-0.05, 0.0172, 0.0425, 0.001], [-0.078, 0.0158, 0.0445, 0.001], [-0.094, 0.0142, 0.0415, 0.0], [-0.104, 0.0105, 0.034, 0.0]];
    const R = rows.map(([dy, ht, hw, zc]) => {
      const row = [];
      const HS = dq(18, 8);
      for (let j = 0; j < HS; j++) {
        const a = j / HS * TAU, c = Math.cos(a), sn = Math.sin(a);
        const back = c > 0 ? 1.12 : 0.92;                              // +c = back of the hand (lateral)
        let px = c * (ht + g0) * back, pz = sn * (hw + g0);
        if (c < 0 && sn > 0.2 && dy < -0.015 && dy > -0.07) px -= 0.005 * sn;      // thenar pad
        row.push(V3(W.x + px * side, W.y + dy, W.z + zc + pz));
      }
      return row;
    });
    kit.add(key, loft(R, { capStart: true, capEnd: true, flip: side < 0 }), B['hand' + sd]);
    FING.forEach(([, , L, r], f) => {
      for (let k = 0; k < 3; k++) {
        const b = B[`f${sd}${f}${k}`], a = ref(b), e = ref(k < 2 ? B[`f${sd}${f}${k + 1}`] : B[`f${sd}${f}tip`]);
        const rr = r * (1 - k * 0.09) + g0, len = a.distanceTo(e);
        const cg = new THREE.CapsuleGeometry(rr, Math.max(0.001, len - rr * 0.4), DETAIL < 0.7 ? 1 : 2, dq(8, 5));
        cg.scale(1, 1, 0.93); cg.translate(0, -len / 2 + rr * 0.1, 0); cg.translate(a.x, a.y, a.z);
        kit.add(key, cg, b);
      }
    });
    for (let k = 0; k < 3; k++) {
      const b = B[`t${sd}${k}`], a = ref(b), e = ref(k < 2 ? B[`t${sd}${k + 1}`] : B[`t${sd}tip`]);
      const rr = [0.0125, 0.0105, 0.0095][k] + g0;
      kit.add(key, rod(a, e, rr, rr * 0.92, 8, true), b);
      kit.add(key, sphereG(rr * (k === 2 ? 1 : 0.98), e.x, e.y, e.z, 1, 1, 1, 8, 6), b);
    }
    if (o.cuff === 'knit') {
      const c = tube(path([[W.x, W.y - 0.01, W.z], [W.x, W.y + 0.03, W.z - 0.003], [W.x - side * 0.002, W.y + 0.075, W.z - 0.008]], 5), (t) => lerp(0.031, 0.037, t), 16);
      kit.add(o.cuffKey || key, c, (x, y) => blend2(B['hand' + sd], B['fore' + sd], sstep(W.y - 0.005, W.y + 0.04, y)));
    } else if (o.cuff === 'gauntlet') {
      const c = tube(path([[W.x, W.y - 0.015, W.z], [W.x, W.y + 0.03, W.z - 0.004], [W.x, W.y + 0.07, W.z - 0.01]], 5), (t) => lerp(0.03, 0.045, t * t), 16);
      kit.add(o.cuffKey || key, c, (x, y) => blend2(B['hand' + sd], B['fore' + sd], sstep(W.y, W.y + 0.05, y)));
    }
  }
}

// torso garment: closed rings from the collar to the waist/hem. rows [[y, rx, zf, zb, cz]...] top -> bottom.
// o.edge: angle of the double-breasted overlap edge (a raised panel step), o.e: superellipse exponent
function ringPt(y, rx, zf, zb, cz, a, e = 2.3) {
  const c = Math.cos(a), sn = Math.sin(a);
  const px = Math.sign(c) * Math.abs(c) ** (2 / e) * rx, pz = Math.sign(sn) * Math.abs(sn) ** (2 / e) * (sn > 0 ? zf : zb);
  return V3(px, y, cz + pz);
}
function rowAt(rows, y) {                           // interpolate a profile table (top -> bottom) at height y
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (y <= a[0] && y >= b[0]) { const t = (a[0] - y) / (a[0] - b[0]); return a.map((v, k) => lerp(v, b[k], t)); }
  }
  return y > rows[0][0] ? rows[0] : rows[rows.length - 1];
}
function torsoWeights(B) {
  return (x, y, z) => {
    const t1 = sstep(0.98, 1.1, y), t2 = sstep(1.14, 1.3, y);
    let pel = 1 - t1, spi = t1 * (1 - t2), che = t1 * t2;
    const cl = sstep(0.11, 0.19, Math.abs(x)) * sstep(1.3, 1.42, y) * 0.75;
    const nk = sstep(1.48, 1.56, y) * 0.5;
    const L = [[B.pelvis, pel], [B.spine, spi], [B.chest, che * (1 - cl) * (1 - nk)], [x > 0 ? B.clavL : B.clavR, che * cl], [B.neck, che * nk * (1 - cl)]];
    return L;
  };
}
function buildTorso(kit, rig, key, o) {
  const { B } = rig, e = o.e ?? 2.3, m = dq(o.m ?? 48, 12);
  const ys = [], n = dq(o.n ?? 22, 8);
  for (let i = 0; i < n; i++) ys.push(lerp(o.rows[0][0], o.rows[o.rows.length - 1][0], i / (n - 1)));
  const edge = o.edge;                                 // [angle, raise]
  const rows = ys.map((y) => {
    const [, rx, zf, zb, cz] = rowAt(o.rows, y), row = [];
    for (let j = 0; j < m; j++) {
      const a = j / m * TAU; const p = ringPt(y, rx, zf, zb, cz, a, e);
      if (edge && y < edge[2] && y > edge[3]) {         // the over-panel stands a few mm proud of the under-panel
        const d = a - Math.PI / 2; const k = sstep(edge[0] + 0.03, edge[0] - 0.03, d) * sstep(-1.8, -1.2, d) * edge[1];
        p.x *= 1 + k; p.z = cz + (p.z - cz) * (1 + k);
      }
      if (o.bulge) o.bulge(p, a, y);
      row.push(p);
    }
    return row;
  });
  kit.add(key, loft(rows, { closed: true, capStart: !!o.capTop, capEnd: !!o.capEnd }), torsoWeights(B));
  return { at: (y, a, off = 0) => { const [, rx, zf, zb, cz] = rowAt(o.rows, y); const p = ringPt(y, rx + off, zf + off, zb + off, cz, a, e); return p; } };
}
// coat skirt: the ring overlaps at the front (ov rad). The wearer's left panel lies over the right one; each panel is
// skinned to its own thigh, so the skirt parts over a striding leg. shinK: how much the hem follows the shins.
function buildSkirt(kit, rig, key, o) {
  const { B } = rig, e = o.e ?? 2.2, m = dq(o.m ?? 56, 14), ov = o.ov ?? 0.4, n = dq(o.n ?? 17, 6);
  const top = o.rows[0][0], hem = o.rows[o.rows.length - 1][0];
  const a0 = Math.PI / 2 - ov, a1 = Math.PI / 2 + TAU + ov;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const y = lerp(top, hem, i / (n - 1)), [, rx, zf, zb, cz] = rowAt(o.rows, y), row = [];
    for (let j = 0; j < m; j++) {
      const a = lerp(a0, a1, j / (m - 1));
      const over = sstep(a1 - ov * 2 - 0.25, a1 - ov * 2 + 0.05, a) * 0.02, under = sstep(a0 + ov * 2 + 0.1, a0, a) * -0.012;
      const flare = 1 + over + under + (o.fold ? o.fold(a, y) : 0);
      const p = ringPt(y, rx * flare, zf * flare, zb * flare, cz, a, e);
      row.push(p);
    }
    rows.push(row);
  }
  // hem: fold the cloth back inside (thickness)
  const last = rows[rows.length - 1];
  rows.push(last.map((p) => { const q = p.clone(); q.x *= 0.975; q.z = (q.z - o.rows[o.rows.length - 1][4]) * 0.975 + o.rows[o.rows.length - 1][4]; return q; }));
  rows.push(last.map((p) => { const q = p.clone(); q.x *= 0.965; q.z = (q.z - o.rows[o.rows.length - 1][4]) * 0.965 + o.rows[o.rows.length - 1][4]; q.y += 0.06; return q; }));
  const g = loft(rows, { closed: false });
  // weights need the unwrapped angle: rebuild from the column index
  const cols = m, shinK = o.shinK ?? 0.4, knee = o.knee ?? 0.52;
  const wl = (a) => sstep(Math.PI * 1.5 - 0.7, Math.PI * 1.5 + 0.7, a);
  const P = g.attributes.position, N = P.count;
  const aOf = new Float32Array(N); for (let i = 0; i < N; i++) aOf[i] = lerp(a0, a1, (i % cols) / (cols - 1));
  kit.add(key, g, (x, y, z, i) => {
    const v = sstep(top - 0.02, top - 0.22, y) * (o.legK ?? 1), l = wl(aOf[i]), sh = sstep(knee, knee - 0.14, y) * shinK;
    return [[B.pelvis, 1 - v], [B.thighL, v * l * (1 - sh)], [B.thighR, v * (1 - l) * (1 - sh)], [B.shinL, v * l * sh], [B.shinR, v * (1 - l) * sh]];
  });
  return { at: (y, a, off = 0) => { const [, rx, zf, zb, cz] = rowAt(o.rows, y); return ringPt(y, rx + off, zf + off, zb + off, cz, a, e); } };
}
// sleeves: shoulder cap (rigid on the upper arm), elbow ball (forearm), tube bending at the elbow.
// o.r = [top, elbow, cuff], o.ext: length past the wrist, o.turn: turn-back cuff [height, extra radius]
function buildSleeves(kit, rig, key, o) {
  const { B } = rig, ref = refOf(rig);
  for (const [sd, side] of [['L', 1], ['R', -1]]) {
    const S = ref('arm' + sd), E = ref('fore' + sd), Wr = ref('hand' + sd);
    const dir = Wr.clone().sub(E).normalize(), end = Wr.clone().addScaledVector(dir, o.ext ?? 0.012);
    const pts = [S.clone().add(V3(0, -0.006, 0)), S.clone().lerp(E, 0.5), E.clone().add(V3(0, 0.03, 0)), E, E.clone().add(V3(0, -0.03, 0)), E.clone().lerp(end, 0.55), end];
    const pp = path(pts, 22), L1 = S.distanceTo(E), Lt = L1 + E.distanceTo(end), te = L1 / Lt;
    const [r0, r1, r2] = o.r;
    const rad = (t) => (t < te ? lerp(r0, r1, sstep(0, te, t)) : lerp(r1, r2, sstep(te, 1, t))) * (1 + (o.wrinkle ?? 0.03) * Math.sin(t * 37 + side)) * (0.8 + 0.2 * sstep(0, 0.09, t));
    const sl = tube(pp, (t, a) => { const r = rad(t); return [r * (1 + 0.04 * Math.cos(a * 2)), r]; }, 14, { up: V3(side, 0, 0) });
    kit.add(key, sl, (x, y, z) => {
      const t = clamp((S.y - y) / (S.y - end.y));
      return blend2(B['arm' + sd], B['fore' + sd], sstep(te - 0.06, te + 0.07, t));
    });
    kit.add(key, sphereG(r0 * (o.cap ?? 0.92), S.x, S.y - 0.008, S.z, 0.96, 0.7, 1.0, 16, 10), B['arm' + sd]);
    kit.add(key, sphereG(r1 * 0.84, E.x, E.y, E.z - 0.004, 1, 1, 1, 10, 8), B['fore' + sd]);
    if (o.turn) {
      const [hh, dr] = o.turn;
      const c = tube(path([end.clone().addScaledVector(dir, -hh), end.clone().addScaledVector(dir, 0.004)], 3), r2 + dr, 14, { up: V3(side, 0, 0) });
      kit.add(o.turnKey || key, c, B['fore' + sd]);
    }
  }
}
// legs: pelvis block, hip caps, thigh+shin tubes (bending at the knee), knee balls; o.r = [thigh, knee, calf, end],
// o.end: y where the trouser leg ends; o.blouse: [height, extra radius] ballooning over the boot top
function buildLegs(kit, rig, key, o) {
  const { B } = rig, ref = refOf(rig);
  kit.add(key, sphereG(1, 0, 0.925, -0.012, o.pelvis?.[0] ?? 0.168, o.pelvis?.[1] ?? 0.125, o.pelvis?.[2] ?? 0.13, 22, 14), B.pelvis);
  for (const [sd, side] of [['L', 1], ['R', -1]]) {
    const H = ref('thigh' + sd), K = ref('shin' + sd), A = ref('foot' + sd);
    const endY = o.end, tEnd = (K.y - endY) / (K.y - A.y);
    const end = K.clone().lerp(A, tEnd);
    const pp = path([H.clone().add(V3(0, 0.02, 0)), H.clone().lerp(K, 0.5), K.clone().add(V3(0, 0.03, 0)), K, K.clone().lerp(end, 0.5), end], 22);
    const L1 = H.distanceTo(K) + 0.02, Lt = L1 + K.distanceTo(end), tk = L1 / Lt;
    const [r0, r1, r2, r3] = o.r, bl = o.blouse;
    const rad = (t, a) => {
      let r = t < tk ? lerp(r0, r1, sstep(0, tk, t) ** 0.8) : t < tk + (1 - tk) * 0.45 ? lerp(r1, r2, sstep(tk, tk + (1 - tk) * 0.45, t)) : lerp(r2, r3, sstep(tk + (1 - tk) * 0.45, 1, t));
      if (o.muscle) { const sh = (t - tk) / (1 - tk); if (sh > 0) r *= 1 + 0.13 * Math.exp(-((sh - 0.3) ** 2) / 0.02) * (0.6 + 0.4 * Math.max(0, -Math.sin(a))); else r *= 1 + 0.04 * Math.exp(-((t / tk - 0.35) ** 2) / 0.05); }
      if (bl) { const yy = lerp(H.y + 0.02, endY, t); const k = sstep(endY + bl[0] + 0.05, endY + bl[0] * 0.4, yy) * sstep(endY - 0.01, endY + 0.025, yy); r += bl[1] * k * (1 + 0.35 * Math.sin(a * 5 + t * 40)); }
      return r;
    };
    const lg = tube(pp, (t, a) => { const r = rad(t, a); return [r, r * 1.02]; }, 16, { up: V3(1, 0, 0) });
    kit.add(key, lg, (x, y) => {
      const t = clamp((H.y + 0.02 - y) / (H.y + 0.02 - endY));
      return blend2(B['thigh' + sd], B['shin' + sd], sstep(tk - 0.05, tk + 0.06, t));
    });
    kit.add(key, sphereG(r0 * (o.hipCap ?? 1.02), H.x, H.y + 0.01, H.z - 0.005, 1.02, 1.0, 1.05, 16, 10), B['thigh' + sd]);
    kit.add(key, sphereG(r1 * 0.8, K.x, K.y, K.z - 0.006, 1, 1, 1.0, 10, 8), B['shin' + sd]);
  }
}

// boots. kind: 'buckle' (US M1943 double-buckle combat boot), 'jump' (Corcoran jump boot), 'riding' (officer's tall
// high-gloss boot), 'marching' (German enlisted Marschstiefel), 'overshoe' (US arctic overshoe), 'burlap' (feet wrapped
// in sacking), 'bare' (the Witness's smooth mannequin foot). keys: {upper, sole, metal, extra}
function footW(z) { if (z <= FOOT[0][0]) return FOOT[0][1]; for (let i = 0; i < FOOT.length - 1; i++) if (z <= FOOT[i + 1][0]) return lerp(FOOT[i][1], FOOT[i + 1][1], (z - FOOT[i][0]) / (FOOT[i + 1][0] - FOOT[i][0])); return FOOT[FOOT.length - 1][1]; }
const FOOT = [[-0.118, 0.018, 0.05], [-0.11, 0.032, 0.083], [-0.095, 0.04, 0.108], [-0.068, 0.045, 0.128], [-0.03, 0.047, 0.136], [0.02, 0.048, 0.122], [0.065, 0.05, 0.097], [0.105, 0.052, 0.078], [0.14, 0.051, 0.068], [0.172, 0.048, 0.062], [0.192, 0.043, 0.057], [0.206, 0.035, 0.051], [0.215, 0.022, 0.044], [0.219, 0.008, 0.037]];
function buildBoots(kit, rig, keys, kind, o = {}) {
  const { B } = rig, ref = refOf(rig), r = rng(o.seed ?? 5);
  const bare = kind === 'bare' || kind === 'sandal', bulk = kind === 'overshoe' ? 0.012 : kind === 'moon' ? 0.026 : kind === 'burlap' ? 0.02 : kind === 'sneaker' ? 0.006 : bare ? -0.006 : 0;
  const top = { buckle: 0.25, jump: 0.265, riding: 0.455, marching: 0.37, overshoe: 0.2, burlap: 0.22, bare: 0.09, sandal: 0.09, shoe: 0.118, sneaker: 0.12, sabaton: 0.3, moon: 0.27, gaiter: 0.36 }[kind] ?? 0.2;
  for (const [sd, side] of [['L', 1], ['R', -1]]) {
    const A = ref('foot' + sd), xc = A.x, T = ref('toe' + sd);
    const sole = kind === 'bare' ? 0.0 : kind === 'sandal' ? 0.012 : kind === 'sneaker' ? 0.026 : kind === 'moon' ? 0.034 : 0.016;
    // the foot: rings along z from the heel to the toe; flat bottom meeting the welt, straight sides, rounded top.
    // boots stand on a heel stack: the upper's floor rises by `lift(z)` over the heel
    const lift = (z) => (bare ? 0 : (kind === 'riding' ? 0.014 : 0.009) * sstep(-0.03, -0.06, z));
    const rows = FOOT.map(([z, w, t]) => {
      const row = [], wz = w + bulk, bb = sole + 0.001 + lift(z), tt = t + bulk * 0.8 + (bare ? -0.01 : 0) + lift(z) * 0.3, hb = (tt - bb) * 0.38;
      const FS = dq(16, 8);
      for (let j = 0; j < FS; j++) {
        const a = j / FS * TAU, c = Math.cos(a), sn = Math.sin(a);
        let px, py;
        if (sn < 0) { px = Math.sign(c) * Math.abs(c) ** 0.2 * wz; py = bb + hb * (1 - Math.abs(sn) ** 0.2); }
        else { px = c * wz * 0.985; py = bb + hb + Math.abs(sn) ** 0.85 * (tt - bb - hb); }
        let noise = 0; if (kind === 'burlap') noise = (r() - 0.5) * 0.008;
        row.push(V3(xc + px + noise * c + side * 0.004 * sstep(0.05, 0.2, z), py + noise * 0.5, z));
      }
      return row;
    });
    const fw = (x, y, z) => blend2(B['foot' + sd], B['toe' + sd], sstep(T.z - 0.03, T.z + 0.015, z));
    kit.add(keys.upper, loft(rows, { capStart: true, capEnd: true }), (x, y, z) => (y > 0.1 ? blend2(B['foot' + sd], B['shin' + sd], sstep(0.1, 0.16, y)) : fw(x, y, z)));
    if (kind !== 'bare') {       // sole with the heel stack, a few mm proud of the upper (the welt)
      const srows = [];
      for (const [k, grow] of [[0, 0.003], [1, 0.0042]]) {
        const row = [];
        for (let j = 0; j < 28; j++) {
          const u = j / 28, zz = lerp(FOOT[0][0] - 0.002, FOOT[FOOT.length - 1][0] + 0.002, 0.5 - 0.5 * Math.cos(u * TAU)), sgn = u < 0.5 ? 1 : -1;
          row.push(V3(xc + sgn * (footW(zz) + bulk + grow), k ? sole + lift(zz) : 0.002, zz));
        }
        srows.push(row);
      }
      kit.add(keys.sole, loft(srows, { capStart: true, capEnd: true, flip: true }), fw);
    }
    // the shaft
    if (kind === 'sandal') {                              // thongs over the instep and round the ankle
      for (const [zz, yy, rr] of [[0.06, 0.035, 0.05], [-0.02, 0.06, 0.052], [-0.07, 0.1, 0.05]]) {
        const tw = new THREE.TorusGeometry(rr, 0.0045, 4, 20); tw.rotateX(Math.PI / 2); tw.scale(1, 1, 1.25); tw.translate(xc, yy, A.z + zz);
        kit.add(keys.sole, tw, (x, y2, z2) => fw(x, y2, z2));
      }
    }
    if (!bare) {
      const sr = { buckle: [0.052, 0.05, 0.053], jump: [0.05, 0.049, 0.052], riding: [0.049, 0.057, 0.062], marching: [0.054, 0.062, 0.068], overshoe: [0.062, 0.064, 0.068], burlap: [0.064, 0.07, 0.066], shoe: [0.05, 0.047, 0.046], sneaker: [0.054, 0.05, 0.05], sabaton: [0.055, 0.06, 0.064], moon: [0.075, 0.078, 0.082], gaiter: [0.05, 0.054, 0.058] }[kind] ?? [0.052, 0.05, 0.053];
      const K = ref('shin' + sd);
      const pp = path([V3(xc, 0.075, A.z - 0.01), V3(xc, 0.14, A.z - 0.004), V3(lerp(xc, K.x, 0.5), top * 0.7 + 0.03, lerp(A.z, K.z, 0.4)), V3(lerp(xc, K.x, top / K.y), top, lerp(A.z, K.z, top / K.y))], 12);
      const shaft = tube(pp, (t, a) => {
        let rr = t < 0.3 ? lerp(sr[0], sr[1], t / 0.3) : lerp(sr[1], sr[2], (t - 0.3) / 0.7);
        if (kind === 'marching' || kind === 'riding') rr *= 1 + (kind === 'marching' ? 0.05 : 0.018) * Math.max(0, Math.sin(t * 60 + a * 0.5)) * sstep(0.45, 0.1, t);   // ankle creases
        if (kind === 'burlap') rr *= 1 + 0.08 * Math.sin(a * 3 + t * 25 + side) + 0.05 * Math.sin(a * 7 - t * 13);
        if (kind === 'riding' && Math.sin(a) > 0) rr *= 1 + 0.01 * t;   // front a little proud of the calf
        const fl = t < 0.22 ? (1 - t / 0.22) ** 2 : 0;
        return [rr * (1 + 0.06 * Math.cos(a) ** 2) * (1 - 0.04 * fl), rr * 1.08 * (1 + 0.22 * fl)];
      }, 16, { up: V3(1, 0, 0) });
      kit.add(keys.upper, shaft, (x, y) => blend2(B['foot' + sd], B['shin' + sd], sstep(0.09, 0.17, y)));
      // rim of the shaft (thickness)
      if (kind === 'riding' || kind === 'marching') { const rim = new THREE.TorusGeometry(sr[2] * 1.0, 0.0025, 4, 18); rim.rotateX(Math.PI / 2); rim.scale(1.06, 1, 1.08); rim.translate(pp[pp.length - 1].x, pp[pp.length - 1].y - 0.001, pp[pp.length - 1].z); kit.add(keys.upper, rim, B['shin' + sd]); }
      if (kind === 'buckle' || kind === 'overshoe') {       // straps and buckles
        const ys = kind === 'buckle' ? [0.16, 0.215] : [0.08, 0.115, 0.15, 0.185];
        for (const y of ys) {
          const rr = (kind === 'buckle' ? sr[2] : sr[1]) + 0.004;
          const bw = kind === 'buckle' ? 0.024 : 0.016, K2 = ref('shin' + sd), zc = lerp(A.z, K2.z, y / K2.y) - 0.003;
          const brow = (yy, off) => { const row = []; for (let j = 0; j < 20; j++) { const a = j / 20 * TAU; row.push(V3(xc + Math.cos(a) * (rr + off) * 1.06, yy, zc + Math.sin(a) * (rr + off) * 1.16)); } return row; };
          const st = loft([brow(y - bw / 2, 0.0), brow(y - bw / 2, 0.003), brow(y + bw / 2, 0.003), brow(y + bw / 2, 0.0)]);
          kit.add(kind === 'buckle' ? keys.upper : keys.extra ?? keys.upper, st, (x, yy) => blend2(B['foot' + sd], B['shin' + sd], sstep(0.09, 0.17, yy)));
          const bk = rbox(0.004, 0.022, 0.026, 0.002); bk.translate(xc + side * (rr + 0.006), y, A.z + 0.006);
          kit.add(keys.metal, bk, (x, yy) => blend2(B['foot' + sd], B['shin' + sd], sstep(0.09, 0.17, yy)));
        }
      }
      if (kind === 'jump') {                                 // lacing down the front
        for (let k = 0; k < 9; k++) {
          const y = 0.1 + k * 0.018, zf = A.z + sr[1] * 1.06 + 0.002;
          const lc = rod(V3(xc - 0.012, y, zf), V3(xc + 0.012, y + 0.006, zf), 0.0017, 0.0017, 5);
          kit.add(keys.sole, lc, (x, yy) => blend2(B['foot' + sd], B['shin' + sd], sstep(0.09, 0.17, yy)));
        }
      }
      if (kind === 'burlap') {                               // twine ties
        for (const y of [0.05, 0.13, 0.2]) {
          const tw = new THREE.TorusGeometry(y < 0.08 ? 0.056 : 0.074, 0.003, 4, 22); tw.rotateX(Math.PI / 2 + (r() - 0.5) * 0.3); tw.scale(1, 1, y < 0.08 ? 1.9 : 1.1);
          tw.translate(xc, y, A.z + (y < 0.08 ? 0.06 : 0));
          kit.add(keys.extra ?? keys.sole, tw, (x, yy, zz) => (yy < 0.08 ? fw(x, yy, zz) : blend2(B['foot' + sd], B['shin' + sd], sstep(0.09, 0.17, yy))));
        }
      }
    }
  }
  return top;
}

// small hard details, each weighted by the torso rule (or a given bone)
function button(kit, key, p, n, r, w) {
  const g = new THREE.CylinderGeometry(r, r * 1.05, r * 0.45, 12); g.rotateX(Math.PI / 2);
  const q = _q.setFromUnitVectors(V3(0, 0, 1), n.clone().normalize()); g.applyQuaternion(q);
  g.translate(p.x + n.x * r * 0.25, p.y + n.y * r * 0.25, p.z + n.z * r * 0.25);
  kit.add(key, g, w);
}
function surfNormal(at, y, a) { const p0 = at(y, a), p1 = at(y, a + 0.01), p2 = at(y - 0.01, a); return p1.sub(p0).cross(p2.sub(p0)).normalize().negate(); }
// a band round the waist (belts): rows following the garment surface at height y (+off)
function band(kit, key, at, y, h, off, w, o = {}) {
  const m = 48, rows = [];
  for (const [yy, oo] of [[y + h / 2, off * 0.7], [y + h / 2, off], [y - h / 2, off], [y - h / 2, off * 0.7]]) {
    const row = []; for (let j = 0; j < m; j++) row.push(at(yy, j / m * TAU, oo)); rows.push(row);
  }
  kit.add(key, loft(rows, { closed: true }), w);
}
// a strap laid over the body along points (suspenders, cross straps, slings): flat ribbon
function strap(kit, key, pts, wd, th, w, up) {
  const pp = path(pts, Math.max(8, pts.length * 3));
  kit.add(key, tube(pp, [th, wd / 2], 6, { up: up || V3(0, 0, 1) }), w);
}

// ── headgear (reference units; the skull: centre (0, 1.667, 0.014), half-width 0.075, crown 1.783) ─────────────────
function addBone(rig, name, parent, refPos) {
  const b = new THREE.Bone(); b.name = name;
  const w = V3(refPos.x * rig.s * rig.sw, refPos.y * rig.s, refPos.z * rig.s); b.userData.bind = w;
  b.position.copy(w).sub(parent.userData.bind); parent.add(b); rig.bones.push(b); rig.B[name] = b; return b;
}
// dome of an ellipsoid cut by a rim y(a), then a brim flare; returns rows for loft
function domeRows(C, R, rimY, flare, nv = 12, m = 48) {
  const rows = [];
  for (let i = 0; i <= nv; i++) {
    const row = [];
    for (let j = 0; j < m; j++) {
      const a = j / m * TAU, yr = rimY(a), cr = clamp((yr - C.y) / R.y, -0.99, 0.99), phR = Math.acos(cr);
      const ph = lerp(0.02, phR, (i / nv) ** 0.9);
      row.push(V3(Math.cos(a) * Math.sin(ph) * R.x + C.x, Math.cos(ph) * R.y + C.y, Math.sin(a) * Math.sin(ph) * R.z + C.z));
    }
    rows.push(row);
  }
  if (flare) for (const [k, dy] of flare) {
    rows.push(rows[nv].map((p, j) => { const a = j / m * TAU, d = k(a); const q = p.clone(); const rr = Math.hypot(q.x - C.x, q.z - C.z); q.x = C.x + (q.x - C.x) * (1 + d / rr); q.z = C.z + (q.z - C.z) * (1 + d / rr); q.y += dy(a); return q; }));
  }
  return rows;
}
// US M1 steel helmet: 11 x 9.5 x 7 in shell, short brim, crimped rim with the front seam, OD sand paint; loose chinstraps
function buildM1(kit, rig, keys, o = {}) {
  const { B } = rig, C = V3(0, 1.64, 0.012), R = V3(0.119, 0.172, 0.139);
  const rimY = (a) => 1.646 + 0.044 * Math.max(0, Math.sin(a)) ** 1.4 + 0.004 * Math.max(0, -Math.sin(a)) ** 3;
  const fl = (a) => 0.005 + 0.009 * Math.max(0, Math.sin(a)) ** 2 + 0.004 * Math.max(0, -Math.sin(a)) ** 2;
  const rows = domeRows(C, R, rimY, [[(a) => fl(a) * 0.55, () => -0.004], [fl, (a) => -0.007 + 0.002 * Math.max(0, Math.sin(a))]], dq(10, 5), dq(44, 14));
  kit.add(keys.shell, loft(rows), B.head);
  const rim = rows[rows.length - 1];
  kit.add(keys.rim, tube([...rim, rim[0]].map((p) => p.clone()), 0.0032, 5), B.head);
  // liner edge just inside the rim
  const inner = rows[rows.length - 3].map((p) => { const q = p.clone(); q.x = C.x + (q.x - C.x) * 0.955; q.z = C.z + (q.z - C.z) * 0.955; return q; });
  kit.add(keys.liner, loft([inner, inner.map((p) => p.clone().add(V3(0, 0.03, 0)))], { flip: true }), B.head);
  if (o.net) {
    const nrows = domeRows(C, V3(R.x + 0.005, R.y + 0.005, R.z + 0.005), (a) => rimY(a) - 0.004, [[(a) => fl(a) + 0.004, () => -0.006]], 9, 36);
    kit.add(keys.net, loft(nrows), B.head);
  }
  if (o.star) {                // Brig. Gen. McAuliffe: one white star painted on the front
    const sh = new THREE.Shape(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.0095 : 0.024, a = Math.PI / 2 + k * Math.PI / 5; if (k) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const sg = new THREE.ShapeGeometry(sh); const p = C.clone().add(V3(0, 0.07, R.z * 0.93));
    sg.applyQuaternion(_q.setFromUnitVectors(V3(0, 0, 1), V3(0, 0.45, 1).normalize())); sg.translate(p.x, p.y - 0.004, p.z + 0.0045);
    kit.add(keys.star, sg, B.head);
  }
  // chinstrap bails + loose straps on their own bones (update() hangs them)
  for (const [sd, side] of [['L', 1], ['R', -1]]) {
    const piv = V3(side * (R.x + 0.001), 1.652, 0.012);
    const b = addBone(rig, 'chin' + sd, B.head, piv);
    const bail = new THREE.TorusGeometry(0.008, 0.0016, 4, 10, Math.PI); bail.rotateY(Math.PI / 2); bail.rotateZ(Math.PI); bail.translate(piv.x + side * 0.002, piv.y, piv.z);
    kit.add(keys.rim, bail, B.head);
    const len = side > 0 ? 0.15 : 0.13;
    strap(kit, keys.strap, [piv.clone().add(V3(side * 0.004, 0, 0)), piv.clone().add(V3(side * 0.006, -len * 0.5, 0.004)), piv.clone().add(V3(side * 0.005, -len, 0.002))], 0.018, 0.0018, b, V3(1, 0, 0));
    const bk = rbox(0.006, 0.026, 0.022, 0.002); bk.translate(piv.x + side * 0.006, piv.y - len + 0.012, piv.z + 0.002);
    kit.add(keys.rim, bk, b);
  }
}
function eagle(w, d) {
  const e = new THREE.Shape(), h = w * 0.5;
  e.moveTo(0, h * 0.62); e.lineTo(w * 0.05, h * 0.45); e.lineTo(w * 0.5, h * 0.52); e.lineTo(w * 0.42, h * 0.3); e.lineTo(w * 0.47, h * 0.28); e.lineTo(w * 0.36, h * 0.1);
  e.lineTo(w * 0.09, h * 0.12); e.lineTo(w * 0.07, -h * 0.25); e.lineTo(w * 0.11, -h * 0.42); e.lineTo(0, -h * 0.34);
  e.lineTo(-w * 0.11, -h * 0.42); e.lineTo(-w * 0.07, -h * 0.25); e.lineTo(-w * 0.09, h * 0.12); e.lineTo(-w * 0.36, h * 0.1); e.lineTo(-w * 0.47, h * 0.28); e.lineTo(-w * 0.42, h * 0.3); e.lineTo(-w * 0.5, h * 0.52); e.lineTo(-w * 0.05, h * 0.45); e.lineTo(0, h * 0.62);
  return new THREE.ExtrudeGeometry(e, { depth: d, bevelEnabled: false });
}
// German officer's peaked cap (Schirmmütze): field-grey saddle crown, dark green band, black patent visor, silver cords
function buildSchirm(kit, rig, keys) {
  const { B } = rig, m = 48, cz = 0.014;
  const bandR = (a) => V3(Math.cos(a) * 0.084, 0, Math.sin(a) * 0.102 + cz);
  const y0 = (a) => 1.692 + 0.012 * Math.max(0, Math.sin(a)), y1 = (a) => y0(a) + 0.046;
  const ring = (fy, fr, k = 1) => { const row = []; for (let j = 0; j < m; j++) { const a = j / m * TAU, b = bandR(a); row.push(V3(b.x * k, fy(a), (b.z - cz) * k + cz)); } return row; };
  kit.add(keys.band, loft([ring(y0, 0, 1.0), ring(y1, 0, 1.0)], { flip: true }), B.head);
  // crown: from the band top out to the saddle edge (high front) and over a domed top
  const edgeY = (a) => 1.77 + 0.055 * Math.max(0, Math.sin(a)) ** 1.6 - 0.008 * Math.max(0, -Math.sin(a));
  const rows = [ring(y1, 0, 0.985), ring((a) => y1(a) + 0.012, 0, 1.12), ring((a) => edgeY(a) - 0.012, 0, 1.34), ring(edgeY, 0, 1.36)];
  for (const [k, dy] of [[1.26, 0.006], [1.0, 0.012], [0.6, 0.016], [0.2, 0.018], [0.02, 0.018]]) rows.push(ring((a) => lerp(edgeY(a), 1.795 + 0.03 * Math.max(0, Math.sin(a)), 1 - k / 1.36) + dy * 0.5, 0, k));
  kit.add(keys.cap, loft(rows, { capEnd: true, flip: true }), B.head);
  kit.add(keys.piping, tube([...rows[3], rows[3][0]].map((p) => p.clone()), 0.0022, 5), B.head);
  // visor: black patent, curving down
  const vr = [];
  for (let i = 0; i <= 5; i++) {
    const row = [], t = i / 5;
    for (let j = 0; j <= 20; j++) {
      const a = Math.PI / 2 + lerp(-1.2, 1.2, j / 20), b = bandR(a), out = t * (0.062 * Math.cos((a - Math.PI / 2) * 1.1) ** 1.5 + 0.004);
      const nx = Math.cos(a), nz = Math.sin(a);
      row.push(V3(b.x + nx * out, y0(a) + 0.002 - t * t * 0.022 - t * 0.012, b.z + nz * out));
    }
    vr.push(row);
  }
  const vg = loft(vr, { closed: false });
  kit.add(keys.visor, vg, B.head);
  kit.add(keys.visor, loft(vr.map((r) => r.map((p) => p.clone().add(V3(0, -0.003, 0)))), { closed: false, flip: true }), B.head);
  // chin cords + side buttons, cockade in its wreath, eagle
  for (const dy of [0.009, 0.016]) {
    const cp = []; for (let j = 0; j <= 18; j++) { const a = Math.PI / 2 + lerp(-1.3, 1.3, j / 18), b = bandR(a); cp.push(V3(b.x * 1.04, y0(a) + dy, (b.z - cz) * 1.04 + cz)); }
    kit.add(keys.silver, tube(cp, 0.0024, 5), B.head);
  }
  for (const side of [1, -1]) { const a = Math.PI / 2 - side * 1.3, b = bandR(a); button(kit, keys.silver, V3(b.x * 1.05, y0(a) + 0.012, (b.z - cz) * 1.05 + cz), V3(Math.cos(a), 0, Math.sin(a)), 0.0055, B.head); }
  const f = bandR(Math.PI / 2);
  button(kit, keys.silver, V3(0, 1.717, f.z + 0.004), V3(0, 0, 1), 0.0085, B.head);
  const wr = new THREE.TorusGeometry(0.015, 0.0028, 4, 16); wr.translate(0, 1.717, f.z + 0.004); kit.add(keys.silver, wr, B.head);
  const eg = eagle(0.056, 0.0018); eg.rotateX(-0.42); eg.translate(0, 1.787, 0.146); kit.add(keys.silver, eg, B.head);
}
// M43 field cap: tall crown, short cloth visor, flaps turned up round the sides with a V at the front and two buttons
function buildM43(kit, rig, keys) {
  const { B } = rig, m = 48, cz = 0.012;
  const ring = (y, rx, rz, fy) => { const row = []; for (let j = 0; j < m; j++) { const a = j / m * TAU; row.push(V3(Math.cos(a) * rx, y + (fy ? fy(a) : 0), Math.sin(a) * rz + cz)); } return row; };
  const rows = [ring(1.688, 0.083, 0.101, (a) => 0.01 * Math.max(0, Math.sin(a))), ring(1.735, 0.085, 0.105), ring(1.772, 0.083, 0.108, (a) => 0.004 * Math.max(0, Math.sin(a))), ring(1.79, 0.078, 0.106, (a) => 0.004 * Math.max(0, Math.sin(a))), ring(1.797, 0.066, 0.094), ring(1.801, 0.034, 0.048), ring(1.802, 0.004, 0.005)];
  kit.add(keys.cap, loft(rows, { flip: true }), B.head);
  // the turned-up flap: a band round the sides and back, dipping to a V at the front
  const fr = [];
  for (const k of [0, 1]) {
    const row = [];
    for (let j = 0; j <= 40; j++) {
      const a = Math.PI / 2 + 0.06 + j / 40 * (TAU - 0.12);
      const d = Math.abs(((a - Math.PI / 2 + Math.PI) % TAU) - Math.PI);
      const top = 1.748 - 0.036 * sstep(0.9, 0.05, d);
      const y = k === 0 ? 1.688 + 0.01 * Math.max(0, Math.sin(a)) - 0.003 : top;
      row.push(V3(Math.cos(a) * 0.0885, y, Math.sin(a) * 0.1065 + cz));
    }
    fr.push(row);
  }
  kit.add(keys.cap, loft(fr, { closed: false }), B.head);
  kit.add(keys.cap, loft(fr.map((r) => r.map((p) => V3(p.x * 0.97, p.y, (p.z - cz) * 0.97 + cz))), { closed: false, flip: true }), B.head);
  for (const dy of [0.0, 0.017]) button(kit, keys.metal, V3(0, 1.706 + dy, 0.101 + cz + 0.006), V3(0, 0, 1), 0.0055, B.head);
  const vr = [];
  for (let i = 0; i <= 4; i++) {
    const row = [], t = i / 4;
    for (let j = 0; j <= 16; j++) { const a = Math.PI / 2 + lerp(-1.05, 1.05, j / 16), out = t * 0.058 * Math.cos((a - Math.PI / 2) * 1.2) ** 1.2 + 0.002; row.push(V3(Math.cos(a) * (0.086 + out), 1.697 - t * 0.02 - t * t * 0.006, Math.sin(a) * (0.104 + out) + cz)); }
    vr.push(row);
  }
  kit.add(keys.cap, loft(vr, { closed: false }), B.head);
  kit.add(keys.cap, loft(vr.map((r) => r.map((p) => p.clone().add(V3(0, -0.004, 0)))), { closed: false, flip: true }), B.head);
  const tp = new THREE.Shape(); tp.moveTo(-0.024, 0.012); tp.lineTo(0.024, 0.012); tp.lineTo(0.012, -0.004); tp.lineTo(0.009, -0.026); tp.lineTo(-0.009, -0.026); tp.lineTo(-0.012, -0.004); tp.lineTo(-0.024, 0.012);
  const tg = new THREE.ExtrudeGeometry(tp, { depth: 0.0015, bevelEnabled: false }); tg.rotateX(-0.08); tg.translate(0, 1.762, 0.113 + cz); kit.add(keys.back ?? keys.cap, tg, B.head);
  const e2 = eagle(0.036, 0.0012); e2.rotateX(-0.08); e2.translate(0, 1.767, 0.1146 + cz); kit.add(keys.insig, e2, B.head);
  const ck = new THREE.CylinderGeometry(0.0055, 0.0055, 0.002, 12); ck.rotateX(Math.PI / 2); ck.translate(0, 1.746, 0.1152 + cz); kit.add(keys.insig, ck, B.head);
}
// M42 Stahlhelm: dome + the flared skirt over the ears and neck, raw edge, vent lugs; chinstrap under the chin
function buildM42(kit, rig, keys) {
  const { B } = rig, C = V3(0, 1.655, 0.006), R = V3(0.113, 0.158, 0.135), m = dq(56, 14);
  const shoulder = (a) => 1.668 + 0.03 * Math.max(0, Math.sin(a)) ** 2;
  const rimY = (a) => 1.588 + 0.117 * Math.max(0, Math.sin(a)) ** 2.4 + 0.008 * Math.max(0, -Math.sin(a));
  const flare = (a) => 0.018 + 0.03 * (1 - Math.max(0, Math.sin(a)) ** 2) + 0.012 * Math.max(0, -Math.sin(a));
  const rows = domeRows(C, R, shoulder, null, 11, m);
  const sh = rows[rows.length - 1];
  for (const t of [0.3, 0.65, 1]) rows.push(sh.map((p, j) => { const a = j / m * TAU, q = p.clone(), rr = Math.hypot(q.x - C.x, q.z - C.z), d = flare(a) * t ** 1.4; q.x = C.x + (q.x - C.x) * (1 + d / rr); q.z = C.z + (q.z - C.z) * (1 + d / rr); q.y = lerp(p.y, rimY(a), t); return q; }));
  kit.add(keys.shell, loft(rows), B.head);
  const last = rows[rows.length - 1];
  kit.add(keys.shell, loft([last, last.map((p) => V3(C.x + (p.x - C.x) * 0.975, p.y + 0.006, C.z + (p.z - C.z) * 0.975))]), B.head);
  for (const side of [1, -1]) kit.add(keys.shell, sphereG(0.0055, side * (R.x + 0.001), 1.705, 0.0, 0.6, 1, 1, 8, 6), B.head);
  const cs = path([[0.1, 1.63, 0.03], [0.065, 1.545, 0.07], [0, 1.528, 0.082], [-0.065, 1.545, 0.07], [-0.1, 1.63, 0.03]], 16);
  kit.add(keys.strap, tube(cs, [0.0016, 0.007], 5), B.head);
}

// ── web gear ──────────────────────────────────────────────────────────────────────────────────────────────────────
// on(at, y, a, off): a point on the garment surface + its outward normal
function on(at, y, a, off = 0) { const p = at(y, a, off), n = surfNormal(at, y, a); return { p, n }; }
function placeBox(kit, key, g, at, y, a, off, w, tilt = 0) {
  const { p, n } = on(at, y, a, off);
  const q = _q.setFromUnitVectors(V3(0, 0, 1), V3(n.x, 0, n.z).normalize());
  g.rotateX(tilt); g.applyQuaternion(q); g.translate(p.x, p.y, p.z); kit.add(key, g, w);
}
// US M1923 cartridge belt (ten pouches), M1936 suspenders, canteen, first-aid pouch
function buildGIKit(kit, rig, keys, at, o = {}) {
  const { B } = rig, tw = torsoWeights(B), y = o.beltY ?? 1.045;
  band(kit, keys.web, at, y, 0.058, 0.012, tw);
  const buckle = rbox(0.05, 0.045, 0.012, 0.003); placeBox(kit, keys.metal, buckle, at, y, Math.PI / 2, 0.02, tw);
  const n = o.bar ? 3 : 5, step = o.bar ? 0.5 : 0.29;
  for (const side of [1, -1]) for (let k = 0; k < n; k++) {
    const a = Math.PI / 2 - side * (0.3 + k * step);
    const pw = o.bar ? 0.1 : 0.066, pg = rbox(pw, 0.088, 0.036, 0.008); placeBox(kit, keys.web, pg, at, y - 0.012, a, 0.03, tw, -0.05);
    const fl = new THREE.BoxGeometry(pw + 0.004, 0.032, 0.012); placeBox(kit, keys.web, fl, at, y + 0.022, a, 0.046, tw, 0.15);
  }
  for (const side of [1, -1]) {           // suspenders: front, over the shoulder, crossing at the back
    const pts = [at(y + 0.03, Math.PI / 2 - side * 0.5, 0.017), at(1.22, Math.PI / 2 - side * 0.52, 0.012), at(1.36, Math.PI / 2 - side * 0.62, 0.012),
      V3(side * 0.12, 1.475, 0.0), at(1.38, Math.PI * 1.5 + side * 0.62, 0.012), at(1.22, Math.PI * 1.5 + side * 0.25, 0.012), at(y + 0.03, Math.PI * 1.5 - side * 0.22, 0.017)];
    strap(kit, keys.web, pts, 0.03, 0.0035, tw);
  }
  const fa = rbox(0.062, 0.082, 0.026, 0.008); placeBox(kit, keys.web, fa, at, 1.24, Math.PI / 2 - 0.52, 0.026, tw);
  const cn = new THREE.CylinderGeometry(0.068, 0.068, 0.07, 16); cn.rotateX(Math.PI / 2); cn.scale(1, 1.4, 1);
  placeBox(kit, keys.web, cn, at, y - 0.11, Math.PI + 0.75, 0.05, tw);
  const cc = rbox(0.1, 0.04, 0.074, 0.01); placeBox(kit, keys.web, cc, at, y - 0.02, Math.PI + 0.75, 0.05, tw);
}
// German enlisted belt kit: black belt, Y-straps, two triple ammunition pouches, bread bag
function buildGerKit(kit, rig, keys, at) {
  const { B } = rig, tw = torsoWeights(B), y = 1.05;
  band(kit, keys.belt, at, y, 0.045, 0.01, tw);
  placeBox(kit, keys.metal, rbox(0.055, 0.046, 0.01, 0.004), at, y, Math.PI / 2, 0.016, tw);
  for (const side of [1, -1]) {
    placeBox(kit, keys.belt, rbox(0.15, 0.08, 0.042, 0.008), at, y - 0.005, Math.PI / 2 - side * 0.52, 0.03, tw);
    placeBox(kit, keys.belt, rbox(0.155, 0.03, 0.05, 0.006), at, y + 0.03, Math.PI / 2 - side * 0.52, 0.03, tw, 0.2);
    strap(kit, keys.belt, [at(y + 0.03, Math.PI / 2 - side * 0.4, 0.035), at(1.25, Math.PI / 2 - side * 0.5, 0.012), at(1.38, Math.PI / 2 - side * 0.6, 0.012), V3(side * 0.11, 1.47, 0.0), at(1.36, Math.PI * 1.5 + side * 0.35, 0.012), at(1.28, Math.PI * 1.5 + side * 0.06, 0.012)], 0.026, 0.003, tw);
  }
  strap(kit, keys.belt, [at(1.28, Math.PI * 1.5, 0.012), at(1.15, Math.PI * 1.5, 0.012), at(y + 0.02, Math.PI * 1.5, 0.016)], 0.028, 0.003, tw);
  placeBox(kit, keys.bag, rbox(0.24, 0.19, 0.06, 0.02), at, y - 0.11, Math.PI + 0.45, 0.04, tw);
  placeBox(kit, keys.bag, rbox(0.25, 0.07, 0.07, 0.015), at, y - 0.03, Math.PI + 0.45, 0.045, tw, 0.2);
}
// German officer: brown belt with the two-claw buckle, P38 holster on the left front hip, silver shoulder boards
function buildOffKit(kit, rig, keys, at) {
  const { B } = rig, tw = torsoWeights(B), y = 1.055;
  band(kit, keys.belt, at, y, 0.05, 0.011, tw);
  placeBox(kit, keys.metal, rbox(0.058, 0.05, 0.008, 0.004), at, y, Math.PI / 2, 0.016, tw);
  placeBox(kit, keys.belt, rbox(0.075, 0.14, 0.038, 0.012), at, y - 0.08, Math.PI / 2 - 0.95, 0.025, tw, 0.15);
}

// ── weapons: authored with +Z to the muzzle, +Y up, origin at the right hand's grip; each is a prop bone ───────────
function stock(rows, m = 14, e = 3) {         // rows: [z, yBot, yTop, halfWidth]
  const R = rows.map(([z, yb, yt, hw]) => { const row = [], cy = (yb + yt) / 2, hy = (yt - yb) / 2; for (let j = 0; j < m; j++) { const a = j / m * TAU, c = Math.cos(a), s = Math.sin(a); row.push(V3(Math.sign(c) * Math.abs(c) ** (2 / e) * hw, cy + Math.sign(s) * Math.abs(s) ** (2 / e) * hy, z)); } return row; });
  return loft(R, { capStart: true, capEnd: true });
}
const WEAPON = {
  garand: {
    len: 1.107, butt: 0.305, grips: { r: V3(0, -0.012, 0.0), l: V3(0, -0.02, 0.35) }, swivel: [V3(0, -0.012, 0.63), V3(0, -0.092, -0.19)],
    build(add, K) {
      add(K.wood, stock([[-0.305, -0.115, 0.034, 0.021], [-0.29, -0.114, 0.036, 0.022], [-0.2, -0.092, 0.033, 0.021], [-0.12, -0.07, 0.028, 0.019], [-0.05, -0.047, 0.022, 0.0165], [0.0, -0.042, 0.02, 0.0165], [0.04, -0.044, 0.022, 0.018], [0.12, -0.04, 0.013, 0.02], [0.26, -0.034, 0.013, 0.019], [0.36, -0.029, 0.011, 0.017], [0.43, -0.025, 0.009, 0.015]]));
      add(K.wood, stock([[0.25, 0.012, 0.047, 0.018], [0.42, 0.012, 0.045, 0.017]], 12, 2.4));
      add(K.wood, stock([[0.45, 0.012, 0.044, 0.016], [0.63, 0.012, 0.042, 0.015]], 12, 2.4));
      add(K.steel, stock([[-0.005, 0.012, 0.05, 0.016], [0.24, 0.012, 0.05, 0.016]], 10, 4));
      add(K.steel, rbox(0.03, 0.022, 0.03, 0.004).translate(0, 0.06, 0.02));
      add(K.steel, rod(V3(0, 0.03, 0.24), V3(0, 0.03, 0.8), 0.0095, 0.0078, 10));
      add(K.steel, rod(V3(0, 0.027, 0.64), V3(0, 0.027, 0.79), 0.0125, 0.0125, 12));
      add(K.steel, rbox(0.004, 0.022, 0.008, 0.001).translate(0, 0.05, 0.785));
      add(K.steel, rbox(0.024, 0.012, 0.012, 0.002).translate(0, 0.043, 0.785));
      add(K.steel, rod(V3(-0.019, 0.02, 0.1), V3(-0.019, 0.02, 0.62), 0.0035, 0.0035, 6));
      add(K.steel, rbox(0.018, 0.012, 0.02, 0.003).translate(-0.024, 0.024, 0.125));
      const tg = new THREE.TorusGeometry(0.028, 0.004, 5, 14, Math.PI); tg.rotateY(Math.PI / 2); tg.rotateX(Math.PI); tg.translate(0, -0.042, 0.03); add(K.steel, tg);
      add(K.steel, rbox(0.046, 0.152, 0.008, 0.003).translate(0, -0.04, -0.304));
      add(K.steel, rod(V3(0, -0.005, 0.425), V3(0, -0.005, 0.44), 0.02, 0.02, 12));
    },
  },
  bar: {
    len: 1.214, butt: 0.42, grips: { r: V3(0, -0.02, 0.0), l: V3(0, -0.03, 0.36) }, swivel: [V3(0, -0.04, 0.5), V3(0, -0.12, -0.3)],
    build(add, K) {
      add(K.wood, stock([[-0.42, -0.135, 0.03, 0.022], [-0.4, -0.134, 0.032, 0.023], [-0.25, -0.1, 0.03, 0.021], [-0.12, -0.06, 0.03, 0.02], [-0.09, -0.05, 0.03, 0.02]]));
      add(K.wood, stock([[-0.035, -0.03, -0.01, 0.017], [-0.06, -0.13, -0.1, 0.016]], 12, 2.6));
      add(K.steel, stock([[-0.1, -0.038, 0.048, 0.026], [0.3, -0.038, 0.048, 0.026]], 10, 5));
      add(K.steel, stock([[0.05, -0.15, -0.03, 0.017], [0.12, -0.14, -0.03, 0.017]], 8, 5));
      add(K.wood, stock([[0.3, -0.05, 0.02, 0.025], [0.52, -0.042, 0.018, 0.023]], 12, 3));
      add(K.steel, rod(V3(0, 0.02, 0.28), V3(0, 0.02, 0.86), 0.012, 0.011, 12));
      add(K.steel, rod(V3(0, -0.015, 0.3), V3(0, -0.015, 0.63), 0.011, 0.011, 10));
      add(K.steel, rod(V3(0, 0.02, 0.84), V3(0, 0.02, 0.905), 0.0145, 0.0135, 12));
      add(K.steel, rbox(0.005, 0.024, 0.01, 0.001).translate(0, 0.043, 0.88));
      add(K.steel, rbox(0.03, 0.028, 0.05, 0.004).translate(0, 0.058, -0.06));
      for (const sx of [1, -1]) { add(K.steel, rod(V3(sx * 0.018, 0.0, 0.83), V3(sx * 0.045, -0.02, 0.45), 0.005, 0.0045, 6)); add(K.steel, rod(V3(sx * 0.045, -0.02, 0.45), V3(sx * 0.05, -0.024, 0.42), 0.004, 0.001, 6)); }
      add(K.steel, rod(V3(-0.02, 0.0, 0.83), V3(0.02, 0.0, 0.83), 0.008, 0.008, 8));
      const tg = new THREE.TorusGeometry(0.03, 0.004, 5, 14, Math.PI); tg.rotateY(Math.PI / 2); tg.rotateX(Math.PI); tg.translate(0, -0.04, 0.02); add(K.steel, tg);
    },
  },
  carbine: {
    len: 0.905, butt: 0.36, grips: { r: V3(0, -0.02, 0.0), l: V3(0, -0.018, 0.22) }, swivel: [V3(0, -0.03, 0.3), V3(0, -0.085, -0.3)],
    build(add, K) {
      add(K.wood, stock([[-0.03, -0.035, 0.018, 0.018], [0.3, -0.03, 0.016, 0.017], [0.35, -0.026, 0.014, 0.015]]));
      add(K.wood, stock([[-0.02, -0.03, -0.005, 0.015], [-0.05, -0.115, -0.09, 0.014]], 12, 2.6));
      add(K.steel, stock([[-0.02, 0.012, 0.038, 0.013], [0.15, 0.012, 0.036, 0.013]], 10, 4));
      add(K.wood, stock([[0.15, 0.012, 0.036, 0.014], [0.34, 0.012, 0.034, 0.013]], 12, 2.4));
      add(K.steel, rod(V3(0, 0.026, 0.15), V3(0, 0.026, 0.46), 0.0085, 0.0075, 10));
      add(K.steel, rod(V3(0, 0.01, 0.33), V3(0, 0.01, 0.36), 0.024, 0.024, 12));
      add(K.steel, rbox(0.018, 0.018, 0.01, 0.002).translate(0, 0.04, 0.455));
      add(K.steel, stock([[0.03, -0.1, -0.03, 0.012], [0.075, -0.1, -0.03, 0.012]], 8, 5));
      add(K.steel, rod(V3(0, 0.012, -0.03), V3(0, -0.002, -0.36), 0.0055, 0.0055, 6));
      add(K.steel, rod(V3(0, -0.085, -0.06), V3(0, -0.075, -0.34), 0.005, 0.005, 6));
      add(K.steel, rbox(0.03, 0.125, 0.01, 0.004).translate(0, -0.04, -0.36));
      add(K.strap, rbox(0.03, 0.035, 0.12, 0.008).translate(0, 0.005, -0.18));
      const tg = new THREE.TorusGeometry(0.022, 0.0035, 5, 12, Math.PI); tg.rotateY(Math.PI / 2); tg.rotateX(Math.PI); tg.translate(0, -0.035, 0.035); add(K.steel, tg);
    },
  },
};
// weapon + its sling (the sling bends on two prop bones: over the shoulder and in the hand when slung)
function buildWeapon(kit, rig, kind, keys) {
  const W = WEAPON[kind], wb = propBone(rig, 'weapon');
  W.build((key, g) => kit.add(key, g, wb), keys);
  const [F, R] = W.swivel, T0 = F.clone().lerp(R, 0.33).add(V3(0, -0.014, 0)), M0 = F.clone().lerp(R, 0.66).add(V3(0, -0.014, 0));
  const bt = propBone(rig, 'slingT'), bm = propBone(rig, 'slingM');
  bt.userData.bind = T0.clone(); bm.userData.bind = M0.clone(); bt.position.copy(T0); bm.position.copy(M0);
  const pts = path([F, T0, M0, R], 30);
  const g = tube(pts, [0.0022, 0.0155], 6, { up: V3(1, 0, 0) });
  const P = g.attributes.position;
  kit.add(keys.strap, g, (x, y, z, i) => {
    const u = clamp((F.z - z) / (F.z - R.z));
    if (u < 1 / 3) return [[wb, 1 - 3 * u], [bt, 3 * u]];
    if (u < 2 / 3) return [[bt, 2 - 3 * u], [bm, 3 * u - 1]];
    return [[bm, 3 - 3 * u], [wb, 3 * u - 2]];
  });
  return { W, wb, bt, bm, T0, M0 };
}
function setWorld(b, pos, quat) {           // place a bone at a world position/orientation
  b.parent.updateMatrixWorld(true);
  const inv = b.parent.matrixWorld.clone().invert();
  _m.compose(pos, quat, V3(1, 1, 1)); _m.premultiply(inv);
  _m.decompose(b.position, b.quaternion, _v3);
  b.updateMatrixWorld(true);
}
// carry modes, in chest space: weapon origin, Euler, and the hands' grip specs
const CARRY = {
  aim: { pocket: [-0.128, 0.13, 0.092], r: [0.02, 0.62, 0.0], r_: { fingers: [0.3, -0.9, 0.25], palm: [1, 0.1, 0] }, l_: { fingers: [1, 0.2, 0.25], palm: [0, 1, 0.1] } },
  port: { p: [-0.1, -0.13, 0.27], r: [-0.2, 0.25, 0.95], r_: { fingers: [0.2, -0.9, 0.3], palm: [1, 0, 0] }, l_: { fingers: [0.9, -0.1, 0.3], palm: [0, 1, 0] } },
  rest: { p: [-0.1, -0.1, 0.46], r: [0.12, 0.08, -0.15], r_: { fingers: [0.4, -0.85, 0.2], palm: [1, 0.2, 0] }, l_: { fingers: [0.95, 0.0, 0.2], palm: [0, 1, 0] } },
  sling: { p: [-0.205, -0.3, -0.115], r: [-Math.PI / 2 - 0.1, -0.14, 0.0] },
  parapet: { space: 'root', p: [-0.07, 1.17, 0.5], r: [0.02, 0.06, -0.12], r_: { fingers: [0.35, -0.85, 0.25], palm: [1, 0.15, 0] }, l_: { fingers: [0.95, 0.05, 0.2], palm: [0, 1, 0] } },
  low: { p: [-0.2, -0.36, 0.12], r: [0.55, 0.1, 0.1], r_: { fingers: [0.2, -0.9, 0.3], palm: [1, 0, 0] } },
};
function weaponPlacer(rig, WB) {
  const { B } = rig;
  const f = (p) => {
    const mode = p.weapon ?? 'sling', C = CARRY[mode] || CARRY.sling;
    const par = C.space === 'root' ? B.root : B.chest; par.updateMatrixWorld(true);
    const pl = C.pocket ? V3(...C.pocket).multiplyScalar(rig.s).add(V3(0, 0, WB.W.butt).applyEuler(new THREE.Euler(...C.r))) : V3(...C.p).multiplyScalar(C.space === 'root' ? 1 : rig.s);
    const pos = par.localToWorld(pl);
    const q = par.getWorldQuaternion(new THREE.Quaternion()).multiply(_q.setFromEuler(new THREE.Euler(...C.r)));
    setWorld(WB.wb, pos, q);
    const out = {};
    if (C.r_) out.r = { obj: WB.wb, p: WB.W.grips.r.toArray(), fingers: C.r_.fingers, palm: C.r_.palm, pole: [-0.6, -0.5, -0.6] };
    if (C.l_) out.l = { obj: WB.wb, p: WB.W.grips.l.toArray(), fingers: C.l_.fingers, palm: C.l_.palm, pole: [0.8, -0.7, -0.1] };
    if (mode === 'sling' && !p.rHand && !p.rFree) out.r = { space: 'chest', p: [-0.15, 0.04, 0.125], fingers: [0.15, -0.95, 0.1], palm: [0.6, 0, -0.8], pole: [-0.7, -0.6, -0.4] };
    return out;
  };
  f.after = (p) => {
    const mode = p.weapon ?? 'sling', q = new THREE.Quaternion();
    if (mode === 'sling') {
      setWorld(WB.bt, B.chest.localToWorld(V3(-0.155, 0.205, 0.0).multiplyScalar(rig.s)), q);
      setWorld(WB.bm, (p.rHand || p.rFree) ? B.chest.localToWorld(V3(-0.15, 0.0, 0.115).multiplyScalar(rig.s)) : rig.B.handR.localToWorld(V3(0.012, -0.075, 0.0)), q);
    } else {
      setWorld(WB.bt, WB.wb.localToWorld(WB.T0.clone()), WB.wb.getWorldQuaternion(q));
      setWorld(WB.bm, WB.wb.localToWorld(WB.M0.clone()), WB.wb.getWorldQuaternion(new THREE.Quaternion()));
    }
  };
  return f;
}
// brown leather briefcase carried under the left arm (Lt. Henke)
function buildCase(kit, rig, keys) {
  const cb = propBone(rig, 'case');
  kit.add(keys.case, rbox(0.058, 0.29, 0.41, 0.012), cb);
  kit.add(keys.case, rbox(0.064, 0.2, 0.414, 0.01).translate(0, 0.05, 0), cb);
  for (const z of [-0.11, 0.11]) {
    kit.add(keys.case, rbox(0.068, 0.13, 0.022, 0.003).translate(0, 0.01, z), cb);
    kit.add(keys.metal, rbox(0.072, 0.02, 0.026, 0.003).translate(0, -0.04, z), cb);
  }
  const h = new THREE.TorusGeometry(0.045, 0.008, 6, 14, Math.PI); h.scale(1, 0.6, 1); h.rotateY(Math.PI / 2); h.translate(0, 0.145, 0); kit.add(keys.case, h, cb);
  const f = (p) => {
    if (p.caseHold === false) { cb.visible = false; }
    rig.B.chest.updateMatrixWorld(true);
    const pos = rig.B.chest.localToWorld(V3(0.214, -0.215, 0.07).multiplyScalar(rig.s));
    const q = rig.B.chest.getWorldQuaternion(new THREE.Quaternion()).multiply(_q.setFromEuler(new THREE.Euler(-0.12, -0.06, 0.08)));
    setWorld(cb, pos, q);
    return { l: { obj: cb, p: [0.012, -0.135, 0.17], fingers: [-0.55, 0.15, 0.82], palm: [-0.35, 0.93, 0.1], pole: [1, -0.25, -0.6] } };
  };
  return f;
}

// ── collars and scarves ─────────────────────────────────────────────────────────────────────────────────────────────
// 'roll': US overcoat collar turned up against the cold; 'wide': German greatcoat collar lying over the shoulders;
// 'jacket': M1943 stand-and-fall collar over the wool shirt collar
function buildCollar(kit, rig, key, kind, key2) {
  const { B } = rig, m = 40, cz = -0.03;
  const w = (x, y) => (y > 1.53 ? [[B.chest, 0.55], [B.neck, 0.45]] : [[B.chest, 0.8], [B.neck, 0.2]]);
  const ringArc = (y, rx, rz, gap, lift = 0) => { const row = []; for (let j = 0; j <= m; j++) { const a = Math.PI / 2 + gap / 2 + j / m * (TAU - gap); const f = Math.max(0, Math.sin(a)); row.push(V3(Math.cos(a) * rx, y + lift * f, Math.sin(a) * rz + cz)); } return row; };
  if (kind === 'roll') {
    const rows = [ringArc(1.47, 0.1, 0.094, 1.3, -0.03), ringArc(1.505, 0.099, 0.097, 1.25, -0.035), ringArc(1.54, 0.101, 0.101, 1.2, -0.045), ringArc(1.55, 0.108, 0.108, 1.2, -0.048)];
    kit.add(key, loft(rows, { closed: false }), w);
    kit.add(key, loft(rows.map((r) => r.map((p) => V3(p.x * 0.93, p.y, (p.z - cz) * 0.93 + cz))), { closed: false, flip: true }), w);
  } else if (kind === 'wide') {
    const rows = [ringArc(1.5, 0.084, 0.078, 0.6), ringArc(1.565, 0.09, 0.086, 0.55), ringArc(1.552, 0.106, 0.104, 0.62), ringArc(1.5, 0.14, 0.13, 0.95, -0.03), ringArc(1.455, 0.178, 0.152, 1.3, -0.06), ringArc(1.43, 0.195, 0.16, 1.45, -0.075)];
    kit.add(key, loft(rows, { closed: false }), w);
    kit.add(key, loft(rows.slice(2).map((r) => r.map((p) => p.clone().add(V3(0, -0.006, 0)))), { closed: false, flip: true }), w);
  } else {
    if (key2) kit.add(key2, loft([ringArc(1.49, 0.074, 0.076, 0.35), ringArc(1.545, 0.078, 0.08, 0.3), ringArc(1.535, 0.09, 0.094, 0.45), ringArc(1.505, 0.1, 0.105, 0.7)], { closed: false }), w);
    const rows = [ringArc(1.48, 0.088, 0.085, 0.75), ringArc(1.53, 0.095, 0.092, 0.7), ringArc(1.52, 0.112, 0.108, 0.8), ringArc(1.47, 0.14, 0.13, 1.1, -0.03), ringArc(1.44, 0.16, 0.14, 1.35, -0.05)];
    kit.add(key, loft(rows, { closed: false }), w);
    kit.add(key, loft(rows.slice(2).map((r) => r.map((p) => p.clone().add(V3(0, -0.005, 0)))), { closed: false, flip: true }), w);
  }
}
// the GI's olive knit scarf: a roll round the neck, the ends tucked into the coat front
function buildScarfGI(kit, rig, key) {
  const { B } = rig, pts = [];
  for (let j = 0; j <= 28; j++) { const a = j / 28 * TAU; pts.push(V3(Math.cos(a) * 0.092, 1.5 + 0.018 * Math.max(0, -Math.sin(a)) - 0.006 * Math.max(0, Math.sin(a)), Math.sin(a) * 0.1 - 0.028)); }
  const w = (x, y) => [[B.chest, 0.7], [B.neck, 0.3]];
  kit.add(key, tube(pts, (t, a) => [0.024 * (1 + 0.12 * Math.sin(t * 40)), 0.03], 12), w);
  kit.add(key, tube(path([[0.035, 1.49, 0.07], [0.05, 1.44, 0.1], [0.045, 1.39, 0.115]], 8), [0.012, 0.045], 8, { up: V3(0, 0, 1) }), w);
  kit.add(key, tube(path([[-0.03, 1.495, 0.075], [-0.04, 1.45, 0.105], [-0.03, 1.41, 0.118]], 8), [0.011, 0.04], 8, { up: V3(0, 0, 1) }), w);
}
function shoulderStraps(kit, rig, key, at, o = {}) {
  const { B } = rig;
  for (const side of [1, -1]) {
    const a = at(1.49, side > 0 ? 0.35 : Math.PI - 0.35, 0.006), b = V3(side * 0.205, 1.445, -0.022);
    const g = strap(kit, key, [V3(a.x, a.y, a.z), V3(side * 0.15, 1.475, -0.024), b], o.w ?? 0.045, o.t ?? 0.004, (x) => [[B.chest, 0.4], [side > 0 ? B.clavL : B.clavR, 0.6]], V3(0, 1, 0));
    if (o.button) button(kit, o.button, V3(side * 0.118, 1.49, -0.024), V3(0, 1, 0.2), 0.0065, (x) => [[B.chest, 0.4], [side > 0 ? B.clavL : B.clavR, 0.6]]);
  }
}

// ── assembly ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// build(opts, fn): rig + kit + materials -> the figure API with update(); fn(kit, rig, M) adds the clothes
function assemble(o, fn) {
  const h = o.h ?? 1.76, rig = makeRig(h, { width: o.width ?? 1 });
  const U = { snow: { value: 0 } }, r = rng((o.seed ?? 1) * 7919 + 17);
  const M = {}, mat = (key, kind, col, opts = {}, snowK = 1, jit = 0.04) => (M[key] ||= makeMat(U, kind, jit ? jitter(col, r, jit) : col, opts, snowK));
  const kit = new Kit(rig.bones, [rig.s * rig.sw, rig.s, rig.s * (o.depth ?? 1)]);
  const extra = fn(kit, rig, mat, M, r) || {};
  // chinstrap/tail bones exist now; build the meshes and the skeleton
  for (const b of rig.bones) if (!b.parent && b !== rig.B.root) rig.B.root.add(b);
  const fig = makeFigure(rig, { name: o.name, props: extra.props });
  rig.B.root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(rig.bones);
  const { meshes, tris } = kit.build(M, skeleton, fig.group);
  fig.meshes = meshes; fig.tris = Math.round(tris); fig.materials = M; fig.skeleton = skeleton;
  // o.headScale (children, kits.js dress): the head bone is scaled AFTER the bind (the skinning then scales the head,
  // its headwear and the top of the neck about the head joint); poses reset position/rotation only, so it stays
  if (o.headScale && Math.abs(o.headScale - 1) > 1e-3) { rig.B.head.scale.setScalar(o.headScale); rig.B.root.updateMatrixWorld(true); }
  if (o.neckCut) { const d = o.neckCut * rig.s; rig.B.head.position.y -= d; rig.B.head.userData.rest.y -= d; rig.B.root.updateMatrixWorld(true); }   // a child's short neck
  fig.stride = (extra.stride ?? 1.18) * rig.s;
  const tails = extra.tails || [];
  fig.update = (t = 0, st = {}) => {
    U.snow.value = clamp(st.snow ?? 0);
    const wd = st.wind, k = typeof wd === 'number' ? wd : wd ? (wd.strength ?? 1) : 0;
    const dir = typeof wd === 'object' && wd ? V3(wd.x ?? 1, 0, wd.z ?? 0).normalize() : V3(1, 0, 0);
    const gq = rig.B.root.getWorldQuaternion(new THREE.Quaternion());
    for (const [sd, side] of [['L', 1], ['R', -1]]) {
      const b = rig.B['chin' + sd]; if (!b) continue;
      const d = V3(0, -1, 0).addScaledVector(dir, k * 0.3 * (0.6 + 0.4 * Math.sin(t * 5.3 + side))).add(V3(0, 0, 0.06 * Math.sin(t * 2.3 + side)).applyQuaternion(gq)).normalize();
      setWorldRot(b, new THREE.Quaternion().setFromUnitVectors(V3(0, -1, 0), d).multiply(gq)); b.updateMatrixWorld(true);
    }
    for (const tl of tails) tl(t, k, dir);
    fig.group.updateMatrixWorld(true);
    return fig;
  };
  fig.pose(o.pose || POSES.stand);
  return fig;
}
const OVERCOAT = { torso: [[1.535, 0.066, 0.072, 0.072, -0.03], [1.5, 0.112, 0.086, 0.088, -0.03], [1.465, 0.182, 0.1, 0.1, -0.026], [1.43, 0.224, 0.116, 0.11, -0.022], [1.37, 0.215, 0.134, 0.118, -0.016], [1.29, 0.201, 0.144, 0.123, -0.012], [1.2, 0.191, 0.141, 0.124, -0.006], [1.11, 0.186, 0.137, 0.124, -0.002], [1.03, 0.19, 0.14, 0.13, 0.0]],
  skirt: [[1.065, 0.19, 0.14, 0.13, 0.0], [0.97, 0.206, 0.15, 0.152, -0.004], [0.86, 0.222, 0.16, 0.168, -0.008], [0.7, 0.238, 0.173, 0.181, -0.01], [0.55, 0.25, 0.184, 0.188, -0.012], [0.41, 0.262, 0.194, 0.196, -0.012]] };
const GREATCOAT = { torso: [[1.535, 0.064, 0.07, 0.072, -0.03], [1.5, 0.11, 0.084, 0.088, -0.03], [1.465, 0.18, 0.098, 0.1, -0.026], [1.43, 0.219, 0.112, 0.108, -0.022], [1.37, 0.211, 0.13, 0.116, -0.016], [1.29, 0.196, 0.139, 0.12, -0.012], [1.2, 0.183, 0.133, 0.12, -0.006], [1.11, 0.173, 0.127, 0.12, -0.002], [1.03, 0.178, 0.13, 0.126, 0.0]],
  skirt: [[1.075, 0.176, 0.128, 0.124, 0.0], [0.97, 0.199, 0.143, 0.148, -0.004], [0.85, 0.217, 0.157, 0.166, -0.008], [0.68, 0.235, 0.171, 0.181, -0.01], [0.5, 0.251, 0.185, 0.191, -0.012], [0.33, 0.265, 0.197, 0.201, -0.012]] };
const M43 = { torso: [[1.53, 0.066, 0.072, 0.072, -0.03], [1.5, 0.108, 0.082, 0.086, -0.03], [1.465, 0.177, 0.098, 0.098, -0.026], [1.43, 0.215, 0.112, 0.106, -0.022], [1.37, 0.207, 0.128, 0.114, -0.016], [1.29, 0.194, 0.136, 0.12, -0.012], [1.2, 0.185, 0.132, 0.12, -0.006], [1.1, 0.177, 0.126, 0.118, -0.002], [1.03, 0.174, 0.124, 0.118, 0.0]],
  skirt: [[1.07, 0.172, 0.122, 0.116, 0.0], [1.0, 0.182, 0.128, 0.128, 0.0], [0.9, 0.19, 0.131, 0.138, -0.004], [0.8, 0.193, 0.133, 0.141, -0.005]] };
function coatDetails(kit, rig, keys, at, sk, kind) {
  const tw = torsoWeights(rig.B);
  if (kind === 'overcoat') {
    for (const y of [1.37, 1.28, 1.19, 1.1]) for (const d of [0.34, -0.36]) button(kit, keys.button, at(y, Math.PI / 2 + d, 0.012), surfNormal(at, y, Math.PI / 2 + d), 0.0105, tw);
  } else if (kind === 'greatcoat') {
    for (let k = 0; k < 6; k++) { const y = 1.41 - k * 0.07, d = lerp(0.5, 0.4, k / 5); for (const dd of [d, -d]) button(kit, keys.button, at(y, Math.PI / 2 + dd, 0.012), surfNormal(at, y, Math.PI / 2 + dd), 0.0095, tw); }
    for (const side of [1, -1]) placeBox(kit, keys.coat, rbox(0.17, 0.05, 0.012, 0.006), sk, 0.95, Math.PI / 2 - side * 0.95, 0.004, (x, y, z) => [[rig.B.pelvis, 1]], side * 0.0);
  } else if (kind === 'm43') {
    for (const side of [1, -1]) {
      placeBox(kit, keys.coat, rbox(0.125, 0.14, 0.018, 0.01), at, 1.26, Math.PI / 2 - side * 0.55, 0.004, tw);
      placeBox(kit, keys.coat, rbox(0.13, 0.05, 0.012, 0.006), at, 1.335, Math.PI / 2 - side * 0.55, 0.018, tw, 0.1);
      button(kit, keys.button, at(1.325, Math.PI / 2 - side * 0.55, 0.028), surfNormal(at, 1.33, Math.PI / 2 - side * 0.55), 0.0065, tw);
      placeBox(kit, keys.coat, rbox(0.15, 0.05, 0.012, 0.006), sk, 0.95, Math.PI / 2 - side * 0.62, 0.006, (x, y, z) => [[rig.B.pelvis, 1]], 0.05);
    }
    band(kit, keys.coat, at, 1.045, 0.012, 0.003, tw);
  }
}

// ── US soldier ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function gi(o = {}) {
  const coat = o.coat ?? 'overcoat', weapon = o.weapon === undefined ? 'garand' : o.weapon;
  return assemble({ ...o, name: 'gi' }, (kit, rig, mat, M, r) => {
    mat('skin', 'plaster', 0xCFC9BF, { roughness: 0.55 }, 0.5, 0);
    mat('coat', coat === 'overcoat' ? 'melton' : 'sateen', coat === 'overcoat' ? 0x5D553A : 0x5A5B3F, { roughness: coat === 'overcoat' ? 0.96 : 0.86, side: THREE.DoubleSide }, 1, 0.06);
    mat('trousers', 'serge', 0x5E573F, { roughness: 0.95 }, 1, 0.05);
    mat('shirt', 'serge', 0x6A6347, { roughness: 0.95 }, 1);
    mat('web', 'web', 0x6D694B, { roughness: 0.95 }, 1, 0.08);
    mat('metal', null, 0x4A4A42, { roughness: 0.45, metalness: 0.7 }, 0.6, 0);
    mat('button', null, 0x3B3526, { roughness: 0.45, metalness: 0.55 }, 0.3, 0);
    mat('shell', 'steel', 0x4D4C36, { roughness: 0.78, side: THREE.DoubleSide }, 1.2, 0.05);
    mat('rim', 'steel', 0x57553E, { roughness: 0.55, metalness: 0.25 }, 0.8, 0);
    mat('liner', null, 0x3A3527, { roughness: 0.9, side: THREE.DoubleSide }, 0, 0);
    mat('strap', 'web', 0x5C5840, { roughness: 0.95 }, 0.5);
    mat('glove', 'knit', 0x4E4C39, { roughness: 1, nScale: 0.8 }, 0.6, 0.05);
    mat('boot', 'leather', 0x5B3F2A, { roughness: 0.78 }, 0.8, 0.06);
    mat('sole', null, 0x26221E, { roughness: 0.9 }, 0.3, 0);
    buildHead(kit, rig, 'skin');
    buildHands(kit, rig, 'glove', { glove: true, cuff: 'knit' });
    let at, sk;
    if (coat === 'overcoat') {
      at = buildTorso(kit, rig, 'coat', { rows: OVERCOAT.torso, edge: [0.42, 0.012, 1.47, 1.02] }).at;
      sk = buildSkirt(kit, rig, 'coat', { rows: OVERCOAT.skirt, ov: 0.42 }).at;
      buildSleeves(kit, rig, 'coat', { r: [0.066, 0.059, 0.058], ext: 0.022 });
      buildCollar(kit, rig, 'coat', 'roll');
      coatDetails(kit, rig, { button: 'button', coat: 'coat' }, at, sk, 'overcoat');
      shoulderStraps(kit, rig, 'coat', at, { button: 'button' });
    } else {
      at = buildTorso(kit, rig, 'coat', { rows: M43.torso, edge: [0.07, 0.008, 1.47, 1.02] }).at;
      sk = buildSkirt(kit, rig, 'coat', { rows: M43.skirt, ov: 0.12, legK: 0.35, shinK: 0 }).at;
      buildSleeves(kit, rig, 'coat', { r: [0.066, 0.054, 0.047], ext: 0.012 });
      buildCollar(kit, rig, 'coat', 'jacket', 'shirt');
      coatDetails(kit, rig, { button: 'button', coat: 'coat' }, at, sk, 'm43');
      shoulderStraps(kit, rig, 'coat', at, { button: 'button' });
    }
    const feet = o.burlap ? 'burlap' : o.overshoes ? 'overshoe' : 'buckle';
    if (feet === 'burlap') mat('burlap', 'burlap', 0x8A7352, { roughness: 1, side: THREE.DoubleSide }, 1.2, 0.05);
    if (feet === 'overshoe') mat('rubber', 'leather', 0x1D1D1B, { roughness: 0.5, nScale: 0.4 }, 0.8, 0);
    const top = buildBoots(kit, rig, { upper: feet === 'burlap' ? 'burlap' : feet === 'overshoe' ? 'rubber' : 'boot', sole: feet === 'burlap' ? 'burlap' : 'sole', metal: 'metal', extra: feet === 'burlap' ? 'strap' : 'rubber' }, feet, { seed: o.seed });
    buildLegs(kit, rig, 'trousers', { r: [0.089, 0.065, 0.061, 0.056], end: top - 0.035, blouse: [0.075, 0.017] });
    buildGIKit(kit, rig, { web: 'web', metal: 'metal' }, at, { bar: weapon === 'bar' });
    buildM1(kit, rig, { shell: 'shell', rim: 'rim', liner: 'liner', net: 'net', strap: 'strap' }, { net: o.net });
    if (o.net) mat('net', 'net', 0x7A7052, { alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }, 0.8, 0.05);
    if (o.scarf) { mat('knit', 'knit', 0x545139, { roughness: 1 }, 1, 0.05); buildScarfGI(kit, rig, 'knit'); }
    const props = {};
    if (weapon) {
      mat('wood', 'wood', 0x55311C, { roughness: 0.5 }, 0.25, 0.05); mat('wsteel', null, 0x2C2E2B, { roughness: 0.42, metalness: 0.75 }, 0.2, 0);
      const WB = buildWeapon(kit, rig, weapon, { wood: 'wood', steel: 'wsteel', strap: 'strap' });
      props.weapon = weaponPlacer(rig, WB);
    }
    return { props };
  });
}

// ── Brig. Gen. Anthony McAuliffe (cellar HQ): M1943 jacket, one star, jump boots; o.helmet adds the starred M1 ─────
export function general(o = {}) {
  return assemble({ ...o, name: 'mcauliffe', h: o.h ?? 1.74 }, (kit, rig, mat) => {
    mat('skin', 'plaster', 0xCFC9BF, { roughness: 0.55 }, 0.5, 0);
    mat('coat', 'sateen', 0x5B5C40, { roughness: 0.85, side: THREE.DoubleSide }, 1, 0.02);
    mat('trousers', 'serge', 0x5F5840, { roughness: 0.95 }, 1, 0.03);
    mat('shirt', 'serge', 0x6C6548, { roughness: 0.95 }, 1);
    mat('button', null, 0x3B3526, { roughness: 0.45, metalness: 0.55 }, 0.3, 0);
    mat('silver', null, 0xD8D8D2, { roughness: 0.3, metalness: 0.95 }, 0.2, 0);
    mat('boot', 'leather', 0x5E3B22, { roughness: 0.45 }, 0.6, 0.03);
    mat('sole', null, 0x221D18, { roughness: 0.85 }, 0.3, 0);
    mat('metal', null, 0x4A4A42, { roughness: 0.45, metalness: 0.7 }, 0.6, 0);
    buildHead(kit, rig, 'skin');
    buildHands(kit, rig, 'skin', {});
    const at = buildTorso(kit, rig, 'coat', { rows: M43.torso, edge: [0.07, 0.008, 1.47, 1.02] }).at;
    const sk = buildSkirt(kit, rig, 'coat', { rows: M43.skirt, ov: 0.12, legK: 0.35, shinK: 0 }).at;
    buildSleeves(kit, rig, 'coat', { r: [0.066, 0.054, 0.047], ext: 0.012 });
    buildCollar(kit, rig, 'coat', 'jacket', 'shirt');
    coatDetails(kit, rig, { button: 'button', coat: 'coat' }, at, sk, 'm43');
    shoulderStraps(kit, rig, 'coat', at, { button: 'button' });
    // one small silver star on each shoulder strap and on the shirt collar point
    const tw = (x) => [[rig.B.chest, 0.4], [x > 0 ? rig.B.clavL : rig.B.clavR, 0.6]];
    for (const side of [1, -1]) {
      const sh = new THREE.Shape(); for (let k = 0; k < 10; k++) { const rr = k % 2 ? 0.0055 : 0.0135, a = Math.PI / 2 + k * Math.PI / 5; if (k) sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.002, bevelEnabled: false }); sg.rotateX(-Math.PI / 2 + 0.25); sg.translate(side * 0.165, 1.478, -0.02);
      kit.add('silver', sg, () => tw(side));
      const cs = new THREE.ExtrudeGeometry(sh, { depth: 0.0015, bevelEnabled: false }); cs.scale(0.6, 0.6, 1); cs.rotateY(side * 0.5); cs.translate(side * 0.052, 1.505, 0.062);
      kit.add('silver', cs, () => [[rig.B.chest, 0.8], [rig.B.neck, 0.2]]);
    }
    const top = buildBoots(kit, rig, { upper: 'boot', sole: 'sole', metal: 'metal' }, 'jump');
    buildLegs(kit, rig, 'trousers', { r: [0.088, 0.064, 0.06, 0.055], end: top - 0.03, blouse: [0.07, 0.016] });
    if (o.helmet) {
      mat('shell', 'steel', 0x4D4C36, { roughness: 0.78, side: THREE.DoubleSide }, 1.2, 0);
      mat('rim', 'steel', 0x57553E, { roughness: 0.55, metalness: 0.25 }, 0.8, 0);
      mat('liner', null, 0x3A3527, { roughness: 0.9, side: THREE.DoubleSide }, 0, 0); mat('strap', 'web', 0x5C5840, { roughness: 0.95 }, 0.5);
      mat('star', null, 0xECEAE2, { roughness: 0.7, side: THREE.DoubleSide }, 0, 0);
      buildM1(kit, rig, { shell: 'shell', rim: 'rim', liner: 'liner', strap: 'strap', star: 'star' }, { star: true });
    }
    return {};
  });
}

// ── the German truce party ─────────────────────────────────────────────────────────────────────────────────────────
// officer (Maj. Wagner / Lt. Henke): M36 greatcoat to mid-calf, bottle-green collar, 2 x 6 buttons, brown belt, peaked
// cap, high-gloss riding boots, leather gloves; o.briefcase: the brown case under the left arm
export function germanOfficer(o = {}) {
  return assemble({ ...o, name: 'germanOfficer', h: o.h ?? 1.78 }, (kit, rig, mat) => {
    mat('skin', 'plaster', 0xCFC9BF, { roughness: 0.55 }, 0.5, 0);
    mat('coat', 'melton', 0x696C5E, { roughness: 0.93, side: THREE.DoubleSide }, 1, 0.04);
    mat('collar', 'melton', 0x2E3A31, { roughness: 0.9, side: THREE.DoubleSide }, 1, 0.03);
    mat('breeches', 'serge', 0x5E6255, { roughness: 0.92 }, 1, 0.03);
    mat('boot', 'leather', 0x0A0A0B, { roughness: 0.13, nScale: 0.22, envMapIntensity: 1.3 }, 0.35, 0);
    mat('sole', null, 0x121110, { roughness: 0.7 }, 0.3, 0);
    mat('glove', 'leather', 0x44362A, { roughness: 0.55, nScale: 0.6 }, 0.5, 0.05);
    mat('belt', 'leather', 0x5A3822, { roughness: 0.42, nScale: 0.5 }, 0.6, 0.04);
    mat('cap', 'melton', 0x696C5E, { roughness: 0.9 }, 1.1, 0.03);
    mat('band', 'melton', 0x2D372F, { roughness: 0.9 }, 0.6, 0);
    mat('visor', null, 0x060606, { roughness: 0.09, envMapIntensity: 1.3, side: THREE.DoubleSide }, 0.3, 0);
    mat('silver', null, 0xCFCFC8, { roughness: 0.32, metalness: 0.92 }, 0.2, 0);
    mat('piping', null, 0xC98B98, { roughness: 0.8 }, 0.5, 0);
    mat('board', 'web', 0xB9BAB2, { roughness: 0.4, metalness: 0.6 }, 0.6, 0);
    mat('button', null, 0x86887F, { roughness: 0.35, metalness: 0.8 }, 0.2, 0);
    mat('metal', null, 0x8C8E86, { roughness: 0.35, metalness: 0.85 }, 0.3, 0);
    buildHead(kit, rig, 'skin');
    buildHands(kit, rig, 'glove', { glove: true, cuff: 'gauntlet' });
    const at = buildTorso(kit, rig, 'coat', { rows: GREATCOAT.torso, edge: [0.52, 0.012, 1.44, 1.02] }).at;
    const sk = buildSkirt(kit, rig, 'coat', { rows: GREATCOAT.skirt, ov: 0.46, shinK: 0.5 }).at;
    buildSleeves(kit, rig, 'coat', { r: [0.068, 0.058, 0.057], ext: 0.022, turn: [0.1, 0.005] });
    buildCollar(kit, rig, 'collar', 'wide');
    coatDetails(kit, rig, { button: 'button', coat: 'coat' }, at, sk, 'greatcoat');
    shoulderStraps(kit, rig, 'board', at, { w: 0.042, t: 0.006, button: 'button' });
    buildOffKit(kit, rig, { belt: 'belt', metal: 'metal' }, at);
    const top = buildBoots(kit, rig, { upper: 'boot', sole: 'sole', metal: 'metal' }, 'riding');
    buildLegs(kit, rig, 'breeches', { r: [0.1, 0.058, 0.054, 0.05], end: top - 0.03 });
    buildSchirm(kit, rig, { band: 'band', cap: 'cap', visor: 'visor', silver: 'silver', piping: 'piping' });
    const props = {};
    if (o.briefcase) { mat('case', 'leather', 0x55341F, { roughness: 0.42, nScale: 0.45 }, 0.8, 0.03); props.case = buildCase(kit, rig, { case: 'case', metal: 'metal' }); }
    return { props, stride: 1.2 };
  });
}
// Panzergrenadier (901st): greatcoat (or M43 tunic), M43 field cap or M42 helmet, marching boots, belt kit
export function germanSoldier(o = {}) {
  const coat = o.coat ?? 'greatcoat', cap = o.cap ?? 'm43';
  return assemble({ ...o, name: 'germanSoldier', h: o.h ?? 1.75 }, (kit, rig, mat) => {
    mat('skin', 'plaster', 0xCFC9BF, { roughness: 0.55 }, 0.5, 0);
    mat('coat', coat === 'greatcoat' ? 'melton' : 'serge', 0x5E6154, { roughness: 0.95, side: THREE.DoubleSide }, 1, 0.05);
    mat('collar', 'melton', 0x535749, { roughness: 0.95, side: THREE.DoubleSide }, 1, 0.03);
    mat('trousers', 'serge', 0x5A5D52, { roughness: 0.95 }, 1, 0.04);
    mat('boot', 'leather', 0x141311, { roughness: 0.4, nScale: 0.8 }, 0.5, 0);
    mat('sole', null, 0x121110, { roughness: 0.8 }, 0.3, 0);
    mat('glove', 'knit', 0x5A5D55, { roughness: 1 }, 0.6, 0.04);
    mat('belt', 'leather', 0x171614, { roughness: 0.45, nScale: 0.6 }, 0.6, 0);
    mat('bag', 'serge', 0x666553, { roughness: 0.95 }, 1, 0.05);
    mat('metal', null, 0x6E706A, { roughness: 0.45, metalness: 0.7 }, 0.4, 0);
    mat('button', null, 0x6E706A, { roughness: 0.45, metalness: 0.6 }, 0.3, 0);
    buildHead(kit, rig, 'skin');
    buildHands(kit, rig, 'glove', { glove: true, cuff: 'knit' });
    let at, sk;
    if (coat === 'greatcoat') {
      at = buildTorso(kit, rig, 'coat', { rows: GREATCOAT.torso, edge: [0.52, 0.012, 1.44, 1.02] }).at;
      sk = buildSkirt(kit, rig, 'coat', { rows: GREATCOAT.skirt.map((r, i) => (i === GREATCOAT.skirt.length - 1 ? [0.36, ...r.slice(1)] : r)), ov: 0.46, shinK: 0.5 }).at;
      buildSleeves(kit, rig, 'coat', { r: [0.069, 0.059, 0.058], ext: 0.022, turn: [0.09, 0.005] });
      buildCollar(kit, rig, 'collar', 'wide');
      coatDetails(kit, rig, { button: 'button', coat: 'coat' }, at, sk, 'greatcoat');
    } else {
      at = buildTorso(kit, rig, 'coat', { rows: M43.torso, edge: [0.07, 0.008, 1.47, 1.02] }).at;
      sk = buildSkirt(kit, rig, 'coat', { rows: M43.skirt.map((r, i) => (i === M43.skirt.length - 1 ? [0.83, ...r.slice(1)] : r)), ov: 0.12, legK: 0.35, shinK: 0 }).at;
      buildSleeves(kit, rig, 'coat', { r: [0.064, 0.053, 0.046], ext: 0.012 });
      buildCollar(kit, rig, 'collar', 'jacket', 'coat');
      coatDetails(kit, rig, { button: 'button', coat: 'coat' }, at, sk, 'm43');
      for (const y of [1.39, 1.3, 1.21, 1.12]) button(kit, 'button', at(y, Math.PI / 2 - 0.02, 0.01), surfNormal(at, y, Math.PI / 2), 0.0085, torsoWeights(rig.B));
    }
    shoulderStraps(kit, rig, 'coat', at, { w: 0.05, t: 0.005, button: 'button' });
    if (o.kit !== false) buildGerKit(kit, rig, { belt: 'belt', metal: 'metal', bag: 'bag' }, at);
    const top = buildBoots(kit, rig, { upper: 'boot', sole: 'sole', metal: 'metal' }, 'marching');
    buildLegs(kit, rig, 'trousers', { r: [0.09, 0.064, 0.06, 0.058], end: top - 0.03 });
    if (cap === 'helmet') {
      mat('shell', 'steel', 0x4D5047, { roughness: 0.84, side: THREE.DoubleSide }, 1.2, 0.04); mat('strap', 'leather', 0x2A2016, { roughness: 0.6 }, 0.3, 0);
      buildM42(kit, rig, { shell: 'shell', strap: 'strap' });
    } else {
      mat('cap', 'melton', 0x5E6154, { roughness: 0.95, side: THREE.DoubleSide }, 1.1, 0.04); mat('insig', null, 0xA9A898, { roughness: 0.7 }, 0.3, 0);
      buildM43(kit, rig, { cap: 'cap', metal: 'button', insig: 'insig' });
    }
    return { stride: 1.18 };
  });
}

// ── THE WITNESS: bare white mannequin, faceless egg head, one thick mustard knit scarf ───────────────────────────────
const WITNESS_TORSO = [[1.5, 0.06, 0.058, 0.064, -0.03], [1.475, 0.1, 0.07, 0.078, -0.028], [1.45, 0.155, 0.086, 0.086, -0.025], [1.415, 0.196, 0.1, 0.092, -0.021], [1.37, 0.188, 0.114, 0.096, -0.017], [1.33, 0.172, 0.12, 0.097, -0.014], [1.29, 0.165, 0.121, 0.098, -0.012], [1.21, 0.149, 0.112, 0.098, -0.008], [1.13, 0.133, 0.1, 0.094, -0.004], [1.05, 0.139, 0.1, 0.1, 0.0], [0.97, 0.16, 0.104, 0.114, -0.004], [0.915, 0.163, 0.101, 0.114, -0.006], [0.86, 0.148, 0.09, 0.104, -0.006], [0.815, 0.095, 0.064, 0.07, -0.004], [0.8, 0.04, 0.03, 0.03, 0.0]];
// a scarf tail as a ribbon on a chain of bones; returns update(t, k, windDir)
function scarfTail(kit, rig, key, fkey, pts, nb, width, back) {
  const { B } = rig, pp = path(pts, 30), seg = [], bones = [];
  let parent = B.chest;
  for (let i = 0; i < nb; i++) {
    const at = pp[Math.round(i / nb * (pp.length - 1))];
    const b = addBone(rig, (back ? 'tailB' : 'tailF') + i, parent, at); bones.push(b); parent = b;
    const nx = pp[Math.round((i + 1) / nb * (pp.length - 1))];
    seg.push(nx.clone().sub(at).normalize());
  }
  const L = []; let acc = 0; for (let i = 0; i < pp.length; i++) { if (i) acc += pp[i].distanceTo(pp[i - 1]); L.push(acc); }
  const g = tube(pp, (t, a) => [0.0085 * (1 + 0.12 * Math.cos(a * 2)), width / 2 * (0.66 + 0.34 * sstep(0, 0.35, t))], 16, { up: V3(0, 0, back ? -1 : 1) });
  {   // bow the ribbon (edges curl toward the body) and add two soft lengthwise folds
    const G = g.attributes.position, nrow = pp.length, cols = G.count / nrow, m = cols - 1;
    for (let i = 0; i < nrow; i++) {
      const t = i / (nrow - 1), T = pp[Math.min(nrow - 1, i + 1)].clone().sub(pp[Math.max(0, i - 1)]).normalize();
      const Nn = V3(0, 0, back ? -1 : 1); Nn.sub(T.clone().multiplyScalar(Nn.dot(T))).normalize();
      for (let j = 0; j < cols; j++) {
        const a = (j % m) / m * TAU, u = Math.sin(a), k = i * cols + j;
        const d = -0.012 * u * u * sstep(0.05, 0.4, t) + 0.006 * Math.sin(u * 5.2 + t * 7 + (back ? 1 : 0)) * sstep(0.1, 0.5, t);
        G.setXYZ(k, G.getX(k) + Nn.x * d, G.getY(k) + Nn.y * d, G.getZ(k) + Nn.z * d);
      }
    }
    g.computeVertexNormals();
  }
  const P = g.attributes.position;
  const wOf = (x, y, z) => {        // nearest path sample -> fractional bone index
    let bi = 0, bd = 1e9; for (let i = 0; i < pp.length; i++) { const d = (pp[i].x - x) ** 2 + (pp[i].y - y) ** 2 + (pp[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const f = clamp(bi / (pp.length - 1) * nb - 0.5, 0, nb - 1), i0 = Math.floor(f), t = f - i0;
    return i0 + 1 < nb ? [[bones[i0], 1 - t], [bones[i0 + 1], t]] : [[bones[i0], 1]];
  };
  kit.add(key, g, wOf);
  // fringe: a flat strip of threads continuing the tail end
  const d = pp[pp.length - 1].clone().sub(pp[pp.length - 3]).normalize(), e = pp[pp.length - 1].clone().addScaledVector(d, -0.012), side = V3(1, 0, 0);
  const Ne = V3(0, 0, back ? -1 : 1); Ne.sub(d.clone().multiplyScalar(Ne.dot(d))).normalize();
  const fg = new THREE.PlaneGeometry(width * 0.95, 0.085, 8, 1), fp = fg.attributes.position;
  for (let i = 0; i < fp.count; i++) { const u = fp.getX(i), v = fp.getY(i), uu = u / (width * 0.475); const p = e.clone().addScaledVector(side, u).addScaledVector(d, 0.0425 - v).addScaledVector(Ne, -0.012 * uu * uu + 0.004); fp.setXYZ(i, p.x, p.y, p.z); }
  const uv = fg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), 1 - uv.getY(i));
  fg.computeVertexNormals();
  kit.add(fkey, fg, bones[nb - 1]);
  const ph = back ? 1.7 : 0.3;
  return (t, k, dir) => {
    const cq = B.chest.getWorldQuaternion(new THREE.Quaternion()), fwd = V3(0, 0, back ? -1 : 1).applyQuaternion(cq);
    for (let i = 0; i < nb; i++) {
      const rest = seg[i].clone().applyQuaternion(cq), f = (i + 1) / nb;
      const osc = 0.65 + 0.35 * Math.sin(t * (1.9 + i * 0.37) + ph + i * 0.8) + 0.15 * Math.sin(t * 5.3 + i * 1.7 + ph);
      // gravity grows as the chest tilts away from upright (a figure bent over: the tails hang, they do not stick out)
      const dd = rest.clone().add(V3(0, -(0.25 + 1.4 * Math.max(0, 1 + rest.y)), 0)).addScaledVector(dir, k * (0.1 + 0.55 * f) * osc);
      dd.addScaledVector(fwd, k * 0.12 * f * Math.sin(t * 2.6 + i + ph)); dd.normalize();
      const lim = rest.dot(fwd) - 0.03; const dn = dd.dot(fwd); if (dn < lim) dd.addScaledVector(fwd, lim - dn).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(rest, dd).multiply(cq);
      setWorldRot(bones[i], q); bones[i].updateMatrixWorld(true);
    }
  };
}
export function witness(o = {}) {
  return assemble({ ...o, name: 'witness', h: o.h ?? 1.82, width: 0.94 }, (kit, rig, mat, M) => {
    mat('body', 'plaster', 0xF1EEE8, { roughness: 0.5, nScale: 0.5, envMapIntensity: 0.55 }, 0.35, 0);
    mat('scarf', 'knit', 0xE0B24E, { roughness: 0.93, nScale: 1.25, side: THREE.DoubleSide }, 0.8, 0);
    mat('fringe', 'fringe', 0xD9A944, { roughness: 0.95, alphaTest: 0.5, side: THREE.DoubleSide }, 0.5, 0);
    buildHead(kit, rig, 'body', { egg: true, neckR: 0.93, scale: 0.95 });
    buildHands(kit, rig, 'body', {});
    buildTorso(kit, rig, 'body', { rows: WITNESS_TORSO, e: 2.1, m: 64, n: 44, capEnd: true, bulge: (p, a, y) => {
      for (const sx of [1, -1]) { const d2 = ((p.x - sx * 0.075) / 0.07) ** 2 + ((y - 1.3) / 0.06) ** 2; if (Math.sin(a) > 0) p.z += 0.012 * Math.exp(-d2) * Math.sin(a); }
      if (Math.sin(a) < 0) { const d2 = ((y - 0.955) / 0.06) ** 2; p.z -= 0.012 * Math.exp(-d2) * Math.abs(Math.sin(a)) * (Math.abs(Math.cos(a)) < 0.7 ? 1 : 0.5); }
    } });
    buildSleeves(kit, rig, 'body', { r: [0.05, 0.036, 0.029], ext: -0.004, wrinkle: 0, cap: 0.95 });
    buildLegs(kit, rig, 'body', { r: [0.082, 0.05, 0.046, 0.035], end: 0.105, pelvis: [0.13, 0.09, 0.1], hipCap: 0.9, muscle: true });
    buildBoots(kit, rig, { upper: 'body', sole: 'body', metal: 'body' }, 'bare');
    // the scarf: a thick roll wrapped once round the neck, crossing at the front left, two tails
    const wrap = [];
    for (let j = 0; j <= 40; j++) { const a = j / 40 * TAU; wrap.push(V3(Math.cos(a) * 0.084, 1.505 + 0.026 * Math.max(0, -Math.sin(a)) - 0.004 * Math.max(0, Math.sin(a)), Math.sin(a) * 0.09 - 0.026)); }
    const ww = () => [[rig.B.chest, 0.65], [rig.B.neck, 0.35]];
    kit.add('scarf', tube(wrap, (t, a) => { const b = 1 + 0.08 * Math.sin(t * TAU * 4 + 0.7) + 0.05 * Math.sin(t * TAU * 9 + 1.3); const c = Math.cos(a), fold = 1 + 0.18 * Math.max(0, Math.sin(a * 3 + t * 30)) * 0.4; return [0.021 * b * fold, 0.05 * (1 + 0.1 * Math.sin(t * TAU * 3)) * (1 - 0.08 * c * c)]; }, 20, { up: V3(0, 1, 0) }), ww);
    kit.add('scarf', tube(path([[-0.078, 1.536, 0.02], [-0.04, 1.522, 0.07], [0.012, 1.5, 0.092], [0.05, 1.472, 0.088], [0.052, 1.445, 0.1]], 16), (t, a) => [0.016 * (1 + 0.15 * Math.cos(a * 2)), 0.05 * (1 - 0.25 * t)], 14, { up: V3(0, 0.3, 1) }), ww);
    kit.add('scarf', sphereG(0.034, 0.042, 1.474, 0.093, 1.25, 0.95, 0.72, 18, 12), ww);
    const tails = [
      scarfTail(kit, rig, 'scarf', 'fringe', [[0.036, 1.47, 0.1], [0.046, 1.41, 0.132], [0.052, 1.33, 0.143], [0.052, 1.22, 0.14], [0.05, 1.1, 0.126], [0.048, 0.99, 0.124]], 5, 0.15, false),
      scarfTail(kit, rig, 'scarf', 'fringe', [[-0.035, 1.52, -0.105], [-0.042, 1.44, -0.127], [-0.046, 1.33, -0.13], [-0.046, 1.21, -0.127], [-0.044, 1.08, -0.137], [-0.04, 0.95, -0.158]], 5, 0.15, true),
    ];
    return { tails, stride: 1.26 };
  });
}

// ── the white flag: a fringed white bedspread tied to a 2.6 m pole; cloth ripples on the CPU, deterministic in t ──
function bedspreadTex(W, H, fr) {
  if (TEX.bed) return TEX.bed;
  const w = 1024, h = Math.round(1024 * (H + 2 * fr) / (W + fr)), nz = makeNoise(97);
  const Hh = new Float32Array(w * h);
  const col = greyTex((x, y) => {
    const X = x / w * (W + fr), Y = y / h * (H + 2 * fr);             // metres; X from the hoist, Y from the top
    const inX = X < W, inY = Y > fr && Y < H + fr;
    if (!(inX && inY)) {                                             // fringe: threads hanging off the fly, top and bottom edges
      const along = inX ? X : Y, dist = inX ? (Y < fr ? fr - Y : Y - H - fr) : X - W;
      const th = Math.abs(((along * 180) % 1) - 0.5) < 0.2 + 0.1 * nz.noise2(along * 40, 0.5, 256, 256);
      const len = fr * (0.75 + 0.25 * nz.noise2(along * 30, 3.1, 256, 256));
      const a = th && dist < len && !(Y < fr && X > W) && !(Y > H + fr && X > W) ? 1 : 0;
      Hh[y * w + x] = 0.3;
      return [0.9, 0.89, 0.85, a];
    }
    const dx = X - W / 2, dy = Y - fr - H / 2;
    const u = (dx + dy) / 0.11, v = (dx - dy) / 0.11;                 // candlewick diamond lattice
    const lu = Math.abs(u - Math.round(u)), lv = Math.abs(v - Math.round(v));
    const tuft = Math.min(lu, lv) < 0.07 ? 1 : 0;
    const border = Math.abs(Math.min(X, W - X, Y - fr, H + fr - Y) - 0.1) < 0.012 ? 1 : 0;
    const n = nz.fbm2(X * 3, Y * 3, 4, 2, 0.5, 256, 256) * 0.04 + nz.noise2(X * 90, Y * 90, 256, 256) * 0.015;
    Hh[y * w + x] = tuft * 0.6 + border * 0.8 + n * 3;
    const k = 0.93 - tuft * 0.045 - border * 0.06 + n;
    return [k, k * 0.992, k * 0.965, 1];
  }, w, h, [1, 1], true);
  const nrm = normalTex(Hh, w, h, 3.0, [1, 1]);
  return (TEX.bed = { col, nrm });
}
export function whiteFlag(o = {}) {
  const W = o.width ?? 1.6, H = o.height ?? 1.2, PL = o.pole ?? 2.6, fr = 0.055, nx = 44, ny = 34;
  const U = { snow: { value: 0 } };
  const group = new THREE.Group(); group.name = 'whiteFlag';
  const pole = new THREE.Group(); group.add(pole);
  const wood = makeMat(U, 'wood', 0x7B5B3C, { roughness: 0.85 }, 0.5), cord = makeMat(U, null, 0xD8D2C2, { roughness: 1 }, 0.3);
  const pg = new THREE.CylinderGeometry(0.016, 0.019, PL, 14, 1); pg.translate(0, PL / 2, 0);
  const pm = new THREE.Mesh(pg, wood); pm.castShadow = pm.receiveShadow = true; pole.add(pm);
  for (const yy of [PL - 0.07, PL - 0.07 - H / 2, PL - 0.07 - H]) { const tg = new THREE.TorusGeometry(0.021, 0.005, 6, 16); tg.rotateX(Math.PI / 2); const t = new THREE.Mesh(tg, cord); t.position.y = yy; t.castShadow = true; pole.add(t); }
  const tex = o.tex || bedspreadTex(W, H, fr);
  const clothMat = snowPatch(plain({ map: tex.col, normalMap: tex.nrm || null, normalScale: new THREE.Vector2(0.6, 0.6), color: 0xFFFFFF, roughness: 0.95, alphaTest: 0.5, side: THREE.DoubleSide }), U, 0.6);
  const cg = new THREE.PlaneGeometry(W + fr, H + 2 * fr, nx, ny);
  const cloth = new THREE.Mesh(cg, clothMat); cloth.castShadow = cloth.receiveShadow = true; cloth.frustumCulled = false;
  const pivot = new THREE.Group(); pivot.position.y = PL - 0.07 + fr; pole.add(pivot); pivot.add(cloth);
  const P = cg.attributes.position;
  const grid = []; for (let i = 0; i < P.count; i++) grid.push([P.getX(i) + (W + fr) / 2, (H + 2 * fr) / 2 - P.getY(i)]);   // [s along the fly, h down the hoist]
  function update(t = 0, st = {}) {
    U.snow.value = clamp(st.snow ?? 0);
    const wd = st.wind, k = clamp(typeof wd === 'number' ? wd : wd ? (wd.strength ?? 1) : 0.3, 0, 1.5);
    const dir = typeof wd === 'object' && wd ? V3(wd.x ?? 1, 0, wd.z ?? 0).normalize() : V3(1, 0, 0);
    group.updateMatrixWorld(true);
    const pq = pole.getWorldQuaternion(new THREE.Quaternion()).invert(), wl = dir.clone().applyQuaternion(pq);
    pivot.rotation.y = Math.atan2(-wl.z, wl.x);
    const th = lerp(0.62, 1.42, clamp(k)), sT = Math.sin(th), cT = Math.cos(th), om = TAU * (0.55 + 1.1 * k), kap = TAU / 0.95;
    for (let i = 0; i < P.count; i++) {
      const [s, h] = grid[i], f = s / (W + fr);
      const A = (0.012 + (0.035 + 0.11 * k) * f ** 1.15), ph = om * t - kap * s + 1.3 * h;
      const z = A * Math.sin(ph) + 0.42 * A * Math.sin(1.73 * om * t - 1.9 * kap * s - 0.8 * h + 1.1) + 0.02 * k * f * f * Math.sin(3.1 * om * t - 4 * kap * s + 2.2 * h);
      const sag = (1 - clamp(k)) * 0.08 * f * f;
      P.setXYZ(i, 0.02 + s * sT - 0.12 * A * f, -h - s * cT - sag + 0.25 * A * Math.sin(0.8 * om * t - 0.7 * kap * s + 2 * h), z);
    }
    P.needsUpdate = true; cg.computeVertexNormals();
  }
  // carry(fig, 'upright' | 'shoulder'): parent the flag to the bearer's chest and put both hands (or the right) on the pole
  function carry(fig, mode = 'upright') {
    const B = fig.bones; B.chest.add(group);
    fig.held.length = 0;
    if (mode === 'shoulder') {
      group.position.set(-0.095, -0.37, 0.52); group.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(-0.08, 0.62, -0.78).normalize());
      fig.held.push({ r: { obj: pole, p: [0, 0.46, 0], fingers: [0.35, 0.1, 0.93], palm: [1, 0, -0.1], pole: [-0.8, -0.6, -0.2] } });
      fig.pose({ ...fig.getPose(), armSwing: [1, 0], weapon: null, rShape: 'grip' });
    } else {
      group.position.set(0.0, -0.66, 0.29); group.rotation.set(0.07, 0, 0.05);
      fig.held.push({ r: { obj: pole, p: [0, 0.62, 0], fingers: [0.15, 0.05, 1], palm: [1, 0, 0], pole: [-0.8, -0.6, -0.4] }, l: { obj: pole, p: [0, 0.34, 0], fingers: [-0.15, -0.05, 1], palm: [-1, 0, 0], pole: [0.8, -0.6, -0.4] } });
      fig.pose({ ...fig.getPose(), armSwing: [0, 0], weapon: null, lShape: 'grip', rShape: 'grip' });
    }
    return api;
  }
  const api = { group, pole, cloth, update, carry };
  update(0, { wind: 0.5 });
  return api;
}

// ── poses ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// angles in radians (person() conventions: negative X = limb forward; elbows negative, knees positive). lHand/rHand:
// IK grip targets {space: 'chest'|'root'|'head'|'pelvis', p: [x,y,z] metres, fingers: [..], palm: [..], pole: [..]}
export const POSES = {
  stand: { lArmZ: 0.08, rArmZ: -0.08, lElbow: -0.16, rElbow: -0.16, weapon: 'sling' },
  attention: { lArmZ: 0.02, rArmZ: -0.02, lElbow: -0.04, rElbow: -0.04, chestX: -0.05, headX: -0.03, lLegY: 0.32, rLegY: -0.32, lShape: 'fist', rShape: 'fist', lWristY: -0.2, rWristY: 0.2, weapon: 'sling' },
  walk: { lean: 0.035, headX: 0.03, lElbow: -0.22, rElbow: -0.22, lArmZ: 0.07, rArmZ: -0.07, weapon: 'sling' },
  salute: { chestX: -0.04, headX: -0.03, lArmZ: 0.02, lElbow: -0.04, lShape: 'fist', lLegY: 0.3, rLegY: -0.3, rShape: 'flat', weapon: 'sling',
    rHand: { space: 'head', p: [-0.085, 0.1, 0.105], fingers: [0.62, 0.62, 0.3], palm: [0.25, -0.55, -0.8], pole: [-1, -0.25, 0.1] } },
  hold_paper: { headX: 0.36, chestX: 0.04, lShape: 'sheet', rShape: 'sheet', weapon: 'sling', armSwing: [0, 0],
    lHand: { space: 'chest', p: [0.125, -0.04, 0.3], fingers: [-0.1, 0.45, 0.9], palm: [-0.98, 0.0, 0.15], pole: [0.8, -0.8, -0.3] },
    rHand: { space: 'chest', p: [-0.125, -0.04, 0.3], fingers: [0.1, 0.45, 0.9], palm: [0.98, 0.0, 0.15], pole: [-0.8, -0.8, -0.3] } },
  laugh: { headX: -0.62, headZ: 0.08, chestX: -0.12, spineX: -0.05, lShrug: 0.18, rShrug: 0.2, lArmZ: 0.22, lElbow: -0.45, lShape: 'soft', rShape: 'soft', rFree: true,
    rHand: { space: 'chest', p: [-0.015, -0.18, 0.165], fingers: [0.95, -0.28, 0.12], palm: [0, 0.12, -1], pole: [-0.9, -0.5, -0.2] } },
  point: { rArmX: -1.5, rArmZ: -0.1, rArmY: 0.1, rElbow: -0.06, rShape: 'point', chestY: -0.1, headY: -0.12, rFree: true, weapon: 'sling' },
  carry_flag: { lShape: 'grip', rShape: 'grip', armSwing: [0, 0], weapon: null, lean: 0.02 },
  rifle_ready: { weapon: 'aim', lShape: 'grip', rShape: 'grip', turn: -0.3, chestY: -0.32, chestX: 0.08, lean: 0.05, headY: 0.52, headX: 0.32, headZ: -0.24, lLeg: -0.14, rLeg: 0.12, lKnee: 0.1, rKnee: 0.04, lLegY: 0.45, rLegY: 0.05, armSwing: [0, 0] },
  sit_foxhole: { plant: false, holeDepth: 1.1, lean: 0.12, spineX: 0.1, chestX: 0.12, headX: -0.2, lLeg: -0.1, rLeg: -0.1, lKnee: 0.0, rKnee: 0.0, weapon: 'parapet', lShape: 'grip', rShape: 'grip' },
  crouch: { drop: 0.42, lean: 0.35, chestX: 0.15, headX: -0.3, lLeg: -1.55, lKnee: 1.95, lFoot: -0.35, rLeg: -0.45, rKnee: 2.2, rFoot: 0.55, rToe: -0.9, weapon: 'port', lShape: 'grip', rShape: 'grip' },
  shiver: { lShrug: 0.22, rShrug: 0.22, headX: 0.22, chestX: 0.12, lKnee: 0.08, rKnee: 0.08, lLeg: -0.06, rLeg: -0.06, lShape: 'soft', rShape: 'soft', rFree: true, weapon: 'sling',
    lHand: { space: 'chest', p: [-0.175, 0.02, 0.1], fingers: [-0.25, -0.35, -0.9], palm: [-0.8, 0, 0.5], pole: [0.5, -0.8, -0.4] },
    rHand: { space: 'chest', p: [0.17, -0.04, 0.12], fingers: [0.25, -0.3, -0.9], palm: [0.8, 0, 0.5], pole: [-0.5, -0.8, -0.4] } },
  seated: { plant: false, drop: 0.4, lean: -0.06, lLeg: -1.5, rLeg: -1.44, lKnee: 1.45, rKnee: 1.35, lLegY: 0.12, rLegY: -0.12, lFoot: 0.05, rFoot: 0.1, weapon: null,
    lHand: { space: 'root', p: [0.19, 0.78, 0.4], fingers: [-0.25, -0.08, 1], palm: [0, -1, 0], pole: [0.8, -0.5, -0.5] },
    rHand: { space: 'root', p: [-0.19, 0.78, 0.4], fingers: [0.25, -0.08, 1], palm: [0, -1, 0], pole: [-0.8, -0.5, -0.5] } },
};
POSES.seated_laugh = { ...POSES.seated, ...POSES.laugh, lHand: POSES.seated.lHand, lElbow: -0.5, lShape: 'relaxed' };
POSES.watch = { headX: 0.05, headY: 0.08, lArmZ: 0.05, rArmZ: -0.05, lElbow: -0.1, rElbow: -0.1, lShape: 'soft', rShape: 'soft', lLegY: 0.12, rLegY: -0.2, rKnee: 0.06, weapon: null };

// a plain wooden kitchen chair for the cellar (seat top 0.46 m, facing +Z like the figures)
export function chair(o = {}) {
  const U = { snow: { value: 0 } }, wood = makeMat(U, 'wood', o.color ?? 0x6E4A2E, { roughness: 0.7 }, 0);
  const G = new THREE.Group(), sh = 0.46;
  const add = (g) => { const m = new THREE.Mesh(g, wood); m.castShadow = m.receiveShadow = true; G.add(m); };
  add(rbox(0.44, 0.03, 0.42, 0.006).translate(0, sh - 0.015, 0));
  for (const [x, z] of [[-0.19, 0.18], [0.19, 0.18], [-0.19, -0.18], [0.19, -0.18]]) add(rbox(0.035, sh - 0.03, 0.035, 0.005).translate(x, (sh - 0.03) / 2, z));
  for (const x of [-0.19, 0.19]) add(rbox(0.035, 0.46, 0.035, 0.005).translate(x, sh + 0.23, -0.19));
  add(rbox(0.42, 0.07, 0.025, 0.006).translate(0, sh + 0.4, -0.19)); add(rbox(0.42, 0.05, 0.02, 0.006).translate(0, sh + 0.2, -0.19));
  return { group: G, seatHeight: sh };
}

// ── f3d: internals for the costume system (kits.js), crowds (crowd.js) and the cast (cast.js) ─────────────────────────
export {
  TAU, clamp, lerp, sstep, V3, TEX, canvas, normalTex, greyTex, finishTex, clothTex, makeMat, snowPatch, jitter,
  loft, cap, merge, tube, path, sphereG, cylG, rod, rbox, xf, Kit, W1, blend2, J, makeRig, propBone, HAND, setHand,
  twoBone, setWorldRot, setWorld, makeFigure, refOf, buildHead, buildHands, ringPt, rowAt, torsoWeights, buildTorso,
  buildSkirt, buildSleeves, buildLegs, buildBoots, button, surfNormal, band, strap, addBone, domeRows, buildM1, buildSchirm,
  buildM43, buildM42, on, placeBox, buildGIKit, buildGerKit, buildOffKit, stock, WEAPON, buildWeapon, CARRY, weaponPlacer,
  buildCase, buildCollar, buildScarfGI, shoulderStraps, assemble, OVERCOAT, GREATCOAT, M43, coatDetails, WITNESS_TORSO,
  scarfTail,
};
