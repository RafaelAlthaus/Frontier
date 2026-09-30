// fallback.js — tiny built-in builders so the pipeline runs end to end before (or without) lib/nature and lib/human:
//   world  'core.plain'       gentle plain with far hills, road/ridge features, optional flat water
//   cast   'core.mannequin'   faceless mannequin coloured from the CastDef (the Witness: white + mustard scarf)
//   groups 'core.crowd'       instanced mannequins in column/line/square/crowd/scatter, marching along the heading
//   objects 'core.box'        a crate / vehicle-sized box (drives along its heading with `speed`)
//   structures 'core.block' | 'core.arch' | 'core.town'
//   labels 'core.label'       monumental 3D letters (text3d) in stone/bronze/gold/clay/neon/ice, rising in and out
// They follow the same builder contract as the libraries (build(kind, item, ctx) -> {root, radius, height, update}).
import * as THREE from 'three';
import * as TX from '../lib/shared/textures.js';
import { rng, makeNoise, clamp, smooth, lerp, deg } from '../lib/shared/util.js';
import { textLetters } from '../lib/shared/text3d.js';

export const CATALOG = {
  'core.plain': { desc: 'Fallback world: open plain with gentle relief and far hills (features: road, ridge)', section: 'world', tags: ['plain', 'field', 'grass', 'meadow', 'steppe', 'farmland', 'fallback'], core: true },
  'core.mannequin': { desc: 'Faceless white mannequin (cast fallback)', section: 'cast', actions: ['idle', 'watch', 'walk', 'point'], footprint: [0.6, 0.4], height: 1.8, tags: ['figure', 'person', 'man', 'woman', 'soldier', 'mannequin', 'fallback'], core: true },
  'core.crowd': { desc: 'Group of faceless mannequins in a formation', section: 'groups', actions: ['idle', 'march', 'walk'], params: { formation: 'column|line|square|crowd|scatter' }, height: 1.8, tags: ['figure', 'soldier', 'crowd', 'people', 'troops', 'army', 'group', 'fallback'], core: true },
  'core.box': { desc: 'Neutral box prop (object fallback)', section: 'objects', actions: ['idle', 'drive'], footprint: [2, 2], height: 1.5, tags: ['object', 'prop', 'crate', 'vehicle', 'box', 'fallback'], core: true },
  'core.block': { desc: 'Plain gabled building block', section: 'structures', footprint: [10, 8], height: 9, tags: ['building', 'house', 'structure', 'fallback'], core: true },
  'core.arch': { desc: 'Stone arch to fly through (anchors.opening)', section: 'structures', footprint: [14, 4], height: 14, tags: ['arch', 'gate', 'door', 'opening', 'monument', 'fallback'], core: true },
  'core.town': { desc: 'Cluster of plain building blocks', section: 'structures', params: { size: 'small|medium|large' }, tags: ['town', 'village', 'city', 'settlement', 'fallback'], core: true },
  'core.label': { desc: 'Monumental 3D lettering', section: 'labels', params: { style: 'stone|bronze|gold|clay|neon|ice' }, tags: ['label', 'text', 'title', 'fallback'], core: true },
};

const WITNESS = { id: 'witness', name: 'The Witness', kit: 'modern_casual', colors: { coat: '#EDEBE4', trousers: '#E4E1D8', accent: '#D6A020' }, accessories: ['scarf'], build: { height: 1.8, bulk: 1 } };
export const BUILTIN_CAST = { witness: WITNESS };

// ── world ────────────────────────────────────────────────────────────────────────────────────────────────────────
function axisCoords(inner = 240, step0 = 2.5, grow = 1.055, outer = 14000) {
  const a = [0]; let x = 0, st = step0;
  while (x < outer) { x += st; a.push(x); if (x > inner) st *= grow; }
  return [...a.slice(1).reverse().map((v) => -v), ...a];
}
function bsearch(arr, v) { let lo = 0, hi = arr.length - 1; if (v <= arr[0]) return 0; if (v >= arr[hi]) return hi - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m; else hi = m; } return lo; }

