// text3d.js — solid 3D letters from any web font already on disk, with no font converter: each glyph is drawn on a
// canvas, its outline traced with marching squares on the anti-aliased alpha (so edges land between pixels),
// simplified, split into outer contours and holes, and extruded with a bevel.
//   await loadFont('Cinzel', '/world/fonts/Cinzel.ttf')
//   const word = text3d('WATERLOO', { font: '700 256px Cinzel', height: 40, depth: 6, material })   // one mesh
//   const title = textLetters('THE SIEGE OF BASTOGNE', { ... })   // a Group, one mesh per letter (for typing / rising)
// Units: `height` is the cap height in metres. The mesh sits on its baseline (y = 0), centred on x, front face at +z.
import * as THREE from 'three';

export async function loadFont(family, url) {
  if ([...document.fonts].some((f) => f.family === family && f.status === 'loaded')) return;
  const f = new FontFace(family, `url(${url})`); await f.load(); document.fonts.add(f);
}

// ── tracing ───────────────────────────────────────────────────────────────────────────────────────────────────
function glyphField(text, font, letterSpacing = 0) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font; if (letterSpacing) probe.letterSpacing = letterSpacing + 'px';
  const m = probe.measureText(text), px = parseFloat(/(\d+(\.\d+)?)px/.exec(font)[1]);
  const pad = Math.ceil(px * 0.15);
  const W = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + pad * 2 + 2;
  const asc = Math.ceil(m.actualBoundingBoxAscent), desc = Math.ceil(m.actualBoundingBoxDescent);
  const H = asc + desc + pad * 2 + 2;
  const c = document.createElement('canvas'); c.width = Math.max(4, W); c.height = Math.max(4, H);
  const x = c.getContext('2d'); x.font = font; if (letterSpacing) x.letterSpacing = letterSpacing + 'px';
  x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
  const ox = pad + m.actualBoundingBoxLeft, oy = pad + asc;
  x.fillText(text, ox, oy);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const v = new Float32Array(c.width * c.height);
  for (let i = 0; i < v.length; i++) v[i] = d[i * 4 + 3] / 255;
  // capital height from 'H' so every word of the same font scales the same
  const capH = probe.measureText('H').actualBoundingBoxAscent;
  return { v, W: c.width, H: c.height, ox, oy, capH, advance: m.width, px };
}

// directed marching squares: inside (alpha > 0.5) always on the left of each segment in image coordinates
function trace(F) {
  const { v, W, H } = F, iso = 0.5;
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : v[j * W + i]);
  // edge ids: horizontal edge (i,j)-(i+1,j) = 2*(j*(W+1)+i); vertical edge (i,j)-(i,j+1) = 2*(j*(W+1)+i)+1
  const EW = W + 1;
  const hid = (i, j) => 2 * (j * EW + i), vid = (i, j) => 2 * (j * EW + i) + 1;
  const pos = new Map();
  const hp = (i, j) => { const id = hid(i, j); if (!pos.has(id)) { const a = at(i, j), b = at(i + 1, j); pos.set(id, [i + (iso - a) / (b - a || 1e-6), j]); } return id; };
  const vp = (i, j) => { const id = vid(i, j); if (!pos.has(id)) { const a = at(i, j), b = at(i, j + 1); pos.set(id, [i, j + (iso - a) / (b - a || 1e-6)]); } return id; };
  const next = new Map();
  const seg = (a, b) => next.set(a, b);
  for (let j = -1; j < H; j++) for (let i = -1; i < W; i++) {
    const tl = at(i, j) > iso, tr = at(i + 1, j) > iso, br = at(i + 1, j + 1) > iso, bl = at(i, j + 1) > iso;
    const k = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (k === 0 || k === 15) continue;
    const T = () => hp(i, j), B = () => hp(i, j + 1), L = () => vp(i, j), R = () => vp(i + 1, j);
    switch (k) {                                  // inside on the left, walking the boundary (y down)
      case 1: seg(B(), L()); break;               // bl
      case 2: seg(R(), B()); break;               // br
      case 3: seg(R(), L()); break;               // bl br
      case 4: seg(T(), R()); break;               // tr
      case 5: { const c = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > iso;   // tr bl (saddle)
        if (c) { seg(T(), L()); seg(B(), R()); } else { seg(T(), R()); seg(B(), L()); } break; }
      case 6: seg(T(), B()); break;               // tr br
      case 7: seg(T(), L()); break;               // tr br bl
      case 8: seg(L(), T()); break;               // tl
      case 9: seg(B(), T()); break;               // tl bl
      case 10: { const c = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > iso;  // tl br (saddle)
        if (c) { seg(L(), B()); seg(R(), T()); } else { seg(L(), T()); seg(R(), B()); } break; }
      case 11: seg(R(), T()); break;              // tl bl br
      case 12: seg(L(), R()); break;              // tl tr
      case 13: seg(B(), R()); break;              // tl tr bl
      case 14: seg(L(), B()); break;              // tl tr br
    }
  }
  const loops = [], used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = []; let e = start, guard = 0;
    while (e != null && !used.has(e) && guard++ < 1e6) { used.add(e); loop.push(pos.get(e)); e = next.get(e); }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

