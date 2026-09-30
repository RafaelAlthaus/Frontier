// vehicles.js — ships, ground vehicles, aircraft and rockets. Models face +Z, origin on the ground (waterline for ships)
// at their centre. Actions: idle | drive | sail | fly | launch; motion is along `path` ([[x, z]...]) or straight along
// `heading` at `speed` m/s, deterministic in t (distance = speed * t, eased in if `start` > 0). Ground vehicles pitch and
// roll with the terrain under their wheels; ships ride the water level with a slow roll; aircraft hold `alt` metres
// above the ground and bank into turns. Wheels, tracks and propellers turn with the distance travelled.
// Hooks (anchors): dust (rear wheels), wake (stern), exhaust, lights — for the engine's particle systems.
import * as THREE from 'three';
import { buildSherman } from './sherman.js';
import { buildTruck, buildJeep } from './wwvehicles.js';
import { buildShip } from './ship.js';
import { buildTitanic } from './titanic.js';
import { buildModernCar } from './car.js';
import { buildTroller, addCrew, buildLongtail } from './boats.js';
import * as TX from './textures.js';
import { plain } from '../shared/materials.js';
import { U } from '../shared/env.js';
import { clamp, lerp, smooth, smoother } from '../shared/util.js';
import { ground, xz, DEG, patchAll } from './common.js';
import { smoothTrack, speedProfile, turnRadius } from './motion.js';
import { sinkPlan, sectionMatrix, splitAt, buildSinkFX } from './sinking.js';
import { ensureUnderwater } from '../fx/e2_under.js';
import * as R from './rig.js';

const TAU = Math.PI * 2, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const LIGHTS = () => smooth((0.12 - U.uSunDir.value.y) / 0.2);
const mesh = (g, m, parent) => { const x = new THREE.Mesh(g, m); x.castShadow = x.receiveShadow = true; if (parent) parent.add(x); return x; };

// ── procedural cars (three eras) ──────────────────────────────────────────────────────────────────────────────
// side profile (z, y) of the body extruded across its width with rounded edges; glass band; wheels on their own pivots
const CARS = {
  car_1920: { L: 4.0, W: 1.65, wr: 0.36, wb: 2.8, track: 1.4, color: 0x151515, prof: [[-2.0, 0.55], [-2.0, 1.0], [-1.1, 1.05], [-1.0, 1.8], [0.3, 1.8], [0.35, 1.05], [1.95, 1.0], [2.0, 0.55]], glass: [[-0.95, 1.12], [-0.9, 1.72], [0.25, 1.72], [0.3, 1.12]], fenders: true },
  car_1960: { L: 5.2, W: 1.95, wr: 0.35, wb: 3.0, track: 1.6, color: 0x7A1E24, prof: [[-2.6, 0.45], [-2.6, 0.92], [-0.9, 0.95], [-0.5, 1.42], [0.7, 1.42], [1.1, 0.95], [2.6, 0.88], [2.6, 0.45]], glass: [[-0.8, 1.0], [-0.45, 1.36], [0.65, 1.36], [1.0, 1.0]] },
  car_modern: { L: 4.6, W: 1.85, wr: 0.34, wb: 2.75, track: 1.58, color: 0x2A3440, prof: [[-2.3, 0.4], [-2.32, 0.98], [-1.2, 1.1], [-0.5, 1.48], [0.6, 1.46], [1.25, 1.02], [2.3, 0.82], [2.3, 0.4]], glass: [[-1.1, 1.12], [-0.45, 1.42], [0.55, 1.42], [1.15, 1.05]] },
};
function buildCar(kind, o = {}) {
  const C = CARS[kind], group = new THREE.Group(); group.name = kind;
  const body = new THREE.Group(); group.add(body);
  const paint = plain({ color: o.color != null ? new THREE.Color(o.color).getHex() : C.color, roughness: 0.28, metalness: 0.55, envMapIntensity: 1.2 });
  const glass = plain({ color: 0x1A2228, roughness: 0.05, metalness: 0.2, envMapIntensity: 1.6 });
  const chrome = plain({ color: 0xD8D8D8, roughness: 0.15, metalness: 1 });
  const tyre = plain({ color: 0x141414, roughness: 0.85 }), dark = plain({ color: 0x0E0E10, roughness: 0.7 }), lamp = plain({ color: 0xFFF4DC, emissive: 0xFFE8B0, emissiveIntensity: 0.2, roughness: 0.2 });
  const shape = new THREE.Shape(C.prof.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: C.W - 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 4, curveSegments: 8 });
  g.translate(0, 0, -(C.W - 0.16) / 2); g.rotateY(-Math.PI / 2); mesh(g, paint, body);
  const gs = new THREE.Shape(C.glass.map(([z, y]) => new THREE.Vector2(z, y)));
  const gg = new THREE.ExtrudeGeometry(gs, { depth: C.W - 0.1, bevelEnabled: false }); gg.translate(0, 0, -(C.W - 0.1) / 2); gg.rotateY(-Math.PI / 2); mesh(gg, glass, body);
  const zf = C.prof[C.prof.length - 1][0], zr = C.prof[0][0];
  for (const s of [1, -1]) { mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16).rotateX(Math.PI / 2).translate(s * (C.W / 2 - 0.3), 0.75, zf + 0.02), lamp, body); mesh(new THREE.BoxGeometry(0.22, 0.08, 0.04).translate(s * (C.W / 2 - 0.25), 0.78, zr - 0.02), plain({ color: 0x8A1010, emissive: 0x400000, roughness: 0.3 }), body); }
  mesh(new THREE.BoxGeometry(C.W - 0.05, 0.12, 0.1).translate(0, 0.45, zf + 0.04), chrome, body); mesh(new THREE.BoxGeometry(C.W - 0.05, 0.12, 0.1).translate(0, 0.45, zr - 0.04), chrome, body);
  if (C.fenders) for (const s of [1, -1]) for (const z of [C.wb / 2, -C.wb / 2]) { const f = new THREE.CylinderGeometry(C.wr + 0.08, C.wr + 0.08, 0.26, 16, 1, true, -Math.PI / 2, Math.PI); f.rotateZ(Math.PI / 2); f.translate(s * (C.W / 2 + 0.02), C.wr, z); mesh(f, paint, body); }
  mesh(new THREE.BoxGeometry(C.W - 0.3, 0.2, C.L - 0.6).translate(0, 0.32, 0), dark, body);
  const wheels = [];
  for (const s of [1, -1]) for (const z of [C.wb / 2, -C.wb / 2]) {
    const w = new THREE.Group(); w.position.set(s * C.track / 2, C.wr, z); group.add(w);
    mesh(new THREE.TorusGeometry(C.wr * 0.72, C.wr * 0.28, 10, 24).rotateY(Math.PI / 2), tyre, w);
    mesh(new THREE.CylinderGeometry(C.wr * 0.52, C.wr * 0.52, 0.16, 16).rotateZ(Math.PI / 2), kind === 'car_1920' ? dark : chrome, w);
    for (let k = 0; k < 5; k++) mesh(new THREE.BoxGeometry(0.03, C.wr * 0.8, 0.05).rotateX(k / 5 * TAU).translate(s * 0.09, 0, 0), dark, w);
    wheels.push(w);
  }
  return { group, update: (t, s = {}) => { for (const w of wheels) w.rotation.x = (s.distance ?? 0) / C.wr; }, wheelbase: C.wb, track: C.track, length: C.L, width: C.W, anchors: { dust: [V3(0, 0.2, zr)], exhaust: V3(0.4, 0.3, zr) } };
}