export async function buildWorld(world, look, ctx) {
  const seed = world.seed ?? 7, relief = clamp(world.relief ?? 0.3, 0, 1.5);
  const N = makeNoise(seed * 13 + 1);
  const feats = Array.isArray(world.features) ? world.features : [];
  const roads = feats.filter((f) => f.type === 'road' && f.from && f.to);
  const ridges = feats.filter((f) => f.type === 'ridge' && f.at);
  const water = world.water && world.water.kind && world.water.kind !== 'none' ? world.water : null;
  const segDist = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1; const u = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2); const px = a[0] + dx * u - x, pz = a[1] + dz * u - z; return Math.hypot(px, pz); };
  const raw = (x, z) => {
    const r = Math.hypot(x, z);
    let h = relief * (7 * N.fbm2(x / 260, z / 260, 4) + 2.2 * N.fbm2(x / 70, z / 70, 3));
    h *= 0.25 + 0.75 * smooth((r - 25) / 140);                                        // the stage is level
    h += relief * 70 * smooth((r - 700) / 2600) * (0.55 + 0.45 * N.ridge2(x / 1800, z / 1800, 3));   // far hills
    for (const f of ridges) { const d = Math.hypot(x - f.at[0], z - f.at[1]); h += (f.height ?? 30) * Math.exp(-(d * d) / (2 * Math.pow(f.width ?? Math.max(60, (f.height ?? 30) * 3), 2))); }
    for (const rd of roads) { const d = segDist(x, z, rd.from, rd.to); const k = 1 - smooth((d - 3) / 10); h = lerp(h, h * 0.35, k); }
    if (water) { const lv = water.level ?? 0; if (water.kind === 'ocean' || water.kind === 'lake') { const c = water.at ?? [0, water.kind === 'ocean' ? -900 : -260]; const d = Math.hypot(x - c[0], z - c[1]); const R = water.radius ?? (water.kind === 'ocean' ? 700 : 160); h = lerp(h, lv - 6, 1 - smooth((d - R * 0.8) / (R * 0.5))); } }
    return h;
  };
  const xs = axisCoords(), zs = xs, nx = xs.length, nz = zs.length;
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = raw(xs[i], zs[j]);
  // the rendered surface: two triangles per cell (a,b,d)+(b,c,d) with a=(i,j) b=(i+1,j) c=(i+1,j+1) d=(i,j+1)
  const height = (x, z) => {
    const i = bsearch(xs, x), j = bsearch(zs, z);
    const fx = clamp((x - xs[i]) / (xs[i + 1] - xs[i])), fz = clamp((z - zs[j]) / (zs[j + 1] - zs[j]));
    const a = H[j * nx + i], b = H[j * nx + i + 1], c = H[(j + 1) * nx + i + 1], d = H[(j + 1) * nx + i];
    return fx + fz <= 1 ? a + (b - a) * fx + (d - a) * fz : c + (d - c) * (1 - fx) + (b - c) * (1 - fz);
  };
  const normal = (x, z) => { const e = 0.5; const v = new THREE.Vector3(height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)); return v.normalize().toArray(); };

  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
  const season = world.season ?? 'summer';
  const base = { summer: [0.42, 0.5, 0.26], spring: [0.45, 0.56, 0.28], autumn: [0.56, 0.47, 0.26], winter: [0.86, 0.88, 0.9], dry: [0.66, 0.56, 0.38] }[season] || [0.42, 0.5, 0.26];
  const dirt = [0.45, 0.38, 0.29];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = xs[i], z = zs[j];
    pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;
    uv[k * 2] = x / 9; uv[k * 2 + 1] = z / 9;
    const n = N.fbm2(x / 45, z / 45, 3) * 0.5 + 0.5;
    let c = base.map((v, q) => v * (0.82 + 0.3 * n));
    for (const rd of roads) { const d = segDist(x, z, rd.from, rd.to); const kk = 1 - smooth((d - 2.2) / 2.5); c = c.map((v, q) => lerp(v, dirt[q] * (season === 'winter' ? 1.5 : 1), kk)); }
    col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = (j + 1) * nx + i + 1, d = (j + 1) * nx + i;
    idx[q++] = a; idx[q++] = d; idx[q++] = b; idx[q++] = b; idx[q++] = d; idx[q++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  const gt = ctx.cache.get('core.groundTex') || (() => { const t = TX.ground(512); ctx.cache.set('core.groundTex', t); return t; })();
  const mat = ctx.patch(new THREE.MeshStandardMaterial({ map: gt.map, normalMap: gt.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.35, color: 0xd8d8d8 }));
  const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.name = 'ground'; mesh.userData.noQA = true; mesh.userData.ground = true;
  ctx.scene.add(mesh);
  let wmesh = null;
  if (water) {
    const wm = ctx.patch(new THREE.MeshStandardMaterial({ color: 0x2a3a40, roughness: 0.08, metalness: 0.0, envMapIntensity: 1.2 }));
    wmesh = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2), wm);
    wmesh.position.y = water.level ?? 0; wmesh.name = 'water'; wmesh.userData.noQA = true; wmesh.receiveShadow = true;
    ctx.scene.add(wmesh);
  }
  return { ground: { height, normal }, water: water ? { kind: water.kind, level: water.level ?? 0 } : null, update() {}, root: mesh };
}

