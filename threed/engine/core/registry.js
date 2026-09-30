// registry.js — finds every builder the scene spec can ask for and builds the scene with them.
//   * loads lib/nature/index.js, lib/human/index.js and lib/fx/index.js (`export const MODULES = [...]`, paths relative to the index),
//     tolerating "not there yet" and broken modules (warned, never fatal); core/fallback.js is always present
//   * merges every module's CATALOG into one table: kind -> {entry, module, lib}
//   * resolves the spec sections world / cast / groups / objects / structures / labels to builders; an unknown kind
//     falls back to the nearest catalog kind by name + tags (warned), then to the core fallback of that section
//   * ground-snaps what the builders place, keeps moving things snapped, and gives standing things a soft contact
//     shadow that follows the terrain (unless the builder registered its own through ctx.contacts)
import * as THREE from 'three';
import * as FB from './fallback.js';
import { clamp, deg } from '../lib/shared/util.js';
const _cv = new THREE.Vector3();   // cast contact shadows

const LIBS = [['nature', '../lib/nature/index.js'], ['human', '../lib/human/index.js'], ['fx', '../lib/fx/index.js']];   // fx: disaster FX (a missing folder is 'not there yet')
const SECTION_OF_PREFIX = {
  figure: 'cast', cast: 'cast', person: 'cast', character: 'cast', crowd: 'groups', group: 'groups', army: 'groups', herd: 'groups',
  vehicle: 'objects', ship: 'objects', boat: 'objects', aircraft: 'objects', plane: 'objects', object: 'objects', prop: 'objects', creature: 'objects',
  animal: 'objects', tree: 'objects', vegetation: 'objects', rock: 'objects', marker: 'objects', space: 'objects', planet: 'objects',
  town: 'structures', structure: 'structures', building: 'structures', landmark: 'structures', interior: 'structures', monument: 'structures',
  city: 'structures', village: 'structures', fort: 'structures', bridge: 'structures', label: 'labels', text: 'labels',
  biome: 'world', world: 'world', terrain: 'world',
};
// which catalog sections may serve a spec section
const SERVES = {
  world: ['world'], cast: ['cast', 'groups'], groups: ['groups', 'cast', 'objects'], objects: ['objects', 'groups', 'structures'],
  structures: ['structures', 'objects'], labels: ['labels'],
};
const CORE_OF = { world: 'core.plain', cast: 'core.mannequin', groups: 'core.crowd', objects: 'core.box', structures: 'core.block', labels: 'core.label' };
const STOP = new Set(['the', 'a', 'of', 'and', 'with', 'like', 'in', 'on', 'for', 'to']);
const toks = (s) => String(s || '').toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

export function sectionOf(kind, entry) {
  if (entry && entry.section) return entry.section;
  const p = String(kind).split('.')[0].toLowerCase();
  return SECTION_OF_PREFIX[p] || 'objects';
}