function mirrorX(g) { g.scale(-1, 1, 1); const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.index.needsUpdate = true; g.computeVertexNormals(); return g; }
// ── aircraft ────────────────────────────────────────────────────────────────────────────────────────────────────
function wing(span, root, tip, thick, sweep = 0, dihedral = 0) {       // tapered wing panel along +X from the root
  const g = new THREE.BoxGeometry(1, 1, 1, 8, 1, 4); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, c = lerp(root, tip, u), z = p.getZ(i), y = p.getY(i);
    const zz = z * c - u * sweep, yy = y * thick * c * (1 - 0.6 * Math.abs(z * 2) ** 2) + u * span * dihedral;
    p.setXYZ(i, u * span, yy, zz + (z > 0 ? 0 : 0));
  }
  g.computeVertexNormals(); return g;
}
function fuselage(len, r, o = {}) {       // lathe along +Z: nose at +len/2
  const pts = []; const n = 24;
  for (let i = 0; i <= n; i++) { const t = i / n, z = lerp(-len / 2, len / 2, t); const k = o.profile ? o.profile(t) : Math.min(1, Math.sin(Math.PI * clamp(t * 0.98 + 0.01)) ** 0.5 * 1.15); pts.push(new THREE.Vector2(Math.max(0.001, r * k), z)); }
  const g = new THREE.LatheGeometry(pts, 24); g.rotateX(Math.PI / 2); return g;
}
function buildAircraft(kind, o = {}) {
  const group = new THREE.Group(); group.name = kind; const body = new THREE.Group(); group.add(body);
  const col = o.color != null ? new THREE.Color(o.color).getHex() : { biplane: 0xC8B890, fighter_ww2: 0x5A6040, bomber_ww2: 0x9CA0A4, airliner: 0xF0F0F2 }[kind];
  const skin = plain({ color: col, roughness: kind === 'bomber_ww2' || kind === 'airliner' ? 0.3 : 0.6, metalness: kind === 'bomber_ww2' ? 0.8 : kind === 'airliner' ? 0.3 : 0.1 });
  const dark = plain({ color: 0x151515, roughness: 0.5 }), glass = plain({ color: 0x223040, roughness: 0.05, metalness: 0.3, envMapIntensity: 1.5 }), accent = plain({ color: o.accent != null ? new THREE.Color(o.accent).getHex() : 0x1E3A8A, roughness: 0.5 });
  const props = [];
  const prop = (x, y, z, r, blades = 3) => { const p = new THREE.Group(); p.position.set(x, y, z); body.add(p); for (let k = 0; k < blades; k++) mesh(new THREE.BoxGeometry(0.12, r, 0.03).translate(0, r / 2, 0).rotateZ(k / blades * TAU), dark, p); mesh(new THREE.ConeGeometry(0.16, 0.35, 12).rotateX(Math.PI / 2).translate(0, 0, 0.15), skin, p);
    const disc = mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }), p); disc.castShadow = false; p.userData.disc = disc; props.push(p); return p; };
  let span = 10, len = 8, cruise = 60;
  if (kind === 'biplane') {
    span = 9; len = 7; cruise = 40;
    mesh(fuselage(7, 0.55), skin, body);
    for (const y of [-0.35, 1.25]) for (const s of [1, -1]) { const w = wing(4.4, 1.5, 1.4, 0.08, 0, 0.02); if (s < 0) mirrorX(w); w.translate(0, y, 0.6); mesh(w, skin, body); }
    for (const s of [1, -1]) for (const z of [0.1, 1.2]) mesh(R.rod(V3(s * 2.6, -0.3, z), V3(s * 2.6, 1.2, z), 0.03, 0.03, 6), dark, body);
    mesh(wing(1.6, 1.0, 0.7, 0.06).translate(0, 0.1, -3.1), skin, body); mesh(mirrorX(wing(1.6, 1.0, 0.7, 0.06)).translate(0, 0.1, -3.1), skin, body);
    mesh(new THREE.BoxGeometry(0.06, 1.1, 1.0).translate(0, 0.6, -3.2), skin, body);
    prop(0, 0, 3.55, 1.25, 2);
    for (const s of [1, -1]) { mesh(R.rod(V3(s * 0.2, -0.4, 1.0), V3(s * 0.8, -1.25, 1.0), 0.03, 0.03, 6), dark, body); mesh(new THREE.TorusGeometry(0.28, 0.1, 8, 16).rotateY(Math.PI / 2).translate(s * 0.85, -1.3, 1.0), dark, body); }
  } else if (kind === 'fighter_ww2') {
    span = 11.3; len = 9.8; cruise = 110;
    mesh(fuselage(9.6, 0.65, { profile: (t) => Math.min(1, Math.sin(Math.PI * clamp(t * 0.9 + 0.08)) ** 0.45 * 1.1) * (t < 0.3 ? lerp(0.45, 1, t / 0.3) : 1) }), skin, body);
    for (const s of [1, -1]) { const w = wing(5.6, 2.6, 1.1, 0.1, 0.2, 0.08); if (s < 0) mirrorX(w); w.translate(0, -0.35, 0.8); mesh(w, skin, body); }
    for (const s of [1, -1]) { const w = wing(2.1, 1.4, 0.7, 0.06, 0.2); if (s < 0) mirrorX(w); w.translate(0, 0.15, -4.1); mesh(w, skin, body); }
    mesh(new THREE.BoxGeometry(0.08, 1.5, 1.4).translate(0, 0.8, -4.2), skin, body);
    mesh(new THREE.SphereGeometry(0.5, 16, 10, 0, TAU, 0, Math.PI / 2).scale(0.9, 0.9, 2.2).translate(0, 0.45, 0.4), glass, body);
    mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 20).rotateX(Math.PI / 2).translate(0, 0, 4.5), accent, body);
    prop(0, 0, 4.9, 1.7, 3);
  } else if (kind === 'bomber_ww2') {
    span = 31.6; len = 22.7; cruise = 75;
    mesh(fuselage(22.5, 1.25), skin, body);
    for (const s of [1, -1]) { const w = wing(15.6, 5.2, 1.8, 0.12, 0.6, 0.04); if (s < 0) mirrorX(w); w.translate(0, 0.2, 2.5); mesh(w, skin, body); }
    for (const s of [1, -1]) { const w = wing(5.2, 3.2, 1.4, 0.07, 0.4); if (s < 0) mirrorX(w); w.translate(0, 0.6, -9.6); mesh(w, skin, body); }
    mesh(new THREE.BoxGeometry(0.14, 5.4, 3.6).translate(0, 3.0, -9.2), skin, body);
    for (const x of [-9.2, -4.4, 4.4, 9.2]) { mesh(new THREE.CylinderGeometry(0.7, 0.6, 3.2, 16).rotateX(Math.PI / 2).translate(x, 0.05, 4.2), skin, body); prop(x, 0.05, 5.95, 1.9, 3); }
    mesh(new THREE.SphereGeometry(1.2, 16, 12).scale(1, 1, 1.4).translate(0, 0.1, 10.8), glass, body);
  } else {   // airliner
    span = 35.8; len = 37.6; cruise = 230;
    mesh(fuselage(37, 1.95, { profile: (t) => (t < 0.12 ? Math.sin(t / 0.12 * Math.PI / 2) ** 0.7 : t > 0.86 ? lerp(1, 0.35, (t - 0.86) / 0.14) : 1) }), skin, body);
    for (const s of [1, -1]) { const w = wing(16.5, 7, 1.6, 0.11, 6.5, 0.1); if (s < 0) mirrorX(w); w.translate(0, -1.0, 2.0); mesh(w, skin, body); const e = mesh(new THREE.CylinderGeometry(1.1, 0.9, 4, 20).rotateX(Math.PI / 2).translate(s * 5.8, -1.9, 3.8), skin, body); }
    for (const s of [1, -1]) { const w = wing(6.2, 3.8, 1.3, 0.08, 3.2, 0.12); if (s < 0) mirrorX(w); w.translate(0, 0.7, -16.0); mesh(w, skin, body); }
    const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(-5.5, 0); fin.lineTo(-7.8, 7); fin.lineTo(-5.8, 7); fin.lineTo(0, 0);
    mesh(new THREE.ExtrudeGeometry(fin, { depth: 0.3, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.15, 1.5, -12.5), accent, body);
    mesh(new THREE.BoxGeometry(3.95, 0.35, 30).translate(0, 0.6, 0.5), accent, body);          // cheat line
    for (let k = 0; k < 28; k++) for (const s of [1, -1]) mesh(new THREE.BoxGeometry(0.02, 0.3, 0.22).translate(s * 1.94, 0.9, -12 + k * 0.95), glass, body);
  }
  const L = new THREE.PointLight(0xFF3030, 0.0, 30); body.add(L);
  return { group, body, props, span, length: len, cruise, update(t, s = {}) { const spin = (s.rpm ?? 1) * t * TAU * 22; for (const p of props) { p.rotation.z = spin; p.userData.disc.visible = (s.rpm ?? 1) > 0.3; } } };
}