// ── mannequin parts (shared geometry) ────────────────────────────────────────────────────────────────────────────
function parts(ctx) {
  let p = ctx.cache.get('core.mannequinGeo');
  if (p) return p;
  p = {
    torso: new THREE.CapsuleGeometry(0.17, 0.42, 6, 14).translate(0, 1.22, 0),
    hips: new THREE.CapsuleGeometry(0.155, 0.12, 6, 12).translate(0, 0.94, 0),
    head: new THREE.SphereGeometry(0.115, 20, 16).scale(0.92, 1.12, 1.0).translate(0, 1.66, 0),
    neck: new THREE.CylinderGeometry(0.05, 0.06, 0.12, 10).translate(0, 1.52, 0),
    leg: new THREE.CapsuleGeometry(0.07, 0.72, 5, 10).translate(0, -0.43, 0),       // hangs from the hip joint
    arm: new THREE.CapsuleGeometry(0.052, 0.56, 5, 10).translate(0, -0.33, 0),      // hangs from the shoulder
    scarf: new THREE.TorusGeometry(0.085, 0.035, 8, 20).rotateX(Math.PI / 2).translate(0, 1.5, 0),
    body: null,
  };
  // one merged body for crowds: torso+hips+neck+head+legs+arms at rest
  const rest = [p.torso, p.hips, p.neck, p.head,
    p.leg.clone().translate(-0.09, 0.9, 0), p.leg.clone().translate(0.09, 0.9, 0),
    p.arm.clone().rotateZ(0.08).translate(-0.24, 1.42, 0), p.arm.clone().rotateZ(-0.08).translate(0.24, 1.42, 0)];
  p.body = mergeGeos(rest);
  ctx.cache.set('core.mannequinGeo', p);
  return p;
}
function mergeGeos(list) {
  const gs = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of gs) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), Nn = new Float32Array(n * 3); let o = 0;
  for (const g of gs) { P.set(g.attributes.position.array, o * 3); Nn.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
const mcache = new Map();
function mat(ctx, hex, o = {}) {
  const k = hex + JSON.stringify(o);
  if (!mcache.has(k)) mcache.set(k, ctx.patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: o.r ?? 0.62, metalness: o.m ?? 0, envMapIntensity: o.env ?? 0.6, emissive: o.e ? new THREE.Color(o.e) : undefined, emissiveIntensity: o.ei ?? 0 })));
  return mcache.get(k);
}

function placeRoot(root, item, ctx) {
  const [x, z] = item.at; root.position.set(x, ctx.ground.height(x, z) + (item.y ?? 0), z);
  root.rotation.y = -(item.heading ?? 0) * deg;
}
const headingVec = (h) => [Math.sin(h * deg), -Math.cos(h * deg)];

