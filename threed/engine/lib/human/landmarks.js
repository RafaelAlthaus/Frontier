// landmarks.js — single monuments, ground-snapped on a buried plinth, stone through the shared masonry material:
//   landmark.pyramid  landmark.castle  landmark.church  landmark.tower  landmark.lighthouse  landmark.bridge
//   landmark.fortress_wall  landmark.statue (a bronze mannequin on a pedestal — the house figure, never a face)
import * as THREE from 'three';
import * as TX from './textures.js';
import { masonry, plain, setGrime } from '../shared/materials.js';
import { buildSyntheticTown, townTextures } from './town.js';
import { dress } from './kits.js';
import { ground, xz, DEG, patchAll, yawFromHeading } from './common.js';

let MAT = null;
function mats() {
  if (MAT) return MAT;
  setGrime(townTextures().grime);
  const t = (o) => TX.masonry({ size: 512, ...o });
  MAT = {
    lime: masonry(t({ meters: 8, courseH: 0.9, blockL: [1.2, 2.2], tones: ['#D8C8A2', '#CDBD96', '#E0D2AE', '#C4B48E'], mortar: '#B0A080', seed: 3, dirt: 0.4 }), { grime: 0.5, foot: 0.4, streak: 0.4 }),
    grey: masonry(t({ meters: 6, courseH: 0.45, blockL: [0.6, 1.3], tones: ['#8C857A', '#80796E', '#978F83', '#756E64'], mortar: '#5E574E', seed: 31, dirt: 0.6 }), { grime: 0.6, foot: 0.5, streak: 0.5 }),
    slate: plain({ color: 0x4A4E56, roughness: 0.6 }), dark: plain({ color: 0x14110E, roughness: 0.9 }),
    bronze: plain({ color: 0x5A4028, roughness: 0.38, metalness: 1 }), fire: plain({ color: 0xFFB050, emissive: 0xFF9A30, emissiveIntensity: 3 }),
  };
  return MAT;
}
const bx = (w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); } return g; };
const cyl = (r0, r1, h, s = 32) => { const g = new THREE.CylinderGeometry(r1, r0, h, s); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * (r0 + r1), uv.getY(i) * h); return g; };
const put = (p, g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; p.add(o); return o; };
function crenel(p, m, w, d, y, step = 1.6) { for (let x = -w / 2 + step / 2; x < w / 2; x += step * 2) for (const s of [1, -1]) { put(p, bx(step, 1.1, 0.8), m, x, y + 0.55, s * (d / 2 - 0.4)); put(p, bx(0.8, 1.1, step), m, s * (w / 2 - 0.4), y + 0.55, x * d / w); } }

