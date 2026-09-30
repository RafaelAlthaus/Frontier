// ship.js — an Alexandrian grain freighter of the Roman era (Lucian's Isis, Acts 27): a deep round hull lofted from
// stations, pitch-dark planking with a painted band, a stern rising into a gilded goose neck, two steering oars,
// a stern cabin, one tall mast with a broad square mainsail on a long yard, a triangular topsail, the artemon
// raked over the bow, standing rigging, a lantern, and two posable sailors. Rides the swell (sea.waveAt).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { plain } from '../shared/materials.js';
import { person } from './figures.js';
import { clamp, smooth, lerp } from '../shared/util.js';

// hull: length along +Z (bow at +Z), stations s 0..1 stern->bow
function hullGeometry(L, B, D, rings = 64, girth = 28) {
  const pos = [], uv = [], col = [], idx = [];
  const half = (s) => B / 2 * Math.pow(Math.sin(Math.PI * clamp(s * 0.94 + 0.03)), 0.62) * (s < 0.5 ? 1.0 : lerp(1.0, 0.92, (s - 0.5) * 2));
  const sheer = (s) => 2.4 + 2.8 * Math.pow(1 - s, 3.2) + 1.4 * Math.pow(s, 3.0);   // stern rises highest
  const keel = (s) => -D * Math.pow(Math.sin(Math.PI * clamp(s * 0.9 + 0.05)), 0.35);
  const band = new THREE.Color(0.55, 0.16, 0.08), dark = new THREE.Color(1, 1, 1), strip = new THREE.Color(0.85, 0.7, 0.35);
  for (let i = 0; i <= rings; i++) {
    const s = i / rings, z = (s - 0.5) * L;
    const hb = half(s), top = sheer(s), bot = keel(s);
    let g = 0;
    let prev = null;
    for (let j = 0; j <= girth; j++) {
      const th = (j / girth) * Math.PI - Math.PI / 2;       // -pi/2 port rail .. +pi/2 starboard rail
      const a = Math.abs(th);
      const x = Math.sign(th) * hb * Math.pow(Math.sin(a), 0.55);
      const y = bot + (top - bot) * (1 - Math.cos(a)) ** 0.9;
      if (prev) g += Math.hypot(x - prev[0], y - prev[1]);
      prev = [x, y];
      pos.push(x, y, z);
      uv.push(z, y);
      const fromTop = top - y;
      const c = fromTop < 0.55 ? strip : fromTop < 1.6 ? band : dark;
      col.push(c.r, c.g, c.b);
    }
  }
  const W = girth + 1;
  for (let i = 0; i < rings; i++) for (let j = 0; j < girth; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, half, sheer, keel };
}

function tubeAlong(points, r, seg = 24, rs = 8) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), seg, r, rs, false);
}
function spar(a, b, r0, r1 = r0, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r1, r0, A.distanceTo(B), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  const m = A.clone().add(B).multiplyScalar(0.5); g.translate(m.x, m.y, m.z);
  return g;
}
const ni = (g) => (g.index ? g.toNonIndexed() : g);

