// details_extra.js — the DETAIL kit, optional props (E3, 2026-09-27): a framed portrait photograph (a faceless sitter's
// silhouette, sepia studio print), a gimballed brass boat compass whose card swings to a bearing, and porro binoculars
// with a leather strap. The helpers { propBase, finish, anchor } come from details.js (no import cycle).
import * as THREE from 'three';
import {
  TAU, clamp, lerp, smooth, smoother, makeRng, DEG, FAM, font, canvas, ctex, rgba, normalFrom, woodTex,
  phys, std, metal, glass, varnished, mesh, lathe, roundRect, blob, tube, ropeMat, ropeRepeat, damped, num, loadFonts,
} from './details_core.js';

// ══ detail.photo_frame ════════════════════════════════════════════════════════════════════════════════════════════
function portrait(o) {
  const W = 1024, H = 1280, [c, g] = canvas(W, H), R = makeRng(num(o.seed, 3));
  const bg = g.createRadialGradient(W * 0.5, H * 0.38, 40, W * 0.5, H * 0.45, H * 0.7);
  bg.addColorStop(0, '#D8C3A0'); bg.addColorStop(0.55, '#A88A62'); bg.addColorStop(1, '#4A3822'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // the sitter: head, neck, shoulders as one soft dark silhouette (no face: a studio print gone to shadow)
  const woman = String(o.sitter ?? 'man') === 'woman';
  const sil = new Path2D();
  const cx = W * 0.5, hy = H * 0.36, hr = W * 0.13;
  // each ellipse its own subpath (moveTo first): chained ellipse() calls are joined by straight lines (a box)
  const E = (x, y, rx, ry, rot = 0) => { sil.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); sil.ellipse(x, y, rx, ry, rot, 0, TAU); };
  E(cx, hy, hr * 0.84, hr * 1.08);
  if (woman) { E(cx + hr * 0.12, hy - hr * 1.02, hr * 0.5, hr * 0.38, 0.1); E(cx, hy - hr * 0.42, hr * 0.96, hr * 0.74); }
  else E(cx, hy - hr * 0.5, hr * 0.9, hr * 0.6);
  sil.moveTo(cx - hr * 0.42, hy + hr * 0.8); sil.lineTo(cx - hr * 0.5, hy + hr * 1.5);
  sil.bezierCurveTo(cx - W * 0.3, hy + hr * 1.7, cx - W * 0.42, hy + hr * 2.4, cx - W * 0.46, H);
  sil.lineTo(cx + W * 0.46, H); sil.bezierCurveTo(cx + W * 0.42, hy + hr * 2.4, cx + W * 0.3, hy + hr * 1.7, cx + hr * 0.5, hy + hr * 1.5);
  sil.lineTo(cx + hr * 0.42, hy + hr * 0.8); sil.closePath();
  const sg = g.createLinearGradient(0, hy - hr, 0, H); sg.addColorStop(0, '#2A1E12'); sg.addColorStop(1, '#171009');
  g.fillStyle = sg; g.fill(sil);
  g.save(); g.clip(sil); const rim = g.createRadialGradient(cx - hr * 1.4, hy - hr, 10, cx - hr * 1.4, hy - hr, hr * 2.6); rim.addColorStop(0, 'rgba(200,170,120,0.12)'); rim.addColorStop(1, 'rgba(200,170,120,0)'); g.fillStyle = rim; g.fillRect(0, 0, W, H);
  if (!woman) { g.fillStyle = 'rgba(210,195,165,0.55)'; g.beginPath(); g.moveTo(cx - hr * 0.5, hy + hr * 1.45); g.lineTo(cx, hy + hr * 2.1); g.lineTo(cx + hr * 0.5, hy + hr * 1.45); g.lineTo(cx + hr * 0.3, hy + hr * 1.3); g.lineTo(cx, hy + hr * 1.6); g.lineTo(cx - hr * 0.3, hy + hr * 1.3); g.closePath(); g.fill(); }
  g.restore();
  for (let i = 0; i < 26000; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,240,210'},${R() * 0.05})`; g.fillRect(R() * W, R() * H, 2, 2); }
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72); vg.addColorStop(0, 'rgba(40,25,10,0)'); vg.addColorStop(1, 'rgba(40,25,10,0.65)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return c;
}
function mat(o) {                                   // the cream mount with an oval window and a caption written under it
  const W = 1024, H = 1340, [c, g] = canvas(W, H), R = makeRng(5);
  g.fillStyle = '#E8DFC8'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 20000; i++) { g.fillStyle = `rgba(120,100,70,${R() * 0.05})`; g.fillRect(R() * W, R() * H, 2, 1); }
  g.drawImage(portrait(o), W * 0.14, H * 0.08, W * 0.72, H * 0.72);
  g.save(); g.beginPath(); g.rect(0, 0, W, H); g.ellipse(W / 2, H * 0.44, W * 0.33, H * 0.33, 0, 0, TAU, true); g.fillStyle = '#E8DFC8'; g.fill('evenodd'); g.restore();
  g.strokeStyle = 'rgba(150,120,70,0.9)'; g.lineWidth = 6; g.beginPath(); g.ellipse(W / 2, H * 0.44, W * 0.335, H * 0.335, 0, 0, TAU); g.stroke();
  if (o.caption) { g.fillStyle = '#2A2A40'; g.textAlign = 'center'; g.font = font(450, 64, FAM.serif, true); g.fillText(String(o.caption), W / 2, H * 0.9); }
  return c;
}
export async function buildPhotoFrame(kind, it, ctx, H) {
  await loadFonts();
  const { root, env, resolveOn } = H.propBase(kind, it, ctx, { surface: 'desk', aimY: 0.1, scale: 0.9 });
  const fw = 0.16, fh = 0.21, b = 0.018;
  const silver = String(it.style ?? 'silver') !== 'wood';
  const frameM = silver ? metal('silver', env, { roughness: 0.2 }) : varnished(woodTex('walnut'), env, { clearcoat: 0.9 });
  const F = new THREE.Group(); F.name = 'photo_frame'; root.add(F);
  const lean = new THREE.Group(); lean.rotation.x = -num(it.lean, 12) * DEG; F.add(lean);
  const outer = roundRect(fw, fh, 0.012), hole = roundRect(fw - b * 2, fh - b * 2, 0.004); outer.holes.push(new THREE.Path(hole.getPoints(24).reverse()));
  const fg = new THREE.ExtrudeGeometry(outer, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 4 }); fg.translate(0, fh / 2, -0.004);
  mesh(fg, frameM, lean, 0, 0.004, 0);
  const pm = std({ map: ctex(mat(it)), roughness: 0.9 });
  const ph = mesh(new THREE.PlaneGeometry(fw - b * 2 + 0.004, fh - b * 2 + 0.004), pm, lean, 0, fh / 2 + 0.004, 0.0015); ph.name = 'photo';
  const pane = mesh(new THREE.PlaneGeometry(fw - b * 2 + 0.004, fh - b * 2 + 0.004), phys({ color: 0xFFFFFF, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, envMap: env, envMapIntensity: 1.1, depthWrite: false }), lean, 0, fh / 2 + 0.004, 0.0035, false); pane.name = 'glass_pane';   // a reflective sheet, not transmission (the transmission pass smeared the print)
  mesh(new THREE.BoxGeometry(fw - 0.01, fh - 0.01, 0.003), std({ color: 0x3A2A1E, roughness: 0.8 }), lean, 0, fh / 2 + 0.004, -0.006);
  const strut = mesh(new THREE.BoxGeometry(0.03, 0.147, 0.003), std({ color: 0x3A2A1E, roughness: 0.8 }), F, 0, 0.065, -0.0705); strut.rotation.x = 0.488;   // hinged behind the backing, foot on the desk 10 cm back (it used to pierce the print)
  blob(root, fw * 1.3, 0.14, 0.5, 0, -0.02);
  const faceA = H.anchor(lean, 'photo', 0, fh / 2 + 0.004, 0.004);
  return H.finish(root, ctx, { radius: 0.15, height: fh, update: () => { if (resolveOn) resolveOn(); }, anchors: { photo: faceA, face: faceA, center: faceA } });
}

