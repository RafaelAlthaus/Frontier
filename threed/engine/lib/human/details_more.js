// details_more.js — the DETAIL kit, part 2 (E3, 2026-09-27): a laid table that lists (tilt: things slide and topple,
// the chandelier swings to the new vertical, wine spills), a lifebuoy with a painted name, a brass / gilt / enamel sign,
// an oil lantern or a candle (flicker). The helpers { propBase, finish, anchor } come from details.js (no import cycle).
import * as THREE from 'three';
import { text3dGeometry } from '../shared/text3d.js';
import {
  TAU, clamp, lerp, smooth, smoother, makeRng, DEG, FAM, font, canvas, ctex, rgba, normalFrom, woodTex, studioEnv,
  phys, std, metal, glass, porcelain, varnished, mesh, lathe, roundRect, plateGeo, blob, tube, ropeMat, ropeRepeat, damped, num, vnoise, loadFonts,
} from './details_core.js';

// ══ 6. detail.tableware ═══════════════════════════════════════════════════════════════════════════════════════════
function ringColors(g, bands) {        // vertex colours by radius: [[r0, r1, hex], ...] on a lathe
  const p = g.attributes.position, c = new Float32Array(p.count * 3), base = new THREE.Color(0xFFFFFF), k = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)); let col = base; for (const [a, b, h] of bands) if (r >= a && r <= b) col = k.set(h); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
}
export async function buildTableware(kind, it, ctx, H) {
  await loadFonts();
  const W = 1.3, D = 0.85;
  const { root, S, env, resolveOn } = H.propBase(kind, { light_level: 0.55, ...it }, ctx, { surface: 'table', size: [W, D], aimY: 0.05, scale: 1 });
  const por = porcelain(env, { vertexColors: true }), gl = glass(env, { thickness: 0.003 }), silver = metal('silver', env, { roughness: 0.16 });
  const band = String(it.pattern ?? 'cobalt') === 'green' ? 0x1F5A3A : 0x1C3170, gold = 0xC9A04A;
  const items = [];
  const add = (name, x, z, o) => { const g = new THREE.Group(); g.name = name; const pivot = new THREE.Group(); pivot.add(g); root.add(pivot); pivot.position.set(x, 0, z); items.push({ name, g, pivot, x0: x, z0: z, ...o }); return g; };
  // dinner plate: foot, well, rim with a cobalt band and a gilt line
  { const g = add('plate', 0, 0.1, { r: 0.13, h: 0.01, mu: 0.24, tip: 90 });
    mesh(ringColors(lathe([[0, 0.004], [0.07, 0.004], [0.072, 0], [0.078, 0], [0.085, 0.006], [0.1, 0.009], [0.118, 0.014], [0.126, 0.017], [0.13, 0.0175], [0.1305, 0.016], [0.126, 0.0145], [0.118, 0.0118], [0.1, 0.0068], [0.085, 0.0045], [0, 0.0055]], 96), [[0.111, 0.121, band], [0.1235, 0.1255, gold]]), por, g); blob(g, 0.3, 0.3, 0.45); }
  // cup + saucer (tea), a spoon on the saucer
  { const g = add('cup', 0.34, 0.16, { r: 0.075, h: 0.04, mu: 0.22, tip: 45, liquid: true });
    mesh(ringColors(lathe([[0, 0.002], [0.03, 0.002], [0.032, 0], [0.036, 0], [0.05, 0.006], [0.07, 0.011], [0.075, 0.0125], [0.0745, 0.0112], [0.07, 0.0098], [0.05, 0.005], [0.03, 0.0035], [0, 0.0035]], 96), [[0.066, 0.072, band]]), por, g);
    const cup = new THREE.Group(); cup.position.y = 0.0035; g.add(cup);
    mesh(ringColors(lathe([[0, 0.001], [0.022, 0.001], [0.024, 0], [0.028, 0.004], [0.04, 0.02], [0.046, 0.045], [0.047, 0.058], [0.0445, 0.058], [0.043, 0.046], [0.037, 0.021], [0.026, 0.006], [0, 0.005]], 96), [[0.0438, 0.0472, band]]), por, cup);
    mesh(new THREE.TorusGeometry(0.016, 0.0038, 12, 32, Math.PI * 1.25).rotateZ(-Math.PI * 0.62), porcelain(env), cup, 0.052, 0.034, 0);
    const tea = mesh(new THREE.CircleGeometry(0.0425, 48).rotateX(-Math.PI / 2), phys({ color: 0x3A1A08, roughness: 0.05, clearcoat: 1, envMap: env, envMapIntensity: 1.2 }), cup, 0, 0.048, 0, false); tea.name = 'liquid';
    items[items.length - 1].liq = tea;
    const sp = new THREE.Group(); sp.position.set(-0.02, 0.012, 0.045); sp.rotation.y = 0.4; g.add(sp); mesh(new THREE.BoxGeometry(0.004, 0.002, 0.08), silver, sp, 0, 0, -0.02); mesh(new THREE.SphereGeometry(0.011, 16, 8).scale(0.8, 0.25, 1.3), silver, sp, 0, 0, 0.03);
    blob(g, 0.17, 0.17, 0.4); }
  // wine glass with red wine, water tumbler
  { const g = add('wine', 0.14, -0.14, { r: 0.034, h: 0.075, mu: 0.26, tip: 24, liquid: true, wine: true });
    mesh(lathe([[0, 0], [0.034, 0], [0.0345, 0.0015], [0.012, 0.004], [0.004, 0.012], [0.0035, 0.07], [0.012, 0.076], [0.03, 0.09], [0.039, 0.115], [0.037, 0.145], [0.035, 0.162], [0.0335, 0.162], [0.0355, 0.145], [0.0375, 0.115], [0.029, 0.092], [0.012, 0.079], [0, 0.077]], 96), gl, g);
    const wine = mesh(lathe([[0, 0.0785], [0.012, 0.0805], [0.028, 0.093], [0.0345, 0.107], [0, 0.107]], 64), phys({ color: 0x4A0612, roughness: 0.04, clearcoat: 1, transmission: 0.35, thickness: 0.02, attenuationColor: new THREE.Color(0x5A0010), attenuationDistance: 0.01, envMap: env, envMapIntensity: 1 }), g, 0, 0, 0, false); wine.name = 'liquid';
    items[items.length - 1].liq = wine; blob(g, 0.08, 0.08, 0.35); }
  { const g = add('tumbler', 0.26, -0.07, { r: 0.033, h: 0.05, mu: 0.28, tip: 32, liquid: true });
    mesh(lathe([[0, 0], [0.03, 0], [0.033, 0.004], [0.037, 0.105], [0.0355, 0.105], [0.0315, 0.009], [0, 0.009]], 96), gl, g);
    const w = mesh(lathe([[0, 0.0095], [0.031, 0.0095], [0.0345, 0.07], [0, 0.07]], 64), phys({ color: 0xEAF4F6, roughness: 0.02, transmission: 1, thickness: 0.04, ior: 1.33, envMap: env, envMapIntensity: 1 }), g, 0, 0, 0, false); w.name = 'liquid';
    items[items.length - 1].liq = w; blob(g, 0.08, 0.08, 0.35); }
  // cutlery: fork left, knife and soup spoon right
  const fork = () => { const s = new THREE.Shape(); s.moveTo(-0.0045, 0); s.lineTo(0.0045, 0); s.lineTo(0.004, 0.11); s.quadraticCurveTo(0.012, 0.13, 0.012, 0.15); for (let k = 0; k < 4; k++) { const x0 = 0.012 - k * 0.0064; s.lineTo(x0, 0.195); s.lineTo(x0 - 0.0028, 0.195); s.lineTo(x0 - 0.0028, 0.155); s.lineTo(x0 - 0.0064, 0.155); } s.lineTo(-0.012, 0.15); s.quadraticCurveTo(-0.012, 0.13, -0.004, 0.11); s.closePath(); return s; };
  const knife = () => { const s = new THREE.Shape(); s.moveTo(-0.0055, 0); s.lineTo(0.0055, 0); s.lineTo(0.005, 0.11); s.lineTo(0.009, 0.115); s.quadraticCurveTo(0.009, 0.2, 0, 0.225); s.lineTo(-0.004, 0.115); s.lineTo(-0.005, 0.11); s.closePath(); return s; };
  const flat = (shape, name, x, z, rot) => { const g = add(name, x, z, { r: 0.02, h: 0.003, mu: 0.2, tip: 90 }); const m = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.0025, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2 }).rotateX(-Math.PI / 2), silver, g, 0, 0.0008, 0.11); m.rotation.y = rot; blob(g, 0.04, 0.24, 0.3); return g; };
  flat(fork(), 'fork', -0.165, 0.1, 0); flat(knife(), 'knife', 0.165, 0.1, 0);
  { const g = add('spoon', 0.2, 0.1, { r: 0.02, h: 0.004, mu: 0.2, tip: 90 }); mesh(new THREE.BoxGeometry(0.008, 0.003, 0.13), silver, g, 0, 0.0025, 0.03); mesh(new THREE.SphereGeometry(0.02, 24, 12).scale(0.85, 0.25, 1.35), silver, g, 0, 0.004, -0.06); blob(g, 0.05, 0.23, 0.3); }
  // bud vase with a rose
  { const g = add('vase', -0.26, -0.16, { r: 0.028, h: 0.07, mu: 0.32, tip: 21 });
    mesh(ringColors(lathe([[0, 0], [0.028, 0], [0.03, 0.006], [0.032, 0.03], [0.026, 0.07], [0.012, 0.11], [0.01, 0.15], [0.013, 0.158], [0.011, 0.158], [0.008, 0.15], [0, 0.15]], 64), [[0.0, 0.2, 0xFFFFFF]]), porcelain(env, { color: 0xE6EEF4 }), g);
    mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.14, 8), std({ color: 0x2E5A22, roughness: 0.6 }), g, 0.003, 0.2, 0).rotation.z = 0.06;
    const rose = new THREE.Group(); rose.position.set(0.007, 0.27, 0); g.add(rose); const petal = phys({ color: 0x8A1020, roughness: 0.55, sheen: 0.8, sheenColor: new THREE.Color(0xFF6070), side: THREE.DoubleSide });
    for (let k = 0; k < 11; k++) { const a = k * 2.4, r = 0.004 + k * 0.0013; const pt = mesh(new THREE.SphereGeometry(0.012 + k * 0.0008, 12, 8, 0, Math.PI, 0, Math.PI * 0.6).scale(1, 1.1, 0.5), petal, rose, Math.cos(a) * r, -k * 0.0009, Math.sin(a) * r); pt.rotation.set(0.2 + k * 0.05, -a + Math.PI / 2, 0); }
    const leaf = mesh(new THREE.SphereGeometry(0.015, 12, 8).scale(1, 0.1, 0.45), std({ color: 0x2E5A22, roughness: 0.5 }), g, 0.012, 0.21, 0); leaf.rotation.z = -0.5;
    blob(g, 0.07, 0.07, 0.4); }
  // a fiddle rail round the table edge (ship furniture): what stops the slide
  const fid = it.fiddle ?? (num(it.tilt, 0) !== 0);
  if (fid) { const fm = varnished(woodTex('mahogany'), env); for (const [w, x, z, ry] of [[W - 0.04, 0, D / 2 - 0.02, 0], [W - 0.04, 0, -D / 2 + 0.02, 0], [D - 0.04, W / 2 - 0.02, 0, Math.PI / 2], [D - 0.04, -W / 2 + 0.02, 0, Math.PI / 2]]) { const f = mesh(new THREE.BoxGeometry(w, 0.022, 0.014), fm, root, x, 0.011, z); f.rotation.y = ry; } }
  // chandelier over the table: hangs along the (tilted) vertical, swings when the ship lists
  let chand = null, clight = null;
  if (it.chandelier !== false) {
    const pivot = new THREE.Group(); pivot.position.set(0, num(it.chandelier_h, 1.45) + 0.55, -0.05); root.add(pivot); chand = pivot;
    const br = metal('brass', env), crystal = phys({ color: 0xFFFFFF, roughness: 0.02, transmission: 0.9, thickness: 0.01, ior: 1.6, envMap: env, envMapIntensity: 2, specularIntensity: 1 });
    const chain = []; for (let k = 0; k < 14; k++) chain.push(mesh(new THREE.TorusGeometry(0.012, 0.003, 8, 16), br, pivot, 0, -k * 0.038, 0)); chain.forEach((c, k) => { c.rotation.y = k % 2 ? Math.PI / 2 : 0; });
    const body = new THREE.Group(); body.position.y = -0.55; pivot.add(body);
    mesh(lathe([[0, 0.06], [0.03, 0.05], [0.05, 0.0], [0.04, -0.06], [0.015, -0.11], [0, -0.13]], 48), br, body);
    mesh(new THREE.TorusGeometry(0.22, 0.008, 12, 96).rotateX(Math.PI / 2), br, body, 0, 0, 0);
    const bulbM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.8, 0.55).multiplyScalar(2.2) });
    const drops = [];
    for (let k = 0; k < 6; k++) { const a = k * TAU / 6, x = Math.cos(a) * 0.22, z = Math.sin(a) * 0.22; body.add(tube([[0, 0, 0], [x * 0.5, -0.05, z * 0.5], [x, 0.0, z], [x * 1.05, 0.06, z * 1.05]], 0.006, br, 24, 6)); mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.03, 16), br, body, x * 1.05, 0.07, z * 1.05); const b = mesh(new THREE.SphereGeometry(0.016, 16, 12).scale(1, 1.5, 1), bulbM, body, x * 1.05, 0.105, z * 1.05, false); b.name = 'glow_bulb'; }
    for (let k = 0; k < 24; k++) { const a = k * TAU / 24; drops.push([Math.cos(a) * 0.225, -0.05, Math.sin(a) * 0.225]); }
    const dg = new THREE.OctahedronGeometry(0.012, 0).scale(0.7, 1.6, 0.7), inst = new THREE.InstancedMesh(dg, crystal, drops.length); const m4 = new THREE.Matrix4();
    drops.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); inst.setMatrixAt(i, m4); }); body.add(inst);
    clight = new THREE.PointLight(0xFFC890, 1.6 * num(it.light_level, 1), 5, 2); clight.position.y = 0.08; clight.castShadow = true; clight.shadow.mapSize.set(512, 512); clight.shadow.camera.near = 0.2; clight.shadow.bias = -0.002; body.add(clight);
  }
  // the list: theta(t) = tilt * ramp from t (+ a lurch); downhill = +X (the viewer's right; negative tilt = left)
  const tilt = num(it.tilt, 0) * DEG, t0 = num(it.t, 0.6), ramp = Math.max(0.2, num(it.ramp, 2.2)), lurch = it.lurch ? num(it.lurch === true ? 0.35 : it.lurch, 0.35) : 0;
  const th = (t) => tilt * smoother((t - t0) / ramp) + (lurch ? tilt * lurch * damped(t - t0 - ramp * 0.4, 0.9, 2.2) : 0);
  const sgn = Math.sign(tilt) || 1, dur = Math.max(1, (ctx.dur ?? 8) + 1), dt = 1 / 240, g = 9.81;
  // precompute the slide (x along downhill), the topple angle and yaw per item: every frame is a pure function of t
  const edge = W / 2 - 0.04;
  const sim = items.map(() => ({ X: [], F: [], Y: [] }));
  const st = items.map((q) => ({ x: 0, v: 0, fall: 0, fv: 0, moving: false, fallen: false, yaw: 0 }));
  const R = makeRng(num(it.seed, 3));
  const yawK = items.map(() => (R() - 0.5) * 6);
  for (let s = 0, t = 0; t <= dur; s++, t = s * dt) {
    const a = Math.abs(th(t)), adot = (Math.abs(th(t + dt)) - Math.abs(th(t - dt))) / (2 * dt);
    items.forEach((q, i) => {
      const z = st[i], mus = q.mu, muk = q.mu * 0.8;
      if (!z.fallen && a + adot * 0.12 > q.tip * DEG) z.fallen = true;          // tips over (a lurch topples tall things earlier)
      if (z.fallen && z.fall < Math.PI / 2) { z.fv += (g / Math.max(0.03, q.h * 1.4)) * Math.sin(z.fall + a) * dt; z.fall = Math.min(Math.PI / 2, z.fall + z.fv * dt); if (z.fall >= Math.PI / 2) z.fv = 0; }
      const mu = z.fallen ? 0.45 : (z.moving ? muk : mus);
      if (!z.moving && Math.tan(a) > mus) z.moving = true;
      if (!z.moving && !z.fallen && Math.tan(a) > 0.55 * mus) z.x += dt * 0.025 * Math.pow((Math.tan(a) / mus - 0.55) / 0.45, 1.5);   // creep: the ship's vibration walks things downhill before they slip
      if (z.moving) { const acc = g * (Math.sin(a) - mu * Math.cos(a)); z.v = Math.max(0, z.v + acc * dt); z.x += z.v * dt; z.yaw += yawK[i] * z.v * dt; if (z.v === 0 && acc < 0) z.moving = false; }
      const lim = edge - (sgn > 0 ? q.x0 : -q.x0) - q.r; if (z.x > lim) { z.x = lim; z.v = 0; }
    });
    // no passing through each other: an uphill item stops against the one below it in its lane
    const ord = items.map((q, i) => i).sort((i, j) => sgn * ((items[j].x0 + sgn * st[j].x) - (items[i].x0 + sgn * st[i].x)));
    for (let k = 0; k < ord.length; k++) for (let m = 0; m < k; m++) {
      const i = ord[k], j = ord[m], qi = items[i], qj = items[j];
      if (Math.abs(qi.z0 - qj.z0) > (qi.r + qj.r) * 0.8) continue;
      const xi = qi.x0 + sgn * st[i].x, xj = qj.x0 + sgn * st[j].x, gap = sgn * (xj - xi) - (qi.r + qj.r) * 0.85;
      if (gap < 0 && sgn * (xj - qj.x0) >= 0 && st[i].x > 0) { st[i].x = Math.max(0, st[i].x + gap); st[i].v = Math.min(st[i].v, st[j].v); }
    }
    if (s % 8 === 0) items.forEach((q, i) => { sim[i].X.push(st[i].x); sim[i].F.push(st[i].fall); sim[i].Y.push(st[i].yaw); });
  }
  const HZ = 30;
  const look = (arr, t) => { const f = clamp(t * HZ, 0, arr.length - 1.001), k = Math.floor(f); return lerp(arr[k], arr[k + 1] ?? arr[k], f - k); };
  // chandelier: a damped pendulum driven by the list angle
  const PS = []; { let p = 0, v = 0; const L = 0.6; for (let s = 0, t = 0; t <= dur; s++, t = s * dt) { const acc = -(g / L) * Math.sin(p - th(t)) - 1.6 * v; v += acc * dt; p += v * dt; if (s % 8 === 0) PS.push(p); } }
  // wine spill: a stain grows under a fallen wine glass
  const spillIdx = items.findIndex((q) => q.wine);
  const [sc, sg] = canvas(256, 256); { const gr = sg.createRadialGradient(128, 128, 10, 128, 128, 128); gr.addColorStop(0, 'rgba(90,10,24,0.85)'); gr.addColorStop(0.7, 'rgba(90,10,24,0.6)'); gr.addColorStop(1, 'rgba(90,10,24,0)'); sg.fillStyle = gr; sg.beginPath(); for (let k = 0; k <= 24; k++) { const a = k / 24 * TAU, r = 100 + 22 * Math.sin(a * 3) + 10 * Math.sin(a * 7); sg.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); } sg.fill(); }
  const spill = mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ctex(sc), transparent: true, depthWrite: false, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -3 }), root, 0, 0.0009, 0, false); spill.visible = false; spill.name = 'contactShadow_spill';
  let spillT = null; if (spillIdx >= 0) { const F = sim[spillIdx].F; const k = F.findIndex((v) => v > 1.2); if (k >= 0) spillT = k / HZ; }
  const update = (t) => {
    if (resolveOn) resolveOn();
    const a = th(t);
    items.forEach((q, i) => {
      const x = look(sim[i].X, t), f = look(sim[i].F, t), yaw = look(sim[i].Y, t);
      q.pivot.position.set(q.x0 + sgn * x, 0, q.z0); q.pivot.rotation.y = yaw;
      // topple about the downhill foot: rotate the item round its base edge
      q.g.rotation.z = -sgn * f; q.g.position.set(sgn * q.r * (1 - Math.cos(f)) , q.r * Math.sin(f) * 0.9, 0);
      if (q.liq) { q.liq.visible = f < 0.5; if (q.liq.geometry.type === 'CircleGeometry') q.liq.rotation.z = clamp(a, -0.25, 0.25) * 0.6; }   // the tea's free surface stays level (a disc turns about its centre; the wine / water bodies would cut the glass)
    });
    if (chand) chand.rotation.z = look(PS, t);
    if (spillT != null && t > spillT) { const u = smooth((t - spillT) / 1.6), q = items[spillIdx]; spill.visible = true; spill.scale.setScalar(0.02 + 0.2 * u); spill.position.set(q.x0 + sgn * (look(sim[spillIdx].X, t) + 0.09), 0.0009, q.z0); } else spill.visible = false;
  };
  update(0);
  const cupA = H.anchor(items[1].g, 'cup', 0, 0.05, 0), wineA = H.anchor(items[2].g, 'glass', 0, 0.1, 0), plateA = H.anchor(items[0].g, 'plate', 0, 0.02, 0);
  return H.finish(root, ctx, { radius: 0.6, height: 0.3, update, anchors: { cup: cupA, glass: wineA, wine: wineA, plate: plateA, center: plateA, chandelier: chand || plateA } });
}

