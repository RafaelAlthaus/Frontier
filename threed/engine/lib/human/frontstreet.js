// frontstreet.js — town.front_street (Q9, 26 Sep 2026): a Hawaiian waterfront street (Lahaina, Front Street): a row of
// two-storey wooden storefronts with second-floor balconies (lanai) on posts over a boardwalk, false fronts, sign boards,
// lit windows at dusk; the street; a stone seawall on the water side; coconut palms; and the great banyan tree.
// Spec: {kind, at: [x, z] (street centre), heading (the direction the street runs), length (m, 160), sea: 'auto|left|right',
// banyan: true, palms: true, seed}. The buildings stand on the land side and face the water (auto: the lower side).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { plain } from '../shared/materials.js';
import { U } from '../shared/env.js';
import { rng, clamp, lerp, smooth } from '../shared/util.js';
import { ground, xz, DEG } from './common.js';

const TAU = Math.PI * 2, LIGHTS = () => smooth((0.12 - U.uSunDir.value.y) / 0.2);
const WALLS = ['#EDE6D2', '#F2DFA8', '#B9D4C4', '#A9C6D8', '#E8B7A0', '#F4F0E4', '#D8C8A0', '#C4DCC0', '#E6D2B8'];
const TRIMS = ['#FFFFFF', '#2F5A48', '#7A2E24', '#F4F0E4', '#3A4E6A'];
const SIGNS = ['GENERAL STORE', 'HOTEL', 'CAFE', 'GALLERY', 'SURF SHOP', 'MARKET', 'DRY GOODS', 'SHAVE ICE', 'BOOKS', 'TRADING CO.', 'FISH MARKET', 'BAKERY'];
function clapTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 16) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, y, 64, 2); g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(0, y + 2, 64, 5); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1 / 2.4); return t;   // 16 px = 0.15 m boards
}
function signTex(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96); g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, 496, 80);
  g.fillStyle = fg; g.font = '700 50px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function frondTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 256); g.strokeStyle = '#3F5A22'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 0); g.lineTo(32, 256); g.stroke();
  for (let y = 6; y < 250; y += 5) { const w = 30 * Math.sin(Math.PI * y / 256) + 4, sh = 40 + (y % 3) * 12; g.strokeStyle = `rgb(${sh},${sh + 44},${Math.round(sh * 0.45)})`; g.lineWidth = 2.5; g.beginPath(); g.moveTo(32, y); g.lineTo(32 - w, y + 16); g.moveTo(32, y); g.lineTo(32 + w, y + 16); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// every static mesh under root merged into one mesh per material (1000+ boxes -> ~40 draw calls)
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4(), groups = new Map(), kill = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.clone() : o.geometry.clone().setIndex([...Array(o.geometry.attributes.position.count).keys()]);
    g.applyMatrix4(M.multiplyMatrices(inv, o.matrixWorld));
    const k = o.material.uuid + (g.attributes.color ? 'c' : '') + (g.attributes.uv ? 'u' : '');
    if (!groups.has(k)) groups.set(k, { m: o.material, list: [] });
    groups.get(k).list.push(g); kill.push(o);
  });
  for (const o of kill) o.parent.remove(o);
  for (const { m, list } of groups.values()) { const mg = mergeGeometries(list, false); if (!mg) continue; const mesh = new THREE.Mesh(mg, m); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); }
}

export function frontStreetCatalog() {
  return { 'town.front_street': { desc: 'Hawaiian waterfront street (Lahaina Front Street): 2-storey wooden storefronts with balconies on posts over a boardwalk, false fronts, signs, lit windows at dusk, the street, a stone seawall, coconut palms, the great banyan tree; the shops stand on the land side facing the water', params: { at: '[x, z] street centre', heading: 'deg: the direction the street runs', length: 'm (160)', sea: 'auto|left|right (where the water is, seen along the heading)', banyan: 'true|false', palms: 'true|false', lit: '0..2 window glow (default: on when the sun is low)', burning: '0..1 the shops glow orange-red from inside and flicker', seed: 'n' }, footprint: [160, 45], height: 16, tags: ['town', 'hawaii', 'tropical', 'modern'] } };
}