// ══ detail.compass — a gimballed boat compass ═════════════════════════════════════════════════════════════════════
function compassCard() {
  const N = 2048, [c, g] = canvas(N, N), cx = N / 2, R = N / 2 * 0.98;
  g.fillStyle = '#EFE7D2'; g.beginPath(); g.arc(cx, cx, N / 2, 0, TAU); g.fill();
  g.save(); g.translate(cx, cx); g.strokeStyle = '#1A1A1A'; g.fillStyle = '#1A1A1A';
  g.lineWidth = R * 0.006; g.beginPath(); g.arc(0, 0, R * 0.97, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, R * 0.84, 0, TAU); g.stroke();
  for (let d = 0; d < 360; d++) { g.save(); g.rotate(d * DEG); g.lineWidth = R * (d % 10 ? 0.003 : 0.006); g.beginPath(); g.moveTo(0, -R * 0.97); g.lineTo(0, -R * (d % 10 ? 0.93 : d % 30 ? 0.905 : 0.89)); g.stroke(); if (d % 30 === 0) { g.font = font(600, R * 0.055, FAM.serif); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(d), 0, -R * 0.865 + R * 0.07); } g.restore(); }
  for (let k = 0; k < 32; k++) {
    const main = k % 8 === 0, half = k % 4 === 0, L = main ? 0.8 : half ? 0.62 : k % 2 ? 0.42 : 0.52;
    g.save(); g.rotate(k * TAU / 32); g.fillStyle = main ? '#1A1A1A' : half ? '#7A1E16' : '#3A3A3A';
    g.beginPath(); g.moveTo(0, -R * L); g.lineTo(R * 0.035, -R * 0.12); g.lineTo(0, 0); g.closePath(); g.fill();
    g.fillStyle = '#EFE7D2'; g.beginPath(); g.moveTo(0, -R * L); g.lineTo(-R * 0.035, -R * 0.12); g.lineTo(0, 0); g.closePath(); g.fill(); g.lineWidth = 2; g.stroke(); g.restore();
  }
  g.font = font(700, R * 0.13, FAM.caps); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1A1A1A';
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([s, a]) => { g.save(); g.rotate(a * DEG); g.fillStyle = s === 'N' ? '#7A1E16' : '#1A1A1A'; g.fillText(s, 0, -R * 0.66); g.restore(); });
  g.fillStyle = '#B8923F'; g.beginPath(); g.arc(0, 0, R * 0.05, 0, TAU); g.fill();
  g.restore(); return c;
}
export async function buildCompass(kind, it, ctx, H) {
  await loadFonts();
  const { root, env, resolveOn } = H.propBase(kind, it, ctx, { surface: 'wood', aimY: 0.06, scale: 0.9 });
  const brass = metal('brass', env, { env: 1.25 });
  const C = new THREE.Group(); C.name = 'compass'; root.add(C);
  // a square teak box, the gimbal ring on two pins, the bowl on two more
  const box = varnished(woodTex('teak'), env, { clearcoat: 0.6 });
  for (const [w, d, x, z] of [[0.2, 0.014, 0, 0.093], [0.2, 0.014, 0, -0.093], [0.014, 0.2, 0.093, 0], [0.014, 0.2, -0.093, 0]]) mesh(new THREE.BoxGeometry(w, 0.075, d), box, C, x, 0.0375, z);
  mesh(new THREE.BoxGeometry(0.2, 0.01, 0.2), box, C, 0, 0.005, 0);
  const ring = new THREE.Group(); ring.position.y = 0.06; C.add(ring);
  mesh(new THREE.TorusGeometry(0.078, 0.005, 16, 96).rotateX(Math.PI / 2), brass, ring);
  for (const s of [1, -1]) mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.018, 12).rotateZ(Math.PI / 2), brass, ring, s * 0.086, 0, 0);
  const bowl = new THREE.Group(); ring.add(bowl);
  for (const s of [1, -1]) mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.016, 12).rotateX(Math.PI / 2), brass, bowl, 0, 0, s * 0.074);
  mesh(lathe([[0, -0.045], [0.03, -0.044], [0.055, -0.035], [0.068, -0.015], [0.07, 0.008], [0.074, 0.01], [0.074, 0.016], [0.066, 0.016], [0.064, 0.008], [0.062, -0.012], [0, -0.012]], 96), brass, bowl);
  const card = new THREE.Group(); card.position.y = 0.002; bowl.add(card);
  mesh(new THREE.CircleGeometry(0.06, 128).rotateX(-Math.PI / 2), phys({ map: ctex(compassCard()), roughness: 0.5, clearcoat: 0.4, envMap: env, envMapIntensity: 0.4 }), card);
  mesh(new THREE.BoxGeometry(0.0015, 0.012, 0.004), std({ color: 0x111111 }), bowl, 0, 0.008, -0.061);   // lubber line
  mesh(new THREE.CircleGeometry(0.066, 96).rotateX(-Math.PI / 2), glass(env, { thickness: 0.002, env: 1.5 }), bowl, 0, 0.0155, 0, false);
  blob(root, 0.26, 0.26, 0.5);
  // the card shows `bearing` (the ship's heading) under the lubber line; turn_to + t swings it with a damped overshoot
  const b0 = num(it.bearing, 0), b1 = num(it.turn_to, b0), tt = num(it.t, 1), sw = num(it.swing, 1.4);
  const update = (t) => {
    if (resolveOn) resolveOn();
    let b = b0; if (b1 !== b0 && t > tt) { const u = (t - tt) / sw; let d = ((b1 - b0 + 540) % 360) - 180; b = b0 + d * (u < 1 ? smoother(u) : 1) + (u > 0.6 ? d * 0.06 * damped(t - tt - sw * 0.6, 0.7, 1.6) : 0); }
    card.rotation.y = b * DEG + 0.4 * DEG * Math.sin(t * 1.3);
    ring.rotation.x = 0.8 * DEG * Math.sin(t * 0.9); bowl.rotation.z = 0.6 * DEG * Math.sin(t * 1.1 + 1);
  };
  update(0);
  const cardA = H.anchor(bowl, 'card', 0, 0.003, 0);
  return H.finish(root, ctx, { radius: 0.15, height: 0.1, update, anchors: { card: cardA, face: cardA, center: cardA } });
}