// ══ 7. detail.lifebuoy ═════════════════════════════════════════════════════════════════════════════════════════════
export async function buildLifebuoy(kind, it, ctx, H) {
  await loadFonts();
  const mount = String(it.mount ?? 'rail');
  const water = mount === 'water';
  const lv = ctx.water?.level;
  const it2 = water ? { surface: 'none', backdrop: 'none', light: it.light ?? 'none', ...it, elev: 0 } : { surface: mount === 'rail' ? 'deck' : 'none', ...it };
  const { root, S, env, resolveOn } = H.propBase(kind, it2, ctx, { surface: it2.surface, backdrop: mount === 'wall' ? 'steel' : 'dark', aimY: mount === 'water' ? 0 : 1.0, scale: 1.3, back: mount === 'wall' ? -0.12 : -1.5, bokeh: mount !== 'wall' });
  const Rr = 0.3, tr = 0.075;
  // painted canvas-covered cork: text on the tube's front (uv.y 0.25), the name over the top, the port under it
  const Wc = 4096, Hc = 1024, [c, g] = canvas(Wc, Hc), R0 = makeRng(4);
  g.fillStyle = it.color ?? '#F2F0EA'; g.fillRect(0, 0, Wc, Hc);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${R0() < 0.6 ? '110,95,70' : '255,255,255'},${R0() * 0.06})`; g.fillRect(R0() * Wc, R0() * Hc, 2 + R0() * 8, 1 + R0() * 2); }
  for (let x = 0; x < Wc; x += 16) { g.fillStyle = 'rgba(0,0,0,0.025)'; g.fillRect(x, 0, 2, Hc); }
  if (it.bands) { g.fillStyle = '#C8281E'; for (let k = 0; k < 4; k++) g.fillRect((k * 0.25 + 0.125) * Wc - 150, 0, 300, Hc); }
  const name = String(it.name ?? 'R.M.S. TITANIC').toUpperCase(), port = String(it.port ?? 'LIVERPOOL').toUpperCase();
  const paint = (s, u, flip) => { g.save(); g.translate(u * Wc, 0.75 * Hc); if (flip) g.rotate(Math.PI); g.fillStyle = it.text_color ?? '#141414'; g.textAlign = 'center'; g.textBaseline = 'middle'; let px = 150; g.font = font(700, px, FAM.serif); g.letterSpacing = '14px'; while (g.measureText(s).width > Wc * 0.36 && px > 60) { px -= 6; g.font = font(700, px, FAM.serif); } g.fillText(s, 0, 8); g.restore(); };
  paint(name, 0.25, true); if (port) paint(port, 0.75, false);   // canvas y 0.75 = uv.y 0.25 = the tube's front (flipY)
  for (let i = 0; i < 60; i++) { const x = R0() * Wc, y = R0() * Hc, r = 6 + R0() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(120,95,60,${0.05 + R0() * 0.08})`); gr.addColorStop(1, 'rgba(120,95,60,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  const bm = std({ map: ctex(c), roughness: 0.62, envMap: env, envMapIntensity: 0.35 });
  const buoy = new THREE.Group(); buoy.name = 'lifebuoy'; root.add(buoy);
  const ring = mesh(new THREE.TorusGeometry(Rr, tr, 48, 160), bm, buoy); ring.name = 'buoy';
  // grab line: a rope round the outside, seized at four points, hanging in bights between
  const rm = ropeMat('#CDBB94', env), pts = [];
  for (let k = 0; k <= 160; k++) { const a = k / 160 * TAU, seg = ((a / (TAU / 4)) % 1), sag = Math.sin(seg * Math.PI); const r = Rr + tr * 0.95 + 0.04 * sag; pts.push(new THREE.Vector3(Math.cos(a + Math.PI / 4) * r, Math.sin(a + Math.PI / 4) * r, 0.01 * Math.sin(a * 8))); }
  const line = tube(pts, 0.0075, rm, 320, 8, true); ropeRepeat(line, TAU * (Rr + tr), 0.0075); buoy.add(line);
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * TAU / 4; const s = mesh(new THREE.TorusGeometry(tr + 0.004, 0.009, 10, 32), rm, buoy, Math.cos(a) * Rr, Math.sin(a) * Rr, 0); s.rotation.set(0, 0, a); s.rotateY(Math.PI / 2); s.scale.set(1, 1, 1.6); }
  let update = () => {};
  if (water) {
    buoy.rotation.x = -Math.PI / 2 + 0.08;
    const wtr = ctx.ground && ctx.ground.water && typeof ctx.ground.water.heightAt === 'function' ? ctx.ground.water : null;
    const at = [root.position.x, root.position.z];
    update = (t) => {
      const h = (x, z) => (wtr ? wtr.heightAt(x, z, t) : (lv ?? 0));
      const y0 = h(at[0], at[1]), dx = h(at[0] + 0.4, at[1]) - h(at[0] - 0.4, at[1]), dz = h(at[0], at[1] + 0.4) - h(at[0], at[1] - 0.4);
      root.position.y = y0 - 0.035; buoy.rotation.set(-Math.PI / 2 + Math.atan(dz / 0.8) + 0.03 * Math.sin(t * 0.9), 0.15 * Math.sin(t * 0.13), -Math.atan(dx / 0.8));
    };
  } else if (mount === 'rail') {
    // a ship's rail: teak cap, white stanchions, a steel mid rail; the buoy hangs in two hooks on the outside
    buoy.position.set(0, 1.0, 0.08);
    const white = std({ color: 0xE8E4DA, roughness: 0.5, envMap: env, envMapIntensity: 0.3 }), teak = varnished(woodTex('teak'), env, { clearcoat: 0.4 });
    mesh(new THREE.BoxGeometry(3.2, 0.05, 0.1), teak, root, 0, 1.12, -0.02); mesh(new THREE.CylinderGeometry(0.014, 0.014, 3.2, 16).rotateZ(Math.PI / 2), white, root, 0, 0.62, -0.02);
    for (const x of [-1.5, -0.55, 0.55, 1.5]) mesh(new THREE.CylinderGeometry(0.02, 0.024, 1.1, 16), white, root, x, 0.55, -0.02);
    for (const x of [-0.14, 0.14]) { mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), white, root, x, 1.07, 0.03); mesh(new THREE.BoxGeometry(0.02, 0.02, 0.07), white, root, x, 1.02 + 0.02, 0.06); }
    buoy.position.y = 1.02 - Rr + 0.01 + 0.02; buoy.position.z = 0.07;
  } else {            // on a bulkhead: two hooks
    buoy.position.set(0, 1.25, -0.12 + tr + 0.005);
    const steel = std({ color: 0xD8D2C4, roughness: 0.5 }); for (const x of [-0.12, 0.12]) mesh(new THREE.BoxGeometry(0.02, 0.02, 0.12), steel, root, x, 1.25 + Rr + tr - 0.02, -0.07);
  }
  update(0);
  const nameA = H.anchor(buoy, 'name', 0, Rr, tr), portA = H.anchor(buoy, 'port', 0, -Rr, tr), cA = H.anchor(buoy, 'center', 0, 0, 0);
  return H.finish(root, ctx, { radius: 0.5, height: water ? 0.2 : 1.4, update: (t) => { if (resolveOn) resolveOn(); update(t); }, anchors: { name: nameA, text: nameA, port: portA, center: cA }, snapped: true });
}

