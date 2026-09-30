// townstyles.js — opt-in looks for the flat towns (Q9, 26 Sep 2026): item.style on town.ancient_mediterranean /
// town.middle_east_town. The town's seeded layout is unchanged (the same houses at the same places; the style only
// recolours the walls, caps the height at two storeys and adds roofs and street dressing, all drawn from a separate rng).
//   thai_beach  low concrete shophouses and bungalows (whites, pastels, bright accents), pitched roofs in corrugated
//               metal or clay tile, awnings over the shop fronts, bright signboards
//   roman       plastered walls in ochre, Pompeian red and cream, low terracotta hip roofs, atrium houses with an open
//               compluvium, columned porticoes on the main street, basalt-paved streets
import * as THREE from 'three';
import { plain } from '../shared/materials.js';
import { rng, clamp, lerp } from '../shared/util.js';

// unit roofs on [-0.5, 0.5] x [0, 1] x [-0.5, 0.5] (x across the ridge, z along it), scaled per house
export function gableGeo() {
  const P = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5];
  const q = (a, b, c, d) => [a, b, c, a, c, d];
  const I = [...q(0, 3, 5, 2), ...q(4, 1, 2, 5), 0, 2, 1, 3, 4, 5, ...q(0, 1, 4, 3)];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
  const n = g.toNonIndexed(); n.computeVertexNormals(); return n;
}
export function hipGeo() {
  const P = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, -0.22, 0, 1, 0.22];
  const I = [0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 3, 5, 4, 3, 4, 0, 0, 1, 2, 0, 2, 3];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
  const n = g.toNonIndexed(); n.computeVertexNormals(); return n;
}
export function compluviumGeo(k = 0.26) {            // atrium roof: four planes sloping IN to a central opening, the court below
  const o = 0.5, i = k, yo = 1, yi = 0.45, yc = 0.02;
  const P = [], push = (...v) => P.push(...v);
  const quad = (a, b, c, d) => { push(...a, ...b, ...c, ...a, ...c, ...d); };
  quad([-o, yo, -o], [-i, yi, -i], [i, yi, -i], [o, yo, -o]);
  quad([o, yo, -o], [i, yi, -i], [i, yi, i], [o, yo, o]);
  quad([o, yo, o], [i, yi, i], [-i, yi, i], [-o, yo, o]);
  quad([-o, yo, o], [-i, yi, i], [-i, yi, -i], [-o, yo, -o]);
  // eaves skirt down to the wall top (closes the gap under the raised outer edge)
  quad([-o, 0, -o], [-o, yo, -o], [o, yo, -o], [o, 0, -o]); quad([o, 0, -o], [o, yo, -o], [o, yo, o], [o, 0, o]);
  quad([o, 0, o], [o, yo, o], [-o, yo, o], [-o, 0, o]); quad([-o, 0, o], [-o, yo, o], [-o, yo, -o], [-o, 0, -o]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals();
  // the court: inner walls down from the opening + its floor (separate, dark)
  const C = [], cq = (a, b, c, d) => C.push(...a, ...b, ...c, ...a, ...c, ...d);
  cq([-i, yi, -i], [-i, yc, -i], [i, yc, -i], [i, yi, -i]); cq([i, yi, -i], [i, yc, -i], [i, yc, i], [i, yi, i]);
  cq([i, yi, i], [i, yc, i], [-i, yc, i], [-i, yi, i]); cq([-i, yi, i], [-i, yc, i], [-i, yc, -i], [-i, yi, -i]);
  cq([-i, yc, -i], [-i, yc, i], [i, yc, i], [i, yc, -i]);
  const c = new THREE.BufferGeometry(); c.setAttribute('position', new THREE.Float32BufferAttribute(C, 3)); c.computeVertexNormals();
  return { roof: g, court: c };
}
const unitBox = () => { const b = new THREE.BoxGeometry(1, 1, 1); b.translate(0, 0.5, 0); return b; };

// placed: [{x, z, hi (ground at the house), top (wall top y), w, dd, yaw, lx, lz}] in world space; ctx: {G, R2, at, rot}
function instanced(root, geo, mat, list, colorOf) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length), c = new THREE.Color();
  list.forEach((m, i) => { im.setMatrixAt(i, m.matrix); if (colorOf) im.setColorAt(i, c.set(colorOf(m, i))); });
  im.castShadow = im.receiveShadow = true; root.add(im); return im;
}
const M4 = (x, y, z, yaw, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sx, sy, sz));
// yaw, then a pitch about the object's own x axis, then the scale (a sloped awning keeps its slope whatever its size)
const M4p = (x, y, z, yaw, pitch, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)), new THREE.Vector3(sx, sy, sz));
// a point on the house facade facing the main street (local lz = 0): offset n metres out of the facade
// (world space: the town lays out (lx, lz) as x = at + lx*cos(rot) - lz*sin(rot), z = at + lx*sin(rot) + lz*cos(rot); the main
// street is town-local lz = 0, so the street side of a house is n = sign(lz) * (sin rot, -cos rot))
function facade(h, along, up, out, rot) {
  const s = h.lz > 0 ? 1 : -1, n = [s * Math.sin(rot), -s * Math.cos(rot)], t = [n[1], -n[0]];
  const th = h.yaw, ux = [Math.cos(th), -Math.sin(th)], uz = [Math.sin(th), Math.cos(th)];
  const ext = Math.abs(n[0] * ux[0] + n[1] * ux[1]) * h.w / 2 + Math.abs(n[0] * uz[0] + n[1] * uz[1]) * h.dd / 2;
  const len = Math.abs(t[0] * ux[0] + t[1] * ux[1]) * h.w + Math.abs(t[0] * uz[0] + t[1] * uz[1]) * h.dd, d = ext + out;
  return [h.x + n[0] * d + t[0] * along, h.top0 + up, h.z + n[1] * d + t[1] * along, Math.atan2(n[0], n[1]), len];
}