function buildMannequin(item, ctx) {
  const P = parts(ctx), def = item.def || {};
  const C = def.colors || {};
  const coat = C.coat || '#EDEBE4', trousers = C.trousers || C.coat || '#E4E1D8', skin = '#F2F0EA';
  const sc = (def.build?.height ?? 1.8) / 1.8, bulk = def.build?.bulk ?? 1;
  const root = new THREE.Group(); root.name = 'mannequin:' + (def.id || item.ref || 'figure');
  const body = new THREE.Group(); body.scale.set(sc * bulk, sc, sc * bulk); root.add(body);
  const mk = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; return o; };
  body.add(mk(P.torso, mat(ctx, coat)), mk(P.hips, mat(ctx, trousers)), mk(P.neck, mat(ctx, skin)), mk(P.head, mat(ctx, skin, { r: 0.45 })));
  const hipL = new THREE.Group(), hipR = new THREE.Group(); hipL.position.set(-0.09, 0.9, 0); hipR.position.set(0.09, 0.9, 0);
  hipL.add(mk(P.leg, mat(ctx, trousers))); hipR.add(mk(P.leg, mat(ctx, trousers)));
  const shL = new THREE.Group(), shR = new THREE.Group(); shL.position.set(-0.24, 1.42, 0); shR.position.set(0.24, 1.42, 0);
  shL.add(mk(P.arm, mat(ctx, coat))); shR.add(mk(P.arm, mat(ctx, coat)));
  body.add(hipL, hipR, shL, shR);
  const acc = def.accessories || [];
  if (acc.includes('scarf') || def.id === 'witness') body.add(mk(P.scarf, mat(ctx, C.accent || '#D6A020', { r: 0.8 })));
  placeRoot(root, item, ctx);
  const [hx, hz] = headingVec(item.heading ?? 0), x0 = item.at[0], z0 = item.at[1];
  const action = item.action || 'idle', speed = item.speed ?? (action === 'walk' ? 1.3 : 0);
  const pointAt = item.pointT ?? 0.6;
  return {
    root, radius: 0.4 * sc, height: 1.8 * sc, figure: true,
    update(t) {
      const walk = action === 'walk' || action === 'march';
      if (walk && speed > 0) { const d = speed * t; root.position.x = x0 + hx * d; root.position.z = z0 + hz * d; }
      const ph = t * (walk ? 1.9 * Math.max(0.6, speed / 1.3) : 0) * Math.PI * 2;
      const sw = walk ? 0.42 : 0;
      hipL.rotation.x = Math.sin(ph) * sw; hipR.rotation.x = -Math.sin(ph) * sw;
      shL.rotation.x = -Math.sin(ph) * sw * 0.8; shR.rotation.x = Math.sin(ph) * sw * 0.8;
      const breathe = Math.sin(t * 1.6 + (item.index ?? 0)) * 0.01;
      body.position.y = walk ? Math.abs(Math.sin(ph)) * 0.035 : breathe;
      if (action === 'point') { const k = smooth((t - pointAt) / 1.0); shR.rotation.x = -1.45 * k; shR.rotation.z = 0.12 * k; }
      if (action === 'watch') body.rotation.y = Math.sin(t * 0.25) * 0.12;
    },
  };
}

// formation offsets (local: +x right, -z forward) for count members
function formation(kind, count, size, r) {
  const out = [], [W, L] = size || [8, 30];
  if (kind === 'column' || kind === 'line') {
    const cols = kind === 'column' ? Math.max(1, Math.min(6, Math.round(W / 1.2))) : Math.max(1, Math.ceil(count / Math.max(1, Math.round(L / 1.4 / 2))));
    const rows = Math.ceil(count / cols);
    const dx = kind === 'column' ? W / Math.max(1, cols) : 1.3, dz = kind === 'column' ? Math.max(1.2, L / Math.max(1, rows)) : 1.6;
    for (let k = 0; k < count; k++) { const c = k % cols, rr = Math.floor(k / cols); out.push([(c - (cols - 1) / 2) * dx + (r() - 0.5) * 0.15, (rr - (rows - 1) / 2) * dz + (r() - 0.5) * 0.2]); }
    if (kind === 'line') out.forEach((p) => { const t = p[0]; p[0] = p[1]; p[1] = t; });
  } else if (kind === 'square') {
    const n = Math.ceil(Math.sqrt(count)); const d = Math.max(1.2, W / n);
    for (let k = 0; k < count; k++) out.push([((k % n) - (n - 1) / 2) * d, (Math.floor(k / n) - (n - 1) / 2) * d]);
  } else {
    const R = Math.max(W, L) / 2, tight = kind === 'crowd' ? 0.9 : 2.2;
    let tries = 0;
    while (out.length < count && tries++ < count * 60) {
      const a = r() * Math.PI * 2, rr = R * Math.sqrt(r()); const p = [Math.cos(a) * rr, Math.sin(a) * rr];
      if (out.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > tight)) out.push(p);
    }
  }
  return out;
}

