// figures.js — sculpture and people, built from lathes, tubes and capsules.
//   robed statue (the god on the lantern), tritons blowing conches (corners of the first tier),
//   sailors (posable groups: a lookout pointing, a helmsman), a traveller in a cloak.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function lathe(points, seg = 20) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}
function capsule(r, len, x0, y0, z0, x1, y1, z1) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q); g.translate(mid.x, mid.y, mid.z);
  return g;
}
function limb(r0, r1, a, b, seg = 10) {        // tapered limb between two points
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5); g.translate(m.x, m.y, m.z);
  return g;
}
function sphere(r, x, y, z, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 16, 12); g.scale(sx, sy, sz); g.translate(x, y, z); return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// standing god (Poseidon / Zeus Soter): bare chest, himation from the waist with folds and a drape over the left
// shoulder, bearded head with a wreath, right arm raised with a trident; height h, facing +Z
export function robedStatue(h = 7) {
  const s = h / 2.0;
  const P = [];
  // skirt of the himation: lathe with vertical folds, the left knee pushing forward (contrapposto)
  const skirt = lathe([[0.001, 0], [0.33, 0.0], [0.34, 0.08], [0.31, 0.4], [0.27, 0.7], [0.24, 0.95], [0.22, 1.02], [0.001, 1.03]].map(([r, y]) => [r * s, y * s]), 48);
  const sp = skirt.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const fold = 1 + 0.06 * Math.sin(a * 11 + y * 1.5) * (1 - y / (1.03 * s));
    const knee = 1 + 0.12 * Math.exp(-((a - 1.25) ** 2) / 0.12) * Math.exp(-(((y / s) - 0.5) ** 2) / 0.05);
    sp.setXYZ(i, Math.cos(a) * r * fold * knee, y, Math.sin(a) * r * fold * knee * 0.8);
  }
  skirt.computeVertexNormals(); P.push(skirt);
  // bare torso
  const torso = lathe([[0.2, 0.98], [0.21, 1.1], [0.23, 1.25], [0.26, 1.38], [0.27, 1.47], [0.22, 1.53], [0.08, 1.57], [0.001, 1.58]].map(([r, y]) => [r * s, y * s]), 32);
  torso.scale(1, 1, 0.7); P.push(torso);
  P.push(sphere(0.085 * s, -0.25 * s, 1.47 * s, 0, 1.2, 0.9, 1.0), sphere(0.085 * s, 0.25 * s, 1.47 * s, 0, 1.2, 0.9, 1.0));   // shoulders
  P.push(sphere(0.1 * s, -0.09 * s, 1.36 * s, 0.1 * s, 1, 0.8, 0.5), sphere(0.1 * s, 0.09 * s, 1.36 * s, 0.1 * s, 1, 0.8, 0.5)); // chest
  // drape over the left shoulder, down the back and round the hip
  const drape = new THREE.CatmullRomCurve3([V(-0.26, 1.5, 0.02), V(-0.15, 1.3, 0.16), V(0.05, 1.08, 0.18), V(0.24, 0.98, 0.08), V(0.26, 0.95, -0.12), V(-0.05, 1.0, -0.2), V(-0.26, 1.2, -0.12), V(-0.3, 1.46, -0.04)].map((v) => v.multiplyScalar(s)));
  P.push(new THREE.TubeGeometry(drape, 48, 0.07 * s, 10, false));
  P.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.3, 1.46, -0.04), V(-0.34, 1.2, 0.0), V(-0.33, 0.9, 0.06), V(-0.3, 0.6, 0.08)].map((v) => v.multiplyScalar(s))), 24, 0.06 * s, 8, false));
  // neck, head, beard, hair, wreath
  P.push(capsule(0.055 * s, 0.06 * s, 0, 1.56 * s, 0, 0, 1.64 * s, 0.01 * s));
  P.push(sphere(0.1 * s, 0, 1.74 * s, 0.01 * s, 0.95, 1.12, 1.0));
  P.push(sphere(0.085 * s, 0, 1.64 * s, 0.07 * s, 1.0, 1.1, 0.75));                 // beard
  P.push(sphere(0.108 * s, 0, 1.78 * s, -0.015 * s, 1.0, 0.85, 1.02));              // hair
  { const w = new THREE.TorusGeometry(0.1 * s, 0.018 * s, 6, 24); w.rotateX(Math.PI / 2); w.translate(0, 1.79 * s, 0); P.push(w); }
  // left arm bent, hand on the hip holding the cloth
  P.push(limb(0.065 * s, 0.055 * s, V(-0.3 * s, 1.45 * s, 0), V(-0.36 * s, 1.18 * s, 0.02 * s)));
  P.push(limb(0.055 * s, 0.045 * s, V(-0.36 * s, 1.18 * s, 0.02 * s), V(-0.24 * s, 1.0 * s, 0.1 * s)));
  P.push(sphere(0.05 * s, -0.22 * s, 0.98 * s, 0.11 * s));
  // right arm raised with the trident
  P.push(limb(0.066 * s, 0.056 * s, V(0.3 * s, 1.46 * s, 0), V(0.46 * s, 1.72 * s, 0.03 * s)));
  P.push(limb(0.056 * s, 0.046 * s, V(0.46 * s, 1.72 * s, 0.03 * s), V(0.5 * s, 1.98 * s, 0.06 * s)));
  P.push(sphere(0.052 * s, 0.5 * s, 2.01 * s, 0.06 * s));
  P.push(limb(0.02 * s, 0.02 * s, V(0.5 * s, 1.1 * s, 0.065 * s), V(0.51 * s, 2.46 * s, 0.06 * s), 8));
  P.push(limb(0.018 * s, 0.018 * s, V(0.4 * s, 2.44 * s, 0.06 * s), V(0.62 * s, 2.44 * s, 0.06 * s), 6));
  for (const dx of [-0.11, 0, 0.11]) {
    const tip = new THREE.ConeGeometry(0.022 * s, 0.2 * s, 8); tip.translate((0.51 + dx) * s, 2.56 * s, 0.06 * s); P.push(tip);
    if (dx !== 0) P.push(limb(0.016 * s, 0.016 * s, V((0.51 + dx) * s, 2.44 * s, 0.06 * s), V((0.51 + dx) * s, 2.5 * s, 0.06 * s), 6));
  }
  const g = mergeGeometries(P.map((p) => (p.index ? p.toNonIndexed() : p)));
  g.computeVertexNormals();
  return g;
}

