// horse.js — a riding horse for `ride` (and cavalry heroes): lofted barrel, neck and head, four jointed legs driven by
// a four-beat walk / trot cycle keyed to the distance travelled (hooves don't skate), nodding head, hanging tail,
// saddle + blanket. Faces +Z, metres, standing on y = 0. Deterministic.
import * as THREE from 'three';
import * as R from './rig.js';
import { plain } from '../shared/materials.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2;
const COATS = [0x5A3A22, 0x3A2618, 0x1C1612, 0x7A4A28, 0x8A8680];
export function buildHorse(o = {}) {
  const seed = o.seed ?? 1, coat = o.color != null ? new THREE.Color(o.color).getHex() : COATS[seed % COATS.length];
  const M = {
    coat: plain({ color: coat, roughness: 0.55, metalness: 0 }),
    dark: plain({ color: 0x16110D, roughness: 0.8 }),
    hoof: plain({ color: 0x2A2420, roughness: 0.6 }),
    leather: plain({ color: 0x3A2418, roughness: 0.45 }),
    blanket: plain({ color: o.blanket ?? 0x2A3A5A, roughness: 0.9 }),
    metal: plain({ color: 0x9A9C9E, roughness: 0.35, metalness: 0.9 }),
  };
  const group = new THREE.Group(); group.name = 'horse';
  const mesh = (g, m, parent = group) => { const x = new THREE.Mesh(g, m); x.castShadow = x.receiveShadow = true; parent.add(x); return x; };
  const body = new THREE.Group(); group.add(body);
  // barrel: rings along z (rump -0.85 .. chest +0.8), belly lower in the middle
  const bz = [-0.88, -0.78, -0.55, -0.25, 0.1, 0.45, 0.68, 0.8], bry = [0.22, 0.3, 0.34, 0.33, 0.33, 0.33, 0.28, 0.16], brx = [0.18, 0.25, 0.29, 0.28, 0.28, 0.27, 0.23, 0.13], byc = [1.2, 1.2, 1.2, 1.16, 1.15, 1.18, 1.2, 1.2];
  const barrel = R.tube(bz.map((z, i) => V3(0, byc[i], z)), (t, a) => { const i = Math.min(bz.length - 1, Math.round(t * (bz.length - 1))); return [bry[i], brx[i]]; }, 24, { caps: true, up: V3(0, 1, 0) });
  mesh(barrel, M.coat, body);
  // neck + head as one pivot so it can nod
  const neckG = new THREE.Group(); neckG.position.set(0, 1.35, 0.68); body.add(neckG);
  mesh(R.tube(R.path([[0, 0, 0], [0, 0.22, 0.2], [0, 0.44, 0.34]], 10), (t) => [lerp(0.27, 0.15, t), lerp(0.13, 0.08, t)], 16, { caps: true, up: V3(0, 0, 1) }), M.coat, neckG);
  const headG = new THREE.Group(); headG.position.set(0, 0.46, 0.36); neckG.add(headG);
  mesh(R.tube(R.path([[0, 0.02, -0.04], [0, -0.1, 0.16], [0, -0.3, 0.38]], 10), (t) => [lerp(0.13, 0.08, t), lerp(0.1, 0.065, t)], 14, { caps: true, up: V3(0, 1, 0) }), M.coat, headG);
  for (const s of [1, -1]) { const e = new THREE.ConeGeometry(0.03, 0.11, 6); e.translate(s * 0.06, 0.1, -0.05); mesh(e, M.coat, headG); }
  mesh(R.tube(R.path([[0, 0.12, -0.08], [0, 0.0, -0.25], [0, -0.28, -0.52]].map(([x, y, z]) => [x, y + 0.42, z + 0.3]), 10), [0.02, 0.05], 8, { up: V3(1, 0, 0) }), M.dark, neckG);   // mane
  // bridle + reins
  mesh(new THREE.TorusGeometry(0.1, 0.008, 4, 16).rotateY(Math.PI / 2).translate(0, -0.18, 0.2), M.leather, headG);
  // legs: [x, z, front]
  const legs = [];
  for (const [x, z, front] of [[0.16, 0.55, 1], [-0.16, 0.55, 1], [0.17, -0.62, 0], [-0.17, -0.62, 0]]) {
    const hip = new THREE.Group(); hip.position.set(x, 1.02, z); body.add(hip);
    mesh(R.tube(R.path([[0, 0.1, 0], [0, -0.2, front ? 0.02 : -0.06], [0, -0.44, 0]], 8), (t) => [lerp(front ? 0.12 : 0.16, 0.065, t), lerp(front ? 0.1 : 0.12, 0.06, t)], 12, { caps: true }), M.coat, hip);
    const knee = new THREE.Group(); knee.position.set(0, -0.46, 0); hip.add(knee);
    mesh(R.sphereG(0.06, 0, 0, 0, 1, 1, 1, 10, 8), M.coat, knee);
    mesh(R.tube(R.path([[0, 0, 0], [0, -0.38, 0]], 4), (t) => [0.04, 0.048], 10, { caps: true }), M.coat, knee);
    const fet = new THREE.Group(); fet.position.set(0, -0.38, 0); knee.add(fet);
    mesh(R.sphereG(0.045, 0, 0, 0, 1, 1, 1, 8, 6), M.dark, fet);
    mesh(R.tube(R.path([[0, 0, 0], [0, -0.1, 0.05]], 3), [0.04, 0.045], 10, { caps: true }), M.dark, fet);
    const hoof = new THREE.CylinderGeometry(0.055, 0.07, 0.08, 12); hoof.translate(0, -0.14, 0.06); mesh(hoof, M.hoof, fet);
    legs.push({ hip, knee, fet, front, x });
  }
  // tail
  const tailG = new THREE.Group(); tailG.position.set(0, 1.3, -0.86); body.add(tailG);
  mesh(R.tube(R.path([[0, 0, 0], [0, -0.1, -0.12], [0, -0.45, -0.2], [0, -0.75, -0.18]], 10), (t) => [lerp(0.05, 0.1, t), lerp(0.06, 0.12, t)], 10, { caps: true }), M.dark, tailG);
  // saddle + blanket (the rider sits at saddleY)
  const saddleY = 1.52;
  { const g = R.rbox(0.62, 0.06, 0.78, 0.03); g.translate(0, 1.5, 0.05); mesh(g, M.blanket, body);
    const s = R.rbox(0.36, 0.1, 0.52, 0.05); s.translate(0, 1.56, 0.06); mesh(s, M.leather, body);
    const pm = R.rbox(0.2, 0.12, 0.08, 0.03); pm.translate(0, 1.62, 0.3); mesh(pm, M.leather, body);
    for (const sx of [1, -1]) { mesh(R.rod(V3(sx * 0.2, 1.52, 0.08), V3(sx * 0.26, 1.05, 0.12), 0.01, 0.01, 4), M.leather, body); const st = new THREE.TorusGeometry(0.05, 0.008, 4, 10); st.translate(sx * 0.27, 1.02, 0.12); mesh(st, M.metal, body); }
  }
  const lerpA = (a, b, t) => a + (b - a) * t;
  // gaits (fix, locomotion QA): each hoof is PLANTED during its stance - it moves back under the body exactly as fast as
  // the body moves forward - and swings forward with a lift (a Hermite that leaves and lands at the stance's speed).
  // The legs reach it by 2-bone IK (thigh, cannon to the fetlock; the knee bends the horse's way), the fetlock keeps
  // the hoof level in stance and flicks it in the swing. The body stands DROP lower so bent legs can sweep a stride.
  // k: 0..1 walk (the rider's speed ratio), ~1.1 trot (cavalry at 3 m/s), > 1.2 gallop (a charge). The pendulum legs
  // before this swept 0.6x the ground and lifted the hooves off the ground at both ends of every step.
  const HIP = 1.02, L1 = 0.46, L2 = 0.38, DROP = 0.1;
  const GAITS = { walk: { stride: 1.25, beta: 0.62, off: [0.25, 0.75, 0, 0.5], lift: 0.12, bob: 0.012 },
    trot: { stride: 1.7, beta: 0.45, off: [0, 0.5, 0.5, 0], lift: 0.16, bob: 0.025 }, gallop: { stride: 2.6, beta: 0.3, off: [0.5, 0.6, 0, 0.1], lift: 0.22, bob: 0.04 } };
  const gaitOf = (k) => (k > 1.2 ? GAITS.gallop : k > 1.05 ? GAITS.trot : GAITS.walk);
  const strideFor = (k) => gaitOf(k).stride;
  function update(t, k = 0, dist = 0) {
    const g = gaitOf(k), kk = Math.min(1, Math.max(0, k)), ph = dist / g.stride, D = g.stride * g.beta * kk;
    body.position.y = -DROP + g.bob * kk * Math.sin(TAU * ph * 2);
    legs.forEach((L, i) => {
      const u = (((ph + g.off[i]) % 1) + 1) % 1;
      let z, lift = 0, swing = 0;
      if (u < g.beta) z = D * (0.5 - u / g.beta);
      else {
        const w = (u - g.beta) / (1 - g.beta), m = -D * (1 - g.beta) / g.beta, w2 = w * w, w3 = w2 * w;
        z = (2 * w3 - 3 * w2 + 1) * (-D / 2) + (w3 - 2 * w2 + w) * m + (3 * w2 - 2 * w3) * (D / 2) + (w3 - w2) * m;
        swing = Math.sin(Math.PI * w); lift = g.lift * kk * swing;
      }
      // the fetlock's target in the hip's frame (the hoof sole is 0.18 below and 0.06 ahead of the fetlock)
      const ty = -(HIP + body.position.y) + lift + 0.18, tz = z - 0.06;
      const d = Math.min(L1 + L2 - 1e-4, Math.max(0.2, Math.hypot(tz, ty))), phiT = Math.atan2(tz, -ty);
      const a = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
      const flex = Math.PI - Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
      const thigh = L.front ? phiT + a : phiT - a;
      L.hip.rotation.x = -thigh;
      L.knee.rotation.x = L.front ? flex : -flex;
      L.fet.rotation.x = -(L.hip.rotation.x + L.knee.rotation.x) + swing * kk * (L.front ? -0.9 : 0.7);
    });
    neckG.rotation.x = 0.05 * Math.sin(TAU * ph * 2) * kk + 0.03 * Math.sin(t * 0.7);
    headG.rotation.x = 0.1 + 0.04 * Math.sin(t * 0.9 + 1);
    tailG.rotation.x = 0.15 + 0.05 * Math.sin(t * 1.3); tailG.rotation.z = 0.06 * Math.sin(t * 0.8);
  }
  const bob = (t, k) => body.position.y;
  function lerp(a, b, t) { return a + (b - a) * t; }
  // hoof soles in world space, one point per leg (locomotion QA: a planted hoof keeps still)
  const _h = new THREE.Vector3();
  const contacts = () => { group.updateMatrixWorld(true); return legs.map((L) => { L.fet.localToWorld(_h.set(0, -0.18, 0.06)); return [[_h.x, _h.y, _h.z]]; }); };
  update(0, 0, 0);
  // the saddle sits on the body; bob() already carries the DROP (body.position.y), so saddleY stays the body's own
  return { group, update, saddleY, bob, legs, contacts, strideFor };
}