export async function loadLibraries() {
  const catalog = {}, modules = [], warnings = [], status = {};
  const add = (mod, lib, name) => {
    if (!mod) return;
    const cat = mod.CATALOG || {};
    modules.push({ mod, lib, name });
    for (const [k, e] of Object.entries(cat)) {
      if (catalog[k] && !catalog[k].entry.core) { warnings.push(`kind ${k} defined twice (${catalog[k].name}, ${name}); keeping the first`); continue; }
      catalog[k] = { entry: e || {}, mod, lib, name, section: sectionOf(k, e) };
    }
  };
  for (const [lib, path] of LIBS) {
    let idx = null;
    const base = new URL(path, import.meta.url);
    try { idx = await import(path); }
    catch (e) {
      // the index failed (a module it imports is missing or broken): load every module it names that does work
      const missing = /fetch|Failed to load|404|not found|Importing a module script failed/i.test(String(e));
      let src = null;
      try { const r = await fetch(base.href); if (r.ok) src = await r.text(); } catch (e2) { /* */ }
      if (!src) { status[lib] = 'not there yet'; continue; }
      const names = [...new Set([...src.matchAll(/from\s+['"](\.\/[^'"]+\.m?js)['"]/g)].map((m) => m[1]))];
      let ok = 0;
      for (const p of names) {
        try { const m = await import(new URL(p, base).href); if (m.CATALOG && (m.build || m.buildWorld || m.buildCast)) { add(m, lib, `${lib}/${p.replace(/^\.\//, '')}`); ok++; } }
        catch (e3) { /* not there yet */ }
      }
      status[lib] = ok ? `partial: ${ok} module(s) (index: ${missing ? 'a module is missing' : String(e).slice(0, 120)})` : 'not there yet';
      if (!missing) warnings.push(`lib/${lib}/index.js failed: ${String(e).slice(0, 200)}`);
      continue;
    }
    const list = Array.isArray(idx.MODULES) ? idx.MODULES : [];
    let ok = 0;
    if (!list.length && idx.CATALOG && (idx.build || idx.buildWorld)) { add(idx, lib, `${lib}/index.js`); ok++; }
    for (const m of list) {
      if (m && typeof m === 'object') { add(m, lib, m.NAME || `${lib}/(object)`); ok++; continue; }
      let p = String(m); if (!/^[./]/.test(p)) p = './' + p; if (!/\.m?js$/.test(p)) p += '.js';
      try { add(await import(new URL(p, base).href), lib, `${lib}/${p.replace(/^\.\//, '')}`); ok++; }
      catch (e) { warnings.push(`module ${lib}/${p} failed to load: ${String(e).slice(0, 240)}`); }
    }
    status[lib] = `${ok} module(s)`;
  }
  add(FB, 'core', 'core/fallback.js');
  return { catalog, modules, warnings, status };
}

// nearest catalog kind for an unknown kind in a spec section
export function nearestKind(catalog, kind, section, extraTags = []) {
  const q = [...toks(kind), ...extraTags.flatMap(toks)];
  const prefix = String(kind).split('.')[0].toLowerCase();
  let best = null, bestS = 0;
  for (const [k, c] of Object.entries(catalog)) {
    if (!SERVES[section]?.includes(c.section)) continue;
    const kt = new Set(toks(k)), tags = new Set((c.entry.tags || []).flatMap(toks)), desc = new Set(toks(c.entry.desc));
    let s = 0;
    for (const w of q) {
      if (kt.has(w)) s += 3; else if (tags.has(w)) s += 2; else if (desc.has(w)) s += 1;
      else if (w.length >= 4 && [...kt, ...tags].some((x) => x.length >= 4 && (x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4))))) s += 0.8;
    }
    if (k.split('.')[0].toLowerCase() === prefix) s += 2;
    if (c.section === section) s += 0.5;
    if (c.entry.core) s *= 0.55;                                   // the fallbacks only win when nothing real fits
    if (s > bestS) { bestS = s; best = k; }
  }
  return bestS >= 2 ? best : null;
}

export function resolveKind(reg, kind, section, warnings, extraTags) {
  const cat = reg.catalog;
  if (kind && cat[kind]) return kind;
  const near = kind ? nearestKind(cat, kind, section, extraTags) : null;
  const k = near || CORE_OF[section];
  if (kind) warnings.push(`${section}: kind '${kind}' not in catalog, using '${k}'`);
  return k;
}

