// interiors.js — rooms with their own light plan (the engine should run interior scenes with a flat/absent terrain
// and a dim exterior: the room's practicals and window light carry the image).
//   interior.cellar      the Bastogne command-post cellar (hq.js): whitewashed brick vault, map table under a hurricane
//                        lamp, sandbagged window, typewriter typing `text` from `typing_start`
//   interior.bunker      alias of the cellar
//   interior.office      1940s-60s office: desk + lamp, filing cabinets, bookcase, venetian-blind window
//   interior.study       wood-panelled study: desk with a green banker's lamp, bookshelves, armchair, fireplace glow
//   interior.palace_hall marble hall: checker floor, columns, tall windows, chandeliers, red runner, throne
// All: floor at the ground height under `at`, long axis along `heading`; anchors { center, desk, window, door }.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { buildHQ, typingAt, NUTS_TEXT } from './hq.js';
import { ROOM_CATALOG, buildRoom } from './rooms.js';
import * as crowd from './crowd.js';
import * as TX from './textures.js';
import { plain } from '../shared/materials.js';
import { rng } from '../shared/util.js';
import { ground, xz, DEG, patchAll, yawFromHeading } from './common.js';

const box = (w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); } return g; };
const add = (parent, g, m, x = 0, y = 0, z = 0, cast = true) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true; parent.add(o); return o; };
const lerpN = (a, b, t) => a + (b - a) * t;
function texRep(t, m) { const c = t.clone(); c.needsUpdate = true; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(1 / m, 1 / m); return c; }
let TEX = null;
function tex() {
  return (TEX ||= {
    oak: TX.planks({ size: 512, meters: 3, boardW: 0.14, tone: '#5A3E26', tone2: '#7A5A3A', seed: 4 }),
    dark: TX.planks({ size: 512, meters: 2, boardW: 0.2, tone: '#2E2016', tone2: '#4A3424', seed: 6 }),
    marble: TX.masonry({ size: 512, meters: 4, courseH: 1.0, blockL: [1.0, 1.0], tones: ['#E8E4DC', '#2A2826', '#E4E0D8', '#302E2C'], mortar: '#B8B4AC', bevel: 0.004, seed: 3, dirt: 0.1 }),
    plaster: TX.stucco(256),
  });
}
function room(kind, o) {
  const T = tex(), g = new THREE.Group(), lights = [];
  const S = { office: { L: 7, W: 5, H: 3.0, wall: 0xB8B09A, floor: 'oak' }, study: { L: 6.5, W: 5, H: 3.2, wall: 0x4A3424, floor: 'dark' }, palace_hall: { L: 34, W: 14, H: 11, wall: 0xD8CBB0, floor: 'marble' } }[kind];
  const floorMap = S.floor === 'marble' ? texRep(T.marble.map, 2) : texRep(T[S.floor].map, 2);
  const floorM = plain({ map: floorMap, roughness: S.floor === 'marble' ? 0.18 : 0.6, envMapIntensity: 0.8 });
  const wallM = plain({ map: texRep(T.plaster, 3), color: S.wall, roughness: 0.9 }), ceilM = plain({ color: 0xE8E4DA, roughness: 0.95 });
  const wood = plain({ map: texRep(T.oak.map, 1), roughness: 0.55 }), darkWood = plain({ map: texRep(T.dark.map, 1), roughness: 0.5 }), brass = plain({ color: 0xB08A40, roughness: 0.3, metalness: 1 });
  const glow = (c, i) => plain({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 });
  const { L, W, H } = S;
  add(g, box(W, 0.1, L), floorM, 0, -0.05, 0);
  add(g, box(W, 0.1, L), ceilM, 0, H + 0.05, 0);
  // walls with a window opening in the +X wall (daylight) and a door in -Z
  const win = kind === 'palace_hall' ? { n: 5, w: 2.6, h: 6.5, y: 2.2 } : { n: 1, w: 1.6, h: 1.7, y: 0.95 };
  add(g, box(0.2, H, L), wallM, -W / 2 - 0.1, H / 2, 0);
  add(g, box(W, H, 0.2), wallM, 0, H / 2, -L / 2 - 0.1); add(g, box(W, H, 0.2), wallM, 0, H / 2, L / 2 + 0.1);
  { const seg = L / win.n; for (let i = 0; i < win.n; i++) { const zc = -L / 2 + seg * (i + 0.5);
      add(g, box(0.2, win.y, seg), wallM, W / 2 + 0.1, win.y / 2, zc); add(g, box(0.2, H - win.y - win.h, seg), wallM, W / 2 + 0.1, H - (H - win.y - win.h) / 2, zc);
      for (const s of [1, -1]) add(g, box(0.2, win.h, (seg - win.w) / 2), wallM, W / 2 + 0.1, win.y + win.h / 2, zc + s * (win.w / 2 + (seg - win.w) / 4));
      // E1 v2: at night the window is a deep blue-black exterior with a faint cold light, not daylight
      const nk = o.night ?? 0;
      add(g, box(0.05, win.h, win.w), nk > 0 ? glow(0x0A1424, lerpN(1.6, 0.22, nk)) : glow(0xDDE6F0, 1.6), W / 2 + 0.2, win.y + win.h / 2, zc, false);
      const ra = new THREE.RectAreaLight(nk > 0 ? 0x7C8698 : 0xD8E4F4, (kind === 'palace_hall' ? 9 : 7) * lerpN(1, 0.012, nk), win.w, win.h); ra.position.set(W / 2 - 0.05, win.y + win.h / 2, zc); ra.lookAt(0, win.y + win.h / 2 - 0.5, zc); g.add(ra); lights.push(ra);
      if (kind === 'office') for (let k = 0; k < 14; k++) add(g, box(0.03, 0.02, win.w), plain({ color: 0xD8D2C0, roughness: 0.6 }), W / 2 - 0.02, win.y + 0.08 + k * 0.12, zc, true);
    } }
  const R = rng(5);
  if (kind === 'office' || kind === 'study') {
    const desk = new THREE.Group(); desk.name = 'desk'; desk.position.set(0.3, 0, -0.6); g.add(desk);
    add(desk, box(1.6, 0.05, 0.8), kind === 'study' ? darkWood : wood, 0, 0.76, 0);
    for (const x of [-0.7, 0.7]) add(desk, box(0.4, 0.74, 0.74), kind === 'study' ? darkWood : wood, x, 0.37, 0);
    const lampC = kind === 'study' ? 0x1E6A3A : 0x2A2A2A;
    add(desk, new THREE.CylinderGeometry(0.06, 0.08, 0.3, 12), brass, 0.55, 0.93, -0.2);
    add(desk, new THREE.CylinderGeometry(0.02, 0.16, 0.12, 16, 1, true), plain({ color: lampC, roughness: 0.3, side: THREE.DoubleSide }), 0.55, 1.1, -0.2);
    // E1 v2: the shade sends the lamp's light DOWN: a spot under it (up to 80 deg off vertical) makes the warm pool on
    // the desk, the papers and the hands; the face above the shade gets only a soft warm bounce from the lit desk
    // (the light sits inside the lamp's stem: the shadow camera's 0.5 m near plane keeps the lamp from shadowing itself)
    const pl = new THREE.SpotLight(0xFFC98A, 3.2, 6, 1.4, 0.3, 2); pl.position.set(0.55, 1.1, -0.2); pl.target.position.set(0.55, 0, -0.2);   // in the shade: no hot spot at the base
    pl.castShadow = true; pl.shadow.mapSize.set(512, 512); desk.add(pl, pl.target); lights.push(pl);
    const spill = new THREE.PointLight(0xFFB070, 0.5, 4, 2); spill.position.set(0.55, 1.12, -0.2); spill.name = 'lamp_spill'; desk.add(spill); lights.push(spill);   // the glass shade's own glow: a soft warm side light
    for (let k = 0; k < 6; k++) add(desk, box(0.21, 0.004, 0.297), plain({ color: 0xF0ECE0, roughness: 0.9 }), -0.3 + R() * 0.3, 0.79 + k * 0.004, R() * 0.2 - 0.1, false);
    const chair = new THREE.Group(); chair.name = 'chair'; chair.position.set(0.3, 0, 0.1); g.add(chair);
    add(chair, box(0.5, 0.06, 0.5), darkWood, 0, 0.46, 0); add(chair, box(0.5, 0.6, 0.06), darkWood, 0, 0.8, 0.24);
    for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) add(chair, box(0.04, 0.46, 0.04), darkWood, x, 0.23, z);
    // bookshelves along -X wall
    const shelves = new THREE.Group(); shelves.name = 'bookshelf'; shelves.position.set(-W / 2 + 0.2, 0, 0); g.add(shelves);
    const books = [];
    for (let s = 0; s < (kind === 'study' ? 3 : 1); s++) {
      const z0 = -L / 2 + 1 + s * 1.6;
      add(shelves, box(0.35, 2.3, 1.4), darkWood, 0, 1.15, z0 + 0.7);
      for (let r = 0; r < 5; r++) { let z = z0 + 0.06; while (z < z0 + 1.32) { const w = 0.03 + R() * 0.04, h = 0.22 + R() * 0.1; books.push([0.04, 0.2 + r * 0.44 + h / 2, z + w / 2, w, h]); z += w + 0.003; } }
    }
    const bi = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), plain({ roughness: 0.7 }), books.length); const m4 = new THREE.Matrix4(), c = new THREE.Color();
    books.forEach(([x, y, z, w, h], i) => { m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(0.26, h, w)); bi.setMatrixAt(i, m4); bi.setColorAt(i, c.setHSL(R() * 0.12 + (R() < 0.3 ? 0.55 : 0.0), 0.35 + R() * 0.3, 0.18 + R() * 0.2)); });
    bi.castShadow = bi.receiveShadow = true; shelves.add(bi);
    if (kind === 'office') for (const z of [2.0, 2.6]) add(g, box(0.5, 1.3, 0.55), plain({ color: 0x5A6A5E, roughness: 0.5, metalness: 0.4 }), -W / 2 + 0.3, 0.65, z);
    if (kind === 'study') {
      add(g, box(1.6, 1.2, 0.5), plain({ color: 0x6A5E50, roughness: 0.9 }), 0, 0.6, L / 2 - 0.25).name = 'fireplace';
      // E1 v2: a fireplace, not a glowing panel: a dark firebox opening, a low bed of embers, a soft warm light (the old
      // 0.9 x 0.6 m panel at emissive 2.5 + a 6 cd light blew out a third of the frame and flooded the room orange)
      const fz = L / 2 - 0.5 - 0.012;
      add(g, box(0.9, 0.6, 0.02), plain({ color: 0x0E0806, roughness: 1 }), 0, 0.36, fz, false).name = 'fireplace';
      add(g, box(0.72, 0.07, 0.02), glow(0xFF4A12, 0.9), 0, 0.1, fz - 0.004, false).name = 'embers';
      add(g, box(0.6, 0.16, 0.01), glow(0xB8300C, 0.28), 0, 0.2, fz - 0.003, false).name = 'embers';
      const fl = new THREE.PointLight(0xFF7430, 1.4, 6, 2); fl.position.set(0, 0.3, L / 2 - 0.75); g.add(fl); lights.push(fl);
      add(g, box(2.6, 0.02, 1.8), plain({ color: 0x5A1E1E, roughness: 1 }), 0, 0.01, 0.3, false);             // rug
      const arm = new THREE.Group(); arm.name = 'armchair'; arm.position.set(-1.1, 0, 1.4); arm.rotation.y = 0.6; g.add(arm);
      const leather = plain({ color: 0x4A2418, roughness: 0.45 });
      add(arm, box(0.9, 0.45, 0.85), leather, 0, 0.25, 0); add(arm, box(0.9, 0.7, 0.2), leather, 0, 0.8, -0.35); for (const s of [1, -1]) add(arm, box(0.18, 0.35, 0.85), leather, s * 0.42, 0.6, 0);
    }
    const ceil = new THREE.PointLight(0xFFE0B0, (kind === 'study' ? 1.2 : 3) * (1 + 1.5 * (o.night ?? 0)), 12, 2); ceil.position.set(0, H - 0.4, 0); g.add(ceil); lights.push(ceil);   // E1 v2: at night the room's own light is on
  } else {    // palace hall
    const col = new THREE.CylinderGeometry(0.55, 0.62, H - 1.2, 24), colM = plain({ color: 0xE8E2D6, roughness: 0.35 }), gold = plain({ color: 0xC9A441, roughness: 0.3, metalness: 1 });
    for (let i = 0; i < 7; i++) for (const s of [1, -1]) { const z = -L / 2 + 3 + i * (L - 6) / 6; add(g, col, colM, s * (W / 2 - 1.8), (H - 1.2) / 2 + 0.6, z); add(g, box(1.5, 0.6, 1.5), colM, s * (W / 2 - 1.8), 0.3, z); add(g, box(1.5, 0.6, 1.5), gold, s * (W / 2 - 1.8), H - 0.3, z); }
    add(g, box(3.2, 0.02, L - 4), plain({ color: 0x7A1418, roughness: 0.95 }), 0, 0.01, 0, false);
    const throne = new THREE.Group(); throne.position.set(0, 0, -L / 2 + 2.2); g.add(throne);
    add(throne, box(4, 0.4, 3), colM, 0, 0.2, 0); add(throne, box(1.2, 0.6, 0.9), gold, 0, 0.7, 0); add(throne, box(1.2, 1.9, 0.2), gold, 0, 1.35, -0.4); add(throne, box(0.9, 0.12, 0.7), plain({ color: 0x8A1020, roughness: 0.6 }), 0, 1.05, 0.05);
    for (let i = 0; i < 3; i++) {
      const z = -L / 2 + L * (i + 1) / 4, ch = new THREE.Group(); ch.position.set(0, H - 2.4, z); g.add(ch);
      add(ch, new THREE.TorusGeometry(1.1, 0.05, 8, 32).rotateX(Math.PI / 2), gold, 0, 0, 0);
      for (let k = 0; k < 12; k++) add(ch, new THREE.SphereGeometry(0.07, 8, 6), glow(0xFFE0A0, 3), Math.cos(k / 12 * Math.PI * 2) * 1.1, 0.12, Math.sin(k / 12 * Math.PI * 2) * 1.1, false);
      add(ch, new THREE.CylinderGeometry(0.02, 0.02, 2.4, 6), gold, 0, 1.2, 0);
      const pl = new THREE.PointLight(0xFFD49A, 40, 26, 2); pl.position.set(0, -0.2, 0); ch.add(pl); lights.push(pl);
    }
  }
  g.traverse((m) => { if (m.isMesh && m.material === wallM) m.name = 'wall'; });
  return { group: g, lights, size: [W, H, L] };
}