// ══ 8. detail.sign — brass nameplate | gilt letters on dark wood | enamel ════════════════════════════════════════════
export async function buildSign(kind, it, ctx, H) {
  await loadFonts();
  const mount = String(it.mount ?? 'wall'), style = String(it.style ?? 'brass');
  const elev = num(it.elev, mount === 'door' ? 1.55 : 1.6);
  const { root, S, env, resolveOn } = H.propBase(kind, { surface: 'none', ...it, elev }, ctx, { surface: 'none', backdrop: 'dark', back: mount === 'door' ? -0.06 : -0.02, aimY: 0, scale: 1.1, bokeh: false });
  const text = String(it.text ?? 'MARCONI ROOM').toUpperCase(), sub = it.sub ? String(it.sub) : '';
  const lines = text.split(/\n|\|/);
  const chars = Math.max(...lines.map((s) => s.length));
  const pw = clamp(num(it.width, (style === 'gilt' ? 0.04 : 0.024) * chars + 0.07), 0.16, 1.2), ph = num(it.height, (style === 'gilt' ? 0.12 : 0.07) + (lines.length - 1) * 0.04 + (sub ? 0.025 : 0));
  const zBack = mount === 'door' ? -0.02 : -0.02;
  if (mount === 'door') {               // a panelled mahogany door with a frame and a brass knob; the sign on its upper panel
    const dm = varnished(woodTex('mahogany'), env, { clearcoat: 0.7 });
    const door = new THREE.Group(); door.position.set(0, -elev, zBack - 0.045); root.add(door);
    mesh(new THREE.BoxGeometry(0.92, 2.05, 0.045), dm, door, 0, 1.025, 0);
    for (const [y, h] of [[1.45, 0.75], [0.5, 0.75]]) { mesh(new THREE.BoxGeometry(0.62, h, 0.012), dm, door, 0, y, 0.028); for (const [w, hh, x, yy] of [[0.66, 0.025, 0, y + h / 2 + 0.012], [0.66, 0.025, 0, y - h / 2 - 0.012], [0.025, h + 0.05, 0.33, y], [0.025, h + 0.05, -0.33, y]]) mesh(new THREE.BoxGeometry(w, hh, 0.02), dm, door, x, yy, 0.032); }
    for (const [w, h, x, y] of [[0.08, 2.15, 0.5, 1.075], [0.08, 2.15, -0.5, 1.075], [1.08, 0.08, 0, 2.11]]) mesh(new THREE.BoxGeometry(w, h, 0.07), dm, door, x, y, 0.01);
    const br = metal('brass', env); mesh(new THREE.SphereGeometry(0.03, 24, 16), br, door, 0.36, 1.0, 0.07); mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 24).rotateX(Math.PI / 2), br, door, 0.36, 1.0, 0.03);
  } else if (S.backdrop === 'none') mesh(new THREE.PlaneGeometry(1.4, 0.9), std({ color: 0x3A2618, roughness: 0.6 }), root, 0, 0, zBack - 0.001);
  const plate = new THREE.Group(); plate.name = 'sign'; plate.position.z = zBack; root.add(plate);
  if (style === 'gilt') {                 // raised gold-leaf letters on a black-painted board with a gilt fillet
    const board = phys({ color: 0x0E0F0C, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1, envMap: env, envMapIntensity: 0.6 });
    const bg = new THREE.ExtrudeGeometry(roundRect(pw, ph, 0.01), { depth: 0.018, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3 }); mesh(bg, board, plate);
    const goldM = metal('gold', env, { roughness: 0.22, env: 1.4 });
    const frame = new THREE.Shape(); const o = roundRect(pw - 0.02, ph - 0.02, 0.006); frame.curves = o.curves; frame.currentPoint = o.currentPoint; const hole = roundRect(pw - 0.03, ph - 0.03, 0.004); frame.holes.push(new THREE.Path(hole.getPoints(40).reverse()));
    mesh(new THREE.ExtrudeGeometry(frame, { depth: 0.002, bevelEnabled: false }), goldM, plate, 0, 0, 0.024);
    const cap = Math.min(ph * (lines.length > 1 ? 0.32 : 0.46), (pw * 0.86) / (chars * 0.72));
    lines.forEach((s, i) => { const tg = text3dGeometry(s, { font: `700 256px "E3 Cinzel"`, height: cap, depth: cap * 0.12, bevel: 0.05, letterSpacing: 18 }); const sc = Math.min(1, (pw * 0.86) / (tg.userData.width || 1)); const m = mesh(tg, goldM, plate, 0, (lines.length - 1) / 2 * cap * 1.45 - i * cap * 1.45 - cap / 2 + (sub ? cap * 0.2 : 0), 0.024 + cap * 0.12 + cap * 0.05); m.scale.set(sc, sc, 1); });
    if (sub) { const tg = text3dGeometry(sub, { font: `500 256px "E3 Garamond"`, height: cap * 0.34, depth: cap * 0.05, bevel: 0.04 }); const m = mesh(tg, goldM, plate, 0, -ph / 2 + cap * 0.3, 0.024 + cap * 0.05); const sc = Math.min(1, (pw * 0.8) / (tg.userData.width || 1)); m.scale.set(sc, sc, 1); }
  } else {
    // brass (engraved, black-filled) or enamel (vitreous white with a blue border, blue letters): one canvas, relief
    const N = 2048, Hn = Math.round(N * ph / pw), [c, g] = canvas(N, Hn), [hc, hg] = canvas(1024, Math.round(1024 * ph / pw));
    const enamel = style === 'enamel';
    g.fillStyle = enamel ? '#F4F2EC' : '#C9A452'; g.fillRect(0, 0, N, Hn); hg.fillStyle = '#FFFFFF'; hg.fillRect(0, 0, hc.width, hc.height);
    if (!enamel) { const R = makeRng(6); for (let i = 0; i < 1400; i++) { g.strokeStyle = `rgba(${R() < 0.5 ? '255,236,180' : '120,86,30'},${0.05 + R() * 0.06})`; g.lineWidth = 1; g.beginPath(); const y = R() * Hn; g.moveTo(0, y); g.lineTo(N, y + (R() - 0.5) * 6); g.stroke(); } }
    const ink = enamel ? (it.text_color ?? '#1B2F6A') : '#15120C';
    const bw = Hn * 0.05; g.strokeStyle = ink; g.lineWidth = enamel ? bw : bw * 0.45; const rr = (gg, x, y, w, h, r) => { gg.beginPath(); gg.moveTo(x + r, y); gg.arcTo(x + w, y, x + w, y + h, r); gg.arcTo(x + w, y + h, x, y + h, r); gg.arcTo(x, y + h, x, y, r); gg.arcTo(x, y, x + w, y, r); gg.closePath(); };
    rr(g, bw * 1.3, bw * 1.3, N - bw * 2.6, Hn - bw * 2.6, bw * 1.5); g.stroke(); hg.strokeStyle = '#000'; hg.lineWidth = enamel ? 2 : bw * 0.45 * 0.5; rr(hg, bw * 0.65, bw * 0.65, hc.width - bw * 1.3, hc.height - bw * 1.3, bw * 0.75); hg.stroke();
    const capPx = Math.min(Hn * (lines.length > 1 ? 0.3 : 0.44) * (sub ? 0.85 : 1), (N * 0.84) / (chars * 0.78));
    for (const [gg, sc2, col] of [[g, 1, ink], [hg, 0.5, '#000']]) {
      gg.fillStyle = col; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.font = font(enamel ? 700 : 700, capPx * 1.25 * sc2, enamel ? FAM.sans : FAM.caps); gg.letterSpacing = `${capPx * 0.12 * sc2}px`;
      lines.forEach((s, i) => { const tw = gg.measureText(s).width, k = Math.min(1, N * 0.84 * sc2 / Math.max(1, tw)); gg.save(); gg.translate(N / 2 * sc2, (Hn / 2 + (i - (lines.length - 1) / 2) * capPx * 1.45 - (sub ? capPx * 0.3 : 0)) * sc2); gg.scale(k, k); gg.fillText(s, 0, 0); gg.restore(); });
      if (sub) { gg.font = font(500, capPx * 0.5 * sc2, FAM.serif, true); gg.letterSpacing = '0px'; gg.fillText(sub, N / 2 * sc2, (Hn - bw * 3.2 - capPx * 0.2) * sc2); }
    }
    if (enamel) { const R = makeRng(8); for (let i = 0; i < 8; i++) { const x = R() < 0.5 ? R() * N : (R() < 0.5 ? 0 : N), y = R() < 0.5 ? (R() < 0.5 ? 0 : Hn) : R() * Hn, r = 8 + R() * 26; g.fillStyle = '#20201E'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); } }
    const mat = enamel ? phys({ map: ctex(c), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03, normalMap: normalFrom(hc, 1.5), envMap: env, envMapIntensity: 0.9 })
      : phys({ map: ctex(c), metalness: 1, roughness: 0.3, normalMap: normalFrom(hc, 4), color: 0xFFE8B0, envMap: env, envMapIntensity: 1.3 });
    const g3 = new THREE.ExtrudeGeometry(roundRect(pw, ph, Math.min(pw, ph) * 0.08), { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 3 });
    { const uv = g3.attributes.uv, p = g3.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / pw + 0.5, p.getY(i) / ph + 0.5); }
    mesh(g3, mat, plate);
    const screw = metal(enamel ? 'nickel' : 'brass', env);
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) { const s = mesh(new THREE.SphereGeometry(0.0055, 16, 8, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.35), screw, plate, sx * (pw / 2 - 0.018), sy * (ph / 2 - 0.018), 0.0045); const slot = mesh(new THREE.BoxGeometry(0.0085, 0.0011, 0.002), std({ color: 0x2A2010 }), s, 0, 0, 0.0018); slot.rotation.z = (sx * sy) * 0.6; }
  }
  const faceA = H.anchor(plate, 'text', 0, 0, 0.02);
  const update = () => { if (resolveOn) resolveOn(); };
  return H.finish(root, ctx, { radius: Math.max(pw, 0.5), height: ph, update, anchors: { text: faceA, face: faceA, sign: faceA } });
}

