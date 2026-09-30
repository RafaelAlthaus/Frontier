// towns.js — towns by era and region, laid out procedurally (streets, plots, a square) and built with real detail:
//   town.village_europe_1940 / town.medieval_town / town.american_small_town   pitched-roof houses from town.js (the
//       Bastogne builder: stone / stucco / brick walls, recessed windows, slate roofs, chimneys, village church), roads
//   town.ancient_mediterranean / town.middle_east_town   flat-roofed whitewashed / mud-brick blocks (shader windows that
//       light at dusk), temples or domes and a minaret
//   town.modern_city     street grid, blocks and towers with curtain-wall windows (lit at night)
//   town.farm            walled farmstead (La Haye Sainte style): farmhouse, barn, stables, yard wall
// Houses light their windows when the sun is down (read from the shared env uniforms). Everything is ground-snapped
// (plinths go below the lowest corner). Deterministic from item.seed.
import * as THREE from 'three';
import { buildSyntheticTown, townTextures, PALETTE_NAMES } from './town.js';
import { buildFrontStreet, frontStreetCatalog } from './frontstreet.js';
import { FLAT_STYLES } from './townstyles.js';
import * as TX from './textures.js';
import { plain, masonry, setGrime } from '../shared/materials.js';
import { patchMaterial, U } from '../shared/env.js';
import { rng as makeRng, clamp, lerp, smooth } from '../shared/util.js';
import { ground, xz, DEG, patchAll, rngFor } from './common.js';

const TAU = Math.PI * 2;
const SIZES = { tiny: 45, small: 80, medium: 130, large: 200, city: 320 };
const LIGHTS = () => smooth((0.12 - U.uSunDir.value.y) / 0.2);