// ══ detail.binoculars — porro prism binoculars with a leather strap ═══════════════════════════════════════════════
export async function buildBinoculars(kind, it, ctx, H) {
  const { root, env, resolveOn } = H.propBase(kind, it, ctx, { surface: 'desk', aimY: 0.03, scale: 0.9 });
  const leather = phys({ color: 0x141210, roughness: 0.62, clearcoat: 0.2, envMap: env, envMapIntensity: 0.4 });
  const body = metal(it.metal || 'black_steel', env, { roughness: 0.35 }), brass = metal('brass', env);
  const B = new THREE.Group(); B.name = 'binoculars'; B.rotation.y = num(it.turn, 20) * DEG; root.add(B);
  const lay = new THREE.Group(); lay.rotation.x = -Math.PI / 2; lay.position.y = 0.032; B.add(lay);   // lying on its side: barrels along z
  for (const s of [1, -1]) {
    const side = new THREE.Group(); side.position.x = s * 0.036; lay.add(side);
    mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.08, 48), leather, side, s * 0.012, -0.04, 0);                          // objective barrel (offset: porro)
    mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.012, 48), body, side, s * 0.012, -0.086, 0);
    mesh(new THREE.TorusGeometry(0.026, 0.002, 8, 48).rotateX(Math.PI / 2), brass, side, s * 0.012, -0.093, 0);
    const lens = mesh(new THREE.CircleGeometry(0.025, 48).rotateX(Math.PI / 2), phys({ color: 0x0A0E14, roughness: 0.02, metalness: 0.2, iridescence: 0.8, iridescenceIOR: 1.4, envMap: env, envMapIntensity: 1.6 }), side, s * 0.012, -0.0925, 0); lens.rotation.x = Math.PI;
    mesh(new THREE.BoxGeometry(0.045, 0.05, 0.042), leather, side, s * 0.004, 0.02, 0);                                    // prism housing
    mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.045, 32), body, side, -s * 0.006, 0.065, 0);                            // eyepiece
    mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.018, 32), std({ color: 0x0C0C0C, roughness: 0.8 }), side, -s * 0.006, 0.095, 0);
  }
  mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.07, 24).rotateZ(Math.PI / 2), body, lay, 0, 0.03, 0.0);
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.016, 32).rotateZ(Math.PI / 2), brass, lay, 0, 0.055, 0.0);             // focus wheel
  const strapM = ropeMat('#2A1C12', env);
  const strap = tube([[0.06, 0.03, 0.02], [0.14, 0.004, 0.06], [0.2, 0.004, -0.04], [0.12, 0.004, -0.14], [-0.02, 0.004, -0.12], [-0.06, 0.03, 0.02]], 0.004, strapM, 120, 8); strap.scale.set(1, 1, 1); ropeRepeat(strap, 0.7, 0.004); B.add(strap);
  blob(B, 0.2, 0.22, 0.5);
  const eyeA = H.anchor(B, 'lenses', 0, 0.03, 0.09);
  return H.finish(root, ctx, { radius: 0.2, height: 0.07, update: () => { if (resolveOn) resolveOn(); }, anchors: { lenses: eyeA, center: eyeA } });
}

