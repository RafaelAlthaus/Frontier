// e2_deep.js — (E2, Frontier 3D v2 round 5) the wreck today, 3,800 m down: a dark silt plain, the bow section upright
// and driven nose-first into the mud, the stern a crumpled heap ~600 m away (turned the other way), a debris field
// between (boilers, plates, fittings), rusticles hanging from every edge, marine snow, black water — lit only by a
// submersible's lamp from the camera (fx.underwater abyss mode, switched on by this kind).
//   { "kind": "wreck.titanic", "part": "bow" | "stern" | "debris" | "all", "at": [0, 0], "heading": 0, "lamp": 1.4 }
// The bow sits at `at` facing `heading`; the stern lies 600 m astern of it (part all / stern), the debris between.
import * as THREE from 'three';
import { rng, clamp, lerp, smooth } from '../shared/util.js';
import { prm, num } from './w_common.js';
import { buildTitanic, halfW, deckB } from '../human/titanic.js';
import * as TX from '../human/textures.js';
import { ensureUnderwater } from './e2_under.js';

const DEG = Math.PI / 180;
export const CATALOG = {
  'wreck.titanic': {
    desc: "the Titanic wreck today, 3,800 m down: a dark silt plain; the bow section upright, nose buried in the mud, funnels gone, rust and hanging rusticles; the stern a crumpled, pancaked heap ~600 m astern turned the other way; a debris field between (boilers, plates, fittings). Black water, marine snow, lit only by the submersible lamp that rides with the camera (the deep-sea look is automatic). Keep cameras within ~30 m of what they film (the murk hides the rest).",
    actions: ['idle'],
    params: { part: 'bow | stern | debris | all (default all)', at: '[x, z] the bow (the stern is 600 m astern)', heading: 'deg the bow points (default 0)', lamp: '0..3 the camera lamp (default 1.4)', stern_dist: 'm (default 600)', debris: '0..3 density (default 1)' },
    footprint: [30, 270], height: 20, tags: ['wreck', 'titanic', 'deep', 'underwater', 'sea', 'rust'], section: 'objects',
  },
};

let RUST = null;
function rustTex() {
  if (RUST) return RUST;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N), R = rng(3800);
  const blobs = Array.from({ length: 140 }, () => [R() * N, R() * N, 4 + R() * 30, R()]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0.5; for (const [bx, by, br, w] of blobs) { let dx = Math.abs(x - bx), dy = Math.abs(y - by); dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy); const d = Math.hypot(dx, dy * 0.6) / br; if (d < 1) v += (w - 0.5) * (1 - d * d) * 0.9; }
    v = clamp(v + (R() - 0.5) * 0.12, 0, 1);
    const i = (y * N + x) * 4; img.data[i] = 70 + v * 110; img.data[i + 1] = 32 + v * 55; img.data[i + 2] = 18 + v * 22; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  RUST = new THREE.CanvasTexture(c); RUST.wrapS = RUST.wrapT = THREE.RepeatWrapping; RUST.colorSpace = THREE.SRGBColorSpace; RUST.repeat.set(1 / 9, 1 / 9); RUST.userData.keep = true;
  return RUST;
}