function buildCrowd(item, ctx) {
  const P = parts(ctx), r = rng((item.seed ?? 5) * 31 + (item.index ?? 0));
  const count = clamp(Math.round(item.count ?? 12), 1, 2000);
  const offs = formation(item.formation || 'crowd', count, item.size, r);
  const root = new THREE.Group(); root.name = 'crowd:' + item.kind;
  placeRoot(root, item, ctx);
  const col = item.colors?.coat || item.color || (item.kind && /soldier|troop|army|1944|ww/.test(item.kind) ? '#6B6A4E' : '#E9E6DE');
  const im = new THREE.InstancedMesh(P.body, mat(ctx, col), offs.length); im.castShadow = im.receiveShadow = true; im.name = 'crowd-bodies';
  root.add(im);
  const [hx, hz] = headingVec(item.heading ?? 0);
  const action = item.action || 'idle';
  const speed = item.speed ?? (action === 'march' || action === 'walk' ? 1.4 : 0);
  const x0 = item.at[0], z0 = item.at[1], rot = -(item.heading ?? 0) * deg, cr = Math.cos(rot), sr = Math.sin(rot);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const members = (t) => {
    const d = speed * t, cx = x0 + hx * d, cz = z0 + hz * d;
    return offs.map(([ox, oz]) => [cx + ox * cr + oz * sr, cz - ox * sr + oz * cr]);
  };
  const res = {
    root, radius: Math.max(2, ...offs.map(([a, b]) => Math.hypot(a, b))) + 0.5, height: 1.85, figure: true, members, snapped: true,
    update(t) {
      const M = members(t), d = speed * t;
      root.position.set(x0 + hx * d, 0, z0 + hz * d);
      root.updateMatrixWorld();
      for (let k = 0; k < M.length; k++) {
        const [x, z] = M[k];
        const bob = speed > 0 ? Math.abs(Math.sin((t * 1.9 + k * 0.37) * Math.PI * 2)) * 0.03 : 0;
        const y = ctx.ground.height(x, z) + bob;
        // local offset relative to the root (the root carries position + heading)
        v.set(offs[k][0], y, offs[k][1]);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(t * 0.3 + k) * 0.05);
        m4.compose(v, q, s1); im.setMatrixAt(k, m4);
      }
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    },
  };
  res.update(0);
  return res;
}