// ══ 9. detail.lantern — hurricane lantern | ship's brass lantern | candle, a flickering practical ═══════════════════
function flameTex() {
  const [c, g] = canvas(128, 256); const gr = g.createLinearGradient(0, 256, 0, 0);
  gr.addColorStop(0, 'rgba(60,90,255,0.9)'); gr.addColorStop(0.12, 'rgba(255,150,40,1)'); gr.addColorStop(0.35, 'rgba(255,215,120,1)'); gr.addColorStop(0.7, 'rgba(255,240,200,1)'); gr.addColorStop(1, 'rgba(255,170,60,0.6)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 256); const t = ctex(c); return t;
}
export async function buildLantern(kind, it, ctx, H) {
  const variant = String(it.variant ?? 'hurricane');
  const { root, S, env, resolveOn } = H.propBase(kind, { light: 'none', ...it }, ctx, { surface: 'wood', backdrop: 'dark', aimY: 0.12, scale: 1 });
  const L = new THREE.Group(); L.name = 'lantern'; root.add(L);
  const flameM = new THREE.MeshBasicMaterial({ map: flameTex(), color: new THREE.Color(1, 1, 1).multiplyScalar(num(it.flame, 1.25)), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameG = lathe([[0, 0], [0.004, 0.003], [0.0065, 0.01], [0.006, 0.02], [0.0035, 0.03], [0, 0.04]], 24);
  let flameY = 0, lightY = 0;
  if (variant === 'candle') {
    const br = metal('brass', env);
    mesh(lathe([[0, 0], [0.075, 0], [0.078, 0.004], [0.072, 0.012], [0.03, 0.014], [0.018, 0.02], [0.02, 0.035], [0.017, 0.042], [0, 0.042]], 64), br, L);
    const ring = mesh(new THREE.TorusGeometry(0.018, 0.004, 10, 24), br, L, 0.085, 0.01, 0); ring.rotation.x = Math.PI / 2;
    const wax = phys({ color: 0xF2EAD6, roughness: 0.55, transmission: 0.25, thickness: 0.02, sheen: 0.3, envMap: env, envMapIntensity: 0.4 });
    const ch = num(it.candle_h, 0.14);
    mesh(lathe([[0, 0.042], [0.0115, 0.042], [0.0115, 0.042 + ch - 0.006], [0.0105, 0.042 + ch - 0.001], [0.007, 0.042 + ch - 0.004], [0, 0.042 + ch - 0.006]], 48), wax, L);
    for (let k = 0; k < 3; k++) { const a = k * 2.1; mesh(new THREE.SphereGeometry(0.0035, 10, 8).scale(1, 3 + k, 1), wax, L, Math.cos(a) * 0.0115, 0.042 + ch - 0.02 - k * 0.012, Math.sin(a) * 0.0115); }
    mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.012, 6), std({ color: 0x111111 }), L, 0, 0.042 + ch + 0.001, 0).rotation.z = 0.15;
    flameY = 0.042 + ch + 0.002; lightY = flameY + 0.02;
  } else {
    const ship = variant === 'ship';
    const body = ship ? metal('brass', env, { roughness: 0.32 }) : std({ color: it.color ?? 0x8A1A14, roughness: 0.42, metalness: 0.5, envMap: env, envMapIntensity: 0.6 });
    const tin = ship ? body : metal('tin', env, { roughness: 0.55, env: 0.6 });
    mesh(lathe([[0, 0], [0.075, 0], [0.078, 0.006], [0.08, 0.04], [0.074, 0.058], [0.05, 0.068], [0.03, 0.072], [0, 0.072]], 64), body, L);
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), tin, L, 0.05, 0.068, 0);
    mesh(lathe([[0, 0.072], [0.045, 0.072], [0.045, 0.082], [0.038, 0.086], [0, 0.086]], 48), tin, L);
    const gl = glass(env, { thickness: 0.003, tint: 0xFFF6E8, att: 0.3 }); gl.roughness = 0.04;
    const globe = mesh(lathe([[0.034, 0.086], [0.05, 0.11], [0.058, 0.15], [0.052, 0.19], [0.036, 0.215], [0.032, 0.22], [0.03, 0.218], [0.034, 0.212], [0.05, 0.19], [0.056, 0.15], [0.048, 0.11], [0.032, 0.087]], 64), gl, L, 0, 0, 0, false); globe.name = 'globe';
    const soot = mesh(lathe([[0.036, 0.2], [0.05, 0.19], [0.036, 0.214]], 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }), L, 0, 0, 0, false); soot.name = 'soot';
    const guardM = ship ? body : std({ color: it.color ?? 0x5A120E, roughness: 0.7, metalness: 0.2 });
    for (let k = 0; k < (ship ? 4 : 6); k++) { const a = k * TAU / (ship ? 4 : 6); const pts = [[Math.cos(a) * 0.05, 0.09, Math.sin(a) * 0.05], [Math.cos(a) * 0.066, 0.15, Math.sin(a) * 0.066], [Math.cos(a) * 0.05, 0.215, Math.sin(a) * 0.05]]; L.add(tube(pts, ship ? 0.0045 : 0.0018, guardM, 24, 6)); }
    mesh(lathe([[0, 0.23], [0.058, 0.228], [0.06, 0.236], [0.04, 0.25], [0.02, 0.27], [0.024, 0.28], [0, 0.285]], 48), body, L);
    if (!ship) for (const s of [1, -1]) L.add(tube([[s * 0.07, 0.03, 0], [s * 0.085, 0.13, 0], [s * 0.06, 0.232, 0]], 0.006, body, 32, 8));
    const bail = []; for (let k = 0; k <= 24; k++) { const a = Math.PI * k / 24; bail.push([Math.cos(a) * 0.07, 0.26 + Math.sin(a) * 0.07, 0]); } L.add(tube(bail, 0.002, tin, 48, 6));
    mesh(new THREE.BoxGeometry(0.014, 0.012, 0.004), metal('brass', env), L, 0, 0.092, 0);
    flameY = 0.098; lightY = 0.125;
  }
  const flame = mesh(flameG, flameM, L, 0, flameY, 0, false); flame.name = 'glow_flame'; flame.renderOrder = 5;
  const glowT = (() => { const [c, g] = canvas(128, 128); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,190,110,1)'); gr.addColorStop(0.3, 'rgba(255,150,60,0.45)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return ctex(c); })();
  const glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: new THREE.Color(1, 1, 1).multiplyScalar(num(it.glow, 0.55)), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); glowS.name = 'glow_globe'; glowS.scale.setScalar(variant === 'candle' ? 0.09 : 0.15); glowS.position.set(0, flameY + 0.022, 0); glowS.renderOrder = 6; L.add(glowS);
  const halo = mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.6, 0.25).multiplyScalar(0.05), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), L, 0, flameY + 0.018, 0, false); halo.name = 'glow_halo';
  const pl = new THREE.PointLight(0xFF9E4A, num(it.intensity, 0.14) * num(it.light_level, 1), 6, 2); pl.position.set(0, lightY, 0); pl.castShadow = true; pl.shadow.mapSize.set(512, 512); pl.shadow.camera.near = 0.03; pl.shadow.bias = -0.001; L.add(pl);
  blob(root, 0.2, 0.2, 0.55);
  const base = pl.intensity, seed = num(it.seed, 2), lit = it.lit;
  const update = (t) => {
    if (resolveOn) resolveOn();
    const on = Array.isArray(lit) ? (t >= +lit[0] && (lit[1] == null || t < +lit[1]) ? 1 : 0) : (lit === false ? 0 : 1);
    const f = 1 + 0.07 * vnoise(t * 7, seed) + 0.05 * vnoise(t * 17, seed + 3) + 0.03 * Math.sin(t * 43);
    flame.visible = halo.visible = glowS.visible = on > 0; glowS.material.opacity = 0.85 + 0.15 * f; flame.scale.set(1 + 0.05 * vnoise(t * 9, seed + 5), f * (1 + 0.06 * vnoise(t * 5, seed + 9)), 1); flame.rotation.z = 0.05 * vnoise(t * 3, seed + 7);
    pl.intensity = base * f * on;
  };
  update(0);
  const fA = H.anchor(L, 'flame', 0, flameY + 0.015, 0);
  return H.finish(root, ctx, { radius: 0.2, height: 0.3, update, anchors: { flame: fA, light: fA, center: fA } });
}