export async function build(kind, item, ctx) {
  const P = prm(item), part = ['bow', 'stern', 'debris', 'all'].includes(P.part) ? P.part : 'all';
  const R = rng(((item.seed ?? 12) * 7919) >>> 0), at = item.at || [0, 0], hd = (item.heading ?? 0) * DEG;
  const UW = ensureUnderwater(ctx, { abyss: true, lamp: num(P.lamp, 1.4) });
  const G = (x, z) => (ctx.ground && ctx.ground.height ? ctx.ground.height(x, z) : 0);
  const root = new THREE.Group(); root.name = 'wreck.titanic';
  const rust = new THREE.MeshStandardMaterial({ map: rustTex(), color: 0xffffff, roughness: 0.92, metalness: 0.1, side: THREE.DoubleSide });
  const rustDark = new THREE.MeshStandardMaterial({ map: rustTex(), color: 0x7a6a60, roughness: 0.95, side: THREE.DoubleSide });
  const silt = new THREE.MeshStandardMaterial({ color: 0x57513f, roughness: 1 });
  for (const m of [rust, rustDark, silt]) if (ctx.patch) ctx.patch(m);
  const fwd = [Math.sin(hd), -Math.cos(hd)];                              // the bow's heading on the plain
  const sternAt = [at[0] - fwd[0] * num(P.stern_dist, 600), at[1] - fwd[1] * num(P.stern_dist, 600)];
  // ── the silt plain (follows the world's ground), with the mud ploughed up along the buried bow ──
  const S = 1400, NSEG = 160, sg = new THREE.PlaneGeometry(S, S, NSEG, NSEG).rotateX(-Math.PI / 2), sp = sg.attributes.position;
  const cx = (at[0] + sternAt[0]) / 2, cz = (at[1] + sternAt[1]) / 2;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i) + cx, z = sp.getZ(i) + cz;
    const lx = (x - at[0]) * fwd[0] + (z - at[1]) * fwd[1], ly = -(x - at[0]) * fwd[1] + (z - at[1]) * fwd[0];   // along the bow / across
    const plough = (part === 'bow' || part === 'all') ? 2.2 * Math.exp(-Math.pow((Math.abs(ly) - 16) / 5, 2)) * smooth((lx + 150) / 40) * (1 - smooth((lx - 5) / 10)) : 0;
    sp.setXYZ(i, x, G(x, z) + 0.6 * Math.sin(x * 0.021 + z * 0.013) * Math.sin(z * 0.017) + plough, z);
  }
  sg.computeVertexNormals();
  const seabed = new THREE.Mesh(sg, silt); seabed.name = 'wreck-seabed'; seabed.receiveShadow = true; seabed.userData.noQA = true; root.add(seabed);
  // ── the ship: one build, split at the break; rusted, stripped (funnels, boats, glass, lights, people gone) ──
  let T = null;
  if (part !== 'debris') {
    const holder = new THREE.Group(); root.add(holder);
    T = await buildTitanic({ scene: holder, renderer: ctx.renderer, tex: { foam: TX.foam(256) }, breakS: 147 });
    const hide = /ti-funnel|ti-boats|ti-lampG|ti-lit|ti-glass|ti-dome|ti-crowsnest|ti-wake|ti-prop/;
    T.root.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh || o.isPoints) {
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m || m.isShaderMaterial || hide.test(o.name) || (m.isMeshBasicMaterial && !/tear/.test(o.name))) { o.visible = false; return; }
        const bright = m.color ? (m.color.r + m.color.g + m.color.b) / 3 : 0.5;
        o.material = bright > 0.45 ? rust : rustDark;
      }
    });
    for (const f of T.figs) f.group.visible = false;
    if (T.wake) T.wake.visible = false;
    const put = (g, pos, yaw, pitch, roll) => { g.matrixAutoUpdate = true; g.position.set(...pos); g.rotation.set(pitch, yaw, roll, 'YXZ'); };
    // the bow: upright, nose down ~3 deg, keel ~12 m in the mud at the tear, ~18 m at the stem
    if (part === 'bow' || part === 'all') { const y0 = G(...at); T.root.position.set(at[0], y0 - 1.5, at[1]); T.root.rotation.set(0.035, Math.PI - hd - Math.PI, 0.02, 'YXZ'); T.root.rotation.y = Math.atan2(fwd[0], fwd[1]); put(T.fore, [0, 0, 0], 0, 0, 0); }
    else T.fore.visible = false;
    // the stern: crumpled and pancaked (its own copies of the geometry), turned about, 600 m astern
    if (part === 'stern' || part === 'all') {
      const aft = T.aft; const Rn = rng(1912);
      aft.traverse((o) => { if (o.isInstancedMesh) { o.visible = false; return; } if (!o.isMesh || !o.visible) return; o.geometry = o.geometry.clone(); const p = o.geometry.attributes.position; const v = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const s = -v.z; const cr = Math.sin(v.x * 0.9 + s * 0.31) * Math.sin(v.y * 0.7 + s * 0.17) * 1.4;
          v.y = v.y * 0.5 + (v.y > 4 ? -3 + cr : cr * 0.4); v.x *= 1 + 0.12 * Math.sin(s * 0.2 + v.y); v.z += Math.sin(v.y * 0.5 + v.x * 0.3) * 1.2; p.setXYZ(i, v.x, v.y, v.z); }
        o.geometry.computeVertexNormals(); o.geometry.computeBoundingSphere(); o.geometry.computeBoundingBox(); });
      void Rn;
      // place the stern section (its local frame is the ship's: s 147..269) so its middle sits at sternAt, turned ~160 deg
      const mid = 208, rot = Math.atan2(fwd[0], fwd[1]) + 160 * DEG;
      const holder2 = new THREE.Group(); holder2.position.set(sternAt[0], G(...sternAt) - 1.0, sternAt[1]); holder2.rotation.set(0.02, rot, -0.05); root.add(holder2);
      holder2.add(aft); aft.matrixAutoUpdate = true; aft.position.set(0, 0, mid); aft.rotation.set(0, 0, 0); aft.scale.set(1, 1, 1);
    } else T.aft.visible = false;
    // rusticles: hanging from the bulwark tops and the deck edges of the bow
    if (part === 'bow' || part === 'all') {
      const NR = 520, rc = new THREE.InstancedMesh(new THREE.ConeGeometry(0.12, 1, 5).rotateX(Math.PI).translate(0, -0.5, 0), rust, NR), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
      for (let i = 0; i < NR; i++) { const s = 4 + R() * 140, sd = R() < 0.5 ? 1 : -1, y = deckB(s) + (R() < 0.6 ? 1.1 : -1.5 - R() * 5); const x = sd * (halfW(s, Math.min(y, 14)) + 0.05); q.setFromEuler(e.set((R() - 0.5) * 0.2, 0, (R() - 0.5) * 0.2)); sv.set(0.6 + R() * 1.4, 0.4 + R() * 1.8, 0.6 + R() * 1.4); pv.set(x, y, -s); m4.compose(pv, q, sv); rc.setMatrixAt(i, m4); }
      rc.name = 'wreck-rusticles'; rc.userData.noQA = true; T.fore.add(rc);
    }
  }
  // ── the debris field between the two halves: boilers, plates, girders, bits ──
  if (part === 'debris' || part === 'all') {
    const nD = Math.round(260 * clamp(num(P.debris, 1), 0, 3)), geos = [new THREE.BoxGeometry(4, 0.12, 2.5), new THREE.BoxGeometry(0.5, 0.5, 6), new THREE.CylinderGeometry(2.4, 2.4, 6, 18).rotateZ(Math.PI / 2), new THREE.BoxGeometry(0.8, 0.6, 0.8), new THREE.TorusGeometry(0.5, 0.12, 6, 14)];
    geos.forEach((g, gi) => {
      const n = gi === 2 ? 6 : Math.round(nD / 4), im = new THREE.InstancedMesh(g, gi === 3 || gi === 4 ? rustDark : rust, n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < n; i++) { const u = gi === 2 ? 0.35 + R() * 0.3 : R(), lat = (R() - 0.5) * (gi === 2 ? 40 : 160) * (0.5 + Math.sin(u * Math.PI)); const x = lerp(at[0], sternAt[0], u) + (-fwd[1]) * lat, z = lerp(at[1], sternAt[1], u) + fwd[0] * lat;
        q.setFromEuler(e.set((R() - 0.5) * 0.5, R() * 6.28, (R() - 0.5) * 0.5)); pv.set(x, G(x, z) + (gi === 2 ? 1.2 : 0.05), z); sv.setScalar(gi === 2 ? 1 : 0.5 + R()); m4.compose(pv, q, sv); im.setMatrixAt(i, m4); }
      im.name = 'wreck-debris'; root.add(im);
    });
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const anchors = {};
  if (T) { for (const [k, o] of Object.entries(T.anchors)) if (/bow|forecastle|bridge|well_deck|crows_nest|boat_deck|stern_deck|stern$/.test(k)) anchors[k] = o; }
  return { root, radius: part === 'all' ? 320 : 140, height: 20, snapped: true, contact: false, anchors, update: (t, clock, cam) => { if (cam) UW.update(t, cam); } };
}