// ── contact shadows: one merged mesh of terrain-following soft decals ─────────────────────────────────────────────
function radialTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, '#d8d8d8'); gr.addColorStop(0.62, '#555'); gr.addColorStop(1, '#000');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; return t;
}
const GN = 5;   // grid per decal (GN x GN vertices)
export function makeContacts(parent, ground, patch) {
  const list = [];
  let mesh = null, geo = null;
  const tex = radialTex();
  function add(o) {
    const h = { x: o.x, z: o.z, w: o.w ?? 0.9, l: o.l ?? o.w ?? 0.9, rot: o.rot ?? 0, a: o.a ?? 0.5, follow: o.follow || null, fn: o.fn || null, last: null, i: list.length, owner: o.owner };
    h.set = (x, z, rot) => { h.x = x; h.z = z; if (rot != null) h.rot = rot; };
    list.push(h); return h;
  }
  // Q10: a hidden follow target (a cast figure that went indoors, anything set visible = false) takes its shadow along
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  function write(h) {
    const P = geo.attributes.position.array, base = h.i * GN * GN, off = h.follow && !shown(h.follow) ? 0 : 1;
    const cr = Math.cos(h.rot), sr = Math.sin(h.rot);
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const lx = (i / (GN - 1) - 0.5) * h.w * off, lz = (j / (GN - 1) - 0.5) * h.l * off;
      const x = h.x + lx * cr + lz * sr, z = h.z - lx * sr + lz * cr;
      const k = (base + j * GN + i) * 3;
      P[k] = x; P[k + 1] = ground.height(x, z) + 0.045; P[k + 2] = z;
    }
    h.last = [h.x, h.z, h.rot, off];
  }
  function finalize() {
    if (!list.length) return;
    const n = list.length, V = n * GN * GN;
    geo = new THREE.BufferGeometry();
    const P = new Float32Array(V * 3), UV = new Float32Array(V * 2), C = new Float32Array(V * 4), I = [];
    list.forEach((h, d) => {
      for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
        const v = d * GN * GN + j * GN + i; UV[v * 2] = i / (GN - 1); UV[v * 2 + 1] = j / (GN - 1);
        C[v * 4 + 3] = h.a;
      }
      for (let j = 0; j < GN - 1; j++) for (let i = 0; i < GN - 1; i++) {
        const a = d * GN * GN + j * GN + i, b = a + 1, c = a + GN + 1, e = a + GN; I.push(a, e, b, b, e, c);
      }
    });
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 4));
    geo.setIndex(I);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const m = patch(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex, transparent: true, depthWrite: false, vertexColors: true }));
    mesh = new THREE.Mesh(geo, m); mesh.name = 'contacts'; mesh.renderOrder = 2; mesh.frustumCulled = false; mesh.userData.noQA = true;
    parent.add(mesh);
    for (const h of list) { track(h); write(h); }
    geo.attributes.position.needsUpdate = true;
  }
  const _v = new THREE.Vector3();
  function track(h) {
    if (h.fn) { const r = h.fn(); if (r) { h.x = r[0]; h.z = r[1]; if (r[2] != null) h.rot = r[2]; } }
    else if (h.follow) { h.follow.getWorldPosition(_v); h.x = _v.x; h.z = _v.z; }
  }
  function update() {
    if (!geo) return;
    let dirty = false;
    for (const h of list) {
      if (!h.follow && !h.fn) continue;
      track(h);
      const l = h.last;
      if (!l || Math.abs(l[0] - h.x) > 0.005 || Math.abs(l[1] - h.z) > 0.005 || Math.abs(l[2] - h.rot) > 0.002 || (h.follow && l[3] !== (shown(h.follow) ? 1 : 0))) { write(h); dirty = true; }
    }
    if (dirty) geo.attributes.position.needsUpdate = true;
  }
  function count(owner) { return owner == null ? list.length : list.filter((h) => h.owner === owner).length; }
  return { add, finalize, update, count, list, get mesh() { return mesh; } };
}

// ── scene build ──────────────────────────────────────────────────────────────────────────────────────────────────
const vec2 = (a) => Array.isArray(a) && a.length >= 2 && a.every((v) => Number.isFinite(+v));