const P_SET = { surface: 'desk | table | wood | deck | none', backdrop: 'dark | steel | none', light: 'warm | cool | top | none', elev: 'm', place_on: "'structures:N.desk'", offset: '[dx, dz]', heading: 'deg: the viewer side' };
export const EXTRA_CATALOG = {
  'detail.photo_frame': { section: 'objects', desc: 'INSERT: a framed studio portrait standing on a desk (silver or walnut frame on a strut, glass): a sepia print of a FACELESS sitter (head-and-shoulders silhouette, man in collar and tie or woman with a bun) in an oval cream mount with a handwritten `caption`', params: { sitter: 'man | woman', caption: "'Mother, 1908'", style: 'silver | wood', lean: 'deg (12)', ...P_SET }, actions: [], anchors: ['photo'], footprint: [0.2, 0.15], height: 0.22, tags: ['detail', 'insert', 'photo', 'portrait', 'frame', 'family', 'memory'] },
  'detail.compass': { section: 'objects', desc: "INSERT: a gimballed brass boat compass in a teak box: a 32-point card (0–360°, red N) under glass with a lubber line, the gimbals rocking gently. `bearing` = the ship's heading under the lubber line; turn_to + t = the card swings round (damped) as she turns", params: { bearing: 'deg (0)', turn_to: 'deg', t: 's', swing: 's (1.4)', ...P_SET }, actions: ['turn_to'], anchors: ['card'], footprint: [0.2, 0.2], height: 0.1, tags: ['detail', 'insert', 'compass', 'navigation', 'bearing', 'heading', 'ship'] },
  'detail.binoculars': { section: 'objects', desc: 'INSERT: a pair of black leather porro-prism binoculars lying on a desk with a brass focus wheel, coated lenses and a leather strap (the lookout’s missing binoculars)', params: { turn: 'deg on the desk (20)', metal: 'black_steel | brass', ...P_SET }, actions: [], anchors: ['lenses'], footprint: [0.25, 0.25], height: 0.07, tags: ['detail', 'insert', 'binoculars', 'lookout', 'crow’s nest', 'titanic'] },
};