const B = {
  pyramid(p, M, item) { const s = item.size ?? 140, h = s * 0.64; const g = new THREE.ConeGeometry(s / Math.SQRT2, h, 4, 12); g.rotateY(Math.PI / 4); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s * 2, uv.getY(i) * h); put(p, g, M.lime, 0, h / 2 - 2, 0); return { r: s * 0.72, h }; },
  castle(p, M) { put(p, bx(22, 24, 22), M.grey, 0, 10, 0); crenel(p, M.grey, 22, 22, 22); for (const [x, z] of [[-11, -11], [11, -11], [11, 11], [-11, 11]]) { put(p, cyl(4, 4.4, 30), M.grey, x, 13, z); put(p, new THREE.ConeGeometry(5, 8, 24), M.slate, x, 32, z); } put(p, bx(5, 7, 1), M.dark, 0, 1.5, 11.2); return { r: 18, h: 36 }; },
  tower(p, M, item) { const h = item.height ?? 32; put(p, bx(8, h, 8), M.grey, 0, h / 2 - 2, 0); crenel(p, M.grey, 8, 8, h - 2, 1.2); return { r: 6, h }; },
  lighthouse(p, M) { put(p, bx(30, 30, 30), M.lime, 0, 13, 0); put(p, bx(20, 34, 20), M.lime, 0, 45, 0); put(p, cyl(7, 6, 26, 8), M.lime, 0, 75, 0); put(p, cyl(4, 4, 10), M.lime, 0, 93, 0); put(p, new THREE.SphereGeometry(2.6, 16, 10), M.fire, 0, 100, 0); const L = new THREE.PointLight(0xFFA040, 2e4, 900, 2); L.position.set(0, 100, 0); p.add(L); return { r: 22, h: 104 }; },
  bridge(p, M, item) { const L = item.length ?? 60, n = Math.max(2, Math.round(L / 16)); put(p, bx(7, 1.6, L), M.grey, 0, 7.6, 0); for (const s of [1, -1]) put(p, bx(0.5, 1.1, L), M.grey, s * 3.3, 8.9, 0); for (let i = 1; i < n; i++) put(p, bx(6, 9, 3), M.grey, 0, 2.5, -L / 2 + i * L / n); return { r: L / 2, h: 10 }; },
  fortress_wall(p, M, item) { const L = item.length ?? 80; put(p, bx(L, 12, 4), M.grey, 0, 4, 0); for (let x = -L / 2 + 0.8; x < L / 2; x += 3.2) put(p, bx(1.6, 1.4, 1), M.grey, x, 10.7, 1.5); for (const x of [-L / 2, 0, L / 2]) put(p, cyl(5, 5.5, 18), M.grey, x, 7, 0); return { r: L / 2 + 5, h: 16 }; },
  statue(p, M, item) {
    put(p, bx(4, 5, 4), M.grey, 0, 1.5, 0); put(p, bx(4.6, 0.6, 4.6), M.grey, 0, 4.3, 0);
    const { fig } = dress({ id: 'statue', kit: item.kit ?? 'napoleonic_french', headwear: item.headwear, accessories: item.accessories ?? [] }, {});
    const s = (item.height ?? 6) / 1.76; fig.group.scale.setScalar(s); fig.group.position.set(0, 4.6, 0); p.add(fig.group);
    fig.pose({ ...(item.pose === 'point' ? { rArmX: -1.5, rArmZ: -0.1, rShape: 'point', headY: -0.1 } : {}), weapon: 'sling' });
    fig.group.traverse((o) => { if (o.isMesh) { o.material = M.bronze; o.castShadow = o.receiveShadow = true; } });
    return { r: 4, h: 4.6 + (item.height ?? 6) };
  },
};
export const CATALOG = {
  'landmark.pyramid': { desc: 'great pyramid (size = base m, default 140)', params: { at: '[x, z]', heading: 'deg', size: 'm' }, footprint: [140, 140], height: 90, tags: ['landmark', 'ancient'] },
  'landmark.castle': { desc: 'stone keep with four round corner towers, slate cones, battlements', params: { at: '[x, z]', heading: 'deg' }, footprint: [30, 30], height: 36, tags: ['landmark', 'medieval'] },
  'landmark.church': { desc: 'village church with its west tower and spire (town.js)', params: { at: '[x, z]', heading: 'deg' }, footprint: [12, 26], height: 26, tags: ['landmark', 'europe'] },
  'landmark.tower': { desc: 'square stone watchtower with battlements', params: { at: '[x, z]', height: 'm (32)' }, footprint: [8, 8], height: 32, tags: ['landmark', 'medieval'] },
  'landmark.lighthouse': { desc: 'ancient lighthouse (Pharos of Alexandria-like, 3 tiers, fire at the top)', params: { at: '[x, z]' }, footprint: [30, 30], height: 104, tags: ['landmark', 'ancient'] },
  'landmark.bridge': { desc: 'stone bridge on piers (length m, along the heading)', params: { at: '[x, z]', heading: 'deg', length: 'm' }, footprint: [7, 60], height: 10, tags: ['landmark'] },
  'landmark.fortress_wall': { desc: 'fortress curtain wall with round towers (length m, across the heading)', params: { at: '[x, z]', heading: 'deg', length: 'm' }, footprint: [80, 6], height: 16, tags: ['landmark', 'war'] },
  'landmark.statue': { desc: 'bronze statue of a mannequin in any kit on a stone pedestal (faceless)', params: { at: '[x, z]', heading: 'deg', kit: 'kit', height: 'm figure (6)', pose: 'stand|point' }, footprint: [5, 5], height: 11, tags: ['landmark', 'monument'] },
};
export async function build(kind, item = {}, ctx = {}) {
  const G = ground(ctx), at = xz(item.at), M = mats();
  const root = new THREE.Group(); root.name = kind;
  if (kind === 'landmark.church') {
    const c = [[-12, -5.5], [12, -5.5], [12, 5.5], [-12, 5.5]], a = (item.heading ?? 90) * DEG;
    const fp = { p: c.map(([x, z]) => [at[0] + x * Math.cos(a) - z * Math.sin(a), at[1] + x * Math.sin(a) + z * Math.cos(a)]), k: 'church' };
    const town = buildSyntheticTown({ heightAt: G.h, footprints: [], roads: [], churches: [fp], style: 'village', seed: 5, name: kind });
    town.group.traverse((o) => { if (o.isMesh && /:snow$/.test(o.name)) o.visible = false; });
    root.add(town.group); patchAll(root, ctx);
    return { root, radius: 16, height: 26, update: (t) => town.update(t, { snow: 0 }), anchors: { top: town.anchors.churchTop } };
  }
  const f = B[kind.replace('landmark.', '')] || B.tower;
  const p = new THREE.Group(); root.add(p);
  const res = f(p, M, item);
  let lo = Infinity; for (const [dx, dz] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]]) lo = Math.min(lo, G.h(at[0] + dx * res.r * 0.5, at[1] + dz * res.r * 0.5));
  p.position.set(at[0], lo, at[1]); p.rotation.y = yawFromHeading(item.heading ?? 180) - Math.PI;
  patchAll(root, ctx);
  return { root, radius: res.r, height: res.h, update() {}, anchors: { top: p } };
}