// a triton: a muscular man's torso rising out of a coiled fish tail, conch raised to the mouth; faces +Z
export function triton(h = 4.5) {
  const s = h / 1.7;
  const P = [];
  // the tail: thick at the hips, coiling back and round under the torso, a forked fin at the end
  const pts = [V(0, 0.82, 0.02), V(0, 0.52, 0.06), V(0.04, 0.26, -0.08), V(0.02, 0.14, -0.42), V(-0.04, 0.24, -0.72), V(-0.02, 0.5, -0.8), V(0.02, 0.66, -0.62)].map((v) => v.multiplyScalar(s));
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, 60, 0.21 * s, 14, false);
  const tp = tube.attributes.position; const tmp = new THREE.Vector3();
  for (let i = 0; i < tp.count; i++) {
    const seg = Math.floor(i / 15) / 60;
    const c = curve.getPointAt(Math.min(seg, 1));
    tmp.set(tp.getX(i), tp.getY(i), tp.getZ(i)).sub(c).multiplyScalar(1 - seg * 0.78).add(c);
    tp.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  tube.computeVertexNormals(); P.push(tube);
  for (const sx of [-1, 1]) { const fin = new THREE.ConeGeometry(0.16 * s, 0.34 * s, 4); fin.scale(1, 1, 0.22); fin.rotateZ(sx * 0.7); fin.translate(sx * 0.1 * s, 0.76 * s, -0.6 * s); P.push(fin); }
  // torso, chest, shoulders
  const torso = lathe([[0.2, 0.78], [0.22, 0.9], [0.25, 1.05], [0.3, 1.2], [0.31, 1.3], [0.25, 1.38], [0.1, 1.42], [0.001, 1.43]].map(([r, y]) => [r * s, y * s]), 24);
  torso.scale(1, 1, 0.72); P.push(torso);
  P.push(sphere(0.11 * s, -0.25 * s, 1.31 * s, 0, 1.1, 0.9, 1), sphere(0.11 * s, 0.25 * s, 1.31 * s, 0, 1.1, 0.9, 1));
  P.push(sphere(0.12 * s, -0.1 * s, 1.2 * s, 0.13 * s, 1, 0.8, 0.5), sphere(0.12 * s, 0.1 * s, 1.2 * s, 0.13 * s, 1, 0.8, 0.5));
  // head, beard, wild hair
  P.push(capsule(0.065 * s, 0.05 * s, 0, 1.42 * s, 0, 0, 1.5 * s, 0.02 * s));
  P.push(sphere(0.12 * s, 0, 1.6 * s, 0.03 * s, 0.95, 1.1, 1));
  P.push(sphere(0.1 * s, 0, 1.5 * s, 0.1 * s, 1.05, 1.2, 0.8));
  P.push(sphere(0.14 * s, 0, 1.66 * s, -0.03 * s, 1.1, 0.8, 1.05));
  // both arms raise the conch to the lips
  P.push(limb(0.085 * s, 0.07 * s, V(0.28 * s, 1.3 * s, 0), V(0.36 * s, 1.44 * s, 0.24 * s)));
  P.push(limb(0.07 * s, 0.055 * s, V(0.36 * s, 1.44 * s, 0.24 * s), V(0.2 * s, 1.58 * s, 0.3 * s)));
  P.push(limb(0.085 * s, 0.07 * s, V(-0.28 * s, 1.3 * s, 0), V(-0.22 * s, 1.36 * s, 0.3 * s)));
  P.push(limb(0.07 * s, 0.055 * s, V(-0.22 * s, 1.36 * s, 0.3 * s), V(0.02 * s, 1.52 * s, 0.34 * s)));
  // the conch: a twisted horn flaring away from the mouth
  const conchCurve = new THREE.CatmullRomCurve3([V(0.02, 1.54, 0.2), V(0.12, 1.6, 0.34), V(0.3, 1.66, 0.42), V(0.5, 1.72, 0.44)].map((v) => v.multiplyScalar(s)));
  const conch = new THREE.TubeGeometry(conchCurve, 20, 0.05 * s, 10, false);
  const cp = conch.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const seg = Math.floor(i / 11) / 20, c = conchCurve.getPointAt(Math.min(seg, 1));
    tmp.set(cp.getX(i), cp.getY(i), cp.getZ(i)).sub(c).multiplyScalar(0.6 + seg * seg * 2.4).add(c); cp.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  conch.computeVertexNormals(); P.push(conch);
  const g = mergeGeometries(P.map((q) => (q.index ? q.toNonIndexed() : q)));
  g.computeVertexNormals();
  return g;
}