function thaiExtras(root, placed, o) {
  const R2 = o.R2, gable = gableGeo();
  const roofs = [], awn = [], signs = [], posts = [];
  placed.forEach((h) => {
    const alongX = h.w >= h.dd, rh = lerp(0.9, 1.6, R2()), tile = R2() < 0.35;
    h.roofCol = tile ? ['#B4562E', '#A24A2A', '#C0643A'][Math.floor(R2() * 3)] : ['#8E9294', '#7E8284', '#8A4A32', '#5E7C98', '#9A4A3A', '#6E7C5C', '#A8AAA8'][Math.floor(R2() * 7)];   // corrugated metal: grey, rust, faded paint
    roofs.push({ matrix: M4(h.x, h.top, h.z, h.yaw + (alongX ? Math.PI / 2 : 0), (alongX ? h.dd : h.w) + 0.6, rh, (alongX ? h.w : h.dd) + 0.6), col: h.roofCol });
    if (Math.abs(h.lz) < 22 && R2() < 0.75) {         // shop front on the main street: an awning, a signboard, two posts
      const col = ['#2E6EA8', '#C0392B', '#2E8B57', '#E0A020', '#E8E4DA', '#7A3E9A'][Math.floor(R2() * 6)];
      const [ax, ay, az, ay2, len] = facade(h, 0, 2.75, 0.9, o.rot);
      const aw = { matrix: M4p(ax, ay, az, ay2, 0.3, len * 0.92, 0.07, 1.8), col };
      awn.push(aw);
      const [sx, sy, sz, sy2] = facade(h, 0, 3.4, 0.05, o.rot);
      signs.push({ matrix: M4(sx, sy, sz, sy2, len * 0.7, 0.62, 0.08), col: ['#F4D03F', '#E74C3C', '#FFFFFF', '#3498DB', '#F39C12', '#27AE60'][Math.floor(R2() * 6)] });
      for (const sd of [-1, 1]) { const [px, , pz] = facade(h, sd * len * 0.43, 0, 1.7, o.rot), gy = o.G.h(px, pz); posts.push({ matrix: M4(px, gy - 0.2, pz, 0, 0.08, h.top0 + 2.55 - gy + 0.2, 0.08) }); }
    }
  });
  const metal = plain({ roughness: 0.55, metalness: 0.35 }), cloth = plain({ roughness: 0.9, side: THREE.DoubleSide }), sign = plain({ roughness: 0.6, emissive: 0x111111 });
  instanced(root, gable, metal, roofs, (m) => m.col);
  instanced(root, unitBox(), cloth, awn, (m) => m.col);
  instanced(root, unitBox(), sign, signs, (m) => m.col);
  instanced(root, unitBox(), plain({ color: 0xB8B4AC, roughness: 0.7 }), posts);
}