// a merged gabled house block; w x d footprint, h wall height
function houseGeo(w, d, h) {
  const box = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const roofH = Math.min(w, d) * 0.45;
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.3, 0), new THREE.Vector2(w / 2 + 0.3, 0), new THREE.Vector2(0, roofH)]);
  const roof = new THREE.ExtrudeGeometry(shape, { depth: d + 0.6, bevelEnabled: false }).translate(0, h, -d / 2 - 0.3);
  return { walls: box, roof };
}
function buildBlock(item, ctx, o = {}) {
  const r = rng((item.seed ?? 3) + (item.index ?? 0) * 7);
  const S = { small: 0.75, medium: 1, large: 1.4 }[item.size] ?? 1;
  const w = (o.w ?? 8 + r() * 6) * S, d = (o.d ?? 7 + r() * 4) * S, h = (o.h ?? 6 + r() * 5) * S;
  const G = houseGeo(w, d, h);
  const root = new THREE.Group(); root.name = 'block';
  const wall = new THREE.Mesh(G.walls, mat(ctx, ['#CFC6B4', '#BDB3A0', '#D8D0C0', '#B8AE9C'][Math.floor(r() * 4)], { r: 0.9 }));
  const roof = new THREE.Mesh(G.roof, mat(ctx, ['#7A4A36', '#5E4A42', '#6E3E2E'][Math.floor(r() * 3)], { r: 0.8 }));
  wall.castShadow = wall.receiveShadow = roof.castShadow = roof.receiveShadow = true;
  root.add(wall, roof);
  // sink the foot into slopes so nothing floats
  wall.position.y = roof.position.y = -0.6;
  placeRoot(root, item, ctx);
  return { root, radius: Math.hypot(w, d) / 2, height: h + Math.min(w, d) * 0.45, footprint: [w, d], update() {} };
}
function buildArch(item, ctx) {
  const S = { small: 0.7, medium: 1, large: 1.5 }[item.size] ?? 1;
  const W = 12 * S, Hh = 13 * S, T = 3 * S, pw = 3 * S, open = W - 2 * pw, lint = 3 * S;
  const root = new THREE.Group(); root.name = 'arch';
  const m = mat(ctx, '#C9BFAE', { r: 0.85 });
  const mk = (g, x, y) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, 0); o.castShadow = o.receiveShadow = true; root.add(o); return o; };
  mk(new THREE.BoxGeometry(pw, Hh - lint + 0.6, T), -(open / 2 + pw / 2), (Hh - lint) / 2 - 0.3);
  mk(new THREE.BoxGeometry(pw, Hh - lint + 0.6, T), open / 2 + pw / 2, (Hh - lint) / 2 - 0.3);
  mk(new THREE.BoxGeometry(W + 0.8, lint, T + 0.4), 0, Hh - lint / 2);
  placeRoot(root, item, ctx);
  const h = item.heading ?? 0, [fx, fz] = headingVec(h);
  const base = root.position.y;
  return {
    root, radius: W / 2, height: Hh, footprint: [W, T], update() {},
    anchors: { opening: { pos: [item.at[0], base + (Hh - lint) * 0.5, item.at[1]], normal: [fx, 0, fz], w: open, h: Hh - lint } },
  };
}
function buildTown(item, ctx) {
  const r = rng((item.seed ?? 11) * 5 + 3);
  const n = { small: 9, medium: 18, large: 32 }[item.size] ?? 14, R = { small: 45, medium: 70, large: 110 }[item.size] ?? 60;
  const root = new THREE.Group(); root.name = 'town';
  const pts = [];
  let tries = 0;
  while (pts.length < n && tries++ < n * 40) {
    const a = r() * Math.PI * 2, d = R * Math.sqrt(r()), p = [item.at[0] + Math.cos(a) * d, item.at[1] + Math.sin(a) * d];
    if (pts.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 15)) pts.push(p);
  }
  let maxH = 0;
  pts.forEach((p, i) => {
    const b = buildBlock({ at: p, heading: (item.heading ?? 0) + Math.round(r() * 3) * 90 + (r() - 0.5) * 12, seed: i * 3 + 1, index: i, size: 'medium' }, ctx);
    b.root.position.sub(new THREE.Vector3(item.at[0], 0, item.at[1]));
    maxH = Math.max(maxH, b.height); root.add(b.root);
  });
  root.position.set(item.at[0], 0, item.at[1]);
  return { root, radius: R + 10, height: maxH, update() {}, snapped: true };
}
function buildBox(item, ctx) {
  const fp = item.footprint || [2, 2], h = item.height ?? 1.5;
  const root = new THREE.Group(); root.name = 'box:' + item.kind;
  const g = new THREE.BoxGeometry(fp[1] ?? fp[0], h, fp[0]).translate(0, h / 2, 0);
  const o = new THREE.Mesh(g, mat(ctx, item.color || '#8A7A5E', { r: 0.75 })); o.castShadow = o.receiveShadow = true; root.add(o);
  placeRoot(root, item, ctx);
  const [hx, hz] = headingVec(item.heading ?? 0), x0 = item.at[0], z0 = item.at[1];
  const speed = item.action === 'drive' || item.action === 'move' ? (item.speed ?? 5) : 0;
  return {
    root, radius: Math.hypot(...fp) / 2, height: h,
    update(t) {
      if (!speed) return;
      // ease in over the first second so a vehicle never jumps from rest
      const d = speed * (t > 1 ? t - 0.5 : t * t * 0.5);
      root.position.x = x0 + hx * d; root.position.z = z0 + hz * d;
    },
  };
}