export async function buildScene(reg, spec, ctx, castDefs, warnings) {
  const S = { items: [], byRef: {}, world: null, water: null };
  ctx.spec = spec;   // E3 v2: builders may read the shot (the detail.* inserts fit themselves to the camera before the plan)
  const t0 = performance.now();
  const lap = (s) => console.log('[f3d]', s, Math.round(performance.now() - t0), 'ms');
  // world first: everything else stands on it
  // E1 v2: a scene with an interior.* room is a closed set: its world is the interior void (world.interior in
  // lib/human/interiors.js: flat floor, no sea, terrain, flora or clouds that could show inside the room)
  const inRoom = [...(spec.structures || []), ...(spec.objects || [])].some((e) => /^interior\./.test(String(e?.kind || '')));
  const asked = spec.world?.biome || spec.world?.kind;
  if (inRoom && reg.catalog['world.interior'] && asked && asked !== 'interior') warnings.push(`world: '${asked}' replaced by the interior void (an interior.* room is a closed set: no sea or terrain inside it)`);
  const world = inRoom && reg.catalog['world.interior'] ? { ...(spec.world || {}), biome: 'interior', kind: undefined } : (spec.world || {});
  let wkind = null;
  const biome = world.biome || world.kind;
  if (biome) {
    const cands = [biome, `biome.${biome}`, `world.${biome}`, `terrain.${biome}`];
    wkind = cands.find((k) => reg.catalog[k] && reg.catalog[k].mod.buildWorld);
    if (!wkind) {
      const alt = Object.entries(reg.catalog).find(([k, c]) => c.mod.buildWorld && ((c.entry.biomes || []).includes(biome) || c.entry.biome === biome));
      if (alt) wkind = alt[0];
    }
    if (!wkind) {
      const near = nearestKind(Object.fromEntries(Object.entries(reg.catalog).filter(([, c]) => c.mod.buildWorld)), biome, 'world');
      wkind = near || 'core.plain';
      warnings.push(`world: biome '${biome}' not in catalog, using '${wkind}'`);
    }
  } else wkind = Object.keys(reg.catalog).find((k) => reg.catalog[k].section === 'world' && !reg.catalog[k].entry.core && reg.catalog[k].mod.buildWorld) || 'core.plain';
  let W;
  try {
    const c = reg.catalog[wkind];
    W = await c.mod.buildWorld({ ...world, biome: c.entry.biome || wkind.replace(/^(biome|world|terrain)\./, ''), kind: wkind }, spec.look || {}, ctx);
  } catch (e) {
    warnings.push(`world '${wkind}' failed (${String(e).slice(0, 200)}); using the core plain`);
    console.error(e);
    W = await FB.buildWorld(world, spec.look || {}, ctx);
    wkind = 'core.plain';
  }
  if (!W || !W.ground || typeof W.ground.height !== 'function') { warnings.push(`world '${wkind}' returned no ground; using the core plain`); W = await FB.buildWorld(world, spec.look || {}, ctx); wkind = 'core.plain'; }
  const h0 = W.ground.height;
  // guard against NaN heights from any world
  W.ground.height = (x, z) => { const v = h0(x, z); return Number.isFinite(v) ? v : 0; };
  if (typeof W.ground.normal !== 'function') W.ground.normal = (x, z) => { const e = 0.5, H = W.ground.height; const v = new THREE.Vector3(H(x - e, z) - H(x + e, z), 2 * e, H(x, z - e) - H(x, z + e)).normalize(); return v.toArray(); };
  ctx.ground = W.ground;
  S.world = W; S.worldKind = wkind;
  const wl = W.water?.level ?? ((world.water && world.water.kind && world.water.kind !== 'none') ? (world.water.level ?? 0) : null);
  S.water = wl;
  ctx.water = wl == null ? null : { level: wl, kind: world.water?.kind };
  lap('world ' + wkind);

  // helpers
  const resolveAt = (at, what) => {
    if (at == null || at === 'stage') return [0, 0];
    if (vec2(at)) return [+at[0], +at[at.length === 3 ? 2 : 1]];
    if (typeof at === 'string') { const it = S.byRef[at] || S.byRef['ref:' + at]; if (it) { const p = it.res.root.getWorldPosition(new THREE.Vector3()); return [p.x + 3, p.z + 3]; } }
    warnings.push(`${what}: 'at' ${JSON.stringify(at)} not understood, using the stage`);
    return [0, 0];
  };
  const snapY = (x, z) => { const g = ctx.ground.height(x, z); return S.water != null ? Math.max(g, S.water) : g; };

  // builders that draw their own contact shadows (ctx.contacts, or meshes named 'contactShadow') keep them
  const ownShadows = () => { let n = ctx.contacts.count(); ctx.scene.traverse((o) => { if (o.name === 'contactShadow' || o.userData?.contactShadow) n++; }); return n; };
  async function place(section, index, entry, kind, item) {
    const c = reg.catalog[kind];
    const before = ownShadows();
    let res = null;
    try { res = await c.mod.build(kind, item, ctx); }
    catch (e) { warnings.push(`${section}:${index} '${kind}' failed (${String(e).slice(0, 180)}); using a fallback`); console.error(e); }
    if (!res || !res.root) {
      const fk = CORE_OF[section];
      res = await FB.build(fk, { ...item, footprint: c?.entry.footprint, height: c?.entry.height }, ctx);
      kind = fk;
    }
    if (!res.root.parent) ctx.scene.add(res.root);
    const e = reg.catalog[kind]?.entry || {};
    const it = { section, index, kind, spec: entry, item, res, entry: e, ownContacts: ownShadows() > before };
    // ground snap: keep the builder's offset from the ground if it set one, force it for props left at y = 0
    const p = res.root.position, g = snapY(p.x, p.z);
    const flies = e.snap === false || e.fly || /aircraft|plane|bird|space|planet/.test(kind);
    it.flies = flies;
    if (!flies && !res.snapped) {
      if (Math.abs(p.y) < 1e-6 && Math.abs(g) > 0.05 && section !== 'groups') { p.y = g; warnings.push(`${section}:${index} '${kind}' placed at y=0; ground-snapped`); }
      it.yOff = p.y - g;
    }
    it.x0 = p.x; it.z0 = p.z;
    S.items.push(it);
    return it;
  }

  // cast (video-level CastDefs, `witness` built in)
  const cast = Array.isArray(spec.cast) ? spec.cast : [];
  for (let i = 0; i < cast.length; i++) {
    const e = cast[i] || {};
    const ref = e.ref || e.id || 'witness';
    const def = castDefs[ref] || FB.BUILTIN_CAST[ref] || null;
    if (!def) warnings.push(`cast:${i} ref '${ref}' has no CastDef; building a plain mannequin`);
    const at = resolveAt(e.at, `cast:${i}`);
    const item = { ...e, ref, def: def || { id: ref, name: ref }, at, heading: e.heading ?? 180, index: i, pos: [at[0], snapY(...at), at[1]], seed: spec.seed };
    let kind = null, it = null;
    const castMod = reg.modules.find((m) => typeof m.mod.buildCast === 'function');
    if (castMod) {
      try {
        const res = await castMod.mod.buildCast(item.def, item, ctx);
        if (res && res.root) {
          if (!res.root.parent) ctx.scene.add(res.root);
          it = { section: 'cast', index: i, kind: 'cast:' + ref, spec: e, item, res, entry: { height: 1.8 }, ownContacts: false };
          const p = res.root.position, g = snapY(p.x, p.z); if (!res.snapped) it.yOff = p.y - g;
          it.x0 = p.x; it.z0 = p.z;
          S.items.push(it);
        }
      } catch (err) { warnings.push(`cast:${i} buildCast failed (${String(err).slice(0, 160)})`); console.error(err); }
    }
    if (!it) {
      kind = ['cast.character', 'cast', 'figure.cast', 'figure.character', 'cast.mannequin', 'figure.mannequin'].find((k) => reg.catalog[k]) || 'core.mannequin';
      it = await place('cast', i, e, kind, item);
    }
    it.figure = true; it.ref = ref;
    S.byRef['ref:' + ref] = it; S.byRef['cast:' + i] = it; S.byRef['cast:' + ref] = it;
  }
  const sections = [['groups', 'groups'], ['objects', 'objects'], ['structures', 'structures']];
  for (const [sec] of sections) {
    const arr = Array.isArray(spec[sec]) ? spec[sec] : [];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i] || {};
      const kind = resolveKind(reg, e.kind, sec, warnings, e.tags || []);
      const at = resolveAt(e.at, `${sec}:${i}`);
      const c = reg.catalog[kind];
      const item = { ...e, kind, requested: e.kind, at, heading: e.heading ?? 0, index: i, pos: [at[0], snapY(...at), at[1]], seed: (spec.seed ?? 1) * 101 + i, params: { ...(c?.entry.params || {}), ...(e.params || {}) } };
      if (c?.entry.core && e.kind) { item.footprint = item.footprint || guessFootprint(e.kind); item.height = item.height ?? guessHeight(e.kind); }
      const it = await place(sec, i, e, kind, item);
      it.figure = sec === 'groups' || /figure|soldier|person|crowd|cast/.test(kind);
      S.byRef[`${sec}:${i}`] = it;
      if (e.id) S.byRef['ref:' + e.id] = it;
    }
    lap(sec);
  }
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  for (let i = 0; i < labels.length; i++) {
    const e = labels[i] || {};
    const want = e.kind || (e.style ? `label.${e.style}` : 'label');
    let kind = reg.catalog[want] ? want : (['label.text', 'label', 'label.monument'].find((k) => reg.catalog[k] && !reg.catalog[k].entry.core) || 'core.label');
    if (e.kind && !reg.catalog[e.kind]) warnings.push(`labels:${i} kind '${e.kind}' not in catalog, using '${kind}'`);
    const at = resolveAt(e.at, `labels:${i}`);
    const item = { ...e, kind, at, heading: e.heading ?? 180, index: i, pos: [at[0], snapY(...at), at[1]], faceCamera: e.heading == null };
    const it = await place('labels', i, e, kind, item);
    it.label = true;
    S.byRef['labels:' + i] = it;
  }
  lap('labels');
  // settle every item at t = 0 and find what moves
  for (const it of S.items) {
    try { it.res.update && it.res.update(0, 0); } catch (e) { warnings.push(`${it.section}:${it.index} update failed: ${String(e).slice(0, 160)}`); it.res.update = null; }
  }
  // contact shadows for standing things that did not register their own
  for (const it of S.items) {
    if (it.ownContacts || it.flies || it.res.contact === false || it.entry.contact === false) continue;
    const r = it.res, root = r.root;
    if (it.section === 'groups' && typeof r.members === 'function') {
      const M = r.members(0);
      M.forEach((m, k) => ctx.contacts.add({ x: m[0], z: m[1], w: 0.95, a: 0.5, owner: it, fn: () => (it.memCache ? it.memCache[k] : null) }));
      it.memberContacts = true;
      continue;
    }
    if (it.section === 'groups') continue;       // a library group without members(): its builder owns the shadows
    const fp = r.footprint || it.entry.footprint;
    if (it.label) { const w = (r.width || r.radius * 2 || 10) * 1.05; ctx.contacts.add({ x: root.position.x, z: root.position.z, w, l: Math.max(2, (it.item.height ?? 10) * 0.6), rot: root.rotation.y, a: 0.38, follow: root, owner: it }); continue; }
    // a cast figure walks inside its root (the controller moves fig.group), so the shadow follows the feet (fix)
    if (it.figure || it.section === 'cast') { const ft = (it.section === 'cast' && r.anchors && r.anchors.feet && r.anchors.feet.isObject3D) ? r.anchors.feet : root; ft.getWorldPosition(_cv); ctx.contacts.add({ x: _cv.x, z: _cv.z, w: 0.95, a: 0.55, follow: ft, owner: it }); continue; }
    // a vehicle drives its body inside a root that stays at the origin, so the shadow follows the body and turns with it
    // (fix: it lay at the origin, across the road). Vehicle footprints are [width, length], the length along the heading.
    const body = r.anchors && r.anchors.body && r.anchors.body.isObject3D ? r.anchors.body : null;
    if (body && fp) {
      const bp = new THREE.Vector3(), bz = new THREE.Vector3();
      const pose = () => { body.getWorldPosition(bp); bz.set(0, 0, 1).transformDirection(body.matrixWorld); return [bp.x, bp.z, Math.atan2(bz.x, bz.z)]; };
      const p0 = pose();
      ctx.contacts.add({ x: p0[0], z: p0[1], w: fp[0] * 1.1, l: fp[1] ?? fp[0], rot: p0[2], a: 0.5, fn: pose, owner: it });
      continue;
    }
    if (fp) { ctx.contacts.add({ x: root.position.x, z: root.position.z, w: fp[1] ?? fp[0], l: fp[0] * 1.1, rot: root.rotation.y, a: it.section === 'structures' ? 0.35 : 0.5, follow: root, owner: it }); continue; }
    const rad = Math.max(0.5, Math.min(r.radius || 1, 40));
    ctx.contacts.add({ x: root.position.x, z: root.position.z, w: rad * 2.1, a: it.section === 'structures' ? 0.32 : 0.45, follow: root, owner: it });
  }
  for (const it of S.items) if (S.water != null && typeof it.res.sceneWater === 'number') S.water = Math.min(S.water, it.res.sceneWater);   // Q8: a drawn-back sea (fx.tsunami drawback) for the camera, QA and snapping
  return S;
}