function romanExtras(root, placed, o) {
  const R2 = o.R2, hip = hipGeo(), cp = compluviumGeo();
  const tileM = plain({ roughness: 0.8 }), courtM = plain({ color: 0x4E5A3E, roughness: 1 });
  const roofs = [], atria = [], courts = [], cols = [], porch = [];
  placed.forEach((h) => {
    const rh = lerp(0.7, 1.1, R2()), col = ['#B55A3C', '#A94F34', '#BF6844', '#9E4A30'][Math.floor(R2() * 4)];
    if (h.w > 7 && h.dd > 7 && R2() < 0.7) {           // an atrium house: tiles slope in to the open court
      const m = M4(h.x, h.top, h.z, h.yaw, h.w + 0.5, rh, h.dd + 0.5);
      atria.push({ matrix: m, col }); courts.push({ matrix: M4(h.x, h.top, h.z, h.yaw, h.w + 0.5, rh, h.dd + 0.5) });
    } else roofs.push({ matrix: M4(h.x, h.top, h.z, h.yaw + (h.w >= h.dd ? Math.PI / 2 : 0), (h.w >= h.dd ? h.dd : h.w) + 0.5, rh, (h.w >= h.dd ? h.w : h.dd) + 0.5), col });
    if (Math.abs(h.lz) < 20 && R2() < 0.55) {         // a portico on the main street: columns and a lean-to tile roof
      const len = facade(h, 0, 0, 0, o.rot)[4], n = Math.max(2, Math.floor(len / 2.3));
      for (let k = 0; k < n; k++) { const a = -len / 2 + 0.5 + k * (len - 1) / (n - 1), [cx, , cz] = facade(h, a, 0, 1.8, o.rot), gy = o.G.h(cx, cz); cols.push({ matrix: M4(cx, gy - 0.1, cz, 0, 0.44, h.top0 + 3.3 - gy + 0.1, 0.44) }); }
      const [px, py, pz, pyaw] = facade(h, 0, 3.3, 1.05, o.rot);
      porch.push({ matrix: M4p(px, py, pz, pyaw, 0.2, len + 0.2, 0.14, 2.3), col });
    }
  });
  instanced(root, hip, tileM, roofs, (m) => m.col);
  instanced(root, cp.roof, tileM, atria, (m) => m.col);
  instanced(root, cp.court, courtM, courts);
  const column = new THREE.CylinderGeometry(0.42, 0.5, 1, 12); column.translate(0, 0.5, 0);
  instanced(root, column, plain({ color: 0xE8DDC8, roughness: 0.7 }), cols);
  instanced(root, unitBox(), tileM, porch, (m) => m.col);
  // basalt paving over the whole town (streets and lanes between the houses)
  const Rr = o.radius * 1.08, N = 48, P = [], I = [], UV = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const lx = -Rr + 2 * Rr * i / N, lz = -Rr + 2 * Rr * j / N, x = o.at[0] + lx * Math.cos(o.rot) - lz * Math.sin(o.rot), z = o.at[1] + lx * Math.sin(o.rot) + lz * Math.cos(o.rot);
    P.push(x, o.G.h(x, z) + 0.05, z); UV.push(x / 2.5, z / 2.5);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    const cx = -Rr + 2 * Rr * (i + 0.5) / N, cz = -Rr + 2 * Rr * (j + 0.5) / N; if (Math.hypot(cx, cz) > Rr) continue;
    I.push(a, c, b, b, c, d);
  }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); pg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); pg.setIndex(I); pg.computeVertexNormals();
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g2 = cv.getContext('2d'), Rt = rng(19);
  g2.fillStyle = '#3E3C3A'; g2.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 90; k++) { const x = Rt() * 256, y = Rt() * 256, r = 14 + Rt() * 16, v = 70 + Rt() * 40; g2.fillStyle = `rgb(${v},${v - 2},${v - 6})`; g2.beginPath(); for (let a = 0; a < 6; a++) { const an = a / 6 * Math.PI * 2 + Rt() * 0.5, rr = r * (0.75 + Rt() * 0.35); g2[a ? 'lineTo' : 'moveTo'](x + Math.cos(an) * rr, y + Math.sin(an) * rr); } g2.closePath(); g2.fill(); }
  const pt = new THREE.CanvasTexture(cv); pt.colorSpace = THREE.SRGBColorSpace; pt.wrapS = pt.wrapT = THREE.RepeatWrapping;
  const pave = new THREE.Mesh(pg, plain({ map: pt, color: 0xC8C0B4, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  pave.receiveShadow = true; pave.name = 'roman.paving'; root.add(pave);
}

export const FLAT_STYLES = {
  thai_beach: { hmax: 6.4, road: 0x6C6A66, palette: ['#F4F2EC', '#EDEAE2', '#E8E4D8', '#D8DCD8', '#F2E3B8', '#F4CFC4', '#C8E4E0', '#BFD8E8', '#F0D8A0', '#E2E0DA', '#FFFFFF', '#D0CCC4'], extras: thaiExtras },
  roman: { hmax: 7.0, road: 0x5A5854, palette: ['#D9B26B', '#C99A52', '#B5452F', '#A83A28', '#E8D9B8', '#D8C4A0', '#C77B4A', '#E2C08A'], extras: romanExtras },
};
export const FLAT_STYLE_NAMES = Object.keys(FLAT_STYLES);