export async function buildFrontStreet(item = {}, ctx = {}) {
  const G = ground(ctx), at = xz(item.at), L = clamp(+item.length || +item.params?.length || 160, 40, 400), R = rng((item.seed ?? 58) * 97 + 11);
  const h = (item.heading ?? 90) * DEG, along = [Math.sin(h), -Math.cos(h)];
  let side = String(item.sea ?? 'auto');
  if (side !== 'left' && side !== 'right') {       // the water is on the lower side
    const l = [along[1], -along[0]], d = 25; const hl = G.h(at[0] + l[0] * d, at[1] + l[1] * d), hr = G.h(at[0] - l[0] * d, at[1] - l[1] * d);
    side = hl < hr ? 'left' : 'right';
  }
  const leftV = [along[1], -along[0]];                 // left of the heading (compass: heading - 90)
  const seaV = side === 'left' ? leftV : [-leftV[0], -leftV[1]];
  const root = new THREE.Group(); root.name = 'town.front_street';
  const y0 = G.h(at[0], at[1]);
  root.position.set(at[0], y0, at[1]); root.rotation.y = Math.atan2(seaV[0], seaV[1]);   // local +Z = toward the water
  const toW = (lx, lz) => { const c = Math.cos(root.rotation.y), s = Math.sin(root.rotation.y); return [at[0] + lx * c + lz * s, at[1] - lx * s + lz * c]; };
  const gh = (lx, lz) => { const [wx, wz] = toW(lx, lz); return G.h(wx, wz) - y0; };
  // local x along the street must follow the heading: flip x if the sea side made local +X point backwards
  const lxAxis = [Math.cos(root.rotation.y), -Math.sin(root.rotation.y)], flip = lxAxis[0] * along[0] + lxAxis[1] * along[1] < 0 ? -1 : 1; void flip;
  const clap = clapTex(), parts = {}, add = (key, g) => { (parts[key] ||= []).push(g); };
  const mats = {};
  const mat = (key, o) => (mats[key] ||= plain(o));
  // street (asphalt with a crown) + boardwalk + curb
  const street = new THREE.PlaneGeometry(L, 9, 40, 4); street.rotateX(-Math.PI / 2);
  { const p = street.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, gh(x, z) + 0.06 + 0.05 * (1 - (z / 4.5) ** 2)); } street.computeVertexNormals(); }
  const streetMesh = new THREE.Mesh(street, plain({ color: 0x3E3E3C, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); streetMesh.receiveShadow = true; root.add(streetMesh);
  // buildings on the land side (local z < -7), facing +Z
  const lights = [];
  let x = -L / 2 + 2;
  const litGlass = plain({ color: 0x1B1A18, emissive: 0xFFB45A, emissiveIntensity: 0, roughness: 0.2 });
  const darkGlass = plain({ color: 0x1A2024, roughness: 0.08, metalness: 0.3, envMapIntensity: 1.1 });
  const burn0 = clamp(+item.burning || 0, 0, 1), shopGlass = burn0 > 0.3 ? litGlass : darkGlass;   // burning: the shops glow too
  let bi = 0;
  while (x < L / 2 - 6) {
    const w = 7 + Math.floor(R() * 5), d = 11 + R() * 3, storeys = R() < 0.8 ? 2 : 1, hgt = storeys === 2 ? 7.2 + R() * 0.8 : 4.2, fz = -7.5;
    if (R() < 0.08 && bi > 1) { x += 5; continue; }                 // a gap (an alley)
    const cx = x + w / 2, base = Math.min(gh(cx - w / 2, fz), gh(cx + w / 2, fz), gh(cx, fz - d)) - 0.8, top = gh(cx, fz) + 0.3;
    const wallC = WALLS[Math.floor(R() * WALLS.length)], trimC = TRIMS[Math.floor(R() * TRIMS.length)];
    const wallM = mat('w' + wallC, { color: new THREE.Color(wallC).getHex(), map: clap, roughness: 0.8 }), trimM = mat('t' + trimC, { color: new THREE.Color(trimC).getHex(), roughness: 0.6 });
    const floorY = top, H = hgt, parapet = 1.0 + R() * 0.8;
    const bx = new THREE.Group(); bx.position.set(cx, 0, fz - d / 2); root.add(bx);
    const box = (w2, h2, d2, x2, y2, z2, m) => { const g = new THREE.BoxGeometry(w2, h2, d2); g.translate(x2, y2, z2); const mm = new THREE.Mesh(g, m); mm.castShadow = mm.receiveShadow = true; bx.add(mm); return mm; };
    box(w, floorY + H - base, d, 0, (base + floorY + H) / 2, 0, wallM);
    box(w + 0.1, parapet, 0.25, 0, floorY + H + parapet / 2, d / 2 - 0.1, wallM);                             // false front
    box(w + 0.3, 0.18, 0.35, 0, floorY + H + parapet, d / 2 - 0.1, trimM);                                     // cornice
    box(w + 0.2, 0.16, d + 0.4, 0, floorY + H + 0.05, 0, mat('roof', { color: 0x5A5048, roughness: 0.9 }));   // roof
    // storefront: big windows, a door, a kick plate
    const sf = storeys === 2 ? 3.4 : 3.2;
    for (let k = 0; k < 2; k++) { const wx = (k ? 1 : -1) * w * 0.26; box(w * 0.34, 2.0, 0.06, wx, floorY + 1.45, d / 2 + 0.02, shopGlass); box(w * 0.34 + 0.12, 0.1, 0.1, wx, floorY + 2.5, d / 2 + 0.04, trimM); box(w * 0.34 + 0.12, 0.4, 0.08, wx, floorY + 0.25, d / 2 + 0.04, trimM); }
    box(1.1, 2.3, 0.08, 0, floorY + 1.15, d / 2 + 0.02, mat('door', { color: 0x4A3424, roughness: 0.6 }));
    box(1.2, 0.08, 0.12, 0, floorY + 2.34, d / 2 + 0.05, trimM);
    // warm lit interior behind the shop windows and upstairs windows (dusk)
    const nw = Math.max(2, Math.round(w / 2.4));
    if (storeys === 2) for (let k = 0; k < nw; k++) {
      const wx = -w / 2 + (k + 0.5) * w / nw, lit = R() < 0.6;
      box(0.9, 1.4, 0.06, wx, floorY + sf + 1.35, d / 2 + 0.02, lit ? litGlass : darkGlass);
      box(1.05, 0.08, 0.1, wx, floorY + sf + 2.1, d / 2 + 0.05, trimM); box(1.05, 0.08, 0.1, wx, floorY + sf + 0.6, d / 2 + 0.05, trimM);
    }
    const lk = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 1.6), litGlass); lk.position.set(0, floorY + 1.4, d / 2 - 0.2); bx.add(lk);
    // balcony (lanai) on posts over the boardwalk, with a railing; one-storey shops get a plain awning
    const bd = 2.6, by = storeys === 2 ? floorY + sf : floorY + 2.9;
    box(w + 0.1, 0.16, bd, 0, by, d / 2 + bd / 2, trimM);
    for (let k = 0; k <= Math.round(w / 2.6); k++) { const px = -w / 2 + 0.1 + k * (w - 0.2) / Math.round(w / 2.6); box(0.14, by - floorY, 0.14, px, (by + floorY) / 2, d / 2 + bd - 0.1, trimM); if (storeys === 2) box(0.07, 0.95, 0.07, px, by + 0.55, d / 2 + bd - 0.08, trimM); }
    if (storeys === 2) { box(w + 0.1, 0.08, 0.08, 0, by + 1.0, d / 2 + bd - 0.08, trimM); for (let k = 0; k < Math.round(w / 0.18); k++) box(0.03, 0.85, 0.03, -w / 2 + 0.1 + k * 0.18, by + 0.52, d / 2 + bd - 0.08, trimM); box(w + 0.3, 0.12, bd + 0.3, 0, floorY + H - 0.2, d / 2 + bd / 2, mat('roof', { color: 0x5A5048, roughness: 0.9 })); }
    // sign board on the false front
    const sgn = SIGNS[(bi * 7 + Math.floor(R() * 3)) % SIGNS.length], sM = plain({ map: signTex(sgn, R() < 0.5 ? '#F4EEDC' : '#2F4A3E', R() < 0.5 ? '#6A2A1E' : '#F2E6C8'), roughness: 0.6 });
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w - 1, 6), 0.9), sM); sp.position.set(0, floorY + H + parapet * 0.45, d / 2 + 0.04); bx.add(sp);
    // boardwalk in front
    box(w, 0.18, bd + 0.2, 0, floorY - 0.09, d / 2 + bd / 2 + 0.1, mat('boards', { color: 0x8A7458, roughness: 0.85 }));
    if (bi % 3 === 1) { const L2 = new THREE.PointLight(0xFFB060, 0, 9, 2); L2.position.set(0, floorY + 2.4, d / 2 + 1.4); bx.add(L2); lights.push(L2); }
    x += w + 0.4 + R() * 0.6; bi++;
  }
  // seawall on the water side of the street, the promenade
  const sw = new THREE.Group(); root.add(sw);
  { const stone = plain({ color: 0x4A4642, roughness: 0.95 }), cap = plain({ color: 0x8A8478, roughness: 0.9 });
    for (let k = 0; k < Math.ceil(L / 6); k++) { const cx = -L / 2 + 3 + k * 6, gy = gh(cx, 6.2); const g = new THREE.BoxGeometry(6.02, 3.2, 1.1); g.translate(cx, gy - 1.2, 6.2); const m = new THREE.Mesh(g, stone); m.castShadow = m.receiveShadow = true; sw.add(m); const c2 = new THREE.BoxGeometry(6.02, 0.2, 1.3); c2.translate(cx, gy + 0.5, 6.2); const mc = new THREE.Mesh(c2, cap); mc.castShadow = mc.receiveShadow = true; sw.add(mc); } }
  // coconut palms along the seawall and behind the shops
  if (item.palms !== false) {
    const trunkM = plain({ color: 0x7A6A56, roughness: 0.9 }), frondM = new THREE.MeshStandardMaterial({ map: frondTex(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, color: 0xFFFFFF });
    const trunks = [], fronds = [];
    const palm = (px, pz, hgt, lean, seed) => {
      const r2 = rng(seed), gy = gh(px, pz), dir = r2() * TAU, pts = [];
      for (let k = 0; k <= 8; k++) { const u = k / 8; pts.push(new THREE.Vector3(px + Math.cos(dir) * lean * u * u * hgt, gy + u * hgt, pz + Math.sin(dir) * lean * u * u * hgt)); }
      const curve = new THREE.CatmullRomCurve3(pts), tg = new THREE.TubeGeometry(curve, 12, 0.17, 7, false);
      const p = tg.attributes.position; for (let i = 0; i < p.count; i++) { const yy = (p.getY(i) - gy) / hgt; const c = curve.getPoint(clamp(yy, 0, 1)); p.setXYZ(i, c.x + (p.getX(i) - c.x) * (1.25 - 0.45 * yy), p.getY(i), c.z + (p.getZ(i) - c.z) * (1.25 - 0.45 * yy)); }
      tg.computeVertexNormals(); trunks.push(tg);
      const topP = pts[8], n = 11;
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU + r2() * 0.3, len = 3.2 + r2() * 1.2, droop = 0.7 + r2() * 0.5, seg = 8, P = [], I = [], UV = [];
        for (let s = 0; s <= seg; s++) {
          const u = s / seg, rr = u * len, yy = Math.sin(u * 1.2) * 0.9 - droop * u * u * len * 0.5, cx = Math.cos(a), cz = Math.sin(a), wdt = 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.05));
          for (const sgn of [-1, 1]) { P.push(topP.x + cx * rr - cz * wdt * sgn, topP.y + yy, topP.z + cz * rr + cx * wdt * sgn); UV.push(sgn < 0 ? 0 : 1, u); }
        }
        for (let s = 0; s < seg; s++) { const q = s * 2; I.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
        const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); fg.setIndex(I); fg.computeVertexNormals(); fronds.push(fg);
      }
    };
    for (let k = 0; k < Math.floor(L / 13); k++) palm(-L / 2 + 6 + k * 13 + (R() - 0.5) * 4, 8.5 + R() * 3, 9 + R() * 5, 0.12 + R() * 0.2, 500 + k);
    for (let k = 0; k < Math.floor(L / 30); k++) palm(-L / 2 + 15 + k * 30 + R() * 8, -22 - R() * 6, 12 + R() * 5, 0.1 + R() * 0.15, 900 + k);
    const tm = new THREE.Mesh(mergeGeometries(trunks, false), trunkM); tm.castShadow = tm.receiveShadow = true; root.add(tm);
    const fm = new THREE.Mesh(mergeGeometries(fronds, false), frondM); fm.castShadow = true; fm.receiveShadow = true; root.add(fm);
  }
  // the banyan: a central trunk, aerial-root columns, limbs and a wide dark canopy (on the water side, at one end)
  if (item.banyan !== false) {
    const bxp = -L / 2 + Math.min(40, L * 0.25), bzp = 17, gy = gh(bxp, bzp), bark = plain({ color: 0x5E5448, roughness: 0.95 }), leaf = plain({ color: 0x4A6A34, roughness: 0.9, vertexColors: true });
    const tr = [], cn = [], r3 = rng(77);
    tr.push(new THREE.CylinderGeometry(1.2, 1.9, 7, 14).translate(bxp, gy + 3.5, bzp));
    for (let k = 0; k < 14; k++) { const a = r3() * TAU, rr = 5 + r3() * 13, px = bxp + Math.cos(a) * rr, pz = bzp + Math.sin(a) * rr * 0.8, hh = 6 + r3() * 2, g2 = gh(px, pz) - gy; tr.push(new THREE.CylinderGeometry(0.25 + r3() * 0.25, 0.35 + r3() * 0.35, hh - g2 + 0.5, 8).translate(px, gy + (hh + g2) / 2 - 0.2, pz)); }
    for (let k = 0; k < 10; k++) { const a = k / 10 * TAU + r3() * 0.3, len = 12 + r3() * 8, g = new THREE.CylinderGeometry(0.3, 0.6, len, 8); g.rotateZ(Math.PI / 2 - 0.12); g.translate(len / 2, 0, 0); g.rotateY(-a); g.translate(bxp, gy + 6.2 + r3() * 1.2, bzp); tr.push(g); }
    for (let k = 0; k < 72; k++) {
      const a = r3() * TAU, rr = Math.sqrt(r3()) * 21, s = 3.2 + r3() * 3.2, g = new THREE.IcosahedronGeometry(s, 3); g.scale(1, 0.5 + r3() * 0.2, 1);
      const p = g.attributes.position, col = new Float32Array(p.count * 3), tint = 0.75 + r3() * 0.4;
      for (let i = 0; i < p.count; i++) { const n = Math.sin(p.getX(i) * 1.7 + k) * Math.sin(p.getZ(i) * 1.3 + k * 2) * 0.35; p.setXYZ(i, p.getX(i) * (1 + n * 0.15), p.getY(i) * (1 + n * 0.25), p.getZ(i) * (1 + n * 0.15)); const v = tint * (0.8 + 0.3 * (p.getY(i) / s + 0.5)); col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
      g.translate(bxp + Math.cos(a) * rr, gy + 9 + r3() * 3.5 - rr * 0.08, bzp + Math.sin(a) * rr * 0.8); cn.push(g);
    }
    const tm = new THREE.Mesh(mergeGeometries(tr.map((g) => g.index ? g : g), false), bark); tm.castShadow = tm.receiveShadow = true; root.add(tm);
    const cm = new THREE.Mesh(mergeGeometries(cn, false), leaf); cm.castShadow = cm.receiveShadow = true; root.add(cm);
  }
  mergeStatic(root);
  // lit: warm windows (default: on when the sun is low); burning 0..1: the shops glow orange-red from inside and flicker
  const litK = Number.isFinite(+item.lit) ? clamp(+item.lit, 0, 2) : null, burn = clamp(+item.burning || 0, 0, 1);
  const warm = new THREE.Color(0xFFB45A), fire = new THREE.Color(0xFF5A18);
  if (burn > 0) litGlass.emissive.copy(warm).lerp(fire, burn);
  const update = (t = 0) => {
    const k = litK ?? LIGHTS(), fl = burn > 0 ? 1 + burn * (0.35 * Math.sin(t * 11.3) + 0.2 * Math.sin(t * 23.7 + 1.3) + 0.15 * Math.sin(t * 5.1)) : 1;
    litGlass.emissiveIntensity = Math.max(2.2 * k, 4.5 * burn) * fl; for (const l of lights) { l.intensity = Math.max(3 * k, 7 * burn) * fl; if (burn > 0) l.color.copy(warm).lerp(fire, burn); }
  };
  update();
  return { root, radius: L / 2 + 10, height: 16, update, anchors: {}, snapped: true, footprint: [L, 45] };
}