// ── E1 v2: the interior void ─────────────────────────────────────────────────────────────────────────────────────
// Any scene with an interior.* room gets this world (core/registry.js): a flat floor at 0 and nothing else. No sea,
// terrain, flora or clouds exist to show inside the room (the Titanic study stood in the ocean world and the swell
// came up through its floor). Outside the room a dark ground; the sky is kept cloudless (hints.sky = 'interior').
export async function buildWorld(world = {}, look = {}, ctx = {}) {
  const root = new THREE.Group(); root.name = 'world.interior';
  const g = new THREE.CircleGeometry(600, 48); g.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(g, plain({ color: 0x0c0d10, roughness: 1 }));
  floor.name = 'void_floor'; floor.position.y = -0.03; floor.receiveShadow = true; floor.userData.ground = true; floor.userData.noQA = true;
  root.add(floor);
  if (ctx.scene) ctx.scene.add(root);
  return { ground: { height: () => 0, normal: () => [0, 1, 0], level: null }, update() {}, root, hints: { sky: 'interior', fog: 0, haze: 0 }, warnings: [], biome: 'interior' };
}
const nightOf = (ctx) => { const t = String(ctx?.lookSpec?.time || ''); return t === 'night' ? 1 : t === 'dusk' ? 0.7 : 0; };