// ── rocket ──────────────────────────────────────────────────────────────────────────────────────────────────────
function buildRocket(o = {}) {
  const group = new THREE.Group(); group.name = 'rocket'; const body = new THREE.Group(); group.add(body);
  const white = plain({ color: 0xF0EEE8, roughness: 0.5 }), black = plain({ color: 0x151515, roughness: 0.5 }), metal = plain({ color: 0x9A9A9A, roughness: 0.3, metalness: 0.9 });
  const stages = [[0, 42, 5.0, white], [42, 25, 5.0, white], [67, 18, 3.3, white], [85, 5, 3.3, black], [90, 8, 1.95, white]];
  for (const [y, h, r, m] of stages) mesh(new THREE.CylinderGeometry(r, r, h, 40).translate(0, y + h / 2, 0), m, body);
  mesh(new THREE.CylinderGeometry(3.3, 5.0, 6, 40).translate(0, 64, 0), white, body);
  mesh(new THREE.ConeGeometry(1.95, 5, 32).translate(0, 100.5, 0), white, body); mesh(new THREE.CylinderGeometry(0.15, 0.3, 8, 8).translate(0, 106, 0), metal, body);
  for (let k = 0; k < 4; k++) { const f = new THREE.BoxGeometry(0.3, 7, 3.5).translate(6.0, 3.5, 0); f.rotateY(k * Math.PI / 2 + Math.PI / 4); mesh(f, black, body); }
  for (let k = 0; k < 8; k++) mesh(new THREE.BoxGeometry(5.05 * 2 + 0.02, 3, 0.02).rotateY(k * Math.PI / 8).translate(0, 30, 0), black, body);
  for (let k = 0; k < 5; k++) { const a = k / 4 * TAU, rr = k === 4 ? 0 : 2.4; mesh(new THREE.CylinderGeometry(0.8, 1.9, 5, 20, 1, true).translate(Math.cos(a) * rr, -2.5, Math.sin(a) * rr), metal, body); }
  const flameM = new THREE.MeshBasicMaterial({ color: 0xFFC060, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = mesh(new THREE.ConeGeometry(4.2, 40, 24, 1, true).rotateX(Math.PI).translate(0, -24, 0), flameM, body); flame.castShadow = false;
  const core = mesh(new THREE.ConeGeometry(2.4, 18, 16, 1, true).rotateX(Math.PI).translate(0, -12, 0), new THREE.MeshBasicMaterial({ color: 0xFFFFF0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }), body); core.castShadow = false;
  const light = new THREE.PointLight(0xFFB060, 0, 600, 1.5); light.position.set(0, -10, 0); body.add(light);
  return { group, body, update(t, s = {}) { const k = s.thrust ?? 0; flame.visible = core.visible = k > 0.01; flame.scale.set(1 + 0.05 * Math.sin(t * 43), k * (1 + 0.08 * Math.sin(t * 31)), 1 + 0.05 * Math.sin(t * 37)); core.scale.set(1, k, 1); light.intensity = k * 3e5; }, height: 110 };
}

// ── ships (warship, rowboat) ─────────────────────────────────────────────────────────────────────────────────────
function hullLoft(L, B, D, o = {}) {
  const rows = [], n = 40, m = 20;
  for (let i = 0; i <= n; i++) {
    const s = i / n, z = (s - 0.5) * L, fine = o.fine ?? 0.6;
    const half = B / 2 * Math.pow(Math.sin(Math.PI * clamp(s * 0.97 + 0.02)), s > 0.5 ? fine : 0.25), row = [];
    for (let j = 0; j <= m; j++) { const th = j / m * Math.PI - Math.PI / 2, a = Math.abs(th); row.push(V3(Math.sign(th) * half * Math.pow(Math.sin(a), 0.5), -D * Math.cos(a) ** 1.4 * (1 - 0.3 * (1 - Math.sin(Math.PI * s))) + (o.sheer ?? 0) * (1 - Math.sin(Math.PI * s)), z)); }
    rows.push(row);
  }
  return R.loft(rows, { closed: false, capStart: true, capEnd: true });
}
function buildWarship(o = {}) {
  const group = new THREE.Group(); group.name = 'warship';
  const grey = plain({ color: 0x7A8088, roughness: 0.6, metalness: 0.2 }), dark = plain({ color: 0x3A3E44, roughness: 0.6 }), red = plain({ color: 0x6A2420, roughness: 0.7 }), deck = plain({ color: 0x8A7A62, roughness: 0.85 });
  const L = 180, B = 26, D = 9;
  const hull = hullLoft(L, B, D + 7, { fine: 0.7, sheer: 1.5 }); hull.translate(0, 7, 0); mesh(hull, grey, group);
  const boot = hullLoft(L * 0.995, B * 0.995, D + 0.2, { fine: 0.7 }); boot.translate(0, 0.2, 0); mesh(boot, red, group);
  mesh(new THREE.BoxGeometry(B * 0.92, 0.3, L * 0.86).translate(0, 7.1, -2), deck, group);
  mesh(new THREE.BoxGeometry(14, 8, 40).translate(0, 11, 4), grey, group); mesh(new THREE.BoxGeometry(9, 9, 12).translate(0, 19, 14), grey, group); mesh(new THREE.BoxGeometry(6, 4, 7).translate(0, 25.5, 16), dark, group);
  mesh(new THREE.CylinderGeometry(0.8, 1.2, 26, 12).translate(0, 32, 14), dark, group);
  for (const z of [-4, 6]) mesh(new THREE.CylinderGeometry(3.2, 3.6, 12, 20).scale(1, 1, 1.4).translate(0, 18, z - 8), grey, group);
  for (const [z, fwd] of [[52, 1], [36, 1], [-44, -1], [-60, -1]]) { const t = new THREE.Group(); t.position.set(0, 7.2, z); group.add(t); mesh(new THREE.CylinderGeometry(5.5, 6, 3.2, 24).translate(0, 1.6, 0), grey, t); for (const x of [-1.2, 0, 1.2]) mesh(new THREE.CylinderGeometry(0.4, 0.5, 14, 10).rotateX(Math.PI / 2).translate(x, 2.2, fwd * 8), dark, t); }
  return { group, length: L, update() {} };
}
function buildRowboat(o = {}) {
  const group = new THREE.Group(); group.name = 'rowboat';
  const tex = TX.planks({ size: 256, meters: 2, tone: '#5A4030', tone2: '#7A5A40', seed: 3 });
  const wood = plain({ map: tex.map, normalMap: tex.normalMap, color: o.color != null ? new THREE.Color(o.color).getHex() : 0xA89070, roughness: 0.8, side: THREE.DoubleSide });
  const g = hullLoft(4.6, 1.5, 0.55, { fine: 0.5, sheer: 0.25 }); g.translate(0, 0.35, 0); mesh(g, wood, group);
  for (const z of [-1.0, 0.2, 1.3]) mesh(new THREE.BoxGeometry(1.3, 0.05, 0.25).translate(0, 0.25, z), wood, group);
  const oars = [];
  for (const s of [1, -1]) { const p = new THREE.Group(); p.position.set(s * 0.7, 0.45, 0.2); group.add(p); mesh(R.rod(V3(0, 0, 0), V3(s * 2.2, -0.5, 0), 0.03, 0.03, 6), wood, p); mesh(new THREE.BoxGeometry(0.06, 0.02, 0.6).translate(s * 2.2, -0.52, 0), wood, p); oars.push(p); }
  return { group, length: 4.6, update(t, s = {}) { const ph = (s.distance ?? 0) / 2.2 * TAU; for (const [i, p] of oars.entries()) { p.rotation.y = (i ? -1 : 1) * 0.5 * Math.sin(ph); p.rotation.z = (i ? -1 : 1) * 0.15 * Math.max(0, Math.cos(ph)); } } };
}

// ── catalog ────────────────────────────────────────────────────────────────────────────────────────────────────
const MOVE = { at: '[x, z]', heading: 'deg (0 = north)', action: 'idle|drive|sail|fly|launch', speed: 'm/s', path: "[[x, z], ...] waypoints: followed as a smooth track (corners filleted and low-passed to the vehicle's turning radius; heading never snaps; ships pivot a third aft of the bow, heel outward; aircraft bank)", turn_radius: 'm (default: liner 1.6 x length, ships 1.3 x, cars ~5, aircraft v^2/g)', start: 's: starts from rest here (eased)', stop: 'true: eases to rest at the path end (default: carries on straight)' };
const SINK = { t0: 's the sinking starts (default 0)', dur: 's it takes (any length: the stages scale; default 20)', mode: 'bow_first | list | capsize | break (ship.liner_1912 default: break)', trim_max: 'deg bow-down before the break / the plunge (liner 32, bow_first 24)', list_max: 'deg, + to port (list 28, others 6)', break_at: '0 bow .. 1 stern (liner: 0.546 = between funnels 3 and 4)', lights_out_at: 's scene time the lights die (they flicker for ~6 % of dur before; default 66 % of dur)', final: 'under (default) | awash' };
export const CATALOG = {
  'ship.liner_1912': { desc: "RMS Titanic-class ocean liner (269 m; plays other liners honestly: funnels 1-4, length, livery white_star | cunard, name on the bows. The Carpathia = {funnels: 1, length: 170, livery: 'cunard', name: 'CARPATHIA'}; Olympic = the default with name 'OLYMPIC'): four funnels, lit portholes at night, 16 lifeboats in davits, bow wave, and a stern wake laid along the track she really took. action sail follows `path` smoothly (turning circle ~430 m: a 18 deg turn takes ~10 s at 11 m/s; the stern swings out). action sink (E2 v2, mode break): the bow settles, the forecastle goes awash, the boat deck floods, the stern rises to trim_max, the lights flicker and die at lights_out_at, the hull breaks between funnels 3 and 4, the stern falls back, stands up vertical and slips under; foam at the waterline, a churned patch and wreckage spreading on the water. Named points for cameras, flares and figures ('<ref>.<anchor>'): bow, forecastle, crows_nest, bridge, bridge_wing (port), bridge_wing_starboard, well_deck, boat_deck, boat_deck_starboard, stern_deck, stern, funnel_1..funnel_4 (tops), boat_port_1..8 / boat_starboard_1..8 (davit heads, fore to aft), midship", actions: ['idle', 'sail', 'sink'], params: { ...MOVE, ...SINK, sink: '{...} the sink params as one object (optional)', lamps: '0..1 (auto at night)', funnels: '1..4 (default 4)', length: 'm (default 269; the hull is scaled along its axis, beam and heights by the square root; people keep their size)', livery: "white_star (default: black hull, white superstructure, buff funnels with black tops) | cunard (black hull, white upperworks, red funnels with black tops and two thin black bands)", name: 'the name on the bows (default TITANIC)', cutaway: "{side: 'starboard' (default: that side sectioned away) | 'port', compartments: 16 (her 15 watertight bulkheads to E deck), flood: [{t, n}] how many compartments from the bow are flooded at t (fractions fill the next), water_level_rise: true} a documentary cutaway: the cut hull, the bulkheads, the water filling compartment after compartment and spilling over each bulkhead top into the next as she trims (use with action sink)" }, footprint: [28, 269], height: 55, tags: ['ship', '1910s', 'titanic', 'sinking', 'liner', 'carpathia', 'olympic'] },
  'ship.sailing_ancient': { desc: 'Roman-era grain ship: round hull, square mainsail, steering oars, two sailors (40 m)', actions: ['idle', 'sail', 'sink'], params: { ...MOVE, ...SINK, sail: 'true|false' }, footprint: [10.5, 40], height: 30, tags: ['ship', 'ancient'] },
  'ship.warship': { desc: 'steel battleship c.1914-1945 (180 m): turrets, bridge, funnels, masts', actions: ['idle', 'sail', 'sink'], params: { ...MOVE, ...SINK }, footprint: [26, 180], height: 45, tags: ['ship', 'war', '1940s'] },
  'ship.rowboat': { desc: 'wooden rowing boat / skiff, oars sweeping with the distance travelled; idle it rides the swell', actions: ['idle', 'sail', 'sink'], params: { ...MOVE, ...SINK, color: 'hex', crew: '0..2 or [castRef|{kit, colors}] (seated)', keys: '[{t, at, y, pitch, roll, heading}] eased override' }, footprint: [1.5, 4.6], height: 1, tags: ['ship', 'boat'] },
  'ship.longtail': { desc: 'Thai longtail boat (10 m): narrow wooden hull with painted bands, high upswept bow wrapped in garlands and cloth, canvas sunroof, engine with a long propeller shaft; beached: true rests it on the sand', actions: ['idle', 'sail', 'sink'], params: { ...MOVE, ...SINK, color: 'band hex', canopy: 'true|false', beached: 'true: rests on the ground (sand) instead of floating', crew: '0..2' }, footprint: [1.5, 10], height: 2.2, tags: ['ship', 'boat', 'thailand', 'modern'] },
  'ship.troller': { desc: '1950s wooden salmon troller (12 m): white hull, red bottom, wheelhouse with name boards, mast with two trolling poles out, rigging, gurdies, riding lights at dusk, crew on deck; idle it rides the swell and swings on its anchor', actions: ['idle', 'sail', 'sink'], params: { ...MOVE, ...SINK, crew: '0..3 or [castRef|{kit, colors}] (default 1)', name: 'EDRIE', color: 'hull hex', trim: 'hex', poles: 'out|up', lights: 'auto|true|false', anchored: 'true|false', keys: '[{t, at, y, pitch, roll, heading}] eased override (y metres above the water, degrees)' }, footprint: [3.7, 12.2], height: 10, tags: ['ship', 'boat', '1950s'] },
  'vehicle.tank_ww2': { desc: 'WW2 medium tank (M4A3E2 Sherman "Jumbo"): tracks and wheels roll with the distance, turret yaw', actions: ['idle', 'drive'], params: { ...MOVE, turret: 'deg', gun: 'deg', snow: '0..1' }, footprint: [3, 6.3], height: 2.9, tags: ['vehicle', '1940s', 'war'] },
  'vehicle.truck_ww2': { desc: 'GMC CCKW 2½-ton 6x6 truck with canvas / troops', actions: ['idle', 'drive'], params: { ...MOVE, load: 'troops|canvas|empty', lights: 'bool' }, footprint: [2.3, 6.9], height: 2.9, tags: ['vehicle', '1940s', 'war'] },
  'vehicle.jeep': { desc: 'Willys MB jeep with up to 4 riders', actions: ['idle', 'drive'], params: { ...MOVE, riders: '0..4', windscreen: 'up|folded' }, footprint: [1.6, 3.4], height: 1.8, tags: ['vehicle', '1940s', 'war'] },
  'vehicle.car_1920': { desc: '1920s touring car (tall cabin, running boards, fenders)', actions: ['idle', 'drive'], params: { ...MOVE, color: 'hex' }, footprint: [1.7, 4], height: 1.9, tags: ['vehicle', '1920s'] },
  'vehicle.car_1960': { desc: '1960s sedan with chrome and fins', actions: ['idle', 'drive'], params: { ...MOVE, color: 'hex' }, footprint: [2, 5.2], height: 1.45, tags: ['vehicle', '1960s'] },
  'vehicle.car_modern': { desc: 'modern sedan (body suv: an SUV): hood, raked windshield, see-through tinted glass with seats inside, wheel arches, alloy rims spinning, mirrors; lights auto at dusk; driver when driving', actions: ['idle', 'drive'], params: { ...MOVE, body: 'sedan|suv', color: 'hex|white|black|silver|grey|red|blue|navy|beige|green (default: a seeded realistic mix)', skid: 's: fishtail from this time', skid_deg: 'deg (9)', lights: 'true|false|auto', beams: '0..1 visible headlight beams in haze', driver: 'true|false|castRef (default: true when driving)', footwell: 'true: front seats slid forward, a roomy rear footwell (a crouched cast figure fits below the windows)', roof: 'bags|box|rack', livery: 'police|none', interior: 'dark|beige', glass: 'tinted|clear (clear: low reflection, see inside under bright skies)', cabin_light: '0..2 warm dome/dash glow' }, footprint: [1.84, 4.85], height: 1.46, tags: ['vehicle', 'modern'] },
  'vehicle.car_suv': { desc: 'modern SUV (vehicle.car_modern with body suv): tall greenhouse, black arch cladding, dark rims', actions: ['idle', 'drive'], params: { ...MOVE, color: 'hex|name', lights: 'true|false|auto', beams: '0..1', driver: 'true|false', footwell: 'true|false', roof: 'bags|box|rack', livery: 'police|none' }, footprint: [1.9, 4.72], height: 1.76, tags: ['vehicle', 'modern'] },
  'aircraft.biplane': { desc: 'WW1-era biplane, spinning prop', actions: ['idle', 'fly'], params: { ...MOVE, alt: 'm above ground', color: 'hex' }, footprint: [9, 7], height: 3, tags: ['aircraft', '1910s'] },
  'aircraft.fighter_ww2': { desc: 'WW2 single-engine fighter (Mustang-like)', actions: ['idle', 'fly'], params: { ...MOVE, alt: 'm', color: 'hex', accent: 'hex' }, footprint: [11.3, 9.8], height: 4, tags: ['aircraft', '1940s', 'war'] },
  'aircraft.bomber_ww2': { desc: 'WW2 four-engine heavy bomber (B-17-like, bare metal)', actions: ['idle', 'fly'], params: { ...MOVE, alt: 'm' }, footprint: [31.6, 22.7], height: 6, tags: ['aircraft', '1940s', 'war'] },
  'aircraft.airliner': { desc: 'modern twin-engine airliner with livery stripe', actions: ['idle', 'fly'], params: { ...MOVE, alt: 'm', accent: 'hex' }, footprint: [35.8, 37.6], height: 12, tags: ['aircraft', 'modern'] },
  rocket: { desc: 'Saturn-V-like moon rocket; action launch: engines light at `start` s, it rises with growing speed', actions: ['idle', 'launch'], params: { at: '[x, z]', start: 's ignition', lift: 's lift-off after ignition' }, footprint: [20, 20], height: 110, tags: ['space', '1960s'] },
};
CATALOG['vehicle.truck'] = { ...CATALOG['vehicle.truck_ww2'], desc: 'alias of vehicle.truck_ww2' };
CATALOG['aircraft.rocket'] = { ...CATALOG.rocket, desc: 'alias of rocket' };

// ── build ──────────────────────────────────────────────────────────────────────────────────────────────────────
let SHIPTEX = null;
export async function build(kind, item = {}, ctx = {}) {
  const G = ground(ctx), warn = (m) => (ctx.warnings ? ctx.warnings.push(m) : console.warn('[f3d/human]', m));
  if (kind === 'vehicle.truck') kind = 'vehicle.truck_ww2'; if (kind === 'aircraft.rocket') kind = 'rocket';
  const cls = kind.startsWith('ship.') ? 'ship' : kind.startsWith('aircraft.') ? 'air' : kind === 'rocket' ? 'rocket' : 'ground';
  let v, lengthZ = 5, wheelbase = 3, track2 = 1.6, titan = null;
  if (kind === 'vehicle.tank_ww2') { v = buildSherman({ seed: item.seed ?? 1944, snow: item.snow ?? 0, name: item.name }); lengthZ = 6.3; wheelbase = 3.6; track2 = 2.6; }
  else if (kind === 'vehicle.truck_ww2') { v = buildTruck({ load: item.load ?? 'canvas', lights: item.lights ?? false, seed: item.seed ?? 1 }); lengthZ = 6.9; wheelbase = 4.2; track2 = 1.75; }
  else if (kind === 'vehicle.jeep') { v = buildJeep({ riders: item.riders ?? 2, windscreen: item.windscreen ?? 'up', seed: item.seed ?? 1 }); lengthZ = 3.4; wheelbase = 2.03; track2 = 1.25; }
  else if (kind === 'vehicle.car_modern' || kind === 'vehicle.car_suv') { v = buildModernCar({ ...item, body: kind === 'vehicle.car_suv' ? 'suv' : item.body ?? item.params?.body }, ctx); lengthZ = v.length; wheelbase = v.wheelbase; track2 = v.track; }
  else if (CARS[kind.replace('vehicle.', '')]) { v = buildCar(kind.replace('vehicle.', ''), item); const C = CARS[kind.replace('vehicle.', '')]; lengthZ = C.L; wheelbase = C.wb; track2 = C.track; }
  else if (cls === 'air') v = buildAircraft(kind.replace('aircraft.', ''), item);
  else if (kind === 'rocket') v = buildRocket(item);
  else if (kind === 'ship.sailing_ancient') { SHIPTEX ||= { planks: TX.planks({ meters: 4, tone: '#2A1E16', tone2: '#4A3626', seed: 5, pitch: 0.5 }), deck: TX.planks({ meters: 4, boardW: 0.18, tone: '#6A5238', tone2: '#8C7050', seed: 8 }), sail: TX.sail(1024) }; v = buildShip(SHIPTEX, {}); lengthZ = 40; if (item.sail === false) v.setSail?.(false); }
  else if (kind === 'ship.warship') { v = buildWarship(item); lengthZ = 180; }
  else if (kind === 'ship.rowboat') { v = buildRowboat(item); lengthZ = 4.6; if (item.crew) addCrew(v.group, item.crew, [{ x: 0, y: -0.19, z: 0.2, yaw: Math.PI, pose: 'seated' }, { x: 0, y: -0.19, z: -1.05, yaw: 0, pose: 'seated' }], ctx, item.seed ?? 2); }
  else if (kind === 'ship.troller') { v = buildTroller(item, ctx); lengthZ = v.length; }
  else if (kind === 'ship.longtail') { v = buildLongtail(item); lengthZ = v.length; if (item.crew) addCrew(v.group, item.crew, [{ x: 0, y: 0.1, z: -4.2, yaw: 0, pose: 'stand' }, { x: 0.2, y: -0.2, z: 0.4, yaw: 0, pose: 'seated' }], ctx, item.seed ?? 4); }
  else if (kind === 'ship.liner_1912') {
    const holder = new THREE.Group();
    const sk0 = String(item.action || '').toLowerCase() === 'sink' ? (typeof item.sink === 'object' && item.sink ? { ...item, ...item.sink } : item) : null;
    titan = await buildTitanic({ scene: holder, renderer: ctx.renderer, tex: { foam: TX.foam(512) }, breakS: sk0 ? clamp(+(sk0.break_at ?? 147 / 269), 0.15, 0.85) * 269 : null,
      funnels: item.funnels ?? item.params?.funnels, livery: item.livery ?? item.params?.livery, length: item.length ?? item.params?.length, name: item.name ?? item.params?.name,
      cutaway: typeof item.cutaway === 'object' && item.cutaway ? item.cutaway : (item.cutaway === true ? {} : null) });
    v = { group: holder, update() {} }; lengthZ = titan.length;
  } else { warn(`vehicle kind ${kind} unknown -> vehicle.car_modern`); v = buildModernCar(item, ctx); lengthZ = v.length; wheelbase = v.wheelbase; track2 = v.track; }
  const root = new THREE.Group(); root.name = kind;
  const holderG = v.group; root.add(holderG);
  // ── motion (E2 v2, motion.js): a path is a smooth track the vehicle can hold (corners filleted and low-passed to its
  // turning radius), walked along its arc length with an eased speed; ships follow it with their pivot point a third of
  // the length aft of the bow (the stern swings out in a turn) and heel outward; aircraft bank into the turn.
  const at = xz(item.at), hdg = item.heading ?? 180, action = String(item.action || (cls === 'air' ? 'fly' : 'idle')).toLowerCase();
  const moving = ['drive', 'sail', 'fly', 'move', 'march', 'charge', 'taxi'].includes(action);
  const sinkOn = action === 'sink' && cls === 'ship';
  const speed = moving ? (item.speed ?? { ground: kind === 'vehicle.tank_ww2' ? 5 : 11, ship: kind === 'ship.rowboat' ? 1.5 : 7, air: v.cruise ?? 60, rocket: 0 }[cls]) : 0;
  const d0 = [Math.sin(hdg * DEG), -Math.cos(hdg * DEG)];
  const rmin = +item.turn_radius > 0 ? +item.turn_radius : turnRadius(cls, lengthZ, speed, kind);
  const pivotAhead = cls === 'ship' ? lengthZ / 6 : 0;                   // the pivot point: L/3 aft of the bow
  const rawPath = Array.isArray(item.path) && item.path.length >= 2 ? [at, ...item.path.slice(1).map((p) => xz(p))] : [at, [at[0] + d0[0] * 50, at[1] + d0[1] * 50]];
  const track = moving ? smoothTrack(rawPath, { rmin }) : null;
  if (track && Array.isArray(item.path) && item.path.length > 2 && !track.fits) warn(`${kind}: the path turns tighter than a ${Math.round(rmin)} m radius even smoothed; turning at the tightest it can`);
  const fromRest = moving && (+item.start > 0 || item.from_rest === true);
  const prof = moving ? speedProfile(speed, { start: fromRest ? (+item.start || 0) : null, ramp: item.ramp ?? (cls === 'ship' ? clamp(lengthZ / 25, 3, 10) : 3), stopAt: item.stop === true ? Math.max(1, track.length - pivotAhead) : null }) : null;
  const water = () => ctx.waterLevel ?? ctx.world?.water?.level ?? ctx.water?.level ?? 0;
  const alt = item.alt ?? item.altitude ?? (cls === 'air' ? 120 : 0);
  const heelK = cls === 'ship' ? (lengthZ >= 100 ? [100, 3] : [70, 6]) : cls === 'ground' ? [4, 2.5] : [0, 0];   // deg per g of lateral acc., max deg
  const heelLag = cls === 'ship' ? clamp(lengthZ / 40, 1.5, 6) : 0.5;                                           // s the hull takes to roll into the heel
  function pose(t) {
    if (!moving) return { x: at[0], z: at[1], dir: d0, yaw: Math.atan2(d0[0], d0[1]), s: 0, v: 0, kappa: 0, heel: 0 };
    const s = prof.dist(t), sp = pivotAhead + s, vv = prof.speed(t);
    const p = track.at(sp), yaw = track.yaw(sp), dir = [Math.sin(yaw), Math.cos(yaw)];
    const kap = track.kappa(sp), kl = track.heel(sp, Math.max(2, Math.max(vv, 0.5) * heelLag));
    const heel = clamp(heelK[0] * vv * vv * kl / 9.81, -heelK[1], heelK[1]) * DEG;   // + heels to starboard (outward in a port turn)
    return { x: p[0] - dir[0] * pivotAhead, z: p[1] - dir[1] * pivotAhead, dir, yaw, s, v: vv, kappa: kap, heel };
  }
  const shipOff = kind === 'ship.liner_1912' ? lengthZ / 2 : 0;   // titanic's origin is its stem
  // ── sinking (E2 v2, sinking.js): action 'sink' on any ship.* ──
  const SK = sinkOn ? (typeof item.sink === 'object' && item.sink ? { ...item, ...item.sink } : item) : null;
  const sinkMode = SK ? (SK.mode ?? (titan ? 'break' : 'bow_first')) : null;
  const plan = SK ? sinkPlan({ mode: sinkMode, t0: SK.t0 ?? 0, dur: SK.dur ?? SK.duration ?? 20, trim_max: SK.trim_max, list_max: SK.list_max,
    break_at: SK.break_at ?? (titan ? 147 / 269 : 0.5), lights_out_at: SK.lights_out_at, final: SK.final,
    L: lengthZ, bowZ: titan ? 0 : lengthZ / 2, sternZ: titan ? -269 : -lengthZ / 2, top: titan ? 45 : (v.height ?? Math.max(3, lengthZ * 0.18)) }) : null;
  let secF = null, secA = null, fx = null;
  if (plan && !titan) {
    const sp = splitAt(holderG, plan.zB); secF = sp.fore; secA = sp.aft;
    for (const g of [secF, secA]) g.matrixAutoUpdate = false;
  }
  if (plan) { fx = buildSinkFX(ctx, { beam: titan ? 28 : beam(), seed: (item.seed ?? 5) + (item.index ?? 0) }); ctx.scene.add(fx.root); }
  function beam() { return v.beam ?? (kind === 'ship.rowboat' ? 1.5 : kind === 'ship.warship' ? 26 : kind === 'ship.sailing_ancient' ? 10 : 4); }
  // Q9: boats ride the swell (heave / pitch / roll from the ocean surface under bow, stern and both sides), an anchored
  // boat swings slowly on its rode, and `keys` [{t, at, y, pitch, roll, heading}] ease the boat through a scripted ride
  // (lifted by a wave, thrown over a spit). Deterministic in t.
  const B0 = beam();
  const wKeys = Array.isArray(item.keys) && item.keys.length ? item.keys.map((k) => ({ ...k, t: +k.t || 0 })).sort((a, b) => a.t - b.t) : null;
  const swingPh = ((item.seed ?? 3) * 1.7 + (item.index ?? 0) * 2.3) % TAU;
  function keyAt(t) {
    if (!wKeys) return null;
    const out = {};
    for (const k of wKeys) { for (const f of ['at', 'y', 'pitch', 'roll', 'heading']) if (k[f] !== undefined) (out[f] ||= []).push([k.t, k[f]]); }
    const val = (list) => { if (!list) return undefined; if (t <= list[0][0]) return list[0][1]; for (let i = 0; i < list.length - 1; i++) { const [t0, a] = list[i], [t1, b] = list[i + 1]; if (t <= t1) { const w = smooth((t - t0) / Math.max(1e-3, t1 - t0)); return Array.isArray(a) ? [lerp(a[0], b[0], w), lerp(a[1], b[1], w)] : lerp(a, b, w); } } return list[list.length - 1][1]; };
    return { at: val(out.at), y: val(out.y), pitch: val(out.pitch), roll: val(out.roll), heading: val(out.heading) };
  }
  const WAPI = () => (ctx.water && typeof ctx.water.heightAt === 'function' ? ctx.water : ctx.ground && ctx.ground.water && typeof ctx.ground.water.heightAt === 'function' ? ctx.ground.water : null);
  function shipRide(t, P) {
    let { x, z, dir } = P; const s = P.s;
    if (item.beached === true) {                               // opt-in: resting on the sand, a slight list, no motion
      const yaw = Math.atan2(dir[0], dir[1]), fd = [Math.sin(yaw), Math.cos(yaw)], hl = lengthZ * 0.4;
      const hf = G.h(x + fd[0] * hl, z + fd[1] * hl), hb = G.h(x - fd[0] * hl, z - fd[1] * hl);
      holderG.position.set(x, (hf + hb) / 2 + (kind === 'ship.longtail' ? 0.3 : kind === 'ship.rowboat' ? 0.2 : 1.0), z); holderG.rotation.set(0, 0, 0);
      holderG.rotateY(yaw); holderG.rotateX(-Math.atan2(hf - hb, 2 * hl)); holderG.rotateZ(0.06 * (((item.index ?? 0) % 2) ? 1 : -1));
      v.update?.(t, { distance: 0 }); return true;
    }
    const W = WAPI(), K = keyAt(t);
    let yaw = Math.atan2(dir[0], dir[1]);
    if (K && K.at) { x = K.at[0]; z = K.at[1]; }
    if (K && K.heading !== undefined) { const h = K.heading * DEG; dir = [Math.sin(h), -Math.cos(h)]; yaw = Math.atan2(dir[0], dir[1]); }
    if (!moving && item.anchored !== false && !(K && K.heading !== undefined) && !sinkOn) yaw += (7 * Math.sin(TAU * t / 41 + swingPh) + 2.5 * Math.sin(TAU * t / 13 + swingPh * 2)) * DEG;
    const fd = [Math.sin(yaw), Math.cos(yaw)], pd = [Math.cos(yaw), -Math.sin(yaw)], hl = lengthZ * 0.42, hb = B0 * 0.5;
    const hAt = (px, pz) => (W ? W.heightAt(px, pz, t) : water());
    const hb0 = hAt(x + fd[0] * hl, z + fd[1] * hl), hs0 = hAt(x - fd[0] * hl, z - fd[1] * hl), hp = hAt(x + pd[0] * hb, z + pd[1] * hb), hq = hAt(x - pd[0] * hb, z - pd[1] * hb), hc = hAt(x, z);
    const k = clamp(8 / Math.max(8, lengthZ), 0.15, 1);                       // big hulls ride over the short swell
    let y = lerp(water(), (hb0 + hs0 + hp + hq + 2 * hc) / 6, k) - (kind === 'ship.troller' ? 0.02 : 0);
    let pitch = W ? Math.atan2(hb0 - hs0, 2 * hl) * 0.85 : 0.01 * Math.sin(t * 0.53), roll = (W ? Math.atan2(hp - hq, 2 * hb) * 0.8 : 0) + 0.012 * Math.sin(t * 0.9 + swingPh) + (P.heel || 0);
    if (K) { if (K.y !== undefined) y += K.y; if (K.pitch !== undefined) pitch += K.pitch * DEG; if (K.roll !== undefined) roll += K.roll * DEG; }
    if (plan) { const st = plan.at(t); const damp = 1 - smooth(st.u * 4); pitch *= damp; roll = roll * damp; }   // a sinking hull stops riding the swell
    holderG.position.set(x, y, z); holderG.rotation.set(0, 0, 0); holderG.rotateY(yaw); holderG.rotateX(-pitch); holderG.rotateZ(roll);
    v.update?.(t, { distance: s });
    return true;
  }
  const _M = new THREE.Matrix4();
  let lastSink = null;
  const UW = cls === 'ship' && ctx.scene ? ensureUnderwater(ctx) : null;        // E2 v2: the camera may go below the surface
  function update(t = 0, clock, camera) {
    if (UW && camera) UW.update(t, camera);
    const P = pose(t), { x, z, dir, s } = P, yaw = Math.atan2(dir[0], dir[1]);
    if (cls === 'ground') {
      const fx2 = dir[0] * wheelbase / 2, fz = dir[1] * wheelbase / 2, rx = -dir[1] * track2 / 2, rz = dir[0] * track2 / 2;
      const hf = G.h(x + fx2, z + fz), hb = G.h(x - fx2, z - fz), hl = G.h(x + rx, z + rz), hr = G.h(x - rx, z - rz);
      const pitch = Math.atan2(hf - hb, wheelbase), roll = Math.atan2(hl - hr, track2);
      holderG.position.set(x, (hf + hb + hl + hr) / 4, z);
      // Q9: skid t -> the car fishtails from t (a damped yaw swing of skid_deg, default 9), e.g. the y06 tyre-skid cue
      let fish = 0; if (Number.isFinite(+item.skid) && t > +item.skid) { const u = t - item.skid; fish = (item.skid_deg ?? 9) * DEG * Math.exp(-u / 0.75) * Math.sin(TAU * u / 1.2); }
      holderG.rotation.set(0, 0, 0); holderG.rotateY(yaw + fish); holderG.rotateX(-pitch); holderG.rotateZ(roll + fish * 0.12 + P.heel);
      v.update?.(t, { distance: s, turret: (item.turret ?? 0) * DEG, gun: (item.gun ?? 0) * DEG, snow: item.snow ?? 0, steer: clamp(P.kappa * wheelbase, -0.6, 0.6) });
    } else if (cls === 'ship') {
      const st = plan ? plan.at(t) : null; lastSink = st;
      if (titan) {
        const cx = x + dir[0] * shipOff, cz = z + dir[1] * shipOff;
        const lamps = LIGHTS() * (st ? st.lamps : 1);
        titan.update(t, t, null, { titanic: { x: cx, z: cz, y: water(), heading: yaw, roll: P.heel, lamps, windows: (0.25 + LIGHTS() * 0.75) * (st ? st.lamps : 1), speed: P.v, sink: st, track: moving ? (tt) => { const q = pose(tt); return [q.x + q.dir[0] * shipOff, q.z + q.dir[1] * shipOff, Math.atan2(q.dir[0], q.dir[1])]; } : null } });
      } else {
        if (!shipRide(t, P)) { holderG.position.set(x, water() + 0.15 * Math.sin(t * 0.7), z); holderG.rotation.set(0.01 * Math.sin(t * 0.53), yaw, 0.02 * Math.sin(t * 0.61 + 1) + (P.heel || 0)); v.update?.(t, { distance: s }); }
        if (st) {
          sectionMatrix(st.broken ? st.fore : st.whole, secF.matrix); sectionMatrix(st.broken ? st.aft : st.whole, secA.matrix);
          secF.matrixWorldNeedsUpdate = secA.matrixWorldNeedsUpdate = true;
        }
      }
      if (fx && st) sinkWater(t, st);
    } else if (cls === 'air') {
      // coordinated bank from the smooth track's curvature (never a snap), + into the turn
      const bank = moving ? clamp(Math.atan(P.v * P.v * track.heel(pivotAhead + P.s, Math.max(2, P.v * 1.2)) / 9.81), -0.9, 0.9) : 0;
      const y = G.h(x, z) + alt;
      holderG.position.set(x, y, z); holderG.rotation.set(0, 0, 0); holderG.rotateY(yaw); holderG.rotateZ(-bank); holderG.rotateX(-0.02);
      v.update?.(t, { rpm: moving || action === 'idle' ? 1 : 0 });
    } else {                                     // rocket: ignition at start, lift-off `lift` s later, accelerating
      const ign = item.start ?? (action === 'launch' ? 2 : 1e9), lift = item.lift ?? 3, tt = t - ign - lift;
      const h = tt > 0 ? 0.5 * 3.5 * tt * tt : 0;
      holderG.position.set(at[0], G.h(at[0], at[1]) + 5 + h, at[1]); holderG.rotation.set(0, 0, 0);
      v.update(t, { thrust: action === 'launch' ? smooth((t - ign) / 1.5) : 0 });
    }
  }
  // the water around a sinking ship: hull samples along the centreline (keel, waterline, deck), world space, per half
  const _p = new THREE.Vector3();
  function sinkWater(t, st) {
    const F = titan ? titan.fore : secF, A2 = titan ? titan.aft : secA, zb = titan ? 0 : lengthZ / 2, zs = titan ? -269 : -lengthZ / 2;
    (titan ? titan.root : holderG).updateMatrixWorld(true);
    const pts = [];
    for (const yy of [-4, 6, 14]) {
      let prevFore = null;
      for (let k = 0; k <= 30; k++) {
        const zz = lerp(zb, zs, k / 30), inFore = zz > plan.zB, g = inFore ? F : A2;
        if (st.broken && prevFore !== null && prevFore !== inFore) pts.push([NaN, NaN, NaN]);
        prevFore = inFore;
        _p.set(0, yy, zz).applyMatrix4(g.matrixWorld); pts.push([_p.x, _p.y, _p.z, B0 * 0.5]);
      }
      pts.push([NaN, NaN, NaN]);
    }
    const P0 = pose(Math.max(plan.t0, 0));
    const c0 = new THREE.Vector3(0, 0, lerp(zb, zs, 0.5)).applyMatrix4((titan ? titan.root : holderG).matrixWorld);
    const gone = plan.mode === 'break' ? smooth((st.u - 0.72) / 0.28) : smooth((st.u - 0.6) / 0.4);
    fx.update(t, { active: st.active, u: st.u, pts, level: water(), gone, center: [c0.x, c0.z], axis: P0.dir, L: lengthZ, dur: plan.dur });
  }
  update(0);
  patchAll(root, ctx);
  root.traverse((o) => { if (o.isMesh && o.castShadow === undefined) o.castShadow = true; });
  const anchors = { body: holderG };
  if (titan) {
    // the liner moves inside `titan.root`: its body is the midship point, and named points for cameras and figures
    anchors.body = titan.anchors.midship;
    Object.assign(anchors, titan.anchors);
  }
  if (cls === 'ship') { anchors.wake = new THREE.Object3D(); anchors.wake.position.set(0, 0, titan ? -269 : -lengthZ / 2); (titan ? titan.root : holderG).add(anchors.wake); }   // (titan.root is scaled: -269 local = her stern)
  if (cls === 'ground') { anchors.dust = new THREE.Object3D(); anchors.dust.position.set(0, 0.3, -lengthZ / 2); holderG.add(anchors.dust); }
  if (kind === 'rocket') { anchors.exhaust = new THREE.Object3D(); holderG.add(anchors.exhaust); }
  // the hull as a solid for the camera probe (camera.js refines the moving-item cylinder with it): the local bounding box
  // of the model (the liner: its hull, superstructure, funnels and masts) wherever the ship is at time t
  const localBox = new THREE.Box3();
  if (!titan) { holderG.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(holderG.matrixWorld).invert(); localBox.setFromObject(holderG); localBox.applyMatrix4(inv); }
  const _inv = new THREE.Matrix4(), _q = new THREE.Vector3(), _R = new THREE.Matrix4(), _S = new THREE.Matrix4(), _W = new THREE.Matrix4();
  const _qq = new THREE.Quaternion(), _eu = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1), _pp = new THREE.Vector3(), _sc = new THREE.Vector3(1, 1, 1);
  // the ship's frame at t without drawing anything (titan: stem origin; others: the model's centre), waves ignored
  function shipMatrix(t, out) {
    const P = pose(t), yaw = Math.atan2(P.dir[0], P.dir[1]);
    const cx = titan ? P.x + P.dir[0] * shipOff : P.x, cz = titan ? P.z + P.dir[1] * shipOff : P.z;
    _eu.set(0, yaw, P.heel || 0); _qq.setFromEuler(_eu); _pp.set(cx, water(), cz);
    return out.compose(_pp, _qq, titan ? _sc.set(titan.kxy, titan.kxy, titan.kz) : _one);
  }
  function solidAt(p, t, margin = 0.6) {
    if (cls !== 'ship') return 0;
    shipMatrix(t, _R);
    const st = plan ? plan.at(t) : null;
    const parts = st && st.active ? (st.broken ? [['fore', st.fore], ['aft', st.aft]] : [[null, st.whole]]) : [[null, null]];
    let top = 0;
    for (const [part, S] of parts) {
      _W.copy(_R); if (S) _W.multiply(sectionMatrix(S, _S));
      _inv.copy(_W).invert(); _q.set(p[0], p[1], p[2]).applyMatrix4(_inv);
      let h = 0;
      if (titan) h = titan.solid(_q.x, _q.y, _q.z, margin, part);
      else {
        const b = localBox, m = margin, inPart = !part || (part === 'fore' ? _q.z > plan.zB - m : _q.z < plan.zB + m);
        if (inPart && _q.x > b.min.x - m && _q.x < b.max.x + m && _q.y > b.min.y - m && _q.y < b.max.y + m && _q.z > b.min.z - m && _q.z < b.max.z + m) h = b.max.y;
      }
      if (h > 0) { _pp.set(0, h, _q.z).applyMatrix4(_W); top = Math.max(top, _pp.y); }
    }
    return top;
  }
  return { root, radius: Math.max(lengthZ, v.span ?? 0) / 2 + 1, height: titan ? 45 * titan.kxy : v.height ?? (cls === 'ship' ? 30 : 3), update, anchors, ...(cls === 'ship' ? { contact: false } : {}),
    hooks: { dust: cls === 'ground' && moving ? { anchor: 'dust', strength: clamp(speed / 12, 0.2, 1) } : null, wake: cls === 'ship' && moving ? { anchor: 'wake', strength: clamp(speed / 10, 0.2, 1) } : null, exhaust: kind === 'rocket' && action === 'launch' ? { anchor: 'exhaust', start: item.start ?? 2 } : null },
    positionAt: (t) => { update(t); return (titan ? titan.anchors.midship.getWorldPosition(new THREE.Vector3()) : holderG.position.clone()); },
    solidAt: cls === 'ship' ? solidAt : null, length: lengthZ, beam: titan ? titan.beam : cls === 'ship' ? B0 : cls === 'ground' ? track2 + 0.3 : v.span ?? 4,
    kin: { pose, track, rmin, plan } };
}