// a posable person — the "mannequin" look: smooth faceless head and hands, real clothes.
// o: {h, skin, cloth, cloth2, robe, cloak, turban: 'wrap'|'big'|'cap'|null, staff, bag, tunic, pose}
// returns {group, pose(p), walk(phase, amount)}
export function person(o = {}) {
  const h = o.h ?? 1.75, s = h / 1.75;
  const skin = o.skin, cloth = o.cloth ?? o.skin, cloth2 = o.cloth2 ?? cloth, trim = o.trim ?? cloth2;
  const G = new THREE.Group();
  const mk = (geo, m) => { const x = new THREE.Mesh(geo, m); x.castShadow = true; x.receiveShadow = true; return x; };
  const L = (pts, seg = 22) => lathe(pts.map(([r, y]) => [r * s, y * s]), seg);
  const hips = new THREE.Group(); hips.position.y = 0.95 * s; G.add(hips);
  const chest = new THREE.Group(); hips.add(chest);
  // torso (under clothes it is the tunic)
  const torso = mk(L([[0.001, -0.05], [0.16, -0.05], [0.17, 0.08], [0.15, 0.22], [0.18, 0.38], [0.2, 0.5], [0.12, 0.58], [0.05, 0.6], [0.001, 0.6]]), o.tunic ? cloth : cloth2);
  torso.scale.z = 0.72; chest.add(torso);
  const neck = new THREE.Group(); neck.position.y = 0.6 * s; chest.add(neck);
  { const nk = mk(new THREE.CylinderGeometry(0.045 * s, 0.05 * s, 0.1 * s, 10), skin); nk.position.y = 0.03 * s; neck.add(nk); }
  const head = mk(new THREE.SphereGeometry(0.105 * s, 20, 16), skin); head.scale.set(0.92, 1.17, 1.02); head.position.set(0, 0.17 * s, 0.01 * s);
  neck.add(head);
  if (o.turban) {
    const tb = new THREE.Group(); tb.position.set(0, 0.235 * s, 0.0); neck.add(tb);
    const big = o.turban === 'big';
    const rr = big ? 0.155 : 0.12;
    for (let k = 0; k < (big ? 4 : 3); k++) {
      const tor = mk(new THREE.TorusGeometry(rr * s * (1 - k * 0.1), (big ? 0.05 : 0.038) * s, 10, 28), o.turbanMat ?? cloth2);
      tor.rotation.x = Math.PI / 2 + (k % 2 ? 0.12 : -0.1); tor.rotation.z = k * 0.4; tor.position.y = k * 0.045 * s; tb.add(tor);
    }
    const capm = mk(new THREE.SphereGeometry(rr * s * 0.92, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), big ? trim : (o.turbanMat ?? cloth2));
    capm.position.y = (big ? 0.13 : 0.07) * s; capm.scale.y = big ? 1.1 : 0.9; tb.add(capm);
    if (o.turban === 'wrap') { const tail = mk(new THREE.BoxGeometry(0.1 * s, 0.34 * s, 0.02 * s), o.turbanMat ?? cloth2); tail.position.set(0.05 * s, -0.15 * s, -0.12 * s); tail.rotation.x = 0.2; tb.add(tail); }
  }
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.2 * s, 0.5 * s, 0); chest.add(sh);
    const up = mk(new THREE.CapsuleGeometry(0.047 * s, 0.22 * s, 4, 10), o.tunic ? skin : cloth2); up.position.y = -0.14 * s; sh.add(up);
    const el = new THREE.Group(); el.position.y = -0.29 * s; sh.add(el);
    const lo = mk(new THREE.CapsuleGeometry(0.04 * s, 0.2 * s, 4, 10), skin); lo.position.y = -0.12 * s; el.add(lo);
    if (!o.tunic) { const slv = mk(new THREE.CylinderGeometry(0.06 * s, 0.095 * s, 0.24 * s, 12, 1, true), cloth2); slv.material = cloth2; slv.position.y = -0.1 * s; el.add(slv); }
    const hand = mk(new THREE.SphereGeometry(0.045 * s, 12, 10), skin); hand.scale.set(0.8, 1.25, 0.55); hand.position.y = -0.27 * s; el.add(hand);
    return { sh, el, hand };
  };
  const leg = (side) => {
    const hp = new THREE.Group(); hp.position.set(side * 0.09 * s, -0.02 * s, 0); hips.add(hp);
    const th = mk(new THREE.CapsuleGeometry(0.07 * s, 0.32 * s, 4, 10), o.tunic ? skin : cloth2); th.position.y = -0.22 * s; hp.add(th);
    const kn = new THREE.Group(); kn.position.y = -0.45 * s; hp.add(kn);
    const sn = mk(new THREE.CapsuleGeometry(0.052 * s, 0.33 * s, 4, 10), skin); sn.position.y = -0.21 * s; kn.add(sn);
    const ft = mk(new THREE.BoxGeometry(0.09 * s, 0.06 * s, 0.24 * s), o.shoes ?? cloth2); ft.position.set(0, -0.45 * s, 0.05 * s); kn.add(ft);
    return { hp, kn };
  };
  const A = arm(1), B = arm(-1), LL = leg(1), RL = leg(-1);
  if (o.scarf) {
    // the Witness's mustard scarf: a soft wrap round the neck and two tails, one over the chest, one down the back
    const wrap = mk(new THREE.TorusGeometry(0.078 * s, 0.034 * s, 10, 24), o.scarf); wrap.rotation.x = Math.PI / 2 + 0.12; wrap.position.set(0, 0.585 * s, 0.0); wrap.scale.set(1.05, 1.1, 0.85); chest.add(wrap);
    const knot = mk(new THREE.SphereGeometry(0.04 * s, 10, 8), o.scarf); knot.position.set(0.035 * s, 0.56 * s, 0.075 * s); chest.add(knot);
    const t1 = mk(new THREE.BoxGeometry(0.075 * s, 0.26 * s, 0.022 * s), o.scarf); t1.position.set(0.05 * s, 0.43 * s, 0.13 * s); t1.rotation.set(0.18, 0, 0.12); chest.add(t1);
    const t2 = mk(new THREE.BoxGeometry(0.07 * s, 0.3 * s, 0.022 * s), o.scarf); t2.position.set(-0.03 * s, 0.42 * s, -0.12 * s); t2.rotation.set(-0.2, 0, -0.08); chest.add(t2);
  }
  if (o.tunic) {
    const skirt = mk(L([[0.001, -0.4], [0.26, -0.4], [0.24, -0.32], [0.2, -0.1], [0.17, 0.02]]), cloth); skirt.scale.z = 0.8; hips.add(skirt);
    const belt = mk(new THREE.TorusGeometry(0.165 * s, 0.018 * s, 6, 24), trim); belt.rotation.x = Math.PI / 2; belt.scale.y = 0.75; belt.position.y = 0.02 * s; hips.add(belt);
  }
  let robe = null;
  if (o.robe) {
    // long robe from the chest to the ankles, soft folds
    const g = L([[0.001, -0.9], [0.3, -0.9], [0.31, -0.85], [0.28, -0.6], [0.24, -0.3], [0.21, 0.0], [0.2, 0.2], [0.16, 0.36], [0.12, 0.44]], 40);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z);
      const fold = 1 + 0.045 * Math.sin(a * 9 + y * 3) * Math.min(1, Math.max(0, -y / s * 1.5));
      p.setXYZ(i, Math.cos(a) * r * fold, y, Math.sin(a) * r * fold * 0.82);
    }
    g.computeVertexNormals();
    robe = mk(g, cloth); hips.add(robe);
    const sash = mk(new THREE.TorusGeometry(0.2 * s, 0.028 * s, 8, 28), trim); sash.rotation.x = Math.PI / 2; sash.scale.y = 0.8; sash.position.y = 0.02 * s; hips.add(sash);
  }
  if (o.cloak) {
    const g = new THREE.LatheGeometry([[0.38, -0.86], [0.36, -0.7], [0.32, -0.3], [0.28, 0.1], [0.25, 0.4], [0.22, 0.52]].map(([r, y]) => new THREE.Vector2(r * s, y * s)), 30, Math.PI * 0.62, Math.PI * 1.76);
    const c = mk(g, o.cloakMat ?? cloth2); c.scale.z = 0.8; c.material.side = THREE.DoubleSide; hips.add(c);
  }
  let staff = null;
  if (o.staff) { staff = mk(new THREE.CylinderGeometry(0.018 * s, 0.022 * s, 1.75 * s, 8), o.staffMat ?? cloth2); staff.position.y = -0.3 * s; B.hand.add(staff); }
  if (o.bag) { const bag = mk(new THREE.BoxGeometry(0.26 * s, 0.3 * s, 0.12 * s), o.bagMat ?? cloth2); bag.position.set(0.22 * s, -0.2 * s, -0.12 * s); bag.rotation.z = 0.1; hips.add(bag); }
  const base = {};
  function pose(p = {}) {
    Object.assign(base, p);
    hips.rotation.set(p.lean ?? 0, p.turn ?? 0, p.roll ?? 0);
    chest.rotation.set(p.chestX ?? 0, p.chestY ?? 0, 0);
    neck.rotation.set(p.headX ?? 0, p.headY ?? 0, 0);
    A.sh.rotation.set(p.lArmX ?? 0, 0, p.lArmZ ?? 0.1); A.el.rotation.set(p.lElbow ?? -0.2, 0, 0);
    B.sh.rotation.set(p.rArmX ?? 0, 0, p.rArmZ ?? -0.1); B.el.rotation.set(p.rElbow ?? -0.2, 0, 0);
    LL.hp.rotation.set(p.lLeg ?? 0, 0, 0.03); LL.kn.rotation.set(p.lKnee ?? 0, 0, 0);
    RL.hp.rotation.set(p.rLeg ?? 0, 0, -0.03); RL.kn.rotation.set(p.rKnee ?? 0, 0, 0);
  }
  // a walking step on top of the base pose: phase in radians, amount 0..1
  function walk(ph, k = 1) {
    pose(base);
    const sw = Math.sin(ph) * 0.42 * k;
    LL.hp.rotation.x += sw; RL.hp.rotation.x -= sw;
    LL.kn.rotation.x += Math.max(0, -Math.cos(ph)) * 0.55 * k; RL.kn.rotation.x += Math.max(0, Math.cos(ph)) * 0.55 * k;
    A.sh.rotation.x -= sw * 0.6; B.sh.rotation.x += sw * 0.3;
    hips.position.y = 0.95 * s + Math.abs(Math.cos(ph)) * 0.03 * k * s;
    hips.rotation.z += Math.sin(ph) * 0.03 * k;
    if (robe) robe.rotation.z = Math.sin(ph) * 0.03 * k;
  }
  pose(o.pose || {});
  return { group: G, pose, walk, parts: { hips, chest, neck, A, B, LL, RL } };
}