export const CATALOG = {
  'world.interior': { desc: 'the interior void: any scene with an interior.* room gets it automatically (flat floor, no sea, terrain or clouds)', section: 'world', biome: 'interior', world: true, actions: [], params: {}, footprint: [0, 0], height: 0, tags: ['biome', 'interior'] },
  'interior.cellar': { desc: 'WW2 command-post cellar (Bastogne "Nuts" cellar): whitewashed brick vault, map table under a hurricane lamp, typewriter typing `text`', params: { at: '[x, z]', heading: 'deg', text: 'typed text', typing_start: 's' }, footprint: [4, 6], height: 2.7, tags: ['interior', '1940s', 'war'] },
  'interior.bunker': { desc: 'alias of interior.cellar', params: { at: '[x, z]', heading: 'deg' }, footprint: [4, 6], height: 2.7, tags: ['interior', 'war'] },
  'interior.office': { desc: 'mid-century office: desk with lamp and papers, chair, bookcase, filing cabinets, venetian-blind window light', params: { at: '[x, z]', heading: 'deg' }, footprint: [5, 7], height: 3, tags: ['interior', '1950s', 'modern'] },
  'interior.study': { desc: 'wood-panelled study: desk with a green banker\'s lamp, bookshelves, leather armchair, fireplace glow, rug', params: { at: '[x, z]', heading: 'deg' }, footprint: [5, 6.5], height: 3.2, tags: ['interior', '1800s', '1900s'] },
  'interior.palace_hall': { desc: 'palace hall: marble checker floor, colonnades, tall windows, chandeliers, red runner, throne', params: { at: '[x, z]', heading: 'deg' }, footprint: [14, 34], height: 11, tags: ['interior', 'royalty'] },
  ...ROOM_CATALOG,   // Q9: storm_cellar, small_room, cell, landmark.boat_sheds (rooms.js)
};
export async function build(kind, item = {}, ctx = {}) {
  RectAreaLightUniformsLib.init();
  const G = ground(ctx), at = xz(item.at), y = G.h(at[0], at[1]);
  const root = new THREE.Group(); root.name = kind;
  // Q9: the root sits at the item (camera targets and DOF aim at the root); world transforms are unchanged
  root.position.set(at[0], y, at[1]);
  const place = new THREE.Group(); place.rotation.y = yawFromHeading(item.heading ?? 180) - (kind === 'landmark.boat_sheds' ? 0 : Math.PI); root.add(place);   // boat sheds: the arches face the heading
  let update = () => {}, anchors = { center: place }, radius = 5, height = 3;
  if (ROOM_CATALOG[kind]) {            // Q9 sets (rooms.js): each its own place
    const r = await buildRoom(kind, item, ctx);
    if (kind.startsWith('interior.')) r.group.userData.noQA = true;   // a small room is filmed from inside: its walls and shelves are not camera obstacles
    place.add(r.group); radius = Math.hypot(r.size[0], r.size[2]) / 2; height = r.size[1];
    for (const [k, v] of Object.entries(r.anchors || {})) if (Array.isArray(v) && v.length === 3 && typeof v[0] === 'number') { const a = new THREE.Object3D(); a.position.set(v[0], v[1], v[2]); place.add(a); anchors[k] = a; }
    const parts = [...(r.upd || [])];
    if (kind === 'landmark.boat_sheds' && r.people > 0) {        // seated, huddled people in the vaults (crowd, earth tones)
      root.updateMatrixWorld(true);
      const R = (ctx.rng ? ctx.rng(item.seed ?? 79) : null) || (() => Math.random()), per = Math.ceil(r.people / r.bays.length);
      const tones = [['#B98B5E', '#8C6A4F'], ['#C9B28A', '#7E5C44'], ['#A7835A', '#6F5A48'], ['#8E7A62', '#5E4E40'], ['#D1BE98', '#8A7458']];
      let left = r.people;
      for (let i = 0; i < r.bays.length && left > 0; i++) {
        const [lx, lz] = r.bays[i], w = new THREE.Vector3(lx, 0, lz).applyMatrix4(place.matrixWorld), c = tones[i % tones.length], cnt = Math.min(left, per);
        try {
          const gr = await crowd.build('figure.' + (item.kit || 'ancient_robe'), { count: cnt, formation: 'crowd', at: [w.x, w.z], size: [r.span * 0.8, r.depth * 0.55], heading: item.heading ?? 180, action: i % 3 === 2 ? 'kneel' : 'sit_ground', colors: { coat: c[0], trousers: c[1], accent: c[0] }, seed: (item.seed ?? 1) * 31 + i }, ctx);
          if (gr && gr.root) { gr.root.position.sub(root.position); root.add(gr.root); if (gr.update) parts.push((t) => gr.update(t)); }   // the crowd is in world space
        } catch (e) { (ctx.warnings || []).push('boat_sheds people: ' + String(e).slice(0, 120)); }
        left -= cnt;
      }
    }
    update = (t) => { for (const f of parts) f(t); };
  } else if (kind === 'interior.cellar' || kind === 'interior.bunker') {
    const hq = await buildHQ({});
    for (const c of [...hq.scene.children]) place.add(c);
    const text = item.text ?? NUTS_TEXT, start = item.typing_start ?? 2;
    update = (t) => hq.update(t, { typing: typingAt(t, { start, text }) });
    anchors = { ...anchors, ...(hq.anchors || {}) }; radius = 4; height = 2.7;
  } else {
    const r = room(kind.replace('interior.', ''), { ...item, night: nightOf(ctx) });
    place.add(r.group); radius = Math.hypot(r.size[0], r.size[2]) / 2; height = r.size[1];
    anchors.desk = new THREE.Object3D(); anchors.desk.position.set(0.3, 0.8, -0.6); place.add(anchors.desk);
    anchors.window = new THREE.Object3D(); anchors.window.position.set(r.size[0] / 2, 1.8, 0); place.add(anchors.window);
  }
  update(0);
  patchAll(root, ctx);
  return { root, radius, height, update: (t) => update(t), anchors, interior: true };
}