// ── roads: ribbons conformed to the ground ──────────────────────────────────────────────────────────────────────
let ROADTEX = null;
function roadTex() {
  if (ROADTEX) return ROADTEX;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), id = g.createImageData(256, 256), r = makeRng(9);
  for (let i = 0; i < id.data.length; i += 4) { const v = 0.75 + r() * 0.3; id.data[i] = 255 * v; id.data[i + 1] = 255 * v; id.data[i + 2] = 255 * v; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return (ROADTEX = t);
}
export function roadRibbon(ctx, pts, width, color = 0x6E655A, o = {}) {
  const G = ground(ctx), rows = [], step = o.step ?? 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step));
    for (let k = i ? 1 : 0; k <= n; k++) rows.push([lerp(ax, bx, k / n), lerp(az, bz, k / n), (bx - ax) / L, (bz - az) / L]);
  }
  const pos = [], uv = [], idx = []; let v = 0;
  rows.forEach(([x, z, dx, dz], i) => {
    if (i) v += Math.hypot(x - rows[i - 1][0], z - rows[i - 1][1]);
    for (let j = 0; j <= 4; j++) {
      const u = (j / 4 - 0.5) * width, px = x - dz * u, pz = z + dx * u;
      pos.push(px, G.h(px, pz) + 0.1 + (o.crown ?? 0.04) * (1 - Math.abs(j / 2 - 1)), pz); uv.push(u / 4, v / 4);
    }
  });
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < 4; j++) { const a = i * 5 + j, b = a + 1, c = a + 5, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, plain({ color, map: roadTex(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.receiveShadow = true; m.name = 'road'; return m;
}

// ── European layouts: a main street, a crossing, a square with the church; plots along the frontages ───────────
function streetPlan(R, radius, style) {
  const roads = [], streets = [];
  const bend = (R() - 0.5) * 0.5;
  const main = [[-radius * 1.3, bend * radius * 0.3], [-radius * 0.4, bend * radius * 0.1], [0, 0], [radius * 0.45, -bend * radius * 0.15], [radius * 1.3, -bend * radius * 0.4]];
  streets.push({ pts: main, w: style === 'american' ? 9 : 6.5, main: true });
  const a2 = Math.PI / 2 + (R() - 0.5) * 0.5, cross = [[Math.cos(a2) * -radius * 1.1, Math.sin(a2) * -radius * 1.1], [0, 0], [Math.cos(a2) * radius * 1.1, Math.sin(a2) * radius * 1.1]];
  streets.push({ pts: cross, w: style === 'american' ? 8 : 5.5 });
  if (radius > 70) for (const s of [1, -1]) {
    const off = s * radius * 0.42, a3 = (R() - 0.5) * 0.4;
    streets.push({ pts: [[-radius * 0.8, off + a3 * 10], [0, off], [radius * 0.8, off - a3 * 10]], w: 4.5 });
  }
  if (style === 'american') {           // a grid
    streets.length = 0;
    const n = Math.max(2, Math.round(radius / 55));
    for (let i = -n; i <= n; i++) { streets.push({ pts: [[i * 60, -radius], [i * 60, radius]], w: 9 }); streets.push({ pts: [[-radius, i * 60], [radius, i * 60]], w: i === 0 ? 11 : 9, main: i === 0 }); }
  }
  for (const st of streets) for (let i = 0; i < st.pts.length - 1; i++) roads.push([st.pts[i][0], st.pts[i][1], st.pts[i + 1][0], st.pts[i + 1][1]]);
  return { streets, roads };
}
function plotsAlong(R, streets, radius, style, square) {
  const fps = [], taken = [];
  const free = (x, z, rr) => taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + rr) && Math.hypot(x - square[0], z - square[1]) > square[2] + rr;
  const roadClear = (x, z, rr) => streets.every((st) => { for (let i = 0; i < st.pts.length - 1; i++) { const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = clamp(((x - ax) * dx + (z - az) * dz) / L2), d = Math.hypot(ax + dx * t - x, az + dz * t - z); if (d < st.w / 2 + rr * 0.72) return false; } return true; });
  for (const st of streets) {
    for (let i = 0; i < st.pts.length - 1; i++) {
      const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
      for (const side of [1, -1]) {
        let s = 2 + R() * 4;
        while (s < L - 4) {
          const x0 = ax + dx * s, z0 = az + dz * s, dc = Math.hypot(x0, z0);
          const dens = style === 'american' ? 0.85 : clamp(1.15 - dc / radius, 0.15, 1);
          const w = style === 'american' ? 11 + R() * 5 : lerp(6.5, 12, R()), d = style === 'american' ? 9 + R() * 3 : lerp(6.5, 9.5, R());
          const set = style === 'american' ? 8 + R() * 3 : (dens > 0.7 ? 0.8 : 1.5 + R() * 5);
          const gap = style === 'american' ? 8 + R() * 6 : dens > 0.75 ? R() * 0.6 : 2 + R() * 9;
          if (dc < radius * 1.05 && R() < dens + 0.15) {
            const cx = x0 + dx * w / 2 - dz * side * (st.w / 2 + set + d / 2), cz = z0 + dz * w / 2 + dx * side * (st.w / 2 + set + d / 2);
            const rr = Math.hypot(w, d) / 2;
            if (free(cx, cz, rr * 0.8) && roadClear(cx, cz, Math.min(w, d) * 0.5)) {
              const hx = dx * w / 2, hz = dz * w / 2, px = -dz * side * d / 2, pz = dx * side * d / 2;
              fps.push({ p: [[cx - hx - px, cz - hz - pz], [cx + hx - px, cz + hz - pz], [cx + hx + px, cz + hz + pz], [cx - hx + px, cz - hz + pz]], k: 'house', lv: style === 'medieval' ? String(2 + Math.floor(R() * 2)) : undefined });
              taken.push([cx, cz, rr * 0.8]);
            }
          }
          s += w + gap;
        }
      }
    }
  }
  return fps;
}
function curtainWall(ctx, radius, R) {       // medieval town wall: a stone ring with round towers and a gate gap
  const G = ground(ctx), tex = townTextures();
  const mat = masonry({ ...TX.masonry({ size: 512, meters: 6, courseH: 0.45, blockL: [0.6, 1.3], tones: ['#8C857A', '#80796E', '#978F83', '#756E64'], mortar: '#5E574E', seed: 31, dirt: 0.6 }) }, { grime: 0.6, foot: 0.5, streak: 0.5 });
  const group = new THREE.Group(); group.name = 'townWall';
  const n = Math.round(radius * TAU / 9), rr = radius * 1.12, parts = [], towers = [];
  for (let i = 0; i < n; i++) {
    const a0 = i / n * TAU, a1 = (i + 1) / n * TAU;
    if (Math.abs(Math.sin(a0)) < 0.05 && Math.cos(a0) > 0) continue;      // gates on the main street (east / west)
    if (Math.abs(Math.sin(a0)) < 0.05 && Math.cos(a0) < 0) continue;
    const x0 = Math.cos(a0) * rr, z0 = Math.sin(a0) * rr, x1 = Math.cos(a1) * rr, z1 = Math.sin(a1) * rr, L = Math.hypot(x1 - x0, z1 - z0);
    const y = Math.min(G.h(x0, z0), G.h(x1, z1)) - 1.5, h = 9 + 1.5;
    const g = new THREE.BoxGeometry(L + 0.3, h, 2.2); const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * L, uv.getY(k) * h);
    g.rotateY(-Math.atan2(z1 - z0, x1 - x0)); g.translate((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2); parts.push(g);
    for (let k = 0; k < Math.floor(L / 1.6); k++) { const f = (k + 0.5) / Math.floor(L / 1.6); if (k % 2) continue; const m = new THREE.BoxGeometry(0.8, 0.9, 0.5); m.rotateY(-Math.atan2(z1 - z0, x1 - x0)); m.translate(lerp(x0, x1, f) + Math.cos(a0) * 0.85, y + h + 0.45, lerp(z0, z1, f) + Math.sin(a0) * 0.85); parts.push(m); }
    if (i % 5 === 0) towers.push([x0, z0]);
  }
  for (const [x, z] of towers) { const y = G.h(x, z) - 1.5, g = new THREE.CylinderGeometry(3.4, 3.8, 15, 20); g.translate(x, y + 7.5, z); parts.push(g); const cap = new THREE.ConeGeometry(4.1, 5, 20); cap.translate(x, y + 17.5, z); const cm = new THREE.Mesh(cap, plain({ color: 0x4A4E56, roughness: 0.7 })); cm.castShadow = true; group.add(cm); }
  const { mergeGeometries } = TXM; const geo = mergeGeometries(parts.map((p) => { p.deleteAttribute('normal'); p.computeVertexNormals(); return p.index ? p.toNonIndexed() : p; }), false);
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  return group;
}
import * as TXM from 'three/addons/utils/BufferGeometryUtils.js';

function europeanTown(kind, item, ctx) {
  const style = kind === 'town.medieval_town' ? 'medieval' : kind === 'town.american_small_town' ? 'american' : 'village';
  const R = rngFor(ctx, (item.seed ?? 7) * 101 + 3), G = ground(ctx);
  const radius = SIZES[item.size] ?? (typeof item.size === 'number' ? item.size : SIZES.small);
  const at = xz(item.at), rot = ((item.heading ?? 0) - 0) * DEG;
  const plan = streetPlan(R, radius, style);
  const square = style === 'american' ? [0, 0, 0] : [0, 0, 11 + radius * 0.05];
  // local -> world
  const cs = Math.cos(rot), sn = Math.sin(rot), W = ([x, z]) => [at[0] + x * cs - z * sn, at[1] + x * sn + z * cs];
  const fps = plotsAlong(R, plan.streets, radius, style, square).map((f) => ({ ...f, p: f.p.map(W) }));
  const roads = plan.roads.map(([a, b, c, d]) => [...W([a, b]), ...W([c, d])]);
  const churches = [];
  if (style !== 'american') {
    const cx = square[0] + 6, cz = square[1] - square[2] - 9, hw = 5.5, hd = 12;
    churches.push({ p: [[cx - hd, cz - hw], [cx + hd, cz - hw], [cx + hd, cz + hw], [cx - hd, cz + hw]].map(W), k: 'church' });
  }
  setGrime(townTextures().grime);
  const palette = [item.palette, item.params?.palette].find((v) => typeof v === 'string' && PALETTE_NAMES.includes(v)) || null;   // Q9: colours only
  const town = buildSyntheticTown({ heightAt: G.h, footprints: fps, roads, churches, style, seed: (item.seed ?? 7) * 13 + 1, name: kind, snow: item.snow ?? ctx.weather?.snow ?? 0, palette });
  const root = new THREE.Group(); root.name = kind; root.add(town.group);
  const roadCol = style === 'american' ? 0x3E3E40 : style === 'medieval' ? 0x7A6E5E : 0x5E574E;
  for (const st of plan.streets) root.add(roadRibbon(ctx, st.pts.map(W), st.w, roadCol));
  if (style === 'medieval') { const wall = curtainWall(ctx, radius, R); wall.position.set(0, 0, 0); const g = new THREE.Group(); g.add(wall); g.rotation.y = -rot; g.position.set(at[0], 0, at[1]); root.add(g); }
  const snow = item.snow ?? ctx.weather?.snow ?? 0;
  town.group.traverse((o) => { if (o.isMesh && /:snow$/.test(o.name)) o.visible = snow > 0.01; });
  return { root, radius: radius * 1.25, height: 30, update: (t) => town.update(t, { snow, lights: LIGHTS(), fire: 0 }), anchors: { chimneys: town.anchors.chimneys, smoke: town.anchors.smoke, churchTop: town.anchors.churchTop, square: new THREE.Vector3(at[0], G.h(at[0], at[1]), at[1]) }, stats: town.stats };
}

// ── flat-roofed towns + cities: instanced boxes, windows drawn by the shader (lit at night) ───────────────────────
const CITY_U = { uLights: { value: 0 } };
function blockMaterial(o) {
  const m = new THREE.MeshStandardMaterial({ map: o.map || null, color: 0xffffff, roughness: o.rough ?? 0.9, metalness: o.metal ?? 0, envMapIntensity: o.env ?? 0.5 });
  m.userData.progKey = 'f3dBlock' + o.key;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLights = CITY_U.uLights;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHW; varying vec3 vHN; varying vec4 vHI;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 hw = vec4(transformed, 1.0); vec3 hn = objectNormal; vec4 hi = vec4(0.0);
        #ifdef USE_INSTANCING
          hw = instanceMatrix * hw; hn = mat3(instanceMatrix) * hn; hi = vec4(instanceMatrix[3].xyz, length(instanceMatrix[1].xyz));
        #endif
          vHW = (modelMatrix * hw).xyz; vHN = normalize(mat3(modelMatrix) * hn); vHI = hi; }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vHW; varying vec3 vHN; varying vec4 vHI; uniform float uLights;
        float hh(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }`)
      .replace('#include <map_fragment>', `
        vec3 an = abs(vHN);
        ${o.map ? 'vec2 fuv = an.y > 0.5 ? vHW.xz * 0.25 : vec2(an.x > an.z ? vHW.z : vHW.x, vHW.y) * 0.25; diffuseColor *= texture2D(map, fuv);' : ''}
        float winLit = 0.0;
        if (an.y < 0.5) {
          float u = an.x > an.z ? vHW.z : vHW.x;
          float baseY = vHI.y, v = vHW.y - baseY;
          vec2 cell = vec2(u / ${o.cellX.toFixed(2)}, (v - ${o.y0.toFixed(2)}) / ${o.cellY.toFixed(2)});
          vec2 f = fract(cell), ci = floor(cell);
          float isWin = step(${o.wx0.toFixed(2)}, f.x) * step(f.x, ${o.wx1.toFixed(2)}) * step(${o.wy0.toFixed(2)}, f.y) * step(f.y, ${o.wy1.toFixed(2)}) * step(0.0, ci.y) * step(v, vHI.w - ${o.top.toFixed(2)});
          float pick = hh(vec3(ci, hh(vHI.xyz * 0.13) * 91.0));
          isWin *= step(${o.skip.toFixed(2)}, pick);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${o.win}), isWin * 0.94);
          winLit = isWin * step(${o.litFrac.toFixed(2)}, hh(vec3(ci.yx + 7.0, hh(vHI.zxy) * 57.0))) * uLights;
          diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 1.5, v)) * 0.22;
        } else diffuseColor.rgb *= 0.9;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.62, 0.3) * winLit * 2.2;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${o.glass ? 'if (an.y < 0.5) { roughnessFactor = mix(roughnessFactor, 0.12, 0.8); }' : ''}`);
  };
  return patchMaterial(m);
}
let STUCCO = null;
const stucco = () => (STUCCO ||= TX.stucco(256));
function flatTown(kind, item, ctx) {
  const east = kind === 'town.middle_east_town';
  const R = rngFor(ctx, (item.seed ?? 5) * 77 + 1), G = ground(ctx), at = xz(item.at), rot = (item.heading ?? 0) * DEG;
  const radius = SIZES[item.size] ?? SIZES.small, cs = Math.cos(rot), sn = Math.sin(rot);
  const root = new THREE.Group(); root.name = kind;
  const mat = blockMaterial({ key: east ? 'east' : 'med', map: stucco(), cellX: 3.2, cellY: 3.3, y0: 1.0, wx0: 0.4, wx1: 0.6, wy0: 0.3, wy1: 0.66, top: 0.9, skip: 0.45, win: '0.05, 0.04, 0.03', litFrac: 0.7 });
  const houses = [];
  // organic blocks: a jittered grid of courtyard blocks cut by lanes, a main street and a square
  const cell = 16;
  for (let gx = -radius; gx <= radius; gx += cell) for (let gz = -radius; gz <= radius; gz += cell) {
    const d = Math.hypot(gx, gz); if (d > radius || d < 14) continue;
    if (Math.abs(gz) < 5) continue;                 // main street
    const n = 2 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) {
      const w = 5 + R() * 6, dd = 5 + R() * 6, h = (east ? 3.2 : 3.4) * (1 + Math.floor(R() * (d < radius * 0.5 ? 3 : 2))) + 0.6;
      const lx = gx + (R() - 0.5) * (cell - w), lz = gz + (R() - 0.5) * (cell - dd);
      houses.push([lx, lz, w, h, dd, (R() - 0.5) * 0.12]);
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(box, mat, houses.length); im.castShadow = im.receiveShadow = true;
  const NAMED = { tropical: ['#F2D9C4', '#E8C8C8', '#CDE3D3', '#F4E7B8', '#BFE0E4', '#F6F2EA', '#E9D4E6', '#F0CFA8'], new_england: ['#F4F2EC', '#EDE6D6', '#D8DCDE', '#E6D9B8', '#B8BFB0', '#EFE9DC'] };   // Q9
  const pal = (Array.isArray(item.palette) && item.palette.length) ? item.palette   // optional: house colours (css) for other places
    : NAMED[item.palette] ? NAMED[item.palette]
    : east ? ['#C8A57A', '#B8966A', '#D2B48A', '#A88660', '#CDB08E'] : ['#F2EEE4', '#ECE6D8', '#E6DCC8', '#F4F0E8', '#DCD2BE', '#E8D8BC'];
  const ST = typeof item.style === 'string' ? FLAT_STYLES[item.style] || null : null, palX = ST ? ST.palette : pal, placed = [];   // Q9: opt-in style, same layout
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), c = new THREE.Color();
  houses.forEach(([lx, lz, w, h, dd, yaw], i) => {
    const x = at[0] + lx * cs - lz * sn, z = at[1] + lx * sn + lz * cs;
    let lo = Infinity; for (const [ox, oz] of [[-w / 2, -dd / 2], [w / 2, -dd / 2], [w / 2, dd / 2], [-w / 2, dd / 2]]) lo = Math.min(lo, G.h(x + ox, z + oz));
    const hi = Math.max(G.h(x, z), lo), y0 = lo - 1.0, H = hi - y0 + (ST ? Math.min(h, ST.hmax) : h);
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + yaw); _m.compose(new THREE.Vector3(x, y0, z), _q, new THREE.Vector3(w, H, dd));
    im.setMatrixAt(i, _m); im.setColorAt(i, c.set(palX[Math.floor(R() * palX.length)]));
    if (ST) placed.push({ x, z, top0: hi, top: y0 + H, w, dd, yaw: rot + yaw, lx, lz });
  });
  root.add(im);
  if (ST) ST.extras(root, placed, { R2: makeRng((item.seed ?? 5) * 131 + 17), G, at, rot, radius });   // roofs, awnings, porticoes, paving
  // parapets / roof clutter: small dark boxes on some roofs
  // landmarks: middle east -> domes + a minaret; mediterranean -> a temple on the square (landmarks.js has more)
  const stone = plain({ color: east ? 0xD8C8A8 : 0xE8E2D4, roughness: 0.8 });
  if (item.landmarks === false) { /* optional: no domes, minaret or temple (a plain block town) */ }
  else if (east) {
    const dm = new THREE.SphereGeometry(1, 24, 12, 0, TAU, 0, Math.PI / 2);
    for (let k = 0; k < 3; k++) { const x = at[0] + (k - 1) * 9, z = at[1] - 16, y = G.h(x, z); const base = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 12).translate(0, 4.5, 0), stone); base.position.set(x, y - 1, z); const d = new THREE.Mesh(dm, plain({ color: k === 1 ? 0x3A7A8A : 0xE8E0CC, roughness: 0.4 })); d.scale.setScalar(k === 1 ? 5.5 : 3.5); d.position.set(x, y + 8, z); root.add(base, d); }
    const mx = at[0] + 16, mz = at[1] - 22, my = G.h(mx, mz);
    const min = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 32, 16).translate(0, 16, 0), stone); min.position.set(mx, my - 1, mz); root.add(min);
    const bal = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.0, 1.2, 16), stone); bal.position.set(mx, my + 24, mz); root.add(bal);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4.5, 16), plain({ color: 0x3A7A8A, roughness: 0.4 })); cap.position.set(mx, my + 33.2, mz); root.add(cap);
  } else {
    const x = at[0], z = at[1] - 2, y = G.h(x, z);
    const podium = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 22).translate(0, 0.8, 0), stone); podium.position.set(x, y - 0.5, z); root.add(podium);
    const col = new THREE.CylinderGeometry(0.5, 0.58, 8, 16).translate(0, 4, 0), cols = [];
    for (let i = 0; i < 6; i++) for (const zz of [-10, 10]) cols.push([x - 5.5 + i * 2.2, z + zz]);
    for (let i = 1; i < 9; i++) for (const xx of [-5.5, 5.5]) cols.push([x + xx, z - 10 + i * 2.5]);
    const ci = new THREE.InstancedMesh(col, stone, cols.length); cols.forEach(([cx, cz], i) => { _m.makeTranslation(cx, y + 1.1, cz); ci.setMatrixAt(i, _m); }); root.add(ci);
    const ent = new THREE.Mesh(new THREE.BoxGeometry(13, 1.4, 22).translate(0, 0.7, 0), stone); ent.position.set(x, y + 9.1, z); root.add(ent);
    const sh = new THREE.Shape(); sh.moveTo(-6.8, 0); sh.lineTo(6.8, 0); sh.lineTo(0, 2.6); sh.lineTo(-6.8, 0);
    const ped = new THREE.ExtrudeGeometry(sh, { depth: 22.4, bevelEnabled: false }); ped.translate(0, 0, -11.2); const pm = new THREE.Mesh(ped, plain({ color: 0xB8583A, roughness: 0.7 })); pm.position.set(x, y + 10.5, z); root.add(pm);
  }
  root.add(roadRibbon(ctx, [[-radius, 0], [radius, 0]].map(([lx, lz]) => [at[0] + lx * cs - lz * sn, at[1] + lx * sn + lz * cs]), 7, ST ? ST.road : east ? 0xB09A78 : 0xA89C88));
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, radius: radius * 1.1, height: 35, update: () => { CITY_U.uLights.value = LIGHTS(); }, anchors: { square: new THREE.Vector3(at[0], G.h(at[0], at[1]), at[1]) } };
}
function modernCity(kind, item, ctx) {
  const R = rngFor(ctx, (item.seed ?? 3) * 31 + 7), G = ground(ctx), at = xz(item.at), rot = (item.heading ?? 0) * DEG, cs = Math.cos(rot), sn = Math.sin(rot);
  const radius = SIZES[item.size] ?? SIZES.large, block = 64, street = 16;
  const root = new THREE.Group(); root.name = kind;
  const glass = blockMaterial({ key: 'tower', cellX: 1.6, cellY: 3.6, y0: 4.0, wx0: 0.06, wx1: 0.94, wy0: 0.12, wy1: 0.92, top: 2.0, skip: 0.0, win: '0.10, 0.13, 0.16', litFrac: 0.55, rough: 0.5, metal: 0.3, env: 1.2, glass: true });
  const concrete = blockMaterial({ key: 'office', map: stucco(), cellX: 2.4, cellY: 3.5, y0: 4.2, wx0: 0.18, wx1: 0.82, wy0: 0.2, wy1: 0.8, top: 1.5, skip: 0.1, win: '0.06, 0.07, 0.08', litFrac: 0.6 });
  const boxes = { glass: [], concrete: [] };
  for (let gx = -radius; gx < radius; gx += block + street) for (let gz = -radius; gz < radius; gz += block + street) {
    const cx = gx + block / 2, cz = gz + block / 2, d = Math.hypot(cx, cz); if (d > radius) continue;
    const core = 1 - d / radius;
    const n = 1 + Math.floor(R() * 4);
    for (let k = 0; k < n; k++) {
      const w = lerp(18, 34, R()), dd = lerp(18, 34, R()), h = lerp(12, 40, R()) + core * core * lerp(20, 190, R());
      const lx = cx + (R() - 0.5) * (block - w), lz = cz + (R() - 0.5) * (block - dd);
      (h > 45 || R() < 0.3 ? boxes.glass : boxes.concrete).push([lx, lz, w, h, dd]);
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), c = new THREE.Color();
  for (const [key, list] of Object.entries(boxes)) {
    const im = new THREE.InstancedMesh(box, key === 'glass' ? glass : concrete, Math.max(1, list.length)); im.count = list.length; im.castShadow = im.receiveShadow = true;
    const pal = key === 'glass' ? ['#8FA4B4', '#7E94A6', '#A0B0BC', '#6E8294', '#B4BEC6'] : ['#C8C2B8', '#B8B2A8', '#D4CEC4', '#A8A49C', '#C0B6A6'];
    list.forEach(([lx, lz, w, h, dd], i) => {
      const x = at[0] + lx * cs - lz * sn, z = at[1] + lx * sn + lz * cs;
      let lo = Infinity; for (const [ox, oz] of [[-w / 2, -dd / 2], [w / 2, -dd / 2], [w / 2, dd / 2], [-w / 2, dd / 2]]) lo = Math.min(lo, G.h(x + ox, z + oz));
      _m.compose(new THREE.Vector3(x, lo - 1, z), _q, new THREE.Vector3(w, h + 1, dd)); im.setMatrixAt(i, _m); im.setColorAt(i, c.set(pal[Math.floor(R() * pal.length)]));
    });
    root.add(im);
  }
  for (let g = -radius; g <= radius; g += block + street) {
    const s = g - street / 2;
    root.add(roadRibbon(ctx, [[-radius, s], [radius, s]].map(([lx, lz]) => [at[0] + lx * cs - lz * sn, at[1] + lx * sn + lz * cs]), street, 0x34363A, { step: 4, crown: 0.02 }));
    root.add(roadRibbon(ctx, [[s, -radius], [s, radius]].map(([lx, lz]) => [at[0] + lx * cs - lz * sn, at[1] + lx * sn + lz * cs]), street, 0x34363A, { step: 4, crown: 0.02 }));
  }
  return { root, radius: radius * 1.1, height: 230, update: () => { CITY_U.uLights.value = LIGHTS(); }, anchors: { center: new THREE.Vector3(at[0], G.h(at[0], at[1]), at[1]) } };
}

// ── farm (La Haye Sainte style): stone ranges round a yard, pantiled roofs, a gate ─────────────────────────────────
function boxM(w, h, d) { const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); } return g; }
function roofGeo(w, d, he, hr, over = 0.45) { const s = new THREE.Shape(); s.moveTo(-w / 2 - over, he - 0.25); s.lineTo(w / 2 + over, he - 0.25); s.lineTo(0, hr); s.lineTo(-w / 2 - over, he - 0.25); const g = new THREE.ExtrudeGeometry(s, { depth: d + over * 2, bevelEnabled: false }); g.translate(0, 0, -(d + over * 2) / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i)); return g; }
let FARMTEX = null;
function farm(kind, item, ctx) {
  const G = ground(ctx), at = xz(item.at), rot = (item.heading ?? 0) * DEG;
  FARMTEX ||= { farm: TX.masonry({ size: 512, meters: 8, courseH: 0.42, blockL: [0.5, 1.1], tones: ['#B3AEA3', '#A8A397', '#BDB8AC', '#9D988C'], mortar: '#8A857A', seed: 17, dirt: 0.6 }),
    tiles: TX.masonry({ size: 512, meters: 4, courseH: 0.26, blockL: [0.2, 0.28], tones: ['#5E3A2E', '#523226', '#684234', '#4A2E24'], mortar: '#2A1E18', seed: 23, bevel: 0.06, dirt: 0.45 }) };
  setGrime(townTextures().grime);
  const stone = masonry(FARMTEX.farm, { grime: 0.7, foot: 0.5, streak: 0.5 }), tiles = masonry(FARMTEX.tiles, { grime: 0.6, foot: 0, streak: 0.3, env: 0.3 }), dark = plain({ color: 0x16120f, roughness: 0.9 }), wood = plain({ color: 0x4A3424, roughness: 0.8 });
  const root = new THREE.Group(); root.name = kind;
  const inner = new THREE.Group(); root.add(inner); inner.position.set(at[0], G.h(at[0], at[1]), at[1]); inner.rotation.y = -rot;
  const add = (g, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; inner.add(o); return o; };
  const y0 = -1.2;
  // [x, z, w, d, eaves, ridge, ry]  farmhouse N, barn W, stables E, wall S
  const ranges = [[0, -14, 24, 8, 6.5, 10.5, 0], [-16, 0, 30, 10, 7, 12.5, Math.PI / 2], [15, 2, 22, 7, 4.5, 7.5, Math.PI / 2]];
  for (const [x, z, w, d, he, hr, ry] of ranges) {
    add(boxM(w, he - y0, d).translate(0, (he + y0) / 2, 0), stone, x, 0, z, ry);
    add(roofGeo(w > d ? d : w, w > d ? w : d, he, hr).rotateY(w > d ? Math.PI / 2 : 0), tiles, x, 0, z, ry);
    const nWin = Math.floor(w / 3.2);
    for (let k = 0; k < nWin; k++) { const wx = -w / 2 + (k + 0.5) * w / nWin; const wg = boxM(1.0, 1.3, 0.2).translate(wx, 2.4, d / 2 + 0.02); add(wg, dark, x, 0, z, ry); if (he > 6) add(boxM(1.0, 1.2, 0.2).translate(wx, 5.0, d / 2 + 0.02), dark, x, 0, z, ry); }
  }
  add(boxM(8, 5.5, 0.4).translate(0, 5.5 / 2 - 1.2, 0), dark, 0, 0, -14 + 4.2);                       // barn door
  for (const [x0, z0, x1, z1] of [[-16, 15, -3, 15], [3, 15, 15, 15], [15, 13, 15, 15]]) { const L = Math.hypot(x1 - x0, z1 - z0); add(boxM(L, 3.6 - y0, 0.7).translate(0, (3.6 + y0) / 2, 0), stone, (x0 + x1) / 2, 0, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0)); }
  add(boxM(6, 3.2, 0.3).translate(0, 1.6 - 0.2, 0), wood, 0, 0, 15.1);                                   // the gate
  const yard = new THREE.Mesh(new THREE.CircleGeometry(13, 24).rotateX(-Math.PI / 2), plain({ color: 0x5A4A38, roughness: 1 })); yard.position.set(0, 0.05, 0); yard.receiveShadow = true; inner.add(yard);
  return { root, radius: 30, height: 13, update() {}, anchors: { gate: new THREE.Vector3(at[0], G.h(at[0], at[1]), at[1] + 15) } };
}

// ── catalog + build ────────────────────────────────────────────────────────────────────────────────────────────
const P = { at: '[x, z] centre (the square)', size: 'tiny|small|medium|large (radius 45|80|130|200 m)', heading: 'deg: main street direction', seed: 'layout', snow: '0..1 snow on roofs', landmarks: 'flat towns: false = no domes/minaret/temple', palette: "'tropical'|'new_england' (colours only, the layout is unchanged) or, for flat towns, [css colours] for the house blocks", style: "flat towns: 'thai_beach'|'roman' (opt-in look; same layout)" };
export const CATALOG = {
  'town.village_europe_1940': { desc: 'European village c.1900-1945: stone/stucco houses with slate roofs along a main street and a crossing, church on the square, roads', params: P, footprint: [160, 160], height: 30, tags: ['town', '1940s', 'europe'] },
  'town.medieval_town': { desc: 'medieval walled town: tall steep-roofed houses, church, stone curtain wall with round towers and gates', params: P, footprint: [180, 180], height: 30, tags: ['town', 'medieval'] },
  'town.american_small_town': { desc: 'American small town: street grid, detached painted houses with shutters, wide streets', params: P, footprint: [200, 200], height: 14, tags: ['town', 'america', '1900s'] },
  'town.ancient_mediterranean': { desc: 'ancient Mediterranean town (Alexandria/Athens/Rome): whitewashed flat-roofed blocks, a temple on the square', params: P, footprint: [160, 160], height: 20, tags: ['town', 'ancient'] },
  'town.middle_east_town': { desc: 'Middle-Eastern town: mud-brick flat roofs, domes, a minaret', params: P, footprint: [160, 160], height: 34, tags: ['town', 'middle east'] },
  'town.modern_city': { desc: 'modern city: street grid, office blocks, glass towers in the core (windows lit at night)', params: { ...P, size: 'small|medium|large|city' }, footprint: [400, 400], height: 230, tags: ['city', 'modern'] },
  ...frontStreetCatalog(),   // Q9: town.front_street (Lahaina waterfront)
  'town.farm': { desc: 'walled farmstead: farmhouse, great barn, stables round a yard, gate (La Haye Sainte style)', params: { at: '[x, z]', heading: 'deg' }, footprint: [36, 34], height: 13, tags: ['farm', '1800s', 'europe'] },
};
export async function build(kind, item = {}, ctx = {}) {
  let res;
  if (kind === 'town.front_street') { res = await buildFrontStreet(item, ctx); patchAll(res.root, ctx); res.update(0); return res; }
  if (kind === 'town.ancient_mediterranean' || kind === 'town.middle_east_town') res = flatTown(kind, item, ctx);
  else if (kind === 'town.modern_city') res = modernCity(kind, item, ctx);
  else if (kind === 'town.farm') res = farm(kind, item, ctx);
  else res = europeanTown(kind, item, ctx);
  patchAll(res.root, ctx);
  res.update(0);
  return res;
}