// a sail: grid bulging forward (+Z) between its corners. corners: tl, tr, bl, br (world-ish, in ship space)
function sailGeometry(tl, tr, bl, br, bulge, nu = 24, nv = 18, tri = false) {
  const pos = [], uv = [], idx = [];
  const P = (u, v) => {
    const top = new THREE.Vector3(...tl).lerp(new THREE.Vector3(...tr), u);
    const bottom = new THREE.Vector3(...bl).lerp(new THREE.Vector3(...br), tri ? 0.5 + (u - 0.5) * 0 : u);
    const p = top.lerp(bottom, v);
    const b = bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 0.85 + 0.15)) ;
    p.z += b;
    return p;
  };
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    const p = tri ? (() => { const top = new THREE.Vector3(...tl); const bl3 = new THREE.Vector3(...bl), br3 = new THREE.Vector3(...br);
      const bottom = bl3.clone().lerp(br3, u); const q = top.clone().lerp(bottom, v); q.z += bulge * Math.sin(Math.PI * u) * v; return q; })() : P(u, v);
    pos.push(p.x, p.y, p.z); uv.push(u, 1 - v);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function buildShip(tex, o = {}) {
  const L = o.length ?? 40, B = o.beam ?? 10.5, D = o.depth ?? 3.4;
  const G = new THREE.Group(); G.name = o.name ?? 'ship';
  const hullTex = tex.planks.map.clone(); hullTex.needsUpdate = true; hullTex.repeat.set(1 / 4, 1 / 4);
  const hullN = tex.planks.normalMap.clone(); hullN.needsUpdate = true; hullN.repeat.set(1 / 4, 1 / 4);
  const M = {
    hull: plain({ map: hullTex, normalMap: hullN, vertexColors: true, roughness: 0.75, color: 0xffffff, side: THREE.DoubleSide }),
    deck: plain({ map: (() => { const t = tex.deck.map.clone(); t.needsUpdate = true; t.repeat.set(1 / 4, 1 / 4); return t; })(), roughness: 0.85 }),
    wood: plain({ color: 0x4a3526, roughness: 0.8 }),
    gold: plain({ color: 0xD8A84A, metalness: 1, roughness: 0.3 }),
    rope: plain({ color: 0x2a2018, roughness: 1 }),
    sail: plain({ map: tex.sail.map, normalMap: tex.sail.normalMap, side: THREE.DoubleSide, roughness: 0.95, color: 0xffffff }),
    topsail: plain({ color: 0x9A2A1E, side: THREE.DoubleSide, roughness: 0.95 }),
    lamp: plain({ color: 0x201008, emissive: new THREE.Color(1.0, 0.6, 0.25), emissiveIntensity: 0 }),
    cloth: plain({ color: 0x8C7B62, roughness: 1 }), cloth2: plain({ color: 0x5E4A36, roughness: 1 }), skin: plain({ color: 0xE6DFD4, roughness: 0.55 }),
  };
  const mk = (g, m, cast = true) => { const x = new THREE.Mesh(g, m); x.castShadow = cast; x.receiveShadow = true; return x; };
  const H = hullGeometry(L, B, D);
  const hull = mk(H.geo, M.hull);
  G.add(hull);
  // deck: a strip that follows the sheer, a little below the rail
  const deckParts = [];
  const N = 40;
  const dpos = [], duv = [], didx = [];
  for (let i = 0; i <= N; i++) {
    const s = 0.04 + i / N * 0.9, z = (s - 0.5) * L, hb = H.half(s) * 0.97, y = H.sheer(s) - 0.7;
    dpos.push(-hb, y, z, hb, y, z); duv.push(-hb, z, hb, z);
  }
  for (let i = 0; i < N; i++) { const a = i * 2; didx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3)); dg.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2)); dg.setIndex(didx); dg.computeVertexNormals();
  G.add(mk(dg, M.deck));
  // stern post rising into the goose neck (gilded), stem post at the bow
  const zs = -L / 2, zb = L / 2;
  const goose = tubeAlong([[0, H.sheer(0.02) - 1.2, zs + 0.8], [0, H.sheer(0) + 1.2, zs - 0.6], [0, H.sheer(0) + 3.6, zs - 1.0], [0, H.sheer(0) + 5.2, zs + 0.2], [0, H.sheer(0) + 5.0, zs + 1.5]], 0.42, 40, 10);
  G.add(mk(goose, M.gold));
  const head = new THREE.SphereGeometry(0.62, 14, 10); head.scale(0.8, 0.8, 1.3); head.translate(0, H.sheer(0) + 4.95, zs + 1.9);
  const beak = new THREE.ConeGeometry(0.22, 0.9, 8); beak.rotateX(Math.PI / 2); beak.translate(0, H.sheer(0) + 4.85, zs + 2.7);
  G.add(mk(mergeGeometries([ni(head), ni(beak)]), M.gold));
  G.add(mk(tubeAlong([[0, -D * 0.8, zb - 2.5], [0, 0.5, zb + 0.4], [0, H.sheer(1) + 0.8, zb + 1.3], [0, H.sheer(1) + 1.8, zb + 1.0]], 0.35, 24, 8), M.wood));
  // stern cabin with a roof, rails
  const cab = new THREE.BoxGeometry(B * 0.55, 2.4, 5.2); cab.translate(0, H.sheer(0.12) - 0.2 + 1.2, zs + 5.6);
  const cabRoof = new THREE.BoxGeometry(B * 0.62, 0.3, 5.8); cabRoof.translate(0, H.sheer(0.12) - 0.2 + 2.5, zs + 5.6);
  G.add(mk(mergeGeometries([ni(cab), ni(cabRoof)]), M.wood));
  // steering oars on both quarters
  for (const sx of [-1, 1]) {
    const a = [sx * (H.half(0.14) + 0.2), H.sheer(0.14) + 1.2, zs + 5.0], b = [sx * (H.half(0.1) + 1.2), -2.6, zs + 1.2];
    G.add(mk(mergeGeometries([ni(spar(a, b, 0.2, 0.18)), (() => { const g = new THREE.BoxGeometry(0.25, 3.0, 1.1); g.translate(b[0], b[1] + 0.9, b[2] + 0.3); return ni(g); })()]), M.wood));
  }
  // mast, yard, topmast; the artemon raked over the bow
  const mz = 1.5, deckY = H.sheer(0.54) - 0.7;
  const mastTop = deckY + 26;
  G.add(mk(spar([0, deckY - 1, mz], [0, mastTop, mz], 0.42, 0.3, 12), M.wood));
  const yardY = mastTop - 6.2, yardW = 12.5;
  const yard = mergeGeometries([ni(spar([-yardW, yardY - 0.5, mz + 0.5], [0, yardY, mz + 0.5], 0.14, 0.26)), ni(spar([0, yardY, mz + 0.5], [yardW, yardY - 0.5, mz + 0.5], 0.26, 0.14))]);
  G.add(mk(yard, M.wood));
  const artemonFoot = [0, H.sheer(0.93) - 0.4, zb - 3.5], artemonTop = [0, H.sheer(0.93) + 7.5, zb + 4.5];
  G.add(mk(spar(artemonFoot, artemonTop, 0.24, 0.16), M.wood));
  const ayY = artemonTop[1] - 0.8, ayZ = artemonTop[2] - 0.6;
  G.add(mk(spar([-4, ayY, ayZ], [4, ayY, ayZ], 0.1, 0.1), M.wood));
  // sails (the main can be furled: o.sail = false)
  const sails = new THREE.Group(); G.add(sails);
  const sailMain = mk(sailGeometry([-yardW + 0.4, yardY - 0.3, mz + 0.8], [yardW - 0.4, yardY - 0.3, mz + 0.8], [-yardW + 1.4, deckY + 3.2, mz + 1.4], [yardW - 1.4, deckY + 3.2, mz + 1.4], 3.2), M.sail);
  sails.add(sailMain);
  const top1 = mk(sailGeometry([0, mastTop - 0.2, mz + 0.4], [0, mastTop - 0.2, mz + 0.4], [-yardW + 1.0, yardY + 0.35, mz + 0.7], [-0.4, yardY + 0.35, mz + 0.7], 0.6, 10, 8, true), M.topsail);
  const top2 = mk(sailGeometry([0, mastTop - 0.2, mz + 0.4], [0, mastTop - 0.2, mz + 0.4], [0.4, yardY + 0.35, mz + 0.7], [yardW - 1.0, yardY + 0.35, mz + 0.7], 0.6, 10, 8, true), M.topsail);
  sails.add(top1, top2);
  const art = mk(sailGeometry([-3.7, ayY - 0.2, ayZ + 0.2], [3.7, ayY - 0.2, ayZ + 0.2], [-3.2, ayY - 5.0, ayZ - 2.6], [3.2, ayY - 5.0, ayZ - 2.6], 1.1, 14, 10), M.sail);
  sails.add(art);
  const furled = mk(spar([-yardW + 0.6, yardY - 0.9, mz + 0.8], [yardW - 0.6, yardY - 0.9, mz + 0.8], 0.55, 0.55, 10), M.sail);
  furled.visible = false; G.add(furled);
  // standing rigging: forestay, backstays, shrouds, sheets
  const rig = [];
  const r = 0.045;
  rig.push(spar([0, mastTop - 0.5, mz], [0, H.sheer(0.97), zb - 0.5], r));
  for (const sx of [-1, 1]) {
    rig.push(spar([0, mastTop - 0.6, mz], [sx * H.half(0.2), H.sheer(0.2) - 0.2, zs + 8], r));
    for (const dz of [-3, -1, 1]) rig.push(spar([0, mastTop - 1.5, mz], [sx * H.half(0.55), H.sheer(0.55) - 0.3, mz + dz], r));
    rig.push(spar([sx * (yardW - 1.4), deckY + 3.2, mz + 1.4], [sx * H.half(0.3), H.sheer(0.3), zs + 11], r));
    rig.push(spar([sx * yardW, yardY - 0.5, mz + 0.5], [0, mastTop, mz], r * 0.8));
  }
  G.add(mk(mergeGeometries(rig.map(ni)), M.rope, false));
  // the lantern at the stern, hanging from the goose neck
  const lampG = new THREE.CylinderGeometry(0.28, 0.22, 0.6, 10); lampG.translate(0, H.sheer(0) + 2.4, zs + 2.4);
  const lamp = mk(lampG, M.lamp, false); G.add(lamp);
  const lampPos = new THREE.Vector3(0, H.sheer(0) + 2.4, zs + 2.4);
  // sailors: a lookout at the bow pointing ahead, a helmsman at the stern
  const crew = [];
  if (o.crew !== false) {
    const lookout = person({ skin: M.skin, cloth: M.cloth, cloth2: M.cloth2, tunic: true, h: 1.75, scarf: plain({ color: 0xE0B24E, roughness: 0.85 }) });
    lookout.group.position.set(0.8, H.sheer(0.86) - 0.7, zb - 7.5); lookout.group.rotation.y = 0.15;
    lookout.pose({ rArmX: -1.85, rArmZ: 0.05, rElbow: -0.05, lArmX: 0.25, lElbow: -0.5, lArmZ: 0.25, headX: -0.06, lean: 0.05 });
    G.add(lookout.group);
    const helm = person({ skin: M.skin, cloth: M.cloth, cloth2: M.cloth2, tunic: true, h: 1.72 });
    helm.group.position.set(1.8, H.sheer(0.14) - 0.7 + 0.1, zs + 6.0); helm.group.rotation.y = 0.2;
    helm.pose({ rArmX: -0.9, rElbow: -0.8, lArmX: -0.9, lElbow: -0.8, lean: 0.1 });
    G.add(helm.group);
    crew.push(lookout, helm);
  }
  G.traverse((x) => { if (x.isMesh) { x.frustumCulled = false; } });
  const state = { sail: o.sail !== false };
  function setSail(on) { sails.visible = on; furled.visible = !on; state.sail = on; }
  setSail(o.sail !== false);
  return { group: G, setSail, M, lampPos, crew, length: L, sheer: H.sheer, half: H.half };
}