// ── labels ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const LABEL_STYLES = {
  stone: { font: 'Cinzel', weight: 700, color: '#D9D2C3', r: 0.82, m: 0 },
  bronze: { font: 'Cinzel', weight: 700, color: '#8C5A2B', r: 0.36, m: 1, env: 1.1 },
  gold: { font: 'Cinzel', weight: 700, color: '#D8A845', r: 0.24, m: 1, env: 1.25 },
  clay: { font: 'EB Garamond', weight: 700, color: '#B0613E', r: 0.9, m: 0 },
  neon: { font: 'Inter Display', weight: 900, color: '#FF6A3A', r: 0.4, m: 0, e: '#FF5A2A', ei: 3.2 },
  ice: { font: 'Inter Display', weight: 900, color: '#CFE6F2', r: 0.12, m: 0.1, env: 1.6, e: '#6FA8C8', ei: 0.25 },
};
function buildLabel(item, ctx) {
  const st = LABEL_STYLES[item.style] || LABEL_STYLES.stone;
  const H = clamp(item.height ?? 12, 0.3, 200);
  const m = mat(ctx, st.color, { r: st.r, m: st.m, env: st.env ?? 0.8, e: st.e, ei: st.ei });
  const root = new THREE.Group(); root.name = 'label:' + item.text;
  // monumental tracking (~0.16 em): the letters stand apart, and a camera can fly between them
  const main = textLetters(String(item.text || 'TITLE').toUpperCase(), { font: `${st.weight} 256px ${JSON.stringify(st.font)}`, height: H, depth: H * 0.22, material: m, bevel: 0.03, letterSpacing: item.tracking ?? 40 });
  root.add(main);
  const letters = [...main.children];
  let sub = null;
  if (item.sub) {
    sub = textLetters(String(item.sub).toUpperCase(), { font: `600 256px "Inter"`, height: H * 0.26, depth: H * 0.08, material: m, bevel: 0.02, letterSpacing: 18 });
    sub.position.set(0, -H * 0.62, H * 0.05);
    // the sub line stands on its own plinth-less baseline below the title: lift the whole title instead
    main.position.y = H * 0.62;
    sub.position.y = 0;
    root.add(sub);
    letters.push(...sub.children);
  }
  for (const l of letters) { l.castShadow = l.receiveShadow = true; l.userData.baseY = l.position.y; }
  placeRoot(root, item, ctx);
  // a label's heading is the compass direction its readable face looks toward (text front = local +Z)
  root.rotation.y = Math.PI - (item.heading ?? 180) * deg;
  const [t0, t1] = Array.isArray(item.t) ? item.t : [0, 1e9];
  const width = Math.max(main.userData.width, sub ? sub.userData.width : 0);
  const totalH = H * (sub ? 1.62 : 1);
  const res = {
    root, radius: width / 2, height: totalH, label: true, width,
    update(t) {
      // letters rise out of the ground one after another over ~1.2 s, and sink the same way after t1
      letters.forEach((l, i) => {
        const kin = smooth((t - t0 - i * 0.05) / 1.2), kout = 1 - smooth((t - t1 - i * 0.03) / 1.0);
        const k = Math.min(kin, kout);
        l.position.y = l.userData.baseY - (1 - k) * (totalH + 1);
        l.visible = k > 0.001;
      });
    },
  };
  res.update(0);
  return res;
}

export async function build(kind, item, ctx) {
  switch (kind) {
    case 'core.mannequin': return buildMannequin(item, ctx);
    case 'core.crowd': return buildCrowd(item, ctx);
    case 'core.box': return buildBox(item, ctx);
    case 'core.block': return buildBlock(item, ctx);
    case 'core.arch': return buildArch(item, ctx);
    case 'core.town': return buildTown(item, ctx);
    case 'core.label': return buildLabel(item, ctx);
    default: return buildBox(item, ctx);
  }
}