function guessFootprint(kind) {
  const k = kind.toLowerCase();
  if (/tank/.test(k)) return [6.5, 3.1];
  if (/truck|lorry|jeep|car/.test(k)) return [5, 2.2];
  if (/cannon|gun|artillery/.test(k)) return [4, 2];
  if (/horse|cow|animal|dino/.test(k)) return [2.4, 0.8];
  if (/ship|boat/.test(k)) return [30, 7];
  return [2, 2];
}
function guessHeight(kind) {
  const k = kind.toLowerCase();
  if (/tank/.test(k)) return 2.7; if (/truck|lorry/.test(k)) return 2.8; if (/jeep|car/.test(k)) return 1.7; if (/ship|boat/.test(k)) return 8;
  return 1.5;
}

// per sub-frame: animate everything at t, keep moving roots on the ground, move the contacts
export function updateScene(S, t, clock, camera, ctx) {
  if (S.world && S.world.update) { try { S.world.update(t, clock, camera); } catch (e) { if (!S.worldErr) { S.worldErr = true; console.error(e); } } }
  for (const it of S.items) {
    const r = it.res;
    if (r.update) { try { r.update(t, clock, camera); } catch (e) { if (!it.err) { it.err = true; console.error(e); } } }
    const p = r.root.position;
    if (it.yOff != null && (Math.abs(p.x - it.x0) > 1e-4 || Math.abs(p.z - it.z0) > 1e-4)) {
      const g = ctx.ground.height(p.x, p.z);
      p.y = (S.water != null ? Math.max(g, S.water) : g) + it.yOff;
    }
    if (it.memberContacts) it.memCache = r.members(t);
  }
  ctx.contacts.update();
}

// merged catalog for the director (render.py --catalog): library kinds first; core fallbacks listed separately
export function catalogJSON(reg, extra) {
  const kinds = {}, fallbacks = {};
  for (const [k, c] of Object.entries(reg.catalog)) {
    const e = { ...c.entry, section: c.section, lib: c.lib, module: c.name };
    if (c.entry.core) fallbacks[k] = e; else kinds[k] = e;
  }
  return Object.assign({ version: 1, libraries: reg.status, kinds, fallbacks }, extra || {});
}