function simplify(pts, eps) {                     // Douglas–Peucker on a closed loop
  if (pts.length < 8) return pts;
  const dp = (a, b, out) => {
    let best = -1, bi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    for (let k = a + 1; k < b; k++) { const d = Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / L; if (d > best) { best = d; bi = k; } }
    if (best > eps) { dp(a, bi, out); out.push(pts[bi]); dp(bi, b, out); }
  };
  const half = pts.length >> 1, out = [pts[0]];
  dp(0, half, out); out.push(pts[half]); const tail = pts.concat([pts[0]]); pts = tail; dp(half, pts.length - 1, out);
  return out;
}
const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; s += x0 * y1 - x1 * y0; } return s / 2; };
function inside(pt, poly) {
  let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// loops (image px, y down) -> THREE.Shape[] in metres (y up), scaled so the capital height is `height`
function toShapes(F, loops, height, eps) {
  const s = height / F.capH;
  const polys = loops.map((l) => simplify(l, eps).map(([x, y]) => [(x - F.ox) * s, (F.oy - y) * s])).filter((p) => p.length > 2 && Math.abs(area(p)) > 1e-6 * height * height);
  // nesting depth decides outer vs hole (even = outer), so the tracing direction does not matter
  const depth = polys.map((p, i) => polys.reduce((n, q, j) => n + (j !== i && Math.abs(area(q)) > Math.abs(area(p)) && inside(p[0], q) ? 1 : 0), 0));
  const shapes = polys.map((p, i) => ({ p, i })).filter((o) => depth[o.i] % 2 === 0).map((o) => ({ p: o.p, d: depth[o.i], s: new THREE.Shape(o.p.map(([x, y]) => new THREE.Vector2(x, y))) }));
  polys.forEach((h, i) => {
    if (depth[i] % 2 === 0) return;
    const host = shapes.filter((o) => o.d === depth[i] - 1 && inside(h[0], o.p)).sort((a, b) => Math.abs(area(a.p)) - Math.abs(area(b.p)))[0];
    if (host) host.s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  });
  return shapes.map((o) => o.s);
}

const DEF = { font: '700 256px Cinzel', height: 1, depth: 0.2, bevel: 0.035, bevelSegments: 3, eps: 0.45, letterSpacing: 0 };

// one extruded mesh for the whole string; geometry centred on x, baseline at y = 0, extruding back from z = 0
export function text3dGeometry(text, o = {}) {
  o = { ...DEF, ...o };
  const F = glyphField(text, o.font, o.letterSpacing);
  const shapes = toShapes(F, trace(F), o.height, o.eps);
  const b = o.bevel * o.height;
  const g = new THREE.ExtrudeGeometry(shapes, { depth: o.depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: o.bevelSegments, curveSegments: 1 });
  g.computeBoundingBox();
  const bb = g.boundingBox; g.translate(-(bb.min.x + bb.max.x) / 2, 0, -o.depth - b);
  g.computeVertexNormals();
  g.userData = { width: bb.max.x - bb.min.x, advance: F.advance * o.height / F.capH };
  return g;
}
export function text3d(text, o = {}) {
  const g = text3dGeometry(text, o);
  const m = new THREE.Mesh(g, o.material || new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.5, metalness: 0.1 }));
  m.castShadow = m.receiveShadow = true; m.name = 'text3d:' + text;
  return m;
}
// a Group of per-letter meshes laid out with the font's own advances (kerning kept via prefix widths); each child
// has userData.index / userData.char / userData.x so shots can type, drop or rise the letters one by one
export function textLetters(text, o = {}) {
  o = { ...DEF, ...o };
  const probe = document.createElement('canvas').getContext('2d'); probe.font = o.font; if (o.letterSpacing) probe.letterSpacing = o.letterSpacing + 'px';
  const capH = probe.measureText('H').actualBoundingBoxAscent, s = o.height / capH;
  const total = probe.measureText(text).width * s;
  const group = new THREE.Group(); group.name = 'letters:' + text;
  const mat = o.material || new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.5, metalness: 0.1 });
  let k = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]; if (ch === ' ') continue;
    const x0 = probe.measureText(text.slice(0, i)).width * s, w = probe.measureText(ch).width * s;
    const g = text3dGeometry(ch, o);
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.x = x0 + w / 2 - total / 2;
    mesh.userData = { index: k++, char: ch, x: mesh.position.x };
    group.add(mesh);
  }
  group.userData = { width: total, count: k };
  return group;
}