const P_SET = { surface: 'desk | table | wood | deck | none', backdrop: 'dark | steel | none', light: 'warm | cool | top | none', light_level: 'x (1)', elev: 'm', place_on: "'structures:N.desk'", offset: '[dx, dz]', heading: 'deg: the viewer side' };
export const MORE_CATALOG = {
  'detail.tableware': { section: 'objects', desc: 'INSERT: a first-class table laid on white linen (cobalt-and-gilt china plate, cup of tea on a saucer with a spoon, red wine in a glass, a water tumbler, silver fork / knife / spoon, a rose in a bud vase) under a brass chandelier with crystal drops. tilt deg + t: THE SHIP LISTS — the camera stays with the ship: things creep first, then the silver slips, then the china; tall glasses topple past their tipping angle (a lurch topples them earlier), wine spills on the cloth, the chandelier swings out to the new vertical and hangs there. Positive tilt = downhill to the viewer’s right. A fiddle rail stops the slide at the edge', params: { tilt: 'deg (0 = calm; from ~6 things creep, 11 the silver slips, 12-14 the china, 15 the glasses; 21+ topples the vase, 24+ the wine glass; lurch topples earlier)', t: 's: the list starts', ramp: 's (2.2)', lurch: 'true | 0.35: a sudden lurch with an overshoot', chandelier: 'true | false', chandelier_h: 'm over the table (1.45)', fiddle: 'rail round the edge (default when tilted)', pattern: 'cobalt | green', ...P_SET }, actions: ['tilt'], anchors: ['cup', 'glass', 'plate', 'chandelier'], footprint: [1.3, 0.85], height: 2.2, tags: ['detail', 'insert', 'table', 'dinner', 'china', 'glass', 'chandelier', 'listing', 'tilt', 'titanic', 'first class'] },
  'detail.lifebuoy': { section: 'objects', desc: 'INSERT: a white cork lifebuoy with a painted `name` over the top and the `port` under it, a grab line seized at four points; mount rail (hung on a ship’s rail with a teak cap, on a teak deck), wall (on a riveted white bulkhead) or water (floating flat on the real swell: needs a sea world)', params: { name: "'R.M.S. TITANIC' | 'CARPATHIA'", port: "'LIVERPOOL' ('' = none)", mount: 'rail | wall | water', bands: 'true = four red bands', color: 'css (white)', text_color: 'css', ...P_SET }, actions: [], anchors: ['name', 'port', 'center'], footprint: [0.8, 0.3], height: 1.4, tags: ['detail', 'insert', 'lifebuoy', 'life ring', 'ship', 'rail', 'titanic', 'carpathia'] },
  'detail.sign': { section: 'objects', desc: 'INSERT: a sign with `text`: style brass = an engraved, black-filled brass nameplate with four screws; gilt = raised gold-leaf Roman letters on a black board with a gilt fillet; enamel = white vitreous enamel with a blue border and blue letters (chipped edges). mount wall (a panelled wall) or door (on the upper panel of a mahogany door with a brass knob)', params: { text: "'MARCONI ROOM' | 'FIRST CLASS' (| = new line)", sub: 'small second line', style: 'brass | gilt | enamel', mount: 'wall | door', width: 'm (from the text)', height: 'm', elev: 'm (1.6)', text_color: 'enamel letters', backdrop: 'dark | steel | none', light: 'warm | cool | top | none' }, actions: [], anchors: ['text'], footprint: [0.6, 0.05], height: 0.2, tags: ['detail', 'insert', 'sign', 'nameplate', 'plaque', 'door', 'brass', 'first class', 'marconi'] },
  'detail.lantern': { section: 'objects', desc: 'INSERT / PRACTICAL: a lit oil lantern (hurricane = red tin with a glass globe, wire guards, air tubes and a bail; ship = brass) or a candle in a brass chamberstick; the flame flickers (deterministic), its warm light moves on the scene and casts soft shadows (under E1’s head-irradiance cap)', params: { variant: 'hurricane | ship | candle', lit: 'true | false | [t_on, t_off]', intensity: 'cd (0.14)', flame: 'flame brightness (1.25)', color: 'hurricane tin colour', candle_h: 'm', ...P_SET }, actions: ['lit'], anchors: ['flame'], footprint: [0.2, 0.2], height: 0.3, tags: ['detail', 'insert', 'lantern', 'lamp', 'candle', 'flame', 'light', 'practical', 'oil'] },
};
